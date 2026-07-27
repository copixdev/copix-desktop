@echo off
REM Launch Copix Studio (React UI in studio/) - not the VS Code fork (scripts\copix.bat).
cd /d "%~dp0studio"
call copix-studio.bat %*
