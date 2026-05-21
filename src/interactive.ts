import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import select from "@inquirer/select";
import { AgentConfig, Provider } from "./types";
import { agentColor, C } from "./colors";
import { LOG_DIR } from "./logger";
import { ensureOllamaRunning } from "./agents";
import { spawn } from "node:child_process";

export async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultValue ? ` ${C.dim}[${defaultValue}]${C.reset}` : "";
  try {
    const answer = await rl.question(`${C.cyan}?${C.reset} ${question}${hint}: `);
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}


async function listOllamaModels(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name).sort();
  } catch {
    return [];
  }
}

export async function promptOllamaModel(url: string): Promise<string | null> {
  const installed = await listOllamaModels(url);

  if (installed.length === 0) {
    console.log(`${C.dim}  No models found locally. You can pull one now.${C.reset}`);
    return promptOllamaPull();
  }

  const choice = await select({
    message: "Select an Ollama model",
    choices: [
      ...installed.map((m) => ({ name: m, value: m })),
      { name: "Download a new model...", value: "__pull__" },
      { name: "← Go back",              value: "__back__" },
    ],
  });

  if (choice === "__back__") return null;
  return choice === "__pull__" ? promptOllamaPull() : choice;
}

export async function promptOllamaPull(): Promise<string> {
  const modelName = await promptLine("Model name to download (e.g. deepseek-r1:14b)");
  if (!modelName) {
    console.error(`${C.yellow}No model name provided.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.dim}Running: ollama pull ${modelName}${C.reset}\n`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ollama", ["pull", modelName], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ollama pull exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  console.log(`\n${C.green}✓ Model downloaded: ${modelName}${C.reset}`);
  return modelName;
}

function listRoles(): string[] {
  const rolesDir = path.join(__dirname, "..", "agent_roles");
  const roles: string[] = [];
  try {
    for (const entry of fs.readdirSync(rolesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const roleFile = path.join(rolesDir, entry.name, "role.md");
      if (fs.existsSync(roleFile)) {
        roles.push(entry.name);
      } else {
        try {
          for (const sub of fs.readdirSync(path.join(rolesDir, entry.name), { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            const subRoleFile = path.join(rolesDir, entry.name, sub.name, "role.md");
            if (fs.existsSync(subRoleFile)) {
              roles.push(`${entry.name}/${sub.name}`);
            }
          }
        } catch { /* ignore unreadable subdirs */ }
      }
    }
  } catch {
    return [];
  }
  return roles.sort();
}

export async function promptAgentSetup(initial: AgentConfig[]): Promise<AgentConfig[]> {
  const agents: AgentConfig[] = initial.map((a) => ({ ...a }));
  const roles = listRoles();

  const printAgents = () => {
    if (agents.length === 0) {
      console.log(`  ${C.dim}(no agents configured)${C.reset}`);
      return;
    }
    agents.forEach((a, i) => {
      const roleNote = a.role ? ` ${C.dim}(${a.role})${C.reset}` : "";
      const cwdNote = a.cwd ? ` ${C.dim}→ ${a.cwd}${C.reset}` : "";
      console.log(`  ${agentColor(i)}${C.bold}${i + 1}) ${a.name}${C.reset}${roleNote}${cwdNote}`);
    });
  };

  const addAgent = async () => {
    const name = await promptLine("Agent name");
    if (!name) return;

    const roleChoice = await select({
      message: `Role for ${name}`,
      choices: [
        ...roles.map((r) => ({ name: r, value: r })),
        { name: "No role",    value: ""          },
        { name: "← Cancel",  value: "__cancel__" },
      ],
    });

    if (roleChoice === "__cancel__") return;
    const cwd = await promptLine(`Working directory for ${name} (leave blank for current dir)`);

    agents.push({ name, role: roleChoice || undefined, cwd: cwd || undefined });
    console.log(`${C.green}✓ Added ${name}${C.reset}`);
  };

  const editAgent = async () => {
    if (agents.length === 0) { console.log(`  ${C.yellow}No agents to edit.${C.reset}`); return; }
    printAgents();
    const raw = await promptLine("Agent number to edit");
    const idx = parseInt(raw, 10) - 1;
    if (idx < 0 || idx >= agents.length) { console.log(`  ${C.yellow}Invalid number.${C.reset}`); return; }

    const a = agents[idx];
    const name = await promptLine("New name", a.name);
    const roleChoice = await select({
      message: `Role for ${name}`,
      choices: [
        ...roles.map((r) => ({ name: r, value: r })),
        { name: "No role",    value: ""          },
        { name: "← Cancel",  value: "__cancel__" },
      ],
    });
    if (roleChoice === "__cancel__") return;
    const cwd = await promptLine("Working directory (leave blank to keep current)", a.cwd ?? "");

    agents[idx] = { name, role: roleChoice || undefined, cwd: cwd || undefined };
    console.log(`${C.green}✓ Updated ${name}${C.reset}`);
  };

  const removeAgent = async () => {
    if (agents.length === 0) { console.log(`  ${C.yellow}No agents to remove.${C.reset}`); return; }
    printAgents();
    const raw = await promptLine("Agent number to remove");
    const idx = parseInt(raw, 10) - 1;
    if (idx < 0 || idx >= agents.length) { console.log(`  ${C.yellow}Invalid number.${C.reset}`); return; }
    const removed = agents.splice(idx, 1)[0];
    console.log(`${C.yellow}✓ Removed ${removed.name}${C.reset}`);
  };

  while (true) {
    console.log(`\n${C.bold}Agents${C.reset} (${agents.length} configured):`);
    printAgents();

    const action = await select({
      message: "Agent setup",
      choices: [
        { name: "Continue with these agents", value: "done"   },
        { name: "Add an agent",               value: "add"    },
        { name: "Edit an agent",              value: "edit"   },
        { name: "Remove an agent",            value: "remove" },
      ],
    });

    if (action === "done") break;
    if (action === "add")    await addAgent();
    if (action === "edit")   await editAgent();
    if (action === "remove") await removeAgent();
  }

  if (agents.length === 0) {
    console.log(`${C.yellow}No agents configured — using defaults (Agent A, Agent B).${C.reset}`);
    return [{ name: "Agent A" }, { name: "Agent B" }];
  }

  return agents;
}

export async function promptSettings(
  current: { provider: Provider | null; ollamaModel: string | null; ollamaUrl: string; maxRounds: number }
): Promise<{ provider: Provider | null; ollamaModel: string | null; maxRounds: number }> {
  while (true) {
    const providerChoice = await select({
      message: "Provider",
      choices: [
        { name: "Copilot — GitHub Copilot via ACP (requires copilot CLI)", value: "copilot"   },
        { name: "Ollama  — local model, no API limits",                    value: "ollama"    },
        { name: "← Go back",                                               value: "__back__"  },
      ],
    });

    if (providerChoice === "__back__") {
      return { provider: current.provider, ollamaModel: current.ollamaModel, maxRounds: current.maxRounds };
    }

    const provider = providerChoice as Provider;
    let ollamaModel = current.ollamaModel;

    if (provider === "ollama") {
      await ensureOllamaRunning(current.ollamaUrl);
      const chosen = await promptOllamaModel(current.ollamaUrl);
      if (chosen === null) continue;
      ollamaModel = chosen;
    }

    const roundsInput = await promptLine("Max debate rounds", String(current.maxRounds));
    const maxRounds = parseInt(roundsInput, 10) || current.maxRounds;

    return { provider, ollamaModel, maxRounds };
  }
}


export async function promptLogFileSelect(): Promise<string | null> {
  let files: string[];
  try {
    files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    console.log(`\n${C.dim}No logs directory found.${C.reset}`);
    return null;
  }

  if (files.length === 0) {
    console.log(`\n${C.dim}No log files found in ${LOG_DIR}${C.reset}`);
    return null;
  }

  const choice = await select({
    message: "Select a conference log to summarize",
    choices: [
      ...files.map((f) => {
        const date = f.slice(0, 10);
        const slug = f
          .replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, "")
          .replace(/\.md$/, "")
          .replace(/-/g, " ");
        return { name: `${slug}  ${C.dim}(${date})${C.reset}`, value: path.join(LOG_DIR, f) };
      }),
      { name: "← Go back", value: "__back__" },
    ],
  });

  return choice === "__back__" ? null : choice;
}

export function showRecentLogs(n = 8): void {
  try {
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, n);

    if (files.length === 0) {
      console.log(`\n${C.dim}No logs yet in ${LOG_DIR}${C.reset}`);
      return;
    }

    console.log(`\n${C.bold}Recent conversations:${C.reset}`);
    files.forEach((f, i) => {
      const date = f.slice(0, 10);
      const slug = f
        .replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, "")
        .replace(/\.md$/, "")
        .replace(/-/g, " ");
      console.log(`  ${C.dim}${i + 1})${C.reset} ${C.bold}${slug}${C.reset}  ${C.dim}${date}${C.reset}`);
    });
  } catch {
    console.log(`\n${C.dim}No logs directory found.${C.reset}`);
  }
}
