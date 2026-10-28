export interface FormattedAgentError {
	title: string;
	summary: string;
	detail?: string;
	hints: string[];
}

function tryParseOllamaJson(raw: string): string | null {
	const match = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
	if (!match) return null;
	try {
		const data = JSON.parse(match[0]) as { error?: { message?: string } | string };
		if (typeof data.error === 'string') return data.error;
		return data.error?.message ?? null;
	} catch {
		return null;
	}
}

/** Turn raw agent/API errors into user-friendly guidance. */
export function formatAgentError(raw: string): FormattedAgentError {
	const ollamaMsg = tryParseOllamaJson(raw) ?? raw;
	const low = ollamaMsg.toLowerCase();
	const isCuda =
		low.includes('cuda')
		&& (low.includes('initialization failed') || low.includes('shared object') || low.includes('cudamalloc'));
	const isStackCrash =
		low.includes('0xc0000409')
		|| low.includes('stack-based buffer')
		|| low.includes('llama-server process has terminated')
		|| low.includes('llama runner process has terminated');

	if (isCuda || (isStackCrash && low.includes('cuda'))) {
		return {
			title: 'GPU / CUDA crash',
			summary: 'Ollama crashed while loading the model on your GPU (CUDA initialization failed).',
			detail: ollamaMsg,
			hints: [
				'Quit Ollama from the tray (and Task Manager if needed), then reopen it.',
				'Update Ollama to the latest version, then update NVIDIA drivers.',
				'In Copix, enable Low VRAM mode in ~/Copix/settings.json (model.lowVram).',
				'If you installed CUDA Toolkit separately, remove its bin folder from PATH so Ollama uses its bundled runtime.',
			],
		};
	}

	if (isStackCrash) {
		return {
			title: 'Ollama process crashed',
			summary: 'The local model server crashed while loading or running the model.',
			detail: ollamaMsg,
			hints: [
				'Restart Ollama completely (tray quit → reopen).',
				'Set model.lowVram to true in ~/Copix/settings.json (runs on CPU; slower but stable).',
				'Close games and other GPU apps before retrying.',
			],
		};
	}

	if (low.includes('out of memory') || low.includes('oom')) {
		return {
			title: 'Out of memory',
			summary: 'The model ran out of GPU or system memory.',
			detail: ollamaMsg,
			hints: [
				'Enable Low VRAM mode in ~/Copix/settings.json.',
				'Close memory-heavy apps and retry.',
			],
		};
	}

	if (low.includes('ollama') && (raw.includes('500') || raw.includes('502') || raw.includes('503'))) {
		return {
			title: 'Ollama server error',
			summary: 'Ollama returned a server error while generating a response.',
			detail: ollamaMsg,
			hints: [
				'Restart Ollama and retry.',
				'If this keeps happening, set model.lowVram to true in ~/Copix/settings.json.',
			],
		};
	}

	if (low.includes('cannot reach ollama') || low.includes('econnrefused') || low.includes('fetch failed')) {
		return {
			title: 'Ollama offline',
			summary: 'Copix could not reach Ollama on this machine.',
			detail: ollamaMsg,
			hints: [
				'Install and open Ollama from ollama.com.',
				'Run: ollama pull qwen2.5:3b',
			],
		};
	}

	if (
		low.includes('openrouter')
		&& (low.includes('402') || low.includes('more credits') || low.includes('can only afford') || low.includes('max_tokens'))
	) {
		return {
			title: 'OpenRouter credits',
			summary: 'OpenRouter rejected the request because your credit balance cannot reserve the token budget (or the model is too expensive for the remaining balance).',
			detail: ollamaMsg,
			hints: [
				'Add credits at https://openrouter.ai/settings/credits',
				'Or pick a cheaper model (Claude Sonnet / Llama) in the model picker.',
				'Copix retries automatically with a smaller max_tokens — restart Copix if you still see 8192 in the error.',
			],
		};
	}

	return {
		title: 'Agent error',
		summary: ollamaMsg.length > 280 ? ollamaMsg.slice(0, 280) + '…' : ollamaMsg,
		detail: ollamaMsg.length > 280 ? ollamaMsg : undefined,
		hints: [],
	};
}
