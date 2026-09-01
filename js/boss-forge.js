// boss-forge.js - AI 보스 연성소 & 전술 아키타입별 스마트 패턴 기획

import { state, dbLoad, dbSave, STORAGE_KEY_BOSSES, optimizeCardImage } from './storage.js';
import { BOSS_DATA, ELEMENT_BOSS_MINIONS, BOSS_ADD_POOL } from './data.js';
import { ELEMENT_CONFIG } from './config.js';
import { audio } from './audio.js';
import { addBattleLog, initBattle } from './battle-engine.js';
import { switchTab } from './ui.js';
import { callOllamaChat, generateNovelAIImage } from './ai-service.js';
import { expandDanbooruTags } from './dan-tag-gen.js';

let generatedBossPreviewData = null;

// 👑 보스 전술 성향 (Tactical Archetypes)
export const BOSS_ARCHETYPES = {
  juggernaut: {
    id: 'juggernaut',
    name: '압도적 거수형 (Raid Boss)',
    badge: 'bg-red-950 text-red-300 border-red-500',
    icon: '👑',
    desc: '압도적인 초고체력과 방어벽, 턴을 모아 발동하는 전멸급 일격필살 차징',
    hpRange: [240, 360],
    shield: 35
  },
  tactician: {
    id: 'tactician',
    name: '트릭키 전술가 (Trickster & Summoner)',
    badge: 'bg-purple-950 text-purple-300 border-purple-500',
    icon: '🃏',
    desc: '낮은 자체 스펙 대신 매 턴 특수 부하 소환, 마나 강탈, 손패 파기, 결빙 & 맹독 상태이상 폭탄',
    hpRange: [120, 170],
    shield: 15
  },
  berserker: {
    id: 'berserker',
    name: '광전사 / 속공 암살자 (Berserker)',
    badge: 'bg-orange-950 text-orange-300 border-orange-500',
    icon: '⚡',
    desc: '매 턴 2~3연타 폭풍 공격, 가한 피해의 50% 흡혈, 실드 무시 직격 및 35% 이하 처형',
    hpRange: [160, 220],
    shield: 10
  },
  archmage: {
    id: 'archmage',
    name: '원소 대마도사 (Archmage)',
    badge: 'bg-cyan-950 text-cyan-300 border-cyan-500',
    icon: '🔮',
    desc: '전장 전체를 뒤흔드는 속성 광역 폭격, 마나 봉쇄, 실드 강제 분쇄 및 감전 폭풍',
    hpRange: [150, 210],
    shield: 25
  },
  fortress: {
    id: 'fortress',
    name: '불멸의 요새 (Immortal Fortress)',
    badge: 'bg-emerald-950 text-emerald-300 border-emerald-500',
    icon: '🛡️',
    desc: '받은 피해의 35%를 반사하는 가시 결계, 지속적인 체력 자가 치유 및 수호 오벨리스크',
    hpRange: [190, 280],
    shield: 30
  }
};

export async function loadBosses() {
  try {
    const idbBosses = await dbLoad(STORAGE_KEY_BOSSES);
    if (idbBosses && Array.isArray(idbBosses) && idbBosses.length > 0) {
      state.bossesList = idbBosses.map(b => {
        const defaultBoss = BOSS_DATA.find(db => db.id === b.id);
        if (defaultBoss) {
          return { ...defaultBoss, ...b, comboPatterns: defaultBoss.comboPatterns || b.comboPatterns };
        }
        return b;
      });
      BOSS_DATA.forEach(db => {
        if (!state.bossesList.some(b => b.id === db.id)) {
          state.bossesList.push(db);
        }
      });
      await dbSave(STORAGE_KEY_BOSSES, state.bossesList);
    } else {
      const stored = localStorage.getItem(STORAGE_KEY_BOSSES);
      state.bossesList = stored ? JSON.parse(stored) : [...BOSS_DATA];
      await dbSave(STORAGE_KEY_BOSSES, state.bossesList);
    }
  } catch (e) {
    state.bossesList = [...BOSS_DATA];
  }
  renderBossDropdown();
}

export async function saveBossesToStorage() {
  await dbSave(STORAGE_KEY_BOSSES, state.bossesList);
  try {
    localStorage.setItem(STORAGE_KEY_BOSSES, JSON.stringify(state.bossesList));
  } catch (e) {
    console.warn('localStorage 용량 초과: IndexedDB로 보스 데이터 영구 저장 완료.');
  }
  renderBossDropdown();
}

export function renderBossDropdown() {
  const select = document.getElementById('boss-select');
  if (!select) return;
  select.innerHTML = '';
  state.bossesList.forEach((boss, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    const elIcon = ELEMENT_CONFIG[boss.element] ? ELEMENT_CONFIG[boss.element].icon : '🔥';
    const arcIcon = (boss.archetype && BOSS_ARCHETYPES[boss.archetype]) ? BOSS_ARCHETYPES[boss.archetype].icon : '⚔️';
    opt.innerText = `${elIcon} [${idx + 1}단계 ${arcIcon}] ${boss.name} (${boss.maxHp} HP)`;
    if (idx === state.currentBossIdx) opt.selected = true;
    select.appendChild(opt);
  });
}

export function openBossForgeModal() {
  refreshBossThemeOptions();
  const previewBox = document.getElementById('boss-preview-box');
  const modal = document.getElementById('boss-forge-modal');
  if (previewBox) previewBox.classList.add('hidden');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

export function closeBossForgeModal() {
  const modal = document.getElementById('boss-forge-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// 🧠 전술 아키타입 및 속성 기반 스마트 보스 패턴 생성기
export function generateSmartBossPatterns(concept = '', element = 'fire', archetype = 'juggernaut') {
  const el = element || 'fire';
  const elName = ELEMENT_CONFIG[el] ? ELEMENT_CONFIG[el].name : '화염';

  // 1. 👑 압도적 거수형 (Raid Boss)
  if (archetype === 'juggernaut') {
    return [
      {
        name: `파멸의 거수 ${elName} 연격`,
        desc: '전투 부하 집결 ➔ 육중한 거구 방어벽 ➔ 분쇄의 지진 강타',
        steps: [
          { type: 'summon_or_buff', name: '거수 호위병 소환/강화', value: 1, icon: '👾' },
          { type: 'shield', name: '거수의 철갑 외골격', value: 35, text: '35 대형 실드 전개', icon: '🛡️' },
          { type: 'attack', name: '대지 분쇄 강타', value: 28, text: '28 육중한 물리 타격', icon: '🔨' }
        ]
      },
      {
        name: `종말의 ${elName} 일격필살 차징`,
        desc: '차징 선언 ➔ 전장 전체 파멸급 광역 폭발',
        steps: [
          { type: 'shield', name: '차징 집속 장벽', value: 25, text: '25 집속 실드', icon: '🛡️' },
          { type: 'magic', name: `기간틱 ${elName} 아포칼립스`, value: 45, isAoe: true, text: '45 전멸급 광역 대폭발!', icon: '💥', dialogue: '하찮은 벌레들아, 거수의 발아래 짓밟혀라!' }
        ]
      }
    ];
  }

  // 2. 🃏 트릭키 전술가 (Trickster / Summoner)
  if (archetype === 'tactician') {
    return [
      {
        name: `사악한 교란 & 패 파기 술책`,
        desc: '도발 부하 소환 ➔ 플레이어 손패 1장 파기 ➔ 마나 2 강탈',
        steps: [
          { type: 'summon_or_buff', name: '심연의 도발병 소환', value: 1, icon: '💀' },
          { type: 'disrupt', name: '사악한 패 파기', discardCard: true, text: '플레이어 손패 1장 강제 파기!', icon: '🃏' },
          { type: 'disrupt', name: '마나 흡수 주술', manaBurn: 2, text: '플레이어 마나 -2 강탈', icon: '🌀' }
        ]
      },
      {
        name: `상태이상 연쇄 & 영혼 흡수`,
        desc: '전방 유닛 동결/기절 ➔ 치명적 맹독 ➔ 생명력 100% 흡혈',
        steps: [
          { type: 'debuff', name: '빙하의 서리 결빙', status: { type: 'freeze', duration: 1, value: 0 }, text: '아군 전방 유닛 1턴 동결', icon: '❄️' },
          { type: 'debuff', name: '부식성 맹독 포자', status: { type: 'poison', duration: 3, value: 10 }, text: '플레이어 맹독 중독', icon: '☣️' },
          { type: 'magic', name: '영혼 강탈', value: 16, lifestealPercent: 1.0, text: '16 피해 & 체력 16 전액 흡혈!', icon: '🩸', dialogue: '큭큭... 네 패와 마나는 이제 내 손안에 있다!' }
        ]
      }
    ];
  }

  // 3. ⚡ 광전사 / 속공 암살자 (Berserker)
  if (archetype === 'berserker') {
    return [
      {
        name: `질풍노도의 3연속 폭풍참`,
        desc: '3회 연속 타격 ➔ 가한 피해의 50% 흡혈',
        steps: [
          { type: 'attack', name: '광란의 3연격', value: 24, multiHit: 3, lifestealPercent: 0.5, text: '총 24 피해(3연타) & 50% 흡혈', icon: '🗡️' },
          { type: 'debuff', name: '선혈의 취약 표식', status: { type: 'vulnerable', duration: 2, value: 0 }, text: '받는 피해 +50% 취약 부여', icon: '🩸' }
        ]
      },
      {
        name: `방어 무시 & 처형 일격`,
        desc: '실드 완전 무시 직격 ➔ 플레이어 체력 35% 이하 시 2.2배 즉결 처형',
        steps: [
          { type: 'attack', name: '심장 관통참', value: 18, pierceShield: true, text: '18 실드 무시 직접 타격!', icon: '🎯' },
          { type: 'attack', name: '선혈의 단두대 (처형)', value: 20, executeThreshold: 0.35, text: '체력 위기 시 44 처형 피해!', icon: '💀', dialogue: '피의 갈증을 멈출 수 없다! 네 심장을 바쳐라!' }
        ]
      }
    ];
  }

  // 4. 🔮 원소 대마도사 (Archmage)
  if (archetype === 'archmage') {
    return [
      {
        name: `방어막 분쇄 & 감전 방전`,
        desc: '플레이어 실드 강제 전면 파괴 ➔ 감전 부여 & 마나 방전',
        steps: [
          { type: 'disrupt', name: '비전 실드 분쇄 파동', breakShield: true, text: '아군 방어막 즉시 0으로 소멸', icon: '💔' },
          { type: 'debuff', name: '과충전 감전 폭풍', status: { type: 'shock', duration: 2, value: 8 }, text: '감전 및 마나 -1 방전', icon: '⚡' },
          { type: 'magic', name: '비전 마력탄', value: 22, text: '22 원소 마법 피해', icon: '✨' }
        ]
      },
      {
        name: `궁극의 원소 대격변`,
        desc: '마력 방어막 ➔ 전장 전체 광역 초토화 폭격',
        steps: [
          { type: 'shield', name: '프리즈매틱 배리어', value: 28, text: '28 원소 실드 전개', icon: '🛡️' },
          { type: 'magic', name: `궁극의 ${elName} 카타클리즘`, value: 34, isAoe: true, text: '34 전장 광역 대격변 폭격!', icon: '💥', dialogue: '원소의 진정한 파멸을 목도하라!' }
        ]
      }
    ];
  }

  // 5. 🛡️ 불멸의 요새 (Immortal Fortress)
  return [
    {
      name: '가시 반사 결계 & 대지의 치유',
      desc: '피해 35% 반사 결계 전개 ➔ 체력 +20 자가 치유',
      steps: [
        { type: 'shield', name: '가시 반사 장막', value: 30, reflectPercent: 0.35, text: '30 실드 & 피해 35% 반사', icon: '🌵' },
        { type: 'heal', name: '세계수의 재생력', value: 20, text: '보스 체력 +20 자가 회복', icon: '💖' }
      ]
    },
    {
      name: '수호 오벨리스크 & 성벽 강타',
      desc: '방어형 토템 소환 ➔ 지진 격파',
      steps: [
        { type: 'summon_or_buff', name: '불멸의 수호 토템 소환', value: 1, icon: '🏛️' },
        { type: 'attack', name: '요새의 성벽 충돌', value: 24, text: '24 물리 지진 강타', icon: '💥', dialogue: '내 철벽의 요새는 결코 무너지지 않는다!' }
      ]
    }
  ];
}

export async function generateBossWithLLM() {
  const conceptInput = document.getElementById('boss-llm-concept');
  const concept = conceptInput ? conceptInput.value.trim() : '';
  const chosenConcept = concept || '혼돈의 파멸신';

  const archetypeSelect = document.getElementById('boss-forge-archetype');
  let chosenArchetype = archetypeSelect ? archetypeSelect.value : 'random';
  if (chosenArchetype === 'random') {
    const keys = Object.keys(BOSS_ARCHETYPES);
    chosenArchetype = keys[Math.floor(Math.random() * keys.length)];
  }

  const reasoningSelect = document.getElementById('boss-forge-reasoning-mode');
  const chosenReasoningMode = reasoningSelect ? reasoningSelect.value : (state.settings.reasoningMode || 'fast');

  const loadingEl = document.getElementById('boss-llm-loading');
  const btnEl = document.getElementById('btn-boss-llm');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (btnEl) btnEl.disabled = true;

  // 원소 속성 판별
  let matchedElement = 'dark';
  if (chosenConcept.includes('불') || chosenConcept.includes('화염') || chosenConcept.includes('용암') || chosenConcept.includes('메테오')) matchedElement = 'fire';
  else if (chosenConcept.includes('물') || chosenConcept.includes('서리') || chosenConcept.includes('얼음') || chosenConcept.includes('빙결')) matchedElement = 'water';
  else if (chosenConcept.includes('번개') || chosenConcept.includes('벼락') || chosenConcept.includes('전기') || chosenConcept.includes('뇌제')) matchedElement = 'lightning';
  else if (chosenConcept.includes('빛') || chosenConcept.includes('성역') || chosenConcept.includes('천사') || chosenConcept.includes('신성')) matchedElement = 'holy';
  else if (chosenConcept.includes('어둠') || chosenConcept.includes('암흑') || chosenConcept.includes('심연') || chosenConcept.includes('마왕')) matchedElement = 'dark';
  else if (chosenConcept.includes('숲') || chosenConcept.includes('자연') || chosenConcept.includes('대지') || chosenConcept.includes('세계수')) matchedElement = 'nature';

  const arcInfo = BOSS_ARCHETYPES[chosenArchetype] || BOSS_ARCHETYPES.juggernaut;
  const suggestedHp = Math.floor(Math.random() * (arcInfo.hpRange[1] - arcInfo.hpRange[0] + 1)) + arcInfo.hpRange[0];

  const systemPrompt = `You are a dark fantasy RPG boss designer. Return ONLY a single JSON object.
Archetype: ${arcInfo.name} (${arcInfo.desc})
Format:
{
  "name": "보스 한국어 이름",
  "title": "English Title",
  "archetype": "${chosenArchetype}",
  "element": "${matchedElement}",
  "maxHp": ${suggestedHp},
  "shield": ${arcInfo.shield},
  "visualPrompt": "monster, masterpiece, solo, intimidating aura, cinematic lighting",
  "dialogueOnStart": "도발 대사",
  "dialogueLowHp": "위기 대사",
  "dialoguePlayerStunned": "조롱 대사"
}`;

  const bossSeeds = [
    'Creative Tone: Invent a grand, fearsome mythical entity name with authentic high-fantasy proper nouns (e.g. 아자토스, 말가니스, 벨리알, 크로노스, 니드호그, 헬리오스).',
    'Creative Tone: Create an ominous ancient sovereign title, avoiding generic template naming.',
    'Creative Tone: Design an otherworldly cataclysmic deity with poetic dark fantasy lore.'
  ];
  const chosenBossSeed = bossSeeds[Math.floor(Math.random() * bossSeeds.length)];
  const bossNonce = `boss-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  let parsedBoss = null;

  try {
    parsedBoss = await callOllamaChat({
      messages: [
        { role: 'system', content: 'You are a dark fantasy RPG boss designer. Return ONLY a single JSON object.' },
        { role: 'user', content: `Create a ${arcInfo.name} boss for concept: "${chosenConcept}".\nCreative Guidance: ${chosenBossSeed}\nSeed Nonce: ${bossNonce}\n${systemPrompt}` }
      ],
      timeoutMs: 300000,
      reasoningMode: chosenReasoningMode
    });
  } catch (err) {
    console.warn('Ollama 호출 실패 또는 타임아웃, 스마트 보스 생성기로 즉시 대체:', err.message);
  }

  // LLM 응답 실패 시 스마트 보스 생성 엔진으로 완벽 대체
  if (!parsedBoss || !parsedBoss.name) {
    const defaultTitles = {
      fire: 'Apostle of Hellfire',
      water: 'Archmage of Glaciers',
      lightning: 'Overlord of Thunder',
      holy: 'Divine Sovereign',
      dark: 'Abyssal Dominator',
      nature: 'Avatar of Worldtree'
    };
    parsedBoss = {
      name: chosenConcept,
      title: defaultTitles[matchedElement] || 'Legendary Overlord',
      archetype: chosenArchetype,
      element: matchedElement,
      maxHp: suggestedHp,
      shield: arcInfo.shield,
      visualPrompt: `giant ${matchedElement} elemental boss monster, glowing eyes, cinematic dramatic lighting, masterpiece illustration`,
      dialogueOnStart: `하찮은 필멸자여, 나의 ${ELEMENT_CONFIG[matchedElement].name}의 권능 앞에 굴복하라!`,
      dialogueLowHp: `크아악... 나의 진정한 ${ELEMENT_CONFIG[matchedElement].name}의 힘을 보여주마!`,
      dialoguePlayerStunned: '무력하구나! 이것이 절대자의 힘이다!'
    };
  }

  // 폼 입력 필드 자동 채우기
  const nameEl = document.getElementById('boss-forge-name');
  const titleEl = document.getElementById('boss-forge-title');
  const elementEl = document.getElementById('boss-forge-element');
  const hpEl = document.getElementById('boss-forge-hp');
  const hpValEl = document.getElementById('boss-hp-val-display');
  const promptEl = document.getElementById('boss-forge-prompt');
  if (archetypeSelect && chosenArchetype) archetypeSelect.value = chosenArchetype;

  const bElem = parsedBoss.element || matchedElement;
  const bHp = parseInt(parsedBoss.maxHp) || suggestedHp;
  if (nameEl) nameEl.value = parsedBoss.name;
  if (titleEl) titleEl.value = parsedBoss.title || 'Boss';
  if (elementEl) elementEl.value = bElem;
  if (hpEl) hpEl.value = bHp;
  if (hpValEl) hpValEl.innerText = bHp;
  if (promptEl) promptEl.value = expandDanbooruTags(parsedBoss.visualPrompt || `giant ${bElem} monster`, bElem, 'unit', 28);

  const patterns = generateSmartBossPatterns(parsedBoss.name, bElem, chosenArchetype);

  generatedBossPreviewData = {
    name: parsedBoss.name,
    title: parsedBoss.title,
    archetype: chosenArchetype,
    element: bElem,
    maxHp: bHp,
    currentHp: bHp,
    shield: parseInt(parsedBoss.shield) || arcInfo.shield,
    comboPatterns: patterns,
    dialogueOnStart: parsedBoss.dialogueOnStart,
    dialogueLowHp: parsedBoss.dialogueLowHp,
    dialoguePlayerStunned: parsedBoss.dialoguePlayerStunned,
    // ⚜️ 카드군 보스 — buildBossTacticalDeck이 이 값으로 전술 덱을 거른다.
    //    지정하면 그 카드군 카드 + 범용 카드만 쓴다.
    ...readBossTheme()
  };

  if (loadingEl) loadingEl.classList.add('hidden');
  if (btnEl) btnEl.disabled = false;

  alert(`✨ [${parsedBoss.name}] (${arcInfo.name} / ${ELEMENT_CONFIG[bElem].name} 속성) 보스 기획이 완료되었습니다!`);
}

export async function generateAIBoss() {
  if (!state.settings.apiKey) {
    alert('NovelAI API Key가 설정되지 않았습니다. 설정 모달에서 API Key를 입력해주세요.');
    return;
  }

  const name = document.getElementById('boss-forge-name').value.trim() || '파멸의 폭군';
  const element = document.getElementById('boss-forge-element').value;
  const prompt = document.getElementById('boss-forge-prompt').value.trim() || 'masterpiece, giant evil monster boss';

  const loadingEl = document.getElementById('boss-forge-loading');
  const btnEl = document.getElementById('btn-boss-generate');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (btnEl) btnEl.disabled = true;

  try {
    const imageUrl = await generateNovelAIImage({
      prompt: `masterpiece, giant evil monster boss, solo, ${prompt}, dark atmosphere, glowing eyes, cinematic lighting`,
      resolution: 'portrait-normal'
    });

    await showBossPreview(name, element, imageUrl);
  } catch (err) {
    alert(`보스 이미지 생성 안내: ${err.message}\n(기본 큐레이티드 아트로 안전하게 소환합니다)`);
    const mockImages = {
      fire: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
      water: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
      lightning: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
      holy: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
      dark: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80',
      nature: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80'
    };
    await showBossPreview(name, element, mockImages[element] || mockImages.dark);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (btnEl) btnEl.disabled = false;
  }
}

export function generateMockBoss() {
  const name = document.getElementById('boss-forge-name').value.trim() || '파멸의 폭군';
  const element = document.getElementById('boss-forge-element').value;
  const mockImages = {
    fire: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    water: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
    lightning: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    holy: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    dark: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80',
    nature: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80'
  };

  showBossPreview(name, element, mockImages[element] || mockImages.dark);
}

export async function showBossPreview(name, element, imageUrl) {
  const hp = parseInt(document.getElementById('boss-forge-hp').value) || 180;
  const title = document.getElementById('boss-forge-title').value.trim() || 'Custom Boss';
  const archetypeSelect = document.getElementById('boss-forge-archetype');
  const archetype = (archetypeSelect && archetypeSelect.value !== 'random') ? archetypeSelect.value : 'juggernaut';
  const optImg = await optimizeCardImage(imageUrl);

  const patterns = generateSmartBossPatterns(name, element, archetype);
  const arcInfo = BOSS_ARCHETYPES[archetype] || BOSS_ARCHETYPES.juggernaut;

  generatedBossPreviewData = {
    name: name,
    title: title,
    archetype: archetype,
    element: element,
    maxHp: hp,
    currentHp: hp,
    shield: arcInfo.shield || 20,
    imageUrl: optImg,
    comboPatterns: patterns,
    dialogueOnStart: `하찮은 필멸자여, 나의 ${ELEMENT_CONFIG[element].name}의 권능 앞에 무릎 꿇어라!`,
    dialogueLowHp: `크아악... 나의 진정한 ${ELEMENT_CONFIG[element].name}의 힘을 보여주마!`,
    dialoguePlayerStunned: '무력하구나! 이것이 절대자의 힘이다!'
  };

  const elCfg = ELEMENT_CONFIG[element] || ELEMENT_CONFIG.fire;

  document.getElementById('boss-preview-img').src = optImg;
  document.getElementById('boss-preview-name').innerText = name;
  document.getElementById('boss-preview-title').innerText = `${title} (${arcInfo.name})`;
  document.getElementById('boss-preview-hp').innerText = `${hp} HP`;
  document.getElementById('boss-preview-element').innerText = `${elCfg.icon} ${elCfg.name}`;
  document.getElementById('boss-preview-element').className = `font-bold ${elCfg.text}`;

  document.getElementById('boss-preview-box').classList.remove('hidden');
}

export async function saveAndFightBoss() {
  if (!generatedBossPreviewData) {
    alert('먼저 보스를 생성해주세요!');
    return;
  }

  const newBoss = {
    ...generatedBossPreviewData,
    id: `custom-boss-${Date.now()}`,
    actionIdx: 0
  };

  state.bossesList.unshift(newBoss);
  state.currentBossIdx = 0;
  await saveBossesToStorage();

  closeBossForgeModal();
  switchTab('battle');
  initBattle();

  const arcInfo = BOSS_ARCHETYPES[newBoss.archetype] || BOSS_ARCHETYPES.juggernaut;
  alert(`⚔️ [${arcInfo.name}] 보스 [${newBoss.name}] (${ELEMENT_CONFIG[newBoss.element].name} 속성) 가 아레나에 소환되었습니다!`);
}

export async function triggerLiveBossReaction(situationType, details = '') {
  if (!state.currentBoss) return;
  const boss = state.currentBoss;

  let reactionText = '';
  if (situationType === 'start' && boss.dialogueOnStart) {
    reactionText = boss.dialogueOnStart;
  } else if (situationType === 'lowHp' && boss.dialogueLowHp) {
    reactionText = boss.dialogueLowHp;
  } else if (situationType === 'stun' && boss.dialoguePlayerStunned) {
    reactionText = boss.dialoguePlayerStunned;
  }

  if (reactionText) {
    addBattleLog(`<span class="text-amber-400 font-bold">💬 ${boss.name}: "${reactionText}"</span>`);
  }
}

// ============================================================
// ⚜️ 카드군 보스
// ------------------------------------------------------------
// 엔진(buildBossTacticalDeck)은 예전부터 boss.themeId를 보고
// "그 카드군 카드 + 범용 카드"만 전술 덱에 넣도록 돼 있었다.
// 그런데 연성 UI에 지정할 수단이 없어 **쓸 수가 없었다.**
//
// ⚠️ boss-forge의 'archetype'은 전술 성향(juggernaut/tactician/...)이고
//    여기서 말하는 카드군(themeId)과는 완전히 다른 축이다. 헷갈리지 말 것.
// ============================================================

/** 보스 연성 모달의 카드군 선택기를 현재 DB로 채운다 */
export function refreshBossThemeOptions() {
  const sel = document.getElementById('boss-forge-theme');
  if (!sel) return;
  const keep = sel.value;
  const list = state.archetypesList || [];

  sel.innerHTML = `<option value="">— 지정 없음 (속성 기준 일반 보스) —</option>` +
    list
      .filter(a => a && a.id && a.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
      .map(a => {
        const els = (a.elements || [a.element]).filter(Boolean).join('/');
        return `<option value="${a.id}">${a.name}${els ? ' · ' + els : ''}</option>`;
      }).join('');

  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
}

/** 선택된 카드군을 보스 데이터 조각으로 (없으면 빈 객체) */
function readBossTheme() {
  const sel = document.getElementById('boss-forge-theme');
  const id = sel ? sel.value : '';
  if (!id) return {};
  const t = (state.archetypesList || []).find(a => a.id === id);
  if (!t) return {};
  return { themeId: t.id, themeName: t.name, themeKeyword: t.keyword || null };
}
