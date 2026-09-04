// card-cropper.js - 카드 이미지 확대 뷰어 & 인터랙티브 프레임 크롭/위치 조절기 & 이미지/태그 리롤러

import { state, saveCardsToStorage, saveActiveDeckToStorage, optimizeCardImage } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { generateNovelAIImage, getLastImageRequest } from './ai-service.js';
import { extractCoreSeedsFromConcept } from './dan-tag-gen.js';
import { expandTagsDetailed } from './tag-slm.js';

// 🃏 카드 일러스트 프레임 **안쪽**(img 요소 박스) 크기 — 카드 205px − 좌우 여백 2×10 − 테두리 2×1 = 183, 높이 135 − 2 = 133.
//    🐛 처음엔 205×135로 잡아 세로가 11% 어긋났다(실측 h 0.244 vs 0.274). 미리보기 카드가 있으면 그 DOM에서 직접 잰다.
const CARD_FRAME_W = 183;
const CARD_FRAME_H = 183;   // 1:1 프레임 (DECISIONS #101)

/** 미리보기 카드의 실제 프레임 안쪽 크기 (렌더러가 바뀌어도 계산이 따라간다) */
function measureFrame() {
  const frame = document.querySelector('#crop-card-preview-box .card-art-frame');
  if (frame && frame.clientWidth > 0 && frame.clientHeight > 0) return { fw: frame.clientWidth, fh: frame.clientHeight };
  return { fw: CARD_FRAME_W, fh: CARD_FRAME_H };
}

/**
 * 📐 카드 프레임에 실제로 보이는 원본 이미지 영역(원본 대비 0~1 분수).
 * 렌더러 규칙 그대로: object-fit: cover → object-position X% Y% → transform: scale(S) (origin X% Y%).
 *
 * 🐛 예전 가이드 프레임은 `85/scale × 62/scale`이라는 근사치로 그려서, 프레임이 실제 카드에 보이는 영역과 어긋났다.
 *    그래서 "이미 크롭된 이미지를 놓고 수정하는 것처럼" 보였다 (DECISIONS #100).
 */
export function visibleRegionOnImage(iw, ih, crop, fw = CARD_FRAME_W, fh = CARD_FRAME_H) {
  const S = Math.max(0.05, crop.scale || 1.0);
  const X = (crop.x !== undefined ? crop.x : 50) / 100;
  const Y = (crop.y !== undefined ? crop.y : 35) / 100;
  const k = Math.max(fw / iw, fh / ih);            // cover 배율
  const offX = (fw - iw * k) * X;                  // object-position: 넘치는 만큼을 X 비율로 배분 (≤ 0)
  const offY = (fh - ih * k) * Y;
  const ox = X * fw, oy = Y * fh;                  // transform-origin (요소 박스 기준)
  const winW = fw / S, winH = fh / S;              // scale(S) 뒤 요소 박스에서 보이는 창
  const winL = ox * (1 - 1 / S), winT = oy * (1 - 1 / S);
  // 요소 좌표 → 원본 픽셀 → 분수
  return {
    x: (winL - offX) / k / iw, y: (winT - offY) / k / ih,
    w: winW / k / iw,          h: winH / k / ih
  };
}

/** 역산: 클릭한 원본 위치(분수)가 프레임 중앙에 오도록 object-position X/Y(%)를 구한다 */
export function positionForCenter(iw, ih, crop, cx, cy, fw = CARD_FRAME_W, fh = CARD_FRAME_H) {
  const r = visibleRegionOnImage(iw, ih, { ...crop, x: 50, y: 50 }, fw, fh);   // 창 크기는 X/Y와 무관
  const solve = (c, wf) => (wf >= 1 ? 50 : Math.round(Math.max(0, Math.min(1, (c - wf / 2) / (1 - wf))) * 100));
  return { x: solve(cx, r.w), y: solve(cy, r.h) };
}

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
  // ✏️ 성능과 무관한 항목 편집 칸 채우기
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('crop-card-name-input', card.name);
  setVal('crop-card-title-input', card.title);
  setVal('crop-card-flavor-input', (card.skill && card.skill.flavorText) || (card.skills && card.skills[0] && card.skills[0].flavorText) || '');
  const finalBox = document.getElementById('crop-final-prompt');
  if (finalBox) finalBox.classList.add('hidden');
  
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
    // 원본 크기를 알아야 가이드 프레임을 정확히 그린다 — 로드된 뒤 한 번 더 그린다
    fullImg.onload = () => updateCropPreview();
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
    // 🖼️ 전체 맞춤 — 원본 전체가 프레임 안에 들어오는 배율을 **계산**한다 (cover 배율 k 대비 contain 배율).
    //    정사각형 원본은 1:1 프레임에서 1.0, 세로 원본(832×1216)은 그 비율만큼 축소된다.
    //    🐛 예전엔 0.85 고정 — 4:3 프레임·정사각형 원본에만 맞는 숫자였다.
    const img = document.getElementById('crop-full-art-img');
    const iw = (img && img.naturalWidth) || 1, ih = (img && img.naturalHeight) || 1;
    const { fw, fh } = measureFrame();
    const k = Math.max(fw / iw, fh / ih);
    const fit = Math.min(fw / (iw * k), fh / (ih * k));
    currentCrop = { scale: Math.max(0.4, Math.round(fit * 100) / 100), x: 50, y: 50 };
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

  // 2. 대형 뷰어 내의 가이드 프레임 — 카드 프레임에 **실제로 보이는** 원본 영역을 그린다.
  //    뷰어는 원본 전체를 object-contain으로 보여주므로(레터박스), 원본 분수 → 표시 사각형 → 컨테이너 % 로 옮긴다.
  const viewportBox = document.getElementById('crop-viewport-box');
  const fullImg = document.getElementById('crop-full-art-img');
  const container = document.getElementById('crop-viewer-container');
  if (viewportBox && fullImg && container) {
    const iw = fullImg.naturalWidth || 1, ih = fullImg.naturalHeight || 1;
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const c = Math.min(cw / iw, ch / ih);                     // contain 배율
    const dw = iw * c, dh = ih * c;                           // 표시된 원본 크기
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;             // 레터박스 여백
    const { fw, fh } = measureFrame();                         // 미리보기 카드의 실제 프레임 안쪽 크기
    const r = visibleRegionOnImage(iw, ih, currentCrop, fw, fh);
    // 원본 밖으로 나간 부분(scale < 1의 여백)은 잘라서 그린다
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    const x1 = Math.min(1, r.x + r.w), y1 = Math.min(1, r.y + r.h);
    viewportBox.style.left = `${((dx + x0 * dw) / cw) * 100}%`;
    viewportBox.style.top = `${((dy + y0 * dh) / ch) * 100}%`;
    viewportBox.style.width = `${(((x1 - x0) * dw) / cw) * 100}%`;
    viewportBox.style.height = `${(((y1 - y0) * dh) / ch) * 100}%`;
  }
}

// 🏷️ 1. 카드 콘셉트에 맞게 Danbooru 태그 자동 재작성 (리롤)
export async function rerollCardPromptAndTags() {
  if (!activeCroppingCard) return;

  const concept = activeCroppingCard.name || '판타지 영웅';
  const element = activeCroppingCard.element || 'fire';
  const cardType = activeCroppingCard.cardType || 'unit';

  // 🐛 "다시 생성을 눌러도 항상 같은 것만 나온다" — extractCoreSeedsFromConcept는 규칙 기반이라 **결정론적**이다.
  //    같은 이름·속성이면 늘 같은 태그가 나왔다. 시드는 그대로 두고 SLM(TIPO)이 매번 다르게 확장한 16태그를 준다.
  //    SLM이 없으면 규칙 기반이라 예전처럼 같은 결과가 나온다 (DECISIONS #100).
  const seeds = extractCoreSeedsFromConcept(concept, element, cardType);
  let newPrompt = seeds;
  try {
    const d = await expandTagsDetailed(seeds, element, cardType, 16);
    if (d && d.prompt) newPrompt = d.prompt;
  } catch (e) { /* 규칙 기반 시드로 폴백 */ }
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
    renderCropFinalPrompt();
    audio.playVictory();
  } catch (err) {
    console.error('이미지 리롤 실패:', err);
    alert(`이미지 리롤 중 오류가 발생했습니다:\n${err.message}`);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

/** 🖼️ 방금 NovelAI에 실제로 보낸 프롬프트를 모달에 보여준다 (태그 칸은 시드일 뿐이다) */
function renderCropFinalPrompt() {
  const req = getLastImageRequest();
  const box = document.getElementById('crop-final-prompt');
  if (!box) return;
  if (!req) { box.classList.add('hidden'); return; }
  box.textContent = `${req.width}×${req.height} · seed ${req.seed} · ${req.prompt.split(',').length}태그\n${req.prompt}\n— 네거티브: ${req.negative}`;
  box.classList.remove('hidden');
}

/** ✏️ 크롭 모달의 이름·영문 제목·플레이버 입력을 카드에 반영한다 — 성능과 무관한 항목만 (DECISIONS #100) */
function readCardInfoEdits(card) {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
  const name = v('crop-card-name-input');
  const title = v('crop-card-title-input');
  const flavor = v('crop-card-flavor-input');
  const changes = {};
  if (name && name !== card.name) changes.name = name;
  if (title !== null && title !== (card.title || '')) changes.title = title;
  const curFlavor = (card.skill && card.skill.flavorText) || '';
  if (flavor !== null && flavor !== curFlavor) changes.flavorText = flavor;
  return changes;
}

function applyCardInfoEdits(card, changes) {
  if (changes.name) card.name = changes.name;
  if (changes.title !== undefined) card.title = changes.title;
  if (changes.flavorText !== undefined) {
    if (card.skill) card.skill.flavorText = changes.flavorText;
    if (Array.isArray(card.skills) && card.skills[0]) card.skills[0].flavorText = changes.flavorText;
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

    // 클릭한 원본 위치가 **프레임 중앙**에 오게 한다 (컨테이너 % 를 그대로 object-position에 넣던 옛 방식은
    // 레터박스·scale을 무시해 클릭한 곳과 보이는 곳이 어긋났다)
    const fullImg = document.getElementById('crop-full-art-img');
    const iw = (fullImg && fullImg.naturalWidth) || 1, ih = (fullImg && fullImg.naturalHeight) || 1;
    const c = Math.min(rect.width / iw, rect.height / ih);
    const dw = iw * c, dh = ih * c, dx = (rect.width - dw) / 2, dy = (rect.height - dh) / 2;
    const cx = Math.max(0, Math.min(1, (clickX - dx) / dw));
    const cy = Math.max(0, Math.min(1, (clickY - dy) / dh));
    const { fw, fh } = measureFrame();
    const pos = positionForCenter(iw, ih, currentCrop, cx, cy, fw, fh);
    currentCrop.x = pos.x;
    currentCrop.y = pos.y;

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

  // ✏️ 이름·영문 제목·플레이버 — 성능(수치·효과·코스트)은 여기서 안 건드린다
  const infoChanges = readCardInfoEdits(activeCroppingCard);
  applyCardInfoEdits(activeCroppingCard, infoChanges);

  // 카드 객체에 크롭 메타데이터 영구 저장
  activeCroppingCard.crop = { ...currentCrop };

  // 1. cardsCollection 동기화
  const targetCard = state.cardsCollection.find(c => c.id === activeCroppingCard.id);
  if (targetCard) {
    targetCard.crop = { ...currentCrop };
    if (activeCroppingCard.prompt) targetCard.prompt = activeCroppingCard.prompt;
    applyCardInfoEdits(targetCard, infoChanges);
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
