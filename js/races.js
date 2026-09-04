// races.js — 🧬 종족: 속성과 **평행하지만 강제가 아닌** 정체성 축
//
// 왜 별도 축인가:
//   속성(element)은 카드군이 **강제**한다 (coerceCardElement가 어긋난 카드를 갈아치운다).
//   종족은 그러면 안 된다. 두 축을 다 강제하면 "어둠 + 망자"만 가능한 카드군이 되어
//   조합이 6×8이 아니라 1이 된다. 그래서 종족은 **선택적·가산적**이다:
//     · 카드는 종족을 0~2개 가진다 (없어도 완전히 정상이다 — 무기·건축물·주문 대부분)
//     · 카드군은 `races`로 **선호**만 밝힌다. 어긋나도 갈아치우지 않고 그대로 둔다
//     · 유사도 게이트(embedding-service의 elementsOverlap)에는 **넣지 않는다** —
//       두 축을 곱하면 유사 카드군이 거의 안 잡혀 병합이 죽는다
//
// 종족이 실제로 하는 일 셋:
//   ① 이미지 — 종족 태그가 시드에 들어간다. 이게 가장 큰 값이다
//      ("수인"이라고 적어 두면 매번 같은 종류의 그림이 나온다)
//   ② 연계 — `comboScope: 'race'`로 종족 덱이 성립한다 (속성 덱과 같은 자리)
//   ③ 검색 — 보관함 필터
//
// ⚠️ 종족에 **스탯 보너스를 붙이지 마세요** (규칙 1과 같은 이유). 시너지는 연계로 줍니다.
// 🎭 로컬 플레이버 팩이 `races`로 이름·아이콘·태그를 덮습니다 (elements와 같은 경로).

/**
 * 정본 테이블. 키는 **영어 엔진 키**고 표시는 `name`이다 (규칙 47).
 * `tags`는 이미지 생성 시드에 그대로 들어가는 danbooru 태그다.
 *
 * 8종을 고른 기준: 카드 게임에서 서로 **다른 그림**이 나오는 최소 집합.
 * 늘리기 전에 "이 종족만의 그림이 있는가"를 물어보세요 — 없으면 카드군으로 충분합니다.
 *
 * `cycleRole`은 사이클(기생·성장·부화)의 **기본값 제안**일 뿐이다 (DECISIONS #107).
 * 최종 판단은 카드의 `cycleRole`이 한다 — 그래야 "기생하는 기계" 같은 예외를 만들 수 있다.
 * 여기서 종족으로 하드코딩하면 그 카드가 영영 불가능해진다.
 */
export const RACE_CONFIG = {
  human:      { name: '인간',   icon: '🧑', tags: ['1girl', 'human'],                              cycleRole: 'host' },
  beast:      { name: '수인',   icon: '🐺', tags: ['animal ears', 'tail', 'furry'],                cycleRole: 'host' },
  undead:     { name: '망자',   icon: '💀', tags: ['undead', 'pale skin', 'glowing eyes'],         cycleRole: 'vector' },
  demon:      { name: '마족',   icon: '😈', tags: ['demon horns', 'demon tail', 'pointy ears'],    cycleRole: 'both' },
  construct:  { name: '기물',   icon: '⚙️', tags: ['robot', 'mechanical parts', 'joints'],         cycleRole: 'none' },
  fae:        { name: '요정',   icon: '🧚', tags: ['fairy', 'fairy wings', 'pointy ears'],         cycleRole: 'both' },
  aberration: { name: '이형',   icon: '🪼', tags: ['monster', 'extra eyes', 'amorphous'],          cycleRole: 'vector' },
  dragon:     { name: '용족',   icon: '🐉', tags: ['dragon horns', 'dragon tail', 'scales'],       cycleRole: 'host' }
};

/** 한 카드가 가질 수 있는 종족 수 상한. 2를 넘기면 그림이 뭉개진다 (태그가 서로 싸운다). */
export const MAX_RACES_PER_CARD = 2;

export const RACE_KEYS = Object.keys(RACE_CONFIG);

export function isRace(key) {
  return Object.prototype.hasOwnProperty.call(RACE_CONFIG, key);
}

export function raceName(key) {
  const spec = RACE_CONFIG[key];
  return spec ? spec.name : key;
}

/**
 * 카드가 실제로 가진 종족 목록을 돌려준다.
 * 🐛 필드가 `races`(배열)와 `race`(단수 문자열) 두 벌로 들어온다 — LLM이 둘 다 쓴다.
 *    읽는 곳마다 따로 처리하면 한쪽만 보는 버그가 난다. 여기 한 곳에서 합친다.
 */
export function readRaces(card) {
  if (!card) return [];
  const raw = Array.isArray(card.races) ? card.races
            : (card.race ? [card.race] : []);
  const out = [];
  for (const r of raw) {
    const key = String(r || '').trim();
    if (isRace(key) && !out.includes(key)) out.push(key);
    if (out.length >= MAX_RACES_PER_CARD) break;
  }
  return out;
}

/** 카드군이 허용하는 종족. 비어 있으면 **아무거나** (제약 없음이 기본값이다) */
export function getAllowedRaces(theme) {
  if (!theme) return [];
  const list = Array.isArray(theme.races) ? theme.races.filter(isRace) : [];
  return list.slice(0, 4);
}

/**
 * 종족 정제 — 속성의 `coerceCardElement`와 **일부러 다르다.**
 * 어긋난 종족을 카드군 것으로 **갈아치우지 않는다.** 잘못된 키만 버리고,
 * 카드군이 종족을 선언했는데 카드가 하나도 없으면 그때만 대표 종족을 채운다.
 *
 * 왜: 종족은 강제 축이 아니다(파일 머리말). "수인 카드군에 인간 하나"는 정상적인 카드다.
 * @returns { races: string[], changed: boolean, reason: string|null }
 */
export function coerceCardRaces(theme, requested) {
  const asked = readRaces(Array.isArray(requested) ? { races: requested } : requested);
  const allowed = getAllowedRaces(theme);

  if (asked.length > 0) return { races: asked, changed: false, reason: null };
  if (allowed.length === 0) return { races: [], changed: false, reason: null };

  return {
    races: [allowed[0]],
    changed: true,
    reason: `종족 미지정 → 카드군 대표 종족 '${raceName(allowed[0])}'`
  };
}

/** 이미지 시드에 실을 태그. 두 종족이면 둘 다 싣되 앞쪽을 우선한다. */
export function raceImageTags(card) {
  const out = [];
  for (const key of readRaces(card)) {
    const spec = RACE_CONFIG[key];
    if (!spec || !Array.isArray(spec.tags)) continue;
    for (const t of spec.tags) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** 사람이 읽는 문구 — 카드 상세·로그용 */
export function describeRaces(card) {
  const list = readRaces(card);
  if (list.length === 0) return '';
  return list.map(k => `${RACE_CONFIG[k].icon} ${RACE_CONFIG[k].name}`).join(' · ');
}

/** 두 카드가 종족을 공유하는가 — 연계 판정의 바닥 */
export function sharesRace(a, b) {
  const ra = readRaces(a);
  if (ra.length === 0) return false;
  const rb = readRaces(b);
  return ra.some(x => rb.includes(x));
}
