import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';

async function waitForDevWarmup(url: string, startup: () => void): Promise<void> {
	const targets = ['', 'src/main.tsx', '@vite/client'];
	const deadline = Date.now() + 120_000;
	let lastErr = '';

	while (Date.now() < deadline) {
		try {
			const results = await Promise.all(
				targets.map(async (p) => {
					const res = await fetch(`${url}${p}`, { signal: AbortSignal.timeout(15_000) });
					return res.ok;
				}),
			);
			if (results.every(Boolean)) {
				// Allow Vite to finish writing optimized dep bundles before Electron opens.
				await new Promise(r => setTimeout(r, 1500));
				console.log('[copix] Dev server warmup complete');
				startup();
				return;
			}
			lastErr = `HTTP checks: ${results.map((ok, i) => `${targets[i]}=${ok}`).join(', ')}`;
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		}
		await new Promise(r => setTimeout(r, 1000));
	}
	console.error('[copix] Dev server warmup timed out after 120s:', lastErr);
	startup();
}

export default defineConfig({
	base: './',
	server: {
		warmup: {
			clientFiles: ['./index.html', './src/main.tsx'],
		},
	},
	optimizeDeps: {
		holdUntilCrawlEnd: true,
		include: [
			'react',
			'react-dom',
			'react-dom/client',
			'react/jsx-dev-runtime',
			'react/jsx-runtime',
			'@monaco-editor/react',
			'monaco-editor',
			'react-markdown',
			'remark-gfm',
			'react-syntax-highlighter',
			'react-syntax-highlighter/dist/esm/styles/prism',
		],
	},
	plugins: [
		react(),
		renderer(),
		electron({
			main: {
				entry: 'electron/main.ts',
				onstart({ startup }) {
					const url = process.env.VITE_DEV_SERVER_URL;
					if (url) {
						console.log('[copix] Waiting for Vite dev server:', url);
						void waitForDevWarmup(url, startup);
					} else {
						startup();
					}
				},
			},
			preload: { input: 'electron/preload.ts' },
		}),
	],
});
