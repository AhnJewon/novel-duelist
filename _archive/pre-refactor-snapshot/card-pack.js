// card-pack.js - 5장 부스터 팩 개봉 및 LLM / NovelAI 실시간 순차 연성 시스템

import { state, saveCardsToStorage, saveActiveDeckToStorage, saveSettingsToStorage, optimizeCardImage, MAX_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { rollRandomRarity, RARITY_BALANCE_CAPS, RARITY_STYLE, ELEMENT_CONFIG, sanitizeAndClampCardData } from './config.js';
import { cleanPromptTags } from './card-forge.js';
import { checkOllamaOnline, callOllamaChat, generateNovelAIImage } from './ai-service.js';
import { expandDanbooruTags } from './dan-tag-gen.js';
import { registerNewArchetype, findMatchingArchetype, getArchetypesPromptSummary } from './archetype-service.js';

export const PACK_THEMES = {
  fire_dark: {
    id: 'fire_dark',
    name: '칠흑의 화염 부스터 팩',
    icon: '🔥',
    elements: ['fire', 'dark'],
    bg: 'from-red-950 via-purple-950 to-black',
    border: 'border-red-500/70',
    glow: 'shadow-red-600/40',
    desc: '작열하는 화염과 심연의 암흑 속성 소환수 및 공격 주문 집중'
  },
  water_holy: {
    id: 'water_holy',
    name: '서리와 성역 부스터 팩',
    icon: '💧',
    elements: ['water', 'holy'],
    bg: 'from-cyan-950 via-amber-950 to-black',
    border: 'border-cyan-500/70',
    glow: 'shadow-cyan-600/40',
    desc: '빙결 제어, 신성한 무적 방어막 및 수호 건축물 집중'
  },
  lightning_nature: {
    id: 'lightning_nature',
    name: '천둥과 대자연 부스터 팩',
    icon: '⚡',
    elements: ['lightning', 'nature'],
    bg: 'from-yellow-950 via-emerald-950 to-black',
    border: 'border-yellow-500/70',
    glow: 'shadow-yellow-600/40',
    desc: '초고속 번개 연타, 마나 증폭 및 세계수의 맹독 패시브 집중'
  },
  allround: {
    id: 'allround',
    name: '차원의 마스터 올라운더 팩',
    icon: '🌌',
    elements: ['fire', 'water', 'lightning', 'holy', 'dark', 'nature'],
    bg: 'from-purple-950 via-indigo-950 to-black',
    border: 'border-amber-400/80',
    glow: 'shadow-amber-500/50',
    desc: '6대 모든 원소와 소환수/주문/건축물이 고루 등장하는 특수 팩'
  }
};

let currentPackTheme = 'allround';
let isPackOpening = false;
let openedPackCards = [];

const THEME_CONCEPTS = {
  fire_dark: [
    '지옥불을 휘감은 흑염룡의 검사', '종말의 헬파이어 메테오 주문', '심연의 마왕 벨제부브 제단',
    '그림자 속의 암흑 뱀파이어', '작열하는 화염의 포탑', '칠흑의 영혼 수확술'
  ],
  water_holy: [
    '서리 궁전의 빙결 여왕', '아이기스의 수호 결계 요새', '시간을 되돌리는 빛의 성배',
    '절대영도의 눈보라 마법', '성역의 대천사 발키리', '치유와 정화의 신성 분수대'
  ],
  lightning_nature: [
    '천벌의 뇌창을 든 발키리', '세계수의 마나 증폭 수정탑', '맹독을 품은 엘프 대궁수',
    '초전도 번개 폭풍 주문', '대자연의 에메랄드 골렘', '연쇄 감전의 비전 결계'
  ],
  allround: [
    '환상의 원소 마도사', '시공간 균열의 마나 타워', '천체의 비전 메테오',
    '심연의 암살자 레이븐', '빛의 수호 성벽 요새', '천둥의 무투가 안드로이드'
  ]
};

const MOCK_PACK_IMAGES = {
  fire: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
  water: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
  lightning: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
  holy: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
  dark: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
  nature: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80'
};

export function onPackResolutionChange(res) {
  state.settings.resolution = res;
  saveSettingsToStorage();
}

export function renderPackShop() {
  const shopGrid = document.getElementById('pack-shop-grid');
  if (!shopGrid) return;
  shopGrid.innerHTML = '';

  // 팩 해상도 선택기 현재 상태 동기화
  const packResSelect = document.getElementById('pack-resolution-select');
  if (packResSelect && state.settings.resolution) {
    packResSelect.value = state.settings.resolution;
  }

  Object.values(PACK_THEMES).forEach(theme => {
    const isSelected = theme.id === currentPackTheme;
    const card = document.createElement('div');
    card.className = `relative rounded-2xl p-5 bg-gradient-to-b ${theme.bg} border-2 ${isSelected ? 'border-amber-400 shadow-xl ' + theme.glow : theme.border} flex flex-col justify-between select-none cursor-pointer transition hover:scale-105 hover:border-amber-300`;
    
    card.onclick = () => {
      currentPackTheme = theme.id;
      renderPackShop();
    };

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-3xl">${theme.icon}</span>
          ${isSelected ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-black animate-pulse">선택됨</span>' : ''}
        </div>
        <h4 class="font-black text-sm text-slate-100">${theme.name}</h4>
        <p class="text-[11px] text-slate-300 leading-tight">${theme.desc}</p>
      </div>
      <div class="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
        <span class="text-amber-300 font-bold">5장 봉입</span>
        <span class="text-[10px] text-emerald-300 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/50">✨ 희귀 이상 1장 확정</span>
      </div>
    `;
    shopGrid.appendChild(card);
  });
}

export async function openBoosterPack(fastMode = false) {
  if (isPackOpening) return;
  isPackOpening = true;
  openedPackCards = [];

  const theme = PACK_THEMES[currentPackTheme] || PACK_THEMES.allround;
  const arena = document.getElementById('pack-reveal-arena');
  const progressBox = document.getElementById('pack-progress-box');
  const progressBar = document.getElementById('pack-progress-bar');
  const progressText = document.getElementById('pack-progress-text');
  const actionBox = document.getElementById('pack-action-box');
  const openBtn = document.getElementById('btn-open-pack');
  const fastOpenBtn = document.getElementById('btn-fast-pack');

  if (openBtn) openBtn.disabled = true;
  if (fastOpenBtn) fastOpenBtn.disabled = true;
  if (actionBox) actionBox.classList.add('hidden');
  if (progressBox) progressBox.classList.remove('hidden');

  audio.playMagic();

  // 1. 5개의 미공개 카드 뒷면 슬롯 배치
  arena.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const slot = document.createElement('div');
    slot.id = `pack-slot-${i}`;
    slot.className = 'w-[205px] h-[335px] rounded-2xl border-2 border-slate-700 bg-gradient-to-b from-[#1a1d33] via-[#0e101f] to-black flex flex-col items-center justify-center p-4 text-center shadow-2xl relative overflow-hidden transition duration-500';
    slot.innerHTML = `
      <div class="absolute inset-0 bg-[radial-gradient(circle,_var(--tw-gradient-stops))] from-purple-500/10 via-transparent to-transparent animate-pulse"></div>
      <div class="w-16 h-16 rounded-2xl bg-black/60 border border-slate-700 flex items-center justify-center text-3xl mb-3 shadow-inner">
        🎴
      </div>
      <span class="text-xs font-black text-slate-300">미공개 카드 #${i + 1}</span>
      <span class="text-[10px] text-slate-500 mt-1">${i === 4 ? '✨ 희귀 이상 확정 슬롯' : '연성 대기 중...'}</span>
      <div class="slot-spinner hidden absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-2 px-3 text-center">
        <div class="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        <span class="slot-loading-label text-[10px] text-amber-300 font-bold">AI 연성 중...</span>
      </div>
    `;
    arena.appendChild(slot);
  }

  // 2. Ollama 상태 점검 (3.5초 타임아웃으로 안정적 체크)
  const ollamaOnline = !fastMode && await checkOllamaOnline(3500);

  // 3. 5장의 카드 순차적 생성 및 공개 (중복 없이 5종 분배)
  const rawConcepts = THEME_CONCEPTS[currentPackTheme] || THEME_CONCEPTS.allround;
  const shuffledConcepts = [...rawConcepts].sort(() => 0.5 - Math.random());

  for (let i = 0; i < 5; i++) {
    const slot = document.getElementById(`pack-slot-${i}`);
    const spinner = slot.querySelector('.slot-spinner');
    const loadingLabel = slot.querySelector('.slot-loading-label');
    if (spinner) spinner.classList.remove('hidden');

    // 5번째 카드는 최소 RARE 이상 확정 룰 적용
    const rarity = rollRandomRarity(i === 4 ? 'rare' : null);
    const element = theme.elements[Math.floor(Math.random() * theme.elements.length)];
    
    // 카드 타입 배분 (소환수 60%, 주문 25%, 건축물 15%)
    const typeRoll = Math.random();
    let cardType = 'unit';
    if (typeRoll < 0.25) cardType = 'spell';
    else if (typeRoll < 0.40) cardType = 'structure';

    const baseConcept = shuffledConcepts[i % shuffledConcepts.length] || rawConcepts[0];

    if (loadingLabel) {
      loadingLabel.innerText = ollamaOnline 
        ? `🤖 [${i + 1}/5] Ollama LLM 기획 중...` 
        : `🏷️ [${i + 1}/5] DanTagGen 태그 생성 중...`;
    }
    if (progressText) {
      progressText.innerText = ollamaOnline
        ? `[${i + 1}/5] 🤖 Ollama LLM으로 '${baseConcept}' 기획 중...`
        : `[${i + 1}/5] 🏷️ DanTagGen으로 '${baseConcept}' 태그 생성 중...`;
    }
    if (progressBar) progressBar.style.width = `${((i + 0.3) / 5) * 100}%`;

    const cardData = await generateSinglePackCardWithAI(baseConcept, element, rarity, cardType, fastMode, ollamaOnline, loadingLabel, progressText, i, theme.name);

    if (progressText) progressText.innerText = `[${i + 1}/5] ✨ [${cardData.rarity.toUpperCase()}] ${cardData.name} 완성!`;
    if (progressBar) progressBar.style.width = `${((i + 1) / 5) * 100}%`;

    openedPackCards.push(cardData);

    // 4. 카드 뒤집기 (Flip) 및 공개 연출
    await revealSingleCardSlot(slot, cardData);
    await new Promise(r => setTimeout(r, fastMode ? 100 : 350));
  }

  // 5. 개봉 완료
  if (progressBox) progressBox.classList.add('hidden');
  if (openBtn) openBtn.disabled = false;
  if (fastOpenBtn) fastOpenBtn.disabled = false;
  if (actionBox) {
    actionBox.classList.remove('hidden');
    renderPackSummary();
  }

  isPackOpening = false;
}

// 🤖 LLM (기획) + DanTagGen (태그 확장) + NovelAI (이미지 연성) 파이프라인
async function generateSinglePackCardWithAI(baseConcept, element, rarity, cardType, fastMode, ollamaOnline, loadingLabel, progressText, cardIndex, packThemeName = 'Fantasy Pack') {
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;
  const cost = caps.costRange[0] + Math.floor(Math.random() * (caps.costRange[1] - caps.costRange[0] + 1));
  let atk = caps.atkRange[0] + Math.floor(Math.random() * (caps.atkRange[1] - caps.atkRange[0] + 1));
  let def = caps.defRange[0] + Math.floor(Math.random() * (caps.defRange[1] - caps.defRange[0] + 1));
  let hp = caps.hpRange[0] + Math.floor(Math.random() * (caps.hpRange[1] - caps.hpRange[0] + 1));
  const spellDmg = caps.spellDamage[0] + Math.floor(Math.random() * (caps.spellDamage[1] - caps.spellDamage[0] + 1));

  if (cardType === 'spell') {
    atk = 0; def = 0; hp = 0;
  } else if (cardType === 'structure') {
    atk = 0;
    def = Math.floor(def * 1.3);
    hp = Math.floor(hp * 1.3);
  }

  let cardName = `${baseConcept}`;
  let visualPrompt = `${baseConcept}, fantasy anime art`;
  let skillName = `${baseConcept}의 비기`;
  let skillDesc = cardType === 'spell' 
    ? `[즉발 주문] 적에게 ${spellDmg}의 ${ELEMENT_CONFIG[element].name} 피해를 입힙니다.`
    : (cardType === 'structure' 
      ? `[건축물 패시브] 매 턴 방어막 +${caps.shieldValue[0]} 및 마나 공급.`
      : `${ELEMENT_CONFIG[element].name} 마력을 실어 ${atk} 공격을 가합니다.`);

  // 1단계: 로컬 LLM (Ollama)으로 개별 카드의 고유 이름, 스킬 및 핵심 단부루 시드 추출
  let themeObj = null;

  // 1단계: 카드 기획 (LLM 또는 스마트 폴백)
  if (!fastMode && ollamaOnline) {
    try {
      if (loadingLabel) loadingLabel.innerText = `🤖 [${cardIndex + 1}/5] Ollama 기획 중...`;
      
      const knownThemes = getArchetypesPromptSummary();
      const packSeeds = [
        'Invent a completely original, character or relic title with distinctive proper nouns (e.g. 벨루가스, 세피로스, 아르테미아, 발타자르, 카엘).',
        'Invent an atmospheric, poetic Korean title that avoids formulaic template words.',
        'Focus on ancient forbidden magic or mythical beast names tailored to the concept.'
      ];
      const seedText = packSeeds[Math.floor(Math.random() * packSeeds.length)];
      const nonce = `pack-${cardIndex}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const promptMsg = `Create 1 authentic anime TCG card for Pack Theme: "${packThemeName || 'Fantasy Card Pack'}", Element: "${element}", Type: "${cardType}", Rarity: "${rarity}".
Seed Nonce: ${nonce}
Existing Archetypes list:
${knownThemes}

Guidelines (100% CREATIVE FREEDOM):
- You have complete freedom to invent any original character, monster, spell, or relic.
- Invent a concise, authentic Korean card name (strictly 2 to 4 Korean words, MAXIMUM 12 Korean characters). Do NOT use repetitive formulas or rigid templates.
- Strict integer values only (NEVER use % percentages).
- Assign to an existing archetype above or create a new archetype keyword ("themeName", "themeKeyword", "themeComboAction": "search|chainDamage|manaCharge|shieldHeal|freeze|doubleCast|draw|specialSummon").
- Clean Danbooru visual prompt for NovelAI V4.5 anime art.
Return ONLY JSON:
{
  "name": "컨셉에 맞춘 독창적인 한국어 카드 이름",
  "themeName": "카드군 테마명",
  "themeKeyword": "테마 핵심 키워드",
  "themeComboAction": "search|chainDamage|manaCharge|shieldHeal|freeze|doubleCast|draw|specialSummon",
  "themeComboDesc": "TCG 상호 연계 효과 설명",
  "visualPrompt": "core Danbooru tags, e.g. 1girl, masterpiece",
  "skillName": "독창적인 스킬명",
  "skillDesc": "명확한 고정 정수 효과 설명 문장"
}`;

      const packReasoningSelect = document.getElementById('pack-reasoning-select');
      const packReasoningMode = packReasoningSelect ? packReasoningSelect.value : (state.settings.reasoningMode || 'fast');

      const cardJson = await callOllamaChat({
        messages: [
          { role: 'system', content: 'You are an authentic TCG card designer. Return ONLY a single valid raw JSON object.' },
          { role: 'user', content: promptMsg }
        ],
        timeoutMs: 300000, // 5분 타임아웃
        reasoningMode: packReasoningMode
      });

      if (cardJson.name) cardName = cardJson.name;
      if (cardJson.visualPrompt) {
        visualPrompt = expandDanbooruTags(cleanPromptTags(cardJson.visualPrompt), element, cardType, 28);
      }
      if (cardJson.skillName) skillName = cardJson.skillName;
      if (cardJson.skillDesc) skillDesc = cardJson.skillDesc;

      if (cardJson.themeName) {
        themeObj = await registerNewArchetype({
          name: cardJson.themeName,
          keyword: cardJson.themeKeyword,
          element: element,
          comboAction: cardJson.themeComboAction,
          themeComboDesc: cardJson.themeComboDesc,
          synergy: { desc: cardJson.themeComboDesc || `[${cardJson.themeName}] 테마 상호 연계` }
        });
      }
    } catch (e) {
      console.warn('카드팩 Ollama 응답 지연 -> DanTagGen 스마트 시드로 안전하게 완성:', e.message);
    }
  }

  if (!themeObj) {
    themeObj = findMatchingArchetype(cardName, element);
  }

  // 2단계: 이미지 생성 (DanTagGen 태그 파이프라인 + NovelAI Diffusion V4.5)
  let imageUrl = MOCK_PACK_IMAGES[element] || MOCK_PACK_IMAGES.fire;

  // 선택된 해상도 동적 추출
  const packResSelect = document.getElementById('pack-resolution-select');
  const chosenRes = (packResSelect && packResSelect.value) ? packResSelect.value : (state.settings.resolution || 'square-normal');
  const isPortrait = chosenRes.includes('portrait');
  const defaultCrop = isPortrait ? { scale: 1.0, x: 50, y: 15 } : { scale: 1.0, x: 50, y: 50 };

  if (!fastMode && state.settings.apiKey) {
    if (loadingLabel) loadingLabel.innerText = `🎨 [${cardIndex + 1}/5] NovelAI V4.5 연성 중...`;
    if (progressText) progressText.innerText = `[${cardIndex + 1}/5] 🎨 NovelAI V4.5로 '${cardName}' 일러스트 연성 중 (${chosenRes})...`;
    try {
      imageUrl = await generateNovelAIImage({
        prompt: visualPrompt,
        element: element,
        cardType: cardType,
        resolution: chosenRes,
        timeoutMs: 120000
      });
    } catch (e) {
      console.warn('NovelAI 생성 통신 안내 -> 고화질 아트로 안전하게 대체:', e.message);
    }
  }

  const optimizedImg = await optimizeCardImage(imageUrl);

  const skill = {
    name: skillName,
    description: skillDesc,
    cost: cost,
    damage: cardType === 'spell' ? spellDmg : atk,
    isAoeSpell: (cardType === 'spell') && (rarity === 'legendary' || rarity === 'epic'),
    passiveEffect: cardType === 'structure' ? { manaPerTurn: 1, endTurnShield: caps.shieldValue[0] } : null,
    statusEffect: { type: 'none', duration: 0, value: 0 }
  };

  const rawCard = {
    id: `pack-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    cardType: cardType,
    name: cardName,
    title: `${rarity.toUpperCase()} ${cardType.toUpperCase()}`,
    element: element,
    themeId: themeObj ? themeObj.id : null,
    themeName: themeObj ? themeObj.name : null,
    themeKeyword: themeObj ? themeObj.keyword : null,
    rarity: rarity,
    cost: cost,
    attack: atk,
    defense: def,
    hp: hp,
    imageUrl: optimizedImg,
    prompt: visualPrompt,
    crop: defaultCrop,
    skill: skill,
    skills: [skill]
  };

  const clampedCard = sanitizeAndClampCardData(rawCard);
  if (clampedCard.skill) {
    clampedCard.skills = [clampedCard.skill];
  }
  return clampedCard;
}

async function revealSingleCardSlot(slot, cardData) {
  audio.playDraw();

  // 등급에 따른 효과음 및 연출
  if (cardData.rarity === 'legendary') {
    audio.playVictory();
    if (window.confetti) confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  } else if (cardData.rarity === 'epic') {
    audio.playCrit();
  }

  slot.style.transform = 'rotateY(90deg)';
  await new Promise(r => setTimeout(r, 180));

  slot.innerHTML = '';
  slot.className = 'w-[205px] h-[335px] flex items-center justify-center transition-all duration-300';
  
  const cardEl = createCardElement(cardData, null, false);
  slot.appendChild(cardEl);

  slot.style.transform = 'rotateY(0deg)';
}

function renderPackSummary() {
  const summaryEl = document.getElementById('pack-summary-text');
  if (!summaryEl) return;

  const counts = { legendary: 0, epic: 0, rare: 0, common: 0 };
  openedPackCards.forEach(c => {
    if (counts[c.rarity] !== undefined) counts[c.rarity]++;
  });

  summaryEl.innerHTML = `
    <div class="flex items-center justify-center gap-3 text-xs font-bold">
      ${counts.legendary > 0 ? `<span class="text-amber-400 font-black">🌟 전설 ${counts.legendary}장</span>` : ''}
      ${counts.epic > 0 ? `<span class="text-purple-400 font-black">✨ 영웅 ${counts.epic}장</span>` : ''}
      ${counts.rare > 0 ? `<span class="text-blue-400">🔹 희귀 ${counts.rare}장</span>` : ''}
      <span class="text-slate-400">⚪ 일반 ${counts.common}장</span>
    </div>
  `;
}

export async function savePackCardsToCollection() {
  if (openedPackCards.length === 0) return;
  state.cardsCollection.unshift(...openedPackCards);
  await saveCardsToStorage();
  audio.playDraw();
  alert(`🎉 개봉된 5장의 카드가 마도서 보관함에 영구 저장되었습니다! (보관함: ${state.cardsCollection.length}장)`);
  
  const actionBox = document.getElementById('pack-action-box');
  if (actionBox) actionBox.classList.add('hidden');
}

export async function addPackCardsToActiveDeck() {
  if (openedPackCards.length === 0) return;
  state.cardsCollection.unshift(...openedPackCards);
  
  let addedCount = 0;
  openedPackCards.forEach(c => {
    if (state.activeDeckCardIds.length < MAX_DECK_SIZE && !state.activeDeckCardIds.includes(c.id)) {
      state.activeDeckCardIds.push(c.id);
      addedCount++;
    }
  });

  await saveCardsToStorage();
  await saveActiveDeckToStorage();
  audio.playDraw();
  alert(`✨ ${addedCount}장의 카드가 현재 출전 덱에 즉시 편성되었습니다! (보관함에도 5장 모두 저장됨)`);
  
  const actionBox = document.getElementById('pack-action-box');
  if (actionBox) actionBox.classList.add('hidden');
}
