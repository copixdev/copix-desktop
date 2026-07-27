import type { AgentMode, WorkspaceEnvironment } from './models/agentModes';
import type { ChatActivity } from './chatActivity';
import type { AgentAction } from './models/structuredResponse';
import { COPIX_SUPABASE_ANON_KEY, COPIX_SUPABASE_URL } from './services/supabaseConfig';

export type { AgentAction, StructuredAgentResponse } from './models/structuredResponse';

export type { AgentMode, WorkspaceEnvironment };
export type { ChatActivity, ActivityKind, ActivityPhase } from './chatActivity';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: number;
	/** Pasted image data URLs attached to the user message. */
	images?: string[];
	/** Tool/thinking rows shown above the assistant reply (Cursor-style). */
	activities?: ChatActivity[];
	/** Parsed actions from a structured JSON response (for replay / UI). */
	structuredActions?: AgentAction[];
}

export interface EditorTab {
	path: string;
	content: string;
	dirty: boolean;
}

export interface CopixAccount {
	id: string;
	displayName: string;
	email?: string;
	password?: string;
	createdAt: number;
}

export type SubscriptionPlan = 'free' | 'pro' | 'max';

export interface SubscriptionSettings {
	plan: SubscriptionPlan;
	status: 'active' | 'inactive' | 'trial';
}

export interface AuthConfig {
	provider: 'local' | 'supabase';
	supabaseUrl?: string;
	supabaseAnonKey?: string;
}

export interface SystemPromptSettings {
	customRules: string[];
}

export interface LayoutSettings {
	sidebarWidth: number;
	editorWidth: number;
}

export interface WorkspaceSettings {
	/** Default folder for agent output (projects, generated files). */
	homeDirectory: string;
}

export type ThemePreference = 'system' | 'dark' | 'light';

export type ModelProvider = 'local' | 'cloud';

export interface ModelSettings {
	provider: ModelProvider;
	endpoint: string;
	apiKey: string;
	modelId: string;
	tunedModelId: string;
	preferTuned: boolean;
	trainingDataPath: string;
	/** Safer local inference: smaller context, fewer GPU layers (helps 8GB VRAM / CUDA crashes). */
	lowVram?: boolean;
}

export interface ModelSetupSettings {
	completed: boolean;
	skipped: boolean;
}

export interface AppSettings {
	activeAccountId: string;
	accounts: CopixAccount[];
	model: ModelSettings;
	layout: LayoutSettings;
	workspace: WorkspaceSettings;
	theme: ThemePreference;
	agentMode: AgentMode;
	auth: AuthConfig;
	subscription: SubscriptionSettings;
	systemPrompt: SystemPromptSettings;
	modelSetup: ModelSetupSettings;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
	sidebarWidth: 220,
	editorWidth: 420,
};

export const DEFAULT_WORKSPACE: WorkspaceSettings = {
	homeDirectory: '',
};

export const DEFAULT_AUTH: AuthConfig = {
	provider: COPIX_SUPABASE_URL && COPIX_SUPABASE_ANON_KEY ? 'supabase' : 'local',
	supabaseUrl: COPIX_SUPABASE_URL,
	supabaseAnonKey: COPIX_SUPABASE_ANON_KEY,
};

export const DEFAULT_SUBSCRIPTION: SubscriptionSettings = {
	plan: 'free',
	status: 'inactive',
};

export const DEFAULT_SYSTEM_PROMPT: SystemPromptSettings = {
	customRules: [],
};

export const DEFAULT_MODEL: ModelSettings = {
	provider: 'local',
	endpoint: 'http://127.0.0.1:11434/v1',
	apiKey: '',
	modelId: 'gpt-oss:20b',
	tunedModelId: 'copix-core',
	// Prefer Copix Core when registered in Ollama; otherwise fall back to modelId.
	preferTuned: true,
	trainingDataPath: '',
	lowVram: false,
};

export const DEFAULT_CLOUD_ENDPOINT = 'https://your-copix-cloud.onrender.com/v1';

export const DEFAULT_MODEL_SETUP: ModelSetupSettings = {
	completed: false,
	skipped: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
	activeAccountId: 'default',
	accounts: [{
		id: 'default',
		displayName: 'Local user',
		createdAt: Date.now(),
	}],
	model: DEFAULT_MODEL,
	layout: DEFAULT_LAYOUT,
	workspace: DEFAULT_WORKSPACE,
	theme: 'system',
	agentMode: 'code',
	auth: DEFAULT_AUTH,
	subscription: DEFAULT_SUBSCRIPTION,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	modelSetup: DEFAULT_MODEL_SETUP,
};
