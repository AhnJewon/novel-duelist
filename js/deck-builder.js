// deck-builder.js - 카드 도감(보관함) & 전투 덱 빌더

import { state, saveCardsToStorage, saveActiveDeckToStorage, MAX_DECK_SIZE, RECOMMENDED_DECK_SIZE, MAX_COPIES_PER_CARD } from './storage.js';
import { createCardElement } from './card-renderer.js';
import { DEFAULT_STARTER_CARDS } from './data.js';
import { audio } from './audio.js';
import { ELEMENT_CONFIG, CARD_TYPES } from './config.js';
import { getCopies, getDust, MAX_CARD_COPIES } from './card-copies.js';
import { escapeHtml, escapeJsString } from './dom-utils.js';
import { TRAP_TRIGGERS } from './trap-system.js';
import { RACE_CONFIG, readRaces } from './races.js';   // 🧬 종족 (DECISIONS #106)

let currentRaceFilter = 'all';   // 🧬 종족 필터 (DECISIONS #106)
let currentElementFilter = 'all';
let currentTypeFilter = 'all';
let currentThemeFilter = 'all';
let currentSearchQuery = '';
// 🔎 상세 필터 (DECISIONS #102) — 등급·코스트·효과 종류·함정 조건·덱 포함·정렬
let currentRarityFilter = 'all';
let currentCostFilter = 'all';
let currentEffectFilter = 'all';
let currentTrapFilter = 'all';
let currentDeckFilter = 'all';
let currentSort = 'newest';

const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
const skillOf = (c) => (c.skills && c.skills[0]) || c.skill || {};
const hasStatus = (s) => !!(s.statusEffect && s.statusEffect.type && s.statusEffect.type !== 'none');

/** 효과 종류 필터 — 카드 데이터에서 판정한다 (설명문이 아니라 필드) */
function matchesEffectFilter(c, kind) {
  const s = skillOf(c);
  switch (kind) {
    case 'damage':  return (s.damage || 0) > 0;
    case 'shield':  return (s.shield || 0) > 0;
    case 'heal':    return (s.heal || 0) > 0 || (s.maxHpGain || 0) > 0;
    case 'draw':    return (s.drawCards || 0) > 0 || (s.manaGain || 0) > 0;
    case 'status':  return hasStatus(s);
    case 'control': return (s.destroy || 0) > 0 || (s.searchDeck || 0) > 0 || (s.summonToken || 0) > 0 || !!s.silence || (s.attackDown || 0) > 0;
    case 'passive': return !!s.passiveEffect;
    case 'vanilla': return !!s.isVanilla;
    case 'combo':   return !!(c.themeId || c.themeName);
    default: return true;
  }
}

function sortCards(list, mode) {
  const arr = list.slice();
  const name = (c) => String(c.name || '');
  switch (mode) {
    case 'name':   return arr.sort((a, b) => name(a).localeCompare(name(b), 'ko'));
    case 'cost':   return arr.sort((a, b) => (a.cost || 0) - (b.cost || 0) || name(a).localeCompare(name(b), 'ko'));
    case 'rarity': return arr.sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0) || (b.cost || 0) - (a.cost || 0));
    case 'attack': return arr.sort((a, b) => (b.attack || 0) - (a.attack || 0));
    case 'hp':     return arr.sort((a, b) => (b.hp || 0) - (a.hp || 0));
    default:       return arr;   // newest — 보관함은 최신이 앞에 온다(unshift)
  }
}

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

  // 💎 가루 — 보관함에서만 보인다. 전투 중에는 볼 이유가 없다.
  const dustEl = document.getElementById('dust-amount');
  if (dustEl) dustEl.innerText = getDust().toLocaleString('ko-KR');

  grid.innerHTML = '';

  if (countText) {
    countText.innerText = state.cardsCollection.length;
  }

  // 필터링 적용
  let filtered = state.cardsCollection;

  if (currentElementFilter !== 'all') {
    filtered = filtered.filter(c => c.element === currentElementFilter);
  }

  if (currentRaceFilter !== 'all') {
    filtered = filtered.filter(c => readRaces(c).includes(currentRaceFilter));
  }

  if (currentTypeFilter !== 'all') {
    filtered = filtered.filter(c => (c.cardType || 'unit') === currentTypeFilter);
  }

  if (currentThemeFilter !== 'all') {
    if (currentThemeFilter === 'generic') {
      filtered = filtered.filter(c => (!c.themeName && !(c.theme && c.theme.name)) || c.isGeneric);
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
  // 🔎 상세 필터
  if (currentRarityFilter !== 'all') filtered = filtered.filter(c => (c.rarity || 'common') === currentRarityFilter);
  if (currentCostFilter !== 'all') {
    filtered = currentCostFilter === '5+'
      ? filtered.filter(c => (c.cost || 0) >= 5)
      : filtered.filter(c => (c.cost || 0) === parseInt(currentCostFilter, 10));
  }
  if (currentEffectFilter !== 'all') filtered = filtered.filter(c => matchesEffectFilter(c, currentEffectFilter));
  if (currentTrapFilter !== 'all') filtered = filtered.filter(c => c.cardType === 'trap' && skillOf(c).trapTrigger === currentTrapFilter);
  if (currentDeckFilter !== 'all') {
    const inDeckIds = new Set(state.activeDeckCardIds || []);
    filtered = filtered.filter(c => currentDeckFilter === 'in' ? inDeckIds.has(c.id) : !inDeckIds.has(c.id));
  }
  filtered = sortCards(filtered, currentSort);

  // 함정 조건 셀렉트는 실제 보유 함정의 조건으로 채운다 (없는 조건은 고를 수 없게)
  const trapSelect = document.getElementById('trap-filter-select');
  if (trapSelect) {
    const prev = trapSelect.value || 'all';
    const present = new Map();
    state.cardsCollection.forEach(c => { if (c.cardType === 'trap') { const t = skillOf(c).trapTrigger; if (t) present.set(t, (present.get(t) || 0) + 1); } });
    trapSelect.innerHTML = '<option value="all">함정 조건 전체</option>' +
      [...present.entries()].map(([t, n]) => `<option value="${t}">🪤 ${escapeHtml((TRAP_TRIGGERS[t] && TRAP_TRIGGERS[t].label) || t)} (${n})</option>`).join('');
    trapSelect.value = [...trapSelect.options].some(o => o.value === prev) ? prev : 'all';
    if (trapSelect.value === 'all') currentTrapFilter = 'all';
  }
  // 🧬 종족 셀렉트도 **보유한 종족만** 채운다. 옵션을 코드가 만들므로 플레이버 팩이
  //    이름을 바꾸면 필터에도 그대로 반영된다 (index.html에 박아 두면 안 바뀐다).
  const raceSelect = document.getElementById('race-filter-select');
  if (raceSelect) {
    const prev = raceSelect.value || 'all';
    const present = new Map();
    state.cardsCollection.forEach(c => readRaces(c).forEach(r => present.set(r, (present.get(r) || 0) + 1)));
    raceSelect.innerHTML = '<option value="all">종족 전체</option>' +
      [...present.entries()].map(([r, n]) => {
        const spec = RACE_CONFIG[r] || { icon: '🧬', name: r };
        return `<option value="${r}">${spec.icon} ${escapeHtml(spec.name)} (${n})</option>`;
      }).join('');
    raceSelect.value = [...raceSelect.options].some(o => o.value === prev) ? prev : 'all';
    if (raceSelect.value === 'all') currentRaceFilter = 'all';
  }

  const countEl = document.getElementById('grimoire-filter-count');
  if (countEl) countEl.innerText = filtered.length === state.cardsCollection.length ? '' : `${filtered.length} / ${state.cardsCollection.length}장`;

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
    // 병합·삭제로 사라진 카드군이 선택돼 있으면 전체로 되돌린다 (빈 화면 방지)
    const stillExists = Array.from(themeSelect.options).some(o => o.value === prevValue);
    themeSelect.value = stillExists ? prevValue : 'all';
    if (!stillExists) currentThemeFilter = 'all';
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 text-xs">조건에 일치하는 카드가 보관함에 없습니다.</div>`;
    return;
  }

  // 중복 편성을 매수로 보여준다
  const deckCounts = state.activeDeckCardIds.reduce((m, id) => { m[id] = (m[id] || 0) + 1; return m; }, {});

  filtered.forEach(card => {
    const copies = deckCounts[card.id] || 0;
    const isInDeck = copies > 0;
    const cardWrap = document.createElement('div');
    cardWrap.className = 'flex flex-col items-center gap-2 relative';

    const cardEl = createCardElement(card, null, false, { showCopies: true });
    cardWrap.appendChild(cardEl);

    // 덱 편성 조작 — 중복 편성이 가능하므로 +/− 스테퍼로 만든다.
    // (예전에는 "덱에 추가" 버튼이 한 번 누르면 "제외" 버튼으로 바뀌어
    //  두 번째 사본을 넣을 방법이 없었다)
    const actionContainer = document.createElement('div');
    actionContainer.className = 'w-full flex flex-col gap-1 px-1';

    const owned = getCopies(card);
    const isDeckFull = state.activeDeckCardIds.length >= MAX_DECK_SIZE;
    const canAdd = copies < owned && !isDeckFull;

    const addTitle = isDeckFull
      ? `덱이 가득 찼습니다 (${MAX_DECK_SIZE}장)`
      : (copies >= owned ? `보유한 ${owned}장을 모두 넣었습니다` : '한 장 더 넣기');

    actionContainer.innerHTML = `
      <div class="w-full flex items-center justify-between gap-1">
        <button onclick="removeFromActiveDeck('${escapeJsString(card.id)}')" ${copies === 0 ? 'disabled' : ''}
                title="한 장 빼기"
                class="w-8 h-8 shrink-0 rounded-lg text-sm font-black transition ${copies === 0
                  ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
                  : 'bg-red-950/80 hover:bg-red-900 border border-red-500 text-red-300'}">−</button>

        <div class="flex-1 text-center leading-tight">
          <div class="text-[11px] font-black ${copies > 0 ? 'text-emerald-300' : 'text-slate-500'}">
            덱 ${copies} / ${owned}
          </div>
          <div class="text-[9px] text-slate-500">보유 ${owned}장</div>
        </div>

        <button onclick="addToActiveDeck('${escapeJsString(card.id)}')" ${canAdd ? '' : 'disabled'}
                title="${escapeHtml(addTitle)}"
                class="w-8 h-8 shrink-0 rounded-lg text-sm font-black transition ${canAdd
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
                  : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'}">+</button>
      </div>
      ${copies >= owned && owned < MAX_CARD_COPIES ? `
        <div class="text-[9px] text-amber-400/80 text-center">
          카드팩에서 같은 카드를 더 뽑으면 최대 ${MAX_CARD_COPIES}장까지 늘어납니다
        </div>` : ''}
    `;

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
  const card = state.cardsCollection.find(c => c.id === cardId);
  if (!card) return;

  // 🃏 덱 편성 매수는 **보유 매수**를 넘을 수 없다.
  //    보관함에 1장뿐인데 덱에 3장 넣는 건 말이 안 된다.
  //    (스타터는 3장씩 지급되고, 카드팩에서 중복이 나오면 매수가 는다)
  const owned = getCopies(card);
  const inDeck = state.activeDeckCardIds.filter(id => id === cardId).length;
  if (inDeck >= owned) {
    alert(`[${card.name}]은(는) ${owned}장 보유 중입니다.\n보유한 만큼만 덱에 넣을 수 있습니다.\n\n카드팩에서 같은 카드를 더 뽑으면 매수가 늘어납니다.`);
    return;
  }

  state.activeDeckCardIds.push(cardId);
  audio.playDraw();
  saveActiveDeckToStorage();
  renderGrimoire();
}

export function removeFromActiveDeck(cardId) {
  // 중복 편성이 가능하므로 한 장만 뺀다
  const idx = state.activeDeckCardIds.indexOf(cardId);
  if (idx === -1) return;
  state.activeDeckCardIds.splice(idx, 1);
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
  // 🐛 수정: 이전에는 window.event.target에 의존했다. window.event는 비표준이라
  //          모듈/비동기 경로에서는 undefined가 되어 선택 버튼 하이라이트가 사라졌다.
  //          filterType과 동일하게 id 기반으로 통일한다.
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('bg-amber-500', 'text-black', 'font-bold');
    btn.classList.add('bg-[#181d33]');
  });
  const activeBtn = document.getElementById(`element-filter-${element}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-amber-500', 'text-black', 'font-bold');
    activeBtn.classList.remove('bg-[#181d33]');
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

// 🔎 상세 필터 세터 (DECISIONS #102)
export function filterRarity(v) { currentRarityFilter = v || 'all'; renderGrimoire(); }
export function filterCost(v) { currentCostFilter = v || 'all'; renderGrimoire(); }
export function filterEffect(v) { currentEffectFilter = v || 'all'; renderGrimoire(); }
export function filterTrapTrigger(v) { currentTrapFilter = v || 'all'; renderGrimoire(); }
export function filterRace(v) { currentRaceFilter = v || 'all'; renderGrimoire(); }
export function filterDeckStatus(v) { currentDeckFilter = v || 'all'; renderGrimoire(); }
export function sortCollection(v) { currentSort = v || 'newest'; renderGrimoire(); }
export function resetGrimoireFilters() {
  currentRarityFilter = currentCostFilter = currentEffectFilter = currentTrapFilter = currentDeckFilter = 'all';
  currentRaceFilter = 'all';
  currentSort = 'newest';
  currentSearchQuery = '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('rarity-filter-select', 'all'); set('cost-filter-select', 'all'); set('effect-filter-select', 'all');
  set('trap-filter-select', 'all'); set('deck-filter-select', 'all'); set('sort-select', 'newest'); set('grimoire-search', '');
  set('race-filter-select', 'all');
  filterType('all');
  filterCollection('all');
  filterTheme('all');
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
