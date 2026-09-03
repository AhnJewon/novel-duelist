// battle-engine.js - 정통 카드 배틀 엔진 (소환수 / 주문 / 건축물 & 보스 멀티액션)

import { ELEMENT_CONFIG, PLAYER_BASE_HP } from './config.js';
import { audio } from './audio.js';
import { state } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { triggerLiveBossReaction } from './boss-forge.js';
import { BOSS_DATA, BOSS_POWER_CARDS } from './data.js';
import { createBossController } from './boss-ai.js';
import {
  evaluateFieldSynergy, findSynergyForEntity,
  triggerArchetypeCombo
} from './archetype-service.js';
import {
  STATUS_EFFECTS, createStatusState, applyStatus, consumeBlockingStatus, isEntityOnly,
  collectDamageOverTime, decayStatuses,
  getIncomingDamageMultiplier, getOnHitBonusDamage, describeStatuses
} from './status-effects.js';
import {
  applyPlayerSkillEffects, selectFrontTarget,
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
import { SLOT_CAP, THORNS_TURNS } from './battle-rules.js';

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

// 🤖 보스의 판단(카드·대상 선택, 램프 BOSS_RAMP, 콤보 스텝, 격노)은 boss-ai.js에 있다.
//    이 파일에는 **규칙**만 남는다 — 봇은 그 규칙을 ops로 받아 쓴다 (DECISIONS #94).

// 🔁 누구의 턴인가 — 진영 키.
//    🐛 예전 `isPlayerTurn` 불리언은 initBattle이 양 클라이언트에서 true로 두어
//       PvP 게스트가 호스트 첫 턴에 행동할 수 있었다 (DECISIONS #94).
let activeSideKey = SIDE_PLAYER;
// 🎲 라운드 리더 — 이 진영의 턴이 **시작될 때만** turnCount가 오른다.
//    PvE는 플레이어, PvP는 호스트(내 화면에서 player 또는 boss). 양 클라이언트가 같은 카운터를 가진다.
let leaderKey = SIDE_PLAYER;

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

/** 판이 끝났는가 — 봇 루프가 액션 사이마다 확인한다 */
export function isGameOver() {
  return state.playerHp <= 0 || !state.currentBoss || state.currentBoss.currentHp <= 0;
}

// 🤖 PvE 봇 컨트롤러 — 상대 진영을 조종한다. 규칙은 전부 이 엔진 함수(ops)로 받고,
//    판단(카드·대상 선택)과 보스 고유 콤보 스텝·격노만 스스로 갖는다.
//    엔진 → 봇 한 방향 import라 순환이 없다. sides는 게터로 넘긴다 (initBattle마다 새로 만들어진다).
const botController = createBossController({
  sides: () => sides,
  startTurn: (side) => startTurn(side),
  endTurn: (side) => endTurn(side),
  applyFoeAction: (action) => applyFoeAction(action),
  dealFaceDamage: (target, dmg, opts) => dealFaceDamage(target, dmg, opts),
  applyStatusRespectingScope: (...args) => applyStatusRespectingScope(...args),
  addBattleLog: (msg) => addBattleLog(msg),
  renderBattleUI: () => renderBattleUI(),
  checkBattleStatus: () => checkBattleStatus(),
  isGameOver: () => isGameOver(),
  viewFor: (side) => viewFor(side),
  triggerLiveBossReaction: (kind) => triggerLiveBossReaction(kind)
});

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

/** 두 진영 요약 — 동기화 검증·디버깅용 (두 클라이언트에서 같은 시점에 찍어 비교한다) */
export function describeBattleSides() {
  return {
    player: describeSide(sides.player), boss: describeSide(sides.boss),
    seed: currentBattleSeed(), turn: state.turnCount, active: activeSideKey, leader: leaderKey
  };
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
 * 키 이름은 진영 상대적이다 (#94에서 dealDamageToBoss→dealDamageToFoe 등으로 개명): `dealDamageToFoe` = "내 상대의 본체에", `setSelfStatus` = "내 진영에",
 * `setFoeStatus` = "상대 진영에". 플레이어 카드든 상대 카드든 **같은 구현이 같은 이름**으로 쓴다.
 *
 * 🐛 예전에는 세 벌이었다 — makeComboHelpers(플레이어), makeMirroredHelpers(PvP 거울),
 *    makeBossComboHelpers(보스 전용 구현). 키가 서로 달라 한쪽에만 있는 헬퍼를 부르면
 *    TypeError가 runArchetypeCombo의 try/catch에 삼켜져 조용히 아무 일도 안 일어났다
 *    (DECISIONS #82). 거울은 drawCards의 n을 무시하고 1장만 뽑았다.
 *    보스 전용 연계 구현(ARCHETYPE_COMBO_ACTIONS[*].boss)은 한 벌로 합쳐져 사라졌다 → DECISIONS #94
 */
function helpersFor(side) {
  const other = sides[opponentOf(side.key)];
  const mine = side.key === SIDE_PLAYER;
  const labelOf = (s) => (s.key === SIDE_PLAYER ? '내' : '상대');
  return {
    addBattleLog,
    audio,
    // "적 본체에 피해" — 이 진영의 상대에게
    dealDamageToFoe: (dmg, src) => dealFaceDamage(other, dmg, { source: src, attacker: side }),
    // 드로우는 **자기** 덱에서 자기 손패로, n장
    drawCards: (n = 1) => (mine ? drawCards(n) : drawTo(side, n, { onDraw: () => audio.playDraw() })),
    // 💫 소환수 전용 상태이상(기절·빙결·화상·맹독)은 본체에 걸리지 않는다.
    //    관문이 그 진영의 최전방 소환수로 돌린다.
    setFoeStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(other.statuses, other.minions, labelOf(other), type, turns, value, allowBody),
    setSelfStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(side.statuses, side.minions, labelOf(side), type, turns, value, allowBody),
    setSelfBuff: (type, val) => { side.buffs[type] = val; },
    // 로그는 늘 **내 화면** 기준이다 — 상대 카드가 "적"을 치면 그건 나다.
    //    selfLabel은 연계 배지에 "누구의 연계인가"를 붙인다 (내 것이면 비운다).
    foeLabel: mine ? other.name : '나',
    selfLabel: mine ? '' : side.name,
    onShielded: () => triggerTraps(side.key, 'shielded', null),
    foeHp: () => other.hp,
    foeMaxHp: () => other.maxHp,
    // 상대 손패 무작위 파기 — 반드시 battleRng를 거쳐야 PvP가 어긋나지 않는다
    discardFromFoe: () => discardRandom(other, battleRng())
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
  buffs: () => ({ player: playerBuffs, boss: bossBuffs }),
  statuses: () => ({ player: playerStatus, boss: bossStatus }),
  traps: () => trapZones,
  setTrap: (sideKey, card) => setTrap(sideKey, card),
  fireTraps: (actorKey, event, card) => triggerTraps(actorKey, event, card),
  /** 보스 콤보 스텝 하나 (봇 컨트롤러의 실행기) */
  bossStep: (step) => botController.executeStep(step),
  /** 봇 턴 하나를 다음 턴 예약 없이 돈다 — 하네스용 */
  takeBotTurn: (opts = {}) => executeBossTurn({ ...opts, handOff: false }),
  isPlayerTurn: () => activeSideKey === SIDE_PLAYER,
  activeSide: () => activeSideKey,
  /** 진영 공용 턴 경계를 직접 돈다 (봇/원격 경로를 흉내 낼 때) */
  startTurn: (key) => startTurn(sides[key]),
  endTurn: (key) => endTurn(sides[key]),
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
    activeSideKey = SIDE_PLAYER;
    leaderKey = SIDE_PLAYER;
    reshuffleGen = { player: 0, boss: 0 };
    botController.reset();
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

// 🎲 좌석 — 리더 A, 팔로워 B. 덱의 instanceId에 붙여 양 클라이언트에서 같은 카드를 같은 이름으로 부른다.
function seatOf(sideKey) {
  return sideKey === leaderKey ? 'A' : 'B';
}

// 📚 리셔플 세대 — 같은 카드의 재등장 id가 겹치지 않게. initBattle/reset이 0으로.
let reshuffleGen = { player: 0, boss: 0 };

/**
 * 덱을 섞고 좌석·위치로 instanceId를 붙인다. 양 클라이언트가 같은 RNG 위치에서 같은 입력 순서로
 * 부르면 같은 덱이 나온다 — PvP 락스텝의 뿌리다.
 * 🐛 예전엔 플레이어 덱은 `id#idx`, 보스 덱은 id 없음, 원격 덱은 `foe-i`로 제각각이라
 *    전송된 카드를 손패에서 찾지 못해 상대 손패 수가 줄지 않았다 (DECISIONS #94).
 */
function seatDeck(cards, seat, gen = 0) {
  return battleRng().shuffle(cards.map(c => ({ ...c })))
    .map((c, i) => ({ ...c, instanceId: `${seat}:${c.id}#${gen}.${i}` }));
}

/**
 * 전투 시작.
 * @param opts.seed   난수 시드. 지정하면 전투가 그대로 재현된다. P2P는 양쪽이 같은 시드를 공유한다.
 * @param opts.leader 라운드 리더(선공) 진영 키. PvE 'player', PvP는 호스트 진영(내 화면 기준).
 * @param opts.foe    상대 진영 정의. 기본 { controller:'bot' } = 보스 목록의 현재 보스.
 *                    PvP는 { controller:'remote', deck: cards[], profile, avatar }.
 *
 * 🎲 결정론: 시드 → **리더 덱 먼저, 팔로워 덱 다음** 순서로 섞고, 양쪽 4장씩 같은 방식으로 뽑는다.
 *    🐛 예전엔 양 클라이언트가 여기서 buildBossTacticalDeck(보관함 크기만큼 RNG 소비)을 돌린 뒤
 *       pvp-ui가 상대 덱을 **셔플 없이** 덮어썼다 — RNG 스트림이 시작부터 갈라졌고, 원격 상대의
 *       체력은 50(기준 100)이었다 (DECISIONS #94).
 */
export function initBattle({ seed = null, leader = SIDE_PLAYER, foe = null } = {}) {
  const usedSeed = seedBattleRng(seed);
  const foeSpec = foe || { controller: 'bot' };
  const remote = foeSpec.controller === 'remote';

  if (remote) {
    // 🌐 원격 듀얼리스트 — 보스 전용 요소(콤보·대사)는 비운다. 체력은 플레이어와 같은 기준값.
    const fp = foeSpec.profile || {};
    state.currentBoss = {
      name: fp.name || '상대 듀얼리스트',
      titleEn: fp.title || 'Opponent',
      element: fp.element || 'dark',
      avatarEmoji: fp.avatarEmoji || '👤',
      imageUrl: foeSpec.avatar || '',
      maxHp: PLAYER_BASE_HP,
      currentHp: PLAYER_BASE_HP,
      shield: 0,
      comboPatterns: [],
      dialogueOnStart: '',
      dialogueLowHp: '',
      actionIdx: 0,
      isDuelist: true
    };
  } else {
    const bossTemplate = state.bossesList[state.currentBossIdx] || BOSS_DATA[0];
    state.currentBoss = {
      ...bossTemplate,
      currentHp: bossTemplate.maxHp,
      shield: bossTemplate.shield || 0,
      actionIdx: 0
    };
  }

  state.turnCount = 1;
  // 🐛 보스 턴 도중에 전투를 리셋하면 isAnimating이 true로 남아 조작이 영구 잠겼다
  state.isAnimating = false;
  state.playerHp = PLAYER_BASE_HP;
  state.playerMaxHp = PLAYER_BASE_HP;
  state.playerMaxShield = 0;
  state.playerMaxMana = 1; // 💎 정통 TCG 룰: 1턴 1마나로 시작하여 턴당 +1씩 증가!
  state.playerMana = 1;
  // 🎲 라운드 리더가 선공이다. PvE는 플레이어, PvP는 호스트(pvp-ui가 넘긴다).
  //    🐛 예전엔 양 클라이언트가 모두 "내 턴"으로 시작해 게스트가 호스트 첫 턴에 행동할 수 있었다.
  leaderKey = (leader === SIDE_BOSS) ? SIDE_BOSS : SIDE_PLAYER;
  activeSideKey = leaderKey;
  botController.reset();
  const phaseBadge = document.getElementById('boss-phase-badge');
  if (phaseBadge) phaseBadge.classList.add('hidden');
  state.playerMinions = [];
  // 👾 상대 전장은 **비어서 시작한다.**
  //    🐛 예전에는 보스 소환수 2기를 깔고 시작했다. 플레이어는 1마나뿐인 1턴에 막을 것을 낼 수 없는데
  //       그 2기가 곧바로 본체를 때려 아무것도 못 한 채 2턴에 죽었다 (턴1 보스 딜 59 vs 체력 50).
  //    보스는 콤보 스텝으로 매 턴 소환하므로 전장은 금방 채워진다 — 압박을 뒤로 미루는 것이다.
  state.bossMinions = [];
  state.bossLastCastCard = null;
  state.playerLastCastCard = null;

  bossStatus = createStatusState();
  playerStatus = createStatusState();
  playerBuffs = createBuffs();
  bossBuffs = createBuffs();
  trapZones = { player: [], boss: [] };
  sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs, trapZones });
  sides.boss.controller = remote ? 'remote' : 'bot';
  reshuffleGen = { player: 0, boss: 0 };
  // 💎 상대 마나도 플레이어처럼 1에서 시작해 턴 시작마다 자란다 (한 집: state.bossMana)
  state.bossMana = 1;
  state.bossMaxMana = 1;
  // 🎯 소환 위치 무장·효과 대상 선택도 전투 단위 상태다.
  //    🐛 수정: 여기서 지우지 않아 지난 전투에서 눌러 둔 자리가 새 전투의 첫 소환에
  //       그대로 적용됐다 — "지정 안 했는데 이상한 자리에 들어간다"의 원인 하나 (DECISIONS #93)
  if (isTargeting()) cancelTargeting(false);
  _pendingSummonSlot = null;
  _pendingPicked = null;

  // 📚 덱 — 플레이어는 출전 덱, 봇은 전술 덱(플레이어 카드 + 보스 파워 카드), 원격은 받은 덱.
  //    양쪽 **고정 덱 목록**을 저장해 두고 덱이 비면 그것을 다시 섞는다 (drawFor).
  const playerSource = getActiveDeckCards();
  const bossSource = remote ? (foeSpec.deck || []).map(c => ({ ...c })) : buildBossTacticalDeck(state.currentBoss);
  state.bossDeckSource = bossSource.slice();

  // 🎲 리더 덱 먼저, 팔로워 덱 다음 — 양 클라이언트가 같은 순서로 RNG를 쓴다. 4장씩 같은 방식(pop).
  const order = leaderKey === SIDE_PLAYER ? [SIDE_PLAYER, SIDE_BOSS] : [SIDE_BOSS, SIDE_PLAYER];
  for (const key of order) {
    sides[key].deck = seatDeck(key === SIDE_PLAYER ? playerSource : bossSource, seatOf(key));
    sides[key].hand = [];
  }
  for (const key of order) drawTo(sides[key], 4);

  clearBattleLogs();
  addBattleLog(`<span class="text-amber-400 font-bold">⚔️ [${escapeHtml(state.currentBoss.name)}] 과의 결전이 시작되었습니다!</span>`);
  addBattleLog(`<span class="text-slate-400">출전 덱(${playerSource.length}장)을 셔플하여 전장에 진입했습니다. <span class="text-slate-600">(seed: ${usedSeed}${remote ? ` · ${leaderKey === SIDE_PLAYER ? '내가 선공' : '상대가 선공'}` : ''})</span></span>`);

  if (!remote) {
    const userCardCount = (state.bossDeck || []).filter(c => c.isUserCard).length + (state.bossHand || []).filter(c => c.isUserCard).length;
    if (userCardCount > 0) {
      addBattleLog(`<span class="text-purple-300 font-bold">🔮 보스가 플레이어의 마도서에서 ${userCardCount}장의 카드를 감지하여 자신의 덱에 편성했습니다!</span>`);
    }
    if (state.currentBoss.themeName) {
      addBattleLog(`<span class="text-amber-300 font-bold">⚜️ [테마 보스] 이 보스는 <b>[${escapeHtml(state.currentBoss.themeName)}]</b> 카드군 덱을 사용합니다!</span>`);
    }
    triggerLiveBossReaction('start');
  }
  renderBattleUI();
  updateBossIntent();
}

/**
 * 진영 공용 드로우. 덱이 비면 그 진영의 **고정 덱**을 다시 섞는다 — 양 진영 같은 규칙.
 *   플레이어: 출전 덱(getActiveDeckCards)  /  상대: initBattle이 저장한 bossDeckSource
 * 🐛 예전엔 플레이어만 이 규칙이었고, 상대는 낸 카드마다 1장 보충 + 빌 때마다 덱 재생성이었다.
 */
function drawFor(side, count = 1) {
  const mine = side.key === SIDE_PLAYER;
  if (side.hand.length >= side.maxHand) {
    addBattleLog(`<span class="text-red-400">${mine ? '' : `${escapeHtml(side.name)}의 `}손패가 가득 차 카드를 더 뽑을 수 없습니다! (최대 ${side.maxHand}장)</span>`);
    return [];
  }
  return drawTo(side, count, {
    onEmpty: (s) => {
      const source = mine ? getActiveDeckCards() : (state.bossDeckSource || []).map(c => ({ ...c }));
      if (source.length === 0) {
        addBattleLog(`<span class="text-red-400">${mine ? '' : `${escapeHtml(s.name)}의 `}덱이 비었습니다!</span>`);
        return;
      }
      // 좌석·세대가 붙은 새 instanceId — 이미 손에 있는 지난 세대 사본과 겹치지 않는다
      s.deck = seatDeck(source, seatOf(s.key), ++reshuffleGen[s.key]);
      addBattleLog(`<span class="text-purple-400">${mine ? '출전 덱' : `${escapeHtml(s.name)}의 덱`}(${source.length}장)을 다시 섞어 보충했습니다!</span>`);
    },
    onDraw: () => audio.playDraw()
  });
}

/** 플레이어 드로우 (효과·하네스가 부르는 이름). drawFor(sides.player)와 같다. */
export function drawCards(count = 1) {
  return drawFor(sides.player, count);
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
  // 💎 상대 마나 — 봇도 원격도 플레이어와 같은 규칙으로 쓴다. 공개 정보다 (숨은 정보는 손패 내용만, 규칙 13).
  const bMana = document.getElementById('boss-mana-text');
  if (bMana) bMana.innerText = `${state.bossMana ?? 1} / ${state.bossMaxMana ?? 1}`;

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
  
  const canAtk = !isStructure && entity.canAttack && activeSideKey === SIDE_PLAYER && !entity.frozen;
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

    // 함정 주인의 진영 기준으로 **플레이어와 같은 파이프라인**을 탄다.
    // 🐛 예전엔 보스 함정만 피해·방어막·치유·상태이상 4종을 인라인으로 흉내 냈고, 상태이상은
    //    관문을 건너 플레이어 **본체**에 raw로 걸렸다 (기절이 본체에). 드로우 등 나머지는 死효과였다.
    const ownerSide = sides[defenderKey];
    applyPlayerSkillEffects(skill, { card: trap, game: viewFor(ownerSide), helpers: helpersFor(ownerSide) },
      { sourceLabel: '함정', allowAoe: true });
  });
}

/**
 * 플레이어가 손패의 카드를 낸다 — **사람 전용 껍데기**(대상 선택 UI·PvP 전송).
 * 실제 시전 규칙은 playCardFor(side, …)가 양 진영 공용으로 갖는다.
 */
export function playCard(handIdx) {
  if (activeSideKey !== SIDE_PLAYER || state.isAnimating) return;
  const me = sides.player;
  const card = me.hand[handIdx];
  if (!card) return;

  // 시전 조건 검사는 진영 공용 (마나·전장 슬롯). 여기서 먼저 걸러야 대상 선택을 시작하지 않는다.
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
  const slot = Number.isInteger(_pendingSummonSlot) ? _pendingSummonSlot : null;

  const played = playCardFor(me, card, { slot, picked });
  if (!played) return;

  // 🎯 소환 위치 무장은 **소환에만** 소모된다 (주문·함정·반려로는 풀리지 않는다 — DECISIONS #93)
  if (cardType === 'unit' || cardType === 'structure') _pendingSummonSlot = null;

  // 🌐 PvP: 내가 낸 카드를 상대에게 알린다. 락스텝이므로 "결과"가 아니라 "무슨 카드를 냈는지"를
  //    보낸다. 이미지가 붙은 채로 보내면 데이터 채널이 막히므로 반드시 슬림화한다.
  //    🐛 예전엔 시전 **전에** 보내서, 함정 구역이 꽉 차 세트가 거절돼도 상대에겐 낸 것으로 갔다.
  if (isPvpActive()) {
    sendPvpAction({
      kind: 'playCard',
      instanceId: card.instanceId || card.id,
      card: slimCardForWire(card),
      slot,                      // 배치 위치도 보내야 상대 화면의 전열이 내 화면과 같아진다
      picked: picked || null     // 고른 효과 대상까지 보내야 상대 화면에서 같은 대상이 맞는다
    });
  }
}

/**
 * 카드 시전 — **양 진영 공용.** 사람·PvE 봇·PvP 재생이 전부 여기를 지난다.
 *
 * 순서: 관문(마나·전장) → 함정이면 세트만 → 지불(마나·손패·마지막 시전) → 상대 함정 반응
 *       → 주문: 연계 → 효과(+더블캐스트)  /  소환·건축물: **카드 그대로** 전장에 → 연계 → 함성(+더블캐스트)
 *
 * 🐛 예전엔 세 벌이었다 — playCard(플레이어), playBossCard(PvE: 효과 13종만 흉내, 소환수 스탯을
 *    공8·방4·체16 하한으로 재작성, 함성 없음, **함정을 즉발 주문으로**, 광역 본체 ×0.7, 만석이면
 *    전 소환수 공격 +2 영구), playFoeCardPvp(PvP: 관문·마나 차감 없음). 같은 카드가 누가 내느냐에 따라
 *    다른 카드였다 (DECISIONS #94).
 *
 * @param side         시전 진영
 * @param card         카드 객체 (손패에 있으면 제거한다 — 없어도 된다: 원격 스냅샷)
 * @param opts.slot    소환 위치 (null = 맨 뒤). 빈칸 없는 배열이라 length로 눌린다 (DECISIONS #93)
 * @param opts.picked  고른 대상 키 배열 (없으면 효과별 기본값)
 * @param opts.trusted 관문 불일치를 경고만 하고 진행 — 원격 상대용. 그쪽 클라이언트가 이미 검증했고,
 *                     내 미러 마나로 거절하면 판이 어긋난다. 단 전장 만석은 어느 쪽이든 놓지 않는다.
 * @returns {boolean} 시전됐는가
 */
export function playCardFor(side, card, { slot = null, picked = null, trusted = false } = {}) {
  if (!card) return false;
  const foe = sides[opponentOf(side.key)];
  if (side.hp <= 0 || foe.hp <= 0) return false;
  const mine = side.key === SIDE_PLAYER;
  const cardType = card.cardType || 'unit';
  const occupies = cardType === 'unit' || cardType === 'structure';

  const check = canPlayCard(side, card);
  if (!check.ok) {
    if (!trusted || (occupies && side.minions.length >= side.maxMinions)) {
      addBattleLog(`<span class="text-red-400">${mine ? '' : `${escapeHtml(side.name)}: `}${escapeHtml(check.reason)}</span>`);
      return false;
    }
    console.warn(`[PvP] 상대 카드 관문 불일치 — 미러 상태가 어긋났을 수 있다: ${check.reason}`);
  }

  // 🪤 함정: 뒷면으로 세트만 한다. 구역이 꽉 차면 아무것도 소모하지 않는다.
  if (cardType === 'trap') {
    if (!setTrap(side.key, card)) return false;
    spendCard(side, card);
    renderBattleUI();
    return true;
  }

  spendCard(side, card);
  if (!mine) logFoeCast(side, card);

  // 🪤 상대가 세트한 함정이 내 행동에 반응한다 (세트 자체는 반응 대상이 아니다 — 위에서 이미 return)
  triggerTraps(side.key, 'playCard', card);
  if (side.hp <= 0 || foe.hp <= 0) { renderBattleUI(); checkBattleStatus(); return true; }

  // 1. 주문 — 전장을 차지하지 않고 즉발
  if (cardType === 'spell') {
    audio.playMagic();
    if (mine) addBattleLog(`<span class="text-purple-400 font-bold">🔮 [주문 발동] ${escapeHtml(card.name)}!</span>`);
    triggerArchetypeCombo(card, viewFor(side), helpersFor(side));
    castSkill(side, card, picked, { sourceLabel: '주문', allowAoe: true });
    renderBattleUI();
    checkBattleStatus();
    return true;
  }

  // 2. 소환수 / 건축물 — 전장 점유. **카드를 그대로** 엔티티로 만든다 (스탯 하한·재작성 없음).
  audio.playSummon();
  const entity = {
    ...card,
    instanceId: card.instanceId || `${card.id}#${side.key}${side.minions.length}`,
    maxHp: card.hp || 30,
    currentHp: card.hp || 30,
    defense: card.defense || 0,
    // 🗑️ 도발은 제거됐다 — 전장에 있는 것만으로 이미 벽이다 (DECISIONS #84)
    taunt: false,
    canAttack: false,                 // 소환 후유증
    // ⚠️ 이게 없으면 refreshMinions가 다음 턴에도 풀어주지 않는다 (영구 마비)
    summonedTurn: state.turnCount,
    frozen: false
  };
  // 🎯 배치 위치. 맨 앞(0번)이 적의 공격을 먼저 받는다 — 위치가 곧 전술이다.
  //    length로 누르는 것은 방어선이 아니라 **모델**이다: 빈칸 없는 배열에 length 너머는 없다 (DECISIONS #93)
  const at = Number.isInteger(slot) ? Math.max(0, Math.min(side.minions.length, slot)) : side.minions.length;
  side.minions.splice(at, 0, entity);

  if (mine) {
    addBattleLog(cardType === 'structure'
      ? `<span class="text-amber-400 font-bold">🏛️ [건축물 건립] [${escapeHtml(card.name)}] 을(를) 전장에 구축했습니다! (내구도: ${entity.maxHp})</span>`
      : `<span class="text-cyan-400 font-bold">✨ [소환수 출진] [${escapeHtml(card.name)}] 을(를) 전장에 소환했습니다!</span>`);
  } else {
    addBattleLog(`<span class="text-cyan-300 font-bold">${cardType === 'structure' ? '🏛️' : '👾'} ${escapeHtml(side.name)}이(가) [${escapeHtml(card.name)}]을(를) 전장에 ${cardType === 'structure' ? '구축' : '배치'}했습니다. (공 ${entity.attack || 0} / 방 ${entity.defense} / 체 ${entity.maxHp})</span>`);
  }

  triggerArchetypeCombo(card, viewFor(side), helpersFor(side));
  castSkill(side, card, picked, { sourceLabel: '전투의 함성', allowAoe: false });

  renderBattleUI();
  checkBattleStatus();
  return true;
}

/** 시전 대가 — 마나 차감, 손패에서 제거(같은 객체 또는 같은 instanceId), 마지막 시전 기록 */
function spendCard(side, card) {
  side.mana = Math.max(0, side.mana - (card.cost || 0));
  const i = side.hand.findIndex(c => c === card || (card.instanceId && c.instanceId === card.instanceId));
  if (i >= 0) side.hand.splice(i, 1);
  side.lastCastCard = card;
}

/** 상대가 카드를 냈다는 배너 (내 카드는 화면이 보여주므로 배너가 없다) */
function logFoeCast(side, card) {
  const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.dark;
  const cardType = card.cardType || 'unit';
  const who = isPvpActive()
    ? `🌐 ${escapeHtml(getFoeName())}`
    : (card.isUserCard ? '👤 플레이어 제작 카드 기용' : `👹 ${escapeHtml(side.name)}`);
  const typeLabel = cardType === 'unit' ? '⚔️ 소환수' : cardType === 'structure' ? '🏛️ 건축물' : cardType === 'trap' ? '🪤 함정' : '🔮 주문';
  addBattleLog(`
    <div class="p-2 rounded-xl bg-gradient-to-r from-indigo-950/90 to-slate-900/90 border border-cyan-500/60 shadow-lg my-1.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-base">${elCfg.icon}</span>
        <div>
          <div class="text-[10px] text-cyan-300 font-bold">${who}</div>
          <div class="text-xs font-black text-white">${escapeHtml(card.name)}</div>
        </div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-black/60 text-slate-300 font-bold border border-slate-700">${typeLabel}</span>
    </div>
  `);
}

/**
 * 카드의 스킬을 그 진영 기준으로 적용한다. 더블캐스트 예약이 있으면 두 번.
 * 주문(allowAoe)과 전투의 함성(광역 금지)이 이 하나를 공유한다.
 */
function castSkill(side, card, picked, { sourceLabel, allowAoe }) {
  const skill = (card.skills && card.skills[0]) || card.skill || null;
  if (!skill) return;
  const apply = () => applyPlayerSkillEffects(skill,
    { card, game: viewFor(side), helpers: helpersFor(side) }, { sourceLabel, allowAoe, picked });
  apply();
  if (side.buffs.doubleCast) {
    side.buffs.doubleCast = false;
    addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] ${escapeHtml(sideLabel(side))}의 ${sourceLabel}이(가) 2연속 발동합니다!</span>`);
    apply();
  }
}

/** (호환) 플레이어 주문 효과 1회 적용 — castSkill이 더블캐스트까지 처리하므로 새 코드는 그쪽을 쓴다 */
export function triggerSpellEffect(card, picked = null) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;
  applyPlayerSkillEffects(skill, { card, game: viewFor(sides.player), helpers: helpersFor(sides.player) },
    { sourceLabel: '주문', allowAoe: true, picked });
}

/** (호환) 플레이어 전투의 함성 1회 적용 */
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
  if (activeSideKey !== SIDE_PLAYER || state.isAnimating) return;
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

/**
 * 소환수 공격 해결 — **양 진영 공용.** 사람(UI)·PvE 봇·PvP 재생이 전부 여기를 지난다.
 *
 * 🏟️ 전투 규칙은 **해결되는 지점**에서 강제한다 (DECISIONS #80/#81). UI 목록은 편의일 뿐이다.
 *   · 행동 가능(canAttack)·봉쇄·건축물·공격력 0 — 양 진영 같은 거부 조건
 *   · 전장이 비어야 본체 — directAttack만 예외 (canAttackFace)
 *   · 공격 진영 건축물의 공격 오라 + **방어 진영** 건축물의 방어 오라 — 양쪽 다
 *   · 본체 피해는 dealFaceDamage 한 곳, 소환수 피해는 damageEntity 한 곳
 *   · 공격하면 canAttack=false — 한 턴에 두 번 못 친다 (PvP 중복 재생 방어)
 *
 * 🐛 예전엔 두 벌이었다 (resolveMinionAttack / foeMinionAttack + hitPlayerMinion): 상대 쪽은
 *    canAttack을 지우지 않았고, 공격 오라를 안 받았고, 기본 대상에서 directAttack을 무시했으며,
 *    방어 오라는 플레이어 소환수에만 붙었다 (DECISIONS #94).
 *
 * @param side      공격하는 진영(Side)
 * @param slotIdx   그 진영 전장의 슬롯 번호
 * @param targetKey 'face' | 'foe:N' | null(규칙대로 — 전장이 비면 본체, 아니면 최전방)
 * @param opts.attacker 전장에 없는 임시 공격자 (하네스용). 없으면 슬롯에서 찾는다.
 * @returns {boolean} 실제로 공격했는가
 */
export function resolveAttack(side, slotIdx, targetKey = null, { attacker = null } = {}) {
  const foe = sides[opponentOf(side.key)];
  const entity = attacker || (side.minions || [])[slotIdx];
  if (!entity) return false;
  if (side.hp <= 0 || foe.hp <= 0) return false;
  // 🏛️ 건축물은 공격하지 않는다 — 벽으로서 전장을 막는 것이 역할이다. 공격력 0도 마찬가지.
  if (entity.cardType === 'structure' || !(entity.attack > 0)) return false;
  // 💫 봉쇄(기절·빙결) — **플래그만 읽는다.** 소모는 tickMinionStatuses가 턴 시작에 한 번만 한다.
  if (entity.blockedBy) {
    const spec = STATUS_EFFECTS[entity.blockedBy];
    addBattleLog(`<span class="${spec ? spec.color : 'text-slate-400'} font-bold">${spec ? spec.icon : '💫'} [${escapeHtml(entity.name)}]이(가) ${spec ? spec.name : '행동 불가'} 상태로 공격하지 못합니다!</span>`);
    return false;
  }
  if (!entity.canAttack) return false;

  // 🏟️ 전장이 비어야 본체 — 양 진영에 강제. 🗑️ 도발 리다이렉트는 없다 (DECISIONS #84).
  if (targetKey === 'face' && !canAttackFace(foe.minions, entity)) {
    const redirect = selectFrontTarget(foe.minions);
    if (redirect) {
      if (side.key === SIDE_PLAYER) {
        addBattleLog(`<span class="text-amber-300">🏟️ 상대 전장에 소환수가 있어 본체를 칠 수 없습니다 — [${escapeHtml(redirect.name)}]을(를) 먼저 처리하세요.</span>`);
      }
      targetKey = `foe:${foe.minions.indexOf(redirect)}`;
    }
  }
  // 대상 미지정 — 규칙대로: 본체를 칠 수 있으면(전장 비었거나 directAttack) 본체, 아니면 최전방
  if (!targetKey) {
    const front = selectFrontTarget(foe.minions);
    targetKey = (front && !canAttackFace(foe.minions, entity)) ? `foe:${foe.minions.indexOf(front)}` : 'face';
  }

  entity.canAttack = false;
  audio.playSlash();

  // 🌐 PvP: 내 공격은 고른 **대상까지** 보낸다 — 상대 화면이 같은 결과를 내려면 대상이 필요하다.
  if (side.key === SIDE_PLAYER && isPvpActive()) sendPvpAction({ kind: 'attack', slotIdx, targetKey });

  // 🪤 공격에 반응하는 상대 함정
  triggerTraps(side.key, 'attack', entity);
  if (side.hp <= 0 || foe.hp <= 0) return true;   // 함정이 판을 끝냈을 수 있다

  // 🏛️ 전장 오라 보정 — 읽는 시점에 계산한다 (저장하면 건축물이 죽어도 남는다)
  const finalAtk = entity.attack + auraAttackBonus(entity, side);

  if (targetKey === 'face') {
    dealFaceDamage(foe, finalAtk, { source: entity.name, attacker: side });
  } else {
    const idx = parseInt(String(targetKey).split(':')[1], 10);
    // 고른 뒤 함정 등으로 판이 바뀌었을 수 있다 — 없으면 규칙대로 최전방, 그것도 없으면 본체
    const target = (foe.minions || [])[idx] || selectFrontTarget(foe.minions);
    if (!target) {
      dealFaceDamage(foe, finalAtk, { source: entity.name, attacker: side });
    } else {
      const hit = damageEntity(target, finalAtk, { defBonus: auraDefenseBonus(target, foe) });
      addBattleLog(`<span class="text-amber-300">⚔️ [${escapeHtml(entity.name)}] ➔ [${escapeHtml(target.name)}] 타격! (${hit.dealt} 피해)${describeDamageExtras(hit)}</span>`);
      if (hit.died) {
        addBattleLog(`<span class="text-red-400 font-bold">💥 [${escapeHtml(target.name)}] 처치!</span>`);
        foe.minions = removeDead(foe.minions);
      }
    }
  }

  renderBattleUI();
  checkBattleStatus();
  return true;
}

/** 대상이 정해진 뒤의 플레이어 공격 처리 — resolveAttack(sides.player, …)의 옛 이름 */
export function resolveMinionAttack(slotIdx, targetKey) {
  return resolveAttack(sides.player, slotIdx, targetKey);
}

/**
 * 상대 소환수 한 기의 공격 — resolveAttack(sides.boss, …)의 옛 이름.
 * @param minion 전장에 없는 임시 공격자 (하네스용). 없으면 슬롯에서 찾는다.
 */
export function foeMinionAttack(slotIdx, minion = null, targetKey = null) {
  return resolveAttack(sides.boss, slotIdx, targetKey, { attacker: minion });
}

/**
 * 본체 피해 — **양 진영 공용.** 플레이어 본체든 상대 본체든 같은 순서로 같은 규칙을 지난다.
 *
 * 순서: 무적 → 경감(버프 + 그 진영 건축물 오라, 합 75% 상한) → 취약 → 감전 → 관통(명시 또는
 *       **때린 진영**의 관통 버프 소모) → 방어막 → 체력 → 절반 하락 함정 → 가시 반사 → 낮은 체력 훅.
 *
 * 🐛 예전엔 두 벌이었다 — dealDamageToBoss(무적·경감 없음, 관통은 플레이어 버프만, 가시는 보스만)와
 *    applyDirectDamageToPlayer(가시·격노 없음, 관통 버프 안 봄). 그래서 상대가 무적·경감·관통을
 *    얻는 효과는 아무 일도 하지 않았고, 보스가 세트한 selfLowHp 함정은 영영 터지지 않았다.
 *    → DECISIONS #94
 *
 * @param target        맞는 진영(Side)
 * @param opts.pierce   방어막을 무시하는 피해인가 (관통 주문·스텝)
 * @param opts.source   로그에 찍을 출처
 * @param opts.attacker 때린 진영(Side) — 관통 버프 소모·가시 반사의 대상. 없으면 둘 다 생략된다.
 * @param opts.reflected 가시 반사로 온 피해인가 — 반사는 되반사하지 않는다
 * @returns {number} 실제로 체력에서 깎인 값
 */
export function dealFaceDamage(target, dmg, { pierce = false, source = '', attacker = null, reflected = false } = {}) {
  if (!target) return 0;
  const label = sideLabel(target);
  const tb = target.buffs;

  if (tb.invulnerable > 0) {
    addBattleLog(`<span class="text-cyan-300 font-bold">🛡️ ${escapeHtml(label)}의 무적 결계가 피해를 완전 무효화했습니다!</span>`);
    return 0;
  }

  let remaining = Math.max(0, Math.floor(dmg));

  // 🛡️ 피해 경감 — 취약 배율보다 **먼저** 적용한다 ("방어를 뚫고 약점을 노린다"는 감각).
  //    주문으로 건 일시적 경감(버프)과 그 진영 건축물 오라를 **합산**한다.
  const auraCut = auraDamageReduction(target);
  const buffCut = (tb.damageReduction > 0 && tb.damageReductionTurns > 0) ? tb.damageReduction : 0;
  const totalCutPct = Math.min(75, buffCut + auraCut);
  if (totalCutPct > 0) {
    const cut = Math.floor(remaining * (totalCutPct / 100));
    if (cut > 0) {
      remaining -= cut;
      const src = auraCut > 0 && buffCut > 0 ? '주문+건축물' : (auraCut > 0 ? '건축물 오라' : '피해 경감');
      addBattleLog(`<span class="text-cyan-300">🛡️ [${src} ${totalCutPct}%] ${escapeHtml(label)}이(가) ${cut} 피해를 막아냈습니다. (${remaining} 관통)</span>`);
    }
  }

  // 💥 취약 (status-effects가 단일 소스 — 턴마다 정상 감쇠된다)
  const mult = getIncomingDamageMultiplier(target.statuses);
  if (mult !== 1) {
    remaining = Math.floor(remaining * mult);
    addBattleLog(`<span class="text-purple-300">💥 [취약] ${escapeHtml(label)}이(가) 받는 피해가 증폭되었습니다! (x${mult})</span>`);
  }

  // ⚡ 감전: 피격될 때마다 추가 연쇄 피해
  const shockBonus = getOnHitBonusDamage(target.statuses);
  if (shockBonus > 0) {
    remaining += shockBonus;
    addBattleLog(`<span class="text-amber-300">⚡ [감전 연쇄] ${escapeHtml(label)}에게 추가 번개 피해 +${shockBonus}!</span>`);
  }

  // 🎯 관통 — 명시된 관통이거나, **때린 진영**이 연계로 예약한 관통 버프를 소모한다.
  //    🐛 예전엔 플레이어 버프만 읽었다 — 상대가 관통 버프를 얻어도 죽은 버프였다.
  let piercing = !!pierce;
  if (!piercing && attacker && attacker.buffs && attacker.buffs.pierceShield) {
    attacker.buffs.pierceShield = false;
    piercing = true;
    addBattleLog(`<span class="text-purple-400 font-bold">🎯 [실드 관통] ${escapeHtml(label)}의 방어막을 무시하고 직격합니다!</span>`);
  } else if (piercing) {
    addBattleLog(`<span class="text-purple-400 font-bold">🎯 [실드 관통] 공격이 ${escapeHtml(label)}의 방어막을 무시하고 체력을 직접 타격합니다!</span>`);
  }

  if (!piercing && target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) {
      addBattleLog(target.shield === 0
        ? `<span class="text-slate-300">🛡️ ${escapeHtml(label)}의 방어막이 ${absorbed} 피해를 흡수하고 파괴되었습니다!</span>`
        : `<span class="text-slate-300">🛡️ ${escapeHtml(label)}의 방어막이 ${absorbed} 피해를 흡수했습니다. (잔여 ${target.shield})</span>`);
    }
  }

  if (remaining <= 0) return 0;

  const wasAbove = target.hp > target.maxHp * 0.5;
  target.hp -= remaining;
  addBattleLog(`<span class="text-red-500 font-bold">🩸 ${source ? `[${escapeHtml(source)}] ` : ''}${escapeHtml(label)}에게 ${remaining} 피해!</span>`);

  if (target.key === SIDE_BOSS) {
    // 🐛 예전엔 존재하지 않는 #boss-card를 찾아 흔들림 연출이 한 번도 나오지 않았다
    const face = document.getElementById('boss-container');
    if (face) {
      face.classList.add('animate-shake');
      setTimeout(() => face.classList.remove('animate-shake'), 400);
    }
  }

  // 🪤 절반 아래로 **떨어지는 순간**에만 그 진영의 함정(selfLowHp)이 반응한다 — 양 진영 다.
  //    (함정은 상대 행동에 반응하므로 actor = 상대 진영)
  //    🐛 예전엔 플레이어 본체에서만 쐈다 — 보스가 세트한 selfLowHp 함정은 영영 터지지 않았다.
  if (wasAbove && target.hp <= target.maxHp * 0.5 && target.hp > 0) {
    triggerTraps(opponentOf(target.key), 'damaged', null);
  }

  // 🌵 가시 반사 — 때린 진영에게 되돌린다. 반사 피해는 다시 반사되지 않는다.
  if (tb.thorns > 0 && attacker && !reflected) {
    const reflectDmg = Math.max(1, Math.floor(remaining * tb.thorns));
    addBattleLog(`<span class="text-emerald-400 font-bold">🌵 [가시 반사] ${escapeHtml(label)}의 결계가 ${reflectDmg} 피해를 ${escapeHtml(sideLabel(attacker))}에게 반사했습니다!</span>`);
    dealFaceDamage(attacker, reflectDmg, { reflected: true, source: '가시 반사' });
  }

  onFaceLowHp(target);
  return remaining;
}

/** 본체가 낮은 체력에 들어섰을 때의 훅 — 봇 컨트롤러가 격노(2페이즈)를 판단한다 (원격 상대에겐 없다) */
function onFaceLowHp(target) {
  if (target.key !== SIDE_BOSS || target.controller !== 'bot') return;
  if (botController.onLowHp(target)) {
    // 🐛 이 배지는 만들어진 뒤 한 번도 켜진 적이 없었다 (index.html의 #boss-phase-badge)
    const badge = document.getElementById('boss-phase-badge');
    if (badge) badge.classList.remove('hidden');
  }
}

/** 상대 본체에 피해 (플레이어가 때린다). dealFaceDamage(sides.boss, …)의 옛 이름 — 효과·연계·하네스가 부른다. */
export function dealDamageToFoe(dmg, sourceName) {
  return dealFaceDamage(sides.boss, dmg, { source: sourceName, attacker: sides.player });
}

export function playerEndTurn() {
  if (activeSideKey !== SIDE_PLAYER || state.isAnimating) return;
  activeSideKey = SIDE_BOSS;

  // 턴 종료 — 양 진영 공용 (건축물 턴 종료 패시브)
  endTurn(sides.player);
  renderBattleUI();

  // 🌐 PvP: 상대가 다음 턴을 진행한다. 스크립트 AI를 돌리면 안 된다.
  //    상대의 endTurn 메시지가 오면 startPlayerTurn()이 호출된다.
  if (isPvpActive()) {
    endMyPvpTurn();
    addBattleLog(`<span class="text-cyan-300">⏳ ${escapeHtml(getFoeName())}의 턴을 기다리는 중...</span>`);
    // 🪞 상대의 턴 시작을 **내 화면에서도** 돈다 — 마나 성장·버프 감소·상태 감쇠·후유증 해제·패시브.
    //    🐛 예전엔 이게 없어 PvP 상대의 마나는 1에 머물고, 버프는 영구였고, 소환수는 후유증에서
    //       풀리지 않았다. 드로우만 뽑지 않는다(원격) — 카드 정체는 상대 액션에 실려 온다.
    startTurn(sides.boss);
    renderBattleUI();
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

/**
 * 지금 살아 있는 **그 진영** 건축물의 오라 목록.
 * 🐛 예전엔 state.playerMinions만 훑어 상대 건축물의 오라는 존재하지 않았다 (DECISIONS #94).
 */
function collectAuras(side = sides.player) {
  const out = [];
  (side.minions || []).forEach(e => {
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

/** 그 진영 소환수가 오라로 얻는 공격력 보정 (side = 그 소환수의 진영, 기본 플레이어) */
export function auraAttackBonus(entity, side = sides.player) {
  return collectAuras(side)
    .filter(a => a.attackBonus > 0 && auraApplies(a, entity))
    .reduce((s, a) => s + a.attackBonus, 0);
}

/** 그 진영 소환수가 오라로 얻는 방어력 보정 */
export function auraDefenseBonus(entity, side = sides.player) {
  return collectAuras(side)
    .filter(a => a.defenseBonus > 0 && auraApplies(a, entity))
    .reduce((s, a) => s + a.defenseBonus, 0);
}

/**
 * 본체가 오라로 얻는 피해 경감 (%).
 * 여러 장이 겹치면 합산하되 **75%를 넘지 않는다** — 무적이 되면 게임이 끝난다.
 */
export function auraDamageReduction(side = sides.player) {
  const sum = collectAuras(side)
    .filter(a => a.damageReduction > 0)
    .reduce((s, a) => s + a.damageReduction, 0);
  return Math.min(75, sum);
}

/** 오라 정보를 UI/카드 상세에 보여주기 위한 요약 */
export function describeActiveAuras(side = sides.player) {
  return collectAuras(side).map(a => ({
    from: a.src.name,
    scope: a.scope,
    attackBonus: a.attackBonus || 0,
    defenseBonus: a.defenseBonus || 0,
    damageReduction: a.damageReduction || 0
  }));
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
  const spec = STATUS_EFFECTS[type];
  // 🚫 행동 봉쇄(기절·빙결)는 본체에 **절대** 걸리지 않는다 — bodyStatus로도 못 산다.
  //    한 턴을 통째로 빼앗기는 건 게임이 아니라 벌칙이고, 양 진영 같은 규칙이어야 한다.
  //    🐛 예전엔 보스 본체만 기절할 수 있었다(플레이어가 템포를 사는 수단) — 비대칭 → DECISIONS #94
  //    지속 피해(화상·맹독)는 bodyStatus 할증을 치르면 본체에 걸 수 있다. 그건 이미 대칭이다.
  const bodyOk = !isEntityOnly(type) || (allowBody && !(spec && spec.blocksTurn));
  if (bodyOk) {
    return applyStatus(statuses, type, turns, value);
  }
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

/** 로그용 진영 이름 — 플레이어는 '플레이어', 상대는 실제 이름(보스/원격 프로필) */
function sideLabel(side) {
  return side.key === SIDE_PLAYER ? '플레이어' : side.name;
}

/**
 * 건축물 턴 종료 패시브 — **양 진영 공용**.
 * 🐛 예전엔 state.playerMinions만 돌아 상대 건축물은 방어막도 회복도 없는 순수한 벽이었다 (DECISIONS #94).
 */
export function triggerStructureEndTurnPassives(side = sides.player) {
  side.minions.forEach(entity => {
    if (entity.cardType === 'structure' && entity.skills && entity.skills[0] && entity.skills[0].passiveEffect) {
      const p = entity.skills[0].passiveEffect;
      if (p.endTurnShield) {
        side.shield += p.endTurnShield;
        addBattleLog(`<span class="text-blue-300">🏛️ [${escapeHtml(entity.name)}] 패시브: ${sideLabel(side)} 방어막 +${p.endTurnShield} 충전!</span>`);
      }
      if (p.endTurnAoeShield) {
        side.shield += p.endTurnAoeShield;
        entity.currentHp = Math.min(entity.maxHp, entity.currentHp + (p.endTurnAoeHeal || 5));
        addBattleLog(`<span class="text-blue-300">🏛️ [${escapeHtml(entity.name)}] 성벽 가호: 방어막 +${p.endTurnAoeShield} & 내구도 수리!</span>`);
      }
      if (p.endTurnAoeHeal) {
        side.hp = Math.min(side.maxHp, side.hp + p.endTurnAoeHeal);
        addBattleLog(`<span class="text-emerald-300">💖 [${escapeHtml(entity.name)}] 생명력 회복: ${sideLabel(side)} +${p.endTurnAoeHeal} HP</span>`);
      }
    }
  });
}

/** 건축물 턴 시작 패시브 — **양 진영 공용** (마나 공급 등) */
export function triggerStructureStartTurnPassives(side = sides.player) {
  side.minions.forEach(entity => {
    if (entity.cardType === 'structure' && entity.skills && entity.skills[0] && entity.skills[0].passiveEffect) {
      const p = entity.skills[0].passiveEffect;
      if (p.manaPerTurn) {
        side.mana = Math.min(10, side.mana + p.manaPerTurn);
        addBattleLog(`<span class="text-blue-400 font-bold">💎 [${escapeHtml(entity.name)}] 마나 수정탑: ${sideLabel(side)} 추가 마나 +${p.manaPerTurn} 공급!</span>`);
      }
    }
  });
}

// 👹 보스 멀티 액션 콤보 턴 실행기
/**
 * PvE 봇의 턴 — boss-ai.js의 컨트롤러가 판단하고, 모든 행동은 applyFoeAction을 지난다.
 * 여기 남은 것은 입력 잠금(isAnimating)과 다음 턴 예약(핸드오프)뿐이다.
 *
 * 🐛 예전엔 이 함수가 보스 턴 전체를 들고 있었다 — 턴 시작 사본, 카드 선택, 보스 전용 시전기,
 *    콤보 스텝, 보스 전용 공격, 턴 끝 감쇠. 그 사본들이 규칙을 다시 쓰며 갈라졌다 (DECISIONS #94).
 *
 * @param handOff false면 다음 턴을 예약하지 않는다 (하네스)
 * @param pace    봇 액션 사이 간격(ms). 생략하면 BOT_PACE_MS, 하네스는 0.
 */
export async function executeBossTurn({ handOff = true, pace } = {}) {
  state.isAnimating = true;
  try {
    await botController.takeTurn(pace === undefined ? {} : { pace });
  } finally {
    if (handOff && !isGameOver()) {
      setTimeout(() => startPlayerTurn(), 250);
    } else {
      state.isAnimating = false;
    }
  }
}

/**
 * 🌐🤖 상대 행동의 **단일 파이프.** PvP 원격 상대의 액션과 PvE 봇의 액션이 똑같이 여기를 지난다.
 * 규칙 함수(playCardFor / resolveAttack / endTurn·startTurn)로 넘기기만 하고, 스스로 규칙을 쓰지 않는다.
 *
 * kinds:
 *   playCard  { instanceId, card, slot, picked } — 손패에서 정체로 찾는다. 원격은 스냅샷 폴백 + trusted
 *   attack    { slotIdx, targetKey }
 *   comboStep { step }  — 봇 컨트롤러일 때만. 원격 피어가 스텝을 주입할 수 없다.
 *   endTurn   — 상대 턴 종료 → 내 턴 시작
 *   surrender
 * @returns {Promise<boolean>} 적용됐는가
 */
export async function applyFoeAction(action) {
  if (!action || !action.kind) return false;
  const foe = sides.boss;
  const remote = foe.controller === 'remote';

  switch (action.kind) {
    case 'playCard': {
      let card = null;
      if (!remote && action.card && foe.hand.includes(action.card)) card = action.card;   // 봇은 손패 객체를 직접 준다
      if (!card && action.instanceId) {
        card = foe.hand.find(c => c.instanceId === action.instanceId || c.id === action.instanceId) || null;
      }
      if (!card && action.card && remote) {
        // 덱 셔플이 어긋난 상황에서도 대전이 멈추지는 않게 한다 (8단계에서 좌석 덱으로 뿌리를 뽑는다)
        console.warn('[PvP] 상대 카드를 손패에서 찾지 못해 스냅샷으로 재생합니다:', action.instanceId);
        card = action.card;
      }
      if (!card) return false;
      return playCardFor(foe, card, { slot: Number.isInteger(action.slot) ? action.slot : null, picked: action.picked || null, trusted: remote });
    }
    case 'attack':
      return resolveAttack(foe, action.slotIdx, action.targetKey || null);
    case 'comboStep': {
      if (foe.controller !== 'bot') {
        console.warn('[대전] 봇이 아닌 상대의 comboStep은 무시합니다.');
        return false;
      }
      await botController.executeStep(action.step || {});
      return true;
    }
    case 'endTurn':
      // 상대 턴이 끝났다 → 상대의 턴 종료(건축물 패시브)를 내 화면에서도 돌리고 내 턴 시작
      endTurn(foe);
      startPlayerTurn();
      return true;
    case 'surrender':
      addBattleLog(`<span class="text-emerald-300 font-bold">🏳️ ${escapeHtml(foe.name)}이(가) 항복했습니다. 승리!</span>`);
      foe.hp = 0;
      renderBattleUI();
      checkBattleStatus();
      return true;
    default:
      console.warn('[대전] 알 수 없는 행동:', action.kind);
      return false;
  }
}

/**
 * 상대 카드를 **관문 없이** 시전한다 — playCardFor(sides.boss, …, {trusted:true})의 옛 이름.
 * 대상은 봇 정책(최전방 우선)으로 고른다.
 * ⚠️ 봇의 실제 경로는 executeBossTurn이 playCardFor를 관문 **있이** 부른다.
 *    이 이름은 하네스·디버그용으로만 남는다. 🐛 예전엔 여기에 보스 전용 시전기(스탯 재작성·
 *    효과 13종 흉내·함정 즉발·광역 ×0.7·만석 +2)가 통째로 있었다 (DECISIONS #94).
 */
export async function playBossCard(card) {
  return playCardFor(sides.boss, card, { picked: botController.chooseTargets(card), trusted: true });
}

/**
 * 턴 시작 — **양 진영 공용.** 플레이어·PvE 봇·PvP 상대(내 화면의 거울)가 전부 이 함수를 지난다.
 *
 * 순서: 리더면 turnCount++ → 버프 감소(무적·경감·가시) → 본체 지속 피해 → 상태 감쇠 → 사망 확인
 *       → 마나 성장 → 소환수 상태 처리 → 후유증 해제 → 건축물 턴 시작 패시브 → 드로우 1장.
 *
 * 🐛 예전엔 플레이어 버전(startPlayerTurn)과 보스 버전(executeBossTurn 앞부분)이 따로 있었고
 *    보스 버전에는 버프 감소·건축물 패시브가 없었으며 상태 감쇠는 턴 **끝**에 했다. PvP 상대는
 *    아무것도 돌지 않았다 (DECISIONS #94).
 *
 * ⚠️ 상태 감쇠는 여기 한 곳(그 진영의 턴 시작)에서만 한다. 봉쇄 상태이상은 본체에 걸리지
 *    않으므로(applyStatusRespectingScope) 본체 턴 스킵 분기는 없다.
 *
 * @returns {boolean} 살아서 턴을 이어가는가. false면 본체가 지속 피해로 쓰러졌다.
 */
export function startTurn(side) {
  const label = sideLabel(side);
  activeSideKey = side.key;
  // 🎲 라운드 카운터는 리더의 턴 시작에만 오른다 — 양 진영이 같은 turnCount로 마나를 키운다
  if (side.key === leaderKey) state.turnCount++;

  // 버프 틱 차감 — 한 번 걸면 전투 내내 유지되지 않도록
  const b = side.buffs;
  if (b.invulnerable > 0) b.invulnerable--;
  if (b.damageReductionTurns > 0) {
    b.damageReductionTurns--;
    if (b.damageReductionTurns === 0) {
      const was = b.damageReduction;
      b.damageReduction = 0;
      if (was > 0) addBattleLog(`<span class="text-slate-400">🛡️ ${escapeHtml(label)}의 피해 경감 효과가 사라졌습니다.</span>`);
    }
  }
  // 🌵 가시(피해 반사)도 턴제다 — 예전엔 보스 전용·영구였다
  if (b.thornsTurns > 0) {
    b.thornsTurns--;
    if (b.thornsTurns === 0 && b.thorns > 0) {
      b.thorns = 0;
      addBattleLog(`<span class="text-slate-400">🌵 ${escapeHtml(label)}의 가시 결계가 사라졌습니다.</span>`);
    }
  }

  // 🔥 본체 지속 피해(화상/맹독) → 상태이상 1턴 감쇠. 지속 피해는 방어막을 무시한다.
  applyDamageOverTime(side.statuses, { label, onDamage: (dmg) => { side.hp -= dmg; } });
  reportExpiredStatuses(decayStatuses(side.statuses), label);

  if (side.hp <= 0) {
    renderBattleUI();
    checkBattleStatus();
    return false;
  }

  // 💎 정통 TCG 룰: 턴 수에 맞춰 마나 최대치가 1씩 성장 (턴 1: 1마나, 턴 2: 2마나...)
  growMana(side, state.turnCount);

  // 💫 소환수 상태이상 처리 (지속 피해 → 봉쇄 소모 → 감쇠)
  //    ⚠️ refreshMinions **앞에** 와야 한다. refreshMinions는 여기서 세운 `m.blockedBy`를 읽는다.
  tickMinionStatuses(side.minions, side.key === SIDE_PLAYER ? '내' : '상대');
  refreshMinions(side);

  // 🏛️ 건축물 턴 시작 패시브 (마나 공급 등) — 상대 건축물도 일한다
  triggerStructureStartTurnPassives(side);

  // 📥 드로우 1장 — 원격 상대도 뽑는다. 좌석 덱은 양 클라이언트에서 순서가 같으므로
  //    내 화면의 거울이 뽑는 카드가 곧 상대가 실제로 뽑은 카드다 (손패 내용은 UI가 숨긴다).
  drawFor(side, 1);
  return true;
}

/** 턴 종료 — **양 진영 공용** (건축물 턴 종료 패시브) */
export function endTurn(side) {
  triggerStructureEndTurnPassives(side);
  addBattleLog(`<span class="text-slate-400">--- ${escapeHtml(sideLabel(side))} 턴 종료 ---</span>`);
}

/** 플레이어 턴 시작 — startTurn(sides.player) + 내 화면 갱신 */
export function startPlayerTurn() {
  state.isAnimating = false;
  if (!startTurn(sides.player)) return;
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

  if (!sides || sides.boss.controller !== 'bot') {
    // 원격 상대(PvP)에는 스크립트 패턴이 없다. 표시할 것도 없다. 판단 주체는 컨트롤러다 — 모드 플래그가 아니다.
    intentEl.innerHTML = '';
    return;
  }

  // 🐛 예전엔 50%에서 "격노"라 썼지만 실제 격노(2페이즈)는 40%였다 — 봇 컨트롤러의 상태를 그대로 보인다
  const enraged = botController.phase === 2;
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
// 🌐 원격 상대의 액션은 봇과 **같은 파이프**로 들어온다 (applyFoeAction).
registerPvpHandlers({
  applyFoeAction: (action) => applyFoeAction(action)
});

// ============================================================
// 🌐 PvP 전용 카드 해석 — 보스 경로를 쓰지 않는다
// ------------------------------------------------------------
// playBossCard()는 **PvE 전용**이다. 보스는 스크립트 패턴으로 싸우도록
// 일부러 다르게 만들어져 있다:
//   · 소환수의 전투의 함성을 발동하지 않는다
//   · 주문 피해에 ×0.7 감산이 붙는다
//   · (예전) 보스 전용 콤보 구현을 썼다 — 지금은 거울 뷰로 같은 구현을 돈다 (DECISIONS #94)
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
 * 상대(원격 플레이어)가 낸 카드를 내 화면에서 해석한다 — playCardFor(sides.boss, …, {trusted:true})의 옛 이름.
 * 원격은 그쪽 클라이언트가 관문을 통과시킨 카드이므로 여기서는 경고만 하고 그대로 재생한다.
 * 🐛 예전엔 여기 별도 시전기가 있었다 — 관문·마나 차감이 없고 슬롯 상한도 따로 하드코딩됐다 (DECISIONS #94).
 */
export async function playFoeCardPvp(card, slot = null, picked = null) {
  return playCardFor(sides.boss, card, { slot, picked, trusted: true });
}
