# Copix releases

Installers for **Copix Desktop** (macOS + Windows). Copix is open source under the MIT License.

| File | Platform | Notes |
| --- | --- | --- |
| [`Copix-4.3.0-macOS-arm64.dmg`](./Copix-4.3.0-macOS-arm64.dmg) | macOS Apple Silicon | **Current** Desktop |
| [`Copix-4.3.0-Windows-x64.exe`](./Copix-4.3.0-Windows-x64.exe) | Windows x64 | **Current** Desktop |
| [`Copix-4.2.0-macOS-arm64.dmg`](./Copix-4.2.0-macOS-arm64.dmg) | macOS Apple Silicon | Prior |
| [`Copix-4.1.0-Windows-x64.exe`](./Copix-4.1.0-Windows-x64.exe) | Windows x64 | Prior |
| [`Copix-Setup-4.0.0-x64.exe`](./Copix-Setup-4.0.0-x64.exe) | Windows x64 | Prior |

Checksums: [`SHA256SUMS.txt`](./SHA256SUMS.txt)

Also published as GitHub Release **[v4.3.0](https://github.com/copixdev/copix-desktop/releases/tag/v4.3.0)**.

## macOS: “Copix is damaged and can’t be opened”

That message is **Gatekeeper quarantine** (common after Chrome downloads), not a broken DMG. The SHA-256 of the release matches the published checksum.

1. Open the DMG and drag **Copix** into **Applications**.
2. In Terminal, clear quarantine and open:

```bash
xattr -cr /Applications/Copix.app
open /Applications/Copix.app
```

Or one shot after install:

```bash
curl -fsSL https://raw.githubusercontent.com/copixdev/copix-desktop/main/release/fix-macos-quarantine.sh | bash
```

Alternative: Finder → Applications → **Control-click** Copix → **Open** → **Open**.

## CLI (separate one-liner install)

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/copixdev/copix-desktop/refs/heads/main/cli/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/copixdev/copix-desktop/refs/heads/main/cli/install.ps1 | iex
```

Then: `ollama pull qwen2.5:3b` → `copix doctor` → `copix`
