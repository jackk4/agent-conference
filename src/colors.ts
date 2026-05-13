export const AGENT_COLORS = ["\x1b[94m", "\x1b[92m", "\x1b[95m", "\x1b[93m", "\x1b[96m", "\x1b[91m"];

export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[96m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
};

export function agentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

export function header(text: string, color: string) {
  const line = "─".repeat(Math.min(text.length + 6, 58));
  console.log(`\n${color}${C.bold}┌${line}┐\n│   ${text}   │\n└${line}┘${C.reset}`);
}

export function divider() {
  console.log(`\n${C.dim}${"─".repeat(60)}${C.reset}`);
}
