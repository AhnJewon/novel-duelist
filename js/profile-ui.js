// profile-ui.js - 내 듀얼리스트 프로필 편집 UI
//
// 대전 탭 오른쪽에 붙는다. 이름과 초상을 직접 만든다.
// 카드/보스 연성과 같은 파이프라인을 쓰되, 한 장짜리라 절차를 짧게 줄였다.

import { state } from './storage.js';
import { escapeHtml, escapeJsString } from './dom-utils.js';
import { ELEMENT_CONFIG } from './config.js';
import {
  getProfile, saveProfile, planProfileWithLLM, generatePortrait, DEFAULT_AVATARS
} from './player-profile.js';

let _busy = false;

function el(id) { return document.getElementById(id); }

export function renderProfilePanel() {
  const box = el('profile-panel-body');
  if (!box) return;
  const p = getProfile();
  const elCfg = ELEMENT_CONFIG[p.element] || ELEMENT_CONFIG.fire;

  box.innerHTML = `
    <div class="space-y-3">
      <!-- 초상 — 세로로 쌓이는 좁은 화면에서 화면을 다 먹지 않도록 상한을 둔다 -->
      <div class="relative w-full max-w-[240px] mx-auto aspect-square rounded-xl overflow-hidden border-2 ${elCfg.border} bg-gradient-to-b from-[#1a1f36] to-black flex items-center justify-center">
        ${p.imageUrl
          ? `<img src="${escapeHtml(p.imageUrl)}" alt="듀얼리스트 초상" class="w-full h-full object-cover">`
          : `<span class="text-6xl opacity-70">${escapeHtml(p.avatarEmoji || '🧙')}</span>`}
        <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent px-2.5 py-2">
          <div class="text-sm font-black text-white truncate">${escapeHtml(p.name)}</div>
          ${p.title ? `<div class="text-[10px] text-slate-400 truncate">${escapeHtml(p.title)}</div>` : ''}
        </div>
      </div>

      <!-- 이름 -->
      <div>
        <label class="block text-[11px] font-bold text-slate-400 mb-1">듀얼리스트 이름</label>
        <input id="profile-name" maxlength="16" value="${escapeHtml(p.name)}"
          class="w-full bg-[#191d33] border border-brand-border rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-purple-500">
      </div>

      <!-- 속성 -->
      <div>
        <label class="block text-[11px] font-bold text-slate-400 mb-1">상징 속성</label>
        <div class="flex flex-wrap gap-1">
          ${Object.entries(ELEMENT_CONFIG).map(([key, cfg]) => `
            <button onclick="profileSetElement('${escapeJsString(key)}')"
              class="px-2 py-1 rounded-lg text-[11px] font-bold border transition ${p.element === key
                ? 'bg-purple-900/70 border-purple-400 text-white'
                : 'bg-[#191d33] border-brand-border text-slate-400 hover:text-white'}">
              ${cfg.icon} ${escapeHtml(cfg.name)}
            </button>`).join('')}
        </div>
      </div>

      <!-- 이모지 아바타 (초상 없을 때 쓰임) -->
      <div>
        <label class="block text-[11px] font-bold text-slate-400 mb-1">기본 아바타 <span class="font-normal text-slate-600">(초상이 없을 때)</span></label>
        <div class="flex flex-wrap gap-1">
          ${DEFAULT_AVATARS.map(e => `
            <button onclick="profileSetAvatar('${escapeJsString(e)}')"
              class="w-8 h-8 rounded-lg text-base border transition ${p.avatarEmoji === e
                ? 'bg-purple-900/70 border-purple-400'
                : 'bg-[#191d33] border-brand-border hover:border-purple-500'}">${e}</button>`).join('')}
        </div>
      </div>

      <!-- 컨셉 → 초상 생성 -->
      <div>
        <label class="block text-[11px] font-bold text-slate-400 mb-1">초상 컨셉</label>
        <input id="profile-concept" value="${escapeHtml(p.concept || '')}"
          placeholder="예: 잿빛 망토를 두른 냉정한 검객"
          class="w-full bg-[#191d33] border border-brand-border rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-purple-500">
      </div>

      <div class="flex flex-wrap gap-2">
        <button onclick="profileGenerate()" ${_busy ? 'disabled' : ''}
          class="flex-1 px-3 py-2 rounded-lg text-xs font-black transition ${_busy
            ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
            : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md'}">
          ${_busy ? '⏳ 생성 중...' : '🎨 초상 생성'}
        </button>
        <button onclick="profileSave()" ${_busy ? 'disabled' : ''}
          class="px-3 py-2 rounded-lg bg-[#252b47] hover:bg-[#2f3654] text-slate-200 text-xs font-bold border border-brand-border transition">
          저장
        </button>
        ${p.imageUrl ? `<button onclick="profileClearImage()" class="px-3 py-2 rounded-lg bg-red-950/70 hover:bg-red-900 text-red-300 text-xs font-bold border border-red-500/50 transition">초상 삭제</button>` : ''}
      </div>

      <p class="text-[10px] text-slate-500 keep-words">
        초상은 NovelAI로 생성됩니다. API 키가 없으면 이름·아바타만 저장되고 이모지로 표시됩니다.
      </p>
    </div>`;
}

function readInputs() {
  const name = (el('profile-name')?.value || '').trim();
  const concept = (el('profile-concept')?.value || '').trim();
  return { name, concept };
}

export async function profileSave() {
  const { name, concept } = readInputs();
  await saveProfile({ name: name || getProfile().name, concept });
  renderProfilePanel();
}

export async function profileSetElement(element) {
  // 입력 중이던 값을 잃지 않도록 함께 저장한다
  const { name, concept } = readInputs();
  await saveProfile({ element, name: name || getProfile().name, concept });
  renderProfilePanel();
}

export async function profileSetAvatar(emoji) {
  const { name, concept } = readInputs();
  await saveProfile({ avatarEmoji: emoji, name: name || getProfile().name, concept });
  renderProfilePanel();
}

export async function profileClearImage() {
  await saveProfile({ imageUrl: '' });
  renderProfilePanel();
}

export async function profileGenerate() {
  if (_busy) return;
  const { name, concept } = readInputs();
  const p = getProfile();

  _busy = true;
  renderProfilePanel();

  try {
    const plan = await planProfileWithLLM(concept, p.element);
    const portrait = await generatePortrait(plan.visualSeeds, p.element);

    await saveProfile({
      // 사용자가 이름을 직접 적었으면 그것을 존중한다
      name: name || plan.name,
      title: plan.title,
      concept,
      imageUrl: portrait.imageUrl || p.imageUrl,
      prompt: portrait.prompt
    });

    if (!portrait.imageUrl) {
      alert('NovelAI API 키가 없어 이름만 생성했습니다.\n설정에서 키를 넣으면 초상도 그려집니다.');
    }
  } catch (e) {
    console.error('[Profile] 생성 실패:', e);
    alert('초상 생성에 실패했습니다: ' + e.message);
  } finally {
    _busy = false;
    renderProfilePanel();
  }
}
