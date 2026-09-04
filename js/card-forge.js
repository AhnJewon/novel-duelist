import { state, saveCardsToStorage, saveActiveDeckToStorage, optimizeCardImage, MAX_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { audio } from './audio.js';
import { openSettingsModal } from './ui.js';
import { rollRandomRarity, rollCardCost, RARITY_BALANCE_CAPS, sanitizeAndClampCardData, buildStructurePassive, describeStructurePassive, normalizeStructurePassive } from './config.js';
import { callOllamaChat, generateNovelAIImage, getLastImageRequest } from './ai-service.js';
import { expandDanbooruTags, buildVisualPromptFromCard } from './dan-tag-gen.js';
import { findMatchingArchetype, registerNewArchetype, getRelevantArchetypesPrompt, cleanCardName, enforceKeywordInName } from './archetype-service.js';
import { coerceCardElement, playstyleGuide, playstyleOptionsForPrompt, inferPlaystyle } from './archetype-identity.js';
import { coerceCardRaces, RACE_CONFIG, RACE_KEYS, raceImageTags, MAX_RACES_PER_CARD } from './races.js';   // 🧬 종족 (DECISIONS #106)
import { buildNamingRule, nameMatchesType, fixCardName } from './card-naming.js';
import { validateCardPlan, buildRetryDirective, validateRequestedEffects } from './card-validator.js';
import { applyLlmDescription } from './card-describe.js';
import { proposeArchetype } from './archetype-proposal.js';
import { cardTypeRules, cardTypeStatRule } from './card-type-rules.js';
import { readCustomOverrides, customOverridesToPrompt, applyCustomOverrides } from './custom-overrides.js';
import { rollEffectRole, effectRoleDirective, enforceEffectRole, rollTrapTrigger, trapTriggerDirective } from './card-design-roll.js';
import { flavorConceptDirective, flavorStatusTypes } from './local-flavor.js';   // 🎭 로컬 플레이버 팩
import { getDust, spendDust, dustForExcessPower } from './card-copies.js';

let currentLLMSkillData = null;
let currentForgeCardType = 'unit';
let currentCardTheme = null;

// ⭐ 이번 카드의 **확정된** 등급.
//    등급 입력은 #forge-rarity 한 곳뿐이고, 값은 한 방향으로만 흐른다:
//      #forge-rarity(유저 의도) → readCustomOverrides → applyCustomOverrides → data.rarity
//                                                                                  ↓
//                                                          currentForgeRarity(확정) → 미리보기·저장
//    코드가 셀렉트를 되쓰지 않는다. 예전에는 되썼기 때문에 "AI 결정"이 한 번
//    기획하면 조용히 고정값으로 변했다 → DECISIONS #92
let currentForgeRarity = null;
// ⚖️ 예산 초과 허용 시 남는 파워 초과분(단위)과, 옵션 변경 시 다시 정산할 마지막 기획 원본 (DECISIONS #100)
let currentPowerDebt = 0;
let lastPlanRaw = null;
// 🎭 이번 기획에 코드가 굴린 효과 성향·함정 조건 (DECISIONS #102). 유저가 효과 설명·함정 조건을 적었으면 null.
let forgeEffectRole = null;
let forgeTrapPlan = null;

/** 💎 생성 버튼 옆 가루 소모 안내 — 초과분이 있을 때만 보인다 */
function renderForgeDustCost() {
  const box = document.getElementById('forge-dust-cost');
  if (!box) return;
  const need = dustForExcessPower(currentPowerDebt);
  if (need <= 0) { box.classList.add('hidden'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
  set('forge-dust-excess', currentPowerDebt.toFixed(1));
  set('forge-dust-need', need.toLocaleString('ko-KR'));
  set('forge-dust-have', getDust().toLocaleString('ko-KR'));
  box.classList.remove('hidden');
  box.classList.toggle('border-red-500/70', need > getDust());
}

/**
 * 🖼️ 방금 NovelAI에 실제로 보낸 프롬프트를 미리보기 아래에 펼친다.
 * 🐛 유저 지적: "이미지 프롬프트가 실제 사용되는 프롬프트 전부를 보여주는 건 아닌 것 같다" — 맞았다. 태그 칸은 시드고,
 *    전송 직전에 SLM이 28~30태그로 확장하고 작가 태그·품질 태그를 붙인다 (DECISIONS #100).
 */
function renderFinalPromptPanel() {
  const req = getLastImageRequest();
  const details = document.getElementById('forge-final-prompt-details');
  if (!details) return;
  if (!req) { details.classList.add('hidden'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('forge-final-prompt-content', req.prompt);
  set('forge-final-negative-content', req.negative);
  set('forge-final-prompt-meta', `— ${req.width}×${req.height} · seed ${req.seed} · ${req.prompt.split(',').length}태그`);
  details.classList.remove('hidden');
}

/** 옵션(예산 초과 허용 등)을 바꿨을 때 마지막 기획을 다시 정산한다 — LLM 재호출 없음 */
export async function reapplyForgePlan() {
  if (!lastPlanRaw) { updateForgePromptPreview(); return; }
  await applyGeneratedCardData(lastPlanRaw);
}

/** 생성 직전 가루 잔액 확인 — 부족하면 이미지를 만들기 전에 막는다 (Anlas·시간을 쓰기 전에) */
function ensureDustForPlan() {
  const need = dustForExcessPower(currentPowerDebt);
  if (need > getDust()) {
    alert(`💎 가루가 부족합니다. 이 카드의 예산 초과분에 가루 ${need}이(가) 필요하지만 ${getDust()}만 있습니다.\n효과를 줄이거나, "예산 초과 허용"을 끄면 시스템이 예산에 맞게 정산합니다.`);
    return false;
  }
  return true;
}
// 🎲 속성도 같은 구조다: #forge-element(유저 의도, 빈 값 = AI 결정) → currentForgeElement(확정) → 미리보기·저장
let currentForgeElement = null;
const FORGE_ELEMENTS = ['fire', 'water', 'lightning', 'holy', 'dark', 'nature'];

/**
 * 이 카드의 속성. 우선순위: 유저가 고른 값 > AI가 확정한 값 > 아직 아무도 안 정했으면 추첨.
 * 셀렉트를 되쓰지 않으므로 "AI 결정"을 고른 유저는 다음 카드도 AI가 정한다.
 */
function forgeElement() {
  const sel = document.getElementById('forge-element');
  if (sel && sel.value) return sel.value;
  if (currentForgeElement) return currentForgeElement;
  currentForgeElement = FORGE_ELEMENTS[Math.floor(Math.random() * FORGE_ELEMENTS.length)];
  return currentForgeElement;
}

// 📐 이번 카드의 **정산이 끝난** 수치(마나·공/방/체). 기획(applyGeneratedCardData)이
//    채우고 저장(completeForgedCard)과 미리보기가 그대로 쓴다.
//    🐛 수정: 예전에는 저장 직전에 등급 캡으로 **다시 굴렸다.** 기획→저장 사이를 살아남는
//       값이 DOM의 이름·속성·등급과 스킬 데이터뿐이어서, 유저가 세부사항에 지정한 마나 2·
//       공격력 9도, LLM이 설계한 스탯도 카드에 남지 않았다 → DECISIONS #93
let currentPlannedStats = null;

/** 카드 데이터에서 유한한 수치만 골라 담는다. 빠진 칸은 저장 때 캡에서 굴린다. */
function pickPlannedStats(src) {
  const out = {};
  for (const k of ['cost', 'attack', 'defense', 'hp']) {
    const v = Number(src && src[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * ⭐ 지금 쓸 등급 하나를 정한다. 저장·미리보기가 모두 여기를 통과한다.
 *
 * 우선순위: 유저가 고른 값 > AI가 정한 값 > 가챠 추첨(한 번만 굴려 기억한다).
 * 가챠를 매번 굴리면 미리보기와 저장이 어긋나므로 결과를 기억해 둔다.
 */
function forgeRarity() {
  const el = document.getElementById('forge-rarity');
  const picked = el ? el.value : '';
  if (picked) return picked;                       // 유저가 명시적으로 골랐다
  if (currentForgeRarity) return currentForgeRarity; // AI가 정했다
  currentForgeRarity = rollRandomRarity();          // 🎲 아직 아무도 안 정했다
  return currentForgeRarity;
}

/** "AI 결정"일 때 실제로 무엇이 정해졌는지 라벨에 보여준다 (셀렉트는 건드리지 않는다) */
function renderForgeRarityHint() {
  const hint = document.getElementById('forge-rarity-resolved');
  if (!hint) return;
  const el = document.getElementById('forge-rarity');
  const picked = el ? el.value : '';
  hint.textContent = picked ? '' : `→ ${String(forgeRarity()).toUpperCase()}`;
}

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
  // 🎲 속성 칸이 "AI 결정"(빈 값)이면 LLM이 콘셉트에 맞게 고른다. 고른 값은 customDirective가 강제한다.
  const chosenElem = readCustomOverrides().element;
  const targetElem = chosenElem || '자유 — 콘셉트에 맞게 고른다';
  // 컨셉과 의미가 가까운 카드군만 싣는다 (전체를 실으면 컨텍스트가 넘친다)
  const knownThemes = await getRelevantArchetypesPrompt(concept || targetType, 6);

  const custom = readCustomOverrides();
  // 🎭 유저가 효과를 적지 않았으면 성향을 코드가 굴린다(팩과 같은 규칙, DECISIONS #102). 적었으면 유저 요구가 성향이다.
  //    🪤 함정 조건도 유저가 비웠으면 굴린다 — 비운 것은 LLM 몫이지만 4B 모델은 늘 foePlaysUnit을 고른다.
  forgeEffectRole = custom.effectDesc ? null : rollEffectRole(targetType);
  forgeTrapPlan = (targetType === 'trap' && !custom.trapTrigger) ? rollTrapTrigger({ element: custom.element || 'fire', themeName: custom.themeName }) : null;
  if (forgeTrapPlan) { custom.trapTrigger = forgeTrapPlan.trapTrigger; custom.trapCondition = forgeTrapPlan.condition ? Object.values(forgeTrapPlan.condition)[0] : null; }
  const customDirective = customOverridesToPrompt(custom) + effectRoleDirective(forgeEffectRole, targetType)
    + trapTriggerDirective(forgeTrapPlan) + flavorConceptDirective();   // 🎭 로컬 플레이버 팩 (없으면 빈 문자열)

  // 🎭 유저가 기존 카드군을 골랐으면 그 카드군의 플레이스타일 가이드를 싣는다.
  //    ⚠️ currentCardTheme을 쓰면 안 된다 — 그건 **생성이 끝난 뒤에** 대입되므로
  //       프롬프트를 만드는 지금은 직전 카드의 카드군이 들어 있다.
  const forgeSelectedTheme = custom.themeId
    ? (state.archetypesList || []).find(a => a.id === custom.themeId) || null
    : null;

  const userDirective = concept
    ? `Design a unique fantasy TCG card based on this user Concept: "${concept}".`
    : `Freely brainstorm and invent a 100% original, creative fantasy TCG card of type "${targetType}" from your boundless imagination! You have complete creative freedom over the lore, character, archetype, origin, powers, and style. Surprise the player with a fresh, captivating, authentic TCG concept.`;

  const nonceId = `session-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  // 💎 코스트를 **먼저** 정해 LLM에 넘긴다.
  //    예전에는 LLM이 등급을 고르고 등급이 코스트를 가뒀다(레어+ 는 2마나 이상).
  //    그래서 덱에 저코스트 카드가 사라져 1턴에 낼 것이 없었다.
  //    유저가 코스트를 직접 지정했으면 그 값을 존중한다.
  const plannedCost = Number.isFinite(custom.cost) && custom.cost > 0
    ? Math.max(1, Math.min(7, custom.cost))
    : rollCardCost(6);

  // 🎯 이 타입 규칙만 싣는다 — 네 타입을 다 보내면 LLM이 특징을 섞는다
  const typeRules = cardTypeRules(targetType);
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
   - common: attack 6-10, defense 2-6, hp 14-22, damage 8-12, shield 6-10, heal 6-10, buff +1~2
   - rare: attack 10-15, defense 4-8, hp 20-28, damage 12-18, shield 10-16, heal 10-16, buff +2~3
   - epic: attack 14-20, defense 6-12, hp 26-34, damage 16-24, shield 14-20, heal 14-22, buff +3~4
   - legendary: attack 18-26, defense 8-14, hp 30-40, damage 20-28, shield 18-26, heal 18-26, buff +4~5

💎 MANA COST (이미 정해져 있다 — 이 카드의 코스트는 **${plannedCost}**):
- "cost"에 반드시 ${plannedCost}를 넣어라. 네가 바꾸지 마라.
- **등급은 코스트를 정하지 않는다.** 등급이 정하는 건 "그 코스트에서 얼마나
  강할 수 있는가"(파워 밀도)다. 1마나 레전더리는 "아주 효율 좋은 작은 카드"로
  성립하고, 6마나 커먼은 "느리지만 효과가 많은 카드"로 성립한다.
- ${plannedCost}마나에 어울리는 규모로 설계하라:
  * 1~2마나 → 효과 1개, 스탯도 작게. 초반에 낼 수 있는 것이 가치다.
  * 3~4마나 → 효과 1~2개, 준수한 스탯.
  * 5마나 이상 → 효과 2~3개 또는 판을 뒤집는 큰 한 방.
- ⚠️ 예산을 넘으면 시스템이 **효과를 잘라내거나 수치를 깎는다.** 반대로 너무
  빈약하면 **마나를 내려버린다.** 처음부터 ${plannedCost}마나에 맞춰 설계하라.

${typeRules}

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
  * "bossShielded"  — 상대가 방어막을 두르고 있을 때만 (카운터형; 키 이름은 유산)
  * "handRich"      — 손패 5장 이상일 때만 (자원형)
  * "lateGame"      — 5턴 이후 (장기전형)
  * "earlyGame"     — 3턴 이내 (속공형)
- "comboScope" (무엇에 반응하는가) — 이게 덱 컨셉을 결정한다:
  * "archetype" 같은 카드군에만 반응 (위력 100%) — 정체성이 가장 뚜렷한 카드군
  * "element"   같은 속성이면 카드군이 달라도 반응 (위력 80%) — **속성 덱**이 성립
  * "race"      같은 종족이면 카드군이 달라도 반응 (위력 85%) — **종족 덱**이 성립. 종족 없는 카드는 기여 못 함
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

🎭 ARCHETYPE PLAYSTYLE (카드군 플레이스타일 — 덱 전체의 설계도):
카드군은 "어떻게 이기는가"가 있어야 한다. 그게 없으면 같은 카드군 안에서
1마나 잡졸과 6마나 거신이 뒤섞이고, 건축물·함정·마법이 제각각 놀게 된다.
${playstyleOptionsForPrompt()}
- **기존 카드군**에 카드를 보탤 때는 위 목록의 "스타일:" 표시를 보고 그 방향에 맞춰라.
- **신규 카드군**을 만들 때만 "themePlaystyle"에 위 키 중 하나를 골라 넣어라.
- 이 스타일은 소환수뿐 아니라 **건축물·함정·마법에도 똑같이 적용**된다.
  예: 저코스트 전개형 카드군의 건축물은 마나나 카드를 공급해야지,
      매 턴 방어막을 쌓는 요새가 되면 카드군 컨셉과 어긋난다.
- ⚠️ 스타일 이름을 카드 이름이나 설명문에 적지 마라. 효과로만 드러내라.
${forgeSelectedTheme ? '\n' + playstyleGuide(forgeSelectedTheme, targetType) + '\n' : ''}
🌐 GENERIC CARD RATIO (범용 카드 비율 — 중요):
모든 카드가 카드군에 속할 필요는 없다. 실제 TCG는 **범용 카드가 덱의 절반 가까이** 차지한다.
- 약 **35~40%는 범용 카드**로 만들라. 범용은 "themeId": null, "themeName": null 로 둔다.
- 범용 카드는 특정 카드군에 얽매이지 않는 대신 자체 스펙이 깔끔해야 한다
  (드로우, 제거, 방어막, 마나 수급 같은 만능 도구).
- ✅ 좋은 범용 예: "결계 분쇄의 일격", "욕망의 항아리", "방랑 용병"
- ❌ 나쁜 예: 억지로 카드군을 붙인 범용 카드

⚖️ 타입별 효과 예산 (카드 타입마다 넣을 수 있는 효과의 양이 다르다):
- **소환수**는 콘셉트에 맞는 고유 스킬(피해, 방어막, 회복, 상태이상 등) **1개를 우선 설계**하라. 스탯보다 효과가
  카드의 정체성이다 — 예산이 넘치면 시스템이 **스탯을 먼저** 깎아 효과를 살린다. 정말 효과가 없는 카드만 바닐라("isVanilla": true).
- **건축물**은 공격하지 않으므로 체력이 싸다 → 지속 패시브 + 효과 1개 정도.
- **마법**은 스탯이 없어 예산 전부가 효과로 가지만, 일회용이라 총량이 낮다 → **1~2개**.
- **함정**은 조건부라 총량 보상을 받는다 → 같은 마나에서 가장 많은 효과 (**2~3개**).
⚠️ 효과를 많이 넣으면 시스템이 **마나를 올리거나 효과를 잘라낸다.**
   반대로 효과가 너무 적으면 **마나를 내린다** — 값을 치를 것이 없는 고코스트 카드는
   死카드이기 때문이다. 마나와 효과량을 애초에 맞춰서 내라.

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
  * Chain Strike: "필드에 다른 [테마명]이 있을 때: 상대에게 8 연계 피해 및 화상 부여"
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
  maxHpGain(본체 최대 체력 증가 — 영구)
  statusEffect(stun/freeze/corrosion/burn/shock/poison/vulnerable)
  destroy(적 소환수 파괴 — 체력 무관, 1~3체) · searchDeck(덱에서 카드 서치, 1~3장)
  summonToken(4/2/10 토큰 소환, 1~3체)

💫 STATUS EFFECT — 각각 하는 일이 다르다. value(위력)와 duration(턴)의 뜻도 다르다:
| type | 하는 일 | value의 뜻 | duration의 뜻 |
|---|---|---|---|
| stun(기절) | 그 턴 행동 불가 | 안 쓴다 | 몇 턴 묶이나 |
| freeze(빙결) | **공격력 약화** (때릴 때만 빠진다, 원래 값은 안 지워진다) | 깎이는 공격력 | 몇 턴 |
| corrosion(부식) | **방어력 약화** (맞을 때만 빠진다) | 깎이는 방어력 | 몇 턴 |
| burn(화상) | 매 턴 시작에 지속 피해 | 턴당 피해 | 몇 턴 |
| poison(맹독) | 매 턴 시작에 지속 피해(방어막 관통) | 턴당 피해 | 몇 턴 |
| shock(감전) | 맞으면 추가 피해 + **감전된 그 진영 전원**에게 같은 값이 번진다 | 한 번에 들어가는 피해 | 몇 턴 |
| vulnerable(취약) | 받는 피해 +50% | 안 쓴다 | 몇 턴 |
- 빙결과 부식은 **짝**이다. 하나는 공격력, 하나는 방어력 — 섞어 쓰지 마라.
- 감전은 **넓게 걸수록** 세다. 한 대 때리면 걸린 전원이 함께 맞는다.
- **stun / freeze / corrosion / burn / poison** 은 **소환수·건축물 전용**이다.
  본체(나/상대 모두)에는 걸리지 않는다. 상대 전장이 비어 있으면 **불발**한다.
  * 이유: 본체는 체력이 낮은데 행동 봉쇄·약화·지속 피해는 대응할 여지가 없다.
    이 계열은 **보드 컨트롤 수단**이다.
  * ✅ "적 소환수 1체를 2턴간 빙결시킨다"
  * ❌ "상대를 2턴간 기절시킨다"   — 본체 지정은 걸리지 않는다
- **shock(감전) / vulnerable(취약)** 은 본체에도 걸린다. 둘은 증폭기라서
  상대가 실제로 때려야 의미가 생긴다.
- 화상·맹독을 꼭 본체에 걸어야 하는 컨셉이면 "bodyStatus": true 를 함께 넣어라.
  다만 **파워 비용이 2.5배**로 붙으므로 마나가 크게 올라간다. 남용하지 마라.
  ❌ 기절·빙결은 bodyStatus를 붙여도 **본체에 절대 걸리지 않는다** — 소환수로 돌아간다.

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
  "themePlaystyle": "신규 카드군일 때만: turtle|swarm|control|ace|burn|toolbox",
  "elements": ["허용 속성 배열, 예: fire 또는 fire,lightning"],
  "comboTrigger": "always|archetypePair|lowHp|bossShielded|handRich|lateGame|earlyGame",
  "comboScaling": "flat|perAlly|perTurn|perHand",
  "comboScope": "archetype|element|race|cardType|any",
  "races": ["종족 0~2개. 이 카드가 무엇인가 — 그림에 직접 반영된다. human|beast|undead|demon|construct|fae|aberration|dragon. 사람·괴물이 아닌 카드(주문·건축물 대부분)는 빈 배열."],
  "comboScopeValue": "comboScope가 cardType일 때만: unit|spell|structure|trap",
  "themeSynergyDesc": "카드군 테마 상호 연계 효과 설명",
  "rarity": "common|rare|epic|legendary",
  "cost": ${plannedCost},
  ${cardTypeStatRule(targetType)},
  "skill": {
    "name": "컨셉에 맞춘 독창적인 스킬명",
    "_writeOrder": "⚠️ description은 **맨 마지막에** 쓴다. 아래 수치를 먼저 정하고, 그 수치를 그대로 옮겨 적을 것.",
    "isVanilla": "효과 없는 바닐라 소환수일 때만 true (드물다). 그러면 아래 수치는 전부 0/생략.",
    "flavorText": "카드의 분위기 한 줄 (40자 이내). ⚠️ 효과·수치를 쓰지 마라 — 규칙 텍스트는 시스템이 데이터에서 만든다.",
    "cost": 1-3,
    "damage": 0-22,
    "shield": 0-16,
    "heal": 0-16,
    "multiHit": 1,
    "drawCards": 0-2,
    "hpTarget": "body|minion",
    "damageReduction": 0-60,
    "attackDown": 0-9,
    "silence": false,
    "destroy": 0-3,
    "searchDeck": 0-3,
    "summonToken": 0-3,
    "targetSide": "foe|ally|self|any",
    "targetScope": "single|multi|all|random",
    "targetCount": 1-3,
    "damageTarget": "body|field|any",
    "statusEffect": {
      "type": "none|stun|freeze|corrosion|burn|shock|poison|vulnerable|parasite${flavorStatusTypes().map(t => '|' + t).join('')}",
      "duration": 1-2,
      "value": 0-8
    },
    "description": "위 수치를 그대로 옮긴 한국어 설명 (맨 마지막에 작성)"
  }
}

💠 효과 개수와 마나 커브 (**가장 자주 어기는 규칙**):
- **대부분의 카드는 효과가 1개다.** 2개는 가끔, 3개 이상은 드물어야 한다.
  효과를 많이 넣을수록 시스템이 마나를 올리는데, 모든 카드가 그러면
  **저코스트 카드가 사라져 게임이 굴러가지 않는다.**
- 등급별 기본 자세:
  * common    — 효과 1개, 마나 1~2. 단순하고 싸야 한다. 이게 덱의 뼈대다.
  * rare      — 효과 1~2개, 마나 2~3
  * epic      — 효과 2개, 마나 3~4
  * legendary — 효과 2~3개, 마나 3~5
- ⭐ 예외는 **의도적으로** 만들어라: "효과는 강하지만 그만큼 비싼 COMMON"은
  좋은 카드다. 단 이런 카드는 **드물게** 나와야 선택지가 된다.
  10장 중 1~2장이면 충분하다.

📝 설명문 작성 규칙 (**수치를 먼저, 설명은 나중에**):
1. damage/shield/heal 같은 **수치를 먼저 확정**한다.
2. description은 그 수치를 **그대로** 옮겨 적는다. 새로운 숫자를 지어내지 말 것.
   - damage:14 라면 → "적에게 14 피해" (O) / "적에게 20 피해" (X)
3. 스키마에 없는 수치를 설명문에만 쓰지 말 것. 동작하지 않는다.
4. ❤️ "hpTarget"으로 heal이 **누구 체력을 회복하는지** 정한다.
   - "body"   = 플레이어 본체 HP. 패배 조건과 직결돼 **더 비싸다** (예산 x1.0).
   - "minion" = 이 소환수 자신의 체력(카드의 ❤️). 죽으면 사라져 **더 싸다** (예산 x0.6).
   - 주문·함정은 필드에 남지 않으므로 자동으로 body가 된다.
   - 설명문에도 "본체 체력" / "이 소환수의 체력"으로 명확히 쓸 것.
5. "체력"은 **누구 것인지 반드시 밝힐 것.**
   - "본체 체력" = 플레이어 본체 HP. heal과 lowHp 조건은 **전부 이쪽**이다.
   - 카드에 찍힌 ❤️는 그 소환수 자신의 체력이며 heal로 회복되지 않는다.
   - ✅ "본체 체력 12를 회복한다"   ❌ "체력을 회복한다"
5. 수비력(defense)은 그 소환수가 받는 피해를 그만큼 깎는다 (최소 1은 관통).

🎯 TARGET RULES (대상 규칙 — 카드 성능에 직접 반영된다):
- "targetScope"가 넓을수록 카드가 **강해지고 마나도 비싸진다.**
  single(1배) < multi 2체(1.5배) < multi 3체(2배) < all(2.2배)
  random은 지정이 아니라 무작위라 오히려 약하다(0.8배).
- 예산을 넘으면 시스템이 자동으로 범위를 좁히거나 효과를 지운다.
  낮은 등급에 "적 전체"를 붙이면 대부분 잘려 나간다.
🎯 targetSide는 **누구를 겨냥하는가**다. 스킬 하나에 하나만 있다.
- 공격·디버프(damage / attackDown / silence / statusEffect / destroy) → "foe"
- 남을 치유하거나 버프 → "ally"
- 양쪽 다 고를 수 있게 하려면 → "any"
- "self"는 **겨냥하는 효과가 하나도 없을 때만** 쓴다.
  ⚠️ 내 방어막(shield)·마나 수급(manaGain)·드로우(drawCards)는 애초에
     겨냥이 필요 없어 targetSide를 보지 않는다. 그것들 때문에 "self"를
     고르지 마라 — 같은 카드에 damage가 있으면 그 피해가 "자신"을 향하게 되고,
     이 엔진에는 **자기 피해 메커니즘이 없어서** 카드 설명과 실제가 어긋난다.
  * ✅ "적 1체에 12 피해 + 내 방어막 8"  → "targetSide": "foe"
  * ❌ 같은 카드에 "targetSide": "self"  → "자신 1체에 12 피해"라는 이상한 카드가 된다
${customDirective}`;

  const reasoningSelect = document.getElementById('forge-reasoning-mode');
  const currentReasoningMode = reasoningSelect ? reasoningSelect.value : (state.settings.reasoningMode || 'fast');

  try {
    let cardData;
    let deepPlanText = '';

    // 🧠 추론 모드 분기 (Separated Reasoning Pipeline)
    if (currentReasoningMode === 'deep') {
      // 🧠 1단계: 모델의 실제 Thinking 모드로 심층 추론 실행 (think: true)
      if (loadingEl) {
        const t = loadingEl.querySelector('span');
        if (t) t.innerText = '🧠 1/2단계: Qwen 3.5 모델이 캐릭터 서사 및 스킬 밸런스를 심층 추론(Thinking) 중...';
      }
      const brainstormPrompt = `당신은 전설적인 서브컬처 TCG 카드 디자이너입니다.
유저 콘셉트: "${concept || '강력한 판타지 영웅'}"
카드 타입: ${targetType}
속성: ${targetElem}

이 카드의 깊이 있는 세계관과 전략적 가치를 위해 심층적으로 추론하고 기획해 주세요:
1. 캐릭터 서사 및 외형 콘셉트 심층 분석
2. 속성과 카드 타입에 걸맞은 전투 스타일 추론
3. 독창적인 시그니처 스킬의 전략적 메커니즘 및 밸런스 추론 (피해, 방어막, 회복, 연타, 상태이상 등)
4. 스탯 vs 스킬 파워 분배 근거 (기초 스탯보다 고유 스킬 효과를 우선 살리는 근거)
5. 한 줄 명대사 (플레이버 텍스트) 및 비주얼 키워드

각 항목 1~3문장, 전체 700자 이내의 한국어 산문으로. 제목·인사말·JSON은 쓰지 않는다.`;

      let planText = '';
      try {
        planText = await callOllamaChat({
          messages: [
            { role: 'system', content: 'You are a master Anime TCG card designer. Analyze the character concept deeply in Korean: lore, combat style, innovative skill mechanics, and stat power budget reasoning.' },
            { role: 'user', content: brainstormPrompt }
          ],
          timeoutMs: 300000,   // 생각은 제한이 없으니 타임아웃이 유일한 상한 — 120초는 실측(2분+)에 못 미쳤다
          reasoningMode: 'deep',
          // 🧠 네이티브 thinking, 토큰 제한 없음(callOllamaChat이 think:true면 num_predict -1). 상한은 타임아웃만.
          //    🐛 예전엔 예산 1500(그 뒤 3072)이 걸려 있어 이 개방형 질문에 생각만 하다 잘려 본문 0자였고
          //       (thinking 11,623자·70초), 잘린 사고의 꼬리가 2단계에 "기획안"으로 붙었다 (DECISIONS #96).
          //    본문은 위 지시대로 700자 이내 기획 메모 — 생각은 자유, 메모는 짧게.
          think: true,
          format: null // 자유 서술형 기획 메모
        });
        deepPlanText = planText;
        window.__deepPlanText = planText;
      } catch (e) {
        console.warn('[Forge Deep] 1단계 자유 기획 생략, 직접 기획으로 진행:', e.message);
        window.__deepPlanError = e.message;
      }

      // ⚡ 2단계: 정형화 카드 데이터 변환 (JSON Structuring)
      if (loadingEl) {
        const t = loadingEl.querySelector('span');
        if (t) t.innerText = '⚡ 2/2단계: 추론된 기획안을 TCG 카드 데이터로 정형화 중...';
      }
      let cleanPlan = (planText && typeof planText === 'string') ? planText.trim() : '';
      if (cleanPlan.length > 3000) {
        cleanPlan = cleanPlan.slice(-2800);
      }
      const structuredPrompt = cleanPlan.length > 30
        ? `${userDirective}\n\n[1단계 심층 추론 및 기획안]\n${cleanPlan}\n\n위 기획안의 서사와 스킬을 충실히 반영하여, 아래 규격에 맞게 카드 데이터를 JSON으로 출력하세요:\nRandom Seed Nonce: ${nonceId}\n${systemPrompt}`
        : `${userDirective}\nRandom Seed Nonce: ${nonceId}\n${systemPrompt}`;

      const sysMsg = { role: 'system', content: 'You are an authentic TCG card designer. Output ONLY a single valid raw JSON object.' };
      cardData = await callOllamaChat({
        messages: [sysMsg, { role: 'user', content: structuredPrompt }],
        timeoutMs: 120000,
        reasoningMode: 'deep',
        think: false, // ⚡ 2단계는 고속 정형화이므로 think: false
        format: 'json'
      });
    } else {
      // ⚡ Fast 모드: 즉시 단일 호출로 고속 JSON 생성
      const basePrompt = `${userDirective}\nRandom Seed Nonce: ${nonceId}\n${systemPrompt}`;
      const sysMsg = { role: 'system', content: 'You are an authentic TCG card designer. Output ONLY a single valid raw JSON object.' };

      cardData = await callOllamaChat({
        messages: [sysMsg, { role: 'user', content: basePrompt }],
        timeoutMs: 120000,
        reasoningMode: 'fast',
        format: 'json'
      });
    }

    cardData = normalizeIncomingCardData(cardData);

    // 🔁 규칙 위반이면 **한 번만** 되묻는다.
    // 📜 유저가 적은 효과 설명은 지시가 아니라 **요구**다 — 언급한 효과가 필드에 없으면 규칙 위반과 같이 되묻는다 (DECISIONS #100)
    const problems = validateCardPlan(cardData, targetType).concat(validateRequestedEffects(custom.effectDesc, cardData));
    if (problems.length > 0) {
      console.info('[Forge] 규칙 위반 — LLM에게 재요청합니다:\n' + problems.map(p => ' • ' + p).join('\n'));
      if (loadingEl) {
        const t = loadingEl.querySelector('span');
        if (t) t.innerText = '🔁 규칙 위반을 고쳐 다시 기획 중...';
      }
      try {
        const sysMsg = { role: 'system', content: 'You are an authentic TCG card designer. Output ONLY a single valid raw JSON object.' };
        const basePrompt = `${userDirective}\nRandom Seed Nonce: ${nonceId}\n${systemPrompt}`;
        const retry = await callOllamaChat({
          messages: [sysMsg, { role: 'user', content: basePrompt + buildRetryDirective(problems) }],
          timeoutMs: 120000,
          reasoningMode: 'fast',
          think: false,
          format: 'json'
        });
        const normRetry = normalizeIncomingCardData(retry);
        const stillBad = validateCardPlan(normRetry, targetType).concat(validateRequestedEffects(custom.effectDesc, normRetry));
        if (stillBad.length < problems.length) cardData = normRetry;
        if (stillBad.length > 0) {
          console.info(`[Forge] 재요청 후에도 ${stillBad.length}건 남음 — 결정론적 보수로 처리합니다.`);
        }
      } catch (e) {
        console.warn('[Forge] 재요청 실패, 원본을 보수해서 씁니다:', e.message);
      }
    }

    await applyGeneratedCardData(cardData);

    // 🧠 UI에 실제 추론 과정(Reasoning Log) 표시
    const reasoningDetails = document.getElementById('forge-reasoning-details');
    const reasoningContent = document.getElementById('forge-reasoning-content');
    if (reasoningDetails && reasoningContent) {
      // 🐛 예전엔 `|| window.__lastReasoning`으로 폴백해 **빠른 모드** 카드에 이전 심층 실행의 사고 과정이 붙어 보였다.
      //    보이는 것은 이번 실행의 기획 메모만.
      const displayReasoning = deepPlanText;
      if (displayReasoning && typeof displayReasoning === 'string' && displayReasoning.trim().length > 10) {
        reasoningContent.textContent = displayReasoning.trim();
        reasoningDetails.classList.remove('hidden');
        reasoningDetails.open = true; // 🧠 유저가 모델의 심층 사고 과정을 바로 확인할 수 있도록 자동 펼침
      } else {
        reasoningDetails.classList.add('hidden');
        reasoningDetails.open = false;
      }
    }
  } catch (err) {
    console.error('LLM 생성 실패 상세 스택:', err);
    window.__lastForgeError = { message: err.message, stack: err.stack };
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

  const cost = rollCardCost(caps.costRange[1]);   // 💎 덱 커브 분포 (등급이 아니라 커브가 정한다)
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
    // 🏛️ 카드군 플레이스타일을 따르는 패시브. 설명문은 패시브 데이터에서 만든다 —
    //    🐛 수정: 예전 문구는 "아군에 방어막 부여"였는데 엔진은 **본체 방어막**을
    //       올린다. 하드코딩된 문장이 실제 동작과 달랐다.
    const structPassive = buildStructurePassive(inferPlaystyle(currentCardTheme || {}), rarity);
    if (structPassive.aura && structPassive.aura.scope === 'element' && !structPassive.aura.scopeValue) {
      structPassive.aura.scopeValue = matchedElement;
    }
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
        description: describeStructurePassive(structPassive),
        cost: cost,
        passiveEffect: structPassive
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

/**
 * 📦 LLM 응답 카드 데이터 사전 정규화:
 * - 최상위에 흩어진 flat 스킬 필드(damage, shield, heal, skillName 등)를 skill 객체로 결합
 * - skill이 문자열인 경우 { description: ... } 객체로 변환
 * - power, value, atk 등 동의어 필드를 damage 등으로 매핑
 */
export function normalizeIncomingCardData(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };

  let s = out.skill;
  if (Array.isArray(out.skills) && out.skills[0] && typeof out.skills[0] === 'object') {
    s = s || out.skills[0];
  } else if (out.ability && typeof out.ability === 'object') {
    s = s || out.ability;
  }

  if (typeof s === 'string') {
    s = { description: s };
  } else if (s && typeof s === 'object') {
    s = { ...s };
  } else {
    s = {};
  }

  // flat 필드가 최상위에 있다면 s로 통합
  if (out.skillName && !s.name) s.name = out.skillName;
  if (out.skillDesc && !s.description) s.description = out.skillDesc;
  if (out.damage !== undefined && s.damage === undefined) s.damage = out.damage;
  if (out.shield !== undefined && s.shield === undefined) s.shield = out.shield;
  if (out.heal !== undefined && s.heal === undefined) s.heal = out.heal;
  if (out.multiHit !== undefined && s.multiHit === undefined) s.multiHit = out.multiHit;
  if (out.drawCards !== undefined && s.drawCards === undefined) s.drawCards = out.drawCards;
  if (out.manaGain !== undefined && s.manaGain === undefined) s.manaGain = out.manaGain;
  if (out.statusEffect !== undefined && s.statusEffect === undefined) s.statusEffect = out.statusEffect;
  if (out.passiveEffect !== undefined && s.passiveEffect === undefined) s.passiveEffect = out.passiveEffect;
  if (out.destroy !== undefined && s.destroy === undefined) s.destroy = out.destroy;
  if (out.searchDeck !== undefined && s.searchDeck === undefined) s.searchDeck = out.searchDeck;
  if (out.summonToken !== undefined && s.summonToken === undefined) s.summonToken = out.summonToken;
  if (out.pierceShield !== undefined && s.pierceShield === undefined) s.pierceShield = out.pierceShield;
  if (out.doubleCastNext !== undefined && s.doubleCastNext === undefined) s.doubleCastNext = out.doubleCastNext;
  if (out.flavorText !== undefined && s.flavorText === undefined) s.flavorText = out.flavorText;
  if (out.isVanilla !== undefined && s.isVanilla === undefined) s.isVanilla = out.isVanilla;

  // 동의어 필드 보정
  if (s.damage === undefined) {
    if (s.power !== undefined) s.damage = s.power;
    else if (s.atk !== undefined) s.damage = s.atk;
    else if (s.value !== undefined && (s.effectType === 'damage' || !s.effectType)) s.damage = s.value;
  }
  if (s.shield === undefined && s.value !== undefined && s.effectType === 'shield') {
    s.shield = s.value;
  }
  if (s.heal === undefined && s.value !== undefined && s.effectType === 'heal') {
    s.heal = s.value;
  }

  // ⚠️ 여기서 효과를 **지어내지 않는다.** 예전 정리 전 코드는 isVanilla를 강제로 끄고, 효과가 없으면 설명문에서
  //    정규식으로 숫자를 뽑거나 등급별 기본 피해(10~22)를 넣었다 — 규칙 35(정산 뒤 효과 되살리기 금지)·81(자연어
  //    정규식 수리 금지) 위반이고, 모든 소환수가 "피해 N" 카드로 균질화된다(#85). 효과가 없으면 바닐라가 맞다.
  //    이 함수의 일은 **모양 맞추기**(flat → skill 객체, 동의어)뿐이다 (DECISIONS #97).

  out.skill = s;
  out.skills = [s];
  return out;
}

export async function applyGeneratedCardData(rawData) {
  // 🎛️ 사전 정규화 후 사용자 지정 값을 덮어쓰고 밸런스 검증(등급·마나 예산)을 태운다.
  const normalized = normalizeIncomingCardData(rawData);
  lastPlanRaw = normalized;   // ⚖️ 옵션(예산 초과 허용 등)을 바꾸면 LLM을 다시 부르지 않고 이 기획에 다시 적용한다
  const overrides = readCustomOverrides();
  // 🎭 굴린 성향에 안 맞는 효과는 뺀다 (유저가 효과를 적었으면 성향 없음 → 그대로). 🪤 굴린 함정 조건은 강제.
  if (forgeEffectRole && !overrides.effectDesc && normalized.skill) {
    const shaped = enforceEffectRole(normalized.skill, forgeEffectRole);
    normalized.skill = shaped.skill; normalized.skills = [shaped.skill];
    if (shaped.removed.length) console.info(`[Forge] 성향(${forgeEffectRole})에 맞춰 뺀 효과: ${shaped.removed.join(', ')}`);
  }
  if (forgeTrapPlan && !overrides.trapTrigger) { overrides.trapTrigger = forgeTrapPlan.trapTrigger; overrides.trapCondition = forgeTrapPlan.condition ? Object.values(forgeTrapPlan.condition)[0] : null; }
  const data = sanitizeAndClampCardData(applyCustomOverrides(normalized, overrides));
  // 📐 정산을 마친 수치를 기억한다 — 저장이 다시 굴리지 않고 이 값을 쓴다 (DECISIONS #93)
  currentPlannedStats = pickPlannedStats(data);
  // 💎 예산 초과분(파워 단위) — 가루 소모량 표시·결제의 근거 (DECISIONS #100)
  currentPowerDebt = data.powerDebt || 0;
  renderForgeDustCost();
  // 🔒 유저가 직접 친 이름(data-by-user)은 덮어쓰지 않는다. AI가 채운 이름은 표시를 지워 다음 기획이 자유롭게 바꾼다.
  const nameEl = document.getElementById('forge-name');
  if (nameEl && data.name && nameEl.dataset.byUser !== '1') { nameEl.value = data.name; nameEl.dataset.byUser = ''; }
  if (data.title) {
    const titleEl = document.getElementById('forge-title');
    if (titleEl) titleEl.value = data.title;
  }
  // 🎲 확정 속성은 모듈 변수에만 담는다. #forge-element(유저 의도)에 되쓰면 "AI 결정"이 한 번 기획하는 것만으로
  //    고정값으로 변한다 — 등급과 같은 함정 (DECISIONS #92/#98)
  if (data.element) currentForgeElement = data.element;
  // ⭐ 확정 등급은 모듈 변수에만 담는다. #forge-rarity(유저 의도)를 되쓰면
  //    "AI 결정"이 한 번 기획하는 것만으로 고정값으로 변한다 → DECISIONS #92
  if (data.rarity) currentForgeRarity = data.rarity;
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
  const targetElem = data.element || forgeElement();
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
    if (!parsedSkill.name || !parsedSkill.name.trim()) {
      parsedSkill.name = `${data.name || '영웅'}의 비기`;
    }
    if (typeof parsedSkill.multiHit === 'number') {
      parsedSkill.multiHit = Math.min(3, Math.max(1, Math.round(parsedSkill.multiHit)));
    }
    if (parsedSkill.description) {
      parsedSkill.description = parsedSkill.description.replace(/(\d+단[,\s]*){3,}/g, '').trim();
    }
  }

  // 테마/카드군 매칭 또는 신규 테마 자동 등록 및 DB 누적
  let matchedTheme = null;

  // ⚜️ 이미 소속이 정해진 카드는 제안기를 태우지 않는다.
  //    `themeId`가 실재하는 카드군을 가리키면 그게 소속의 **권위**다 (DECISIONS #17).
  //    proposeArchetype/registerNewArchetype은 이름·키워드 유사도로 다른 카드군에
  //    병합하거나 재명명할 수 있고, 유저가 넣은 키워드를 그 카드군의 seeds에 심는다.
  //    → 키워드만 바꿨는데 소속이 따라 움직인다. 그래서 여기서 끊는다.
  const pinnedTheme = data.themeId
    ? (state.archetypesList || []).find(a => a && a.id === data.themeId) || null
    : null;

  if (pinnedTheme) {
    matchedTheme = pinnedTheme;
    console.log(`[Archetype] pinned: themeId "${data.themeId}" → [${pinnedTheme.name}] (키워드 변경과 무관하게 소속 고정)`);
  } else if (data.themeName) {
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
      playstyle: data.themePlaystyle,        // 🎭 LLM이 고른 플레이스타일
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
  const element = forgeElement();
  const cardType = currentForgeCardType || 'unit';
  
  const currentPrompt = promptInput.value.trim();
  const expanded = expandDanbooruTags(currentPrompt || '1girl, fantasy anime', element, cardType, 28);
  promptInput.value = expanded;
  updateForgePromptPreview();
  audio.playMagic();
}

export function updateForgePromptPreview() {
  const element = forgeElement();
  const rarity = forgeRarity();
  renderForgeRarityHint();
  // 🖼️ 해상도 셀렉트는 설정값의 화면이다 (팩·설정 모달과 한 값을 공유한다).
  //    onchange가 설정에 저장하므로 여기서 되읽는 것은 멱등하다.
  const resSel = document.getElementById('forge-resolution');
  if (resSel && state.settings.resolution && [...resSel.options].some(o => o.value === state.settings.resolution)) {
    resSel.value = state.settings.resolution;
  }
  const name = document.getElementById('forge-name') ? (document.getElementById('forge-name').value.trim() || '이름 없는 영웅') : '이름 없는 영웅';
  const prompt = document.getElementById('forge-prompt') ? (document.getElementById('forge-prompt').value.trim() || 'masterpiece, fantasy') : 'masterpiece, fantasy';
  const cardType = currentForgeCardType || 'unit';

  // 📐 기획이 끝났으면 미리보기도 **정산된 수치**를 보인다. 등급 공식으로 그리면
  //    미리보기(28/12/40)와 저장될 카드(14/6/26)가 다르다 — 화면이 거짓 약속을 한다.
  const planned = currentPlannedStats || {};
  const stat = (key, fallback) => Number.isFinite(planned[key]) ? planned[key] : fallback;
  const mockCard = {
    id: 'preview',
    cardType: cardType,
    name: name,
    element: element,
    rarity: rarity,
    cost: stat('cost', cardType === 'spell' ? 2 : (rarity === 'legendary' ? 4 : (rarity === 'epic' ? 3 : 2))),
    attack: stat('attack', cardType === 'spell' || cardType === 'structure' || cardType === 'trap' ? 0 : (rarity === 'legendary' ? 28 : (rarity === 'epic' ? 20 : 14))),
    defense: stat('defense', cardType === 'spell' || cardType === 'trap' ? 0 : (rarity === 'legendary' ? 12 : 8)),
    hp: stat('hp', cardType === 'spell' || cardType === 'trap' ? 0 : (cardType === 'structure' ? 45 : (rarity === 'legendary' ? 40 : 30))),
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

  if (!ensureDustForPlan()) return;
  const name = document.getElementById('forge-name').value.trim() || '환상의 정령사';
  const element = forgeElement();
  const rarity = forgeRarity();
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

    // 🖼️ 🐛 수정: #forge-resolution 셀렉트를 **아무 코드도 읽지 않았다.** 뭘 골라도 설정값이
    //    쓰였고, 라벨은 square-normal을 1024x1024라 적어 두 번 거짓말했다 (실제 640).
    //    팩(card-pack.js)과 같은 규칙으로 맞춘다: 화면의 셀렉트 > 설정값.
    const resSel = document.getElementById('forge-resolution');
    const imageUrl = await generateNovelAIImage({
      prompt: promptToSend,
      resolution: (resSel && resSel.value) || state.settings.resolution || 'square-normal'
    });

    await completeForgedCard(name, element, rarity, userPrompt, imageUrl);
    renderFinalPromptPanel();
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
  if (!ensureDustForPlan()) return;
  const name = document.getElementById('forge-name').value.trim() || '환상의 정령사';
  const element = forgeElement();
  const rarity = forgeRarity();
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

  // 📐 수치 우선순위: 기획이 정산한 값 > 세부사항에 유저가 직접 쓴 값 > 캡에서 추첨.
  //    기획을 거쳤으면 planned에 유저 지정값이 이미 들어 있다(applyCustomOverrides → sanitize).
  //    기획을 건너뛰고 바로 생성해도 세부사항 칸은 존중한다.
  //    🐛 수정: 예전에는 무조건 캡에서 다시 굴려, 기획 화면의 카드와 저장된 카드가 달랐다.
  //    마지막 sanitizeAndClampCardData가 어차피 캡으로 자르므로 여기서 캡을 다시 볼 필요는 없다.
  const custom = readCustomOverrides();
  const planned = currentPlannedStats || {};
  const src = {};                                   // 수치 출처 — 건축물 보정은 추첨값에만 건다
  const settle = (key, roll) => {
    if (Number.isFinite(planned[key])) { src[key] = 'planned'; return planned[key]; }
    if (custom[key] !== null && custom[key] !== undefined) { src[key] = 'custom'; return custom[key]; }
    src[key] = 'roll'; return roll();
  };
  const rollIn = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));

  const cost = settle('cost', () => rollCardCost(caps.costRange[1]));   // 💎 덱 커브 분포 (등급이 아니라 커브가 정한다)
  let atk = settle('attack', () => rollIn(caps.atkRange));
  let def = settle('defense', () => rollIn(caps.defRange));
  let hp = settle('hp', () => rollIn(caps.hpRange));
  const spellDmg = rollIn(caps.spellDamage);
  console.log(`[Forge] 수치 출처 cost=${src.cost} atk=${src.attack} def=${src.defense} hp=${src.hp}`);

  if (cardType === 'spell') {
    atk = 0;
    def = 0;
    hp = 0;
  } else if (cardType === 'structure') {
    atk = 0;
    // 건축물 보정(×1.3)은 **추첨값에만** — 기획·지정값은 이미 최종 수치다
    if (src.defense === 'roll') def = Math.floor(def * 1.3);
    if (src.hp === 'roll') hp = Math.floor(hp * 1.3);
  }

  const optimizedImg = await optimizeCardImage(imageUrl);

  // ⚠️ 이미 예산 정산을 통과한 스킬(currentLLMSkillData)은 **그대로 쓴다.**
  //    🐛 예전에는 `damage: atk` 같은 기본값 위에 스프레드했다. 정산이 피해를
  //       지운 카드(damage 키 자체가 사라진 경우)에서는 그 기본값이 살아남아
  //       **공격력이 피해로 다시 주입되고**, 저장 시점 재검사에서 또 잘렸다.
  //       "기획 때 통과한 카드가 이미지 생성에서 망가진다"의 원인 중 하나다.
  const skillObj = currentLLMSkillData ? {
    ...currentLLMSkillData,
    name: currentLLMSkillData.name || `${name}의 비기`,
    description: currentLLMSkillData.description || `${name}의 효과를 발동합니다.`,
    cost: cost
  } : (cardType === 'unit'
    // 🃏 기획 없이 만든 소환수는 바닐라다. 🐛 예전엔 `damage: atk`를 지어 넣어 모든 소환수가 피해 카드가 됐다 (규칙 35, #102)
    ? { name: `${name}의 비기`, description: '', cost: cost, isVanilla: true, flavorText: `${name}, 전장에 서다.` }
    : {
      name: `${name}의 비기`,
      description: `${name}의 효과를 발동합니다.`,
      cost: cost,
      damage: spellDmg
    });

  const finalTheme = currentCardTheme || findMatchingArchetype(name, element);

  // 🎨 카드 속성을 카드군 정책에 맞춘다.
  // "홍련(화염) 카드군"에 물 속성 카드가 섞이면 카드군 정체성이 무너진다.
  const elementFix = coerceCardElement(finalTheme, element);
  const finalElement = elementFix.element;
  if (elementFix.changed) {
    console.log(`[Element] ${elementFix.reason} → ${finalElement}로 교정`);
  }

  // 🧬 종족 정제 — 속성과 달리 **갈아치우지 않는다.** 잘못된 키만 버리고,
  //    카드군이 종족을 밝혔는데 카드가 비었을 때만 대표 종족을 채운다 (races.js 머리말).
  const raceFix = coerceCardRaces(finalTheme, data);
  const finalRaces = raceFix.races;
  if (raceFix.changed) console.log('[Race] ' + raceFix.reason);

  // 🏛️ 건축물에 지속 패시브를 보장한다.
  //    🐛 수정: 이 AI 경로는 passiveEffect를 **한 번도 넣지 않았다.** 프롬프트에
  //       패시브 필드가 없으니 LLM도 안 만들었고, 결과적으로 AI로 만든 건축물은
  //       공격 0 + 매 턴 아무 일도 없는 순수한 벽이었다.
  //       (폴백 경로에만 패시브가 있어서 "가끔 되는" 것처럼 보였다.)
  //    ⚠️ 속성 교정 **뒤에** 둔다 — 어둠 카드군에 화염 패시브가 붙지 않도록.
  if (cardType === 'structure') {
    // LLM이 설계한 패시브가 우선. 다듬어서 못 쓸 것만 걸러낸다.
    // 아무것도 없으면 **카드군 플레이스타일**을 따라 폴백을 만든다.
    // (속성으로 정하던 예전 방식은 자유도를 죽였다 — DECISIONS #67)
    const llmPassive = normalizeStructurePassive(skillObj.passiveEffect, rarity);
    skillObj.passiveEffect = llmPassive
      || buildStructurePassive(inferPlaystyle(finalTheme || {}), rarity);
    // 오라의 속성 범위가 비어 있으면 이 카드의 속성으로 채운다
    if (skillObj.passiveEffect.aura && skillObj.passiveEffect.aura.scope === 'element'
        && !skillObj.passiveEffect.aura.scopeValue) {
      skillObj.passiveEffect.aura.scopeValue = finalElement;
    }
    skillObj.description = describeStructurePassive(skillObj.passiveEffect);
  }

  // 🔒 유저가 직접 친 이름은 아래 교정·키워드 삽입을 모두 건너뛴다 — "내가 쓴 이름을 무시한다"의 마지막 지점 (DECISIONS #100)
  const nameLocked = !!custom.name;
  // 🏷️ 타입에 안 맞는 이름 교정 (건축물에 소환수 이름이 붙는 문제)
  let typedName = name;
  if (!nameLocked && !nameMatchesType(typedName, cardType)) {
    const fixed = fixCardName(typedName, cardType);
    console.log(`[작명] ${cardType} 이름 교정: "${typedName}" → "${fixed}"`);
    typedName = fixed;
  }
  // 🏷️ 카드군 소속 카드는 이름에 키워드를 포함해야 덱 서치 콤보가 잡아낸다 (유저 이름은 예외)
  const finalName = nameLocked ? typedName : enforceKeywordInName(typedName, finalTheme, cardType);

  const rawCard = {
    // ⚖️ 예산 초과 허용 카드는 저장 시 재정산·다음 부팅의 재검사에서도 깎이지 않아야 한다 — 플래그를 카드에 남긴다
    allowOverBudget: !!custom.allowOverBudget,
    // 💎 코스트는 미리 정해 LLM에 넘긴 값이다.
    //    예산이 이걸 올리거나 내리지 않고 **내용을 깎아서** 맞춘다.
    costLocked: true,
    id: `custom-${Date.now()}`,
    cardType: cardType,
    name: finalName,
    title: `${rarity.toUpperCase()} ${cardType.toUpperCase()}`,
    element: finalElement,
    races: finalRaces,
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
  // 💎 예산 초과분 결제 — 잔액은 생성 전에 확인했지만(ensureDustForPlan) 최종 정산값으로 한 번 더 본다
  const dustNeed = dustForExcessPower(newCard.powerDebt || 0);
  if (dustNeed > 0) {
    const paid = await spendDust(dustNeed);
    if (!paid.ok) {
      alert(`💎 가루가 부족해 카드를 저장하지 못했습니다 (필요 ${dustNeed} / 보유 ${getDust()}).`);
      return;
    }
    newCard.dustPaid = dustNeed;
    console.log(`[Dust] -${dustNeed} (예산 초과 ${newCard.powerDebt}) — 보유 ${paid.remaining}`);
    const dustEl = document.getElementById('dust-amount');
    if (dustEl) dustEl.innerText = getDust().toLocaleString('ko-KR');
  }

  // ✍️ 2단계 — **확정된 수치**로 설명문을 다시 쓴다.
  //    1단계 설명문은 예산 정산 전 수치 기준이라 깎인 뒤에는 어긋난다.
  //    ⚠️ 실패하면 아무것도 안 한다 — sanitize가 맞춰둔 문장이 이미 정확하다.
  //    LLM이 만든 카드일 때만 시도한다 (오프라인 폴백은 이미 데이터 생성 문장).
  if (currentLLMSkillData) {
    await applyLlmDescription(newCard, { timeoutMs: 45000 });
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
