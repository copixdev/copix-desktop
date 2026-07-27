import type { AgentMode } from './agentModes.js';
import type { ModelSettings } from '../types.js';
import {
	FALLBACK_MODEL_ID,
	MODE_MODEL_PREFERENCE,
	modelIsAvailable,
} from './modelCatalog.js';

export type ModelSelectionMode = 'auto' | 'manual';

export function normalizeModelSettings(model: ModelSettings): ModelSettings & { selection: ModelSelectionMode } {
	const selection = model.selection === 'manual' ? 'manual' : 'auto';
	return { ...model, selection };
}

/** Pick the Ollama model tag for this agent turn. */
export function selectModelForTask(
	agentMode: AgentMode,
	settings: ModelSettings,
	installed: string[] = [],
): string {
	const normalized = normalizeModelSettings(settings);
	if (normalized.selection === 'manual') {
		const manual = normalized.modelId || FALLBACK_MODEL_ID;
		if (modelIsAvailable(manual, installed)) return manual;
		return modelIsAvailable(FALLBACK_MODEL_ID, installed) ? FALLBACK_MODEL_ID : manual;
	}

	const preferred = MODE_MODEL_PREFERENCE[agentMode] ?? FALLBACK_MODEL_ID;
	const lowVram = Boolean(normalized.lowVram);

	const candidates = lowVram
		? [preferred, 'qwen3.5:4b', FALLBACK_MODEL_ID]
		: [preferred, 'qwen3.5:4b', 'qwen2.5-coder:7b', 'mistral:7b', FALLBACK_MODEL_ID];

	const seen = new Set<string>();
	for (const id of candidates) {
		if (seen.has(id)) continue;
		seen.add(id);
		if (modelIsAvailable(id, installed)) return id;
	}

	return FALLBACK_MODEL_ID;
}

export function formatModelChipLabel(
	settings: ModelSettings,
	activeModel: string,
): string {
	const normalized = normalizeModelSettings(settings);
	if (normalized.selection === 'manual') return activeModel;
	return `auto · ${activeModel}`;
}
