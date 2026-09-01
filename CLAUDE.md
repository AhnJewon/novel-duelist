# Novel Duelist — AI 에이전트용 안내

작업을 시작하기 전에 이 파일을 읽으세요. 상세 내용은 `docs/`에 있습니다.

| 문서 | 언제 읽나 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 구조 파악, 어느 파일을 고칠지 판단 |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | 기능 추가 전 (**금지사항 포함**) |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 기존 코드를 되돌리거나 바꾸기 전 |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | 뭔가 안 될 때 |
| [`docs/AI-MODELS.md`](docs/AI-MODELS.md) | LLM/이미지 생성 관련 작업 |

---

## 프로젝트 한 줄 요약

로컬 LLM(Ollama)이 카드를 기획하고 NovelAI가 일러스트를 그리는, 빌드 스텝 없는
바닐라 ES 모듈 웹 카드게임.

## 실행

```bash
./run_game.ps1
```

`file://`로 열면 CORS로 안 됩니다. 반드시 HTTP(포트 5173)로 서빙하세요.

빌드·테스트·린트 명령이 **없습니다.** 파일 저장 → 브라우저 새로고침이 전부입니다.

---

## 🚫 이것만은 하지 마세요

1. **카드군에 스탯 보너스를 붙이지 마세요.** 오토체스가 아니라 유희왕식 연계를
   지향합니다. 과거에 `bonusAtk`을 "죽은 코드 버그"로 오해해 되살렸다가 다시
   제거한 이력이 있습니다 → [DECISIONS #4](docs/DECISIONS.md)

2. **상태이상을 즉발 HP 차감으로 구현하지 마세요.** 반드시 `applyStatus()`로
   등록하세요. 안 그러면 카드에 적힌 "3턴 지속"과 실제 동작이 어긋납니다.

3. **LLM이 만든 문자열을 이스케이프 없이 HTML에 넣지 마세요.**
   `escapeHtml()` / `escapeJsString()`을 쓰세요.

4. **`window.event`를 쓰지 마세요.** 비표준이라 모듈 경로에서 `undefined`입니다.


5. **전투 로직에서 `Math.random()`을 쓰지 마세요.** `battleRng()`를 쓰세요 —
   P2P 락스텝 동기화가 깨집니다. → [DECISIONS #28](docs/DECISIONS.md)

6. **`state.playerHp`를 직접 만지지 마세요.** `side.hp`를 쓰세요 —
   진영을 바꿔 끼울 수 없게 됩니다. → [DECISIONS #29](docs/DECISIONS.md)
7. **새 카드 생성 경로를 만들면 `coerceCardElement()`를 반드시 끼우세요.** 안 넣으면
   어둠 카드군에 화염 카드가 섞입니다. → [DECISIONS #50](docs/DECISIONS.md)

7b. **카드 이름에 카드군 키워드를 강제로 붙이지 마세요.** 소속 판정 권위는 `themeId`입니다.
   → [DECISIONS #17](docs/DECISIONS.md)

8. **새 효과 키워드는 `config.js`의 `EFFECT_COSTS`에 반드시 등록하세요.** 누락하면
   등급 제한 없이 아무 카드에나 붙는 밸런스 구멍이 됩니다. → [DECISIONS #14](docs/DECISIONS.md)

9. **`_archive/`를 근거로 판단하지 마세요.** 로드되지 않는 참고용 사본입니다.
   항상 `js/`를 보세요.

10. **태그 SLM 출력을 정제 없이 NovelAI에 넣지 마세요.** 판권 캐릭터, 모순 태그
    (`red hair`+`blue hair` 동시), `blurry` 같은 유해 태그가 섞여 나옵니다.
    반드시 `cleanSlmTags()`를 거치세요. → [DECISIONS #44](docs/DECISIONS.md)

11. **NovelAI 프롬프트에서 소괄호 `()`를 벗기지 마세요.** NovelAI의 가중치 문법은
    `{}`/`[]`이고 `()`는 Stable Diffusion WebUI 문법입니다. `flame (weapon)`은
    정상적인 Danbooru 태그 이름입니다. → [DECISIONS #47](docs/DECISIONS.md)

12. **전장 마크업을 복제하지 마세요.** id가 두 벌이 되면 renderBattleUI가 숨겨진
    쪽을 갱신해 화면이 조용히 안 바뀝니다. `battle-arena.js`가 노드를 옮깁니다.
    → [DECISIONS #58](docs/DECISIONS.md)

13. **상대 손패 내용이나 다음 수를 UI에 노출하지 마세요.** 숨은 정보입니다.
    장수만 공개합니다. → [DECISIONS #56](docs/DECISIONS.md)

14. **PvP에서 `playBossCard()`를 쓰지 마세요.** PvE 전용이라 전투의 함성이 빠지고
    주문 피해에 ×0.7이 붙어 양쪽 화면이 어긋납니다. `playFoeCardPvp()`를 쓰세요.
    → [DECISIONS #55](docs/DECISIONS.md)

15. **차단한 판권 태그를 네거티브 프롬프트로 보내지 마세요.** 캐릭터만이 아니라
    그 **그림체 전체**를 밀어내서 결과가 나빠집니다. → [DECISIONS #45](docs/DECISIONS.md)

---

## 자주 하는 작업의 진입점

| 하고 싶은 것 | 고칠 파일 |
|---|---|
| 새 카드군 연계 추가 | `js/archetype-combos.js` **한 곳** |
| 카드군 속성 정책 / 발동조건 / 증가방식 | `js/archetype-identity.js` **한 곳** |
| 카드군 플레이스타일 (덱 설계도) | `js/archetype-identity.js`의 `ARCHETYPE_PLAYSTYLES` |
| 건축물 패시브 · 오라 | `js/config.js`의 `buildStructurePassive` + `js/battle-engine.js`의 오라 계산 |
| 카드군 초기화 · 병합 · 보수 | `js/archetype-service.js` (콘솔에서 `resetArchetypes()`) |
| 전투 진영 공용 동작 (마나·드로우·슬롯) | `js/combat-side.js` |
| PvE / PvP 모드 차이 | `js/combat-side.js`의 `BATTLE_MODES` |
| 등급·마나·효과 밸런스 | `js/config.js`의 `RARITY_POWER` + `EFFECT_COSTS` |
| 카드 타입별 예산 (소환수/건축물/마법/함정) | `js/config.js`의 `TYPE_POWER` **한 곳** |
| 효과 **크기**의 값 (피해 28 vs 8) | `js/config.js`의 `EFFECT_MAGNITUDE` **한 곳** |
| 전투 무작위 / 재현 | `js/rng.js` (`initBattle({seed})`) |
| 새 상태이상 추가 | `js/status-effects.js` **한 곳** |
| 상태이상 적용 범위 (소환수 전용 여부) | `js/status-effects.js`의 `entityOnly` + `config.js`의 `ENTITY_ONLY_STATUSES` |
| 스탯 체증·체감 곡선 | `js/config.js`의 `STAT_CURVE` |
| 새 스킬 뱃지 추가 | `js/card-renderer.js`의 `SKILL_BADGE_SPECS` |
| 밸런스 수치 조정 | `js/config.js`의 `RARITY_BALANCE_CAPS` **+ 프롬프트 텍스트도 함께** |
| 카드 생성 프롬프트 | `js/card-forge.js`(1장) / `js/card-pack.js`(5장) |
| LLM 파라미터 | `js/ai-service.js`의 `callOllamaChat()` |
| 이미지 태그 규칙 (규칙 기반) | `js/dan-tag-gen.js` |
| 태그 SLM · 작가/화풍 · 판권 정책 | `js/tag-slm.js` **한 곳** |
| 카드 타입별 작명 규칙 | `js/card-naming.js` **한 곳** |
| PvP 매칭 · 방 코드 UI | `js/pvp-ui.js` |
| PvP 카드 해석 (거울) | `js/battle-engine.js`의 `playFoeCardPvp()` |
| 전장을 탭 사이로 옮기기 | `js/battle-arena.js` |
| 플레이어 프로필 · 초상 | `js/player-profile.js` / `js/profile-ui.js` |

## 핵심 불변식

- 전역 상태는 `storage.js`의 `state` **하나**. 리액티브가 없으므로 변경 후
  렌더 함수를 **직접 호출**해야 합니다.
- 전투 임시 상태(`bossStatus`, `playerBuffs` 등)는 `battle-engine.js` 모듈 지역 변수.
  `state`에 넣으면 저장소로 새어 나갑니다.
- `main.js`의 부팅 순서에는 의존성이 있습니다. `mergeDuplicateArchetypes()`는
  반드시 `loadInitialData()` **뒤에** 와야 합니다.
- 저장은 IndexedDB 우선 + localStorage 백업. 이미지가 base64라 5MB를 쉽게 넘깁니다.

## 검증 방법

테스트 프레임워크가 없습니다. 브라우저 콘솔에서 확인하세요.
스니펫은 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) 마지막 절에 있습니다.

> **수정이 반영 안 되면 캐시입니다.** `await fetch('/js/파일.js', {cache:'reload'})`
> 후 새로고침하세요. 이게 가장 흔한 함정입니다.

## 코드 스타일

한국어 주석. **"왜"**를 남기세요 — "무엇"은 코드가 말합니다.
버그를 고쳤으면 `// 🐛 수정:` 으로 과거 동작을 적어두세요.

16. **건축물 오라를 `entity.attack`에 더해 저장하지 마세요.** 건축물이 죽어도
    보너스가 남습니다. 항상 읽는 시점에 `auraAttackBonus()`로 계산하세요.
    → [DECISIONS #67](docs/DECISIONS.md)

17. **건축물 패시브를 속성으로 분기하지 마세요.** 한 번 그렇게 했다가 자유도를
    죽여서 되돌렸습니다. 판단 주체는 **LLM > 카드군 플레이스타일** 순입니다.
    → [DECISIONS #67](docs/DECISIONS.md)

18. **카드팩 선택을 카드 id로 식별하지 마세요.** 중복 카드가 나오면 깨집니다.
    슬롯 인덱스(`data-pack-idx`)를 쓰세요. → [DECISIONS #68](docs/DECISIONS.md)

19. **`affordablePower`를 타입 없이 부르지 마세요.** 세 번째 인자가 카드 타입입니다.
    빼면 전부 소환수 예산으로 계산돼 타입별 분리가 무효가 됩니다.
    → [DECISIONS #69](docs/DECISIONS.md)

20. **`trapTrigger`에 비용을 매기지 마세요 (cost 0).** 발동조건은 제약이지 능력이
    아닙니다. 조건부 보상은 `TYPE_POWER.trap.budgetMult` 한 곳에서만 줍니다.
    → [DECISIONS #69](docs/DECISIONS.md)

21. **예산에 카드 타입 예외를 추가하지 마세요.** 예외가 필요해 보이면 거의 항상
    `TYPE_POWER` 수치가 잘못된 것입니다. 건축물 예외를 넣었다가 제거한 이력이
    있습니다. → [DECISIONS #69](docs/DECISIONS.md)

22. **`EFFECT_MAGNITUDE.perUnit`을 임의로 낮추지 마세요.** "커먼 등급 중간값 ≈ 1단위"
    기준으로 맞춰져 있습니다. 낮추면 **모든 카드가 비싸져** 코스트 곡선이 통째로
    올라갑니다. → [DECISIONS #70](docs/DECISIONS.md)

23. **`multiHit`을 `EFFECT_MAGNITUDE`에 추가하지 마세요.** `damage`가 이미
    총량(damage × multiHit)으로 값을 냅니다. 이중 청구가 됩니다.
    → [DECISIONS #70](docs/DECISIONS.md)

24. **효과 수치를 깎는 코드를 추가하면 `syncDescriptionNumbers`도 다시 돌리세요.**
    안 하면 카드에 28이라 적혀 있는데 20이 들어갑니다.
    → [DECISIONS #70](docs/DECISIONS.md)

25. **소환수 상태이상을 두 곳에서 소모하지 마세요.** `tickMinionStatuses()`가
    유일한 소모 지점입니다. `refreshMinions`와 `foeMinionAttack`은 `blockedBy`
    플래그만 읽습니다. 두 번 소모하면 기절이 절반 턴만 갑니다.
    → [DECISIONS #72](docs/DECISIONS.md)

26. **`config.js`의 `ENTITY_ONLY_STATUSES`와 `status-effects.js`의 `entityOnly`를
    같이 고치세요.** 순환 import를 피해 복제한 목록입니다. 한쪽만 고치면 예산과
    실제 동작이 어긋납니다. → [DECISIONS #72](docs/DECISIONS.md)

27. **LLM 프롬프트(템플릿 리터럴) 안에서 백틱을 쓰지 마세요.** 리터럴이 조기
    종료돼 `SyntaxError`가 납니다. 큰따옴표를 쓰세요.
    → [DECISIONS #72](docs/DECISIONS.md)

28. **`STAT_CURVE`의 `pivot`을 옮기지 마세요.** pivot에서 선형과 같아지도록
    정규화돼 있어서, 옮기면 **모든 카드의 코스트가 움직입니다.**
    → [DECISIONS #71](docs/DECISIONS.md)

29. **소환수 피해 계산은 `damageEntity()` 한 곳입니다.** 수비력·오라·취약·감전이
    모두 여기서 처리됩니다. 우회해서 `currentHp`를 직접 깎으면 그 전부가 무시됩니다.
    → [DECISIONS #73](docs/DECISIONS.md)

30. **피해 로그에 요청값을 찍지 마세요.** `damageEntity`의 반환값(`dealt`)을 쓰고
    `describeDamageExtras()`로 근거를 붙이세요. 요청값을 찍으면 수비력·취약·감전이
    붙는 순간 로그가 거짓이 됩니다. → [DECISIONS #73](docs/DECISIONS.md)
