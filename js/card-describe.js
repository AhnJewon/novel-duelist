// card-describe.js - 카드 **플레이버 텍스트** 생성 (2단계 LLM)
//
// ═══════════════════════════════════════════════════════════
// 📜 왜 규칙 텍스트를 쓰지 않는가 → DECISIONS #91
// ───────────────────────────────────────────────────────────
// 예전에는 이 파일이 **규칙 텍스트**를 썼다. 확정된 수치를 LLM에게 보여주고
// 그 수치를 문장으로 옮기게 한 뒤, 어긋나면 반려하고 결정론적 문장으로
// 되돌리는 구조였다. 방향은 옳았지만 근본 문제가 남았다:
//
//   **산문이 규칙 텍스트 노릇을 하는 한, 검증이 늘 필요하다.**
//   그리고 자연어를 정규식으로 검증하면 두 방향으로 실패한다 —
//   놓치면 카드가 거짓말하고, 오탐이면 문장이 손상된다.
//   (실측: 관문이 엔진 자신의 정답 문장 10개 중 2개를 거짓말로 판정했다)
//
// 이제 규칙 텍스트는 `describeSkillFromData`가 데이터에서 만든다.
// 거짓말이 **구조적으로 불가능**하다. LLM은 플레이버만 쓴다 —
// 효과를 주장하지 않으므로 검증할 것이 없고, 실패해도 잃는 게 없다.
//
// 실제 TCG가 규칙 텍스트와 플레이버를 나누는 이유가 이것이다.
// ═══════════════════════════════════════════════════════════

import { callOllamaChat } from './ai-service.js';
import { describeSkillFromData } from './config.js';
import { tidyKoreanText } from './korean-grammar.js';

/** 플레이버가 지켜야 할 것 — 규칙 텍스트 흉내를 내면 안 된다 */
const MAX_FLAVOR_LEN = 40;

/**
 * 플레이버로 쓸 수 있는 문장인가.
 *
 * ⚠️ 여기서 하는 일은 **효과 검증이 아니다.** 규칙 텍스트는 이미 데이터에서
 *    만들어져 카드에 따로 붙는다. 플레이버는 그 옆에 놓이는 한 줄이므로,
 *    "기능을 설명하려 드는가"만 본다. 애매하면 버린다 — 잃는 게 없다.
 *
 * @returns {string|null} 문제 사유. null이면 통과.
 */
export function validateFlavor(text) {
  const t = String(text || '').trim();
  if (!t) return '비어 있음';
  if (t.length > MAX_FLAVOR_LEN) return `너무 김 (${t.length}자, 최대 ${MAX_FLAVOR_LEN})`;
  if (/[{}\[\]"']/.test(t) || t.includes('\n')) return '형식 오류 (JSON/따옴표/줄바꿈)';
  // 🔢 숫자가 있으면 수치를 주장하는 것이다 — 그건 규칙 텍스트의 몫이다.
  if (/\d/.test(t)) return '숫자가 들어 있음 (수치는 규칙 텍스트가 말한다)';
  // 기능 어휘를 쓰면 규칙 텍스트와 두 말을 하게 된다
  if (/피해|데미지|방어막|실드|회복|치유|드로우|마나|소환|파괴|무효화|관통|흡혈|처형|턴/.test(t)) {
    return '효과를 서술함 (플레이버는 분위기만)';
  }
  return null;
}

/**
 * 카드의 플레이버 텍스트 한 줄을 받아온다.
 *
 * @returns {Promise<string|null>} 검증을 통과한 문장. 실패하면 null.
 */
export async function describeCardWithLLM(card, { timeoutMs = 45000, reasoningMode = 'fast' } = {}) {
  const skill = (card && (card.skill || (card.skills && card.skills[0]))) || null;
  if (!skill) return null;
  // 🃏 바닐라는 플레이버가 곧 설명이다. 이미 있으면 건드리지 않는다.
  if (skill.isVanilla) return null;

  const cardType = card.cardType || 'unit';
  // 규칙 텍스트를 **참고로만** 보여준다 (분위기를 맞추라고). 옮겨 적으라는 게 아니다.
  const rules = describeSkillFromData(skill, cardType) || '';

  const sys = `너는 한국어 TCG 카드의 **플레이버 텍스트**를 쓰는 작가다.
플레이버는 카드의 분위기·세계관을 담은 짧은 한 줄이다. 효과 설명이 아니다.
출력은 JSON 하나만: {"flavor": "한 줄"}`;

  const user = `아래 카드의 플레이버 텍스트를 써라.

카드 이름: ${card.name}
종류: ${cardType} / 등급: ${card.rarity} / 마나: ${card.cost}
${card.themeName ? `카드군: ${card.themeName}` : ''}
(참고 — 이 카드의 규칙 텍스트는 따로 붙는다: "${rules}")

규칙:
- **효과를 설명하지 마라.** 규칙 텍스트가 이미 따로 있다.
- 숫자를 쓰지 마라. 피해·방어막·회복·드로우·마나·소환 같은 기능 어휘도 쓰지 마라.
- ${MAX_FLAVOR_LEN}자 이내, 한 문장, 한국어.

좋은 예: {"flavor": "그림자는 주인을 묻지 않는다."}
좋은 예: {"flavor": "불꽃은 약속을 기억하지 못한다."}
나쁜 예: {"flavor": "적에게 18 피해를 입힌다."}  ← 규칙 텍스트다
나쁜 예: {"flavor": "방어막을 얻고 카드를 뽑는다."}  ← 기능 서술이다

이제 위 카드의 JSON을 출력하라.`;

  try {
    // ⚠️ callOllamaChat은 응답을 **JSON으로 파싱**한다. 평문을 요구하면 통째로 실패한다.
    const raw = await callOllamaChat({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.9,   // 플레이버는 다양할수록 좋다
      timeoutMs,
      reasoningMode
    });
    const rawText = String((raw && (raw.flavor || raw.flavorText || raw.description)) || '')
      .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
      .split('\n')[0]
      .trim();

    // 📝 어법 교정 — 4B 모델은 조사를 자주 틀린다. 규칙으로 고친다.
    const tidied = tidyKoreanText(rawText);
    if (tidied.problems.length > 0) {
      console.info(`[플레이버] 폐기 (어법: ${tidied.problems.map(p => p.why).join(', ')})`);
      return null;
    }
    const problem = validateFlavor(tidied.text);
    if (problem) {
      console.info(`[플레이버] 폐기 (${problem}): "${tidied.text.slice(0, 40)}"`);
      return null;
    }
    return tidied.text;
  } catch (e) {
    console.warn('[플레이버] 호출 실패:', e.message);
    return null;
  }
}

/**
 * 카드에 플레이버를 붙인다.
 *
 * ⚠️ 실패해도 **아무것도 잃지 않는다.** 규칙 텍스트는 이미 정확하게 붙어 있고,
 *    플레이버는 없으면 그냥 안 보일 뿐이다. 예전 구조에서는 이 단계가 실패하면
 *    거짓 문장이 카드에 남았다 — 이제 그런 실패 모드가 없다.
 *
 * @returns {boolean} 플레이버가 붙었는가
 */
export async function applyLlmDescription(card, opts = {}) {
  const skill = card && (card.skill || (card.skills && card.skills[0]));
  if (!skill || skill.isVanilla) return false;

  const flavor = await describeCardWithLLM(card, opts);
  if (!flavor) return false;

  skill.flavorText = flavor;
  if (card.skills && card.skills[0]) card.skills[0].flavorText = flavor;
  if (card.skill) card.skill.flavorText = flavor;
  return true;
}
