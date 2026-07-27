import type { AgentMode } from './agentModes.js';
import type { ModelSettings } from '../types.js';
import {
	FALLBACK_MODEL_ID,
	MODE_MODEL_PREFERENCE,
	TASK_MODEL_PREFERENCE,
	modelIsAvailable,
	type TaskKind,
} from './modelCatalog.js';

export type ModelSelectionMode = 'auto' | 'manual';

export type { TaskKind };

const INSPECT_RE = /\b(inspect|explain|review|describe|what does|how does|walk me through|understand|overview|summarize|look at|analyze|analyse|codespace|codebase|this folder|this project|tell me about)\b/i;
const DEBUG_RE = /\b(fix|debug|error|bug|broken|fail(?:s|ed|ing)?|issue|crash|exception|stack trace)\b/i;
const TERMINAL_RE = /\b(run|install|npm|pnpm|yarn|brew|git|terminal|command|execute|shell|build|test|compile)\b/i;
const IMPLEMENT_RE = /\b(create|implement|add feature|scaffold|new app|new project|write code|build me|make me|generate)\b/i;

export function inferTaskKind(userMessage: string, agentMode: AgentMode): TaskKind {
	const msg = userMessage.trim();
	if (!msg) return agentMode === 'plan' ? 'plan' : agentMode === 'terminal' ? 'terminal' : 'general';

	if (INSPECT_RE.test(msg) && !IMPLEMENT_RE.test(msg)) return 'inspect';
	if (DEBUG_RE.test(msg)) return 'debug';
	if (TERMINAL_RE.test(msg) && !IMPLEMENT_RE.test(msg)) return 'terminal';
	if (IMPLEMENT_RE.test(msg)) return 'implement';
	if (agentMode === 'plan') return 'plan';
	if (agentMode === 'debug') return 'debug';
	if (agentMode === 'terminal') return 'terminal';
	if (agentMode === 'code') return 'implement';
	return 'general';
}

export function isReadOnlyTask(taskKind: TaskKind): boolean {
	return taskKind === 'inspect' || taskKind === 'plan';
}

export function normalizeModelSettings(model: ModelSettings): ModelSettings & { selection: ModelSelectionMode } {
	const selection = model.selection === 'manual' ? 'manual' : 'auto';
	return { ...model, selection };
}

function pickFromCandidates(candidates: string[], installed: string[], lowVram: boolean): string {
	const seen = new Set<string>();
	const ordered = lowVram
		? [...candidates, 'qwen3.5:4b', FALLBACK_MODEL_ID]
		: [...candidates, 'qwen3.5:4b', 'qwen2.5-coder:7b', 'mistral:7b', FALLBACK_MODEL_ID];

	for (const id of ordered) {
		if (seen.has(id)) continue;
		seen.add(id);
		if (modelIsAvailable(id, installed)) return id;
	}

	return modelIsAvailable(FALLBACK_MODEL_ID, installed) ? FALLBACK_MODEL_ID : candidates[0] ?? FALLBACK_MODEL_ID;
}

/** Pick the Ollama model tag for this agent turn. */
export function selectModelForTask(
	agentMode: AgentMode,
	settings: ModelSettings,
	installed: string[] = [],
	userMessage?: string,
): string {
	const normalized = normalizeModelSettings(settings);
	if (normalized.selection === 'manual') {
		const manual = normalized.modelId || FALLBACK_MODEL_ID;
		if (modelIsAvailable(manual, installed)) return manual;
		return modelIsAvailable(FALLBACK_MODEL_ID, installed) ? FALLBACK_MODEL_ID : manual;
	}

	const taskKind = userMessage ? inferTaskKind(userMessage, agentMode) : null;
	const preferred = taskKind
		? TASK_MODEL_PREFERENCE[taskKind]
		: MODE_MODEL_PREFERENCE[agentMode] ?? FALLBACK_MODEL_ID;

	return pickFromCandidates([preferred], installed, Boolean(normalized.lowVram));
}

export function preferredModelForTask(
	agentMode: AgentMode,
	userMessage?: string,
): string {
	const taskKind = userMessage ? inferTaskKind(userMessage, agentMode) : null;
	return taskKind
		? TASK_MODEL_PREFERENCE[taskKind]
		: MODE_MODEL_PREFERENCE[agentMode] ?? FALLBACK_MODEL_ID;
}

export function formatModelChipLabel(
	settings: ModelSettings,
	activeModel: string,
	opts?: { preferred?: string; installed?: string[] },
): string {
	const normalized = normalizeModelSettings(settings);
	if (normalized.selection === 'manual') return activeModel;

	const preferred = opts?.preferred;
	const installed = opts?.installed ?? [];
	if (preferred && preferred !== activeModel && !modelIsAvailable(preferred, installed)) {
		return `auto · ${activeModel} · pull ${preferred.split(':')[0]}`;
	}
	return `auto · ${activeModel}`;
}
