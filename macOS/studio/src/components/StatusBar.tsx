import { IconFolder } from './Icons';

interface Props {
	workspace?: string;
	model: string;
	provider?: 'ollama' | 'groq' | 'openrouter' | 'openai';
	online: boolean;
}

function providerLabel(provider: NonNullable<Props['provider']>): string {
	switch (provider) {
		case 'ollama': return 'Ollama';
		case 'groq': return 'Groq';
		case 'openrouter': return 'OpenRouter';
		case 'openai': return 'OpenAI';
		default: return 'Ollama';
	}
}

export function StatusBar({ workspace, model, provider = 'ollama', online }: Props) {
	const modelLabel = `${providerLabel(provider)} · ${model}`;
	return (
		<footer className="statusbar">
			<div className="statusbar-left">
				{workspace && (
					<span className="status-item" title={workspace}>
						<IconFolder width={12} height={12} />
						{shortPath(workspace)}
					</span>
				)}
			</div>
			<div className="statusbar-right">
				<span className="status-item" title="Model from ~/Copix/settings.json">
					<span className={`status-dot ${online ? 'on' : 'off'}`} />
					{modelLabel}
				</span>
			</div>
		</footer>
	);
}

function shortPath(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
