import { chromium } from 'playwright';

const PUBLIC = 'http://localhost:4500';
const browser = await chromium.launch();

// Every combination: two modes x two audiences, clicked for real.
const cases = [
  { mode: 'login', card: 0, expect: 'http://localhost:4300/auth/login', who: 'school' },
  { mode: 'login', card: 1, expect: 'http://localhost:4400/auth/login', who: 'teacher' },
  { mode: 'signup', card: 0, expect: 'http://localhost:4300/auth/register', who: 'school' },
  { mode: 'signup', card: 1, expect: 'http://localhost:4400/auth/register', who: 'teacher' },
];

let failures = 0;

for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${PUBLIC}/continue?mode=${c.mode}`, { waitUntil: 'networkidle' });
  const heading = await page.textContent('.chooser__heading');

  await page.locator('.fork__option').nth(c.card).click();
  await page.waitForLoadState('networkidle');

  const landed = page.url().replace(/\/$/, '');
  // Did the target app actually render its auth screen, not a 404?
  const shell = await page.locator('ui-auth-shell').count();
  const notFound = (await page.locator('text=Page not found').count()) > 0;

  const ok = landed === c.expect && shell === 1 && !notFound;
  if (!ok) failures++;

  console.log(`${ok ? 'PASS' : '🔴 FAIL'}  mode=${c.mode.padEnd(6)} ${c.who.padEnd(7)} "${heading}"`);
  console.log(`        -> ${landed}`);
  console.log(`        ui-auth-shell=${shell}  404=${notFound}  errors=${errors.length ? errors[0] : 'none'}`);

  await ctx.close();
}

// mode carried in both directions from the quiet line underneath
for (const mode of ['login', 'signup']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${PUBLIC}/continue?mode=${mode}`, { waitUntil: 'networkidle' });
  const prompt = (await page.textContent('.chooser__alternate')).trim().replace(/\s+/g, ' ');
  const hrefs = await page.$$eval('.chooser__alternate a', (a) => a.map((x) => x.getAttribute('href')));
  console.log(`\nmode=${mode} alternate line: ${prompt}`);
  console.log(`        ${hrefs.join('  ')}`);
  await ctx.close();
}

console.log(`\n${failures === 0 ? 'ALL 4 PATHS PASS' : `🔴 ${failures} FAILED`}`);
await browser.close();
