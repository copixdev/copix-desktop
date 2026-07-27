import { useMemo, useState } from 'react';
import {
	fileGlyph,
	sumChanges,
	type FileChange,
} from '../utils/fileChanges';

interface Props {
	files: FileChange[];
	onOpenFile: (path: string) => void;
	selectedPath?: string;
	workspace?: string;
	title?: string;
}

function displayPath(filePath: string, workspace?: string): string {
	const norm = filePath.replace(/\\/g, '/');
	if (!workspace) return norm;
	const ws = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
	if (norm.toLowerCase().startsWith(ws.toLowerCase() + '/')) {
		return norm.slice(ws.length + 1);
	}
	return norm;
}

function DiffPreview({ text, large }: { text: string; large?: boolean }) {
	const lines = text.split('\n').filter(Boolean);
	if (!lines.length) return null;
	return (
		<div className={`changes-diff-preview${large ? ' large' : ''}`}>
			{lines.map((line, i) => {
				const add = line.startsWith('+ ');
				const del = line.startsWith('- ');
				return (
					<div key={i} className={`diff-line${add ? ' add' : del ? ' del' : ''}`}>
						{line}
					</div>
				);
			})}
		</div>
	);
}

export function ChangesPanel({
	files,
	onOpenFile,
	selectedPath,
	workspace,
	title = 'Last Turn Changes',
}: Props) {
	const totals = useMemo(() => sumChanges(files), [files]);
	const [openPath, setOpenPath] = useState<string | undefined>(files[0]?.path);

	const active = files.find(f => f.path === (openPath ?? selectedPath));

	return (
		<div className="changes-panel">
			<div className="changes-panel-head">
				<div className="changes-summary">
					<span className="changes-summary-label">{title}</span>
					{totals.added > 0 && <span className="commit-add">+{totals.added}</span>}
					{totals.removed > 0 && <span className="commit-del">-{totals.removed}</span>}
				</div>
				<span className="changes-panel-meta">
					{files.length} file{files.length === 1 ? '' : 's'}
				</span>
			</div>

			{!files.length ? (
				<div className="changes-empty">
					<p>No file changes yet</p>
					<p className="muted-xs">Edits from the agent will show up here</p>
				</div>
			) : (
				<div className="changes-body">
					<ul className="changes-file-list">
						{files.map(f => {
							const label = displayPath(f.path, workspace);
							const activeRow = selectedPath === f.path || openPath === f.path;
							return (
								<li key={f.path}>
									<button
										type="button"
										className={`changes-file-row${activeRow ? ' active' : ''}`}
										onClick={() => {
											setOpenPath(f.path);
											onOpenFile(f.path);
										}}
										title={f.path}
									>
										<span className="files-changed-icon" aria-hidden>{fileGlyph(f.name)}</span>
										<span className="files-changed-name">{label}</span>
										<span className="files-changed-stats">
											{f.added > 0 && <span className="commit-add">+{f.added}</span>}
											{f.removed > 0 && <span className="commit-del">-{f.removed}</span>}
										</span>
									</button>
									{activeRow && f.preview && <DiffPreview text={f.preview} />}
								</li>
							);
						})}
					</ul>
					{active?.preview && (
						<div className="changes-detail">
							<div className="changes-detail-path">{displayPath(active.path, workspace)}</div>
							<DiffPreview text={active.preview} large />
						</div>
					)}
				</div>
			)}
		</div>
	);
}
