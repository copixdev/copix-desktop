/**
 * Prepare release/staging before electron-builder (macOS-only).
 */
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'release', 'staging');

function killUnix(pattern) {
	spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' });
}

if (process.platform === 'darwin') {
	killUnix('Copix.app');
	killUnix('[e]lectron');
}

function tryRemove(dir) {
	if (!existsSync(dir)) return true;
	try {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 });
		return !existsSync(dir);
	} catch {
		return false;
	}
}

tryRemove(staging);
console.log('[pre-dist] Ready — output: release/staging (macOS)');
