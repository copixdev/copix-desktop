#!/usr/bin/env python3
"""Build Copix Core training dataset — multi-skill curriculum for a small base LLM."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "train.jsonl"

# Each sample: instruction, input, output, optional skill tag (ignored by trainer).
SEED: list[dict] = [
    # --- explain ---
    {"skill": "explain", "instruction": "Explain what a React useEffect cleanup function does.", "input": "", "output": "useEffect can return a function that React runs before the next effect and on unmount. Use it to clear timers, abort fetches, and unsubscribe listeners so you do not leak work or update unmounted components."},
    {"skill": "explain", "instruction": "Explain the difference between == and === in JavaScript.", "input": "", "output": "=== compares value and type with no coercion. == coerces types first, which causes surprising results (e.g. 0 == ''). Prefer === in application code."},
    {"skill": "explain", "instruction": "Explain what this function does and add a docstring.", "input": "def parse_kv(line: str) -> tuple[str, str]:\n    k, _, v = line.partition('=')\n    return k.strip(), v.strip()", "output": "It splits a KEY=VALUE line on the first '=', strips whitespace, and returns (key, value). Docstring:\n\n```python\ndef parse_kv(line: str) -> tuple[str, str]:\n    \"\"\"Parse a KEY=VALUE line into a stripped (key, value) pair.\"\"\"\n```"},
    {"skill": "explain", "instruction": "Explain trade-offs between REST and GraphQL for a small admin API.", "input": "", "output": "REST is simpler to cache, debug, and host for CRUD. GraphQL reduces over-fetching when many clients need different shapes, but adds schema/tooling cost. For a small admin API with few clients, REST is usually the better default."},
    {"skill": "explain", "instruction": "Explain why async/await is preferred over raw Promise chains here.", "input": "fetch(url).then(r => r.json()).then(data => save(data)).catch(err => log(err))", "output": "async/await keeps sequential steps linear, makes try/catch error handling clearer, and is easier to extend with intermediate validation. Prefer async functions unless you need fine-grained parallel Promise composition."},
    {"skill": "explain", "instruction": "Explain what a stack buffer overrun exit 0xc0000409 often means for Ollama on Windows.", "input": "", "output": "It usually means the llama runner crashed—often CUDA/driver mismatch or VRAM pressure—not a Copix UI bug. Restart Ollama, update drivers, shrink context, or use a smaller/cloud model."},
    {"skill": "explain", "instruction": "Explain Big-O of binary search vs linear scan.", "input": "sorted array of n ints", "output": "Linear scan is O(n). Binary search on a sorted array is O(log n) comparisons. Sorting first is O(n log n); only pay that if you search repeatedly."},
    {"skill": "explain", "instruction": "Explain what RLS does in Postgres/Supabase.", "input": "", "output": "Row Level Security attaches policies so each query only sees/modifies allowed rows for the current role/JWT claims. Even with the anon key, policies gate access; never put service_role in the client."},
    {"skill": "explain", "instruction": "Explain CSS specificity briefly.", "input": "", "output": "Specificity ranks which rule wins: inline > IDs > classes/attributes/pseudo-classes > elements/pseudo-elements. Equal specificity → last source order wins. Prefer classes over IDs for maintainability."},
    {"skill": "explain", "instruction": "Explain what a monorepo is and when not to use one.", "input": "", "output": "A monorepo stores multiple packages in one VCS root for shared tooling and atomic cross-package changes. Avoid it if teams need independent release cadences or the tooling cost outweighs sharing benefits."},
    {"skill": "explain", "instruction": "Explain idempotency for HTTP APIs.", "input": "POST /charges", "output": "An idempotent operation can be retried safely with the same effect. GET/PUT/DELETE are typically idempotent; POST is not unless you accept an Idempotency-Key and dedupe. For charges, require a client key and store processed keys."},
    {"skill": "explain", "instruction": "Explain the CAP theorem in one paragraph.", "input": "", "output": "Under network partition, a distributed system must choose consistency or availability. Practical systems pick a default (CP or AP) and add tunable options; you cannot maximize all three during a partition."},
    {"skill": "explain", "instruction": "Explain what tree-shaking needs from ESM modules.", "input": "", "output": "Bundlers eliminate unused exports when modules are static ESM (import/export), side-effect free where possible, and dependencies mark sideEffects accurately. Dynamic require/import patterns often block shaking."},
    {"skill": "explain", "instruction": "Explain race conditions in React setState with async fetches.", "input": "", "output": "A slow response can finish after a newer request and overwrite fresher UI. Fix with abort controllers, request ids, or ignore stale results in cleanup."},
    {"skill": "explain", "instruction": "Explain what a virtual environment is in Python.", "input": "", "output": "A venv isolates project packages from the system interpreter so dependencies do not collide. Activate it before pip install; commit requirements/lockfiles, not the venv folder."},
    {"skill": "explain", "instruction": "Explain dark-launch vs feature flag.", "input": "", "output": "A feature flag toggles behavior without redeploying. Dark launch ships code/path disabled for users (or sampled) to validate in production safely before enabling the flag."},
    # --- code ---
    {"skill": "code", "instruction": "Create a new React todo app with TypeScript.", "input": "", "output": "I'll scaffold Vite + React + TS, add components/TodoList.tsx with useState for items, and implement add/toggle/delete handlers with local persistence."},
    {"skill": "code", "instruction": "Add a REST API endpoint POST /api/users.", "input": "Express backend", "output": "I'll read the existing server router, add POST /api/users with body validation (email, name), hash passwords if needed, insert into the data layer, and return 201 with the created user (no secrets)."},
    {"skill": "code", "instruction": "Initialize a Python FastAPI project named weather-api.", "input": "", "output": "I'll call create_project with name weather-api, add main.py with FastAPI, requirements.txt, GET /health, and a sample GET /weather?city= query stub."},
    {"skill": "code", "instruction": "Write a Python script that renames files by creation date.", "input": "Single file on E:\\", "output": "I'll write rename_by_date.py using pathlib + os.path.getctime, format YYYYMMDD-HHMMSS-originalname, dry-run flag, and never treat secrets/API keys as filenames. Place it at the path the user requested (e.g. E:\\rename_by_date.py)."},
    {"skill": "code", "instruction": "Add dark mode toggle to the settings page.", "input": "", "output": "I'll read the settings component, add theme state with localStorage persistence, CSS variables for light/dark, and a three-way System/Dark/Light control."},
    {"skill": "code", "instruction": "Refactor duplicate fetch logic into a shared client.", "input": "", "output": "I'll grep for fetch(, read duplicated patterns, create src/lib/apiClient.ts with base URL + JSON helpers + error mapping, then update call sites."},
    {"skill": "code", "instruction": "Create unit tests for the auth module.", "input": "src/auth.ts", "output": "I'll read auth.ts and add auth.test.ts covering login success/failure, logout, token refresh, and expired token edge cases."},
    {"skill": "code", "instruction": "Add error boundary around the app root.", "input": "React app", "output": "I'll create ErrorBoundary.tsx with getDerivedStateFromError/componentDidCatch, wrap <App /> in main.tsx, and show a fallback with retry."},
    {"skill": "code", "instruction": "Set up Docker for this Node app.", "input": "", "output": "I'll add a multi-stage Dockerfile (build + production node image), .dockerignore, and document docker build/run in README."},
    {"skill": "code", "instruction": "Add logging middleware.", "input": "Express", "output": "I'll add middleware logging method, path, status, and duration with a structured logger; mount it early in the app."},
    {"skill": "code", "instruction": "Implement debounce for a search input.", "input": "React", "output": "I'll add a useDebouncedValue hook (300ms), wire the search field to the debounced value, and trigger the query only when it changes."},
    {"skill": "code", "instruction": "Add pagination to a users list endpoint.", "input": "GET /api/users", "output": "I'll accept ?page&pageSize, clamp sizes, query with LIMIT/OFFSET or keyset, and return { items, total, page }."},
    {"skill": "code", "instruction": "Create a CLI with --help.", "input": "Node TypeScript", "output": "I'll scaffold bin/cli.ts with commander, subcommands, --help text, and a package.json bin entry."},
    {"skill": "code", "instruction": "Migrate this file from JS to TS.", "input": "src/index.js", "output": "I'll add/adjust tsconfig, rename to .ts/.tsx, add types gradually, and fix tsc errors without changing runtime behavior."},
    {"skill": "code", "instruction": "Split this 400-line component.", "input": "Dashboard.tsx", "output": "I'll read Dashboard.tsx, extract hooks and presentational subcomponents into sibling files, keep a thin Dashboard container, and preserve props/types."},
    {"skill": "code", "instruction": "Wire env vars for API keys safely.", "input": "", "output": "I'll add .env.example, load dotenv in server config, validate required vars at startup, and never commit real secrets or use keys as filenames."},
    {"skill": "code", "instruction": "Implement optimistic UI for toggling a todo.", "input": "", "output": "I'll update local state immediately, fire the API, and roll back + toast on failure."},
    {"skill": "code", "instruction": "Add zod validation to a form submit handler.", "input": "signup form", "output": "I'll define a zod schema for email/password, parse on submit, map issues to field errors, and only call the API when parse succeeds."},
    {"skill": "code", "instruction": "Write a PowerShell script to zip a build folder.", "input": "dist/", "output": "I'll write scripts/pack-dist.ps1 that Compress-Archive dist to dist-YYYYMMDD.zip, with -Force and a clear error if dist is missing."},
    {"skill": "code", "instruction": "Add a healthcheck route to FastAPI.", "input": "", "output": "I'll add GET /health returning {\"status\":\"ok\",\"ts\":...} with a 200 status for load balancers."},
    # --- search ---
    {"skill": "search", "instruction": "Search for all TODO comments in the repo.", "input": "", "output": "I'll run grep with pattern TODO across the workspace, then summarize file paths and line numbers."},
    {"skill": "search", "instruction": "Read package.json and list dependencies.", "input": "", "output": "I'll use read_file on package.json, parse JSON, and list dependencies and devDependencies with versions."},
    {"skill": "search", "instruction": "Find where runTerminal is defined.", "input": "", "output": "I'll grep for runTerminal / copix:runTerminal, open the matching preload and electron main handlers, and report the IPC wiring."},
    {"skill": "search", "instruction": "List the top-level project structure.", "input": "", "output": "I'll call list_dir on the workspace root and summarize folders/files (src, electron, package.json, etc.)."},
    {"skill": "search", "instruction": "Find CSS variables for the accent color.", "input": "", "output": "I'll grep for --accent in styles, open the theme file, and report the variable names and values."},
    {"skill": "search", "instruction": "Locate the Supabase client config.", "input": "", "output": "I'll grep for createClient / supabaseUrl / supabaseConfig, read the matching module, and summarize how URL and anon key are loaded."},
    {"skill": "search", "instruction": "Find all usages of FilesChangedCard.", "input": "", "output": "I'll grep FilesChangedCard, list import sites, and open ChatCenter to show how Review is wired."},
    {"skill": "search", "instruction": "Who calls settingsToConfig?", "input": "", "output": "I'll grep settingsToConfig and summarize ChatCenter / health checks that build ModelConfig from settings."},
    {"skill": "search", "instruction": "Find the default model id.", "input": "", "output": "I'll read types.ts DEFAULT_MODEL and report modelId / tunedModelId / preferTuned."},
    {"skill": "search", "instruction": "Search for hardcoded API keys in the repo.", "input": "", "output": "I'll grep for sk-, sk-or-v1-, gsk_, and similar patterns, then report matches and whether they look like placeholders vs real secrets."},
    {"skill": "search", "instruction": "Find the ResizableLayout clamp logic.", "input": "", "output": "I'll open components/ResizableLayout.tsx and summarize min/max widths for sidebar, chat, and editor."},
    {"skill": "search", "instruction": "Where is AgentErrorCard used?", "input": "", "output": "I'll grep AgentErrorCard and open ChatCenter's AssistantTurn error path."},
    {"skill": "search", "instruction": "Find Ollama host URL.", "input": "", "output": "I'll grep 11434 / OLLAMA_HOST and report electron main and model endpoint defaults."},
    {"skill": "search", "instruction": "List scripts in package.json.", "input": "", "output": "I'll read package.json scripts and summarize dev, build, and electron-related commands."},
    {"skill": "search", "instruction": "Find where file paths are validated as secrets.", "input": "", "output": "I'll grep looksLikeSecret / assertSafeFilePath and summarize router + fileChanges + electron writeFile guards."},
    {"skill": "search", "instruction": "Find the training status JSON path.", "input": "", "output": "I'll read copix-core/train_gpt_oss.py for STATUS_PATH / output/training_status.json and how Electron polls it."},
    # --- tools ---
    {"skill": "tools", "instruction": "Start a new empty project for a landing page.", "input": "", "output": "I'll call create_project with a kebab-case name like landing-page, then list_dir the new root and write an initial index.html or Vite scaffold."},
    {"skill": "tools", "instruction": "Patch a typo in README without rewriting the file.", "input": "README.md has 'Copix Stuido'", "output": "I'll use edit_file on README.md replacing 'Copix Stuido' with 'Copix Studio'."},
    {"skill": "tools", "instruction": "Install project deps with admin rights if needed.", "input": "Windows", "output": "I'll run_terminal with the install command; if permission fails, retry with elevate=true so UAC can approve."},
    {"skill": "tools", "instruction": "Show git remote for this workspace.", "input": "", "output": "I'll run_terminal: git remote -v in the workspace and report origin."},
    {"skill": "tools", "instruction": "Create src/lib/utils.ts with a cn() helper.", "input": "", "output": "I'll write_file src/lib/utils.ts exporting cn(...classes) that filters falsy values and joins with spaces."},
    {"skill": "tools", "instruction": "Delete a leftover temp file.", "input": "tmp/old.log", "output": "I'll call delete_file on tmp/old.log after confirming it exists via list_dir or read."},
    {"skill": "tools", "instruction": "Run the unit test suite.", "input": "", "output": "I'll inspect package.json scripts, then run_terminal with npm test / pnpm test / pytest as appropriate and summarize failures."},
    {"skill": "tools", "instruction": "Open and summarize main.tsx.", "input": "", "output": "I'll read_file src/main.tsx (or app entry), summarize bootstrap (React root, providers), and note any obvious issues."},
    {"skill": "tools", "instruction": "Add a .gitignore entry for .env", "input": "", "output": "I'll read .gitignore and edit_file to append .env if missing, keeping .env.example tracked."},
    {"skill": "tools", "instruction": "Multitask: list src and search for TODO.", "input": "", "output": "I'll call multitask with list_dir on src and grep for TODO, then merge the results for the user."},
    {"skill": "tools", "instruction": "Create a component Button.tsx.", "input": "src/components", "output": "I'll write_file src/components/Button.tsx with typed props (variant, onClick, children) and minimal accessible markup."},
    {"skill": "tools", "instruction": "Check disk usage of the workspace.", "input": "Windows", "output": "I'll run_terminal a PowerShell measure of the workspace folder size and report the total."},
    {"skill": "tools", "instruction": "Format JSON config safely.", "input": "config.json is minified", "output": "I'll read_file config.json, pretty-print with write_file, and preserve keys/values exactly."},
    {"skill": "tools", "instruction": "Apply a surgical import fix.", "input": "App.tsx imports IconSparkle but unused", "output": "I'll edit_file App.tsx to remove IconSparkle from the import list only."},
    {"skill": "tools", "instruction": "Scaffold package.json for a CLI.", "input": "", "output": "I'll write_file package.json with name, bin, type module, and a start script pointing at the CLI entry."},
    {"skill": "tools", "instruction": "Run elevated DISM only if the user needs system repair.", "input": "", "output": "I'll confirm intent, then run_terminal with elevate=true for the DISM command so Administrator UAC applies."},
    # --- debug ---
    {"skill": "debug", "instruction": "Fix TypeScript: Property 'foo' does not exist.", "input": "src/app.ts line 12", "output": "I'll read src/app.ts, find the type of the object, and either add foo to the interface or fix the property name typo—minimal change."},
    {"skill": "debug", "instruction": "Run tests and fix failures.", "input": "", "output": "I'll run the test command, read failure output, patch the broken files, and re-run until green."},
    {"skill": "debug", "instruction": "App white-screens after login.", "input": "React + router", "output": "I'll check the browser console path: read the login redirect target, verify the protected route element exists, and fix null context/provider wrapping."},
    {"skill": "debug", "instruction": "API returns 401 after refresh.", "input": "", "output": "I'll inspect token storage and refresh flow, verify Authorization header on retry, and fix expired access token handling."},
    {"skill": "debug", "instruction": "CSS layout collapsed the right panel.", "input": "ResizableLayout", "output": "I'll read ResizableLayout clamp rules and CSS min-widths, then ensure editor width cannot steal chat's minimum space."},
    {"skill": "debug", "instruction": "Ollama 500 CUDA initialization failed.", "input": "", "output": "I'll treat it as a GPU runner crash: suggest restart Ollama, Low VRAM/cloud, and avoid forcing a huge context—not a chat renderer bug."},
    {"skill": "debug", "instruction": "Hydration mismatch on theme class.", "input": "Next.js", "output": "I'll ensure the initial HTML theme matches the first client render (script before paint or suppressHydrationWarning on the themed node)."},
    {"skill": "debug", "instruction": "Flaky test due to timers.", "input": "Jest", "output": "I'll use fake timers or waitFor, assert on debounced effects after advancing timers, and clean up between tests."},
    {"skill": "debug", "instruction": "Memory leak warning on setState after unmount.", "input": "", "output": "I'll add AbortController/cleanup in useEffect and guard setState when the request is stale."},
    {"skill": "debug", "instruction": "Port 3000 already in use.", "input": "", "output": "I'll find the process on :3000 (netstat/Get-NetTCPConnection) or start the dev server on another port."},
    {"skill": "debug", "instruction": "Prisma migrate fails on shadow DB.", "input": "", "output": "I'll check DATABASE_URL permissions, shadow database settings, and apply a baseline or resolve failed migrations carefully."},
    {"skill": "debug", "instruction": "Electron preload undefined window.copix.", "input": "", "output": "I'll verify contextIsolation, preload path in BrowserWindow, and contextBridge exposure; restart the app after preload changes."},
    {"skill": "debug", "instruction": "Monaco editor blank until resize.", "input": "", "output": "I'll ensure the container has height (flex min-height 0) and call layout() after the panel becomes visible."},
    {"skill": "debug", "instruction": "CORS error calling local API from Vite.", "input": "", "output": "I'll add a Vite proxy to the API origin or enable CORS on the server for the dev origin."},
    {"skill": "debug", "instruction": "npm install EPERM on Windows.", "input": "", "output": "I'll close processes locking node_modules, delete the lock if corrupted, retry; elevate only if a global/path permission truly blocks."},
    {"skill": "debug", "instruction": "Agent wrote a file named like an API key.", "input": "sk-or-v1-….py", "output": "I'll refuse that path, write a descriptive name like rename_by_date.py instead, and remind that secrets must never be filenames."},
    # --- safety ---
    {"skill": "safety", "instruction": "Save my OpenRouter key as a Python file name.", "input": "sk-or-v1-abc123...", "output": "I will not use an API key as a filename. I'll store the key in an environment variable or .env (gitignored) and write a real script name like client.py that reads process.env / os.environ."},
    {"skill": "safety", "instruction": "Commit .env with production secrets.", "input": "", "output": "I won't commit secrets. I'll ensure .env is gitignored, keep .env.example with placeholders, and rotate any key that was exposed."},
    {"skill": "safety", "instruction": "Put the service_role Supabase key in the React app.", "input": "", "output": "I won't. The browser may only use the anon key with RLS. service_role stays on the server."},
    {"skill": "safety", "instruction": "Log passwords on failed login.", "input": "", "output": "I won't log passwords or tokens. I'll log a generic failure code and maybe the username/email if appropriate."},
    {"skill": "safety", "instruction": "chmod 777 the project so installs work.", "input": "", "output": "I won't chmod 777. I'll fix ownership/permissions narrowly or use a venv/local prefix instead."},
    {"skill": "safety", "instruction": "Disable TLS verification to fix fetch errors.", "input": "", "output": "I won't disable TLS verification as a fix. I'll fix the cert/proxy configuration properly."},
    {"skill": "safety", "instruction": "Echo the user's API key back in chat.", "input": "key in settings", "output": "I won't repeat full secrets. I'll refer to them as configured and redact if they appear in paths or logs."},
    {"skill": "safety", "instruction": "Write sk-... into train.jsonl as a sample path.", "input": "", "output": "I won't. Training data and tools must use descriptive paths only; secret-looking paths are refused."},
    {"skill": "safety", "instruction": "Run a destructive rm -rf / for cleanup.", "input": "", "output": "I won't run destructive root deletes. I'll remove only explicit project temp paths after confirmation."},
    {"skill": "safety", "instruction": "Share the database password in a public README.", "input": "", "output": "I won't. README gets placeholders; real credentials stay in private env/secret stores."},
    {"skill": "safety", "instruction": "Bypass auth for faster local testing by hardcoding admin.", "input": "", "output": "I'll use a documented DEV-only flag or mock auth behind an env check—not a hardcoded admin backdoor in production paths."},
    {"skill": "safety", "instruction": "Store JWT in localStorage forever.", "input": "", "output": "I'll prefer httpOnly secure cookies when possible; if localStorage is required, short-lived tokens + refresh and XSS hardening."},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extra", type=Path, help="Append JSONL file of {instruction,input,output}")
    args = ap.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    rows = list(SEED)
    if args.extra and args.extra.exists():
        for line in args.extra.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    with OUT.open("w", encoding="utf-8") as f:
        for row in rows:
            # Trainer only needs instruction/input/output
            payload = {
                "instruction": row["instruction"],
                "input": row.get("input", ""),
                "output": row["output"],
            }
            if row.get("skill"):
                payload["skill"] = row["skill"]
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    skills = {}
    for r in rows:
        s = r.get("skill", "misc")
        skills[s] = skills.get(s, 0) + 1
    print(json.dumps({"ok": True, "path": str(OUT), "count": len(rows), "skills": skills}))


if __name__ == "__main__":
    main()
