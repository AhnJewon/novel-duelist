// card-design-roll.js - 카드 **성향**과 **함정 발동조건**을 코드가 먼저 굴린다 (DECISIONS #102)
//
// 왜 코드가 굴리나: 4B 모델에게 "다양하게 만들어라"는 말은 통하지 않는다. 늘 같은 것을 고른다 —
//   · 효과: 소환수·주문 가릴 것 없이 **적 피해**를 단다 (실측: 보관함 대부분이 damage 카드, 바닐라 0장에 가깝다)
//   · 함정: 발동조건을 안 적거나 늘 foePlaysUnit — sanitize 기본값도 foePlaysUnit이라 전부 "상대가 소환수를 낼 때"였다
// 그래서 카드팩 #93(새 카드군 슬롯)처럼 **슬롯마다 코드가 하나를 굴려 지시하고, 응답 뒤 코드로 강제**한다.
// 카드군·속성·등급도 이미 그렇게 정한다 — 성향과 함정 조건만 LLM 취향에 맡겨져 있었다.
//
// ⚠️ 여기서는 효과를 **지어내지 않는다**(규칙 35). 성향에 안 맞는 효과를 **빼고**, 소환수가 빈손이면 바닐라다.
//    주문·함정은 효과가 전부라 빈손이면 성향에 맞는 **최소 1개**(방어막/드로우/피해)만 굴려 넣는다 — 호출부의 몫.

import { TRAP_TRIGGERS } from './trap-system.js';

/** 효과 성향 — 타입별 가중치. 소환수는 바닐라·방어·유틸을 합쳐 70%로 "소환수 = 몸"이 되게 한다. */
export const EFFECT_ROLE_WEIGHTS = {
  unit:      { vanilla: 25, defensive: 25, utility: 20, offensive: 30 },
  spell:     { defensive: 25, utility: 30, offensive: 45 },
  trap:      { defensive: 35, utility: 25, offensive: 40 },
  structure: null   // 건축물은 패시브가 정체성 — 성향을 굴리지 않는다
};

/** 성향별 허용 효과 필드. 목록에 없는 효과는 응답에서 뺀다. */
export const ROLE_ALLOWED_FIELDS = {
  defensive: new Set(['shield', 'heal', 'damageReduction', 'invulnerableTurns', 'maxHpGain']),
  utility:   new Set(['drawCards', 'manaGain', 'searchDeck', 'summonToken', 'doubleCastNext', 'shield']),
  offensive: null   // 제한 없음
};

const OFFENSIVE_FIELDS = ['damage', 'multiHit', 'destroy', 'attackDown', 'silence', 'lifestealPercent', 'critChance',
  'executeThreshold', 'pierceShield', 'directAttack', 'isAoeSpell'];
const ALL_EFFECT_FIELDS = [...OFFENSIVE_FIELDS, 'shield', 'heal', 'damageReduction', 'invulnerableTurns', 'maxHpGain',
  'drawCards', 'manaGain', 'searchDeck', 'summonToken', 'doubleCastNext', 'discardCard'];

function weightedPick(weights, rng) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
  return entries[entries.length - 1][0];
}

/** 이 카드의 효과 성향. 건축물은 null. (이미지·기획 코드라 Math.random을 써도 락스텝과 무관하다) */
export function rollEffectRole(cardType = 'unit', rng = Math.random) {
  const w = EFFECT_ROLE_WEIGHTS[cardType] || EFFECT_ROLE_WEIGHTS.unit;
  return w ? weightedPick(w, rng) : null;
}

/** 성향을 LLM에게 지시하는 문장. 프롬프트 끝에 붙인다. */
export function effectRoleDirective(role, cardType = 'unit') {
  if (!role) return '';
  const head = `\n\n🎭 이 카드의 효과 성향은 **${role}**이다 (시스템이 정했다 — 반드시 따를 것):\n`;
  if (role === 'vanilla') {
    return head +
      `- 효과가 **없는** 소환수다. "isVanilla": true, 효과 수치는 전부 0/생략. 대신 스탯을 등급 상한 가까이 주고,\n` +
      `  "flavorText"에 세계관 한 줄(40자 이내)을 쓴다. 효과처럼 읽히면 안 된다.`;
  }
  if (role === 'defensive') {
    return head +
      `- 방어·회복 계열만: shield / heal / damageReduction / invulnerableTurns / maxHpGain 중 1~2개.\n` +
      `- ❌ damage·multiHit·destroy·attackDown·상태이상(statusEffect)은 넣지 않는다. 피해가 있으면 시스템이 지운다.\n` +
      `- targetSide는 heal이 있으면 "ally", 아니면 "self".`;
  }
  if (role === 'utility') {
    return head +
      `- 자원·전개 계열만: drawCards / manaGain / searchDeck / summonToken / doubleCastNext 중 1~2개 (+작은 shield 가능).\n` +
      `- ❌ damage·상태이상·destroy는 넣지 않는다. 피해가 있으면 시스템이 지운다.\n` +
      `- targetSide는 "self".`;
  }
  // offensive
  return head +
    `- 공격 계열: damage(+multiHit/상태이상/destroy/attackDown 중 0~1개). ${cardType === 'unit' ? '소환수는 효과 1개로 절제.' : ''}\n` +
    `- targetSide는 "foe".`;
}

/**
 * 성향에 안 맞는 효과를 **뺀다** (지어내지 않는다). 응답 뒤 코드 강제.
 * @returns {{ skill, removed: string[], hasEffect: boolean }}
 */
export function enforceEffectRole(skill, role) {
  const s = { ...(skill || {}) };
  if (s.statusEffect) s.statusEffect = { ...s.statusEffect };
  const removed = [];
  if (!role) return { skill: s, removed, hasEffect: hasAnyEffect(s) };

  if (role === 'vanilla') {
    for (const k of ALL_EFFECT_FIELDS) {
      if (s[k] && s[k] !== 0 && s[k] !== false) removed.push(k);
      if (k === 'multiHit') s[k] = 1; else if (typeof s[k] === 'boolean') s[k] = false; else if (s[k] !== undefined) s[k] = 0;
    }
    if (s.statusEffect && s.statusEffect.type && s.statusEffect.type !== 'none') removed.push('statusEffect');
    s.statusEffect = { type: 'none', duration: 0, value: 0 };
    s.isVanilla = true;
    return { skill: s, removed, hasEffect: false };
  }

  const allowed = ROLE_ALLOWED_FIELDS[role];
  if (allowed) {
    for (const k of ALL_EFFECT_FIELDS) {
      if (allowed.has(k)) continue;
      const on = k === 'multiHit' ? (s[k] || 1) > 1 : (typeof s[k] === 'boolean' ? s[k] : (s[k] || 0) > 0);
      if (on) removed.push(k);
      if (k === 'multiHit') s[k] = 1; else if (typeof s[k] === 'boolean') s[k] = false; else if (s[k] !== undefined) s[k] = 0;
    }
    // 상태이상은 전부 공격 계열이다
    if (s.statusEffect && s.statusEffect.type && s.statusEffect.type !== 'none') { removed.push('statusEffect'); s.statusEffect = { type: 'none', duration: 0, value: 0 }; }
    if (s.isVanilla) s.isVanilla = false;
  }
  return { skill: s, removed, hasEffect: hasAnyEffect(s) };
}

export function hasAnyEffect(s = {}) {
  return ALL_EFFECT_FIELDS.some(k => k === 'multiHit' ? (s[k] || 1) > 1 : (typeof s[k] === 'boolean' ? s[k] : (s[k] || 0) > 0))
    || !!(s.statusEffect && s.statusEffect.type && s.statusEffect.type !== 'none')
    || !!s.passiveEffect;
}

// ── 🪤 함정 발동조건 ─────────────────────────────────────────
const TRAP_TRIGGER_WEIGHTS = {
  foePlaysUnit: 18, foePlaysSpell: 14, foePlaysStructure: 7, foeTrapActivates: 5,
  foePlaysElement: 12, foePlaysArchetype: 8, foePlaysKeyword: 8, foeAttacks: 15, selfLowHp: 8, foeShielded: 5
};
const ELEMENTS = ['fire', 'water', 'lightning', 'holy', 'dark', 'nature'];
const KEYWORD_CONDITIONS = ['pierceShield', 'doubleCastNext', 'statusEffect', 'multiHit', 'drawCards', 'directAttack'];

/**
 * 함정 하나의 발동조건을 굴린다. 조건값이 필요한 종류는 문맥에서 채운다.
 * @param ctx { element, themeName, themeKeyword } — 카드 속성·카드군(있으면)
 * @returns {{ trapTrigger, condition: object|undefined, label }}
 */
export function rollTrapTrigger(ctx = {}, rng = Math.random) {
  const key = weightedPick(TRAP_TRIGGER_WEIGHTS, rng);
  const spec = TRAP_TRIGGERS[key];
  let condition;
  if (spec && spec.needs === 'element') {
    // 상대 속성 — 내 속성과 다른 것을 고른다 (같은 속성이면 "내 카드군 상대" 함정이 아니다)
    const pool = ELEMENTS.filter(e => e !== ctx.element);
    condition = { element: pool[Math.floor(rng() * pool.length)] };
  } else if (spec && spec.needs === 'archetype') {
    const want = ctx.foeThemeName || ctx.themeName || ctx.themeKeyword;
    if (!want) return rollFallback(ctx, rng);   // 카드군 문맥이 없으면 카드군 조건은 뺀 채 다시 굴린다
    condition = { archetype: want };
  } else if (spec && spec.needs === 'keyword') {
    condition = { keyword: KEYWORD_CONDITIONS[Math.floor(rng() * KEYWORD_CONDITIONS.length)] };
  }
  return { trapTrigger: key, condition, label: spec ? spec.label : key };
}

function rollFallback(ctx, rng) {
  const { foePlaysArchetype, ...rest } = TRAP_TRIGGER_WEIGHTS;
  const key = weightedPick(rest, rng);
  const spec = TRAP_TRIGGERS[key];
  let condition;
  if (spec && spec.needs === 'element') condition = { element: ELEMENTS.filter(e => e !== ctx.element)[Math.floor(rng() * 5)] };
  else if (spec && spec.needs === 'keyword') condition = { keyword: KEYWORD_CONDITIONS[Math.floor(rng() * KEYWORD_CONDITIONS.length)] };
  return { trapTrigger: key, condition, label: spec ? spec.label : key };
}

/** 함정 발동조건을 LLM에게 지시하는 문장 */
export function trapTriggerDirective(plan) {
  if (!plan) return '';
  const cond = plan.condition ? ` "condition": ${JSON.stringify(plan.condition)},` : '';
  return `\n\n🪤 이 함정의 발동조건은 **${plan.label}**이다 (시스템이 정했다 — 반드시 따를 것):\n` +
    `- "trapTrigger": "${plan.trapTrigger}",${cond} 그대로 쓴다. 효과와 설명문은 이 조건에서 발동하는 장면으로 짓는다.`;
}
