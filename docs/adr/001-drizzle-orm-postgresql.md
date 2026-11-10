# ADR 001: Choosing Drizzle ORM over Prisma and TypeORM for PostgreSQL

- **Status**: Accepted
- **Context**: NexusFlow combines Camunda-style durable workflow orchestration, n8n-style event automation, and Kissflow-style case management on PostgreSQL. Its core execution loop relies on PostgreSQL-specific concurrency primitives, JSONB state payloads, partial indexes, and clean ACID transaction boundaries.

## Decision

We chose **Drizzle ORM** (`drizzle-orm/node-postgres` + `drizzle-kit`) for PostgreSQL persistence ([schema.ts](file:///c:/Users/mequanint.acham/Desktop/pfile/nexusflow/src/infrastructure/db/schema.ts) and [postgres-uow.ts](file:///c:/Users/mequanint.acham/Desktop/pfile/nexusflow/src/infrastructure/repositories/postgres/postgres-uow.ts)).

## Why Drizzle ORM Fits NexusFlow Best

| Criterion | Drizzle ORM | Prisma | TypeORM |
|---|---|---|---|
| **`FOR UPDATE SKIP LOCKED`** | Native `.for('update', { skipLocked: true })` in type-safe query builder | Not supported natively; requires unsafe `$queryRaw` | Stringly-typed `.setLock('pessimistic_partial_write')` |
| **Optimistic Concurrency (`occ_version`)** | Atomic `SET occ_version = occ_version + 1 WHERE id = $1 AND occ_version = $2 RETURNING *` | Requires middleware/raw SQL for single-query atomic bump | `@VersionColumn()` coupled to ActiveRecord/entity manager |
| **PostgreSQL `JSONB` Typing** | `jsonb('definition').$type<WorkflowGraphDefinition>()` with zero runtime overhead | `Json` is untyped `Prisma.JsonValue` | Untyped `jsonb` unless custom transformers added |
| **Runtime Footprint & Containers** | Pure TypeScript over `pg.Pool`; tiny Docker image, zero native binary mismatch | Bundles ~40MB Rust query-engine binary | Heavy reflection/decorator entity metadata |
| **Clean Architecture Isolation** | Maps cleanly to `IUnitOfWork` / repository interfaces without leaking ORM decorators into `src/domain/` | Generated client ties closely to Prisma schema types | Encourages `@Entity()` decorators inside domain models |

## Consequences

- `src/domain/` remains 100% framework- and ORM-free.
- `PostgresUnitOfWork` uses `drizzle-orm` inside `db.transaction(...)` to commit domain state changes and Transactional Outbox events atomically.
- `MemoryUnitOfWork` implements the identical `IUnitOfWork` port for fast unit/E2E testing without needing a database server.

