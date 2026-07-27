import type { CopixApi } from '../electron/preload';
import type { AppSettings } from './types';

declare global {
	interface Window {
		copix: CopixApi;
	}
}

export {};
