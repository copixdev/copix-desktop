import { useEffect, useState } from 'react';
import { checkModelHealth, settingsToConfig, CLOUD_PRESETS } from '../models/config';
import { DEFAULT_RULES } from '../models/systemPrompt';
import {
	getRemoteSession,
	isSupabaseConfigured,
	resolveAuthConfig,
	signInWithEmail,
	signOut,
	signUpWithEmail,
} from '../services/auth';
import { pullProfileFromSupabase, pushProfileToSupabase } from '../services/supabaseProfile';
import { PLANS } from '../services/subscription';
import { AppSettings, DEFAULT_CLOUD_ENDPOINT } from '../types';
import { COPIX_SUPABASE_URL } from '../services/supabaseConfig';
import { copix } from '../api';

interface Props {
	open: boolean;
	settings: AppSettings;
	onClose: () => void;
	onChange: (s: AppSettings) => void;
	onOpenSetup: () => void;
	onSignedOut?: () => void;
}

type Tab = 'account' | 'subscription' | 'rules' | 'model' | 'layout';

export function SettingsModal({ open, settings, onClose, onChange, onOpenSetup, onSignedOut }: Props) {
	const [tab, setTab] = useState<Tab>('account');
	const [health, setHealth] = useState('');
	const [projectsRoot, setProjectsRoot] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [authBusy, setAuthBusy] = useState(false);
	const [authMsg, setAuthMsg] = useState('');
	const [signedInId, setSignedInId] = useState<string | null>(null);

	const active = settings.accounts.find(a => a.id === settings.activeAccountId) ?? settings.accounts[0];
	const auth = resolveAuthConfig(settings.auth);

	useEffect(() => {
		if (!open) return;
		setEmail(active?.email ?? '');
		setDisplayName(active?.displayName ?? '');
		void getRemoteSession(auth).then(s => setSignedInId(s?.userId ?? null));
	}, [open, active?.email, active?.displayName, auth.supabaseUrl]);

	if (!open) return null;

	const applySession = async (userId: string, userEmail?: string, name?: string) => {
		const next: AppSettings = {
			...settings,
			auth,
			activeAccountId: userId,
			accounts: [{
				id: userId,
				displayName: name || userEmail?.split('@')[0] || 'Copix user',
				email: userEmail,
				createdAt: Date.now(),
			}],
		};
		const remote = await pullProfileFromSupabase(next);
		onChange(remote ? { ...next, ...remote, auth } : next);
		setSignedInId(userId);
		setPassword('');
	};

	const handleSignUp = async () => {
		setAuthBusy(true);
		setAuthMsg('');
		try {
			const r = await signUpWithEmail(auth, email, password, displayName);
			if (!r.ok) { setAuthMsg(r.error || 'Sign up failed'); return; }
			if (r.session?.userId && r.session.accessToken) {
				await applySession(r.session.userId, r.session.email, r.session.displayName);
				setAuthMsg('Signed up and synced to Supabase.');
			} else if (r.session?.userId) {
				onChange({
					...settings,
					auth,
					activeAccountId: r.session.userId,
					accounts: [{
						id: r.session.userId,
						displayName: r.session.displayName,
						email: r.session.email,
						createdAt: Date.now(),
					}],
				});
				setAuthMsg(r.error || 'Account created — confirm email, then sign in.');
			} else {
				setAuthMsg(r.error || 'Account created — sign in to continue.');
			}
		} finally {
			setAuthBusy(false);
		}
	};

	const handleSignIn = async () => {
		setAuthBusy(true);
		setAuthMsg('');
		try {
			const r = await signInWithEmail(auth, email, password);
			if (!r.ok || !r.session) { setAuthMsg(r.error || 'Sign in failed'); return; }
			await applySession(r.session.userId, r.session.email, r.session.displayName);
			setAuthMsg('Signed in — profile synced.');
		} finally {
			setAuthBusy(false);
		}
	};

	const handleSignOut = async () => {
		setAuthBusy(true);
		try {
			await signOut(auth);
			setSignedInId(null);
			setAuthMsg('Signed out.');
			onClose();
			onSignedOut?.();
		} finally {
			setAuthBusy(false);
		}
	};

	const checkHealth = async () => {
		const r = await checkModelHealth(settingsToConfig(settings.model));
		setHealth(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
	};

	const loadRoot = async () => {
		setProjectsRoot(await copix.getProjectsRoot());
	};

	return (
		<div className="settings-overlay" onClick={onClose}>
			<div className="settings-modal" onClick={e => e.stopPropagation()}>
				<header className="settings-modal-head">
					<h2>Copix Settings</h2>
					<button type="button" className="icon-btn" onClick={onClose}>×</button>
				</header>

				<nav className="settings-tabs">
					{([
						['account', 'Account'],
						['subscription', 'Plans'],
						['rules', 'Rules'],
						['model', 'gpt-oss'],
						['layout', 'Appearance'],
					] as [Tab, string][]).map(([t, label]) => (
						<button
							key={t}
							type="button"
							className={tab === t ? 'active' : ''}
							onClick={() => { setTab(t); if (t === 'model') checkHealth(); if (t === 'layout') loadRoot(); }}
						>
							{label}
						</button>
					))}
				</nav>

				<div className="settings-body">
					{tab === 'account' && (
						<>
							<p className="settings-hint">
								{isSupabaseConfigured(auth)
									? `Connected to Copix cloud (${new URL(COPIX_SUPABASE_URL).host}). Passwords stay in Supabase Auth — never stored in our profiles table.`
									: 'Supabase is not configured.'}
							</p>
							{signedInId && (
								<p className="settings-hint">
									Signed in · User ID <code className="inline-code">{signedInId}</code>
								</p>
							)}
							<label className="field-label">Display name</label>
							<input
								className="field-input"
								value={displayName}
								onChange={e => {
									setDisplayName(e.target.value);
									onChange({
										...settings,
										auth,
										accounts: settings.accounts.map(a =>
											a.id === active?.id ? { ...a, displayName: e.target.value } : a),
									});
								}}
							/>
							<label className="field-label">Email</label>
							<input
								className="field-input"
								type="email"
								placeholder="you@example.com"
								value={email}
								onChange={e => setEmail(e.target.value)}
							/>
							<label className="field-label">Password</label>
							<input
								className="field-input"
								type="password"
								placeholder="••••••••"
								value={password}
								onChange={e => setPassword(e.target.value)}
								onKeyDown={e => { if (e.key === 'Enter') void handleSignIn(); }}
							/>
							<div className="btn-row">
								<button type="button" className="btn primary sm" disabled={authBusy || !email || !password} onClick={() => void handleSignIn()}>
									Sign in
								</button>
								<button type="button" className="btn sm" disabled={authBusy || !email || !password} onClick={() => void handleSignUp()}>
									Sign up
								</button>
								{signedInId && (
									<button type="button" className="btn ghost sm" disabled={authBusy} onClick={() => void handleSignOut()}>
										Sign out
									</button>
								)}
							</div>
							{authMsg && <p className="settings-hint">{authMsg}</p>}
						</>
					)}

					{tab === 'subscription' && (
						<>
							<p className="settings-hint">
								Plan syncs to Supabase when you are signed in. Choose Free, Pro, or Max.
							</p>
							<div className="plan-grid">
								{PLANS.map(plan => (
									<button
										key={plan.id}
										type="button"
										className={`plan-card${settings.subscription.plan === plan.id ? ' active' : ''}`}
										onClick={() => {
											const next = {
												...settings,
												auth,
												subscription: {
													plan: plan.id,
													status: plan.id === 'free' ? 'inactive' as const : 'trial' as const,
												},
											};
											onChange(next);
											void pushProfileToSupabase(next);
										}}
									>
										<div className="plan-card-head">
											<strong>{plan.label}</strong>
											<span>{plan.price}</span>
										</div>
										<ul className="plan-features">
											{plan.features.map(f => <li key={f}>{f}</li>)}
										</ul>
									</button>
								))}
							</div>
						</>
					)}

					{tab === 'rules' && (
						<>
							<p className="settings-hint">
								Default rules are always applied. Add custom rules (one per line) for this machine.
							</p>
							<label className="field-label">Built-in rules</label>
							<ul className="rules-list">
								{DEFAULT_RULES.map(r => <li key={r}>{r}</li>)}
							</ul>
							<label className="field-label">Custom rules</label>
							<textarea
								className="field-input field-textarea"
								rows={5}
								placeholder="One rule per line"
								value={settings.systemPrompt.customRules.join('\n')}
								onChange={e => onChange({
									...settings,
									systemPrompt: {
										customRules: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
									},
								})}
							/>
						</>
					)}

					{tab === 'model' && (
						<>
							<p className="settings-hint">
								<strong>Local</strong> — Ollama on this machine.{' '}
								<strong>Cloud</strong> — free hosted gpt-oss (OpenRouter / Groq) or your own Copix proxy.
								Cloud is much faster than local if your GPU is small.
							</p>
							<label className="field-label">Inference</label>
							<select
								className="field-input"
								value={settings.model.provider}
								onChange={e => {
									const provider = e.target.value as 'local' | 'cloud';
									onChange({
										...settings,
										model: {
											...settings.model,
											provider,
											endpoint: provider === 'cloud'
												? (settings.model.endpoint.includes('127.0.0.1')
													? DEFAULT_CLOUD_ENDPOINT
													: settings.model.endpoint)
												: 'http://127.0.0.1:11434/v1',
										},
									});
								}}
							>
								<option value="local">Local (Ollama)</option>
								<option value="cloud">Cloud (free API or Copix proxy)</option>
							</select>
							{settings.model.provider === 'cloud' && (
								<>
									<label className="field-label">Free providers</label>
									<div className="preset-grid">
										{CLOUD_PRESETS.map(p => {
											const active = settings.model.endpoint === p.endpoint;
											return (
												<button
													key={p.id}
													type="button"
													className={`preset-card${active ? ' active' : ''}`}
													onClick={() => onChange({
														...settings,
														model: {
															...settings.model,
															endpoint: p.endpoint,
															modelId: p.modelId,
															preferTuned: false,
														},
													})}
												>
													<strong>{p.label}</strong>
													<span>{p.note}</span>
												</button>
											);
										})}
									</div>
									<p className="settings-hint">
										Both are free and need an API key (no credit card).{' '}
										<button type="button" className="link-btn" onClick={() => copix.openExternal('https://openrouter.ai/keys')}>OpenRouter keys</button>
										{' · '}
										<button type="button" className="link-btn" onClick={() => copix.openExternal('https://console.groq.com/keys')}>Groq keys</button>
									</p>
								</>
							)}
							<label className="field-label">
								{settings.model.provider === 'cloud' ? 'Cloud API URL' : 'Ollama API URL'}
							</label>
							<input
								className="field-input"
								value={settings.model.endpoint}
								onChange={e => onChange({ ...settings, model: { ...settings.model, endpoint: e.target.value } })}
								placeholder={settings.model.provider === 'cloud'
									? 'https://your-app.onrender.com/v1'
									: 'http://127.0.0.1:11434/v1'}
							/>
							{settings.model.provider === 'cloud' && (
								<>
									<label className="field-label">API key</label>
									<input
										className="field-input"
										type="password"
										value={settings.model.apiKey}
										onChange={e => onChange({
											...settings,
											model: { ...settings.model, apiKey: e.target.value },
										})}
										placeholder="sk-or-… (OpenRouter) / gsk_… (Groq) / your COPIX_API_KEY"
									/>
								</>
							)}
							<label className="field-label">Base model</label>
							<input
								className="field-input"
								value={settings.model.modelId}
								onChange={e => onChange({ ...settings, model: { ...settings.model, modelId: e.target.value } })}
								placeholder="gpt-oss:20b"
							/>
							<label className="field-label">Tuned model (after export)</label>
							<input
								className="field-input"
								value={settings.model.tunedModelId}
								onChange={e => onChange({ ...settings, model: { ...settings.model, tunedModelId: e.target.value } })}
								placeholder="copix-core"
							/>
							<label className="field-label">
								<input
									type="checkbox"
									checked={settings.model.preferTuned}
									onChange={e => onChange({ ...settings, model: { ...settings.model, preferTuned: e.target.checked } })}
								/>
								{' '}Prefer tuned model when available
							</label>
							<div className="model-actions">
								<button type="button" className="repo-btn" onClick={checkHealth}>
									{settings.model.provider === 'cloud' ? 'Test Cloud' : 'Test Ollama'}
								</button>
								{settings.model.provider === 'local' && (
									<button type="button" className="repo-btn subtle" onClick={onOpenSetup}>
										Run model setup
									</button>
								)}
								{settings.model.provider === 'local' ? (
									<button type="button" className="repo-btn subtle" onClick={() => copix.openExternal('https://ollama.com/download')}>
										Get Ollama
									</button>
								) : (
									<button type="button" className="repo-btn subtle" onClick={() => copix.openExternal('https://render.com/docs/deploy-docker')}>
										Deploy guide
									</button>
								)}
							</div>
							{health && <p className={`health-line ${health.startsWith('✓') ? 'ok' : 'err'}`}>{health}</p>}
						</>
					)}

					{tab === 'layout' && (
						<>
							<p className="settings-hint">Theme follows your Windows setting when set to System.</p>
							<label className="field-label">Theme</label>
							<select
								className="field-input"
								value={settings.theme}
								onChange={e => onChange({ ...settings, theme: e.target.value as AppSettings['theme'] })}
							>
								<option value="system">System (sync with OS)</option>
								<option value="dark">Dark</option>
								<option value="light">Light</option>
							</select>
							<p className="settings-hint" style={{ marginTop: 12 }}>Drag panel edges in the main window, or set defaults below.</p>
							<label className="field-label">Sidebar width (px)</label>
							<input
								type="number"
								className="field-input"
								min={160}
								max={320}
								value={settings.layout.sidebarWidth}
								onChange={e => onChange({
									...settings,
									layout: { ...settings.layout, sidebarWidth: Number(e.target.value) || 200 },
								})}
							/>
							<label className="field-label">Editor width (px)</label>
							<input
								type="number"
								className="field-input"
								min={280}
								max={900}
								value={settings.layout.editorWidth}
								onChange={e => onChange({
									...settings,
									layout: { ...settings.layout, editorWidth: Number(e.target.value) || 520 },
								})}
							/>
							<label className="field-label">Home directory</label>
							<p className="settings-hint">Where Copix creates new projects (default: your user folder, e.g. C:/Users/you).</p>
							<div className="field-row">
								<input
									className="field-input"
									value={settings.workspace.homeDirectory}
									onChange={e => onChange({
										...settings,
										workspace: { ...settings.workspace, homeDirectory: e.target.value },
									})}
									placeholder="C:/Users/you"
								/>
								<button
									type="button"
									className="repo-btn"
									onClick={async () => {
										const picked = await copix.browseHomeDirectory();
										if (picked) onChange({
											...settings,
											workspace: { ...settings.workspace, homeDirectory: picked },
										});
									}}
								>
									Browse…
								</button>
							</div>
							<label className="field-label">Current resolved path</label>
							<input className="field-input" readOnly value={projectsRoot} onFocus={loadRoot} placeholder="Click to load…" />
						</>
					)}
				</div>
			</div>
		</div>
	);
}
