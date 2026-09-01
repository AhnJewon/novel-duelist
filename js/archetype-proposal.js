// archetype-proposal.js - 카드군 제안 & 중복 피드백 루프
//
// 문제: 카드군 생성을 LLM에게 전부 맡기면 "빙결의 절도"와 "영토 동결령"처럼
//       사실상 같은 컨셉인데 표기가 달라 게이트의 문자열 유사도로는 못 잡는
//       카드군이 난립한다. (둘 다 WATER, 둘 다 freeze 연계였다)
//
// 해결: 게이트가 '회색지대'로 판정하면 조용히 넘기지 말고 **LLM에게 되묻는다.**
//       "이 둘이 같은 카드군인가?" 판단은 의미 이해가 필요한 일이므로 LLM이 맞다.
//       문자열 유사도로 확실한 경우(STRONG 이상)는 그냥 흡수해 호출을 아낀다.

import { state } from './storage.js';
import { callOllamaChat } from './ai-service.js';
import {
  resolveArchetype, resolveArchetypeAsync, compareArchetypeIdentity, stringSimilarity,
  normalizeArchetypeName, sanitizeArchetypeKeyword,
  ARCHETYPE_SIM_STRONG
} from './archetype-service.js';
import { findSimilarArchetypes, EMBED_SIM_MERGE } from './embedding-service.js';

/**
 * 신규 카드군 후보와 겹칠 만한 기존 카드군을 찾는다.
 * 게이트가 확실히 잡지 못하는 "같은 속성 + 같은 연계" 후보까지 넓게 훑는다.
 */
export async function findRivalArchetypes(candidate, limit = 3) {
  const pool = state.archetypesList || [];
  const candName = normalizeArchetypeName(candidate.name || '');
  const conceptText = [candidate.name, candidate.keyword, candidate.element,
                       candidate.comboAction, candidate.description].filter(Boolean).join(' / ');

  // 의미 유사도 (임베딩 모델이 있을 때만. 없으면 전부 0)
  const semantic = {};
  try {
    const sims = await findSimilarArchetypes(conceptText, { topK: 10, element: candidate.element });
    sims.forEach(({ arc, similarity }) => { semantic[arc.id] = similarity; });
  } catch (e) { /* 임베딩 없으면 문자열 신호만 쓴다 */ }

  return pool
    .map(arc => {
      const nameSim = stringSimilarity(candName, normalizeArchetypeName(arc.name || ''));
      const semSim = semantic[arc.id] || 0;
      const sameElement = candidate.element && arc.element === candidate.element;
      const sameCombo = candidate.comboAction && arc.comboAction === candidate.comboAction;
      // 의미 유사도가 있으면 그쪽을 주 신호로 삼는다 (문자열보다 훨씬 정확)
      const risk = Math.max(nameSim, semSim) + (sameElement ? 0.2 : 0) + (sameCombo ? 0.2 : 0);
      return { arc, nameSim, semSim, sameElement, sameCombo, risk };
    })
    .filter(r => r.risk >= 0.35)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, limit);
}

/**
 * 회색지대 후보에 대해 LLM에게 최종 판단을 요청한다.
 *
 * @returns {Promise<{verdict:'merge'|'distinct', themeId?:string, name?:string, keyword?:string, reason?:string}>}
 */
export async function askLLMToDisambiguate(candidate, rivals, { timeoutMs = 60000 } = {}) {
  const rivalLines = rivals.map(r =>
    `- id:"${r.arc.id}" | 이름:[${r.arc.name}] | 키워드:"${r.arc.keyword}" | 속성:${r.arc.element} | 연계:${r.arc.comboAction} → ${r.arc.description || ''}`
  ).join('\n');

  const prompt = `너는 TCG 카드군(아키타입) 관리자다. 새로 제안된 카드군이 기존 카드군과 사실상 같은 것인지 판단하라.

[새로 제안된 카드군]
이름: ${candidate.name}
키워드: ${candidate.keyword}
속성: ${candidate.element}
연계: ${candidate.comboAction}
설명: ${candidate.description || '(없음)'}

[기존 카드군 중 겹칠 가능성이 있는 것들]
${rivalLines}

판단 기준:
- 컨셉·속성·연계가 실질적으로 같으면 같은 카드군이다. 표기 차이는 이유가 되지 않는다.
  예) "빙결의 절도"와 "영토 동결령"은 둘 다 물 속성 결빙 카드군이므로 **같다**.
- 정말로 다른 정체성(다른 모티프, 다른 역할)일 때만 별개다.
- 카드군은 적을수록 좋다. 애매하면 "merge"를 선택하라.

merge를 선택하면 위 목록의 id 하나를 그대로 쓴다.
distinct를 선택하면 기존 것들과 확실히 구별되도록 이름과 키워드를 다시 지어라.
키워드는 2~4글자 한국어 명사여야 한다.

JSON만 출력:
{
  "verdict": "merge" 또는 "distinct",
  "themeId": "merge일 때만, 위 목록의 id를 그대로 복사",
  "name": "distinct일 때만, 새 카드군 이름",
  "keyword": "distinct일 때만, 2~4글자 키워드",
  "reason": "한 문장 근거"
}`;

  const res = await callOllamaChat({
    messages: [
      { role: 'system', content: '너는 TCG 카드군 중복을 판정한다. JSON 객체 하나만 출력하라.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,      // 판정이므로 창의성 대신 일관성
    timeoutMs,
    reasoningMode: 'fast'
  });

  return res || { verdict: 'distinct' };
}

/**
 * 카드군 후보를 확정한다. 필요할 때만 LLM에게 되묻는다.
 *
 * @param candidate { name, keyword, element, comboAction, description }
 * @param opts      { allowFeedback } — 카드팩처럼 호출 비용이 부담되면 false
 * @returns { themeData, action:'reuse'|'merge-by-gate'|'llm-merge'|'llm-renamed'|'new', note }
 */
export async function proposeArchetype(candidate, { allowFeedback = true } = {}) {
  const cleaned = {
    ...candidate,
    name: String(candidate.name || '').trim(),
    keyword: sanitizeArchetypeKeyword(candidate.keyword, candidate.name)
  };

  // 1) 결정론적 게이트가 확실히 잡으면 그대로 흡수 (LLM 호출 없음)
  const resolved = await resolveArchetypeAsync(cleaned);
  if (resolved && !resolved.gray && (resolved.score >= ARCHETYPE_SIM_STRONG || resolved.source === 'embedding')) {
    return {
      themeData: { ...cleaned, id: resolved.match.id, name: resolved.match.name, keyword: resolved.match.keyword },
      action: 'merge-by-gate',
      note: `게이트가 [${resolved.match.name}]로 판정 (${resolved.reason})`
    };
  }

  // 2) 겹칠 위험이 있는 기존 카드군 탐색
  const rivals = await findRivalArchetypes(cleaned);
  if (rivals.length === 0) {
    return { themeData: cleaned, action: 'new', note: '유사 카드군 없음' };
  }

  if (!allowFeedback) {
    return { themeData: cleaned, action: 'new', note: `유사 후보 ${rivals.length}건 있었으나 피드백 생략` };
  }

  // 3) 회색지대 -> LLM에게 되묻는다
  try {
    const answer = await askLLMToDisambiguate(cleaned, rivals);

    if (answer.verdict === 'merge' && answer.themeId) {
      const target = (state.archetypesList || []).find(a => a.id === answer.themeId);
      if (target) {
        return {
          themeData: { ...cleaned, id: target.id, name: target.name, keyword: target.keyword },
          action: 'llm-merge',
          note: `LLM 판정: [${target.name}]로 통합 — ${answer.reason || ''}`
        };
      }
    }

    if (answer.verdict === 'distinct' && answer.name) {
      const renamed = {
        ...cleaned,
        name: String(answer.name).trim(),
        keyword: sanitizeArchetypeKeyword(answer.keyword, answer.name)
      };
      // 다시 지은 이름이 또 겹치면 게이트가 흡수한다
      const recheck = await resolveArchetypeAsync(renamed);
      if (recheck && recheck.score >= ARCHETYPE_SIM_STRONG) {
        return {
          themeData: { ...renamed, id: recheck.match.id, name: recheck.match.name, keyword: recheck.match.keyword },
          action: 'merge-by-gate',
          note: `재명명 후에도 [${recheck.match.name}]와 동일 판정`
        };
      }
      return { themeData: renamed, action: 'llm-renamed', note: `LLM 판정: 별개 — ${answer.reason || ''}` };
    }
  } catch (e) {
    console.warn('[Archetype] 중복 피드백 실패, 원안대로 진행:', e.message);
  }

  return { themeData: cleaned, action: 'new', note: '피드백 무응답 — 원안 채택' };
}
