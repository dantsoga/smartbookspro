/**
 * SmartBooks Pro — Cloudflare Worker (Stripe Checkout)
 *
 * Receives questionnaire submissions, creates a Stripe Checkout Session,
 * and returns the hosted checkout URL.
 *
 * Required secret (set via: wrangler secret put STRIPE_SECRET_KEY):
 *   STRIPE_SECRET_KEY  — Stripe secret key (sk_live_...)
 *
 * Required vars in wrangler.toml:
 *   ALLOWED_ORIGIN   — e.g. "https://smartbooksprous.com"
 *   ONBOARDING_URL   — URL to redirect clients after payment
 *   SITE_URL         — Base URL of the site (for cancel redirect)
 */

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

/* ── Plan definitions ─────────────────────────────────────── */
const PLANS = {
  accountant: { label: 'Accountant Plan — Monthly Bookkeeping',           price: 35000  },
  manager:    { label: 'Accounting Manager Plan — Monthly Bookkeeping',    price: 70000  },
  controller: { label: 'Controller Plan — Monthly Bookkeeping',            price: 140000 },
  cfo:        { label: 'CFO Advisory Plan — Monthly Bookkeeping',          price: 250000 }
};

const CATCHUP = {
  behind_1_3:  { label: 'Books Catch-Up Service (1–3 months)',  price: 25000 },
  behind_3_6:  { label: 'Books Catch-Up Service (3–6 months)',  price: 45000 },
  behind_6plus:{ label: 'Books Catch-Up Service (6+ months)',   price: 75000 }
};

/* ── Entry point ─────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/create-client' && request.method === 'POST') {
      return handleCreateClient(request, env);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true }, { headers: cors(env) });
    }

    return new Response('Not found', { status: 404, headers: cors(env) });
  }
};

/* ── Main handler ────────────────────────────────────────── */
async function handleCreateClient(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResp('Invalid JSON body', 400, env);
  }

  const { firstName, lastName, businessName, email, phone,
          entity, industry, planId, services, booksStatus } = body;

  if (!email || !planId || !PLANS[planId]) {
    return errorResp('Missing required fields: email, planId', 422, env);
  }

  try {
    /* 1. Build line items */
    const lineItems = buildLineItems(planId, services, booksStatus);

    /* 2. Build customer metadata */
    const metadata = {
      firstName:    firstName    || '',
      lastName:     lastName     || '',
      businessName: businessName || '',
      email:        email,
      phone:        phone        || '',
      entity:       entity       || '',
      industry:     industry     || '',
      planId:       planId
    };

    /* 3. Create Stripe Checkout Session */
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url',
      env.ONBOARDING_URL
        ? `${env.ONBOARDING_URL}?name=${encodeURIComponent(firstName || '')}`
        : `${env.SITE_URL}/onboarding.html?name=${encodeURIComponent(firstName || '')}`
    );
    params.append('cancel_url', `${env.SITE_URL}/questionnaire.html`);

    lineItems.forEach((item, i) => {
      params.append(`line_items[${i}][price_data][currency]`,                  'usd');
      params.append(`line_items[${i}][price_data][product_data][name]`,        item.name);
      params.append(`line_items[${i}][price_data][unit_amount]`,               String(item.amount));
      params.append(`line_items[${i}][quantity]`,                              '1');
    });

    params.append('customer_email', email);
    Object.entries(metadata).forEach(([k, v]) => {
      params.append(`metadata[${k}]`, v);
    });

    const stripeRes = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeRes.json();

    if (!session.url) {
      throw new Error('Stripe session creation failed: ' + JSON.stringify(session));
    }

    return Response.json(
      { success: true, paymentUrl: session.url, sessionId: session.id },
      { headers: cors(env) }
    );

  } catch (err) {
    console.error('handleCreateClient error:', err);
    return errorResp(err.message, 500, env);
  }
}

/* ── Line items ──────────────────────────────────────────── */
function buildLineItems(planId, services = {}, booksStatus) {
  const items = [];

  const plan = PLANS[planId];
  items.push({ name: plan.label, amount: plan.price });

  const catchup = CATCHUP[booksStatus];
  if (catchup) {
    items.push({ name: catchup.label, amount: catchup.price });
  }

  return items;
}

/* ── Helpers ─────────────────────────────────────────────── */
function cors(env) {
  return {
    'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function errorResp(message, status, env) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: cors(env) }
  );
}
