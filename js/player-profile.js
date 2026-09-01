// player-profile.js - 플레이어 자신의 듀얼리스트 프로필 (이름 + 초상)
//
// PvE에서는 "플레이어 본체 HP"라는 익명의 막대였다. PvP에서는 상대가 누구인지
// 보여야 하므로 **자기 얼굴**이 필요하다.
//
// 카드·보스와 같은 파이프라인을 쓴다:
//   컨셉(한국어) → LLM이 영어 시각 키워드 → 태그 확장 → NovelAI
// 다만 프로필은 한 장뿐이라 LLM 없이 컨셉만으로도 만들 수 있게 폴백을 둔다.
//
// ⚠️ 초상은 base64라 용량이 크다. IndexedDB에 별도 키로 저장하고
//    PvP 전송에는 **넣지 않는다** (데이터 채널이 막힌다).
//    상대 초상은 별도 메시지로 크기를 줄여 보낸다.

import { state, dbLoad, dbSave, optimizeCardImage } from './storage.js';
import { callOllamaChat, generateNovelAIImage, checkOllamaOnline } from './ai-service.js';
import { expandTagsDetailed } from './tag-slm.js';

export const STORAGE_KEY_PROFILE = 'novel_duelist_player_profile';

/** 초상 없이 쓸 기본 아바타 (속성별 이모지) */
export const DEFAULT_AVATARS = ['🧙', '⚔️', '🏹', '🛡️', '🔮', '👑'];

const DEFAULT_PROFILE = {
  name: '이름 없는 듀얼리스트',
  title: 'Nameless Duelist',
  concept: '',
  element: 'fire',
  avatarEmoji: '🧙',
  imageUrl: '',        // base64 초상 (있으면 우선)
  prompt: ''           // 재생성용 시각 프롬프트
};

export function getProfile() {
  if (!state.playerProfile) state.playerProfile = { ...DEFAULT_PROFILE };
  return state.playerProfile;
}

export async function loadProfile() {
  try {
    const saved = await dbLoad(STORAGE_KEY_PROFILE);
    if (saved && typeof saved === 'object') {
      state.playerProfile = { ...DEFAULT_PROFILE, ...saved };
      return state.playerProfile;
    }
  } catch (e) { /* IndexedDB 실패는 치명적이지 않다 */ }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (raw) state.playerProfile = { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch (e) { /* 무시 */ }

  if (!state.playerProfile) state.playerProfile = { ...DEFAULT_PROFILE };
  return state.playerProfile;
}

export async function saveProfile(patch = {}) {
  const p = { ...getProfile(), ...patch };
  state.playerProfile = p;
  try {
    await dbSave(STORAGE_KEY_PROFILE, p);
  } catch (e) {
    console.warn('[Profile] IndexedDB 저장 실패:', e.message);
  }
  try {
    // 이미지가 빠진 가벼운 사본만 localStorage에 백업한다 (5MB 한도)
    const { imageUrl, ...light } = p;
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(light));
  } catch (e) { /* 용량 초과는 무시 — IndexedDB가 본체다 */ }
  return p;
}

/**
 * PvP 전송용 프로필 — **초상 제외**.
 * 이미지는 크기를 줄여 별도로 보낸다 (sendableAvatar).
 */
export function profileForWire() {
  const p = getProfile();
  return {
    name: p.name || DEFAULT_PROFILE.name,
    title: p.title || '',
    element: p.element || 'fire',
    avatarEmoji: p.avatarEmoji || '🧙',
    hasImage: !!p.imageUrl
  };
}

/**
 * 상대에게 보낼 초상. 데이터 채널 한계를 넘지 않도록 작게 줄인다.
 * 너무 크면 아예 보내지 않는다 — 이모지 아바타로 충분하다.
 */
const AVATAR_WIRE_LIMIT = 120 * 1024;   // 120KB

export async function sendableAvatar() {
  const p = getProfile();
  if (!p.imageUrl) return null;
  try {
    const small = await optimizeCardImage(p.imageUrl, { maxSize: 256, quality: 0.72 });
    if (small && small.length <= AVATAR_WIRE_LIMIT) return small;
    console.info('[Profile] 초상이 너무 커서 전송을 건너뜁니다. 이모지 아바타를 씁니다.');
  } catch (e) {
    console.warn('[Profile] 초상 축소 실패:', e.message);
  }
  return null;
}

/**
 * 컨셉으로 듀얼리스트 프로필을 기획한다.
 * LLM이 없으면 컨셉을 그대로 이름으로 쓰고 시각 시드만 규칙으로 만든다.
 */
export async function planProfileWithLLM(concept, element = 'fire') {
  const fallback = {
    name: (concept || '').trim().slice(0, 14) || DEFAULT_PROFILE.name,
    title: 'Duelist',
    visualSeeds: `1person, portrait, ${element} mage, fantasy outfit, looking at viewer`
  };

  if (!(await checkOllamaOnline(4000))) return fallback;

  try {
    const data = await callOllamaChat({
      messages: [{
        role: 'user',
        content:
`You are designing a player avatar for an anime TCG game.
Concept: "${concept || '자유롭게 창작'}"
Element: ${element}

Return ONLY JSON:
{
  "name": "한국어 듀얼리스트 이름 (2~5어절, 12자 이내)",
  "title": "Short English epithet",
  "visualSeeds": "English Danbooru-ish keywords for a single character portrait: subject, hair, outfit, mood. No background story, no sentences."
}`
      }],
      temperature: 0.9,
      timeoutMs: 60000
    });
    return {
      name: (data.name || fallback.name).toString().slice(0, 16),
      title: (data.title || fallback.title).toString().slice(0, 40),
      visualSeeds: (data.visualSeeds || fallback.visualSeeds).toString()
    };
  } catch (e) {
    console.warn('[Profile] LLM 기획 실패, 폴백 사용:', e.message);
    return fallback;
  }
}

/**
 * 초상 생성. NovelAI 키가 없으면 프롬프트만 만들고 이미지는 건너뛴다.
 * @returns { imageUrl, prompt }
 */
export async function generatePortrait(visualSeeds, element = 'fire') {
  // 인물 한 명만 나오도록 구도를 고정한다 (카드가 아니라 프로필이다)
  const seeds = `${visualSeeds}, solo, upper body, portrait, facing viewer`;
  const expanded = await expandTagsDetailed(seeds, element, 'unit', 28);
  const prompt = expanded.prompt;

  if (!state.settings.apiKey) {
    return { imageUrl: '', prompt };
  }

  const raw = await generateNovelAIImage({
    prompt: seeds,
    negativePrompt: expanded.negative,
    element,
    cardType: 'unit',
    resolution: 'square-small',
    timeoutMs: 120000
  });
  const optimized = await optimizeCardImage(raw, { maxSize: 512, quality: 0.85 });
  return { imageUrl: optimized, prompt };
}
