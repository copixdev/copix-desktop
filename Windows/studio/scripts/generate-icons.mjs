/**
 * Regenerate Windows .ico (edge-to-edge 16, 32, 48, 256) and macOS .icns
 * from repo-root icon.png. Requires: pip install pillow
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(studio, '..', '..', 'scripts', 'render-desktop-icons.py');
const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

let lastStatus = 1;
for (const bin of candidates) {
	const result = spawnSync(bin, [script], { stdio: 'inherit' });
	if (result.error?.code === 'ENOENT') continue;
	lastStatus = result.status ?? 1;
	if (result.status === 0) process.exit(0);
	process.exit(lastStatus);
}

console.error('Python 3 is required to render desktop icons');
process.exit(lastStatus);
