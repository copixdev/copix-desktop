/** Update PAYMENT_SITE_URL after you deploy `payment-site/` to Netlify. */
export const PAYMENT_SITE_URL = 'https://copix-pay.netlify.app';

/** Toss Bank settlement receiver (card payments settle to this account). */
export const TOSS_BANK = {
	bankName: '토스뱅크 (Toss Bank)',
	accountNumber: '1000-0000-0000', // replace with your Toss account
	accountHolder: 'Copix',
	memoHint: 'Copix Pro / Max + your email',
};

export function paymentUrlForPlan(plan: 'pro' | 'max', email?: string): string {
	const u = new URL(PAYMENT_SITE_URL);
	u.searchParams.set('plan', plan);
	if (email) u.searchParams.set('email', email);
	return u.toString();
}
