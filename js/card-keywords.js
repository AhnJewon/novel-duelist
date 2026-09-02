// card-keywords.js - 카드가 가진 **규칙 변경 키워드**를 읽는 단일 소스
//
// 왜 별도 모듈인가:
//   이 판정은 전투 엔진(규칙 강제), 카드 렌더러(뱃지), 카드 상세(설명)가
//   모두 필요로 한다. 엔진에 두면 렌더러가 엔진을 import해야 하는데
//   엔진이 이미 렌더러를 import하고 있어 순환이 된다.
//   그래서 **아무것도 import하지 않는** 이 파일에 모은다.
//
// ⚠️ 도발·직접공격 판정은 반드시 여기를 거치세요. 한 곳이라도 직접
//    `card.taunt`를 읽으면 조용히 어긋납니다 — 실제로 그랬습니다:
//      · 엔진: 플레이어 카드의 도발이 전달되지 않았다 (DECISIONS #80)
//      · 상세 팝업: `card.taunt`만 읽어서 손패 카드는 도발 표시가 없었다

/** 스킬 객체 꺼내기 (카드마다 skills[0] / skill 두 형태가 섞여 있다) */
function skillOf(card) {
  if (!card) return null;
  return card.skill || (Array.isArray(card.skills) && card.skills[0]) || null;
}

/**
 * 🛡️ 이 카드가 도발을 갖는가.
 *
 * `taunt`가 사는 곳이 두 군데다:
 *   · data.js의 보스 부하: **최상위** `taunt: true`
 *   · LLM/팩 생성 카드:     **skill** 안의 `taunt: true`
 *
 * 건축물은 공격할 수 없으므로 자동으로 도발이다 — 그게 존재 이유다.
 */
export function readTaunt(card) {
  if (!card) return false;
  if (card.cardType === 'structure') return true;
  if (card.taunt) return true;
  const skill = skillOf(card);
  return !!(skill && skill.taunt);
}

/**
 * ⚔️ 이 카드가 **직접 공격**(상대 전장을 무시하고 본체 타격)을 갖는가.
 * `readTaunt`와 같은 이유로 최상위·skill 양쪽을 본다.
 */
export function readDirectAttack(card) {
  if (!card) return false;
  if (card.directAttack) return true;
  const skill = skillOf(card);
  return !!(skill && skill.directAttack);
}
