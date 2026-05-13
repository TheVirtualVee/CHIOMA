# CHIOMA

**A stateful commercial trust runtime that operates as a bounded digital employee via WhatsApp.**

CHIOMA is not a chatbot. It is not a dashboard SaaS. It is a deterministic, event-sourced execution runtime that businesses deploy to handle customer commitments, follow-ups, escalations, and business memory — reliably — through WhatsApp.

---

## What it does

- Receives WhatsApp messages from customers
- Classifies intent deterministically (no hallucination)
- Tracks commitments with explicit validation gates
- Escalates overdue commitments to the business owner
- Persists every interaction as an immutable event log
- Replays from cold state after crashes or redeployments
- Delivers responses via WhatsApp with retry guarantees

The WhatsApp thread is the product surface. Dashboards are internal-only operational tools.

---

## Architecture

```
WhatsApp → Vercel Webhook → Supabase Event Log → Render Worker → WhatsApp
                                      ↕
                               Consumer Workers
                          (commitment, escalation, memory)
```

**Deployment surfaces:**

| Surface | Platform | Purpose |
|---------|----------|---------|
| `apps/webhook/` | Vercel | Webhook handler, health, admin API |
| `apps/worker/` | Render | Consumer workers, long-lived processes |
| `supabase/` | Supabase | Authoritative event store |

---

## Deploy in 4 steps

### 1. Supabase — provision the event store

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the **Database Connection String (URI)** from Project Settings → Database
3. Apply migrations:

```bash
cp .env.example .env
# Fill in DATABASE_URL
npm run db:push
```

### 2. Meta Developer Console — configure WhatsApp

1. Create a Meta App at [developers.facebook.com](https://developers.facebook.com)
2. Add **WhatsApp** product to your app
3. Note your **Phone Number ID** and **Access Token**
4. Note your **App Secret** (App Settings → Basic)
5. Choose a **Verify Token** (any random string you control)

### 3. Deploy webhook to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy the webhook surface
cd apps/webhook
vercel deploy --prod
```

Set these environment variables in Vercel:

```
DATABASE_URL             (from Supabase)
WHATSAPP_ACCESS_TOKEN    (from Meta)
WHATSAPP_PHONE_NUMBER_ID (from Meta)
WHATSAPP_APP_SECRET      (from Meta)
WHATSAPP_VERIFY_TOKEN    (your chosen token)
CHIOMA_ADMIN_SECRET      (any strong random string)
```

After deploy, register your webhook URL in Meta Developer Console:
- **Callback URL**: `https://your-vercel-url.vercel.app/webhook`
- **Verify Token**: same as `WHATSAPP_VERIFY_TOKEN`
- **Subscribe to**: `messages`

### 4. Deploy worker to Render

Connect your GitHub repo to [render.com](https://render.com). Render reads `render.yaml` automatically.

Set these environment variables in Render:

```
DATABASE_URL             (from Supabase)
WHATSAPP_ACCESS_TOKEN    (from Meta)
WHATSAPP_PHONE_NUMBER_ID (from Meta)
WHATSAPP_APP_SECRET      (from Meta)
LLM_PROVIDER             groq  (or openai / anthropic / openrouter)
LLM_API_KEY              (from your LLM provider)
CHIOMA_TENANT_IDS        tenant_{YOUR_PHONE_NUMBER_ID}
```

---

## Environment variables

See [`.env.example`](.env.example) for the full reference with descriptions.

### Required for all surfaces

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection URI |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number ID |
| `WHATSAPP_APP_SECRET` | Meta app secret (for HMAC signature validation) |
| `WHATSAPP_VERIFY_TOKEN` | Your chosen verification token |
| `LLM_PROVIDER` | `groq` \| `openai` \| `anthropic` \| `openrouter` |
| `LLM_API_KEY` | API key for chosen LLM provider |
| `CHIOMA_TENANT_IDS` | Comma-separated tenant IDs |
| `CHIOMA_ADMIN_SECRET` | Secret for `/admin/*` endpoints |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | provider default | Override LLM model |
| `LLM_TIMEOUT_MS` | `15000` | LLM call timeout |
| `LLM_MAX_RETRIES` | `2` | LLM retry count |
| `POLL_INTERVAL_MS` | `1000` | Consumer worker poll interval |
| `CONSUMER_GROUP` | `chioma_core` | Consumer group name |

---

## Pre-deploy validation

```bash
node scripts/deploy-check.mjs
```

Runs TypeScript type-check, full test suite, and governance gate. Exit 0 = ready to deploy.

---

## LLM Provider Selection

| Provider | Speed | Cost | `LLM_PROVIDER` value |
|----------|-------|------|----------------------|
| **Groq** | ⚡ Fastest | 💚 Cheapest | `groq` |
| OpenRouter | Fast | 💛 Variable | `openrouter` |
| OpenAI | Moderate | 🔴 Higher | `openai` |
| Anthropic | Moderate | 🔴 Higher | `anthropic` |

Recommended default: **Groq** (`llama-3.1-8b-instant`) — fast, cheap, sufficient for bounded advisory responses.

---

## Internal admin surfaces

All admin endpoints require `x-admin-secret` header matching `CHIOMA_ADMIN_SECRET`.

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Worker/webhook health check |
| `GET /admin/events?tenantId=X&limit=50` | Inspect event log for tenant |

---

## Architecture principles

1. **Supabase is authoritative truth** — the event log is the system of record
2. **Event log is append-only** — immutability enforced by DB trigger
3. **LLM is non-authoritative** — advisory only, never mutates state directly
4. **Every execution terminates** — COMPLETED or FAILED, never hanging
5. **Tenant isolation is mandatory** — all queries and events are tenant-scoped
6. **Runtime is replay-safe** — any state can be reconstructed from events

---

## Project structure

```
CHIOMA/
├── apps/
│   ├── webhook/          # Vercel surface — webhook + admin APIs
│   └── worker/           # Render surface — consumer runtime
├── core/                 # Shared contracts, ECB, event schemas
├── infrastructure/       # Supabase client, LLM, observability
├── services/             # Domain service handlers
├── workers/              # Background worker processes
├── supabase/
│   └── migrations/       # All DB migrations (apply with npm run db:push)
├── tools/
│   └── overseer-engine/  # Governance validation gate
├── evals/                # Trust and integrity test suite
├── render.yaml           # Render deployment definition
├── .env.example          # Environment variable reference
└── scripts/
    └── deploy-check.mjs  # Pre-deploy validation
```

---

## Running locally

```bash
# Install dependencies
npm install

# Copy env and configure
cp .env.example .env

# Apply DB migrations
npm run db:push

# Run full pipeline (dev mode, in-memory event bus)
npm run dev

# Run tests
npm test

# Governance gate
npm run overseer:check
```
