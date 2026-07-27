import type { ChatActivity } from '../chatActivity';
import { ChatActivityRow } from './ChatActivityRow';

interface Props {
	activities: ChatActivity[];
}

export function ChatActivityList({ activities }: Props) {
	if (!activities.length) return null;

	return (
		<div className="activity-list" role="list">
			{activities.map(a => (
				<ChatActivityRow key={a.id} activity={a} />
			))}
		</div>
	);
}
