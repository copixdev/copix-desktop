import * as vscode from 'vscode';
import {
	mergeSessionStores,
	slimSessionsForDisk,
	type ChatSession,
	type EditorTab,
} from './editorState';

interface OpenBuffer {
	path: string;
	content: string;
	dirty: boolean;
}

/**
 * Code-OSS keeps text models across blur (hot exit, preview tabs off).
 * This guard is the desktop blur fix carried into the new shell: if a tab
 * disappears while the window is unfocused, reopen it and put unsaved text back.
 * A tab the user closed while the window was focused stays closed.
 */
export function watchEditorBlur(context: vscode.ExtensionContext, sessions: () => ChatSession[], save: (next: ChatSession[]) => void): void {
	let openAtBlur: OpenBuffer[] | undefined;

	const snapshot = (): OpenBuffer[] => {
		const buffers: OpenBuffer[] = [];
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const uri = tabUri(tab);
				if (!uri || uri.scheme !== 'file') continue;
				const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
				buffers.push({
					path: uri.fsPath,
					content: document?.getText() ?? '',
					dirty: document?.isDirty ?? false,
				});
			}
		}
		return buffers;
	};

	const flushIntoSessions = (buffers: OpenBuffer[]) => {
		const current = sessions();
		if (!current.length) return;
		const tabs: EditorTab[] = buffers.map(buffer => ({
			path: buffer.path,
			content: buffer.content,
			dirty: buffer.dirty,
		}));
		const live = current[0];
		if (!live) return;
		const nextLive: ChatSession = {
			...live,
			tabs,
			activePath: tabs[0]?.path,
			updatedAt: live.updatedAt,
		};
		save(mergeSessionStores([nextLive], current.slice(1)));
	};

	context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
		if (!state.focused) {
			openAtBlur = snapshot();
			flushIntoSessions(openAtBlur);
			return;
		}
		const previous = openAtBlur;
		openAtBlur = undefined;
		if (!previous?.length) return;
		const stillOpen = new Set(snapshot().map(buffer => buffer.path));
		for (const buffer of previous) {
			if (stillOpen.has(buffer.path)) continue;
			void restoreBuffer(buffer);
		}
	}));
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
	const input = tab.input;
	if (!input || typeof input !== 'object' || !('uri' in input)) return undefined;
	const uri = (input as { uri?: vscode.Uri }).uri;
	return uri;
}

async function restoreBuffer(buffer: OpenBuffer): Promise<void> {
	const uri = vscode.Uri.file(buffer.path);
	const document = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
	if (!buffer.dirty || document.getText() === buffer.content) return;
	const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
	await editor.edit(builder => builder.replace(new vscode.Range(new vscode.Position(0, 0), end), buffer.content));
}

export function historyMirror(sessions: ChatSession[]): string {
	return JSON.stringify(slimSessionsForDisk(sessions));
}
