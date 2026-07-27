/**
 * afterPack — macOS packaging polish (Windows PE branding removed; Copix is Mac-only).
 */
const path = require('node:path');
const fs = require('node:fs');

function copyIfExists(from, to) {
	if (!fs.existsSync(from)) return false;
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
	return true;
}

function organizeMacApp(context) {
	const appOutDir = context.appOutDir;
	const buildDir = path.join(context.packager.projectDir, 'build');

	const toolsSrc = path.join(buildDir, 'tools');
	if (fs.existsSync(toolsSrc)) {
		fs.cpSync(toolsSrc, path.join(appOutDir, 'tools'), { recursive: true });
	}

	const policiesSrc = path.join(buildDir, 'policies');
	if (fs.existsSync(policiesSrc)) {
		fs.cpSync(policiesSrc, path.join(appOutDir, 'policies'), { recursive: true });
	}

	const electronLicense = path.join(appOutDir, 'LICENSE.electron.txt');
	if (fs.existsSync(electronLicense)) {
		fs.unlinkSync(electronLicense);
		console.log('[brand] Removed LICENSE.electron.txt');
	}

	console.log('[brand] macOS app folder organized:', appOutDir);
}

exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== 'darwin') {
		console.warn('[brand] Skipping afterPack — Copix is macOS-only (got', context.electronPlatformName + ')');
		return;
	}
	organizeMacApp(context);
};
