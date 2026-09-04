// _verify/battle-audit.js — 전투 전수 검증 하네스
//
// 브라우저 콘솔에서 (약 3초):
//   const A = await import('/_verify/battle-audit.js?v=' + Date.now()); await A.runAll();
//
// 전투 로직을 고쳤으면 돌리세요. 이 프로젝트에는 빌드·테스트 명령이 없고,
// "카드에 적힌 것과 실제 동작이 다르다"가 가장 자주 나온 버그 유형입니다.
//
// ⚠️ **전부 초록인 결과는 그 자체로 아무것도 증명하지 않는다.**
//    새 검사를 쓰면 `git stash`로 수정 전 코드에 돌려 **실패하는지 확인**하세요.
//    재현하지 못하는 검사는 그 버그를 잡을 수 없습니다.
//
// ⚠️ 오판을 부르는 함정 셋 (전부 실제로 밟았다 → DECISIONS #82, #83):
//   ① 헬퍼를 빠뜨리면 예외가 try/catch에 삼켜져 "무동작"으로 보인다
//      → `BE.__test.helpers()`로 **엔진의 진짜 묶음**을 쓴다. 목을 만들지 않는다.
//   ② 픽스처가 전제를 만족하지 않으면 "미발동"으로 보인다
//      → 검사 전에 전제를 명시적으로 세팅한다.
//        (예: 방금 얻은 방어막이 함정 피해를 흡수해 체력이 안 줄기도 한다)
//   ③ 모듈을 `?v=`로 import하면 **다른 인스턴스**가 생겨 `state`가 갈라진다
//      → 엔진 모듈은 접미사 없이 import한다.

import { state } from '/js/storage.js';
import * as BE from '/js/battle-engine.js';
import { COMBO_TRIGGERS, COMBO_SCALINGS, COMBO_SCOPES, SCOPE_POWER_MULT,
         selfView, foeView, HAND_CAP } from '/js/archetype-identity.js';
import { ARCHETYPE_COMBO_ACTIONS, runArchetypeCombo, belongsToTheme } from '/js/archetype-combos.js';
import { triggerArchetypeCombo } from '/js/archetype-service.js';
import { attachPvpSession, detachPvpSession, handleRemoteAction, slimCardForWire } from '/js/pvp-battle.js';
import { STATUS_EFFECTS, applyStatus, createStatusState, isEntityOnly,
         collectDamageOverTime, decayStatuses, consumeBlockingStatus,
         getIncomingDamageMultiplier, getOnHitBonusDamage,
         isBlocked } from '/js/status-effects.js';
// ⚠️ 새 API는 **네임스페이스로** 받는다. 이름 import로 받으면 구버전에서 모듈 로드 자체가 죽어
//    fail-first가 "검사 하나가 빨갛다"가 아니라 "하네스가 안 뜬다"가 된다 (실제로 밟았다).
import * as SE from '/js/status-effects.js';
import { damageEntity, selectFrontTarget, applyPlayerSkillEffects, strikeFrontLine } from '/js/skill-effects.js';
import { EXECUTE_MULT } from '/js/battle-rules.js';
import { withFlavorDisabled } from '/js/local-flavor.js';
import { readTargetSpec, needsTargetPick, collectTargetKeys, resolveTargetKey,
         describeTarget, targetCostMultiplier, hasTargetableEffect } from '/js/effect-targets.js';
import { TRAP_TRIGGERS, checkTraps, normalizeTrapTrigger } from '/js/trap-system.js';
import { refreshMinions, createSides, createBuffs, canPlayCard, growMana } from '/js/combat-side.js';
import { seedBattleRng } from '/js/rng.js';
import { isValidTarget, cancelTargeting, beginTargeting } from '/js/targeting.js';
import { getSkillBadgesHtml } from '/js/card-renderer.js';
import { KEYWORD_DEFINITIONS } from '/js/keyword-service.js';
import { validateFlavor } from '/js/card-describe.js';
import { describeSkillFromData, sanitizeAndClampCardData, evaluateCardPower,
         BOSS_STEP_DAMAGE_MULT, PLAYER_BASE_HP } from '/js/config.js';

// 💥 보스 콤보 스텝 딜은 BOSS_STEP_DAMAGE_MULT로 하향된다 (DECISIONS #87).
// 기대값을 숫자로 박으면 튜닝할 때마다 검사가 깨진다 — 상수에서 유도한다.
const 스텝딜 = (v) => Math.max(1, Math.round(v * BOSS_STEP_DAMAGE_MULT));
import { readDirectAttack } from '/js/card-keywords.js';
import { attachCardDetail, hideCardDetail } from '/js/card-detail.js';

// ── 결과 수집 ────────────────────────────────────────────────
let results = [];
function check(suite, name, pass, detail = '') {
  results.push({ suite, name, pass: !!pass, detail });
  return !!pass;
}
function snapshot() {
  return JSON.stringify({
    php: state.playerHp, pmax: state.playerMaxHp, psh: state.playerMaxShield,
    pmana: state.playerMana, bmana: state.bossMana, phand: (state.playerHand || []).length,
    pdeck: (state.playerDeck || []).length,
    pmin: (state.playerMinions || []).map(m => `${m.name}:${m.currentHp}/${m.attack}/${m.defense}/${!!m.taunt}/${JSON.stringify(m.statuses || {})}`),
    bhp: state.currentBoss && state.currentBoss.currentHp, bsh: state.currentBoss && state.currentBoss.shield,
    bhand: (state.bossHand || []).length, bdeck: (state.bossDeck || []).length,
    bmin: (state.bossMinions || []).map(m => `${m.name}:${m.currentHp}/${m.attack}/${m.defense}/${!!m.taunt}/${JSON.stringify(m.statuses || {})}`)
  });
}

// ── 픽스처 ───────────────────────────────────────────────────
function minion(over = {}) {
  return Object.assign({
    id: 'm' + Math.random().toString(36).slice(2, 7),
    name: '테스트병', cardType: 'unit', element: 'fire',
    attack: 10, defense: 0, maxHp: 30, currentHp: 30,
    canAttack: true, taunt: false, statuses: {},   // `frozen` 플래그는 제거됐다 (DECISIONS #105)
    summonedTurn: 0, skills: [{}]
  }, over);
}
function card(over = {}) {
  return Object.assign({
    id: 'c' + Math.random().toString(36).slice(2, 7),
    name: '테스트카드', cardType: 'unit', element: 'fire', cost: 3, rarity: 'common',
    attack: 10, defense: 0, hp: 30, skills: [{}]
  }, over);
}

/** 결정적인 기본 판. seed 고정. */
function resetBoard(over = {}) {
  seedBattleRng(12345);
  state.currentBoss = Object.assign({
    id: 'testboss', name: '검증보스', element: 'dark',
    maxHp: 300, currentHp: 300, shield: 0, actionIdx: 0
  }, over.boss || {});
  state.turnCount = over.turnCount != null ? over.turnCount : 4;
  state.playerHp = over.playerHp != null ? over.playerHp : 50;
  state.playerMaxHp = over.playerMaxHp != null ? over.playerMaxHp : 50;
  state.playerMaxShield = over.playerMaxShield != null ? over.playerMaxShield : 0;
  state.playerMana = over.playerMana != null ? over.playerMana : 5;
  state.playerMaxMana = 5;
  state.playerMinions = over.playerMinions || [];
  state.bossMinions = over.bossMinions || [];
  state.playerHand = over.playerHand || [];
  state.playerDeck = over.playerDeck || [];
  state.bossHand = over.bossHand || [];
  state.bossDeck = over.bossDeck || [];
  state.isAnimating = false;
  // ② 함정 회피: 모듈 지역 상태(상태이상·버프·함정)도 반드시 초기화한다.
  //    안 하면 앞 검사에서 걸린 무적·취약이 다음 검사에 새어 든다.
  BE.__test.reset();
}

// ============================================================
// 1. 공격 규칙
// ============================================================
function suiteAttack() {
  const S = '공격 규칙';

  // canAttackFace — 전장 비었을 때
  resetBoard();
  check(S, '전장이 비면 본체 공격 가능', BE.canAttackFace([], minion()) === true);
  check(S, '전장에 소환수가 있으면 본체 불가',
    BE.canAttackFace([minion()], minion()) === false);
  check(S, '죽은 소환수는 벽이 되지 않음',
    BE.canAttackFace([minion({ currentHp: 0 })], minion()) === true);
  check(S, 'directAttack(최상위)은 전장을 무시',
    BE.canAttackFace([minion()], minion({ directAttack: true })) === true);
  check(S, 'directAttack(skill)도 인식',
    BE.canAttackFace([minion()], minion({ skills: [{ directAttack: true }] })) === true);

  // 🗑️ 도발은 게임에서 제거됐다 (DECISIONS #84)
  check(S, 'readTaunt는 더 이상 존재하지 않는다', typeof BE.readTaunt === 'undefined');

  // 본체 지정이 전장에 막혀 최전방으로 리다이렉트되는가
  resetBoard({
    playerMinions: [minion({ name: '내병사', attack: 12, canAttack: true })],
    bossMinions: [minion({ name: '적앞', currentHp: 40 }), minion({ name: '적뒤', currentHp: 40 })]
  });
  BE.resolveMinionAttack(0, 'face');
  check(S, '전장이 있으면 face 지정이 최전방으로 리다이렉트',
    state.bossMinions[0].currentHp === 28 && state.currentBoss.currentHp === 300,
    `앞=${state.bossMinions[0].currentHp} 보스=${state.currentBoss.currentHp}`);

  // 🗑️ 도발 제거 — 옛 도발 소환수가 뒤에 있어도 내가 지정한 대상이 맞는다
  resetBoard({
    playerMinions: [minion({ name: '내병사', attack: 12 })],
    bossMinions: [minion({ name: '앞', currentHp: 40 }), minion({ name: '옛도발', currentHp: 40, taunt: true })]
  });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '지정한 대상이 그대로 맞는다 (도발 리다이렉트 없음)',
    state.bossMinions[0].currentHp === 28 && state.bossMinions[1].currentHp === 40,
    `앞=${state.bossMinions[0].currentHp} 옛도발=${state.bossMinions[1].currentHp}`);

  // 뒤에 있는 소환수도 자유롭게 고를 수 있다
  resetBoard({
    playerMinions: [minion({ name: '내병사', attack: 12 })],
    bossMinions: [minion({ name: '앞', currentHp: 40 }), minion({ name: '뒤', currentHp: 40 })]
  });
  BE.resolveMinionAttack(0, 'foe:1');
  check(S, '뒷줄도 직접 지정할 수 있다',
    state.bossMinions[1].currentHp === 28 && state.bossMinions[0].currentHp === 40,
    `앞=${state.bossMinions[0].currentHp} 뒤=${state.bossMinions[1].currentHp}`);

  // attackWithMinion이 고를 수 있는 목록에 전원이 들어가는가
  resetBoard({
    playerMinions: [minion({ name: '내병사', attack: 12, canAttack: true })],
    bossMinions: [minion({ name: 'A' }), minion({ name: 'B', taunt: true }), minion({ name: 'C' })]
  });
  BE.attackWithMinion(0);
  const keys = ['foe:0', 'foe:1', 'foe:2'].filter(k => isValidTarget(k));
  const faceOffered = isValidTarget('face');
  cancelTargeting();
  check(S, '상대 전장 전원이 유효 대상 / 본체는 제외',
    keys.length === 3 && !faceOffered, `${keys.join(',')} face=${faceOffered}`);

  // directAttack은 전장을 무시하고 본체 타격 (유일한 예외)
  resetBoard({
    playerMinions: [minion({ name: '직격병', attack: 12, directAttack: true })],
    bossMinions: [minion({ name: '벽', currentHp: 40 })]
  });
  BE.resolveMinionAttack(0, 'face');
  check(S, 'directAttack은 전장을 넘어 본체 타격',
    state.currentBoss.currentHp === 288 && state.bossMinions[0].currentHp === 40,
    `보스=${state.currentBoss.currentHp} 벽=${state.bossMinions[0].currentHp}`);

  // 수비력이 방어할 때도 적용되는가 (보스 → 내 소환수)
  resetBoard({ playerMinions: [minion({ name: '방패병', defense: 4, currentHp: 30 })] });
  BE.foeMinionAttack(0, minion({ name: '보스부하', attack: 10 }));
  check(S, '방어 시에도 수비력 적용 (10-4=6)',
    state.playerMinions[0].currentHp === 24, `hp=${state.playerMinions[0].currentHp}`);

  // 수비력이 공격력보다 커도 최소 1은 들어간다
  resetBoard({ playerMinions: [minion({ name: '철벽', defense: 99, currentHp: 30 })] });
  BE.foeMinionAttack(0, minion({ attack: 10 }));
  check(S, '수비력 초과여도 최소 1 피해',
    state.playerMinions[0].currentHp === 29, `hp=${state.playerMinions[0].currentHp}`);

  // 보스는 지정이 없으면 맨 앞을 친다 (도발 우선순위 없음)
  resetBoard({
    playerMinions: [minion({ name: '앞줄' }), minion({ name: '옛도발', taunt: true })]
  });
  BE.foeMinionAttack(0, minion({ attack: 10 }));
  check(S, '보스 공격은 맨 앞을 친다 (도발 우선 없음)',
    state.playerMinions[0].currentHp === 20 && state.playerMinions[1].currentHp === 30,
    `앞=${state.playerMinions[0].currentHp} 옛도발=${state.playerMinions[1].currentHp}`);

  // PvP 재생: 상대가 고른 대상이 그대로 맞는다
  resetBoard({
    playerMinions: [minion({ name: '앞줄' }), minion({ name: '뒷줄' })]
  });
  BE.foeMinionAttack(0, minion({ attack: 10 }), 'foe:1');
  check(S, 'PvP 지정 공격이 그대로 재생된다',
    state.playerMinions[1].currentHp === 20 && state.playerMinions[0].currentHp === 30,
    `앞=${state.playerMinions[0].currentHp} 뒤=${state.playerMinions[1].currentHp}`);

  // 보스도 내 전장이 있으면 본체를 못 친다
  resetBoard({ playerMinions: [minion({ name: '벽' })] });
  BE.foeMinionAttack(0, minion({ attack: 10 }), 'face');
  check(S, '보스도 전장이 있으면 본체 직격 불가',
    state.playerHp === 50 && state.playerMinions[0].currentHp === 20,
    `php=${state.playerHp} 벽=${state.playerMinions[0].currentHp}`);

  // 행동 봉쇄된 상대 소환수는 공격하지 못한다
  resetBoard({ playerMinions: [] });
  const stunned = minion({ attack: 10, blockedBy: 'stun' });
  BE.foeMinionAttack(0, stunned, 'face');
  check(S, '기절한 상대 소환수는 공격 불가', state.playerHp === 50, `php=${state.playerHp}`);

  // 소환 후유증 / 봉쇄 해제 규칙
  const sides = createSides({
    playerStatus: createStatusState(), bossStatus: createStatusState(),
    playerBuffs: createBuffs(), bossBuffs: createBuffs()
  });
  state.turnCount = 5;
  state.playerMinions = [
    minion({ name: '이번턴소환', summonedTurn: 5, canAttack: false }),
    minion({ name: '지난턴소환', summonedTurn: 4, canAttack: false }),
    minion({ name: '기절중', summonedTurn: 1, blockedBy: 'stun' }),
    minion({ name: '빙결중', summonedTurn: 1, statuses: {} })
  ];
  applyStatus(state.playerMinions[3].statuses, 'freeze', 2, 4);
  refreshMinions(sides.player);
  check(S, '이번 턴 소환수는 공격 불가 (소환 후유증)', state.playerMinions[0].canAttack === false);
  check(S, '지난 턴 소환수는 공격 가능', state.playerMinions[1].canAttack === true);
  check(S, '기절 중이면 공격 불가', state.playerMinions[2].canAttack === false);
  // 🔁 재기준선 (DECISIONS #105): 빙결은 더 이상 행동을 막지 않는다 — 기절과 코드가 같은 중복이었다.
  //    이제 공격력 약화다. 때릴 수는 있고, 약하게 때린다. `frozen` 플래그는 제거됐다.
  check(S, '빙결은 행동을 막지 않는다 (기절 중복이 아니다)',
    state.playerMinions[3].canAttack === true && state.playerMinions[3].frozen === undefined,
    `canAttack=${state.playerMinions[3].canAttack} frozen=${state.playerMinions[3].frozen}`);

  // 오라 공격력이 실제 공격에 반영되는가
  resetBoard({
    playerMinions: [
      minion({ name: '오라탑', cardType: 'structure', currentHp: 20,
               skills: [{ passiveEffect: { aura: { scope: 'all', attackBonus: 5 } } }] }),
      minion({ name: '수혜자', attack: 10 })
    ],
    bossMinions: []
  });
  check(S, 'auraAttackBonus가 +5를 준다', BE.auraAttackBonus(state.playerMinions[1]) === 5);
  BE.resolveMinionAttack(1, 'face');
  check(S, '오라 공격력이 실제 피해에 반영 (10+5=15)',
    state.currentBoss.currentHp === 285, `보스=${state.currentBoss.currentHp}`);

  // 건축물이 죽으면 오라도 사라진다
  state.playerMinions[0].currentHp = 0;
  state.playerMinions = state.playerMinions.filter(m => m.currentHp > 0);
  check(S, '건축물이 사라지면 오라도 사라짐', BE.auraAttackBonus(state.playerMinions[0]) === 0);
}

// ============================================================
// 2. 효과 대상 (targeting)
// ============================================================
function suiteTargets() {
  const S = '효과 대상';

  // 정규화
  const d = readTargetSpec({});
  check(S, '기본값은 적 1체', d.side === 'foe' && d.scope === 'single' && d.count === 1);
  check(S, 'isAoeSpell 호환 → 적 전체',
    JSON.stringify(readTargetSpec({ isAoeSpell: true })) === JSON.stringify({ side: 'foe', scope: 'all', count: 0 }));
  check(S, 'targetCount 상한 3',
    readTargetSpec({ targetScope: 'multi', targetCount: 9 }).count === 3);
  check(S, '알 수 없는 side는 foe로', readTargetSpec({ targetSide: 'zzz' }).side === 'foe');

  // 비용 배수
  check(S, '전체 대상 배수 2.2', targetCostMultiplier({ targetScope: 'all' }) === 2.2);
  check(S, '무작위 배수 0.8', targetCostMultiplier({ targetScope: 'random' }) === 0.8);
  check(S, '다중 3체 배수 2.0', targetCostMultiplier({ targetScope: 'multi', targetCount: 3 }) === 2);

  // 지정 필요 여부
  check(S, '피해 단일 → 지정 필요', needsTargetPick({ damage: 10 }) === true);
  check(S, '전체 대상 → 지정 불필요', needsTargetPick({ damage: 10, targetScope: 'all' }) === false);
  check(S, 'self → 지정 불필요', needsTargetPick({ damage: 10, targetSide: 'self' }) === false);
  check(S, '방어막만 → 지정 불필요', needsTargetPick({ shield: 10 }) === false);
  check(S, '피해경감은 대상 없음', hasTargetableEffect({ damageReduction: 30 }) === false);
  check(S, '약화·무효화는 대상 필요',
    hasTargetableEffect({ attackDown: 3 }) && hasTargetableEffect({ silence: true }));

  // 키 수집
  resetBoard({
    playerMinions: [minion({ name: 'A' }), minion({ name: 'B' })],
    bossMinions: [minion({ name: 'X' })]
  });
  const foeKeys = collectTargetKeys(state, readTargetSpec({ damage: 5 }));
  check(S, 'foe 대상 키 = 적 소환수 + face',
    JSON.stringify(foeKeys) === JSON.stringify(['foe:0', 'face']), foeKeys.join(','));
  const allyKeys = collectTargetKeys(state, readTargetSpec({ heal: 5, targetSide: 'ally' }));
  check(S, 'ally 대상 키 = 아군 소환수 + self-face',
    JSON.stringify(allyKeys) === JSON.stringify(['ally:0', 'ally:1', 'self-face']), allyKeys.join(','));
  const anyKeys = collectTargetKeys(state, readTargetSpec({ damage: 5, targetSide: 'any' }));
  check(S, 'any 대상 키 = 양 진영 전부', anyKeys.length === 5, anyKeys.join(','));

  // ⭐ 모든 대상 키가 실제로 화면에서 눌릴 수 있는가 (DOM 존재 여부)
  //    키만 만들고 누를 곳이 없으면 대상 선택에서 빠져나올 수 없다.
  BE.renderBattleUI();
  const dom = {};
  for (const k of anyKeys) dom[k] = !!document.querySelector(`[data-target-key="${k}"]`);
  check(S, '모든 대상 키에 클릭 가능한 DOM이 존재',
    Object.values(dom).every(Boolean), JSON.stringify(dom));

  // ⭐ 🖱️ **DOM 클릭 한 번은 반드시 선택 한 번**이어야 한다 (DECISIONS #89)
  //
  //    🐛 상대 소환수 목록(#boss-minions-field)이 본체 클릭 영역(#boss-container)
  //       **안에** 있는데 stopPropagation이 없었다. 그래서 소환수를 한 번 누르면
  //       클릭이 부모로 올라가 **소환수 + 본체가 함께 지정**됐다.
  //       "적 2체" 카드가 한 번 누르자마자 끝나 버렸다.
  //    ⚠️ API(pickTarget)로만 검사하면 절대 못 잡는다 — 반드시 .click()으로 본다.
  for (const [라벨, 준비, 키] of [
    ['상대 소환수', () => resetBoard({ bossMinions: [minion({ name: 'A' }), minion({ name: 'B' })] }), 'foe:0'],
    ['아군 소환수', () => resetBoard({ playerMinions: [minion({ name: 'A' }), minion({ name: 'B' })] }), 'ally:0']
  ]) {
    준비();
    BE.renderBattleUI();
    const 고른것 = [];
    const started = beginTargeting({
      kind: 'effect',
      valid: ['foe:0', 'foe:1', 'ally:0', 'ally:1', 'face', 'self-face'],
      need: 3,
      onProgress: (all) => { 고른것.length = 0; 고른것.push(...all); },
      onPick: (_f, all) => { 고른것.length = 0; 고른것.push(...all); }
    });
    const el = document.querySelector(`[data-target-key="${키}"]`);
    if (el) el.click();
    const 소비 = 고른것.length;
    cancelTargeting(false);
    check(S, `${라벨} 클릭 1회 = 선택 1회 (부모로 전파되지 않는다)`,
      started && 소비 === 1, `선택 ${소비}회: ${고른것.join(',')}`);
  }

  // ⚠️ 위 검사가 판을 바꿨다 — 아래 키 해석 검사가 쓰는 판으로 되돌린다.
  //    (검사끼리 판을 물려 쓰면 뒤 검사가 엉뚱한 이유로 깨진다)
  resetBoard({
    playerMinions: [minion({ name: 'A' }), minion({ name: 'B' })],
    bossMinions: [minion({ name: 'X' })]
  });

  // 키 해석
  check(S, "resolveTargetKey 'face'", resolveTargetKey(state, 'face').kind === 'foeFace');
  check(S, "resolveTargetKey 'self-face'", resolveTargetKey(state, 'self-face').kind === 'selfFace');
  check(S, "resolveTargetKey 'foe:0'", resolveTargetKey(state, 'foe:0').entity === state.bossMinions[0]);
  check(S, "resolveTargetKey 'ally:1'", resolveTargetKey(state, 'ally:1').entity === state.playerMinions[1]);
  check(S, 'resolveTargetKey 범위 밖 → null', resolveTargetKey(state, 'foe:9') === null);

  // 설명문
  check(S, "describeTarget self → '자신'", describeTarget({ targetSide: 'self' }) === '자신');
  check(S, 'describeTarget 다중', describeTarget({ targetScope: 'multi', targetCount: 2 }) === '적 2체');
  check(S, 'describeTarget 아군 전체',
    describeTarget({ targetSide: 'ally', targetScope: 'all' }) === '아군 전체');
}

// ============================================================
// 3. 카드 효과 전수
// ============================================================
function fireSkill(skill, opts = {}) {
  const c = card({ name: '검증주문', cardType: 'spell', skills: [skill] });
  applyPlayerSkillEffects(skill, { card: c, game: state, helpers: BE.__test.helpers() },
    Object.assign({ sourceLabel: '주문', allowAoe: true }, opts));
}

function suiteEffects() {
  const S = '카드 효과';

  // 피해 (본체)
  resetBoard();
  fireSkill({ damage: 20 });
  check(S, 'damage 20 → 보스 -20', state.currentBoss.currentHp === 280, `${state.currentBoss.currentHp}`);

  // multiHit — 총량으로 들어간다
  resetBoard();
  fireSkill({ damage: 6, multiHit: 3 });
  check(S, 'multiHit 3 → 총 18', state.currentBoss.currentHp === 282, `${state.currentBoss.currentHp}`);

  // 치명타 (확률 1.0)
  resetBoard();
  fireSkill({ damage: 10, critChance: 1, critMultiplier: 2 });
  check(S, 'critChance 1.0 → 2배', state.currentBoss.currentHp === 280, `${state.currentBoss.currentHp}`);
  resetBoard();
  fireSkill({ damage: 10, critChance: 0 });
  check(S, 'critChance 0 → 그대로', state.currentBoss.currentHp === 290, `${state.currentBoss.currentHp}`);

  // 처형
  resetBoard({ boss: { maxHp: 300, currentHp: 60, shield: 0 } });
  fireSkill({ damage: 10, executeThreshold: 0.3 });
  check(S, '처형 문턱 이하 → 2배', state.currentBoss.currentHp === 40, `${state.currentBoss.currentHp}`);
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  fireSkill({ damage: 10, executeThreshold: 0.3 });
  check(S, '처형 문턱 초과 → 그대로', state.currentBoss.currentHp === 290, `${state.currentBoss.currentHp}`);

  // 흡혈
  resetBoard({ playerHp: 20 });
  fireSkill({ damage: 20, lifestealPercent: 0.5 });
  check(S, '흡혈 50% → 본체 +10', state.playerHp === 30, `${state.playerHp}`);
  resetBoard({ playerHp: 48 });
  fireSkill({ damage: 20, lifestealPercent: 0.5 });
  check(S, '흡혈은 최대 체력을 넘지 않음', state.playerHp === 50, `${state.playerHp}`);

  // 방어막 흡수 & 관통
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 30 } });
  fireSkill({ damage: 20 });
  check(S, '보스 방어막이 피해 흡수',
    state.currentBoss.shield === 10 && state.currentBoss.currentHp === 300,
    `sh=${state.currentBoss.shield} hp=${state.currentBoss.currentHp}`);

  // 광역
  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 30 }), minion({ name: 'Y', currentHp: 30 })] });
  fireSkill({ damage: 10, isAoeSpell: true });
  check(S, '광역: 부하 전부 + 본체',
    state.bossMinions.length === 2 && state.bossMinions[0].currentHp === 20 &&
    state.bossMinions[1].currentHp === 20 && state.currentBoss.currentHp === 290,
    `${state.bossMinions.map(m => m.currentHp)} 보스=${state.currentBoss.currentHp}`);

  // 지정 피해
  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 30 }), minion({ name: 'Y', currentHp: 30 })] });
  fireSkill({ damage: 10 }, { picked: ['foe:1'] });
  check(S, '지정한 소환수에게만 피해',
    state.bossMinions[0].currentHp === 30 && state.bossMinions[1].currentHp === 20 &&
    state.currentBoss.currentHp === 300,
    `${state.bossMinions.map(m => m.currentHp)} 보스=${state.currentBoss.currentHp}`);

  // 지정 피해로 죽으면 제거
  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 5 })] });
  fireSkill({ damage: 10 }, { picked: ['foe:0'] });
  check(S, '지정 피해로 죽은 소환수 제거', state.bossMinions.length === 0);

  // 방어막
  resetBoard();
  fireSkill({ shield: 15 });
  check(S, 'shield 15', state.playerMaxShield === 15, `${state.playerMaxShield}`);

  // 치유 — 본체
  resetBoard({ playerHp: 20 });
  fireSkill({ heal: 12 });
  check(S, 'heal(body) → 본체 회복', state.playerHp === 32, `${state.playerHp}`);

  // 치유 — 지정 아군 소환수
  resetBoard({ playerMinions: [minion({ name: '부상병', currentHp: 10, maxHp: 30 })], playerHp: 20 });
  fireSkill({ heal: 12, targetSide: 'ally' }, { picked: ['ally:0'] });
  check(S, 'heal + picked ally → 그 소환수만 회복',
    state.playerMinions[0].currentHp === 22 && state.playerHp === 20,
    `소환수=${state.playerMinions[0].currentHp} 본체=${state.playerHp}`);

  // 치유 — hpTarget minion
  resetBoard({ playerMinions: [minion({ name: '테스트카드', currentHp: 10, maxHp: 30 })], playerHp: 20 });
  fireSkill({ heal: 12, hpTarget: 'minion' });
  check(S, 'hpTarget=minion → 자기 소환수 회복',
    state.playerMinions[0].currentHp === 22 && state.playerHp === 20,
    `소환수=${state.playerMinions[0].currentHp} 본체=${state.playerHp}`);

  // 최대 체력 증가
  resetBoard({ playerHp: 30, playerMaxHp: 50 });
  fireSkill({ maxHpGain: 10 });
  check(S, 'maxHpGain은 현재 체력도 같이 올림',
    state.playerMaxHp === 60 && state.playerHp === 40, `${state.playerHp}/${state.playerMaxHp}`);

  // 마나
  resetBoard({ playerMana: 2 });
  fireSkill({ manaGain: 3 });
  check(S, 'manaGain 3', state.playerMana === 5, `${state.playerMana}`);
  resetBoard({ playerMana: 9 });
  fireSkill({ manaGain: 5 });
  check(S, 'manaGain 상한 10', state.playerMana === 10, `${state.playerMana}`);

  // 드로우
  resetBoard({ playerDeck: [card(), card(), card()], playerHand: [] });
  fireSkill({ drawCards: 2 });
  check(S, 'drawCards 2', state.playerHand.length === 2 && state.playerDeck.length === 1,
    `손패=${state.playerHand.length} 덱=${state.playerDeck.length}`);

  // 버프 계열 — 엔진 내부 버프를 검사한다
  resetBoard();
  fireSkill({ doubleCastNext: true });
  check(S, 'doubleCastNext 예약', BE.__test.buffs().player.doubleCast === true);
  resetBoard();
  fireSkill({ invulnerableTurns: 2 });
  check(S, 'invulnerableTurns 예약', BE.__test.buffs().player.invulnerable === 2);
  resetBoard();
  fireSkill({ pierceShield: true });
  check(S, 'pierceShield 예약', BE.__test.buffs().player.pierceShield === true);
  resetBoard();
  fireSkill({ damageReduction: 40, reductionTurns: 3 });
  check(S, 'damageReduction 예약',
    BE.__test.buffs().player.damageReduction === 40 && BE.__test.buffs().player.damageReductionTurns === 3);

  // 무적이 실제로 피해를 막는가
  resetBoard({ playerMinions: [] });
  fireSkill({ invulnerableTurns: 2 });
  BE.foeMinionAttack(0, minion({ attack: 20 }), 'face');
  check(S, '무적이 본체 피해를 완전 차단', state.playerHp === 50, `${state.playerHp}`);

  // 피해 경감이 실제로 깎는가
  resetBoard({ playerMinions: [] });
  fireSkill({ damageReduction: 50, reductionTurns: 3 });
  BE.foeMinionAttack(0, minion({ attack: 20 }), 'face');
  check(S, '피해 경감 50% (20→10)', state.playerHp === 40, `${state.playerHp}`);

  // pierceShield가 보스 방어막을 뚫는가
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 50 } });
  fireSkill({ pierceShield: true });
  fireSkill({ damage: 20 });
  check(S, '실드 관통이 보스 방어막을 무시',
    state.currentBoss.shield === 50 && state.currentBoss.currentHp === 280,
    `sh=${state.currentBoss.shield} hp=${state.currentBoss.currentHp}`);

  // 공격력 약화
  resetBoard({ bossMinions: [minion({ name: 'X', attack: 10 })] });
  fireSkill({ attackDown: 4 }, { picked: ['foe:0'] });
  check(S, 'attackDown 지정', state.bossMinions[0].attack === 6, `${state.bossMinions[0].attack}`);
  resetBoard({ bossMinions: [minion({ name: 'X', attack: 2 })] });
  fireSkill({ attackDown: 9 }, { picked: ['foe:0'] });
  check(S, 'attackDown은 0 밑으로 안 감', state.bossMinions[0].attack === 0);
  resetBoard({ bossMinions: [minion({ name: 'X', attack: 10 })] });
  fireSkill({ attackDown: 4 });
  check(S, 'attackDown 미지정 → 첫 대상', state.bossMinions[0].attack === 6);

  // 무효화
  resetBoard({ bossMinions: [minion({ name: 'X', skills: [{ damage: 5 }] })] });
  fireSkill({ silence: true }, { picked: ['foe:0'] });
  check(S, 'silence: 효과 제거, 스탯 유지',
    state.bossMinions[0].skills.length === 0 &&
    state.bossMinions[0].attack === 10 && state.bossMinions[0].silenced === true);

  // 💥 다중 대상인데 고를 대상이 모자라면 남은 타수가 본체로 간다 (DECISIONS #88)
  //    "적 2체에게 10 피해"는 총 20어치 값을 치른 카드다. 전장이 비었다고
  //    10만 들어가면 카드가 값을 못 한다.
  const 다중 = { damage: 10, targetScope: 'multi', targetCount: 2 };
  resetBoard({ bossMinions: [] });
  fireSkill(다중, { picked: ['face'] });
  check(S, '다중 2체 / 상대 전장 0기 → 본체에 20',
    state.currentBoss.currentHp === 280, `${state.currentBoss.currentHp}`);

  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 })] });
  fireSkill(다중, { picked: ['foe:0', 'face'] });
  check(S, '다중 2체 / 기물 1 + 본체 1 → 각각 10',
    state.bossMinions[0].currentHp === 30 && state.currentBoss.currentHp === 290,
    `기물=${state.bossMinions[0].currentHp} 보스=${state.currentBoss.currentHp}`);

  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 }), minion({ name: 'Y', currentHp: 40 })] });
  fireSkill(다중, { picked: ['foe:0', 'foe:1'] });
  check(S, '다중 2체 / 기물 둘 → 본체는 안 맞는다',
    state.bossMinions.every(m => m.currentHp === 30) && state.currentBoss.currentHp === 300,
    `${state.bossMinions.map(m => m.currentHp)} 보스=${state.currentBoss.currentHp}`);

  resetBoard({ bossMinions: [] });
  fireSkill({ damage: 10, targetScope: 'multi', targetCount: 3, damageTarget: 'field' }, { picked: [] });
  check(S, '기물 전용(field)은 남은 타수를 본체로 보내지 않는다',
    state.currentBoss.currentHp === 300, `${state.currentBoss.currentHp}`);

  resetBoard({ bossMinions: [] });
  fireSkill({ damage: 10 }, { picked: ['face'] });
  check(S, '단일 대상은 그대로 1회', state.currentBoss.currentHp === 290, `${state.currentBoss.currentHp}`);

  // 💥 피해 대상 분리 — 본체용 / 기물용 (DECISIONS #87)
  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 })] });
  fireSkill({ damage: 12, damageTarget: 'body' }, { picked: ['foe:0'] });
  check(S, 'damageTarget=body: 기물을 골라도 본체로 간다',
    state.currentBoss.currentHp === 288 && state.bossMinions[0].currentHp === 40,
    `보스=${state.currentBoss.currentHp} 기물=${state.bossMinions[0].currentHp}`);

  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 })] });
  fireSkill({ damage: 12, damageTarget: 'field' }, { picked: ['face'] });
  check(S, 'damageTarget=field: 본체를 골라도 본체는 안 맞는다',
    state.currentBoss.currentHp === 300, `보스=${state.currentBoss.currentHp}`);

  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 })] });
  fireSkill({ damage: 12, damageTarget: 'field' }, { picked: ['foe:0'] });
  check(S, 'damageTarget=field: 기물은 정상으로 맞는다',
    state.bossMinions[0].currentHp === 28 && state.currentBoss.currentHp === 300,
    `기물=${state.bossMinions[0].currentHp}`);

  resetBoard({ bossMinions: [minion({ name: 'X', currentHp: 40 })] });
  fireSkill({ damage: 12 }, { picked: ['foe:0'] });
  check(S, 'damageTarget 미지정(any)은 예전 그대로',
    state.bossMinions[0].currentHp === 28, `${state.bossMinions[0].currentHp}`);

  // 고를 수 있는 곳도 좁혀진다
  resetBoard({ bossMinions: [minion({ name: 'X' }), minion({ name: 'Y' })] });
  const bodyKeys = collectTargetKeys(state, readTargetSpec({ damage: 9, damageTarget: 'body' }));
  const fieldKeys = collectTargetKeys(state, readTargetSpec({ damage: 9, damageTarget: 'field' }));
  check(S, 'body는 본체만 고를 수 있다', JSON.stringify(bodyKeys) === JSON.stringify(['face']), bodyKeys.join(','));
  check(S, 'field는 기물만 고를 수 있다',
    JSON.stringify(fieldKeys) === JSON.stringify(['foe:0', 'foe:1']), fieldKeys.join(','));

  // 가격 — 본체용이 기물용보다 비싸다
  {
    const p = (dt) => evaluateCardPower({ rarity: 'rare', cost: 3, cardType: 'spell',
      attack: 0, defense: 0, hp: 0, skill: { damage: 14, damageTarget: dt } }).used;
    const body = p('body'), any = p('any'), field = p('field');
    check(S, `피해 대상 가격: 본체 ${body.toFixed(2)} > 아무나 ${any.toFixed(2)} > 전장 ${field.toFixed(2)}`,
      body > any && any > field, `${body}/${any}/${field}`);
  }

  // 설명문이 어느 쪽인지 밝히는가
  check(S, '설명문이 본체 전용임을 밝힌다',
    String(describeSkillFromData({ damage: 14, damageTarget: 'body' }, 'spell')).includes('상대 본체'),
    describeSkillFromData({ damage: 14, damageTarget: 'body' }, 'spell'));

  // 💀 파괴 (DECISIONS #85)
  resetBoard({ bossMinions: [minion({ name: 'A', currentHp: 99, maxHp: 99, defense: 20 }), minion({ name: 'B' })] });
  fireSkill({ destroy: 1 }, { picked: ['foe:0'] });
  check(S, 'destroy: 체력·수비력 무관하게 즉시 제거',
    state.bossMinions.length === 1 && state.bossMinions[0].name === 'B',
    state.bossMinions.map(m => m.name).join(','));

  resetBoard({ bossMinions: [minion({ name: 'A' }), minion({ name: 'B' }), minion({ name: 'C' })] });
  fireSkill({ destroy: 3, targetScope: 'all' });
  check(S, 'destroy + 전체 대상 → 전장을 비운다', state.bossMinions.length === 0,
    `${state.bossMinions.length}기 남음`);

  resetBoard({ bossMinions: [minion({ name: 'A' }), minion({ name: 'B' }), minion({ name: 'C' })] });
  fireSkill({ destroy: 1, targetScope: 'all' });
  check(S, 'destroy 개수 상한이 지켜진다 (1체만)', state.bossMinions.length === 2,
    `${state.bossMinions.length}기 남음`);

  resetBoard({ bossMinions: [] });
  fireSkill({ destroy: 1 });
  check(S, 'destroy: 대상이 없으면 아무 일도 없다', state.bossMinions.length === 0);

  // 🔍 덱 서치
  resetBoard({
    playerDeck: [card({ name: '무관카드' }), card({ name: '카드군카드', themeId: 'th-A', themeName: '검증군' })],
    playerHand: []
  });
  {
    const c = card({ name: '서치카드', cardType: 'spell', themeId: 'th-A', themeName: '검증군',
      skills: [{ searchDeck: 1 }] });
    applyPlayerSkillEffects(c.skills[0], { card: c, game: state, helpers: BE.__test.helpers() },
      { sourceLabel: '주문', allowAoe: true });
  }
  check(S, 'searchDeck: 같은 카드군을 우선으로 가져온다',
    state.playerHand.length === 1 && state.playerHand[0].name === '카드군카드' && state.playerDeck.length === 1,
    `손패=${state.playerHand.map(c => c.name)} 덱=${state.playerDeck.length}`);

  resetBoard({ playerDeck: [], playerHand: [] });
  fireSkill({ searchDeck: 2 });
  check(S, 'searchDeck: 덱이 비면 불발', state.playerHand.length === 0);

  resetBoard({ playerDeck: [card(), card()], playerHand: Array.from({ length: 7 }, () => card()) });
  fireSkill({ searchDeck: 2 });
  check(S, 'searchDeck: 손패 상한 7을 넘지 않는다', state.playerHand.length === 7, `${state.playerHand.length}`);

  // 👾 토큰 소환
  resetBoard({ playerMinions: [], turnCount: 4 });
  fireSkill({ summonToken: 2 });
  check(S, 'summonToken: 2체 소환 + 소환 후유증',
    state.playerMinions.length === 2 &&
    state.playerMinions.every(m => m.canAttack === false && m.summonedTurn === 4 && m.attack === 4 && m.maxHp === 10),
    JSON.stringify(state.playerMinions.map(m => `${m.name} ${m.attack}/${m.currentHp} atk=${m.canAttack}`)));

  resetBoard({ playerMinions: [minion(), minion(), minion()], turnCount: 4 });
  fireSkill({ summonToken: 3 });
  check(S, 'summonToken: 전장 4칸을 넘지 않는다', state.playerMinions.length === 4,
    `${state.playerMinions.length}기`);

  // 토큰이 전장 차단에 실제로 기여하는가 (이게 소환의 값이다)
  resetBoard({ playerMinions: [], turnCount: 4 });
  fireSkill({ summonToken: 1 });
  check(S, 'summonToken: 소환된 토큰이 본체 공격을 막는다',
    BE.canAttackFace(state.playerMinions, minion()) === false);

  // 상태이상 — 지정 소환수
  resetBoard({ bossMinions: [minion({ name: 'X' })] });
  fireSkill({ statusEffect: { type: 'burn', duration: 3, value: 6 } }, { picked: ['foe:0'] });
  check(S, 'statusEffect 지정 소환수에 부여',
    state.bossMinions[0].statuses.burn && state.bossMinions[0].statuses.burn.turns === 3,
    JSON.stringify(state.bossMinions[0].statuses));

  // 상태이상 — 소환수 전용이 본체로 가려 하면 최전방으로 전환
  resetBoard({ bossMinions: [minion({ name: 'X' })] });
  fireSkill({ statusEffect: { type: 'stun', duration: 1 } });
  check(S, 'entityOnly는 본체 대신 최전방 소환수로',
    !!(state.bossMinions[0].statuses && state.bossMinions[0].statuses.stun) &&
    !BE.getBattleStatusSnapshot().boss.find(s => s.type === 'stun'),
    JSON.stringify(state.bossMinions[0].statuses));

  // 상태이상 — 전장이 비면 불발
  resetBoard({ bossMinions: [] });
  fireSkill({ statusEffect: { type: 'freeze', duration: 2 } });
  check(S, 'entityOnly는 전장이 비면 불발',
    BE.getBattleStatusSnapshot().boss.length === 0,
    JSON.stringify(BE.getBattleStatusSnapshot().boss));

  // 상태이상 — 본체 허용 계열은 본체로
  resetBoard({ bossMinions: [] });
  fireSkill({ statusEffect: { type: 'vulnerable', duration: 2 } });
  check(S, '취약은 본체에 걸린다',
    BE.getBattleStatusSnapshot().boss.some(s => s.type === 'vulnerable'),
    JSON.stringify(BE.getBattleStatusSnapshot().boss));

  // bodyStatus 옵트인
  resetBoard({ bossMinions: [minion({ name: 'X' })] });
  BE.__test.helpers().setFoeStatus('burn', 3, 6, true);
  check(S, 'bodyStatus=true면 본체에 걸 수 있다',
    BE.getBattleStatusSnapshot().boss.some(s => s.type === 'burn'),
    JSON.stringify(BE.getBattleStatusSnapshot().boss));
}

// ============================================================
// 4. 상태이상
// ============================================================
function suiteStatus() {
  const S = '상태이상';

  // entityOnly 분류
  check(S, 'entityOnly: 기절·빙결·부식·화상·맹독',
    ['stun', 'freeze', 'corrosion', 'burn', 'poison'].every(isEntityOnly));
  check(S, '본체 허용: 감전·취약',
    !isEntityOnly('shock') && !isEntityOnly('vulnerable'));

  // 중첩은 더 강한 쪽
  const st = createStatusState();
  applyStatus(st, 'burn', 2, 6);
  applyStatus(st, 'burn', 4, 3);
  check(S, '중첩은 턴·수치 각각 최대값', st.burn.turns === 4 && st.burn.value === 6,
    JSON.stringify(st.burn));

  // 감쇠
  const st2 = createStatusState();
  applyStatus(st2, 'vulnerable', 2, 0);
  decayStatuses(st2);
  check(S, '감쇠 1턴', st2.vulnerable.turns === 1);
  const expired = decayStatuses(st2);
  check(S, '만료되면 제거되고 보고된다',
    !st2.vulnerable && expired.length === 1 && expired[0].type === 'vulnerable');

  // 봉쇄 소모
  const st3 = createStatusState();
  applyStatus(st3, 'stun', 2, 0);
  const b1 = consumeBlockingStatus(st3);
  check(S, '봉쇄 소모 1회', b1 && b1.type === 'stun' && st3.stun.turns === 1);
  consumeBlockingStatus(st3);
  check(S, '봉쇄 소진되면 제거', !st3.stun);

  // 지속 피해 산출
  const st4 = createStatusState();
  applyStatus(st4, 'burn', 3, 0);
  applyStatus(st4, 'poison', 3, 0);
  const ticks = collectDamageOverTime(st4);
  check(S, '화상 기본 6 / 맹독 기본 8',
    ticks.find(t => t.type === 'burn').damage === 6 &&
    ticks.find(t => t.type === 'poison').damage === 8,
    JSON.stringify(ticks.map(t => [t.type, t.damage])));

  // 증폭기
  const st5 = createStatusState();
  applyStatus(st5, 'vulnerable', 2, 0);
  check(S, '취약 배율 1.5', getIncomingDamageMultiplier(st5) === 1.5);
  const st6 = createStatusState();
  applyStatus(st6, 'shock', 2, 0);
  check(S, '감전 추가 피해 4', getOnHitBonusDamage(st6) === 4);

  // 소환수 피해 계산: 수비 → 취약 → 감전 순서
  const m = minion({ defense: 5, currentHp: 100, statuses: {} });
  applyStatus(m.statuses, 'vulnerable', 2, 0);
  applyStatus(m.statuses, 'shock', 2, 0);
  const hit = damageEntity(m, 25);
  // 25-5=20 → ×1.5=30 (증폭 +10) → 감전 +4 → 34
  check(S, '소환수: 수비5 취약1.5 감전4 → 34',
    hit.dealt === 34 && hit.blocked === 5 && hit.amplified === 10 && hit.shockBonus === 4,
    JSON.stringify(hit));

  // pierce는 수비를 무시
  const m2 = minion({ defense: 5, currentHp: 100 });
  check(S, 'pierce는 수비 무시', damageEntity(m2, 25, { pierce: true }).dealt === 25);

  // 소환수 지속 피해 틱 + 사망 제거
  resetBoard({ playerMinions: [minion({ name: '독중', currentHp: 5, statuses: {} })] });
  applyStatus(state.playerMinions[0].statuses, 'poison', 2, 8);
  BE.tickMinionStatuses(state.playerMinions, '내');
  check(S, '지속 피해로 죽으면 전장에서 제거', state.playerMinions.length === 0);

  // 봉쇄된 턴에는 감쇠하지 않는다 (이중 차감 방지)
  resetBoard({ playerMinions: [minion({ name: '기절중', statuses: {} })] });
  applyStatus(state.playerMinions[0].statuses, 'stun', 2, 0);
  BE.tickMinionStatuses(state.playerMinions, '내');
  check(S, '봉쇄 소모는 1턴만 (이중 차감 없음)',
    state.playerMinions[0].statuses.stun.turns === 1 &&
    state.playerMinions[0].blockedBy === 'stun',
    JSON.stringify(state.playerMinions[0].statuses));

  // 취약이 본체 피해를 증폭하는가
  resetBoard({ playerMinions: [] });
  BE.__test.helpers().setSelfStatus('vulnerable', 2, 0);
  BE.foeMinionAttack(0, minion({ attack: 20 }), 'face');
  check(S, '본체 취약 → 20이 30으로', state.playerHp === 20, `${state.playerHp}`);

  // 감전이 본체 피해에 추가되는가
  resetBoard({ playerMinions: [] });
  BE.__test.helpers().setSelfStatus('shock', 2, 4);
  BE.foeMinionAttack(0, minion({ attack: 20 }), 'face');
  check(S, '본체 감전 → 20+4=24', state.playerHp === 26, `${state.playerHp}`);
}

// ============================================================
// 5. 함정
// ============================================================
function suiteTraps() {
  const S = '함정';
  const mkSide = (over = {}) => Object.assign({ hp: 50, maxHp: 50, shield: 0 }, over);

  const cases = [
    ['foePlaysUnit', { event: 'playCard', card: { cardType: 'unit' } }, { event: 'playCard', card: { cardType: 'spell' } }],
    ['foePlaysSpell', { event: 'playCard', card: { cardType: 'spell' } }, { event: 'playCard', card: { cardType: 'unit' } }],
    ['foePlaysStructure', { event: 'playCard', card: { cardType: 'structure' } }, { event: 'playCard', card: { cardType: 'unit' } }],
    ['foeTrapActivates', { event: 'trapFired', card: {} }, { event: 'playCard', card: { cardType: 'unit' } }],
    ['foeAttacks', { event: 'attack', card: {} }, { event: 'playCard', card: { cardType: 'unit' } }],
    ['selfLowHp', { event: 'damaged', card: {}, side: mkSide({ hp: 20 }) }, { event: 'damaged', card: {}, side: mkSide({ hp: 40 }) }],
    ['foeShielded', { event: 'shielded', card: {}, foe: mkSide({ shield: 10 }) }, { event: 'shielded', card: {}, foe: mkSide({ shield: 0 }) }]
  ];

  for (const [trigger, passCtx, blockCtx] of cases) {
    const zoneA = [{ name: 'T', trapTrigger: trigger, skills: [{ damage: 5 }] }];
    let firedA = 0;
    checkTraps(zoneA, Object.assign({ side: mkSide(), foe: mkSide(), game: state }, passCtx), () => firedA++);
    const zoneB = [{ name: 'T', trapTrigger: trigger, skills: [{ damage: 5 }] }];
    let firedB = 0;
    checkTraps(zoneB, Object.assign({ side: mkSide(), foe: mkSide(), game: state }, blockCtx), () => firedB++);
    check(S, `${trigger}: 조건 충족 발동 / 불충족 차단`,
      firedA === 1 && firedB === 0, `pass=${firedA} block=${firedB}`);
    check(S, `${trigger}: 발동한 함정은 소모된다`, zoneA.length === 0 && zoneB.length === 1);
  }

  // 조건부 트리거 (needs)
  const condCases = [
    ['foePlaysElement', { element: 'fire' }, { cardType: 'unit', element: 'fire' }, { cardType: 'unit', element: 'water' }],
    ['foePlaysArchetype', { archetype: '홍련' }, { cardType: 'unit', themeName: '홍련' }, { cardType: 'unit', themeName: '심연' }],
    ['foePlaysKeyword', { keyword: 'pierceShield' }, { cardType: 'unit', skills: [{ pierceShield: true }] }, { cardType: 'unit', skills: [{}] }]
  ];
  for (const [trigger, condition, passCard, blockCard] of condCases) {
    const zA = [{ name: 'T', trapTrigger: trigger, condition, skills: [{ damage: 5 }] }];
    let fA = 0;
    checkTraps(zA, { event: 'playCard', card: passCard, side: mkSide(), foe: mkSide(), game: state }, () => fA++);
    const zB = [{ name: 'T', trapTrigger: trigger, condition, skills: [{ damage: 5 }] }];
    let fB = 0;
    checkTraps(zB, { event: 'playCard', card: blockCard, side: mkSide(), foe: mkSide(), game: state }, () => fB++);
    check(S, `${trigger}: 조건값 일치/불일치`, fA === 1 && fB === 0, `pass=${fA} block=${fB}`);
  }
  // 조건값이 없으면 발동하지 않아야 한다 (死카드 방지)
  for (const trigger of ['foePlaysElement', 'foePlaysArchetype', 'foePlaysKeyword']) {
    const z = [{ name: 'T', trapTrigger: trigger, skills: [{ damage: 5 }] }];
    let f = 0;
    checkTraps(z, { event: 'playCard', card: { cardType: 'unit', element: 'fire' }, side: mkSide(), foe: mkSide(), game: state }, () => f++);
    check(S, `${trigger}: 조건값이 없으면 불발`, f === 0, `fired=${f}`);
  }

  check(S, '알 수 없는 트리거는 foePlaysUnit으로', normalizeTrapTrigger('zzz') === 'foePlaysUnit');

  // 한 이벤트에 여러 함정이 순서대로 발동
  const multi = [
    { name: 'A', trapTrigger: 'foeAttacks', skills: [{ damage: 1 }] },
    { name: 'B', trapTrigger: 'foeAttacks', skills: [{ damage: 1 }] }
  ];
  const order = [];
  checkTraps(multi, { event: 'attack', card: {}, side: mkSide(), foe: mkSide(), game: state }, t => order.push(t.name));
  check(S, '여러 함정이 세트 순서대로 발동',
    order.join(',') === 'A,B' && multi.length === 0, order.join(','));
}

// ============================================================
// 6. 연계 (대칭성)
// ============================================================
function themeOf(over = {}) {
  return Object.assign({
    id: 'th-test', name: '검증군', keyword: '검증', element: 'fire', elements: ['fire'],
    comboAction: 'chainDamage', comboTrigger: 'always', comboScaling: 'flat', comboScope: 'archetype'
  }, over);
}

async function suiteCombos() {
  const S = '연계';

  // ── 14개 액션 × 2 진영이 모두 상태를 바꾸는가
  const actions = Object.keys(ARCHETYPE_COMBO_ACTIONS);
  for (const action of actions) {
    for (const side of ['player', 'boss']) {
      // 전제를 모두 갖춘 판 (② 함정 회피)
      const themed = (n) => minion({ name: n, themeId: 'th-test', themeName: '검증군' });
      resetBoard({
        boss: { maxHp: 300, currentHp: 200, shield: 40 },
        playerMaxShield: 40, playerMana: 2, playerHp: 20, turnCount: 4,
        playerMinions: [themed('아A'), themed('아B')],
        bossMinions: [themed('적A'), themed('적B')],
        playerHand: [card(), card(), card(), card(), card()],
        playerDeck: [card({ themeId: 'th-test', themeName: '검증군' }), card()],
        bossHand: [card(), card()],
        bossDeck: [card({ themeId: 'th-test', themeName: '검증군' }), card()]
      });
      state.playerMaxMana = 5;
      state.bossMana = 2; state.bossMaxMana = 5;   // 상대도 manaCharge가 바꿀 여지가 있어야 한다
      const src = card({ name: '발동카드', themeId: 'th-test', themeName: '검증군', instanceId: 'src#1' });
      const before = snapshot();
      const beforeBuffs = JSON.stringify(BE.__test.buffs());
      // 상대 진영은 거울 뷰 + 진영 상대적 헬퍼로 **같은 구현**을 돈다 (DECISIONS #94)
      const out = runArchetypeCombo(themeOf({ comboAction: action }), src,
        side === 'boss' ? BE.__test.foeGame() : state, BE.__test.helpers(side));
      const changed = snapshot() !== before || JSON.stringify(BE.__test.buffs()) !== beforeBuffs;
      check(S, `${action} / ${side} — 실제로 상태를 바꾼다`, !!out && changed,
        out ? (changed ? '' : '반환은 했으나 상태 변화 없음') : '발동하지 않음(null)');
    }
  }

  // ── 발동조건 7종 × 2 진영: 통과/차단 양방향
  const trigCases = {
    always: [{}, null],
    archetypePair: [{ withAlly: true }, { withAlly: false }],
    lowHp: [{ lowHp: true }, { lowHp: false }],
    bossShielded: [{ foeShield: true }, { foeShield: false }],
    handRich: [{ handRich: true }, { handRich: false }],
    lateGame: [{ turnCount: 6 }, { turnCount: 2 }],
    earlyGame: [{ turnCount: 2 }, { turnCount: 6 }]
  };

  for (const [trigger, [passCfg, blockCfg]] of Object.entries(trigCases)) {
    for (const side of ['player', 'boss']) {
      const run = (cfg) => {
        if (!cfg) return null;
        const themed = (n) => minion({ name: n, themeId: 'th-test', themeName: '검증군' });
        const mine = cfg.withAlly === false ? [] : [themed('아A')];
        resetBoard({
          turnCount: cfg.turnCount != null ? cfg.turnCount : 4,
          boss: {
            maxHp: 300,
            currentHp: (side === 'boss' && cfg.lowHp) ? 100 : 300,
            shield: (side === 'player' && cfg.foeShield) ? 20 : 0
          },
          playerHp: (side === 'player' && cfg.lowHp) ? 20 : 50,
          playerMaxShield: (side === 'boss' && cfg.foeShield) ? 20 : 0,
          playerMinions: side === 'player' ? mine : [],
          bossMinions: side === 'boss' ? mine : [],
          // handRich: 상한 7의 70% = 5 — 양 진영 같다 (🐛 예전엔 보스 상한 5의 70%=4)
          playerHand: Array.from({ length: cfg.handRich ? 5 : 1 }, () => card()),
          bossHand: Array.from({ length: cfg.handRich ? 5 : 1 }, () => card()),
          playerDeck: [card()], bossDeck: [card()]
        });
        const src = card({ name: '발동카드', themeId: 'th-test', themeName: '검증군', instanceId: 'src#1' });
        // 항상 상태를 바꾸는 액션으로 고정 (조건 판정만 보기 위해)
        return runArchetypeCombo(themeOf({ comboAction: 'chainDamage', comboTrigger: trigger }),
          src, side === 'boss' ? BE.__test.foeGame() : state, BE.__test.helpers(side));
      };
      const passed = !!run(passCfg);
      const blocked = blockCfg === null ? true : !run(blockCfg);
      check(S, `${trigger} / ${side} — 통과·차단`, passed && blocked,
        `pass=${passed} block=${blocked}`);
    }
  }

  // ── 증가방식 4종 × 2 진영: 최소 상황 vs 최대 상황
  for (const scaling of Object.keys(COMBO_SCALINGS)) {
    for (const side of ['player', 'boss']) {
      const measure = (rich) => {
        const themed = (n) => minion({ name: n, themeId: 'th-test', themeName: '검증군' });
        const allies = rich ? [themed('a'), themed('b'), themed('c')] : [];
        resetBoard({
          turnCount: rich ? 9 : 1,
          boss: { maxHp: 999, currentHp: 999, shield: 0 },
          playerHp: 999, playerMaxHp: 999,
          playerMinions: side === 'player' ? allies : [],
          bossMinions: side === 'boss' ? allies : [],
          playerHand: Array.from({ length: rich ? 5 : 0 }, () => card()),
          bossHand: Array.from({ length: rich ? 5 : 0 }, () => card())
        });
        const src = card({ name: '발동카드', themeId: 'th-test', themeName: '검증군', instanceId: 'src#1' });
        const beforeHp = side === 'boss' ? state.playerHp : state.currentBoss.currentHp;
        runArchetypeCombo(themeOf({ comboAction: 'chainDamage', comboScaling: scaling }),
          src, side === 'boss' ? BE.__test.foeGame() : state, BE.__test.helpers(side));
        const afterHp = side === 'boss' ? state.playerHp : state.currentBoss.currentHp;
        return beforeHp - afterHp;
      };
      const lo = measure(false), hi = measure(true);
      const ok = Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 &&
                 (scaling === 'flat' ? lo === hi : hi > lo);
      check(S, `${scaling} / ${side} — 위력 ${lo} → ${hi}`, ok, `lo=${lo} hi=${hi}`);
    }
  }

  // ── 범위 4종: 위력 배수
  for (const scope of Object.keys(COMBO_SCOPES)) {
    resetBoard({ boss: { maxHp: 999, currentHp: 999, shield: 0 }, turnCount: 1 });
    const src = card({ name: '발동카드', themeId: 'th-test', themeName: '검증군', instanceId: 'src#1' });
    runArchetypeCombo(themeOf({ comboAction: 'chainDamage', comboScope: scope, comboScopeValue: 'unit' }),
      src, state, BE.__test.helpers());
    const dmg = 999 - state.currentBoss.currentHp;
    const want = Math.max(1, Math.round(6 * SCOPE_POWER_MULT[scope]));
    check(S, `범위 ${scope} — 위력 ${dmg} (기대 ${want})`, dmg === want, `${dmg} vs ${want}`);
  }

  // ── 범위 판정
  const t = themeOf({ comboScope: 'archetype' });
  check(S, 'archetype: themeId 일치', belongsToTheme({ themeId: 'th-test' }, t) === true);
  check(S, 'archetype: 이름에 키워드', belongsToTheme({ name: '검증의칼' }, t) === true);
  check(S, 'archetype: 무관 카드 제외', belongsToTheme({ name: '무관', element: 'fire' }, t) === false);
  const te = themeOf({ comboScope: 'element' });
  check(S, 'element: 같은 속성', belongsToTheme({ element: 'fire' }, te) === true);
  check(S, 'element: 다른 속성 제외', belongsToTheme({ element: 'water' }, te) === false);
  const tc = themeOf({ comboScope: 'cardType', comboScopeValue: 'spell' });
  check(S, 'cardType: 지정 타입만', belongsToTheme({ cardType: 'spell' }, tc) === true &&
    belongsToTheme({ cardType: 'unit' }, tc) === false);
  check(S, 'any: 전부 포함', belongsToTheme({ name: 'zzz' }, themeOf({ comboScope: 'any' })) === true);

  // ── 진영 시점 (selfView / foeView)
  resetBoard({ playerHp: 30, playerMaxHp: 50, playerMaxShield: 7,
               boss: { maxHp: 300, currentHp: 120, shield: 9 },
               playerHand: [card(), card()], bossHand: [card()] });
  // 진영은 게임 뷰가 정한다: 상대 연계는 거울 뷰를 받는다 (ctx.side는 사라졌다 — DECISIONS #94)
  const pv = selfView({ game: state });
  const bv = selfView({ game: BE.__test.foeGame() });
  check(S, 'selfView(player) = 플레이어 상태',
    pv.hp === 30 && pv.maxHp === 50 && pv.shield === 7 && pv.hand.length === 2 && pv.handCap === 7,
    JSON.stringify({ hp: pv.hp, sh: pv.shield, hand: pv.hand.length }));
  // 손패 상한은 양 진영 7 (재기준선: 예전 보스 5 — DECISIONS #94)
  check(S, 'selfView(boss) = 보스 상태',
    bv.hp === 120 && bv.maxHp === 300 && bv.shield === 9 && bv.hand.length === 1 && bv.handCap === 7,
    JSON.stringify({ hp: bv.hp, sh: bv.shield, hand: bv.hand.length }));
  check(S, 'foeView는 정확히 반대',
    foeView({ game: BE.__test.foeGame() }).hp === pv.hp && foeView({ game: state }).hp === bv.hp);
  check(S, 'turnCount가 없어도 NaN이 안 샌다',
    Number.isFinite(COMBO_SCALINGS.perTurn.value(6, { game: {} })) &&
    COMBO_TRIGGERS.lateGame.test({ game: {} }) === false);

  // ── 한 벌 구현 (DECISIONS #94) — 수정 전엔 player/boss 두 벌이었고 서로 달랐다
  check(S, '연계 액션마다 구현은 run 하나뿐',
    Object.values(ARCHETYPE_COMBO_ACTIONS).every(a => typeof a.run === 'function' && !a.player && !a.boss));

  // 보스 카드의 manaCharge는 이제 **마나**를 준다 (예전 보스 구현: 방어막 +10)
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  state.bossMana = 2; state.bossMaxMana = 5;
  state.archetypesList = [themeOf({ comboAction: 'manaCharge' })];
  await BE.playBossCard(card({ name: '상대공명', cardType: 'spell', cost: 0, themeId: 'th-test', themeName: '검증군', skills: [{}] }));
  check(S, '상대 manaCharge는 마나 +1 (예전: 방어막)',
    state.bossMana === 3 && state.currentBoss.shield === 0, `mana=${state.bossMana} shield=${state.currentBoss.shield}`);

  // 보스 카드의 draw는 플레이어처럼 덱 **끝**에서 뽑는다 (예전: shift로 앞에서)
  resetBoard({ bossHand: [], bossDeck: [card({ name: '앞' }), card({ name: '중간' }), card({ name: '끝' })] });
  state.archetypesList = [themeOf({ comboAction: 'draw' })];
  await BE.playBossCard(card({ name: '상대회수', cardType: 'spell', cost: 0, themeId: 'th-test', themeName: '검증군', skills: [{}] }));
  check(S, '상대 draw 연계는 덱 끝에서 뽑는다 (예전: 앞)',
    state.bossHand.length === 1 && state.bossHand[0].name === '끝', state.bossHand.map(c => c.name).join(','));

  // 특수 소환 토큰에 소환 후유증·statuses·instanceId가 있다 (예전 플레이어 토큰엔 없었다)
  resetBoard({ turnCount: 4 });
  state.archetypesList = [themeOf({ comboAction: 'specialSummon' })];
  triggerArchetypeCombo(card({ name: '정령술', themeId: 'th-test', themeName: '검증군' }), state, BE.__test.helpers());
  const tok = state.playerMinions[0];
  check(S, '특수 소환 토큰: summonedTurn·statuses·instanceId 보유',
    !!tok && tok.summonedTurn === 4 && tok.canAttack === false && typeof tok.statuses === 'object' && !!tok.instanceId,
    tok ? JSON.stringify({ st: tok.summonedTurn, s: !!tok.statuses, id: !!tok.instanceId }) : '토큰 없음');
  state.archetypesList = [];
}

// ============================================================
// 7. 건축물 패시브 / 오라
// ============================================================
function suiteStructures() {
  const S = '건축물';

  // 턴 종료 방어막
  resetBoard({
    playerMinions: [minion({ name: '방벽', cardType: 'structure', currentHp: 20,
      skills: [{ passiveEffect: { endTurnShield: 7 } }] })]
  });
  BE.triggerStructureEndTurnPassives();
  check(S, 'endTurnShield +7', state.playerMaxShield === 7, `${state.playerMaxShield}`);
  BE.triggerStructureEndTurnPassives();
  check(S, '매 턴 누적된다 (7→14)', state.playerMaxShield === 14, `${state.playerMaxShield}`);

  // 턴 종료 회복
  resetBoard({ playerHp: 30,
    playerMinions: [minion({ name: '신전', cardType: 'structure', currentHp: 20,
      skills: [{ passiveEffect: { endTurnAoeHeal: 5 } }] })] });
  BE.triggerStructureEndTurnPassives();
  check(S, 'endTurnAoeHeal +5', state.playerHp === 35, `${state.playerHp}`);

  // 성벽 가호 (방어막 + 자가 수리)
  resetBoard({ playerMinions: [minion({ name: '성벽', cardType: 'structure',
    currentHp: 10, maxHp: 20, skills: [{ passiveEffect: { endTurnAoeShield: 6 } }] })] });
  BE.triggerStructureEndTurnPassives();
  check(S, 'endTurnAoeShield: 방어막 + 내구도 수리',
    state.playerMaxShield === 6 && state.playerMinions[0].currentHp === 15,
    `sh=${state.playerMaxShield} hp=${state.playerMinions[0].currentHp}`);

  // 턴 시작 마나
  resetBoard({ playerMana: 2,
    playerMinions: [minion({ name: '수정탑', cardType: 'structure', currentHp: 20,
      skills: [{ passiveEffect: { manaPerTurn: 2 } }] })] });
  BE.triggerStructureStartTurnPassives();
  check(S, 'manaPerTurn +2', state.playerMana === 4, `${state.playerMana}`);

  // 오라 범위
  const aura = (scope, extra = {}) => minion({
    name: '오라탑', cardType: 'structure', currentHp: 20, element: 'fire', themeId: 'th-A',
    skills: [{ passiveEffect: { aura: Object.assign({ scope, attackBonus: 3 }, extra) } }]
  });
  resetBoard({ playerMinions: [aura('archetype'),
    minion({ name: '같은군', themeId: 'th-A' }), minion({ name: '다른군', themeId: 'th-B' })] });
  check(S, '오라 archetype: 같은 카드군만',
    BE.auraAttackBonus(state.playerMinions[1]) === 3 && BE.auraAttackBonus(state.playerMinions[2]) === 0);

  resetBoard({ playerMinions: [aura('element'),
    minion({ name: '화염', element: 'fire' }), minion({ name: '물', element: 'water' })] });
  check(S, '오라 element: 같은 속성만',
    BE.auraAttackBonus(state.playerMinions[1]) === 3 && BE.auraAttackBonus(state.playerMinions[2]) === 0);

  resetBoard({ playerMinions: [aura('cardType', { scopeValue: 'unit' }),
    minion({ name: '소환수', cardType: 'unit' }),
    minion({ name: '성물', cardType: 'structure', currentHp: 10, skills: [{}] })] });
  check(S, '오라 cardType: 지정 타입만',
    BE.auraAttackBonus(state.playerMinions[1]) === 3 && BE.auraAttackBonus(state.playerMinions[2]) === 0);

  resetBoard({ playerMinions: [aura('all'), minion({ name: '아무나', themeId: 'zz', element: 'water' })] });
  check(S, '오라 all: 전부', BE.auraAttackBonus(state.playerMinions[1]) === 3);

  // 🖥️ 오라가 **화면에도** 보이는가 (DECISIONS #88)
  //    🐛 공격력 오라만 표시에 반영되고 방어력 오라는 빠져 있었다.
  //       동작은 하는데 카드에는 안 보여서 적용됐는지 알 수 없었다.
  resetBoard({ playerMinions: [
    minion({ name: '오라탑', cardType: 'structure', currentHp: 20, themeId: 'th-A',
      skills: [{ passiveEffect: { aura: { scope: 'all', attackBonus: 3, defenseBonus: 2 } } }] }),
    minion({ name: '수혜자', attack: 10, defense: 4 })] });
  BE.renderBattleUI();
  {
    const 카드 = [...document.querySelectorAll('#player-minions-field > div')]
      .find(d => d.innerText.includes('수혜자')) || { innerText: '' };
    const txt = 카드.innerText.replace(/\s+/g, ' ');
    check(S, '오라 공격력이 화면에 반영 (10+3=13)', txt.includes('13'), txt);
    check(S, '오라 방어력이 화면에 반영 (4+2=6)', txt.includes('6'), txt);
  }

  // 오라 방어력이 방어 시 적용되는가
  resetBoard({ playerMinions: [
    minion({ name: '방어탑', cardType: 'structure', currentHp: 20,
      skills: [{ passiveEffect: { aura: { scope: 'all', defenseBonus: 4 } } }] }),
    minion({ name: '수혜자', defense: 0, currentHp: 30 })] });
  BE.foeMinionAttack(0, minion({ attack: 10 }), 'foe:1');
  check(S, '오라 방어력이 피격에 반영 (10-4=6)',
    state.playerMinions[1].currentHp === 24, `${state.playerMinions[1].currentHp}`);

  // 오라 피해 경감 (상한 75)
  resetBoard({ playerMinions: [
    minion({ name: 'A', cardType: 'structure', currentHp: 20, skills: [{ passiveEffect: { aura: { scope: 'all', damageReduction: 50 } } }] }),
    minion({ name: 'B', cardType: 'structure', currentHp: 20, skills: [{ passiveEffect: { aura: { scope: 'all', damageReduction: 50 } } }] })] });
  check(S, '오라 경감 합산 상한 75%', BE.auraDamageReduction() === 75, `${BE.auraDamageReduction()}`);
}

// ============================================================
// 8. 카드 시전 규칙
// ============================================================
function suitePlayRules() {
  const S = '시전 규칙';
  const sides = createSides({
    playerStatus: createStatusState(), bossStatus: createStatusState(),
    playerBuffs: createBuffs(), bossBuffs: createBuffs()
  });
  resetBoard({ playerMana: 3, playerMinions: [] });
  check(S, '마나가 모자라면 낼 수 없다', canPlayCard(sides.player, card({ cost: 5 })).ok === false);
  check(S, '마나가 충분하면 낼 수 있다', canPlayCard(sides.player, card({ cost: 3 })).ok === true);

  state.playerMinions = [minion(), minion(), minion(), minion()];
  check(S, '전장이 가득 차면 소환 불가',
    canPlayCard(sides.player, card({ cost: 1, cardType: 'unit' })).ok === false);
  check(S, '전장이 가득 차도 주문은 가능',
    canPlayCard(sides.player, card({ cost: 1, cardType: 'spell' })).ok === true);
  check(S, '전장이 가득 차도 함정은 가능',
    canPlayCard(sides.player, card({ cost: 1, cardType: 'trap' })).ok === true);
  check(S, '건축물도 전장 슬롯을 먹는다',
    canPlayCard(sides.player, card({ cost: 1, cardType: 'structure' })).ok === false);
}

// ============================================================
// 9. 카드 시전 통합 (playCard 경로 전체)
// ============================================================
function suitePlayCard() {
  const S = '시전 통합';

  // 소환수: 마나 차감 · 손패 제거 · 전장 배치 · 소환 후유증
  resetBoard({ playerMana: 5, turnCount: 3 });
  state.playerHand = [card({ name: '방벽병', cost: 2, hp: 25, defense: 3, skills: [{}] })];
  BE.playCard(0);
  const e0 = state.playerMinions[0];
  check(S, '소환수 시전: 마나·손패·전장',
    state.playerMana === 3 && state.playerHand.length === 0 && state.playerMinions.length === 1,
    `mana=${state.playerMana} hand=${state.playerHand.length} field=${state.playerMinions.length}`);
  check(S, '소환수 시전: 도발 필드가 남지 않는다', !e0.taunt);
  check(S, '소환수 시전: 소환 후유증 + summonedTurn',
    e0.canAttack === false && e0.summonedTurn === 3, `${e0.canAttack}/${e0.summonedTurn}`);
  check(S, '소환수 시전: 체력/수비력이 카드값', e0.currentHp === 25 && e0.defense === 3);

  // 전투의 함성이 발동하는가
  resetBoard({ playerMana: 5 });
  state.playerHand = [card({ name: '함성병', cost: 2, skills: [{ damage: 9, targetScope: 'all' }] })];
  BE.playCard(0);
  check(S, '소환수 시전: 전투의 함성 발동', state.currentBoss.currentHp === 291,
    `${state.currentBoss.currentHp}`);

  // 주문: 전장을 차지하지 않는다
  resetBoard({ playerMana: 5 });
  state.playerHand = [card({ name: '화염구', cost: 3, cardType: 'spell', skills: [{ damage: 20, targetScope: 'all' }] })];
  BE.playCard(0);
  check(S, '주문 시전: 전장 미점유 + 효과 발동',
    state.playerMinions.length === 0 && state.currentBoss.currentHp === 280 && state.playerMana === 2,
    `field=${state.playerMinions.length} boss=${state.currentBoss.currentHp}`);

  // 더블캐스트: 주문이 두 번 발동
  resetBoard({ playerMana: 5 });
  BE.__test.buffs().player.doubleCast = true;
  state.playerHand = [card({ name: '화염구', cost: 3, cardType: 'spell', skills: [{ damage: 20, targetScope: 'all' }] })];
  BE.playCard(0);
  check(S, '더블캐스트: 주문 2연속 (40)',
    state.currentBoss.currentHp === 260 && BE.__test.buffs().player.doubleCast === false,
    `${state.currentBoss.currentHp}`);

  // 더블캐스트: 전투의 함성도 두 번
  resetBoard({ playerMana: 5 });
  BE.__test.buffs().player.doubleCast = true;
  state.playerHand = [card({ name: '함성병', cost: 2, skills: [{ damage: 9, targetScope: 'all' }] })];
  BE.playCard(0);
  check(S, '더블캐스트: 전투의 함성 2연속 (18)',
    state.currentBoss.currentHp === 282 && state.playerMinions.length === 1,
    `${state.currentBoss.currentHp} field=${state.playerMinions.length}`);

  // 건축물: 전장을 차지한다 (도발 없이도 전장 차단으로 벽이 된다)
  resetBoard({ playerMana: 5 });
  state.playerHand = [card({ name: '성벽', cost: 3, cardType: 'structure', hp: 22, skills: [{}] })];
  BE.playCard(0);
  check(S, '건축물 시전: 전장 점유 (도발 없음)',
    state.playerMinions.length === 1 && !state.playerMinions[0].taunt &&
    state.playerMinions[0].currentHp === 22);

  // 함정: 세트만 되고 전장에는 안 나온다
  resetBoard({ playerMana: 5 });
  state.playerHand = [card({ name: '함정A', cost: 2, cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 8 }] })];
  BE.playCard(0);
  check(S, '함정 시전: 함정 구역에만 들어간다',
    BE.getTrapZone('player').length === 1 && state.playerMinions.length === 0 &&
    state.playerMana === 3 && state.playerHand.length === 0,
    `zone=${BE.getTrapZone('player').length} field=${state.playerMinions.length}`);

  // 함정 구역 상한
  resetBoard({ playerMana: 10 });
  state.playerMaxMana = 10;
  state.playerHand = Array.from({ length: 4 }, (_, i) =>
    card({ name: '함정' + i, cost: 1, cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 1 }] }));
  for (let i = 0; i < 4; i++) BE.playCard(0);
  check(S, '함정 구역 상한 3 — 4번째는 거부',
    BE.getTrapZone('player').length === 3 && state.playerHand.length === 1,
    `zone=${BE.getTrapZone('player').length} hand=${state.playerHand.length}`);

  // 마나가 모자라면 아무 일도 없다
  resetBoard({ playerMana: 1 });
  state.playerHand = [card({ name: '비싼카드', cost: 5 })];
  BE.playCard(0);
  check(S, '마나 부족이면 시전되지 않는다',
    state.playerHand.length === 1 && state.playerMinions.length === 0 && state.playerMana === 1);

  // 🎯 소환 위치 지정 (DECISIONS #88)
  //    배치 로직은 원래 정상이었지만 **무장 표시가 폭 2.5px 색 띠뿐**이라
  //    눌러도 아무 일 없는 것처럼 보였다.
  {
    const 유닛 = (n) => card({ id: 'u' + n, name: 'U' + n, cost: 1, attack: 5, hp: 20, skills: [{}] });
    resetBoard({ playerMana: 20, turnCount: 3 });
    state.playerMaxMana = 20;
    state.playerHand = [유닛(0), 유닛(1), 유닛(2)];
    BE.playCard(0); BE.playCard(0);
    BE.renderBattleUI();
    const 첫카드 = [...document.querySelectorAll('#player-minions-field > div')][0];
    const grip = 첫카드 && 첫카드.querySelector('button');
    check(S, '소환 위치: 카드 앞 그립 버튼이 존재한다', !!grip);
    if (grip) {
      grip.click();
      BE.renderBattleUI();
      const 무장카드 = [...document.querySelectorAll('#player-minions-field > div')][0];
      check(S, '소환 위치: 무장하면 눈에 보이는 표시가 생긴다',
        무장카드.innerText.includes('여기') || 무장카드.className.includes('ring-amber-400'),
        `text="${무장카드.innerText.replace(/\s+/g, ' ').slice(0, 40)}" cls=${무장카드.className.includes('ring-amber-400')}`);
      BE.playCard(0);
      check(S, '소환 위치: 지정한 자리(맨 앞)에 배치된다',
        state.playerMinions.map(m => m.name).join(',') === 'U2,U0,U1',
        state.playerMinions.map(m => m.name).join(','));
    }
  }

  // 🎯 소환 위치 — 배지가 뜬 자리 = 실제로 들어가는 자리 (DECISIONS #93)
  //    🐛 빈 칸 넷이 전부 눌렸고 "여기에 배치"까지 켜졌지만, 전장이 빈칸 없는 배열이라
  //       playCard는 length로 눌렀다 (빈 전장에서 4번 칸 → 실제 1번). 위 검사는
  //       "2기 + 그립"만 덮어 이걸 통과시켰다. 여기서는 빈 전장·인덱스 감소·전투 간 누수·
  //       대상 선택 중 그립까지 **화면과 실제가 같은가**를 직접 잰다.
  {
    const 유닛 = (n) => card({ id: 'v' + n, name: 'V' + n, cost: 1, attack: 5, hp: 20, skills: [{}] });
    const 칸들 = () => [...document.querySelectorAll('#player-minions-field > div')];
    const 배지칸 = () => 칸들().findIndex(d => d.innerText.includes('여기'));   // 없으면 -1
    const 이름들 = () => state.playerMinions.map(m => m.name).join(',');

    // ① 빈 전장: 누를 수 있는 빈 칸은 첫 칸(length=0) 하나뿐
    resetBoard({ playerMana: 20, turnCount: 3 });
    state.playerMaxMana = 20;
    state.playerHand = [유닛(0), 유닛(1), 유닛(2)];
    BE.renderBattleUI();
    const 빈 = 칸들();
    check(S, '소환 위치: 빈 전장 — 누를 수 있는 빈 칸은 첫 칸 하나뿐',
      빈.length === 4 && typeof 빈[0].onclick === 'function' && 빈.slice(1).every(d => !d.onclick),
      `clickable=${빈.map(d => typeof d.onclick === 'function' ? 1 : 0).join('')}`);

    // ② 닿지 않는 칸(3번)을 눌러도 배지가 켜지지 않는다 (예전: 배지 3번, 실제 1번)
    빈[2].click(); BE.renderBattleUI();
    check(S, '소환 위치: 닿지 않는 칸은 눌러도 무장되지 않는다', 배지칸() === -1, `배지=${배지칸()}`);

    // ③ 불변식: 배지가 뜬 칸에 실제로 들어간다 (빈 전장)
    칸들()[0].click(); BE.renderBattleUI();
    const 배지A = 배지칸();
    BE.playCard(0);
    check(S, '소환 위치: 배지가 뜬 칸에 실제로 들어간다 (빈 전장)',
      배지A === 0 && state.playerMinions.findIndex(m => m.name === 'V0') === 0,
      `배지=${배지A} field=${이름들()}`);

    // ④ 1기일 때 3번 칸은 눌러도 무장되지 않는다 (예전: 배지 3번, 실제 2번)
    BE.renderBattleUI();
    칸들()[2].click(); BE.renderBattleUI();
    check(S, '소환 위치: 1기일 때 3번 칸은 눌러도 무장되지 않는다', 배지칸() === -1, `배지=${배지칸()}`);
    BE.playCard(0);
    check(S, '소환 위치: 무장 없이 내면 맨 뒤', 이름들() === 'V0,V1', 이름들());

    // ⑤ 무장해 둔 뒤 소환수가 죽어 인덱스가 줄면, 배지도 실제로 들어갈 자리로 옮겨 간다
    //    (2기 + 다음 자리(3번 칸) 무장 → 1기 사망 → length 1 → 배지 2번 칸, 소환도 2번)
    BE.renderBattleUI();
    칸들()[2].click(); BE.renderBattleUI();
    check(S, '소환 위치: 다음 자리를 무장하면 배지는 그 칸', 배지칸() === 2, `배지=${배지칸()}`);
    state.playerMinions.splice(0, 1);                 // V0 사망 — 전장은 빈칸 없이 당겨진다
    BE.renderBattleUI();
    const 배지B = 배지칸();
    BE.playCard(0);                                   // V2
    check(S, '소환 위치: 인덱스가 줄어도 배지 자리 = 실제 자리',
      배지B === 1 && state.playerMinions.findIndex(m => m.name === 'V2') === 1,
      `배지=${배지B} field=${이름들()}`);

    // ⑥ 대상 선택 중에 그립(카드 왼쪽 띠)을 누르면 무장이 아니라 **대상 지정**이다
    //    (그립이 카드 왼쪽 10px를 덮고 stopPropagation을 하므로 카드 onclick이 안 돈다)
    resetBoard({ playerMana: 20, turnCount: 3, playerMinions: [minion({ name: '아군A' }), minion({ name: '아군B' })] });
    state.playerMaxMana = 20;
    BE.renderBattleUI();
    let 골라진 = null;
    const 시작 = beginTargeting({ kind: 'effect', valid: ['ally:0', 'ally:1'], need: 1, hint: '검사',
      onProgress: () => {}, onPick: (first) => { 골라진 = first; }, onCancel: () => {} });
    BE.renderBattleUI();
    const 그립B = 칸들()[1] && 칸들()[1].querySelector('button');
    if (시작 && 그립B) 그립B.click();
    BE.renderBattleUI();
    check(S, '소환 위치: 대상 선택 중 그립 클릭은 대상 지정이 된다',
      시작 && !!그립B && 골라진 === 'ally:1' && 배지칸() === -1,
      `started=${시작} grip=${!!그립B} picked=${골라진} 배지=${배지칸()}`);
    cancelTargeting(false);

    // ⑦ 전투 시작이 무장을 지운다 — 지난 전투의 배지가 새 전투에 남지 않는다
    //    (빈 전장의 첫 소환은 어차피 0번이라 배치로는 안 보이고, **배지**로 드러난다)
    resetBoard({ playerMana: 20, turnCount: 3, playerMinions: [minion({ name: '아군A' })] });
    BE.renderBattleUI();
    const 그립A = 칸들()[0] && 칸들()[0].querySelector('button');
    if (그립A) 그립A.click();
    BE.renderBattleUI();
    const 무장됨 = 배지칸() === 0;
    BE.initBattle({ seed: 1 });
    check(S, '소환 위치: initBattle이 무장을 지운다 (전투 간 누수 없음)',
      무장됨 && 배지칸() === -1, `armedBefore=${무장됨} 배지=${배지칸()}`);

    // ⑧ 무장은 소환에만 소모된다 — 주문을 낸 뒤에도 남고, 다음 소환수가 그 자리에 들어간다
    //    (반려·주문에서 풀어 버리면 "지정했는데 뒤로 갔다"는 놀람을 만든다. 배지는 늘 보인다)
    resetBoard({ playerMana: 20, turnCount: 3,
      playerMinions: [minion({ name: '아군A' }), minion({ name: '아군B' })], playerDeck: [card()] });
    state.playerMaxMana = 20;
    state.playerHand = [card({ name: '주문', cardType: 'spell', cost: 1, skills: [{ drawCards: 1 }] }), 유닛(9)];
    BE.renderBattleUI();
    칸들()[1].querySelector('button').click(); BE.renderBattleUI();   // 아군B 앞에 무장
    BE.playCard(0);                                                     // 주문
    BE.renderBattleUI();
    const 주문뒤배지 = 배지칸();
    BE.playCard(0);                                                     // V9
    check(S, '소환 위치: 주문을 내도 무장은 남고, 배지 자리에 소환된다',
      주문뒤배지 === 1 && 이름들() === '아군A,V9,아군B',
      `배지=${주문뒤배지} field=${이름들()}`);
  }

  // 전장이 가득 차면 소환 거부
  resetBoard({ playerMana: 5, playerMinions: [minion(), minion(), minion(), minion()] });
  state.playerHand = [card({ name: '추가병', cost: 1 })];
  BE.playCard(0);
  check(S, '전장이 가득 차면 소환 거부',
    state.playerMinions.length === 4 && state.playerHand.length === 1);
}

// ============================================================
// 9b. 진영 대칭 — 보스는 "콤보를 가진 봇 플레이어"다 (DECISIONS #94)
// ------------------------------------------------------------
// 규칙은 양 진영 동일해야 한다. Side 접근자·거울 뷰·헬퍼가 정말 대칭인지 잰다.
// 1단계(Side 완성) 검사 — 수정 전 코드에서는 슬롯 3·손패 5·클로저 마나라 전부 실패했다.
// ============================================================
async function suiteSides() {
  const S = '진영 대칭';
  const T = BE.__test;

  // 상한: 양 진영 같은 값 (🐛 보스만 슬롯 3·손패 5였다)
  resetBoard();
  const foe = BE.getSide('boss'), me = BE.getSide('player');
  check(S, '상대 슬롯 상한 = 플레이어 (4)', foe.maxMinions === 4 && me.maxMinions === 4, `${foe.maxMinions}/${me.maxMinions}`);
  check(S, '상대 손패 상한 = 플레이어 (7)', foe.maxHand === 7 && me.maxHand === 7, `${foe.maxHand}/${me.maxHand}`);
  check(S, 'HAND_CAP도 양 진영 7', HAND_CAP.player === 7 && HAND_CAP.boss === 7, JSON.stringify(HAND_CAP));

  // PvE에서 상대 소환수 3기여도 4번째를 낼 수 있다
  resetBoard({ bossMinions: [minion(), minion(), minion()] });
  state.bossMana = 5; state.bossMaxMana = 5;
  check(S, '상대 전장 3기여도 canPlayCard ok (예전 상한 3)',
    canPlayCard(BE.getSide('boss'), card({ cost: 1 })).ok === true);

  // 마나는 한 집: growMana(boss) → state.bossMana
  resetBoard();
  growMana(BE.getSide('boss'), 4);
  check(S, '상대 마나 성장이 state.bossMana에 쓰인다',
    state.bossMana === 4 && BE.getSide('boss').mana === 4, `state=${state.bossMana} side=${BE.getSide('boss').mana}`);

  // 거울의 manaGain이 진영 마나를 올린다 (🐛 예전엔 클로저와 다른 집에 써서 죽었다)
  resetBoard();
  state.bossMana = 1; state.bossMaxMana = 5;
  await BE.playFoeCardPvp(card({ name: '상대마나', cardType: 'spell', cost: 0, skills: [{ manaGain: 2 }] }));
  check(S, '상대 manaGain이 진영 마나를 올린다', BE.getSide('boss').mana === 3, `${BE.getSide('boss').mana}`);

  // 거울 드로우가 n장 뽑는다 (🐛 예전엔 n을 무시하고 1장)
  resetBoard({ bossHand: [], bossDeck: [card(), card(), card()] });
  await BE.playFoeCardPvp(card({ name: '상대드로우', cardType: 'spell', cost: 0, skills: [{ drawCards: 2 }] }));
  check(S, '상대 drawCards:2 → 2장 (예전 1장)',
    state.bossHand.length === 2 && state.bossDeck.length === 1, `hand=${state.bossHand.length} deck=${state.bossDeck.length}`);

  // 거울 뷰가 상대 덱(= 내 덱)을 노출한다 — 덱 서치·파기 연계가 읽는다
  resetBoard({ playerDeck: [card({ name: '내덱' })] });
  const fg = typeof T.foeGame === 'function' ? T.foeGame() : null;
  check(S, '거울 뷰에 bossDeck(= 내 덱)이 있다', !!fg && fg.bossDeck === state.playerDeck);

  // 진영 접근자가 함정 구역을 본다
  resetBoard();
  T.setTrap('boss', card({ name: '상대함정', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 1 }] }));
  check(S, 'side.traps가 함정 구역을 본다',
    (BE.getSide('boss').traps || []).length === 1 && (BE.getSide('player').traps || []).length === 0);

  // 헬퍼는 한 팩토리에서 나오고 진영 상대적이다: 상대 헬퍼의 "적 본체 피해"는 나에게 온다
  resetBoard({ playerHp: 50 });
  const hb = T.helpers('boss');
  if (hb && typeof hb.dealDamageToFoe === 'function') hb.dealDamageToFoe(7, '검사');
  check(S, "helpers('boss').dealDamageToFoe는 내 본체를 친다", state.playerHp === 43, `${state.playerHp}`);
}

// ============================================================
// 9c. 본체 피해 — 양 진영 같은 규칙 (DECISIONS #94)
// ------------------------------------------------------------
// 🐛 본체 피해 함수가 두 벌이었다. 보스 쪽엔 무적·경감이 없고 관통은 플레이어 버프만 봤으며
//    가시는 보스 전용, damaged 함정 이벤트는 플레이어 본체에서만 났다.
// ============================================================
function suiteFaceDamage() {
  const S = '본체 피해';
  const B = () => BE.__test.buffs();

  // 상대 무적이 내 공격을 막는다
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  B().boss.invulnerable = 1;
  BE.dealDamageToFoe(20, '검사');
  check(S, '상대 무적이 내 본체 공격을 막는다 (예전: 무시)', state.currentBoss.currentHp === 300, `${state.currentBoss.currentHp}`);

  // 상대 경감 50%
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  B().boss.damageReduction = 50; B().boss.damageReductionTurns = 1;
  BE.dealDamageToFoe(20, '검사');
  check(S, '상대 경감 50%가 내 본체 공격을 반으로 (20→10)', state.currentBoss.currentHp === 290, `${state.currentBoss.currentHp}`);

  // 상대 건축물의 경감 오라가 상대 본체를 지킨다
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 },
    bossMinions: [minion({ name: '상대요새', cardType: 'structure', skills: [{ passiveEffect: { aura: { scope: 'all', damageReduction: 25 } } }] })] });
  BE.dealDamageToFoe(20, '검사');
  check(S, '상대 건축물 경감 오라 25% (20→15) (예전: 플레이어 오라만)', state.currentBoss.currentHp === 285, `${state.currentBoss.currentHp}`);

  // 상대의 관통 버프가 내 방어막을 무시하고 소모된다
  resetBoard({ playerHp: 50, playerMaxShield: 10, playerMinions: [], bossMinions: [minion({ name: '상대병', attack: 10 })] });
  B().boss.pierceShield = true;
  BE.foeMinionAttack(0, null, 'face');
  check(S, '상대의 관통 버프가 내 방어막을 무시하고 소모된다 (예전: 죽은 버프)',
    state.playerHp === 40 && state.playerMaxShield === 10 && B().boss.pierceShield === false,
    `php=${state.playerHp} sh=${state.playerMaxShield} buff=${B().boss.pierceShield}`);

  // 내 가시가 상대에게 반사된다
  resetBoard({ playerHp: 50, playerMinions: [], bossMinions: [minion({ name: '상대병', attack: 10 })],
    boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  B().player.thorns = 0.3; B().player.thornsTurns = 2;
  BE.foeMinionAttack(0, null, 'face');
  check(S, '내 가시 30%가 상대 본체에 반사된다 (예전: 가시는 보스 전용)',
    state.playerHp === 40 && state.currentBoss.currentHp === 297,
    `php=${state.playerHp} bhp=${state.currentBoss.currentHp}`);

  // 반사는 되반사되지 않는다 (양쪽 다 가시)
  resetBoard({ playerHp: 50, boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  B().player.thorns = 0.5; B().player.thornsTurns = 2;
  B().boss.thorns = 0.5; B().boss.thornsTurns = 2;
  BE.dealDamageToFoe(20, '검사');
  check(S, '가시 반사는 되반사되지 않는다', state.currentBoss.currentHp === 280 && state.playerHp === 40,
    `bhp=${state.currentBoss.currentHp} php=${state.playerHp}`);

  // 보스가 세트한 selfLowHp 함정이 터진다
  resetBoard({ boss: { maxHp: 300, currentHp: 160, shield: 0 } });
  BE.__test.setTrap('boss', card({ name: '상대위기', cardType: 'trap', trapTrigger: 'selfLowHp', skills: [{ shield: 20 }] }));
  BE.dealDamageToFoe(20, '검사');
  check(S, '상대 본체가 절반 아래로 떨어지면 상대 함정(selfLowHp) 발동 (예전: 내 본체만)',
    BE.getTrapZone('boss').length === 0 && state.currentBoss.shield === 20,
    `zone=${BE.getTrapZone('boss').length} sh=${state.currentBoss.shield}`);
}

// ============================================================
// 9d. 공격 대칭 — 소환수 공격 해결이 양 진영 한 함수 (DECISIONS #94)
// ------------------------------------------------------------
// 🐛 상대 쪽은 canAttack을 지우지 않았고(한 턴 여러 번), 공격 오라를 안 받았고, 기본 대상에서
//    directAttack을 무시했으며, PvP 재생 핸들러는 targetKey를 버렸다(상대가 누굴 골랐든 내 최전방).
// ============================================================
async function suiteAttackSymmetry() {
  const S = '공격 대칭';

  // 공격하면 canAttack=false — 한 턴에 두 번 못 친다
  resetBoard({ playerHp: 50, playerMinions: [], bossMinions: [minion({ name: '상대병', attack: 5 })] });
  BE.foeMinionAttack(0);
  const after1 = state.playerHp;
  BE.foeMinionAttack(0);
  check(S, '상대 소환수도 공격하면 canAttack=false, 한 턴 두 번 못 친다 (예전: 무제한)',
    state.bossMinions[0].canAttack === false && after1 === 45 && state.playerHp === 45,
    `canAttack=${state.bossMinions[0].canAttack} php=${state.playerHp}`);

  // directAttack 상대 소환수는 내 전장을 넘어 본체를 친다
  resetBoard({ playerHp: 50, playerMinions: [minion({ name: '내벽', currentHp: 30 })],
    bossMinions: [minion({ name: '상대암살자', attack: 7, directAttack: true })] });
  BE.foeMinionAttack(0);
  check(S, 'directAttack 상대 소환수는 내 전장을 넘어 본체 (예전: 기본 대상에서 무시)',
    state.playerHp === 43 && state.playerMinions[0].currentHp === 30,
    `php=${state.playerHp} wall=${state.playerMinions[0].currentHp}`);

  // 상대 건축물의 공격 오라가 상대 소환수 공격에 붙는다
  resetBoard({ playerHp: 50, playerMinions: [], bossMinions: [
    minion({ name: '상대병', attack: 5 }),
    minion({ name: '상대탑', cardType: 'structure', skills: [{ passiveEffect: { aura: { scope: 'all', attackBonus: 3 } } }] })] });
  BE.foeMinionAttack(0);
  check(S, '상대 건축물 공격 오라 +3이 상대 소환수 공격에 붙는다 (5+3=8)', state.playerHp === 42, `php=${state.playerHp}`);

  // 내가 상대 소환수를 칠 때 상대 건축물의 방어 오라가 붙는다
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10 })], bossMinions: [
    minion({ name: '적', currentHp: 30, defense: 0 }),
    minion({ name: '상대성벽', cardType: 'structure', skills: [{ passiveEffect: { aura: { scope: 'all', defenseBonus: 4 } } }] })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '상대 건축물 방어 오라 +4가 상대 소환수를 지킨다 (10-4=6)', state.bossMinions[0].currentHp === 24,
    `${state.bossMinions[0].currentHp}`);

  // PvP attack 재생이 targetKey를 존중한다 (더미 세션)
  {
    const dummy = { sendAction() {} };
    try {
      attachPvpSession(dummy, { foeName: '검증상대', isHost: true });
      resetBoard({ playerMinions: [minion({ name: '내A', currentHp: 30 }), minion({ name: '내B', currentHp: 30 })],
        bossMinions: [minion({ name: '상대병', attack: 12 })] });
      await handleRemoteAction({ kind: 'attack', slotIdx: 0, targetKey: 'foe:1' });
      check(S, 'PvP attack 재생이 상대가 고른 대상(foe:1)을 친다 (예전: targetKey 유실 → 최전방)',
        state.playerMinions[0].currentHp === 30 && state.playerMinions[1].currentHp === 18,
        `${state.playerMinions.map(m => m.currentHp)}`);
    } finally {
      detachPvpSession();
    }
  }
}

// ============================================================
// 9d-2. 전투 반격 — 소환수 전투는 서로 때린다 (DECISIONS #95)
// ------------------------------------------------------------
// 🐛 예전엔 공격이 공짜였다: 방어자만 피해를 입어 고화력 소환수가 매 턴 때려도 전장에 영원히 남았다
//    (#94 실측: 상대 전장 4기 만석 · 내 전장 0기). 이제 방어자의 공격력(+그 진영 공격 오라)이 공격자에게
//    되돌아오고, 공격자의 수비력·방어 오라는 같은 damageEntity가 처리한다. 본체·건축물은 반격하지 않는다.
// ============================================================
function suiteRetaliation() {
  const S = '전투 반격';

  // ① 기본: 내 공10이 상대 공6·체30을 치면 상대 -10, 나 -6
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10, currentHp: 20, maxHp: 20 })],
    bossMinions: [minion({ name: '적병', attack: 6, currentHp: 30 })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '소환수 전투는 서로 때린다: 방어자 -10, 공격자 -6 (예전: 공격자 무피해)',
    state.bossMinions[0].currentHp === 20 && state.playerMinions[0].currentHp === 14,
    `foe=${state.bossMinions[0].currentHp} me=${state.playerMinions[0].currentHp}`);

  // ② 반격은 공격자의 수비력으로 줄어든다 (같은 damageEntity)
  resetBoard({ playerMinions: [minion({ name: '내갑병', attack: 10, defense: 2, currentHp: 20, maxHp: 20 })],
    bossMinions: [minion({ name: '적병', attack: 6, currentHp: 30 })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '반격은 공격자 수비력으로 줄어든다: 6-2=4', state.playerMinions[0].currentHp === 16, `${state.playerMinions[0].currentHp}`);

  // ③ 본체 공격은 반격 없음 (본체는 공격력이 없다)
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10, currentHp: 20, maxHp: 20 })], bossMinions: [] });
  BE.resolveMinionAttack(0, 'face');
  check(S, '본체 공격에는 반격이 없다', state.currentBoss.currentHp === 290 && state.playerMinions[0].currentHp === 20,
    `bhp=${state.currentBoss.currentHp} me=${state.playerMinions[0].currentHp}`);

  // ④ 건축물은 반격하지 않는다 (공격하지 않는 것과 같은 규칙)
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10, currentHp: 20, maxHp: 20 })],
    bossMinions: [minion({ name: '적탑', cardType: 'structure', attack: 0, currentHp: 30 })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '건축물(공0)은 반격하지 않는다', state.bossMinions[0].currentHp === 20 && state.playerMinions[0].currentHp === 20,
    `tower=${state.bossMinions[0].currentHp} me=${state.playerMinions[0].currentHp}`);

  // ⑤ 대칭: 상대 소환수가 내 소환수를 쳐도 내 공격력만큼 되돌아간다
  resetBoard({ playerHp: 50, playerMinions: [minion({ name: '내벽', attack: 5, currentHp: 30 })],
    bossMinions: [minion({ name: '적맹공', attack: 16, currentHp: 22, maxHp: 22 })] });
  BE.foeMinionAttack(0);
  check(S, '상대 공격자도 내 소환수의 공격력만큼 피해 (대칭): 16→내벽 14, 5→적 17 (예전: 22)',
    state.playerMinions[0].currentHp === 14 && state.bossMinions[0].currentHp === 17,
    `wall=${state.playerMinions[0].currentHp} foe=${state.bossMinions[0].currentHp}`);

  // ⑥ 동시 피해: 방어자가 죽어도 반격은 들어간다
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10, currentHp: 20, maxHp: 20 })],
    bossMinions: [minion({ name: '적약병', attack: 6, currentHp: 5, maxHp: 5 })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '동시 피해: 방어자가 죽어도 반격 6은 들어간다', state.bossMinions.length === 0 && state.playerMinions[0].currentHp === 14,
    `foes=${state.bossMinions.length} me=${state.playerMinions[0].currentHp}`);

  // ⑦ 반격으로 죽은 공격자는 전장에서 제거된다 (양쪽 다 죽을 수도 있다)
  resetBoard({ playerMinions: [minion({ name: '내돌격병', attack: 10, currentHp: 4, maxHp: 4 }), minion({ name: '내후위', attack: 3 })],
    bossMinions: [minion({ name: '적병', attack: 6, currentHp: 8, maxHp: 8 })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '반격으로 죽은 공격자는 전장에서 빠진다 (둘 다 처치)',
    state.bossMinions.length === 0 && state.playerMinions.length === 1 && state.playerMinions[0].name === '내후위',
    `foes=${state.bossMinions.length} mine=${state.playerMinions.map(m => m.name)}`);

  // ⑧ 방어자 진영의 건축물 공격 오라가 반격에도 붙는다 (오라는 읽는 시점에 계산)
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 10, currentHp: 30 })], bossMinions: [
    minion({ name: '적병', attack: 6, currentHp: 30 }),
    minion({ name: '적탑', cardType: 'structure', attack: 0, skills: [{ passiveEffect: { aura: { scope: 'all', attackBonus: 3 } } }] })] });
  BE.resolveMinionAttack(0, 'foe:0');
  check(S, '방어자 진영 공격 오라 +3이 반격에 붙는다: 6+3=9', state.playerMinions[0].currentHp === 21, `${state.playerMinions[0].currentHp}`);
}

// ============================================================
// 9e. 시전 대칭 — 카드 시전이 양 진영 한 함수 (DECISIONS #94)
// ------------------------------------------------------------
// 🐛 보스 전용 시전기는 소환수 스탯을 공8·방4·체16 하한으로 재작성했고(themeId·skills도 버림),
//    함성이 없었고, 함정을 즉발 주문으로 처리했고, 만석이면 전 소환수 공격 +2 영구 버프를 줬다.
//    PvP 경로는 관문이 없었다. 보스 함정은 4종 효과만 흉내 내고 상태이상을 본체에 raw로 걸었다.
// ============================================================
async function suiteCastSymmetry() {
  const S = '시전 대칭';

  // 상대 소환수는 카드 스탯·정체를 그대로 가진다
  resetBoard({ turnCount: 3 });
  await BE.playBossCard(card({ name: '약졸', cardType: 'unit', attack: 3, hp: 10, defense: 0, themeId: 'th-x', skills: [{}] }));
  const weak = state.bossMinions[0];
  check(S, '상대 소환수는 카드 스탯 그대로 (공3·체10, 예전 하한 8·16) + themeId·skills 유지',
    !!weak && weak.attack === 3 && weak.maxHp === 10 && weak.themeId === 'th-x' && Array.isArray(weak.skills),
    weak ? JSON.stringify({ a: weak.attack, hp: weak.maxHp, t: weak.themeId, s: !!weak.skills }) : '없음');

  // 상대 소환수의 전투의 함성이 발동한다
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  await BE.playBossCard(card({ name: '수호병', cardType: 'unit', skills: [{ shield: 7 }] }));
  check(S, '상대 소환수 함성 발동 (방어막 +7) (예전: 함성 없음)', state.currentBoss.shield === 7, `${state.currentBoss.shield}`);

  // 상대 함정은 뒷면 세트 — 즉발이 아니다
  resetBoard({ playerHp: 50 });
  await BE.playBossCard(card({ name: '상대함정', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 9 }] }));
  check(S, '상대 함정은 뒷면 세트 (예전: 즉발 주문으로 터짐)',
    BE.getTrapZone('boss').length === 1 && state.playerHp === 50,
    `zone=${BE.getTrapZone('boss').length} php=${state.playerHp}`);

  // 전장 만석이면 거절 — 공격 +2 영구 버프 없음
  resetBoard({ bossMinions: [minion({ attack: 5 }), minion({ attack: 5 }), minion({ attack: 5 }), minion({ attack: 5 })] });
  await BE.playBossCard(card({ name: '다섯째', cardType: 'unit', skills: [{}] }));
  check(S, '상대 전장 만석이면 거절, 공격 +2 없음 (예전: 전 소환수 +2 영구)',
    state.bossMinions.length === 4 && state.bossMinions.every(m => m.attack === 5),
    `${state.bossMinions.map(m => m.attack)}`);

  // 마나 부족 상대 카드는 관문에서 거절된다 (봇 경로 = trusted 아님)
  resetBoard({ playerHp: 50 });
  state.bossMana = 1; state.bossMaxMana = 5;
  const ok = BE.playCardFor(BE.getSide('boss'), card({ name: '비싼주문', cardType: 'spell', cost: 5, skills: [{ damage: 10 }] }));
  check(S, '마나 부족 상대 카드는 거절 (예전 PvP 경로: 무관문)', ok === false && state.playerHp === 50, `ok=${ok} php=${state.playerHp}`);

  // 보스 함정이 파이프라인 전체를 탄다 (드로우까지)
  resetBoard({ playerMinions: [minion({ name: '내병', attack: 5 })], boss: { maxHp: 300, currentHp: 300, shield: 0 },
    bossHand: [], bossDeck: [card()] });
  BE.__test.setTrap('boss', card({ name: '상대덫', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ shield: 5, drawCards: 1 }] }));
  BE.resolveMinionAttack(0, 'face');
  // 함정은 공격이 **닿기 전에** 터진다 — 얻은 방어막 5가 곧바로 5 피해를 흡수해 체력은 그대로다
  check(S, '상대 함정이 효과 전체를 탄다 (방어막이 타격을 흡수 + 드로우) (예전: 4종 흉내, 드로우 死효과)',
    state.currentBoss.currentHp === 300 && state.currentBoss.shield === 0 && state.bossHand.length === 1,
    `hp=${state.currentBoss.currentHp} sh=${state.currentBoss.shield} hand=${state.bossHand.length}`);

  // 보스 함정 상태이상은 내 최전방 소환수로 (본체에 raw로 걸리지 않는다)
  resetBoard({ playerMinions: [minion({ name: '앞', attack: 5, statuses: {} }), minion({ name: '뒤', statuses: {} })] });
  BE.__test.setTrap('boss', card({ name: '동결덫', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ statusEffect: { type: 'freeze', duration: 1 } }] }));
  BE.resolveMinionAttack(0, 'face');
  check(S, '상대 함정 상태이상은 내 최전방 소환수로 (예전: 본체에 raw applyStatus)',
    !!(state.playerMinions[0].statuses || {}).freeze && BE.getBattleStatusSnapshot().player.length === 0,
    JSON.stringify({ front: state.playerMinions[0].statuses, face: BE.getBattleStatusSnapshot().player }));
}

// ============================================================
// 9f. 봇 컨트롤러 — 판단은 boss-ai.js, 규칙은 엔진, 파이프는 applyFoeAction (DECISIONS #94)
// ============================================================
async function suiteBotController() {
  const S = '봇 컨트롤러';
  const T = BE.__test;

  // 격노(2페이즈)는 공격·마법에만 — 치유·방어막은 그대로 (🐛 예전엔 val>0이면 전부 ×1.4)
  //   격노는 **실제 피격**으로 켠다(40% 이하) — 수정 전 코드도 같은 길로 켜지므로 fail-first가 성립한다
  resetBoard({ boss: { maxHp: 300, currentHp: 200, shield: 0 } });
  BE.dealDamageToFoe(90, '격노 유발');            // 200 → 110 (36%) → 2페이즈
  await T.bossStep({ type: 'heal', name: '재생', value: 20 });
  await T.bossStep({ type: 'shield', name: '결계', value: 10 });
  check(S, '격노가 치유·방어막을 키우지 않는다 (20/10 그대로)',
    state.currentBoss.currentHp === 130 && state.currentBoss.shield === 10,
    `hp=${state.currentBoss.currentHp} sh=${state.currentBoss.shield}`);
  {
    const 딜 = Math.floor(스텝딜(20) * 1.4);
    resetBoard({ playerMinions: [], playerHp: 50, boss: { maxHp: 300, currentHp: 100, shield: 0 } });
    BE.dealDamageToFoe(1, '격노 유발');             // 100 → 99 (33%) → 2페이즈
    await T.bossStep({ type: 'attack', name: '강타', value: 20 });
    check(S, `격노 공격 스텝은 ×1.4 (20 → ${딜})`, state.playerHp === 50 - 딜, `${state.playerHp}`);
  }

  // 죽어 있던 minion_buff 스텝이 실제로 부하를 강화한다
  resetBoard({ bossMinions: [minion({ name: 'A', attack: 5 }), minion({ name: 'B', attack: 5 })] });
  await T.bossStep({ type: 'minion_buff', name: '지옥불 고양', buffAtk: 4 });
  check(S, 'minion_buff 스텝: 부하 공격력 +4 (예전: 처리기 없음 → 무동작)',
    state.bossMinions.every(m => m.attack === 9), `${state.bossMinions.map(m => m.attack)}`);

  // 의도 표시는 실제 격노 상태를 따른다 (예전: 50%에서 "격노"라 썼지만 격노는 40%였다)
  resetBoard({ boss: { maxHp: 300, currentHp: 135, shield: 0 } });   // 45% — 격노 아님
  BE.updateBossIntent();
  const intent = (document.getElementById('boss-intent') || {}).innerText || '';
  check(S, '의도 표시: 45%에서는 격노가 아니다 (격노는 40%)', !intent.includes('격노'), intent.replace(/\s+/g, ' ').slice(0, 40));

  // applyFoeAction: endTurn은 내 턴을 시작한다 (PvE — 플레이어가 리더라 turnCount가 오른다)
  resetBoard({ turnCount: 3, playerDeck: [card()] });
  if (typeof BE.applyFoeAction === 'function') await BE.applyFoeAction({ kind: 'endTurn' });
  check(S, 'applyFoeAction(endTurn) → 내 턴 시작 (턴 4, 마나 4)',
    state.turnCount === 4 && state.playerMana === 4 && T.activeSide() === 'player',
    `t=${state.turnCount} mana=${state.playerMana} active=${T.activeSide()}`);

  // applyFoeAction: 봇이 아닌 상대(원격)의 comboStep은 거절한다
  {
    const dummy = { sendAction() {} };
    try {
      attachPvpSession(dummy, { foeName: '검증상대', isHost: true });
      resetBoard({ playerHp: 50, playerMinions: [] });
      const ok = typeof BE.applyFoeAction === 'function'
        ? await BE.applyFoeAction({ kind: 'comboStep', step: { type: 'attack', name: '주입', value: 50 } })
        : undefined;
      check(S, '원격 상대의 comboStep은 거절된다 (피어가 스텝을 주입할 수 없다)',
        ok === false && state.playerHp === 50, `ok=${ok} php=${state.playerHp}`);
    } finally {
      detachPvpSession();
    }
  }

  // 봇 턴 전체가 파이프를 지나 끝난다 — 낼 수 없는 카드는 남고, 콤보가 돌고, 준비된 소환수만 친다
  resetBoard({ turnCount: 5, playerHp: 100, playerMinions: [],
    boss: { maxHp: 300, currentHp: 300, shield: 0, comboPatterns: [{ name: '검사', steps: [{ type: 'attack', name: '타격', value: 10 }] }] },
    bossHand: [card({ name: '비쌈', cost: 9 })], bossDeck: [card({ cost: 9 })],
    bossMinions: [minion({ name: '준비됨', attack: 6, canAttack: true, summonedTurn: 1 }), minion({ name: '후유증', attack: 6, canAttack: false, summonedTurn: 5 })] });
  await (typeof T.takeBotTurn === 'function' ? T.takeBotTurn({ pace: 0 }) : BE.executeBossTurn({ handOff: false }));
  const expected = 100 - 스텝딜(10) - 6;
  check(S, '봇 턴: 콤보 스텝 + 준비된 소환수 1기만 공격, 비싼 카드는 손패에 남는다',
    state.playerHp === expected && state.bossHand.length === 2 && state.bossMinions[0].canAttack === false && state.isAnimating === false,
    `php=${state.playerHp} (기대 ${expected}) hand=${state.bossHand.length} anim=${state.isAnimating}`);
}

// ============================================================
// 9g. 대전 초기화 결정론 — 좌석 덱, 원격 상대 체력 기준, 손패 정체 (DECISIONS #94)
// ------------------------------------------------------------
// 🐛 예전엔 양 클라이언트가 initBattle에서 전술 덱을 만들며(보관함 크기만큼 RNG 소비) 상대 덱을
//    셔플 없이 덮어썼고, 전송 카드에 instanceId가 없어 상대 손패 수가 줄지 않았으며, 원격 체력은 50이었다.
// ============================================================
async function suitePvpInit() {
  const S = '대전 초기화';
  const dummy = { sendAction() {} };
  const foeDeck = Array.from({ length: 8 }, (_, i) => card({ id: 'fd' + i, name: '상대카드' + i, cost: 1 }));
  const snapCollection = state.cardsCollection;   // 참조 보존 — 검사 뒤 되돌린다 (저장하지 않는다)
  const remoteInit = () => BE.initBattle({ seed: 11, leader: 'player', foe: { controller: 'remote', deck: foeDeck } });
  const ids = (arr) => arr.map(c => c.instanceId);

  try {
    attachPvpSession(dummy, { foeName: '검증상대', isHost: true });

    // ① 같은 시드 → 양쪽 덱·손패 순서가 같고, instanceId는 좌석(A=리더, B=팔로워)으로 시작한다
    remoteInit();
    const first = { mine: ids(state.playerDeck), foe: ids(state.bossDeck), foeHand: ids(state.bossHand) };
    remoteInit();
    const second = { mine: ids(state.playerDeck), foe: ids(state.bossDeck), foeHand: ids(state.bossHand) };
    check(S, '같은 시드 → 상대 덱·손패 순서 동일, 좌석 id (A:/B:)',
      JSON.stringify(first) === JSON.stringify(second)
        && first.foe.every(id => String(id).startsWith('B:')) && first.mine.every(id => String(id).startsWith('A:'))
        && first.foeHand.length === 4,
      `foe=${first.foe.slice(0, 2)} mine=${first.mine.slice(0, 2)} hand=${first.foeHand.length}`);

    // ② 원격 상대: 체력은 PLAYER_BASE_HP, 콤보 없음, 컨트롤러 remote (예전: 보스 템플릿 체력 130 / 50)
    check(S, `원격 상대 체력 = PLAYER_BASE_HP (${PLAYER_BASE_HP}), 콤보 없음, controller=remote`,
      state.currentBoss.maxHp === PLAYER_BASE_HP && state.currentBoss.isDuelist === true
        && (state.currentBoss.comboPatterns || []).length === 0 && BE.getSide('boss').controller === 'remote',
      `hp=${state.currentBoss.maxHp} duelist=${state.currentBoss.isDuelist} ctrl=${BE.getSide('boss').controller}`);

    // ③ 내 덱 순서는 보관함 크기와 무관하다 (예전: 상대 자리에 전술 덱을 만들며 RNG를 먼저 소비)
    state.cardsCollection = [...snapCollection,
      card({ id: 'extra1', rarity: 'legendary' }), card({ id: 'extra2', rarity: 'epic' }), card({ id: 'extra3', element: 'dark' })];
    remoteInit();
    const withExtra = ids(state.playerDeck);
    state.cardsCollection = snapCollection;
    check(S, '원격 초기화: 내 덱 순서가 보관함 크기와 무관', JSON.stringify(withExtra) === JSON.stringify(first.mine),
      `${withExtra.slice(0, 3)} vs ${first.mine.slice(0, 3)}`);

    // ④ 원격 playCard가 좌석 id로 손패를 찾아 제거한다 (예전: id 불일치 → 스냅샷 재생, 손패 수 불변)
    remoteInit();
    const foeCard = state.bossHand[0];
    await BE.applyFoeAction({ kind: 'playCard', instanceId: foeCard.instanceId, card: slimCardForWire(foeCard), slot: null, picked: null });
    check(S, '원격 playCard: 좌석 id로 손패에서 찾아 제거 (4→3), 전장 1기',
      state.bossHand.length === 3 && state.bossMinions.length === 1 && String(foeCard.instanceId).startsWith('B:'),
      `hand=${state.bossHand.length} field=${state.bossMinions.length} id=${foeCard.instanceId}`);

    // ⑤ 내 턴 종료 → 원격 상대의 턴 시작이 내 화면에서도 돌고, 상대도 **진짜 카드**를 뽑는다
    remoteInit();
    const foeHand0 = state.bossHand.length, foeDeck0 = state.bossDeck.length;
    BE.playerEndTurn();
    check(S, '내 턴 종료 → 원격 상대 턴 시작: 드로우 1 (예전: 원격은 드로우 생략)',
      state.bossHand.length === foeHand0 + 1 && state.bossDeck.length === foeDeck0 - 1 && state.bossMana === 1,
      `hand=${state.bossHand.length} deck=${state.bossDeck.length} mana=${state.bossMana}`);
  } finally {
    state.cardsCollection = snapCollection;
    detachPvpSession();
  }
}

// ============================================================
// 9i. 보스 카드 예산 · 스텝 강화 1회 (DECISIONS #95)
// ------------------------------------------------------------
// 🐛 보스 파워 카드 9장이 전부 파워 예산 초과였다(옛 보스 전용 시전기가 함성을 안 내던 시절의 수치).
//    스텝 강화(+4 / 만석 +3)는 영구 중첩이라 10턴에 +7~12가 됐다. 둘 다 #87 기준선에 없던 힘이다.
// ============================================================
async function suiteBossBudget() {
  const S = '보스 카드 예산';

  // ① 보스 파워 카드는 플레이어와 같은 파워 예산을 지난다
  resetBoard();
  const deck = BE.buildBossTacticalDeck({ element: 'fire', name: '검증보스' });
  const power = deck.filter(c => String(c.id).startsWith('boss-card') || String(c.id).startsWith('boss-atk'));
  const over = power.filter(c => { const p = evaluateCardPower(c); return p.overBudget || (p.illegal || []).length > 0; });
  check(S, '보스 파워 카드는 파워 예산을 지난다 (예전: 9장 전부 초과 — 2코 14/4/20 + 함성 14)',
    power.length > 0 && over.length === 0, `power=${power.length} over=${over.map(c => c.name)}`);
  check(S, '등급 없는 보스 파워 카드는 레어로 친다 (커먼: 30턴 교착 / 에픽: 원본과 동일 — #95 실측)',
    power.every(c => c.rarity === 'rare'), `${power.map(c => c.rarity)}`);

  // ② 스텝 강화는 소환수당 한 번
  resetBoard({ bossMinions: [minion({ name: '상대병', attack: 5 }), minion({ name: '상대병2', attack: 5 })] });
  await BE.__test.bossStep({ type: 'minion_buff', name: '고양', buffAtk: 4 });
  await BE.__test.bossStep({ type: 'minion_buff', name: '고양', buffAtk: 4 });
  check(S, 'minion_buff는 소환수당 한 번 (+4 → 9; 예전: 영구 중첩 13)',
    state.bossMinions.every(m => m.attack === 9), `${state.bossMinions.map(m => m.attack)}`);

  // ③ 만석 강화(+3)도 같은 규칙 — 이미 강화된 소환수는 건너뛴다
  resetBoard({ bossMinions: [minion({ attack: 5 }), minion({ attack: 5 }), minion({ attack: 5 }), minion({ attack: 5 })] });
  await BE.__test.bossStep({ type: 'summon_or_buff', name: '소환/강화', value: 1 });
  await BE.__test.bossStep({ type: 'summon_or_buff', name: '소환/강화', value: 1 });
  check(S, '만석 강화 +3도 소환수당 한 번 (→ 8; 예전: 11)',
    state.bossMinions.length === 4 && state.bossMinions.every(m => m.attack === 8), `${state.bossMinions.map(m => m.attack)}`);
}

// ============================================================
// 9j. 사이클 상태이상 — 기생 → 성장 → 부화 (DECISIONS #104)
// ------------------------------------------------------------
// 단계가 **소멸할 때** 다음 단계로 넘어가거나 보상(토큰)을 낸다. 토큰은 디버프를 건 쪽(숙주의 반대편)에 선다.
// ============================================================
// ============================================================
// 약화·연쇄 — 빙결(공격력)·부식(방어력)·감전(연쇄)  → DECISIONS #105
// ============================================================
function suiteWeakenChain() {
  const S = '약화·연쇄';
  // 구버전에서도 검사가 **개별로** 빨갛게 되도록 안전 껍데기를 쓴다 (예외로 스위트째 죽지 않게)
  const getAttackPenalty = s => (typeof SE.getAttackPenalty === 'function' ? SE.getAttackPenalty(s) : 0);
  const getDefensePenalty = s => (typeof SE.getDefensePenalty === 'function' ? SE.getDefensePenalty(s) : 0);
  const collectChainTargets = (b, h) => (typeof SE.collectChainTargets === 'function' ? SE.collectChainTargets(b, h) : []);
  const hasChainStatus = s => (typeof SE.hasChainStatus === 'function' ? SE.hasChainStatus(s) : false);
  const playerSide = () => (BE.__test.sides ? BE.__test.sides().player : null);
  const attack0 = () => { const s = playerSide(); if (s) BE.resolveAttack(s, 0, 'foe:0'); };

  // ① 빙결은 봉쇄가 아니다 (예전엔 stun과 코드가 **완전히 같았다**)
  const stF = createStatusState();
  applyStatus(stF, 'freeze', 2, 4);
  check(S, '빙결은 행동을 봉쇄하지 않는다', isBlocked(stF) === null || isBlocked(stF) === undefined || isBlocked(stF) === false,
    `${isBlocked(stF)}`);
  check(S, '빙결 = 공격력 약화 4', getAttackPenalty(stF) === 4 && getDefensePenalty(stF) === 0,
    `atk=${getAttackPenalty(stF)} def=${getDefensePenalty(stF)}`);

  // ② 부식은 방어력만 깎는다 — 빙결의 짝
  const stC = createStatusState();
  applyStatus(stC, 'corrosion', 2, 6);
  check(S, '부식 = 방어력 약화 6 (공격력은 그대로)',
    getDefensePenalty(stC) === 6 && getAttackPenalty(stC) === 0,
    `atk=${getAttackPenalty(stC)} def=${getDefensePenalty(stC)}`);

  // ③ 방어력 약화가 **실제 피해 계산**에 들어간다 (damageEntity 한 곳 — 규칙 29)
  const mc = minion({ defense: 8, currentHp: 100, statuses: {} });
  const before = damageEntity(minion({ defense: 8, currentHp: 100 }), 20).dealt;   // 20-8 = 12
  applyStatus(mc.statuses, 'corrosion', 2, 5);
  const after = damageEntity(mc, 20).dealt;                                        // 20-(8-5) = 17
  check(S, '부식이 수비를 깎아 피해가 늘어난다 (12 → 17)',
    before === 12 && after === 17, `before=${before} after=${after}`);

  // ④ 공격력 약화가 **실제 공격**에 들어간다 (resolveAttack)
  resetBoard({
    playerMinions: [minion({ name: '빙결딜러', attack: 12, summonedTurn: 0, statuses: {} })],
    bossMinions: [minion({ name: '표적', defense: 0, currentHp: 100, attack: 0 })]
  });
  applyStatus(state.playerMinions[0].statuses, 'freeze', 2, 5);
  attack0();
  check(S, '빙결 걸린 소환수는 약하게 때린다 (12 → 7)',
    state.bossMinions[0] && state.bossMinions[0].currentHp === 93,
    `hp=${state.bossMinions[0] && state.bossMinions[0].currentHp}`);

  // ⑤ 약화는 **저장하지 않는다** — 상태가 풀리면 원래 값으로 돌아온다 (규칙 16)
  check(S, '약화는 entity.attack/defense를 건드리지 않는다',
    state.playerMinions[0].attack === 12 && mc.defense === 8,
    `atk=${state.playerMinions[0].attack} def=${mc.defense}`);

  // ⑥ 감전 연쇄 — 한 대 때리면 그 진영의 감전된 **전원**이 자기 위력만큼 맞는다
  resetBoard({
    playerMinions: [minion({ name: '방전기', attack: 10, summonedTurn: 0 })],
    bossMinions: [
      minion({ name: '감전A', defense: 0, currentHp: 100, attack: 0, statuses: {} }),
      minion({ name: '감전B', defense: 0, currentHp: 100, attack: 0, statuses: {} }),
      minion({ name: '멀쩡이', defense: 0, currentHp: 100, attack: 0, statuses: {} })
    ]
  });
  applyStatus(state.bossMinions[0].statuses, 'shock', 3, 4);
  applyStatus(state.bossMinions[1].statuses, 'shock', 3, 7);
  attack0();
  const [a, b, c] = state.bossMinions;
  check(S, '감전 연쇄: 맞은 A는 10+4, B는 자기 위력 7, 안 걸린 C는 무사',
    a.currentHp === 86 && b.currentHp === 93 && c.currentHp === 100,
    `A=${a.currentHp} B=${b.currentHp} C=${c.currentHp}`);

  // ⑦ 감전이 없으면 연쇄도 없다 (음성 통제)
  resetBoard({
    playerMinions: [minion({ name: '방전기', attack: 10, summonedTurn: 0 })],
    bossMinions: [
      minion({ name: '표적', defense: 0, currentHp: 100, attack: 0, statuses: {} }),
      minion({ name: '옆사람', defense: 0, currentHp: 100, attack: 0, statuses: {} })
    ]
  });
  attack0();
  check(S, '감전이 없으면 옆 소환수는 안 맞는다',
    state.bossMinions[0].currentHp === 90 && state.bossMinions[1].currentHp === 100,
    `${state.bossMinions[0].currentHp} / ${state.bossMinions[1].currentHp}`);

  // ⑧ 연쇄는 수비력을 무시한다 (전기는 갑옷을 타고 흐른다)
  const armored = minion({ name: '중장갑', defense: 20, currentHp: 100, statuses: {} });
  applyStatus(armored.statuses, 'shock', 2, 6);
  const targets = collectChainTargets([armored], null);
  check(S, '연쇄 피해는 수비력을 보지 않는다 (위력 그대로 6)',
    targets.length === 1 && targets[0].damage === 6, JSON.stringify(targets.map(t => t.damage)));
  check(S, 'hasChainStatus는 감전만 참', hasChainStatus(armored.statuses) === true && hasChainStatus(stF) === false);
}

function suiteStatusCycles() {
  const S = '사이클';
  const host = (over = {}) => minion({ name: '숙주', currentHp: 60, maxHp: 60, defense: 0, ...over });

  // ① 기생이 소멸하면 성장으로 넘어간다 (사라지지 않는다)
  resetBoard({ playerMinions: [host()], bossMinions: [] });
  applyStatus(state.playerMinions[0].statuses, 'parasite', 1, 3);
  BE.__test.startTurn('player');
  const st1 = state.playerMinions[0] && state.playerMinions[0].statuses;
  check(S, '기생 소멸 → 성장 단계로 진행 (예전: 그냥 사라짐)',
    !!(st1 && st1.gestation && st1.gestation.turns > 0) && !st1.parasite,
    `statuses=${JSON.stringify(st1)}`);

  // ② 성장이 소멸하면 **상대(디버프를 건 쪽)** 전장에 토큰이 서고 숙주가 피해를 입는다
  resetBoard({ playerMinions: [host()], bossMinions: [] });
  applyStatus(state.playerMinions[0].statuses, 'gestation', 1, 5);
  BE.__test.startTurn('player');
  const bornOn = state.bossMinions.length;
  const survivor = state.playerMinions[0];
  check(S, '성장 소멸 → 디버프를 건 쪽(상대) 전장에 토큰 부화 · 내 전장엔 안 생긴다',
    bornOn === 1 && state.playerMinions.length === 1 && state.bossMinions[0].isToken === true,
    `boss=${bornOn} mine=${state.playerMinions.length}`);
  check(S, '부화한 토큰은 소환 후유증을 가진다 (그 턴에 못 때린다)',
    state.bossMinions[0] && state.bossMinions[0].canAttack === false, `${state.bossMinions[0] && state.bossMinions[0].canAttack}`);
  check(S, '숙주는 뚫고 나온 피해를 입는다 (60 - 성장 지속 5 - 출산 6 = 49)',
    survivor && survivor.currentHp === 49, `${survivor && survivor.currentHp}`);

  // ③ 상대 전장이 꽉 차면 **한 턴 기다린다** — 소환이 핵심이라 불발로 날리지 않는다
  resetBoard({ playerMinions: [host()], bossMinions: [minion(), minion(), minion(), minion()] });
  applyStatus(state.playerMinions[0].statuses, 'gestation', 1, 5);
  BE.__test.startTurn('player');
  const held = state.playerMinions[0] && state.playerMinions[0].statuses.gestation;
  check(S, '자리가 없으면 성장이 한 턴 미뤄진다 (토큰 없음, 단계 유지)',
    state.bossMinions.length === 4 && !!(held && held.turns > 0),
    `boss=${state.bossMinions.length} held=${JSON.stringify(held)}`);

  // ④ 기다린 뒤에도 자리가 없으면 숙주 안에서 터진다 (불발이 아니라 피해로 전환)
  const hpBeforeBurst = state.playerMinions[0].currentHp;
  BE.__test.startTurn('player');
  const after = state.playerMinions[0];
  check(S, '계속 자리가 없으면 안에서 터져 숙주가 피해 (성장 지속 5 + 파열 10)',
    !!after && after.currentHp === hpBeforeBurst - 15 && !after.statuses.gestation && state.bossMinions.length === 4,
    `hp ${hpBeforeBurst}→${after && after.currentHp} st=${JSON.stringify(after && after.statuses)}`);

  // ⑤ 숙주가 도중에 죽으면 부화하지 않는다 — 이게 상대의 대응 수단이다
  resetBoard({ playerMinions: [host({ currentHp: 4 })], bossMinions: [] });
  applyStatus(state.playerMinions[0].statuses, 'gestation', 1, 5);
  BE.__test.startTurn('player');
  check(S, '숙주가 지속 피해로 죽으면 부화하지 않는다 (상대의 대응 수단)',
    state.playerMinions.length === 0 && state.bossMinions.length === 0,
    `mine=${state.playerMinions.length} boss=${state.bossMinions.length}`);

  // ⑥ 사이클 상태이상은 지속 피해가 있으므로 **본체에 걸리지 않는다** (다른 DoT와 같은 규칙)
  resetBoard({ playerMinions: [minion({ name: '최전방' })], bossMinions: [] });
  BE.__test.helpers('boss').setFoeStatus('parasite', 2, 3, true);   // allowBody=true여도 본체엔 안 걸린다
  check(S, '기생은 본체에 걸리지 않고 최전방 소환수로 간다 (allowBody여도)',
    !BE.__test.statuses().player.parasite && !!state.playerMinions[0].statuses.parasite,
    `body=${JSON.stringify(BE.__test.statuses().player)} front=${JSON.stringify(state.playerMinions[0].statuses)}`);
}

// ============================================================
// 10. 보스 턴
// ============================================================
async function suiteBossTurn() {
  const S = '보스 턴';

  // 보스 소환수 배치 + 소환 후유증
  resetBoard({ turnCount: 5 });
  await BE.playBossCard(card({ name: '보스병', cardType: 'unit', attack: 14, hp: 24, skills: [{}] }));
  const bm = state.bossMinions[0];
  check(S, '보스 소환: 후유증 + 도발 없음',
    bm && bm.canAttack === false && bm.summonedTurn === 5 && !bm.taunt,
    JSON.stringify(bm && { c: bm.canAttack, t: bm.taunt, s: bm.summonedTurn }));

  // 🏛️ 보스가 낸 건축물은 공격력 0이어야 한다
  //    🐛 `attack: Math.max(8, card.attack || 12)`가 0을 덮어써서,
  //       플레이어의 0공격 요새가 보스 손에서는 12공격 소환수가 됐다.
  resetBoard({ turnCount: 5 });
  await BE.playBossCard(card({ name: '보스요새', cardType: 'structure', attack: 0, defense: 12, hp: 40, skills: [{}] }));
  const bs = state.bossMinions[0];
  check(S, '보스 건축물은 공격력 0으로 배치된다',
    bs && bs.attack === 0 && bs.cardType === 'structure',
    JSON.stringify(bs && { atk: bs.attack, type: bs.cardType }));

  // 그리고 실제로 공격하지 않는다
  resetBoard({ playerMinions: [minion({ name: '벽', currentHp: 30 })], playerHp: 50 });
  BE.foeMinionAttack(0, { name: '보스요새', cardType: 'structure', attack: 0, defense: 12, currentHp: 40, maxHp: 40 });
  check(S, '보스 건축물은 공격 단계에서 아무 일도 하지 않는다',
    state.playerMinions[0].currentHp === 30 && state.playerHp === 50,
    `벽=${state.playerMinions[0].currentHp} 본체=${state.playerHp}`);

  // 보스 주문 — 전장이 비면 본체 직격
  resetBoard({ playerMinions: [] });
  await BE.playBossCard(card({ name: '보스주문', cardType: 'spell', skills: [{ damage: 15 }] }));
  check(S, '보스 주문: 전장이 비면 본체 직격', state.playerHp === 35, `${state.playerHp}`);

  // 보스 주문 — 최전방이 대신 맞는다
  resetBoard({ playerMinions: [minion({ name: '벽', currentHp: 30 })] });
  await BE.playBossCard(card({ name: '보스주문', cardType: 'spell', skills: [{ damage: 15 }] }));
  check(S, '보스 주문: 최전방이 대신 피격',
    state.playerHp === 50 && state.playerMinions[0].currentHp === 15,
    `php=${state.playerHp} 벽=${state.playerMinions[0].currentHp}`);

  // 보스 주문 — 실드 관통은 전열을 무시
  resetBoard({ playerMinions: [minion({ name: '벽' })] });
  await BE.playBossCard(card({ name: '관통주문', cardType: 'spell', skills: [{ damage: 15, pierceShield: true }] }));
  // 재기준선(DECISIONS #94): 관통은 **대상 규칙이 아니다** — 플레이어 주문과 같이 고른 대상(최전방)을 치고
  // 방어막·수비만 무시한다. 예전 보스 전용 해석기만 전열을 건너뛰었다.
  check(S, '보스 주문: 관통은 전열을 건너뛰지 않는다 (플레이어 규칙과 같음)',
    state.playerHp === 50 && state.playerMinions[0].currentHp === 15,
    `php=${state.playerHp} 벽=${state.playerMinions[0].currentHp}`);

  // 보스 광역 주문
  resetBoard({ playerMinions: [minion({ name: 'A' }), minion({ name: 'B' })] });
  await BE.playBossCard(card({ name: '광역', cardType: 'spell', skills: [{ damage: 10, isAoeSpell: true }] }));
  // 재기준선(DECISIONS #94): 광역 본체 피해는 플레이어와 같이 100% (예전 보스 전용 ×0.7)
  check(S, '보스 광역: 전부 + 본체 100% (예전 70%)',
    state.playerMinions.every(m => m.currentHp === 20) && state.playerHp === 40,
    `${state.playerMinions.map(m => m.currentHp)} php=${state.playerHp}`);

  // ⭐ 보스 광역이 수비력을 존중하는가 (실전에서 22체력/8수비 벽이 20에 죽었다)
  resetBoard({ playerMinions: [minion({ name: '벽', defense: 8, currentHp: 22, maxHp: 22 })] });
  await BE.playBossCard(card({ name: '광역', cardType: 'spell', skills: [{ damage: 20, isAoeSpell: true }] }));
  check(S, '보스 광역 주문이 수비력을 적용 (20-8=12)',
    state.playerMinions.length === 1 && state.playerMinions[0].currentHp === 10,
    `${state.playerMinions.map(m => m.name + ':' + m.currentHp)}`);

  {
    const 딜 = 스텝딜(28), 남을체력 = 32 - Math.max(1, 딜 - 14);
    resetBoard({ playerMinions: [minion({ name: '벽', defense: 14, currentHp: 32, maxHp: 32 })] });
    await BE.__test.bossStep({ type: 'attack', name: '광역', value: 28, isAoe: true });
    check(S, `보스 광역 스텝도 수비력을 적용 (${딜}-14)`,
      state.playerMinions.length === 1 && state.playerMinions[0].currentHp === 남을체력,
      `${state.playerMinions.map(m => m.name + ':' + m.currentHp)} 기대=${남을체력}`);
  }

  // 보스 광역 관통은 수비를 무시한다
  resetBoard({ playerMinions: [minion({ name: '벽', defense: 8, currentHp: 22, maxHp: 22 })] });
  await BE.playBossCard(card({ name: '관통광역', cardType: 'spell', skills: [{ damage: 20, isAoeSpell: true, pierceShield: true }] }));
  check(S, '보스 광역 관통은 수비를 무시 (20 전부)',
    state.playerMinions.length === 1 && state.playerMinions[0].currentHp === 2,
    `${state.playerMinions.map(m => m.currentHp)}`);

  // ⭐ 보스 주문이 연타·치명타·처형·흡혈을 반영하는가
  resetBoard({ playerMinions: [] });
  await BE.playBossCard(card({ name: '연타', cardType: 'spell', skills: [{ damage: 6, multiHit: 3 }] }));
  check(S, '보스 주문 연타 3회 → 총 18', state.playerHp === 32, `${state.playerHp}`);

  resetBoard({ playerMinions: [] });
  await BE.playBossCard(card({ name: '크리', cardType: 'spell', skills: [{ damage: 10, critChance: 1, critMultiplier: 2 }] }));
  check(S, '보스 주문 치명타 2배', state.playerHp === 30, `${state.playerHp}`);

  resetBoard({ playerMinions: [], playerHp: 10, playerMaxHp: 50 });
  await BE.playBossCard(card({ name: '처형', cardType: 'spell', skills: [{ damage: 4, executeThreshold: 0.3 }] }));
  check(S, '보스 주문 처형 2배', state.playerHp === 2, `${state.playerHp}`);

  resetBoard({ playerMinions: [], boss: { maxHp: 300, currentHp: 100, shield: 0 } });
  await BE.playBossCard(card({ name: '흡혈', cardType: 'spell', skills: [{ damage: 20, lifestealPercent: 0.5 }] }));
  check(S, '보스 주문 흡혈로 보스 회복', state.currentBoss.currentHp === 110, `${state.currentBoss.currentHp}`);

  // ⭐ 보스 드로우 — 실전에서 드로우 카드가 死카드였다
  resetBoard({ bossHand: [], bossDeck: [card(), card(), card()] });
  await BE.playBossCard(card({ name: '드로우', cardType: 'spell', skills: [{ drawCards: 2 }] }));
  check(S, '보스 주문 드로우 2장', state.bossHand.length === 2 && state.bossDeck.length === 1,
    `손패=${state.bossHand.length} 덱=${state.bossDeck.length}`);

  // 재기준선(DECISIONS #94): 손패 상한은 양 진영 7 — 6장에서 2장 뽑으면 7에서 멈춘다
  resetBoard({ bossHand: [card(), card(), card(), card(), card(), card()], bossDeck: [card(), card()] });
  await BE.playBossCard(card({ name: '드로우', cardType: 'spell', skills: [{ drawCards: 2 }] }));
  check(S, '보스 손패 상한 7에서 멈춘다 (예전 5)', state.bossHand.length === 7, `${state.bossHand.length}`);

  // ⭐ 보스 약화 · 무효화
  resetBoard({ playerMinions: [minion({ name: '내병사', attack: 12 })] });
  await BE.playBossCard(card({ name: '약화', cardType: 'spell', skills: [{ attackDown: 5 }] }));
  check(S, '보스 주문 약화 (12→7)', state.playerMinions[0].attack === 7, `${state.playerMinions[0].attack}`);

  resetBoard({ playerMinions: [minion({ name: '내병사', skills: [{ damage: 3 }] })] });
  await BE.playBossCard(card({ name: '무효화', cardType: 'spell', skills: [{ silence: true }] }));
  check(S, '보스 주문 무효화 (효과 제거, 스탯 유지)',
    state.playerMinions[0].skills.length === 0 &&
    state.playerMinions[0].attack === 10);

  // 보스 방어막/치유
  resetBoard({ boss: { maxHp: 300, currentHp: 200, shield: 0 } });
  await BE.playBossCard(card({ name: '가호', cardType: 'spell', skills: [{ shield: 20, heal: 30 }] }));
  check(S, '보스 방어막·치유',
    state.currentBoss.shield === 20 && state.currentBoss.currentHp === 230,
    `sh=${state.currentBoss.shield} hp=${state.currentBoss.currentHp}`);

  // 보스 패 파괴
  resetBoard({ playerHand: [card(), card(), card()] });
  await BE.playBossCard(card({ name: '패파괴', cardType: 'spell', skills: [{ discardCard: true }] }));
  check(S, '보스 패 파괴', state.playerHand.length === 2, `${state.playerHand.length}`);

  // 보스 상태이상 — 소환수 전용은 최전방으로
  resetBoard({ playerMinions: [minion({ name: '앞', statuses: {} })] });
  await BE.playBossCard(card({ name: '동결', cardType: 'spell', skills: [{ statusEffect: { type: 'freeze', duration: 2 } }] }));
  check(S, '보스 상태이상: 소환수 전용은 최전방으로',
    !!(state.playerMinions[0].statuses || {}).freeze &&
    BE.getBattleStatusSnapshot().player.length === 0,
    JSON.stringify(state.playerMinions[0].statuses));

  // ⚡ 보스 더블캐스트 (새로 구현)
  resetBoard({ playerMinions: [] });
  BE.__test.buffs().boss.doubleCast = true;
  await BE.playBossCard(card({ name: '보스주문', cardType: 'spell', skills: [{ damage: 10 }] }));
  check(S, '보스 더블캐스트: 주문 2연속 (20)',
    state.playerHp === 30 && BE.__test.buffs().boss.doubleCast === false, `${state.playerHp}`);

  // 콤보 스텝 6종
  resetBoard({ turnCount: 5, bossMinions: [] });
  await BE.__test.bossStep({ type: 'summon_or_buff', name: '소환', value: 1 });
  check(S, '스텝 summon_or_buff: 소환 + 후유증',
    state.bossMinions.length === 1 && state.bossMinions[0].canAttack === false);

  // "자리가 없다" = 슬롯 4를 다 채운 상태 (재기준선: 예전 보스 슬롯 3 — DECISIONS #94)
  resetBoard({ bossMinions: [minion({ name: 'A', attack: 5 }), minion({ name: 'B', attack: 5 }),
                             minion({ name: 'C', attack: 5 }), minion({ name: 'D', attack: 5 })] });
  await BE.__test.bossStep({ type: 'summon_or_buff', name: '강화', value: 1 });
  check(S, '스텝 summon_or_buff: 자리가 없으면 전체 +3 강화',
    state.bossMinions.every(m => m.attack === 8), `${state.bossMinions.map(m => m.attack)}`);

  resetBoard({ playerMinions: [minion({ name: '앞', statuses: {} })] });
  await BE.__test.bossStep({ type: 'debuff', status: { type: 'poison', duration: 3, value: 8 } });
  check(S, '스텝 debuff: 소환수 전용은 최전방으로',
    !!(state.playerMinions[0].statuses || {}).poison,
    JSON.stringify(state.playerMinions[0].statuses));

  resetBoard({ playerMinions: [], playerMana: 5 });
  await BE.__test.bossStep({ type: 'debuff', status: { type: 'shock', duration: 2, value: 4 } });
  check(S, '스텝 debuff: 감전은 본체 + 마나 1 방전',
    BE.getBattleStatusSnapshot().player.some(s => s.type === 'shock') && state.playerMana === 4,
    `mana=${state.playerMana}`);

  resetBoard({ boss: { maxHp: 300, currentHp: 100, shield: 0 } });
  await BE.__test.bossStep({ type: 'heal', name: '회복', value: 40 });
  check(S, '스텝 heal', state.currentBoss.currentHp === 140, `${state.currentBoss.currentHp}`);

  resetBoard({ playerMana: 5, playerMaxShield: 30, playerHand: [card(), card()] });
  await BE.__test.bossStep({ type: 'disrupt', name: '방해', manaBurn: 2, breakShield: true, discardCard: true });
  check(S, '스텝 disrupt: 마나 강탈 · 방어막 파쇄 · 패 파괴',
    state.playerMana === 3 && state.playerMaxShield === 0 && state.playerHand.length === 1,
    `mana=${state.playerMana} sh=${state.playerMaxShield} hand=${state.playerHand.length}`);

  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  await BE.__test.bossStep({ type: 'shield', name: '결계', value: 25, reflectPercent: 0.3 });
  // 가시는 진영 버프 + 턴제 (재기준선: 예전 currentBoss.thorns 영구 — DECISIONS #94)
  check(S, '스텝 shield: 방어막 + 가시 반사 등록 (버프, 2턴)',
    state.currentBoss.shield === 25 && BE.__test.buffs().boss.thorns === 0.3 && BE.__test.buffs().boss.thornsTurns === 2,
    JSON.stringify(BE.__test.buffs().boss));

  // 가시 반사가 실제로 되돌아오는가
  BE.dealDamageToFoe(100, '검증');
  check(S, '가시 반사: 받은 피해의 30%를 되돌린다',
    state.playerHp === 50 - Math.floor((100 - 25) * 0.3), `php=${state.playerHp}`);

  {
    const 딜 = 스텝딜(20);
    resetBoard({ playerMinions: [] });
    await BE.__test.bossStep({ type: 'attack', name: '강타', value: 20 });
    check(S, `스텝 attack: 본체 직격 (20 → ${딜})`, state.playerHp === 50 - 딜, `${state.playerHp}`);
  }
  {
    const 딜 = 스텝딜(4);
    resetBoard({ playerMinions: [], playerHp: 10, playerMaxHp: 50 });
    await BE.__test.bossStep({ type: 'attack', name: '처형', value: 4, executeThreshold: 0.3 });
    check(S, '스텝 attack: 처형 배율 EXECUTE_MULT (카드와 같은 값)',
      state.playerHp === 10 - Math.floor(딜 * EXECUTE_MULT), `${state.playerHp}`);
  }
  {
    const 총딜 = 스텝딜(30), 회당 = Math.max(1, Math.floor(총딜 / 3));
    resetBoard({ playerMinions: [] });
    await BE.__test.bossStep({ type: 'attack', name: '연타', value: 30, multiHit: 3 });
    check(S, `스텝 attack: 연타 3회 (총 ${총딜} → 회당 ${회당})`,
      state.playerHp === 50 - 회당 * 3, `${state.playerHp}`);
  }
  {
    const 딜 = 스텝딜(10);
    resetBoard({ playerMinions: [minion({ name: 'A' }), minion({ name: 'B' })] });
    await BE.__test.bossStep({ type: 'attack', name: '광역', value: 10, isAoe: true });
    check(S, '스텝 attack: 광역은 전부 + 본체 70%',
      state.playerMinions.every(m => m.currentHp === 30 - 딜) &&
      state.playerHp === 50 - Math.floor(딜 * 0.7),
      `${state.playerMinions.map(m => m.currentHp)} php=${state.playerHp}`);
  }
  {
    const 딜 = 스텝딜(20);
    resetBoard({ playerMinions: [], boss: { maxHp: 300, currentHp: 100, shield: 0 } });
    await BE.__test.bossStep({ type: 'attack', name: '흡혈', value: 20, lifestealPercent: 0.5 });
    check(S, '스텝 attack: 흡혈로 보스 회복',
      state.currentBoss.currentHp === 100 + Math.floor(딜 * 0.5), `${state.currentBoss.currentHp}`);
  }

  // ❤️ 플레이어 기본 체력이 상수를 따르는가 (DECISIONS #87)
  resetBoard();
  BE.initBattle({ seed: 1 });
  check(S, `플레이어 기본 체력 = PLAYER_BASE_HP (${PLAYER_BASE_HP})`,
    state.playerMaxHp === PLAYER_BASE_HP && state.playerHp === PLAYER_BASE_HP,
    `${state.playerHp}/${state.playerMaxHp}`);
}

// ============================================================
// 11. 턴 사이클
// ============================================================
async function suiteTurnCycle() {
  const S = '턴 사이클';

  // 마나 성장 + 드로우 + 상태 감쇠
  resetBoard({ turnCount: 3, playerMana: 0, playerDeck: [card(), card(), card()], playerHand: [] });
  BE.startPlayerTurn();
  check(S, '턴 시작: 마나가 턴 수만큼 성장',
    state.turnCount === 4 && state.playerMana === 4 && state.playerMaxMana === 4,
    `t=${state.turnCount} mana=${state.playerMana}/${state.playerMaxMana}`);
  check(S, '턴 시작: 카드 1장 드로우', state.playerHand.length === 1, `${state.playerHand.length}`);

  // 마나 상한 10
  resetBoard({ turnCount: 14, playerDeck: [card()] });
  BE.startPlayerTurn();
  check(S, '마나 상한 10', state.playerMaxMana === 10, `${state.playerMaxMana}`);

  // 본체 지속 피해
  resetBoard({ turnCount: 3, playerHp: 50, playerDeck: [card()] });
  BE.__test.helpers().setSelfStatus('burn', 2, 6, true);   // bodyStatus 옵트인
  BE.startPlayerTurn();
  check(S, '턴 시작: 본체 지속 피해 적용 + 1턴 감쇠',
    state.playerHp === 44 &&
    (BE.getBattleStatusSnapshot().player.find(s => s.type === 'burn') || {}).turns === 1,
    `php=${state.playerHp} ${JSON.stringify(BE.getBattleStatusSnapshot().player)}`);

  // 무적/경감 턴 차감
  resetBoard({ turnCount: 3, playerDeck: [card()] });
  BE.__test.buffs().player.invulnerable = 2;
  BE.__test.buffs().player.damageReduction = 40;
  BE.__test.buffs().player.damageReductionTurns = 1;
  BE.startPlayerTurn();
  check(S, '턴 시작: 무적·경감 턴 차감',
    BE.__test.buffs().player.invulnerable === 1 &&
    BE.__test.buffs().player.damageReduction === 0 &&
    BE.__test.buffs().player.damageReductionTurns === 0,
    JSON.stringify(BE.__test.buffs().player));

  // 소환수 봉쇄 해제 사이클: 기절 2턴 → 두 턴 동안 못 움직인다
  resetBoard({ turnCount: 3, playerDeck: [card(), card(), card()],
    playerMinions: [minion({ name: '기절병', summonedTurn: 1, statuses: {} })] });
  applyStatus(state.playerMinions[0].statuses, 'stun', 2, 0);
  BE.startPlayerTurn();
  const t1 = state.playerMinions[0].canAttack;
  BE.startPlayerTurn();
  const t2 = state.playerMinions[0].canAttack;
  BE.startPlayerTurn();
  const t3 = state.playerMinions[0].canAttack;
  check(S, '기절 2턴 = 두 턴 봉쇄 후 해제',
    t1 === false && t2 === false && t3 === true, `${t1}/${t2}/${t3}`);

  // 건축물 턴 시작 패시브가 사이클에 끼어 있는가
  resetBoard({ turnCount: 3, playerMana: 0, playerDeck: [card()],
    playerMinions: [minion({ name: '수정탑', cardType: 'structure', currentHp: 20,
      skills: [{ passiveEffect: { manaPerTurn: 2 } }] })] });
  BE.startPlayerTurn();
  check(S, '턴 시작: 건축물 마나 패시브 (4+2)', state.playerMana === 6, `${state.playerMana}`);

  // 덱이 비면 리셔플
  resetBoard({ turnCount: 3, playerDeck: [], playerHand: [] });
  BE.startPlayerTurn();
  check(S, '덱이 비면 보관함에서 리셔플 (또는 안내)',
    state.playerHand.length >= 0, `hand=${state.playerHand.length}`);

  // 손패 상한 7
  resetBoard({ playerDeck: [card(), card()], playerHand: Array.from({ length: 7 }, () => card()) });
  BE.drawCards(2);
  check(S, '손패 상한 7', state.playerHand.length === 7, `${state.playerHand.length}`);

  // ── 상대 진영도 **같은** 턴 경계를 지난다 (DECISIONS #94)
  // 상대 건축물의 턴 종료 패시브 → 상대 방어막 (🐛 예전엔 인자를 안 받고 플레이어 전장만 돌았다)
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 },
    bossMinions: [minion({ name: '상대성벽', cardType: 'structure', skills: [{ passiveEffect: { endTurnShield: 7 } }] })] });
  BE.triggerStructureEndTurnPassives(BE.getSide('boss'));
  check(S, '상대 건축물 턴 종료 패시브 → 상대 방어막 +7', state.currentBoss.shield === 7, `${state.currentBoss.shield}`);

  // 상대 턴 시작: 버프·가시 감소, 드로우 정확히 1장, 본체 기절은 턴을 건너뛰지 않는다
  //   (덱 카드는 cost 9 — 낼 수 없어야 손패 수로 드로우를 잴 수 있다)
  resetBoard({ turnCount: 3, playerHp: 100,
    boss: { maxHp: 300, currentHp: 300, shield: 0, comboPatterns: [{ name: '검사', steps: [{ type: 'attack', name: '타격', value: 10 }] }] },
    bossHand: [], bossDeck: [card({ cost: 9 }), card({ cost: 9 }), card({ cost: 9 })] });
  BE.__test.buffs().boss.invulnerable = 1;
  BE.__test.buffs().boss.thorns = 0.3; BE.__test.buffs().boss.thornsTurns = 1;
  applyStatus(BE.__test.statuses().boss, 'stun', 1, 0);   // 본체에 직접 심어도 턴은 넘어가지 않아야 한다
  await BE.executeBossTurn({ handOff: false });
  check(S, '상대 턴 시작: 무적·가시 턴 감소 (예전: 상대 버프는 영구)',
    BE.__test.buffs().boss.invulnerable === 0 && BE.__test.buffs().boss.thorns === 0, JSON.stringify(BE.__test.buffs().boss));
  check(S, '상대 턴 시작: 드로우 정확히 1장 (예전: 낸 카드 수만큼)', state.bossHand.length === 1, `${state.bossHand.length}`);
  check(S, '상대 턴 시작: 마나 = 턴 수, 리더가 아니라 turnCount는 그대로',
    state.bossMana === 3 && state.turnCount === 3, `mana=${state.bossMana} t=${state.turnCount}`);
  check(S, '본체 기절은 상대 턴을 건너뛰지 않는다 (양쪽 불가)', state.playerHp < 100, `php=${state.playerHp}`);

  // 본체 봉쇄는 bodyStatus로도 걸리지 않는다 — 소환수가 없으면 불발
  resetBoard({ bossMinions: [] });
  const gate = BE.__test.helpers('player').setFoeStatus('stun', 1, 0, true);
  check(S, '본체 기절은 bodyStatus로도 걸리지 않는다 (예전: 보스 본체만 가능)',
    gate === null && !BE.getBattleStatusSnapshot().boss.some(s => s.type === 'stun'),
    JSON.stringify(BE.getBattleStatusSnapshot().boss));

  // PvP 게스트: 호스트가 라운드 리더 — 호스트 endTurn 전엔 행동 불가, 첫 턴은 턴 1·마나 1
  //   (🐛 예전엔 initBattle이 양 클라이언트를 "내 턴"으로 시작시켰고 게스트 첫 턴이 턴 2였다)
  {
    const dummy = { sendAction() {} };
    try {
      attachPvpSession(dummy, { foeName: '검증상대', isHost: false });
      BE.initBattle({ seed: 7, leader: 'boss' });
      state.playerHand = [card({ cost: 0 })]; state.playerMana = 1;
      BE.playCard(0);
      const acted = state.playerHand.length === 0;
      await handleRemoteAction({ kind: 'endTurn' });
      check(S, 'PvP 게스트: 호스트 endTurn 전엔 카드를 못 낸다 (예전: 양쪽 다 자기 턴)', acted === false, `acted=${acted}`);
      check(S, 'PvP 게스트: 첫 턴은 턴 1·마나 1 (예전: 턴 2·마나 2)',
        state.turnCount === 1 && state.playerMana === 1, `t=${state.turnCount} mana=${state.playerMana}`);
    } finally {
      detachPvpSession();
    }
  }
}

// ============================================================
// 12. PvP 거울 경로
// ============================================================
async function suitePvpMirror() {
  const S = 'PvP 거울';

  // 상대 주문이 나에게 온다 (예전에는 picked ReferenceError로 전부 죽었다)
  resetBoard({ playerMinions: [], playerHp: 50 });
  await BE.playFoeCardPvp(card({ name: '상대주문', cardType: 'spell', skills: [{ damage: 18, targetScope: 'all' }] }));
  check(S, '상대 주문이 내 본체에 적용된다', state.playerHp === 32, `${state.playerHp}`);

  // 상대 주문의 방어막은 상대(보스 슬롯)에게 붙는다
  resetBoard({ boss: { maxHp: 300, currentHp: 300, shield: 0 } });
  await BE.playFoeCardPvp(card({ name: '상대가호', cardType: 'spell', skills: [{ shield: 20 }] }));
  check(S, '상대 방어막은 상대에게 붙는다',
    state.currentBoss.shield === 20 && state.playerMaxShield === 0,
    `boss=${state.currentBoss.shield} me=${state.playerMaxShield}`);

  // 상대 치유는 상대 본체를 회복시킨다
  resetBoard({ boss: { maxHp: 300, currentHp: 100, shield: 0 }, playerHp: 30 });
  await BE.playFoeCardPvp(card({ name: '상대치유', cardType: 'spell', skills: [{ heal: 25 }] }));
  check(S, '상대 치유는 상대 본체를 회복',
    state.currentBoss.currentHp === 125 && state.playerHp === 30,
    `boss=${state.currentBoss.currentHp} me=${state.playerHp}`);

  // 상대가 지정한 대상이 그대로 재생되는가
  resetBoard({ playerMinions: [minion({ name: '내A', currentHp: 30 }), minion({ name: '내B', currentHp: 30 })] });
  await BE.playFoeCardPvp(card({ name: '저격', cardType: 'spell', skills: [{ damage: 12 }] }), null, ['foe:1']);
  check(S, '상대가 고른 대상(foe:1)이 내 1번 소환수에 적용',
    state.playerMinions[0].currentHp === 30 && state.playerMinions[1].currentHp === 18,
    `${state.playerMinions.map(m => m.currentHp)}`);

  // 상대 소환수 배치 + 슬롯 재현
  resetBoard({ bossMinions: [minion({ name: '기존' })] });
  await BE.playFoeCardPvp(card({ name: '상대병', cardType: 'unit', hp: 20, skills: [{}] }), 0);
  check(S, '상대 소환수: 지정 슬롯(0)에 배치',
    state.bossMinions[0].name === '상대병' &&
    state.bossMinions[0].canAttack === false,
    state.bossMinions.map(m => m.name).join(','));

  // 상대 함정은 뒷면 세트
  resetBoard();
  await BE.playFoeCardPvp(card({ name: '상대함정', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 5 }] }));
  check(S, '상대 함정: 상대 구역에 세트',
    BE.getTrapZone('boss').length === 1 && state.bossMinions.length === 0);

  // 거울 game이 모든 필드를 뒤집는가 — 연계가 실제로 돈다
  resetBoard({ turnCount: 6, bossMinions: [], bossHand: [], bossDeck: [card({ themeId: 'th-test', themeName: '검증군' })] });
  state.archetypesList = [themeOf({ comboAction: 'specialSummon', comboTrigger: 'lateGame', comboScaling: 'perTurn' })];
  await BE.playFoeCardPvp(card({ name: '상대연계', cardType: 'spell', themeId: 'th-test', themeName: '검증군',
    skills: [{ damage: 1, targetScope: 'all' }] }));
  check(S, '거울 연계: 상대 특수소환이 상대 전장에 나온다',
    state.bossMinions.length === 1 && state.playerMinions.length === 0,
    `상대=${state.bossMinions.length} 나=${state.playerMinions.length}`);
  state.archetypesList = [];
}

// ============================================================
// 13. 함정 통합 (실제 이벤트로 발동)
// ============================================================
function suiteTrapIntegration() {
  const S = '함정 통합';

  // 내 함정이 상대 카드에 반응해 상대를 때린다
  resetBoard({ playerMinions: [] });
  BE.__test.setTrap('player', card({ name: '기습', cardType: 'trap', trapTrigger: 'foePlaysUnit', skills: [{ damage: 12, targetScope: 'all' }] }));
  BE.__test.fireTraps('boss', 'playCard', card({ cardType: 'unit' }));
  check(S, '내 함정이 상대 소환에 반응해 상대에게 피해',
    state.currentBoss.currentHp === 288 && BE.getTrapZone('player').length === 0,
    `boss=${state.currentBoss.currentHp} zone=${BE.getTrapZone('player').length}`);

  // 내 행동에는 내 함정이 반응하지 않는다
  resetBoard();
  BE.__test.setTrap('player', card({ name: '기습', cardType: 'trap', trapTrigger: 'foePlaysUnit', skills: [{ damage: 12 }] }));
  BE.__test.fireTraps('player', 'playCard', card({ cardType: 'unit' }));
  check(S, '내 함정은 내 행동에 반응하지 않는다',
    BE.getTrapZone('player').length === 1 && state.currentBoss.currentHp === 300);

  // 보스 함정이 나를 때린다
  resetBoard({ playerHp: 50 });
  BE.__test.setTrap('boss', card({ name: '보스함정', cardType: 'trap', trapTrigger: 'foePlaysSpell', skills: [{ damage: 14 }] }));
  BE.__test.fireTraps('player', 'playCard', card({ cardType: 'spell' }));
  check(S, '보스 함정이 내 본체를 때린다',
    state.playerHp === 36 && BE.getTrapZone('boss').length === 0, `php=${state.playerHp}`);

  // 보스 함정의 방어막/치유는 보스에게 붙는다
  resetBoard({ boss: { maxHp: 300, currentHp: 200, shield: 0 } });
  BE.__test.setTrap('boss', card({ name: '보스가호', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ shield: 15, heal: 20 }] }));
  BE.__test.fireTraps('player', 'attack', minion());
  check(S, '보스 함정의 방어막·치유는 보스에게',
    state.currentBoss.shield === 15 && state.currentBoss.currentHp === 220,
    `sh=${state.currentBoss.shield} hp=${state.currentBoss.currentHp}`);

  // 실전 경로: 내가 공격하면 보스 함정이 터진다
  resetBoard({ playerMinions: [minion({ name: '내병사', attack: 10 })], bossMinions: [], playerHp: 50 });
  BE.__test.setTrap('boss', card({ name: '반격', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 9 }] }));
  BE.resolveMinionAttack(0, 'face');
  check(S, '공격 이벤트로 상대 함정이 터진다',
    state.playerHp === 41 && state.currentBoss.currentHp === 290,
    `php=${state.playerHp} boss=${state.currentBoss.currentHp}`);

  // 실전 경로: 상대가 공격해도 내 함정이 터진다
  resetBoard({ playerMinions: [], playerHp: 50 });
  BE.__test.setTrap('player', card({ name: '반격', cardType: 'trap', trapTrigger: 'foeAttacks', skills: [{ damage: 9, targetScope: 'all' }] }));
  BE.foeMinionAttack(0, minion({ attack: 10 }), 'face');
  check(S, '상대 공격에 내 함정이 터진다',
    state.currentBoss.currentHp === 291 && state.playerHp === 40,
    `boss=${state.currentBoss.currentHp} php=${state.playerHp}`);

  // 방어막 이벤트
  //  ⚠️ 함정: 방금 얻은 방어막이 함정 피해를 흡수한다. 체력으로 재면
  //     "발동 안 함"으로 오판한다 (실제로 한 번 오판했다).
  //     방어막 잔량과 함정 소모로 확인한다.
  resetBoard();
  BE.__test.setTrap('boss', card({ name: '파쇄', cardType: 'trap', trapTrigger: 'foeShielded', skills: [{ damage: 7 }] }));
  const c = card({ name: '가호', cardType: 'spell', skills: [{ shield: 10 }] });
  applyPlayerSkillEffects(c.skills[0], { card: c, game: state, helpers: BE.__test.helpers() }, { sourceLabel: '주문' });
  check(S, '방어막을 두르면 상대 함정이 반응 (방어막 10→3이 흡수)',
    state.playerMaxShield === 3 && state.playerHp === 50 && BE.getTrapZone('boss').length === 0,
    `sh=${state.playerMaxShield} php=${state.playerHp} zone=${BE.getTrapZone('boss').length}`);

  // 체력 절반 이벤트
  resetBoard({ playerMinions: [], playerHp: 50, playerMaxHp: 50 });
  BE.__test.setTrap('player', card({ name: '위기', cardType: 'trap', trapTrigger: 'selfLowHp', skills: [{ shield: 20 }] }));
  BE.foeMinionAttack(0, minion({ attack: 30 }), 'face');
  check(S, '체력이 절반 아래로 떨어지면 내 함정 발동',
    state.playerMaxShield === 20 && BE.getTrapZone('player').length === 0,
    `sh=${state.playerMaxShield} php=${state.playerHp}`);

  // 함정 연쇄는 한 단계에서 끊긴다
  resetBoard({ playerMinions: [] });
  BE.__test.setTrap('player', card({ name: '1번', cardType: 'trap', trapTrigger: 'foePlaysUnit', skills: [{ damage: 1, targetScope: 'all' }] }));
  BE.__test.setTrap('boss', card({ name: '2번', cardType: 'trap', trapTrigger: 'foeTrapActivates', skills: [{ damage: 1 }] }));
  BE.__test.fireTraps('boss', 'playCard', card({ cardType: 'unit' }));
  check(S, '함정 연쇄는 한 단계만 전파 (무한 루프 없음)',
    BE.getTrapZone('player').length === 0 && BE.getTrapZone('boss').length === 0 &&
    state.playerHp === 49 && state.currentBoss.currentHp === 299,
    `php=${state.playerHp} boss=${state.currentBoss.currentHp}`);
}

// ============================================================
// 14. 키워드 표시 — 규칙을 바꾸는 키워드가 카드에 보이는가
// ============================================================
function suiteKeywordDisplay() {
  const S = '키워드 표시';

  // 뱃지: 표시되는 키워드가 실제 효과 키를 빠짐없이 덮는가
  const cases = [
    ['multiHit', { multiHit: 3 }, '연타'],
    ['lifesteal', { lifestealPercent: 0.5 }, '흡혈'],
    ['pierceShield', { pierceShield: true }, '실드관통'],
    ['crit', { critChance: 0.3 }, '크리'],
    ['drawCards', { drawCards: 2 }, '드로우'],
    ['manaGain', { manaGain: 2 }, '마나'],
    ['doubleCast', { doubleCastNext: true }, '더블캐스트'],
    ['invulnerable', { invulnerableTurns: 2 }, '무적'],
    ['execute', { executeThreshold: 0.3 }, '처형'],
    ['spell', { isAoeSpell: true }, '광역'],
    ['structure', { passiveEffect: { endTurnShield: 5 } }, '패시브'],
    ['directAttack', { directAttack: true }, '직접 공격'],
    ['stun', { statusEffect: { type: 'stun', duration: 1 } }, '기절'],
    ['freeze', { statusEffect: { type: 'freeze', duration: 1 } }, '빙결'],
    ['burn', { statusEffect: { type: 'burn', duration: 2, value: 6 } }, '화상'],
    ['poison', { statusEffect: { type: 'poison', duration: 2, value: 8 } }, '맹독'],
    ['shock', { statusEffect: { type: 'shock', duration: 2 } }, '감전'],
    ['vulnerable', { statusEffect: { type: 'vulnerable', duration: 2 } }, '받피증']
  ];
  for (const [key, skill, text] of cases) {
    const html = getSkillBadgesHtml(skill);
    check(S, `뱃지 ${key}`, html.includes(text) && html.includes(`'${key}'`),
      html.slice(0, 120));
  }

  // 뱃지를 누르면 뜨는 설명이 존재하는가 (없으면 빈 팝업이 뜬다)
  const missing = cases.map(([k]) => k).filter(k => !KEYWORD_DEFINITIONS[k]);
  check(S, '모든 뱃지 키워드에 설명이 있다', missing.length === 0, `누락: ${missing.join(',')}`);

  check(S, 'readDirectAttack 단일 소스',
    readDirectAttack({ directAttack: true }) && readDirectAttack({ skills: [{ directAttack: true }] }) &&
    !readDirectAttack({ skills: [{}] }));
  check(S, '엔진이 재수출하는 함수가 같은 구현',
    BE.readDirectAttack === readDirectAttack);

  // 🗑️ 도발이 게임 어디에도 남아 있지 않은가 (DECISIONS #84)
  check(S, '도발 뱃지가 더 이상 만들어지지 않는다',
    !getSkillBadgesHtml({ taunt: true }).includes('도발'), getSkillBadgesHtml({ taunt: true }));
  check(S, '키워드 사전에 도발 항목이 없다', !KEYWORD_DEFINITIONS.taunt);
  check(S, '전장 차단 규칙이 키워드 사전에 있다', !!KEYWORD_DEFINITIONS.fieldBlock);

  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  attachCardDetail(anchor, card({ name: '옛벽카드', taunt: true, skills: [{ taunt: true, description: '설명' }] }));
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  const panelHtml = (document.getElementById('card-detail-popover') || {}).innerHTML || '';
  hideCardDetail();
  anchor.remove();
  check(S, '상세 팝업에도 도발이 뜨지 않는다', !panelHtml.includes('도발'), panelHtml.slice(0, 160));

  // 설명문 생성기가 도발을 쓰지 않는가
  check(S, 'describeSkillFromData가 도발을 적지 않는다',
    !String(describeSkillFromData({ taunt: true, damage: 10 }, 'unit') || '').includes('도발'),
    String(describeSkillFromData({ taunt: true, damage: 10 }, 'unit')));

  // 🚫 거짓말 관문의 **오탐**을 잡는다 (DECISIONS #90)
  //
  //    🐛 처음 패턴은 낱말만 봤다(`damage: /피해|데미지/`). 그래서
  //       **엔진이 스스로 만든 정답 문장까지** 거짓말로 판정하고 갈아치웠다:
  //         "받는 피해가 30% 감소합니다."     → damage가 없다고 반려
  //         "적 1체에게 16 피해 · 방어막 관통" → shield가 없다고 반려
  //         "턴 종료 시 본체 방어막 +8"        → shield가 없다고 반려(패시브에 있다)
  //    ⚠️ 관문을 고칠 때는 **오탐과 놓침을 함께** 재세요. 한쪽만 보면
  //       패턴을 조이다 진짜 거짓말을 놓치거나, 풀다 정답을 죽입니다.
  {
    const 정답 = [
      ['피해경감', { damageReduction: 30, reductionTurns: 2 }, 'spell'],
      ['관통+피해', { damage: 16, pierceShield: true }, 'spell'],
      ['흡혈', { damage: 12, lifestealPercent: 0.5 }, 'spell'],
      ['소환수치유', { heal: 10, hpTarget: 'minion' }, 'unit'],
      ['최대체력', { maxHpGain: 8 }, 'spell'],
      ['방어막', { shield: 12 }, 'spell'],
      ['파괴', { destroy: 1 }, 'spell'],
      ['토큰소환', { summonToken: 2 }, 'spell'],
      ['서치', { searchDeck: 2 }, 'spell'],
      ['상태이상', { statusEffect: { type: 'burn', duration: 2, value: 6 } }, 'spell'],
      ['기물2체', { damage: 18, targetScope: 'multi', targetCount: 2, damageTarget: 'field' }, 'spell'],
      ['본체직격', { damage: 20, damageTarget: 'body' }, 'spell'],
      ['드로우+마나', { drawCards: 2, manaGain: 1 }, 'spell'],
      ['연타', { damage: 8, multiHit: 3 }, 'spell'],
      ['무효화', { silence: true }, 'spell'],
      ['약화', { attackDown: 4 }, 'spell'],
      ['무적', { invulnerableTurns: 2 }, 'spell'],
      ['더블캐스트', { doubleCastNext: true }, 'spell'],
      ['처형', { damage: 14, executeThreshold: 0.3 }, 'spell'],
      ['치명타', { damage: 12, critChance: 0.3 }, 'spell'],
      ['광역', { damage: 14, isAoeSpell: true, targetScope: 'all' }, 'spell'],
      ['건축물방어막', { passiveEffect: { endTurnShield: 8 } }, 'structure'],
      ['건축물마나', { passiveEffect: { manaPerTurn: 1 } }, 'structure'],
      ['건축물회복', { passiveEffect: { endTurnAoeHeal: 5 } }, 'structure'],
      ['오라방어', { passiveEffect: { aura: { scope: 'all', defenseBonus: 3 } } }, 'structure'],
      ['오라경감', { passiveEffect: { aura: { scope: 'all', damageReduction: 20 } } }, 'structure']
    ];
    // ⚠️ **관문이 발동했는지만** 본다. 문장 비교로 하면 등급 보정·수치 동기화
    //    같은 정상 변환까지 실패로 잡힌다 (실제로 그렇게 헛짚었다).
    //    관문은 console.warn을 남기므로 그걸 가로챈다.
    const 오탐 = [];
    const ow = console.warn;
    for (const [라벨, skill, type] of 정답) {
      let 발동 = false;
      console.warn = (...a) => { if (String(a[0] || '').includes('설명문이 카드와 달라')) 발동 = true; };
      sanitizeAndClampCardData({
        name: 라벨, cardType: type, rarity: 'legendary', cost: 8,
        attack: 0, defense: type === 'structure' ? 8 : 0, hp: type === 'structure' ? 30 : 0,
        skills: [{ name: '효과', ...skill, description: describeSkillFromData(skill, type) }]
      });
      console.warn = ow;
      if (발동) 오탐.push(라벨);
    }
    console.warn = ow;
    check(S, `거짓말 관문 오탐 0 (엔진이 만든 정답 문장 ${정답.length}개)`,
      오탐.length === 0, `오탐: ${오탐.join(', ')}`);
  }

  // 📜 규칙 텍스트는 **언제나 데이터에서 만들어진다** (DECISIONS #91)
  //
  //    이전 구조에서는 LLM 산문을 규칙 텍스트로 쓰고 정규식으로 수리했다.
  //    이제 산문이 무엇이든 규칙 텍스트는 describeSkillFromData의 결과여야 한다 —
  //    거짓말이 **구조적으로 불가능**하다.
  {
    const 산문들 = [
      ['거짓말(부활)', '쓰러진 아군을 부활시킨다.'],
      ['거짓말(강탈)', '상대 카드를 훔친다.'],
      ['없는 드로우', '손패에서 1장을 드로우한다.'],
      ['없는 파괴', '소환수 1체를 제거하고 공격한다.'],
      ['없는 방어막', '12 피해를 주고 방어막 8을 얻는다.'],
      ['과장 수치', '200 피해를 입힌다.'],
      ['빈 문장', ''],
      ['정직한 문장', '적 1체에게 14 피해.']
    ];
    const 불일치 = [];
    for (const [라벨, desc] of 산문들) {
      const out = sanitizeAndClampCardData({
        name: '검증', cardType: 'unit', rarity: 'rare', cost: 3, attack: 10, defense: 4, hp: 24,
        skills: [{ name: '효과', damage: 14, description: desc }]
      });
      const 기대 = describeSkillFromData(out.skills[0], 'unit');
      if (out.skills[0].description !== 기대) 불일치.push(`${라벨}: "${out.skills[0].description}" ≠ "${기대}"`);
    }
    check(S, `규칙 텍스트는 산문과 무관하게 데이터에서 생성된다 (${산문들.length}종)`,
      불일치.length === 0, 불일치.join(' | '));
  }

  // 🃏 플레이버는 규칙 텍스트를 흉내 내면 버려진다
  {
    const 통과 = ['그림자는 주인을 묻지 않는다.', '불꽃은 약속을 기억하지 못한다.'];
    const 폐기 = [
      '적에게 18 피해를 입힌다.',      // 숫자 + 기능 어휘
      '방어막을 얻고 카드를 뽑는다.',   // 기능 어휘
      '매 턴 마나를 공급한다.',        // 기능 어휘
      ''                              // 빈 문장
    ];
    const 오탐 = 통과.filter(t => validateFlavor(t) !== null);
    const 놓침 = 폐기.filter(t => validateFlavor(t) === null);
    check(S, '플레이버 검증: 분위기 문장은 통과', 오탐.length === 0, 오탐.join(' | '));
    check(S, '플레이버 검증: 효과 서술은 폐기', 놓침.length === 0, 놓침.join(' | '));
  }

  // 🃏 효과가 있는 카드의 플레이버가 규칙 텍스트를 덮지 않는다
  {
    const out = sanitizeAndClampCardData({
      name: '검증', cardType: 'unit', rarity: 'rare', cost: 3, attack: 10, defense: 4, hp: 24,
      skills: [{ name: '효과', damage: 14, flavorText: '그림자는 주인을 묻지 않는다.' }]
    });
    check(S, '플레이버가 있어도 규칙 텍스트는 데이터에서 나온다',
      out.skills[0].description === describeSkillFromData(out.skills[0], 'unit') &&
      out.skills[0].flavorText === '그림자는 주인을 묻지 않는다.',
      `규칙="${out.skills[0].description}" 플레이버="${out.skills[0].flavorText}"`);

    // 수치를 주장하는 플레이버는 저장 단계에서 떨어진다
    const bad = sanitizeAndClampCardData({
      name: '검증', cardType: 'unit', rarity: 'rare', cost: 3, attack: 10, defense: 4, hp: 24,
      skills: [{ name: '효과', damage: 14, flavorText: '적에게 18 피해를 입힌다.' }]
    });
    check(S, '수치를 주장하는 플레이버는 버려진다', !bad.skills[0].flavorText,
      String(bad.skills[0].flavorText));
  }


  // ♻️ sanitize는 **멱등**해야 한다 (DECISIONS #89)
  //    카드 연성은 기획 때 한 번, 이미지 생성/저장 때 한 번 총 **두 번** 돌린다.
  //    멱등하지 않으면 유저가 확인한 카드가 저장 시점에 조용히 달라진다.
  {
    const 원안들 = [
      ['예산 초과 소환수', { name: 'A', cardType: 'unit', rarity: 'epic', cost: 4, costLocked: true,
        attack: 16, defense: 6, hp: 30,
        skills: [{ name: '효과', damage: 18, multiHit: 2, drawCards: 1, shield: 10, description: '피해와 방어막.' }] }],
      ['예산 초과 주문', { name: 'B', cardType: 'spell', rarity: 'rare', cost: 2,
        skills: [{ name: '효과', damage: 20, heal: 12, drawCards: 2, description: '피해와 회복.' }] }],
      ['건축물', { name: 'C', cardType: 'structure', rarity: 'epic', cost: 3, attack: 0, defense: 10, hp: 34,
        skills: [{ name: '효과', passiveEffect: { endTurnShield: 8, manaPerTurn: 1 }, description: '패시브.' }] }],
      ['함정', { name: 'D', cardType: 'trap', rarity: 'rare', cost: 2,
        skills: [{ name: '효과', damage: 14, trapTrigger: 'foeAttacks', description: '반격.' }] }],
      ['여유 있는 카드', { name: 'E', cardType: 'unit', rarity: 'common', cost: 3, attack: 8, defense: 2, hp: 20,
        skills: [{ name: '효과', damage: 6, description: '적 1체에게 6 피해.' }] }]
    ];
    const 지문 = (c) => {
      const s = (c.skills && c.skills[0]) || {};
      return JSON.stringify({ cost: c.cost, a: c.attack, d: c.defense, h: c.hp,
        skill: Object.keys(s).sort().reduce((o, k) => (o[k] = s[k], o), {}) });
    };
    for (const [라벨, 원안] of 원안들) {
      const 일차 = sanitizeAndClampCardData(원안);
      const 이차 = sanitizeAndClampCardData(일차);
      const 삼차 = sanitizeAndClampCardData(이차);
      check(S, `sanitize 멱등: ${라벨}`,
        지문(일차) === 지문(이차) && 지문(이차) === 지문(삼차),
        `1차 ${지문(일차)}\n2차 ${지문(이차)}`);
    }
  }

  // sanitize가 기존 카드의 죽은 taunt 필드를 지우는가
  const old = sanitizeAndClampCardData({
    name: '옛카드', cardType: 'unit', rarity: 'rare', cost: 3, attack: 10, defense: 4, hp: 24,
    taunt: true, skills: [{ name: '효과', damage: 8, taunt: true, description: '8 피해' }]
  });
  const oldSkill = (old.skills && old.skills[0]) || {};
  check(S, 'sanitize가 taunt 필드를 지운다',
    oldSkill.taunt === undefined && old.taunt === undefined,
    JSON.stringify({ card: old.taunt, skill: oldSkill.taunt }));
}

// ============================================================
// 15. 음성 통제 — 하네스가 정말 실패를 잡아내는가
// ============================================================
function suiteNegativeControl() {
  const S = '음성 통제';
  // 일부러 틀린 기대값을 넣어 check()가 실패를 보고하는지 본다.
  const before = results.length;
  check('__probe', '고의 실패', 1 === 2);
  const caught = results[results.length - 1].pass === false;
  results.splice(before, 1);   // 집계에서 제거
  check(S, 'check()가 실패를 실제로 잡는다', caught);

  // 규칙을 우회하면 결과가 달라지는지 (검사가 대상 코드를 실제로 지나는가)
  resetBoard({ playerMinions: [minion({ attack: 10 })], bossMinions: [minion({ name: '벽', currentHp: 40 })] });
  BE.resolveMinionAttack(0, 'face');
  const blocked = state.currentBoss.currentHp === 300;
  resetBoard({ playerMinions: [minion({ attack: 10 })], bossMinions: [] });
  BE.resolveMinionAttack(0, 'face');
  const through = state.currentBoss.currentHp === 290;
  check(S, '같은 호출이 전장 유무에 따라 다른 결과를 낸다', blocked && through,
    `막힘=${blocked} 통과=${through}`);
}

// ============================================================
export async function runAll() {
  // 🎭 로컬 플레이버 팩이 켜져 있으면 **끄고** 돌린다 — 이 하네스는 표시 문구("적 1체에게 12 피해")를 단언하고,
  //    규칙·수치는 팩과 무관하다. 팩이 없으면 아무 일도 하지 않는다 (DECISIONS #103).
  return withFlavorDisabled(runAllSuites);
}

async function runAllSuites() {
  results = [];
  const suites = [
    ['공격 규칙', suiteAttack], ['효과 대상', suiteTargets], ['카드 효과', suiteEffects],
    ['상태이상', suiteStatus], ['함정', suiteTraps], ['연계', suiteCombos],
    ['건축물', suiteStructures], ['시전 규칙', suitePlayRules],
    ['시전 통합', suitePlayCard], ['진영 대칭', suiteSides], ['본체 피해', suiteFaceDamage],
    ['공격 대칭', suiteAttackSymmetry], ['전투 반격', suiteRetaliation], ['시전 대칭', suiteCastSymmetry], ['봇 컨트롤러', suiteBotController],
    ['대전 초기화', suitePvpInit], ['보스 카드 예산', suiteBossBudget], ['약화·연쇄', suiteWeakenChain], ['사이클', suiteStatusCycles],
    ['보스 턴', suiteBossTurn], ['턴 사이클', suiteTurnCycle],
    ['PvP 거울', suitePvpMirror], ['함정 통합', suiteTrapIntegration],
    ['키워드 표시', suiteKeywordDisplay], ['음성 통제', suiteNegativeControl]
  ];
  for (const [name, fn] of suites) {
    try { await fn(); }
    catch (e) { check(name, '스위트 실행', false, `예외: ${e.message}\n${e.stack}`); }
  }
  const fails = results.filter(r => !r.pass);
  const bySuite = {};
  for (const r of results) {
    bySuite[r.suite] = bySuite[r.suite] || { pass: 0, fail: 0 };
    bySuite[r.suite][r.pass ? 'pass' : 'fail']++;
  }
  return {
    총계: `${results.length - fails.length}/${results.length} 통과`,
    스위트별: bySuite,
    실패: fails.map(f => `[${f.suite}] ${f.name}${f.detail ? ' :: ' + f.detail : ''}`)
  };
}
