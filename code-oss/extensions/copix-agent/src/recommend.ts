import type { ModelSettings } from './types';

export interface OnboardingModel {
	id: string;
	sizeLabel: string;
	minRamGb: number;
	quant: string;
}

/** qwen2.5:3b on the Ollama library is the Q4_K_M build, about 2 GB. */
export const ONBOARDING_MODELS: OnboardingModel[] = [
	{ id: 'qwen2.5:3b', sizeLabel: 'about 2 GB', minRamGb: 8, quant: 'Q4_K_M' },
	{ id: 'qwen3.5:4b', sizeLabel: 'about 3 GB', minRamGb: 16, quant: 'Q4_K_M' },
	{ id: 'qwen2.5-coder:7b', sizeLabel: 'about 4.7 GB', minRamGb: 16, quant: 'Q4_K_M' },
	{ id: 'mistral:7b', sizeLabel: 'about 4.1 GB', minRamGb: 16, quant: 'Q4_0' },
];

export const TIGHT_NUM_CTX = 4096;
export const TIGHT_NUM_PREDICT = 2048;
export const TIGHT_KEEP_ALIVE = '5m';
export const TIGHT_MAX_THREADS = 4;

export function roundedRamGb(gb: number): number {
	if (!Number.isFinite(gb) || gb <= 0) return 0;
	return Math.round(gb);
}

/** Marketing "8 GB" machines often report a hair under 8. */
export function isTightRam(gb: number): boolean {
	const rounded = roundedRamGb(gb);
	return rounded > 0 && rounded <= 8;
}

export function recommendedModel(ramGb: number): OnboardingModel {
	if (roundedRamGb(ramGb) >= 16) {
		return ONBOARDING_MODELS.find(model => model.id === 'qwen2.5-coder:7b') ?? ONBOARDING_MODELS[0]!;
	}
	return ONBOARDING_MODELS[0]!;
}

export function modelIsDimmed(model: OnboardingModel, ramGb: number): boolean {
	const rounded = roundedRamGb(ramGb);
	if (rounded <= 0) return model.minRamGb > 8;
	return rounded < model.minRamGb;
}

/** One model, a short context, and CPU threads — used when the machine has about 8 GB. */
export function applyPerformance(model: ModelSettings, ramGb: number, cpuCount: number, modelId: string): ModelSettings {
	const next: ModelSettings = {
		...model,
		modelId,
		selection: 'manual',
		apiKey: '',
	};
	if (!isTightRam(ramGb)) {
		delete next.numCtx;
		delete next.numPredict;
		delete next.keepAlive;
		delete next.numThread;
		delete next.numGpu;
		next.lowVram = false;
		next.singleModel = false;
		return next;
	}
	const threads = Math.min(TIGHT_MAX_THREADS, Math.max(1, Math.round(cpuCount) || TIGHT_MAX_THREADS));
	next.lowVram = true;
	next.singleModel = true;
	next.numCtx = TIGHT_NUM_CTX;
	next.numPredict = TIGHT_NUM_PREDICT;
	next.keepAlive = TIGHT_KEEP_ALIVE;
	next.numThread = threads;
	next.numGpu = 0;
	return next;
}
