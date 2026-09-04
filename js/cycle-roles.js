// cycle-roles.js - 🧬 사이클 역할: **누가 걸 수 있고 누가 걸릴 수 있는가** (DECISIONS #107)
//
// 사이클(기생 → 성장 → 부화, `status-cycles.js`)은 다른 상태이상과 달리
// **아무한테나 걸리면 설정이 무너진다.** 기계에 기생충이 자랄 수는 없고,
// 인간이 남의 몸에 알을 심지도 않는다. 반대로 "기생하는 기계"는 만들 수 있어야 한다.
//
// ⚠️ 그래서 이건 **종족과 별개의 파라미터**다. 종족은 기본값만 제안하고,
//    최종 판단은 카드의 `cycleRole`이 한다. 종족으로 하드코딩하면
//    "기생 기계"·"알을 낳는 인간" 같은 예외 카드를 영영 만들 수 없다.
//
//   race(무엇인가)  →  기본 역할 제안  →  card.cycleRole(이 개체는 어떤가)  →  최종
//
// ── 두 방향을 **다른 층에서** 막는다 ──────────────────────────
//   받는 쪽 (host)  : **실행 시**. 걸 수 없는 대상이면 걸 수 있는 소환수로 넘긴다.
//                     대상이 하나도 없으면 불발하고 이유를 로그에 남긴다.
//   거는 쪽 (vector): **설계 시**(sanitize). 못 거는 카드에서 사이클 효과를 아예 뗀다.
//                     실행 시에 막으면 손에 든 순간부터 죽은 카드가 된다 — 그건 나쁜 카드지 규칙이 아니다.
//
// 이 파일은 races.js만 import한다 (races.js는 import 0). 순환이 없다.

import { RACE_CONFIG, readRaces } from './races.js';

/**
 * 역할 표. `canGive`/`canHost` 두 불리언의 네 조합이 전부다.
 * 🎭 로컬 플레이버 팩이 이름·아이콘을 덮을 수 있다 (속성·종족과 같은 경로).
 */
export const CYCLE_ROLES = {
  none:   { name: '무관', icon: '🚫', canGive: false, canHost: false,
            desc: '사이클과 무관하다. 걸지도, 걸리지도 않는다 (기계·구조물).' },
  host:   { name: '숙주', icon: '🥚', canGive: false, canHost: true,
            desc: '걸릴 수만 있다. 남에게 옮기지는 못한다.' },
  vector: { name: '매개', icon: '🦟', canGive: true,  canHost: false,
            desc: '걸 수만 있다. 자기는 걸리지 않는다.' },
  both:   { name: '양쪽', icon: '♾️', canGive: true,  canHost: true,
            desc: '걸 수도, 걸릴 수도 있다.' }
};

/**
 * 종족도 카드도 아무 말이 없을 때의 값.
 * `both`(제약 없음)인 이유: 종족이 없는 카드는 대부분 주문·건축물이고, 그건 **개체가 아니라
 * 외부에서 오는 힘**이다. 생물학적 제약을 걸 근거가 없다. 제약은 몸을 가진 것에만 건다.
 */
export const DEFAULT_CYCLE_ROLE = 'both';

export const CYCLE_ROLE_KEYS = Object.keys(CYCLE_ROLES);

export function isCycleRole(key) {
  return Object.prototype.hasOwnProperty.call(CYCLE_ROLES, key);
}

/**
 * 이 카드/개체의 사이클 역할. 우선순위: 카드가 직접 말한 것 > 종족 기본값 > DEFAULT.
 *
 * 종족이 둘이면 **더 넓은 쪽**을 쓴다 (canGive/canHost를 각각 OR).
 * 좁은 쪽을 쓰면 다종족 카드가 두 종족의 제약을 **동시에** 받아 거의 항상 `none`이 된다.
 */
export function readCycleRole(card) {
  if (!card) return DEFAULT_CYCLE_ROLE;
  if (isCycleRole(card.cycleRole)) return card.cycleRole;

  const races = readRaces(card);
  if (races.length === 0) return DEFAULT_CYCLE_ROLE;

  let give = false, host = false, sawAny = false;
  for (const r of races) {
    const key = RACE_CONFIG[r] && RACE_CONFIG[r].cycleRole;
    if (!isCycleRole(key)) continue;
    sawAny = true;
    give = give || CYCLE_ROLES[key].canGive;
    host = host || CYCLE_ROLES[key].canHost;
  }
  if (!sawAny) return DEFAULT_CYCLE_ROLE;
  return roleFor(give, host);
}

/** 두 불리언 → 역할 키 */
export function roleFor(canGive, canHost) {
  if (canGive && canHost) return 'both';
  if (canGive) return 'vector';
  if (canHost) return 'host';
  return 'none';
}

/** 이 개체에게 사이클을 **걸 수 있는가** (숙주가 될 수 있는가) */
export function canHostCycle(entity) {
  return !!CYCLE_ROLES[readCycleRole(entity)].canHost;
}

/** 이 카드가 사이클을 **걸 수 있는가** (알을 심을 수 있는가) */
export function canSeedCycle(card) {
  return !!CYCLE_ROLES[readCycleRole(card)].canGive;
}

/**
 * 이 상태이상을 이 개체에게 걸 수 있는가.
 * 사이클이 **아닌** 상태이상은 이 축과 무관하므로 항상 true다 — 화상·기절까지 막으면 안 된다.
 *
 * @param isCycle `isCycleStatus(type)`의 결과를 넘긴다 (status-cycles를 import하면 순환이 생긴다)
 */
export function canReceiveCycleStatus(entity, isCycle) {
  if (!isCycle) return true;
  return canHostCycle(entity);
}

/**
 * 전장에서 **숙주가 될 수 있는** 첫 소환수를 고른다.
 * 사이클이 아니면 그냥 맨 앞(기존 규칙)을 돌려준다.
 */
export function pickCycleHost(minions, isCycle) {
  const alive = (minions || []).filter(m => m && m.currentHp > 0);
  if (!isCycle) return alive[0] || null;
  return alive.find(canHostCycle) || null;
}

/** 사람이 읽는 문구 — 카드 상세용. 제약이 없으면(both) 빈 문자열이라 화면이 조용하다. */
export function describeCycleRole(card) {
  const key = readCycleRole(card);
  if (key === DEFAULT_CYCLE_ROLE) return '';
  const spec = CYCLE_ROLES[key];
  return `${spec.icon} ${spec.name}`;
}
