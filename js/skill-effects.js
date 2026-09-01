// skill-effects.js - 스킬 효과 적용 & 전투 타겟팅 공용 로직
//
// 통합 대상:
//  1) triggerSpellEffect / triggerBattlecry — 두 함수가 약 95% 동일했다.
//     (차이는 광역 처리 여부와 로그 문구뿐인데 50줄씩 따로 유지되고 있었다)
//  2) "도발 우선 -> 전방 유닛 -> 본체 직격" 타겟 선택이 3곳에 복붙돼 있었다.

import { escapeHtml } from './dom-utils.js';
import { resolveTargetKey } from './effect-targets.js';
import { applyStatus } from './status-effects.js';

/**
 * 공격 대상 선택. 실드 관통이면 전열을 무시하고 본체(null)를 노린다.
 * @returns 피격될 소환수, 또는 null(본체 직격)
 */
export function selectFrontTarget(minions = [], { pierceShield = false } = {}) {
  if (pierceShield) return null;
  const alive = minions.filter(m => m && m.currentHp > 0);
  if (alive.length === 0) return null;
  return alive.find(m => m.taunt) || alive[0];
}

/**
 * 엔티티에 피해를 적용하고 사망 여부를 돌려준다.
 */
export function damageEntity(entity, dmg) {
  if (!entity) return { died: false, dealt: 0 };
  const amount = Math.max(0, Math.floor(dmg));
  entity.currentHp -= amount;
  return { died: entity.currentHp <= 0, dealt: amount };
}

/**
 * 소환수 배열에서 사망한 대상을 제거한다.
 */
export function removeDead(minions = []) {
  return minions.filter(m => m && m.currentHp > 0);
}

/**
 * 단일 대상 타격 + 사망 처리 + 로그를 한 번에.
 * 대상이 없으면 onDirectHit(본체 직격)으로 넘긴다.
 */
export function strikeFrontLine(minions, dmg, ctx) {
  const { addBattleLog, pierceShield = false, absorbLabel, onDirectHit } = ctx;
  const target = selectFrontTarget(minions, { pierceShield });

  if (!target) {
    if (typeof onDirectHit === 'function') onDirectHit(dmg, pierceShield);
    return { target: null, died: false, minions };
  }

  const { died } = damageEntity(target, dmg);
  addBattleLog(`<span class="text-yellow-400">🛡️ [${escapeHtml(target.name)}] ${absorbLabel || '이(가) 공격을 대신 흡수했습니다!'} (-${dmg} HP)</span>`);
  if (died) {
    addBattleLog(`<span class="text-red-500">💀 [${escapeHtml(target.name)}] 파괴!</span>`);
  }
  return { target, died, minions: died ? removeDead(minions) : minions };
}

/**
 * 카드 스킬의 효과를 플레이어 진영에 적용한다.
 * 주문(spell)과 전투의 함성(battlecry)이 이 하나를 공유한다.
 *
 * @param skill  카드의 skills[0]
 * @param ctx    { card, game, helpers }
 * @param opts   { sourceLabel, allowAoe }
 */
export function applyPlayerSkillEffects(skill, ctx, opts = {}) {
  if (!skill) return;
  const { card, game, helpers } = ctx;
  const { addBattleLog, dealDamageToBoss, drawCards, setPlayerBuff, setBossStatus } = helpers;
  const sourceLabel = opts.sourceLabel || '효과';
  const allowAoe = !!opts.allowAoe;
  const cardName = escapeHtml(card.name);

  // 1. 피해
  if (skill.damage > 0) {
    let dmg = skill.damage;
    if (skill.multiHit > 1) dmg *= skill.multiHit;

    // 🎯 플레이어가 대상을 지정했으면 그 대상에게만 들어간다.
    //    (opts.picked — targeting.js가 고른 키 배열)
    const picked = Array.isArray(opts.picked) ? opts.picked : null;

    if (picked && picked.length > 0) {
      let hitFace = false;
      for (const key of picked) {
        if (key === 'face') { hitFace = true; continue; }
        const t = resolveTargetKey(game, key);
        if (t && t.entity) {
          damageEntity(t.entity, dmg);
          addBattleLog(`<span class="text-red-300">💥 [${cardName}] ➔ [${escapeHtml(t.entity.name)}] -${dmg} 피해!</span>`);
        }
      }
      game.bossMinions = removeDead(game.bossMinions);
      game.playerMinions = removeDead(game.playerMinions);
      if (hitFace) dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    } else if (allowAoe && skill.isAoeSpell) {
      game.bossMinions.forEach(bm => {
        damageEntity(bm, dmg);
        addBattleLog(`<span class="text-red-300">💥 [${cardName}] 광역 폭격: 부하 [${escapeHtml(bm.name)}] -${dmg} 피해!</span>`);
      });
      game.bossMinions = removeDead(game.bossMinions);
      dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    } else {
      dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    }
  }

  // 2. 방어막
  if (skill.shield > 0) {
    game.playerMaxShield += skill.shield;
    addBattleLog(`<span class="text-blue-400">🛡️ ${cardName}의 가호로 방어막 +${skill.shield} 획득!</span>`);
  }

  // 3. 치유
  if (skill.heal > 0) {
    game.playerHp = Math.min(game.playerMaxHp, game.playerHp + skill.heal);
    addBattleLog(`<span class="text-emerald-400">💖 ${cardName}의 치유로 체력 +${skill.heal} 회복!</span>`);
  }

  // 4. 마나
  if (skill.manaGain > 0) {
    game.playerMana = Math.min(10, game.playerMana + skill.manaGain);
    addBattleLog(`<span class="text-blue-300">💎 마나 +${skill.manaGain} 획득!</span>`);
  }

  // 5. 드로우
  if (skill.drawCards > 0) {
    drawCards(skill.drawCards);
  }

  // 6. 더블캐스트 예약
  if (skill.doubleCastNext) {
    setPlayerBuff('doubleCast', true);
    addBattleLog(`<span class="text-indigo-400 font-bold">✨ 다음 카드가 2연속 발동됩니다!</span>`);
  }

  // 7. 무적
  if (skill.invulnerableTurns > 0) {
    setPlayerBuff('invulnerable', skill.invulnerableTurns);
    addBattleLog(`<span class="text-amber-300 font-bold">🛡️ ${skill.invulnerableTurns}턴간 절대 무적 결계가 전개되었습니다!</span>`);
  }

  // 8. 실드 관통 예약
  if (skill.pierceShield) {
    setPlayerBuff('pierceShield', true);
    addBattleLog(`<span class="text-purple-300 font-bold">🎯 다음 타격이 보스의 방어막을 관통합니다!</span>`);
  }

  // 9. 상태이상
  if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
    const st = skill.statusEffect;
    const picked = Array.isArray(opts.picked) ? opts.picked : null;

    // 🎯 소환수를 지정했으면 그 소환수에게 건다.
    //    소환수는 자체 상태이상 칸이 없으므로 여기서 만들어 붙인다.
    const minionTargets = picked
      ? picked.map(k => resolveTargetKey(game, k)).filter(t => t && t.entity)
      : [];

    if (minionTargets.length > 0) {
      for (const t of minionTargets) {
        if (!t.entity.statuses) t.entity.statuses = {};
        applyStatus(t.entity.statuses, st.type, st.duration || 1, st.value || 0);
        // 빙결은 소환수 표시에 직접 쓰이는 플래그가 따로 있다
        if (st.type === 'freeze') t.entity.frozen = true;
        addBattleLog(`<span class="text-yellow-400">⚡ [${escapeHtml(t.entity.name)}]에게 [${st.type}] 부여!</span>`);
      }
    } else {
      // 본체를 골랐거나 지정이 없으면 예전대로 상대 본체에 건다
      setBossStatus(st.type, st.duration || 1, st.value || 0);
    }
  }
}

/**
 * 상태이상 부여 + 표준 로그. 보스/플레이어 양쪽에서 쓴다.
 */
export function applyStatusWithLog(statuses, type, turns, value, { addBattleLog, targetLabel = '보스' }) {
  const applied = applyStatus(statuses, type, turns, value);
  if (!applied) return null;
  addBattleLog(`<span class="text-yellow-400">⚡ ${targetLabel}에게 [${type}] 상태이상 부여! (${applied.turns}턴)</span>`);
  return applied;
}
