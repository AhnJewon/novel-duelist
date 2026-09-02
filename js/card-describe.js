// card-describe.js - 카드 설명문 **2단계 생성**
//
// 문제: 한 번의 LLM 호출로 수치와 설명문을 같이 받으면 둘이 어긋난다.
//   LLM은 "28 피해"라고 써놓고 damage에 20을 넣거나, 예산에 밀려 효과가
//   잘려나간 뒤에도 설명문에는 그 효과가 남는다. 지금까지 이걸
//   syncDescriptionNumbers / describeSkillFromData로 **뒤에서 고쳐** 왔다.
//
// 해결: 호출을 둘로 나눈다.
//   1단계 — LLM이 이름·수치·효과를 정한다 (설명문은 신경 쓰지 않는다)
//   엔진   — 예산으로 수치를 확정한다 (깎기·제거·코스트 조정)
//   2단계 — **확정된 수치를 보여주고** 그에 맞는 문장만 쓰게 한다
//
// 이러면 설명문이 어긋날 여지가 원천적으로 줄어든다. 수치가 이미 고정된
// 뒤에 문장을 쓰기 때문이다.
//
// ⚠️ 그래도 LLM을 믿지 않는다. 2단계 출력도 검증하고, 어긋나면
//    describeSkillFromData(결정론적 생성)로 되돌린다.
//    "LLM이 썼으니 맞겠지"는 이 프로젝트에서 여러 번 틀렸다.

import { callOllamaChat } from './ai-service.js';
import { describeSkillFromData, syncDescriptionNumbers } from './config.js';

/** 설명문이 언급하면 안 되는 효과를 찾기 위한 키워드 (config의 것과 목적이 같다) */
const CLAIM_PATTERNS = {
  damage:            /피해|데미지/,
  shield:            /방어막|실드/,
  heal:              /회복|치유/,
  drawCards:         /드로우|뽑/,
  manaGain:          /마나/,
  multiHit:          /연타/,
  critChance:        /치명타|크리/,
  lifestealPercent:  /흡혈/,
  executeThreshold:  /처형/,
  pierceShield:      /관통/,
  invulnerableTurns: /무적/,
  damageReduction:   /경감/,
  silence:           /무효화|봉인|침묵/,
  maxHpGain:         /최대\s*체력/,
  taunt:             /도발/
};

/**
 * 2단계 출력이 **확정 수치와 맞는지** 본다.
 * @returns {string|null} 문제 사유. null이면 통과.
 */
export function validateDescription(text, skill, cardType = 'unit', facts = '') {
  const t = String(text || '').trim();
  if (!t) return '비어 있음';
  // 프롬프트가 60자를 요구한다. 조금의 여유만 준다 — 길면 카드에서 잘린다.
  if (t.length > 70) return `너무 김 (${t.length}자)`;
  // 카드 텍스트에 JSON·따옴표·줄바꿈이 섞여 오는 경우가 잦다
  if (/[{}\[\]"']/.test(t) || t.includes('\n')) return '형식 오류 (JSON/따옴표/줄바꿈)';

  // 1) 없는 효과를 주장하면 안 된다 — 가장 중요한 검사
  //
  //    ⚠️ 기준은 **확정 문장(facts)**이지 스킬 필드가 아니다.
  //       🐛 필드로 대조했더니 오탐이 났다: 건축물의 방어막은 skill.shield가 아니라
  //          passiveEffect.endTurnShield에서 온다. 그래서 정확한 문장
  //          "턴 종료 시 방어막 +7"이 "없는 효과(shield)"로 반려됐다.
  //       facts를 기준으로 하면 패시브·오라·새 효과까지 자동으로 커버된다.
  const ref = String(facts || '');
  for (const [key, re] of Object.entries(CLAIM_PATTERNS)) {
    if (re.test(t) && !re.test(ref)) return `없는 효과를 주장함: ${key}`;
  }

  // 2) 반대로 **있는 수치를 빠뜨려도 안 된다.**
  //    "강력한 화염이 적을 불태운다" 같은 문장은 예쁘지만 카드로서는 쓸모없다.
  //    플레이어가 몇 피해인지 알 수 없다. (바닐라는 애초에 여기까지 오지 않는다)
  //
  //    ⚠️ 효과별 목록을 손으로 유지하지 않는다. 그러면 새 효과가 생길 때마다
  //       빠뜨린다 — 실제로 건축물 패시브가 목록에 없어서, 숫자가 하나도 없는
  //       산문이 검사를 통과했다.
  //       대신 **결정론적 문장(facts)에 등장하는 모든 숫자**를 기준으로 삼는다.
  const factNumbers = [...new Set(String(facts || '').match(/\d+/g) || [])];
  for (const n of factNumbers) {
    if (!t.includes(n)) return `확정 수치 ${n}이(가) 문장에 없음`;
  }

  // 3) 숫자가 확정 수치와 다르면 안 된다
  if (syncDescriptionNumbers(t, skill) !== t) return '숫자가 확정 수치와 다름';

  return null;
}

/**
 * 확정된 카드 수치로 설명문 한 문장을 받아온다.
 *
 * @param card  sanitizeAndClampCardData를 **거친** 카드 (수치가 확정된 상태)
 * @returns {Promise<string|null>} 검증을 통과한 문장. 실패하면 null (호출자가 폴백).
 */
export async function describeCardWithLLM(card, { timeoutMs = 45000, reasoningMode = 'fast' } = {}) {
  const skill = (card && (card.skill || (card.skills && card.skills[0]))) || null;
  if (!skill) return null;
  // 🃏 바닐라는 플레이버 텍스트가 이미 정답이다. 효과 문장을 새로 쓰면 거짓이 된다.
  if (skill.isVanilla) return null;

  const cardType = card.cardType || 'unit';
  // 결정론적 사실 문장 — LLM에게 "이게 전부다"라고 보여줄 기준
  const facts = describeSkillFromData(skill, cardType);
  if (!facts) return null;

  const sys = `너는 한국어 TCG 카드 텍스트 작가다.
카드의 수치는 이미 확정됐다. 너는 그 수치를 자연스러운 한 문장으로 옮기기만 한다.
출력은 JSON 하나만: {"description": "한 문장"}`;

  // ⚠️ 카드 정보를 **user 메시지에** 넣는다.
  //    system에만 넣었더니 4B 모델이 그걸 무시하고
  //    "이 카드의 설명은 제공되지 않았습니다" 같은 답을 돌려줬다 (전부 폐기됐다).
  const user = `아래 카드의 설명문을 써라.

카드 이름: ${card.name}
종류: ${cardType} / 등급: ${card.rarity} / 마나: ${card.cost}
확정된 효과: ${facts}

규칙:
- 위 "확정된 효과"에 **없는 것을 쓰지 마라.** 지어내면 카드가 거짓말을 한다.
- 위 문장에 나온 **숫자를 그대로** 쓴다. 하나도 빠뜨리지 마라.
- 한 문장, 60자 이내, 한국어.

출력 예: {"description": "적 1체에게 16의 화염 피해를 주고 방어막 10을 얻는다."}
나쁜 예: {"description": "강력한 화염이 적을 불태운다."}  ← 숫자가 없다
나쁜 예: {"description": "적 전체를 태우고 마나를 얻는다."}  ← 없는 효과다

이제 위 카드의 JSON을 출력하라.`;

  try {
    // ⚠️ callOllamaChat은 응답을 **JSON으로 파싱**해서 돌려준다.
    //    평문을 요구하면 파싱 단계에서 통째로 실패한다 (전부 폴백으로 떨어졌다).
    const raw = await callOllamaChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0.6,
      timeoutMs,
      reasoningMode
    });
    const text = String((raw && (raw.description || raw.desc)) || '')
      .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
      .replace(/^(설명문?|효과)\s*[:：]\s*/, '')
      .split('\n')[0]
      .trim();

    const problem = validateDescription(text, skill, cardType, facts);
    if (problem) {
      console.info(`[설명 2단계] 폐기 (${problem}) → 데이터 생성 문장 사용: "${text.slice(0, 40)}"`);
      return null;
    }
    return text;
  } catch (e) {
    console.warn('[설명 2단계] 호출 실패 → 데이터 생성 문장 사용:', e.message);
    return null;
  }
}

/**
 * 카드 설명문을 **정확한 것으로 확정한다.**
 *
 * 2단계가 성공하면 그 문장을, 실패하면 **결정론적 문장**을 쓴다.
 *
 * 🐛 처음에는 실패 시 "기존 설명문을 그대로 둔다"고 했다. 틀렸다.
 *    기존 설명문은 **LLM 1단계 원문**이고, sanitize는 원문이 있으면 숫자만
 *    맞출 뿐 통째로 다시 쓰지는 않는다. 그래서 구현되지 않은 서술이 살아남았다:
 *      "적의 공격 피해 160% 감소"        ← damageReduction은 5~40으로 클램프된다
 *      "[성역의 수호사제] 카드에 방어막"  ← 특정 카드 지정은 구현되지 않았다
 *      "[성역] 카드가 필드에 있을 때:"     ← 조건부 발동은 함정 전용이다
 *    실팩 24장에서 실제로 나왔다.
 *
 * ⚠️ 플레이버를 잃더라도 **정확한 문장이 이긴다.** 이 프로젝트에서 설명문이
 *    거짓말한 사례가 반복됐고, 그때마다 값을 치른 쪽은 플레이어였다.
 *
 * @returns {boolean} 2단계 문장이 채택됐는가 (false여도 설명문은 정확해진다)
 */
export async function applyLlmDescription(card, opts = {}) {
  const skill = card && (card.skill || (card.skills && card.skills[0]));
  if (!skill) return false;
  // 🃏 바닐라는 플레이버 텍스트가 정답이다. 건드리지 않는다.
  if (skill.isVanilla) return false;

  const better = await describeCardWithLLM(card, opts);
  const finalText = better || describeSkillFromData(skill, card.cardType || 'unit');
  if (!finalText) return false;

  skill.description = finalText;
  if (card.skills && card.skills[0]) card.skills[0].description = finalText;
  if (card.skill) card.skill.description = finalText;
  return !!better;
}
