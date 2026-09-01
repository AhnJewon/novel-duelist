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
    rarity: v('custom-rarity'),
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
  if (o.themeKeyword) lines.push(`- 카드군 키워드는 "${o.themeKeyword}"로 할 것`);
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
 * 기존 카드군을 고르면 이름·키워드를 채우고 잠근다 (오타로 새 카드군이 생기는 걸 막는다).
 */
export function onCustomThemePick(archetypes = []) {
  const sel = document.getElementById('custom-theme-select');
  const nameEl = document.getElementById('custom-theme-name');
  const kwEl = document.getElementById('custom-theme-keyword');
  if (!sel || !nameEl || !kwEl) return;

  const val = sel.value;

  if (val === '' ) {                    // AI 결정 — 비운다
    nameEl.value = ''; kwEl.value = '';
    nameEl.readOnly = false; kwEl.readOnly = false;
    nameEl.classList.remove('opacity-60');
    kwEl.classList.remove('opacity-60');
    return;
  }
  if (val === '__new__') {              // 자유 창작 — 직접 쓰게 둔다
    nameEl.readOnly = false; kwEl.readOnly = false;
    nameEl.classList.remove('opacity-60');
    kwEl.classList.remove('opacity-60');
    nameEl.focus();
    return;
  }

  const t = archetypes.find(a => a && a.id === val);
  if (!t) return;
  nameEl.value = t.name || '';
  kwEl.value = t.keyword || '';
  // 고른 카드군은 수정 불가 — 이름을 손대면 새 카드군이 만들어진다
  nameEl.readOnly = true; kwEl.readOnly = true;
  nameEl.classList.add('opacity-60');
  kwEl.classList.add('opacity-60');
}

/** 지금 선택된 기존 카드군의 id (자유 입력이면 null) */
export function selectedThemeId() {
  const sel = document.getElementById('custom-theme-select');
  if (!sel) return null;
  const v = sel.value;
  return (v && v !== '__new__') ? v : null;
}
