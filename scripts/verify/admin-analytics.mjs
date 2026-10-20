/*
  PHASE 8-0 — PLATFORM ANALYTICS AND THE ACCOUNTS SCREEN.

  ----------------------------------------------------------------------------
    0. ENTRY       the three procedures exist; REPORT.VIEW's holder set
    1. 🔴 DERIVED  every figure matches a COUNT run independently, in SQL
    2. 🔒 THE GATE owner, Viewer and teacher all refused — and the Viewer
                   HOLDS REPORT.VIEW, which is what makes the refusal mean
                   something
    3. 🔒 BYTES    no email, uid, request number or name in the response
    4. 🔴 GUARDS   the three build guards are present in the three files
    5. SCREENS     analytics and accounts render, at 1440 and at 375

  ----------------------------------------------------------------------------
  🔴 WHY SECTION 1 RE-COUNTS EVERYTHING
  ----------------------------------------------------------------------------
  One phase ago the moderation queue projected t_app_jobs.ApplicationCount — a
  column the product forbids writing and forbids reading, permanently zero —
  and every advert reported "0 applied". It shipped; a screens suite caught it.

  An analytics screen is where that mistake is invisible: a wrong number looks
  exactly like a right one. So this suite computes the same figures with its
  own SQL and compares. If the procedure ever starts reading a counter, these
  assertions diverge.

  Run (both APIs, jp-shared :4999, jp-admin :4200):
      node scripts/verify/admin-analytics.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const ADMIN_APP = 'http://localhost:4200';
const OUT = 'D:/Projects/jp-docs/design-screens';
const BACKEND = 'D:/Projects/jp-backend';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

const SUPER = 'superadmin@teacherportal.local';
const OWNER = 'principal@greenwood.edu.in';
const VIEWER = 'viewer@greenwood.edu.in';
const TEACHER = 'rohit.kulkarni.86002@yopmail.com';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const who = async (email) => loginSession({ id: email, pw: secret(email) });

let browser;

try {
  // =========================================================================
  section('0. ENTRY — the three procedures, and who holds REPORT.VIEW');
  // =========================================================================

  const procs = sql(`SET NOCOUNT ON;
    SELECT 'app'  WHERE OBJECT_ID('jp_app.dbo.USP_GetAppAnalytics') IS NOT NULL
    UNION ALL SELECT 'sso' WHERE OBJECT_ID('jp_sso.dbo.USP_GetIdentityAnalytics') IS NOT NULL
    UNION ALL SELECT 'mdm' WHERE OBJECT_ID('jp_mdm.dbo.USP_GetApprovalAnalytics') IS NOT NULL;`);

  check('entry: one analytics procedure per database, all three deployed',
    procs.length === 3, procs.join(' · ') || 'MISSING');

  /*
    🔴 THE HOLDER SET IS THE POINT OF SECTION 2. REPORT.VIEW is held by school
    roles as well as admin ones — a school Viewer has it for its own reports —
    so the permission ALONE cannot gate a platform-wide read. The service also
    requires an admin user type, and section 2 forces that.
  */
  const holders = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT STRING_AGG(CAST(r.RoleCode AS nvarchar(40)), ', ') WITHIN GROUP (ORDER BY r.RoleCode)
      FROM t_sso_role_permissions rp
      INNER JOIN t_sso_roles r ON r.RoleId = rp.RoleId AND r.Is_Deleted = 0
      INNER JOIN t_sso_permissions p ON p.PermissionId = rp.PermissionId
     WHERE p.PermissionCode = 'REPORT.VIEW' AND rp.Is_Deleted = 0;`);

  console.log(`\n    REPORT.VIEW: ${holders}\n`);

  check('🔒 premise: REPORT.VIEW is NOT admin-only — school roles hold it too',
    holders.includes('SCHOOL_VIEWER') && holders.includes('SCHOOL_OWNER'),
    'so the user-type check is the real gate, and section 2 proves it');

  const superSession = await who(SUPER);
  const head = (s) => ({ authorization: `Bearer ${s.accessToken}` });

  const read = await fetch(`${APP}/admin/desk/analytics`, { headers: head(superSession) });
  const raw = await read.text();
  const body = JSON.parse(raw);
  const d = body.data;

  check('the analytics read answers an administrator',
    read.status === 200 && !!d, `HTTP ${read.status}`);

  // =========================================================================
  section('1. 🔴 DERIVED — every figure re-counted independently');
  // =========================================================================

  /*
    ⚠️ COUNTED HERE WITH THIS SUITE'S OWN SQL, not read back from the same
    procedure. Comparing a procedure against itself proves nothing; the whole
    risk is that the procedure's source is wrong.
  */
  const expect = (label, actual, query) => {
    const wanted = Number(scalar(query));

    check(`🔴 ${label} — counted, not stored`,
      Number(actual) === wanted,
      `screen ${actual} · independent count ${wanted}`);
  };

  expect('schools', d.appTotals.schools,
    `SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_schools WHERE Is_Deleted = 0;`);

  expect('teachers', d.appTotals.teachers,
    `SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_teachers WHERE Is_Deleted = 0;`);

  expect('accounts', d.identity.accounts,
    `SET NOCOUNT ON; USE jp_sso; SELECT COUNT(*) FROM t_sso_users WHERE Is_Deleted = 0;`);

  expect('open approval requests', d.approvalTotals.openRequests,
    `SET NOCOUNT ON; USE jp_mdm; SELECT COUNT(*) FROM t_mdm_approval_requests
      WHERE Is_Deleted = 0 AND StatusId IN (1, 4);`);

  expect('applications in total', d.applications.reduce((s, r) => s + r.total, 0),
    `SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications WHERE Is_Deleted = 0;`);

  /*
    🔴 AND THE ONE THAT WOULD HAVE CAUGHT 7B's BUG. A stale counter reads 0
    while rows exist; this asserts the screen's total equals the real count
    whatever that count happens to be — including when both are zero, which is
    why the premise below states which case this run exercised.
  */
  const liveJobs = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_jobs j
     WHERE j.Is_Deleted = 0
       AND dbo.fn_EffectiveJobStatusId(j.JobStatusId, j.LastDateToApply) = 2;`));

  const screenLive = d.jobs.find((j) => j.statusId === 2)?.total ?? -1;

  check('🔴 live adverts use the EFFECTIVE status (2.65), and match',
    screenLive === liveJobs, `screen ${screenLive} · independent count ${liveJobs}`);

  /*
    ⚠️ THE OLDEST WAIT IS THE NUMBER THIS SCREEN EXISTS FOR, so it is checked
    rather than displayed on trust. Computed from the IST date both sides.
  */
  const worst = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT ISNULL(MAX(DATEDIFF(day, CAST(DATEADD(MINUTE, 330, SubmittedOn) AS date), dbo.fn_IstToday())), 0)
      FROM t_mdm_approval_requests WHERE Is_Deleted = 0 AND StatusId IN (1, 4);`));

  const screenWorst = Math.max(0, ...d.waits.map((w) => w.oldestWaitingDays));

  console.log(`\n    oldest open request: screen ${screenWorst} days · independent ${worst} days\n`);

  check('🔴 the oldest open request\'s wait matches, in whole IST days',
    screenWorst === worst, `${screenWorst} vs ${worst}`);

  // =========================================================================
  section('2. 🔒 THE GATE — REPORT.VIEW is not enough, and that is forced');
  // =========================================================================

  for (const [label, email] of [['school owner', OWNER], ['school VIEWER', VIEWER], ['teacher', TEACHER]]) {
    const s = await who(email);
    const r = await fetch(`${APP}/admin/desk/analytics`, { headers: head(s) });
    const b = await r.json().catch(() => ({}));

    check(`🔒 a ${label} is refused platform analytics`,
      r.status === 403, `HTTP ${r.status} ${b.code ?? ''}`);
  }

  console.log('\n    ⚠️ the Viewer above HOLDS REPORT.VIEW — the admin user type is the gate\n');

  // =========================================================================
  section('3. 🔒 RAW BYTES — how many, never who');
  // =========================================================================

  /*
    🔒 THE RESPONSE IS READ AS TEXT, not walked as an object. A field nobody
    declared — added by a serialiser, a mapper or a later edit to a procedure —
    is exactly what an object walk would miss.
  */
  const seededEmail = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT TOP 1 Email FROM t_sso_users WHERE Is_Deleted = 0 ORDER BY UserId;`);

  const seededSchool = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 SchoolName FROM t_app_schools WHERE Is_Deleted = 0 ORDER BY SchoolId;`);

  check('🔒 no account email appears in the analytics bytes',
    !raw.includes(seededEmail), `looked for ${seededEmail}`);

  check('🔒 …nor any school name',
    !raw.includes(seededSchool), `looked for ${seededSchool}`);

  check('🔒 …nor a uid, a request number or a requestor',
    !/userUid|requestNo|requestorUserId|entityUid|teacherUid|schoolUid/i.test(raw),
    `${raw.length} bytes, counts and waits only`);

  // =========================================================================
  section('4. 🔴 THE THREE BUILD GUARDS ARE IN THE THREE FILES');
  // =========================================================================

  /*
    ⚠️ ASSERTED ON THE FILES, because a guard is a build-time thing and the
    database cannot be asked whether one exists. If somebody deletes a guard,
    the procedure still deploys and nothing fails — which is precisely why this
    reads the source.
  */
  const guards = [
    ['jp_app 027 — no denormalised counter',
      'database/jp_app/04_procedures/027_admin_analytics.sql', 'DENORMALISED COUNTER'],
    ['jp_sso 010 — no identity',
      'database/jp_sso/04_procedures/010_admin_analytics.sql', 'PROJECTS AN IDENTITY'],
    ['jp_mdm 011 — no request identity',
      'database/jp_mdm/04_procedures/011_admin_analytics.sql', 'PROJECTS A REQUEST IDENTITY'],
  ];

  for (const [label, file, needle] of guards) {
    const text = fs.readFileSync(path.join(BACKEND, file), 'utf8');

    check(`🔴 ${label}`,
      text.includes('RAISERROR') && text.includes(needle),
      text.includes(needle) ? 'guard present' : 'GUARD MISSING');
  }

  // =========================================================================
  section('5. SCREENS — analytics and accounts, at 1440 and 375');
  // =========================================================================

  browser = await chromium.launch();

  const openAs = async (session, url, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 150)}`));

    await page.goto(ADMIN_APP, { waitUntil: 'domcontentloaded' });
    await page.evaluate((s) => {
      localStorage.setItem('jp.admin.accessToken', s.accessToken);
      localStorage.setItem('jp.admin.refreshToken', s.refreshToken);
    }, session);

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    return { context, page, errors };
  };

  // ---- analytics ---------------------------------------------------------
  const { context: anCtx, page: an, errors: anErrors } =
    await openAs(superSession, `${ADMIN_APP}/reports`);

  await an.locator('.an__tile').first().waitFor({ timeout: 15_000 });

  const tiles = (await an.locator('.an__tile').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));

  console.log(`\n    tiles: ${tiles.join(' | ')}\n`);

  check('the analytics screen renders its tiles',
    tiles.length === 6, `${tiles.length} tile(s)`);

  check('🔴 …with the real school count in them, not a placeholder',
    tiles.some((t) => t.startsWith(String(d.appTotals.schools))),
    `expected a tile starting ${d.appTotals.schools}`);

  const funnelRows = await an.locator('.an__stage').count();

  check('🔴 the funnel keeps every stage, including the empty ones',
    funnelRows === d.applications.length,
    `${funnelRows} stage(s) rendered, ${d.applications.length} in the response`);

  if (d.waits.some((w) => w.stillOpen > 0)) {
    const queueText = (await an.locator('.an__queues').innerText()).replace(/\s+/g, ' ');

    check('🔴 …and the oldest wait is on the screen, not just in the response',
      queueText.includes(String(screenWorst)), queueText.slice(0, 110));
  }

  check('no console error on the analytics screen',
    anErrors.length === 0, anErrors.slice(0, 2).join(' | ') || 'clean');

  await an.waitForTimeout(400);
  await an.screenshot({ path: path.join(OUT, 'admin-analytics.png'), fullPage: true });
  await anCtx.close();

  // ---- accounts ----------------------------------------------------------
  const { context: usrCtx, page: usr, errors: usrErrors } =
    await openAs(superSession, `${ADMIN_APP}/users`);

  await usr.locator('.table tbody tr').first().waitFor({ timeout: 15_000 });

  const accountRows = await usr.locator('.table tbody tr').count();

  check('the accounts screen lists accounts',
    accountRows > 0, `${accountRows} row(s) on page 1`);

  /*
    🔴 THE REASON FIELD APPEARS WHERE THE REASON IS KEPT. A suspension's
    remark is written to t_sso_user_lockouts; on an approve or a reactivate the
    same parameter is accepted and discarded (G45). So the panel must ask on
    one and say so on the other — collecting a note the product throws away is
    the contact form's `role` field that 7A deleted.
  */
  /*
    🔴 THE SIGNED-IN ADMINISTRATOR'S OWN ROW OFFERS NO SUSPEND — G46's
    mitigation, asserted rather than assumed.

    Nothing on the server stops an administrator suspending themselves, and if
    they are the last SUPER_ADMIN nobody can administer the platform
    afterwards. The screen declines to offer it and labels the row "you",
    because a row with no actions and no explanation reads as a bug.

    ⚠️ THIS IS NOT THE FIX AND THE ASSERTION SAYS SO. Hiding a button is
    presentation; the server-side gate is G46, for 8A. What this guards is that
    the product stops handing somebody the foot-gun in the meantime — and it
    fails the day the row starts offering it again.
  */
  const meRow = usr.locator('.table tbody tr', { hasText: SUPER });

  check('premise: the signed-in administrator is on this page',
    await meRow.count() === 1, SUPER);

  const meText = (await meRow.innerText()).replace(/\s+/g, ' ');

  check('🔴 …and their own row is labelled "you"',
    /\byou\b/i.test(meText), meText.slice(0, 90));

  check('🔒 …and offers NO suspend action on themselves (G46 mitigation)',
    await meRow.locator('.btn--danger').count() === 0,
    'the server does not refuse this yet — the screen does not offer it');

  const suspendable = usr.locator('.table tbody tr').filter({ has: usr.locator('.btn--danger') });

  if (await suspendable.count() > 0) {
    await suspendable.first().locator('.btn--danger').click();
    await usr.locator('#usr-remarks').waitFor({ timeout: 8000 });

    const panel = (await usr.locator('.usr__panel').innerText()).replace(/\s+/g, ' ');
    const blocked = await usr.locator('.usr__panel .btn--danger').isDisabled();

    check('🔴 suspending asks for a reason, and the screen refuses without one',
      blocked === true, 'the reason is stored and shown against the account');

    check('…and it says the reason is kept, which is why it is required',
      /reason below is kept/i.test(panel), panel.slice(0, 100));

    await usr.locator('.usr__panel .btn--ghost').click();
    await usr.waitForTimeout(400);
  } else {
    check('premise: an active account exists to suspend',
      false, 'no suspendable row — the assertions above did not run');
  }

  check('no console error on the accounts screen',
    usrErrors.length === 0, usrErrors.slice(0, 2).join(' | ') || 'clean');

  await usr.waitForTimeout(400);
  await usr.screenshot({ path: path.join(OUT, 'admin-accounts.png'), fullPage: true });
  await usrCtx.close();

  // ---- 375 ---------------------------------------------------------------
  for (const [label, url, shot, proof] of [
    ['analytics', `${ADMIN_APP}/reports`, 'admin-analytics-375', '.an__tile'],
    ['accounts', `${ADMIN_APP}/users`, 'admin-accounts-375', '.table tbody tr'],
  ]) {
    const { context: phoneCtx, page: phone } = await openAs(superSession, url, PHONE);

    const over = await phone.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));

    const present = await phone.locator(proof).count();

    console.log(`    ${label} at 375: document ${over.doc}px, viewport ${over.client}px, `
      + `${present} × ${proof}`);

    check(`🔴 ${label} does not scroll the page sideways at 375`,
      over.doc <= over.client, `${over.doc} <= ${over.client}`);

    check(`…and ${label}'s widest content IS present, so it is not vacuous`,
      present > 0, `${present} × ${proof}`);

    await phone.waitForTimeout(300);
    await phone.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true });
    await phoneCtx.close();
  }
} catch (error) {
  check('the suite ran to completion', false, String(error).slice(0, 300));
} finally {
  if (browser) await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

  if (failed.length) {
    console.log(`\n  ${failed.length} FAILED:`);
    failed.forEach((f) => console.log(`    x ${f.name}${f.detail ? `  — ${f.detail}` : ''}`));
  }

  console.log('='.repeat(74));

  /* ⚠️ exitCode, not process.exit() — 8-0 learned why (2.85.7). */
  process.exitCode = failed.length ? 1 : 0;
}
