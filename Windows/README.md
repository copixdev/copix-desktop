<p align="center">
<img width="150" height="150" alt="copix_icon" src="https://github.com/user-attachments/assets/657fd098-2baa-476a-b116-289aa2f97276" />
</p>

<h1 align="center">Copix</h1>
<p align="center">
	<strong>Fast. Essential. Precise.</strong><br/>
	Turn anything you want into real, high-quality code.
</p>

<p align="center">

<img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
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
| Model setting | Tunes gpt-oss (if needed) / syncs local models |


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
ollama pull gpt-oss:20b   #default 20b model
ollama pull gpt-oss:120b  #120b model - only for more quality (not recommended)
```
Install [Ollama](https://ollama.com), and leave it running (`ollama serve` or a minimized window), then open Copix.

### 2. First session in Copix
- Log in / Sign up (create accounts in Supabase)
- Set up preferences in the settings menu (recommended settings are in **Recommended Preferences**)
- Test if Ollama sync works properly using one of the example prompts.

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

## Recommended Preferences

### Models
---

| Preferences | Recommended | 
| :--: | :-- |
| Model | `gpt-oss:20b` (Ollama or Cloud) |
| Copix Core Preference | `Unabled` |
| Low VRAM Mode | `Unabled` (for low-performance computers, use `Enabled`) |
| Copix Core Train / Setup | `Unabled` |

### Workspace & Agents
---

| Preferences | Recommended | 
| :--: | :-- |
| Home Directory | `C:\Programming\` (or any programming directory you want) |
| Default Agent Mode | `Code` |



## License & Copyright

Copix is a fork of [Code-OSS](https://github.com/microsoft/vscode). <br/>
Copyright for [Code-OSS](https://github.com/microsoft/vscode) remains in [Microsoft](https://github.com/Microsoft). <br/>
AI functions, components, UI, tool system, etc. are all copyright Bae Juhan.

## Links
- [Ollama](https://ollama.com)
- [Microsoft](https://microsoft.com)
- [Microsoft Github](https://github.com/Microsoft)
