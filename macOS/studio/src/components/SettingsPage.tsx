import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { checkModelHealth, settingsToConfig, DEFAULT_MODEL_ID } from '../models/config';
import { AppSettings, ThemePreference } from '../types';
import { copix } from '../api';
import {
	IconChevron, IconSettings, IconSun, IconMoon, IconMonitor, IconBrain,
	IconCommand, IconFolder, IconBranch,
} from './Icons';

interface Props {
	open: boolean;
	settings: AppSettings;
	onClose: () => void;
	onChange: (s: AppSettings) => void;
}

type Nav = 'general' | 'appearance' | 'agents' | 'models' | 'workspace';

const NAV: { id: Nav; label: string; Icon: typeof IconSettings; group?: 'main' | 'tools' }[] = [
	{ id: 'general', label: 'General', Icon: IconSettings, group: 'main' },
	{ id: 'appearance', label: 'Appearance', Icon: IconSun, group: 'main' },
	{ id: 'agents', label: 'Agents', Icon: IconBranch, group: 'tools' },
	{ id: 'models', label: 'Models', Icon: IconBrain, group: 'tools' },
	{ id: 'workspace', label: 'Workspace', Icon: IconFolder, group: 'tools' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			className={`settings-toggle${on ? ' on' : ''}`}
			role="switch"
			aria-checked={on}
			aria-label={label}
			onClick={() => onChange(!on)}
		>
			<span className="settings-toggle-knob" />
		</button>
	);
}

function SettingRow({
	title, desc, children,
}: { title: string; desc?: string; children?: ReactNode }) {
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<strong>{title}</strong>
				{desc && <p>{desc}</p>}
			</div>
			{children}
		</div>
	);
}

export function SettingsPage({
	open, settings, onClose, onChange,
}: Props) {
	const [nav, setNav] = useState<Nav>('general');
	const [query, setQuery] = useState('');
	const [health, setHealth] = useState('');
	const [projectsRoot, setProjectsRoot] = useState('');
	const [panelKey, setPanelKey] = useState(0);
	const [pulling, setPulling] = useState(false);

	useEffect(() => {
		if (!open) return;
		void copix.getProjectsRoot().then(setProjectsRoot).catch(() => setProjectsRoot(''));
	}, [open]);

	const filteredNav = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return NAV;
		return NAV.filter(n => n.label.toLowerCase().includes(q));
	}, [query]);

	if (!open) return null;

	const go = (id: Nav) => {
		setNav(id);
		setPanelKey(k => k + 1);
	};

	const setTheme = (theme: ThemePreference) => onChange({ ...settings, theme });

	const renderNavGroup = (group: 'main' | 'tools') => {
		const items = filteredNav.filter(n => (n.group ?? 'main') === group);
		if (!items.length) return null;
		return (
			<div className="settings-nav-group">
				{items.map(n => (
					<button
						key={n.id}
						type="button"
						className={`settings-nav-item${nav === n.id ? ' active' : ''}`}
						onClick={() => go(n.id)}
					>
						<n.Icon width={14} height={14} />
						{n.label}
					</button>
				))}
			</div>
		);
	};

	return (
		<div className="settings-full">
			<aside className="settings-full-nav">
				<button type="button" className="settings-back" onClick={onClose}>
					<IconChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} />
					Back
				</button>
				<div className="settings-search-wrap">
					<IconCommand width={13} height={13} />
					<input
						className="settings-search"
						placeholder="Search settings"
						value={query}
						onChange={e => setQuery(e.target.value)}
					/>
				</div>
				<nav className="settings-nav-list">
					{renderNavGroup('main')}
					{renderNavGroup('tools')}
				</nav>
				<div className="settings-nav-foot">
					<div className="settings-user-chip">
						<span className="settings-avatar">C</span>
						<div className="sidebar-profile-text">
							<div className="settings-user-name fade-edge">Copix</div>
							<div className="settings-user-plan">Free</div>
						</div>
					</div>
				</div>
			</aside>

			<main className="settings-full-main" key={panelKey}>
				<div className="settings-full-panel fade-in">
					<h1>{NAV.find(n => n.id === nav)?.label}</h1>

					{nav === 'general' && (
						<section className="settings-block">
							<SettingRow title="Settings file" desc="Saved at ~/Copix/settings.json on this machine.">
								<code className="inline-code">~/Copix/settings.json</code>
							</SettingRow>
							<SettingRow title="Model backend" desc="Copix uses Ollama on this machine. Install from ollama.com and pull the default model.">
								<code className="inline-code">ollama pull {DEFAULT_MODEL_ID}</code>
							</SettingRow>
						</section>
					)}

					{nav === 'appearance' && (
						<section className="settings-block">
							<strong className="settings-block-title">Theme</strong>
							<div className="theme-row">
								<button type="button" className={`theme-chip${settings.theme === 'system' ? ' active' : ''}`} onClick={() => setTheme('system')}>
									<IconMonitor width={14} height={14} /> System
								</button>
								<button type="button" className={`theme-chip${settings.theme === 'dark' ? ' active' : ''}`} onClick={() => setTheme('dark')}>
									<IconMoon width={14} height={14} /> Dark
								</button>
								<button type="button" className={`theme-chip${settings.theme === 'light' ? ' active' : ''}`} onClick={() => setTheme('light')}>
									<IconSun width={14} height={14} /> Light
								</button>
							</div>
						</section>
					)}

					{nav === 'agents' && (
						<section className="settings-block">
							<SettingRow title="Default agent mode" desc="How new agents behave when you start a chat.">
								<select
									className="field-input settings-inline-select"
									value={settings.agentMode}
									onChange={e => onChange({
										...settings,
										agentMode: e.target.value as AppSettings['agentMode'],
									})}
								>
									<option value="plan">Plan</option>
									<option value="code">Code</option>
									<option value="debug">Debug</option>
									<option value="terminal">Terminal</option>
								</select>
							</SettingRow>
						</section>
					)}

					{nav === 'models' && (
						<section className="settings-block">
							<p className="settings-hint">Copix runs models through Ollama on this machine.</p>
							<label className="field-label">Ollama model</label>
							<input
								className="field-input"
								value={settings.model.modelId}
								onChange={e => onChange({
									...settings,
									model: { ...settings.model, modelId: e.target.value },
								})}
								placeholder={DEFAULT_MODEL_ID}
							/>
							<SettingRow
								title="Low VRAM mode"
								desc="Smaller context for low-memory machines."
							>
								<Toggle
									on={Boolean(settings.model.lowVram)}
									onChange={v => onChange({
										...settings,
										model: { ...settings.model, lowVram: v },
									})}
									label="Low VRAM mode"
								/>
							</SettingRow>
							<div className="btn-row">
								<button
									type="button"
									className="btn sm"
									onClick={async () => {
										setHealth('Checking…');
										const r = await checkModelHealth(settingsToConfig(settings.model));
										setHealth(r.ok ? `OK — ${r.message}` : `Failed — ${r.message}`);
									}}
								>
									Test connection
								</button>
								<button
									type="button"
									className="btn sm"
									disabled={pulling}
									onClick={async () => {
										setPulling(true);
										setHealth('Pulling model…');
										const r = await copix.pullOllamaModel(settings.model.modelId || DEFAULT_MODEL_ID);
										setHealth(r.ok ? r.message : `Failed — ${r.message}`);
										setPulling(false);
									}}
								>
									{pulling ? 'Pulling…' : 'Pull model'}
								</button>
							</div>
							{health && <p className="settings-hint">{health}</p>}
						</section>
					)}

					{nav === 'workspace' && (
						<section className="settings-block">
							<label className="field-label">Home directory</label>
							<p className="settings-hint">Where new projects are created.</p>
							<div className="field-row">
								<input
									className="field-input"
									value={settings.workspace.homeDirectory}
									onChange={e => onChange({
										...settings,
										workspace: { homeDirectory: e.target.value },
									})}
									placeholder="/Users/baejuhan"
								/>
								<button
									type="button"
									className="btn sm"
									onClick={async () => {
										const path = await copix.browseHomeDirectory();
										if (path) {
											onChange({ ...settings, workspace: { homeDirectory: path } });
										}
									}}
								>
									Browse
								</button>
							</div>
							{projectsRoot && <p className="settings-hint">Projects root: {projectsRoot}</p>}
							<label className="field-label">Sidebar width</label>
							<input
								className="field-input"
								type="number"
								value={settings.layout.sidebarWidth}
								onChange={e => onChange({
									...settings,
									layout: { ...settings.layout, sidebarWidth: Number(e.target.value) || 220 },
								})}
							/>
						</section>
					)}
				</div>
			</main>
		</div>
	);
}
