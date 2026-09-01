import { CardData, NovelAISettings } from '../types/game';
import { STARTER_CARDS } from '../data/starterCards';
import { DEFAULT_SETTINGS } from './novelai';

const CARDS_STORAGE_KEY = 'novel_duelist_cards';
const DECK_STORAGE_KEY = 'novel_duelist_deck_ids';
const SETTINGS_STORAGE_KEY = 'novel_duelist_settings';

export const storage = {
  // 모든 카드 불러오기 (스타터 + 커스텀)
  getCards(): CardData[] {
    try {
      const stored = localStorage.getItem(CARDS_STORAGE_KEY);
      if (!stored) {
        // 최초 실행 시 스타터 카드 저장
        localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(STARTER_CARDS));
        return STARTER_CARDS;
      }
      return JSON.parse(stored);
    } catch (e) {
      console.error('카드 로드 실패:', e);
      return STARTER_CARDS;
    }
  },

  // 새 카드 저장
  saveCard(card: CardData): void {
    const cards = this.getCards();
    const updated = [card, ...cards];
    localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(updated));

    // 자동으로 활성 덱에도 추가
    const deck = this.getDeckCardIds();
    if (!deck.includes(card.id)) {
      this.saveDeckCardIds([card.id, ...deck]);
    }
  },

  // 카드 삭제
  deleteCard(id: string): void {
    const cards = this.getCards().filter(c => c.id !== id);
    localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(cards));

    const deck = this.getDeckCardIds().filter(deckId => deckId !== id);
    this.saveDeckCardIds(deck);
  },

  // 덱 카드 ID 목록 가져오기
  getDeckCardIds(): string[] {
    try {
      const stored = localStorage.getItem(DECK_STORAGE_KEY);
      if (!stored) {
        const defaultDeck = STARTER_CARDS.map(c => c.id);
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(defaultDeck));
        return defaultDeck;
      }
      return JSON.parse(stored);
    } catch (e) {
      return STARTER_CARDS.map(c => c.id);
    }
  },

  // 덱 카드 ID 목록 저장
  saveDeckCardIds(ids: string[]): void {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(ids));
  },

  // 설정 가져오기
  getSettings(): NovelAISettings {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!stored) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  },

  // 설정 저장
  saveSettings(settings: NovelAISettings): void {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  },

  // 카드 데이터 JSON 내보내기
  exportData(): string {
    const data = {
      cards: this.getCards(),
      deck: this.getDeckCardIds(),
      version: '1.0'
    };
    return JSON.stringify(data, null, 2);
  },

  // 카드 데이터 JSON 가져오기
  importData(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (Array.isArray(parsed.cards)) {
        localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(parsed.cards));
        if (Array.isArray(parsed.deck)) {
          localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(parsed.deck));
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('Import 실패:', e);
      return false;
    }
  }
};
