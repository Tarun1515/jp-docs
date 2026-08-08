import { chromium } from 'playwright';

const BASE = 'http://localhost:4500';
const ROUTES = ['/', '/how-it-works', '/about', '/faq', '/contact', '/terms', '/privacy', '/continue?mode=login'];

const browser = await chromium.launch();
let problems = 0;
const seenLinks = new Map(); // href -> pages that use it

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const res = await page.goto(BASE + route, { waitUntil: 'networkidle' });

  const h1s = await page.locator('h1').allTextContents();
  const title = await page.title();
  const desc = await page.getAttribute('meta[name="description"]', 'content');
  const canonical = await page.getAttribute('link[rel="canonical"]', 'href');
  const ogTitle = await page.getAttribute('meta[property="og:title"]', 'content');
  const lang = await page.getAttribute('html', 'lang');

  // Heading order: no level may be skipped.
  const levels = await page.$$eval('h1,h2,h3,h4,h5,h6', (hs) =>
    hs.map((h) => Number(h.tagName[1])),
  );
  let skip = null;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      skip = `h${levels[i - 1]} -> h${levels[i]}`;
      break;
    }
  }

  // Collect internal links for the dead-link pass.
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  for (const h of hrefs) {
    if (h && h.startsWith('/') && !h.startsWith('//')) {
      if (!seenLinks.has(h)) seenLinks.set(h, []);
      seenLinks.get(h).push(route);
    }
  }

  const issues = [];
  if (res.status() !== 200) issues.push(`HTTP ${res.status()}`);
  if (h1s.length !== 1) issues.push(`${h1s.length} h1`);
  if (!title || title.length > 65) issues.push(`title ${title?.length} chars`);
  if (!desc || desc.length < 70 || desc.length > 165) issues.push(`description ${desc?.length} chars`);
  if (!canonical) issues.push('no canonical');
  if (!ogTitle) issues.push('no og:title');
  if (lang !== 'en') issues.push(`lang=${lang}`);
  if (skip) issues.push(`heading skip ${skip}`);
  if (errors.length) issues.push(`console: ${errors[0].slice(0, 60)}`);
  if (issues.length) problems++;

  console.log(`${issues.length ? '🔴' : 'ok'}  ${route.padEnd(22)} h1="${h1s[0]?.slice(0, 38) ?? '—'}"`);
  console.log(`      title(${title.length}) desc(${desc?.length ?? 0}) ${canonical}`);
  if (issues.length) console.log(`      ${issues.join(' | ')}`);

  await ctx.close();
}

// ---- dead link pass ---------------------------------------------------------
console.log('\n=== internal links found across the site ===');
const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const [href, pages] of [...seenLinks].sort()) {
  const [path, fragment] = href.split('#');
  // Navigate to about:blank first so a fragment-only move is still a real
  // navigation and goto() returns a response instead of null.
  await page.goto('about:blank');
  const r = await page.goto(BASE + path, { waitUntil: 'networkidle' });
  const h1 = (await page.locator('h1').first().textContent().catch(() => '')) ?? '';
  let dead = r === null || r.status() !== 200 || h1.includes('cannot find');
  let note = '';
  if (!dead && fragment) {
    const target = await page.locator('#' + fragment).count();
    if (target !== 1) { dead = true; note = ' (anchor #' + fragment + ' missing)'; }
    else note = ' (anchor ok)';
  }
  if (dead) problems++;
  console.log(`${dead ? '🔴 DEAD' : 'ok    '}  ${href.padEnd(26)}${note} (from ${[...new Set(pages)].length} pages)`);
}
await ctx.close();

console.log(`\n${problems === 0 ? 'NO PROBLEMS' : `🔴 ${problems} problem(s)`}`);
await browser.close();
