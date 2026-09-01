// card-cropper.js - 카드 이미지 확대 뷰어 & 인터랙티브 프레임 크롭/위치 조절기 & 이미지/태그 리롤러

import { state, saveCardsToStorage, saveActiveDeckToStorage, optimizeCardImage } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { generateNovelAIImage } from './ai-service.js';
import { extractCoreSeedsFromConcept } from './dan-tag-gen.js';

let activeCroppingCard = null;
let currentCrop = { scale: 1.0, x: 50, y: 35 };
let isDragging = false;

const MOCK_ELEMENT_ARTS = {
  fire: [
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80'
  ],
  water: [
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80'
  ],
  lightning: [
    'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80'
  ],
  holy: [
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80'
  ],
  dark: [
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80'
  ],
  nature: [
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80'
  ]
};

export function openCardCropModal(card) {
  if (!card) return;
  activeCroppingCard = card;

  // 기존 크롭 정보 복사 또는 상반신 기본값(1.0x, 50%, 35%)
  if (card.crop) {
    currentCrop = {
      scale: card.crop.scale !== undefined ? card.crop.scale : 1.0,
      x: card.crop.x !== undefined ? card.crop.x : 50,
      y: card.crop.y !== undefined ? card.crop.y : 35
    };
  } else {
    currentCrop = { scale: 1.0, x: 50, y: 35 };
  }

  const modal = document.getElementById('card-crop-modal');
  if (!modal) return;

  // 카드 기본 정보 표시
  const nameEl = document.getElementById('crop-card-name');
  const metaEl = document.getElementById('crop-card-meta');
  const promptInput = document.getElementById('crop-card-prompt-input');
  const fullImg = document.getElementById('crop-full-art-img');
  
  if (nameEl) nameEl.innerText = card.name;
  if (metaEl) metaEl.innerText = `[${(card.rarity || 'common').toUpperCase()}] ${card.element?.toUpperCase()} | ${card.cardType?.toUpperCase() || 'UNIT'}`;
  
  // 프롬프트가 없을 경우 카드의 이름과 속성에 맞게 즉시 자동 생성
  if (!card.prompt || card.prompt.trim().length === 0) {
    card.prompt = extractCoreSeedsFromConcept(card.name, card.element || 'fire', card.cardType || 'unit');
  }
  if (promptInput) promptInput.value = (card.prompt || '').replace(/_/g, ' ');
  
  const resSelect = document.getElementById('crop-resolution-select');
  if (resSelect) {
    resSelect.value = card.resolution || state.settings.resolution || 'square-normal';
  }
  
  if (fullImg) {
    fullImg.src = card.imageUrl;
  }

  // 슬라이더 및 수치 UI 동기화
  syncInputsFromCurrentCrop();
  updateCropPreview();

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  audio.playDraw();
}

export function closeCardCropModal() {
  const modal = document.getElementById('card-crop-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  activeCroppingCard = null;
}

export function syncInputsFromCurrentCrop() {
  const scaleInput = document.getElementById('crop-scale-input');
  const scaleVal = document.getElementById('crop-scale-val');
  const xInput = document.getElementById('crop-x-input');
  const xVal = document.getElementById('crop-x-val');
  const yInput = document.getElementById('crop-y-input');
  const yVal = document.getElementById('crop-y-val');

  const sc = currentCrop.scale !== undefined ? currentCrop.scale : 1.0;
  if (scaleInput) scaleInput.value = sc;
  if (scaleVal) scaleVal.innerText = `${sc.toFixed(2)}x`;
  if (xInput) xInput.value = currentCrop.x !== undefined ? currentCrop.x : 50;
  if (xVal) xVal.innerText = `${currentCrop.x !== undefined ? currentCrop.x : 50}%`;
  if (yInput) yInput.value = currentCrop.y !== undefined ? currentCrop.y : 35;
  if (yVal) yVal.innerText = `${currentCrop.y !== undefined ? currentCrop.y : 35}%`;
}

export function onCropScaleChange(val) {
  currentCrop.scale = Math.max(0.4, Math.min(3.0, parseFloat(val) || 1.0));
  const scaleVal = document.getElementById('crop-scale-val');
  if (scaleVal) scaleVal.innerText = `${currentCrop.scale.toFixed(2)}x`;
  updateCropPreview();
}

export function onCropXChange(val) {
  currentCrop.x = parseInt(val) || 0;
  const xVal = document.getElementById('crop-x-val');
  if (xVal) xVal.innerText = `${currentCrop.x}%`;
  updateCropPreview();
}

export function onCropYChange(val) {
  currentCrop.y = parseInt(val) || 0;
  const yVal = document.getElementById('crop-y-val');
  if (yVal) yVal.innerText = `${currentCrop.y}%`;
  updateCropPreview();
}

export function setCropPreset(preset) {
  if (preset === 'fit') {
    // 🖼️ 전체 맞춤 (0.85x - 정사각형 일러스트 전체 표시)
    currentCrop = { scale: 0.85, x: 50, y: 50 };
  } else if (preset === 'center') {
    // 🌟 1.0x 전체 중앙
    currentCrop = { scale: 1.0, x: 50, y: 50 };
  } else if (preset === 'face') {
    // 👤 인물 얼굴 / 머리 부분 (상단 10% 포커스)
    currentCrop = { scale: 1.2, x: 50, y: 10 };
  } else if (preset === 'upper') {
    // ⚔️ 상반신 / 가슴 무기 (상단 35% 포커스)
    currentCrop = { scale: 1.0, x: 50, y: 35 };
  } else if (preset === 'lower') {
    // 🦵 하반신 / 발 / 마법진 (하단 85% 포커스)
    currentCrop = { scale: 1.0, x: 85, y: 85 };
  } else if (preset === 'zoom') {
    // 🔍 역동적 초근접 줌
    currentCrop = { scale: 1.8, x: 50, y: 25 };
  }
  syncInputsFromCurrentCrop();
  updateCropPreview();
}

export function updateCropPreview() {
  if (!activeCroppingCard) return;

  // 1. 실시간 미리보기 3D 카드 렌더링
  const previewBox = document.getElementById('crop-card-preview-box');
  if (previewBox) {
    previewBox.innerHTML = '';
    const tempCard = {
      ...activeCroppingCard,
      crop: { ...currentCrop }
    };
    const cardEl = createCardElement(tempCard, null, false);
    previewBox.appendChild(cardEl);
  }

  // 2. 대형 뷰어 내의 가이드 프레임 위치 및 크기 시각화
  const viewportBox = document.getElementById('crop-viewport-box');
  if (viewportBox) {
    const scale = currentCrop.scale || 1.0;
    const boxW = Math.max(20, Math.min(100, Math.round(85 / scale)));
    const boxH = Math.max(20, Math.min(100, Math.round(62 / scale)));
    
    // x, y (0% ~ 100%) 기준으로 박스 위치 계산
    const posX = currentCrop.x !== undefined ? currentCrop.x : 50;
    const posY = currentCrop.y !== undefined ? currentCrop.y : 35;
    
    const leftPercent = (posX / 100) * (100 - boxW);
    const topPercent = (posY / 100) * (100 - boxH);

    viewportBox.style.width = `${boxW}%`;
    viewportBox.style.height = `${boxH}%`;
    viewportBox.style.left = `${leftPercent}%`;
    viewportBox.style.top = `${topPercent}%`;
  }
}

// 🏷️ 1. 카드 콘셉트에 맞게 Danbooru 태그 자동 재작성 (리롤)
export function rerollCardPromptAndTags() {
  if (!activeCroppingCard) return;

  const concept = activeCroppingCard.name || '판타지 영웅';
  const element = activeCroppingCard.element || 'fire';
  const cardType = activeCroppingCard.cardType || 'unit';

  const newPrompt = extractCoreSeedsFromConcept(concept, element, cardType);
  activeCroppingCard.prompt = newPrompt;

  const promptInput = document.getElementById('crop-card-prompt-input');
  if (promptInput) {
    promptInput.value = newPrompt;
    promptInput.classList.add('ring-2', 'ring-purple-400');
    setTimeout(() => promptInput.classList.remove('ring-2', 'ring-purple-400'), 600);
  }

  audio.playMagic();
}

// 🎨 2. NovelAI V4.5로 카드 이미지 실시간 재생성 (리롤)
export async function rerollCardImageAI(isMock = false) {
  if (!activeCroppingCard) return;

  const promptInput = document.getElementById('crop-card-prompt-input');
  const userPrompt = (promptInput && promptInput.value.trim()) ? promptInput.value.trim() : (activeCroppingCard.prompt || '');
  const element = activeCroppingCard.element || 'fire';
  const cardType = activeCroppingCard.cardType || 'unit';

  const loadingEl = document.getElementById('crop-reroll-loading');
  const loadingText = document.getElementById('crop-reroll-loading-text');

  const resSelect = document.getElementById('crop-resolution-select');
  const chosenRes = (resSelect && resSelect.value) ? resSelect.value : (state.settings.resolution || 'square-normal');

  if (isMock || !state.settings.apiKey) {
    if (!isMock && !state.settings.apiKey) {
      alert(`NovelAI API Key가 설정되지 않아 고품질 모의 일러스트로 리롤합니다. (선택 비율: ${chosenRes})`);
    }
    const pool = MOCK_ELEMENT_ARTS[element] || MOCK_ELEMENT_ARTS.fire;
    const nextMock = pool[Math.floor(Math.random() * pool.length)];
    
    activeCroppingCard.imageUrl = nextMock;
    activeCroppingCard.prompt = userPrompt;
    activeCroppingCard.resolution = chosenRes;
    await applyUpdatedCardArt(activeCroppingCard);
    audio.playSlash();
    return;
  }

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (loadingText) loadingText.innerText = `NovelAI V4.5로 새 일러스트 연성 중... (${chosenRes} · 0 Anlas)`;

  try {
    const rawImage = await generateNovelAIImage({
      prompt: userPrompt,
      element: element,
      cardType: cardType,
      resolution: chosenRes
    });

    const optimized = await optimizeCardImage(rawImage);
    activeCroppingCard.imageUrl = optimized;
    activeCroppingCard.prompt = userPrompt;
    activeCroppingCard.resolution = chosenRes;

    await applyUpdatedCardArt(activeCroppingCard);
    audio.playVictory();
  } catch (err) {
    console.error('이미지 리롤 실패:', err);
    alert(`이미지 리롤 중 오류가 발생했습니다:\n${err.message}`);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

// 🖼️ 업데이트된 카드 이미지 적용 및 저장 헬퍼
async function applyUpdatedCardArt(card) {
  // 1. 대형 뷰어 및 미리보기 업데이트
  const fullImg = document.getElementById('crop-full-art-img');
  if (fullImg) fullImg.src = card.imageUrl;

  // 2. cardsCollection 동기화
  const targetCard = state.cardsCollection.find(c => c.id === card.id);
  if (targetCard) {
    targetCard.imageUrl = card.imageUrl;
    targetCard.prompt = card.prompt;
  }

  // 3. IndexedDB & localStorage 저장
  await saveCardsToStorage();
  await saveActiveDeckToStorage();

  // 4. UI 및 프리뷰 리렌더링
  updateCropPreview();
  if (window._renderGrimoire) window._renderGrimoire();
  if (window._renderBattleUI) window._renderBattleUI();
}

// 🖱️ 인터랙티브 드래그 및 클릭 핸들러 (대형 이미지 영역에서 클릭 또는 드래그로 즉시 위치 조절)
export function initCropperDragEvents() {
  const container = document.getElementById('crop-viewer-container');
  if (!container) return;

  function updatePositionFromEvent(e) {
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const percentX = Math.max(0, Math.min(100, Math.round((clickX / rect.width) * 100)));
    const percentY = Math.max(0, Math.min(100, Math.round((clickY / rect.height) * 100)));

    currentCrop.x = percentX;
    currentCrop.y = percentY;

    syncInputsFromCurrentCrop();
    updateCropPreview();
  }

  container.addEventListener('mousedown', (e) => {
    isDragging = true;
    updatePositionFromEvent(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    updatePositionFromEvent(e);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
    }
  });

  // 휠로 줌 조절 (0.4x ~ 3.0x 지원)
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.05 : 0.05;
    currentCrop.scale = Math.max(0.4, Math.min(3.0, parseFloat((currentCrop.scale + zoomDelta).toFixed(2))));
    syncInputsFromCurrentCrop();
    updateCropPreview();
  }, { passive: false });
}

export async function saveCardCropSettings() {
  if (!activeCroppingCard) return;

  const promptInput = document.getElementById('crop-card-prompt-input');
  if (promptInput && promptInput.value.trim()) {
    activeCroppingCard.prompt = promptInput.value.trim();
  }

  // 카드 객체에 크롭 메타데이터 영구 저장
  activeCroppingCard.crop = { ...currentCrop };

  // 1. cardsCollection 동기화
  const targetCard = state.cardsCollection.find(c => c.id === activeCroppingCard.id);
  if (targetCard) {
    targetCard.crop = { ...currentCrop };
    if (activeCroppingCard.prompt) targetCard.prompt = activeCroppingCard.prompt;
  }

  // 2. IndexedDB & localStorage 저장
  await saveCardsToStorage();
  await saveActiveDeckToStorage();

  audio.playMagic();

  // 3. 현재 탭 실시간 리렌더링
  if (window._renderGrimoire) window._renderGrimoire();
  if (window._renderBattleUI) window._renderBattleUI();

  alert(`✨ [${activeCroppingCard.name}] 카드의 일러스트 프레임/크롭 설정이 성공적으로 저장되었습니다!`);
  closeCardCropModal();
}

export function downloadOriginalArt() {
  if (!activeCroppingCard || !activeCroppingCard.imageUrl) return;
  const link = document.createElement('a');
  link.href = activeCroppingCard.imageUrl;
  link.download = `${activeCroppingCard.name}_original_art.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
