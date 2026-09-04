// card-validator.js - LLM 카드 기획 검증 & 재요청 사유 생성
//
// LLM은 프롬프트를 자주 어긴다. 특히 두 가지가 반복된다:
//   1) 함정 효과를 소환수에 붙인다 ("적이 소환될 때 그 카드를 제거하고...")
//   2) 엔진에 없는 효과를 설명문에만 쓴다 ("공격력을 0으로 만든다")
//
// 정규식으로 뒤쫓는 데는 한계가 있어서 3단으로 막는다:
//   1단 프롬프트   — 예방
//   2단 이 파일    — 위반을 짚어 **한 번만** 재요청 (교정)
//   3단 sanitize   — 그래도 어기면 결정론적으로 잘라낸다 (보장)
//
// ⚠️ 재시도는 **1회만**. 로컬 LLM이라 비용은 시간뿐이지만,
//    무한 재시도는 카드 한 장에 수십 초를 태운다.

import { EFFECT_COSTS } from './config.js';

/** 엔진이 실제로 처리하는 스킬 필드 */
const IMPLEMENTED_FIELDS = new Set([
  ...Object.keys(EFFECT_COSTS),
  'name', 'description', 'cost', 'critMultiplier', 'reductionTurns',
  // 🎯 대상 규칙 — 효과가 아니라 **효과를 어디에 적용할지** 정하는 축이다.
  //    EFFECT_COSTS에 없으므로 여기에 손으로 적어야 한다.
  //    🐛 `damageTarget`을 프롬프트 스키마에는 넣고 여기에 빠뜨려서,
  //       LLM이 시키는 대로 쓴 필드를 "구현되지 않았다"며 반려하고
  //       재요청까지 돌았다 (실제 로그로 확인). → CLAUDE.md 금지사항 42
  'targetSide', 'targetScope', 'targetCount', 'hpTarget', 'damageTarget', 'condition',
  // 🏛️ 건축물 패시브 — EFFECT_COSTS의 'aura'는 passiveEffect **안에** 들어가므로
  //    스킬 최상위 키로는 나타나지 않는다.
  'passiveEffect',
  // 🃏 바닐라 카드의 플레이버 텍스트 (효과가 없을 때 설명 슬롯에 들어간다)
  'flavorText', 'isVanilla',
  // 💫 본체 지정 상태이상 옵트인 (BODY_STATUS_COST_MULT 할증을 치른다)
  'bodyStatus',
  // 🏷️ LLM이 종종 함께 반환하는 무해한 메타/참조 필드 (불필요한 재요청 방지)
  'effectType', 'value', 'element', 'target', 'power', 'type', 'buff', 'duration', 'scope', 'keywords',
  // 🧬 종족 — 이미지·연계·검색에 실제로 쓰인다 (DECISIONS #106)
  'races', 'race', 'cycleRole', 'newRace'
]);

/** 상대 행동/지속 조건에 반응하는 문구 — 함정 전용이다 */
const REACTIVE_PATTERNS = [
  { re: /(적|상대)[^.。]{0,20}(소환|발동|사용|공격|낼|내면|플레이)[^.。]{0,15}(때|하면|되면|때마다)/,
    why: '상대 행동에 반응하는 효과' },
  { re: /체력이[^.。]{0,15}(이하|미만)[^.。]{0,10}(될\s*때|되면|일\s*때)/,
    why: '지속 감시 조건 (체력 문턱)' },
  { re: /다음\s*턴에/, why: '지연 발동 (예약 시스템이 없다)' }
];

/**
 * 카드 기획을 검증한다.
 * @returns {string[]} 위반 사유. 빈 배열이면 통과.
 */
export function validateCardPlan(data, cardType = 'unit') {
  const problems = [];
  if (!data) return ['응답이 비어 있습니다'];

  const skill = data.skill || (Array.isArray(data.skills) && data.skills[0]) || {};
  const desc = String(skill.description || '');

  // 1) 함정이 아닌데 반응형 문구를 썼다
  if (cardType !== 'trap') {
    for (const { re, why } of REACTIVE_PATTERNS) {
      if (re.test(desc)) {
        problems.push(
          `설명문에 ${why}가 들어 있습니다: "${desc.slice(0, 40)}…" ` +
          `— 이런 효과는 **함정(trap) 카드 전용**입니다. ` +
          `${cardType} 카드는 낼 때 즉시 일어나는 일만 쓰세요.`
        );
        break;
      }
    }
    if (skill.trapTrigger) {
      problems.push(`"trapTrigger"는 함정 카드에만 쓸 수 있습니다. ${cardType}에서는 제거하세요.`);
    }
  }

  // 2) 엔진에 없는 필드를 만들어 냈다
  const unknown = Object.keys(skill).filter(k => !IMPLEMENTED_FIELDS.has(k) && !k.startsWith('_'));
  if (unknown.length > 0) {
    problems.push(
      `구현되지 않은 효과 필드를 썼습니다: ${unknown.join(', ')}. ` +
      `허용된 필드만 쓰세요: ${[...Object.keys(EFFECT_COSTS)].join(', ')}`
    );
  }

  // 3) 설명문에만 있고 수치가 없다 — 글자만 남고 아무 일도 안 일어난다
  const hasAnyEffect = Object.keys(EFFECT_COSTS).some(k => {
    if (k === 'statusEffect') return !!(skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none');
    if (k === 'multiHit') return (skill.multiHit || 1) > 1;
    return !!skill[k];
  });
  // 🃏 바닐라는 예외다. 효과가 없는 대신 플레이버 텍스트를 갖는 정상적인 카드다.
  //    (저코스트 카드는 스탯만으로 예산이 차서 효과를 넣을 자리가 없다)
  const isVanillaPlan = !!skill.isVanilla || (!hasAnyEffect && !!skill.flavorText);
  if (!hasAnyEffect && !isVanillaPlan && desc.length > 8) {
    problems.push(
      '설명문은 있는데 실제 효과 수치가 하나도 없습니다. damage/shield/heal 등을 채우거나, ' +
      '효과 없는 바닐라 카드로 만들 거면 "isVanilla": true 와 "flavorText"를 넣으세요.'
    );
  }

  // 4) 설명문의 숫자가 수치와 다르다 (가장 흔한 어긋남)
  const numMismatch = findNumberMismatch(desc, skill);
  if (numMismatch) problems.push(numMismatch);

  return problems;
}

/** 설명문 숫자 ↔ 실제 수치 대조 */
function findNumberMismatch(desc, skill) {
  const checks = [
    ['damage', skill.multiHit > 1 ? skill.damage * skill.multiHit : skill.damage, /(\d+)\s*(?:의|을|를)?\s*(?:피해|데미지)/],
    ['shield', skill.shield, /(\d+)\s*(?:의|을|를)?\s*(?:방어막|실드)/],
    ['heal',   skill.heal,   /(\d+)\s*(?:의|을|를)?\s*(?:회복|치유)/]
  ];
  for (const [key, actual, re] of checks) {
    if (!actual) continue;
    const m = desc.match(re);
    if (m && parseInt(m[1], 10) !== actual) {
      return `설명문의 "${m[1]}"이 실제 ${key} 값 ${actual}과 다릅니다. 수치를 먼저 정하고 설명문에 그대로 옮기세요.`;
    }
  }
  return null;
}

/**
 * 📜 유저가 "원하는 효과 설명"에 적은 효과가 실제 필드에 들어갔는지 대조한다.
 * 한국어 낱말 → 효과 필드. 언급했는데 비어 있으면 문제로 돌려 재요청을 태운다 (DECISIONS #100).
 * ⚠️ 설명문을 "수리"하는 게 아니다(규칙 81) — 유저의 요구를 LLM이 빠뜨렸는지 **확인**만 한다.
 */
const REQUESTED_EFFECT_WORDS = [
  { re: /피해|데미지|타격|공격해/, key: 'damage', has: s => s.damage > 0, field: 'damage' },
  { re: /방어막|실드|보호막/, key: 'shield', has: s => s.shield > 0, field: 'shield' },
  { re: /회복|치유|힐/, key: 'heal', has: s => s.heal > 0, field: 'heal' },
  { re: /드로우|뽑/, key: 'drawCards', has: s => s.drawCards > 0, field: 'drawCards' },
  { re: /마나/, key: 'manaGain', has: s => s.manaGain > 0, field: 'manaGain' },
  { re: /연타|연속\s*(?:타격|공격)|번\s*공격/, key: 'multiHit', has: s => (s.multiHit || 1) > 1, field: 'multiHit' },
  { re: /서치|찾아/, key: 'searchDeck', has: s => s.searchDeck > 0, field: 'searchDeck' },
  { re: /파괴|제거/, key: 'destroy', has: s => s.destroy > 0, field: 'destroy' },
  { re: /토큰|특수\s*소환/, key: 'summonToken', has: s => s.summonToken > 0, field: 'summonToken' },
  { re: /관통/, key: 'pierceShield', has: s => !!s.pierceShield, field: 'pierceShield: true' },
  { re: /무적/, key: 'invulnerableTurns', has: s => s.invulnerableTurns > 0, field: 'invulnerableTurns' },
  { re: /흡혈/, key: 'lifestealPercent', has: s => s.lifestealPercent > 0, field: 'lifestealPercent' },
  { re: /화상/, key: 'burn', has: s => s.statusEffect && s.statusEffect.type === 'burn', field: 'statusEffect.type = "burn"' },
  { re: /빙결|동결|얼려/, key: 'freeze', has: s => s.statusEffect && s.statusEffect.type === 'freeze', field: 'statusEffect.type = "freeze"' },
  { re: /기절|스턴/, key: 'stun', has: s => s.statusEffect && s.statusEffect.type === 'stun', field: 'statusEffect.type = "stun"' },
  { re: /맹독|중독|독을/, key: 'poison', has: s => s.statusEffect && s.statusEffect.type === 'poison', field: 'statusEffect.type = "poison"' },
  { re: /감전/, key: 'shock', has: s => s.statusEffect && s.statusEffect.type === 'shock', field: 'statusEffect.type = "shock"' },
  { re: /취약/, key: 'vulnerable', has: s => s.statusEffect && s.statusEffect.type === 'vulnerable', field: 'statusEffect.type = "vulnerable"' }
];

export function validateRequestedEffects(effectDesc, data) {
  const req = String(effectDesc || '').trim();
  if (!req || !data) return [];
  const skill = data.skill || (Array.isArray(data.skills) && data.skills[0]) || {};
  const missing = REQUESTED_EFFECT_WORDS.filter(w => w.re.test(req) && !w.has(skill));
  if (missing.length === 0) return [];
  return [
    `유저가 요구한 효과가 빠졌습니다: ${missing.map(m => `"${m.key}" → ${m.field}`).join(', ')}. ` +
    `요구: "${req.slice(0, 80)}". 설명문에만 적지 말고 해당 필드에 수치를 넣으세요.`
  ];
}

/** 재요청 프롬프트로 붙일 지시문 */
export function buildRetryDirective(problems) {
  return `\n\n⚠️ 방금 만든 카드에 문제가 있습니다. **아래를 고쳐서 다시 만드세요.**\n` +
    problems.map((p, i) => `${i + 1}. ${p}`).join('\n') +
    `\n같은 컨셉을 유지하되 위 문제만 바로잡은 JSON을 다시 출력하세요.\n`;
}
