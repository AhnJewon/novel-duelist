# 작업 규칙

이 문서는 **"어떻게 추가하는가"**를 다룹니다. "왜 이렇게 설계했는가"는
[`DECISIONS.md`](DECISIONS.md)에 있습니다.

---

## 🚫 절대 하지 말 것

### 1. 카드군에 스탯 보너스를 붙이지 마세요

이 게임은 오토체스가 아니라 **유희왕**을 지향합니다. "같은 카드군 3체 = 공격력 +4" 같은
종족 시너지는 **의도적으로 제거된 기능**입니다. 되살리지 마세요.

카드군의 가치는 오직 **연계(콤보)**로만 표현합니다 — 덱 서치, 연쇄 폭격, 특수 소환, 결빙 등.
`evaluateFieldSynergy()`가 돌려주는 `count`는 순수 정보 표시용이며, 여기에 `bonusAtk` 같은
필드를 추가하면 안 됩니다.

> 과거에 `bonusAtk`이 있었지만 실제로는 값이 생성되지 않아 항상 0이었고, 그 사실을 모르고
> "버그"로 오해해 고쳤다가 다시 제거한 이력이 있습니다. ([DECISIONS.md #4](DECISIONS.md))

### 2. 상태이상을 즉발 HP 차감으로 처리하지 마세요

`state.playerHp -= 8` 같은 코드로 화상/맹독을 구현하면 안 됩니다. 반드시
`applyStatus(statuses, 'poison', 3, 8)`로 등록하세요. 그래야 카드에 표시된
"3턴 지속"이 실제 동작과 일치합니다.

### 3. 사용자·LLM 문자열을 이스케이프 없이 HTML에 넣지 마세요

카드 이름과 카드군 이름은 **LLM이 만듭니다.** 따옴표가 섞여 들어옵니다.

```js
// ❌ 이름에 ' 하나만 있어도 핸들러가 통째로 죽는다
`<span onclick="showKeywordInfo('${card.themeName}')">${card.name}</span>`

// ✅
`<span onclick="showKeywordInfo('${escapeJsString(card.themeName)}')">${escapeHtml(card.name)}</span>`
```

- HTML 본문 → `escapeHtml()`
- 인라인 핸들러의 JS 문자열 리터럴 → `escapeJsString()`

### 4. `window.event`를 쓰지 마세요

비표준 API라 모듈/비동기 경로에서 `undefined`가 됩니다. 버튼 하이라이트는
`document.getElementById('...-filter-' + value)` 패턴으로 처리하세요
(`filterType`, `filterCollection` 참고).

### 5. `state`에 전투 임시 상태를 넣지 마세요

`bossStatus`, `playerBuffs` 등은 `battle-engine.js` 모듈 지역 변수로 두세요.
`state`에 들어가면 저장소에 영속화됩니다.

---

### 6. 새 효과 키워드를 만들면 `EFFECT_COSTS`에 반드시 등록하세요

`config.js`의 `EFFECT_COSTS`에 없는 효과는 파워 예산 계산에서 **누락**되어
등급 제한 없이 아무 카드에나 붙습니다. 밸런스 구멍이 됩니다.

```js
myNewEffect: { cost: 3, minRarity: 'epic', label: '내 효과' }
```

### 7. 콤보 하나에 효과를 두 개 넣지 마세요

카드를 낼 때마다 터지는 효과입니다. 위력 조절은 **전개 수 비례**로만 하세요.
부수 효과가 필요하면 새 액션을 만드는 게 맞습니다. ([DECISIONS #16](DECISIONS.md))

### 8. 카드 이름에 카드군 키워드를 강제로 붙이지 마세요

소속 판정의 단일 권위는 `themeId`입니다. 이름에 키워드가 없어도 카드군 뱃지가
따로 표시되므로 문제없습니다. ([DECISIONS #17](DECISIONS.md))

### 9. 카드 스킬을 읽을 때는 `skill`과 `skills[0]`을 모두 확인하세요

카드 데이터에 두 표현이 공존합니다. 연성된 카드는 `skill`을, 스타터·카드팩 카드는
`skills[]`만 갖습니다. 한쪽만 보면 효과가 조용히 사라집니다. ([DECISIONS #15](DECISIONS.md))

---

## ⚖️ 밸런스 조정하기 — 통합 파워 예산

**등급 · 마나 · 효과 · 스탯이 하나의 방정식으로 묶여 있습니다.**

```
지불 가능한 파워 = 기본치[등급] + 마나코스트 × 효율[등급]
사용한 파워      = 효과 점수 + 스탯 점수
```

| 고칠 것 | 위치 |
|---|---|
| 등급별 효율·기본치 | `config.js` `RARITY_POWER` |
| 효과별 점수·최소등급 | `config.js` `EFFECT_COSTS` |
| 스탯의 파워 환산 | `config.js` `STAT_POWER_DIVISOR` |
| 연계 액션 등급 | `archetype-combos.js` 각 액션의 `tier` |

프롬프트(`card-forge.js`, `card-pack.js`)에도 같은 규칙이 텍스트로 있으니 함께 고치세요.

### 교정 순서를 바꾸지 마세요

```
1. 등급 요건 미달 효과 제거
2. 마나 코스트를 올려 파워를 산다   ← 이 단계가 핵심
3. 그래도 넘치면 비싼 효과 제거
4. 그래도 넘치면 스탯 삭감
```

2번이 있어야 **"낮은 등급이 여러 효과를 갖되 마나를 많이 쓴다"**가 성립합니다.
이 단계를 빼면 낮은 등급 카드가 그냥 약해지기만 합니다.

진단:

```js
const cfg = await import('/js/config.js');
cfg.affordablePower('rare', 4);         // → 8 (등급 rare, 마나 4가 살 수 있는 파워)
cfg.evaluateCardPower(card);
// → { affordable, effectPower, statPower, used, balance, overBudget, effects, illegal }

state.cardsCollection.filter(c => cfg.evaluateCardPower(c).overBudget).map(c => c.name);
```

기존 카드 재적용(파괴적 — 백업 자동 생성):

```js
await window.rebalanceExistingCards({ dryRun: true });
await window.rebalanceExistingCards();
await window.restoreCardsBackup();
```

---

## 🎮 PvE / PvP 모드

```js
const cs = await import('/js/combat-side.js');
cs.setBattleMode('pvp');   // 상대도 마나를 쓰고, 스크립트 패턴 없음
cs.setBattleMode('pve');   // 보스는 마나 없음(가상 99) + 콤보 패턴 사용
```

모드별 차이는 `BATTLE_MODES` **한 곳**에 있습니다. 새 차이점이 생기면 여기에 필드를
추가하고 해당 지점에서 `modeConfig()`를 읽으세요. 조건문을 여기저기 흩뿌리지 마세요.

---

## ➕ 새 카드군 연계(콤보 액션) 추가하기

**고칠 파일은 `js/archetype-combos.js` 하나뿐입니다.**

```js
export const ARCHETYPE_COMBO_ACTIONS = {
  // ... 기존 8종
  myNewAction: {
    label: '내 연계',
    player({ theme, card, game, helpers }) {
      const { addBattleLog, audio, dealDamageToBoss, drawCards,
              setBossStatus, setPlayerStatus, setPlayerBuff } = helpers;
      // 발동 조건이 안 맞으면 null을 반환 (아무 일도 안 일어남)
      if (game.playerHand.length === 0) return null;

      // ... 효과 구현 ...
      return { name: `${theme.name} 내 연계`, triggered: true };
    },
    boss({ theme, card, game, helpers }) {
      const { addBattleLog, audio, applyDirectDamageToPlayer } = helpers;
      // ... 보스 버전 ...
      return { name: `보스 ${theme.name} 내 연계`, triggered: true };
    }
  }
};
```

그 다음 **두 곳**에 새 액션 이름을 알려야 합니다.

1. `card-forge.js` / `card-pack.js`의 프롬프트 안 `themeComboAction` 열거값
2. `archetype-combos.js`의 `ACTION_KEYWORD_HINTS` (설명문 기반 추론용, 선택)

`battle-engine.js`는 **건드릴 필요가 없습니다.** `runArchetypeCombo()`가 테이블을 보고
자동으로 디스패치합니다.

### 현재 액션 14종 — 각 액션은 효과 하나만, `tier`로 위력 보정

| tier | 배율 | 액션 | 플레이어 효과 |
|---:|---:|---|---|
| 1 | ×1.0 | `manaCharge` | 마나 +1 |
| 1 | ×1.0 | `chainDamage` | 연계 피해 |
| 1 | ×1.0 | `shieldHeal` | 방어막 |
| 2 | ×0.85 | `search` | 덱에서 같은 카드군 1장 서치 |
| 2 | ×0.85 | `draw` | 카드 1장 드로우 |
| 2 | ×0.85 | `archetypeRally` | **같은 카드군** 소환수 공격력 강화 |
| 2 | ×0.85 | `archetypeGuard` | **같은 카드군** 소환수 도발 + 방어력 |
| 3 | ×0.7 | `freeze` | 상대 1턴 동결 |
| 3 | ×0.7 | `specialSummon` | 토큰 소환 |
| 3 | ×0.7 | `archetypeSalvage` | 덱에서 **같은 카드군** 회수 |
| 3 | ×0.7 | `shieldBreak` | 상대 방어막 파괴 |
| 3 | ×0.7 | `handDisrupt` | 상대 손패 파기 |
| 4 | ×0.55 | `doubleCast` | 다음 카드 2연속 |
| 4 | ×0.55 | `sacrificeStrike` | **같은 카드군** 소환수를 제물로 대형 피해 |

`archetype*` 액션은 범용 버프가 아니라 **자기 카드군에만** 적용됩니다.
카드군 정체성을 살리고 싶으면 이쪽을 쓰세요.

위력 조절은 **전개 수 비례**(`comboScaling`)로만 합니다. 부수 효과를 추가하지 마세요.
새 액션에는 반드시 `tier`를 붙이세요 — 없으면 1등급(보정 없음)으로 취급됩니다.

---

## 🔁 카드군 중복 피드백 루프

`archetype-proposal.js`의 `proposeArchetype()`이 2단으로 판정합니다.

1. 게이트 점수 ≥ 0.82 → **조용히 흡수** (LLM 호출 없음)
2. 회색지대 → `findRivalArchetypes()`가 **속성·연계 일치까지 포함해** 후보를 찾고,
   후보가 있으면 LLM에게 "같은 카드군인가?"를 되묻습니다
3. `merge`면 기존 id 채택, `distinct`면 재명명 후 게이트 재검사

카드팩(5장)은 비용 때문에 `allowFeedback: false`로 게이트만 씁니다.
단일 카드 연성은 피드백 ON입니다.

```js
// 피드백 없이 후보만 확인 (LLM 호출 없음)
const ap = await import('/js/archetype-proposal.js');
ap.findRivalArchetypes({ name:'빙결의 절도', keyword:'빙결',
                         element:'water', comboAction:'freeze' });
```

---


---

## 🎨 카드군 속성 정책 바꾸기

`archetype-identity.js`의 `ELEMENT_POLICIES` / `ELEMENT_OPPOSITES`를 고칩니다.

```js
export const ELEMENT_OPPOSITES = {
  fire: 'water', water: 'fire',
  lightning: 'nature', nature: 'lightning',
  holy: 'dark', dark: 'holy'
};
```

- `mono` 단일 · `dual` 이중(상극 금지) · `multi` 다속성(상극 허용)
- 등록 시 `sanitizeElementPolicy()`가 상극 조합을 자동 제거
- 카드 생성 시 `coerceCardElement()`가 정책 밖 속성을 대표 속성으로 교정

프롬프트(`card-forge.js`, `card-pack.js`)에도 같은 규칙이 적혀 있으니 함께 고치세요.

---

## ⚡ 카드군 고유 연계 축 추가하기

연계는 **액션 × 발동조건 × 증가방식**입니다. 효과는 여전히 하나입니다([#16](DECISIONS.md)).

새 발동조건:

```js
// archetype-identity.js
export const COMBO_TRIGGERS = {
  myTrigger: {
    label: '내 조건',
    desc: '설명',
    test: ({ game, allies, card, theme }) => game.playerMana >= 5
  }
};
```

새 증가방식:

```js
export const COMBO_SCALINGS = {
  myScaling: {
    label: '내 방식',
    desc: '설명',
    value: (base, { allies, game }) => base + game.playerMaxShield / 5
  }
};
```

그 다음 프롬프트의 `comboTrigger` / `comboScaling` 열거값에 추가하세요.
`archetype-combos.js`는 건드릴 필요가 없습니다 — `runArchetypeCombo()`가
`checkTrigger()`와 `applyScaling()`을 통해 자동 적용합니다.

콤보 구현에서 수치를 쓸 때는 `scale()`을 통과시키세요:

```js
player({ theme, helpers, allies, scale }) {
  const dmg = scale(6);   // ✅ 카드군 증가방식이 적용됨
  // const dmg = 6 + allies * 3;   ❌ 하드코딩하면 축이 무시된다
}
```

---

## 🔄 카드군 초기화

LLM이 만든 이상한 카드군을 청소하고 처음부터 다시 쌓고 싶을 때:

```js
await resetArchetypes({ dryRun: true });        // 미리보기
await resetArchetypes();                         // 카드 보존 (기본)
await resetArchetypes({ deleteCards: true });    // 카드까지 삭제
await restoreArchetypeReset();                   // 되돌리기
```

**카드는 기본적으로 보존됩니다.** 이미지 생성 비용이 들어간 자산이므로
소속만 잃고 범용 카드가 됩니다.

## ➕ 새 상태이상 추가하기

**고칠 파일은 `js/status-effects.js` 하나입니다.**

```js
export const STATUS_EFFECTS = {
  myStatus: {
    name: '내상태', icon: '🌀', color: 'text-pink-300',
    // 아래 중 필요한 것만 골라 선언
    blocksTurn: true,              // 턴 행동 봉쇄 (기절/빙결처럼)
    dot: true, defaultValue: 5,    // 매 턴 지속 피해
    ignoresShield: true,           //   └ 방어막 무시 여부
    bonusOnHit: true,              // 피격 시 추가 피해 (감전처럼)
    damageTakenMultiplier: 1.5     // 받는 피해 배율 (취약처럼)
  }
};
```

선언만 하면 부여·틱·감쇠·UI 뱃지가 자동으로 동작합니다.

카드 뱃지 문구를 커스터마이즈하려면 `card-renderer.js`의 `STATUS_BADGE_LABEL`과
`STATUS_BADGE_TONES`에 항목을 추가하세요.

---

## ➕ 새 스킬 뱃지 추가하기

`card-renderer.js`의 `SKILL_BADGE_SPECS` 배열에 **한 줄** 추가합니다.

```js
{ key: 'myEffect', tone: 'cyan', when: s => s.myEffect > 0,
  label: s => `🌀 ${s.myEffect} 내효과` }
```

`key`는 `keyword-service.js`의 `KEYWORD_DEFINITIONS` 키와 맞춰야 클릭 시 설명 팝업이 뜹니다.

---

## ➕ 새 LLM 모델 추가하기

`ui.js`의 `knownLlms` 배열에 모델 태그를 추가하고, `index.html`의
`#setting-llm-model-select`에 `<option>`을 추가합니다. 두 곳이 어긋나면 설정 모달이
"custom"으로 잘못 떨어집니다.

기본값은 `storage.js`의 `state.settings.llmModel`에 있습니다.

> `ai-service.js`는 Ollama에 실제 설치된 모델 목록을 조회해서, 지정 모델이 없으면
> 설치된 것 중 하나로 자동 폴백합니다. 설정에 오타가 나도 게임은 돌아가지만
> 의도와 다른 모델이 쓰일 수 있으니 콘솔 경고를 확인하세요.

---

## 밸런스 수치 바꾸기

**모든 스탯 상한은 `config.js`의 `RARITY_BALANCE_CAPS` 한 곳에 있습니다.**
LLM이 뭘 뱉든 `sanitizeAndClampCardData()`가 이 범위로 강제 클램핑합니다.

프롬프트(`card-forge.js`, `card-pack.js`)에도 같은 수치가 텍스트로 적혀 있으니
**둘을 함께 고쳐야** 합니다. 안 그러면 LLM이 범위 밖 값을 계속 생성하고 매번 클램핑되어
카드가 전부 상한값에 붙습니다.

### % 표기 금지

카드 설명에 `%`를 쓰지 않는 것이 규칙입니다. 전투 엔진이 정수 연산만 하기 때문입니다.
`sanitizeAndClampCardData()`가 `"20% 증가"` → `"+2 증가"` 식으로 자동 치환하지만,
프롬프트에서 애초에 못 쓰게 막는 편이 훨씬 깨끗합니다.

---

---

## ⚔️ 전투 로직 작성 규칙 (대칭화 이후)

### `state.playerHp`를 직접 만지지 마세요

진영 접근자를 쓰세요. 그래야 나중에 PvP에서 상대 진영에도 같은 코드가 돌아갑니다.

```js
// ❌ 플레이어 전용이 되어버린다
state.playerHp -= dmg;
state.playerMinions.forEach(m => m.canAttack = true);

// ✅ 어느 진영에나 쓸 수 있다
side.hp -= dmg;
refreshMinions(side);
```

진영 공용 함수 (`combat-side.js`):
`canPlayCard` · `drawTo` · `discardRandom` · `growMana` · `refreshMinions` · `describeSide`

### 무작위는 반드시 `battleRng()`를 거치세요

```js
// ❌ P2P에서 양쪽 결과가 갈린다
const idx = Math.floor(Math.random() * hand.length);
const deck = cards.sort(() => 0.5 - Math.random());

// ✅ 시드로 재현되고 동기화된다
const idx = battleRng().index(hand.length);
const deck = battleRng().shuffle(cards);
```

`sort(() => 0.5 - random())`은 분포가 균일하지 않고 엔진마다 결과가 다릅니다.
`battleRng().shuffle()`은 Fisher-Yates입니다.

카드 생성·이미지 등 **전투 밖**의 무작위는 `Math.random()`을 그대로 써도 됩니다.

### 전투 재현

```js
const be = await import('/js/battle-engine.js');
be.initBattle({ seed: 12345 });     // 같은 시드 = 같은 전개
be.describeBattleSides();            // 양 진영 상태 스냅샷
```

버그 재현 시 전투 로그의 `(seed: N)`을 그대로 넣으면 그 상황이 되살아납니다.


## 코드 스타일

- 한국어 주석. 특히 **"왜"**를 남기세요. "무엇"은 코드가 이미 말합니다.
- 버그를 고쳤으면 `// 🐛 수정:` 주석으로 과거 동작을 적어두세요. 되돌리려는 사람이
  같은 실수를 반복하지 않습니다.
- 함수는 `export function`으로. 클래스는 `audio.js` 외에는 쓰지 않습니다.
- 세미콜론 사용, 들여쓰기 2칸.
- HTML 문자열은 템플릿 리터럴. Tailwind 클래스를 그대로 씁니다 (빌드가 없으므로
  `@apply`는 못 씁니다).

---

## 검증 방법

테스트 프레임워크가 없습니다. 브라우저 콘솔에서 직접 확인하세요.

```js
// 카드군 동일성 판정
const as = await import('/js/archetype-service.js');
as.compareArchetypeIdentity({name:'홍련의 검사단',keyword:'홍련'},
                            {name:'홍련 검사단',keyword:'홍련'});
// → { reason: 'keyword-exact', score: 1 }

// 중복 병합 미리보기 (실제로 쓰지 않음)
await window.mergeDuplicateArchetypes({ dryRun: true });

// 병합 되돌리기
await window.restoreArchetypeBackup();

// 상태이상 동작 확인
const se = await import('/js/status-effects.js');
const s = se.createStatusState();
se.applyStatus(s, 'poison', 3, 8);
se.collectDamageOverTime(s);   // → [{type:'poison', damage:8, ...}]
```

> **캐시 주의:** 정적 서버가 모듈을 캐싱해서 수정이 반영되지 않는 경우가 있습니다.
> 콘솔에서 `await fetch('/js/파일.js', {cache:'reload'})` 후 새로고침하거나,
> 개발자 도구에서 "캐시 사용 안 함"을 켜세요.
