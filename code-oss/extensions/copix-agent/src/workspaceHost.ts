import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EditSession, nextEditId, type PendingEdit } from './edits';
import type { CopixHost, ProjectCreated } from './host';
import { computeLineDiff } from './utils/lineDiff';
import { isSensitiveWorkspacePath, shouldHideWorkspaceEntry } from './utils/workspaceIgnore';

export interface WorkspaceHostOptions {
	edits: EditSession;
	onProposed?: (edit: PendingEdit) => void;
	confirmElevate?: (command: string) => Promise<boolean>;
	onTerminalStart?: (streamId: string, command: string, cwd: string) => void;
	onTerminalOutput?: (streamId: string, chunk: string) => void;
	onTerminalEnd?: (streamId: string, result: string) => void;
}

function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'project';
}

function resolvePath(target: string, workspaceRoot?: string): string {
	let raw = target.trim();
	if (raw.startsWith('~/') || raw === '~') {
		raw = path.join(os.homedir(), raw.slice(1).replace(/^[/\\]+/, ''));
	}
	if (path.isAbsolute(raw)) return path.normalize(raw);
	if (!workspaceRoot) throw new Error('No workspace — open a folder first');
	return path.normalize(path.join(workspaceRoot, raw));
}

async function readDisk(full: string): Promise<string | undefined> {
	try {
		return await fs.readFile(full, 'utf8');
	} catch {
		return undefined;
	}
}

function terminalEnv(): NodeJS.ProcessEnv {
	const home = os.homedir();
	const sep = process.platform === 'win32' ? ';' : ':';
	const extras = process.platform === 'win32'
		? []
		: [
			'/opt/homebrew/bin',
			'/usr/local/bin',
			path.join(home, '.local', 'bin'),
		];
	const merged = [...extras, process.env.PATH ?? ''].filter(Boolean).join(sep);
	return { ...process.env, PATH: merged, HOME: home };
}

export function createWorkspaceHost(options: WorkspaceHostOptions): CopixHost {
	const { edits } = options;

	const stage = async (
		filePath: string,
		workspace: string,
		kind: PendingEdit['kind'],
		after: string,
	): Promise<string> => {
		if (isSensitiveWorkspacePath(filePath)) {
			throw new Error('Refused: path looks like an API key or secret — use a real filename');
		}
		const full = resolvePath(filePath, workspace);
		const before = edits.get(full)?.after ?? (await readDisk(full)) ?? '';
		const edit: PendingEdit = { id: nextEditId(), path: full, before, after, kind };
		edits.propose(edit);
		options.onProposed?.(edit);
		const diff = computeLineDiff(before, after);
		const verb = kind === 'delete' ? 'Proposed deletion' : before ? 'Proposed edit' : 'Proposed new file';
		return `${verb} ${full} (+${diff.added} -${diff.removed}). Accept or Reject the inline diff. Nothing is saved yet.`;
	};

	return {
		onTerminalStart: options.onTerminalStart,
		onTerminalOutput: options.onTerminalOutput,
		onTerminalEnd: options.onTerminalEnd,
		async readFile(filePath, workspace) {
			if (isSensitiveWorkspacePath(filePath)) {
				throw new Error('Refused: sensitive file (env / credentials) is hidden and cannot be opened.');
			}
			const full = resolvePath(filePath, workspace);
			const disk = await readDisk(full);
			return edits.read(full, disk);
		},
		async writeFile(filePath, content, workspace) {
			return stage(filePath, workspace, 'write', content);
		},
		async deleteFile(filePath, workspace) {
			return stage(filePath, workspace, 'delete', '');
		},
		async listDir(dirPath, workspace) {
			const full = resolvePath(dirPath || '.', workspace);
			const entries = await fs.readdir(full, { withFileTypes: true });
			return entries
				.filter(entry => !shouldHideWorkspaceEntry(entry.name, entry.isDirectory()))
				.map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));
		},
		async grep(pattern, searchPath, workspace) {
			const root = searchPath ? resolvePath(searchPath, workspace) : workspace;
			return new Promise(resolve => {
				const proc = spawn('rg', ['--no-heading', '--line-number', '--max-count', '80', pattern, root], {
					env: terminalEnv(),
				});
				let out = '';
				proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
				proc.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });
				proc.on('error', () => resolve(out.trim() || 'Install ripgrep (rg) for search'));
				proc.on('close', code => {
					if (code === 0) resolve(out.trim() || 'No matches');
					else if (code === 1) resolve('No matches found');
					else resolve(out.trim() || 'No matches found');
				});
			});
		},
		async createProject(_sessionId, name, description, outputPath): Promise<ProjectCreated> {
			const slug = slugify(name);
			const parent = outputPath ? resolvePath(outputPath, os.homedir()) : os.homedir();
			let dest = path.join(parent, slug);
			let n = 1;
			const base = dest;
			while (fsSync.existsSync(dest) && fsSync.readdirSync(dest).filter(entry => entry !== '.DS_Store').length > 0) {
				dest = `${base}-${n++}`;
			}
			await fs.mkdir(dest, { recursive: true });
			const title = name.trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) || path.basename(dest);
			const readmePath = path.join(dest, 'README.md');
			if (!fsSync.existsSync(readmePath)) {
				const readme = `# ${title}\n\n${description?.trim() || 'Created by Copix agent.'}\n`;
				await fs.writeFile(readmePath, readme, 'utf8');
			}
			await new Promise<void>(resolve => {
				const proc = spawn('git', ['init'], { cwd: dest });
				proc.on('close', () => resolve());
				proc.on('error', () => resolve());
			});
			const tree = await fs.readdir(dest);
			return { root: dest, tree };
		},
		async runTerminal(command, workspace, cwd, elevate, streamId) {
			const wantsElevate = elevate || /\b(sudo|brew\s+install|winget\s+install)\b/i.test(command);
			if (wantsElevate && options.confirmElevate) {
				const ok = await options.confirmElevate(command);
				if (!ok) return 'User declined elevated command';
			}
			const workDir = cwd ? resolvePath(cwd, workspace) : workspace;
			if (process.platform === 'darwin' && /\bapt(-get)?\b|\byum\b|\bdnf\b/i.test(command)) {
				return 'Blocked: Linux package managers (apt/yum/dnf) are not available on macOS. Use Homebrew, e.g. `brew install node`.';
			}
			const emit = (chunk: string) => options.onTerminalOutput?.(streamId, chunk);
			return new Promise(resolve => {
				const isWin = process.platform === 'win32';
				const proc = isWin
					? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { cwd: workDir, env: terminalEnv() })
					: spawn(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash', ['-lc', command], { cwd: workDir, env: terminalEnv() });
				let out = '';
				proc.stdout?.on('data', (chunk: Buffer) => {
					const text = chunk.toString();
					out += text;
					emit(text);
				});
				proc.stderr?.on('data', (chunk: Buffer) => {
					const text = chunk.toString();
					out += text;
					emit(text);
				});
				proc.on('error', err => resolve(err.message));
				proc.on('close', code => resolve(out.trim() || `(exit ${code ?? 0})`));
				setTimeout(() => {
					proc.kill();
					resolve(out.trim() || '(timeout 120s)');
				}, 120_000);
			});
		},
	};
}
