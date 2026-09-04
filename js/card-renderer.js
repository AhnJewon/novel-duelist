// card-renderer.js - 3D 카드 렌더러 & 스킬 뱃지 컴포넌트

import { ELEMENT_CONFIG, RARITY_STYLE, CARD_TYPES } from './config.js';
import { escapeHtml, escapeJsString } from './dom-utils.js';
import { STATUS_EFFECTS } from './status-effects.js';
import { flavorRewrite } from './local-flavor.js';   // 🎭 로컬 플레이버 팩 (없으면 그대로 통과)

// ============================================================
// 🏷️ 스킬 뱃지
// ------------------------------------------------------------
// 이전에는 동일한 <span> 템플릿이 조건만 바꿔가며 15번 복붙돼 있었다.
// (뱃지 하나 추가 = 8줄짜리 인라인 HTML 한 벌 추가)
// 여기서는 스펙 1줄 = 뱃지 1개로 줄이고 마크업은 한 곳에서만 만든다.
// ============================================================

const BADGE_TONES = {
  red: 'bg-red-950/90 text-red-300 border-red-500/60',
  amber: 'bg-amber-950/90 text-amber-300 border-amber-500/60',
  rose: 'bg-rose-950/90 text-rose-300 border-rose-500/60',
  purple: 'bg-purple-950/90 text-purple-300 border-purple-500/60',
  cyan: 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60',
  blue: 'bg-blue-950/90 text-blue-300 border-blue-500/60',
  indigo: 'bg-indigo-950/90 text-indigo-300 border-indigo-500/60',
  yellow: 'bg-yellow-950/90 text-yellow-300 border-yellow-500/60',
  execute: 'bg-red-900 text-white border-red-400'
};

const STATUS_BADGE_TONES = {
  stun: 'bg-yellow-900/90 text-yellow-200 border-yellow-400',
  freeze: 'bg-cyan-900/90 text-cyan-200 border-cyan-400',
  corrosion: 'bg-lime-900/90 text-lime-200 border-lime-400',
  burn: 'bg-orange-950 text-orange-300 border-orange-500',
  shock: 'bg-amber-950 text-amber-200 border-amber-400',
  poison: 'bg-emerald-950 text-emerald-300 border-emerald-500',
  vulnerable: 'bg-purple-950 text-purple-300 border-purple-500',
  parasite: 'bg-lime-950 text-lime-300 border-lime-500',
  gestation: 'bg-emerald-950 text-emerald-200 border-emerald-400'
};

/**
 * 🔌 상태이상 뱃지 등록 — 플레이버 팩이 새 상태이상을 넣을 때 쓴다 (DECISIONS #103).
 * 등록하지 않은 타입은 뱃지가 안 그려질 뿐 게임은 정상 동작한다(호출부가 존재를 확인한다).
 * @returns 되돌리기용 이전 값 { tone, label } (없었으면 undefined)
 */
export function registerStatusBadge(type, tone, labelFn) {
  const prev = { tone: STATUS_BADGE_TONES[type], label: STATUS_BADGE_LABEL[type] };
  if (tone === undefined && labelFn === undefined) {
    delete STATUS_BADGE_TONES[type];
    delete STATUS_BADGE_LABEL[type];
  } else {
    STATUS_BADGE_TONES[type] = tone;
    STATUS_BADGE_LABEL[type] = labelFn;
  }
  return prev;
}

// 조건 / 표시문구 / 색상만 선언하면 뱃지가 만들어진다.
const SKILL_BADGE_SPECS = [
  { key: 'spell', tone: 'red', when: s => s.isAoeSpell, label: () => '💥 광역 타격' },
  { key: 'structure', tone: 'amber', when: s => !!s.passiveEffect, label: () => '🏛️ 지속 패시브' },
  { key: 'multiHit', tone: 'red', when: s => s.multiHit > 1, label: s => `🗡️ ${s.multiHit}연타` },
  { key: 'lifesteal', tone: 'rose', when: s => s.lifestealPercent > 0, label: s => `🩸 ${Math.round(s.lifestealPercent * 100)}% 흡혈` },
  { key: 'pierceShield', tone: 'purple', when: s => !!s.pierceShield, label: () => '🎯 실드관통' },
  { key: 'crit', tone: 'amber', when: s => s.critChance > 0, label: s => `⚡ 크리 ${Math.round(s.critChance * 100)}%` },
  { key: 'drawCards', tone: 'cyan', when: s => s.drawCards > 0, label: s => `🃏 +${s.drawCards} 드로우` },
  { key: 'manaGain', tone: 'blue', when: s => s.manaGain > 0, label: s => `💎 +${s.manaGain} 마나` },
  { key: 'doubleCast', tone: 'indigo', when: s => !!s.doubleCastNext, label: () => '✨ 더블캐스트' },
  { key: 'invulnerable', tone: 'yellow', when: s => s.invulnerableTurns > 0, label: s => `🛡️ ${s.invulnerableTurns}턴 무적` },
  { key: 'execute', tone: 'execute', when: s => s.executeThreshold > 0, label: s => `💀 ${Math.round(s.executeThreshold * 100)}%이하 처형` },
  // 🐛 아래는 **규칙을 바꾸는 키워드인데 카드에 표시가 없었다.**
  //    설명문에만 적혀 있어서 한눈에 알 수 없었다. 전장이 곧 방벽이 된
  //    지금은 "이 카드가 본체를 칠 수 있는가"가 카드의 핵심 정보다.
  { key: 'directAttack', tone: 'purple', when: s => !!s.directAttack, label: () => '⚔️ 직접 공격' },
  // 🆕 파괴 · 덱 서치 · 토큰 소환 (DECISIONS #85)
  { key: 'destroy', tone: 'execute', when: s => s.destroy > 0, label: s => `💀 ${s.destroy}체 파괴` },
  { key: 'searchDeck', tone: 'amber', when: s => s.searchDeck > 0, label: s => `🔍 덱 서치 ${s.searchDeck}` },
  { key: 'summonToken', tone: 'cyan', when: s => s.summonToken > 0, label: s => `👾 토큰 ${s.summonToken}체` }
];

// 상태이상 뱃지 문구는 status-effects의 정의를 따라간다.
const STATUS_BADGE_LABEL = {
  stun: st => `💫 ${st.duration || 1}턴 기절`,
  freeze: st => `❄️ 빙결 -공${st.value || STATUS_EFFECTS.freeze.defaultValue}`,
  corrosion: st => `🧪 부식 -방${st.value || STATUS_EFFECTS.corrosion.defaultValue}`,
  burn: st => `🔥 화상 ${st.value || STATUS_EFFECTS.burn.defaultValue}`,
  shock: st => `⚡ 감전 ${st.value || STATUS_EFFECTS.shock.defaultValue}`,
  poison: st => `☣️ 맹독 ${st.value || STATUS_EFFECTS.poison.defaultValue}`,
  vulnerable: () => '💥 받피증 +50%',
  // 🔄 사이클 — 남은 턴을 보여 줘야 언제 부화하는지 읽을 수 있다
  parasite: st => `🦠 기생 ${st.value || 3}`,
  gestation: st => `🌱 성장 ${st.value || 5}`
};

function badgeHtml(keywordKey, toneCls, text) {
  // 🎭 뱃지 문구도 플레이버 팩을 지난다 (팩이 없으면 원문 그대로)
  return `<span onclick="event.stopPropagation(); window.showKeywordInfo && window.showKeywordInfo('${escapeJsString(keywordKey)}')" class="cursor-pointer hover:scale-105 transition px-1.5 py-0.2 rounded text-[8.5px] font-black border ${toneCls}" title="클릭하여 상세 설명 보기">${flavorRewrite(text)}</span>`;
}

export function getSkillBadgesHtml(skill) {
  if (!skill) return '';
  const badges = [];

  for (const spec of SKILL_BADGE_SPECS) {
    if (!spec.when(skill)) continue;
    badges.push(badgeHtml(spec.key, BADGE_TONES[spec.tone] || BADGE_TONES.red, spec.label(skill)));
  }

  const st = skill.statusEffect;
  if (st && st.type && STATUS_BADGE_LABEL[st.type]) {
    badges.push(badgeHtml(st.type, STATUS_BADGE_TONES[st.type], STATUS_BADGE_LABEL[st.type](st)));
  }

  return badges.join('');
}

export function createCardElement(card, onClickHandler = null, isSmall = false, opts = {}) {
  const elCfg = ELEMENT_CONFIG[card.element] || ELEMENT_CONFIG.fire;
  const rarCfg = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
  const cardType = card.cardType || 'unit';
  const typeCfg = CARD_TYPES[cardType] || CARD_TYPES.unit;

  const cardDiv = document.createElement('div');
  cardDiv.className = `card-3d relative rounded-2xl p-2 bg-gradient-to-b ${elCfg.bg} border-2 ${elCfg.border} ${rarCfg.glow} text-white cursor-pointer shadow-xl select-none flex flex-col justify-between overflow-hidden transition-all duration-200 hover:-translate-y-2`;

  // 엄격한 고정 크기 유지 (텍스트 길이에 관계없이 카드 크기 완전 일치)
  cardDiv.style.width = isSmall ? '160px' : '205px';
  cardDiv.style.height = isSmall ? '265px' : '335px';
  // 🐛 flex 컨테이너 안에서 카드가 **줄어들지 않게** 한다. 팩 공개 슬롯(h-335, flex-col)이 카드+선택 버튼을 담으면서
  //    카드를 299px로 눌렀고, 내부 구역은 고정 높이라 하단 스탯 바가 카드의 overflow-hidden에 잘렸다 (DECISIONS #102).
  //    1:1 프레임(#101)으로 내부 합이 331이 되면서 드러났다 — 예전엔 283이라 눌려도 안 잘렸다.
  cardDiv.style.flexShrink = '0';

  // 3D 마우스 무브 틸트 인터랙션
  cardDiv.addEventListener('mousemove', (e) => {
    const rect = cardDiv.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotX = -(y / rect.height) * 18;
    const rotY = (x / rect.width) * 18;
    cardDiv.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.04, 1.04, 1.04)`;
  });
  cardDiv.addEventListener('mouseleave', () => {
    cardDiv.style.transform = `perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
  });

  if (onClickHandler) {
    cardDiv.addEventListener('click', () => onClickHandler(card));
  }

  // 💡 카드 더블 클릭 시 고화질 일러스트 확대 및 프레임 크롭/위치 조절기 모달 열기
  cardDiv.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (window.openCardCropModal) window.openCardCropModal(card);
  });

  // 홀로그램 포일 오버레이
  const holoOverlay = card.rarity === 'legendary' ? `<div class="holo-foil absolute inset-0 rounded-2xl"></div>` : '';
  const skill = (card.skills && card.skills[0]) ? card.skills[0] : { name: '기본 효과', description: `${card.attack || 0} 효과` };

  // 크롭/확대/위치 스타일 계산 (0% ~ 100% object-position 기반)
  const crop = card.crop || { scale: 1.0, x: 50, y: 35 };
  const posX = (crop.x !== undefined) ? crop.x : 50;
  const posY = (crop.y !== undefined) ? crop.y : 35;
  const scale = crop.scale || 1.0;
  const cropStyle = `object-fit: cover; object-position: ${posX}% ${posY}%; transform: scale(${scale}); transform-origin: ${posX}% ${posY}%;`;

  // 🛡️ LLM 생성 이름에 따옴표가 섞여도 마크업이 깨지지 않도록 이스케이프
  const safeName = escapeHtml(card.name);

  // 🃏 보유 매수 배지 — 2장 이상일 때만 표시 (1장은 기본이라 노이즈)
  // 보유 매수는 **보관함에서만** 의미가 있다.
  // 손패·전장·팩 개봉에 뜨면 정보만 어지럽고 전투 판단과 무관하다.
  const showCopies = !!opts.showCopies;
  const ownedCopies = Number.isFinite(parseInt(card.copies)) ? parseInt(card.copies) : 1;
  const copiesBadge = (showCopies && ownedCopies > 1)
    ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-cyan-950/90 text-cyan-200 border border-cyan-500/60" title="보유 ${ownedCopies}장">×${ownedCopies}</span>`
    : '';
  const themeLabel = card.themeName || (card.theme && card.theme.name) || null;

  // 하단 스탯 바 구성 (카드 타입별 분기)
  let statBarHtml = '';
  if (cardType === 'spell') {
    statBarHtml = `
      <div class="mt-1 flex items-center justify-between px-2 py-0.5 rounded-lg bg-purple-950/80 border border-purple-500/40 text-[10px] font-black relative z-10 text-purple-200 shrink-0">
        <span class="flex items-center gap-1">🔮 즉발 주문</span>
        <span class="text-amber-300">✨ 비전 마법</span>
      </div>
    `;
  } else if (cardType === 'trap') {
    // 🪤 함정은 스탯이 없다 — 필드에 나오지 않고 조건이 맞을 때 효과만 터진다.
    //    예전에는 소환수와 같은 공/방/체 막대를 그려서 있지도 않은 수치를 보여줬다.
    statBarHtml = `
      <div class="mt-1 flex items-center justify-between px-2 py-0.5 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-[10px] font-black relative z-10 text-indigo-200 shrink-0">
        <span class="flex items-center gap-1">🪤 함정</span>
        <span class="text-amber-300">⏳ 조건 발동</span>
      </div>
    `;
  } else if (cardType === 'structure') {
    statBarHtml = `
      <div class="mt-1 flex items-center justify-between px-2 py-0.5 rounded-lg bg-black/90 border border-amber-700/60 text-[11px] font-black relative z-10 shrink-0">
        <span class="text-amber-400 flex items-center gap-0.5">🏛️ 성물</span>
        <span class="text-blue-400 flex items-center gap-0.5"><i data-lucide="shield" class="w-3 h-3"></i> ${card.defense || 0}</span>
        <span class="text-emerald-400 flex items-center gap-0.5"><i data-lucide="shield-plus" class="w-3 h-3"></i> ${card.hp || 30}</span>
      </div>
    `;
  } else {
    statBarHtml = `
      <div class="mt-1 flex items-center justify-between px-2 py-0.5 rounded-lg bg-black/90 border border-slate-800 text-[11px] font-black relative z-10 shrink-0">
        <span title="이 소환수의 공격력" class="text-red-400 flex items-center gap-0.5"><i data-lucide="sword" class="w-3 h-3"></i> ${card.attack}</span>
        <span title="이 소환수의 방어력" class="text-blue-400 flex items-center gap-0.5"><i data-lucide="shield" class="w-3 h-3"></i> ${card.defense}</span>
        <span title="이 소환수 자신의 체력입니다 (플레이어 본체 HP와 다릅니다)" class="text-emerald-400 flex items-center gap-0.5"><i data-lucide="heart" class="w-3 h-3"></i> ${card.hp || 30}</span>
      </div>
    `;
  }

  const themeBadgeHtml = themeLabel
    ? `<span onclick="event.stopPropagation(); window.showKeywordInfo && window.showKeywordInfo('${escapeJsString(themeLabel)}')" class="cursor-pointer hover:scale-105 transition px-1.5 py-0.5 rounded text-[7.5px] font-bold bg-amber-950/90 text-amber-200 border border-amber-500/60 shadow-sm truncate max-w-[85px]" title="클릭하여 [${escapeHtml(themeLabel)}] 테마 콤보 효과 보기">⚜️ ${escapeHtml(themeLabel)}</span>`
    : `<span onclick="event.stopPropagation(); window.showKeywordInfo && window.showKeywordInfo('generic')" class="cursor-pointer hover:scale-105 transition px-1.5 py-0.5 rounded text-[7.5px] font-bold bg-slate-800 text-slate-300 border border-slate-600 shadow-sm" title="클릭하여 범용 카드 설명 보기">🌐 범용</span>`;

  cardDiv.innerHTML = `
    ${holoOverlay}

    <!-- 상단 헤더: 코스트 & 이름 & 속성 아이콘 -->
    <div class="flex items-center justify-between gap-1 relative z-10 mb-1 shrink-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <div class="w-5 h-5 rounded-full bg-cyan-500 text-slate-950 font-black flex items-center justify-center text-[11px] shadow-md shadow-cyan-500/50 shrink-0">
          ${card.cost}
        </div>
        <span class="font-black text-xs truncate text-slate-100">${safeName}</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${copiesBadge}
        <span class="text-sm" title="${elCfg.name} 속성">${elCfg.icon}</span>
      </div>
    </div>

    <!-- ⬛ 카드 일러스트 프레임 — 1:1. 🐛 예전엔 135px 고정(약 4:3)이라 카드 세로에 52px가 남아 justify-between이
         구역 사이를 빈 띠로 벌렸다("이미지와 효과 사이 베젤이 너무 넓다"). 정사각형이면 남는 세로가 거의 0이다 (DECISIONS #101) -->
    <div class="card-art-frame relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-square w-full shadow-inner shrink-0 group/frame">
      <img class="card-art-img w-full h-full object-cover block pointer-events-none" style="${cropStyle}" src="${card.imageUrl}" alt="${safeName}">
      <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none"></div>

      <!-- 더블 클릭 힌트 아이콘 (호버 시 살짝 표시) -->
      <div class="absolute top-1 right-1 opacity-0 group-hover/frame:opacity-80 transition px-1 py-0.5 rounded bg-black/70 text-[8px] text-amber-300 font-bold border border-amber-500/50 pointer-events-none flex items-center gap-0.5">
        <span>🔍 더블클릭</span>
      </div>

      <!-- 등급, 카드 타입 및 카드군(Archetype) 테마 뱃지 -->
      <div class="absolute bottom-1 left-1.5 flex flex-wrap items-center gap-1 max-w-[95%]">
        <span class="px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider ${rarCfg.badge}">
          ${(card.rarity || 'common').toUpperCase()}
        </span>
        <span onclick="event.stopPropagation(); window.showKeywordInfo && window.showKeywordInfo('${cardType}')" class="cursor-pointer hover:scale-105 transition px-1.5 py-0.5 rounded text-[8px] font-bold border ${typeCfg.badge}" title="클릭하여 ${typeCfg.name} 효과 보기">
          ${typeCfg.icon} ${typeCfg.name}
        </span>
        ${themeBadgeHtml}
      </div>
    </div>

    <!-- 📜 스킬 텍스트 박스 & 특수 효과 태그 뱃지 (고정 높이 & 내부 스크롤바) -->
    <div class="mt-1 p-1.5 rounded-lg bg-black/75 border border-slate-800 text-[9.5px] relative z-10 overflow-y-auto card-skill-scroll ${isSmall ? 'h-[62px]' : 'h-[78px]'} flex flex-col justify-start gap-1 shrink-0">
      <div class="flex items-center justify-between gap-1 shrink-0">
        <span class="font-black ${elCfg.text} truncate">⚔️ ${escapeHtml(skill.name)}</span>
      </div>
      <div class="flex flex-wrap gap-1 items-center shrink-0">
        ${getSkillBadgesHtml(skill)}
      </div>
      ${skill.isVanilla
        // 🃏 바닐라는 효과가 아니라 **플레이버 텍스트**다. 기울임 + 흐린 색으로
        //    효과 설명과 구분한다. 안 그러면 "효과가 안 적힌 카드"로 보인다.
        ? `<p class="text-slate-400/80 italic leading-snug text-[8.5px]">${escapeHtml(skill.description)}</p>`
        // 📜 규칙 텍스트(데이터 생성) + 플레이버(LLM 산문)를 **나눠서** 보여준다.
        //    실제 TCG와 같은 구조다 — 규칙은 정확하게, 분위기는 따로.
        //    → DECISIONS #91
        : `<p class="text-slate-300 leading-snug text-[8.5px]">${escapeHtml(skill.description)}</p>
           ${skill.flavorText
             ? `<p class="text-slate-500 italic leading-snug text-[8px] border-t border-slate-700/50 pt-0.5 mt-0.5">${escapeHtml(skill.flavorText)}</p>`
             : ''}`}
    </div>

    <!-- 하단 스탯 바 -->
    ${statBarHtml}
  `;

  // 이미지 오류 시 안전 폴백
  const FALLBACK_COLORS = { fire: '#991b1b', water: '#0369a1', lightning: '#a16207', holy: '#b45309', dark: '#581c87', nature: '#047857' };
  const img = cardDiv.querySelector('.card-art-img');
  if (img) {
    img.addEventListener('error', function () {
      this.style.display = 'none';
      const frame = this.closest('.card-art-frame');
      if (!frame) return;
      const fc = FALLBACK_COLORS[card.element] || '#1e293b';
      frame.style.background = `radial-gradient(circle, ${fc} 0%, #0a0c14 100%)`;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:64px;pointer-events:none;';
      overlay.textContent = elCfg.icon;
      frame.appendChild(overlay);
    });
  }

  return cardDiv;
}
