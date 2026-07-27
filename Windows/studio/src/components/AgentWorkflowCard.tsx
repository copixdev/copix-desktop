import { useMemo } from 'react';
import type { ChatActivity } from '../chatActivity';
import { formatActivityDisplay, summarizeWorkflow } from '../chatActivity';
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

	const headerText = live
		? (expanded && activeText ? activeText : 'Working…')
		: `Worked for ${formatDuration(summary.durationMs)}`;

	return (
		<div className={`workflow-card${expanded ? ' open' : ''}${live ? ' live' : ''}`}>
			<button type="button" className="workflow-header" onClick={onToggle} aria-expanded={expanded}>
				<span className="workflow-caret" aria-hidden>{expanded ? '▾' : '▸'}</span>
				<span className="workflow-title">{headerText}</span>
			</button>
			{expanded && (
				<div className="workflow-body">
					{summary.thoughtSec != null && (
						<div className="workflow-thought">Thought for {summary.thoughtSec}s</div>
					)}
					{summary.headline && (
						<div className="workflow-headline">{summary.headline}</div>
					)}
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
					{(summary.reads > 0 || summary.searches > 0 || summary.edits > 0) && (
						<div className="workflow-stats">
							{[
								summary.reads ? `Explored ${summary.reads} file${summary.reads === 1 ? '' : 's'}` : '',
								summary.searches ? `${summary.searches} search${summary.searches === 1 ? '' : 'es'}` : '',
								summary.edits ? `${summary.edits} edit${summary.edits === 1 ? '' : 's'}` : '',
							].filter(Boolean).join(', ')}
						</div>
					)}
					<ChatActivityList activities={activities} />
				</div>
			)}
		</div>
	);
}

export function liveStatusFromActivities(activities: ChatActivity[], fallback = ''): string {
	const active = [...activities].reverse().find(a => a.phase === 'active');
	if (!active) return fallback;
	const label = formatActivityDisplay(active);
	return [label.verb, label.target].filter(Boolean).join(' ') + (label.ellipsis ? '…' : '');
}
