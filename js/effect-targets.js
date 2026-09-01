// effect-targets.js - 효과의 "대상" 스키마
//
// 문제: 카드 설명은 "적 하나를 얼린다"처럼 읽히는데 스킬 데이터에는
//       `{ damage, freeze, shield }` 같은 **수치 필드만** 있었다.
//       누구를, 몇을 고르는지에 대한 정보가 아예 없어서 대상을 지정할 수 없었다.
//
// 여기서 그 메타데이터를 정의한다. 대상 규칙을 바꾸고 싶으면 **이 파일 한 곳**만 본다.
//
// ⚠️ 대상이 늘면 카드가 강해진다. 반드시 등급·마나 예산에 반영해야 한다
//    (config.js의 targetCostMultiplier). 안 그러면 "전체 대상 20 피해"가
//    "단일 20 피해"와 같은 값으로 취급된다.

// ── 진영 ─────────────────────────────────────────────────────
export const TARGET_SIDES = {
  foe:   { label: '적',      desc: '상대 진영을 노린다' },
  ally:  { label: '아군',    desc: '내 진영을 대상으로 한다 (버프·치유)' },
  self:  { label: '자신',    desc: '이 카드 자신에게만 적용' },
  any:   { label: '아무나',  desc: '양 진영 어디든 고를 수 있다' }
};

// ── 범위 ─────────────────────────────────────────────────────
//
// 배수는 "단일 대비 몇 배로 강한가"다.
// all(전체)을 2.2로 둔 이유: 광역은 판을 통째로 정리해 단순 2배 이상의 값을 한다.
export const TARGET_SCOPES = {
  single: { label: '단일',   mult: 1.0,  needsPick: true,  desc: '하나를 지정한다' },
  multi:  { label: '다중',   mult: null, needsPick: true,  desc: 'N개를 지정한다 (targetCount)' },
  all:    { label: '전체',   mult: 2.2,  needsPick: false, desc: '해당 진영 전체' },
  random: { label: '무작위', mult: 0.8,  needsPick: false, desc: '무작위로 고른다 — 지정보다 약하다' }
};

export const MAX_TARGET_COUNT = 3;

/** 스킬에서 대상 규칙을 읽어 정규화한다. 없으면 안전한 기본값. */
export function readTargetSpec(skill = {}) {
  // 구버전 호환: isAoeSpell은 "적 전체"였다
  if (!skill.targetScope && skill.isAoeSpell) {
    return { side: 'foe', scope: 'all', count: 0 };
  }

  const side = TARGET_SIDES[skill.targetSide] ? skill.targetSide : 'foe';
  const scope = TARGET_SCOPES[skill.targetScope] ? skill.targetScope : 'single';
  let count = parseInt(skill.targetCount, 10);
  if (!Number.isFinite(count)) count = scope === 'multi' ? 2 : 1;
  count = Math.max(1, Math.min(MAX_TARGET_COUNT, count));

  return { side, scope, count: scope === 'multi' ? count : (scope === 'single' ? 1 : 0) };
}

/**
 * 대상 규칙이 카드 위력에 곱하는 배수.
 *
 * 이 값이 효과 비용에 곱해져 등급·마나 예산에 반영된다.
 * "전체 대상 피해"는 "단일 피해"보다 2.2배 비싸다.
 */
export function targetCostMultiplier(skill = {}) {
  const { scope, count } = readTargetSpec(skill);
  if (scope === 'multi') {
    // 2개 1.5배, 3개 2.0배 — 하나 늘 때마다 0.5배씩
    return 1 + 0.5 * (Math.max(1, count) - 1);
  }
  const m = TARGET_SCOPES[scope];
  return (m && m.mult) || 1;
}

/** 이 효과가 플레이어의 대상 지정을 요구하는가 */
export function needsTargetPick(skill = {}) {
  const { scope, side } = readTargetSpec(skill);
  if (!TARGET_SCOPES[scope] || !TARGET_SCOPES[scope].needsPick) return false;
  // 자기 자신만 보는 효과는 고를 게 없다
  if (side === 'self') return false;
  return hasTargetableEffect(skill);
}

/**
 * 대상이 있어야 의미가 있는 효과를 가졌는가.
 * 방어막·마나 수급처럼 시전자에게만 붙는 효과는 대상 지정이 필요 없다.
 */
export function hasTargetableEffect(skill = {}) {
  if (!skill) return false;
  if ((skill.damage || 0) > 0) return true;
  if ((skill.heal || 0) > 0) return true;
  if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') return true;
  // 약화·무효화는 "누구를"이 없으면 성립하지 않는다
  if ((skill.attackDown || 0) > 0) return true;
  if (skill.silence) return true;
  // ⚠️ damageReduction은 시전자에게 붙는 버프라 대상이 필요 없다 (여기 넣지 말 것)
  return false;
}

/** 사람이 읽을 대상 설명 ("적 2체", "아군 전체") */
export function describeTarget(skill = {}) {
  const { side, scope, count } = readTargetSpec(skill);
  const s = TARGET_SIDES[side] ? TARGET_SIDES[side].label : '적';
  if (scope === 'all') return `${s} 전체`;
  if (scope === 'random') return `무작위 ${s}`;
  if (scope === 'multi') return `${s} ${count}체`;
  return `${s} 1체`;
}

/**
 * 지금 판에서 고를 수 있는 대상 키 목록.
 * targeting.js의 `data-target-key` 규칙과 같은 형식을 쓴다.
 *
 * @param game   state (playerMinions / bossMinions)
 * @param spec   readTargetSpec 결과
 */
export function collectTargetKeys(game, spec) {
  const keys = [];
  const foes = (game.bossMinions || []).filter(m => m && m.currentHp > 0);
  const allies = (game.playerMinions || []).filter(m => m && m.currentHp > 0);

  if (spec.side === 'foe' || spec.side === 'any') {
    foes.forEach(m => keys.push(`foe:${game.bossMinions.indexOf(m)}`));
    keys.push('face');
  }
  if (spec.side === 'ally' || spec.side === 'any') {
    allies.forEach(m => keys.push(`ally:${game.playerMinions.indexOf(m)}`));
    keys.push('self-face');
  }
  return keys;
}

/** 대상 키 → 실제 엔티티 (없으면 null). 'face'/'self-face'는 본체를 뜻한다. */
export function resolveTargetKey(game, key) {
  if (!key) return null;
  if (key === 'face') return { kind: 'foeFace' };
  if (key === 'self-face') return { kind: 'selfFace' };
  const [side, idxRaw] = String(key).split(':');
  const idx = parseInt(idxRaw, 10);
  if (side === 'foe') {
    const e = (game.bossMinions || [])[idx];
    return e ? { kind: 'foeMinion', entity: e, index: idx } : null;
  }
  if (side === 'ally') {
    const e = (game.playerMinions || [])[idx];
    return e ? { kind: 'allyMinion', entity: e, index: idx } : null;
  }
  return null;
}
