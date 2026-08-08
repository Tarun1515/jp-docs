import { chromium } from 'playwright';
import lighthouse from 'lighthouse';

const ROUTES = ['/', '/how-it-works', '/about', '/faq', '/contact', '/terms', '/privacy'];
const PORT = 9222;

const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
let worst = 100;

for (const route of ROUTES) {
  const result = await lighthouse(
    `http://localhost:4500${route}`,
    { port: PORT, output: 'json', logLevel: 'error' },
    { extends: 'lighthouse:default', settings: { onlyCategories: ['seo', 'accessibility'] } },
  );

  const seo = Math.round(result.lhr.categories.seo.score * 100);
  const a11y = Math.round(result.lhr.categories.accessibility.score * 100);
  worst = Math.min(worst, seo, a11y);

  const failed = Object.values(result.lhr.audits)
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
    .map((a) => a.id);

  console.log(`${route.padEnd(15)} SEO ${seo}   a11y ${a11y}${failed.length ? '   failing: ' + failed.join(', ') : ''}`);
}

console.log(`\nlowest score across all pages: ${worst}`);
await browser.close();
