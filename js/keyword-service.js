// keyword-service.js - TCG 전투 키워드 & 카드군 테마 상세 정보 팝업 모달

import { state } from './storage.js';
import { DEFAULT_THEME_ARCHETYPES } from './data.js';
import { getAllowedElements, ELEMENT_POLICIES, describeCombo } from './archetype-identity.js';
import { ARCHETYPE_COMBO_ACTIONS } from './archetype-combos.js';

export const KEYWORD_DEFINITIONS = {
  multiHit: {
    name: '연타 (Multi-Hit)',
    icon: '🗡️',
    type: '전투 메카닉',
    subtitle: '연속 타격 피해',
    desc: '단일 턴에 공격 또는 스킬을 지정된 횟수만큼 연속으로 가격합니다. 각 타격마다 개별 방어 계산이 적용되어 누적 데미지를 폭발적으로 입힙니다.'
  },
  lifesteal: {
    name: '흡혈 (Life Steal)',
    icon: '🩸',
    type: '회복 메카닉',
    subtitle: '피해 비례 체력 회복',
    desc: '적에게 입힌 최종 피해의 일정 비율만큼 플레이어 또는 소환수의 체력을 즉시 회복합니다. 공방 일체의 유지력을 제공합니다.'
  },
  pierceShield: {
    name: '실드 관통 (Shield Pierce)',
    icon: '🎯',
    type: '방어 무시 메카닉',
    subtitle: '방어막 100% 무시 타격',
    desc: '적의 방어막(Shield)을 완전히 무시하고 적의 체력(HP)에 직접 피해를 직격합니다. 단단한 요새나 실드 위주의 적에게 치명적인 카운터 효과입니다.'
  },
  crit: {
    name: '치명타 (Critical Strike)',
    icon: '⚡',
    type: '전투 메카닉',
    subtitle: '치명타 확률 및 피해 증폭',
    desc: '일정 확률로 치명타가 발동하여 1.5배 ~ 2.0배의 강력한 폭발 피해를 입힙니다.'
  },
  drawCards: {
    name: '카드 드로우 (Draw)',
    icon: '🃏',
    type: '자원 메카닉',
    subtitle: '덱 서치 및 손패 보충',
    desc: '출전 덱에서 카드를 손패로 추가로 드로우합니다. 손패 우위를 점하여 다양한 연계 콤보를 전개할 수 있습니다.'
  },
  manaGain: {
    name: '마나 공급 (Mana Gain)',
    icon: '💎',
    type: '자원 메카닉',
    subtitle: '마나 즉시 충전',
    desc: '현재 마나를 즉시 충전합니다. 고코스트 강력한 카드나 추가 카드를 연속으로 시전할 수 있게 돕습니다.'
  },
  doubleCast: {
    name: '더블캐스트 (Double Cast)',
    icon: '✨',
    type: '비전 마법',
    subtitle: '다음 카드 2연속 발동',
    desc: '다음에 사용하는 카드(주문, 소환수 전투의 함성)가 추가 마나 소모 없이 2연속으로 발동합니다.'
  },
  invulnerable: {
    name: '절대 무적 결계 (Invulnerable)',
    icon: '🛡️',
    type: '방어 결계',
    subtitle: '모든 피해 100% 무효화',
    desc: '지정된 턴 동안 적 보스와 부하들의 모든 물리 타격 및 마법 주문 피해를 완전 무효화(0 피해)합니다.'
  },
  execute: {
    name: '처형 (Execute)',
    icon: '💀',
    type: '필살 메카닉',
    subtitle: '위기 적 처형 극딜',
    desc: '적의 체력이 일정 기준 이하(예: 35% 이하)로 떨어졌을 때, 피해량이 2.2배 이상 대폭 폭증하여 적을 즉사시킵니다.'
  },
  // ⚠️ 설명이 낡으면 안 된다. 예전에는 "도발이 없으면 본체를 칠 수 있다"는
  //    하스스톤 규칙이었지만, 지금은 **전장에 소환수가 있으면 본체를 칠 수 없다**
  //    (유희왕식). 도발의 역할은 "본체를 막는 것"에서
  //    "전장의 누구부터 맞는가를 정하는 것"으로 바뀌었다. → DECISIONS #81
  taunt: {
    name: '도발 (Taunt)',
    icon: '🛡️',
    type: '전장 보호',
    subtitle: '전장에서 가장 먼저 맞는다',
    desc: '적이 내 전장의 소환수를 공격할 때, 도발을 가진 소환수를 반드시 먼저 노려야 합니다. 뒤에 선 아군은 도발이 쓰러질 때까지 안전합니다. 건축물은 공격할 수 없으므로 언제나 도발을 가집니다. (본체 자체는 전장에 소환수가 하나라도 있으면 이미 칠 수 없습니다 — 도발이 따로 막는 것이 아닙니다)'
  },
  directAttack: {
    name: '직접 공격 (Direct Attack)',
    icon: '⚔️',
    type: '전장 무시',
    subtitle: '상대 전장을 건너뛰고 본체를 친다',
    desc: '보통은 상대 전장에 소환수가 하나라도 있으면 본체를 칠 수 없습니다. 직접 공격은 그 규칙의 유일한 예외로, 상대의 소환수와 도발을 모두 건너뛰고 본체를 직격합니다. 그만큼 값이 비싸 레어 이상에만 붙습니다.'
  },
  stun: {
    name: '기절 (Stun)',
    icon: '💫',
    type: '상태이상',
    subtitle: '1턴간 행동 완전 불능',
    desc: '기절 상태에 걸린 대상은 1턴 동안 어떤 공격이나 스킬도 사용할 수 없으며 턴이 강제 스킵됩니다.'
  },
  freeze: {
    name: '빙결 (Freeze)',
    icon: '❄️',
    type: '상태이상',
    subtitle: '결빙 및 행동 봉쇄',
    desc: '영구동토의 냉기로 적을 1턴간 완전히 결빙시켜 공격 및 콤보 전개를 봉쇄합니다.'
  },
  burn: {
    name: '화상 (Burn)',
    icon: '🔥',
    type: '상태이상',
    subtitle: '화염 지속 피해',
    desc: '매 턴 시작 시 방어막을 무시하고 고정 화염 지속 피해를 입습니다.'
  },
  shock: {
    name: '감전 (Shock)',
    icon: '⚡',
    type: '상태이상',
    subtitle: '피격 시 연쇄 번개 피해',
    desc: '감전 상태의 대상이 피해를 입을 때마다 추가 번개 충격 피해가 연쇄적으로 발생합니다.'
  },
  poison: {
    name: '맹독 (Poison)',
    icon: '☣️',
    type: '상태이상',
    subtitle: '누적 독 지속 피해',
    desc: '매 턴 종료 시 누적된 맹독 수치만큼 지속 피해를 입으며, 턴이 지날수록 치명적인 피해를 누적시킵니다.'
  },
  vulnerable: {
    name: '취약 (Vulnerable)',
    icon: '💥',
    type: '상태이상',
    subtitle: '받는 피해 +50% 증폭',
    desc: '취약 상태 동안 대상이 받는 모든 물리 및 마법 피해가 50% 추가 증폭됩니다.'
  },
  unit: {
    name: '소환수 (Unit)',
    icon: '⚔️',
    type: '카드 유형',
    subtitle: '전장 출진 전투 유닛',
    desc: '전장의 4개 슬롯 중 하나를 점유하여 직접 출진하는 생명체입니다. 공격력, 방어력, 체력을 가지며 매 턴 직접 적을 공격하고 아군을 지킵니다.'
  },
  spell: {
    name: '마법 / 주문 (Spell)',
    icon: '🔮',
    type: '카드 유형',
    subtitle: '즉발 비전 효과 & 묘지 소모',
    desc: '전장 슬롯을 차지하지 않고 즉시 시전되어 강력한 마법 피해, 전체 광역 폭격, 치유, 드로우 등을 실행한 후 묘지로 소모됩니다.'
  },
  structure: {
    name: '건축물 / 성물 (Structure)',
    icon: '🏛️',
    type: '카드 유형',
    subtitle: '지속 패시브 결계',
    desc: '공격력은 0이지만 높은 내구도를 지니며, 매 턴 시작 시 추가 마나를 공급하거나 턴 종료 시 방어막/치유를 제공하는 결계 성물입니다.'
  },
  generic: {
    name: '범용 카드 (Generic / Staple)',
    icon: '🌐',
    type: '카드 분류',
    subtitle: '특정 카드군에 얽매이지 않는 만능 용병/주문',
    desc: '특정 테마 카드군에 속하지 않고, 뛰어난 자체 스펙(드로우, 실드관통, 도발, 스턴, 마나 수급 등)을 보유하여 어떤 덱에도 자유롭게 투입할 수 있는 다목적 범용 카드입니다.'
  }
};

export function showKeywordInfo(keyOrThemeName, extraValue = '') {
  const modal = document.getElementById('keyword-info-modal');
  if (!modal) return;

  const iconEl = document.getElementById('keyword-modal-icon');
  const titleEl = document.getElementById('keyword-modal-title');
  const typeBadgeEl = document.getElementById('keyword-modal-type-badge');
  const subtitleEl = document.getElementById('keyword-modal-subtitle');
  const descEl = document.getElementById('keyword-modal-description');
  const extraBox = document.getElementById('keyword-modal-extra-box');
  const cardCountEl = document.getElementById('keyword-modal-card-count');
  const cardsListEl = document.getElementById('keyword-modal-cards-list');

  // 1. 기본 전투 키워드 사전에서 검색
  if (KEYWORD_DEFINITIONS[keyOrThemeName]) {
    const def = KEYWORD_DEFINITIONS[keyOrThemeName];
    if (iconEl) iconEl.innerText = def.icon;
    if (titleEl) titleEl.innerText = def.name;
    if (typeBadgeEl) typeBadgeEl.innerText = def.type;
    if (subtitleEl) subtitleEl.innerText = def.subtitle;
    if (descEl) descEl.innerText = def.desc;
    if (extraBox) extraBox.classList.add('hidden');
  } 
  // 2. 카드군(Archetype / Theme) 테마 검색
  else {
    const themeName = keyOrThemeName.replace(/^⚜️\s*/, '').trim();
    const allThemes = state.archetypesList || DEFAULT_THEME_ARCHETYPES;
    const theme = allThemes.find(t => t.name === themeName || t.id === themeName || t.keyword === themeName || themeName.includes(t.name) || themeName.includes(t.keyword));

    if (theme) {
      if (iconEl) iconEl.innerText = theme.icon || '⚜️';
      if (titleEl) titleEl.innerText = theme.name;
      if (typeBadgeEl) {
        typeBadgeEl.innerText = `⚜️ 카드군 (${theme.element.toUpperCase()})`;
        typeBadgeEl.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-200 border border-amber-500/70';
      }
      if (subtitleEl) {
        const els = getAllowedElements(theme);
        const policy = ELEMENT_POLICIES[theme.elementPolicy] || ELEMENT_POLICIES.mono;
        const elemText = els.length > 1 ? `${policy.label} (${els.join('/')})` : (els[0] || theme.element);
        subtitleEl.innerText = `키워드 [${theme.keyword}] · ${elemText} · ${describeCombo(theme, ARCHETYPE_COMBO_ACTIONS[theme.comboAction]?.label || '연계')}`;
      }
      if (descEl) {
        descEl.innerHTML = `
          <div class="space-y-2">
            <div class="text-amber-300 font-bold">📜 테마 콤보 효과:</div>
            <div class="p-2 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-100">
              ${theme.description || (theme.synergy ? theme.synergy.desc : '테마 카드 상호 연계')}
            </div>
            <div class="text-[11px] text-slate-400">
              💡 <b>정통 TCG 룰:</b> 이 카드군에 속한 카드를 시전할 때마다 덱 서치, 연쇄 폭격, 마력 공명 등의 테마 고유 콤보가 즉시 발동합니다.
            </div>
          </div>
        `;
      }

      // 내 마도서에 보유한 해당 테마 카드 탐색
      const matchingCards = (state.cardsCollection || []).filter(c => 
        c.themeName === theme.name || c.themeId === theme.id || (theme.keyword && c.name && c.name.includes(theme.keyword))
      );

      if (extraBox && cardCountEl && cardsListEl) {
        extraBox.classList.remove('hidden');
        cardCountEl.innerText = `총 ${matchingCards.length}장 보유`;
        cardsListEl.innerHTML = '';
        if (matchingCards.length > 0) {
          matchingCards.forEach(c => {
            const span = document.createElement('span');
            span.className = 'px-2 py-1 rounded-lg bg-black/60 border border-slate-700 text-[10.5px] text-slate-200 flex items-center gap-1';
            span.innerHTML = `<span>${c.element === 'fire' ? '🔥' : (c.element === 'water' ? '💧' : '⚡')}</span> <b>${c.name}</b>`;
            cardsListEl.appendChild(span);
          });
        } else {
          cardsListEl.innerHTML = '<span class="text-[11px] text-slate-500">현재 보관함에 해당 카드군 카드가 없습니다. 연성소에서 제작해보세요!</span>';
        }
      }
    } else {
      // 일반 단어
      if (iconEl) iconEl.innerText = '🏷️';
      if (titleEl) titleEl.innerText = themeName;
      if (typeBadgeEl) typeBadgeEl.innerText = '카드 속성/키워드';
      if (subtitleEl) subtitleEl.innerText = '특수 속성 정보';
      if (descEl) descEl.innerText = `${themeName} 효과입니다. 카드를 낼 때 해당 능력이 인게임에 반영됩니다.`;
      if (extraBox) extraBox.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

export function closeKeywordInfoModal() {
  const modal = document.getElementById('keyword-info-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}
