export type Provider = "copilot" | "ollama";

export interface IAgentSession {
  readonly name: string;
  readonly color: string;
  send(text: string, label: string, opts?: { silent?: boolean }): Promise<string>;
  close(): Promise<void>;
}

export interface AgentConfig {
  name: string;
  cwd?: string;
  role?: string;
  mcpServers?: unknown[];
}

export interface OrchestratorConfig {
  agents: AgentConfig[];
  maxRounds: number;
}

export interface ConversationParams {
  question: string;
  agents: AgentConfig[];
  maxRounds: number;
  provider: Provider;
  ollamaModel: string;
  ollamaUrl: string;
  timeoutMs: number;
  noSynopsis: boolean;
  outputJson: boolean;
}

export interface TurnUsage {
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedMs: number;
}
