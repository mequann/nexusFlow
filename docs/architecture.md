# NexusFlow Architecture: Unified 4-in-1 Workflow & Orchestration Engine

NexusFlow is an enterprise-grade orchestration platform reverse-engineering and fusing the four leading paradigm-defining workflow systems into a **single, unified, and cohesive runtime**:

```
+---------------------------------------------------------------------------------------------------------+
|                                        NEXUSFLOW UNIFIED PLATFORM                                       |
|                                                                                                         |
|   [ CAMUNDA ]                 [ n8n ]                     [ KISSFLOW ]             [ TEMPORAL ]         |
|   - BPMN 2.0 Tokens           - Safe {{ expr }} Engine    - Case & Milestones      - Time-Travel Reset  |
|   - Fork/Join Barriers        - Dynamic Connectors        - Intake & Task Forms    - Activity Heartbeat |
|   - External Worker Polling   - AES-256 Vault             - Quorum Consensus       - ParentClosePolicy  |
|   - DMN Decision Tables       - Webhook Ingestion         - 48h SLA Escalation     - ContinueAsNew      |
|   - Saga Reverse Rollback     - SSRF & Circuit Breaker    - Digital Minute Sheets  - Live Sync Query    |
+---------------------------------------------------------------------------------------------------------+
|                                         CORE WORKFLOW ENGINE                                            |
|                  State Machine · Dependency Graph · OCC Locks · Outbox Dispatcher                       |
+---------------------------------------------------------------------------------------------------------+
|                                     CLEAN ARCHITECTURE PERSISTENCE                                      |
|                  NestJS 10 · Drizzle ORM · PostgreSQL (FOR UPDATE SKIP LOCKED) · Redis                  |
+---------------------------------------------------------------------------------------------------------+
```

---

## 1. The Four Synthesized Pillars

| System | What NexusFlow Reverse Engineers | NexusFlow Implementation & Module |
|---|---|---|
| **Camunda** | Stateful BPMN 2.0 execution, Parallel split/join synchronization barriers, DMN Decision Tables (`FIRST` / `COLLECT`), external task worker polling (`fetch-and-lock`), message catch correlation, Cockpit incident recovery, and Saga reverse rollback handlers. | `src/application/engine/workflow-engine.ts`<br>`src/application/services/external-task-service.ts`<br>`src/domain/workflow/decision-table.ts`<br>`src/application/services/incident-service.ts` |
| **n8n** | Data pipelining and flow automation, sandboxed AST-safe recursive expressions (`{{ $trigger / $vars / $steps }}`), dynamic HTTP connectors, webhook triggers with signature verification, AES-256-GCM Credential Vault, and SSRF security guards. | `src/application/expressions/evaluator.ts`<br>`src/domain/workflow/validator.ts`<br>`src/infrastructure/security/crypto-vault.ts`<br>`src/infrastructure/security/ssrf-guard.ts` |
| **Kissflow** | Case-centric workflow portal, multi-stage milestone tracking (`stages`, `progressPercent`), dynamic forms with strict validation rules, approval matrices with consensus quorum (`Majority`, `All`, `Any`), SLA countdowns with auto-escalation, and threaded audit minutes. | `src/domain/workflow/form-validator.ts`<br>`src/application/services/case-service.ts`<br>`src/application/services/task-service.ts`<br>`src/infrastructure/workers/scheduler-worker.ts` |
| **Temporal** | Resilient code-first orchestration primitives: Point-in-Time Reset (time-travel rewind with variable overrides and token resumption), Activity Heartbeating ($0-100\%$ progress reporting without timeout), ParentClosePolicy cascade cancellation (`TERMINATE`, `ABANDON`, `REQUEST_CANCEL`), Continue-As-New history compaction, and Synchronous Live Workflow Queries. | `src/domain/execution/types.ts`<br>`src/domain/execution/state-machine.ts`<br>`src/application/engine/workflow-engine.ts`<br>`POST /api/v1/instances/:id/reset`<br>`POST /api/v1/instances/:id/continue-as-new`<br>`POST /api/v1/instances/:id/query` |

---

## 2. Layered Boundaries

```
src/
├── domain/                  # Pure enterprise business rules (0 framework dependencies)
│   ├── errors.ts            # Typed DomainError hierarchy -> HTTP status mapping
│   ├── ports/               # Repository, UnitOfWork, ICredentialVault, Telemetry ports
│   ├── workflow/            # Graph validator, DMN evaluator, Form Schema validator, Tenant Import
│   ├── execution/           # Token/Instance/Task/ExternalTask/Case state machines & types
│   ├── localization/        # Ethiopian Ge'ez calendar anchor converter (13 months)
│   └── security/            # RBAC roles, Digital Seals (HMAC-SHA256) & permissions matrix
├── application/             # Use cases, orchestration engine, sandboxed expressions
│   ├── engine/              # WorkflowEngine (BPMN tokens, Temporal reset/continueAsNew/queries, Saga)
│   ├── expressions/         # Recursive-descent AST-safe {{ ... }} evaluator (zero eval/Function)
│   ├── services/            # Task (Quorum/Delegate/SLA), Case, Correspondence, Telegram, Importer
│   └── templates/           # Ethiopian Model 20 store voucher & Field mission per-diem definitions
├── infrastructure/          # Concrete adapters
│   ├── db/                  # Drizzle ORM PostgreSQL schema (schema.ts), pg.Pool, SQL migrator
│   ├── repositories/        # Drizzle PostgresUnitOfWork (SKIP LOCKED + OCC) & MemoryUnitOfWork
│   ├── security/            # AES-256-GCM Credential Vault, scrypt hashing, SSRF CIDR guard
│   ├── resilience/          # Per-host Circuit Breaker & exponential backoff w/ full jitter
│   ├── observability/       # AsyncLocalStorage context, Pino redaction, Prometheus metrics
│   └── workers/             # JobWorker & SchedulerWorker (timers, cron, SLA escalations, outbox)
└── interfaces/http/         # NestJS REST API, Guards, Interceptors, Pipes, Swagger OpenAPI
```

---

## 3. Unified Execution Engine

The beauty of NexusFlow is that these four systems do not exist as disparate microservices or taped-together scripts. They operate on **one unified execution token and case model**:

1. An **n8n Webhook** or **Kissflow Self-Service Form** initiates a workflow instance.
2. The engine evaluates **Camunda BPMN token routing** with parallel forks and DMN decision tables.
3. If an activity is long-running, an external worker polls it via **Camunda fetch-and-lock** while reporting **Temporal activity heartbeats and percentage progress**.
4. If a business policy requires human consent, the step transitions to a **Kissflow consensus quorum** with SLA countdowns and Amharic minute sheets (*የማስታወሻ ቅጽ*).
5. If an unexpected operational error occurs, operators can execute a **Temporal Point-in-Time Reset** to rewind the workflow back to any prior step without losing state or corrupting the database.
6. Periodic cycles compact automatically using **Temporal Continue-As-New**.
7. If unrecoverable errors occur in a distributed transaction, the **Camunda Saga compensation engine** fires backward rollback handlers in exact reverse order.

2. **Drizzle ORM + PostgreSQL `FOR UPDATE SKIP LOCKED` + Optimistic Concurrency Control**
   - Strongly-typed Drizzle schema in [schema.ts](file:///c:/Users/mequanint.acham/Desktop/pfile/nexusflow/src/infrastructure/db/schema.ts) and Drizzle Unit of Work in [postgres-uow.ts](file:///c:/Users/mequanint.acham/Desktop/pfile/nexusflow/src/infrastructure/repositories/postgres/postgres-uow.ts).
   - Multi-worker job claiming via `.for('update', { skipLocked: true })` and `workflow_instances.occ_version` checks.
3. **Transactional Outbox Pattern**
   - Domain mutations and `outbox_events` inserts commit in one ACID Drizzle transaction and are relayed asynchronously by `SchedulerWorker`.
4. **Defense-in-Depth Security & Multi-Tenancy**
   - **Enterprise Multi-Tenancy**: Native `tenant_id` partitioning across all core tables (`tenants`, `workflows`, `workflow_instances`, `user_tasks`, `notifications`, `credentials`, `users`, `api_keys`). Tenants have completely isolated workflow definitions (composite unique constraint `(tenant_id, key, version)`), independent instances, and isolated credentials.
   - JWT + SHA-256 hashed API keys (`nxf_...`) with 4-role RBAC (`ADMIN`, `BUILDER`, `OPERATOR`, `VIEWER`), carrying embedded `tenantId`.
   - AES-256-GCM Credential Vault with key rotation (`VAULT_MASTER_KEY_V1` / `V2`) scoped by tenant.
   - SSRF Guard blocking loopback, RFC1918 private networks, IPv6 ULA, and cloud metadata (`169.254.169.254`).
