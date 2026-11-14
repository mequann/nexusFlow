# NexusFlow Enterprise End-User & Administrator Manual

Welcome to **NexusFlow**, an enterprise-grade digital automation, process orchestration, and paperless office platform.

---

## 1. Role-Based Access Control & User Personas

NexusFlow tailors its user interface according to your specific role and departmental responsibilities:

| Role | Default Demo Account | Password | Primary Capabilities & Responsibilities |
| :--- | :--- | :--- | :--- |
| **`ADMIN`** | `admin@nexusflow.local` | `AdminChangeMe123!` | Full system administration, user management, security vault, cluster health, and system audit logs. |
| **`HR`** | `hr@nexusflow.local` | `AdminChangeMe123!` | HR People Operations, consensus reviews, recruitment requisitions, performance evaluations, and employee transfers. |
| **`OPERATOR`** | `operator@nexusflow.local` | `AdminChangeMe123!` | Live process monitoring, incident triage, retry policies, and Temporal state rewind ("time travel"). |
| **`BUILDER`** | `builder@nexusflow.local` | `AdminChangeMe123!` | Visual workflow designer, BPMN 2.0 import/export, form schema creation, and integration connectors. |
| **`VIEWER`** | `viewer@nexusflow.local` | `AdminChangeMe123!` | Read-only executive reports, business case audit trails, and compliance inspection. |
| **`USER`** | `user@nexusflow.local` | `AdminChangeMe123!` | Employee Self-Service portal, submitting store requisitions (Model 20), per diem travel requests, and tracking approval status. |

---

## 2. Getting Started & Logging In

1. Open NexusFlow in your web browser: `http://localhost:3000` (or your company's internal URL).
2. Enter your corporate email and password, or use the **Quick Role Login** buttons in the header to switch perspectives instantly during testing and training.
3. If your company uses **Single Sign-On (SSO)** (e.g. Microsoft 365, Google Workspace, or Keycloak), select **"Log in with Corporate SSO"**. Your profile and permissions will be synchronized automatically.

---

## 3. Employee Self-Service Desk & Service Catalog (`USER` Perspective)

As an employee or general user, you start in the **Self-Service Desk**:

```
┌──────────────────────────────────────────────────────────┐
│                   Service Catalog                        │
│                                                          │
│  [ Ethiopian Store Model 20 ]   [ Per Diem Field Travel ]│
│  Request stationary or assets   Submit mission & per diem│
│                                                          │
│  [ CapEx Procurement ]          [ IT Support & Hardware ]│
│  Requisition for equipment      Request hardware support │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Submitting an Ethiopian Store Requisition (የዕቃ መጠየቂያ ሞዴል 20)
1. In the Service Catalog, select **"Ethiopian Store Issue Voucher (Model 20)"**.
2. Complete the bilingual form fields:
   * **Requester Full Name** (የጠያቂው ሙሉ ስም)
   * **Department** (ክፍል / ዳይሬክቶሬት)
   * **Purpose of Requisition** (የፍጆታው ምክንያት)
   * **Requested Items** (የዕቃዎች ዝርዝር)
   * **Quantity** (መጠን)
3. Attach any supporting justification document or quotation scan via the Document Vault.
4. Click **"Submit Requisition"**.
5. Your request is immediately submitted into the approval hierarchy with a unique tracking case number.

### 3.2 Tracking Your Requests
* View the **"My Requests & Progress"** section at the bottom of the portal.
* Live status badges indicate if your request is `RUNNING`, `WAITING` on manager review, or `COMPLETED`.

---

## 4. Human Approval & Task Inbox

When a process requires your decision, an approval notification appears in your inbox:

1. Click on **"Approval Inbox"** in the navigation bar.
2. Select the pending task from the list.
3. Review the requester's form details, attached justification files, and case notes.
4. Take action:
   * **Approve**: Authorize the request to continue to the next stage.
   * **Reject**: Return the request with feedback comments.
   * **Delegate / Reassign**: Assign the task to a deputy or specialized reviewer.

---

## 5. Visual Workflow Designer & BPMN 2.0 Interoperability (`BUILDER` & `ADMIN`)

### 5.1 Importing a BPMN 2.0 XML Diagram
NexusFlow supports standard BPMN 2.0 files exported from **Camunda Modeler**, **Signavio**, or **BPMN.io**:

1. Navigate to the **"Workflows"** tab.
2. Click the **"Import BPMN 2.0"** button at the top right.
3. Select any `.bpmn` or `.xml` file from your computer.
4. NexusFlow automatically parses start events, user tasks, automated service steps, exclusive gateways, and sequence flows, creating a new executable workflow draft.

### 5.2 Exporting a Workflow to BPMN 2.0
1. Select any workflow in the **"Workflows"** list.
2. Click **"Export BPMN 2.0"** in the top action bar.
3. The browser will download a standard XML file (`<key>.bpmn`) containing the complete process schema and diagram coordinates (`<bpmndi:BPMNDiagram>`).

### 5.3 Drag-and-Drop Visual Designer
* Create sequential and parallel branches visually without writing code.
* Configure human forms, approval conditions, automated HTTP webhooks, and retry policies.
* Save drafts and click **"Publish Version"** to deploy zero-downtime versioned workflows.

---

## 6. Document Vault & Attachment Storage

The **Document Vault** securely manages all organizational attachments, requisition receipts, contracts, and digital PDFs.

1. Navigate to **"Document Vault & Storage"** in the navigation bar.
2. View key metrics:
   * **Active Storage Driver**: Local High-Speed NVMe, PostgreSQL binary chunks, or S3-compatible cloud storage (e.g. Ethio Telecom telecloud).
   * **Total Document Volume**: Total file count and payload size.
   * **Audit Integrity**: Cryptographic SHA-256 hash for every file.
3. **Uploading Documents**: Click **"Upload Document"**, choose any PDF, image, spreadsheet, or scan.
4. **Downloading Documents**: Click **"Download"** next to any record to retrieve the original file with verified cryptographic integrity.
5. **Search & Filter**: Find files instantly by filename, MIME type, or uploader.

---

## 7. Official Correspondence Registry & Digital Seals

For government ministries, corporate headquarters, and institutional offices, NexusFlow provides an official paperless registry:

1. Navigate to **"Official Registry & Seals"**.
2. **Inbound Correspondence**: Register incoming official letters with external dispatch numbers, sender organizations, and subject classifications.
3. **Internal Minutes**: Add internal directorial instructions, notes, and routing actions.
4. **Outbound Seals & Digital Verification**:
   * Generate official outgoing letters with tamper-evident digital verification URLs and QR codes.
   * The public or receiving counterparties can verify document authenticity at `https://nexusflow.et/verify/<documentId>`.
   * Displays the official Ethiopian Ge'ez Calendar date alongside Gregorian equivalents.

---

## 8. Incident Recovery & Temporal Control Panel (`OPERATOR`)

When an external microservice or third-party API is temporarily unavailable:

1. Navigate to **"Incidents & Workers"**.
2. An incident card highlights the failing step, the exact HTTP status code, and error trace.
3. Resolve the issue:
   * **Retry Node**: Re-execute the step once the external service has recovered.
   * **Temporal State Rewind (Time-Travel)**: Under the **Temporal Ops** panel, operators can roll an execution back to a previous safe step, update input variables, and resume forward execution cleanly.

