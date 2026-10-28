export type ModelProvider = 'ollama' | 'groq' | 'openrouter' | 'openai';

export type ModelSelectionMode = 'auto' | 'manual';

export interface ModelSettings {
	provider?: ModelProvider;
	/** Never persisted. OpenRouter keys live in the OS keychain. */
	apiKey?: string;
	selection?: ModelSelectionMode;
	modelId: string;
	lowVram?: boolean;
	/** 8 GB machines: one model, short context, CPU threads, GPU off. */
	singleModel?: boolean;
	numCtx?: number;
	numPredict?: number;
	keepAlive?: string;
	numThread?: number;
	numGpu?: number;
}
