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

// ============================================================
// 🎮 전투 모드 — PvE와 PvP는 규칙이 다르다
// ------------------------------------------------------------
// 억지로 하나의 대칭 엔진으로 합치면 PvE 밸런스가 무너진다.
// 공용 로직(피해·상태이상·연계)은 공유하고, 다른 부분만 모드로 가른다.
// ============================================================
export const BATTLE_MODES = {
  pve: {
    label: 'PvE (보스전)',
    // 보스는 마나를 쓰지 않는다. 스크립트 AI가 턴마다 카드를 몰아 낸다.
    foeUsesMana: false,
    foeVirtualMana: 99,
    // 보스 고유의 다단계 콤보 패턴 사용
    foeComboPatterns: true,
    // 연계 발동 조건을 보스에게도 적용할지 (PvE는 미적용 — 체감이 너무 약해진다)
    foeComboTriggers: false
  },
  pvp: {
    label: 'PvP (1대1 대전)',
    // 양쪽 모두 같은 마나 규칙
    foeUsesMana: true,
    foeVirtualMana: 0,
    // 스크립트 패턴 없음 — 상대도 카드만 낸다
    foeComboPatterns: false,
    // 연계 조건을 양쪽에 동일 적용
    foeComboTriggers: true
  }
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
    damageReductionTurns: 0
  };
}

/**
 * 플레이어 진영 접근자.
 * 게터/세터로 기존 state 필드를 그대로 읽고 쓴다 — 저장 구조 변경 없음.
 */
function makePlayerSide(statuses, buffs) {
  return {
    key: SIDE_PLAYER,
    name: '플레이어',
    isAI: false,

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

    get maxMinions() { return 4; },
    get maxHand() { return 7; },

    statuses,
    buffs
  };
}

/**
 * 상대 진영 접근자 (PvE=보스 / PvP=상대 플레이어).
 *
 * 마나는 모드에 따라 다르다.
 *   PvE: 보스는 마나를 쓰지 않는다 → 가상 99를 노출해 대칭 코드가 깨지지 않게 한다
 *   PvP: 플레이어와 완전히 같은 마나 규칙
 */
function makeFoeSide(statuses, buffs) {
  // PvP에서만 쓰는 실제 마나 저장소
  const pvpMana = { cur: 1, max: 1 };

  return {
    key: SIDE_BOSS,
    get name() { return isPvp() ? '상대' : '보스'; },
    isAI: true,

    get hp() { return state.currentBoss ? state.currentBoss.currentHp : 0; },
    set hp(v) { if (state.currentBoss) state.currentBoss.currentHp = v; },
    get maxHp() { return state.currentBoss ? state.currentBoss.maxHp : 0; },
    set maxHp(v) { if (state.currentBoss) state.currentBoss.maxHp = v; },

    get shield() { return (state.currentBoss && state.currentBoss.shield) || 0; },
    set shield(v) { if (state.currentBoss) state.currentBoss.shield = v; },

    get mana() { return modeConfig().foeUsesMana ? pvpMana.cur : modeConfig().foeVirtualMana; },
    set mana(v) { if (modeConfig().foeUsesMana) pvpMana.cur = v; },
    get maxMana() { return modeConfig().foeUsesMana ? pvpMana.max : modeConfig().foeVirtualMana; },
    set maxMana(v) { if (modeConfig().foeUsesMana) pvpMana.max = v; },

    get deck() { return state.bossDeck || (state.bossDeck = []); },
    set deck(v) { state.bossDeck = v; },
    get hand() { return state.bossHand || (state.bossHand = []); },
    set hand(v) { state.bossHand = v; },
    get minions() { return state.bossMinions; },
    set minions(v) { state.bossMinions = v; },

    // PvP에서는 플레이어와 같은 슬롯 규칙
    get maxMinions() { return isPvp() ? 4 : 3; },
    get maxHand() { return isPvp() ? 7 : 5; },

    statuses,
    buffs
  };
}

/**
 * 전투 진영 한 쌍을 만든다.
 * 상태이상·버프는 battle-engine의 모듈 지역 변수를 그대로 참조하도록 주입받는다.
 */
export function createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs }) {
  return {
    [SIDE_PLAYER]: makePlayerSide(playerStatus, playerBuffs),
    [SIDE_BOSS]: makeFoeSide(bossStatus, bossBuffs || createBuffs())
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

/** 전장의 모든 소환수를 행동 가능 상태로 (빙결 해제 포함) */
export function refreshMinions(side) {
  side.minions.forEach(m => {
    m.canAttack = true;
    m.frozen = false;
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
