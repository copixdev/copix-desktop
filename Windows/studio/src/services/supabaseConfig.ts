/**
 * Copix cloud backend (Supabase).
 * Keys are loaded from build-time env — never commit real values; see .env.example.
 */
export const COPIX_SUPABASE_URL = import.meta.env.VITE_COPIX_SUPABASE_URL?.trim() ?? '';
export const COPIX_SUPABASE_ANON_KEY = import.meta.env.VITE_COPIX_SUPABASE_ANON_KEY?.trim() ?? '';

/** Normalize pasted URLs that include /rest/v1/ or trailing slashes. */
export function normalizeSupabaseUrl(url: string): string {
	return url
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/rest\/v1$/i, '');
}
