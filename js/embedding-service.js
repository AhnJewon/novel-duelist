// embedding-service.js - 한국어 임베딩 기반 의미 유사도
//
// 왜 필요한가:
//   1) 문자열 유사도로는 "빙결의 절도"와 "영토 동결령"을 못 잡는다.
//      두 이름의 bigram Dice 계수는 0에 가깝지만 의미는 사실상 같다.
//      한국어 동의어(빙결/동결/결빙/서리)를 손으로 사전에 넣는 건 지는 싸움이다.
//   2) 카드군이 늘어나면 프롬프트에 전부 싣는 방식이 컨텍스트를 잡아먹는다.
//      실측: 카드군 40개 = 약 8,600토큰 → num_ctx 8192를 105% 점유.
//      의미 유사 top-k만 싣도록 바꾸면 이 문제가 사라진다.
//
// ⚠️ 임베딩 모델이 없어도 게임은 정상 동작해야 한다.
//    모든 함수는 실패 시 null/빈 배열을 돌려주고, 호출부는 문자열 방식으로 폴백한다.

import { state, dbLoad, dbSave } from './storage.js';

export const STORAGE_KEY_EMBEDDINGS = 'novel_duelist_archetype_embeddings';

// 임베딩 전용 모델. 카드 생성용 LLM과 별개다.
export const DEFAULT_EMBED_MODEL = 'bge-m3';

// 의미 유사도 임계값 — bge-m3 실측 보정치 (2026-09-01)
//
// ⚠️ 이 수치는 감으로 정한 게 아니라 실제 측정에서 나왔습니다.
//    처음엔 MERGE 0.88 / GRAY 0.75로 잡았다가 전부 틀린 것으로 드러났습니다.
//
// 실측 (bge-m3, 같은 속성 안에서 비교):
//   병합 필요:  빙결의 절도/영토 동결령 0.669 · 서리 마법결사/한파의 마도회 0.741
//              절대영도 결사/빙하의 군단 0.755
//   별개 유지:  서리 마법결사/심해의 수호자 0.543 · 홍련의 검사단/용암 대장간 0.581
//   → 분리 마진 +0.088
//
// ⚠️ 속성이 다르면 유사도를 보지 않습니다. 실측에서 "화염 기사단" vs "서리 기사단"이
//    0.731로 나왔습니다. 구조가 같아서(X 기사단) 임베딩이 가깝게 보지만
//    속성이 다르면 명백히 다른 카드군입니다. bge-m3는 심층 의미보다
//    표층 구조에 더 반응하므로 속성 같은 하드 신호로 먼저 걸러야 합니다.
export const EMBED_SIM_MERGE = 0.72;  // 이 이상 + 같은 속성 → 같은 카드군
export const EMBED_SIM_GRAY = 0.60;   // 이 이상 → 회색지대, LLM에게 되묻는다

let _available = null;          // null=미확인, true/false=확인됨
let _vectors = null;            // { [archetypeId]: number[] }

function embedModel() {
  return (state.settings && state.settings.embedModel) || DEFAULT_EMBED_MODEL;
}

function baseUrl() {
  return (state.settings && state.settings.llmUrl) || 'http://127.0.0.1:11434';
}

/**
 * 임베딩 모델이 실제로 설치돼 있는지 확인한다. 결과는 캐시된다.
 * @param {boolean} force 캐시를 무시하고 다시 확인
 */
export async function checkEmbeddingAvailable(force = false) {
  if (!force && _available !== null) return _available;
  try {
    const resp = await fetch(`${baseUrl()}/api/tags`, { method: 'GET' });
    if (!resp.ok) { _available = false; return false; }
    const data = await resp.json();
    const names = (data.models || []).map(m => m.name);
    const target = embedModel();
    _available = names.some(n => n === target || n.startsWith(target + ':'));
    if (!_available) {
      console.info(
        `[Embedding] '${target}' 모델이 없어 문자열 유사도로만 동작합니다.\n` +
        `            의미 기반 카드군 판정을 켜려면:  ollama pull ${target}`
      );
    }
    return _available;
  } catch (e) {
    _available = false;
    return false;
  }
}

/**
 * 텍스트 하나를 임베딩한다. 실패하면 null.
 */
export async function embed(text, { timeoutMs = 20000 } = {}) {
  const input = String(text || '').trim();
  if (!input) return null;
  if (!(await checkEmbeddingAvailable())) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl()}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: embedModel(), input })
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    // /api/embed 는 embeddings: [[...]], 구버전 /api/embeddings 는 embedding: [...]
    const vec = (data.embeddings && data.embeddings[0]) || data.embedding || null;
    return Array.isArray(vec) && vec.length > 0 ? vec : null;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[Embedding] 임베딩 실패:', e.message);
    return null;
  }
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 카드군을 임베딩할 때 쓰는 텍스트.
 * 이름만으로는 단서가 부족하므로 키워드·속성·연계·설명을 함께 넣는다.
 */
export function archetypeToText(arc) {
  return [
    arc.name,
    arc.keyword,
    arc.element,
    arc.comboAction,
    arc.description
  ].filter(Boolean).join(' / ');
}

async function loadVectors() {
  if (_vectors) return _vectors;
  _vectors = (await dbLoad(STORAGE_KEY_EMBEDDINGS)) || {};
  return _vectors;
}

async function saveVectors() {
  if (_vectors) await dbSave(STORAGE_KEY_EMBEDDINGS, _vectors);
}

/**
 * 벡터가 없는 카드군의 임베딩을 생성해 저장한다.
 * 벡터는 archetypesList와 분리된 IndexedDB 키에 둔다
 * (1024차원 × N개를 카드군 레코드에 넣으면 localStorage 백업이 터진다).
 */
export async function ensureArchetypeEmbeddings({ silent = true } = {}) {
  if (!(await checkEmbeddingAvailable())) return { generated: 0, skipped: true };

  const vectors = await loadVectors();
  const list = state.archetypesList || [];
  let generated = 0;

  for (const arc of list) {
    if (vectors[arc.id]) continue;
    const vec = await embed(archetypeToText(arc));
    if (vec) { vectors[arc.id] = vec; generated++; }
  }

  // 사라진 카드군의 벡터 정리 (병합 후 고아 벡터가 남는다)
  const liveIds = new Set(list.map(a => a.id));
  for (const id of Object.keys(vectors)) {
    if (!liveIds.has(id)) delete vectors[id];
  }

  if (generated > 0) await saveVectors();
  if (!silent && generated > 0) {
    console.log(`[Embedding] 카드군 ${generated}개의 의미 벡터를 생성했습니다.`);
  }
  return { generated, skipped: false };
}

/** 카드군 하나의 벡터를 갱신한다 (이름/설명이 바뀌었을 때) */
export async function refreshArchetypeEmbedding(arc) {
  if (!arc || !(await checkEmbeddingAvailable())) return null;
  const vec = await embed(archetypeToText(arc));
  if (!vec) return null;
  const vectors = await loadVectors();
  vectors[arc.id] = vec;
  await saveVectors();
  return vec;
}

// 두 카드군의 속성이 겹치는가.
// ⚠️ 다속성(multi) 카드군은 대표 속성 하나로 판단하면 안 된다.
//    "엘리멘틀 히어로"(대표 fire, 실제 6속성)와 "원소 영웅단"(water)은
//    대표 속성만 보면 별개로 갈리지만 실제로는 같은 카드군일 수 있다.
function elementsOverlap(a, b) {
  const listOf = x => (Array.isArray(x.elements) && x.elements.length > 0)
    ? x.elements
    : (x.element ? [x.element] : []);
  const A = listOf(a), B = listOf(b);
  if (A.length === 0 || B.length === 0) return true;   // 정보가 없으면 막지 않는다
  // 한쪽이라도 다속성이면 겹칠 여지가 크므로 통과시키고 유사도로 판단한다
  if (a.elementPolicy === 'multi' || b.elementPolicy === 'multi') return true;
  return A.some(e => B.includes(e));
}

/**
 * 컨셉 텍스트와 의미가 가까운 카드군을 찾는다.
 *
 * @param opts.topK           최대 개수
 * @param opts.minSimilarity  하한
 * @param opts.element        지정하면 **같은 속성만** 본다.
 *                            정체성 판정에는 반드시 넣으세요 — 속성이 다르면
 *                            "화염 기사단"과 "서리 기사단"이 0.73으로 잡힙니다.
 *                            (프롬프트용 검색에는 넣지 마세요. 관련 카드군을 폭넓게 봐야 합니다)
 * @returns [{ arc, similarity }] — 유사도 내림차순. 임베딩이 없으면 빈 배열.
 */
export async function findSimilarArchetypes(conceptText, { topK = 5, minSimilarity = 0, element = null } = {}) {
  if (!(await checkEmbeddingAvailable())) return [];

  const queryVec = await embed(conceptText);
  if (!queryVec) return [];

  await ensureArchetypeEmbeddings();
  const vectors = await loadVectors();

  return (state.archetypesList || [])
    .filter(arc => !element || elementsOverlap(arc, { element }))
    .map(arc => ({ arc, similarity: cosineSimilarity(queryVec, vectors[arc.id]) }))
    .filter(r => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * 두 카드군이 의미상 같은지 판정한다.
 * 속성이 다르면 유사도를 보지 않고 바로 'distinct'다.
 * @returns { similarity, verdict: 'merge'|'gray'|'distinct' } 또는 null(임베딩 없음)
 */
export async function compareArchetypeSemantics(a, b) {
  if (!(await checkEmbeddingAvailable())) return null;

  // 속성 하드 게이트 — 실측 근거는 파일 상단 임계값 주석 참고
  if (!elementsOverlap(a, b)) {
    return { similarity: 0, verdict: 'distinct', reason: 'no-element-overlap' };
  }

  const [va, vb] = await Promise.all([embed(archetypeToText(a)), embed(archetypeToText(b))]);
  if (!va || !vb) return null;

  const similarity = cosineSimilarity(va, vb);
  const verdict = similarity >= EMBED_SIM_MERGE ? 'merge'
    : similarity >= EMBED_SIM_GRAY ? 'gray'
    : 'distinct';
  return { similarity, verdict };
}

/** 진단용 — 캐시를 비우고 다시 확인하게 만든다 */
export function resetEmbeddingCache() {
  _available = null;
  _vectors = null;
}

/** 저장된 모든 카드군 벡터를 삭제한다 (카드군 초기화 시) */
export async function clearAllEmbeddings() {
  _vectors = {};
  await dbSave(STORAGE_KEY_EMBEDDINGS, {});
}
