import { contextBridge, ipcRenderer } from 'electron';

export interface ServerStatus {
	online: boolean;
	hasModel?: boolean;
	models?: string[];
	missing?: string[];
	provider?: 'ollama' | 'groq';
}

const api = {
	/** Host OS: darwin | win32 | linux */
	platform: process.platform as NodeJS.Platform,
	getPlatform: () => process.platform as NodeJS.Platform,
	getProjectsRoot: () => ipcRenderer.invoke('copix:getProjectsRoot') as Promise<string>,
	browseHomeDirectory: () => ipcRenderer.invoke('copix:browseHomeDirectory') as Promise<string | undefined>,
	createSessionWorkspace: (sessionId: string) => ipcRenderer.invoke('copix:createSessionWorkspace', sessionId),
	createProject: (sessionId: string, name: string, description?: string, outputPath?: string) =>
		ipcRenderer.invoke('copix:createProject', sessionId, name, description, outputPath),
	openFolder: (sessionId?: string) => ipcRenderer.invoke('copix:openFolder', sessionId),
	cloneRepo: (url: string, sessionId?: string) => ipcRenderer.invoke('copix:cloneRepo', url, sessionId),
	getWorkspace: (workspaceRoot: string) => ipcRenderer.invoke('copix:getWorkspace', workspaceRoot),
	getRepoRemote: (workspaceRoot: string) => ipcRenderer.invoke('copix:getRepoRemote', workspaceRoot),
	readFile: (p: string, workspaceRoot?: string) => ipcRenderer.invoke('copix:readFile', p, workspaceRoot),
	writeFile: (p: string, c: string, workspaceRoot?: string) => ipcRenderer.invoke('copix:writeFile', p, c, workspaceRoot),
	deleteFile: (p: string, workspaceRoot?: string) => ipcRenderer.invoke('copix:deleteFile', p, workspaceRoot),
	listDir: (p: string | undefined, workspaceRoot?: string) => ipcRenderer.invoke('copix:listDir', p, workspaceRoot),
	grep: (pattern: string, searchPath?: string, workspaceRoot?: string) =>
		ipcRenderer.invoke('copix:grep', pattern, searchPath, workspaceRoot),
	runTerminal: (cmd: string, workspaceRoot?: string, cwd?: string, elevate?: boolean, streamId?: string) =>
		ipcRenderer.invoke('copix:runTerminal', cmd, workspaceRoot, cwd, elevate, streamId),
	onTerminalOutput: (streamId: string, cb: (chunk: string) => void) => {
		const channel = `copix:terminal:${streamId}`;
		const handler = (_: unknown, chunk: string) => cb(chunk);
		ipcRenderer.on(channel, handler);
		return () => { ipcRenderer.removeListener(channel, handler); };
	},
	getSettings: () => ipcRenderer.invoke('copix:getSettings'),
	setSettings: (s: unknown) => ipcRenderer.invoke('copix:setSettings', s),
	openExternal: (url: string) => ipcRenderer.invoke('copix:openExternal', url),
	openIdeWindow: () => ipcRenderer.invoke('copix:openIdeWindow'),
	getServerStatus: () => ipcRenderer.invoke('copix:getServerStatus') as Promise<ServerStatus>,
	startServer: () => ipcRenderer.invoke('copix:startServer') as Promise<{ ok: boolean; message: string }>,
	pullOllamaModel: (model?: string) => ipcRenderer.invoke('copix:pullOllamaModel', model) as Promise<{ ok: boolean; message: string }>,
	ensureCopixModels: () => ipcRenderer.invoke('copix:ensureCopixModels') as Promise<{ ok: boolean; message: string; pulled: string[] }>,
	onPullProgress: (cb: (line: string) => void) => {
		const handler = (_: unknown, line: string) => cb(line);
		ipcRenderer.on('copix:pullProgress', handler);
		return () => { ipcRenderer.removeListener('copix:pullProgress', handler); };
	},
	onMenuAction: (cb: (action: string) => void) => {
		const handler = (_: unknown, action: string) => cb(action);
		ipcRenderer.on('copix:menuAction', handler);
		return () => { ipcRenderer.removeListener('copix:menuAction', handler); };
	},
};

contextBridge.exposeInMainWorld('copix', api);

export type CopixApi = typeof api;
