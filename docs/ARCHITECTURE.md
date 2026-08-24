# SWARM OS Architecture

## System boundary

SWARM OS is the private operations backend for House of Jreym. Etsy, Shopify, social platforms, AI providers, and Supabase are external systems. The static dashboard is an admin interface, not a public write API.

## Request security

```text
Browser admin
    |
    | POST /api/session/login + API_SECRET
    v
Signed HttpOnly admin cookie
    |
    +--> protected operational APIs

Automation/API client
    |
    | x-api-key: API_SECRET
    v
protected operational APIs

Human listing approval
    |
    | x-approval-key: APPROVAL_SECRET
    v
/api/approve/*
```

Public exceptions are intentionally narrow: health endpoints, public Etsy catalog/reviews, and third-party OAuth callbacks that must return to the service.

## Etsy product lifecycle

```text
Artwork / Canva / generated file
        |
        v
Image-grounded brief
        |
        v
SEO + pricing policy
        |
        v
Etsy DRAFT ---------------------------+
        |                              |
        v                              |
attach real customer download         |
        |                              |
        v                              |
publish_queue = queued                 |
        |                              |
        v                              |
Human approval                         |
        |                              |
        v                              |
publish_queue = approved               |
        |                              |
        v                              |
KWAME atomic claim                     |
        |                              |
        +--> file missing? --> blocked_missing_file
        |
        v
Etsy ACTIVE
        |
        +--> SEUN analytics
        +--> KOFI operations check
```

The executor retains the historical task name `publish_etsy_listing` for compatibility, but that task now **stages a draft**. Only the publisher gate activates an Etsy listing.

## Agent roles

- NANA — trend/niche research using stored evidence.
- KOFI — operations, inventory/delivery.
- AMARA — listing copy and marketing content.
- KWAME — sales optimization and approved publication gate.
- FATIMA — customer-service workflow.
- SEUN — analytics and performance feedback.
- AISHA — Etsy SEO and listing staging.
- IBRAHIM — social content workflow.
- ZARA — inventory operations.
- DELE — pricing analysis.
- IMANI — paid ads planning.
- ABENA — financial reporting.

## Data model

Supabase is the operational memory/queue layer. High-value server-owned tables include:

- `tasks`
- `agent_logs`
- `agent_outputs`
- `agent_decisions`
- `publish_queue`
- `products`
- `trends`
- `revenue_events`
- `oauth_tokens`
- `oauth_states`
- `scheduler_state`
- `health_checks`
- social credentials/posts/analytics tables

After the security migration these tables are service-role only; browser clients do not receive the service-role key.

## Performance feedback loop

```text
Etsy listings + receipts
      |
      v
routes/metrics.js
      |
      +--> views
      +--> favorites / favorite rate
      +--> orders / units
      +--> revenue
      +--> revenue per 100 views
      |
      v
products.performance + SEUN outputs
      |
      v
SEO / pricing / product decisions
```

The goal is to favor measured commercial performance over hand-written keyword assumptions.

## Reliability

- PostgreSQL task claim uses `FOR UPDATE SKIP LOCKED`.
- Failed tasks use bounded retry/backoff.
- Stale `running` tasks are reclaimed a limited number of times.
- Publish queue uses an atomic state transition before activation.
- A partial unique index prevents multiple open publication rows for the same Etsy listing.
- Etsy maintenance jobs are staggered to reduce API-quota collisions.
- Automated product generation is opt-in; activation remains human-gated.

## Delivery safety

Digital listings are audited for attached files, supported file types, size limits, duplicate titles, and invalid prices. The approval and publication layers independently verify that a digital file exists.

Remote file/image ingestion is HTTPS-only and rejects private-network targets to reduce server-side request-forgery risk.

## CI and backup

GitHub Actions verifies server syntax, unit tests, and the production Vite build. A separate nightly workflow creates a compressed Supabase database dump when `SUPABASE_DB_URL` is configured in Actions secrets.
