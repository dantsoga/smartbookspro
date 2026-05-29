/**
 * SmartBooks Pro — Cloudflare Worker
 *
 * Receives questionnaire submissions, creates a QuickBooks customer
 * and invoice, then returns the QB payment link.
 *
 * Required secrets (set via: wrangler secret put <NAME>):
 *   QB_CLIENT_ID       — Intuit app Client ID
 *   QB_CLIENT_SECRET   — Intuit app Client Secret
 *   QB_REFRESH_TOKEN   — Long-lived OAuth 2.0 refresh token
 *   QB_REALM_ID        — Your QBO company ID (14-digit number)
 *
 * Required vars in wrangler.toml:
 *   ALLOWED_ORIGIN     — e.g. "https://smartbooksprous.com" (or "*" for testing)
 *   ONBOARDING_URL     — URL to redirect clients after payment
 */

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API       = (realmId) => `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

/* ── Plan definitions ─────────────────────────────────────── */
const PLANS = {
  accountant: { label: 'Accountant Plan — Monthly Bookkeeping',           price: 350  },
  manager:    { label: 'Accounting Manager Plan — Monthly Bookkeeping',    price: 700  },
  controller: { label: 'Controller Plan — Monthly Bookkeeping',            price: 1400 },
  cfo:        { label: 'CFO Advisory Plan — Monthly Bookkeeping',          price: 2500 }
};

const CATCHUP = {
  behind_1_3:  { label: 'Books Catch-Up Service (1–3 months)',  price: 250 },
  behind_3_6:  { label: 'Books Catch-Up Service (3–6 months)',  price: 450 },
  behind_6plus:{ label: 'Books Catch-Up Service (6+ months)',   price: 750 }
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
    /* 1. Get fresh QB access token */
    const token = await refreshQBToken(env);

    /* 2. Create QB customer */
    const customer = await createCustomer(
      { firstName, lastName, businessName, email, phone, entity, industry },
      token, env.QB_REALM_ID
    );

    /* 3. Build invoice line items */
    const lines = buildLines(planId, services, booksStatus);

    /* 4. Create invoice */
    const invoice = await createInvoice(customer.Id, email, lines, token, env.QB_REALM_ID);

    /* 5. Read invoice back to get the public payment URL */
    const invoiceRead = await readInvoice(invoice.Id, token, env.QB_REALM_ID);

    /* 6. Use InvoiceLink from QBO if available, fall back to internal URL */
    const paymentUrl = invoiceRead.InvoiceLink ||
      `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`;

    const onboardingUrl = env.ONBOARDING_URL
      ? `${env.ONBOARDING_URL}?name=${encodeURIComponent(firstName || '')}`
      : `onboarding.html?name=${encodeURIComponent(firstName || '')}`;

    return Response.json(
      { success: true, paymentUrl, onboardingUrl, invoiceId: invoice.Id,
        _debug_invoice_fields: Object.keys(invoiceRead) },
      { headers: cors(env) }
    );

  } catch (err) {
    console.error('handleCreateClient error:', err);
    return errorResp(err.message, 500, env);
  }
}

/* ── QB OAuth ────────────────────────────────────────────── */
async function refreshQBToken(env) {
  const creds = btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`);
  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json'
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(env.QB_REFRESH_TOKEN)}`
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('QB token refresh failed: ' + JSON.stringify(data));
  }
  return data.access_token;
}

/* ── QB Customer ─────────────────────────────────────────── */
async function createCustomer(info, token, realmId) {
  const displayName = info.businessName || `${info.firstName} ${info.lastName}`;

  const payload = {
    GivenName:        info.firstName  || '',
    FamilyName:       info.lastName   || '',
    DisplayName:      displayName,
    CompanyName:      info.businessName || '',
    PrimaryEmailAddr: { Address: info.email },
    ...(info.phone ? { PrimaryPhone: { FreeFormNumber: info.phone } } : {}),
    Notes: [
      info.entity   ? `Entity: ${info.entity}`     : '',
      info.industry ? `Industry: ${info.industry}`  : ''
    ].filter(Boolean).join(' | ')
  };

  const res = await fetch(`${QB_API(realmId)}/customer`, {
    method: 'POST',
    headers: qbHeaders(token),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.Customer) {
    throw new Error('QB customer creation failed: ' + JSON.stringify(data));
  }
  return data.Customer;
}

/* ── QB Invoice lines ────────────────────────────────────── */
function buildLines(planId, services = {}, booksStatus) {
  const lines = [];

  const plan = PLANS[planId];
  lines.push(makeLine(plan.label, plan.price));

  if (services.payroll) {
    lines.push(makeLine('Payroll Management Add-on', 0, 'Pricing to be confirmed — our team will contact you.'));
  }

  const catchup = CATCHUP[booksStatus];
  if (catchup) {
    lines.push(makeLine(catchup.label, catchup.price));
  }

  return lines;
}

function makeLine(description, amount, note) {
  return {
    DetailType: 'SalesItemLineDetail',
    Amount: amount,
    Description: note ? `${description}\n${note}` : description,
    SalesItemLineDetail: {
      UnitPrice: amount,
      Qty: 1
    }
  };
}

/* ── QB Invoice ──────────────────────────────────────────── */
async function createInvoice(customerId, email, lines, token, realmId) {
  const payload = {
    CustomerRef:  { value: customerId },
    BillEmail:    { Address: email },
    EmailStatus:  'NotSet',
    Line:         lines
  };

  const res = await fetch(`${QB_API(realmId)}/invoice`, {
    method: 'POST',
    headers: qbHeaders(token),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.Invoice) {
    throw new Error('QB invoice creation failed: ' + JSON.stringify(data));
  }
  return data.Invoice;
}

async function sendInvoice(invoiceId, email, token, realmId) {
  await fetch(
    `${QB_API(realmId)}/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(email)}`,
    { method: 'POST', headers: { ...qbHeaders(token), 'Content-Type': 'application/octet-stream' } }
  );
}

async function readInvoice(invoiceId, token, realmId) {
  const res = await fetch(
    `${QB_API(realmId)}/invoice/${invoiceId}`,
    { method: 'GET', headers: qbHeaders(token) }
  );
  const data = await res.json();
  return data.Invoice;
}

/* ── Helpers ─────────────────────────────────────────────── */
function qbHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json'
  };
}

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
