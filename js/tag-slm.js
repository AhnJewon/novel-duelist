// tag-slm.js - Danbooru 태그 확장 SLM 연동
//
// 문제: 규칙 기반 확장기(dan-tag-gen.js)는 속성·타입별 **고정 테이블**을 쓴다.
//       그래서 같은 속성 카드는 늘 같은 배경·조명 태그가 붙어 그림체가 단조로워진다.
//       실제로 fire 카드는 항상 'ruins, volcanic_background, warm_lighting'이 붙었다.
//
// 해결: 태그 확장 전용 SLM을 끼운다. 성긴 태그를 받아 풍부하게 늘리는 데 특화된
//       작은 모델이라 카드마다 다른 조합이 나온다.
//
// ⚠️ 모델이 없어도 게임은 정상 동작한다. 규칙 기반 확장기로 자동 폴백한다.
//    (bge-m3 임베딩과 같은 방식)
//
// ─────────────────────────────────────────────────────────────────
// 🐛 수정 이력 — TIPO 실측으로 밝혀진 3가지 오류 (2026-09-01)
//
//   과거에는 아래처럼 보냈고, 시드를 **완전히 무시**당했다.
//     tags: crimson swordsman, flaming katana   ← 필드명 오류
//     <|extended|>                              ← 종결 토큰 오류
//     (raw 미지정)                               ← Ollama 채팅 템플릿이 덧씌워짐
//   "crimson swordsman"을 넣으면 여우·검은고양이·king of the sands가 나왔다.
//
//   1) 필드명은 `tag:` 다. `tags:`도 `general:`도 아니다.
//      (모델 자신의 출력이 `tag:` 로 시작하는 것이 근거)
//   2) 입력 종결은 `<|input_end|>` 다. `<|extended|>`는 종결이 아니라
//      `target:` 필드에 들어가는 **길이 모드 값**이다.
//   3) TIPO는 instruct가 아니라 **순수 완성(completion) 모델**이다.
//      `raw: true`로 Ollama 채팅 템플릿을 반드시 우회해야 한다.
//
//   그리고 근본 문제 하나 더 —
//   4) TIPO는 **Danbooru 어휘로만** 사고한다. 자유 영어구는 분포 밖이라 버려진다.
//      그래서 시드를 먼저 `parseNaturalLanguageToDanbooru()`로 정규화해 넣는다.
//      정규화 후에는 (`1boy, red hair, katana, fire, armor`) 확실히 반응한다.
//      → japanese armor, kimono, blue fire, holding sword ...
//
//   ⚠️ 그리고 TIPO 원본 출력은 **그대로 쓰면 안 된다.** 실측된 오염 3종:
//      · 판권/캐릭터 누출: `genshin impact`, `vision (genshin impact)`, `kusazuri (mahousou)`
//        → NovelAI가 남의 IP 캐릭터를 그려버린다.
//      · 모순 태그 동시 출력: `white hair, black hair, grey hair, red hair, blue hair`
//        `closed eyes`+`blue eyes`+`green eyes`, `:d`+`:|`+`:o`
//        → 확률 나열일 뿐이라 그대로 주면 얼굴이 뭉개진다.
//      · 메타 라인 누출: `meta: highres`, `aspect ratio: 0.7`, `copyrights: ...`
//   → cleanSlmTags()가 이 셋을 전부 걷어낸다. 임의로 완화하지 말 것.
// ─────────────────────────────────────────────────────────────────

import { state } from './storage.js';
import { expandDanbooruTags, parseNaturalLanguageToDanbooru } from './dan-tag-gen.js';

/**
 * 지원 모델. Ollama에 올릴 수 있는 GGUF 배포판 기준.
 *
 *   tipo    — TIPO-500M (KBlueLeaf). DanTagGen 후속. 자연어까지 다루고 GGUF가 있어 가장 무난.
 *   dart    — Dart v2 (p1atdev, 166M). 가장 가볍고 순수 Danbooru 태그 보완에 특화.
 *   custom  — 사용자가 직접 올린 모델
 *
 * ⚠️ tipo / dart는 **완성 모델**이라 `raw: true`가 필수다 (preset.raw 참고).
 *    custom은 일반 instruct LLM일 수 있으므로 raw를 끈다.
 */
export const TAG_SLM_PRESETS = {
  tipo: {
    label: 'TIPO-500M (권장)',
    // ⚠️ Ollama 공식 라이브러리에는 없다. HuggingFace GGUF를 hf.co/ 접두로 받는다.
    model: 'hf.co/QuantFactory/TIPO-500M-GGUF',
    pull: 'ollama pull hf.co/QuantFactory/TIPO-500M-GGUF',
    desc: 'DanTagGen 후속. 태그·자연어 모두 처리. 약 500M',
    raw: true,
    // 필드 순서는 TIPO 학습 포맷을 따른다. 마지막이 반드시 `tag:` + `<|input_end|>`.
    //
    // ⚠️ 작가를 원하면 `artist:` 줄을 **아예 넣지 않는다.** 그러면 모델이
    //    이어쓰기로 카드에 어울리는 작가를 스스로 채운다 (실측 확인).
    //    `artist: <|empty|>` 로 박아두면 봉인된다 — 그게 그림체 단조로움의 주범이었다.
    buildPrompt: (seeds, meta) =>
      `quality: masterpiece\nrating: safe\n` +
      ((meta && meta.wantArtist) ? '' : 'artist: <|empty|>\n') +
      `characters: <|empty|>\ncopyrights: <|empty|>\naspect ratio: 1.0\n` +
      `target: <|long|>\ntag: ${seeds},<|input_end|>`
  },
  dart: {
    label: 'Dart v2 (경량 166M)',
    model: 'hf.co/p1atdev/dart-v2-moe-sft-gguf',
    pull: 'ollama pull hf.co/p1atdev/dart-v2-moe-sft-gguf',
    desc: '순수 Danbooru 태그 보완에 특화. 가장 빠름',
    raw: true,
    buildPrompt: (seeds) =>
      `<|bos|><rating>safe</rating><copyright></copyright><character></character>` +
      `<general>${seeds}<|input_end|>`
  },
  custom: {
    label: '직접 지정',
    model: '',
    pull: '',
    desc: '설정에서 모델 이름을 직접 입력 (일반 LLM도 가능)',
    raw: false,
    buildPrompt: (seeds, meta) =>
      `Expand these Danbooru tags into a rich, varied tag list for an anime TCG card illustration.\n` +
      `Element: ${meta.element}. Card type: ${meta.cardType}.\n` +
      `Input tags: ${seeds}\n` +
      `Output ONLY comma-separated Danbooru tags, no explanation. Include varied composition, ` +
      `lighting, background and detail tags. Do NOT include copyrighted series or character names.\n` +
      `Tags:`
  }
};

let _available = null;
let _resolvedModel = null;   // Ollama가 실제로 저장한 모델 이름

function preset() {
  const key = (state.settings && state.settings.tagSlmPreset) || 'tipo';
  return TAG_SLM_PRESETS[key] || TAG_SLM_PRESETS.tipo;
}

function modelName() {
  const custom = state.settings && state.settings.tagSlmModel;
  if (custom && String(custom).trim()) return String(custom).trim();
  return preset().model;
}

function baseUrl() {
  return (state.settings && state.settings.llmUrl) || 'http://127.0.0.1:11434';
}

/** 설치된 모델 이름과 설정값이 같은 모델인지 (대소문자·태그 차이를 흡수) */
function matchesModel(installed, target) {
  const norm = (s) => String(s).toLowerCase().replace(/:latest$/, '');
  const a = norm(installed);
  const b = norm(target);
  if (a === b) return true;
  if (a.startsWith(b + ':')) return true;          // hf.co/x/y:Q4_K_M
  // hf.co 접두가 붙거나 빠진 경우도 같은 모델로 본다
  const strip = (s) => s.replace(/^hf\.co\//, '').replace(/^huggingface\.co\//, '');
  return strip(a) === strip(b) || strip(a).startsWith(strip(b) + ':');
}

/** 태그 SLM이 설치돼 있는지. 결과는 캐시된다. */
export async function checkTagSlmAvailable(force = false) {
  if (!force && _available !== null) return _available;
  const target = modelName();
  if (!target) { _available = false; return false; }
  try {
    const resp = await fetch(`${baseUrl()}/api/tags`);
    if (!resp.ok) { _available = false; return false; }
    const data = await resp.json();
    const names = (data.models || []).map(m => m.name);
    const hit = names.find(n => matchesModel(n, target));
    _available = !!hit;
    if (hit) {
      // Ollama가 실제로 저장한 이름을 쓴다 (태그가 붙어 있을 수 있다)
      _resolvedModel = hit;
    } else {
      console.info(
        `[TagSLM] '${target}' 모델이 없어 규칙 기반 태그 확장을 씁니다.\n` +
        `         그림체 다양성을 높이려면:\n` +
        `           ${preset().pull || ('ollama pull ' + target)}\n` +
        `         (Ollama 공식 라이브러리에는 없고 HuggingFace GGUF를 hf.co/ 접두로 받습니다)`
      );
    }
    return _available;
  } catch (e) {
    _available = false;
    return false;
  }
}

export function resetTagSlmCache() {
  _available = null;
  _resolvedModel = null;
}

// ── 출력 정제 ────────────────────────────────────────────────────

/** TIPO가 자기 템플릿을 이어 쓰며 흘리는 메타 필드 라인 */
const META_FIELD_LINE = /^\s*(quality|rating|artist|characters?|copyrights?|meta|aspect\s*ratio|target|short|long|general|tag)\s*:/i;

/**
 * 무조건 버리는 태그. 그림에 도움이 안 되거나 해로운 것들만.
 *  - 화질/출처/워터마크 메타 태그는 NovelAI에 무의미하다
 *  - `english text`류는 NovelAI가 깨진 글자를 그려 넣는다
 *  - 🐛 `blurry`가 실제로 통과한 적이 있다. Danbooru에선 그냥 서술 태그지만
 *    NovelAI에 **긍정 프롬프트로** 주면 초점 나간 그림이 나온다.
 *    `monochrome`/`greyscale`도 마찬가지로 카드의 색을 전부 날린다.
 *
 * ⚠️ 판권/캐릭터 태그는 여기 넣지 않는다 — ipPolicy()가 따로 판단한다.
 */
// 🐛 수정: 예전에는 이 둘을 한 정규식에 `[]` + `^(?:...)$` 로 이어 붙였다.
//    그 결과 `[\[\]<>|]^(?:...)$` — 괄호문자 **뒤에** 문자열 시작을 요구하는
//    영영 매치되지 않는 패턴이 되어 필터가 통째로 죽어 있었다.
//    (`blurry`가 그대로 통과해 흐린 그림이 나왔다)
//    두 조건은 성격이 다르므로 반드시 따로 둔다.

/**
 * 태그 안에 있으면 안 되는 문자.
 *
 * NovelAI의 가중치 문법은 `{강조}` / `[약화]` 다 (`()`는 Stable Diffusion WebUI 문법).
 * 그래서 태그에 중괄호·대괄호가 섞여 들어오면 의도치 않은 가중치가 걸린다.
 * `::1.3::` 형태의 수치 가중치도 마찬가지라 콜론 쌍을 막는다.
 *
 * ⚠️ 소괄호 `()`는 여기 넣지 않는다. `flame (weapon)`처럼 Danbooru의 정식
 *    동음이의 구분자라 NovelAI가 그 형태 그대로 이해한다. 판권 여부만 따로 본다.
 */
const JUNK_CHARS = /[{}[\]<>|]|::/;

/**
 * 그냥 버리는 태그 — Danbooru 운영용 메타라 그림과 무관하다.
 * 네거티브로 보낼 이유도 없다 ("official art를 그리지 마"는 무의미).
 */
const JUNK_TAG = new RegExp('^(?:' + [
  'tachi-e', 'official art', 'official wallpaper', 'absurdres', 'highres', 'hires',
  'web source', 'non-web source', 'third-party source', 'animated',
  'artist request', 'character request', 'commentary', 'commentary request',
  'translated', 'translation request', 'dated', 'logo', 'border', 'letterboxed',
  'bad id', 'bad link', 'photo', 'scan', 'md5 mismatch', 'revision', 'variant set'
].join('|') + ')$', 'i');

/**
 * 버리는 데서 그치지 않고 **네거티브 프롬프트로 넘길** 태그.
 *
 * Danbooru에선 그냥 서술 태그지만 NovelAI에 긍정으로 주면 그림을 망친다.
 * 실제로 `blurry`가 통과해 초점 나간 카드가 나온 적이 있다.
 * 빼기만 하면 "안 넣은" 것이고, 네거티브로 보내야 "밀어내는" 것이다.
 */
const HARMFUL_TAG = new RegExp('^(?:' + [
  'blurry', 'blurry background', 'blurry foreground', 'out of focus', 'depth of field',
  'bad anatomy', 'bad hands', 'bad proportions', 'extra digits', 'missing fingers',
  'monochrome', 'greyscale', 'grayscale', 'sepia', 'sketch', 'lineart',
  'unfinished', 'flat color', 'lowres', 'worst quality', 'low quality',
  'jpeg artifacts', 'watermark', 'signature', 'artist name', 'username',
  'english text', 'japanese text', 'text', 'speech bubble',
  'artist logo', 'artist self-insert', 'twitter username', 'web address', 'patreon username'
].join('|') + ')$', 'i');

// ── 판권/캐릭터 태그 정책 ────────────────────────────────────────
//
// TIPO는 Danbooru로 학습돼서 툭하면 남의 IP를 끌어온다.
// 실측: `1boy, red hair, katana, fire, armor` 만 줬는데
//       `genshin impact`, `vision (genshin impact)`, `kusazuri (mahousou)` 가 나왔다.
//
// 그렇다고 전부 막으면 **판권 카드군**(특정 작품 테마 덱)을 못 만든다.
// 그래서 무조건 차단이 아니라 3단 정책으로 간다:
//
//   auto   (기본) — 카드 컨셉이 그 IP를 실제로 언급했을 때만 통과.
//                   범용 카드에 원신 캐릭터가 섞여 드는 사고만 막는다.
//   always        — 전부 통과. 판권 테마 덱을 굴릴 때.
//   never         — 전부 차단. 순수 오리지널만 원할 때.

// 🐛 수정: 예전엔 `/^(.+?)\s*\(([^)]+)\)$/` 로 **괄호 앞에 글자가 있어야** IP로 봤다.
//    그래서 `(ff14)`처럼 괄호만 있는 태그가 범용 카드에 그대로 새어 나갔다.
//    괄호가 조금이라도 있으면 IP 후보로 본다.
const HAS_PAREN = /\(([^)]*)\)/;

function ipPolicy() {
  const v = state.settings && state.settings.tagSlmIpPolicy;
  return (v === 'always' || v === 'never') ? v : 'auto';
}

// ── 작가 태그 ────────────────────────────────────────────────────
//
// Danbooru 계열 모델에서 **그림체를 가장 강하게 좌우하는 건 작가 태그**다.
// 배경·조명 태그를 아무리 흔들어도 작가 태그가 비어 있으면 모델의 평균 그림체로
// 수렴한다 — "그림체가 단조롭다"의 진짜 원인이 이것이다.
//
// 과거엔 TIPO 프롬프트에 `artist: <|empty|>`를 박아 아예 못 만들게 했고,
// 출력의 `artist:` 라인도 메타로 취급해 버렸다. 봉인해놓고 다양성을 기대한 셈.
//
//   off     — 작가 태그 없음 (모델 기본 그림체)
//   slm     — TIPO가 카드 내용에 어울리는 작가를 고른다 (기본)
//   custom  — 사용자가 정한 목록에서 고른다. 덱 전체 그림체를 통일하고 싶을 때.
//
// ⚠️ 카드마다 작가가 달라지므로 덱 전체의 그림체 통일감은 떨어진다.
//    통일감을 원하면 custom으로 2~3명만 지정하는 편이 낫다.

function artistMode() {
  const v = state.settings && state.settings.tagSlmArtistMode;
  return (v === 'off' || v === 'custom' || v === 'style') ? v : 'slm';
}

/**
 * 작가 태그를 이미지 모델에 맞게 적는다.
 * NovelAI V4 계열은 작가 태그에 `artist:` 접두를 쓴다(데이터셋 표기). V3 이하는 맨 이름.
 * 유저가 이미 접두를 붙였으면 그대로 둔다.
 */
function formatArtistTag(name) {
  const n = String(name || '').trim();
  if (!n || /^artist:/i.test(n)) return n;
  const imageModel = String((state.settings && state.settings.model) || '');
  return /diffusion-4/.test(imageModel) ? `artist:${n}` : n;
}

/** custom 모드에서 쓸 작가 목록 */
function customArtists() {
  return String((state.settings && state.settings.tagSlmArtists) || '')
    .split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * custom 목록에서 1명을 고른다.
 * 여러 명을 한꺼번에 넣으면 그림체가 섞여 뭉개지므로 카드당 1명만 쓴다.
 * (전투 로직이 아니라 이미지 생성이므로 Math.random을 써도 락스텝과 무관하다)
 */
function pickCustomArtists() {
  const list = customArtists();
  if (!list.length) return [];
  return [list[Math.floor(Math.random() * list.length)]];
}

/**
 * 작가 태그로 쓸 만한 문자열인지.
 *
 * ⚠️ TIPO의 `artist:` 출력은 신뢰할 수 없다. 실측에서 4번 중 1번만 나왔고
 *    그마저 `l an'erure` 같은 깨진 문자열이었다. NovelAI가 모르는 이름을 넣으면
 *    그냥 무시되거나 엉뚱하게 해석되므로 형태 검증을 반드시 건다.
 */
function isPlausibleArtistTag(a) {
  if (!a || a.length < 3 || a.length > 32) return false;
  if (/[^a-z0-9 _.'-]/.test(a)) return false;   // 한글·특수문자·제어토큰 배제
  if (!/[a-z]{3}/.test(a)) return false;        // 알파벳 덩어리가 있어야 이름답다
  if ((a.match(/'/g) || []).length > 1) return false;  // `l an'erure` 류 파편
  if (a.split(' ').length > 3) return false;
  return true;
}

/** 모델 출력의 `artist:` 라인에서 작가 태그를 뽑는다 */
function extractArtists(raw) {
  const found = [];
  for (const m of String(raw || '').matchAll(/^\s*artists?\s*:\s*(.+)$/gim)) {
    for (const part of m[1].split(',')) {
      const a = part.trim().toLowerCase()
        .replace(/<\|[^|]*\|>/g, '')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!isPlausibleArtistTag(a)) continue;
      if (!found.includes(a)) found.push(a);
    }
  }
  return found;
}

/**
 * 🎨 그림체 스타일 태그 풀.
 *
 * 작가 태그가 그림체를 가장 강하게 흔들지만, TIPO는 그걸 안정적으로 못 내놓는다.
 * 스타일 태그는 그 대안이다 — 특정 작가를 흉내 내지 않으면서 화풍·질감·조명을
 * 바꿔 카드마다 다른 인상을 준다. 실패해도 그림이 망가지지 않는 것이 장점.
 *
 * 카드당 한 묶음만 고른다. 여러 묶음을 섞으면 화풍이 충돌해 뭉개진다.
 */
const ART_STYLE_POOL = [
  ['oil painting', 'painterly', 'visible brushstrokes'],
  ['watercolor', 'soft edges', 'bleeding colors'],
  ['cel shading', 'thick outlines', 'bold colors'],
  ['digital painting', 'detailed rendering', 'subsurface scattering'],
  ['chiaroscuro', 'dramatic shadows', 'high contrast'],
  ['rim lighting', 'backlighting', 'glowing edges'],
  ['muted colors', 'desaturated', 'gritty texture'],
  ['vibrant colors', 'saturated', 'glossy highlights'],
  ['retro artstyle', 'film grain', 'warm tint'],
  ['ethereal', 'soft focus background', 'bloom'],
  // ⚠️ 여기에 monochrome/greyscale 계열을 넣지 말 것. 카드 색이 죽는다.
  //    (`monochrome accents`를 넣었다가 물 속성 카드가 흑백으로 나올 뻔했다)
  ['ink wash painting', 'flowing lines', 'splashed ink'],
  ['concept art', 'cinematic lighting', 'epic scale']
];

/** 이미지 생성이라 락스텝과 무관하므로 Math.random을 써도 된다 */
function pickArtStyle() {
  return ART_STYLE_POOL[Math.floor(Math.random() * ART_STYLE_POOL.length)].slice();
}

/**
 * 모델 출력에서 IP 이름 후보를 모은다.
 * 괄호 안 시리즈명(`genshin impact`)을 뽑아두면, 같은 이름이 맨몸 태그로
 * 따로 나왔을 때도 IP 태그인 걸 알 수 있다.
 */
function collectIpNames(raw) {
  const names = new Set();
  // 모델이 흘리는 copyrights: / characters: 라인이 가장 확실한 근거다
  for (const m of String(raw || '').matchAll(/^\s*(?:copyrights?|characters?)\s*:\s*(.+)$/gim)) {
    m[1].split(',').forEach(n => {
      const t = n.trim().toLowerCase();
      if (t && t !== '<|empty|>') names.add(t);
    });
  }
  for (const m of String(raw || '').matchAll(/\(([^)]{3,40})\)/g)) {
    names.add(m[1].trim().toLowerCase());
  }
  return names;
}

/**
 * 이 태그를 통과시킬지. 정책 + 카드 컨셉과의 관련성으로 판단한다.
 * @param {string} tag       소문자 정규화된 태그
 * @param {Set<string>} ipNames  이번 출력에서 발견된 IP 이름들
 * @param {string} contextText   시드 + 카드 컨셉 (소문자)
 */
function passesIpPolicy(tag, ipNames, contextText) {
  const isIp = HAS_PAREN.test(tag) || ipNames.has(tag);
  if (!isIp) return true;

  // 괄호를 지운 알맹이로 관련성을 본다: `vision (genshin impact)` → `vision genshin impact`
  const subject = tag.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

  const policy = ipPolicy();
  if (policy === 'never') return false;
  if (policy === 'always') return true;

  // auto — 카드 컨셉이 실제로 그 작품/캐릭터를 언급했을 때만 통과시킨다.
  // 의미 있는 낱말이 하나라도 컨셉에 있으면 "의도한 판권 카드"로 본다.
  return subject
    .split(/[\s_]+/)
    .filter(w => w.length >= 3)
    .some(w => contextText.includes(w));
}

/**
 * 상호배타 태그군. TIPO는 확률 나열이라 같은 군을 무더기로 뱉는다.
 * 각 군에서 **먼저 나온 것 하나만** 남긴다 — 시드를 앞에 두므로 시드가 이긴다.
 *
 * ⚠️ `solo`는 `1girl`과 정상적으로 공존하므로 인원 군에 넣지 않는다.
 */
const EXCLUSIVE_FAMILIES = [
  ['hair_color', /^(?:multicolored |gradient |two-tone |streaked |dark |light |pale )?(?:red|blue|green|blonde|blond|black|white|grey|gray|brown|pink|purple|silver|orange|aqua|platinum blonde)\s+hair$/i],
  ['hair_length', /^(?:very long|long|medium|short|very short)\s+hair$/i],
  ['eye_color', /^(?:red|blue|green|yellow|black|white|grey|gray|brown|pink|purple|orange|aqua|violet|golden|gold)\s+eyes$/i],
  ['eye_state', /^(?:closed eyes|one eye closed|half-closed eyes|empty eyes|glowing eyes)$/i],
  ['gaze', /^(?:looking at viewer|looking away|looking to the side|looking down|looking up|looking back|looking afar)$/i],
  ['mouth', /^(?:open mouth|closed mouth|parted lips)$/i],
  ['emote', /^(?::d|:o|:\||:3|:p|;d|;\)|\^_\^|o_o|\+_\+)$/i],
  ['expression', /^(?:smile|frown|grin|serious|angry|sad|surprised|expressionless|blush)$/i],
  ['bg', /^(?:white|black|grey|gray|blue|red|green|purple|yellow|pink|orange|brown|simple|gradient|dark|two-tone)\s+background$/i],
  ['framing', /^(?:full body|upper body|lower body|cowboy shot|portrait|close-up|from side|from behind|from above|from below|profile)$/i],
  ['count', /^(?:1girl|1boy|2girls|2boys|3girls|3boys|multiple girls|multiple boys|no humans)$/i]
];

/**
 * SLM 출력에서 쓸 만한 태그만 골라낸다.
 * @param {string} raw            모델 원문
 * @param {string[]} alreadyHave  이미 확정된 태그(시드/품질). 모순 판정의 기준이 된다.
 * @param {string} contextText    카드 컨셉 원문. 판권 태그 허용 판단에 쓴다.
 */
function cleanSlmTags(raw, alreadyHave = [], contextText = '') {
  // ⚠️ IP 이름은 메타 라인을 지우기 **전에** 뽑아야 한다 (copyrights: 라인이 근거)
  const ipNames = collectIpNames(raw);
  const ctx = String(contextText || '').toLowerCase();

  const text = String(raw || '')
    // 모델이 자기 템플릿을 이어 쓰며 흘리는 메타 라인을 통째로 제거
    .split(/\n+/)
    .filter(line => !META_FIELD_LINE.test(line))
    .join('\n')
    .replace(/<\|[^|]*\|>/g, ' ')          // <|input_end|> 같은 제어 토큰
    .replace(/<\/?[a-z_]+>/gi, ' ');       // <general> 같은 XML 태그

  // 이미 확정된 태그가 점유한 군은 잠근다
  const usedFamilies = new Set();
  const seen = new Set();
  for (const t of alreadyHave) {
    const norm = String(t).trim().toLowerCase().replace(/_/g, ' ');
    seen.add(norm);
    for (const [fam, re] of EXCLUSIVE_FAMILIES) {
      if (re.test(norm)) usedFamilies.add(fam);
    }
  }

  const out = [];
  const negatives = [];   // 버리는 데 그치지 않고 밀어내야 하는 것들
  const negSeen = new Set();
  const pushNeg = (t) => { if (!negSeen.has(t)) { negSeen.add(t); negatives.push(t); } };

  for (const chunk of text.split(/[,\n]+/)) {
    const tag = chunk.trim().toLowerCase().replace(/[.;:]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ');
    if (tag.length < 2 || tag.length > 40) continue;
    if (/^\d+$/.test(tag)) continue;
    if (JUNK_CHARS.test(tag)) continue;
    if (tag.replace(/\([^)]*\)/g, '').split(' ').filter(Boolean).length > 4) continue;  // 자연어 문장 조각
    if (JUNK_TAG.test(tag)) continue;

    // 그림을 망치는 태그 → 포지티브에서 빼고 네거티브로 넘긴다
    if (HARMFUL_TAG.test(tag)) { pushNeg(tag); continue; }

    if (seen.has(tag)) continue;

    // 정책이 막은 판권 태그는 **그냥 뺀다.**
    // ⚠️ 네거티브로 보내지 말 것. `genshin impact`를 네거티브에 넣으면
    //    그 캐릭터만이 아니라 **그 그림체 전체**를 밀어내서 결과가 나빠진다.
    //    판권 태그는 "그리면 안 되는 것"이 아니라 "지금 카드와 무관한 것"일 뿐이다.
    if (!passesIpPolicy(tag, ipNames, ctx)) continue;

    // 모순 방지: 같은 군은 하나만.
    // ⚠️ 이건 네거티브로 보내지 않는다 — TIPO가 나열한 대안일 뿐,
    //    "그리지 말아야 할 것"이 아니다. 과하게 제약하면 그림이 경직된다.
    let blocked = false;
    for (const [fam, re] of EXCLUSIVE_FAMILIES) {
      if (!re.test(tag)) continue;
      if (usedFamilies.has(fam)) { blocked = true; }
      else { usedFamilies.add(fam); }
      break;
    }
    if (blocked) continue;

    seen.add(tag);
    // ⚠️ 괄호는 **벗기지 않는다.** `flame (weapon)`은 Danbooru의 정식 동음이의
    //    구분자가 붙은 태그 이름이고 NovelAI도 그 형태로 학습돼 있다.
    //    벗겨서 `flame weapon`으로 만들면 존재하지 않는 태그가 된다.
    //    (NovelAI의 가중치 문법은 `{}`/`[]`이지 `()`가 아니다 — JUNK_CHARS 참고)
    out.push(tag);
    if (out.length >= 40) break;
  }
  return { tags: out, negatives };
}

/**
 * 🖌️ TIPO에게 **작가만** 묻는다 — 완성된 태그 목록 뒤에 `artist:`를 마지막 줄로 두고 이어쓰게 한다.
 *
 * 🐛 예전엔 본문 요청에서 `artist:` 줄을 비워 두고 모델이 "알아서" 채우길 기대했다(DECISIONS #48).
 *    TIPO는 마지막 필드(`tag:`)의 이어쓰기만 하므로 앞 필드로 돌아가 작가를 쓰는 일은 거의 없다 —
 *    실측 3/3 빈 배열, 그래서 그림체는 늘 화풍 태그 폴백이었다.
 *    `artist:`를 프롬프트의 **마지막**에 두면 매번 실제 Danbooru 작가 태그가 나온다
 *    (실측: junga, wudiyuga, toinaka … 40~130ms). `(1420)` 같은 게시물 수 꼬리는 잘라낸다.
 *
 * @returns {string[]} 작가 태그 0~1개 (형태 검증을 통과한 것만)
 */
/** Danbooru의 `artist:` 자리에 오지만 사람이 아닌 메타 태그 — 프롬프트에 넣으면 그림체가 아니라 잡음이다 */
const ARTIST_META_TAGS = new Set([
  'banned artist', 'artist request', 'artist name', 'unknown artist', 'various artists', 'anonymous artist',
  'official art', 'third-party edit', 'self-upload', 'original', 'artist', 'none', 'empty'
]);

async function suggestArtistWithTipo(tags, { timeoutMs = 8000, attempts = 2 } = {}) {
  const tagLine = (tags || []).map(t => String(t).trim()).filter(Boolean).slice(0, 24).join(', ');
  if (!tagLine) return [];
  // 호출이 100ms 안쪽이라, 형태 검증에 걸리면(괄호 한정자·파편) 한 번 더 뽑는다 — 실측 3번 중 1번은 첫 시도가 걸렸다
  for (let i = 0; i < attempts; i++) {
    const got = await suggestArtistOnce(tagLine, timeoutMs);
    if (got.length) return got;
  }
  return [];
}

async function suggestArtistOnce(tagLine, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: _resolvedModel || modelName(),
        prompt: `quality: masterpiece\nrating: safe\ncharacters: <|empty|>\ncopyrights: <|empty|>\n` +
                `aspect ratio: 1.0\ntarget: <|long|>\ntag: ${tagLine}\nartist:`,
        raw: true,
        stream: false,
        // 온도를 낮춰 **흔한** 작가가 나오게 한다 — 꼬리의 희귀 태그는 파편(`inh y3`)이거나 NovelAI가 모르는 이름이다
        options: { temperature: 0.7, top_p: 0.9, top_k: 40, num_predict: 24, stop: ['\n', '<|'] }
      })
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const first = String(data.response || '').split(',')[0]
      .replace(/\(\s*\d[\d,]*\s*\)/g, '')      // Danbooru 자동완성식 게시물 수 꼬리 "(1420)"
      .replace(/<\|[^|]*\|>/g, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().toLowerCase();
    if (!isPlausibleArtistTag(first)) return [];
    if (ARTIST_META_TAGS.has(first)) return [];                      // 'banned artist' 같은 메타 태그는 작가가 아니다
    if (first.split(' ').some(w => w.length < 3)) return [];        // 'inh y3' 류 파편
    return [first];
  } catch (e) {
    clearTimeout(timer);
    return [];
  }
}

/**
 * 성긴 시드를 SLM으로 확장한다.
 * 실패하거나 모델이 없으면 null — 호출부가 규칙 기반으로 폴백한다.
 *
 * @param {string} seeds   Danbooru 어휘로 **정규화된** 시드 (자유 영어구는 무시당한다)
 * @param {string[]} core  이미 확정된 태그. 모순 태그를 걸러내는 기준.
 * @param {string} context 카드 컨셉 원문. 판권 태그를 허용할지 판단하는 근거.
 */
export async function expandWithSlm(seeds, { element = 'fire', cardType = 'unit', core = [], context = '', timeoutMs = 30000 } = {}) {
  if (!(await checkTagSlmAvailable())) return null;
  const p = preset();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: _resolvedModel || modelName(),
        prompt: p.buildPrompt(seeds, { element, cardType, wantArtist: artistMode() === 'slm' }),
        // ⚠️ 완성 모델은 raw가 아니면 Ollama 채팅 템플릿이 덧씌워져 포맷이 깨진다
        raw: p.raw !== false,
        stream: false,
        options: {
          temperature: 0.9,   // 태그 확장은 다양성이 목적이라 높게 둔다
          top_p: 0.95,
          top_k: 80,
          num_predict: 256
        }
      })
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    const cleaned = cleanSlmTags(data.response, core, context || seeds);
    // 작가 태그는 메타 라인에 실려 오므로 정제 전 원문에서 따로 뽑는다
    cleaned.artists = artistMode() === 'slm' ? extractArtists(data.response) : [];
    // 🖌️ 본문에서 작가가 안 나왔으면(거의 늘 그렇다) **작가만 묻는 2차 호출**로 받는다 (DECISIONS #99)
    if (artistMode() === 'slm' && cleaned.artists.length === 0 && p === TAG_SLM_PRESETS.tipo) {
      cleaned.artists = await suggestArtistWithTipo(cleaned.tags.concat(core), { timeoutMs: 8000 });
    }
    return cleaned.tags.length >= 5 ? cleaned : null;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[TagSLM] 확장 실패, 규칙 기반으로 폴백:', e.message);
    return null;
  }
}

/**
 * 시각 프롬프트 확장 — SLM 우선, 실패 시 규칙 기반.
 * dan-tag-gen의 expandDanbooruTags와 같은 자리에 끼워 쓴다.
 *
 * 파이프라인:
 *   1) 시드를 Danbooru 어휘로 정규화 (안 하면 SLM이 통째로 무시한다)
 *   2) 규칙 기반으로 **핵심 뼈대**만 만든다 (품질·구도·속성 앵커)
 *      → 카드가 무슨 속성·타입인지는 절대 흔들리면 안 되므로 규칙이 권위를 갖는다
 *   3) 나머지 자리는 SLM이 만든 **디테일 태그**로 채운다 → 카드마다 그림이 달라진다
 *   4) 걸러낸 것 중 **밀어내야 할 것**은 네거티브로 돌려준다
 *
 * @returns {{prompt: string, negative: string}}
 *   negative는 이 카드 **전용** 추가분이다. 호출부가 기본 네거티브에 덧붙인다.
 */
export async function expandTagsDetailed(seeds, element = 'fire', cardType = 'unit', targetLength = 28) {
  // 1) SLM이 알아듣는 어휘로 변환
  const canonical = parseNaturalLanguageToDanbooru(seeds)
    .map(t => t.replace(/_/g, ' '))
    .filter(Boolean);
  const seedText = canonical.length ? canonical.join(', ') : String(seeds || '').trim();

  // 2) 규칙 기반 뼈대 — 속성/타입 정체성은 여기서 확정된다
  const coreLen = Math.min(18, Math.max(10, Math.round(targetLength * 0.6)));
  const core = expandDanbooruTags(seedText, element, cardType, coreLen)
    .split(',').map(t => t.trim()).filter(Boolean);

  // 3) SLM 디테일로 남은 자리를 채운다
  // 판권 판정은 **원문 컨셉**을 봐야 한다. 정규화된 시드는 단어가 깎여 있다.
  const slm = await expandWithSlm(seedText, {
    element, cardType, core,
    context: `${seeds} ${seedText}`
  });

  // 4) 그림체 태그 — 맨 앞에 둬야 효과가 크다.
  //    작가 태그가 가장 강하지만 TIPO가 안정적으로 못 내놓으므로,
  //    못 얻으면 스타일 태그로 대체한다 (다양성은 확보하고 그림은 안 망가진다).
  let artists = [];
  const aMode = artistMode();
  if (aMode === 'custom') {
    artists = pickCustomArtists().map(formatArtistTag);
  } else if (aMode === 'slm') {
    // SLM 작가 → (없으면) 유저가 적어 둔 목록 → (그것도 없으면) 화풍 태그
    const fromSlm = (slm && slm.artists) ? slm.artists.slice(0, 1) : [];
    const fromUser = fromSlm.length ? [] : pickCustomArtists();
    const picked = fromSlm.length ? fromSlm : fromUser;
    artists = picked.length ? picked.map(formatArtistTag) : pickArtStyle();
  } else if (aMode === 'style') {
    artists = pickArtStyle();
  }

  if (!slm) {
    // 폴백: 규칙 기반 전체 확장 (작가 태그는 custom일 때만 붙는다)
    const base = expandDanbooruTags(seedText, element, cardType, targetLength - artists.length);
    return { prompt: artists.concat(base.split(',').map(t => t.trim())).join(', '), negative: '' };
  }

  const merged = artists.concat(core, slm.tags).slice(0, targetLength);
  return { prompt: merged.join(', '), negative: (slm.negatives || []).join(', ') };
}

/**
 * 하위 호환 래퍼 — 프롬프트 문자열만 필요할 때.
 * 네거티브까지 쓰려면 expandTagsDetailed를 쓰세요.
 */
export async function expandTags(seeds, element = 'fire', cardType = 'unit', targetLength = 28) {
  const { prompt } = await expandTagsDetailed(seeds, element, cardType, targetLength);
  return prompt;
}
