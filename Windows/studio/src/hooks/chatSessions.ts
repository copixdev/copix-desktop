import { ChatMessage, EditorTab } from '../types';
import type { WorkspaceEnvironment } from '../models/agentModes';
import { copix } from '../api';

export interface ChatSession {
	id: string;
	title: string;
	createdAt: number;
	/** Bumped on every message — newest wins when merging Desktop/CLI stores. */
	updatedAt?: number;
	/** Where this session was written from last. */
	origin?: 'desktop' | 'cli';
	pinned?: boolean;
	archived?: boolean;
	deletedAt?: number;
	messages: ChatMessage[];
	workspaceRoot?: string;
	workspaceEnv?: WorkspaceEnvironment;
	repoUrl?: string;
	tabs: EditorTab[];
	activePath?: string;
	/** Parent agent session when spawned as a subagent. */
	parentSessionId?: string;
	/** User closed the compact subagent panel. */
	subagentDismissed?: boolean;
	/** Auto-run this prompt once when the session opens. */
	pendingPrompt?: string;
}

const STORAGE_KEY = 'copix.agents.sessions';
const LEGACY_STORAGE_KEY = 'copix.chat.sessions';

function normalize(parsed: ChatSession[]): ChatSession[] {
	return parsed
		.map(s => ({
			...s,
			tabs: s.tabs ?? [],
			messages: s.messages ?? [],
			pinned: Boolean(s.pinned),
			archived: Boolean(s.archived),
		}))
		.filter(s => !s.deletedAt);
}

export function loadSessions(): ChatSession[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
		return normalize(raw ? JSON.parse(raw) : []);
	} catch {
		return [];
	}
}

function sessionStamp(s: ChatSession): number {
	return s.updatedAt ?? s.messages[s.messages.length - 1]?.timestamp ?? s.createdAt;
}

/**
 * Copy unsaved text and cursor onto a tab that is still open.
 * The older snapshot must not add a path the newer snapshot already closed.
 */
function carryUnsaved(newerTab: EditorTab, olderTab: EditorTab | undefined): EditorTab {
	if (!olderTab) return newerTab;
	let next = newerTab;
	const olderDirty = olderTab.dirty && !newerTab.dirty;
	const blankMirror = !newerTab.dirty && !olderTab.dirty && newerTab.content === '' && olderTab.content !== '';
	if (olderDirty || blankMirror) {
		next = { ...next, content: olderTab.content, dirty: olderTab.dirty || next.dirty };
	}
	const cursor = (olderDirty ? olderTab.cursor : undefined) ?? next.cursor ?? olderTab.cursor;
	if (cursor && cursor !== next.cursor) next = { ...next, cursor };
	return next;
}

function activeIn(tabs: EditorTab[], path?: string): string | undefined {
	if (path && tabs.some(tab => tab.path === path)) return path;
	return tabs[0]?.path;
}

/**
 * The newer snapshot decides which files are open. A closed tab in that list
 * stays closed. Unsaved text and cursor move across only for paths that remain.
 * An empty tab list is the history mirror (~/Copix/sessions.json strips tabs),
 * not a close, when the other copy still has the editor open.
 */
function keepEditor(winner: ChatSession, other: ChatSession): ChatSession {
	const winnerTabs = winner.tabs ?? [];
	const otherTabs = other.tabs ?? [];
	if (winnerTabs.length === 0 && otherTabs.length > 0) {
		return { ...winner, tabs: otherTabs, activePath: activeIn(otherTabs, other.activePath ?? winner.activePath) };
	}
	const olderByPath = new Map(otherTabs.map(tab => [tab.path, tab]));
	const tabs = winnerTabs.map(tab => carryUnsaved(tab, olderByPath.get(tab.path)));
	return { ...winner, tabs, activePath: activeIn(tabs, winner.activePath) };
}

/** Merge two stores by id — the copy with the newest activity wins. */
export function mergeSessionStores(a: ChatSession[], b: ChatSession[]): ChatSession[] {
	const byId = new Map<string, ChatSession>();
	for (const incoming of [...a, ...b]) {
		const prev = byId.get(incoming.id);
		if (!prev) {
			byId.set(incoming.id, incoming);
			continue;
		}
		const incomingWins = sessionStamp(incoming) > sessionStamp(prev);
		const winner = incomingWins ? incoming : prev;
		const other = incomingWins ? prev : incoming;
		byId.set(incoming.id, keepEditor(winner, other));
	}
	return [...byId.values()].sort((x, y) => sessionStamp(y) - sessionStamp(x));
}

/** Pull sessions written by the CLI (~/Copix/sessions.json) and merge with local. */
export async function syncSessionsFromDisk(current: ChatSession[]): Promise<ChatSession[] | null> {
	try {
		const raw = await copix.loadChatSessions();
		if (!raw) return null;
		const disk = normalize(JSON.parse(raw) as ChatSession[]);
		if (!disk.length) return null;
		return mergeSessionStores(current, disk);
	} catch {
		return null;
	}
}

let diskWriteTimer: ReturnType<typeof setTimeout> | undefined;

export function saveSessions(sessions: ChatSession[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
	localStorage.removeItem(LEGACY_STORAGE_KEY);
	// Debounced mirror to ~/Copix/sessions.json so the CLI sees Desktop history.
	clearTimeout(diskWriteTimer);
	diskWriteTimer = setTimeout(() => {
		// History only. Tab buffers stay in memory and localStorage; merging this
		// file back on focus must not treat the empty list as "close the file".
		const slim = sessions.map(s => ({ ...s, tabs: [], origin: s.origin ?? 'desktop' as const }));
		Promise.resolve(copix.saveChatSessions(JSON.stringify(slim, null, 1))).catch(() => undefined);
	}, 400);
}

/** Wipe all local agent/chat history. */
export function clearAllChatData(): void {
	localStorage.removeItem(STORAGE_KEY);
	localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function newSession(): ChatSession {
	return {
		id: `agent-${Date.now()}`,
		title: 'New agent',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		origin: 'desktop',
		pinned: false,
		archived: false,
		messages: [],
		tabs: [],
	};
}

export function titleFromMessage(text: string): string {
	const t = text.trim().replace(/\s+/g, ' ');
	return t.length > 36 ? t.slice(0, 36) + '…' : t || 'New chat';
}

export function updateSession(
	sessions: ChatSession[],
	id: string,
	patch: Partial<ChatSession>,
): ChatSession[] {
	const bump = 'messages' in patch || 'title' in patch;
	return sessions.map(s => (s.id === id ? { ...s, ...patch, ...(bump ? { updatedAt: Date.now() } : {}) } : s));
}
