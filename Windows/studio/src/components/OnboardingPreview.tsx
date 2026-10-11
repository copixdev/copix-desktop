import { useMemo, useState } from 'react';
import type { SetupChecks } from '../onboarding/checks';
import { applyPerformance, recommendedModel } from '../onboarding/recommend';
import { DEFAULT_MODEL, type AppLanguage, type ModelSettings, type ThemePreference } from '../types';
import { Onboarding, type OnboardingStep } from './Onboarding';
import { SettingsPanel } from './SettingsPanel';

const STEPS: OnboardingStep[] = ['look', 'provider', 'check', 'tour', 'try'];

function checksFor(mode: string): SetupChecks {
	const online = mode === 'online';
	return {
		ollamaOnline: online,
		models: online ? ['qwen2.5:3b'] : [],
		hasModel: online,
		folderExists: online,
		folderLabel: '~/Copix',
		cliAvailable: false,
		ramGb: 8,
		cpuCount: 4,
	};
}

/** Browser-only render of one wizard step. Used by `?onboardingPreview=1`. */
export function OnboardingPreview() {
	const query = useMemo(() => new URLSearchParams(window.location.search), []);
	const requested = query.get('step');
	const initialStep = STEPS.includes(requested as OnboardingStep) ? requested as OnboardingStep : 'look';
	const [language, setLanguage] = useState<AppLanguage>(query.get('lang') === 'ko' ? 'ko' : 'en');
	const themeQuery = query.get('theme');
	const [theme, setTheme] = useState<ThemePreference>(
		themeQuery === 'light' || themeQuery === 'system' || themeQuery === 'dark' ? themeQuery : 'system',
	);
	const [provider, setProvider] = useState<'ollama' | 'openrouter'>(
		query.get('provider') === 'openrouter' ? 'openrouter' : 'ollama',
	);
	const checks = checksFor(query.get('checks') ?? 'offline');
	const [hasStoredKey, setHasStoredKey] = useState(query.get('masked') === '1');
	const [model, setModel] = useState<ModelSettings>(() => applyPerformance(
		{ ...DEFAULT_MODEL, provider },
		checks.ramGb,
		checks.cpuCount,
		recommendedModel(checks.ramGb).id,
	));

	if (query.get('step') === 'settings') {
		return (
			<>
				<SettingsPanel
					language={language}
					theme={theme}
					provider={provider}
					model={model}
					hasStoredKey={hasStoredKey}
					onLanguage={setLanguage}
					onTheme={setTheme}
					onProvider={setProvider}
					onModel={setModel}
					onSaveKey={async key => {
						setHasStoredKey(key.trim().length > 0);
						return { ok: true };
					}}
					onRunSetup={() => undefined}
					onClose={() => undefined}
				/>
			</>
		);
	}

	return (
		<Onboarding
			language={language}
			theme={theme}
			provider={provider}
			model={model}
			hasStoredKey={false}
			initialStep={initialStep}
			initialSlide={Number(query.get('slide') || 0)}
			previewChecks={checks}
			previewKey={query.get('masked') === '1' ? 'not-a-real-key' : ''}
			onLanguage={setLanguage}
			onTheme={setTheme}
			onProvider={setProvider}
			onModel={setModel}
			onSaveKey={async () => ({ ok: true })}
			onComplete={() => undefined}
			onSkip={() => undefined}
		/>
	);
}
