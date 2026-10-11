const STORAGE_KEY = 'copix.onboarding.completed';

export function onboardingDoneLocally(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

export function markOnboardingDoneLocally(): void {
	try {
		localStorage.setItem(STORAGE_KEY, '1');
	} catch {
		/* private mode */
	}
}

export function clearOnboardingDoneLocally(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* private mode */
	}
}
