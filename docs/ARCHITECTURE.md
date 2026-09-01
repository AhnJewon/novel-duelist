# 아키텍처

## 한눈에 보기

빌드 스텝이 없는 **순수 ES 모듈** 정적 웹앱입니다. 트랜스파일러도, 번들러도,
`package.json`도 없습니다. 파일을 저장하고 브라우저를 새로고침하면 끝입니다.

```
index.html  ──<script type="module">──▶  js/main.js  ──▶  나머지 전부
```

외부 의존성은 전부 CDN `<script>` 태그로 들어옵니다 (Tailwind, lucide, JSZip, canvas-confetti).
`js/` 안의 코드에는 npm 의존성이 하나도 없습니다.

> `_archive/`는 런타임에 로드되지 않습니다. 코드를 찾을 때는 `js/`로 범위를 좁히세요.

## 실행 방법

```bash
./run_game.ps1
```

Ollama를 `OLLAMA_ORIGINS=*`로 띄우고, 포트 5173에 정적 서버를 올린 뒤 브라우저를 엽니다.
`file://`로 직접 열면 ES 모듈이 CORS로 막혀 **동작하지 않습니다.** 반드시 HTTP로 서빙하세요.

---

## 레이어

```
                     ┌──────────────────────────────────┐
   진입점             │  main.js  (전역 바인딩 + 부팅 순서) │
                     └────────────────┬─────────────────┘
                                      │
   ┌──────────────────────────────────┼──────────────────────────────────┐
   │                                  │                                  │
┌──▼───────────┐              ┌───────▼────────┐              ┌──────────▼──────┐
│  화면/입력    │              │   게임 규칙     │              │   외부 연동      │
│              │              │                │              │                 │
│ ui.js        │              │ battle-engine  │              │ ai-service      │
│ deck-builder │              │ archetype-svc  │              │ dan-tag-gen     │
│ card-renderer│              │ archetype-     │              │ (Ollama/NovelAI)│
│ card-cropper │              │   combos       │              │                 │
│ keyword-svc  │              │ skill-effects  │              │                 │
│ card-forge   │              │ status-effects │              │                 │
│ card-pack    │              │ config (밸런스) │              │                 │
│ boss-forge   │              │                │              │                 │
└──────┬───────┘              └────────┬───────┘              └────────┬────────┘
       │                               │                               │
       └───────────────┬───────────────┴───────────────────────────────┘
                       │
              ┌────────▼─────────┐
              │ storage.js       │  ← 전역 state + IndexedDB/localStorage
              │ data.js          │  ← 기본 카드/보스/카드군 시드
              │ dom-utils.js     │  ← DOM 헬퍼 + 이스케이프
              └──────────────────┘
```

## 모듈 목록

| 모듈 | 줄 | 책임 |
|---|---:|---|
| `main.js` | 45 | 부팅 순서, HTML `onclick`용 전역 바인딩 |
| `storage.js` | 230 | 전역 `state` 객체, IndexedDB/localStorage 영속화 |
| `data.js` | 810 | 기본 스타터 카드·보스·카드군 시드 데이터 |
| `config.js` | 175 | 속성/등급/타입 상수, **밸런스 상한선**, 카드 데이터 정제기 |
| `dom-utils.js` | 61 | `$`, `escapeHtml`, `escapeJsString`, 모달 열기/닫기 |
| `status-effects.js` | 140 | **상태이상 단일 소스** (정의·부여·틱·감쇠) |
| `skill-effects.js` | 147 | 스킬 효과 적용, 도발 타겟 선택 |
| `archetype-combos.js` | 326 | **카드군 연계 액션 테이블** (플레이어/보스 구현) |
| `archetype-service.js` | 575 | 카드군 DB, **동일성 판정 게이트**, 병합 마이그레이션 |
| `battle-engine.js` | 1181 | 턴 진행, 전투 UI 렌더링, 보스 AI |
| `card-renderer.js` | 233 | 카드 DOM 생성, 스킬 뱃지 |
| `deck-builder.js` | 409 | 보관함/덱 편성 화면 |
| `card-forge.js` | 577 | 카드 1장 AI 생성 |
| `card-pack.js` | 491 | 부스터 팩 5장 AI 생성 |
| `boss-forge.js` | 518 | 보스 AI 생성, 전술 아키타입 |
| `card-cropper.js` | 385 | 일러스트 크롭/리롤 모달 |
| `keyword-service.js` | 241 | 키워드·카드군 설명 팝업 |
| `ai-service.js` | 362 | Ollama 채팅, JSON 복구 파서, NovelAI 이미지 |
| `dan-tag-gen.js` | 273 | 자연어 → Danbooru 태그 변환·확장 |
| `ui.js` | 144 | 탭 전환, 설정 모달 |
| `audio.js` | 120 | Web Audio 효과음 |

---

## 상태 관리

전역 상태는 `storage.js`의 `state` 객체 **하나**입니다. 모듈들이 직접 import해서
읽고 씁니다. 리액티브 시스템이 없으므로 **변경 후 렌더 함수를 직접 호출해야 합니다.**

```js
state.cardsCollection.push(newCard);
await saveCardsToStorage();   // 영속화
renderGrimoire();             // 화면 갱신 — 자동으로 안 됨
```

### 전투 전용 상태는 모듈 지역 변수

`battle-engine.js` 안의 `isPlayerTurn`, `bossPhase`, `bossStatus`, `playerStatus`,
`playerBuffs`는 **모듈 지역 변수**이지 `state`에 없습니다. 의도적입니다 — 전투가 끝나면
버려질 값이라 저장소에 새어 나가면 안 됩니다.

바깥에서 읽어야 하면 `getBattleStatusSnapshot()` 같은 접근자를 추가하세요.
`state`에 옮기지 마세요.

### 영속화 이중화

모든 저장은 **IndexedDB 우선, localStorage 백업**입니다. 카드 이미지가 base64 data URL이라
localStorage 5MB 한도를 쉽게 넘기기 때문입니다. 초과하면 조용히 경고만 찍고 IndexedDB로만
저장합니다.

| 키 | 내용 |
|---|---|
| `novel_duelist_cards` | 보유 카드 전체 |
| `novel_duelist_active_deck` | 출전 덱 카드 ID 배열 |
| `novel_duelist_archetypes` | 누적 카드군 DB |
| `novel_duelist_archetypes_backup_pre_merge` | 병합 직전 스냅샷 (롤백용) |
| `novel_duelist_bosses` | 보스 목록 |
| `novel_duelist_settings` | 설정 (localStorage만) |

---

## 부팅 순서 (`main.js`)

순서가 중요합니다. 바꾸기 전에 아래 의존성을 확인하세요.

```js
await loadArchetypes();            // 1. 카드군 DB 먼저
await loadInitialData();           // 2. 카드/덱/설정 (카드군 참조)
await mergeDuplicateArchetypes();  // 3. 중복 병합 — 카드가 로드된 뒤라야 소속 재매핑 가능
await loadBosses();                // 4. 보스
initBattle();                      // 5. 전투 초기화
```

`mergeDuplicateArchetypes()`가 `loadInitialData()` **뒤에** 있어야 하는 이유:
병합 시 보유 카드의 `themeId`를 대표 카드군으로 재매핑하는데, 그러려면
`state.cardsCollection`이 이미 채워져 있어야 합니다.

---

## AI 생성 파이프라인

카드 1장이 만들어지는 경로입니다. `card-forge.js`(단일)와 `card-pack.js`(5장)가
같은 모양을 따릅니다.

```
사용자 컨셉 입력
      │
      ▼
[1] getArchetypesPromptSummary()      기존 카드군 목록을 프롬프트에 주입
      │                               (보유 카드 수 상위 40개만 — 컨텍스트 보호)
      ▼
[2] callOllamaChat()                  로컬 LLM이 카드 JSON 생성
      │                               format:'json' + 실패 시 repairAndParseJson()
      ▼
[3] registerNewArchetype()            ★ 동일성 게이트 — 표기만 다른 카드군은 여기서 흡수
      │
      ▼
[4] enforceKeywordInName()            카드 이름에 카드군 키워드 강제 포함
      │
      ▼
[5] expandDanbooruTags()              시각 프롬프트를 Danbooru 태그로 확장
      │
      ▼
[6] generateNovelAIImage()            NovelAI V4.5 이미지 생성
      │
      ▼
[7] sanitizeAndClampCardData()        등급별 스탯 상한 클램핑, % 표기 제거
      │
      ▼
[8] optimizeCardImage()               800px WebP로 축소 후 저장
```

각 단계의 규칙은 [`CONVENTIONS.md`](CONVENTIONS.md)를 보세요.

### JSON 복구 3단계

로컬 4B급 모델은 JSON을 자주 깨뜨립니다. `repairAndParseJson()`이 3단계로 방어합니다.

1. 그대로 파싱 시도
2. 문법 보정 — 미닫힌 괄호/따옴표 보충, 후행 콤마 제거, 탈출 문자 찌꺼기 제거
3. 정규식 필드 추출 — JSON 구조가 완전히 망가져도 `name`만 건지면 카드를 복원

이 함수를 건드릴 때는 3단계를 **전부** 유지하세요. 모델을 바꾸면 깨지는 양상도 바뀝니다.

---

## 전투 턴 흐름

```
플레이어 턴
  ├─ playCard()          카드 시전
  │    ├─ triggerArchetypeCombo()   ← 카드군 연계 발동
  │    └─ triggerSpellEffect() / triggerBattlecry()
  ├─ attackWithMinion()  소환수 공격 (스탯 버프 없음)
  └─ playerEndTurn()
       └─ triggerStructureEndTurnPassives()

보스 턴  executeBossTurn()
  ├─ 1. 보스 지속 피해 적용 (화상/맹독)
  ├─ 2. 행동 봉쇄 판정 (기절/빙결) → 걸리면 턴 스킵
  ├─ 3. 보스 전술 카드 2~3장 시전  playBossCard()
  ├─ 4. 콤보 패턴 스텝 실행       executeSingleBossStep()
  ├─ 5. 보스 부하 공격
  └─ 6. 보스 상태이상 1턴 감쇠

플레이어 턴 시작  startPlayerTurn()
  ├─ 무적 버프 차감
  ├─ 플레이어 지속 피해 적용 + 상태이상 감쇠
  ├─ 마나 최대치 = min(10, 턴 수)
  ├─ 소환수 공격 가능 복구 / 빙결 해제
  └─ 드로우 1장
```
