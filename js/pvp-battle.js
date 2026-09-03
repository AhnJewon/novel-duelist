// pvp-battle.js - PvP 대전과 배틀 엔진을 잇는 브릿지
//
// ─────────────────────────────────────────────────────────────
// 왜 "보스 자리에 원격 플레이어를 앉히는가"
//
// battle-engine.js는 완전히 PvE 형태다. 플레이어 진영과 보스 진영이 있고
// executeBossTurn()이 스크립트 AI를 돌린다. 이걸 대칭 엔진으로 다시 쓰면
// 잘 돌아가던 PvE 밸런스와 연출이 전부 위험해진다.
//
// 그래서 구조를 바꾸지 않고 **보스 자리를 원격 플레이어가 차지**하게 한다.
//   내 화면:  나 = player 진영 / 상대 = boss 진영
//   상대 화면: 상대 = player 진영 / 나 = boss 진영
// 서로 거울처럼 본다. 턴도 자연히 교대된다 —
// 내 "플레이어 턴"이 상대에겐 "보스 턴"이다.
//
// combat-side.js가 애초에 이걸 노리고 만들어졌다 (BATTLE_MODES.pvp).
// ─────────────────────────────────────────────────────────────
//
// 동기화 방식: **락스텝**
//   양쪽이 같은 시드로 같은 코드를 돌리므로, 같은 행동을 같은 순서로
//   재생하면 결과가 같아진다. 그래서 "피해량"이 아니라 "행동"을 보낸다.
//   → 전투 로직에서 Math.random()을 쓰면 이게 깨진다. battleRng()를 쓸 것.
//     (DECISIONS #28)
//
//   카드는 handIdx가 아니라 **instanceId**로 가리킨다. 손패 정렬이 미세하게
//   달라도 같은 카드를 집도록.

import { setBattleMode, isPvp } from './combat-side.js';

let _session = null;      // pvp-session.js가 만든 세션
let _foeName = '상대';
let _myTurn = false;      // PvP에서 지금 내 턴인가
let _handlers = {};       // battle-engine이 등록하는 실제 동작

/** battle-engine이 자기 함수를 등록한다 (순환 import를 피하려는 구조) */
export function registerPvpHandlers(handlers) {
  _handlers = handlers || {};
}

export function attachPvpSession(session, { foeName = '상대', isHost = false } = {}) {
  _session = session;
  _foeName = foeName || '상대';
  // 호스트가 선공. 양쪽이 같은 규칙을 써야 둘 다 자기 턴이라고 믿는 사고가 없다.
  _myTurn = !!isHost;
  setBattleMode('pvp');
}

export function detachPvpSession() {
  _session = null;
  _myTurn = false;
  setBattleMode('pve');
}

export function isPvpActive() {
  return !!_session && isPvp();
}

export function getFoeName() {
  return _foeName;
}

export function isMyPvpTurn() {
  return !isPvpActive() || _myTurn;
}

/** 내 행동을 상대에게 알린다. PvP가 아니면 아무것도 하지 않는다. */
export function sendPvpAction(action) {
  if (!isPvpActive() || !action) return;
  try {
    _session.sendAction(action);
  } catch (e) {
    console.warn('[PvP] 행동 전송 실패:', e.message);
  }
}

/**
 * 상대 행동을 내 화면에 재생한다.
 * pvp-session의 onFoeAction에 이 함수를 물린다.
 *
 * 카드 찾기·손패 제거·대상·턴 넘김은 전부 엔진의 applyFoeAction이 한다 — PvE 봇과 **같은 파이프**다.
 * 🐛 예전엔 여기서 카드를 찾고 손패를 빼고 종류별로 다른 핸들러를 불렀고, attack 핸들러는
 *    targetKey를 버렸다. 파이프가 둘이면 한쪽만 고쳐지는 일이 반복된다 (DECISIONS #94).
 */
export async function handleRemoteAction(action) {
  if (!isPvpActive() || !action || !action.kind) return;
  if (action.kind === 'endTurn') _myTurn = true;   // 상대 턴이 끝났다 → 이제 내 턴
  if (_handlers.applyFoeAction) await _handlers.applyFoeAction(action);
}

/** 내 턴을 끝내고 상대에게 넘긴다 */
export function endMyPvpTurn() {
  if (!isPvpActive()) return;
  _myTurn = false;
  sendPvpAction({ kind: 'endTurn' });
}

/**
 * 카드를 전송용으로 줄인다.
 * 이미지(base64)를 그대로 보내면 데이터 채널이 막힌다 — 반드시 뺀다.
 */
export function slimCardForWire(card) {
  if (!card) return null;
  const { imageUrl, prompt, crop, ...rest } = card;
  return rest;
}
