# Stars of David — Backend API
## stars-of-david.org

A Node.js/Express/PostgreSQL backend for the Stars of David Holocaust memorial project.

---

## Architecture

```
starsofdavid/
├── src/
│   ├── server.js           # Express API server
│   ├── certificate.js      # PDF certificate generator (pdf-lib)
│   ├── storage.js          # Certificate storage (R2 / local disk)
│   └── email.js            # Certificate delivery email (Resend)
├── public/
│   ├── thank-you.html      # Post-checkout confirmation page
│   ├── js/donate.js        # Frontend checkout + search integration
│   └── certificates/       # Local certificate storage (dev fallback)
├── sql/
│   └── schema.sql          # PostgreSQL schema + seed data
├── scripts/
│   └── db-setup.js         # One-time DB initialisation script
├── .env.example            # Environment variable template
└── package.json
```

### Database tables

| Table | Purpose |
|-------|---------|
| `victims` | Victim records sourced from Yad Vashem Pages of Testimony |
| `stars` | One row per named star; linked to victim + donation |
| `donations` | One row per Stripe payment session |
| `donors` | One row per unique donor email; tracks lifetime giving |
| `counter_cache` | Single-row cache of total named stars (updated by trigger) |

---

## Local development

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- A [Stripe account](https://dashboard.stripe.com) (free)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) (for webhook testing)

### 1. Clone and install

```bash
git clone https://github.com/yourorg/starsofdavid-api
cd starsofdavid-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your database URL and Stripe test keys
```

### 3. Create the database

```bash
# In psql:
createdb starsofdavid
```

### 4. Run schema + seed

```bash
npm run db:setup
```

This runs `sql/schema.sql`, which creates all tables, indexes, triggers,
and seeds the initial ~70 victim records from Yad Vashem Pages of Testimony.

### 5. Start the API server

```bash
npm run dev
```

The API runs on `http://localhost:3001`.

### 6. Test webhooks locally (Stripe CLI)

```bash
stripe listen --forward-to localhost:3001/webhook/stripe
```

The CLI prints a `whsec_...` signing secret — paste it into your `.env`
as `STRIPE_WEBHOOK_SECRET`.

---

## API endpoints

### `GET /api/counter`
Returns the current named-star count.

```json
{ "named_count": 271302, "updated_at": "2025-06-18T..." }
```

### `GET /api/victims/search?q=goldberg&limit=12`
Fuzzy search across victim names, country, and town.

```json
{
  "results": [
    {
      "id": "uuid",
      "last_name": "Goldberg",
      "first_name": "Chana Rivka",
      "birth_year": 1901,
      "death_year": 1942,
      "country": "Poland",
      "town": "Warsaw",
      "fate": "Murdered, Treblinka",
      "is_named": false
    }
  ]
}
```

### `GET /api/stars/recent?limit=6`
Returns the most recently named stars for the memorial registry.

### `POST /api/donations/create-session`
Creates a Stripe Checkout session. Returns `{ sessionId, url }`.

Body:
```json
{
  "victimId": "uuid-or-null",
  "victimName": "Chana Rivka Goldberg",
  "country": "Poland",
  "donorName": "Sarah Cohen",
  "donorEmail": "sarah@example.com",
  "message": "In memory of my great-grandmother",
  "starCount": 1
}
```

### `GET /api/donations/session/:sessionId`
Returns donation status + star catalogue IDs. Called on the thank-you page.

### `POST /webhook/stripe`
Stripe webhook endpoint (raw body required). Handles `checkout.session.completed`:
- Marks donation as completed
- Creates star record(s)
- Updates counter cache via trigger
- Updates donor lifetime totals

---

## Stripe setup — step by step

### 1. Create your Stripe account
Sign up at [dashboard.stripe.com/register](https://dashboard.stripe.com/register). You can build and test the entire flow before ever activating live payments.

### 2. Get your API keys
[dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) — copy the **Secret key** (`sk_test_...` in test mode) into `STRIPE_SECRET_KEY`.

### 3. Test the flow locally with the Stripe CLI

```bash
# Install: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3001/webhook/stripe
```

This prints a webhook signing secret (`whsec_...`) — put it in `STRIPE_WEBHOOK_SECRET`.
Keep this command running in a separate terminal while you test.

### 4. Test a donation end-to-end

1. Start the API: `npm run dev`
2. Trigger `POST /api/donations/create-session` (or click "Name a star" on the frontend)
3. You'll get redirected to a Stripe-hosted checkout page
4. Use a [Stripe test card](https://docs.stripe.com/testing#cards): `4242 4242 4242 4242`, any future expiry, any CVC
5. On success, Stripe redirects to `/thank-you?session_id=...`
6. Check your terminal running `stripe listen` — you'll see the webhook fire
7. Query the database: `SELECT * FROM stars ORDER BY created_at DESC LIMIT 1;`

### 5. Go live

When ready to accept real payments:
1. Complete Stripe's account activation (business details, bank account)
2. Switch to live keys (`sk_live_...`) in your production environment variables
3. Create a **live mode** webhook endpoint at `https://api.stars-of-david.org/webhook/stripe` listening for:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `charge.refunded`
4. Copy the live webhook signing secret into your production `STRIPE_WEBHOOK_SECRET`

### Test cards reference

| Card number | Behavior |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 9995` | Declines (insufficient funds) |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |

---

## Going live tonight without accepting payments

If you want the memorial site live for browsing and name search before
your nonprofit/Stripe setup is finished:

1. Set `PAYMENTS_ENABLED=false` in your production environment
2. Deploy as normal — the site, search, and counter all work fully
3. The frontend automatically shows "Donations open soon" instead of
   a broken checkout button, and the API rejects checkout attempts
   with a clear message rather than erroring
4. When you're ready to accept real donations, set `PAYMENTS_ENABLED=true`
   (or remove the variable) and redeploy — no code changes needed

This lets you launch stars-of-david.org tonight and flip on donations
later once your nonprofit registration and Stripe account are active.

---

## Certificate generation

When a donation completes, the webhook automatically:

1. Generates a one-page PDF certificate per star (`src/certificate.js`,
   using `pdf-lib` — pure JS, no native dependencies, deploys cleanly anywhere)
2. Uploads it to Cloudflare R2 if configured, or saves it locally to
   `public/certificates/` in development (`src/storage.js`)
3. Saves the certificate URL onto the `donations` row
4. Emails the donor a dignified confirmation with a download link via
   Resend (`src/email.js`) — or logs the email to the console if no
   `RESEND_API_KEY` is set, so the pipeline still runs end-to-end in dev

Each certificate includes the victim's name, the star's catalogue ID,
the donor's name, the dedication message (if any), and the date —
set against a dark, gold-bordered design matching the site, with a
Star of David emblem at the top.

### Setting up Cloudflare R2 (optional but recommended for production)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Create bucket
2. Create an API token with R2 read/write permissions
3. Fill in `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
4. Optionally connect a custom domain (e.g. `cdn.stars-of-david.org`) and set `R2_PUBLIC_URL`

Without R2 configured, certificates save to local disk and are served
directly by the API at `/certificates/<filename>.pdf` — fine for
development, but ephemeral on most hosting platforms (files vanish on
redeploy), so configure R2 before going live with real donations.

### Setting up Resend (optional but recommended for production)

1. [resend.com](https://resend.com) → sign up (free tier: 100 emails/day, 3,000/month)
2. Verify your sending domain (or use their test domain while developing)
3. Create an API key → set `RESEND_API_KEY`
4. Set `EMAIL_FROM` to an address on your verified domain

---

## Deployment

### Railway (recommended — one-click)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a PostgreSQL plugin — Railway auto-sets `DATABASE_URL`
4. Add environment variables in the Railway dashboard
5. Run `npm run db:setup` via the Railway shell to initialise the schema

### Render

1. New Web Service → connect your GitHub repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Add a PostgreSQL database — copy the connection string to `DATABASE_URL`
5. Set all env vars in the Render dashboard
6. Open the Render shell → `npm run db:setup`

### Stripe webhook (production)

In the [Stripe Dashboard](https://dashboard.stripe.com/webhooks):
- Endpoint URL: `https://api.stars-of-david.org/webhook/stripe`
- Events to listen for: `checkout.session.completed`
- Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

---

## Adding more victim names

To expand the seed data with additional Yad Vashem records, add `INSERT` rows
to `sql/schema.sql` following the existing pattern, then re-run `npm run db:setup`.

When Yad Vashem grants API access (requested at webmaster@yadvashem.org.il),
the `victims` table is already structured to receive their full dataset —
the `source_ref` column holds the Page of Testimony reference number.

---

## Security notes

- The Stripe webhook signature is verified on every request
- All DB queries use parameterised statements (no SQL injection surface)
- `helmet` sets standard security headers
- CORS is locked to `FRONTEND_URL`
- Database credentials are never exposed to the frontend

---

## License

Memorial project — all rights reserved, stars-of-david.org
