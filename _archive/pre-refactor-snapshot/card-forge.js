import { state, saveCardsToStorage, saveActiveDeckToStorage, optimizeCardImage, MAX_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { openSettingsModal } from './ui.js';
import { rollRandomRarity, RARITY_BALANCE_CAPS, sanitizeAndClampCardData } from './config.js';
import { callOllamaChat, generateNovelAIImage } from './ai-service.js';
import { expandDanbooruTags } from './dan-tag-gen.js';
import { findMatchingArchetype, registerNewArchetype, getArchetypesPromptSummary } from './archetype-service.js';

let currentLLMSkillData = null;
let currentForgeCardType = 'unit';
let currentCardTheme = null;

export function shuffleConceptInput() {
  const input = document.getElementById('llm-concept-input');
  if (input) {
    input.value = '';
    input.placeholder = '✨ 자유 창작 모드: 비워두고 [🎲 LLM 무작위 기획]을 누르면 LLM이 100% 자유롭게 창작합니다!';
    input.classList.add('bg-purple-950/50');
    setTimeout(() => input.classList.remove('bg-purple-950/50'), 300);
  }
}

export function cleanPromptTags(raw) {
  if (!raw) return '';
  let p = raw.trim();
  const egMatch = p.match(/\(e\.g\.?,?\s*([^)]+)\)/i);
  if (egMatch && egMatch[1]) {
    p = egMatch[1];
  }
  p = p.replace(/^(High quality English Danbooru tags|English Danbooru tags|Danbooru tags|Tags|Prompt|Visual tags)[^:]*:\s*/i, '');
  p = p.replace(/^High quality [^,]+,\s*/i, '');
  p = p.replace(/^e\.g\.?,?\s*/i, '');
  p = p.replace(/^Danbooru tags for [^,]+,\s*/i, '');
  p = p.replace(/[\(\)]/g, '');
  p = p.replace(/_/g, ' '); // ⚡ NovelAI 규격: 언더스코어를 스페이스로 변환
  p = p.replace(/^[^a-zA-Z0-9 ]+/g, '').replace(/^[, ]+/, '').trim();
  return p;
}

export function setForgeType(type) {
  currentForgeCardType = type;
  const hiddenInput = document.getElementById('forge-card-type');
  if (hiddenInput) hiddenInput.value = type;
  updateForgePromptPreview();
}

export async function generatePromptWithLLM(isRandom = false) {
  const conceptInput = document.getElementById('llm-concept-input');
  let concept = conceptInput ? conceptInput.value.trim() : '';
  if (isRandom) concept = '';

  const loadingEl = document.getElementById('llm-loading');
  const btnEl = document.getElementById('btn-llm-write');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (btnEl) btnEl.disabled = true;

  const targetType = currentForgeCardType || 'unit';
  const knownThemes = getArchetypesPromptSummary();

  const userDirective = concept
    ? `Design a unique fantasy TCG card based on this user Concept: "${concept}".`
    : `Freely brainstorm and invent a 100% original, creative fantasy TCG card of type "${targetType}" from your boundless imagination! You have complete creative freedom over the lore, character, archetype, origin, powers, and style. Surprise the player with a fresh, captivating, authentic TCG concept.`;

  const nonceId = `session-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const systemPrompt = `You are a creative, imaginative Anime TCG Card Designer (inspired by Yu-Gi-Oh!, Hearthstone, Shadowverse, Magic: The Gathering).
Design an authentic, natural, original fantasy TCG card of type: "${targetType}".

CRITICAL CARD NAMING & 100% CREATIVE FREEDOM:
- You have 100% creative freedom to invent any character, beast, magic, relic, lore, or concept you desire.
- Invent a concise, authentic Korean card name (strictly 2 to 4 Korean words, MAXIMUM 12 Korean characters).
  * ❌ NEVER output long rambling descriptive sentences or fixed slot templates.
  * ✅ Use clean, authentic TCG names with original proper nouns or evocative titles (e.g. "달그림자 암살자 카엘", "황혼의 대마도사", "뇌제 발키리", "시간 왜곡의 비전", "아포칼립스").
- The English "title" should be a clean, stylish localization of the Korean name.

CRITICAL NUMERICAL RULES & STAT CAPS (스펙 인플레 방지 및 고정 정수 원칙):
1. NEVER use percentage (%) values in descriptions, stats, or skill effects. All values MUST be exact fixed integers.
   - ❌ WRONG: "공격력이 20% 증가", "체력 30% 회복", "피해량 50% 증폭"
   - ✅ CORRECT: "공격력 +2 증가", "체력 10 회복", "16의 화염 피해"
2. Strict integer stat & damage ranges by rarity:
   - common: cost 1-2, attack 6-10, defense 2-6, hp 14-22, damage 8-12, shield 6-10, heal 6-10, buff +1~2
   - rare: cost 2-3, attack 10-15, defense 4-8, hp 20-28, damage 12-18, shield 10-16, heal 10-16, buff +2~3
   - epic: cost 3-4, attack 14-20, defense 6-12, hp 26-34, damage 16-24, shield 14-20, heal 14-22, buff +3~4
   - legendary: cost 3-5, attack 18-26, defense 8-14, hp 30-40, damage 20-28, shield 18-26, heal 18-26, buff +4~5

TCG ARCHETYPE DECK COMBO (유희왕/TCG식 상호 연계 테마 덱):
Cards belong to a Theme Archetype (카드군) and trigger interlocking combos when played or when theme allies exist!
Existing Archetypes list:
${knownThemes}

TCG Archetype Combo Design Philosophy:
- Design skills that interact with the theme:
  * Deck Search: "소환 시: 내 덱에서 다른 [테마명] 카드 1장을 찾아 패로 서치"
  * Chain Strike: "필드에 다른 [테마명]이 있을 때: 보스에게 8 연계 피해 및 화상 부여"
  * Resonance / Charge: "발동 시: 마나 +1 충전 & 필드의 [테마명] 수만큼 방어막 전개"
  * Special Summon: "발동 시: 체력 12 회복 & [테마명] 정령을 전장에 무료 특수 소환"
- DO NOT use simple generic stat addition (+2 attack autochess style). Design true TCG combo mechanics!

OUTPUT SCHEMA (Return ONLY valid raw JSON):
{
  "name": "컨셉을 살린 독창적이고 자연스러운 한국어 카드명",
  "title": "Clean English Title",
  "cardType": "${targetType}",
  "element": "fire|water|lightning|holy|dark|nature",
  "themeName": "카드군 테마명 (기존 카드군 또는 신규 카드군)",
  "themeKeyword": "테마 핵심 키워드",
  "themeSynergyDesc": "카드군 테마 상호 연계 효과 설명",
  "rarity": "common|rare|epic|legendary",
  "cost": 1-4,
  "attack": 6-24,
  "defense": 2-14,
  "hp": 14-38,
  "visualPrompt": "pure comma-separated English Danbooru tags (e.g. 1girl, silver_hair, blue_eyes, white_armor, holding_sword, glowing_particles, dramatic_lighting). NEVER write conversational natural language sentences.",
  "skill": {
    "name": "컨셉에 맞춘 독창적인 스킬명",
    "description": "생생한 한국어 효과 설명 (절대 % 사용 금지, 정수 수치만 사용)",
    "cost": 1-3,
    "damage": 0-22,
    "shield": 0-16,
    "heal": 0-16,
    "multiHit": 1,
    "drawCards": 0-2,
    "statusEffect": {
      "type": "none|stun|freeze|burn|shock|poison|vulnerable",
      "duration": 1-2,
      "value": 0-8
    }
  }
}`;

  const reasoningSelect = document.getElementById('forge-reasoning-mode');
  const currentReasoningMode = reasoningSelect ? reasoningSelect.value : (state.settings.reasoningMode || 'fast');

  try {
    const cardData = await callOllamaChat({
      messages: [
        { role: 'system', content: 'You are an authentic TCG card designer. Output ONLY a single valid raw JSON object.' },
        { role: 'user', content: `${userDirective}\nRandom Seed Nonce: ${nonceId}\n${systemPrompt}` }
      ],
      timeoutMs: 300000, // 5분 타임아웃
      reasoningMode: currentReasoningMode
    });

    applyGeneratedCardData(cardData);
  } catch (err) {
    console.warn('LLM 생성 실패 또는 타임아웃, 스마트 규칙 기반 생성기로 대체합니다:', err.message);
    generatePromptSmartRandom(concept);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (btnEl) btnEl.disabled = false;
  }
}

export function generatePromptSmartRandom(concept) {
  const elements = ['fire', 'water', 'lightning', 'holy', 'dark', 'nature'];
  const cardType = currentForgeCardType || 'unit';

  let matchedElement = elements[Math.floor(Math.random() * elements.length)];
  if (concept && (concept.includes('불') || concept.includes('화염') || concept.includes('홍련') || concept.includes('메테오'))) matchedElement = 'fire';
  else if (concept && (concept.includes('물') || concept.includes('빙결') || concept.includes('서리'))) matchedElement = 'water';
  else if (concept && (concept.includes('번개') || concept.includes('벼락') || concept.includes('뇌제'))) matchedElement = 'lightning';
  else if (concept && (concept.includes('빛') || concept.includes('성검') || concept.includes('천상') || concept.includes('신성'))) matchedElement = 'holy';
  else if (concept && (concept.includes('어둠') || concept.includes('암흑') || concept.includes('심연') || concept.includes('그림자'))) matchedElement = 'dark';
  else if (concept && (concept.includes('숲') || concept.includes('자연') || concept.includes('엘프'))) matchedElement = 'nature';

  // 🎲 TCG 확률 테이블에 의한 등급 추첨 (Common 60%, Rare 25%, Epic 12%, Legendary 3%)
  const rarity = rollRandomRarity();
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;

  const cost = caps.costRange[0] + Math.floor(Math.random() * (caps.costRange[1] - caps.costRange[0] + 1));
  const atk = caps.atkRange[0] + Math.floor(Math.random() * (caps.atkRange[1] - caps.atkRange[0] + 1));
  const def = caps.defRange[0] + Math.floor(Math.random() * (caps.defRange[1] - caps.defRange[0] + 1));
  const hp = caps.hpRange[0] + Math.floor(Math.random() * (caps.hpRange[1] - caps.hpRange[0] + 1));
  const spellDmg = caps.spellDamage[0] + Math.floor(Math.random() * (caps.spellDamage[1] - caps.spellDamage[0] + 1));

  const prefixes = {
    fire: ['홍련의', '폭염의', '겁염의', '작열의', '멸악의'],
    water: ['빙결의', '서리바람의', '심해의', '은빛 조수의', '극광의'],
    lightning: ['뇌제의', '섬광의', '벽력의', '질풍의', '천벌의'],
    holy: ['성역의', '찬란한', '아이기스의', '영광의', '수호의'],
    dark: ['심연의', '칠흑의', '그림자의', '파멸의', '영혼의'],
    nature: ['세계수의', '비취빛', '에메랄드의', '숲의 수호', '대지의']
  };
  const unitRoles = ['검성', '대마도사', '수호기사', '발키리', '암살자', '현자', '기사단장', '드루이드', '성기사', '정령술사'];
  const heroNames = ['아스카', '루시아', '세라피나', '발터', '브륀힐트', '실비아', '레이븐', '벨리알', '프레야', '카엘', '아그니에', '엘리시아'];

  const pList = prefixes[matchedElement] || prefixes.fire;
  const rndPrefix = pList[Math.floor(Math.random() * pList.length)];
  const rndRole = unitRoles[Math.floor(Math.random() * unitRoles.length)];
  const rndHero = heroNames[Math.floor(Math.random() * heroNames.length)];

  if (cardType === 'spell') {
    const spellNames = {
      fire: ['종말의 화염 폭격', '겁염의 메테오 스트라이크', '인페르노 익스플로전'],
      water: ['절대영도 블리자드', '다이아몬드 더스트', '빙하의 격류'],
      lightning: ['천벌의 뇌격폭풍', '기간틱 볼텍스', '심판의 벼락'],
      holy: ['아이기스의 무적 결계', '성스러운 천상의 가호', '홀리 생츄어리'],
      dark: ['심연의 영혼 흡수', '블랙홀 디바우러', '파멸의 암흑 참격'],
      nature: ['세계수의 생명 재생', '원초의 대자연 정화', '맹독 가시 덩굴']
    };
    const sList = spellNames[matchedElement] || spellNames.fire;
    const name = sList[Math.floor(Math.random() * sList.length)];
    applyGeneratedCardData({
      name: name,
      title: `${matchedElement.toUpperCase()} Arcane Burst`,
      cardType: 'spell',
      element: matchedElement,
      rarity: rarity,
      cost: cost,
      attack: 0,
      defense: 0,
      hp: 0,
      visualPrompt: 'glowing magic circle, arcane spell runes, elemental magical explosion, cinematic lighting, masterpiece illustration',
      skill: {
        name: `${name}`,
        description: `[즉발 주문] 적 전원에 ${spellDmg}의 ${matchedElement} 피해를 입히고 추가 효과를 부여합니다.`,
        cost: cost,
        damage: spellDmg,
        isAoeSpell: rarity === 'legendary' || rarity === 'epic',
        statusEffect: { type: matchedElement === 'fire' ? 'burn' : (matchedElement === 'water' ? 'freeze' : 'none'), duration: 2, value: 8 }
      }
    });
  } else if (cardType === 'structure') {
    const structNames = {
      fire: '지옥불 화염 첨탑',
      water: '영구동토의 얼음 요새',
      lightning: '피뢰의 번개 성탑',
      holy: '성스러운 빛의 대성당',
      dark: '심연의 마왕 석상',
      nature: '세계수의 고대 성소'
    };
    const name = structNames[matchedElement] || '마력 수호의 첨탑';
    applyGeneratedCardData({
      name: name,
      title: `Sanctuary of ${matchedElement.toUpperCase()}`,
      cardType: 'structure',
      element: matchedElement,
      rarity: rarity,
      cost: cost,
      attack: 0,
      defense: Math.floor(def * 1.3),
      hp: Math.floor(hp * 1.3),
      visualPrompt: 'crystal ancient tower sanctuary, glowing runes, floating magical stones, majestic fantasy fortress, masterpiece',
      skill: {
        name: `${name} 공명`,
        description: `[건축물 패시브] 매 턴 시작 시 마나 +1 공급 & 턴 종료 시 아군에 방어막 +${caps.shieldValue[0]} 부여.`,
        cost: cost,
        taunt: rarity === 'legendary' || rarity === 'epic',
        passiveEffect: { manaPerTurn: 1, endTurnShield: caps.shieldValue[0] }
      }
    });
  } else {
    const name = `${rndPrefix} ${rndRole} ${rndHero}`;
    applyGeneratedCardData({
      name: name,
      title: `${rndHero}, ${rndRole} of ${matchedElement}`,
      cardType: 'unit',
      element: matchedElement,
      rarity: rarity,
      cost: cost,
      attack: atk,
      defense: def,
      hp: hp,
      visualPrompt: '1girl or 1boy, masterpiece, best quality, detailed fantasy armor, glowing weapon, dynamic combat stance, anime art',
      skill: {
        name: `${rndRole}의 비기: ${rndPrefix} 일격`,
        description: `${matchedElement}의 마력을 실어 적에게 ${atk}의 강력한 타격을 가합니다.`,
        cost: cost,
        damage: atk,
        multiHit: rarity === 'legendary' ? 2 : 1,
        statusEffect: { type: matchedElement === 'fire' ? 'burn' : (matchedElement === 'water' ? 'freeze' : 'none'), duration: 2, value: 8 }
      }
    });
  }
}

export async function applyGeneratedCardData(rawData) {
  const data = sanitizeAndClampCardData(rawData);
  if (data.name) document.getElementById('forge-name').value = data.name;
  if (data.title) {
    const titleEl = document.getElementById('forge-title');
    if (titleEl) titleEl.value = data.title;
  }
  if (data.element) document.getElementById('forge-element').value = data.element;
  if (data.rarity) document.getElementById('forge-rarity').value = data.rarity;
  if (data.cardType) {
    currentForgeCardType = data.cardType;
    const radios = document.getElementsByName('forge-card-type-radio');
    radios.forEach(r => {
      if (r.value === data.cardType) r.checked = true;
    });
    const hidden = document.getElementById('forge-card-type');
    if (hidden) hidden.value = data.cardType;
  }

  const promptInput = document.getElementById('forge-prompt');
  const targetElem = data.element || (document.getElementById('forge-element') ? document.getElementById('forge-element').value : 'fire');
  const targetType = data.cardType || currentForgeCardType || 'unit';

  // 🚀 DanTagGen 자동 파이프라인 연동: LLM 응답 프롬프트를 DanTagGen으로 자동 정제 & 확장!
  if (data.visualPrompt) {
    const cleaned = cleanPromptTags(data.visualPrompt);
    const expandedDanbooru = expandDanbooruTags(cleaned, targetElem, targetType, 28);
    promptInput.value = expandedDanbooru;
  } else {
    const defaultExpanded = expandDanbooruTags(data.name || 'fantasy hero', targetElem, targetType, 28);
    promptInput.value = defaultExpanded;
  }

  // 유연한 스킬 데이터 추출 및 정제 (정수화 완료)
  let parsedSkill = data.skill || (Array.isArray(data.skills) ? data.skills[0] : null) || data.ability || null;
  if (!parsedSkill && (data.skillName || data.skillDesc || data.abilityName || data.damage || data.shield)) {
    parsedSkill = {
      name: data.skillName || data.abilityName || `${data.name || '영웅'}의 일격`,
      description: data.skillDesc || data.description || `${data.damage || 15} 피해를 입힙니다.`,
      cost: data.cost || 2,
      damage: data.damage || 0,
      shield: data.shield || 0,
      heal: data.heal || 0,
      multiHit: data.multiHit || 1,
      drawCards: data.drawCards || 0,
      statusEffect: data.statusEffect || { type: 'none', duration: 0, value: 0 }
    };
  }

  if (parsedSkill) {
    if (typeof parsedSkill.multiHit === 'number') {
      parsedSkill.multiHit = Math.min(3, Math.max(1, Math.round(parsedSkill.multiHit)));
    }
    if (parsedSkill.description) {
      parsedSkill.description = parsedSkill.description.replace(/(\d+단[,\s]*){3,}/g, '').trim();
    }
  }

  // 테마/카드군 매칭 또는 신규 테마 자동 등록 및 DB 누적
  let matchedTheme = null;
  if (data.themeName) {
    matchedTheme = await registerNewArchetype({
      name: data.themeName,
      keyword: data.themeKeyword,
      element: targetElem,
      comboAction: data.themeComboAction || data.comboAction,
      themeComboDesc: data.themeSynergyDesc || data.themeComboDesc,
      synergy: { desc: data.themeSynergyDesc || data.themeComboDesc || `[${data.themeName}] 테마 카드 상호 연계` }
    });
  } else {
    matchedTheme = findMatchingArchetype(data.name || '', targetElem);
  }
  currentCardTheme = matchedTheme;

  currentLLMSkillData = parsedSkill || null;
  updateForgePromptPreview();
}

export function addTag(tag) {
  const promptInput = document.getElementById('forge-prompt');
  const cur = promptInput.value.trim();
  if (cur.includes(tag)) return;
  promptInput.value = cur ? `${cur}, ${tag}` : tag;
  updateForgePromptPreview();
}

export function clearForgePrompt() {
  document.getElementById('forge-prompt').value = '';
  updateForgePromptPreview();
}

export function expandCurrentPromptWithDanTagGen() {
  const promptInput = document.getElementById('forge-prompt');
  const elementSelect = document.getElementById('forge-element');
  const element = elementSelect ? elementSelect.value : 'fire';
  const cardType = currentForgeCardType || 'unit';
  
  const currentPrompt = promptInput.value.trim();
  const expanded = expandDanbooruTags(currentPrompt || '1girl, fantasy anime', element, cardType, 28);
  promptInput.value = expanded;
  updateForgePromptPreview();
  audio.playMagic();
}

export function updateForgePromptPreview() {
  const element = document.getElementById('forge-element') ? document.getElementById('forge-element').value : 'fire';
  const rarity = document.getElementById('forge-rarity') ? document.getElementById('forge-rarity').value : 'common';
  const name = document.getElementById('forge-name') ? (document.getElementById('forge-name').value.trim() || '이름 없는 영웅') : '이름 없는 영웅';
  const prompt = document.getElementById('forge-prompt') ? (document.getElementById('forge-prompt').value.trim() || 'masterpiece, fantasy') : 'masterpiece, fantasy';
  const cardType = currentForgeCardType || 'unit';

  const mockCard = {
    id: 'preview',
    cardType: cardType,
    name: name,
    element: element,
    rarity: rarity,
    cost: cardType === 'spell' ? 2 : (rarity === 'legendary' ? 4 : (rarity === 'epic' ? 3 : 2)),
    attack: cardType === 'spell' || cardType === 'structure' ? 0 : (rarity === 'legendary' ? 28 : (rarity === 'epic' ? 20 : 14)),
    defense: cardType === 'spell' ? 0 : (rarity === 'legendary' ? 12 : 8),
    hp: cardType === 'spell' ? 0 : (cardType === 'structure' ? 45 : (rarity === 'legendary' ? 40 : 30)),
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    skills: [currentLLMSkillData || { name: `${name} 효과`, description: '효과를 발동합니다.' }]
  };

  const previewBox = document.getElementById('forge-preview-card');
  if (previewBox) {
    previewBox.innerHTML = '';
    previewBox.appendChild(createCardElement(mockCard, null, false));
  }
  if (window.lucide) window.lucide.createIcons();
}

export async function generateAICard() {
  if (!state.settings.apiKey) {
    alert('NovelAI API Key가 설정되지 않았습니다. [설정] 버튼을 눌러 API Key를 입력해주세요.');
    openSettingsModal();
    return;
  }

  const name = document.getElementById('forge-name').value.trim() || '환상의 정령사';
  const element = document.getElementById('forge-element').value;
  const rarity = document.getElementById('forge-rarity').value;
  const userPrompt = document.getElementById('forge-prompt').value.trim() || 'fantasy elemental hero';
  const cardType = currentForgeCardType || 'unit';

  const loadingEl = document.getElementById('ai-loading');
  const btnEl = document.getElementById('btn-generate');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (btnEl) btnEl.disabled = true;

  try {
    let promptToSend = `${userPrompt}, face focus, centered composition`;
    if (cardType === 'unit') {
      promptToSend = `solo, ${promptToSend}`;
    }

    const imageUrl = await generateNovelAIImage({
      prompt: promptToSend,
      resolution: state.settings.resolution || 'portrait-small'
    });

    await completeForgedCard(name, element, rarity, userPrompt, imageUrl);
  } catch (err) {
    alert(`카드 이미지 생성 안내: ${err.message}\n(기본 큐레이티드 아트로 안전하게 카드를 완성합니다)`);
    const mockImages = {
      fire: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
      water: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
      lightning: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
      holy: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
      dark: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
      nature: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80'
    };
    await completeForgedCard(name, element, rarity, userPrompt, mockImages[element] || mockImages.fire);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (btnEl) btnEl.disabled = false;
  }
}

export async function generateMockCard() {
  const name = document.getElementById('forge-name').value.trim() || '환상의 정령사';
  const element = document.getElementById('forge-element').value;
  const rarity = document.getElementById('forge-rarity').value;
  const prompt = document.getElementById('forge-prompt').value.trim() || 'fantasy elemental hero';

  const mockImages = {
    fire: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    water: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    lightning: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    holy: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    dark: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
    nature: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80'
  };

  await completeForgedCard(name, element, rarity, prompt, mockImages[element] || mockImages.fire);
}

export async function completeForgedCard(name, element, rarity, prompt, imageUrl) {
  const cardType = currentForgeCardType || 'unit';
  const caps = RARITY_BALANCE_CAPS[rarity] || RARITY_BALANCE_CAPS.common;

  const cost = caps.costRange[0] + Math.floor(Math.random() * (caps.costRange[1] - caps.costRange[0] + 1));
  let atk = caps.atkRange[0] + Math.floor(Math.random() * (caps.atkRange[1] - caps.atkRange[0] + 1));
  let def = caps.defRange[0] + Math.floor(Math.random() * (caps.defRange[1] - caps.defRange[0] + 1));
  let hp = caps.hpRange[0] + Math.floor(Math.random() * (caps.hpRange[1] - caps.hpRange[0] + 1));
  const spellDmg = caps.spellDamage[0] + Math.floor(Math.random() * (caps.spellDamage[1] - caps.spellDamage[0] + 1));

  if (cardType === 'spell') {
    atk = 0;
    def = 0;
    hp = 0;
  } else if (cardType === 'structure') {
    atk = 0;
    def = Math.floor(def * 1.3);
    hp = Math.floor(hp * 1.3);
  }

  const optimizedImg = await optimizeCardImage(imageUrl);

  const skillObj = currentLLMSkillData ? {
    name: currentLLMSkillData.name || `${name}의 비기`,
    description: currentLLMSkillData.description || `${name}의 효과를 발동합니다.`,
    cost: cost,
    value: cardType === 'spell' ? spellDmg : atk,
    damage: cardType === 'spell' ? spellDmg : atk,
    effectType: element === 'holy' ? 'shield' : 'damage',
    ...currentLLMSkillData
  } : {
    name: `${name}의 비기`,
    description: `${name}의 효과를 발동합니다.`,
    cost: cost,
    value: cardType === 'spell' ? spellDmg : atk,
    damage: cardType === 'spell' ? spellDmg : atk,
    effectType: element === 'holy' ? 'shield' : 'damage'
  };

  const finalTheme = currentCardTheme || findMatchingArchetype(name, element);

  const rawCard = {
    id: `custom-${Date.now()}`,
    cardType: cardType,
    name: name,
    title: `${rarity.toUpperCase()} ${cardType.toUpperCase()}`,
    element: element,
    themeId: finalTheme ? finalTheme.id : null,
    themeName: finalTheme ? finalTheme.name : null,
    isGeneric: !finalTheme,
    rarity: rarity,
    cost: cost,
    attack: atk,
    defense: def,
    hp: hp,
    imageUrl: optimizedImg,
    prompt: prompt,
    crop: { scale: 1.0, x: 50, y: 35 },
    skill: skillObj,
    skills: [skillObj]
  };

  const newCard = sanitizeAndClampCardData(rawCard);
  if (newCard.skill) {
    newCard.skills = [newCard.skill];
  }

  state.cardsCollection.unshift(newCard);
  if (state.activeDeckCardIds.length < MAX_DECK_SIZE) {
    state.activeDeckCardIds.push(newCard.id);
    await saveActiveDeckToStorage();
  }
  await saveCardsToStorage();

  const container = document.getElementById('forge-preview-card');
  if (container) {
    container.innerHTML = '';
    container.appendChild(createCardElement(newCard, null, false));
  }
  if (window.lucide) window.lucide.createIcons();

  const successBox = document.getElementById('forge-success-box');
  if (successBox) successBox.classList.remove('hidden');
  if (window.confetti) confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 } });
}
