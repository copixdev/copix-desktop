/**

 * afterPack — brand Copix.exe and organize the install folder like Cursor:

 * VisualElementsManifest, Start Menu tiles, policies/tools, no Electron license file.

 */

const ResEdit = require('resedit');

const path = require('node:path');

const fs = require('node:fs');



function parseVersion(v) {

	const parts = String(v || '1.0.0').split(/[^\d]+/).filter(Boolean).map(n => Number(n) || 0);

	while (parts.length < 4) parts.push(0);

	return parts.slice(0, 4);

}



function copyIfExists(from, to) {

	if (!fs.existsSync(from)) return false;

	fs.mkdirSync(path.dirname(to), { recursive: true });

	fs.copyFileSync(from, to);

	return true;

}



function organizeInstallFolder(context, exeName) {

	const appOutDir = context.appOutDir;

	const buildDir = path.join(context.packager.projectDir, 'build');

	const product = context.packager.appInfo.productFilename;



	// Start Menu tile manifest + logos (sibling of Copix.exe).

	copyIfExists(

		path.join(buildDir, `${product}.VisualElementsManifest.xml`),

		path.join(appOutDir, `${product}.VisualElementsManifest.xml`),

	);

	copyIfExists(path.join(buildDir, `${product}_150.png`), path.join(appOutDir, `${product}_150.png`));

	copyIfExists(path.join(buildDir, `${product}_70.png`), path.join(appOutDir, `${product}_70.png`));



	// Standard folders like Cursor: policies/, tools/

	const policiesSrc = path.join(buildDir, 'policies');

	if (fs.existsSync(policiesSrc)) {

		fs.cpSync(policiesSrc, path.join(appOutDir, 'policies'), { recursive: true });

	} else {

		fs.mkdirSync(path.join(appOutDir, 'policies'), { recursive: true });

	}



	const toolsSrc = path.join(buildDir, 'tools');

	if (fs.existsSync(toolsSrc)) {

		fs.cpSync(toolsSrc, path.join(appOutDir, 'tools'), { recursive: true });

	} else {

		fs.mkdirSync(path.join(appOutDir, 'tools'), { recursive: true });

	}



	// Remove Electron-branded license file from install root.

	const electronLicense = path.join(appOutDir, 'LICENSE.electron.txt');

	if (fs.existsSync(electronLicense)) {

		fs.unlinkSync(electronLicense);

		console.log('[brand] Removed LICENSE.electron.txt from install root');

	}



	// Icon is embedded in Copix.exe — no loose icon.ico in resources/.

	const looseIcon = path.join(appOutDir, 'resources', 'icon.ico');

	if (fs.existsSync(looseIcon)) {

		fs.unlinkSync(looseIcon);

		console.log('[brand] Removed resources/icon.ico (embedded in exe)');

	}



	console.log('[brand] Install folder organized:', appOutDir);

}



exports.default = async function afterPack(context) {

	if (context.electronPlatformName !== 'win32') return;



	const exeName = `${context.packager.appInfo.productFilename}.exe`;

	const exePath = path.join(context.appOutDir, exeName);

	if (!fs.existsSync(exePath)) {

		console.warn('[brand] exe not found:', exePath);

		return;

	}



	const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

	const [maj, min, pat, build] = parseVersion(context.packager.appInfo.version);



	console.log('[brand] Stamping Copix PE metadata on', exePath);



	const data = fs.readFileSync(exePath);

	const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });

	const res = ResEdit.NtExecutableResource.from(exe);



	const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);

	const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();

	vi.setFileVersion(maj, min, pat, build, 1033);

	vi.setProductVersion(maj, min, pat, build, 1033);

	vi.setStringValues(

		{ lang: 1033, codepage: 1200 },

		{

			CompanyName: 'EJH-BAE',

			FileDescription: 'Copix',

			ProductName: 'Copix',

			InternalName: 'Copix',

			OriginalFilename: 'Copix.exe',

			LegalCopyright: 'Copyright © EJH-BAE',

			ProductVersion: `${maj}.${min}.${pat}.${build}`,

			FileVersion: `${maj}.${min}.${pat}.${build}`,

		},

	);

	vi.outputToResourceEntries(res.entries);



	if (fs.existsSync(iconPath)) {

		try {

			const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));

			const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);

			const groupId = groups.length ? groups[0].id : 1;

			ResEdit.Resource.IconGroupEntry.replaceIconsForResource(

				res.entries,

				groupId,

				1033,

				iconFile.icons.map((item) => item.data),

			);

			console.log('[brand] Icon replaced (group', groupId, ')');

		} catch (err) {

			console.warn('[brand] Icon replace skipped:', err instanceof Error ? err.message : err);

		}

	}



	res.outputResource(exe);

	fs.writeFileSync(exePath, Buffer.from(exe.generate()));

	console.log('[brand] Done — FileDescription/ProductName = Copix');



	organizeInstallFolder(context, exeName);

};


