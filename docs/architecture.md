# NexusFlow Architecture

NexusFlow combines **Camunda-style stateful BPMN process orchestration** with **n8n-style DAG automation & expression-driven connectors** in a single **NestJS + TypeScript** backend built on **Clean Architecture**.

## Layered Boundaries

```
src/
├── domain/                  # Pure enterprise business rules (0 framework dependencies)
│   ├── errors.ts            # Typed DomainError hierarchy -> HTTP status mapping
│   ├── ports/               # Repository, UnitOfWork, ICredentialVault, Telemetry ports
│   ├── workflow/            # Graph validator (cycle/reachability/join checks) & DMN evaluator
│   ├── execution/           # Token/Instance/Task state machines & lifecycle types
│   └── security/            # RBAC roles & granular permissions matrix
├── application/             # Use cases, orchestration engine, sandboxed expressions
│   ├── engine/              # WorkflowEngine (token routing, fork/join barrier, Saga, incidents)
│   ├── expressions/         # Recursive-descent AST-safe {{ ... }} evaluator (zero eval/Function)
│   └── services/            # Auth, Workflow, Task, Incident, Message, Credential services
├── infrastructure/          # Concrete adapters
│   ├── db/                  # pg.Pool & idempotent SQL migration runner
│   ├── repositories/        # PostgresUnitOfWork (SKIP LOCKED + OCC) & MemoryUnitOfWork
│   ├── security/            # AES-256-GCM Credential Vault, scrypt hashing, SSRF CIDR guard
│   ├── resilience/          # Per-host Circuit Breaker & exponential backoff w/ full jitter
│   ├── observability/       # AsyncLocalStorage context, Pino redaction, Prometheus metrics
│   └── workers/             # JobWorker & SchedulerWorker (timers, cron, outbox relay)
└── interfaces/http/         # NestJS REST API, Guards, Interceptors, Pipes, Swagger OpenAPI
```

## Key Senior Backend Patterns

1. **Token-Based Hybrid Execution (`WorkflowEngine`)**
   - Supports n8n-style DAG triggers (`trigger.manual`, `trigger.webhook`, `trigger.cron`), data transforms (`action.transform`), HTTP connectors (`action.http`), conditional routing (`logic.if`, `logic.switch`), and parallel fan-out/fan-in (`logic.parallel` / `logic.join`).
   - Supports Camunda-style long-running BPMN states (`bpmn.user_task`, `bpmn.timer`, `bpmn.message_catch`), DMN decision tables (`bpmn.decision_table` with `FIRST` / `COLLECT` hit policies), operational **Incidents**, and **Saga reverse compensation**.
2. **PostgreSQL `FOR UPDATE SKIP LOCKED` + Optimistic Concurrency Control**
   - Multiple horizontal workers safely claim jobs without double execution.
   - `workflow_instances.occ_version` prevents lost variable/state updates under concurrent parallel branches.
3. **Transactional Outbox Pattern**
   - Domain state mutations and `outbox_events` inserts happen inside a single ACID transaction, relayed asynchronously by `SchedulerWorker`.
4. **Defense-in-Depth Security**
   - JWT + scoped SHA-256 hashed API keys (`nxf_...`) with 4-role RBAC (`ADMIN`, `BUILDER`, `OPERATOR`, `VIEWER`).
   - AES-256-GCM Credential Vault with key rotation (`VAULT_MASTER_KEY_V1` / `V2`).
   - SSRF Guard blocking loopback, RFC1918 private networks, IPv6 ULA, and cloud metadata (`169.254.169.254`).
   - Safe recursive-descent expression parser rejecting `__proto__` / `constructor` / arbitrary functions.

