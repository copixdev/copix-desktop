import { useMemo, useState } from 'react';
import type { ChatActivity } from '../chatActivity';
import {
	collectFileChanges,
	fileGlyph,
	sumChanges,
	type FileChange,
} from '../utils/fileChanges';

export type { FileChange };

interface Props {
	activities?: ChatActivity[];
	files?: FileChange[];
	onReview?: (files: FileChange[]) => void;
	onOpenFile?: (path: string) => void;
	collapsedMax?: number;
	/** Compact header only: Changes +N -M */
	compact?: boolean;
}

export function FilesChangedCard({
	activities,
	files: filesProp,
	onReview,
	onOpenFile,
	collapsedMax = 4,
	compact = false,
}: Props) {
	const files = useMemo(
		() => filesProp ?? collectFileChanges(activities),
		[activities, filesProp],
	);
	const [expanded, setExpanded] = useState(false);
	const totals = useMemo(() => sumChanges(files), [files]);

	if (!files.length) return null;

	const visible = expanded || compact ? files : files.slice(0, collapsedMax);
	const hidden = Math.max(0, files.length - collapsedMax);

	return (
		<div className={`files-changed-card${compact ? ' compact' : ''}`}>
			<div className="files-changed-head">
				{compact ? (
					<div className="changes-summary">
						<span className="changes-summary-label">Changes</span>
						{totals.added > 0 && <span className="commit-add">+{totals.added}</span>}
						{totals.removed > 0 && <span className="commit-del">-{totals.removed}</span>}
					</div>
				) : (
					<span className="files-changed-count">
						{files.length} {files.length === 1 ? 'File' : 'Files'} Changed
					</span>
				)}
				{!compact && (
					<button
						type="button"
						className="files-changed-review"
						onClick={() => onReview?.(files)}
					>
						Review
					</button>
				)}
			</div>
			{!compact && (
				<ul className="files-changed-list">
					{visible.map(f => (
						<li key={f.path}>
							<button
								type="button"
								className="files-changed-row"
								title={f.path}
								onClick={() => onOpenFile?.(f.path)}
							>
								<span className="files-changed-icon" aria-hidden>{fileGlyph(f.name)}</span>
								<span className="files-changed-name">{f.name}</span>
								<span className="files-changed-stats">
									{f.added > 0 && <span className="commit-add">+{f.added}</span>}
									{f.removed > 0 && <span className="commit-del">-{f.removed}</span>}
								</span>
							</button>
						</li>
					))}
					{!expanded && hidden > 0 && (
						<li>
							<button type="button" className="files-changed-more" onClick={() => setExpanded(true)}>
								<span className="files-changed-icon" aria-hidden>···</span>
								Show {hidden} more
							</button>
						</li>
					)}
				</ul>
			)}
		</div>
	);
}
