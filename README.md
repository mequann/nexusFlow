# NexusFlow

**An Enterprise Hybrid Camunda BPMN + n8n Automation + Kissflow Case & Approval Engine built with NestJS, TypeScript, Drizzle ORM, and PostgreSQL.**

NexusFlow solves real-world business process problems (such as **Enterprise Procurement & CapEx Approval with ERP Sync**, **Employee Onboarding**, and **Compliance Workflows**) by unifying three platforms in one production-grade NestJS backend:

---

## Hybrid Feature Matrix (Camunda + n8n + Kissflow)

| Capability | Camunda BPMN | n8n Automation | Kissflow Case & Approvals |
|---|---|---|---|
| **Triggers & Intake** | Start events & correlation keys | `trigger.manual`, `trigger.webhook`, `trigger.cron` | Typed **Intake Form Schema** validation (`text`, `currency`, `select`, `email`, `date`) |
| **Flow & Rules** | `bpmn.decision_table` (DMN `FIRST` / `COLLECT`), fork/join barriers | `logic.if`, `logic.switch`, `action.transform`, `{{ ... }}` expressions | Ordered **Case Stages / Milestones** (`currentStage`, `progressPercent`) |
| **Human Approvals** | `bpmn.user_task` (claim, complete, reject) | Dynamic payload mapping into task context | **Multi-Approver Quorum** (`2 of N`), **Task Form Validation**, **OOO Delegation** |
| **SLAs & Escalation** | `bpmn.timer`, `bpmn.message_catch` | Webhook / HTTP callbacks | **Automated SLA Watchdog**, breach tracking & auto-escalation (`escalateTo`) |
| **Integrations** | External worker jobs (`SKIP LOCKED`) | `action.http` + AES-256-GCM **Credential Vault** + SSRF Guard + Circuit Breaker | **Case Portal & Collaboration Comments** (`GET /api/v1/cases/:id`) |
| **Fault Tolerance** | **Incidents** (retry, compensate, fail) & **Saga Compensation** | Exponential backoff + full jitter | Complete step, delegation, and approval audit trail |

---

## Senior Backend Stack & Patterns

- **NestJS 11 + Clean Architecture**: Strict dependency inversion across `domain/`, `application/`, `infrastructure/`, and `interfaces/http/` with `DomainExceptionFilter`, `ZodValidationPipe`, `AuthGuard`, `RateLimitGuard`, `CorrelationMetricsInterceptor`, and `IdempotencyInterceptor`.
- **Drizzle ORM + PostgreSQL**: Strongly-typed schema (`src/infrastructure/db/schema.ts`), `drizzle-kit` tooling, `FOR UPDATE SKIP LOCKED` multi-worker job claiming, Optimistic Concurrency Control (`occ_version`), and ACID **Transactional Outbox** (`PostgresUnitOfWork`), plus a `MemoryUnitOfWork` adapter for zero-dependency testing.
- **Security-First Design**:
  - JWT + SHA-256 hashed API Keys (`x-api-key`) with RBAC (`ADMIN`, `BUILDER`, `OPERATOR`, `VIEWER`).
  - **AES-256-GCM Credential Vault** with multi-key rotation (`v1` / `v2`) and Pino log redaction.
  - **SSRF Guard** validating outbound `action.http` URLs and DNS resolutions against loopback, RFC1918, and cloud metadata (`169.254.169.254`).
  - **Sandboxed Expression Parser**: Zero `eval()` or `new Function()`; blocks `__proto__`, `constructor`, and arbitrary function calls.
- **Observability & Graceful Shutdown**: `AsyncLocalStorage` correlation/trace propagation, `/healthz`, `/readyz`, `/metrics` (Prometheus), Swagger OpenAPI (`/docs`), and `SIGINT`/`SIGTERM` drain.

---

## PostgreSQL Connection Setup

Copy `.env.example` to `.env` and configure your PostgreSQL database using **either** a full connection URI or granular fields:

```env
STORAGE_DRIVER=postgres

# Option A: Full connection URI (takes precedence when set)
DATABASE_URL=postgres://user:password@your-postgres-host:5432/nexusflow

# Option B: Granular PostgreSQL settings (used when DATABASE_URL is omitted)
DB_HOST=your-postgres-host
DB_PORT=5432
DB_USER=nexusflow
DB_PASSWORD=your-strong-password
DB_NAME=nexusflow
DB_SSL=false
DB_POOL_MAX=20
```

Then run migrations, seed the real-world **Enterprise Procurement & CapEx Approval** workflow, and start the server:

```bash
npm install
npm run migrate     # Applies migrations/001_initial_schema.sql & 002_kissflow_case_sla.sql
npm run seed        # Seeds admin user + procurement-capex-approval workflow
npm run dev         # Starts NestJS API + embedded workers on http://localhost:3000
```

- **Swagger OpenAPI Docs**: `http://localhost:3000/docs`
- **Prometheus Metrics**: `http://localhost:3000/metrics`
- **Drizzle Studio**: `npm run db:studio`

### Full Docker Compose Stack
Starts PostgreSQL 16, Redis 7, NestJS API, Standalone Worker, Prometheus, and Grafana:
```bash
docker compose up --build
```

---

## Verification

```bash
npm run typecheck   # Strict TypeScript check
npm run lint        # ESLint (zero 'any' allowed)
npm test            # Unit + Hybrid Engine + Kissflow Procurement + HTTP E2E tests
npm run build       # Emit dist/
```

---

## API Overview

| Method & Path | Permission | Purpose |
|---|---|---|
| `POST /api/v1/auth/login` | Public | Exchange credentials for JWT |
| `POST /api/v1/auth/register` | `admin:users` | Create RBAC user |
| `POST /api/v1/auth/api-keys` | `admin:users` | Issue scoped `nxf_...` service key |
| `POST /api/v1/workflows` | `workflow:write` | Create workflow draft (supports `Idempotency-Key`) |
| `POST /api/v1/workflows/:id/publish` | `workflow:publish` | Validate DAG & publish immutable version |
| `POST /api/v1/workflows/:key/instances` | `instance:start` | Start workflow instance (validates intake form) |
| `POST /webhooks/:path` | Webhook Secret | Trigger published webhook workflow |
| `GET /api/v1/cases/:instanceId` | `instance:read` | Kissflow Case Portal (stages, progress %, SLA, tasks, comments) |
| `POST /api/v1/cases/:instanceId/comments` | `task:act` | Add collaboration comment to a case |
| `POST /api/v1/tasks/:id/claim` | `task:act` | Claim a human task |
| `POST /api/v1/tasks/:id/delegate` | `task:act` | Delegate / reassign a task (OOO handoff) |
| `POST /api/v1/tasks/:id/complete` | `task:act` | Submit task form & approval vote (supports quorum) |
| `POST /api/v1/messages/correlate` | `message:correlate` | Correlate business message to waiting token |
| `POST /api/v1/incidents/:id/resolve` | `incident:resolve` | Resolve incident (`RETRY`, `COMPENSATE`, `FAIL`) |
| `POST /api/v1/credentials` | `credential:write` | Encrypt & store third-party secret in vault |
| `GET /healthz`, `/readyz`, `/metrics` | Public | Liveness, readiness, and Prometheus telemetry |

---

## Documentation

- [Architecture & Engine Internals](docs/architecture.md)
- [Drizzle ORM Schema](src/infrastructure/db/schema.ts)
- [SQL Migrations](migrations/)
