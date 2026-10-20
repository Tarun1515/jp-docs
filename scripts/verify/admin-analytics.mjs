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
    🔴 THE REASON FIELD IS ON EVERY TRANSITION NOW — G45 CLOSED IN 8A.

    This block used to say the opposite, and it was right at the time: a
    suspension's remark went to t_sso_user_lockouts and an approve's was
    accepted and discarded, so the screen asked on one and said so on the
    other. 8A added t_sso_user_status_history — append-only, every transition,
    with the administrator and the instant — so the field belongs everywhere
    and the panel shows what was recorded before.
  */
  /*
    🔴 THE SIGNED-IN ADMINISTRATOR'S OWN ROW OFFERS NO SUSPEND.

    ⚠️ WHEN THIS WAS WRITTEN IT WAS THE ONLY DEFENCE, AND IT IS NOT ANY MORE.
    8-0 found that nothing on the server stopped an administrator suspending
    themselves or the last active administrator, so the screen declined to
    offer it and this comment said plainly that hiding a button is
    presentation, not protection. 8A closed G46 in USP_UpdateUserStatus — both
    refusals, forced three ways in security-pass.mjs section 7b, including the
    middle case that proves the guard is not simply refusing everything.

    So this assertion is now what it should have been from the start: the
    screen agreeing with a server that already refuses. It stays because a row
    with no actions and no explanation reads as a bug, and because the day
    somebody re-adds the button, the refusal the user sees should not be the
    first they hear of it.
  */
  const meRow = usr.locator('.table tbody tr', { hasText: SUPER });

  check('premise: the signed-in administrator is on this page',
    await meRow.count() === 1, SUPER);

  const meText = (await meRow.innerText()).replace(/\s+/g, ' ');

  check('🔴 …and their own row is labelled "you"',
    /\byou\b/i.test(meText), meText.slice(0, 90));

  check('🔒 …and offers NO suspend action on themselves (G46)',
    await meRow.locator('.btn--danger').count() === 0,
    'the server refuses it too since 8A — see security-pass.mjs 7b');

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

    /*
      ⚠️ AND IT NO LONGER OVERSTATES WHAT A SUSPENSION DOES — G48.

      The panel used to say the account's sessions end. Measured in 8A, they do
      not: suspension revokes refresh tokens, so no new token can be obtained,
      but an access token already in a browser works until it expires — up to
      an hour. The copy says so, and this assertion exists so that it keeps
      saying so.
    */
    check('⚠️ G48: …and it does not pretend the open session ends',
      /keep working for up to/i.test(panel),
      panel.includes('keep working for up to')
        ? 'the hour-wide window is on the screen'
        : 'THE SCREEN IMPLIES THE SESSION ENDS — it does not (G48)');

    await usr.locator('.usr__panel .btn--ghost').click();
    await usr.waitForTimeout(400);
  } else {
    check('premise: an active account exists to suspend',
      false, 'no suspendable row — the assertions above did not run');
  }

  /*
    =======================================================================
    🔴 G45 — THE REASON ON A TRANSITION THAT USED TO DISCARD IT, AND THE
    HISTORY THAT NOW HOLDS IT
    =======================================================================

    Two things are checked, on a disposable account so nothing real is
    touched:

      the FIELD   appears on a reactivate, which before 8A showed "this change
                  is saved without a note";

      the TRAIL   renders a recorded change — the move, the administrator and
                  the reason text — read back through the API the screen uses,
                  not injected into the DOM.

    ⚠️ THE HISTORY ROW IS WRITTEN BY THE REAL PROCEDURE, not inserted
    directly. An INSERT would prove the screen can render a row; running
    USP_UpdateUserStatus proves the row exists at all, which is the half of
    G45 that was missing.
  */
  const G45_EMAIL = 'g45.screen@yopmail.com';

  const dropG45 = () => sql(`SET NOCOUNT ON; USE jp_sso;
    DECLARE @id bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${G45_EMAIL}');
    DELETE FROM t_sso_user_status_history WHERE UserId = @id;
    DELETE FROM t_sso_user_lockouts WHERE UserId = @id;
    DELETE FROM t_sso_user_tokens WHERE UserId = @id;
    DELETE FROM t_sso_user_roles WHERE UserId = @id;
    DELETE FROM t_sso_users WHERE UserId = @id;`);

  const G45_REASON = 'Board affiliation certificate names a different address.';

  try {
    dropG45();

    sql(`SET NOCOUNT ON; USE jp_sso;
      INSERT INTO t_sso_users (UserTypeId, StatusId, Email, IsEmailVerified, IsMobileVerified)
      VALUES (2, 1, '${G45_EMAIL}', 1, 0);`);

    const g45Uid = scalar(`SET NOCOUNT ON; USE jp_sso;
      SELECT LOWER(CAST(UserUid AS varchar(50))) FROM t_sso_users WHERE Email = '${G45_EMAIL}';`);

    const g45Rv = scalar(`SET NOCOUNT ON; USE jp_sso;
      SELECT CAST([RowVersion] AS varchar(10)) FROM t_sso_users WHERE Email = '${G45_EMAIL}';`);

    /* A real rejection, through the procedure, with a reason. */
    const moved = sql(`SET NOCOUNT ON; USE jp_sso;
      DECLARE @actor bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${SUPER}');
      EXEC USP_UpdateUserStatus @UserUid = '${g45Uid}', @NewStatusId = 3,
           @RowVersion = ${g45Rv}, @ActionByUserId = @actor,
           @Remarks = N'${G45_REASON}';`).find((l) => /^\d\|/.test(l)) ?? '';

    check('premise: a rejection with a reason was recorded by the procedure',
      /^1\|/.test(moved), moved.slice(0, 60));

    const stored = scalar(`SET NOCOUNT ON; USE jp_sso;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_sso_user_status_history h
        JOIN t_sso_users u ON u.UserId = h.UserId
       WHERE u.Email = '${G45_EMAIL}' AND h.Reason IS NOT NULL;`);

    check('🔴 G45: the reason is in the history table, not discarded',
      stored === '1', `${stored} row(s) with a reason`);

    /* Now the screen: search for it, open Reactivate, read the panel. */
    /*
      ⚠️ ENTER IS REQUIRED, AND THE SCREEN IS RIGHT ABOUT THAT. The search box
      reloads on (keyup.enter) and (search) only — no debounce, no request per
      keystroke. Filling the box and waiting found nothing, and the first read
      of that was "the account is not on the screen" rather than "the test
      never asked for it".
    */
    await usr.fill('#usr-search', G45_EMAIL);
    await usr.press('#usr-search', 'Enter');
    await usr.waitForTimeout(1500);

    const g45Row = usr.locator('.table tbody tr', { hasText: G45_EMAIL });

    check('premise: the account is findable on the screen',
      await g45Row.count() === 1, G45_EMAIL);

    if (await g45Row.count() === 1) {
      /*
        ⚠️ BY NAME, NOT .first(). A rejected account shows Reactivate, but
        "the first button in the row" is a locator that still passes if the
        row grows a different action first — and then this block would be
        asserting G45 against whatever panel happened to open.
      */
      const reactivate = g45Row.first().getByRole('button', { name: /Reactivate/i });

      check('premise: the rejected account offers Reactivate',
        await reactivate.count() === 1, `${await reactivate.count()} matching button(s)`);

      await reactivate.click();
      await usr.locator('.usr__panel').waitFor({ timeout: 8000 });
      await usr.waitForTimeout(700);

      const g45Panel = (await usr.locator('.usr__panel').innerText()).replace(/\s+/g, ' ');

      check('🔴 G45: the reason field is offered on a NON-suspend transition',
        await usr.locator('#usr-remarks').count() === 1,
        `panel: ${usr.url().includes('/users') ? 'accounts' : '?'} — before 8A this said "saved without a note"`);

      check('🔴 …and the old "only a suspension records a reason" copy is gone',
        !/only a suspension records a reason/i.test(g45Panel),
        g45Panel.slice(0, 90));

      check('🔴 G45: the panel shows what was recorded before',
        /Previously/i.test(g45Panel), g45Panel.slice(0, 120));

      check('🔴 …including the reason text itself, read back through the API',
        g45Panel.includes(G45_REASON),
        g45Panel.includes(G45_REASON) ? G45_REASON : g45Panel.slice(0, 160));

      check('🔴 …and who did it, which is the question the trail answers',
        g45Panel.includes(SUPER), g45Panel.slice(0, 160));

      check('🔴 …and the move, named on both sides',
        /Pending approval/i.test(g45Panel) && /Rejected/i.test(g45Panel),
        g45Panel.slice(0, 160));
    }
  } finally {
    dropG45();

    check('exit: the G45 probe account and its history are gone',
      scalar(`SET NOCOUNT ON; USE jp_sso;
        SELECT CAST(COUNT(*) AS varchar(4)) FROM t_sso_users WHERE Email = '${G45_EMAIL}';`) === '0',
      'nothing left behind');
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
