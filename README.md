# copilot-conference

A multi-agent orchestrator that runs multiple GitHub Copilot CLI instances simultaneously, has them debate a question from their own perspectives, and drives them toward a shared consensus answer.

Each agent runs as an independent `copilot` process via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), with its own context window. Agents can be scoped to specific directories, making each one a subject matter expert for that codebase.

## How it works

1. **Opening round** — each agent independently answers the question, drawing on its assigned directory and role for context.
2. **Debate rounds** — agents take turns responding to the full conversation transcript. They can challenge each other, ask follow-up questions, and refine their positions.
3. **Consensus** — when every agent includes `[AGREE: <answer>]` in its response, the session ends and the final answer is printed.
4. **Timeout** — if `--rounds` is reached before consensus, the orchestrator prints each agent's last known position.

## Prerequisites

- [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) installed and authenticated
- Node.js 18+

## Installation

```bash
git clone <this-repo>
cd copilot-conference
npm install
```

## Usage

### Default (2 agents, no directory scoping)

```bash
npx ts-node src/orchestrator.ts "Should we use REST or GraphQL for our new API?"
```

### Inline agents with `--agent`

Define agents directly on the command line. The format is `"Name"`, `"Name:./path"`, or `"Name:./path:Role description"`.

```bash
npx ts-node src/orchestrator.ts \
  --agent "Frontend:./packages/web:React and UI architecture" \
  --agent "Backend:./packages/api:Node.js and database design" \
  "How should we handle authentication across our services?"
```

Any number of agents can be added by repeating `--agent`.

### Config file with `--config`

For setups you want to reuse, define agents in a JSON file.

**`agents.json`**
```json
[
  { "name": "QA",           "role": "QA",          "cwd": "./workflow/margin-manager" },
  { "name": "Security",     "role": "Security",     "cwd": "./workflow/agreement-manager-api" },
  { "name": "DevOps",       "role": "DevOps",       "cwd": "./infra" }
]
```

```bash
npx ts-node src/orchestrator.ts --config agents.json "Is it safe to add a required column with a live deployment?"
```

The `role` field accepts any name from the `agent_roles/` directory (`QA`, `DevOps`, `Backend`, `Frontend`, `Security`, `Architecture`, `Data`, `Tech-Lead`, `Performance`, `API-Design`, `Database`, `Product`, `Developer`). If the name doesn't match a folder, the string is used as an inline description instead.

You can also set `maxRounds` in the config file:

```json
{
  "maxRounds": 5,
  "agents": [
    { "name": "Backend", "role": "Backend", "cwd": "./packages/api" },
    { "name": "DevOps",  "role": "DevOps",  "cwd": "./infra" }
  ]
}
```

### Auto-expand a directory with `--agent-directory`

Point `--agent-directory` at any directory of directories and the orchestrator automatically creates one agent per subdirectory, using the folder name as the agent's name and the folder itself as its context. This is ideal for monorepos.

```bash
# Creates one agent for each of the 18 services inside ./workflow
npx ts-node src/orchestrator.ts \
  --agent-directory ./workflow \
  "Should we adopt a shared event bus or keep direct HTTP calls between services?"
```

`--agent-directory` and `--agent` can be combined in the same run — directory-expanded agents are listed first:

```bash
npx ts-node src/orchestrator.ts \
  --agent-directory ./workflow \
  --agent "DevOps:./infra:Infrastructure and CI/CD" \
  "What is the safest zero-downtime deployment strategy for our services?"
```

Multiple `--agent-directory` flags are also supported:

```bash
npx ts-node src/orchestrator.ts \
  --agent-directory ./workflow \
  --agent-directory ./dx \
  "How should services expose metrics for the dashboards?"
```

| Option | Description |
|---|---|
| `--config <file>` | Load agent definitions from a JSON file |
| `--agent-directory <dir>` | Auto-create one agent per subdirectory of `<dir>` (repeatable) |
| `--agent "Name"` | Add an agent using the current directory |
| `--agent "Name:./path"` | Add an agent scoped to a directory |
| `--agent "Name:./path:Role"` | Add an agent with a directory and role description |
| `--rounds <n>` | Maximum debate rounds before stopping (default: `8`) |

`--agent-directory` and `--agent` can be combined freely in the same run.

### Environment variables

| Variable | Description |
|---|---|
| `COPILOT_BIN` | Path to the `copilot` binary if not on `PATH` (default: `copilot`) |
| `MAX_ROUNDS` | Maximum debate rounds (overridden by `--rounds`) |
| `AGENT_TIMEOUT` | Per-turn timeout in seconds (default: `120`) |
| `OPENING_BATCH_SIZE` | Max concurrent agents in the opening round (default: `10`) |

## Build

To compile to JavaScript and run without `ts-node`:

```bash
npm run build
node dist/orchestrator.js --config agents.json "Your question"
```

## Example output

```
⚡ Copilot Conference Session
Q: Should we adopt a monorepo or keep separate repositories?
Agents: 3 | Max rounds: 8
  Frontend → /projects/web (React and UI architecture)
  Backend  → /projects/api (Node.js and database design)
  DevOps   → /projects/infra (CI/CD and infrastructure)

Spawning 3 agents...
✓ All agents ready.

┌─ Frontend — Opening ─┐
  From a UI perspective, a monorepo makes shared component libraries
  much easier to manage without versioning overhead...

┌─ Backend — Opening ─┐
  I agree on shared libraries, but separate repos give us cleaner
  deployment boundaries. How do you handle independent release cycles?

┌─ DevOps — Opening ─┐
  From an infrastructure standpoint, a monorepo with Turborepo or Nx
  simplifies CI/CD significantly for a team our size...

┌─ Frontend — Round 1 ─┐
  The CI/CD argument is compelling. I withdraw my concern about
  release cycles given the tooling available.
  [AGREE: Adopt a monorepo with Turborepo for shared tooling and simpler CI/CD.]

... (further rounds until all agents agree)

────────────────────────────────────────────────────────────
✓ Consensus reached by all 3 agents

Final answer: Adopt a monorepo with Turborepo for shared tooling and simpler CI/CD.
────────────────────────────────────────────────────────────
```
