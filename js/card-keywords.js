// card-keywords.js - 카드가 가진 **규칙 변경 키워드**를 읽는 단일 소스
//
// 왜 별도 모듈인가:
//   이 판정은 전투 엔진(규칙 강제), 카드 렌더러(뱃지), 카드 상세(설명)가
//   모두 필요로 한다. 엔진에 두면 렌더러가 엔진을 import해야 하는데
//   엔진이 이미 렌더러를 import하고 있어 순환이 된다.
//   그래서 **아무것도 import하지 않는** 이 파일에 모은다.
//
// 🗑️ 도발(taunt)은 **게임에서 제거됐다.** → DECISIONS #84
//    전장에 소환수가 있으면 본체를 칠 수 없는 규칙(#81)이 들어오면서
//    도발이 하던 "본체를 막는다"는 일을 전장 자체가 하게 됐다.
//    남겨두니 "전장의 누구부터 맞는가"만 정하는 반쪽 규칙이 되어,
//    하스스톤식 도발과 유희왕식 전장 차단이 한 판에 섞이는 위화감만 남았다.
//    이제 공격자는 상대 전장의 소환수 중 **아무나** 고른다.

/** 스킬 객체 꺼내기 (카드마다 skills[0] / skill 두 형태가 섞여 있다) */
function skillOf(card) {
  if (!card) return null;
  return card.skill || (Array.isArray(card.skills) && card.skills[0]) || null;
}

/**
 * ⚔️ 이 카드가 **직접 공격**(상대 전장을 무시하고 본체 타격)을 갖는가.
 *
 * ⚠️ `directAttack`이 사는 곳이 두 군데다 — 최상위와 skill 안.
 *    한쪽만 읽으면 조용히 무효가 된다. 반드시 이 함수를 쓰세요.
 */
export function readDirectAttack(card) {
  if (!card) return false;
  if (card.directAttack) return true;
  const skill = skillOf(card);
  return !!(skill && skill.directAttack);
}
