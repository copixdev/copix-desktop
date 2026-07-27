import { useEffect, useRef, useState } from 'react';
import { copix } from '../api';

interface Props {
	workspace?: string;
}

interface Line {
	id: number;
	kind: 'in' | 'out' | 'meta';
	text: string;
}

let lineId = 0;

function shortCwd(p?: string): string {
	if (!p) return '~';
	const norm = p.replace(/\//g, '\\');
	return norm.length > 48 ? `…${norm.slice(-46)}` : norm;
}

function newStreamId(): string {
	return `term-${Date.now()}-${++lineId}`;
}

export function TerminalPanel({ workspace }: Props) {
	const [lines, setLines] = useState<Line[]>(() => [
		{ id: ++lineId, kind: 'meta', text: `PowerShell — ${shortCwd(workspace)}` },
		{ id: ++lineId, kind: 'meta', text: 'Type a command and press Enter. Ctrl+L clears.' },
	]);
	const [input, setInput] = useState('');
	const [busy, setBusy] = useState(false);
	const endRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: 'end' });
	}, [lines, busy]);

	useEffect(() => {
		setLines(prev => [
			...prev,
			{ id: ++lineId, kind: 'meta', text: `cwd → ${shortCwd(workspace)}` },
		]);
	}, [workspace]);

	const run = async (cmd: string) => {
		const trimmed = cmd.trim();
		if (!trimmed || busy) return;
		setInput('');
		setLines(prev => [
			...prev,
			{ id: ++lineId, kind: 'in', text: `PS ${shortCwd(workspace)}> ${trimmed}` },
		]);

		if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'cls') {
			setLines([{ id: ++lineId, kind: 'meta', text: `PowerShell — ${shortCwd(workspace)}` }]);
			return;
		}

		const outLineId = ++lineId;
		const streamId = newStreamId();
		setLines(prev => [...prev, { id: outLineId, kind: 'out', text: '' }]);
		setBusy(true);

		const stop = copix.onTerminalOutput(streamId, chunk => {
			setLines(prev => prev.map(l => l.id === outLineId ? { ...l, text: l.text + chunk } : l));
		});

		try {
			const out = await copix.runTerminal(trimmed, workspace, workspace, false, streamId);
			setLines(prev => prev.map(l => {
				if (l.id !== outLineId) return l;
				return { ...l, text: l.text.trim() ? l.text : (out || '(no output)') };
			}));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setLines(prev => prev.map(l => l.id === outLineId ? { ...l, text: l.text || msg } : l));
		} finally {
			stop();
			setBusy(false);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	};

	return (
		<div className="terminal-panel" onClick={() => inputRef.current?.focus()}>
			<div className="terminal-scroll">
				{lines.map(l => (
					<pre key={l.id} className={`terminal-line ${l.kind}`}>{l.text || (l.kind === 'out' && busy ? ' ' : l.text)}</pre>
				))}
				<div ref={endRef} />
			</div>
			<div className="terminal-prompt-row">
				<span className="terminal-ps">PS {shortCwd(workspace)}&gt;</span>
				<input
					ref={inputRef}
					className="terminal-input"
					value={input}
					disabled={busy}
					spellCheck={false}
					autoComplete="off"
					placeholder={workspace ? 'command' : 'Open a workspace first'}
					onChange={e => setInput(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void run(input);
						}
						if (e.key === 'l' && e.ctrlKey) {
							e.preventDefault();
							setLines([{ id: ++lineId, kind: 'meta', text: `PowerShell — ${shortCwd(workspace)}` }]);
						}
					}}
				/>
			</div>
		</div>
	);
}
