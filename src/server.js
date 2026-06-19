// Stars of David — stars-of-david.org
// Express API server

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import Stripe from 'stripe';
import { generateCertificatePdf } from './certificate.js';
import { uploadCertificate } from './storage.js';
import { sendCertificateEmail } from './email.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── DATABASE ───────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// ── STRIPE ─────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-05-27.dahlia',
});

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
}));

// Stripe webhook needs raw body — mount before json parser
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.use(express.json());

// Serve locally-stored certificates (dev / no-R2-configured fallback)
app.use('/certificates', express.static(
  new URL('../public/certificates', import.meta.url).pathname
));

// ── HELPERS ────────────────────────────────────────────────
function generateCatalogueId(count) {
  // SOD-271302, SOD-271303, …
  return `SOD-${String(count).padStart(6, '0')}`;
}

async function getNextCatalogueId(client) {
  const { rows } = await client.query(
    'SELECT named_count FROM counter_cache WHERE id = 1 FOR UPDATE'
  );
  return rows[0].named_count + 1;
}

// ── ROUTES ─────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /api/status
// Lets the frontend know whether donations are currently open,
// so it can show a "coming soon" state instead of a broken checkout.
app.get('/api/status', (_req, res) => {
  res.json({
    paymentsEnabled: process.env.PAYMENTS_ENABLED !== 'false',
  });
});

// GET /api/counter
// Returns the current named-star count for the hero display.
app.get('/api/counter', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT named_count, updated_at FROM counter_cache WHERE id = 1'
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/victims/search?q=goldberg&limit=12
// Trigram fuzzy search across last_name, first_name, country, town.
app.get('/api/victims/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         last_name,
         first_name,
         birth_year,
         death_year,
         country,
         town,
         fate,
         is_named,
         GREATEST(
           similarity(last_name, $1),
           similarity(COALESCE(first_name, ''), $1),
           similarity(COALESCE(country, ''), $1),
           similarity(COALESCE(town, ''), $1)
         ) AS score
       FROM victims
       WHERE
         last_name      % $1 OR
         first_name     % $1 OR
         country        % $1 OR
         town           % $1 OR
         last_name      ILIKE $2 OR
         first_name     ILIKE $2
       ORDER BY score DESC, last_name, first_name
       LIMIT $3`,
      [q, `%${q}%`, limit]
    );
    res.json({ results: rows, query: q });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/stars/recent?limit=6
// Returns the most recently named stars with victim + donor info.
app.get('/api/stars/recent', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 6, 20);
  try {
    const { rows } = await pool.query(
      `SELECT
         s.catalogue_id,
         s.created_at,
         v.first_name || ' ' || v.last_name AS victim_name,
         v.country,
         v.death_year,
         d.donor_name,
         d.dedication_message
       FROM stars s
       LEFT JOIN victims v ON s.victim_id = v.id
       LEFT JOIN donations d ON s.donation_id = d.id
       WHERE d.status = 'completed'
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ stars: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/donations/create-session
// Creates a Stripe Checkout session and returns the URL.
// Body: { victimId, victimName, country, donorName, donorEmail, message, starCount }
app.post('/api/donations/create-session', async (req, res) => {
  // Kill switch — set PAYMENTS_ENABLED=false while nonprofit/Stripe
  // account setup is in progress. The site can go fully live for
  // browsing and name search while checkout stays disabled.
  if (process.env.PAYMENTS_ENABLED === 'false') {
    return res.status(503).json({
      error: 'Donations are not yet open. We are finalizing our nonprofit registration — check back soon.',
      paymentsEnabled: false,
    });
  }

  const {
    victimId,
    victimName,
    country,
    donorName,
    donorEmail,
    message,
    starCount = 1,
  } = req.body;

  if (!donorName || !donorEmail || !victimName) {
    return res.status(400).json({ error: 'donorName, donorEmail, and victimName are required' });
  }

  const count = Math.max(1, Math.min(parseInt(starCount) || 1, 100));
  const amountCents = count * 1500; // $15.00 per star

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert donor
    const donorResult = await client.query(
      `INSERT INTO donors (name, email)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id`,
      [donorName, donorEmail]
    );
    const donorId = donorResult.rows[0].id;

    // Create pending donation
    const donationResult = await client.query(
      `INSERT INTO donations
         (donor_id, donor_name, donor_email, dedication_message,
          star_count, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [donorId, donorName, donorEmail, message || null, count, amountCents]
    );
    const donationId = donationResult.rows[0].id;

    await client.query('COMMIT');

    // Create Stripe Checkout session
    // Idempotency key prevents duplicate sessions if the client retries
    // the request (e.g. double-click, network blip).
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: donorEmail,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Star of David — ${victimName}`,
              description: count === 1
                ? `One star named in memory of ${victimName}${country ? `, ${country}` : ''}`
                : `${count} stars named in memory of Holocaust victims`,
            },
            unit_amount: 1500,
          },
          quantity: count,
        }],
        metadata: {
          donation_id: donationId,
          victim_id: victimId || '',
          victim_name: victimName,
          donor_id: donorId,
          star_count: count,
        },
        success_url: `${process.env.FRONTEND_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/#donate`,
      },
      { idempotencyKey: `donation_${donationId}` }
    );

    // Store session ID on donation
    await pool.query(
      'UPDATE donations SET stripe_session_id = $1 WHERE id = $2',
      [session.id, donationId]
    );

    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not create payment session' });
  } finally {
    client.release();
  }
});

// GET /api/donations/session/:sessionId
// Called on the thank-you page to confirm status.
app.get('/api/donations/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT
         d.id, d.status, d.star_count, d.amount_cents,
         d.donor_name, d.dedication_message, d.certificate_url,
         d.completed_at,
         array_agg(s.catalogue_id ORDER BY s.created_at) AS star_ids
       FROM donations d
       LEFT JOIN stars s ON s.donation_id = d.id
       WHERE d.stripe_session_id = $1
       GROUP BY d.id`,
      [sessionId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── STRIPE WEBHOOK ─────────────────────────────────────────
// Handles checkout.session.completed:
//   1. Mark donation completed
//   2. Create star row(s)
//   3. Optionally mark victim as named
//   4. Update counter_cache via trigger
//   5. Update donor aggregate
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { donation_id, victim_id, star_count } = session.metadata;
    const count = parseInt(star_count) || 1;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark donation completed
      await client.query(
        `UPDATE donations
         SET status = 'completed',
             stripe_payment_id = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [session.payment_intent, donation_id]
      );

      // Create star rows
      const createdStarIds = [];
      const createdVictimNames = [];

      for (let i = 0; i < count; i++) {
        const nextCount = await getNextCatalogueId(client);
        const catalogueId = generateCatalogueId(nextCount);
        const thisVictimId = i === 0 && victim_id ? victim_id : null;

        await client.query(
          `INSERT INTO stars (catalogue_id, victim_id, donation_id)
           VALUES ($1, $2, $3)`,
          [catalogueId, thisVictimId, donation_id]
        );

        createdStarIds.push(catalogueId);

        if (thisVictimId) {
          createdVictimNames.push(session.metadata.victim_name || '');
        } else {
          createdVictimNames.push('In memory of those whose names are not yet known');
        }

        // counter_cache updated by trigger on each INSERT
      }

      // Mark first victim as named (if provided)
      if (victim_id) {
        await client.query(
          `UPDATE victims SET is_named = TRUE, named_at = NOW() WHERE id = $1`,
          [victim_id]
        );
      }

      // Fetch full donation details (needed for donor aggregate + certificate)
      const { rows: donationRows } = await client.query(
        `SELECT donor_id, amount_cents, donor_name, donor_email, dedication_message
         FROM donations WHERE id = $1`,
        [donation_id]
      );
      if (donationRows.length && donationRows[0].donor_id) {
        await client.query(
          `UPDATE donors
           SET total_stars         = total_stars + $1,
               total_donated_cents = total_donated_cents + $2,
               updated_at          = NOW()
           WHERE id = $3`,
          [count, donationRows[0].amount_cents, donationRows[0].donor_id]
        );
      }

      await client.query('COMMIT');
      console.log(`Donation ${donation_id} completed — ${count} star(s) created`);

      // Fire-and-forget: generate + email certificate (does not block webhook ack)
      generateAndDeliverCertificate({
        donationId: donation_id,
        donorName: donationRows[0]?.donor_name || session.customer_details?.name || 'Anonymous',
        donorEmail: donationRows[0]?.donor_email || session.customer_email,
        dedicationMessage: donationRows[0]?.dedication_message,
        starIds: createdStarIds,
        victimNames: createdVictimNames,
      }).catch(err => console.error('Certificate pipeline failed:', err));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Webhook handler error:', err);
      return res.status(500).json({ error: 'Internal error' });
    } finally {
      client.release();
    }
  }

  // Handle refunds — keep the ledger honest. Stars already named remain
  // in the registry (the memorial act stands) but the donation record
  // reflects the refund for accounting purposes.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    try {
      await pool.query(
        `UPDATE donations SET status = 'refunded'
         WHERE stripe_payment_id = $1`,
        [charge.payment_intent]
      );
      console.log(`Donation for payment ${charge.payment_intent} marked refunded`);
    } catch (err) {
      console.error('Refund webhook error:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // Clean up abandoned checkouts so 'pending' donations don't pile up.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const { donation_id } = session.metadata || {};
    if (donation_id) {
      try {
        await pool.query(
          `UPDATE donations SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
          [donation_id]
        );
      } catch (err) {
        console.error('Expired-session webhook error:', err);
      }
    }
  }

  res.json({ received: true });
}

// ── CERTIFICATE GENERATION PIPELINE ───────────────────────
// Generates the PDF, uploads it to storage, saves the URL on
// the donation row, and emails it to the donor. Runs after the
// webhook has already acknowledged Stripe, so a slow PDF render
// or flaky email provider never risks a webhook timeout/retry.
async function generateAndDeliverCertificate({
  donationId,
  donorName,
  donorEmail,
  dedicationMessage,
  starIds,
  victimNames,
}) {
  if (!donorEmail) {
    console.warn(`No donor email for donation ${donationId} — skipping certificate delivery`);
    return;
  }

  const pdfBytes = await generateCertificatePdf({
    donorName,
    starIds,
    victimNames,
    message: dedicationMessage,
  });

  const filename = `certificate-${starIds[0]}${starIds.length > 1 ? `-plus-${starIds.length - 1}` : ''}.pdf`;
  const certificateUrl = await uploadCertificate(pdfBytes, filename);

  await pool.query(
    'UPDATE donations SET certificate_url = $1 WHERE id = $2',
    [certificateUrl, donationId]
  );

  await sendCertificateEmail({
    to: donorEmail,
    donorName,
    starIds,
    victimNames,
    certificateUrl,
  });

  console.log(`Certificate generated and delivered for donation ${donationId}: ${certificateUrl}`);
}

// ── START ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Stars of David API running on port ${PORT}`);
});

export default app;
