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

/** Preferred model per agent mode when selection is auto. */
export const MODE_MODEL_PREFERENCE: Record<AgentMode, CopixModelId | string> = {
	code: 'qwen2.5-coder:7b',
	debug: 'qwen3.5:4b',
	terminal: 'mistral:7b',
	plan: 'qwen3.5:4b',
};

export function modelTagBase(modelId: string): string {
	return modelId.split(':')[0] ?? modelId;
}

/** True if Ollama tags list includes this model (any tag variant). */
export function modelIsAvailable(modelId: string, installed: string[]): boolean {
	if (!modelId) return false;
	const base = modelTagBase(modelId);
	return installed.some(name => {
		if (name === modelId) return true;
		if (name.startsWith(`${base}:`)) return true;
		return name.startsWith(modelId);
	});
}

export function missingCopixModels(installed: string[]): string[] {
	return COPIX_MODEL_IDS.filter(id => !modelIsAvailable(id, installed));
}
