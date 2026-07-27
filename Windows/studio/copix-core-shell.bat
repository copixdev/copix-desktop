@echo off
REM Quick commands from repo root — always lands in copix-core
cd /d "%~dp0copix-core"
echo Copix copix-core: %CD%
echo.
echo Commands:
echo   copix-tune.bat          — full pipeline (dataset + tune + export)
echo   powershell -File setup.ps1
echo   .venv\Scripts\python.exe scripts\build_dataset.py
echo   .venv\Scripts\python.exe train_gpt_oss.py --epochs 3
echo   .venv\Scripts\python.exe export_ollama.py
cmd /k
