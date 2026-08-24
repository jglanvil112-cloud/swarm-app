# Security Policy

House of Jreym SWARM OS controls commerce accounts, automated publishing, operational data, and third-party API credentials. Treat the service as an administrative backend, not as a public API.

## Required production controls

1. Set a long random `API_SECRET` in Render. Operational APIs fail closed when it is absent.
2. Set a different long random `APPROVAL_SECRET`. Etsy/social approvals use `x-approval-key`; do not reuse `API_SECRET`.
3. Set `SUPABASE_SERVICE_KEY` for the server. Do not use the anon key for server-owned tables.
4. Run `migrations/2026_08_security_hardening.sql` after the earlier migrations.
5. Keep `AUTONOMOUS_PRODUCT_DROPS=false` until the controlled staging/approval flow has been verified.
6. Keep `ALLOW_PUBLISH_WITHOUT_FILE=false` for digital Etsy products.
7. Never put API keys, OAuth tokens, database URLs, or approval keys into source code, screenshots, query strings, commit messages, or public issue text.

## Protected routes

`API_SECRET` is required for task management, pipeline actions, audits, metrics, promotional maintenance, Etsy management/write operations, and AI-cost endpoints. Send it as:

```text
x-api-key: <API_SECRET>
```

`APPROVAL_SECRET` is used only by the explicit approval router:

```text
x-approval-key: <APPROVAL_SECRET>
```

Approval secrets are not accepted in URL query parameters because URLs are frequently retained in browser history, proxies, analytics, and logs.

## Etsy publication invariant

An automated task must not create a new listing directly in the `active` state. New Etsy products follow:

```text
artwork -> metadata -> draft -> digital file -> publish_queue:queued
       -> human approval -> publish_queue:approved -> KWAME -> active
```

KWAME checks the actual Etsy listing files before activation. A digital listing without a file becomes `blocked_missing_file` unless a deliberate emergency override is configured.

## Remote URL ingestion

The image/file ingestion helpers require HTTPS and reject localhost, link-local, RFC1918/private addresses, and private IPv6 ranges. Keep this validation in place whenever adding new remote-file features.

When practical, use an explicit allowlist of trusted storage/CDN hosts for new ingestion paths.

## Secret rotation

Rotate a credential immediately if it has ever been committed to Git, placed in a public URL, pasted into a public log, or exposed in a screenshot. Removing the value from the latest source file does not remove it from Git history.

Recommended rotation order:

1. Application/admin secrets (`API_SECRET`, `APPROVAL_SECRET`).
2. Third-party OAuth/API credentials (Etsy, Shopify, social, AI providers).
3. Supabase service-role/database credentials.
4. Revoke old sessions/tokens after the replacement is confirmed working.

## Supabase

The hardening migration enables RLS and revokes `anon`/`authenticated` privileges on server-owned operational tables. The service-role policy is intentionally server-only.

Do not expose the service-role key to browser JavaScript.

## Logging

Do not log:

- access or refresh tokens;
- API/approval secrets;
- database connection strings;
- buyer names, emails, addresses, or payment details;
- complete request authorization headers.

Operational logs may include listing IDs, queue IDs, status codes, latency, and sanitized error messages.

## Incident response

If unauthorized access or unexpected publication is suspected:

1. Disable the Render service or set `AUTONOMOUS_PRODUCT_DROPS=false`.
2. Rotate `API_SECRET` and `APPROVAL_SECRET`.
3. Revoke affected Etsy/Shopify/social OAuth tokens.
4. Inspect `agent_logs`, `tasks`, `publish_queue`, and platform audit/order history.
5. Archive or deactivate any unintended listings/posts.
6. Rotate any credential that may have been exposed.
7. Restore from a verified backup if operational data was modified.
8. Document the timeline and the permanent corrective action before re-enabling automation.

## Reporting

Keep security reports private. Do not include live credentials or customer personal information in GitHub issues.
