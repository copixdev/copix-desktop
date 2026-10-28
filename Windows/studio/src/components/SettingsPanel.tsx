import { useState } from 'react';
import { t } from '../i18n';
import { ONBOARDING_MODELS, TIGHT_KEEP_ALIVE, TIGHT_NUM_CTX } from '../onboarding/recommend';
import type { AppLanguage, ModelSettings, ThemePreference } from '../types';

interface Props {
	language: AppLanguage;
	theme: ThemePreference;
	provider: 'ollama' | 'openrouter' | 'groq' | 'openai';
	model: ModelSettings;
	hasStoredKey: boolean;
	onLanguage: (language: AppLanguage) => void;
	onTheme: (theme: ThemePreference) => void;
	onProvider: (provider: 'ollama' | 'openrouter') => void;
	onModel: (model: ModelSettings) => void;
	onSaveKey: (key: string) => Promise<{ ok: boolean; message?: string }>;
	onRunSetup: () => void;
	onClose: () => void;
}

export function SettingsPanel(props: Props) {
	const { language, theme, provider, model, hasStoredKey } = props;
	const [draftKey, setDraftKey] = useState('');
	const [keyNote, setKeyNote] = useState('');
	const cloud = provider === 'openrouter' || provider === 'groq' || provider === 'openai';
	const tight = Boolean(model.singleModel && model.lowVram);

	const saveKey = async (value: string) => {
		setKeyNote('');
		const result = await props.onSaveKey(value);
		if (!result.ok) {
			setKeyNote(result.message || t(language, 'keySaveFailed'));
			return;
		}
		setDraftKey('');
		setKeyNote(value.trim() ? t(language, 'settingsSaved') : '');
	};

	return (
		<div className="set-root" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={props.onClose}>
			<div className="set-sheet" onMouseDown={event => event.stopPropagation()}>
				<h2 id="settings-title">{t(language, 'settingsTitle')}</h2>

				<label className="set-field">
					<span>{t(language, 'settingsTheme')}</span>
					<div className="set-seg">
						{(['light', 'dark', 'system'] as const).map(mode => (
							<button
								key={mode}
								type="button"
								aria-pressed={theme === mode}
								onClick={() => props.onTheme(mode)}
							>
								{t(language, mode === 'light' ? 'themeLight' : mode === 'dark' ? 'themeDark' : 'themeSystem')}
							</button>
						))}
					</div>
				</label>

				<label className="set-field">
					<span>{t(language, 'settingsLanguage')}</span>
					<div className="set-seg">
						<button type="button" aria-pressed={language === 'en'} onClick={() => props.onLanguage('en')}>EN</button>
						<button type="button" aria-pressed={language === 'ko'} onClick={() => props.onLanguage('ko')}>한국어</button>
					</div>
				</label>

				<label className="set-field">
					<span>{t(language, 'settingsProvider')}</span>
					<div className="set-seg">
						<button type="button" aria-pressed={provider === 'ollama'} onClick={() => props.onProvider('ollama')}>
							{t(language, 'ollamaTitle')}
						</button>
						<button type="button" aria-pressed={provider === 'openrouter'} onClick={() => props.onProvider('openrouter')}>
							{t(language, 'openrouterTitle')}
						</button>
					</div>
				</label>

				{provider === 'openrouter' && (
					<label className="set-field">
						<span>{t(language, 'settingsKey')}</span>
						<input
							type="password"
							autoComplete="off"
							spellCheck={false}
							value={draftKey}
							placeholder={hasStoredKey ? t(language, 'settingsKeyReplace') : t(language, 'keyPlaceholder')}
							onChange={event => setDraftKey(event.target.value)}
							onBlur={() => {
								if (draftKey.trim()) void saveKey(draftKey);
							}}
						/>
						<p className="ob-note">{t(language, 'leaves')}</p>
						<p className="ob-note">{t(language, 'keyHint')}</p>
						{hasStoredKey && <p className="ob-note sage">{t(language, 'keyStored')}</p>}
						{keyNote && <p className="ob-note">{keyNote}</p>}
						{hasStoredKey && (
							<button type="button" className="ob-btn ghost" onClick={() => void saveKey('')}>
								{t(language, 'settingsRemoveKey')}
							</button>
						)}
					</label>
				)}

				{provider !== 'openrouter' && cloud && (
					<p className="ob-note">{t(language, 'keyHint')}</p>
				)}

				<label className="set-field">
					<span>{t(language, 'settingsModel')}</span>
					<select
						value={model.modelId}
						onChange={event => props.onModel({
							...model,
							modelId: event.target.value,
							selection: 'manual',
							apiKey: '',
						})}
					>
						{!ONBOARDING_MODELS.some(item => item.id === model.modelId) && (
							<option value={model.modelId}>{model.modelId}</option>
						)}
						{ONBOARDING_MODELS.map(item => (
							<option key={item.id} value={item.id}>
								{item.id} · {item.quant} · {t(language, item.sizeKey)}
								{item.minRamGb > 8 ? ` · ${t(language, 'needsRam', { gb: item.minRamGb })}` : ''}
							</option>
						))}
					</select>
				</label>

				{tight && (
					<p className="ob-note">
						{t(language, 'settingsPerf', {
							ctx: model.numCtx ?? TIGHT_NUM_CTX,
							keep: model.keepAlive ?? TIGHT_KEEP_ALIVE,
							threads: model.numThread ?? 4,
						})}
					</p>
				)}

				<div className="set-actions">
					<button type="button" className="ob-btn ghost" onClick={props.onRunSetup}>
						{t(language, 'settingsRunAgain')}
					</button>
					<button type="button" className="ob-btn primary" onClick={props.onClose}>
						{t(language, 'settingsClose')}
					</button>
				</div>
			</div>
		</div>
	);
}
