import { IconChat, IconCode, IconCommand, IconLogo, IconPlus, IconSettings } from './Icons';

interface Props {
	editorVisible: boolean;
	serverOnline: boolean;
	onNewChat: () => void;
	onToggleEditor: () => void;
	onOpenPalette: () => void;
	onOpenSettings: () => void;
	onFocusComposer: () => void;
}

export function ActivityRail({
	editorVisible, serverOnline, onNewChat, onToggleEditor, onOpenPalette, onOpenSettings, onFocusComposer,
}: Props) {
	return (
		<nav className="activity-rail">
			<div className="rail-logo" title={serverOnline ? 'Copix — model ready' : 'Copix — model offline'}>
				<IconLogo width={22} height={22} />
				<span className={`rail-status-dot ${serverOnline ? 'on' : ''}`} />
			</div>

			<button type="button" className="rail-btn" title="Focus agent (Ctrl+L)" onClick={onFocusComposer}>
				<IconChat width={18} height={18} />
			</button>
			<button type="button" className="rail-btn" title="New agent" onClick={onNewChat}>
				<IconPlus width={18} height={18} />
			</button>
			<button
				type="button"
				className={`rail-btn${editorVisible ? ' active' : ''}`}
				title={editorVisible ? 'Hide editor panel' : 'Show editor panel'}
				onClick={onToggleEditor}
			>
				<IconCode width={18} height={18} />
			</button>
			<button type="button" className="rail-btn" title="Command palette (Ctrl+K)" onClick={onOpenPalette}>
				<IconCommand width={18} height={18} />
			</button>

			<div className="rail-spacer" />

			<button type="button" className="rail-btn" title="Settings" onClick={onOpenSettings}>
				<IconSettings width={18} height={18} />
			</button>
		</nav>
	);
}
