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
| 직접공격(directAttack) 판정 | `js/card-keywords.js` **한 곳** (엔진·렌더러·상세가 공유) |
| 효과 대상 해석 (지정/전체/무작위) | `js/skill-effects.js`의 `resolveEffectTargets()` **한 곳** |
| 설명문 거짓말 관문 | `js/config.js`의 `findDescriptionLies()` **한 곳** |
| PvE / PvP 모드 차이 | `js/combat-side.js`의 `BATTLE_MODES` |
| 등급·마나·효과 밸런스 | `js/config.js`의 `RARITY_POWER` + `EFFECT_COSTS` |
| 덱 마나 커브 (코스트 분포) | `js/config.js`의 `COST_CURVE_WEIGHTS` |
| 보스 초반 공세 세기 | `js/battle-engine.js`의 `BOSS_RAMP` |
| 카드 타입별 예산 (소환수/건축물/마법/함정) | `js/config.js`의 `TYPE_POWER` **한 곳** |
| 효과 **크기**의 값 (피해 28 vs 8) | `js/config.js`의 `EFFECT_MAGNITUDE` **한 곳** |
| 전투 무작위 / 재현 | `js/rng.js` (`initBattle({seed})`) |
| 새 상태이상 추가 | `js/status-effects.js` **한 곳** |
| 상태이상 적용 범위 (소환수 전용 여부) | `js/status-effects.js`의 `entityOnly` + `config.js`의 `ENTITY_ONLY_STATUSES` |
| 스탯 체증·체감 곡선 | `js/config.js`의 `STAT_CURVE` |
| 새 스킬 뱃지 추가 | `js/card-renderer.js`의 `SKILL_BADGE_SPECS` |
| 밸런스 수치 조정 | `js/config.js`의 `RARITY_BALANCE_CAPS` **+ 프롬프트 텍스트도 함께** |
| 카드 생성 프롬프트 | `js/card-forge.js`(1장) / `js/card-pack.js`(5장) |
| 카드 타입별 프롬프트 규칙 | `js/card-type-rules.js` **한 곳** |
| 한국어 어법 교정 (조사·활용) | `js/korean-grammar.js` **한 곳** |
| 설명문 2단계 생성 · 검증 | `js/card-describe.js` **한 곳** |
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

전투 로직은 **하네스가 있습니다** (359항목):

```js
const A = await import('/_verify/battle-audit.js?v=' + Date.now()); await A.runAll();
```
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

31. **`targetSide`가 효과 성격과 맞는지 확인하세요.** 스킬 하나에 대상 진영은
    한 개뿐인데 한 카드에 성격이 다른 효과가 섞입니다. 해로운 효과에 `self`/`ally`,
    이로운 효과에 `foe`가 오면 `sanitizeAndClampCardData`가 교정합니다. 새 효과를
    추가하면 그 판정(`harmfulEffect`/`beneficialEffect`)에도 넣으세요.
    → [DECISIONS #74](docs/DECISIONS.md)

32. **`needsTargetPick`이 true인 효과는 `opts.picked`를 반드시 읽으세요.**
    heal이 이걸 어겨서 대상을 고르게 하고도 본체를 회복했습니다.
    → [DECISIONS #74](docs/DECISIONS.md)

33. **등급으로 코스트를 가두지 마세요.** 등급은 "그 코스트에서 얼마나 강한가"만
    정합니다. 코스트는 `COST_CURVE_WEIGHTS`에서 먼저 굴려 LLM에 넘깁니다.
    가두면 레어+ 카드가 1마나가 될 수 없어 **덱에서 저코스트가 사라집니다.**
    → [DECISIONS #75](docs/DECISIONS.md)

34. **`costLocked` 카드의 코스트를 예산으로 움직이지 마세요.** 대신 내용을 깎습니다.
    안 그러면 등급별 스탯 하한 때문에 1마나 카드가 전부 2마나로 밀립니다.
    → [DECISIONS #75](docs/DECISIONS.md)

35. **예산 정산 뒤에 효과를 되살리지 마세요.** 그러면 검사를 통과한 뒤 카드가
    조용히 예산을 넘깁니다. 효과가 없으면 **바닐라**(`isVanilla` + 플레이버)로
    두세요. → [DECISIONS #75](docs/DECISIONS.md)

36. **보스 소환수에도 소환 후유증을 적용하세요.** `summonedTurn`을 기록하고
    `refreshMinions`를 콤보 실행 **앞에** 부르세요. 뒤에 두면 이번 턴에 소환된
    소환수까지 풀려 후유증이 무효가 됩니다. → [DECISIONS #75](docs/DECISIONS.md)

37. **바닐라는 소환수 전용입니다.** 마법·함정·건축물은 효과가 전부라, 효과를 다
    지우면 발동해도 아무 일이 없는 백지 카드가 됩니다. 효과 제거 루프는
    비소환수의 **마지막 효과를 남깁니다.** → [DECISIONS #76](docs/DECISIONS.md)

38. **`describeSkillFromData`에 새 효과를 추가하면 `describeStructurePassive`에도
    넣으세요 (반대도).** 오라를 한쪽에만 넣어서 건축물이 빈 설명으로 나갔습니다.
    → [DECISIONS #76](docs/DECISIONS.md)

39. **`callOllamaChat`은 응답을 JSON으로 파싱합니다.** 평문을 요구하면 파싱에서
    통째로 실패합니다. 그리고 카드 정보는 **user 메시지**에 넣으세요 — system에만
    넣으면 4B 모델이 무시합니다. → [DECISIONS #76](docs/DECISIONS.md)

40. **설명문 검증은 스킬 필드가 아니라 `describeSkillFromData`의 결과(facts)를
    기준으로 하세요.** 필드로 대조하면 패시브·오라에서 오탐이 납니다.
    → [DECISIONS #76](docs/DECISIONS.md)

41. **`trapTrigger`를 효과로 세지 마세요.** 조건이지 능력이 아닙니다. 효과 수를
    셀 때 포함하면 **효과 0인 함정이 통과**합니다 (터져도 아무 일이 없음).
    → [DECISIONS #77](docs/DECISIONS.md)

42. **LLM 응답에서 필드를 읽는 것을 빠뜨리지 마세요.** 카드팩이 프롬프트로
    `trapTrigger`를 요구해놓고 응답에서 읽지 않아 **생성된 함정이 전부 死카드**였습니다.
    프롬프트에 필드를 추가하면 파싱·조립에도 반드시 함께 넣으세요.
    → [DECISIONS #77](docs/DECISIONS.md)

43. **설명문 2단계가 실패하면 1단계 원문을 남기지 말고 결정론적 문장으로 교체하세요.**
    sanitize는 원문이 있으면 숫자만 맞출 뿐 통째로 다시 쓰지 않습니다. 그래서
    "피해 160% 감소" 같은 미구현 서술이 살아남습니다.
    → [DECISIONS #77](docs/DECISIONS.md)

44. **프롬프트에 네 타입 규칙을 한꺼번에 싣지 마세요.** 타입은 생성 전에 정해지므로
    그 타입 규칙만 보냅니다 (`cardTypeRules()`). 다 보내면 LLM이 타입 특징을
    섞습니다 — 소환수에 함정식 효과, 함정에 소환수 문구가 나옵니다.
    → [DECISIONS #78](docs/DECISIONS.md)

45. **설명문 검증 패턴에 한국어 활용형을 넣으세요.** `/훔치/`는 "훔**친**다"를
    놓칩니다. 어간이 바뀌는 동사는 활용형도 함께 넣어야 합니다.
    → [DECISIONS #78](docs/DECISIONS.md)

46. **어법 검사에 임베딩을 쓰지 마세요.** 조사 오류는 임베딩상 0.997로 정문과
    거의 같습니다 (숫자 하나 바뀐 것보다 가깝습니다). 규칙 기반
    `korean-grammar.js`를 쓰세요. → [DECISIONS #79](docs/DECISIONS.md)

47. **카드 텍스트에 엔진 키를 그대로 쓰지 마세요.** `st.type`을 찍어서 카드에
    "freeze"가 나왔습니다. `STATUS_EFFECTS[type].name`처럼 한국어 이름을 쓰세요.
    → [DECISIONS #79](docs/DECISIONS.md)

48. **도발은 `readTaunt()`로만 판정하세요.** `taunt`가 카드 최상위와 `skill` 양쪽에
    존재합니다. 한쪽만 읽으면 조용히 무효가 됩니다 — 실제로 플레이어는 도발을
    **가질 수 없는** 상태였습니다. → [DECISIONS #80](docs/DECISIONS.md)

49. **전투 규칙은 UI가 아니라 해결 지점에서 강제하세요.** 도발 검사가
    `attackWithMinion`(목록 생성)에만 있어서 `resolveMinionAttack`은 주는 대로
    실행했고, PvP에서 도발을 넘어 때릴 수 있었습니다.
    → [DECISIONS #80](docs/DECISIONS.md)

50. **본체 공격 가능 여부는 `canAttackFace()`로만 판정하세요.** 전장에 소환수가
    있으면 본체를 칠 수 없습니다(유희왕식). 양 진영의 **해결 지점**에서 강제해야
    합니다 — UI 목록에만 두면 PvP 재생 경로가 뚫립니다.
    → [DECISIONS #81](docs/DECISIONS.md)

51. **연계 발동조건에서 `game.playerHp` 같은 필드를 직접 읽지 마세요.**
    `selfView(ctx)` / `foeView(ctx)`를 쓰세요. 직접 읽으면 보스 경로와 PvP 거울
    경로에서 조용히 **틀린 진영**을 봅니다. → [DECISIONS #83](docs/DECISIONS.md)

52. **대상 키를 만들면 그 키를 가진 DOM도 만드세요.** `collectTargetKeys`가
    `ally:N`/`self-face`를 돌려주는데 누를 곳이 없어서, 아군 대상 카드는
    **Esc 말고는 빠져나올 수 없었습니다.** → [DECISIONS #83](docs/DECISIONS.md)

53. **`makeMirroredGame`은 필드를 전부 뒤집으세요.** 일부만 뒤집으면 나머지는
    `undefined`이고, 그 결과가 조용히 번집니다 (`turnCount` 누락 → **NaN 피해**).
    → [DECISIONS #83](docs/DECISIONS.md)

54. **도발은 소환수를 노릴 때만 검사하세요.** 본체 지정까지 도발로 되돌리면
    `canAttackFace`가 통과시킨 `directAttack`을 바로 다음 줄이 부정합니다.
    → [DECISIONS #83](docs/DECISIONS.md)

55. **`export { x } from '...'`는 지역 바인딩을 만들지 않습니다.** 그 파일 안에서도
    쓰려면 `import`를 따로 하세요. → [DECISIONS #83](docs/DECISIONS.md)

56. **전투 코드를 고쳤으면 하네스를 돌리세요** (359항목, 약 5초):
    ```js
    const A = await import('/_verify/battle-audit.js?v=' + Date.now()); await A.runAll();
    ```
    ⚠️ 전부 초록인 결과는 그 자체로 아무것도 증명하지 않습니다. 새 검사를 쓸 때는
    **수정 전 코드에서 실패하는지** 반드시 확인하세요 (`git stash`).
    → [DECISIONS #83](docs/DECISIONS.md)

57. **도발(taunt)은 게임에서 제거됐습니다.** 되살리지 마세요. 전장에 소환수가
    있으면 본체를 칠 수 없는 규칙이 그 일을 대신합니다. 공격자는 상대 전장의
    소환수 중 **아무나** 고릅니다. → [DECISIONS #84](docs/DECISIONS.md)

58. **효과의 대상은 `resolveEffectTargets()`로만 해석하세요.** 효과마다 따로
    쓰면 갈라집니다 — `targetScope:'all'`이 피해에만 구현돼 있어서 "적 전체
    약화"가 첫 한 기만 약화시켰고, `'random'`은 아예 없었습니다.
    → [DECISIONS #85](docs/DECISIONS.md)

59. **보스 경로에도 같은 효과를 구현하세요.** `resolveBossSpell`이 연타·치명타·
    처형·흡혈·드로우를 무시해서, 같은 카드가 보스 손에서는 3배 약했습니다.
    → [DECISIONS #85](docs/DECISIONS.md)

60. **카드팩 프롬프트에 효과 스키마를 빼먹지 마세요.** 설명문만 요구하면
    LLM은 화려한 문장을 쓰는데 엔진에는 굴린 `damage`만 들어가, **설명문이
    구조적으로 거짓**이 됩니다 (실측: 유저 카드 43장 중 29장).
    → [DECISIONS #85](docs/DECISIONS.md)

61. **설명문 검증은 `sanitize`에도 있어야 합니다.** `card-describe.js`의 검사는
    2단계 LLM 경로에서만 돌고, fastMode·오프라인이면 건너뜁니다.
    `sanitize`는 항상 지나므로 거기가 최후의 관문입니다.
    → [DECISIONS #85](docs/DECISIONS.md)

62. **`sanitizeAndClampCardData`는 `skill`과 `skills[0]`을 함께 갱신합니다.**
    호출부에서 `card.skills = [card.skill]`을 챙기게 두지 마세요 — 언젠가
    빠뜨리고, 엔진은 `skills[0]`을 읽습니다. → [DECISIONS #85](docs/DECISIONS.md)

63. **하네스 검사 사이에 대상 선택 모드를 남기지 마세요.** 켜진 채로 넘어가면
    다음 검사의 `attackWithMinion`이 "취소"로 해석해 즉시 반환합니다 —
    기능이 고장난 것처럼 보입니다. `__test.reset()`이 꺼줍니다.
    → [DECISIONS #85](docs/DECISIONS.md)

64. **보스도 마나를 씁니다** (`foeUsesMana: true`). 카드 선택은 반드시
    `canPlayCard`를 통과한 후보 안에서만 하세요. → [DECISIONS #86](docs/DECISIONS.md)

65. **보스 콤보의 `attack`/`magic` 스텝은 마나 제한을 받지 않습니다.** 보스 공세를
    조정할 때 카드 수만 만지면 효과가 없습니다 — 지배적인 변수는 이 스텝입니다.
    → [DECISIONS #86](docs/DECISIONS.md)

66. **보스 생성기를 추가하면 `saveAndFightBoss`가 유일한 관문입니다.** 카드군
    선택(`readBossTheme`)을 생성기마다 붙이지 마세요 — 실제로 두 경로가
    빠뜨려서 UI 선택이 무시됐습니다. → [DECISIONS #86](docs/DECISIONS.md)

67. **밸런스 두 축은 `config.js`의 `PLAYER_BASE_HP`(100)와 `BOSS_STEP_DAMAGE_MULT`(0.4)입니다.**
    서로 얽혀 있어 한쪽만 바꾸면 반대쪽이 과보정됩니다. 바꾸기 전에 반드시
    실측하세요. → [DECISIONS #87](docs/DECISIONS.md)

68. **피해는 `damageTarget`(body/field/any)으로 값이 갈립니다.** 본체 직격은
    전장 차단을 우회하므로 ×1.5, 기물 전용은 ×0.7입니다. 화면·해결·가격
    **세 곳 모두**에 반영하세요. → [DECISIONS #87](docs/DECISIONS.md)

69. **밸런스를 잴 때 보스 목록을 기준값으로 되돌리세요.** 연성으로 만든 보스가
    `bossesList[0]`에 남으면 다른 보스와 싸운 결과를 비교하게 됩니다.
    → [DECISIONS #87](docs/DECISIONS.md)

70. **하네스 기대값을 숫자로 박지 마세요.** 밸런스 상수에서 유도하세요 —
    안 그러면 튜닝할 때마다 검사가 깨집니다. → [DECISIONS #87](docs/DECISIONS.md)

71. **기능을 만들면 화면에도 보이게 하세요.** 건축물 오라(방어력)와 소환 위치
    지정은 **로직이 맞는데도** 표시가 없어서 "동작 안 한다"는 오해를 샀습니다.
    → [DECISIONS #88](docs/DECISIONS.md)

72. **다중 대상 효과는 대상이 모자랄 때 남은 타수를 본체로 보냅니다.**
    그냥 버리면 카드가 값을 못 합니다 ("적 2체 10 피해"가 10만 들어갔습니다).
    → [DECISIONS #88](docs/DECISIONS.md)

73. **자동 플레이 측정 스크립트는 대상 선택을 처리해야 합니다.** `playCard`는
    대상 지정이 필요하면 카드를 손에 남기고 반환합니다 — 안 고르면 그 카드들이
    통째로 빠져 딜 측정이 낮게 나옵니다. → [DECISIONS #88](docs/DECISIONS.md)

74. **겹친 클릭 영역에는 `stopPropagation`을 넣으세요.** 상대 소환수는 본체 클릭
    영역 안에 있어서, 한 번의 클릭이 소환수와 본체를 **함께** 지정했습니다.
    → [DECISIONS #89](docs/DECISIONS.md)

75. **UI 동작은 `.click()`으로 검증하세요.** `pickTarget()` 같은 API를 직접 부르면
    DOM 이벤트 전파 버그를 통째로 놓칩니다 (실제로 한 번 놓쳤습니다).
    → [DECISIONS #89](docs/DECISIONS.md)

76. **`sanitizeAndClampCardData`는 멱등해야 합니다.** 카드 연성은 기획 때·저장 때
    두 번 돌립니다 — 멱등하지 않으면 유저가 확인한 카드가 저장 시점에 달라집니다.
    새 교정을 추가하면 **예산 정산 뒤에도** 성립하는지 확인하세요.
    → [DECISIONS #89](docs/DECISIONS.md)

77. **정산을 통과한 스킬을 저장 경로에서 다시 조립하지 마세요.** 기본값 위에
    스프레드하면 정산이 지운 효과가 되살아납니다. → [DECISIONS #89](docs/DECISIONS.md)

78. **프롬프트 스키마에 필드를 추가하면 `card-validator.js`의 `IMPLEMENTED_FIELDS`에도
    넣으세요.** 안 넣으면 LLM이 시키는 대로 쓴 필드를 "구현되지 않았다"며 반려하고
    재요청까지 돕니다. → [DECISIONS #90](docs/DECISIONS.md)

79. **설명문 검증 패턴은 낱말이 아니라 동사·부호에 앵커를 거세요.**
    `shield: /방어막|실드/`는 "적 방어막을 관통"·"적 실드를 제거"까지 잡아
    **엔진 자신의 정답 문장을 거짓말로 판정**했습니다.
    고칠 때는 **오탐과 놓침을 함께** 재세요. → [DECISIONS #90](docs/DECISIONS.md)

80. **숫자 뒤 경계는 `(?![\d%])`로 잡으세요.** `(?!\s*%)`는 되추적 때문에
    "30%"에서 "3"으로 물러나 매치됩니다 — 비율이 통째로 깨집니다.
    → [DECISIONS #90](docs/DECISIONS.md)

81. **자연어를 정규식으로 "수리"하지 마세요.** 놓치면 거짓말 카드, 오탐이면 문장
    손상입니다. `describeSkillFromData`로 다시 만들고 산문은 **채택/폐기**만
    하세요 — 최악이 "건조한 문장"입니다. → [DECISIONS #90](docs/DECISIONS.md)

82. **규칙 텍스트는 `describeSkillFromData`가 만듭니다. LLM 산문을 규칙 텍스트로
    쓰지 마세요.** 산문이 규칙 노릇을 하는 순간 검증·수리가 필요해지고, 정규식
    수리는 놓치면 거짓말·오탐이면 문장 손상입니다. 산문은 `flavorText`로.
    → [DECISIONS #91](docs/DECISIONS.md)

83. **`sanitizeAndClampCardData`에 "산문을 살려보는" 분기를 다시 넣지 마세요.**
    지운 수리 더미(% 치환·분수·숫자 동기화·체력 주어·반응형 절·거짓말 관문)가
    통째로 되돌아옵니다. → [DECISIONS #91](docs/DECISIONS.md)

84. **플레이버는 애매하면 버리세요.** 규칙 텍스트가 따로 정확하므로 플레이버를
    버려도 손해가 없습니다 — 이게 이 구조의 핵심입니다.
    → [DECISIONS #91](docs/DECISIONS.md)

85. **같은 값을 정하는 입력을 두 곳에 두지 마세요.** 등급이 `#forge-rarity`와
    `#custom-rarity` 두 칸에 있었고, 확정값을 셀렉트에 **되써서** 값이 원을
    그렸습니다 — 유저는 어느 쪽이 이기는지 알 수 없었습니다. 입력은 하나,
    확정값은 모듈 변수(`currentForgeRarity`), 우선순위는 `forgeRarity()` 한 곳.
    → [DECISIONS #92](docs/DECISIONS.md)

86. **카드군을 골랐을 때 잠그는 것은 `custom-theme-name`뿐입니다.** 키워드는
    기본값만 채우고 열어두세요 — 키워드는 카드군에 종속적이지 않습니다.
    대신 `themeId`를 **코드에서** 주입하고(`applyCustomOverrides`),
    `themeId`가 실재하면 `proposeArchetype`을 **건너뛰세요.** 안 그러면 키워드를
    바꿨을 뿐인데 병합·재명명·`seeds` 오염으로 소속이 끌려갑니다.
    → [DECISIONS #92](docs/DECISIONS.md)

87. **화면이 약속한 자리와 데이터가 넣는 자리가 다르면 화면을 고치세요.** 전장은
    빈칸 없는 배열이라 누를 수 있는 빈 칸은 `length` 자리 **하나**뿐입니다. 배지는
    실효값(`armedAt = min(무장, length)`)에 그리세요 — 배지가 뜬 칸 = 들어가는 칸.
    → [DECISIONS #93](docs/DECISIONS.md)

88. **소환 위치 무장은 소환에만 소모됩니다.** 주문·함정·시전 반려에서 풀지 마세요 —
    반려됐다고 풀면 "지정했는데 뒤로 갔다"는 바로 그 놀람을 만듭니다. 무장은 늘
    화면에 보이므로 숨은 상태가 아닙니다. 단 `initBattle`은 **반드시** 지웁니다.
    → [DECISIONS #93](docs/DECISIONS.md)

89. **전투 단위 상태는 `initBattle`에서 전부 초기화하세요.** `_pendingSummonSlot`·
    `_pendingPicked`·대상 선택 모드가 빠져 있어 지난 전투의 무장이 새 전투로 샜습니다.
    `__test.reset()`과 같은 목록이어야 합니다. → [DECISIONS #93](docs/DECISIONS.md)

90. **겹친 컨트롤은 상위 모드를 먼저 봅니다.** 그립은 카드 왼쪽 10px를 덮고
    `stopPropagation`을 하므로, 대상 선택 중에는 카드와 같게 `pickTarget`을 해야
    합니다. 안 그러면 대상 지정 대신 무장이 됩니다. → [DECISIONS #93](docs/DECISIONS.md)

91. **기획→저장 사이의 값은 DOM 밖에 살려두세요.** `completeForgedCard`가 마나·
    공/방/체를 캡에서 **다시 굴려** 기획 화면의 카드와 저장된 카드가 달랐습니다.
    `currentPlannedStats`(정산값) > 세부사항 지정값 > 추첨 순입니다. 미리보기도 같은
    값을 보입니다. → [DECISIONS #93](docs/DECISIONS.md)

92. **셀렉트를 만들면 읽는 코드도 만드세요. 라벨은 `ai-service.js`의 해상도 표와
    맞추세요.** `#forge-resolution`은 아무 코드도 읽지 않았고(죽은 UI), 라벨은
    `square-normal`을 1024라 적었습니다(실제 640 — 1024는 `square-large`).
    해상도는 팩·연성·설정 모달이 **한 설정값**을 공유합니다. → [DECISIONS #93](docs/DECISIONS.md)

93. **팩 프롬프트에 카드군 재사용 규칙과 창작 규칙을 함께 싣지 마세요.** 둘을 다
    주면 4B 모델은 늘 재사용을 고릅니다 — 실제로 새 카드군이 한 번도 안 나왔습니다.
    `PACK_NEW_ARCHETYPE_CHANCE`로 팩당 **한 슬롯만** 창작 규칙으로 바꿉니다.
    범용 팩·카드군 집중 팩은 제외입니다. → [DECISIONS #93](docs/DECISIONS.md)
