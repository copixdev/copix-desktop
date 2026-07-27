<p align="center">
<img width="150" height="150" alt="copix_icon" src="https://github.com/user-attachments/assets/657fd098-2baa-476a-b116-289aa2f97276" />
</p>

<h1 align="center">Copix</h1>
<p align="center">
	<strong>Fast. Essential. Precise.</strong><br/>
	Turn anything you want into real, high-quality code.
</p>

<p align="center">

<img src="https://img.shields.io/badge/License-Proprietary-lightgrey.svg" alt="License: Proprietary">
<img src="https://img.shields.io/badge/Price-Free-brightgreen.svg" alt="Free">
<img src="https://github.com/EJH-BAE/Copix/actions/workflows/dependabot/dependabot-updates/badge.svg" alt="dependabot-updates">
</p>

<img width="2559" height="1599" alt="image" src="https://github.com/user-attachments/assets/65814236-00f3-4e22-8d7d-c1fbd4a4c60e" />

---

### Fast. Essential. Precise.

**Use AI agents to program, rather than studying millions of programming languages.** <br/>
Copix is a full tool-based AI agent, creating millions of files and programs right on your system-and also fixing your little errors.


Copix helps you with some things..

- **Programming** : Fast and precise programming with OpenAI-trained Ollama models
- **Error Handling** : Analyzing the error and fixing the exact code block
- **Chat** : Copilot-style interface that understands and reads your current folder / file
- **And more** : Github commit, environment setup, etc.


## Copix's accessibilities

| Functions | How it helps |
| :-: | :-- |
| Code editing | Edits your own code |
| Error handling | Runs its own terminal and handles errors |
| Explanation | Explains repos and directories |
| Model setting | Ollama local models (default `qwen2.5:3b`) |


## How it works

```mermaid
flowchart LR
	A[User] --> B[Chat]
	B --> C[Ollama - LLM]
	C --> D[Copix - Logical review]
	D --> E[Copix & Ollama - Tools / Planning]
	E --> F[Copix - Task Handling]
	F --> G[Copix - Task review]
```
#### Assistance Steps
1. The **user** types in the prompt to code anything.
2. Copix sends the prompt to **Ollama** to handle planning and response.
3. **Ollama** and **Copix** reviews the plan to code.
4. **Copix** streams the live **Ollama** response to handle tasks.
5. **Ollama** reviews the entire workflow one more time.
6. The **user** gets high-quality and efficient code.


## First Launch

### 1. Pull the default model
```bash
ollama pull qwen2.5:3b
```
Install [Ollama](https://ollama.com), and leave it running (`ollama serve` or a minimized window), then open Copix.

### 2. First session in Copix
- Open Copix — there is no settings menu; edit `%USERPROFILE%\Copix\settings.json` to configure model, theme, and workspace
- Test if Ollama sync works properly using one of the example prompts.

## Settings file

Copix stores all preferences locally (no accounts):

**Path:** `C:\Users\<you>\Copix\settings.json` (same as `%USERPROFILE%\Copix\settings.json`)

The folder and file are created the first time you change Settings. Changing models, theme, workspace home, or agent mode updates this file; quitting and reopening Copix reloads it.

```json
{
  "model": {
    "modelId": "qwen2.5:3b",
    "lowVram": false
  },
  "layout": { "sidebarWidth": 220, "editorWidth": 420 },
  "workspace": { "homeDirectory": "C:\\Programming" },
  "theme": "system",
  "agentMode": "code"
}
```

| Key | Meaning |
| :-- | :-- |
| `model.modelId` | Ollama model tag (default `qwen2.5:3b`) |
| `model.lowVram` | Smaller context for low-VRAM GPUs |
| `workspace.homeDirectory` | Where `create_project` puts new repos |
| `theme` | `system` \| `dark` \| `light` |
| `agentMode` | Default mode for new chats |
| `layout` | Sidebar / editor panel sizes |

Use the in-app chat; edit **~/Copix/settings.json** to change model, theme, workspace, or agent mode, then restart Copix.

## Build

**Requirements** : Node.js (`npm`)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1    #dependencies + app
```

Output: `studio\release\Copix-Setup-<version>-x64.exe`
Running : `Copix.exe`

## Download

Download the latest installer from [Releases](https://github.com/EJH-BAE/Copix/releases).
Run the downloaded installer (.exe) to install Copix as an app.

## Run

Run the Copix app, or manually run it from the installed directory.

## Recommended settings

Values below map to keys in `settings.json`.

### Models

| Setting | `settings.json` | Recommended |
| :-- | :-- | :-- |
| Model | `model.modelId` | `qwen2.5:3b` (Ollama) |
| Low VRAM Mode | `model.lowVram` | `false` (use `true` on low-VRAM PCs) |

### Workspace & Agents

| Setting | `settings.json` | Recommended |
| :-- | :-- | :-- |
| Home Directory | `workspace.homeDirectory` | `C:\Programming\` (or any folder you want) |
| Default Agent Mode | `agentMode` | `code` |



## License & Copyright

Copix is **free to use** and **not open source**. GitHub is used for development and deployment only — see [LICENSE.txt](LICENSE.txt).

Portions may include third-party components (for example Code-OSS) under their own licenses.


## Links
- [Ollama](https://ollama.com)
- [Microsoft](https://microsoft.com)
- [Microsoft Github](https://github.com/Microsoft)
