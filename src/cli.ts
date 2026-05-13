import * as fs from "node:fs";
import * as path from "node:path";
import { AgentConfig, OrchestratorConfig, Provider } from "./types";
import { C } from "./colors";

export const DEFAULT_MAX_ROUNDS = 8;

export function parseArgs(): {
  config: OrchestratorConfig;
  question: string | null;
  dryRun: boolean;
  noSynopsis: boolean;
  outputJson: boolean;
  timeoutMs: number;
  help: boolean;
  provider: Provider | null;
  ollamaModel: string | null;
  ollamaUrl: string;
} {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      config: { agents: [], maxRounds: 0 },
      question: null,
      dryRun: false,
      noSynopsis: false,
      outputJson: false,
      timeoutMs: 0,
      help: true,
      provider: null,
      ollamaModel: null,
      ollamaUrl: "",
    };
  }

  let configFile: string | undefined;
  let roundsOverride: number | undefined;
  let dryRun = false;
  let noSynopsis = false;
  let outputJson = false;
  let provider: Provider | null = process.env.PROVIDER as Provider | null ?? null;
  let ollamaModel: string | null = process.env.OLLAMA_MODEL ?? null;
  let ollamaUrl: string = process.env.OLLAMA_URL ?? "http://localhost:11434";
  let timeoutMs = process.env.AGENT_TIMEOUT
    ? parseInt(process.env.AGENT_TIMEOUT, 10) * 1000
    : 120_000;
  const inlineAgents: AgentConfig[] = [];
  const agentDirs: string[] = [];
  const questionParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) {
      configFile = argv[++i];
    } else if (arg === "--agent" && argv[i + 1]) {
      const raw = argv[++i];
      const firstColon = raw.indexOf(":");
      if (firstColon === -1) {
        inlineAgents.push({ name: raw.trim() });
      } else {
        const name = raw.slice(0, firstColon).trim();
        const rest = raw.slice(firstColon + 1);
        const secondColon = rest.indexOf(":");
        if (secondColon === -1) {
          inlineAgents.push({ name, cwd: rest.trim() || undefined });
        } else {
          inlineAgents.push({
            name,
            cwd: rest.slice(0, secondColon).trim() || undefined,
            role: rest.slice(secondColon + 1).trim() || undefined,
          });
        }
      }
    } else if (arg === "--agent-directory" && argv[i + 1]) {
      agentDirs.push(argv[++i]);
    } else if (arg === "--rounds" && argv[i + 1]) {
      roundsOverride = parseInt(argv[++i], 10);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-synopsis") {
      noSynopsis = true;
    } else if (arg === "--output" && argv[i + 1]) {
      if (argv[++i] === "json") outputJson = true;
    } else if (arg === "--timeout" && argv[i + 1]) {
      timeoutMs = parseInt(argv[++i], 10) * 1000;
    } else if (arg === "--provider" && argv[i + 1]) {
      const val = argv[++i];
      if (val === "copilot" || val === "ollama") provider = val;
    } else if (arg === "--ollama-model" && argv[i + 1]) {
      ollamaModel = argv[++i];
    } else if (arg === "--ollama-url" && argv[i + 1]) {
      ollamaUrl = argv[++i];
    } else {
      questionParts.push(arg);
    }
  }

  const question = questionParts.join(" ").trim() || null;

  const expandedDirAgents: AgentConfig[] = agentDirs.flatMap((dir) => {
    const resolved = path.resolve(dir);
    return fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const gitDir = path.join(resolved, entry.name, ".git");
        const isGit = fs.existsSync(gitDir);
        if (!isGit) {
          console.error(`  ${C.dim}⊘ skipping ${entry.name} — not a git repo${C.reset}`);
        }
        return isGit;
      })
      .map((entry) => ({
        name: entry.name,
        cwd: path.join(resolved, entry.name),
      }));
  });

  let fileConfig: Partial<OrchestratorConfig> = {};
  const resolvedConfig = configFile
    ?? (fs.existsSync(path.resolve("agents.json")) ? "agents.json" : undefined);
  if (resolvedConfig) {
    const raw = fs.readFileSync(path.resolve(resolvedConfig), "utf8");
    const parsed = JSON.parse(raw) as OrchestratorConfig | AgentConfig[];
    fileConfig = Array.isArray(parsed) ? { agents: parsed } : parsed;
  }

  let agents: AgentConfig[];
  if (fileConfig.agents?.length) {
    agents = fileConfig.agents;
  } else if (expandedDirAgents.length || inlineAgents.length) {
    agents = [...expandedDirAgents, ...inlineAgents];
  } else {
    agents = [{ name: "Agent A" }, { name: "Agent B" }];
  }

  const maxRounds =
    roundsOverride ??
    (process.env.MAX_ROUNDS ? parseInt(process.env.MAX_ROUNDS, 10) : undefined) ??
    fileConfig.maxRounds ??
    DEFAULT_MAX_ROUNDS;

  return { config: { agents, maxRounds }, question, dryRun, noSynopsis, outputJson, timeoutMs, help: false, provider, ollamaModel, ollamaUrl };
}

export function printUsage() {
  console.error(
    `${C.yellow}Usage:${C.reset}  npx ts-node src/orchestrator.ts [options] "<question>"\n\n` +
      `Options:\n` +
      `  --config <file>               Load agent definitions from a JSON file\n` +
      `  --agent-directory <dir>       Auto-create one agent per subdirectory of <dir>\n` +
      `  --agent "Name"                Add an agent (uses current directory)\n` +
      `  --agent "Name:./path"         Add an agent scoped to a directory\n` +
      `  --agent "Name:./path:Role"    Add an agent with a directory and role\n` +
      `  --rounds <n>                  Max debate rounds (default: ${DEFAULT_MAX_ROUNDS})\n` +
      `  --timeout <seconds>           Per-turn timeout in seconds (default: 120)\n` +
      `  --provider copilot|ollama     LLM backend (prompted if omitted)\n` +
      `  --ollama-model <model>        Ollama model name (default: hf.co/DavidAU/Qwen2.5-QwQ-35B-Eureka-Cubed-abliterated-uncensored-gguf:Q8_0)\n` +
      `  --ollama-url <url>            Ollama base URL (default: http://localhost:11434)\n` +
      `  --dry-run                     Show agents that would be created and exit\n` +
      `  --no-synopsis                 Skip the synopsis generation step\n` +
      `  --output json                 Print a JSON summary at the end\n` +
      `  -h, --help                    Show this help\n\n` +
      `  --agent-directory and --agent can be combined in the same run.\n\n` +
      `Config file format (JSON):\n` +
      `  [\n` +
      `    { "name": "Frontend", "cwd": "./web",  "role": "React and UI architecture" },\n` +
      `    { "name": "Backend",  "cwd": "./api",  "role": "Node.js and database design" },\n` +
      `    { "name": "DevOps",   "cwd": "./infra","role": "CI/CD and infrastructure" }\n` +
      `  ]\n\n` +
      `Examples:\n` +
      `  npx ts-node src/orchestrator.ts "Should we use GraphQL?"\n` +
      `  npx ts-node src/orchestrator.ts --agent-directory ./workflow "Should we adopt an event bus?"\n` +
      `  npx ts-node src/orchestrator.ts --agent "Frontend:./web" --agent "Backend:./api" "How to handle auth?"\n` +
      `  npx ts-node src/orchestrator.ts --config agents.json --rounds 5 "What is our migration strategy?"`
  );
}
