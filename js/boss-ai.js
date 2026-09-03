// boss-ai.js - PvE 봇 컨트롤러 — 보스는 "특별한 콤보를 가진 봇 플레이어"다 (DECISIONS #94)
//
// 여기 있는 것은 **판단**뿐이다: 어떤 카드를 내고, 누구를 노리고, 언제 격노하는가.
// 그리고 보스 고유의 **콤보 스텝**(마나를 안 쓰는 스크립트 공세). 규칙은 전부 엔진 함수를
// 주입받아(ops) 쓴다 — 마나·전장·함성·함정·본체 피해·소환수 피해 어느 것도 여기서 다시 쓰지 않는다.
//
// 봇의 모든 행동은 PvP 원격 상대와 **같은 파이프**(ops.applyFoeAction)를 지난다:
//   { kind:'playCard' } · { kind:'attack' } · { kind:'endTurn' } + 봇만 쓰는 { kind:'comboStep' }.
// 그래서 PvE는 "로컬 봇과의 PvP"다 — 봇에서 통하면 원격에서도 통하고, 반대도 같다.
//
// 🐛 예전엔 이 판단과 규칙이 battle-engine의 executeBossTurn / executeSingleBossStep에 한 덩어리로
//    있었고, 보스 전용 사본(시전·공격·본체 피해)이 그 안에서 규칙을 다시 썼다. 그 사본들이
//    갈라지면서 나온 버그가 이 통합의 출발점이다.
//
// ⚠️ 이 파일은 battle-engine.js를 import하지 않는다 (엔진 → 봇 한 방향). 엔진 연산은 ops로 받는다.
//    ops.sides()는 **매번 호출**한다 — sides는 initBattle/reset마다 새로 만들어진다 (stale 참조 금지).

import { state } from './storage.js';
import { audio } from './audio.js';
import { escapeHtml } from './dom-utils.js';
import { battleRng } from './rng.js';
import { BOSS_STEP_DAMAGE_MULT, BOSS_STEP_AOE_FACE_MULT } from './config.js';
import { BOSS_ADD_POOL, ELEMENT_BOSS_MINIONS } from './data.js';
import { STATUS_EFFECTS, isEntityOnly } from './status-effects.js';
import { damageEntity, strikeFrontLine, removeDead, describeDamageExtras } from './skill-effects.js';
import { readTargetSpec, collectTargetKeys } from './effect-targets.js';
import { canPlayCard, discardRandom } from './combat-side.js';
import { readDirectAttack } from './card-keywords.js';
import { SLOT_CAP, THORNS_TURNS, BOT_PACE_MS, EXECUTE_MULT } from './battle-rules.js';

// ============================================================
// 🐌 보스 공세 램프 — 초반 턴에는 보스도 천천히 전개한다 (봇의 **페이싱 정책**)
// ------------------------------------------------------------
// 🐛 왜 필요한가: 보스가 마나를 쓰지 않던 시절, 플레이어가 1마나뿐인 1턴에 소환수를 3기까지
//    채우고 카드도 2~3장 냈다. 측정 결과 턴1 보스 딜이 34~59였고 플레이어 체력은 50이라
//    **첫 손패에 싼 카드가 없으면 아무것도 못 하고 2턴에 죽었다.**
//    이제 보스도 마나를 쓰므로 자원이 곧 제한이고, 램프는 보조 장치로만 남는다.
//    후반 난이도는 그대로다 — 압박을 없애는 게 아니라 **뒤로 미루는 것**이다.
//
// ⚠️ 여기 수치를 올리면 초반 난이도가 그대로 돌아온다. 바꾸기 전에
//    "패스만 하며 몇 턴 버티는가"를 반드시 측정하세요 → DECISIONS #75
export const BOSS_RAMP = {
  1: { minions: 1, cards: 1 },
  2: { minions: 2, cards: 1 }
  // 3턴 이후는 제한 없음 (SLOT_CAP / 기본 카드 수)
};

/** comboPatterns가 비어 있을 때 쓰는 기본 연계 */
const DEFAULT_COMBOS = [{
  name: '기본 연계',
  steps: [
    { type: 'summon_or_buff', name: '부하 소환/강화', value: 1 },
    { type: 'attack', name: '일반 강타', value: 16 }
  ]
}];

/**
 * 봇 컨트롤러를 만든다.
 *
 * @param ops 엔진 연산 묶음:
 *   sides()                 — 현재 진영 쌍 { player, boss } (매번 호출)
 *   startTurn(side) / endTurn(side)
 *   applyFoeAction(action)  — 상대 행동 단일 파이프 (playCard / attack / comboStep / endTurn)
 *   dealFaceDamage(target, dmg, opts)
 *   applyStatusRespectingScope(statuses, minions, label, type, turns, value, allowBody)
 *   addBattleLog · renderBattleUI · checkBattleStatus · isGameOver() · viewFor(side)
 *   triggerLiveBossReaction(kind) — 보스 대사
 */
export function createBossController(ops) {
  // 🔥 격노(2페이즈). 체력 40% 이하에 한 번 켜지고 전투가 끝날 때까지 유지된다.
  //    공격·마법 스텝 ×1.4, 카드 한도 3. 치유·방어막엔 걸리지 않는다 —
  //    🐛 예전엔 `val > 0`이면 전부 키워 치유·방어막까지 40% 부풀었다.
  let phase = 1;

  const me = () => ops.sides().boss;
  const foe = () => ops.sides().player;
  const nameOf = (side) => escapeHtml(side.name);

  /** 이번 턴 봇이 채울 수 있는 최대 소환수 수 (램프) */
  function minionCapThisTurn() {
    const ramp = BOSS_RAMP[state.turnCount];
    return ramp ? Math.min(SLOT_CAP, ramp.minions) : SLOT_CAP;
  }

  /** 이번 턴 낼 카드 수 상한 */
  function cardLimitThisTurn(side) {
    const base = (phase === 2 || side.hp <= side.maxHp * 0.5) ? 3 : 2;
    const ramp = BOSS_RAMP[state.turnCount];
    return ramp ? Math.min(base, ramp.cards) : base;
  }

  /**
   * 어떤 카드를 낼까. 오늘의 휴리스틱 그대로:
   *   체력 위기(≤60%)면 치유/방어막 → 자리가 있으면 소환수 → 주문 → 그 외 가장 비싼 것.
   * ⚠️ 어느 경우든 **낼 수 있는 후보 안에서만** 고른다 (canPlayCard + 램프).
   */
  function chooseCard(side) {
    const cap = minionCapThisTurn();
    const affordable = side.hand.filter(c => canPlayCard(side, c).ok
      && !((c.cardType === 'unit' || c.cardType === 'structure') && side.minions.length >= cap));
    if (affordable.length === 0) return null;
    const pickFrom = (pred) => affordable.find(pred) || null;
    let chosen = null;
    if (side.hp <= side.maxHp * 0.6) {
      chosen = pickFrom(c => c.skills && c.skills[0] && (c.skills[0].heal > 0 || c.skills[0].shield > 0));
    } else if (side.minions.length < cap) {
      chosen = pickFrom(c => c.cardType === 'unit' || c.cardType === 'structure');
    } else {
      chosen = pickFrom(c => c.cardType === 'spell');
    }
    if (!chosen) chosen = affordable.slice().sort((a, b) => (b.cost || 0) - (a.cost || 0))[0];
    return chosen;
  }

  /**
   * 🎯 대상 선택 정책 — 사람이 대상을 고르는 자리에서 봇은 이렇게 고른다.
   *   상대(=플레이어) 전장이 있으면 **최전방부터**, 없으면 본체. 아군 효과는 첫 후보.
   *   "보스 주문은 최전방을 친다"는 엔진 규칙이 아니라 이 정책이다 — 규칙은 플레이어와 같다.
   */
  function chooseTargets(card) {
    const skill = (card.skills && card.skills[0]) || card.skill || null;
    if (!skill) return null;
    const spec = readTargetSpec(skill);
    if (spec.scope === 'all' || spec.scope === 'random') return null;   // 효과가 스스로 정한다
    const keys = collectTargetKeys(ops.viewFor(me()), spec);           // 거울 기준: foe:N = 플레이어 소환수, face = 플레이어 본체
    if (keys.length === 0) return null;
    const need = spec.scope === 'multi' ? Math.max(1, spec.count || 1) : 1;
    const foes = keys.filter(k => k.startsWith('foe:'));
    const ordered = spec.side === 'foe' ? [...foes, ...keys.filter(k => k === 'face')] : keys;
    return ordered.slice(0, need);
  }

  /** 소환수 공격 대상 — 본체를 칠 수 있으면(전장 비었거나 directAttack) 본체, 아니면 규칙대로 최전방(null) */
  function chooseAttackTarget(minion) {
    const alive = (foe().minions || []).filter(m => m && m.currentHp > 0);
    return (alive.length === 0 || readDirectAttack(minion)) ? 'face' : null;
  }

  /**
   * 봇의 턴 하나. 턴 시작 → 카드 → 콤보 스텝 → 소환수 공격 → 턴 종료.
   * 모든 행동이 ops.applyFoeAction을 지난다. 핸드오프(다음 턴 예약)는 엔진이 한다.
   * @param pace 액션 사이 간격(ms). 하네스는 0.
   */
  async function takeTurn({ pace = BOT_PACE_MS } = {}) {
    const side = me();
    const wait = () => (pace > 0 ? new Promise(r => setTimeout(r, pace)) : Promise.resolve());

    ops.addBattleLog(`<span class="text-red-400 font-bold">👹 [${nameOf(side)}] 의 다단계 콤보 턴!</span>`);

    // 🔁 턴 시작은 양 진영 공용 — 마나·버프·지속 피해·감쇠·소환수 상태·후유증·패시브·드로우 1장
    if (!ops.startTurn(side)) return;
    ops.addBattleLog(`<span class="text-slate-400">💎 ${nameOf(side)} 마나 ${side.mana}/${side.maxMana}</span>`);

    // 1. 카드 — 플레이어와 같은 관문(playCardFor)을 지난다. 대상은 정책으로 고른다.
    const limit = cardLimitThisTurn(side);
    for (let n = 0; n < limit; n++) {
      if (ops.isGameOver() || side.hand.length === 0) break;
      const pick = chooseCard(side);
      if (!pick) {
        ops.addBattleLog(`<span class="text-slate-500">💤 ${nameOf(side)}이(가) 낼 수 있는 카드가 없습니다. (마나 ${side.mana})</span>`);
        break;
      }
      const ok = await ops.applyFoeAction({
        kind: 'playCard', instanceId: pick.instanceId || pick.id, card: pick, slot: null, picked: chooseTargets(pick)
      });
      if (!ok) break;
      ops.renderBattleUI();
      await wait();
    }

    // 2. 콤보 스텝 — 보스 고유. 마나를 쓰지 않는 스크립트 공세 (CLAUDE.md 금지사항 65).
    if (!ops.isGameOver()) {
      const own = state.currentBoss && Array.isArray(state.currentBoss.comboPatterns) ? state.currentBoss.comboPatterns : [];
      const combos = own.length > 0 ? own : DEFAULT_COMBOS;
      const idx = state.currentBoss.actionIdx || 0;
      const combo = combos[idx % combos.length];
      state.currentBoss.actionIdx = idx + 1;
      ops.addBattleLog(`<span class="text-amber-400 font-bold">⚡ [보스 콤보 개시: ${escapeHtml(combo.name || '연계')}]</span>`);
      for (const step of (combo.steps || [])) {
        if (ops.isGameOver()) break;
        await ops.applyFoeAction({ kind: 'comboStep', step });
        ops.renderBattleUI();
      }
    }

    // 3. 소환수 공격 — 슬롯 **스냅샷**으로 순회 (함정이 도중에 전장을 바꿔도 인덱스가 밀리지 않는다)
    for (const bm of [...side.minions]) {
      if (ops.isGameOver()) break;
      const slotIdx = side.minions.indexOf(bm);
      if (slotIdx < 0) continue;                       // 함정 등으로 이미 사라졌다
      if (bm.canAttack === false) {
        ops.addBattleLog(`<span class="text-slate-500">💤 [${escapeHtml(bm.name)}]은(는) 소환된 턴이라 공격하지 못합니다.</span>`);
        continue;
      }
      await ops.applyFoeAction({ kind: 'attack', slotIdx, targetKey: chooseAttackTarget(bm) });
    }

    // 4. 턴 종료 — 양 진영 공용
    ops.endTurn(side);
    ops.renderBattleUI();
    ops.checkBattleStatus();
  }

  /**
   * 콤보 스텝 하나를 실행한다. 스텝의 **수치는 보스 고유 콤보의 내부값**이라 손대지 않았다
   * (BOSS_STEP_DAMAGE_MULT, 광역 본체 BOSS_STEP_AOE_FACE_MULT, 만석 +3, 처형 EXECUTE_MULT) —
   * 유저 결정 "콤보만 남기고". 대신 **효과는 전부 공용 규칙 함수**를 지난다:
   * 본체는 dealFaceDamage, 소환수는 damageEntity/strikeFrontLine, 상태이상은 관문.
   */
  async function executeStep(step) {
    const side = me(), target = foe();
    let val = step.value || 0;
    // 🔥 스텝 강화는 **소환수당 한 번**이다 (stepBuffed). 영구 중첩이면 minion_buff +4와 만석 +3이 2~3턴마다
    //    쌓여 10턴에 +7~12가 됐다 — 대응 수단이 없는 눈덩이였다 (실측 #95: 토큰 공격력 23·27).
    //    minion_buff는 7단계 전까지 죽은 코드였으므로 이 중첩은 #87 기준선에 없던 힘이다.
    const buffOnce = (minions, amount) => {
      let n = 0;
      for (const bm of minions) { if (bm.stepBuffed) continue; bm.attack += amount; bm.stepBuffed = true; n++; }
      return n;
    };
    // 💥 콤보 딜 하향 — 마나 제한을 받지 않는 유일한 딜이라 여기 한 곳에서 줄인다 (DECISIONS #87)
    if ((step.type === 'attack' || step.type === 'magic') && val > 0) {
      val = Math.max(1, Math.round(val * BOSS_STEP_DAMAGE_MULT));
      if (phase === 2) val = Math.floor(val * 1.4);   // 🔥 격노 — 공격·마법에만
    }

    if (step.type === 'summon_or_buff') {
      const el = (state.currentBoss && state.currentBoss.element) || 'fire';
      const pool = (ELEMENT_BOSS_MINIONS && ELEMENT_BOSS_MINIONS[el]) ? ELEMENT_BOSS_MINIONS[el] : BOSS_ADD_POOL;
      if (side.minions.length < minionCapThisTurn()) {
        const add = battleRng().pick(pool);
        // 공용 공격·오라 코드가 읽는 필드를 채운다 (skills·instanceId·statuses). 소환 후유증 포함.
        side.minions.push({
          ...add,
          cardType: add.cardType || 'unit',
          instanceId: `${add.id || 'boss-add'}#step${state.turnCount}-${side.minions.length}`,
          skills: Array.isArray(add.skills) ? add.skills : [{}],
          statuses: {},
          currentHp: add.maxHp,
          canAttack: false,
          summonedTurn: state.turnCount
        });
        audio.playSummon();
        ops.addBattleLog(`<span class="text-purple-400 font-bold">👾 [스텝/소환] ${nameOf(side)}이(가) [${escapeHtml(add.name)}] 을(를) 소환했습니다!</span>`);
      } else {
        const n = buffOnce(side.minions, 3);
        ops.addBattleLog(n > 0
          ? `<span class="text-red-400">🔥 [스텝/강화] ${nameOf(side)}이(가) 부하 ${n}기의 공격력을 +3 강화했습니다!</span>`
          : `<span class="text-slate-500">🔥 [스텝/강화] 부하들이 이미 강화되어 있습니다.</span>`);
      }
    } else if (step.type === 'minion_buff') {
      // 🐛 데이터(data.js 바알 3패턴)에 있는데 처리기가 없어 **조용히 아무 일도 안 하던** 스텝.
      //    형제 스텝 summon_or_buff의 강화 분기와 같은 뜻으로 구현한다.
      const amount = step.buffAtk || 3;
      const n = side.minions.length > 0 ? buffOnce(side.minions, amount) : 0;
      if (n > 0) {
        ops.addBattleLog(`<span class="text-red-400">🔥 [스텝/${escapeHtml(step.name || '강화')}] ${nameOf(side)}의 부하 ${n}기 공격력 +${amount}!</span>`);
      } else {
        ops.addBattleLog(`<span class="text-slate-500">🔥 [스텝/${escapeHtml(step.name || '강화')}] ${side.minions.length > 0 ? '부하들이 이미 강화되어 있습니다.' : '강화할 부하가 없습니다.'}</span>`);
      }
    } else if (step.type === 'debuff') {
      if (step.status && step.status.type) {
        const st = step.status;
        // 💫 소환수 전용 상태이상은 관문이 상대 최전방 소환수로 돌린다 (본체 봉쇄는 없다)
        const applied = ops.applyStatusRespectingScope(
          target.statuses, target.minions, '내', st.type, st.duration || 2, st.value || 0);
        if (applied && !isEntityOnly(st.type)) {
          const spec = STATUS_EFFECTS[st.type];
          ops.addBattleLog(`<span class="text-purple-400">${spec.icon} [스텝/${spec.name}] 플레이어가 ${spec.name} 상태가 되었습니다! (${applied.turns}턴${applied.value ? ` / 턴당 ${applied.value}` : ''})</span>`);
          if (st.type === 'shock') target.mana = Math.max(0, target.mana - 1);   // 감전은 즉발로 마나도 1 방전
        }
      }
    } else if (step.type === 'heal') {
      side.hp = Math.min(side.maxHp, side.hp + val);
      audio.playMagic();
      ops.addBattleLog(`<span class="text-emerald-400 font-bold">💖 [스텝/치유] ${nameOf(side)}이(가) [${escapeHtml(step.name || '치유')}] 으로 체력 +${val} 자가 회복!</span>`);
    } else if (step.type === 'disrupt') {
      if (step.manaBurn) {
        target.mana = Math.max(0, target.mana - step.manaBurn);
        ops.addBattleLog(`<span class="text-indigo-400">🌀 [스텝/방해] ${nameOf(side)}이(가) 플레이어의 마나 ${step.manaBurn}를 강탈했습니다!</span>`);
      }
      if (step.breakShield) {
        target.shield = 0;
        ops.addBattleLog(`<span class="text-red-400 font-bold">💔 [스텝/파쇄] 아군의 모든 방어막이 산산조각났습니다!</span>`);
      }
      if (step.discardCard && target.hand.length > 0) {
        const discarded = discardRandom(target, battleRng());
        audio.playSlash();
        ops.addBattleLog(`<span class="text-purple-400 font-black">🃏 [스텝/패 파괴] ${nameOf(side)}의 주술로 손패 [${escapeHtml(discarded.name)}] 이(가) 파기되었습니다!</span>`);
      }
    } else if (step.type === 'shield') {
      side.shield = (side.shield || 0) + val;
      if (step.reflectPercent) {
        // 🌵 가시는 진영 버프이고 턴제다 (THORNS_TURNS) — 유저 결정: N턴 후 소멸
        const turns = step.turns || THORNS_TURNS;
        side.buffs.thorns = step.reflectPercent;
        side.buffs.thornsTurns = turns;
        ops.addBattleLog(`<span class="text-emerald-300 font-bold">🌵 [가시 반사 결계] ${nameOf(side)}이(가) ${turns}턴 동안 받은 피해의 ${Math.round(step.reflectPercent * 100)}%를 반사합니다!</span>`);
      }
      audio.playShield();
      ops.addBattleLog(`<span class="text-blue-400">🛡️ [스텝/방어] ${nameOf(side)}이(가) [${escapeHtml(step.name || '방어')}] 으로 방어막 +${val} 전개!</span>`);
    } else if (step.type === 'magic' || step.type === 'attack') {
      audio.playCrit();
      let baseDmg = val;
      if (step.executeThreshold && target.hp <= target.maxHp * step.executeThreshold) {
        baseDmg = Math.floor(baseDmg * EXECUTE_MULT);
        ops.addBattleLog(`<span class="text-red-600 font-black">💀 [처형 발동] 플레이어 체력 위기로 ${nameOf(side)}의 공격력이 ${EXECUTE_MULT}배 증폭됩니다!</span>`);
      }
      const hits = step.multiHit || 1;
      for (let h = 0; h < hits; h++) {
        if (ops.isGameOver()) break;
        const hitDmg = Math.max(1, Math.floor(baseDmg / hits));
        ops.addBattleLog(`<span class="text-red-400 font-bold">💥 [스텝/타격 ${h + 1}/${hits}] ${escapeHtml(step.name || '타격')} (${hitDmg} 피해)</span>`);

        if (step.isAoe) {
          // 광역: 상대 소환수 전부(수비 적용) + 본체 일부(BOSS_STEP_AOE_FACE_MULT)
          target.minions.forEach(m => {
            const hit = damageEntity(m, hitDmg, { pierce: !!step.pierceShield });
            ops.addBattleLog(`<span class="text-yellow-400">💥 광역 피해: [${escapeHtml(m.name)}] -${hit.dealt} HP${describeDamageExtras(hit)}</span>`);
          });
          target.minions = removeDead(target.minions);
          ops.dealFaceDamage(target, Math.floor(hitDmg * BOSS_STEP_AOE_FACE_MULT), { pierce: !!step.pierceShield, attacker: side, source: step.name });
        } else {
          // 단일: 최전방 소환수가 대신 맞는다 (관통이면 본체로)
          const res = strikeFrontLine(target.minions, hitDmg, {
            addBattleLog: ops.addBattleLog,
            pierceShield: step.pierceShield,
            absorbLabel: `이(가) ${nameOf(side)}의 공격을 대신 흡수했습니다!`,
            onDirectHit: (d, pierce) => ops.dealFaceDamage(target, d, { pierce: !!pierce, attacker: side, source: step.name })
          });
          target.minions = res.minions;
        }

        if (step.lifesteal || step.lifestealPercent) {
          const healAmt = Math.floor(hitDmg * (step.lifestealPercent || 0.5));
          side.hp = Math.min(side.maxHp, side.hp + healAmt);
          ops.addBattleLog(`<span class="text-purple-300">🩸 ${nameOf(side)}이(가) 흡혈로 체력 +${healAmt} 회복!</span>`);
        }
      }
    }
  }

  /**
   * 본체가 낮은 체력에 들어섰을 때 (엔진의 dealFaceDamage가 부른다).
   * @returns {boolean} 이번 호출로 격노가 켜졌는가 — 엔진이 배지를 켠다
   */
  function onLowHp(target) {
    if (phase !== 1 || target.hp > target.maxHp * 0.4) return false;
    phase = 2;
    ops.addBattleLog(`<span class="text-red-500 font-black text-sm">🔥 [광폭화] ${escapeHtml(target.name)}이(가) 격노하여 콤보 공세의 위력이 폭증합니다!</span>`);
    ops.triggerLiveBossReaction('lowHp');
    return true;
  }

  return {
    takeTurn,
    executeStep,
    onLowHp,
    chooseTargets,
    reset() { phase = 1; },
    get phase() { return phase; }
  };
}
