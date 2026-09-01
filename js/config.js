// config.js - 게임 상수 및 설정
import { targetCostMultiplier, readTargetSpec, MAX_TARGET_COUNT, TARGET_SCOPES, TARGET_SIDES, describeTarget } from './effect-targets.js';

export const ELEMENT_SVG_ART = {
  fire: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23ea580c"/><stop offset="60%" stop-color="%23991b1b"/><stop offset="100%" stop-color="%231a0505"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23fef08a" opacity="0.25"/><text x="200" y="240" font-size="110" text-anchor="middle">🔥</text></svg>`,
  water: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%2338bdf8"/><stop offset="60%" stop-color="%230369a1"/><stop offset="100%" stop-color="%23041926"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23e0f2fe" opacity="0.25"/><text x="200" y="240" font-size="110" text-anchor="middle">💧</text></svg>`,
  lightning: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23facc15"/><stop offset="60%" stop-color="%23a16207"/><stop offset="100%" stop-color="%231c1202"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23fef9c3" opacity="0.25"/><text x="200" y="240" font-size="110" text-anchor="middle">⚡</text></svg>`,
  holy: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23fef08a"/><stop offset="60%" stop-color="%23d97706"/><stop offset="100%" stop-color="%23261202"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23ffffff" opacity="0.3"/><text x="200" y="240" font-size="110" text-anchor="middle">✨</text></svg>`,
  dark: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23a855f7"/><stop offset="60%" stop-color="%23581c87"/><stop offset="100%" stop-color="%230d0417"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23f3e8ff" opacity="0.25"/><text x="200" y="240" font-size="110" text-anchor="middle">🌑</text></svg>`,
  nature: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%2334d399"/><stop offset="60%" stop-color="%23047857"/><stop offset="100%" stop-color="%23021a14"/></radialGradient></defs><rect width="400" height="400" fill="url(%23g)"/><circle cx="200" cy="200" r="90" fill="%23dcfce7" opacity="0.25"/><text x="200" y="240" font-size="110" text-anchor="middle">🌿</text></svg>`
};

export const ELEMENT_CONFIG = {
  fire: { name: '불', icon: '🔥', text: 'text-red-400', border: 'border-red-500/80', badge: 'bg-red-950/90 text-red-200 border-red-500', glow: 'shadow-red-500/40', bg: 'from-amber-950/90 via-red-950/80 to-black' },
  water: { name: '물', icon: '💧', text: 'text-cyan-400', border: 'border-cyan-500/80', badge: 'bg-cyan-950/90 text-cyan-200 border-cyan-500', glow: 'shadow-cyan-500/40', bg: 'from-blue-950/90 via-cyan-950/80 to-black' },
  lightning: { name: '번개', icon: '⚡', text: 'text-yellow-400', border: 'border-yellow-500/80', badge: 'bg-yellow-950/90 text-yellow-200 border-yellow-500', glow: 'shadow-yellow-500/40', bg: 'from-amber-950/90 via-yellow-950/80 to-black' },
  holy: { name: '신성', icon: '✨', text: 'text-amber-300', border: 'border-amber-400/80', badge: 'bg-amber-950/90 text-amber-200 border-amber-400', glow: 'shadow-amber-400/40', bg: 'from-amber-950/90 via-yellow-900/80 to-stone-950' },
  dark: { name: '암흑', icon: '🌑', text: 'text-purple-400', border: 'border-purple-500/80', badge: 'bg-purple-950/90 text-purple-200 border-purple-500', glow: 'shadow-purple-500/40', bg: 'from-purple-950/90 via-indigo-950/80 to-black' },
  nature: { name: '자연', icon: '🌿', text: 'text-emerald-400', border: 'border-emerald-500/80', badge: 'bg-emerald-950/90 text-emerald-200 border-emerald-500', glow: 'shadow-emerald-500/40', bg: 'from-emerald-950/90 via-green-950/80 to-black' }
};

export const RARITY_STYLE = {
  common: { name: 'COMMON', border: 'border-slate-500', glow: 'shadow-slate-500/20', badge: 'bg-slate-700 text-slate-200', aura: 'rgba(148, 163, 184, 0.4)' },
  rare: { name: 'RARE', border: 'border-blue-400', glow: 'shadow-blue-500/40', badge: 'bg-blue-600 text-blue-100', aura: 'rgba(59, 130, 246, 0.6)' },
  epic: { name: 'EPIC', border: 'border-purple-400', glow: 'shadow-purple-500/60', badge: 'bg-purple-600 text-purple-100', aura: 'rgba(168, 85, 247, 0.7)' },
  legendary: { name: 'LEGENDARY', border: 'border-amber-400', glow: 'shadow-amber-400/80', badge: 'bg-gradient-to-r from-amber-500 to-yellow-300 text-black font-black', aura: 'rgba(245, 158, 11, 0.9)' }
};

export const CARD_TYPES = {
  unit: { name: '소환수', icon: '⚔️', badge: 'bg-red-950/80 text-red-200 border-red-500/50' },
  spell: { name: '주문/마법', icon: '🔮', badge: 'bg-purple-950/80 text-purple-200 border-purple-500/50' },
  structure: { name: '건축물/성물', icon: '🏛️', badge: 'bg-amber-950/80 text-amber-200 border-amber-500/50' },
  trap: { name: '함정', icon: '🪤', badge: 'bg-indigo-950/80 text-indigo-200 border-indigo-500/50' }
};

// 🎲 TCG 정규 가챠 등급 확률 테이블
export const RARITY_RATES = {
  common: 60,   // 60%
  rare: 25,     // 25%
  epic: 12,     // 12%
  legendary: 3  // 3%
};

// 등급별 엄격한 스탯/코스트/정수 효과 상한선 (스펙 인플레 방지)
export const RARITY_BALANCE_CAPS = {
  common: {
    costRange: [1, 2],
    atkRange: [6, 10],
    defRange: [2, 6],
    hpRange: [14, 22],
    spellDamage: [8, 12],
    shieldValue: [6, 10],
    healValue: [6, 10],
    buffValue: [1, 2]
  },
  rare: {
    costRange: [2, 3],
    atkRange: [10, 15],
    defRange: [4, 8],
    hpRange: [20, 28],
    spellDamage: [12, 18],
    shieldValue: [10, 16],
    healValue: [10, 16],
    buffValue: [2, 3]
  },
  epic: {
    costRange: [3, 4],
    atkRange: [14, 20],
    defRange: [6, 12],
    hpRange: [26, 34],
    spellDamage: [16, 24],
    shieldValue: [14, 20],
    healValue: [14, 22],
    buffValue: [3, 4]
  },
  legendary: {
    costRange: [3, 5],
    atkRange: [18, 26],
    defRange: [8, 14],
    hpRange: [30, 40],
    spellDamage: [20, 28],
    shieldValue: [18, 26],
    healValue: [18, 26],
    buffValue: [4, 5]
  }
};

// ============================================================
// ⚖️ 효과 기반 파워 예산 (Effect Power Budget)
// ------------------------------------------------------------
// 카드 성능은 스탯 수치만으로 평가할 수 없다. COMMON 카드가
// "실드 관통 + 흡혈 + 처형"을 동시에 갖고 있으면 공격력이 낮아도 강카드다.
// 실제로 RARE [심연의 암살자]가 관통+흡혈+처형 3종을,
// RARE [성역의 수호사제]가 무적을 들고 있었다.
//
// 여기서는 효과마다 (1) 파워 점수와 (2) 최소 요구 등급을 정의하고,
// 등급별 예산을 넘기거나 등급 요건에 미달하는 효과를 잘라낸다.
// ============================================================

// 등급 서열 (비교용)
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

export function rarityRank(rarity) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return idx === -1 ? 0 : idx;
}

/**
 * 효과별 파워 점수와 최소 등급.
 *
 * cost      — 파워 점수. 높을수록 강한 효과.
 * minRarity — 이 효과를 가질 수 있는 최소 등급. 미달이면 제거된다.
 * label     — 로그/툴팁 표기용
 *
 * 새 효과 키워드를 추가하면 **반드시 여기에도 등록**하세요.
 * 등록되지 않은 효과는 예산 계산에서 누락되어 밸런스 구멍이 됩니다.
 */
export const EFFECT_COSTS = {
  // 기본 효과 — 어느 등급이든 가질 수 있다
  damage:            { cost: 1, minRarity: 'common',    label: '피해' },
  shield:            { cost: 1, minRarity: 'common',    label: '방어막' },
  heal:              { cost: 1, minRarity: 'common',    label: '치유' },
  statusEffect:      { cost: 2, minRarity: 'common',    label: '상태이상' },

  // 어드밴티지 / 템포 — rare 이상
  drawCards:         { cost: 2, minRarity: 'rare',      label: '드로우' },
  manaGain:          { cost: 2, minRarity: 'rare',      label: '마나 수급' },
  multiHit:          { cost: 2, minRarity: 'rare',      label: '연타' },
  critChance:        { cost: 2, minRarity: 'rare',      label: '치명타' },
  passiveEffect:     { cost: 3, minRarity: 'rare',      label: '지속 패시브' },
  isAoeSpell:        { cost: 3, minRarity: 'rare',      label: '광역' },
  lifestealPercent:  { cost: 3, minRarity: 'rare',      label: '흡혈' },

  // 배수 / 처형 — epic 이상 (실드 관통은 카운터 도구이므로 rare 허용)
  pierceShield:      { cost: 3, minRarity: 'rare',      label: '실드 관통' },
  executeThreshold:  { cost: 4, minRarity: 'epic',      label: '처형' },
  doubleCastNext:    { cost: 4, minRarity: 'epic',      label: '더블캐스트' },

  // 🪤 함정 — 조건부 발동이라 즉발보다 싸다 (조건이 안 맞으면 아무 일도 없다)
  trapTrigger:       { cost: 1, minRarity: 'common',    label: '함정 발동조건' },

  // 게임을 끝내는 효과 — legendary 전용
  invulnerableTurns: { cost: 5, minRarity: 'legendary', label: '무적' }
};

// 스킬 객체에서 실제로 켜져 있는 효과 목록을 뽑는다
function listActiveEffects(skill = {}) {
  const active = [];
  for (const [key, spec] of Object.entries(EFFECT_COSTS)) {
    let on = false;
    if (key === 'statusEffect') {
      on = !!(skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none');
    } else if (key === 'multiHit') {
      on = (skill.multiHit || 1) > 1;
    } else if (key === 'trapTrigger') {
      on = !!skill.trapTrigger;
    } else if (key === 'passiveEffect' || key === 'isAoeSpell' || key === 'pierceShield' || key === 'doubleCastNext') {
      on = !!skill[key];
    } else {
      on = (skill[key] || 0) > 0;
    }
    if (on) active.push({ key, ...spec });
  }
  return active;
}
// ============================================================
// ⚖️ 통합 파워 예산 — 등급 × 마나 × 효과 × 스탯
// ------------------------------------------------------------
// 이전에는 세 가지가 따로 놀았다.
//   RARITY_BALANCE_CAPS  — 스탯 상한 (등급별)
//   RARITY_EFFECT_BUDGET — 효과 예산 (등급별)
//   costRange            — 마나 코스트 (등급별)
// 그래서 "마나를 많이 쓰는 COMMON"이 이득을 볼 방법이 없었다.
//
// 새 모델: **마나가 파워를 산다. 등급은 그 효율을 정한다.**
//
//   지불 가능한 파워 = 기본치[등급] + 마나코스트 × 효율[등급]
//   사용한 파워      = 효과 점수 + 스탯 점수
//
// 결과:
//   - 낮은 등급도 마나를 많이 쓰면 효과를 여러 개 가질 수 있다 (느리지만 강함)
//   - 높은 등급은 같은 효과를 적은 마나로 낸다 (효율이 곧 희귀도의 가치)
// ============================================================

/**
 * 등급별 파워 효율. 높을수록 마나 1당 더 많은 파워를 산다.
 *
 * ⚠️ 2026-09-01 하향 조정: 연계 범위(comboScope)가 확장되면서 범용 카드도
 *    연계에 기여할 수 있게 됐다. 범용 카드의 가치가 오른 만큼 전체 파워를
 *    조여야 카드가 전부 만능이 되는 것을 막을 수 있다.
 *    (이전: base 1/2/3/4, perMana 1.0/1.5/2.0/2.5)
 */
export const RARITY_POWER = {
  common:    { base: 0.5, perMana: 0.8, maxCost: 6 },
  rare:      { base: 1.0, perMana: 1.2, maxCost: 6 },
  epic:      { base: 1.5, perMana: 1.6, maxCost: 6 },
  legendary: { base: 2.0, perMana: 2.0, maxCost: 6 }
};

/**
 * 스탯도 파워를 소비한다.
 * 이 값으로 나눈 몫이 스탯 파워 점수다. 숫자가 클수록 스탯이 싸다.
 */
export const STAT_POWER_DIVISOR = {
  attack: 5,    // 공격력 5당 1점 (이전 6 — 조임)
  hp: 10,       // 체력 10당 1점 (이전 12 — 조임)
  defense: 8    // 방어력 8당 1점
};

/** 지불 가능한 총 파워 */
export function affordablePower(rarity, cost) {
  const spec = RARITY_POWER[rarity] || RARITY_POWER.common;
  const c = Math.max(0, Math.min(spec.maxCost, parseInt(cost) || 0));
  return spec.base + c * spec.perMana;
}

/** 스탯이 소비하는 파워 */
export function statPower(cardData) {
  const type = cardData.cardType || 'unit';
  if (type === 'spell' || type === 'trap') return 0;   // 주문·함정은 스탯이 없다
  const atk = (parseInt(cardData.attack) || 0) / STAT_POWER_DIVISOR.attack;
  const hp = (parseInt(cardData.hp) || 0) / STAT_POWER_DIVISOR.hp;
  const def = (parseInt(cardData.defense) || 0) / STAT_POWER_DIVISOR.defense;
  return atk + hp + def;
}

/**
 * 카드의 파워 수지를 계산한다. (진단용 — 아무것도 변경하지 않음)
 * @returns { affordable, effectPower, statPower, used, balance, overBudget, effects, illegal }
 */
export function evaluateCardPower(cardData) {
  const rarity = (cardData && RARITY_POWER[cardData.rarity]) ? cardData.rarity : 'common';
  const skill = (cardData && (cardData.skill || (cardData.skills && cardData.skills[0]))) || {};
  const effects = listActiveEffects(skill);

  // 🎯 대상이 늘면 카드가 강해진다. 예산에 반드시 반영한다.
  //    안 하면 "적 전체 20 피해"가 "적 1체 20 피해"와 같은 값으로 취급된다.
  //    ⚠️ 대상과 무관한 효과(방어막·마나 수급 등)에는 곱하지 않는다 —
  //       내 방어막은 상대가 몇 명이든 똑같이 하나다.
  const tMult = targetCostMultiplier(skill);
  const TARGET_SCALED = new Set(['damage', 'heal', 'statusEffect', 'multiHit', 'lifestealPercent']);

  const effectPower = effects.reduce(
    (sum, e) => sum + e.cost * (TARGET_SCALED.has(e.key) ? tMult : 1), 0);
  const stats = statPower(cardData || {});
  const used = effectPower + stats;
  const affordable = affordablePower(rarity, cardData ? cardData.cost : 0);
  const illegal = effects.filter(e => rarityRank(e.minRarity) > rarityRank(rarity));

  return {
    rarity,
    cost: cardData ? cardData.cost : 0,
    affordable: Math.round(affordable * 10) / 10,
    effectPower,
    statPower: Math.round(stats * 10) / 10,
    used: Math.round(used * 10) / 10,
    balance: Math.round((affordable - used) * 10) / 10,
    overBudget: used > affordable,
    effects,
    illegal,
    // 기존 코드 호환
    points: effectPower,
    budget: Math.round(affordable * 10) / 10
  };
}

/**
 * 파워 예산에 맞게 카드를 교정한다.
 *
 * 순서:
 *   1. 등급 요건 미달 효과 제거 (COMMON의 무적 등)
 *   2. 예산이 남을 때까지 **마나 코스트를 올려본다** — 효과를 지우기 전에 값을 먼저 매긴다
 *   3. 그래도 넘치면 비싼 효과부터 제거
 *   4. 그래도 넘치면 스탯을 낮춘다
 *
 * @returns { skill, cost, attack, hp, defense, removed[], costRaised }
 */
export function enforcePowerBudget(cardData, skill) {
  const rarity = (RARITY_POWER[cardData.rarity]) ? cardData.rarity : 'common';
  const spec = RARITY_POWER[rarity];
  const out = { ...skill };
  const removed = [];
  let cost = Math.max(1, Math.min(spec.maxCost, parseInt(cardData.cost) || 1));
  let atk = parseInt(cardData.attack) || 0;
  let hp = parseInt(cardData.hp) || 0;
  let def = parseInt(cardData.defense) || 0;

  const clearEffect = (key) => {
    if (key === 'statusEffect') out.statusEffect = { type: 'none', duration: 0, value: 0 };
    else if (key === 'multiHit') out.multiHit = 1;
    else if (key === 'passiveEffect') delete out.passiveEffect;
    else if (key === 'trapTrigger') delete out.trapTrigger;
    else if (key === 'isAoeSpell' || key === 'pierceShield' || key === 'doubleCastNext') out[key] = false;
    else out[key] = 0;
  };

  // 1. 등급 요건 미달 제거
  for (const e of listActiveEffects(out)) {
    if (rarityRank(e.minRarity) > rarityRank(rarity)) {
      clearEffect(e.key);
      removed.push({ ...e, reason: `${e.minRarity} 이상 전용` });
    }
  }

  // ⚠️ evaluateCardPower와 **같은 식**을 써야 한다.
  //    여기서 대상 배수를 빠뜨리면 "예산 통과"라 판정해놓고 카드 상세에는
  //    "예산 초과"로 뜨는 모순이 생긴다.
  const TARGET_SCALED = new Set(['damage', 'heal', 'statusEffect', 'multiHit', 'lifestealPercent']);
  const usedPower = () => {
    const m = targetCostMultiplier(out);
    return listActiveEffects(out)
      .reduce((s, e) => s + e.cost * (TARGET_SCALED.has(e.key) ? m : 1), 0)
      + statPower({ ...cardData, attack: atk, hp, defense: def });
  };

  // 2. 효과를 지우기 전에 마나 코스트를 올려 값을 치른다
  //    "낮은 등급이 여러 효과를 갖되 마나를 많이 쓴다"는 규칙이 여기서 나온다
  let costRaised = 0;
  while (usedPower() > affordablePower(rarity, cost) && cost < spec.maxCost) {
    cost++;
    costRaised++;
  }

  // 2-b. 🎯 그래도 넘치면 **대상 범위를 좁힌다.**
  //      효과를 통째로 지우는 것보다 훨씬 덜 파괴적이다.
  //      전체 → 3체 → 2체 → 단일 순으로 한 단계씩 낮춘다.
  const narrowOnce = () => {
    const t = readTargetSpec(out);
    if (t.scope === 'all')   { out.targetScope = 'multi'; out.targetCount = MAX_TARGET_COUNT; out.isAoeSpell = false; return true; }
    if (t.scope === 'multi' && t.count > 1) { out.targetCount = t.count - 1; if (out.targetCount <= 1) out.targetScope = 'single'; return true; }
    return false;
  };
  let narrowed = 0;
  while (usedPower() > affordablePower(rarity, cost) && narrowOnce()) {
    narrowed++;
    // 범위를 줄여 여유가 생겼으면 마나를 다시 올려볼 필요는 없다 (이미 최대)
  }
  if (narrowed > 0) {
    removed.push({ key: 'targetScope', label: '대상 범위', reason: `예산에 맞춰 ${describeTarget(out)}(으)로 축소` });
  }

  // 3. 그래도 넘치면 비싼 효과부터 제거
  let effects = listActiveEffects(out).sort((a, b) => b.cost - a.cost);
  for (const e of effects) {
    if (usedPower() <= affordablePower(rarity, cost)) break;
    clearEffect(e.key);
    removed.push({ ...e, reason: `예산 초과 (${rarity} / 마나 ${cost})` });
  }

  // 4. 그래도 넘치면 스탯을 깎는다
  let guard = 0;
  while (usedPower() > affordablePower(rarity, cost) && guard++ < 40) {
    if (atk >= hp / 2 && atk > 1) atk -= 1;
    else if (hp > 4) hp -= 2;
    else if (def > 0) def -= 1;
    else break;
  }

  // 효과가 전부 사라졌으면 기본 피해 하나는 남긴다
  if (listActiveEffects(out).length === 0) {
    out.damage = Math.max(1, skill.damage || 0) || 8;
  }

  return { skill: out, cost, attack: atk, hp, defense: def, removed, costRaised };
}

// 🛡️ 카드 데이터 정수화 및 등급별 엄격한 밸런스 클램핑 처리기 (% 표기 완전 제거)
/**
 * 설명문의 숫자를 스킬의 **실제 값**과 일치시킨다.
 *
 * LLM은 "200 피해"처럼 마음대로 큰 수를 쓴다. 수치는 클램프되지만 설명문은
 * 그대로 남아 카드가 거짓말을 하게 된다. 여기서 뒤늦게 맞춰준다.
 *
 * ⚠️ 피해·방어막·회복 **단어에 바로 붙은 숫자만** 바꾼다.
 *    "체력 35 이하일 때" 같은 조건문의 숫자까지 건드리면 효과 설명이 망가진다.
 */
function syncDescriptionNumbers(desc, skill) {
  let out = String(desc || '');

  const rules = [
    [skill.damage, /(\d+)(\s*(?:의\s*)?(?:추가\s*)?(?:고정\s*)?(?:피해|데미지|damage))/gi],
    [skill.shield, /(\d+)(\s*(?:의\s*)?(?:방어막|실드|보호막|shield))/gi],
    [skill.heal,   /(\d+)(\s*(?:의\s*)?(?:회복|치유|heal))/gi]
  ];

  for (const [value, re] of rules) {
    if (!Number.isFinite(value) || value <= 0) continue;
    out = out.replace(re, (_m, _num, tail) => `${value}${tail}`);
  }

  // 위 규칙에 안 걸린 비상식적인 큰 수는 남겨두면 오해를 부른다.
  // (예: "적 방어막을 100 무시하고") — 세 자리 이상은 두 자리로 눌러 표기만 정리한다.
  out = out.replace(/\b(\d{3,})\b/g, (m) => {
    const n = parseInt(m, 10);
    return String(Math.min(99, Math.max(1, Math.round(n / 10))));
  });

  return out;
}

export function sanitizeAndClampCardData(cardData) {
  if (!cardData) return cardData;
  const rarity = (cardData.rarity && RARITY_BALANCE_CAPS[cardData.rarity]) ? cardData.rarity : 'common';
  const caps = RARITY_BALANCE_CAPS[rarity];
  const cardType = cardData.cardType || 'unit';

  // 1. 코스트 및 기본 스탯 정수 클램핑
  let cost = parseInt(cardData.cost) || caps.costRange[0];
  cost = Math.min(caps.costRange[1], Math.max(caps.costRange[0], cost));

  let atk = parseInt(cardData.attack) || caps.atkRange[0];
  atk = Math.min(caps.atkRange[1], Math.max(caps.atkRange[0], atk));

  let def = parseInt(cardData.defense) || caps.defRange[0];
  def = Math.min(caps.defRange[1], Math.max(caps.defRange[0], def));

  let hp = parseInt(cardData.hp) || caps.hpRange[0];
  hp = Math.min(caps.hpRange[1], Math.max(caps.hpRange[0], hp));

  // 🐛 수정: 예전에는 spell만 스탯을 0으로 만들었다. **함정도 스탯이 없다** —
  //    필드에 나오지 않고 조건이 맞을 때 효과만 터지기 때문이다.
  //    그런데 굴린 공/방/체가 그대로 남아 카드에 표시됐다.
  //    statPower()는 함정을 0으로 치므로 예산 계산에도 안 들어갔다 —
  //    즉 **화면에만 보이는 허수**였다.
  if (cardType === 'spell' || cardType === 'trap') {
    atk = 0; def = 0; hp = 0;
  } else if (cardType === 'structure') {
    atk = 0;
    def = Math.min(18, Math.max(4, def));
    hp = Math.min(42, Math.max(16, hp));
  }

  // 2. 스킬 수치 정수화 및 클램핑
  // 🐛 수정: 예전에는 cardData.skill만 봤다. 스타터 카드와 카드팩 카드는
  //          skills[] 배열만 갖고 있어서, 이 함수를 태우면 효과가 통째로 사라졌다.
  const sourceSkill = cardData.skill || (Array.isArray(cardData.skills) && cardData.skills[0]) || null;
  const skill = sourceSkill ? { ...sourceSkill } : {};
  if (skill.damage !== undefined && skill.damage > 0) {
    skill.damage = Math.min(caps.spellDamage[1], Math.max(caps.spellDamage[0] - 2, parseInt(skill.damage) || 0));
  }
  if (skill.shield !== undefined && skill.shield > 0) {
    skill.shield = Math.min(caps.shieldValue[1], Math.max(caps.shieldValue[0] - 2, parseInt(skill.shield) || 0));
  }
  if (skill.heal !== undefined && skill.heal > 0) {
    skill.heal = Math.min(caps.healValue[1], Math.max(caps.healValue[0] - 2, parseInt(skill.heal) || 0));
  }
  if (skill.multiHit !== undefined) {
    skill.multiHit = Math.min(3, Math.max(1, Math.round(parseInt(skill.multiHit) || 1)));
  }

  // 🎯 대상 규칙 정규화. LLM이 아무 문자열이나 넣어도 안전한 값으로 떨어진다.
  //    여기서 확정된 값이 그대로 예산 계산(targetCostMultiplier)에 쓰인다.
  const tspec = readTargetSpec(skill);
  skill.targetSide = tspec.side;
  skill.targetScope = tspec.scope;
  skill.targetCount = tspec.count;
  // 구버전 필드와 어긋나지 않게 맞춰둔다 (isAoeSpell == 전체 대상)
  skill.isAoeSpell = tspec.scope === 'all';

  // 3. 설명문 내 % 표기 완전 제거 및 정수 치환
  if (skill.description) {
    let desc = skill.description;
    // (A) % 증가 / 상승 -> 정수치로 변환
    desc = desc.replace(/(\d+)\s*%\s*(공격력\s*)?(증가|상승|강화|증폭)/g, (m, p1, p2, p3) => {
      const val = Math.min(caps.buffValue[1], Math.max(caps.buffValue[0], Math.round(parseInt(p1) / 10) || 2));
      return `${p2 || ''}+${val} ${p3}`;
    });
    // (B) % 회복 -> 정수치로 변환
    desc = desc.replace(/(\d+)\s*%\s*(체력\s*)?(회복|치유)/g, (m, p1, p2, p3) => {
      return `${p2 || ''}체력 ${caps.healValue[0]} ${p3}`;
    });
    // (C) % 피해 -> 정수치로 변환
    desc = desc.replace(/(\d+)\s*%\s*(추가\s*)?(피해|데미지)/g, (m, p1, p2, p3) => {
      return `${caps.spellDamage[0]} ${p3}`;
    });
    // (D) 남아있는 모든 % 기호 제거
    desc = desc.replace(/(\d+)\s*%/g, '$1');

    // (E) 🐛 설명문의 숫자를 **클램프된 실제 값**과 맞춘다.
    //     예전에는 이 단계가 없어서 LLM이 "200 피해를 준다"라고 쓰면
    //     skill.damage는 24로 깎이는데 카드에는 200이라 적혀 있었다.
    //     플레이어에게 거짓말을 하는 셈이고, 밸런스가 망가진 것처럼 보인다.
    desc = syncDescriptionNumbers(desc, skill);

    skill.description = desc;
  }

  // 4. ⚖️ 통합 파워 예산 적용
  //    효과를 지우기 전에 **마나 코스트를 먼저 올려** 값을 치른다.
  //    "낮은 등급이 여러 효과를 갖되 마나를 많이 쓴다"는 규칙이 여기서 나온다.
  const budgeted = enforcePowerBudget(
    { ...cardData, rarity, cost, attack: atk, hp, defense: def, cardType },
    skill
  );

  const finalSkill = budgeted.skill;
  cost = budgeted.cost;
  atk = budgeted.attack;
  hp = budgeted.hp;
  def = budgeted.defense;

  if (budgeted.costRaised > 0) {
    console.log(`[Balance] "${cardData.name || '무명'}" (${rarity}) 효과값 지불로 마나 +${budgeted.costRaised} → ${cost}`);
  }
  if (budgeted.removed.length > 0) {
    console.log(
      `[Balance] "${cardData.name || '무명'}" (${rarity}/마나${cost}) 효과 ${budgeted.removed.length}건 제거: ` +
      budgeted.removed.map(r => `${r.label}(${r.reason})`).join(', ')
    );
  }

  const power = evaluateCardPower({ ...cardData, rarity, cost, attack: atk, hp, defense: def, cardType, skill: finalSkill });

  return {
    ...cardData,
    rarity,
    cost,
    attack: atk,
    defense: def,
    hp,
    skill: finalSkill,
    powerUsed: power.used,
    powerAffordable: power.affordable
  };
}

export function rollRandomRarity(minRarity = null) {
  if (minRarity === 'rare') {
    // 희귀 이상 확정 룰 (Rare 62%, Epic 30%, Legendary 8%)
    const rand = Math.random() * 100;
    if (rand < 62) return 'rare';
    if (rand < 92) return 'epic';
    return 'legendary';
  }
  
  const rand = Math.random() * 100;
  if (rand < RARITY_RATES.common) return 'common';
  if (rand < RARITY_RATES.common + RARITY_RATES.rare) return 'rare';
  if (rand < RARITY_RATES.common + RARITY_RATES.rare + RARITY_RATES.epic) return 'epic';
  return 'legendary';
}
