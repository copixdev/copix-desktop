import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

export function IconLogo(p: P) {
	return (
		<svg viewBox="0 0 24 24" fill="none" {...p}>
			<path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.12" />
			<path d="M12 8v8M8 10l4-2 4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

export function IconPlus(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>;
}

export function IconChat(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconFolder(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" /></svg>;
}

export function IconBrain(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M9.5 4A5.5 5.5 0 004 9.5c0 1.2.4 2.3 1 3.2M14.5 4A5.5 5.5 0 0120 9.5c0 1.2-.4 2.3-1 3.2M9.5 20a5.5 5.5 0 01-5.5-5.5M14.5 20a5.5 5.5 0 005.5-5.5M12 4v16" strokeLinecap="round" /></svg>;
}

export function IconSettings(p: P) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" {...p}>
			<path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
			<path d="M19.4 13a7.6 7.6 0 000-2l1.7-1.3-1.5-2.6-2 .5a7.7 7.7 0 00-1.7-1l-.3-2.1h-3l-.3 2.1a7.7 7.7 0 00-1.7 1l-2-.5-1.5 2.6L4.6 11a7.6 7.6 0 000 2l-1.7 1.3 1.5 2.6 2-.5a7.7 7.7 0 001.7 1l.3 2.1h3l.3-2.1a7.7 7.7 0 001.7-1l2 .5 1.5-2.6L19.4 13z" strokeLinecap="round" />
		</svg>
	);
}

export function IconSend(p: P) {
	return <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M3 11l18-7-7 18-2-8-9-1z" /></svg>;
}

export function IconStop(p: P) {
	return <svg viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}

export function IconPlay(p: P) {
	return <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M8 5v14l11-7z" /></svg>;
}

export function IconFile(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinejoin="round" /><path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" /></svg>;
}

export function IconChevron(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconLink(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" /></svg>;
}

export function IconX(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>;
}

export function IconCode(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconCommand(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M9 9V6a3 3 0 10-3 3h3zm0 0v6m0-6h6m-6 6v3a3 3 0 11-3-3h3zm6-6V6a3 3 0 113 3h-3zm0 0v6m0 0h3a3 3 0 11-3 3v-3z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconSun(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" /></svg>;
}

export function IconMoon(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconMonitor(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8m-4-4v4" strokeLinecap="round" /></svg>;
}

export function IconCloud(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><path d="M17.5 19a4.5 4.5 0 100-9 6 6 0 10-11.4 2.4A3.75 3.75 0 007 19h10.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconSparkle(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6L19 15z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconPanelRight(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></svg>;
}

export function IconGlobe(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" strokeLinecap="round" /></svg>;
}

export function IconTerminal(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconBranch(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M6 8.5v7M8.5 6H15a3 3 0 013 3v0" strokeLinecap="round" /></svg>;
}

export function IconExpand(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function IconCopy(p: P) {
	return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" /></svg>;
}
