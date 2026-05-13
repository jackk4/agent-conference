# Agent Roles

Each role is a directory containing a `role.md` file that defines the agent's mindset, core concerns, and key questions. The `role` field in `agents.json` maps directly to the folder name.

For example, `"role": "QA"` loads `agent_roles/QA/role.md`.

## Available roles

| Role | Description |
|---|---|
| `QA` | Quality assurance engineer focused on correctness, coverage, and regression risk |
| `DevOps` | Infrastructure and CI/CD engineer focused on deployability and operational reliability |
| `Backend` | Backend engineer focused on APIs, data models, and server-side performance |
| `Frontend` | Frontend engineer focused on UI architecture, UX, and client-side performance |
| `Security` | Security engineer focused on threat modelling, vulnerabilities, and compliance |
| `Architecture` | Systems architect focused on long-term design, scalability, and trade-offs |
| `Data` | Data engineer focused on pipelines, storage, and analytical workloads |
| `Tech-Lead` | Technical lead focused on team velocity, pragmatic decisions, and cross-cutting concerns |
| `Performance` | Performance engineer focused on latency, throughput, profiling, and optimisation |
| `API-Design` | API design specialist focused on contracts, versioning, and developer experience |
| `Database` | Database engineer focused on schema design, indexing, and query optimisation |
| `Product` | Product manager focused on user value, priorities, and business impact |
| `Developer` | Generalist developer focused on implementation quality, maintainability, and pragmatism |

## Adding a new role

Create `agent_roles/<RoleName>/role.md` following the template in [`TEMPLATE.md`](TEMPLATE.md).
