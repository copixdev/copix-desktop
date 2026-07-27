const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const pathTxt = path.join(electronDir, 'path.txt');
const exe = path.join(distDir, process.platform === 'win32' ? 'electron.exe' : 'electron');

async function main() {
	if (fs.existsSync(pathTxt) && fs.existsSync(exe)) {
		console.log('[copix] Electron OK');
		return;
	}

	const pkg = require(path.join(electronDir, 'package.json'));
	console.log(`[copix] Installing Electron ${pkg.version}…`);

	const zip = await downloadArtifact({
		version: pkg.version,
		artifactName: 'electron',
		platform: process.platform,
		arch: process.arch,
	});

	fs.rmSync(distDir, { recursive: true, force: true });
	fs.mkdirSync(distDir, { recursive: true });
	await extract(zip, { dir: path.resolve(distDir) });

	const platformPath = process.platform === 'win32' ? 'electron.exe' : 'electron';
	fs.writeFileSync(pathTxt, platformPath);
	console.log('[copix] Electron ready:', exe);
}

main().catch(err => {
	console.error('[copix] Electron install failed:', err.message);
	console.error('Try: cd studio && node scripts/ensure-electron.cjs');
	process.exit(0);
});
