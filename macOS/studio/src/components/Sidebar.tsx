import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatSession } from '../hooks/chatSessions';
import type { WorkspaceEnvironment } from '../models/agentModes';
import { PLANS } from '../services/subscription';
import type { SubscriptionPlan } from '../types';
import {
	IconPlus, IconFolder, IconSettings, IconChat, IconCommand, IconSparkle, IconPanelRight, IconChevron,
} from './Icons';

interface Props {
	sessions: ChatSession[];
	activeId: string;
	workspace?: string;
	workspaceEnv?: WorkspaceEnvironment;
	repoUrl?: string;
	accountName?: string;
	plan?: SubscriptionPlan;
	serverOnline?: boolean;
	onSelectSession: (id: string) => void;
	onNewChat: () => void;
	onOpenFolder: () => void;
	onCloneRepo: (url: string) => void;
	onOpenSettings: () => void;
	onOpenSetup: () => void;
	onOpenPalette?: () => void;
	onTogglePinSession: (id: string) => void;
	onArchiveSession: (id: string) => void;
	onDeleteSession: (id: string) => void;
	onRestoreSession: (id: string) => void;
}

function shortPath(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

function folderName(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || p;
}

function agentLabel(s: ChatSession): string {
	if (s.workspaceRoot) return folderName(s.workspaceRoot);
	return s.title;
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

export function Sidebar({
	sessions, activeId, workspace, accountName, plan = 'free',
	onSelectSession, onNewChat, onOpenFolder, onCloneRepo, onOpenSettings, onOpenSetup,
	onOpenPalette, onTogglePinSession, onDeleteSession,
}: Props) {
	const [cloneInput, setCloneInput] = useState('');
	const [showClone, setShowClone] = useState(false);
	const [repoFilter, setRepoFilter] = useState('');
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [repoMenu, setRepoMenu] = useState<string | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!repoMenu) return;
		const onDoc = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setRepoMenu(null);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [repoMenu]);

	const pinned = useMemo(
		() => sessions.filter(s => s.pinned && !s.archived),
		[sessions],
	);

	const repos = useMemo(() => {
		const map = new Map<string, {
			path: string;
			updatedAt: number;
			sessionId: string;
			agents: ChatSession[];
		}>();
		for (const s of sessions) {
			if (!s.workspaceRoot || s.archived) continue;
			const prev = map.get(s.workspaceRoot);
			if (!prev) {
				map.set(s.workspaceRoot, {
					path: s.workspaceRoot,
					updatedAt: s.createdAt,
					sessionId: s.id,
					agents: [s],
				});
			} else {
				prev.agents.push(s);
				if (s.createdAt > prev.updatedAt) {
					prev.updatedAt = s.createdAt;
					prev.sessionId = s.id;
				}
			}
		}
		if (workspace && !map.has(workspace)) {
			map.set(workspace, {
				path: workspace,
				updatedAt: Date.now(),
				sessionId: activeId,
				agents: [],
			});
		}
		return [...map.values()]
			.filter(r => !repoFilter || folderName(r.path).toLowerCase().includes(repoFilter.toLowerCase()))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}, [sessions, workspace, activeId, repoFilter]);

	const isExpanded = (path: string) => expanded[path] ?? path === workspace;

	const initial = (accountName || 'U').slice(0, 1).toUpperCase();
	const planLabel = PLANS.find(p => p.id === plan)?.label ?? 'Free';

	return (
		<aside className="sidebar sidebar-v2">
			<div className="sidebar-top-actions">
				<button type="button" className="sidebar-action" onClick={onNewChat}>
					<IconSparkle width={15} height={15} />
					<span>New Agent</span>
				</button>
				<button type="button" className="sidebar-action" onClick={onOpenPalette}>
					<IconCommand width={15} height={15} />
					<span>Search</span>
				</button>
				<button type="button" className="sidebar-action" onClick={onOpenSetup}>
					<IconChat width={15} height={15} />
					<span>Automations</span>
				</button>
				<button type="button" className="sidebar-action" onClick={onOpenSettings}>
					<IconPanelRight width={15} height={15} />
					<span>Customize</span>
				</button>
			</div>

			<section className="sidebar-section">
				<div className="section-head"><span>Pinned</span></div>
				<div className="chat-list">
					{pinned.map(s => (
						<button
							key={s.id}
							type="button"
							className={`chat-item pill${s.id === activeId ? ' active' : ''}`}
							onClick={() => onSelectSession(s.id)}
						>
							<span className="chat-item-title fade-edge">{agentLabel(s)}</span>
							<span className="chat-item-meta">{relativeTime(s.createdAt)}</span>
						</button>
					))}
					{!pinned.length && <p className="muted-xs">Pin an agent to keep it here.</p>}
				</div>
			</section>

			<section className="sidebar-section grow">
				<div className="section-head">
					<span>Repositories</span>
					<div className="section-head-actions">
						<button type="button" className="btn-icon" title="Filter" onClick={() => filterRef.current?.focus()}>
							<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
								<path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
							</svg>
						</button>
						<button type="button" className="btn-icon" title="Open folder" onClick={onOpenFolder}>
							<IconFolder width={13} height={13} />
						</button>
						<button type="button" className="btn-icon" title="New agent" onClick={onNewChat}>
							<IconPlus width={13} height={13} />
						</button>
					</div>
				</div>
				<input
					ref={filterRef}
					className="sidebar-filter"
					placeholder="Filter repos"
					value={repoFilter}
					onChange={e => setRepoFilter(e.target.value)}
				/>
				<div className="repo-list">
					{repos.map(r => {
						const open = isExpanded(r.path);
						const latest = r.agents[0];
						return (
							<div key={r.path} className={`repo-group${r.path === workspace ? ' active' : ''}`}>
								<div className="repo-row-line">
									<button
										type="button"
										className="repo-chevron"
										onClick={() => setExpanded(prev => ({ ...prev, [r.path]: !open }))}
										aria-label={open ? 'Collapse' : 'Expand'}
									>
										<IconChevron
											width={11}
											height={11}
											style={{ transform: open ? 'rotate(90deg)' : 'none' }}
										/>
									</button>
									<button
										type="button"
										className={`repo-row${r.path === workspace ? ' active' : ''}`}
										onClick={() => onSelectSession(r.sessionId)}
										title={r.path}
									>
										<IconFolder width={14} height={14} />
										<div className="repo-row-text">
											<span className="repo-row-name fade-edge">{folderName(r.path)}</span>
											{!open && (
												<span className="repo-row-sub">
													{latest ? agentLabel(latest) : 'No agents yet.'}
												</span>
											)}
										</div>
										<span className="repo-row-time">{relativeTime(r.updatedAt)}</span>
									</button>
									<div className="repo-plus-wrap" ref={repoMenu === r.path ? menuRef : undefined}>
										<button
											type="button"
											className="btn-icon repo-plus"
											title="Add"
											onClick={e => {
												e.stopPropagation();
												setRepoMenu(m => m === r.path ? null : r.path);
											}}
										>
											<IconPlus width={12} height={12} />
										</button>
										{repoMenu === r.path && (
											<div className="repo-plus-menu fade-in">
												<button
													type="button"
													className="panel-plus-item"
													onClick={() => {
														setRepoMenu(null);
														onNewChat();
													}}
												>
													<IconSparkle width={13} height={13} />
													New agent
												</button>
												<button
													type="button"
													className="panel-plus-item"
													onClick={() => {
														setRepoMenu(null);
														onOpenFolder();
													}}
												>
													<IconFolder width={13} height={13} />
													Open folder
												</button>
											</div>
										)}
									</div>
								</div>
								{open && (
									<div className="repo-agents">
										{r.agents.length === 0 && (
											<p className="muted-xs repo-agents-empty">No agents yet.</p>
										)}
										{r.agents.map(s => (
											<div key={s.id} className={`agent-row nested${s.id === activeId ? ' active' : ''}`}>
												<button
													type="button"
													className={`chat-item${s.id === activeId ? ' active' : ''}`}
													onClick={() => onSelectSession(s.id)}
												>
													{s.pinned ? <span className="agent-pin">★</span> : <IconChat width={12} height={12} />}
													<span className="chat-item-title fade-edge">{agentLabel(s)}</span>
													<span className="chat-item-meta">{relativeTime(s.createdAt)}</span>
												</button>
												<div className="agent-row-actions">
													<button type="button" className="btn-icon" title={s.pinned ? 'Unpin' : 'Pin'} onClick={() => onTogglePinSession(s.id)}>
														{s.pinned ? '★' : '☆'}
													</button>
													<button type="button" className="btn-icon" title="Delete" onClick={() => onDeleteSession(s.id)}>✕</button>
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						);
					})}
					{!repos.length && (
						<div className="repo-empty">
							<p className="muted-xs">No repositories yet</p>
							<button type="button" className="btn sm" onClick={onOpenFolder}>Open folder</button>
							<button type="button" className="btn ghost sm" onClick={() => setShowClone(v => !v)}>Clone</button>
						</div>
					)}
				</div>
				{showClone && (
					<div className="clone-box">
						<input
							className="input"
							placeholder="https://github.com/user/repo"
							value={cloneInput}
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
			</section>

			<footer className="sidebar-profile">
				<div className="sidebar-profile-left">
					<span className="settings-avatar">{initial}</span>
					<div className="sidebar-profile-text">
						<div className="settings-user-name fade-edge">{accountName || 'User'}</div>
						<div className="settings-user-plan">{planLabel} Plan</div>
					</div>
				</div>
				<button type="button" className="btn-icon" title="Settings" onClick={onOpenSettings}>
					<IconSettings width={14} height={14} />
				</button>
			</footer>
			{workspace && <p className="sidebar-cwd" title={workspace}>{shortPath(workspace)}</p>}
		</aside>
	);
}
