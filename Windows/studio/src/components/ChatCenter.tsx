import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';

import { runAgent } from '../models/router';

import { settingsToConfig } from '../models/config';

import { copix } from '../api';

import { MarkdownMessage } from './MarkdownMessage';

import {

	createDemoActivities,

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

import { IconSend, IconPlay, IconCloud, IconChevron, IconCopy } from './Icons';
import { ComposerCommandMenu, handleCommandMenuKey, pickComposerItem, useComposerCommands } from './ComposerCommands';
import type { AgentMode } from '../models/agentModes';
import { AgentErrorCard } from './AgentErrorCard';
import { UserPromptPill } from './UserPromptPill';
import { FilesChangedCard, type FileChange } from './FilesChangedCard';
import { collectFileChanges } from '../utils/fileChanges';
import { AgentWorkflowCard, liveStatusFromActivities } from './AgentWorkflowCard';
import { ChatActivityList } from './ChatActivityList';



/** Set true to preview activity rows on the empty chat screen. */

const SHOW_ACTIVITY_DEMO = false;



interface Props {

	sessionId: string;

	workspace?: string;

	settings: AppSettings;

	messages: ChatMessage[];

	onMessagesChange: (msgs: ChatMessage[], title?: string) => void;

	onWorkspaceChange: (root: string) => void;

	onOpenSetup: () => void;

	onOpenSettings: () => void;

	tree?: string[];

	onAgentModeChange?: (mode: AgentMode) => void;

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
	onOpenSettings,
	onOpenFile,
	onReviewFiles,
}: {
	activities?: ChatActivity[];
	content?: string;
	timestamp?: number;
	live?: boolean;
	onOpenSettings?: () => void;
	onOpenFile?: (path: string) => void;
	onReviewFiles?: (files: FileChange[]) => void;
}) {
	const [workflowOpen, setWorkflowOpen] = useState(false);

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
							<AgentErrorCard error={errorRaw} onOpenSettings={onOpenSettings} />
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

	sessionId, workspace, settings, messages, onMessagesChange, onWorkspaceChange, onOpenSetup, onOpenSettings,
	tree = [], onAgentModeChange, onOpenFile, onReviewFiles, onSpawnSubagent, pendingPrompt, onPendingPromptConsumed,

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

	const [server, setServer] = useState<{ online: boolean; adapter?: boolean }>({ online: false });

	const [starting, setStarting] = useState(false);

	const abortRef = useRef<AbortController | null>(null);
	const pendingPromptSentRef = useRef(false);

	const listRef = useRef<HTMLDivElement>(null);

	const endRef = useRef<HTMLDivElement>(null);
	const autoFollowRef = useRef(true);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const commandMenu = useComposerCommands(input, caret, tree);
	const commandVisible = Boolean(commandMenu && commandMenu.items.length && !cmdDismissed);



	// Only route to the tuned model when it actually exists in Ollama; otherwise use base gpt-oss.
	const config = settingsToConfig({
		...settings.model,
		preferTuned: settings.model.preferTuned && Boolean(server.adapter),
	});

	const account = settings.accounts.find(a => a.id === settings.activeAccountId);

	const agentMode = settings.agentMode;

	// Cloud providers don't need local Ollama — a configured API key means we're ready.
	const isCloud = settings.model.provider === 'cloud';

	const modelReady = isCloud ? Boolean(settings.model.apiKey) : server.online;

	const demoActivities = useMemo(
		() => (SHOW_ACTIVITY_DEMO ? createDemoActivities() : []),
		[],
	);



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

			if (!r.ok) onOpenSetup();

		} finally {

			setStarting(false);

		}

	};



	const send = async (text: string, images = attachments) => {

		const msg = text.trim();

		if ((!msg && !images.length) || running || !workspace) return;

		if (!modelReady) {

			toast(isCloud ? 'Add your cloud API key in Settings first' : 'Start Copix Core server first', 'err');

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

		const agentMsg = images.length
			? `${msg}${msg ? '\n\n' : ''}[User attached ${images.length} image${images.length === 1 ? '' : 's'}]`
			: msg;

		const nextMessages = [...messages, userMsg];

		onMessagesChange(nextMessages, titleFromMessage(msg));



		abortRef.current?.abort();

		abortRef.current = new AbortController();

		let buf = '';

		const aid = `a-${Date.now()}`;

		let structuredActions: AgentAction[] | undefined;



		try {

			await runAgent(

				agentMsg, config,

				{
					sessionId,
					workspaceRoot: workspace,
					onWorkspaceChange: onWorkspaceChange,
					onSpawnSubagent,
				},

				messages.map(m => ({ role: m.role, content: m.content })),

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

				{ mode: agentMode, customRules: settings.systemPrompt.customRules },

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
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			e.preventDefault();
			const file = item.getAsFile();
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result;
				if (typeof dataUrl === 'string') {
					setAttachments(prev => [...prev, dataUrl]);
				}
			};
			reader.readAsDataURL(file);
		}
	};
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

	return (

		<div className="chat-center">

			{!modelReady && (
				<div className="banner banner-warn">
					{isCloud ? (
						<>
							<span>Cloud model needs an API key — grab a free key from OpenRouter or Groq.</span>
							<button type="button" className="btn primary sm" onClick={onOpenSettings}>Open Settings</button>
						</>
					) : (
						<>
							<span>Copix model offline — install Ollama and download gpt-oss:20b, or switch to a free cloud model in Settings.</span>
							<button type="button" className="btn primary sm" disabled={starting} onClick={startServer}>
								<IconPlay width={12} height={12} /> {starting ? 'Checking…' : 'Check Ollama'}
							</button>
							<button type="button" className="btn ghost sm" onClick={onOpenSetup}>Set up model</button>
							<button type="button" className="btn ghost sm" onClick={onOpenSettings}>Use cloud</button>
						</>
					)}
				</div>
			)}

			<div className="chat-stream" ref={listRef} onScroll={() => {

				const el = listRef.current;

				if (!el) return;
				const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
				const nearBottom = distance < 80;
				autoFollowRef.current = nearBottom;
				setShowScroll(!nearBottom);

			}}>

				{!messages.length && !streaming && !running && (

					<div className="chat-empty">

						<div className="empty-glow" />

						<h2>What should we build?</h2>

						<p>Describe your project — I'll create the repo, write code, and run commands.</p>

						<div className="suggestion-grid">
							{SUGGESTIONS.map(s => (
								<button
									key={s.title}
									type="button"
									className="suggestion-card"
									onClick={() => {
										setInput(s.prompt);
										document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();
									}}
								>
									<span className="suggestion-title">{s.title}</span>
									<span className="suggestion-text">{s.prompt}</span>
								</button>
							))}
						</div>

						{demoActivities.length > 0 && (

							<div className="activity-demo">

								<span className="activity-demo-label">Activity preview</span>

								<ChatActivityList activities={demoActivities} />

							</div>

						)}

					</div>

				)}

				{messages.map(m => (
					m.role === 'user' ? (
						<UserPromptPill key={m.id} content={m.content} images={m.images} onReuse={reusePrompt} />
					) : (
						<AssistantTurn
							key={m.id}
							activities={m.activities}
							content={m.content}
							timestamp={m.timestamp}
							onOpenSettings={onOpenSettings}
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
						onOpenSettings={onOpenSettings}
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
				<div className="composer-meta">
					<button type="button" className="model-chip" title="Change model" onClick={onOpenSettings}>
						{isCloud && <IconCloud width={12} height={12} />}
						<span className={`chip-dot ${modelReady ? 'on' : ''}`} />
						<span className="chip-model">{config.model}</span>
						<IconChevron width={11} height={11} className="chip-chevron" />
					</button>
					<span className="composer-hint">
						{account?.displayName}
						{workspace ? ` · ${shortPath(workspace)}` : ''}
					</span>
					<span className="composer-keys">Enter to send · Shift+Enter for newline</span>
				</div>

				<div className={`composer-inner${running ? ' disabled' : ''}`}>
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
							onModeChange={onAgentModeChange}
							onClose={() => setCmdDismissed(true)}
						/>
					)}

					<textarea

						ref={inputRef}

						className="composer-input"

						placeholder={modelReady ? 'Ask Copix… (@ files, / commands)' : 'Set up your Copix model to start chatting…'}

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
										onModeChange: onAgentModeChange,
										onClose: () => setCmdDismissed(true),
									});
								},
								() => setCmdDismissed(true),
							)) return;

							if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }

						}}

					/>

					<button

						type="button"

						className="composer-send"

						disabled={running || (!input.trim() && !attachments.length) || !modelReady}

						onClick={() => send(input)}

					>

						<IconSend width={18} height={18} />

					</button>

				</div>

				{liveStatus && (
					<div className="composer-live-status" aria-live="polite">{liveStatus}</div>
				)}

			</div>

		</div>

	);

}



function shortPath(p: string): string {

	const parts = p.replace(/\\/g, '/').split('/');

	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;

}


