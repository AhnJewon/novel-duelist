// storage.js - IndexedDB 저장소 & 전역 게임 상태 관리

import { DEFAULT_STARTER_CARDS } from './data.js';
import { ensureCopiesField, loadDust, MAX_CARD_COPIES } from './card-copies.js';

/**
 * 기본 카드 규칙 판. 올리면 저장된 기본 카드가 새 정의로 한 번 갈린다 (DECISIONS #110).
 * ⚠️ 올릴 때는 STARTER_V1_TEXT도 그 판의 문구로 갱신하세요. 안 하면 유저가 붙인 이름을 못 지킵니다 —
 *    v1 문구와 다르면 "유저가 고쳤다"로 보고 남기는 방식이기 때문이다.
 */
export const STARTER_RULES_VERSION = 2;

/** v1(예산 개편 전) 기본 문구. 유저가 이름을 고쳤는지 판별하는 **유일한** 근거다. */
const STARTER_V1_TEXT = {
  'starter-1':         { name: '홍련의 검성 아스카',       title: 'Crimson Blademaster' },
  'starter-2':         { name: '빙결의 대마도사 루시아',   title: 'Archmage of Frost' },
  'starter-3':         { name: '뇌제 발키리 브륀힐트',     title: 'Valkyrie of Thunder' },
  'starter-4':         { name: '성역의 수호사제 세라피나', title: 'Sanctuary Priestess' },
  'starter-5':         { name: '심연의 암살자 레이븐',     title: 'Abyssal Assassin' },
  'starter-spell-1':   { name: '종말의 메테오 스트라이크', title: 'Apocalypse Meteor' },
  'starter-spell-2':   { name: '시공의 왜곡: 타임 리프',   title: 'Time Leap' },
  'starter-struct-1':  { name: '신비의 마나 수정탑',       title: 'Arcane Mana Spire' },
  'starter-struct-2':  { name: '아이기스의 수호 철옹성',   title: 'Aegis Citadel' },
  'starter-generic-1': { name: '방랑의 용병 검사',         title: 'Wandering Mercenary' },
  'starter-generic-2': { name: '욕망의 비전 항아리',       title: 'Pot of Greed' },
  'starter-generic-3': { name: '결계 분쇄의 일격',         title: 'Barrier Breaker' },
  'starter-generic-4': { name: '고대의 바위 골렘',         title: 'Ancient Stone Golem' }
};

// 덱 규칙. 중복을 허용하되 같은 카드는 MAX_COPIES까지만 (유희왕식 3장 제한)
export const MAX_DECK_SIZE = 20;
export const MIN_DECK_SIZE = 4;
export const RECOMMENDED_DECK_SIZE = 16;
export const MAX_COPIES_PER_CARD = 3;

export const state = {
  cardsCollection: [], // 전체 보유 카드 보관함
  activeDeckCardIds: [], // 현재 전투 출전 덱에 편성된 카드 ID 목록
  archetypesList: [], // 누적 카드군(Theme Archetype) DB
  customRaces: {},    // 🧬 LLM이 만든 종족 (기본 8종은 races.js가 소유 — DECISIONS #108)
  settings: {
    apiKey: '',
    model: 'nai-diffusion-4-5-full',
    resolution: 'square-normal',
    steps: 28,
    scale: 5.0,
    safeMode0Anlas: true,
    llmUrl: 'http://localhost:11434',
    llmModel: 'hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M',
    reasoningMode: 'fast', // 'fast' (초고속 3~6초) | 'deep' (심층 추론 25~40초)
    embedModel: 'bge-m3',  // 카드군 의미 유사도용 임베딩 모델 (없으면 문자열 판정으로 폴백)
    tagSlmPreset: 'tipo',  // 태그 확장 SLM 프리셋 (tipo|dart|custom)
    tagSlmModel: ''        // 직접 지정 시 모델 이름 (비우면 프리셋 기본값)
  },
  bossesList: [],
  dust: 0,              // 💎 중복 카드 분해로 얻는 가루 (사용처는 추후)
  currentBossIdx: 0,
  playerHp: 50,
  playerMaxHp: 50,
  playerMana: 3,
  playerMaxMana: 3,
  playerMaxShield: 0,
  playerDeck: [],
  playerHand: [],
  playerMinions: [],
  bossMinions: [],
  // 💎 상대 진영 마나 — Side(combat-side.js)가 읽고 쓰는 **한 집**.
  //    🐛 예전엔 클로저(pvpMana)와 이 필드 두 집이어서 거울의 manaGain이 죽은 필드에 썼다.
  bossMana: 1,
  bossMaxMana: 1,
  currentBoss: null,
  turnCount: 1,
  isAnimating: false
};

const STORAGE_KEY_CARDS = 'novel_duelist_cards';
const STORAGE_KEY_ACTIVE_DECK = 'novel_duelist_active_deck';
const STORAGE_KEY_SETTINGS = 'novel_duelist_settings';
export const STORAGE_KEY_BOSSES = 'novel_duelist_bosses';
const DB_NAME = 'NovelDuelistDB';
const DB_STORE = 'game_store';

export function openAppDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function dbSave(key, data) {
  try {
    const db = await openAppDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
}

export async function dbLoad(key) {
  try {
    const db = await openAppDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * base64 이미지를 줄여 저장 용량을 아낀다.
 *
 * @param opts.maxSize 긴 변 최대 픽셀 (기본 800 — 카드 일러스트 기준)
 * @param opts.quality webp 품질 0~1 (기본 0.85)
 *
 * 프로필 초상처럼 더 작게 줄여야 할 때가 있어 옵션을 받는다.
 * 인자를 안 주면 기존과 완전히 동일하게 동작한다.
 */
export async function optimizeCardImage(url, { maxSize = 800, quality = 0.85 } = {}) {
  if (!url || typeof url !== 'string' || !url.startsWith('data:image')) return url;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const maxDim = maxSize;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const optUrl = canvas.toDataURL('image/webp', quality);
      resolve(optUrl || url);
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

export async function loadInitialData() {
  try {
    // 1. 전체 보유 카드 보관함 로드
    const idbCards = await dbLoad(STORAGE_KEY_CARDS);
    let loadedCards = [];
    if (idbCards && Array.isArray(idbCards) && idbCards.length > 0) {
      const existingIds = new Set(idbCards.map(c => c.id));
      const newStarters = DEFAULT_STARTER_CARDS.filter(c => !existingIds.has(c.id));
      loadedCards = [...idbCards, ...newStarters];
    } else {
      const stored = localStorage.getItem(STORAGE_KEY_CARDS);
      let parsed = stored ? JSON.parse(stored) : DEFAULT_STARTER_CARDS;
      if (Array.isArray(parsed)) {
        const existingIds = new Set(parsed.map(c => c.id));
        const newStarters = DEFAULT_STARTER_CARDS.filter(c => !existingIds.has(c.id));
        parsed = [...parsed, ...newStarters];
      } else {
        parsed = DEFAULT_STARTER_CARDS;
      }
      loadedCards = parsed;
    }

    // 💡 기존 저장된 카드들 중 테마 정보가 누락된 스타터 카드 실시간 테마 동기화
    let cardsUpdated = false;
    loadedCards.forEach(card => {
      const starterMatch = DEFAULT_STARTER_CARDS.find(s => s.id === card.id);
      if (starterMatch) {
        if (!card.themeName && starterMatch.themeName) {
          card.themeName = starterMatch.themeName;
          card.themeId = starterMatch.themeId;
          card.themeKeyword = starterMatch.themeKeyword;
          cardsUpdated = true;
        }
      }
    });

    // ⚖️ 기본 카드 규칙 갱신 (DECISIONS #110)
    //
    // 예전 기본 카드는 예산을 넘겼고(13장 중 10장), 부팅 때 `rebalanceExistingCards`가
    // **코스트를 올려서** 맞췄다. 3마나로 적힌 카드가 손에서는 6마나였다. 게다가 종족·사이클
    // 역할·함정·바닐라·신규 상태이상이 하나도 없었다.
    //
    // 그래서 저장된 기본 카드를 새 정의로 갈아준다. 단 **유저의 것은 남긴다**:
    //   · 일러스트(imageUrl·crop·prompt)는 유저가 다시 뽑았을 수 있다 → 보존
    //   · 이름·영문 제목·플레이버는 크롭 모달에서 고칠 수 있다(#100 ⑦) → **v1 기본값과 다르면** 보존
    // v1 문구 표를 들고 있는 이유가 그것이다. 이게 없으면 유저가 붙인 이름을 조용히 지운다.
    //
    // `_starterRules` 표식으로 한 번만 돈다 — 유저가 나중에 수치를 손대면 다시 덮지 않는다.
    loadedCards.forEach(card => {
      const def = DEFAULT_STARTER_CARDS.find(s => s.id === card.id);
      if (!def || card._starterRules >= STARTER_RULES_VERSION) return;
      const v1 = STARTER_V1_TEXT[card.id];
      const keptName = (v1 && card.name && card.name !== v1.name) ? card.name : def.name;
      const keptTitle = (v1 && card.title && card.title !== v1.title) ? card.title : def.title;
      const art = { imageUrl: card.imageUrl, crop: card.crop, prompt: card.prompt };

      const fresh = JSON.parse(JSON.stringify(def));
      Object.keys(card).forEach(k => { if (!(k in fresh)) delete card[k]; });
      Object.assign(card, fresh);
      card.name = keptName;
      card.title = keptTitle;
      if (art.imageUrl) card.imageUrl = art.imageUrl;
      if (art.crop) card.crop = art.crop;
      if (art.prompt) card.prompt = art.prompt;
      card._starterRules = STARTER_RULES_VERSION;
      cardsUpdated = true;
    });

    // 🃏 매수 필드 보정 — 스타터 카드는 3장씩 지급한다.
    //    덱 최대 편성이 3장이라 스타터만으로도 중복 덱을 짤 수 있어야 한다.
    loadedCards.forEach(c => {
      if (!Number.isFinite(parseInt(c.copies))) {
        c.copies = DEFAULT_STARTER_CARDS.some(s => s.id === c.id) ? MAX_CARD_COPIES : 1;
        cardsUpdated = true;
      }
    });

    state.cardsCollection = loadedCards;
    if (cardsUpdated || (idbCards && idbCards.length === 0)) {
      await dbSave(STORAGE_KEY_CARDS, state.cardsCollection);
    }

    // 2. 출전 덱 (Active Deck) 로드
    const idbActiveDeck = await dbLoad(STORAGE_KEY_ACTIVE_DECK);
    if (idbActiveDeck && Array.isArray(idbActiveDeck) && idbActiveDeck.length > 0) {
      // 보관함에 존재하는 ID만 유효하게 필터링
      const validIds = new Set(state.cardsCollection.map(c => c.id));
      state.activeDeckCardIds = idbActiveDeck.filter(id => validIds.has(id));
      if (state.activeDeckCardIds.length === 0) {
        state.activeDeckCardIds = state.cardsCollection.slice(0, RECOMMENDED_DECK_SIZE).map(c => c.id);
      }
    } else {
      const storedActive = localStorage.getItem(STORAGE_KEY_ACTIVE_DECK);
      if (storedActive) {
        try {
          const parsed = JSON.parse(storedActive);
          const validIds = new Set(state.cardsCollection.map(c => c.id));
          state.activeDeckCardIds = parsed.filter(id => validIds.has(id));
        } catch (e) {}
      }
      if (!state.activeDeckCardIds || state.activeDeckCardIds.length === 0) {
        // 기본 8장 스타터 카드를 출전 덱으로 지정
        state.activeDeckCardIds = DEFAULT_STARTER_CARDS.map(c => c.id);
      }
      await dbSave(STORAGE_KEY_ACTIVE_DECK, state.activeDeckCardIds);
    }

    // 3. 설정 로드
    const storedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (storedSettings) {
      state.settings = { ...state.settings, ...JSON.parse(storedSettings) };
      if (!state.settings.model || state.settings.model === 'nai-diffusion-4-5') {
        state.settings.model = 'nai-diffusion-4-5-full';
      }
      if (!state.settings.llmModel || state.settings.llmModel === 'qwen3.5:4b') {
        state.settings.llmModel = 'hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M';
      }
    }
  } catch (e) {
    state.cardsCollection = [...DEFAULT_STARTER_CARDS];
    state.activeDeckCardIds = DEFAULT_STARTER_CARDS.map(c => c.id);
  }
  
  await loadDust();
  updateDeckCountNav();
  if (window._renderGrimoire) window._renderGrimoire();
}

export async function saveCardsToStorage() {
  await dbSave(STORAGE_KEY_CARDS, state.cardsCollection);
  try {
    localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(state.cardsCollection));
  } catch (e) {
    console.warn('localStorage 5MB 용량 초과 감지: IndexedDB로 안전하게 영구 저장되었습니다.');
  }
  updateDeckCountNav();
}

export async function saveActiveDeckToStorage() {
  await dbSave(STORAGE_KEY_ACTIVE_DECK, state.activeDeckCardIds);
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_DECK, JSON.stringify(state.activeDeckCardIds));
  } catch (e) {}
  updateDeckCountNav();
}

export function updateDeckCountNav() {
  const el = document.getElementById('nav-deck-count');
  if (el) {
    el.innerText = `${state.activeDeckCardIds.length}/${MAX_DECK_SIZE}`;
  }
}

export function saveSettingsToStorage() {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
}
