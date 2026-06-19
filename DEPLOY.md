# Deploying Stars of David tonight
## stars-of-david.org — payments disabled, everything else live

This is the exact path to get the memorial site live tonight, with
donations safely switched off until your nonprofit paperwork clears.

Total time: roughly 30–45 minutes, almost all of it waiting on DNS
to propagate rather than active work.

---

## The shape of the deployment

Three pieces, three places:

| Piece | What it is | Where it lives |
|---|---|---|
| **Database** | PostgreSQL with victim names, stars, donations | Railway (free tier) |
| **Backend API** | Express server — search, counter, Stripe (currently disabled) | Railway (free tier) |
| **Frontend** | The public-facing memorial page | Cloudflare Pages (free) |

Your domain, `stars-of-david.org`, is already on Cloudflare — which is
the easiest possible starting point, since Cloudflare Pages and
Cloudflare DNS live in the same dashboard with zero extra configuration
to connect them.

---

## Part 1 — Deploy the backend + database (Railway)

### 1. Create a Railway account
Go to [railway.app](https://railway.app) → sign up with GitHub (recommended,
makes redeploys automatic on every push).

### 2. Push this code to GitHub
If you haven't already:

```bash
cd starsofdavid
git init
git add .
git commit -m "Initial commit — Stars of David backend"
```

Create a new repo on GitHub (call it `starsofdavid-api` or similar),
then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/starsofdavid-api.git
git branch -M main
git push -u origin main
```

### 3. Create the Railway project
- Railway dashboard → **New Project** → **Deploy from GitHub repo**
- Select your `starsofdavid-api` repo
- Railway will detect the Node.js app automatically

### 4. Add PostgreSQL
- In your new Railway project → **+ New** → **Database** → **Add PostgreSQL**
- Railway automatically creates a `DATABASE_URL` variable and makes it
  available to your API service — you don't need to copy/paste it

### 5. Set environment variables
In your API service → **Variables** tab, add:

```
NODE_ENV=production
PAYMENTS_ENABLED=false
FRONTEND_URL=https://stars-of-david.org
PORT=3001
```

(Leave Stripe, R2, and Resend variables blank for tonight — they're not
needed while `PAYMENTS_ENABLED=false`. The certificate pipeline and
checkout simply won't be reachable until you turn payments on later.)

### 6. Run the database setup
- In your Railway service → click the **⋮** menu → **Shell** (or use the Railway CLI)
- Run:
  ```bash
  npm run db:setup
  ```
- You should see `Stars of David database is ready.`

### 7. Get your backend's public URL
- Railway service → **Settings** → **Networking** → **Generate Domain**
- Railway gives you something like `starsofdavid-api-production.up.railway.app`
- Test it: visit `https://your-railway-url.up.railway.app/health` — you
  should see `{"ok":true}`

### 8. (Optional tonight, recommended soon) Point a subdomain at it
Once your frontend is live, you'll want `api.stars-of-david.org`
instead of the long Railway URL. That's covered in Part 3 below — it's
a 2-minute DNS change you can do anytime, even after tonight.

---

## Part 2 — Deploy the frontend (Cloudflare Pages)

Since your domain is already on Cloudflare, Cloudflare Pages is the
path of least resistance — same dashboard, same account, instant DNS
connection with no extra steps.

### 1. Update the API URL in the frontend
Before deploying, open `public/index.html` and find this line near the top:

```html
<script>
  window.STARS_API_URL = "https://api.stars-of-david.org";
</script>
```

For tonight, change it to your actual Railway URL from Part 1, step 7:

```html
<script>
  window.STARS_API_URL = "https://starsofdavid-api-production.up.railway.app";
</script>
```

(You can switch this to the prettier `api.stars-of-david.org` once you
do the optional DNS step later — just edit this one line and redeploy.)

### 2. Push the frontend to GitHub
The `public/` folder is a complete static site. Easiest path: put it in
the same repo as the backend (Cloudflare Pages can be told to only
build from the `public/` directory), or split it into its own repo —
either works. Simplest for tonight:

```bash
cd starsofdavid
git add public/index.html
git commit -m "Update API URL for production"
git push
```

### 3. Create the Cloudflare Pages project
- Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
- Select your repo
- Build settings:
  - **Build command**: leave blank (it's static HTML, nothing to build)
  - **Build output directory**: `public`
- Click **Save and Deploy**

Cloudflare will give you a `*.pages.dev` URL within about a minute —
your site is now live there, just not yet on your real domain.

### 4. Connect your custom domain
- In your new Pages project → **Custom domains** → **Set up a custom domain**
- Type `stars-of-david.org` → **Continue** → **Activate domain**
- Since the domain is already on Cloudflare, this is automatic — no
  manual DNS records to add. Cloudflare connects them for you.
- Repeat for `www.stars-of-david.org` if you want both to work (Cloudflare
  will offer to set up the redirect for you)

### 5. Wait for it to go live
This is usually instant to a few minutes since you're already on
Cloudflare's network — no external DNS propagation delay like you'd
have with a different registrar.

Visit **https://stars-of-david.org** — your memorial site should be live.

---

## Part 3 — What to do with your Cloudflare domain (full picture)

Since you mentioned you'd already bought the domain and weren't sure
what to do with it — here's the complete picture of what Cloudflare is
doing for you and what's left to configure.

### What's already true
Buying the domain through Cloudflare Registrar means:
- DNS is already managed by Cloudflare (this is automatic — Cloudflare
  Registrar always uses Cloudflare DNS)
- You get free SSL/TLS certificates automatically once anything points
  at the domain
- You get Cloudflare's CDN and DDoS protection in front of the site
  at no extra cost

### What you still need to set up tonight
Just the one thing covered in Part 2, step 4 — connecting Cloudflare
Pages to the domain. That's it. Everything else (SSL, CDN, DNS) is
handled automatically the moment you do that.

### What to set up later (when payments go live)
1. **`api.stars-of-david.org` subdomain** — once your Stripe/nonprofit
   setup is done and you want a cleaner API URL than the long Railway
   one:
   - Cloudflare dashboard → your domain → **DNS** → **Add record**
   - Type: `CNAME`
   - Name: `api`
   - Target: your Railway domain (e.g. `starsofdavid-api-production.up.railway.app`)
   - Proxy status: **Proxied** (orange cloud) — gives you Cloudflare's
     SSL and protection on the API too
   - Then in Railway: service → **Settings** → **Networking** → **Custom Domain**
     → add `api.stars-of-david.org` and follow Railway's verification step
   - Update `window.STARS_API_URL` in `index.html` to
     `https://api.stars-of-david.org` and redeploy

2. **Email** — if you want `dedications@stars-of-david.org` to actually
   send mail (for the certificate emails), you'll set this up through
   Resend (see the backend README's Resend section) — Resend will ask
   you to add a couple of DNS records, which you'd add the same way as
   above, in Cloudflare's DNS tab.

3. **`R2_PUBLIC_URL` / `cdn.stars-of-david.org`** — if you set up
   Cloudflare R2 for certificate storage (very natural choice since
   you're already on Cloudflare), you can connect a `cdn.stars-of-david.org`
   subdomain to it the same way, directly in the R2 bucket settings.

None of this blocks tonight's launch. All three are "later, when
payments go live" tasks.

---

## Tonight's checklist

- [ ] Push code to GitHub
- [ ] Railway: create project, add PostgreSQL, set env vars (`PAYMENTS_ENABLED=false`)
- [ ] Railway: run `npm run db:setup` in the shell
- [ ] Railway: generate a public domain, confirm `/health` responds
- [ ] Update `STARS_API_URL` in `public/index.html` to that Railway URL
- [ ] Cloudflare Pages: connect repo, set build output to `public`
- [ ] Cloudflare Pages: add custom domain `stars-of-david.org`
- [ ] Visit the live site, confirm:
  - Counter loads and animates
  - Name search returns results (try "Goldberg" or "Poland")
  - Recently named grid shows the empty-state message (no stars named yet)
  - Donate section shows "Donations open soon" rather than a working checkout

That last point is the most important check — it confirms the kill
switch is working and nobody can accidentally be charged tonight.

---

## When you're ready to turn on payments

1. Finish nonprofit registration / Stripe account activation
2. In Railway, add the Stripe, R2, and Resend environment variables
   from `.env.example`
3. Set `PAYMENTS_ENABLED=true` (or delete the variable entirely)
4. Redeploy (Railway does this automatically on variable changes, or
   trigger manually from the dashboard)
5. Set up the Stripe webhook pointing at
   `https://api.stars-of-david.org/webhook/stripe` (or your Railway
   URL if you haven't done the custom subdomain yet)
6. Test one real donation end-to-end before announcing it publicly
