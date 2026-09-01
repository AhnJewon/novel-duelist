// card-naming.js - 카드 타입에 어울리는 이름 규칙
//
// 문제: 구조물 카드에 "심연의 그림자 암살자" 같은 **소환수 이름**이 붙었다.
//       주문 카드에 인물 이름이 붙기도 했다.
//
// 원인 셋:
//   1) 카드팩이 baseConcept를 cardType과 **무관하게** 골랐다.
//      (구조물 롤인데 "그림자 속의 암흑 뱀파이어" 컨셉을 받음)
//   2) LLM 프롬프트에 타입별 작명 규칙이 없었다.
//   3) LLM이 규칙을 어겨도 걸러내는 검사가 없었다.
//
// 이 모듈이 셋 다 담당한다. 작명 규칙을 바꾸고 싶으면 **여기 한 곳만** 고치세요.
//
// 한국어 카드 이름은 **끝 단어가 정체를 결정한다** ("~의 암살자" / "~의 제단").
// 그래서 접미 어휘로 판정한다.

/**
 * 타입별 작명 규칙.
 *
 *   head      — 이름 끝에 와야 하는 어휘 (이게 카드의 정체를 말한다)
 *   forbidden — 이 타입에 쓰면 안 되는 어휘 (다른 타입의 head)
 *   label     — 한국어 타입명
 *   guide     — LLM에게 줄 지시문
 *   fallback  — 규칙 위반 시 이름을 재조립할 때 쓸 접미사
 */
export const CARD_TYPE_NAMING = {
  unit: {
    label: '소환수',
    head: ['검사', '검성', '암살자', '마도사', '대마도사', '사제', '수호사제', '기사', '성기사',
           '용병', '전사', '무투가', '궁수', '대궁수', '마왕', '군주', '여왕', '왕', '사도',
           '발키리', '드래곤', '흑염룡', '비룡', '골렘', '슬라임', '해골', '망령', '뱀파이어',
           '엘프', '요정', '정령', '수호자', '파수꾼', '추적자', '사냥꾼', '광전사', '술사',
           '마녀', '무녀', '성녀', '신관', '집행자', '처형자', '수확자', '방랑자', '순례자'],
    forbidden: ['제단', '첨탑', '수정탑', '요새', '성벽', '결계', '신전', '분수대', '포탑', '철옹성',
                '술', '격', '파', '진', '의식', '주문', '일격', '스트라이크', '폭발',
                '함정', '올가미', '매복', '역습', '반격', '봉인'],
    guide: '인물·생물의 이름. 반드시 직책이나 종족으로 끝낼 것 (예: "홍련의 검성 아스카", "심연의 암살자 레이븐")'
  },
  spell: {
    label: '주문',
    head: ['술', '주술', '마술', '비술', '격', '일격', '타격', '파', '폭발', '폭격', '강림',
           '의식', '주문', '선언', '각인', '봉인술', '수확술', '연성', '해방', '개방',
           '스트라이크', '버스트', '노바', '레이', '블래스트', '웨이브', '스톰', '리프'],
    forbidden: ['검사', '검성', '암살자', '마도사', '사제', '기사', '용병', '전사', '발키리',
                '드래곤', '골렘', '마녀', '군주', '마왕', '수호자',
                '제단', '첨탑', '요새', '성벽', '결계', '신전', '포탑',
                '함정', '올가미', '매복'],
    guide: '행위·현상의 이름. 인물 이름을 쓰지 말 것. 술/격/파/의식/스트라이크 등으로 끝낼 것 (예: "종말의 메테오 스트라이크", "칠흑의 영혼 수확술")'
  },
  structure: {
    label: '건축물',
    head: ['제단', '첨탑', '수정탑', '탑', '요새', '철옹성', '성', '성벽', '결계', '신전',
           '사원', '분수대', '포탑', '방벽', '관문', '문', '보루', '주둔지', '거점',
           '유적', '묘소', '무덤', '심장부', '중추', '코어', '기지'],
    forbidden: ['검사', '검성', '암살자', '마도사', '사제', '기사', '용병', '전사', '발키리',
                '드래곤', '골렘', '마녀', '군주', '마왕', '뱀파이어', '엘프', '궁수',
                '술', '격', '일격', '스트라이크', '폭발',
                '함정', '올가미', '매복'],
    guide: '장소·건조물의 이름. 인물 이름을 절대 쓰지 말 것. 제단/첨탑/요새/결계/신전 등으로 끝낼 것 (예: "심연의 마왕 제단", "마력 수호의 첨탑")'
  },
  trap: {
    label: '함정',
    head: ['함정', '올가미', '매복', '역습', '반격', '봉인', '계략', '술책', '덫', '족쇄',
           '사슬', '결계진', '역전', '차단', '무효화', '응수', '보복', '저주'],
    forbidden: ['검사', '검성', '암살자', '마도사', '사제', '기사', '용병', '전사', '발키리',
                '드래곤', '골렘', '마녀', '군주', '마왕',
                '제단', '첨탑', '요새', '성벽', '신전', '포탑'],
    guide: '상대 행동에 반응하는 계략의 이름. 함정/올가미/매복/역습/반격/봉인 등으로 끝낼 것 (예: "심연의 그림자 올가미", "성역의 반격 결계진")'
  }
};

export function getNamingSpec(cardType) {
  return CARD_TYPE_NAMING[cardType] || CARD_TYPE_NAMING.unit;
}

/** LLM 프롬프트에 넣을 타입별 작명 지시문 */
export function buildNamingRule(cardType) {
  const spec = getNamingSpec(cardType);
  return `- 이 카드는 **${spec.label}(${cardType})** 이다. 이름은 ${spec.guide}\n` +
         `- 금지: 이름을 ${spec.forbidden.slice(0, 8).join(', ')} 같은 다른 타입의 단어로 끝내지 말 것.`;
}

/** 소환수를 뺀 나머지 타입의 head 총집합 — "사물 이름"으로 끝났다는 신호 */
const NON_UNIT_HEADS = ['spell', 'structure', 'trap']
  .flatMap(t => CARD_TYPE_NAMING[t].head);

/**
 * 이름이 이 타입에 어울리는가.
 *
 * 🐛 예전에는 "다른 타입 단어를 **포함**하지 않으면 통과"로 봤다. 두 방향으로 틀렸다.
 *   · 놓침: "홍련의 검성 아스카"(주문), "빙결의 대마도사 루시아"(건축물)가 통과했다.
 *           고유명사로 끝나서 끝단어 검사를 빠져나갔다.
 *   · 오탐: "심연의 마왕 제단"(건축물)을 막았다. 마왕은 수식어일 뿐 정체가 아니다.
 *
 * 한국어 카드 이름은 **끝 단어가 정체를 결정한다.** 그래서 기준을 뒤집었다:
 *   주문·건축물·함정 — 반드시 자기 타입의 head로 **끝나야** 한다.
 *   소환수           — 고유명사로 끝나는 게 자연스러우므로(아스카, 카엘)
 *                      "다른 타입의 head로 끝나지만 않으면" 통과.
 */
export function nameMatchesType(name = '', cardType = 'unit') {
  const n = String(name || '').trim();
  if (!n) return false;

  if (cardType === 'unit') {
    return !NON_UNIT_HEADS.some(w => n.endsWith(w));
  }
  const spec = getNamingSpec(cardType);
  return spec.head.some(w => n.endsWith(w));
}

/** 이 이름이 정확히 어떤 타입처럼 보이는지 (진단용) */
export function detectNameType(name = '') {
  const n = String(name || '').trim();
  for (const [type, spec] of Object.entries(CARD_TYPE_NAMING)) {
    if (spec.head.some(w => n.endsWith(w))) return type;
  }
  return null;
}

/**
 * 타입에 안 맞는 이름을 고친다.
 *
 * 통째로 새로 짓지 않고 **수식어는 살린다** — LLM이 만든 분위기를 버리면 아깝다.
 *   "심연의 그림자 암살자" (구조물)  →  "심연의 그림자 제단"
 *
 * @param {string} name      원래 이름
 * @param {string} cardType  unit|spell|structure|trap
 * @param {function} rand    0~1 난수 함수 (전투 밖이라 Math.random 기본값)
 */
export function fixCardName(name = '', cardType = 'unit', rand = Math.random) {
  const spec = getNamingSpec(cardType);
  let n = String(name || '').trim();
  if (!n) n = spec.label;

  if (nameMatchesType(n, cardType)) return n;

  // 끝에 붙은 **다른 타입의 정체 단어**를 떼어낸다.
  // 긴 단어부터 지워야 "대마도사"가 "마도사"보다 먼저 잡힌다.
  const others = Object.entries(CARD_TYPE_NAMING)
    .filter(([t]) => t !== cardType)
    .flatMap(([, s]) => s.head)
    .sort((a, b) => b.length - a.length);
  for (const w of others) {
    if (n.endsWith(w)) { n = n.slice(0, -w.length).trim(); break; }
  }

  // 소환수 이름은 고유명사로 끝난다 ("심연의 암살자 카엘").
  // 위에서 못 떼어냈다면 마지막 토큰이 고유명사이므로 그것도 버린다.
  if (n === String(name || '').trim()) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length > 1) n = parts.slice(0, -1).join(' ');
  }

  // 떼고 남은 꼬리 조사 정리 ("심연의 그림자 " / "~의")
  n = n.replace(/[의,\s]+$/g, '').trim();

  // ⚠️ 판정에는 1글자 head('술','격','파')도 쓰지만 **이름을 지을 때는 쓰지 않는다.**
  //    "홍련의 검성 격" 같은 어색한 이름이 나온다.
  const pool = spec.head.filter(w => w.length >= 2);
  const head = pool[Math.floor(rand() * pool.length)] || spec.label;
  if (!n) return head;
  return `${n} ${head}`;
}

/**
 * 컨셉 문구가 어떤 타입에 어울리는지 추정한다.
 * 카드팩이 cardType에 맞는 컨셉을 고르는 데 쓴다.
 * (판정 못 하면 null — 아무 타입에나 써도 되는 중립 컨셉)
 */
export function conceptTypeHint(concept = '') {
  return detectNameType(concept);
}
