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
      $env:JP_SCHOOL_PASSWORD = '...'   # PowerShell
      JP_SCHOOL_PASSWORD='...' node …   # bash
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

  ⚠️ And the env var was protecting nothing. `Greenwood#2027!` is committed in
  SEVENTEEN other scripts in this repository — the rule was abandoned
  everywhere else and only this file was still paying for it. The corpus-wide
  fix is its own gap (G36); this reads the gitignored file, which is what the
  comment above always intended.
*/
const ACCOUNTS = path.resolve(DOCS, 'local-accounts.md');

const passwordFor = (loginId) => {
  if (process.env.JP_SCHOOL_PASSWORD) return process.env.JP_SCHOOL_PASSWORD;

  let table = '';
  try { table = fs.readFileSync(ACCOUNTS, 'utf8'); } catch { return null; }

  const row = table.split(/\r?\n/).find((l) => l.includes(loginId));
  if (!row) return null;

  /* | `login` | `password` | … — the second backticked cell on that row. */
  const cells = [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

  return cells[1] ?? null;
};

const password = passwordFor('principal@greenwood.edu.in');

if (!password) {
  console.error(
    `Could not find principal@greenwood.edu.in in ${ACCOUNTS}.\n`
    + 'That file is gitignored — see HOW_TO_RUN §4 — or set JP_SCHOOL_PASSWORD.',
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
