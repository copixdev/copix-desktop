import type { AppSettings, CopixAccount, SubscriptionPlan, SubscriptionSettings } from '../types';
import { getRemoteSession, getSupabase, resolveAuthConfig } from './auth';

export interface ProfileRow {
	id: string;
	email?: string | null;
	display_name?: string | null;
	plan?: string | null;
	plan_status?: string | null;
}

function activeAccount(settings: AppSettings): CopixAccount | undefined {
	return settings.accounts.find(a => a.id === settings.activeAccountId) ?? settings.accounts[0];
}

function asPlan(v: string | null | undefined): SubscriptionPlan {
	if (v === 'pro' || v === 'max' || v === 'free') return v;
	return 'free';
}

function asStatus(v: string | null | undefined): SubscriptionSettings['status'] {
	if (v === 'active' || v === 'inactive' || v === 'trial') return v;
	return 'inactive';
}

/** Ensure a profile row exists for the signed-in user (trigger may have created it). */
export async function ensureProfile(settings: AppSettings): Promise<ProfileRow | null> {
	const session = await getRemoteSession(settings.auth);
	if (!session) return null;
	const sb = getSupabase(settings.auth);
	const acc = activeAccount(settings);

	const { data: existing } = await sb
		.from('copix_profiles')
		.select('id,email,display_name,plan,plan_status')
		.eq('id', session.userId)
		.maybeSingle();

	if (existing) return existing as ProfileRow;

	const row = {
		id: session.userId,
		email: session.email ?? acc?.email ?? null,
		display_name: acc?.displayName || session.displayName,
		plan: settings.subscription.plan,
		plan_status: settings.subscription.status,
	};

	const { data, error } = await sb
		.from('copix_profiles')
		.upsert(row, { onConflict: 'id' })
		.select('id,email,display_name,plan,plan_status')
		.maybeSingle();

	if (error) {
		console.warn('[copix] ensureProfile', error.message);
		return null;
	}
	return data as ProfileRow | null;
}

/** Push display name + plan to Supabase (password never stored in our table). */
export async function pushProfileToSupabase(settings: AppSettings): Promise<void> {
	const resolved = resolveAuthConfig(settings.auth);
	if (!resolved.supabaseUrl) return;
	const session = await getRemoteSession(settings.auth);
	if (!session) return;

	const sb = getSupabase(settings.auth);
	const acc = activeAccount(settings);
	const { error } = await sb.from('copix_profiles').upsert({
		id: session.userId,
		email: session.email ?? acc?.email ?? null,
		display_name: acc?.displayName || session.displayName,
		plan: settings.subscription.plan,
		plan_status: settings.subscription.status,
		updated_at: new Date().toISOString(),
	}, { onConflict: 'id' });

	if (error) console.warn('[copix] pushProfile', error.message);
}

/** Pull profile from Supabase into local settings shape. */
export async function pullProfileFromSupabase(settings: AppSettings): Promise<Partial<AppSettings> | null> {
	const session = await getRemoteSession(settings.auth);
	if (!session) return null;

	const row = await ensureProfile(settings);
	if (!row) {
		return {
			activeAccountId: session.userId,
			accounts: [{
				id: session.userId,
				displayName: session.displayName,
				email: session.email,
				createdAt: Date.now(),
			}],
			auth: resolveAuthConfig(settings.auth),
		};
	}

	const account: CopixAccount = {
		id: session.userId,
		displayName: row.display_name || session.displayName,
		email: row.email || session.email,
		createdAt: Date.now(),
	};

	return {
		activeAccountId: session.userId,
		accounts: [account],
		auth: resolveAuthConfig(settings.auth),
		subscription: {
			plan: asPlan(row.plan),
			status: asStatus(row.plan_status),
		},
	};
}
