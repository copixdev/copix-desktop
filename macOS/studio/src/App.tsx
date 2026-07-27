import { useCallback, useEffect, useMemo, useState } from 'react';
import { copix } from './api';
import { ActivityRail } from './components/ActivityRail';
import { ChatCenter } from './components/ChatCenter';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { EditorArea, type SidePanelMode } from './components/EditorArea';
import { ModelSetupWizard } from './components/ModelSetupWizard';
import { ResizableLayout } from './components/ResizableLayout';
import { SettingsPage } from './components/SettingsPage';
import { PaymentPage, type PaidPlan } from './components/PaymentPage';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { ToastProvider } from './components/Toast';
import { loadSessions, newSession, saveSessions, updateSession, clearAllChatData, ChatSession, titleFromMessage } from './hooks/chatSessions';
import { DEFAULT_SETTINGS, AppSettings, ThemePreference } from './types';
import { inferWorkspaceEnv } from './models/agentModes';
import { IconPlus, IconBranch } from './components/Icons';
import { LoginPage } from './components/LoginPage';
import { TitleBarMenu } from './components/TitleBarMenu';
import { getRemoteSession, isSupabaseConfigured, resolveAuthConfig, type AuthSession } from './services/auth';
import { pullProfileFromSupabase, pushProfileToSupabase } from './services/supabaseProfile';
import { COPIX_SUPABASE_ANON_KEY, COPIX_SUPABASE_URL } from './services/supabaseConfig';
import { collectSessionChanges, type FileChange } from './utils/fileChanges';
import { getPlan } from './services/subscription';

function resolveTheme(pref: ThemePreference, systemLight: boolean): 'light' | 'dark' {
	if (pref === 'system') return systemLight ? 'light' : 'dark';
	return pref;
}

async function ensureWorkspace(session: ChatSession): Promise<ChatSession> {
	if (session.workspaceRoot) return session;
	const ws = await copix.createSessionWorkspace(session.id);
	return { ...session, workspaceRoot: ws.root };
}

function AppInner() {
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
	const [authReady, setAuthReady] = useState(false);
	const [authed, setAuthed] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [payPlan, setPayPlan] = useState<PaidPlan | null>(null);
	const [setupOpen, setSetupOpen] = useState(false);
	const [setupMinimized, setSetupMinimized] = useState(false);
	const [tree, setTree] = useState<string[]>([]);
	const [serverOnline, setServerOnline] = useState(false);
	const [hasTunedModel, setHasTunedModel] = useState(false);
	const [editorVisible, setEditorVisible] = useState(true);
	const [panelMode, setPanelMode] = useState<SidePanelMode>('hub');
	const [reviewFiles, setReviewFiles] = useState<FileChange[] | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
		resolveTheme('system', window.matchMedia('(prefers-color-scheme: light)').matches));

	const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0];
	const workspace = activeSession?.workspaceRoot;
	const accountName = settings.accounts.find(a => a.id === settings.activeAccountId)?.displayName;
	const accountEmail = settings.accounts.find(a => a.id === settings.activeAccountId)?.email;
	const openAgentTabs = useMemo(
		() => sessions.filter(s => !s.archived).slice(0, 8),
		[sessions],
	);
	const fileChanges = useMemo(
		() => collectSessionChanges(activeSession?.messages ?? []),
		[activeSession?.messages],
	);
	const displayedFileChanges = reviewFiles ?? fileChanges;

	useEffect(() => { setReviewFiles(null); }, [activeSessionId]);

	useEffect(() => { saveSessions(sessions); }, [sessions]);

	const applyAuthSession = useCallback(async (session: AuthSession) => {
		const auth = resolveAuthConfig();
		const next: AppSettings = {
			...settings,
			auth,
			activeAccountId: session.userId,
			accounts: [{
				id: session.userId,
				displayName: session.displayName,
				email: session.email,
				createdAt: Date.now(),
			}],
		};
		const remote = await pullProfileFromSupabase(next);
		setSettings(remote ? { ...next, ...remote, auth } : next);
		setAuthed(true);
	}, [settings]);

	useEffect(() => {
		copix.getSettings().then(s => {
			if (!s) return;
			if ('presetId' in s) { setSettings(DEFAULT_SETTINGS); return; }
			const raw = s as AppSettings & { model?: Partial<AppSettings['model']> };
			setSettings({
				...DEFAULT_SETTINGS, ...raw,
				model: {
					...DEFAULT_SETTINGS.model,
					...raw.model,
					provider: raw.model?.provider ?? DEFAULT_SETTINGS.model.provider,
					apiKey: raw.model?.apiKey ?? '',
				},
				layout: { ...DEFAULT_SETTINGS.layout, ...raw.layout },
				workspace: {
					...DEFAULT_SETTINGS.workspace,
					...raw.workspace,
					homeDirectory: /copix-output/i.test(raw.workspace?.homeDirectory ?? '')
						? ''
						: (raw.workspace?.homeDirectory ?? DEFAULT_SETTINGS.workspace.homeDirectory),
				},
				theme: raw.theme ?? DEFAULT_SETTINGS.theme,
				auth: {
					...DEFAULT_SETTINGS.auth,
					...raw.auth,
					supabaseUrl: COPIX_SUPABASE_URL || raw.auth?.supabaseUrl,
					supabaseAnonKey: COPIX_SUPABASE_ANON_KEY || raw.auth?.supabaseAnonKey,
					provider: isSupabaseConfigured({
						...DEFAULT_SETTINGS.auth,
						...raw.auth,
						supabaseUrl: COPIX_SUPABASE_URL || raw.auth?.supabaseUrl,
						supabaseAnonKey: COPIX_SUPABASE_ANON_KEY || raw.auth?.supabaseAnonKey,
					}) ? 'supabase' : 'local',
				},
				subscription: { ...DEFAULT_SETTINGS.subscription, ...raw.subscription },
				systemPrompt: { ...DEFAULT_SETTINGS.systemPrompt, ...raw.systemPrompt },
				modelSetup: { ...DEFAULT_SETTINGS.modelSetup, ...raw.modelSetup },
			});
		});
	}, []);

	useEffect(() => { copix.setSettings(settings); }, [settings]);

	useEffect(() => {
		const auth = resolveAuthConfig(settings.auth);
		if (!isSupabaseConfigured(auth)) {
			setAuthed(true);
			setAuthReady(true);
			return;
		}
		void getRemoteSession(auth).then(async session => {
			if (session?.accessToken) await applyAuthSession(session);
			setAuthReady(true);
		}).catch(() => setAuthReady(true));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!authed || !isSupabaseConfigured(settings.auth)) return;
		void pushProfileToSupabase(settings).catch(() => { /* best-effort sync */ });
	}, [authed, settings.subscription.plan, settings.subscription.status, settings.accounts, settings.activeAccountId]);

	// Theme: light/dark with live system sync
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: light)');
		const apply = () => {
			const theme = resolveTheme(settings.theme, mq.matches);
			document.documentElement.dataset.theme = theme;
			setResolvedTheme(theme);
		};
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	}, [settings.theme]);

	useEffect(() => {
		const poll = () => copix.getServerStatus().then(s => {
			setServerOnline(s.online);
			setHasTunedModel(Boolean(s.hasTuned || s.adapter));
			if (!s.hasBase && !s.hasTuned && !settings.modelSetup.completed && !settings.modelSetup.skipped) {
				setSetupOpen(true);
			}
		});
		poll();
		const t = setInterval(poll, 4000);
		return () => clearInterval(t);
	}, [settings.modelSetup.completed, settings.modelSetup.skipped]);

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
		setActiveSessionId(session.id);
		if (session.workspaceRoot) {
			const ws = await copix.getWorkspace(session.workspaceRoot);
			if (ws) setTree(ws.tree);
		}
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

	const handleSetupComplete = () => {
		setSettings(prev => ({ ...prev, modelSetup: { ...prev.modelSetup, completed: true } }));
		setSetupOpen(false);
		setSetupMinimized(false);
	};

	const handleSetupSkip = () => {
		setSettings(prev => ({ ...prev, modelSetup: { ...prev.modelSetup, skipped: true } }));
		setSetupOpen(false);
	};

	const workspaceEnv = activeSession?.workspaceEnv
		?? inferWorkspaceEnv(activeSession?.repoUrl, Boolean(workspace));

	const cycleTheme = () => setSettings(prev => {
		const order: ThemePreference[] = ['system', 'dark', 'light'];
		const next = order[(order.indexOf(prev.theme) + 1) % order.length];
		return { ...prev, theme: next };
	});

	const focusComposer = () => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();

	const paletteCommands: PaletteCommand[] = [
		{ id: 'new-agent', label: 'New agent', hint: 'Start a fresh conversation', run: handleNewChat },
		{ id: 'focus-agent', label: 'Focus agent input', hint: 'Ctrl+L', run: focusComposer },
		{ id: 'toggle-editor', label: editorVisible ? 'Hide editor panel' : 'Show editor panel', hint: 'Ctrl+B', run: () => setEditorVisible(v => !v) },
		{ id: 'open-folder', label: 'Open folder…', hint: 'Attach a local folder to this chat', run: openFolder },
		{ id: 'theme-system', label: 'Theme: sync with system', run: () => setSettings(prev => ({ ...prev, theme: 'system' })) },
		{ id: 'theme-dark', label: 'Theme: dark', run: () => setSettings(prev => ({ ...prev, theme: 'dark' })) },
		{ id: 'theme-light', label: 'Theme: light', run: () => setSettings(prev => ({ ...prev, theme: 'light' })) },
		{ id: 'settings', label: 'Open settings', hint: 'Models, appearance, account', run: () => setSettingsOpen(true) },
		{ id: 'setup', label: 'Model setup', hint: 'Download or repair gpt-oss:20b', run: () => { setSetupOpen(true); setSetupMinimized(false); } },
	];

	if (!authReady) {
		return <div className="login-screen" aria-busy="true" />;
	}

	if (!authed) {
		return <LoginPage onAuthenticated={session => { void applyAuthSession(session); }} />;
	}

	return (
		<div className="shell">
			<header className="titlebar">
				<img src="./favicon.png" alt="" className="titlebar-logo" draggable={false} />
				<TitleBarMenu
					onNewAgent={handleNewChat}
					onOpenFolder={openFolder}
					onCloneRepo={() => {
						const url = window.prompt('Repository URL to clone');
						if (url?.trim()) void cloneRepo(url.trim());
					}}
					onToggleEditor={() => setEditorVisible(v => !v)}
					onOpenSettings={() => setSettingsOpen(true)}
					onOpenPalette={() => setPaletteOpen(true)}
					onOpenSetup={() => { setSetupOpen(true); setSetupMinimized(false); }}
				/>
				<span className="titlebar-drag" />
			</header>
			<div className="agent-tabs-bar">
				<div className="top-tabs agent-tabs" role="tablist" aria-label="Agents">
					{openAgentTabs.map(s => {
						const label = s.workspaceRoot
							? s.workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() || s.title
							: s.title;
						return (
							<button
								key={s.id}
								type="button"
								className={`top-tab agent-tab${s.id === activeSessionId ? ' active' : ''}`}
								role="tab"
								aria-selected={s.id === activeSessionId}
								onClick={() => setActiveSessionId(s.id)}
							>
								<IconBranch width={12} height={12} />
								<span className="agent-tab-title">{label}</span>
							</button>
						);
					})}
					<button type="button" className="top-tab plus" title="New agent" onClick={handleNewChat}>
						<IconPlus width={12} height={12} />
					</button>
				</div>
				<span className="titlebar-title">Copix · {getPlan(settings.subscription.plan).label}</span>
			</div>

			{(setupOpen || setupMinimized) && (
				<ModelSetupWizard
					open={setupOpen}
					minimized={setupMinimized}
					onMinimize={() => { setSetupMinimized(true); setSetupOpen(false); }}
					onExpand={() => { setSetupMinimized(false); setSetupOpen(true); }}
					onClose={() => { setSetupOpen(false); setSetupMinimized(false); }}
					onComplete={handleSetupComplete}
					onSkip={handleSetupSkip}
				/>
			)}

			<div className="shell-body">
				<ActivityRail
					editorVisible={editorVisible}
					serverOnline={serverOnline}
					onNewChat={handleNewChat}
					onToggleEditor={() => setEditorVisible(v => !v)}
					onOpenPalette={() => setPaletteOpen(true)}
					onOpenSettings={() => setSettingsOpen(true)}
					onFocusComposer={focusComposer}
				/>

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
						accountName={accountName}
						plan={settings.subscription.plan}
						serverOnline={serverOnline}
						onSelectSession={setActiveSessionId}
						onNewChat={handleNewChat}
						onOpenFolder={openFolder}
						onCloneRepo={cloneRepo}
						onOpenSettings={() => setSettingsOpen(true)}
						onOpenSetup={() => { setSetupOpen(true); setSetupMinimized(false); }}
						onOpenPalette={() => setPaletteOpen(true)}
						onTogglePinSession={togglePinSession}
						onArchiveSession={archiveSession}
						onDeleteSession={deleteSession}
						onRestoreSession={restoreSession}
					/>
				}
				chat={
					<ChatCenter
						sessionId={activeSessionId}
						workspace={workspace}
						settings={settings}
						tree={tree}
						messages={activeSession?.messages ?? []}
						onMessagesChange={(msgs, title) =>
							patchSession(activeSessionId, { messages: msgs, ...(title ? { title } : {}) })}
						onWorkspaceChange={refreshWorkspace}
						onOpenSetup={() => { setSetupOpen(true); setSetupMinimized(false); }}
						onOpenSettings={() => setSettingsOpen(true)}
						onAgentModeChange={mode => setSettings(prev => ({ ...prev, agentMode: mode }))}
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
					/>
				}
				editor={
					<EditorArea
						tabs={activeSession?.tabs ?? []}
						activePath={activeSession?.activePath}
						fileChanges={displayedFileChanges}
						mode={panelMode}
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
					/>
				}
				/>
			</div>

			<StatusBar
				workspace={workspace}
				model={settings.model.preferTuned && hasTunedModel ? settings.model.tunedModelId : settings.model.modelId}
				provider={settings.model.provider}
				online={serverOnline || (settings.model.provider === 'cloud' && Boolean(settings.model.apiKey))}
				theme={settings.theme}
				onCycleTheme={cycleTheme}
				onOpenSettings={() => setSettingsOpen(true)}
			/>

			<CommandPalette
				open={paletteOpen}
				commands={paletteCommands}
				onClose={() => setPaletteOpen(false)}
			/>

			<SettingsPage
				open={settingsOpen}
				settings={settings}
				onClose={() => setSettingsOpen(false)}
				onChange={setSettings}
				onOpenSetup={() => { setSettingsOpen(false); setSetupOpen(true); setSetupMinimized(false); }}
				onSignedOut={() => setAuthed(false)}
				onUpgradePlan={plan => {
					setSettingsOpen(false);
					setPayPlan(plan);
				}}
			/>

			<PaymentPage
				open={Boolean(payPlan)}
				plan={payPlan ?? 'pro'}
				email={accountEmail}
				onClose={() => setPayPlan(null)}
			/>
		</div>
	);
}

export default function App() {
	return (
		<ToastProvider>
			<AppInner />
		</ToastProvider>
	);
}
