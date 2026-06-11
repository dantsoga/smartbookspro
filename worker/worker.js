/**
 * SmartBooks Pro — Cloudflare Worker (Stripe Checkout + Contact form)
 *
 * Endpoints:
 *   POST /api/create-client — creates a Stripe Checkout Session, returns hosted URL
 *   POST /api/contact       — receives contact-form submissions, emails them via Resend
 *   GET  /health            — health check
 *
 * Required secrets (set via: wrangler secret put <NAME>):
 *   STRIPE_SECRET_KEY  — Stripe secret key (sk_live_...)
 *   RESEND_API_KEY     — Resend API key (re_...) for contact-form email delivery
 *
 * Required vars in wrangler.toml:
 *   ALLOWED_ORIGIN   — e.g. "https://smartbooksprous.com"
 *   ONBOARDING_URL   — URL to redirect clients after payment
 *   SITE_URL         — Base URL of the site (for cancel redirect)
 *   CONTACT_EMAIL    — inbox that receives contact-form submissions
 *   CONTACT_FROM     — verified Resend sender, e.g. "SmartBooks Pro <contact@smartbooksprous.com>"
 */

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const RESEND_API = 'https://api.resend.com/emails';

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

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true }, { headers: cors(env) });
    }

    return new Response('Not found', { status: 404, headers: cors(env) });
  }
};

/* ── Stripe checkout handler ─────────────────────────────── */
async function handleCreateClient(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResp('Invalid JSON body', 400, env);
  }

  const { firstName, lastName, businessName, email, phone,
          entity, industry, planId, services, booksStatus } = body;

  if (!email || !isEmail(email) || !planId || !PLANS[planId]) {
    return errorResp('Missing required fields: email, planId', 422, env);
  }

  try {
    /* 1. Build line items */
    const lineItems = buildLineItems(planId, services, booksStatus);

    /* 2. Build customer metadata (Stripe caps values at 500 chars) */
    const metadata = {
      firstName:    clip(firstName),
      lastName:     clip(lastName),
      businessName: clip(businessName),
      email:        clip(email),
      phone:        clip(phone),
      entity:       clip(entity),
      industry:     clip(industry),
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
    return errorResp('Something went wrong creating your checkout session. Please try again or contact us.', 500, env);
  }
}

/* ── Contact form handler ────────────────────────────────── */
async function handleContact(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResp('Invalid JSON body', 400, env);
  }

  /* Honeypot: hidden field real users never fill in. Pretend success for bots. */
  if (body.company) {
    return Response.json({ success: true }, { headers: cors(env) });
  }

  const name    = clip(body.name, 200);
  const email   = clip(body.email, 200);
  const phone   = clip(body.phone, 50);
  const bizType = clip(body.business_type, 50);
  const message = clip(body.message, 5000);

  if (!name || !email || !isEmail(email)) {
    return errorResp('Please provide your name and a valid email.', 422, env);
  }

  if (!env.RESEND_API_KEY) {
    console.error('handleContact: RESEND_API_KEY is not set');
    return errorResp('Contact form is temporarily unavailable. Please email or WhatsApp us directly.', 503, env);
  }

  const text = [
    `New contact form submission — smartbooksprous.com`,
    ``,
    `Name:          ${name}`,
    `Email:         ${email}`,
    `Phone:         ${phone || '—'}`,
    `Business type: ${bizType || '—'}`,
    ``,
    `Message:`,
    message || '(none)'
  ].join('\n');

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:     env.CONTACT_FROM  || 'SmartBooks Pro <onboarding@resend.dev>',
        to:       [env.CONTACT_EMAIL || 'contact@smartbooksprous.com'],
        reply_to: email,
        subject:  `New lead: ${name}${bizType ? ` (${bizType})` : ''}`,
        text
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend ${res.status}: ${detail}`);
    }

    return Response.json({ success: true }, { headers: cors(env) });

  } catch (err) {
    console.error('handleContact error:', err);
    return errorResp('Could not send your message. Please email or WhatsApp us directly.', 500, env);
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
function clip(value, max = 450) {
  return String(value || '').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cors(env) {
  return {
    /* Fail closed: if ALLOWED_ORIGIN is unset, no cross-origin caller is allowed. */
    'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || 'https://smartbooksprous.com',
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
