# NexusFlow 100% Free Tier Deployment Guide

This guide details step-by-step instructions to deploy NexusFlow to production **at $0.00 / month** using free-tier cloud platforms or private on-premise infrastructure.

---

## Architecture Summary: Zero-Cost Cloud Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Browser / Mobile                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼─────────────────────────────────┐
│              Render.com / Koyeb (Free Web Service)               │
│                                                                 │
│   NexusFlow Container (Port 3000)                               │
│   ├── NestJS REST API & Workflow Engine                         │
│   ├── Embedded Asynchronous Workers                             │
│   └── Pre-bundled React Studio UI (Served from /frontend/dist)  │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ SSL                           │ AWS SigV4
┌───────────────▼───────────────┐ ┌─────────────▼─────────────────┐
│      Neon.tech / Supabase     │ │        Cloudflare R2          │
│   Serverless PostgreSQL 16/17 │ │  10 GB Free S3 Object Storage │
│   (500 MB Free Tier)          │ │  (Zero Egress / Bandwidth Fee)│
└───────────────────────────────┘ └───────────────────────────────┘
```

---

## Strategy 1: 100% Free Cloud Deployment (Neon + Render + Cloudflare R2)

### Step 1: Provision Free Serverless PostgreSQL on Neon.tech
1. Go to [Neon.tech](https://neon.tech) and create a free account.
2. Create a new project (e.g. `nexusflow-prod`).
3. Under **Dashboard**, copy your PostgreSQL connection string:
   ```
   postgres://username:password@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Run migrations from your local terminal against your Neon database:
   ```bash
   DATABASE_URL="postgres://username:password@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require" npm run migrate
   ```

---

### Step 2: (Optional) Create Free S3 Storage on Cloudflare R2
*(If you prefer not to use an external S3 bucket, skip this step and set `FILE_STORAGE_DRIVER=database` or `local`.)*

1. Sign up for a free account at [Cloudflare](https://dash.cloudflare.com).
2. Go to **R2 Object Storage** and click **Create bucket** (e.g., `nexusflow-documents`).
3. Click **Manage R2 API Tokens** -> **Create API Token** (Permissions: Object Read & Write).
4. Note your credentials:
   * **Endpoint**: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   * **Access Key ID**: `<R2_ACCESS_KEY_ID>`
   * **Secret Access Key**: `<R2_SECRET_ACCESS_KEY>`
   * **Bucket**: `nexusflow-documents`
   * **Region**: `auto` (or `us-east-1`)

---

### Step 3: Deploy to Render.com (or Koyeb)
1. Go to [Render.com](https://render.com) and create an account.
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository: `mequann/nexusFlow`.
4. Choose **Environment: Docker** (Render will automatically detect the [Dockerfile](file:///c:/Users/mequanint.acham/Desktop/pfile/products/nexusflow/Dockerfile)).
5. Select the **Free Instance Type**.
6. Under **Environment Variables**, add:

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Production optimizations |
| `PORT` | `3000` | HTTP port |
| `STORAGE_DRIVER` | `postgres` | Persist workflows & cases |
| `DATABASE_URL` | `<Your-Neon-PostgreSQL-URL>?sslmode=require` | Database connection |
| `DB_SSL` | `true` | Required for Neon/Supabase SSL |
| `CLUSTER_LOCK_DRIVER` | `postgres_advisory` | Distributed clustering via PostgreSQL Advisory Locks ($0 Redis cost) |
| `FILE_STORAGE_DRIVER` | `database` *(or `s3_compatible` if using Cloudflare R2)* | Attachments & document vault |
| `FILE_STORAGE_S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | Cloudflare R2 endpoint (if using R2) |
| `FILE_STORAGE_S3_BUCKET` | `nexusflow-documents` | Bucket name |
| `FILE_STORAGE_S3_ACCESS_KEY` | `<R2_ACCESS_KEY_ID>` | API Access Key |
| `FILE_STORAGE_S3_SECRET_KEY` | `<R2_SECRET_ACCESS_KEY>` | API Secret Key |
| `ENABLE_EMBEDDED_WORKERS` | `true` | Runs background jobs inside the single container |
| `JWT_SECRET` | `prod-secret-replace-with-a-random-32-char-string` | JWT token encryption |
| `VAULT_MASTER_KEY_V1` | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` | AES-256 vault master key |
| `BOOTSTRAP_ADMIN_EMAIL` | `admin@nexusflow.local` | Initial admin account |
| `BOOTSTRAP_ADMIN_PASSWORD` | `ChangeMeSecurePass2026!` | Initial admin password |

7. Click **Create Web Service**.
8. Within ~3 minutes, Render builds the container and serves your application at:
   `https://nexusflow-xxxx.onrender.com`
   Both the backend API and the full bilingual Web Studio UI are live!

---

## Strategy 2: 100% Free On-Premises or Private Server (Docker Compose)

For local testing, internal corporate networks, or self-hosted VPS servers (e.g. Hetzner, Contabo, or local corporate servers):

```bash
# 1. Clone repository
git clone git@github-personal:mequann/nexusFlow.git
cd nexusFlow

# 2. Configure production secrets in .env
cp .env.example .env

# 3. Launch the full stack (PostgreSQL + Redis + NexusFlow API + Web Studio)
docker compose up -d

# 4. Open in browser
# http://localhost:3000
```

### Advantages of the On-Premise Docker Compose Setup:
* **Zero Cloud Dependency**: Everything runs inside your private network.
* **Persistent Volumes**: Database (`pgdata`) and document vault (`nflowdata`) are automatically mounted to host disks.
* **Embedded Prometheus & Grafana**: Access metrics dashboards out-of-the-box at `http://localhost:3001`.

---

## Strategy 3: Ethiopian Enterprise Cloud (Ethio Telecom Cloud / telecloud)

For Ethiopian government ministries, state corporations, and national enterprises requiring in-country data residency:

1. Configure `.env`:
   ```env
   FILE_STORAGE_DRIVER=s3_compatible
   FILE_STORAGE_S3_ENDPOINT=https://s3.telecloud.et
   FILE_STORAGE_S3_BUCKET=your-telecloud-bucket
   FILE_STORAGE_S3_ACCESS_KEY=your-ethio-telecom-access-key
   FILE_STORAGE_S3_SECRET_KEY=your-ethio-telecom-secret-key
   FILE_STORAGE_S3_REGION=us-east-1
   FILE_STORAGE_S3_FORCE_PATH_STYLE=true
   ```
2. NexusFlow's built-in **AWS SigV4 authentication engine** connects to `s3.telecloud.et` without installing any external AWS SDKs.
3. Concurrency locking runs natively via PostgreSQL Advisory Locks (`CLUSTER_LOCK_DRIVER=postgres_advisory`), eliminating the need to deploy and manage a Redis cluster.
