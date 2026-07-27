/**

 * Regenerate build/icon.png (macOS squircle), favicon, and helper tiles.

 * Source: build/icon-source.png or build/icon.png

 * Requires: pip install pillow

 */

import { copyFileSync, existsSync } from 'node:fs';

import { spawnSync } from 'node:child_process';

import path from 'node:path';

import { fileURLToPath } from 'node:url';



const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const build = path.join(root, 'build');

const src = existsSync(path.join(build, 'icon-source.png'))
	? path.join(build, 'icon-source.png')
	: path.join(build, 'icon.png');

const out = path.join(build, 'icon.png');



if (!existsSync(src)) {

	console.error('Missing source icon:', src);

	process.exit(1);

}



const py = `

from PIL import Image, ImageDraw, ImageFilter

src = r"${src.replace(/\\/g, '\\\\')}"

build = r"${build.replace(/\\/g, '\\\\')}"

size = 1024

img = Image.open(src).convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)



ss = 4

m = Image.new('L', (size * ss, size * ss), 0)

draw = ImageDraw.Draw(m)

r = int(size * ss * 0.2237)

draw.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=r, fill=255)

mask = m.resize((size, size), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))



out = Image.new('RGBA', (size, size), (0, 0, 0, 0))

out.paste(img, (0, 0))

out.putalpha(mask)

out.save(r"${out.replace(/\\/g, '\\\\')}", format='PNG', optimize=True)

print('Wrote', r"${out.replace(/\\/g, '\\\\')}")



for dim, name in [(150, 'Copix_150.png'), (70, 'Copix_70.png')]:

    t = out.resize((dim, dim), Image.Resampling.LANCZOS)

    t.save(build + '/' + name, format='PNG', optimize=True)

    print('Wrote', name)

`;



const result = spawnSync('python3', ['-c', py], { stdio: 'inherit' });

if (result.status !== 0) {

	process.exit(result.status ?? 1);

}



copyFileSync(out, path.join(root, 'public', 'favicon.png'));

console.log('Synced favicon.png');

