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
  // ❄️ 빙결 — **공격력 약화**. 🐛 예전엔 blocksTurn이라 기절과 코드가 **완전히 같았다**.
  //    뱃지만 "빙결/약화"라 적어 놓고 약화하는 것은 아무것도 없었다 (유저 지적) → DECISIONS #105
  //    행동 봉쇄는 기절 하나로 충분하다. 빙결은 "얼어서 제대로 못 휘두른다"로 갈랐다.
  freeze: {
    name: '빙결', icon: '❄️', color: 'text-cyan-300',
    defaultValue: 4, weakensAttack: true, entityOnly: true
  },
  // 🧪 부식 — **방어력 약화**. 빙결의 짝 (공격 약화 / 방어 약화를 서로 다른 상태이상이 맡는다)
  corrosion: {
    name: '부식', icon: '🧪', color: 'text-lime-400',
    defaultValue: 4, weakensDefense: true, entityOnly: true
  },
  burn: {
    name: '화상', icon: '🔥', color: 'text-orange-300',
    defaultValue: 6, dot: true, ignoresShield: true, entityOnly: true
  },
  poison: {
    name: '맹독', icon: '☣️', color: 'text-emerald-300',
    defaultValue: 8, dot: true, ignoresShield: false, entityOnly: true
  },
  // ⚡ 감전 — **연쇄**. 감전된 대상이 맞으면 그 진영에서 감전된 **전원**이 자기 위력만큼 함께 맞는다.
  //    (예전엔 맞은 본인에게만 추가 피해였다 — "연쇄"라는 이름값을 못 했다) → DECISIONS #105
  //    위력(value)은 **연쇄 1회당 피해량**이지 횟수가 아니다. 넓게 걸수록 한 방이 커진다.
  shock: {
    name: '감전', icon: '⚡', color: 'text-amber-300',
    defaultValue: 4, bonusOnHit: true, chains: true
  },
  vulnerable: {
    name: '취약', icon: '💥', color: 'text-purple-300',
    damageTakenMultiplier: 1.5
  },

  // 🔄 사이클 상태이상 — 소멸할 때 **다음 단계로 넘어가거나 보상을 낸다** (status-cycles.js).
  //    기생 → 성장 → 부화(토큰). 단계 자체는 평범한 상태이상이라 지속 피해·증폭·뱃지가 기존 기계로 돈다.
  //    지속 피해가 있으므로 다른 DoT와 같이 **소환수 전용**이다 (본체 DoT는 대응 수단이 없다).
  parasite: {
    name: '기생', icon: '🦠', color: 'text-lime-300',
    defaultValue: 3, dot: true, ignoresShield: false, entityOnly: true
  },
  gestation: {
    name: '성장', icon: '🌱', color: 'text-emerald-300',
    defaultValue: 5, dot: true, ignoresShield: false, entityOnly: true,
    damageTakenMultiplier: 1.25
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
 * ⚠️ **본체 기절·빙결은 양 진영 모두 구현하지 않는다.** 한 턴을 통째로
 *    빼앗기는 건 게임이 아니라 벌칙이다. 봉쇄는 **소환수에만** 적용된다.
 *    🐛 예전엔 보스 본체만 기절할 수 있었다(플레이어가 템포를 사는 수단) — 비대칭이라
 *       제거했다. 관문(battle-engine의 applyStatusRespectingScope)이 bodyStatus로도 열어주지 않는다.
 *       → DECISIONS #94
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

/**
 * ⚡ 연쇄 피해 대상 모으기 — 감전된 대상이 맞았을 때, **같은 전장의 감전된 다른 것들**을 돌려준다.
 * 각자 **자기가 가진 위력**만큼 맞는다 (수비력 무시 — 전기는 갑옷을 타고 흐른다).
 * @returns [{ entity, damage }]
 */
export function collectChainTargets(board, hitEntity) {
  if (!Array.isArray(board)) return [];
  const out = [];
  for (const e of board) {
    if (!e || e === hitEntity || !e.statuses || e.currentHp <= 0) continue;
    for (const [type, st] of Object.entries(e.statuses)) {
      const spec = STATUS_EFFECTS[type];
      if (!spec || !spec.chains || !st || st.turns <= 0) continue;
      const dmg = st.value || spec.defaultValue || 0;
      if (dmg > 0) out.push({ entity: e, damage: dmg, spec });
    }
  }
  return out;
}

/** 이 대상이 연쇄를 일으키는 상태(감전)를 가지고 있는가 */
export function hasChainStatus(statuses) {
  if (!statuses) return false;
  return Object.entries(statuses).some(([type, st]) => {
    const spec = STATUS_EFFECTS[type];
    return spec && spec.chains && st && st.turns > 0;
  });
}

/**
 * ⚔️🛡️ 능력치 약화 (빙결 = 공격력, 부식 = 방어력).
 *
 * ⚠️ **읽는 시점에 계산한다.** entity.attack/defense에 더해 저장하면 상태이상이 풀려도 수치가 안 돌아온다
 *    — 건축물 오라와 같은 이유다 (규칙 16). 영구히 깎는 것은 `attackDown` **효과**가 따로 한다.
 */
export function getAttackPenalty(statuses) {
  return sumPenalty(statuses, 'weakensAttack');
}
export function getDefensePenalty(statuses) {
  return sumPenalty(statuses, 'weakensDefense');
}
function sumPenalty(statuses, flag) {
  let n = 0;
  if (!statuses) return 0;
  for (const [type, st] of Object.entries(statuses)) {
    const spec = STATUS_EFFECTS[type];
    if (spec && spec[flag] && st && st.turns > 0) n += st.value || spec.defaultValue || 0;
  }
  return n;
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
        turns: st.turns,          // 소환수 뱃지에 남은 턴을 찍는다
        value: st.value || 0,
        label: `${spec.icon} ${spec.name}${st.value ? ` ${st.value}` : ''} (${st.turns}턴)`
      };
    });
}
