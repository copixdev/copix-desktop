import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { EditorTab } from '../types';
import { FileTree } from './FileTree';
import { TerminalPanel } from './TerminalPanel';
import { ChangesPanel } from './ChangesPanel';
import type { FileChange } from '../utils/fileChanges';
import {
	IconX, IconPlus, IconPanelRight,
	IconBranch, IconGlobe, IconTerminal, IconFile, IconFolder, IconChevron,
} from './Icons';

export type SidePanelMode = 'hub' | 'changes' | 'terminal' | 'files' | 'browser';

type OpenableMode = Exclude<SidePanelMode, 'hub'>;

interface Props {
	tabs: EditorTab[];
	activePath?: string;
	workspace?: string;
	tree: string[];
	theme?: 'light' | 'dark';
	fileChanges?: FileChange[];
	mode?: SidePanelMode;
	onModeChange?: (mode: SidePanelMode) => void;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
	onChange: (path: string, content: string) => void;
	onOpenFile: (path: string) => void;
	onNewAgent?: () => void;
	onOpenFolder?: () => void;
	onFocusComposer?: () => void;
	onTogglePanel?: () => void;
}

const PANEL_DEFS: { id: OpenableMode; label: string; Icon: typeof IconFile }[] = [
	{ id: 'files', label: 'File', Icon: IconFile },
	{ id: 'terminal', label: 'Terminal', Icon: IconTerminal },
	{ id: 'browser', label: 'Browser', Icon: IconGlobe },
	{ id: 'changes', label: 'Changes', Icon: IconBranch },
];

function lang(path: string): string {
	if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
	if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
	if (path.endsWith('.json')) return 'json';
	if (path.endsWith('.css')) return 'css';
	if (path.endsWith('.html')) return 'html';
	if (path.endsWith('.md')) return 'markdown';
	if (path.endsWith('.py')) return 'python';
	return 'plaintext';
}

function shortPath(p?: string): string {
	if (!p) return 'No folder';
	const parts = p.replace(/\\/g, '/').split('/');
	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

export function EditorArea({
	tabs, activePath, workspace, tree, theme = 'dark',
	fileChanges = [], mode: modeProp, onModeChange,
	onSelect, onClose, onChange, onOpenFile,
	onOpenFolder, onFocusComposer, onTogglePanel,
}: Props) {
	const [mode, setMode] = useState<SidePanelMode>(modeProp ?? (tabs.length ? 'files' : 'hub'));
	const [openTabs, setOpenTabs] = useState<OpenableMode[]>(() =>
		modeProp && modeProp !== 'hub' ? [modeProp] : tabs.length ? ['files'] : ['browser'],
	);
	const [plusOpen, setPlusOpen] = useState(false);
	const [plusQuery, setPlusQuery] = useState('');
	const plusRef = useRef<HTMLDivElement>(null);
	const active = tabs.find(t => t.path === activePath);

	useEffect(() => {
		if (!modeProp) return;
		setMode(modeProp);
		if (modeProp !== 'hub') {
			setOpenTabs(prev => prev.includes(modeProp) ? prev : [...prev, modeProp]);
		}
	}, [modeProp]);

	useEffect(() => {
		if (!plusOpen) return;
		const onDoc = (e: MouseEvent) => {
			if (!plusRef.current?.contains(e.target as Node)) setPlusOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [plusOpen]);

	const go = (next: SidePanelMode) => {
		setMode(next);
		onModeChange?.(next);
		if (next !== 'hub') {
			setOpenTabs(prev => prev.includes(next) ? prev : [...prev, next]);
		}
	};

	const closeTab = (id: OpenableMode) => {
		setOpenTabs(prev => {
			const next = prev.filter(t => t !== id);
			if (mode === id) {
				const fallback = next[next.length - 1] ?? 'hub';
				setMode(fallback);
				onModeChange?.(fallback);
			}
			return next;
		});
	};

	const menuItems = useMemo(() => {
		const q = plusQuery.trim().toLowerCase();
		return PANEL_DEFS.filter(d => !q || d.label.toLowerCase().includes(q));
	}, [plusQuery]);

	return (
		<div className="editor-shell side-panel">
			<div className="side-panel-toolbar panel-tabbar">
				<div className="panel-plus-wrap" ref={plusRef}>
					<button
						type="button"
						className={`panel-plus-btn${plusOpen ? ' open' : ''}`}
						title="Open panel"
						onClick={() => setPlusOpen(v => !v)}
					>
						<IconPlus width={14} height={14} />
					</button>
					{plusOpen && (
						<div className="panel-plus-menu fade-in">
							<input
								className="panel-plus-search"
								placeholder="Open any file, URL, …"
								value={plusQuery}
								autoFocus
								onChange={e => setPlusQuery(e.target.value)}
							/>
							{menuItems.map(item => (
								<button
									key={item.id}
									type="button"
									className={`panel-plus-item${mode === item.id ? ' active' : ''}`}
									onClick={() => {
										if (item.id === 'files') onOpenFolder?.();
										go(item.id);
										setPlusOpen(false);
										setPlusQuery('');
									}}
								>
									<item.Icon width={14} height={14} />
									{item.label}
								</button>
							))}
						</div>
					)}
				</div>

				<div className="side-panel-tabs">
					{openTabs.map(id => {
						const def = PANEL_DEFS.find(d => d.id === id)!;
						return (
							<div key={id} className={`panel-tab${mode === id ? ' active' : ''}`}>
								<button type="button" className="panel-tab-main" onClick={() => go(id)}>
									<def.Icon width={12} height={12} />
									{def.label}
								</button>
								<button
									type="button"
									className="panel-tab-x"
									title={`Close ${def.label}`}
									onClick={e => {
										e.stopPropagation();
										closeTab(id);
									}}
								>
									<IconX width={10} height={10} />
								</button>
							</div>
						);
					})}
				</div>

				<div className="side-panel-toolbar-right">
					<button type="button" className="btn-icon" title="Collapse" onClick={() => go('hub')}>
						<IconChevron width={12} height={12} style={{ transform: 'rotate(-90deg)' }} />
					</button>
					<button type="button" className="btn-icon" title="Toggle panel" onClick={onTogglePanel}>
						<IconPanelRight width={14} height={14} />
					</button>
				</div>
			</div>

			{mode === 'hub' && (
				<div className="panel-idle">
					<div className="panel-idle-grid">
						{PANEL_DEFS.map(d => (
							<button key={d.id} type="button" className="panel-idle-card" onClick={() => {
								if (d.id === 'files') onOpenFolder?.();
								go(d.id);
							}}>
								<d.Icon width={22} height={22} />
								<span>{d.label}</span>
							</button>
						))}
					</div>
				</div>
			)}

			{mode === 'changes' && (
				<ChangesPanel
					files={fileChanges}
					workspace={workspace}
					selectedPath={activePath}
					onOpenFile={path => {
						void onOpenFile(path);
						go('files');
					}}
				/>
			)}

			<div
				className="editor-panel-slot terminal-panel-slot"
				style={{ display: mode === 'terminal' ? 'flex' : 'none' }}
			>
				<TerminalPanel workspace={workspace} />
			</div>

			{mode === 'browser' && (
				<div className="browser-panel">
					<p>Browser preview</p>
					<p className="muted-xs">Open a local URL from the agent or paste one below.</p>
					<button type="button" className="btn ghost sm" onClick={onFocusComposer}>
						Ask agent to start a server
					</button>
				</div>
			)}

			{mode === 'files' && (
				<div className="editor-split">
					<aside className="editor-tree-pane">
						<div className="editor-tree-head">
							<span title={workspace}>{shortPath(workspace)}</span>
							<button type="button" className="btn-icon" title="Open folder" onClick={onOpenFolder}>
								<IconFolder width={13} height={13} />
							</button>
						</div>
						{workspace ? (
							<FileTree tree={tree} activePath={activePath} onOpenFile={onOpenFile} />
						) : (
							<div className="tree-empty-box">
								<p className="tree-empty">No folder open</p>
								<button type="button" className="btn primary sm" onClick={onOpenFolder}>
									<IconFolder width={12} height={12} /> Open folder
								</button>
							</div>
						)}
					</aside>
					<div className="editor-main">
						<div className="tab-strip">
							{tabs.map(t => (
								<div key={t.path} className={`editor-tab${t.path === activePath ? ' active' : ''}${t.dirty ? ' dirty' : ''}`}>
									<button type="button" className="tab-name" onClick={() => onSelect(t.path)}>
										{t.path.split(/[/\\]/).pop()}
									</button>
									<button type="button" className="tab-x" onClick={() => onClose(t.path)}>
										<IconX width={12} height={12} />
									</button>
								</div>
							))}
							{!tabs.length && (
								<div className="editor-tab placeholder-tab">
									<span className="tab-name muted">No file open</span>
								</div>
							)}
						</div>
						<div className="monaco-wrap">
							{active ? (
								<Editor
									key={active.path}
									height="100%"
									language={lang(active.path)}
									theme={theme === 'light' ? 'vs' : 'vs-dark'}
									value={active.content}
									onChange={v => onChange(active.path, v ?? '')}
									options={{
										fontSize: 13,
										fontFamily: "'Cascadia Code', Consolas, monospace",
										minimap: { enabled: true },
										scrollBeyondLastLine: false,
										padding: { top: 12 },
										smoothScrolling: true,
										bracketPairColorization: { enabled: true },
										renderLineHighlight: 'line',
										cursorBlinking: 'smooth',
									}}
								/>
							) : (
								<div className="editor-placeholder ide-empty">
									<div className="ide-empty-icon"><IconFile width={28} height={28} /></div>
									<p>VS Code–style editor</p>
									<p className="muted-xs">Open a folder, then pick a file from the tree</p>
									<div className="btn-row" style={{ justifyContent: 'center' }}>
										<button type="button" className="btn primary sm" onClick={onOpenFolder}>
											<IconFolder width={12} height={12} /> Open folder
										</button>
										<button type="button" className="btn ghost sm" onClick={onFocusComposer}>
											Ask Copix
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
