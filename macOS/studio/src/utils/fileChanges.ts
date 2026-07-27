import type { ChatActivity } from '../chatActivity';
import type { ChatMessage } from '../types';
import { looksLikeSecret } from './secrets';
import { shouldHideWorkspacePath } from './workspaceIgnore';

export interface FileChange {
	path: string;
	name: string;
	added: number;
	removed: number;
	preview?: string;
}

export function collectFileChanges(activities?: ChatActivity[]): FileChange[] {
	if (!activities?.length) return [];
	const map = new Map<string, FileChange>();
	for (const a of activities) {
		if (a.kind !== 'edit' && a.kind !== 'create') continue;
		const path = a.fullTarget || a.target;
		if (!path) continue;
		if (looksLikeSecret(path)) continue;
		if (shouldHideWorkspacePath(path)) continue;
		const name = path.replace(/\\/g, '/').split('/').pop() || path;
		if (looksLikeSecret(name)) continue;
		const prev = map.get(path) ?? { path, name, added: 0, removed: 0 };
		prev.added += a.diff?.added ?? (a.kind === 'create' ? 1 : 0);
		prev.removed += a.diff?.removed ?? 0;
		if (a.diff?.preview) {
			prev.preview = prev.preview
				? `${prev.preview}\n${a.diff.preview}`
				: a.diff.preview;
		} else if (a.detail && !prev.preview) {
			prev.preview = a.detail;
		}
		map.set(path, prev);
	}
	return [...map.values()];
}

export function collectSessionChanges(messages: ChatMessage[]): FileChange[] {
	const all = messages.flatMap(m => m.activities ?? []);
	return collectFileChanges(all);
}

export function sumChanges(files: FileChange[]): { added: number; removed: number } {
	return files.reduce(
		(acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
		{ added: 0, removed: 0 },
	);
}

export function fileGlyph(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return '⚛';
	if (lower.endsWith('.ts') || lower.endsWith('.js')) return 'JS';
	if (lower.endsWith('.css') || lower.endsWith('.scss')) return '#';
	if (lower.endsWith('.json')) return '{}';
	if (lower.endsWith('.md')) return 'MD';
	if (lower.endsWith('.py')) return 'Py';
	if (lower.endsWith('.html')) return '<>';
	return '·';
}
