// dan-tag-gen.js - Danbooru Tag Generator (DanTagGen) NLP Converter & Expansion Engine
import { raceImageTags } from './races.js';   // 🧬 종족 태그를 시드 맨 앞에 (DECISIONS #106)

/**
 * 🏷️ 1. 단부루 속성별 핵심 연관(Co-occurrence) 태그 데이터베이스
 */
const ELEMENT_CO_OCCURRENCE = {
  fire: {
    vfx: ['flames', 'sparks', 'fire_particles', 'embers', 'heat_haze', 'glowing_embers', 'smoke', 'fire_magic'],
    lighting: ['warm_lighting', 'dramatic_lighting', 'fiery_glow', 'rim_lighting'],
    background: ['ruins', 'volcanic_background', 'dungeon', 'magma', 'dark_background', 'fire_sparks_background'],
    accessories: ['crimson_gem', 'burning_aura', 'charred_cloth']
  },
  water: {
    vfx: ['ice_crystals', 'frost', 'snowflakes', 'water_splashes', 'freezing_aura', 'ice_particles', 'steam'],
    lighting: ['cool_lighting', 'soft_lighting', 'crystal_reflections', 'subtle_glow'],
    background: ['ice_palace', 'frozen_lake', 'snowy_mountains', 'crystal_cave', 'underwater_light_rays'],
    accessories: ['frost_crown', 'crystal_staff', 'flowing_silk']
  },
  lightning: {
    vfx: ['electric_arcs', 'lightning_bolts', 'sparks', 'plasma_aura', 'crackling_electricity', 'motion_blur'],
    lighting: ['high_contrast_lighting', 'electric_glow', 'dynamic_lighting', 'flash'],
    background: ['thunderstorm', 'dark_storm_clouds', 'shattered_ground', 'spire', 'night_sky_lightning'],
    accessories: ['lightning_spear', 'golden_armor', 'electric_wings']
  },
  holy: {
    vfx: ['light_particles', 'divine_glow', 'feather_particles', 'golden_sparkles', 'halo_glow', 'sacred_runes'],
    lighting: ['god_rays', 'divine_lighting', 'backlighting', 'ethereal_glow', 'golden_hour'],
    background: ['cathedral', 'sanctuary', 'clouds', 'temple_ruins', 'pillars_of_light', 'white_marble'],
    accessories: ['golden_halo', 'angel_wings', 'sacred_relic', 'white_gold_robes']
  },
  dark: {
    vfx: ['shadow_wisps', 'dark_particles', 'purple_aura', 'soul_fragments', 'abyssal_tendrils', 'void_smoke'],
    lighting: ['dim_lighting', 'crepuscular_rays', 'glowing_purple_eyes', 'low_key_lighting', 'moonlight'],
    background: ['abyss', 'gothic_castle', 'blood_moon', 'dark_forest', 'shattered_throne'],
    accessories: ['dark_cloak', 'shadow_daggers', 'cursed_jewelry', 'demon_horns']
  },
  nature: {
    vfx: ['glowing_leaves', 'pollen_particles', 'emerald_sparkles', 'floating_spores', 'green_energy_vines'],
    lighting: ['dappled_sunlight', 'soft_morning_light', 'bioluminescent_glow', 'forest_light'],
    background: ['worldtree', 'ancient_forest', 'emerald_grove', 'mossy_ruins', 'waterfall_background'],
    accessories: ['flower_crown', 'wooden_staff', 'vine_bracelets', 'pointy_ears']
  }
};

/**
 * 🏷️ 2. 카드 타입별 구도 및 포즈 연관 태그
 */
const CARD_TYPE_CO_OCCURRENCE = {
  unit: {
    composition: ['solo', 'upper_body', 'portrait', 'looking_at_viewer'],
    pose: ['dynamic_pose', 'confident_expression', 'holding_weapon', 'battle_stance'],
    quality: ['masterpiece', 'best_quality', 'ultra_detailed', 'absurdres']
  },
  spell: {
    composition: ['no_humans', 'scenery', 'close_up', 'focus_on_spell'],
    pose: ['magic_circle', 'spell_casting', 'magical_explosion', 'swirling_energy', 'rune_circle'],
    quality: ['masterpiece', 'best_quality', 'ultra_detailed', 'particle_effects', 'cinematic_lighting']
  },
  structure: {
    composition: ['scenery', 'no_humans', 'architecture', 'monumental_building'],
    pose: ['ancient_structure', 'fortress', 'tower', 'fantasy_shrine', 'magical_barrier', 'exterior'],
    quality: ['masterpiece', 'best_quality', 'ultra_detailed', 'epic_scale', 'intricate_architecture', 'dramatic_sky']
  }
};

/**
 * 🏷️ 3. 자연어 문장 ➔ 단부루(Danbooru) 태그 패턴 사전
 */
const NATURAL_TO_DANBOORU_PATTERNS = [
  // Subject / Gender
  { regex: /\b(female|girl|woman|lady|priestess|witch|valkyrie|queen|princess|maiden|heroine)\b/i, tags: ['1girl', 'solo'] },
  { regex: /\b(male|boy|guy|knight|warrior|paladin|lord|king|assassin|hero|samurai|monk|berserker|\w*man)\b/i, tags: ['1boy', 'solo'] },
  { regex: /\b(monster|dragon|beast|creature|demon|fiend)\b/i, tags: ['monster', 'draconic_aura'] },
  { regex: /\b(cat_ears|nekomimi|fox_ears|kitsune|elf_ears|pointy_ears)\b/i, tags: ['pointy_ears'] },

  // Hair Colors & Styles
  { regex: /\b(silver|white)\s*(flowing|long|short)?\s*hair\b/i, tags: ['silver_hair'] },
  { regex: /\b(golden|blonde|blond|yellow)\s*(flowing|long|short)?\s*hair\b/i, tags: ['blonde_hair'] },
  { regex: /\b(red|crimson|flaming)\s*(flowing|long|short)?\s*hair\b/i, tags: ['red_hair'] },
  { regex: /\b(blue|cyan|ice|azure)\s*(flowing|long|short)?\s*hair\b/i, tags: ['blue_hair'] },
  { regex: /\b(black|dark|raven)\s*(flowing|long|short)?\s*hair\b/i, tags: ['black_hair'] },
  { regex: /\b(purple|violet)\s*(flowing|long|short)?\s*hair\b/i, tags: ['purple_hair'] },
  { regex: /\b(green|emerald)\s*(flowing|long|short)?\s*hair\b/i, tags: ['green_hair'] },
  { regex: /\b(pink|rose)\s*(flowing|long|short)?\s*hair\b/i, tags: ['pink_hair'] },
  { regex: /\b(long\s+hair|flowing\s+hair)\b/i, tags: ['long_hair', 'flowing_hair'] },
  { regex: /\b(short\s+hair)\b/i, tags: ['short_hair'] },
  { regex: /\b(ponytail)\b/i, tags: ['ponytail'] },
  { regex: /\b(twintails|twin\s+tails)\b/i, tags: ['twintails'] },

  // Eyes & Facial Features
  { regex: /\b(blue\s+eyes)\b/i, tags: ['blue_eyes'] },
  { regex: /\b(red\s+eyes|crimson\s+eyes)\b/i, tags: ['red_eyes'] },
  { regex: /\b(golden\s+eyes|yellow\s+eyes)\b/i, tags: ['yellow_eyes'] },
  { regex: /\b(purple\s+eyes|violet\s+eyes)\b/i, tags: ['purple_eyes'] },
  { regex: /\b(green\s+eyes)\b/i, tags: ['green_eyes'] },
  { regex: /\b(glowing\s+eyes|eyes\s+glowing)\b/i, tags: ['glowing_eyes'] },

  // Clothing / Armor
  { regex: /\b(armor|armour|plate\s+armor|knight\s+armor)\b/i, tags: ['armor', 'plate_armor', 'gauntlets'] },
  { regex: /\b(white\s+armor|holy\s+armor)\b/i, tags: ['white_armor', 'armor'] },
  { regex: /\b(black\s+armor|dark\s+armor)\b/i, tags: ['black_armor', 'armor'] },
  { regex: /\b(robe|robes|hooded|cloak|cape)\b/i, tags: ['robe', 'cape', 'hood'] },
  { regex: /\b(dress|gown|skirt)\b/i, tags: ['dress', 'ornate_clothing'] },
  { regex: /\b(wings|angel\s+wings|feathered\s+wings)\b/i, tags: ['wings', 'feathered_wings'] },
  { regex: /\b(horns|demon\s+horns)\b/i, tags: ['horns', 'demon_horns'] },
  { regex: /\b(halo|golden\s+halo)\b/i, tags: ['halo', 'glowing_halo'] },

  // Weapons & Action
  { regex: /\b(two\s+swords|dual\s+swords|pair\s+of\s+swords)\b/i, tags: ['holding_sword', 'dual_wielding', 'two_swords'] },
  { regex: /\b(sword|blade|katana|greatsword|claymore)\b/i, tags: ['sword', 'holding_sword', 'weapon'] },
  { regex: /\b(spear|lance|halberd|polearm)\b/i, tags: ['spear', 'holding_spear', 'weapon'] },
  { regex: /\b(staff|wand|scepter|rod)\b/i, tags: ['staff', 'holding_staff', 'magic_wand'] },
  { regex: /\b(bow|arrow|crossbow|archer)\b/i, tags: ['bow', 'holding_bow'] },
  { regex: /\b(shield|aegis|buckler)\b/i, tags: ['shield', 'holding_shield'] },
  { regex: /\b(floating|flying|levitating)\b/i, tags: ['floating', 'levitation'] },
  { regex: /\b(full\s+body)\b/i, tags: ['full_body'] },
  { regex: /\b(upper\s+body|portrait)\b/i, tags: ['upper_body', 'portrait'] },

  // Lighting & VFX
  { regex: /\b(particles|sparkles|sparks|magic\s+particles)\b/i, tags: ['light_particles', 'glowing_particles'] },
  { regex: /\b(cinematic|dramatic\s+lighting|dramatic)\b/i, tags: ['dramatic_lighting', 'cinematic_lighting'] },
  { regex: /\b(flames|fire|blaze|inferno)\b/i, tags: ['flames', 'fire_particles', 'embers'] },
  { regex: /\b(ice|frost|snow|blizzard)\b/i, tags: ['ice_crystals', 'frost', 'snowflakes'] },
  { regex: /\b(lightning|thunder|electricity|electric)\b/i, tags: ['electricity', 'lightning_bolts', 'sparks'] },
  { regex: /\b(holy|divine|sacred|light)\b/i, tags: ['divine_glow', 'god_rays', 'sacred_runes'] },
  { regex: /\b(darkness|shadow|abyss|void|purple\s+aura)\b/i, tags: ['dark_particles', 'shadow_wisps', 'purple_aura'] }
];

/**
 * 🏷️ 4. 단일 태그 Snake_Case 정규화
 */
export function normalizeDanbooruTag(tag) {
  if (!tag || typeof tag !== 'string') return '';
  let clean = tag.trim().toLowerCase();
  
  // 불필요한 관사 및 수식어 제거
  clean = clean.replace(/^(a|an|the|full body shot of|shot of|image of|picture of)\s+/i, '');
  clean = clean.replace(/^(wearing|holding|with|decorated with|adorned with)\s+/i, '');
  clean = clean.replace(/[\(\)\[\]\{\}\"\'\.\,\;]/g, '');
  
  // 띄어쓰기를 언더스코어로 변환
  clean = clean.replace(/\s+/g, '_');
  clean = clean.replace(/_+/g, '_');
  clean = clean.replace(/^_+|_+$/g, '');
  
  // 너무 긴 자연어 문장 덩어리는 배제
  if (clean.split('_').length > 5) return '';
  return clean;
}

/**
 * 🏷️ 5. 자연어 문장에서 단부루 태그 추출기
 */
export function parseNaturalLanguageToDanbooru(text = '') {
  if (!text) return [];
  const extracted = new Set();

  const isFemale = /\b(female|girl|lady|priestess|witch|valkyrie|queen|princess|maiden|heroine|sorceress|enchantress|huntress|1girl|\w*woman)\b/i.test(text);
  const isMale = !isFemale && /\b(male|boy|guy|lord|king|knight|warrior|samurai|1boy|\w*man)\b/i.test(text);

  // 1) 정규식 기반 단부루 매핑
  for (const { regex, tags } of NATURAL_TO_DANBOORU_PATTERNS) {
    if (regex.test(text)) {
      tags.forEach(t => {
        if (t === '1boy' && isFemale) return;
        if (t === '1girl' && isMale) return;
        extracted.add(t);
      });
    }
  }

  if (isFemale) {
    extracted.add('1girl');
    extracted.delete('1boy');
  } else if (isMale) {
    extracted.add('1boy');
    extracted.delete('1girl');
  }

  // 2) 쉼표로 나뉜 기존 단부루 태그도 정규화하여 포함
  const chunks = text.split(/[,|\n]+/);
  for (const chunk of chunks) {
    const norm = normalizeDanbooruTag(chunk);
    if (norm && norm.length >= 2 && !['masterpiece', 'best_quality', 'high_resolution'].includes(norm)) {
      extracted.add(norm);
    }
  }

  return Array.from(extracted);
}

/**
 * 🏷️ 6. DanTagGen 정식 확장 파이프라인 (NovelAI Diffusion V4.5 전용)
 * @param {string} seedPrompt - 자연어 또는 단부루 시드 프롬프트
 * @param {string} element - 속성 ('fire', 'water', 'lightning', 'holy', 'dark', 'nature')
 * @param {string} cardType - 카드 타입 ('unit', 'spell', 'structure')
 * @param {number} targetLength - 목표 태그 수 (기본 약 25~28개)
 */
export function expandDanbooruTags(seedPrompt = '', element = 'fire', cardType = 'unit', targetLength = 28) {
  const finalTags = new Set();

  // 1단계: NovelAI Diffusion V4.5 필수 품질 태그
  finalTags.add('masterpiece');
  finalTags.add('best_quality');
  finalTags.add('ultra_detailed');

  // 2단계: 대상 및 구도 태그 (Unit, Spell, Structure 구분)
  const typeRules = CARD_TYPE_CO_OCCURRENCE[cardType] || CARD_TYPE_CO_OCCURRENCE.unit;
  typeRules.composition.forEach(t => finalTags.add(t));

  // 3단계: 자연어 문장 ➔ 순수 단부루 태그 변환 추출
  const parsedSeedTags = parseNaturalLanguageToDanbooru(seedPrompt);
  parsedSeedTags.forEach(t => finalTags.add(t));

  // 4단계: 속성별 동시 등장(Co-occurrence) 시각 효과 & 조명 태그 자동 보강
  const elemRules = ELEMENT_CO_OCCURRENCE[element] || ELEMENT_CO_OCCURRENCE.fire;
  elemRules.vfx.slice(0, 3).forEach(t => finalTags.add(t));
  elemRules.lighting.slice(0, 2).forEach(t => finalTags.add(t));
  elemRules.background.slice(0, 2).forEach(t => finalTags.add(t));

  if (cardType === 'unit') {
    elemRules.accessories.slice(0, 2).forEach(t => finalTags.add(t));
    if (!Array.from(finalTags).some(t => t === '1girl' || t === '1boy')) {
      finalTags.add('1girl');
    }
  }

  // 5단계: 상호 충돌 태그 정제 (e.g. no_humans vs 1girl)
  const tagList = Array.from(finalTags);
  const sanitizedList = [];

  tagList.forEach(t => {
    if (cardType === 'unit') {
      if (t === 'no_humans') return; // 소환수는 no_humans 배제
    } else if (cardType === 'spell' || cardType === 'structure') {
      if (t === '1girl' || t === '1boy' || t === 'solo') return; // 주문/건축물은 인물 태그 배제
    }
    sanitizedList.push(t);
  });

  // 목표 태그 수로 컷 & NovelAI 규격 언더스코어(_)를 스페이스( )로 변환
  return sanitizedList.slice(0, targetLength).map(t => t.replace(/_/g, ' ')).join(', ');
}

/**
 * 🏷️ 7. 한국어 컨셉 → Danbooru 시드 태그 사전
 *
 * ⚠️ 메인 카드 생성 경로가 이 사전을 씁니다. LLM은 더 이상 영어 태그를 만들지 않습니다.
 *    (LLM은 한국어 창작만 담당 → 출력이 짧아져 JSON 파싱 실패가 줄고 한국어 품질이 오릅니다)
 *
 * 태그 품질을 올리고 싶으면 프롬프트가 아니라 **이 표**를 늘리세요.
 *
 * ⚠️ 키 작성 규칙 — 반드시 지킬 것:
 *    1. **한 글자 키를 쓰지 마세요.** 한국어는 한 글자가 흔한 단어에 파묻힙니다.
 *       실제로 겪은 오탐: '피'→"피해", '해'→"피해", '물'→"건축물", '별'→"특별",
 *       '활'→"부활", '설'→"전설", '달'→"전달", '포'→"공포", '창'→"창조"
 *       카드 효과 설명에 "피해", "방어막" 같은 말이 항상 들어가므로 치명적입니다.
 *    2. 애매하면 조사까지 붙여 특정하세요 ('용' ✗ → '용의' '비룡' '드래곤' ○)
 */
export const KOREAN_CONCEPT_SEEDS = [
  // ── 무기 ─────────────────────────────────────────────
  { keys: ['검사', '검성', '검객', '장검', '마검', '성검', '참격', '칼날', '블레이드', '검을', '검의'],
    tags: ['sword', 'holding_sword', 'glowing_weapon'] },
  { keys: ['대검', '그레이트소드', '거검'], tags: ['greatsword', 'huge_weapon'] },
  { keys: ['단검', '비수', '암기', '나이프'], tags: ['dagger', 'holding_dagger'] },
  { keys: ['장창', '투창', '랜스', '스피어', '창날', '창을', '창기'], tags: ['spear', 'holding_spear', 'polearm'] },
  { keys: ['지팡이', '스태프', '완드', '마법사', '마도사', '주술'], tags: ['staff', 'holding_staff', 'magic_wand'] },
  { keys: ['방패', '실드', '수호', '결계', '방벽'], tags: ['shield', 'magical_barrier', 'aegis'] },
  { keys: ['궁수', '화살', '활시위', '장궁', '석궁'], tags: ['bow_(weapon)', 'holding_bow', 'arrow'] },
  { keys: ['사신', '데스사이드', '낫을'], tags: ['scythe', 'holding_scythe'] },
  { keys: ['도끼', '액스', '전부(무기)'], tags: ['axe', 'holding_axe'] },
  { keys: ['캐논', '총격', '대포', '포탄', '총구'], tags: ['gun', 'holding_gun'] },
  { keys: ['채찍'], tags: ['whip', 'holding_whip'] },
  { keys: ['마도서', '그리모어', '서책', '고서'], tags: ['book', 'holding_book', 'glowing_runes'] },
  { keys: ['성배', '제단', '유물', '성물'], tags: ['holy_grail', 'golden_altar', 'ornate_relic'] },

  // ── 신체 / 복장 ──────────────────────────────────────
  { keys: ['날개', '천사', '비익'], tags: ['wings', 'feathered_wings', 'glowing_halo'] },
  { keys: ['뿔', '악마', '마족'], tags: ['horns', 'demon_horns', 'slit_pupils'] },
  { keys: ['꼬리', '수인', '짐승'], tags: ['tail', 'animal_ears'] },
  { keys: ['가면', '복면'], tags: ['mask', 'covered_face'] },
  { keys: ['갑옷', '기사', '철갑', '중장'], tags: ['armor', 'plate_armor', 'gauntlets'] },
  { keys: ['로브', '망토', '외투', '후드'], tags: ['robe', 'cape', 'hood'] },
  { keys: ['왕관', '티아라', '제왕', '군주'], tags: ['crown', 'ornate_clothing'] },
  { keys: ['안대'], tags: ['eyepatch'] },
  { keys: ['은발', '백발', '설발'], tags: ['silver_hair'] },
  { keys: ['금발'], tags: ['blonde_hair'] },
  { keys: ['흑발'], tags: ['black_hair'] },
  { keys: ['적발', '홍발'], tags: ['red_hair'] },
  { keys: ['청발'], tags: ['blue_hair'] },

  // ── 속성 / 연출 ──────────────────────────────────────
  { keys: ['화염', '불꽃', '작열', '홍련', '화상', '용암', '업화', '염화', '겁화'],
    tags: ['flames', 'fire_particles', 'embers'] },
  { keys: ['얼음', '서리', '빙결', '한파', '동결', '설원', '빙하', '절대영도'],
    tags: ['ice_crystals', 'frost', 'snowflakes'] },
  { keys: ['번개', '전격', '감전', '벼락', '뇌전', '뇌제', '뇌신', '낙뢰'],
    tags: ['electricity', 'lightning_bolts', 'sparks'] },
  { keys: ['신성', '광휘', '성스', '천상', '축복', '성광'],
    tags: ['divine_glow', 'god_rays', 'sacred_runes'] },
  { keys: ['암흑', '심연', '그림자', '어둠', '흑염', '저주', '나락'],
    tags: ['dark_particles', 'shadow_wisps', 'purple_aura'] },
  { keys: ['자연', '숲', '나무', '대지', '세계수', '덩굴', '수목'],
    tags: ['glowing_leaves', 'green_energy_vines', 'pollen_particles'] },
  { keys: ['유혈', '흡혈', '선혈', '혈액', '피를'], tags: ['blood', 'crimson_mist'] },
  { keys: ['성좌', '우주', '천체', '별빛', '성운', '별의'], tags: ['starry_sky', 'constellation'] },
  { keys: ['달빛', '월광', '보름달', '초승달', '월야'], tags: ['moon', 'moonlight'] },
  { keys: ['태양', '일륜', '햇빛', '양광'], tags: ['sun', 'sunlight', 'lens_flare'] },
  { keys: ['화원', '벚꽃', '꽃잎', '만개'], tags: ['flower_petals', 'falling_petals'] },
  { keys: ['바다', '해일', '심해', '파도', '해저', '물결', '호수'],
    tags: ['water_splashes', 'underwater_light_rays'] },
  { keys: ['바람', '질풍', '폭풍', '풍압', '돌풍'], tags: ['wind', 'floating_hair', 'motion_blur'] },
  { keys: ['기계', '강철', '기갑', '기공'], tags: ['mecha', 'mechanical_parts', 'metallic_sheen'] },
  { keys: ['시간', '시계', '태엽', '시공'], tags: ['clock', 'gears', 'time_distortion'] },
  { keys: ['드래곤', '비룡', '용족', '용의', '흑룡', '청룡', '성룡', '용기사'],
    tags: ['dragon_horns', 'dragon_wings', 'draconic_aura'] },
  { keys: ['정령', '요정'], tags: ['fairy', 'glowing_particles', 'translucent_wings'] },
  { keys: ['해골', '언데드', '망령', '유령', '망자'], tags: ['skeleton', 'undead', 'ghostly_aura'] }
];

// 여성/남성 캐릭터를 시사하는 한국어 단서
const FEMALE_HINTS = ['마녀', '사제', '소녀', '여왕', '발키리', '엘프', '무녀', '성녀', '여신',
                      '공주', '요정', '인어', '수녀', '여전사', '여검', '그녀'];
const MALE_HINTS = ['마왕', '기사', '암살자', '전사', '검사', '검성', '군주', '사도', '용병',
                    '광전사', '성기사', '도적', '사냥꾼', '대공', '패왕'];
// 인물이 아예 없는 컨셉 (몬스터/무생물)
const NON_HUMAN_HINTS = ['골렘', '마수', '야수', '괴수', '슬라임', '해골', '망령',
                         '거수', '군단', '무리', '드래곤', '비룡'];

/**
 * 한국어 컨셉 문자열에서 Danbooru 시드 태그를 뽑아 확장한다.
 * @param {string} concept  카드 이름·스킬명·설명 등 한국어 텍스트
 * @param {string} element  fire|water|lightning|holy|dark|nature
 * @param {string} cardType unit|spell|structure
 */
export function extractCoreSeedsFromConcept(concept = '', element = 'fire', cardType = 'unit') {
  const text = String(concept || '');
  const seeds = [];

  // 1) 구도 / 인물 유무
  //    인물 단서(검사·기사 등)가 몬스터 단서보다 우선한다.
  //    "심연의 용기사"는 드래곤 모티프의 사람이지 드래곤 자체가 아니다.
  if (cardType === 'unit') {
    const isFemale = FEMALE_HINTS.some(k => text.includes(k));
    const isMale = MALE_HINTS.some(k => text.includes(k));
    if (isFemale) {
      seeds.push('1girl', 'solo', 'beautiful_face');
    } else if (isMale) {
      seeds.push('1boy', 'solo', 'handsome');
    } else if (NON_HUMAN_HINTS.some(k => text.includes(k))) {
      seeds.push('monster', 'solo', 'no_humans');
    } else {
      seeds.push('1girl', 'solo');
    }
  } else if (cardType === 'spell') {
    seeds.push('no_humans', 'magic_circle', 'burst_of_energy', 'swirling_mana');
  } else if (cardType === 'structure') {
    seeds.push('no_humans', 'ancient_sanctuary', 'magical_barrier', 'monumental_pillars');
  }

  // 2) 사전 매칭
  for (const entry of KOREAN_CONCEPT_SEEDS) {
    if (entry.keys.some(k => text.includes(k))) {
      entry.tags.forEach(t => seeds.push(t));
    }
  }

  return expandDanbooruTags(seeds.join(', '), element, cardType, 28);
}

/**
 * 🏷️ 8. 시각 프롬프트 생성 파이프라인 (메인 경로)
 *
 * 역할 분담:
 *   LLM             → 한국어 컨셉을 이해하고 **영어 핵심 키워드 3~6개**로 요약 (의미 담당)
 *   여기(확장기)     → 그 키워드를 Danbooru 태그 세트로 확장 (문법·동시등장·개수 담당)
 *
 * LLM에게 완성된 28개 태그를 요구하지 않는 이유: 소형 모델은 Danbooru 문법에 약하고
 * 출력이 길어질수록 JSON이 깨진다. 반대로 한국어를 코드가 번역하려 들면
 * "피해"의 '피'가 blood로, '해'가 바다로 잡히는 식의 오탐을 피할 수 없다.
 * 의미는 LLM이, 형식은 코드가 맡는 것이 양쪽 모두에게 쉬운 일이다.
 *
 * @param {object} card        { name, title, themeName, visualSeeds, skill } 형태
 * @param {string} element     fire|water|lightning|holy|dark|nature
 * @param {string} cardType    unit|spell|structure
 * @param {string} userConcept 사용자가 입력한 원본 컨셉 (폴백 시에만 사용)
 */
export function buildVisualPromptFromCard(card = {}, element = 'fire', cardType = 'unit', userConcept = '') {
  const skill = card.skill || (card.skills && card.skills[0]) || {};

  // 🧬 종족 태그를 **시드 맨 앞**에 붙인다. 뒤에 붙이면 확장기가 길이를 맞추며 잘라낸다.
  //    종족은 "무엇을 그릴 것인가"의 뼈대라 확장 태그보다 우선한다 (DECISIONS #106).
  //    ⚠️ 최종 **출력** 순서는 확장기가 카테고리별로 다시 잡는다 — 여기서 정하는 건 생존 우선순위다.
  const raceTags = raceImageTags(card);
  const withRace = (s) => (raceTags.length > 0 ? raceTags.join(', ') + ', ' + s : s);

  // 1순위: LLM이 준 영어 핵심 키워드
  const seeds = card.visualSeeds || card.visualPrompt || '';
  if (seeds && String(seeds).trim().length > 0) {
    // LLM 키워드에 따옴표·설명문이 섞여 와도 확장기가 정규화한다
    return expandDanbooruTags(withRace(String(seeds)), element, cardType, 28);
  }

  // 폴백: LLM이 실패했거나 오프라인 -> 한국어 사전으로 최소한의 시드를 뽑는다.
  // 정확도는 떨어지지만 이미지가 아예 안 나오는 것보다는 낫다.
  const koreanParts = [userConcept, card.name, card.title, card.themeName,
                       skill.name, skill.description].filter(Boolean);
  const fallback = extractCoreSeedsFromConcept(koreanParts.join(' '), element, cardType);
  return withRace(fallback);
}
