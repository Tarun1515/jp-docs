import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../..');
const PROJECTS = path.resolve(DOCS, '..');

import { chromium } from 'playwright';

const APPS = [
  { name: 'jp-admin', port: 4200, path: '/auth/login' },
  { name: 'jp-school', port: 4300, path: '/auth/login' },
  { name: 'jp-teacher', port: 4400, path: '/auth/login' },
];

const browser = await chromium.launch();

for (const app of APPS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const remoteHits = new Set();
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost:4999/'))
      remoteHits.add(r.url().replace('http://localhost:4999/', '').split('?')[0]);
  });

  await page.goto(`http://localhost:${app.port}${app.path}`, { waitUntil: 'networkidle' });

  const shells = await page.locator('ui-auth-shell').count();
  const ngCopies = await page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /_angular_core\.[^/]*\.js$/.test(n)).length,
  );
  const singleton = await page.evaluate(async () => {
    try {
      const shim = window.importShim ?? ((s) => import(/* @vite-ignore */ s));
      const core = await shim('jp-shared/core');
      const ng = await shim('@angular/core');
      return core.JP_APP_IDENTITY instanceof ng.InjectionToken;
    } catch (e) {
      return 'ERROR: ' + e.message;
    }
  });

  console.log(`\n${app.name}  (:${app.port})`);
  console.log(`  <ui-auth-shell> rendered from remote : ${shells === 1}`);
  console.log(
    `  barrels fetched from :4999           : ${[...remoteHits].filter((f) => /^(ui|core|models|pages)\.js$/.test(f)).sort().join(' ') || 'NONE'}`,
  );
  console.log(`  copies of @angular/core              : ${ngCopies}`);
  console.log(`  token instanceof host InjectionToken : ${singleton}`);
  console.log(`  console errors                       : ${errors.length ? errors[0] : '(none)'}`);

  await page.screenshot({
    path: `${path.join(DOCS, 'design-screens')}/federation-${app.name}-login.png`,
  });
  await ctx.close();
}

// jp-public: must work with NO dependency on :4999
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let touchedRemote = false;
page.on('request', (r) => {
  if (r.url().startsWith('http://localhost:4999/')) touchedRemote = true;
});
const perrors = [];
page.on('pageerror', (e) => perrors.push(e.message));

await page.goto('http://localhost:4500/continue?mode=signup', { waitUntil: 'networkidle' });
console.log('\njp-public  (:4500)  — standalone, not federated');
console.log(`  heading                     : ${await page.textContent('.chooser__heading')}`);
console.log(`  contacted :4999 at all?     : ${touchedRemote ? '🔴 YES' : 'no — fully standalone'}`);
const hrefs = await page.$$eval('.fork__option', (els) => els.map((e) => e.getAttribute('href')));
console.log(`  destinations                : ${hrefs.join('  ')}`);
console.log(`  console errors              : ${perrors.length ? perrors[0] : '(none)'}`);

await browser.close();
