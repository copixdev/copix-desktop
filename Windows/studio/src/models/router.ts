import type { ModelConfig } from './config.js';
import { buildModelHeaders, resolveChatUrl } from './config.js';
import { copix } from '../api.js';
import type { AgentMode } from './agentModes.js';
import { buildSystemPrompt } from './systemPrompt.js';
import type { TaskKind } from './modelCatalog.js';
import { inferTaskKind, isContinuationMessage, isReadOnlyTask } from './modelSelector.js';
import { actionToTool, parseStructuredResponse, type StructuredAgentResponse } from './structuredResponse.js';
import { computeLineDiff, truncateText } from '../utils/lineDiff.js';
import { assertSafeFilePath } from '../utils/secrets.js';
import { emitAgentTerminal } from '../utils/terminalBridge.js';
import { isWindows, projectPathExample, shellLabel } from '../utils/platform.js';

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

const TERMINAL_TOOL_ALIASES = new Set(['terminal', 'run_terminal', 'shell', 'bash', 'exec', 'run_command']);

function normalizeToolName(name: string): string {
	return TERMINAL_TOOL_ALIASES.has(name) ? 'terminal' : name;
}

function fileStats(content: string): string {
	const lines = content.split('\n').length;
	const bytes = new TextEncoder().encode(content).length;
	return `${lines} lines, ${bytes} bytes`;
}

const READ_ONLY_TOOL_NAMES = new Set(['read_file', 'list_dir', 'grep', 'multitask']);
const WRITE_TOOL_NAMES = new Set([
	'create_project', 'write_file', 'append_file', 'edit_file', 'delete_file', 'terminal', 'run_terminal',
]);

const TOOLS = [
	{
		type: 'function' as const,
		function: {
			name: 'create_project',
			description: `## create_project
Scaffold a new git-initialized project folder.

**When to use:** ONLY when the user explicitly asks for a brand-new app/site/repo AND the workspace is empty.

**Do NOT use when:**
- The user asks to inspect, explain, or review existing code
- The workspace already has files
- The user referenced an existing folder or project

**Output location:** \`${projectPathExample('<kebab-name>')}\` unless \`outputPath\` is set.

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
Run **independent** tool calls in parallel (reads, greps, list_dir, terminal).

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
								tool: { type: 'string', enum: ['read_file', 'grep', 'list_dir', 'terminal'] },
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

**Tips:**
- Copy \`old_string\` exactly from \`read_file\` output (whitespace matters)
- Include 2–3 surrounding lines so the match is unique

**Parameters:**
- \`path\` — file to edit
- \`old_string\` — exact text to find
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
Create or **fully overwrite** a file on the user's local machine.

**When to use:** New files or complete rewrites. Parent directories are created automatically.

**Tips:**
- Provide the **complete** file body in \`content\`
- Write one file per call; verify with \`read_file\` if needed
- Prefer \`edit_file\` for small changes to existing files

**Parameters:**
- \`path\` — workspace-relative or absolute path
- \`content\` — full file contents (UTF-8 text)`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'File path relative to workspace or absolute' },
					content: { type: 'string', description: 'Complete file body to write' },
				},
				required: ['path', 'content'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'append_file',
			description: `## append_file
Append text to the end of an existing file (or create it if missing).

**When to use:** Add lines to logs, configs, or incrementally build a file.

**Parameters:**
- \`path\` — file to append to
- \`content\` — text to append (a newline is added automatically if the file does not end with one)`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					content: { type: 'string' },
				},
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
			name: 'terminal',
			description: `## terminal
Run a **local shell command** on the user's machine (${shellLabel()}). Output streams live in Copix's integrated terminal.

**When to use:** Install packages, run builds/tests, git, npm, pip, scaffolding CLIs, inspect environment. Do NOT use for directory creation — use write_file instead (dirs are auto-created).

**Local access:** Commands run in the workspace directory by default. You have full local shell access unless the user declines elevation.

**Parameters:**
- \`command\` (required) — shell command to execute
- \`cwd\` — working directory (defaults to workspace root)
- \`elevate\` — \`true\` for ${isWindows() ? 'Administrator / UAC' : 'administrator / sudo'} (system installs, protected paths)`,
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Shell command to run locally' },
					cwd: { type: 'string', description: 'Working directory (defaults to workspace)' },
					elevate: {
						type: 'boolean',
						description: isWindows()
							? 'Run elevated as Administrator (Windows UAC prompt)'
							: 'Run elevated with administrator privileges (macOS auth prompt / sudo)',
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

function toolsForTask(taskKind: TaskKind): typeof TOOLS {
	if (!isReadOnlyTask(taskKind)) return TOOLS;
	return TOOLS.filter(t => READ_ONLY_TOOL_NAMES.has(t.function.name));
}

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

async function runTerminalCommand(
	args: Record<string, unknown>,
	ws: string,
): Promise<ToolResultMeta> {
	const command = String(args.command ?? args.cmd ?? '').trim();
	if (!command) return { result: 'terminal requires a command' };
	const elevate = Boolean(args.elevate) || needsElevateHint(command);
	const cwd = args.cwd ? String(args.cwd) : ws;
	const streamId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	emitAgentTerminal({ type: 'start', streamId, command, cwd });
	const stop = copix.onTerminalOutput(streamId, chunk => {
		emitAgentTerminal({ type: 'output', streamId, chunk });
	});
	try {
		const out = await copix.runTerminal(command, ws, cwd, elevate, streamId);
		emitAgentTerminal({ type: 'end', streamId, result: out });
		return { result: truncateText(out.trim() || '(no output)', 8000) };
	} finally {
		stop();
	}
}

async function executeTool(
	name: string,
	args: Record<string, unknown>,
	ctx: AgentContext,
): Promise<ToolResultMeta> {
	const ws = ctx.workspaceRoot;
	const tool = normalizeToolName(name);
	switch (tool) {
		case 'create_project': {
			const entries = await copix.listDir(undefined, ws);
			const existing = entries.filter(e => {
				const name = e.replace(/\/$/, '');
				return name && name !== 'README.md';
			});
			if (existing.length > 0) {
				return {
					result: `Refused create_project: workspace already has files (${existing.slice(0, 10).join(', ')}). `
						+ 'Use list_dir and read_file to inspect, or edit_file/write_file to modify.',
				};
			}
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
					const meta = await executeTool(normalizeToolName(t.tool), t.args ?? {}, ctx);
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
			return { result: truncateText(content, 8000) };
		}
		case 'edit_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const oldStr = String(args.old_string ?? '');
			const newStr = String(args.new_string ?? '');
			const replaceAll = Boolean(args.replace_all);
			const before = await copix.readFile(filePath, ws);
			if (!before.includes(oldStr)) {
				const preview = before.slice(0, 500);
				return {
					result: `Could not find old_string in ${filePath}.`
						+ ` Copy text exactly from read_file (whitespace matters).\n\nFile starts with:\n${preview}${before.length > 500 ? '\n…' : ''}`,
				};
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
			const verb = before ? 'Overwrote' : 'Created';
			return { result: `${verb} ${saved} (${fileStats(newContent)})`, diff };
		}
		case 'append_file': {
			const filePath = String(args.path ?? '');
			assertSafeFilePath(filePath);
			const chunk = String(args.content ?? '');
			let before = '';
			try {
				before = await copix.readFile(filePath, ws);
			} catch { /* new file */ }
			const needsNl = before.length > 0 && !before.endsWith('\n');
			const after = `${before}${needsNl ? '\n' : ''}${chunk}`;
			const saved = await copix.writeFile(filePath, after, ws);
			const diff = computeLineDiff(before, after);
			return { result: `Appended to ${saved} (${fileStats(chunk)} added)`, diff };
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
			return { result: truncateText(out, 8000) };
		}
		case 'list_dir': {
			const entries = await copix.listDir(args.path ? String(args.path) : undefined, ws);
			return { result: entries.join('\n') || '(empty)' };
		}
		case 'terminal':
			return runTerminalCommand(args, ws);
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
			return { result: `Unknown tool: ${name}${name !== tool ? ` (normalized: ${tool})` : ''}` };
	}
}

function needsElevateHint(command: string): boolean {
	const c = command.toLowerCase();
	return /\b(sudo|runas|pkexec|bcdedit|dism\s|reg\s+add|takeown|icacls|winget\s+install|choco\s+install|install-windowsfeature|brew\s+install|installer\s+-pkg)\b/.test(c);
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

const CONTINUE_USER_PROMPT = `Continue the task from where you left off.
- Read existing files first — do not recreate work already done.
- Create or edit any remaining files with tools.
- Do not stop until the work is complete or you are genuinely blocked and need user input.
- When finished, reply with a clear markdown summary for the user.`;

const MAX_AGENT_ROUNDS = 40;
const MAX_HISTORY_TURNS = 24;
const MAX_MESSAGE_CHARS = 12000;
const MAX_EMPTY_REPLY_RETRIES = 4;
const MAX_INCOMPLETE_RETRIES = 4;

function looksLikePlanningOnly(text: string): boolean {
	const t = text.trim();
	if (!t) return true;
	return /\b(I will|I'll|let me|first,? I'll|step 1|plan to|going to|next I)\b/i.test(t)
		&& !/\b(created|updated|wrote|edited|done|complete|finished|saved|wrote to)\b/i.test(t);
}

function looksLikePartialCompletion(text: string): boolean {
	return /\b(next|remaining|still need|will also|not yet|partially|one more|another file|TODO)\b/i.test(text);
}

function augmentUserMessage(userMessage: string, priorMessages: Array<{ role: string; content: string }>): string {
	if (!isContinuationMessage(userMessage) || !priorMessages.length) return userMessage;
	return `${userMessage}

[Continue the work from our previous conversation. Read what was already done in the chat history and workspace, then finish any remaining steps. Do not restart from scratch or repeat mkdir/setup already completed.]`;
}

async function streamCompletion(
	messages: ChatMsg[],
	config: ModelConfig,
	signal: AbortSignal,
	callbacks: AgentCallbacks,
	opts: { tools?: typeof TOOLS; emitText?: boolean },
): Promise<{ assistantText: string; toolCalls: Map<number, { id: string; name: string; args: string }> }> {
	const url = resolveChatUrl(config);
	let thinking = true;
	callbacks.onThinkingStart();
	const endThinking = () => {
		if (!thinking) return;
		thinking = false;
		callbacks.onThinkingEnd();
	};

	const providerLabel = config.provider === 'groq' ? 'Groq' : 'Ollama';
	const requestBody = config.provider === 'groq'
		? {
			model: config.model,
			messages,
			...(opts.tools ? { tools: opts.tools } : {}),
			stream: true,
			temperature: 0.05,
			max_tokens: config.numPredict ?? 16384,
		}
		: {
			model: config.model,
			messages,
			...(opts.tools ? { tools: opts.tools } : {}),
			stream: true,
			temperature: 0.05,
			options: {
				...(config.numCtx != null ? { num_ctx: config.numCtx } : { num_ctx: 16384 }),
				num_predict: config.numPredict ?? 16384,
				num_batch: 512,
				keep_alive: '30m',
			},
		};

	let res: Response;
	try {
		res = await fetch(url, {
		method: 'POST',
		headers: buildModelHeaders(config),
		body: JSON.stringify(requestBody),
		signal,
	});
	} catch (err) {
		if (signal.aborted) return { assistantText: '', toolCalls: new Map() };
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Cannot reach ${providerLabel} at ${config.baseUrl} — ${msg}`);
	}

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		let message = errText.slice(0, 800) || res.statusText;
		try {
			const parsed = JSON.parse(errText) as { error?: { message?: string } };
			if (parsed.error?.message) message = parsed.error.message;
		} catch { /* raw text */ }
		throw new Error(`${providerLabel} ${res.status}: ${message}`);
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

function historyToMessages(messages: Array<{ role: string; content: string }>, maxTurns = MAX_HISTORY_TURNS): ChatMsg[] {
	const filtered = messages
		.filter(m => m.role === 'user' || m.role === 'assistant')
		.map(m => ({
			role: m.role as 'user' | 'assistant',
			content: m.content.length > MAX_MESSAGE_CHARS
				? `${m.content.slice(0, MAX_MESSAGE_CHARS)}\n…[truncated]`
				: m.content,
		}));
	return filtered.length > maxTurns ? filtered.slice(-maxTurns) : filtered;
}

export interface AgentRunOptions {
	mode?: AgentMode;
	taskKind?: TaskKind;
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
	const mode = options.mode ?? 'code';
	const taskKind = options.taskKind ?? inferTaskKind(userMessage, mode);
	const activeTools = toolsForTask(taskKind);
	const effectiveUserMessage = augmentUserMessage(userMessage, priorMessages);

	const messages: ChatMsg[] = [
		{
			role: 'system',
			content: buildSystemPrompt({
				mode,
				workspaceRoot: ctx.workspaceRoot,
				taskKind,
				userMessage: effectiveUserMessage,
			}),
		},
		...historyToMessages(priorMessages, MAX_HISTORY_TURNS),
		{ role: 'user', content: effectiveUserMessage },
	];

	const maxRounds = MAX_AGENT_ROUNDS;
	let hadToolUse = false;
	let emptyReplyRetries = 0;
	let incompleteRetries = 0;

	for (let i = 0; i < maxRounds; i++) {
		if (signal.aborted) return;
		callbacks.onStatus(`${config.model}…`);

		try {
			const round = await streamCompletion(messages, config, signal, callbacks, { tools: activeTools });
			const { assistantText, toolCalls } = round;

			if (!toolCalls.size) {
				const parsed = parseStructuredResponse(assistantText);
				if (parsed) {
					const displayMessage = parsed.message || '(executed actions)';
					const actions = isReadOnlyTask(taskKind)
						? parsed.actions.filter(a => {
							const mapped = actionToTool(a);
							return mapped && !WRITE_TOOL_NAMES.has(normalizeToolName(mapped.tool));
						})
						: parsed.actions;
					if (actions.length) {
						hadToolUse = true;
						await executeStructuredActions({ ...parsed, actions }, ctx, callbacks);
						callbacks.onClearText?.();
						if (displayMessage) callbacks.onText(displayMessage);
						messages.push({ role: 'assistant', content: displayMessage });
						messages.push({ role: 'user', content: CONTINUE_USER_PROMPT });
						emptyReplyRetries = 0;
						continue;
					}
					callbacks.onStructuredResponse?.(parsed);
					if (displayMessage) callbacks.onText(displayMessage);
					messages.push({ role: 'assistant', content: displayMessage });
					callbacks.onStatus('');
					return;
				}
				if (!assistantText.trim() && hadToolUse) {
					if (emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES) {
						emptyReplyRetries++;
						messages.push({ role: 'user', content: CONTINUE_USER_PROMPT });
						continue;
					}
					break;
				}
				if (
					!isReadOnlyTask(taskKind)
					&& assistantText.trim()
					&& (
						(!hadToolUse && looksLikePlanningOnly(assistantText))
						|| (hadToolUse && looksLikePartialCompletion(assistantText))
					)
					&& incompleteRetries < MAX_INCOMPLETE_RETRIES
				) {
					incompleteRetries++;
					messages.push({ role: 'assistant', content: assistantText });
					messages.push({ role: 'user', content: CONTINUE_USER_PROMPT });
					continue;
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
				if (!call.name) {
					messages.push({
						role: 'tool',
						content: 'Tool call was incomplete — retry with valid tool arguments.',
						tool_call_id: call.id,
						name: call.name || 'unknown',
					});
					continue;
				}
				const toolName = normalizeToolName(call.name);
				if (isReadOnlyTask(taskKind) && WRITE_TOOL_NAMES.has(toolName)) {
					messages.push({
						role: 'tool',
						content: `Refused ${toolName}: read-only task — use list_dir/read_file/grep and explain in chat.`,
						tool_call_id: call.id,
						name: call.name,
					});
					continue;
				}
				callbacks.onToolStart(call.id, normalizeToolName(call.name), args);
				let meta: ToolResultMeta;
				try {
					meta = await executeTool(call.name, args, ctx);
				} catch (err) {
					meta = { result: err instanceof Error ? err.message : String(err) };
				}
				callbacks.onToolEnd(call.id, normalizeToolName(call.name), args, meta);
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
