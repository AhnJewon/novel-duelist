import { CardData } from '../types/game';

// 고품질 기본 스타터 카드 팩 (API 토큰 없이도 즉시 플레이 가능)
export const STARTER_CARDS: CardData[] = [
  {
    id: 'starter-1',
    name: '홍련의 검성 아스카',
    title: 'Crimson Blademaster',
    element: 'fire',
    rarity: 'legendary',
    type: 'attack',
    cost: 3,
    attack: 24,
    defense: 10,
    hp: 40,
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, masterpiece, best quality, red hair, crimson flaming katana, knight armor, intense gaze, fire sparks',
    skills: [
      {
        id: 's1-1',
        name: '일섬: 홍련참',
        description: '적에게 24의 강력한 화염 피해를 입히고 [화상]을 부여합니다.',
        cost: 3,
        effectType: 'damage',
        value: 24,
        statusEffect: { type: 'burn', duration: 2, value: 6 }
      }
    ],
    createdAt: Date.now() - 50000
  },
  {
    id: 'starter-2',
    name: '빙결의 대마법사 루시아',
    title: 'Archmage of Frost',
    element: 'water',
    rarity: 'epic',
    type: 'magic',
    cost: 2,
    attack: 16,
    defense: 8,
    hp: 30,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, masterpiece, ice sorceress, blue silver hair, crystal staff, snowflakes, freezing aura, elegant robe',
    skills: [
      {
        id: 's2-1',
        name: '프로스트 노바',
        description: '16의 냉기 피해를 주고, 1턴 동안 적의 공격력을 30% 감소시킵니다.',
        cost: 2,
        effectType: 'damage',
        value: 16,
        statusEffect: { type: 'freeze', duration: 1, value: 5 }
      }
    ],
    createdAt: Date.now() - 40000
  },
  {
    id: 'starter-3',
    name: '뇌제 발키리 브륀힐트',
    title: 'Thunder Valkyrie',
    element: 'lightning',
    rarity: 'epic',
    type: 'attack',
    cost: 3,
    attack: 28,
    defense: 6,
    hp: 35,
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, valkyrie, golden hair, lightning spear, wings of light, electric aura, floating in storm sky',
    skills: [
      {
        id: 's3-1',
        name: '천벌의 뇌창',
        description: '28의 번개 피해를 입히고 적에게 [감전] 상태를 부여합니다.',
        cost: 3,
        effectType: 'damage',
        value: 28,
        statusEffect: { type: 'shock', duration: 2, value: 8 }
      }
    ],
    createdAt: Date.now() - 30000
  },
  {
    id: 'starter-4',
    name: '성역의 수호사제 세라피나',
    title: 'Guardian Priestess',
    element: 'holy',
    rarity: 'rare',
    type: 'defense',
    cost: 2,
    attack: 8,
    defense: 22,
    hp: 38,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, holy priestess, blonde, white gold robes, glowing halo, holy barrier, divine light',
    skills: [
      {
        id: 's4-1',
        name: '아이기스의 은혜',
        description: '20의 방어막(실드)을 획득하고 체력을 8 회복합니다.',
        cost: 2,
        effectType: 'shield',
        value: 20,
        secondaryValue: 8
      }
    ],
    createdAt: Date.now() - 20000
  },
  {
    id: 'starter-5',
    name: '심연의 암살자 레이븐',
    title: 'Abyssal Assassin',
    element: 'dark',
    rarity: 'rare',
    type: 'attack',
    cost: 1,
    attack: 14,
    defense: 4,
    hp: 25,
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
    prompt: '1boy/1girl, dark assassin, hooded cloak, glowing violet eyes, twin daggers, shadow tendrils, moonlight',
    skills: [
      {
        id: 's5-1',
        name: '섀도우 스트라이크',
        description: '14의 관통 피해를 입히고, 적의 방어막을 50% 무시합니다.',
        cost: 1,
        effectType: 'damage',
        value: 14
      }
    ],
    createdAt: Date.now() - 10000
  },
  {
    id: 'starter-6',
    name: '세계수의 드루이드 실비아',
    title: 'Worldtree Druid',
    element: 'nature',
    rarity: 'rare',
    type: 'special',
    cost: 2,
    attack: 10,
    defense: 12,
    hp: 32,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, elf druid, green emerald hair, flower crown, wooden staff, glowing vines, forest glow',
    skills: [
      {
        id: 's6-1',
        name: '자연의 숨결',
        description: '체력을 16 회복하고 적에게 [맹독]을 2턴간 부여합니다.',
        cost: 2,
        effectType: 'heal',
        value: 16,
        statusEffect: { type: 'poison', duration: 2, value: 5 }
      }
    ],
    createdAt: Date.now()
  }
];
