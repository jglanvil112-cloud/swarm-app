# House of Jreym — SWARM OS

SWARM OS is the automation and analytics backend for House of Jreym commerce. It coordinates Etsy listing creation, human approval, digital delivery checks, Shopify/POD workflows, social publishing, trend research, SEO generation, revenue tracking, and operational monitoring.

## Core rule: Etsy is draft-first

No automated agent should publish a new Etsy listing directly. The supported flow is:

1. Create or receive artwork.
2. Generate an image-grounded brief.
3. Build SEO copy and a price from shared policy modules.
4. Create an Etsy **draft**.
5. Attach the customer download file.
6. Insert a row into `publish_queue` with status `queued`.
7. A human approves the queue row with `x-approval-key`.
8. KWAME claims the approved row and activates the Etsy listing.

`agents/executor.js` keeps the legacy `publish_etsy_listing` task name for compatibility, but it now stages a draft rather than making a listing live.

## Main components

- `server.js` — Express entrypoint, API protection, health checks, dashboard hosting.
- `agents/` — task executors and publishing gates.
- `lib/etsyDraft.js` — the controlled Etsy draft/file/activation layer.
- `lib/designMeta.js` — deterministic listing-copy builder.
- `lib/seo.js` — Etsy title/tag construction and listing-quality scoring.
- `lib/pricing.js` — one shared pricing ladder for singles and bundles.
- `lib/security.js` — API-secret middleware, constant-time secret checks, SSRF/private-network protection, retrying fetch helper.
- `routes/metrics.js` — Etsy views/favorites/order/revenue feedback sync.
- `routes/audit.js` — digital-delivery and order-health checks.
- `workers/scheduler.js` — controlled task orchestration and retry policy.
- `migrations/` — Supabase schema and RLS hardening.

## Required environment variables

Production requires at minimum:

```text
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
API_SECRET=
APPROVAL_SECRET=
ANTHROPIC_API_KEY=
ETSY_KEY=
ETSY_SECRET=
ETSY_SHOP_ID=
ETSY_WHEN_MADE=2020_2026
```

Platform-specific features may additionally require Shopify, Printify, OpenAI, Instagram/Facebook/TikTok, Canva, fal.ai, or other keys already used by their route modules.

Do not put credentials into source code. Store them in Render/GitHub/Supabase secret stores only.

## Security model

- `API_SECRET` protects operational, AI-cost, maintenance, task, audit, metric, and Etsy-management routes.
- `APPROVAL_SECRET` is separate and only authorizes explicit publish/social approvals.
- Etsy OAuth callbacks and intentionally public catalog/review reads stay public.
- Remote file ingestion rejects localhost/private-network destinations and requires HTTPS.
- Supabase operational tables are intended to be service-role only after running `migrations/2026_08_security_hardening.sql`.
- Autonomous product drops are disabled unless `AUTONOMOUS_PRODUCT_DROPS=true` is deliberately set.

## Setup

```bash
npm ci
cp .env.example .env
# fill in local development values
npm test
npm run build
npm start
```

Node 20 is required.

## Deploy checklist

Before deploying the hardening branch:

1. Set `SUPABASE_SERVICE_KEY`, `API_SECRET`, and `APPROVAL_SECRET` in Render.
2. Rotate any secret that was previously committed or placed in a URL/query string.
3. Run all migrations in order, including `2026_08_security_hardening.sql`.
4. Confirm `/api/health` reports the required integrations as configured.
5. Run `npm test` and `npm run build`.
6. Verify the Etsy approval queue with a draft test listing.
7. Approve one test listing and confirm it becomes active only after KWAME processes it.
8. Verify the download file is present before the listing becomes active.
9. Confirm `/api/metrics/etsy` can sync performance using an authenticated request.
10. Leave `AUTONOMOUS_PRODUCT_DROPS` off until the controlled pipeline is verified.

## Tests and CI

`npm test` uses Node's built-in test runner. GitHub Actions runs unit tests and the production Vite build on pull requests. A repaired nightly Supabase backup workflow also runs at 02:00 UTC when `SUPABASE_DB_URL` is configured as a GitHub Actions secret.

## Pricing policy

The shared default ladder is defined in `lib/pricing.js`:

- Single: $7.99
- Premium single: $9.99
- 3-print set: $14.99
- 4-print set: $16.99
- 5-print set: $18.99
- 6–10 print gallery bundle: $24.99
- Custom bundle: $29.99

Legacy paths that pass `$4.99` no longer override the policy unless they explicitly set `price_locked: true`.

## Operational references

See `docs/OPERATIONS.md` for daily/weekly checks and `SECURITY.md` for credential and incident-response rules.
