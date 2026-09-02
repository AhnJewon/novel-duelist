// combat-side.js - 전투 진영(Side) 추상화
//
// 문제: 배틀 엔진이 PvE 전용 구조였다. 플레이어와 보스가 서로 다른 필드에 살았다.
//
//   플레이어: state.playerHp / playerMaxShield / playerMana / playerDeck / playerHand / playerMinions
//   보스:     state.currentBoss.currentHp / .shield / (마나 없음) / bossDeck / bossHand / bossMinions
//
//   그래서 "피해를 준다", "카드를 낸다" 같은 동작이 진영마다 별개 함수였고,
//   PvP를 얹으려면 전부 다시 써야 했다.
//
// 해결: 저장 구조는 그대로 두고 **접근자(Side)**를 씌운다.
//   기존 세이브 파일과 UI 코드를 건드리지 않으면서 대칭 로직을 쓸 수 있다.
//   나중에 PvP를 붙일 때는 두 번째 플레이어 Side를 만들어 같은 함수에 넘기면 된다.
//
// ⚠️ 새 전투 로직은 state.playerHp를 직접 만지지 말고 side.hp를 쓰세요.
//    그래야 진영을 바꿔 끼울 수 있습니다.

import { state } from './storage.js';
import { createStatusState } from './status-effects.js';
import { SLOT_CAP, HAND_CAP } from './battle-rules.js';

// ============================================================
// 🎮 전투 모드 — 라벨과 `isPvp()` 판정만 담는다
// ------------------------------------------------------------
// 🐛 예전에는 `foeUsesMana`·`foeVirtualMana`·`foeComboPatterns` 플래그가 있었지만
//    아무도 읽지 않았고(둘 다 마나를 쓰게 된 뒤 가상 마나 분기는 도달 불가),
//    "PvE와 PvP는 규칙이 다르다"는 착시만 만들었다. **규칙은 양 진영·양 모드 동일**하다.
//    다른 것은 상대 진영을 누가 조종하는가(사람/봇/원격)뿐이고 그건 `side.controller`가 쥔다.
//    보스 고유의 콤보 스텝은 봇 컨트롤러의 행동이다 → DECISIONS #94
//
// ⚠️ 연계 발동조건도 모드와 무관하게 양 진영 동일이다 (archetype-combos.js의 runArchetypeCombo).
// ============================================================
export const BATTLE_MODES = {
  pve: { label: 'PvE (보스전)' },
  pvp: { label: 'PvP (1대1 대전)' }
};

let _mode = 'pve';

export function setBattleMode(mode) {
  _mode = BATTLE_MODES[mode] ? mode : 'pve';
  return _mode;
}

export function getBattleMode() {
  return _mode;
}

export function modeConfig() {
  return BATTLE_MODES[_mode] || BATTLE_MODES.pve;
}

export function isPvp() {
  return _mode === 'pvp';
}

export const SIDE_PLAYER = 'player';
export const SIDE_BOSS = 'boss';

/** 진영별 버프 기본값 */
export function createBuffs() {
  return {
    doubleCast: false,
    invulnerable: 0,
    pierceShield: false,
    // 🛡️ 피해 경감 (%) + 남은 턴. 무적과 달리 완전 차단이 아니라 비율로 깎는다.
    damageReduction: 0,
    damageReductionTurns: 0,
    // 🌵 가시(받은 피해 반사 비율)와 남은 턴.
    //    🐛 예전엔 `state.currentBoss.thorns`에만 있어 보스 전용이었고, 한 번 걸리면
    //       전투 끝까지 영구였다(초기화도 안 됨). 버프로 두면 양 진영이 가질 수 있고
    //       턴 시작마다 줄어든다.
    thorns: 0,
    thornsTurns: 0
  };
}

/**
 * 플레이어 진영 접근자.
 * 게터/세터로 기존 state 필드를 그대로 읽고 쓴다 — 저장 구조 변경 없음.
 */
function makePlayerSide(statuses, buffs, trapZones) {
  return {
    key: SIDE_PLAYER,
    name: '플레이어',
    // 🎮 누가 조종하는가 (human | bot | remote). 규칙 함수는 이 값을 보지 않는다 —
    //    "봇만 콤보 스텝을 낼 수 있다" 같은 관문만 본다.
    controller: 'human',
    get isAI() { return this.controller !== 'human'; },

    get hp() { return state.playerHp; },
    set hp(v) { state.playerHp = v; },
    get maxHp() { return state.playerMaxHp; },
    set maxHp(v) { state.playerMaxHp = v; },

    get shield() { return state.playerMaxShield; },
    set shield(v) { state.playerMaxShield = v; },

    get mana() { return state.playerMana; },
    set mana(v) { state.playerMana = v; },
    get maxMana() { return state.playerMaxMana; },
    set maxMana(v) { state.playerMaxMana = v; },

    get deck() { return state.playerDeck; },
    set deck(v) { state.playerDeck = v; },
    get hand() { return state.playerHand; },
    set hand(v) { state.playerHand = v; },
    get minions() { return state.playerMinions; },
    set minions(v) { state.playerMinions = v; },

    get maxMinions() { return SLOT_CAP; },
    get maxHand() { return HAND_CAP; },

    // 🪤 세트된 함정 — battle-engine의 모듈 지역 trapZones를 진영 시점으로 노출한다
    get traps() { return trapZones ? trapZones[SIDE_PLAYER] : []; },
    set traps(v) { if (trapZones) trapZones[SIDE_PLAYER] = v; },
    get lastCastCard() { return state.playerLastCastCard || null; },
    set lastCastCard(v) { state.playerLastCastCard = v; },

    statuses,
    buffs
  };
}

/**
 * 상대 진영 접근자 (PvE=봇 보스 / PvP=원격 플레이어).
 *
 * 규칙은 플레이어와 **완전히 같다** — 슬롯 4, 손패 7, 마나 성장 동일.
 * 보스가 특별한 것은 콤보 스텝(봇 컨트롤러의 행동)과 체력 데이터뿐이다.
 *
 * 🐛 예전에는 마나가 클로저(`pvpMana`)에 살아서 `state.bossMana`(거울 뷰가 읽고 쓰는 곳)와
 *    **두 집**이었다 — 거울의 manaGain은 죽은 필드에 썼고, growMana는 클로저에만 썼다.
 *    슬롯 3·손패 5도 보스만 작았다. 이제 한 집, 한 값이다 → DECISIONS #94
 */
function makeFoeSide(statuses, buffs, trapZones) {
  let controller = null;   // initBattle이 세팅. 비어 있으면 모드에서 추론한다.

  return {
    key: SIDE_BOSS,
    // 로그에 찍히는 이름 — 보스 데이터/원격 프로필의 실제 이름을 쓴다
    get name() {
      return (state.currentBoss && state.currentBoss.name) || (isPvp() ? '상대' : '보스');
    },
    get controller() { return controller || (isPvp() ? 'remote' : 'bot'); },
    set controller(v) { controller = v; },
    get isAI() { return this.controller !== 'human'; },

    get hp() { return state.currentBoss ? state.currentBoss.currentHp : 0; },
    set hp(v) { if (state.currentBoss) state.currentBoss.currentHp = v; },
    get maxHp() { return state.currentBoss ? state.currentBoss.maxHp : 0; },
    set maxHp(v) { if (state.currentBoss) state.currentBoss.maxHp = v; },

    get shield() { return (state.currentBoss && state.currentBoss.shield) || 0; },
    set shield(v) { if (state.currentBoss) state.currentBoss.shield = v; },

    get mana() { return Number.isFinite(state.bossMana) ? state.bossMana : 0; },
    set mana(v) { state.bossMana = v; },
    get maxMana() { return Number.isFinite(state.bossMaxMana) ? state.bossMaxMana : 0; },
    set maxMana(v) { state.bossMaxMana = v; },

    get deck() { return state.bossDeck || (state.bossDeck = []); },
    set deck(v) { state.bossDeck = v; },
    get hand() { return state.bossHand || (state.bossHand = []); },
    set hand(v) { state.bossHand = v; },
    get minions() { return state.bossMinions || (state.bossMinions = []); },
    set minions(v) { state.bossMinions = v; },

    get maxMinions() { return SLOT_CAP; },
    get maxHand() { return HAND_CAP; },

    get traps() { return trapZones ? trapZones[SIDE_BOSS] : []; },
    set traps(v) { if (trapZones) trapZones[SIDE_BOSS] = v; },
    get lastCastCard() { return state.bossLastCastCard || null; },
    set lastCastCard(v) { state.bossLastCastCard = v; },

    statuses,
    buffs
  };
}

/**
 * 전투 진영 한 쌍을 만든다.
 * 상태이상·버프·함정 구역은 battle-engine의 모듈 지역 변수를 그대로 참조하도록 주입받는다.
 * (⚠️ trapZones는 sides보다 **먼저** 만들어 넘겨야 side.traps가 산다)
 */
export function createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs, trapZones = null }) {
  return {
    [SIDE_PLAYER]: makePlayerSide(playerStatus, playerBuffs, trapZones),
    [SIDE_BOSS]: makeFoeSide(bossStatus, bossBuffs || createBuffs(), trapZones)
  };
}

/** 상대 진영 키 */
export function opponentOf(sideKey) {
  return sideKey === SIDE_PLAYER ? SIDE_BOSS : SIDE_PLAYER;
}

// ============================================================
// 진영 공용 동작 — 여기 있는 함수는 어느 진영에나 그대로 쓴다
// ============================================================

/** 카드를 낼 수 있는가 (마나·슬롯·손패 조건) */
export function canPlayCard(side, card) {
  if (!card) return { ok: false, reason: '카드 없음' };
  if (card.cost > side.mana) {
    return { ok: false, reason: `마나 부족 (필요 ${card.cost}, 보유 ${side.mana})` };
  }
  const type = card.cardType || 'unit';
  if (type !== 'spell' && type !== 'trap' && side.minions.length >= side.maxMinions) {
    return { ok: false, reason: `전장이 가득 참 (최대 ${side.maxMinions})` };
  }
  return { ok: true };
}

/** 덱에서 손패로. 덱이 비면 리셔플 콜백을 호출한다. */
export function drawTo(side, count, { onEmpty = null, onDraw = null } = {}) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (side.hand.length >= side.maxHand) break;
    if (side.deck.length === 0) {
      if (typeof onEmpty === 'function') onEmpty(side);
      if (side.deck.length === 0) break;
    }
    const card = side.deck.pop();
    if (!card) break;
    side.hand.push(card);
    drawn.push(card);
    if (typeof onDraw === 'function') onDraw(card, side);
  }
  return drawn;
}

/** 손패에서 무작위 1장 파기 */
export function discardRandom(side, rng) {
  if (side.hand.length === 0) return null;
  const idx = rng.index(side.hand.length);
  return side.hand.splice(idx, 1)[0];
}

/** 턴 시작 시 마나 성장 (정통 TCG 룰: 턴 수만큼, 상한 10) */
export function growMana(side, turnCount, cap = 10) {
  side.maxMana = Math.min(cap, turnCount);
  side.mana = side.maxMana;
}

/**
 * 전장의 소환수를 행동 가능 상태로 되돌린다.
 *
 * ⚠️ **이번 턴에 소환된 소환수는 풀어주지 않는다** (소환 후유증).
 *    🐛 예전에는 무조건 `canAttack = true`로 밀었다. 그래서 보스 턴 시작에
 *       이 함수가 돌면 **방금 배치된 소환수까지 풀려서** 소환 후유증이
 *       무효가 됐다 (전투 시작 소환수 2기가 1턴부터 본체를 직격).
 *    판정 기준은 `summonedTurn` — 소환된 턴 번호다. 없으면(구 세이브)
 *    후유증이 이미 끝난 것으로 본다.
 *
 * ⚠️ 상태이상 소모·감쇠는 여기서 하지 않는다. battle-engine의
 *    `tickMinionStatuses()`가 지속 피해까지 한 번에 처리하고
 *    `m.blockedBy`를 세워둔다. 여기서는 그 결과만 존중한다.
 *    (두 곳에서 소모하면 기절이 절반 턴만 유지되는 이중 차감이 된다)
 */
export function refreshMinions(side) {
  side.minions.forEach(m => {
    m.frozen = !!m.blockedBy && m.blockedBy === 'freeze';
    const summonSick = Number.isFinite(m.summonedTurn) && m.summonedTurn >= state.turnCount;
    m.canAttack = !m.blockedBy && !summonSick;
  });
}

/** 진영 요약 (디버깅·동기화 검증용) */
export function describeSide(side) {
  return {
    진영: side.name,
    HP: `${side.hp}/${side.maxHp}`,
    방어막: side.shield,
    마나: `${side.mana}/${side.maxMana}`,
    덱: side.deck.length,
    손패: side.hand.length,
    소환수: side.minions.length
  };
}
