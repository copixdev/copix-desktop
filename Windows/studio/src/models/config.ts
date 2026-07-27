export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_MODEL_ID = 'qwen2.5:3b';

export interface ModelConfig {
	model: string;
	baseUrl: string;
	/** Passed to Ollama as options.num_ctx when set. */
	numCtx?: number;
	/** Passed to Ollama as options.num_gpu (0 = CPU-only). */
	numGpu?: number;
}

export function settingsToConfig(model: { modelId: string; lowVram?: boolean }): ModelConfig {
	const lowVram = Boolean(model.lowVram);
	return {
		model: model.modelId || DEFAULT_MODEL_ID,
		baseUrl: OLLAMA_BASE_URL,
		numCtx: lowVram ? 2048 : 4096,
		numGpu: undefined,
	};
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
