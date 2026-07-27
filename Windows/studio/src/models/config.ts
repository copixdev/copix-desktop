export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export { FALLBACK_MODEL_ID as DEFAULT_MODEL_ID, COPIX_MODEL_IDS } from './modelCatalog.js';

import type { AgentMode } from './agentModes.js';
import { FALLBACK_MODEL_ID } from './modelCatalog.js';
import { selectModelForTask } from './modelSelector.js';
import type { ModelSettings } from '../types.js';

/** Context window passed to Ollama as options.num_ctx. */
export const DEFAULT_NUM_CTX = 8192;
export const LOW_VRAM_NUM_CTX = 4096;

/** Max tokens per model response — large enough for multi-file writes. */
export const DEFAULT_NUM_PREDICT = 8192;
export const LOW_VRAM_NUM_PREDICT = 4096;

export interface ModelConfig {
	model: string;
	baseUrl: string;
	/** Passed to Ollama as options.num_ctx when set. */
	numCtx?: number;
	/** Passed to Ollama as options.num_predict when set. */
	numPredict?: number;
	/** Passed to Ollama as options.num_gpu (0 = CPU-only). */
	numGpu?: number;
}

export function settingsToConfig(model: { modelId: string; lowVram?: boolean }, modelId?: string): ModelConfig {
	const lowVram = Boolean(model.lowVram);
	const resolved = modelId ?? (model.modelId || FALLBACK_MODEL_ID);
	return {
		model: resolved,
		baseUrl: OLLAMA_BASE_URL,
		numCtx: lowVram ? LOW_VRAM_NUM_CTX : DEFAULT_NUM_CTX,
		numPredict: lowVram ? LOW_VRAM_NUM_PREDICT : DEFAULT_NUM_PREDICT,
		numGpu: undefined,
	};
}

export function resolveModelConfig(
	model: ModelSettings,
	agentMode: AgentMode,
	installed: string[] = [],
): ModelConfig {
	const modelId = selectModelForTask(agentMode, model, installed);
	return settingsToConfig(model, modelId);
}

export function resolveChatUrl(config: ModelConfig): string {
	return `${config.baseUrl}/chat/completions`;
}

export function buildModelHeaders(): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Authorization: 'Bearer ollama',
	};
}

export async function checkModelHealth(config: ModelConfig): Promise<{ ok: boolean; message: string }> {
	try {
		const base = config.baseUrl.replace(/\/v1$/, '');
		const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return { ok: false, message: `Ollama returned ${res.status}` };
		const data = await res.json() as { models?: Array<{ name: string }> };
		const names = (data.models ?? []).map(m => m.name);
		const has = names.some(n => n.startsWith(config.model) || n.startsWith(config.model.split(':')[0]));
		if (has) return { ok: true, message: `Ollama · ${config.model} ready` };
		return { ok: false, message: `Model ${config.model} not pulled yet — run ollama pull ${config.model}` };
	} catch {
		return { ok: false, message: 'Ollama offline — install from ollama.com and pull qwen2.5:3b' };
	}
}
