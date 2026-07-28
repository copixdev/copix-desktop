import type { ChatMessage } from '../types';
import { formatActivityDisplay } from '../chatActivity';

/** Build LLM history with tool-work summaries so follow-up turns remember prior progress. */
export function chatMessagesToAgentHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
	return messages.map(m => {
		const baseContent = typeof m.content === 'string' ? m.content : String(m.content ?? '');
		if (m.role !== 'assistant' || !m.activities?.length) {
			return { role: m.role, content: baseContent };
		}

		const done = m.activities.filter(a => a.kind !== 'think' && a.phase === 'done');
		if (!done.length) {
			return { role: m.role, content: baseContent };
		}

		const work = done.map(a => {
			const label = formatActivityDisplay(a);
			return `- ${[label.verb, label.target].filter(Boolean).join(' ')}`;
		});

		const summary = baseContent.trim()
			? `${baseContent}\n\n[Work completed in this turn:\n${work.join('\n')}]`
			: `[Work completed in this turn:\n${work.join('\n')}]`;

		return { role: m.role, content: summary };
	});
}
