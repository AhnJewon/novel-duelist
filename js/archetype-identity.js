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

// ── 진영 시점 ────────────────────────────────────────────────
// 발동조건과 증가방식은 "나"와 "상대"를 본다. 보스가 쓸 때는 그 둘이 뒤집힌다.
//
// 🐛 예전에는 전부 game.playerHp / game.currentBoss를 직접 읽었다. 그래서
//    보스에게 조건을 걸 수가 없었고(플레이어 기준으로 판정됐다),
//    runArchetypeCombo가 `side === 'player'`일 때만 검사하는 비대칭이 남았다.
//    이제 시점을 뒤집을 수 있으므로 **양 진영이 같은 규칙**을 쓴다.
//
// ⚠️ game 필드를 직접 읽지 말고 이 뷰를 쓰세요. 직접 읽으면 보스 경로와
//    PvP 거울 경로에서 조용히 틀린 진영을 봅니다.

/** 손패 상한. handRich를 진영별 비율로 판정하는 데 쓴다. */
export const HAND_CAP = { player: 7, boss: 5 };

function viewOf(ctx, who) {
  const g = (ctx && ctx.game) || {};
  const mine = (ctx && ctx.side) === 'boss' ? 'boss' : 'player';
  const key = who === 'self' ? mine : (mine === 'boss' ? 'player' : 'boss');
  if (key === 'boss') {
    const b = g.currentBoss || {};
    return {
      hp: b.currentHp || 0, maxHp: b.maxHp || 0, shield: b.shield || 0,
      hand: g.bossHand || [], minions: g.bossMinions || [], handCap: HAND_CAP.boss
    };
  }
  return {
    hp: g.playerHp || 0, maxHp: g.playerMaxHp || 0, shield: g.playerMaxShield || 0,
    hand: g.playerHand || [], minions: g.playerMinions || [], handCap: HAND_CAP.player
  };
}

/** 연계를 발동한 진영 자신의 상태 */
export function selfView(ctx) { return viewOf(ctx, 'self'); }
/** 그 상대 진영의 상태 */
export function foeView(ctx) { return viewOf(ctx, 'foe'); }

/** 턴 수. 없으면 0 — NaN이 위력 계산으로 새어 나가면 안 된다. */
function turnOf(ctx) {
  const t = ctx && ctx.game && ctx.game.turnCount;
  return Number.isFinite(t) ? t : 0;
}

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
    test: (ctx) => { const s = selfView(ctx); return s.maxHp > 0 && s.hp <= s.maxHp * 0.5; }
  },
  bossShielded: {
    // ⚠️ 키 이름은 세이브 호환 때문에 남긴다. 뜻은 "상대"다 — 보스가 써도 성립한다.
    label: '상대 방어막 보유 시',
    desc: '상대가 방어막을 두르고 있을 때만',
    test: (ctx) => foeView(ctx).shield > 0
  },
  handRich: {
    // 손패 상한이 진영마다 다르다(플레이어 7 / 보스 5). 고정 5장으로 재면
    // 보스는 영원히 만족할 수 없다 — **비율**로 재야 같은 조건이 된다.
    label: '손패가 두둑할 때',
    desc: '손패가 상한의 70% 이상일 때만',
    test: (ctx) => { const s = selfView(ctx); return s.hand.length >= Math.ceil(s.handCap * 0.7); }
  },
  lateGame: {
    label: '5턴 이후',
    desc: '장기전에서 진가를 발휘',
    test: (ctx) => turnOf(ctx) >= 5
  },
  earlyGame: {
    label: '3턴 이내',
    desc: '초반 속공 특화',
    test: (ctx) => { const t = turnOf(ctx); return t > 0 && t <= 3; }
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
    value: (base, ctx) => base + Math.min(12, turnOf(ctx) * 2)
  },
  perHand: {
    label: '손패 수 비례',
    desc: '손패를 아낄수록 강해진다',
    value: (base, ctx) => base + selfView(ctx).hand.length
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

// ============================================================
// 🎭 플레이스타일 — 카드군의 "어떻게 이기는가"
// ------------------------------------------------------------
// 기존의 속성 정책과 고유 연계는 **카드 한 장**의 성격만 정했다.
// 그래서 같은 카드군 안에서도 1마나 잡졸과 6마나 거신이 뒤섞이고,
// 건축물·함정·마법은 카드군과 무관한 범용 효과를 달고 나왔다.
//
// 플레이스타일은 카드군 전체의 **덱 설계도**다.
// LLM에게 "이 카드군은 저코스트로 몰아치는 전개형"이라고 알려주면
// 소환수뿐 아니라 건축물·함정·마법도 그 방향으로 맞춰 만든다.
//
// ⚠️ 유저에게는 노출하지 않는다. 카드 텍스트에 "이 카드군은 전개형"이라고
//    적히면 설정이 새어 나온 것처럼 보인다. LLM 가이드 전용이다.
// ============================================================

export const ARCHETYPE_PLAYSTYLES = {
  turtle: {
    label: '방어 버티기',
    short: '높은 체력과 방어막으로 버티다가 상대가 지쳤을 때 역습한다',
    costBias: '2~4 마나 중심. 스탯은 공격력보다 **체력/방어력**에 몰아준다',
    favor: ['shield', 'damageReduction', 'heal', 'attackDown'],
    avoid: ['multiHit', 'executeThreshold', 'drawCards'],
    typeGuide: {
      unit:      '공격력은 낮고 체력이 두껍다. 전장에 오래 남아 벽 노릇을 한다',
      spell:     '방어막을 두르거나 체력을 회복한다. 피해 주문은 드물다',
      structure: '매 턴 방어막을 쌓거나 본체를 회복한다. 이 카드군의 핵심이다',
      trap:      '받는 피해를 줄이거나 공격을 무디게 한다'
    }
  },

  swarm: {
    label: '저코스트 전개',
    short: '1~3 마나 카드를 한 턴에 여러 장 뿌려 수적 우위로 밀어붙인다',
    costBias: '1~3 마나가 대부분. **4 마나를 넘는 카드는 예외적**이어야 한다',
    favor: ['drawCards', 'manaGain', 'damage', 'multiHit'],
    avoid: ['invulnerableTurns', 'passiveEffect'],
    typeGuide: {
      unit:      '싸고 가볍다. 한 장의 위력보다 여러 장을 까는 속도가 중요하다',
      spell:     '즉발이고 싸다. 드로우나 마나 수급을 겸하는 경우가 많다',
      structure: '드물다. 있다면 마나나 카드를 공급해 전개 속도를 올린다',
      trap:      '싸고 즉각적이다. 무거운 조건부 함정은 이 카드군에 안 맞는다'
    }
  },

  control: {
    label: '고코스트 장악',
    short: '한 장 한 장이 무겁고 강하다. 오래 유지하며 후반에 압도한다',
    costBias: '4~6 마나 중심. **싼 카드는 시간을 버는 용도**로만 넣는다',
    favor: ['isAoeSpell', 'silence', 'heal', 'shield', 'damage'],
    avoid: ['manaGain'],
    typeGuide: {
      unit:      '수가 적은 대신 스탯과 효과가 크다. 쉽게 죽지 않아야 한다',
      spell:     '광역 제거나 판을 뒤집는 큰 효과. 비싸도 된다',
      structure: '오래 살아남아 매 턴 이득을 쌓는다. 내구도가 높다',
      trap:      '상대의 결정적 한 수를 되받아친다. 비싸고 강하다'
    }
  },

  ace: {
    label: '에이스 서포트',
    short: '강력한 소환수 하나를 마법·함정·건축물이 둘러싸고 지켜낸다',
    costBias: '에이스는 5~6 마나, 서포트 카드는 1~3 마나로 가볍게',
    favor: ['shield', 'heal', 'damageReduction', 'attackDown'],
    avoid: ['isAoeSpell'],
    typeGuide: {
      unit:      '**소수의 에이스**는 크고 강하게. 나머지는 에이스를 지키는 호위다',
      spell:     '아군을 강화하거나 지킨다 (targetSide를 ally로). 적을 때리는 건 부차적',
      structure: '전장에 있는 동안 아군을 계속 보조한다',
      trap:      '에이스가 노려질 때 대신 막아준다'
    }
  },

  burn: {
    label: '본체 직격',
    short: '상대 소환수를 무시하고 본체 체력을 직접 태워 끝낸다',
    costBias: '1~4 마나. 피해 효율이 최우선이다',
    favor: ['damage', 'multiHit', 'critChance', 'pierceShield', 'executeThreshold'],
    avoid: ['damageReduction', 'heal'],
    typeGuide: {
      unit:      '체력은 얇아도 좋다. 공격력과 연타가 핵심이다',
      spell:     '이 카드군의 주력. 본체를 직접 노린다 (hpTarget: body)',
      structure: '드물다. 있다면 매 턴 상대를 갉아먹는다',
      trap:      '되받아치며 본체에 피해를 꽂는다'
    }
  },

  toolbox: {
    label: '대응 함정',
    short: '상대의 수를 읽고 되받아친다. 상황마다 다른 해답을 꺼낸다',
    costBias: '2~4 마나. 상황 대응이라 극단적인 커브를 만들지 않는다',
    favor: ['trapTrigger', 'silence', 'drawCards', 'attackDown', 'damageReduction'],
    avoid: ['invulnerableTurns'],
    typeGuide: {
      unit:      '평범한 스탯에 유틸리티 효과를 단다. 몸으로 이기지 않는다',
      spell:     '상대 효과를 지우거나 카드를 찾아온다',
      structure: '함정과 대응 카드를 뒷받침한다',
      trap:      '**이 카드군의 주력.** 발동 조건이 다양하고 결정적이다'
    }
  }
};

export const DEFAULT_PLAYSTYLE = 'control';

export function normalizePlaystyle(p) {
  return ARCHETYPE_PLAYSTYLES[p] ? p : null;
}

/**
 * 기존 카드군에 플레이스타일을 **추론해서** 채운다.
 *
 * 플레이스타일 필드가 생기기 전에 만들어진 카드군은 값이 없다.
 * 전부 기본값으로 밀면 모든 카드군이 똑같아지므로,
 * 이미 가진 연계·설명에서 성격을 읽어낸다.
 */
export function inferPlaystyle(theme = {}) {
  const known = normalizePlaystyle(theme.playstyle);
  if (known) return known;

  const text = `${theme.name || ''} ${theme.description || ''} ${theme.keyword || ''}`;
  const action = theme.comboAction || '';

  // 연계 액션이 가장 강한 신호다
  // ⚠️ 여기 문자열은 archetype-combos.js의 ARCHETYPE_COMBO_ACTIONS 키와 **정확히** 같아야 한다.
  //    (한 번 'guard'/'summon'/'negate' 같은 없는 이름을 써서 전부 기본값으로 떨어진 적이 있다)
  const BY_ACTION = {
    shieldHeal: 'turtle',      archetypeGuard: 'turtle',
    specialSummon: 'swarm',    draw: 'swarm',          doubleCast: 'swarm',
    chainDamage: 'burn',       shieldBreak: 'burn',
    freeze: 'toolbox',         handDisrupt: 'toolbox', search: 'toolbox',
    // 마력 공명은 램프다 — 마나를 불려 무거운 카드를 빨리 꺼내는 쪽이 자연스럽다
    manaCharge: 'control',     archetypeSalvage: 'control',
    archetypeRally: 'ace',     sacrificeStrike: 'ace'
  };
  if (BY_ACTION[action]) return BY_ACTION[action];

  // 그다음은 이름·설명의 어휘
  if (/방어|수호|요새|성벽|철벽|방벽|가호|성역/.test(text)) return 'turtle';
  if (/군단|무리|전개|속공|돌격|떼|병사|잡졸/.test(text)) return 'swarm';
  if (/폭격|화염|작열|번개|일격|처형|섬멸/.test(text)) return 'burn';
  if (/함정|계략|매복|봉인|역습|반격/.test(text)) return 'toolbox';
  if (/왕|주군|영웅|에이스|계승|용사/.test(text)) return 'ace';

  return DEFAULT_PLAYSTYLE;
}

/** LLM 프롬프트에 실을 한 줄 요약 (카드군 목록용) */
export function playstyleTag(theme = {}) {
  const key = inferPlaystyle(theme);
  return ARCHETYPE_PLAYSTYLES[key].label;
}

/**
 * LLM에게 줄 **전체 설계 가이드**.
 * 카드군을 지정해서 카드를 만들 때 프롬프트에 통째로 싣는다.
 *
 * @param cardType 이 카드의 타입. 해당 타입 지침을 강조해서 보여준다.
 */
export function playstyleGuide(theme = {}, cardType = null) {
  const key = inferPlaystyle(theme);
  const p = ARCHETYPE_PLAYSTYLES[key];
  const lines = [
    `🎭 이 카드군의 플레이스타일: **${p.label}**`,
    `   ${p.short}`,
    `   마나 커브: ${p.costBias}`,
    `   즐겨 쓰는 효과: ${p.favor.join(', ')}`,
    `   피해야 할 효과: ${p.avoid.join(', ')}`
  ];
  if (cardType && p.typeGuide[cardType]) {
    lines.push(`   ▶ 지금 만드는 ${cardType} 카드는: ${p.typeGuide[cardType]}`);
  } else {
    lines.push('   타입별 지침:');
    for (const [t, g] of Object.entries(p.typeGuide)) lines.push(`     - ${t}: ${g}`);
  }
  lines.push('   ⚠️ 이 설정을 카드 이름이나 설명문에 직접 적지 마라. 효과로만 드러내라.');
  return lines.join('\n');
}

/** LLM이 새 카드군을 만들 때 고를 수 있는 선택지 목록 */
export function playstyleOptionsForPrompt() {
  return Object.entries(ARCHETYPE_PLAYSTYLES)
    .map(([k, p]) => `  - "${k}" (${p.label}): ${p.short}`)
    .join('\n');
}
