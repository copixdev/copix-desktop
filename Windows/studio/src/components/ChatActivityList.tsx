import { isVisibleThought, type ChatActivity } from '../chatActivity';
import { ChatActivityRow } from './ChatActivityRow';

interface Props {
	activities: ChatActivity[];
}

export function ChatActivityList({ activities }: Props) {
	const visible = activities.filter(a => a.kind !== 'think' || isVisibleThought(a));
	if (!visible.length) return null;

	return (
		<div className="activity-list" role="list">
			{visible.map(a => (
				<ChatActivityRow key={a.id} activity={a} />
			))}
		</div>
	);
}
