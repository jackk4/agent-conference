import * as path from "node:path";
import { ConversationParams, IAgentSession } from "./types";
import { agentColor, C, header, divider } from "./colors";
import { Logger, TokenTracker } from "./logger";
import { primer, debateTurn, extractAgree } from "./prompts";
import { ensureOllamaRunning, createAgent, COPILOT_BIN } from "./agents";

const OPENING_BATCH_SIZE = process.env.OPENING_BATCH_SIZE
  ? parseInt(process.env.OPENING_BATCH_SIZE, 10)
  : 10;

export async function runConversation(params: ConversationParams): Promise<void> {
  const { question, agents: agentConfigs, maxRounds, provider, ollamaModel,
          ollamaUrl, timeoutMs, noSynopsis, outputJson } = params;
  const config = { agents: agentConfigs, maxRounds };

  const logger = new Logger(question);
  const tracker = new TokenTracker();

  console.log(`\n${C.bold}${C.cyan}⚡ Copilot Conference Session${C.reset}`);
  console.log(`${C.bold}Q:${C.reset} ${question}`);
  const providerNote = provider === "ollama"
    ? `ollama:${ollamaModel} @ ${ollamaUrl}`
    : `copilot (${COPILOT_BIN})`;
  console.log(`${C.dim}Agents: ${config.agents.length} | Max rounds: ${config.maxRounds} | Provider: ${providerNote}${C.reset}`);

  config.agents.forEach((a, i) => {
    const cwdNote = a.cwd ? ` → ${path.resolve(a.cwd)}` : "";
    const roleNote = a.role ? ` (${a.role})` : "";
    console.log(`  ${agentColor(i)}${C.bold}${a.name}${C.reset}${cwdNote}${roleNote}`);
  });

  logger.writeHeader(question, config.agents);

  if (provider === "ollama") await ensureOllamaRunning(ollamaUrl);

  console.log(`\n${C.dim}Spawning ${config.agents.length} agents...${C.reset}`);
  const sessions = await Promise.all(
    config.agents.map((a, i) =>
      createAgent(a, i, tracker, timeoutMs, provider, { model: ollamaModel, url: ollamaUrl })
    )
  );
  console.log(`${C.green}✓ All agents ready.${C.reset}`);

  const transcript: string[] = [];
  const agrees = new Map<string, string | null>(sessions.map((s) => [s.name, null]));
  const deadAgents = new Set<string>();

  console.log(`\n${C.dim}Collecting opening statements (batches of ${OPENING_BATCH_SIZE})...${C.reset}`);
  const openingResults: { session: IAgentSession; response: string; error: string | null }[] = [];
  for (let i = 0; i < sessions.length; i += OPENING_BATCH_SIZE) {
    const batch = sessions.slice(i, i + OPENING_BATCH_SIZE);
    const batchNum = Math.floor(i / OPENING_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(sessions.length / OPENING_BATCH_SIZE);
    if (totalBatches > 1) {
      console.log(`${C.dim}  Batch ${batchNum}/${totalBatches}${C.reset}`);
    }

    type AgentStatus = "thinking" | "done" | "error";
    const status = new Map<string, AgentStatus>(batch.map((s) => [s.name, "thinking"]));
    const startedAt = Date.now();

    const renderProgress = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const parts = batch.map((s) => {
        const st = status.get(s.name);
        if (st === "done")  return `${s.color}✓ ${s.name}${C.reset}`;
        if (st === "error") return `${C.yellow}✗ ${s.name}${C.reset}`;
        return `${C.dim}⏳ ${s.name} ${elapsed}s${C.reset}`;
      });
      process.stdout.write(`\r  ${parts.join("   ")}  `);
    };

    renderProgress();
    const ticker = setInterval(renderProgress, 1_000);

    const batchResults = await Promise.all(
      batch.map(async (session, j) => {
        try {
          const response = await session.send(
            primer(config.agents[i + j], config.agents, question),
            "Opening",
            { silent: true }
          );
          status.set(session.name, "done");
          renderProgress();
          return { session, response, error: null as string | null };
        } catch (err: unknown) {
          status.set(session.name, "error");
          renderProgress();
          return { session, response: "", error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    clearInterval(ticker);
    console.log(); // move past the progress line
    openingResults.push(...batchResults);
  }

  for (const { session, response, error } of openingResults) {
    header(`${session.name} — Opening`, session.color);
    if (error) {
      console.log(`${C.yellow}⚠ ${session.name} failed: ${error}${C.reset}`);
      deadAgents.add(session.name);
    } else {
      process.stdout.write(response);
      console.log();
      transcript.push(`[${session.name}]\n${response.trim()}`);
      logger.writeTurn(session.name, "Opening", response);
      const agree = extractAgree(response);
      if (agree) agrees.set(session.name, agree);
    }
  }

  for (let round = 1; round <= config.maxRounds; round++) {
    if (sessions.every((s) => deadAgents.has(s.name))) {
      console.log(`${C.yellow}⚠ All agents have failed. Stopping.${C.reset}`);
      break;
    }
    const allActiveAgreed = [...agrees.entries()]
      .filter(([name]) => !deadAgents.has(name))
      .every(([, v]) => v !== null);
    if (allActiveAgreed) break;

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      if (deadAgents.has(session.name)) continue;
      if (agrees.get(session.name) !== null) continue;

      header(`${session.name} — Round ${round}`, session.color);
      try {
        const response = await session.send(
          debateTurn(config.agents[i], transcript.join("\n\n---\n\n")),
          `Round ${round}`
        );
        transcript.push(`[${session.name}] (Round ${round})\n${response.trim()}`);
        logger.writeTurn(session.name, `Round ${round}`, response);
        const agree = extractAgree(response);
        if (agree) agrees.set(session.name, agree);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n${C.yellow}⚠ ${session.name} errored: ${msg} — marking as dead${C.reset}`);
        deadAgents.add(session.name);
        logger.writeTurn(session.name, `Round ${round}`, `⚠ Agent failed: ${msg}`);
      }
    }
  }

  divider();
  const activeAgrees = [...agrees.entries()].filter(([name]) => !deadAgents.has(name));
  const allAgreed = activeAgrees.length > 0 && activeAgrees.every(([, v]) => v !== null);

  if (allAgreed) {
    const activeCount = sessions.length - deadAgents.size;
    console.log(`${C.bold}${C.green}✓ Consensus reached by all ${activeCount} agents${C.reset}`);
    const finalAnswer = [...agrees.values()].find((v) => v && v !== "agreed") ?? "agreed";
    console.log(`\n${C.bold}Final answer:${C.reset} ${finalAnswer}`);
  } else {
    const agreed  = sessions.filter((s) => !deadAgents.has(s.name) && agrees.get(s.name) !== null);
    const pending = sessions.filter((s) => !deadAgents.has(s.name) && agrees.get(s.name) === null);
    const activeCount = sessions.length - deadAgents.size;
    console.log(`${C.yellow}⚠ Max rounds reached — ${agreed.length}/${activeCount} agents agreed${C.reset}`);
    agreed.forEach((s) => console.log(`  ${s.color}✓ ${s.name}:${C.reset} ${agrees.get(s.name)}`));
    pending.forEach((s) => console.log(`  ${C.dim}✗ ${s.name}: no agreement reached${C.reset}`));
    deadAgents.forEach((name) => console.log(`  ${C.yellow}✗ ${name}: agent failed${C.reset}`));
  }

  logger.writeOutcome(allAgreed, agrees, sessions.length);

  if (!noSynopsis) {
    divider();
    console.log(`${C.dim}Generating synopsis...${C.reset}`);

    const synopsisPrompt = `You have just participated in a multi-agent discussion. Here is the full transcript:

${transcript.join("\n\n---\n\n")}

Please write a concise synopsis of each agent's key findings and position from this discussion.
For each agent, write 2–4 bullet points covering: their main argument, any concerns they raised,
and whether/how their position changed over the course of the discussion.
Do not editorialize — just summarise what each agent actually said.`;

    const synopsisAgent =
      sessions.find(
        (s) => !deadAgents.has(s.name) &&
          ["Tech-Lead", "Architecture"].includes(config.agents.find((a) => a.name === s.name)?.role ?? "")
      ) ??
      sessions.find((s) => !deadAgents.has(s.name)) ??
      sessions[0];

    const synopsis = await synopsisAgent.send(synopsisPrompt, "Synopsis");
    logger.writeSynopsis(synopsis);
  }

  logger.writeUsage(tracker);
  logger.close();

  divider();
  tracker.printSummary();
  divider();
  console.log(`${C.bold}Log saved to:${C.reset} ${logger.filePath}`);

  if (outputJson) {
    const jsonOut = {
      agreed: allAgreed,
      finalAnswer: allAgreed
        ? ([...agrees.values()].find((v) => v && v !== "agreed") ?? "agreed")
        : null,
      agentAgreements: Object.fromEntries(agrees),
      deadAgents: [...deadAgents],
      tokenTotals: tracker.totals,
    };
    console.log("\n" + JSON.stringify(jsonOut, null, 2));
  }

  await Promise.all(sessions.map((s) => s.close()));
}
