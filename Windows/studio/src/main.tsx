import '@fontsource-variable/nunito';
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/copix.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('[copix] React render error:', error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<div style={{ padding: 32, color: '#f4f4f5', background: '#0f0f10', fontFamily: 'Segoe UI, sans-serif' }}>
					<h1 style={{ fontSize: 18, marginBottom: 12 }}>Copix Studio failed to start</h1>
					<pre style={{ color: '#f87171', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
				</div>
			);
		}
		return this.props.children;
	}
}

function bootstrap() {
	const rootEl = document.getElementById('root');
	if (!rootEl) {
		console.error('[copix] #root element not found — cannot mount React');
		return;
	}

	if (!window.copix) {
		console.error('[copix] window.copix is missing — preload script did not expose the API');
	}

	console.log('[copix] Mounting React app');
	createRoot(rootEl).render(
		<StrictMode>
			<RootErrorBoundary>
				<App />
			</RootErrorBoundary>
		</StrictMode>,
	);
}

try {
	bootstrap();
} catch (err) {
	console.error('[copix] Bootstrap failed:', err);
}
