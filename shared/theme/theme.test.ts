import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { applyTheme, initTheme, readStoredTheme, setReducedMotion, STORAGE_KEY } from './theme';

afterEach(() => {
	localStorage.clear();
	const root = document.documentElement;
	delete root.dataset.concept;
	delete root.dataset.theme;
	delete root.dataset.mode;
	delete root.dataset.accent;
	delete root.dataset.reduce;
});

test('applyTheme sets root attributes and persists accent', () => {
	const state = applyTheme({ theme: 'glass-smoke', accent: 'plum-amber' });
	assert.deepEqual(state, { theme: 'glass-smoke', accent: 'plum-amber' });
	assert.equal(document.documentElement.dataset.concept, 'glass');
	assert.equal(document.documentElement.dataset.theme, 'smoke');
	assert.equal(document.documentElement.dataset.mode, 'dark');
	assert.equal(document.documentElement.dataset.accent, 'plum-amber');
	assert.deepEqual(readStoredTheme(), state);

	applyTheme({ theme: 'terminal-bone' });
	assert.equal(document.documentElement.dataset.concept, 'terminal');
	assert.equal(document.documentElement.dataset.theme, 'bone');
	assert.equal(document.documentElement.dataset.mode, 'light');
	assert.equal(document.documentElement.dataset.accent, 'plum-amber');

	applyTheme({ accent: null });
	assert.equal(document.documentElement.dataset.accent, undefined);
	assert.equal(readStoredTheme()?.accent, null);
});

test('initTheme restores the stored theme', () => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'paper-dark', accent: 'indigo-teal' }));
	const state = initTheme();
	assert.deepEqual(state, { theme: 'paper-dark', accent: 'indigo-teal' });
	assert.equal(document.documentElement.dataset.concept, 'paper');
	assert.equal(document.documentElement.dataset.theme, 'dark');
	assert.equal(document.documentElement.dataset.mode, 'dark');
});

test('setReducedMotion toggles data-reduce', () => {
	setReducedMotion(true);
	assert.equal(document.documentElement.dataset.reduce, '1');
	setReducedMotion(false);
	assert.equal(document.documentElement.dataset.reduce, undefined);
});
