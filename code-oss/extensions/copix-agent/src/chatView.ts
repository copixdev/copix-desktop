import * as vscode from 'vscode';
import { formatAgentError } from './utils/agentErrors';

export interface ChatHost {
	send(text: string, post: (message: unknown) => void): Promise<void>;
	stop(): void;
	snapshot(): { provider: string; model: string; ollama: string };
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
	static readonly viewId = 'copix.agent.chat';

	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly host: ChatHost,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		const media = (name: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
		view.webview.html = html(view.webview.cspSource, media('agent.svg').toString(), media('model.svg').toString(), media('ollama.svg').toString(), media('workspace-sync.svg').toString());
		view.webview.onDidReceiveMessage(message => {
			const kind = (message as { type?: string }).type;
			if (kind === 'send') {
				const text = String((message as { text?: string }).text ?? '');
				void this.host.send(text, payload => view.webview.postMessage(payload));
			} else if (kind === 'stop') {
				this.host.stop();
			} else if (kind === 'accept') {
				void vscode.commands.executeCommand('copix.edit.accept', (message as { path?: string }).path);
			} else if (kind === 'reject') {
				void vscode.commands.executeCommand('copix.edit.reject', (message as { path?: string }).path);
			} else if (kind === 'sync') {
				void vscode.commands.executeCommand('copix.workspace.sync');
			}
		});
		this.postState();
	}

	post(message: unknown): void {
		void this.view?.webview.postMessage(message);
	}

	postState(): void {
		this.post({ type: 'state', ...this.host.snapshot() });
	}

	postError(raw: string): void {
		const formatted = formatAgentError(raw);
		this.post({ type: 'error', title: formatted.title, summary: formatted.summary, hints: formatted.hints });
	}
}

function html(csp: string, agent: string, model: string, ollama: string, sync: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
	:root { color-scheme: light dark; --clay: #c4654a; }
	body { margin: 0; font: 13px/1.45 var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); height: 100vh; display: flex; flex-direction: column; }
	header { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
	header img { width: 16px; height: 16px; }
	header .active { filter: none; }
	.icon-btn { border: 0; background: transparent; color: var(--vscode-foreground); padding: 2px; border-radius: 4px; }
	.icon-btn.active, .icon-btn:hover { color: var(--clay); }
	#log { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
	.msg { white-space: pre-wrap; word-break: break-word; }
	.msg.user { align-self: flex-end; background: color-mix(in srgb, var(--clay) 18%, transparent); border-radius: 8px; padding: 6px 8px; max-width: 92%; }
	.msg.tool { font-family: var(--vscode-editor-font-family); font-size: 12px; opacity: 0.85; }
	.pending { display: flex; gap: 6px; align-items: center; }
	.pending button { border: 1px solid var(--clay); background: transparent; color: var(--vscode-foreground); border-radius: 4px; padding: 2px 8px; }
	.pending button.accept { background: var(--clay); color: white; }
	form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-widget-border, transparent); }
	textarea { flex: 1; resize: vertical; min-height: 52px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 6px; font: inherit; }
	button.send { background: var(--clay); color: white; border: 0; border-radius: 6px; padding: 0 12px; }
	.status { font-size: 11px; opacity: 0.75; padding: 0 10px 6px; }
</style>
</head>
<body>
<header>
	<img src="${agent}" alt="" class="active" />
	<strong>Copix Agent</strong>
	<span style="flex:1"></span>
	<button class="icon-btn" id="sync" title="Workspace sync"><img src="${sync}" alt="Workspace sync" width="16" height="16" /></button>
</header>
<div class="status" id="status"></div>
<div id="log"></div>
<form>
	<textarea id="input" placeholder="Ask Copix"></textarea>
	<button class="send" type="submit">Send</button>
</form>
<script>
	const vscode = acquireVsCodeApi();
	const log = document.getElementById('log');
	const status = document.getElementById('status');
	const input = document.getElementById('input');
	const modelIcon = ${JSON.stringify(model)};
	const ollamaIcon = ${JSON.stringify(ollama)};
	function add(className, text) {
		const el = document.createElement('div');
		el.className = 'msg ' + className;
		el.textContent = text;
		log.appendChild(el);
		log.scrollTop = log.scrollHeight;
		return el;
	}
	let stream;
	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'state') {
			status.innerHTML = '<img src="' + modelIcon + '" width="16" height="16" alt="" /> ' + msg.provider + ' · ' + msg.model + '  <img src="' + ollamaIcon + '" width="16" height="16" alt="" /> ' + msg.ollama;
		} else if (msg.type === 'user') {
			stream = undefined;
			add('user', msg.text);
		} else if (msg.type === 'token') {
			if (!stream) stream = add('assistant', '');
			stream.textContent += msg.text;
		} else if (msg.type === 'replace') {
			if (!stream) stream = add('assistant', '');
			stream.textContent = msg.text;
		} else if (msg.type === 'tool') {
			stream = undefined;
			add('tool', msg.text);
		} else if (msg.type === 'pending') {
			const row = document.createElement('div');
			row.className = 'pending';
			row.textContent = msg.path;
			const accept = document.createElement('button');
			accept.className = 'accept';
			accept.textContent = 'Accept';
			accept.onclick = () => vscode.postMessage({ type: 'accept', path: msg.path });
			const reject = document.createElement('button');
			reject.textContent = 'Reject';
			reject.onclick = () => vscode.postMessage({ type: 'reject', path: msg.path });
			row.appendChild(accept);
			row.appendChild(reject);
			log.appendChild(row);
		} else if (msg.type === 'error') {
			stream = undefined;
			add('tool', msg.title + '\\n' + msg.summary + (msg.hints && msg.hints.length ? '\\n' + msg.hints.join('\\n') : ''));
		}
	});
	document.querySelector('form').addEventListener('submit', (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text) return;
		input.value = '';
		vscode.postMessage({ type: 'send', text });
	});
	document.getElementById('sync').addEventListener('click', () => vscode.postMessage({ type: 'sync' }));
</script>
</body>
</html>`;
}
