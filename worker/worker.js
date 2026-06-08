/**
 * SmartBooks Pro — Cloudflare Worker (Stripe Checkout)
 *
 * Receives questionnaire submissions, creates a Stripe Checkout Session,
 * and returns the hosted checkout URL.
 *
 * Required secrets (set via: wrangler secret put <NAME>):
 *   STRIPE_SECRET_KEY      — Stripe secret key (sk_live_...)
 *   WHATSAPP_ACCESS_TOKEN  — Meta Graph API access token for the WA Business number
 *   WA_REPLY_SECRET        — Shared secret the CS agent (Alex) must send to use /api/wa-reply
 *
 * Required vars in wrangler.toml:
 *   ALLOWED_ORIGIN   — e.g. "https://smartbooksprous.com"
 *   ONBOARDING_URL   — URL to redirect clients after payment
 *   SITE_URL         — Base URL of the site (for cancel redirect)
 */

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

const WA_PHONE_NUMBER_ID = '1163868386807701';
const WA_GRAPH_API = `https://graph.facebook.com/v25.0/${WA_PHONE_NUMBER_ID}/messages`;

/* ── Plan definitions ─────────────────────────────────────── */
const PLANS = {
  accountant:  { priceId: 'price_1TepRD2NubnCGyyy40r4tPN9', label: 'Accountant Plan — Monthly Bookkeeping'        },
  manager:     { priceId: 'price_1TepRS2NubnCGyyywynwS94T', label: 'Accounting Manager Plan — Monthly Bookkeeping' },
  controller:  { priceId: 'price_1TepRX2NubnCGyyyEkSRyYbA', label: 'Controller Plan — Monthly Bookkeeping'        },
  cfo:         { priceId: 'price_1TepRn2NubnCGyyygsNP3qoZ', label: 'CFO Advisory Plan — Monthly Bookkeeping'      }
};

const CATCHUP = {
  behind_1_3:   { priceId: 'price_1TepS52NubnCGyyyByStDHsM', label: 'Books Catch-Up Service (1–3 months)'  },
  behind_3_6:   { priceId: 'price_1TepS82NubnCGyyynPe0S90Q', label: 'Books Catch-Up Service (3–6 months)'  },
  behind_6plus: { priceId: 'price_1TepS82NubnCGyyyQPozw48P', label: 'Books Catch-Up Service (6+ months)'   }
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

    if (url.pathname === '/api/wa-reply' && request.method === 'POST') {
      return handleWaReply(request, env);
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
      params.append(`line_items[${i}][price]`,    item.priceId);
      params.append(`line_items[${i}][quantity]`, '1');
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

/* ── WhatsApp reply (CS agent → customer) ─────────────────── */
async function handleWaReply(request, env) {
  if (request.headers.get('X-Worker-Secret') !== env.WA_REPLY_SECRET) {
    return errorResp('Unauthorized', 401, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResp('Invalid JSON body', 400, env);
  }

  const { to, message } = body;

  if (!to || !message) {
    return errorResp('Missing required fields: to, message', 400, env);
  }

  try {
    const graphRes = await fetch(WA_GRAPH_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      })
    });

    const data = await graphRes.json();

    return Response.json(data, { status: graphRes.status, headers: cors(env) });

  } catch (err) {
    console.error('handleWaReply error:', err);
    return errorResp(err.message, 500, env);
  }
}

/* ── Line items ──────────────────────────────────────────── */
function buildLineItems(planId, services = {}, booksStatus) {
  const items = [];

  const plan = PLANS[planId];
  items.push({ priceId: plan.priceId, name: plan.label });

  const catchup = CATCHUP[booksStatus];
  if (catchup) {
    items.push({ priceId: catchup.priceId, name: catchup.label });
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
