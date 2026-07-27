import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface Props {
	sidebarWidth: number;
	editorWidth: number;
	editorVisible?: boolean;
	onResize: (sidebar: number, editor: number) => void;
	sidebar: ReactNode;
	chat: ReactNode;
	editor: ReactNode;
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 320;
const EDITOR_MIN = 320;
const EDITOR_MAX = 640;
const CHAT_MIN = 380;
const GUTTER = 4;

export function ResizableLayout({
	sidebarWidth, editorWidth, editorVisible = true, onResize, sidebar, chat, editor,
}: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const dragging = useRef<'sidebar' | 'editor' | null>(null);
	const startX = useRef(0);
	const startSidebar = useRef(0);
	const startEditor = useRef(0);
	const widthsRef = useRef({ sidebar: sidebarWidth, editor: editorWidth });
	widthsRef.current = { sidebar: sidebarWidth, editor: editorWidth };

	const clamp = useCallback((sidebar: number, editor: number) => {
		const total = rootRef.current?.clientWidth ?? 1200;
		const gutters = editorVisible ? GUTTER * 2 : GUTTER;
		const available = Math.max(700, total - gutters);

		let nextSidebar = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(sidebar)));
		let nextEditor = editorVisible
			? Math.max(EDITOR_MIN, Math.min(EDITOR_MAX, Math.round(editor)))
			: 0;

		if (editorVisible) {
			const maxEditor = Math.max(EDITOR_MIN, available - nextSidebar - CHAT_MIN);
			nextEditor = Math.min(nextEditor, maxEditor);
			if (nextSidebar + nextEditor + CHAT_MIN > available) {
				nextSidebar = Math.max(SIDEBAR_MIN, available - nextEditor - CHAT_MIN);
			}
		}

		return { sidebar: nextSidebar, editor: nextEditor };
	}, [editorVisible]);

	const applyClamp = useCallback(() => {
		const { sidebar, editor } = widthsRef.current;
		const fixed = clamp(sidebar, editor);
		if (
			fixed.sidebar !== sidebar
			|| (editorVisible && fixed.editor !== editor)
		) {
			onResize(fixed.sidebar, editorVisible ? fixed.editor : editor);
		}
	}, [clamp, editorVisible, onResize]);

	useEffect(() => {
		applyClamp();
	}, [editorVisible]); // eslint-disable-line react-hooks/exhaustive-deps -- repair on show/hide only

	useEffect(() => {
		const el = rootRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => {
			if (dragging.current) return;
			applyClamp();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [applyClamp]);

	const onMouseDown = useCallback((which: 'sidebar' | 'editor') => (e: React.MouseEvent) => {
		e.preventDefault();
		dragging.current = which;
		startX.current = e.clientX;
		startSidebar.current = sidebarWidth;
		startEditor.current = editorWidth;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		const onMove = (ev: MouseEvent) => {
			const dx = ev.clientX - startX.current;
			if (dragging.current === 'sidebar') {
				const next = clamp(startSidebar.current + dx, startEditor.current);
				onResize(next.sidebar, next.editor);
			} else {
				const next = clamp(startSidebar.current, startEditor.current - dx);
				onResize(next.sidebar, next.editor);
			}
		};
		const onUp = () => {
			dragging.current = null;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			applyClamp();
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}, [applyClamp, clamp, editorWidth, onResize, sidebarWidth]);

	const widths = clamp(sidebarWidth, editorWidth);

	return (
		<div className="layout-resizable" ref={rootRef}>
			<div className="pane-sidebar" style={{ width: widths.sidebar, flex: `0 0 ${widths.sidebar}px` }}>{sidebar}</div>
			<div className="resize-gutter" onMouseDown={onMouseDown('sidebar')} title="Drag to resize" />
			<div className="pane-chat">{chat}</div>
			{editorVisible && (
				<>
					<div className="resize-gutter" onMouseDown={onMouseDown('editor')} title="Drag to resize" />
					<div className="pane-editor" style={{ width: widths.editor, flex: `0 0 ${widths.editor}px` }}>{editor}</div>
				</>
			)}
		</div>
	);
}
