import * as acp from "@agentclientprotocol/sdk";
import { spawn, ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as path from "node:path";
import { AgentConfig, IAgentSession } from "./types";
import { agentColor, C } from "./colors";
import { TokenTracker } from "./logger";
import { stripThinkTags } from "./prompts";

export const COPILOT_BIN = process.env.COPILOT_BIN ?? "copilot";

export class AgentSession implements IAgentSession {
  readonly name: string;
  readonly cwd: string;
  readonly color: string;

  private _buffer = "";
  private _onChunk: (s: string) => void = () => {};
  private _tracker: TokenTracker;
  private _timeoutMs: number;

  connection!: acp.ClientSideConnection;
  sessionId!: string;
  proc!: ChildProcess;

  readonly client: acp.Client;

  constructor(config: AgentConfig, color: string, tracker: TokenTracker, timeoutMs: number) {
    this.name = config.name;
    this.cwd = path.resolve(config.cwd ?? process.cwd());
    this.color = color;
    this._tracker = tracker;
    this._timeoutMs = timeoutMs;
    this.client = {
      requestPermission: async (params) => {
        const first = params.options?.[0];
        if (first) return { outcome: { outcome: "selected" as const, optionId: first.optionId } };
        return { outcome: { outcome: "cancelled" as const } };
      },
      sessionUpdate: async (params) => {
        const u = params.update;
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
          this._buffer += u.content.text;
          this._onChunk(u.content.text);
        }
      },
    };
  }

  async send(text: string, label: string, opts: { silent?: boolean } = {}): Promise<string> {
    const t0 = Date.now();
    this._buffer = "";
    this._onChunk = opts.silent ? () => {} : (s) => process.stdout.write(s);

    const promptPromise = this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[${this.name}] timed out after ${this._timeoutMs / 1000}s`)),
        this._timeoutMs
      )
    );
    const result = await Promise.race([promptPromise, timeoutPromise]);

    this._onChunk = () => {};
    if (!opts.silent) console.log();

    const elapsedMs = Date.now() - t0;
    const usage = (result as { usage?: { inputTokens: number; outputTokens: number; totalTokens: number } | null }).usage;
    if (usage) {
      this._tracker.record(`${this.name} — ${label}`, usage, elapsedMs);
    } else {
      this._tracker.record(`${this.name} — ${label}`, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, elapsedMs);
    }

    return this._buffer;
  }

  async close() {
    this.proc.stdin?.end();
    this.proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      this.proc.once("exit", () => resolve());
      setTimeout(resolve, 2_000);
    });
  }
}

export class OllamaAgentSession implements IAgentSession {
  readonly name: string;
  readonly color: string;

  private _messages: Array<{ role: string; content: string }> = [];
  private _tracker: TokenTracker;
  private _timeoutMs: number;
  private _model: string;
  private _url: string;

  constructor(config: AgentConfig, color: string, tracker: TokenTracker, timeoutMs: number, model: string, url: string) {
    this.name = config.name;
    this.color = color;
    this._tracker = tracker;
    this._timeoutMs = timeoutMs;
    this._model = model;
    this._url = url.replace(/\/$/, "");
  }

  async send(text: string, label: string, opts: { silent?: boolean } = {}): Promise<string> {
    const t0 = Date.now();
    this._messages.push({ role: "user", content: text });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const response = await fetch(`${this._url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this._model,
          messages: this._messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama ${response.status}: ${body}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let leftover = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = leftover + decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        leftover = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const content: string | undefined = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              if (!opts.silent) process.stdout.write(content);
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens ?? 0;
              completionTokens = parsed.usage.completion_tokens ?? 0;
            }
          } catch {
            // partial / malformed SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if ((err as { name?: string }).name === "AbortError") {
        throw new Error(`[${this.name}] timed out after ${this._timeoutMs / 1000}s`);
      }
      throw err;
    }

    clearTimeout(timeoutId);
    if (!opts.silent) console.log();

    this._messages.push({ role: "assistant", content: fullText });

    const elapsedMs = Date.now() - t0;
    this._tracker.record(
      `${this.name} — ${label}`,
      { inputTokens: promptTokens, outputTokens: completionTokens, totalTokens: promptTokens + completionTokens },
      elapsedMs
    );

    return stripThinkTags(fullText);
  }

  async close(): Promise<void> {
    // No subprocess — nothing to clean up.
  }
}

export async function ensureOllamaRunning(url: string): Promise<void> {
  const base = url.replace(/\/$/, "");

  const isUp = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  };

  if (await isUp()) return;

  console.log(`${C.yellow}⚠ Ollama is not running. Attempting to start it...${C.reset}`);
  try {
    spawn("ollama", ["serve"], { stdio: "ignore", detached: true }).unref();
  } catch {
    console.error(
      `\n${C.yellow}✗ Could not start Ollama automatically.${C.reset}\n\n` +
        `  Make sure Ollama is installed: ${C.cyan}https://ollama.com${C.reset}\n` +
        `  Then start it with:            ${C.cyan}ollama serve${C.reset}\n`
    );
    process.exit(1);
  }

  process.stdout.write(`${C.dim}  Waiting for Ollama to start`);
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    process.stdout.write(".");
    if (await isUp()) {
      console.log(` ${C.green}ready!${C.reset}`);
      return;
    }
  }
  console.log();

  console.error(
    `\n${C.yellow}✗ Ollama didn't respond after 8 seconds.${C.reset}\n\n` +
      `  Try starting it manually in another terminal:\n` +
      `    ${C.cyan}ollama serve${C.reset}\n\n` +
      `  Then re-run this app.\n`
  );
  process.exit(1);
}

export async function createAgent(
  config: AgentConfig,
  index: number,
  tracker: TokenTracker,
  timeoutMs: number,
  provider: "copilot" | "ollama",
  ollamaOpts: { model: string; url: string }
): Promise<IAgentSession> {
  if (provider === "ollama") {
    return new OllamaAgentSession(config, agentColor(index), tracker, timeoutMs, ollamaOpts.model, ollamaOpts.url);
  }

  const proc = spawn(COPILOT_BIN, ["--acp", "--stdio"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  if (!proc.stdin || !proc.stdout) {
    throw new Error(`Failed to open stdio pipes for ${config.name}`);
  }

  proc.on("error", (err: Error) => {
    throw new Error(
      `${config.name} process error: ${err.message}\n` +
        `Is '${COPILOT_BIN}' installed and on PATH? Override with COPILOT_BIN env var.`
    );
  });

  const session = new AgentSession(config, agentColor(index), tracker, timeoutMs);
  session.proc = proc;

  const output = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;

  session.connection = new acp.ClientSideConnection(
    () => session.client,
    acp.ndJsonStream(output, input)
  );

  await session.connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });

  const { sessionId } = await session.connection.newSession({
    cwd: session.cwd,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: (config.mcpServers as any[]) ?? [],
  });

  session.sessionId = sessionId;
  return session;
}
