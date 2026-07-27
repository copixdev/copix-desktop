import type { AgentMode } from './agentModes.js';

/** Always-available fallback when larger models are missing or low VRAM. */
export const FALLBACK_MODEL_ID = 'qwen2.5:3b';

/** Stretch-tier models Copix downloads and routes to by task. */
export const STRETCH_MODEL_IDS = [
	'qwen2.5-coder:7b',
	'mistral:7b',
	'qwen3.5:4b',
] as const;

/** Full set pulled by Copix on first run / Check Ollama. */
export const COPIX_MODEL_IDS = [FALLBACK_MODEL_ID, ...STRETCH_MODEL_IDS] as const;

export type CopixModelId = (typeof COPIX_MODEL_IDS)[number];

export type TaskKind = 'inspect' | 'implement' | 'debug' | 'terminal' | 'plan' | 'general';

/** Preferred model per agent mode when selection is auto (no message intent). */
export const MODE_MODEL_PREFERENCE: Record<AgentMode, CopixModelId | string> = {
	code: 'qwen2.5-coder:7b',
	debug: 'qwen3.5:4b',
	terminal: 'mistral:7b',
	plan: 'qwen3.5:4b',
};

/** Preferred model when user message intent is detected. */
export const TASK_MODEL_PREFERENCE: Record<TaskKind, string> = {
	inspect: 'qwen3.5:4b',
	plan: 'qwen3.5:4b',
	debug: 'qwen3.5:4b',
	implement: 'qwen2.5-coder:7b',
	terminal: 'mistral:7b',
	general: 'qwen3.5:4b',
};

export function modelTagBase(modelId: string): string {
	return modelId.split(':')[0] ?? modelId;
}

/** True if Ollama tags list includes this model (any tag variant). */
export function modelIsAvailable(modelId: string, installed: string[]): boolean {
	if (!modelId || !installed.length) return false;
	const base = modelTagBase(modelId);
	return installed.some(name => {
		const normalized = name.trim();
		if (!normalized) return false;
		if (normalized === modelId) return true;
		if (normalized.startsWith(`${base}:`)) return true;
		if (normalized.startsWith(`${modelId}:`)) return true;
		// Ollama sometimes lists "model" without tag when only one variant exists
		if (!modelId.includes(':') && normalized.split(':')[0] === modelId) return true;
		return false;
	});
}

export function missingCopixModels(installed: string[]): string[] {
	return COPIX_MODEL_IDS.filter(id => !modelIsAvailable(id, installed));
}

export function resolveInstalledModelId(preferred: string, installed: string[]): string | undefined {
	const candidates = [preferred, ...COPIX_MODEL_IDS.filter(id => id !== preferred)];
	for (const id of candidates) {
		if (modelIsAvailable(id, installed)) return id;
	}
	return undefined;
}
