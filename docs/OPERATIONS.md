# House of Jreym Operations Runbook

## Daily checks

1. Open the SWARM dashboard and confirm core health checks are green.
2. Review the Etsy approval queue. Approve only drafts with the correct artwork, truthful title/description, expected price, and an attached customer file.
3. Review failed tasks and error logs. Do not repeatedly re-run a poison task; the worker now stops after the retry cap.
4. Check digital-delivery health for missing files or stuck paid orders.
5. Review Etsy performance metrics: views, favorites, orders, revenue, and revenue per 100 views.
6. Review scheduled social posts before their publish window.

## Weekly checks

1. Review the 10 highest and 10 weakest Etsy listings by measured performance.
2. Test one SEO change at a time on underperformers instead of rewriting the whole catalog blindly.
3. Review bundle drafts and confirm every included design/file is correct before approval.
4. Review pricing against the shared ladder in `lib/pricing.js`.
5. Confirm the nightly Supabase backup workflow has successful runs and downloadable artifacts.
6. Review dependency/security updates and CI status.

## Etsy listing release checklist

Before approving a listing:

- The cover image matches the actual download.
- The title accurately describes the artwork and is not keyword-stuffed.
- Tags are relevant and no more than 13.
- The description states that the item is digital and does not promise unavailable formats/sizes.
- Price matches the centralized pricing policy or has an intentional locked override.
- At least one valid digital file is attached.
- The artwork has passed any applicable IP/content review.

After approval, KWAME changes the queue row from `approved` to `publishing`, verifies files again, then activates the Etsy listing.

## Pricing ladder

| Product | Default price |
| --- | ---: |
| Single print | $7.99 |
| Premium single | $9.99 |
| 3-print set | $14.99 |
| 4-print set | $16.99 |
| 5-print set | $18.99 |
| 6–10-print gallery bundle | $24.99 |
| Custom bundle | $29.99 |

Do not hardcode prices in individual agent paths. Use `lib/pricing.js`.

## Performance decision rules

Use real data before changing a listing. Useful signals include:

- views — whether the listing is getting exposure;
- favorite rate — early shopper interest;
- orders and units — actual conversion;
- revenue — commercial contribution;
- revenue per 100 views — normalized monetization signal.

Examples:

- Low views: work on discoverability, niche, title/tags, and thumbnail relevance.
- Healthy views + low favorites: artwork/thumbnail or buyer-fit problem.
- Healthy favorites + no sales: price, delivery package, trust, or conversion-copy problem.
- Sales with strong revenue/100 views: protect the listing and create adjacent products/bundles rather than rewriting it aggressively.

## Failure handling

Failed tasks retry with capped backoff rather than forever. After the retry limit, investigate the root error before manually re-enqueueing.

Stale tasks left `running` after a worker crash are reclaimed. After repeated reclaims they are failed to prevent poison loops.

For Etsy `429` responses, reduce maintenance volume and allow the scheduled throttled jobs to resume after quota recovery.

## Digital delivery incident

If a paid digital order may not have a valid file:

1. Stop approving new related listings.
2. Run the delivery audit.
3. Identify the listing ID and verify attached files directly in Etsy.
4. Correct the file before reactivating/approving additional products.
5. Review affected orders using Etsy's seller tools; avoid putting buyer personal data into logs or GitHub.
6. Record the operational cause and permanent fix.

## Deployment procedure

1. Push changes to a feature branch.
2. Let GitHub CI run syntax checks, unit tests, and the production build.
3. Configure required Render environment variables before deploying security changes.
4. Run required Supabase migrations.
5. Deploy a staging/preview instance when available.
6. Verify `/api/health`.
7. Create one test Etsy draft through the automation path.
8. Confirm it remains draft until approved.
9. Confirm approval is rejected when the download file is absent.
10. Attach the file, approve it, and verify KWAME activates it.
11. Confirm metrics sync and delivery audit work.
12. Only then merge/deploy broadly.

## Rollback

If a deploy prevents dashboard access because the UI is not yet supplying `x-api-key`, roll back the application deploy rather than weakening the API guard. Update the dashboard to authenticate correctly, then redeploy.

Database security migrations should be reversed only after understanding why access is failing; never solve an access problem by publicly exposing operational tables.
