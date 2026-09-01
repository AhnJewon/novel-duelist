# _archive — 참고용 보관 자료

여기 있는 파일은 **런타임에 전혀 로드되지 않습니다.** `index.html`은 `js/main.js` 하나만
읽고, 그 모듈 그래프에 `_archive/`는 포함되지 않습니다.

수정해도 게임에 아무 영향이 없습니다. 반대로, 여기 코드를 보고 현재 동작을 추측하면
틀립니다. **항상 `js/`를 기준으로 판단하세요.**

---

## typescript-prototype/

초기 TypeScript 프로토타입(851줄). `js/`의 자바스크립트 구현으로 대체되면서 참조가
끊겼지만 파일만 남아 있던 것을 옮겨 왔습니다.

| 파일 | 현재 대응 구현 |
|---|---|
| `types/game.ts` | (대응 없음 — 현재는 타입 정의를 쓰지 않음) |
| `services/storage.ts` | `js/storage.js` |
| `services/novelai.ts` | `js/ai-service.js`의 `generateNovelAIImage()` |
| `services/audio.ts` | `js/audio.js` |
| `data/enemies.ts` | `js/data.js`의 `BOSS_DATA` |
| `data/starterCards.ts` | `js/data.js`의 `DEFAULT_STARTER_CARDS` |

**주의:** 같은 이름의 구현이 `js/`에 따로 있으므로 검색 시 혼동하기 쉽습니다.
`grep`으로 코드를 찾을 때는 `js/` 하위로 범위를 제한하는 편이 안전합니다.

타입 안정성이 필요해지면 이 프로토타입을 되살리기보다 `js/`에 JSDoc 타입 주석을
붙이는 쪽을 권합니다. 현재 코드베이스는 빌드 스텝이 없는 순수 ES 모듈이고, 그 단순함이
장점입니다(파일 저장 → 새로고침이면 끝).

---

## pre-refactor-snapshot/

2026-09-01 대규모 리팩터링 **직전** 상태의 스냅샷입니다. 리팩터링으로 회귀가 의심될 때
"원래는 어떻게 동작했는가"를 대조하는 용도입니다.

| 파일 | 시점 |
|---|---|
| `archetype-service.original.js` | 카드군 동일성 게이트 작업 **이전** (가장 오래된 원본) |
| `archetype-service.js` | 동일성 게이트 적용 후 / 콤보 테이블 분리 **이전** |
| `battle-engine.js` | 상태이상·중복 제거 리팩터링 **이전** |
| `card-forge.js`, `card-pack.js` | 프롬프트에 카드군 재사용 규칙 넣기 **이전** |
| `deck-builder.js` | `window.event` 제거 **이전** |
| `main.js` | 병합 마이그레이션 연결 **이전** |
| `index.html` | 필터 버튼 id 부여 / 상태이상 컨테이너 추가 **이전** |

무엇이 왜 바뀌었는지는 [`docs/DECISIONS.md`](../docs/DECISIONS.md)에 정리돼 있습니다.
스냅샷을 그대로 되돌리면 이미 고친 버그가 같이 되살아나니, 되돌릴 때는 해당 결정 항목을
먼저 읽어보세요.
