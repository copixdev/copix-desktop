import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; message: string; kind: 'ok' | 'err' | 'info' };

const Ctx = createContext<(msg: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
		const id = Date.now();
		setToasts(t => [...t, { id, message, kind }]);
		setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
	}, []);
	return (
		<Ctx.Provider value={toast}>
			{children}
			<div className="toast-stack">
				{toasts.map(t => (
					<div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
				))}
			</div>
		</Ctx.Provider>
	);
}

export function useToast() {
	return useContext(Ctx);
}
