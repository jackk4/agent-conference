import * as fs from "node:fs";
import * as path from "node:path";
import { AgentConfig, TurnUsage } from "./types";
import { C } from "./colors";

export const LOG_DIR = path.resolve("logs");

export class Logger {
  readonly filePath: string;
  private _fd: number;

  constructor(question: string) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)
      .replace(/^-|-$/g, "");
    this.filePath = path.join(LOG_DIR, `${timestamp}_${slug}.md`);
    this._fd = fs.openSync(this.filePath, "w");
  }

  write(text: string) { fs.writeSync(this._fd, text); }
  writeLine(text = "") { this.write(text + "\n"); }
  close() { fs.closeSync(this._fd); }

  writeHeader(question: string, agents: AgentConfig[]) {
    this.writeLine(`# Copilot Conference Session`);
    this.writeLine();
    this.writeLine(`**Date:** ${new Date().toLocaleString()}`);
    this.writeLine(`**Question:** ${question}`);
    this.writeLine();
    this.writeLine(`## Agents`);
    this.writeLine();
    agents.forEach((a) => {
      const cwdNote = a.cwd ? ` — \`${path.resolve(a.cwd)}\`` : "";
      const roleNote = a.role ? ` *(${a.role})*` : "";
      this.writeLine(`- **${a.name}**${roleNote}${cwdNote}`);
    });
    this.writeLine();
    this.writeLine("---");
    this.writeLine();
  }

  writeTurn(agentName: string, label: string, response: string) {
    this.writeLine(`## ${agentName} — ${label}`);
    this.writeLine();
    this.writeLine(response.trim());
    this.writeLine();
    this.writeLine("---");
    this.writeLine();
  }

  writeOutcome(allAgreed: boolean, agrees: Map<string, string | null>, agentCount: number) {
    this.writeLine(`## Outcome`);
    this.writeLine();
    if (allAgreed) {
      const finalAnswer = [...agrees.values()].find((v) => v && v !== "agreed") ?? "agreed";
      this.writeLine(`**✓ Consensus reached by all ${agentCount} agents**`);
      this.writeLine();
      this.writeLine(`**Final answer:** ${finalAnswer}`);
    } else {
      const agreedCount = [...agrees.values()].filter((v) => v !== null).length;
      this.writeLine(`**⚠ Max rounds reached — ${agreedCount}/${agentCount} agents agreed**`);
      this.writeLine();
      agrees.forEach((answer, name) => {
        if (answer) {
          this.writeLine(`- ✓ **${name}:** ${answer}`);
        } else {
          this.writeLine(`- ✗ **${name}:** no agreement reached`);
        }
      });
    }
    this.writeLine();
    this.writeLine("---");
    this.writeLine();
  }

  writeSynopsis(synopsis: string) {
    this.writeLine(`## Agent Findings Synopsis`);
    this.writeLine();
    this.writeLine(synopsis.trim());
    this.writeLine();
  }

  writeUsage(tracker: TokenTracker) {
    this.writeLine(`## Token Usage`);
    this.writeLine();
    this.writeLine(tracker.formatForLog());
    this.writeLine();
  }
}

export class TokenTracker {
  private _turns: TurnUsage[] = [];

  record(
    label: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    elapsedMs: number
  ) {
    this._turns.push({ label, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, elapsedMs });
  }

  get totals() {
    return this._turns.reduce(
      (acc, t) => ({
        inputTokens: acc.inputTokens + t.inputTokens,
        outputTokens: acc.outputTokens + t.outputTokens,
        totalTokens: acc.totalTokens + t.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
  }

  printSummary() {
    const t = this.totals;
    console.log(`\n${C.bold}Token usage${C.reset}`);
    this._turns.forEach((turn) => {
      console.log(
        `  ${C.dim}${turn.label.padEnd(40)}${C.reset}` +
          ` in: ${String(turn.inputTokens).padStart(6)}` +
          `  out: ${String(turn.outputTokens).padStart(6)}` +
          `  total: ${String(turn.totalTokens).padStart(7)}` +
          `  time: ${(turn.elapsedMs / 1000).toFixed(1)}s`
      );
    });
    console.log(
      `  ${C.bold}${"TOTAL".padEnd(40)}${C.reset}` +
        ` in: ${String(t.inputTokens).padStart(6)}` +
        `  out: ${String(t.outputTokens).padStart(6)}` +
        `  total: ${String(t.totalTokens).padStart(7)}`
    );
  }

  formatForLog(): string {
    const t = this.totals;
    const rows = this._turns
      .map(
        (turn) =>
          `| ${turn.label.padEnd(42)} | ${String(turn.inputTokens).padStart(9)} | ${String(turn.outputTokens).padStart(10)} | ${String(turn.totalTokens).padStart(11)} | ${(turn.elapsedMs / 1000).toFixed(1).padStart(7)}s |`
      )
      .join("\n");
    const separator = `| ${"---".padEnd(42)} | ${"---".padStart(9)} | ${"---".padStart(10)} | ${"---".padStart(11)} | ${"---".padStart(8)} |`;
    const total = `| ${"**TOTAL**".padEnd(42)} | ${String(t.inputTokens).padStart(9)} | ${String(t.outputTokens).padStart(10)} | ${String(t.totalTokens).padStart(11)} | |`;
    return (
      `| ${"Turn".padEnd(42)} | ${"Input".padStart(9)} | ${"Output".padStart(10)} | ${"Total".padStart(11)} | ${"Time".padStart(8)} |\n` +
      separator + `\n` + rows + `\n` + separator + `\n` + total
    );
  }
}
