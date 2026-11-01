export const THEME_IDS = [
	'paper-light',
	'paper-dark',
	'glass-frost',
	'glass-smoke',
	'terminal-ink',
	'terminal-bone',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const ACCENT_IDS = ['indigo-teal', 'plum-amber'] as const;

export type AccentId = (typeof ACCENT_IDS)[number];

export interface ThemeState {
	theme: ThemeId;
	accent: AccentId | null;
}

export const STORAGE_KEY = 'copix.theme';

export const DEFAULT_THEME: ThemeState = {
	theme: 'paper-light',
	accent: null,
};

const VARIANTS: Record<ThemeId, { concept: string; theme: string; mode: 'light' | 'dark' }> = {
	'paper-light': { concept: 'paper', theme: 'light', mode: 'light' },
	'paper-dark': { concept: 'paper', theme: 'dark', mode: 'dark' },
	'glass-frost': { concept: 'glass', theme: 'frost', mode: 'light' },
	'glass-smoke': { concept: 'glass', theme: 'smoke', mode: 'dark' },
	'terminal-ink': { concept: 'terminal', theme: 'ink', mode: 'dark' },
	'terminal-bone': { concept: 'terminal', theme: 'bone', mode: 'light' },
};

function isThemeId(value: string): value is ThemeId {
	return (THEME_IDS as readonly string[]).includes(value);
}

function isAccentId(value: string): value is AccentId {
	return (ACCENT_IDS as readonly string[]).includes(value);
}

export function readStoredTheme(): ThemeState | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { theme?: unknown; accent?: unknown };
		if (typeof parsed.theme !== 'string' || !isThemeId(parsed.theme)) return null;
		const accent = typeof parsed.accent === 'string' && isAccentId(parsed.accent) ? parsed.accent : null;
		return { theme: parsed.theme, accent };
	} catch {
		return null;
	}
}

function persist(state: ThemeState) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* private mode or a blocked store */
	}
}

/** Sets data-concept, data-theme, data-mode, and data-accent on the root and persists them. */
export function applyTheme(next: Partial<ThemeState>, root: HTMLElement = document.documentElement): ThemeState {
	const prev = readStoredTheme() ?? DEFAULT_THEME;
	const requested = next.theme ?? prev.theme;
	const theme = isThemeId(requested) ? requested : DEFAULT_THEME.theme;
	const accent = next.accent === undefined ? prev.accent : next.accent;
	const state: ThemeState = {
		theme,
		accent: accent && isAccentId(accent) ? accent : null,
	};
	const variant = VARIANTS[state.theme];
	root.dataset.concept = variant.concept;
	root.dataset.theme = variant.theme;
	root.dataset.mode = variant.mode;
	if (state.accent) root.dataset.accent = state.accent;
	else delete root.dataset.accent;
	persist(state);
	return state;
}

/** Mirrors prefers-reduced-motion. [data-reduce="1"] zeros durations and caret/blink animations. */
export function setReducedMotion(reduced: boolean, root: HTMLElement = document.documentElement): void {
	if (reduced) root.dataset.reduce = '1';
	else delete root.dataset.reduce;
}

export function bindReducedMotion(root: HTMLElement = document.documentElement): () => void {
	if (typeof matchMedia !== 'function') return () => {};
	const query = matchMedia('(prefers-reduced-motion: reduce)');
	const apply = () => setReducedMotion(query.matches, root);
	apply();
	query.addEventListener('change', apply);
	return () => query.removeEventListener('change', apply);
}

export function initTheme(root: HTMLElement = document.documentElement): ThemeState {
	const state = applyTheme(readStoredTheme() ?? DEFAULT_THEME, root);
	bindReducedMotion(root);
	return state;
}
