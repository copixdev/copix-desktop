import type { ModelProvider } from '../types.js';

export type { ModelProvider };

export interface ModelConfig {
	provider: ModelProvider;
	model: string;
	baseUrl: string;
	apiKey?: string;
	/** Passed to Ollama as options.num_ctx when set. */
	numCtx?: number;
	/** Passed to Ollama as options.num_gpu (0 = CPU-only). */
	numGpu?: number;
}

export interface ModelPreset {
	id: string;
	label: string;
	description: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
	{
		id: 'gpt-oss',
		label: 'gpt-oss 20B',
		description: 'OpenAI open-weight model via Ollama — full download',
	},
	{
		id: 'copix-tuned',
		label: 'Copix Core (tuned)',
		description: 'LoRA-tuned gpt-oss-20b for coding, explanation, and search',
	},
];

export const DEFAULT_PRESET_ID = 'gpt-oss';

export function settingsToConfig(
	model: {
		provider?: ModelProvider;
		endpoint: string;
		apiKey?: string;
		modelId: string;
		tunedModelId: string;
		preferTuned: boolean;
		lowVram?: boolean;
	},
	presetId?: string,
): ModelConfig {
	const useTuned = presetId === 'copix-tuned' || (presetId !== 'gpt-oss' && model.preferTuned);
	const provider = model.provider ?? 'local';
	const lowVram = Boolean(model.lowVram);
	return {
		provider,
		model: useTuned ? model.tunedModelId : model.modelId,
		baseUrl: model.endpoint.replace(/\/$/, ''),
		apiKey: provider === 'cloud' ? (model.apiKey ?? '') : undefined,
		// Local: modest context keeps gpt-oss graphs in VRAM. Low VRAM shrinks further
		// but still uses GPU (do not force num_gpu:0 — that tanks performance).
		numCtx: provider === 'local' ? (lowVram ? 2048 : 4096) : undefined,
		numGpu: undefined,
	};
}

export function resolveChatUrl(config: ModelConfig): string {
	return `${config.baseUrl}/chat/completions`;
}

function authHeaders(config: ModelConfig): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (config.provider === 'cloud' && config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	} else {
		headers.Authorization = 'Bearer ollama';
	}
	return headers;
}

/** Free OpenAI-compatible cloud providers that serve gpt-oss. */
export interface CloudPreset {
	id: string;
	label: string;
	endpoint: string;
	modelId: string;
	keyUrl: string;
	note: string;
}

export const CLOUD_PRESETS: CloudPreset[] = [
	{
		id: 'openrouter',
		label: 'OpenRouter (free)',
		endpoint: 'https://openrouter.ai/api/v1',
		modelId: 'openai/gpt-oss-20b:free',
		keyUrl: 'https://openrouter.ai/keys',
		note: 'Free gpt-oss-20b · ~20 req/min, 50–1000/day · no credit card',
	},
	{
		id: 'groq',
		label: 'Groq (free, fastest)',
		endpoint: 'https://api.groq.com/openai/v1',
		modelId: 'openai/gpt-oss-20b',
		keyUrl: 'https://console.groq.com/keys',
		note: 'Very fast inference · 30 req/min, 1000/day free',
	},
];

export function buildModelHeaders(config: ModelConfig): Record<string, string> {
	return authHeaders(config);
}

export async function checkModelHealth(config: ModelConfig): Promise<{ ok: boolean; message: string }> {
	if (config.provider === 'cloud') {
		// Standard OpenAI-compatible providers (OpenRouter, Groq, …) expose GET /models.
		try {
			const res = await fetch(`${config.baseUrl}/models`, {
				headers: buildModelHeaders(config),
				signal: AbortSignal.timeout(8000),
			});
			if (res.ok) return { ok: true, message: `Cloud · ${config.model} ready` };
			if (res.status === 401 || res.status === 403) {
				return { ok: false, message: 'API key rejected — check your key in Settings' };
			}
		} catch { /* fall through to copix-cloud health */ }
		try {
			const healthUrl = config.baseUrl.replace(/\/v1\/?$/, '') + '/health';
			const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) return { ok: false, message: `Cloud endpoint returned ${res.status}` };
			const data = await res.json() as {
				status?: string;
				backend_health?: { ok?: boolean; message?: string };
			};
			const bh = data.backend_health;
			if (bh?.ok) return { ok: true, message: `Cloud · ${bh.message ?? 'ready'}` };
			return { ok: false, message: bh?.message ?? `Cloud proxy ${data.status ?? 'degraded'}` };
		} catch {
			return { ok: false, message: 'Cannot reach cloud endpoint — check URL and API key' };
		}
	}

	try {
		const base = config.baseUrl.replace(/\/v1$/, '');
		const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return { ok: false, message: `Ollama returned ${res.status}` };
		const data = await res.json() as { models?: Array<{ name: string }> };
		const names = (data.models ?? []).map(m => m.name);
		const has = names.some(n => n.startsWith(config.model) || n.startsWith(config.model.split(':')[0]));
		if (has) return { ok: true, message: `Ollama · ${config.model} ready` };
		return { ok: false, message: `Model ${config.model} not pulled yet — use Model panel` };
	} catch {
		return { ok: false, message: 'Ollama offline — install from ollama.com and pull gpt-oss:20b' };
	}
}
