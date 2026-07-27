import type { ModelConfig } from './config.js';
import { buildModelHeaders, resolveChatUrl } from './config.js';
import { copix } from '../api.js';
import type { AgentMode } from './agentModes.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { actionToTool, parseStructuredResponse, type StructuredAgentResponse } from './structuredResponse.js';
import { computeLineDiff, truncateText } from '../utils/lineDiff.js';
import { assertSafeFilePath } from '../utils/secrets.js';

export interface AgentContext {
	sessionId: string;
	workspaceRoot: string;
	onWorkspaceChange?: (root: string) => void;
	onSpawnSubagent?: (prompt: string, label?: string) => Promise<{ sessionId: string }>;
}

interface MultitaskItem {
	tool: string;
	args?: Record<string, unknown>;
}

const TOOLS = [
	{
		type: 'function' as const,
		function: {
			name: 'create_project',
			description: `## create_project
Scaffold a new git-initialized project folder.

**When to use:** User asks for a new app, site, or repo from scratch.

**Output location:** \`C:/Users/<you>/<kebab-name>\` unless \`outputPath\` is set.

**Parameters:**
- \`name\` (required) — kebab-case project name you generate
- \`description\` — one-line summary written to README
- \`outputPath\` — optional absolute or workspace-relative directory`,
			parameters: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'Short project name you generate from requirements' },
					description: { type: 'string', description: 'One-line summary of the project' },
					outputPath: { type: 'string', description: 'Optional absolute or relative output directory when user requests a specific route' },
				},
				required: ['name'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'multitask',
			description: `## multitask
Run **independent** tool calls in parallel (reads, greps, list_dir, run_terminal).

**When to use:** Several lookups that do not depend on each other's results.

**Parameters:**
- \`summary\` — short label shown in the workflow UI
- \`tasks[]\` — each item: \`{ tool, args }\``,
			parameters: {
				type: 'object',
				properties: {
					summary: { type: 'string', description: 'Short label for the parallel work' },
					tasks: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								tool: { type: 'string', enum: ['read_file', 'grep', 'list_dir', 'run_terminal'] },
								args: { type: 'object' },
							},
							required: ['tool'],
						},
					},
				},
				required: ['tasks'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'read_file',
			description: `## read_file
Read file contents from disk.

**When to use:** Before editing, to understand context, imports, or error locations.

**Parameters:** \`path\` — relative to workspace or absolute.`,
			parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'edit_file',
			description: `## edit_file
Surgical search-and-replace in an existing file.

**Prefer over** \`write_file\` for small, targeted changes.

**Parameters:**
- \`path\` — file to edit
- \`old_string\` — exact text to find (include enough context to be unique)
- \`new_string\` — replacement text
- \`replace_all\` — replace every occurrence (default: first only)`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					old_string: { type: 'string' },
					new_string: { type: 'string' },
					replace_all: { type: 'boolean', description: 'Replace every occurrence (default: first only)' },
				},
				required: ['path', 'old_string', 'new_string'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'write_file',
			description: `## write_file
Create or **fully overwrite** a file. Parent directories are created automatically.

**When to use:** New files or complete rewrites.

**Parameters:** \`path\`, \`content\` (full file body).`,
			parameters: {
				type: 'object',
				properties: { path: { type: 'string' }, content: { type: 'string' } },
				required: ['path', 'content'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'delete_file',
			description: `## delete_file
Permanently delete a file from the workspace.

**Parameters:** \`path\``,
			parameters: {
				type: 'object',
				properties: { path: { type: 'string' } },
				required: ['path'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'grep',
			description: `## grep
Search file contents with ripgrep.

**When to use:** Find symbols, errors, usages, config keys.

**Parameters:**
- \`pattern\` (required) — regex or plain text
- \`path\` — optional file or directory scope`,
			parameters: {
				type: 'object',
				properties: { pattern: { type: 'string' }, path: { type: 'string' } },
				required: ['pattern'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'list_dir',
			description: `## list_dir
List files and folders in a directory.

**When to use:** Explore project structure before reading or editing.

**Parameters:** \`path\` (optional, defaults to workspace root).`,
			parameters: { type: 'object', properties: { path: { type: 'string' } } },
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'run_terminal',
			description: `## run_terminal
Execute a PowerShell command on the user's machine.

**When to use:** Build, test, install packages, run scripts.

**Parameters:**
- \`command\` (required)
- \`cwd\` — working directory (defaults to workspace)
- \`elevate\` — \`true\` for Administrator / UAC (installs, system paths)`,
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string' },
					cwd: { type: 'string' },
					elevate: {
						type: 'boolean',
						description: 'Run elevated as Administrator (Windows UAC prompt)',
					},
				},
				required: ['command'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'spawn_subagent',
			description: `## spawn_subagent
Delegate an isolated sub-task to a **child agent** with its own session.

**When to use:** Large refactors, multi-file features, deep investigation that benefits from a fresh context.

**Parameters:**
- \`prompt\` (required) — detailed natural-language instructions
- \`label\` — short title in the sidebar`,
			parameters: {
				type: 'object',
				properties: {
					prompt: { type: 'string', description: 'Detailed task prompt the subagent should follow' },
					label: { type: 'string', description: 'Short title shown in the sidebar' },
				},
				required: ['prompt'],
			},
		},
	},
];

type ChatMsg = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	name?: string;
	tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
};

export type ToolResultMeta = {
	result: string;
	diff?: ReturnType<typeof computeLineDiff>;
};

export type AgentCallbacks = {
	onText: (chunk: string) => void;
	onThinkingStart: () => void;
	onThinkingChunk: (chunk: string) => void;
	onThinkingEnd: () => void;
	onToolStart: (callId: string, tool: string, args: Record<string, unknown>) => void;
	onToolEnd: (callId: string, tool: string, args: Record<string, unknown>, meta: ToolResultMeta) => void;
	onStatus: (msg: string) => void;
	/** Clear streamed assistant text when a tool round starts (intermediate planning hidden from chat). */
	onClearText?: () => void;
	/** Fired when assistant text is parsed as structured JSON (message + actions). */
	onStructuredResponse?: (parsed: StructuredAgentResponse) => void;
};

async function executeTool(
	name: string,
	args: Record<string, unknown>,
	ctx: AgentContext,
): Promise<ToolResultMeta> {
	const ws = ctx.workspaceRoot;
	switch (name) {
		case 'create_project': {
			const projectName = String(args.name ?? 'project');
			assertSafeFilePath(projectName);
			const desc = args.description ? String(args.description) : undefined;
			const outputPath = args.outputPath ? String(args.outputPath) : undefined;
			if (outputPath) assertSafeFilePath(outputPath);
			const result = await copix.createProject(ctx.sessionId, projectName, desc, outputPath);
			ctx.onWorkspaceChange?.(result.root);
			return {
				result: `Created project "${projectName}" at ${result.root}\nFiles: ${result.tree.slice(0, 20).join(', ')}`,
			};
		}
		case 'multitask': {
			const tasks = (args.tasks as MultitaskItem[] | undefined) ?? [];
			const summary = args.summary ? String(args.summary) : 'parallel tasks';
			const results = await Promise.all(tasks.map(async (t, i) => {
				try {
					const meta = await executeTool(t.tool, t.args ?? {}, ctx);
					return `[${i + 1}] ${t.tool}: OK\n${truncateText(meta.result, 800)}`;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return `[${i + 1}] ${t.tool}: ERROR\n${msg}`;
				}
			}));
			return { result: `${summary}\n\n${results.join('\n\n')}` };
		}
		case 'read_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const content = await copix.readFile(filePath, ws);
			return { result: truncateText(content, 4000) };
		}
		case 'edit_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const oldStr = String(args.old_string ?? '');
			const newStr = String(args.new_string ?? '');
			const replaceAll = Boolean(args.replace_all);
			const before = await copix.readFile(filePath, ws);
			if (!before.includes(oldStr)) {
				return { result: `Could not find old_string in ${filePath}` };
			}
			const after = replaceAll ? before.split(oldStr).join(newStr) : before.replace(oldStr, newStr);
			const saved = await copix.writeFile(filePath, after, ws);
			return { result: `Patched ${saved}`, diff: computeLineDiff(before, after) };
		}
		case 'write_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const newContent = String(args.content ?? '');
			let before = '';
			try {
				before = await copix.readFile(filePath, ws);
			} catch { /* new file */ }
			const saved = await copix.writeFile(filePath, newContent, ws);
			const diff = computeLineDiff(before, newContent);
			return { result: `Saved ${saved}`, diff };
		}
		case 'delete_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const removed = await copix.deleteFile(filePath, ws);
			return { result: `Deleted ${removed}` };
		}
		case 'grep': {
			const out = await copix.grep(
				String(args.pattern ?? ''),
				args.path ? String(args.path) : undefined,
				ws,
			);
			return { result: truncateText(out, 4000) };
		}
		case 'list_dir': {
			const entries = await copix.listDir(args.path ? String(args.path) : undefined, ws);
			return { result: entries.join('\n') || '(empty)' };
		}
		case 'run_terminal': {
			const elevate = Boolean(args.elevate) || needsElevateHint(String(args.command ?? ''));
			const out = await copix.runTerminal(
				String(args.command ?? ''),
				ws,
				args.cwd ? String(args.cwd) : undefined,
				elevate,
			);
			return { result: truncateText(out, 4000) };
		}
		case 'spawn_subagent': {
			const prompt = String(args.prompt ?? '').trim();
			if (!prompt) return { result: 'spawn_subagent requires a prompt' };
			const label = args.label ? String(args.label) : undefined;
			if (!ctx.onSpawnSubagent) {
				return { result: 'Subagent spawning is not available in this context' };
			}
			const { sessionId } = await ctx.onSpawnSubagent(prompt, label);
			return { result: `Subagent started (${sessionId}). It will run the delegated task in a new agent session.` };
		}
		default:
			return { result: `Unknown tool: ${name}` };
	}
}

function needsElevateHint(command: string): boolean {
	const c = command.toLowerCase();
	return /\b(sudo|runas|pkexec|bcdedit|dism\s|reg\s+add|takeown|icacls|winget\s+install|choco\s+install|install-windowsfeature)\b/.test(c);
}

async function executeStructuredActions(
	parsed: StructuredAgentResponse,
	ctx: AgentContext,
	callbacks: AgentCallbacks,
): Promise<void> {
	callbacks.onStructuredResponse?.(parsed);
	for (let i = 0; i < parsed.actions.length; i++) {
		const mapped = actionToTool(parsed.actions[i]);
		if (!mapped) continue;
		const { tool, args } = mapped;
		const callId = `struct-${Date.now()}-${i}`;
		callbacks.onToolStart(callId, tool, args);
		let meta: ToolResultMeta;
		try {
			meta = await executeTool(tool, args, ctx);
		} catch (err) {
			meta = { result: err instanceof Error ? err.message : String(err) };
		}
		callbacks.onToolEnd(callId, tool, args, meta);
	}
}

const SUMMARY_USER_PROMPT = `Provide a detailed markdown summary for the user:
- What you investigated and accomplished
- Files changed and why
- Errors found and fixes applied
- How to verify / next steps

Do not call tools. Write clearly for the user.`;

async function streamCompletion(
	messages: ChatMsg[],
	config: ModelConfig,
	signal: AbortSignal,
	callbacks: AgentCallbacks,
	opts: { tools?: typeof TOOLS; emitText?: boolean },
): Promise<{ assistantText: string; toolCalls: Map<number, { id: string; name: string; args: string }> }> {
	const url = resolveChatUrl(config);
	const isLocal = config.provider === 'local';
	let thinking = true;
	callbacks.onThinkingStart();
	const endThinking = () => {
		if (!thinking) return;
		thinking = false;
		callbacks.onThinkingEnd();
	};

	let res: Response;
	try {
		res = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config),
		body: JSON.stringify({
			model: config.model,
			messages,
			...(opts.tools ? { tools: opts.tools } : {}),
			stream: true,
			temperature: isLocal ? 0.1 : 0.2,
			...(isLocal
				? {
					options: {
						...(config.numCtx != null ? { num_ctx: config.numCtx } : { num_ctx: 4096 }),
						num_predict: 2048,
						num_batch: 512,
						keep_alive: '10m',
					},
				}
				: {}),
		}),
		signal,
	});
	} catch (err) {
		if (signal.aborted) return { assistantText: '', toolCalls: new Map() };
		const msg = err instanceof Error ? err.message : String(err);
		const label = config.provider === 'cloud' ? 'Copix Cloud' : 'Ollama';
		throw new Error(`Cannot reach ${label} at ${config.baseUrl} — ${msg}`);
	}

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		const label = config.provider === 'cloud' ? 'Copix Cloud' : 'Ollama';
		let message = errText.slice(0, 800) || res.statusText;
		try {
			const parsed = JSON.parse(errText) as { error?: { message?: string } };
			if (parsed.error?.message) message = parsed.error.message;
		} catch { /* raw text */ }
		throw new Error(`${label} ${res.status}: ${message}`);
	}

	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let assistantText = '';
	const toolCalls = new Map<number, { id: string; name: string; args: string }>();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const payload = line.slice(6).trim();
			if (payload === '[DONE]') continue;
			try {
				const json = JSON.parse(payload);
				const delta = json.choices?.[0]?.delta;
				const reasoning = delta?.reasoning_content ?? delta?.reasoning;
				if (reasoning) {
					callbacks.onThinkingChunk(String(reasoning));
				}
				if (delta?.content) {
					endThinking();
					assistantText += delta.content;
					if (opts.emitText !== false) callbacks.onText(delta.content);
				}
				for (const tc of delta?.tool_calls ?? []) {
					if (tc.function?.name) endThinking();
					const idx = tc.index ?? 0;
					if (!toolCalls.has(idx)) toolCalls.set(idx, { id: tc.id ?? `c${idx}`, name: '', args: '' });
					const e = toolCalls.get(idx)!;
					if (tc.function?.name) e.name = tc.function.name;
					if (tc.function?.arguments) e.args += tc.function.arguments;
				}
			} catch { /* skip */ }
		}
	}

	endThinking();
	return { assistantText, toolCalls };
}

function buildHeaders(config: ModelConfig): Record<string, string> {
	return buildModelHeaders(config);
}

function historyToMessages(messages: Array<{ role: string; content: string }>, maxTurns = 12): ChatMsg[] {
	const filtered = messages
		.filter(m => m.role === 'user' || m.role === 'assistant')
		.map(m => ({
			role: m.role as 'user' | 'assistant',
			content: m.content.length > 6000 ? `${m.content.slice(0, 6000)}\n…[truncated]` : m.content,
		}));
	// Keep recent turns only — large histories crush local model speed/VRAM.
	return filtered.length > maxTurns ? filtered.slice(-maxTurns) : filtered;
}

export interface AgentRunOptions {
	mode?: AgentMode;
	customRules?: string[];
}

export async function runAgent(
	userMessage: string,
	config: ModelConfig,
	ctx: AgentContext,
	priorMessages: Array<{ role: string; content: string }>,
	signal: AbortSignal,
	callbacks: AgentCallbacks,
	options: AgentRunOptions = {},
): Promise<void> {
	const isLocal = config.provider === 'local';
	const messages: ChatMsg[] = [
		{
			role: 'system',
			content: buildSystemPrompt({
				mode: options.mode ?? 'code',
				workspaceRoot: ctx.workspaceRoot,
				customRules: options.customRules,
			}),
		},
		...historyToMessages(priorMessages, isLocal ? 8 : 16),
		{ role: 'user', content: userMessage },
	];

	const maxRounds = isLocal ? 10 : 16;
	let hadToolUse = false;

	for (let i = 0; i < maxRounds; i++) {
		if (signal.aborted) return;
		callbacks.onStatus(`${config.model}…`);

		try {
			const round = await streamCompletion(messages, config, signal, callbacks, { tools: TOOLS });
			const { assistantText, toolCalls } = round;

			if (!toolCalls.size) {
				const parsed = parseStructuredResponse(assistantText);
				if (parsed) {
					const displayMessage = parsed.message || '(done)';
					if (parsed.actions.length) {
						await executeStructuredActions(parsed, ctx, callbacks);
						callbacks.onClearText?.();
						callbacks.onText(displayMessage);
					} else {
						callbacks.onStructuredResponse?.(parsed);
					}
					messages.push({ role: 'assistant', content: displayMessage });
					callbacks.onStatus('');
					return;
				}
				if (!assistantText.trim() && hadToolUse) {
					break;
				}
				messages.push({ role: 'assistant', content: assistantText });
				callbacks.onStatus('');
				return;
			}

			hadToolUse = true;
			callbacks.onClearText?.();

			const calls = [...toolCalls.values()];
			messages.push({
				role: 'assistant',
				content: assistantText,
				tool_calls: calls.map(c => ({
					id: c.id,
					type: 'function' as const,
					function: { name: c.name, arguments: c.args },
				})),
			});

			for (const call of calls) {
				let args: Record<string, unknown> = {};
				try { args = JSON.parse(call.args || '{}'); } catch { /* empty */ }
				callbacks.onToolStart(call.id, call.name, args);
				let meta: ToolResultMeta;
				try {
					meta = await executeTool(call.name, args, ctx);
				} catch (err) {
					meta = { result: err instanceof Error ? err.message : String(err) };
				}
				callbacks.onToolEnd(call.id, call.name, args, meta);
				messages.push({ role: 'tool', content: meta.result, tool_call_id: call.id, name: call.name });
			}
		} catch (err) {
			if (signal.aborted) return;
			throw err;
		}
	}

	if (hadToolUse && !signal.aborted) {
		messages.push({ role: 'user', content: SUMMARY_USER_PROMPT });
		try {
			callbacks.onClearText?.();
			const { assistantText } = await streamCompletion(messages, config, signal, callbacks, { emitText: true });
			if (assistantText.trim()) {
				messages.push({ role: 'assistant', content: assistantText });
			}
		} catch {
			/* best-effort summary */
		}
	}
	callbacks.onStatus('');
}
