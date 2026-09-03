// ai-service.js - 통합 AI 연동 서비스 (Ollama LLM & DanTagGen & NovelAI Diffusion V4.5)

import { state } from './storage.js';
import { expandDanbooruTags } from './dan-tag-gen.js';
import { expandTagsDetailed } from './tag-slm.js';

/**
 * ⚡ 로컬 Ollama 서버 가동 여부 확인 (12초 타임아웃)
 */
export async function checkOllamaOnline(timeoutMs = 12000) {
  const candidates = [
    state.settings.llmUrl || 'http://127.0.0.1:11434',
    'http://127.0.0.1:11434',
    'http://localhost:11434'
  ];
  
  for (const url of new Set(candidates)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(`${url}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        state.settings.llmUrl = url;
        return true;
      }
    } catch (e) {}
  }
  return false;
}

export async function getInstalledOllamaModels(baseUrl = 'http://127.0.0.1:11434') {
  try {
    const resp = await fetch(`${baseUrl}/api/tags`);
    if (resp.ok) {
      const data = await resp.json();
      return (data.models || []).map(m => m.name);
    }
  } catch (e) {}
  return [];
}


// ============================================================
// 🧬 모델 계열별 프로파일
// ------------------------------------------------------------
// 채팅 템플릿의 종료 토큰과 thinking 지원 여부는 모델 계열마다 다르다.
// 종료 토큰이 안 걸리면 모델이 JSON 뒤에 잡설을 계속 붙여 파싱이 흔들리므로,
// 모델을 교체할 때 여기 한 곳만 고치면 되도록 모아 둔다.
// ============================================================
const MODEL_PROFILES = [
  {
    match: /qwen|qwq/i,
    stop: ['<|im_end|>', '<|endoftext|>'],
    thinking: true            // Qwen 3 계열은 think 파라미터 지원
  },
  {
    match: /gemma/i,
    stop: ['<end_of_turn>', '<eos>'],
    thinking: false           // Gemma는 thinking 모드 없음
  },
  {
    match: /llama|mistral|phi/i,
    stop: ['<|eot_id|>', '</s>'],
    thinking: false
  }
];

// 계열을 못 찾으면 stop을 비워 둔다.
// (Ollama가 모델 템플릿의 기본 종료 토큰을 쓰므로 빈 배열이 잘못된 토큰보다 안전하다)
const DEFAULT_PROFILE = { stop: [], thinking: false };

function getModelProfile(modelName = '') {
  return MODEL_PROFILES.find(p => p.match.test(modelName)) || DEFAULT_PROFILE;
}

export function supportsThinking(modelName = '') {
  return !!getModelProfile(modelName).thinking;
}
/**
 * 🤖 로컬 Ollama /api/chat 호출 및 클린 JSON 추출
 * 넉넉한 300초(5분) 심층 추론 타임아웃
 */
export async function callOllamaChat({ messages, model = null, temperature = 0.7, timeoutMs = 300000, reasoningMode = null, format = 'json', think = undefined, _formatRetry = false, _parseJson = false }) {
  const baseUrl = state.settings.llmUrl || 'http://127.0.0.1:11434';
  let targetModel = model || state.settings.llmModel || 'qwen3.5:4b';
  const mode = reasoningMode || state.settings.reasoningMode || 'fast';
  const isDeep = mode === 'deep';
  
  // 1. 현재 로컬 Ollama에 설치된 실제 모델 목록 확인
  const installed = await getInstalledOllamaModels(baseUrl);
  if (installed.length > 0) {
    const exactMatch = installed.find(m => m === targetModel || m.startsWith(targetModel + ':') || targetModel.startsWith(m + ':'));
    if (!exactMatch) {
      // 지정된 허깅페이스 모델을 아직 다운받지 않았을 경우 로컬에 있는 모델(qwen3.5:4b 등)로 자동 연결
      const fallback = installed.find(m => m.includes('qwen') || m.includes('3.5') || m.includes('2.5')) || installed[0];
      console.warn(`[Ollama] 모델 '${targetModel}'이(가) 다운로드되지 않아 설치된 '${fallback}'(으)로 자동 연결합니다.`);
      targetModel = fallback;
    } else {
      targetModel = exactMatch;
    }
  }

  // 🧠 생각(thinking)과 JSON 출력은 **한 호출에 같이 쓰지 않는다.**
  //    🐛 Qwen3.5는 think:true + format:json이면 num_predict 예산을 전부 thinking에 쓰고 content가 **빈 채**
  //       done_reason:'length'로 끝난다 (실측 2026-09-03: 예산 400·700 모두 content 0자, thinking 1.2~2.4천 자).
  //       코드는 그 thinking 텍스트를 JSON으로 파싱하려다 "JSON 파싱 실패"를 냈다 — 추론 모드의
  //       카드팩·보스 연성·프로필처럼 think를 안 넘긴 호출이 전부 이 길이었다. (DECISIONS #96)
  //    → JSON 호출은 항상 think:false. 심층 추론은 **두 단계**로 나눈다:
  //       1) think:true · **토큰 제한 해제**(num_predict -1, 타임아웃만) · 자유 서술 — 모델이 원하는 만큼 생각한 뒤
  //          짧은 기획 메모를 본문으로 쓴다 (유저 설계: "심층 추론은 추론을 허용하고 토큰 제한도 푼 것")
  //       2) 그 메모(없으면 생각 자체)를 붙여 think:false · JSON 정형화.
  //    ⚠️ 1단계에 상한을 두면 안 된다. Qwen3.5-4B의 생각은 개방형 기획 질문에 3072토큰을 넘긴다 —
  //       예산 1500(옛 코드)·3072(중간 시도) 모두 생각만 하다 잘려 본문 0자였다 (실측: thinking 11,623자, 70초).
  //       1단계가 타임아웃·오류로 죽어도 판을 접지 않는다 — 기획 없이 2단계로 간다.
  const wantsThinking = think === true || (think === undefined && isDeep && supportsThinking(targetModel));
  if (format && wantsThinking) {
    let planText = '';
    try {
      // 1단계는 요청의 **머리**(팩 테마·속성·타입·콘셉트)만 본다. 규격·규칙 전문(5~15k자)까지 주면 이 모델은
      // 300초 안에 생각을 끝내지 못한다 (실측: 팩 규격 프롬프트 → 타임아웃 → 기획 없이 2단계). 연성 1단계의
      // 짧은 브레인스토밍 프롬프트(376자)는 126~148초에 끝났다. 규격은 2단계(JSON)가 온전히 받는다.
      const planMessages = appendToLastUserMessage(headOfLastUserMessage(messages, DEEP_PLAN_HEAD_CHARS), DEEP_PLAN_DIRECTIVE);
      const plan = await callOllamaChat({
        messages: planMessages, model: targetModel, temperature, timeoutMs, reasoningMode: 'deep', think: true, format: null
      });
      planText = (typeof plan === 'string') ? plan.trim() : '';
    } catch (e) {
      console.warn('[Ollama] 심층 1단계(생각) 실패 — 기획 없이 정형화 단계로 진행:', e.message);
    }
    if (planText.length > 3000) planText = planText.slice(0, 2800);
    if (planText) window.__lastPlan = planText;
    const withPlan = planText.length > 30 ? appendToLastUserMessage(messages,
      `\n\n[1단계 기획 메모 — 이 내용을 충실히 반영하되, 지금은 위 규격의 JSON 객체 하나만 출력할 것]\n${planText}`) : messages;
    return callOllamaChat({
      messages: withPlan, model: targetModel, temperature, timeoutMs, reasoningMode: 'deep', think: false, format
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 🧠 심층 추론(Reasoning) vs 초고속(Fast) 지시 주입
  const systemContent = isDeep
    ? 'You are a creative Anime TCG card designer. Think deeply about character lore, archetype, and balanced skill effects, then output the result.'
    : 'You are a fast, precise Anime TCG card designer. Output the valid raw JSON object directly without overthinking.';

  const optimizedMessages = [
    { role: 'system', content: systemContent },
    ...messages.filter(m => m.role !== 'system')
  ];

  const effectiveTemp = (temperature !== null && temperature !== undefined) ? temperature : (isDeep ? 0.85 : 0.8);
  const randomSeed = Math.floor(Math.random() * 2147483647);
  const STOP_TOKENS = getModelProfile(targetModel).stop;

  try {
    const bodyPayload = {
      model: targetModel,
      messages: optimizedMessages,
      stream: false,
      options: {
        temperature: effectiveTemp,
        top_p: 0.9,
        top_k: 50,
        presence_penalty: 0,
        frequency_penalty: 0,
        repeat_penalty: 1.05,
        seed: randomSeed,
        repeat_last_n: 64,
        num_ctx: 16384,
        // 🧠 생각(think:true)은 **제한 없음**(-1) — 심층 추론의 설계다. 상한은 timeoutMs(기본 300초)만.
        //    🐛 예전엔 1500이었다 — Qwen3.5-4B는 생각만 3천 토큰을 넘겨 본문을 쓰기 전에 잘렸다 (DECISIONS #96).
        //    JSON은 생각을 끄므로 예산 전부가 본문이다. 보스 연성(콤보 3패턴)처럼 긴 JSON도 1024를 넘길 수 있어 2048.
        num_predict: (think === true) ? -1 : 2048,
        stop: STOP_TOKENS
      }
    };

    if (format) {
      bodyPayload.format = format;
    }

    // 🧠 생각(Thinking) 모드 제어 — 위 분기 덕에 여기 오는 JSON 호출은 늘 think:false다.
    //    명시값이 있으면 그것을, 없으면 (자유 서술 + deep + 지원 모델)일 때만 true.
    //    ⚠️ 생각을 지원하는 모델에는 **반드시 false를 명시**한다 — Qwen3.5는 기본값이 "생각함"이라
    //       필드를 빼면 위 버그가 그대로 돌아온다 (실측: think 생략 + json → content 0자).
    if (think !== undefined) {
      bodyPayload.think = !!think;
    } else if (supportsThinking(targetModel)) {
      bodyPayload.think = !format && isDeep;
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(bodyPayload)
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // 🛡️ Ollama 0.33의 JSON 문법 강제(format)는 모델 출력이 문법과 어긋나면 **서버가 500**을 낸다
      //    ("The model produced output that does not match the expected peg-native format"). 간헐적이며 모델 탓이다.
      //    같은 요청을 format 없이 한 번 다시 보내고, 우리 복구 파서(repairAndParseJson)가 JSON을 건진다.
      //    🐛 예전엔 여기서 그대로 던져 팩·연성이 랜덤 생성기로 떨어졌다 (DECISIONS #96).
      if (format && response.status >= 500 && !_formatRetry) {
        console.warn(`[Ollama] format=${format} 응답이 HTTP ${response.status} — format 없이 1회 재시도:`, errText.slice(0, 160));
        return callOllamaChat({
          messages: appendToLastUserMessage(messages, '\n\n(출력은 JSON 객체 하나만. 설명·코드펜스 없이.)'),
          model: targetModel, temperature, timeoutMs, reasoningMode: mode, think: false, format: null, _formatRetry: true, _parseJson: true
        });
      }
      throw new Error(`Ollama HTTP ${response.status} 응답 오류 (모델: ${targetModel}): ${errText}`);
    }

    const data = await response.json();
    const thinkingText = (data.message && data.message.thinking) ? data.message.thinking.trim() : '';
    if (thinkingText) {
      console.log('%c🧠 [Qwen 3.5 카드 설계 추론 과정 (Reasoning)]', 'color: #a855f7; font-weight: bold; font-size: 13px;\n', thinkingText);
      window.__lastReasoning = thinkingText;
    }

    let raw = (data.message && data.message.content) ? data.message.content.trim() : '';
    if (!raw && data.response) raw = data.response.trim();

    // format이 없으면 자유 텍스트를 그대로 반환 (추론 1단계 등).
    // 🐛 예전엔 thinking을 **우선** 돌려줬다 — 모델이 생각을 끝내고 정리해 쓴 본문(진짜 기획안)을 버리고
    //    중언부언하는 사고 과정을 2단계 프롬프트에 붙였다. 본문이 비었을 때만 생각을 대신 쓴다.
    if (!format) {
      // format 500 재시도로 들어온 호출은 자유 텍스트에서 JSON을 건진다
      if (_parseJson) return repairAndParseJson(raw || thinkingText);
      return raw || thinkingText;
    }

    // format이 json인데 본문이 비고 thinking에 json 블록이 있는 경우 보정
    if (!raw && thinkingText) {
      const cb = thinkingText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      raw = cb ? cb[0] : thinkingText;
    }

    return repairAndParseJson(raw);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * 🧠 심층 추론 1단계 지시문 — 생각은 자유롭게(think:true·제한 없음), **본문**은 짧은 기획 메모.
 * JSON 요청 프롬프트 뒤에 붙여 "아직 JSON은 말고 메모부터". 본문 길이를 못 박아야 2단계 프롬프트가 비대해지지 않는다 (DECISIONS #96).
 */
export const DEEP_PLAN_DIRECTIVE = `

[1단계 · 기획 메모] 아직 JSON을 출력하지 마라. 충분히 생각한 뒤, 위 요청을 설계하는 **기획 메모**를 한국어 산문으로만 쓴다:
1) 콘셉트와 서사 — 이 카드가 누구/무엇이며 어떤 장면인가 (1~2문장)
2) 전투 스타일과 핵심 효과 — 어떤 효과를 어떤 수치로 넣을지, 왜 그 수치인지 (2~3문장)
3) 스탯 vs 효과 예산 배분 — 어느 쪽을 살리고 어느 쪽을 깎는지 근거 (1~2문장)
4) 이름 후보 2개와 플레이버 한 줄
전체 600자 이내. 목록 번호만 쓰고 제목·인사말·JSON은 쓰지 않는다.`;

/** 심층 1단계가 보는 요청 머리 길이 — 콘셉트는 프롬프트 앞머리에 있고, 뒤는 JSON 규격·규칙이다 */
const DEEP_PLAN_HEAD_CHARS = 900;

/** 마지막 user 메시지를 앞 n자로 자른 사본 (잘렸으면 표시) — 심층 1단계용 */
function headOfLastUserMessage(messages, n) {
  const out = messages.map(m => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      const c = String(out[i].content || '');
      if (c.length > n) out[i].content = c.slice(0, n) + '\n…(출력 규격은 다음 단계에서 준다)';
      return out;
    }
  }
  return out;
}

/** 마지막 user 메시지 뒤에 텍스트를 붙인 사본 (원본 배열은 건드리지 않는다) */
function appendToLastUserMessage(messages, text) {
  const out = messages.map(m => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') { out[i].content = `${out[i].content}${text}`; return out; }
  }
  out.push({ role: 'user', content: text.trim() });
  return out;
}

/**
 * 🛠️ 불완전/미완료 JSON 자동 복구 및 안전 파서
 */
export function repairAndParseJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('JSON 파싱 실패: 응답 문자열이 비어 있습니다.');
  }

  // 0. 마크다운 코드블록(```json ... ```)이 있으면 최우선 추출
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let text = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  // 1. 추론/생각 태그 및 사고 과정 헤더 제거
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  // 미닫힘 <think>... 태그가 남아있다면 제거
  text = text.replace(/<think>[\s\S]*$/i, '');
  // Ollama가 message.thinking을 분리하지 못했거나 Thinking Process 헤더가 있는 경우 정리
  text = text.replace(/^Thinking Process:[\s\S]*?(?=(?:```|\{|\n\s*\{))/i, '').trim();

  // 비정상적 숫자/단어 무한 반복 루프 필터링 (예: 1단, 2단, 3단...)
  text = text.replace(/(\d+단[,\s]*){3,}/g, '');

  // 1단계: 순수 JSON 직렬화 시도 (이미 깨끗한 경우 즉시 반환)
  try {
    return JSON.parse(text);
  } catch (e) {}

  // 2단계: 문자열 내 다중 객체 중 실제 카드/보스 객체 블록 탐색
  // (사고 과정 등에 예시 조각 {"cardType": "unit"} 등이 섞여 있어도 진짜 카드 객체를 식별)
  const extractBalancedObjects = (str) => {
    const objs = [];
    let depth = 0;
    let start = -1;
    let inQuote = false;
    let esc = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inQuote = !inQuote; continue; }
      if (!inQuote) {
        if (c === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (c === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            objs.push(str.slice(start, i + 1));
            start = -1;
          }
        }
      }
    }
    return objs;
  };

  const candidateBlocks = extractBalancedObjects(text);
  // 카드 객체일 가능성이 가장 높은 블록 찾기 ("name" 및 "cardType" 또는 "skill" 보유)
  const bestBlock = candidateBlocks.find(b => (b.includes('"name"') && (b.includes('"cardType"') || b.includes('"skill"') || b.includes('"attack"'))))
    || candidateBlocks[candidateBlocks.length - 1] // 마지막 블록이 보통 최종 출력
    || null;

  let targetJsonStr = bestBlock || text;

  // 타겟에서 정상 파싱 재시도
  try {
    return JSON.parse(targetJsonStr);
  } catch (e) {}

  // 3단계: 문법적 결함 복구 (후행 콤마, 따옴표 내 개행, 미닫힘 따옴표 및 괄호 수리)
  try {
    let sub = targetJsonStr;
    const firstBrace = sub.indexOf('{');
    if (firstBrace !== -1) sub = sub.slice(firstBrace);

    // 따옴표 바깥의 오타 마침표 제거
    sub = sub.replace(/"\s*\.\s*(?=[\n,\]\}])/g, '"');
    // 단일따옴표 감싸기 제거
    sub = sub.replace(/:\s*'([^']+)'/g, ': "$1"');
    // 후행 콤마 제거 (, } -> } 및 , ] -> ])
    sub = sub.replace(/,\s*([\}\]])/g, '$1');

    let inQuote = false;
    let escaped = false;
    let openBraces = 0;
    let openBrackets = 0;

    for (let i = 0; i < sub.length; i++) {
      const c = sub[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inQuote = !inQuote; continue; }
      if (!inQuote) {
        if (c === '{') openBraces++;
        else if (c === '}') openBraces--;
        else if (c === '[') openBrackets++;
        else if (c === ']') openBrackets--;
      }
    }

    if (inQuote) sub += '"';
    while (openBrackets > 0) { sub += ']'; openBrackets--; }
    while (openBraces > 0) { sub += '}'; openBraces--; }
    sub = sub.replace(/,\s*([\}\]])/g, '$1');

    return JSON.parse(sub);
  } catch (err) {
    console.warn('[JSON Parser] 표준 복구 실패 -> 스마트 AST 추출기로 완벽 복구 시도:', err.message);
  }

  // 4단계: 🛡️ 스마트 정규식 카드/보스 AST 추출기 (JSON 구조가 파괴되어도 효과/스탯 100% 보존)
  try {
    const getStr = (pattern, def = '') => {
      const m = text.match(pattern);
      if (m && m[1]) return m[1].replace(/^['"\\]+|['"\\]+$/g, '').trim();
      return def;
    };
    const getNum = (pattern, def = 0) => {
      const m = text.match(pattern);
      if (m && m[1]) return parseInt(m[1], 10) || def;
      return def;
    };
    const getBool = (pattern, def = false) => {
      const m = text.match(pattern);
      if (m && m[1]) return /true/i.test(m[1]);
      return def;
    };

    const extractedName = getStr(/"name"\s*:\s*["']?([^",\n\}]+)/i, '');
    if (extractedName) {
      return {
        name: extractedName,
        title: getStr(/"title"\s*:\s*["']?([^",\n\}]+)/i, 'Card'),
        cardType: getStr(/"cardType"\s*:\s*["']?([^",\n\}]+)/i, 'unit'),
        element: getStr(/"element"\s*:\s*["']?([^",\n\}]+)/i, 'fire'),
        rarity: getStr(/"rarity"\s*:\s*["']?([^",\n\}]+)/i, 'common'),
        cost: getNum(/"cost"\s*:\s*(\d+)/i, 2),
        attack: getNum(/"attack"\s*:\s*(\d+)/i, 15),
        defense: getNum(/"defense"\s*:\s*(\d+)/i, 10),
        hp: getNum(/"hp"\s*:\s*(\d+)/i, 30),
        themeName: getStr(/"themeName"\s*:\s*["']?([^",\n\}]+)/i, null),
        themeKeyword: getStr(/"themeKeyword"\s*:\s*["']?([^",\n\}]+)/i, null),
        visualSeeds: getStr(/"visualSeeds"\s*:\s*["']?([^"\n\}]+)/i, ''),
        skill: {
          name: getStr(/"skill"[\s\S]*?"name"\s*:\s*["']?([^",\n\}]+)/i, getStr(/"skillName"\s*:\s*["']?([^",\n\}]+)/i, `${extractedName}의 일격`)),
          description: getStr(/"description"\s*:\s*["']?([^"\n\}]+)/i, '효과를 발동합니다.'),
          flavorText: getStr(/"flavorText"\s*:\s*["']?([^"\n\}]+)/i, ''),
          isVanilla: getBool(/"isVanilla"\s*:\s*(true|false)/i, false),
          cost: getNum(/"skill"[\s\S]*?"cost"\s*:\s*(\d+)/i, 2),
          damage: getNum(/"damage"\s*:\s*(\d+)/i, 0),
          shield: getNum(/"shield"\s*:\s*(\d+)/i, 0),
          heal: getNum(/"heal"\s*:\s*(\d+)/i, 0),
          multiHit: getNum(/"multiHit"\s*:\s*(\d+)/i, 1),
          drawCards: getNum(/"drawCards"\s*:\s*(\d+)/i, 0),
          manaGain: getNum(/"manaGain"\s*:\s*(\d+)/i, 0),
          pierceShield: getBool(/"pierceShield"\s*:\s*(true|false)/i, false),
          doubleCastNext: getBool(/"doubleCastNext"\s*:\s*(true|false)/i, false),
          destroy: getNum(/"destroy"\s*:\s*(\d+)/i, 0),
          searchDeck: getNum(/"searchDeck"\s*:\s*(\d+)/i, 0),
          summonToken: getNum(/"summonToken"\s*:\s*(\d+)/i, 0),
          damageReduction: getNum(/"damageReduction"\s*:\s*(\d+)/i, 0),
          attackDown: getNum(/"attackDown"\s*:\s*(\d+)/i, 0),
          silence: getBool(/"silence"\s*:\s*(true|false)/i, false),
          statusEffect: {
            type: getStr(/"statusEffect"[\s\S]*?"type"\s*:\s*["']?([^",\n\}]+)/i, 'none'),
            duration: getNum(/"duration"\s*:\s*(\d+)/i, 0),
            value: getNum(/"value"\s*:\s*(\d+)/i, 0)
          }
        }
      };
    }
  } catch (extractErr) {
    console.error('[JSON Parser] 최종 추출 실패:', extractErr);
  }

  throw new Error(`JSON 파싱 및 복구 실패: 원문 구조가 올바르지 않습니다.`);
}

/**
 * 🎨 NovelAI Diffusion V4.5 이미지 생성 정식 규격 호출
 * DanTagGen 태그 파이프라인 + V4.5 필수 파라미터 (params_version: 3, v4_prompt) 완벽 적용
 */
export async function generateNovelAIImage({ prompt, negativePrompt = '', element = 'fire', cardType = 'unit', resolution = 'square-normal', timeoutMs = 120000 }) {
  if (!state.settings.apiKey) {
    throw new Error('NovelAI API Key가 설정되지 않았습니다.');
  }

  // 1. 해상도 설정 (0 Anlas 무료 규격 지원 및 비율 매핑)
  let width = 640, height = 640;
  const resKey = resolution || state.settings.resolution || 'square-normal';
  if (resKey === 'portrait-normal') { width = 832; height = 1216; }
  else if (resKey === 'portrait-small') { width = 512; height = 768; }
  else if (resKey === 'square-normal') { width = 640; height = 640; }
  else if (resKey === 'square-small') { width = 512; height = 512; }
  else if (resKey === 'square-large') { width = 1024; height = 1024; }
  else if (resKey === 'landscape-small') { width = 768; height = 512; }
  else if (resKey === 'landscape-normal') { width = 1216; height = 832; }

  // 2. 🏷️ DanTagGen 스타일 태그 확장 및 CLIP 순서 최적화 + 언더스코어(_)를 스페이스( )로 변환 (NovelAI 전용 규격)
  // 🎨 태그 SLM이 있으면 그걸로 확장한다 (그림체 다양성). 없으면 규칙 기반 폴백.
  const expanded = await expandTagsDetailed(prompt, element, cardType, 30);
  const expandedPrompt = expanded.prompt.replace(/_/g, ' ');

  const defaultNegative = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name'.replace(/_/g, ' ');
  // 태그 SLM이 걸러낸 유해 태그를 이 카드 전용으로 덧붙인다.
  // (SLM이 뱉은 `monochrome`, `sketch` 같은 건 기본 네거티브에 없다)
  const finalNegative = [defaultNegative, expanded.negative, negativePrompt]
    .filter(Boolean).join(', ').replace(/_/g, ' ');

  const modelId = state.settings.model || 'nai-diffusion-4-5-full';
  const isV4orAbove = modelId.includes('4') || modelId.includes('5');

  // 3. NovelAI V4 / V4.5 필수 규격 파라미터 빌드
  const params = {
    params_version: 3,
    width: width,
    height: height,
    scale: parseFloat(state.settings.scale) || 5.0,
    sampler: 'k_euler',
    steps: Math.min(28, parseInt(state.settings.steps) || 28), // 0 Anlas 안전 스텝 28
    seed: Math.floor(Math.random() * 2147483647),
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    dynamic_thresholding: false,
    noise_schedule: 'karras',
    cfg_rescale: 0,
    uc: finalNegative
  };

  // NovelAI V4 / V4.5 전용 캡션 구조체 (미포함 시 500 Internal Server Error 발생)
  if (isV4orAbove) {
    params.v4_prompt = {
      caption: {
        base_caption: expandedPrompt,
        char_captions: []
      },
      use_coords: false,
      use_order: true
    };
    params.v4_negative_prompt = {
      caption: {
        base_caption: finalNegative,
        char_captions: []
      },
      legacy_uc: false
    };
  }

  const payload = {
    input: expandedPrompt,
    model: modelId,
    action: 'generate',
    parameters: params
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.settings.apiKey.trim()}`
      },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`NovelAI HTTP ${response.status}: ${errText || '서버 오류 또는 Anlas 부족'}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // 4. JSZip으로 PNG 바이너리 추출
    if (window.JSZip) {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const firstFile = Object.values(zip.files)[0];
      if (firstFile) {
        const base64 = await firstFile.async('base64');
        return `data:image/png;base64,${base64}`;
      }
    }

    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    return URL.createObjectURL(blob);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
