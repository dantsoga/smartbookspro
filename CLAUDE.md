# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static single-page marketing website for **SmartBooks Pro, LLC** (owner: Daniel Tsou). Domain: `smartbooksprous.com`. No build system, no dependencies, no package manager — the entire site is a single `index.html` with all CSS and JS inline, plus `logo.svg`.

To preview: open `index.html` directly in a browser. There is no dev server, no build step, and no test suite.

## Architecture

Everything lives in `index.html`:

- **CSS** — all styles in a `<style>` block in `<head>`, ordered: reset/variables → typography → layout utilities → component blocks (navbar, hero, each section) → responsive breakpoints at `960px` and `620px`
- **HTML** — sections in document order: `#navbar` → `#hero` → `#who-we-help` → `#why-us` → `#pricing` → `#tech-automation` → `#how-it-works` → `#testimonials` → `#faq` → `#contact` → `#footer` → `.wa-float`
- **JS** — single `<script>` block at end of `<body>` with no framework

### Design tokens (CSS custom properties)

All colors, shadows, radii, and the transition easing are defined as variables on `:root`. Always use these — never hardcode values that duplicate a token.

| Token | Value |
|---|---|
| `--navy` / `--navy-mid` / `--navy-deep` | `#1B2A4A` / `#243560` / `#141f38` |
| `--gold` / `--gold-dark` / `--gold-glow` | `#C9A84C` / `#a8863a` / `rgba(201,168,76,0.25)` |
| `--radius` / `--radius-lg` | `14px` / `22px` |
| `--ease` | `all 0.3s cubic-bezier(0.4,0,0.2,1)` |
| `--shadow-sm` / `--shadow` / `--shadow-lg` | three tiers of navy-tinted box shadows |

### Bilingual system (EN/ES)

Every user-visible text node uses `data-en="..."` and `data-es="..."` attributes. `setLang(lang)` in the script iterates all `[data-en]` elements and sets `textContent` — but **only on leaf nodes** (`el.children.length === 0`). Elements that mix text and child tags must have translations on the child spans individually, not on the parent. Input/textarea placeholders use companion `data-en-placeholder` / `data-es-placeholder` attributes. The language toggle buttons appear in three places (desktop nav, mobile menu, footer) and are all updated by toggling the `.active` class based on `btn.textContent`.

### Scroll animations

Any element with class `fade-up` is observed by `fadeObserver` (IntersectionObserver). When it enters the viewport, the class `in` is added, which triggers the CSS opacity/transform transition. Stagger delay is applied via `data-anim-delay` (0–4), multiplied by 100ms. Add `fade-up` to new card or section elements to match the existing animation behaviour.

### Pricing section structure

The pricing section (line ~1358) has four layers stacked vertically:
1. `.pricing-grid` — 4-column card grid (→ 2-col at 960px → 1-col at 620px)
2. `.pricing-note` — small italic disclaimer
3. `.payroll-box` — payroll add-on table
4. `.services-box` — hourly & one-time flat-fee services

Each `.pricing-card` follows: plan name → `.pricing-tagline` (italic) → price → desc → `.qbo-included` callout → `.pricing-divider` → `.pricing-features` list → CTA button. The CFO card uses the additional class `.cfo` which overrides the white background with a dark navy gradient; all child colour overrides for `.cfo` are co-located directly after the base `.pricing-card.cfo` rule.

### Special card variants

- `.pricing-card.popular` — gold border, `scale(1.04)`, `z-index: 1`. Currently applied to Controller tier.
- `.pricing-card.cfo` — dark navy gradient background; all child text/color overrides live in the CSS block immediately following the base `.cfo` rule.
- `.why-card:nth-child(4)` and `:nth-child(5)` — explicit `grid-column` placement to center the last two cards in a 6-column sub-grid.

## Pending production tasks

- **Contact form**: wired to the Cloudflare Worker at `POST /api/contact`, which emails submissions via Resend. Requires the `RESEND_API_KEY` secret on the worker (`npx wrangler secret put RESEND_API_KEY`); until it's set the form shows a friendly error.
- **Testimonials**: placeholder copy is in place. The section is marked with `<!-- Replace with real testimonials when available -->`.
- **WhatsApp number**: all three `wa.me` links already use `13054957636` — verify this is the correct number before launch.

## Spanish landing page (`es/index.html`)

Generated — never edit by hand. Run `node scripts/build-es.js` after any change to `index.html`; it applies the `data-es` translations statically, sets Spanish meta/canonical (`https://smartbooksprous.com/es/`), and makes asset/link URLs root-relative. Both pages carry reciprocal `hreflang` tags, and `sitemap.xml` lists both. Include `es/index.html`, `sitemap.xml`, and `robots.txt` in every Pages deploy.

## Content ownership

- Email: `contact@smartbooksprous.com` (business inbox, shown on all pages; owner's personal email is `dtsou.consulting@gmail.com`)
- LinkedIn: `https://www.linkedin.com/in/daniel-tsou-73465b46`
- Logo: `sbplogo.png` — replaces the original `logo.svg`; referenced via `<img src="sbplogo.png">` in navbar, hero, and footer of all pages.
