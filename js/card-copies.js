// card-copies.js - 카드 매수 & 가루 재화
//
// 문제: AI 생성 게임이라 같은 카드를 여러 장 만들 수 없다.
//       보관함에 1장뿐이니 덱에 중복으로 넣고 싶어도 못 넣었다.
//
// 해결: 카드마다 **보유 매수(copies)**를 둔다.
//   - 기본 스타터 카드는 3장씩 지급
//   - 카드팩에서 이미 가진 카드가 다시 나오면 매수가 늘어난다
//     (LLM·NovelAI 호출을 건너뛰므로 카드깡이 훨씬 빨라진다)
//   - 덱 최대 3장이므로 보유 상한도 3장
//   - 상한을 넘긴 중복은 **가루(dust)**로 전환된다
//
// ⚠️ 뽑기 자체에는 제한을 두지 않는다. 중복이 나오는 것도 랜덤성의 일부다.
//    초과분이 가루가 될 뿐이다.

import { state, dbSave, dbLoad } from './storage.js';

/** 카드 1종의 보유 상한. 덱 최대 편성 매수와 같다. */
export const MAX_CARD_COPIES = 3;

/** 등급별 가루 환산량 (중복이 상한을 넘겼을 때) */
export const DUST_VALUE = {
  common: 5,
  rare: 15,
  epic: 40,
  legendary: 100
};

export const STORAGE_KEY_DUST = 'novel_duelist_dust';

/**
 * ⚖️ 연성소 "예산 초과 허용": 마나를 상한까지 올려도 남는 파워 초과분 1단위당 가루 값 (DECISIONS #100).
 * 기준: 레어 카드 한 장의 예산이 8단위쯤이고 중복 환산이 15가루니 1단위 ≈ 2가루가 원가. 초과는 프리미엄이라 두 배.
 * 예) 효과 하나(피해 12 ≈ 1.5단위)를 더 얹으면 가루 6. 튜닝은 이 숫자 하나만.
 */
export const DUST_PER_EXCESS_POWER = 4;

/** 초과 파워 → 가루 (올림). 0이면 0. */
export function dustForExcessPower(excess) {
  const p = Number(excess) || 0;
  return p > 0 ? Math.ceil(p * DUST_PER_EXCESS_POWER) : 0;
}

/** 카드의 현재 보유 매수 (필드가 없는 구버전 카드는 1장으로 본다) */
export function getCopies(card) {
  if (!card) return 0;
  const n = parseInt(card.copies);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_CARD_COPIES, n) : 1;
}

/** 가루 잔액 */
export function getDust() {
  return state.dust || 0;
}

async function saveDust() {
  await dbSave(STORAGE_KEY_DUST, state.dust || 0);
  try { localStorage.setItem(STORAGE_KEY_DUST, String(state.dust || 0)); } catch (e) {}
}

export async function loadDust() {
  const fromDb = await dbLoad(STORAGE_KEY_DUST);
  if (typeof fromDb === 'number') { state.dust = fromDb; return; }
  const raw = localStorage.getItem(STORAGE_KEY_DUST);
  state.dust = raw ? (parseInt(raw) || 0) : 0;
}

/** 가루 획득 (사용처는 아직 없다 — 나중에 쓸 수 있도록 적립만) */
export async function addDust(amount, reason = '') {
  if (!amount || amount <= 0) return getDust();
  state.dust = (state.dust || 0) + amount;
  await saveDust();
  if (reason) console.log(`[Dust] +${amount} (${reason}) — 보유 ${state.dust}`);
  return state.dust;
}

/** 가루 사용 (사용처가 생기면 호출) */
export async function spendDust(amount) {
  if ((state.dust || 0) < amount) return { ok: false, reason: '가루가 부족합니다' };
  state.dust -= amount;
  await saveDust();
  return { ok: true, remaining: state.dust };
}

/**
 * 카드를 보관함에 넣는다. 이미 있으면 매수를 늘리고, 상한을 넘으면 가루로 바꾼다.
 *
 * @returns { kind:'new'|'copy'|'dust', card, copies, dust }
 */
export async function acquireCard(newCard) {
  const collection = state.cardsCollection || (state.cardsCollection = []);

  // 같은 카드인지 판정: id가 같거나, 이름+카드군이 같으면 같은 카드로 본다.
  // (AI가 사실상 같은 카드를 다른 id로 만들어내는 경우가 있다)
  const existing = collection.find(c =>
    c.id === newCard.id ||
    (c.name === newCard.name && (c.themeId || null) === (newCard.themeId || null))
  );

  if (!existing) {
    newCard.copies = 1;
    collection.unshift(newCard);
    return { kind: 'new', card: newCard, copies: 1, dust: 0 };
  }

  const cur = getCopies(existing);
  if (cur < MAX_CARD_COPIES) {
    existing.copies = cur + 1;
    return { kind: 'copy', card: existing, copies: existing.copies, dust: 0 };
  }

  // 상한 도달 → 가루로
  const gained = DUST_VALUE[newCard.rarity] || DUST_VALUE.common;
  await addDust(gained, `${newCard.name} 중복`);
  return { kind: 'dust', card: existing, copies: cur, dust: gained };
}

/**
 * 이미 보유한 카드 중 하나를 중복으로 뽑는다.
 *
 * 카드팩에서 이걸 쓰면 LLM·NovelAI 호출을 통째로 건너뛴다 → 카드깡이 빨라진다.
 * 상한에 도달한 카드는 뽑아도 가루가 되므로 후보에서 제외한다.
 *
 * @param rng    결정론적 난수
 * @param filter 후보를 좁히는 함수 (팩 속성/카드군 제한 등)
 */
export function pickExistingCardForDuplicate(rng, filter = null) {
  const pool = (state.cardsCollection || []).filter(c => {
    if (getCopies(c) >= MAX_CARD_COPIES) return false;
    if (typeof filter === 'function' && !filter(c)) return false;
    return true;
  });
  if (pool.length === 0) return null;
  return rng ? rng.pick(pool) : pool[Math.floor(Math.random() * pool.length)];
}

/** 보관함 전체에 매수 필드를 채운다 (구버전 세이브 마이그레이션) */
export function ensureCopiesField(cards, defaultCopies = 1) {
  let changed = 0;
  (cards || []).forEach(c => {
    if (!Number.isFinite(parseInt(c.copies))) {
      c.copies = defaultCopies;
      changed++;
    }
  });
  return changed;
}
