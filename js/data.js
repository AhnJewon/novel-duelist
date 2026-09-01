// data.js - 게임 데이터 (스타터 카드, 6대 속성 보스, 속성별 보스 부하)

export const DEFAULT_STARTER_CARDS = [
  // === [소환수 / Unit] ===
  {
    id: 'starter-1',
    cardType: 'unit',
    name: '홍련의 검성 아스카',
    title: 'Crimson Blademaster',
    element: 'fire',
    themeId: 'theme_crimson_knights',
    themeName: '홍련의 검사단',
    rarity: 'legendary',
    cost: 3,
    attack: 18,
    defense: 6,
    hp: 28,
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, masterpiece, best quality, red hair, crimson flaming katana, knight armor, intense gaze, fire sparks',
    skills: [{
      name: '일섬: 3연속 홍련참',
      description: '3연속 베기로 총 18 화염 피해를 입히고 적에게 화상을 부여합니다.',
      cost: 3,
      damage: 18,
      multiHit: 3,
      critChance: 0.3,
      critMultiplier: 1.8,
      statusEffect: { type: 'burn', duration: 2, value: 6 }
    }]
  },
  {
    id: 'starter-2',
    cardType: 'unit',
    name: '빙결의 대마도사 루시아',
    title: 'Archmage of Frost',
    element: 'water',
    themeId: 'theme_frost_coven',
    themeName: '서리 마법결사',
    rarity: 'epic',
    cost: 2,
    attack: 12,
    defense: 8,
    hp: 22,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, masterpiece, ice sorceress, blue silver hair, crystal staff, snowflakes, freezing aura',
    skills: [{
      name: '프로스트 노바 & 기절',
      description: '12 냉기 피해를 주고 적을 1턴간 완전히 기절시킵니다.',
      cost: 2,
      damage: 12,
      drawCards: 1,
      statusEffect: { type: 'stun', duration: 1, value: 0 }
    }]
  },
  {
    id: 'starter-3',
    cardType: 'unit',
    name: '뇌제 발키리 브륀힐트',
    title: 'Thunder Valkyrie',
    element: 'lightning',
    themeId: 'theme_thunder_valkyrie',
    themeName: '뇌제 발키리아',
    rarity: 'epic',
    cost: 3,
    attack: 20,
    defense: 5,
    hp: 24,
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, valkyrie, golden hair, lightning spear, wings of light, electric aura',
    skills: [{
      name: '천벌의 뇌창 & 과충전',
      description: '20의 강력한 번개 피해와 함께 다음 카드를 2연속 발동합니다!',
      cost: 3,
      damage: 20,
      critChance: 0.4,
      doubleCastNext: true
    }]
  },
  {
    id: 'starter-4',
    cardType: 'unit',
    name: '성역의 수호사제 세라피나',
    title: 'Guardian Priestess',
    element: 'holy',
    themeId: 'theme_sanctuary_priestess',
    themeName: '성역의 수호사제',
    rarity: 'rare',
    cost: 2,
    attack: 6,
    defense: 14,
    hp: 26,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: '1girl, holy priestess, blonde, white gold robes, glowing halo, holy barrier',
    skills: [{
      name: '아이기스의 무적 은혜',
      description: '14 방어막을 얻고 체력을 8 회복하며 1턴간 무적 결계를 펼칩니다.',
      cost: 2,
      shield: 14,
      heal: 8,
      invulnerableTurns: 1
    }]
  },
  {
    id: 'starter-5',
    cardType: 'unit',
    name: '심연의 암살자 레이븐',
    title: 'Abyssal Assassin',
    element: 'dark',
    themeId: 'theme_abyssal_shadows',
    themeName: '심연의 그림자단',
    rarity: 'rare',
    cost: 1,
    attack: 10,
    defense: 3,
    hp: 18,
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
    prompt: '1boy, dark assassin, hooded cloak, glowing violet eyes, twin daggers',
    skills: [{
      name: '그림자 흡혈 암살',
      description: '적 방어막을 100% 무시하고 피해의 50%를 흡혈합니다. (보스 체력 35% 이하 시 처형 2배 피해)',
      cost: 1,
      damage: 10,
      pierceShield: true,
      lifestealPercent: 0.5,
      executeThreshold: 0.35
    }]
  },

  // === [주문/마법 / Spell - 필드 비점유 즉발 발동] ===
  {
    id: 'starter-spell-1',
    cardType: 'spell',
    name: '종말의 메테오 스트라이크',
    title: 'Apocalypse Meteor Strike',
    element: 'fire',
    rarity: 'legendary',
    cost: 3,
    attack: 22,
    defense: 0,
    hp: 0,
    imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
    prompt: 'giant blazing meteor falling from dark stormy sky, apocalyptic inferno, magical runes, fantasy digital art',
    skills: [{
      name: '천체 붕괴 폭격',
      description: '[즉발 주문] 적 보스와 모든 부하에게 22의 화염 피해를 퍼붓고 2턴간 화상을 입힙니다.',
      cost: 3,
      damage: 22,
      isAoeSpell: true,
      statusEffect: { type: 'burn', duration: 2, value: 8 }
    }]
  },
  {
    id: 'starter-spell-2',
    cardType: 'spell',
    name: '시공의 왜곡: 타임 리프',
    title: 'Chrono Rift & Time Warp',
    element: 'holy',
    rarity: 'epic',
    cost: 2,
    attack: 0,
    defense: 0,
    hp: 0,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: 'glowing clockwork portal, time rift, holy golden feathers, sacred divine light, cosmic dust',
    skills: [{
      name: '시간의 은총',
      description: '[즉발 주문] 마나 +1을 충전하고 카드 1장을 드로우하며, 1턴간 무적 결계를 펼칩니다.',
      cost: 2,
      manaGain: 1,
      drawCards: 1,
      invulnerableTurns: 1,
      heal: 8
    }]
  },

  // === [건축물/성물 / Structure - 전장 배치 및 턴마다 지속 패시브] ===
  {
    id: 'starter-struct-1',
    cardType: 'structure',
    name: '신비의 마나 수정탑',
    title: 'Arcane Mana Pylon',
    element: 'water',
    rarity: 'rare',
    cost: 2,
    attack: 0,
    defense: 8,
    hp: 22,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    prompt: 'crystal magical tower, floating glowing blue crystals, mana fountain, fantasy architecture, ancient runes',
    skills: [{
      name: '마나 공명 오라',
      description: '[건축물 패시브] 매 턴 시작 시 마나 +1을 영구 추가 공급하며, 턴 종료 시 무작위 아군 1체에게 실드 +6을 부여합니다.',
      cost: 2,
      passiveEffect: {
        type: 'mana_battery',
        manaPerTurn: 1,
        endTurnShield: 6
      }
    }]
  },
  {
    id: 'starter-struct-2',
    cardType: 'structure',
    name: '아이기스의 수호 철옹성',
    title: 'Aegis Fortress of Light',
    element: 'holy',
    rarity: 'legendary',
    cost: 3,
    attack: 0,
    defense: 14,
    hp: 32,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: 'magnificent holy fortress castle, glowing golden barrier, heavenly citadel, fantasy stone stronghold',
    skills: [{
      name: '철옹성의 가호',
      description: '[건축물 도발] 보스의 단일 공격을 최우선으로 흡수합니다. 매 턴 종료 시 모든 아군과 본체에 방어막 +8 & 체력 4를 회복시킵니다.',
      cost: 3,
      taunt: true,
      passiveEffect: {
        type: 'fortress_wall',
        endTurnAoeShield: 8,
        endTurnAoeHeal: 4
      }
    }]
  },

  // === [🌐 범용 카드 / Generic Staple Cards - 무소속 만능 용병 & 필수 주문] ===
  {
    id: 'starter-generic-1',
    cardType: 'unit',
    name: '방랑의 용병 검사',
    title: 'Wandering Mercenary',
    element: 'nature',
    themeId: null,
    themeName: null,
    isGeneric: true,
    rarity: 'rare',
    cost: 2,
    attack: 12,
    defense: 6,
    hp: 20,
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    prompt: '1boy, wandering lone mercenary swordsman, leather cloak, broadsword, rugged handsome, fantasy anime style',
    skills: [{
      name: '신속한 2연속 베기',
      description: '[범용 용병] 2연속 베기로 12 피해를 입히고 치명타 확률이 +25% 증가합니다.',
      cost: 2,
      damage: 12,
      multiHit: 2,
      critChance: 0.25
    }]
  },
  {
    id: 'starter-generic-2',
    cardType: 'spell',
    name: '욕망의 비전 항아리',
    title: 'Pot of Arcane Greed',
    element: 'water',
    themeId: null,
    themeName: null,
    isGeneric: true,
    rarity: 'epic',
    cost: 1,
    attack: 0,
    defense: 0,
    hp: 0,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    prompt: 'ancient glowing magical green vase pot, mysterious smirk, glowing runes, arcane energy sparks',
    skills: [{
      name: '탐욕의 마력 흡수',
      description: '[범용 주문] 즉시 카드 2장을 드로우하고 마나 1을 추가로 공급받습니다.',
      cost: 1,
      drawCards: 2,
      manaGain: 1
    }]
  },
  {
    id: 'starter-generic-3',
    cardType: 'spell',
    name: '결계 분쇄의 일격',
    title: 'Dispel Barrier Strike',
    element: 'lightning',
    themeId: null,
    themeName: null,
    isGeneric: true,
    rarity: 'rare',
    cost: 2,
    attack: 16,
    defense: 0,
    hp: 0,
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    prompt: 'thunder spear piercing crystal magic shield barrier, electric shockwave, shattered barrier fragments',
    skills: [{
      name: '절대 실드 관통타',
      description: '[범용 주문] 적의 모든 방어막을 100% 무시하고 체력에 16 직접 번개 피해를 꽂아넣습니다.',
      cost: 2,
      damage: 16,
      pierceShield: true
    }]
  },
  {
    id: 'starter-generic-4',
    cardType: 'unit',
    name: '고대의 바위 골렘',
    title: 'Ancient Stone Golem',
    element: 'nature',
    themeId: null,
    themeName: null,
    isGeneric: true,
    rarity: 'rare',
    cost: 2,
    attack: 8,
    defense: 10,
    hp: 26,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    prompt: 'giant ancient stone moss golem, glowing green core crystal, massive rock fists, protective guardian stance',
    skills: [{
      name: '단단한 바위 도발',
      description: '[범용 도발] 적의 단일 공격을 최우선으로 흡수하며, 소환 시 방어막 +8을 획득합니다.',
      cost: 2,
      taunt: true,
      shield: 8
    }]
  }
];

// 👹 6대 속성별 기본 보스 데이터
export const BOSS_DATA = [
  {
    id: 'boss-1',
    name: '흑염룡의 사도 바알',
    title: 'Apostle of Black Flame',
    element: 'fire',
    maxHp: 130,
    currentHp: 130,
    shield: 10,
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '화염의 진노 연계',
        desc: '화염 토템 소환 ➔ 아군 화상 부여 ➔ 칠흑의 발톱 강타',
        steps: [
          { type: 'summon_or_buff', name: '화염 토템 기립', value: 1, icon: '🔥' },
          { type: 'debuff', name: '작열의 열기', status: { type: 'burn', duration: 2, value: 8 }, text: '플레이어에게 화상 부여', icon: '♨️' },
          { type: 'attack', name: '칠흑의 발톱', value: 16, text: '16 물리 피해', icon: '🗡️' }
        ]
      },
      {
        name: '멸망의 용숨결 차징 & 브레스',
        desc: '용의 위압감(방어막 전개) ➔ 초강력 헬파이어 브레스',
        steps: [
          { type: 'shield', name: '용비늘 장벽', value: 20, text: '20 실드 전개', icon: '🛡️' },
          { type: 'magic', name: '헬파이어 브레스', value: 28, isAoe: true, text: '28 광역 화염 폭격!', icon: '💥', dialogue: '크큭... 내 안의 불길을 감당할 수 있겠느냐!' }
        ]
      },
      {
        name: '심연의 마력 흡수 & 맹공',
        desc: '플레이어 마나 1 흡수 ➔ 전원 공격력 버프 ➔ 파멸참',
        steps: [
          { type: 'disrupt', name: '마나 착취', manaBurn: 1, text: '플레이어 마나 -1 착취', icon: '🌀' },
          { type: 'minion_buff', name: '지옥불 고양', buffAtk: 4, text: '부하 공격력 +4 강화', icon: '⚡' },
          { type: 'attack', name: '암흑 참격', value: 18, text: '18 암흑 피해', icon: '🗡️' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '하찮은 듀얼리스트여, 내 불꽃 앞에서는 재가 될 뿐이다!',
    dialogueLowHp: '크아악! 네놈의 목숨을 불태워서라도 파멸시키겠다!'
  },
  {
    id: 'boss-2',
    name: '서리 마녀 엘리시아',
    title: 'Frost Witch Alicia',
    element: 'water',
    maxHp: 150,
    currentHp: 150,
    shield: 20,
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '영구동토 결계 콤보',
        desc: '빙벽 전개 ➔ 아군 1체 빙결 ➔ 얼음 송곳 강타',
        steps: [
          { type: 'shield', name: '절대 빙벽', value: 25, text: '25 빙벽 실드', icon: '🛡️' },
          { type: 'debuff', name: '서리 결빙', status: { type: 'freeze', duration: 1, value: 0 }, text: '아군 소환수 1체 동결', icon: '❄️' },
          { type: 'magic', name: '얼음 송곳', value: 18, text: '18 냉기 피해', icon: '🗡️' }
        ]
      },
      {
        name: '절대영도 블리자드',
        desc: '서리 골렘 소환 ➔ 광역 한파 피해 + 플레이어 받피증',
        steps: [
          { type: 'summon_or_buff', name: '서리 골렘 소환', value: 1, icon: '⛄' },
          { type: 'debuff', name: '취약 한파', status: { type: 'vulnerable', duration: 2, value: 0 }, text: '받는 피해 +50% 취약 부여', icon: '🌪️' },
          { type: 'magic', name: '절대영도 블리자드', value: 24, isAoe: true, text: '24 광역 눈보라 폭격', icon: '❄️' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '차가운 침묵 속에서 영원히 잠드세요...',
    dialogueLowHp: '얼어붙은 심장이 깨어납니다... 진정한 혹한을 보아라!'
  },
  {
    id: 'boss-3',
    name: '뇌제 티탄 발토르',
    title: 'Thunder Titan Baltor',
    element: 'lightning',
    maxHp: 160,
    currentHp: 160,
    shield: 15,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '초전도 과충전 연계',
        desc: '충전탑 소환 ➔ 감전 부여 ➔ 뇌전 연타 강타',
        steps: [
          { type: 'summon_or_buff', name: '초전도 충전탑 가동', value: 1, icon: '⚡' },
          { type: 'debuff', name: '고압 감전', status: { type: 'shock', duration: 2, value: 6 }, text: '감전 상태이상 부여', icon: '🌩️' },
          { type: 'attack', name: '천벌의 뇌창', value: 22, text: '22 번개 물리 피해', icon: '🗡️' }
        ]
      },
      {
        name: '기가볼트 벼락 폭풍',
        desc: '전자기 펄스 방어막 ➔ 전장 전체 벼락 폭격',
        steps: [
          { type: 'shield', name: '전자기 역장', value: 20, text: '20 전자기 실드', icon: '🛡️' },
          { type: 'magic', name: '기가볼트 썬더스톰', value: 26, isAoe: true, text: '26 광역 번개 폭격', icon: '💥', dialogue: '하늘의 분노가 네놈들을 재로 만들리라!' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '우레와 벼락의 심판을 피할 수 없다!',
    dialogueLowHp: '크아악! 전력을 120%까지 방출하겠다!'
  },
  {
    id: 'boss-4',
    name: '심판의 대천사 우리엘',
    title: 'Archangel of Judgment',
    element: 'holy',
    maxHp: 170,
    currentHp: 170,
    shield: 30,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '천상의 수호 & 정화',
        desc: '수호 천사 소환 ➔ 보스 체력 25 회복 ➔ 성스러운 일격',
        steps: [
          { type: 'summon_or_buff', name: '수호 천사 소환', value: 1, icon: '👼' },
          { type: 'shield', name: '아이기스의 은총', value: 25, text: '25 신성 방어막 전개', icon: '🛡️' },
          { type: 'magic', name: '빛의 심판', value: 20, text: '20 신성 마법 피해', icon: '✨' }
        ]
      },
      {
        name: '천벌의 성역 폭발',
        desc: '아군 실드 파쇄 ➔ 대천사의 정화 불꽃 광역 강타',
        steps: [
          { type: 'disrupt', name: '실드 정화 파동', breakShield: true, text: '플레이어 방어막 전면 해제', icon: '💔' },
          { type: 'magic', name: '세라핌 헤븐즈폴', value: 30, isAoe: true, text: '30 광역 신성 폭격', icon: '💥', dialogue: '죄악으로 물든 영혼이여, 정화되어라!' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '신의 정의 앞에 무릎 꿇고 참회하라.',
    dialogueLowHp: '빛의 결계가 무너지다니... 마지막 신벌을 내리노라!'
  },
  {
    id: 'boss-5',
    name: '심연의 마왕 벨제부브',
    title: 'Abyssal Lord Beelzebub',
    element: 'dark',
    maxHp: 200,
    currentHp: 200,
    shield: 25,
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '영혼 수확 콤보',
        desc: '사령술사 소환 ➔ 생명력 흡혈 ➔ 암흑 파동',
        steps: [
          { type: 'summon_or_buff', name: '심연의 군세 소환', value: 1, icon: '💀' },
          { type: 'magic', name: '영혼 흡수', value: 16, lifesteal: true, text: '16 피해 & 체력 16 흡혈', icon: '🩸' },
          { type: 'attack', name: '멸절참', value: 20, text: '20 단일 강타', icon: '🗡️' }
        ]
      },
      {
        name: '아포칼립스 파멸 강타',
        desc: '심연의 에너지 응축 ➔ 아군 전원 실드 파쇄 ➔ 대재앙 폭발',
        steps: [
          { type: 'disrupt', name: '실드 분쇄 파동', breakShield: true, text: '아군 모든 실드 즉시 파괴', icon: '💔' },
          { type: 'shield', name: '암흑의 장막', value: 30, text: '30 암흑 방어막 전개', icon: '🛡️' },
          { type: 'magic', name: '종말의 아포칼립스', value: 35, isAoe: true, text: '35 파멸 폭발!', icon: '💥', dialogue: '빛은 사라지고 오직 영원한 어둠만이 남으리라!' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '빛은 사라지고 오직 영원한 어둠만이 남으리라!',
    dialogueLowHp: '크하하하! 심연의 문이 완전히 열렸다!'
  },
  {
    id: 'boss-6',
    name: '세계수의 지배자 위그드라',
    title: 'Ruler of Worldtree',
    element: 'nature',
    maxHp: 180,
    currentHp: 180,
    shield: 20,
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    comboPatterns: [
      {
        name: '맹독 포자 & 생명 순환',
        desc: '포자 버섯 소환 ➔ 아군 전체 맹독 중독 ➔ 대지의 치유',
        steps: [
          { type: 'summon_or_buff', name: '맹독 포자 버섯 소환', value: 1, icon: '🍄' },
          { type: 'debuff', name: '치명적 맹독', status: { type: 'poison', duration: 3, value: 8 }, text: '플레이어 맹독 중독', icon: '☣️' },
          { type: 'attack', name: '가시 덩굴 강타', value: 18, text: '18 자연 피해', icon: '🌿' }
        ]
      },
      {
        name: '대자연의 격노 폭풍',
        desc: '나무 껍질 장벽 ➔ 세계수의 분노 대지진',
        steps: [
          { type: 'shield', name: '철갑 목피 장벽', value: 25, text: '25 자연 방어막', icon: '🛡️' },
          { type: 'magic', name: '대지의 대재앙 분노', value: 28, isAoe: true, text: '28 광역 대지진 폭격', icon: '💥', dialogue: '숲을 더럽힌 대가를 뼈저리게 치르게 해주마!' }
        ]
      }
    ],
    actionIdx: 0,
    dialogueOnStart: '대자연의 생명과 분노가 나를 인도한다.',
    dialogueLowHp: '세계수의 뿌리가 깨어난다... 모든 것을 삼켜라!'
  }
];

// 🛡️ 6대 속성별 보스 소환수 (Minions) 풀
export const ELEMENT_BOSS_MINIONS = {
  fire: [
    { name: '화염의 저주 토템', icon: '🔥', attack: 8, defense: 0, maxHp: 20, currentHp: 20, taunt: false, desc: '지속: 매 턴 아군 전체에 화상' },
    { name: '지옥불 사냥개', icon: '🐕', attack: 16, defense: 0, maxHp: 22, currentHp: 22, taunt: false, desc: '돌격: 매 턴 강력한 직접 타격' },
    { name: '용암 골렘', icon: '🌋', attack: 10, defense: 14, maxHp: 32, currentHp: 32, taunt: true, desc: '도발: 보스 공격을 대신 흡수' }
  ],
  water: [
    { name: '서리 수정 골렘', icon: '⛄', attack: 8, defense: 16, maxHp: 34, currentHp: 34, taunt: true, desc: '도발: 공격자를 1턴간 빙결' },
    { name: '빙하의 서리 정령', icon: '❄️', attack: 14, defense: 4, maxHp: 22, currentHp: 22, taunt: false, desc: '한파: 매 턴 플레이어 실드 삭감' },
    { name: '눈보라 사령관', icon: '🧙‍♀️', attack: 12, defense: 8, maxHp: 26, currentHp: 26, taunt: false, desc: '지원: 매 턴 보스에게 빙벽 +10 부여' }
  ],
  lightning: [
    { name: '초전도 충전탑', icon: '⚡', attack: 0, defense: 12, maxHp: 28, currentHp: 28, taunt: true, desc: '도발 & 매 턴 보스 공격력 +3 충전' },
    { name: '번개 스파크 정령', icon: '🌩️', attack: 15, defense: 0, maxHp: 18, currentHp: 18, taunt: false, desc: '속공: 2회 연속 속공 타격' },
    { name: '뇌전의 집행자', icon: '⚔️', attack: 18, defense: 6, maxHp: 24, currentHp: 24, taunt: false, desc: '감전: 플레이어 본체 집중 저격' }
  ],
  holy: [
    { name: '성역의 수호 천사', icon: '👼', attack: 6, defense: 18, maxHp: 36, currentHp: 36, taunt: true, desc: '도발 & 매 턴 보스 체력 +15 회복' },
    { name: '빛의 심판 토템', icon: '✨', attack: 12, defense: 6, maxHp: 24, currentHp: 24, taunt: false, desc: '정화: 매 턴 플레이어 버프 해제' },
    { name: '세라프 수호기사', icon: '🛡️', attack: 14, defense: 12, maxHp: 30, currentHp: 30, taunt: false, desc: '수호: 보스 받는 피해 30% 감소' }
  ],
  dark: [
    { name: '심연의 방패병', icon: '🛡️', attack: 8, defense: 14, maxHp: 30, currentHp: 30, taunt: true, desc: '도발: 보스 공격을 대신 흡수' },
    { name: '그림자 암살자', icon: '🗡️', attack: 18, defense: 0, maxHp: 18, currentHp: 18, taunt: false, desc: '치명: 플레이어 본체 관통 암살' },
    { name: '암흑 사령술사', icon: '🔮', attack: 10, defense: 6, maxHp: 24, currentHp: 24, taunt: false, desc: '지원: 매 턴 아군에 저주 및 보스 흡혈' }
  ],
  nature: [
    { name: '고대 세계수 엔트', icon: '🌲', attack: 8, defense: 16, maxHp: 38, currentHp: 38, taunt: true, desc: '도발 & 매 턴 체력 +8 자가 재생' },
    { name: '맹독 포자 버섯', icon: '🍄', attack: 10, defense: 2, maxHp: 20, currentHp: 20, taunt: false, desc: '살포: 매 턴 적 전체에 맹독 누적' },
    { name: '가시 덩굴 전사', icon: '🌿', attack: 14, defense: 8, maxHp: 25, currentHp: 25, taunt: false, desc: '반사: 피격 시 공격자에게 6 반사 피해' }
  ]
};

export const BOSS_ADD_POOL = ELEMENT_BOSS_MINIONS.dark;

// 🎴 보스 전용 전술 파워 카드 풀 (속성 및 테마별)
export const BOSS_POWER_CARDS = [
  // Fire
  {
    id: 'boss-card-fire-1',
    name: '지옥불 메테오 폭격',
    element: 'fire',
    cardType: 'spell',
    cost: 3,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '메테오 스트라이크', damage: 20, isAoeSpell: true, statusEffect: { type: 'burn', duration: 2, value: 8 }, description: '전장에 20 광역 화염 피해를 입히고 화상을 부여합니다.' }]
  },
  {
    id: 'boss-card-fire-2',
    name: '화염의 지옥견',
    element: 'fire',
    cardType: 'unit',
    cost: 2,
    attack: 14,
    defense: 4,
    hp: 20,
    skills: [{ name: '작열의 이빨', damage: 14, statusEffect: { type: 'burn', duration: 2, value: 6 }, description: '14 피해 및 화상' }]
  },
  // Water
  {
    id: 'boss-card-water-1',
    name: '절대영도 블리자드',
    element: 'water',
    cardType: 'spell',
    cost: 3,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '영구 동결', damage: 16, isAoeSpell: true, statusEffect: { type: 'freeze', duration: 1, value: 0 }, description: '16 광역 냉기 피해 및 전방 유닛 1턴 동결' }]
  },
  {
    id: 'boss-card-water-2',
    name: '빙하의 성벽',
    element: 'water',
    cardType: 'structure',
    cost: 2,
    attack: 0,
    defense: 12,
    hp: 26,
    taunt: true,
    skills: [{ name: '빙벽 전개', shield: 20, description: '보스에게 20 방어막을 전개합니다.' }]
  },
  // Lightning
  {
    id: 'boss-card-lightning-1',
    name: '기가볼트 벼락 폭풍',
    element: 'lightning',
    cardType: 'spell',
    cost: 3,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '과충전 방전', damage: 18, manaGain: -1, statusEffect: { type: 'shock', duration: 2, value: 8 }, description: '18 번개 피해, 감전 및 플레이어 마나 1 방전' }]
  },
  // Holy
  {
    id: 'boss-card-holy-1',
    name: '성역의 대치유 & 가호',
    element: 'holy',
    cardType: 'spell',
    cost: 2,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '세라핌의 가호', heal: 20, shield: 16, description: '보스 체력 +20 회복 및 방어막 +16' }]
  },
  // Dark
  {
    id: 'boss-card-dark-1',
    name: '심연의 영혼 파기',
    element: 'dark',
    cardType: 'spell',
    cost: 3,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '영혼 강탈 & 패 파괴', damage: 16, lifestealPercent: 0.5, discardCard: true, description: '16 피해, 50% 흡혈 및 플레이어 손패 1장 파기' }]
  },
  {
    id: 'boss-card-dark-2',
    name: '그림자 암살자',
    element: 'dark',
    cardType: 'unit',
    cost: 2,
    attack: 16,
    defense: 2,
    hp: 18,
    skills: [{ name: '심장 관통', damage: 16, pierceShield: true, description: '방어막을 무시하고 체력을 직접 타격' }]
  },
  // Nature
  {
    id: 'boss-card-nature-1',
    name: '부식성 맹독 포자',
    element: 'nature',
    cardType: 'spell',
    cost: 2,
    attack: 0,
    defense: 0,
    hp: 0,
    skills: [{ name: '맹독 대확산', damage: 12, statusEffect: { type: 'poison', duration: 3, value: 10 }, description: '12 자연 피해 및 맹독 중독' }]
  }
];

// ⚜️ 기본 카드군 (Archetypes / Theme Synergies) 초기 풀 - TCG식 테마 덱 연계 효과
export const DEFAULT_THEME_ARCHETYPES = [
  {
    id: 'theme_crimson_knights',
    name: '홍련의 검사단',
    title: 'Crimson Knights',
    element: 'fire',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['fire'],
    keyword: '홍련',
    icon: '🔥',
    badge: 'bg-red-950 text-red-200 border-red-500',
    description: '화염과 검술의 기사단. [홍련] 카드를 낼 때 필드에 동료가 있으면 보스에게 8 연계 화염 폭격을 가하고 화상을 부여합니다.',
    synergy: {
      type: 'crimson_chain',
      name: '홍련 연쇄 폭격',
      desc: '필드에 다른 [홍련]이 있을 때: 보스에게 8 화염 연계 피해 및 화상(6) 부여'
    },
    seeds: ['crimson knight', 'flaming katana', 'fire sparks', 'knight armor', 'fire']
  },
  {
    id: 'theme_frost_coven',
    name: '서리 마법결사',
    title: 'Frost Coven',
    element: 'water',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['water'],
    keyword: '서리',
    icon: '❄️',
    badge: 'bg-cyan-950 text-cyan-200 border-cyan-500',
    description: '영구동토의 비전 마도사단. [서리] 카드를 낼 때 보스를 1턴간 결빙(Freeze)시키고 카드 1장을 추가 드로우합니다.',
    synergy: {
      type: 'frost_freeze',
      name: '절대영도 결빙 연쇄',
      desc: '[서리] 발동 시: 보스를 1턴간 결빙시키고 덱에서 카드 1장 드로우'
    },
    seeds: ['frost witch', 'ice sorceress', 'crystal staff', 'freezing aura', 'ice']
  },
  {
    id: 'theme_thunder_valkyrie',
    name: '뇌제 발키리아',
    title: 'Thunder Valkyries',
    element: 'lightning',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['lightning'],
    keyword: '뇌제',
    icon: '⚡',
    badge: 'bg-yellow-950 text-yellow-200 border-yellow-500',
    description: '천상의 벼락을 다루는 전장의 여전사들. [뇌제] 카드를 낼 때 다음 카드가 2연속 발동(더블캐스트)되며 감전을 부여합니다.',
    synergy: {
      type: 'thunder_overcharge',
      name: '뇌제의 과충전',
      desc: '[뇌제] 발동 시: 다음 카드가 2연속 발동(더블캐스트) & 보스에게 감전 부여'
    },
    seeds: ['thunder valkyrie', 'lightning spear', 'wings of light', 'electric aura', 'lightning']
  },
  {
    id: 'theme_sanctuary_priestess',
    name: '성역의 수호사제',
    title: 'Sanctuary Priestesses',
    element: 'holy',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['holy'],
    keyword: '성역',
    icon: '✨',
    badge: 'bg-amber-950 text-amber-200 border-amber-400',
    description: '빛과 치유의 결계를 수호하는 성녀들. [성역] 카드를 낼 때 1턴간 모든 피해를 무효화하는 절대 무적 결계와 방어막 +15를 펼칩니다.',
    synergy: {
      type: 'sanctuary_barrier',
      name: '성역의 무적 결계',
      desc: '[성역] 발동 시: 1턴간 절대 무적 결계 전개 & 방어막 +15 획득'
    },
    seeds: ['holy priestess', 'white gold robes', 'glowing halo', 'sacred barrier', 'holy']
  },
  {
    id: 'theme_abyssal_shadows',
    name: '심연의 그림자단',
    title: 'Abyssal Shadows',
    element: 'dark',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['dark'],
    keyword: '심연',
    icon: '🌑',
    badge: 'bg-purple-950 text-purple-200 border-purple-500',
    description: '어둠 속에서 생명력을 수확하는 암살자 결사. [심연] 카드를 낼 때 덱에서 1장 드로우하고 이번 턴 적 실드 완전 관통 및 흡혈을 부여합니다.',
    synergy: {
      type: 'abyssal_salvage',
      name: '심연의 영혼 회수',
      desc: '[심연] 발동 시: 카드 1장 드로우 & 이번 턴 실드 100% 관통 + 흡혈 발동'
    },
    seeds: ['dark assassin', 'hooded cloak', 'glowing violet eyes', 'shadow daggers', 'dark']
  },
  {
    id: 'theme_worldtree_protectors',
    name: '세계수의 수호자',
    title: 'Worldtree Protectors',
    element: 'nature',
    elementPolicy: 'mono',           // 단일 속성 카드군
    elements: ['nature'],
    keyword: '세계수',
    icon: '🌿',
    badge: 'bg-emerald-950 text-emerald-200 border-emerald-500',
    description: '대자연과 생명의 엘프 드루이드. [세계수] 카드를 낼 때 체력 12를 회복하고 전장에 [세계수의 정령] 소환수를 무료 특수 소환합니다.',
    synergy: {
      type: 'worldtree_growth',
      name: '세계수 대자연 번식',
      desc: '[세계수] 발동 시: 체력 12 회복 & [세계수의 정령] 무료 특수 소환'
    },
    seeds: ['elf druid', 'emerald hair', 'wooden staff', 'glowing vines', 'nature']
  },
  {
    id: 'theme_crystal_beasts',
    name: '보옥수 (Crystal Beasts)',
    title: 'Crystal Beasts',
    element: 'holy',                 // 대표 속성 (뱃지·정렬·검색용)
    elementPolicy: 'multi',          // 💎 보석 색깔이 곧 속성 — 6속성 전부 수용
    elements: ['holy', 'fire', 'water', 'lightning', 'nature', 'dark'],
    keyword: '보옥수',
    icon: '💎',
    badge: 'bg-gradient-to-r from-cyan-950 to-amber-950 text-cyan-200 border-cyan-400',
    description: '신비한 보옥의 힘을 품은 환수 군단. [보옥수] 카드를 낼 때 마나 +1이 즉시 충전되며, 필드의 보옥수 수만큼 아군 전체에 방어막 +5를 부여합니다.',
    synergy: {
      type: 'crystal_resonance',
      name: '보옥 마력 공명',
      desc: '[보옥수] 발동 시: 마나 +1 즉시 충전 & 필드의 보옥수당 방어막 +5 전개'
    },
    seeds: ['crystal beast', 'gemstone core', 'sparkling emerald ruby sapphire', 'mythical creature']
  },
  {
    id: 'theme_elemental_heroes',
    name: '엘리멘틀 히어로 (Elemental Heroes)',
    title: 'Elemental Heroes',
    element: 'fire',                 // 대표 속성 (뱃지·정렬·검색용)
    elementPolicy: 'multi',          // ⚡ 원소 히어로 — 속성 전환 자체가 컨셉
    elements: ['fire', 'water', 'lightning', 'nature', 'holy', 'dark'],
    keyword: '히어로',
    icon: '🦸‍♂️',
    badge: 'bg-gradient-to-r from-red-950 to-blue-950 text-amber-200 border-amber-400',
    description: '정의의 수호자 히어로 군단. [히어로] 카드를 낼 때 덱에서 다른 [히어로] 카드를 찾아 패로 서치(Search)하고 보스에게 10의 연계 타격을 가합니다.',
    synergy: {
      type: 'hero_search',
      name: '히어로 긴급 출동 & 서치',
      desc: '[히어로] 발동 시: 덱에서 다른 [히어로] 카드를 패로 서치(Search) & 10 연계 타격'
    },
    seeds: ['elemental hero', 'tokusatsu superhero', 'glowing suit', 'dynamic heroic pose', 'cape', 'hero']
  }
];
