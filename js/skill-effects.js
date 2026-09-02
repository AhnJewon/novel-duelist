// skill-effects.js - 스킬 효과 적용 & 전투 타겟팅 공용 로직
//
// 통합 대상:
//  1) triggerSpellEffect / triggerBattlecry — 두 함수가 약 95% 동일했다.
//     (차이는 광역 처리 여부와 로그 문구뿐인데 50줄씩 따로 유지되고 있었다)
//  2) "전방 유닛 -> 본체 직격" 타겟 선택이 3곳에 복붙돼 있었다.

import { escapeHtml } from './dom-utils.js';
import { resolveTargetKey, readHpTarget, readTargetSpec, readDamageTarget } from './effect-targets.js';
import { applyStatus, getIncomingDamageMultiplier, getOnHitBonusDamage, STATUS_EFFECTS } from './status-effects.js';
import { battleRng } from './rng.js';
import { SLOT_CAP, HAND_CAP } from './battle-rules.js';

/**
 * 공격 대상 선택. 실드 관통이면 전열을 무시하고 본체(null)를 노린다.
 *
 * 🗑️ 도발 우선 규칙은 제거됐다 — 이제 그냥 **맨 앞**이 맞는다 (DECISIONS #84).
 * @returns 피격될 소환수, 또는 null(본체 직격)
 */
export function selectFrontTarget(minions = [], { pierceShield = false } = {}) {
  if (pierceShield) return null;
  const alive = minions.filter(m => m && m.currentHp > 0);
  if (alive.length === 0) return null;
  return alive[0];
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
  if (!entity) return { died: false, dealt: 0, blocked: 0, amplified: 0, shockBonus: 0 };
  const raw = Math.max(0, Math.floor(dmg));
  const baseDef = Math.max(0, parseInt(entity.defense) || 0) + Math.max(0, parseInt(defBonus) || 0);
  const def = pierce ? 0 : baseDef;

  // 1) 수비력으로 흡수
  const afterDef = Math.max(raw > 0 ? 1 : 0, raw - def);
  const blocked = raw - afterDef;

  // 2) 💥 취약 — 수비력을 뚫고 들어온 피해에 배율을 곱한다.
  //    🐛 수정: 취약/감전이 소환수 statuses에 등록만 되고 **읽는 쪽이 없었다.**
  //       본체(applyDirectDamageToPlayer)에만 구현돼 있어 소환수에 걸면 무효과였다.
  //    ⚠️ 순서는 본체와 같게 유지한다: 경감/수비 → 취약 → 감전.
  //       순서가 다르면 같은 상태이상이 대상에 따라 다른 피해가 나온다.
  const mult = getIncomingDamageMultiplier(entity.statuses);
  const amplified = mult !== 1 ? Math.floor(afterDef * mult) - afterDef : 0;

  // 3) ⚡ 감전 — 피격될 때마다 추가 연쇄 피해.
  //    수비력을 무시한다 (전기는 갑옷을 타고 흐른다). 실제로 맞았을 때만 터진다.
  const shockBonus = afterDef > 0 ? getOnHitBonusDamage(entity.statuses) : 0;

  const total = afterDef + amplified + shockBonus;
  entity.currentHp -= total;
  return { died: entity.currentHp <= 0, dealt: total, blocked, amplified, shockBonus };
}

/**
 * damageEntity 결과를 로그 꼬리말로 만든다.
 * 수치가 왜 그렇게 나왔는지 보여주지 않으면 상태이상이 동작하는지 알 수 없다.
 */
export function describeDamageExtras({ blocked = 0, amplified = 0, shockBonus = 0 } = {}) {
  const bits = [];
  if (blocked > 0) bits.push(`<span class="text-cyan-400">방어 ${blocked} 흡수</span>`);
  if (amplified > 0) bits.push(`<span class="text-purple-400">💥 취약 +${amplified}</span>`);
  if (shockBonus > 0) bits.push(`<span class="text-amber-300">⚡ 감전 +${shockBonus}</span>`);
  return bits.length ? ` (${bits.join(', ')})` : '';
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

  const hit = damageEntity(target, dmg, { pierce: pierceShield });
  const { died } = hit;
  addBattleLog(`<span class="text-yellow-400">🛡️ [${escapeHtml(target.name)}] ${absorbLabel || '이(가) 공격을 대신 흡수했습니다!'} (-${hit.dealt} HP)${describeDamageExtras(hit)}</span>`);
  if (died) {
    addBattleLog(`<span class="text-red-500">💀 [${escapeHtml(target.name)}] 파괴!</span>`);
  }
  return { target, died, minions: died ? removeDead(minions) : minions };
}

/**
 * 🎯 이 효과가 **실제로 닿는 대상**을 정한다.
 *
 * 🐛 왜 한 곳으로 모았나: 대상 해석이 효과마다 따로 쓰여 있었고,
 *    `targetScope: 'all'`은 **피해에만** 구현돼 있었다. 그 결과 실측:
 *      "적 전체를 약화"   → 적 0번만 약화 (10→5, 나머지 10)
 *      "적 전체를 무효화" → 적 0번만
 *      "적 전체에 화상"   → 적 0번만
 *      "아군 전체를 회복" → 아군은 아무도 회복 안 되고 **본체만** 회복
 *      "무작위 적 1체"    → 아무데도 구현이 없어 그냥 본체를 때림
 *    카드에 적힌 범위와 실제 동작이 전부 달랐다.
 *
 * ⚠️ **새 효과를 추가하면 반드시 이 함수를 쓰세요.** 효과마다 대상을 다시
 *    해석하면 또 갈라집니다.
 *
 * @param picked   플레이어가 고른 대상 키 배열 (없으면 null)
 * @param allowAoe 광역 확장을 허용하는가. 전투의 함성은 false다.
 * @returns {{minions:Array, foeFace:boolean, selfFace:boolean, explicit:boolean}}
 *   explicit=false면 "정해진 대상이 없다"는 뜻 — 각 효과가 자기 기본값을 쓴다.
 */
export function resolveEffectTargets(game, skill, picked = null, { allowAoe = true } = {}) {
  const spec = readTargetSpec(skill);
  const out = { minions: [], foeFace: false, selfFace: false, explicit: false };

  // 1) 플레이어가 직접 고른 대상이 최우선이다
  if (Array.isArray(picked) && picked.length > 0) {
    out.explicit = true;
    for (const key of picked) {
      if (key === 'face') { out.foeFace = true; continue; }
      // 🐛 예전에는 self-face를 고르면 **조용히 버려졌다.** 다중 지정에서
      //    본체를 고른 한 번이 아무 일도 안 하고 사라졌다.
      if (key === 'self-face') { out.selfFace = true; continue; }
      const t = resolveTargetKey(game, key);
      if (t && t.entity) out.minions.push(t.entity);
    }
    return out;
  }

  const foes = (game.bossMinions || []).filter(m => m && m.currentHp > 0);
  const allies = (game.playerMinions || []).filter(m => m && m.currentHp > 0);

  // 2) 전체 — 전투의 함성은 광역이 되지 않는다(allowAoe=false)
  if (spec.scope === 'all' && allowAoe) {
    out.explicit = true;
    if (spec.side === 'ally') { out.minions = allies; out.selfFace = true; }
    else if (spec.side === 'any') { out.minions = [...foes, ...allies]; out.foeFace = true; out.selfFace = true; }
    else { out.minions = foes; out.foeFace = true; }
    return out;
  }

  // 3) 무작위 — ⚠️ 반드시 battleRng. Math.random을 쓰면 PvP 락스텝이 깨진다.
  if (spec.scope === 'random') {
    out.explicit = true;
    const pool = spec.side === 'ally' ? allies : (spec.side === 'any' ? [...foes, ...allies] : foes);
    if (pool.length > 0) out.minions = [pool[battleRng().index(pool.length)]];
    else if (spec.side === 'ally') out.selfFace = true;
    else out.foeFace = true;
    return out;
  }

  // 4) 그 외(단일·다중인데 고르지 않음) — 효과별 기본값에 맡긴다
  return out;
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

    // 🎯 대상 해석은 resolveEffectTargets 한 곳이 맡는다 (지정 / 전체 / 무작위)
    const spec = readTargetSpec(skill);
    const T0 = resolveEffectTargets(game, skill, opts.picked, { allowAoe });

    // 💥 피해 대상 강제 — 카드가 "본체만" / "기물만"이라고 선언했으면 그대로 지킨다.
    //    ⚠️ 화면(collectTargetKeys)에서도 좁히지만, 규칙은 **해결 지점**에서
    //       강제해야 한다. PvP 재생 경로는 상대가 보낸 키를 그대로 실행한다.
    const dt = readDamageTarget(skill);
    const T = (dt === 'any') ? T0 : {
      ...T0,
      minions: dt === 'body' ? [] : T0.minions,
      foeFace: dt === 'field' ? false : T0.foeFace,
      selfFace: dt === 'field' ? false : T0.selfFace,
      // 본체 전용인데 고른 게 기물뿐이면 본체로 돌린다 (불발시키지 않는다)
      explicit: dt === 'body' ? true : T0.explicit
    };
    if (dt === 'body') T.foeFace = true;

    if (T.explicit) {
      for (const e of T.minions) {
        // 🐛 수정: 로그가 **요청한** dmg를 찍고 있었다. 수비력·취약·감전이
        //    붙으면 실제 피해와 달라 로그가 거짓이 된다. 반환값을 쓴다.
        const hit = damageEntity(e, dmg, { pierce: !!skill.pierceShield });
        addBattleLog(`<span class="text-red-300">💥 [${cardName}] ➔ [${escapeHtml(e.name)}] -${hit.dealt} 피해!${describeDamageExtras(hit)}</span>`);
      }
      game.bossMinions = removeDead(game.bossMinions);
      game.playerMinions = removeDead(game.playerMinions);

      // 💥 다중 대상인데 **고를 대상이 모자랐으면 남은 타수를 본체로** 보낸다.
      //
      // 🐛 예전에는 그냥 사라졌다. "적 2체에게 10 피해"(총 20어치 값을 치른 카드)를
      //    상대 전장이 빈 상태에서 내면 고를 곳이 본체뿐이라 **10만** 들어갔다.
      //    (targeting은 같은 대상을 두 번 고르지 못하게 막는다 — 그건 옳다.
      //     대신 남은 타수를 여기서 본체에 얹는다)
      //    ⚠️ 기물 전용(field)과 아군 대상은 제외 — 본체를 때리면 안 된다.
      let faceHits = T.foeFace ? 1 : 0;
      if (spec.scope === 'multi' && spec.side !== 'ally' && dt !== 'field') {
        const landed = T.minions.length + faceHits;
        if (landed < spec.count) faceHits += (spec.count - landed);
      }
      for (let i = 0; i < faceHits; i++) dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
      // ⚠️ selfFace(내 본체)에 피해를 넣는 경로는 일부러 없다. 자해 메커니즘이
      //    없으므로 sanitize가 해로운 효과의 대상을 foe로 교정한다 → DECISIONS #74
    } else if (allowAoe && skill.isAoeSpell) {
      // 구버전 호환: targetScope 없이 isAoeSpell만 가진 카드
      game.bossMinions.forEach(bm => {
        const hit = damageEntity(bm, dmg, { pierce: !!skill.pierceShield });
        addBattleLog(`<span class="text-red-300">💥 [${cardName}] 광역 폭격: 부하 [${escapeHtml(bm.name)}] -${hit.dealt} 피해!${describeDamageExtras(hit)}</span>`);
      });
      game.bossMinions = removeDead(game.bossMinions);
      dealDamageToBoss(dmg, `${card.name} ${sourceLabel}`);
    } else if (dt === 'field') {
      // 🐛 지정이 없을 때의 폴백이 **damageTarget을 무시하고 본체를 쳤다.**
      //    "전장의 기물만 때린다"고 적힌 카드가 보스 본체를 때렸다.
      //    기물 전용은 최전방을 치고, 전장이 비면 불발한다 — 그게 이 카드의 값이다.
      const front = selectFrontTarget(game.bossMinions);
      if (front) {
        const hit = damageEntity(front, dmg, { pierce: !!skill.pierceShield });
        addBattleLog(`<span class="text-red-300">💥 [${cardName}] ➔ [${escapeHtml(front.name)}] -${hit.dealt} 피해!${describeDamageExtras(hit)}</span>`);
        game.bossMinions = removeDead(game.bossMinions);
      } else {
        addBattleLog(`<span class="text-slate-400">전장에 때릴 기물이 없어 불발했습니다.</span>`);
      }
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
    // 🐛 수정: 플레이어가 **고른 아군 소환수**를 무시하고 있었다.
    //    needsTargetPick은 heal도 대상 지정이 필요하다고 판단해 선택을 받는데
    //    (hasTargetableEffect에 heal이 있다) 여기서 picked를 보지 않아
    //    "아군 1체를 회복" 카드가 대상을 고르게 하고도 본체를 회복했다.
    const H = resolveEffectTargets(game, skill, opts.picked, { allowAoe });
    // 회복은 아군에게만 의미가 있다 — 적을 골랐으면 무시한다
    const healTargets = H.minions.filter(e => (game.playerMinions || []).includes(e));
    if (H.explicit && (healTargets.length > 0 || H.selfFace)) {
      for (const e of healTargets) {
        const before = e.currentHp;
        e.currentHp = Math.min(e.maxHp, e.currentHp + skill.heal);
        addBattleLog(`<span class="text-emerald-400">💖 [${escapeHtml(e.name)}] 체력 ${before} → ${e.currentHp}</span>`);
      }
      // 🐛 예전에는 본체 지정(self-face)이 조용히 버려졌다. "아군 전체"도
      //    본체만 회복하고 소환수는 아무도 회복되지 않았다.
      if (H.selfFace) {
        game.playerHp = Math.min(game.playerMaxHp, game.playerHp + skill.heal);
        addBattleLog(`<span class="text-emerald-400">💖 ${cardName}의 치유로 본체 체력 +${skill.heal} 회복!</span>`);
      }
    } else if (readHpTarget(skill) === 'minion') {
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
    // 🐛 예전에는 `targetScope:'all'`을 몰라서 **적 전체 약화가 첫 한 기만** 약화시켰다
    const A = resolveEffectTargets(game, skill, opts.picked, { allowAoe });
    const targets = A.explicit && A.minions.length > 0
      ? A.minions
      : (game.bossMinions || []).slice(0, 1);
    if (targets.length === 0) {
      addBattleLog(`<span class="text-slate-400">약화시킬 대상이 없습니다.</span>`);
    }
    for (const e of targets) {
      const before = e.attack || 0;
      e.attack = Math.max(0, before - skill.attackDown);
      addBattleLog(`<span class="text-orange-300">⚔️ [${escapeHtml(e.name)}] 공격력 ${before} → ${e.attack}</span>`);
    }
  }

  // 🚫 효과 무효화 — 지정한 상대 소환수의 스킬을 지운다.
  //    수치(공/체)는 남기고 **효과만** 없앤다. 유희왕의 '무효화'와 같은 감각.
  if (skill.silence) {
    // 🐛 여기도 `targetScope:'all'`을 몰라서 **적 전체 무효화가 첫 한 기만** 지웠다
    const Q = resolveEffectTargets(game, skill, opts.picked, { allowAoe });
    const targets = Q.explicit && Q.minions.length > 0
      ? Q.minions
      : (game.bossMinions || []).slice(0, 1);
    for (const e of targets) {
      e.skills = [];
      e.silenced = true;
      addBattleLog(`<span class="text-purple-300 font-bold">🚫 [${escapeHtml(e.name)}]의 효과가 무효화되었습니다!</span>`);
    }
  }

  // 💀 파괴 — 체력과 무관하게 없앤다.
  //    🆕 예전에는 설명문에만 있고 엔진에 없던 동작이다 (DECISIONS #85).
  //    ⚠️ 건축물도 파괴된다 — "전장을 비운다"가 이 효과의 값이다.
  if (skill.destroy > 0) {
    const D = resolveEffectTargets(game, skill, opts.picked, { allowAoe });
    const targets = (D.explicit && D.minions.length > 0
      ? D.minions
      : (game.bossMinions || []).slice(0, 1)
    ).slice(0, Math.max(1, skill.destroy));
    if (targets.length === 0) {
      addBattleLog(`<span class="text-slate-400">파괴할 대상이 없습니다.</span>`);
    }
    for (const e of targets) {
      e.currentHp = 0;
      addBattleLog(`<span class="text-red-400 font-black">💀 [${cardName}] ➔ [${escapeHtml(e.name)}] 파괴!</span>`);
    }
    game.bossMinions = removeDead(game.bossMinions);
    game.playerMinions = removeDead(game.playerMinions);
  }

  // 🔍 덱 서치 — 덱에서 **같은 카드군**을 우선으로 찾아 패로 가져온다.
  //    드로우와 다른 점: 무엇이 올지 고를 수 있다는 것. 그래서 값이 더 비싸다.
  if (skill.searchDeck > 0 && Array.isArray(game.playerDeck) && Array.isArray(game.playerHand)) {
    const wantTheme = card.themeId || card.themeName || null;
    let found = 0;
    for (let i = 0; i < skill.searchDeck; i++) {
      if (game.playerHand.length >= HAND_CAP) {
        addBattleLog(`<span class="text-red-400">손패가 가득 차 더 가져올 수 없습니다. (최대 ${HAND_CAP}장)</span>`);
        break;
      }
      // 같은 카드군 → 없으면 아무 카드나
      let idx = wantTheme
        ? game.playerDeck.findIndex(c => c && (c.themeId === card.themeId || c.themeName === card.themeName))
        : -1;
      if (idx === -1) idx = game.playerDeck.length - 1;
      if (idx < 0) { addBattleLog(`<span class="text-slate-400">덱이 비어 서치할 수 없습니다.</span>`); break; }
      const got = game.playerDeck.splice(idx, 1)[0];
      if (!got) break;
      game.playerHand.push(got);
      found++;
      addBattleLog(`<span class="text-amber-300">🔍 [${cardName}] 덱에서 <b>[${escapeHtml(got.name)}]</b>을(를) 패로 가져왔습니다.</span>`);
    }
    if (found === 0 && game.playerDeck.length === 0) {
      addBattleLog(`<span class="text-slate-400">덱이 비어 서치가 불발됐습니다.</span>`);
    }
  }

  // 👾 토큰 소환 — 전장을 채운다.
  //    전장 자체가 벽인 지금(DECISIONS #84) 이건 방어 수단이기도 하다.
  if (skill.summonToken > 0 && Array.isArray(game.playerMinions)) {
    const maxSlots = SLOT_CAP;   // 양 진영 같은 값 (거울에서도 상대 전장 상한이 맞는다)
    let made = 0;
    for (let i = 0; i < skill.summonToken; i++) {
      if (game.playerMinions.length >= maxSlots) {
        addBattleLog(`<span class="text-slate-400">전장이 가득 차 토큰을 더 소환할 수 없습니다.</span>`);
        break;
      }
      game.playerMinions.push({
        id: `token-${card.id || 'x'}-${game.turnCount || 0}-${game.playerMinions.length}`,
        instanceId: `token-${card.id || 'x'}-${game.turnCount || 0}-${game.playerMinions.length}`,
        name: `${card.name}의 그림자`,
        cardType: 'unit',
        element: card.element || 'dark',
        themeId: card.themeId, themeName: card.themeName, themeKeyword: card.themeKeyword,
        attack: 4, defense: 2, maxHp: 10, currentHp: 10,
        // ⚠️ 소환 후유증. 없으면 이번 턴에 바로 때린다.
        canAttack: false, summonedTurn: game.turnCount, frozen: false, statuses: {},
        isToken: true, imageUrl: card.imageUrl, skills: [{}]
      });
      made++;
    }
    if (made > 0) {
      addBattleLog(`<span class="text-emerald-300 font-bold">👾 [${cardName}] 토큰 ${made}체 소환! (4/2/10)</span>`);
    }
  }

  // 9. 상태이상
  if (skill.statusEffect && skill.statusEffect.type && skill.statusEffect.type !== 'none') {
    const st = skill.statusEffect;
    const spec = STATUS_EFFECTS[st.type];

    // 🎯 소환수는 자체 상태이상 칸이 없으므로 여기서 만들어 붙인다.
    // 🐛 예전에는 지정(picked)만 봐서 **"적 전체에 화상"이 첫 한 기만** 태웠다.
    const St = resolveEffectTargets(game, skill, opts.picked, { allowAoe });

    if (St.explicit && St.minions.length > 0) {
      for (const e of St.minions) {
        if (!e.statuses) e.statuses = {};
        applyStatus(e.statuses, st.type, st.duration || 1, st.value || 0);
        // 빙결은 소환수 표시에 직접 쓰이는 플래그가 따로 있다
        if (st.type === 'freeze') e.frozen = true;
        // ⚠️ 카드 텍스트에 엔진 키를 그대로 쓰지 않는다 → CLAUDE.md 금지사항 47
        addBattleLog(`<span class="${spec ? spec.color : 'text-yellow-400'}">${spec ? spec.icon : '⚡'} [${escapeHtml(e.name)}]에게 ${spec ? spec.name : st.type} ${st.duration || 1}턴 부여!</span>`);
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
