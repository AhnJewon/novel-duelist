// dom-utils.js - DOM 접근 & 문자열 이스케이프 공용 헬퍼
//
// 카드/카드군 이름은 LLM이 생성하므로 따옴표(' " )가 섞여 들어올 수 있다.
// 기존 코드는 onclick="...showKeywordInfo('${card.themeName}')" 처럼 그대로 박아 넣어서
// 이름에 작은따옴표 하나만 있어도 속성이 깨지고 클릭 핸들러가 통째로 죽었다.

export const $ = (id) => document.getElementById(id);

export function setText(id, text) {
  const el = $(id);
  if (el) el.innerText = text;
  return el;
}

export function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
  return el;
}

// HTML 본문에 값을 넣을 때
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 인라인 핸들러의 JS 문자열 리터럴 안에 값을 넣을 때
// 예: onclick="doThing('${escapeJsString(name)}')"
export function escapeJsString(value) {
  return String(value == null ? '' : value)
    .replace(/[\\]/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

export function openModal(id) {
  const modal = $(id);
  if (!modal) return null;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  return modal;
}

export function closeModal(id) {
  const modal = $(id);
  if (!modal) return null;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  return modal;
}

export function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
