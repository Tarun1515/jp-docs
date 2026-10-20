/*
  PHASE 7B — THE ADMIN OPERATIONS DESK, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY       shipped state asserted — six routes, four menu rows, the
                   closed permission sets — then the fixtures
    1. MODERATION  the queue renders; the reported advert is FIRST; the
                   application count is on the row; "Reported only" narrows it
    2. 🔴 PULL     through the UI, by typing a reason and pressing the button:
                   banner -> row reads Pulled -> public 404 -> the application
                   row is byte-for-byte what it was
    3. 🔴 THE LOG  the panel shows the pull in the school's own words and names
                   no administrator anywhere in its rendered text
    4. REPORTS     the reporter is a uid FRAGMENT and a count; 🔒 no name, and
                   not even the full uid, in the rendered page; closing a
                   report without a note is refused BY THE SCREEN
    5. FEATURED    three groups from one date field; the window on a pulled job
                   SAYS it is doing nothing; then the job is restored
    6. FAQ         switch one off -> the public /faqs response drops it, raw
                   bytes; switch it back on -> it returns
    7. BLOCKS      the screen names the HOME_ prefix (G44 closed in 8-0), the
                   claim is checked against jp-public's source, and the key is
                   read-only once a block exists
                   once a block exists
    8. ENQUIRIES   waiting days, not a date; a note is required to resolve; the
                   reply is a mailto and nothing claims to send mail
    9. 🔒 THE MENU a MODERATION_ADMIN's sidebar: moderation and enquiries yes,
                   CMS absent ENTIRELY — no empty group heading — and typing
                   /cms/faqs gives the screen's FAILED note, never its empty one
   10. 375         six screens measured on the document, each with its own
                   non-vacuous proof
   11. EXIT        fixtures gone, shipped state restored

  ----------------------------------------------------------------------------
  🔴 WHY A SCREENS SUITE WHEN admin-desk.mjs IS GREEN
  ----------------------------------------------------------------------------
  admin-desk.mjs proves the HTTP layer: 403s, 404s, raw bytes, IST boundaries.
  None of that says a moderator can pull an advert — it says a POST can. This
  suite drives the buttons, and three of its assertions could only ever fail
  here: a reason field that does not tell the moderator the school reads it, a
  403 rendered as an empty queue, and a sidebar offering a screen whose every
  call is refused.

  ----------------------------------------------------------------------------
  ⚠️ NO DOUBLE QUOTES IN ANY SQL BELOW, COMMENTS INCLUDED
  ----------------------------------------------------------------------------
  sqlcmd -Q takes the whole batch as one argument; a double quote inside it
  ends the argument early. That has bitten this project repeatedly.

  Run (both APIs, jp-shared :4999, jp-admin :4200):
      node scripts/verify/admin-desk-screens.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession, invalidate } from './lib/login.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const ADMIN_APP = 'http://localhost:4200';
const OUT = 'D:/Projects/jp-docs/design-screens';
const ROUTES_FILE = 'D:/Projects/jp-admin/src/app/app.routes.ts';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

const SUPER = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

const stamp = `${Date.now()}`.slice(-7);
const MODERATOR = { id: `verify.scrnm.${stamp}@yopmail.com`, pw: SUPER.pw };

const PROBE = 'SCRNPROBE';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

/* Dates in IST, the way fn_IstToday computes them. */
const istDay = (offset = 0) => {
  const at = new Date();
  at.setDate(at.getDate() + offset);

  return at.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

const makeAdmin = (email, roleCode) => sql(`SET NOCOUNT ON; USE jp_sso;
  DECLARE @src bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${SUPER.id}');

  INSERT INTO t_sso_users (UserTypeId, StatusId, Email, IsEmailVerified, IsMobileVerified)
  VALUES (1, 2, '${email}', 1, 0);

  DECLARE @new bigint = SCOPE_IDENTITY();

  INSERT INTO t_sso_user_credentials (UserId, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, IsCurrent)
  SELECT @new, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, 1
    FROM t_sso_user_credentials WHERE UserId = @src AND IsCurrent = 1;

  INSERT INTO t_sso_user_roles (UserId, RoleId)
  SELECT @new, RoleId FROM t_sso_roles
   WHERE RoleCode = '${roleCode}' AND OrganizationUid IS NULL AND Is_Deleted = 0;

  SELECT CAST(@new AS varchar(20));`);

const dropAdmin = (email) => sql(`SET NOCOUNT ON; USE jp_sso;
  DECLARE @id bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${email}');

  DELETE FROM t_sso_user_roles WHERE UserId = @id;
  DELETE FROM t_sso_user_credentials WHERE UserId = @id;
  DELETE FROM t_sso_user_tokens WHERE UserId = @id;
  DELETE FROM t_sso_user_login_attempts WHERE UserId = @id;
  DELETE FROM t_sso_users WHERE UserId = @id;`);

/*
  🔴 RESTORES TO THE DOCUMENTED SHIPPED STATE, NOT TO WHAT IT FOUND.

  A run that dies before teardown leaves fixtures behind, and capturing the
  state on entry would faithfully preserve the mess. Shipped state for 7B is:
  no SCRNPROBE anything, and the 12 seeded FAQs all active.
*/
const cleanup = () => {
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_featured_jobs WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    DELETE FROM t_app_job_moderation_log WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    DELETE FROM t_app_reports WHERE Description LIKE N'${PROBE}%';
    DELETE FROM t_app_applications WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    DELETE FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';
    DELETE FROM t_app_contact_enquiries WHERE Email LIKE 'scrnprobe%';
    DELETE FROM t_app_cms_content_blocks WHERE BlockKey LIKE 'SCRNPROBE%';
    DELETE FROM t_app_faqs WHERE Question LIKE N'${PROBE}%';

    /* Any seeded FAQ this suite switched off goes back on. */
    UPDATE t_app_faqs SET Is_Active = 1 WHERE Is_Deleted = 0 AND Is_Active = 0;`);
};

let browser;

try {
  // =========================================================================
  section('0. ENTRY — the shipped state, then the fixtures');
  // =========================================================================

  cleanup();

  /* ---- the routes exist, and /cms is still reachable as a redirect ------- */
  const routes = fs.readFileSync(ROUTES_FILE, 'utf8');

  const expectedRoutes = [
    'moderation/jobs', 'moderation/reports', 'enquiries',
    'cms/featured', 'cms/faqs', 'cms/blocks',
  ];

  const missingRoutes = expectedRoutes.filter((r) => !routes.includes(`path: '${r}'`));

  check('entry: all six 7B routes are wired in jp-admin',
    missingRoutes.length === 0,
    missingRoutes.length ? `MISSING ${missingRoutes.join(', ')}` : expectedRoutes.join(' · '));

  check('🔴 entry: /cms survives as a redirect, so old bookmarks still land',
    routes.includes("path: 'cms', pathMatch: 'full', redirectTo: 'cms/featured'"),
    'deleting it would 404 every link written before today');

  check('entry: not one 7B route resolves to the coming-soon placeholder',
    !/path: '(moderation\/jobs|moderation\/reports|cms)', loadComponent: comingSoon/.test(routes),
    'the stubs are gone, not shadowed');

  /* ---- the menu rows, added in the same commit as the routes ------------- */
  const menuRows = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT m.MenuCode + ' -> ' + ISNULL(m.RoutePath, N'(group)') + ' [' + ISNULL(p.PermissionCode, 'none') + ']'
      FROM m_sso_menus m
      LEFT JOIN t_sso_permissions p ON p.PermissionId = m.PermissionId
     WHERE m.Is_Deleted = 0 AND m.MenuCode IN
       ('ADMIN_MODERATE_JOBS','ADMIN_MODERATE_REPORTS','ADMIN_ENQUIRIES',
        'ADMIN_CMS','ADMIN_CMS_FEATURED','ADMIN_CMS_FAQS','ADMIN_CMS_BLOCKS')
     ORDER BY m.MenuCode;`);

  menuRows.forEach((r) => console.log(`    ${r}`));
  console.log('');

  check('entry: every 7B route has its menu row (a route with no row is invisible)',
    menuRows.length === 7, `${menuRows.length}/7 rows`);

  check('🔒 entry: the enquiries row carries ENQUIRY.MANAGE',
    menuRows.some((r) => r.includes('ADMIN_ENQUIRIES -> /enquiries [ENQUIRY.MANAGE]')),
    menuRows.find((r) => r.startsWith('ADMIN_ENQUIRIES')) ?? 'MISSING');

  check('🔒 entry: all three CMS children carry CMS.MANAGE',
    ['FEATURED', 'FAQS', 'BLOCKS'].every((k) =>
      menuRows.some((r) => r.startsWith(`ADMIN_CMS_${k}`) && r.includes('[CMS.MANAGE]'))),
    'the parent is a group node and gates nothing itself');

  /* ---- the closed holder sets this suite leans on ------------------------ */
  const sets = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT p.PermissionCode + ' = ' + ISNULL(STRING_AGG(CAST(r.RoleCode AS nvarchar(40)), ', ')
             WITHIN GROUP (ORDER BY r.RoleCode), '(nobody)')
      FROM t_sso_permissions p
      LEFT JOIN t_sso_role_permissions rp ON rp.PermissionId = p.PermissionId AND rp.Is_Deleted = 0 AND rp.Is_Active = 1
      LEFT JOIN t_sso_roles r ON r.RoleId = rp.RoleId AND r.Is_Deleted = 0
     WHERE p.PermissionCode IN ('MODERATION.JOB','ENQUIRY.MANAGE','CMS.MANAGE')
     GROUP BY p.PermissionCode ORDER BY p.PermissionCode;`);

  sets.forEach((line) => console.log(`    ${line}`));
  console.log('');

  check('🔒 entry: CMS.MANAGE is SUPER_ADMIN alone — the sidebar check depends on it',
    sets.includes('CMS.MANAGE = SUPER_ADMIN'),
    sets.find((l) => l.startsWith('CMS.MANAGE')) ?? 'MISSING');

  check('🔒 entry: a MODERATION_ADMIN holds MODERATION.JOB and ENQUIRY.MANAGE',
    sets.includes('MODERATION.JOB = MODERATION_ADMIN, SUPER_ADMIN')
      && sets.includes('ENQUIRY.MANAGE = MODERATION_ADMIN, SUPER_ADMIN'),
    'so section 9 expects exactly three of the six links');

  /* ---- fixtures ---------------------------------------------------------- */
  makeAdmin(MODERATOR.id, 'MODERATION_ADMIN');
  invalidate(MODERATOR.id);

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(SchoolId AS varchar(10)) FROM t_app_schools WHERE Is_Deleted = 0 ORDER BY SchoolId;`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(10)) FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  const teacherIds = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 2 CAST(TeacherId AS varchar(10)) FROM t_app_teachers
     WHERE Is_Deleted = 0 ORDER BY TeacherId;`).map(Number);

  /*
    Two live jobs. One gets reported, so the queue has something to put first;
    the other is the control that proves the ordering is doing work.

    🔴 TWO APPLICATIONS on the reported one. The count is what the screen shows
    before a pull, and the point of section 2 is that pulling leaves both rows
    exactly as they were.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId,
                            LastDateToApply, PublishedOn, StateId)
    VALUES (${schoolId}, ${branchId}, N'${PROBE} reported advert', 1, 1, 1, 1, 2, '2027-12-31', DATEADD(day, -3, SYSUTCDATETIME()), 1),
           (${schoolId}, ${branchId}, N'${PROBE} quiet advert', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME(), 1);

    DECLARE @j bigint = (SELECT JobId FROM t_app_jobs WHERE JobTitle = N'${PROBE} reported advert');

    INSERT INTO t_app_applications (JobId, SchoolId, BranchId, TeacherId, ApplicationStatusId, AppliedOn)
    VALUES (@j, ${schoolId}, ${branchId}, ${teacherIds[0]}, 2, SYSUTCDATETIME()),
           (@j, ${schoolId}, ${branchId}, ${teacherIds[1]}, 3, SYSUTCDATETIME());`);

  const reportedUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs WHERE JobTitle = N'${PROBE} reported advert';`);

  /* An enquiry, a FAQ and a content block for sections 6 to 8. */
  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_contact_enquiries (Name, Email, Mobile, Subject, Message, CreatedOn)
    VALUES (N'${PROBE} Visitor', 'scrnprobe@yopmail.com', '9876500000',
            N'${PROBE} how do I get verified', N'I run a school in Pune and want to list vacancies.',
            DATEADD(day, -4, SYSUTCDATETIME()));

    INSERT INTO t_app_faqs (Category, Question, Answer, DisplayOrder, Is_Active)
    VALUES ('TEACHER', N'${PROBE} is this question shown?', N'Yes, until a screen switches it off.', 980, 1);

    INSERT INTO t_app_cms_content_blocks (BlockKey, BlockTitle, BlockContent, DisplayOrder, Is_Active)
    VALUES ('SCRNPROBE_HERO', N'${PROBE} heading', N'Copy nothing on the public site reads yet.', 980, 1);`);

  const superSession = await loginSession(SUPER);
  const modSession = await loginSession(MODERATOR);
  const teacherSession = await loginSession(TEACHER);

  /* The report, through the real route, so the reporter uid is a real one. */
  const reported = await fetch(`${APP}/reports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${teacherSession.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reasonId: 1,
      entityType: 'JOB',
      entityUid: reportedUid,
      description: `${PROBE} the salary in this advert is not what was offered`,
    }),
  });

  check('fixture: a teacher reported the advert through the real route',
    reported.status === 200, `POST /reports -> ${reported.status}`);

  const reporterUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(ReportedByUserUid AS varchar(50))) FROM t_app_reports
     WHERE Description LIKE N'${PROBE}%';`);

  const reporterName = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 t.FullName FROM t_app_teachers t
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
     WHERE LOWER(CAST(u.UserUid AS varchar(50))) = '${reporterUid}';`);

  check('premise: the reporter has a real name in the database to leak',
    reporterName.length > 2, `${reporterName} — section 4 looks for this string`);

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
    await page.waitForTimeout(2200);

    return { context, page, errors };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  // =========================================================================
  section('1. THE MODERATION QUEUE — and the reported advert is first');
  // =========================================================================

  const { context: modCtx, page: mod, errors: modErrors } =
    await openAs(superSession, `${ADMIN_APP}/moderation/jobs`);

  /*
    ⚠️ Waits for the ROW, not for a timeout. The suite that waited on a
    network heuristic reported NOT GREETED for a working feature three times
    this session; the thing being asserted is the thing to wait for.
  */
  await mod.locator('.table tbody tr').first().waitFor({ timeout: 10_000 });

  const titles = await mod.locator('.table tbody tr td:first-child strong').allInnerTexts();

  console.log(`\n    queue order: ${titles.slice(0, 4).join(' | ')}\n`);

  check('the queue renders rows',
    titles.length >= 2, `${titles.length} row(s)`);

  check('🔴 the REPORTED advert is first, ahead of one published later',
    titles[0]?.includes('reported advert') && titles.some((t) => t.includes('quiet advert')),
    'a queue, not a list — complained-about first');

  const firstRowText = (await mod.locator('.table tbody tr').first().innerText())
    .replace(/\s+/g, ' ');

  console.log(`    "${firstRowText}"\n`);

  /*
    ⚠️ READ OFF THE CELLS, not matched against the row's whole text. A regex
    for /1/ over a row that also carries a date is satisfied by the date — a
    test passing for the wrong reason, which this session has already paid for
    three times.
  */
  const reportCell = (await mod.locator('.table tbody tr').first()
    .locator('td').nth(2).innerText()).trim();

  const appliedCell = (await mod.locator('.table tbody tr').first()
    .locator('td').nth(3).innerText()).trim();

  console.log(`    reports cell: "${reportCell}" · applied cell: "${appliedCell}"\n`);

  check('…and that row shows the open complaint count',
    reportCell === '1', `reports cell = ${reportCell}`);

  check('🔴 …and the number of people who applied, which is the weight of the decision',
    appliedCell === '2', `applied cell = ${appliedCell}`);

  check('the row is marked as needing attention',
    await mod.locator('.table tbody tr.row--attention').count() >= 1,
    'one colour, one meaning — an open complaint and nothing else');

  /* The triage filter does something. */
  await mod.locator('#mod-reported').check();
  await mod.waitForTimeout(1800);

  const narrowed = await mod.locator('.table tbody tr').count();

  check('🔴 "Reported only" narrows the queue to the complained-about',
    narrowed === 1, `${titles.length} rows -> ${narrowed}`);

  await mod.locator('#mod-reported').uncheck();
  await mod.waitForTimeout(1500);

  check('no console error on the moderation queue',
    modErrors.length === 0, modErrors.slice(0, 2).join(' | ') || 'clean');

  await shot(mod, 'admin-moderation-queue');

  // =========================================================================
  section('2. 🔴 PULL, THROUGH THE UI — and the public site the same second');
  // =========================================================================

  /* What the applications look like BEFORE, byte for byte. */
  const appsBefore = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(a.ApplicationId AS varchar(12)) + '|' + CAST(a.ApplicationStatusId AS varchar(4))
         + '|' + ISNULL(CONVERT(varchar(30), a.ModifiedOn, 126), 'never')
         + '|' + CAST(a.Is_Deleted AS varchar(2))
      FROM t_app_applications a
      INNER JOIN t_app_jobs j ON j.JobId = a.JobId
     WHERE j.JobTitle = N'${PROBE} reported advert'
     ORDER BY a.ApplicationId;`);

  const beforePublic = await fetch(`${APP}/public/jobs/${reportedUid}`);

  check('premise: the advert is on the public site before the pull',
    beforePublic.status === 200, `public detail -> ${beforePublic.status}`);

  await mod.locator('.table tbody tr').first().locator('button.btn--danger').click();
  await mod.locator('#mod-remarks').waitFor({ timeout: 8000 });

  const panelText = (await mod.locator('.mod__panel').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${panelText.slice(0, 220)}"\n`);

  check('🔴 the panel SAYS the school reads the reason, before anything is typed',
    /school reads this/i.test(panelText),
    'a moderator who thinks it is an internal note writes something else');

  check('…and it says the applications already received are untouched',
    /applications already received stay/i.test(panelText),
    '2.62 and the candidates, in the same sentence');

  const blockedButton = await mod.locator('.mod__panel .btn--danger').isDisabled();

  check('🔴 with no reason typed, the button is refused BY THE SCREEN',
    blockedButton === true, 'the server refuses it too; this asks first');

  check('…and the screen says why, rather than leaving a dead button',
    /a reason is required/i.test(panelText), 'said, not merely enforced');

  await mod.locator('#mod-remarks').fill(
    'The salary range contradicts the description. Correct it and we will restore the advert.',
  );
  await mod.waitForTimeout(400);
  await mod.locator('.mod__panel .btn--danger').click();

  /* 🔴 The same second, from the client's side: measured, not asserted. */
  await mod.locator('.banner--success').waitFor({ timeout: 10_000 });
  const pulledAt = Date.now();

  const afterPublic = await fetch(`${APP}/public/jobs/${reportedUid}`);
  const gap = Date.now() - pulledAt;

  const banner = (await mod.locator('.banner--success').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${banner.slice(0, 160)}"`);
  console.log(`    public re-read: ${afterPublic.status} · ${gap} ms after the banner`);
  console.log(`    public cache header: ${beforePublic.headers.get('cache-control')}\n`);

  check('🔴 pulling through the UI reports back in the server\'s own words',
    /pull/i.test(banner), banner.slice(0, 80));

  check('🔴 the advert is GONE from the public site, measured in ms',
    afterPublic.status === 404, `404 · ${gap} ms later`);

  check('🔴 …and no cache could have held it: the 7A-0 decision, in the header',
    (beforePublic.headers.get('cache-control') ?? '').includes('no-store'),
    beforePublic.headers.get('cache-control') ?? 'ABSENT');

  const statusCell = (await mod.locator('.table tbody tr').first().innerText())
    .replace(/\s+/g, ' ');

  check('…and the queue row now reads Pulled',
    /pulled/i.test(statusCell), statusCell.slice(0, 80));

  const appsAfter = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(a.ApplicationId AS varchar(12)) + '|' + CAST(a.ApplicationStatusId AS varchar(4))
         + '|' + ISNULL(CONVERT(varchar(30), a.ModifiedOn, 126), 'never')
         + '|' + CAST(a.Is_Deleted AS varchar(2))
      FROM t_app_applications a
      INNER JOIN t_app_jobs j ON j.JobId = a.JobId
     WHERE j.JobTitle = N'${PROBE} reported advert'
     ORDER BY a.ApplicationId;`);

  console.log(`    before: ${appsBefore.join('  ')}`);
  console.log(`    after:  ${appsAfter.join('  ')}\n`);

  check('🔴 BOTH APPLICATIONS ARE BYTE-FOR-BYTE WHAT THEY WERE',
    appsAfter.length === 2 && appsBefore.join() === appsAfter.join(),
    'status, ModifiedOn and Is_Deleted all unchanged — the candidates did nothing wrong');

  await shot(mod, 'admin-moderation-pulled');

  // =========================================================================
  section('3. 🔴 THE LOG — the school\'s words, and nobody\'s name');
  // =========================================================================

  await mod.locator('.table tbody tr').first().locator('button').first().click();
  await mod.locator('.mod__log').waitFor({ timeout: 8000 });

  const logText = (await mod.locator('.mod__panel').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${logText.slice(0, 320)}"\n`);

  check('the log shows the pull that just happened',
    /pulled/i.test(logText), 'append-only: 034 gave the table no Is_Deleted');

  check('…with the reason, in the words the school will read',
    logText.includes('The salary range contradicts the description'),
    'the same string the moderator typed');

  check('🔒 …and the panel names NO administrator anywhere',
    !/superadmin|teacherportal\.local|@yopmail/i.test(logText),
    'who moderated is recorded in the row and shown to nobody');

  check('🔴 the restore panel says it goes back to the status it HAD',
    /status it held before/i.test(logText),
    'not "republished" — a pulled draft returns to draft');

  /* Restore it, so the fixture is live again for the featured section. */
  await mod.locator('#mod-remarks').fill('Corrected by the school. Restoring the advert.');
  await mod.waitForTimeout(300);
  await mod.locator('.mod__panel .btn--primary').click();
  await mod.waitForTimeout(2500);

  const restoredPublic = await fetch(`${APP}/public/jobs/${reportedUid}`);

  check('🔴 restoring through the UI puts it back on the public site',
    restoredPublic.status === 200, `public detail -> ${restoredPublic.status}`);

  await modCtx.close();

  // =========================================================================
  section('4. REPORTS — a uid fragment and a count, and 🔒 never a name');
  // =========================================================================

  const { context: repCtx, page: rep, errors: repErrors } =
    await openAs(superSession, `${ADMIN_APP}/moderation/reports`);

  await rep.locator('.table tbody tr').first().waitFor({ timeout: 10_000 });

  const pageText = (await rep.locator('.page').innerText()).replace(/\s+/g, ' ');

  /*
    🔴 THE ROW IS FOUND BY THIS SUITE'S OWN TEXT, not taken as "the first one".

    The first version read row 1 and passed — on an orphan report left behind
    by admin-desk.mjs's interpolation bug, about a job that no longer existed.
    A green assertion about somebody else's row is worth less than a red one.
  */
  const myRow = rep.locator('.table tbody tr', { hasText: `${PROBE} the salary in this advert` });

  check('premise: THIS suite\'s report is the row being read, not a stray one',
    await myRow.count() === 1,
    `${await rep.locator('.table tbody tr').count()} row(s) in the queue`);

  const rowText = (await myRow.innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${rowText.slice(0, 200)}"\n`);

  check('the report is in the queue, with the reason in words',
    /not real/i.test(rowText) && rowText.includes(`${PROBE} the salary`),
    rowText.slice(0, 80));

  check('🔒 THE REPORTER\'S NAME IS NOWHERE ON THE PAGE',
    !pageText.includes(reporterName), `looked for: ${reporterName}`);

  check('🔒 …and not even their full uid is rendered — a fragment, for the eye',
    !pageText.includes(reporterUid) && pageText.includes(reporterUid.split('-')[0]),
    `${reporterUid.split('-')[0]}… is shown, the whole uid is not`);

  /* Closing a report takes a note; picking it up does not. */
  await myRow.locator('button.btn--primary').click();
  await rep.locator('#rep-next').waitFor({ timeout: 8000 });

  const canPickUp = await rep.locator('.rep__panel .btn--primary').isDisabled();

  check('🔴 moving a report to UNDER REVIEW needs no essay',
    canPickUp === false, 'saying you have it is not a decision');

  /*
    ⚠️ BY LABEL, not by value. The options carry [ngValue]="4", so Angular
    writes its own internal option values ("2: 4") and selectOption('4')
    matches nothing — which is how this suite first failed, with a timeout that
    read like the select was disabled. Picking the option a person would pick
    is both the more honest test and the one that works.
  */
  await rep.locator('#rep-next').selectOption({ label: 'Dismissed — nothing to do' });
  await rep.waitForTimeout(500);

  const mustNote = await rep.locator('.rep__panel .btn--primary').isDisabled();
  const panel4 = (await rep.locator('.rep__panel').innerText()).replace(/\s+/g, ' ');

  check('🔴 …but DISMISSING one is refused by the screen until a note is typed',
    mustNote === true, 'somebody reads this decision back in six months');

  check('🔒 …and the note says plainly that neither party will see it',
    /neither the reporter nor the party reported sees this/i.test(panel4),
    'what a school is told lives on the job, and names nothing');

  check('no console error on the reports queue',
    repErrors.length === 0, repErrors.slice(0, 2).join(' | ') || 'clean');

  await shot(rep, 'admin-reports-queue');
  await repCtx.close();

  // =========================================================================
  section('5. FEATURED — three groups out of one date field');
  // =========================================================================

  /*
    Two windows on the two fixture adverts: one live today, one starting
    tomorrow. The screen has to put them in different groups from the same
    column — which is the whole claim of a date-derived feature.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @a bigint = (SELECT JobId FROM t_app_jobs WHERE JobTitle = N'${PROBE} reported advert');
    DECLARE @b bigint = (SELECT JobId FROM t_app_jobs WHERE JobTitle = N'${PROBE} quiet advert');

    INSERT INTO t_app_featured_jobs (JobId, FromDate, ToDate, DisplayOrder)
    VALUES (@a, '${istDay(0)}', '${istDay(3)}', 1),
           (@b, '${istDay(1)}', '${istDay(5)}', 2);`);

  const { context: featCtx, page: feat, errors: featErrors } =
    await openAs(superSession, `${ADMIN_APP}/cms/featured`);

  await feat.locator('.feat__group').first().waitFor({ timeout: 10_000 });

  const groupTitles = (await feat.locator('.feat__group-title').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim());

  console.log(`\n    groups: ${groupTitles.join(' | ')}\n`);

  check('🔴 live today and starting later are DIFFERENT groups, from one column',
    groupTitles.some((t) => /live today/i.test(t)) && groupTitles.some((t) => /starting later/i.test(t)),
    'nothing ran to move either of them');

  const liveGroup = (await feat.locator('.feat__group').first().innerText()).replace(/\s+/g, ' ');

  check('…and the window that starts today holds the advert it names',
    liveGroup.includes('reported advert'), liveGroup.slice(0, 100));

  check('…while the one starting tomorrow is NOT in the live group',
    !liveGroup.includes('quiet advert'),
    'a comparison that forgot FromDate would lift it today');

  /*
    🔴 THE CASE THAT LOOKS LIKE A BUG. Pull the featured advert by API and the
    window is still live — the public listing just drops the job. The screen
    has to say so, or an admin concludes featuring is broken.
  */
  await fetch(`${APP}/admin/desk/jobs/${reportedUid}/pull`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${superSession.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ remarks: `${PROBE} pulled while featured, to see what the screen says` }),
  });

  await feat.reload({ waitUntil: 'networkidle' });
  await feat.locator('.feat__group').first().waitFor({ timeout: 10_000 });
  await feat.waitForTimeout(1200);

  const downNote = await feat.locator('.feat__down').count();
  const downText = downNote > 0
    ? (await feat.locator('.feat__down').first().innerText()).replace(/\s+/g, ' ')
    : '(absent)';

  console.log(`    "${downText}"\n`);

  check('🔴 a live window promoting a PULLED advert says it is doing nothing',
    downNote >= 1 && /does not appear publicly/i.test(downText), downText.slice(0, 110));

  check('…and it names the status rather than hinting at it',
    /pulled/i.test(downText), 'an admin should not have to guess which status');

  await shot(feat, 'admin-featured-placement');
  await featCtx.close();

  /* Put the advert back, through the API this time. */
  await fetch(`${APP}/admin/desk/jobs/${reportedUid}/restore`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${superSession.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ remarks: `${PROBE} restored after the featured check` }),
  });

  // =========================================================================
  section('6. FAQ — switch one off, and read the public bytes');
  // =========================================================================

  const { context: faqCtx, page: faq, errors: faqErrors } =
    await openAs(superSession, `${ADMIN_APP}/cms/faqs`);

  await faq.locator('.faq__item').first().waitFor({ timeout: 10_000 });

  const probeItem = faq.locator('.faq__item', { hasText: `${PROBE} is this question shown?` });

  check('the admin list holds the fixture question',
    await probeItem.count() === 1, `${await faq.locator('.faq__item').count()} FAQ(s) listed`);

  const publicBefore = await (await fetch(`${APP}/public/faqs`)).text();

  check('premise: the public FAQ response carries it right now',
    publicBefore.includes(`${PROBE} is this question shown?`),
    'raw bytes, before anything is switched');

  await probeItem.locator('button', { hasText: 'Switch off' }).click();
  await faq.waitForTimeout(2200);

  const publicAfter = await (await fetch(`${APP}/public/faqs`)).text();
  const offText = (await probeItem.innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${offText.slice(0, 120)}"\n`);

  check('🔴 switching it off removes it from the PUBLIC response, raw bytes',
    !publicAfter.includes(`${PROBE} is this question shown?`),
    `${publicBefore.length} bytes -> ${publicAfter.length} bytes`);

  check('🔴 …and the admin screen SAYS it is not shown, rather than greying it',
    /not shown/i.test(offText),
    'opacity alone leaves "why is this not on the site?" unanswerable');

  check('…and the answer is still there, because off is not deleted',
    offText.includes('until a screen switches it off'), 'the words are kept');

  await probeItem.locator('button', { hasText: 'Switch on' }).click();
  await faq.waitForTimeout(2200);

  const publicBack = await (await fetch(`${APP}/public/faqs`)).text();

  check('…and switching it back on returns it to the public response',
    publicBack.includes(`${PROBE} is this question shown?`), 'reversible, in one click');

  check('no console error on the FAQ screen',
    faqErrors.length === 0, faqErrors.slice(0, 2).join(' | ') || 'clean');

  await shot(faq, 'admin-faqs');
  await faqCtx.close();

  // =========================================================================
  section('7. BLOCKS — and the screen names where a block renders (G44 closed)');
  // =========================================================================

  const { context: blkCtx, page: blk, errors: blkErrors } =
    await openAs(superSession, `${ADMIN_APP}/cms/blocks`);

  await blk.locator('.blk__item').first().waitFor({ timeout: 10_000 });

  const warnText = (await blk.locator('.banner--info').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${warnText.slice(0, 200)}"\n`);

  /*
    🔴 THIS ASSERTION IS THE INVERSE OF THE ONE 7B SHIPPED, and the inversion
    is the point. 7B asserted the screen SAID no public page rendered a block,
    because none did. 8-0 gave them a consumer, so the screen now has to name
    it — a banner still claiming nothing renders would be the stale-copy defect
    this project keeps finding on its own surfaces.
  */
  check('🔴 the screen names WHERE a block renders — the HOME_ prefix (G44 closed)',
    /keys beginning/i.test(warnText) && /home page/i.test(warnText),
    warnText.slice(0, 110));

  check('🔴 …and no longer claims nothing renders, which stopped being true in 8-0',
    !/no public page shows these yet/i.test(warnText),
    'the 7B banner would now be false');

  check('…and it still says where an UNRENDERED key goes, which is the honest half',
    warnText.includes('/api/public/content-blocks'), warnText.slice(0, 90));

  /* The claim is true: jp-public has the method and no caller. */
  const publicService = fs.readFileSync(
    'D:/Projects/jp-public/src/app/core/public-api.service.ts', 'utf8',
  );
  /*
    ⚠️ Walked in Node rather than shelled out to rg: a suite that depends on a
    tool being on PATH fails for a reason that has nothing to do with the
    product.
  */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

  const publicSrc = walk('D:/Projects/jp-public/src')
    .filter((f) => /\.(ts|html)$/.test(f))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('getContentBlocks'));

  /*
    🔴 AND THE CLAIM IS CHECKED AGAINST jp-public'S SOURCE, STILL — but for the
    opposite fact. In 7B this walked the tree to prove the caller count was
    ZERO. It now proves there IS one, and names it: the home page.

    ⚠️ Kept as a source walk rather than deleted. If somebody removes the home
    page's consumer, this fails and the banner above becomes a lie again — the
    two are only ever true together.
  */
  const consumers = publicSrc.filter((f) => !f.includes('public-api.service'));

  check('🔴 …and the claim is TRUE: getContentBlocks now has a caller, in the home page',
    publicService.includes('getContentBlocks')
      && consumers.some((f) => f.includes('pages/home/')),
    `caller(s): ${consumers.map((f) => f.split('/src/')[1] ?? f).join(', ') || 'NONE'}`);

  await blk.locator('.blk__item').first().locator('button', { hasText: 'Edit' }).click();
  await blk.locator('#blk-key').waitFor({ timeout: 8000 });

  const keyReadonly = await blk.locator('#blk-key').getAttribute('readonly');
  const keyHelp = (await blk.locator('.blk__form').innerText()).replace(/\s+/g, ' ');

  check('🔴 the key is READ-ONLY on an existing block — a page asks for it by key',
    keyReadonly !== null, 'renaming would unpublish the old block silently');

  check('…and the screen explains that rather than just disabling the field',
    /the key cannot change/i.test(keyHelp), keyHelp.slice(0, 90));

  check('no console error on the blocks screen',
    blkErrors.length === 0, blkErrors.slice(0, 2).join(' | ') || 'clean');

  await shot(blk, 'admin-content-blocks');
  await blkCtx.close();

  // =========================================================================
  section('8. ENQUIRIES — days waiting, and a note before it closes');
  // =========================================================================

  const { context: enqCtx, page: enq, errors: enqErrors } =
    await openAs(superSession, `${ADMIN_APP}/enquiries`);

  await enq.locator('.enq__item').first().waitFor({ timeout: 10_000 });

  const enqItem = enq.locator('.enq__item', { hasText: `${PROBE} how do I get verified` });
  const enqText = (await enqItem.innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${enqText.slice(0, 200)}"\n`);

  check('the unanswered enquiry is listed by default',
    await enqItem.count() === 1, 'unanswered is the filter people want first');

  check('🔴 it says how long it has been WAITING, not just when it arrived',
    /waiting 4 days/i.test(enqText), 'an inbox is judged by its oldest message');

  check('🔒 the visitor\'s own email is shown — they asked to be replied to',
    enqText.includes('scrnprobe@yopmail.com'),
    '2.56 is about a teacher\'s contact; this is a visitor\'s own request');

  /*
    ⚠️ `a.btn`, not any mailto on the card: the address itself is also a
    mailto, and matching both made Playwright refuse the call outright. Two
    links that do the same thing is fine for a person and ambiguous for a
    locator — so the test names the button.
  */
  const mailto = await enqItem.locator('a.btn[href^="mailto:"]').getAttribute('href');

  check('…and the reply is a mailto, with the subject quoted back',
    (mailto ?? '').includes('mailto:scrnprobe%40yopmail.com') && /Re%3A/.test(mailto ?? ''),
    mailto?.slice(0, 70) ?? 'ABSENT');

  check('🔴 …and nothing on the screen claims to SEND mail',
    !/send (the )?(reply|email)/i.test(enqText),
    'nothing in the product sends mail on an admin\'s behalf');

  await enqItem.locator('button', { hasText: 'Mark answered' }).click();
  await enq.locator('#enq-remarks').waitFor({ timeout: 8000 });

  const enqBlocked = await enq.locator('.enq__panel .btn--primary').isDisabled();

  check('🔴 marking it answered is refused until the note is typed',
    enqBlocked === true, '033\'s CHECK demands the whole trail together');

  await enq.locator('#enq-remarks').fill('Replied explaining school verification takes two days.');
  await enq.waitForTimeout(300);
  await enq.locator('.enq__panel .btn--primary').click();
  await enq.waitForTimeout(2200);

  const trail = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(IsResolved AS varchar(2)) + '|' + CASE WHEN ResolvedByUserId IS NULL THEN 'nobody' ELSE 'set' END
         + '|' + CASE WHEN ResolvedOn IS NULL THEN 'never' ELSE 'set' END
         + '|' + CASE WHEN ResolutionRemarks IS NULL THEN 'none' ELSE 'set' END
      FROM t_app_contact_enquiries WHERE Email = 'scrnprobe@yopmail.com';`);

  console.log(`\n    trail after the UI resolve: ${trail}\n`);

  check('🔴 …and resolving from the screen writes the WHOLE trail',
    trail === '1|set|set|set', trail);

  const stillUnanswered = await enq.locator('.enq__item', {
    hasText: `${PROBE} how do I get verified`,
  }).count();

  check('…so it leaves the unanswered list',
    stillUnanswered === 0, 'the default filter is work, not history');

  check('no console error on the enquiries screen',
    enqErrors.length === 0, enqErrors.slice(0, 2).join(' | ') || 'clean');

  await shot(enq, 'admin-enquiries');
  await enqCtx.close();

  // =========================================================================
  section('9. 🔒 THE MENU AND THE WALL — what a MODERATION_ADMIN gets');
  // =========================================================================

  const { context: mmCtx, page: mm } =
    await openAs(modSession, `${ADMIN_APP}/moderation/jobs`);

  await mm.locator('.nav-link').first().waitFor({ timeout: 10_000 });

  const navText = (await mm.locator('.shell__sidebar').innerText()).replace(/\s+/g, ' ');
  const navLinks = await mm.locator('.nav-link').allInnerTexts();

  console.log(`\n    sidebar: ${navLinks.map((l) => l.trim()).join(' · ')}\n`);

  check('🔒 a MODERATION_ADMIN is offered the two moderation screens',
    navText.includes('Jobs') && navText.includes('Reports'), 'MODERATION.JOB and .REPORT');

  check('🔒 …and the enquiries screen, which they do hold',
    navText.includes('Enquiries'), 'ENQUIRY.MANAGE = MODERATION_ADMIN, SUPER_ADMIN');

  check('🔒 …and NOT the CMS screens, which are SUPER_ADMIN alone',
    !navText.includes('Featured') && !navText.includes('Page content'),
    'CMS.MANAGE is not theirs');

  check('🔴 …and not an empty CMS HEADING either — the group is absent',
    !navText.includes('CMS'),
    'a heading with nothing under it is a screen somebody will go looking for');

  /*
    🔴 AND THE WALL ITSELF. Typing the URL reaches the component — hiding a
    route is presentation (the routes file says so). Every call it makes is
    refused 403, and the screen must show its FAILED state, not its empty one:
    "there is no featured content" and "you may not read it" are different
    statements and only one of them is true.
  */
  await mm.goto(`${ADMIN_APP}/cms/featured`, { waitUntil: 'networkidle' });
  await mm.waitForTimeout(2400);

  const wallText = (await mm.locator('.page').innerText()).replace(/\s+/g, ' ');

  console.log(`    "${wallText.slice(0, 220)}"\n`);

  check('🔒 typing /cms/featured as a moderator shows the FAILED note',
    /could not be loaded/i.test(wallText), wallText.slice(0, 110));

  check('🔴 …and NOT the empty state, which would be a false statement',
    !/nothing is featured/i.test(wallText),
    '"nothing to show" and "you may not see it" are different sentences');

  await shot(mm, 'admin-moderator-wall');
  await mmCtx.close();

  // =========================================================================
  section('10. 375 — six screens, each with its own proof');
  // =========================================================================

  for (const [label, url, shotName, proof] of [
    ['moderation', `${ADMIN_APP}/moderation/jobs`, 'admin-moderation-375', '.table tbody tr'],
    ['reports', `${ADMIN_APP}/moderation/reports`, 'admin-reports-375', '.table tbody tr'],
    ['featured', `${ADMIN_APP}/cms/featured`, 'admin-featured-375', '.feat__group'],
    ['faqs', `${ADMIN_APP}/cms/faqs`, 'admin-faqs-375', '.faq__item'],
    ['blocks', `${ADMIN_APP}/cms/blocks`, 'admin-blocks-375', '.blk__item'],
    ['enquiries', `${ADMIN_APP}/enquiries`, 'admin-enquiries-375', '.enq__item'],
  ]) {
    const { context: phoneCtx, page: phone } = await openAs(superSession, url, PHONE);

    /* ⚠️ The all-enquiries filter, so the phone pass has a card to measure. */
    if (label === 'enquiries') {
      await phone.locator('button', { hasText: 'All' }).click();
      await phone.waitForTimeout(1800);
    }

    const over = await phone.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));

    const present = await phone.locator(proof).count();

    console.log(`    ${label} at 375: document ${over.doc}px, viewport ${over.client}px,`
      + ` ${present} × ${proof}`);

    check(`🔴 ${label} does not scroll the page sideways at 375`,
      over.doc <= over.client, `${over.doc} <= ${over.client}`);

    /*
      ⚠️ Asserted on the thing that would DO the overflowing, not a node count
      that an empty state satisfies — the way this exact check once passed
      vacuously in 6.5B.
    */
    check(`…and ${label}'s widest content IS present, so the measurement means something`,
      present > 0, `${present} × ${proof}`);

    await shot(phone, shotName);
    await phoneCtx.close();
  }

  // =========================================================================
  section('11. EXIT — the fixtures gone, the shipped state back');
  // =========================================================================
} catch (error) {
  check('the suite ran to completion', false, String(error).slice(0, 400));
} finally {
  if (browser) await browser.close();

  cleanup();
  dropAdmin(MODERATOR.id);

  const left = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(
      (SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%')
    + (SELECT COUNT(*) FROM t_app_faqs WHERE Question LIKE N'${PROBE}%')
    + (SELECT COUNT(*) FROM t_app_cms_content_blocks WHERE BlockKey LIKE 'SCRNPROBE%')
    + (SELECT COUNT(*) FROM t_app_contact_enquiries WHERE Email LIKE 'scrnprobe%')
    + (SELECT COUNT(*) FROM t_app_reports WHERE Description LIKE N'${PROBE}%') AS varchar(6));`);

  const faqsOff = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs WHERE Is_Deleted = 0 AND Is_Active = 0;`);

  const modLeft = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM t_sso_users WHERE Email = '${MODERATOR.id}';`);

  check('exit: every fixture row is gone', left === '0', `${left} left`);

  check('exit: no FAQ is left switched off — the shipped state is 12 active',
    faqsOff === '0', `${faqsOff} inactive`);

  check('exit: the fixture moderator account is gone', modLeft === '0', `${modLeft} left`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

  if (failed.length) {
    console.log(`\n  ${failed.length} FAILED:`);
    failed.forEach((f) => console.log(`    x ${f.name}${f.detail ? `  — ${f.detail}` : ''}`));
  }

  console.log('='.repeat(74));
  /*
    ⚠️ exitCode, NOT process.exit() — the project's convention, and this suite
    learned why. process.exit() while a fetch keep-alive handle was mid-close
    killed Node with 0xC0000409 AFTER printing 9/9 PASSED, and the runner
    reported it as "exited while reporting all green".
  */
  process.exitCode = failed.length ? 1 : 0;
}
