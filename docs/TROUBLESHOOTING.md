# 문제 해결

이미 한 번 겪은 함정들입니다. 같은 데서 시간 쓰지 않도록 기록합니다.

---

## 게임이 아예 안 뜬다

### 흰 화면 + 콘솔에 CORS / 모듈 로드 실패

`index.html`을 `file://`로 직접 열면 ES 모듈이 CORS로 막힙니다.
**반드시 HTTP로 서빙하세요.**

```bash
./run_game.ps1
```

### 수정한 코드가 반영되지 않는다 ⚠️ 가장 흔한 함정

정적 서버가 모듈을 HTTP 캐시에 잡아둡니다. 새로고침해도 **옛 파일**이 로드됩니다.
특히 방금 고친 파일이 다른 모듈에서 `import`되는 경우, 쿼리스트링으로 우회 import를 해도
그 모듈의 정적 `import`는 캐시된 옛 버전을 씁니다.

증상: 분명히 고쳤는데 같은 에러가 계속 납니다. 파일을 직접 열어보면 정상입니다.

해결:

```js
// 콘솔에서 캐시 강제 갱신 후 새로고침
await fetch('/js/battle-engine.js', { cache: 'reload' });
location.reload();
```

또는 개발자 도구 Network 탭에서 **"캐시 사용 안 함"**을 켠 채 작업하세요.

> 콘솔 에러 목록도 새로고침 후 잔여 로그가 남아 보일 수 있습니다. 정말 깨끗한지
> 확인하려면 **새 탭**에서 열어보세요.

### `SyntaxError: Invalid regular expression: missing /`

어떤 모듈의 정규식 리터럴이 깨졌습니다. 어느 파일인지 특정하려면:

```js
for (const m of ['config','audio','storage','data','dom-utils','status-effects',
                 'skill-effects','archetype-combos','archetype-service','card-renderer',
                 'dan-tag-gen','ai-service','keyword-service','deck-builder','card-pack',
                 'card-forge','card-cropper','boss-forge','battle-engine','ui','main']) {
  try { await import(`/js/${m}.js?v=${Date.now()}`); console.log('✅', m); }
  catch (e) { console.log('❌', m, e.message); }
}
```

**주의:** 의존 모듈이 깨져 있으면 그 에러가 상위로 전파돼 여러 개가 ❌로 보입니다.
목록에서 **가장 앞선(의존성이 적은)** ❌부터 고치세요.

**주의 2:** 위 진단은 `?v=` 쿼리로 캐시를 우회하지만 정적 `import`는 우회하지 못합니다.
진단 전에 캐시부터 갱신하세요.

> 셸 heredoc(`<< 'EOF'`)으로 JS를 쓰면 `\\`가 `\` 하나로 붕괴해 정규식이 깨집니다.
> 백슬래시가 들어가는 파일은 heredoc 말고 에디터로 직접 쓰세요.

---

## AI 생성 문제

### 카드가 생성되지 않는다 / 계속 실패한다

1. **Ollama가 떠 있는가** — `http://localhost:11434/api/tags`가 응답해야 합니다.
2. **CORS 허용됐는가** — `OLLAMA_ORIGINS=*` 없이 띄우면 브라우저가 차단합니다.
   `start_ollama.bat`이 이걸 설정합니다.
3. **모델이 실제로 받아져 있는가** — 설정의 모델이 없으면 `ai-service.js`가 설치된
   다른 모델로 **조용히 폴백**합니다. 콘솔의 `[Ollama] 모델 '...'이(가) 다운로드되지 않아`
   경고를 확인하세요.
4. **타임아웃** — 기본 300초(5분)입니다. 심층 추론 모드는 느립니다.

### 비슷한 이름의 카드군이 계속 새로 생긴다

등록 게이트 임계값 문제일 수 있습니다. 먼저 실제 판정을 확인하세요.

```js
const as = await import('/js/archetype-service.js');
as.compareArchetypeIdentity(
  { name:'새 카드군', keyword:'키워드', comboAction:'chainDamage', element:'fire' },
  { name:'기존 카드군', keyword:'키워드', comboAction:'chainDamage', element:'fire' }
);
// null이면 별개로 판정된 것
```

`null`이 나오는데 합쳐야 한다면 `archetype-service.js`의
`ARCHETYPE_SIM_STRONG`(0.82) / `ARCHETYPE_SIM_WEAK`(0.70)을 내리세요.
반대로 서로 다른 카드군이 합쳐지면 올리세요.

이미 쌓인 중복은 병합할 수 있습니다.

```js
await window.mergeDuplicateArchetypes({ dryRun: true });  // 미리보기
await window.mergeDuplicateArchetypes();                  // 실제 병합
await window.restoreArchetypeBackup();                    // 되돌리기
```

### 카드 이름은 카드군 소속인데 덱 서치에 안 걸린다

`belongsToTheme()`은 `themeId` / `themeName` / **이름 속 키워드 포함**으로 판정합니다.
셋 다 실패하면 서치 대상에서 빠집니다. 카드의 `themeId`가 비어 있고 이름에도 키워드가
없는 경우입니다 — `enforceKeywordInName()`이 적용되기 전에 만들어진 카드일 수 있습니다.

### 한국어가 어색하다 / 이름이 장황하다

모델 문제이기도 하지만 **샘플링 파라미터**를 먼저 의심하세요. `ai-service.js`의
`presence_penalty`, `frequency_penalty`, `repeat_penalty`가 동시에 걸려 있으면 한국어
조사·어미처럼 정상적으로 반복되는 토큰이 억제되어 문장이 부자연스러워집니다.

---

## 전투 문제

### 카드가 클릭이 안 된다 / 조작이 안 먹는다

`state.isAnimating`이 `true`로 남아 있을 가능성이 높습니다. 콘솔에서 확인:

```js
window.state.isAnimating   // true면 잠긴 상태
```

`initBattle()`이 리셋하므로 전투를 다시 시작하면 풀립니다.
(과거에는 이 리셋이 없어 보스 턴 중 리셋 시 영구 잠김 버그가 있었습니다)

### 상태이상이 걸렸는데 효과가 없다

`status-effects.js`의 `STATUS_EFFECTS`에 해당 타입이 **선언돼 있는지** 확인하세요.
선언되지 않은 타입은 `applyStatus()`가 조용히 `null`을 반환하고 무시합니다.

```js
const se = await import('/js/status-effects.js');
Object.keys(se.STATUS_EFFECTS);   // 현재 지원 목록
```

### 카드군을 여러 장 깔았는데 공격력이 안 오른다

**정상입니다.** 의도된 동작입니다. 카드군은 스탯을 올리지 않습니다.
자세한 내용은 [`DECISIONS.md` #4](DECISIONS.md)를 보세요.

---

## 저장 문제

### localStorage 용량 초과 경고

정상 동작입니다. 카드 이미지가 base64 data URL이라 5MB를 쉽게 넘깁니다.
IndexedDB로 저장되므로 데이터는 안전합니다.

### 카드가 사라졌다

IndexedDB를 먼저 읽고, 없으면 localStorage로 폴백합니다. 브라우저 사이트 데이터를
지우면 둘 다 날아갑니다. 마도서 화면의 **"덱 JSON 백업"**으로 미리 내보내 두세요.

### 저장 데이터를 완전히 초기화하고 싶다

```js
indexedDB.deleteDatabase('NovelDuelistDB');
localStorage.clear();
location.reload();
```

---

## 진단 스니펫 모음

```js
// 현재 상태 요약
({
  카드: state.cardsCollection.length,
  덱: state.activeDeckCardIds.length,
  카드군: state.archetypesList.length,
  보스: state.bossesList.length,
  전투중: !!state.currentBoss,
  잠김: state.isAnimating
})

// 카드군별 보유 카드 수
state.cardsCollection.reduce((a,c) => {
  const k = c.themeName || '(범용)'; a[k] = (a[k]||0)+1; return a;
}, {})

// themeId가 실제 카드군을 가리키는지 (고아 카드 찾기)
const ids = new Set(state.archetypesList.map(a => a.id));
state.cardsCollection.filter(c => c.themeId && !ids.has(c.themeId))
                     .map(c => `${c.name} -> ${c.themeId}`)
```

---

## 런처 (run_game.ps1 / run_game.bat)

### PvP 방을 만들었는데 상대가 못 들어온다

**`run_game.bat`으로 켜지 않았는지 확인하세요.** 예전 .bat은
`python -m http.server 5173`을 실행했습니다. 정적 파일만 서빙하므로
`/signal/*` 엔드포인트가 없고, **매칭이 조용히 실패합니다.**
(2026-09-01에 수정. 두 런처 모두 `server.py`를 씁니다)

확인:

```bash
curl http://localhost:5173/signal/rooms
```

`{"ok": true, "rooms": []}` 가 나와야 정상입니다. 404면 잘못된 서버입니다.

> ⚠️ `python -m http.server`로 대체하지 마세요. 게임 화면은 멀쩡히 뜨기 때문에
> 문제를 알아채기 어렵습니다.

### run_game.ps1 한글이 깨진다

**UTF-8 BOM이 빠졌습니다.** Windows PowerShell 5.1은 BOM이 없으면 UTF-8 파일을
CP949로 읽습니다. 편집기에서 "UTF-8 (BOM 포함)"으로 저장하거나:

```powershell
$p = ".\run_game.ps1"
$c = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding $true))
```

첫 3바이트가 `EF BB BF`인지로 확인합니다.

> `run_game.bat`은 **일부러 영어만** 씁니다. .bat의 한글은 콘솔 코드페이지
> (CP949 / UTF-8)에 따라 깨져서 신뢰할 수 없습니다. 한글 안내를 원하면 .ps1을 쓰세요.

### "포트 5173을 이미 다른 프로세스가 쓰고 있습니다"

런처 창이 아직 떠 있습니다. 찾아서 닫으세요:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object OwningProcess
```

### 실행 정책에 막혀 .ps1이 안 돌아간다

`run_game.bat`을 쓰세요. 기능은 같고 안내만 영어입니다.
아니면 한 번만 우회해서 실행:

```powershell
powershell -ExecutionPolicy Bypass -File .\run_game.ps1
```
