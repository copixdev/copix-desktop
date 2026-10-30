import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { contrastRatio, parseStylesheet, resolveTokens, resolveValue, solidColor, type ThemeCtx } from './contrast';

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, 'tokens.css'), 'utf8');
const fonts = readFileSync(join(root, 'fonts.css'), 'utf8');
const table = readFileSync(join(root, 'TOKENS.md'), 'utf8');
const rules = parseStylesheet(css);

const THEMES: Record<string, Pick<ThemeCtx, 'concept' | 'theme' | 'mode'>> = {
	'paper-light': { concept: 'paper', theme: 'light', mode: 'light' },
	'paper-dark': { concept: 'paper', theme: 'dark', mode: 'dark' },
	'glass-frost': { concept: 'glass', theme: 'frost', mode: 'light' },
	'glass-smoke': { concept: 'glass', theme: 'smoke', mode: 'dark' },
	'terminal-ink': { concept: 'terminal', theme: 'ink', mode: 'dark' },
	'terminal-bone': { concept: 'terminal', theme: 'bone', mode: 'light' },
};

interface Pair {
	theme: string;
	accent: string;
	fg: string;
	bg: string;
	ratio: number;
	need: number;
}

function pairs(): Pair[] {
	const found: Pair[] = [];
	const re = /^\|\s*([a-z-]+)\s*\|\s*([a-z-]+)\s*\|\s*([a-z_]+)\s*\|\s*([a-z0-9_]+)\s*\|[^|]*\|[^|]*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/gm;
	for (const match of table.matchAll(re)) {
		found.push({
			theme: match[1]!,
			accent: match[2]!,
			fg: match[3]!,
			bg: match[4]!,
			ratio: Number(match[5]),
			need: Number(match[6]),
		});
	}
	return found;
}

function ctxFor(pair: Pair, reduce = false): ThemeCtx {
	const theme = THEMES[pair.theme];
	if (!theme) throw new Error(`Unknown theme ${pair.theme}`);
	return {
		...theme,
		accent: pair.accent === 'base' ? null : pair.accent,
		reduce,
	};
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

test('every TOKENS.md pair meets its contrast ratio', () => {
	const rows = pairs();
	assert.equal(rows.length, 102);
	for (const row of rows) {
		const tokens = resolveTokens(rules, ctxFor(row));
		const ratio = contrastRatio(solidColor(row.fg, tokens), solidColor(row.bg, tokens));
		assert.equal(round2(ratio), row.ratio, `${row.theme} ${row.accent} ${row.fg} on ${row.bg}`);
		assert.ok(ratio + 1e-9 >= row.need, `${row.theme} ${row.fg} on ${row.bg} ${ratio} < ${row.need}`);
	}
});

test('glass solid fallback keeps the same pairs at or above their threshold', () => {
	const rows = pairs().filter(row => row.theme.startsWith('glass-'));
	assert.ok(rows.length > 0);
	for (const row of rows) {
		const tokens = resolveTokens(rules, ctxFor(row), true);
		for (const prop of ['--pan', '--sub', '--addbg', '--delbg']) {
			assert.equal(parseAlpha(tokens[prop]!), 1, prop);
		}
		const ratio = contrastRatio(solidColor(row.fg, tokens), solidColor(row.bg, tokens));
		assert.ok(ratio + 1e-9 >= row.need, `${row.theme} fallback ${row.fg} on ${row.bg} ${ratio} < ${row.need}`);
	}
});

function parseAlpha(value: string): number {
	if (value.trim().startsWith('#')) return 1;
	const match = value.match(/rgba?\([^)]+\)/i);
	if (!match) return 1;
	const parts = match[0].slice(match[0].indexOf('(') + 1, -1).split(',').map(part => part.trim());
	return parts.length === 4 ? Number(parts[3]) : 1;
}

test('mono stack falls through to Pretendard before a system font', () => {
	const tokens = resolveTokens(rules, ctxFor({ theme: 'terminal-ink', accent: 'base', fg: 'text', bg: 'bg', ratio: 0, need: 0 }));
	for (const name of ['--font-mono', '--mono']) {
		const stack = resolveValue(tokens[name]!, tokens);
		const pretendard = stack.indexOf('Pretendard');
		const system = stack.indexOf('ui-monospace');
		assert.ok(stack.startsWith('"Geist Mono"'), name);
		assert.ok(pretendard > 0 && pretendard < system, stack);
	}
	const ui = resolveValue(tokens['--ui']!, tokens);
	assert.ok(ui.startsWith('"Pretendard Variable"'));
});

test('reduced motion zeros durations and disables caret and blink', () => {
	const media = rules.find(rule => rule.at?.includes('prefers-reduced-motion') && rule.selector === ':root');
	const manual = rules.find(rule => !rule.at && rule.selector === '[data-reduce="1"]');
	assert.ok(media && manual);
	for (const rule of [media, manual]) {
		assert.equal(rule.decls['--dur-fast'], '0ms');
		assert.equal(rule.decls['--dur-med'], '0ms');
		assert.equal(rule.decls['--dur-slow'], '0ms');
		assert.equal(rule.decls['--dur-sweep'], '0ms');
		assert.equal(rule.decls['--anim-caret'], 'none');
		assert.equal(rule.decls['--anim-blink'], 'none');
	}
	const utility = rules.find(rule => rule.at?.includes('prefers-reduced-motion') && rule.selector.includes('.u-caret'));
	const manualUtility = rules.find(rule => !rule.at && rule.selector.includes('[data-reduce="1"] .u-caret'));
	assert.equal(utility?.decls.animation, 'none');
	assert.equal(manualUtility?.decls.animation, 'none');
	const live = resolveTokens(rules, { ...THEMES['paper-light']!, accent: null, reduce: true });
	assert.equal(live['--anim-caret'], 'none');
	assert.equal(live['--anim-blink'], 'none');
	assert.equal(live['--dur-sweep'], '0ms');
});

test('fonts are self-hosted OFL files', () => {
	assert.equal(/https?:|url\(\s*\/\//.test(css + fonts), false);
	const urls = [...fonts.matchAll(/url\("(\.\/fonts\/[^"]+)"\)/g)].map(match => match[1]!);
	assert.ok(urls.length > 8);
	for (const url of urls) {
		assert.ok(existsSync(join(root, url.slice(2))), url);
	}
	const families = ['pretendard', 'suit', 'inter', 'geist-mono', 'jetbrains-mono', 'fraunces', 'newsreader', 'noto-serif-kr'];
	for (const family of families) {
		const license = readFileSync(join(root, 'fonts', family, 'OFL.txt'), 'utf8');
		assert.match(license, /SIL Open Font License/i);
		assert.ok(readdirSync(join(root, 'fonts', family)).some(name => name.endsWith('.woff2')));
	}
	for (const family of ['Pretendard Variable', 'Pretendard', 'SUIT Variable', 'Inter', 'Geist Mono', 'JetBrains Mono', 'Fraunces', 'Newsreader', 'Noto Serif KR']) {
		assert.ok(fonts.includes(`font-family: "${family}"`), family);
	}
});
