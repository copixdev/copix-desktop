/** Files and folders hidden from the workspace tree, @-mentions, and changes panel. */

const HIDDEN_DIRS = new Set([
	'node_modules',
	'.git',
	'out',
	'dist',
	'dist-electron',
	'.copix',
	'__pycache__',
	'.venv',
	'venv',
	'.idea',
	'.vscode',
	'.cursor',
	'coverage',
	'.next',
	'.nuxt',
	'release',
	'win-unpacked',
	'.cache',
	'.turbo',
	'.pytest_cache',
	'htmlcov',
	'.eggs',
	'tools',
	'output',
	'.husky',
]);

const HIDDEN_FILE_NAMES = new Set([
	'.env',
	'.env.local',
	'.env.production',
	'.env.development',
	'.env.test',
	'.npmrc',
	'.netrc',
	'.htpasswd',
	'credentials.json',
	'secrets.json',
	'secrets.yaml',
	'secrets.yml',
	'service-account.json',
	'google-services.json',
	'GoogleService-Info.plist',
	'copix-config.json',
	'id_rsa',
	'id_rsa.pub',
	'id_dsa',
	'id_ecdsa',
	'id_ed25519',
]);

const HIDDEN_EXTENSIONS = [
	'.pem',
	'.key',
	'.p12',
	'.pfx',
	'.kdbx',
	'.sqlite',
	'.db',
];

const SENSITIVE_NAME_RE = [
	/^\.env(\..+)?$/i,
	/secret/i,
	/credential/i,
	/password/i,
	/private[_-]?key/i,
	/service[_-]?role/i,
	/supabase.*key/i,
	/api[_-]?key/i,
	/token\.json$/i,
];

function basename(entryPath: string): string {
	const normalized = entryPath.replace(/\\/g, '/').replace(/\/+$/, '');
	return normalized.split('/').pop() || entryPath;
}

export function shouldHideWorkspaceEntry(name: string, isDirectory: boolean): boolean {
	if (!name || name === '.' || name === '..') return true;
	if (name.startsWith('.')) {
		if (name === '.env.example' || name === '.env.sample') return false;
		return true;
	}
	if (isDirectory && HIDDEN_DIRS.has(name)) return true;
	if (!isDirectory && HIDDEN_FILE_NAMES.has(name)) return true;
	if (!isDirectory) {
		const lower = name.toLowerCase();
		if (HIDDEN_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
		if (SENSITIVE_NAME_RE.some(re => re.test(name))) return true;
	}
	return false;
}

export function shouldHideWorkspacePath(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
	if (!normalized) return false;
	const parts = normalized.split('/');
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const isDir = i < parts.length - 1 || relativePath.endsWith('/');
		if (shouldHideWorkspaceEntry(part, isDir)) return true;
	}
	const base = basename(normalized);
	if (shouldHideWorkspaceEntry(base, false)) return true;
	return false;
}

export function isSensitiveWorkspacePath(relativePath: string): boolean {
	return shouldHideWorkspacePath(relativePath);
}

export function filterVisibleWorkspacePaths(paths: string[]): string[] {
	return paths.filter(p => !shouldHideWorkspacePath(p));
}
