import { state, loadInitialData } from './storage.js';
import { loadBosses, openBossForgeModal, closeBossForgeModal, generateBossWithLLM, generateAIBoss, generateMockBoss, saveAndFightBoss } from './boss-forge.js';
import { initBattle, playCard, attackWithMinion, playerEndTurn, changeBoss, restartBattle, renderBattleUI } from './battle-engine.js';
import { updateForgePromptPreview, shuffleConceptInput, addTag, clearForgePrompt, expandCurrentPromptWithDanTagGen, generatePromptWithLLM, generatePromptSmartRandom, generateAICard, generateMockCard, setForgeType } from './card-forge.js';
import { renderGrimoire, filterCollection, filterType, filterTheme, searchCollection, addToActiveDeck, removeFromActiveDeck, clearActiveDeck, autoFillRecommendedDeck, exportDeckJson, importDeckJsonPrompt, resetStarterCardsPrompt } from './deck-builder.js';
import { renderPackShop, openBoosterPack, savePackCardsToCollection, addPackCardsToActiveDeck, onPackResolutionChange } from './card-pack.js';
import { switchTab, checkCustomModelInput, checkCustomLlmInput, openSettingsModal, closeSettingsModal, saveSettingsFromModal } from './ui.js';
import { checkOllamaOnline } from './ai-service.js';
import { toggleMute } from './audio.js';
import { openCardCropModal, closeCardCropModal, onCropScaleChange, onCropXChange, onCropYChange, setCropPreset, saveCardCropSettings, downloadOriginalArt, initCropperDragEvents, rerollCardPromptAndTags, rerollCardImageAI } from './card-cropper.js';
import { loadArchetypes, registerNewArchetype, findMatchingArchetype } from './archetype-service.js';
import { showKeywordInfo, closeKeywordInfoModal } from './keyword-service.js';

// Setup window bindings for HTML onclick handlers
window.state = state;
Object.assign(window, {
  switchTab, toggleMute, initBattle, playCard, attackWithMinion, playerEndTurn, changeBoss, restartBattle, checkOllamaOnline,
  shuffleConceptInput, addTag, clearForgePrompt, expandCurrentPromptWithDanTagGen, generatePromptWithLLM, generatePromptSmartRandom, generateAICard, generateMockCard, setForgeType,
  renderPackShop, openBoosterPack, savePackCardsToCollection, addPackCardsToActiveDeck, onPackResolutionChange,
  filterCollection, filterType, filterTheme, searchCollection, addToActiveDeck, removeFromActiveDeck, clearActiveDeck, autoFillRecommendedDeck, exportDeckJson, importDeckJsonPrompt, resetStarterCardsPrompt,
  openSettingsModal, closeSettingsModal, saveSettingsFromModal, checkCustomModelInput, checkCustomLlmInput,
  openBossForgeModal, closeBossForgeModal, generateBossWithLLM, generateAIBoss, generateMockBoss, saveAndFightBoss,
  openCardCropModal, closeCardCropModal, onCropScaleChange, onCropXChange, onCropYChange, setCropPreset, saveCardCropSettings, downloadOriginalArt,
  rerollCardPromptAndTags, rerollCardImageAI,
  loadArchetypes, registerNewArchetype, findMatchingArchetype,
  showKeywordInfo, closeKeywordInfoModal
});

// Setup cyclic references
window._renderGrimoire = renderGrimoire;
window._updateForgePromptPreview = updateForgePromptPreview;
window._renderBattleUI = renderBattleUI;
window._renderPackShop = renderPackShop;

window.addEventListener('DOMContentLoaded', async () => {
  await loadArchetypes();
  await loadInitialData();
  await loadBosses();
  initBattle();
  updateForgePromptPreview();
  renderPackShop();
  initCropperDragEvents();
  if (window.lucide) window.lucide.createIcons();
});
