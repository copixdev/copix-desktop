import type { ChatMessage } from '../types';
import { formatActivityDisplay } from '../chatActivity';

/** Build LLM history with tool-work summaries so follow-up turns remember prior progress. */
export function chatMessagesToAgentHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
	return messages.map(m => {
		if (m.role !== 'assistant' || !m.activities?.length) {
			return { role: m.role, content: m.content };
		}

		const done = m.activities.filter(a => a.kind !== 'think' && a.phase === 'done');
		if (!done.length) {
			return { role: m.role, content: m.content };
		}

		const work = done.map(a => {
			const label = formatActivityDisplay(a);
			return `- ${[label.verb, label.target].filter(Boolean).join(' ')}`;
		});

		const summary = m.content.trim()
			? `${m.content}\n\n[Work completed in this turn:\n${work.join('\n')}]`
			: `[Work completed in this turn:\n${work.join('\n')}]`;

		return { role: m.role, content: summary };
	});
}
