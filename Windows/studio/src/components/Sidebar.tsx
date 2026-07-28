import { useMemo, useRef, useState } from 'react';
import { ChatSession } from '../hooks/chatSessions';
import type { WorkspaceEnvironment } from '../models/agentModes';
import {
	IconPlus, IconFolder, IconCommand, IconSparkle, IconChat,
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

function shortPath(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

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

export function Sidebar({
	sessions, activeId, workspace,
	onSelectSession, onNewChat, onOpenFolder, onCloneRepo,
	onOpenPalette, onTogglePinSession, onDeleteSession,
}: Props) {
	const [filter, setFilter] = useState('');
	const [showClone, setShowClone] = useState(false);
	const [cloneInput, setCloneInput] = useState('');
	const filterRef = useRef<HTMLInputElement>(null);

	const agents = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return sessions
			.filter(s => !s.archived && !s.parentSessionId)
			.filter(s => {
				if (!q) return true;
				const hay = `${agentTitle(s)} ${s.workspaceRoot ?? ''}`.toLowerCase();
				return hay.includes(q);
			})
			.sort((a, b) => {
				if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
				const aLast = a.messages[a.messages.length - 1]?.timestamp ?? a.createdAt;
				const bLast = b.messages[b.messages.length - 1]?.timestamp ?? b.createdAt;
				return bLast - aLast;
			});
	}, [sessions, filter]);

	const pinned = agents.filter(s => s.pinned);
	const recent = agents.filter(s => !s.pinned);

	const renderAgent = (s: ChatSession) => {
		const last = s.messages[s.messages.length - 1]?.timestamp ?? s.createdAt;
		const childCount = sessions.filter(c => c.parentSessionId === s.id && !c.archived).length;
		return (
			<div key={s.id} className={`agent-row${s.id === activeId ? ' active' : ''}`}>
				<button
					type="button"
					className={`chat-item${s.id === activeId ? ' active' : ''}`}
					onClick={() => onSelectSession(s.id)}
					title={s.workspaceRoot || agentTitle(s)}
				>
					{s.pinned ? <span className="agent-pin">★</span> : <IconChat width={13} height={13} />}
					<span className="chat-item-title fade-edge">{agentTitle(s)}</span>
					{childCount > 0 && <span className="agent-child-count">{childCount}</span>}
					<span className="chat-item-meta">{relativeTime(last)}</span>
				</button>
				<div className="agent-row-actions">
					<button type="button" className="btn-icon" title={s.pinned ? 'Unpin' : 'Pin'} onClick={() => onTogglePinSession(s.id)}>
						{s.pinned ? '★' : '☆'}
					</button>
					<button type="button" className="btn-icon" title="Delete" onClick={() => onDeleteSession(s.id)}>✕</button>
				</div>
			</div>
		);
	};

	return (
		<aside className="sidebar sidebar-v2 sidebar-agents">
			<div className="sidebar-top-actions">
				<button type="button" className="sidebar-action primary" onClick={onNewChat}>
					<IconSparkle width={15} height={15} />
					<span>New Agent</span>
				</button>
				<button type="button" className="sidebar-action" onClick={onOpenPalette}>
					<IconCommand width={15} height={15} />
					<span>Search</span>
				</button>
			</div>

			<div className="sidebar-toolbar">
				<input
					ref={filterRef}
					className="sidebar-filter"
					placeholder="Search agents"
					value={filter}
					onChange={e => setFilter(e.target.value)}
				/>
				<button type="button" className="btn-icon" title="Open folder" onClick={onOpenFolder}>
					<IconFolder width={13} height={13} />
				</button>
				<button type="button" className="btn-icon" title="New agent" onClick={onNewChat}>
					<IconPlus width={13} height={13} />
				</button>
			</div>

			{pinned.length > 0 && (
				<section className="sidebar-section">
					<div className="section-head"><span>Pinned</span></div>
					<div className="chat-list agent-list">{pinned.map(renderAgent)}</div>
				</section>
			)}

			<section className="sidebar-section grow">
				<div className="section-head">
					<span>Agents</span>
					<span className="section-count">{agents.length}</span>
				</div>
				<div className="chat-list agent-list">
					{recent.map(renderAgent)}
					{!agents.length && (
						<div className="repo-empty">
							<p className="muted-xs">No agents yet</p>
							<button type="button" className="btn sm" onClick={onNewChat}>New Agent</button>
							<button type="button" className="btn ghost sm" onClick={onOpenFolder}>Open folder</button>
							<button type="button" className="btn ghost sm" onClick={() => setShowClone(v => !v)}>Clone repo</button>
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

			{workspace && (
				<p className="sidebar-cwd" title={workspace}>{shortPath(workspace)}</p>
			)}
		</aside>
	);
}
