// config.js - 게임 상수 및 설정
import { normalizeTrapTrigger, TRAP_TRIGGERS } from './trap-system.js';
import { STATUS_EFFECTS } from './status-effects.js';
import { flavorRewrite } from './local-flavor.js';   // 🎭 로컬 플레이버 팩 (없으면 그대로 통과)
import { targetCostMultiplier, readTargetSpec, MAX_TARGET_COUNT, TARGET_SCOPES, TARGET_SIDES, describeTarget,
         HP_TARGETS, readHpTarget, hpTargetCostMultiplier,
         DAMAGE_TARGETS, readDamageTarget, damageTargetCostMultiplier } from './effect-targets.js';

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

// 등급별 엄격한 스탯/정수 효과 상한선 (스펙 인플레 방지)
//
// ⚠️ **등급은 코스트를 가두지 않는다.**
//    🐛 예전에는 등급마다 좁은 costRange를 줬다 (커먼 1~2, 레어 2~3, 에픽 3~4,
//       레전더리 3~5). 그래서 레어 이상 카드는 **1마나가 될 수 없었고**,
//       레어+ 위주로 짠 덱에는 저코스트 카드가 아예 없었다.
//       (측정: 활성 덱 13장 커브가 2코1·3코6·4코1·5코2·6코3 — 1코 0장,
//        첫 손패에 1코가 올 확률 0%. 1턴에 낼 카드가 없어 그냥 죽었다.)
//
//    등급이 정하는 것은 **코스트당 파워 밀도**(RARITY_POWER.perMana)이지
//    코스트 자체가 아니다. 1마나 레전더리는 "아주 효율 좋은 작은 카드"로
//    성립한다 — 실제 TCG도 그렇다.
export const RARITY_BALANCE_CAPS = {
  common: {
    costRange: [1, 5],   // ⚠️ 등급은 코스트를 가두지 않는다 — 아래 주석 참고
    atkRange: [6, 10],
    defRange: [2, 6],
    hpRange: [14, 22],
    spellDamage: [8, 12],
    shieldValue: [6, 10],
    healValue: [6, 10],
    buffValue: [1, 2]
  },
  rare: {
    costRange: [1, 5],
    atkRange: [10, 15],
    defRange: [4, 8],
    hpRange: [20, 28],
    spellDamage: [12, 18],
    shieldValue: [10, 16],
    healValue: [10, 16],
    buffValue: [2, 3]
  },
  epic: {
    costRange: [1, 6],
    atkRange: [14, 20],
    defRange: [6, 12],
    hpRange: [26, 34],
    spellDamage: [16, 24],
    shieldValue: [14, 20],
    healValue: [14, 22],
    buffValue: [3, 4]
  },
  legendary: {
    costRange: [1, 6],
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
  // 🏛️ 오라 — "이 카드가 전장에 있는 동안". 쌓이지 않으므로 매 턴 누적형보다 싸고,
  //    건축물이 부서지면 즉시 사라지므로 낮은 등급에도 허용한다.
  //    ⚠️ 이건 카드 한 장과 마나를 지불하고 얻는 효과다. 전개 수만으로 공짜로
  //       붙던 오토체스식 종족 버프(DECISIONS #4)와는 다르다.
  aura:              { cost: 2, minRarity: 'common',    label: '전장 오라' },
  // ⚔️ 직접 공격 — 상대 전장을 무시하고 본체를 친다.
  //    기본 규칙(전장에 소환수가 있으면 본체 불가)을 뚫는 능력이라 비싸다.
  directAttack:      { cost: 3, minRarity: 'rare',      label: '직접 공격' },
  isAoeSpell:        { cost: 3, minRarity: 'rare',      label: '광역' },
  lifestealPercent:  { cost: 3, minRarity: 'rare',      label: '흡혈' },

  // 배수 / 처형 — epic 이상 (실드 관통은 카운터 도구이므로 rare 허용)
  pierceShield:      { cost: 3, minRarity: 'rare',      label: '실드 관통' },
  executeThreshold:  { cost: 4, minRarity: 'epic',      label: '처형' },
  doubleCastNext:    { cost: 4, minRarity: 'epic',      label: '더블캐스트' },

  // 🃏 카드가 자주 말하던 유희왕식 동작들 — 예전에는 **설명문에만 있었다.**
  //    실팩 유저 덱에서 14종 중 6종이 이걸 주장하고 아무 일도 안 했다.
  //    막는 대신 실제로 구현했다 → DECISIONS #85
  //
  // 💀 파괴 — 체력과 무관하게 없앤다. 큰 소환수일수록 이득이 커서 비싸다.
  destroy:           { cost: 5, minRarity: 'epic',      label: '파괴' },
  // 🔍 덱 서치 — 드로우보다 강하다(무엇이 올지 고를 수 있다)
  searchDeck:        { cost: 3, minRarity: 'rare',      label: '덱 서치' },
  // 🃏 패 파기 — 상대 손패 무작위 1장. 보스 파워 카드가 쓰던 효과인데 보스 전용 해석기에만
  //    있었다. 카드 시전이 양 진영 한 경로가 되면서(DECISIONS #94) 정식 효과로 승격 —
  //    프롬프트 스키마에는 넣지 않는다 (LLM이 만들지 않고, 기존 데이터만 살린다).
  discardCard:       { cost: 2, minRarity: 'rare',      label: '패 파기' },
  // 👾 토큰 소환 — 전장을 채우고, 지금은 전장 자체가 벽이라 값이 크다
  summonToken:       { cost: 3, minRarity: 'rare',      label: '토큰 소환' },

  // 🪤 함정 — 조건부 발동이라 즉발보다 싸다 (조건이 안 맞으면 아무 일도 없다)
  // 🪤 발동조건은 **제약이지 능력이 아니다.** 값을 매기지 않는다.
  //    🐛 예전에는 cost 1을 청구했다. 그러면 조건부 함정이 즉발 마법보다
  //       불리해지고, 그걸 보상하려 함정 예산 배수를 올리면 총량이 부풀었다.
  //       조건부의 보상은 TYPE_POWER.trap.budgetMult 한 곳에서만 준다.
  trapTrigger:       { cost: 0, minRarity: 'common',    label: '함정 발동조건' },

  // 🛡️ 방어·무력화 계열
  //    LLM이 설명문에는 자주 쓰는데 엔진에 없어서 **글자만 있고 동작하지 않던** 효과들이다.
  //    ("피해를 50% 줄이고", "공격력을 0으로", "효과를 무효화")
  damageReduction:   { cost: 2, minRarity: 'rare',      label: '피해 경감' },
  // ❤️ 본체 최대 체력 증가 — 영구적이라 비싸다.
  //    본체 체력이 낮아서 상태이상·직격이 위협적인 문제를 카드로 풀 수 있게 한다.
  maxHpGain:         { cost: 3, minRarity: 'rare',      label: '최대 체력 증가' },
  attackDown:        { cost: 2, minRarity: 'rare',      label: '공격력 약화' },
  silence:           { cost: 3, minRarity: 'epic',      label: '효과 무효화' },

  // 게임을 끝내는 효과 — legendary 전용
  invulnerableTurns: { cost: 5, minRarity: 'legendary', label: '무적' }
};

// ============================================================
// 📏 효과 **크기**의 값
// ------------------------------------------------------------
// 🐛 예전에는 EFFECT_COSTS가 효과의 **존재**만 값매겼다.
//    그래서 "28 피해"와 "8 피해"가 똑같이 1점이었다. 크기는 오직
//    RARITY_BALANCE_CAPS가 등급별로 상한만 걸었을 뿐, 같은 등급 안에서
//    상한을 꽉 채운 카드와 하한만 쓴 카드가 같은 값을 냈다.
//
// 이제 크기도 값을 낸다:  실제비용 = 기본비용 × max(1, 크기 / perUnit)
//
// ⚠️ perUnit은 **커먼 등급 중간값이 대략 1단위가 되도록** 맞췄다.
//    (커먼 피해 중간값 10 → 10/10 = 1단위 → 비용 1 = 예전과 동일)
//    이렇게 하면 기존 밸런스 곡선을 유지하면서 등급 내 편차만 반영된다.
//    perUnit을 낮추면 모든 카드가 비싸져 코스트가 전반적으로 올라갑니다.
//
// ⚠️ multiHit은 여기 없다. damage가 **총량**(damage × multiHit)으로 값을
//    내므로 multiHit까지 크기로 매기면 이중 청구가 된다.
//    multiHit의 기본비용은 "여러 번 쪼개 때리는 유틸리티" 값으로만 남긴다.
// ============================================================
export const EFFECT_MAGNITUDE = {
  damage:            { read: s => (s.damage || 0) * Math.max(1, s.multiHit || 1), perUnit: 10 },
  // 영구 증가라 회복(perUnit 8)보다 단가가 비싸다
  maxHpGain:         { read: s => s.maxHpGain || 0,                               perUnit: 5 },
  shield:            { read: s => s.shield || 0,                                  perUnit: 8 },
  heal:              { read: s => s.heal || 0,                                    perUnit: 8 },
  attackDown:        { read: s => s.attackDown || 0,                              perUnit: 3 },
  damageReduction:   { read: s => s.damageReduction || 0,                         perUnit: 20 },
  drawCards:         { read: s => s.drawCards || 0,                               perUnit: 1.5 },
  // 🃏 개수형 효과 — 1장/1체가 곧 1단위다
  searchDeck:        { read: s => s.searchDeck || 0,                              perUnit: 1 },
  summonToken:       { read: s => s.summonToken || 0,                             perUnit: 1 },
  destroy:           { read: s => s.destroy || 0,                                 perUnit: 1 },
  manaGain:          { read: s => s.manaGain || 0,                                perUnit: 1.5 },
  invulnerableTurns: { read: s => s.invulnerableTurns || 0,                        perUnit: 1 },
  // 확률·비율 계열은 0~1로 저장된다. 100을 곱해 퍼센트로 읽는다.
  lifestealPercent:  { read: s => (s.lifestealPercent || 0) * 100,                 perUnit: 35 },
  critChance:        { read: s => (s.critChance || 0) * 100,                       perUnit: 35 },
  executeThreshold:  { read: s => (s.executeThreshold || 0) * 100,                 perUnit: 25 },
  // 상태이상은 위력 × 지속턴이 실제 총량이다
  statusEffect:      { read: s => (s.statusEffect && s.statusEffect.value || 0)
                                  * Math.max(1, (s.statusEffect && s.statusEffect.duration) || 1), perUnit: 16 },
  // 🏛️ 건축물 패시브 — 매 턴 누적분. 마나는 방어막보다 값이 크므로 8을 곱한다.
  passiveEffect:     { read: s => { const p = s.passiveEffect || {};
                        return (p.manaPerTurn || 0) * 8 + (p.endTurnShield || 0)
                             + (p.endTurnAoeShield || 0) + (p.endTurnAoeHeal || 0); }, perUnit: 12 },
  // 🏛️ 오라 — 지속되지만 쌓이지 않는다. 경감%는 스탯과 자릿수가 달라 8로 나눠 맞춘다.
  aura:              { read: s => { const a = (s.passiveEffect && s.passiveEffect.aura) || {};
                        return (a.attackBonus || 0) + (a.defenseBonus || 0)
                             + (a.damageReduction || 0) / 8; }, perUnit: 2.5 }
};

/**
 * 💫 본체 지정 상태이상 할증.
 *
 * 기절·빙결·화상·맹독은 기본적으로 **소환수 전용**이다
 * (status-effects.js의 `entityOnly`). 본체는 체력이 낮아 행동 봉쇄와
 * 지속 피해에 대응할 여지가 없기 때문이다.
 *
 * 그래도 본체를 노리는 카드를 만들고 싶으면 `skill.bodyStatus = true`로
 * **더 큰 파워 비용을 치르고** 살 수 있다. 공짜로 열어주지는 않는다.
 */
export const BODY_STATUS_COST_MULT = 2.5;

/**
 * 크기를 반영한 효과 비용.
 * 크기 정보가 없는 효과(광역·관통·무효화 등)는 기본비용 그대로다.
 */
export function scaledEffectCost(key, baseCost, skill) {
  const mag = EFFECT_MAGNITUDE[key];
  let cost = baseCost;
  if (mag) {
    const units = mag.read(skill) / mag.perUnit;
    cost = baseCost * Math.max(1, units);
  }
  // 💫 소환수 전용 상태이상을 본체에 걸겠다고 산 경우 할증.
  //    봉쇄(기절·빙결)는 bodyStatus로도 본체에 걸리지 않으므로 할증도 없다 — 값을 못 받는 걸 팔지 않는다.
  if (key === 'statusEffect' && skill.bodyStatus && skill.statusEffect
      && ENTITY_ONLY_STATUSES.has(skill.statusEffect.type) && !BLOCKING_STATUSES.has(skill.statusEffect.type)
      && !BODY_BLOCKED_STATUSES.has(skill.statusEffect.type)) {
    cost *= BODY_STATUS_COST_MULT;
  }
  return cost;
}

/**
 * 행동 봉쇄 상태이상 목록 — 본체에는 **어느 진영도** 걸리지 않는다 (DECISIONS #94).
 * ⚠️ status-effects.js의 `blocksTurn`과 반드시 같아야 한다 (ENTITY_ONLY_STATUSES와 같은 사정).
 * 🐛 빙결은 여기서 빠졌다 — 기절과 코드가 완전히 같은 중복이었다. 이제 **공격력 약화**다 (DECISIONS #105).
 */
export const BLOCKING_STATUSES = new Set(['stun']);

/**
 * 소환수 전용 상태이상 목록.
 * ⚠️ status-effects.js의 `entityOnly`와 **반드시 같아야 한다.**
 *    config.js가 status-effects.js를 import하면 순환이 생기므로 여기에 복제했다.
 *    한쪽만 고치면 예산과 실제 동작이 어긋난다.
 */
export const ENTITY_ONLY_STATUSES = new Set(['stun', 'freeze', 'corrosion', 'burn', 'poison', 'parasite', 'gestation']);

/**
 * bodyStatus 옵트인으로도 **본체에 걸 수 없는** 지속 피해 계열 — 사이클(기생·성장).
 * 단계 진행·부화는 소환수를 순회하며 처리하므로 본체에 걸면 조용히 무효가 된다 (DECISIONS #104).
 * ⚠️ status-cycles.js의 STATUS_CYCLES 키와 같아야 한다 (순환 import를 피해 복제한 목록 — 규칙 26과 같은 사정).
 */
export const BODY_BLOCKED_STATUSES = new Set(['parasite', 'gestation']);

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
    } else if (key === 'aura') {
      // 🏛️ 오라는 passiveEffect 안에 들어 있다 — 따로 값을 매겨야
      //    "매 턴 효과 + 오라"를 둘 다 달고도 공짜인 구멍이 안 생긴다
      on = !!(skill.passiveEffect && skill.passiveEffect.aura);
    } else if (key === 'passiveEffect') {
      // 오라만 있는 경우는 aura 쪽에서 값을 치르므로 여기서 또 받지 않는다
      on = !!(skill.passiveEffect && hasPerTurnPassive(skill.passiveEffect));
    } else if (key === 'isAoeSpell' || key === 'pierceShield' || key === 'doubleCastNext' || key === 'silence' || key === 'directAttack') {
      on = !!skill[key];
    } else {
      on = (skill[key] || 0) > 0;
    }
    if (on) {
      // 📏 크기를 반영한 비용으로 덮어쓴다.
      //    ⚠️ baseCost를 따로 남긴다 — 로그·진단에서 "기본 1점인데 크기 때문에
      //       2.8점"인지 구분해야 어디서 예산이 샜는지 읽을 수 있다.
      active.push({ key, ...spec, baseCost: spec.cost, cost: scaledEffectCost(key, spec.cost, skill) });
    }
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
/**
 * maxCost — 예산을 치르려고 마나를 올릴 수 있는 상한.
 *
 * ⚠️ **저등급 고코스트 카드는 일부러 허용한다.**
 *    "효과는 좋지만 그만큼 비싼 COMMON"은 그 자체로 정당한 선택지다.
 *    (덱에 넣을지 말지를 고민하게 만드는 카드)
 *
 * 🐛 다만 예전엔 전 등급이 6이라 **모든 카드가** 고코스트로 수렴했다.
 *    원인은 이 표가 아니라 LLM이 카드마다 효과를 잔뜩 넣는 것이었다.
 *    → 상한은 한 칸만 낮춰 여지를 남기고,
 *      분포는 프롬프트에서 잡는다 ("대부분은 효과 1개, 소수만 복합").
 */
/**
 * 🐛 예산이 **스탯 범위와 맞지 않아** 모든 카드가 상한 마나로 밀렸다.
 *
 *    COMMON 최소 스탯(공6/방2/체14) = 2.85 파워
 *    COMMON 2마나 예산 (구: 0.5+1.6) = 2.1
 *    → 스탯만으로 이미 초과. 효과가 0개여도 마나가 끝까지 올라갔다.
 *      그래서 "효과 1개 COMMON"조차 5마나가 됐다.
 *
 * 아래 값은 RARITY_BALANCE_CAPS의 **전형적인 카드**가 자기 등급의
 * 전형적인 마나에서 예산에 맞도록 역산한 것이다.
 *   common 전형(공8/방4/체18 + 효과1, 2마나) ≈ 4.9  →  1.5 + 2×1.7 = 4.9
 *   legendary 전형(공22/방11/체35 + 효과3, 4마나) ≈ 14.3 → 3.5 + 4×2.7 = 14.3
 *
 * ⚠️ 스탯 범위(RARITY_BALANCE_CAPS)나 STAT_POWER_DIVISOR를 바꾸면
 *    이 표도 함께 다시 계산해야 한다. 안 그러면 또 커브가 무너진다.
 */
// ============================================================
// ❤️ 플레이어 본체 체력 & 보스 콤보 딜 배율 — 전투 난이도의 두 축
// ------------------------------------------------------------
// 실측으로 정한 값이다. 바꾸기 전에 반드시 다시 재세요 (→ DECISIONS #87).
//
// 왜 이 둘인가:
//   · 본체 체력 50은 **소환수 공격력에 비해 너무 낮았다.** 상대 전장이 3기면
//     한 턴에 30~50이 들어오는데, 본체가 50이면 두 턴을 못 버틴다.
//   · 보스 콤보의 attack/magic 스텝은 **마나 제한을 받지 않는** 유일한 딜이다.
//     카드 수를 아무리 조여도 이 값이 그대로면 체감이 안 바뀐다.
//
// ⚠️ 이 둘은 서로 얽혀 있다. 한쪽만 바꾸면 반대쪽이 과보정된다.
export const PLAYER_BASE_HP = 100;

/**
 * 보스 콤보 스텝(attack/magic)의 피해 배율.
 *
 * 데이터의 원래 수치(16~36)를 그대로 두고 여기서만 줄인다 —
 * 보스 14개 패턴을 손으로 고치지 않아도 되고, 연성으로 생성되는
 * 보스 패턴에도 자동으로 적용된다.
 *
 * ⚠️ 2페이즈 ×1.4는 이 배율 **뒤에** 곱해진다.
 */
export const BOSS_STEP_DAMAGE_MULT = 0.4;

/**
 * 💥 콤보 **스텝**의 광역이 본체에 튀는 비율. 카드 광역은 양 진영 100%다 (DECISIONS #94) —
 * 이건 보스 고유 콤보 스텝의 내부 수치라 그대로 두고 이름만 붙였다. 바꾸기 전에 실측하세요.
 */
export const BOSS_STEP_AOE_FACE_MULT = 0.7;

export const RARITY_POWER = {
  common:    { base: 1.5, perMana: 1.7, maxCost: 5 },
  rare:      { base: 2.2, perMana: 2.0, maxCost: 5 },
  epic:      { base: 2.8, perMana: 2.4, maxCost: 6 },
  legendary: { base: 3.5, perMana: 2.7, maxCost: 6 }
};

/**
 * 스탯도 파워를 소비한다.
 * 이 값으로 나눈 몫이 스탯 파워 점수다. 숫자가 클수록 스탯이 싸다.
 *
 * ⚠️ 이건 **소환수 기준값**이다. 타입별 값은 TYPE_POWER.statDivisor를 쓴다.
 *    (기존 코드 호환을 위해 남겨둔 이름)
 */
export const STAT_POWER_DIVISOR = {
  attack: 5,    // 공격력 5당 1점
  hp: 10,       // 체력 10당 1점
  defense: 8    // 방어력 8당 1점
};

// ============================================================
// 🃏 카드 타입별 예산
// ------------------------------------------------------------
// 🐛 왜 나눴나: 예전에는 네 타입이 RARITY_POWER 하나를 **공유**했다.
//    그런데 마법·함정은 스탯이 0이라 예산 전부가 효과로 갔다.
//    같은 등급·같은 마나에서 효과에 쓸 수 있는 여유가 이렇게 벌어졌다:
//
//      커먼 1마나 → 소환수 0.4 / 건축물 1.2 / 마법 3.2 / 함정 3.2   (8배)
//      레전더리 3마나 → 소환수 4.0 / 건축물 6.5 / 마법 11.6 / 함정 11.6
//
//    소환수는 자기 스탯에 예산을 다 쓰고 효과를 못 달아 코스트가 올라갔고
//    (저코스트 카드가 사라지는 원인), 마법·함정은 효과를 무제한 쌓았다.
//
// 두 손잡이로 조정한다:
//   budgetMult   — 타입의 총 예산 배수 (소환수 1.00 기준)
//   statDivisor  — 그 타입에서 스탯이 얼마나 비싼가
//
// ⚠️ 수치를 만질 때는 **효과 여유**(예산 − 스탯)를 보세요. 예산만 보면
//    스탯이 0인 마법·함정이 실제로 얼마나 강해지는지 놓칩니다.
// ============================================================
export const TYPE_POWER = {
  unit: {
    label: '소환수',
    budgetMult: 1.00,
    statDivisor: { attack: 5, hp: 10, defense: 8 },
    why: '기준. 스탯과 효과를 모두 갖고, 살아 있는 동안 매 턴 공격한다.'
  },
  structure: {
    label: '건축물',
    budgetMult: 0.90,
    // 🏛️ 체력이 소환수의 **절반값**이다. 공격을 못 하므로 버티는 값어치뿐인데,
    //    예전에는 소환수와 같은 값을 매겨 체력(hp×1.3)이 예산을 다 먹었다.
    //    그래서 커먼 건축물은 패시브를 달 여유가 없었다.
    statDivisor: { attack: 5, hp: 20, defense: 14 },
    why: '공격하지 않는다. 대신 전장에 남아 지속 효과를 낸다.'
  },
  spell: {
    label: '마법',
    // 일회용이라 판에 남지 않는다. 스탯이 0이므로 총량을 낮춰야 소환수와 맞는다.
    budgetMult: 0.70,
    statDivisor: null,
    why: '일회용 즉발. 판에 남지 않으므로 총량이 낮다.'
  },
  trap: {
    label: '함정',
    // 조건이 안 맞으면 **아무 일도 없다.** 그 위험을 총량으로 보상한다.
    // 마법(0.70)보다 높고 소환수(1.00)보다 낮다 — 조건부 보상은 여기서만 준다.
    // ⚠️ trapTrigger에 값을 다시 매기면 이 보상이 상쇄된다. 그쪽은 cost 0이다.
    budgetMult: 0.85,
    statDivisor: null,
    why: '조건부. 발동하지 못할 위험을 총량으로 보상받는다.'
  }
};

export function typePowerSpec(cardType) {
  return TYPE_POWER[cardType] || TYPE_POWER.unit;
}

/**
 * 지불 가능한 총 파워.
 * @param cardType 타입별 배수를 적용한다. 생략하면 소환수 기준.
 */
export function affordablePower(rarity, cost, cardType = 'unit') {
  const spec = RARITY_POWER[rarity] || RARITY_POWER.common;
  const c = Math.max(0, Math.min(spec.maxCost, parseInt(cost) || 0));
  return (spec.base + c * spec.perMana) * typePowerSpec(cardType).budgetMult;
}

/**
 * 스탯 곡선 지수. 1이면 선형(예전), 1보다 크면 **고타점이 비싸진다.**
 *
 * 🐛 왜 선형이 틀렸나: 예전에는 `공격력 / 5`처럼 선형이었다. 그러면
 *    공격력 26이 6의 정확히 4.3배 값이 된다. 하지만 실제 가치는 선형보다
 *    빠르게 오른다 — 고타점은 **한 방에 상대 소환수를 정리하는 문턱**을
 *    넘기 때문이다. 공격력 10짜리 두 기와 20짜리 한 기는 총합이 같아도
 *    20짜리가 훨씬 강하다 (교환에서 이기고, 벽을 뚫고, 처형 사거리가 길다).
 *
 * 체력은 반대로 **체감**한다. 체력 40은 20의 두 배지만, 어차피 한 턴에
 * 여러 번 맞으면 죽고 방어막·회복으로 메울 수 있어 두 배만큼 강하지 않다.
 *
 * ⚠️ 기준점 정규화: `(값/기준)^지수 × (기준/단가)` 꼴로 계산해
 *    **등급 중간값에서는 선형과 같은 값**이 나오게 맞췄다.
 *    그래서 전형적인 카드의 코스트는 그대로고, 극단값만 벌어진다.
 */
export const STAT_CURVE = {
  attack:  { exp: 1.35, pivot: 14 },   // 체증 — 고타점은 문턱을 넘는다
  hp:      { exp: 0.85, pivot: 24 },   // 체감 — 체력은 쌓아도 선형만큼은 아니다
  defense: { exp: 1.15, pivot: 7 }     // 약한 체증 — 수비력은 피해를 매번 깎는다
};

function curvedStat(raw, divisor, curve) {
  const v = Math.max(0, parseInt(raw) || 0);
  if (v === 0) return 0;
  if (!curve) return v / divisor;
  // 기준값(pivot)에서 선형과 정확히 같아지도록 정규화한다
  return Math.pow(v / curve.pivot, curve.exp) * (curve.pivot / divisor);
}

/** 스탯이 소비하는 파워 (타입별 단가 + 체증/체감 곡선) */
export function statPower(cardData) {
  const div = typePowerSpec(cardData.cardType || 'unit').statDivisor;
  if (!div) return 0;   // 마법·함정은 스탯이 없다
  return curvedStat(cardData.attack, div.attack, STAT_CURVE.attack)
       + curvedStat(cardData.hp, div.hp, STAT_CURVE.hp)
       + curvedStat(cardData.defense, div.defense, STAT_CURVE.defense);
}

/**
 * 카드의 파워 수지를 계산한다. (진단용 — 아무것도 변경하지 않음)
 * @returns { affordable, effectPower, statPower, used, balance, overBudget, effects, illegal }
 */
export function evaluateCardPower(cardData) {
  const rarity = (cardData && RARITY_POWER[cardData.rarity]) ? cardData.rarity : 'common';
  const cardType = (cardData && cardData.cardType) || 'unit';   // 타입별 예산 배수용
  const skill = (cardData && (cardData.skill || (cardData.skills && cardData.skills[0]))) || {};
  const effects = listActiveEffects(skill);

  // 🎯 대상이 늘면 카드가 강해진다. 예산에 반드시 반영한다.
  //    안 하면 "적 전체 20 피해"가 "적 1체 20 피해"와 같은 값으로 취급된다.
  //    ⚠️ 대상과 무관한 효과(방어막·마나 수급 등)에는 곱하지 않는다 —
  //       내 방어막은 상대가 몇 명이든 똑같이 하나다.
  const tMult = targetCostMultiplier(skill);
  const TARGET_SCALED = new Set(['damage', 'heal', 'statusEffect', 'multiHit', 'lifestealPercent']);

  // ❤️ 체력 대상 배수 — 본체 회복이 소환수 회복보다 비싸다.
  //    본체 체력은 패배까지의 거리를 늘리지만, 소환수 체력은 그 소환수가 죽으면 사라진다.
  const hMult = hpTargetCostMultiplier(skill);

  // 💥 피해 대상 배수 — 본체 직격이 기물 제거보다 비싸다.
  //    전장 차단 규칙(DECISIONS #81) 때문에 본체를 직접 때리는 마법은
  //    "전장을 뚫지 않고 승리 조건에 다가가는" 유일한 수단이다.
  const dMult = damageTargetCostMultiplier(skill);

  const effectPower = effects.reduce((sum, e) => {
    let c = e.cost;
    if (TARGET_SCALED.has(e.key)) c *= tMult;
    if (e.key === 'heal') c *= hMult;
    if (e.key === 'damage' || e.key === 'multiHit') c *= dMult;
    return sum + c;
  }, 0);
  const stats = statPower(cardData || {});
  const used = effectPower + stats;
  const affordable = affordablePower(rarity, cardData ? cardData.cost : 0, cardType);
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
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;   // 크기 하한용
  // ⚠️ 깊은 복사가 필요하다. statusEffect / passiveEffect는 중첩 객체이고
  //    2-c 단계가 그 안의 수치를 깎으므로, 얕은 복사면 **호출자의 원본까지**
  //    바뀐다 (LLM 응답 객체가 조용히 변형되는 버그가 된다).
  const out = { ...skill };
  if (skill.statusEffect) out.statusEffect = { ...skill.statusEffect };
  // 🚫 봉쇄(기절·빙결)는 bodyStatus로도 본체에 걸리지 않는다 (DECISIONS #94).
  //    카드가 그 약속을 들고 있으면 지운다 — 할증도, 설명문의 "본체"도 함께 사라진다. 멱등하다.
  //    사이클(기생·성장)도 본체에 못 걸리므로 bodyStatus 할증을 받지 않는다 (DECISIONS #104)
  if (out.bodyStatus && out.statusEffect
      && (BLOCKING_STATUSES.has(out.statusEffect.type) || BODY_BLOCKED_STATUSES.has(out.statusEffect.type))) delete out.bodyStatus;
  // 🔢 위력이 곧 효과인 상태이상(화상·맹독·감전·빙결·부식…)에 value 0이 오면 **아무 일도 안 하는 카드**가 된다.
  //    기절·취약처럼 value를 안 쓰는 것만 0으로 둔다. 기본값은 STATUS_EFFECTS 한 곳에서 온다 — 멱등하다.
  //    🐛 예전엔 빙결이 봉쇄라 value가 장식이었고, LLM이 0을 자주 냈다. 이제 value가 곧 깎이는 공격력이다.
  if (out.statusEffect && out.statusEffect.type && out.statusEffect.type !== 'none') {
    const stSpec = STATUS_EFFECTS[out.statusEffect.type];
    if (stSpec && stSpec.defaultValue > 0 && !(out.statusEffect.value > 0)) {
      out.statusEffect.value = stSpec.defaultValue;
    }
  }
  if (skill.passiveEffect) {
    out.passiveEffect = { ...skill.passiveEffect };
    if (skill.passiveEffect.aura) out.passiveEffect.aura = { ...skill.passiveEffect.aura };
  }
  const removed = [];
  let cost = Math.max(1, Math.min(spec.maxCost, parseInt(cardData.cost) || 1));
  let atk = parseInt(cardData.attack) || 0;
  let hp = parseInt(cardData.hp) || 0;
  let def = parseInt(cardData.defense) || 0;

  const clearEffect = (key) => {
    if (key === 'statusEffect') out.statusEffect = { type: 'none', duration: 0, value: 0 };
    else if (key === 'multiHit') out.multiHit = 1;
    else if (key === 'passiveEffect') {
      // 매 턴 누적분만 지운다 — 오라는 별도 항목(aura)이 담당한다
      if (out.passiveEffect) {
        for (const k of PER_TURN_PASSIVE_KEYS) delete out.passiveEffect[k];
        if (Object.keys(out.passiveEffect).length === 0) delete out.passiveEffect;
      }
    }
    else if (key === 'aura') {
      if (out.passiveEffect) {
        delete out.passiveEffect.aura;
        if (Object.keys(out.passiveEffect).length === 0) delete out.passiveEffect;
      }
    }
    else if (key === 'trapTrigger') delete out.trapTrigger;
    else if (key === 'isAoeSpell' || key === 'pierceShield' || key === 'doubleCastNext' || key === 'directAttack') out[key] = false;
    else out[key] = 0;
  };

  // 1. 등급 요건 미달 제거
  //
  //    🏛️ 건축물에 예외 처리가 있었는데 **없앴다.**
  //    예전에는 커먼 건축물의 패시브가 통째로 삭제돼(백지 카드) 여기서
  //    `if (isStructure && ...) continue`로 건너뛰었다. 하지만 그건 증상만
  //    가린 것이었다. 진짜 원인은 **모든 타입이 예산을 공유**해서
  //    건축물의 체력(hp×1.3)이 예산을 다 먹은 것이었다.
  //    TYPE_POWER로 타입별 예산을 나눈 뒤에는 예외가 필요 없다.
  //    (등급 4 × 마나 2 × 플레이스타일 6 = 48개 조합을 **최대 스탯**으로
  //     돌려 전부 패시브가 유지되는 것을 확인했다 → DECISIONS #69)
  //
  //    ⚠️ 여기에 타입 예외를 다시 추가하고 싶어지면, 먼저 TYPE_POWER 쪽이
  //       잘못된 게 아닌지 보세요. 예외는 거의 항상 예산 모델의 오류 신호입니다.
  const cardType = cardData.cardType || 'unit';
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
    const h = hpTargetCostMultiplier(out);
    const d = damageTargetCostMultiplier(out);
    return listActiveEffects(out).reduce((s, e) => {
      let c = e.cost;
      if (TARGET_SCALED.has(e.key)) c *= m;
      if (e.key === 'heal') c *= h;      // ❤️ 본체 회복이 소환수 회복보다 비싸다
      if (e.key === 'damage' || e.key === 'multiHit') c *= d;   // 💥 본체 직격이 더 비싸다
      return s + c;
    }, 0) + statPower({ ...cardData, attack: atk, hp, defense: def });
  };

  // 💎 코스트가 **미리 정해진** 카드인가 (덱 커브에서 굴려 LLM에 넘긴 값).
  //    잠겨 있으면 코스트를 움직이지 않고 **내용을 깎아서** 맞춘다.
  //    🐛 이게 없으면 등급별 스탯 하한(레전더리 공18/체30) 때문에 1마나 카드가
  //       전부 2마나로 밀려 올라가, 덱에 1코가 사라진다.
  //       (측정: 잠금 전 최종 커브가 2코 64% / 1코 0%)
  const costLocked = !!cardData.costLocked;

  // 2. 효과를 지우기 전에 마나 코스트를 올려 값을 치른다
  //    "낮은 등급이 여러 효과를 갖되 마나를 많이 쓴다"는 규칙이 여기서 나온다
  let costRaised = 0;
  if (!costLocked) {
    while (usedPower() > affordablePower(rarity, cost, cardType) && cost < spec.maxCost) {
      cost++;
      costRaised++;
    }
  }

  // 2-a. 🐛 반대로 **너무 싸게 먹히면 코스트를 내린다.**
  //
  //   예전에는 예산이 코스트를 **올리기만** 했다. 그래서 생성기가 무작위로
  //   높은 코스트를 뽑으면 그대로 남았고, "6마나 커먼 소환수, 효과 없음,
  //   예산 10 중 3.9 사용" 같은 카드가 나왔다. 이건 선택지가 아니라 死카드다.
  //
  //   ⚠️ 저등급 고코스트 카드 자체를 없애는 게 아니다. **효과가 좋아서**
  //      값을 치르는 카드는 usedPower가 높으므로 여기서 내려가지 않는다.
  //      값을 치를 것이 없는 카드만 내려간다.
  //   ⚠️ 바닥은 **1**이다. 예전에는 등급별 costRange[0]이었는데, 그것 때문에
  //      레어+ 카드가 1~2마나로 내려가지 못해 덱에 저코스트가 사라졌다.
  const costFloor = 1;
  let costLowered = 0;
  if (!costLocked) {
    while (cost > costFloor && usedPower() <= affordablePower(rarity, cost - 1, cardType)) {
      cost--;
      costLowered++;
    }
  }

  // ⚖️ 예산 초과 허용 (연성소 옵션, DECISIONS #100): 유저가 요구한 효과·스탯은 **하나도 깎지 않는다.**
  //    밸런스는 마나로만 맞춘다(위에서 상한까지 올렸다). 그래도 남는 초과분은 powerDebt로 돌려주고,
  //    연성소가 그만큼 가루를 받는다(dustForExcessPower). 등급 전용 효과 제거(1단계)는 그대로 적용된다.
  if (cardData.allowOverBudget) {
    const debt = Math.max(0, usedPower() - affordablePower(rarity, cost, cardType));
    return { skill: out, cost, attack: atk, hp, defense: def, removed, costRaised, costLowered, trimmedValues: [], powerDebt: Math.round(debt * 100) / 100 };
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
  while (usedPower() > affordablePower(rarity, cost, cardType) && narrowOnce()) {
    narrowed++;
    // 범위를 줄여 여유가 생겼으면 마나를 다시 올려볼 필요는 없다 (이미 최대)
  }
  if (narrowed > 0) {
    removed.push({ key: 'targetScope', label: '대상 범위', reason: `예산에 맞춰 ${describeTarget(out)}(으)로 축소` });
  }

  // 2-c. 📏 그래도 넘치면 **효과의 크기를 깎는다.**
  //
  //   효과 크기가 예산에 들어간 뒤로는 이 단계가 반드시 필요하다.
  //   없으면 "28 피해"짜리 카드가 예산을 넘을 때 **피해 효과를 통째로 잃는다.**
  //   크기를 20으로 줄이는 편이 훨씬 덜 파괴적이다.
  //
  //   등급 하한(RARITY_BALANCE_CAPS)까지만 깎는다. 그 아래로 내려가면
  //   등급 표기와 실제 성능이 어긋난다.
  const trimFloor = {
    damage: caps.spellDamage[0], shield: caps.shieldValue[0], heal: caps.healValue[0],
    attackDown: caps.buffValue[0], drawCards: 1, manaGain: 1, damageReduction: 10,
    invulnerableTurns: 1, critChance: 0.15, lifestealPercent: 0.2, executeThreshold: 0.2
  };
  const RATIO_KEYS = new Set(['critChance', 'lifestealPercent', 'executeThreshold']);
  const trimOnce = () => {
    // 지금 가장 비싼 크기 효과를 한 단계 깎는다 (비싼 것부터 줄이는 게 효율적)
    let pick = null, pickCost = 0;
    for (const e of listActiveEffects(out)) {
      if (!EFFECT_MAGNITUDE[e.key]) continue;
      const floor = trimFloor[e.key];
      if (floor === undefined) continue;
      if (typeof out[e.key] !== 'number' || out[e.key] <= floor) continue;
      if (e.cost > pickCost) { pickCost = e.cost; pick = e.key; }
    }
    if (pick) {
      const step = RATIO_KEYS.has(pick) ? 0.05 : Math.max(1, Math.round(out[pick] * 0.1));
      out[pick] = Math.max(trimFloor[pick], Number((out[pick] - step).toFixed(2)));
      return true;
    }
    // 상태이상은 중첩 필드다. 지속턴을 먼저 줄이고 그다음 위력을 줄인다.
    const st = out.statusEffect;
    if (st && st.type && st.type !== 'none') {
      if ((st.duration || 1) > 1) { st.duration -= 1; return true; }
      if ((st.value || 0) > caps.buffValue[0]) { st.value = Math.max(caps.buffValue[0], st.value - 2); return true; }
    }
    // 🏛️ 건축물 패시브 / 오라의 수치
    const p = out.passiveEffect;
    if (p) {
      for (const k of ['endTurnAoeShield', 'endTurnShield', 'endTurnAoeHeal']) {
        if ((p[k] || 0) > 2) { p[k] = Math.max(2, p[k] - 2); return true; }
      }
      if (p.aura) {
        for (const k of ['attackBonus', 'defenseBonus']) {
          if ((p.aura[k] || 0) > 1) { p.aura[k] -= 1; return true; }
        }
        if ((p.aura.damageReduction || 0) > 5) { p.aura.damageReduction = Math.max(5, p.aura.damageReduction - 5); return true; }
      }
    }
    return false;
  };
  let trimmedValues = 0;
  // ⚠️ 상한 200 — trimOnce가 항상 감소하므로 무한 루프는 없지만,
  //    누군가 floor보다 큰 step을 넣으면 진동할 수 있다. 방어적으로 둔다.
  while (usedPower() > affordablePower(rarity, cost, cardType) && trimmedValues < 200 && trimOnce()) {
    trimmedValues++;
  }

  // ── 스탯 깎기 헬퍼 ─────────────────────────────────────────
  //    바닥을 인자로 받는다. 3단계는 **등급 하한**까지만, 5단계는 **절대 하한**까지.
  const shaveStats = (floorAtk, floorHp, floorDef) => {
    let guard = 0;
    while (usedPower() > affordablePower(rarity, cost, cardType) && guard++ < 80) {
      if (atk > floorAtk && atk >= hp / 2) atk -= 1;
      else if (hp > floorHp) hp -= 2;
      else if (def > floorDef) def -= 1;
      else if (atk > floorAtk) atk -= 1;      // hp/def가 바닥이면 공격력으로 마저 메운다
      else break;
    }
  };

  // 3. 🛡️ **스탯을 먼저 깎는다** (기초 스탯보다 효과를 우선 보존).
  //    유저 지침: "기본적으로 기초 스탯보다는 효과 쪽이 좀 더 남았으면 좋겠어. 스탯을 먼저 깎는 거지."
  //    효과는 카드의 **정체성**이고 스탯은 상대적으로 대체 가능하다.
  //    3-a: 먼저 등급 하한까지 스탯을 깎는다.
  //    3-b: 효과가 지워질 위기라면, 효과를 지우기 전에 스탯을 절대 하한(1/4/0)까지 먼저 깎아 효과를 사수한다.
  const isBodyless = (cardType === 'spell' || cardType === 'trap');
  if (!isBodyless) {
    shaveStats(caps.atkRange[0], caps.hpRange[0], caps.defRange[0]);
    if (usedPower() > affordablePower(rarity, cost, cardType) && !out.isVanilla) {
      shaveStats(1, 4, 0);
    }
  }

  // 4. 그래도 넘치면 비싼 부가 효과부터 제거
  //    ⚠️ 바닐라 의도(isVanilla: true)가 아니면 마지막 1개 핵심 효과는 반드시 남긴다.
  //    스탯을 깎아서라도 카드의 개성(스킬)을 살리고, 남은 초과분은 7단계 코스트 인상으로 지불한다.
  const mustKeepEffect = !out.isVanilla;
  let effects = listActiveEffects(out).sort((a, b) => b.cost - a.cost);
  for (const e of effects) {
    if (usedPower() <= affordablePower(rarity, cost, cardType)) break;
    // trapTrigger는 조건이라 효과 수에 넣지 않는다 (넣으면 진짜 효과가 0이 된다)
    if (mustKeepEffect && listActiveEffects(out).filter(x => x.key !== 'trapTrigger').length <= 1) break;
    clearEffect(e.key);
    removed.push({ ...e, reason: `예산 초과 (${rarity} / 마나 ${cost})` });
  }

  // 5. 스탯 절대 하한 점검 (공1 / 체4 / 방0)
  if (!isBodyless) {
    shaveStats(1, 4, 0);
  }

  // 6. 🃏 효과가 하나도 안 남았으면 **바닐라 카드**가 된다.
  //
  //   🐛 예전에는 여기서 억지로 피해 효과를 되살렸다. 두 가지가 잘못됐다:
  //      ① 이 블록이 맨 마지막이라, 예산을 맞추려고 지운 효과를 되살려
  //         검사를 통과한 뒤 카드가 조용히 예산을 넘겼다 (25% 초과)
  //      ② 애초에 **모든 카드가 효과를 가져야 한다는 전제가 틀렸다.**
  //         실제 TCG에서 효과 없는 카드는 정상적인 종류다 — 바닐라.
  //   ⚠️ **바닐라는 소환수 전용이다.** 마법·함정·건축물은 위 4단계가 마지막
  //      효과를 남기므로 여기 걸리지 않지만, LLM이 애초에 효과를 하나도 안 준
  //      경우가 있다. 그때는 백지 카드가 되므로 최소 효과를 넣어준다.
  //   ⚠️ trapTrigger는 **조건이지 효과가 아니다.** 세면 안 된다.
  //      🐛 세는 바람에 효과 0인 함정이 "효과 1개"로 통과했고,
  //         설명문이 "조건 충족 시 발동합니다."만 남았다 — 터져도 아무 일이 없다.
  const realEffects = listActiveEffects(out).filter(e => e.key !== 'trapTrigger');
  if (realEffects.length === 0) {
    if (cardType === 'unit') {
      // 효과가 없으면 바닐라다. 여기서 피해 효과를 **지어내지 않는다** — 예산 정산 뒤 효과를 되살리면
      // 검사를 통과한 뒤 카드가 조용히 예산을 넘기고(규칙 35), 모든 소환수가 "피해 N" 카드로 균질화된다(#85).
      // 스탯보다 효과를 살리는 유저 지침은 위 3-b(효과를 지우기 전에 스탯을 절대 하한까지 깎기)와
      // mustKeepEffect(바닐라 의도가 아니면 마지막 효과 보존)가 이미 지킨다 — 여기까지 왔다면 LLM이 효과를 안 준 것이다.
      out.isVanilla = true;
    } else if (cardType === 'structure') {
      // ⚠️ `||`로는 부족하다. 예산이 오라만 지우고 **빈 객체 `{}`**를 남기면
      //    truthy라서 폴백이 안 걸리고, 설명문이 통째로 비어 버린다 (실측).
      const p = out.passiveEffect;
      const hasContent = p && Object.keys(p).some(k => p[k] && (typeof p[k] !== 'object' || Object.keys(p[k]).length));
      if (!hasContent) out.passiveEffect = buildStructurePassive('control', rarity);
    } else {
      out.damage = Math.max(1, caps.spellDamage[0]);
    }
  }

  // 7. 🔒 마지막 안전밸브 — 여기까지 다 깎았는데도 넘치면 코스트를 올린다.
  //    잠긴 코스트라도 "무슨 일이 있어도 고정"은 아니다. 망가진 카드보다 낫다.
  while (usedPower() > affordablePower(rarity, cost, cardType) && cost < spec.maxCost) {
    cost++;
    costRaised++;
  }

  return { skill: out, cost, attack: atk, hp, defense: def, removed, costRaised, costLowered, trimmedValues, powerDebt: 0 };
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
/**
 * @param cardData 있으면 설명문의 "N 공격" 같은 **스탯 수치**도 맞춘다.
 *   🐛 예전에는 스킬 수치만 맞췄다. 그래서 폴백 생성기가 쓴
 *      "암흑 마력을 실어 15 공격을 가합니다"가 예산이 공격력을 11로 깎은 뒤에도
 *      15로 남았다 (실측으로 발견). 카드에 적힌 수치와 실제가 달랐다.
 */
export function syncDescriptionNumbers(desc, skill, cardData = null) {
  let out = String(desc || '');

  // ⚠️ `%`가 붙은 숫자는 건드리지 않는다.
  //    "피해를 50% 줄인다"의 50은 피해량이 아니라 **비율**이다.
  //    바꿔버리면 "피해를 24% 줄인다"처럼 엉뚱한 뜻이 된다.
  // ⚠️ 숫자와 명사 사이에 **조사가 낀다**: "15를 회복", "20의 피해", "10만큼 회복"
  //    이걸 허용하지 않으면 조사가 붙은 순간 동기화가 통째로 실패한다.
  const JOSA = '(?:\\s*(?:을|를|이|가|의|만큼|정도)?)';
  // 🐛 연타(multiHit)는 **총량**을 써야 한다. 여기만 개별 타격값(skill.damage)을
  //    쓰고 있어서, "12씩 3연타로 총 36 피해"를 "총 12 피해"로 고쳐 썼다.
  //    describeSkillFromData와 card-validator는 둘 다 총량을 쓴다 — 여기가 어긋났다.
  const totalDamage = skill.multiHit > 1 ? skill.damage * skill.multiHit : skill.damage;

  // ⚠️ 숫자 뒤 경계는 `(?![\d%])`로 잡는다.
  //    🐛 예전에는 `(?!\s*%)`였다. 정규식은 되추적하므로 "30%"에서 "30"이 막히면
  //       **"3"으로 물러나 매치**된다. 실측: "상대 체력 30% 이하면 처형"이
  //       "상대 체력 +3 이하면 처형"으로 깨졌다. 비율이 통째로 망가진다.
  const NOT_NUM_OR_PCT = '(?![\\d%])';

  const rules = [
    [totalDamage, new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(${JOSA}\\s*(?:추가\\s*)?(?:고정\\s*)?(?:피해|데미지|damage))`, 'gi')],
    [skill.shield, new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(${JOSA}\\s*(?:방어막|실드|보호막|shield))`, 'gi')],
    [skill.heal,   new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(${JOSA}\\s*(?:회복|치유|heal))`, 'gi')],
    // 🐛 드로우·마나 수급이 빠져 있었다. 예산이 값을 깎아 drawCards가 3→1이
    //    되어도 설명문은 "카드 3장을 뽑는다"로 남았다. 카드가 거짓말을 한다.
    //    ⚠️ "카드 3장" / "3장의 카드" 두 어순을 모두 본다.
    [skill.drawCards, new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(\\s*장)`, 'gi')],
    [skill.manaGain,  new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(${JOSA}\\s*(?:마나|mana))`, 'gi')]
  ];

  // 🗡️ 연타 표기는 엔진이 "N씩 M연타(총 T)" 형태로 쓴다.
  //    🐛 위 규칙은 `숫자 + 조사 + 피해`만 보므로 괄호가 끼면 못 잡았다.
  //       그래서 **엔진이 자기가 만든 문장을 동기화하지 못했다** —
  //       등급 하한이 피해를 8→18로 올려도 문장은 "8씩 3연타(총 24)"로 남았다.
  if (skill.multiHit > 1 && skill.damage > 0) {
    out = out.replace(/(\d+)\s*씩\s*(\d+)\s*연타\s*\(\s*총\s*(\d+)\s*\)/g,
      () => `${skill.damage}씩 ${skill.multiHit}연타(총 ${skill.damage * skill.multiHit})`);
  }

  for (const [value, re] of rules) {
    if (!Number.isFinite(value) || value <= 0) continue;
    out = out.replace(re, (_m, _num, tail) => `${value}${tail}`);
  }

  // 어순이 뒤집힌 표기도 있다: "방어막 99를 얻는다", "체력 15 회복", "방어막 +12"
  // 위 규칙은 `숫자 + 명사`만 잡으므로 `명사 + 숫자`도 따로 본다.
  // ⚠️ `+`를 허용해야 한다. 🐛 엔진이 스스로 "본체 방어막 +12"라고 쓰는데
  //    규칙이 `+`를 몰라서 **자기가 만든 문장을 동기화하지 못했다**
  //    (등급 하한이 방어막을 16으로 올려도 문장은 12로 남았다).
  const reverse = [
    [totalDamage, new RegExp(`((?:피해|데미지)\\s*\\+?\\s*)(\\d+)${NOT_NUM_OR_PCT}`, 'gi')],
    [skill.shield, new RegExp(`((?:방어막|실드|보호막)\\s*\\+?\\s*)(\\d+)${NOT_NUM_OR_PCT}`, 'gi')],
    [skill.heal,   new RegExp(`((?:체력)\\s*\\+?\\s*)(\\d+)${NOT_NUM_OR_PCT}`, 'gi')],
    [skill.drawCards, /((?:카드)\s*)(\d+)(?=\s*장)/gi],
    [skill.manaGain,  new RegExp(`((?:마나)\\s*\\+?\\s*)(\\d+)${NOT_NUM_OR_PCT}`, 'gi')]
  ];
  for (const [value, re] of reverse) {
    if (!Number.isFinite(value) || value <= 0) continue;
    out = out.replace(re, (_m, head) => `${head}${value}`);
  }

  // 🗡️ 스탯 수치 동기화 — "15 공격을 가합니다" 같은 문장.
  //    예산이 공격력을 깎으면 이 숫자도 따라가야 한다.
  if (cardData) {
    const statRules = [
      [parseInt(cardData.attack) || 0, new RegExp(`(\\d+)${NOT_NUM_OR_PCT}(${JOSA}\\s*공격)`, 'gi')],
      [parseInt(cardData.attack) || 0, new RegExp(`((?:공격력)\\s*\\+?\\s*)(\\d+)${NOT_NUM_OR_PCT}`, 'gi')]
    ];
    for (const [value, re] of statRules) {
      if (!(value > 0)) continue;
      out = out.replace(re, (m, a, b) => (/^\d+$/.test(a) ? `${value}${b}` : `${a}${value}`));
    }
  }

  // 위 규칙에 안 걸린 비상식적인 큰 수는 남겨두면 오해를 부른다.
  // (예: "적 방어막을 100 무시하고") — 세 자리 이상은 두 자리로 눌러 표기만 정리한다.
  // ⚠️ %가 붙은 숫자는 비율이므로 건드리지 않는다
  //    ("100% 무효"가 "10% 무효"로 바뀌면 뜻이 완전히 달라진다)
  out = out.replace(/\b(\d{3,})\b(?![\d%])/g, (m) => {
    const n = parseInt(m, 10);
    return String(Math.min(99, Math.max(1, Math.round(n / 10))));
  });

  return out;
}

/**
 * 설명문의 "체력"이 **플레이어 본체**임을 못박는다.
 *
 * 카드에 찍힌 ❤️는 그 소환수 자신의 체력이지만,
 * 엔진의 `skill.heal`과 `lowHp` 트리거는 **플레이어 본체 HP**를 본다.
 * 둘이 다른데 설명문은 똑같이 "체력"이라고만 써서 구분이 안 됐다.
 * 실제 동작이 본체이므로 표기를 본체로 통일한다.
 */
function clarifyHpSubject(desc = '', hpTarget = 'body') {
  // ❤️ 카드가 "이 소환수" 체력을 대상으로 하면 그렇게 적는다.
  //    무조건 본체로 못박으면 소환수 회복 카드가 거짓말을 하게 된다.
  const subject = hpTarget === 'minion' ? '이 소환수의 체력' : '본체 체력';
  const short = hpTarget === 'minion' ? '이 소환수' : '본체';

  let out = String(desc || '')
    // "본인이 / 자신의 / 내" + 체력
    .replace(/(본인|자신|내)\s*(이|가|의)?\s*체력/g, hpTarget === 'minion' ? '이 소환수의 체력' : '내 본체 체력')
    // 남은 "체력 N 회복 / 체력을 회복"
    .replace(/(?<!본체\s)(?<!소환수의\s)체력(?=\s*\d*\s*(을|를)?\s*(회복|치유))/g, subject);

  // "체력이 절반 이하" — lowHp 조건은 **언제나 본체**다 (엔진이 그렇게 본다)
  out = out.replace(/(?<!본체\s)체력이\s*(절반|반)\s*이하/g, '본체 체력이 절반 이하');

  return out
    .replace(/(내\s*)?본체\s*본체/g, '본체')
    .replace(/이 소환수의\s*이 소환수의/g, '이 소환수의')
    .replace(/\s+(을|를|이|가)\b/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 🪤 함정이 아닌 카드에서 **반응형 문구**를 걷어낸다.
 *
 * `trapTrigger` 필드는 막았지만 LLM은 필드를 안 쓰고 **설명문에 산문으로** 쓴다.
 *   "어떤 적 카드가 소환될 때 그 카드를 즉시 제거하고..."  ← 소환수에 붙어 있었다
 * 필드가 비어 있으니 엔진은 아무것도 하지 않고, 카드만 거짓말을 한다.
 * 게다가 소환수가 이런 걸 하면 함정 카드의 존재 이유가 사라진다.
 *
 * ⚠️ "소환 시 / 발동 시"는 **자기 자신을 낼 때**라 정상이다. 지우면 안 된다.
 *    지우는 것은 **상대 행동**이나 **지속 조건**에 반응하는 절뿐이다.
 */
function stripReactiveClauses(desc = '') {
  let out = String(desc || '');

  // 상대 행동에 반응하는 절 — 문장 단위로 통째로 제거
  const REACTIVE = [
    // "(어떤) 적/상대 (카드)가 ~할 때/하면 ~한다"
    /[^.。]*?(?:적|상대)[^.。]*?(?:소환|발동|사용|공격|낼|내면|플레이)[^.。]*?(?:때|때마다|하면|되면)[^.。]*?[.。]?/g,
    // "내/본체 체력이 N% 이하가 될 때 ~"  (지속 감시 조건)
    /[^.。]*?체력이[^.。]*?(?:이하|미만)[^.。]*?(?:될\s*때|일\s*때|되면)[^.。]*?[.。]?/g,
    // "다음 턴에 ~" (지연 효과 — 예약 시스템이 없다)
    /[^.。]*?다음\s*턴에[^.。]*?[.。]?/g
  ];

  for (const re of REACTIVE) out = out.replace(re, ' ');

  out = out.replace(/\s{2,}/g, ' ').replace(/^[\s,·]+|[\s,·]+$/g, '').trim();
  return out;
}

/**
 * 스킬 데이터로부터 설명문을 **직접 만든다.**
 *
 * LLM 산문은 계속 실제 동작과 어긋난다 (없는 효과를 쓰고, 수치를 지어내고,
 * 함정 효과를 소환수에 붙인다). 정규식으로 뒤쫓는 데는 한계가 있다.
 * 여기서 만든 문장은 **데이터가 곧 문장**이라 절대 어긋나지 않는다.
 *
 * 산문이 통째로 걸러졌을 때의 대체용으로 쓴다.
 */
export function describeSkillFromData(skill = {}, cardType = 'unit') {
  const parts = [];
  const t = readTargetSpec(skill);
  const tgt = describeTarget(skill);

  if (skill.damage > 0) {
    const total = skill.multiHit > 1 ? skill.damage * skill.multiHit : skill.damage;
    // 💥 표적 문구는 describeTarget이 만든다 (피해 대상까지 반영한다).
    //    🐛 예전에는 여기서 문자열을 잘라 붙이다 **개수를 잃었다**
    //       ("적 2체" → "적 전장의 기물"). 문구는 한 곳에서만 만든다.
    parts.push(skill.multiHit > 1
      ? `${tgt}에게 ${skill.damage}씩 ${skill.multiHit}연타(총 ${total}) 피해`
      : `${tgt}에게 ${skill.damage} 피해`);
  }
  if (skill.pierceShield) parts.push('방어막 관통');
  if (skill.critChance > 0) parts.push(`${Math.round(skill.critChance * 100)}% 확률로 치명타 ${skill.critMultiplier || 1.8}배`);
  if (skill.lifestealPercent > 0) parts.push(`가한 피해의 ${Math.round(skill.lifestealPercent * 100)}%를 본체 체력으로 흡혈`);
  if (skill.executeThreshold > 0) parts.push(`상대 체력 ${Math.round(skill.executeThreshold * 100)}% 이하면 처형(2배)`);
  if (skill.shield > 0) parts.push(`본체 방어막 +${skill.shield}`);
  if (skill.heal > 0) {
    // 🎯 아군을 지정하는 회복이면 그렇게 적는다.
    //    (heal이 picked를 존중하게 된 뒤로는 "아군 1체 회복"이 실제 동작이다)
    if (t.side === 'ally' && (t.scope === 'single' || t.scope === 'multi')) {
      parts.push(`${tgt}의 체력 ${skill.heal} 회복`);
    } else {
      parts.push(readHpTarget(skill) === 'minion'
        ? `이 소환수의 체력 ${skill.heal} 회복`
        : `본체 체력 ${skill.heal} 회복`);
    }
  }
  if (skill.damageReduction > 0) parts.push(`받는 피해 ${skill.damageReduction}% 감소`);
  if (skill.attackDown > 0) parts.push(`${tgt}의 공격력 -${skill.attackDown}`);
  if (skill.silence) parts.push(`${tgt}의 효과 무효화`);
  if (skill.maxHpGain > 0) parts.push(`본체 최대 체력 +${skill.maxHpGain}`);
  if (skill.manaGain > 0) parts.push(`마나 +${skill.manaGain}`);
  if (skill.drawCards > 0) parts.push(`카드 ${skill.drawCards}장 드로우`);
  if (skill.discardCard) parts.push('상대 손패 1장 파기');
  // 🆕 파괴·서치·토큰 소환 (DECISIONS #85)
  if (skill.destroy > 0) parts.push(`${tgt} 파괴`);
  if (skill.searchDeck > 0) parts.push(`덱에서 카드 ${skill.searchDeck}장 서치`);
  if (skill.summonToken > 0) parts.push(`토큰 ${skill.summonToken}체 소환 (4/2/10)`);
  if (skill.doubleCastNext) parts.push('다음 카드 2연속 발동');
  if (skill.invulnerableTurns > 0) parts.push(`${skill.invulnerableTurns}턴간 무적`);
  if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
    const st = skill.statusEffect;
    const val = st.value ? ` ${st.value}` : '';
    // 🐛 수정: `st.type`은 **엔진 키**다("freeze"). 카드에 영어가 그대로 찍혔다.
    //    카드 텍스트는 전부 한국어여야 한다.
    const stName = (STATUS_EFFECTS[st.type] && STATUS_EFFECTS[st.type].name) || st.type;
    parts.push(`${tgt}에게 ${stName}${val} (${st.duration || 1}턴)`);
  }
  if (skill.passiveEffect) {
    const p = skill.passiveEffect;
    if (p.manaPerTurn) parts.push(`매 턴 마나 +${p.manaPerTurn}`);
    if (p.endTurnShield) parts.push(`턴 종료 시 본체 방어막 +${p.endTurnShield}`);
    if (p.endTurnAoeShield) parts.push(`턴 종료 시 본체 방어막 +${p.endTurnAoeShield} & 자기 내구도 수리`);
    if (p.endTurnAoeHeal) parts.push(`턴 종료 시 본체 체력 +${p.endTurnAoeHeal}`);
    // 🐛 오라 분기가 **없었다.** describeStructurePassive에만 넣고 여기를 빠뜨려서,
    //    오라만 가진 패시브(저등급 건축물은 전부 오라다)가 빈 문장을 냈다.
    //    그 결과 건축물이 플레이버 텍스트를 달고 나왔다 — 패시브가 있는데도.
    if (p.aura) {
      const a = p.aura;
      const eff = [];
      if (a.attackBonus) eff.push(`공격력 +${a.attackBonus}`);
      if (a.defenseBonus) eff.push(`방어력 +${a.defenseBonus}`);
      if (a.damageReduction) eff.push(`받는 피해 ${a.damageReduction}% 감소`);
      if (eff.length) parts.push(`이 카드가 전장에 있는 동안 ${describeAuraScope(a)} ${eff.join(', ')}`);
    }
  }
  if (skill.directAttack) parts.push('직접 공격 — 상대 전장을 무시하고 본체를 친다');

  // 🪤 함정은 **언제 터지는지**가 효과만큼 중요하다.
  //    조건 없이 "적 1체에게 12 피해"만 적으면 플레이어가 세트할 판단을 못 한다.
  if (cardType === 'trap' && parts.length > 0) {
    const spec = TRAP_TRIGGERS[normalizeTrapTrigger(skill.trapTrigger)];
    if (spec) return flavorRewrite(`${spec.label}: ${parts.join(' · ')}.`);
  }

  if (parts.length === 0) {
    // 🃏 바닐라 — 효과 슬롯에 **플레이버 텍스트**를 담는다.
    //    "특별한 효과가 없습니다"는 카드를 실패작처럼 보이게 한다.
    //    바닐라는 스탯 효율로 값을 하는 정상적인 카드 종류다.
    if (skill.flavorText) return String(skill.flavorText);
    return cardType === 'trap' ? flavorRewrite('조건 충족 시 발동합니다.') : '';
  }
  return flavorRewrite(parts.join(' · ') + '.');
}

// ============================================================
// 🏛️ 건축물 지속 패시브
// ------------------------------------------------------------
// 패시브에는 성격이 다른 두 종류가 있다.
//
//  1) **매 턴 누적형** (manaPerTurn / endTurnShield / endTurnAoeHeal …)
//     매 턴 값이 쌓인다. 오래 살수록 기하급수적으로 벌어지므로
//     `PER_TURN_MIN_RARITY` 이상에서만 허용한다.
//
//  2) **오라** (aura) — "이 카드가 전장에 있는 동안"
//     쌓이지 않는다. 건축물이 부서지면 즉시 사라진다.
//     조건(같은 카드군만 / 같은 속성만)을 걸면 덱 구성에 방향이 생긴다.
//     누적이 아니므로 낮은 등급에도 허용된다.
//
// ⚠️ 이건 DECISIONS #4가 금지한 "카드군 스탯 시너지"가 아니다.
//    그건 전개 수만으로 **공짜로** 붙는 오토체스식 종족 버프였다.
//    오라는 카드 한 장과 마나를 지불하고, 파괴되면 사라지며,
//    파워 예산에 계상된다. 유희왕의 지속마법/필드마법에 해당한다.
// ============================================================

/** 매 턴 누적형 패시브를 쓸 수 있는 최소 등급 */
export const PER_TURN_MIN_RARITY = 'epic';

/** 매 턴 누적되는 패시브 키 (오라와 구분) */
export const PER_TURN_PASSIVE_KEYS = [
  'manaPerTurn', 'endTurnShield', 'endTurnAoeShield', 'endTurnAoeHeal'
];

/** 오라가 적용될 범위 */
export const AURA_SCOPES = {
  all:       { label: '모든 아군',   mult: 1.0 },
  archetype: { label: '같은 카드군', mult: 0.6 },
  element:   { label: '같은 속성',   mult: 0.7 },
  cardType:  { label: '같은 종류',   mult: 0.7 }
};

export function hasPerTurnPassive(passive = {}) {
  return PER_TURN_PASSIVE_KEYS.some(k => (passive && passive[k]) > 0);
}

/**
 * LLM이 뱉은 패시브를 엔진이 아는 모양으로 다듬는다.
 *
 * LLM은 없는 필드를 잘 지어낸다("enemyAttackDown", "everyTurnDraw").
 * 여기서 걸러내지 않으면 카드에 글자만 남고 아무 일도 안 일어난다.
 */
export function normalizeStructurePassive(raw, rarity = 'common') {
  if (!raw || typeof raw !== 'object') return null;
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;
  const out = {};

  // 1) 매 턴 누적형 — 등급 미달이면 통째로 버린다
  if (rarityRank(rarity) >= rarityRank(PER_TURN_MIN_RARITY)) {
    if (raw.manaPerTurn > 0)      out.manaPerTurn = Math.min(2, Math.max(1, parseInt(raw.manaPerTurn) || 0));
    if (raw.endTurnShield > 0)    out.endTurnShield = Math.min(caps.shieldValue[1], Math.max(2, parseInt(raw.endTurnShield) || 0));
    if (raw.endTurnAoeShield > 0) out.endTurnAoeShield = Math.min(caps.shieldValue[1], Math.max(2, parseInt(raw.endTurnAoeShield) || 0));
    if (raw.endTurnAoeHeal > 0)   out.endTurnAoeHeal = Math.min(caps.healValue[1], Math.max(2, parseInt(raw.endTurnAoeHeal) || 0));
  }

  // 2) 오라 — 등급 제한 없음 (쌓이지 않으니까)
  const a = raw.aura;
  if (a && typeof a === 'object') {
    const scope = AURA_SCOPES[a.scope] ? a.scope : 'all';
    const aura = { scope };
    if (scope !== 'all') aura.scopeValue = String(a.scopeValue || '');
    // 범위가 좁을수록 값을 크게 준다 (조건을 만족시키는 값을 치른 것)
    const room = 1 / AURA_SCOPES[scope].mult;
    const atkCap = Math.max(1, Math.round(caps.buffValue[1] * room));
    if (a.attackBonus > 0)     aura.attackBonus = Math.min(atkCap, Math.max(1, parseInt(a.attackBonus) || 0));
    if (a.defenseBonus > 0)    aura.defenseBonus = Math.min(atkCap, Math.max(1, parseInt(a.defenseBonus) || 0));
    if (a.damageReduction > 0) aura.damageReduction = Math.min(40, Math.max(5, parseInt(a.damageReduction) || 0));
    if (aura.attackBonus || aura.defenseBonus || aura.damageReduction) out.aura = aura;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 🏛️ 건축물 패시브 **폴백**. LLM이 아무것도 주지 않았을 때만 쓴다.
 *
 * 🐛 이전 버전은 `element`로 분기해 화염이면 마나, 물이면 방어막처럼
 *    **속성이 패시브를 결정**했다. 하드코딩을 다른 하드코딩으로 바꾼 셈이라
 *    자유도를 오히려 죽였다. 이제는 **카드군의 플레이스타일**을 따른다 —
 *    저코스트 전개형 카드군의 건축물이 요새가 되는 일이 없어진다.
 *
 * @param playstyle archetype-identity.js의 플레이스타일 키
 */
export function buildStructurePassive(playstyle = 'control', rarity = 'common') {
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;
  const canPerTurn = rarityRank(rarity) >= rarityRank(PER_TURN_MIN_RARITY);
  const S = caps.shieldValue[0];
  const H = caps.healValue[0];
  const B = Math.max(1, caps.buffValue[0]);

  // 매 턴 누적을 못 쓰는 등급은 같은 컨셉을 **오라**로 표현한다.
  switch (playstyle) {
    case 'turtle':
      return canPerTurn ? { endTurnAoeShield: S }
                        : { aura: { scope: 'all', damageReduction: 15 } };
    case 'swarm':
      return canPerTurn ? { manaPerTurn: 1 }
                        : { aura: { scope: 'all', attackBonus: B } };
    case 'ace':
      return canPerTurn ? { endTurnShield: S }
                        : { aura: { scope: 'cardType', scopeValue: 'unit', defenseBonus: B } };
    case 'burn':
      return canPerTurn ? { endTurnShield: Math.max(2, Math.floor(S / 2)) }
                        : { aura: { scope: 'all', attackBonus: B } };
    case 'toolbox':
      return canPerTurn ? { endTurnAoeHeal: H }
                        : { aura: { scope: 'all', defenseBonus: B } };
    case 'control':
    default:
      return canPerTurn ? { manaPerTurn: 1, endTurnShield: Math.max(2, Math.floor(S / 2)) }
                        : { aura: { scope: 'element', scopeValue: '', attackBonus: B } };
  }
}

/**
 * 건축물 패시브를 문장으로 옮긴다.
 *
 * ⚠️ 카드에 적힌 글이 실제 동작과 어긋나면 안 되므로,
 *    패시브가 확정된 뒤 **데이터에서** 문장을 만든다.
 */
export function describeStructurePassive(passive = {}) {
  if (!passive) return '[건축물] 특별한 지속 효과가 없습니다.';
  const parts = [];
  if (passive.manaPerTurn)      parts.push(`매 턴 시작 시 마나 +${passive.manaPerTurn} 공급`);
  if (passive.endTurnShield)    parts.push(`턴 종료 시 본체 방어막 +${passive.endTurnShield}`);
  if (passive.endTurnAoeShield) parts.push(`턴 종료 시 본체 방어막 +${passive.endTurnAoeShield} & 자기 내구도 수리`);
  if (passive.endTurnAoeHeal)   parts.push(`턴 종료 시 본체 체력 +${passive.endTurnAoeHeal} 회복`);

  const a = passive.aura;
  if (a) {
    const who = describeAuraScope(a);
    const eff = [];
    if (a.attackBonus)     eff.push(`공격력 +${a.attackBonus}`);
    if (a.defenseBonus)    eff.push(`방어력 +${a.defenseBonus}`);
    if (a.damageReduction) eff.push(`받는 피해 ${a.damageReduction}% 감소`);
    if (eff.length) parts.push(`이 건축물이 전장에 있는 동안 ${who} ${eff.join(', ')}`);
  }

  if (parts.length === 0) return '[건축물] 특별한 지속 효과가 없습니다.';
  return `[건축물 패시브] ${parts.join(' & ')}.`;
}

export function describeAuraScope(aura = {}) {
  const spec = AURA_SCOPES[aura.scope] || AURA_SCOPES.all;
  if (aura.scope === 'archetype') return `같은 카드군 아군의`;
  // 🐛 수정: scopeValue를 그대로 써서 "dark 아군의 공격력"처럼 **영어 키**가 노출됐다.
  //    카드 텍스트는 전부 한국어여야 한다.
  if (aura.scope === 'element') {
    const ko = ELEMENT_CONFIG[aura.scopeValue] && ELEMENT_CONFIG[aura.scopeValue].name;
    return `${ko || '같은 속성'} 아군의`;
  }
  if (aura.scope === 'cardType') {
    const KO_TYPE = { unit: '소환수', spell: '마법', structure: '건축물', trap: '함정' };
    return `아군 ${KO_TYPE[aura.scopeValue] || '카드'}의`;
  }
  return `${spec.label}의`;
}

/**
 * 설명문이 특정 효과를 **언급하고 있는지** 본다.
 *
 * 🐛 왜 필요한가: 설명문 교정은 3단계에서 끝나는데 효과 제거는 4단계(예산)에서
 *    일어난다. 그래서 "매 턴 마나 +1 공급"이라 적힌 커먼 건축물의 패시브가
 *    조용히 삭제되어도 문장은 그대로 남았다. 카드가 거짓말을 한다.
 *    제거된 효과가 문장에 남아 있을 때만 설명을 다시 만들기 위한 판별기다.
 *    (언급이 없으면 LLM이 쓴 플레이버 문장을 굳이 버리지 않는다.)
 */
// ⚠️ 패턴은 **동사·부호에 앵커를 걸어** 정확해야 한다.
//
// 🐛 처음에는 `damage: /피해|데미지/`, `shield: /방어막|실드/`처럼 낱말만 봤다.
//    그러니 **엔진이 스스로 만든 정답 문장까지 거짓말로 판정**했다 (실측 10문장 중 2건):
//      "받는 피해가 30% 감소합니다."      → damage가 없다고 반려 (실제론 damageReduction)
//      "적 1체에게 16 피해 · 방어막 관통"  → shield가 없다고 반려 (실제론 pierceShield)
//      "적 실드를 제거한다"                → shield가 없다고 반려 (남의 방어막 이야기다)
//    `skill.shield`는 "**내가** 방어막을 얻는다"는 뜻이다. 남의 방어막을 언급한
//    문장과 같은 패턴으로 잡으면 정반대의 것을 같다고 보는 셈이다.
const EFFECT_DESC_PATTERNS = {
  // 피해를 **가한다**는 서술만. "받는 피해 감소"는 damageReduction의 몫이다.
  damage:            /\d+\s*[^\s.·]{0,4}?(피해|데미지)|(피해|데미지)\s*[를을]?\s*(입힌|입혀|준다|주고|가한|가하|꽂)/,
  // **내가 얻는** 방어막만. "방어막 관통", "적 방어막 제거"는 아니다.
  shield:            /(방어막|실드)\s*\+\s*\d+|(방어막|실드)[^.·]{0,8}(얻|획득|전개|충전|두른)/,
  // ⚠️ "최대 체력 +N"은 maxHpGain이다 — **회복 동사가 있을 때만** heal로 본다
  heal:              /(체력|생명력|내구도)[^.·]{0,10}(회복|치유)|(회복|치유)시킨/,
  drawCards:         /드로우|카드[^.·]{0,8}(뽑|가져)/,
  manaGain:          /마나\s*\+\s*\d+|마나[^.·]{0,8}(얻|획득|공급|충전)/,
  multiHit:          /연타|번\s*공격|회\s*공격/,
  critChance:        /치명타|크리/,
  lifestealPercent:  /흡혈|생명력\s*흡수/,
  executeThreshold:  /처형/,
  pierceShield:      /관통/,
  isAoeSpell:        /광역/,
  doubleCastNext:    /2연속|두 번 발동|더블/,
  invulnerableTurns: /무적/,
  damageReduction:   /경감|받는[^.·]{0,8}(피해|데미지)[^.·]{0,8}감소|(피해|데미지)\s*\d+%\s*감소/,
  attackDown:        /공격력\s*(-|감소|약화|하락)/,
  silence:           /무효화|봉인|침묵/,
  // '지속'은 뺐다 — "지속 피해"(상태이상)에도 걸려 오탐이 났다
  passiveEffect:     /매\s*턴|턴\s*종료\s*시|턴\s*시작\s*시|패시브/,
  statusEffect:      /화상|맹독|빙결|부식|감전|기절|출혈|중독|동상/,
  // 🆕 DECISIONS #85 — 예전에는 설명문에만 있던 동작들. 이제 실제로 구현됐다.
  // ⚠️ "방어막/실드를 제거"는 destroy(소환수 파괴)가 아니다 — 앞에 그 낱말이
  //    오면 제외한다. (실측: "적 실드를 제거한다"가 destroy로 오탐났다)
  destroy:           /(?:(?!방어막|실드)[^.·]){0,10}(파괴한다|파괴하고|파괴하며|파괴합니다|제거한다|제거하고|제거하며|제거합니다)/,
  searchDeck:        /서치|덱에서.{0,12}(찾|가져)/,
  summonToken:       /소환한다|소환하고|소환하며|소환합니다|토큰/,
  // 🃏 "파괴"는 destroy(소환수)와 겹친다 — 손패/패 낱말이 앞에 올 때만 패 파기다
  discardCard:       /(손패|패)[^.·]{0,6}(파기|파괴|버리)/
};

function descMentionsEffect(desc = '', key) {
  const re = EFFECT_DESC_PATTERNS[key];
  return re ? re.test(desc) : false;
}

/**
 * 🎯 효과의 성격에 맞게 `targetSide`를 교정한다. **스킬을 제자리에서 고친다.**
 *
 * ⚠️ 예산 정산 **전후로 두 번** 불러야 한다.
 *    🐛 예전에는 정산 전에 한 번만 불렀다. 그런데 정산이 피해를 잘라내면
 *       "해로운 효과"가 사라지는데 `targetSide`는 'foe'로 남는다.
 *       그 카드를 **다시 sanitize하면 그제야** 'ally'로 바뀐다 —
 *       즉 sanitize가 멱등하지 않았다.
 *       카드 연성은 기획 때 한 번, 이미지 생성/저장 때 한 번 총 두 번 돌리므로
 *       **유저가 이미 확인한 카드가 저장 시점에 조용히 달라졌다.**
 *
 * @returns {{reason: string|null}} 바뀌었으면 사유
 */
function fixTargetSide(skill) {
  const harmful = (skill.damage || 0) > 0
    || (skill.attackDown || 0) > 0
    || (skill.destroy || 0) > 0
    || !!skill.silence
    || (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none');
  const beneficial = (skill.heal || 0) > 0 || (skill.shield || 0) > 0;

  if (harmful && (skill.targetSide === 'self' || skill.targetSide === 'ally')) {
    const was = skill.targetSide;
    skill.targetSide = 'foe';
    return { reason: `공격 효과의 대상이 '${was}'였다 → 'foe' (자기/아군 피해 메커니즘이 없다)` };
  }
  if (!harmful && beneficial && skill.targetSide === 'foe') {
    // 회복·방어막은 엔진이 **무조건 내 쪽에** 적용한다. 'foe'로 두면 설명이 거짓이 되고
    // 대상 선택이 상대 전장을 가리킨다.
    skill.targetSide = 'ally';
    return { reason: `이로운 효과의 대상이 'foe'였다 → 'ally'` };
  }
  return { reason: null };
}

// ============================================================
// 🚫 엔진에 **아예 없는** 동작 — LLM이 TCG 관용구로 자주 지어낸다
// ------------------------------------------------------------
// 🐛 실팩 20장짜리 유저 덱을 열어보니 **14종 중 6종(43%)이 거짓말**이었다:
//      "상대 전장 소환수 1체를 제거하고 덱에서 1장을 드로우한다"  → 실제로는 14 피해뿐
//      "손패에서 1장을 드로우한다"                              → 실제로는 7 피해뿐
//      "손에서 [심연] 카드를 찾아 패로 소환한다"                → 실제로는 광역 18 피해뿐
//
//    card-describe.js에도 같은 검사가 있지만 그건 **2단계 LLM 경로에서만** 돈다.
//    fastMode이거나 Ollama가 꺼져 있으면 그 경로를 통째로 건너뛰므로,
//    1단계 LLM이 쓴 소설이 그대로 카드에 실린다.
//    그래서 결정론적 관문을 sanitize에도 둔다 — 여기는 **항상** 지난다.
//
// ⚠️ 파괴·서치·소환은 이제 **진짜로 구현됐다**(DECISIONS #85). 그래서 여기가
//    아니라 EFFECT_DESC_PATTERNS로 옮겼다 — "말했는데 필드가 없으면" 걸린다.
//    아래는 **여전히 엔진에 개념 자체가 없는** 것들만 남긴다.
//    (부활은 묘지가 없고, 강탈은 소유권 이전이 없고, 변신은 카드 교체가 없다)
const PHANTOM_ACTION_PATTERNS = {
  부활: /부활|되살/,
  강탈: /훔치|훔친|빼앗|빼앗는/,
  변신: /변신|둔갑/
};

/**
 * 설명문이 **실제 스킬로 뒷받침되지 않는 주장**을 하는지 본다.
 * @returns {string[]} 문제 목록. 비어 있으면 정상.
 */
function findDescriptionLies(desc, skill, cardType) {
  const t = String(desc || '');
  if (!t.trim()) return [];
  const lies = [];

  // 1) 엔진에 없는 동작 — 어떤 스킬로도 뒷받침될 수 없다
  for (const [label, re] of Object.entries(PHANTOM_ACTION_PATTERNS)) {
    if (re.test(t)) lies.push(`미구현 동작 주장: ${label}`);
  }

  // 2) 있는 척하는 효과 — 문장은 말하는데 스킬에는 없다
  //
  // ⚠️ 🏛️ 건축물의 방어막·회복·마나는 `skill.shield`가 아니라
  //    **`passiveEffect` 안에** 있다. 그걸 모르면 정확한 문장
  //    ("턴 종료 시 본체 방어막 +8")을 "없는 효과 주장: shield"로 반려한다.
  //    card-describe.js가 같은 함정을 밟은 적이 있다 → DECISIONS #76
  const p = skill.passiveEffect || {};
  const 패시브가_설명함 = {
    shield: (p.endTurnShield || 0) > 0 || (p.endTurnAoeShield || 0) > 0
            || ((p.aura && p.aura.defenseBonus) || 0) > 0,
    heal: (p.endTurnAoeHeal || 0) > 0,
    manaGain: (p.manaPerTurn || 0) > 0,
    damageReduction: ((p.aura && p.aura.damageReduction) || 0) > 0,
    attackDown: false
  };

  for (const [key, re] of Object.entries(EFFECT_DESC_PATTERNS)) {
    if (!re.test(t)) continue;
    const has = key === 'statusEffect'
      ? !!(skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none')
      : !!skill[key] || !!패시브가_설명함[key];
    if (!has) lies.push(`없는 효과 주장: ${key}`);
  }
  return lies;
}

/**
 * 🃏 바닐라 카드의 기본 플레이버 텍스트.
 *
 * LLM이 flavorText를 안 줬을 때만 쓴다. 효과가 없는 카드에
 * "특별한 효과가 없습니다"라고 적으면 실패작처럼 보이므로,
 * 세계관 한 줄을 넣어 **의도된 카드**로 읽히게 한다.
 */
const VANILLA_FLAVOR = {
  unit: [
    '이름 없는 자들이 전장을 채운다.',
    '말은 없다. 그저 앞으로 나아갈 뿐.',
    '기교는 없다. 그래서 무너지지 않는다.'
  ],
  structure: [
    '오래 서 있는 것에는 그만한 이유가 있다.',
    '무너지지 않는 것이 곧 승리다.'
  ],
  spell: ['짧은 주문. 확실한 결과.'],
  trap: ['기다림도 하나의 전술이다.']
};

function defaultFlavorText(name = '', cardType = 'unit') {
  const pool = VANILLA_FLAVOR[cardType] || VANILLA_FLAVOR.unit;
  // ⚠️ Math.random() 대신 이름 해시를 쓴다 — 같은 카드는 늘 같은 문구여야
  //    한다(카드 상세를 다시 열 때마다 문구가 바뀌면 버그처럼 보인다).
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return pool[h % pool.length];
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
  let sourceSkill = cardData.skill || (Array.isArray(cardData.skills) && cardData.skills[0]) || null;
  if (typeof sourceSkill === 'string') {
    sourceSkill = { description: sourceSkill };
  } else if (!sourceSkill && (cardData.damage || cardData.shield || cardData.heal || cardData.skillName || cardData.statusEffect)) {
    sourceSkill = {
      name: cardData.skillName || `${cardData.name || '영웅'}의 비기`,
      description: cardData.skillDesc || cardData.description,
      damage: cardData.damage || 0,
      shield: cardData.shield || 0,
      heal: cardData.heal || 0,
      multiHit: cardData.multiHit,
      drawCards: cardData.drawCards,
      statusEffect: cardData.statusEffect
    };
  }
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

  // 🪤 반응형 발동조건은 **함정 전용**이다.
  //    소환수가 "상대가 소환수를 낼 때마다 ~"를 갖게 되면 함정 카드의 존재 이유가 사라진다.
  //    필드에 남아 계속 반응하는 소환수 쪽이 세트해서 한 번 쓰는 함정보다 무조건 낫기 때문이다.
  //    LLM이 프롬프트를 어겨도 여기서 막는다.
  if (cardType !== 'trap') {
    if (skill.trapTrigger) delete skill.trapTrigger;
    if (skill.condition) delete skill.condition;
  } else if (normalizeTrapTrigger(skill.trapTrigger) !== skill.trapTrigger) {
    // 🐛 반대 방향이 비어 있었다: **발동조건 없는 함정**은 영영 발동하지 않는다.
    //    필드에 놓이고 아무 일도 일어나지 않는 死카드다.
    //    (실측: 보관함 함정 6장 **전부** 트리거가 없었다 — 카드팩 생성기가
    //     프롬프트로 요구해놓고 응답에서 읽지를 않았다)
    //    LLM이 안 줬거나 엉뚱한 값을 줬으면 가장 무난한 조건으로 채운다.
    const before = skill.trapTrigger;
    skill.trapTrigger = normalizeTrapTrigger(skill.trapTrigger);
    console.log(`[Trap] "${cardData.name || '무명'}" 발동조건이 ${before ? `알 수 없는 값(${before})` : '없어'} → foePlaysUnit으로 지정 (조건 없는 함정은 발동하지 않는다)`);
  }

  // 🗑️ 도발은 게임에서 제거됐다 (DECISIONS #84).
  //    이미 만들어진 카드와 세이브에는 `taunt: true`가 남아 있으므로 여기서 지운다.
  //    안 지우면 카드 데이터에는 있는데 엔진이 읽지 않는 **죽은 필드**가 되고,
  //    "설명문이 거짓말하는" 이 프로젝트의 단골 버그가 또 생긴다.
  if (skill.taunt !== undefined) delete skill.taunt;
  if (cardData.taunt !== undefined) delete cardData.taunt;

  // 🛡️ 피해 경감 — 퍼센트. 100%(완전 무효)는 '무적'과 같아지므로 상한을 둔다.
  if (skill.damageReduction !== undefined && skill.damageReduction > 0) {
    skill.damageReduction = Math.min(60, Math.max(10, parseInt(skill.damageReduction) || 0));
  }
  // ⚔️ 공격력 약화 — 등급 버프 상한과 같은 범위를 쓴다 (대칭)
  if (skill.attackDown !== undefined && skill.attackDown > 0) {
    skill.attackDown = Math.min(caps.buffValue[1] * 3, Math.max(1, parseInt(skill.attackDown) || 0));
  }

  // 🆕 파괴 · 서치 · 토큰 소환 (DECISIONS #85) — 전부 "개수"다.
  //    상한을 두지 않으면 LLM이 "적 전체 파괴 9체" 같은 걸 적는다.
  //    ⚠️ 파괴 상한은 상대 전장 슬롯(3)을, 소환 상한은 내 슬롯(4)을 넘지 않는다.
  if (skill.destroy !== undefined && skill.destroy > 0) {
    skill.destroy = Math.min(3, Math.max(1, parseInt(skill.destroy) || 0));
  }
  if (skill.searchDeck !== undefined && skill.searchDeck > 0) {
    skill.searchDeck = Math.min(3, Math.max(1, parseInt(skill.searchDeck) || 0));
  }
  if (skill.summonToken !== undefined && skill.summonToken > 0) {
    skill.summonToken = Math.min(3, Math.max(1, parseInt(skill.summonToken) || 0));
  }

  // ❤️ 체력 대상 정규화 (본체 / 이 소환수).
  //    주문·함정은 필드에 남지 않으므로 '이 소환수'가 성립하지 않는다 — 본체로 고정.
  skill.hpTarget = (cardType === 'unit' || cardType === 'structure')
    ? readHpTarget(skill)
    : 'body';

  // 🎯 대상 규칙 정규화. LLM이 아무 문자열이나 넣어도 안전한 값으로 떨어진다.
  //    여기서 확정된 값이 그대로 예산 계산(targetCostMultiplier)에 쓰인다.
  const tspec = readTargetSpec(skill);
  skill.targetSide = tspec.side;
  // 💥 피해 대상 (본체 / 전장 / 아무나). 피해가 없으면 의미가 없으므로 지운다.
  if (skill.damage > 0) skill.damageTarget = tspec.damageTarget;
  else if (skill.damageTarget !== undefined) delete skill.damageTarget;
  skill.targetScope = tspec.scope;
  skill.targetCount = tspec.count;

  // 🎯 대상 진영이 효과의 성격과 맞는지 확인한다.
  //
  //    🐛 "자신 1체에 12 피해" 같은 카드가 나오던 원인:
  //    `targetSide`는 스킬 하나에 **한 개**뿐인데 한 카드에 성격이 다른 효과가
  //    섞인다("적에게 12 피해 + 내 방어막 8"). LLM이 방어막을 보고 'self'를 고르면
  //    피해까지 자신을 향하게 된다.
  //
  //    그리고 이 엔진에는 **자기 피해(sacrifice) 메커니즘이 없다.**
  //    self는 고를 대상이 없어(collectTargetKeys에 self 분기 없음) 피해가 조용히
  //    `dealDamageToBoss`(지금의 dealDamageToFoe)로 흘러갔다 — 카드엔 "자신"이라 적히고 보스를 때렸다.
  //
  //    ally도 같은 문제인데 **더 나쁘다.** collectTargetKeys가 아군을 대상으로
  //    내주므로, 플레이어에게 "내 소환수를 골라 때리라"고 요구한다.
  const sideFix = fixTargetSide(skill);
  let sideFixReason = sideFix.reason;

  if (sideFixReason) {
    console.log(`[Target] "${cardData.name || '무명'}" ${sideFixReason}`);
    // ⚠️ 설명문에 옛 대상이 남아 있으면 교정한 데이터와 어긋난다.
    //    문장 전체를 데이터에서 다시 만든다 (부분 치환은 조사가 어긋난다).
    if (/자신|스스로|자기|아군|내\s*소환수|적을?\s*(치유|회복)/.test(String(skill.description || ''))) {
      const before = skill.description;
      skill.description = describeSkillFromData(skill, cardType);
      console.log(`[Target] 설명문 재생성: "${before}" → "${skill.description}"`);
    }
  }

  // 구버전 필드와 어긋나지 않게 맞춰둔다 (isAoeSpell == 전체 대상)
  skill.isAoeSpell = tspec.scope === 'all';
  // 3. 📜 설명문은 여기서 손대지 않는다.
  //
  //    🗑️ 예전에는 여기서 LLM 산문을 **수리**했다:
  //       (A)(B)(C) % → 정수 치환 · (D) 남은 % 처리 · (D-2) 분수 표기 ·
  //       (E) 숫자 동기화 · (F) 체력 주어 명시 · (G) 반응형 절 제거.
  //       약 70줄이었고, 실패하는 방식이 나빴다 —
  //       놓치면 카드가 거짓말하고, 오탐이면 문장이 손상됐다.
  //       ("상대 체력 30% 이하면 처형" → "상대 체력 +3 이하면 처형")
  //
  //    이제 규칙 텍스트는 예산 정산 **뒤에** describeSkillFromData가 만든다.
  //    산문을 고칠 이유가 없다 — 애초에 규칙 텍스트로 쓰지 않기 때문이다.
  //    LLM 산문은 flavorText로 따로 간다. → DECISIONS #91

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
  if (budgeted.costLowered > 0) {
    console.log(`[Balance] "${cardData.name || '무명'}" (${rarity}/${cardType}) 값을 치를 것이 없어 마나 -${budgeted.costLowered} → ${cost}`);
  }

  // ============================================================
  // ✍️ 규칙 텍스트는 **언제나 데이터에서 만든다** → DECISIONS #91
  // ------------------------------------------------------------
  // 예전에는 LLM 산문을 규칙 텍스트로 쓰고, 데이터와 어긋나면 정규식으로
  // **수리**했다 (스탯% 변환 · 분수 변환 · 숫자 동기화 · 체력 주어 명시 ·
  // 반응형 절 제거 · 거짓말 관문). 그 더미가 실패하는 방식이 나빴다:
  //   놓치면 → 카드가 거짓말한다
  //   오탐이면 → 문장이 손상된다 ("체력 30% 이하면" → "체력 +3 이하면")
  // 게다가 지켜내는 것도 적었다 — 실측: 유저 카드 43장 중 24장(56%)의
  // 산문이 어차피 통째로 교체되고 있었다.
  //
  // 이제 규칙 텍스트는 `describeSkillFromData`가 만든다. **거짓말이 구조적으로
  // 불가능하다** — 데이터가 곧 문장이기 때문이다. 멱등성도 공짜로 따라온다.
  // LLM의 산문은 `flavorText`(플레이버)로 따로 간다. 효과를 주장하지 않으므로
  // 검증할 것이 없다. 실제 TCG가 규칙 텍스트와 플레이버를 나누는 이유다.
  //
  // ⚠️ 여기에 "산문을 살려보려는" 분기를 다시 추가하지 마세요.
  //    그 순간 위의 수리 더미가 통째로 되돌아옵니다.
  // ============================================================
  if (finalSkill.isVanilla) {
    // 🃏 바닐라는 효과가 없는 것이 정의다 — 플레이버가 곧 설명이다.
    finalSkill.description = String(finalSkill.flavorText || cardData.flavorText || '').trim()
      || defaultFlavorText(cardData.name, cardType);
  } else {
    finalSkill.description = describeSkillFromData(finalSkill, cardType)
      || defaultFlavorText(cardData.name, cardType);
  }

  // 🎯 예산이 효과를 잘라냈으면 대상 진영을 다시 판정한다 (멱등성).
  //    ⚠️ 설명문 생성 **뒤**에 오면 안 된다 — 문장이 옛 대상을 가리키게 된다.
  //    (그래서 위 생성보다 앞이 아니라, 아래에서 다시 생성한다)
  {
    const post = fixTargetSide(finalSkill);
    // 💥 피해가 사라졌으면 피해 관련 부속 필드도 정리한다.
    //    (damage 없이 남은 multiHit·damageTarget은 예산만 먹는 유령이다)
    if (!(finalSkill.damage > 0)) {
      if (finalSkill.multiHit > 1) finalSkill.multiHit = 1;
      if (finalSkill.damageTarget !== undefined) delete finalSkill.damageTarget;
    }
    if (post.reason && !finalSkill.isVanilla) {
      console.log(`[Target] "${cardData.name || '무명'}" (예산 정산 후) ${post.reason}`);
      finalSkill.description = describeSkillFromData(finalSkill, cardType) || finalSkill.description;
    }
  }

  // 🃏 플레이버는 **효과를 주장하면 안 된다.** 규칙 텍스트가 따로 있으므로
  //    플레이버가 기능을 설명하면 두 줄이 서로 다른 말을 하게 된다.
  //    (바닐라는 플레이버가 곧 설명이라 여기서 건드리지 않는다)
  if (!finalSkill.isVanilla && finalSkill.flavorText) {
    const f = String(finalSkill.flavorText).trim();
    finalSkill.flavorText = (f.length > 40 || /\d/.test(f)) ? undefined : f;
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
    // ⚠️ `skills` 배열도 **반드시 함께** 갱신한다.
    //    🐛 예전에는 `...cardData`가 원본 `skills`를 그대로 흘려보내서
    //       정리된 `skill`과 정리 안 된 `skills[0]`이 한 카드에 공존했다.
    //       전투 엔진은 `skills[0]`을 읽으므로 **sanitize를 통과했는데도
    //       옛 필드가 살아 있는** 카드가 나온다 (도발 제거에서 실제로 걸렸다).
    //       호출부마다 `card.skills = [card.skill]`을 챙기게 두면 언젠가 빠뜨린다.
    skills: [finalSkill],
    powerUsed: power.used,
    powerAffordable: power.affordable,
    // ⚖️ 예산 초과 허용 카드의 남은 초과분(파워 단위). 연성소가 가루로 환산한다 (DECISIONS #100). 보통 0.
    powerDebt: budgeted.powerDebt || 0
  };
}

// ============================================================
// 💎 마나 커브 — 코스트를 **먼저** 정한다
// ------------------------------------------------------------
// 예전에는 등급이 코스트를 정했다(커먼=1~2, 레전더리=3~5). 그 결과
// 덱 커브가 카드 등급 분포에 끌려다녔고, 레어+ 덱에는 1코가 없었다.
//
// 이제 코스트를 **독립적으로** 굴리고, 등급은 그 코스트에서
// 얼마나 강할 수 있는지(파워 밀도)만 정한다.
//
// 분포는 실제 TCG 덱 커브를 닮게 저코스트로 기울였다.
// ⚠️ 이 표를 고코스트 쪽으로 밀면 **1턴에 낼 카드가 없는 문제가 돌아온다.**
//    바꾸기 전에 "첫 손패 4장에 저코스트가 들어올 확률"을 확인하세요.
export const COST_CURVE_WEIGHTS = [
  { cost: 1, w: 18 },
  { cost: 2, w: 22 },
  { cost: 3, w: 20 },
  { cost: 4, w: 15 },
  { cost: 5, w: 12 },
  { cost: 6, w: 8 },
  { cost: 7, w: 5 }
];

/**
 * 덱 커브를 닮은 분포로 코스트를 고른다.
 * @param maxCost 등급이 허용하는 상한 (RARITY_POWER.maxCost)
 * @param rand    0~1 난수 생성기. 전투 중이면 battleRng().next()를 넘기세요.
 */
export function rollCardCost(maxCost = 6, rand = Math.random) {
  const pool = COST_CURVE_WEIGHTS.filter(e => e.cost <= maxCost);
  const total = pool.reduce((s, e) => s + e.w, 0);
  let roll = rand() * total;
  for (const e of pool) {
    roll -= e.w;
    if (roll <= 0) return e.cost;
  }
  return pool[pool.length - 1].cost;
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
