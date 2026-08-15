/*
  PHASE 3I — the dashboards in a real browser, and the mockup's absence.

  ----------------------------------------------------------------------------
  WHAT ONLY A BROWSER CAN SETTLE
  ----------------------------------------------------------------------------
  dashboards-3i.mjs proves the payloads. Three claims are about what a person
  sees, and no HTTP check reaches them:

    - the Jobs and Applicants areas show a DISABLED action and a "when", rather
      than a count or a zero;
    - a teacher at 0% is never shown "0%" — the dashboard reuses the meter and
      inherits that rule (2.60);
    - /applicants no longer resolves to the old screen.

  Screenshots go to jp-docs/design-screens/, replacing the two that showed the
  fixture-driven dashboard.

  Run (both APIs, jp-shared :4999, jp-school :4300, jp-teacher :4400):
      node scripts/verify/screens-3i.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SSO = 'http://localhost:5199/api';
const SCHOOL_APP = 'http://localhost:4300';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const SCHOOL = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const TEACHER_EMPTY = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };
const TEACHER_FULL = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  try { return { http: r.status, body: await r.json() }; } catch { return { http: r.status, body: null }; }
};

const login = async (loginId, password, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });

  if (r.http === 429 && attempt <= 4) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(loginId, password, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message}`);

  return r.body.data;
};

const browser = await chromium.launch();

/** Seeds the session the way each app stores it: `jp.<key>.accessToken`. */
const openAs = async (app, storageKey, account, viewport) => {
  const session = await login(account.id, account.pw);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(app, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ s, key }) => {
    localStorage.setItem(`jp.${key}.accessToken`, s.accessToken);
    localStorage.setItem(`jp.${key}.refreshToken`, s.refreshToken);
  }, { s: session, key: storageKey });

  return { context, page };
};

const shot = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. THE SCHOOL DASHBOARD ===');

let { context, page } = await openAs(SCHOOL_APP, 'school', SCHOOL, WIDE);
await page.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const heading = await page.locator('.page__title').textContent();
check('it opens on the school\'s own name, fetched', !!heading?.trim(), heading?.trim());

const tiles = await page.locator('.tile__label').allTextContents();
check('the three tiles are campus, plan and team',
  tiles.length === 3, tiles.map((t) => t.trim()).join(' · '));

/*
  🔴 THE CHECK THIS PHASE EXISTS FOR.

  The old screen showed "50 applicants", a funnel and open-job counts, none of
  which had a table behind them. If a digit appears in either not-yet area, the
  mockup has grown back.
*/
const emptyAreas = page.locator('ui-empty-state');
check('Jobs and Applicants render as empty states', (await emptyAreas.count()) === 2,
  `${await emptyAreas.count()} areas`);

const emptyText = await emptyAreas.allTextContents();
const hasDigits = emptyText.some((text) => /\d/.test(text));

check('🔴 …with NO number in them — not even a zero',
  !hasDigits, hasDigits ? `found digits: ${emptyText.join(' | ')}` : 'no counts, no zeros');

const disabledActions = await page.locator('ui-empty-state button[disabled]').count();
check('…and their actions are disabled, showing where the feature will be',
  disabledActions === 2, `${disabledActions} disabled buttons`);

const notes = await page.locator('.empty__note').allTextContents();
check('…each with one line about when it arrives',
  notes.length === 2, notes.map((n) => n.trim()).join(' · '));

await shot(page, 'school-dashboard-1440');
await context.close();

({ context, page } = await openAs(SCHOOL_APP, 'school', SCHOOL, PHONE));
await page.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const schoolOverflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

check('🔴 no sideways scroll at 375', schoolOverflow === 0, `${schoolOverflow}px`);
await shot(page, 'school-dashboard-375');

// ---------------------------------------------------------------------------
console.log('\n=== 2. 🔴 /applicants NO LONGER RESOLVES ===');

await page.setViewportSize(WIDE);
await page.goto(`${SCHOOL_APP}/applicants`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// The old screen's fingerprints: its heading, and any fixture name.
const showsOldScreen = /Applicants\b.*Everyone who has applied/i.test(bodyText) ||
  /Aarti Deshpande|Rajesh Kulkarni/.test(bodyText);

check('🔴 the old mockup does NOT render', !showsOldScreen,
  showsOldScreen ? 'THE MOCKUP IS STILL REACHABLE' : 'no fixture rows, no old heading');

const isNotFound = /not found|404|page you/i.test(bodyText);
check('…the app shows its not-found page instead', isNotFound,
  bodyText.slice(0, 120).trim());

console.log(`    DOM says: "${bodyText.slice(0, 160).trim()}…"`);

const navPaths = await page.locator('nav a').evaluateAll((links) =>
  links.map((l) => l.getAttribute('href')));

check('…and no sidebar entry points at it',
  !navPaths.some((p) => p?.includes('applicants')),
  navPaths.filter(Boolean).join(' '));

await shot(page, 'applicants-route-removed-1440');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 3. THE TEACHER DASHBOARD — A FULL PROFILE ===');

({ context, page } = await openAs(TEACHER_APP, 'teacher', TEACHER_FULL, WIDE));
await page.goto(`${TEACHER_APP}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

check('the meter is the one from the profile screen, not a copy',
  (await page.locator('app-profile-meter').count()) === 1,
  `${await page.locator('app-profile-meter').count()} meter component`);

const percentShown = await page.locator('.meter__percent').textContent();
check('a mostly-complete profile shows its percentage', /\d+%/.test(percentShown ?? ''),
  percentShown?.trim());

const teacherEmpty = await page.locator('ui-empty-state').count();
const teacherEmptyText = await page.locator('ui-empty-state').allTextContents();

check('Jobs and applications are empty states with no numbers',
  teacherEmpty === 2 && !teacherEmptyText.some((t) => /\d/.test(t)),
  `${teacherEmpty} areas, no counts`);

await shot(page, 'teacher-dashboard-1440');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 4. 🔴 THE TEACHER AT 0% ===');

({ context, page } = await openAs(TEACHER_APP, 'teacher', TEACHER_EMPTY, WIDE));
await page.goto(`${TEACHER_APP}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const meterTitle = await page.locator('.meter__title').textContent();
const percentCount = await page.locator('.meter__percent').count();

check('🔴 a dashboard at 0% never prints "0%"',
  percentCount === 0 && !/0\s*%/.test(meterTitle ?? ''),
  `headline "${meterTitle?.trim()}", percentage elements: ${percentCount}`);

const nextTitle = await page.locator('.meter__next-title').textContent();
check('…it names one thing to do instead',
  /subject/i.test(nextTitle ?? ''), nextTitle?.replace(/\s+/g, ' ').trim());

await shot(page, 'teacher-dashboard-zero-1440');

await page.setViewportSize(PHONE);
await page.goto(`${TEACHER_APP}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const teacherOverflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

check('🔴 no sideways scroll at 375', teacherOverflow === 0, `${teacherOverflow}px`);
await shot(page, 'teacher-dashboard-375');

await context.close();
await browser.close();

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`  Screenshots: ${OUT}`);
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
