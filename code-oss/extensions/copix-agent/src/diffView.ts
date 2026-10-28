import * as vscode from 'vscode';
import type { PendingEdit } from './edits';
import { EditSession } from './edits';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const BEFORE = 'copix-before';
const AFTER = 'copix-after';

function editUri(scheme: string, filePath: string): vscode.Uri {
	return vscode.Uri.from({ scheme, path: filePath });
}

export function registerDiffProviders(edits: EditSession): vscode.Disposable[] {
	const provider = new (class implements vscode.TextDocumentContentProvider {
		private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
		readonly onDidChange = this.emitter.event;
		refresh(filePath: string): void {
			this.emitter.fire(editUri(BEFORE, filePath));
			this.emitter.fire(editUri(AFTER, filePath));
		}
		provideTextDocumentContent(uri: vscode.Uri): string {
			const edit = edits.get(uri.path);
			if (!edit) return '';
			return uri.scheme === BEFORE ? edit.before : edit.after;
		}
	})();

	const lenses = vscode.languages.registerCodeLensProvider({ scheme: AFTER }, {
		provideCodeLenses(document) {
			const edit = edits.get(document.uri.path);
			if (!edit) return [];
			const range = new vscode.Range(0, 0, 0, 0);
			return [
				new vscode.CodeLens(range, {
					title: 'Accept',
					command: 'copix.edit.accept',
					arguments: [edit.path],
					tooltip: 'Write this Copix edit to disk',
				}),
				new vscode.CodeLens(range, {
					title: 'Reject',
					command: 'copix.edit.reject',
					arguments: [edit.path],
					tooltip: 'Discard this Copix edit',
				}),
			];
		},
	});

	return [
		vscode.workspace.registerTextDocumentContentProvider(BEFORE, provider),
		vscode.workspace.registerTextDocumentContentProvider(AFTER, provider),
		lenses,
	];
}

export async function openInlineDiff(edit: PendingEdit): Promise<void> {
	const title = `${path.basename(edit.path)} — Copix`;
	await vscode.commands.executeCommand(
		'vscode.diff',
		editUri(BEFORE, edit.path),
		editUri(AFTER, edit.path),
		title,
		{ preview: false },
	);
	await vscode.commands.executeCommand('setContext', 'copix.hasPendingEdit', true);
}

export async function acceptEdit(edits: EditSession, filePath: string): Promise<void> {
	const edit = edits.accept(filePath);
	if (!edit) return;
	if (edit.kind === 'delete') {
		await fs.rm(edit.path, { force: true });
	} else {
		await fs.mkdir(path.dirname(edit.path), { recursive: true });
		await fs.writeFile(edit.path, edit.after, 'utf8');
	}
	await vscode.commands.executeCommand('setContext', 'copix.hasPendingEdit', edits.all().length > 0);
	await closeDiff(edit.path);
}

export async function rejectEdit(edits: EditSession, filePath: string): Promise<void> {
	const edit = edits.reject(filePath);
	if (!edit) return;
	await vscode.commands.executeCommand('setContext', 'copix.hasPendingEdit', edits.all().length > 0);
	await closeDiff(edit.path);
}

async function closeDiff(filePath: string): Promise<void> {
	const after = editUri(AFTER, filePath).toString();
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input as { original?: vscode.Uri; modified?: vscode.Uri } | undefined;
			if (input?.modified?.toString() === after || input?.original?.toString() === editUri(BEFORE, filePath).toString()) {
				await vscode.window.tabGroups.close(tab, false);
			}
		}
	}
}
