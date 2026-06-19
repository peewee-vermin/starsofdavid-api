# Stars of David — Deployment Status

_Live as of 2026-06-19_

## URLs

| Piece | URL |
|---|---|
| Public site | https://stars-of-david.org |
| Frontend (Cloudflare Worker w/ static assets) | https://starsofdavid-api.dibattista-daniel-j.workers.dev |
| Backend API (Railway) | https://starsofdavid-api-production.up.railway.app |
| GitHub repo | https://github.com/peewee-vermin/starsofdavid-api |

## Infrastructure

- **Database**: PostgreSQL on Railway, schema applied via `npm run db:setup`
- **Backend**: Express on Railway, env vars set — `NODE_ENV=production`, `PAYMENTS_ENABLED=false`, `FRONTEND_URL=https://stars-of-david.org`, `PORT=3001`
- **Frontend**: deployed via Cloudflare's Git integration. Cloudflare auto-detected it as a Worker with static assets (`wrangler deploy`, output dir `public`) rather than a classic Pages project — same result, files served globally from `/public`.
- **Domain**: `stars-of-david.org` connected directly to the Cloudflare Worker via Custom Domains. SSL/CDN handled automatically by Cloudflare.

## Payments — currently OFF

`PAYMENTS_ENABLED=false` on the Railway API service. Verified live:
- `/api/status` → `{"paymentsEnabled":false}`
- Donate section on the live site shows "Donations open soon" with the form disabled, instead of a working Stripe checkout.

## Verified working tonight

- [x] Live counter loads (`/api/counter`)
- [x] Name search returns results for "Goldberg" and "Poland"
- [x] Recently named grid shows the empty-state message (no stars named yet — `/api/stars/recent` returns `[]`)
- [x] Donate section shows "coming soon," no live checkout reachable

## When payments go live

See `DEPLOY.md` → "When you're ready to turn on payments" for the full sequence. Short version:
1. Finish nonprofit/Stripe setup
2. Add Stripe/R2/Resend env vars on the Railway API service
3. Set `PAYMENTS_ENABLED=true` (or remove the variable)
4. Point Stripe's webhook at the API's `/webhook/stripe`
5. Test one real donation before announcing publicly

## Known follow-ups (not urgent)

- API is reachable only via the long Railway URL (`starsofdavid-api-production.up.railway.app`). Optional: add `api.stars-of-david.org` as a CNAME in Cloudflare DNS → Railway custom domain, then update `window.STARS_API_URL` in `public/index.html` and redeploy.
- Cloudflare's build step generated a `wrangler.jsonc` / `package.json` autoconfig in the CI environment that was never committed. Not required for the site to keep working, but `npx wrangler setup` + commit would make local builds match what's deployed.
