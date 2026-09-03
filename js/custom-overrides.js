// custom-overrides.js - 카드 연성소 세부 커스터마이즈
//
// 사용자가 카드군·키워드·등급·마나·스탯·연계·함정조건을 직접 지정할 수 있다.
// 비워둔 항목만 LLM이 정한다. 지정한 값도 파워 예산 검증은 그대로 거친다.

/**
 * 🎛️ 연성소 세부 커스터마이즈 값 수집.
 * 비어 있는 항목은 null — LLM이 알아서 정한다.
 */
export function readCustomOverrides() {
  const v = (id) => {
    const el = document.getElementById(id);
    const s = el ? String(el.value || '').trim() : '';
    return s.length > 0 ? s : null;
  };
  const n = (id) => {
    const s = v(id);
    if (s === null) return null;
    const num = parseInt(s, 10);
    return Number.isFinite(num) ? num : null;
  };

  return {
    themeId: selectedThemeId(),
    themeName: v('custom-theme-name'),
    themeKeyword: v('custom-theme-keyword'),
    // ⭐ 등급은 본 폼의 #forge-rarity **한 곳**에서만 읽는다.
    //    예전에는 여기 #custom-rarity가 따로 있어서 값이 두 곳에서 들어왔고,
    //    저장은 #forge-rarity를 읽어 어느 쪽이 이기는지 알 수 없었다 → DECISIONS #92
    //    빈 값('')은 "AI 결정 / 가챠" — null로 넘겨야 LLM이 정한다.
    rarity: v('forge-rarity'),
    cost: n('custom-cost'),
    attack: n('custom-attack'),
    hp: n('custom-hp'),
    defense: n('custom-defense'),
    comboAction: v('custom-combo-action'),
    comboTrigger: v('custom-combo-trigger'),
    comboScaling: v('custom-combo-scaling'),
    trapTrigger: v('custom-trap-trigger'),
    trapCondition: v('custom-trap-condition'),
    effectDesc: v('custom-effect-desc')
  };
}

/** 커스텀 값을 LLM 프롬프트 지시문으로 변환 */
export function customOverridesToPrompt(o) {
  const lines = [];
  if (o.themeId) {
    // 기존 카드군을 골랐다 — id를 그대로 쓰게 해야 새 카드군이 생기지 않는다
    lines.push(`- 카드군은 기존 카드군 "${o.themeName}"에 편입시킬 것. "themeId"에 "${o.themeId}"를 그대로 복사하고 "themeName"도 한 글자도 바꾸지 말 것.`);
  } else if (o.themeName) {
    lines.push(`- 카드군은 반드시 "${o.themeName}"으로 할 것 (기존에 있으면 그 id 재사용)`);
  }
  if (o.themeKeyword) {
    // 🔑 키워드는 카드군에 종속되지 않는다. 기존 카드군을 고른 채로 다른 키워드를
    //    넣으면 그건 **이 카드의** 키워드다 — 카드군을 갈아타라는 뜻이 아니다.
    //    (소속 판정의 권위는 themeId — DECISIONS #17)
    // ⚠️ 조사가 받침에 따라 갈리는 문장은 피한다 ("역린"다 / "홍련"이다) — korean-grammar.js가
    //    닿지 않는 프롬프트 문자열이므로 애초에 조사가 붙지 않게 쓴다.
    lines.push(o.themeId
      ? `- 이 카드의 핵심 키워드: "${o.themeKeyword}" — 이름과 컨셉에 자연스럽게 녹일 것. 단 소속 카드군은 위에 지정한 대로이며 "themeId"를 바꾸지 말 것.`
      : `- 카드군 키워드는 "${o.themeKeyword}"로 할 것`);
  }
  if (o.rarity) lines.push(`- 등급(rarity)은 반드시 "${o.rarity}"로 할 것`);
  if (o.cost !== null) lines.push(`- 마나 코스트는 ${o.cost}로 할 것`);
  if (o.attack !== null) lines.push(`- 공격력은 ${o.attack}로 할 것`);
  if (o.hp !== null) lines.push(`- 체력은 ${o.hp}로 할 것`);
  if (o.defense !== null) lines.push(`- 방어력은 ${o.defense}로 할 것`);
  if (o.comboAction) lines.push(`- 카드군 연계 액션(themeComboAction)은 "${o.comboAction}"로 할 것`);
  if (o.comboTrigger) lines.push(`- 연계 발동조건(comboTrigger)은 "${o.comboTrigger}"로 할 것`);
  if (o.comboScaling) lines.push(`- 연계 증가방식(comboScaling)은 "${o.comboScaling}"로 할 것`);
  if (o.trapTrigger) lines.push(`- 함정 발동조건(trapTrigger)은 "${o.trapTrigger}"로 할 것`);
  if (o.trapCondition) lines.push(`- 함정 조건값(condition)은 "${o.trapCondition}"으로 할 것`);
  if (o.effectDesc) lines.push(`- 카드 효과는 이 설명을 최대한 반영할 것: "${o.effectDesc}"`);

  if (lines.length === 0) return '';
  return `\n🎛️ 사용자 지정 (반드시 지킬 것):\n${lines.join('\n')}\n`;
}

/**
 * LLM 응답에 커스텀 값을 덮어쓴다.
 * 프롬프트 지시를 무시하는 경우가 있으므로 코드에서 한 번 더 강제한다.
 * (수치는 이후 파워 예산 검증을 거치므로 여기서 확정되지 않는다)
 */
export function applyCustomOverrides(data, o) {
  if (!o) return data;
  const out = { ...data };
  // ⚜️ 소속의 권위는 themeId다 (DECISIONS #17). 프롬프트의 "id를 그대로 복사"
  //    지시에만 기대면 4B 모델이 흘려서 소속이 조용히 새 카드군으로 샌다.
  //    코드에서 못을 박아야 키워드를 바꿔도 소속이 안 바뀐다.
  if (o.themeId) {
    out.themeId = o.themeId;
  } else if (o.themeName) {
    // ✏️ 새 카드군 창작 — 유저가 이름만 줬다. 그런데 4B 모델은 "겹치면 기존 id를 복사하라"는 재사용 규칙을
    //    따라 기존 themeId를 같이 뱉는다. 그걸 남겨두면 applyGeneratedCardData가 그 기존 카드군에 **고정**해
    //    유저의 새 카드군은 영영 생기지 않았다 (DECISIONS #96). 소속 판정은 proposeArchetype(게이트·LLM 판정)에 맡긴다.
    out.themeId = null;
  }
  if (o.themeName) out.themeName = o.themeName;
  if (o.themeKeyword) out.themeKeyword = o.themeKeyword;
  if (o.rarity) out.rarity = o.rarity;
  if (o.cost !== null) out.cost = o.cost;
  if (o.attack !== null) out.attack = o.attack;
  if (o.hp !== null) out.hp = o.hp;
  if (o.defense !== null) out.defense = o.defense;
  if (o.comboAction) out.themeComboAction = o.comboAction;
  if (o.comboTrigger) out.comboTrigger = o.comboTrigger;
  if (o.comboScaling) out.comboScaling = o.comboScaling;
  if (o.trapTrigger) {
    out.trapTrigger = o.trapTrigger;
    out.cardType = 'trap';
  }
  if (o.trapCondition) {
    // 조건값 하나를 받아 trapTrigger가 요구하는 칸에 넣는다
    const t = out.trapTrigger || '';
    const key = t === 'foePlaysElement' ? 'element'
      : t === 'foePlaysArchetype' ? 'archetype'
      : t === 'foePlaysKeyword' ? 'keyword' : null;
    if (key) out.condition = { [key]: o.trapCondition };
  }
  return out;
}

// ============================================================
// ⚜️ 기존 카드군 선택
// ------------------------------------------------------------
// 예전에는 자유 입력만 가능해서, 기존 카드군에 카드를 보태려면
// 이름을 **정확히 똑같이** 타이핑해야 했다. 한 글자만 달라도 새 카드군이
// 생겨 카드군이 난립했다 (DECISIONS #1의 근본 원인과 같다).
//
// 이제 목록에서 고르면 이름·키워드·id가 한 번에 채워진다.
// '직접 입력'을 고르면 예전처럼 자유 창작도 된다 — 둘 다 필요하다.
// ⚠️ 잠그는 것은 **이름뿐**이다. 키워드는 기본값만 채우고 열어둔다 (DECISIONS #92).
// ============================================================

/** 카드군 선택기를 현재 DB로 채운다. 연성소 탭을 열 때마다 호출한다. */
export function refreshCustomThemeOptions(archetypes = []) {
  const sel = document.getElementById('custom-theme-select');
  if (!sel) return;

  const keep = sel.value;
  sel.innerHTML =
    `<option value="">— AI가 결정 (기본) —</option>` +
    `<option value="__new__">✏️ 직접 입력 / 새 카드군 창작</option>` +
    archetypes
      .filter(a => a && a.id && a.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
      .map(a => {
        const kw = a.keyword ? ` (${a.keyword})` : '';
        const els = (a.elements || [a.element]).filter(Boolean).join('/');
        return `<option value="${a.id}">${a.name}${kw}${els ? ' · ' + els : ''}</option>`;
      }).join('');

  // 선택이 남아 있으면 유지 (렌더 때마다 초기화되면 성가시다)
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
}

/**
 * 선택 변경 처리.
 * 기존 카드군을 고르면 이름은 채우고 잠근다 (오타로 새 카드군이 생기는 걸 막는다).
 *
 * 🔑 키워드는 잠그지 않는다.
 *    예전에는 이름과 함께 readOnly로 묶어서 "카드군을 고르면 키워드도 그 카드군 것"이
 *    강제됐다. 그런데 키워드는 꼭 카드군에 종속적인 게 아니다 — 같은 카드군 안에서도
 *    카드마다 다른 낱말을 축으로 삼고 싶을 수 있다.
 *    소속 판정의 권위는 어차피 `themeId`이므로(DECISIONS #17), 키워드를 바꿔도
 *    소속은 흔들리지 않는다. 그래서 **기본값만 채워주고 편집은 열어둔다.**
 */
export function onCustomThemePick(archetypes = []) {
  const sel = document.getElementById('custom-theme-select');
  const nameEl = document.getElementById('custom-theme-name');
  const kwEl = document.getElementById('custom-theme-keyword');
  if (!sel || !nameEl || !kwEl) return;

  // 키워드 칸은 어떤 선택에서도 항상 편집 가능하다
  kwEl.readOnly = false;
  kwEl.classList.remove('opacity-60');

  const val = sel.value;

  if (val === '' ) {                    // AI 결정 — 비운다
    nameEl.value = ''; kwEl.value = '';
    nameEl.readOnly = false;
    nameEl.classList.remove('opacity-60');
    return;
  }
  if (val === '__new__') {              // 자유 창작 — 직접 쓰게 둔다
    // 🐛 수정: 직전에 고른 카드군의 이름·키워드가 채워진 채 "새 카드군 창작"으로 넘어왔다.
    //    그대로 생성하면 새 카드군이 아니라 그 카드군에 흡수된다. **자동으로 채운 값만**
    //    비운다 — 유저가 직접 쓴 글은 남긴다.
    if (archetypes.some(a => a && a.name === nameEl.value)) nameEl.value = '';
    if (archetypes.some(a => a && a.keyword && a.keyword === kwEl.value)) kwEl.value = '';
    nameEl.readOnly = false;
    nameEl.classList.remove('opacity-60');
    nameEl.focus();
    return;
  }

  const t = archetypes.find(a => a && a.id === val);
  if (!t) return;
  nameEl.value = t.name || '';
  // 카드군 키워드는 **기본값**이다. 유저가 덮어쓰면 그 값이 그대로 쓰인다.
  // (onchange는 선택이 실제로 바뀔 때만 오므로 같은 카드군을 다시 골라 덮어쓸 일은 없다)
  kwEl.value = t.keyword || '';
  // 고른 카드군의 **이름**만 수정 불가 — 이름을 손대면 새 카드군이 만들어진다
  nameEl.readOnly = true;
  nameEl.classList.add('opacity-60');
}

/** 지금 선택된 기존 카드군의 id (자유 입력이면 null) */
export function selectedThemeId() {
  const sel = document.getElementById('custom-theme-select');
  if (!sel) return null;
  const v = sel.value;
  return (v && v !== '__new__') ? v : null;
}
