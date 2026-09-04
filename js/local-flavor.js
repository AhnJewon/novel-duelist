// local-flavor.js - 로컬 전용 **플레이버 팩** 확장점 (DECISIONS #103)
//
// 게임의 규칙·수치·밸런스는 그대로 두고, **표시 문구와 생성 프롬프트만** 로컬 파일로 갈아끼운다.
//   · 효과·상태이상·키워드 이름   · 규칙 텍스트의 낱말   · 이미지 rating/프롬프트   · 카드 기획 지시문
//
// `js/flavor.local.js`가 있으면 부팅 때 불러 적용하고, 없으면 아무 일도 일어나지 않는다.
// 그 파일은 `.gitignore`로 저장소에서 빠진다 — 저장소에는 **확장점만** 있고 내용은 각자 로컬에 둔다.
//
// ⚠️ 이 파일은 아무것도 static import 하지 않는다. config·card-renderer·tag-slm이 이걸 import 하므로
//    여기서 되import 하면 순환이 된다. 테이블 덮어쓰기는 loadLocalFlavor() 안에서 **동적 import**로 한다.
//    (battle-rules.js와 같은 이유 — 여러 모듈이 공유하는 무의존 모듈)
//    예외: korean-grammar.js는 아무것도 import 하지 않으므로 순환이 생길 수 없다.

import { fixParticles } from './korean-grammar.js';

let _pack = null;        // 적용된 팩 (없으면 null)
let _terms = [];         // [[정규식, 치환]] — 규칙 텍스트 낱말 교체
let _enabled = false;    // 설정 토글
let _tables = null;      // 덮어쓴 테이블의 모듈 참조 + 원래 값 (되돌리기용)

/** 팩이 실제로 적용 중인가 */
export function isFlavorActive() {
  return !!_pack && _enabled;
}

/** 적용 중인 팩의 이름 (없으면 null) */
export function flavorPackName() {
  return isFlavorActive() ? (_pack.label || _pack.id || 'local') : null;
}

/**
 * 규칙 텍스트의 낱말을 팩 사전으로 바꾼다.
 * ⚠️ 이건 LLM 산문을 "수리"하는 게 아니다(규칙 81). **우리가 데이터에서 만든** 문장의 낱말만 갈아끼운다.
 */
export function flavorRewrite(text) {
  if (!isFlavorActive() || !text || _terms.length === 0) return text;
  let out = String(text);
  for (const [re, to] of _terms) out = out.replace(re, to);
  // 🇰🇷 낱말을 갈아끼우면 받침이 달라져 조사가 어긋난다 ("15 피해를" → "15 자극를").
  //    프로젝트의 조사 교정기를 그대로 태운다 (규칙 46 — 어법은 규칙 기반 한 곳에서).
  return fixParticles(out);
}

// ── 🖼️ 이미지 생성 ────────────────────────────────────────────
/** TIPO 프롬프트의 rating 값 (기본 safe) */
export function flavorRating() {
  return (isFlavorActive() && _pack.image && _pack.image.rating) || 'safe';
}

/** 이미지 프롬프트 앞에 붙일 태그 */
export function flavorPositiveTags() {
  if (!isFlavorActive() || !_pack.image) return [];
  return (_pack.image.positive || []).slice();
}

/**
 * 네거티브 프롬프트 추가분.
 *
 * 🔒 rating이 safe가 아닌 팩에는 **연령 안전 네거티브를 코드가 무조건 붙인다.** 로컬 팩 파일을 고쳐도 빠지지 않는다 —
 *    이 파이프라인은 애니 화풍 인물을 만들고, 그 화풍은 이 방향으로 흐르기 쉬워서 생성 단계에서 막는 것이 맞다.
 */
export function flavorNegativeTags() {
  if (!isFlavorActive()) return [];
  const own = (_pack.image && _pack.image.negative) || [];
  const ageSafety = flavorRating() === 'safe' ? [] : [
    'child', 'children', 'kid', 'toddler', 'infant', 'baby',
    'loli', 'lolicon', 'shota', 'shotacon', 'petite child', 'young child',
    'underage', 'minor', 'school child', 'elementary', 'flat chest child', 'age regression'
  ];
  return [...own, ...ageSafety];
}

/**
 * 팩이 추가한 상태이상 타입 이름들 — 카드 기획 프롬프트의 `statusEffect.type` enum을 넓힌다.
 * 엔진은 STATUS_EFFECTS 테이블을 순회하므로 등록만 하면 그대로 돌지만, LLM은 목록에 없으면 고르지 못한다.
 */
export function flavorStatusTypes() {
  if (!isFlavorActive() || !_pack.statusEffects) return [];
  return Object.keys(_pack.statusEffects);
}

/** 카드 기획(LLM) 프롬프트에 붙일 지시문 */
export function flavorConceptDirective() {
  if (!isFlavorActive() || !_pack.llm) return '';
  const d = _pack.llm.conceptDirective || '';
  // 🔒 위와 같은 이유로 인물 나이 하한을 코드가 덧붙인다.
  const adultOnly = flavorRating() === 'safe' ? ''
    : '\n- 등장 인물은 **성인**으로만 묘사한다. 아동·미성년으로 읽힐 표현(어린, 소녀/소년, 교복, 로리 등)은 쓰지 않는다.';
  return d ? `\n\n${d}${adultOnly}` : adultOnly;
}

// ── 🔌 로딩 ───────────────────────────────────────────────────
/**
 * 로컬 팩을 불러 적용한다. main.js 부팅 초반에 한 번 부른다.
 * 파일이 없으면 조용히 끝난다 (404 → import 실패 → null).
 */
export async function loadLocalFlavor() {
  let mod = null;
  try {
    mod = await import('./flavor.local.js');
  } catch (e) {
    return null;   // 로컬 팩 없음 — 기본 게임 그대로
  }
  const pack = (mod && (mod.default || mod.pack)) || null;
  if (!pack) return null;
  _pack = pack;

  const { state, saveSettingsToStorage } = await import('./storage.js');
  const key = pack.requiresSetting || 'localFlavor';
  // 설정에 값이 없으면 기본 꺼짐 — 파일을 넣었다고 저절로 켜지지는 않는다
  if (state.settings[key] === undefined) state.settings[key] = false;
  _enabled = !!state.settings[key];

  _terms = (pack.terms || []).map(([from, to]) => [new RegExp(escapeRe(from), 'g'), to]);

  if (_enabled) { await applyTables(pack); await seedArchetypes(pack); sweepStaticUi(pack); }
  injectSettingRow(pack, key, state, saveSettingsToStorage);
  console.log(`[Flavor] 로컬 팩 '${pack.label || pack.id}' ${_enabled ? '적용됨' : '대기 중 (설정에서 켜기)'}`);
  return pack;
}

/**
 * 이름 테이블(상태이상·효과 라벨·키워드 사전)을 팩 값으로 덮어쓴다.
 * 원래 값과 모듈 참조를 `_tables`에 남겨 두어 `setFlavorEnabled(false)`로 되돌릴 수 있게 한다.
 */
async function applyTables(pack) {
  const { STATUS_EFFECTS } = await import('./status-effects.js');
  const { EFFECT_COSTS, ENTITY_ONLY_STATUSES, ELEMENT_CONFIG, CARD_TYPES, RARITY_STYLE } = await import('./config.js');
  const { KEYWORD_DEFINITIONS } = await import('./keyword-service.js');
  const { registerStatusBadge } = await import('./card-renderer.js');
  const { BOSS_DATA } = await import('./data.js');
  const { STATUS_CYCLES } = await import('./status-cycles.js');
  const { RACE_CONFIG } = await import('./races.js');   // 🧬 종족 이름·아이콘·이미지 태그 (DECISIONS #106)
  const { CYCLE_ROLES } = await import('./cycle-roles.js');   // 🧬 사이클 역할 이름 (DECISIONS #107)
  const { state } = await import('./storage.js');
  // 모듈 참조를 잡아 두면 이후 켜고 끄기는 동기로 처리된다 (하네스가 await 없이 감쌀 수 있게)
  _tables = { STATUS_EFFECTS, EFFECT_COSTS, KEYWORD_DEFINITIONS, ENTITY_ONLY_STATUSES, registerStatusBadge,
              ELEMENT_CONFIG, CARD_TYPES, RARITY_STYLE, BOSS_DATA, STATUS_CYCLES, RACE_CONFIG, CYCLE_ROLES, state,
              orig: { status: {}, label: {}, keyword: {}, badge: {}, generic: [] }, added: [] };
  applyPackToTables();
}

/**
 * 표 하나의 항목들을 덮어쓰고 **원래 값을 되돌리기 목록에 남긴다**. 필드 단위라 색상·뱃지 클래스는 그대로 둔다.
 * 속성·카드 타입·등급·보스처럼 "이름과 아이콘만 갈아끼우면 되는" 표에 공통으로 쓴다 (DECISIONS #103).
 */
function overrideTable(table, overrides, orig) {
  for (const [key, fields] of Object.entries(overrides || {})) {
    const target = table[key];
    if (!target) continue;
    for (const [f, v] of Object.entries(fields)) {
      orig.push({ target, field: f, value: target[f], had: Object.prototype.hasOwnProperty.call(target, f) });
      target[f] = v;
    }
  }
}

/** 보스는 배열이라 id로 찾는다. 기본 표(BOSS_DATA)와 **메모리의 유저 보스 목록**을 함께 덮어쓴다(저장하지 않는다). */
function overrideBosses(pack, orig) {
  const lists = [_tables.BOSS_DATA, _tables.state.bossesList].filter(Array.isArray);
  for (const [id, fields] of Object.entries(pack.bosses || {})) {
    for (const list of lists) {
      const boss = list.find(b => b && (b.id === id || b.name === id));
      if (!boss) continue;
      for (const [f, v] of Object.entries(fields)) {
        orig.push({ target: boss, field: f, value: boss[f], had: Object.prototype.hasOwnProperty.call(boss, f) });
        boss[f] = v;
      }
    }
  }
}

/**
 * 팩 내용을 테이블에 적용한다. **원래 값을 먼저 담아 두고** 덮어쓰므로 껐다 켜기를 반복해도 안전하다.
 * 🐛 예전엔 켜기 경로가 이름·라벨만 다시 넣고 **추가 상태이상은 빠뜨려서**, 하네스가 한 번 돌고 나면
 *    팩이 추가한 상태이상이 통째로 사라졌다 (실측: 하네스 뒤 STATUS_EFFECTS에 팩 항목 없음). 적용 경로를 하나로 합쳤다.
 */
function applyPackToTables() {
  if (!_tables || !_pack) return;
  const { STATUS_EFFECTS, EFFECT_COSTS, KEYWORD_DEFINITIONS, ENTITY_ONLY_STATUSES, registerStatusBadge, orig } = _tables;
  _tables.added = [];

  // ➕ 팩이 추가하는 **새 상태이상**. STATUS_EFFECTS가 완전히 데이터 주도라(모든 읽는 쪽이 이 테이블을 순회한다)
  //    항목만 넣으면 지속 피해·증폭·봉쇄·감쇠가 그대로 돈다 — 엔진 수정이 없다 (DECISIONS #103).
  //    ⚠️ entityOnly는 config의 ENTITY_ONLY_STATUSES에도 함께 넣어야 가격이 맞는다 (규칙 26).
  for (const [type, spec] of Object.entries(_pack.statusEffects || {})) {
    if (STATUS_EFFECTS[type]) continue;                     // 기본 상태이상은 덮어쓰지 않는다 (이름은 statusNames로)
    const { badge, ...def } = spec;
    STATUS_EFFECTS[type] = def;
    _tables.added.push(type);
    if (def.entityOnly) ENTITY_ONLY_STATUSES.add(type);
    if (badge) orig.badge[type] = registerStatusBadge(type, badge.tone, badge.label);
  }

  for (const [type, name] of Object.entries(_pack.statusNames || {})) {
    if (!STATUS_EFFECTS[type]) continue;
    orig.status[type] = STATUS_EFFECTS[type].name;
    STATUS_EFFECTS[type].name = name;
  }
  for (const [k, label] of Object.entries(_pack.effectLabels || {})) {
    if (!EFFECT_COSTS[k]) continue;
    orig.label[k] = EFFECT_COSTS[k].label;
    EFFECT_COSTS[k].label = label;
  }
  for (const [k, v] of Object.entries(_pack.keywords || {})) {
    if (!KEYWORD_DEFINITIONS[k]) continue;
    orig.keyword[k] = { ...KEYWORD_DEFINITIONS[k] };
    Object.assign(KEYWORD_DEFINITIONS[k], v);
  }

  // 🌍 속성 · 카드 타입 · 등급 · 보스 — 이름과 아이콘만 갈아끼운다 (색상 클래스는 건드리지 않는다)
  orig.generic = [];
  overrideTable(_tables.ELEMENT_CONFIG, _pack.elements, orig.generic);
  overrideTable(_tables.CARD_TYPES, _pack.cardTypes, orig.generic);
  overrideTable(_tables.RARITY_STYLE, _pack.rarities, orig.generic);
  // 🧬 종족은 name·icon에 더해 **tags**(이미지 시드)까지 갈 수 있다 — overrideTable이 필드 단위라 그대로 된다
  overrideTable(_tables.RACE_CONFIG, _pack.races, orig.generic);
  overrideTable(_tables.CYCLE_ROLES, _pack.cycleRoles, orig.generic);
  overrideBosses(_pack, orig.generic);

  // 🔄 사이클(기생 → 성장 → 부화)의 수치·토큰 이름. `payoff`는 통째로 갈지 않고 **필드만** 병합한다.
  for (const [type, over] of Object.entries(_pack.cycles || {})) {
    const cyc = _tables.STATUS_CYCLES[type];
    if (!cyc) continue;
    for (const [f, v] of Object.entries(over)) {
      if (f === 'payoff' && cyc.payoff && v && typeof v === 'object') {
        for (const [pf, pv] of Object.entries(v)) {
          orig.generic.push({ target: cyc.payoff, field: pf, value: cyc.payoff[pf], had: Object.prototype.hasOwnProperty.call(cyc.payoff, pf) });
          cyc.payoff[pf] = pv;
        }
      } else {
        orig.generic.push({ target: cyc, field: f, value: cyc[f], had: Object.prototype.hasOwnProperty.call(cyc, f) });
        cyc[f] = v;
      }
    }
  }
}

/**
 * 팩이 들고 온 카드군을 보관함 카드군 DB에 심는다 (이미 있으면 registerNewArchetype의 동일성 게이트가 흡수한다).
 *
 * ⚠️ 카드군은 **유저 데이터**다(IndexedDB). 팩을 지워도 남는다 — 카드가 그 카드군에 소속돼 있을 수 있으므로
 *    자동으로 지우지 않는다. 정리하려면 콘솔에서 `resetArchetypes()`.
 */
async function seedArchetypes(pack) {
  const list = pack.archetypes || [];
  if (list.length === 0) return;
  const { registerNewArchetype } = await import('./archetype-service.js');
  let added = 0;
  for (const a of list) {
    const before = a.id;
    const reg = await registerNewArchetype(a);
    if (reg && reg.id === before) added++;
  }
  if (added > 0) console.log(`[Flavor] 카드군 ${added}종 등록/확인`);
}

/** 덮어쓴 이름 테이블을 원래 값으로 되돌린다 */
function restoreTables() {
  if (!_tables) return;
  const { STATUS_EFFECTS, EFFECT_COSTS, KEYWORD_DEFINITIONS, ENTITY_ONLY_STATUSES, registerStatusBadge, orig, added } = _tables;
  for (const [type, name] of Object.entries(orig.status)) STATUS_EFFECTS[type].name = name;
  for (const [k, label] of Object.entries(orig.label)) EFFECT_COSTS[k].label = label;
  for (const [k, v] of Object.entries(orig.keyword)) Object.assign(KEYWORD_DEFINITIONS[k], v);
  // 팩이 추가한 상태이상은 통째로 걷어낸다 (하네스가 기본 게임을 검증할 수 있게)
  for (const type of added) {
    delete STATUS_EFFECTS[type];
    ENTITY_ONLY_STATUSES.delete(type);
    const prev = orig.badge[type];
    registerStatusBadge(type, prev && prev.tone, prev && prev.label);
  }
  // 속성·타입·등급·보스는 기록해 둔 순서의 역순으로 되돌린다
  for (const e of (orig.generic || []).slice().reverse()) {
    if (e.had) e.target[e.field] = e.value; else delete e.target[e.field];
  }
  orig.generic = [];
}

/**
 * 팩을 껐다 켠다 (동기). **검증 하네스 전용** —
 * 하네스는 표시 문구를 단언하므로 기본 게임 문구로 돌려놓고 돌려야 한다. `withFlavorDisabled`를 쓰세요.
 */
export function setFlavorEnabled(on) {
  if (!_pack) return false;
  const next = !!on;
  if (next === _enabled) return _enabled;
  _enabled = next;
  if (next) applyPackToTables();
  else restoreTables();
  return _enabled;
}

/**
 * 팩을 끈 채로 fn을 돌리고 원래 상태로 되돌린다.
 * 🐛 하네스(_verify/battle-audit.js)가 "적 1체에게 12 피해" 같은 **표시 문구**를 단언하므로, 팩이 켜져 있으면
 *    12개가 빨개진다. 규칙·수치는 팩과 무관하므로 하네스는 기본 문구로 검증하는 것이 맞다 (DECISIONS #103).
 */
export async function withFlavorDisabled(fn) {
  const was = _enabled;
  if (was) setFlavorEnabled(false);
  try { return await fn(); }
  finally { if (was) setFlavorEnabled(true); }
}

/**
 * 설정 모달에 토글 한 줄을 **동적으로** 넣는다.
 * 🐛 index.html에 두면 팩이 없는 사람(=저장소를 받은 사람)에게도 보인다. 팩이 있을 때만 생기게 한다.
 */
function injectSettingRow(pack, key, state, saveSettings) {
  const anchor = document.getElementById('setting-tag-slm-artists');
  if (!anchor || document.getElementById('setting-local-flavor')) return;
  const row = document.createElement('div');
  row.className = 'mt-3 p-2.5 rounded-xl bg-[#191d33] border border-slate-700';
  row.innerHTML = `
    <label class="flex items-start gap-2 text-[11px] text-slate-200 cursor-pointer select-none">
      <input type="checkbox" id="setting-local-flavor" class="mt-0.5 accent-amber-500">
      <span><b>${escapeHtmlLite(pack.label || pack.id)}</b> 사용
        <span class="block text-[10px] text-slate-500 mt-0.5">로컬 플레이버 팩 (js/flavor.local.js). 규칙·수치는 그대로이고 문구와 이미지 프롬프트만 바뀝니다. 적용하려면 새로고침.</span>
      </span>
    </label>`;
  anchor.closest('div').parentElement.appendChild(row);
  const box = row.querySelector('#setting-local-flavor');
  box.checked = _enabled;
  box.addEventListener('change', async () => {
    state.settings[key] = box.checked;
    await saveSettings();
    location.reload();   // 이름 테이블을 되돌리려면 다시 불러오는 편이 확실하다
  });
}

/**
 * 🏷️ 화면에 고정으로 박혀 있는 문구(탭 이름·버튼·라벨·안내문)를 팩 사전으로 갈아끼운다.
 *
 * index.html의 한국어는 전부 정적 텍스트라 코드가 손댈 자리가 없다. 부팅 때 **텍스트 노드만** 한 번 훑는다 —
 * 태그·속성·클래스는 건드리지 않으므로 레이아웃이 깨질 일이 없다. 이후 동적으로 그려지는 것들은
 * 각자의 경로(flavorRewrite·이름 테이블)에서 이미 처리된다.
 *
 * `uiTerms`는 UI 전용 사전이다 — 전투 규칙 텍스트에는 쓰이지 않는 낱말(탭 이름 등)을 여기 둔다.
 */
function sweepStaticUi(pack) {
  if (!isFlavorActive()) return;
  const pairs = [...(pack.uiTerms || []), ...(pack.terms || [])]
    .map(([from, to]) => [new RegExp(escapeRe(from), 'g'), to]);
  if (pairs.length === 0) return;
  const apply = (s) => { let o = s; for (const [re, to] of pairs) o = o.replace(re, to); return o; };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && !SKIP.has(n.parentElement.tagName) && /[가-힣]/.test(n.nodeValue))
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  let n, count = 0;
  while ((n = walker.nextNode())) {
    const next = apply(n.nodeValue);
    if (next !== n.nodeValue) { n.nodeValue = next; count++; }
  }
  // 입력칸 안내문·툴팁도 함께 (값은 건드리지 않는다)
  for (const el of document.querySelectorAll('[placeholder], [title]')) {
    for (const attr of ['placeholder', 'title']) {
      const v = el.getAttribute(attr);
      if (!v || !/[가-힣]/.test(v)) continue;
      const next = apply(v);
      if (next !== v) { el.setAttribute(attr, next); count++; }
    }
  }
  console.log(`[Flavor] 화면 문구 ${count}곳 교체`);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtmlLite(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
