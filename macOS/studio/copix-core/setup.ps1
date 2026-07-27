# Copix Core — install tuning deps into .venv (Python 3.10–3.12)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Find-PythonLauncher {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($minor in @(12, 11, 10)) {
            $code = "import sys; v=sys.version_info; ok=(v.major,v.minor)>=(3,10) and (v.major,v.minor)<=(3,12) and sys.maxsize>2**32; raise SystemExit(0 if ok else 1)"
            & py "-$minor" -c $code 2>$null
            if ($LASTEXITCODE -eq 0) { return @{ Exe = "py"; Args = @("-$minor") } }
        }
    }
    $code = "import sys; v=sys.version_info; ok=(v.major,v.minor)>=(3,10) and (v.major,v.minor)<=(3,12) and sys.maxsize>2**32; raise SystemExit(0 if ok else 1)"
    & python -c $code 2>$null
    if ($LASTEXITCODE -eq 0) { return @{ Exe = "python"; Args = @() } }
    return $null
}

Write-Host ""
Write-Host "Copix Core — install tuning dependencies" -ForegroundColor Cyan
Write-Host ""

$pip = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $pip)) {
    $py = Find-PythonLauncher
    if (-not $py) {
        Write-Host "ERROR: Need Python 3.10–3.12 (64-bit). Install from python.org" -ForegroundColor Red
        Write-Host "Then: py -3.11 -m venv .venv" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Creating .venv with $($py.Exe) $($py.Args -join ' ')..." -ForegroundColor Green
    & $py.Exe @($py.Args + @("-m", "venv", ".venv"))
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$ver = & $pip -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
Write-Host "Using venv Python $ver" -ForegroundColor Green

& $pip -m pip install --upgrade pip wheel setuptools

# RTX 50-series (sm_120) needs CUDA 12.8+ PyTorch — cu124 crashes
Write-Host ""
Write-Host "Installing PyTorch CUDA 12.8 (required for RTX 5060 / sm_120)..." -ForegroundColor Cyan
& $pip -m pip uninstall -y torch torchvision torchaudio 2>$null
& $pip -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) {
    Write-Host "cu128 stable failed, trying nightly cu128..." -ForegroundColor Yellow
    & $pip -m pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "cu128 failed, falling back to cu124 (RTX 50xx may not work)..." -ForegroundColor Yellow
    & $pip -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
}

Write-Host ""
Write-Host "Installing transformers, peft, datasets..." -ForegroundColor Cyan
& $pip -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
& $pip -c @"
import torch
print('torch', torch.__version__, 'cuda=', torch.cuda.is_available())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
    print('capability:', torch.cuda.get_device_capability(0))
    cap = torch.cuda.get_device_capability(0)
    if cap[0] >= 12:
        x = torch.zeros(1, device='cuda')
        print('GPU tensor test: OK')
"@

Write-Host ""
Write-Host "Done. Run: .venv\Scripts\python.exe train_gpt_oss.py --epochs 3" -ForegroundColor Green
Write-Host ""
