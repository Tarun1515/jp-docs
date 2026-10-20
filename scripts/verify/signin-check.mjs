import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../..');
const PROJECTS = path.resolve(DOCS, '..');

/*
  ⚠️ Playwright comes from the npx cache, like every other suite here. A bare
  `import 'playwright'` does not resolve from this repository, which is half the
  reason this file had not run — see the note under the password below.
*/
import { createRequire } from 'node:module';
import { secret } from './lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

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
      (and if that file lives elsewhere on this machine, point
       JP_LOCAL_ACCOUNTS at it — see lib/accounts.mjs)
*/
/*
  🔴 READ FROM local-accounts.md — WHICH IS GITIGNORED — RATHER THAN DEMANDED
  FROM THE ENVIRONMENT.

  The intent above is right and stays: no password in a file that gets pushed.
  But requiring an env var meant this script would not start, and 6C-0 found it
  had not started in a long time. That matters more here than anywhere else,
  because `lib/login.mjs` now caches tokens — so THIS is the file that still
  signs in through the real form, and the only one that would notice if the
  sign-in screen broke. A canary that cannot start is not a canary.

  ⚠️ And the env var was protecting nothing: the same password was committed in
  seventeen other scripts in this repository, so the rule had been abandoned
  everywhere except here, where it cost something and bought nothing.

  🔴 G36 CLOSED THAT IN 8-0, and this file lost its bespoke reader with it. By
  then the corpus was worse than seventeen — 95 literals across 32 files — and
  every one of them now goes through `lib/accounts.mjs`. Two readers of the
  same gitignored file was the same drift one copied constant block at a time.

  ⚠️ The literal that used to be quoted in this very comment is gone too. A
  password in prose is a password in the repository; a reader looking for how
  this works does not need the value to understand the argument.
*/
/*
  ⚠️ ONE READER, SHARED — see the note above. `secret()` throws a message
  naming the file and the account rather than returning null, so a missing
  entry cannot turn into a login attempt with `undefined` and a failure
  reported against the SSO API.
*/
const passwordFor = (loginId) => {
  try {
    return secret(loginId);
  } catch {
    return null;
  }
};

const password = passwordFor('principal@greenwood.edu.in');

if (!password) {
  console.error(
    `Could not find principal@greenwood.edu.in in ${ACCOUNTS}.\n`
    + 'That file is gitignored — see HOW_TO_RUN §4 — or point JP_LOCAL_ACCOUNTS at it.',
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
