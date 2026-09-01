import { CardData, CardRarity, CardSkill, ElementType, NovelAISettings } from '../types/game';

// 0 Anlas 무료 생성 규격 기본 설정 (Opus 계정 기준)
export const DEFAULT_SETTINGS: NovelAISettings = {
  apiKey: '',
  model: 'nai-diffusion-4-full', // NovelAI Anime V4 Full 공식 모델명
  resolution: 'portrait-small', // 512x768 (안전한 0 Anlas) 또는 832x1216
  steps: 28, // 28 이하 0 Anlas 유지
  scale: 6.0,
  sampler: 'k_euler',
  safeMode0Anlas: true,
  ucPreset: 0,
  negativePrompt: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, bad feet, mutation, deformed'
};

// 해상도 맵핑 (0 Anlas 최적화)
export const RESOLUTIONS = {
  'portrait-small': { width: 512, height: 768, name: '소형 세로 (512x768) - 🛡️ 0 Anlas' },
  'portrait-normal': { width: 832, height: 1216, name: '표준 세로 (832x1216) - 🛡️ 0 Anlas' },
  'square-normal': { width: 640, height: 640, name: '정사각형 (640x640) - 🛡️ 0 Anlas' }
};

// 속성별 태그 프리셋
export const ELEMENT_PROMPT_TAGS: Record<ElementType, string> = {
  fire: 'fire magic, flaming aura, blazing inferno, burning sparks, crimson glow, heat distortion',
  water: 'water magic, swirling aqua, floating water droplets, icy mist, deep blue crystal',
  lightning: 'lightning sparks, electric aura, crackling thunderbolts, glowing yellow and cyan electricity, high voltage',
  holy: 'holy light, golden divine halo, radiant feathers, sacred blessing, glittering stardust, angelic aura',
  dark: 'dark magic, shadow tendrils, abyssal mist, purple void particles, demonic aura, glowing eyes',
  nature: 'emerald leaves, glowing vines, floral blossoms, nature energy, sacred forest glow, petals'
};

// 속성별 테마 컬러
export const ELEMENT_COLORS: Record<ElementType, { bg: string; text: string; border: string; glow: string; badge: string; icon: string }> = {
  fire: { bg: 'from-amber-950 via-red-900 to-black', text: 'text-red-400', border: 'border-red-500/60', glow: 'shadow-red-500/50', badge: 'bg-red-900/80 text-red-200 border-red-500', icon: '🔥' },
  water: { bg: 'from-blue-950 via-cyan-900 to-black', text: 'text-cyan-400', border: 'border-cyan-500/60', glow: 'shadow-cyan-500/50', badge: 'bg-cyan-900/80 text-cyan-200 border-cyan-500', icon: '💧' },
  lightning: { bg: 'from-amber-950 via-yellow-900 to-black', text: 'text-yellow-400', border: 'border-yellow-500/60', glow: 'shadow-yellow-500/50', badge: 'bg-yellow-900/80 text-yellow-200 border-yellow-500', icon: '⚡' },
  holy: { bg: 'from-amber-950 via-yellow-800 to-stone-900', text: 'text-amber-300', border: 'border-amber-400/60', glow: 'shadow-amber-400/50', badge: 'bg-amber-900/80 text-amber-200 border-amber-400', icon: '✨' },
  dark: { bg: 'from-purple-950 via-indigo-950 to-black', text: 'text-purple-400', border: 'border-purple-500/60', glow: 'shadow-purple-500/50', badge: 'bg-purple-900/80 text-purple-200 border-purple-500', icon: '🌑' },
  nature: { bg: 'from-emerald-950 via-green-900 to-black', text: 'text-emerald-400', border: 'border-emerald-500/60', glow: 'shadow-emerald-500/50', badge: 'bg-emerald-900/80 text-emerald-200 border-emerald-500', icon: '🌿' }
};

// 등급별 스타일
export const RARITY_CONFIG: Record<CardRarity, { name: string; border: string; glow: string; badge: string; minCost: number; statMultiplier: number }> = {
  common: { name: 'COMMON', border: 'border-slate-500/60', glow: 'shadow-slate-500/20', badge: 'bg-slate-700 text-slate-200', minCost: 1, statMultiplier: 1.0 },
  rare: { name: 'RARE', border: 'border-blue-400/80', glow: 'shadow-blue-500/40', badge: 'bg-blue-600 text-blue-100', minCost: 2, statMultiplier: 1.3 },
  epic: { name: 'EPIC', border: 'border-purple-400/90', glow: 'shadow-purple-500/60', badge: 'bg-purple-600 text-purple-100', minCost: 2, statMultiplier: 1.6 },
  legendary: { name: 'LEGENDARY', border: 'border-amber-400', glow: 'shadow-amber-400/80', badge: 'bg-gradient-to-r from-amber-500 to-yellow-300 text-black font-bold', minCost: 3, statMultiplier: 2.0 }
};

// 프롬프트 완성 헬퍼 (V4.5 고화질 최적화 태그 자동 조합)
export function buildNovelAIPrompt(userPrompt: string, element: ElementType): string {
  const qualityTags = 'masterpiece, best quality, ultra detailed, dynamic pose, expressive eyes, fantasy card game illustration, dramatic lighting';
  const elementTags = ELEMENT_PROMPT_TAGS[element];
  return `${qualityTags}, ${userPrompt}, ${elementTags}, solo, upper body, masterpiece illustration`;
}

// NovelAI 이미지 생성 함수
export async function generateNovelAIImage(
  prompt: string,
  settings: NovelAISettings,
  element: ElementType
): Promise<string> {
  const finalPrompt = buildNovelAIPrompt(prompt, element);
  const res = RESOLUTIONS[settings.resolution] || RESOLUTIONS['portrait-small'];
  
  // 0 Anlas 안전 모드 적용 (스텝 수 최대 28 고정)
  const steps = settings.safeMode0Anlas ? Math.min(settings.steps, 28) : settings.steps;
  const modelId = settings.model || 'nai-diffusion-4-5-full';
  const isV4orAbove = modelId.includes('4') || modelId.includes('5');

  const params: any = {
    params_version: 3,
    width: res.width,
    height: res.height,
    scale: settings.scale || 5.0,
    sampler: settings.sampler || 'k_euler',
    steps: steps,
    seed: Math.floor(Math.random() * 2147483647),
    n_samples: 1,
    ucPreset: settings.ucPreset || 0,
    uc: settings.negativePrompt,
    qualityToggle: true,
    dynamic_thresholding: false,
    noise_schedule: 'karras',
    cfg_rescale: 0
  };

  if (isV4orAbove) {
    params.v4_prompt = {
      caption: { base_caption: finalPrompt, char_captions: [] },
      use_coords: false,
      use_order: true
    };
    params.v4_negative_prompt = {
      caption: { base_caption: settings.negativePrompt, char_captions: [] },
      legacy_uc: false
    };
  }

  const payload = {
    input: finalPrompt,
    model: modelId,
    action: 'generate',
    parameters: params
  };

  try {
    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NovelAI API 에러 (${response.status}): ${errText}`);
    }

    // NovelAI는 ZIP 압축 파일(ArrayBuffer)로 이미지를 반환합니다.
    const arrayBuffer = await response.arrayBuffer();
    
    // JSZip을 동적으로 활용하여 zip 내의 image.png 추출
    // @ts-ignore
    const JSZip = (window as any).JSZip;
    if (JSZip) {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const firstFile = Object.values(zip.files)[0] as any;
      if (firstFile) {
        const base64 = await firstFile.async('base64');
        return `data:image/png;base64,${base64}`;
      }
    }

    // Fallback: Blob URL
    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    return URL.createObjectURL(blob);
  } catch (error: any) {
    console.error('NovelAI 생성 중 오류:', error);
    throw error;
  }
}

// 프롬프트 및 속성에 맞춰 자동으로 밸런스 있는 카드 스탯 및 스킬 롤링
export function rollCardStats(
  name: string,
  element: ElementType,
  rarity: CardRarity,
  prompt: string,
  imageUrl: string
): CardData {
  const mult = RARITY_CONFIG[rarity].statMultiplier;
  
  // 코스트 계산 (1 ~ 4)
  let cost = 1;
  if (rarity === 'rare') cost = 2;
  if (rarity === 'epic') cost = Math.random() > 0.4 ? 3 : 2;
  if (rarity === 'legendary') cost = Math.random() > 0.3 ? 4 : 3;

  // 공격력 / 방어력 / 체력 계산
  const baseAtk = Math.floor((10 + Math.floor(Math.random() * 8) + (cost * 4)) * mult);
  const baseDef = Math.floor((4 + Math.floor(Math.random() * 6) + (cost * 3)) * mult);
  const hp = Math.floor((20 + Math.floor(Math.random() * 10) + (cost * 6)) * mult);

  // 속성에 따른 스킬 생성
  const skills: CardSkill[] = [];
  const skillNamePrefix: Record<ElementType, string[]> = {
    fire: ['폭염의', '겁화', '홍련', '인페르노'],
    water: ['빙하의', '절대영도', '심해', '서리'],
    lightning: ['천벌의', '초뇌광', '질풍신뢰', '볼텍스'],
    holy: ['성역의', '신성한', '천상의', '에기스'],
    dark: ['심연의', '칠흑', '파멸', '섀도우'],
    nature: ['세계수의', '대지의', '에메랄드', '가이아']
  };

  const prefixes = skillNamePrefix[element];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const skillId = `skill-${Date.now()}`;

  let effectType: CardSkill['effectType'] = 'damage';
  let statusType: 'burn' | 'freeze' | 'shock' | 'poison' | 'vulnerable' | undefined = undefined;

  if (element === 'fire') {
    statusType = 'burn';
    skills.push({
      id: skillId,
      name: `${prefix} 일격`,
      description: `${baseAtk}의 화염 피해를 입히고 2턴간 [화상] 상태를 부여합니다.`,
      cost: cost,
      effectType: 'damage',
      value: baseAtk,
      statusEffect: { type: 'burn', duration: 2, value: Math.max(4, Math.floor(baseAtk * 0.3)) }
    });
  } else if (element === 'water') {
    statusType = 'freeze';
    skills.push({
      id: skillId,
      name: `${prefix} 결빙`,
      description: `${baseAtk}의 냉기 피해를 주고 적을 1턴간 [빙결/약화] 시킵니다.`,
      cost: cost,
      effectType: 'damage',
      value: baseAtk,
      statusEffect: { type: 'freeze', duration: 1, value: 5 }
    });
  } else if (element === 'lightning') {
    statusType = 'shock';
    skills.push({
      id: skillId,
      name: `${prefix} 뇌격`,
      description: `${Math.floor(baseAtk * 1.15)}의 치명적인 번개 피해를 꽂아넣습니다!`,
      cost: cost,
      effectType: 'damage',
      value: Math.floor(baseAtk * 1.15),
      statusEffect: { type: 'shock', duration: 2, value: 6 }
    });
  } else if (element === 'holy') {
    skills.push({
      id: skillId,
      name: `${prefix} 가호`,
      description: `${Math.floor(baseDef * 1.5)}의 성스러운 방어막을 획득하고 체력을 ${Math.floor(hp * 0.3)} 회복합니다.`,
      cost: cost,
      effectType: 'shield',
      value: Math.floor(baseDef * 1.5),
      secondaryValue: Math.floor(hp * 0.3)
    });
  } else if (element === 'dark') {
    skills.push({
      id: skillId,
      name: `${prefix} 암습`,
      description: `${baseAtk}의 관통 피해를 가하며 적의 방어막을 관통합니다.`,
      cost: cost,
      effectType: 'damage',
      value: baseAtk
    });
  } else {
    skills.push({
      id: skillId,
      name: `${prefix} 재생`,
      description: `체력을 ${Math.floor(hp * 0.4)} 회복하고 적에게 [맹독]을 부여합니다.`,
      cost: cost,
      effectType: 'heal',
      value: Math.floor(hp * 0.4),
      statusEffect: { type: 'poison', duration: 2, value: 6 }
    });
  }

  return {
    id: `card-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: name || `${prefix}의 전사`,
    title: `${rarity.toUpperCase()} Card`,
    element: element,
    rarity: rarity,
    type: element === 'holy' ? 'defense' : 'attack',
    cost: cost,
    attack: baseAtk,
    defense: baseDef,
    hp: hp,
    imageUrl: imageUrl,
    prompt: prompt,
    skills: skills,
    createdAt: Date.now(),
    isCustom: true
  };
}
