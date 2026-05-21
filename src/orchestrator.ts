import "dotenv/config";
import * as path from "node:path";
import select from "@inquirer/select";
import { Provider } from "./types";
import { agentColor, C } from "./colors";
import { parseArgs, printUsage } from "./cli";
import { promptLine, promptAgentSetup, promptSettings, promptOllamaModel, showRecentLogs, promptLogFileSelect } from "./interactive";
import { ensureOllamaRunning } from "./agents";
import { runConversation, summarizeConference } from "./conversation";

async function main() {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.question && args.provider) {
    const ollamaModel = args.provider === "ollama"
      ? (args.ollamaModel ?? await promptOllamaModel(args.ollamaUrl) ?? "")
      : "";

    if (args.dryRun) {
      console.log(`\n${C.bold}Dry run — agents that would be created:${C.reset}`);
      args.config.agents.forEach((a, i) => {
        const cwdNote = a.cwd ? ` → ${path.resolve(a.cwd)}` : "";
        const roleNote = a.role ? ` (${a.role})` : "";
        console.log(`  ${agentColor(i)}${C.bold}${a.name}${C.reset}${cwdNote}${roleNote}`);
      });
      console.log(`\n${C.dim}Provider: ${args.provider} | Max rounds: ${args.config.maxRounds} | Timeout: ${args.timeoutMs / 1000}s${C.reset}`);
      process.exit(0);
    }

    await runConversation({
      question: args.question,
      agents: args.config.agents,
      maxRounds: args.config.maxRounds,
      provider: args.provider,
      ollamaModel,
      ollamaUrl: args.ollamaUrl,
      timeoutMs: args.timeoutMs,
      noSynopsis: args.noSynopsis,
      outputJson: args.outputJson,
    });
    return;
  }

  // Interactive main menu
  let agents    = args.config.agents;
  let maxRounds = args.config.maxRounds;
  let provider: Provider | null = args.provider;
  let ollamaModel: string | null = args.ollamaModel;
  const ollamaUrl = args.ollamaUrl;

  console.log(`\n${C.bold}${C.cyan}⚡ Copilot Conference${C.reset}`);

  while (true) {
    const participantLine = agents.length > 0
      ? agents.map((a, i) => `${agentColor(i)}${a.name}${C.reset}`).join(", ")
      : `${C.dim}none${C.reset}`;
    const providerLine = provider
      ? (provider === "ollama" ? `ollama${ollamaModel ? `:${ollamaModel}` : ""}` : "copilot")
      : `${C.dim}not set${C.reset}`;

    console.log(
      `\n${C.dim}Participants: ${participantLine}  ·  Provider: ${providerLine}  ·  Rounds: ${maxRounds}${C.reset}`
    );

    const action = await select({
      message: "Main menu",
      choices: [
        { name: "Start a conversation",  value: "start"       },
        { name: "Manage participants",   value: "participants" },
        { name: "Settings",              value: "settings"    },
        { name: "Summarize conference",  value: "summarize"   },
        { name: "View recent logs",      value: "logs"        },
        { name: "Exit",                  value: "exit"        },
      ],
    });

    if (action === "exit") {
      console.log(`\n${C.dim}Goodbye.${C.reset}`);
      process.exit(0);
    }

    if (action === "participants") {
      agents = await promptAgentSetup(agents);
      continue;
    }

    if (action === "settings") {
      const updated = await promptSettings({ provider, ollamaModel, ollamaUrl, maxRounds });
      provider    = updated.provider;
      ollamaModel = updated.ollamaModel;
      maxRounds   = updated.maxRounds;
      continue;
    }


    if (action === "logs") {
      showRecentLogs();
      continue;
    }

    if (action === "summarize") {
      if (!provider) {
        console.log(`\n${C.yellow}A provider must be configured before summarizing.${C.reset}`);
        const updated = await promptSettings({ provider, ollamaModel, ollamaUrl, maxRounds });
        provider    = updated.provider;
        ollamaModel = updated.ollamaModel;
        maxRounds   = updated.maxRounds;
        if (!provider) continue;
      }

      if (provider === "ollama" && !ollamaModel) {
        await ensureOllamaRunning(ollamaUrl);
        const chosen = await promptOllamaModel(ollamaUrl);
        if (chosen === null) continue;
        ollamaModel = chosen;
      }

      const logPath = await promptLogFileSelect();
      if (!logPath) continue;

      await summarizeConference({
        logPath,
        provider: provider as import("./types").Provider,
        ollamaModel: ollamaModel ?? "",
        ollamaUrl,
        timeoutMs: args.timeoutMs,
      });
      continue;
    }

    if (action === "start") {
      if (!provider) {
        const updated = await promptSettings({ provider, ollamaModel, ollamaUrl, maxRounds });
        provider    = updated.provider;
        ollamaModel = updated.ollamaModel;
        maxRounds   = updated.maxRounds;
        if (!provider) continue;
      }

      if (provider === "ollama" && !ollamaModel) {
        await ensureOllamaRunning(ollamaUrl);
        const chosen = await promptOllamaModel(ollamaUrl);
        if (chosen === null) continue;
        ollamaModel = chosen;
      }

      const roundsInput = await promptLine("Max debate rounds", String(maxRounds));
      maxRounds = parseInt(roundsInput, 10) || maxRounds;

      const question = await promptLine("Question");
      if (!question) {
        console.log(`${C.yellow}  A question is required.${C.reset}`);
        continue;
      }

      await runConversation({
        question,
        agents: agents.length > 0 ? agents : [{ name: "Agent A" }, { name: "Agent B" }],
        maxRounds,
        provider: provider as Provider,
        ollamaModel: ollamaModel ?? "",
        ollamaUrl,
        timeoutMs: args.timeoutMs,
        noSynopsis: args.noSynopsis,
        outputJson: args.outputJson,
      });
    }
  }
}

main().catch((err) => {
  console.error(`${C.yellow}Fatal:${C.reset}`, err);
  process.exitCode = 1;
});
