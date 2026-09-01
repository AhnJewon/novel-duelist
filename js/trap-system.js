// trap-system.js - 함정 카드 (조건부 발동)
//
// 기존 액션은 전부 **즉발**이었다. 카드를 내면 바로 효과가 터진다.
// 함정은 다르다: 뒷면으로 세트해두고, **상대가 특정 조건을 만족하면** 자동 발동한다.
//
//   "상대가 화염 속성 카드를 낼 때"
//   "상대가 [홍련] 카드군 카드를 낼 때"
//   "상대 카드에 '실드 관통' 키워드가 있을 때"
//
// 밸런스: 동시에 세트할 수 있는 함정 수를 제한한다(TRAP_ZONE_SIZE).
//         제한이 없으면 함정만 깔아두는 덱이 무적이 된다.

import { escapeHtml } from './dom-utils.js';

/** 동시에 세트 가능한 함정 수. 이걸 늘리면 함정 덱이 급격히 강해진다. */
export const TRAP_ZONE_SIZE = 3;

/**
 * 함정 발동 조건.
 *
 * match(ctx) — ctx: { event, card, side, foe, game, trap }
 *   event: 무슨 일이 일어났는가 ('playCard' | 'attack' | 'turnStart' | 'damaged')
 *   card : 그 일을 일으킨 카드 (있으면)
 *
 * ⚠️ 조건은 **상대의 행동**에 반응한다. 내 행동에는 발동하지 않는다.
 */
export const TRAP_TRIGGERS = {
  foePlaysUnit: {
    label: '상대가 소환수를 낼 때',
    needs: null,
    match: ({ event, card }) => event === 'playCard' && (card.cardType || 'unit') === 'unit'
  },
  foePlaysSpell: {
    label: '상대가 주문을 쓸 때',
    needs: null,
    match: ({ event, card }) => event === 'playCard' && card.cardType === 'spell'
  },
  foePlaysStructure: {
    label: '상대가 건축물을 세울 때',
    needs: null,
    match: ({ event, card }) => event === 'playCard' && card.cardType === 'structure'
  },
  foeTrapActivates: {
    label: '상대의 함정이 발동할 때',
    needs: null,
    // ⚠️ 함정을 **세울 때**가 아니라 **발동할 때** 반응한다.
    //    세트에 반응하면 뒷면 정보가 새어 나가 함정의 의미가 사라진다.
    match: ({ event }) => event === 'trapFired'
  },
  foePlaysElement: {
    label: '상대가 특정 속성 카드를 낼 때',
    needs: 'element',          // trap.condition.element 에 속성 지정
    match: ({ event, card, trap }) =>
      event === 'playCard' && card.element === (trap.condition && trap.condition.element)
  },
  foePlaysArchetype: {
    label: '상대가 특정 카드군 카드를 낼 때',
    needs: 'archetype',        // trap.condition.archetype 에 카드군명/키워드
    match: ({ event, card, trap }) => {
      if (event !== 'playCard') return false;
      const want = trap.condition && trap.condition.archetype;
      if (!want) return false;
      return card.themeName === want
        || card.themeKeyword === want
        || (card.name && card.name.includes(want));
    }
  },
  foePlaysKeyword: {
    label: '상대 카드가 특정 키워드를 가질 때',
    needs: 'keyword',          // trap.condition.keyword — 예: 'pierceShield'
    match: ({ event, card, trap }) => {
      if (event !== 'playCard') return false;
      const key = trap.condition && trap.condition.keyword;
      if (!key) return false;
      const skill = (card.skills && card.skills[0]) || card.skill || {};
      if (key === 'statusEffect') return !!(skill.statusEffect && skill.statusEffect.type !== 'none');
      return !!skill[key];
    }
  },
  foeAttacks: {
    label: '상대가 공격할 때',
    needs: null,
    match: ({ event }) => event === 'attack'
  },
  selfLowHp: {
    label: '내 체력이 절반 이하가 될 때',
    needs: null,
    match: ({ event, side }) => event === 'damaged' && side.hp <= side.maxHp * 0.5
  },
  foeShielded: {
    label: '상대가 방어막을 두를 때',
    needs: null,
    match: ({ event, foe }) => event === 'shielded' && foe.shield > 0
  }
};

export function normalizeTrapTrigger(t) {
  return TRAP_TRIGGERS[t] ? t : 'foePlaysUnit';
}

/** 함정 설명문 생성 */
export function describeTrap(trap) {
  const spec = TRAP_TRIGGERS[normalizeTrapTrigger(trap.trapTrigger)];
  const cond = trap.condition || {};
  let detail = spec.label;
  if (spec.needs === 'element' && cond.element) detail = `상대가 ${cond.element} 속성 카드를 낼 때`;
  if (spec.needs === 'archetype' && cond.archetype) detail = `상대가 [${cond.archetype}] 카드를 낼 때`;
  if (spec.needs === 'keyword' && cond.keyword) detail = `상대 카드가 '${cond.keyword}'를 가질 때`;
  return detail;
}

/**
 * 세트된 함정 중 조건에 맞는 것을 찾아 발동한다.
 *
 * @param zone     세트된 함정 배열 (발동한 것은 제거된다)
 * @param ctx      { event, card, side, foe, game }
 * @param fire     실제 효과를 실행할 콜백 (trap) => void
 * @returns 발동한 함정 목록
 */
export function checkTraps(zone, ctx, fire) {
  if (!zone || zone.length === 0) return [];
  const fired = [];

  // 한 이벤트에 여러 함정이 걸릴 수 있다. 세트한 순서대로 발동한다.
  for (const trap of [...zone]) {
    const spec = TRAP_TRIGGERS[normalizeTrapTrigger(trap.trapTrigger)];
    let matched = false;
    try {
      matched = spec.match({ ...ctx, trap });
    } catch (e) {
      console.warn('[Trap] 조건 판정 오류:', e);
    }
    if (!matched) continue;

    const idx = zone.indexOf(trap);
    if (idx !== -1) zone.splice(idx, 1);   // 발동한 함정은 소모된다
    fired.push(trap);
    fire(trap);
  }
  return fired;
}

/** 함정 세트 가능 여부 */
export function canSetTrap(zone) {
  if (zone.length >= TRAP_ZONE_SIZE) {
    return { ok: false, reason: `함정 구역이 가득 참 (최대 ${TRAP_ZONE_SIZE})` };
  }
  return { ok: true };
}

/** 세트된 함정 UI (뒷면 — 내용은 안 보인다) */
export function renderTrapZone(zone, { revealed = false } = {}) {
  if (!zone || zone.length === 0) return '';
  return zone.map(t => revealed
    ? `<span class="px-2 py-0.5 rounded-lg bg-indigo-950/90 border border-indigo-400 text-[10px] font-bold text-indigo-200" title="${escapeHtml(describeTrap(t))}">🪤 ${escapeHtml(t.name)}</span>`
    : `<span class="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-600 text-[10px] font-bold text-slate-400">🂠 세트</span>`
  ).join(' ');
}
