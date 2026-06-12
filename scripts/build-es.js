/**
 * build-es.js — generates es/index.html (static Spanish version) from index.html.
 *
 * Uses the existing data-es / data-es-placeholder attributes as the source of
 * truth, so translations are maintained in one place (index.html). Re-run this
 * after any change to index.html, then deploy both pages.
 *
 * Usage:  node scripts/build-es.js
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.join(__dirname, '..');
const src  = path.join(root, 'index.html');
const outDir = path.join(root, 'es');
const out  = path.join(outDir, 'index.html');

const $ = cheerio.load(fs.readFileSync(src, 'utf8'));

/* 1. Apply Spanish text statically (mirrors setLang('es') in the page JS) */
$('[data-es]').each((_, el) => {
  const $el = $(el);
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const ph = $el.attr('data-es-placeholder');
    if (ph) $el.attr('placeholder', ph);
  } else if (tag === 'OPTION' || $el.children().length === 0) {
    $el.text($el.attr('data-es'));
  }
});

/* 2. Head: language, title, meta, canonical */
$('html').attr('lang', 'es');
$('title').text('SmartBooks Pro, LLC — Libros Profesionales. Precio de Pequeño Negocio.');
$('meta[name="description"]').attr('content',
  'SmartBooks Pro LLC — Contabilidad profesional para pequeños negocios. Más de 20 años de experiencia. Servicio bilingüe inglés/español. Certificados en QuickBooks Online.');
$('meta[property="og:title"]').attr('content',
  'SmartBooks Pro, LLC — Libros Profesionales. Precio de Pequeño Negocio.');
$('meta[property="og:description"]').attr('content',
  'Contabilidad profesional para dueños de pequeños negocios. Servicio bilingüe, precios transparentes, consulta gratuita.');
$('meta[property="og:url"]').attr('content', 'https://smartbooksprous.com/es/');
$('link[rel="canonical"]').attr('href', 'https://smartbooksprous.com/es/');

/* 3. JSON-LD in Spanish */
const ld = $('script[type="application/ld+json"]');
if (ld.length) {
  const data = JSON.parse(ld.html());
  data.description = 'Contabilidad profesional para pequeños negocios. Servicio bilingüe inglés/español. Certificados en QuickBooks Online.';
  data.url = 'https://smartbooksprous.com/es/';
  data.inLanguage = 'es';
  ld.text('\n  ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ') + '\n  ');
}

/* 4. Root-relative URLs so assets and links work from /es/ */
$('[src="sbplogo.png"]').attr('src', '/sbplogo.png');
$('link[href="sbplogo.png"]').attr('href', '/sbplogo.png');
$('a[href="questionnaire.html"]').attr('href', '/questionnaire.html');
$('a[href="terms.html"]').attr('href', '/terms.html');
$('a[href="privacy.html"]').attr('href', '/privacy.html');

/* 5. ES toggle buttons active by default */
$('.lang-btn').each((_, el) => {
  const $el = $(el);
  $el.toggleClass('active', $el.text().trim() === 'ES');
});

/* 6. Page JS: default language is Spanish on this page */
let html = $.html();
html = html.replace("let currentLang = 'en';", "let currentLang = 'es';");
html = html.replace(
  /const lang = saved \|\| \(\(navigator\.language[^;]+;\s*\n\s*if \(lang !== 'en'\) setLang\(lang\);/,
  "const lang = saved || 'es';\n  if (lang !== 'es') setLang(lang);"
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('Wrote', out, '(' + html.length + ' bytes)');
