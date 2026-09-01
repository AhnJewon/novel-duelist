// pvp-session.js - PvP 1대1 대전 세션
//
// 엔진 대칭화(#29)와 모드 분리(#31)가 끝났으므로 여기서는 **대전 절차**만 다룬다.
//   1) 덱 교환 — 카드 데이터 + 연계 실행에 필요한 카드군 정의
//   2) 시드 합의 — 양쪽이 같은 난수로 같은 전개를 본다 (락스텝)
//   3) 행동 전송 — 카드 시전/공격/턴종료를 명령으로 주고받는다
//
// ⚠️ 네트워크 전송 자체는 여기 없다. transport(보내기 함수)를 주입받는다.
//    WebRTC든 로컬 테스트든 같은 세션 코드를 쓴다.

import { state } from './storage.js';
import { sanitizeAndClampCardData, evaluateCardPower } from './config.js';
import { setBattleMode } from './combat-side.js';
import { profileForWire, sendableAvatar } from './player-profile.js';

export const PVP_PROTOCOL_VERSION = 1;

// ============================================================
// 덱 페이로드 — 이미지 없이 5KB 남짓
// ============================================================

/** 대전에 필요한 최소 필드만 추린다 */
function slimCard(card) {
  return {
    id: card.id,
    name: card.name,
    cardType: card.cardType || 'unit',
    element: card.element,
    rarity: card.rarity,
    cost: card.cost,
    attack: card.attack,
    defense: card.defense,
    hp: card.hp,
    themeId: card.themeId || null,
    themeName: card.themeName || null,
    themeKeyword: card.themeKeyword || null,
    trapTrigger: card.trapTrigger || null,
    condition: card.condition || null,
    skill: (card.skills && card.skills[0]) || card.skill || null
  };
}

/** 연계 실행에 필요한 카드군 정의만 (상대 DB 없이도 돌아간다) */
function slimTheme(theme) {
  return {
    id: theme.id,
    name: theme.name,
    keyword: theme.keyword,
    element: theme.element,
    elements: theme.elements || [theme.element],
    elementPolicy: theme.elementPolicy || 'mono',
    comboAction: theme.comboAction,
    comboTrigger: theme.comboTrigger,
    comboScaling: theme.comboScaling,
    comboScope: theme.comboScope,
    comboScopeValue: theme.comboScopeValue
  };
}

/** 내 덱을 상대에게 보낼 형태로 만든다 */
export function exportDeckPayload({ includeImages = false } = {}) {
  const deck = (state.activeDeckCardIds || [])
    .map(id => state.cardsCollection.find(c => c.id === id))
    .filter(Boolean);

  const cards = deck.map(c => {
    const slim = slimCard(c);
    if (includeImages && c.imageUrl) slim.imageUrl = c.imageUrl;
    return slim;
  });

  // 덱에 실제로 쓰이는 카드군만 싣는다
  const usedThemeIds = [...new Set(deck.map(c => c.themeId).filter(Boolean))];
  const themes = usedThemeIds
    .map(tid => (state.archetypesList || []).find(a => a.id === tid))
    .filter(Boolean)
    .map(slimTheme);

  return { v: PVP_PROTOCOL_VERSION, cards, themes };
}

/**
 * 상대 덱을 받아 검증한다.
 *
 * ⚠️ P2P는 상대 클라이언트를 신뢰할 수 없다. 받은 카드를 그대로 쓰면
 *    공격력 999짜리 COMMON도 통과한다.
 *    다행히 파워 예산 시스템(#32)이 그대로 검증기 역할을 한다.
 *
 * @returns { cards, themes, rejected[] }
 */
export function importDeckPayload(payload) {
  if (!payload || payload.v !== PVP_PROTOCOL_VERSION) {
    throw new Error(`프로토콜 버전 불일치 (내 v${PVP_PROTOCOL_VERSION} / 상대 v${payload && payload.v})`);
  }

  const rejected = [];
  const cards = (payload.cards || []).map(raw => {
    const before = evaluateCardPower(raw);
    // 예산 초과·등급 위반 효과는 여기서 잘려 나간다
    const fixed = sanitizeAndClampCardData(raw);
    const after = evaluateCardPower(fixed);

    if (before.overBudget || before.illegal.length > 0) {
      rejected.push({
        카드: raw.name,
        '전(사용)': before.used,
        '후(사용)': after.used,
        제거됨: before.effects.filter(e => !after.effects.some(a => a.key === e.key)).map(e => e.label).join(', ')
      });
    }
    return { ...fixed, skills: [fixed.skill], isOpponentCard: true };
  });

  const themes = (payload.themes || []).map(slimTheme);

  if (rejected.length > 0) {
    console.group(`[PvP] ⚠️ 상대 덱에서 ${rejected.length}장이 밸런스 검증에 걸려 조정됨`);
    console.table(rejected);
    console.groupEnd();
  }

  return { cards, themes, rejected };
}

// ============================================================
// 대전 세션
// ============================================================

/**
 * @param opts.send        (msg) => void  — 상대에게 메시지 전송
 * @param opts.isHost      호스트가 시드를 정한다
 * @param opts.onStart     ({ seed, foeDeck }) => void
 * @param opts.onFoeAction (action) => void
 */
export function createPvpSession({ send, isHost = false, onStart = null, onFoeAction = null, onFoeProfile = null, onFoeAvatar = null }) {
  let myDeck = null;
  let foeDeck = null;
  let seed = null;
  let started = false;

  const tryStart = () => {
    if (started || !myDeck || !foeDeck || seed === null) return;
    started = true;
    setBattleMode('pvp');
    if (onStart) onStart({ seed, foeDeck });
  };

  return {
    /** 대전 시작 — 내 덱을 보내고 (호스트면) 시드도 정한다 */
    begin() {
      myDeck = exportDeckPayload();
      send({ type: 'deck', payload: myDeck });

      // 👤 프로필은 대전 시작 조건이 **아니다.** 먼저 보내되 도착을 기다리지 않는다.
      //    (초상 전송이 실패해도 대전은 굴러가야 한다)
      send({ type: 'profile', profile: profileForWire() });
      sendableAvatar()
        .then(dataUrl => { if (dataUrl) send({ type: 'avatar', dataUrl }); })
        .catch(() => { /* 초상 없이 진행 */ });

      if (isHost) {
        // 시드는 호스트가 정한다. 양쪽이 같은 값을 써야 전개가 일치한다.
        seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
        send({ type: 'seed', seed });
      }
      tryStart();
    },

    /** 상대 메시지 처리 */
    receive(msg) {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'deck':
          try {
            foeDeck = importDeckPayload(msg.payload);
          } catch (e) {
            console.error('[PvP] 상대 덱 수신 실패:', e.message);
            return;
          }
          tryStart();
          break;
        case 'seed':
          seed = msg.seed >>> 0;
          tryStart();
          break;
        case 'action':
          if (onFoeAction) onFoeAction(msg.action);
          break;
        // 👤 상대 듀얼리스트 프로필 (이름·속성·이모지). 대전 시작 조건은 아니다.
        case 'profile':
          if (onFoeProfile) onFoeProfile(msg.profile || {});
          break;
        // 👤 상대 초상. 용량이 커서 프로필과 분리해 보낸다. 없어도 대전은 진행된다.
        case 'avatar':
          if (onFoeAvatar) onFoeAvatar(msg.dataUrl || '');
          break;
        default:
          console.warn('[PvP] 알 수 없는 메시지:', msg.type);
      }
    },

    /** 내 행동을 상대에게 전송 (락스텝 — 양쪽이 같은 순서로 재생한다) */
    sendAction(action) {
      send({ type: 'action', action });
    },

    get state() {
      return { started, seed, hasMyDeck: !!myDeck, hasFoeDeck: !!foeDeck };
    }
  };
}

/** 로컬 테스트용 — 두 세션을 메모리에서 직접 연결한다 */
export function createLoopbackPair({ onStartA, onStartB, onActionA, onActionB } = {}) {
  let a, b;
  a = createPvpSession({ send: (m) => b.receive(m), isHost: true, onStart: onStartA, onFoeAction: onActionA });
  b = createPvpSession({ send: (m) => a.receive(m), isHost: false, onStart: onStartB, onFoeAction: onActionB });
  return { a, b };
}
