# Contributing

## Prerequisites

- **Node.js 20+** — use `.nvmrc` with `nvm use` to pin the version
- **GitHub Copilot CLI** installed and authenticated (`copilot --version` should work)

## Running locally

```bash
npm install
npm run dev "<your question>"
```

To pass agents explicitly:

```bash
npm run dev -- --agent "Frontend:./packages/web" --agent "Backend:./packages/api" "How should we handle auth?"
```

## Agent config (`agents.json`)

`agents.json` is personal and gitignored. Copy the example and edit it:

```bash
cp agents.example.json agents.json
# Edit agents.json to point at your repos and assign roles
```

Then run:

```bash
npm run dev -- --config agents.json "Your question"
```

## Adding a new role

1. Create `agent_roles/<RoleName>/role.md` — follow the template in [`agent_roles/TEMPLATE.md`](agent_roles/TEMPLATE.md).
2. Use `"role": "<RoleName>"` in `agents.json` or via `--agent "Name:./path:<RoleName>"`.

Role names are case-sensitive and must match the folder name exactly.

## Environment variables

Copy `.env.example` to `.env` and edit as needed. See `.env.example` for all supported variables.

## Build

```bash
npm run build       # compile TypeScript → dist/
npm start           # build + run compiled output
```
