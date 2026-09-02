// korean-grammar.js - 카드 텍스트 어법 교정 · 검사
//
// ❓ 왜 임베딩(bge-m3)을 안 쓰나
//    카드군 중복 통합에는 임베딩이 잘 맞았다. 어법에는 **원리적으로** 못 쓴다.
//    임베딩은 표면 형태를 일부러 무시하도록 학습되기 때문이다. 실측:
//
//      정문 vs 조사오류 비문   0.9972   ← 거의 같다고 본다
//      정문 vs 어미오류 비문   0.9863
//      정문 vs 수치만 다름     0.8890   ← 어법 오류보다 **더 멀다**
//      정문 vs 뜻이 다른 문장  0.7730
//
//    "피해를 입힌다"와 "피해가 입힌다"가 0.997이면 임계값을 어디에 둬도 못 가른다.
//    (그 둔감함이 바로 중복 카드군을 잘 잡는 이유이기도 하다)
//
// ✅ 카드 텍스트는 어휘가 좁다 — 피해·방어막·체력·마나·드로우 몇 개뿐이다.
//    그래서 규칙 기반이 정확하고 빠르다. LLM 호출도 필요 없다.

// ── 받침 판정 ────────────────────────────────────────────────
/** 한글 음절에 받침이 있는가 */
function hasBatchim(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;   // 한글 음절이 아니다
  return (code - 0xAC00) % 28 !== 0;
}

// 숫자는 **읽는 소리**로 받침을 정한다. 14는 "십사"라 받침이 없다 → "14를"
// 🐛 실팩에서 "방어막 14을 얻는다"가 나왔다. 14는 '사'로 끝나므로 '를'이 맞다.
const DIGIT_BATCHIM = {
  '0': true,  // 영
  '1': true,  // 일
  '2': false, // 이
  '3': true,  // 삼
  '4': false, // 사
  '5': false, // 오
  '6': true,  // 육
  '7': true,  // 칠
  '8': true,  // 팔
  '9': false  // 구
};

/** 조사 앞 글자의 받침 여부. 한글·숫자·기타를 모두 다룬다. */
export function endsWithBatchim(token) {
  const s = String(token || '').trim();
  if (!s) return null;
  const last = s[s.length - 1];
  if (/\d/.test(last)) {
    // 10, 20 … 은 '십'으로 끝나 받침이 있다
    if (last === '0' && s.length >= 2 && /\d/.test(s[s.length - 2])) return true;
    return DIGIT_BATCHIM[last];
  }
  return hasBatchim(last);
}

// ── 조사 짝 ──────────────────────────────────────────────────
//    [받침 있을 때, 받침 없을 때]
const PARTICLE_PAIRS = [
  ['을', '를'],
  ['이', '가'],
  ['은', '는'],
  ['과', '와'],
  ['으로', '로']
];

/**
 * 받침에 맞지 않는 조사를 고친다.
 *
 * ⚠️ 뜻은 바꾸지 않는다. "을↔를"처럼 **같은 역할의 짝**만 교체한다.
 *    "피해가"를 "피해를"로 바꾸는 건 조사 **역할**이 달라지는 일이라
 *    여기서 하지 않는다 — 그건 아래 동사 호응 검사가 맡는다.
 */
export function fixParticles(text) {
  let out = String(text || '');
  for (const [withB, noB] of PARTICLE_PAIRS) {
    // 조사 뒤에 한글이 바로 붙으면 조사가 아니라 단어의 일부일 수 있다.
    // (예: "은신" 의 '은') → 뒤가 공백·문장부호·끝일 때만 고친다.
    const re = new RegExp(`([가-힣0-9])(${withB}|${noB})(?=[\\s.,)]|$)`, 'g');
    out = out.replace(re, (m, prev, p) => {
      const b = endsWithBatchim(prev);
      if (b === null) return m;
      return prev + (b ? withB : noB);
    });
  }
  return out;
}

// ── 동사–조사 호응 ───────────────────────────────────────────
//    카드 텍스트에 실제로 나오는 조합만 담는다. 넓게 잡으면 오탐이 난다.
//    { 명사: { 올바른조사역할, 함께 쓰는 동사들 } }
const VERB_PARTICLE_RULES = [
  // "피해를 입힌다 / 준다" — '피해가 입힌다'는 비문
  { noun: '피해', badRe: /피해\s*(?:이|가)\s*(입힌|입히|준다|주고|가한|가하)/, fix: '피해를 $1', why: '"피해가 입힌다" → "피해를 입힌다"' },
  // "피해를 입는다"는 맞지만 "피해가 입는다"는 비문
  { noun: '피해', badRe: /피해\s*(?:이|가)\s*(입는|입은)/, fix: '피해를 $1', why: '"피해가 입는다" → "피해를 입는다"' },
  // "방어막을 얻는다"
  { noun: '방어막', badRe: /방어막\s*(?:이|가)\s*(얻|획득)/, fix: '방어막을 $1', why: '"방어막이 얻는다" → "방어막을 얻는다"' },
  // "체력을 회복한다"
  { noun: '체력', badRe: /체력\s*(?:이|가)\s*(회복한|회복하고|회복시)/, fix: '체력을 $1', why: '"체력이 회복한다" → "체력을 회복한다"' },
  // "~을 걸린다"는 비문 (걸다/걸리다 혼동)
  { noun: '상태이상', badRe: /(?:을|를)\s*걸린다/, fix: '을 건다', why: '"~을 걸린다" → "~을 건다"' }
];

/**
 * 어법 문제를 찾는다.
 * @returns {Array<{why:string}>} 빈 배열이면 통과
 */
export function findGrammarProblems(text) {
  const t = String(text || '');
  const problems = [];

  for (const rule of VERB_PARTICLE_RULES) {
    if (rule.badRe.test(t)) problems.push({ why: rule.why });
  }

  // 받침에 안 맞는 조사가 남아 있는가 (fixParticles로 고쳐지는 것들)
  if (fixParticles(t) !== t) problems.push({ why: '받침에 맞지 않는 조사' });

  // 영어가 그대로 남았는가 — "freeze (1턴)" 같은 것
  //   ⚠️ 카드 텍스트는 전부 한국어여야 한다. 효과 키가 새어 나온 것이다.
  const eng = t.match(/[a-zA-Z]{3,}/g);
  if (eng) problems.push({ why: `영어가 그대로 남음: ${[...new Set(eng)].join(', ')}` });

  return problems;
}

/**
 * 고칠 수 있는 것은 고치고, 남은 문제를 돌려준다.
 * @returns {{ text:string, problems:Array }}
 */
export function tidyKoreanText(text) {
  let out = String(text || '').trim();

  // 1) 동사 호응 — 뜻이 바뀌지 않는 확정적인 것만 치환한다
  for (const rule of VERB_PARTICLE_RULES) {
    out = out.replace(rule.badRe, rule.fix);
  }
  // 2) 받침 조사
  out = fixParticles(out);
  // 3) 공백 정리 ("freeze (1턴) 을" 같은 조사 앞 공백)
  out = out.replace(/\s+([을를이가은는와과])(?=[\s.,)]|$)/g, '$1')
           .replace(/\s{2,}/g, ' ')
           .replace(/\s+([.,)])/g, '$1');

  return { text: out, problems: findGrammarProblems(out) };
}
