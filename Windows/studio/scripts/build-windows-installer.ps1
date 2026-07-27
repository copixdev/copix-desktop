# Build official Copix Windows installer (NSIS Setup .exe)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "Copix Windows installer build" -ForegroundColor Cyan
Write-Host "Working directory: $(Get-Location)"

Write-Host "[1/3] Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/3] Building app + packaging NSIS installer..." -ForegroundColor Yellow
npm run dist
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[3/3] Artifacts:" -ForegroundColor Green
Get-ChildItem .\release, .\release\staging -Filter *.exe -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB))
}
Write-Host "Done. Install with the Copix-Setup-*.exe under studio\release\" -ForegroundColor Cyan
