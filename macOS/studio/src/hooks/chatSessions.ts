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
 * Keep unsaved text when two snapshots mention the same path.
 * A dirty buffer is the edit in the editor. A blank clean snapshot is the
 * history mirror (~/Copix/sessions.json stores tabs as []), not a user edit.
 */
function preferBuffer(winnerTab: EditorTab, otherTab: EditorTab): EditorTab {
	if (otherTab.dirty !== winnerTab.dirty) return otherTab.dirty ? otherTab : winnerTab;
	if (!winnerTab.dirty && !otherTab.dirty) {
		if (winnerTab.content === '' && otherTab.content !== '') return otherTab;
		if (otherTab.content === '' && winnerTab.content !== '') return winnerTab;
	}
	return winnerTab;
}

function mergeTabs(winnerTabs: EditorTab[], otherTabs: EditorTab[]): EditorTab[] {
	const byPath = new Map<string, EditorTab>();
	for (const tab of winnerTabs) byPath.set(tab.path, tab);
	for (const tab of otherTabs) {
		const prev = byPath.get(tab.path);
		byPath.set(tab.path, prev ? preferBuffer(prev, tab) : tab);
	}
	const order: string[] = [];
	for (const tab of [...winnerTabs, ...otherTabs]) {
		if (!order.includes(tab.path)) order.push(tab.path);
	}
	return order.map(path => byPath.get(path)!);
}

function chooseActivePath(winner: ChatSession, other: ChatSession, tabs: EditorTab[]): string | undefined {
	const has = (path?: string) => Boolean(path && tabs.some(tab => tab.path === path));
	const winnerTab = winner.tabs?.find(tab => tab.path === winner.activePath);
	const otherTab = other.tabs?.find(tab => tab.path === other.activePath);
	if (otherTab?.dirty && has(other.activePath) && !winnerTab?.dirty) return other.activePath;
	if (has(winner.activePath)) return winner.activePath;
	if (has(other.activePath)) return other.activePath;
	return tabs[0]?.path;
}

/**
 * Keep the open editor when the other snapshot is a history mirror.
 * Desktop writes ~/Copix/sessions.json without tab buffers. On window focus
 * that mirror is merged back; an equal timestamp used to replace the live
 * session and close the file. Unsaved buffers are copied per path so a clean
 * or empty snapshot cannot drop text that is still in the editor.
 */
function keepEditor(winner: ChatSession, other: ChatSession): ChatSession {
	const tabs = mergeTabs(winner.tabs ?? [], other.tabs ?? []);
	if (!tabs.length) return winner;
	return { ...winner, tabs, activePath: chooseActivePath(winner, other, tabs) };
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
		const incomingWins = sessionStamp(incoming) >= sessionStamp(prev);
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
