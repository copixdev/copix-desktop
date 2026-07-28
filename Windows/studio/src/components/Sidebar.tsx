import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatSession } from '../hooks/chatSessions';
import type { WorkspaceEnvironment } from '../models/agentModes';
import { copix } from '../api';
import { isWindows } from '../utils/platform';
import {
	IconPlus, IconFolder, IconCompose, IconSearch, IconRobot, IconLayout,
	IconFilter, IconSliders, IconCloud, IconMore,
} from './Icons';

interface Props {
	sessions: ChatSession[];
	activeId: string;
	workspace?: string;
	workspaceEnv?: WorkspaceEnvironment;
	repoUrl?: string;
	serverOnline?: boolean;
	onSelectSession: (id: string) => void;
	onNewChat: () => void;
	onOpenFolder: () => void;
	onCloneRepo: (url: string) => void;
	onOpenPalette?: () => void;
	onTogglePinSession: (id: string) => void;
	onArchiveSession: (id: string) => void;
	onDeleteSession: (id: string) => void;
	onRestoreSession: (id: string) => void;
}

const HOME_KEY = '__home__';

function folderName(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || p;
}

function agentTitle(s: ChatSession): string {
	const title = s.title?.trim();
	if (title && title !== 'New agent' && !/^agent-\d+/i.test(title)) return title;
	if (s.workspaceRoot) {
		const name = folderName(s.workspaceRoot);
		if (name && !/^agent-\d+/i.test(name)) return name;
	}
	return title || 'New agent';
}

function relativeTime(ts: number): string {
	const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (sec < 60) return 'now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h`;
	return `${Math.floor(hr / 24)}d`;
}

function lastActivity(s: ChatSession): number {
	return s.messages[s.messages.length - 1]?.timestamp ?? s.createdAt;
}

type RepoGroup = {
	key: string;
	path?: string;
	name: string;
	updatedAt: number;
	sessionId?: string;
	agents: ChatSession[];
};

export function Sidebar({
	sessions, activeId, workspace,
	onSelectSession, onNewChat, onOpenFolder, onCloneRepo,
	onOpenPalette, onTogglePinSession, onArchiveSession, onDeleteSession,
}: Props) {
	const [repoFilter, setRepoFilter] = useState('');
	const [showFilter, setShowFilter] = useState(false);
	const [showClone, setShowClone] = useState(false);
	const [cloneInput, setCloneInput] = useState('');
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [agentMenu, setAgentMenu] = useState<string | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!agentMenu) return;
		const onDoc = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setAgentMenu(null);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [agentMenu]);

	useEffect(() => {
		if (showFilter) filterRef.current?.focus();
	}, [showFilter]);

	const repos = useMemo(() => {
		const map = new Map<string, RepoGroup>();
		const q = repoFilter.trim().toLowerCase();

		const ensure = (key: string, name: string, path?: string): RepoGroup => {
			let g = map.get(key);
			if (!g) {
				g = { key, path, name, updatedAt: 0, agents: [] };
				map.set(key, g);
			}
			return g;
		};

		ensure(HOME_KEY, 'Home');

		for (const s of sessions) {
			if (s.archived || s.parentSessionId) continue;
			const key = s.workspaceRoot || HOME_KEY;
			const g = ensure(
				key,
				key === HOME_KEY ? 'Home' : folderName(s.workspaceRoot!),
				s.workspaceRoot,
			);
			g.agents.push(s);
			const ts = lastActivity(s);
			if (ts >= g.updatedAt) {
				g.updatedAt = ts;
				g.sessionId = s.id;
			}
		}

		if (workspace && !map.has(workspace)) {
			ensure(workspace, folderName(workspace), workspace);
		}

		for (const g of map.values()) {
			g.agents.sort((a, b) => lastActivity(b) - lastActivity(a));
		}

		return [...map.values()]
			.filter(r => {
				if (!q) return true;
				if (r.name.toLowerCase().includes(q)) return true;
				return r.agents.some(a => agentTitle(a).toLowerCase().includes(q));
			})
			.sort((a, b) => {
				if (a.key === HOME_KEY) return -1;
				if (b.key === HOME_KEY) return 1;
				return b.updatedAt - a.updatedAt;
			});
	}, [sessions, workspace, repoFilter]);

	const isExpanded = (key: string) => {
		if (expanded[key] != null) return expanded[key];
		if (key === HOME_KEY) return false;
		return key === workspace || repos.find(r => r.key === key)?.agents.some(a => a.id === activeId);
	};

	const openCustomize = async () => {
		try {
			const cmd = isWindows()
				? 'Invoke-Item "$env:USERPROFILE\\Copix\\settings.json"'
				: 'open "$HOME/Copix/settings.json"';
			await copix.runTerminal(cmd);
		} catch {
			onOpenPalette?.();
		}
	};

	const renderAgent = (s: ChatSession) => {
		const last = lastActivity(s);
		const menuOpen = agentMenu === s.id;
		return (
			<div key={s.id} className={`agent-row nested${s.id === activeId ? ' active' : ''}`}>
				<div className="agent-more-wrap" ref={menuOpen ? menuRef : undefined}>
					<button
						type="button"
						className="agent-more-btn"
						title="Agent actions"
						onClick={e => {
							e.stopPropagation();
							setAgentMenu(m => m === s.id ? null : s.id);
						}}
					>
						<IconMore width={12} height={12} />
					</button>
					{menuOpen && (
						<div className="agent-more-menu fade-in">
							<button
								type="button"
								className="panel-plus-item"
								onClick={() => {
									setAgentMenu(null);
									onTogglePinSession(s.id);
								}}
							>
								{s.pinned ? 'Unpin' : 'Pin'}
							</button>
							<button
								type="button"
								className="panel-plus-item"
								onClick={() => {
									setAgentMenu(null);
									onArchiveSession(s.id);
								}}
							>
								Archive
							</button>
							<button
								type="button"
								className="panel-plus-item danger"
								onClick={() => {
									setAgentMenu(null);
									onDeleteSession(s.id);
								}}
							>
								Delete
							</button>
						</div>
					)}
				</div>
				<button
					type="button"
					className={`chat-item${s.id === activeId ? ' active' : ''}`}
					onClick={() => onSelectSession(s.id)}
					title={s.workspaceRoot || agentTitle(s)}
				>
					<span className="chat-item-title fade-edge">{agentTitle(s)}</span>
				</button>
				<div className="agent-row-trailing">
					<button
						type="button"
						className="btn-icon agent-trail-btn"
						title={s.pinned ? 'Unpin' : 'Pin agent'}
						onClick={() => onTogglePinSession(s.id)}
					>
						<IconSliders width={12} height={12} />
					</button>
					<span className="agent-cloud" title="Cloud agent">
						<IconCloud width={12} height={12} />
					</span>
					<span className="chat-item-meta">{relativeTime(last)}</span>
				</div>
			</div>
		);
	};

	return (
		<aside className="sidebar sidebar-v2 sidebar-agents sidebar-cursor">
			<div className="sidebar-top-actions">
				<button type="button" className="sidebar-action" onClick={onNewChat}>
					<IconCompose width={14} height={14} />
					<span>New Agent</span>
				</button>
				<button type="button" className="sidebar-action" onClick={onOpenPalette}>
					<IconSearch width={14} height={14} />
					<span>Search</span>
				</button>
				<button
					type="button"
					className="sidebar-action"
					onClick={() => setShowClone(v => !v)}
					title="Automations / clone a repository"
				>
					<IconRobot width={14} height={14} />
					<span>Automations</span>
				</button>
				<button type="button" className="sidebar-action" onClick={() => void openCustomize()}>
					<IconLayout width={14} height={14} />
					<span>Customize</span>
				</button>
			</div>

			{showClone && (
				<div className="clone-box">
					<input
						className="input"
						placeholder="https://github.com/user/repo"
						value={cloneInput}
						autoFocus
						onChange={e => setCloneInput(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter' && cloneInput.trim()) {
								onCloneRepo(cloneInput.trim());
								setCloneInput('');
								setShowClone(false);
							}
						}}
					/>
				</div>
			)}

			<section className="sidebar-section grow repos-section">
				<div className="section-head repos-head">
					<span>Repositories</span>
					<div className="section-head-actions">
						<button
							type="button"
							className={`btn-icon${showFilter ? ' active' : ''}`}
							title="Filter"
							onClick={() => setShowFilter(v => !v)}
						>
							<IconFilter width={13} height={13} />
						</button>
						<button type="button" className="btn-icon" title="Open folder" onClick={onOpenFolder}>
							<IconFolder width={13} height={13} />
						</button>
					</div>
				</div>

				{showFilter && (
					<input
						ref={filterRef}
						className="sidebar-filter"
						placeholder="Filter repositories"
						value={repoFilter}
						onChange={e => setRepoFilter(e.target.value)}
					/>
				)}

				<div className="repo-list">
					{repos.map(r => {
						const open = isExpanded(r.key);
						const empty = r.agents.length === 0;
						return (
							<div key={r.key} className={`repo-group${r.path === workspace ? ' active' : ''}`}>
								<button
									type="button"
									className={`repo-folder${open ? ' open' : ''}${r.path === workspace ? ' active' : ''}`}
									title={r.path || 'Home'}
									onClick={() => {
										setExpanded(prev => ({ ...prev, [r.key]: !open }));
										if (!open && r.sessionId) onSelectSession(r.sessionId);
									}}
								>
									<IconFolder width={14} height={14} />
									<div className="repo-row-text">
										<span className="repo-row-name fade-edge">{r.name}</span>
										{!open && empty && (
											<span className="repo-row-sub">No agents yet</span>
										)}
									</div>
									{!open && !empty && (
										<span className="repo-row-time">{relativeTime(r.updatedAt)}</span>
									)}
								</button>

								{open && (
									<div className="repo-agents">
										{empty ? (
											<div className="repo-agents-empty">
												<p className="muted-xs">No agents yet</p>
												<button
													type="button"
													className="btn ghost sm"
													onClick={onNewChat}
												>
													<IconPlus width={11} height={11} /> New Agent
												</button>
											</div>
										) : (
											r.agents.map(renderAgent)
										)}
									</div>
								)}
							</div>
						);
					})}

					{!repos.length && (
						<div className="repo-empty">
							<p className="muted-xs">No repositories yet</p>
							<button type="button" className="btn sm" onClick={onOpenFolder}>Open folder</button>
						</div>
					)}
				</div>
			</section>
		</aside>
	);
}
