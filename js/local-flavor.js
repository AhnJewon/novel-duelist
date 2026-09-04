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
  return out;
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

  if (_enabled) await applyTables(pack);
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
  const { EFFECT_COSTS } = await import('./config.js');
  const { KEYWORD_DEFINITIONS } = await import('./keyword-service.js');
  _tables = { STATUS_EFFECTS, EFFECT_COSTS, KEYWORD_DEFINITIONS, orig: { status: {}, label: {}, keyword: {} } };

  for (const [type, name] of Object.entries(pack.statusNames || {})) {
    if (!STATUS_EFFECTS[type]) continue;
    _tables.orig.status[type] = STATUS_EFFECTS[type].name;
    STATUS_EFFECTS[type].name = name;
  }
  for (const [k, label] of Object.entries(pack.effectLabels || {})) {
    if (!EFFECT_COSTS[k]) continue;
    _tables.orig.label[k] = EFFECT_COSTS[k].label;
    EFFECT_COSTS[k].label = label;
  }
  for (const [k, v] of Object.entries(pack.keywords || {})) {
    if (!KEYWORD_DEFINITIONS[k]) continue;
    _tables.orig.keyword[k] = { ...KEYWORD_DEFINITIONS[k] };
    Object.assign(KEYWORD_DEFINITIONS[k], v);
  }
}

/** 덮어쓴 이름 테이블을 원래 값으로 되돌린다 */
function restoreTables() {
  if (!_tables) return;
  const { STATUS_EFFECTS, EFFECT_COSTS, KEYWORD_DEFINITIONS, orig } = _tables;
  for (const [type, name] of Object.entries(orig.status)) STATUS_EFFECTS[type].name = name;
  for (const [k, label] of Object.entries(orig.label)) EFFECT_COSTS[k].label = label;
  for (const [k, v] of Object.entries(orig.keyword)) Object.assign(KEYWORD_DEFINITIONS[k], v);
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
  if (next) { for (const [type, name] of Object.entries(_pack.statusNames || {})) { if (_tables && _tables.STATUS_EFFECTS[type]) _tables.STATUS_EFFECTS[type].name = name; }
              for (const [k, label] of Object.entries(_pack.effectLabels || {})) { if (_tables && _tables.EFFECT_COSTS[k]) _tables.EFFECT_COSTS[k].label = label; }
              for (const [k, v] of Object.entries(_pack.keywords || {})) { if (_tables && _tables.KEYWORD_DEFINITIONS[k]) Object.assign(_tables.KEYWORD_DEFINITIONS[k], v); } }
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

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtmlLite(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
