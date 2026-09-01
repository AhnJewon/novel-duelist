import { state, saveCardsToStorage, saveActiveDeckToStorage, optimizeCardImage, MAX_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { openSettingsModal } from './ui.js';
import { rollRandomRarity, RARITY_BALANCE_CAPS, sanitizeAndClampCardData } from './config.js';
import { callOllamaChat, generateNovelAIImage } from './ai-service.js';
import { expandDanbooruTags, buildVisualPromptFromCard } from './dan-tag-gen.js';
import { findMatchingArchetype, registerNewArchetype, getRelevantArchetypesPrompt, cleanCardName, enforceKeywordInName } from './archetype-service.js';
import { coerceCardElement } from './archetype-identity.js';
import { buildNamingRule, nameMatchesType, fixCardName } from './card-naming.js';
import { proposeArchetype } from './archetype-proposal.js';
import { readCustomOverrides, customOverridesToPrompt, applyCustomOverrides } from './custom-overrides.js';

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
  // 컨셉과 의미가 가까운 카드군만 싣는다 (전체를 실으면 컨텍스트가 넘친다)
  const knownThemes = await getRelevantArchetypesPrompt(concept || targetType, 6);

  const custom = readCustomOverrides();
  const customDirective = customOverridesToPrompt(custom);

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

🔴 ARCHETYPE REUSE RULE (가장 중요 — 반드시 지킬 것):
- 위 목록에 이미 있는 카드군과 컨셉/속성/효과가 조금이라도 겹치면, 새로 만들지 말고 그 카드군의 id를 "themeId"에 그대로 복사하고 "themeName"에도 목록의 이름을 한 글자도 바꾸지 말고 그대로 쓸 것.
- ❌ 절대 금지: 기존 "홍련의 검사단"이 있는데 "홍련 검사단", "홍련기사단", "붉은 연꽃 검사단" 같은 변형 이름을 새로 만드는 행위.
- ✅ 진짜로 위 목록 어디에도 속하지 않는 완전히 새로운 컨셉일 때만 "themeId": null 로 두고 새 카드군을 창설할 것.
- 카드군은 적을수록 좋다. 애매하면 무조건 기존 카드군에 편입시킬 것.


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
  * "bossShielded"  — 보스가 방어막을 두르고 있을 때만 (카운터형)
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
  (드로우, 제거, 방어막, 도발, 마나 수급 같은 만능 도구).
- ✅ 좋은 범용 예: "결계 분쇄의 일격", "욕망의 항아리", "방랑 용병"
- ❌ 나쁜 예: 억지로 카드군을 붙인 범용 카드

🪤 TRAP CARD (함정 카드 — 조건부 발동):
"cardType": "trap"으로 만들면 뒷면으로 세트되고, **상대가 조건을 만족할 때 자동 발동**한다.
즉발 카드와 달리 조건이 안 맞으면 아무 일도 없다. 그래서 강한 효과를 싸게 넣을 수 있다.
- "trapTrigger": 아래 중 하나
  * "foePlaysUnit"      상대가 소환수를 낼 때
  * "foePlaysSpell"     상대가 주문을 쓸 때
  * "foePlaysElement"   상대가 특정 속성 카드를 낼 때  → "condition": {"element":"fire"}
  * "foePlaysArchetype" 상대가 특정 카드군 카드를 낼 때 → "condition": {"archetype":"홍련"}
  * "foePlaysKeyword"   상대 카드가 특정 키워드를 가질 때 → "condition": {"keyword":"pierceShield"}
  * "foeAttacks"        상대가 공격할 때
  * "selfLowHp"         내 체력이 절반 이하가 될 때
- 함정도 스탯(공격력/체력)은 없다. skill의 효과만 갖는다.
- 💡 특정 속성·카드군·키워드를 노리는 함정이 가장 재미있다. 메타를 읽는 카드다.
⚖️ EFFECT BUDGET BY RARITY (등급별 효과 예산 — 반드시 지킬 것):
카드 성능은 스탯 수치가 아니라 **효과의 개수와 강도**로 결정된다.
- common    : 효과 1개. 피해 / 방어막 / 치유 / 상태이상 중 하나만.
- rare      : 효과 최대 2개. 드로우·마나수급·연타·치명타·흡혈·광역 가능.
- epic      : 효과 최대 3개. 실드관통·처형·더블캐스트 가능.
- legendary : 효과 최대 4개. 무적은 legendary만 가능.
❌ 절대 금지: common/rare 카드에 "무적", "모든 피해 무효화", "실드 관통", "처형" 부여
❌ 절대 금지: 한 카드에 "드로우 + 방어무시 피해 + 회복"처럼 서로 다른 역할을 3개 이상 몰아넣기
카드는 **하나의 역할**을 명확히 해야 한다. 만능 카드를 만들지 말 것.

TCG Archetype Combo Design Philosophy:
- Design skills that interact with the theme:
  * Deck Search: "소환 시: 내 덱에서 다른 [테마명] 카드 1장을 찾아 패로 서치"
  * Chain Strike: "필드에 다른 [테마명]이 있을 때: 보스에게 8 연계 피해 및 화상 부여"
  * Resonance / Charge: "발동 시: 마나 +1 충전 & 필드의 [테마명] 수만큼 방어막 전개"
  * Special Summon: "발동 시: 체력 12 회복 & [테마명] 정령을 전장에 무료 특수 소환"
- DO NOT use simple generic stat addition (+2 attack autochess style). Design true TCG combo mechanics!

CARD NAME RULE (카드 타입과 이름이 어긋나면 안 된다):
${buildNamingRule(targetType)}

🪤 반응형 효과는 **함정 전용**이다 (가장 자주 어기는 규칙):
- ❌ 소환수/주문/건축물에 "상대가 ~할 때마다", "적이 ~를 내면", "공격받으면" 같은
     **상대 행동에 반응하는** 효과를 쓰지 말 것.
     필드에 계속 남는 소환수가 그런 효과를 가지면 함정 카드가 존재할 이유가 없어진다.
- ✅ 소환수·주문·건축물은 **낼 때 즉시** 일어나는 일만 서술할 것.
- ✅ 반응형은 "cardType": "trap"에서만 쓰고, 그때 "trapTrigger"를 지정할 것.

⚙️ 실제로 구현된 효과만 쓸 것 (아래에 없는 건 글자만 남고 동작하지 않는다):
  damage(피해) · shield(방어막) · heal(치유) · manaGain(마나) · drawCards(드로우)
  multiHit(연타) · pierceShield(실드 관통) · lifestealPercent(흡혈)
  executeThreshold(처형) · doubleCastNext(더블캐스트) · invulnerableTurns(무적)
  damageReduction(피해 경감 %) · attackDown(공격력 약화) · silence(효과 무효화)
  statusEffect(stun/freeze/burn/shock/poison/vulnerable)

OUTPUT SCHEMA (Return ONLY valid raw JSON):
{
  "name": "컨셉을 살린 독창적이고 자연스러운 한국어 카드명",
  "title": "Clean English Title",
  "cardType": "${targetType}",
  "trapTrigger": "cardType이 trap일 때만: foePlaysUnit|foePlaysSpell|foePlaysElement|foePlaysArchetype|foePlaysKeyword|foeAttacks|selfLowHp",
  "condition": { "element": "또는 archetype 또는 keyword — trapTrigger가 요구할 때만" },
  "element": "fire|water|lightning|holy|dark|nature",
  "visualSeeds": "이 카드의 그림을 묘사하는 영어 핵심 키워드 3~6개, 쉼표 구분. 완성된 태그 목록이 아니라 핵심만. 예: crimson knight, flaming katana, fire sparks",
  "themeId": "기존 카드군이면 위 목록의 id를 그대로 복사. 완전히 새로운 카드군일 때만 null",
  "themeName": "카드군 테마명 (기존 카드군이면 목록의 이름을 한 글자도 바꾸지 말 것)",
  "themeKeyword": "카드군 핵심 키워드 (2~4글자 한국어)",
  "elementPolicy": "mono|dual|multi (신규 카드군일 때만)",
  "elements": ["허용 속성 배열, 예: fire 또는 fire,lightning"],
  "comboTrigger": "always|archetypePair|lowHp|bossShielded|handRich|lateGame|earlyGame",
  "comboScaling": "flat|perAlly|perTurn|perHand",
  "comboScope": "archetype|element|cardType|any",
  "comboScopeValue": "comboScope가 cardType일 때만: unit|spell|structure|trap",
  "themeSynergyDesc": "카드군 테마 상호 연계 효과 설명",
  "rarity": "common|rare|epic|legendary",
  "cost": 1-4,
  "attack": 6-24,
  "defense": 2-14,
  "hp": 14-38,
  "skill": {
    "name": "컨셉에 맞춘 독창적인 스킬명",
    "description": "생생한 한국어 효과 설명 (절대 % 사용 금지, 정수 수치만 사용)",
    "cost": 1-3,
    "damage": 0-22,
    "shield": 0-16,
    "heal": 0-16,
    "multiHit": 1,
    "drawCards": 0-2,
    "damageReduction": 0-60,
    "attackDown": 0-9,
    "silence": false,
    "targetSide": "foe|ally|self|any",
    "targetScope": "single|multi|all|random",
    "targetCount": 1-3,
    "statusEffect": {
      "type": "none|stun|freeze|burn|shock|poison|vulnerable",
      "duration": 1-2,
      "value": 0-8
    }
  }
}

🎯 TARGET RULES (대상 규칙 — 카드 성능에 직접 반영된다):
- "targetScope"가 넓을수록 카드가 **강해지고 마나도 비싸진다.**
  single(1배) < multi 2체(1.5배) < multi 3체(2배) < all(2.2배)
  random은 지정이 아니라 무작위라 오히려 약하다(0.8배).
- 예산을 넘으면 시스템이 자동으로 범위를 좁히거나 효과를 지운다.
  낮은 등급에 "적 전체"를 붙이면 대부분 잘려 나간다.
- 치유·버프는 "targetSide": "ally", 공격·디버프는 "foe"가 자연스럽다.
- 대상이 필요 없는 효과(내 방어막, 마나 수급)는 "targetSide": "self"로 둘 것.
${customDirective}`;

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
  // 🎛️ 사용자 지정 값을 먼저 덮어쓴 뒤 밸런스 검증(등급·마나 예산)을 태운다.
  //     순서가 반대면 사용자가 정한 수치가 검증을 건너뛴다.
  const data = sanitizeAndClampCardData(applyCustomOverrides(rawData, readCustomOverrides()));
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

  // 🏷️ 시각 프롬프트: LLM이 준 영어 핵심 키워드를 태그 제네레이터가 확장한다.
  // (의미는 LLM, 태그 문법·개수는 코드. visualSeeds가 없으면 한국어 사전으로 폴백)
  const conceptInputEl = document.getElementById('llm-concept-input');
  const userConcept = conceptInputEl ? conceptInputEl.value.trim() : '';
  promptInput.value = buildVisualPromptFromCard({
    name: data.name,
    title: data.title,
    themeName: data.themeName,
    visualSeeds: data.visualSeeds || data.visualPrompt,
    skill: data.skill || (Array.isArray(data.skills) ? data.skills[0] : null)
  }, targetElem, targetType, userConcept);
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
    // 🔁 카드군 중복 피드백 루프
    // 게이트가 확실히 판정하면 그대로 흡수하고, 회색지대일 때만 LLM에게 되묻는다.
    // (같은 컨셉인데 표기가 달라 문자열 유사도로 못 잡는 경우를 여기서 걸러낸다)
    const proposal = await proposeArchetype({
      name: data.themeName,
      keyword: data.themeKeyword,
      element: targetElem,
      comboAction: data.themeComboAction || data.comboAction,
      comboTrigger: data.comboTrigger,
      comboScaling: data.comboScaling,
      comboScope: data.comboScope,
      comboScopeValue: data.comboScopeValue,
      elementPolicy: data.elementPolicy,
      elements: data.elements,
      description: data.themeSynergyDesc || data.themeComboDesc
    }, { allowFeedback: true });

    console.log(`[Archetype] ${proposal.action}: ${proposal.note}`);

    matchedTheme = await registerNewArchetype({
      id: proposal.themeData.id || data.themeId || null,
      name: proposal.themeData.name,
      keyword: proposal.themeData.keyword,
      element: targetElem,
      comboAction: data.themeComboAction || data.comboAction,
      comboTrigger: data.comboTrigger,
      comboScaling: data.comboScaling,
      comboScope: data.comboScope,
      comboScopeValue: data.comboScopeValue,
      elementPolicy: data.elementPolicy,
      elements: data.elements,
      themeComboDesc: data.themeSynergyDesc || data.themeComboDesc,
      synergy: { desc: data.themeSynergyDesc || data.themeComboDesc || `[${proposal.themeData.name}] 카드군 연계` }
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
    attack: cardType === 'spell' || cardType === 'structure' || cardType === 'trap' ? 0 : (rarity === 'legendary' ? 28 : (rarity === 'epic' ? 20 : 14)),
    defense: cardType === 'spell' || cardType === 'trap' ? 0 : (rarity === 'legendary' ? 12 : 8),
    hp: cardType === 'spell' || cardType === 'trap' ? 0 : (cardType === 'structure' ? 45 : (rarity === 'legendary' ? 40 : 30)),
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

  // 🎨 카드 속성을 카드군 정책에 맞춘다.
  // "홍련(화염) 카드군"에 물 속성 카드가 섞이면 카드군 정체성이 무너진다.
  const elementFix = coerceCardElement(finalTheme, element);
  const finalElement = elementFix.element;
  if (elementFix.changed) {
    console.log(`[Element] ${elementFix.reason} → ${finalElement}로 교정`);
  }
  // 🏷️ 타입에 안 맞는 이름 교정 (건축물에 소환수 이름이 붙는 문제)
  let typedName = name;
  if (!nameMatchesType(typedName, cardType)) {
    const fixed = fixCardName(typedName, cardType);
    console.log(`[작명] ${cardType} 이름 교정: "${typedName}" → "${fixed}"`);
    typedName = fixed;
  }
  // 🏷️ 카드군 소속 카드는 이름에 키워드를 포함해야 덱 서치 콤보가 잡아낸다
  const finalName = enforceKeywordInName(typedName, finalTheme, cardType);

  const rawCard = {
    id: `custom-${Date.now()}`,
    cardType: cardType,
    name: finalName,
    title: `${rarity.toUpperCase()} ${cardType.toUpperCase()}`,
    element: finalElement,
    themeId: finalTheme ? finalTheme.id : null,
    themeName: finalTheme ? finalTheme.name : null,
    themeKeyword: finalTheme ? finalTheme.keyword : null,
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

  // ⚜️ 방금 새 카드군이 생겼을 수 있다. 연성소에 머문 채로도 목록이 갱신돼야
  //    바로 다음 카드를 그 카드군에 넣을 수 있다.
  //    (탭 전환 때만 갱신하면 "왜 안 보이지" 하고 헤맨다)
  if (window._refreshCustomThemes) window._refreshCustomThemes();

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
