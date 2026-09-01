// battle-engine.js - 정통 카드 배틀 엔진 (소환수 / 주문 / 건축물 & 보스 멀티액션)

import { ELEMENT_CONFIG } from './config.js';
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
  damageEntity, removeDead
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

export const BATTLE_SLOTS = 4;
export const BOSS_SLOTS = 3;

let isPlayerTurn = true;
let bossPhase = 1;

// 상태이상은 status-effects.js가 단일 소스. { [type]: {turns, value} } 형태.
let bossStatus = createStatusState();
let playerStatus = createStatusState();

let playerBuffs = createBuffs();
let bossBuffs = createBuffs();

// 진영 접근자. 저장 구조는 그대로 두고 대칭 인터페이스만 씌운다.
// 새 전투 로직은 state.playerHp가 아니라 sides.player.hp를 쓰세요.
let sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs });

// 🪤 세트된 함정. 진영별로 분리해 관리한다.
// 상대의 행동에만 반응하므로 소유자를 알아야 한다.
let trapZones = { player: [], boss: [] };

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

// 카드군 콤보 / 스킬 효과에 넘기는 헬퍼 묶음.
// 이전에는 이 객체 리터럴이 playCard 안에 두 번 그대로 복붙돼 있었다.
function makeComboHelpers() {
  return {
    addBattleLog,
    audio,
    dealDamageToBoss,
    drawCards,
    // 💫 소환수 전용 상태이상(기절·빙결·화상·맹독)은 본체에 걸리지 않는다.
    //    관문이 상대 전장의 최전방 소환수로 돌린다.
    setBossStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(bossStatus, state.bossMinions, '상대', type, turns, value, allowBody),
    setPlayerStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(playerStatus, state.playerMinions, '내', type, turns, value, allowBody),
    setPlayerBuff: (type, val) => { playerBuffs[type] = val; },
    foeLabel: isPvpActive() ? getFoeName() : '보스',
    onShielded: () => triggerTraps('player', 'shielded', null),
    foeHp: () => state.currentBoss ? state.currentBoss.currentHp : 0,
    foeMaxHp: () => state.currentBoss ? state.currentBoss.maxHp : 0
  };
}

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
  state.playerHp = 50;
  state.playerMaxHp = 50;
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

  // 속성에 맞는 보스 시작 호위병 2마리 배치
  const el = state.currentBoss.element || 'fire';
  const minionPool = (ELEMENT_BOSS_MINIONS && ELEMENT_BOSS_MINIONS[el]) ? ELEMENT_BOSS_MINIONS[el] : BOSS_ADD_POOL;
  
  state.bossMinions = [
    { ...minionPool[0], currentHp: minionPool[0].maxHp },
    { ...(minionPool[1] || minionPool[0]), currentHp: (minionPool[1] || minionPool[0]).maxHp }
  ];

  bossStatus = createStatusState();
  playerStatus = createStatusState();
  playerBuffs = createBuffs();
  bossBuffs = createBuffs();
  sides = createSides({ playerStatus, bossStatus, playerBuffs, bossBuffs });
  trapZones = { player: [], boss: [] };

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
    if (state.playerHand.length >= 7) {
      addBattleLog(`<span class="text-red-400">손패가 가득 차 카드를 더 뽑을 수 없습니다! (최대 7장)</span>`);
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
        bmEl.onclick = () => {
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
          ${bm.taunt ? '<span class="absolute -top-2 -right-1 px-1 bg-amber-500 text-black font-black text-[8px] rounded">도발</span>' : ''}
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
    for (let slot = 0; slot < BATTLE_SLOTS; slot++) {
      const entity = state.playerMinions[slot];
      if (entity) {
        fieldContainer.appendChild(createMinionFieldElement(entity, slot, synergyInfo));
      } else {
        // 🎯 빈 슬롯을 눌러 두면 다음에 내는 소환수가 **그 자리**에 들어간다.
        //    0번이 적의 공격을 먼저 받으므로 앞뒤 배치가 전술이 된다.
        const armed = _pendingSummonSlot === slot;
        const emptySlot = document.createElement('div');
        emptySlot.className = `h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-xs gap-1 transition cursor-pointer ${
          armed ? 'border-amber-400 bg-amber-500/10 text-amber-300 ring-2 ring-amber-400/60'
                : 'border-slate-700/60 bg-black/30 text-slate-600 hover:border-amber-500/60 hover:text-amber-400'}`;
        emptySlot.innerHTML = `<i data-lucide="${armed ? 'target' : 'plus-circle'}" class="w-6 h-6 ${armed ? '' : 'opacity-40'}"></i>
          <span>${armed ? '여기에 배치' : `슬롯 ${slot + 1}`}</span>`;
        emptySlot.title = '이 자리를 지정한 뒤 카드를 내면 여기에 배치됩니다 (앞자리일수록 먼저 맞습니다)';
        emptySlot.onclick = () => {
          _pendingSummonSlot = (_pendingSummonSlot === slot) ? null : slot;
          renderBattleUI();
        };
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
  const auraAtk = auraAttackBonus(entity);
  const displayAtk = entity.attack + auraAtk;

  div.className = `relative h-36 rounded-xl p-2 bg-gradient-to-b ${isStructure ? 'from-amber-950/90 via-stone-900 to-black border-amber-600/70' : elCfg.bg + ' ' + elCfg.border} border-2 ${inArchetypePlay ? 'ring-1 ring-amber-500/60' : ''} ${canAtk ? 'border-amber-400 shadow-lg shadow-amber-500/40 cursor-pointer animate-pulse' : ''} flex flex-col justify-between overflow-hidden select-none transition hover:scale-105`;

  const typeIcon = isStructure ? '🏛️' : elCfg.icon;
  const typeTag = isStructure ? '<span class="text-[9px] text-amber-300 font-bold bg-amber-950/80 px-1 rounded">성물</span>' : '';
  const frozenTag = entity.frozen ? '<div class="absolute inset-0 bg-cyan-900/60 flex items-center justify-center font-black text-cyan-200 text-xs z-20">❄️ 빙결됨</div>' : '';

  div.innerHTML = `
    ${frozenTag}
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
      ${isStructure ? '<span class="text-amber-400 flex items-center gap-0.5">🏛️ 성물</span>' : `<span class="text-red-400 flex items-center gap-0.5">⚔️ ${displayAtk}</span>`}
      <span class="text-blue-400 flex items-center gap-0.5">🛡️ ${entity.defense || 0}</span>
      <span class="text-emerald-400 flex items-center gap-0.5">❤️ ${entity.currentHp}/${entity.maxHp}</span>
    </div>
  `;

  if (canAtk) {
    div.onclick = () => { hideCardDetail(); attackWithMinion(slotIdx); };
  }

  // 🎯 이 카드 **앞에** 끼워 넣기.
  //    빈 슬롯만으로는 뒤에 붙이는 것밖에 못 한다. 앞자리는 적의 공격을
  //    먼저 받는 자리라 "앞에 세우기"가 전술의 핵심이다.
  if (state.playerMinions.length < BATTLE_SLOTS) {
    const armed = _pendingSummonSlot === slotIdx;
    const grip = document.createElement('button');
    grip.className = `absolute left-0 inset-y-0 w-2.5 z-30 rounded-l-xl transition ${
      armed ? 'bg-amber-400/90' : 'bg-amber-400/0 hover:bg-amber-400/60'}`;
    grip.title = `여기(앞)에 다음 소환수를 배치 — ${slotIdx + 1}번 자리`;
    grip.onclick = (e) => {
      e.stopPropagation();          // 공격 클릭과 섞이면 안 된다
      hideCardDetail();
      _pendingSummonSlot = armed ? null : slotIdx;
      renderBattleUI();
    };
    div.appendChild(grip);
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
      applyPlayerSkillEffects(skill, { card: trap, game: state, helpers: makeComboHelpers() },
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
    state.playerMana -= card.cost;
    state.playerHand.splice(handIdx, 1);
    audio.playMagic();

    addBattleLog(`<span class="text-purple-400 font-bold">🔮 [주문 발동] ${card.name}!</span>`);
    
    // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
    triggerArchetypeCombo(card, state, makeComboHelpers());

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

  state.playerMana -= card.cost;
  state.playerHand.splice(handIdx, 1);
  audio.playSummon();

  const entity = {
    ...card,
    instanceId: card.instanceId || `${card.id}#field${state.playerMinions.length}`,
    maxHp: card.hp || 30,
    currentHp: card.hp || 30,
    defense: card.defense || 0,
    canAttack: false, // 소환 후유증
    frozen: false
  };

  // 🎯 배치 위치. **맨 앞(0번)이 적의 공격을 먼저 받는다** — 위치가 곧 전술이다.
  //    `_pendingSummonSlot`은 슬롯을 눌러 카드를 낸 경우에만 채워진다.
  //    (그냥 카드를 클릭하면 예전처럼 맨 뒤에 붙는다 — 매번 묻지 않는다)
  const at = Number.isInteger(_pendingSummonSlot)
    ? Math.max(0, Math.min(state.playerMinions.length, _pendingSummonSlot))
    : state.playerMinions.length;
  _pendingSummonSlot = null;
  state.playerMinions.splice(at, 0, entity);

  if (cardType === 'structure') {
    addBattleLog(`<span class="text-amber-400 font-bold">🏛️ [건축물 건립] [${card.name}] 을(를) 전장에 구축했습니다! (내구도: ${entity.maxHp})</span>`);
  } else {
    addBattleLog(`<span class="text-cyan-400 font-bold">✨ [소환수 출진] [${card.name}] 을(를) 전장에 소환했습니다!</span>`);
  }

  // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
  triggerArchetypeCombo(card, state, makeComboHelpers());

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
  applyPlayerSkillEffects(skill, { card, game: state, helpers: makeComboHelpers() },
    { sourceLabel: '주문', allowAoe: true, picked });
}

export function triggerBattlecry(card, picked = null) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;
  applyPlayerSkillEffects(skill, { card, game: state, helpers: makeComboHelpers() },
    { sourceLabel: '전투의 함성', allowAoe: false, picked });
}

/**
 * 아군 소환수의 공격.
 *
 * 🎯 예전에는 늘 최전방을 자동으로 때렸다. 카드 설명은 "적 하나를 지정해"처럼
 *    읽히는데 실제로는 고를 수 없어 위화감이 컸다.
 *    이제 고를 수 있는 대상이 둘 이상이면 **대상 선택 모드**로 들어간다.
 *
 * 도발(taunt)이 있으면 도발만 유효 대상이다 — 규칙은 그대로다.
 * 고를 여지가 없으면(대상 1개) 예전처럼 즉시 처리한다.
 */
export function attackWithMinion(slotIdx) {
  if (!isPlayerTurn || state.isAnimating) return;
  if (isTargeting()) { cancelTargeting(); return; }
  const entity = state.playerMinions[slotIdx];
  if (!entity || !entity.canAttack || entity.cardType === 'structure' || entity.frozen) return;

  const alive = (state.bossMinions || []).filter(m => m && m.currentHp > 0);
  const taunts = alive.filter(m => m.taunt);
  const pickable = taunts.length > 0 ? taunts : alive;

  // 도발이 없으면 본체도 노릴 수 있다
  const keys = pickable.map(m => `foe:${state.bossMinions.indexOf(m)}`);
  if (taunts.length === 0) keys.push('face');

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
      const { died, dealt, blocked } = damageEntity(target, finalAtk);
      addBattleLog(`<span class="text-amber-300">⚔️ [${escapeHtml(entity.name)}] ➔ [${escapeHtml(target.name)}] 타격! (${dealt} 피해${blocked > 0 ? ` · 수비력이 ${blocked} 흡수` : ''})</span>`);
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
  if (targetKey === 'face') {
    // 🐛 예전에는 state.playerHp를 직접 깎아 **방어막·피해 경감·취약을 전부 우회**했다.
    //    본체가 맞는 경로는 반드시 applyDirectDamageToPlayer 하나로 모은다.
    addBattleLog(`<span class="text-red-400">🗡️ [${escapeHtml(bm.name)}] 본체 직격!</span>`);
    applyDirectDamageToPlayer(bm.attack, false);
    return;
  }
  if (targetKey && targetKey.startsWith('foe:')) {
    const i = parseInt(targetKey.split(':')[1], 10);
    const t = state.playerMinions[i];
    if (t) {
      hitPlayerMinion(t, bm, i);
      return;
    }
  }

  // 아군 소환수/건축물이 있으면 최전방 타겟 타격 (PvE 기본 동작)
  if (state.playerMinions.length > 0) {
    hitPlayerMinion(state.playerMinions[0], bm, 0);
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
  const { died, dealt, blocked } = damageEntity(target, attacker.attack, { defBonus });
  const blockNote = blocked > 0 ? ` <span class="text-cyan-400">(방어 ${blocked} 흡수)</span>` : '';
  addBattleLog(`<span class="text-slate-400">🗡️ [${escapeHtml(attacker.name)}] ➔ [${escapeHtml(target.name)}] 공격! (-${dealt} HP)${blockNote}</span>`);
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

  // 💫 상대 소환수 상태이상 처리. 보스 진영은 refreshMinions를 쓰지 않으므로
  //    여기서 봉쇄를 소모하고 `blockedBy`를 세운다 — foeMinionAttack이 그걸 읽는다.
  tickMinionStatuses(state.bossMinions, '상대');

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
  // 2. 🎴 보스 전술 카드 플레이 단계 (적극적 2~3연속 카드 체인 시전!)
  const cardsToPlayLimit = (bossPhase === 2 || state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.5) ? 3 : 2;
  
  for (let playCount = 0; playCount < cardsToPlayLimit; playCount++) {
    if (!state.bossHand || state.bossHand.length === 0 || state.playerHp <= 0 || state.currentBoss.currentHp <= 0) break;

    let cardIdxToPlay = 0;
    // 1) 체력 위기 시 치유/방어 카드 최우선
    if (state.currentBoss.currentHp <= state.currentBoss.maxHp * 0.6) {
      const defIdx = state.bossHand.findIndex(c => c.skills && c.skills[0] && (c.skills[0].heal > 0 || c.skills[0].shield > 0));
      if (defIdx !== -1) cardIdxToPlay = defIdx;
    } 
    // 2) 필드 소환수 슬롯이 비었을 때 유닛/건축물 소환
    else if (state.bossMinions.length < BOSS_SLOTS) {
      const minionIdx = state.bossHand.findIndex(c => c.cardType === 'unit' || c.cardType === 'structure');
      if (minionIdx !== -1) cardIdxToPlay = minionIdx;
    }
    // 3) 그 외 공격/디버프 주문 우선
    else {
      const spellIdx = state.bossHand.findIndex(c => c.cardType === 'spell');
      if (spellIdx !== -1) cardIdxToPlay = spellIdx;
    }

    const cardToPlay = state.bossHand.splice(cardIdxToPlay, 1)[0];
    if (cardToPlay) {
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
  if (state.playerHp > 0 && state.currentBoss.currentHp > 0) {
    state.bossMinions.forEach((bm, idx) => foeMinionAttack(idx, bm));
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

  triggerBossArchetypeCombo(card, state, { addBattleLog, audio, applyDirectDamageToPlayer });

  if (card.cardType === 'unit' || card.cardType === 'structure') {
    audio.playSummon();
    if (state.bossMinions.length < BOSS_SLOTS) {
      const minion = {
        name: card.name,
        icon: elCfg.icon || '⚔️',
        attack: Math.max(8, card.attack || 12),
        defense: card.defense || 4,
        maxHp: Math.max(16, card.hp || 20),
        currentHp: Math.max(16, card.hp || 20),
        taunt: card.cardType === 'structure' || !!card.taunt,
        desc: card.skills && card.skills[0] ? card.skills[0].name : '소환수'
      };
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
    
    if (skill.damage && skill.damage > 0) {
      const dmg = skill.damage;
      if (skill.isAoeSpell) {
        state.playerMinions.forEach(m => {
          m.currentHp -= dmg;
          addBattleLog(`<span class="text-yellow-400">💥 보스 광역 주문: [${m.name}] -${dmg} HP</span>`);
        });
        state.playerMinions = state.playerMinions.filter(m => m.currentHp > 0);
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
}

async function executeSingleBossStep(step) {
  let val = step.value || 0;
  if (bossPhase === 2 && val > 0) val = Math.floor(val * 1.4);

  if (step.type === 'summon_or_buff') {
    const el = state.currentBoss.element || 'fire';
    const minionPool = (ELEMENT_BOSS_MINIONS && ELEMENT_BOSS_MINIONS[el]) ? ELEMENT_BOSS_MINIONS[el] : BOSS_ADD_POOL;
    if (state.bossMinions.length < BOSS_SLOTS) {
      const randomAdd = battleRng().pick(minionPool);
      state.bossMinions.push({ ...randomAdd, currentHp: randomAdd.maxHp });
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
        state.playerMinions.forEach(m => {
          m.currentHp -= hitDmg;
          addBattleLog(`<span class="text-yellow-400">💥 광역 피해: [${m.name}] -${hitDmg} HP</span>`);
        });
        state.playerMinions = state.playerMinions.filter(m => m.currentHp > 0);
        
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
  playFoeCard: (card, slot) => playFoeCardPvp(card, slot),

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

/** 진영을 뒤집은 game 뷰 — 상대 카드가 "자기 기준"으로 해석되게 한다 */
function makeMirroredGame() {
  return {
    // 상대 입장의 "적 하수인" = 내 하수인
    get bossMinions() { return state.playerMinions; },
    set bossMinions(v) { state.playerMinions = v; },

    // 상대 입장의 "내 방어막/체력/마나" = 상대(보스 슬롯)의 것
    get playerMaxShield() { return state.currentBoss.shield || 0; },
    set playerMaxShield(v) { state.currentBoss.shield = v; },

    get playerHp() { return state.currentBoss.currentHp; },
    set playerHp(v) { state.currentBoss.currentHp = v; },
    get playerMaxHp() { return state.currentBoss.maxHp; },

    get playerMana() { return state.bossMana || 0; },
    set playerMana(v) { state.bossMana = v; }
  };
}

/** 진영을 뒤집은 helpers — 피해·상태이상 방향이 반대가 된다 */
function makeMirroredHelpers() {
  return {
    addBattleLog,
    audio,
    // 상대가 "적"에게 주는 피해 = 나에게 오는 피해
    dealDamageToBoss: (dmg, src) => applyDirectDamageToPlayer(dmg, false),
    // 상대의 드로우는 내 손패를 건드리면 안 된다
    drawCards: () => {
      if (Array.isArray(state.bossDeck) && state.bossDeck.length > 0 && Array.isArray(state.bossHand)) {
        state.bossHand.push(state.bossDeck.shift());
      }
    },
    // 🪞 거울: 상대 기준 "보스"는 내 진영이다. 관문도 진영을 맞바꿔 넘긴다.
    setBossStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(playerStatus, state.playerMinions, '내', type, turns, value, allowBody),
    setPlayerStatus: (type, turns, value, allowBody = false) =>
      applyStatusRespectingScope(bossStatus, state.bossMinions, '상대', type, turns, value, allowBody),
    setPlayerBuff: (type, val) => { bossBuffs[type] = val; },
    foeLabel: '나',
    onShielded: () => triggerTraps('boss', 'shielded', null),
    // 거울: 상대 카드 입장에서 '적'은 나다
    foeHp: () => state.playerHp,
    foeMaxHp: () => state.playerMaxHp
  };
}

/**
 * 상대(원격 플레이어)가 낸 카드를 내 화면에서 해석한다.
 * playCard()와 **같은 규칙**을 쓰되 진영만 뒤집는다.
 */
export async function playFoeCardPvp(card, slot = null) {
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

  const mirroredGame = makeMirroredGame();
  const mirroredHelpers = makeMirroredHelpers();

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
  if (state.bossMinions.length < BOSS_SLOTS) {
    // 상대가 고른 배치 위치를 그대로 재현한다 (안 그러면 전열이 어긋난다)
    const at = Number.isInteger(slot)
      ? Math.max(0, Math.min(state.bossMinions.length, slot))
      : state.bossMinions.length;
    state.bossMinions.splice(at, 0, {
      ...card,
      instanceId: card.instanceId || `${card.id}#foe${state.bossMinions.length}`,
      maxHp: card.hp || 30,
      currentHp: card.hp || 30,
      defense: card.defense || 0,
      taunt: cardType === 'structure' || !!card.taunt,
      canAttack: false,
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
