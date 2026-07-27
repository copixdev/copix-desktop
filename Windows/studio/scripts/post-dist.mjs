/**
 * Copy installer artifacts from release/staging to release/ for easy discovery.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'release', 'staging');
const release = path.join(root, 'release');

if (!existsSync(staging)) {
	console.warn('[post-dist] No staging folder — skip copy');
	process.exit(0);
}

mkdirSync(release, { recursive: true });

for (const name of readdirSync(staging)) {
	if (!/\.(exe|blockmap)$/i.test(name)) continue;
	const from = path.join(staging, name);
	const to = path.join(release, name);
	copyFileSync(from, to);
	console.log('[post-dist] Copied', name, '→ release/');
}

const unpacked = path.join(staging, 'win-unpacked', 'Copix.exe');
if (existsSync(unpacked)) {
	console.log('[post-dist] App folder:', path.join(staging, 'win-unpacked'));
}
