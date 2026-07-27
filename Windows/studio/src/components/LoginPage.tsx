import { useEffect, useState } from 'react';
import {
	resolveAuthConfig,
	signInWithEmail,
	signUpWithEmail,
	type AuthSession,
} from '../services/auth';
import { IconLogo } from './Icons';

interface Props {
	onAuthenticated: (session: AuthSession) => void;
}

type Mode = 'home' | 'login' | 'signup';

export function LoginPage({ onAuthenticated }: Props) {
	const [mode, setMode] = useState<Mode>('home');
	const [visible, setVisible] = useState(true);
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const auth = resolveAuthConfig();

	const switchMode = (next: Mode) => {
		setVisible(false);
		setError('');
		window.setTimeout(() => {
			setMode(next);
			setVisible(true);
		}, 160);
	};

	useEffect(() => {
		setVisible(true);
	}, []);

	const submit = async () => {
		setBusy(true);
		setError('');
		try {
			const r = mode === 'signup'
				? await signUpWithEmail(auth, email, password, displayName || undefined)
				: await signInWithEmail(auth, email, password);
			if (!r.ok || !r.session) {
				setError(r.error || 'Authentication failed');
				return;
			}
			if (!r.session.accessToken && mode === 'signup') {
				setError(r.error || 'Account created — confirm email, then Login.');
				switchMode('login');
				return;
			}
			onAuthenticated(r.session);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="login-screen">
			<div className={`login-stack${visible ? ' show' : ''}`}>
				<div className="login-logo" aria-label="Copix">
					<IconLogo width={36} height={36} />
					<span>Copix</span>
				</div>

				{mode === 'home' && (
					<div className="login-panel">
						<button type="button" className="login-btn primary" onClick={() => switchMode('login')}>
							Login
						</button>
						<button type="button" className="login-btn secondary" onClick={() => switchMode('signup')}>
							Signup
						</button>
					</div>
				)}

				{(mode === 'login' || mode === 'signup') && (
					<form
						className="login-form login-panel"
						onSubmit={e => {
							e.preventDefault();
							void submit();
						}}
					>
						{mode === 'signup' && (
							<input
								className="login-input"
								placeholder="Display name"
								value={displayName}
								onChange={e => setDisplayName(e.target.value)}
								autoComplete="nickname"
							/>
						)}
						<input
							className="login-input"
							type="email"
							placeholder="Email"
							value={email}
							onChange={e => setEmail(e.target.value)}
							autoComplete="email"
							required
						/>
						<input
							className="login-input"
							type="password"
							placeholder="Password"
							value={password}
							onChange={e => setPassword(e.target.value)}
							autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
							required
							minLength={6}
						/>
						<button type="submit" className="login-btn primary" disabled={busy || !email || !password}>
							{busy ? 'Please wait…' : mode === 'signup' ? 'Signup' : 'Login'}
						</button>
						<button
							type="button"
							className="login-btn secondary"
							disabled={busy}
							onClick={() => switchMode('home')}
						>
							Back
						</button>
						{error && <p className="login-error">{error}</p>}
					</form>
				)}
			</div>
		</div>
	);
}
