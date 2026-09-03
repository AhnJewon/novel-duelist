# AI 모델 운용 가이드

이 게임은 **두 개의 AI**를 씁니다. 역할이 완전히 다르므로 분리해서 생각하세요.

| | 담당 | 위치 | 실패 시 |
|---|---|---|---|
| **로컬 LLM** (Ollama) | 카드 기획 — 한국어 이름·효과·카드군 + **영어 핵심 키워드** | `ai-service.js` | 폴백 카드 생성 |
| **태그 확장기** (코드) | 영어 키워드 → Danbooru 태그 세트 | `dan-tag-gen.js` | 한국어 사전 폴백 |
| **NovelAI Diffusion V4.5** | 일러스트 생성 | `ai-service.js` | mock 이미지 |

`dan-tag-gen.js`는 AI가 아니라 **규칙 기반 변환기**입니다. 이름은 DanTagGen에서 빌렸지만
그 모델과는 무관합니다. 정규식 사전 + 속성/타입별 동시등장(co-occurrence) 태그 테이블로
동작하므로 같은 입력에 항상 같은 출력을 냅니다 — 이게 장점입니다.

---

## 시각 프롬프트 파이프라인 (2026-09-01 개편)

**역할 분담이 핵심입니다.**

```
LLM  ──▶  visualSeeds: "crimson swordsman, flaming katana, burning cape"
          영어 핵심 키워드 3~6개. 의미 이해 담당.
              │
              ▼
expandDanbooruTags()  ──▶  masterpiece, best quality, 1boy, solo, sword,
          태그 문법·동시등장·개수         holding sword, flames, embers, ...
          담당. 결정론적.
              │
              ▼
        NovelAI V4.5
```

### 왜 이렇게 나눴나

NovelAI는 **영어 태그**를 먹습니다. LLM은 이미 훌륭한 번역기이므로 한국어 컨셉을
영어 키워드로 옮기는 일은 LLM에게 맡기는 게 정확합니다.

반대로 **LLM에게 완성된 28개 Danbooru 태그를 요구하면 안 됩니다.**
소형 모델은 Danbooru 문법(언더스코어, 품질 태그, 동시등장 관습)에 약하고,
출력이 길어질수록 JSON이 깨집니다. 그 부분은 규칙 기반 확장기가 더 잘합니다.

> **한때 코드가 한국어를 직접 번역하게 만들었다가 되돌린 이력이 있습니다.**
> 한국어 키워드 표로 태그를 뽑으니 카드 효과 설명의 **"피해"**에서
> `피`가 blood로, `해`가 바다로 잡혀 화염 카드에 물 태그가 붙었습니다.
> 한 글자 한국어 키는 흔한 단어에 파묻힙니다. 손으로 만드는 번역 사전은
> 유지보수 비용 대비 정확도가 나오지 않습니다.

### 한국어 사전은 폴백으로만 남아 있다

`extractCoreSeedsFromConcept()`와 `KOREAN_CONCEPT_SEEDS`(44개 항목)는
**LLM이 실패했거나 오프라인일 때**, 그리고 `visualSeeds`가 없는 구버전 카드의
이미지 리롤(`card-cropper.js`)에만 쓰입니다.

폴백 사전을 손볼 때는 `dan-tag-gen.js`의 키 작성 규칙 주석을 반드시 읽으세요.
**한 글자 키 금지**가 핵심입니다.

### SLM으로 확장기를 교체하려면

`expandDanbooruTags()` 자리에 태그 확장 전용 SLM을 끼울 수 있습니다.
입력 계약이 같기 때문입니다 — **성긴 영어 태그 → 풍부한 태그 세트**.

| 모델 | 크기 | 아키텍처 | 학습 데이터 |
|---|---|---|---|
| **Dart v2** (p1atdev) | 166M | Mixtral | Danbooru 태그 7M건 (2005~2024) |
| **DanTagGen** (KBlueLeaf) | 400M | LLaMA (NanoLLaMA) | Danbooru 5.3M |
| **TIPO-500M** (KBlueLeaf) | 500M | LLaMA | Danbooru2023 + GBC10M + CoyoHD11M, 약 300억 토큰 |

- **Dart v2 (166M)** — 가장 가볍습니다. 순수 Danbooru 태그 보완에 특화.
- **TIPO-500M** — DanTagGen의 후속. 자연어 프롬프트까지 다루고 GGUF 배포판이 있어
  Ollama에 얹기 가장 쉽습니다.

> ⚠️ 이름 주의: 이 프로젝트의 `dan-tag-gen.js`는 **DanTagGen 모델이 아닙니다.**
> 이름만 빌린 자체 규칙 기반 변환기입니다. 혼동하지 마세요.

셋 다 **한국어를 못 받습니다.** 태그 → 태그 확장 전용이므로, 앞단에서 LLM이
영어 키워드를 만들어 주는 현재 구조가 그대로 필요합니다. SLM은 확장 단계만 대체합니다.

도입 판단: 지금 규칙 기반 확장기는 속성/타입별 고정 테이블이라 결과가 다소 뻔합니다.
그림 다양성이 아쉬우면 TIPO-500M을 붙일 가치가 있습니다. 다만 Ollama 인스턴스가
하나 더 뜨고 카드당 지연이 늘어나므로, **먼저 LLM 키워드 품질을 확인한 뒤** 판단하세요.

## 샘플링 파라미터 — 한국어 반복 페널티 (2026-09-01 적용 완료)

`ai-service.js`의 **변경 전** 설정입니다.

```js
options: {
  temperature: 0.88 ~ 0.92,
  top_p: 0.92,
  top_k: 50,
  presence_penalty: 0.35,    // ← 문제
  frequency_penalty: 0.35,   // ← 문제
  repeat_penalty: 1.15,      // ← 문제
  repeat_last_n: 128,
  ...
}
```

**반복 억제가 3중으로 걸려 있습니다.** 영어에서는 무난하지만 한국어에서는 해롭습니다.

한국어는 정상적인 문장에서도 토큰이 많이 반복됩니다.

- 조사: 은/는/이/가/을/를/에게/으로
- 어미: ~합니다, ~됩니다, ~시킵니다
- 이 게임의 카드 텍스트 특성상: "피해", "회복", "방어막", "소환", "카드"

이걸 페널티로 억제하면 모델이 **올바른 조사를 피해 이상한 대체어를 고릅니다.**
"카드를 서치한다" 대신 "카드에서 탐색하다" 같은 어색한 문장이 나오는 전형적 원인입니다.

### 적용된 값

```js
presence_penalty: 0,
frequency_penalty: 0,
repeat_penalty: 1.05,     // 1.0~1.08 사이. 1.15는 한국어엔 과하다
temperature: 0.8,         // 0.88~0.92는 4B급에서 JSON을 흔든다
top_p: 0.9,
```

되돌리고 싶다면 `_archive/pre-refactor-snapshot/`이 아니라 이 문서를 기준으로 하세요.
반복 억제를 낮추면 이름이 비슷해질 것 같지만, 다양성은 이미 `seed` 랜덤화와
`nonce`로 확보하고 있습니다. **모델을 바꾸기 전에 이 값부터 조정해 보세요.**
체감 차이가 모델 교체보다 클 가능성이 높습니다.

---

## 모델 선택: Qwen 3.5 4B 유지 (2026-09-01 결론)

Gemma 4 E4B 도입을 검토했고, **현행 Qwen 3.5 4B 유지**로 결론 냈습니다.

### 두 모델 다 실존합니다

| | Gemma 4 E4B | Qwen 3.5 4B |
|---|---|---|
| 출시 | 2026-04-02 (Google, Apache 2.0) | 2026-03-02 (Alibaba) |
| 파라미터 | 4.5B effective / **8B 총** | 4B |
| 컨텍스트 | 256K | 262K (1M 확장 가능) |
| 언어 | 140+ | **201** (한·중·일·아랍어 특화 명시) |
| 4bit VRAM | 약 5 GB | 약 4 GB |

`E2B`/`E4B`의 "E"는 effective parameter를 뜻합니다.

### 벤치마크 — Qwen이 거의 전 항목 우세

| 벤치마크 | Gemma 4 E4B | Qwen 3.5 4B | 차이 |
|---|---:|---:|---|
| MMLU-Pro | 69.4% | **79.1%** | Qwen +9.7 |
| GPQA Diamond | 58.6% | **76.2%** | Qwen +17.6 |
| LiveCodeBench v6 | 52.0% | **55.8%** | Qwen +3.8 |
| **TAU2** (도구 사용/구조화) | 42.2% | **79.9%** | **Qwen +37.7** |
| MMMU-Pro | 52.6% | **66.3%** | Qwen +13.7 |
| MMMLU (다국어) | **76.6%** | 76.1% | Gemma +0.5 |

### 이 프로젝트 기준 판단

1. **한국어** — Qwen 3.5는 한국어 depth를 명시적으로 내세웁니다(201개 언어, 한·중·일·아랍어 특화).
   Gemma가 앞선 건 MMMLU **+0.5**뿐인데 이건 다국어 *추론* 지표이지 한국어 생성 품질이 아닙니다.
   교체할 근거가 되지 못합니다.

2. **JSON 구조화 출력** — TAU2 격차 **37.7점**이 결정적입니다. TAU2는 도구 호출·구조화
   상호작용 벤치마크로, 이 프로젝트가 매 카드마다 요구하는 "스키마 지킨 JSON"과
   가장 가까운 지표입니다. `repairAndParseJson()` 3단계 폴백이 있긴 하지만
   1회 성공률이 높을수록 좋습니다.

3. **메모리** — Gemma가 1GB 더 씁니다(8B 총 파라미터). 로컬 실행 프로젝트에서 손해입니다.

**결론: Gemma 4 E4B로 바꾸면 거의 모든 축에서 손해입니다.** 유일한 우위인 MMMLU +0.5는
오차 범위이고, 그 대가로 구조화 출력 능력이 절반 이하로 떨어집니다.

### 다만 코드는 모델 중립으로 정리했습니다

나중에 다른 모델로 바꿀 때를 대비해 Qwen 전용 하드코딩을 프로파일 테이블로 뺐습니다
(`ai-service.js`의 `MODEL_PROFILES`).

```js
const MODEL_PROFILES = [
  { match: /qwen|qwq/i,           stop: ['<|im_end|>', '<|endoftext|>'], thinking: true  },
  { match: /gemma/i,              stop: ['<end_of_turn>', '<eos>'],      thinking: false },
  { match: /llama|mistral|phi/i,  stop: ['<|eot_id|>', '</s>'],          thinking: false }
];
```

**stop 토큰이 모델마다 다른 것이 핵심입니다.** 예전에는 ChatML 토큰
(`<|im_end|>`)이 하드코딩돼 있어서, Gemma를 쓰면 종료 토큰이 안 걸려 모델이 JSON 뒤에
잡설을 계속 붙였을 겁니다. 이제 계열만 추가하면 됩니다.

`think` 파라미터도 Qwen 3 계열 전용이라 `supportsThinking()`으로 분기합니다.

⚠️ **생각(think)과 JSON(`format`)을 한 호출에 함께 켜지 마세요.** Qwen 3.5는 `think:true` + `format:json`이면
`num_predict` 예산을 전부 thinking에 쓰고 content가 빈 채 `done_reason: length`로 끝납니다 (실측: 예산 400·700 모두 0자).
이 모델은 think 필드를 **생략해도** 생각하므로 JSON 호출엔 `think:false`를 명시합니다. 심층 추론이 필요하면
`callOllamaChat`이 두 단계(자유 서술 기획 → JSON 정형화)로 나눕니다 → DECISIONS #96.

---

---

## 임베딩 모델 (카드군 의미 판정 — 선택)

**설치하면 켜지고, 없으면 문자열 판정으로 자동 폴백합니다.** 게임은 어느 쪽이든 돌아갑니다.

```bash
ollama pull bge-m3
```

설정 모달의 "🧠 임베딩 모델" 항목에서 다른 모델로 바꿀 수 있습니다.

### 무엇을 해결하나

**① 의미가 같은 카드군 통합.** 문자열 유사도는 표기 변형만 잡습니다.
`빙결의 절도`와 `영토 동결령`은 문자 겹침이 거의 없지만 둘 다 물 속성 결빙
카드군입니다. 한국어 동의어를 손으로 사전에 넣는 방식은 이미 실패했습니다(결정 #11).

**② 프롬프트 컨텍스트 절약.** 카드군 전체를 싣던 것을 컨셉과 의미가 가까운
top-6만 싣도록 바꿨습니다.

| 카드군 40개 기준 | 토큰 | num_ctx 8192 대비 |
|---|---:|---:|
| 예전 (전체 주입) | 7,559 | 92% |
| 폴백 (상위 12 + 설명 컷) | 2,262 | 28% |
| **임베딩 검색 (top-6)** | **1,142** | **14%** |

### 모델 선택

| 모델 | 크기 | 차원 | 비고 |
|---|---:|---:|---|
| **`bge-m3`** (기본) | 약 1.2GB | 1024 | Ollama 공식. 100개 언어, 8K 컨텍스트 |
| `dragonkue/BGE-m3-ko` | 568M | 1024 | 한국어 튜닝판. GGUF 변환 필요 |
| `upskyy/bge-m3-korean` | 568M | 1024 | 한국어 튜닝판. GGUF 변환 필요 |
| Kakao `Kanana-Nano-2.1B-Embedding` | 2.1B | — | 경량 한국어 특화 |

Ollama에 바로 올라가는 건 `bge-m3`입니다. 한국어 튜닝판이 필요하면 GGUF 변환 후
Modelfile을 만들어야 합니다.

### 판정 임계값 — bge-m3 실측 보정 (2026-09-01)

⚠️ **처음 잡은 0.88/0.75는 전부 틀렸습니다.** 실측 후 아래로 교정했습니다.

```js
EMBED_SIM_MERGE = 0.72   // 이 이상 + 같은 속성 → 병합
EMBED_SIM_GRAY  = 0.60   // 이 이상 → 회색지대, LLM에게 되묻는다
```

실측 데이터 (같은 속성 안에서 비교):

| 기대 | 쌍 | 유사도 |
|---|---|---:|
| 병합 | 빙결의 절도 / 영토 동결령 | 0.669 |
| 병합 | 서리 마법결사 / 한파의 마도회 | 0.741 |
| 병합 | 절대영도 결사 / 빙하의 군단 | 0.755 |
| 병합 | 홍련의 검사단 / 홍련 검사단 | 0.889 |
| 별개 | 서리 마법결사 / 심해의 수호자 | 0.543 |
| 별개 | 홍련의 검사단 / 용암 대장간 | 0.581 |
| 별개 | 홍련의 검사단 / 불사조 성단 | 0.514 |

분리 마진 **+0.088** (병합 최솟값 0.669 − 별개 최댓값 0.581).

### ⚠️ 속성 하드 게이트가 필수입니다

**속성을 무시하면 임계값으로 분리가 불가능합니다.** 실측:

| 쌍 | 유사도 | 문제 |
|---|---:|---|
| 화염 기사단 / 서리 기사단 | **0.731** | 별개여야 하는데 병합 구간에 들어옴 |
| 빙결의 절도 / 영토 동결령 | 0.669 | 병합해야 하는데 위보다 **낮음** |

bge-m3는 기대했던 심층 의미보다 **표층 구조**에 더 강하게 반응합니다.
`화염 기사단`과 `서리 기사단`은 "X 기사단"으로 구조가 같아서 가깝게 잡히고,
`빙결의 절도`와 `영토 동결령`은 의미가 같아도 문장 구조가 달라 멀게 잡힙니다.

임베딩 입력에서 속성·연계를 빼봐도 오히려 나빠졌습니다(마진 −0.062 → −0.166).

**그래서 `compareArchetypeSemantics()`는 속성이 다르면 유사도를 계산하지 않고
바로 `distinct`를 돌려줍니다.** `findSimilarArchetypes()`의 `element` 옵션도
정체성 판정에서는 반드시 넘겨야 합니다. (프롬프트용 검색에는 넘기지 마세요 —
관련 카드군을 폭넓게 봐야 합니다)

**검증 결과 9/9 통과.** 그중 `빙결의 절도 / 영토 동결령`(0.669)은 회색지대로
분류되어 LLM 피드백 루프가 최종 판단합니다. 자동 오판보다 안전합니다.

### 성능 실측

| 구간 | 소요 |
|---|---:|
| 최초 벡터 생성 (카드군 40개) | 약 3.2초 — 앱 시작 시 1회, IndexedDB에 저장 |
| 캐시 후 의미 검색 | 평균 **76ms** |
| 단일 임베딩 호출 | 약 88ms |

카드 생성 1건당 추가 지연은 쿼리 임베딩 1회분(~88ms)입니다.
LLM 생성이 3~6초인 것에 비하면 무시할 수준입니다.

### 프롬프트 절감 (카드군 40개 기준, 실측)

| | 토큰 | num_ctx 8192 대비 |
|---|---:|---:|
| 예전 (전체 주입) | 5,166 | 63% |
| **의미 검색 top-6** | **900** | **11%** |

절감률 **83%**. 검색 품질도 확인했습니다 — "화염 검사 컨셉"으로 조회하니
화염 검사단 4세대를 전부 상위로 올렸습니다.

### 벡터 저장 위치

`archetypesList`가 **아니라** 별도 IndexedDB 키
(`novel_duelist_archetype_embeddings`)에 둡니다.
1024차원 × N개를 카드군 레코드에 넣으면 localStorage 백업이 용량을 초과합니다.

병합으로 사라진 카드군의 고아 벡터는 `ensureArchetypeEmbeddings()`가 정리합니다.

### 진단

```js
const emb = await import('/js/embedding-service.js');
await emb.checkEmbeddingAvailable();          // 설치 여부
await emb.findSimilarArchetypes('화염 검사');   // 의미 유사 top-k
await emb.compareArchetypeSemantics(
  { name:'빙결의 절도', keyword:'빙결', element:'water', comboAction:'freeze' },
  { name:'영토 동결령', keyword:'동결', element:'water', comboAction:'freeze' }
);   // → { similarity, verdict:'merge'|'gray'|'distinct' }
```

---

## 모델 교체 체크리스트

- [ ] `ollama pull <태그>` 로 실제 다운로드 완료
- [ ] `ui.js`의 `knownLlms` 배열에 태그 추가
- [ ] `index.html`의 `#setting-llm-model-select`에 `<option>` 추가
- [ ] `storage.js`의 기본 `settings.llmModel` 갱신 (기본값으로 삼을 경우)
- [ ] `ai-service.js`의 `stop` 토큰을 해당 모델 템플릿에 맞게 변경
- [ ] `think` 플래그를 모델별로 분기 (또는 제거)
- [ ] 폴백 탐색 로직(`m.includes('qwen')`)이 새 모델을 배제하지 않는지 확인
- [ ] 카드 5장 연속 생성해서 JSON 실패율 확인
- [ ] 콘솔에 `[Ollama] 모델 ... 자동 연결` 경고가 안 뜨는지 확인
      (뜨면 설정 태그가 실제 설치명과 다른 것)

---

## NovelAI 쪽 참고

`generateNovelAIImage()`는 V4/V4.5 규격을 씁니다. `v4_prompt` 캡션 구조체가 없으면
**500 에러**가 납니다. 모델을 V3로 내리는 경우가 아니면 이 구조를 지우지 마세요.

- `steps`는 28로 상한 고정 — 0 Anlas(무료) 조건입니다. 올리면 과금됩니다.
- 태그의 언더스코어는 NovelAI 규격상 스페이스로 변환됩니다 (`replace(/_/g, ' ')`).
  `dan-tag-gen.js`는 내부적으로 언더스코어를 쓰므로 이 변환을 제거하면 안 됩니다.

---

## 태그 확장 SLM — TIPO 실전 사용법 (2026-09-01 검증 완료)

### 설치

```bash
ollama pull hf.co/QuantFactory/TIPO-500M-GGUF
```

Ollama 공식 라이브러리에 **없다.** `ollama pull tipo`는 실패한다.
HuggingFace GGUF를 `hf.co/` 접두로 받아야 한다. 약 195MB.

경량 대안: `ollama pull hf.co/p1atdev/dart-v2-moe-sft-gguf` (166M)

### 호출 규격 — 셋 다 지켜야 동작한다

```js
{
  model: 'hf.co/QuantFactory/TIPO-500M-GGUF:latest',
  raw: true,                    // ← 필수. 완성 모델이라 채팅 템플릿이 덧씌워지면 깨진다
  prompt:
    'quality: masterpiece\n' +
    'rating: safe\n' +
    // artist: 줄을 넣지 않으면 모델이 작가를 스스로 채운다
    'characters: <|empty|>\n' +
    'copyrights: <|empty|>\n' +
    'aspect ratio: 1.0\n' +
    'target: <|long|>\n' +
    'tag: 1boy, red hair, katana, fire, armor,<|input_end|>'   // ← tag: 와 <|input_end|>
}
```

**하나라도 틀리면 시드를 통째로 무시당한다.** 자세한 실패 사례는
[DECISIONS #44](DECISIONS.md).

### 시드는 반드시 Danbooru 어휘로

TIPO는 Danbooru 어휘로만 사고한다.

| 입력 | 결과 |
|---|---|
| `crimson swordsman, flaming katana` | ❌ 무시. 여우·검은고양이·king of the sands |
| `1boy, red hair, katana, fire, armor` | ✅ japanese armor, kimono, blue fire, holding sword |

`parseNaturalLanguageToDanbooru()`를 먼저 통과시킨다.

### 출력은 반드시 정제한다

원본 출력에는 판권 캐릭터, 모순 태그, 메타 라인, 유해 태그가 섞여 있다.
`cleanSlmTags()`를 거치지 않은 출력을 NovelAI에 직접 넣지 말 것.

### 실측 성능

시드 `crimson swordsman, flaming katana, burning armor`, 3회 실행:

- 총 28태그 중 **18개 공통 / 10개가 매번 다름** → 다양성 확보
- 모순 태그 0, 메타 누출 0, 유해 태그 0
- 지연: 카드당 약 1~3초 (500M 모델)

### 그림체 다양성 설정

설정 모달 → **작가 태그**

| 모드 | 언제 |
|---|---|
| SLM이 선택 (기본) | 카드마다 다른 그림체. TIPO 실패 시 화풍 태그로 폴백 |
| 화풍 태그만 | 가장 안정적. 작가 이름 없이 화풍만 흔든다 |
| 내가 지정 | **덱 전체 통일감**을 원할 때. 2~3명만 넣는다 |
| 사용 안 함 | 모델 기본 그림체 |

TIPO의 작가 출력은 4번 중 1번꼴로만 나오고 깨진 문자열이 섞인다.
통일감이 중요하면 `내가 지정`이 낫다. → [DECISIONS #48](DECISIONS.md)

### NovelAI 가중치 문법 주의

**`{강조}` / `[약화]`** 다. `()`는 Stable Diffusion WebUI 문법이라 NovelAI에선
가중치가 아니다. `flame (weapon)` 같은 Danbooru 동음이의 태그는
**괄호째 그대로** 넣어야 한다. → [DECISIONS #47](DECISIONS.md)
