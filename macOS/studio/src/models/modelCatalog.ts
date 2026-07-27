import type { AgentMode } from './agentModes.js';

import type { ModelProvider } from '../types.js';

/** Always-available fallback when larger models are missing or low VRAM. */
export const FALLBACK_MODEL_ID = 'qwen2.5:3b';

/** Stretch-tier models Copix downloads and routes to by task (Ollama only). */
export const STRETCH_MODEL_IDS = [
	'qwen2.5-coder:7b',
	'mistral:7b',
	'qwen3.5:4b',
] as const;

/** Full set pulled on demand for Ollama (fallback pulled first on startup). */
export const COPIX_MODEL_IDS = [FALLBACK_MODEL_ID, ...STRETCH_MODEL_IDS] as const;

export type CopixModelId = (typeof COPIX_MODEL_IDS)[number];

export type TaskKind = 'inspect' | 'implement' | 'debug' | 'terminal' | 'plan' | 'general';

/** Ollama — preferred model per agent mode when selection is auto. */
export const MODE_MODEL_PREFERENCE: Record<AgentMode, CopixModelId | string> = {
	code: 'qwen2.5-coder:7b',
	debug: 'qwen3.5:4b',
	terminal: 'mistral:7b',
	plan: 'qwen3.5:4b',
};

export const TASK_MODEL_PREFERENCE: Record<TaskKind, string> = {
	inspect: 'qwen3.5:4b',
	plan: 'qwen3.5:4b',
	debug: 'qwen3.5:4b',
	implement: 'qwen2.5-coder:7b',
	terminal: 'mistral:7b',
	general: 'qwen3.5:4b',
};

/** Groq free tier — no download, instant (https://console.groq.com). */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Free-tier friendly models (higher TPM / smaller requests). Avoid gpt-oss-120b on free — 8k TPM. */
export const GROQ_MODE_MODEL_PREFERENCE: Record<AgentMode, string> = {
	code: 'llama-3.3-70b-versatile',
	debug: 'llama-3.3-70b-versatile',
	terminal: 'llama-3.1-8b-instant',
	plan: 'llama-3.3-70b-versatile',
};

export const GROQ_TASK_MODEL_PREFERENCE: Record<TaskKind, string> = {
	inspect: 'llama-3.3-70b-versatile',
	plan: 'llama-3.3-70b-versatile',
	debug: 'llama-3.3-70b-versatile',
	implement: 'llama-3.3-70b-versatile',
	terminal: 'llama-3.1-8b-instant',
	general: 'llama-3.3-70b-versatile',
};

export const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';

/** Ordered fallbacks when preferred Groq model returns 404 / rate-limit / TPM errors. */
export const GROQ_MODEL_FALLBACKS = [
	'llama-3.3-70b-versatile',
	'llama-3.1-8b-instant',
	'openai/gpt-oss-20b',
	'openai/gpt-oss-120b',
] as const;

/** Free-tier TPM is tight — keep completion budget small so tools+prompt fit. */
export const GROQ_MAX_TOKENS = 2048;
export const GROQ_MAX_TOKENS_RETRY = 1024;

export function normalizeProvider(provider?: string): ModelProvider {
	return provider === 'groq' ? 'groq' : 'ollama';
}

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
		if (!modelId.includes(':') && normalized.split(':')[0] === modelId) return true;
		return false;
	});
}

export function missingCopixModels(installed: string[]): string[] {
	return COPIX_MODEL_IDS.filter(id => !modelIsAvailable(id, installed));
}

/** Models to pull on startup — only the small fallback for fast launch. */
export function startupPullModels(installed: string[]): string[] {
	return modelIsAvailable(FALLBACK_MODEL_ID, installed) ? [] : [FALLBACK_MODEL_ID];
}
