/**
 * Install Electron binary into node_modules/electron/dist.
 * macOS extracts as Electron.app — not a bare "electron" file.
 */
import { downloadArtifact } from '@electron/get';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function platformRelativeBinary() {
	switch (process.platform) {
		case 'darwin':
			return 'Electron.app/Contents/MacOS/Electron';
		case 'win32':
			return 'electron.exe';
		default:
			return 'electron';
	}
}

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

	// macOS: ditto preserves .app bundle + executable bits better than JS unzippers.
	if (process.platform === 'darwin') {
		const ditto = spawnSync('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'inherit' });
		if (ditto.status === 0) return;
		console.warn('[copix] ditto failed, falling back to unzip');
	}

	const unzip = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
	if (unzip.status === 0) return;

	const extract = (await import('extract-zip')).default;
	await extract(zipPath, { dir: path.resolve(destDir) });
}

function chmodElectronBinary(distDir, relativeBinary) {
	const exe = path.join(distDir, relativeBinary);
	if (!fs.existsSync(exe)) return;
	try {
		fs.chmodSync(exe, 0o755);
	} catch { /* ignore */ }

	// Ensure the whole .app is usable
	if (process.platform === 'darwin') {
		const app = path.join(distDir, 'Electron.app');
		if (fs.existsSync(app)) {
			spawnSync('chmod', ['-R', 'u+rwX', app], { stdio: 'ignore' });
			spawnSync('xattr', ['-dr', 'com.apple.quarantine', app], { stdio: 'ignore' });
		}
	}
}

async function main() {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
	const distDir = path.join(electronDir, 'dist');
	const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
	const relativeBinary = platformRelativeBinary();
	const exe = path.join(distDir, relativeBinary);

	if (fs.existsSync(exe)) {
		if (!fs.existsSync(path.join(electronDir, 'path.txt'))) {
			fs.writeFileSync(path.join(electronDir, 'path.txt'), relativeBinary);
		}
		chmodElectronBinary(distDir, relativeBinary);
		console.log('[copix] Electron OK');
		return;
	}

	console.log(`[copix] Downloading Electron ${pkg.version} (${process.platform}-${process.arch})…`);
	const zip = await downloadArtifact({
		version: pkg.version,
		artifactName: 'electron',
		platform: process.platform,
		arch: process.arch,
	});
	console.log('[copix] Extracting…');
	await extractZip(zip, distDir);
	fs.writeFileSync(path.join(electronDir, 'path.txt'), relativeBinary);
	chmodElectronBinary(distDir, relativeBinary);

	if (!fs.existsSync(exe)) {
		const listing = fs.existsSync(distDir)
			? fs.readdirSync(distDir).slice(0, 20).join(', ')
			: '(missing dist/)';
		throw new Error(
			`electron binary missing after extract (expected dist/${relativeBinary}). Found: ${listing}`,
		);
	}
	console.log('[copix] Electron ready:', relativeBinary);
}

main().catch(err => {
	console.error('[copix]', err.message || err);
	process.exit(1);
});
