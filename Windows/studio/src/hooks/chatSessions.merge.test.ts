import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSessionStores, type ChatSession } from './chatSessions';

function session(partial: Partial<ChatSession> & Pick<ChatSession, 'id'>): ChatSession {
	return {
		title: 'agent',
		createdAt: 1,
		messages: [],
		tabs: [],
		...partial,
	};
}

test('refocus merge keeps the open file, unsaved text, and active path', () => {
	const live = session({
		id: 'agent-1',
		updatedAt: 50,
		activePath: 'src/main.ts',
		tabs: [
			{ path: 'src/main.ts', content: 'draft that is not saved', dirty: true },
			{ path: 'README.md', content: '# Copix', dirty: false },
		],
	});
	// saveSessions() mirrors history to disk with tabs stripped and the same stamp.
	const disk = session({
		id: 'agent-1',
		updatedAt: 50,
		origin: 'desktop',
		activePath: 'src/main.ts',
		tabs: [],
	});

	const merged = mergeSessionStores([live], [disk]);

	assert.equal(merged.length, 1);
	assert.equal(merged[0]?.activePath, 'src/main.ts');
	assert.deepEqual(merged[0]?.tabs, live.tabs);
});

test('a newer CLI history snapshot still does not close the desktop editor', () => {
	const live = session({
		id: 'agent-1',
		updatedAt: 10,
		activePath: 'notes.md',
		tabs: [{ path: 'notes.md', content: 'half written', dirty: true }],
		messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 10 }],
	});
	const disk = session({
		id: 'agent-1',
		updatedAt: 80,
		origin: 'cli',
		tabs: [],
		messages: [
			{ id: 'm1', role: 'user', content: 'hi', timestamp: 10 },
			{ id: 'm2', role: 'assistant', content: 'hello from cli', timestamp: 80 },
		],
	});

	const merged = mergeSessionStores([live], [disk]);

	assert.equal(merged[0]?.messages.length, 2);
	assert.equal(merged[0]?.messages[1]?.content, 'hello from cli');
	assert.deepEqual(merged[0]?.tabs, live.tabs);
	assert.equal(merged[0]?.activePath, 'notes.md');
});

test('closing the last tab stays closed across an equal-stamp merge', () => {
	const live = session({ id: 'agent-1', updatedAt: 5, tabs: [], activePath: undefined });
	const disk = session({ id: 'agent-1', updatedAt: 5, tabs: [], activePath: undefined });

	const merged = mergeSessionStores([live], [disk]);

	assert.deepEqual(merged[0]?.tabs, []);
	assert.equal(merged[0]?.activePath, undefined);
});

test('dirty local buffers win over a clean tab list with a newer stamp', () => {
	const live = session({
		id: 'agent-1',
		updatedAt: 10,
		activePath: 'a.ts',
		tabs: [{ path: 'a.ts', content: 'local edit', dirty: true }],
	});
	const disk = session({
		id: 'agent-1',
		updatedAt: 40,
		activePath: 'b.ts',
		tabs: [{ path: 'b.ts', content: 'saved on disk', dirty: false }],
	});

	const merged = mergeSessionStores([live], [disk]);

	assert.equal(merged[0]?.activePath, 'a.ts');
	assert.equal(merged[0]?.tabs[0]?.content, 'local edit');
	assert.equal(merged[0]?.updatedAt, 40);
});
