import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../..');
const PROJECTS = path.resolve(DOCS, '..');

import { chromium } from 'playwright';

const OUT = path.join(DOCS, 'design-screens');
const PAGES = [
  { name: 'home', url: '/' },
  { name: 'how-it-works', url: '/how-it-works' },
  { name: 'about', url: '/about' },
  { name: 'faq', url: '/faq' },
  { name: 'contact', url: '/contact' },
  { name: 'terms', url: '/terms' },
];
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
];


// Playwright's fullPage capture scrolls and stitches. A position:sticky header
// re-renders at its pinned position in each band, so it shows up partway down
// the image — an artifact of the capture, not of the page. (Verified: only one
// .site-header exists and it pins at viewport top 0 when scrolled.) Pinning it
// to the top for the capture gives a screenshot that matches what a person
// actually sees.
const UNSTICK = `.site-header, .jump { position: static !important; }`;

const browser = await chromium.launch();

for (const p of PAGES) {
  for (const { w, h } of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:4500${p.url}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: UNSTICK });

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`${p.name.padEnd(14)} ${String(w).padStart(4)}px  h-scroll: ${scrolls ? '🔴 YES' : 'no'}`);

    await page.screenshot({ path: `${OUT}/public-${p.name}-${w}.png`, fullPage: true });
    await ctx.close();
  }
}

// Contact form: does an invalid submit surface errors, and a valid one the notice?
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:4500/contact', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: UNSTICK });
await page.click('button[type="submit"]');
console.log(`\ncontact, empty submit  -> ${await page.locator('.field__error').count()} field errors`);

await page.fill('#name', 'Anita Rao');
await page.fill('#email', 'anita@greenwood.edu.in');
await page.fill('#subject', 'Verification for our school');
await page.fill('#message', 'We run a CBSE school in Pune and would like to know what verification involves before we register.');
await page.click('button[type="submit"]');
await page.waitForSelector('.notice');
console.log(`contact, valid submit  -> "${(await page.textContent('.notice__title')).trim()}"`);
const mailto = await page.getAttribute('.notice a.btn', 'href');
console.log(`mailto prefilled       -> ${mailto.slice(0, 78)}...`);
await page.screenshot({ path: `${OUT}/public-contact-unsent-1440.png`, fullPage: true });

await browser.close();
