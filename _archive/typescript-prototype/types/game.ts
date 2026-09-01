export type ElementType = 'fire' | 'water' | 'lightning' | 'holy' | 'dark' | 'nature';
export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CardType = 'attack' | 'defense' | 'magic' | 'special';

export interface CardSkill {
  id: string;
  name: string;
  description: string;
  cost: number;
  effectType: 'damage' | 'shield' | 'heal' | 'buff' | 'debuff';
  value: number;
  secondaryValue?: number;
  statusEffect?: {
    type: 'burn' | 'freeze' | 'shock' | 'poison' | 'vulnerable';
    duration: number;
    value: number;
  };
}

export interface CardData {
  id: string;
  name: string;
  title?: string;
  element: ElementType;
  rarity: CardRarity;
  type: CardType;
  cost: number;
  attack: number;
  defense: number;
  hp: number;
  imageUrl: string;
  prompt: string;
  skills: CardSkill[];
  createdAt: number;
  isCustom?: boolean;
}

export interface EnemyAction {
  type: 'attack' | 'shield' | 'magic' | 'charge';
  name: string;
  value: number;
  description: string;
  dialogue?: string;
}

export interface EnemyData {
  id: string;
  name: string;
  title: string;
  element: ElementType;
  maxHp: number;
  currentHp: number;
  shield: number;
  imageUrl: string;
  actions: EnemyAction[];
  currentActionIndex: number;
  dialogueOnStart: string;
  dialogueOnDefeat: string;
}

export interface NovelAISettings {
  apiKey: string;
  model: string;
  resolution: 'portrait-normal' | 'portrait-small' | 'square-normal';
  steps: number;
  scale: number;
  sampler: string;
  safeMode0Anlas: boolean;
  ucPreset: number;
  negativePrompt: string;
}

export interface BattleLog {
  id: string;
  text: string;
  type: 'player' | 'enemy' | 'system' | 'crit' | 'skill';
}
