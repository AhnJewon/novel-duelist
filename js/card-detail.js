// card-detail.js - 전장 카드 상세 팝오버
//
// 전장 슬롯은 작아서 이름·이미지·수치만 들어간다. 스킬 설명이 안 보이면
// 무슨 카드인지 알 수 없어 판단을 못 한다.
//
// ⚠️ 클릭은 이미 "공격"에 쓰이고 있다. 그래서 상세는 다른 입력으로 연다:
//    · 데스크톱 — 마우스 올리기(hover)
//    · 모바일   — 길게 누르기(long press). 탭은 그대로 공격이다.
//
// 팝오버는 body 직속으로 띄운다. 전장 슬롯은 overflow-hidden이라
// 안쪽에 그리면 잘려 나간다.

import { escapeHtml } from './dom-utils.js';
import { ELEMENT_CONFIG, RARITY_STYLE } from './config.js';

const PANEL_ID = 'card-detail-popover';
const LONG_PRESS_MS = 380;

let _pressTimer = null;

function panel() {
  let p = document.getElementById(PANEL_ID);
  if (!p) {
    p = document.createElement('div');
    p.id = PANEL_ID;
    p.className = 'fixed z-[70] hidden pointer-events-none';
    document.body.appendChild(p);
  }
  return p;
}

function statRow(label, value, tone) {
  return `<div class="flex items-center justify-between gap-3">
    <span class="text-slate-400">${label}</span>
    <span class="font-black ${tone}">${value}</span>
  </div>`;
}

/** 카드/전장 엔티티 → 상세 HTML */
function detailHtml(card) {
  const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.fire;
  const rarity = RARITY_STYLE[card.rarity] || null;
  const skill = (card.skills && card.skills[0]) || card.skill || null;
  const type = card.cardType || 'unit';
  const typeLabel = { unit: '⚔️ 소환수', spell: '🔮 주문', structure: '🏛️ 건축물', trap: '🪤 함정' }[type] || type;

  return `
    <div class="w-64 rounded-xl border-2 ${elCfg.border} bg-[#0d1020]/98 backdrop-blur-sm shadow-2xl p-3 space-y-2 text-xs">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-black text-sm text-slate-100 break-words">${escapeHtml(card.name || '')}</div>
          <div class="text-[10px] text-slate-400">${typeLabel} · ${escapeHtml(elCfg.name)}</div>
        </div>
        <span class="text-lg shrink-0">${elCfg.icon}</span>
      </div>

      <div class="flex flex-wrap gap-1">
        ${rarity ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-black ${rarity.badge || 'bg-slate-800 text-slate-300'}">${String(card.rarity || '').toUpperCase()}</span>` : ''}
        ${card.themeName ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950/80 text-amber-300 border border-amber-600/50">♠ ${escapeHtml(card.themeName)}</span>` : ''}
        ${card.isOpponentCard ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-600/50">상대 카드</span>` : ''}
      </div>

      <div class="space-y-0.5 border-t border-slate-700/60 pt-1.5">
        ${Number.isFinite(card.cost) ? statRow('마나', card.cost, 'text-cyan-300') : ''}
        ${type !== 'spell' && type !== 'trap' ? statRow('공격력', card.attack ?? 0, 'text-red-300') : ''}
        ${type !== 'spell' && type !== 'trap' ? statRow('방어력', card.defense ?? 0, 'text-blue-300') : ''}
        ${Number.isFinite(card.currentHp)
          ? statRow('체력', `${card.currentHp} / ${card.maxHp ?? card.hp ?? 0}`, 'text-emerald-300')
          : (type !== 'spell' && type !== 'trap' ? statRow('체력', card.hp ?? 0, 'text-emerald-300') : '')}
      </div>

      ${skill ? `
        <div class="border-t border-slate-700/60 pt-1.5 space-y-1">
          <div class="font-black text-amber-300 text-[11px]">⚔️ ${escapeHtml(skill.name || '효과')}</div>
          <div class="text-slate-300 leading-relaxed text-[11px] break-words">${escapeHtml(skill.description || '설명 없음')}</div>
        </div>` : ''}

      ${card.frozen ? `<div class="text-cyan-300 font-bold text-[10px]">❄️ 빙결 — 이번 턴 행동 불가</div>` : ''}
      ${card.taunt ? `<div class="text-amber-300 font-bold text-[10px]">🛡️ 도발 — 먼저 공격받습니다</div>` : ''}
    </div>`;
}

/** 화면 밖으로 나가지 않게 위치를 잡는다 */
function place(p, anchor) {
  const r = anchor.getBoundingClientRect();
  p.style.visibility = 'hidden';
  p.classList.remove('hidden');
  const pr = p.firstElementChild.getBoundingClientRect();

  let left = r.right + 10;
  if (left + pr.width > window.innerWidth - 8) left = r.left - pr.width - 10;
  if (left < 8) left = Math.max(8, (window.innerWidth - pr.width) / 2);

  let top = r.top;
  if (top + pr.height > window.innerHeight - 8) top = window.innerHeight - pr.height - 8;
  if (top < 8) top = 8;

  p.style.left = `${Math.round(left)}px`;
  p.style.top = `${Math.round(top)}px`;
  p.style.visibility = '';
}

export function showCardDetail(card, anchor) {
  if (!card || !anchor) return;
  const p = panel();
  p.innerHTML = detailHtml(card);
  place(p, anchor);
}

export function hideCardDetail() {
  const p = document.getElementById(PANEL_ID);
  if (p) p.classList.add('hidden');
  if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
}

/**
 * 요소에 상세 보기 입력을 붙인다.
 * 클릭(공격)은 건드리지 않는다.
 */
export function attachCardDetail(el, card) {
  if (!el || !card) return;

  el.addEventListener('mouseenter', () => showCardDetail(card, el));
  el.addEventListener('mouseleave', hideCardDetail);

  // 모바일: 길게 누르면 상세. 탭은 그대로 공격이다.
  el.addEventListener('touchstart', () => {
    if (_pressTimer) clearTimeout(_pressTimer);
    _pressTimer = setTimeout(() => showCardDetail(card, el), LONG_PRESS_MS);
  }, { passive: true });
  ['touchend', 'touchcancel', 'touchmove'].forEach(evt =>
    el.addEventListener(evt, hideCardDetail, { passive: true }));

  // 스크롤하면 위치가 틀어지므로 닫는다
  el.addEventListener('wheel', hideCardDetail, { passive: true });
}
