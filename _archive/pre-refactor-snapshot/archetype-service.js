// archetype-service.js - LLM 자율 생성 카드군(Archetype/Theme) 영구 누적 DB & 범용 TCG 콤보 엔진

import { state, dbLoad, dbSave, saveCardsToStorage } from './storage.js';
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

// ============================================================
// 🔗 카드군 동일성 판정 (Archetype Identity Resolution)
// ------------------------------------------------------------
// LLM은 같은 컨셉을 매번 조금씩 다른 표기로 뱉는다.
//   "홍련의 검사단" / "홍련 검사단" / "홍련검사단"
// 완전일치(===) 비교만으로는 이게 전부 별개 카드군으로 누적되므로,
// 신규 등록 전에 반드시 이 게이트를 통과시켜 기존 카드군으로 흡수시킨다.
// 임베딩/추가 LLM 호출 없이 전부 동기 처리된다.
// ============================================================

// 병합 임계값 (문자 bigram Dice 계수)
export const ARCHETYPE_SIM_STRONG = 0.82; // 이 이상이면 표기만 봐도 동일 카드군
export const ARCHETYPE_SIM_WEAK = 0.70;   // 이 이상 + 콤보/속성 일치면 동일 카드군

// 표기 흔들림 제거. 조사 '의', 공백, 따옴표, 구두점을 털어낸다.
// ('~단 / ~결사 / ~기사단' 같은 접미사는 카드군 정체성이라 보존한다)
export function normalizeArchetypeName(raw = '') {
  return String(raw)
    .replace(/['"“”‘’\[\]()【】<>「」]/g, '')
    .replace(/의(?=\s)/g, '')             // "홍련의 검사단" -> "홍련 검사단"
    .replace(/[\s·・、,.\-–—~!?:;]/g, '')  // "홍련 검사단"   -> "홍련검사단"
    .toLowerCase()
    .trim();
}

function toBigrams(s) {
  const set = new Set();
  if (s.length === 1) { set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// 문자 bigram Dice 계수 (0~1)
export function stringSimilarity(a = '', b = '') {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = toBigrams(a);
  const B = toBigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach(g => { if (B.has(g)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

// 카드군명을 어절 단위로 쪼갠다. "홍련의 검사단" -> ["홍련", "검사단"]
function tokenizeArchetypeName(raw = '') {
  return String(raw)
    .replace(/['"“”‘’\[\]()【】<>「」]/g, '')
    .replace(/의(?=\s)/g, '')
    .split(/[\s·・、,]+/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

// 두 카드군 후보가 같은 카드군인가? 같으면 {reason, score}, 아니면 null.
export function compareArchetypeIdentity(a, b) {
  if (!a || !b) return null;

  const aName = normalizeArchetypeName(a.name || '');
  const bName = normalizeArchetypeName(b.name || '');
  const aKey = normalizeArchetypeName(a.keyword || '');
  const bKey = normalizeArchetypeName(b.keyword || '');

  if (!aName && !aKey) return null;
  if (!bName && !bKey) return null;

  // 1. 키워드 완전일치 (1글자 키워드는 오탐이 심해 제외)
  if (aKey && bKey && aKey === bKey && aKey.length >= 2) {
    return { reason: 'keyword-exact', score: 1 };
  }

  // 2. 정규화 이름 완전일치 — "홍련의 검사단" == "홍련검사단"
  if (aName && bName && aName === bName) {
    return { reason: 'name-exact', score: 1 };
  }

  // 3. 키워드가 상대 카드군명에 통째로 들어있음 (유희왕식 소속 판정)
  if (aKey.length >= 2 && bName.includes(aKey)) return { reason: 'keyword-in-name', score: 0.93 };
  if (bKey.length >= 2 && aName.includes(bKey)) return { reason: 'keyword-in-name', score: 0.93 };

  // 4. 이름 포함 관계 — "홍련검사" ⊂ "홍련검사단"
  const shorter = aName.length <= bName.length ? aName : bName;
  const longer = aName.length <= bName.length ? bName : aName;
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return { reason: 'name-containment', score: 0.9 };
  }

  // 5. 표기 유사도 (이름 / 키워드 중 높은 쪽)
  const score = Math.max(
    stringSimilarity(aName, bName),
    (aKey && bKey) ? stringSimilarity(aKey, bKey) : 0
  );

  if (score >= ARCHETYPE_SIM_STRONG) {
    return { reason: `name-similarity(${score.toFixed(2)})`, score };
  }

  // 6. 회색지대는 '효과'로 판정한다.
  //    comboAction은 8종뿐이라 blocking key로 신뢰도가 높다.
  if (score >= ARCHETYPE_SIM_WEAK) {
    const aAct = a.comboAction || (a.synergy && a.synergy.type);
    const bAct = b.comboAction || (b.synergy && b.synergy.type);
    if (aAct && bAct && aAct === bAct) {
      return { reason: `similar+sameCombo(${score.toFixed(2)})`, score };
    }
    if (a.element && b.element && a.element === b.element && score >= 0.78) {
      return { reason: `similar+sameElement(${score.toFixed(2)})`, score };
    }
  }

  // 7. 공통 어미 명사(head noun) + 동일 콤보 + 동일 속성
  //    "뇌제 발키리" / "뇌신 발키리" 처럼 수식어만 갈아끼운 케이스를 잡는다.
  //    세 조건을 모두 요구하므로 "화염 기사단"/"서리 기사단" 같은 정당한 분리는 살아남는다.
  const aTokens = tokenizeArchetypeName(a.name);
  const bTokens = tokenizeArchetypeName(b.name);
  if (aTokens.length > 1 && bTokens.length > 1) {
    const aHead = aTokens[aTokens.length - 1];
    const bHead = bTokens[bTokens.length - 1];
    const aAct = a.comboAction || (a.synergy && a.synergy.type);
    const bAct = b.comboAction || (b.synergy && b.synergy.type);
    if (aHead && aHead === bHead && aHead.length >= 2
        && aAct && bAct && aAct === bAct
        && a.element && b.element && a.element === b.element) {
      return { reason: `sameHeadNoun+combo(${aHead})`, score: 0.8 };
    }
  }

  return null;
}

// 신규 카드군 후보를 누적 DB와 대조. 흡수 대상이 있으면 {match, reason, score} 반환.
export function resolveArchetype(themeData, list = null) {
  const pool = list || state.archetypesList || DEFAULT_THEME_ARCHETYPES;
  if (!themeData || !pool || pool.length === 0) return null;

  // LLM이 기존 id를 그대로 지목했고 실제 존재하면 그게 정답
  if (themeData.id) {
    const byId = pool.find(a => a.id === themeData.id);
    if (byId) return { match: byId, reason: 'id-exact', score: 1 };
  }

  // 과거에 흡수된 별칭(aliases)과도 대조
  const candName = normalizeArchetypeName(themeData.name || '');
  if (candName) {
    const byAlias = pool.find(a => (a.aliases || []).some(al => normalizeArchetypeName(al) === candName));
    if (byAlias) return { match: byAlias, reason: 'alias-exact', score: 1 };
  }

  let best = null;
  for (const arc of pool) {
    const verdict = compareArchetypeIdentity(themeData, arc);
    if (verdict && (!best || verdict.score > best.score)) {
      best = { match: arc, reason: verdict.reason, score: verdict.score };
    }
  }
  return best;
}

// 🔍 카드 이름/콘셉트 텍스트로 소속 카드군 추론 (themeName이 없는 카드용 폴백)
export function findMatchingArchetype(conceptText = '', element = '') {
  if (!state.archetypesList || state.archetypesList.length === 0) return null;
  const raw = (conceptText || '').toLowerCase();
  const norm = normalizeArchetypeName(conceptText);
  if (!norm) return null;

  let bestMatch = null;
  let highestScore = 0;

  for (const arc of state.archetypesList) {
    let score = 0;
    const name = normalizeArchetypeName(arc.name || '');
    const keyword = normalizeArchetypeName(arc.keyword || '');
    const seeds = (arc.seeds || []).map(s => (s || '').toLowerCase());

    if (keyword && keyword.length >= 2 && norm.includes(keyword)) score += 10;
    if (name && norm.includes(name)) score += 15;
    // 표기가 흔들려도 잡히도록 유사도 가산 (최대 12점)
    if (name) score += Math.round(stringSimilarity(norm, name) * 12);
    if (element && arc.element === element) score += 3;

    for (const seed of seeds) {
      if (seed && raw.includes(seed)) score += 5;
    }

    if (score > highestScore && score >= 8) {
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

  // 🔗 신규 등록 전 동일성 게이트 — 표기만 다른 같은 카드군은 여기서 흡수된다
  const resolved = resolveArchetype({
    id: themeData.id,
    name: trimmedName,
    keyword: trimmedKeyword,
    element: themeData.element,
    comboAction: themeData.comboAction || themeData.themeComboAction,
    synergy: themeData.synergy
  });
  const existing = resolved ? resolved.match : null;

  if (existing) {
    // 기존 카드군으로 흡수 & 정보 보강
    if (themeData.comboAction && !existing.comboAction) existing.comboAction = themeData.comboAction;
    if (themeData.themeComboDesc && !existing.description) existing.description = themeData.themeComboDesc;

    // 흡수한 표기 변형을 별칭으로 남겨두면 다음 판정이 더 정확해진다
    if (trimmedName && trimmedName !== existing.name) {
      if (!existing.aliases) existing.aliases = [];
      if (!existing.aliases.includes(trimmedName)) existing.aliases.push(trimmedName);
      console.log(`[Archetype DB] 🔗 중복 카드군 흡수: "${trimmedName}" → [${existing.name}] (사유: ${resolved.reason})`);
    }
    if (trimmedKeyword && !(existing.seeds || []).includes(trimmedKeyword)) {
      existing.seeds = [...(existing.seeds || []), trimmedKeyword];
    }

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
    aliases: [],
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
// id를 함께 노출해야 LLM이 "새로 짓기" 대신 "기존 id 재사용"을 선택할 수 있다.
// 카드군이 무한 누적되면 로컬 LLM 컨텍스트를 잡아먹으므로 보유 카드 수 기준 상위 N개만 싣는다.
export function getArchetypesPromptSummary(limit = 40) {
  const list = state.archetypesList || DEFAULT_THEME_ARCHETYPES;
  if (!list || list.length === 0) return '(현재 등록된 카드군 없음 - LLM이 자유롭게 신규 카드군을 창설하세요)';

  const counts = {};
  (state.cardsCollection || []).forEach(c => {
    const id = c.themeId || (c.theme && c.theme.id);
    if (id) counts[id] = (counts[id] || 0) + 1;
  });

  const sorted = [...list].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const shown = sorted.slice(0, limit);

  const lines = shown.map(a =>
    `- id:"${a.id}" | 이름:[${a.name}] | 키워드:"${a.keyword}" | 속성:${a.element} | 콤보:${a.comboAction || 'search'} → ${a.description}`
  );

  if (sorted.length > shown.length) {
    lines.push(`- (그 외 ${sorted.length - shown.length}개 카드군 생략)`);
  }
  return lines.join('\n');
}

// ============================================================
// 🧹 이미 누적된 중복 카드군 병합 마이그레이션
// ------------------------------------------------------------
// 동일성 게이트가 없던 시절에 쌓인 표기 변형 카드군들을 대표 1개로 합치고,
// 보유 카드의 소속(themeId/themeName/themeKeyword)까지 재매핑한다.
// 덮어쓰기 전 스냅샷을 남기므로 restoreArchetypeBackup()으로 되돌릴 수 있다.
// ============================================================
export const STORAGE_KEY_ARCHETYPES_BACKUP = 'novel_duelist_archetypes_backup_pre_merge';

// 중복 쌍에서 살아남을 대표를 고른다: 기본 제공 카드군 > 보유 카드 많은 쪽 > 먼저 만들어진 쪽
function pickSurvivor(a, b, cardCounts) {
  const aDefault = DEFAULT_THEME_ARCHETYPES.some(d => d.id === a.id);
  const bDefault = DEFAULT_THEME_ARCHETYPES.some(d => d.id === b.id);
  if (aDefault !== bDefault) return aDefault ? a : b;

  const aCount = cardCounts[a.id] || 0;
  const bCount = cardCounts[b.id] || 0;
  if (aCount !== bCount) return aCount > bCount ? a : b;

  const aTime = Date.parse(a.createdAt || '') || 0;
  const bTime = Date.parse(b.createdAt || '') || 0;
  return aTime <= bTime ? a : b;
}

export async function mergeDuplicateArchetypes({ dryRun = false, silent = false } = {}) {
  const list = state.archetypesList || [];
  if (list.length < 2) return { merged: 0, remaining: list.length, mapping: {}, log: [] };

  const cardCounts = {};
  (state.cardsCollection || []).forEach(c => {
    const id = c.themeId || (c.theme && c.theme.id);
    if (id) cardCounts[id] = (cardCounts[id] || 0) + 1;
  });

  const canonical = [];
  const mapping = {};   // 흡수된 id -> 대표 id
  const log = [];

  for (const arc of list) {
    let absorbed = false;

    for (let i = 0; i < canonical.length; i++) {
      const verdict = compareArchetypeIdentity(arc, canonical[i]);
      if (!verdict) continue;

      const survivor = pickSurvivor(canonical[i], arc, cardCounts);
      const loser = (survivor === arc) ? canonical[i] : arc;

      if (!survivor.aliases) survivor.aliases = [];
      if (loser.name && loser.name !== survivor.name && !survivor.aliases.includes(loser.name)) {
        survivor.aliases.push(loser.name);
      }
      if (!survivor.comboAction && loser.comboAction) survivor.comboAction = loser.comboAction;
      if (!survivor.description && loser.description) survivor.description = loser.description;
      survivor.seeds = Array.from(new Set([...(survivor.seeds || []), ...(loser.seeds || [])]));

      // 이전에 loser로 매핑돼 있던 것들도 새 대표로 재지정 (연쇄 병합 대응)
      Object.keys(mapping).forEach(k => { if (mapping[k] === loser.id) mapping[k] = survivor.id; });
      mapping[loser.id] = survivor.id;

      canonical[i] = survivor;
      log.push({ 흡수됨: loser.name, 대표: survivor.name, 사유: verdict.reason });
      absorbed = true;
      break;
    }

    if (!absorbed) canonical.push(arc);
  }

  const mergedCount = log.length;
  if (mergedCount === 0) {
    if (!silent) console.log('[Archetype DB] ✅ 중복 카드군 없음.');
    return { merged: 0, remaining: canonical.length, mapping, log };
  }

  if (!silent) {
    console.group(`[Archetype DB] 🧹 중복 카드군 ${mergedCount}건 병합 (${list.length}개 → ${canonical.length}개)`);
    console.table(log);
    console.groupEnd();
  }

  if (dryRun) return { merged: mergedCount, remaining: canonical.length, mapping, log, dryRun: true };

  // 롤백용 스냅샷: 카드군 목록 + 카드별 소속을 함께 저장해야 완전 복원이 된다
  const cards = state.cardsCollection || [];
  await dbSave(STORAGE_KEY_ARCHETYPES_BACKUP, {
    savedAt: new Date().toISOString(),
    list,
    cardThemes: cards.map((c, idx) => ({
      idx,
      id: c.id,
      themeId: c.themeId,
      themeName: c.themeName,
      themeKeyword: c.themeKeyword
    }))
  });

  // 보유 카드의 소속 재매핑
  let remapped = 0;
  cards.forEach(c => {
    const oldId = c.themeId || (c.theme && c.theme.id);
    const targetId = oldId ? mapping[oldId] : null;
    if (!targetId) return;
    const target = canonical.find(a => a.id === targetId);
    if (!target) return;
    c.themeId = target.id;
    c.themeName = target.name;
    c.themeKeyword = target.keyword;
    if (c.theme) c.theme = target;
    remapped++;
  });

  state.archetypesList = canonical;
  await saveArchetypesToStorage();
  if (remapped > 0) await saveCardsToStorage();

  if (!silent) {
    console.log(`[Archetype DB] ✅ 병합 완료 — 카드 ${remapped}장의 소속을 대표 카드군으로 재매핑했습니다. 되돌리려면 콘솔에서 restoreArchetypeBackup() 실행.`);
  }
  return { merged: mergedCount, remaining: canonical.length, mapping, log, remapped };
}

// ⏪ 병합 직전 스냅샷으로 완전 복원 (카드군 목록 + 카드 소속)
export async function restoreArchetypeBackup() {
  const backup = await dbLoad(STORAGE_KEY_ARCHETYPES_BACKUP);
  if (!backup || !backup.list) {
    console.warn('[Archetype DB] 복원할 백업 스냅샷이 없습니다.');
    return false;
  }

  state.archetypesList = backup.list;
  await saveArchetypesToStorage();

  const cards = state.cardsCollection || [];
  let restored = 0;
  (backup.cardThemes || []).forEach(snap => {
    const card = (snap.id && cards.find(c => c.id === snap.id)) || cards[snap.idx];
    if (!card) return;
    card.themeId = snap.themeId;
    card.themeName = snap.themeName;
    card.themeKeyword = snap.themeKeyword;
    restored++;
  });
  if (restored > 0) await saveCardsToStorage();

  console.log(`[Archetype DB] ⏪ ${backup.savedAt} 시점으로 복원했습니다. (카드군 ${backup.list.length}개, 카드 소속 ${restored}건)`);
  if (window._renderGrimoire) window._renderGrimoire();
  return true;
}

// ============================================================
// 🏷️ 카드 이름에 카드군 키워드 강제 삽입 (유희왕식 소속 판정)
// ------------------------------------------------------------
// 덱 서치 콤보가 c.name.includes(theme.keyword)에 의존하므로,
// 이름에 키워드가 없으면 같은 카드군인데도 서치 대상에서 누락된다.
// 프롬프트에서 1차로 지시하고, 그래도 빠지면 여기서 보정한다.
// ============================================================
export function enforceKeywordInName(cardName = '', theme = null) {
  const name = String(cardName || '').trim();
  if (!theme || !name) return name;

  const keyword = String(theme.keyword || '').trim();
  if (!keyword || keyword.length < 2) return name;

  if (name.includes(keyword)) return name;
  if (theme.name && name.includes(theme.name)) return name; // 카드군명 전체를 이미 담고 있음

  return `${keyword} ${name}`;
}
