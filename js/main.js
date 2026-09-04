import { state, loadInitialData } from './storage.js';
import { pvpHost, pvpJoin, pvpLeave, pvpCopyRoom, getPvpStatus, renderPvpPanel } from './pvp-ui.js';
import { loadProfile, getProfile } from './player-profile.js';
import { moveArenaTo } from './battle-arena.js';
import { renderProfilePanel, profileSave, profileSetElement, profileSetAvatar, profileClearImage, profileGenerate } from './profile-ui.js';
import { refreshCustomThemeOptions, onCustomThemePick } from './custom-overrides.js';
import { loadBosses, openBossForgeModal, closeBossForgeModal, generateBossWithLLM, generateAIBoss, generateMockBoss, saveAndFightBoss } from './boss-forge.js';
import { initBattle, playCard, attackWithMinion, playerEndTurn, changeBoss, restartBattle, renderBattleUI } from './battle-engine.js';
import { updateForgePromptPreview, shuffleConceptInput, addTag, clearForgePrompt, expandCurrentPromptWithDanTagGen, generatePromptWithLLM, generatePromptSmartRandom, generateAICard, generateMockCard, setForgeType } from './card-forge.js';
import { renderGrimoire, filterCollection, filterType, filterTheme, searchCollection, addToActiveDeck, removeFromActiveDeck, clearActiveDeck, autoFillRecommendedDeck, exportDeckJson, importDeckJsonPrompt, resetStarterCardsPrompt } from './deck-builder.js';
import { renderPackShop, openBoosterPack, savePackCardsToCollection, addPackCardsToActiveDeck, onPackResolutionChange, setPackArchetype } from './card-pack.js';
import { switchTab, checkCustomModelInput, checkCustomLlmInput, openSettingsModal, closeSettingsModal, saveSettingsFromModal, syncReasoningSelects } from './ui.js';
import { checkOllamaOnline } from './ai-service.js';
import { toggleMute } from './audio.js';
import { openCardCropModal, closeCardCropModal, onCropScaleChange, onCropXChange, onCropYChange, setCropPreset, saveCardCropSettings, downloadOriginalArt, initCropperDragEvents, rerollCardPromptAndTags, rerollCardImageAI } from './card-cropper.js';
import { loadArchetypes, registerNewArchetype, findMatchingArchetype, mergeDuplicateArchetypes, restoreArchetypeBackup, repairArchetypeRecords, rebalanceExistingCards, restoreCardsBackup,
  resetArchetypes, restoreArchetypeReset } from './archetype-service.js';
import { showKeywordInfo, closeKeywordInfoModal } from './keyword-service.js';
import { getDust, getCopies, MAX_CARD_COPIES } from './card-copies.js';
import { ensureArchetypeEmbeddings, checkEmbeddingAvailable, findSimilarArchetypes } from './embedding-service.js';

// Setup window bindings for HTML onclick handlers
window.state = state;
Object.assign(window, {
  switchTab, toggleMute, initBattle, playCard, attackWithMinion, playerEndTurn, changeBoss, restartBattle, checkOllamaOnline,
  shuffleConceptInput, addTag, clearForgePrompt, expandCurrentPromptWithDanTagGen, generatePromptWithLLM, generatePromptSmartRandom, generateAICard, generateMockCard, setForgeType,
  renderPackShop, openBoosterPack, savePackCardsToCollection, addPackCardsToActiveDeck, onPackResolutionChange, setPackArchetype,
  filterCollection, filterType, filterTheme, searchCollection, addToActiveDeck, removeFromActiveDeck, clearActiveDeck, autoFillRecommendedDeck, exportDeckJson, importDeckJsonPrompt, resetStarterCardsPrompt,
  openSettingsModal, closeSettingsModal, saveSettingsFromModal, checkCustomModelInput, checkCustomLlmInput,
  openBossForgeModal, closeBossForgeModal, generateBossWithLLM, generateAIBoss, generateMockBoss, saveAndFightBoss,
  openCardCropModal, closeCardCropModal, onCropScaleChange, onCropXChange, onCropYChange, setCropPreset, saveCardCropSettings, downloadOriginalArt,
  rerollCardPromptAndTags, rerollCardImageAI,
  loadArchetypes, registerNewArchetype, findMatchingArchetype, mergeDuplicateArchetypes, restoreArchetypeBackup,
  repairArchetypeRecords, rebalanceExistingCards, restoreCardsBackup,
  ensureArchetypeEmbeddings, checkEmbeddingAvailable, findSimilarArchetypes,
  resetArchetypes, restoreArchetypeReset,
  showKeywordInfo, closeKeywordInfoModal,
  getDust, getCopies,
  pvpHost, pvpJoin, pvpLeave, pvpCopyRoom, getPvpStatus,
  profileSave, profileSetElement, profileSetAvatar, profileClearImage, profileGenerate, getProfile,
  onCustomThemePick: () => onCustomThemePick(state.archetypesList || [])
});

// Setup cyclic references
window._renderGrimoire = renderGrimoire;
window._updateForgePromptPreview = updateForgePromptPreview;
window._reapplyForgePlan = () => import('./card-forge.js').then(m => m.reapplyForgePlan());   // ⚖️ 예산 초과 허용 토글 → LLM 재호출 없이 재정산 (DECISIONS #100)
window._renderBattleUI = renderBattleUI;
window._renderPvpPanel = renderPvpPanel;
window._renderProfilePanel = renderProfilePanel;
window._refreshCustomThemes = () => refreshCustomThemeOptions(state.archetypesList || []);
window._renderPackShop = renderPackShop;
window._setPackArchetype = (id) => { setPackArchetype(id); };

window.addEventListener('DOMContentLoaded', async () => {
  await loadArchetypes();
  await loadInitialData();
  syncReasoningSelects();   // 🧠 추론 모드 선택칸(연성·카드팩·보스)을 저장된 설정으로 — 예전엔 부팅 시 아무 칸도 안 맞췄다 (DECISIONS #96)
  await repairArchetypeRecords();      // 🧰 괄호 키워드·원시 comboAction·지저분한 카드명 정리
  await mergeDuplicateArchetypes();     // 🧹 중복 카드군 병합 (보수 후에 해야 정확)
  await rebalanceExistingCards();       // ⚖️ 등급 예산 초과 카드 재조정
  await ensureArchetypeEmbeddings({ silent: false });  // 🧠 의미 벡터 준비 (모델 없으면 조용히 건너뜀)
  await loadBosses();
  initBattle();
  moveArenaTo('pve');    // 전장을 PvE 슬롯에 앉힌다 (PvP 시작 시 온라인 탭으로 옮겨간다)
  updateForgePromptPreview();
  renderPackShop();
  await loadProfile();       // 👤 내 듀얼리스트 프로필
  renderPvpPanel();          // 🌐 PvP 방 만들기/참가 패널
  renderProfilePanel();
  initCropperDragEvents();
  if (window.lucide) window.lucide.createIcons();
});
