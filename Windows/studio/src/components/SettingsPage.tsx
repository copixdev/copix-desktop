import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { checkModelHealth, settingsToConfig, CLOUD_PRESETS } from '../models/config';
import { DEFAULT_RULES } from '../models/systemPrompt';
import {
	getRemoteSession,
	resolveAuthConfig,
	signOut,
} from '../services/auth';
import { pushProfileToSupabase } from '../services/supabaseProfile';
import { PLANS } from '../services/subscription';
import { AppSettings, DEFAULT_CLOUD_ENDPOINT, ThemePreference } from '../types';
import { copix } from '../api';
import type { PaidPlan } from './PaymentPage';
import {
	IconChevron, IconSettings, IconSun, IconMoon, IconMonitor, IconBrain,
	IconCommand, IconSparkle, IconCloud, IconFolder, IconChat, IconBranch,
} from './Icons';

interface Props {
	open: boolean;
	settings: AppSettings;
	onClose: () => void;
	onChange: (s: AppSettings) => void;
	onOpenSetup: () => void;
	onSignedOut?: () => void;
	onUpgradePlan?: (plan: PaidPlan) => void;
}

type Nav =
	| 'general'
	| 'profile'
	| 'appearance'
	| 'plans'
	| 'agents'
	| 'models'
	| 'rules'
	| 'workspace'
	| 'network'
	| 'beta';

const NAV: { id: Nav; label: string; Icon: typeof IconSettings; group?: 'main' | 'tools' | 'more' }[] = [
	{ id: 'general', label: 'General', Icon: IconSettings, group: 'main' },
	{ id: 'profile', label: 'Profile', Icon: IconChat, group: 'main' },
	{ id: 'appearance', label: 'Appearance', Icon: IconSun, group: 'main' },
	{ id: 'plans', label: 'Plan & Usage', Icon: IconSparkle, group: 'main' },
	{ id: 'agents', label: 'Agents', Icon: IconBranch, group: 'tools' },
	{ id: 'models', label: 'Models', Icon: IconBrain, group: 'tools' },
	{ id: 'rules', label: 'Rules', Icon: IconCommand, group: 'tools' },
	{ id: 'workspace', label: 'Workspace', Icon: IconFolder, group: 'tools' },
	{ id: 'network', label: 'Network', Icon: IconCloud, group: 'more' },
	{ id: 'beta', label: 'Beta', Icon: IconSparkle, group: 'more' },
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
	open, settings, onClose, onChange, onOpenSetup, onSignedOut, onUpgradePlan,
}: Props) {
	const [nav, setNav] = useState<Nav>('general');
	const [query, setQuery] = useState('');
	const [health, setHealth] = useState('');
	const [projectsRoot, setProjectsRoot] = useState('');
	const [signedInId, setSignedInId] = useState<string | null>(null);
	const [panelKey, setPanelKey] = useState(0);
	const [systemNotifs, setSystemNotifs] = useState(true);
	const [trayIcon, setTrayIcon] = useState(true);
	const [warnNotifs, setWarnNotifs] = useState(false);
	const [completionSound, setCompletionSound] = useState(false);

	const active = settings.accounts.find(a => a.id === settings.activeAccountId) ?? settings.accounts[0];
	const auth = resolveAuthConfig(settings.auth);
	const initial = (active?.displayName || active?.email || 'U').slice(0, 1).toUpperCase();

	const filteredNav = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return NAV;
		return NAV.filter(n => n.label.toLowerCase().includes(q));
	}, [query]);

	useEffect(() => {
		if (!open) return;
		void getRemoteSession(auth).then(s => setSignedInId(s?.userId ?? null));
		void copix.getProjectsRoot().then(setProjectsRoot);
	}, [open, auth.supabaseUrl]);

	if (!open) return null;

	const go = (id: Nav) => {
		setNav(id);
		setPanelKey(k => k + 1);
		if (id === 'models') {
			void checkModelHealth(settingsToConfig(settings.model)).then(r => {
				setHealth(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
			});
		}
	};

	const setTheme = (theme: ThemePreference) => onChange({ ...settings, theme });

	const renderNavGroup = (group: 'main' | 'tools' | 'more') => {
		const items = filteredNav.filter(n => n.group === group);
		if (!items.length) return null;
		return (
			<div className="settings-nav-group">
				{items.map(item => (
					<button
						key={item.id}
						type="button"
						className={`settings-nav-item${nav === item.id ? ' active' : ''}`}
						onClick={() => go(item.id)}
					>
						<item.Icon width={14} height={14} />
						{item.label}
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
					{renderNavGroup('more')}
				</nav>
				<div className="settings-nav-foot">
					<div className="settings-user-chip">
						<span className="settings-avatar">{initial}</span>
						<div className="sidebar-profile-text">
							<div className="settings-user-name fade-edge">{active?.displayName || 'User'}</div>
							<div className="settings-user-plan">
								{PLANS.find(p => p.id === settings.subscription.plan)?.label ?? 'Free'} Plan
							</div>
						</div>
					</div>
					<button type="button" className="btn-icon" title="Settings" onClick={() => go('general')}>
						<IconSettings width={15} height={15} />
					</button>
				</div>
			</aside>

			<main className="settings-full-main" key={panelKey}>
				<div className="settings-full-panel fade-in">
					<h1>{NAV.find(n => n.id === nav)?.label}</h1>

					{nav === 'general' && (
						<>
							<section className="settings-block">
								<SettingRow title="Copix account" desc="Manage your account and billing.">
									<button type="button" className="btn sm" onClick={() => go('profile')}>Open ↗</button>
								</SettingRow>
							</section>
							<section className="settings-block">
								<SettingRow title="Model setup" desc="Ollama gpt-oss:20b + optional Copix Core (gpt-oss LoRA) training.">
									<button type="button" className="btn sm" onClick={onOpenSetup}>Open</button>
								</SettingRow>
							</section>
							<section className="settings-block">
								<strong className="settings-block-title">Notifications</strong>
								<SettingRow title="System notifications" desc="Show desktop alerts for agent events.">
									<Toggle on={systemNotifs} onChange={setSystemNotifs} label="System notifications" />
								</SettingRow>
								<SettingRow title="System tray icon" desc="Keep Copix visible in the tray.">
									<Toggle on={trayIcon} onChange={setTrayIcon} label="System tray icon" />
								</SettingRow>
								<SettingRow title="Warning notifications" desc="Alert when tools fail or need attention.">
									<Toggle on={warnNotifs} onChange={setWarnNotifs} label="Warning notifications" />
								</SettingRow>
								<SettingRow title="Completion sound" desc="Play a sound when the agent finishes.">
									<Toggle on={completionSound} onChange={setCompletionSound} label="Completion sound" />
								</SettingRow>
							</section>
						</>
					)}

					{nav === 'profile' && (
						<section className="settings-block">
							<label className="field-label">Display name</label>
							<input
								className="field-input"
								value={active?.displayName ?? ''}
								onChange={e => onChange({
									...settings,
									accounts: settings.accounts.map(a =>
										a.id === active?.id ? { ...a, displayName: e.target.value } : a),
								})}
							/>
							<label className="field-label">Email</label>
							<input className="field-input" value={active?.email ?? ''} readOnly />
							{signedInId && (
								<p className="settings-hint">User ID <code className="inline-code">{signedInId}</code></p>
							)}
							<div className="btn-row">
								<button
									type="button"
									className="btn ghost sm"
									onClick={async () => {
										await signOut(auth);
										onSignedOut?.();
									}}
								>
									Sign out
								</button>
							</div>
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

					{nav === 'plans' && (
						<>
							<p className="settings-hint">Free is available now. Pro and Max open card payment (Toss settlement).</p>
							<div className="plan-grid">
								{PLANS.map(plan => {
									const current = settings.subscription.plan === plan.id;
									return (
										<button
											key={plan.id}
											type="button"
											className={`plan-card${current ? ' active' : ''}`}
											onClick={() => {
												if (plan.id === 'free') {
													const next = {
														...settings,
														subscription: { plan: 'free' as const, status: 'inactive' as const },
													};
													onChange(next);
													void pushProfileToSupabase(next);
													return;
												}
												onUpgradePlan?.(plan.id);
											}}
										>
											<div className="plan-card-head">
												<strong>{plan.label}</strong>
												<span>{plan.price}</span>
											</div>
											<ul className="plan-features">
												{plan.features.map(f => <li key={f}>{f}</li>)}
											</ul>
											{plan.id !== 'free' && (
												<span className="plan-cta">{current ? 'Current paid plan' : 'Register & pay'}</span>
											)}
										</button>
									);
								})}
							</div>
						</>
					)}

					{nav === 'agents' && (
						<section className="settings-block">
							<SettingRow
								title="Default agent mode"
								desc="How new agents behave when you start a chat."
							>
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
							<SettingRow title="Show file edits in chat" desc="Display Editing filename… for every tool write.">
								<Toggle on={true} onChange={() => {}} label="Show file edits" />
							</SettingRow>
						</section>
					)}

					{nav === 'models' && (
						<section className="settings-block">
							<label className="field-label">Provider</label>
							<select
								className="field-input"
								value={settings.model.provider}
								onChange={e => onChange({
									...settings,
									model: { ...settings.model, provider: e.target.value as 'local' | 'cloud' },
								})}
							>
								<option value="local">Local (Ollama)</option>
								<option value="cloud">Cloud</option>
							</select>
							{settings.model.provider === 'local' && (
								<>
									<label className="field-label">Base model (Ollama)</label>
									<input
										className="field-input"
										value={settings.model.modelId}
										onChange={e => onChange({
											...settings,
											model: { ...settings.model, modelId: e.target.value },
										})}
										placeholder="gpt-oss:20b"
									/>
									<label className="field-label">Copix Core (tuned)</label>
									<input
										className="field-input"
										value={settings.model.tunedModelId}
										onChange={e => onChange({
											...settings,
											model: { ...settings.model, tunedModelId: e.target.value },
										})}
										placeholder="copix-core"
									/>
									<SettingRow
										title="Prefer Copix Core"
										desc="Use the LoRA-tuned gpt-oss agent when it exists in Ollama (coding, explanation, search)."
									>
										<Toggle
											on={Boolean(settings.model.preferTuned)}
											onChange={v => onChange({
												...settings,
												model: { ...settings.model, preferTuned: v },
											})}
											label="Prefer Copix Core"
										/>
									</SettingRow>
									<SettingRow
										title="Low VRAM mode"
										desc="Smaller context (2k) for 8GB GPUs. Still uses the GPU — turn on only if local models crash."
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
									<p className="settings-hint">
										Train Copix Core: build dataset → LoRA on <code>openai/gpt-oss-20b</code> → export as <code>copix-core</code>. Needs ~40GB peak virtual memory on Windows.
									</p>
								</>
							)}
							{settings.model.provider === 'cloud' && (
								<>
									<label className="field-label">Endpoint</label>
									<input
										className="field-input"
										value={settings.model.endpoint || DEFAULT_CLOUD_ENDPOINT}
										onChange={e => onChange({
											...settings,
											model: { ...settings.model, endpoint: e.target.value },
										})}
									/>
									<label className="field-label">API key</label>
									<input
										className="field-input"
										type="password"
										value={settings.model.apiKey}
										onChange={e => onChange({
											...settings,
											model: { ...settings.model, apiKey: e.target.value },
										})}
									/>
									<div className="preset-grid">
										{CLOUD_PRESETS.map(p => (
											<button
												key={p.id}
												type="button"
												className="preset-card"
												onClick={() => onChange({
													...settings,
													model: {
														...settings.model,
														provider: 'cloud',
														endpoint: p.endpoint,
														modelId: p.modelId,
													},
												})}
											>
												<strong>{p.label}</strong>
												<span>{p.note}</span>
											</button>
										))}
									</div>
								</>
							)}
							{health && <p className="settings-hint">{health}</p>}
							<button type="button" className="btn sm" onClick={onOpenSetup}>
								<IconBrain width={12} height={12} /> Train / setup Copix Core
							</button>
						</section>
					)}

					{nav === 'rules' && (
						<section className="settings-block">
							<label className="field-label">Built-in rules</label>
							<ul className="rules-list">
								{DEFAULT_RULES.map(r => <li key={r}>{r}</li>)}
							</ul>
							<label className="field-label">Custom rules</label>
							<textarea
								className="field-input field-textarea"
								rows={6}
								value={settings.systemPrompt.customRules.join('\n')}
								onChange={e => onChange({
									...settings,
									systemPrompt: {
										customRules: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
									},
								})}
							/>
						</section>
					)}

					{nav === 'workspace' && (
						<section className="settings-block">
							<label className="field-label">Home directory</label>
							<div className="field-row">
								<input
									className="field-input"
									value={settings.workspace.homeDirectory}
									onChange={e => onChange({
										...settings,
										workspace: { homeDirectory: e.target.value },
									})}
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

					{nav === 'network' && (
						<section className="settings-block">
							<SettingRow title="Cloud endpoint" desc="Used when provider is set to Cloud.">
								<span className="settings-muted-value">{settings.model.endpoint || DEFAULT_CLOUD_ENDPOINT}</span>
							</SettingRow>
							<SettingRow title="Supabase" desc="Auth and profile sync.">
								<span className="settings-muted-value">{auth.supabaseUrl ? 'Configured' : 'Not set'}</span>
							</SettingRow>
						</section>
					)}

					{nav === 'beta' && (
						<section className="settings-block">
							<SettingRow title="Experimental UI" desc="Try upcoming layout polish early.">
								<Toggle on={false} onChange={() => {}} label="Experimental UI" />
							</SettingRow>
						</section>
					)}
				</div>
			</main>
		</div>
	);
}
