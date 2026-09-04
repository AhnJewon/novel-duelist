// race-service.js - 🧬 LLM이 만든 새 종족을 등록·병합·저장한다 (DECISIONS #108)
//
// races.js는 **표**다 (import 0 — 그래야 cycle-roles 등이 순환 없이 쓴다).
// 이 파일은 그 표를 **자라게** 하는 쪽이다. archetype-identity(순수) ↔ archetype-service(상태)와 같은 갈래다.
//
// ── 왜 게이트가 필요한가 ────────────────────────────────
// 종족의 값은 "같은 종족이 여럿 모인다"에서 나온다 (comboScope: 'race' — #106).
// LLM이 카드마다 새 종족을 지으면 두 장이 같은 종족일 일이 없어져 **종족 시너지가 통째로 죽는다.**
// 카드군이 임베딩 유사도로 막는 것과 같은 문제이고, 같은 처방이 필요하다.
//
// 다만 종족은 카드군과 달리 **정의가 곧 태그 목록**이다("이 종족은 어떤 그림인가").
// 그래서 임베딩 대신 **이름 정규화 + 태그 겹침**으로 잰다 — 모델 없이도 돌고, 이 축에서는 더 정확하다.
//   · 이름: 공백·구두점과 "족/종족/류/인" 꼬리를 떼고 비교 (수인족 = 수인 종족 = 수인류)
//   · 태그: 자카드 지수 ≥ RACE_MERGE_TAG_SIM 이면 같은 종족
//   · 총량 상한(RACE_CAP)을 넘으면 **무조건** 가장 가까운 기존 종족으로 흡수한다
//
// 흡수된 이름은 `aliases`에 남는다 — 다음 판정이 더 정확해지고, 유저에게도 "왜 합쳐졌나"를 보여 준다.

import { RACE_CONFIG, isRace, MAX_RACES_PER_CARD } from './races.js';
import { isCycleRole, DEFAULT_CYCLE_ROLE } from './cycle-roles.js';
import { state, dbSave, dbLoad } from './storage.js';

export const STORAGE_KEY_RACES = 'novel_duelist_custom_races';

/** 태그 자카드 지수가 이 이상이면 같은 종족으로 본다 */
export const RACE_MERGE_TAG_SIM = 0.5;

/**
 * 종족 총량 상한. 넘으면 새 종족을 만들지 않고 가장 가까운 기존 종족으로 흡수한다.
 * 24를 고른 이유: 덱 30장 안에서 같은 종족 2장 이상이 나올 확률이 유지되는 선.
 * 이보다 늘리면 종족 덱이 성립하지 않아 축 자체가 장식이 된다.
 */
export const RACE_CAP = 24;

/** 새 종족 한 개가 가질 수 있는 이미지 태그 수 */
export const MAX_RACE_TAGS = 5;

/**
 * 비교용 이름 정규화. "수인족" · "수인 종족" · "수인류"가 모두 "수인"이 된다.
 * 🐛 꼬리를 안 떼면 LLM이 같은 개념을 매번 다른 꼬리로 불러 종족이 무한히 늘어난다.
 */
export function normalizeRaceName(name) {
  return String(name || '')
    .trim()
    .replace(/[\s·・\-_,.'"()[\]]/g, '')
    .replace(/(종족|족속|일족|족|류|인|계)$/u, '')
    .toLowerCase();
}

/** 태그 자카드 지수 (0~1). 둘 다 비어 있으면 0 — 근거 없이 합치지 않는다. */
export function tagSimilarity(a = [], b = []) {
  const A = new Set((a || []).map(t => String(t).trim().toLowerCase()).filter(Boolean));
  const B = new Set((b || []).map(t => String(t).trim().toLowerCase()).filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 이 후보가 기존 종족과 같은 것인가.
 * @returns { key, reason } 또는 null
 */
export function findSimilarRace(candidate) {
  const wantName = normalizeRaceName(candidate.name);
  const wantTags = candidate.tags || [];

  let best = null;
  for (const [key, spec] of Object.entries(RACE_CONFIG)) {
    // ① 엔진 키가 같으면 두말할 것 없다
    if (candidate.key && candidate.key === key) return { key, reason: '엔진 키 동일' };
    // ② 이름(별칭 포함)이 정규화 후 같으면 같은 종족
    const names = [spec.name, ...(spec.aliases || [])];
    if (wantName && names.some(n => normalizeRaceName(n) === wantName)) {
      return { key, reason: `이름이 같다 ("${candidate.name}" ≈ "${spec.name}")` };
    }
    // ③ 태그가 충분히 겹치면 같은 그림이다 = 같은 종족
    const sim = tagSimilarity(wantTags, spec.tags);
    if (sim >= RACE_MERGE_TAG_SIM && (!best || sim > best.sim)) {
      best = { key, sim, reason: `이미지 태그가 ${Math.round(sim * 100)}% 겹친다 (기준 ${Math.round(RACE_MERGE_TAG_SIM * 100)}%)` };
    }
  }
  return best ? { key: best.key, reason: best.reason } : null;
}

/** 상한을 넘었을 때 흡수할 **가장 가까운** 종족. 겹침이 0이어도 하나는 고른다. */
function nearestRace(candidate) {
  let best = null;
  for (const [key, spec] of Object.entries(RACE_CONFIG)) {
    const sim = tagSimilarity(candidate.tags, spec.tags);
    if (!best || sim > best.sim) best = { key, sim };
  }
  return best ? best.key : 'human';
}

/** LLM이 준 엔진 키 후보를 안전한 소문자 영문 키로 */
function toRaceKey(raw, name) {
  const base = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base && base.length >= 3) return base;
  return 'race_' + normalizeRaceName(name).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 8) + '_' + Date.now().toString(36).slice(-4);
}

/**
 * 새 종족을 등록한다. 이미 있는 것이면 **흡수**하고 그 키를 돌려준다.
 *
 * @param spec { key?, name, icon?, tags[], cycleRole? }
 * @returns { key, created, reason } — created=false면 기존 종족으로 흡수됐다는 뜻
 */
export async function registerNewRace(spec, { persist = true } = {}) {
  if (!spec || !spec.name) return null;
  // 🧪 하네스는 persist:false로 부른다. 검증이 도는 것만으로 유저의 저장 데이터가
  //    바뀌면 안 된다 — 실제로 한 번 오염시켰다 (검사 격리, 규칙 63의 정신).
  const save = () => (persist ? saveCustomRaces() : Promise.resolve());

  const tags = [...new Set((spec.tags || [])
    .map(t => String(t || '').trim().toLowerCase())
    .filter(t => t.length > 0 && t.length <= 40))].slice(0, MAX_RACE_TAGS);

  const candidate = { key: spec.key, name: String(spec.name).trim(), tags };

  // ① 동일성 게이트
  const same = findSimilarRace(candidate);
  if (same) {
    addAlias(same.key, candidate.name);
    await save();
    console.log(`[Race DB] 🔗 종족 흡수: "${candidate.name}" → [${RACE_CONFIG[same.key].name}] (${same.reason})`);
    return { key: same.key, created: false, reason: same.reason };
  }

  // ② 총량 상한 — 넘으면 가장 가까운 곳으로 보낸다. 종족이 무한히 늘면 시너지가 죽는다.
  if (Object.keys(RACE_CONFIG).length >= RACE_CAP) {
    const near = nearestRace(candidate);
    addAlias(near, candidate.name);
    await save();
    console.log(`[Race DB] 🚧 종족 상한(${RACE_CAP}) — "${candidate.name}"을(를) [${RACE_CONFIG[near].name}]에 흡수`);
    return { key: near, created: false, reason: `종족 상한 ${RACE_CAP}` };
  }

  // ③ 태그가 없으면 새 종족을 만들 근거가 없다 — 종족의 값은 그림이다
  if (tags.length === 0) {
    console.warn(`[Race DB] "${candidate.name}"에 이미지 태그가 없어 등록하지 않는다`);
    return null;
  }

  const key = toRaceKey(spec.key, candidate.name);
  if (isRace(key)) return { key, created: false, reason: '키 충돌' };

  RACE_CONFIG[key] = {
    name: candidate.name,
    icon: String(spec.icon || '🧬').slice(0, 4),
    tags,
    cycleRole: isCycleRole(spec.cycleRole) ? spec.cycleRole : DEFAULT_CYCLE_ROLE,
    custom: true,
    aliases: []
  };
  await save();
  console.log(`[Race DB] ✨ 새 종족 [${candidate.name}] 등록 (${tags.join(', ')})`);
  return { key, created: true, reason: null };
}

function addAlias(key, name) {
  const spec = RACE_CONFIG[key];
  if (!spec || !name) return;
  if (normalizeRaceName(spec.name) === normalizeRaceName(name)) return;
  if (!spec.aliases) spec.aliases = [];
  if (!spec.aliases.includes(name)) spec.aliases.push(name);
}

/** 유저가 만든 종족만 골라 저장한다 (기본 8종은 코드가 소유한다) */
export async function saveCustomRaces() {
  const custom = {};
  for (const [k, v] of Object.entries(RACE_CONFIG)) {
    if (v.custom) custom[k] = { name: v.name, icon: v.icon, tags: v.tags, cycleRole: v.cycleRole, aliases: v.aliases || [] };
    else if (v.aliases && v.aliases.length > 0) custom['__alias__' + k] = { aliases: v.aliases };
  }
  state.customRaces = custom;
  await dbSave(STORAGE_KEY_RACES, custom);
  try { localStorage.setItem(STORAGE_KEY_RACES, JSON.stringify(custom)); } catch (e) { /* 용량 초과는 IndexedDB로 충분 */ }
}

/**
 * 저장된 종족을 표에 되살린다.
 * ⚠️ `loadLocalFlavor()` **앞에** 부르세요 — 팩이 이름을 덮을 기회를 뒤에 줘야 합니다.
 */
export async function loadCustomRaces() {
  let stored = await dbLoad(STORAGE_KEY_RACES);
  if (!stored) {
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY_RACES) || 'null'); } catch (e) { stored = null; }
  }
  if (!stored || typeof stored !== 'object') return 0;

  let added = 0;
  for (const [k, v] of Object.entries(stored)) {
    if (k.startsWith('__alias__')) {
      const base = k.slice('__alias__'.length);
      if (RACE_CONFIG[base]) RACE_CONFIG[base].aliases = v.aliases || [];
      continue;
    }
    if (RACE_CONFIG[k]) continue;
    RACE_CONFIG[k] = { ...v, custom: true, tags: v.tags || [], aliases: v.aliases || [] };
    added++;
  }
  state.customRaces = stored;
  if (added > 0) console.log(`[Race DB] 저장된 종족 ${added}종 복원`);
  return added;
}

/** 콘솔용 — 유저가 만든 종족을 전부 지운다 (기본 8종은 남는다) */
export async function resetCustomRaces() {
  for (const [k, v] of Object.entries(RACE_CONFIG)) {
    if (v.custom) delete RACE_CONFIG[k];
    else if (v.aliases) v.aliases = [];
  }
  await saveCustomRaces();
  console.log('[Race DB] 커스텀 종족 초기화 완료');
}

/** 프롬프트에 실을 종족 목록 (엔진 키 + 이름) */
export function racesForPrompt() {
  return Object.entries(RACE_CONFIG).map(([k, v]) => `${k}(${v.name})`).join(' | ');
}
