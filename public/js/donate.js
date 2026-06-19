// public/js/donate.js
// Stars of David — frontend Stripe integration
//
// Replaces the simulated donation modal with real Stripe Checkout.
// Include this after the page's other scripts:
//   <script src="/js/donate.js"></script>
//
// Requires API_BASE_URL to point at your deployed backend, e.g.
//   https://api.stars-of-david.org

const API_BASE_URL = window.STARS_API_URL || 'http://localhost:3001';

// ── PAYMENTS STATUS ────────────────────────────────────────
async function checkPaymentsEnabled() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/status`);
    if (!res.ok) return true; // fail open visually; checkout call will still gate server-side
    const data = await res.json();
    return data.paymentsEnabled !== false;
  } catch {
    return true;
  }
}

function showDonationsComingSoon() {
  const btn = document.getElementById('checkout-submit-btn');
  const donateBox = document.getElementById('donate-box') || document.querySelector('.donate-box');
  if (!donateBox) return;

  const notice = document.createElement('div');
  notice.id = 'coming-soon-notice';
  notice.style.cssText = 'border:1px solid var(--border,rgba(201,168,76,0.2));background:rgba(201,168,76,0.08);padding:1.2rem 1.4rem;margin-bottom:1.5rem;font-size:0.88rem;color:var(--text-secondary,#a89e8a);line-height:1.6;font-style:italic;font-family:"EB Garamond",serif;';
  notice.textContent = 'Donations are not yet open. We are finalizing our nonprofit registration so every gift is properly accounted for — check back soon, or search and explore the names already in the registry.';
  donateBox.parentElement?.insertBefore(notice, donateBox);

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Donations open soon';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }

  document.querySelectorAll('#donate-box input, #donate-box select, .donate-box input, .donate-box select')
    .forEach(el => { el.disabled = true; });
}

// ── LIVE COUNTER ───────────────────────────────────────────
async function fetchCounter() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/counter`);
    if (!res.ok) throw new Error('Counter fetch failed');
    const data = await res.json();
    return data.named_count;
  } catch (err) {
    console.error('Could not fetch live counter, using fallback:', err);
    return null;
  }
}

// ── NAME SEARCH ────────────────────────────────────────────
let searchDebounce;
async function searchVictims(query) {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/victims/search?q=${encodeURIComponent(query.trim())}&limit=12`
    );
    if (!res.ok) throw new Error('Search failed');
    return await res.json();
  } catch (err) {
    console.error('Victim search error:', err);
    return { results: [], error: true };
  }
}

// ── RECENT STARS ───────────────────────────────────────────
async function fetchRecentStars(limit = 6) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stars/recent?limit=${limit}`);
    if (!res.ok) throw new Error('Recent stars fetch failed');
    const data = await res.json();
    return data.stars;
  } catch (err) {
    console.error('Could not fetch recent stars:', err);
    return [];
  }
}

// ── CHECKOUT ───────────────────────────────────────────────
// Creates a Stripe Checkout session and redirects the browser there.
// This is the real payment flow — replaces the old simulated modal.
async function startCheckout({
  victimId,
  victimName,
  country,
  donorName,
  donorEmail,
  message,
  starCount,
}) {
  if (!donorName || !donorEmail || !victimName) {
    throw new Error('Please fill in your name, email, and the victim\u2019s name.');
  }

  const submitBtn = document.getElementById('checkout-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirecting to secure payment…';
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/donations/create-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        victimId: victimId || null,
        victimName,
        country,
        donorName,
        donorEmail,
        message,
        starCount,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not start checkout. Please try again.');
    }

    const { url } = await res.json();
    if (!url) throw new Error('No checkout URL returned.');

    // Redirect to Stripe-hosted checkout
    window.location.href = url;
  } catch (err) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Proceed to Secure Payment';
    }
    throw err;
  }
}

// ── WIRE UP THE EXISTING PAGE ──────────────────────────────
// Hooks into the form fields and buttons already present in the
// Stars of David page markup.
document.addEventListener('DOMContentLoaded', () => {
  // Gate checkout if payments are not yet enabled (nonprofit setup pending)
  checkPaymentsEnabled().then(enabled => {
    if (!enabled) showDonationsComingSoon();
  });

  // Live counter on load
  fetchCounter().then(count => {
    if (count != null) {
      const el = document.getElementById('main-counter');
      const goal = 6000000;
      if (el) {
        el.textContent = new Intl.NumberFormat('en-US').format(count);
        const pct = (count / goal) * 100;
        const bar = document.getElementById('progress-bar');
        const pctLabel = document.getElementById('pct-label');
        if (bar) bar.style.width = pct.toFixed(4) + '%';
        if (pctLabel) pctLabel.textContent = pct.toFixed(2) + '% named';
      }
    }
  });

  // Recent stars on load
  fetchRecentStars(6).then(stars => {
    const grid = document.getElementById('recent-grid');
    if (!grid) return;
    if (!stars.length) {
      grid.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);font-style:italic;font-family:\'EB Garamond\',serif;padding:1rem 0">No stars have been named yet. Be the first to write a name in the sky.</p>';
      return;
    }
    grid.innerHTML = stars.map(s => `
      <div class="recent-card">
        <div class="recent-name">${s.victim_name || 'Name withheld'}</div>
        <div class="recent-star">✦ ${s.catalogue_id}</div>
        <div class="recent-meta">${s.country || ''}${s.death_year ? ' · ' + s.death_year : ''}<br>Named by ${s.donor_name || 'Anonymous'}</div>
        ${s.dedication_message ? `<div class="recent-dedicate">"${s.dedication_message}"</div>` : ''}
      </div>
    `).join('');
  });

  // Live name search
  const searchInput = document.getElementById('name-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(async () => {
        const q = searchInput.value.trim();
        const container = document.getElementById('name-results');
        const statusEl = document.getElementById('search-status');
        const listEl = document.getElementById('results-list');
        if (!container || !statusEl || !listEl) return;

        if (!q) { container.style.display = 'none'; return; }
        container.style.display = 'block';
        statusEl.textContent = 'Searching…';
        listEl.innerHTML = '';

        const { results, error } = await searchVictims(q);

        if (error) {
          statusEl.textContent = 'Search is temporarily unavailable. Please try again shortly.';
          return;
        }
        if (!results.length) {
          statusEl.textContent = `No matches found for "${q}".`;
          return;
        }
        statusEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} found`;
        listEl.innerHTML = results.map(r => `
          <div class="name-result-item">
            <div class="name-result-info">
              <div class="name-result-name">${[r.first_name, r.last_name].filter(Boolean).join(' ')}</div>
              <div class="name-result-meta">
                ${r.birth_year ? `Born ${r.birth_year} · ` : ''}${[r.town, r.country].filter(Boolean).join(', ')}
                ${r.fate ? `<br>${r.fate}` : ''}
                ${r.is_named ? '<br><em>A star has already been named for this person — you may add another.</em>' : ''}
              </div>
            </div>
            <button class="name-result-btn" data-victim-id="${r.id}" data-victim-name="${[r.first_name, r.last_name].filter(Boolean).join(' ')}" data-country="${r.country || ''}" onclick="window.selectVictimFromSearch(this)">Name a star →</button>
          </div>
        `).join('');
      }, 350);
    });
  }
});

// Called by the inline onclick on search result buttons
window.selectVictimFromSearch = function (btn) {
  const victimId = btn.getAttribute('data-victim-id');
  const victimName = btn.getAttribute('data-victim-name');
  const country = btn.getAttribute('data-country');

  document.getElementById('victim-name').value = victimName;
  document.getElementById('victim-country').value = country;
  document.getElementById('victim-name').dataset.victimId = victimId;
  document.getElementById('donate')?.scrollIntoView({ behavior: 'smooth' });
};

// Called by the "Proceed to Secure Payment" button
window.handleCheckoutSubmit = async function () {
  const victimNameEl = document.getElementById('victim-name');
  const errorEl = document.getElementById('checkout-error');

  try {
    await startCheckout({
      victimId: victimNameEl?.dataset.victimId || null,
      victimName: victimNameEl?.value,
      country: document.getElementById('victim-country')?.value,
      donorName: document.getElementById('donor-name')?.value,
      donorEmail: document.getElementById('donor-email')?.value,
      message: document.getElementById('donor-message')?.value,
      starCount: document.getElementById('star-count')?.value || 1,
    });
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } else {
      alert(err.message);
    }
  }
};
