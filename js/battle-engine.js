// battle-engine.js - 정통 카드 배틀 엔진 (소환수 / 주문 / 건축물 & 보스 멀티액션)

import { ELEMENT_CONFIG, PLAYER_BASE_HP, BOSS_STEP_DAMAGE_MULT } from './config.js';
import { audio } from './audio.js';
import { state } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { triggerLiveBossReaction } from './boss-forge.js';
import { BOSS_DATA, BOSS_ADD_POOL, ELEMENT_BOSS_MINIONS, BOSS_POWER_CARDS } from './data.js';
import {
  evaluateFieldSynergy, findSynergyForEntity,
  triggerArchetypeCombo, triggerBossArchetypeCombo
} from './archetype-service.js';
import {
  STATUS_EFFECTS, createStatusState, applyStatus, consumeBlockingStatus, isEntityOnly,
  collectDamageOverTime, decayStatuses,
  getIncomingDamageMultiplier, getOnHitBonusDamage, describeStatuses
} from './status-effects.js';
import {
  applyPlayerSkillEffects, selectFrontTarget, strikeFrontLine,
  damageEntity, removeDead, describeDamageExtras
} from './skill-effects.js';
import { escapeHtml, escapeJsString } from './dom-utils.js';
import { attachCardDetail, hideCardDetail } from './card-detail.js';
import { beginTargeting, isTargeting, cancelTargeting, pickTarget, isValidTarget, decorateTargets } from './targeting.js';
import { readTargetSpec, needsTargetPick, collectTargetKeys, describeTarget } from './effect-targets.js';
import { battleRng, seedBattleRng, currentBattleSeed } from './rng.js';
import { TRAP_ZONE_SIZE, checkTraps, canSetTrap, describeTrap, renderTrapZone } from './trap-system.js';
import {
  createSides, createBuffs, opponentOf, SIDE_PLAYER, SIDE_BOSS,
  canPlayCard, drawTo, discardRandom, growMana, refreshMinions, describeSide
} from './combat-side.js';
import {
  isPvpActive, sendPvpAction, endMyPvpTurn, getFoeName,
  registerPvpHandlers, slimCardForWire
} from './pvp-battle.js';
import { readDirectAttack } from './card-keywords.js';
import { SLOT_CAP } from './battle-rules.js';

// 전장 슬롯은 양 진영 동일 (battle-rules.js). 🐛 예전엔 보스만 3이었다 → DECISIONS #94
export const BATTLE_SLOTS = SLOT_CAP;

// 🛡️⚔️ 도발·직접공격 판정은 card-keywords.js가 단일 소스다.
//    카드 렌더러와 상세 팝업도 같은 함수를 써야 해서 엔진 밖으로 뺐다
//    (엔진이 렌더러를 import하고 있어 반대 방향 import는 순환이 된다).
//
// ⚠️ `export { x } from '...'`는 **재수출일 뿐 지역 바인딩을 만들지 않는다.**
//    그것만 두면 이 파일 안의 호출이 전부 ReferenceError가 난다.
//    import와 re-export를 따로 쓴다.
export { readDirectAttack } from './card-keywords.js';

/**
 * 🏟️ **전장에 소환수가 있으면 본체를 직접 칠 수 없다** (유희왕식).
 *
 * 🐛 예전에는 두 진영이 서로 다른 규칙을 썼다:
 *    · 보스 → 플레이어 전장이 비었을 때만 본체 타격 (유희왕식)
 *    · 플레이어 → **도발만 없으면** 본체 타격 (하스스톤식)
 *    같은 판에서 규칙이 둘이라 위화감이 컸고, 좁은 필드(4칸/3칸)에서는
 *    도발이 슬롯의 25%를 먹어 쓰기도 어려웠다.
 *
 * 이제 양쪽 다 이 함수를 쓴다. 소환수 하나하나가 곧 방벽이 되고,
 * 도발은 "그 소환수들 중 **누구를** 먼저 쳐야 하는가"를 정하는 역할로 남는다.
 *
 * 예외는 `directAttack`을 가진 카드뿐이다 — 값을 치르고 사는 능력이다.
 */
export function canAttackFace(defenderMinions, attacker) {
  const alive = (defenderMinions || []).filter(m => m && m.currentHp > 0);
  if (alive.length === 0) return true;
  return readDirectAttack(attacker);
}

// ============================================================
// 🐌 보스 공세 램프 — 초반 턴에는 보스도 천천히 전개한다
// ------------------------------------------------------------
// 🐛 왜 필요한가: 보스는 마나를 쓰지 않는다(foeVirtualMana 99). 그래서
//    플레이어가 1마나뿐인 1턴에 소환수를 3기까지 채우고 카드도 2~3장 냈다.
//    측정 결과 턴1 보스 딜이 34~59였고 플레이어 체력은 50이라,
//    **첫 손패에 싼 카드가 없으면 아무것도 못 하고 2턴에 죽었다.**
//
//    플레이어의 마나 커브(1→2→3…)에 맞춰 보스도 초반을 늦춘다.
//    후반 난이도는 그대로다 — 압박을 없애는 게 아니라 **뒤로 미루는 것**이다.
//
// ⚠️ 여기 수치를 올리면 초반 난이도가 그대로 돌아온다. 바꾸기 전에
//    "패스만 하며 몇 턴 버티는가"를 반드시 측정하세요 → DECISIONS #75
const BOSS_RAMP = {
  1: { minions: 1, cards: 1 },
  2: { minions: 2, cards: 1 }
  // 3턴 이후는 제한 없음 (SLOT_CAP / 기본 카드 수)
};

/** 이번 턴 보스가 채울 수 있는 최대 소환수 수 */
function bossMinionCapThisTurn() {
  const ramp = BOSS_RAMP[state.turnCount];
  return ramp ? Math.min(SLOT_CAP, ramp.minions) : SLOT_CAP;
}

let isPlayerTurn = true;
let bossPhase = 1;

// 상태이상은 status-effects.js가 단일 소스. { [type]: {turns, value} } 형태.
let bossStatus = createStatusState();
let playerStatus = createStatusState();

let playerBuffs = createBuffs();
let bossBuffs = createBuffs();

// 🪤 세트된 함정. 진영별로 분리해 관리한다.
// 상대의 행동에만 반응하므로 소유자를 알아야 한다. (sides보다 먼저 — side.traps가 이걸 본다)
let trapZones = { player: [], boss: [] };

// 진영 접근자. 저장 구조는 그대로 두고 대칭 인터페이스만 씌운다.
// 새 전투 로직은 state.playerHp가 아니라 sides.player.hp를 쓰세요.
let sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs, trapZones });

// 🎯 슬롯을 눌러 소환할 때의 목표 위치. 카드를 그냥 클릭하면 null(맨 뒤).
let _pendingSummonSlot = null;

// 🎯 대상 지정을 마치고 playCard로 되돌아올 때 실어 보내는 대상 키 배열
let _pendingPicked = null;

// 🪤 함정 연쇄 방지 — 함정이 함정을 부르는 무한 루프를 한 단계에서 끊는다
let _trapChainGuard = false;

/** 세트된 함정 목록 (UI/디버깅용) */
export function getTrapZone(sideKey) {
  return trapZones[sideKey] || [];
}

/** 진영 접근자 (외부에서 전투 상태를 대칭적으로 읽을 때) */
export function getSide(key) {
  return sides[key];
}

/** 두 진영 요약 — 동기화 검증·디버깅용 */
export function describeBattleSides() {
  return { player: describeSide(sides.player), boss: describeSide(sides.boss) };
}

/**
 * 효과·연계가 읽는 **게임 뷰**. 플레이어는 state 그대로, 상대는 진영을 뒤집은 거울.
 * 필드 이름(`playerHp`=자기, `bossMinions`=상대)은 유산이고 의미는 self/foe다.
 */
function viewFor(side) {
  return side.key === SIDE_PLAYER ? state : makeMirroredGame();
}

/**
 * 효과·연계에 넘기는 헬퍼 묶음 — **진영 상대적**이다.
 *
 * 키 이름은 유산이다: `dealDamageToBoss` = "내 상대의 본체에", `setPlayerStatus` = "내 진영에",
 * `setBossStatus` = "상대 진영에". 플레이어 카드든 상대 카드든 **같은 구현이 같은 이름**으로 쓴다.
 *
 * 🐛 예전에는 세 벌이었다 — makeComboHelpers(플레이어), makeMirroredHelpers(PvP 거울),
 *    makeBossComboHelpers(보스 전용 구현). 키가 서로 달라 한쪽에만 있는 헬퍼를 부르면
 *    TypeError가 runArchetypeCombo의 try/catch에 삼켜져 조용히 아무 일도 안 일어났다
 *    (DECISIONS #82). 거울은 drawCards의 n을 무시하고 1장만 뽑았다.
 *    보스 전용 연계 구현이 사라지는 2단계까지 makeBossComboHelpers만 잠시 남는다 → DECISIONS #94
 */
function helpersFor(side) {
  const other = sides[opponentOf(side.key)];
  const mine = side.key === SIDE_PLAYER;
  const labelOf = (s) => (s.key === SIDE_PLAYER ? '내' : '상대');
  return {
    addBattleLog,
    audio,
    // "적 본체에 피해" — 이 진영의 상대에게
    dealDamageToBoss: mine
      ? (dmg, src) => dealDamageToBoss(dmg, src)
      : (dmg) => applyDirectDamageToPlayer(dmg, false),
    // 드로우는 **자기** 덱에서 자기 손패로, n장
    drawCards: (n = 1) => (mine ? drawCards(n) : drawTo(side, n, { onDraw: () => audio.playDraw() })),
    // 💫 소환수 전용 상태이상(기절·빙결·화상·맹독)은 본체에 걸리지 않는다.
    //    관문이 그 진영의 최전방 소환수로 돌린다.
    setBossStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(other.statuses, other.minions, labelOf(other), type, turns, value, allowBody),
    setPlayerStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(side.statuses, side.minions, labelOf(side), type, turns, value, allowBody),
    setPlayerBuff: (type, val) => { side.buffs[type] = val; },
    // 로그는 늘 **내 화면** 기준이다 — 상대 카드가 "적"을 치면 그건 나다
    foeLabel: mine ? other.name : '나',
    onShielded: () => triggerTraps(side.key, 'shielded', null),
    foeHp: () => other.hp,
    foeMaxHp: () => other.maxHp,
    // 상대 손패 무작위 파기 — 반드시 battleRng를 거쳐야 PvP가 어긋나지 않는다
    discardFromBoss: () => discardRandom(other, battleRng())
  };
}

/**
 * 보스 전용 연계 구현(ARCHETYPE_COMBO_ACTIONS[*].boss)이 쓰는 헬퍼 묶음.
 * ⚠️ 2단계(연계 한 벌)에서 그 구현과 함께 삭제된다. 새 코드는 helpersFor(side)를 쓰세요.
 */
function makeBossComboHelpers() {
  return {
    addBattleLog,
    audio,
    applyDirectDamageToPlayer,
    // 보스가 플레이어 손패를 파기할 때 — 반드시 battleRng를 거쳐야 PvP가 어긋나지 않는다
    discardFromPlayer: () => discardRandom(sides.player, battleRng()),
    // 보스가 자기 진영에 거는 예약 버프 (과충전 등)
    setFoeBuff: (type, val) => { bossBuffs[type] = val; },
    // 상태이상 관문 — 소환수 전용 계열은 최전방 소환수로 돌아간다
    setPlayerStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(playerStatus, state.playerMinions, '내', type, turns, value, allowBody),
    setBossStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(bossStatus, state.bossMinions, '상대', type, turns, value, allowBody)
  };
}

// ============================================================
// 🔬 검증용 내부 접근자
// ------------------------------------------------------------
// ⚠️ 게임 코드에서 쓰지 마세요. 전투 검증 하네스가 **진짜 헬퍼 묶음**을
//    쓰게 하려고 노출합니다.
//
//    왜 필요한가: 하네스가 헬퍼를 직접 목으로 만들면 하나만 빠져도
//    액션이 TypeError를 내고 runArchetypeCombo의 try/catch가 그것을
//    console.warn으로 삼킨다. 결과는 조용한 null — **버그와 구분되지 않는다.**
//    실제로 두 번 오판했다. → DECISIONS #82
// ============================================================
export const __test = {
  /** 진영 상대적 헬퍼 (기본 플레이어). 'boss'를 주면 거울 진영의 같은 묶음 */
  helpers: (key = SIDE_PLAYER) => helpersFor(sides[key]),
  /** 상대 진영의 게임 뷰 (거울) */
  foeGame: () => viewFor(sides[SIDE_BOSS]),
  bossHelpers: () => makeBossComboHelpers(),
  buffs: () => ({ player: playerBuffs, boss: bossBuffs }),
  statuses: () => ({ player: playerStatus, boss: bossStatus }),
  traps: () => trapZones,
  setTrap: (sideKey, card) => setTrap(sideKey, card),
  fireTraps: (actorKey, event, card) => triggerTraps(actorKey, event, card),
  bossStep: (step) => executeSingleBossStep(step),
  isPlayerTurn: () => isPlayerTurn,
  /** 모듈 지역 전투 상태(상태이상·버프·함정)를 초기화한다 */
  reset() {
    bossStatus = createStatusState();
    playerStatus = createStatusState();
    playerBuffs = createBuffs();
    bossBuffs = createBuffs();
    trapZones = { player: [], boss: [] };
    sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs, trapZones });
    state.bossMana = 1;
    state.bossMaxMana = 1;
    isPlayerTurn = true;
    bossPhase = 1;
    // ⚠️ 대상 선택 모드도 반드시 끈다. 켜진 채로 남으면 다음 검사의
    //    attackWithMinion이 "취소"로 해석해 곧바로 반환한다 —
    //    기능이 고장난 것처럼 보이지만 실은 앞 검사가 남긴 찌꺼기다.
    if (isTargeting()) cancelTargeting(false);
    _pendingSummonSlot = null;
    _pendingPicked = null;
  }
};

// 전투 UI가 읽는 현재 상태이상 스냅샷
export function getBattleStatusSnapshot() {
  return {
    boss: describeStatuses(bossStatus),
    player: describeStatuses(playerStatus)
  };
}

/**
 * 출전 덱을 실제 전투용 카드 배열로 만든다.
 *
 * ⚠️ 반드시 **복제**해야 한다.
 *    보관함에는 카드가 1장만 있어도 덱에는 같은 id를 여러 번 넣을 수 있는데
 *    (AI 생성 게임이라 같은 카드를 여러 장 만들 수 없으므로),
 *    복제하지 않으면 3장이 전부 같은 객체를 가리켜
 *    한 장이 피해를 입으면 나머지도 같이 죽는다.
 */
export function getActiveDeckCards() {
  const activeCards = (state.activeDeckCardIds || [])
    .map((id, idx) => {
      const src = state.cardsCollection.find(c => c.id === id);
      if (!src) return null;
      // 사본마다 고유 인스턴스 id를 준다 (전장 추적·연계 판정에 필요)
      return { ...src, instanceId: `${id}#${idx}` };
    })
    .filter(Boolean);

  if (activeCards.length >= 4) return activeCards;

  // 활성 덱이 비었거나 4장 미만이면 보관함에서 자동 충당
  return state.cardsCollection.slice(0, 10).map((c, idx) => ({ ...c, instanceId: `${c.id}#auto${idx}` }));
}

// 🎴 보스 전용 전술 덱 생성기 (플레이어 제작 카드 + 보스 파워 카드 결합)
/**
 * 🎴 보스 전술 덱 생성기.
 *
 * boss.themeId가 있으면 **테마 보스**가 된다 — 자기 카드군 카드와 범용 카드만 쓴다.
 * 유희왕 보스전처럼 "이 보스는 [홍련] 덱을 쓴다"가 성립하고, 플레이어는
 * 그 카드군의 약점을 노리는 함정을 준비할 수 있다.
 */
export function buildBossTacticalDeck(boss) {
  const el = boss.element || 'fire';
  const themeId = boss.themeId || null;
  const themeName = boss.themeName || null;
  const bossDeck = [];

  const belongsToBossTheme = (c) =>
    (themeId && c.themeId === themeId) || (themeName && c.themeName === themeName);
  const isGenericCard = (c) => !c.themeId && !c.themeName;

  // 1. 플레이어 보관함에서 보스 덱에 넣을 카드 고르기
  const userCards = (state.cardsCollection || []).filter(c => {
    if (c.id && c.id.startsWith('starter-spell-2')) return false;
    if (themeId) {
      // 테마 보스: 자기 카드군 + 범용만
      return belongsToBossTheme(c) || isGenericCard(c);
    }
    // 일반 보스: 기존 규칙 (속성 일치 / 어둠 / 고등급)
    return c.element === el || c.element === 'dark' || c.rarity === 'legendary' || c.rarity === 'epic';
  });

  if (userCards.length > 0) {
    // 테마 보스는 자기 카드군을 우선 채운다
    const themed = userCards.filter(belongsToBossTheme);
    const generic = userCards.filter(c => !belongsToBossTheme(c));
    const pool = themeId ? [...battleRng().shuffle(themed), ...battleRng().shuffle(generic)]
                         : battleRng().shuffle(userCards);
    bossDeck.push(...pool.slice(0, Math.min(6, pool.length)).map(c => ({ ...c, isUserCard: true })));
  }

  // 2. 보스 고유 파워 카드
  const powerCards = (BOSS_POWER_CARDS || []).filter(c => c.element === el || c.element === 'dark');
  const pool = powerCards.length > 0 ? powerCards : (BOSS_POWER_CARDS || []);
  bossDeck.push(...battleRng().shuffle(pool).slice(0, 4));

  // 3. 최소 8장 보충
  while (bossDeck.length < 8) {
    const randCard = (BOSS_POWER_CARDS && BOSS_POWER_CARDS.length > 0)
      ? battleRng().pick(BOSS_POWER_CARDS)
      : { id: `boss-atk-${battleRng().int(100000, 999999)}`, name: '심연의 참격', cardType: 'spell', skills: [{ damage: 16, description: '16 암흑 피해' }] };
    bossDeck.push({ ...randCard });
  }

  return battleRng().shuffle(bossDeck);
}

/**
 * 전투 시작.
 * @param opts.seed 난수 시드. 지정하면 전투가 그대로 재현된다.
 *                  P2P 대전에서는 양쪽이 같은 시드를 공유해 락스텝을 맞춘다.
 */
export function initBattle({ seed = null } = {}) {
  const usedSeed = seedBattleRng(seed);
  const bossTemplate = state.bossesList[state.currentBossIdx] || BOSS_DATA[0];
  state.currentBoss = {
    ...bossTemplate,
    currentHp: bossTemplate.maxHp,
    shield: bossTemplate.shield || 0,
    actionIdx: 0
  };

  state.turnCount = 1;
  // 🐛 보스 턴 도중에 전투를 리셋하면 isAnimating이 true로 남아 조작이 영구 잠겼다
  state.isAnimating = false;
  state.playerHp = PLAYER_BASE_HP;
  state.playerMaxHp = PLAYER_BASE_HP;
  state.playerMaxShield = 0;
  state.playerMaxMana = 1; // 💎 정통 TCG 룰: 1턴 1마나로 시작하여 턴당 +1씩 증가!
  state.playerMana = 1;
  isPlayerTurn = true;
  bossPhase = 1;
  state.playerMinions = [];
  
  // 보스 전용 전술 덱 & 손패 구축 (손패 4장으로 적극적 카드 전개!)
  state.bossDeck = buildBossTacticalDeck(state.currentBoss);
  state.bossHand = [state.bossDeck.shift(), state.bossDeck.shift(), state.bossDeck.shift(), state.bossDeck.shift()].filter(Boolean);
  state.bossLastCastCard = null;

  // 👾 보스 전장은 **비어서 시작한다.**
  //    🐛 예전에는 소환수 2기를 깔고 시작했다. 플레이어는 1마나뿐인 1턴에
  //       막을 것을 낼 수 없는데 그 2기가 곧바로 본체를 때려,
  //       아무것도 못 한 채 2턴에 죽었다.
  //       (측정: 턴1 보스 딜 59 = 콤보 16 + 소환수 3기 43 vs 플레이어 체력 50)
  //    보스는 콤보 스텝으로 매 턴 소환하므로 전장은 금방 채워진다 —
  //    시작 보드를 없애는 것은 **압박을 없애는 게 아니라 뒤로 미루는 것**이다.
  state.bossMinions = [];

  bossStatus = createStatusState();
  playerStatus = createStatusState();
  playerBuffs = createBuffs();
  bossBuffs = createBuffs();
  trapZones = { player: [], boss: [] };
  sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs, trapZones });
  // 💎 상대 마나도 플레이어처럼 1에서 시작해 턴 시작마다 자란다 (한 집: state.bossMana)
  state.bossMana = 1;
  state.bossMaxMana = 1;
  // 🎯 소환 위치 무장·효과 대상 선택도 전투 단위 상태다.
  //    🐛 수정: 여기서 지우지 않아 지난 전투에서 눌러 둔 자리가 새 전투의 첫 소환에
  //       그대로 적용됐다 — "지정 안 했는데 이상한 자리에 들어간다"의 원인 하나 (DECISIONS #93)
  if (isTargeting()) cancelTargeting(false);
  _pendingSummonSlot = null;
  _pendingPicked = null;

  const activeDeckCards = getActiveDeckCards();
  state.playerDeck = battleRng().shuffle(activeDeckCards);
  state.playerHand = [];
  
  // 첫 턴 4장 드로우
  for (let i = 0; i < 4; i++) {
    if (state.playerDeck.length > 0) {
      state.playerHand.push(state.playerDeck.pop());
    }
  }

  clearBattleLogs();
  addBattleLog(`<span class="text-amber-400 font-bold">⚔️ [${state.currentBoss.name}] 과의 결전이 시작되었습니다!</span>`);
  addBattleLog(`<span class="text-slate-400">출전 덱(${activeDeckCards.length}장)을 셔플하여 전장에 진입했습니다. <span class="text-slate-600">(seed: ${usedSeed})</span></span>`);
  
  const userCardCount = (state.bossDeck || []).filter(c => c.isUserCard).length + (state.bossHand || []).filter(c => c.isUserCard).length;
  if (userCardCount > 0) {
    addBattleLog(`<span class="text-purple-300 font-bold">🔮 보스가 플레이어의 마도서에서 ${userCardCount}장의 카드를 감지하여 자신의 덱에 편성했습니다!</span>`);
  }
  
  if (state.currentBoss.themeName) {
    addBattleLog(`<span class="text-amber-300 font-bold">⚜️ [테마 보스] 이 보스는 <b>[${escapeHtml(state.currentBoss.themeName)}]</b> 카드군 덱을 사용합니다!</span>`);
  }
  triggerLiveBossReaction('start');
  renderBattleUI();
  updateBossIntent();
}

export function drawCards(count = 1) {
  for (let i = 0; i < count; i++) {
    if (state.playerHand.length >= sides.player.maxHand) {
      addBattleLog(`<span class="text-red-400">손패가 가득 차 카드를 더 뽑을 수 없습니다! (최대 ${sides.player.maxHand}장)</span>`);
      break;
    }
    if (state.playerDeck.length === 0) {
      const activeDeckCards = getActiveDeckCards();
      if (activeDeckCards.length > 0) {
        state.playerDeck = battleRng().shuffle(activeDeckCards);
        addBattleLog(`<span class="text-purple-400">출전 덱(${activeDeckCards.length}장)을 다시 섞어 보충했습니다!</span>`);
      } else {
        addBattleLog(`<span class="text-red-400">덱이 비었습니다!</span>`);
        break;
      }
    }
    const card = state.playerDeck.pop();
    state.playerHand.push(card);
    audio.playDraw();
  }
}

export function renderBattleUI() {
  if (!state.currentBoss) return;

  const el = state.currentBoss.element || 'fire';
  const elCfg = ELEMENT_CONFIG[el] || ELEMENT_CONFIG.fire;

  // 보스 정보 갱신
  const bName = document.getElementById('boss-name');
  if (bName) bName.innerText = state.currentBoss.name;
  
  const bTitle = document.getElementById('boss-title');
  if (bTitle) {
    bTitle.innerText = state.currentBoss.title || '';
    bTitle.className = `text-xs font-bold ${elCfg.text}`;
  }

  const bImg = document.getElementById('boss-img');
  if (bImg) bImg.src = state.currentBoss.imageUrl;

  const bElemBadge = document.getElementById('boss-element-badge');
  if (bElemBadge) {
    bElemBadge.className = `absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-black border ${elCfg.badge}`;
    bElemBadge.innerHTML = `${elCfg.icon} ${elCfg.name.toUpperCase()}`;
  }

  const bGlow = document.getElementById('boss-glow');
  if (bGlow) {
    bGlow.className = `absolute -inset-1 rounded-2xl blur opacity-70 transition duration-500 shadow-xl ${elCfg.glow}`;
  }

  const bContainer = document.getElementById('boss-container');
  if (bContainer) {
    bContainer.className = `relative rounded-2xl bg-gradient-to-b ${elCfg.bg} border-2 ${elCfg.border} p-5 shadow-2xl overflow-hidden transition-all duration-300`;
  }

  const bHpText = document.getElementById('boss-hp-text');
  if (bHpText) bHpText.innerText = `${Math.max(0, state.currentBoss.currentHp)} / ${state.currentBoss.maxHp}`;
  
  const bHpBar = document.getElementById('boss-hp-bar');
  if (bHpBar) {
    const bossHpPct = Math.max(0, (state.currentBoss.currentHp / state.currentBoss.maxHp) * 100);
    bHpBar.style.width = `${bossHpPct}%`;
  }
  const bShield = document.getElementById('boss-shield-text');
  if (bShield) bShield.innerText = `${state.currentBoss.shield || 0}`;

  // 보스 손패 & 덱 수치 갱신
  const bHandCount = document.getElementById('boss-hand-count');
  if (bHandCount) bHandCount.innerText = state.bossHand ? state.bossHand.length : 0;

  const bDeckCount = document.getElementById('boss-deck-count');
  if (bDeckCount) bDeckCount.innerText = state.bossDeck ? state.bossDeck.length : 0;

  const bLastCast = document.getElementById('boss-last-cast');
  if (bLastCast) {
    if (state.bossLastCastCard) {
      const c = state.bossLastCastCard;
      bLastCast.innerHTML = `<span>최근 사용:</span> <span class="font-bold ${c.isUserCard ? 'text-cyan-300' : 'text-amber-300'}">[${c.name}]</span>`;
    } else {
      bLastCast.innerHTML = '';
    }
  }

  // 상대 손패는 **뒷면만** 그린다.
  // 🐛 예전에는 미니 카드로 이름·속성·타입을 전부 노출했다.
  //    상대 손패는 TCG의 대표적인 숨은 정보다 — PvE에서도 보여주면 안 된다.
  //    (장수는 공개 정보라 그대로 둔다)
  const bHandBacksEl = document.getElementById('boss-hand-backs');
  if (bHandBacksEl) {
    const n = Math.min((state.bossHand || []).length, 8);
    bHandBacksEl.innerHTML = Array.from({ length: n }, () =>
      `<span class="inline-block w-2.5 h-3.5 rounded-[2px] bg-gradient-to-b from-slate-700 to-slate-900 border border-slate-600 shadow-sm"></span>`
    ).join('');
  }

  // 보스 소환수 필드
  const bossMinionsContainer = document.getElementById('boss-minions-container');
  const bossMinionsField = document.getElementById('boss-minions-field');
  if (bossMinionsContainer && bossMinionsField) {
    bossMinionsContainer.classList.remove('hidden');
    bossMinionsField.innerHTML = '';
    if (state.bossMinions.length === 0) {
      bossMinionsField.innerHTML = `<span class="text-[10px] text-slate-500 italic py-1">${isPvpActive() ? "상대 전장이 비어 있습니다." : "보스 호위병이 없습니다."}</span>`;
    } else {
      state.bossMinions.forEach((bm, bmIdx) => {
        const bmEl = document.createElement('div');
        bmEl.className = 'relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-950/80 border border-red-500/70 text-xs shadow-md animate-card-draw transition';
        // 🎯 공격 대상 선택에 쓰인다 (targeting.js가 이 속성을 보고 표시를 입힌다)
        bmEl.setAttribute('data-target-key', `foe:${bmIdx}`);
        // 🐛 `stopPropagation`이 없어서 **소환수를 한 번 누르면 두 번 선택됐다.**
        //    상대 소환수 목록(#boss-minions-field)은 본체 클릭 영역
        //    (#boss-container) **안에** 있다. 그래서 클릭이 부모로 올라가
        //    소환수 + 본체가 함께 지정됐다.
        //    실측: "적 2체" 카드로 소환수 하나를 눌렀더니
        //          적0 30→20 **그리고** 보스 130→120, 선택 모드 즉시 종료.
        //    플레이어에게는 "하나만 고르고 끝난다"로 보인다.
        bmEl.onclick = (e) => {
          e.stopPropagation();
          if (isTargeting()) { hideCardDetail(); pickTarget(`foe:${bmIdx}`); }
        };
        bmEl.innerHTML = `
          <span class="text-base">${bm.icon || '👾'}</span>
          <div class="flex flex-col text-left">
            <span class="font-bold text-[11px] text-red-200 truncate max-w-[90px]">${bm.name}</span>
            <div class="flex items-center gap-2 text-[10px] font-black">
              <span class="text-red-400">⚔️${bm.attack}</span>
              <span class="text-emerald-400">❤️${bm.currentHp}/${bm.maxHp}</span>
              ${bm.defense ? `<span class="text-blue-400">🛡️${bm.defense}</span>` : ''}
            </div>
          </div>
        `;
        // 상대 전장 카드도 상세를 볼 수 있어야 판단이 선다
        // (필드에 나와 있는 카드는 이미 공개된 정보다 — 손패와 다르다)
        attachCardDetail(bmEl, bm);
        bossMinionsField.appendChild(bmEl);
      });
    }
  }

  // 카드군(Archetype) 전개 현황 배너
  // 스탯 버프가 아니라 "이 카드군 카드를 더 내면 연계가 터진다"는 정보를 보여준다.
  const synergyBanner = document.getElementById('player-synergy-banner');
  const synergyInfo = evaluateFieldSynergy(state.playerMinions);
  if (synergyBanner) {
    if (synergyInfo.synergies.length > 0) {
      synergyBanner.classList.remove('hidden');
      synergyBanner.innerHTML = `
        <div class="flex items-center gap-1.5 font-black text-amber-300">
          <span>⚜️</span>
          <span>카드군 전개 중:</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${synergyInfo.synergies.map(s => `
            <span onclick="window.showKeywordInfo && window.showKeywordInfo('${escapeJsString(s.themeName)}')" class="cursor-pointer hover:scale-105 transition px-2 py-0.5 rounded-lg bg-amber-950 border border-amber-400/80 text-[10.5px] font-bold text-amber-200 shadow flex items-center gap-1" title="클릭하여 [${escapeHtml(s.themeName)}] 카드군 연계 효과 보기">
              <span>${s.icon}</span>
              <span>${escapeHtml(s.themeName)}</span>
              <span class="text-amber-400 font-black">${s.count}장</span>
            </span>
          `).join('')}
        </div>
      `;
    } else {
      synergyBanner.classList.add('hidden');
    }
  }

  // 🪤 함정 구역 (내 것은 내용 공개, 보스 것은 뒷면)
  const trapBox = document.getElementById('player-trap-zone');
  if (trapBox) {
    const mine = renderTrapZone(trapZones.player, { revealed: true });
    const foe = renderTrapZone(trapZones.boss, { revealed: false });
    if (mine || foe) {
      trapBox.classList.remove('hidden');
      trapBox.innerHTML = `
        <span class="text-[10px] text-slate-400 font-bold">🪤 함정</span>
        ${mine ? `<span class="text-[10px] text-indigo-300">내:</span> ${mine}` : ''}
        ${foe ? `<span class="text-[10px] text-red-300 ml-1">보스:</span> ${foe}` : ''}
      `;
    } else {
      trapBox.classList.add('hidden');
    }
  }

  // 플레이어 소환수/건축물 전장
  const fieldContainer = document.getElementById('player-minions-field');
  if (fieldContainer) {
    fieldContainer.innerHTML = '';
    // 🎯 무장 위치의 **실효값**. 전장은 빈칸 없는 배열이라 length를 넘는 지정은
    //    playCard가 length로 눌러 맨 뒤에 붙인다 — 화면도 같은 값을 써야 배지가
    //    실제로 들어갈 자리에 뜬다. (무장해 둔 뒤 소환수가 죽어 인덱스가 줄면 생긴다)
    const armedAt = Number.isInteger(_pendingSummonSlot)
      ? Math.min(_pendingSummonSlot, state.playerMinions.length) : null;
    for (let slot = 0; slot < BATTLE_SLOTS; slot++) {
      const entity = state.playerMinions[slot];
      if (entity) {
        fieldContainer.appendChild(createMinionFieldElement(entity, slot, synergyInfo));
      } else {
        // 🎯 빈 칸 중 누를 수 있는 것은 **바로 다음 자리(length)** 하나뿐이다.
        //    🐛 수정: 예전엔 빈 칸 넷이 전부 눌렸고 "여기에 배치"까지 켜졌지만, 전장이
        //       빈칸 없는 배열이라 playCard는 length로 눌러 **맨 앞/맨 뒤**에 넣었다.
        //       (빈 전장에서 4번 칸을 누르면 배지는 4번, 실제는 1번) — 화면이 거짓 약속을
        //       한 것이다. 앞자리에 끼우는 길은 소환수 카드의 왼쪽 띠(그립)다 → DECISIONS #93
        const reachable = slot === state.playerMinions.length;
        const armed = reachable && armedAt === slot;
        const emptySlot = document.createElement('div');
        emptySlot.className = `h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-xs gap-1 transition ${
          armed ? 'border-amber-400 bg-amber-500/10 text-amber-300 ring-2 ring-amber-400/60 cursor-pointer'
          : reachable ? 'border-slate-700/60 bg-black/30 text-slate-500 hover:border-amber-500/60 hover:text-amber-400 cursor-pointer'
          : 'border-slate-800/60 bg-black/20 text-slate-700 cursor-default'}`;
        emptySlot.innerHTML = `<i data-lucide="${armed ? 'target' : reachable ? 'plus-circle' : 'minus'}" class="w-6 h-6 ${armed ? '' : 'opacity-40'}"></i>
          <span>${armed ? '여기에 배치' : reachable ? '다음 소환 자리' : `슬롯 ${slot + 1}`}</span>`;
        if (reachable) {
          emptySlot.title = '다음 소환수는 기본으로 여기(맨 뒤)에 놓입니다. 앞자리에 끼워 넣으려면 소환수 카드의 왼쪽 띠를 누르세요.';
          emptySlot.onclick = () => {
            _pendingSummonSlot = armed ? null : slot;
            renderBattleUI();
          };
        } else {
          emptySlot.title = '전장은 앞에서부터 차례로 채워집니다 — 이 칸을 직접 지정할 수는 없습니다.';
        }
        fieldContainer.appendChild(emptySlot);
      }
    }
  }

  // 플레이어 스탯
  const phpText = document.getElementById('player-hp-text');
  if (phpText) phpText.innerText = `${state.playerHp} / ${state.playerMaxHp}`;
  const phpBar = document.getElementById('player-hp-bar');
  if (phpBar) {
    const pPct = Math.max(0, (state.playerHp / state.playerMaxHp) * 100);
    phpBar.style.width = `${pPct}%`;
  }
  // 🩸 상태이상 뱃지 렌더링
  // index.html에 #boss-status-badges 컨테이너가 있었지만 채우는 코드가 없어 늘 비어 있었다.
  // 이제 화상/맹독/취약/감전이 실제로 동작하므로 남은 턴수를 보여준다.
  renderStatusBadges('boss-status-badges', bossStatus);
  renderStatusBadges('player-status-badges', playerStatus);

  const pShield = document.getElementById('player-shield-text');
  if (pShield) pShield.innerText = `${state.playerMaxShield || 0}`;
  const pMana = document.getElementById('player-mana-text');
  if (pMana) pMana.innerText = `${state.playerMana} / ${state.playerMaxMana}`;
  
  const manaGemsEl = document.getElementById('mana-gems');
  if (manaGemsEl) {
    manaGemsEl.innerHTML = '';
    for (let i = 0; i < state.playerMaxMana; i++) {
      const isAvailable = i < state.playerMana;
      const gem = document.createElement('span');
      gem.className = isAvailable ? 'text-cyan-400 text-xs font-black' : 'text-slate-600 text-xs';
      gem.innerText = isAvailable ? '💎' : '🔘';
      manaGemsEl.appendChild(gem);
    }
  }

  const turnEl = document.getElementById('turn-display') || document.getElementById('turn-count');
  if (turnEl) turnEl.innerText = `${state.turnCount}`;

  // 손패 렌더링
  const handContainer = document.getElementById('player-hand');
  if (handContainer) {
    handContainer.innerHTML = '';
    state.playerHand.forEach((card, idx) => {
      const cardEl = createCardElement(card, () => playCard(idx), true);
      if (card.cost > state.playerMana) {
        cardEl.classList.add('opacity-50', 'grayscale-[30%]');
      }
      handContainer.appendChild(cardEl);
    });
  }

  // 🎯 대상 선택 중이면 고를 수 있는 곳에 표시를 입힌다.
  //    렌더 **뒤에** 해야 한다 — DOM을 다시 그리면 클래스가 날아간다.
  decorateTargets();

  // 본체(보스/상대) 클릭 — 대상 선택 중일 때만 반응한다
  const faceEl = document.getElementById('boss-container');
  if (faceEl) {
    faceEl.onclick = () => {
      if (isTargeting()) { hideCardDetail(); pickTarget('face'); }
    };
  }

  // 내 본체 클릭 — "아군 본체" 대상(self-face)을 고를 때 쓴다.
  // 🐛 이 자리가 없어서 targetSide가 ally/any인 효과는 고를 대상이 화면에
  //    존재하지 않았다.
  const selfFaceEl = document.getElementById('player-face');
  if (selfFaceEl) {
    selfFaceEl.onclick = () => {
      if (isTargeting()) { hideCardDetail(); pickTarget('self-face'); }
    };
  }

  if (window.lucide) window.lucide.createIcons();
}

export function createMinionFieldElement(entity, slotIdx, synergyInfo = null) {
  const elCfg = ELEMENT_CONFIG[entity.element] || ELEMENT_CONFIG.fire;
  const isStructure = entity.cardType === 'structure';
  const div = document.createElement('div');
  
  const canAtk = !isStructure && entity.canAttack && isPlayerTurn && !entity.frozen;
  // 카드군은 스탯을 올리지 않는다 (오토체스식 종족 버프 없음).
  // 같은 카드군이 전개돼 있으면 테두리로만 표시해 연계 가능 상태임을 알린다.
  const inArchetypePlay = !!findSynergyForEntity(synergyInfo, entity);
  // 🏛️ 표시값도 오라를 반영한다. 안 하면 카드에 12라 적혀 있는데 15가 나간다.
  // 🏛️ 표시값도 오라를 반영한다. 안 하면 카드에 12라 적혀 있는데 15가 나간다.
  //    🐛 공격력만 반영하고 **방어력 오라는 빠져 있었다.** 실측에서
  //       "방어 6"이라 적힌 소환수가 12 공격을 4로 받았다(실제 방어 8) —
  //       오라가 동작하는데도 플레이어는 적용됐는지 알 수가 없었다.
  const auraAtk = auraAttackBonus(entity);
  const auraDef = auraDefenseBonus(entity);
  const displayAtk = entity.attack + auraAtk;
  const displayDef = (entity.defense || 0) + auraDef;
  // 오라로 올라간 값은 색을 바꿔 **왜 다른지** 보이게 한다
  const buffed = (has) => has ? 'text-emerald-300' : '';

  div.className = `relative h-36 rounded-xl p-2 bg-gradient-to-b ${isStructure ? 'from-amber-950/90 via-stone-900 to-black border-amber-600/70' : elCfg.bg + ' ' + elCfg.border} border-2 ${inArchetypePlay ? 'ring-1 ring-amber-500/60' : ''} ${canAtk ? 'border-amber-400 shadow-lg shadow-amber-500/40 cursor-pointer animate-pulse' : ''} flex flex-col justify-between overflow-hidden select-none transition hover:scale-105`;

  const typeIcon = isStructure ? '🏛️' : elCfg.icon;
  const typeTag = isStructure ? '<span class="text-[9px] text-amber-300 font-bold bg-amber-950/80 px-1 rounded">성물</span>' : '';
  // 💫 행동 봉쇄(기절·빙결)는 카드 전체를 덮어 즉시 알아볼 수 있게 한다.
  //    🐛 수정: 예전에는 `entity.frozen`만 봐서 **기절은 화면에 표시되지 않았다.**
  const blockSpec = entity.blockedBy ? STATUS_EFFECTS[entity.blockedBy] : (entity.frozen ? STATUS_EFFECTS.freeze : null);
  const frozenTag = blockSpec
    ? `<div class="absolute inset-0 bg-slate-900/70 flex items-center justify-center font-black ${blockSpec.color} text-xs z-20">${blockSpec.icon} ${blockSpec.name}됨</div>`
    : '';

  // 🔥 나머지 상태이상(화상·맹독·감전·취약)은 아이콘 띠로 보여준다.
  //    동작해도 화면에 없으면 플레이어는 왜 체력이 줄는지 알 수 없다.
  const statusList = describeStatuses(entity.statuses).filter(s => s.type !== entity.blockedBy);
  const statusTag = statusList.length
    ? `<div class="absolute top-6 right-1 flex flex-col items-end gap-0.5 z-20">${
        statusList.map(s => `<span class="text-[8px] font-black ${s.color} bg-black/80 px-1 rounded" title="${escapeHtml(s.label)}">${s.icon}${s.turns || ''}</span>`).join('')
      }</div>`
    : '';

  div.innerHTML = `
    ${frozenTag}${statusTag}
    <div class="flex items-center justify-between z-10 text-[11px] font-black">
      <span class="truncate text-slate-100 flex items-center gap-1">${typeTag} ${entity.name}</span>
      <span>${typeIcon}</span>
    </div>
    <div class="relative w-full h-16 rounded-lg overflow-hidden border border-slate-700 bg-black">
      <img src="${entity.imageUrl}" class="w-full h-full object-cover">
      ${canAtk ? '<div class="absolute inset-0 bg-amber-500/20 flex items-center justify-center font-black text-amber-300 text-xs shadow-inner">공격 가능!</div>' : ''}
      ${isStructure ? '<div class="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-amber-300 font-bold text-center">매 턴 패시브</div>' : ''}
    </div>
    <div class="flex items-center justify-between text-xs font-black px-1 z-10">
      ${isStructure
        ? '<span class="text-amber-400 flex items-center gap-0.5">🏛️ 성물</span>'
        : `<span class="flex items-center gap-0.5 ${auraAtk > 0 ? buffed(true) : 'text-red-400'}" title="${auraAtk > 0 ? `기본 ${entity.attack} + 건축물 오라 ${auraAtk}` : ''}">⚔️ ${displayAtk}${auraAtk > 0 ? `<span class="text-[8px]">+${auraAtk}</span>` : ''}</span>`}
      <span class="flex items-center gap-0.5 ${auraDef > 0 ? buffed(true) : 'text-blue-400'}" title="${auraDef > 0 ? `기본 ${entity.defense || 0} + 건축물 오라 ${auraDef}` : ''}">🛡️ ${displayDef}${auraDef > 0 ? `<span class="text-[8px]">+${auraDef}</span>` : ''}</span>
      <span class="text-emerald-400 flex items-center gap-0.5">❤️ ${entity.currentHp}/${entity.maxHp}</span>
    </div>
  `;

  // 🎯 🐛 **아군 소환수는 대상으로 고를 수가 없었다.**
  //    collectTargetKeys는 `ally:N` / `self-face` 키를 만들어 주는데
  //    그 키를 가진 DOM이 어디에도 없었다(`foe:N`과 `face`만 있었다).
  //    그래서 "아군 1체를 회복/강화" 카드를 내면 대상 선택 모드로 들어간 뒤
  //    **아무것도 누를 수 없어** Esc로 취소하는 수밖에 없었다.
  div.setAttribute('data-target-key', `ally:${slotIdx}`);

  // 대상 선택 중에는 공격보다 **지정**이 우선이다 (건축물·행동불가도 고를 수 있어야 한다)
  // ⚠️ stopPropagation 필수 — 대상 선택 영역이 겹쳐 있으면 한 번의 클릭이
  //    두 번 선택된다 (상대 소환수에서 실제로 그랬다).
  div.onclick = (e) => {
    e.stopPropagation();
    hideCardDetail();
    if (isTargeting()) { pickTarget(`ally:${slotIdx}`); return; }
    if (canAtk) attackWithMinion(slotIdx);
  };

  // 🎯 이 카드 **앞에** 끼워 넣기.
  //    빈 슬롯만으로는 뒤에 붙이는 것밖에 못 한다. 앞자리는 적의 공격을
  //    먼저 받는 자리라 "앞에 세우기"가 전술의 핵심이다.
  if (state.playerMinions.length < BATTLE_SLOTS) {
    const armed = _pendingSummonSlot === slotIdx;
    const grip = document.createElement('button');
    // 🐛 예전에는 폭 2.5px짜리 색 띠가 전부였다. 눌러도 **아무 일도 안 일어난 것처럼**
    //    보여서 "소환 위치 기능이 동작 안 한다"는 오해를 샀다 (배치는 정상이었다).
    //    무장 상태를 눈에 띄게 만든다: 띠를 넓히고 라벨과 테두리를 붙인다.
    grip.className = `absolute left-0 inset-y-0 z-30 rounded-l-xl transition flex items-center justify-center ${
      armed
        ? 'w-6 bg-amber-400 text-black font-black text-[9px] ring-2 ring-amber-300 shadow-lg'
        : 'w-2.5 bg-amber-400/0 hover:bg-amber-400/60 hover:w-4'}`;
    grip.innerHTML = armed ? '<span class="-rotate-90 whitespace-nowrap">여기</span>' : '';
    grip.title = armed
      ? `다음 소환수를 여기(${slotIdx + 1}번 앞)에 배치합니다 — 다시 누르면 해제`
      : `여기(앞)에 다음 소환수를 배치 — ${slotIdx + 1}번 자리`;
    grip.onclick = (e) => {
      e.stopPropagation();          // 공격 클릭과 섞이면 안 된다
      hideCardDetail();
      // 🐛 수정: 그립이 카드 왼쪽 10px를 덮고 있어, 대상 선택 중에 카드의 왼쪽 끝을
      //    누르면 대상 지정 대신 소환 위치가 무장됐다. 선택 중에는 카드와 같게 행동한다.
      if (isTargeting()) { pickTarget(`ally:${slotIdx}`); return; }
      _pendingSummonSlot = armed ? null : slotIdx;
      renderBattleUI();
    };
    div.appendChild(grip);
    // 무장된 카드 자체에도 테두리를 준다 — 띠만으로는 작은 화면에서 안 보인다
    if (armed) div.classList.add('ring-2', 'ring-amber-400');
  }

  // 슬롯이 작아 스킬 설명이 안 들어간다.
  // 마우스 올리기 / 길게 누르기로 상세를 띄운다 (클릭은 공격 그대로).
  attachCardDetail(div, entity);

  return div;
}


// ============================================================
// 🪤 함정 — 세트하고, 상대 행동에 반응해 발동한다
// ============================================================

/** 함정을 뒷면으로 세트한다 */
function setTrap(sideKey, card) {
  const zone = trapZones[sideKey];
  const check = canSetTrap(zone);
  if (!check.ok) {
    addBattleLog(`<span class="text-yellow-400">${escapeHtml(check.reason)}</span>`);
    return false;
  }
  zone.push(card);
  audio.playShield();
  addBattleLog(
    sideKey === 'player'
      ? `<span class="text-indigo-300 font-bold">🂠 [함정 세트] 카드를 뒷면으로 세트했습니다. (${zone.length}/${TRAP_ZONE_SIZE})</span>`
      : `<span class="text-red-300 font-bold">🂠 보스가 함정을 세트했습니다. (${zone.length}/${TRAP_ZONE_SIZE})</span>`
  );
  return true;
}

/**
 * 상대 진영의 함정을 검사해 조건이 맞으면 발동시킨다.
 *
 * @param actorKey 행동한 진영 ('player' | 'boss')
 * @param event    'playCard' | 'attack' | 'damaged' | 'shielded'
 * @param card     행동을 일으킨 카드 (있으면)
 */
function triggerTraps(actorKey, event, card = null) {
  const defenderKey = actorKey === 'player' ? 'boss' : 'player';
  const zone = trapZones[defenderKey];
  if (!zone || zone.length === 0) return;

  const defender = sides[defenderKey];
  const actor = sides[actorKey];

  checkTraps(zone, { event, card: card || {}, side: defender, foe: actor, game: state }, (trap) => {
    const owner = defenderKey === 'player' ? '내' : '보스';
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-indigo-950/90 border border-indigo-400 text-indigo-200 text-xs shadow-md my-1">
        <span class="font-black text-indigo-300">🪤 [${owner} 함정 발동] ${escapeHtml(trap.name)}</span>
        <span class="text-indigo-400/80"> — ${escapeHtml(describeTrap(trap))}</span>
      </div>
    `);
    audio.playCrit();

    // 🪤 함정이 터졌다는 사실 자체가 이벤트다 (foeTrapActivates가 여기 반응한다).
    //    ⚠️ 무한 연쇄를 막으려고 **한 단계만** 전파한다.
    //       함정이 함정을 부르고 그게 또 함정을 부르면 판이 멈춘다.
    if (!_trapChainGuard) {
      _trapChainGuard = true;
      try { triggerTraps(defenderKey, 'trapFired', trap); }
      finally { _trapChainGuard = false; }
    }

    // 함정 효과는 기존 스킬 어휘를 그대로 쓴다 — 새 엔진이 필요 없다
    const skill = (trap.skills && trap.skills[0]) || trap.skill;
    if (!skill) return;

    if (defenderKey === 'player') {
      applyPlayerSkillEffects(skill, { card: trap, game: viewFor(sides.player), helpers: helpersFor(sides.player) },
        { sourceLabel: '함정', allowAoe: true });
    } else {
      // 보스 함정 — 플레이어에게 역으로 적용
      if (skill.damage > 0) applyDirectDamageToPlayer(skill.damage, skill.pierceShield);
      if (skill.shield > 0) sides.boss.shield += skill.shield;
      if (skill.heal > 0) sides.boss.hp = Math.min(sides.boss.maxHp, sides.boss.hp + skill.heal);
      if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
        applyStatus(playerStatus, skill.statusEffect.type, skill.statusEffect.duration || 2, skill.statusEffect.value || 0);
      }
    }
  });
}

export function playCard(handIdx) {
  if (!isPlayerTurn || state.isAnimating) return;
  const me = sides.player;
  const card = me.hand[handIdx];
  if (!card) return;

  // 시전 조건 검사는 진영 공용 (마나·전장 슬롯·손패).
  // 나중에 PvP를 붙이면 상대 진영에도 같은 함수를 쓴다.
  const check = canPlayCard(me, card);
  if (!check.ok) {
    addBattleLog(`<span class="text-red-400">${escapeHtml(check.reason)}</span>`);
    return;
  }

  const cardType = card.cardType || 'unit';

  // 🎯 대상 지정이 필요한 효과면 먼저 고르게 한다.
  //    고르고 나서 _pendingPicked에 담아 다시 이 함수로 들어온다.
  //    (함정은 세트만 하므로 발동 시점에 판단한다 — 여기선 제외)
  const skill0 = (card.skills && card.skills[0]) || card.skill || null;
  if (cardType !== 'trap' && !_pendingPicked && skill0 && needsTargetPick(skill0)) {
    const spec = readTargetSpec(skill0);
    const keys = collectTargetKeys(state, spec);
    if (keys.length > 0) {
      const need = spec.scope === 'multi' ? spec.count : 1;
      const started = beginTargeting({
        kind: 'effect',
        valid: keys,
        need,
        hint: `[${card.name}] — ${describeTarget(skill0)} 선택`,
        onProgress: () => renderBattleUI(),
        onPick: (_first, all) => {
          _pendingPicked = all;
          playCard(handIdx);          // 대상을 들고 다시 진입
          _pendingPicked = null;
        },
        onCancel: () => renderBattleUI()
      });
      if (started) { renderBattleUI(); return; }
    }
  }
  const picked = _pendingPicked;

  // 🌐 PvP: 내가 낸 카드를 상대에게 알린다.
  //    락스텝이므로 "결과"가 아니라 "무슨 카드를 냈는지"를 보낸다.
  //    이미지가 붙은 채로 보내면 데이터 채널이 막히므로 반드시 슬림화한다.
  if (isPvpActive()) {
    sendPvpAction({
      kind: 'playCard',
      instanceId: card.instanceId || card.id,
      card: slimCardForWire(card),
      // 배치 위치도 보내야 상대 화면의 전열이 내 화면과 같아진다
      slot: Number.isInteger(_pendingSummonSlot) ? _pendingSummonSlot : null,
      // 고른 효과 대상까지 보내야 상대 화면에서 같은 대상이 맞는다
      picked: picked || null
    });
  }

  // 🪤 함정: 뒷면으로 세트만 한다. 효과는 조건이 맞을 때 자동 발동한다.
  if (cardType === 'trap') {
    if (!setTrap('player', card)) return;
    me.mana -= card.cost;
    me.hand.splice(handIdx, 1);
    renderBattleUI();
    return;
  }

  // 🪤 내가 소환수/주문을 내면 보스가 세트한 함정이 반응한다
  // (함정 세트 자체는 반응 대상이 아니다 — 위에서 이미 return)
  triggerTraps('player', 'playCard', card);

  // 1. 주문/마법 카드 (Spell): 필드를 차지하지 않고 즉발 발동 후 묘지로 소모
  if (cardType === 'spell') {
    me.mana -= card.cost;
    me.hand.splice(handIdx, 1);
    audio.playMagic();

    addBattleLog(`<span class="text-purple-400 font-bold">🔮 [주문 발동] ${card.name}!</span>`);
    
    // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
    triggerArchetypeCombo(card, viewFor(sides.player), helpersFor(sides.player));

    triggerSpellEffect(card, picked);

    if (playerBuffs.doubleCast) {
      playerBuffs.doubleCast = false;
      addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 주문이 2연속 발동합니다!</span>`);
      triggerSpellEffect(card, picked);
    }

    renderBattleUI();
    checkBattleStatus();
    return;
  }

  // 2. 소환수(Unit) or 건축물(Structure): 전장 슬롯 점유

  me.mana -= card.cost;
  me.hand.splice(handIdx, 1);
  audio.playSummon();

  const entity = {
    ...card,
    instanceId: card.instanceId || `${card.id}#field${state.playerMinions.length}`,
    maxHp: card.hp || 30,
    currentHp: card.hp || 30,
    defense: card.defense || 0,
    // 🗑️ 도발은 제거됐다 — 전장에 있는 것만으로 이미 벽이다 (DECISIONS #84)
    taunt: false,
    canAttack: false, // 소환 후유증
    // ⚠️ 이게 없으면 refreshMinions가 다음 턴에도 풀어주지 않는다 (영구 마비)
    summonedTurn: state.turnCount,
    frozen: false
  };

  // 🎯 배치 위치. **맨 앞(0번)이 적의 공격을 먼저 받는다** — 위치가 곧 전술이다.
  //    `_pendingSummonSlot`은 그립/다음 자리를 눌러 둔 경우에만 채워지고, **소환에만 소모된다.**
  //    (주문·함정·시전 반려로는 풀리지 않는다 — 무장은 화면에 늘 보이므로 숨은 상태가
  //     아니고, 반려됐다고 풀어 버리면 "지정했는데 뒤로 갔다"는 바로 그 놀람을 만든다.
  //     그냥 카드를 클릭하면 예전처럼 맨 뒤에 붙는다 — 매번 묻지 않는다)
  //    ⚠️ length로 누르는 것은 방어선이 아니라 **모델**이다: 전장은 빈칸 없는 배열이라
  //       length 너머의 자리는 존재하지 않는다. 화면도 같은 값을 쓴다(renderBattleUI의
  //       armedAt) → 배지가 뜬 자리 = 실제로 들어가는 자리. DECISIONS #93
  const at = Number.isInteger(_pendingSummonSlot)
    ? Math.max(0, Math.min(state.playerMinions.length, _pendingSummonSlot))
    : state.playerMinions.length;
  _pendingSummonSlot = null;
  me.minions.splice(at, 0, entity);

  if (cardType === 'structure') {
    addBattleLog(`<span class="text-amber-400 font-bold">🏛️ [건축물 건립] [${card.name}] 을(를) 전장에 구축했습니다! (내구도: ${entity.maxHp})</span>`);
  } else {
    addBattleLog(`<span class="text-cyan-400 font-bold">✨ [소환수 출진] [${card.name}] 을(를) 전장에 소환했습니다!</span>`);
  }

  // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
  triggerArchetypeCombo(card, viewFor(sides.player), helpersFor(sides.player));

  // 전투의 함성 (Battlecry) 발동
  triggerBattlecry(card, picked);
  
  if (playerBuffs.doubleCast) {
    playerBuffs.doubleCast = false;
    addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 전장의 함성이 2배로 발동합니다!</span>`);
    triggerBattlecry(card, picked);
  }

  renderBattleUI();
  checkBattleStatus();
}

// 카드 스킬 효과 적용.
// 이전에는 triggerSpellEffect / triggerBattlecry 두 함수가 약 95% 동일한 내용을
// 각각 50줄씩 들고 있었다(차이는 광역 처리 여부와 로그 문구뿐).
// 실제 구현은 skill-effects.js가 갖고, 여기서는 진입점만 유지한다.
export function triggerSpellEffect(card, picked = null) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;
  applyPlayerSkillEffects(skill, { card, game: viewFor(sides.player), helpers: helpersFor(sides.player) },
    { sourceLabel: '주문', allowAoe: true, picked });
}

export function triggerBattlecry(card, picked = null) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;
  applyPlayerSkillEffects(skill, { card, game: viewFor(sides.player), helpers: helpersFor(sides.player) },
    { sourceLabel: '전투의 함성', allowAoe: false, picked });
}

/**
 * 아군 소환수의 공격.
 *
 * 🎯 예전에는 늘 최전방을 자동으로 때렸다. 카드 설명은 "적 하나를 지정해"처럼
 *    읽히는데 실제로는 고를 수 없어 위화감이 컸다.
 *    이제 고를 수 있는 대상이 둘 이상이면 **대상 선택 모드**로 들어간다.
 *
 * 🗑️ 도발이 제거되면서 **상대 전장의 소환수는 전부 유효 대상**이 됐다.
 *    누구를 먼저 칠지는 온전히 플레이어의 판단이다 (DECISIONS #84).
 * 고를 여지가 없으면(대상 1개) 예전처럼 즉시 처리한다.
 */
export function attackWithMinion(slotIdx) {
  if (!isPlayerTurn || state.isAnimating) return;
  if (isTargeting()) { cancelTargeting(); return; }
  const entity = state.playerMinions[slotIdx];
  if (!entity || !entity.canAttack || entity.cardType === 'structure' || entity.frozen) return;

  const pickable = (state.bossMinions || []).filter(m => m && m.currentHp > 0);

  // 🏟️ 전장이 비어 있을 때만 본체를 노릴 수 있다 (directAttack은 예외).
  const keys = pickable.map(m => `foe:${state.bossMinions.indexOf(m)}`);
  if (canAttackFace(state.bossMinions, entity)) keys.push('face');

  if (keys.length > 1) {
    beginTargeting({
      kind: 'attack',
      valid: keys,
      hint: `[${entity.name}]의 공격 대상을 선택하세요`,
      onPick: (key) => resolveMinionAttack(slotIdx, key),
      onCancel: () => renderBattleUI()
    });
    renderBattleUI();
    return;
  }

  resolveMinionAttack(slotIdx, keys[0] || 'face');
}

/** 대상이 정해진 뒤의 실제 공격 처리 */
export function resolveMinionAttack(slotIdx, targetKey) {
  const entity = state.playerMinions[slotIdx];
  if (!entity || !entity.canAttack) return;

  // 🏟️ 전투 규칙은 **해결되는 지점**에서 강제한다. UI 목록은 편의일 뿐이다.
  //    (PvP 재생 경로도 이 함수를 지나므로 여기가 유일한 관문이다)
  //
  // 🗑️ 도발 리다이렉트는 제거됐다. 이제 상대 전장의 소환수는 전부 유효 대상이고,
  //    막는 것은 오직 "전장이 비어야 본체를 칠 수 있다"뿐이다 → DECISIONS #84
  if (targetKey === 'face' && !canAttackFace(state.bossMinions, entity)) {
    const redirect = selectFrontTarget(state.bossMinions);
    addBattleLog(`<span class="text-amber-300">🏟️ 상대 전장에 소환수가 있어 본체를 칠 수 없습니다 — [${escapeHtml(redirect.name)}]을(를) 먼저 처리하세요.</span>`);
    targetKey = `foe:${state.bossMinions.indexOf(redirect)}`;
  }

  entity.canAttack = false;
  audio.playSlash();

  // 🌐 PvP: 고른 **대상까지** 보내야 상대 화면에서 같은 결과가 나온다.
  //    대상을 빼면 상대는 자기 기준 최전방을 때려 판이 어긋난다.
  if (isPvpActive()) sendPvpAction({ kind: 'attack', slotIdx, targetKey });

  // 🪤 공격에 반응하는 함정
  triggerTraps('player', 'attack', entity);

  // 🏛️ 전장 오라 보정 — 읽는 시점에 계산한다 (저장하면 건축물이 죽어도 남는다)
  const finalAtk = entity.attack + auraAttackBonus(entity);

  if (targetKey === 'face') {
    dealDamageToBoss(finalAtk, entity.name);
  } else {
    const idx = parseInt(String(targetKey).split(':')[1], 10);
    // 고른 뒤 함정 등으로 판이 바뀌었을 수 있다 — 없으면 규칙대로 최전방
    const target = (state.bossMinions || [])[idx] || selectFrontTarget(state.bossMinions);
    if (!target) {
      dealDamageToBoss(finalAtk, entity.name);
    } else {
      const hit = damageEntity(target, finalAtk);
      const { died, dealt } = hit;
      addBattleLog(`<span class="text-amber-300">⚔️ [${escapeHtml(entity.name)}] ➔ [${escapeHtml(target.name)}] 타격! (${dealt} 피해)${describeDamageExtras(hit)}</span>`);
      if (died) {
        addBattleLog(`<span class="text-red-400 font-bold">💥 [${escapeHtml(target.name)}] 처치!</span>`);
        state.bossMinions = removeDead(state.bossMinions);
      }
    }
  }

  renderBattleUI();
  checkBattleStatus();
}

/**
 * 상대 진영 하수인 한 기의 공격.
 *
 * PvE에서는 보스 턴에 전 하수인이 이걸 순서대로 부르고,
 * PvP에서는 상대의 `attack` 행동 하나를 재생할 때 부른다.
 * (예전에는 executeBossTurn 안에 forEach로 박혀 있어 한 기만 따로 부를 수 없었다)
 *
 * @param slotIdx  상대 전장 슬롯 번호
 * @param minion   이미 알고 있으면 전달 (없으면 슬롯에서 찾는다)
 */
export function foeMinionAttack(slotIdx, minion = null, targetKey = null) {
  const bm = minion || (state.bossMinions || [])[slotIdx];
  if (!bm) return;
  if (state.playerHp <= 0) return;
  // 🏛️ 건축물은 공격하지 않는다 — 플레이어 쪽과 같은 규칙(attackWithMinion).
  //    벽으로서 전장을 막는 것이 건축물의 역할이다.
  if (bm.cardType === 'structure' || !(bm.attack > 0)) return;

  // 💫 기절/빙결이면 이번 턴 공격하지 못한다.
  //    🐛 수정: 예전에는 상대 소환수에 기절을 걸어도 그대로 공격해 왔다.
  //    ⚠️ 소모는 tickMinionStatuses가 턴 시작에 한 번만 한다. 여기서 또
  //       소모하면 기절이 절반 턴만 유지된다 — **플래그만 읽는다.**
  if (bm.blockedBy) {
    const spec = STATUS_EFFECTS[bm.blockedBy];
    addBattleLog(`<span class="${spec ? spec.color : 'text-slate-400'} font-bold">${spec ? spec.icon : '💫'} [${escapeHtml(bm.name)}]이(가) ${spec ? spec.name : '행동 불가'} 상태로 공격하지 못합니다!</span>`);
    return;
  }

  // 🐛 상대 공격이 내 함정을 발동시키지 않고 있었다.
  //    `attack` 이벤트를 플레이어 공격에서만 쏘고 있어서
  //    "상대가 공격할 때" 함정이 PvE에서 영영 터지지 않았다.
  triggerTraps('boss', 'attack', bm);
  if (state.playerHp <= 0) return;   // 함정이 판을 끝냈을 수 있다

  // 🌐 PvP: 상대가 고른 대상을 그대로 재생한다.
  //    상대 화면 기준의 `foe:N`은 내 화면에서는 **내 전장의 N번**이다.
  // 🏟️ 내 전장에 소환수가 있으면 상대도 본체를 칠 수 없다.
  //    🐛 PvP 재생 경로는 `face`를 그대로 실행했다 — 상대가 내 전장을 무시하고
  //       본체를 때릴 수 있었다. 규칙은 해결 지점에서 양쪽 모두에 강제한다.
  if (targetKey === 'face' && !canAttackFace(state.playerMinions, bm)) {
    targetKey = null;   // 아래 최전방 타격 경로로 떨어뜨린다
  }

  if (targetKey === 'face') {
    // 🐛 예전에는 state.playerHp를 직접 깎아 **방어막·피해 경감·취약을 전부 우회**했다.
    //    본체가 맞는 경로는 반드시 applyDirectDamageToPlayer 하나로 모은다.
    addBattleLog(`<span class="text-red-400">🗡️ [${escapeHtml(bm.name)}] 본체 직격!</span>`);
    applyDirectDamageToPlayer(bm.attack, false);
    return;
  }
  if (targetKey && targetKey.startsWith('foe:')) {
    const i = parseInt(targetKey.split(':')[1], 10);
    // 🗑️ 도발이 사라져 상대가 내 전장의 누구를 고르든 그대로 맞는다.
    //    (막는 규칙은 "내 전장이 비어야 본체를 칠 수 있다" 하나뿐이다)
    const t = state.playerMinions[i];
    if (t) {
      hitPlayerMinion(t, bm, state.playerMinions.indexOf(t));
      return;
    }
  }

  // 아군 소환수/건축물이 있으면 최전방 타겟 타격 (PvE 기본 동작)
  if (state.playerMinions.length > 0) {
    // 🎯 맨 앞이 먼저 맞는다 — 그래서 배치 순서가 전술이 된다.
    const target = selectFrontTarget(state.playerMinions);
    hitPlayerMinion(target, bm, state.playerMinions.indexOf(target));
  } else {
    // 🐛 여기도 마찬가지로 직접 차감이었다. 무적만 보고 방어막·경감은 무시했다.
    addBattleLog(`<span class="text-red-400">🗡️ [${escapeHtml(bm.name)}] 본체 직격!</span>`);
    applyDirectDamageToPlayer(bm.attack, false);
  }
}

export function dealDamageToBoss(dmg, sourceName) {
  if (!state.currentBoss) return;
  let remainingDmg = Math.max(0, Math.floor(dmg));

  // 취약 배율 (status-effects가 단일 소스 — 이제 턴마다 정상 감쇠된다)
  const mult = getIncomingDamageMultiplier(bossStatus);
  if (mult !== 1) {
    remainingDmg = Math.floor(remainingDmg * mult);
    addBattleLog(`<span class="text-purple-300">💥 [취약] 보스가 받는 피해가 증폭되었습니다! (x${mult})</span>`);
  }

  // ⚡ 감전: 보스가 피격될 때마다 추가 연쇄 피해
  const shockBonus = getOnHitBonusDamage(bossStatus);
  if (shockBonus > 0) {
    remainingDmg += shockBonus;
    addBattleLog(`<span class="text-amber-300">⚡ [감전 연쇄] 보스에게 추가 번개 피해 +${shockBonus}!</span>`);
  }

  // 🎯 실드 관통 버프를 보유 중이면 이번 타격은 보스 방어막을 무시한다
  // 🐛 수정: 카드군 콤보가 playerBuffs.pierceShield를 세팅했지만 읽는 곳이 없어 죽은 버프였다.
  const piercing = !!playerBuffs.pierceShield;
  if (piercing) {
    playerBuffs.pierceShield = false;
    addBattleLog(`<span class="text-purple-400 font-bold">🎯 [실드 관통] 보스의 방어막을 무시하고 직격합니다!</span>`);
  }

  if (!piercing && state.currentBoss.shield > 0) {
    const absorbed = Math.min(state.currentBoss.shield, remainingDmg);
    state.currentBoss.shield -= absorbed;
    remainingDmg -= absorbed;
    if (state.currentBoss.shield === 0) {
      addBattleLog(`<span class="text-slate-300">🛡️ 보스의 방어막이 ${absorbed} 피해를 흡수하고 파괴되었습니다!</span>`);
    } else {
      addBattleLog(`<span class="text-slate-300">🛡️ 보스의 방어막이 ${absorbed} 피해를 흡수했습니다. (잔여 ${state.currentBoss.shield})</span>`);
    }
  }

  if (remainingDmg > 0) {
    state.currentBoss.currentHp -= remainingDmg;
    addBattleLog(`<span class="text-red-400 font-bold">💥 [${sourceName}] 보스에게 ${remainingDmg} 직접 피해!</span>`);

    const bossCard = document.getElementById('boss-card');
    if (bossCard) {
      bossCard.classList.add('animate-shake');
      setTimeout(() => bossCard.classList.remove('animate-shake'), 400);
    }

    // 🌵 불멸의 요새 / 가시 결계 피해 반사
    if (state.currentBoss.thorns > 0) {
      const reflectDmg = Math.max(1, Math.floor(remainingDmg * state.currentBoss.thorns));
      applyDirectDamageToPlayer(reflectDmg);
      addBattleLog(`<span class="text-emerald-400 font-bold">🌵 [가시 반사] 보스의 결계가 ${reflectDmg} 피해를 플레이어에게 반사했습니다!</span>`);
    }
  }

  // 2페이즈 광폭화 체크 (40% 이하)
  if (bossPhase === 1 && state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.4) {
    bossPhase = 2;
    addBattleLog(`<span class="text-red-500 font-black text-sm">🔥 [광폭화] 보스가 격노하여 모든 콤보 패턴의 위력이 폭증합니다!</span>`);
    triggerLiveBossReaction('lowHp');
  }
}

export function playerEndTurn() {
  if (!isPlayerTurn || state.isAnimating) return;
  isPlayerTurn = false;
  addBattleLog(`<span class="text-slate-400">--- 플레이어 턴 종료 ---</span>`);

  // 턴 종료 시 건축물 패시브 발동
  triggerStructureEndTurnPassives();

  renderBattleUI();

  // 🌐 PvP: 상대가 다음 턴을 진행한다. 스크립트 AI를 돌리면 안 된다.
  //    상대의 endTurn 메시지가 오면 startPlayerTurn()이 호출된다.
  if (isPvpActive()) {
    endMyPvpTurn();
    addBattleLog(`<span class="text-cyan-300">⏳ ${escapeHtml(getFoeName())}의 턴을 기다리는 중...</span>`);
    return;
  }

  setTimeout(() => executeBossTurn(), 250);
}

// ============================================================
// 🏛️ 전장 오라 — "이 건축물이 전장에 있는 동안"
// ------------------------------------------------------------
// 매 턴 누적형과 달리 **쌓이지 않는다.** 매번 살아 있는 건축물을 훑어
// 그때그때 계산하므로, 건축물이 부서지면 보너스도 즉시 사라진다.
//
// ⚠️ 절대 entity.attack에 값을 더해 저장하지 마세요.
//    저장하면 건축물이 죽어도 보너스가 남고, 오라 두 장을 깔았다 하나가
//    부서지면 어느 쪽 몫인지 알 수 없게 됩니다. 항상 읽는 시점에 계산합니다.
// ============================================================

/** 지금 살아 있는 아군 건축물의 오라 목록 */
function collectPlayerAuras() {
  const out = [];
  (state.playerMinions || []).forEach(e => {
    if (!e || e.cardType !== 'structure' || e.currentHp <= 0) return;
    const p = e.skills && e.skills[0] && e.skills[0].passiveEffect;
    if (p && p.aura) out.push({ src: e, ...p.aura });
  });
  return out;
}

/** 이 오라가 대상 엔티티에게 적용되는가 */
function auraApplies(aura, entity) {
  if (!entity) return false;
  switch (aura.scope) {
    case 'archetype':
      // 발동원 건축물과 **같은 카드군**일 때만
      return !!(entity.themeId && aura.src && entity.themeId === aura.src.themeId);
    case 'element':
      // scopeValue가 비어 있으면 발동원 건축물의 속성을 기준으로 삼는다
      return entity.element === (aura.scopeValue || (aura.src && aura.src.element));
    case 'cardType':
      return entity.cardType === (aura.scopeValue || 'unit');
    default:
      return true;   // 'all'
  }
}

/** 아군 소환수가 오라로 얻는 공격력 보정 */
export function auraAttackBonus(entity) {
  return collectPlayerAuras()
    .filter(a => a.attackBonus > 0 && auraApplies(a, entity))
    .reduce((s, a) => s + a.attackBonus, 0);
}

/** 아군 소환수가 오라로 얻는 방어력 보정 */
export function auraDefenseBonus(entity) {
  return collectPlayerAuras()
    .filter(a => a.defenseBonus > 0 && auraApplies(a, entity))
    .reduce((s, a) => s + a.defenseBonus, 0);
}

/**
 * 본체가 오라로 얻는 피해 경감 (%).
 * 여러 장이 겹치면 합산하되 **75%를 넘지 않는다** — 무적이 되면 게임이 끝난다.
 */
export function auraDamageReduction() {
  const sum = collectPlayerAuras()
    .filter(a => a.damageReduction > 0)
    .reduce((s, a) => s + a.damageReduction, 0);
  return Math.min(75, sum);
}

/** 오라 정보를 UI/카드 상세에 보여주기 위한 요약 */
export function describeActiveAuras() {
  return collectPlayerAuras().map(a => ({
    from: a.src.name,
    scope: a.scope,
    attackBonus: a.attackBonus || 0,
    defenseBonus: a.defenseBonus || 0,
    damageReduction: a.damageReduction || 0
  }));
}

/**
 * 상대 소환수가 **내 소환수를** 때린다.
 *
 * 🐛 수정: 예전에는 `t.currentHp -= bm.attack`로 직접 깎았다. 그래서
 *    내 소환수가 방어할 때는 **수비력이 아무 일도 하지 않았다.**
 *    (내가 공격할 때는 damageEntity가 수비력을 적용했으니 비대칭이었다)
 *    이제 양방향 모두 damageEntity를 지나고, 건축물 오라 방어력도 함께 붙는다.
 */
function hitPlayerMinion(target, attacker, idx) {
  if (!target) return;
  const defBonus = auraDefenseBonus(target);
  const hit = damageEntity(target, attacker.attack, { defBonus });
  const { died, dealt } = hit;
  addBattleLog(`<span class="text-slate-400">🗡️ [${escapeHtml(attacker.name)}] ➔ [${escapeHtml(target.name)}] 공격! (-${dealt} HP)${describeDamageExtras(hit)}</span>`);
  if (died) {
    addBattleLog(`<span class="text-red-500">💀 [${escapeHtml(target.name)}] 파괴!</span>`);
    state.playerMinions.splice(idx, 1);
  }
}

// ============================================================
// 💫 소환수 상태이상 처리 — 한 진영의 턴이 시작될 때 한 번
// ------------------------------------------------------------
// 🐛 예전에는 소환수 상태이상이 **등록만 되고 아무 일도 하지 않았다.**
//    - 기절(stun): entity.statuses에 들어가는데 읽는 쪽이 `entity.frozen`뿐이라
//      빙결만 동작하고 기절은 완전 무효과였다
//    - 화상/맹독: 소환수에 걸어도 지속 피해를 틱하는 곳이 없었다
//    - 감쇠도 없어 한 번 걸리면 영구히 남았다
//
// ⚠️ 소모(consume)는 **여기 한 곳에서만** 한다. combat-side의 refreshMinions는
//    `m.blockedBy` 결과만 읽는다. 두 곳에서 소모하면 이중 차감이 된다.
// ============================================================
export function tickMinionStatuses(minions, label = '아군') {
  if (!Array.isArray(minions)) return;
  // 역순 순회 — 지속 피해로 죽은 소환수를 제거하면서 인덱스가 밀리지 않는다
  for (let i = minions.length - 1; i >= 0; i--) {
    const m = minions[i];
    if (!m) continue;
    m.blockedBy = null;
    if (!m.statuses) continue;

    // 1) 지속 피해 (화상·맹독). 화상은 방어막을 무시하지만 소환수에는 방어막이 없으므로
    //    수비력만 적용 대상이다 — 지속 피해는 수비력도 무시한다 (독은 갑옷을 뚫는다).
    for (const tick of collectDamageOverTime(m.statuses)) {
      m.currentHp -= tick.damage;
      addBattleLog(`<span class="${tick.spec.color}">${tick.spec.icon} [${escapeHtml(m.name)}] ${tick.spec.name} 피해 -${tick.damage}</span>`);
    }
    if (m.currentHp <= 0) {
      addBattleLog(`<span class="text-red-500">💀 [${escapeHtml(m.name)}] 상태이상으로 파괴!</span>`);
      minions.splice(i, 1);
      continue;
    }

    // 2) 행동 봉쇄 (기절·빙결) — 걸려 있으면 1턴 소모하고 이번 턴 행동 불가
    const blocked = consumeBlockingStatus(m.statuses);
    if (blocked) {
      m.blockedBy = blocked.type;
      addBattleLog(`<span class="${blocked.spec.color} font-bold">${blocked.spec.icon} [${escapeHtml(m.name)}]이(가) ${blocked.spec.name} 상태로 이번 턴 행동하지 못합니다!</span>`);
    } else {
      // ⚠️ 봉쇄를 소모한 턴에는 감쇠를 **또** 하지 않는다
      decayStatuses(m.statuses);
    }
  }
}

/**
 * 상태이상을 **본체에 걸려고 할 때** 통과시키는 관문.
 *
 * `entityOnly` 상태이상(기절·빙결·화상·맹독)은 본체에 걸리지 않는다.
 * 대신 그 진영의 **최전방 소환수**로 돌린다. 소환수가 없으면 불발한다.
 *
 * 왜: 본체 체력이 낮은데 행동 봉쇄와 지속 피해는 대응할 여지가 없다.
 *     이 계열은 보드 컨트롤 수단으로 못박는다. → status-effects.js 주석
 *
 * @param allowBody 카드가 **더 큰 파워 비용을 내고** 본체 지정을 산 경우 true.
 *                  (config.js의 bodyStatus / BODY_STATUS_COST_MULT)
 */
function applyStatusRespectingScope(statuses, minions, sideLabel, type, turns, value, allowBody = false) {
  if (!isEntityOnly(type) || allowBody) {
    return applyStatus(statuses, type, turns, value);
  }
  const spec = STATUS_EFFECTS[type];
  const target = (minions || []).find(m => m && m.currentHp > 0);
  if (!target) {
    addBattleLog(`<span class="text-slate-500">${spec.icon} ${spec.name}은(는) 소환수 전용입니다 — ${sideLabel} 전장이 비어 불발.</span>`);
    return null;
  }
  if (!target.statuses) target.statuses = {};
  const applied = applyStatus(target.statuses, type, turns, value);
  if (type === 'freeze') target.frozen = true;
  addBattleLog(`<span class="${spec.color}">${spec.icon} [${escapeHtml(target.name)}]에게 ${spec.name} ${turns}턴 부여!</span>`);
  return applied;
}

export function triggerStructureEndTurnPassives() {
  state.playerMinions.forEach(entity => {
    if (entity.cardType === 'structure' && entity.skills && entity.skills[0] && entity.skills[0].passiveEffect) {
      const p = entity.skills[0].passiveEffect;
      if (p.endTurnShield) {
        state.playerMaxShield += p.endTurnShield;
        addBattleLog(`<span class="text-blue-300">🏛️ [${entity.name}] 패시브: 방어막 +${p.endTurnShield} 충전!</span>`);
      }
      if (p.endTurnAoeShield) {
        state.playerMaxShield += p.endTurnAoeShield;
        entity.currentHp = Math.min(entity.maxHp, entity.currentHp + (p.endTurnAoeHeal || 5));
        addBattleLog(`<span class="text-blue-300">🏛️ [${entity.name}] 성벽 가호: 방어막 +${p.endTurnAoeShield} & 내구도 수리!</span>`);
      }
      if (p.endTurnAoeHeal) {
        state.playerHp = Math.min(state.playerMaxHp, state.playerHp + p.endTurnAoeHeal);
        addBattleLog(`<span class="text-emerald-300">💖 [${entity.name}] 생명력 회복: 플레이어 +${p.endTurnAoeHeal} HP</span>`);
      }
    }
  });
}

export function triggerStructureStartTurnPassives() {
  state.playerMinions.forEach(entity => {
    if (entity.cardType === 'structure' && entity.skills && entity.skills[0] && entity.skills[0].passiveEffect) {
      const p = entity.skills[0].passiveEffect;
      if (p.manaPerTurn) {
        state.playerMana = Math.min(10, state.playerMana + p.manaPerTurn);
        addBattleLog(`<span class="text-blue-400 font-bold">💎 [${entity.name}] 마나 수정탑: 추가 마나 +${p.manaPerTurn} 공급!</span>`);
      }
    }
  });
}

// 👹 보스 멀티 액션 콤보 턴 실행기
export async function executeBossTurn() {
  state.isAnimating = true;
  addBattleLog(`<span class="text-red-400 font-bold">👹 [${state.currentBoss.name}] 의 다단계 콤보 턴!</span>`);

  // 💫 상대 소환수 상태이상 처리. 봉쇄를 소모하고 `blockedBy`를 세운다.
  tickMinionStatuses(state.bossMinions, '상대');

  // 👾 지난 턴에 소환된 소환수를 행동 가능으로 풀어준다 (소환 후유증 해제).
  //    ⚠️ **콤보 실행보다 앞에** 와야 한다. 뒤에 두면 이번 턴에 소환된
  //       소환수까지 풀려서 소환 후유증이 무효가 된다.
  refreshMinions(sides[SIDE_BOSS]);

  // 1. 보스 지속 피해(화상/맹독) 적용
  // 🐛 수정: 예전에는 burn/poison을 보스에게 걸어도 읽는 쪽이 없어 완전히 무효과였다.
  applyDamageOverTime(bossStatus, {
    label: '보스',
    onDamage: (dmg) => {
      // 화상/맹독은 방어막을 무시하고 체력에 직접 들어간다
      state.currentBoss.currentHp -= dmg;
    }
  });

  if (state.currentBoss.currentHp <= 0) {
    renderBattleUI();
    checkBattleStatus();
    state.isAnimating = false;
    return;
  }

  // 2. 행동 봉쇄 상태이상 (기절/빙결) — 걸려 있으면 1턴 소모하고 턴을 넘긴다
  const blocked = consumeBlockingStatus(bossStatus);
  if (blocked) {
    addBattleLog(`<span class="${blocked.spec.color} font-bold">${blocked.spec.icon} 보스가 ${blocked.spec.name} 상태로 이번 턴 행동하지 못합니다!</span>`);
    reportExpiredStatuses(decayStatuses(bossStatus), '보스');
    renderBattleUI();
    setTimeout(() => startPlayerTurn(), 250);
    return;
  }
  // 2. 🎴 보스 전술 카드 플레이 단계
  //
  // 💎 보스도 **마나를 쓴다.** 플레이어와 같은 성장 규칙(턴 수만큼, 상한 10).
  //    🐛 예전에는 마나가 없어서(가상 99) 매 턴 카드를 2~3장씩 몰아 냈다.
  //       플레이어가 1마나일 때 보스는 이미 전장을 채우고 있었다 —
  //       "보스 행동이 너무 많다"의 원인이 이것이다.
  //    이제 낼 수 있는 만큼만 낸다. 자원이 곧 제한이므로 램프의 카드 수 상한은
  //    보조 장치로만 남는다.
  const bossSide = sides[SIDE_BOSS];
  growMana(bossSide, state.turnCount);
  addBattleLog(`<span class="text-slate-400">💎 보스 마나 ${bossSide.mana}/${bossSide.maxMana}</span>`);

  const baseCardLimit = (bossPhase === 2 || state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.5) ? 3 : 2;
  // 🐌 초반 램프 — 플레이어가 1~2마나일 때 보스가 카드를 몰아 내지 않게 한다
  const rampNow = BOSS_RAMP[state.turnCount];
  const cardsToPlayLimit = rampNow ? Math.min(baseCardLimit, rampNow.cards) : baseCardLimit;

  for (let playCount = 0; playCount < cardsToPlayLimit; playCount++) {
    if (!state.bossHand || state.bossHand.length === 0 || state.playerHp <= 0 || state.currentBoss.currentHp <= 0) break;

    // 💎 낼 수 있는 카드만 후보가 된다 (마나 + 전장 슬롯 — 플레이어와 같은 검사)
    const affordable = state.bossHand
      .map((c, i) => ({ c, i }))
      .filter(x => canPlayCard(bossSide, x.c).ok);
    if (affordable.length === 0) {
      addBattleLog(`<span class="text-slate-500">💤 보스가 낼 수 있는 카드가 없습니다. (마나 ${bossSide.mana})</span>`);
      break;
    }

    // 우선순위: 체력 위기면 치유/방어 → 전장이 비었으면 소환 → 그 외 주문.
    // ⚠️ 어느 경우든 **후보 안에서만** 고른다. 예전에는 손패 전체에서 골라
    //    낼 수 없는 카드를 집기도 했다.
    const pickFrom = (pred) => affordable.find(x => pred(x.c));
    let chosen = null;
    if (state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.6) {
      chosen = pickFrom(c => c.skills && c.skills[0] && (c.skills[0].heal > 0 || c.skills[0].shield > 0));
    } else if (state.bossMinions.length < bossMinionCapThisTurn()) {
      chosen = pickFrom(c => c.cardType === 'unit' || c.cardType === 'structure');
    } else {
      chosen = pickFrom(c => c.cardType === 'spell');
    }
    // 우선순위에 맞는 게 없으면 **가장 비싼 것**부터 (마나를 놀리지 않는다)
    if (!chosen) chosen = affordable.slice().sort((a, b) => (b.c.cost || 0) - (a.c.cost || 0))[0];

    const cardToPlay = state.bossHand.splice(chosen.i, 1)[0];
    if (cardToPlay) {
      bossSide.mana -= (cardToPlay.cost || 0);
      await playBossCard(cardToPlay);
      renderBattleUI();
      await new Promise(r => setTimeout(r, 400));

      // 덱에서 새 카드 보충
      if (state.bossDeck && state.bossDeck.length > 0) {
        state.bossHand.push(state.bossDeck.shift());
      } else {
        state.bossDeck = buildBossTacticalDeck(state.currentBoss);
        if (state.bossDeck.length > 0) state.bossHand.push(state.bossDeck.shift());
      }
    }
  }

  // 3. 보스 멀티 액션 콤보 패턴 추출
  const combos = state.currentBoss.comboPatterns || [
    {
      name: '기본 연계',
      steps: [
        { type: 'summon_or_buff', name: '부하 소환/강화', value: 1 },
        { type: 'attack', name: '일반 강타', value: 16 }
      ]
    }
  ];

  const combo = combos[state.currentBoss.actionIdx % combos.length];
  state.currentBoss.actionIdx++;

  addBattleLog(`<span class="text-amber-400 font-bold">⚡ [보스 콤보 개시: ${combo.name}]</span>`);

  // 4. 콤보 스텝 순차 실행
  for (const step of combo.steps) {
    if (state.playerHp <= 0 || state.currentBoss.currentHp <= 0) break;

    await executeSingleBossStep(step);
    renderBattleUI();
  }

  // 4. 보스 부하들의 연계 합동 공격
  //    ⚠️ canAttack을 반드시 본다. 예전에는 검사가 없어서 **이번 턴에 소환된
  //       소환수까지 같은 턴에 공격**했다 (스텝1 소환 → 스텝4 공격).
  //       플레이어 소환수는 소환 후유증이 있으므로 그쪽만 불리한 비대칭이었다.
  if (state.playerHp > 0 && state.currentBoss.currentHp > 0) {
    state.bossMinions.forEach((bm, idx) => {
      if (bm && bm.canAttack === false) {
        addBattleLog(`<span class="text-slate-500">💤 [${escapeHtml(bm.name)}]은(는) 소환된 턴이라 공격하지 못합니다.</span>`);
        return;
      }
      foeMinionAttack(idx, bm);
    });
  }


  // 보스 턴 종료: 보스에게 걸린 상태이상 1턴 감쇠
  reportExpiredStatuses(decayStatuses(bossStatus), '보스');

  renderBattleUI();
  checkBattleStatus();

  if (state.playerHp > 0 && state.currentBoss.currentHp > 0) {
    setTimeout(() => startPlayerTurn(), 250);
  } else {
    state.isAnimating = false;
  }
}

// 🎴 보스 전술 카드 시전 처리기 (소환수 소환 및 주문 발동)
export async function playBossCard(card) {
  if (!card || state.playerHp <= 0 || state.currentBoss.currentHp <= 0) return;
  state.bossLastCastCard = card;
  const isUser = card.isUserCard;
  const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.dark;

  addBattleLog(`
    <div class="p-2 rounded-xl bg-gradient-to-r from-red-950/90 to-purple-950/90 border border-red-500/70 shadow-lg my-1.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-base">${elCfg.icon}</span>
        <div>
          <div class="text-[10px] text-amber-300 font-bold">${isUser ? '👤 플레이어 제작 카드 기용' : '👹 보스 고유 전술 카드'}</div>
          <div class="text-xs font-black text-white">${card.name}</div>
        </div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-black/60 text-slate-300 font-bold border border-slate-700">${card.cardType === 'unit' ? '⚔️ 소환수' : (card.cardType === 'structure' ? '🏛️ 성물' : '🔮 마법')}</span>
    </div>
  `);

  // 🎴 보스 카드군(Archetype) TCG 콤보 발동
  // 🪤 보스가 카드를 내면 플레이어가 세트한 함정이 반응한다
  triggerTraps('boss', 'playCard', card);

  triggerBossArchetypeCombo(card, state, makeBossComboHelpers());

  if (card.cardType === 'unit' || card.cardType === 'structure') {
    audio.playSummon();
    if (state.bossMinions.length < bossMinionCapThisTurn()) {
      // 🐛 `attack: Math.max(8, card.attack || 12)`이었다. 건축물은 공격력이 0인데
      //    바닥값 8이 그걸 덮어써서, 플레이어가 만든 **0공격 요새가 보스 손에서는
      //    12공격 소환수**가 됐다 (실전에서 아이기스 철옹성이 15공으로 때렸다).
      //    건축물은 공격하지 않는다 — 진영이 바뀌어도 마찬가지다.
      const isStructure = card.cardType === 'structure';
      const minion = {
        name: card.name,
        icon: isStructure ? '🏛️' : (elCfg.icon || '⚔️'),
        cardType: card.cardType || 'unit',
        attack: isStructure ? 0 : Math.max(8, card.attack || 12),
        defense: card.defense || 4,
        maxHp: Math.max(16, card.hp || 20),
        currentHp: Math.max(16, card.hp || 20),

        desc: card.skills && card.skills[0] ? card.skills[0].name : '소환수'
      };
      minion.canAttack = false;                  // 소환 후유증 — 플레이어 소환수와 같은 규칙
      minion.summonedTurn = state.turnCount;
      state.bossMinions.push(minion);
      addBattleLog(`<span class="text-purple-300 font-bold">👾 [보스 전장 소환] [${minion.name}] (공격력 ${minion.attack} / 체력 ${minion.maxHp}) 이(가) 전장에 배치되었습니다!</span>`);
    } else {
      state.bossMinions.forEach(bm => bm.attack += 2);
      addBattleLog(`<span class="text-red-400 font-bold">🔥 보스 부하들이 [${card.name}]의 기운으로 공격력 +2 강화되었습니다!</span>`);
    }
  } else {
    // 주문 발동
    audio.playMagic();
    const skill = card.skills && card.skills[0] ? card.skills[0] : { damage: 16, description: '16 마법 피해' };

    resolveBossSpell(card, skill);

    // ⚡ 과충전 — 보스도 플레이어와 같은 예약 버프를 쓴다.
    //    🐛 예전에는 보스의 doubleCast 연계가 "8 피해"라는 다른 효과였고
    //       bossBuffs.doubleCast는 PvP 경로에서만 읽혀 PvE에서는 죽은 값이었다.
    if (bossBuffs.doubleCast) {
      bossBuffs.doubleCast = false;
      addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 보스의 주문이 2연속 발동합니다!</span>`);
      resolveBossSpell(card, skill);
    }
  }
}

/**
 * 보스 주문 한 번의 해결. 과충전이면 두 번 불린다.
 * (전에는 playBossCard 안에 인라인이라 두 번 발동시킬 방법이 없었다)
 */
function resolveBossSpell(card, skill) {
  if (skill.damage && skill.damage > 0) {
    // 🐛 여기는 `skill.damage`만 읽고 **연타·치명타·처형·흡혈을 전부 무시**했다.
    //    보스 덱에는 플레이어가 만든 카드가 섞이는데(buildBossTacticalDeck),
    //    "3연타 총 54 피해"라고 적힌 카드가 보스 손에서는 18만 냈다.
    //    같은 카드가 진영에 따라 3배 약해지면 카드 텍스트가 거짓이 된다.
    //    순서는 applyPlayerSkillEffects와 같게 유지한다 — 안 그러면 또 갈라진다.
    let dmg = skill.damage;
    if (skill.multiHit > 1) dmg *= skill.multiHit;

    if (skill.critChance > 0 && battleRng().chance(skill.critChance)) {
      const mult = skill.critMultiplier || 1.8;
      dmg = Math.floor(dmg * mult);
      addBattleLog(`<span class="text-amber-300 font-bold">⚡ 보스의 치명타! 피해가 ${mult}배로 증폭됩니다. (${dmg})</span>`);
    }
    if (skill.executeThreshold > 0 && state.playerMaxHp > 0 &&
        state.playerHp <= state.playerMaxHp * skill.executeThreshold) {
      dmg = Math.floor(dmg * 2);
      addBattleLog(`<span class="text-red-400 font-black">💀 처형! 빈사 상태를 노려 피해가 2배가 됩니다. (${dmg})</span>`);
    }

    if (skill.isAoeSpell) {
      // 🐛 예전에는 `m.currentHp -= dmg`로 직접 깎아 **수비력·취약·감전을 전부
      //    무시**했다. 같은 주문이라도 단일 타격(strikeFrontLine → damageEntity)은
      //    수비력을 적용하는데 광역만 안 했다 — 같은 카드 안에서 규칙이 둘이었다.
      //    실전에서 22체력/8수비 건축물이 20 광역 한 방에 죽었고(정상이면 12),
      //    그래서 전장이 비어 보스 소환수가 본체를 직격했다. 벽이 버그로 무너졌다.
      //    플레이어의 광역은 이미 damageEntity를 지난다 — 비대칭이기도 했다.
      //    → CLAUDE.md 금지사항 29
      state.playerMinions.forEach(m => {
        const hit = damageEntity(m, dmg, { pierce: !!skill.pierceShield });
        addBattleLog(`<span class="text-yellow-400">💥 보스 광역 주문: [${escapeHtml(m.name)}] -${hit.dealt} HP${describeDamageExtras(hit)}</span>`);
      });
      state.playerMinions = removeDead(state.playerMinions);
      applyDirectDamageToPlayer(Math.floor(dmg * 0.7), skill.pierceShield);
    } else {
      const res = strikeFrontLine(state.playerMinions, dmg, {
        addBattleLog,
        pierceShield: skill.pierceShield,
        absorbLabel: '이(가) 보스 주문을 대신 피격!',
        onDirectHit: (d, pierce) => applyDirectDamageToPlayer(d, pierce)
      });
      state.playerMinions = res.minions;
    }

    // 🩸 흡혈 — 플레이어 경로에는 있는데 보스 경로에만 없었다
    if (skill.lifestealPercent > 0) {
      const healed = Math.floor(dmg * skill.lifestealPercent);
      if (healed > 0) {
        state.currentBoss.currentHp = Math.min(state.currentBoss.maxHp, state.currentBoss.currentHp + healed);
        addBattleLog(`<span class="text-rose-300 font-bold">🩸 보스가 흡혈로 체력 +${healed} 회복!</span>`);
      }
    }
  }

  if (skill.shield && skill.shield > 0) {
    state.currentBoss.shield = (state.currentBoss.shield || 0) + skill.shield;
    addBattleLog(`<span class="text-blue-400">🛡️ 보스가 [${card.name}] 으로 방어막 +${skill.shield} 전개!</span>`);
  }
  if (skill.heal && skill.heal > 0) {
    state.currentBoss.currentHp = Math.min(state.currentBoss.maxHp, state.currentBoss.currentHp + skill.heal);
    addBattleLog(`<span class="text-emerald-400">💖 보스가 [${card.name}] 으로 체력 +${skill.heal} 회복!</span>`);
  }
  if (skill.discardCard && state.playerHand.length > 0) {
    const discarded = discardRandom(sides.player, battleRng());
    addBattleLog(`<span class="text-purple-400 font-bold">🃏 [패 파괴] 보스의 [${card.name}] 으로 플레이어 손패 [${discarded.name}] 이(가) 파기되었습니다!</span>`);
  }

  // 🃏 드로우 — 없어서 **보스가 드로우 카드를 내면 아무 일도 일어나지 않았다.**
  //    실전에서 보스가 [욕망의 비전 연성](드로우2 + 마나1)을 냈는데 로그가 비었다.
  //    死카드는 함정에서 한 번 겪은 문제다 → DECISIONS #77
  if (skill.drawCards > 0 && Array.isArray(state.bossDeck) && Array.isArray(state.bossHand)) {
    let drawn = 0;
    for (let i = 0; i < skill.drawCards && state.bossHand.length < 5 && state.bossDeck.length > 0; i++) {
      state.bossHand.push(state.bossDeck.shift());
      drawn++;
    }
    if (drawn > 0) addBattleLog(`<span class="text-purple-300">🃏 보스가 [${escapeHtml(card.name)}]으로 카드 ${drawn}장을 뽑았습니다.</span>`);
  }
  // ⚠️ manaGain은 의도적으로 무시한다 — 보스는 마나를 쓰지 않는다(foeVirtualMana 99).

  // ⚔️ 약화 · 🚫 무효화 — 플레이어 소환수를 대상으로 한다.
  //    (플레이어 경로는 지정이 없으면 상대 전장 첫 대상을 쓴다. 거울로 맞춘다)
  const front = (state.playerMinions || []).find(m => m && m.currentHp > 0);
  if (skill.attackDown > 0 && front) {
    const before = front.attack || 0;
    front.attack = Math.max(0, before - skill.attackDown);
    addBattleLog(`<span class="text-orange-300">⚔️ [${escapeHtml(front.name)}] 공격력 ${before} → ${front.attack}</span>`);
  }
  if (skill.silence && front) {
    front.skills = [];
    front.silenced = true;
    front.taunt = false;
    addBattleLog(`<span class="text-purple-300 font-bold">🚫 [${escapeHtml(front.name)}]의 효과가 무효화되었습니다!</span>`);
  }
  if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
    const st = skill.statusEffect;
    // 💫 기절·빙결·화상·맹독은 **소환수 전용**이다. 관문이 최전방 소환수로
    //    돌리거나, 전장이 비었으면 불발시킨다.
    //    (예전에는 빙결만 소환수로 가고 나머지는 전부 플레이어 본체에 꽂혔다)
    const applied = applyStatusRespectingScope(
      playerStatus, state.playerMinions, '내', st.type, st.duration || 2, st.value || 0, !!skill.bodyStatus);
    if (applied && !isEntityOnly(st.type)) {
      const spec = STATUS_EFFECTS[st.type];
      addBattleLog(`<span class="${spec.color}">${spec.icon} [${escapeHtml(card.name)}] 효과로 플레이어에게 ${spec.name} 부여! (${applied.turns}턴 / 턴당 ${applied.value})</span>`);
    }
  }
}

async function executeSingleBossStep(step) {
  let val = step.value || 0;
  // 💥 콤보 딜 하향 — 이 스텝은 마나 제한을 받지 않는 유일한 딜이라
  //    카드 수를 조여도 체감이 안 바뀐다. 여기 한 곳에서 줄인다 (DECISIONS #87).
  //    ⚠️ 데이터의 원래 수치는 건드리지 않는다 — 보스 14개 패턴과
  //       연성으로 생성되는 패턴에 자동으로 적용된다.
  if ((step.type === 'attack' || step.type === 'magic') && val > 0) {
    val = Math.max(1, Math.round(val * BOSS_STEP_DAMAGE_MULT));
  }
  if (bossPhase === 2 && val > 0) val = Math.floor(val * 1.4);

  if (step.type === 'summon_or_buff') {
    const el = state.currentBoss.element || 'fire';
    const minionPool = (ELEMENT_BOSS_MINIONS && ELEMENT_BOSS_MINIONS[el]) ? ELEMENT_BOSS_MINIONS[el] : BOSS_ADD_POOL;
    if (state.bossMinions.length < bossMinionCapThisTurn()) {
      const randomAdd = battleRng().pick(minionPool);
      // 소환 후유증 — 이게 없어서 스텝1에 소환된 소환수가 같은 턴 스텝4에 때렸다
      state.bossMinions.push({ ...randomAdd, currentHp: randomAdd.maxHp, canAttack: false, summonedTurn: state.turnCount });
      audio.playSummon();
      addBattleLog(`<span class="text-purple-400 font-bold">👾 [스텝 1/소환] 보스가 [${randomAdd.name}] 을(를) 소환했습니다!</span>`);
    } else {
      state.bossMinions.forEach(bm => bm.attack += 3);
      addBattleLog(`<span class="text-red-400">🔥 [스텝 1/강화] 보스가 모든 부하의 공격력을 +3 강화했습니다!</span>`);
    }
  } else if (step.type === 'debuff') {
    // 🐛 수정: 이전에는 burn/poison/shock이 그 자리에서 HP만 깎고 사라져
    //          "3턴 지속 맹독" 같은 카드 설명과 실제 동작이 달랐다.
    //          이제 상태이상으로 등록되어 매 턴 시작 시 지속 피해가 들어간다.
    if (step.status && step.status.type) {
      const st = step.status;
      // 💫 소환수 전용 상태이상은 관문이 최전방 소환수로 돌린다.
      //    보스 콤보가 플레이어 본체를 맹독·화상으로 녹이던 것을 막는다.
      const applied = applyStatusRespectingScope(
        playerStatus, state.playerMinions, '내', st.type, st.duration || 2, st.value || 0);
      if (applied && !isEntityOnly(st.type)) {
        const spec = STATUS_EFFECTS[st.type];
        addBattleLog(`<span class="text-purple-400">${spec.icon} [스텝/${spec.name}] 플레이어가 ${spec.name} 상태가 되었습니다! (${applied.turns}턴${applied.value ? ` / 턴당 ${applied.value}` : ''})</span>`);
        // 감전은 즉발로 마나도 1 방전시킨다
        if (st.type === 'shock') state.playerMana = Math.max(0, state.playerMana - 1);
      }
    }
  } else if (step.type === 'heal') {
    state.currentBoss.currentHp = Math.min(state.currentBoss.maxHp, state.currentBoss.currentHp + val);
    audio.playMagic();
    addBattleLog(`<span class="text-emerald-400 font-bold">💖 [스텝/치유] 보스가 [${step.name}] 으로 체력 +${val} 자가 회복!</span>`);
  } else if (step.type === 'disrupt') {
    if (step.manaBurn) {
      state.playerMana = Math.max(0, state.playerMana - step.manaBurn);
      addBattleLog(`<span class="text-indigo-400">🌀 [스텝/방해] 보스가 플레이어의 마나 ${step.manaBurn}를 강탈했습니다!</span>`);
    }
    if (step.breakShield) {
      state.playerMaxShield = 0;
      addBattleLog(`<span class="text-red-400 font-bold">💔 [스텝/파쇄] 아군의 모든 방어막이 산산조각났습니다!</span>`);
    }
    if (step.discardCard && state.playerHand.length > 0) {
      const discarded = discardRandom(sides.player, battleRng());
      audio.playSlash();
      addBattleLog(`<span class="text-purple-400 font-black">🃏 [스텝/패 파괴] 보스의 사악한 주술로 손패 [${discarded.name}] 이(가) 파기되었습니다!</span>`);
    }
  } else if (step.type === 'shield') {
    state.currentBoss.shield = (state.currentBoss.shield || 0) + val;
    if (step.reflectPercent) {
      state.currentBoss.thorns = step.reflectPercent;
      addBattleLog(`<span class="text-emerald-300 font-bold">🌵 [가시 반사 결계] 보스가 받은 피해의 ${Math.round(step.reflectPercent * 100)}%를 반사합니다!</span>`);
    }
    audio.playShield();
    addBattleLog(`<span class="text-blue-400">🛡️ [스텝/방어] 보스가 [${step.name}] 으로 방어막 +${val} 전개!</span>`);
  } else if (step.type === 'magic' || step.type === 'attack') {
    audio.playCrit();
    
    let baseDmg = val;
    if (step.executeThreshold && state.playerHp <= state.playerMaxHp * step.executeThreshold) {
      baseDmg = Math.floor(baseDmg * 2.2);
      addBattleLog(`<span class="text-red-600 font-black">💀 [처형 발동] 플레이어 체력 위기로 보스의 공격력이 2.2배 증폭됩니다!</span>`);
    }

    const hits = step.multiHit || 1;
    for (let h = 0; h < hits; h++) {
      if (state.playerHp <= 0) break;
      const hitDmg = Math.max(1, Math.floor(baseDmg / hits));
      addBattleLog(`<span class="text-red-400 font-bold">💥 [스텝/타격 ${h + 1}/${hits}] ${step.name} (${hitDmg} 피해)</span>`);

      if (step.isAoe) {
        // 광역 공격: 모든 아군 및 플레이어 피격
        // 🐛 여기도 직접 차감이라 수비력을 무시했다 (위 resolveBossSpell과 같은 버그).
        //    32체력/14수비 건축물이 28 광역 한 방에 4까지 깎였다 — 정상이면 14.
        state.playerMinions.forEach(m => {
          const hit = damageEntity(m, hitDmg, { pierce: !!step.pierceShield });
          addBattleLog(`<span class="text-yellow-400">💥 광역 피해: [${escapeHtml(m.name)}] -${hit.dealt} HP${describeDamageExtras(hit)}</span>`);
        });
        state.playerMinions = removeDead(state.playerMinions);

        if (playerBuffs.invulnerable <= 0) {
          applyDirectDamageToPlayer(Math.floor(hitDmg * 0.7), step.pierceShield);
        }
      } else {
        // 단일 공격: 도발 건축물/소환수 우선 타격 (실드관통이 아닐 때)
        const res = strikeFrontLine(state.playerMinions, hitDmg, {
          addBattleLog,
          pierceShield: step.pierceShield,
          absorbLabel: '이(가) 보스의 공격을 대신 흡수했습니다!',
          onDirectHit: (d, pierce) => applyDirectDamageToPlayer(d, pierce)
        });
        state.playerMinions = res.minions;
      }

      if (step.lifesteal || step.lifestealPercent) {
        const healAmt = Math.floor(hitDmg * (step.lifestealPercent || 0.5));
        state.currentBoss.currentHp = Math.min(state.currentBoss.maxHp, state.currentBoss.currentHp + healAmt);
        addBattleLog(`<span class="text-purple-300">🩸 보스가 흡혈로 체력 +${healAmt} 회복!</span>`);
      }
    }
  }
}

function applyDirectDamageToPlayer(dmg, pierceShield = false) {
  if (playerBuffs.invulnerable > 0) {
    addBattleLog(`<span class="text-cyan-300 font-bold">🛡️ 무적 결계가 피해를 완전 무효화했습니다!</span>`);
    return;
  }

  let finalDmg = Math.max(0, Math.floor(dmg));

  // 🛡️ 피해 경감 — 취약 배율보다 **먼저** 적용한다.
  //    (경감 후 취약이 곱해지는 편이 "방어를 뚫고 약점을 노린다"는 감각에 맞다)
  //    ⚠️ 주문으로 건 일시적 경감(playerBuffs)과 건축물 오라를 **합산**한다.
  //       한쪽만 보면 오라를 깔아둔 게 무시된다.
  const auraCut = auraDamageReduction();
  const buffCut = (playerBuffs.damageReduction > 0 && playerBuffs.damageReductionTurns > 0)
    ? playerBuffs.damageReduction : 0;
  const totalCutPct = Math.min(75, buffCut + auraCut);
  if (totalCutPct > 0) {
    const cut = Math.floor(finalDmg * (totalCutPct / 100));
    if (cut > 0) {
      finalDmg -= cut;
      const src = auraCut > 0 && buffCut > 0 ? '주문+건축물' : (auraCut > 0 ? '건축물 오라' : '피해 경감');
      addBattleLog(`<span class="text-cyan-300">🛡️ [${src} ${totalCutPct}%] ${cut} 피해를 막아냈습니다. (${finalDmg} 관통)</span>`);
    }
  }

  // 취약 등 받는 피해 배율 (status-effects가 단일 소스)
  const mult = getIncomingDamageMultiplier(playerStatus);
  if (mult !== 1) {
    finalDmg = Math.floor(finalDmg * mult);
    addBattleLog(`<span class="text-purple-400">💥 [취약 효과] 플레이어가 받는 피해가 증폭되었습니다! (x${mult})</span>`);
  }

  // ⚡ 감전: 피격될 때마다 추가 연쇄 피해
  const shockBonus = getOnHitBonusDamage(playerStatus);
  if (shockBonus > 0) {
    finalDmg += shockBonus;
    addBattleLog(`<span class="text-amber-300">⚡ [감전 연쇄] 추가 번개 피해 +${shockBonus}!</span>`);
  }

  if (pierceShield) {
    addBattleLog(`<span class="text-purple-400 font-bold">🎯 [실드 관통] 공격이 방어막을 무시하고 체력을 직접 타격합니다!</span>`);
  } else if (state.playerMaxShield > 0) {
    const absorbed = Math.min(state.playerMaxShield, finalDmg);
    state.playerMaxShield -= absorbed;
    finalDmg -= absorbed;
    if (absorbed > 0) {
      addBattleLog(`<span class="text-slate-300">🛡️ 방어막이 ${absorbed} 피해를 흡수했습니다. (잔여 ${state.playerMaxShield})</span>`);
    }
  }

  if (finalDmg > 0) {
    const wasAbove = state.playerHp > state.playerMaxHp * 0.5;
    state.playerHp -= finalDmg;
    addBattleLog(`<span class="text-red-500 font-bold">🩸 플레이어가 ${finalDmg} 피해를 입었습니다!</span>`);

    // 🐛 'damaged' 이벤트를 아무도 쏘지 않아 selfLowHp 함정이 죽어 있었다.
    //    절반 아래로 **떨어지는 순간**에만 쏜다 (매 피격마다 쏘면 계속 터진다).
    if (wasAbove && state.playerHp <= state.playerMaxHp * 0.5 && state.playerHp > 0) {
      triggerTraps('boss', 'damaged', null);
    }
  }
}

export function startPlayerTurn() {
  state.turnCount++;
  isPlayerTurn = true;
  state.isAnimating = false;

  // 버프 틱 차감
  if (playerBuffs.invulnerable > 0) playerBuffs.invulnerable--;

  // 🛡️ 피해 경감도 턴마다 줄어든다. 안 하면 한 번 걸면 전투 내내 유지된다.
  if (playerBuffs.damageReductionTurns > 0) {
    playerBuffs.damageReductionTurns--;
    if (playerBuffs.damageReductionTurns === 0) {
      const was = playerBuffs.damageReduction;
      playerBuffs.damageReduction = 0;
      if (was > 0) addBattleLog(`<span class="text-slate-400">🛡️ 피해 경감 효과가 사라졌습니다.</span>`);
    }
  }

  // 🔥 플레이어 지속 피해(화상/맹독) 적용 후 상태이상 1턴 감쇠
  // 🐛 수정: 이전에는 playerDebuffs에 burn/poison 칸만 있고 적용/감쇠가 없어
  //          취약(vulnerable)이 한 번 걸리면 전투 끝까지 유지됐다.
  applyDamageOverTime(playerStatus, {
    label: '플레이어',
    onDamage: (dmg) => { state.playerHp -= dmg; }
  });
  reportExpiredStatuses(decayStatuses(playerStatus), '플레이어');

  if (state.playerHp <= 0) {
    renderBattleUI();
    checkBattleStatus();
    return;
  }

  // 💎 정통 TCG 룰: 턴 수에 맞춰 마나 최대치가 1씩 성장 (턴 1: 1마나, 턴 2: 2마나...)
  growMana(sides.player, state.turnCount);

  // 모든 아군 소환수 공격 가능 상태 해제 (빙결 해제)
  // 💫 내 소환수 상태이상 처리 (지속 피해 → 봉쇄 소모 → 감쇠)
  //    ⚠️ refreshMinions **앞에** 와야 한다. refreshMinions는 여기서 세운
  //       `m.blockedBy`를 읽어 canAttack을 결정한다.
  tickMinionStatuses(state.playerMinions, '내');
  refreshMinions(sides.player);

  // 턴 시작 시 건축물 패시브 (마나 공급 등)
  triggerStructureStartTurnPassives();

  drawCards(1);
  updateBossIntent();
  renderBattleUI();
  addBattleLog(`<span class="text-emerald-400 font-bold">✨ [턴 ${state.turnCount}] 플레이어 턴 시작! 마나(${state.playerMana}) 충전 완료.</span>`);
}

// 지속 피해(화상/맹독)를 실제로 적용한다. status-effects가 수치를, 여기서 차감을 담당.
function applyDamageOverTime(statuses, { label, onDamage }) {
  const ticks = collectDamageOverTime(statuses);
  ticks.forEach(({ spec, damage }) => {
    onDamage(damage);
    addBattleLog(`<span class="${spec.color} font-bold">${spec.icon} [${spec.name}] ${label}에게 ${damage} 지속 피해!</span>`);
  });
  return ticks;
}

function reportExpiredStatuses(expired, label) {
  expired.forEach(({ spec }) => {
    if (!spec) return;
    addBattleLog(`<span class="text-slate-400">${spec.icon} ${label}의 [${spec.name}] 효과가 해제되었습니다.</span>`);
  });
}

/**
 * 상대의 상태 표시.
 *
 * 🐛 예전에는 다음 콤보의 **이름과 전개 순서를 통째로** 미리 알려줬다.
 *    ("다음 콤보: [화염의 진노 연계] (화염 토템 소환 → 아군 화상 부여 → ...)")
 *    상대의 다음 수를 미리 아는 것은 TCG에서 숨은 정보를 깨는 일이고,
 *    그 자리를 다른 정보에 쓰는 편이 낫다.
 *
 *    지금은 **위험 신호만** 보여준다 — 무엇이 올지는 알려주지 않는다.
 */
export function updateBossIntent() {
  if (!state.currentBoss) return;
  const intentEl = document.getElementById('boss-intent');
  if (!intentEl) return;

  if (isPvpActive()) {
    // PvP에는 스크립트 패턴이 없다. 표시할 것도 없다.
    intentEl.innerHTML = '';
    return;
  }

  const enraged = state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.5;
  intentEl.innerHTML = enraged
    ? `<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-red-500/50 text-red-300 text-xs font-bold shadow-md">
         <span class="animate-pulse">🔥</span><span>격노 — 보스의 공세가 거세집니다</span>
       </div>`
    : `<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-slate-600/60 text-slate-400 text-xs font-bold">
         <span>⚔️</span><span>보스가 다음 수를 준비 중입니다</span>
       </div>`;
}

export function checkBattleStatus() {
  if (state.currentBoss && state.currentBoss.currentHp <= 0) {
    audio.playVictory();
    if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.4 } });
    addBattleLog(`<span class="text-yellow-400 font-black text-base">🎉 축하합니다! [${state.currentBoss.name}] 을(를) 격퇴했습니다!</span>`);
    alert(`🎉 승리! [${state.currentBoss.name}] 을(를) 처치했습니다!`);
    return true;
  }

  if (state.playerHp <= 0) {
    addBattleLog(`<span class="text-red-500 font-black text-base">💀 패배... 생명력이 모두 소진되었습니다.</span>`);
    alert('💀 패배했습니다. 마도서에서 강력한 주문과 건축물 카드를 연성해보세요!');
    return true;
  }
  return false;
}

export function addBattleLog(msg) {
  const logBox = document.getElementById('battle-logs');
  if (!logBox) return;
  const entry = document.createElement('div');
  entry.className = 'text-xs leading-relaxed';
  entry.innerHTML = msg;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}


// 상태이상 뱃지를 지정 컨테이너에 렌더링
function renderStatusBadges(containerId, statuses) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = describeStatuses(statuses);
  box.innerHTML = list.map(s =>
    `<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-black/70 border border-slate-600 ${s.color}" title="${escapeHtml(s.label)}">${s.label}</span>`
  ).join('');
}
export function clearBattleLogs() {
  const logBox = document.getElementById('battle-logs');
  if (logBox) logBox.innerHTML = '';
}

export function changeBoss(idx = null) {
  if (idx !== null && typeof idx === 'number') {
    state.currentBossIdx = idx;
    const sel = document.getElementById('boss-select');
    if (sel) sel.value = state.currentBossIdx;
  } else {
    const sel = document.getElementById('boss-select');
    if (sel) {
      state.currentBossIdx = parseInt(sel.value) || 0;
    }
  }
  initBattle();
}

export function restartBattle() {
  initBattle();
}

// ============================================================
// 🌐 PvP 연결
// ------------------------------------------------------------
// pvp-battle.js가 상대 행동을 받으면 여기 등록된 함수를 부른다.
// 순환 import를 피하려고 "브릿지가 엔진을 호출"하는 방향으로 뒤집었다.
// (엔진 → 브릿지는 import, 브릿지 → 엔진은 콜백)
// ============================================================
registerPvpHandlers({
  // 상대가 낸 카드 = 내 화면에서는 보스가 내는 카드
  playFoeCard: (card, slot, picked) => playFoeCardPvp(card, slot, picked),

  // 상대 하수인 한 기의 공격
  foeMinionAttack: (slotIdx) => foeMinionAttack(slotIdx),

  // 상대 턴이 끝났다 → 내 턴 시작
  beginMyTurn: () => startPlayerTurn(),

  foeSurrendered: () => {
    addBattleLog(`<span class="text-emerald-300 font-bold">🏳️ ${escapeHtml(getFoeName())}이(가) 항복했습니다. 승리!</span>`);
    state.currentBoss.currentHp = 0;
    renderBattleUI();
    checkBattleStatus();
  }
});

// ============================================================
// 🌐 PvP 전용 카드 해석 — 보스 경로를 쓰지 않는다
// ------------------------------------------------------------
// playBossCard()는 **PvE 전용**이다. 보스는 스크립트 패턴으로 싸우도록
// 일부러 다르게 만들어져 있다:
//   · 소환수의 전투의 함성을 발동하지 않는다
//   · 주문 피해에 ×0.7 감산이 붙는다
//   · 보스 전용 콤보(triggerBossArchetypeCombo)를 쓴다
//
// PvP에서 이 경로를 쓰면 같은 카드가 양쪽 화면에서 다르게 해석돼
// 락스텝이 깨진다. 실제로 "내 화면 40 피해 / 상대 화면 8 피해"가 나왔다.
//
// 그래서 PvP는 **플레이어 경로를 거울로 뒤집어** 쓴다.
// applyPlayerSkillEffects가 game/helpers를 주입받게 돼 있어서,
// 진영만 바꿔 끼우면 똑같은 규칙으로 해석된다.
// ============================================================

/**
 * 진영을 뒤집은 game 뷰 — 상대 카드가 "자기 기준"으로 해석되게 한다.
 *
 * 🐛 예전에는 5개 필드만 뒤집었다. 연계와 효과가 읽는 나머지는 그냥 **없었고**,
 *    없는 필드를 읽은 결과가 조용히 번져 나갔다:
 *      · game.turnCount 없음  → perTurn 증가방식이 NaN 피해를 냈다
 *      · game.playerMinions 없음 → 특수소환·결집·수호·제물이 TypeError로 전멸
 *      · game.currentBoss 없음   → 결계 파쇄와 bossShielded 조건이 영영 불발
 *      · game.playerHand/Deck 없음 → 서치·드로우·회수·패 교란이 전멸
 *    거울은 **전부** 뒤집어야 한다. 일부만 뒤집으면 나머지가 undefined다.
 */
function makeMirroredGame() {
  return {
    // 상대 입장의 "적 하수인" = 내 하수인
    get bossMinions() { return state.playerMinions; },
    set bossMinions(v) { state.playerMinions = v; },
    // 상대 입장의 "내 하수인" = 상대(보스 슬롯)의 하수인
    get playerMinions() { return state.bossMinions; },
    set playerMinions(v) { state.bossMinions = v; },

    // 상대 입장의 "내 방어막/체력/마나" = 상대(보스 슬롯)의 것
    get playerMaxShield() { return state.currentBoss.shield || 0; },
    set playerMaxShield(v) { state.currentBoss.shield = v; },

    get playerHp() { return state.currentBoss.currentHp; },
    set playerHp(v) { state.currentBoss.currentHp = v; },
    get playerMaxHp() { return state.currentBoss.maxHp; },
    set playerMaxHp(v) { state.currentBoss.maxHp = v; },

    // 마나는 Side가 한 집(state.bossMana)으로 관리한다.
    // 🐛 예전엔 여기 쓰기가 클로저 마나와 다른 집에 들어가 manaGain이 죽은 필드에 쓰였다.
    get playerMana() { return sides.boss.mana; },
    set playerMana(v) { sides.boss.mana = v; },
    get playerMaxMana() { return sides.boss.maxMana; },
    set playerMaxMana(v) { sides.boss.maxMana = v; },

    // 상대 입장의 "내 손패/덱" = 보스 슬롯의 손패/덱
    get playerHand() { return state.bossHand || (state.bossHand = []); },
    set playerHand(v) { state.bossHand = v; },
    get playerDeck() { return state.bossDeck || (state.bossDeck = []); },
    set playerDeck(v) { state.bossDeck = v; },
    // 상대 입장의 "적 손패/덱" = 내 손패/덱 (🐛 적 덱 게터가 없어 서치·파기 연계가 거울에서 죽었다)
    get bossHand() { return state.playerHand; },
    set bossHand(v) { state.playerHand = v; },
    get bossDeck() { return state.playerDeck; },
    set bossDeck(v) { state.playerDeck = v; },

    // 상대 입장의 "적 본체" = 나
    get currentBoss() {
      return {
        get currentHp() { return state.playerHp; },
        set currentHp(v) { state.playerHp = v; },
        get maxHp() { return state.playerMaxHp; },
        get shield() { return state.playerMaxShield; },
        set shield(v) { state.playerMaxShield = v; }
      };
    },

    // 턴 수는 진영과 무관하다 — 없으면 perTurn/lateGame이 조용히 죽는다
    get turnCount() { return state.turnCount; },
    get archetypesList() { return state.archetypesList; }
  };
}

/**
 * 상대(원격 플레이어)가 낸 카드를 내 화면에서 해석한다.
 * playCard()와 **같은 규칙**을 쓰되 진영만 뒤집는다.
 */
export async function playFoeCardPvp(card, slot = null, picked = null) {
  // 🐛 `picked`가 **매개변수에 없었다.** 아래 네 곳이 선언되지 않은 이름을
  //    참조해 ReferenceError를 냈고, 그래서 PvP에서 상대의 주문과
  //    전투의 함성이 하나도 해결되지 않았다 (전장 배치만 됐다).
  if (!card || state.playerHp <= 0 || state.currentBoss.currentHp <= 0) return;

  const cardType = card.cardType || 'unit';
  const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.dark;
  state.bossLastCastCard = card;

  addBattleLog(`
    <div class="p-2 rounded-xl bg-gradient-to-r from-indigo-950/90 to-slate-900/90 border border-cyan-500/60 shadow-lg my-1.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-base">${elCfg.icon}</span>
        <div>
          <div class="text-[10px] text-cyan-300 font-bold">🌐 ${escapeHtml(getFoeName())}</div>
          <div class="text-xs font-black text-white">${escapeHtml(card.name)}</div>
        </div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-black/60 text-slate-300 font-bold border border-slate-700">${
        cardType === 'unit' ? '⚔️ 소환수' : cardType === 'structure' ? '🏛️ 건축물' : cardType === 'trap' ? '🪤 함정' : '🔮 주문'}</span>
    </div>
  `);

  // 거울 뷰·헬퍼는 플레이어와 **같은 팩토리**에서 나온다 — 진영만 다르다
  const mirroredGame = viewFor(sides.boss);
  const mirroredHelpers = helpersFor(sides.boss);

  // 🪤 함정: 뒷면으로 세트만 한다
  if (cardType === 'trap') {
    setTrap('boss', card);
    renderBattleUI();
    return;
  }

  // 내가 세트한 함정이 상대 행동에 반응한다
  triggerTraps('boss', 'playCard', card);

  // 주문 — 필드를 차지하지 않고 즉발
  if (cardType === 'spell') {
    audio.playMagic();
    triggerArchetypeCombo(card, mirroredGame, mirroredHelpers);
    const skill = card.skills && card.skills[0];
    if (skill) {
      applyPlayerSkillEffects(skill, { card, game: mirroredGame, helpers: mirroredHelpers },
        { sourceLabel: '주문', allowAoe: true, picked });
      if (bossBuffs.doubleCast) {
        bossBuffs.doubleCast = false;
        addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 상대의 주문이 2연속 발동합니다!</span>`);
        applyPlayerSkillEffects(skill, { card, game: mirroredGame, helpers: mirroredHelpers },
          { sourceLabel: '주문', allowAoe: true, picked });
      }
    }
    renderBattleUI();
    checkBattleStatus();
    return;
  }

  // 소환수 / 건축물 — 전장 점유
  audio.playSummon();
  if (state.bossMinions.length < sides.boss.maxMinions) {
    // 상대가 고른 배치 위치를 그대로 재현한다 (안 그러면 전열이 어긋난다)
    // length로 누르는 이유는 playCard와 같다 — 빈칸 없는 배열에 length 너머는 없다 (DECISIONS #93)
    const at = Number.isInteger(slot)
      ? Math.max(0, Math.min(state.bossMinions.length, slot))
      : state.bossMinions.length;
    state.bossMinions.splice(at, 0, {
      ...card,
      instanceId: card.instanceId || `${card.id}#foe${state.bossMinions.length}`,
      maxHp: card.hp || 30,
      currentHp: card.hp || 30,
      defense: card.defense || 0,

      canAttack: false,
      summonedTurn: state.turnCount,
      frozen: false
    });
    addBattleLog(`<span class="text-cyan-300 font-bold">${cardType === 'structure' ? '🏛️ 상대가 건축물을 구축' : '✨ 상대가 소환수를 출진'}했습니다: [${escapeHtml(card.name)}]</span>`);
  } else {
    addBattleLog(`<span class="text-slate-400">상대 전장이 가득 차 [${escapeHtml(card.name)}]을(를) 배치하지 못했습니다.</span>`);
  }

  triggerArchetypeCombo(card, mirroredGame, mirroredHelpers);

  // 전투의 함성 — PvE 보스 경로에는 없지만 PvP에서는 반드시 발동해야 대칭이다
  const skill = card.skills && card.skills[0];
  if (skill) {
    applyPlayerSkillEffects(skill, { card, game: mirroredGame, helpers: mirroredHelpers },
      { sourceLabel: '전투의 함성', allowAoe: false, picked });
    if (bossBuffs.doubleCast) {
      bossBuffs.doubleCast = false;
      addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 상대의 전투의 함성이 2배로 발동합니다!</span>`);
      applyPlayerSkillEffects(skill, { card, game: mirroredGame, helpers: mirroredHelpers },
        { sourceLabel: '전투의 함성', allowAoe: false, picked });
    }
  }

  renderBattleUI();
  checkBattleStatus();
}
