export interface FormattedAgentError {
	title: string;
	summary: string;
	detail?: string;
	hints: string[];
	canUseCloud: boolean;
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
				'In Copix Settings → Models, enable Low VRAM mode (CPU-safe) or switch to Cloud.',
				'gpt-oss:20b often fails on 8GB laptop VRAM — Cloud (OpenRouter / Groq) avoids this entirely.',
				'If you installed CUDA Toolkit separately, remove its bin folder from PATH so Ollama uses its bundled runtime.',
			],
			canUseCloud: true,
		};
	}

	if (isStackCrash) {
		return {
			title: 'Ollama process crashed',
			summary: 'The local model server crashed while loading or running the model. This is common with gpt-oss:20b on limited VRAM.',
			detail: ollamaMsg,
			hints: [
				'Restart Ollama completely (tray quit → reopen).',
				'Enable Low VRAM mode in Settings → Models (runs on CPU; slower but stable).',
				'Or switch to Cloud with a free OpenRouter / Groq key.',
				'Close games and other GPU apps before retrying local gpt-oss.',
			],
			canUseCloud: true,
		};
	}

	if (low.includes('out of memory') || low.includes('oom')) {
		return {
			title: 'Out of memory',
			summary: 'The model ran out of GPU or system memory.',
			detail: ollamaMsg,
			hints: [
				'Enable Low VRAM mode or use cloud inference in Settings.',
				'Close memory-heavy apps and retry.',
			],
			canUseCloud: true,
		};
	}

	if (low.includes('ollama') && (raw.includes('500') || raw.includes('502') || raw.includes('503'))) {
		return {
			title: 'Ollama server error',
			summary: 'Ollama returned a server error while generating a response.',
			detail: ollamaMsg,
			hints: [
				'Restart Ollama and retry.',
				'If this keeps happening with gpt-oss:20b, use Low VRAM or Cloud in Settings.',
			],
			canUseCloud: true,
		};
	}

	if (low.includes('cannot reach ollama') || low.includes('econnrefused') || low.includes('fetch failed')) {
		return {
			title: 'Ollama offline',
			summary: 'Copix could not reach Ollama on this machine.',
			detail: ollamaMsg,
			hints: [
				'Install and open Ollama from ollama.com.',
				'Run: ollama pull gpt-oss:20b',
				'Or use Cloud in Settings with OpenRouter / Groq.',
			],
			canUseCloud: true,
		};
	}

	if (low.includes('401') || low.includes('403') || low.includes('api key')) {
		return {
			title: 'API key rejected',
			summary: 'Your cloud API key was rejected.',
			detail: ollamaMsg,
			hints: ['Open Settings → Models → paste a valid OpenRouter or Groq key.'],
			canUseCloud: false,
		};
	}

	return {
		title: 'Agent error',
		summary: ollamaMsg.length > 280 ? ollamaMsg.slice(0, 280) + '…' : ollamaMsg,
		detail: ollamaMsg.length > 280 ? ollamaMsg : undefined,
		hints: [],
		canUseCloud: raw.toLowerCase().includes('ollama') || low.includes('llama-server'),
	};
}
