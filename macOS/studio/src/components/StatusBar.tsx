import type { ThemePreference } from '../types';
import { IconFolder, IconMonitor, IconMoon, IconSun } from './Icons';

interface Props {
	workspace?: string;
	model: string;
	online: boolean;
	theme: ThemePreference;
	onCycleTheme: () => void;
	onOpenSettings: () => void;
}

const THEME_LABEL: Record<ThemePreference, string> = {
	system: 'System theme',
	dark: 'Dark theme',
	light: 'Light theme',
};

export function StatusBar({ workspace, model, online, theme, onCycleTheme, onOpenSettings }: Props) {
	const ThemeIcon = theme === 'system' ? IconMonitor : theme === 'light' ? IconSun : IconMoon;
	return (
		<footer className="statusbar">
			<div className="statusbar-left">
				{workspace && (
					<span className="status-item" title={workspace}>
						<IconFolder width={12} height={12} />
						{shortPath(workspace)}
					</span>
				)}
			</div>
			<div className="statusbar-right">
				<button type="button" className="status-item status-btn" title="Model settings" onClick={onOpenSettings}>
					<span className={`status-dot ${online ? 'on' : 'off'}`} />
					{model}
					<span className="status-sub">ollama</span>
				</button>
				<button type="button" className="status-item status-btn" title={`${THEME_LABEL[theme]} — click to switch`} onClick={onCycleTheme}>
					<ThemeIcon width={13} height={13} />
				</button>
			</div>
		</footer>
	);
}

function shortPath(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
