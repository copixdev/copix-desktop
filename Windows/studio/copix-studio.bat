@echo off
setlocal
cd /d "%~dp0"

echo.
echo  Copix Studio
echo  ============
echo.

where node >nul 2>&1 || (
	echo [Copix Studio] Node.js is required. Install from https://nodejs.org
	goto :fail
)

if not exist "node_modules\" (
	echo [Copix Studio] First run - installing npm dependencies...
	call npm install || goto :fail
)

node scripts\install-electron.mjs || goto :fail

REM Always rebuild once for test/dev launches so other machines get a fresh bundle.
echo [Copix Studio] Building (fresh test build)...
call npm run build || goto :fail

if /I "%~1"=="--packaged" (
	echo [Copix Studio] Starting packaged Electron app...
	call npm start || goto :fail
) else if /I "%~1"=="--test" (
	echo [Copix Studio] Starting Electron test launch...
	call npx electron . || goto :fail
) else (
	echo [Copix Studio] Starting Vite dev server...
	call npm run studio || goto :fail
)
exit /b 0

:fail
echo.
echo [Copix Studio] Launch failed. See errors above.
pause
exit /b 1
