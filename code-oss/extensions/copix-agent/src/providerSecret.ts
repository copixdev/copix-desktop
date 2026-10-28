/**
 * OpenRouter API key policy.
 *
 * The desktop shell stores the key in VS Code SecretStorage, which uses the
 * macOS Keychain, Windows Credential Manager (DPAPI), or libsecret on Linux.
 * settings.json only ever stores an empty apiKey string.
 *
 * Do not log the key or JSON that still contains it.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export interface AbsorbedKey {
	settings: unknown;
	apiKey: string;
	changed: boolean;
}

/** Pull a plaintext apiKey out of settings. The returned object may be written to disk. */
export function absorbPlainProviderKey(settings: unknown): AbsorbedKey {
	const root = asRecord(settings);
	if (!root) return { settings, apiKey: '', changed: false };
	const model = asRecord(root.model);
	if (!model) return { settings, apiKey: '', changed: false };
	const plain = typeof model.apiKey === 'string' ? model.apiKey.trim() : '';
	const changed = model.apiKey !== '';
	if (!changed && !plain) return { settings, apiKey: '', changed: false };
	return {
		settings: { ...root, model: { ...model, apiKey: '' } },
		apiKey: plain,
		changed: true,
	};
}

/** settings.json writer. apiKey is forced empty even if a caller forgot to strip it. */
export function stringifySettings(value: unknown): string {
	return JSON.stringify(value, (key, v) => (key === 'apiKey' ? '' : v), 2);
}
