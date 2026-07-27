import { useEffect, useMemo, useRef } from 'react';
import type { AgentMode } from '../models/agentModes';

export interface SlashCommand {
	id: string;
	label: string;
	hint: string;
	insert: string;
}

export interface AtItem {
	id: string;
	label: string;
	path: string;
	kind: 'file' | 'folder';
}

interface Props {
	input: string;
	caret: number;
	tree: string[];
	agentMode: AgentMode;
	activeIndex?: number;
	onHoverIndex?: (i: number) => void;
	onSelect: (nextInput: string, nextCaret: number) => void;
	onModeChange?: (mode: AgentMode) => void;
	onClose: () => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{ id: 'plan', label: '/plan', hint: 'Architecture & steps only', insert: '/plan ' },
	{ id: 'code', label: '/code', hint: 'Implement features', insert: '/code ' },
	{ id: 'debug', label: '/debug', hint: 'Investigate bugs', insert: '/debug ' },
	{ id: 'terminal', label: '/terminal', hint: 'Shell-focused mode', insert: '/terminal ' },
	{ id: 'search', label: '/search', hint: 'Search workspace', insert: '/search ' },
	{ id: 'read', label: '/read', hint: 'Read a file', insert: '/read ' },
	{ id: 'multitask', label: '/multitask', hint: 'Run parallel tasks', insert: '/multitask Run these in parallel: ' },
	{ id: 'clear', label: '/clear', hint: 'Clear composer', insert: '' },
];

const MODE_MAP: Record<string, AgentMode> = {
	plan: 'plan',
	code: 'code',
	debug: 'debug',
	terminal: 'terminal',
};

function detectTrigger(input: string, caret: number): { kind: '/' | '@'; query: string; start: number } | null {
	const before = input.slice(0, caret);
	const atMatch = before.match(/(^|[\s(])@([^\s@]*)$/);
	if (atMatch) {
		return { kind: '@', query: atMatch[2] ?? '', start: caret - (atMatch[2]?.length ?? 0) - 1 };
	}
	const slashMatch = before.match(/(^|\s)\/([^\s/]*)$/);
	if (slashMatch) {
		return { kind: '/', query: slashMatch[2] ?? '', start: caret - (slashMatch[2]?.length ?? 0) - 1 };
	}
	return null;
}

export function useComposerCommands(input: string, caret: number, tree: string[]) {
	return useMemo(() => {
		const trigger = detectTrigger(input, caret);
		if (!trigger) return null;

		if (trigger.kind === '/') {
			const q = trigger.query.toLowerCase();
			const items = SLASH_COMMANDS.filter(c =>
				c.label.slice(1).startsWith(q) || c.id.startsWith(q),
			);
			return { kind: '/' as const, trigger, items };
		}

		const q = trigger.query.toLowerCase();
		const items: AtItem[] = tree
			.filter(p => !q || p.toLowerCase().includes(q))
			.slice(0, 24)
			.map(p => ({
				id: p,
				label: p.endsWith('/') ? p.slice(0, -1).split('/').pop() ?? p : p.split('/').pop() ?? p,
				path: p,
				kind: p.endsWith('/') ? 'folder' as const : 'file' as const,
			}));
		return { kind: '@' as const, trigger, items };
	}, [input, caret, tree]);
}

export function pickComposerItem(
	menu: NonNullable<ReturnType<typeof useComposerCommands>>,
	index: number,
	input: string,
	caret: number,
	handlers: {
		onSelect: (next: string, nextCaret: number) => void;
		onModeChange?: (mode: AgentMode) => void;
		onClose: () => void;
	},
): void {
	const { trigger, kind, items } = menu;
	const item = items[index];
	if (!item) return;

	if (kind === '/') {
		const cmd = item as SlashCommand;
		const { start } = trigger;
		const before = input.slice(0, start);
		const after = input.slice(caret);
		if (cmd.id === 'clear') {
			handlers.onSelect('', 0);
			handlers.onClose();
			return;
		}
		const mode = MODE_MAP[cmd.id];
		if (mode) handlers.onModeChange?.(mode);
		const next = before + cmd.insert + after;
		handlers.onSelect(next, (before + cmd.insert).length);
		handlers.onClose();
		return;
	}

	const at = item as AtItem;
	const { start } = trigger;
	const before = input.slice(0, start);
	const after = input.slice(caret);
	const token = `@${at.path} `;
	const next = before + token + after;
	handlers.onSelect(next, (before + token).length);
	handlers.onClose();
}

export function ComposerCommandMenu({
	input, caret, tree, agentMode, activeIndex = 0, onHoverIndex, onSelect, onModeChange, onClose,
}: Props) {
	const menu = useComposerCommands(input, caret, tree);
	const ref = useRef<HTMLDivElement>(null);

	const items = menu?.items ?? [];
	const visible = Boolean(menu && items.length);
	const index = activeIndex;

	useEffect(() => {
		if (!visible) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); onClose(); }
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [visible, onClose]);

	if (!visible || !menu) return null;

	const pick = (i: number) => {
		pickComposerItem(menu, i, input, caret, { onSelect, onModeChange, onClose });
	};

	return (
		<div className="composer-command-menu" ref={ref} role="listbox">
			<div className="composer-command-head">
				{menu.kind === '/' ? 'Commands' : 'Files & folders'}
			</div>
			{items.map((item, i) => {
				const isSlash = menu.kind === '/';
				const isMode = isSlash && MODE_MAP[(item as SlashCommand).id] === agentMode;
				const label = isSlash
					? (item as SlashCommand).label
					: `${(item as AtItem).kind === 'folder' ? 'dir' : 'file'} · ${(item as AtItem).label}`;
				const hint = isSlash ? (item as SlashCommand).hint : (item as AtItem).path;
				return (
					<button
						key={item.id}
						type="button"
						role="option"
						aria-selected={i === index}
						className={`composer-command-item${i === index ? ' active' : ''}${isMode ? ' current' : ''}`}
						onMouseEnter={() => onHoverIndex?.(i)}
						onClick={() => pick(i)}
					>
						<span className="cmd-label">
							{label}
							{isMode ? <span className="cmd-current"> · current</span> : null}
						</span>
						<span className="cmd-hint">{hint}</span>
					</button>
				);
			})}
		</div>
	);
}

/** Keyboard handler for command menu — call from textarea onKeyDown before send. */
export function handleCommandMenuKey(
	e: React.KeyboardEvent,
	visible: boolean,
	index: number,
	itemCount: number,
	onIndex: (i: number) => void,
	onPick: () => void,
	onClose: () => void,
): boolean {
	if (!visible || !itemCount) return false;
	if (e.key === 'ArrowDown') { e.preventDefault(); onIndex(Math.min(index + 1, itemCount - 1)); return true; }
	if (e.key === 'ArrowUp') { e.preventDefault(); onIndex(Math.max(index - 1, 0)); return true; }
	if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onPick(); return true; }
	if (e.key === 'Escape') { e.preventDefault(); onClose(); return true; }
	return false;
}
