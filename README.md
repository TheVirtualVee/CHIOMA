# CHIOMA — Hireable Digital Business Employee

**Professional digital staff for businesses, operating via WhatsApp.**

CHIOMA is a hireable digital employee product. She manages customer inquiries, learns from business social signals, and ensures professional continuity. She is NOT a chatbot; she is staff.

---

## What CHIOMA Does

- **Institutional Ingress**: Securely manages WhatsApp communication.
- **Social Learning**: Personalizes her behavior by analyzing business social media and website signals.
- **Staff Decision Loop**: Executes professional staff replies grounded in business knowledge.
- **Knowledge Lock**: Persists business facts and policies confirmed by the Employer.
- **Revenue Driven**: Identifies customer opportunities and prioritizes commercial outcomes.

---

## The Staff Loop

CHIOMA operates as a focused staff loop:

```
WhatsApp → Webhook Handler → Staff Loop (Decision) → WhatsApp
                        ↓
               Business Knowledge Base
```

**Architecture Map:**
- **Institutional Ingress**: `apps/webhook/api/webhook.ts`
- **Staff Loop**: `core/staff-loop/index.ts`
- **Response Service**: `services/response-service/index.ts`
- **Knowledge Base**: Supabase (Postgres)

---

## Quick Start

### 1. Database (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. Apply migrations: `npm run db:push`.

### 2. Configuration (Vercel)
Set these environment variables:
- `DATABASE_URL`: Connection string.
- `LLM_API_KEY`: Groq or OpenAI API Key.
- `LLM_PROVIDER`: `groq` or `openai`.
- `WHATSAPP_ACCESS_TOKEN`: Meta Developer Portal.
- `WHATSAPP_PHONE_NUMBER_ID`: Meta Developer Portal.
- `WHATSAPP_VERIFY_TOKEN`: Your chosen random string.

### 3. Deploy
```bash
vercel deploy --prod
```

---

## Project Structure

Purified for operational clarity and premium performance:

- **`apps/webhook/`**: WhatsApp Institutional Ingress.
- **`core/staff-loop/`**: The conversational employment loop.
- **`core/contracts/`**: Behavioral staff models and need classifications.
- **`services/onboarding-service/`**: Employer training and setup flow.
- **`services/response-service/`**: Professional staff reply generation.
- **`services/business-learning/`**: Social learning (Instagram/TikTok/Web).
- **`infrastructure/`**: Shared database and security configuration.

---

## Hire CHIOMA via Simulation

Test the full staff loop without WhatsApp credentials:

```bash
POST /api/simulate-message
{
  "tenantId": "test_business",
  "from": "+2348000000000",
  "text": "Hello, I want to hire you."
}
```

---

## Core Principles

1. **Employability First**: CHIOMA behaves like professional staff.
2. **Reliability > Intelligence**: Reliable business presence under uncertainty.
3. **Knowledge Lock**: Every business fact is confirmed by the Employer.
4. **No Silent Failures**: Every interaction is observable and explainable.

