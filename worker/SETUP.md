# Cloudflare Worker Setup — SmartBooks Pro

## Prerequisites
- Cloudflare account (free at cloudflare.com)
- Node.js installed
- QuickBooks Payments enabled on your QBO account

---

## Step 1 — Create an Intuit Developer App

1. Go to https://developer.intuit.com and sign in with your Intuit/QBO account
2. Click **Dashboard → Create an App**
3. Choose **QuickBooks Online and Payments**
4. Name it "SmartBooks Pro API" → click **Create app**
5. Go to **Keys & credentials** → copy your **Client ID** and **Client Secret**
6. Under **Redirect URIs**, add: `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`

---

## Step 2 — Get Your OAuth Refresh Token

1. Go to https://developer.intuit.com/app/developer/playground
2. Select **Authorization Code** flow
3. Under **Select scopes**, check:
   - `com.intuit.quickbooks.accounting`
   - `com.intuit.quickbooks.payment`
4. Click **Get Authorization Code**
5. Authorize with your QBO account
6. Click **Get Tokens** → copy the **Refresh Token**

> The refresh token lasts 100 days. After that, repeat this step.
> Future: automate token rotation in the Worker using KV storage.

---

## Step 3 — Find Your QBO Realm ID

Log into QBO. Your Realm ID is in the URL:
`https://app.qbo.intuit.com/app/homepage?deeplinkcompanyid=XXXXXXXXXX`

The number after `deeplinkcompanyid=` is your **QB_REALM_ID**.

---

## Step 4 — Deploy the Worker

```bash
# Install Wrangler CLI
npm install -g wrangler

# Authenticate with Cloudflare
npx wrangler login

# Set secrets (you'll be prompted to paste each value)
npx wrangler secret put QB_CLIENT_ID
npx wrangler secret put QB_CLIENT_SECRET
npx wrangler secret put QB_REFRESH_TOKEN
npx wrangler secret put QB_REALM_ID

# Deploy
npx wrangler deploy
```

Wrangler will print your Worker URL, e.g.:
`https://smartbooks-pro-api.YOUR_SUBDOMAIN.workers.dev`

---

## Step 5 — Update the Questionnaire

Open `questionnaire.html` and find this line near the top of the `<script>` block:

```js
workerUrl: 'https://smartbooks-pro-api.YOUR_SUBDOMAIN.workers.dev/api/create-client',
```

Replace `YOUR_SUBDOMAIN` with the subdomain from Step 4.

---

## Step 6 — Set QB Payment Success Redirect (optional but recommended)

In QBO:
1. Go to **Settings → Account and Settings → Payments**
2. Under **Payment confirmation**, set the redirect URL to:
   `https://smartbooksprous.com/onboarding.html`

This sends customers to the onboarding page after they pay.

---

## Testing

Hit the health endpoint to confirm the Worker is live:
```
GET https://smartbooks-pro-api.YOUR_SUBDOMAIN.workers.dev/health
→ { "ok": true }
```

Then test a full submission by filling the questionnaire and submitting.
Check your QBO Customers and Invoices for the new entry.
