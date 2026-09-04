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
import { RACE_CONFIG } from './races.js';   // 🧬 커스텀 종족 판별용 (races.js는 import 0이라 순환 없음)

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

// ============================================================
// 🧬 새 종족 슬롯 — 코드가 굴리고 LLM은 따른다 (DECISIONS #108)
// ============================================================
//
// 규칙 93과 같은 사정이다: "기존 것을 재사용하라"와 "새로 만들어도 된다"를 **함께** 주면
// 4B 모델은 늘 재사용을 고른다 (카드군이 실제로 한 번도 안 생겼다). 그래서 확률을 코드가 굴려
// 그 슬롯에만 창작 지시문을 넣는다.
//
// 확률이 낮은 이유: 종족의 값은 "같은 종족이 여럿 모인다"에서 나온다. 자주 만들면
// 시너지가 희석된다. 등록 쪽에도 유사도 게이트와 총량 상한이 따로 있다(race-service.js).

export const NEW_RACE_CHANCE = 0.15;

/** 이번 카드가 새 종족을 만들 슬롯인가 */
export function rollNewRaceSlot(rng = Math.random) {
  return rng() < NEW_RACE_CHANCE;
}

/**
 * 종족 **추첨** — LLM에게 고르게 하지 않는다 (DECISIONS #109).
 *
 * 🐛 효과 성향·함정 조건과 **완전히 같은 사정**이다(규칙 108): 4B 모델에게 목록을 주고 고르라고 하면
 *    거의 전부 human이 나온다. 다양성은 코드가 굴려 만들고, LLM은 그 종족에 맞게 **그리게** 한다.
 *
 * 타입별 가중치가 다른 이유: 주문·함정은 개체가 아니라 사건이라 대개 종족이 없고,
 * 건축물은 있다면 기물이다. 종족이 붙어야 자연스러운 것은 소환수다.
 */
const RACE_ROLL_WEIGHTS = {
  unit:      { __none: 6, human: 26, beast: 13, undead: 10, demon: 10, construct: 9, fae: 9, aberration: 9, dragon: 8 },
  spell:     { __none: 85, human: 5, demon: 4, fae: 3, aberration: 3 },
  structure: { __none: 55, construct: 35, fae: 5, aberration: 5 },
  trap:      { __none: 80, aberration: 8, fae: 6, undead: 6 }
};

/** LLM이 만든 종족에도 추첨 기회를 준다 — 안 그러면 한 번 만들고 다시는 안 쓰인다 */
const CUSTOM_RACE_WEIGHT = 6;

// 🐛 여기에 **기본 종족**을 넘기면 안 된다. 타입 표가 일부러 뺀 종족(주문에 용족 같은)이
//    가중치 6으로 되살아나 "주문은 대개 종족이 없다"가 무너진다 (실측: 종족 없음 85% → 68%).
//    그래서 인자 이름이 customKeys다 — custom:true인 것만 넘기세요.

/**
 * 이 카드의 종족을 굴린다.
 * @param opts.allowed 카드군이 선호하는 종족 (있으면 **그 안에서만** 굴린다 — 카드군이 추첨보다 위다)
 * @param opts.customKeys LLM이 만든 종족 키만 (기본 8종을 넘기면 타입별 가중치가 무너진다)
 * @returns 종족 키, 또는 null(종족 없음)
 */
export function rollCardRace(cardType = 'unit', { allowed = [], customKeys = [], rng = Math.random } = {}) {
  if (Array.isArray(allowed) && allowed.length > 0) {
    return allowed[Math.floor(rng() * allowed.length)] || null;
  }
  const table = { ...(RACE_ROLL_WEIGHTS[cardType] || RACE_ROLL_WEIGHTS.unit) };
  for (const k of customKeys) {
    // 🐛 호출부를 믿지 않는다. **기본 종족**이 섞여 들어오면 타입 표가 일부러 뺀 종족이
    //    가중치 6으로 되살아나 "주문은 대개 종족이 없다"가 무너진다 (실측: 85% → 68%).
    if (!k || k === '__none' || table[k] !== undefined) continue;
    if (!RACE_CONFIG[k] || !RACE_CONFIG[k].custom) continue;
    table[k] = CUSTOM_RACE_WEIGHT;
  }
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const [k, w] of Object.entries(table)) {
    roll -= w;
    if (roll <= 0) return k === '__none' ? null : k;
  }
  return null;
}

/**
 * 종족 지시문. **고르라고 하지 않는다** — 코드가 정한 종족을 알려주고 그리게 한다 (DECISIONS #109).
 * @param rolled rollCardRace의 결과 (null이면 종족 없음)
 * @param label  그 종족의 한국어 이름 (플레이버 팩이 바꾼 이름이 들어온다)
 */
export function raceDirective(rolled, label, isNewSlot) {
  if (isNewSlot) {
    return `\n\n🧬 이 카드는 **새 종족을 만드는 슬롯**이다 (시스템이 정했다).\n` +
      `컨셉에 어울리는 종족을 하나 지어 "newRace"로 제안하라.\n` +
      `  "newRace": { "key": "영문 소문자 3~12자", "name": "한국어 종족명(2~5자)", "icon": "이모지 1개",\n` +
      `               "tags": ["그 종족을 그림으로 만드는 danbooru 태그 3~5개 — 이게 종족의 정의다"],\n` +
      `               "cycleRole": "none(기계 등) | host(걸리기만) | vector(걸기만) | both" }\n` +
      `- ⚠️ 이미 있는 종족과 태그가 비슷하면 시스템이 **흡수**한다. 정말 다른 그림일 때만 제안하라.`;
  }
  if (!rolled) {
    return `\n\n🧬 이 카드는 **종족이 없다** (시스템이 정했다). "races"는 빈 배열로 두고,` +
      ` 그림도 특정 종족의 생김새가 아니라 사건·사물·현상으로 묘사하라.`;
  }
  return `\n\n🧬 이 카드의 종족은 **${label}**("${rolled}")이다 (시스템이 정했다 — 반드시 따를 것).\n` +
    `- "races": ["${rolled}"] 그대로 쓴다. 다른 종족으로 바꾸지 마라.\n` +
    `- 이름·서사·그림 묘사(visualSeeds)를 **${label}답게** 짓는다. 종족은 그림에 직접 반영된다.`;
}
