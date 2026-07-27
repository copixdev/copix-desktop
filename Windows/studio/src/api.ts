import type { CopixApi, TrainingStatus, SetupProgress } from '../electron/preload';
import type { AppSettings } from './types';

export type { TrainingStatus, SetupProgress };

declare global {
	interface Window {
		copix: CopixApi;
	}
}

function missingCopixApi(): never {
	const msg = 'Copix preload API unavailable — restart the app (npm run dev or copix-studio.bat)';
	console.error('[copix]', msg);
	throw new Error(msg);
}

export const copix: CopixApi = window.copix ?? new Proxy({} as CopixApi, {
	get() {
		return () => missingCopixApi();
	},
});

export async function loadSettings(): Promise<AppSettings | null> {
	return copix.getSettings() as Promise<AppSettings | null>;
}
