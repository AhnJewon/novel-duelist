// skill-effects.js - 스킬 효과 적용 & 전투 타겟팅 공용 로직
//
// 통합 대상:
//  1) triggerSpellEffect / triggerBattlecry — 두 함수가 약 95% 동일했다.
//     (차이는 광역 처리 여부와 로그 문구뿐인데 50줄씩 따로 유지되고 있었다)
//  2) "도발 우선 -> 전방 유닛 -> 본체 직격" 타겟 선택이 3곳에 복붙돼 있었다.

import { escapeHtml } from './dom-utils.js';
import { resolveTargetKey, readHpTarget } from './effect-targets.js';
import { applyStatus } from './status-effects.js';
import { battleRng } from './rng.js';

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
/**
 * 소환수에게 피해를 준다.
 *
 * 🐛 예전에는 **수비력을 완전히 무시했다.** 카드에 표시되고 파워 예산까지
 *    차지하는데 전투에서는 아무 일도 하지 않는 순수한 장식이었다.
 *
 * 이제 수비력만큼 피해를 깎는다. 단 **최소 1은 들어간다** —
 *    수비력이 공격력보다 높다고 완전 무적이 되면 판이 멈춘다.
 *
 * @param opts.pierce   수비를 무시할지 (실드 관통 계열)
 * @param opts.defBonus 건축물 오라 등 **외부에서 오는** 방어력 보정.
 *   ⚠️ entity.defense에 더해 저장하지 말고 여기로 넘기세요. 저장하면
 *      오라를 주던 건축물이 부서진 뒤에도 보너스가 남습니다.
 */
export function damageEntity(entity, dmg, { pierce = false, defBonus = 0 } = {}) {
  if (!entity) return { died: false, dealt: 0, blocked: 0 };
  const raw = Math.max(0, Math.floor(dmg));
  const baseDef = Math.max(0, parseInt(entity.defense) || 0) + Math.max(0, parseInt(defBonus) || 0);
  const def = pierce ? 0 : baseDef;
  const amount = Math.max(raw > 0 ? 1 : 0, raw - def);
  entity.currentHp -= amount;
  return { died: entity.currentHp <= 0, dealt: amount, blocked: raw - amount };
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

  const { died } = damageEntity(target, dmg, { pierce: pierceShield });
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

    // ⚡ 치명타 — 예전에는 **어디에도 구현이 없었다.**
    //    카드에 "크리 30%" 뱃지가 뜨고 EFFECT_COSTS에서 예산까지 먹는데
    //    실제로는 아무 일도 하지 않았다.
    //    ⚠️ 반드시 battleRng를 쓴다. Math.random을 쓰면 PvP 락스텝이 깨진다.
    if (skill.critChance > 0 && battleRng().chance(skill.critChance)) {
      const mult = skill.critMultiplier || 1.8;
      dmg = Math.floor(dmg * mult);
      addBattleLog(`<span class="text-amber-300 font-bold">⚡ 치명타! 피해가 ${mult}배로 증폭됩니다. (${dmg})</span>`);
    }

    // 💀 처형 — 상대 본체가 문턱 이하면 배수 피해. 이것도 보스 전용이었다.
    if (skill.executeThreshold > 0 && helpers.foeHp && helpers.foeMaxHp) {
      const cur = helpers.foeHp();
      const max = helpers.foeMaxHp();
      if (max > 0 && cur <= max * skill.executeThreshold) {
        dmg = Math.floor(dmg * 2);
        addBattleLog(`<span class="text-red-400 font-black">💀 처형! 빈사 상태를 노려 피해가 2배가 됩니다. (${dmg})</span>`);
      }
    }

    // 🎯 플레이어가 대상을 지정했으면 그 대상에게만 들어간다.
    //    (opts.picked — targeting.js가 고른 키 배열)
    const picked = Array.isArray(opts.picked) ? opts.picked : null;

    if (picked && picked.length > 0) {
      let hitFace = false;
      for (const key of picked) {
        if (key === 'face') { hitFace = true; continue; }
        const t = resolveTargetKey(game, key);
        if (t && t.entity) {
          damageEntity(t.entity, dmg, { pierce: !!skill.pierceShield });
          addBattleLog(`<span class="text-red-300">💥 [${cardName}] ➔ [${escapeHtml(t.entity.name)}] -${dmg} 피해!</span>`);
        }
      }
      game.bossMinions = removeDead(game.bossMinions);
      game.playerMinions = removeDead(game.playerMinions);
      if (hitFace) dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    } else if (allowAoe && skill.isAoeSpell) {
      game.bossMinions.forEach(bm => {
        damageEntity(bm, dmg, { pierce: !!skill.pierceShield });
        addBattleLog(`<span class="text-red-300">💥 [${cardName}] 광역 폭격: 부하 [${escapeHtml(bm.name)}] -${dmg} 피해!</span>`);
      });
      game.bossMinions = removeDead(game.bossMinions);
      dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    } else {
      dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    }

    // 🩸 흡혈 — 가한 피해의 일부를 본체 체력으로 되돌린다.
    //    보스 턴에는 구현돼 있었는데 **플레이어 카드에는 없었다.**
    //    ([심연의 암살자 레이븐]이 "50% 흡혈"이라 적어놓고 아무것도 안 했다)
    if (skill.lifestealPercent > 0) {
      const healed = Math.floor(dmg * skill.lifestealPercent);
      if (healed > 0) {
        game.playerHp = Math.min(game.playerMaxHp, game.playerHp + healed);
        addBattleLog(`<span class="text-rose-300 font-bold">🩸 흡혈로 본체 체력 +${healed} 회복!</span>`);
      }
    }
  }

  // 2. 방어막
  if (skill.shield > 0) {
    game.playerMaxShield += skill.shield;
    addBattleLog(`<span class="text-blue-400">🛡️ ${cardName}의 가호로 방어막 +${skill.shield} 획득!</span>`);
    // 🐛 'shielded' 이벤트를 아무도 쏘지 않아 foeShielded 함정이 죽어 있었다
    if (helpers.onShielded) helpers.onShielded();
  }

  // 3. 치유 — ❤️ 본체와 소환수 중 어느 체력을 회복할지 카드가 정한다.
  //    예전에는 무조건 본체였고, 그래서 카드의 ❤️와 설명문이 서로 다른 것을 가리켰다.
  if (skill.heal > 0) {
    if (readHpTarget(skill) === 'minion') {
      // 이 카드가 필드에 낸 소환수를 회복시킨다. 아직 안 나왔으면 시전 대상이 없다.
      const self = opts.sourceEntity
        || (game.playerMinions || []).find(m => m && (m.instanceId === card.instanceId || m.name === card.name));
      if (self) {
        const before = self.currentHp;
        self.currentHp = Math.min(self.maxHp, self.currentHp + skill.heal);
        addBattleLog(`<span class="text-emerald-400">💖 [${escapeHtml(self.name)}] 자신의 체력 ${before} → ${self.currentHp}</span>`);
      } else {
        addBattleLog(`<span class="text-slate-400">회복할 소환수가 전장에 없습니다.</span>`);
      }
    } else {
      game.playerHp = Math.min(game.playerMaxHp, game.playerHp + skill.heal);
      addBattleLog(`<span class="text-emerald-400">💖 ${cardName}의 치유로 본체 체력 +${skill.heal} 회복!</span>`);
    }
  }

  // ❤️ 본체 최대 체력 증가 (영구)
  //    본체 체력이 낮아서 직격과 상태이상이 위협적인 문제를, 카드로 풀 수 있게 한다.
  //    ⚠️ 최대치만 올리는 게 아니라 **현재 체력도 같이** 올린다. 안 그러면
  //       "최대 체력 +10"이 당장 아무 도움이 안 되고 회복 카드를 강요한다.
  if (skill.maxHpGain > 0) {
    game.playerMaxHp += skill.maxHpGain;
    game.playerHp += skill.maxHpGain;
    addBattleLog(`<span class="text-rose-300 font-bold">❤️ ${cardName}: 본체 최대 체력 +${skill.maxHpGain} (${game.playerHp}/${game.playerMaxHp})</span>`);
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

  // 🛡️ 피해 경감 — 다음 N턴 동안 받는 피해를 %만큼 줄인다.
  //    LLM이 설명문에 자주 쓰던 "피해를 50% 줄이고"가 실제로 동작하게 된 것.
  if (skill.damageReduction > 0) {
    setPlayerBuff('damageReduction', skill.damageReduction);
    setPlayerBuff('damageReductionTurns', Math.max(1, skill.reductionTurns || 2));
    addBattleLog(`<span class="text-cyan-300 font-bold">🛡️ ${cardName}: 받는 피해가 ${skill.damageReduction}% 감소합니다!</span>`);
  }

  // ⚔️ 공격력 약화 — 지정한 상대 소환수의 공격력을 깎는다.
  if (skill.attackDown > 0) {
    const picked = Array.isArray(opts.picked) ? opts.picked : null;
    const targets = picked
      ? picked.map(k => resolveTargetKey(game, k)).filter(t => t && t.entity)
      : (game.bossMinions || []).slice(0, 1).map(e => ({ entity: e }));
    if (targets.length === 0) {
      addBattleLog(`<span class="text-slate-400">약화시킬 대상이 없습니다.</span>`);
    }
    for (const t of targets) {
      const before = t.entity.attack || 0;
      t.entity.attack = Math.max(0, before - skill.attackDown);
      addBattleLog(`<span class="text-orange-300">⚔️ [${escapeHtml(t.entity.name)}] 공격력 ${before} → ${t.entity.attack}</span>`);
    }
  }

  // 🚫 효과 무효화 — 지정한 상대 소환수의 스킬을 지운다.
  //    수치(공/체)는 남기고 **효과만** 없앤다. 유희왕의 '무효화'와 같은 감각.
  if (skill.silence) {
    const picked = Array.isArray(opts.picked) ? opts.picked : null;
    const targets = picked
      ? picked.map(k => resolveTargetKey(game, k)).filter(t => t && t.entity)
      : (game.bossMinions || []).slice(0, 1).map(e => ({ entity: e }));
    for (const t of targets) {
      t.entity.skills = [];
      t.entity.silenced = true;
      t.entity.taunt = false;
      addBattleLog(`<span class="text-purple-300 font-bold">🚫 [${escapeHtml(t.entity.name)}]의 효과가 무효화되었습니다!</span>`);
    }
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
