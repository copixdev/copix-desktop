# Quick diagnostic — run: powershell -File check-env.ps1
Write-Host "=== Copix Core environment check ===" -ForegroundColor Cyan

foreach ($label in @("python", "py -3.12", "py -3.11", "py -3.10")) {
    $parts = $label -split ' '
    $exe = $parts[0]
    $args = @()
    if ($parts.Length -gt 1) { $args = $parts[1..($parts.Length-1)] }
    if ($exe -eq "py" -and -not (Get-Command py -EA SilentlyContinue)) { continue }
    if ($exe -eq "python" -and -not (Get-Command python -EA SilentlyContinue)) { continue }
    try {
        $v = & $exe @($args + @("-c", "import sys; print(f'{sys.version} | {sys.maxsize>2**32 and 64 or 32}-bit | path={sys.executable}')"))
        Write-Host "$label : $v"
    } catch {
        Write-Host "$label : not found"
    }
}

if (Test-Path ".venv\Scripts\python.exe") {
    Write-Host ""
    Write-Host "venv:" -ForegroundColor Yellow
    .\.venv\Scripts\python.exe -c "import sys; print(sys.version); import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())" 2>&1
} else {
    Write-Host ""
    Write-Host "No .venv yet — run setup.ps1" -ForegroundColor Yellow
}
