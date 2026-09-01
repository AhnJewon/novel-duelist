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
| 카드군 초기화 · 병합 · 보수 | `js/archetype-service.js` (콘솔에서 `resetArchetypes()`) |
| 전투 진영 공용 동작 (마나·드로우·슬롯) | `js/combat-side.js` |
| PvE / PvP 모드 차이 | `js/combat-side.js`의 `BATTLE_MODES` |
| 등급·마나·효과 밸런스 | `js/config.js`의 `RARITY_POWER` + `EFFECT_COSTS` |
| 전투 무작위 / 재현 | `js/rng.js` (`initBattle({seed})`) |
| 새 상태이상 추가 | `js/status-effects.js` **한 곳** |
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
