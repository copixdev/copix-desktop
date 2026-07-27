import { contextBridge, ipcRenderer } from 'electron';

export interface TrainingStatus {
	status: 'idle' | 'running' | 'completed' | 'error';
	epoch?: number;
	total_epochs?: number;
	step?: number;
	total_steps?: number;
	loss?: number | null;
	message?: string;
	history?: Array<{ epoch: number; loss: number }>;
	adapter_path?: string;
	merged_path?: string;
	base_model?: string;
	error_type?: string;
	failed_step?: string;
	detail?: string;
}

export type SetupPhase =
	| 'idle'
	| 'checking_ollama'
	| 'pulling'
	| 'installing_deps'
	| 'building_dataset'
	| 'training'
	| 'exporting'
	| 'done'
	| 'error';

export interface SetupProgress {
	phase: SetupPhase;
	message: string;
	training?: TrainingStatus;
	failedStep?: Exclude<SetupPhase, 'idle' | 'done' | 'error'>;
	errorType?: string;
	detail?: string;
}

export interface SetupResult {
	ok: boolean;
	message: string;
	failedStep?: Exclude<SetupPhase, 'idle' | 'done' | 'error'>;
	errorType?: string;
	detail?: string;
}

export interface ServerStatus {
	online: boolean;
	adapter?: boolean;
	hasBase?: boolean;
	hasTuned?: boolean;
	models?: string[];
}

const api = {
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
	getCoreRoot: () => ipcRenderer.invoke('copix:getCoreRoot') as Promise<string>,
	getServerStatus: () => ipcRenderer.invoke('copix:getServerStatus') as Promise<ServerStatus>,
	startServer: () => ipcRenderer.invoke('copix:startServer') as Promise<{ ok: boolean; message: string; adapter?: boolean }>,
	pullOllamaModel: (model?: string) => ipcRenderer.invoke('copix:pullOllamaModel', model) as Promise<{ ok: boolean; message: string }>,
	exportToOllama: () => ipcRenderer.invoke('copix:exportToOllama') as Promise<{ ok: boolean; message: string }>,
	stopServer: () => ipcRenderer.invoke('copix:stopServer'),
	buildDataset: () => ipcRenderer.invoke('copix:buildDataset') as Promise<{ ok: boolean; message: string }>,
	startTraining: (epochs?: number) => ipcRenderer.invoke('copix:startTraining', epochs) as Promise<{ ok: boolean; message: string }>,
	stopTraining: () => ipcRenderer.invoke('copix:stopTraining'),
	getTrainingStatus: () => ipcRenderer.invoke('copix:getTrainingStatus') as Promise<TrainingStatus>,
	runCoreSetup: () => ipcRenderer.invoke('copix:runCoreSetup') as Promise<{ ok: boolean; message: string }>,
	runModelSetup: (epochs?: number) => ipcRenderer.invoke('copix:runModelSetup', epochs) as Promise<SetupResult>,
	cancelModelSetup: () => ipcRenderer.invoke('copix:cancelModelSetup') as Promise<{ ok: boolean }>,
	getSetupProgress: () => ipcRenderer.invoke('copix:getSetupProgress') as Promise<SetupProgress>,
	onSetupProgress: (cb: (p: SetupProgress) => void) => {
		const handler = (_: unknown, data: SetupProgress) => cb(data);
		ipcRenderer.on('copix:setupProgress', handler);
		return () => { ipcRenderer.removeListener('copix:setupProgress', handler); };
	},
	onTrainingProgress: (cb: (s: TrainingStatus) => void) => {
		const handler = (_: unknown, data: TrainingStatus) => cb(data);
		ipcRenderer.on('copix:trainingProgress', handler);
		return () => { ipcRenderer.removeListener('copix:trainingProgress', handler); };
	},
	onPullProgress: (cb: (line: string) => void) => {
		const handler = (_: unknown, line: string) => cb(line);
		ipcRenderer.on('copix:pullProgress', handler);
		return () => { ipcRenderer.removeListener('copix:pullProgress', handler); };
	},
};

contextBridge.exposeInMainWorld('copix', api);

export type CopixApi = typeof api;
