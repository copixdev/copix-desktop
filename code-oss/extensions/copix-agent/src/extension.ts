import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EditSession } from './edits';
import { watchEditorBlur, historyMirror } from './editorGuard';
import type { ChatSession } from './editorState';
import { mergeSessionStores } from './editorState';
import { setCopixHost } from './host';
import { absorbPlainProviderKey, stringifySettings } from './providerSecret';
import { applyPerformance, isTightRam, recommendedModel } from './recommend';
import type { ModelProvider, ModelSettings } from './types';
import { normalizeProvider } from './models/modelCatalog';
import { FALLBACK_MODEL_ID, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FEATURED_MODELS } from './models/modelCatalog';
import { checkModelHealth, resolveModelConfig } from './models/config';
import { createWorkspaceHost } from './workspaceHost';
import { acceptEdit, openInlineDiff, registerDiffProviders, rejectEdit } from './diffView';
import { ChatViewProvider, type ChatHost } from './chatView';

const SECRET_KEY = 'copix.openrouter.apiKey';

interface StoredSettings {
	model: ModelSettings;
	agentMode: 'plan' | 'code' | 'debug' | 'terminal';
}

let sessions: ChatSession[] = [];
let abort: AbortController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const edits = new EditSession();
	const settings = await loadSettings(context);
	const state = { settings, ollama: 'checking…' };

	const modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	modelItem.name = 'Copix model';
	modelItem.command = 'copix.model.pick';
	const ollamaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	ollamaItem.name = 'Ollama';
	ollamaItem.command = 'copix.ollama.check';
	modelItem.show();
	ollamaItem.show();

	let chat: ChatViewProvider | undefined;
	const paint = () => {
		const provider = normalizeProvider(state.settings.model.provider);
		modelItem.text = `${providerLabel(provider)} · ${state.settings.model.modelId}`;
		modelItem.tooltip = 'Copix model';
		const online = state.ollama.startsWith('ready');
		ollamaItem.text = online ? 'Ollama' : 'Ollama offline';
		ollamaItem.tooltip = state.ollama;
		ollamaItem.backgroundColor = online ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
		chat?.postState();
	};

	const host = createWorkspaceHost({
		edits,
		onProposed: edit => {
			void openInlineDiff(edit);
			chat?.post({ type: 'pending', path: edit.path });
		},
		confirmElevate: async command => {
			const answer = await vscode.window.showWarningMessage(`Copix wants to run an elevated command:\n${command}`, { modal: true }, 'Run');
			return answer === 'Run';
		},
		onTerminalOutput: (_id, chunk) => {
			chat?.post({ type: 'tool', text: chunk });
		},
	});
	setCopixHost(host);

	const chatHost: ChatHost = {
		snapshot: () => ({
			provider: providerLabel(normalizeProvider(state.settings.model.provider)),
			model: state.settings.model.modelId,
			ollama: state.ollama,
		}),
		stop: () => abort?.abort(),
		send: async (text, post) => {
			post({ type: 'user', text });
			abort?.abort();
			abort = new AbortController();
			const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
			const apiKey = await context.secrets.get(SECRET_KEY);
			const model = { ...state.settings.model, apiKey: apiKey || undefined };
			const config = resolveModelConfig(model, state.settings.agentMode, [], text);
			try {
				const { runAgent } = await import('./models/router');
				await runAgent(text, config, {
					sessionId: sessions[0]?.id ?? 'copix',
					workspaceRoot: folder,
					onWorkspaceChange: root => {
						void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), false);
					},
				}, sessions[0]?.messages.map(message => ({ role: message.role, content: message.content })) ?? [], abort.signal, {
					onText: chunk => post({ type: 'token', text: chunk }),
					onThinkingStart: () => undefined,
					onThinkingChunk: () => undefined,
					onThinkingEnd: () => undefined,
					onToolStart: (_id, tool) => post({ type: 'tool', text: tool }),
					onToolEnd: (_id, tool, _args, meta) => post({ type: 'tool', text: `${tool}\n${meta.result}` }),
					onStatus: message => post({ type: 'status', text: message }),
					onClearText: () => post({ type: 'replace', text: '' }),
				});
				remember(text);
			} catch (err) {
				const raw = err instanceof Error ? err.message : String(err);
				chat?.postError(raw);
			}
		},
	};

	chat = new ChatViewProvider(context.extensionUri, chatHost);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, { webviewOptions: { retainContextWhenHidden: true } }),
		modelItem,
		ollamaItem,
		...registerDiffProviders(edits),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('copix.edit.accept', async (filePath?: string) => {
			const target = filePath ?? edits.all()[0]?.path;
			if (target) await acceptEdit(edits, target);
		}),
		vscode.commands.registerCommand('copix.edit.reject', async (filePath?: string) => {
			const target = filePath ?? edits.all()[0]?.path;
			if (target) await rejectEdit(edits, target);
		}),
		vscode.commands.registerCommand('copix.model.pick', async () => {
			const picked = await pickModel(state.settings.model);
			if (!picked) return;
			state.settings.model = { ...state.settings.model, ...picked, apiKey: '' };
			await saveSettings(state.settings);
			paint();
		}),
		vscode.commands.registerCommand('copix.provider.choose', async () => {
			const choice = await vscode.window.showQuickPick([
				{ label: 'Ollama', description: 'Local and private', provider: 'ollama' as const },
				{ label: 'OpenRouter', description: 'Cloud models. The key stays in the system keychain.', provider: 'openrouter' as const },
			], { placeHolder: 'Where should Copix run?' });
			if (!choice) return;
			state.settings.model.provider = choice.provider;
			state.settings.model.apiKey = '';
			if (choice.provider === 'openrouter' && !state.settings.model.modelId.includes('/')) {
				state.settings.model.modelId = OPENROUTER_DEFAULT_MODEL;
			}
			if (choice.provider === 'ollama') state.settings.model.modelId = state.settings.model.modelId || FALLBACK_MODEL_ID;
			await saveSettings(state.settings);
			if (choice.provider === 'openrouter') await vscode.commands.executeCommand('copix.openRouter.setKey');
			paint();
		}),
		vscode.commands.registerCommand('copix.openRouter.setKey', async () => {
			const key = await vscode.window.showInputBox({
				title: 'OpenRouter API key',
				prompt: 'Stored in the system keychain, not in the settings file.',
				password: true,
				ignoreFocusOut: true,
			});
			if (key === undefined) return;
			if (key.trim()) await context.secrets.store(SECRET_KEY, key.trim());
			else await context.secrets.delete(SECRET_KEY);
			state.settings.model.apiKey = '';
			await saveSettings(state.settings);
			void vscode.window.showInformationMessage(key.trim() ? 'Saved in the system keychain.' : 'OpenRouter key removed.');
		}),
		vscode.commands.registerCommand('copix.ollama.check', () => refreshOllama()),
		vscode.commands.registerCommand('copix.welcome.show', () => vscode.commands.executeCommand(
			'workbench.action.openWalkthrough',
			'copix.copix-agent#copix.firstRun',
			false,
		)),
		vscode.commands.registerCommand('copix.agent.newChat', async () => {
			sessions = [{ id: `agent-${Date.now()}`, createdAt: Date.now(), messages: [], tabs: [], title: 'agent' }];
			await persistSessions();
			await vscode.commands.executeCommand('copix.agent.chat.focus');
		}),
		vscode.commands.registerCommand('copix.workspace.sync', async () => {
			await persistSessions();
			void vscode.window.showInformationMessage('Workspace history synced. Open editors were kept.');
		}),
		vscode.commands.registerCommand('copix.settings.open', () => vscode.commands.executeCommand('workbench.action.openSettings', 'Copix')),
	);

	registerActivityTrees(context);
	watchEditorBlur(context, () => sessions, next => {
		sessions = next;
		void persistSessions();
	});
	context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
		if (state.focused) void mergeDiskHistory();
	}));

	paint();
	await refreshOllama();
	const timer = setInterval(() => { void refreshOllama(); }, 20_000);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
	if (!context.globalState.get('copix.chatDocked')) {
		await context.globalState.update('copix.chatDocked', true);
		void vscode.commands.executeCommand('copix.agent.chat.focus');
	}

	async function refreshOllama(): Promise<void> {
		const provider = normalizeProvider(state.settings.model.provider);
		const apiKey = provider === 'ollama' ? undefined : await context.secrets.get(SECRET_KEY);
		const health = await checkModelHealth(resolveModelConfig(
			{ ...state.settings.model, apiKey: apiKey || undefined },
			state.settings.agentMode,
		));
		state.ollama = provider === 'ollama'
			? (health.ok ? `ready · ${state.settings.model.modelId}` : health.message)
			: (health.ok ? `ready · ${providerLabel(provider)}` : health.message);
		paint();
	}

	function remember(text: string): void {
		if (!sessions.length) {
			sessions = [{ id: `agent-${Date.now()}`, createdAt: Date.now(), messages: [], tabs: [], title: 'agent' }];
		}
		const live = sessions[0];
		if (!live) return;
		live.messages.push({ id: `m-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() });
		live.updatedAt = Date.now();
		void persistSessions();
	}

	async function persistSessions(): Promise<void> {
		const dir = path.join(os.homedir(), 'Copix');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'sessions.json'), historyMirror(sessions), 'utf8');
		await context.globalState.update('copix.sessions', sessions);
	}

	async function mergeDiskHistory(): Promise<void> {
		try {
			const raw = await fs.readFile(path.join(os.homedir(), 'Copix', 'sessions.json'), 'utf8');
			const disk = JSON.parse(raw) as ChatSession[];
			if (!Array.isArray(disk)) return;
			sessions = mergeSessionStores(sessions, disk);
		} catch {
			/* no mirror yet */
		}
	}
}

export function deactivate(): void {
	abort?.abort();
}

function providerLabel(provider: ModelProvider): string {
	if (provider === 'openrouter') return 'OpenRouter';
	if (provider === 'groq') return 'Groq';
	if (provider === 'openai') return 'OpenAI';
	return 'Ollama';
}

async function loadSettings(context: vscode.ExtensionContext): Promise<StoredSettings> {
	const file = path.join(os.homedir(), 'Copix', 'settings.json');
	let parsed: StoredSettings = {
		model: { provider: 'ollama', apiKey: '', selection: 'auto', modelId: FALLBACK_MODEL_ID, lowVram: false },
		agentMode: 'code',
	};
	try {
		parsed = { ...parsed, ...JSON.parse(await fs.readFile(file, 'utf8')) as StoredSettings };
	} catch {
		/* first launch */
	}
	const absorbed = absorbPlainProviderKey(parsed);
	if (absorbed.apiKey) await context.secrets.store(SECRET_KEY, absorbed.apiKey);
	const ramGb = os.totalmem() / (1024 ** 3);
	if (isTightRam(ramGb) && !context.globalState.get('copix.perfApplied')) {
		const modelId = recommendedModel(ramGb).id;
		parsed = {
			...parsed,
			model: applyPerformance((absorbed.settings as StoredSettings).model ?? parsed.model, ramGb, os.cpus().length, modelId),
		};
		await context.globalState.update('copix.perfApplied', true);
	} else if (absorbed.changed) {
		parsed = absorbed.settings as StoredSettings;
	}
	parsed.model.apiKey = '';
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, stringifySettings(parsed), 'utf8');
	const stored = context.globalState.get<ChatSession[]>('copix.sessions');
	sessions = stored?.length ? stored : [{ id: 'copix', createdAt: Date.now(), messages: [], tabs: [], title: 'agent' }];
	return parsed;
}

async function saveSettings(settings: StoredSettings): Promise<void> {
	const file = path.join(os.homedir(), 'Copix', 'settings.json');
	settings.model.apiKey = '';
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, stringifySettings(settings), 'utf8');
}

async function pickModel(current: ModelSettings): Promise<Partial<ModelSettings> | undefined> {
	const installed = await ollamaModels();
	const items: Array<vscode.QuickPickItem & Partial<ModelSettings>> = [
		...installed.map(id => ({ label: id, description: 'Ollama', provider: 'ollama' as const, modelId: id })),
		...OPENROUTER_FEATURED_MODELS.map(model => ({
			label: model.label,
			description: `OpenRouter · ${model.detail}`,
			provider: 'openrouter' as const,
			modelId: model.id,
		})),
	];
	if (!items.length) {
		items.push({ label: FALLBACK_MODEL_ID, description: 'Ollama', provider: 'ollama', modelId: FALLBACK_MODEL_ID });
	}
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: current.modelId,
	});
	if (!picked?.modelId || !picked.provider) return undefined;
	return { provider: picked.provider, modelId: picked.modelId, apiKey: '' };
}

async function ollamaModels(): Promise<string[]> {
	try {
		const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
		if (!response.ok) return [];
		const data = await response.json() as { models?: Array<{ name: string }> };
		return (data.models ?? []).map(model => model.name);
	} catch {
		return [];
	}
}

function registerActivityTrees(context: vscode.ExtensionContext): void {
	const agent = new StaticTree(['Open chat']);
	const settings = new StaticTree(['Settings', 'Run setup again', 'Provider', 'OpenRouter key']);
	const agentView = vscode.window.createTreeView('copix.agent.link', { treeDataProvider: agent });
	const settingsView = vscode.window.createTreeView('copix.settings', { treeDataProvider: settings });
	context.subscriptions.push(agentView, settingsView);
	context.subscriptions.push(agentView.onDidChangeVisibility(event => {
		if (event.visible) void vscode.commands.executeCommand('copix.agent.chat.focus');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('copix.activity.open', (label: string) => {
		if (label === 'Settings') return vscode.commands.executeCommand('copix.settings.open');
		if (label === 'Run setup again') return vscode.commands.executeCommand('copix.welcome.show');
		if (label === 'Provider') return vscode.commands.executeCommand('copix.provider.choose');
		if (label === 'OpenRouter key') return vscode.commands.executeCommand('copix.openRouter.setKey');
		return vscode.commands.executeCommand('copix.agent.chat.focus');
	}));
}

class StaticTree implements vscode.TreeDataProvider<string> {
	constructor(private readonly labels: string[]) {}
	getTreeItem(element: string): vscode.TreeItem {
		const item = new vscode.TreeItem(element);
		item.command = { command: 'copix.activity.open', title: element, arguments: [element] };
		return item;
	}
	getChildren(): string[] {
		return this.labels;
	}
}
