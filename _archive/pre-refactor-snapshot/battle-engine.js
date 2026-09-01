// battle-engine.js - 정통 카드 배틀 엔진 (소환수 / 주문 / 건축물 & 보스 멀티액션)

import { ELEMENT_CONFIG } from './config.js';
import { audio } from './audio.js';
import { state } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { triggerLiveBossReaction } from './boss-forge.js';
import { BOSS_DATA, BOSS_ADD_POOL, ELEMENT_BOSS_MINIONS, BOSS_POWER_CARDS } from './data.js';
import { evaluateFieldSynergy, triggerArchetypeCombo, triggerBossArchetypeCombo } from './archetype-service.js';

export const BATTLE_SLOTS = 4;
export const BOSS_SLOTS = 3;

let isPlayerTurn = true;
let bossPhase = 1;
let bossStatus = { stun: 0, freeze: 0, burn: 0, shock: 0, poison: 0, vulnerable: 0 };
let playerBuffs = { doubleCast: false, invulnerable: 0 };
let playerDebuffs = { vulnerable: 0, burn: 0, poison: 0 };

export function getActiveDeckCards() {
  const activeCards = (state.activeDeckCardIds || [])
    .map(id => state.cardsCollection.find(c => c.id === id))
    .filter(Boolean);
  
  if (activeCards.length >= 4) {
    return activeCards;
  }
  // 활성 덱이 비어있거나 4장 미만인 경우 보관함에서 자동 충당
  return state.cardsCollection.slice(0, 10);
}

// 🎴 보스 전용 전술 덱 생성기 (플레이어 제작 카드 + 보스 파워 카드 결합)
export function buildBossTacticalDeck(boss) {
  const el = boss.element || 'fire';
  const bossDeck = [];

  // 1. 플레이어가 제작/보관 중인 카드 중 보스 속성과 어울리거나 강력한 카드 탐색 (최대 4장)
  const userCards = (state.cardsCollection || []).filter(c => {
    return (c.element === el || c.element === 'dark' || c.rarity === 'legendary' || c.rarity === 'epic') && !c.id.startsWith('starter-spell-2');
  });

  if (userCards.length > 0) {
    const shuffled = [...userCards].sort(() => 0.5 - Math.random());
    const picked = shuffled.slice(0, Math.min(4, userCards.length)).map(c => ({
      ...c,
      isUserCard: true
    }));
    bossDeck.push(...picked);
  }

  // 2. 보스 전용 고유 파워 카드 추가 (최대 4장)
  const powerCards = (BOSS_POWER_CARDS || []).filter(c => c.element === el || c.element === 'dark');
  const pool = powerCards.length > 0 ? powerCards : (BOSS_POWER_CARDS || []);
  const shuffledPower = [...pool].sort(() => 0.5 - Math.random());
  bossDeck.push(...shuffledPower.slice(0, 4));

  // 3. 최소 8장 덱 보충
  while (bossDeck.length < 8) {
    const randCard = (BOSS_POWER_CARDS && BOSS_POWER_CARDS.length > 0)
      ? BOSS_POWER_CARDS[Math.floor(Math.random() * BOSS_POWER_CARDS.length)]
      : { id: `boss-atk-${Date.now()}`, name: '심연의 참격', cardType: 'spell', skills: [{ damage: 16, description: '16 암흑 피해' }] };
    bossDeck.push({ ...randCard });
  }

  return bossDeck.sort(() => 0.5 - Math.random());
}

export function initBattle() {
  const bossTemplate = state.bossesList[state.currentBossIdx] || BOSS_DATA[0];
  state.currentBoss = {
    ...bossTemplate,
    currentHp: bossTemplate.maxHp,
    shield: bossTemplate.shield || 0,
    actionIdx: 0
  };

  state.turnCount = 1;
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

  bossStatus = { stun: 0, freeze: 0, burn: 0, shock: 0, poison: 0, vulnerable: 0 };
  playerBuffs = { doubleCast: false, invulnerable: 0 };
  playerDebuffs = { vulnerable: 0, burn: 0, poison: 0 };

  const activeDeckCards = getActiveDeckCards();
  state.playerDeck = [...activeDeckCards].sort(() => Math.random() - 0.5);
  state.playerHand = [];
  
  // 첫 턴 4장 드로우
  for (let i = 0; i < 4; i++) {
    if (state.playerDeck.length > 0) {
      state.playerHand.push(state.playerDeck.pop());
    }
  }

  clearBattleLogs();
  addBattleLog(`<span class="text-amber-400 font-bold">⚔️ [${state.currentBoss.name}] 과의 결전이 시작되었습니다!</span>`);
  addBattleLog(`<span class="text-slate-400">출전 덱(${activeDeckCards.length}장)을 셔플하여 전장에 진입했습니다.</span>`);
  
  const userCardCount = (state.bossDeck || []).filter(c => c.isUserCard).length + (state.bossHand || []).filter(c => c.isUserCard).length;
  if (userCardCount > 0) {
    addBattleLog(`<span class="text-purple-300 font-bold">🔮 보스가 플레이어의 마도서에서 ${userCardCount}장의 카드를 감지하여 자신의 덱에 편성했습니다!</span>`);
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
        state.playerDeck = [...activeDeckCards].sort(() => Math.random() - 0.5);
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

  // 보스 손패 미니 카드 동적 렌더링
  const bHandCardsEl = document.getElementById('boss-hand-cards');
  if (bHandCardsEl) {
    bHandCardsEl.innerHTML = '';
    (state.bossHand || []).forEach(c => {
      const elCfg = ELEMENT_CONFIG[c.element] || ELEMENT_CONFIG.dark;
      const miniEl = document.createElement('div');
      miniEl.className = `px-2 py-0.5 rounded-lg bg-black/80 border ${elCfg.border} text-[10px] flex items-center gap-1 shadow-md transition duration-200 hover:scale-105`;
      miniEl.innerHTML = `
        <span class="text-xs">${elCfg.icon}</span>
        <span class="font-bold text-slate-200 truncate max-w-[85px]">${c.name}</span>
        <span class="text-[8.5px] ${c.isUserCard ? 'text-cyan-400' : 'text-amber-400'} font-bold">(${c.cardType === 'unit' ? '유닛' : (c.cardType === 'structure' ? '성물' : '마법')})</span>
      `;
      bHandCardsEl.appendChild(miniEl);
    });
  }

  // 보스 소환수 필드
  const bossMinionsContainer = document.getElementById('boss-minions-container');
  const bossMinionsField = document.getElementById('boss-minions-field');
  if (bossMinionsContainer && bossMinionsField) {
    bossMinionsContainer.classList.remove('hidden');
    bossMinionsField.innerHTML = '';
    if (state.bossMinions.length === 0) {
      bossMinionsField.innerHTML = `<span class="text-[10px] text-slate-500 italic py-1">보스 호위병이 없습니다.</span>`;
    } else {
      state.bossMinions.forEach((bm) => {
        const bmEl = document.createElement('div');
        bmEl.className = 'relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-950/80 border border-red-500/70 text-xs shadow-md animate-card-draw';
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
        bossMinionsField.appendChild(bmEl);
      });
    }
  }

  // 카드군(Archetype) 테마 시너지 실시간 계산 및 배너 렌더링
  const synergyBanner = document.getElementById('player-synergy-banner');
  const synergyInfo = evaluateFieldSynergy(state.playerMinions);
  if (synergyBanner) {
    if (synergyInfo.synergies.length > 0) {
      synergyBanner.classList.remove('hidden');
      synergyBanner.innerHTML = `
        <div class="flex items-center gap-1.5 font-black text-amber-300">
          <span class="animate-bounce">⚜️</span>
          <span>카드군 시너지 발동:</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${synergyInfo.synergies.map(s => `
            <span onclick="window.showKeywordInfo && window.showKeywordInfo('${s.themeName}')" class="cursor-pointer hover:scale-105 transition px-2 py-0.5 rounded-lg bg-amber-950 border border-amber-400/80 text-[10.5px] font-bold text-amber-200 shadow flex items-center gap-1" title="클릭하여 [${s.themeName}] 테마 콤보 효과 보기">
              <span>${s.icon}</span>
              <span>${s.themeName}</span>
              <span class="text-amber-400 font-black">(${s.count}체)</span>
            </span>
          `).join('')}
        </div>
      `;
    } else {
      synergyBanner.classList.add('hidden');
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
        const emptySlot = document.createElement('div');
        emptySlot.className = 'h-36 rounded-xl border-2 border-dashed border-slate-700/60 bg-black/30 flex flex-col items-center justify-center text-slate-600 text-xs gap-1';
        emptySlot.innerHTML = `<i data-lucide="plus-circle" class="w-6 h-6 opacity-40"></i><span>슬롯 ${slot + 1}</span>`;
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

  if (window.lucide) window.lucide.createIcons();
}

export function createMinionFieldElement(entity, slotIdx, synergyInfo = null) {
  const elCfg = ELEMENT_CONFIG[entity.element] || ELEMENT_CONFIG.fire;
  const isStructure = entity.cardType === 'structure';
  const div = document.createElement('div');
  
  const canAtk = !isStructure && entity.canAttack && isPlayerTurn && !entity.frozen;
  
  // 시너지 공격력 보너스 계산
  const mySyn = synergyInfo && synergyInfo.synergies ? synergyInfo.synergies.find(s => s.themeId === entity.themeId || s.themeName === entity.themeName) : null;
  const bonusAtk = mySyn ? (mySyn.bonusAtk || 0) : 0;
  const displayAtk = entity.attack + bonusAtk;

  div.className = `relative h-36 rounded-xl p-2 bg-gradient-to-b ${isStructure ? 'from-amber-950/90 via-stone-900 to-black border-amber-600/70' : elCfg.bg + ' ' + elCfg.border} border-2 ${bonusAtk > 0 ? 'ring-2 ring-amber-400 shadow-amber-500/50' : ''} ${canAtk ? 'border-amber-400 shadow-lg shadow-amber-500/40 cursor-pointer animate-pulse' : ''} flex flex-col justify-between overflow-hidden select-none transition hover:scale-105`;

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
      ${isStructure ? '<span class="text-amber-400 flex items-center gap-0.5">🏛️ 성물</span>' : `<span class="text-red-400 flex items-center gap-0.5">⚔️ ${displayAtk}${bonusAtk > 0 ? `<span class="text-[10px] text-amber-300 font-bold">(+${bonusAtk})</span>` : ''}</span>`}
      <span class="text-blue-400 flex items-center gap-0.5">🛡️ ${entity.defense || 0}</span>
      <span class="text-emerald-400 flex items-center gap-0.5">❤️ ${entity.currentHp}/${entity.maxHp}</span>
    </div>
  `;

  if (canAtk) {
    div.onclick = () => attackWithMinion(slotIdx);
  }

  return div;
}

export function playCard(handIdx) {
  if (!isPlayerTurn || state.isAnimating) return;
  const card = state.playerHand[handIdx];
  if (!card) return;

  if (card.cost > state.playerMana) {
    addBattleLog(`<span class="text-red-400">마나가 부족합니다! (필요: ${card.cost}, 현재: ${state.playerMana})</span>`);
    return;
  }

  const cardType = card.cardType || 'unit';

  // 1. 주문/마법 카드 (Spell): 필드를 차지하지 않고 즉발 발동 후 묘지로 소모
  if (cardType === 'spell') {
    state.playerMana -= card.cost;
    state.playerHand.splice(handIdx, 1);
    audio.playMagic();

    addBattleLog(`<span class="text-purple-400 font-bold">🔮 [주문 발동] ${card.name}!</span>`);
    
    // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
    const comboHelpers = {
      addBattleLog,
      audio,
      dealDamageToBoss,
      setBossStatus: (type, val) => { bossStatus[type] = (bossStatus[type] || 0) + val; },
      setPlayerBuff: (type, val) => { playerBuffs[type] = val; },
      drawCards
    };
    triggerArchetypeCombo(card, state, comboHelpers);

    triggerSpellEffect(card);

    if (playerBuffs.doubleCast) {
      playerBuffs.doubleCast = false;
      addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 주문이 2연속 발동합니다!</span>`);
      triggerSpellEffect(card);
    }

    renderBattleUI();
    checkBattleStatus();
    return;
  }

  // 2. 소환수(Unit) or 건축물(Structure): 전장 슬롯 점유
  if (state.playerMinions.length >= BATTLE_SLOTS) {
    addBattleLog(`<span class="text-yellow-400">전장이 가득 찼습니다! (최대 ${BATTLE_SLOTS}개)</span>`);
    return;
  }

  state.playerMana -= card.cost;
  state.playerHand.splice(handIdx, 1);
  audio.playSummon();

  const entity = {
    ...card,
    maxHp: card.hp || 30,
    currentHp: card.hp || 30,
    defense: card.defense || 0,
    canAttack: false, // 소환 후유증
    frozen: false
  };

  state.playerMinions.push(entity);

  if (cardType === 'structure') {
    addBattleLog(`<span class="text-amber-400 font-bold">🏛️ [건축물 건립] [${card.name}] 을(를) 전장에 구축했습니다! (내구도: ${entity.maxHp})</span>`);
  } else {
    addBattleLog(`<span class="text-cyan-400 font-bold">✨ [소환수 출진] [${card.name}] 을(를) 전장에 소환했습니다!</span>`);
  }

  // 🎴 정통 TCG식 테마 덱 상호 연계(Combo & Search) 발동
  const comboHelpers = {
    addBattleLog,
    audio,
    dealDamageToBoss,
    setBossStatus: (type, val) => { bossStatus[type] = (bossStatus[type] || 0) + val; },
    setPlayerBuff: (type, val) => { playerBuffs[type] = val; },
    drawCards
  };
  triggerArchetypeCombo(card, state, comboHelpers);

  // 전투의 함성 (Battlecry) 발동
  triggerBattlecry(card);
  
  if (playerBuffs.doubleCast) {
    playerBuffs.doubleCast = false;
    addBattleLog(`<span class="text-indigo-300 font-bold">✨ [더블캐스트] 전장의 함성이 2배로 발동합니다!</span>`);
    triggerBattlecry(card);
  }

  renderBattleUI();
  checkBattleStatus();
}

export function triggerSpellEffect(card) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;

  if (skill.damage && skill.damage > 0) {
    let dmg = skill.damage;
    if (skill.multiHit && skill.multiHit > 1) dmg *= skill.multiHit;
    
    // 광역 주문인 경우 보스 부하 전원에게도 피해
    if (skill.isAoeSpell) {
      state.bossMinions.forEach(bm => {
        bm.currentHp -= dmg;
        addBattleLog(`<span class="text-red-300">💥 [${card.name}] 광역 폭격: 부하 [${bm.name}] -${dmg} 피해!</span>`);
      });
      state.bossMinions = state.bossMinions.filter(bm => bm.currentHp > 0);
    }
    dealDamageToBoss(dmg, `${card.name} 주문`);
  }

  if (skill.shield && skill.shield > 0) {
    state.playerMaxShield += skill.shield;
    addBattleLog(`<span class="text-blue-400">🛡️ ${card.name}의 가호로 방어막 +${skill.shield} 획득!</span>`);
  }

  if (skill.heal && skill.heal > 0) {
    state.playerHp = Math.min(state.playerMaxHp, state.playerHp + skill.heal);
    addBattleLog(`<span class="text-emerald-400">💖 ${card.name}의 치유로 체력 +${skill.heal} 회복!</span>`);
  }

  if (skill.manaGain && skill.manaGain > 0) {
    state.playerMana = Math.min(10, state.playerMana + skill.manaGain);
    addBattleLog(`<span class="text-blue-300">💎 마나 +${skill.manaGain} 획득!</span>`);
  }

  if (skill.drawCards && skill.drawCards > 0) {
    drawCards(skill.drawCards);
  }

  if (skill.doubleCastNext) {
    playerBuffs.doubleCast = true;
    addBattleLog(`<span class="text-indigo-400 font-bold">✨ 다음 카드가 2연속 발동됩니다!</span>`);
  }

  if (skill.invulnerableTurns && skill.invulnerableTurns > 0) {
    playerBuffs.invulnerable = Math.max(playerBuffs.invulnerable, skill.invulnerableTurns);
    addBattleLog(`<span class="text-amber-300 font-bold">🛡️ ${skill.invulnerableTurns}턴간 절대 무적 결계가 전개되었습니다!</span>`);
  }

  if (skill.statusEffect) {
    const st = skill.statusEffect;
    if (st.type && st.type !== 'none') {
      bossStatus[st.type] = (bossStatus[st.type] || 0) + (st.duration || 1);
      addBattleLog(`<span class="text-yellow-400">⚡ 보스에게 [${st.type}] 상태이상 부여!</span>`);
    }
  }
}

export function triggerBattlecry(card) {
  const skill = card.skills && card.skills[0];
  if (!skill) return;

  if (skill.damage && skill.damage > 0) {
    let dmg = skill.damage;
    if (skill.multiHit && skill.multiHit > 1) dmg *= skill.multiHit;
    dealDamageToBoss(dmg, `${card.name} 전투의 함성`);
  }

  if (skill.shield && skill.shield > 0) {
    state.playerMaxShield += skill.shield;
    addBattleLog(`<span class="text-blue-400">🛡️ ${card.name}의 가호로 방어막 +${skill.shield} 획득!</span>`);
  }

  if (skill.heal && skill.heal > 0) {
    state.playerHp = Math.min(state.playerMaxHp, state.playerHp + skill.heal);
    addBattleLog(`<span class="text-emerald-400">💖 ${card.name}의 치유로 체력 +${skill.heal} 회복!</span>`);
  }

  if (skill.manaGain && skill.manaGain > 0) {
    state.playerMana = Math.min(10, state.playerMana + skill.manaGain);
    addBattleLog(`<span class="text-blue-300">💎 마나 +${skill.manaGain} 획득!</span>`);
  }

  if (skill.drawCards && skill.drawCards > 0) {
    drawCards(skill.drawCards);
  }

  if (skill.doubleCastNext) {
    playerBuffs.doubleCast = true;
    addBattleLog(`<span class="text-indigo-400 font-bold">✨ 다음 카드가 2연속 발동됩니다!</span>`);
  }

  if (skill.invulnerableTurns && skill.invulnerableTurns > 0) {
    playerBuffs.invulnerable = Math.max(playerBuffs.invulnerable, skill.invulnerableTurns);
    addBattleLog(`<span class="text-amber-300 font-bold">🛡️ ${skill.invulnerableTurns}턴간 무적 결계가 펼쳐집니다!</span>`);
  }

  if (skill.statusEffect) {
    const st = skill.statusEffect;
    if (st.type && st.type !== 'none') {
      bossStatus[st.type] = (bossStatus[st.type] || 0) + (st.duration || 1);
      addBattleLog(`<span class="text-yellow-400">⚡ 보스에게 [${st.type}] 상태이상 부여!</span>`);
    }
  }
}

export function attackWithMinion(slotIdx) {
  if (!isPlayerTurn || state.isAnimating) return;
  const entity = state.playerMinions[slotIdx];
  if (!entity || !entity.canAttack || entity.cardType === 'structure' || entity.frozen) return;

  entity.canAttack = false;
  audio.playSlash();

  // 도발 하수인 우선 타격
  const tauntTarget = state.bossMinions.find(bm => bm.taunt && bm.currentHp > 0);
  const target = tauntTarget || (state.bossMinions.length > 0 ? state.bossMinions[0] : null);

  // ⚜️ 카드군 시너지 공격력 가산
  const synCheck = evaluateFieldSynergy(state.playerMinions);
  const mySyn = synCheck.synergies.find(s => s.themeId === entity.themeId || s.themeName === entity.themeName);
  const bonusAtk = mySyn ? (mySyn.bonusAtk || 0) : 0;
  const finalAtk = entity.attack + bonusAtk;

  if (target) {
    target.currentHp -= finalAtk;
    addBattleLog(`<span class="text-amber-300">⚔️ [${entity.name}]${bonusAtk > 0 ? ` <span class="text-amber-400 font-bold">(+${bonusAtk} 시너지)</span>` : ''} ➔ [${target.name}] 타격! (${finalAtk} 피해)</span>`);

    if (target.currentHp <= 0) {
      addBattleLog(`<span class="text-red-400 font-bold">💥 보스 부하 [${target.name}] 처치!</span>`);
      state.bossMinions = state.bossMinions.filter(bm => bm !== target);
    }
  } else {
    dealDamageToBoss(finalAtk, `${entity.name}${bonusAtk > 0 ? ` (+${bonusAtk} 시너지)` : ''}`);
  }

  renderBattleUI();
  checkBattleStatus();
}

export function dealDamageToBoss(dmg, sourceName) {
  if (!state.currentBoss) return;
  let remainingDmg = dmg;

  if (bossStatus.vulnerable > 0) {
    remainingDmg = Math.floor(remainingDmg * 1.5);
  }

  if (state.currentBoss.shield > 0) {
    if (state.currentBoss.shield >= remainingDmg) {
      state.currentBoss.shield -= remainingDmg;
      addBattleLog(`<span class="text-slate-300">🛡️ 보스의 방어막이 ${remainingDmg} 피해를 흡수했습니다.</span>`);
      remainingDmg = 0;
    } else {
      remainingDmg -= state.currentBoss.shield;
      addBattleLog(`<span class="text-slate-300">🛡️ 보스의 방어막이 파괴되었습니다!</span>`);
      state.currentBoss.shield = 0;
    }
  }

  if (remainingDmg > 0) {
    state.currentBoss.currentHp -= remainingDmg;
    addBattleLog(`<span class="text-red-400 font-bold">💥 [${sourceName}] 보스에게 ${remainingDmg} 직접 피해!</span>`);
    
    // 보스 피격 애니메이션
    const bossCard = document.getElementById('boss-card');
    if (bossCard) {
      bossCard.classList.add('animate-shake');
      setTimeout(() => bossCard.classList.remove('animate-shake'), 400);
    }

    // 🌵 불멸의 요새 / 가시 결계 피해 반사
    if (state.currentBoss.thorns && state.currentBoss.thorns > 0) {
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
  setTimeout(() => executeBossTurn(), 250);
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

  // 1. 보스 상태이상 처리
  if (bossStatus.stun > 0) {
    bossStatus.stun--;
    addBattleLog(`<span class="text-yellow-400">💫 보스가 기절 상태로 이번 턴 행동하지 못합니다!</span>`);
    setTimeout(() => startPlayerTurn(), 250);
    return;
  }
  if (bossStatus.freeze > 0) {
    bossStatus.freeze--;
    addBattleLog(`<span class="text-cyan-300">❄️ 보스가 빙결 상태로 콤보가 봉쇄되었습니다!</span>`);
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
    state.bossMinions.forEach(bm => {
      // 아군 소환수/건축물이 있으면 최전방 타겟 타격
      if (state.playerMinions.length > 0) {
        const target = state.playerMinions[0];
        target.currentHp -= bm.attack;
        addBattleLog(`<span class="text-slate-400">🗡️ [${bm.name}] ➔ [${target.name}] 공격! (-${bm.attack} HP)</span>`);
        if (target.currentHp <= 0) {
          addBattleLog(`<span class="text-red-500">💀 [${target.name}] 파괴!</span>`);
          state.playerMinions.shift();
        }
      } else {
        if (playerBuffs.invulnerable <= 0) {
          state.playerHp -= bm.attack;
          addBattleLog(`<span class="text-red-400">🗡️ [${bm.name}] 본체 직격! (-${bm.attack} HP)</span>`);
        }
      }
    });
  }

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
        const tauntEntity = state.playerMinions.find(m => m.taunt && m.currentHp > 0);
        const target = (!skill.pierceShield && tauntEntity) ? tauntEntity : ((!skill.pierceShield && state.playerMinions.length > 0) ? state.playerMinions[0] : null);
        if (target) {
          target.currentHp -= dmg;
          addBattleLog(`<span class="text-yellow-400">🛡️ [${target.name}] 이(가) 보스 주문을 대신 피격! (-${dmg} HP)</span>`);
          if (target.currentHp <= 0) {
            addBattleLog(`<span class="text-red-500">💀 [${target.name}] 파괴!</span>`);
            state.playerMinions = state.playerMinions.filter(m => m !== target);
          }
        } else {
          applyDirectDamageToPlayer(dmg, skill.pierceShield);
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
      const randIdx = Math.floor(Math.random() * state.playerHand.length);
      const discarded = state.playerHand.splice(randIdx, 1)[0];
      addBattleLog(`<span class="text-purple-400 font-bold">🃏 [패 파괴] 보스의 [${card.name}] 으로 플레이어 손패 [${discarded.name}] 이(가) 파기되었습니다!</span>`);
    }
    if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
      const st = skill.statusEffect;
      if (st.type === 'freeze' && state.playerMinions.length > 0) {
        state.playerMinions[0].frozen = true;
        addBattleLog(`<span class="text-cyan-400">❄️ [${card.name}] 효과로 [${state.playerMinions[0].name}] 이(가) 1턴간 결빙되었습니다!</span>`);
      } else if (st.type === 'burn') {
        state.playerHp -= (st.value || 6);
        addBattleLog(`<span class="text-orange-400">♨️ [${card.name}] 화상으로 플레이어 ${st.value || 6} 피해!</span>`);
      } else if (st.type === 'poison') {
        state.playerHp -= (st.value || 8);
        addBattleLog(`<span class="text-emerald-400">☣️ [${card.name}] 맹독으로 플레이어 ${st.value || 8} 피해!</span>`);
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
      const randomAdd = minionPool[Math.floor(Math.random() * minionPool.length)];
      state.bossMinions.push({ ...randomAdd, currentHp: randomAdd.maxHp });
      audio.playSummon();
      addBattleLog(`<span class="text-purple-400 font-bold">👾 [스텝 1/소환] 보스가 [${randomAdd.name}] 을(를) 소환했습니다!</span>`);
    } else {
      state.bossMinions.forEach(bm => bm.attack += 3);
      addBattleLog(`<span class="text-red-400">🔥 [스텝 1/강화] 보스가 모든 부하의 공격력을 +3 강화했습니다!</span>`);
    }
  } else if (step.type === 'debuff') {
    if (step.status) {
      if (step.status.type === 'freeze' && state.playerMinions.length > 0) {
        state.playerMinions[0].frozen = true;
        addBattleLog(`<span class="text-cyan-400">❄️ [스텝/방해] [${state.playerMinions[0].name}] 이(가) 1턴간 결빙되었습니다!</span>`);
      } else if (step.status.type === 'burn') {
        state.playerHp -= (step.status.value || 8);
        addBattleLog(`<span class="text-orange-400">♨️ [스텝/작열] 플레이어가 화상으로 ${step.status.value || 8} 피해를 입었습니다!</span>`);
      } else if (step.status.type === 'poison') {
        state.playerHp -= (step.status.value || 8);
        addBattleLog(`<span class="text-emerald-400">☣️ [스텝/맹독] 플레이어가 맹독으로 ${step.status.value || 8} 피해를 입었습니다!</span>`);
      } else if (step.status.type === 'shock') {
        state.playerHp -= (step.status.value || 6);
        state.playerMana = Math.max(0, state.playerMana - 1);
        addBattleLog(`<span class="text-amber-400">⚡ [스텝/감전] 플레이어가 감전으로 ${step.status.value || 6} 피해 및 마나 -1 방전!</span>`);
      } else if (step.status.type === 'vulnerable') {
        playerDebuffs.vulnerable = Math.max(playerDebuffs.vulnerable, step.status.duration || 2);
        addBattleLog(`<span class="text-purple-400">💥 [스텝/취약] 플레이어가 취약 상태가 되어 받는 피해가 +50% 증가합니다!</span>`);
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
      const randIdx = Math.floor(Math.random() * state.playerHand.length);
      const discarded = state.playerHand.splice(randIdx, 1)[0];
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
        const tauntEntity = state.playerMinions.find(m => m.taunt && m.currentHp > 0);
        const target = (!step.pierceShield && tauntEntity) ? tauntEntity : ((!step.pierceShield && state.playerMinions.length > 0) ? state.playerMinions[0] : null);

        if (target) {
          target.currentHp -= hitDmg;
          addBattleLog(`<span class="text-yellow-400">🛡️ [${target.name}] 이(가) 보스의 공격을 대신 흡수했습니다! (-${hitDmg} HP)</span>`);
          if (target.currentHp <= 0) {
            addBattleLog(`<span class="text-red-500">💀 [${target.name}] 파괴!</span>`);
            state.playerMinions = state.playerMinions.filter(m => m !== target);
          }
        } else {
          applyDirectDamageToPlayer(hitDmg, step.pierceShield);
        }
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
  let finalDmg = dmg;
  if (playerDebuffs.vulnerable > 0) {
    finalDmg = Math.floor(finalDmg * 1.5);
    addBattleLog(`<span class="text-purple-400">💥 [취약 효과] 플레이어가 받는 피해가 50% 증폭되었습니다!</span>`);
  }

  if (pierceShield) {
    addBattleLog(`<span class="text-purple-400 font-bold">🎯 [실드 관통] 보스의 공격이 방어막을 무시하고 체력을 직접 타격합니다!</span>`);
  } else if (state.playerMaxShield > 0) {
    if (state.playerMaxShield >= finalDmg) {
      state.playerMaxShield -= finalDmg;
      finalDmg = 0;
    } else {
      finalDmg -= state.playerMaxShield;
      state.playerMaxShield = 0;
    }
  }
  if (finalDmg > 0) {
    state.playerHp -= finalDmg;
    addBattleLog(`<span class="text-red-500 font-bold">🩸 플레이어가 ${finalDmg} 피해를 입었습니다!</span>`);
  }
}

export function startPlayerTurn() {
  state.turnCount++;
  isPlayerTurn = true;
  state.isAnimating = false;

  // 버프 및 디버프 틱 차감
  if (playerBuffs.invulnerable > 0) playerBuffs.invulnerable--;
  if (playerDebuffs.vulnerable > 0) playerDebuffs.vulnerable--;

  // 💎 정통 TCG 룰: 턴 수에 맞춰 마나 최대치가 1씩 성장 (턴 1: 1마나, 턴 2: 2마나, 턴 3: 3마나...)
  state.playerMaxMana = Math.min(10, state.turnCount);
  state.playerMana = state.playerMaxMana;

  // 모든 아군 소환수 공격 가능 상태 해제 (빙결 해제)
  state.playerMinions.forEach(m => {
    m.canAttack = true;
    m.frozen = false;
  });

  // 턴 시작 시 건축물 패시브 (마나 공급 등)
  triggerStructureStartTurnPassives();

  drawCards(1);
  updateBossIntent();
  renderBattleUI();
  addBattleLog(`<span class="text-emerald-400 font-bold">✨ [턴 ${state.turnCount}] 플레이어 턴 시작! 마나(${state.playerMana}) 충전 완료.</span>`);
}

export function updateBossIntent() {
  if (!state.currentBoss) return;
  const combos = state.currentBoss.comboPatterns || [];
  const nextCombo = combos[state.currentBoss.actionIdx % combos.length];

  const intentEl = document.getElementById('boss-intent');
  if (intentEl && nextCombo) {
    intentEl.innerHTML = `
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-red-500/50 text-red-300 text-xs font-bold shadow-md">
        <span class="animate-pulse">⚠️</span>
        <span>다음 콤보: [${nextCombo.name}] <span class="text-slate-400 font-normal">(${nextCombo.desc || '다단계 연속 행동'})</span></span>
      </div>
    `;
  }
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
