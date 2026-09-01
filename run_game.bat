@echo off
REM ============================================================
REM  Novel Duelist - launcher (fallback for run_game.ps1)
REM
REM  Use this when PowerShell execution policy blocks the .ps1.
REM  Otherwise prefer run_game.ps1 - it prints Korean correctly.
REM
REM  NOTE: This file is intentionally ASCII-only.
REM        Korean text in a .bat breaks depending on the console
REM        codepage (CP949 vs UTF-8), so we do not risk it here.
REM ============================================================
setlocal
chcp 65001 >nul
title Novel Duelist - Game Server
cd /d "%~dp0"

set "PORT=5173"

echo ========================================================
echo   NOVEL DUELIST - AI Card Battle Game Launcher
echo ========================================================
echo.

REM ---- 1. Locate Python -------------------------------------
REM  Prefer PATH. Hardcoding one user's folder breaks on every other machine.
REM  Override with:  set NOVEL_DUELIST_PYTHON=C:\path\to\python.exe
set "PYTHON_EXE="
if defined NOVEL_DUELIST_PYTHON (
    if exist "%NOVEL_DUELIST_PYTHON%" set "PYTHON_EXE=%NOVEL_DUELIST_PYTHON%"
)
if not defined PYTHON_EXE (
    where python >nul 2>&1 && set "PYTHON_EXE=python"
)
if not defined PYTHON_EXE (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined PYTHON_EXE (
    if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)
if not defined PYTHON_EXE (
    if exist "%USERPROFILE%\miniforge3\python.exe" set "PYTHON_EXE=%USERPROFILE%\miniforge3\python.exe"
)

if not defined PYTHON_EXE (
    echo [ERROR] Python was not found.
    echo         Install Python 3, or set NOVEL_DUELIST_PYTHON to your python.exe
    echo.
    pause
    exit /b 1
)

REM ---- 2. server.py must exist ------------------------------
REM  Do NOT fall back to "python -m http.server" here.
REM  That serves static files only and has no /signal/ endpoints,
REM  which silently breaks PvP matchmaking.
if not exist "%~dp0server.py" (
    echo [ERROR] server.py not found next to this launcher.
    echo         PvP signaling needs it - plain http.server will not do.
    echo.
    pause
    exit /b 1
)

REM ---- 3. Port already taken? ------------------------------
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel% equ 0 (
    echo [ERROR] Port %PORT% is already in use.
    echo         Another launcher is probably still running.
    echo         Close that window, or run:  netstat -ano ^| findstr :%PORT%
    echo.
    pause
    exit /b 1
)

REM ---- 4. Ollama -------------------------------------------
echo [1/3] Checking Ollama AI server ...
netstat -ano | findstr /r /c:":11434 .*LISTENING" >nul
if %errorlevel% neq 0 (
    echo       Not running. Opening start_ollama.bat in a new window ...
    start "Ollama AI Server" "%~dp0start_ollama.bat"
    timeout /t 3 /nobreak >nul
    echo       Ollama window opened.
) else (
    echo       Already listening on port 11434.
)

REM ---- 5. Browser ------------------------------------------
echo [2/3] Opening browser in a moment ...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/index.html"

REM ---- 6. Web + signaling server (foreground) ---------------
echo [3/3] Starting web server ...
echo.
echo ========================================================
echo   Game server is RUNNING
echo   Game      : http://localhost:%PORT%/index.html
echo   Signaling : POST /signal/{join,send,poll,leave}
echo   (Keep this window open while playing. Ctrl+C to stop.)
echo ========================================================
echo.

"%PYTHON_EXE%" "%~dp0server.py" %PORT%

echo.
echo Server stopped.
pause
