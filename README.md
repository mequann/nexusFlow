# NexusFlow

**A Hybrid Camunda BPMN + n8n DAG Workflow & Process Orchestration Engine built with NestJS, TypeScript, and PostgreSQL.**

NexusFlow unifies **Camunda-grade stateful process orchestration** (long-lived tokens, human user tasks, DMN decision tables, message correlation, durable timers, incident recovery, and Saga reverse compensation) with **n8n-grade automation** (webhooks, cron schedules, sandboxed `{{ $trigger / $vars / $steps }}` expressions, HTTP connectors, and encrypted credential injection).

---

## Hybrid Feature Matrix

| Capability | Camunda BPMN Side | n8n Automation Side |
|---|---|---|
| **Triggers** | Start events & business correlation keys | `trigger.manual`, `trigger.webhook` (secret/HMAC), `trigger.cron` |
| **Flow Control** | Parallel fork/join barriers, durable wait states | `logic.if`, `logic.switch`, `logic.parallel`, `logic.join` |
| **Business Rules** | `bpmn.decision_table` (DMN-lite `FIRST` & `COLLECT` hit policies) | Sandboxed `{{ ... }}` expression & template engine |
| **Human-in-the-Loop** | `bpmn.user_task` (claim, complete, reject, form schema) | Dynamic payload mapping into task context |
| **Async Events** | `bpmn.message_catch`, `bpmn.timer` | `action.http` outbound connector with Credential Vault injection |
| **Fault Tolerance** | **Incidents** (inspect, retry, compensate, fail) & **Saga Compensation** | Exponential backoff + full jitter & per-host **Circuit Breaker** |

---

## Senior Backend Engineering Highlights

- **NestJS 11 + Clean Architecture**: Strict dependency inversion across `domain/`, `application/`, `infrastructure/`, and `interfaces/http/` with typed `DomainError` mapping, custom `ZodValidationPipe`, `AuthGuard`, `RateLimitGuard`, `CorrelationMetricsInterceptor`, and `IdempotencyInterceptor`.
- **PostgreSQL `FOR UPDATE SKIP LOCKED` & OCC**: Safe multi-worker job claiming and optimistic concurrency control (`occ_version`) on workflow instances, plus an in-memory `IUnitOfWork` adapter for zero-dependency local runs and fast testing.
- **Transactional Outbox Pattern**: State changes and domain events (`INSTANCE_STARTED`, `USER_TASK_CREATED`, `INCIDENT_OPENED`, `INSTANCE_COMPENSATED`, `INSTANCE_COMPLETED`) are committed atomically and relayed by `SchedulerWorker`.
- **Idempotency-Key Middleware**: Replays cached responses and returns `409 Conflict` if an `Idempotency-Key` is reused with a different request payload.
- **Security-First Design**:
  - JWT + SHA-256 hashed API Keys (`x-api-key`) with RBAC (`ADMIN`, `BUILDER`, `OPERATOR`, `VIEWER`).
  - **AES-256-GCM Credential Vault** with key rotation (`v1` / `v2`) — secrets are never returned by list endpoints and are redacted in Pino logs.
  - **SSRF Guard** validating outbound `action.http` URLs and DNS resolutions against loopback, RFC1918, and cloud metadata (`169.254.169.254`).
  - **Sandboxed Expression Parser**: Zero `eval()` or `new Function()`; blocks `__proto__`, `constructor`, and arbitrary function calls.
- **Observability & Graceful Shutdown**: Correlation/trace ID propagation via `AsyncLocalStorage`, `/healthz`, `/readyz`, `/metrics` (Prometheus), Swagger OpenAPI (`/docs`), and `SIGINT`/`SIGTERM` worker drain.

---

## Quick Start

### 1. Local Development (Zero External Dependencies)
```bash
npm install
cp .env.example .env
npm run dev
```
- API & Embedded Workers start on `http://localhost:3000`
- Swagger OpenAPI Docs: `http://localhost:3000/docs`
- Prometheus Metrics: `http://localhost:3000/metrics`

### 2. Full Production Stack (Docker Compose)
Starts **PostgreSQL 16**, **Redis 7**, **NestJS API**, **Standalone Worker**, **Prometheus**, and **Grafana**:
```bash
docker compose up --build
```

### 3. Verify Quality Gates
```bash
npm run typecheck   # Strict TypeScript check
npm run lint        # ESLint (zero 'any' allowed)
npm test            # Unit + NestJS Integration + Supertest E2E suite
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
| `POST /api/v1/workflows/:key/instances` | `instance:start` | Start workflow instance (supports `Idempotency-Key`) |
| `POST /webhooks/:path` | Webhook Secret | Trigger published webhook workflow |
| `GET /api/v1/instances/:id/trace` | `instance:read` | Full audit trace (tokens, steps, tasks, incidents) |
| `POST /api/v1/tasks/:id/claim` | `task:act` | Claim a human BPMN user task |
| `POST /api/v1/tasks/:id/complete` | `task:act` | Complete user task & resume waiting token |
| `POST /api/v1/messages/correlate` | `message:correlate` | Correlate business message to waiting token |
| `POST /api/v1/incidents/:id/resolve` | `incident:resolve` | Resolve incident (`RETRY`, `COMPENSATE`, `FAIL`) |
| `POST /api/v1/credentials` | `credential:write` | Encrypt & store third-party secret in vault |
| `GET /healthz`, `/readyz`, `/metrics` | Public | Liveness, readiness, and Prometheus telemetry |

---

## Documentation

- [Architecture & Engine Internals](docs/architecture.md)
- [Database Schema](migrations/001_initial_schema.sql)

