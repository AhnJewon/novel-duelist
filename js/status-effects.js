// status-effects.js - 상태이상 단일 소스 (보스/플레이어 공용)
//
// 이전에는 상태이상이 battle-engine 안의 평평한 카운터 객체로만 존재해서
// burn/poison/shock은 값이 '쓰이기만' 하고 읽는 쪽이 없어 아무 효과가 없었고,
// vulnerable은 차감 로직이 없어 한 번 걸리면 전투 끝까지 유지됐다.
// 여기서 정의/적용/틱/감쇠를 한곳에 모아 양쪽 진영이 같은 규칙을 쓰게 한다.

export const STATUS_EFFECTS = {
  stun: {
    name: '기절', icon: '💫', color: 'text-yellow-300',
    blocksTurn: true
  },
  freeze: {
    name: '빙결', icon: '❄️', color: 'text-cyan-300',
    blocksTurn: true
  },
  burn: {
    name: '화상', icon: '🔥', color: 'text-orange-300',
    defaultValue: 6, dot: true, ignoresShield: true
  },
  poison: {
    name: '맹독', icon: '☣️', color: 'text-emerald-300',
    defaultValue: 8, dot: true, ignoresShield: false
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
