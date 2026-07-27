# Run training with the correct Python (venv 3.11+ or py -3.11)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = $null
if (Test-Path ".venv\Scripts\python.exe") {
    $ver = & .\.venv\Scripts\python.exe -c "import sys; print(sys.version_info[:2] >= (3,10))" 2>$null
    if ($ver -eq "True") { $py = ".\.venv\Scripts\python.exe" }
}
if (-not $py) {
    foreach ($v in @("-3.11", "-3.12", "-3.10")) {
        $ok = & py $v -c "import sys; print(1)" 2>$null
        if ($LASTEXITCODE -eq 0) { $py = "py $v"; break }
    }
}
if (-not $py) {
    Write-Host "ERROR: Need Python 3.10+. Run: powershell -File setup.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "Training with $py (GPU QLoRA — 8GB uses Qwen2.5-Coder-3B)..." -ForegroundColor Cyan
if ($py -like "py *") {
    $parts = $py -split ' '
    & $parts[0] $parts[1] train_gpt_oss.py @args
} else {
    & $py train_gpt_oss.py @args
}
exit $LASTEXITCODE
