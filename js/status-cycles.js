// status-cycles.js - 여러 턴에 걸쳐 **단계를 밟는** 상태이상 (DECISIONS #104)
//
// 기존 상태이상은 전부 "N턴 동안 X" 하나짜리다. 사이클은 그게 아니라 **연쇄**다:
//
//   🦠 기생 ──(소멸)──▶ 🌱 성장 ──(소멸)──▶ 🐣 부화(보상)
//
// 각 단계는 평범한 상태이상이므로 지속 피해·증폭·뱃지·감쇠가 전부 기존 기계로 돈다.
// 이 파일이 더하는 것은 **"단계가 끝났을 때 무슨 일이 일어나는가"** 하나뿐이다.
//
// ⚠️ 이 파일은 battle-engine을 import 하지 않는다 (엔진 → 사이클 한 방향). 엔진 동작은 ctx로 받는다.
//    status-effects.js·battle-rules.js는 import가 없어 순환이 생기지 않는다.
//
// ── 설계 결정 (유저 질문에 대한 답) ─────────────────────────
// Q. 부화한 토큰은 **누구** 자리에 나오나?
//    → **디버프를 건 쪽**(숙주의 반대편). 사이클은 카드 한 장 + 두세 턴을 쓰는 투자이고,
//      당한 쪽에 몸을 하나 주면 오히려 벽이 생겨 의도가 뒤집힌다. 숙주를 뚫고 나오는 그림이기도 하다.
//      (반대로 하고 싶으면 `payoff.toHostSide: true` 한 줄이면 된다)
// Q. 전장이 꽉 차 있으면?
//    → **한 턴 기다린다**(같은 단계 유지). 자리를 비울 기회를 주는 것이 소환을 핵심으로 남기는 길이다.
//      그래도 자리가 없으면 숙주 안에서 터져 `burstDamage`가 들어간다 — 불발로 사라지지는 않는다.
// Q. 도중에 숙주가 죽으면?
//    → **사이클도 사라진다.** 상태이상은 소환수 객체에 붙어 있으므로 코드가 따로 할 일이 없다.
//      이건 버그가 아니라 **상대의 대응 수단**이다 — 감염된 소환수를 먼저 정리하면 부화를 막는다.

import { applyStatus } from './status-effects.js';
import { SLOT_CAP } from './battle-rules.js';

/**
 * 사이클 표. 키는 상태이상 타입이다.
 *   `next`    — 이 단계가 끝나면 걸리는 다음 단계
 *   `payoff`  — 마지막 단계가 끝났을 때의 보상 (토큰 소환)
 *
 * 🎭 로컬 플레이버 팩이 이 표를 덮어 이름·수치를 바꿀 수 있다 (DECISIONS #103).
 */
export const STATUS_CYCLES = {
  parasite: {
    next: 'gestation',
    nextTurns: 2,
    advanceLog: (host, spec) => `🌱 [${host}] 기생체가 자라 ${spec.name} 단계로 들어갑니다.`
  },
  gestation: {
    payoff: {
      tokenName: '기생체',
      attack: 6, defense: 2, hp: 12,
      element: 'nature',
      hostDamage: 6,      // 뚫고 나오며 숙주가 입는 피해
      burstDamage: 10,    // 자리가 없어 안에서 터질 때 숙주가 입는 피해
      holdTurns: 1        // 자리가 날 때까지 기다리는 턴 수
    }
  }
};

/** 이 상태이상이 사이클의 일부인가 */
export function isCycleStatus(type) {
  return !!STATUS_CYCLES[type];
}

/**
 * 사이클 단계 하나가 **소멸했을 때** 호출한다.
 *
 * @param type 소멸한 상태이상 타입
 * @param ctx  {
 *   host,           // 숙주 소환수 객체
 *   hostLabel,      // 로그용 이름 (이스케이프된 문자열)
 *   foeMinions,     // 보상 토큰이 들어갈 전장 배열 (= 디버프를 건 쪽)
 *   turnCount,
 *   statusName,     // (type) => 표시 이름   — 플레이버 팩이 바꾼 이름을 쓰기 위해
 *   log,            // (html) => void
 *   damageHost      // (n) => void  숙주에게 피해 (수비력 무시)
 * }
 * @returns { kind: 'advanced'|'summoned'|'held'|'burst'|'none', ... }
 */
export function resolveCycleExpiry(type, ctx) {
  const cycle = STATUS_CYCLES[type];
  if (!cycle) return { kind: 'none' };
  const { host, hostLabel, foeMinions, turnCount = 0, statusName = (t) => t, log = () => {}, damageHost = () => {} } = ctx;
  if (!host || !host.statuses) return { kind: 'none' };

  // ① 다음 단계로
  if (cycle.next) {
    applyStatus(host.statuses, cycle.next, cycle.nextTurns || 2, cycle.nextValue || 0);
    log(`<span class="text-lime-300">🌱 [${hostLabel}] ${statusName(type)} → <b>${statusName(cycle.next)}</b> 단계로 진행!</span>`);
    return { kind: 'advanced', to: cycle.next };
  }

  const p = cycle.payoff;
  if (!p) return { kind: 'none' };
  const slots = Array.isArray(foeMinions) ? foeMinions : null;

  // ② 자리가 없으면 한 턴 기다린다 — 소환이 이 사이클의 핵심이라 불발로 날리지 않는다
  if (!slots || slots.length >= SLOT_CAP) {
    host._cycleHold = (host._cycleHold || 0) + 1;
    if (host._cycleHold <= (p.holdTurns ?? 1)) {
      applyStatus(host.statuses, type, 1, 0);   // 같은 단계를 1턴 연장
      log(`<span class="text-slate-400">🥚 [${hostLabel}] 자리가 없어 ${statusName(type)}이(가) 한 턴 미뤄집니다.</span>`);
      return { kind: 'held', held: host._cycleHold };
    }
    delete host._cycleHold;
    damageHost(p.burstDamage || p.hostDamage || 0);
    log(`<span class="text-rose-400 font-bold">💥 [${hostLabel}] 나올 자리가 없어 안에서 터졌습니다! (-${p.burstDamage || p.hostDamage || 0})</span>`);
    return { kind: 'burst' };
  }

  // ③ 부화 — 디버프를 건 쪽 전장에 토큰이 선다
  delete host._cycleHold;
  const id = `cycle-${type}-${turnCount}-${slots.length}-${Math.floor(Math.random() * 1000)}`;
  const token = {
    id, instanceId: id,
    name: p.tokenName || '기생체',
    cardType: 'unit',
    element: p.element || 'nature',
    attack: p.attack || 5, defense: p.defense || 2,
    maxHp: p.hp || 12, currentHp: p.hp || 12,
    // ⚠️ 소환 후유증 — 없으면 나오자마자 때린다
    canAttack: false, summonedTurn: turnCount, frozen: false, statuses: {},
    isToken: true, skills: [{}]
  };
  slots.push(token);
  damageHost(p.hostDamage || 0);
  log(`<span class="text-emerald-300 font-bold">🐣 [${hostLabel}]을(를) 뚫고 [${token.name}]이(가) 태어났습니다! (${token.attack}/${token.defense}/${token.maxHp})</span>`);
  return { kind: 'summoned', token };
}
