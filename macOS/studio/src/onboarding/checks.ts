/** Live setup probes. Times out in the main process; never includes secrets. */
export interface SetupChecks {
	ollamaOnline: boolean;
	models: string[];
	hasModel: boolean;
	folderExists: boolean;
	folderLabel: string;
	cliAvailable: boolean;
	ramGb: number;
	cpuCount: number;
}

export const EMPTY_CHECKS: SetupChecks = {
	ollamaOnline: false,
	models: [],
	hasModel: false,
	folderExists: false,
	folderLabel: '~/Copix',
	cliAvailable: false,
	ramGb: 0,
	cpuCount: 0,
};
