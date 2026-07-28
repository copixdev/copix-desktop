import { useMemo } from 'react';
import type { ChatActivity } from '../chatActivity';
import { formatActivityDisplay, isVisibleThought, summarizeWorkflow } from '../chatActivity';
import { ChatActivityList } from './ChatActivityList';

interface Props {
	activities: ChatActivity[];
	expanded: boolean;
	onToggle: () => void;
	live?: boolean;
}

function formatDuration(ms: number): string {
	const sec = Math.max(1, Math.round(ms / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const rem = sec % 60;
	return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function AgentWorkflowCard({ activities, expanded, onToggle, live }: Props) {
	const summary = useMemo(() => summarizeWorkflow(activities), [activities]);
	const active = activities.find(a => a.phase === 'active');
	const activeLabel = active ? formatActivityDisplay(active) : null;
	const activeText = activeLabel
		? [activeLabel.verb, activeLabel.target].filter(Boolean).join(' ') + (activeLabel.ellipsis ? '…' : '')
		: '';

	const thoughtLine = isVisibleThought(active) || isVisibleThought(activities.find(a => a.kind === 'think'))
		? (summary.thoughtSec != null ? `Thought for ${summary.thoughtSec}s` : (live ? 'Rate limited…' : null))
		: null;

	const statsLine = [
		summary.reads ? `Explored ${summary.reads} file${summary.reads === 1 ? '' : 's'}` : '',
		summary.searches ? `${summary.searches} search${summary.searches === 1 ? '' : 'es'}` : '',
		summary.runs ? `ran ${summary.runs} command${summary.runs === 1 ? '' : 's'}` : '',
		summary.edits ? `Editing ${summary.edits} file${summary.edits === 1 ? '' : 's'}` : '',
	].filter(Boolean).join(', ');

	const addedLines = activities.reduce((n, a) => n + (a.diff?.added ?? 0), 0);

	return (
		<div className={`workflow-card${expanded ? ' open' : ''}${live ? ' live' : ''}`}>
			{thoughtLine && (
				<button type="button" className="workflow-thought-btn" onClick={onToggle} aria-expanded={expanded}>
					<span className="workflow-thought">{thoughtLine}</span>
					{!live && (
						<span className="workflow-worked"> · Worked for {formatDuration(summary.durationMs)}</span>
					)}
				</button>
			)}

			{summary.headline && (
				<div className="workflow-headline">{summary.headline}</div>
			)}

			{(statsLine || addedLines > 0) && (
				<div className="workflow-stats">
					<span>{statsLine || (summary.edits ? `Editing ${summary.edits} files` : '')}</span>
					{addedLines > 0 && <span className="workflow-stat-add">+{addedLines}</span>}
				</div>
			)}

			{live && (
				<div className="workflow-live-current" aria-live="polite">
					{activeText || 'Planning next moves'}
				</div>
			)}

			{expanded && (
				<div className="workflow-body">
					{summary.subtasks.length > 0 && (
						<ul className="workflow-subtasks">
							{summary.subtasks.map((task, i) => (
								<li key={i}>
									<span className="workflow-task-label">{task.label}</span>
									{task.auto && <span className="workflow-task-auto">Auto</span>}
									{task.detail && <div className="workflow-task-detail">{task.detail}</div>}
								</li>
							))}
						</ul>
					)}
					<ChatActivityList activities={activities} />
				</div>
			)}
		</div>
	);
}

export function liveStatusFromActivities(activities: ChatActivity[], fallback = ''): string {
	const active = [...activities].reverse().find(a => a.phase === 'active' && (a.kind !== 'think' || isVisibleThought(a)));
	if (!active) return fallback || 'Planning next moves';
	const label = formatActivityDisplay(active);
	return [label.verb, label.target].filter(Boolean).join(' ') + (label.ellipsis ? '…' : '');
}
