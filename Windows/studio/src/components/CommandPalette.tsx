import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteCommand {
	id: string;
	label: string;
	hint?: string;
	run: () => void;
}

interface Props {
	open: boolean;
	commands: PaletteCommand[];
	onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: Props) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return commands;
		return commands.filter(c => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
	}, [commands, query]);

	useEffect(() => {
		if (open) {
			setQuery('');
			setIndex(0);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open]);

	useEffect(() => { setIndex(0); }, [query]);

	if (!open) return null;

	const runCommand = (cmd: PaletteCommand | undefined) => {
		if (!cmd) return;
		onClose();
		cmd.run();
	};

	return (
		<div className="palette-overlay" onClick={onClose}>
			<div className="palette" onClick={e => e.stopPropagation()}>
				<input
					ref={inputRef}
					className="palette-input"
					placeholder="Type a command…"
					value={query}
					onChange={e => setQuery(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Escape') onClose();
						else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
						else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
						else if (e.key === 'Enter') { e.preventDefault(); runCommand(filtered[index]); }
					}}
				/>
				<div className="palette-list">
					{filtered.length === 0 && <p className="palette-empty">No matching commands</p>}
					{filtered.map((c, i) => (
						<button
							key={c.id}
							type="button"
							className={`palette-item${i === index ? ' active' : ''}`}
							onMouseEnter={() => setIndex(i)}
							onClick={() => runCommand(c)}
						>
							<span>{c.label}</span>
							{c.hint && <span className="palette-hint">{c.hint}</span>}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
