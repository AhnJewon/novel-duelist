# ============================================================
#  Novel Duelist - PowerShell 런처
#
#  ⚠️ 이 파일은 반드시 **UTF-8 BOM**으로 저장하세요.
#     Windows PowerShell 5.1은 BOM이 없으면 UTF-8을 CP949로 읽어
#     한글이 전부 깨집니다. (실제로 한 번 깨뜨린 적 있음)
#
#  실행: 우클릭 → "PowerShell에서 실행"  또는  .\run_game.ps1
#        실행 정책에 막히면 run_game.bat을 쓰세요.
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null
$host.UI.RawUI.WindowTitle = "Novel Duelist - Game Server"
Set-Location -Path $PSScriptRoot

$PORT = 5173

function Write-Step($n, $text) { Write-Host "[$n] $text" -ForegroundColor Green }
function Write-Detail($text)   { Write-Host "      $text" -ForegroundColor DarkGray }
function Write-Fail($text) {
    Write-Host ""
    Write-Host "  [오류] $text" -ForegroundColor Red
    Write-Host ""
    Read-Host "  엔터를 누르면 창을 닫습니다"
    exit 1
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "    NOVEL DUELIST - AI 카드 배틀 게임 런처" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Python 탐색 ──────────────────────────────────────────
# PATH를 먼저 본다. 특정 사용자 폴더를 하드코딩하면 남의 PC에서 안 돈다.
# 자동 탐색이 실패하면 NOVEL_DUELIST_PYTHON 환경변수로 직접 지정할 수 있다.
$pythonExe = $null

if ($env:NOVEL_DUELIST_PYTHON -and (Test-Path $env:NOVEL_DUELIST_PYTHON)) {
    $pythonExe = $env:NOVEL_DUELIST_PYTHON
}
if (-not $pythonExe) {
    foreach ($name in @('python', 'python3', 'py')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        # Windows 스토어의 가짜 python 별칭은 걸러낸다 (실행하면 스토어가 열린다)
        if ($cmd -and $cmd.Source -and $cmd.Source -notmatch 'WindowsApps') {
            $pythonExe = $cmd.Source; break
        }
    }
}
if (-not $pythonExe) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:USERPROFILE\miniforge3\python.exe",
        "$env:USERPROFILE\anaconda3\python.exe",
        "$env:USERPROFILE\miniconda3\python.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $pythonExe = $c; break }
    }
}
if (-not $pythonExe) {
    Write-Fail 'Python을 찾지 못했습니다. Python 3을 설치하거나 이 파일 위쪽 후보 경로 목록에 경로를 추가하세요.'
}

# ── 2. server.py 확인 ───────────────────────────────────────
# ⚠️ python -m http.server 로 대체하지 마세요.
#    정적 파일만 서빙해서 /signal/* 이 사라지고 PvP 매칭이 조용히 죽습니다.
$serverPy = Join-Path $PSScriptRoot "server.py"
if (-not (Test-Path $serverPy)) {
    Write-Fail "server.py가 없습니다. PvP 시그널링에 필요하며 http.server로는 대체되지 않습니다."
}

# ── 3. 포트 선점 확인 ───────────────────────────────────────
$busy = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $pids = ($busy.OwningProcess | Select-Object -Unique) -join ', '
    Write-Fail "포트 $PORT 를 이미 다른 프로세스가 쓰고 있습니다 (PID: $pids).`n         런처 창이 아직 떠 있는지 확인하고 닫으세요."
}

# ── 4. Ollama ───────────────────────────────────────────────
Write-Step "1/3" "Ollama AI 서버 상태 점검 중..."
$env:OLLAMA_ORIGINS = "*"
$env:OLLAMA_HOST = "0.0.0.0:11434"
if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) {
    Write-Detail "이미 실행 중입니다. (Port: 11434)"
} else {
    $ollamaBat = Join-Path $PSScriptRoot "start_ollama.bat"
    if (Test-Path $ollamaBat) {
        Start-Process "cmd.exe" -ArgumentList "/k", "`"$ollamaBat`""
        Start-Sleep -Seconds 2
        Write-Detail "Ollama 전용 창을 열었습니다."
    } else {
        Write-Host "      start_ollama.bat이 없어 건너뜁니다. AI 생성 기능이 동작하지 않습니다." -ForegroundColor Yellow
    }
}

# ── 5. 브라우저 ─────────────────────────────────────────────
# Start-Job은 런스페이스를 통째로 띄우고 Ctrl+C 때 고아로 남을 수 있어
# 가벼운 분리 프로세스로 대신한다.
Write-Step "2/3" "브라우저 열기 예약 중..."
Start-Process "cmd.exe" -WindowStyle Hidden -ArgumentList `
    "/c", "timeout /t 2 /nobreak >nul & start http://localhost:$PORT/index.html"

# ── 6. 웹 + 시그널링 서버 (포어그라운드) ────────────────────
Write-Step "3/3" "게임 서버 시작..."
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "    게임 웹 서버 가동 중!" -ForegroundColor Green
Write-Host "   접속 주소 : http://localhost:$PORT/index.html" -ForegroundColor Yellow
Write-Host "   시그널링  : POST /signal/{join,send,poll,leave}" -ForegroundColor DarkCyan
Write-Host "   (게임 중에는 이 창을 닫지 마세요. 종료는 Ctrl+C)" -ForegroundColor Gray
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

& $pythonExe $serverPy $PORT

Write-Host ""
Write-Host "서버가 종료되었습니다." -ForegroundColor DarkGray
