export interface EditorTab {
	path: string;
	content: string;
	dirty: boolean;
}

export interface SessionMessage {
	id: string;
	role: string;
	content: string;
	timestamp?: number;
}

export interface ChatSession {
	id: string;
	title?: string;
	createdAt: number;
	updatedAt?: number;
	activePath?: string;
	tabs?: EditorTab[];
	messages: SessionMessage[];
	origin?: 'desktop' | 'cli';
}

function sessionStamp(session: ChatSession): number {
	return session.updatedAt ?? session.messages[session.messages.length - 1]?.timestamp ?? session.createdAt;
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

/** History only. Tab buffers stay in memory; the CLI mirror must not close files. */
export function slimSessionsForDisk(sessions: ChatSession[]): ChatSession[] {
	return sessions.map(session => ({
		...session,
		tabs: [],
		origin: session.origin ?? 'desktop',
	}));
}
