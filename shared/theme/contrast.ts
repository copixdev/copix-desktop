export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface Rule {
	selector: string;
	decls: Record<string, string>;
	at: string | null;
}

export interface ThemeCtx {
	concept: string;
	theme: string;
	mode: 'light' | 'dark';
	accent: string | null;
	reduce: boolean;
}

const ROLES: Record<string, string> = {
	text: '--text',
	muted: '--muted',
	accent: '--accent',
	on_accent: '--on-accent',
	add: '--add',
	dl: '--dl',
	addfg: '--addfg',
	delfg: '--delfg',
	on_inv: '--on-inv',
	bg: '--bg',
	pan: '--pan',
	accent2: '--accent2',
	addbg: '--addbg',
	delbg: '--delbg',
	inv: '--inv',
};

export function parseColor(input: string): Rgba {
	const s = input.trim();
	const hex = s.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = hex[1];
		return {
			r: parseInt(n.slice(0, 2), 16),
			g: parseInt(n.slice(2, 4), 16),
			b: parseInt(n.slice(4, 6), 16),
			a: 1,
		};
	}
	const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
	if (!rgb) throw new Error(`Unparsed color: ${input}`);
	return {
		r: Number(rgb[1]),
		g: Number(rgb[2]),
		b: Number(rgb[3]),
		a: rgb[4] === undefined ? 1 : Number(rgb[4]),
	};
}

export function composite(fg: Rgba, bg: Rgba): Rgba {
	const a = fg.a;
	return {
		r: fg.r * a + bg.r * (1 - a),
		g: fg.g * a + bg.g * (1 - a),
		b: fg.b * a + bg.b * (1 - a),
		a: 1,
	};
}

function channel(c: number): number {
	const x = c / 255;
	return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(a: Rgba, b: Rgba): number {
	const lum = (c: Rgba) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
	const hi = Math.max(lum(a), lum(b));
	const lo = Math.min(lum(a), lum(b));
	return (hi + 0.05) / (lo + 0.05);
}

export function parseStylesheet(css: string): Rule[] {
	const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const rules: Rule[] = [];

	function walk(text: string, at: string | null) {
		let i = 0;
		while (i < text.length) {
			while (i < text.length && /\s/.test(text[i]!)) i++;
			if (i >= text.length) break;
			if (text[i] === '@') {
				const start = i;
				while (i < text.length && text[i] !== '{' && text[i] !== ';') i++;
				const prelude = text.slice(start, i).trim();
				if (text[i] === ';') {
					i++;
					continue;
				}
				i++;
				const innerStart = i;
				let depth = 1;
				while (i < text.length && depth > 0) {
					if (text[i] === '{') depth++;
					else if (text[i] === '}') depth--;
					i++;
				}
				const inner = text.slice(innerStart, i - 1);
				if (prelude.startsWith('@keyframes') || prelude.startsWith('@-webkit-keyframes')) continue;
				walk(inner, prelude);
				continue;
			}
			const selStart = i;
			while (i < text.length && text[i] !== '{') i++;
			const selector = text.slice(selStart, i).trim();
			i++;
			const bodyStart = i;
			let depth = 1;
			while (i < text.length && depth > 0) {
				if (text[i] === '{') depth++;
				else if (text[i] === '}') depth--;
				i++;
			}
			const body = text.slice(bodyStart, i - 1);
			const decls: Record<string, string> = {};
			for (const part of body.split(';')) {
				const idx = part.indexOf(':');
				if (idx === -1) continue;
				const prop = part.slice(0, idx).trim();
				const value = part.slice(idx + 1).trim();
				if (prop) decls[prop] = value;
			}
			if (selector) rules.push({ selector, decls, at });
		}
	}

	walk(src, null);
	return rules;
}

function matchOne(selector: string, ctx: ThemeCtx): boolean {
	if (/[ >+~]/.test(selector) || selector.startsWith('.')) return false;
	const attrs = [...selector.matchAll(/\[data-([a-z-]+)="([^"]+)"\]/gi)];
	if (attrs.length === 0) return selector === ':root';
	for (const [, key, value] of attrs) {
		const actual = key === 'concept' ? ctx.concept
			: key === 'theme' ? ctx.theme
			: key === 'mode' ? ctx.mode
			: key === 'accent' ? (ctx.accent ?? '')
			: key === 'reduce' ? (ctx.reduce ? '1' : '')
			: undefined;
		if (actual !== value) return false;
	}
	return true;
}

function matches(selector: string, ctx: ThemeCtx): boolean {
	return selector.split(',').some(part => matchOne(part.trim(), ctx));
}

function appliesAt(rule: Rule, ctx: ThemeCtx, fallback: boolean): boolean {
	if (!rule.at) return true;
	if (fallback && /@supports/i.test(rule.at) && /backdrop-filter/i.test(rule.at)) return true;
	if (ctx.reduce && /prefers-reduced-motion/i.test(rule.at)) return true;
	return false;
}

export function resolveTokens(rules: Rule[], ctx: ThemeCtx, fallback = false): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rule of rules) {
		if (!appliesAt(rule, ctx, fallback)) continue;
		if (!matches(rule.selector, ctx)) continue;
		Object.assign(out, rule.decls);
	}
	return out;
}

export function resolveValue(value: string, vars: Record<string, string>, seen = new Set<string>()): string {
	return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, name: string) => {
		if (seen.has(name) || vars[name] == null) return '';
		seen.add(name);
		return resolveValue(vars[name]!, vars, seen);
	});
}

export function solidColor(role: string, tokens: Record<string, string>, stack: string[] = []): Rgba {
	const prop = ROLES[role];
	if (!prop) throw new Error(`Unknown role ${role}`);
	const raw = tokens[prop];
	if (!raw) throw new Error(`Missing ${prop}`);
	const color = parseColor(resolveValue(raw, tokens));
	if (color.a >= 1) return color;
	if (stack.includes(role)) throw new Error(`Cycle resolving ${role}`);
	const backdropRole = role === 'addbg' || role === 'delbg' ? 'pan' : 'bg';
	return composite(color, solidColor(backdropRole, tokens, [...stack, role]));
}
