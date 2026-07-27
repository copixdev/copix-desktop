interface Props {
	content: string;
	images?: string[];
	onReuse?: (content: string) => void;
}

export function UserPromptPill({ content, images, onReuse }: Props) {
	return (
		<div className="user-prompt-pill">
			{images && images.length > 0 && (
				<div className="user-prompt-images">
					{images.map((src, i) => (
						<img key={i} src={src} alt="" className="user-prompt-image" />
					))}
				</div>
			)}
			{content ? <p className="user-prompt-text">{content}</p> : null}
			{onReuse && (
				<button
					type="button"
					className="user-prompt-reuse"
					title="Edit & resend"
					onClick={() => onReuse(content)}
				>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
						<path d="M4 8h8M4 8l3-3M4 8l3 3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			)}
		</div>
	);
}
