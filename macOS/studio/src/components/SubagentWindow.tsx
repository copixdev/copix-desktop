import { useCallback, useEffect, useRef, useState } from 'react';
import { runAgent } from '../models/router';
import { resolveModelConfig } from '../models/config';
import { inferTaskKind } from '../models/modelSelector';
import { chatMessagesToAgentHistory } from '../utils/agentHistory';
import {
	appendThinkingThought,
	createThinkingActivity,
	createToolActivity,
	finalizeThinking,
	finalizeToolActivity,
	formatActivityDisplay,
	type ChatActivity,
} from '../chatActivity';
import { liveStatusFromActivities } from './AgentWorkflowCard';
import type { ChatSession } from '../hooks/chatSessions';
import type { AppSettings, ChatMessage } from '../types';
import { IconExpand, IconX } from './Icons';

interface Props {
	session: ChatSession;
	settings: AppSettings;
	installedModels: string[];
	serverOnline: boolean;
	onMessagesChange: (sessionId: string, messages: ChatMessage[], title?: string) => void;
	onPendingPromptConsumed: (sessionId: string) => void;
	onDismiss: (sessionId: string) => void;
	onExpand: (sessionId: string) => void;
	onSpawnSubagent?: (prompt: string, label?: string) => Promise<{ sessionId: string }>;
}

export function SubagentWindow({
	session,
	settings,
	installedModels,
	serverOnline,
	onMessagesChange,
	onPendingPromptConsumed,
	onDismiss,
	onExpand,
	onSpawnSubagent,
}: Props) {
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState('');
	const [activities, setActivities] = useState<ChatActivity[]>([]);
	const [expanded, setExpanded] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const thinkingIdRef = useRef<string | null>(null);
	const activitiesRef = useRef<ChatActivity[]>([]);
	const pendingSentRef = useRef(false);
	const workspace = session.workspaceRoot;

	const patchActivities = useCallback((fn: (prev: ChatActivity[]) => ChatActivity[]) => {
		setActivities(prev => {
			const next = fn(prev);
			activitiesRef.current = next;
			return next;
		});
	}, []);

	const runPrompt = useCallback(async (prompt: string) => {
		if (!prompt.trim() || running || !workspace || !serverOnline) return;

		setRunning(true);
		setStatus('');
		patchActivities(() => []);
		thinkingIdRef.current = null;
		abortRef.current?.abort();
		abortRef.current = new AbortController();

		const userMsg: ChatMessage = {
			id: `u-${Date.now()}`,
			role: 'user',
			content: prompt.trim(),
			timestamp: Date.now(),
		};
		const nextMessages = [...session.messages, userMsg];
		onMessagesChange(session.id, nextMessages);

		let buf = '';
		const aid = `a-${Date.now()}`;

		try {
			const agentMode = settings.agentMode;
			const runConfig = resolveModelConfig(settings.model, agentMode, installedModels, prompt);
			const taskKind = inferTaskKind(prompt, agentMode);

			await runAgent(
				prompt.trim(),
				runConfig,
				{
					sessionId: session.id,
					workspaceRoot: workspace,
					onSpawnSubagent,
				},
				chatMessagesToAgentHistory(session.messages),
				abortRef.current.signal,
				{
					onText: c => { buf += c; },
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
						setStatus([label.verb, label.target].filter(Boolean).join(' ') + (label.ellipsis ? '…' : ''));
					},
					onToolEnd: (callId, _tool, _args, meta) => {
						patchActivities(p => p.map(a => a.id === callId
							? finalizeToolActivity(a, { result: meta.result, diff: meta.diff })
							: a));
						setStatus('');
					},
					onStatus: setStatus,
					onStructuredResponse: parsed => { buf = parsed.message; },
					onClearText: () => { buf = ''; },
				},
				{ mode: agentMode, taskKind },
			);

			const turnActivities = activitiesRef.current.length ? [...activitiesRef.current] : undefined;
			const reply = buf.trim();
			onMessagesChange(session.id, [...nextMessages, {
				id: aid,
				role: 'assistant',
				content: reply || (turnActivities?.length ? '' : '(done)'),
				timestamp: Date.now(),
				activities: turnActivities,
			}]);
			patchActivities(() => []);
		} catch (err) {
			const e = err instanceof Error ? err.message : String(err);
			onMessagesChange(session.id, [...nextMessages, {
				id: aid,
				role: 'assistant',
				content: `__AGENT_ERROR__${e}`,
				timestamp: Date.now(),
				activities: activitiesRef.current.length ? [...activitiesRef.current] : undefined,
			}]);
			patchActivities(() => []);
		} finally {
			setRunning(false);
			setStatus('');
		}
	}, [
		running, workspace, serverOnline, session.id, session.messages, settings,
		installedModels, onMessagesChange, onSpawnSubagent, patchActivities,
	]);

	useEffect(() => {
		if (!session.pendingPrompt?.trim() || pendingSentRef.current || running || !workspace || !serverOnline) return;
		pendingSentRef.current = true;
		onPendingPromptConsumed(session.id);
		void runPrompt(session.pendingPrompt);
	}, [session.pendingPrompt, session.id, running, workspace, serverOnline, onPendingPromptConsumed, runPrompt]);

	useEffect(() => () => { abortRef.current?.abort(); }, []);

	const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
	const done = !running && Boolean(lastAssistant) && !session.pendingPrompt;
	const liveStatus = running
		? (status || liveStatusFromActivities(activities) || 'Working…')
		: lastAssistant?.content?.replace(/^__AGENT_ERROR__/, '').slice(0, 120) || 'Done';

	const recentTools = (running ? activities : lastAssistant?.activities ?? [])
		.filter(a => a.kind !== 'think')
		.slice(-3);

	return (
		<div className={`subagent-window${running ? ' running' : ''}${done ? ' done' : ''}`}>
			<div className="subagent-head">
				<span className={`subagent-dot${running ? ' live' : done ? ' ok' : ''}`} />
				<button type="button" className="subagent-title" onClick={() => setExpanded(v => !v)} title={session.title}>
					{session.title}
				</button>
				<div className="subagent-actions">
					<button type="button" className="btn-icon" title="Open full session" onClick={() => onExpand(session.id)}>
						<IconExpand width={12} height={12} />
					</button>
					<button type="button" className="btn-icon" title="Dismiss" onClick={() => onDismiss(session.id)}>
						<IconX width={12} height={12} />
					</button>
				</div>
			</div>
			<div className="subagent-status">{liveStatus}</div>
			{(expanded || running) && recentTools.length > 0 && (
				<ul className="subagent-steps">
					{recentTools.map(a => {
						const label = formatActivityDisplay(a);
						return (
							<li key={a.id} className={a.phase === 'active' ? 'active' : ''}>
								{[label.verb, label.target].filter(Boolean).join(' ')}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
