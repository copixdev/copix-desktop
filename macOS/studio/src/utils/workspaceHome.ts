import os from 'node:os';
import path from 'node:path';

export function resolveUsername(userHome: string): string {
	return process.env.USER
		|| process.env.USERNAME
		|| os.userInfo().username
		|| path.basename(userHome)
		|| 'user';
}

/** Expand ~/Copix/settings.json workspace.homeDirectory to an absolute path. */
export function expandWorkspaceHome(raw: string | undefined, userHome: string): string {
	let home = raw?.trim() ?? '';
	if (!home || /copix-output/i.test(home.replace(/\\/g, '/'))) {
		return path.normalize(userHome);
	}

	const username = resolveUsername(userHome);
	home = home.replace(/\{username\}/gi, username);
	home = home.replace(/%USERNAME%/gi, username);
	home = home.replace(/%USERPROFILE%/gi, userHome);

	if (home.startsWith('~')) {
		home = path.join(userHome, home.slice(1).replace(/^[/\\]+/, ''));
	}

	return path.normalize(home);
}
