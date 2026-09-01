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
export async function callOllamaChat({ messages, model = null, temperature = 0.7, timeoutMs = 300000, reasoningMode = null }) {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 🧠 심층 추론(Reasoning) vs 초고속(Fast) 지시 주입
  const systemContent = isDeep
    ? 'You are a creative Anime TCG card designer. Think deeply about character lore, game balance, and visual aesthetic, then output a valid raw JSON object.'
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
      format: 'json',
      stream: false,
      options: {
        temperature: effectiveTemp,
        top_p: 0.9,
        top_k: 50,
        // 🇰🇷 한국어 반복 페널티 완화 (2026-09-01)
        // 한국어는 조사(은/는/이/가)·어미(~합니다)·게임 용어("피해","방어막")가
        // 정상적으로 반복된다. presence/frequency 페널티를 걸면 모델이 올바른 조사를
        // 피해 어색한 대체어를 고른다 ("카드를 서치한다" -> "카드에서 탐색하다").
        // 다양성은 seed 랜덤화 + nonce로 이미 확보하므로 페널티는 0으로 둔다.
        presence_penalty: 0,
        frequency_penalty: 0,
        repeat_penalty: 1.05,   // 1.15는 한국어에 과함. 1.0~1.08 권장 범위
        seed: randomSeed,
        repeat_last_n: 64,
        num_ctx: isDeep ? 16384 : 8192,
        num_predict: isDeep ? -1 : 1024,
        stop: STOP_TOKENS
      }
    };

    // ⚡ 과추론 제어: fast 모드에서 thinking을 끈다.
    // think 파라미터는 Qwen 3 계열 전용이다. Gemma 등 thinking 모드가 없는 모델은
    // 이 필드를 무시하므로 보내도 무해하지만, 지원 모델에만 보내 의도를 명확히 한다.
    if (!isDeep && supportsThinking(targetModel)) {
      bodyPayload.think = false;
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(bodyPayload)
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status} 응답 오류 (모델: ${targetModel})`);
    }

    const data = await response.json();
    if (data.message && data.message.thinking) {
      console.log('%c🧠 [Qwen 3.5 카드 설계 추론 과정 (Reasoning)]', 'color: #a855f7; font-weight: bold;\n', data.message.thinking);
    }

    let raw = (data.message && data.message.content) ? data.message.content.trim() : '';
    if (!raw && data.response) raw = data.response.trim();
    if (!raw && data.message && data.message.thinking) raw = data.message.thinking.trim();

    return repairAndParseJson(raw);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * 🛠️ 불완전/미완료 JSON 자동 복구 및 안전 파서
 */
export function repairAndParseJson(raw) {
  let text = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  // 비정상적 숫자/단어 무한 반복 루프 필터링 (예: 1단, 2단, 3단...)
  text = text.replace(/(\d+단[,\s]*){3,}/g, '');

  // 1. 정상 JSON 직렬화 시도
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(text);
  } catch (e) {}

  // 2. 미완료된 중괄호/대괄호/따옴표, 오타 마침표, 탈출 따옴표, 후행 콤마 자동 보정
  try {
    const startIdx = text.indexOf('{');
    if (startIdx === -1) throw new Error('JSON 시작 중괄호({)가 없습니다.');
    let sub = text.slice(startIdx);

    // 🔧 따옴표 바깥의 오타 마침표 제거 (예: "...". , 또는 "...".\n,)
    sub = sub.replace(/"\s*\.\s*(?=[\n,\]\}])/g, '"');

    // 🔧 문자열 내부의 단일따옴표 감싸기 제거 (예: "'고대의 비전석'" -> "고대의 비전석")
    sub = sub.replace(/:\s*"\'([^\']+)\'"/g, ': "$1"');

    // 🔧 이중 따옴표 탈출 찌꺼기 제거 (예: "\"적에게...\"" -> "적에게...")
    sub = sub.replace(/:\s*"\\?"([^"]+?)\\?""\s*([,\n\}])/g, ': "$1"$2');

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

    // 후행 콤마 제거 (, } -> })
    sub = sub.replace(/,\s*([\}\]])/g, '$1');

    return JSON.parse(sub);
  } catch (err) {
    console.warn('[JSON Parser] 표준 복구 실패 -> 스마트 필드 추출기로 완벽 복구 시도:', err.message);
  }

  // 3. 🛡️ 스마트 정규식 카드/보스 AST 추출기 (JSON 문법이 심하게 깨져도 100% 카드 데이터 복원)
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
        visualPrompt: getStr(/"visualPrompt"\s*:\s*"([^"]+)"/i, 'masterpiece, best_quality'),
        skill: {
          name: getStr(/"skill"[\s\S]*?"name"\s*:\s*["']?([^",\n\}]+)/i, `${extractedName}의 일격`),
          description: getStr(/"description"\s*:\s*["']?([^"\n\}]+)/i, '강력한 피해를 입힙니다.'),
          cost: getNum(/"skill"[\s\S]*?"cost"\s*:\s*(\d+)/i, 2),
          damage: getNum(/"damage"\s*:\s*(\d+)/i, 15),
          shield: getNum(/"shield"\s*:\s*(\d+)/i, 0),
          heal: getNum(/"heal"\s*:\s*(\d+)/i, 0),
          multiHit: getNum(/"multiHit"\s*:\s*(\d+)/i, 1),
          drawCards: getNum(/"drawCards"\s*:\s*(\d+)/i, 0),
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
