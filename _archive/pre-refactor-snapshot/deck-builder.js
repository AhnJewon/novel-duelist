// deck-builder.js - 카드 도감(보관함) & 전투 덱 빌더

import { state, saveCardsToStorage, saveActiveDeckToStorage, MAX_DECK_SIZE, RECOMMENDED_DECK_SIZE } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { DEFAULT_STARTER_CARDS } from './data.js';
import { audio } from './audio.js';
import { ELEMENT_CONFIG, CARD_TYPES } from './config.js';

let currentElementFilter = 'all';
let currentTypeFilter = 'all';
let currentThemeFilter = 'all';
let currentSearchQuery = '';

export function filterTheme(themeId) {
  currentThemeFilter = themeId || 'all';
  renderGrimoire();
}

export function renderGrimoire() {
  renderActiveDeckSection();
  renderCollectionSection();
  if (window.lucide) window.lucide.createIcons();
}

// ⚔️ 1. 현재 출전 덱 렌더러
function renderActiveDeckSection() {
  const grid = document.getElementById('active-deck-grid');
  const title = document.getElementById('active-deck-title');
  const statsBox = document.getElementById('active-deck-stats');
  if (!grid) return;

  grid.innerHTML = '';

  const activeCards = state.activeDeckCardIds
    .map(id => state.cardsCollection.find(c => c.id === id))
    .filter(Boolean);

  if (title) {
    title.innerHTML = `배틀 덱 편성 현황 <span class="text-amber-400 font-bold">(${activeCards.length} / ${MAX_DECK_SIZE}장)</span>`;
  }

  // 덱 통계 분석 계산
  let unitCount = 0;
  let spellCount = 0;
  let structCount = 0;
  let totalCost = 0;

  activeCards.forEach(c => {
    const t = c.cardType || 'unit';
    if (t === 'spell') spellCount++;
    else if (t === 'structure') structCount++;
    else unitCount++;
    totalCost += (c.cost || 0);
  });

  const avgCost = activeCards.length > 0 ? (totalCost / activeCards.length).toFixed(1) : '0.0';

  if (statsBox) {
    statsBox.innerHTML = `
      <span class="text-red-300">⚔️ 소환수 ${unitCount}</span>
      <span class="text-slate-600">|</span>
      <span class="text-purple-300">🔮 주문 ${spellCount}</span>
      <span class="text-slate-600">|</span>
      <span class="text-amber-300">🏛️ 성물 ${structCount}</span>
      <span class="text-slate-600">|</span>
      <span class="text-cyan-300">💎 평균 마나: ${avgCost}</span>
    `;
  }

  // 12개 슬롯 카드 렌더링
  for (let i = 0; i < MAX_DECK_SIZE; i++) {
    const card = activeCards[i];
    if (card) {
      const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.fire;
      const cardType = card.cardType || 'unit';
      const typeCfg = CARD_TYPES[cardType] || CARD_TYPES.unit;

      const slotDiv = document.createElement('div');
      slotDiv.className = 'relative w-[130px] rounded-xl p-1.5 bg-[#121526] border border-slate-700 flex flex-col justify-between select-none shadow-md transition hover:-translate-y-1 hover:border-amber-400';
      
      slotDiv.innerHTML = `
        <div class="flex items-center justify-between text-[10px] font-bold">
          <div class="flex items-center gap-1">
            <span class="w-4 h-4 rounded-full bg-cyan-500 text-black font-black flex items-center justify-center text-[9px]">${card.cost}</span>
            <span class="truncate max-w-[70px] text-slate-200">${card.name}</span>
          </div>
          <span>${elCfg.icon}</span>
        </div>
        <div class="relative w-full h-16 rounded-lg overflow-hidden my-1 bg-black border border-slate-800">
          <img src="${card.imageUrl}" class="w-full h-full object-cover">
          <div class="absolute bottom-0.5 left-0.5 px-1 rounded text-[7.5px] font-bold border ${typeCfg.badge}">
            ${typeCfg.icon} ${typeCfg.name}
          </div>
        </div>
        <button onclick="removeFromActiveDeck('${card.id}')" class="w-full py-1 rounded bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-300 text-[10px] font-bold flex items-center justify-center gap-1 transition">
          <i data-lucide="x" class="w-3 h-3"></i> 덱에서 제외
        </button>
      `;
      grid.appendChild(slotDiv);
    } else {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'w-[130px] h-[126px] rounded-xl border-2 border-dashed border-slate-700/60 bg-black/20 flex flex-col items-center justify-center text-slate-500 text-[11px] gap-1';
      emptyDiv.innerHTML = `
        <i data-lucide="plus" class="w-5 h-5 opacity-40"></i>
        <span>슬롯 ${i + 1}</span>
      `;
      grid.appendChild(emptyDiv);
    }
  }
}

// 📚 2. 전체 보유 카드 보관함 렌더러
function renderCollectionSection() {
  const grid = document.getElementById('grimoire-grid');
  const countText = document.getElementById('collection-count-text');
  if (!grid) return;

  grid.innerHTML = '';

  if (countText) {
    countText.innerText = state.cardsCollection.length;
  }

  // 필터링 적용
  let filtered = state.cardsCollection;

  if (currentElementFilter !== 'all') {
    filtered = filtered.filter(c => c.element === currentElementFilter);
  }

  if (currentTypeFilter !== 'all') {
    filtered = filtered.filter(c => (c.cardType || 'unit') === currentTypeFilter);
  }

  if (currentThemeFilter !== 'all') {
    if (currentThemeFilter === 'generic') {
      filtered = filtered.filter(c => !c.themeName && !(c.theme && c.theme.name) || c.isGeneric);
    } else {
      filtered = filtered.filter(c => c.themeId === currentThemeFilter || (c.theme && c.theme.id === currentThemeFilter) || c.themeName === currentThemeFilter);
    }
  }

  if (currentSearchQuery) {
    const q = currentSearchQuery.toLowerCase();
    filtered = filtered.filter(c => {
      const nameMatch = c.name && c.name.toLowerCase().includes(q);
      const themeMatch = (c.themeName && c.themeName.toLowerCase().includes(q)) || (c.theme && c.theme.name && c.theme.name.toLowerCase().includes(q));
      const skillName = c.skills && c.skills[0] && c.skills[0].name && c.skills[0].name.toLowerCase().includes(q);
      const skillDesc = c.skills && c.skills[0] && c.skills[0].description && c.skills[0].description.toLowerCase().includes(q);
      return nameMatch || themeMatch || skillName || skillDesc;
    });
  }

  // 테마 필터 드롭다운 매번 갱신 (LLM이 만든 신규 카드군 실시간 반영)
  const themeSelect = document.getElementById('theme-filter-select');
  if (themeSelect) {
    const prevValue = themeSelect.value || 'all';
    // 기존 옵션 전부 제거 후 재구성
    themeSelect.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.innerText = '🌐 전체 카드군';
    themeSelect.appendChild(optAll);

    const optGeneric = document.createElement('option');
    optGeneric.value = 'generic';
    optGeneric.innerText = '🌐 범용 (카드군 미지정)';
    themeSelect.appendChild(optGeneric);

    // archetypesList + 실제 카드 데이터에서 발견되는 themeName 모두 수집
    const themeSet = new Map();
    if (state.archetypesList) {
      state.archetypesList.forEach(arc => {
        themeSet.set(arc.id, { id: arc.id, name: arc.name, icon: arc.icon || '⚜️' });
      });
    }
    // 카드 자체에 있는 themeName도 수집 (DB에 누락된 경우 대비)
    state.cardsCollection.forEach(c => {
      if (c.themeName && !themeSet.has(c.themeId)) {
        themeSet.set(c.themeId || c.themeName, { id: c.themeId || c.themeName, name: c.themeName, icon: '⚜️' });
      }
    });

    themeSet.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.innerText = `${t.icon} ${t.name}`;
      themeSelect.appendChild(opt);
    });

    // 이전 선택값 복원
    themeSelect.value = prevValue;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 text-xs">조건에 일치하는 카드가 보관함에 없습니다.</div>`;
    return;
  }

  const activeIdSet = new Set(state.activeDeckCardIds);

  filtered.forEach(card => {
    const isInDeck = activeIdSet.has(card.id);
    const cardWrap = document.createElement('div');
    cardWrap.className = 'flex flex-col items-center gap-2 relative';

    const cardEl = createCardElement(card, null, false);
    cardWrap.appendChild(cardEl);

    // 덱 편성 상태 조작 버튼
    const actionContainer = document.createElement('div');
    actionContainer.className = 'w-full flex items-center justify-between gap-1 px-1';

    if (isInDeck) {
      actionContainer.innerHTML = `
        <span class="px-2 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-300 text-[10px] font-black flex items-center gap-1">
          <i data-lucide="check" class="w-3 h-3"></i> 덱 편성 중
        </span>
        <button onclick="removeFromActiveDeck('${card.id}')" class="px-2 py-1 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-500 text-red-300 text-[10px] font-bold transition">
          제외
        </button>
      `;
    } else {
      const isDeckFull = state.activeDeckCardIds.length >= MAX_DECK_SIZE;
      actionContainer.innerHTML = `
        <button onclick="addToActiveDeck('${card.id}')" ${isDeckFull ? 'disabled' : ''} class="w-full py-1.5 rounded-lg ${isDeckFull ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed' : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black shadow-md'} text-[11px] flex items-center justify-center gap-1 transition">
          <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> 덱에 추가
        </button>
      `;
    }

    // 모든 카드(카드팩, 커스텀, 스타터) 보관함 영구 삭제 옵션 추가
    const delBtn = document.createElement('button');
    delBtn.className = 'text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-1 transition mt-0.5';
    delBtn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3"></i> 보관함에서 삭제`;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`'${card.name}' 카드를 보관함에서 완전히 삭제하시겠습니까?`)) {
        state.cardsCollection = state.cardsCollection.filter(c => c.id !== card.id);
        state.activeDeckCardIds = state.activeDeckCardIds.filter(id => id !== card.id);
        saveCardsToStorage();
        saveActiveDeckToStorage();
        renderGrimoire();
      }
    };
    cardWrap.appendChild(actionContainer);
    cardWrap.appendChild(delBtn);

    grid.appendChild(cardWrap);
  });
}

// 덱 추가 / 제거 메서드
export function addToActiveDeck(cardId) {
  if (state.activeDeckCardIds.length >= MAX_DECK_SIZE) {
    alert(`덱에는 최대 ${MAX_DECK_SIZE}장까지만 편성할 수 있습니다.`);
    return;
  }
  if (state.activeDeckCardIds.includes(cardId)) {
    return;
  }

  state.activeDeckCardIds.push(cardId);
  audio.playDraw();
  saveActiveDeckToStorage();
  renderGrimoire();
}

export function removeFromActiveDeck(cardId) {
  state.activeDeckCardIds = state.activeDeckCardIds.filter(id => id !== cardId);
  saveActiveDeckToStorage();
  renderGrimoire();
}

export function clearActiveDeck() {
  if (confirm('현재 출전 덱의 모든 카드를 제외하시겠습니까?')) {
    state.activeDeckCardIds = [];
    saveActiveDeckToStorage();
    renderGrimoire();
  }
}

export function autoFillRecommendedDeck() {
  // 밸런스형 추천 덱 자동 구성 (10장)
  const units = state.cardsCollection.filter(c => (c.cardType || 'unit') === 'unit');
  const spells = state.cardsCollection.filter(c => c.cardType === 'spell');
  const structs = state.cardsCollection.filter(c => c.cardType === 'structure');

  const selectedIds = [];

  // 소환수 5장
  units.slice(0, 5).forEach(u => selectedIds.push(u.id));
  // 주문 3장
  spells.slice(0, 3).forEach(s => selectedIds.push(s.id));
  // 건축물 2장
  structs.slice(0, 2).forEach(st => selectedIds.push(st.id));

  // 10장이 안 채워졌으면 나머지 카드에서 보충
  if (selectedIds.length < RECOMMENDED_DECK_SIZE) {
    state.cardsCollection.forEach(c => {
      if (selectedIds.length < RECOMMENDED_DECK_SIZE && !selectedIds.includes(c.id)) {
        selectedIds.push(c.id);
      }
    });
  }

  state.activeDeckCardIds = selectedIds;
  audio.playDraw();
  saveActiveDeckToStorage();
  renderGrimoire();
  alert(`✨ 밸런스 추천 덱(${state.activeDeckCardIds.length}장)이 자동으로 편성되었습니다!`);
}

export function filterCollection(element) {
  currentElementFilter = element;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('bg-amber-500', 'text-black');
    btn.classList.add('bg-[#181d33]');
  });
  if (window.event && window.event.target) {
    window.event.target.classList.add('bg-amber-500', 'text-black');
  }
  renderGrimoire();
}

export function filterType(type) {
  currentTypeFilter = type;
  document.querySelectorAll('.type-filter-btn').forEach(btn => {
    btn.classList.remove('bg-cyan-600', 'text-white');
    btn.classList.add('bg-[#181d33]', 'text-slate-300');
  });
  const activeBtn = document.getElementById(`type-filter-${type}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-cyan-600', 'text-white');
    activeBtn.classList.remove('bg-[#181d33]', 'text-slate-300');
  }
  renderGrimoire();
}

export function searchCollection(query) {
  currentSearchQuery = (query || '').trim();
  renderGrimoire();
}

export function resetStarterCardsPrompt() {
  if (confirm('기본 스타터 팩(소환수/주문/건축물 8종)을 보관함과 출전 덱으로 복원하시겠습니까?')) {
    state.cardsCollection = [...DEFAULT_STARTER_CARDS];
    state.activeDeckCardIds = DEFAULT_STARTER_CARDS.map(c => c.id);
    saveCardsToStorage();
    saveActiveDeckToStorage();
    renderGrimoire();
    alert('기본 스타터 카드 팩이 성공적으로 복원되었습니다.');
  }
}

export function exportDeckJson() {
  const exportData = {
    version: '2.0',
    cardsCollection: state.cardsCollection,
    activeDeckCardIds: state.activeDeckCardIds
  };
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `novel_duelist_deck_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

export function importDeckJsonPrompt() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          state.cardsCollection = imported;
          state.activeDeckCardIds = imported.slice(0, RECOMMENDED_DECK_SIZE).map(c => c.id);
        } else if (imported.cardsCollection) {
          state.cardsCollection = imported.cardsCollection;
          state.activeDeckCardIds = imported.activeDeckCardIds || imported.cardsCollection.slice(0, RECOMMENDED_DECK_SIZE).map(c => c.id);
        }
        await saveCardsToStorage();
        await saveActiveDeckToStorage();
        renderGrimoire();
        alert('덱 데이터를 성공적으로 불러왔습니다!');
      } catch (err) {
        alert('덱 파일 불러오기 실패: 올바른 JSON 파일인지 확인하세요.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
