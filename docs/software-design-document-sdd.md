# NexusFlow: Software Design Document (SDD)
## Unified Multi-Paradigm Workflow Orchestration Platform
### Reverse-Engineering Camunda, n8n, Kissflow, and Temporal into a Single Enterprise Engine

---

## 1. System Architecture & High-Level Design

NexusFlow is architected according to **Clean Architecture** and **Hexagonal (Ports & Adapters)** principles. Enterprise business rules have zero dependencies on web frameworks, database drivers, or third-party SDKs.

```mermaid
graph TD
    subgraph Interfaces ["Interfaces Layer (Presentation & HTTP)"]
        HTTP["NestJS Controllers & Swagger OpenAPI"]
        WEBHOOK["Webhook Signature Receiver"]
        STUDIO["React Flow Visual Studio & Case Desk"]
    end

    subgraph Application ["Application Layer (Use Cases & Engine)"]
        ENGINE["Unified WorkflowEngine<br>(Tokens · DAG · Sagas · Temporal)"]
        EXPR["Sandboxed AST Evaluator<br>(Zero eval / Function)"]
        SERVICES["TaskService · CaseService · OutboxService<br>CorrespondenceService · ImporterService"]
    end

    subgraph Domain ["Domain Layer (Enterprise Business Rules)"]
        STATE["Token & Instance State Machines"]
        RULES["GraphValidator · FormValidator · DecisionTable"]
        PORTS["IRepositoryRegistry · IUnitOfWork · ICredentialVault"]
        ETHIOPIA["Ge'ez Calendar Converter · DigitalSeal HMAC"]
    end

    subgraph Infrastructure ["Infrastructure Layer (Adapters)"]
        DB["PostgreSQL (Drizzle ORM) · SKIP LOCKED"]
        REDIS["Redis Distributed Lock & Sliding Rate Limiter"]
        VAULT["AES-256-GCM Envelope Encryption"]
        WORKERS["JobWorker · SchedulerWorker (Timers & SLA)"]
    end

    HTTP --> ENGINE
    HTTP --> SERVICES
    STUDIO --> HTTP
    ENGINE --> EXPR
    ENGINE --> PORTS
    SERVICES --> PORTS
    PORTS -.-> DB
    PORTS -.-> REDIS
    PORTS -.-> VAULT
    WORKERS --> ENGINE
```

---

## 2. End-to-End Architectural Flow Diagrams

### 2.1 Unified 4-in-1 Engine Execution Flow
This diagram illustrates how a single business case flows seamlessly across all four reverse-engineered paradigms:

```mermaid
sequenceDiagram
    autonumber
    actor User as Employee / System
    participant Webhook as n8n Webhook / Form
    participant Engine as NexusFlow Engine
    participant Camunda as BPMN Token Dispatcher
    participant Worker as Temporal External Worker
    participant Kissflow as Kissflow Consensus Desk
    participant DB as PostgreSQL (ACID Outbox)

    User->>Webhook: Submit Case (Dynamic Form / REST Webhook)
    Webhook->>Engine: Validate & Ingest Payload
    Engine->>DB: Start Instance & Insert OCC Token (Tx 1)
    Engine->>Camunda: Route Token across Split Gateways
    Camunda->>Worker: Enqueue External Activity (Topic: etl.payroll)
    
    loop Activity Heartbeating
        Worker->>Engine: POST /heartbeat (Progress: 35%, 70%, 100%)
        Engine->>DB: Extend Lock Expiry & Update Progress
    end

    Worker->>Engine: Complete External Task with Variables
    Engine->>Kissflow: Transition to Milestone Stage ('HR_REVIEW')
    Kissflow->>User: Assign Task with 48h SLA & Telegram Notification
    User->>Kissflow: Submit Quorum Decision (Majority Approved)
    Kissflow->>Engine: Check Quorum (2 of 2 Approvals Received)
    Engine->>DB: Commit Milestone & Emit Outbox Event (Tx 2)
```

---

### 2.2 Token Concurrency & Fork/Join Barrier Synchronization (Camunda)
NexusFlow implements strict Petri-net token semantics. When reaching a parallel gateway, the parent token transitions to `BRANCHING`, spawning child tokens. The join gateway waits for all parallel incoming tokens before continuing:

```mermaid
stateDiagram-v2
    [*] --> READY: Instance Created
    READY --> ACTIVE: Start Node Fired
    
    state ParallelExecution {
        ACTIVE --> FORK_PENDING: Split Gateway
        FORK_PENDING --> BranchA_Token: Spawn Child Token 1
        FORK_PENDING --> BranchB_Token: Spawn Child Token 2
        
        BranchA_Token --> JOIN_BARRIER: Step A Complete (5 steps)
        BranchB_Token --> JOIN_BARRIER: Step B Complete (9 steps)
    }

    JOIN_BARRIER --> MERGED: All Incoming Edges Satisfied
    MERGED --> COMPLETED: End Event Reached
    ACTIVE --> INCIDENT_OPEN: Unhandled Node Failure
    INCIDENT_OPEN --> ACTIVE: Operator Retry / Rewind
    ACTIVE --> CANCELLED: Terminated by Operator
```

---

### 2.3 Saga Reverse Rollback Compensation (Camunda)
When a multi-step distributed transaction experiences a terminal business failure downstream, NexusFlow traverses completed compensation-enabled steps in exact reverse chronological order:

```mermaid
sequenceDiagram
    autonumber
    participant Engine as WorkflowEngine
    participant Step1 as Step 1: Book Hotel
    participant Step2 as Step 2: Book Flight
    participant Step3 as Step 3: Debit Bank (FAILS)
    participant Comp2 as Compensate: Cancel Flight
    participant Comp1 as Compensate: Cancel Hotel

    Engine->>Step1: Execute Hotel Reservation
    Step1-->>Engine: Success (Register Handler: Comp1)
    Engine->>Step2: Execute Flight Reservation
    Step2-->>Engine: Success (Register Handler: Comp2)
    Engine->>Step3: Execute Bank Debit
    Step3-->>Engine: Business Failure (Insufficient Balance)
    
    Note over Engine: Initiate Saga Reverse Compensation
    Engine->>Comp2: Fire Flight Cancellation
    Comp2-->>Engine: Flight Refund Confirmed
    Engine->>Comp1: Fire Hotel Cancellation
    Comp1-->>Engine: Hotel Booking Released
    Note over Engine: Instance marked COMPENSATED
```

---

### 2.4 Temporal Point-in-Time Reset (Time Travel Rewind)
In production, bugs or third-party downtime often poison workflows. NexusFlow enables deterministic time travel:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as System Operator
    participant API as REST Control Plane
    participant Engine as WorkflowEngine
    participant State as Instance & Tokens
    participant Outbox as Transactional Outbox

    Admin->>API: POST /api/v1/instances/:id/reset { targetNodeId: 'STEP_1', varsOverride }
    API->>Engine: resetInstance(id, options)
    
    Note over Engine: 1. Fetch Instance & Verify Target Node in DAG
    Engine->>State: Cancel all active tokens (status -> CANCELLED)
    Engine->>State: Dismiss all active incidents (status -> DISMISSED)
    Engine->>State: Apply variable overrides & set status -> RUNNING
    Engine->>State: Spawn single fresh Token at targetNodeId
    Engine->>Outbox: Record 'INSTANCE_RESET' event in same ACID Tx
    
    Engine->>API: Return Reset Acknowledgment
    API->>Admin: 200 OK (Workflow Resumed from Target Node)
```

---

### 2.5 Multi-Party Consensus Quorum & 48h SLA Escalation (Kissflow)
Handles collaborative human decision-making with strict time boundaries and automated hierarchy escalation:

```mermaid
flowchart TD
    A["Task Created: Manager Review<br>(collaborationMode: Consensus, required: 2)"] --> B["Dispatch Telegram / In-App Notification"]
    B --> C{"Check Decision Arrival"}
    
    C -- "Approvals < 2 & Time < 48h" --> D["Accumulate Signature in approvalsReceived"]
    D --> C
    
    C -- "Approvals == 2" --> E["Consensus Quorum Achieved<br>Progress Token to Next Stage"]
    
    C -- "Elapsed Time > 40h" --> F["SLA Warning Alert (notifyBeforeHours: 8h)<br>Ping Assignees"]
    
    C -- "Elapsed Time >= 48h" --> G["SLA Breached (timeLimitHours: 48h)"]
    G --> H["SchedulerWorker Auto-Escalation<br>(Reassign to Department Director, Level + 1)"]
    H --> C
```

---

### 2.6 Ethiopian Digital Correspondence & Sealing Flow
Bilingual Ge'ez calendar document registry, minute sheets, and HMAC-SHA256 digital seals:

```mermaid
sequenceDiagram
    autonumber
    actor Creator as Registry Clerk
    actor Director as Department Director
    participant Service as CorrespondenceService
    participant Calendar as Ethiopian Calendar
    participant Crypto as Digital Seal Engine
    participant Public as Public QR Verifier

    Creator->>Service: Create Correspondence (INBOUND / OUTBOUND)
    Service->>Calendar: Convert UTC Date -> Ethiopian Date (e.g. ኅዳር 4 ቀን 2019 ዓ.ም)
    Service->>Service: Generate Ref Number (MInT/IN/2019/00001)
    
    Creator->>Director: Forward for Minute Review
    Director->>Service: Add Endorsement Minute ('RECOMMENDED', 'ተፈቅዷል')
    
    Director->>Service: POST /seal (Approve & Affix Official Seal)
    Service->>Crypto: Compute HMAC-SHA256(refNo + date + signatory + payload)
    Crypto-->>Service: Digital Seal & Verification URL with QR
    
    Public->>Service: GET /api/v1/verify/:id?code=8E7DB91699E1
    Service-->>Public: 200 OK (Official Certificate & Minute Endorsement Chain)
```

---

## 3. Data Architecture & Database Schema (Drizzle ORM)

### 3.1 Relational Entity Model
All entities are strictly partitioned by `tenant_id` for multi-tenant isolation:

```
+----------------------------------------------------------------------------------------------------+
|                                         POSTGRESQL SCHEMA                                          |
|                                                                                                    |
|  +--------------------+         +------------------------+         +----------------------------+  |
|  |     tenants        |<---+    |       workflows        |<---+    |     workflow_instances     |  |
|  +--------------------+    |    +------------------------+    |    +----------------------------+  |
|  | id (PK)            |    |    | id (PK)                |    |    | id (PK)                    |  |
|  | slug               |    +----| tenant_id (FK)         |    +----| workflow_id (FK)           |  |
|  | name               |    |    | key                    |    |    | tenant_id (FK)             |  |
|  | status             |    |    | version                |    |    | parent_instance_id         |  |
|  +--------------------+    |    | definition (JSONB)     |    |    | status (RUNNING/COMPLETED) |  |
|                            |    +------------------------+    |    | current_stage              |  |
|                            |                                  |    | sla_status (ON_TRACK/BREACH) |
|                            |                                  |    | variables (JSONB)          |  |
|                            |    +------------------------+    |    | occ_version (INT)          |  |
|                            +----|       user_tasks       |    |    | generation (INT)           |  |
|                            |    +------------------------+    |    | parent_close_policy        |  |
|                            |    | id (PK)                |    |    +----------------------------+  |
|                            |    | instance_id (FK)-------+----+                  |                 |
|                            |    | token_id               |                       |                 |
|                            |    | candidate_group        |                       v                 |
|                            |    | required_approvals     |         +----------------------------+  |
|                            |    | approvals_received     |         |      execution_tokens      |  |
|                            |    | due_at / sla_breached  |         +----------------------------+  |
|                            |    +------------------------+         | id (PK)                    |  |
|                            |                                       | instance_id (FK)           |  |
|                            |    +------------------------+         | current_node_id            |  |
|                            +----|     external_tasks     |         | status (ACTIVE/WAITING)    |  |
|                                 +------------------------+         +----------------------------+  |
|                                 | id (PK)                |                                         |
|                                 | topic                  |         +----------------------------+  |
|                                 | worker_id / locked_until|        |       outbox_events        |  |
|                                 | last_heartbeat_at      |         +----------------------------+  |
|                                 | progress (0-100)       |         | id (PK), event_type        |  |
|                                 +------------------------+         | payload, published_at      |  |
+--------------------------------------------------------------------+-------------------------------+
```

### 3.2 High-Throughput Concurrency & Locking Strategy
1. **Pessimistic Worker Claiming (`FOR UPDATE SKIP LOCKED`)**:
   Background workers poll `external_tasks` and `scheduled_jobs` using non-blocking row-level locks, completely preventing lock contention across 50+ concurrent worker pods.
2. **Optimistic Concurrency Control (OCC)**:
   Workflow instance mutations check `WHERE id = :id AND occ_version = :expectedVersion`. Any concurrent token advancement increments `occ_version`. In case of a collision, the transaction rolls back cleanly and retries with full jitter.

---

## 4. Security & Cryptographic Model

1. **Envelope-Encrypted Credential Vault (AES-256-GCM)**:
   Third-party API keys and OAuth tokens are never stored in plain text. Stored records include 96-bit initialization vectors (`iv`), 128-bit authentication tags (`authTag`), and support zero-downtime key rotation (`VAULT_MASTER_KEY_V1` / `V2`).
2. **SSRF Guard & Outbound Firewall**:
   All dynamic HTTP actions resolve hostnames to IP addresses before initiating requests. Any attempt to reach loopback (`127.0.0.1`), private RFC1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), or cloud metadata endpoints (`169.254.169.254`) throws a fatal `SecurityViolationError`.
3. **Cryptographic Digital Seal (HMAC-SHA256)**:
   Documents and correspondence endorsements are signed using a server-side HMAC secret. Verification URLs contain truncated authentication digests (`code=8E7DB91699E1`) allowing instant public ledger verification without exposing private keys.

---

## 5. Verification & Compliance Standards

- **BPMN 2.0 Compliance**: Parallel Split, Parallel Join, Call Activity, User Task, Service Task, Boundary Timer, Intermediate Message Catch.
- **DMN 1.3 Compliance**: Single-hit (`FIRST`) and multi-hit (`COLLECT`) decision logic.
- **PACELC / CAP Properties**: Consistent (CP) on state transitions within a partition; Available (AP) on read-only live queries and external task polling.
- **Zero-Downtime Migration**: PostgreSQL schema managed via idempotent Drizzle migrations.

