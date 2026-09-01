# Novel Duelist

로컬 LLM이 카드를 기획하고 NovelAI가 일러스트를 그리는 **AI 덱빌딩 카드 게임**.
유희왕식 카드군 연계를 지향합니다 — 오토체스식 종족 스탯 버프는 쓰지 않습니다.

빌드 스텝이 없습니다. 바닐라 ES 모듈 + Tailwind CDN으로 돌아갑니다.

---

## 무엇이 되는가

| 기능 | 설명 |
|---|---|
| 🎴 AI 카드 생성 | 컨셉을 주면 LLM이 이름·효과·카드군을 기획하고 NovelAI가 일러스트를 그립니다 |
| ⚜️ 카드군(아키타입) | LLM이 만든 카드군이 누적됩니다. 표기가 달라도 의미가 같으면 하나로 병합합니다 |
| ⚖️ 효과 기반 파워 예산 | 스탯만이 아니라 **효과와 대상 범위**로 카드 성능을 평가해 등급·마나를 강제합니다 |
| 🪤 함정 | 상대 행동에 반응하는 조건부 카드 |
| 🎯 대상 지정 | 공격 대상·소환 위치·효과 대상을 직접 고릅니다 |
| 👹 PvE 보스전 | 보스는 마나 없이 스크립트 패턴으로 싸웁니다 |
| 🌐 1대1 온라인 대전 | WebRTC P2P. 방 코드만 주고받으면 됩니다 |
| 🎁 부스터 팩 | 속성 팩 4종 + 카드군 지정 팩 |

---

## 실행

```bash
./run_game.ps1
```

실행 정책에 막히면 `run_game.bat`을 쓰세요. 기능은 같습니다.

> ⚠️ `file://`로 열면 CORS 때문에 동작하지 않습니다. 반드시 HTTP로 서빙하세요.
> `python -m http.server`도 안 됩니다 — PvP 시그널링 엔드포인트가 없어
> 온라인 대전이 조용히 실패합니다. 반드시 `server.py`를 쓰세요.

Python을 못 찾으면 경로를 직접 지정할 수 있습니다:

```bash
set NOVEL_DUELIST_PYTHON=C:\path\to\python.exe
```

---

## 필요한 것

| | 필수 | 용도 | 없으면 |
|---|---|---|---|
| Python 3 | ✅ | 정적 서빙 + PvP 시그널링 중계 | 실행 불가 |
| [Ollama](https://ollama.com) | ❌ | 카드 기획 LLM | 규칙 기반 폴백으로 동작 |
| NovelAI API 키 | ❌ | 일러스트 생성 | 대체 아트로 동작 |

### 권장 모델

```bash
ollama pull hf.co/bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M   # 카드 기획
ollama pull bge-m3                                        # 카드군 의미 유사도
ollama pull hf.co/QuantFactory/TIPO-500M-GGUF             # 그림체 다양성 (태그 확장)
```

셋 다 **선택**입니다. 없으면 각각 문자열 유사도 / 규칙 기반 태그로 폴백합니다.

> API 키는 **브라우저 localStorage에만** 저장됩니다. 서버로 전송되지 않고
> 저장소에도 들어가지 않습니다.

---

## 온라인 대전

1. `온라인 대전` 탭 → **방 만들기** → 6자리 코드가 나옵니다
2. 상대가 그 코드로 **참가**
3. 덱을 교환하고 시드를 맞춘 뒤 대전이 시작됩니다

- 카드군을 서로 공유하지 않아도 연계가 작동합니다 (덱과 함께 정의를 실어 보냅니다)
- 상대 덱은 받는 쪽에서 **파워 예산 검증**을 다시 거칩니다 — 조작된 카드는 깎입니다
- ⚠️ 락스텝 동기화라 **중간 합류·재접속이 불가능**합니다. 끊기면 방을 새로 만드세요

---

## 문서

기여하거나 코드를 고치기 전에 읽어 주세요.

| 문서 | 내용 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **먼저 읽을 것.** 금지사항과 진입점 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 구조와 모듈 경계 |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | 기능 추가 규칙 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 왜 이렇게 만들었는가 (65개 기록) |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | 안 될 때 |
| [`docs/AI-MODELS.md`](docs/AI-MODELS.md) | LLM·임베딩·태그 SLM |

`_archive/`는 **로드되지 않는 참고용 사본**입니다. 판단 근거로 쓰지 마세요.

---

## 개발

빌드·테스트·린트 명령이 없습니다. 파일 저장 → 브라우저 새로고침이 전부입니다.
검증은 브라우저 콘솔에서 합니다 — 스니펫은 `docs/TROUBLESHOOTING.md` 마지막 절에 있습니다.

수정이 반영되지 않으면 대부분 캐시입니다:

```js
await fetch('/js/파일.js', { cache: 'reload' })
```
