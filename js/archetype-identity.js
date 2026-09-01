// archetype-identity.js - 카드군 고유 정체성 (속성 정책 + 고유 연계)
//
// 문제 1. 카드군과 카드 속성이 따로 놀았다.
//         "홍련(화염) 카드군"에 물 속성 카드가 들어가도 아무도 막지 않았다.
// 문제 2. 연계가 8종 공통 액션뿐이라 카드군마다 개성이 없었다.
//         "이 카드군은 서치 카드군"이라는 것 외에 할 말이 없었다.
//
// 해결. 카드군에 두 축을 더한다.
//   - 속성 정책: 단일 / 이중 / 다속성 (실제 TCG처럼)
//   - 고유 연계: 액션 × 발동조건 × 증가방식 조합으로 카드군마다 다른 느낌

// ============================================================
// 🎨 속성 정책
// ============================================================

/** 서로 상극인 속성 쌍. 단일·이중 카드군은 이 조합을 가질 수 없다. */
export const ELEMENT_OPPOSITES = {
  fire: 'water',
  water: 'fire',
  lightning: 'nature',
  nature: 'lightning',
  holy: 'dark',
  dark: 'holy'
};

export const ELEMENT_POLICIES = {
  mono: {
    label: '단일 속성',
    maxElements: 1,
    allowOpposites: false,
    desc: '한 속성으로만 구성된다. 정체성이 가장 뚜렷하다.'
  },
  dual: {
    label: '이중 속성',
    maxElements: 2,
    allowOpposites: false,
    desc: '두 속성을 오간다. 단 상극 조합(화염/물 등)은 불가.'
  },
  multi: {
    label: '다속성',
    maxElements: 6,
    allowOpposites: true,
    desc: '여러 속성을 아우른다. 엘리멘틀 히어로처럼 속성 전환이 컨셉인 카드군.'
  }
};

/** 카드군이 실제로 허용하는 속성 목록 */
export function getAllowedElements(theme) {
  if (!theme) return [];
  if (Array.isArray(theme.elements) && theme.elements.length > 0) return theme.elements;
  return theme.element ? [theme.element] : [];
}

export function isElementAllowed(theme, element) {
  if (!theme || !element) return true;
  const allowed = getAllowedElements(theme);
  return allowed.length === 0 || allowed.includes(element);
}

/**
 * 카드군의 속성 구성을 정책에 맞게 교정한다.
 * 상극 조합이 들어오면 대표 속성만 남긴다.
 */
export function sanitizeElementPolicy(theme) {
  const policy = ELEMENT_POLICIES[theme.elementPolicy] ? theme.elementPolicy : 'mono';
  const spec = ELEMENT_POLICIES[policy];

  let elements = Array.isArray(theme.elements) && theme.elements.length > 0
    ? [...new Set(theme.elements)]
    : (theme.element ? [theme.element] : ['fire']);

  // 개수 상한
  elements = elements.slice(0, spec.maxElements);

  // 상극 조합 제거 (다속성 카드군은 예외)
  if (!spec.allowOpposites) {
    const kept = [];
    for (const el of elements) {
      const opposite = ELEMENT_OPPOSITES[el];
      if (opposite && kept.includes(opposite)) continue; // 상극이 이미 있으면 버린다
      kept.push(el);
    }
    elements = kept;
  }

  if (elements.length === 0) elements = [theme.element || 'fire'];

  return {
    elementPolicy: policy,
    elements,
    element: elements[0]   // 대표 속성 (기존 필드 호환)
  };
}

/**
 * 카드 속성을 카드군 정책에 맞게 교정한다.
 * @returns { element, changed, reason }
 */
export function coerceCardElement(theme, requestedElement) {
  if (!theme) return { element: requestedElement, changed: false };
  const allowed = getAllowedElements(theme);
  if (allowed.length === 0 || allowed.includes(requestedElement)) {
    return { element: requestedElement, changed: false };
  }
  return {
    element: allowed[0],
    changed: true,
    reason: `[${theme.name}]은(는) ${allowed.join('/')} 카드군이라 ${requestedElement}를 허용하지 않습니다`
  };
}

// ============================================================
// ⚡ 카드군 고유 연계 = 액션 × 발동조건 × 증가방식
// ============================================================
//
// 액션(8종)만으로는 카드군이 8가지 맛밖에 안 난다.
// 여기에 "언제 터지는가"와 "얼마나 세지는가"를 더하면
// 같은 search 카드군이라도 완전히 다르게 느껴진다.
//
//   홍련: 필드에 같은 카드군 2장 이상일 때만 폭발 (onArchetypePair × perAlly)
//   심연: 내 체력이 절반 이하일 때 강해짐        (onLowHp × perTurn)
//
// 조건이 안 맞으면 콤보는 발동하지 않는다 — 이게 덱 빌딩의 재미를 만든다.

export const COMBO_TRIGGERS = {
  always: {
    label: '항상',
    desc: '카드를 낼 때마다 발동',
    test: () => true
  },
  archetypePair: {
    label: '같은 카드군 2장 이상',
    desc: '필드에 같은 카드군 아군이 있을 때만',
    test: ({ allies }) => allies >= 1
  },
  lowHp: {
    label: '체력 절반 이하',
    desc: '내 체력이 50% 이하로 떨어졌을 때만',
    test: ({ game }) => game.playerHp <= game.playerMaxHp * 0.5
  },
  bossShielded: {
    label: '보스 방어막 보유 시',
    desc: '보스가 방어막을 두르고 있을 때만',
    test: ({ game }) => (game.currentBoss && game.currentBoss.shield > 0)
  },
  handRich: {
    label: '손패 5장 이상',
    desc: '손패가 두둑할 때만',
    test: ({ game }) => (game.playerHand || []).length >= 5
  },
  lateGame: {
    label: '5턴 이후',
    desc: '장기전에서 진가를 발휘',
    test: ({ game }) => game.turnCount >= 5
  },
  earlyGame: {
    label: '3턴 이내',
    desc: '초반 속공 특화',
    test: ({ game }) => game.turnCount <= 3
  }
};

export const COMBO_SCALINGS = {
  flat: {
    label: '고정',
    desc: '항상 같은 위력',
    value: (base) => base
  },
  perAlly: {
    label: '같은 카드군 수 비례',
    desc: '같은 카드군을 많이 깔수록 강해진다',
    value: (base, { allies }) => base + allies * Math.max(2, Math.round(base * 0.4))
  },
  perTurn: {
    label: '턴 수 비례',
    desc: '길어질수록 강해진다',
    value: (base, { game }) => base + Math.min(12, game.turnCount * 2)
  },
  perHand: {
    label: '손패 수 비례',
    desc: '손패를 아낄수록 강해진다',
    value: (base, { game }) => base + (game.playerHand || []).length
  }
};

export function normalizeTrigger(t) {
  return COMBO_TRIGGERS[t] ? t : 'always';
}

export function normalizeScaling(s) {
  return COMBO_SCALINGS[s] ? s : 'flat';
}

/** 발동 조건 판정 */
export function checkTrigger(theme, ctx) {
  const key = normalizeTrigger(theme.comboTrigger);
  return { key, spec: COMBO_TRIGGERS[key], passed: COMBO_TRIGGERS[key].test(ctx) };
}

/** 위력 계산 */
export function applyScaling(theme, base, ctx) {
  const key = normalizeScaling(theme.comboScaling);
  return Math.max(1, Math.round(COMBO_SCALINGS[key].value(base, ctx)));
}

/** 카드군 연계를 사람이 읽는 문장으로 */
export function describeCombo(theme, actionLabel = '연계') {
  const trig = COMBO_TRIGGERS[normalizeTrigger(theme.comboTrigger)];
  const scale = COMBO_SCALINGS[normalizeScaling(theme.comboScaling)];
  const cond = trig.label === '항상' ? '카드를 낼 때' : `${trig.label}일 때`;
  const amount = scale.label === '고정' ? '' : ` (${scale.label})`;
  return `${cond} ${actionLabel} 발동${amount}`;
}
// ============================================================
// 🎯 연계 대상 범위 (Combo Scope)
// ------------------------------------------------------------
// 예전에는 연계가 **같은 카드군**에만 반응했다. 그래서 범용 카드는
// 어떤 연계에도 걸리지 않아 덱에서 겉돌았다.
//
// 이제 카드군이 "무엇에 반응하는가"를 고를 수 있다.
//   archetype — 같은 카드군 (기존)
//   element   — 같은 속성       → 속성 덱이 성립한다
//   cardType  — 같은 카드 타입   → 소환수 덱 / 주문 덱 / 함정 덱이 성립한다
//   any       — 아무 카드나      → 범용 카드도 연계에 기여한다
//
// 결과: 범용 카드의 가치가 올라간다. "홍련"이 아니어도 fire 속성이면
//       화염 덱의 연계를 터뜨릴 수 있다.
// ============================================================

export const COMBO_SCOPES = {
  archetype: {
    label: '같은 카드군',
    desc: '카드군 정체성이 가장 뚜렷하다. 범용 카드는 기여하지 못한다.',
    match: (card, theme) => {
      if (!card || !theme) return false;
      if (card.themeId && card.themeId === theme.id) return true;
      if (card.themeName && card.themeName === theme.name) return true;
      if (!card.themeId && theme.keyword && theme.keyword.length >= 2 && card.name && card.name.includes(theme.keyword)) return true;
      return false;
    }
  },
  element: {
    label: '같은 속성',
    desc: '속성만 맞으면 카드군이 달라도 기여한다. 속성 덱이 성립한다.',
    match: (card, theme) => {
      if (!card || !theme) return false;
      const allowed = (Array.isArray(theme.elements) && theme.elements.length > 0)
        ? theme.elements : [theme.element];
      return allowed.includes(card.element);
    }
  },
  cardType: {
    label: '같은 카드 타입',
    desc: '소환수/주문/성물/함정 중 하나에만 반응한다. 타입 덱이 성립한다.',
    match: (card, theme) => {
      if (!card || !theme) return false;
      const want = theme.comboScopeValue || 'unit';
      return (card.cardType || 'unit') === want;
    }
  },
  any: {
    label: '모든 아군 카드',
    desc: '무엇이든 기여한다. 범용 카드 중심 덱에 어울린다. 대신 위력이 낮다.',
    match: () => true
  }
};

export function normalizeComboScope(s) {
  return COMBO_SCOPES[s] ? s : 'archetype';
}

/**
 * 이 카드가 해당 카드군의 연계 대상에 포함되는가.
 * 기존 belongsToTheme를 대체한다 — scope에 따라 판정 기준이 달라진다.
 */
export function matchesScope(card, theme) {
  const scope = normalizeComboScope(theme && theme.comboScope);
  return COMBO_SCOPES[scope].match(card, theme);
}

/** 범위가 넓을수록 위력을 낮춘다 — 조건이 쉬운 만큼 값을 치른다 */
export const SCOPE_POWER_MULT = {
  archetype: 1.0,   // 가장 어려운 조건 → 위력 그대로
  element: 0.8,
  cardType: 0.8,
  any: 0.6          // 아무 카드나 → 위력 크게 감소
};

export function scopeAdjustedBase(theme, base) {
  const scope = normalizeComboScope(theme && theme.comboScope);
  return Math.max(1, Math.round(base * (SCOPE_POWER_MULT[scope] || 1)));
}

/** 사람이 읽는 범위 설명 */
export function describeScope(theme) {
  const scope = normalizeComboScope(theme && theme.comboScope);
  const spec = COMBO_SCOPES[scope];
  if (scope === 'cardType') {
    const t = theme.comboScopeValue || 'unit';
    const names = { unit: '소환수', spell: '주문', structure: '성물', trap: '함정' };
    return `같은 ${names[t] || t} 카드`;
  }
  return spec.label;
}
