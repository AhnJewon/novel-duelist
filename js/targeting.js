// targeting.js - 대상 선택 모드
//
// 문제: 카드 설명은 "적 하나를 지정해"처럼 읽히는데 실제로는 아무것도 못 골랐다.
//       공격은 늘 최전방을 때리고, 소환수는 빈 슬롯에 순서대로 밀려 들어갔다.
//
// 전장 위치는 실제로 의미가 있다:
//   · 적 공격은 `playerMinions[0]`(맨 앞)을 때린다
//   · 내 공격은 상대 전장의 소환수 중 내가 고른 대상을 때린다
// 그래서 **어디에 세울지 / 누구를 때릴지**를 고르게 하면 판단할 거리가 생긴다.
//
// ⚠️ PvP에서는 고른 대상까지 상대에게 보내야 한다. 안 보내면 양쪽이
//    서로 다른 대상을 때려 락스텝이 깨진다.

let _mode = null;   // { kind, valid:Set<string>, onPick, onCancel, hint }

/** 지금 대상 선택 중인가 */
export function isTargeting() { return !!_mode; }
export function targetingKind() { return _mode ? _mode.kind : null; }

/**
 * 대상 선택 시작.
 * @param kind    'attack' | 'summon'
 * @param valid   선택 가능한 대상 키 배열 (예: ['foe:0','foe:2','face'])
 * @param onPick  (key) => void
 * @param hint    화면 상단에 띄울 안내
 */
export function beginTargeting({ kind, valid, onPick, hint = '', onCancel = null, need = 1, onProgress = null }) {
  cancelTargeting(false);
  const pool = new Set(valid || []);
  if (pool.size === 0) return false;
  _mode = {
    kind, valid: pool, onPick, onCancel, hint, onProgress,
    // 고를 수 있는 수보다 많이 요구하면 있는 만큼만 고르게 한다
    need: Math.max(1, Math.min(need, pool.size)),
    chosen: []
  };
  renderHint();
  return true;
}

export function isValidTarget(key) {
  return !!_mode && _mode.valid.has(key);
}

/**
 * 대상 확정. 유효하지 않으면 아무 일도 하지 않는다.
 *
 * `need`가 2 이상이면 그만큼 모을 때까지 계속 받는다 (다중 대상 효과).
 * 같은 대상을 두 번 고를 수는 없다.
 */
export function pickTarget(key) {
  if (!_mode || !_mode.valid.has(key)) return false;

  if (_mode.need > 1) {
    if (_mode.chosen.includes(key)) return false;   // 중복 선택 방지
    _mode.chosen.push(key);
    _mode.valid.delete(key);

    // 아직 다 못 모았고 고를 대상이 남아 있으면 계속 받는다
    if (_mode.chosen.length < _mode.need && _mode.valid.size > 0) {
      renderHint();
      if (_mode.onProgress) _mode.onProgress(_mode.chosen.slice());
      return true;
    }
  } else {
    _mode.chosen = [key];
  }

  const cb = _mode.onPick;
  const picked = _mode.chosen.slice();
  _mode = null;
  hideHint();
  if (cb) cb(picked.length === 1 ? picked[0] : picked, picked);
  return true;
}

export function cancelTargeting(runCallback = true) {
  if (!_mode) return;
  const cb = _mode.onCancel;
  _mode = null;
  hideHint();
  if (runCallback && cb) cb();
}

// ── 안내 배너 ────────────────────────────────────────────────
const HINT_ID = 'targeting-hint';

function renderHint() {
  if (!_mode) return;
  let el = document.getElementById(HINT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HINT_ID;
    // ⚠️ 상단에 두면 sticky 헤더의 탭 메뉴를 가린다 (z-65 > 헤더 z-50).
    //    하단 중앙이 전장에 가깝고 무엇도 가리지 않는다.
    el.className = 'fixed left-1/2 -translate-x-1/2 bottom-24 z-[65] px-4 py-2 rounded-xl ' +
                   'bg-amber-500 text-black text-xs font-black shadow-2xl flex items-center gap-3';
    document.body.appendChild(el);
  }
  const progress = _mode.need > 1
    ? `<span class="px-1.5 py-0.5 rounded bg-black/25">${_mode.chosen.length} / ${_mode.need}</span>`
    : '';
  el.innerHTML = `
    <span>🎯 ${_mode.hint || '대상을 선택하세요'}</span>
    ${progress}
    <button id="${HINT_ID}-cancel" class="px-2 py-0.5 rounded-lg bg-black/25 hover:bg-black/40 text-black font-bold">취소 (Esc)</button>
  `;
  el.classList.remove('hidden');
  const btn = document.getElementById(`${HINT_ID}-cancel`);
  if (btn) btn.onclick = () => cancelTargeting();
}

function hideHint() {
  const el = document.getElementById(HINT_ID);
  if (el) el.classList.add('hidden');
}

// Esc로 취소. 대상 선택은 되돌릴 수 있어야 마음 편히 누른다.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _mode) {
      e.preventDefault();
      cancelTargeting();
    }
  });
}

/**
 * 선택 가능한 대상에 시각 표시를 입힌다.
 * 렌더 직후에 부른다 (DOM이 다시 그려지면 클래스가 날아간다).
 */
export function decorateTargets(root = document) {
  const all = root.querySelectorAll('[data-target-key]');
  all.forEach(el => {
    const key = el.getAttribute('data-target-key');
    const ok = isValidTarget(key);
    el.classList.toggle('ring-4', ok);
    el.classList.toggle('ring-amber-400', ok);
    el.classList.toggle('cursor-crosshair', ok);
    el.classList.toggle('animate-pulse', ok);
    // 선택 중인데 유효하지 않은 대상은 흐리게 — 뭘 고를 수 있는지 한눈에 보인다
    el.classList.toggle('opacity-40', isTargeting() && !ok);
  });
}
