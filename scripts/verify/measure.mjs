import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// ---- 1. is the sticky header a real bug or a fullPage artifact? -------------
await page.goto('http://localhost:4500/contact', { waitUntil: 'networkidle' });
const headerAtTop = await page.locator('.site-header').boundingBox();
await page.evaluate(() => window.scrollTo(0, 1200));
await page.waitForTimeout(200);
const headerScrolled = await page.locator('.site-header').boundingBox();
const headerViewportY = await page.evaluate(
  () => document.querySelector('.site-header').getBoundingClientRect().top,
);
console.log('=== 1. sticky header on /contact');
console.log(`  document y at top      : ${headerAtTop.y}`);
console.log(`  document y at scroll   : ${Math.round(headerScrolled.y)}  (moves with scroll = sticky working)`);
console.log(`  VIEWPORT y when scrolled: ${headerViewportY}  <- 0 means pinned correctly`);
console.log(`  how many .site-header  : ${await page.locator('.site-header').count()}`);
await page.evaluate(() => window.scrollTo(0, 0));

// ---- 2. content column alignment on every page -----------------------------
console.log('\n=== 2. main text column at 1440 (viewport centre = 720)');
const targets = [
  { url: '/', sel: '.verified', label: 'home / verified' },
  { url: '/', sel: '.section__header', label: 'home / section header' },
  { url: '/how-it-works', sel: '.stage-intro', label: 'how-it-works / intro' },
  { url: '/how-it-works', sel: '.stages', label: 'how-it-works / stages grid' },
  { url: '/about', sel: '.prose', label: 'about / prose' },
  { url: '/faq', sel: '.qa', label: 'faq / qa list' },
  { url: '/faq', sel: '.section-title', label: 'faq / section title' },
  { url: '/terms', sel: '.prose', label: 'terms / prose' },
  { url: '/contact', sel: '.contact', label: 'contact / grid' },
];

for (const t of targets) {
  await page.goto('http://localhost:4500' + t.url, { waitUntil: 'networkidle' });
  const box = await page.locator(t.sel).first().boundingBox();
  if (!box) {
    console.log(`  ${t.label.padEnd(28)} NOT FOUND`);
    continue;
  }
  const left = Math.round(box.x);
  const right = Math.round(1440 - (box.x + box.width));
  const centred = Math.abs(left - right) <= 2;
  console.log(
    `  ${t.label.padEnd(28)} left ${String(left).padStart(4)}  right ${String(right).padStart(4)}  w ${String(Math.round(box.width)).padStart(4)}  ${centred ? 'centred' : '🔴 OFF-CENTRE by ' + Math.abs(left - right)}`,
  );
}

await browser.close();
