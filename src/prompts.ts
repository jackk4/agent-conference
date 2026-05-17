import * as fs from "node:fs";
import * as path from "node:path";
import { AgentConfig } from "./types";

export const AGREE_RE = /\[AGREE(?::\s*([^\]]+))?\]/i;

export function extractAgree(text: string): string | null {
  const m = AGREE_RE.exec(text);
  return m ? (m[1]?.trim() || "agreed") : null;
}

export function loadRoleContent(agent: AgentConfig): string {
  if (!agent.role) return "";
  const roleFilePath = path.join(__dirname, "..", "agent_roles", agent.role, "role.md");
  if (fs.existsSync(roleFilePath)) {
    return fs.readFileSync(roleFilePath, "utf8").trim();
  }
  return agent.role;
}

export function primer(agent: AgentConfig, allAgents: AgentConfig[], question: string): string {
  const others = allAgents
    .filter((a) => a.name !== agent.name)
    .map((a) => a.name)
    .join(", ");

  const roleFileContent = loadRoleContent(agent);
  const roleNote = roleFileContent
    ? `\n\n${roleFileContent}`
    : agent.role
    ? `\nYour area of expertise: ${agent.role}`
    : "";
  const cwdNote = agent.cwd
    ? `\nYour codebase context: ${path.resolve(agent.cwd)}`
    : "";

  return `\
You are ${agent.name} in a multi-agent reasoning panel alongside: ${others}.${roleNote}${cwdNote}

Original question: "${question}"

Your role:
1. Give your best answer, drawing on your area of expertise and any codebase context.
2. Actively challenge other agents if you disagree — ask specific follow-up questions.
3. Update your position when another agent makes a compelling argument.
4. Once you genuinely agree on a final answer, end your message with:
   [AGREE: <one-sentence final answer>]

Only use [AGREE: ...] when fully satisfied. Do NOT use it if you still have doubts.

Begin with your initial answer.`;
}

export function stripThinkTags(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<\/think>/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}


export function debateTurn(agent: AgentConfig, transcript: string): string {
  return `\
Here is the conversation so far:

${transcript}

---
Your turn, ${agent.name}. Respond to the discussion above.
Push back on anything you disagree with, ask follow-up questions to resolve uncertainty,
and draw on your specific codebase context where relevant.
When fully satisfied with the consensus, end with: [AGREE: <one-sentence final answer>]`;
}
