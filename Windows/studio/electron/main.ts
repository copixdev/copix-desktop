import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	isSensitiveWorkspacePath,
	shouldHideWorkspaceEntry,
} from '../src/utils/workspaceIgnore';

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
		? [process.execPath]
		: [
			path.join(__dirname, '..', 'build', 'icon.ico'),
			path.join(__dirname, '..', 'build', 'icon.png'),
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
let serverProc: ChildProcess | undefined;
let trainProc: ChildProcess | undefined;
let trainWatchTimer: ReturnType<typeof setInterval> | undefined;
let trainStderr = '';
let setupRunning = false;
let setupAbort = false;

type SetupPhase =
	| 'idle'
	| 'checking_ollama'
	| 'pulling'
	| 'installing_deps'
	| 'building_dataset'
	| 'training'
	| 'exporting'
	| 'done'
	| 'error';

type SetupFailedStep = Exclude<SetupPhase, 'idle' | 'done' | 'error'>;

interface SetupProgress {
	phase: SetupPhase;
	message: string;
	training?: Record<string, unknown>;
	failedStep?: SetupFailedStep;
	errorType?: string;
	detail?: string;
}

interface SetupResult {
	ok: boolean;
	message: string;
	failedStep?: SetupFailedStep;
	errorType?: string;
	detail?: string;
}

interface TrainingStatusFile {
	status?: string;
	message?: string;
	error_type?: string;
	failed_step?: string;
	detail?: string;
}

let currentSetup: SetupProgress = { phase: 'idle', message: '' };
let activeSetupStep: SetupFailedStep = 'checking_ollama';

const coreRoot = () => path.join(app.isPackaged ? path.join(process.resourcesPath, 'copix-core') : path.join(__dirname, '..', 'copix-core'));
const trainingStatusPath = () => path.join(coreRoot(), 'output', 'training_status.json');

function resolvePython(): { exe: string; prefixArgs: string[] } {
	const winVenv = path.join(coreRoot(), '.venv', 'Scripts', 'python.exe');
	const posixVenv = path.join(coreRoot(), '.venv', 'bin', 'python');
	if (fsSync.existsSync(winVenv)) return { exe: winVenv, prefixArgs: [] };
	if (fsSync.existsSync(posixVenv)) return { exe: posixVenv, prefixArgs: [] };
	if (process.platform === 'win32') {
		for (const ver of ['-3.11', '-3.12', '-3.10']) {
			const r = spawnSync('py', [ver, '-c', 'import sys; raise SystemExit(0 if sys.version_info[:2]>=(3,10) else 1)']);
			if (r.status === 0) return { exe: 'py', prefixArgs: [ver] };
		}
	}
	return { exe: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] };
}

function spawnPython(args: string[], options: SpawnOptions): ChildProcess {
	const py = resolvePython();
	return spawn(py.exe, [...py.prefixArgs, ...args], {
		...options,
		env: { ...process.env, PYTHONUNBUFFERED: '1' },
	});
}

const OLLAMA_HOST = 'http://127.0.0.1:11434';

async function fetchOllamaStatus(): Promise<{
	online: boolean;
	hasBase: boolean;
	hasTuned: boolean;
	models: string[];
}> {
	try {
		const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return { online: false, hasBase: false, hasTuned: false, models: [] };
		const data = await res.json() as { models?: Array<{ name: string }> };
		const names = (data.models ?? []).map(m => m.name);
		return {
			online: true,
			hasBase: names.some(n =>
				(n.includes('gpt-oss') && !n.includes('copix'))
				|| n.includes('qwen2.5-coder')
				|| n.includes('qwen2.5-coder-1.5b'),
			),
			hasTuned: names.some(n =>
				n.includes('copix-core')
				|| n.includes('copix-gpt-oss'),
			),
			models: names,
		};
	} catch {
		return { online: false, hasBase: false, hasTuned: false, models: [] };
	}
}

async function fetchServerHealth(): Promise<{
	online: boolean;
	adapter?: boolean;
	hasBase?: boolean;
	hasTuned?: boolean;
	models?: string[];
}> {
	const s = await fetchOllamaStatus();
	return {
		online: s.online && (s.hasBase || s.hasTuned),
		adapter: s.hasTuned,
		hasBase: s.hasBase,
		hasTuned: s.hasTuned,
		models: s.models,
	};
}

function broadcastTrainingStatus(): void {
	if (!mainWindow) return;
	try {
		const raw = fsSync.readFileSync(trainingStatusPath(), 'utf8');
		const data = JSON.parse(raw);
		mainWindow.webContents.send('copix:trainingProgress', data);
		if (setupRunning) {
			currentSetup = { ...currentSetup, training: data };
			broadcastSetupProgress();
		}
	} catch { /* no file yet */ }
}

function broadcastSetupProgress(): void {
	mainWindow?.webContents.send('copix:setupProgress', currentSetup);
}

function setSetup(phase: SetupPhase, message: string): void {
	if (phase !== 'idle' && phase !== 'done' && phase !== 'error') {
		activeSetupStep = phase;
	}
	currentSetup = { phase, message, training: currentSetup.training };
	broadcastSetupProgress();
}

function setSetupError(
	failedStep: SetupFailedStep,
	errorType: string,
	message: string,
	detail?: string,
): void {
	currentSetup = {
		phase: 'error',
		message,
		failedStep,
		errorType,
		detail,
		training: currentSetup.training,
	};
	broadcastSetupProgress();
}

function failStep(
	failedStep: SetupFailedStep,
	message: string,
	opts?: { errorType?: string; detail?: string },
): SetupResult {
	const errorType = opts?.errorType ?? 'ProcessError';
	const detail = opts?.detail;
	setSetupError(failedStep, errorType, message, detail);
	return { ok: false, message, failedStep, errorType, detail };
}

function tailOutput(text: string, max = 1500): string {
	const t = text.trim();
	return t.length <= max ? t : t.slice(-max);
}

function inferErrorType(message: string): string {
	const low = message.toLowerCase();
	if (low.includes('execution policy') || low.includes('cannot be loaded')) return 'PowerShellError';
	if (low.includes('python') && (low.includes('not found') || low.includes('need python'))) return 'PythonNotFoundError';
	if (low.includes('ollama') && (low.includes('not found') || low.includes('failed'))) return 'OllamaError';
	return 'ProcessError';
}

async function resetTrainingStatus(message = 'Preparing…'): Promise<void> {
	try {
		await fs.mkdir(path.dirname(trainingStatusPath()), { recursive: true });
		await fs.writeFile(
			trainingStatusPath(),
			JSON.stringify({ status: 'idle', message, history: [] }, null, 2),
		);
	} catch { /* ignore */ }
}

async function readTrainingStatusFile(): Promise<TrainingStatusFile | null> {
	try {
		const raw = await fs.readFile(trainingStatusPath(), 'utf8');
		return JSON.parse(raw) as TrainingStatusFile;
	} catch {
		return null;
	}
}

function venvPythonPath(): string {
	return path.join(coreRoot(), '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
}

function hasVenv(): boolean {
	return fsSync.existsSync(venvPythonPath());
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

async function runSetupInternal(): Promise<SetupResult> {
	const setup = path.join(coreRoot(), 'setup.ps1');
	if (!fsSync.existsSync(setup)) {
		return failStep('installing_deps', 'setup.ps1 not found', { errorType: 'FileNotFoundError' });
	}
	return new Promise(resolve => {
		const proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', setup], { cwd: coreRoot(), shell: true });
		let out = '';
		proc.stdout?.on('data', d => { out += d; });
		proc.stderr?.on('data', d => { out += d; });
		proc.on('close', code => {
			if (code === 0) resolve({ ok: true, message: 'Setup complete' });
			else {
				const detail = tailOutput(out);
				const message = detail || `setup.ps1 exited with code ${code}`;
				resolve(failStep('installing_deps', message, {
					errorType: inferErrorType(message),
					detail,
				}));
			}
		});
		proc.on('error', err => {
			resolve(failStep('installing_deps', err.message, { errorType: err.name, detail: err.message }));
		});
	});
}

async function buildDatasetInternal(): Promise<SetupResult> {
	const script = path.join(coreRoot(), 'scripts', 'build_dataset.py');
	return new Promise(resolve => {
		const proc = spawnPython([script], { cwd: coreRoot(), shell: false });
		let out = '';
		proc.stdout?.on('data', d => { out += d; });
		proc.stderr?.on('data', d => { out += d; });
		proc.on('close', code => {
			if (code === 0) resolve({ ok: true, message: 'Dataset built' });
			else {
				const detail = tailOutput(out);
				const message = detail || `build_dataset.py exited with code ${code}`;
				resolve(failStep('building_dataset', message, { errorType: 'DatasetBuildError', detail }));
			}
		});
		proc.on('error', err => {
			resolve(failStep('building_dataset', err.message, { errorType: err.name, detail: err.message }));
		});
	});
}

async function exportInternal(): Promise<SetupResult> {
	const script = path.join(coreRoot(), 'export_ollama.py');
	return new Promise(resolve => {
		const proc = spawnPython([script], { cwd: coreRoot(), shell: false });
		let out = '';
		proc.stdout?.on('data', d => { out += d; });
		proc.stderr?.on('data', d => { out += d; });
		proc.on('close', code => {
			if (code === 0) resolve({ ok: true, message: 'copix-core registered in Ollama' });
			else {
				const detail = tailOutput(out, 2000);
				const message = detail || `export_ollama.py exited with code ${code}`;
				resolve(failStep('exporting', message, { errorType: 'OllamaExportError', detail }));
			}
		});
		proc.on('error', err => {
			resolve(failStep('exporting', err.message, { errorType: err.name, detail: err.message }));
		});
	});
}

async function mergeExportCoreInternal(): Promise<SetupResult> {
	const script = path.join(coreRoot(), 'export_ollama.py');
	if (!fsSync.existsSync(script)) {
		return failStep('exporting', `export_ollama.py not found at ${script}`, { errorType: 'FileNotFoundError' });
	}
	return new Promise(resolve => {
		const proc = spawnPython([script, '--name', 'copix-core'], { cwd: coreRoot(), shell: false });
		let out = '';
		proc.stdout?.on('data', d => { out += d; });
		proc.stderr?.on('data', d => { out += d; });
		proc.on('close', code => {
			if (code === 0) resolve({ ok: true, message: 'copix-core registered in Ollama' });
			else {
				const detail = tailOutput(out, 2000);
				const message = detail || `export_ollama.py exited with code ${code}`;
				resolve(failStep('exporting', message, { errorType: 'OllamaExportError', detail }));
			}
		});
		proc.on('error', err => {
			resolve(failStep('exporting', err.message, { errorType: err.name, detail: err.message }));
		});
	});
}

async function startTrainingInternal(epochs: number): Promise<SetupResult> {
	if (trainProc) return failStep('training', 'Training already running', { errorType: 'TrainingBusyError' });
	const script = path.join(coreRoot(), 'train_gpt_oss.py');
	if (!fsSync.existsSync(script)) {
		return failStep('training', `train_gpt_oss.py not found at ${script}`, { errorType: 'FileNotFoundError' });
	}
	await resetTrainingStatus('Starting Copix Core training (openai/gpt-oss-20b LoRA)…');
	trainStderr = '';
	const py = resolvePython();
	const args = [...py.prefixArgs, script, '--epochs', String(epochs)];
	console.log('[copix] spawn training:', py.exe, args.join(' '));
	try {
		trainProc = spawn(py.exe, args, {
			cwd: coreRoot(),
			shell: false,
			stdio: 'pipe',
			env: { ...process.env, PYTHONUNBUFFERED: '1' },
		});
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		return failStep('training', e.message, { errorType: e.name, detail: e.stack });
	}
	trainProc.stdout?.on('data', d => console.log('[train]', d.toString()));
	trainProc.stderr?.on('data', d => {
		const chunk = d.toString();
		trainStderr += chunk;
		console.error('[train]', chunk);
	});
	trainProc.on('error', err => {
		console.error('[copix] training spawn error:', err);
		void writeTrainingCrashStatus(null, null);
	});
	trainProc.on('close', code => {
		trainProc = undefined;
		if (trainWatchTimer) clearInterval(trainWatchTimer);
		void (async () => {
			const status = await readTrainingStatusFile();
			if (code === 0 && status?.status === 'completed') {
				if (setupRunning) setSetup('exporting', 'Registering copix-core in Ollama…');
				const exp = await mergeExportCoreInternal();
				if (!exp.ok) {
					console.error('[copix] export after train failed:', exp.message);
					if (setupRunning) {
						setSetupError(
							'exporting',
							exp.errorType ?? 'OllamaExportError',
							exp.message,
							exp.detail,
						);
					}
				} else if (setupRunning) {
					setSetup('done', 'Copix Core ready in Ollama as copix-core');
				}
			} else if (setupRunning && code !== 0) {
				if (status?.status !== 'completed' && status?.status !== 'error') {
					await writeTrainingCrashStatus(code, null);
				}
			}
			broadcastTrainingStatus();
		})();
	});
	trainWatchTimer = setInterval(broadcastTrainingStatus, 800);
	return { ok: true, message: 'Copix Core training started (gpt-oss-20b)' };
}

function trainingFailure(status: TrainingStatusFile | null, fallbackMessage: string): SetupResult {
	const stderrTail = trainStderr ? tailOutput(trainStderr, 2000) : undefined;
	let message = status?.message ?? fallbackMessage;
	const errorType = status?.error_type ?? 'TrainingError';
	let detail = status?.detail ?? stderrTail;
	// Avoid showing bare exception class names with no context
	if (message === errorType && detail) message = detail;
	else if (!message || message === 'TypeError' || message === 'Error') {
		message = fallbackMessage;
	}
	if (status) currentSetup = { ...currentSetup, training: status as Record<string, unknown> };
	return failStep('training', message, { errorType, detail });
}

async function writeTrainingCrashStatus(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
	const detail = trainStderr ? tailOutput(trainStderr, 2000) : undefined;
	const codeLabel = code === null ? (signal ? `signal ${signal}` : 'unknown') : String(code);
	const message = detail
		? `Training process crashed (exit ${codeLabel}). See detail below.`
		: `Training process crashed (exit ${codeLabel}) while loading or fine-tuning the model.`;
	try {
		await fs.mkdir(path.dirname(trainingStatusPath()), { recursive: true });
		await fs.writeFile(trainingStatusPath(), JSON.stringify({
			status: 'error',
			error_type: 'TrainingCrashError',
			failed_step: 'loading_model',
			message,
			detail,
			history: [],
		}, null, 2), 'utf8');
	} catch { /* ignore */ }
}

async function waitForTraining(): Promise<SetupResult> {
	const deadline = Date.now() + 6 * 60 * 60 * 1000;
	while (Date.now() < deadline) {
		if (setupAbort) return { ok: false, message: 'Setup cancelled' };
		const status = await readTrainingStatusFile();
		if (status?.status === 'completed') return { ok: true, message: 'Training complete' };
		if (status?.status === 'error') return trainingFailure(status, 'Training failed');
		if (!trainProc) {
			const finalStatus = await readTrainingStatusFile();
			if (finalStatus?.status === 'completed') return { ok: true, message: 'Training complete' };
			if (finalStatus?.status === 'error') return trainingFailure(finalStatus, 'Training failed');
			if (finalStatus?.status === 'running') {
				return trainingFailure(finalStatus, 'Training stopped unexpectedly while loading the model');
			}
			return trainingFailure(finalStatus, 'Training stopped unexpectedly');
		}
		await new Promise(r => setTimeout(r, 2000));
	}
	return failStep('training', 'Training timed out after 6 hours', { errorType: 'TimeoutError' });
}

function normalizeEpochs(epochs: unknown): number {
	const n = typeof epochs === 'number' ? epochs : Number(epochs);
	return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10) : 3;
}

function setupExceptionResult(err: unknown): SetupResult {
	const e = err instanceof Error ? err : new Error(String(err));
	console.error('[copix] model setup error:', e);
	return failStep(activeSetupStep, e.message || 'Setup failed unexpectedly', {
		errorType: e.name || 'Error',
		detail: e.stack,
	});
}

/**
 * Simple setup: make sure Ollama is running and gpt-oss:20b is pulled, then done.
 * Fine-tuning is optional and available separately via copix:startTraining.
 */
async function runModelSetupPipeline(_epochs: unknown = 3): Promise<SetupResult> {
	if (setupRunning) {
		return failStep('checking_ollama', 'Setup already running', { errorType: 'SetupBusyError' });
	}
	setupRunning = true;
	setupAbort = false;
	activeSetupStep = 'checking_ollama';
	try {
		setSetup('checking_ollama', 'Checking Ollama…');
		const s = await fetchOllamaStatus();
		if (setupAbort) return { ok: false, message: 'Setup cancelled' };
		if (!s.online) {
			return failStep(
				'checking_ollama',
				'Ollama not running — install from ollama.com and keep it open',
				{ errorType: 'OllamaOfflineError' },
			);
		}

		if (!s.hasBase && !s.hasTuned) {
			setSetup('pulling', 'Downloading gpt-oss:20b (~13GB). This may take a while…');
			const pull = await pullModelInternal('gpt-oss:20b');
			if (setupAbort) return { ok: false, message: 'Setup cancelled' };
			if (!pull.ok) {
				const detail = tailOutput(pull.message, 2000);
				return failStep('pulling', detail || 'ollama pull failed', {
					errorType: 'OllamaPullError',
					detail,
				});
			}
		}

		setSetup('done', 'gpt-oss:20b is ready — start chatting!');
		return { ok: true, message: 'Setup complete' };
	} catch (err) {
		return setupExceptionResult(err);
	} finally {
		setupRunning = false;
	}
}

const configPath = () => path.join(app.getPath('userData'), 'copix-config.json');

function defaultUserProjectsRoot(): string {
	return app.getPath('home');
}

function readWorkspaceHome(): string {
	try {
		const raw = fsSync.readFileSync(configPath(), 'utf8');
		const settings = JSON.parse(raw) as { workspace?: { homeDirectory?: string } };
		const home = settings.workspace?.homeDirectory?.trim();
		if (home && !/copix-output/i.test(home.replace(/\\/g, '/'))) {
			return path.normalize(home);
		}
	} catch { /* use default */ }
	return path.normalize(defaultUserProjectsRoot());
}

const projectsRoot = () => readWorkspaceHome();

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
	];
	return patterns.some(p => p.test(c));
}

async function confirmElevated(command: string): Promise<boolean> {
	const result = await dialog.showMessageBox(mainWindow!, {
		type: 'warning',
		buttons: ['Cancel', 'Allow'],
		defaultId: 0,
		cancelId: 0,
		title: 'Administrator access',
		message: 'Copix wants to run this command as Administrator.',
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
	const root = path.join(agentsDir(), sessionId);
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
			: path.join(agentsDir(), sessionId, requestedBase);
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

function createWindow(): void {
	const preloadPath = path.join(__dirname, 'preload.mjs');
	if (!fsSync.existsSync(preloadPath)) {
		console.error('[copix] Preload script missing:', preloadPath);
	}

	const appIcon = loadAppIcon();
	mainWindow = new BrowserWindow({
		width: 1600,
		height: 940,
		minWidth: 1100,
		minHeight: 700,
		title: 'Copix',
		...(appIcon ? { icon: appIcon } : {}),
		backgroundColor: '#0f0f10',
		titleBarStyle: 'hidden',
		titleBarOverlay: { color: '#0f0f10', symbolColor: '#ccc', height: 36 },
		show: false,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	if (appIcon) {
		mainWindow.setIcon(appIcon);
	}

	attachRendererLogging(mainWindow);
	showLoadingPage(mainWindow);
	mainWindow.once('ready-to-show', () => mainWindow?.show());

	void loadRenderer().catch(err => {
		console.error('[copix] loadRenderer failed:', err);
	});
}

async function loadRenderer(): Promise<void> {
	if (!mainWindow) return;

	const distIndex = path.join(__dirname, '../dist/index.html');
	const devUrl = process.env.VITE_DEV_SERVER_URL;

	console.log('[copix] loadRenderer:', { devUrl: devUrl ?? '(none)', distIndex, distExists: fsSync.existsSync(distIndex) });

	if (devUrl) {
		try {
			await mainWindow.loadURL(devUrl);
			mainWindow.webContents.openDevTools({ mode: 'detach' });
			console.log('[copix] Loaded dev URL:', devUrl);
		} catch (err) {
			console.error('[copix] loadURL failed:', devUrl, err);
			throw err;
		}
		return;
	}

	if (fsSync.existsSync(distIndex)) {
		try {
			await mainWindow.loadFile(distIndex);
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
	await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
		`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Copix</title></head>`
		+ `<body style="margin:0;background:#0f0f10;color:#f4f4f5;font:14px/1.5 Segoe UI,sans-serif;padding:32px">`
		+ `<h1 style="font-size:18px;margin:0 0 12px">Copix Studio</h1>`
		+ `<pre style="white-space:pre-wrap;color:#a1a1aa">${help}</pre></body></html>`,
	)}`);
}

app.whenReady().then(() => {
	ipcMain.handle('copix:getSettings', async () => {
		try {
			const raw = await fs.readFile(configPath(), 'utf8');
			return JSON.parse(raw);
		} catch {
			return null;
		}
	});

	ipcMain.handle('copix:setSettings', async (_e, settings: unknown) => {
		await fs.writeFile(configPath(), JSON.stringify(settings, null, 2), 'utf8');
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
		const parent = sessionId ? path.join(agentsDir(), sessionId) : agentsDir();
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
		const streamChannel = streamId ? `copix:terminal:${streamId}` : undefined;
		const emit = (chunk: string) => {
			if (streamChannel && chunk) event.sender.send(streamChannel, chunk);
		};
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
			const proc = isWin
				? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { cwd: workDir })
				: spawn(command, { cwd: workDir, shell: true });
			let out = '';
			proc.stdout?.on('data', d => { const s = d.toString(); out += s; emit(s); });
			proc.stderr?.on('data', d => { const s = d.toString(); out += s; emit(s); });
			proc.on('error', err => resolve(err.message));
			proc.on('close', code => resolve(out.trim() || `(exit ${code ?? 0})`));
			setTimeout(() => { proc.kill(); resolve(out.trim() || '(timeout 120s)'); }, 120_000);
		});
	});

	ipcMain.handle('copix:openExternal', (_e, url: string) => shell.openExternal(url));

	ipcMain.handle('copix:getCoreRoot', () => coreRoot());

	ipcMain.handle('copix:getServerStatus', () => fetchServerHealth());

	ipcMain.handle('copix:startServer', async () => {
		const s = await fetchOllamaStatus();
		if (!s.online) {
			return { ok: false, message: 'Ollama not running — install from ollama.com and open the Ollama app' };
		}
		if (s.hasTuned) return { ok: true, message: 'copix-core ready in Ollama', adapter: true };
		if (s.hasBase) return { ok: true, message: 'Local Ollama model ready', adapter: false };
		return { ok: false, message: 'Pull gpt-oss:20b in the Model panel first' };
	});

	ipcMain.handle('copix:pullOllamaModel', async (_e, model = 'gpt-oss:20b') => pullModelInternal(model));

	ipcMain.handle('copix:exportToOllama', () => exportInternal());

	ipcMain.handle('copix:stopServer', () => {
		serverProc?.kill();
		serverProc = undefined;
		return { ok: true };
	});

	ipcMain.handle('copix:buildDataset', () => buildDatasetInternal());

	ipcMain.handle('copix:startTraining', async (_e, epochs = 3) => startTrainingInternal(normalizeEpochs(epochs)));

	ipcMain.handle('copix:stopTraining', () => {
		trainProc?.kill();
		trainProc = undefined;
		if (trainWatchTimer) clearInterval(trainWatchTimer);
		return { ok: true };
	});

	ipcMain.handle('copix:getTrainingStatus', async () => {
		try {
			const raw = await fs.readFile(trainingStatusPath(), 'utf8');
			return JSON.parse(raw);
		} catch {
			return { status: 'idle', message: 'No training run yet', history: [] };
		}
	});

	ipcMain.handle('copix:runCoreSetup', () => runSetupInternal());

	ipcMain.handle('copix:runModelSetup', async (_e, epochs = 3) => {
		try {
			return await runModelSetupPipeline(epochs);
		} catch (err) {
			return setupExceptionResult(err);
		}
	});

	ipcMain.handle('copix:cancelModelSetup', () => {
		setupAbort = true;
		trainProc?.kill();
		trainProc = undefined;
		if (trainWatchTimer) clearInterval(trainWatchTimer);
		setSetup('idle', 'Setup cancelled');
		return { ok: true };
	});

	ipcMain.handle('copix:getSetupProgress', () => currentSetup);

	createWindow();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
