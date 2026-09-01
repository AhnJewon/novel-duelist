// ui.js - 탭 전환 및 설정

import { state, saveSettingsToStorage } from './storage.js';
import { resetTagSlmCache } from './tag-slm.js';

export function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-gradient-to-r', 'from-amber-500', 'to-yellow-600', 'text-black', 'shadow-md');
    btn.classList.add('text-slate-300');
  });

  const tabContent = document.getElementById(`tab-${tabId}`);
  if (tabContent) tabContent.classList.remove('hidden');

  const activeBtn = document.getElementById(`nav-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-gradient-to-r', 'from-amber-500', 'to-yellow-600', 'text-black', 'shadow-md');
    activeBtn.classList.remove('text-slate-300');
  }

  if (tabId === 'deck' && window._renderGrimoire) window._renderGrimoire();
  if (tabId === 'forge') {
    if (window._updateForgePromptPreview) window._updateForgePromptPreview();
    if (window._refreshCustomThemes) window._refreshCustomThemes();   // ⚜️ 기존 카드군 목록 갱신
  }
  if (tabId === 'battle' && window._renderBattleUI) window._renderBattleUI();
  if (tabId === 'versus' && window._renderBattleUI) window._renderBattleUI();
  if (tabId === 'pack' && window._renderPackShop) window._renderPackShop();
  if (tabId === 'versus') {
    if (window._renderPvpPanel) window._renderPvpPanel();
    if (window._renderProfilePanel) window._renderProfilePanel();
    if (window.lucide) window.lucide.createIcons();
  }
}

export function checkCustomModelInput() {
  const select = document.getElementById('setting-model');
  const customInput = document.getElementById('setting-custom-model');
  if (select.value === 'custom') {
    customInput.classList.remove('hidden');
  } else {
    customInput.classList.add('hidden');
  }
}

export function checkCustomLlmInput() {
  const select = document.getElementById('setting-llm-model-select');
  const customInput = document.getElementById('setting-llm-model');
  if (select.value === 'custom') {
    customInput.classList.remove('hidden');
  } else {
    customInput.classList.add('hidden');
    customInput.value = select.value;
  }
}

export function openSettingsModal() {
  document.getElementById('setting-api-key').value = state.settings.apiKey || '';
  
  const modelSelect = document.getElementById('setting-model');
  const customInput = document.getElementById('setting-custom-model');
  const knownModels = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated', 'nai-diffusion-3'];
  
  if (knownModels.includes(state.settings.model)) {
    modelSelect.value = state.settings.model;
    customInput.classList.add('hidden');
  } else {
    modelSelect.value = 'custom';
    customInput.value = state.settings.model || '';
    customInput.classList.remove('hidden');
  }

  // LLM 모델 선택기 동기화
  const llmSelect = document.getElementById('setting-llm-model-select');
  const llmInput = document.getElementById('setting-llm-model');
  const curLlm = state.settings.llmModel || 'hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M';
  const knownLlms = [
    'hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M',
    'hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q5_K_M',
    'hf.co/AtomicChat/Qwen3.5-4B-GGUF:Q4_K_M',
    'qwen3.5:4b',
    'qwen2.5:3b',
    'qwen2.5:7b',
    'qwen2.5:1.5b'
  ];

  if (knownLlms.includes(curLlm)) {
    if (llmSelect) llmSelect.value = curLlm;
    if (llmInput) {
      llmInput.value = curLlm;
      llmInput.classList.add('hidden');
    }
  } else {
    if (llmSelect) llmSelect.value = 'custom';
    if (llmInput) {
      llmInput.value = curLlm;
      llmInput.classList.remove('hidden');
    }
  }

  document.getElementById('setting-resolution').value = state.settings.resolution || 'square-normal';
  document.getElementById('setting-steps').value = state.settings.steps || 28;
  document.getElementById('setting-scale').value = state.settings.scale || 5.0;
  document.getElementById('setting-llm-url').value = state.settings.llmUrl || 'http://localhost:11434';
  const embedEl = document.getElementById('setting-embed-model');
  if (embedEl) embedEl.value = state.settings.embedModel || 'bge-m3';
  const slmPreset = document.getElementById('setting-tag-slm-preset');
  if (slmPreset) slmPreset.value = state.settings.tagSlmPreset || 'tipo';
  const slmModel = document.getElementById('setting-tag-slm-model');
  if (slmModel) slmModel.value = state.settings.tagSlmModel || '';
  const slmIp = document.getElementById('setting-tag-slm-ip');
  if (slmIp) slmIp.value = state.settings.tagSlmIpPolicy || 'auto';
  const slmArtist = document.getElementById('setting-tag-slm-artist');
  if (slmArtist) slmArtist.value = state.settings.tagSlmArtistMode || 'slm';
  const slmArtists = document.getElementById('setting-tag-slm-artists');
  if (slmArtists) slmArtists.value = state.settings.tagSlmArtists || '';

  const rModeEl = document.getElementById('setting-reasoning-mode');
  if (rModeEl) rModeEl.value = state.settings.reasoningMode || 'fast';

  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-modal').classList.add('flex');
}

export function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.getElementById('settings-modal').classList.remove('flex');
}

export function saveSettingsFromModal() {
  state.settings.apiKey = document.getElementById('setting-api-key').value.trim();
  
  const modelSelect = document.getElementById('setting-model');
  if (modelSelect.value === 'custom') {
    state.settings.model = document.getElementById('setting-custom-model').value.trim() || 'nai-diffusion-4-5-full';
  } else {
    state.settings.model = modelSelect.value;
  }

  // LLM 모델 저장
  const llmSelect = document.getElementById('setting-llm-model-select');
  const llmInput = document.getElementById('setting-llm-model');
  if (llmSelect && llmSelect.value === 'custom') {
    state.settings.llmModel = llmInput.value.trim() || 'qwen2.5:3b';
  } else if (llmSelect) {
    state.settings.llmModel = llmSelect.value;
  } else {
    state.settings.llmModel = llmInput ? llmInput.value.trim() : 'qwen2.5:3b';
  }

  const rModeEl = document.getElementById('setting-reasoning-mode');
  if (rModeEl) state.settings.reasoningMode = rModeEl.value;

  const forgeModeEl = document.getElementById('forge-reasoning-mode');
  if (forgeModeEl) forgeModeEl.value = state.settings.reasoningMode || 'fast';

  state.settings.resolution = document.getElementById('setting-resolution').value;
  state.settings.steps = Math.min(28, parseInt(document.getElementById('setting-steps').value) || 28);
  state.settings.scale = parseFloat(document.getElementById('setting-scale').value) || 5.0;
  state.settings.llmUrl = document.getElementById('setting-llm-url').value.trim() || 'http://localhost:11434';
  const embedInput = document.getElementById('setting-embed-model');
  if (embedInput) state.settings.embedModel = embedInput.value.trim() || 'bge-m3';
  const slmPresetEl = document.getElementById('setting-tag-slm-preset');
  if (slmPresetEl) state.settings.tagSlmPreset = slmPresetEl.value;
  const slmModelEl = document.getElementById('setting-tag-slm-model');
  if (slmModelEl) state.settings.tagSlmModel = slmModelEl.value.trim();
  const slmIpEl = document.getElementById('setting-tag-slm-ip');
  if (slmIpEl) state.settings.tagSlmIpPolicy = slmIpEl.value;
  const slmArtistEl = document.getElementById('setting-tag-slm-artist');
  if (slmArtistEl) state.settings.tagSlmArtistMode = slmArtistEl.value;
  const slmArtistsEl = document.getElementById('setting-tag-slm-artists');
  if (slmArtistsEl) state.settings.tagSlmArtists = slmArtistsEl.value.trim();

  // 모델·프리셋이 바뀌었을 수 있으므로 설치 여부 캐시를 버린다
  // (안 하면 모델을 새로 깔아도 계속 규칙 기반으로 폴백한다)
  resetTagSlmCache();

  saveSettingsToStorage();
  closeSettingsModal();
  alert(`설정이 저장되었습니다!\n적용된 이미지 모델: ${state.settings.model}\n적용된 LLM: ${state.settings.llmModel}\n추론 모드: ${state.settings.reasoningMode === 'deep' ? '🧠 심층 추론 (20~40초)' : '⚡ 초고속 모드 (3~6초)'}`);
}
