// status-effects.js - 상태이상 단일 소스 (보스/플레이어 공용)
//
// 이전에는 상태이상이 battle-engine 안의 평평한 카운터 객체로만 존재해서
// burn/poison/shock은 값이 '쓰이기만' 하고 읽는 쪽이 없어 아무 효과가 없었고,
// vulnerable은 차감 로직이 없어 한 번 걸리면 전투 끝까지 유지됐다.
// 여기서 정의/적용/틱/감쇠를 한곳에 모아 양쪽 진영이 같은 규칙을 쓰게 한다.

// ⚠️ `entityOnly: true`인 상태이상은 **본체(플레이어/보스)에 걸리지 않는다.**
//    소환수·건축물에만 적용되고, 대상 소환수가 없으면 불발한다.
//
//    왜: 본체는 체력이 낮은데(플레이어 기준) 행동 봉쇄와 지속 피해는
//    너무 큰 제약이다. 한 턴을 통째로 빼앗기는 건 게임이 아니라 벌칙이고,
//    화상·맹독이 본체에 꽂히면 방어막·회복으로 대응할 여지 없이 녹는다.
//    그래서 이 계열은 **보드 컨트롤 수단**으로 못박는다.
//
//    반대로 취약(vulnerable)·감전(shock)은 본체에도 허용한다. 둘은
//    **증폭기**라서 상대가 실제로 때려야 의미가 생기고, 그 자체로는
//    체력을 깎지 않는다. 보스의 주요 색깔이기도 하다.
export const STATUS_EFFECTS = {
  stun: {
    name: '기절', icon: '💫', color: 'text-yellow-300',
    blocksTurn: true, entityOnly: true
  },
  freeze: {
    name: '빙결', icon: '❄️', color: 'text-cyan-300',
    blocksTurn: true, entityOnly: true
  },
  burn: {
    name: '화상', icon: '🔥', color: 'text-orange-300',
    defaultValue: 6, dot: true, ignoresShield: true, entityOnly: true
  },
  poison: {
    name: '맹독', icon: '☣️', color: 'text-emerald-300',
    defaultValue: 8, dot: true, ignoresShield: false, entityOnly: true
  },
  shock: {
    name: '감전', icon: '⚡', color: 'text-amber-300',
    defaultValue: 4, bonusOnHit: true
  },
  vulnerable: {
    name: '취약', icon: '💥', color: 'text-purple-300',
    damageTakenMultiplier: 1.5
  }
};

/** 이 상태이상은 소환수·건축물 전용인가 (본체에 걸 수 없는가) */
export function isEntityOnly(type) {
  const spec = STATUS_EFFECTS[type];
  return !!(spec && spec.entityOnly);
}

export function createStatusState() {
  return {};
}

// 상태이상 부여. 지속턴/수치는 기존 값과 비교해 더 강한 쪽을 남긴다(중첩 폭주 방지).
export function applyStatus(statuses, type, turns = 1, value = 0) {
  const spec = STATUS_EFFECTS[type];
  if (!statuses || !spec || type === 'none') return null;
  const t = Math.max(1, Math.floor(turns) || 1);
  const v = value || spec.defaultValue || 0;
  const cur = statuses[type];
  statuses[type] = {
    turns: cur ? Math.max(cur.turns, t) : t,
    value: cur ? Math.max(cur.value, v) : v
  };
  return statuses[type];
}

export function hasStatus(statuses, type) {
  return !!(statuses && statuses[type] && statuses[type].turns > 0);
}

export function getStatusValue(statuses, type) {
  return hasStatus(statuses, type) ? (statuses[type].value || 0) : 0;
}

export function clearStatus(statuses, type) {
  if (statuses) delete statuses[type];
}

/**
 * 행동 봉쇄 상태인지 **조회만** 한다 (턴을 소모하지 않는다).
 *
 * 🐛 왜 필요한가: 예전에는 `consumeBlockingStatus`만 있었고 그마저도
 *    **보스 본체에게만** 호출됐다. 그래서 기절(stun)은 절반만 동작했다 —
 *    소환수가 기절해도 아무 일도 일어나지 않았다. 소환수는
 *    `entity.frozen` 플래그만 봤고 그건 빙결 전용이었다.
 *
 * ⚠️ **플레이어 본체 기절은 일부러 구현하지 않는다.** 한 턴을 통째로
 *    빼앗기는 건 게임이 아니라 벌칙이다. 기절은 **소환수에만** 적용된다.
 *    (보스 본체 기절은 기존 동작이라 유지한다 — 플레이어가 템포를 사는 수단)
 *
 *    렌더링처럼 **여러 번 불리는 곳**에서 consume을 쓰면 턴이 멋대로
 *    소모된다. 그런 곳은 이 함수를 쓰세요.
 */
export function isBlocked(statuses) {
  if (!statuses) return null;
  for (const type of Object.keys(STATUS_EFFECTS)) {
    const spec = STATUS_EFFECTS[type];
    if (spec.blocksTurn && statuses[type] && statuses[type].turns > 0) return { type, spec };
  }
  return null;
}

// 턴 시작 행동 봉쇄 판정 (기절/빙결). 봉쇄되면 해당 상태를 1턴 소모하고 정보를 돌려준다.
export function consumeBlockingStatus(statuses) {
  for (const type of Object.keys(STATUS_EFFECTS)) {
    const spec = STATUS_EFFECTS[type];
    if (!spec.blocksTurn || !hasStatus(statuses, type)) continue;
    statuses[type].turns--;
    if (statuses[type].turns <= 0) delete statuses[type];
    return { type, spec };
  }
  return null;
}

// 화상/맹독 등 지속 피해 산출. 실제 체력 차감은 호출자가 담당한다.
export function collectDamageOverTime(statuses) {
  const ticks = [];
  if (!statuses) return ticks;
  for (const [type, st] of Object.entries(statuses)) {
    const spec = STATUS_EFFECTS[type];
    if (!spec || !spec.dot || !st || st.turns <= 0) continue;
    const dmg = st.value || spec.defaultValue || 0;
    if (dmg > 0) ticks.push({ type, spec, damage: dmg, ignoresShield: !!spec.ignoresShield });
  }
  return ticks;
}

// 피격 시 추가 연쇄 피해 (감전)
export function getOnHitBonusDamage(statuses) {
  let bonus = 0;
  if (!statuses) return 0;
  for (const [type, st] of Object.entries(statuses)) {
    const spec = STATUS_EFFECTS[type];
    if (spec && spec.bonusOnHit && st.turns > 0) bonus += st.value || spec.defaultValue || 0;
  }
  return bonus;
}

// 받는 피해 배율 (취약)
export function getIncomingDamageMultiplier(statuses) {
  let mult = 1;
  if (!statuses) return mult;
  for (const [type, st] of Object.entries(statuses)) {
    const spec = STATUS_EFFECTS[type];
    if (spec && spec.damageTakenMultiplier && st.turns > 0) mult *= spec.damageTakenMultiplier;
  }
  return mult;
}

// 턴 종료 시 모든 상태이상 1턴 감쇠. 만료된 목록을 돌려준다.
export function decayStatuses(statuses) {
  const expired = [];
  if (!statuses) return expired;
  for (const [type, st] of Object.entries(statuses)) {
    st.turns--;
    if (st.turns <= 0) {
      expired.push({ type, spec: STATUS_EFFECTS[type] });
      delete statuses[type];
    }
  }
  return expired;
}

// UI 배지용 요약
export function describeStatuses(statuses) {
  if (!statuses) return [];
  return Object.entries(statuses)
    .filter(([, st]) => st && st.turns > 0)
    .map(([type, st]) => {
      const spec = STATUS_EFFECTS[type] || { name: type, icon: '❔', color: 'text-slate-300' };
      return {
        type,
        icon: spec.icon,
        color: spec.color,
        label: `${spec.icon} ${spec.name}${st.value ? ` ${st.value}` : ''} (${st.turns}턴)`
      };
    });
}
