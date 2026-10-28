import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import type { SetupChecks } from '../onboarding/checks';
import { EMPTY_CHECKS } from '../onboarding/checks';
import {
	ONBOARDING_MODELS,
	applyPerformance,
	modelIsDimmed,
	recommendedModel,
	roundedRamGb,
	type OnboardingModel,
} from '../onboarding/recommend';
import type { AppLanguage, ModelSettings, ThemePreference } from '../types';
import '../styles/onboarding.css';

const STEPS = ['look', 'provider', 'check', 'tour', 'try'] as const;
export type OnboardingStep = (typeof STEPS)[number];

const TOUR = [
	{ src: './onboarding/ask.png', key: 'tourAsk' as const },
	{ src: './onboarding/diff.png', key: 'tourDiff' as const },
	{ src: './onboarding/models.png', key: 'tourModels' as const },
];

const OLLAMA_DOWNLOAD = 'https://ollama.com/download';

export interface OnboardingProps {
	language: AppLanguage;
	theme: ThemePreference;
	provider: 'ollama' | 'openrouter';
	model: ModelSettings;
	hasStoredKey: boolean;
	initialStep?: OnboardingStep;
	initialSlide?: number;
	previewChecks?: SetupChecks;
	previewKey?: string;
	onLanguage: (language: AppLanguage) => void;
	onTheme: (theme: ThemePreference) => void;
	onProvider: (provider: 'ollama' | 'openrouter') => void;
	onModel: (model: ModelSettings) => void;
	onSaveKey: (key: string) => Promise<{ ok: boolean; message?: string }>;
	onComplete: (prompt: string) => void;
	onSkip: () => void;
}

function sizeLabel(lang: AppLanguage, model: OnboardingModel): string {
	return t(lang, model.sizeKey);
}

function ThemeMini({ mode }: { mode: ThemePreference }) {
	return (
		<div className={`ob-mini ${mode}`} aria-hidden="true">
			<div className="ob-mini-bar">
				<span className="ob-mini-dot" />
				<span className="ob-mini-dot" />
				<span className="ob-mini-dot" />
			</div>
			<div className="ob-mini-body">
				<div className="ob-mini-side" />
				<div className="ob-mini-main">
					<div className="ob-mini-line" />
					<div className="ob-mini-line short" />
				</div>
			</div>
		</div>
	);
}

async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<T>(resolve => {
				timer = setTimeout(() => resolve(fallback), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function Onboarding(props: OnboardingProps) {
	const {
		language, theme, provider, model, hasStoredKey,
		initialStep = 'look', initialSlide = 0, previewChecks, previewKey = '',
		onLanguage, onTheme, onProvider, onModel, onSaveKey, onComplete, onSkip,
	} = props;
	const [step, setStep] = useState<OnboardingStep>(initialStep);
	const [slide, setSlide] = useState(() => Math.min(2, Math.max(0, initialSlide)));
	const [checks, setChecks] = useState<SetupChecks>(previewChecks ?? EMPTY_CHECKS);
	const [draftKey, setDraftKey] = useState(previewKey);
	const [keyError, setKeyError] = useState('');
	const [savingKey, setSavingKey] = useState(false);
	const [pulling, setPulling] = useState(false);
	const [pullPct, setPullPct] = useState<number | null>(null);
	const [pullError, setPullError] = useState('');
	const [promptDirty, setPromptDirty] = useState(false);
	const [prompt, setPrompt] = useState(() => t(language, 'tryPrompt'));

	const stepIndex = STEPS.indexOf(step);
	const recommended = useMemo(() => recommendedModel(checks.ramGb), [checks.ramGb]);
	const selected = ONBOARDING_MODELS.find(item => item.id === model.modelId) ?? recommended;

	useEffect(() => {
		if (promptDirty) return;
		setPrompt(t(language, 'tryPrompt'));
	}, [language, promptDirty]);

	useEffect(() => {
		if (previewChecks) {
			setChecks(previewChecks);
			return;
		}
		let stop = false;
		const tick = () => {
			const api = window.copix?.getSetupChecks;
			if (!api) return;
			void withTimeout(api(), 4000, EMPTY_CHECKS).then(next => {
				if (!stop) setChecks(next);
			});
		};
		tick();
		const id = window.setInterval(tick, 3000);
		return () => {
			stop = true;
			window.clearInterval(id);
		};
	}, [previewChecks]);

	useEffect(() => {
		if (provider !== 'ollama' || !(checks.ramGb > 0)) return;
		const current = ONBOARDING_MODELS.find(item => item.id === model.modelId);
		const id = current && !modelIsDimmed(current, checks.ramGb) ? current.id : recommended.id;
		const next = applyPerformance(model, checks.ramGb, checks.cpuCount, id);
		const same = next.modelId === model.modelId
			&& next.singleModel === model.singleModel
			&& next.numCtx === model.numCtx
			&& next.numGpu === model.numGpu
			&& next.keepAlive === model.keepAlive
			&& next.numThread === model.numThread;
		if (!same) onModel(next);
		// Re-apply when RAM or the chosen model changes. `model` is read for the comparison above.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [checks.ramGb, checks.cpuCount, provider, recommended.id, model.modelId, model.singleModel, model.numCtx, model.numGpu, model.keepAlive, model.numThread]);

		const canLeaveProvider = provider === 'ollama' || hasStoredKey || draftKey.trim().length > 0;
		const ollamaOffline = provider === 'ollama' && !checks.ollamaOnline;

	const saveDraftKey = async (): Promise<boolean> => {
		if (provider !== 'openrouter') return true;
		const next = draftKey.trim();
		if (!next) return hasStoredKey;
		setSavingKey(true);
		setKeyError('');
		try {
			const result = await onSaveKey(next);
			if (!result.ok) {
				setKeyError(result.message || t(language, 'keySaveFailed'));
				return false;
			}
			setDraftKey('');
			return true;
		} finally {
			setSavingKey(false);
		}
	};

	const goForward = async () => {
		if (step === 'provider') {
			const ok = await saveDraftKey();
			if (!ok) return;
		}
		if (step === 'check' && provider === 'ollama' && checks.ramGb > 0) {
			onModel(applyPerformance(model, checks.ramGb, checks.cpuCount, selected.id));
		}
		if (step === 'tour' && slide < TOUR.length - 1) {
			setSlide(slide + 1);
			return;
		}
		if (step === 'try') {
			if (provider === 'openrouter') await saveDraftKey();
			onComplete(prompt.trim() || t(language, 'tryPrompt'));
			return;
		}
		setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)] ?? 'try');
	};

	const goBack = () => {
		if (step === 'tour' && slide > 0) {
			setSlide(slide - 1);
			return;
		}
		setStep(STEPS[Math.max(0, stepIndex - 1)] ?? 'look');
	};

	const skip = async () => {
		if (provider === 'openrouter' && draftKey.trim()) {
			await saveDraftKey();
		}
		if (provider === 'ollama' && checks.ramGb > 0) {
			onModel(applyPerformance(model, checks.ramGb, checks.cpuCount, selected.id));
		}
		onSkip();
	};

	const pull = async (modelId: string) => {
		const api = window.copix;
		if (!api?.pullOllamaModel || pulling) return;
		setPulling(true);
		setPullError('');
		setPullPct(null);
		const stop = api.onPullProgress?.(line => {
			const match = line.match(/(\d+)%/);
			setPullPct(match ? Number(match[1]) : null);
		});
		try {
			const result = await withTimeout(api.pullOllamaModel(modelId), 30 * 60 * 1000, {
				ok: false,
				message: t(language, 'pullFailed'),
			});
			if (!result.ok) setPullError(t(language, 'pullFailed'));
			if (api.getSetupChecks) {
				const next = await withTimeout(api.getSetupChecks(), 4000, checks);
				setChecks(next);
			}
		} finally {
			stop?.();
			setPulling(false);
		}
	};

	const ramLine = roundedRamGb(checks.ramGb) > 0
		? t(language, 'recommended', {
			gb: roundedRamGb(checks.ramGb),
			model: recommended.id,
			size: sizeLabel(language, recommended),
		})
		: t(language, 'recommendedUnknown', {
			model: recommended.id,
			size: sizeLabel(language, recommended),
		});

		const primaryLabel = step === 'try' ? t(language, 'start') : t(language, 'continue');
		const primaryDisabled = savingKey || (step === 'provider' && !canLeaveProvider);

	return (
		<div className="ob-root" role="dialog" aria-modal="true" aria-labelledby="ob-title">
			<article className="ob-card">
				<img className="ob-logo" src="./icon.png" alt="" width={64} height={64} />
				<p className="ob-kicker">{t(language, 'stepLabel', { n: stepIndex + 1, total: STEPS.length })}</p>
				{step === 'look' && (
					<>
						<h1 id="ob-title">{t(language, 'lookTitle')}</h1>
						<p className="ob-lead">{t(language, 'lookBody')}</p>
						<div className="ob-choice-row">
							{(['light', 'dark', 'system'] as const).map(mode => (
								<button
									key={mode}
									type="button"
									className={`ob-choice${theme === mode ? ' selected' : ''}`}
									aria-pressed={theme === mode}
									onClick={() => onTheme(mode)}
								>
									<ThemeMini mode={mode} />
									<span className="ob-choice-name">{t(language, mode === 'light' ? 'themeLight' : mode === 'dark' ? 'themeDark' : 'themeSystem')}</span>
								</button>
							))}
						</div>
						<div className="ob-lang" role="group" aria-label={t(language, 'langLabel')}>
							<button type="button" aria-pressed={language === 'en'} onClick={() => onLanguage('en')}>EN</button>
							<button type="button" aria-pressed={language === 'ko'} onClick={() => onLanguage('ko')}>한국어</button>
						</div>
					</>
				)}

				{step === 'provider' && (
					<>
						<h1 id="ob-title">{t(language, 'providerTitle')}</h1>
						<p className="ob-lead">{t(language, 'providerBody')}</p>
						<div className="ob-choice-row two">
							<button
								type="button"
								className={`ob-choice ob-provider${provider === 'ollama' ? ' selected' : ''}`}
								aria-pressed={provider === 'ollama'}
								onClick={() => onProvider('ollama')}
							>
								<span className="ob-choice-name">{t(language, 'ollamaTitle')}</span>
								<span className="ob-choice-copy">{t(language, 'ollamaBody')}</span>
							</button>
							<button
								type="button"
								className={`ob-choice ob-provider${provider === 'openrouter' ? ' selected' : ''}`}
								aria-pressed={provider === 'openrouter'}
								onClick={() => onProvider('openrouter')}
							>
								<span className="ob-choice-name">{t(language, 'openrouterTitle')}</span>
								<span className="ob-choice-copy">{t(language, 'openrouterBody')}</span>
							</button>
						</div>
						{provider === 'openrouter' && (
							<div className="ob-key">
								<label htmlFor="ob-key">{t(language, 'keyLabel')}</label>
								<input
									id="ob-key"
									type="password"
									autoComplete="off"
									spellCheck={false}
									value={draftKey}
									placeholder={hasStoredKey ? t(language, 'keyStored') : t(language, 'keyPlaceholder')}
									onChange={event => setDraftKey(event.target.value)}
								/>
								<p className="ob-note warn">{t(language, 'leaves')}</p>
								<p className="ob-note">{t(language, 'keyHint')}</p>
								{hasStoredKey && !draftKey && <p className="ob-note sage">{t(language, 'keyStored')}</p>}
								{keyError && <p className="ob-note warn">{keyError}</p>}
							</div>
						)}
					</>
				)}

				{step === 'check' && (
					<>
						<h1 id="ob-title">{provider === 'openrouter' ? t(language, 'checkCloudTitle') : t(language, 'checkTitle')}</h1>
						<p className="ob-lead">{provider === 'openrouter' ? t(language, 'checkCloudBody') : t(language, 'checkBody')}</p>
						{provider === 'ollama' && (
							<>
								<p className="ob-recommend">{ramLine}</p>
								<p className="ob-note">{t(language, 'pullSize', { size: sizeLabel(language, selected), quant: selected.quant })}</p>
								<ul className="ob-models">
									{ONBOARDING_MODELS.map(item => {
										const dim = modelIsDimmed(item, checks.ramGb);
										const installed = checks.models.some(name => name === item.id || name.startsWith(`${item.id.split(':')[0]}:`));
										return (
											<li key={item.id} className={dim ? 'dim' : ''}>
												<button
													type="button"
													aria-pressed={selected.id === item.id}
													disabled={dim}
													onClick={() => onModel({ ...model, modelId: item.id, selection: 'manual', apiKey: '' })}
												>
													{item.id} · {item.quant}
													<small>
														{sizeLabel(language, item)}
														{installed ? ' · ✓' : ''}
														{dim ? ` · ${t(language, 'needsRam', { gb: item.minRamGb })}` : ''}
													</small>
												</button>
											</li>
										);
									})}
								</ul>
							</>
						)}
						<div className="ob-rows">
							<CheckRow
								ok={checks.ollamaOnline}
								label={t(language, 'rowOllama')}
								action={provider === 'ollama' && !checks.ollamaOnline ? (
									<button type="button" className="ob-fix" onClick={() => void window.copix?.openExternal?.(OLLAMA_DOWNLOAD)}>
										{t(language, 'fixDownload')}
									</button>
								) : null}
							/>
							<CheckRow
								ok={checks.hasModel}
								label={t(language, 'rowModel')}
								detail={provider === 'ollama' && !checks.hasModel ? sizeLabel(language, selected) : undefined}
								action={provider === 'ollama' && !checks.hasModel ? (
									<button type="button" className="ob-fix" disabled={pulling || !checks.ollamaOnline} onClick={() => void pull(selected.id)}>
										{t(language, 'fixPull', { model: selected.id })}
									</button>
								) : null}
							/>
							<CheckRow
								ok={checks.folderExists}
								label={t(language, 'rowFolder')}
								detail={checks.folderLabel || '~/Copix'}
								action={!checks.folderExists ? (
									<button
										type="button"
										className="ob-fix"
										onClick={() => void window.copix?.createCopixFolder?.().then(() => {
											void window.copix?.getSetupChecks?.().then(setChecks);
										})}
									>
										{t(language, 'fixFolder')}
									</button>
								) : null}
							/>
							<CheckRow
								ok={checks.cliAvailable}
								label={t(language, 'rowCli')}
								detail={checks.cliAvailable ? undefined : t(language, 'optional')}
							/>
						</div>
						{pulling && (
							<div className={`ob-progress${pullPct == null ? ' indeterminate' : ''}`} aria-hidden="true">
								<span style={pullPct == null ? undefined : { width: `${pullPct}%` }} />
							</div>
						)}
						{pulling && <p className="ob-note">{t(language, 'pulling', { model: selected.id })}{pullPct != null ? ` ${pullPct}%` : ''}</p>}
						{pullError && <p className="ob-note warn">{pullError}</p>}
							{ollamaOffline && <p className="ob-note">{t(language, 'continueNeeds')}</p>}
					</>
				)}

				{step === 'tour' && (
					<>
						<h1 id="ob-title" className="ob-caption" style={{ marginTop: 0 }}>{t(language, TOUR[slide]!.key)}</h1>
						<img className="ob-shot" src={TOUR[slide]!.src} alt="" />
						<p className="ob-slide-count">{slide + 1} / {TOUR.length}</p>
					</>
				)}

				{step === 'try' && (
					<>
						<h1 id="ob-title">{t(language, 'tryTitle')}</h1>
						<p className="ob-lead">{t(language, 'tryBody')}</p>
						<label className="ob-field-label" htmlFor="ob-prompt">{t(language, 'tryTitle')}</label>
						<textarea
							id="ob-prompt"
							className="ob-prompt"
							value={prompt}
							onChange={event => {
								setPromptDirty(true);
								setPrompt(event.target.value);
							}}
						/>
					</>
				)}

				<div className="ob-footer">
					<button type="button" className="ob-btn ghost" onClick={goBack} disabled={stepIndex === 0 && slide === 0}>
						{t(language, 'back')}
					</button>
					<span className="spacer" />
					<button type="button" className="ob-btn ghost" onClick={() => void skip()}>{t(language, 'skip')}</button>
					<button type="button" className="ob-btn primary" disabled={primaryDisabled} onClick={() => void goForward()}>
						{primaryLabel}
					</button>
				</div>
				<div className="ob-dots" aria-hidden="true">
					{STEPS.map((id, index) => (
						<span key={id} className={`ob-dot${index === stepIndex ? ' on' : ''}`} />
					))}
				</div>
			</article>
		</div>
	);
}

function CheckRow({ ok, label, detail, action }: { ok: boolean; label: string; detail?: string; action?: ReactNode }) {
	return (
		<div className="ob-row">
			<span className={`ob-mark ${ok ? 'ok' : 'bad'}`} aria-hidden="true">{ok ? '✓' : '✗'}</span>
			<span className="ob-row-label">
				{label}
				{detail && <span className="ob-row-sub">{detail}</span>}
			</span>
			{action ?? <span />}
		</div>
	);
}
