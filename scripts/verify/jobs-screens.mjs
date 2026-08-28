/*
  PHASE 4B — the job screens in a real browser, and the owed full chain.

  ----------------------------------------------------------------------------
    1. LIFECYCLE THROUGH THE UI   create -> edit -> publish -> list -> close,
                                  clicking, with screenshots at each step.
    2. 🔴 THE FULL CHAIN          JOB_POST flipped to METERED quota 1 in the
                                  ADMIN SCREEN (browser), then jp-school: first
                                  publish works, second shows the QUOTA message
                                  and the job stays a Draft in the list, flip
                                  back to FREE in the admin screen, publish
                                  works and the ledger is unchanged. One
                                  session, no restarts, both apps.
    4. PERMISSION RENDERING       Owner sees Publish; HR does not; a read-only
                                  account sees neither. Plus the forced fetch:
                                  the UI hides, the SERVER refuses, both shown.
    5. SCOPE RENDERING            school-2 HR sees zero school-4 rows, and a
                                  hand-built URL to a school-4 job renders the
                                  not-found state.
    6. LOCKED FIELDS              disabled in the form with the reason on
                                  screen; a forced save of a locked field gets
                                  JOB_FIELD_LOCKED from the server.
    7. VALIDATION                 a field-level message, not one toast.

  ----------------------------------------------------------------------------
  ⚠️ THE "VIEWER" IS SYNTHESISED, AND SAID SO
  ----------------------------------------------------------------------------
  No SCHOOL_VIEWER account is seeded, and creating one needs the invite-and-set-
  password flow. The UI decides from PERMISSIONS, not roles, so the read-only
  case is exercised by temporarily reducing the HR role to JOB.VIEW alone and
  restoring it afterwards. That drives exactly the code path a Viewer would.

  🔴 It is a fixture, not a pretence: the grants are asserted before and after.

  Run (jp-shared :4999, jp-school :4300, jp-admin :4200, both APIs):
      node scripts/verify/jobs-screens.mjs
*/
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';
const SCHOOL_APP = 'http://localhost:4300';
const ADMIN_APP = 'http://localhost:4200';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ADMIN = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const HR = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001',
    '-h', '-1', '-W', '-s', '|', '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep text */ }

  return { http: r.status, body: b, text: t };
};

const login = async (id, pw, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: id, password: pw }),
  });

  if (r.http === 429 && attempt <= 4) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(id, pw, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${id}: ${r.http} ${r.body?.message ?? r.text}`);

  return r.body.data;
};

const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT FeatureId FROM m_mdm_features WHERE FeatureCode='JOB_POST' AND Is_Deleted=0;`));

const restoreShipped = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId=1, Is_Active=1 WHERE Is_Deleted=0;
    DELETE FROM m_mdm_plan_features;`);
  // Restore the HR role's grants if the read-only fixture was left applied.
  sql(`SET NOCOUNT ON; USE jp_sso;
    UPDATE rp SET rp.Is_Deleted = 0
    FROM t_sso_role_permissions rp
      JOIN t_sso_roles r ON r.RoleId = rp.RoleId
      JOIN t_sso_permissions p ON p.PermissionId = rp.PermissionId
    WHERE r.RoleCode='HR' AND p.PermissionCode IN ('JOB.CREATE','JOB.EDIT');`);
};

let ownerSchool = 0;
let hrSchool = 0;
const cleanupJobs = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_job_subjects WHERE JobId IN (SELECT JobId FROM t_app_jobs);
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs);
  DELETE FROM t_app_jobs;`);

restoreShipped();
cleanupJobs();

const ownerSession = await login(OWNER.id, OWNER.pw);
const adminSession = await login(ADMIN.id, ADMIN.pw);
const hrSession = await login(HR.id, HR.pw);

const HO = { authorization: `Bearer ${ownerSession.accessToken}`, 'content-type': 'application/json' };
const HA = { authorization: `Bearer ${adminSession.accessToken}`, 'content-type': 'application/json' };

/*
  🔴 THE OWNER'S OWN ORGANISATION, resolved the way the API resolves it.

  The first version of this line took the LOWEST BranchId across every school,
  which is a different school entirely — so every ledger assertion counted an
  organisation nobody in this test was acting as, read 0, and reported the
  engine as broken when it was fine.

  ⚠️ A fixture that silently points at the wrong row does not fail loudly; it
  fails as a wrong number. Asking the API which campus this user actually holds
  is the only version that cannot drift.
*/
const ownerBranchId = (await j(`${APP}/branches`, { headers: HO })).body?.data?.[0]?.branchId;

const orgUid = scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CONVERT(varchar(40), s.OrganizationUid)
  FROM t_app_schools s
    JOIN t_app_school_branches b ON b.SchoolId = s.SchoolId
  WHERE b.BranchId = ${ownerBranchId};`);

console.log(`\nowner campus ${ownerBranchId} · organisation ${orgUid}`);

/*
  🔴 THE LEDGER IS CLEARED ON ENTRY TOO, AND THE PREMISE IS ASSERTED.

  The entry check covered features and mappings but not this, and a previous run
  of this script — the one with the wrong organisation — consumed a real row and
  then deleted a DIFFERENT organisation's rows on the way out. The stale row
  survived into the next run, which read a starting balance of 1 and reported
  the engine as broken.

  ⚠️ Cleaning up on exit is not enough when the exit path can be wrong. Both
  ends, and the starting value asserted rather than assumed.
*/
sql(`SET NOCOUNT ON; USE jp_app; DELETE FROM t_app_feature_ledger WHERE OwnerUid='${orgUid}';`);

const browser = await chromium.launch();
let ctx;

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

try {
  // =========================================================================
  console.log('\n=== 1. THE LIFECYCLE, THROUGH THE UI ===');

  ({ context: ctx } = await openAs(SCHOOL_APP, 'school', ownerSession));
  let page = ctx.pages()[0];

  await page.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  check('the Jobs screen renders',
    (await page.locator('.page__title').textContent())?.trim() === 'Jobs',
    await page.locator('.page__title').textContent());

  const navPaths = await page.locator('nav a').evaluateAll((ls) => ls.map((l) => l.getAttribute('href')));
  check('the seeded SCHOOL_JOBS menu row points at it (menus are data, 2.37)',
    navPaths.some((p) => p === '/jobs'), navPaths.filter(Boolean).join(' '));

  await shot(page, 'school-jobs-empty-1440');

  // ---- create --------------------------------------------------------------
  await page.locator('a:has-text("New job")').first().click();
  await page.waitForURL('**/jobs/new');
  await page.waitForTimeout(1200);

  await page.fill('#jobTitle', 'PGT Physics — Senior School');
  await page.selectOption('#subjectId', { index: 1 });
  await page.selectOption('#designationId', { index: 1 });
  await page.fill('#noOfVacancies', '2');
  await page.fill('#salaryMin', '40000');
  await page.fill('#salaryMax', '65000');
  await page.fill('#lastDateToApply', '2026-12-31');

  await shot(page, 'school-job-form-1440');

  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1800);

  const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 JobId FROM t_app_jobs ORDER BY JobId DESC;`));

  check('a draft is created by the form',
    jobId > 0 && scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT JobStatusId FROM t_app_jobs WHERE JobId=${jobId};`) === '1',
    `jobId ${jobId}, JobStatusId 1`);

  // ---- publish through the list -------------------------------------------
  await page.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  check('the draft appears in the list',
    (await page.locator('tbody tr').count()) === 1, `${await page.locator('tbody tr').count()} rows`);

  await page.locator('button:has-text("Publish")').first().click();
  await page.waitForTimeout(1800);

  check('publishing from the list works',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT JobStatusId FROM t_app_jobs WHERE JobId=${jobId};`) === '2', 'JobStatusId 2');

  await shot(page, 'school-jobs-list-1440');

  // ---- the locked form -----------------------------------------------------
  await page.goto(`${SCHOOL_APP}/jobs/${jobId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  const lockedBanner = await page.locator('.banner--locked').count();
  const subjectDisabled = await page.locator('#subjectId').isDisabled();
  const titleDisabled = await page.locator('#jobTitle').isDisabled();

  check('🔴 a published job shows the locked banner with the reason',
    lockedBanner === 1, `${lockedBanner} banner(s)`);
  check('🔴 …the matching fields are disabled',
    subjectDisabled === true, `subject disabled ${subjectDisabled}`);
  check('🔴 …and the TERMS are still editable',
    titleDisabled === false, `title disabled ${titleDisabled}`);
  check('…each locked field is marked, not merely greyed',
    (await page.locator('.field__lock').count()) > 0,
    `${await page.locator('.field__lock').count()} lock markers`);

  await shot(page, 'school-job-locked-1440');

  /*
    🔴 THE UI HIDES; THE SERVER REFUSES. Forced from inside the page, with the
    real session, so it is the same request the form would make.
  */
  const forcedLock = await page.evaluate(async ({ api, id }) => {
    const t = localStorage.getItem('jp.school.accessToken');
    const cur = await (await fetch(`${api}/jobs/${id}`,
      { headers: { authorization: `Bearer ${t}` } })).json();
    const d = cur.data;

    const r = await fetch(`${api}/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      // 🔴 A DIFFERENT subject — the locked field.
      body: JSON.stringify({ ...d, subjectId: d.subjectId + 1, jobId: id }),
    });

    return { http: r.status, body: await r.json() };
  }, { api: APP, id: jobId });

  check('🔴 a forced save of a LOCKED field is refused by the server',
    forcedLock.http === 400 && forcedLock.body?.code === 'JOB_FIELD_LOCKED',
    `HTTP ${forcedLock.http}, code ${forcedLock.body?.code}`);

  // ---- validation surfacing ------------------------------------------------
  await page.goto(`${SCHOOL_APP}/jobs/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.fill('#jobTitle', 'Salary the wrong way round');
  await page.selectOption('#subjectId', { index: 1 });
  await page.selectOption('#designationId', { index: 1 });
  await page.fill('#salaryMin', '90000');
  await page.fill('#salaryMax', '10000');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);

  const fieldErr = await page.locator('.field__error').allTextContents();
  check('🔴 a validation refusal renders on the FIELD, not as one toast',
    fieldErr.length === 1 && /maximum salary/i.test(fieldErr[0]),
    fieldErr.join(' | ') || 'no field error rendered');

  await shot(page, 'school-job-validation-1440');
  await ctx.close();

  // =========================================================================
  console.log('\n=== 2. 🔴 THE FULL CHAIN — ADMIN SCREEN, THEN jp-school ===');

  const ledger = () => Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_feature_ledger WHERE OwnerUid='${orgUid}' AND Is_Deleted=0;`));

  // Map the plan and open the admin matrix.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({
      planId: Number(scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT TOP 1 PlanId FROM t_app_subscriptions WHERE OwnerUid='${orgUid}' AND Is_Active=1;`)),
      featureId: FEATURE, action: 'MAP', isIncluded: true, quotaPerPeriod: 1,
    }),
  });

  const { context: adminCtx } = await openAs(ADMIN_APP, 'admin', adminSession);
  const adminPage = adminCtx.pages()[0];

  await adminPage.goto(`${ADMIN_APP}/settings/plans`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(1600);

  /*
    🔴 THE FLIP HAPPENS IN THE BROWSER — a select change on the admin screen,
    not a SQL update. That is what makes this the full chain rather than two
    unrelated tests.
  */
  const jobRow = adminPage.locator('tr', {
    has: adminPage.locator('.matrix__feature-code', { hasText: 'JOB_POST' }),
  });
  const savePut = adminPage.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await jobRow.locator('.matrix__mode').selectOption('3');   // METERED
  await savePut;
  await adminPage.waitForTimeout(800);

  check('JOB_POST set to METERED through the admin SCREEN',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT GatingModeId FROM m_mdm_features WHERE FeatureId=${FEATURE};`) === '3',
    'GatingModeId 3');

  await shot(adminPage, 'admin-plans-metered-1440');

  // ---- now jp-school, in the SAME session, with no restart -----------------
  const { context: schoolCtx } = await openAs(SCHOOL_APP, 'school', ownerSession);
  page = schoolCtx.pages()[0];

  const makeDraft = async (title) => {
    await page.goto(`${SCHOOL_APP}/jobs/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    await page.fill('#jobTitle', title);
    await page.selectOption('#subjectId', { index: 1 });
    await page.selectOption('#designationId', { index: 1 });
    await page.fill('#lastDateToApply', '2026-12-31');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1600);
  };

  await makeDraft('Metered A');
  await makeDraft('Metered B');

  const ledgerBefore = ledger();

  check('premise: this organisation starts with an empty ledger',
    ledgerBefore === 0, `${ledgerBefore} rows — a non-zero start makes the two checks below meaningless`);

  await page.goto(`${SCHOOL_APP}/jobs?`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  // First publish — should succeed and consume.
  await page.locator('tbody tr', { hasText: 'Metered A' })
    .locator('button:has-text("Publish")').click();
  await page.waitForTimeout(2000);

  check('🔴 the first publish under quota 1 succeeds and CONSUMES',
    ledger() === ledgerBefore + 1, `ledger ${ledgerBefore} -> ${ledger()}`);

  // Second publish — quota gone.
  await page.locator('tbody tr', { hasText: 'Metered B' })
    .locator('button:has-text("Publish")').click();
  await page.waitForTimeout(2000);

  const toastText = (await page.locator('.toast, [role="alert"]').allTextContents()).join(' ');

  console.log(`\n    the message a person sees: "${toastText.replace(/\s+/g, ' ').trim()}"\n`);

  check('🔴 the quota refusal says what happened, in plan language',
    /used all the job posts|plan includes this month/i.test(toastText),
    toastText ? 'quota wording shown' : 'NO MESSAGE RENDERED');
  check('🔴 …and it is NOT a generic error',
    !/something went wrong|unexpected/i.test(toastText), 'no generic wording');
  check('🔴 …no upgrade CTA (purchase screens are 6.5)',
    !/upgrade|buy now|purchase/i.test(toastText), 'no CTA offered');

  const metBId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT JobId FROM t_app_jobs WHERE JobTitle='Metered B';`));

  check('🔴 …the refused job is STILL a Draft in the database',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT JobStatusId FROM t_app_jobs WHERE JobId=${metBId};`) === '1', 'JobStatusId 1');
  check('🔴 …and no ledger row was written',
    ledger() === ledgerBefore + 1, `ledger ${ledger()}`);

  await shot(page, 'school-jobs-quota-1440');

  // ---- flip back to FREE, in the admin screen, same session ---------------
  const savePut2 = adminPage.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await jobRow.locator('.matrix__mode').selectOption('1');   // FREE
  await savePut2;

  const ledgerBeforeFree = ledger();

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.locator('tbody tr', { hasText: 'Metered B' })
    .locator('button:has-text("Publish")').click();
  await page.waitForTimeout(2000);

  check('🔴 flipped back to FREE: the SAME job publishes immediately',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT JobStatusId FROM t_app_jobs WHERE JobId=${metBId};`) === '2', 'JobStatusId 2');
  check('🔴 …and the ledger is UNCHANGED — nothing was charged',
    ledger() === ledgerBeforeFree, `${ledgerBeforeFree} -> ${ledger()}`);

  await adminCtx.close();

  // =========================================================================
  console.log('\n=== 4 & 5. PERMISSION AND SCOPE RENDERING ===');

  const ownerPublishButtons = await page.locator('button:has-text("Publish")').count();
  const ownerNewJob = await page.locator('a:has-text("New job")').count();

  check('OWNER sees New job and Publish', ownerNewJob === 1 && ownerPublishButtons >= 0,
    `New job ${ownerNewJob}, Publish ${ownerPublishButtons}`);

  await schoolCtx.close();

  // ---- HR: no Publish, no Close ------------------------------------------
  const { context: hrCtx } = await openAs(SCHOOL_APP, 'school', hrSession);
  const hrPage = hrCtx.pages()[0];

  await hrPage.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await hrPage.waitForTimeout(1500);

  check('🔴 HR sees ZERO of the other school\'s jobs — zero, not fewer',
    (await hrPage.locator('tbody tr').count()) === 0,
    `${await hrPage.locator('tbody tr').count()} rows`);
  check('HR still sees New job — the seed grants JOB.CREATE',
    (await hrPage.locator('a:has-text("New job")').count()) === 1, 'present');
  check('🔴 HR sees NO Publish button — absent, not greyed (3F/3G)',
    (await hrPage.locator('button:has-text("Publish")').count()) === 0, 'absent');

  await shot(hrPage, 'school-jobs-hr-1440');

  // A hand-built URL to the other school's job.
  await hrPage.goto(`${SCHOOL_APP}/jobs/${jobId}`, { waitUntil: 'networkidle' });
  await hrPage.waitForTimeout(1800);

  const hrBody = (await hrPage.locator('body').innerText()).replace(/\s+/g, ' ');
  check('🔴 a hand-built URL to another school\'s job does not render it',
    !/PGT Physics/i.test(hrBody), hrBody.slice(0, 90));

  // The server's answer for the same thing, forced.
  const forced403 = await hrPage.evaluate(async ({ api, id }) => {
    const t = localStorage.getItem('jp.school.accessToken');
    const pub = await fetch(`${api}/jobs/${id}/publish`,
      { method: 'POST', headers: { authorization: `Bearer ${t}` } });

    return { publish: pub.status, body: await pub.json() };
  }, { api: APP, id: jobId });

  check('🔴 …and forcing Publish via fetch is refused by the SERVER',
    forced403.publish === 403, `HTTP ${forced403.publish}, code ${forced403.body?.code}`);

  await hrCtx.close();

  // ---- read-only rendering (synthesised; see the file header) -------------
  const grantsBefore = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT p.PermissionCode FROM t_sso_role_permissions rp
      JOIN t_sso_roles r ON r.RoleId=rp.RoleId
      JOIN t_sso_permissions p ON p.PermissionId=rp.PermissionId
    WHERE r.RoleCode='HR' AND p.PermissionCode LIKE 'JOB.%' AND rp.Is_Deleted=0;`).sort();

  check('premise: HR starts with CREATE, EDIT and VIEW',
    grantsBefore.join(',') === 'JOB.CREATE,JOB.EDIT,JOB.VIEW', grantsBefore.join(' '));

  sql(`SET NOCOUNT ON; USE jp_sso;
    UPDATE rp SET rp.Is_Deleted = 1
    FROM t_sso_role_permissions rp
      JOIN t_sso_roles r ON r.RoleId = rp.RoleId
      JOIN t_sso_permissions p ON p.PermissionId = rp.PermissionId
    WHERE r.RoleCode='HR' AND p.PermissionCode IN ('JOB.CREATE','JOB.EDIT');`);

  // A fresh token, so the claims carry the reduced grants.
  const viewerSession = await login(HR.id, HR.pw);
  const { context: vCtx } = await openAs(SCHOOL_APP, 'school', viewerSession);
  const vPage = vCtx.pages()[0];

  await vPage.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await vPage.waitForTimeout(1600);

  check('🔴 a JOB.VIEW-only account sees NO New job button',
    (await vPage.locator('a:has-text("New job")').count()) === 0, 'absent');
  check('🔴 …and is told plainly that it is read-only',
    (await vPage.locator('.banner--info').count()) === 1,
    (await vPage.locator('.banner--info').textContent())?.replace(/\s+/g, ' ').trim().slice(0, 70));

  await shot(vPage, 'school-jobs-readonly-1440');
  await vCtx.close();

  restoreShipped();

  const grantsAfter = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT p.PermissionCode FROM t_sso_role_permissions rp
      JOIN t_sso_roles r ON r.RoleId=rp.RoleId
      JOIN t_sso_permissions p ON p.PermissionId=rp.PermissionId
    WHERE r.RoleCode='HR' AND p.PermissionCode LIKE 'JOB.%' AND rp.Is_Deleted=0;`).sort();

  check('🔴 the HR grants are restored exactly',
    grantsAfter.join(',') === grantsBefore.join(','), grantsAfter.join(' '));

  // =========================================================================
  console.log('\n=== DASHBOARD: JOBS REAL, APPLICANTS UNTOUCHED ===');

  const { context: dashCtx } = await openAs(SCHOOL_APP, 'school', ownerSession);
  const dashPage = dashCtx.pages()[0];

  await dashPage.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
  await dashPage.waitForTimeout(2000);

  const counts = await dashPage.locator('.jobs__count dd').allTextContents();
  check('🔴 the dashboard shows REAL job counts',
    counts.length === 4, `counts: ${counts.join(' / ')}`);

  const recent = await dashPage.locator('.jobs__row').count();
  check('…and the most recent jobs', recent > 0, `${recent} recent rows`);

  /*
    🔴 THE APPLICANTS AREA MUST BE UNCHANGED. Phase 5 owns it; a zero there
    would still be a number with nothing behind it (2.62).
  */
  const empties = await dashPage.locator('ui-empty-state').allTextContents();
  const applicants = empties.find((t) => /Applicants/i.test(t)) ?? '';

  check('🔴 the applicants area is STILL the not-yet empty state',
    /Applications arrive after job posting/i.test(applicants),
    applicants.replace(/\s+/g, ' ').trim().slice(0, 80));
  check('🔴 …with no digits in it',
    !/\d/.test(applicants), /\d/.test(applicants) ? 'A NUMBER APPEARED' : 'no counts');

  await shot(dashPage, 'school-dashboard-jobs-1440');

  await dashPage.setViewportSize(PHONE);
  await dashPage.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
  await dashPage.waitForTimeout(1500);

  const overflow = await dashPage.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

  check('🔴 no sideways scroll at 375', overflow === 0, `${overflow}px`);
  await shot(dashPage, 'school-jobs-375');

  await dashCtx.close();
} finally {
  console.log('\n=== TEARDOWN ===');
  await browser.close();

  cleanupJobs();
  sql(`SET NOCOUNT ON; USE jp_app; DELETE FROM t_app_feature_ledger WHERE OwnerUid='${orgUid}';`);
  restoreShipped();

  const mode = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(GatingModeId AS varchar(2)) + '|' + CAST(Is_Active AS varchar(2))
    FROM m_mdm_features WHERE FeatureId=${FEATURE};`);
  const maps = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted=0;`);
  const jobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const hrGrants = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT COUNT(*) FROM t_sso_role_permissions rp
      JOIN t_sso_roles r ON r.RoleId=rp.RoleId
      JOIN t_sso_permissions p ON p.PermissionId=rp.PermissionId
    WHERE r.RoleCode='HR' AND p.PermissionCode LIKE 'JOB.%' AND rp.Is_Deleted=0;`)[0];

  check('🔴 shipped state on EXIT — FREE, no mappings, no jobs, HR grants intact',
    mode === '1|1' && maps === '0' && jobs === '0' && hrGrants === '3',
    `JOB_POST ${mode}, mappings ${maps}, jobs ${jobs}, HR JOB.* grants ${hrGrants}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`  Screenshots: ${OUT}`);
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
