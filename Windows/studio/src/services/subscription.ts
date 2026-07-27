import type { SubscriptionPlan, SubscriptionSettings } from '../types';

export interface PlanDef {
	id: SubscriptionPlan;
	label: string;
	price: string;
	features: string[];
}

export const PLANS: PlanDef[] = [
	{
		id: 'free',
		label: 'Free',
		price: '$0',
		features: ['Local gpt-oss', 'Desktop workspaces', 'Basic agent tools'],
	},
	{
		id: 'pro',
		label: 'Pro',
		price: '$20/mo',
		features: ['Cloud sync', 'Priority inference', 'GitHub workspaces', 'Extended context'],
	},
	{
		id: 'max',
		label: 'Max',
		price: '$60/mo',
		features: ['Everything in Pro', 'Max model tier', 'Cloud sandboxes', 'Team rules & prompts'],
	},
];

export function getPlan(id: SubscriptionPlan): PlanDef {
	return PLANS.find(p => p.id === id) ?? PLANS[0];
}

/** Stub — replace with Stripe/Supabase billing webhook handler. */
export async function fetchSubscription(_userId?: string): Promise<SubscriptionSettings> {
	return { plan: 'free', status: 'inactive' };
}

export function canUseFeature(plan: SubscriptionPlan, feature: 'cloud' | 'github' | 'max-model'): boolean {
	if (plan === 'max') return true;
	if (plan === 'pro') return feature !== 'max-model';
	return feature === 'github' || feature === 'cloud' ? false : true;
}
