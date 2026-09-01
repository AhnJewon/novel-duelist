// archetype-service.js - LLM 자율 생성 카드군(Archetype/Theme) 영구 누적 DB & 범용 TCG 콤보 엔진

import { state, dbLoad, dbSave, saveCardsToStorage, saveActiveDeckToStorage } from './storage.js';
import { DEFAULT_THEME_ARCHETYPES } from './data.js';
import { runArchetypeCombo, normalizeComboAction, inferComboActionFromText } from './archetype-combos.js';
import { evaluateCardPower, sanitizeAndClampCardData } from './config.js';
import { nameMatchesType, fixCardName } from './card-naming.js';
import { sanitizeElementPolicy, normalizeTrigger, normalizeScaling,
         coerceCardElement, describeCombo, isElementAllowed,
         normalizeComboScope, describeScope } from './archetype-identity.js';
import { findSimilarArchetypes, compareArchetypeSemantics, ensureArchetypeEmbeddings,
         refreshArchetypeEmbedding, clearAllEmbeddings, resetEmbeddingCache,
         EMBED_SIM_MERGE, EMBED_SIM_GRAY } from './embedding-service.js';

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

/**
 * 신규 카드군 후보를 누적 DB와 대조한다. **의미 유사도까지 함께 본다.**
 *
 * 판정 순서:
 *   1. 문자열 게이트 (동기, 무료) — 표기 변형을 잡는다
 *   2. 의미 게이트 (임베딩) — "빙결의 절도" vs "영토 동결령"처럼
 *      문자열로는 0에 가깝지만 의미가 같은 경우를 잡는다
 *
 * 임베딩 모델이 없으면 1번만 수행한다 (기존 동작과 동일).
 *
 * @returns { match, reason, score, source:'string'|'embedding' } 또는 null
 */
export async function resolveArchetypeAsync(themeData, list = null) {
  // 1) 문자열 게이트 먼저 (임베딩 호출 없이 확정되면 그대로 끝낸다)
  const byString = resolveArchetype(themeData, list);
  if (byString && byString.score >= ARCHETYPE_SIM_STRONG) {
    return { ...byString, source: 'string' };
  }

  // 2) 의미 게이트
  try {
    const conceptText = [themeData.name, themeData.keyword, themeData.element,
                         themeData.comboAction, themeData.description].filter(Boolean).join(' / ');
    const similar = await findSimilarArchetypes(conceptText, { topK: 3, element: themeData.element });
    if (similar.length > 0) {
      const top = similar[0];
      if (top.similarity >= EMBED_SIM_MERGE) {
        return {
          match: top.arc,
          reason: `semantic(${top.similarity.toFixed(3)})`,
          score: top.similarity,
          source: 'embedding'
        };
      }
      // 회색지대는 흡수하지 않고 정보만 돌려준다. 판단은 호출부(피드백 루프)의 몫이다.
      if (top.similarity >= EMBED_SIM_GRAY) {
        return {
          match: top.arc,
          reason: `semantic-gray(${top.similarity.toFixed(3)})`,
          score: top.similarity,
          source: 'embedding',
          gray: true
        };
      }
    }
  } catch (e) {
    console.warn('[Archetype] 의미 게이트 실패, 문자열 판정만 사용:', e.message);
  }

  return byString ? { ...byString, source: 'string' } : null;
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

// 카드군 표기에서 괄호·따옴표 같은 장식을 벗겨낸다.
// LLM은 "(절) [빙결의 절도]" 처럼 대괄호·소괄호를 즐겨 붙이는데,
// 이게 그대로 키워드가 되면 카드 이름이 "(절) [서리의 얼음술사]"처럼 지저분해진다.
function stripDecorations(raw = '') {
  return String(raw)
    .replace(/[\[\]（）()【】〈〉《》「」『』"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 카드군 키워드를 정제한다.
//
// ⚠️ 한 글자 키워드 금지: 카드 이름 포함 판정(`name.includes(keyword)`)과
//    동일성 판정에 모두 쓰이는데, 한 글자는 관계없는 단어에 마구 걸린다.
//    실제로 "빙결의 절도"에서 키워드가 '절' 하나로 잡혀
//    카드 이름이 "(절) [서리의 얼음술사]"가 되고 카드군 매칭도 망가졌다.
export function sanitizeArchetypeKeyword(rawKeyword = '', archetypeName = '') {
  let kw = stripDecorations(rawKeyword);

  // 조사만 남은 꼬리 제거 ("홍련의" -> "홍련")
  kw = kw.replace(/(의|은|는|이|가|을|를)$/, '').trim();

  // 2~5글자면 그대로 채택
  if (kw.length >= 2 && kw.length <= 5) return kw;

  // 너무 짧거나 길면 카드군 이름의 첫 어절에서 다시 뽑는다
  const nameTokens = stripDecorations(archetypeName)
    .split(/[\s·・、,]+/)
    .map(t => t.replace(/(의|은|는|이|가|을|를)$/, '').trim())
    .filter(t => t.length >= 2);

  if (nameTokens.length > 0) {
    const head = nameTokens[0];
    return head.length > 5 ? head.slice(0, 4) : head;
  }

  // 최후 폴백: 이름 앞 2글자
  const fallback = stripDecorations(archetypeName).replace(/\s/g, '').slice(0, 2);
  return fallback || kw.slice(0, 2);
}

// ✨ LLM이 생성한 새로운 카드군 테마 등록 및 DB 영구 누적 저장
export async function registerNewArchetype(themeData) {
  if (!themeData || !themeData.name) return null;
  if (!state.archetypesList) state.archetypesList = [...DEFAULT_THEME_ARCHETYPES];

  const trimmedName = stripDecorations(themeData.name);
  const trimmedKeyword = sanitizeArchetypeKeyword(
    themeData.keyword || themeData.themeKeyword || '', trimmedName);

  // 🔗 신규 등록 전 동일성 게이트 — 표기만 다른 같은 카드군은 여기서 흡수된다
  const resolved = await resolveArchetypeAsync({
    id: themeData.id,
    name: trimmedName,
    keyword: trimmedKeyword,
    element: themeData.element,
    comboAction: themeData.comboAction || themeData.themeComboAction,
    synergy: themeData.synergy
  });
  const existing = (resolved && !resolved.gray) ? resolved.match : null;

  if (existing) {
    // 기존 카드군으로 흡수 & 정보 보강
    // 🐛 수정: 예전에는 원시값을 그대로 넣어 LLM이 뱉은 enum 문자열
    //          ("search|freeze|shieldHeal")이 그대로 저장됐다.
    const incomingAction = normalizeComboAction(themeData.comboAction || themeData.themeComboAction);
    if (incomingAction && !existing.comboAction) existing.comboAction = incomingAction;
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

  // 액션 추론 (키워드 힌트 테이블은 archetype-combos.js가 단일 소스)
  const comboAction = normalizeComboAction(themeData.comboAction || themeData.themeComboAction)
    || inferComboActionFromText(themeData.description || themeData.themeComboDesc || '');

  const newId = themeData.id || `theme_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  // 🎨 속성 정책 교정 (상극 조합 제거, 개수 상한 적용)
  const elementSpec = sanitizeElementPolicy({
    elementPolicy: themeData.elementPolicy,
    elements: themeData.elements,
    element: themeData.element || 'fire'
  });

  const newTheme = {
    id: newId,
    name: trimmedName,
    title: themeData.title || trimmedName,
    keyword: trimmedKeyword,
    icon: themeData.icon || '⚜️',
    badge: themeData.badge || 'bg-slate-800 text-slate-200 border-slate-600',
    description: themeData.description || themeData.themeComboDesc || `${trimmedName} 카드군 연계`,

    // 🎨 속성 정책
    element: elementSpec.element,           // 대표 속성 (기존 필드 호환)
    elements: elementSpec.elements,         // 허용 속성 목록
    elementPolicy: elementSpec.elementPolicy, // mono | dual | multi

    // ⚡ 고유 연계 = 액션 × 발동조건 × 증가방식
    comboAction: comboAction,
    comboTrigger: normalizeTrigger(themeData.comboTrigger),
    comboScaling: normalizeScaling(themeData.comboScaling),
    comboScope: normalizeComboScope(themeData.comboScope),
    comboScopeValue: themeData.comboScopeValue || 'unit',
    comboValue: themeData.comboValue || 8,

    synergy: {
      type: comboAction,
      name: `${trimmedName} 연계`,
      desc: themeData.themeComboDesc || themeData.description || `[${trimmedName}] 카드군 상호 연계`
    },
    seeds: themeData.seeds || [trimmedName, trimmedKeyword],
    aliases: [],
    createdAt: new Date().toISOString()
  };

  state.archetypesList.push(newTheme);
  await saveArchetypesToStorage();
  await refreshArchetypeEmbedding(newTheme);
  console.log(`[Archetype DB] ✨ 신규 카드군 등록: [${newTheme.name}] (총 ${state.archetypesList.length}개)`);
  return newTheme;
}

// ⚔️ 전장 내 카드군 전개 현황 평가기
//
// ⚠️ 설계 방침: 이 게임은 오토체스식 "같은 종족 N체 = 스탯 +N"을 쓰지 않는다.
//    카드군의 가치는 오직 유희왕식 연계(덱 서치 / 연쇄 / 특수 소환 / 결빙 등)로만 표현한다.
//    따라서 여기서는 스탯 보너스를 절대 계산하지 않으며, 전개 수는 순수 정보용이다.
//    (전개 수 자체는 chainDamage 콤보가 "같은 카드군 아군이 있으면 위력 증가"를
//     판정할 때 쓰이지만, 그 판정은 archetype-combos.js가 직접 수행한다)
export function evaluateFieldSynergy(minions = []) {
  if (!minions || minions.length === 0) return { synergies: [] };

  const themeCounts = {};
  minions.forEach(m => {
    const tId = m.themeId || (m.theme ? m.theme.id : null) || m.themeName;
    if (tId) themeCounts[tId] = (themeCounts[tId] || 0) + 1;
  });

  const pool = state.archetypesList || DEFAULT_THEME_ARCHETYPES;
  const active = [];

  for (const [tId, count] of Object.entries(themeCounts)) {
    if (count < 2) continue; // 2장 이상 전개됐을 때만 표시
    const theme = pool.find(a => a.id === tId || a.name === tId)
      || DEFAULT_THEME_ARCHETYPES.find(a => a.id === tId || a.name === tId);
    if (!theme) continue;

    active.push({
      themeId: theme.id,
      themeName: theme.name,
      icon: theme.icon || '⚜️',
      count,
      comboAction: normalizeComboAction(theme.comboAction || (theme.synergy && theme.synergy.type)),
      desc: theme.description || `${theme.name} 카드군 전개 중`
    });
  }

  return { synergies: active };
}

// 특정 소환수가 속한 카드군의 전개 정보를 찾는다 (UI 표시용)
export function findSynergyForEntity(synergyInfo, entity) {
  if (!synergyInfo || !synergyInfo.synergies || !entity) return null;
  return synergyInfo.synergies.find(s =>
    (entity.themeId && s.themeId === entity.themeId) ||
    (entity.themeName && s.themeName === entity.themeName)
  ) || null;
}

// 🎴 카드군 콤보 실행 (구현 테이블은 archetype-combos.js)
// 이전에는 플레이어용/보스용 8분기 if 사슬을 각각 들고 있어 약 280줄이 중복이었다.
function resolveThemeForCard(card, gameState) {
  const themeName = card.themeName || (card.theme && card.theme.name);
  const themeId = card.themeId || (card.theme && card.theme.id);
  if (!themeName && !themeId) return null;

  const pool = (gameState && gameState.archetypesList) || state.archetypesList || [];
  return pool.find(a =>
      a.id === themeId ||
      a.name === themeName ||
      (card.themeKeyword && a.keyword === card.themeKeyword))
    || DEFAULT_THEME_ARCHETYPES.find(a => a.id === themeId || a.name === themeName)
    || null;
}

export function triggerArchetypeCombo(card, gameState, helpers) {
  if (!card) return null;
  const theme = resolveThemeForCard(card, gameState);
  if (!theme) return null;
  return runArchetypeCombo('player', theme, card, gameState, helpers);
}

export function triggerBossArchetypeCombo(card, gameState, helpers) {
  if (!card) return null;
  const theme = resolveThemeForCard(card, gameState);
  if (!theme) return null;
  return runArchetypeCombo('boss', theme, card, gameState, helpers);
}

// LLM 프롬프트용 카드군 목록 문자열 생성
//
// ⚠️ 카드군 전체를 싣지 마세요. 실측으로 카드군 40개 = 약 8,600토큰이고
//    fast 모드 num_ctx가 8192라 목록만으로 컨텍스트가 넘칩니다.
//    카드 설계 지시와 스키마가 밀려나 생성 품질이 무너집니다.
//
// 임베딩 모델이 있으면 컨셉과 의미가 가까운 top-k만 싣고,
// 없으면 보유 카드 수 상위 N개로 폴백합니다.

function formatArchetypeLine(a, extra = '') {
  // 설명은 앞 60자만. 전체를 싣던 것이 토큰 낭비의 주범이었다.
  const desc = String(a.description || '').slice(0, 60);
  return `- id:"${a.id}" | 이름:[${a.name}] | 키워드:"${a.keyword}" | 속성:${a.element} | 연계:${a.comboAction || 'search'}${extra} → ${desc}`;
}

/** 폴백: 보유 카드 수 상위 N개 (임베딩 없을 때) */
export function getArchetypesPromptSummary(limit = 12) {
  const list = state.archetypesList || DEFAULT_THEME_ARCHETYPES;
  if (!list || list.length === 0) {
    return '(현재 등록된 카드군 없음 - 자유롭게 신규 카드군을 창설하세요)';
  }

  const counts = {};
  (state.cardsCollection || []).forEach(c => {
    const id = c.themeId || (c.theme && c.theme.id);
    if (id) counts[id] = (counts[id] || 0) + 1;
  });

  const sorted = [...list].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const shown = sorted.slice(0, limit);
  const lines = shown.map(a => formatArchetypeLine(a));

  if (sorted.length > shown.length) {
    lines.push(`- (그 외 ${sorted.length - shown.length}개 카드군은 생략됨)`);
  }
  return lines.join('\n');
}

/**
 * 컨셉과 의미가 가까운 카드군만 골라 프롬프트에 싣는다.
 * 임베딩 모델이 없으면 자동으로 위 폴백을 쓴다.
 *
 * @param conceptText 사용자 컨셉 / 카드 이름 등
 * @param topK        실을 개수 (기본 6)
 */
export async function getRelevantArchetypesPrompt(conceptText = '', topK = 6) {
  const list = state.archetypesList || [];
  if (list.length === 0) {
    return '(현재 등록된 카드군 없음 - 자유롭게 신규 카드군을 창설하세요)';
  }
  // 카드군이 적으면 그냥 전부 싣는 게 낫다
  if (list.length <= topK) {
    return list.map(a => formatArchetypeLine(a)).join('\n');
  }

  try {
    const similar = await findSimilarArchetypes(conceptText, { topK });
    if (similar.length > 0) {
      const lines = similar.map(({ arc, similarity }) =>
        formatArchetypeLine(arc, ` | 의미유사도:${similarity.toFixed(2)}`)
      );
      lines.push(`- (전체 ${list.length}개 중 컨셉과 가장 가까운 ${similar.length}개만 표시)`);
      return lines.join('\n');
    }
  } catch (e) {
    console.warn('[Archetype] 의미 검색 실패, 보유 수 기준으로 폴백:', e.message);
  }

  return getArchetypesPromptSummary(topK);
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
/**
 * 카드 이름 정리. **키워드를 강제로 붙이지 않는다.**
 *
 * 예전에는 유희왕식으로 "이름에 카드군 키워드 필수 포함"을 강제했다.
 * 하지만 유희왕이 그 룰을 쓰는 이유는 물리 카드라 DB 조회가 불가능해서다.
 * 이 게임은 카드마다 themeId를 들고 있고 카드에 카드군 뱃지도 따로 표시되므로
 * 그 제약을 물려받을 이유가 없다. 강제로 붙이니 "빙결의 동결의 수호자" 같은
 * 이름이 나왔다.
 *
 * 여기서는 LLM이 붙인 장식만 벗겨낸다. 키워드를 이름에 녹이는 것은
 * 프롬프트에서 '권장'하고, 잘 안 되면 그냥 뱃지에 맡긴다.
 */
export function cleanCardName(cardName = '') {
  let name = String(cardName || '');

  // 앞머리의 짧은 괄호 마커 제거: "(절) [서리의 얼음술사]" -> "[서리의 얼음술사]"
  name = name.replace(/^\s*[\[(（【〔][^\])）】〕]{1,6}[\])）】〕]\s*/, '');

  // 남은 괄호·따옴표 장식 제거
  name = stripDecorations(name);

  // 꼬리의 영어 부제 제거: "동결의 수호자 - Frost Guardian" -> "동결의 수호자"
  name = name.replace(/\s*[-–—:]\s*[A-Za-z][A-Za-z0-9\s']*$/, '').trim();

  return name;
}

// 구버전 호환 별칭 (theme 인자는 무시된다)
/** 카드 이름 길이 상한. LLM이 프롬프트의 "12자 이내"를 자주 어긴다. */
const MAX_CARD_NAME_LEN = 16;

/**
 * 카드명 정리 + **카드군 이름 중복 제거**.
 *
 * 🐛 LLM이 카드군 이름을 통째로 앞에 붙이는 일이 있다:
 *      "심연의 그림자단 심연의 암살자"   ← 카드군 + 실제 이름
 *    카드에는 소속이 뱃지로 따로 표시되므로 접두는 군더더기다.
 *    게다가 길어서 UI에서 잘려 나간다 ("심연의 그림자단 심연의 …").
 *
 * ⚠️ 키워드가 이름에 **한 번** 들어가는 건 자연스럽다 ("심연의 암살자 레이븐").
 *    카드군 이름이 통째로 접두일 때만 벗긴다.
 */
export function enforceKeywordInName(cardName = '', theme = null) {
  let name = cleanCardName(cardName);

  if (theme && theme.name) {
    const full = String(theme.name).trim();
    if (full && name.length > full.length && name.startsWith(full)) {
      const rest = name.slice(full.length).replace(/^[\s\-–—:]+/, '').trim();
      // 남은 부분이 이름 구실을 할 때만 벗긴다
      if (rest.length >= 2) name = rest;
    }
  }

  // 길이 상한 — 어절 경계에서 자르되 **뒤에서부터** 채운다.
  // 한국어 이름은 뒤쪽이 정체를 담는다 ("... 어둠의 암살자 카엘").
  // 앞에서 자르면 수식어만 남고 정작 누구인지가 사라진다.
  if (name.length > MAX_CARD_NAME_LEN) {
    const parts = name.split(/\s+/).filter(Boolean);
    let acc = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const next = acc ? `${parts[i]} ${acc}` : parts[i];
      if (next.length > MAX_CARD_NAME_LEN) break;
      acc = next;
    }
    name = acc || name.slice(-MAX_CARD_NAME_LEN);

    // 뒤에서 자르다 보면 앞에 문장 조각이 남는다 ("가진 어둠의 암살자 카엘").
    // 관형형 어미로 끝나는 첫 어절은 버린다.
    const toks = name.split(/\s+/);
    if (toks.length >= 3 && /(?:한|은|는|던|린|긴|진)$/.test(toks[0]) && !/의$/.test(toks[0])) {
      name = toks.slice(1).join(' ');
    }
  }

  return name.trim();
}


// 기본 카드군(data.js)의 정의가 바뀌면 저장본에 반영한다.
//
// 🐛 loadArchetypes()는 "없는 것만 추가"하므로, data.js에서 기존 카드군의
//    속성 정책·설명 등을 고쳐도 이미 저장된 사용자에게는 영원히 반영되지 않았다.
//    사용자가 쌓은 정보(별칭·시드·생성시각)는 보존한다.
const DEFINITION_FIELDS = ['name', 'title', 'keyword', 'icon', 'badge', 'description',
                           'element', 'elements', 'elementPolicy',
                           'comboAction', 'comboTrigger', 'comboScaling', 'synergy'];

function syncDefaultArchetypeDefinitions() {
  const changes = [];
  for (const def of DEFAULT_THEME_ARCHETYPES) {
    const stored = (state.archetypesList || []).find(a => a.id === def.id);
    if (!stored) continue;

    const diff = [];
    for (const key of DEFINITION_FIELDS) {
      if (!(key in def)) continue;
      const before = JSON.stringify(stored[key]);
      const after = JSON.stringify(def[key]);
      if (before !== after) {
        stored[key] = JSON.parse(after);
        diff.push(key);
      }
    }
    // 시드는 합집합으로 (사용자가 쌓은 것 보존)
    if (Array.isArray(def.seeds)) {
      const merged = Array.from(new Set([...(stored.seeds || []), ...def.seeds]));
      if (merged.length !== (stored.seeds || []).length) {
        stored.seeds = merged;
        diff.push('seeds');
      }
    }
    if (diff.length > 0) changes.push({ 카드군: def.name, 갱신필드: diff.join(', ') });
  }
  return changes;
}

// ============================================================
// 🧰 기존 카드군 레코드 보수 (1회성 마이그레이션)
// ------------------------------------------------------------
// 게이트 이전에 만들어진 레코드에는 아래 문제가 섞여 있다.
//   - 키워드가 "(절)" 처럼 괄호를 달고 있거나 한 글자
//   - comboAction에 LLM이 뱉은 enum 원문("search|freeze|shieldHeal")이 그대로 저장
//   - 카드 이름이 "(절) [서리의 얼음술사]" 형태
// 이름/키워드가 바뀌면 카드 소속 판정도 따라 바뀌므로 카드까지 같이 갱신한다.
// ============================================================
export async function repairArchetypeRecords({ dryRun = false, silent = false } = {}) {
  const list = state.archetypesList || [];

  // 기본 카드군 정의를 data.js와 동기화 (속성 정책 등 신규 필드 반영)
  const defSync = dryRun ? [] : syncDefaultArchetypeDefinitions();
  if (defSync.length > 0 && !silent) {
    console.group(`[Archetype Sync] 🔃 기본 카드군 ${defSync.length}건 정의 갱신`);
    console.table(defSync);
    console.groupEnd();
  }
  const log = [];

  for (const arc of list) {
    const before = { name: arc.name, keyword: arc.keyword, comboAction: arc.comboAction };

    const fixedName = stripDecorations(arc.name);
    const fixedKeyword = sanitizeArchetypeKeyword(arc.keyword, fixedName);
    const fixedAction = normalizeComboAction(arc.comboAction)
      || normalizeComboAction(arc.synergy && arc.synergy.type)
      || inferComboActionFromText(arc.description || '');

    const changes = [];
    if (fixedName !== arc.name) changes.push(`이름 "${arc.name}" → "${fixedName}"`);
    if (fixedKeyword !== arc.keyword) changes.push(`키워드 "${arc.keyword}" → "${fixedKeyword}"`);
    if (fixedAction !== arc.comboAction) changes.push(`콤보 "${arc.comboAction}" → "${fixedAction}"`);

    if (changes.length === 0) continue;

    if (!dryRun) {
      arc.name = fixedName;
      arc.keyword = fixedKeyword;
      arc.comboAction = fixedAction;
      if (arc.synergy) arc.synergy.type = fixedAction;
    }
    log.push({ 카드군: before.name, 수정: changes.join(' / ') });
  }

  // 카드 이름 정리 + 소속 정보 동기화 + 속성 정책 교정
  const cards = state.cardsCollection || [];
  let cardFixes = 0;
  const elementLog = [];
  const nameLog = [];
  for (const card of cards) {
    const theme = list.find(a => a.id === card.themeId || a.name === card.themeName);

    // 🏷️ 타입에 안 맞는 이름 교정 (건축물인데 "심연의 그림자 암살자" 등)
    //    이름 정리보다 **먼저** 해야 키워드 삽입이 교정된 이름 위에서 돈다.
    const typeName = nameMatchesType(card.name, card.cardType || 'unit')
      ? card.name
      : fixCardName(card.name, card.cardType || 'unit');
    const nameTypeFixed = typeName !== card.name;

    const cleaned = enforceKeywordInName(typeName, theme || null);

    // 🐛 카드군 속성 정책 위반 교정.
    //    카드팩이 카드군을 알기 전에 속성을 뽑아 저장하던 시절의 카드들은
    //    [심연의 그림자단](어둠/mono)에 화염·번개 카드가 섞여 있다.
    //    → card-pack.js에서 원인을 막았고, 여기서 기존 카드를 되돌린다.
    const elemFix = coerceCardElement(theme || null, card.element);
    const elementChanged = elemFix.changed && elemFix.element !== card.element;

    const nameSame = cleaned === card.name;
    const themeSame = !theme || (card.themeName === theme.name && card.themeKeyword === theme.keyword);
    if (nameSame && themeSame && !elementChanged) continue;

    // ⚠️ 로그는 값을 바꾸기 **전에** 남긴다 (안 그러면 dark → dark로 찍힌다)
    if (elementChanged) {
      elementLog.push({
        카드: card.name,
        카드군: theme ? theme.name : '-',
        변경: `${card.element} → ${elemFix.element}`
      });
    }
    if (nameTypeFixed) {
      nameLog.push({
        타입: card.cardType || 'unit',
        변경: `${card.name} → ${cleaned}`
      });
    }

    if (!dryRun) {
      card.name = cleaned;
      if (theme) {
        card.themeName = theme.name;
        card.themeKeyword = theme.keyword;
      }
      if (elementChanged) card.element = elemFix.element;
    }
    cardFixes++;
  }

  if (elementLog.length > 0 && !silent) {
    console.group(`[Element Repair] 🎨 카드군 속성 정책 위반 ${elementLog.length}건 교정${dryRun ? ' (미리보기)' : ''}`);
    console.table(elementLog);
    console.warn('일러스트는 이전 속성으로 그려진 상태입니다. 그림까지 맞추려면 해당 카드를 다시 생성하세요.');
    console.groupEnd();
  }

  if (nameLog.length > 0 && !silent) {
    console.group(`[Name Repair] 🏷️ 타입과 안 맞는 이름 ${nameLog.length}건 교정${dryRun ? ' (미리보기)' : ''}`);
    console.table(nameLog);
    console.groupEnd();
  }

  if (!silent) {
    if (log.length === 0 && cardFixes === 0) {
      console.log('[Archetype Repair] ✅ 보수할 레코드 없음.');
    } else {
      console.group(`[Archetype Repair] 🧰 카드군 ${log.length}건 / 카드 ${cardFixes}건 보수${dryRun ? ' (미리보기)' : ''}`);
      if (log.length) console.table(log);
      console.groupEnd();
    }
  }

  if (!dryRun && (log.length > 0 || cardFixes > 0 || defSync.length > 0)) {
    await saveArchetypesToStorage();
    if (cardFixes > 0) await saveCardsToStorage();
    if (window._renderGrimoire) window._renderGrimoire();
  }

  return { archetypes: log.length, cards: cardFixes, log, dryRun };
}

// ============================================================
// ⚖️ 보유 카드에 효과 예산 재적용 (1회성 마이그레이션)
// ------------------------------------------------------------
// 예산 시스템 도입 이전에 만들어진 카드는 등급에 안 맞는 효과를 갖고 있다.
// (RARE인데 무적/실드관통/처형을 동시에 보유 등)
// ============================================================
export const STORAGE_KEY_CARDS_BACKUP = 'novel_duelist_cards_backup_pre_rebalance';

export async function rebalanceExistingCards({ dryRun = false, silent = false } = {}) {
  const cards = state.cardsCollection || [];
  const log = [];
  const touched = [];

  for (const card of cards) {
    const before = evaluateCardPower(card);
    if (!before.overBudget && before.illegal.length === 0) continue;

    const fixed = sanitizeAndClampCardData(card);
    const after = evaluateCardPower(fixed);

    log.push({
      카드: card.name,
      등급: card.rarity,
      '전(사용)': before.used,
      '후(사용)': after.used,
      '지불가능': before.affordable,
      '마나': `${before.cost} → ${after.cost}`,
      제거됨: before.effects.filter(e => !after.effects.some(a => a.key === e.key)).map(e => e.label).join(', ')
    });
    touched.push({ card, fixed });
  }

  if (!silent) {
    if (log.length === 0) console.log('[Balance] ✅ 예산을 넘는 카드 없음.');
    else {
      console.group(`[Balance] ⚖️ 카드 ${log.length}장 재조정${dryRun ? ' (미리보기)' : ''}`);
      console.table(log);
      console.groupEnd();
    }
  }

  if (dryRun || log.length === 0) return { count: log.length, log, dryRun };

  // 되돌릴 수 있도록 스냅샷을 먼저 남긴다.
  // 카드 효과를 지우는 파괴적 작업이므로 백업 없이 실행하면 안 된다.
  await dbSave(STORAGE_KEY_CARDS_BACKUP, {
    savedAt: new Date().toISOString(),
    cards: JSON.parse(JSON.stringify(cards))
  });

  touched.forEach(({ card, fixed }) => {
    card.skill = fixed.skill;
    card.skills = [fixed.skill];
    card.attack = fixed.attack;
    card.hp = fixed.hp;
    card.defense = fixed.defense;
    card.cost = fixed.cost;
  });

  await saveCardsToStorage();
  if (window._renderGrimoire) window._renderGrimoire();
  if (!silent) {
    console.log('[Balance] 되돌리려면 콘솔에서 restoreCardsBackup() 실행.');
  }
  return { count: log.length, log };
}

// ⏪ 재조정 직전 카드 스냅샷으로 복원
export async function restoreCardsBackup() {
  const backup = await dbLoad(STORAGE_KEY_CARDS_BACKUP);
  if (!backup || !Array.isArray(backup.cards)) {
    console.warn('[Balance] 복원할 카드 백업이 없습니다.');
    return false;
  }
  state.cardsCollection = backup.cards;
  await saveCardsToStorage();
  console.log(`[Balance] ⏪ ${backup.savedAt} 시점 카드 ${backup.cards.length}장으로 복원했습니다.`);
  if (window._renderGrimoire) window._renderGrimoire();
  return true;
}

// ============================================================
// 🔄 카드군 초기화
// ------------------------------------------------------------
// LLM이 만든 카드군을 전부 지우고 기본 카드군(data.js)만 남긴다.
// 게이트·임베딩이 없던 시절에 쌓인 이상한 카드군을 청소하고
// 처음부터 다시 쌓고 싶을 때 쓴다.
//
// ⚠️ 카드는 기본적으로 보존한다. NovelAI 이미지 생성 비용이 들어간 자산이다.
//    소속만 잃고 '범용 카드'가 되며, 이후 카드군에 다시 편입시킬 수 있다.
// ============================================================
export const STORAGE_KEY_RESET_BACKUP = 'novel_duelist_archetypes_backup_pre_reset';

/**
 * @param opts.keepDefaults  기본 카드군 8종 유지 (기본 true)
 * @param opts.deleteCards   소속 카드까지 삭제 (기본 false — 범용으로 전환만)
 * @param opts.dryRun        미리보기
 */
export async function resetArchetypes({ keepDefaults = true, deleteCards = false, dryRun = false } = {}) {
  const list = state.archetypesList || [];
  const cards = state.cardsCollection || [];

  const defaultIds = new Set(DEFAULT_THEME_ARCHETYPES.map(d => d.id));
  const survivors = keepDefaults
    ? list.filter(a => defaultIds.has(a.id))
    : [];
  const removed = list.filter(a => !survivors.some(s => s.id === a.id));
  const removedIds = new Set(removed.map(a => a.id));

  const affectedCards = cards.filter(c => c.themeId && removedIds.has(c.themeId));

  const summary = {
    제거될_카드군: removed.map(a => `${a.name} (kw:${a.keyword})`),
    유지될_카드군: survivors.map(a => a.name),
    영향받는_카드: affectedCards.length,
    카드_처리: deleteCards ? '삭제' : '범용으로 전환 (보존)'
  };

  if (dryRun) {
    console.group('[Archetype Reset] 미리보기');
    console.log(summary);
    console.groupEnd();
    return { ...summary, dryRun: true };
  }

  if (removed.length === 0 && affectedCards.length === 0) {
    console.log('[Archetype Reset] ✅ 제거할 카드군이 없습니다.');
    return { ...summary, removed: 0 };
  }

  // 되돌릴 수 있도록 스냅샷
  await dbSave(STORAGE_KEY_RESET_BACKUP, {
    savedAt: new Date().toISOString(),
    archetypes: JSON.parse(JSON.stringify(list)),
    cards: JSON.parse(JSON.stringify(cards))
  });

  if (deleteCards) {
    const keepIds = new Set(cards.filter(c => !(c.themeId && removedIds.has(c.themeId))).map(c => c.id));
    state.cardsCollection = cards.filter(c => keepIds.has(c.id));
    state.activeDeckCardIds = (state.activeDeckCardIds || []).filter(id => keepIds.has(id));
  } else {
    affectedCards.forEach(c => {
      c.themeId = null;
      c.themeName = null;
      c.themeKeyword = null;
      c.isGeneric = true;
      if (c.theme) delete c.theme;
    });
  }

  state.archetypesList = survivors.length > 0 ? survivors : [...DEFAULT_THEME_ARCHETYPES];

  // 임베딩 벡터도 함께 정리
  await clearAllEmbeddings();
  resetEmbeddingCache();

  await saveArchetypesToStorage();
  await saveCardsToStorage();
  await saveActiveDeckToStorage();
  await ensureArchetypeEmbeddings({ silent: false });

  console.group(`[Archetype Reset] 🔄 카드군 ${removed.length}개 제거, 카드 ${affectedCards.length}장 ${deleteCards ? '삭제' : '범용 전환'}`);
  console.table(removed.map(a => ({ 제거된_카드군: a.name, 키워드: a.keyword, 속성: a.element })));
  console.log('되돌리려면 콘솔에서 restoreArchetypeReset() 실행.');
  console.groupEnd();

  if (window._renderGrimoire) window._renderGrimoire();
  return { ...summary, removed: removed.length };
}

/** ⏪ 초기화 직전 스냅샷으로 복원 */
export async function restoreArchetypeReset() {
  const backup = await dbLoad(STORAGE_KEY_RESET_BACKUP);
  if (!backup || !backup.archetypes) {
    console.warn('[Archetype Reset] 복원할 백업이 없습니다.');
    return false;
  }
  state.archetypesList = backup.archetypes;
  state.cardsCollection = backup.cards;
  await saveArchetypesToStorage();
  await saveCardsToStorage();
  resetEmbeddingCache();
  await ensureArchetypeEmbeddings({ silent: false });
  console.log(`[Archetype Reset] ⏪ ${backup.savedAt} 시점으로 복원했습니다.`);
  if (window._renderGrimoire) window._renderGrimoire();
  return true;
}
