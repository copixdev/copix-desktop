import { useMemo, useState } from 'react';
import { formatActivityDisplay, type ChatActivity } from '../chatActivity';

interface Props {
	activity: ChatActivity;
}

function renderDetailContent(detail: string) {
	const lines = detail.split('\n');
	return lines.map((line, i) => {
		if (line.startsWith('+ ')) {
			return <div key={i} className="diff-line add">{line}</div>;
		}
		if (line.startsWith('- ')) {
			return <div key={i} className="diff-line del">{line}</div>;
		}
		return <div key={i} className="diff-line">{line}</div>;
	});
}

export function ChatActivityRow({ activity }: Props) {
	const { verb, target, ellipsis, commitBadge } = formatActivityDisplay(activity);
	const [expanded, setExpanded] = useState(false);

	const detailText = useMemo(() => {
		if (activity.kind === 'think') return activity.thought?.trim() ?? '';
		if (activity.detail?.trim()) return activity.detail.trim();
		if (activity.result?.trim()) return activity.result.trim();
		return '';
	}, [activity.kind, activity.detail, activity.thought, activity.result]);

	const showDiff = activity.kind === 'edit' && activity.diff?.preview;
	const canExpand = activity.kind === 'think'
		? Boolean(activity.thought?.trim())
		: Boolean(detailText || showDiff);

	return (
		<div className={`activity-item ${expanded ? 'open' : ''}`}>
			<button
				type="button"
				className={`activity-row ${activity.phase}`}
				data-kind={activity.kind}
				aria-live={activity.phase === 'active' ? 'polite' : 'off'}
				aria-expanded={expanded}
				onClick={() => canExpand && setExpanded(v => !v)}
				disabled={!canExpand}
				title={canExpand ? 'Toggle details' : undefined}
			>
				{canExpand && <span className="activity-caret" aria-hidden>{expanded ? '▾' : '▸'}</span>}
				<span className="activity-verb">{verb}</span>
				{target && <span className="activity-target">{target}</span>}
				{commitBadge && (
					<span className="activity-commit" title="Lines changed">
						<span className="commit-add">+{activity.diff!.added}</span>
						<span className="commit-del">-{activity.diff!.removed}</span>
					</span>
				)}
				{ellipsis && <span className="activity-ellipsis" aria-hidden>...</span>}
			</button>
			{expanded && canExpand && (
				<div className="activity-detail">
					{activity.kind === 'think' ? (
						<div className="activity-thought">{activity.thought}</div>
					) : showDiff ? (
						<div className="activity-diff">{renderDetailContent(activity.diff!.preview)}</div>
					) : (
						<pre className="activity-result">{detailText}</pre>
					)}
				</div>
			)}
		</div>
	);
}
