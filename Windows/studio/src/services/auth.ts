import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { AuthConfig } from '../types';
import {
	COPIX_SUPABASE_ANON_KEY,
	COPIX_SUPABASE_URL,
	normalizeSupabaseUrl,
} from './supabaseConfig';

export interface AuthSession {
	userId: string;
	email?: string;
	displayName: string;
	accessToken?: string;
}

let client: SupabaseClient | null = null;

export function resolveAuthConfig(config?: AuthConfig): AuthConfig {
	const url = normalizeSupabaseUrl(config?.supabaseUrl?.trim() || COPIX_SUPABASE_URL);
	const key = config?.supabaseAnonKey?.trim() || COPIX_SUPABASE_ANON_KEY;
	return {
		provider: 'supabase',
		supabaseUrl: url,
		supabaseAnonKey: key,
	};
}

/** True when Supabase URL and anon key are available (hardcoded defaults count). */
export function isSupabaseConfigured(config?: AuthConfig): boolean {
	const resolved = resolveAuthConfig(config);
	return Boolean(resolved.supabaseUrl && resolved.supabaseAnonKey);
}

export function getSupabase(config?: AuthConfig): SupabaseClient {
	if (!isSupabaseConfigured(config)) {
		throw new Error(
			'Supabase is not configured. Add VITE_COPIX_SUPABASE_URL and VITE_COPIX_SUPABASE_ANON_KEY to studio/.env',
		);
	}
	const resolved = resolveAuthConfig(config);
	const url = resolved.supabaseUrl!;
	const key = resolved.supabaseAnonKey!;
	if (!client) {
		client = createClient(url, key, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: false,
				storageKey: 'copix-supabase-auth',
			},
		});
	}
	return client;
}

function sessionFrom(s: Session | null): AuthSession | null {
	if (!s?.user) return null;
	const meta = s.user.user_metadata as { display_name?: string } | undefined;
	return {
		userId: s.user.id,
		email: s.user.email,
		displayName: meta?.display_name || s.user.email?.split('@')[0] || 'Copix user',
		accessToken: s.access_token,
	};
}

export async function signUpWithEmail(
	config: AuthConfig | undefined,
	email: string,
	password: string,
	displayName?: string,
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
	if (!isSupabaseConfigured(config)) {
		return { ok: false, error: 'Cloud sign-up is not configured for this build.' };
	}
	const sb = getSupabase(config);
	const { data, error } = await sb.auth.signUp({
		email: email.trim(),
		password,
		options: {
			data: { display_name: displayName?.trim() || email.split('@')[0] },
		},
	});
	if (error) return { ok: false, error: error.message };
	const session = sessionFrom(data.session);
	if (!session && data.user) {
		// Email confirmation may be required — still treat as ok with pending session
		return {
			ok: true,
			session: {
				userId: data.user.id,
				email: data.user.email,
				displayName: displayName?.trim() || email.split('@')[0],
			},
			error: data.session ? undefined : 'Check your email to confirm the account, then sign in.',
		};
	}
	return { ok: true, session: session ?? undefined };
}

export async function signInWithEmail(
	config: AuthConfig | undefined,
	email: string,
	password: string,
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
	if (!isSupabaseConfigured(config)) {
		return { ok: false, error: 'Cloud sign-in is not configured for this build.' };
	}
	const sb = getSupabase(config);
	const { data, error } = await sb.auth.signInWithPassword({
		email: email.trim(),
		password,
	});
	if (error) return { ok: false, error: error.message };
	const session = sessionFrom(data.session);
	if (!session) return { ok: false, error: 'No session returned' };
	return { ok: true, session };
}

export async function signOut(config?: AuthConfig): Promise<void> {
	if (!isSupabaseConfigured(config)) return;
	await getSupabase(config).auth.signOut();
}

export async function getRemoteSession(config?: AuthConfig): Promise<AuthSession | null> {
	if (!isSupabaseConfigured(config)) return null;
	const sb = getSupabase(config);
	const { data } = await sb.auth.getSession();
	return sessionFrom(data.session);
}
