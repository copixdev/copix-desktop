import { downloadArtifact } from '@electron/get';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function extractZip(zipPath, destDir) {
	fs.rmSync(destDir, { recursive: true, force: true });
	fs.mkdirSync(destDir, { recursive: true });

	if (process.platform === 'win32') {
		const ps = spawnSync('powershell', [
			'-NoProfile', '-Command',
			`Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
		], { stdio: 'inherit' });
		if (ps.status !== 0) throw new Error('Expand-Archive failed');
		return;
	}

	const extract = (await import('extract-zip')).default;
	await extract(zipPath, { dir: path.resolve(destDir) });
}

async function main() {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
	const distDir = path.join(electronDir, 'dist');
	const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
	const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron';
	const exe = path.join(distDir, exeName);

	if (fs.existsSync(exe)) {
		if (!fs.existsSync(path.join(electronDir, 'path.txt'))) {
			fs.writeFileSync(path.join(electronDir, 'path.txt'), exeName);
		}
		console.log('[copix] Electron OK');
		return;
	}

	console.log(`[copix] Downloading Electron ${pkg.version}…`);
	const zip = await downloadArtifact({
		version: pkg.version,
		artifactName: 'electron',
		platform: process.platform,
		arch: process.arch,
	});
	console.log('[copix] Extracting…');
	await extractZip(zip, distDir);
	fs.writeFileSync(path.join(electronDir, 'path.txt'), exeName);
	if (!fs.existsSync(exe)) throw new Error('electron binary missing after extract');
	console.log('[copix] Electron ready');
}

main().catch(err => {
	console.error('[copix]', err.message);
	process.exit(1);
});
