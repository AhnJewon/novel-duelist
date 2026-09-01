// archetype-service.js - LLM 자율 생성 카드군(Archetype/Theme) 영구 누적 DB & 범용 TCG 콤보 엔진

import { state, dbLoad, dbSave } from './storage.js';
import { DEFAULT_THEME_ARCHETYPES } from './data.js';

export const STORAGE_KEY_ARCHETYPES = 'novel_duelist_archetypes';

// 카드군 테마 로드 (IndexedDB 영구 저장소 연동)
export async function loadArchetypes() {
  try {
    const idbThemes = await dbLoad(STORAGE_KEY_ARCHETYPES);
    if (idbThemes && Array.isArray(idbThemes) && idbThemes.length > 0) {
      const merged = [...idbThemes];
      DEFAULT_THEME_ARCHETYPES.forEach(def => {
        if (!merged.some(m => m.id === def.id || m.name === def.name)) {
          merged.push(def);
        }
      });
      state.archetypesList = merged;
      await dbSave(STORAGE_KEY_ARCHETYPES, state.archetypesList);
    } else {
      const stored = localStorage.getItem(STORAGE_KEY_ARCHETYPES);
      state.archetypesList = stored ? JSON.parse(stored) : [...DEFAULT_THEME_ARCHETYPES];
      await dbSave(STORAGE_KEY_ARCHETYPES, state.archetypesList);
    }
  } catch (e) {
    state.archetypesList = [...DEFAULT_THEME_ARCHETYPES];
  }
}

export async function saveArchetypesToStorage() {
  await dbSave(STORAGE_KEY_ARCHETYPES, state.archetypesList);
  try {
    localStorage.setItem(STORAGE_KEY_ARCHETYPES, JSON.stringify(state.archetypesList));
  } catch (e) {
    console.warn('localStorage 용량 초과: IndexedDB로 테마 데이터 영구 저장 완료.');
  }
}

// 🔍 텍스트 콘셉트 & 속성 기반 가장 적합한 기존 누적 카드군 탐색
export function findMatchingArchetype(conceptText = '', element = '') {
  if (!state.archetypesList || state.archetypesList.length === 0) return null;
  const text = (conceptText || '').toLowerCase();

  let bestMatch = null;
  let highestScore = 0;

  for (const arc of state.archetypesList) {
    let score = 0;
    const name = arc.name.toLowerCase();
    const keyword = (arc.keyword || '').toLowerCase();
    const seeds = (arc.seeds || []).map(s => s.toLowerCase());

    if (keyword && text.includes(keyword) && keyword.length > 1) score += 10;
    if (text.includes(name)) score += 15;
    if (element && arc.element === element) score += 3;

    for (const seed of seeds) {
      if (text.includes(seed)) score += 4;
    }

    if (score > highestScore && score >= 4) {
      highestScore = score;
      bestMatch = arc;
    }
  }

  return bestMatch;
}

// ✨ LLM이 생성한 새로운 카드군 테마 등록 및 DB 영구 누적 저장
export async function registerNewArchetype(themeData) {
  if (!themeData || !themeData.name) return null;
  if (!state.archetypesList) state.archetypesList = [...DEFAULT_THEME_ARCHETYPES];

  const trimmedName = themeData.name.replace(/['"\[\]]/g, '').trim();
  const trimmedKeyword = (themeData.keyword || themeData.themeKeyword || trimmedName.slice(0, 3)).replace(/['"\[\]]/g, '').trim();

  // 이미 존재하는지 확인
  const existing = state.archetypesList.find(
    a => a.id === themeData.id || a.name === trimmedName || (trimmedKeyword && a.keyword === trimmedKeyword)
  );

  if (existing) {
    // 기존 카드군 정보 갱신
    if (themeData.comboAction && !existing.comboAction) existing.comboAction = themeData.comboAction;
    if (themeData.themeComboDesc && !existing.description) existing.description = themeData.themeComboDesc;
    await saveArchetypesToStorage();
    return existing;
  }

  // 액션 추론
  let comboAction = themeData.comboAction || themeData.themeComboAction;
  if (!comboAction) {
    const desc = (themeData.description || themeData.themeComboDesc || '').toLowerCase();
    if (desc.includes('서치') || desc.includes('search') || desc.includes('찾아')) comboAction = 'search';
    else if (desc.includes('마나') || desc.includes('충전') || desc.includes('공명')) comboAction = 'manaCharge';
    else if (desc.includes('소환') || desc.includes('정령') || desc.includes('토큰')) comboAction = 'specialSummon';
    else if (desc.includes('동결') || desc.includes('결빙') || desc.includes('기절')) comboAction = 'freeze';
    else if (desc.includes('더블') || desc.includes('2연속') || desc.includes('과충전')) comboAction = 'doubleCast';
    else if (desc.includes('방어막') || desc.includes('결계') || desc.includes('실드') || desc.includes('치유')) comboAction = 'shieldHeal';
    else if (desc.includes('드로우') || desc.includes('draw')) comboAction = 'draw';
    else comboAction = 'chainDamage';
  }

  const newId = themeData.id || `theme_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newTheme = {
    id: newId,
    name: trimmedName,
    title: themeData.title || trimmedName,
    element: themeData.element || 'fire',
    keyword: trimmedKeyword,
    icon: themeData.icon || '⚜️',
    badge: themeData.badge || 'bg-slate-800 text-slate-200 border-slate-600',
    description: themeData.description || themeData.themeComboDesc || `${trimmedName} 테마 덱 연계`,
    comboAction: comboAction,
    comboValue: themeData.comboValue || 8,
    synergy: {
      type: comboAction,
      name: `${trimmedName} 연계`,
      desc: themeData.themeComboDesc || themeData.description || `[${trimmedName}] 테마 카드 상호 연계`
    },
    seeds: themeData.seeds || [trimmedName, trimmedKeyword],
    createdAt: new Date().toISOString()
  };

  state.archetypesList.push(newTheme);
  await saveArchetypesToStorage();
  console.log(`[Archetype DB] ✨ LLM 신규 카드군 등록 & 누적: [${newTheme.name}] (총 ${state.archetypesList.length}개 카드군 누적 보관)`);
  return newTheme;
}

// ⚔️ 전장 내 활성화된 카드군 시너지 상태 평가기
export function evaluateFieldSynergy(minions = []) {
  if (!minions || minions.length <= 1) return { synergies: [] };

  const themeCounts = {};
  minions.forEach(m => {
    const tId = m.themeId || (m.theme ? m.theme.id : null) || m.themeName;
    if (tId) {
      themeCounts[tId] = (themeCounts[tId] || 0) + 1;
    }
  });

  const activeSynergies = [];
  for (const [tId, count] of Object.entries(themeCounts)) {
    if (count >= 2) {
      const theme = (state.archetypesList || []).find(a => a.id === tId || a.name === tId) || DEFAULT_THEME_ARCHETYPES.find(a => a.id === tId || a.name === tId);
      if (theme) {
        activeSynergies.push({
          themeId: tId,
          themeName: theme.name,
          icon: theme.icon || '⚜️',
          count: count,
          desc: theme.description || `${theme.name} 테마 연계 활성화`
        });
      }
    }
  }

  return {
    synergies: activeSynergies
  };
}

// 🎴 LLM이 자율 정의한 모든 카드군(Archetype)의 범용 TCG 콤보 실행 엔진
export function triggerArchetypeCombo(card, gameState, helpers) {
  if (!card) return null;
  const themeName = card.themeName || (card.theme && card.theme.name);
  const themeId = card.themeId || (card.theme && card.theme.id);
  if (!themeName && !themeId) return null;

  // DB에 누적된 카드군 목록에서 검색
  const theme = (gameState.archetypesList || []).find(a => a.id === themeId || a.name === themeName || (card.themeKeyword && a.keyword === card.themeKeyword))
    || DEFAULT_THEME_ARCHETYPES.find(a => a.id === themeId || a.name === themeName);

  if (!theme) return null;

  const { addBattleLog, audio, dealDamageToBoss, setBossStatus, setPlayerBuff, drawCards } = helpers;
  const action = theme.comboAction || (theme.synergy ? theme.synergy.type : 'search');

  // 1. 🔍 [덱 서치 (Search)]: 덱에서 같은 테마 카드를 찾아 패로 가져옴
  if (action === 'search' || action === 'hero_search') {
    const foundIdx = gameState.playerDeck.findIndex(c => 
      c.themeId === theme.id || c.themeName === theme.name || (theme.keyword && c.name && c.name.includes(theme.keyword))
    );
    if (foundIdx !== -1 && gameState.playerHand.length < 7) {
      const searched = gameState.playerDeck.splice(foundIdx, 1)[0];
      gameState.playerHand.push(searched);
      addBattleLog(`
        <div class="p-1.5 rounded-lg bg-amber-950/90 border border-amber-500 text-amber-200 text-xs shadow-md my-1">
          <span class="font-black text-amber-300">⚜️ [${theme.name} 덱 서치]</span> 덱에서 <b>[${searched.name}]</b> 카드를 패로 서치했습니다!
        </div>
      `);
      audio.playDraw();
      dealDamageToBoss(8, `${theme.name} 연계 타격`);
      return { name: `${theme.name} 서치 & 연계`, triggered: true };
    }
  }

  // 2. 💎 [자원 마력 공명 (Mana Charge)]: 마나 즉시 충전 & 전원 방어막
  if (action === 'manaCharge' || action === 'crystal_resonance') {
    gameState.playerMana = Math.min(gameState.playerMaxMana, gameState.playerMana + 1);
    const themeCount = gameState.playerMinions.filter(m => m.themeId === theme.id || m.themeName === theme.name).length;
    const shieldBonus = Math.max(6, themeCount * 6);
    gameState.playerMaxShield += shieldBonus;
    audio.playShield();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-xs shadow-md my-1">
        <span class="font-black text-cyan-300">💎 [${theme.name} 마력 공명]</span> 마나 +1 충전 & 방어막 +${shieldBonus} 전개!
      </div>
    `);
    return { name: `${theme.name} 마력 공명`, triggered: true };
  }

  // 3. 🔥 [연쇄 돌격 폭격 (Chain Damage)]: 보스에게 즉시 고정 화염/원소 연계 피해 & 상태이상
  if (action === 'chainDamage' || action === 'crimson_chain') {
    const allies = gameState.playerMinions.filter(m => m.id !== card.id && (m.themeId === theme.id || m.themeName === theme.name));
    const dmg = allies.length > 0 ? 12 : 8;
    dealDamageToBoss(dmg, `${theme.name} 연쇄 폭격`);
    setBossStatus('burn', 2);
    audio.playSlash();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-red-950/90 border border-red-500 text-red-200 text-xs shadow-md my-1">
        <span class="font-black text-red-400">🔥 [${theme.name} 연쇄 폭격]</span> 보스에게 ${dmg}의 연계 피해 & 화상 부여!
      </div>
    `);
    return { name: `${theme.name} 연쇄 폭격`, triggered: true };
  }

  // 4. ❄️ [절대 결빙 & 드로우 (Freeze & Draw)]: 적 보스를 1턴간 결빙시키고 추가 드로우
  if (action === 'freeze' || action === 'frost_freeze') {
    setBossStatus('freeze', 1);
    drawCards(1);
    audio.playMagic();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-blue-950/90 border border-cyan-400 text-cyan-200 text-xs shadow-md my-1">
        <span class="font-black text-cyan-300">❄️ [${theme.name} 결빙 연쇄]</span> 보스를 1턴 동결시키고 덱에서 카드 1장 드로우!
      </div>
    `);
    return { name: `${theme.name} 결빙 연쇄`, triggered: true };
  }

  // 5. ⚡ [과충전 더블캐스트 (Double Cast)]: 다음 카드가 2연속 발동 & 감전
  if (action === 'doubleCast' || action === 'thunder_overcharge') {
    setPlayerBuff('doubleCast', true);
    setBossStatus('shock', 2);
    audio.playCrit();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-yellow-950/90 border border-yellow-400 text-yellow-200 text-xs shadow-md my-1">
        <span class="font-black text-yellow-300">⚡ [${theme.name} 과충전]</span> 다음 카드가 2연속 발동(더블캐스트)됩니다!
      </div>
    `);
    return { name: `${theme.name} 과충전`, triggered: true };
  }

  // 6. ✨ [무적 결계 & 치유 (Shield & Heal)]: 절대 무적 결계 및 방어막
  if (action === 'shieldHeal' || action === 'sanctuary_barrier') {
    setPlayerBuff('invulnerable', 1);
    gameState.playerMaxShield += 15;
    audio.playShield();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-amber-950/90 border border-amber-400 text-amber-200 text-xs shadow-md my-1">
        <span class="font-black text-amber-300">✨ [${theme.name} 무적 결계]</span> 1턴간 절대 무적 결계 전개 & 방어막 +15 획득!
      </div>
    `);
    return { name: `${theme.name} 무적 결계`, triggered: true };
  }

  // 7. 🌑 [실드 관통 & 회수 (Salvage & Pierce)]: 실드 100% 관통 및 드로우
  if (action === 'draw' || action === 'abyssal_salvage') {
    drawCards(1);
    setPlayerBuff('pierceShield', true);
    audio.playMagic();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-purple-950/90 border border-purple-500 text-purple-200 text-xs shadow-md my-1">
        <span class="font-black text-purple-300">🌑 [${theme.name} 영혼 회수]</span> 카드 1장 드로우 & 실드 완전 관통 활성화!
      </div>
    `);
    return { name: `${theme.name} 영혼 회수`, triggered: true };
  }

  // 8. 🌿 [특수 소환 & 번식 (Special Summon)]: 전장에 테마 정령 소환
  if (action === 'specialSummon' || action === 'worldtree_growth') {
    gameState.playerHp = Math.min(gameState.playerMaxHp, gameState.playerHp + 12);
    if (gameState.playerMinions.length < 4) {
      gameState.playerMinions.push({
        id: `token-${Date.now()}`,
        name: `${theme.name}의 정령`,
        cardType: 'unit',
        element: card.element || 'nature',
        themeId: theme.id,
        themeName: theme.name,
        attack: 6,
        defense: 4,
        maxHp: 16,
        currentHp: 16,
        canAttack: true,
        imageUrl: card.imageUrl || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80'
      });
      addBattleLog(`
        <div class="p-1.5 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-200 text-xs shadow-md my-1">
          <span class="font-black text-emerald-300">🌿 [${theme.name} 특수 소환]</span> [${theme.name}의 정령] 무료 소환!
        </div>
      `);
    }
    audio.playSummon();
    return { name: `${theme.name} 특수 소환`, triggered: true };
  }

  return null;
}

// 🎴 보스 전용 카드군(Archetype) TCG 콤보 실행 엔진
export function triggerBossArchetypeCombo(card, gameState, helpers) {
  if (!card) return null;
  const themeName = card.themeName || (card.theme && card.theme.name);
  const themeId = card.themeId || (card.theme && card.theme.id);
  if (!themeName && !themeId) return null;

  const theme = (gameState.archetypesList || []).find(a => a.id === themeId || a.name === themeName || (card.themeKeyword && a.keyword === card.themeKeyword))
    || DEFAULT_THEME_ARCHETYPES.find(a => a.id === themeId || a.name === themeName);

  if (!theme) return null;

  const { addBattleLog, audio, applyDirectDamageToPlayer } = helpers;
  const action = theme.comboAction || (theme.synergy ? theme.synergy.type : 'search');

  // 1. [덱 서치 (Search)]
  if (action === 'search' || action === 'hero_search') {
    if (gameState.bossDeck && gameState.bossDeck.length > 0 && gameState.bossHand && gameState.bossHand.length < 5) {
      const foundIdx = gameState.bossDeck.findIndex(c => 
        c.themeId === theme.id || c.themeName === theme.name || (theme.keyword && c.name && c.name.includes(theme.keyword))
      );
      if (foundIdx !== -1) {
        const searched = gameState.bossDeck.splice(foundIdx, 1)[0];
        gameState.bossHand.push(searched);
        addBattleLog(`
          <div class="p-1.5 rounded-lg bg-red-950/90 border border-red-500 text-red-200 text-xs shadow-md my-1">
            <span class="font-black text-amber-300">👹 [보스 ${theme.name} 덱 서치]</span> 보스가 덱에서 <b>[${searched.name}]</b> 카드를 패로 서치했습니다!
          </div>
        `);
        audio.playDraw();
        applyDirectDamageToPlayer(8);
        return { name: `보스 ${theme.name} 서치`, triggered: true };
      }
    }
  }

  // 2. [자원 공명 (Mana Charge / Shield)]
  if (action === 'manaCharge' || action === 'crystal_resonance') {
    gameState.currentBoss.shield = (gameState.currentBoss.shield || 0) + 12;
    audio.playShield();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-xs shadow-md my-1">
        <span class="font-black text-cyan-300">💎 [보스 ${theme.name} 마력 공명]</span> 보스가 방어막 +12를 즉시 전개했습니다!
      </div>
    `);
    return { name: `보스 ${theme.name} 마력 공명`, triggered: true };
  }

  // 3. [연쇄 돌격 폭격 (Chain Damage)]
  if (action === 'chainDamage' || action === 'crimson_chain') {
    applyDirectDamageToPlayer(10);
    audio.playSlash();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-red-950/90 border border-red-500 text-red-200 text-xs shadow-md my-1">
        <span class="font-black text-red-400">🔥 [보스 ${theme.name} 연쇄 폭격]</span> 플레이어에게 10의 연계 피해!
      </div>
    `);
    return { name: `보스 ${theme.name} 연쇄 폭격`, triggered: true };
  }

  // 4. [절대 결빙 & 드로우 (Freeze & Draw)]
  if (action === 'freeze' || action === 'frost_freeze') {
    if (gameState.playerMinions.length > 0) {
      gameState.playerMinions[0].frozen = true;
      gameState.playerMinions[0].canAttack = false;
    }
    audio.playMagic();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-blue-950/90 border border-cyan-400 text-cyan-200 text-xs shadow-md my-1">
        <span class="font-black text-cyan-300">❄️ [보스 ${theme.name} 결빙 연쇄]</span> 아군 전방 유닛을 1턴간 동결시켰습니다!
      </div>
    `);
    return { name: `보스 ${theme.name} 결빙 연쇄`, triggered: true };
  }

  // 5. [과충전 더블캐스트 (Double Cast)]
  if (action === 'doubleCast' || action === 'thunder_overcharge') {
    applyDirectDamageToPlayer(8);
    audio.playCrit();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-yellow-950/90 border border-yellow-400 text-yellow-200 text-xs shadow-md my-1">
        <span class="font-black text-yellow-300">⚡ [보스 ${theme.name} 과충전]</span> 보스가 2연속 과충전 번개 타격을 가했습니다!
      </div>
    `);
    return { name: `보스 ${theme.name} 과충전`, triggered: true };
  }

  // 6. [무적 결계 & 치유 (Shield & Heal)]
  if (action === 'shieldHeal' || action === 'sanctuary_barrier') {
    gameState.currentBoss.shield = (gameState.currentBoss.shield || 0) + 15;
    gameState.currentBoss.currentHp = Math.min(gameState.currentBoss.maxHp, gameState.currentBoss.currentHp + 10);
    audio.playShield();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-amber-950/90 border border-amber-400 text-amber-200 text-xs shadow-md my-1">
        <span class="font-black text-amber-300">✨ [보스 ${theme.name} 무적 결계]</span> 보스가 방어막 +15 및 체력 10을 회복했습니다!
      </div>
    `);
    return { name: `보스 ${theme.name} 무적 결계`, triggered: true };
  }

  // 7. [실드 관통 & 회수 (Salvage & Pierce)]
  if (action === 'draw' || action === 'abyssal_salvage') {
    applyDirectDamageToPlayer(8, true);
    audio.playMagic();
    addBattleLog(`
      <div class="p-1.5 rounded-lg bg-purple-950/90 border border-purple-500 text-purple-200 text-xs shadow-md my-1">
        <span class="font-black text-purple-300">🌑 [보스 ${theme.name} 영혼 관통]</span> 방어막을 무시하고 체력에 8 직접 피해!
      </div>
    `);
    return { name: `보스 ${theme.name} 영혼 관통`, triggered: true };
  }

  // 8. [특수 소환 (Special Summon)]
  if (action === 'specialSummon' || action === 'worldtree_growth') {
    if (gameState.bossMinions.length < 3) {
      gameState.bossMinions.push({
        name: `${theme.name}의 심복`,
        icon: '👾',
        attack: 8,
        defense: 4,
        maxHp: 16,
        currentHp: 16,
        taunt: false,
        desc: `${theme.name} 소환수`
      });
      audio.playSummon();
      addBattleLog(`
        <div class="p-1.5 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-200 text-xs shadow-md my-1">
          <span class="font-black text-emerald-300">🌿 [보스 ${theme.name} 특수 소환]</span> [${theme.name}의 심복]을 전장에 소환했습니다!
        </div>
      `);
      return { name: `보스 ${theme.name} 특수 소환`, triggered: true };
    }
  }

  return null;
}

// LLM 프롬프트용 누적 카드군 요약 문자열 생성
export function getArchetypesPromptSummary() {
  const list = state.archetypesList || DEFAULT_THEME_ARCHETYPES;
  if (!list || list.length === 0) return '(현재 등록된 카드군 없음 - LLM이 자유롭게 신규 카드군을 창설하세요)';
  return list.map(a => `- [${a.name}] (키워드: "${a.keyword}", 속성: ${a.element}, 콤보타입: ${a.comboAction || 'search'}): ${a.description}`).join('\n');
}
