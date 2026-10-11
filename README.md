<p align="center">
<img width="128" height="128" alt="Copix" src="icon.png" />
</p>

<h1 align="center">Copix</h1>

<p align="center">A local coding agent on Ollama. Your files stay on your machine.</p>

<p align="center">
	<a href="#download"><strong>Download</strong></a>
	&nbsp;·&nbsp;
	<a href="https://copixdev.github.io"><strong>Website</strong></a>
	&nbsp;·&nbsp;
	<a href="https://github.com/copixdev/copix-cli"><strong>CLI</strong></a>
</p>

## Download

**Copix Desktop v4.3.0.** Install [Ollama](https://ollama.com) first. The default model is `qwen2.5:3b`.

| Platform | Installer |
| --- | --- |
| macOS (Apple Silicon) | [`Copix-4.3.0-macOS-arm64.dmg`](https://github.com/copixdev/copix-desktop/releases/download/v4.3.0/Copix-4.3.0-macOS-arm64.dmg) |
| Windows (x64) | [`Copix-4.3.0-Windows-x64.exe`](https://github.com/copixdev/copix-desktop/releases/download/v4.3.0/Copix-4.3.0-Windows-x64.exe) |

Checksums: [`release/SHA256SUMS.txt`](release/SHA256SUMS.txt). Release page: [v4.3.0](https://github.com/copixdev/copix-desktop/releases/tag/v4.3.0).

## Desktop

<p align="center">
<img width="820" alt="Copix Desktop" src="assets/desktop.png" />
</p>

<p align="center"><a href="assets/demo.mov"><strong>Watch the demo</strong></a></p>

## Build from source

Requires [Node.js 18+](https://nodejs.org). Both apps package with electron-builder.

macOS, from `macOS/studio`:

```bash
npm install
npm run dist
```

`npm run dist` runs electron-builder and writes the DMG under `macOS/studio/release/`.

Windows, from `Windows/studio`:

```bash
npm install
npm run dist
```

`npm run dist` runs electron-builder and writes the installer under `Windows/studio/release/`.
