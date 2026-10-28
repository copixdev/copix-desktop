import { app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

/**
 * OpenRouter API key storage.
 *
 * The plaintext key is encrypted with Electron safeStorage and written to
 * ~/Copix/openrouter-key.bin. safeStorage keeps its encryption key in the
 * macOS Keychain and uses Windows DPAPI (Credential Manager's OS protection).
 * settings.json only ever stores an empty apiKey string.
 *
 * Do not log the key, the ciphertext, or JSON that still contains it.
 */

function copixDir(): string {
	return path.join(app.getPath('home'), 'Copix');
}

export function providerSecretPath(): string {
	return path.join(copixDir(), 'openrouter-key.bin');
}

export async function saveProviderSecret(secret: string): Promise<{ ok: boolean; message?: string }> {
	const trimmed = secret.trim();
	if (!trimmed) {
		await clearProviderSecret();
		return { ok: true };
	}
	if (!safeStorage.isEncryptionAvailable()) {
		return { ok: false, message: 'Secure storage is unavailable on this computer' };
	}
	const encrypted = safeStorage.encryptString(trimmed);
	await fs.mkdir(copixDir(), { recursive: true });
	const file = providerSecretPath();
	await fs.writeFile(file, encrypted, { mode: 0o600 });
	try {
		await fs.chmod(file, 0o600);
	} catch {
		/* Windows ignores POSIX modes. */
	}
	return { ok: true };
}

export async function readProviderSecret(): Promise<string> {
	const file = providerSecretPath();
	if (!fsSync.existsSync(file)) return '';
	if (!safeStorage.isEncryptionAvailable()) return '';
	try {
		const buf = await fs.readFile(file);
		const value = safeStorage.decryptString(buf);
		return typeof value === 'string' ? value.trim() : '';
	} catch {
		console.error('[copix] Could not read the OpenRouter key from secure storage');
		return '';
	}
}

export async function clearProviderSecret(): Promise<void> {
	const file = providerSecretPath();
	try {
		await fs.unlink(file);
	} catch {
		/* already absent */
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * Pull a plaintext apiKey out of a settings object, store it, and blank the field.
 * The returned object is what may be written to settings.json.
 */
export async function absorbPlainProviderKey(settings: unknown): Promise<{ settings: unknown; changed: boolean }> {
	const root = asRecord(settings);
	if (!root) return { settings, changed: false };
	const model = asRecord(root.model);
	if (!model) return { settings, changed: false };
	const plain = typeof model.apiKey === 'string' ? model.apiKey.trim() : '';
	const changed = model.apiKey !== '';
	if (!changed && !plain) return { settings, changed: false };
	if (plain) {
		const saved = await saveProviderSecret(plain);
		if (!saved.ok) {
			console.error('[copix] Refused to keep a provider key in settings.json because secure storage is unavailable');
		}
	}
	return {
		settings: { ...root, model: { ...model, apiKey: '' } },
		changed: true,
	};
}

/** settings.json writer. apiKey is forced empty even if a caller forgot to strip it. */
export function stringifySettings(value: unknown): string {
	return JSON.stringify(value, (key, v) => (key === 'apiKey' ? '' : v), 2);
}
