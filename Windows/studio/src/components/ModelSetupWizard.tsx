import { useCallback, useEffect, useRef, useState } from 'react';
import { copix, type SetupProgress } from '../api';
import { useToast } from './Toast';
import { IconBrain, IconPlay, IconStop } from './Icons';

interface Props {
	open: boolean;
	minimized: boolean;
	onMinimize: () => void;
	onExpand: () => void;
	onClose: () => void;
	onComplete: () => void;
	onSkip: () => void;
}

const PHASE_LABELS: Record<SetupProgress['phase'], string> = {
	idle: 'Ready',
	checking_ollama: 'Checking Ollama',
	pulling: 'Downloading gpt-oss:20b',
	installing_deps: 'Installing dependencies',
	building_dataset: 'Building dataset',
	training: 'Fine-tuning',
	exporting: 'Exporting to Ollama',
	done: 'Complete',
	error: 'Error',
};

const STEPS: SetupProgress['phase'][] = ['checking_ollama', 'pulling', 'done'];

export function ModelSetupWizard({ open, minimized, onMinimize, onExpand, onClose, onComplete, onSkip }: Props) {
	const toast = useToast();
	const [progress, setProgress] = useState<SetupProgress>({ phase: 'idle', message: 'Preparing…' });
	const [running, setRunning] = useState(false);
	const [pullLog, setPullLog] = useState('');
	const [server, setServer] = useState<{ online: boolean; hasBase?: boolean; hasTuned?: boolean }>({ online: false });
	const autoStarted = useRef(false);

	const modelReady = Boolean(server.hasBase || server.hasTuned);

	const refresh = useCallback(async () => {
		const s = await copix.getServerStatus();
		setServer({ online: s.online, hasBase: s.hasBase, hasTuned: s.hasTuned });
		if (s.hasBase || s.hasTuned) {
			setProgress(p => (p.phase === 'idle' ? p : { phase: 'done', message: s.hasTuned ? 'copix-core ready' : 'gpt-oss:20b ready' }));
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		refresh();
		const t = setInterval(refresh, 3000);
		return () => clearInterval(t);
	}, [open, refresh]);

	useEffect(() => {
		const off = copix.onSetupProgress(p => {
			setProgress(p);
			if (p.phase === 'done') {
				setRunning(false);
				onComplete();
			}
			if (p.phase === 'error') {
				setRunning(false);
				autoStarted.current = false;
			}
		});
		return off;
	}, [onComplete]);

	useEffect(() => copix.onPullProgress(line => setPullLog(prev => (prev + line).slice(-2000))), []);

	const start = useCallback(async () => {
		setRunning(true);
		setPullLog('');
		setProgress({ phase: 'checking_ollama', message: 'Starting setup…' });
		try {
			const r = await copix.runModelSetup();
			if (!r?.ok) {
				const step = r?.failedStep ? PHASE_LABELS[r.failedStep] : 'Setup';
				const type = r?.errorType ?? 'Error';
				const msg = r?.message || 'Setup failed';
				toast(`${step} failed (${type}): ${msg}`, 'err');
				if (r?.message) {
					setProgress({
						phase: 'error',
						message: msg,
						failedStep: r.failedStep,
						errorType: type,
						detail: r.detail,
					});
				}
			} else {
				toast('gpt-oss:20b is ready', 'ok');
			}
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			console.error('[copix] setup failed:', e);
			setProgress({
				phase: 'error',
				message: e.message || 'Setup failed unexpectedly',
				errorType: e.name || 'Error',
				detail: e.stack,
				failedStep: 'checking_ollama',
			});
			toast(`Setup failed (${e.name}): ${e.message}`, 'err');
			autoStarted.current = false;
		} finally {
			setRunning(false);
			await refresh();
		}
	}, [refresh, toast]);

	useEffect(() => {
		if (!open || running || modelReady || progress.phase !== 'idle') return;
		if (!autoStarted.current) {
			autoStarted.current = true;
			void start();
		}
	}, [open, running, modelReady, progress.phase, start]);

	const stop = async () => {
		await copix.cancelModelSetup();
		setRunning(false);
		setProgress({ phase: 'idle', message: 'Setup cancelled' });
	};

	const stepIndex = STEPS.indexOf(progress.phase);
	const pct = progress.phase === 'done' ? 100 : stepIndex >= 0 ? Math.round((stepIndex / (STEPS.length - 1)) * 100) : 0;
	const failedStepLabel = progress.failedStep ? (PHASE_LABELS[progress.failedStep] ?? progress.failedStep) : undefined;

	if (!open && !minimized) return null;

	if (minimized && !open) {
		return (
			<button type="button" className="setup-chip" onClick={onExpand} title="Open model setup">
				<span className={`setup-chip-dot ${progress.phase === 'done' ? 'done' : running ? 'active' : ''}`} />
				{progress.phase === 'done' ? 'Model ready' : PHASE_LABELS[progress.phase]}
			</button>
		);
	}

	return (
		<div className="setup-overlay">
			<div className="setup-modal">
				<header className="setup-head">
					<div className="setup-head-left">
						<IconBrain className="setup-icon" />
						<div>
							<h1>Welcome to Copix</h1>
							<p>Pull <strong>gpt-oss:20b</strong> in Ollama, then optionally fine-tune <strong>Copix Core</strong> (LoRA on openai/gpt-oss-20b) for coding, explanation, and search.</p>
						</div>
					</div>
					<div className={`server-pill ${modelReady ? 'on' : server.online ? '' : 'off'}`}>
						<span className="pill-dot" />
						{server.hasTuned ? 'copix-core' : server.hasBase ? 'gpt-oss:20b' : server.online ? 'Ollama · no model' : 'Ollama offline'}
					</div>
				</header>

				<div className="setup-progress-overview">
					<div className="progress-bar-wrap">
						<label>{PHASE_LABELS[progress.phase]}</label>
						<div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
					</div>
					{progress.message && progress.phase !== 'error' && <p className="setup-msg">{progress.message}</p>}
				</div>

				{progress.phase === 'error' && (
					<div className="setup-error card" role="alert">
						<div className="setup-error-head">
							<strong>Setup failed{failedStepLabel ? ` at ${failedStepLabel}` : ''}</strong>
							{progress.errorType && <span className="status-tag error">{progress.errorType}</span>}
						</div>
						<p className="setup-error-msg">{progress.message || 'An unknown error occurred.'}</p>
						{progress.detail && progress.detail !== progress.message && (
							<pre className="setup-error-detail">{progress.detail}</pre>
						)}
					</div>
				)}

				{pullLog && progress.phase === 'pulling' && <pre className="pull-log">{pullLog}</pre>}

				<div className="setup-actions">
					{!running && progress.phase !== 'done' && (
						<button type="button" className="btn primary" onClick={start}>
							<IconPlay width={14} height={14} /> Start setup
						</button>
					)}
					{running && (
						<button type="button" className="btn danger" onClick={stop}>
							<IconStop width={14} height={14} /> Cancel
						</button>
					)}
					{running && (
						<button type="button" className="btn ghost" onClick={onMinimize}>
							Continue in background
						</button>
					)}
					{progress.phase === 'done' && (
						<button type="button" className="btn primary" onClick={onClose}>Get started</button>
					)}
					{!running && progress.phase !== 'done' && (
						<>
							<button type="button" className="btn ghost" onClick={() => copix.openExternal('https://ollama.com/download')}>
								Get Ollama
							</button>
							<button type="button" className="btn ghost" onClick={onSkip}>Skip for now</button>
						</>
					)}
				</div>

				<p className="setup-foot muted-xs">
					Base: gpt-oss:20b via Ollama. Fine-tune Copix Core (gpt-oss LoRA) in Settings → Models — needs ample RAM/VRAM or page file.
				</p>
			</div>
		</div>
	);
}
