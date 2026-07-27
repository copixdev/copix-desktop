import { formatAgentError } from '../utils/agentErrors';

interface Props {
	error: string;
	onOpenSettings?: () => void;
}

export function AgentErrorCard({ error, onOpenSettings }: Props) {
	const fmt = formatAgentError(error);

	return (
		<div className="agent-error-card">
			<div className="agent-error-head">
				<strong>{fmt.title}</strong>
			</div>
			<p className="agent-error-summary">{fmt.summary}</p>
			{fmt.hints.length > 0 && (
				<ul className="agent-error-hints">
					{fmt.hints.map(h => <li key={h}>{h}</li>)}
				</ul>
			)}
			{fmt.canUseCloud && onOpenSettings && (
				<button type="button" className="btn primary sm agent-error-action" onClick={onOpenSettings}>
					Switch to cloud model
				</button>
			)}
			{fmt.detail && (
				<details className="agent-error-detail">
					<summary>Technical details</summary>
					<pre>{fmt.detail}</pre>
				</details>
			)}
		</div>
	);
}
