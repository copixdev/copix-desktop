const { downloadArtifact } = require('@electron/get');
const { spawnSync } = require('node:child_process');
const extract = require('extract-zip');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const pathTxt = path.join(electronDir, 'path.txt');

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

const relativeBinary = platformRelativeBinary();
const exe = path.join(distDir, relativeBinary);

async function extractZip(zipPath) {
	fs.rmSync(distDir, { recursive: true, force: true });
	fs.mkdirSync(distDir, { recursive: true });

	if (process.platform === 'darwin') {
		const ditto = spawnSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' });
		if (ditto.status === 0) return;
	}

	const unzip = spawnSync('unzip', ['-o', zipPath, '-d', distDir], { stdio: 'inherit' });
	if (unzip.status === 0) return;

	await extract(zipPath, { dir: path.resolve(distDir) });
}

async function main() {
	if (fs.existsSync(pathTxt) && fs.existsSync(exe)) {
		console.log('[copix] Electron OK');
		return;
	}

	const pkg = require(path.join(electronDir, 'package.json'));
	console.log(`[copix] Installing Electron ${pkg.version} (${process.platform}-${process.arch})…`);

	const zip = await downloadArtifact({
		version: pkg.version,
		artifactName: 'electron',
		platform: process.platform,
		arch: process.arch,
	});

	await extractZip(zip);
	fs.writeFileSync(pathTxt, relativeBinary);

	if (process.platform === 'darwin' && fs.existsSync(path.join(distDir, 'Electron.app'))) {
		spawnSync('chmod', ['-R', 'u+rwX', path.join(distDir, 'Electron.app')], { stdio: 'ignore' });
		spawnSync('xattr', ['-dr', 'com.apple.quarantine', path.join(distDir, 'Electron.app')], { stdio: 'ignore' });
	}

	if (!fs.existsSync(exe)) {
		throw new Error(`electron binary missing after extract (expected dist/${relativeBinary})`);
	}
	console.log('[copix] Electron ready:', exe);
}

main().catch(err => {
	console.error('[copix] Electron install failed:', err.message);
	console.error('Try: cd studio && rm -rf node_modules/electron/dist && node scripts/install-electron.mjs');
	process.exit(1);
});
