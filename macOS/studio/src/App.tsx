import { useCallback, useEffect, useMemo, useState } from 'react';
import { copix } from './api';
import { ChatCenter } from './components/ChatCenter';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { EditorArea, type SidePanelMode } from './components/EditorArea';
import { ResizableLayout } from './components/ResizableLayout';
import { Sidebar } from './components/Sidebar';
import { SubagentDock } from './components/SubagentDock';
import { StatusBar } from './components/StatusBar';
import { ToastProvider } from './components/Toast';
import { loadSessions, mergeSessionStores, newSession, saveSessions, syncSessionsFromDisk, updateSession, clearAllChatData, ChatSession, titleFromMessage } from './hooks/chatSessions';
import { DEFAULT_SETTINGS, AppSettings } from './types';
import { inferWorkspaceEnv } from './models/agentModes';
import { resolveModelConfig } from './models/config';
import { normalizeProvider } from './models/modelCatalog';
import { formatModelChipLabel, preferredModelForTask } from './models/modelSelector';
import { TitleBarMenu } from './components/TitleBarMenu';
import { Onboarding } from './components/Onboarding';
import { OnboardingPreview } from './components/OnboardingPreview';
import { SettingsPanel } from './components/SettingsPanel';
import { clearOnboardingDoneLocally, markOnboardingDoneLocally, onboardingDoneLocally } from './onboarding/flags';
import { collectSessionChanges, type FileChange } from './utils/fileChanges';
import { subscribeAgentTerminal } from './utils/terminalBridge';
import { isMac } from './utils/platform';
import type { AppLanguage, ModelProvider, ThemePreference } from './types';

async function ensureWorkspace(session: ChatSession): Promise<ChatSession> {
	const normalized = session.workspaceRoot?.replace(/\\/g, '/') ?? '';
	const leaf = normalized.split('/').filter(Boolean).pop() ?? '';
	const isLegacySandbox = /\/\.copix\/sessions\//i.test(normalized)
		|| /\/agent-workspaces\//i.test(normalized)
		|| /^agent-\d+$/i.test(leaf);
	const sandboxTitle = !session.title?.trim()
		|| session.title === 'New agent'
		|| /^agent-\d+/i.test(session.title);
	if (session.workspaceRoot && !isLegacySandbox) {
		if (!sandboxTitle) return session;
		const homeLeaf = session.workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop();
		return homeLeaf && homeLeaf !== session.title
			? { ...session, title: homeLeaf }
			: session;
	}
	// New agents (and old session sandboxes) use the user home so the whole machine is reachable.
	const ws = await copix.createSessionWorkspace(session.id);
	const homeLeaf = ws.root.replace(/\\/g, '/').split('/').filter(Boolean).pop();
	return {
		...session,
		workspaceRoot: ws.root,
		...(sandboxTitle && homeLeaf ? { title: homeLeaf } : {}),
	};
}

function AppInner() {
	const bootMode = useMemo(
		() => new URLSearchParams(window.location.search).get('mode'),
		[],
	);
	const [sessions, setSessions] = useState<ChatSession[]>(() => {
		const wipeKey = 'copix.agents.wiped.v2026-07-11';
		if (!localStorage.getItem(wipeKey)) {
			clearAllChatData();
			localStorage.setItem(wipeKey, '1');
		}
		const loaded = loadSessions();
		if (loaded.length) return loaded;
		const fresh = newSession();
		saveSessions([fresh]);
		return [fresh];
	});
	const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id ?? '');
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
	const [settingsReady, setSettingsReady] = useState(false);
	const [providerKey, setProviderKey] = useState('');
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
	const [tree, setTree] = useState<string[]>([]);
	const [serverOnline, setServerOnline] = useState(false);
	const [installedModels, setInstalledModels] = useState<string[]>([]);
	const [editorVisible, setEditorVisible] = useState(true);
	const [panelMode, setPanelMode] = useState<SidePanelMode>('hub');
	const [reviewFiles, setReviewFiles] = useState<FileChange[] | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);

	const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0];
	const workspace = activeSession?.workspaceRoot;
	const subagentSessions = useMemo(
		() => sessions.filter(s =>
			s.parentSessionId && !s.archived && !s.subagentDismissed && s.id !== activeSessionId,
		),
		[sessions, activeSessionId],
	);
	const fileChanges = useMemo(
		() => collectSessionChanges(activeSession?.messages ?? []),
		[activeSession?.messages],
	);
	const displayedFileChanges = reviewFiles ?? fileChanges;
	const liveSettings = useMemo(() => ({
		...settings,
		model: { ...settings.model, apiKey: providerKey },
	}), [settings, providerKey]);
	const statusBarModel = formatModelChipLabel(
		liveSettings.model,
		resolveModelConfig(liveSettings.model, settings.agentMode, installedModels).model,
		{
			preferred: preferredModelForTask(settings.agentMode, liveSettings.model),
			installed: installedModels,
		},
	);
	const modelProvider = normalizeProvider(liveSettings.model.provider);
	const resolvedTheme: 'light' | 'dark' = settings.theme === 'system'
		? (systemDark ? 'dark' : 'light')
		: settings.theme;

	useEffect(() => { setReviewFiles(null); }, [activeSessionId]);

	useEffect(() => {
		return subscribeAgentTerminal(event => {
			if (event.type === 'start') {
				setEditorVisible(true);
				setPanelMode('terminal');
			}
		});
	}, []);

	useEffect(() => {
		if (bootMode === 'editor') {
			setEditorVisible(true);
			setPanelMode('files');
			setSettings(prev => ({ ...prev, layout: { ...prev.layout, editorWidth: 640 } }));
		}
	}, [bootMode]);

	useEffect(() => { saveSessions(sessions); }, [sessions]);

	// Merge CLI history (~/Copix/sessions.json) on launch and whenever the window refocuses.
	useEffect(() => {
		let cancelled = false;
		const sync = () => {
			setSessions(prev => {
				syncSessionsFromDisk(prev).then(merged => {
					if (!cancelled && merged) {
						setSessions(cur => {
							const again = mergeSessionStores(cur, merged);
							return JSON.stringify(again) === JSON.stringify(cur) ? cur : again;
						});
					}
				});
				return prev;
			});
		};
		sync();
		window.addEventListener('focus', sync);
		return () => {
			cancelled = true;
			window.removeEventListener('focus', sync);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		copix.getSettings().then(s => {
			if (cancelled) return;
			if (!s || ('presetId' in (s as object))) {
				setSettings(DEFAULT_SETTINGS);
				setSettingsReady(true);
				return;
			}
			const raw = s as AppSettings & { model?: Partial<AppSettings['model']> };
			const providerRaw = raw.model?.provider;
			const provider: ModelProvider = providerRaw === 'openrouter' || providerRaw === 'groq' || providerRaw === 'openai' || providerRaw === 'ollama'
				? providerRaw
				: 'ollama';
			const rawModelId = raw.model?.modelId ?? DEFAULT_SETTINGS.model.modelId;
			const looksCloudModel = /^(~?anthropic\/|openai\/|google\/|meta-llama\/|llama-3\.|gpt-|o3)/i.test(rawModelId);
			const modelId = provider === 'ollama' && looksCloudModel ? DEFAULT_SETTINGS.model.modelId : rawModelId;
			const theme: ThemePreference = raw.theme === 'light' || raw.theme === 'system' || raw.theme === 'dark' ? raw.theme : 'dark';
			const language: AppLanguage = raw.language === 'ko' ? 'ko' : 'en';
			setSettings({
				...DEFAULT_SETTINGS, ...raw,
				model: {
					...DEFAULT_SETTINGS.model,
					...raw.model,
					selection: raw.model?.selection === 'manual' ? 'manual' : 'auto',
					modelId,
					provider,
					apiKey: '',
				},
				layout: { ...DEFAULT_SETTINGS.layout, ...raw.layout },
				workspace: {
					...DEFAULT_SETTINGS.workspace,
					...raw.workspace,
					homeDirectory: /copix-output/i.test(raw.workspace?.homeDirectory ?? '')
						? ''
						: (raw.workspace?.homeDirectory ?? DEFAULT_SETTINGS.workspace.homeDirectory),
				},
				theme,
				language,
				onboardingCompleted: raw.onboardingCompleted === true || onboardingDoneLocally(),
			});
			setSettingsReady(true);
		}).catch(() => { if (!cancelled) setSettingsReady(true); });
		if (window.copix?.getProviderSecret) {
			void window.copix.getProviderSecret().then(key => {
				if (!cancelled && typeof key === 'string') setProviderKey(key);
			}).catch(() => undefined);
		}
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		if (!settingsReady) return;
		void copix.setSettings({ ...settings, model: { ...settings.model, apiKey: '' } });
		try { localStorage.setItem('copix.theme', settings.theme); } catch { /* ignore */ }
	}, [settings, settingsReady]);

	useEffect(() => {
		const apply = () => {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			setSystemDark(prefersDark);
			const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
			document.documentElement.dataset.theme = dark ? 'dark' : 'light';
			document.documentElement.lang = settings.language === 'ko' ? 'ko' : 'en';
			void window.copix?.setNativeTheme?.(settings.theme);
		};
		apply();
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	}, [settings.theme, settings.language]);

	useEffect(() => {
		const poll = () => copix.getServerStatus().then(s => {
			setServerOnline(s.online);
			setInstalledModels(s.models ?? []);
		});
		poll();
		const t = setInterval(poll, 4000);
		return () => clearInterval(t);
	}, []);

	useEffect(() => {
		if (!activeSession) return;
		(async () => {
			let s = activeSession;
			if (!s.workspaceRoot) {
				const updated = await ensureWorkspace(s);
				setSessions(prev => updateSession(prev, s.id, { workspaceRoot: updated.workspaceRoot }));
				s = updated;
			}
			if (s.workspaceRoot) {
				const ws = await copix.getWorkspace(s.workspaceRoot);
				if (ws) setTree(ws.tree);
			}
		})();
	}, [activeSessionId]);

	const patchSession = useCallback((id: string, patch: Partial<ChatSession>) => {
		setSessions(prev => updateSession(prev, id, patch));
	}, []);

	const refreshWorkspace = useCallback(async (root: string) => {
		const ws = await copix.getWorkspace(root);
		if (ws) setTree(ws.tree);
		patchSession(activeSessionId, { workspaceRoot: root });
	}, [activeSessionId, patchSession]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
				e.preventDefault();
				document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || (e.shiftKey && e.key.toLowerCase() === 'p'))) {
				e.preventDefault();
				setPaletteOpen(open => !open);
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
				e.preventDefault();
				setEditorVisible(v => !v);
			}
			const tab = activeSession?.tabs.find(t => t.path === activeSession.activePath);
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && tab && workspace) {
				e.preventDefault();
				copix.writeFile(tab.path, tab.content, workspace).then(() => {
					patchSession(activeSessionId, {
						tabs: activeSession.tabs.map(t => t.path === tab.path ? { ...t, dirty: false } : t),
					});
				});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeSession, activeSessionId, patchSession, workspace]);

	const openFolder = async () => {
		const r = await copix.openFolder(activeSessionId);
		if (!r) return;
		const url = await copix.getRepoRemote(r.root);
		patchSession(activeSessionId, {
			workspaceRoot: r.root,
			repoUrl: url,
			workspaceEnv: inferWorkspaceEnv(url, true),
			tabs: [], activePath: undefined,
		});
		setTree(r.tree);
	};

	const cloneRepo = async (url: string) => {
		const r = await copix.cloneRepo(url, activeSessionId);
		if (!r) return;
		patchSession(activeSessionId, {
			workspaceRoot: r.root,
			repoUrl: url,
			workspaceEnv: inferWorkspaceEnv(url, true),
			tabs: [], activePath: undefined,
		});
		setTree(r.tree);
	};

	const openFile = async (path: string) => {
		if (!workspace || !activeSession) return;
		if (activeSession.tabs.find(t => t.path === path)) {
			patchSession(activeSessionId, { activePath: path });
			return;
		}
		const content = await copix.readFile(path, workspace);
		patchSession(activeSessionId, {
			tabs: [...activeSession.tabs, { path, content, dirty: false }],
			activePath: path,
		});
	};

	const handleNewChat = async () => {
		const s = newSession();
		const withWs = await ensureWorkspace(s);
		const folder = withWs.workspaceRoot
			? withWs.workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()
			: undefined;
		const session = {
			...withWs,
			title: folder || withWs.title || 'New agent',
			workspaceEnv: withWs.workspaceEnv ?? 'desktop' as const,
			messages: [],
			tabs: [],
		};
		setSessions(prev => [session, ...prev]);
		setActiveSessionId(session.id);
		setTree([]);
		if (withWs.workspaceRoot) {
			const ws = await copix.getWorkspace(withWs.workspaceRoot);
			if (ws) setTree(ws.tree);
		}
	};

	const handleSpawnSubagent = useCallback(async (prompt: string, label?: string): Promise<{ sessionId: string }> => {
		const parent = sessions.find(s => s.id === activeSessionId);
		const base = newSession();
		const withWs = parent?.workspaceRoot
			? { ...base, workspaceRoot: parent.workspaceRoot, workspaceEnv: parent.workspaceEnv }
			: await ensureWorkspace(base);
		const session: ChatSession = {
			...withWs,
			title: label?.trim() || titleFromMessage(prompt),
			parentSessionId: parent?.id,
			pendingPrompt: prompt.trim(),
			messages: [],
			tabs: [],
		};
		setSessions(prev => [session, ...prev]);
		return { sessionId: session.id };
	}, [sessions, activeSessionId]);

	const ensureActiveSession = useCallback((next: ChatSession[]) => {
		if (next.some(s => s.id === activeSessionId)) return;
		const fallback = next.find(s => !s.archived) ?? next[0];
		if (fallback) setActiveSessionId(fallback.id);
	}, [activeSessionId]);

	const togglePinSession = useCallback((id: string) => {
		setSessions(prev => {
			const next = prev.map(s => (s.id === id ? { ...s, pinned: !s.pinned } : s));
			return next;
		});
	}, []);

	const archiveSession = useCallback((id: string) => {
		setSessions(prev => {
			const next = prev.map(s => (s.id === id ? { ...s, archived: true, pinned: false } : s));
			ensureActiveSession(next);
			return next;
		});
	}, [ensureActiveSession]);

	const restoreSession = useCallback((id: string) => {
		setSessions(prev => prev.map(s => (s.id === id ? { ...s, archived: false } : s)));
	}, []);

	const deleteSession = useCallback((id: string) => {
		setSessions(prev => {
			const next = prev.filter(s => s.id !== id);
			if (next.length === 0) {
				const fresh = newSession();
				void ensureWorkspace(fresh).then(withWs => {
					setSessions([withWs]);
				});
				setActiveSessionId(fresh.id);
				return [fresh];
			}
			ensureActiveSession(next);
			return next;
		});
	}, [ensureActiveSession]);

	const workspaceEnv = activeSession?.workspaceEnv
		?? inferWorkspaceEnv(activeSession?.repoUrl, Boolean(workspace));

	const focusComposer = () => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();

	useEffect(() => {
		const stop = copix.onMenuAction?.(action => {
			switch (action) {
				case 'new-agent':
					void handleNewChat();
					break;
				case 'open-folder':
					void openFolder();
					break;
				case 'clone-repo': {
					const url = window.prompt('Repository URL to clone');
					if (url?.trim()) void cloneRepo(url.trim());
					break;
				}
				case 'command-palette':
					setPaletteOpen(true);
					break;
				case 'toggle-editor':
					setEditorVisible(v => !v);
					break;
				case 'focus-agent':
					focusComposer();
					break;
				case 'open-settings':
					setSettingsOpen(true);
					break;
				default:
					break;
			}
		});
		return () => { stop?.(); };
		// Menu bridge — rebind when session helpers change
	}, [activeSessionId, sessions]);

	const paletteCommands: PaletteCommand[] = [
		{ id: 'new-agent', label: 'New Agent', hint: 'Agent', category: 'actions', run: handleNewChat },
		{ id: 'focus-agent', label: 'Focus Agent Input', hint: 'Ctrl+L', category: 'actions', run: focusComposer },
		{ id: 'toggle-editor', label: editorVisible ? 'Hide Editor Panel' : 'Show Editor Panel', hint: 'Ctrl+B', category: 'actions', run: () => setEditorVisible(v => !v) },
		{ id: 'open-folder', label: 'Open Folder…', hint: 'Files', category: 'files', run: openFolder },
		{ id: 'settings', label: 'Settings…', hint: 'CmdOrCtrl+,', category: 'actions', run: () => setSettingsOpen(true) },
		{ id: 'clone-repo', label: 'Clone Repository…', hint: 'Git URL', category: 'files', run: () => {
			const url = window.prompt('Repository URL');
			if (url?.trim()) void cloneRepo(url.trim());
		} },
	];

	const editorPane = (
		<EditorArea
			tabs={activeSession?.tabs ?? []}
			activePath={activeSession?.activePath}
			fileChanges={displayedFileChanges}
			mode={bootMode === 'editor' ? 'files' : panelMode}
			onModeChange={setPanelMode}
			onSelect={path => patchSession(activeSessionId, { activePath: path })}
			onClose={path => {
				const next = (activeSession?.tabs ?? []).filter(t => t.path !== path);
				patchSession(activeSessionId, {
					tabs: next,
					activePath: activeSession?.activePath === path ? next[next.length - 1]?.path : activeSession?.activePath,
				});
			}}
			onChange={(path, content) => {
				patchSession(activeSessionId, {
					tabs: (activeSession?.tabs ?? []).map(t => t.path === path ? { ...t, content, dirty: true } : t),
				});
			}}
			onOpenFile={path => {
				setPanelMode('files');
				void openFile(path);
			}}
			workspace={workspace}
			tree={tree}
			theme={resolvedTheme}
			onNewAgent={handleNewChat}
			onOpenFolder={async () => {
				await openFolder();
				setPanelMode('files');
			}}
			onFocusComposer={focusComposer}
			onTogglePanel={() => setEditorVisible(v => !v)}
			onExpandPanel={() => setSettings(prev => ({
				...prev,
				layout: { ...prev.layout, editorWidth: 640 },
			}))}
		/>
	);

	const showWizard = settingsReady
		&& bootMode !== 'editor'
		&& !settings.onboardingCompleted
		&& !onboardingDoneLocally();
	const wizardProvider = settings.model.provider === 'openrouter' ? 'openrouter' : 'ollama';

	const rememberKey = async (key: string) => {
		if (!window.copix?.setProviderSecret) {
			return { ok: false, message: 'Secure storage is unavailable' };
		}
		const result = await window.copix.setProviderSecret(key);
		if (result.ok) setProviderKey(key.trim());
		return result;
	};

	const finishOnboarding = (prompt?: string) => {
		markOnboardingDoneLocally();
		setSettings(prev => ({ ...prev, onboardingCompleted: true }));
		if (prompt) patchSession(activeSessionId, { pendingPrompt: prompt });
	};

	const setupUi = (
		<>
			{showWizard && (
				<Onboarding
					language={settings.language}
					theme={settings.theme}
					provider={wizardProvider}
					model={settings.model}
					hasStoredKey={providerKey.trim().length > 0}
					onLanguage={language => setSettings(prev => ({ ...prev, language }))}
					onTheme={theme => setSettings(prev => ({ ...prev, theme }))}
					onProvider={provider => setSettings(prev => ({
						...prev,
						model: { ...prev.model, provider, apiKey: '' },
					}))}
					onModel={model => setSettings(prev => ({ ...prev, model: { ...model, apiKey: '' } }))}
					onSaveKey={rememberKey}
					onComplete={prompt => finishOnboarding(prompt)}
					onSkip={() => finishOnboarding()}
				/>
			)}
			{settingsOpen && (
				<SettingsPanel
					language={settings.language}
					theme={settings.theme}
					provider={settings.model.provider ?? 'ollama'}
					model={settings.model}
					hasStoredKey={providerKey.trim().length > 0}
					onLanguage={language => setSettings(prev => ({ ...prev, language }))}
					onTheme={theme => setSettings(prev => ({ ...prev, theme }))}
					onProvider={provider => setSettings(prev => ({
						...prev,
						model: { ...prev.model, provider, apiKey: '' },
					}))}
					onModel={model => setSettings(prev => ({ ...prev, model: { ...model, apiKey: '' } }))}
					onSaveKey={rememberKey}
					onRunSetup={() => {
						clearOnboardingDoneLocally();
						setSettings(prev => ({ ...prev, onboardingCompleted: false }));
						setSettingsOpen(false);
					}}
					onClose={() => setSettingsOpen(false)}
				/>
			)}
		</>
	);

	if (bootMode === 'editor') {
		return (
			<div className="shell ide-shell">
				<header className={`titlebar${isMac() ? ' titlebar-mac' : ''}`}>
					{!isMac() && <span className="titlebar-title">Copix IDE</span>}
					<span className="titlebar-drag" />
					<span className="titlebar-title">{workspace?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Editor'}</span>
				</header>
				<div className="ide-editor-body">
					{editorPane}
				</div>
				<StatusBar
					workspace={workspace}
					model={statusBarModel}
					provider={modelProvider}
					online={serverOnline}
				/>
				{setupUi}
			</div>
		);
	}

	return (
		<div className="shell">
			<header className={`titlebar${isMac() ? ' titlebar-mac' : ''}`}>
				{!isMac() && (
					<>
						<img src="./favicon.png" alt="" className="titlebar-logo" draggable={false} />
						<TitleBarMenu
							onNewAgent={handleNewChat}
							onOpenFolder={openFolder}
							onCloneRepo={() => {
								const url = window.prompt('Repository URL to clone');
								if (url?.trim()) void cloneRepo(url.trim());
							}}
							onToggleEditor={() => setEditorVisible(v => !v)}
							onOpenPalette={() => setPaletteOpen(true)}
							onOpenSettings={() => setSettingsOpen(true)}
						/>
					</>
				)}
				<span className="titlebar-drag" />
				{!isMac() && <span className="titlebar-title">Copix</span>}
			</header>

			<div className="shell-body">
				<ResizableLayout
				sidebarWidth={settings.layout.sidebarWidth}
				editorWidth={settings.layout.editorWidth}
				editorVisible={editorVisible}
				onResize={(sidebar, editor) => setSettings(prev => ({
					...prev, layout: { sidebarWidth: sidebar, editorWidth: editor },
				}))}
				sidebar={
					<Sidebar
						sessions={sessions}
						activeId={activeSessionId}
						workspace={workspace}
						workspaceEnv={workspaceEnv}
						repoUrl={activeSession?.repoUrl}
						serverOnline={serverOnline}
						onSelectSession={setActiveSessionId}
						onNewChat={handleNewChat}
						onOpenFolder={openFolder}
						onCloneRepo={cloneRepo}
						onOpenPalette={() => setPaletteOpen(true)}
						onTogglePinSession={togglePinSession}
						onArchiveSession={archiveSession}
						onDeleteSession={deleteSession}
						onRestoreSession={restoreSession}
						onOpenSettings={() => setSettingsOpen(true)}
					/>
				}
				chat={
					<div className="chat-pane">
					<ChatCenter
						sessionId={activeSessionId}
						workspace={workspace}
						workspaceEnv={workspaceEnv}
						settings={liveSettings}
						tree={tree}
						messages={activeSession?.messages ?? []}
						onMessagesChange={(msgs, title) =>
							patchSession(activeSessionId, { messages: msgs, ...(title ? { title } : {}) })}
						onWorkspaceChange={refreshWorkspace}
						onOpenFile={path => {
							setEditorVisible(true);
							setPanelMode('files');
							void openFile(path);
						}}
						onReviewFiles={(files) => {
							setReviewFiles(files);
							setEditorVisible(true);
							setPanelMode('changes');
						}}
						onSpawnSubagent={handleSpawnSubagent}
						pendingPrompt={activeSession?.pendingPrompt}
						onPendingPromptConsumed={() => patchSession(activeSessionId, { pendingPrompt: undefined })}
						onModelSettingsChange={model => setSettings(prev => ({ ...prev, model }))}
					/>
					<SubagentDock
						sessions={subagentSessions}
						settings={liveSettings}
						installedModels={installedModels}
						serverOnline={serverOnline}
						onMessagesChange={(id, msgs, title) =>
							patchSession(id, { messages: msgs, ...(title ? { title } : {}) })}
						onPendingPromptConsumed={id => patchSession(id, { pendingPrompt: undefined })}
						onDismiss={id => patchSession(id, { subagentDismissed: true })}
						onExpand={id => setActiveSessionId(id)}
						onSpawnSubagent={handleSpawnSubagent}
					/>
					</div>
				}
				editor={editorPane}
				/>
			</div>

			<StatusBar
				workspace={workspace}
				model={statusBarModel}
				provider={modelProvider}
				online={serverOnline}
			/>

			<CommandPalette
				open={paletteOpen}
				commands={paletteCommands}
				recentAgents={sessions
					.filter(s => !s.archived && !s.parentSessionId)
					.slice(0, 8)
					.map(s => ({
						id: s.id,
						label: s.title || 'New agent',
						repo: s.workspaceRoot?.replace(/\\/g, '/').split('/').filter(Boolean).pop(),
						time: 'recent',
						run: () => setActiveSessionId(s.id),
					}))}
				onClose={() => setPaletteOpen(false)}
			/>
			{setupUi}
		</div>
	);
}

export default function App() {
	const preview = new URLSearchParams(window.location.search).get('onboardingPreview') === '1';
	if (preview) {
		return <OnboardingPreview />;
	}
	return (
		<ToastProvider>
			<AppInner />
		</ToastProvider>
	);
}
