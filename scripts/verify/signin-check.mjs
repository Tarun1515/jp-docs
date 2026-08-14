import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../..');
const PROJECTS = path.resolve(DOCS, '..');

import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:4300/auth/login', { waitUntil: 'networkidle' });

await page.fill('#loginId', 'principal@greenwood.edu.in');
/*
  🔴 From the environment, not from this file.

  This script is in a repository that is pushed. A password committed here
  outlives the decision to remove it — the history keeps it long after the
  account is gone.

  The value is in local-accounts.md, which is gitignored:
      $env:JP_SCHOOL_PASSWORD = '...'   # PowerShell
      JP_SCHOOL_PASSWORD='...' node …   # bash
*/
const password = process.env.JP_SCHOOL_PASSWORD;

if (!password) {
  console.error(
    'JP_SCHOOL_PASSWORD is not set. The password is in local-accounts.md, which is\n' +
      'gitignored — see HOW_TO_RUN §4.',
  );
  process.exit(1);
}

await page.fill('#password', password);
await page.click('button[type="submit"]');

// Condition-based, not a fixed wait: either we land somewhere new, or an error appears.
await Promise.race([
  page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 20000 }),
  page.waitForSelector('.field__error, .alert, [role="alert"]', { timeout: 20000 }),
]).catch(() => {});

console.log('  landed on   :', new URL(page.url()).pathname);
console.log('  <ui-app-shell> present :', (await page.locator('ui-app-shell').count()) > 0);
const alert = await page.locator('[role="alert"], .alert').first().textContent().catch(() => null);
console.log('  error shown :', alert ? alert.trim().replace(/\s+/g, ' ').slice(0, 90) : '(none)');

const stored = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith('jp.')),
);
console.log('  storage keys:', stored.join(', ') || '(none)');
console.log('  console errors:', errors.length ? errors.slice(0, 3).join(' | ') : '(none)');

await page.screenshot({
  path: path.join(DOCS, 'design-screens') + '/federation-jp-school-signed-in.png',
  fullPage: true,
});
await browser.close();
