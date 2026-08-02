import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	COPIX_MODEL_IDS,
	FALLBACK_MODEL_ID,
	missingCopixModels,
	modelIsAvailable,
	normalizeProvider,
	startupPullModels,
} from '../src/models/modelCatalog.js';
import { GROQ_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL } from '../src/models/modelCatalog.js';
import {
	isSensitiveWorkspacePath,
	shouldHideWorkspaceEntry,
} from '../src/utils/workspaceIgnore.js';
import { expandWorkspaceHome } from '../src/utils/workspaceHome.js';
import { DEFAULT_SETTINGS } from '../src/types.js';

// Brand as Copix (not "Electron") in taskbar / Jump Lists / process UI.
const APP_NAME = 'Copix';
const APP_ID = 'com.copix.app';
app.setName(APP_NAME);
if (process.platform === 'win32') {
	app.setAppUserModelId(APP_ID);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAppIcon(): string | undefined {
	const candidates = app.isPackaged
		? [
			path.join(process.resourcesPath, 'icon.png'),
			process.execPath,
		]
		: [
			path.join(__dirname, '..', 'build', 'icon.icns'),
			path.join(__dirname, '..', 'build', 'icon.png'),
			path.join(__dirname, '..', 'build', 'icon.ico'),
		];
	for (const candidate of candidates) {
		if (fsSync.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function loadAppIcon(): Electron.NativeImage | undefined {
	const iconPath = resolveAppIcon();
	if (!iconPath) return undefined;
	const img = nativeImage.createFromPath(iconPath);
	return img.isEmpty() ? undefined : img;
}

let mainWindow: BrowserWindow | undefined;

const OLLAMA_HOST = 'http://127.0.0.1:11434';

/** GUI apps on macOS often miss Homebrew / nvm PATH — restore common tool locations. */
function terminalEnv(): NodeJS.ProcessEnv {
	const home = os.homedir();
	const sep = process.platform === 'win32' ? ';' : ':';
	const extras = process.platform === 'win32'
		? []
		: [
			'/opt/homebrew/bin',
			'/opt/homebrew/sbin',
			'/usr/local/bin',
			'/usr/local/sbin',
			path.join(home, '.local', 'bin'),
			path.join(home, '.nvm', 'current', 'bin'),
			path.join(home, '.fnm', 'current', 'bin'),
			path.join(home, '.volta', 'bin'),
			path.join(home, '.asdf', 'shims'),
		];
	const merged = [...extras, process.env.PATH ?? ''].filter(Boolean).join(sep);
	return { ...process.env, PATH: merged, HOME: home };
}

function readModelSettingsFromDisk(): { provider?: string; apiKey?: string } {
	try {
		const raw = fsSync.readFileSync(settingsPath(), 'utf8');
		const parsed = JSON.parse(raw) as { model?: { provider?: string; apiKey?: string } };
		return parsed.model ?? {};
	} catch {
		return {};
	}
}

const CLOUD_BASE_URLS: Record<string, string> = {
	groq: GROQ_BASE_URL,
	openrouter: OPENROUTER_BASE_URL,
	openai: OPENAI_BASE_URL,
};

async function fetchCloudStatus(provider: string): Promise<{ online: boolean; hasModel: boolean }> {
	const { apiKey } = readModelSettingsFromDisk();
	const key = apiKey?.trim();
	if (!key || /gsk_YOUR_KEY_HERE/i.test(key)) return { online: false, hasModel: false };
	const baseUrl = CLOUD_BASE_URLS[provider] ?? GROQ_BASE_URL;
	try {
		const res = await fetch(`${baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(5000),
		});
		return { online: res.ok, hasModel: res.ok };
	} catch {
		return { online: false, hasModel: false };
	}
}

async function fetchOllamaStatus(): Promise<{
	online: boolean;
	hasModel: boolean;
	models: string[];
	missing: string[];
}> {
	try {
		const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return { online: false, hasModel: false, models: [], missing: [...COPIX_MODEL_IDS] };
		const data = await res.json() as { models?: Array<{ name: string }> };
		const names = (data.models ?? []).map(m => m.name);
		const missing = missingCopixModels(names);
		const hasModel = modelIsAvailable(FALLBACK_MODEL_ID, names);
		return { online: true, hasModel, models: names, missing };
	} catch {
		return { online: false, hasModel: false, models: [], missing: [...COPIX_MODEL_IDS] };
	}
}

async function fetchServerHealth(): Promise<{
	online: boolean;
	hasModel?: boolean;
	models?: string[];
	missing?: string[];
	provider?: string;
}> {
	const modelSettings = readModelSettingsFromDisk();
	const provider = normalizeProvider(modelSettings.provider);

	if (provider !== 'ollama') {
		const g = await fetchCloudStatus(provider);
		return {
			online: g.online,
			hasModel: g.hasModel,
			models: g.online ? [`${provider}-cloud`] : [],
			missing: [],
			provider,
		};
	}

	const s = await fetchOllamaStatus();
	return {
		online: s.online && s.hasModel,
		hasModel: s.hasModel,
		models: s.models,
		missing: s.missing,
		provider: 'ollama',
	};
}

async function ensureCopixModelsInternal(full = false): Promise<{ ok: boolean; message: string; pulled: string[] }> {
	const modelSettings = readModelSettingsFromDisk();
	const diskProvider = normalizeProvider(modelSettings.provider);
	if (diskProvider !== 'ollama') {
		const keyHint = diskProvider === 'groq'
			? 'free key at console.groq.com'
			: diskProvider === 'openrouter'
				? 'key at openrouter.ai/keys'
				: 'key at platform.openai.com/api-keys';
		const g = await fetchCloudStatus(diskProvider);
		if (!g.online) {
			return {
				ok: false,
				message: `Add model.apiKey in ~/Copix/settings.json — ${keyHint}`,
				pulled: [],
			};
		}
		const label = diskProvider === 'groq' ? 'Groq' : diskProvider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
		return { ok: true, message: `${label} cloud ready — no local download needed`, pulled: [] };
	}

	const s = await fetchOllamaStatus();
	if (!s.online) {
		return { ok: false, message: 'Ollama offline — install from ollama.com or set model.provider to groq', pulled: [] };
	}
	const toPull = full ? s.missing : startupPullModels(s.models);
	const pulled: string[] = [];
	for (const model of toPull) {
		const result = await pullModelInternal(model);
		if (result.ok) pulled.push(model);
		else {
			return {
				ok: pulled.length > 0,
				message: pulled.length
					? `Downloaded ${pulled.join(', ')} — failed on ${model}: ${result.message}`
					: result.message,
				pulled,
			};
		}
	}
	if (!pulled.length && s.hasModel) {
		return {
			ok: true,
			message: full ? 'All Copix models ready' : 'Ollama ready (large models download on Check Ollama)',
			pulled: [],
		};
	}
	return {
		ok: true,
		message: pulled.length ? `Downloaded ${pulled.join(', ')}` : 'Ollama ready',
		pulled,
	};
}

async function pullModelInternal(model: string): Promise<{ ok: boolean; message: string }> {
	return new Promise(resolve => {
		const proc = spawn('ollama', ['pull', model], { shell: true });
		let out = '';
		const chunk = (d: Buffer) => {
			const t = d.toString();
			out += t;
			mainWindow?.webContents.send('copix:pullProgress', t);
		};
		proc.stdout?.on('data', chunk);
		proc.stderr?.on('data', chunk);
		proc.on('close', code => resolve({
			ok: code === 0,
			message: code === 0 ? `Downloaded ${model}` : out.slice(-500) || 'ollama pull failed',
		}));
	});
}

/** User-visible Copix directory: ~/Copix (settings.json lives here). */
function copixDir(): string {
	return path.join(app.getPath('home'), 'Copix');
}

function settingsPath(): string {
	return path.join(copixDir(), 'settings.json');
}

/** Legacy Electron userData config (migrated once into ~/Copix/settings.json). */
function legacyConfigPath(): string {
	return path.join(app.getPath('userData'), 'copix-config.json');
}

function ensureCopixDir(): void {
	fsSync.mkdirSync(copixDir(), { recursive: true });
}

function defaultUserProjectsRoot(): string {
	return app.getPath('home');
}

function readWorkspaceHome(): string {
	try {
		const raw = fsSync.readFileSync(settingsPath(), 'utf8');
		const settings = JSON.parse(raw) as { workspace?: { homeDirectory?: string } };
		return expandWorkspaceHome(settings.workspace?.homeDirectory, defaultUserProjectsRoot());
	} catch {
		return path.normalize(defaultUserProjectsRoot());
	}
}

const projectsRoot = () => readWorkspaceHome();

function legacySessionWorkspace(sessionId: string): string {
	return path.join(agentsDir(), sessionId);
}

function sessionWorkspaceRoot(sessionId: string): string {
	const preferred = path.join(projectsRoot(), '.copix', 'sessions', sessionId);
	const legacy = legacySessionWorkspace(sessionId);
	if (fsSync.existsSync(legacy) && !fsSync.existsSync(preferred)) {
		return legacy;
	}
	return preferred;
}

function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 42) || 'project';
}

function agentsDir(): string {
	return path.join(app.getPath('userData'), 'agent-workspaces');
}

async function listTree(dir: string, max = 800): Promise<string[]> {
	const out: string[] = [];
	async function walk(current: string, depth: number): Promise<void> {
		if (out.length >= max || depth > 8) return;
		let entries;
		try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (shouldHideWorkspaceEntry(e.name, e.isDirectory())) continue;
			const full = path.join(current, e.name);
			const rel = path.relative(dir, full).replace(/\\/g, '/');
			if (e.isDirectory()) {
				out.push(rel + '/');
				await walk(full, depth + 1);
			} else {
				out.push(rel);
			}
			if (out.length >= max) break;
		}
	}
	await walk(dir, 0);
	return out.sort();
}

/** Relative paths resolve against workspace; absolute paths work anywhere on the machine. */
function resolvePath(target: string, workspaceRoot?: string): string {
	if (path.isAbsolute(target)) return path.normalize(target);
	if (!workspaceRoot) throw new Error('No workspace — open a folder or start a new chat');
	return path.normalize(path.join(workspaceRoot, target));
}

function needsAdminConfirmation(command: string): boolean {
	const c = command.toLowerCase();
	const patterns = [
		/\bsudo\b/,
		/\brunas\b/,
		/-verb\s+runas/,
		/\bpkexec\b/,
		/\bsu\s+-/,
		/\bchmod\s+777\b/,
		/\bnet\s+user\b/,
		/\bbcdedit\b/,
		/\bdism\s+\//,
		/reg\s+add\s+.*hkey_local_machine/,
		/\btakeown\b/,
		/\bicacls\b.*\/grant\b/,
		/install-windowsfeature/,
		/choco\s+install/,
		/winget\s+install/,
		/brew\s+install/,
		/installer\s+-pkg/,
		/dscl\s+/,
		/launchctl\s+load/,
	];
	return patterns.some(p => p.test(c));
}

async function confirmElevated(command: string): Promise<boolean> {
	const isMac = process.platform === 'darwin';
	const result = await dialog.showMessageBox(mainWindow!, {
		type: 'warning',
		buttons: ['Cancel', 'Allow'],
		defaultId: 0,
		cancelId: 0,
		title: 'Administrator access',
		message: isMac
			? 'Copix wants to run this command with administrator privileges.'
			: 'Copix wants to run this command as Administrator.',
		detail: command,
	});
	return result.response === 1;
}

async function gitInit(dir: string): Promise<void> {
	if (fsSync.existsSync(path.join(dir, '.git'))) return;
	await new Promise<void>(resolve => {
		const proc = spawn('git', ['init'], { cwd: dir, shell: true });
		proc.on('close', code => {
			if (code !== 0) console.warn(`git init skipped in ${dir} (exit ${code})`);
			resolve();
		});
		proc.on('error', () => resolve());
	});
}

async function getGitRemote(workspaceRoot: string): Promise<string | undefined> {
	return new Promise(resolve => {
		const proc = spawn('git', ['remote', 'get-url', 'origin'], { cwd: workspaceRoot, shell: true });
		let out = '';
		proc.stdout.on('data', d => { out += d; });
		proc.on('close', code => resolve(code === 0 ? out.trim() : undefined));
	});
}

async function ensureSessionWorkspace(sessionId: string): Promise<{ root: string; tree: string[] }> {
	const root = sessionWorkspaceRoot(sessionId);
	await fs.mkdir(root, { recursive: true });
	await gitInit(root);
	return { root, tree: await listTree(root) };
}

async function createNamedProject(
	sessionId: string,
	name: string,
	description?: string,
	outputPath?: string,
): Promise<{ root: string; tree: string[] }> {
	const requestedBase = outputPath?.trim();
	let dest: string;
	if (requestedBase) {
		dest = path.isAbsolute(requestedBase)
			? path.normalize(requestedBase)
			: path.join(sessionWorkspaceRoot(sessionId), requestedBase);
	} else {
		const slug = slugify(name);
		dest = path.join(projectsRoot(), slug);
		let n = 1;
		while (fsSync.existsSync(dest)) {
			dest = path.join(projectsRoot(), `${slug}-${n++}`);
		}
	}
	await fs.mkdir(dest, { recursive: true });
	const title = name.trim() || path.basename(dest);
	const readme = `# ${title}\n\n${description?.trim() || 'Created by Copix agent.'}\n`;
	await fs.writeFile(path.join(dest, 'README.md'), readme, 'utf8');
	await gitInit(dest);
	return { root: dest, tree: await listTree(dest) };
}

function attachRendererLogging(win: BrowserWindow): void {
	const wc = win.webContents;

	wc.on('console-message', (_event, level, message, line, sourceId) => {
		const tag = level >= 3 ? 'error' : level === 2 ? 'warn' : 'log';
		const prefix = `[copix:renderer:${tag}]`;
		if (level >= 3) console.error(prefix, message, `(${sourceId}:${line})`);
		else if (level === 2) console.warn(prefix, message, `(${sourceId}:${line})`);
		else console.log(prefix, message);
	});

	wc.on('preload-error', (_event, preloadPath, error) => {
		console.error('[copix] Preload script failed:', preloadPath, error);
	});

	wc.on('render-process-gone', (_event, details) => {
		console.error('[copix] Renderer process gone:', details.reason, details.exitCode);
	});

	wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
		if (code === -3) return; // aborted navigation
		console.error('[copix] Failed to load UI:', { code, description, url, isMainFrame });
	});

	wc.on('did-finish-load', () => {
		console.log('[copix] Renderer finished loading:', wc.getURL());
	});
}

function showLoadingPage(win: BrowserWindow): void {
	const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Copix</title>
<style>body{margin:0;background:#0f0f10;color:#f4f4f5;font:14px/1.5 Segoe UI,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh}
.box{text-align:center}.spin{width:28px;height:28px;border:3px solid #333;border-top-color:#7c6cf0;
border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}.sub{color:#71717a;font-size:12px;margin-top:8px}</style>
</head><body><div class="box"><div class="spin"></div><div>Loading Copix Studio…</div>
<div class="sub">First launch may take a minute while dependencies compile.</div></div></body></html>`;
	void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

type MenuAction =
	| 'new-agent'
	| 'open-folder'
	| 'clone-repo'
	| 'command-palette'
	| 'toggle-editor'
	| 'focus-agent';

function sendMenuAction(action: MenuAction): void {
	const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
	win?.webContents.send('copix:menuAction', action);
}

function installApplicationMenu(): void {
	const isMac = process.platform === 'darwin';

	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac
			? [{
				label: APP_NAME,
				submenu: [
					{ role: 'about' as const },
					{ type: 'separator' as const },
					{ role: 'services' as const },
					{ type: 'separator' as const },
					{ role: 'hide' as const },
					{ role: 'hideOthers' as const },
					{ role: 'unhide' as const },
					{ type: 'separator' as const },
					{ role: 'quit' as const },
				],
			}]
			: []),
		{
			label: 'File',
			submenu: [
				{
					label: 'New Agent',
					accelerator: 'CmdOrCtrl+N',
					click: () => sendMenuAction('new-agent'),
				},
				{
					label: 'Open Folder…',
					accelerator: 'CmdOrCtrl+O',
					click: () => sendMenuAction('open-folder'),
				},
				{
					label: 'Clone Repository…',
					click: () => sendMenuAction('clone-repo'),
				},
				{ type: 'separator' },
				isMac ? { role: 'close' } : { role: 'quit' },
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				...(isMac
					? [
						{ role: 'pasteAndMatchStyle' as const },
						{ role: 'delete' as const },
						{ role: 'selectAll' as const },
					]
					: [
						{ role: 'delete' as const },
						{ type: 'separator' as const },
						{ role: 'selectAll' as const },
					]),
				{ type: 'separator' },
				{
					label: 'Command Palette…',
					accelerator: 'CmdOrCtrl+K',
					click: () => sendMenuAction('command-palette'),
				},
			],
		},
		{
			label: 'View',
			submenu: [
				{
					label: 'Toggle Editor Panel',
					accelerator: 'CmdOrCtrl+B',
					click: () => sendMenuAction('toggle-editor'),
				},
				{
					label: 'Focus Agent Input',
					accelerator: 'CmdOrCtrl+L',
					click: () => sendMenuAction('focus-agent'),
				},
				{ type: 'separator' },
				{ role: 'reload' },
				{ role: 'forceReload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
		{
			label: 'Window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
				...(isMac
					? [
						{ type: 'separator' as const },
						{ role: 'front' as const },
					]
					: [{ role: 'close' as const }]),
			],
		},
		{
			label: 'Help',
			submenu: [
				{
					label: 'Copix on GitHub',
					click: () => { void shell.openExternal('https://github.com/EJH-BAE/Copix'); },
				},
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createAppWindow(mode?: 'editor'): BrowserWindow {
	const preloadPath = path.join(__dirname, 'preload.mjs');
	if (!fsSync.existsSync(preloadPath)) {
		console.error('[copix] Preload script missing:', preloadPath);
	}

	const appIcon = loadAppIcon();
	const isMac = process.platform === 'darwin';
	const win = new BrowserWindow({
		width: 1600,
		height: 940,
		minWidth: 1100,
		minHeight: 700,
		title: 'Copix',
		...(appIcon ? { icon: appIcon } : {}),
		backgroundColor: '#0f0f10',
		titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
		...(isMac
			? { trafficLightPosition: { x: 14, y: 12 } }
			: { titleBarOverlay: { color: '#0f0f10', symbolColor: '#ccc', height: 36 } }),
		show: false,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	if (appIcon && !isMac) {
		win.setIcon(appIcon);
	}
	if (isMac && appIcon && app.dock && !mainWindow) {
		app.dock.setIcon(appIcon);
	}

	attachRendererLogging(win);
	showLoadingPage(win);
	win.once('ready-to-show', () => win.show());

	void loadRenderer(win, mode).catch(err => {
		console.error('[copix] loadRenderer failed:', err);
	});
	return win;
}

function createWindow(): void {
	mainWindow = createAppWindow();
}

async function loadRenderer(win: BrowserWindow, mode?: 'editor'): Promise<void> {
	if (!win) return;

	const distIndex = path.join(__dirname, '../dist/index.html');
	const devUrl = process.env.VITE_DEV_SERVER_URL;

	console.log('[copix] loadRenderer:', { devUrl: devUrl ?? '(none)', distIndex, distExists: fsSync.existsSync(distIndex) });

	if (devUrl) {
		try {
			const url = mode === 'editor' ? `${devUrl}${devUrl.includes('?') ? '&' : '?'}mode=editor` : devUrl;
			await win.loadURL(url);
			win.webContents.openDevTools({ mode: 'detach' });
			console.log('[copix] Loaded dev URL:', devUrl);
		} catch (err) {
			console.error('[copix] loadURL failed:', devUrl, err);
			throw err;
		}
		return;
	}

	if (fsSync.existsSync(distIndex)) {
		try {
			if (mode === 'editor') await win.loadFile(distIndex, { search: '?mode=editor' });
			else await win.loadFile(distIndex);
			console.log('[copix] Loaded production build:', distIndex);
		} catch (err) {
			console.error('[copix] loadFile failed:', distIndex, err);
			throw err;
		}
		return;
	}

	const help = [
		'Copix Studio UI is not built.',
		'',
		'Development: double-click copix-studio.bat or run npm run dev in studio/',
		'Production: npm run build && npm start',
	].join('\n');
	await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
		`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Copix</title></head>`
		+ `<body style="margin:0;background:#0f0f10;color:#f4f4f5;font:14px/1.5 Segoe UI,sans-serif;padding:32px">`
		+ `<h1 style="font-size:18px;margin:0 0 12px">Copix Studio</h1>`
		+ `<pre style="white-space:pre-wrap;color:#a1a1aa">${help}</pre></body></html>`,
	)}`);
}

app.whenReady().then(() => {
	// Match locked dark UI — system menu bar / chrome follow dark appearance
	nativeTheme.themeSource = 'dark';
	installApplicationMenu();

	ipcMain.handle('copix:getSettings', async () => {
		try {
			ensureCopixDir();
			const primary = settingsPath();
			if (fsSync.existsSync(primary)) {
				return JSON.parse(await fs.readFile(primary, 'utf8'));
			}
			const legacy = legacyConfigPath();
			if (fsSync.existsSync(legacy)) {
				const raw = await fs.readFile(legacy, 'utf8');
				const parsed = JSON.parse(raw);
				await fs.writeFile(primary, JSON.stringify(parsed, null, 2), 'utf8');
				return parsed;
			}
			await fs.writeFile(primary, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
			return DEFAULT_SETTINGS;
		} catch {
			return DEFAULT_SETTINGS;
		}
	});

	ipcMain.handle('copix:setSettings', async (_e, settings: unknown) => {
		ensureCopixDir();
		await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
	});

	ipcMain.handle('copix:getProjectsRoot', async () => {
		const root = projectsRoot();
		await fs.mkdir(root, { recursive: true });
		await fs.mkdir(agentsDir(), { recursive: true });
		return root;
	});

	ipcMain.handle('copix:browseHomeDirectory', async () => {
		const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
		if (result.canceled || !result.filePaths[0]) return undefined;
		return result.filePaths[0];
	});

	ipcMain.handle('copix:createSessionWorkspace', async (_e, sessionId: string) => ensureSessionWorkspace(sessionId));

	ipcMain.handle(
		'copix:createProject',
		async (_e, sessionId: string, name: string, description?: string, outputPath?: string) =>
			createNamedProject(sessionId, name, description, outputPath),
	);

	ipcMain.handle('copix:openFolder', async (_e, sessionId?: string) => {
		const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
		if (result.canceled || !result.filePaths[0]) return undefined;
		const root = result.filePaths[0];
		return { root, tree: await listTree(root), sessionId };
	});

	ipcMain.handle('copix:cloneRepo', async (_e, url: string, sessionId?: string) => {
		const parent = sessionId ? sessionWorkspaceRoot(sessionId) : projectsRoot();
		const name = url.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
		const dest = path.join(parent, name);
		await fs.mkdir(parent, { recursive: true });
		if (!fsSync.existsSync(dest)) {
			await new Promise<void>((resolve, reject) => {
				const proc = spawn('git', ['clone', '--depth', '1', url, dest], { shell: true });
				proc.on('close', code => (code === 0 ? resolve() : reject(new Error('git clone failed'))));
			});
		}
		return { root: dest, tree: await listTree(dest) };
	});

	ipcMain.handle('copix:getWorkspace', async (_e, workspaceRoot: string) => {
		if (!workspaceRoot || !fsSync.existsSync(workspaceRoot)) return undefined;
		return { root: workspaceRoot, tree: await listTree(workspaceRoot) };
	});

	ipcMain.handle('copix:getRepoRemote', async (_e, workspaceRoot: string) => getGitRemote(workspaceRoot));

	ipcMain.handle('copix:readFile', async (_e, filePath: string, workspaceRoot?: string) => {
		if (isSensitiveWorkspacePath(filePath)) {
			throw new Error('Refused: sensitive file (env / credentials) is hidden and cannot be opened.');
		}
		return fs.readFile(resolvePath(filePath, workspaceRoot), 'utf8');
	});

function looksLikeSecretPath(filePath: string): boolean {
	const base = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
	const stem = base.replace(/\.[a-z0-9]{1,8}$/i, '');
	return /^(sk-or-v1-|sk-|gsk_|gh[pousr]_)/i.test(stem) || /^(sk-or-v1-|sk-|gsk_)/i.test(base);
}

	ipcMain.handle('copix:writeFile', async (_e, filePath: string, content: string, workspaceRoot?: string) => {
		if (looksLikeSecretPath(filePath) || isSensitiveWorkspacePath(filePath)) {
			throw new Error('Refused: path looks like an API key or secret — use a real filename');
		}
		const full = resolvePath(filePath, workspaceRoot);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, content, 'utf8');
		return full;
	});

	ipcMain.handle('copix:deleteFile', async (_e, filePath: string, workspaceRoot?: string) => {
		const full = resolvePath(filePath, workspaceRoot);
		await fs.unlink(full);
		return full;
	});

	ipcMain.handle('copix:listDir', async (_e, dirPath: string | undefined, workspaceRoot?: string) => {
		const full = resolvePath(dirPath || '.', workspaceRoot);
		const entries = await fs.readdir(full, { withFileTypes: true });
		return entries
			.filter(e => !shouldHideWorkspaceEntry(e.name, e.isDirectory()))
			.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
	});

	ipcMain.handle('copix:grep', async (_e, pattern: string, searchPath: string | undefined, workspaceRoot?: string) => {
		const root = searchPath ? resolvePath(searchPath, workspaceRoot) : (workspaceRoot ?? process.cwd());
		return new Promise<string>(resolve => {
			const proc = spawn('rg', ['--no-heading', '--line-number', '--max-count', '80', pattern, root], { shell: true });
			let out = '';
			proc.stdout.on('data', d => { out += d; });
			proc.stderr.on('data', d => { out += d; });
			proc.on('close', code => {
				if (code === 0) resolve(out.trim() || 'No matches');
				else if (code === 1) resolve('No matches found');
				else resolve(out.trim() || 'Install ripgrep (rg) for search');
			});
		});
	});

	ipcMain.handle('copix:runTerminal', async (event, command: string, workspaceRoot?: string, cwd?: string, elevate?: boolean, streamId?: string) => {
		const wantsElevate = Boolean(elevate) || needsAdminConfirmation(command);
		if (wantsElevate) {
			const ok = await confirmElevated(command);
			if (!ok) return 'User declined elevated command';
		}
		const workDir = cwd ? resolvePath(cwd, workspaceRoot) : (workspaceRoot ?? process.cwd());
		const isWin = process.platform === 'win32';
		const isMac = process.platform === 'darwin';
		const streamChannel = streamId ? `copix:terminal:${streamId}` : undefined;
		const emit = (chunk: string) => {
			if (streamChannel && chunk) event.sender.send(streamChannel, chunk);
		};

		if (isMac && /\bapt(-get)?\b|\byum\b|\bdnf\b/i.test(command)) {
			const msg = 'Blocked: Linux package managers (apt/yum/dnf) are not available on macOS. '
				+ 'Use Homebrew instead, e.g. `brew install node`, or install Node from https://nodejs.org.';
			emit(msg + '\n');
			return msg;
		}

		return new Promise<string>(resolve => {
			if (isWin && wantsElevate) {
				// Elevated PowerShell via UAC; write stdout/stderr to a temp log.
				const outFile = path.join(os.tmpdir(), `copix-elev-${Date.now()}.txt`);
				const safeDir = workDir.replace(/'/g, "''");
				const safeOut = outFile.replace(/'/g, "''");
				const inner =
					`$ErrorActionPreference='Continue'; `
					+ `Set-Location -LiteralPath '${safeDir}'; `
					+ `& { ${command} } *>&1 | Out-File -FilePath '${safeOut}' -Encoding utf8`;
				const proc = spawn('powershell.exe', [
					'-NoLogo', '-NoProfile', '-Command',
					`Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden `
					+ `-ArgumentList '-NoLogo','-NoProfile','-Command',${JSON.stringify(inner)}`,
				]);
				let out = '';
				proc.stdout?.on('data', d => { const s = d.toString(); out += s; emit(s); });
				proc.stderr?.on('data', d => { const s = d.toString(); out += s; emit(s); });
				proc.on('error', err => resolve(err.message));
				proc.on('close', async () => {
					try {
						const fileOut = await fs.readFile(outFile, 'utf8');
						await fs.unlink(outFile).catch(() => undefined);
						const combined = (fileOut || out).trim();
						if (streamChannel && fileOut && !out.includes(fileOut)) emit(fileOut);
						resolve(combined || '(elevated command finished)');
					} catch {
						resolve(out.trim() || '(elevated command finished — output unavailable)');
					}
				});
				setTimeout(() => { proc.kill(); resolve(out.trim() || '(timeout 120s)'); }, 120_000);
				return;
			}
			if (isMac && wantsElevate) {
				const outFile = path.join(os.tmpdir(), `copix-elev-${Date.now()}.txt`);
				const script = [
					`cd ${JSON.stringify(workDir)} || exit 1`,
					`{ ${command} ; } >${JSON.stringify(outFile)} 2>&1`,
				].join('\n');
				const appleScript =
					`do shell script ${JSON.stringify(`bash -lc ${JSON.stringify(script)}`)} with administrator privileges`;
				const proc = spawn('osascript', ['-e', appleScript]);
				let out = '';
				proc.stdout?.on('data', d => { const s = d.toString(); out += s; emit(s); });
				proc.stderr?.on('data', d => { const s = d.toString(); out += s; emit(s); });
				proc.on('error', err => resolve(err.message));
				proc.on('close', async () => {
					try {
						const fileOut = await fs.readFile(outFile, 'utf8');
						await fs.unlink(outFile).catch(() => undefined);
						const combined = (fileOut || out).trim();
						if (streamChannel && fileOut && !out.includes(fileOut)) emit(fileOut);
						resolve(combined || '(elevated command finished)');
					} catch {
						resolve(out.trim() || '(elevated command finished — output unavailable)');
					}
				});
				setTimeout(() => { proc.kill(); resolve(out.trim() || '(timeout 120s)'); }, 120_000);
				return;
			}
			const proc = isWin
				? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
					cwd: workDir,
					env: terminalEnv(),
				})
				: spawn(isMac ? '/bin/zsh' : '/bin/bash', ['-lc', command], {
					cwd: workDir,
					env: terminalEnv(),
				});
			let out = '';
			proc.stdout?.on('data', d => { const s = d.toString(); out += s; emit(s); });
			proc.stderr?.on('data', d => { const s = d.toString(); out += s; emit(s); });
			proc.on('error', err => resolve(err.message));
			proc.on('close', code => resolve(out.trim() || `(exit ${code ?? 0})`));
			setTimeout(() => { proc.kill(); resolve(out.trim() || '(timeout 120s)'); }, 120_000);
		});
	});

	ipcMain.handle('copix:openExternal', (_e, url: string) => shell.openExternal(url));
	ipcMain.handle('copix:openIdeWindow', () => {
		createAppWindow('editor');
		return { ok: true };
	});

	ipcMain.handle('copix:getServerStatus', () => fetchServerHealth());

	ipcMain.handle('copix:startServer', async () => ensureCopixModelsInternal(true));

	ipcMain.handle('copix:pullOllamaModel', async (_e, model = FALLBACK_MODEL_ID) => pullModelInternal(model));

	ipcMain.handle('copix:ensureCopixModels', () => ensureCopixModelsInternal(false));

	createWindow();

	void ensureCopixModelsInternal(false).then(result => {
		if (result.pulled.length) {
			mainWindow?.webContents.send('copix:modelsReady', result.message);
		}
	}).catch(() => undefined);
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
	else mainWindow?.show();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
