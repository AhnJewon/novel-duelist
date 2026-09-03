// card-type-rules.js - 카드 타입별 프롬프트 규칙 **한 곳**
//
// 🐛 왜 만들었나: 예전에는 한 프롬프트에 네 타입의 규칙을 **전부** 실었다.
//    소환수를 만들 때도 함정 발동조건·건축물 패시브·바닐라 규칙이 같이 들어갔다.
//    그러면 LLM이 타입 특징을 섞는다 — 실제로 이런 것들이 나왔다:
//      · 소환수에 "상대가 소환수를 낼 때" 같은 함정식 반응 효과
//      · 함정에 "0 공격을 가합니다" 같은 소환수 문구
//      · 건축물에 소환수 이름
//
//    카드 타입은 생성 **전에** 정해진다. 그러니 그 타입 규칙만 보내면 된다.
//    관계없는 규칙은 노이즈일 뿐 아니라 **섞임의 원인**이다.
//
// ⚠️ 규칙을 고칠 때는 여기 한 곳만 본다. card-forge와 card-pack이 공유한다.

/** 타입이 "무엇인가"를 한 줄로 못박는다 — 프롬프트 맨 앞에 온다 */
const TYPE_IDENTITY = {
  unit: `⚔️ 이 카드는 **소환수(unit)**다.
전장에 남아 매 턴 공격한다. 공격력·체력·방어력을 갖는다.
낼 때 즉시 일어나는 일(전투의 함성)만 효과로 쓸 수 있다.
❌ "상대가 ~할 때" 같은 **반응형 효과는 쓸 수 없다.** 그건 함정 전용이다.
❌ "매 턴 ~" 같은 지속 패시브도 쓸 수 없다. 그건 건축물 전용이다.`,

  spell: `🔮 이 카드는 **마법(spell)**이다.
낼 때 **한 번** 발동하고 사라진다. 전장에 남지 않는다.
공격력·체력이 **없다** (전부 0). 오직 skill의 효과만 갖는다.
❌ "매 턴 ~" / "전장에 있는 동안 ~" 은 쓸 수 없다. 마법은 남지 않는다.
❌ "상대가 ~할 때" 도 쓸 수 없다. 그건 함정 전용이다.`,

  structure: `🏛️ 이 카드는 **건축물(structure)**이다.
전장에 남지만 **공격하지 않는다.** 공격력은 0이고 체력(내구도)만 갖는다.
가치는 전부 **지속 패시브**에서 나온다 — 그게 없으면 존재 이유가 없다.
❌ 인물처럼 이름 짓지 마라. 탑·요새·제단·성소·석상 같은 **구조물**이다.
❌ "상대가 ~할 때" 반응형은 쓸 수 없다. 그건 함정 전용이다.`,

  trap: `🪤 이 카드는 **함정(trap)**이다.
뒷면으로 세트해두고, **상대가 조건을 만족하면 자동 발동**한다.
공격력·체력이 **없다** (전부 0). 오직 skill의 효과와 발동조건만 갖는다.
조건이 안 맞으면 아무 일도 없다 — 그래서 강한 효과를 싸게 넣을 수 있다.
❌ 발동조건("trapTrigger") 없이 만들면 **영영 발동하지 않는 死카드**가 된다. 반드시 지정하라.`
};

/** 타입 고유 규칙 상세 */
const TYPE_DETAIL = {
  unit: `⚔️ UNIT SKILL (소환수 시그니처 스킬):
모든 소환수는 자신의 콘셉트에 맞는 전투 스킬을 최소 1개 이상 반드시 갖는다 (피해, 방어막, 회복, 연타, 상태이상 등).
기초 스탯보다 **스킬 효과가 카드의 고유한 정체성**이므로, 스탯이 낮아지더라도 효과를 가진 카드로 기획하라.
"skill": { "name": "스킬명", "damage": 12, ... } 에 효과 수치를 반드시 지정하고, "isVanilla": false 로 둔다.
"flavorText"에는 캐릭터의 한 줄 명대사나 서사를 적는다.`,

  spell: `💥 마법은 **즉발 한 방**이다. 효과를 한두 개로 집중시켜라.
같은 마나의 소환수보다 효과가 커야 한다 — 몸이 남지 않는 대가다.`,

  structure: `🏛️ STRUCTURE PASSIVE (지속 효과 — 반드시 하나 넣어라):
"passiveEffect"에 아래 둘 중 하나를 넣는다. 성격이 완전히 다르다.

(1) 매 턴 누적형 — 턴마다 값이 쌓인다. **epic / legendary 에서만** 쓸 수 있다.
    { "manaPerTurn": 1 }          매 턴 마나 +1 (최대 2)
    { "endTurnShield": 10 }       턴 종료 시 본체 방어막 +N
    { "endTurnAoeShield": 10 }    방어막 +N & 자기 내구도 수리
    { "endTurnAoeHeal": 10 }      턴 종료 시 본체 체력 +N 회복

(2) 오라 — "이 건축물이 전장에 있는 동안". 쌓이지 않고 부서지면 사라진다.
    **모든 등급에서** 쓸 수 있다. common / rare 건축물은 이쪽을 써라.
    { "aura": { "scope": "all", "attackBonus": 2 } }
    - "scope": "all"(모든 아군) | "archetype"(같은 카드군만) | "element"(같은 속성만) | "cardType"(같은 종류만)
    - "scopeValue": scope가 element면 속성명, cardType이면 unit|spell|structure|trap
    - 효과: "attackBonus" / "defenseBonus" / "damageReduction"(5~40)
    💡 범위를 좁히면(archetype/element) 값을 더 크게 줄 수 있다.

❌ 위에 없는 필드를 지어내지 마라 ("enemyAttackDown" 등). 전부 무시된다.
❌ common / rare 건축물에 매 턴 누적형을 쓰지 마라. 시스템이 삭제한다.`,

  trap: `🪤 TRAP TRIGGER (발동조건 — **반드시** 지정하라):
- "trapTrigger": 아래 중 하나
  * "foePlaysUnit"      상대가 소환수를 낼 때
  * "foePlaysSpell"     상대가 주문을 쓸 때
  * "foePlaysStructure" 상대가 건축물을 낼 때
  * "foePlaysElement"   상대가 특정 속성 카드를 낼 때  → "condition": {"element":"fire"}
  * "foePlaysArchetype" 상대가 특정 카드군 카드를 낼 때 → "condition": {"archetype":"홍련"}
  * "foePlaysKeyword"   상대 카드가 특정 키워드를 가질 때 → "condition": {"keyword":"pierceShield"}
  * "foeAttacks"        상대가 공격할 때
  * "selfLowHp"         내 체력이 절반 이하가 될 때
  * "foeShielded"       상대가 방어막을 두르고 있을 때
- 💡 특정 속성·카드군·키워드를 노리는 함정이 가장 재미있다. 메타를 읽는 카드다.
- 조건부라 같은 마나에서 **효과를 가장 많이** 넣을 수 있다 (2~3개).`
};

/**
 * 이 타입에만 해당하는 프롬프트 규칙을 만든다.
 * @param cardType unit | spell | structure | trap
 */
export function cardTypeRules(cardType = 'unit') {
  const t = TYPE_IDENTITY[cardType] ? cardType : 'unit';
  return `${TYPE_IDENTITY[t]}\n\n${TYPE_DETAIL[t]}`;
}

/** 타입별 스탯 지침 (프롬프트 스키마 옆에 붙인다) */
export function cardTypeStatRule(cardType = 'unit') {
  if (cardType === 'spell' || cardType === 'trap') {
    return `"attack": 0, "defense": 0, "hp": 0   ← ${cardType === 'trap' ? '함정' : '마법'}은 스탯이 없다. 반드시 0.`;
  }
  if (cardType === 'structure') {
    return `"attack": 0   ← 건축물은 공격하지 않는다. 반드시 0. "hp"(내구도)와 "defense"만 갖는다.`;
  }
  return `"attack": 6-26, "defense": 2-14, "hp": 14-40   ← 등급 범위를 지킬 것`;
}
