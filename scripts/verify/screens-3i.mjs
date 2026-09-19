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

import { execFileSync } from 'node:child_process';

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

/*
  🔴 ADDED IN 5B, AND THE REASON IS THE POINT OF THE SECTION IT SERVES.

  This file used to assert "two empty states, no digits" as a FIXED shape. That
  was right while neither table existed — nothing could be there, so nothing
  could be counted. Both tables exist now, so the screen's shape depends on the
  DATA, and asserting a fixed shape would start passing for the wrong reason
  the day a school posts its first job.

  So the expectation is read from the database and compared against what the
  screen drew. That is the only version of this check that keeps meaning what
  3I meant by it: no number without a row behind it.
*/
const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001',
    '-h', '-1', '-W', '-s', '|', '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

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
  ------------------------------------------------------------------------------
  🔴 THE CHECK THIS PHASE EXISTED FOR, AND WHAT IT BECAME.
  ------------------------------------------------------------------------------
  The screen 3I replaced showed "50 applicants", a funnel and open-job counts,
  none of which had a table behind them (G6). So 3I asserted the opposite: two
  areas, NO digits in either — not even a zero — and a disabled action with a
  line saying when the feature arrives. A zero would have been a measurement of
  something unmeasurable.

  Both tables exist now: t_app_jobs (Phase 4) and t_app_applications (Phase 5).
  A zero is a real zero, so the "when it arrives" language is gone and the
  actions navigate somewhere real.

  ⚠️ WHAT THIS SECTION STILL GUARDS, and it is the same thing. 3I was protecting
  against NUMBERS WITH NOTHING BEHIND THEM. That danger has not gone away — it
  has moved. So the assertion now pairs the two: whatever this screen shows must
  be backed by rows in the database, and the promise-about-a-release copy must
  be gone. A tile showing "50" with an empty table still fails, exactly as it
  did in 3I.
*/
const emptyAreas = page.locator('ui-empty-state');
const emptyText = await emptyAreas.allTextContents();

const dbJobs = Number(sql(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_jobs j
    INNER JOIN t_app_school_users su ON su.SchoolId = j.SchoolId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
  WHERE u.Email = '${SCHOOL.id}' AND j.Is_Deleted = 0;`)[0] ?? '0');

const dbApplications = Number(sql(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_applications a
    INNER JOIN t_app_school_users su ON su.SchoolId = a.SchoolId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
  WHERE u.Email = '${SCHOOL.id}' AND a.Is_Deleted = 0;`)[0] ?? '0');

console.log(`    the database says: ${dbJobs} job(s), ${dbApplications} application(s)`);

/*
  🔴 THE TILES AND THE TABLES MUST AGREE.

  With nothing in either table both areas are empty states; with rows in one,
  that area shows counts instead. Asserting the SHAPE against the database is
  what makes this non-vacuous — a hardcoded "expect 2 empty states" would pass
  on a fixture-driven screen just as happily as on a real one.
*/
const expectedEmpties = (dbJobs === 0 ? 1 : 0) + (dbApplications === 0 ? 1 : 0);

check('🔴 each area is an empty state only when its TABLE is empty',
  (await emptyAreas.count()) === expectedEmpties,
  `${await emptyAreas.count()} empty area(s), expected ${expectedEmpties}`);

check('🔴 …and no empty area carries a number — a zero here still has to be absent',
  !emptyText.some((text) => /\d/.test(text)),
  emptyText.some((text) => /\d/.test(text)) ? `found digits: ${emptyText.join(' | ')}` : 'no counts, no zeros');

/*
  🔴 REVERSED IN 5B. 3I required two DISABLED actions, because "not yet" is a
  fact about the product and that is the one place a disabled control belongs
  (2.62). Both features exist now, so a disabled control would be a lie.
*/
const disabledActions = await page.locator('ui-empty-state button[disabled]').count();
check('🔴 no disabled placeholder action survives — both features are built (5B)',
  disabledActions === 0, `${disabledActions} disabled buttons`);

const notes = await page.locator('.empty__note').allTextContents();
check('🔴 …and no "arrives in a coming release" line is left on the screen',
  notes.length === 0, notes.map((n) => n.trim()).join(' · ') || 'none');

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
console.log('\n=== 2. 🔴 /applicants RESOLVES AGAIN — AND THE MOCKUP IS GONE ===');

/*
  ------------------------------------------------------------------------------
  🔴 3I ASSERTED THIS ROUTE WAS UNREACHABLE. 5B MADE IT REACHABLE AGAIN.
  ------------------------------------------------------------------------------
  The route was removed because the screen behind it was fifty rows of fixture
  data with no HTTP call — the most finished-looking fiction in the product
  (G6). 5B built the real screen against t_app_applications and restored both
  the route and the menu row.

  ⚠️ THE FIXTURE CHECK SURVIVES UNCHANGED, and it is the half that mattered.
  The names below came from `applicant.data.ts`; that file is DELETED, so if
  either ever appears on this page again, something has resurrected the mockup.
  A route that resolves is only good news if what it resolves to is real.
*/
await page.setViewportSize(WIDE);
await page.goto(`${SCHOOL_APP}/applicants`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// The old screen's fingerprints: any name out of the deleted fixture file.
const showsOldScreen = /Aarti Deshpande|Rajesh Kulkarni/.test(bodyText);

check('🔴 no fixture row from the deleted mockup appears', !showsOldScreen,
  showsOldScreen ? 'THE MOCKUP HAS GROWN BACK' : 'no fixture names');

const isNotFound = /not found|404|page you/i.test(bodyText);
check('🔴 …and the route no longer answers with the not-found page (5B)',
  !isNotFound, isNotFound ? bodyText.slice(0, 120).trim() : 'the real screen renders');

check('…it is the real screen, titled Applicants',
  /Applicants/.test(await page.locator('.page__title').textContent() ?? ''),
  (await page.locator('.page__title').textContent() ?? '').trim());

console.log(`    DOM says: "${bodyText.slice(0, 160).trim()}…"`);

const navPaths = await page.locator('nav a').evaluateAll((links) =>
  links.map((l) => l.getAttribute('href')));

check('🔴 …and the sidebar offers it again — menus are data (2.37)',
  navPaths.some((p) => p?.includes('applicants')),
  navPaths.filter(Boolean).join(' '));

await shot(page, 'applicants-route-restored-1440');
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
