import type { ChatSession } from '../hooks/chatSessions';
import type { AppSettings, ChatMessage } from '../types';
import { SubagentWindow } from './SubagentWindow';

interface Props {
	sessions: ChatSession[];
	settings: AppSettings;
	installedModels: string[];
	serverOnline: boolean;
	onMessagesChange: (sessionId: string, messages: ChatMessage[], title?: string) => void;
	onPendingPromptConsumed: (sessionId: string) => void;
	onDismiss: (sessionId: string) => void;
	onExpand: (sessionId: string) => void;
	onSpawnSubagent?: (prompt: string, label?: string) => Promise<{ sessionId: string }>;
}

export function SubagentDock({
	sessions,
	settings,
	installedModels,
	serverOnline,
	onMessagesChange,
	onPendingPromptConsumed,
	onDismiss,
	onExpand,
	onSpawnSubagent,
}: Props) {
	if (!sessions.length) return null;

	return (
		<div className="subagent-dock" aria-label="Subagents">
			{sessions.map(s => (
				<SubagentWindow
					key={s.id}
					session={s}
					settings={settings}
					installedModels={installedModels}
					serverOnline={serverOnline}
					onMessagesChange={onMessagesChange}
					onPendingPromptConsumed={onPendingPromptConsumed}
					onDismiss={onDismiss}
					onExpand={onExpand}
					onSpawnSubagent={onSpawnSubagent}
				/>
			))}
		</div>
	);
}
