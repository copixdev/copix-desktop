import { ChatMessage, EditorTab } from '../types';
import type { WorkspaceEnvironment } from '../models/agentModes';

export interface ChatSession {
	id: string;
	title: string;
	createdAt: number;
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
	/** Auto-run this prompt once when the session opens. */
	pendingPrompt?: string;
}

const STORAGE_KEY = 'copix.agents.sessions';
const LEGACY_STORAGE_KEY = 'copix.chat.sessions';

export function loadSessions(): ChatSession[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
		const parsed: ChatSession[] = raw ? JSON.parse(raw) : [];
		return parsed
			.map(s => ({
				...s,
				tabs: s.tabs ?? [],
				pinned: Boolean(s.pinned),
				archived: Boolean(s.archived),
			}))
			.filter(s => !s.deletedAt);
	} catch {
		return [];
	}
}

export function saveSessions(sessions: ChatSession[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
	localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Wipe all local agent/chat history (does not touch Supabase). */
export function clearAllChatData(): void {
	localStorage.removeItem(STORAGE_KEY);
	localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function newSession(): ChatSession {
	return {
		id: `agent-${Date.now()}`,
		title: 'New agent',
		createdAt: Date.now(),
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
	return sessions.map(s => (s.id === id ? { ...s, ...patch } : s));
}
