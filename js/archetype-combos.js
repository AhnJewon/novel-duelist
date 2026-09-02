// archetype-combos.js - 카드군(Archetype) 콤보 액션 정의 테이블
//
// 이전에는 triggerArchetypeCombo / triggerBossArchetypeCombo 두 함수가
// 각각 8개의 if 분기를 통째로 들고 있었고(약 280줄), 액션 별칭 검사
// (action === 'search' || action === 'hero_search')가 16번 반복됐다.
// 액션 하나를 추가하려면 두 함수를 모두 고쳐야 했다.
// 여기서는 액션 1개 = 엔트리 1개로 정의하고, player/boss 구현만 나란히 둔다.
//
// ⚠️ 설계 원칙: **콤보 하나는 효과 하나만 한다.**
//    예전에는 draw 콤보가 '드로우 + 실드 관통'을, shieldHeal이 '무적 + 방어막'을
//    한꺼번에 했다. 매 턴 카드를 낼 때마다 터지는 효과에 무적·관통 같은 프리미엄
//    키워드를 얹으면 밸런스를 잡을 수 없고 카드군의 정체성도 흐려진다.
//    위력 조절은 '전개 수 비례'로만 한다 (chainDamage 참고).

import { applyStatus } from './status-effects.js';
import { escapeHtml } from './dom-utils.js';
import { checkTrigger, applyScaling, matchesScope, scopeAdjustedBase, describeScope } from './archetype-identity.js';

// 기본 테마가 쓰던 예전 액션명 -> 정규 액션명
export const COMBO_ACTION_ALIASES = {
  hero_search: 'search',
  crystal_resonance: 'manaCharge',
  crimson_chain: 'chainDamage',
  frost_freeze: 'freeze',
  thunder_overcharge: 'doubleCast',
  sanctuary_barrier: 'shieldHeal',
  abyssal_salvage: 'draw',
  worldtree_growth: 'specialSummon'
};

// 콤보 로그 카드 (색상만 다르고 구조가 같아 반복되던 HTML)
const LOG_TONES = {
  amber: ['bg-amber-950/90 border-amber-500 text-amber-200', 'text-amber-300'],
  cyan: ['bg-cyan-950/90 border-cyan-400 text-cyan-200', 'text-cyan-300'],
  red: ['bg-red-950/90 border-red-500 text-red-200', 'text-red-400'],
  blue: ['bg-blue-950/90 border-cyan-400 text-cyan-200', 'text-cyan-300'],
  yellow: ['bg-yellow-950/90 border-yellow-400 text-yellow-200', 'text-yellow-300'],
  purple: ['bg-purple-950/90 border-purple-500 text-purple-200', 'text-purple-300'],
  emerald: ['bg-emerald-950/90 border-emerald-500 text-emerald-200', 'text-emerald-300']
};

/**
 * 로그에서 "상대"를 뭐라고 부를지.
 *
 * PvE는 늘 "보스"였지만 PvP에서는 사람이다. 게다가 상대 카드를 내 화면에서
 * 거울로 재생할 때는 **피해를 받는 쪽이 나**라서 "보스를 동결시켰습니다"가
 * 정반대로 읽힌다. 그래서 호출부가 라벨을 넘기게 했다.
 */
function foeLabel(helpers) {
  return (helpers && helpers.foeLabel) || '보스';
}

function comboLog(tone, badge, body) {
  const [boxCls, badgeCls] = LOG_TONES[tone] || LOG_TONES.amber;
  return `
    <div class="p-1.5 rounded-lg ${boxCls} border text-xs shadow-md my-1">
      <span class="font-black ${badgeCls}">${badge}</span> ${body}
    </div>
  `;
}

// 카드가 이 카드군에 속하는지 (id / 이름 / 이름 속 키워드)
/**
 * 카드가 이 카드군의 **연계 대상**인가.
 *
 * 판정 기준은 theme.comboScope가 정한다:
 *   archetype(기본) — 같은 카드군만
 *   element        — 같은 속성이면 카드군이 달라도 OK  (속성 덱)
 *   cardType       — 같은 카드 타입이면 OK             (타입 덱)
 *   any            — 아무 카드나 OK                    (범용 덱)
 */
export function belongsToTheme(card, theme) {
  return matchesScope(card, theme);
}

export const ARCHETYPE_COMBO_ACTIONS = {
  // 덱에서 같은 카드군 카드를 패로 서치 — 그것만 한다.
  search: {
    label: '덱 서치', tier: 2,
    player({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (game.playerHand.length >= 7) return null;
      const idx = (game.playerDeck || []).findIndex(c => belongsToTheme(c, theme));
      if (idx === -1) return null;

      const searched = game.playerDeck.splice(idx, 1)[0];
      game.playerHand.push(searched);
      addBattleLog(comboLog('amber', `⚜️ [${escapeHtml(theme.name)} 덱 서치]`,
        `덱에서 <b>[${escapeHtml(searched.name)}]</b> 카드를 패로 가져왔습니다.`));
      audio.playDraw();
      return { name: `${theme.name} 덱 서치`, triggered: true };
    },
    boss({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (!game.bossDeck || !game.bossHand || game.bossHand.length >= 5) return null;
      const idx = game.bossDeck.findIndex(c => belongsToTheme(c, theme));
      if (idx === -1) return null;

      const searched = game.bossDeck.splice(idx, 1)[0];
      game.bossHand.push(searched);
      addBattleLog(comboLog('red', `👹 [보스 ${escapeHtml(theme.name)} 덱 서치]`,
        `${foeLabel(helpers)}이(가) 덱에서 <b>[${escapeHtml(searched.name)}]</b> 카드를 가져왔습니다.`));
      audio.playDraw();
      return { name: `보스 ${theme.name} 서치`, triggered: true };
    }
  },

  // 마나 충전 — 그것만 한다.
  manaCharge: {
    label: '마력 공명', tier: 1,
    player({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (game.playerMana >= game.playerMaxMana) return null;
      game.playerMana = Math.min(game.playerMaxMana, game.playerMana + 1);
      audio.playShield();
      addBattleLog(comboLog('cyan', `💎 [${escapeHtml(theme.name)} 마력 공명]`, '마나 +1 충전.'));
      return { name: `${theme.name} 마력 공명`, triggered: true };
    },
    // 보스는 마나를 쓰지 않는다(foeVirtualMana). 같은 자리를 방어막이 대신한다.
    boss({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const amount = scale(10);
      game.currentBoss.shield = (game.currentBoss.shield || 0) + amount;
      audio.playShield();
      addBattleLog(comboLog('cyan', `💎 [보스 ${escapeHtml(theme.name)} 마력 공명]`, `보스 방어막 +${amount}.`));
      return { name: `보스 ${theme.name} 마력 공명`, triggered: true };
    }
  },

  // 연계 피해 — 위력 증가 방식은 카드군마다 다르다
  chainDamage: {
    label: '연쇄 폭격', tier: 1,
    player({ theme, game, helpers, allies, scale }) {
      const { addBattleLog, audio, dealDamageToBoss } = helpers;
      const dmg = scale(6);
      dealDamageToBoss(dmg, `${theme.name} 연계`);
      audio.playSlash();
      addBattleLog(comboLog('red', `🔥 [${escapeHtml(theme.name)} 연쇄]`,
        `${foeLabel(helpers)}에게 ${dmg} 연계 피해. (같은 카드군 전개 ${allies + 1}장)`));
      return { name: `${theme.name} 연쇄`, triggered: true };
    },
    boss({ theme, helpers, allies, scale }) {
      const { addBattleLog, audio, applyDirectDamageToPlayer } = helpers;
      const dmg = scale(6);
      applyDirectDamageToPlayer(dmg);
      audio.playSlash();
      addBattleLog(comboLog('red', `🔥 [보스 ${escapeHtml(theme.name)} 연쇄]`,
        `플레이어에게 ${dmg} 연계 피해. (같은 카드군 전개 ${allies + 1}장)`));
      return { name: `보스 ${theme.name} 연쇄`, triggered: true };
    }
  },

  // 결빙 — 행동 봉쇄만. 드로우는 draw 카드군의 몫이다.
  freeze: {
    label: '결빙', tier: 3,
    player({ theme, helpers }) {
      const { addBattleLog, audio, setBossStatus } = helpers;
      setBossStatus('freeze', 1);
      audio.playMagic();
      addBattleLog(comboLog('blue', `❄️ [${escapeHtml(theme.name)} 결빙]`, `${foeLabel(helpers)}을(를) 1턴간 동결시켰습니다.`));
      return { name: `${theme.name} 결빙`, triggered: true };
    },
    // 🐛 예전에는 `front.frozen = true; front.canAttack = false`로 직접 플래그를
    //    세웠다. 상태이상 시스템을 거치지 않으니 턴 시작의 refreshMinions가
    //    `m.frozen = !!m.blockedBy && ...`로 **그대로 지워버렸다** —
    //    보스의 결빙은 완전히 무효과였다. 플레이어 쪽과 같은 관문을 쓴다.
    boss({ theme, helpers }) {
      const { addBattleLog, audio, setPlayerStatus } = helpers;
      const applied = setPlayerStatus('freeze', 1);
      if (!applied) return null;
      audio.playMagic();
      addBattleLog(comboLog('blue', `❄️ [보스 ${escapeHtml(theme.name)} 결빙]`,
        '아군 최전방 소환수를 1턴간 동결시켰습니다.'));
      return { name: `보스 ${theme.name} 결빙`, triggered: true };
    }
  },

  // 더블캐스트 예약 — 그것만 한다. (감전 부여 제거)
  doubleCast: {
    label: '과충전', tier: 4,
    player({ theme, helpers }) {
      const { addBattleLog, audio, setPlayerBuff } = helpers;
      setPlayerBuff('doubleCast', true);
      audio.playCrit();
      addBattleLog(comboLog('yellow', `⚡ [${escapeHtml(theme.name)} 과충전]`,
        '다음 카드가 2연속 발동됩니다.'));
      return { name: `${theme.name} 과충전`, triggered: true };
    },
    // 🐛 예전에는 "8 피해"라는 **완전히 다른 효과**였다. 같은 연계가 진영에
    //    따라 다른 일을 하면 카드군 설명이 한쪽에서는 거짓말이 된다.
    //    이제 보스도 같은 예약 버프를 쓴다 (playBossCard가 읽는다).
    boss({ theme, helpers }) {
      const { addBattleLog, audio, setFoeBuff } = helpers;
      setFoeBuff('doubleCast', true);
      audio.playCrit();
      addBattleLog(comboLog('yellow', `⚡ [보스 ${escapeHtml(theme.name)} 과충전]`,
        '보스의 다음 카드가 2연속 발동됩니다.'));
      return { name: `보스 ${theme.name} 과충전`, triggered: true };
    }
  },

  // 방어막 전개 — 무적은 제거. 매 턴 터지는 콤보에 무적은 과했다.
  shieldHeal: {
    label: '수호 결계', tier: 1,
    player({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const amount = scale(10);
      game.playerMaxShield += amount;
      audio.playShield();
      addBattleLog(comboLog('amber', `✨ [${escapeHtml(theme.name)} 수호 결계]`, `방어막 +${amount} 전개.`));
      return { name: `${theme.name} 수호 결계`, triggered: true };
    },
    boss({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const amount = scale(10);
      game.currentBoss.shield = (game.currentBoss.shield || 0) + amount;
      audio.playShield();
      addBattleLog(comboLog('amber', `✨ [보스 ${escapeHtml(theme.name)} 수호 결계]`, `보스 방어막 +${amount}.`));
      return { name: `보스 ${theme.name} 수호 결계`, triggered: true };
    }
  },

  // 드로우 — 그것만 한다. (실드 관통 제거)
  draw: {
    label: '영혼 회수', tier: 2,
    player({ theme, game, helpers }) {
      const { addBattleLog, audio, drawCards } = helpers;
      if (game.playerHand.length >= 7) return null;
      drawCards(1);
      audio.playMagic();
      addBattleLog(comboLog('purple', `🌑 [${escapeHtml(theme.name)} 영혼 회수]`, '카드 1장 드로우.'));
      return { name: `${theme.name} 영혼 회수`, triggered: true };
    },
    boss({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (!game.bossDeck || !game.bossHand || game.bossHand.length >= 5) return null;
      game.bossHand.push(game.bossDeck.shift());
      audio.playMagic();
      addBattleLog(comboLog('purple', `🌑 [보스 ${escapeHtml(theme.name)} 영혼 회수]`, '보스가 카드 1장 드로우.'));
      return { name: `보스 ${theme.name} 영혼 회수`, triggered: true };
    }
  },

  // 토큰 특수 소환 — 그것만 한다. (체력 회복 제거)
  specialSummon: {
    label: '특수 소환', tier: 3,
    player({ theme, card, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (game.playerMinions.length >= 4) return null;
      game.playerMinions.push({
        id: `token-${theme.id}-${game.turnCount}-${game.playerMinions.length}`,
        name: `${theme.name}의 정령`,
        cardType: 'unit',
        element: card.element || 'nature',
        themeId: theme.id,
        themeName: theme.name,
        themeKeyword: theme.keyword,
        attack: 5,
        defense: 3,
        maxHp: 14,
        currentHp: 14,
        canAttack: false,
        isToken: true,
        imageUrl: card.imageUrl
      });
      audio.playSummon();
      addBattleLog(comboLog('emerald', `🌿 [${escapeHtml(theme.name)} 특수 소환]`,
        `[${escapeHtml(theme.name)}의 정령] 소환. (5/3/14)`));
      return { name: `${theme.name} 특수 소환`, triggered: true };
    },
    boss({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (game.bossMinions.length >= 3) return null;
      game.bossMinions.push({
        name: `${theme.name}의 심복`,
        icon: '👾',
        // 플레이어 토큰과 같은 스탯. 예전에는 공격력만 7이라 같은 연계가
        // 보스 쪽에서 40% 더 셌다.
        attack: 5,
        defense: 3,
        maxHp: 14,
        currentHp: 14,
        taunt: false,
        themeId: theme.id,
        themeName: theme.name,
        // ⚠️ 소환 후유증. 없으면 이번 턴 합동 공격에 곧바로 끼어든다.
        canAttack: false,
        summonedTurn: game.turnCount,
        desc: `${theme.name} 소환수`
      });
      audio.playSummon();
      addBattleLog(comboLog('emerald', `🌿 [보스 ${escapeHtml(theme.name)} 특수 소환]`,
        `[${escapeHtml(theme.name)}의 심복] 소환. (5/3/14)`));
      return { name: `보스 ${theme.name} 특수 소환`, triggered: true };
    }
  },

  // ── 신규: 카드군을 한정하는 특수 연계 ──────────────────────

  // 같은 카드군 소환수 전체를 강화 (이 카드군에만 적용 — 범용 버프가 아니다)
  archetypeRally: {
    label: '카드군 결집',
    tier: 2,
    player({ theme, game, helpers, allies, scale }) {
      const { addBattleLog, audio } = helpers;
      const targets = (game.playerMinions || []).filter(m => belongsToTheme(m, theme));
      if (targets.length === 0) return null;
      const amount = scale(2);
      targets.forEach(m => { m.attack += amount; });
      audio.playSummon();
      addBattleLog(comboLog('amber', `⚜️ [${escapeHtml(theme.name)} 결집]`,
        `[${escapeHtml(theme.name)}] 소환수 ${targets.length}체의 공격력 +${amount}. (이 카드군 전용)`));
      return { name: `${theme.name} 결집`, triggered: true };
    },
    boss({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const targets = (game.bossMinions || []).filter(m => belongsToTheme(m, theme));
      if (targets.length === 0) return null;
      const amount = scale(2);
      targets.forEach(m => { m.attack += amount; });
      audio.playSummon();
      addBattleLog(comboLog('red', `⚜️ [보스 ${escapeHtml(theme.name)} 결집]`,
        `부하 ${targets.length}체 공격력 +${amount}.`));
      return { name: `보스 ${theme.name} 결집`, triggered: true };
    }
  },

  // 묘지(덱 하단)에서 같은 카드군 카드를 되살린다
  archetypeSalvage: {
    label: '카드군 회수',
    tier: 3,
    player({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (game.playerHand.length >= 7) return null;
      // 덱 아래쪽(이미 지나간 영역)에서 같은 카드군을 찾아 되살린다
      const idx = (game.playerDeck || []).findIndex(c => belongsToTheme(c, theme));
      if (idx === -1) return null;
      const revived = game.playerDeck.splice(idx, 1)[0];
      game.playerHand.push(revived);
      audio.playMagic();
      addBattleLog(comboLog('purple', `🪦 [${escapeHtml(theme.name)} 회수]`,
        `[${escapeHtml(revived.name)}]을(를) 되살렸습니다. (같은 카드군만 가능)`));
      return { name: `${theme.name} 회수`, triggered: true };
    },
    boss({ theme, game, helpers }) {
      const { addBattleLog, audio } = helpers;
      if (!game.bossDeck || !game.bossHand || game.bossHand.length >= 5) return null;
      const idx = game.bossDeck.findIndex(c => belongsToTheme(c, theme));
      if (idx === -1) return null;
      game.bossHand.push(game.bossDeck.splice(idx, 1)[0]);
      audio.playMagic();
      addBattleLog(comboLog('purple', `🪦 [보스 ${escapeHtml(theme.name)} 회수]`, '보스가 카드군 카드를 회수했습니다.'));
      return { name: `보스 ${theme.name} 회수`, triggered: true };
    }
  },

  // 같은 카드군 소환수에게만 도발 부여 — 벽 카드군
  archetypeGuard: {
    label: '카드군 수호',
    tier: 2,
    player({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const targets = (game.playerMinions || []).filter(m => belongsToTheme(m, theme) && !m.taunt);
      if (targets.length === 0) return null;
      const bonus = scale(4);
      targets.forEach(m => { m.taunt = true; m.defense = (m.defense || 0) + bonus; });
      audio.playShield();
      addBattleLog(comboLog('blue', `🛡️ [${escapeHtml(theme.name)} 수호]`,
        `[${escapeHtml(theme.name)}] ${targets.length}체가 도발을 얻고 방어력 +${bonus}.`));
      return { name: `${theme.name} 수호`, triggered: true };
    },
    boss({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const targets = (game.bossMinions || []).filter(m => belongsToTheme(m, theme) && !m.taunt);
      if (targets.length === 0) return null;
      // 🐛 방어력 보너스가 빠져 있었다 — 같은 연계인데 보스 쪽만 절반이었다.
      const bonus = scale(4);
      targets.forEach(m => { m.taunt = true; m.defense = (m.defense || 0) + bonus; });
      audio.playShield();
      addBattleLog(comboLog('blue', `🛡️ [보스 ${escapeHtml(theme.name)} 수호]`,
        `부하 ${targets.length}체가 도발을 얻고 방어력 +${bonus}.`));
      return { name: `보스 ${theme.name} 수호`, triggered: true };
    }
  },

  // 상대 방어막을 깎는다 — 방어 카드군 카운터
  shieldBreak: {
    label: '결계 파쇄',
    tier: 3,
    player({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      const boss = game.currentBoss;
      if (!boss || !boss.shield) return null;
      const amount = scale(12);
      const broken = Math.min(boss.shield, amount);
      boss.shield -= broken;
      audio.playCrit();
      addBattleLog(comboLog('yellow', `💥 [${escapeHtml(theme.name)} 결계 파쇄]`,
        `보스 방어막 ${broken} 파괴. (잔여 ${boss.shield})`));
      return { name: `${theme.name} 결계 파쇄`, triggered: true };
    },
    boss({ theme, game, helpers, scale }) {
      const { addBattleLog, audio } = helpers;
      if (game.playerMaxShield <= 0) return null;
      const broken = Math.min(game.playerMaxShield, scale(12));
      game.playerMaxShield -= broken;
      audio.playCrit();
      addBattleLog(comboLog('yellow', `💥 [보스 ${escapeHtml(theme.name)} 결계 파쇄]`,
        `아군 방어막 ${broken} 파괴.`));
      return { name: `보스 ${theme.name} 결계 파쇄`, triggered: true };
    }
  },

  // 상대 손패를 파기 — 자원 압박 카드군
  handDisrupt: {
    label: '패 교란',
    tier: 3,
    player({ theme, game, helpers }) {
      const { addBattleLog, audio, discardFromBoss } = helpers;
      if (!game.bossHand || game.bossHand.length === 0) return null;
      const discarded = typeof discardFromBoss === 'function' ? discardFromBoss() : game.bossHand.pop();
      if (!discarded) return null;
      audio.playSlash();
      addBattleLog(comboLog('purple', `🃏 [${escapeHtml(theme.name)} 패 교란]`,
        `보스의 손패 [${escapeHtml(discarded.name)}]을(를) 파기했습니다.`));
      return { name: `${theme.name} 패 교란`, triggered: true };
    },
    boss({ theme, game, helpers }) {
      const { addBattleLog, audio, discardFromPlayer } = helpers;
      if (!game.playerHand || game.playerHand.length === 0) return null;
      const discarded = typeof discardFromPlayer === 'function' ? discardFromPlayer() : game.playerHand.pop();
      if (!discarded) return null;
      audio.playSlash();
      addBattleLog(comboLog('purple', `🃏 [보스 ${escapeHtml(theme.name)} 패 교란]`,
        `손패 [${escapeHtml(discarded.name)}]이(가) 파기되었습니다.`));
      return { name: `보스 ${theme.name} 패 교란`, triggered: true };
    }
  },

  // 소환수 하나를 희생해 큰 피해 — 자기 자원을 태우는 카드군
  sacrificeStrike: {
    label: '제물 강타',
    tier: 4,
    player({ theme, card, game, helpers, scale }) {
      const { addBattleLog, audio, dealDamageToBoss } = helpers;
      const fodder = (game.playerMinions || []).find(m => (m.instanceId || m.id) !== (card.instanceId || card.id) && belongsToTheme(m, theme));
      if (!fodder) return null;
      const dmg = scale(14) + (fodder.attack || 0);
      game.playerMinions = game.playerMinions.filter(m => m !== fodder);
      dealDamageToBoss(dmg, `${theme.name} 제물 강타`);
      audio.playCrit();
      addBattleLog(comboLog('red', `🔥 [${escapeHtml(theme.name)} 제물 강타]`,
        `[${escapeHtml(fodder.name)}]을(를) 제물로 바쳐 ${dmg} 피해!`));
      return { name: `${theme.name} 제물 강타`, triggered: true };
    },
    boss({ theme, card, game, helpers, scale }) {
      const { addBattleLog, audio, applyDirectDamageToPlayer } = helpers;
      // 방금 낸 카드 자신은 제물이 될 수 없다 (플레이어 쪽과 같은 규칙)
      const fodder = (game.bossMinions || []).find(m =>
        (m.instanceId || m.id || m.name) !== (card.instanceId || card.id || card.name) && belongsToTheme(m, theme));
      if (!fodder) return null;
      const dmg = scale(14) + (fodder.attack || 0);
      game.bossMinions = game.bossMinions.filter(m => m !== fodder);
      applyDirectDamageToPlayer(dmg);
      audio.playCrit();
      addBattleLog(comboLog('red', `🔥 [보스 ${escapeHtml(theme.name)} 제물 강타]`,
        `[${escapeHtml(fodder.name)}]을(를) 제물로 ${dmg} 피해!`));
      return { name: `보스 ${theme.name} 제물 강타`, triggered: true };
    }
  }
};

// ============================================================
// 🏅 연계 액션 등급 — 좋은 액션이 한쪽에 몰리지 않게
// ------------------------------------------------------------
// 액션마다 강함이 다르다. 등급을 매겨두면
//   1) LLM이 카드군을 만들 때 강한 액션만 고르는 걸 막을 수 있고
//   2) 위력 기본치를 등급에 맞춰 자동 조정할 수 있다
//
// tier  : 1(기본) ~ 4(최상). 높을수록 강한 연계.
// base  : 위력 기본치. scale()이 이 값을 받아 증가방식을 적용한다.
// ============================================================
export const COMBO_TIERS = {
  1: { label: '기본', desc: '언제 써도 무난한 연계', powerMult: 1.0 },
  2: { label: '준수', desc: '조건이 맞으면 강한 연계', powerMult: 0.85 },
  3: { label: '강력', desc: '판을 뒤집는 연계', powerMult: 0.7 },
  4: { label: '최상', desc: '게임을 끝내는 연계', powerMult: 0.55 }
};

/** 액션 등급이 높을수록 기본 위력을 낮춰 균형을 맞춘다 */
export function tierAdjustedBase(action, base) {
  const spec = ARCHETYPE_COMBO_ACTIONS[action];
  const tier = COMBO_TIERS[spec && spec.tier] || COMBO_TIERS[1];
  return Math.max(1, Math.round(base * tier.powerMult));
}

/** 등급별 액션 목록 (프롬프트 생성용) */
export function actionsByTier() {
  const grouped = { 1: [], 2: [], 3: [], 4: [] };
  for (const [key, spec] of Object.entries(ARCHETYPE_COMBO_ACTIONS)) {
    grouped[spec.tier || 1].push(`${key}(${spec.label})`);
  }
  return grouped;
}

// 별칭/구버전 액션명을 정규 액션명으로. 알 수 없으면 null.
export function normalizeComboAction(action) {
  if (!action) return null;
  if (ARCHETYPE_COMBO_ACTIONS[action]) return action;
  const aliased = COMBO_ACTION_ALIASES[action];
  return (aliased && ARCHETYPE_COMBO_ACTIONS[aliased]) ? aliased : null;
}

// 설명문에서 콤보 액션 추론 (LLM이 comboAction을 안 줬을 때의 폴백)
const ACTION_KEYWORD_HINTS = [
  ['search', ['서치', 'search', '찾아']],
  ['manaCharge', ['마나', '충전', '공명']],
  ['specialSummon', ['소환', '정령', '토큰']],
  ['freeze', ['동결', '결빙', '기절']],
  ['doubleCast', ['더블', '2연속', '과충전']],
  ['shieldHeal', ['방어막', '결계', '실드', '치유']],
  ['draw', ['드로우', 'draw']]
];

export function inferComboActionFromText(text = '') {
  const desc = String(text || '').toLowerCase();
  for (const [action, hints] of ACTION_KEYWORD_HINTS) {
    if (hints.some(h => desc.includes(h))) return action;
  }
  return 'chainDamage';
}

// 실제 콤보 실행. side는 'player' | 'boss'.
// 실제 콤보 실행. side는 'player' | 'boss'.
//
// 카드군마다 "언제 터지는가(trigger)"와 "얼마나 세지는가(scaling)"가 다르다.
// 조건이 안 맞으면 발동하지 않는다 — 이게 덱 빌딩의 재미를 만든다.
export function runArchetypeCombo(side, theme, card, game, helpers) {
  const rawAction = theme.comboAction || (theme.synergy && theme.synergy.type);
  const action = normalizeComboAction(rawAction);
  if (!action) return null;

  const impl = ARCHETYPE_COMBO_ACTIONS[action][side];
  if (typeof impl !== 'function') return null;

  // 같은 카드군 아군 수 (트리거·스케일링 양쪽이 쓴다)
  const field = side === 'boss' ? (game.bossMinions || []) : (game.playerMinions || []);
  const allies = field.filter(m => m !== card && (m.instanceId || m.id) !== (card.instanceId || card.id) && belongsToTheme(m, theme)).length;
  const ctx = { theme, card, game, helpers, allies, side };

  // 🔁 발동 조건은 **양 진영에 똑같이** 적용된다.
  //
  // 🐛 예전에는 `side === 'player'`일 때만 검사했다. 보스가 조건 없이 매번
  //    터뜨리니 카드군의 성격("체력이 절반 이하일 때 강해진다")이 보스에게는
  //    아무 의미가 없었고, 플레이어만 조건을 지키는 판이 됐다.
  //    COMBO_TRIGGERS가 진영 시점을 갖게 되면서(selfView/foeView) 같은 조건을
  //    보스 기준으로도 판정할 수 있다.
  const trig = checkTrigger(theme, ctx);
  if (!trig.passed) {
    const who = side === 'boss' ? `보스 ${theme.name}` : theme.name;
    helpers.addBattleLog(
      `<div class="p-1 rounded-lg bg-slate-900/80 border border-slate-700 text-[10.5px] text-slate-400 my-0.5">` +
      `⚜️ [${escapeHtml(who)}] 연계 대기 — 조건: ${trig.spec.label}</div>`
    );
    return null;
  }

  try {
    return impl({ ...ctx, scale: (base) => applyScaling(theme, scopeAdjustedBase(theme, tierAdjustedBase(action, base)), ctx) });
  } catch (e) {
    console.warn(`[Archetype Combo] '${action}' (${side}) 실행 중 오류:`, e);
    return null;
  }
}

// 상태이상 부여를 status-effects 모듈로 위임하는 표준 헬퍼
export function makeStatusSetter(statusState) {
  return (type, turns, value) => applyStatus(statusState, type, turns, value);
}
