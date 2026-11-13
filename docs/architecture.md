# NexusFlow Architecture

NexusFlow combines **Camunda-style stateful BPMN process orchestration**, **n8n-style DAG automation & encrypted integrations**, and **Kissflow-style business case management, forms, SLAs, escalations, and approvals** in a single **NestJS + TypeScript + Drizzle ORM + PostgreSQL** backend built on **Clean Architecture**.

## Layered Boundaries

```
src/
├── domain/                  # Pure enterprise business rules (0 framework dependencies)
│   ├── errors.ts            # Typed DomainError hierarchy -> HTTP status mapping
│   ├── ports/               # Repository, UnitOfWork, ICredentialVault, Telemetry ports
│   ├── workflow/            # Graph validator, DMN evaluator, Kissflow Form Schema validator
│   ├── execution/           # Token/Instance/Task/CaseComment state machines & types
│   └── security/            # RBAC roles & granular permissions matrix
├── application/             # Use cases, orchestration engine, sandboxed expressions
│   ├── engine/              # WorkflowEngine (token routing, fork/join barrier, Saga, incidents)
│   ├── expressions/         # Recursive-descent AST-safe {{ ... }} evaluator (zero eval/Function)
│   └── services/            # Auth, Workflow, Task (Quorum/Delegate/SLA), Case, Incident, Message, Credential
├── infrastructure/          # Concrete adapters
│   ├── db/                  # Drizzle ORM PostgreSQL schema (schema.ts), pg.Pool, SQL migrator
│   ├── repositories/        # Drizzle PostgresUnitOfWork (SKIP LOCKED + OCC) & MemoryUnitOfWork
│   ├── security/            # AES-256-GCM Credential Vault, scrypt hashing, SSRF CIDR guard
│   ├── resilience/          # Per-host Circuit Breaker & exponential backoff w/ full jitter
│   ├── observability/       # AsyncLocalStorage context, Pino redaction, Prometheus metrics
│   └── workers/             # JobWorker & SchedulerWorker (timers, cron, SLA escalations, outbox)
└── interfaces/http/         # NestJS REST API, Guards, Interceptors, Pipes, Swagger OpenAPI
```

## Key Senior Backend Patterns

1. **Unified Camunda + n8n + Kissflow Execution (`WorkflowEngine`, `TaskService`, `CaseService`)**
   - **Camunda**: Stateful tokens, `logic.parallel` / `logic.join` barriers, `bpmn.user_task`, `bpmn.timer`, `bpmn.message_catch`, `bpmn.decision_table` (`FIRST` & `COLLECT`), Incidents, and Saga reverse compensation.
   - **n8n**: `trigger.webhook`, `trigger.cron`, `action.http`, `action.transform`, safe `{{ $trigger / $vars / $steps }}` expression engine, AES-256-GCM Credential Vault, Circuit Breaker, and SSRF guard.
   - **Kissflow**: Typed intake & task form schemas (`validateFormSubmission`), ordered milestone stages (`currentStage`, `progressPercent`), multi-approver quorum (`requiredApprovals`), OOO task delegation (`POST /api/v1/tasks/:id/delegate`), automated SLA breach detection & escalation (`SchedulerWorker`), and Case collaboration comments (`POST /api/v1/cases/:instanceId/comments`).
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
