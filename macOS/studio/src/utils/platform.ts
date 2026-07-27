/** Host platform helpers for Copix Studio (macOS-first). */

export type HostPlatform = 'darwin' | 'win32' | 'linux' | string;

let cached: HostPlatform | null = null;

export function getHostPlatform(): HostPlatform {
	if (cached) return cached;
	try {
		const p = window.copix?.getPlatform?.() ?? window.copix?.platform;
		if (typeof p === 'string' && p) {
			cached = p;
			return cached;
		}
	} catch { /* fall through */ }
	cached = 'darwin';
	return cached;
}

export function isMac(): boolean {
	return getHostPlatform() === 'darwin';
}

export function isWindows(): boolean {
	return getHostPlatform() === 'win32';
}

/** Display name for the integrated terminal shell. */
export function shellLabel(): string {
	if (isWindows()) return 'PowerShell';
	if (isMac()) return 'zsh';
	return 'bash';
}

/** Prompt prefix shown in the terminal (e.g. PS or $). */
export function shellPrompt(cwd: string): string {
	if (isWindows()) return `PS ${cwd}>`;
	return `${cwd} $`;
}

/** Example home path for settings placeholders / docs. */
export function homePathExample(): string {
	return '/Users/{username}';
}

/** Example project path used in agent prompts. */
export function projectPathExample(name = 'my-app'): string {
	return `/Users/{username}/${name}`;
}
