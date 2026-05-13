# CHIOMA

**A real-time conversational employee runtime for Nigerian businesses, operating via WhatsApp.**

CHIOMA is a deterministic execution runtime deployed on Vercel. It allows businesses to handle customer inquiries, onboarding, and business memory reliably through a single synchronous pipeline.

---

## What it does

- **Instant Ingress**: Receives and validates WhatsApp messages in real-time.
- **Conversational Onboarding**: Automatically guides business owners through setup via chat.
- **Synchronous Intelligence**: Uses LLM orchestration to classify intent and generate responses inline.
- **Event-Sourced Memory**: Persists every interaction to a Supabase event log for auditable business history.
- **Zero-Latency Response**: Executes the entire cognition pipeline and delivers a reply within the 5s webhook window.

---

## Simplified Architecture

CHIOMA operates as a single-runtime execution engine:

```
WhatsApp → Vercel Webhook (Sync Runtime) → WhatsApp
                   ↓
           Supabase Event Log
```

**Runtime Reality:**
- **Entrypoint**: `apps/webhook/api/webhook.ts`
- **Execution Engine**: `core/runtime/index.ts`
- **Database**: Supabase (PostgreSQL)
- **Host**: Vercel (Serverless)

---

## Quick Start (Vercel Only)

### 1. Database Setup (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. Apply migrations: `npm run db:push`.

### 2. Configuration (Vercel)
Set these environment variables in your Vercel project:
- `DATABASE_URL`: Your Supabase connection string.
- `LLM_API_KEY`: Groq or OpenAI API Key.
- `LLM_PROVIDER`: `groq` (recommended) or `openai`.
- `WHATSAPP_ACCESS_TOKEN`: From Meta Developer Portal.
- `WHATSAPP_PHONE_NUMBER_ID`: From Meta Developer Portal.
- `WHATSAPP_APP_SECRET`: From Meta Developer Portal.
- `WHATSAPP_VERIFY_TOKEN`: Your chosen random string.

### 3. Deploy
```bash
# From root
vercel deploy --prod
```

---

## Project Structure

Normalized for minimal cognitive noise and production-grade review:

- **`apps/webhook/`**: Live ingress boundary (WhatsApp + Simulation).
- **`core/runtime/`**: The synchronous execution "brain".
- **`core/contracts/`**: Consolidated types and event schemas.
- **`services/onboarding-engine/`**: Business setup flow logic.
- **`services/llm-orchestrator/`**: AI response generation and validation.
- **`infrastructure/database/`**: Shared DB client and persistence.
- **`infrastructure/config/`**: Environment validation.

---

## Development & Simulation

Use the simulation endpoint to test the full pipeline without WhatsApp credentials:

```bash
POST /api/simulate-message
{
  "tenantId": "test_business",
  "from": "+2348000000000",
  "text": "Hello, I want to set up my shop."
}
```

---

## Core Invariants
1. **Single Execution Truth**: HTTP Input → Sync Processing → Response.
2. **Authoritative Event Log**: Every message is committed before processing.
3. **LLM Non-Authority**: AI output is validated via Zod before use.
4. **Tenant Isolation**: All data access is strictly scoped to `tenantId`.
