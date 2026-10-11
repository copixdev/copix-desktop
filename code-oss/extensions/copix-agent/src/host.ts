export interface ProjectCreated {
	root: string;
	tree: string[];
}

/** File, terminal, and project operations the agent router calls. */
export interface CopixHost {
	readFile(filePath: string, workspace: string): Promise<string>;
	writeFile(filePath: string, content: string, workspace: string): Promise<string>;
	deleteFile(filePath: string, workspace: string): Promise<string>;
	listDir(dirPath: string | undefined, workspace: string): Promise<string[]>;
	grep(pattern: string, searchPath: string | undefined, workspace: string): Promise<string>;
	createProject(sessionId: string, name: string, description?: string, outputPath?: string): Promise<ProjectCreated>;
	runTerminal(command: string, workspace: string, cwd: string, elevate: boolean, streamId: string): Promise<string>;
	onTerminalStart?(streamId: string, command: string, cwd: string): void;
	onTerminalOutput?(streamId: string, chunk: string): void;
	onTerminalEnd?(streamId: string, result: string): void;
}

let host: CopixHost | undefined;

export function setCopixHost(next: CopixHost): void {
	host = next;
}

export function getCopixHost(): CopixHost {
	if (!host) {
		throw new Error('Copix agent host is not ready');
	}
	return host;
}
