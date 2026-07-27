import { useEffect, useState } from 'react';
import type { SubscriptionPlan } from '../types';
import { TOSS_BANK } from '../services/paymentConfig';
import { getPlan } from '../services/subscription';

interface Props {
	open: boolean;
	plan: 'pro' | 'max';
	email?: string;
	onClose: () => void;
}

const CARD_BRANDS = ['Visa', 'Mastercard', 'AMEX', 'JCB', 'UnionPay', 'Local card'] as const;

export function PaymentPage({ open, plan, onClose }: Props) {
	const [brand, setBrand] = useState<string>('Visa');
	const [number, setNumber] = useState('');
	const [expiry, setExpiry] = useState('');
	const [cvc, setCvc] = useState('');
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState('');
	const def = getPlan(plan);

	useEffect(() => {
		if (!open) {
			setDone(false);
			setError('');
			setBusy(false);
		}
	}, [open]);

	if (!open) return null;

	const pay = async () => {
		setError('');
		const digits = number.replace(/\s/g, '');
		if (digits.length < 12 || !expiry.includes('/') || cvc.length < 3 || !name.trim()) {
			setError('Enter a valid card number, expiry, CVC, and name.');
			return;
		}
		setBusy(true);
		try {
			await new Promise(r => setTimeout(r, 900));
			setDone(true);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="payment-overlay" onClick={onClose}>
			<div className="payment-card fade-in" onClick={e => e.stopPropagation()}>
				<span className="payment-pill">{def.label} Plan</span>
				<h2>Card payment</h2>
				<p className="payment-sub">
					Pay with any card. Receiver: <strong>{TOSS_BANK.accountHolder}</strong> · {TOSS_BANK.bankName}
				</p>
				<div className="payment-price">{def.price}<span>/mo</span></div>

				{!done ? (
					<>
						<label className="field-label">Card brand</label>
						<select className="field-input" value={brand} onChange={e => setBrand(e.target.value)}>
							{CARD_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
						</select>
						<label className="field-label">Card number</label>
						<input
							className="field-input"
							inputMode="numeric"
							placeholder="ACCT-000015"
							value={number}
							onChange={e => setNumber(e.target.value.replace(/[^\d\s]/g, '').slice(0, 23))}
						/>
						<div className="payment-grid-2">
							<div>
								<label className="field-label">Expiry</label>
								<input
									className="field-input"
									placeholder="MM/YY"
									value={expiry}
									onChange={e => setExpiry(e.target.value.slice(0, 5))}
								/>
							</div>
							<div>
								<label className="field-label">CVC</label>
								<input
									className="field-input"
									inputMode="numeric"
									placeholder="123"
									value={cvc}
									onChange={e => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
								/>
							</div>
						</div>
						<label className="field-label">Name on card</label>
						<input
							className="field-input"
							placeholder="Full name"
							value={name}
							onChange={e => setName(e.target.value)}
						/>
						{error && <p className="login-error" style={{ textAlign: 'left' }}>{error}</p>}
						<div className="btn-row">
							<button type="button" className="btn primary" disabled={busy} onClick={() => void pay()}>
								{busy ? 'Processing…' : `Pay ${def.price}`}
							</button>
							<button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
						</div>
					</>
				) : (
					<>
						<p className="payment-ok">Payment submitted for {def.label}. We’ll confirm and activate your plan.</p>
						<button type="button" className="btn primary" onClick={onClose}>Done</button>
					</>
				)}
				<p className="payment-note">
					Settlement: Toss Bank · {TOSS_BANK.accountHolder} · {TOSS_BANK.accountNumber}
				</p>
			</div>
		</div>
	);
}

export type PaidPlan = Extract<SubscriptionPlan, 'pro' | 'max'>;
