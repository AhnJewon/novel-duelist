import { EnemyData } from '../types/game';

export const ENEMIES: EnemyData[] = [
  {
    id: 'boss-1',
    name: '흑염룡의 사도 바알',
    title: 'Apostle of Black Flame',
    element: 'fire',
    maxHp: 120,
    currentHp: 120,
    shield: 0,
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    actions: [
      { type: 'attack', name: '칠흑의 발톱', value: 14, description: '14의 피해를 입힙니다.' },
      { type: 'charge', name: '멸망의 용숨결 (차징)', value: 0, description: '다음 턴에 초강력 공격을 준비합니다!', dialogue: '크큭... 내 안의 불길을 감당할 수 있겠느냐!' },
      { type: 'magic', name: '헬파이어 브레스', value: 28, description: '28의 치명적인 화염 피해!' },
      { type: 'shield', name: '화염 장벽', value: 18, description: '18의 방어막을 전개합니다.' }
    ],
    currentActionIndex: 0,
    dialogueOnStart: '하찮은 듀얼리스트여, 내 불꽃 앞에서는 재가 될 뿐이다!',
    dialogueOnDefeat: '말도 안 돼... 내 불길이 꺼지다니...!'
  },
  {
    id: 'boss-2',
    name: '서리 마녀 엘리시아',
    title: 'Frost Witch Alicia',
    element: 'water',
    maxHp: 150,
    currentHp: 150,
    shield: 15,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    actions: [
      { type: 'magic', name: '얼음 송곳', value: 16, description: '16의 냉기 피해를 입힙니다.' },
      { type: 'shield', name: '빙벽 전개', value: 25, description: '25의 단단한 얼음 방패를 얻습니다.' },
      { type: 'magic', name: '절대영도 블리자드', value: 22, description: '22의 광역 냉기 폭풍!' },
      { type: 'attack', name: '서리 칼날', value: 18, description: '18의 관통 피해를 입힙니다.' }
    ],
    currentActionIndex: 0,
    dialogueOnStart: '차가운 침묵 속에서 영원히 잠드세요...',
    dialogueOnDefeat: '얼어붙었던 심장이... 녹아내리네요...'
  },
  {
    id: 'boss-3',
    name: '심연의 마왕 벨제부브',
    title: 'Abyssal Lord Beelzebub',
    element: 'dark',
    maxHp: 200,
    currentHp: 200,
    shield: 20,
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
    actions: [
      { type: 'attack', name: '암흑 참격', value: 20, description: '20의 암흑 피해를 입힙니다.' },
      { type: 'magic', name: '영혼 흡수', value: 15, description: '15의 피해를 주고 적의 체력을 10 흡수합니다.' },
      { type: 'charge', name: '종말의 심연 개방', value: 0, description: '심연의 에너지를 모으고 있습니다!' },
      { type: 'magic', name: '아포칼립스', value: 35, description: '35의 파멸적인 암흑 대폭발!' }
    ],
    currentActionIndex: 0,
    dialogueOnStart: '빛은 사라지고 오직 영원한 어둠만이 남으리라!',
    dialogueOnDefeat: '크아악...! 어떻게 이런 힘을...!'
  }
];
