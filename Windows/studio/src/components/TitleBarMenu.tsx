import { useEffect, useRef, useState } from 'react';

export interface TitleBarMenuActions {
	onNewAgent?: () => void;
	onOpenFolder?: () => void;
	onCloneRepo?: () => void;
	onToggleEditor?: () => void;
	onOpenSettings?: () => void;
	onOpenPalette?: () => void;
	onOpenSetup?: () => void;
}

interface Props extends TitleBarMenuActions {}

type MenuId = 'file' | 'edit' | 'view' | 'help' | null;

const MENUS: { id: MenuId; label: string }[] = [
	{ id: 'file', label: 'File' },
	{ id: 'edit', label: 'Edit' },
	{ id: 'view', label: 'View' },
	{ id: 'help', label: 'Help' },
];

export function TitleBarMenu(props: Props) {
	const [open, setOpen] = useState<MenuId>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const close = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
		};
		window.addEventListener('mousedown', close);
		return () => window.removeEventListener('mousedown', close);
	}, []);

	const item = (label: string, action?: () => void, disabled = false) => (
		<button
			key={label}
			type="button"
			className="titlebar-menu-item"
			disabled={disabled || !action}
			onClick={() => { action?.(); setOpen(null); }}
		>
			{label}
		</button>
	);

	return (
		<div className="titlebar-menu" ref={rootRef}>
			{MENUS.map(m => (
				<div key={m.label} className="titlebar-menu-wrap">
					<button
						type="button"
						className={`titlebar-menu-btn${open === m.id ? ' open' : ''}`}
						onClick={() => setOpen(v => v === m.id ? null : m.id)}
					>
						{m.label}
					</button>
					{open === m.id && (
						<div className="titlebar-menu-dropdown">
							{m.id === 'file' && (
								<>
									{item('New Agent', props.onNewAgent)}
									{item('Open Folder…', props.onOpenFolder)}
									{item('Clone Repository…', props.onCloneRepo)}
									<div className="titlebar-menu-sep" />
									{item('Exit', () => window.close())}
								</>
							)}
							{m.id === 'edit' && (
								<>
									{item('Command Palette…', props.onOpenPalette)}
									{item('Settings…', props.onOpenSettings)}
								</>
							)}
							{m.id === 'view' && (
								<>
									{item('Toggle Editor Panel', props.onToggleEditor)}
									{item('Model Setup…', props.onOpenSetup)}
								</>
							)}
							{m.id === 'help' && (
								<>
									{item('Copix on GitHub', () => window.copix?.openExternal('https://github.com/EJH-BAE/Copix'))}
									{item('About Copix', props.onOpenSettings)}
								</>
							)}
						</div>
					)}
				</div>
			))}
		</div>
	);
}
