@echo off
title Ollama AI Server
cd /d "%~dp0"

set "OLLAMA_ORIGINS=*"
set "OLLAMA_HOST=0.0.0.0:11434"

echo ========================================================
echo   Ollama AI Server (Port: 11434)
echo ========================================================
echo.
echo   * Keep this window open while using AI generation.
echo.

if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
    "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
) else (
    ollama serve
)

echo.
echo Ollama server has stopped.
pause
