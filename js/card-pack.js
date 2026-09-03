// card-pack.js - 5장 부스터 팩 개봉 및 LLM / NovelAI 실시간 순차 연성 시스템

import { state, saveCardsToStorage, saveActiveDeckToStorage, saveSettingsToStorage, optimizeCardImage, MAX_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { rollRandomRarity, rollCardCost, RARITY_BALANCE_CAPS, RARITY_STYLE, ELEMENT_CONFIG, sanitizeAndClampCardData, buildStructurePassive, describeStructurePassive, normalizeStructurePassive } from './config.js';

import { checkOllamaOnline, callOllamaChat, generateNovelAIImage } from './ai-service.js';
import { expandDanbooruTags, buildVisualPromptFromCard } from './dan-tag-gen.js';
import { registerNewArchetype, findMatchingArchetype, getRelevantArchetypesPrompt, cleanCardName, enforceKeywordInName } from './archetype-service.js';
import { escapeHtml } from './dom-utils.js';
import { coerceCardElement, playstyleGuide, playstyleOptionsForPrompt, inferPlaystyle } from './archetype-identity.js';
import { buildNamingRule, nameMatchesType, fixCardName, conceptTypeHint } from './card-naming.js';
import { battleRng, seedBattleRng } from './rng.js';
import { acquireCard, pickExistingCardForDuplicate, getCopies, getDust, MAX_CARD_COPIES } from './card-copies.js';
import { applyLlmDescription } from './card-describe.js';
import { cardTypeRules } from './card-type-rules.js';

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
  },
  // 🎯 5번째 팩 — 카드군을 직접 지정해서 뽑는다.
  //    카드군마다 팩을 만들면 종류가 폭발하므로, 이 팩 하나에서 셀렉트로 고른다.
  archetype_focus: {
    id: 'archetype_focus',
    name: '카드군 집중 부스터 팩',
    icon: '⚜️',
    elements: ['fire', 'water', 'lightning', 'holy', 'dark', 'nature'],
    bg: 'from-amber-950 via-slate-900 to-black',
    border: 'border-cyan-400/70',
    glow: 'shadow-cyan-500/40',
    desc: '원하는 카드군을 지정해 그 카드군 카드와 범용 카드만 집중적으로 뽑습니다',
    needsArchetypePick: true   // 이 팩만 카드군 선택 UI를 띄운다
  }
};

let currentPackTheme = 'allround';
let isPackOpening = false;
let openedPackCards = [];

// ⚠️ 컨셉은 카드 타입별로 고르게 넣으세요.
//    pickConceptForType()이 타입에 맞는 컨셉을 찾는데, 그 타입 컨셉이 하나도 없으면
//    중립 컨셉으로 폴백하고 결국 이름이 어긋납니다.
//    타입 판정은 **끝 단어**로 합니다 (card-naming.js의 head 목록).
const THEME_CONCEPTS = {
  fire_dark: [
    '지옥불을 휘감은 흑염룡의 검사', '종말의 헬파이어 메테오 스트라이크', '심연의 마왕 벨제부브 제단',
    '그림자 속의 암흑 뱀파이어', '작열하는 화염의 포탑', '칠흑의 영혼 수확술',
    '업화의 불길 올가미', '어둠에 잠긴 배신의 함정'
  ],
  water_holy: [
    '서리 궁전의 빙결 여왕', '아이기스의 수호 결계 요새', '시간을 되돌리는 빛의 신전',
    '절대영도의 눈보라 주술', '성역의 대천사 발키리', '치유와 정화의 신성 분수대',
    '얼어붙은 심판의 봉인', '성역을 침범한 자의 올가미'
  ],
  lightning_nature: [
    '천벌의 뇌창을 든 발키리', '세계수의 마나 증폭 수정탑', '맹독을 품은 엘프 대궁수',
    '초전도 번개 폭풍 스트라이크', '대자연의 에메랄드 골렘', '연쇄 감전의 비전 결계',
    '가시덩굴의 매복', '천둥이 내리치는 역습'
  ],
  allround: [
    '환상의 원소 마도사', '시공간 균열의 마나 첨탑', '천체의 비전 폭격',
    '심연의 암살자 레이븐', '빛의 수호 성벽', '천둥의 무투가 안드로이드',
    '차원을 가르는 반격', '운명을 뒤집는 계략'
  ]
};

/**
 * 이번에 뽑을 카드 타입에 어울리는 컨셉을 고른다.
 *
 * 컨셉 목록에는 소환수·주문·건축물이 섞여 있다. 타입과 무관하게 집으면
 * 건축물 카드에 인물 컨셉이 들어가 이름이 어긋난다.
 * 타입 힌트가 없는(중립) 컨셉은 아무 타입에나 써도 되므로 후보에 포함한다.
 */
function pickConceptForType(concepts, cardType, seedIdx = 0) {
  if (!Array.isArray(concepts) || concepts.length === 0) return null;
  const exact = [];
  const neutral = [];
  for (const c of concepts) {
    const hint = conceptTypeHint(c);
    if (hint === cardType) exact.push(c);
    else if (!hint) neutral.push(c);
  }
  const pool = exact.length ? exact : neutral;
  if (!pool.length) return null;
  return pool[seedIdx % pool.length];
}

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
        ${theme.needsArchetypePick && isSelected ? archetypePickerHtml() : ''}
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
  // 새 팩이므로 지난 팩에서 잠갔던 저장 버튼과 선택 상태를 되돌린다
  resetPackActionButtons();
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

  // 🆕 이 팩에서 "새 카드군을 창작하라"는 지시를 받을 슬롯 (없으면 -1).
  //    🐛 수정: 프롬프트의 ARCHETYPE REUSE RULE이 "조금이라도 겹치면 기존에 편입"을 최우선으로
  //       두자, 4B 모델은 목록에 6개가 보이는 한 **한 번도** 새 카드군을 만들지 않았다
  //       (유저 실측: 팩을 계속 뽑아도 카드군이 늘지 않는다). 난립을 막던 규칙이 정체를
  //       만든 것이다. 규칙은 기본으로 두고, 확률적으로 **한 슬롯만** 지시를 뒤집는다 —
  //       팩당 최대 1개라 난립으로 되돌아가지 않는다. 범용 팩·카드군 집중 팩은 제외한다
  //       (둘 다 "새 카드군 금지"가 팩의 정의다) → DECISIONS #93
  const newArchetypeSlot = (getSelectedPackMode().mode === 'random' && Math.random() < PACK_NEW_ARCHETYPE_CHANCE)
    ? Math.floor(Math.random() * 5) : -1;

  for (let i = 0; i < 5; i++) {
    const slot = document.getElementById(`pack-slot-${i}`);
    const spinner = slot.querySelector('.slot-spinner');
    const loadingLabel = slot.querySelector('.slot-loading-label');
    if (spinner) spinner.classList.remove('hidden');

    // 5번째 카드는 최소 RARE 이상 확정 룰 적용
    const rarity = rollRandomRarity(i === 4 ? 'rare' : null);
    const element = theme.elements[Math.floor(Math.random() * theme.elements.length)];
    
    // 카드 타입 배분 (소환수 55%, 주문 22%, 건축물 13%, 함정 10%)
    const typeRoll = Math.random();
    let cardType = 'unit';
    if (typeRoll < 0.22) cardType = 'spell';
    else if (typeRoll < 0.35) cardType = 'structure';
    else if (typeRoll < 0.45) cardType = 'trap';

    // 🐛 수정: 예전에는 컨셉을 cardType과 **무관하게** 골랐다.
    //    그래서 건축물 롤인데 "그림자 속의 암흑 뱀파이어" 컨셉을 받고
    //    LLM이 그대로 "심연의 그림자 암살자"라는 소환수 이름을 지었다.
    //    타입에 어울리는 컨셉을 먼저 찾고, 없으면 중립 컨셉을 쓴다.
    const baseConcept = pickConceptForType(shuffledConcepts, cardType, i)
      || shuffledConcepts[i % shuffledConcepts.length]
      || rawConcepts[0];

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

    const cardData = await generateSinglePackCardWithAI(baseConcept, element, rarity, cardType, fastMode, ollamaOnline, loadingLabel, progressText, i, theme.name,
      { newArchetype: i === newArchetypeSlot });

    if (progressText) progressText.innerText = `[${i + 1}/5] ✨ [${cardData.rarity.toUpperCase()}] ${cardData.name} 완성!`;
    if (progressBar) progressBar.style.width = `${((i + 1) / 5) * 100}%`;

    openedPackCards.push(cardData);

    // 4. 카드 뒤집기 (Flip) 및 공개 연출
    //    ⚠️ 인덱스를 넘긴다 — 선택 식별을 카드 id로 하면 중복 카드에서 깨진다
    await revealSingleCardSlot(slot, cardData, i);
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

/**
 * 🆕 팩당 **한 슬롯**이 "새 카드군을 창작하라"는 지시를 받을 확률.
 * 0이면 예전처럼 LLM이 알아서(= 거의 안 만든다), 1이면 매 팩마다 새 카드군 하나.
 * 난립(DECISIONS #1)과 정체 사이의 다이얼이다 — 카드군이 충분히 쌓였으면 내리면 된다.
 */
const PACK_NEW_ARCHETYPE_CHANCE = 0.35;

// 🤖 LLM (기획) + DanTagGen (태그 확장) + NovelAI (이미지 연성) 파이프라인
/**
 * 🔁 이미 보유한 카드가 중복으로 나올 확률.
 *
 * 중복이 나오면 LLM·NovelAI 호출을 통째로 건너뛰므로 카드깡이 훨씬 빠르다.
 * 보유 카드가 많을수록 중복 확률이 자연스럽게 올라간다(실제 TCG와 같다).
 *
 * ⚠️ 뽑기 자체에는 제한을 두지 않는다 — 중복도 랜덤성의 일부다.
 *    상한(3장)을 넘긴 중복은 가루가 된다.
 */
function duplicateChance() {
  const owned = (state.cardsCollection || []).length;
  if (owned < 6) return 0;                 // 초반에는 새 카드 위주
  return Math.min(0.45, 0.1 + owned * 0.01); // 최대 45%
}

/** 팩 조건(속성/카드군)에 맞는 기존 카드만 중복 후보로 삼는다 */
function duplicateFilter(element, packMode) {
  return (c) => {
    if (packMode.mode === 'generic') return !c.themeId;
    if (packMode.mode === 'archetype') {
      return c.themeId === packMode.theme.id || !c.themeId;
    }
    return c.element === element || !c.themeId;
  };
}

async function generateSinglePackCardWithAI(baseConcept, element, rarity, cardType, fastMode, ollamaOnline, loadingLabel, progressText, cardIndex, packThemeName = 'Fantasy Pack',
  { newArchetype = false } = {}) {

  // 🔁 확률적으로 이미 가진 카드를 중복으로 뽑는다 — AI 호출을 건너뛰어 카드깡이 빨라진다
  const packMode = getSelectedPackMode();
  // (새 카드군 창작 슬롯은 중복으로 대체하지 않는다 — 그러면 이 팩의 창작 기회가 사라진다)
  if (!newArchetype && battleRng().chance(duplicateChance())) {
    const dup = pickExistingCardForDuplicate(battleRng(), duplicateFilter(element, packMode));
    if (dup) {
      if (loadingLabel) loadingLabel.innerText = `🔁 [${cardIndex + 1}/5] 중복 카드 발견 — 즉시 획득`;
      return { ...dup, isDuplicatePull: true };
    }
  }
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;
  const cost = rollCardCost(caps.costRange[1]);   // 💎 덱 커브 분포 (등급이 아니라 커브가 정한다)
  let atk = caps.atkRange[0] + Math.floor(Math.random() * (caps.atkRange[1] - caps.atkRange[0] + 1));
  let def = caps.defRange[0] + Math.floor(Math.random() * (caps.defRange[1] - caps.defRange[0] + 1));
  let hp = caps.hpRange[0] + Math.floor(Math.random() * (caps.hpRange[1] - caps.hpRange[0] + 1));
  const spellDmg = caps.spellDamage[0] + Math.floor(Math.random() * (caps.spellDamage[1] - caps.spellDamage[0] + 1));

  // 함정도 스탯이 없다 (필드에 나오지 않고 효과만 터진다)
  if (cardType === 'spell' || cardType === 'trap') {
    atk = 0; def = 0; hp = 0;
  } else if (cardType === 'structure') {
    atk = 0;
    def = Math.floor(def * 1.3);
    hp = Math.floor(hp * 1.3);
  }

  let cardName = `${baseConcept}`;
  let visualPrompt = `${baseConcept}, fantasy anime art`;
  // 🎯 대상 규칙 기본값 — LLM이 안 주면 '적 1체'. 광역은 예산을 통과해야만 붙는다.
  let skillTargetSide = 'foe';
  let skillTargetScope = 'single';
  let skillTargetCount = 1;
  let llmPassiveRaw = null;      // 🏛️ LLM이 설계한 건축물 패시브 (없으면 폴백)
  let llmVanilla = false;        // 🃏 LLM이 바닐라로 만들겠다고 했는가
  let llmFlavorText = null;      // 🃏 그때 쓸 플레이버 텍스트
  let llmTrapTrigger = null;     // 🪤 함정 발동조건 (없으면 sanitize가 기본값을 넣는다)
  let llmTrapCondition = null;   // 🪤 그 조건이 요구하는 값 (속성·카드군 등)
  let llmEffects = null;         // ⚙️ LLM이 정한 실제 효과 수치 (없으면 굴린 damage만)
  let skillDamageTarget = null;  // 💥 피해를 본체에 꽂는가 전장에 꽂는가
  let skillName = `${baseConcept}의 비기`;
  // 🐛 수정: 예전에는 함정에도 소환수 문구를 붙여 **"0 공격을 가합니다"**가 나왔다
  //    (함정은 공격력이 0이다). 건축물 문구도 실제 패시브와 무관한 고정 문장이었다.
  //    이제 소환수·주문만 문구를 주고, 나머지는 **비워서** sanitize가
  //    확정된 수치로 만들게 한다 (describeSkillFromData).
  let skillDesc = cardType === 'spell'
    ? `[즉발 주문] 적에게 ${spellDmg}의 ${ELEMENT_CONFIG[element].name} 피해를 입힙니다.`
    : (cardType === 'unit'
      ? `${ELEMENT_CONFIG[element].name} 마력을 실어 ${atk} 공격을 가합니다.`
      : '');

  // 1단계: 로컬 LLM (Ollama)으로 개별 카드의 고유 이름, 스킬 및 핵심 단부루 시드 추출
  let themeObj = null;

  // 1단계: 카드 기획 (LLM 또는 스마트 폴백)
  if (!fastMode && ollamaOnline) {
    try {
      if (loadingLabel) loadingLabel.innerText = newArchetype
        ? `🆕 [${cardIndex + 1}/5] 새 카드군 창작 중...`
        : `🤖 [${cardIndex + 1}/5] Ollama 기획 중...`;
      
      // 팩 테마와 의미가 가까운 카드군만 싣는다
      const packDirective = packModeDirective(packMode);
      const knownThemes = await getRelevantArchetypesPrompt(`${packThemeName || ''} ${element} ${cardType}`, 6);
      const packSeeds = [
        'Invent a completely original, character or relic title with distinctive proper nouns (e.g. 벨루가스, 세피로스, 아르테미아, 발타자르, 카엘).',
        'Invent an atmospheric, poetic Korean title that avoids formulaic template words.',
        'Focus on ancient forbidden magic or mythical beast names tailored to the concept.'
      ];
      const seedText = packSeeds[Math.floor(Math.random() * packSeeds.length)];
      const nonce = `pack-${cardIndex}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      // 🎯 이 타입에만 해당하는 규칙만 싣는다. 네 타입 규칙을 다 보내면
      //    LLM이 타입 특징을 섞는다 (소환수에 함정식 효과, 함정에 소환수 문구 등).
      const typeRules = cardTypeRules(cardType);
      // 🔴/🆕 카드군 규칙. 기본은 **재사용**(난립 방지)이고, 이 팩의 창작 슬롯만 뒤집는다.
      //    같은 프롬프트에 둘을 다 실으면 4B 모델은 늘 재사용을 고른다 — 하나만 보낸다.
      const archetypeRule = newArchetype
        ? `🆕 NEW ARCHETYPE RULE (이 카드만 — 가장 중요, 반드시 지킬 것):
- 이 카드는 **새 카드군을 창설**한다. 위 목록의 어떤 카드군에도 편입시키지 말 것.
- "themeId": null 로 두고, 새 "themeName"과 "themeKeyword"(2~4글자 한국어 명사)를 지을 것.
- 새 이름·키워드는 위 목록의 이름·키워드와 **겹치거나 변형이면 안 된다** (예: "홍련"이 있으면 "홍련 기사단"·"붉은 연꽃" 금지).
- 컨셉은 위 목록과 뚜렷이 구별되는 새 세계관(종족·조직·현상·유물)으로 잡을 것.
- "elementPolicy", "elements", "themePlaystyle", "themeComboAction", "themeComboDesc"를 모두 채울 것 (신규 카드군 필수 항목).`
        : `🔴 ARCHETYPE REUSE RULE (가장 중요 — 반드시 지킬 것):
- 위 목록에 이미 있는 카드군과 컨셉/속성/효과가 조금이라도 겹치면, 새로 만들지 말고 그 카드군의 id를 "themeId"에 그대로 복사하고 "themeName"에도 목록의 이름을 한 글자도 바꾸지 말고 그대로 쓸 것.
- ❌ 절대 금지: 기존 "홍련의 검사단"이 있는데 "홍련 검사단", "홍련기사단", "붉은 연꽃 검사단" 같은 변형 이름을 새로 만드는 행위.
- ✅ 진짜로 위 목록 어디에도 속하지 않는 완전히 새로운 컨셉일 때만 "themeId": null 로 두고 새 카드군을 창설할 것.
- 카드군은 적을수록 좋다. 애매하면 무조건 기존 카드군에 편입시킬 것.`;
      const promptMsg =`Create 1 authentic anime TCG card for Pack Theme: "${packThemeName || 'Fantasy Card Pack'}", Element: "${element}", Type: "${cardType}", Rarity: "${rarity}", Mana Cost: ${cost} (고정).

💎 이 카드의 마나 코스트는 **${cost}**로 이미 정해져 있다. 바꾸지 마라.
- **등급은 코스트를 정하지 않는다.** 등급이 정하는 건 그 코스트에서의 파워 밀도다.
  1마나 레전더리는 "아주 효율 좋은 작은 카드", 6마나 커먼은 "느리지만 효과가 많은 카드"다.
- ${cost}마나에 어울리는 규모로 설계하라:
  1~2마나 → 효과 1개, 작은 스탯 / 3~4마나 → 효과 1~2개 / 5마나 이상 → 효과 2~3개.
- ⚠️ 넘치면 시스템이 효과를 잘라내거나 수치를 깎고, 너무 빈약하면 마나를 내린다.

${typeRules}
Seed Nonce: ${nonce}
Existing Archetypes list:
${knownThemes}

${archetypeRule}


🏷️ CARD NAME & KEYWORD FORMAT:
- 카드군 키워드는 **2~4글자 한국어 명사**여야 한다. 한 글자 키워드는 절대 금지.
  * ✅ "홍련", "빙결", "심연", "세계수"    ❌ "절", "동", "균"
- 카드 이름은 **자연스러운 한국어 TCG 이름**으로 지을 것.
  카드군 소속은 시스템이 따로 표시하므로 키워드를 억지로 끼워 넣지 않아도 된다.
  다만 자연스럽게 녹아들면 더 좋다.
  * ✅ "홍련의 검성 아스카", "빙결 파수꾼", "달그림자 암살자 카엘"
  * ❌ "(절) [서리의 얼음술사]"   — 괄호·대괄호로 키워드를 따로 표시하지 말 것
  * ❌ "[동결의 수호자 - Frost Guardian]"  — 영어 부제는 "title" 필드에만

🎨 ARCHETYPE ELEMENT POLICY (카드군 속성 정책 — 신규 카드군일 때만 지정):
- "elementPolicy"로 카드군의 속성 구성을 정한다.
  * "mono"  : 단일 속성. 정체성이 가장 뚜렷하다. (예: 홍련 = 화염만)
  * "dual"  : 두 속성. 단 **상극 조합 금지** (화염↔물, 번개↔자연, 신성↔암흑)
  * "multi" : 3속성 이상. 속성 전환 자체가 컨셉인 카드군 (예: 엘리멘틀 히어로)
- "elements"에 허용 속성 배열을 넣는다. 예: ["fire"] 또는 ["fire","lightning"]
- ❌ 절대 금지: mono/dual 카드군에 상극 속성을 함께 넣기
- 이 카드군에 속하는 카드의 "element"는 반드시 "elements" 안의 값이어야 한다.

⚡ ARCHETYPE UNIQUE COMBO (카드군 고유 연계):
연계는 [무엇을] × [언제] × [얼마나] 세 축으로 정한다. 카드군마다 다르게 지어라.
- "themeComboAction" (무엇을) — 등급이 높을수록 강한 대신 위력 기본치가 낮아진다:
  [1등급 기본] manaCharge(마력 공명) · chainDamage(연쇄 폭격) · shieldHeal(수호 결계)
  [2등급 준수] search(덱 서치) · draw(영혼 회수) · archetypeRally(카드군 결집) · archetypeGuard(카드군 수호)
  [3등급 강력] freeze(결빙) · specialSummon(특수 소환) · archetypeSalvage(카드군 회수) · shieldBreak(결계 파쇄) · handDisrupt(패 교란)
  [4등급 최상] doubleCast(과충전) · sacrificeStrike(제물 강타)
  💡 3~4등급만 고르지 말 것. 카드군 대부분은 1~2등급이어야 게임이 굴러간다.
  💡 archetype*로 시작하는 액션은 **같은 카드군에만** 적용되는 특수 연계다.
     카드군 정체성을 살리고 싶으면 이쪽을 쓰라.
- "comboTrigger" (언제 발동):
  * "always"        — 카드를 낼 때마다 (무난하지만 개성 없음)
  * "archetypePair" — 같은 카드군이 필드에 2장 이상일 때만 (전개형 카드군)
  * "lowHp"         — 내 체력 절반 이하일 때만 (역전형 카드군)
  * "bossShielded"  — 상대가 방어막을 두르고 있을 때만 (카운터형; 키 이름은 유산)
  * "handRich"      — 손패 5장 이상일 때만 (자원형)
  * "lateGame"      — 5턴 이후 (장기전형)
  * "earlyGame"     — 3턴 이내 (속공형)
- "comboScope" (무엇에 반응하는가) — 이게 덱 컨셉을 결정한다:
  * "archetype" 같은 카드군에만 반응 (위력 100%) — 정체성이 가장 뚜렷한 카드군
  * "element"   같은 속성이면 카드군이 달라도 반응 (위력 80%) — **속성 덱**이 성립
  * "cardType"  같은 카드 타입에만 반응 (위력 80%) — **소환수 덱 / 주문 덱 / 함정 덱**이 성립
                이때 "comboScopeValue"에 unit|spell|structure|trap 중 하나를 지정
  * "any"       아무 아군 카드나 반응 (위력 60%) — **범용 카드 중심 덱**이 성립
  💡 범위가 넓을수록 위력이 낮아진다. 조건이 쉬운 만큼 값을 치르는 것이다.
  💡 element / cardType / any를 쓰면 범용 카드도 연계에 기여하므로 덱 구성이 다양해진다.
- "comboScaling" (얼마나):
  * "flat"    — 고정 위력
  * "perAlly" — 같은 카드군을 많이 깔수록 강해짐
  * "perTurn" — 턴이 길어질수록 강해짐
  * "perHand" — 손패가 많을수록 강해짐
💡 카드군의 컨셉과 어울리게 고르라. "심연의 암살자"라면 lowHp + perTurn,
   "홍련 기사단"이라면 archetypePair + perAlly 같은 식이다.
   always + flat은 개성이 없으니 꼭 필요할 때만 쓸 것.

🌐 GENERIC CARD RATIO (범용 카드 비율 — 중요):
모든 카드가 카드군에 속할 필요는 없다. 실제 TCG는 **범용 카드가 덱의 절반 가까이** 차지한다.
- 약 **35~40%는 범용 카드**로 만들라. 범용은 "themeId": null, "themeName": null 로 둔다.
- 범용 카드는 특정 카드군에 얽매이지 않는 대신 자체 스펙이 깔끔해야 한다
  (드로우, 제거, 방어막, 마나 수급 같은 만능 도구).
- ✅ 좋은 범용 예: "결계 분쇄의 일격", "욕망의 항아리", "방랑 용병"
- ❌ 나쁜 예: 억지로 카드군을 붙인 범용 카드

⚖️ EFFECT BUDGET BY RARITY (등급별 효과 예산 — 반드시 지킬 것):
카드 성능은 스탯 수치가 아니라 **효과의 개수와 강도**로 결정된다.
- common    : 효과 1개. 피해 / 방어막 / 치유 / 상태이상 중 하나만.
- rare      : 효과 최대 2개. 드로우·마나수급·연타·치명타·흡혈·광역 가능.
- epic      : 효과 최대 3개. 실드관통·처형·더블캐스트 가능.
- legendary : 효과 최대 4개. 무적은 legendary만 가능.
❌ 절대 금지: common/rare 카드에 "무적", "모든 피해 무효화", "실드 관통", "처형" 부여
❌ 절대 금지: 한 카드에 "드로우 + 방어무시 피해 + 회복"처럼 서로 다른 역할을 3개 이상 몰아넣기
카드는 **하나의 역할**을 명확히 해야 한다. 만능 카드를 만들지 말 것.

Guidelines (100% CREATIVE FREEDOM):
- You have complete freedom to invent any original character, monster, spell, or relic.
- Invent a concise, authentic Korean card name (strictly 2 to 4 Korean words, MAXIMUM 12 Korean characters). Do NOT use repetitive formulas or rigid templates.
${buildNamingRule(cardType)}
- Strict integer values only (NEVER use % percentages).
- Assign to an existing archetype above or create a new archetype keyword ("themeName", "themeKeyword", "themeComboAction": "search|chainDamage|manaCharge|shieldHeal|freeze|doubleCast|draw|specialSummon").
${packDirective}
Return ONLY JSON:
{
  "name": "컨셉에 맞춘 독창적인 한국어 카드 이름",
  "themeId": "기존 카드군이면 위 목록의 id를 그대로 복사. 완전히 새로운 카드군일 때만 null",
  "themeName": "카드군 테마명 (기존 카드군이면 목록의 이름을 그대로 사용)",
  "themeKeyword": "카드군 핵심 키워드 (2~4글자 한국어)",
  "elementPolicy": "mono|dual|multi (신규 카드군일 때만)",
  "themePlaystyle": "신규 카드군일 때만: turtle|swarm|control|ace|burn|toolbox",
  "elements": ["허용 속성 배열, 예: fire 또는 fire,lightning"],
  "comboTrigger": "always|archetypePair|lowHp|bossShielded|handRich|lateGame|earlyGame",
  "comboScaling": "flat|perAlly|perTurn|perHand",
  "comboScope": "archetype|element|cardType|any",
  "comboScopeValue": "comboScope가 cardType일 때만: unit|spell|structure|trap",
  "themeComboAction": "search|chainDamage|manaCharge|shieldHeal|freeze|doubleCast|draw|specialSummon|archetypeRally|archetypeSalvage|archetypeGuard|shieldBreak|handDisrupt|sacrificeStrike",
  "themeComboDesc": "TCG 상호 연계 효과 설명",
  "visualSeeds": "이 카드의 그림을 묘사하는 영어 핵심 키워드 3~6개, 쉼표 구분. 완성된 태그 목록이 아니라 핵심만. 예: frost sorceress, ice crystal staff, snowfall",
  "skillName": "독창적인 스킬명",
  "isVanilla": "효과 없는 바닐라로 만들 때만 true (그러면 효과 수치는 전부 0)",
  "flavorText": "카드의 분위기 한 줄 (40자 이내). ⚠️ 효과·수치를 쓰지 마라 — 규칙 텍스트는 시스템이 데이터에서 만든다.",
  "targetSide": "foe|ally|self|any",
  "targetScope": "single|multi|all|random",
  "targetCount": 1-3,
  "damageTarget": "body|field|any — 💥 피해를 어디에 꽂는가. body(상대 본체만·비쌈) / field(전장 기물만·쌈) / any(둘 다)",
  "damage": 0-24,
  "shield": 0-18,
  "heal": 0-18,
  "multiHit": 1-3,
  "drawCards": 0-3,
  "manaGain": 0-2,
  "maxHpGain": 0-10,
  "lifestealPercent": 0,
  "critChance": 0,
  "executeThreshold": 0,
  "pierceShield": false,
  "doubleCastNext": false,
  "invulnerableTurns": 0,
  "damageReduction": 0-60,
  "attackDown": 0-9,
  "silence": false,
  "destroy": 0-3,
  "searchDeck": 0-3,
  "summonToken": 0-3,
  "hpTarget": "body|minion",
  "statusEffect": { "type": "none|stun|freeze|burn|shock|poison|vulnerable", "duration": 1-3, "value": 0-10 },
  "passiveEffect": "건축물(structure)일 때만. 아래 🏛️ 규칙 참고. 다른 타입이면 null"
}

⚙️ 실제로 구현된 효과만 쓸 것 (위 목록에 없는 건 글자만 남고 동작하지 않는다).
- 쓰지 않는 효과는 0 / false / "none"으로 둘 것.
- ❌ 엔진에 **없는** 동작이라 설명문에도 쓰면 안 되는 것: 부활·되살리기, 카드 강탈,
  변신·둔갑. (묘지·소유권 이전·카드 교체가 없다)
- ✅ 파괴(destroy)·덱 서치(searchDeck)·토큰 소환(summonToken)은 **있다.** 쓰려면
  설명문이 아니라 위 필드에 숫자를 넣을 것.


💫 STATUS EFFECT 적용 범위 (중요):
- **stun(기절) / freeze(빙결) / burn(화상) / poison(맹독)** 은 **소환수·건축물 전용**이다.
  본체에는 걸리지 않고, 상대 전장이 비어 있으면 **불발**한다.
  본체는 체력이 낮은데 행동 봉쇄와 지속 피해는 대응할 여지가 없기 때문이다.
  * ✅ "적 소환수 1체를 2턴간 빙결"    ❌ "상대를 2턴간 기절"
- **shock(감전) / vulnerable(취약)** 은 본체에도 걸린다 (증폭기라서).
- "maxHpGain"으로 **본체 최대 체력을 영구히 올리는** 카드도 만들 수 있다.

⚖️ 타입별 효과 예산 (카드 타입마다 넣을 수 있는 효과의 양이 다르다):
- **소환수**는 스탯(공/체/방)이 예산을 많이 쓴다 → 효과는 **1~2개**로 절제하라.
  낮은 등급 소환수는 효과가 아예 없는 것도 정상이다 (바닐라 카드).
- **건축물**은 공격하지 않으므로 체력이 싸다 → 지속 패시브 + 효과 1개 정도.
- **마법**은 스탯이 없어 예산 전부가 효과로 가지만, 일회용이라 총량이 낮다 → **1~2개**.
- **함정**은 조건부라 총량 보상을 받는다 → 같은 마나에서 가장 많은 효과 (**2~3개**).
⚠️ 효과를 많이 넣으면 시스템이 **마나를 올리거나 효과를 잘라낸다.**
   반대로 효과가 너무 적으면 **마나를 내린다** — 값을 치를 것이 없는 고코스트 카드는
   死카드이기 때문이다. 마나와 효과량을 애초에 맞춰서 내라.

🎯 targetSide는 **누구를 겨냥하는가**다. 스킬 하나에 하나만 있다.
- 공격·디버프(damage / attackDown / silence / statusEffect / destroy) → "foe"
- 남을 치유하거나 버프 → "ally"        - 양쪽 다 고를 수 있게 → "any"
- "self"는 **겨냥하는 효과가 하나도 없을 때만** 쓴다.
  ⚠️ 방어막·마나 수급·드로우는 겨냥이 필요 없어 targetSide를 보지 않는다.
     그것들 때문에 "self"를 고르지 마라 — 같은 카드에 damage가 있으면
     "자신 1체에 12 피해"라는 이상한 카드가 된다 (자기 피해 메커니즘이 없다).
  * ✅ "적 1체에 12 피해 + 내 방어막 8" → "targetSide": "foe"

🎯 대상 규칙: 범위가 넓을수록 카드가 강해지고 마나도 비싸진다.
   single(1배) < 2체(1.5배) < 3체(2배) < 전체(2.2배), random은 0.8배.
   예산을 넘으면 시스템이 범위를 좁힌다. 낮은 등급에 전체 대상은 대부분 잘린다.`;

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
      // 🏷️ 시각 프롬프트: LLM이 준 영어 핵심 키워드를 태그 제네레이터가 확장
      visualPrompt = buildVisualPromptFromCard({
        name: cardJson.name,
        themeName: cardJson.themeName,
        visualSeeds: cardJson.visualSeeds || cardJson.visualPrompt,
        skill: { name: cardJson.skillName, description: cardJson.skillDesc }
      }, element, cardType, packThemeName || '');
      if (cardJson.skillName) skillName = cardJson.skillName;
      if (cardJson.skillDesc) skillDesc = cardJson.skillDesc;
      // 🃏 바닐라 — 효과 대신 플레이버 텍스트를 담는 카드
      if (cardJson.isVanilla) llmVanilla = true;
      if (cardJson.flavorText) llmFlavorText = String(cardJson.flavorText);
      if (cardJson.targetSide) skillTargetSide = cardJson.targetSide;
      if (cardJson.targetScope) skillTargetScope = cardJson.targetScope;
      if (cardJson.targetCount) skillTargetCount = parseInt(cardJson.targetCount) || 1;
      if (cardJson.damageTarget) skillDamageTarget = String(cardJson.damageTarget);
      if (cardJson.passiveEffect) llmPassiveRaw = cardJson.passiveEffect;
      // 🪤 🐛 이걸 읽지 않아서 **생성된 함정이 전부 발동조건 없이** 나왔다.
      //    프롬프트로는 요구해놓고 응답에서 버리고 있었다 (보관함 함정 6/6이 死카드).
      if (cardJson.trapTrigger) llmTrapTrigger = String(cardJson.trapTrigger);
      if (cardJson.condition) llmTrapCondition = cardJson.condition;

      // ⚙️ 🐛 **효과 필드를 하나도 읽지 않고 있었다.**
      //    프롬프트는 설명문만 요구했고, damage는 등급 범위에서 굴려 붙였다.
      //    그 결과 팩에서 나온 카드가 **전부 순수 피해 카드**였다 —
      //    실측: 유저 덱 14종 중 11종이 damage 하나뿐.
      //    LLM은 "소환수를 제거하고 드로우한다"는 화려한 문장을 쓰는데
      //    엔진에 들어가는 건 damage=14뿐이라, 설명문이 구조적으로 거짓이 됐다.
      //    → 프롬프트에 필드를 추가하면 **파싱·조립에도 반드시** 넣는다 (규칙 42)
      llmEffects = {};
      const num = (v, max) => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0;
      };
      for (const [key, cap] of Object.entries({
        damage: 30, shield: 24, heal: 24, multiHit: 3, drawCards: 3, manaGain: 3,
        maxHpGain: 12, damageReduction: 60, attackDown: 12,
        destroy: 3, searchDeck: 3, summonToken: 3
      })) {
        const v = num(cardJson[key], cap);
        if (v > 0) llmEffects[key] = (key === 'multiHit') ? Math.round(v) : Math.round(v);
      }
      // 0~1 비율 계열 (LLM이 30처럼 퍼센트로 주기도 한다 — 1을 넘으면 100으로 나눈다)
      for (const key of ['lifestealPercent', 'critChance', 'executeThreshold']) {
        let v = parseFloat(cardJson[key]);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (v > 1) v = v / 100;
        llmEffects[key] = Math.min(1, v);
      }
      for (const key of ['pierceShield', 'doubleCastNext', 'silence']) {
        if (cardJson[key] === true) llmEffects[key] = true;
      }
      if (num(cardJson.invulnerableTurns, 3) > 0) llmEffects.invulnerableTurns = Math.round(num(cardJson.invulnerableTurns, 3));
      if (cardJson.hpTarget === 'minion' || cardJson.hpTarget === 'body') llmEffects.hpTarget = cardJson.hpTarget;
      const st = cardJson.statusEffect;
      if (st && st.type && st.type !== 'none') {
        llmEffects.statusEffect = {
          type: String(st.type),
          duration: Math.min(3, Math.max(1, parseInt(st.duration) || 1)),
          value: Math.max(0, parseInt(st.value) || 0)
        };
      }

      if (cardJson.themeName) {
        themeObj = await registerNewArchetype({
          id: cardJson.themeId || null,
          name: cardJson.themeName,
          keyword: cardJson.themeKeyword,
          element: element,
          playstyle: cardJson.themePlaystyle,   // 🎭 LLM이 고른 플레이스타일
          comboAction: cardJson.themeComboAction,
          comboTrigger: cardJson.comboTrigger,
          comboScaling: cardJson.comboScaling,
          comboScope: cardJson.comboScope,
          comboScopeValue: cardJson.comboScopeValue,
          elementPolicy: cardJson.elementPolicy,
          elements: cardJson.elements,
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

  // 🐛 수정: 카드군의 속성 정책을 강제한다.
  //
  //   카드팩은 **카드군을 알기 전에** 팩 속성 목록에서 element를 먼저 뽑는다.
  //   그 뒤 LLM이 "이 카드는 [심연의 그림자단] 소속"이라고 답하는데,
  //   그 카드군이 어둠/mono여도 팩이 뽑은 화염이 그대로 저장됐다.
  //   → 어둠 카드군에 🔥 카드, ⚡ 카드가 섞여 나왔다.
  //
  //   coerceCardElement가 card-forge.js(단일 생성)에만 걸려 있고
  //   이 경로에는 빠져 있었던 것이 원인이다.
  //
  //   ⚠️ 이미지 생성보다 **먼저** 교정해야 일러스트도 올바른 속성으로 그려진다.
  const elementFix = coerceCardElement(themeObj, element);
  if (elementFix.changed) {
    console.info(`[카드팩] 속성 교정: ${element} → ${elementFix.element} (${elementFix.reason})`);
    element = elementFix.element;
    // 폴백 스킬 설명은 교정 전 속성명으로 이미 만들어졌다. LLM이 설명을 준
    // 경우에는 건드리지 않고, 폴백 문구일 때만 속성명을 맞춰준다.
    for (const [from, to] of Object.entries(ELEMENT_CONFIG)) {
      if (to.name && from !== element && skillDesc.includes(to.name)) {
        skillDesc = skillDesc.split(to.name).join(ELEMENT_CONFIG[element].name);
        break;
      }
    }
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

  // 🏛️ 건축물 패시브는 **속성별로** 만든다.
  //    🐛 수정: 예전에는 { manaPerTurn:1, endTurnShield:N }을 하드코딩해서
  //       화염 첨탑이든 세계수든 전부 똑같이 동작했다.
  //    패시브 내용을 엔진이 정하므로 설명문도 여기서 덮어쓴다 —
  //    LLM 플레이버를 남기면 실제로 안 일어나는 일이 카드에 적힌다.
  //    LLM이 설계한 패시브가 우선이고, 없으면 **카드군 플레이스타일**을 따른다.
  //    (속성으로 정하던 예전 방식은 자유도를 죽였다 — DECISIONS #67)
  let structPassive = null;
  if (cardType === 'structure') {
    structPassive = normalizeStructurePassive(llmPassiveRaw, rarity)
      || buildStructurePassive(inferPlaystyle(themeObj || {}), rarity);
    if (structPassive.aura && structPassive.aura.scope === 'element' && !structPassive.aura.scopeValue) {
      structPassive.aura.scopeValue = element;
    }
    skillDesc = describeStructurePassive(structPassive);
  }

  // 🃏 바닐라 — LLM이 그렇게 만들겠다고 했으면 효과 수치를 넣지 않는다.
  //    (건축물은 패시브가 정체성이라 바닐라로 두지 않는다)
  // ⚠️ 바닐라는 **소환수 전용**이다. 마법·함정·건축물은 효과가 전부라
  //    효과 없이 내면 발동해도 아무 일이 없는 백지 카드가 된다.
  const makeVanilla = llmVanilla && cardType === 'unit';

  const skill = {
    name: skillName,
    description: skillDesc,
    cost: cost,
    isVanilla: makeVanilla || undefined,
    flavorText: llmFlavorText || undefined,
    // 🪤 함정도 피해를 준다. atk를 쓰면 함정은 공격력이 0이라 피해도 0이 된다.
    damage: makeVanilla ? 0 : ((cardType === 'spell' || cardType === 'trap') ? spellDmg : atk),
    // 🎯 LLM이 정한 대상 규칙. 없으면 sanitizeAndClampCardData가 기본값(적 1체)으로 떨군다.
    //    isAoeSpell은 여기서 강제하지 않는다 — targetScope가 단일 소스다.
    targetSide: skillTargetSide,
    targetScope: skillTargetScope,
    targetCount: skillTargetCount,
    damageTarget: skillDamageTarget || undefined,
    passiveEffect: structPassive,
    // 🪤 함정 전용. sanitize가 비어 있으면 기본 조건을 채운다.
    trapTrigger: cardType === 'trap' ? (llmTrapTrigger || undefined) : undefined,
    condition: cardType === 'trap' ? (llmTrapCondition || undefined) : undefined,
    statusEffect: { type: 'none', duration: 0, value: 0 }
  };

  // ⚙️ LLM이 정한 효과를 얹는다.
  //    ⚠️ 위에서 굴린 damage는 **폴백**이다 — LLM이 damage를 줬으면 그쪽이 이긴다.
  //    바닐라는 효과가 없는 게 정의이므로 건너뛴다.
  //    예산 초과는 sanitizeAndClampCardData가 알아서 깎는다 (enforcePowerBudget).
  if (llmEffects && !makeVanilla) {
    Object.assign(skill, llmEffects);
    // LLM이 피해를 안 줬으면 굴린 값을 남긴다 (효과가 하나도 없는 카드 방지)
    if (!(skill.damage > 0) && Object.keys(llmEffects).length === 0) {
      skill.damage = (cardType === 'spell' || cardType === 'trap') ? spellDmg : atk;
    }
  }
  // 🏷️ 타입에 안 맞는 이름 교정 — LLM이 규칙을 어겨도 여기서 막는다.
  //    (건축물인데 "심연의 그림자 암살자" 같은 소환수 이름이 나오던 문제)
  //    수식어는 살리고 끝 단어만 타입에 맞게 바꾼다.
  if (!nameMatchesType(cardName, cardType)) {
    const fixed = fixCardName(cardName, cardType, () => battleRng().next());
    console.info(`[작명] ${cardType} 이름 교정: "${cardName}" → "${fixed}"`);
    cardName = fixed;
  }
  // 🏷️ 카드군 소속 카드는 이름에 키워드를 포함해야 덱 서치 콤보가 잡아낸다
  cardName = enforceKeywordInName(cardName, themeObj, cardType);

  const rawCard = {
    // 💎 코스트는 덱 커브에서 미리 굴려 LLM에 넘긴 값이다.
    //    예산이 이걸 올리거나 내리지 않고 **내용을 깎아서** 맞춘다.
    costLocked: true,
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

  // ✍️ 2단계 — **확정된 수치**로 설명문을 다시 쓴다.
  //    1단계에서 받은 설명문은 예산 정산 전 수치를 기준으로 쓰인 것이라
  //    깎이거나 잘려나간 뒤에는 어긋난다. 이제 수치가 고정됐으므로
  //    그것만 보고 문장을 만든다.
  //    ⚠️ 실패하면 아무것도 안 한다 — sanitize가 맞춰둔 문장이 이미 정확하다.
  //    ⚠️ fastMode(오프라인 폴백)에서는 건너뛴다. 카드당 호출이 2배가 된다.
  if (!fastMode && ollamaOnline) {
    if (loadingLabel) loadingLabel.innerText = `✍️ [${cardIndex + 1}/5] 카드 텍스트 다듬는 중...`;
    await applyLlmDescription(clampedCard, { timeoutMs: 45000 });
  }

  return clampedCard;
}

async function revealSingleCardSlot(slot, cardData, packIdx = 0) {
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
  slot.className = 'w-[205px] h-[335px] flex flex-col items-center justify-center gap-1.5 transition-all duration-300';

  const cardEl = createCardElement(cardData, null, false);
  slot.appendChild(cardEl);

  // ☑️ 카드별 선택 — 원하는 것만 보관함에 넣을 수 있게 한다.
  //    기본은 **전부 해제**. "5장 모두 저장" 버튼이 따로 있으므로
  //    미리 다 켜둘 이유가 없다 (켜두면 빼는 작업부터 해야 한다).
  //    🐛 수정: 식별자를 카드 id → **슬롯 인덱스**로 바꿨다.
  //       같은 카드가 2장 나오면 id가 같아서 querySelector가 첫 버튼만 찾았고,
  //       두 번째 카드를 눌러도 첫 번째가 토글됐다. 저장 대상 필터도
  //       id 기준이라 1장만 골라도 2장이 저장됐다.
  const pick = document.createElement('button');
  pick.className = 'pack-pick-btn w-full';
  pick.dataset.packIdx = String(packIdx);
  pick.dataset.cardId = cardData.id;     // 표시/디버그용 (식별에는 쓰지 않는다)
  pick.dataset.picked = '0';
  pick.onclick = () => togglePackPick(packIdx);
  slot.appendChild(pick);
  paintPickButton(pick);
  updatePickCount();          // 공개될 때마다 "선택한 N장" 표시를 맞춘다

  slot.style.transform = 'rotateY(0deg)';
}

// ── ☑️ 개봉 카드 선택 ────────────────────────────────────────
// 5장을 통째로 받거나 버리는 것 말고, **원하는 것만** 고를 수 있어야 한다.
const packPicked = new Set();

function paintPickButton(btn) {
  const on = btn.dataset.picked === '1';
  btn.className = `pack-pick-btn w-full px-2 py-1 rounded-lg text-[11px] font-black border transition ${
    on ? 'bg-emerald-600/90 border-emerald-400 text-white'
       : 'bg-[#191d33] border-slate-600 text-slate-400 hover:text-white'}`;
  btn.innerHTML = on ? '☑️ 보관함에 넣기' : '⬜ 선택 안 함';
}

/**
 * @param packIdx 개봉 순서(0~4). **카드 id가 아니다** —
 *   같은 카드가 두 장 나오면 id가 겹쳐 서로를 덮어썼다.
 */
export function togglePackPick(packIdx) {
  const btn = document.querySelector(`.pack-pick-btn[data-pack-idx="${Number(packIdx)}"]`);
  if (!btn || btn.disabled) return;
  const on = btn.dataset.picked !== '1';
  btn.dataset.picked = on ? '1' : '0';
  if (on) packPicked.add(Number(packIdx)); else packPicked.delete(Number(packIdx));
  paintPickButton(btn);
  updatePickCount();
}

/** 지금 선택된 카드들 (개봉 순서 기준 — 중복 카드도 각각 따로 센다) */
function pickedPackCards() {
  return openedPackCards.filter((_, i) => packPicked.has(i));
}

function updatePickCount() {
  const n = pickedPackCards().length;
  const el = document.getElementById('pack-pick-count');
  if (el) el.innerText = String(n);
  // 0장이면 누를 이유가 없다 — 눌러서 경고를 받는 것보다 비활성이 낫다
  ['btn-pack-save-picked', 'btn-pack-to-deck'].forEach(id => {
    const b = document.getElementById(id);
    if (!b || b.dataset.locked === '1') return;
    b.disabled = n === 0;
    b.classList.toggle('opacity-40', n === 0);
    b.classList.toggle('cursor-not-allowed', n === 0);
  });
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

/**
 * 개봉한 카드를 보관함에 넣는다.
 * @param onlyPicked true면 선택된 카드만, false면 5장 전부
 */
export async function savePackCardsToCollection(onlyPicked = false) {
  if (openedPackCards.length === 0) return;
  const targets = onlyPicked ? pickedPackCards() : openedPackCards;
  if (targets.length === 0) {
    alert('보관함에 넣을 카드를 하나 이상 선택하세요.');
    return;
  }

  // 🃏 acquireCard가 신규/중복/가루를 판단한다
  const result = { new: 0, copy: 0, dust: 0, dustGained: 0 };
  for (const card of targets) {
    const r = await acquireCard(card);
    if (r.kind === 'new') result.new++;
    else if (r.kind === 'copy') result.copy++;
    else { result.dust++; result.dustGained += r.dust; }
  }

  await saveCardsToStorage();
  // ⚜️ 팩에서 새 카드군이 생겼을 수 있다 — 연성소 선택기도 최신으로
  if (window._refreshCustomThemes) window._refreshCustomThemes();
  audio.playDraw();

  const parts = [`🎉 신규 ${result.new}장`];
  if (result.copy > 0) parts.push(`🔁 중복 +${result.copy}장 (덱 편성 매수 증가)`);
  if (result.dust > 0) parts.push(`💎 가루 +${result.dustGained} (상한 초과 ${result.dust}장)`);
  alert(`${parts.join('\n')}\n\n보관함: ${state.cardsCollection.length}종 / 보유 가루: ${getDust()}`);

  // 🐛 예전에는 pack-action-box를 통째로 숨겼다. 그 안에 "한 팩 더 개봉"이
  //    같이 들어 있어서, 저장만 해도 재개봉 버튼이 사라졌다.
  //    저장 여부와 재개봉은 무관하다 — 저장 버튼만 잠근다.
  lockPackSaveButtons('보관함에 저장됨');
  if (window._renderGrimoire) window._renderGrimoire();
}

export async function addPackCardsToActiveDeck() {
  if (openedPackCards.length === 0) return;
  // 덱 투입도 **선택된 카드만** 대상으로 한다 (선택이 없으면 전부)
  const targets = pickedPackCards();
  if (targets.length === 0) {
    alert('덱에 넣을 카드를 하나 이상 선택하세요.');
    return;
  }
  for (const card of targets) await acquireCard(card);

  let addedCount = 0;
  targets.forEach(c => {
    if (state.activeDeckCardIds.length < MAX_DECK_SIZE && !state.activeDeckCardIds.includes(c.id)) {
      state.activeDeckCardIds.push(c.id);
      addedCount++;
    }
  });

  await saveCardsToStorage();
  await saveActiveDeckToStorage();
  audio.playDraw();
  alert(`✨ ${addedCount}장이 출전 덱에 편성되었습니다. (선택한 ${targets.length}장은 보관함에도 저장됨)`);

  // 여기서도 재개봉 버튼은 남긴다
  lockPackSaveButtons('덱에 편성됨');
  if (window._renderGrimoire) window._renderGrimoire();
}

/**
 * 저장/덱투입 버튼만 잠근다. **"한 팩 더 개봉"은 건드리지 않는다.**
 * 보관 여부와 다음 팩을 여는 것은 별개의 결정이다.
 */
function lockPackSaveButtons(label) {
  ['btn-pack-save-picked', 'btn-pack-save-all', 'btn-pack-to-deck'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = true;
    // ⚠️ locked 표시가 없으면 updatePickCount가 다시 켜버린다
    b.dataset.locked = '1';
    b.classList.add('opacity-40', 'cursor-not-allowed');
  });
  const note = document.getElementById('pack-saved-note');
  if (note) {
    note.textContent = `✅ ${label}`;
    note.classList.remove('hidden');
  }
  // 선택 토글도 잠근다 — 이미 저장했는데 바꿀 수 있으면 혼란스럽다
  document.querySelectorAll('.pack-pick-btn').forEach(b => {
    b.disabled = true;
    b.classList.add('opacity-50', 'cursor-not-allowed');
  });
}

// ============================================================
// ============================================================
// 🎯 카드군 집중 팩 — 팩 카드 안의 셀렉트에서 카드군을 고른다
// ============================================================

let selectedPackArchetypeId = '';

/** 카드군 집중 팩 카드 안에 넣을 셀렉트 HTML */
function archetypePickerHtml() {
  const counts = {};
  (state.cardsCollection || []).forEach(c => {
    if (c.themeId) counts[c.themeId] = (counts[c.themeId] || 0) + 1;
  });
  const sorted = [...(state.archetypesList || [])]
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));

  const opts = [
    `<option value="">🌐 범용 전용 (카드군 없음)</option>`,
    ...sorted.map(a =>
      `<option value="${a.id}"${a.id === selectedPackArchetypeId ? ' selected' : ''}>${a.icon || '⚜️'} ${escapeHtml(a.name)}</option>`)
  ].join('');

  return `
    <select onchange="window._setPackArchetype(this.value)" onclick="event.stopPropagation()"
            class="w-full mt-2 bg-black/80 border border-cyan-500/60 text-cyan-200 text-[11px] font-bold rounded-lg px-2 py-1.5 outline-none cursor-pointer">
      ${opts}
    </select>`;
}

/** 셀렉트 변경 (전역 노출 — 인라인 핸들러에서 호출) */
export function setPackArchetype(id) {
  selectedPackArchetypeId = id || '';
}

/** 현재 팩 모드 */
export function getSelectedPackMode() {
  if (currentPackTheme !== 'archetype_focus') return { mode: 'random', theme: null };
  if (!selectedPackArchetypeId) return { mode: 'generic', theme: null };
  const theme = (state.archetypesList || []).find(a => a.id === selectedPackArchetypeId);
  return theme ? { mode: 'archetype', theme } : { mode: 'generic', theme: null };
}

/** 팩 종류에 맞는 LLM 지시문 */
export function packModeDirective(packMode) {
  if (packMode.mode === 'generic') {
    return `\n🌐 이 팩은 **범용 전용 팩**이다. 모든 카드를 범용으로 만들어라.
- "themeId": null, "themeName": null 로 둘 것.
- 특정 카드군에 얽매이지 않는 만능 도구 카드를 만들어라
  (드로우, 제거, 방어막, 마나 수급, 실드 관통 등).
- ❌ 카드군을 새로 만들지 말 것.\n`;
  }
  if (packMode.mode === 'archetype') {
    const t = packMode.theme;
    return `\n⚜️ 이 팩은 **[${t.name}] 카드군 전용 팩**이다.
- 카드의 약 70%는 반드시 이 카드군에 속하게 하라:
  "themeId": "${t.id}", "themeName": "${t.name}", "themeKeyword": "${t.keyword}"
- 나머지 30%는 **범용 카드**로 만들어라 ("themeId": null).
- ❌ 다른 카드군을 새로 만들지 말 것.
- 이 카드군의 속성은 ${(t.elements || [t.element]).join('/')} 이다. 소속 카드는 이 안에서 고를 것.
- 이 카드군의 연계는 "${t.comboAction}" 이다. 카드 효과가 이 연계와 어울리게 하라.

${playstyleGuide(t)}\n`;
  }
  return '';
}

/** 새 팩을 열 때 저장 버튼 잠금과 선택 상태를 되돌린다 */
function resetPackActionButtons() {
  ['btn-pack-save-picked', 'btn-pack-save-all', 'btn-pack-to-deck'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = false;
    delete b.dataset.locked;
    b.classList.remove('opacity-40', 'cursor-not-allowed');
  });
  const note = document.getElementById('pack-saved-note');
  if (note) note.classList.add('hidden');
  packPicked.clear();
  updatePickCount();   // 0장이므로 "선택 저장"/"덱 편성"은 여기서 비활성으로 떨어진다
}
