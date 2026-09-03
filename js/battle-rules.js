// battle-rules.js - 양 진영이 공유하는 전투 상수 (import 없음)
//
// ⚠️ 이 파일은 아무것도 import하지 않는다. combat-side ↔ archetype-identity ↔ skill-effects가
//    서로를 import하면 순환이 생기므로, 셋이 함께 쓰는 숫자는 여기서만 정한다.
//
// 🐛 예전에는 같은 숫자가 네 곳에 흩어져 있었다 — 슬롯은 4(플레이어)/3(보스) 두 값,
//    손패 상한은 7(플레이어)/5(보스)에 skill-effects·archetype-combos·HAND_CAP까지 복제됐다.
//    "보스는 콤보를 가진 봇 플레이어"(DECISIONS #94)이므로 양 진영이 한 값을 쓴다.

/** 전장 슬롯 수 — 양 진영 동일 */
export const SLOT_CAP = 4;

/** 손패 상한 — 양 진영 동일 */
export const HAND_CAP = 7;

/**
 * 🌵 가시(피해 반사) 지속 턴. 콤보 스텝이 `turns`를 안 주면 이 값.
 * 유저 결정(DECISIONS #94): 예전엔 보스 전용·영구였다 — 한 번 걸리면 전투 끝까지.
 * 그 진영의 턴 시작마다 1씩 줄고 0이 되면 반사가 사라진다 (2 = 상대 턴 두 번 동안 반사).
 */
export const THORNS_TURNS = 2;

/** 🤖 봇이 액션 사이에 두는 간격(ms) — 사람이 로그를 따라 읽을 수 있게. 하네스는 0을 넘긴다. */
export const BOT_PACE_MS = 400;

/**
 * 💀 처형 배수 — 상대 본체가 문턱 이하일 때 피해 배수. 카드 효과(skill-effects)와 보스 콤보 스텝(boss-ai)이
 * 같은 값을 쓴다. 🐛 예전엔 카드 2배 / 스텝 2.2배 / 키워드 사전 "2.2배 이상"으로 셋이 달랐다 (DECISIONS #94).
 */
export const EXECUTE_MULT = 2;
