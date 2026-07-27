@echo off
cd /d "%~dp0"
echo.
echo  Copix gpt-oss tuning (from %CD%)
echo  =================================
echo.

where ollama >nul 2>&1
if errorlevel 1 (
  echo ERROR: Ollama not in PATH.
  exit /b 1
)

echo [1/5] Checking gpt-oss in Ollama...
ollama list | findstr /i "gpt-oss" >nul
if errorlevel 1 (
  echo Pulling gpt-oss:20b...
  ollama pull gpt-oss:20b
)

echo.
echo [2/5] Installing Python tune dependencies...
if not exist ".venv\Scripts\python.exe" (
  echo Creating venv with py -3.11...
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo ERROR: py -3.11 not found. Install Python 3.11 from python.org
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 exit /b 1

echo.
echo [3/5] Building dataset...
".venv\Scripts\python.exe" scripts\build_dataset.py
if errorlevel 1 exit /b 1

echo.
echo [4/5] Training LoRA (3 epochs)...
".venv\Scripts\python.exe" train_gpt_oss.py --epochs 3
if errorlevel 1 (
  echo.
  echo Training failed. See errors above.
  exit /b 1
)
if not exist "output\copix-gpt-oss-merged\config.json" (
  echo.
  echo ERROR: Training did not produce output\copix-gpt-oss-merged
  echo RTX 5060 needs PyTorch cu128 — run: powershell -File setup.ps1
  exit /b 1
)

echo.
echo [5/5] Exporting to Ollama as copix-gpt-oss...
".venv\Scripts\python.exe" export_ollama.py
if errorlevel 1 exit /b 1

echo.
echo SUCCESS. Test: ollama run copix-gpt-oss
pause
