import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(root, 'dist', 'index.html');
const distElectronMain = path.join(root, 'dist-electron', 'main.js');

function built() {
	return fs.existsSync(distIndex) && fs.existsSync(distElectronMain);
}

if (!built()) {
	console.error('[copix] Studio UI is not built yet — running npm run build…');
	const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
		cwd: root,
		stdio: 'inherit',
		shell: true,
	});
	if (result.status !== 0 || !built()) {
		console.error('[copix] Build failed. Fix errors, then retry.');
		console.error('');
		console.error('  Development:  npm run studio');
		console.error('  Test launch:  npm run studio:test');
		console.error('  Production:   npm run build && npm start');
		process.exit(result.status || 1);
	}
}
