/**

 * Regenerate build/icon.ico, installer icons, Start Menu tiles, and favicon.

 * Requires: pip install pillow

 */

import { copyFileSync, existsSync } from 'node:fs';

import { spawnSync } from 'node:child_process';

import path from 'node:path';

import { fileURLToPath } from 'node:url';



const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const build = path.join(root, 'build');

const png = path.join(build, 'icon.png');

const ico = path.join(build, 'icon.ico');



if (!existsSync(png)) {

	console.error('Missing source icon:', png);

	process.exit(1);

}



const py = `

from PIL import Image

png = r"${png.replace(/\\/g, '\\\\')}"

build = r"${build.replace(/\\/g, '\\\\')}"

img = Image.open(png).convert('RGBA')



def tile(size, out):

    canvas = Image.new('RGBA', (size, size), (15, 15, 16, 255))

    mark = img.copy()

    mark.thumbnail((int(size * 0.62), int(size * 0.62)), Image.Resampling.LANCZOS)

    ox = (size - mark.width) // 2

    oy = (size - mark.height) // 2

    canvas.paste(mark, (ox, oy), mark)

    canvas.save(out, format='PNG')

    print('Wrote', out)



base = img.resize((256, 256), Image.Resampling.LANCZOS)

sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]

base.save(r"${ico.replace(/\\/g, '\\\\')}", format='ICO', sizes=sizes)

print('Wrote', r"${ico.replace(/\\/g, '\\\\')}")

tile(150, build + '/Copix_150.png')

tile(70, build + '/Copix_70.png')

`;



const result = spawnSync('python', ['-c', py], { stdio: 'inherit' });

if (result.status !== 0) {

	process.exit(result.status ?? 1);

}



copyFileSync(ico, path.join(build, 'installerIcon.ico'));

copyFileSync(png, path.join(root, 'public', 'favicon.png'));

console.log('Synced installerIcon.ico, Copix_150.png, Copix_70.png, favicon.png');


