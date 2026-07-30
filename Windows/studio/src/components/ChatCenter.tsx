import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';

import { runAgent } from '../models/router';

import { resolveModelConfig } from '../models/config';
import { normalizeProvider } from '../models/modelCatalog';
import { formatModelChipLabel, inferTaskKind, preferredModelForTask } from '../models/modelSelector';

import { copix } from '../api';

import { MarkdownMessage } from './MarkdownMessage';

import {

	createThinkingActivity,

	createToolActivity,

	appendThinkingThought,

	finalizeThinking,

	finalizeToolActivity,

	formatActivityDisplay,

	type ChatActivity,

} from '../chatActivity';

import { ChatMessage, AppSettings, type AgentAction } from '../types';

import { titleFromMessage } from '../hooks/chatSessions';

import { useToast } from './Toast';

import { IconPlay, IconCopy, IconPlus, IconMic, IconArrowUp, IconBranch, IconCloud, IconChevron, IconStop, IconMore, IconExpand, IconLink, IconSliders, IconPaperclip, IconHexagon, IconBook, IconHelp, IconWrench } from './Icons';
import { ComposerCommandMenu, handleCommandMenuKey, pickComposerItem, useComposerCommands } from './ComposerCommands';
import type { AgentMode, WorkspaceEnvironment } from '../models/agentModes';
import { AgentErrorCard } from './AgentErrorCard';
import { UserPromptPill } from './UserPromptPill';
import { FilesChangedCard, type FileChange } from './FilesChangedCard';
import { collectFileChanges, collectSessionChanges, sumChanges } from '../utils/fileChanges';
import { chatMessagesToAgentHistory } from '../utils/agentHistory';
import { AgentWorkflowCard, liveStatusFromActivities } from './AgentWorkflowCard';

interface Props {

	sessionId: string;

	workspace?: string;
	workspaceEnv?: WorkspaceEnvironment;

	settings: AppSettings;

	messages: ChatMessage[];

	onMessagesChange: (msgs: ChatMessage[], title?: string) => void;

	onWorkspaceChange: (root: string) => void;

	tree?: string[];

	onOpenFile?: (path: string) => void;

	onReviewFiles?: (files: FileChange[]) => void;

	onSpawnSubagent?: (prompt: string, label?: string) => Promise<{ sessionId: string }>;

	pendingPrompt?: string;

	onPendingPromptConsumed?: () => void;

}

const SUGGESTIONS = [
	{ title: 'Build a web app', prompt: 'Build a small React app with a landing page and a working contact form.' },
	{ title: 'Write a script', prompt: 'Write a Python script that renames all files in a folder based on their creation date.' },
	{ title: 'Explain code', prompt: 'Explain what this repository does and walk me through its structure.' },
	{ title: 'Fix a bug', prompt: 'Here is an error I keep hitting — help me debug it: ' },
];

function relativeTime(ts: number): string {
	const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h ago`;
	return `${Math.floor(hr / 24)}d ago`;
}

function AssistantTurn({
	activities,
	content,
	timestamp,
	live,
	onOpenFile,
	onReviewFiles,
}: {
	activities?: ChatActivity[];
	content?: string;
	timestamp?: number;
	live?: boolean;
	onOpenFile?: (path: string) => void;
	onReviewFiles?: (files: FileChange[]) => void;
}) {
	const [workflowOpen, setWorkflowOpen] = useState(Boolean(live));

	if (!activities?.length && !content) return null;

	const isError = content?.startsWith('**Error:**') || content?.startsWith('__AGENT_ERROR__');
	const errorRaw = isError
		? content!.replace(/^\*\*Error:\*\*\s*/, '').replace(/^__AGENT_ERROR__/, '')
		: '';

	const showContent = Boolean(content && content !== '(done)' && !isError);

	const copyReply = () => {
		if (!content || isError || content === '(done)' || !showContent) return;
		void navigator.clipboard?.writeText(content);
	};

	return (
		<article className={`msg-block assistant${live ? ' live' : ''}`}>
			<div className="msg-row assistant">
				<div className="msg-stack">
					{activities && activities.length > 0 && (
						<AgentWorkflowCard
							activities={activities}
							expanded={workflowOpen}
							onToggle={() => setWorkflowOpen(v => !v)}
							live={live}
						/>
					)}
					{content && isError && (
						<div className="msg-body assistant">
							<AgentErrorCard error={errorRaw} />
						</div>
					)}
					{showContent && (
						<div className="msg-body assistant">
							<MarkdownMessage content={content!} />
						</div>
					)}
					{!live && !isError && (showContent || (activities?.length ?? 0) > 0) && (
						<div className="msg-footer">
							{timestamp != null && <span className="msg-time">{relativeTime(timestamp)}</span>}
							{showContent && (
								<div className="msg-actions">
									<button type="button" className="btn-icon" title="Copy" onClick={copyReply}>
										<IconCopy width={13} height={13} />
									</button>
								</div>
							)}
						</div>
					)}
					{!live && <FilesChangedCard activities={activities} onOpenFile={onOpenFile} onReview={onReviewFiles} />}
				</div>
			</div>
		</article>
	);
}



export function ChatCenter({

	sessionId, workspace, workspaceEnv, settings, messages, onMessagesChange, onWorkspaceChange,
	tree = [], onOpenFile, onReviewFiles, onSpawnSubagent, pendingPrompt, onPendingPromptConsumed,

}: Props) {

	const toast = useToast();

	const [activities, setActivities] = useState<ChatActivity[]>([]);

	const activitiesRef = useRef<ChatActivity[]>([]);

	const thinkingIdRef = useRef<string | null>(null);

	const [input, setInput] = useState('');

	const [attachments, setAttachments] = useState<string[]>([]);

	const [caret, setCaret] = useState(0);

	const [cmdIndex, setCmdIndex] = useState(0);

	const [cmdDismissed, setCmdDismissed] = useState(false);

	const [streaming, setStreaming] = useState('');

	const [status, setStatus] = useState('');

	const [running, setRunning] = useState(false);

	const [showScroll, setShowScroll] = useState(false);

	const [server, setServer] = useState<{ online: boolean; models?: string[]; provider?: 'ollama' | 'groq' }>({ online: false });

	const [starting, setStarting] = useState(false);

	const abortRef = useRef<AbortController | null>(null);
	const pendingPromptSentRef = useRef(false);

	const listRef = useRef<HTMLDivElement>(null);

	const endRef = useRef<HTMLDivElement>(null);
	const autoFollowRef = useRef(true);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const plusMenuRef = useRef<HTMLDivElement>(null);

	const commandMenu = useComposerCommands(input, caret, tree);
	const commandVisible = Boolean(commandMenu && commandMenu.items.length && !cmdDismissed);



	const [sessionMode, setSessionMode] = useState<AgentMode | null>(null);
	const [plusMenuOpen, setPlusMenuOpen] = useState(false);
	const agentMode = sessionMode ?? settings.agentMode;

	const config = useMemo(
		() => resolveModelConfig(settings.model, agentMode, server.models ?? [], input.trim() || undefined),
		[settings.model, agentMode, server.models, input],
	);
	const preferredModel = useMemo(
		() => preferredModelForTask(agentMode, settings.model, input.trim() || undefined),
		[agentMode, settings.model, input],
	);
	const modelProvider = normalizeProvider(settings.model.provider);
	const modelChipLabel = formatModelChipLabel(settings.model, config.model, {
		preferred: preferredModel,
		installed: server.models,
	});

	const modelReady = server.online;

	const patchActivities = useCallback((fn: (prev: ChatActivity[]) => ChatActivity[]) => {

		setActivities(prev => {

			const next = fn(prev);

			activitiesRef.current = next;

			return next;

		});

	}, []);



	const reusePrompt = useCallback((text: string) => {
		setInput(text);
		setCaret(text.length);
		requestAnimationFrame(() => {
			const el = inputRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(text.length, text.length);
		});
	}, []);

	useEffect(() => {
		const poll = () => copix.getServerStatus().then(setServer);
		poll();
		const t = setInterval(poll, 3000);
		return () => clearInterval(t);
	}, []);

	useEffect(() => {
		setSessionMode(null);
	}, [sessionId]);

	useEffect(() => {
		if (!plusMenuOpen) return;
		const onDoc = (e: MouseEvent) => {
			if (!plusMenuRef.current?.contains(e.target as Node)) setPlusMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [plusMenuOpen]);

	// Blank slate when switching agents — abort in-flight work and clear local UI state.
	useEffect(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setInput('');
		setAttachments([]);
		setCaret(0);
		setStreaming('');
		setStatus('');
		setRunning(false);
		setActivities([]);
		activitiesRef.current = [];
		thinkingIdRef.current = null;
		autoFollowRef.current = true;
		setShowScroll(false);
		setCmdDismissed(false);
		pendingPromptSentRef.current = false;
	}, [sessionId]);

	useEffect(() => {
		const el = listRef.current;
		if (!el || !autoFollowRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messages, streaming, activities]);



	const startServer = async () => {

		setStarting(true);

		try {

			const r = await copix.startServer();

			toast(r.message, r.ok ? 'ok' : 'err');

			setServer(await copix.getServerStatus());

		} finally {

			setStarting(false);

		}

	};



	const send = async (text: string, images = attachments) => {

		const msg = text.trim();

		if ((!msg && !images.length) || running || !workspace) return;

		if (!modelReady) {

			toast('Start Ollama and wait for Copix models to download', 'err');

			return;

		}



		setInput('');
		setAttachments([]);

		setRunning(true);

		setStreaming('');

		patchActivities(() => []);

		thinkingIdRef.current = null;



		const userMsg: ChatMessage = {
			id: `u-${Date.now()}`,
			role: 'user',
			content: msg,
			images: images.length ? [...images] : undefined,
			timestamp: Date.now(),
		};

		const agentMsg = msg;

		const nextMessages = [...messages, userMsg];

		onMessagesChange(nextMessages, titleFromMessage(msg || 'Image'));



		abortRef.current?.abort();

		abortRef.current = new AbortController();

		let buf = '';

		const aid = `a-${Date.now()}`;

		let structuredActions: AgentAction[] | undefined;



		try {

			const runConfig = resolveModelConfig(
				settings.model,
				agentMode,
				server.models ?? [],
				msg,
				{ hasImages: images.length > 0 },
			);
			const taskKind = inferTaskKind(msg, agentMode);

			await runAgent(

				agentMsg, runConfig,

				{
					sessionId,
					workspaceRoot: workspace,
					onWorkspaceChange: onWorkspaceChange,
					onSpawnSubagent,
				},

				chatMessagesToAgentHistory(messages),

				abortRef.current.signal,

				{

					onText: c => { buf += c; setStreaming(buf); },

					onThinkingStart: () => {

						const id = `think-${Date.now()}`;

						thinkingIdRef.current = id;

						patchActivities(p => [...p, createThinkingActivity(id)]);

					},

					onThinkingChunk: chunk => {

						const id = thinkingIdRef.current;

						if (!id || !chunk) return;

						patchActivities(p => p.map(a => a.id === id ? appendThinkingThought(a, chunk) : a));

					},

					onThinkingEnd: () => {

						const id = thinkingIdRef.current;

						if (!id) return;

						thinkingIdRef.current = null;

						patchActivities(p => p.map(a => a.id === id ? finalizeThinking(a) : a));

					},

					onToolStart: (callId, tool, args) => {
						const act = createToolActivity(callId, tool, args);
						patchActivities(p => [...p, act]);
						const label = formatActivityDisplay(act);
						const statusText = [label.verb, label.target].filter(Boolean).join(' ')
							+ (label.ellipsis ? '...' : '');
						setStatus(statusText);
					},

					onToolEnd: (callId, _tool, _args, meta) => {
						patchActivities(p => p.map(a => a.id === callId
							? finalizeToolActivity(a, { result: meta.result, diff: meta.diff })
							: a));
						setStatus('');
					},

					onStatus: setStatus,

					onStructuredResponse: parsed => {
						buf = parsed.message;
						structuredActions = parsed.actions.length ? parsed.actions : undefined;
						setStreaming(parsed.message);
					},

					onClearText: () => {
						buf = '';
						setStreaming('');
					},

				},

				{ mode: agentMode, taskKind, images: images.length ? [...images] : undefined },

			);

			const turnActivities = activitiesRef.current.length ? [...activitiesRef.current] : undefined;

			const reply = buf.trim();
			const hasActivities = Boolean(turnActivities?.length);

			onMessagesChange([...nextMessages, {

				id: aid,

				role: 'assistant',

				content: reply || (hasActivities ? '' : '(done)'),

				timestamp: Date.now(),

				activities: turnActivities,

				structuredActions,

			}]);

			const changedFiles = collectFileChanges(turnActivities);
			if (changedFiles.length) onReviewFiles?.(changedFiles);

			setStreaming('');

			patchActivities(() => []);

		} catch (err) {

			const e = err instanceof Error ? err.message : String(err);

			const turnActivities = activitiesRef.current.length

				? activitiesRef.current.map(a => {
					if (a.phase !== 'active') return a;
					return a.kind === 'think' ? finalizeThinking(a) : finalizeToolActivity(a, { result: a.result });
				})

				: undefined;

			onMessagesChange([...nextMessages, {

				id: aid,

				role: 'assistant',

				content: `__AGENT_ERROR__${e}`,

				timestamp: Date.now(),

				activities: turnActivities,

			}]);

			setStreaming('');

			patchActivities(() => []);

			thinkingIdRef.current = null;

		} finally {

			setRunning(false);

			setStatus('');

		}

	};



	useEffect(() => {
		if (!pendingPrompt?.trim() || pendingPromptSentRef.current || running || !workspace || !modelReady) return;
		pendingPromptSentRef.current = true;
		onPendingPromptConsumed?.();
		void send(pendingPrompt);
	}, [pendingPrompt, running, workspace, modelReady, onPendingPromptConsumed]);



	const liveStatus = running
		? (status || liveStatusFromActivities(activities) || 'Working…')
		: '';

	const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		const imageItems = [...items].filter(item => item.type.startsWith('image/'));
		if (!imageItems.length) return;
		e.preventDefault();
		for (const item of imageItems) {
			const file = item.getAsFile();
			if (!file) continue;
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result;
				if (typeof dataUrl === 'string') {
					setAttachments(prev => prev.length >= 5 ? prev : [...prev, dataUrl]);
				}
			};
			reader.readAsDataURL(file);
		}
	};

	const addImageFiles = (files: FileList | File[]) => {
		const list = [...files].filter(f => f.type.startsWith('image/')).slice(0, 5);
		for (const file of list) {
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result;
				if (typeof dataUrl === 'string') {
					setAttachments(prev => prev.length >= 5 ? prev : [...prev, dataUrl]);
				}
			};
			reader.readAsDataURL(file);
		}
	};

	const fileInputRef = useRef<HTMLInputElement>(null);
	// Must be defined before JSX — missing this caused ReferenceError on launch.
	const showLiveTurn =
		running &&
		(activities.length > 0 ||
			(Boolean(streaming) && !activities.some(a => a.kind === 'think' && a.phase === 'active')));
	const hasLiveToolWork = activities.some(a => a.kind !== 'think');
	const liveContent = activities.some(a => a.kind === 'think' && a.phase === 'active')
		? undefined
		: hasLiveToolWork
			? undefined
			: streaming || undefined;

	const sessionDiff = useMemo(
		() => sumChanges(collectSessionChanges(messages)),
		[messages],
	);
	const locationLabel = workspaceEnv === 'desktop' ? 'Local' : 'Cloud';
	const branchLabel = useMemo(() => {
		if (!workspace) return 'main';
		const leaf = workspace.replace(/\\/g, '/').split('/').filter(Boolean).pop();
		return leaf || 'main';
	}, [workspace]);
	const chatTitle = useMemo(() => {
		const named = messages.find(m => m.role === 'user' && m.content.trim());
		if (named?.content) {
			const t = named.content.trim().replace(/\s+/g, ' ');
			return t.length > 42 ? `${t.slice(0, 42)}…` : t;
		}
		return branchLabel === 'main' ? 'Copix' : branchLabel;
	}, [messages, branchLabel]);

	const stopRun = () => {
		abortRef.current?.abort();
		setRunning(false);
		setStatus('');
	};

	const pickQuickMode = (mode: AgentMode) => {
		setSessionMode(mode);
		setPlusMenuOpen(false);
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	return (

		<div className="chat-center">

			{!modelReady && (
				<div className="banner banner-warn">
					<span>
						{modelProvider === 'groq'
							? 'Groq not ready — add model.apiKey in ~/Copix/settings.json (free key at console.groq.com, no download needed)'
							: 'Ollama offline or models not ready — open Ollama, then click Check Ollama to download Copix models (qwen2.5-coder, mistral, qwen3.5)'}
					</span>
					<button type="button" className="btn primary sm" disabled={starting} onClick={startServer}>
						<IconPlay width={12} height={12} /> {starting ? 'Checking…' : modelProvider === 'groq' ? 'Check Groq' : 'Check Ollama'}
					</button>
				</div>
			)}

			<div className="chat-stage">
				<header className="chat-stage-header">
					<div className="chat-stage-title">
						<span className="chat-stage-name fade-edge">{chatTitle}</span>
						{locationLabel === 'Cloud' && <IconCloud width={13} height={13} className="chat-stage-cloud" />}
					</div>
					<div className="chat-stage-actions">
						<button
							type="button"
							className="chat-stage-ide"
							title="Open IDE window"
							onClick={() => { void window.copix?.openIdeWindow?.(); }}
						>
							<span>IDE</span>
							<IconExpand width={11} height={11} />
						</button>
						<button type="button" className="btn-icon" title="More">
							<IconMore width={14} height={14} />
						</button>
					</div>
				</header>

				{(sessionDiff.added > 0 || sessionDiff.removed > 0) && (
					<button
						type="button"
						className="chat-changes-pill"
						onClick={() => onReviewFiles?.(collectSessionChanges(messages))}
						title="Review file changes"
					>
						<span className="chat-changes-label">Changes</span>
						{sessionDiff.added > 0 && <span className="chat-changes-add">+{sessionDiff.added}</span>}
						{sessionDiff.removed > 0 && <span className="chat-changes-del">−{sessionDiff.removed}</span>}
					</button>
				)}

			<div className="chat-stream" ref={listRef} onScroll={() => {

				const el = listRef.current;

				if (!el) return;
				const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
				const nearBottom = distance < 80;
				autoFollowRef.current = nearBottom;
				setShowScroll(!nearBottom);

			}}>

				{messages.map(m => (
					m.role === 'user' ? (
						<UserPromptPill key={m.id} content={m.content} images={m.images} onReuse={reusePrompt} />
					) : (
						<AssistantTurn
							key={m.id}
							activities={m.activities}
							content={m.content}
							timestamp={m.timestamp}
							onOpenFile={onOpenFile}
							onReviewFiles={onReviewFiles}
						/>
					)
				))}

				{showLiveTurn && (
					<AssistantTurn
						activities={activities}
						content={liveContent}
						live
						onOpenFile={onOpenFile}
						onReviewFiles={onReviewFiles}
					/>
				)}

				<div ref={endRef} />

			</div>



			{showScroll && (

				<button type="button" className="scroll-fab" onClick={() => {
					autoFollowRef.current = true;
					setShowScroll(false);
					const el = listRef.current;
					if (el) el.scrollTop = el.scrollHeight;
				}}>↓</button>

			)}



			<div className="composer">
				<div
					className={`composer-inner cursor-composer${running ? ' disabled' : ''}`}
					onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
					onDrop={e => {
						e.preventDefault();
						e.stopPropagation();
						if (e.dataTransfer.files?.length) addImageFiles(e.dataTransfer.files);
					}}
				>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						hidden
						onChange={e => {
							if (e.target.files?.length) addImageFiles(e.target.files);
							e.target.value = '';
						}}
					/>
					{attachments.length > 0 && (
						<div className="composer-attachments">
							{attachments.map((src, i) => (
								<div key={i} className="composer-attachment">
									<img src={src} alt="" />
									<button type="button" aria-label="Remove image" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>×</button>
								</div>
							))}
						</div>
					)}
					{commandVisible && (
						<ComposerCommandMenu
							input={input}
							caret={caret}
							tree={tree}
							agentMode={agentMode}
							activeIndex={cmdIndex}
							onHoverIndex={setCmdIndex}
							onSelect={(next, nextCaret) => {
								setInput(next);
								setCaret(nextCaret);
								setCmdDismissed(false);
								requestAnimationFrame(() => {
									const el = inputRef.current;
									if (el) {
										el.focus();
										el.setSelectionRange(nextCaret, nextCaret);
									}
								});
							}}
							onModeChange={setSessionMode}
							onClose={() => setCmdDismissed(true)}
						/>
					)}

					<div className="composer-row">
						<div className="composer-plus-wrap" ref={plusMenuRef}>
							<button
								type="button"
								className={`composer-plus${plusMenuOpen ? ' open' : ''}`}
								title="Add agents, context, tools"
								disabled={running}
								onClick={() => setPlusMenuOpen(v => !v)}
							>
								<IconPlus width={14} height={14} />
							</button>
							{plusMenuOpen && (
								<div className="composer-plus-menu">
									<div className="composer-plus-search">Add agents, context, tools...</div>
									<div className="composer-plus-shortcuts">
										<button type="button" className="composer-plus-shortcut" onClick={() => pickQuickMode('plan')}>
											<span className="composer-plus-entry-left">
												<IconSliders width={15} height={15} />
												<span>Plan</span>
											</span>
										</button>
										<button type="button" className="composer-plus-shortcut" onClick={() => pickQuickMode('debug')}>
											<span className="composer-plus-entry-left">
												<IconWrench width={15} height={15} />
												<span>Debug</span>
											</span>
										</button>
										<button type="button" className="composer-plus-shortcut" onClick={() => pickQuickMode('code')}>
											<span className="composer-plus-entry-left">
												<IconHelp width={15} height={15} />
												<span>Ask</span>
											</span>
										</button>
									</div>
									<div className="composer-plus-divider" />
									<button
										type="button"
										className="composer-plus-entry"
										onClick={() => {
											setPlusMenuOpen(false);
											fileInputRef.current?.click();
										}}
									>
										<span className="composer-plus-entry-left">
											<IconPaperclip width={15} height={15} />
											<span>Files</span>
										</span>
									</button>
									<button type="button" className="composer-plus-entry">
										<span className="composer-plus-entry-left">
											<IconHexagon width={15} height={15} />
											<span>Models</span>
										</span>
										<IconChevron width={12} height={12} />
									</button>
									<button type="button" className="composer-plus-entry">
										<span className="composer-plus-entry-left">
											<IconBook width={15} height={15} />
											<span>Skills</span>
										</span>
										<IconChevron width={12} height={12} />
									</button>
									<button type="button" className="composer-plus-entry">
										<span className="composer-plus-entry-left">
											<IconLink width={15} height={15} />
											<span>MCP Servers</span>
										</span>
										<IconChevron width={12} height={12} />
									</button>
								</div>
							)}
						</div>
						<button
							type="button"
							className="composer-auto"
							title="Model selection (edit ~/Copix/settings.json)"
						>
							<span>Auto</span>
							<IconChevron width={11} height={11} style={{ transform: 'rotate(90deg)' }} />
						</button>
						<textarea
							ref={inputRef}
							className="composer-input"
							placeholder={
								!modelReady
									? 'Set up your Copix model to start chatting…'
									: messages.length
										? 'Send follow-up'
										: 'Ask Copix… (@ files, / commands, paste images)'
							}
							value={input}
							disabled={running || !workspace || !modelReady}
							rows={1}
							onChange={e => {
								setInput(e.target.value);
								setCaret(e.target.selectionStart);
								setCmdDismissed(false);
								setCmdIndex(0);
								e.target.style.height = 'auto';
								e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
							}}
							onClick={e => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
							onKeyUp={e => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
							onPaste={handlePaste}
							onKeyDown={e => {
								if (handleCommandMenuKey(
									e,
									commandVisible,
									cmdIndex,
									commandMenu?.items.length ?? 0,
									setCmdIndex,
									() => {
										if (!commandMenu) return;
										pickComposerItem(commandMenu, cmdIndex, input, caret, {
											onSelect: (next, nextCaret) => {
												setInput(next);
												setCaret(nextCaret);
												requestAnimationFrame(() => {
													const el = inputRef.current;
													if (el) {
														el.focus();
														el.setSelectionRange(nextCaret, nextCaret);
													}
												});
											},
											onModeChange: setSessionMode,
											onClose: () => setCmdDismissed(true),
										});
									},
									() => setCmdDismissed(true),
								)) return;
								if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
							}}
						/>
						<button type="button" className="composer-mic" title="Voice input (coming soon)" disabled>
							<IconMic width={14} height={14} />
						</button>
						{running ? (
							<button
								type="button"
								className="composer-send composer-stop"
								title="Stop"
								onClick={stopRun}
							>
								<IconStop width={11} height={11} />
							</button>
						) : (
							<button
								type="button"
								className="composer-send"
								disabled={(!input.trim() && !attachments.length) || !modelReady}
								onClick={() => send(input)}
								title="Send"
							>
								<IconArrowUp width={14} height={14} />
							</button>
						)}
					</div>
				</div>
			</div>
			</div>

			<div className="chat-footer">
				<span className="chat-footer-item" title={workspace || 'No workspace'}>
					<IconBranch width={13} height={13} />
					<span>{branchLabel}</span>
				</span>
				<span className="chat-footer-item" title={workspaceEnv === 'desktop' ? 'Local workspace' : 'Cloud / GitHub workspace'}>
					<IconCloud width={13} height={13} />
					<span>{locationLabel}</span>
					<IconChevron width={10} height={10} style={{ transform: 'rotate(90deg)' }} />
				</span>
				<span className="chat-footer-spacer" />
				{running ? <span className="chat-footer-spinner" aria-label="Working" /> : null}
				{liveStatus && !running ? (
					<span className="chat-footer-status">{liveStatus}</span>
				) : null}
			</div>

		</div>

	);

}



function shortPath(p: string): string {

	const parts = p.replace(/\\/g, '/').split('/');

	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;

}


