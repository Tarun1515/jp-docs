import { chromium } from 'playwright';
import lighthouse from 'lighthouse';

import { discoverJobSlug } from './lib/job-slug.mjs';

/*
  SEO and accessibility on every public page. 2.44 set the bar at 100/100 and
  this is what holds it there.

  ----------------------------------------------------------------------------
  🔴 /jobs AND /jobs/:slug JOINED THE LIST IN 7A, AND THE DETAIL ROUTE IS
  DISCOVERED RATHER THAN WRITTEN DOWN
  ----------------------------------------------------------------------------
  A job's URL contains its uid, so there is no fixed path to put in this array.
  The slug is read from the live listing instead.

  ⚠️ If there are no live jobs, the detail page is NOT silently skipped — the
  run says so and exits non-zero. A page that quietly drops out of an audit is
  a page nobody notices going unaudited, which is the same failure as a suite
  that silently gets smaller.

  Run (jp-public :4500, App API :5299):  node scripts/verify/lh.mjs
*/
const STATIC_ROUTES = [
  '/',
  '/jobs',
  '/how-it-works',
  '/about',
  '/faq',
  '/contact',
  '/terms',
  '/privacy',
];

const PORT = 9222;
const SITE = 'http://localhost:4500';

const slug = await discoverJobSlug();

if (!slug) {
  console.error(
    '\n🔴 NO LIVE JOB, so /jobs/:slug cannot be audited and this run proves nothing\n'
    + '   about it. Publish a job (or run a suite that leaves one) and try again.\n'
    + '   Refusing to report a score for pages that were not all measured.\n',
  );

  process.exitCode = 1;
}

const routes = slug ? [...STATIC_ROUTES, `/jobs/${slug}`] : STATIC_ROUTES;

const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
let worst = 100;

for (const route of routes) {
  const result = await lighthouse(
    `${SITE}${route}`,
    { port: PORT, output: 'json', logLevel: 'error' },
    { extends: 'lighthouse:default', settings: { onlyCategories: ['seo', 'accessibility'] } },
  );

  const seo = Math.round(result.lhr.categories.seo.score * 100);
  const a11y = Math.round(result.lhr.categories.accessibility.score * 100);
  worst = Math.min(worst, seo, a11y);

  const failed = Object.values(result.lhr.audits)
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
    .map((a) => a.id);

  /* A long job slug would wreck the column, so it is shortened for display. */
  const label = route.startsWith('/jobs/') ? '/jobs/:slug' : route;

  console.log(`${label.padEnd(15)} SEO ${seo}   a11y ${a11y}${failed.length ? '   failing: ' + failed.join(', ') : ''}`);
}

console.log(`\n${routes.length} page(s) audited. Lowest score across all of them: ${worst}`);

/*
  ⚠️ The job detail page is deliberately audited at its "found" state. Its
  not-found state carries `noindex` by design (SeoService.setNoIndex), and
  Lighthouse scores a noindex page 0 for SEO — correctly, and for a page we are
  deliberately keeping out of search results. Auditing it would mean asserting
  a 0, which is a different test than this one.
*/
if (worst < 100) {
  process.exitCode = 1;
}

await browser.close();
