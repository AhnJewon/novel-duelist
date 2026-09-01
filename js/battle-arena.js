// battle-arena.js - 전장 DOM을 탭 사이로 옮긴다
//
// PvE는 `배틀 아레나` 탭에서, PvP는 `온라인 대전` 탭에서 진행한다.
//
// ⚠️ 전장 마크업을 **복제하지 않는다.**
//    같은 id(`player-hand`, `battle-logs`, `boss-container` ...)가 두 벌 생기면
//    renderBattleUI()가 어느 쪽을 갱신할지 알 수 없게 되고,
//    document.getElementById는 먼저 나온 하나만 집는다 — 조용히 안 그려진다.
//
//    그래서 노드 하나를 **옮겨 다니게** 한다. id는 언제나 한 벌뿐이다.

const ARENA_ID = 'battle-arena';
const PVE_SLOT = 'battle-arena-slot';
const PVP_SLOT = 'versus-arena-slot';

function arena() { return document.getElementById(ARENA_ID); }

/**
 * 전장을 옮긴다.
 * @param {'pve'|'pvp'} where
 */
export function moveArenaTo(where) {
  const node = arena();
  if (!node) return false;
  const toPvp = where === 'pvp';
  const slot = document.getElementById(toPvp ? PVP_SLOT : PVE_SLOT);
  const other = document.getElementById(toPvp ? PVE_SLOT : PVP_SLOT);
  if (!slot) return false;
  if (node.parentElement === slot) return true;   // 이미 그 자리

  slot.appendChild(node);

  // 비워진 탭에는 왜 전장이 없는지 알려준다. 안 그러면 빈 화면으로 보인다.
  if (other) {
    other.innerHTML = toPvp
      ? `<div class="rounded-2xl border border-dashed border-cyan-500/40 bg-cyan-950/20 p-6 text-center space-y-2">
           <div class="text-2xl">🌐</div>
           <div class="text-sm font-black text-cyan-200">온라인 대전이 진행 중입니다</div>
           <div class="text-xs text-slate-400">전장은 <b>온라인 대전</b> 탭에 있습니다.</div>
           <button onclick="switchTab('versus')" class="mt-1 px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold transition">대전 화면으로 이동</button>
         </div>`
      : '';
  }

  // 아이콘은 옮긴 뒤 다시 그려야 한다 (lucide가 DOM 교체를 못 따라온다)
  if (window.lucide) window.lucide.createIcons();
  return true;
}

/** 지금 전장이 어느 탭에 있는지 */
export function arenaLocation() {
  const node = arena();
  if (!node || !node.parentElement) return null;
  return node.parentElement.id === PVP_SLOT ? 'pvp' : 'pve';
}

/**
 * 전장의 "보스" 표현을 모드에 맞게 바꾼다.
 *
 * PvE 전용으로 쓰던 문구가 PvP에서 그대로 나오면 몰입이 깨진다.
 * ("보스 HP", "BOSS VOICE", "보스의 호위 부하")
 * 마크업을 복제하지 않으므로 텍스트만 갈아 끼운다.
 *
 * @param {boolean} pvp
 * @param {string}  foeName  PvP일 때 상대 듀얼리스트 이름
 */
export function applyArenaMode(pvp, foeName = '상대') {
  const word = pvp ? foeName : '보스';
  document.querySelectorAll('.foe-word').forEach(n => { n.textContent = word; });

  // 보스 대사 말풍선은 PvE 전용이다. PvP에는 스크립트 대사가 없다.
  const box = document.getElementById('boss-dialogue-box');
  if (box) box.classList.toggle('hidden', !!pvp);
}
