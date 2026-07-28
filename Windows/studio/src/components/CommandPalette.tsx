import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteCommand {
	id: string;
	label: string;
	hint?: string;
	category?: 'agents' | 'files' | 'actions' | 'settings';
	run: () => void;
}

export interface PaletteAgent {
	id: string;
	label: string;
	repo?: string;
	time?: string;
	run: () => void;
}

interface Props {
	open: boolean;
	commands: PaletteCommand[];
	recentAgents?: PaletteAgent[];
	onClose: () => void;
}

const FILTERS = ['all', 'agents', 'files', 'actions', 'settings'] as const;
type FilterId = (typeof FILTERS)[number];

export function CommandPalette({ open, commands, recentAgents = [], onClose }: Props) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const [filter, setFilter] = useState<FilterId>('all');
	const inputRef = useRef<HTMLInputElement>(null);

	const filteredCommands = useMemo(() => {
		const q = query.trim().toLowerCase();
		return commands.filter(c => {
			if (filter !== 'all' && (c.category ?? 'actions') !== filter) return false;
			if (!q) return true;
			return c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q);
		});
	}, [commands, filter, query]);

	const filteredAgents = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (filter !== 'all' && filter !== 'agents') return [];
		return recentAgents.filter(a => !q || `${a.label} ${a.repo ?? ''}`.toLowerCase().includes(q));
	}, [recentAgents, filter, query]);

	useEffect(() => {
		if (open) {
			setQuery('');
			setIndex(0);
			setFilter('all');
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open]);

	useEffect(() => { setIndex(0); }, [query, filter]);

	if (!open) return null;

	const merged = [
		...filteredAgents.map(a => ({ kind: 'agent' as const, id: a.id, label: a.label, hint: a.time, repo: a.repo, run: a.run })),
		...filteredCommands.map(c => ({ kind: 'command' as const, ...c })),
	];

	const runItem = (item: (typeof merged)[number] | undefined) => {
		if (!item) return;
		onClose();
		item.run();
	};

	return (
		<div className="palette-overlay" onClick={onClose}>
			<div className="palette" onClick={e => e.stopPropagation()}>
				<input
					ref={inputRef}
					className="palette-input"
					placeholder="Search agents, files, actions..."
					value={query}
					onChange={e => setQuery(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Escape') onClose();
						else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, merged.length - 1)); }
						else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
						else if (e.key === 'Enter') { e.preventDefault(); runItem(merged[index]); }
					}}
				/>
				<div className="palette-filters">
					{FILTERS.map(id => (
						<button
							key={id}
							type="button"
							className={`palette-filter${filter === id ? ' active' : ''}`}
							onClick={() => setFilter(id)}
						>
							{id[0]!.toUpperCase() + id.slice(1)}
						</button>
					))}
				</div>
				<div className="palette-list">
					{filteredAgents.length > 0 && (
						<div className="palette-section">
							<div className="palette-section-title">Recent Agents</div>
							{filteredAgents.map((a, i) => (
								<button
									key={a.id}
									type="button"
									className={`palette-item${i === index ? ' active' : ''}`}
									onMouseEnter={() => setIndex(i)}
									onClick={() => runItem(merged[i])}
								>
									<span className="palette-item-main">
										<span>{a.label}</span>
									</span>
									<span className="palette-item-meta">
										{a.repo && <span className="palette-item-repo">{a.repo}</span>}
										{a.time && <span className="palette-hint">{a.time}</span>}
									</span>
								</button>
							))}
						</div>
					)}
					{filteredCommands.length > 0 && (
						<div className="palette-section">
							<div className="palette-section-title">
								{filter === 'all' ? 'Actions' : filter[0]!.toUpperCase() + filter.slice(1)}
							</div>
							{filteredCommands.map((c, i) => {
								const itemIndex = filteredAgents.length + i;
								return (
						<button
							key={c.id}
							type="button"
							className={`palette-item${itemIndex === index ? ' active' : ''}`}
							onMouseEnter={() => setIndex(itemIndex)}
							onClick={() => runItem(merged[itemIndex])}
						>
							<span>{c.label}</span>
							{c.hint && <span className="palette-hint">{c.hint}</span>}
						</button>
								);
							})}
						</div>
					)}
					{merged.length === 0 && <p className="palette-empty">No matching results</p>}
				</div>
				<div className="palette-footer">↑↓ Select &nbsp;&nbsp; ↵ Open &nbsp;&nbsp; ⌘[ or ⌘] Change Filter</div>
			</div>
		</div>
	);
}
