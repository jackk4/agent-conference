# Copilot Instructions

## Build & run commands

```bash
npm install           # install dependencies
npm test              # run unit tests
npm run check         # run tests and compile TypeScript
npm run dev "<question>"   # run via ts-node (development)
npm run build         # compile TypeScript → dist/
npm start             # build + run compiled output
```

CI runs `npm run check`, which executes the unit tests before compiling TypeScript.

## Architecture

The entire application lives in a single file: **`src/orchestrator.ts`** (~900 lines). It compiles to `dist/orchestrator.js`.

**Execution flow:**

1. `parseArgs()` resolves agent configs from `--agent`, `--agent-directory`, `--config <file>`, or auto-detected `agents.json` in cwd. If none, defaults to two unnamed agents.
2. The orchestrator spawns one agent session per config. Agents are either:
   - **`AgentSession`** — wraps a `copilot --acp --stdio` subprocess, communicating via the [Agent Client Protocol](https://agentclientprotocol.com) (`@agentclientprotocol/sdk`). The agent's `cwd` scopes it as a subject matter expert for that directory.
   - **`OllamaAgentSession`** — calls a local Ollama server's OpenAI-compatible HTTP API. Maintains its own message history; cannot use tools or read files (cwd is informational only).
3. Both session types implement the `IAgentSession` interface (`send`, `close`).
4. **Opening round**: agents answer independently, batched up to `OPENING_BATCH_SIZE` concurrently.
5. **Debate rounds**: agents respond sequentially to the full shared transcript.
6. **Consensus**: detected by `AGREE_RE = /\[AGREE(?::\s*([^\]]+))?\]/i`. When all agents include `[AGREE: <answer>]`, the session ends.
7. Each session is logged to `logs/<timestamp>_<slug>.md`.

## Key conventions

### Agent roles

- Role files live at `agent_roles/<RoleName>/role.md`. The `role` field in `agents.json` is matched case-sensitively against folder names.
- If no matching folder exists, the `role` string is used as an inline description in the primer prompt.
- Role resolution happens in `loadRoleContent()`. The role file content is injected verbatim into the agent's opening prompt.
- Follow the structure in `agent_roles/TEMPLATE.md` when adding new roles: **Mindset**, **Core concerns**, **Questions you always ask**.

### agents.json

- `agents.json` is gitignored (personal config). `agents.example.json` is the committed template.
- Config can be a flat array `AgentConfig[]` or an object `{ maxRounds, agents }`.
- If `agents.json` exists in cwd, it's auto-loaded without `--config`.

### `--agent-directory` expansion

- Only subdirectories containing a `.git` folder are included. Non-git dirs are skipped with a warning.
- Agent name = folder name; cwd = folder path. No role is assigned automatically.

### Priority order (agents)

`--config` file agents → `--agent-directory` + `--agent` flags (merged) → default two agents

### Priority order (maxRounds)

`--rounds` flag → `MAX_ROUNDS` env → config file → default `8`

### Ollama provider

- Strip `<think>…</think>` blocks (DeepSeek-R1 chain-of-thought) from responses before sharing with other agents or logging — see `stripThinkTags()`.
- Provider is prompted interactively if not set via `PROVIDER` env or `--provider` flag.

### Environment variables

Defined in `.env` (copy from `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `COPILOT_BIN` | `copilot` | Override if binary is not on PATH |
| `MAX_ROUNDS` | `8` | Overridden by `--rounds` |
| `AGENT_TIMEOUT` | `120` | Seconds per turn |
| `OPENING_BATCH_SIZE` | `10` | Max concurrent agents in opening round |
| `PROVIDER` | *(prompted)* | `copilot` or `ollama` |
| `OLLAMA_MODEL` | *(prompted)* | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

### Node version

Node 20+ required (`.nvmrc` pins the version — run `nvm use` before developing).
