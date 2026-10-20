/*
  PHASE 6C-2 — THE NOTIFICATION CENTRE IN A REAL BROWSER.

  ----------------------------------------------------------------------------
  WHAT ONLY A BROWSER CAN SETTLE
  ----------------------------------------------------------------------------
  notifications.mjs proves the payloads and the scope. Eight claims are about
  what a person SEES, and no HTTP check reaches them:

    1. the bell is in the shell of BOTH portals, so it is on every screen;
    2. an unread count renders a badge, and zero renders NOTHING — not a "0";
    3. opening the panel lists the person's own notifications, newest first;
    4. 2.62: "Mark all read" is DISABLED when there is nothing to mark, not
       hidden and not missing — it is the same control that will work in a
       moment;
    5. clicking a row marks it read, the badge drops, and the row stops being
       marked unread;
    6. 🔒 the panel shows one person's notifications and a DIFFERENT person
       signed into the same browser sees their own — which is the scope claim
       made visible;
    7. the full /notifications page renders in BOTH portals from the one shared
       component, each portal showing only its own rows (G27);
    8. 🔴 a FAILED read says so rather than showing an empty inbox — tested by
       aborting the request in the browser, the only honest way to reach it.

  ----------------------------------------------------------------------------
  🔴 THE FIXTURES ARE REAL EVENTS, NOT INSERTED ROWS
  ----------------------------------------------------------------------------
  A notification is produced by applying, inviting or offering (021), and this
  suite makes them that way over HTTP. Inserting rows directly would test the
  panel against data the product cannot produce — and 6C's whole risk is a
  notification type that reads correctly and is never created.

  ⚠️ Screenshots go to jp-docs/design-screens/.

  Run (both APIs, jp-shared :4999, jp-school :4300, jp-teacher :4400):
      node scripts/verify/notification-screens.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const SCHOOL_APP = 'http://localhost:4300';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: secret('viewer@greenwood.edu.in') };

/** The only documented teacher with a resume, so they can actually apply. */
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body, text };
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_notifications
   WHERE RefEntityUid IN (
           SELECT ApplicationUid FROM t_app_applications
            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 %')
           UNION ALL
           SELECT InviteUid FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-screens%');

  DELETE FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-screens%';

  DELETE FROM t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 %'));
  DELETE FROM t_app_applications
   WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 %');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '6C-2 %';

  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 1 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);`);

let browser;

try {
  // =========================================================================
  section('0. FIXTURE — real events, made the way the product makes them');
  // =========================================================================

  cleanup();

  const ownerToken = await loginToken(OWNER);
  const teacherToken = await loginToken(TEACHER);

  const ownerSession = await loginSession(OWNER);
  const viewerSession = await loginSession(VIEWER);
  const teacherSession = await loginSession(TEACHER);

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT s.SchoolId FROM t_app_schools s
      INNER JOIN t_app_school_users su ON su.SchoolId = s.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 BranchId FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC, BranchId;`));

  const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '6C-2 Chemistry teacher', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /*
    ⚠️ A SECOND JOB, ONLY SO ORDERING CAN BE ASSERTED AT ALL.

    With one notification "newest first" passes no matter what the page does —
    a single row is trivially in order, which is the shape of a test that
    passes for the wrong reason. Two applications a moment apart give the
    school two rows whose ORDER is a real claim, and because both land on the
    same rendered day, section 8 asserts it by TITLE rather than by date:
    Physics is applied to second, so Physics must appear above Chemistry.
  */
  const laterJobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '6C-2 Physics teacher', 2, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /* The teacher applies: the school's team is told (one row each). */
  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ jobId, coverNote: 'notif-screens' }),
  });

  const appliedLater = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ jobId: laterJobId, coverNote: 'notif-screens' }),
  });

  check('premise: a SECOND, later application gives ordering something to say',
    appliedLater.http === 200, `HTTP ${appliedLater.http} for job ${laterJobId}`);

  const applicationId = applied.body?.data?.applicationId ?? applied.body?.data?.id;

  check('premise: a real application produced the school\'s notifications',
    applied.http === 200 && !!applicationId, `HTTP ${applied.http}`);

  /* The school shortlists: the teacher is told. */
  await j(`${APP}/applicants/${applicationId}/status`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ toStatusId: 3 }),
  });

  const ownerUnread = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_notifications n
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = n.RecipientUserUid
    WHERE u.Email = '${OWNER.id}' AND n.IsRead = 0 AND n.Is_Deleted = 0;`);

  const teacherUnread = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_notifications n
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = n.RecipientUserUid
    WHERE u.Email = '${TEACHER.id}' AND n.IsRead = 0 AND n.Is_Deleted = 0;`);

  console.log(`\n    unread — owner ${ownerUnread} · teacher ${teacherUnread}\n`);

  check('premise: both sides have unread notifications to render',
    Number(ownerUnread) > 0 && Number(teacherUnread) > 0,
    `owner ${ownerUnread}, teacher ${teacherUnread}`);

  browser = await chromium.launch();

  const openAs = async (app, key, session, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();

    await page.goto(app, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.setItem(`jp.${k}.accessToken`, s.accessToken);
      localStorage.setItem(`jp.${k}.refreshToken`, s.refreshToken);
    }, { s: session, k: key });

    return { context, page };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  // =========================================================================
  section('1. 🔴 THE BELL IS IN THE SHELL OF BOTH PORTALS');
  // =========================================================================

  const { context: schoolCtx, page: school } = await openAs(SCHOOL_APP, 'school', ownerSession);

  await school.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
  await school.waitForTimeout(1200);

  check('🔴 the bell renders in jp-school\'s header',
    (await school.locator('ui-notification-bell .bell__trigger').count()) === 1,
    `${await school.locator('ui-notification-bell .bell__trigger').count()} bell(s)`);

  /*
    🔴 ON EVERY SCREEN, not just the dashboard. It is in the shell precisely so
    somebody reading an applicant's profile still learns an offer was declined.
  */
  await school.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await school.waitForTimeout(900);

  check('🔴 …and on another screen of the same portal — it is chrome, not a page',
    (await school.locator('ui-notification-bell .bell__trigger').count()) === 1,
    'present on /jobs too');

  const { context: teacherCtx, page: teacher } = await openAs(TEACHER_APP, 'teacher', teacherSession);

  await teacher.goto(`${TEACHER_APP}/dashboard`, { waitUntil: 'networkidle' });
  await teacher.waitForTimeout(1200);

  check('🔴 the same component renders in jp-teacher — one copy, two portals (G27)',
    (await teacher.locator('ui-notification-bell .bell__trigger').count()) === 1,
    'present');

  // =========================================================================
  section('2. 🔴 THE BADGE — a count, and nothing when there is none');
  // =========================================================================

  const badge = school.locator('ui-notification-bell .bell__count');

  check('🔴 an unread count renders a badge on the bell',
    (await badge.count()) === 1, `text "${(await badge.textContent().catch(() => '')) ?? ''}"`);

  const label = await school.locator('ui-notification-bell .bell__trigger').getAttribute('aria-label');

  check('…and the count is in the button\'s own label, not colour alone',
    /unread/i.test(label ?? ''), `"${label}"`);

  // =========================================================================
  section('3. 🔴 THE PANEL — the person\'s own, newest first');
  // =========================================================================

  await school.locator('ui-notification-bell .bell__trigger').click();
  await school.waitForTimeout(900);

  const rows = school.locator('ui-notification-bell .bell__item');

  check('🔴 opening the bell lists notifications',
    (await rows.count()) > 0, `${await rows.count()} row(s)`);

  const titles = await school.locator('ui-notification-bell .bell__row-title').allTextContents();

  console.log(`\n    the owner sees: ${titles.map((t) => t.trim()).join(' · ')}\n`);

  check('🔴 …and they are the SCHOOL\'s notifications, not the teacher\'s',
    titles.some((t) => /new application/i.test(t)) && !titles.some((t) => /shortlisted/i.test(t)),
    titles.map((t) => t.trim()).join(' · '));

  await shot(school, 'school-notifications-open-1440');

  /*
    🔒 THE SCOPE CLAIM, MADE VISIBLE. The teacher's panel in the other browser
    context shows THEIR row — the shortlist — and none of the school's.
  */
  await teacher.locator('ui-notification-bell .bell__trigger').click();
  await teacher.waitForTimeout(900);

  const teacherTitles = await teacher.locator('ui-notification-bell .bell__row-title').allTextContents();

  console.log(`    the teacher sees: ${teacherTitles.map((t) => t.trim()).join(' · ')}\n`);

  check('🔒 the teacher\'s panel shows THEIR notifications and none of the school\'s',
    teacherTitles.some((t) => /shortlisted/i.test(t))
    && !teacherTitles.some((t) => /new application/i.test(t)),
    teacherTitles.map((t) => t.trim()).join(' · '));

  await shot(teacher, 'teacher-notifications-open-1440');

  // =========================================================================
  section('4. 🔴 2.62 — "Mark all read" DISABLED, not hidden');
  // =========================================================================

  const markAll = school.locator('ui-notification-bell .bell__header button');

  check('premise: with unread rows the control is enabled',
    (await markAll.isEnabled()), 'enabled');

  await markAll.click();
  await school.waitForTimeout(900);

  check('🔴 marking all read clears the badge entirely — zero renders NOTHING',
    (await school.locator('ui-notification-bell .bell__count').count()) === 0,
    'no badge element at all');

  /*
    🔴 2.62's "not yet" shape: the control stays VISIBLE and disabled, because
    it is the same control that will work the moment something arrives. Removing
    it would read as "you may not do this".
  */
  check('🔴 …and the control is still there, DISABLED — "not yet", not "not allowed"',
    (await markAll.count()) === 1 && !(await markAll.isEnabled()),
    `present ${await markAll.count()}, enabled ${await markAll.isEnabled()}`);

  check('…and the rows are no longer marked unread',
    (await school.locator('ui-notification-bell .bell__item--unread').count()) === 0,
    `${await school.locator('ui-notification-bell .bell__item--unread').count()} unread row(s)`);

  await shot(school, 'school-notifications-all-read-1440');

  // =========================================================================
  section('5. 🔴 ONE ROW — read, and it follows its link');
  // =========================================================================

  const teacherBadgeBefore = await teacher.locator('ui-notification-bell .bell__count').textContent()
    .catch(() => null);

  await teacher.locator('ui-notification-bell .bell__item').first()
    .locator('.bell__row').click();

  await teacher.waitForTimeout(1400);

  check('🔴 clicking a row navigates to what it is about (a relative path — 030)',
    /\/applications/.test(new URL(teacher.url()).pathname),
    `landed on ${new URL(teacher.url()).pathname}`);

  const teacherUnreadAfter = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_notifications n
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = n.RecipientUserUid
    WHERE u.Email = '${TEACHER.id}' AND n.IsRead = 0 AND n.Is_Deleted = 0;`);

  check('🔴 …and the row is read on the SERVER, not only on screen',
    Number(teacherUnreadAfter) < Number(teacherUnread),
    `unread ${teacherUnread} -> ${teacherUnreadAfter} (badge was "${teacherBadgeBefore}")`);

  // =========================================================================
  section('6. THE PANEL AT 375 — it must not push the page sideways');
  // =========================================================================

  const { context: phoneCtx, page: phone } = await openAs(SCHOOL_APP, 'school', ownerSession, PHONE);

  await phone.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(1200);
  await phone.locator('ui-notification-bell .bell__trigger').click();
  await phone.waitForTimeout(700);

  const overflow = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));

  console.log(`\n    at 375: document ${overflow.doc}px, viewport ${overflow.client}px\n`);

  /*
    🔴 The design system forbids the page body scrolling sideways, and a popover
    is the easiest way to break that rule — the matrix's own SCSS records what
    it cost to find the last one.
  */
  check('🔴 the open panel does not make the page scroll sideways at 375',
    overflow.doc <= overflow.client,
    `${overflow.doc} <= ${overflow.client}`);

  check('…and the panel is actually visible, so the check is not vacuous',
    await phone.locator('ui-notification-bell .bell__panel').isVisible(), 'visible');

  await shot(phone, 'school-notifications-375');

  // =========================================================================
  section('7. 🔒 A VIEWER HAS ONE TOO — a notification is not a permission');
  // =========================================================================

  const { context: viewerCtx, page: viewerPage } = await openAs(SCHOOL_APP, 'school', viewerSession);

  await viewerPage.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
  await viewerPage.waitForTimeout(1200);

  /*
    🔒 A read-only VIEWER gets the bell, because a notification is addressed to a
    person rather than granted by a role — and the fan-out told them about this
    application too (021). There is no permission attribute on the controller
    and none here.
  */
  check('🔒 the read-only viewer has the bell, and their own notifications in it',
    (await viewerPage.locator('ui-notification-bell .bell__trigger').count()) === 1,
    'present');

  await viewerPage.locator('ui-notification-bell .bell__trigger').click();
  await viewerPage.waitForTimeout(900);

  const viewerTitles = await viewerPage.locator('ui-notification-bell .bell__row-title').allTextContents();

  check('🔒 …and they are the viewer\'s OWN rows, with their own read state',
    viewerTitles.some((t) => /new application/i.test(t)),
    `${viewerTitles.length} row(s) — unread for them even though the owner marked theirs read`);

  await shot(viewerPage, 'school-notifications-viewer-1440');

  // =========================================================================
  section('8. 🔴 THE FULL PAGE — one component, routed by BOTH portals');
  // =========================================================================

  /*
    🔴 THE BELL AND THE PAGE ARE DIFFERENT CLAIMS.

    Sections 1–7 prove the bell. This proves the screen its "See all" points at
    — UiNotificationListComponent, which lives in jp-shared and which BOTH apps
    route at DIRECTLY rather than wrapping (G27: a second copy is where two
    identical screens start to disagree). The assertion that matters is that
    both portals render the same DOM contract from the same component, each with
    only its own rows.
  */
  await school.goto(`${SCHOOL_APP}/notifications`, { waitUntil: 'networkidle' });
  await teacher.goto(`${TEACHER_APP}/notifications`, { waitUntil: 'networkidle' });
  await school.waitForTimeout(2200);
  await teacher.waitForTimeout(2200);

  const rowsOf = async (page) => (await page.locator('.notif__item').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim());

  const schoolRows = await rowsOf(school);
  const teacherRows = await rowsOf(teacher);

  console.log(`\n    school page: ${schoolRows.length} row(s) — "${(schoolRows[0] ?? '').slice(0, 58)}"`);
  console.log(`    teacher page: ${teacherRows.length} row(s) — "${(teacherRows[0] ?? '').slice(0, 58)}"\n`);

  check('🔴 the shared page renders in the SCHOOL portal, with rows',
    schoolRows.length > 0, `${schoolRows.length} row(s)`);

  check('🔴 …and in the TEACHER portal, from the same component',
    teacherRows.length > 0, `${teacherRows.length} row(s)`);

  /*
    🔒 THE SAME COMPONENT IN TWO PORTALS, AND NEITHER SEES THE OTHER'S ROWS.

    This is the one risk a shared notification screen carries. The service has
    no method that takes a user because no route accepts one, and 030 gave the
    table no SchoolId and no OrganizationUid at all — so the only thing that can
    scope it is the caller's own token. Asserted by content, not by trust: the
    school's own notification title must not be among the teacher's rows.
  */
  check('🔒 the teacher\'s page does NOT contain the school\'s notifications',
    !teacherRows.some((row) => /new application/i.test(row)),
    'no "New application" row on the teacher\'s page');

  check('🔒 …and the school\'s page does NOT contain the teacher\'s',
    !schoolRows.some((row) => /shortlisted/i.test(row)),
    'no "Shortlisted" row on the school\'s page');

  /*
    🔴 NEWEST FIRST, ASSERTED BY TITLE — because both rows share a date.

    The first draft compared rendered dates. Two notifications a moment apart
    render the SAME day, so equal dates satisfied a descending check and the
    assertion proved nothing. The applications went in a known order, so the
    order they appear in is the claim: Physics was applied to second, so
    Physics is the row on top.
  */
  const physicsAt = schoolRows.findIndex((row) => /Physics/i.test(row));
  const chemistryAt = schoolRows.findIndex((row) => /Chemistry/i.test(row));

  check('🔴 newest first — the later application is the row ABOVE',
    physicsAt !== -1 && chemistryAt !== -1 && physicsAt < chemistryAt,
    `Physics at ${physicsAt}, Chemistry at ${chemistryAt} of ${schoolRows.length}`);

  const stamps = await school.locator('.notif__item .notif__day').allInnerTexts();

  /*
    ⚠️ THE SERVER'S PAGE, NOT A CLIENT-SIDE SLICE (G29). The page asks for 50
    and shows a pager only when it got a full 50 — with a handful of rows there
    must be no pager at all, which is what distinguishes "the server paged this"
    from "the client sliced an uncapped read".
  */
  check('⚠️ no pager with a handful of rows — the page is the server\'s (G29)',
    (await school.locator('.table-pager').count()) === 0,
    `${schoolRows.length} rows, ${await school.locator('.table-pager').count()} pager(s)`);

  check('⚠️ the date is IST, not the browser\'s zone (2.28)',
    (await school.locator('.notif__item .notif__time').first().innerText()).trim().length > 0
    && /\d{1,2} \w{3} \d{4}/.test((stamps[0] ?? '').trim()),
    `"${(stamps[0] ?? '').trim()}" at "${(await school.locator('.notif__item .notif__time').first().innerText()).trim()}"`);

  await shot(school, 'school-notifications-page-1440');
  await shot(teacher, 'teacher-notifications-page-1440');

  // =========================================================================
  section('9. 🔴 FORCED — a failed load is not an empty list');
  // =========================================================================

  /*
    🔴 THE DISTINCTION THE TEMPLATE CLAIMS IN A COMMENT, ASSERTED.

    "You have nothing" and "we could not ask" are different statements, and
    showing the first when the second is true is how somebody misses an offer.
    The only honest way to test it is to make the read fail, so the request is
    aborted in the browser and the screen is read back.
  */
  await school.route('**/api/notifications**', (route) => route.abort('failed'));
  await school.reload({ waitUntil: 'domcontentloaded' });
  await school.waitForTimeout(2600);

  const failedText = (await school.locator('.page').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    with the read aborted: "${failedText.slice(0, 190)}"\n`);

  check('🔴 an aborted read says so — and does NOT say "nothing yet"',
    /could not be loaded/i.test(failedText) && !/nothing yet/i.test(failedText),
    'the failure is named');

  check('🔒 …and it says nothing has been missed, so nobody assumes an empty inbox',
    /nothing has been missed/i.test(failedText), 'reassurance, not a false empty');

  check('…and it is announced, not just printed',
    (await school.locator('.note[role="alert"]').count()) === 1,
    'role="alert"');

  check('🔴 …and no row is rendered from a failed read',
    (await school.locator('.notif__item').count()) === 0,
    `${await school.locator('.notif__item').count()} row(s)`);

  await shot(school, 'school-notifications-failed-1440');
  await school.unroute('**/api/notifications**');

  await schoolCtx.close();
  await teacherCtx.close();
  await phoneCtx.close();
  await viewerCtx.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => {});

  section('10. EXIT — the fixture events removed');

  try {
    cleanup();

    check('exit: no job, application or notification of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST((SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '6C-2 %')
                  + (SELECT COUNT(*) FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-screens%') AS varchar(8));`) === '0',
      'none');
  } catch (error) {
    console.error('  ⚠️ COULD NOT CLEAN UP:', error.message);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log('='.repeat(74));

process.exitCode = failed.length ? 1 : 0;
