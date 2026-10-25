/*
  PHASE 6.5B — THE BILLING SCREENS, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY        shipped state asserted; a fixture paid plan created
    1. THE PANEL    what the school is on, and what it has used of it
    2. 🔴 THE FLOW  request a plan -> "we have recorded it, pay by NEFT…"
                    and there is NO pay-now button anywhere
    3. 🔒 A VIEWER  sees the panel, and the request control is ABSENT with a
                    reason — 2.62's "not allowed", not a disabled button
    4. 🔴 FORCED    a viewer POSTing /plan-change by fetch            -> 403
    5. 🔴 FORCED    a school POSTing /payments/{id}/verify by fetch   -> 403
    6. 🔴 FORCED    a teacher asking for a SCHOOL plan by id          -> 404
    7. THE ADMIN    the queue, and the form with the mismatch visible
    8. 🔒 LAPSED    EndsOn in the past -> the screen SAYS the plan ended and
                    that the allowances shown are the free ones
    9. 375          both screens, measured on the document
   10. EXIT         the fixture gone, shipped state restored

  ----------------------------------------------------------------------------
  🔴 THE FIXTURE PAID PLAN IS A FIXTURE, NOT A SEED
  ----------------------------------------------------------------------------
  008_seed_plans.sql forbids seeding paid tiers in writing — a price we ship
  gets quoted back — and 011's build guard fails the build on a priced public
  plan. So this suite creates one, uses it, and removes it in the finally.

  Run (both APIs, jp-shared :4999, jp-school :4300, jp-teacher :4400,
       jp-admin :4200):
      node scripts/verify/billing-screens.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession, invalidate } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';
import { restoreCatalogue, catalogueState, catalogueSummary } from './lib/catalogue.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const ADMIN_APP = 'http://localhost:4200';
const SCHOOL_APP = 'http://localhost:4300';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

const ADMIN = { id: 'superadmin@teacherportal.local', pw: secret('superadmin@teacherportal.local') };
const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: secret('viewer@greenwood.edu.in') };
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

const FIXTURE_PLAN = 'BILLSCREEN_PRO';
const JOB_POST = 1;

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

/*
  🔴 RESTORES TO THE DOCUMENTED SHIPPED STATE, NOT TO WHAT IT FOUND.

  A previous run that died before teardown leaves dirty state, and capturing
  "the original" on entry would faithfully preserve the mess (entitlement-http
  records why). The shipped state is: two plans, every feature FREE, no
  mappings, every owner on its free plan.
*/
const restore = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    DELETE FROM m_mdm_plan_features;
    UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1 WHERE Is_Deleted = 0;

    DELETE FROM t_mdm_payment_receipts
     WHERE PaymentId IN (SELECT PaymentId FROM t_mdm_request_payments
                          WHERE PlanId IN (SELECT PlanId FROM m_mdm_plans
                                            WHERE PlanCode LIKE 'BILLSCREEN%'));

    DELETE FROM t_mdm_request_payments WHERE RequestId IN
      (SELECT RequestId FROM t_mdm_approval_requests WHERE RequestTypeId = 5);
    DELETE FROM t_mdm_approval_requests WHERE RequestTypeId = 5;
    DELETE FROM t_mdm_request_number_series WHERE RequestTypeId = 5;
    DELETE FROM t_mdm_receipt_number_series;

    DELETE FROM m_mdm_plans WHERE PlanCode LIKE 'BILLSCREEN%';`);

    /*
      🔴 AND THE REAL CATALOGUE BACK. The delete above clears THIS
      suite's mappings, which it must — but under 2.64 that WAS the
      shipped state, so nine suites "restored" it by leaving the table
      empty. SR-4 seeded a real catalogue, and leaving it empty became a
      delete of the product's pricing running twice per suite.
    */
    restoreCatalogue();

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE Notes LIKE 'billscreen%';

    DELETE FROM t_app_subscriptions WHERE SourcePaymentUid IS NOT NULL;

    UPDATE t_app_subscriptions
       SET StatusId = 1, Is_Active = 1, EndsOn = NULL,
           PlanId = CASE WHEN PlanId = 2 THEN 2 ELSE 1 END,
           ModifiedOn = NULL, ModifiedBy = NULL
     WHERE Is_Deleted = 0 AND SourcePaymentUid IS NULL;`);
};

/* 🔴 The owner the token resolves to — the organisation, by the same route. */
const ownerUid = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT LOWER(CAST(sc.OrganizationUid AS varchar(50)))
    FROM t_app_schools sc
    INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
   WHERE u.Email = '${OWNER.id}';`);

const planIdOf = (code) => Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(PlanId AS varchar(10)) FROM m_mdm_plans WHERE PlanCode = '${code}' AND Is_Deleted = 0;`));

let browser;
let fixturePlanId = 0;

try {
  // =========================================================================
  section('0. ENTRY — the shipped state, and one fixture plan');
  // =========================================================================

  restore();

  const priced = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans
     WHERE Price > 0 AND IsPublic = 1 AND IsDefault = 0 AND Is_Deleted = 0;`));

  /*
    🔴 INVERTED IN SR-4. 008 forbade priced public plans while pricing was
    unknown; the catalogue now ships two on purpose, both named
    "(SAMPLE PRICING)" until the real list arrives. What this asserts is the
    catalogue, not the absence of prices.
  */
  check('🔴 shipped state: the SR-4 catalogue is live',
    catalogueState().ok, catalogueSummary());

  /*
    🔒 The permission this phase added, asserted as a premise — the closed set
    is what 007's guard enforces, and the screens below depend on it.
  */
  const holders = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT STRING_AGG(r.RoleCode, ', ') WITHIN GROUP (ORDER BY r.RoleCode)
      FROM t_sso_role_permissions rp
      INNER JOIN t_sso_roles r ON r.RoleId = rp.RoleId AND r.Is_Deleted = 0
      INNER JOIN t_sso_permissions p ON p.PermissionId = rp.PermissionId
     WHERE p.PermissionCode = 'BILLING.MANAGE' AND rp.Is_Deleted = 0;`);

  check('🔒 premise: BILLING.MANAGE is held by SCHOOL_OWNER and TEACHER only',
    holders === 'SCHOOL_OWNER, TEACHER', holders);

  const owner = ownerUid();

  sql(`SET NOCOUNT ON; USE jp_mdm;
    INSERT INTO m_mdm_plans (PlanCode, UserTypeId, Name, DurationDays, Price, IsDefault, IsPublic, DisplayOrder)
    VALUES ('${FIXTURE_PLAN}', 2, N'Screens Pro', 30, 7500.00, 0, 1, 96);`);

  fixturePlanId = planIdOf(FIXTURE_PLAN);

  /* JOB_POST metered, so the panel has a real "used of allowed" to render. */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId = 3 WHERE FeatureId = ${JOB_POST};
    /*
      ⚠️ THE FIXTURE OWNS ITS ROWS SINCE SR-4. The catalogue seeds
      (SCHOOL_FREE, JOB_POST), so a bare INSERT hits the unique index and the
      suite dies at its fixture. Only these two pairs are cleared — the rest
      of the catalogue belongs to the seed, and restoreCatalogue() rebuilds
      these on the way out.
    */
    DELETE FROM m_mdm_plan_features
     WHERE FeatureId = ${JOB_POST} AND PlanId IN (1, ${fixturePlanId});

    INSERT INTO m_mdm_plan_features (PlanId, FeatureId, IsIncluded, QuotaPerPeriod)
    VALUES (1, ${JOB_POST}, 1, 3), (${fixturePlanId}, ${JOB_POST}, 1, 25);`);

  /*
    🔴 EVERY CACHED TOKEN FOR THESE ACCOUNTS IS THROWN AWAY FIRST.

    lib/login.mjs caches tokens on disk for twenty minutes (G34), and a
    PERMISSION lives in the token's claims — so a token minted before
    BILLING.MANAGE was granted does not carry it, and /auth/me serves the
    token's claims rather than re-reading the database.

    That cost a real debugging detour: the owner's request button was absent,
    USP_GetUserClaims returned BILLING.MANAGE correctly, the grant row was
    there, and the seed's own closed-set guard passed — because the only stale
    thing was a cached JWT.

    ⚠️ It is not a product bug: a permission change taking effect on the next
    token is ordinary JWT behaviour. But a suite whose result depends on WHEN
    its cache was filled is a suite that passes or fails for reasons unrelated
    to the code, so it starts from a known state.
  */
  [ADMIN, OWNER, VIEWER, TEACHER].forEach((who) => invalidate(who.id));

  const adminSession = await loginSession(ADMIN);
  const ownerSession = await loginSession(OWNER);
  const viewerSession = await loginSession(VIEWER);
  const teacherSession = await loginSession(TEACHER);

  /* One consume, so "used" is not zero and the meter has something to show. */
  await fetch(`${APP}/entitlements/consume`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminSession.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerUid: owner, featureCode: 'JOB_POST', units: 1,
      refEntityTypeId: 1, refEntityUid: '44444444-0000-0000-0000-000000000001',
      notes: 'billscreen',
    }),
  });

  check('fixture: a paid plan, a metered feature, and one unit already used',
    fixturePlanId > 0, `plan ${fixturePlanId}, free quota 3, pro quota 25`);

  browser = await chromium.launch();

  const openAs = async (app, key, session, url, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 150)}`));

    await page.goto(app, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.setItem(`jp.${k}.accessToken`, s.accessToken);
      localStorage.setItem(`jp.${k}.refreshToken`, s.refreshToken);
    }, { s: session, k: key });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    return { context, page, errors };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  // =========================================================================
  section('1. THE PANEL — what the school is on, and what it has used');
  // =========================================================================

  const { context: schoolCtx, page: school, errors: schoolErrors } =
    await openAs(SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/billing`);

  const panel = (await school.locator('.bill__current').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${panel.slice(0, 150)}"\n`);

  check('the panel names the plan the school is on',
    /Free/i.test(panel), panel.split(' ').slice(0, 3).join(' '));

  /*
    🔴 THE DERIVED NUMBERS, ON SCREEN. The engine computes used-against-allowed
    per period and stores neither (2.64) — this is the first screen in the
    product that shows them to the account itself.
  */
  check('🔴 …and shows what has been USED of it, against the allowance',
    /1 of 3/.test(panel), 'the one consume is counted: 1 of 3');

  check('…and says what is left, in words beside the meter',
    /2 left/.test(panel), '2 left');

  check('🔴 the meter is a progressbar with real aria values, not a bare div',
    (await school.locator('.bill__meter[role="progressbar"][aria-valuenow="1"]').count()) === 1,
    'aria-valuenow 1');

  check('…and no console error', schoolErrors.length === 0,
    schoolErrors.length ? schoolErrors[0] : 'none');

  await shot(school, 'school-billing-1440');

  // =========================================================================
  section('2. 🔴 THE FLOW — and there is NO pay-now button');
  // =========================================================================

  const pageText = () => school.locator('.page').innerText();

  const before = (await pageText()).replace(/\s+/g, ' ');

  /*
    🔒 THE ABSENCE THAT IS THE DESIGN.

    6.5 is manual-first. A "Pay online" control — enabled OR disabled — would
    be a promise nobody has made: 2.62's "not yet" requires saying WHEN, and
    there is no date. So the control does not exist, and the suite asserts its
    absence rather than trusting it.
  */
  check('🔒 there is NO pay-now control anywhere on the screen',
    !/pay now|pay online|pay by card|razorpay|stripe/i.test(before),
    'no gateway control, enabled or disabled');

  check('the fixture plan is offered in the catalog, with what it includes',
    /Screens Pro/i.test(before) && /25 per month/.test(before),
    'Screens Pro, 25 per month');

  await school.locator('.bill__plan').filter({ hasText: 'Screens Pro' })
    .locator('button').click();
  await school.waitForTimeout(900);

  const confirmText = (await school.locator('.bill__confirm').innerText()).replace(/\s+/g, ' ');

  console.log(`    "${confirmText.slice(0, 190)}"\n`);

  check('🔴 the confirmation says nothing changes until the payment is confirmed',
    /nothing changes/i.test(confirmText) && /keep what you have/i.test(confirmText),
    'the account keeps what it has until then');

  check('🔴 …and it offers only the modes that exist — no "Online"',
    /Bank transfer/i.test(confirmText) && /Cheque/i.test(confirmText)
      && /Cash/i.test(confirmText) && !/>Online</i.test(confirmText),
    'NEFT, cheque, cash');

  check('🔒 …and says why online is absent rather than leaving a short list',
    /not available yet/i.test(confirmText), 'stated, not implied');

  await shot(school, 'school-billing-confirm-1440');

  await school.locator('.bill__confirm button').filter({ hasText: /Record my request/i }).click();
  await school.waitForTimeout(3000);

  const after = (await pageText()).replace(/\s+/g, ' ');

  console.log(`    "${after.slice(0, 210)}"\n`);

  /*
    🔴 2.62's LANGUAGE, ASSERTED WORD BY WORD. The brief's words were "we've
    recorded your request — pay by NEFT/cheque/cash and admin will confirm".
  */
  check('🔴 the outcome says WE HAVE RECORDED IT, not "payment successful"',
    /recorded your request/i.test(after) && !/payment successful|paid/i.test(after),
    'recorded, not paid');

  check('🔴 …and says how to pay and who confirms it',
    /bank transfer, cheque or cash/i.test(after) && /administrator will confirm/i.test(after),
    'the actual next step');

  check('🔴 …and gives the reference to quote (2.46)',
    /PLN-\d{4}-\d{5}/.test(after), (after.match(/PLN-\d{4}-\d{5}/) ?? [''])[0]);

  check('🔒 …and the subscription is UNTOUCHED — pending grants nothing',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(PlanId AS varchar(10)) FROM t_app_subscriptions
       WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`) === '1',
    'still on plan 1');

  await shot(school, 'school-billing-requested-1440');

  // =========================================================================
  section('3. 🔒 A VIEWER — the panel, and the control ABSENT with a reason');
  // =========================================================================

  const { context: viewerCtx, page: viewerPage } =
    await openAs(SCHOOL_APP, 'school', viewerSession, `${SCHOOL_APP}/billing`);

  const viewerText = (await viewerPage.locator('.page').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    viewer sees: "${viewerText.slice(0, 160)}"\n`);

  /*
    🔴 THE PANEL STAYS VISIBLE, DELIBERATELY. An HR about to post a job needs
    to know this month's allowance; hiding it would mean discovering the limit
    by being refused by it. So the menu row carries no permission.
  */
  check('🔴 a viewer CAN see the panel — the allowance is not a privilege',
    (await viewerPage.locator('.bill__current').count()) === 1
      && /1 of 3/.test(viewerText),
    'panel rendered, usage shown');

  /*
    🔒 2.62's "NOT ALLOWED": the control is REMOVED and the reason given. A
    disabled button would say "not yet", which is false — it is never going to
    work for this person.
  */
  check('🔒 …and the request control is ABSENT, not disabled',
    (await viewerPage.locator('.bill__plan button').count()) === 0,
    `${await viewerPage.locator('.bill__plan button').count()} request button(s)`);

  check('🔒 …with the reason, and who to ask',
    /can see the plan but not change it/i.test(viewerText)
      && /whoever owns this account/i.test(viewerText),
    'explained once, not per card');

  check('…and no disabled button hiding somewhere on the page',
    (await viewerPage.locator('button[disabled]').count()) === 0,
    'nothing disabled');

  await shot(viewerPage, 'school-billing-viewer-1440');

  // =========================================================================
  section('4. 🔴 FORCED — a viewer POSTing the plan change by fetch');
  // =========================================================================

  const forcedByViewer = await viewerPage.evaluate(async ({ base, planId }) => {
    const token = localStorage.getItem('jp.school.accessToken');

    const r = await fetch(`${base}/billing/plan-change`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ planId, paymentModeId: 2 }),
    });

    return { status: r.status, body: await r.text() };
  }, { base: APP, planId: fixturePlanId });

  console.log(`\n    viewer forcing /plan-change: HTTP ${forcedByViewer.status} ${forcedByViewer.body.slice(0, 110)}\n`);

  /*
    🔴 THE POINT OF THE WHOLE SECTION. Removing the button is presentation;
    this is the protection. 6.5A shipped this endpoint with NO permission check
    at all, so before 6.5B this call SUCCEEDED and a read-only account could
    commit the school to a payment.
  */
  check('🔴 forcing the plan change as a VIEWER answers 403',
    forcedByViewer.status === 403, `HTTP ${forcedByViewer.status}`);

  check('🔒 …and the refusal names the permission\'s meaning, not its code',
    /permission to change/i.test(forcedByViewer.body),
    'a sentence, not "BILLING.MANAGE"');

  check('🔴 …and no request row was created by it',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_mdm_approval_requests
       WHERE RequestTypeId = 5 AND StatusId = 1;`) === '1',
    'still only the owner\'s one request');

  // =========================================================================
  section('5. 🔴 FORCED — a school POSTing the verify endpoint');
  // =========================================================================

  const paymentId = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(TOP_ID AS varchar(20)) FROM (
      SELECT TOP 1 PaymentId AS TOP_ID FROM t_mdm_request_payments
       WHERE PaymentStatusId = 1 AND Is_Deleted = 0 ORDER BY PaymentId DESC) x;`));

  const forcedVerify = await school.evaluate(async ({ base, id }) => {
    const token = localStorage.getItem('jp.school.accessToken');

    const r = await fetch(`${base}/billing/payments/${id}/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 7500, paymentModeId: 2 }),
    });

    return { status: r.status, body: await r.text() };
  }, { base: APP, id: paymentId });

  console.log(`    school forcing /verify on its OWN payment: HTTP ${forcedVerify.status}`);
  console.log(`      ${forcedVerify.body.slice(0, 110)}\n`);

  /*
    🔒 A SCHOOL CONFIRMING ITS OWN PAYMENT IS THE ENTIRE ATTACK, and it is the
    reason 006's guard asserts the closed set of PAYMENT.VERIFY holders rather
    than merely checking SUPER_ADMIN is among them.
  */
  check('🔒 a school confirming its OWN payment answers 403',
    forcedVerify.status === 403, `HTTP ${forcedVerify.status}`);

  check('🔴 …and the payment is still PENDING, untouched',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(PaymentStatusId AS varchar(3)) FROM t_mdm_request_payments
       WHERE PaymentId = ${paymentId};`) === '1',
    'PaymentStatusId 1');

  check('🔴 …and no receipt was minted',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_mdm_payment_receipts
       WHERE PaymentId = ${paymentId};`) === '0',
    'none');

  // =========================================================================
  section('6. 🔴 FORCED — a teacher asking for a SCHOOL plan');
  // =========================================================================

  const { context: teacherCtx, page: teacher } =
    await openAs(TEACHER_APP, 'teacher', teacherSession, `${TEACHER_APP}/billing`);

  const teacherText = (await teacher.locator('.page').innerText()).replace(/\s+/g, ' ');

  check('the teacher\'s own billing page renders from the SAME component',
    (await teacher.locator('.bill__current').count()) === 1,
    'one panel, same markup');

  check('🔒 …and the school\'s fixture plan is NOT in the teacher\'s catalog',
    !/Screens Pro/i.test(teacherText),
    'scoped by UserTypeId from the token (2.39)');

  const forcedCrossType = await teacher.evaluate(async ({ base, planId }) => {
    const token = localStorage.getItem('jp.teacher.accessToken');

    const r = await fetch(`${base}/billing/plan-change`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ planId, paymentModeId: 2 }),
    });

    return { status: r.status, body: await r.text() };
  }, { base: APP, planId: fixturePlanId });

  console.log(`\n    teacher forcing a SCHOOL plan id: HTTP ${forcedCrossType.status} ${forcedCrossType.body.slice(0, 100)}\n`);

  check('🔴 a teacher asking for a school plan by id answers 404',
    forcedCrossType.status === 404, `HTTP ${forcedCrossType.status}`);

  /*
    🔒 404 AND NOT 403 (2.6). A 403 would confirm the plan exists, and a
    teacher probing ids would learn the school tier line-up.
  */
  check('🔒 …404 and NOT 403 — a 403 would confirm the plan exists (2.6)',
    forcedCrossType.status !== 403 && /not found/i.test(forcedCrossType.body),
    'the refusal reveals nothing');

  await shot(teacher, 'teacher-billing-1440');

  // =========================================================================
  section('7. THE ADMIN — the queue, and the mismatch visible');
  // =========================================================================

  const { context: adminCtx, page: admin, errors: adminErrors } =
    await openAs(ADMIN_APP, 'admin', adminSession, `${ADMIN_APP}/billing/payments`);

  check('the payments queue lists the school\'s request',
    (await admin.locator('.table tbody tr').count()) >= 1,
    `${await admin.locator('.table tbody tr').count()} row(s)`);

  const queueRow = (await admin.locator('.table tbody tr').first().innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${queueRow}"\n`);

  check('…with the reference, the account kind, the plan and the expected amount',
    /PLN-/.test(queueRow) && /School/.test(queueRow) && /Screens Pro/.test(queueRow)
      && /7,500/.test(queueRow),
    'all four');

  check('…and no console error', adminErrors.length === 0,
    adminErrors.length ? adminErrors[0] : 'none');

  await shot(admin, 'admin-payments-queue-1440');

  await admin.locator('.table tbody tr').first().locator('button').click();
  await admin.locator('.pay__form').waitFor({ state: 'visible', timeout: 15_000 });
  await admin.waitForTimeout(900);

  const formText = () => admin.locator('.pay__form').innerText();

  check('🔴 the form opens pre-filled with the EXPECTED amount',
    (await admin.locator('#pay-amount').inputValue()) === '7500',
    `amount field = ${await admin.locator('#pay-amount').inputValue()}`);

  check('…and says so: it matches the plan price',
    /Matches the plan price/i.test(await formText()), 'no difference yet');

  /* ---- the mismatch ------------------------------------------------- */
  await admin.locator('#pay-amount').fill('7400');
  await admin.waitForTimeout(600);

  const mismatchText = (await formText()).replace(/\s+/g, ' ');

  console.log(`    at 7400: "${mismatchText.match(/₹[\d,.]+ (short|overpaid)/)?.[0] ?? '(no difference shown)'}"`);

  /*
    🔴 THE DIFFERENCE IN WORDS, NOT A SIGNED NUMBER. "₹100 short" and "₹100
    overpaid" are the two readings an admin must tell apart, and a bare "-100"
    invites exactly the wrong one.
  */
  check('🔴 a short amount shows the difference IN WORDS',
    /₹100\.00 short/.test(mismatchText), '₹100.00 short');

  check('🔴 …and the remark becomes REQUIRED, with the reason',
    /so please say why/i.test(mismatchText), 'asked, not just refused later');

  check('🔴 …and Confirm is disabled until it is given',
    await admin.locator('.pay__form button').filter({ hasText: /Confirm and activate/i }).isDisabled(),
    'disabled while the remark is missing');

  /* An OVERPAYMENT reads the other way round. */
  await admin.locator('#pay-amount').fill('7600');
  await admin.waitForTimeout(500);

  check('🔴 an OVERpayment says overpaid, not short — the sign is one answer',
    /₹100\.00 overpaid/.test((await formText()).replace(/\s+/g, ' ')),
    '₹100.00 overpaid');

  await admin.locator('#pay-amount').fill('7400');
  await admin.locator('#pay-remarks').fill('Bank deducted charges in transit');
  await admin.locator('#pay-ref').fill('UTR-SCREENS-1');
  await admin.waitForTimeout(500);

  check('…and enabled once the remark is there',
    !(await admin.locator('.pay__form button').filter({ hasText: /Confirm and activate/i }).isDisabled()),
    'enabled');

  await shot(admin, 'admin-payments-verify-1440');

  await admin.locator('.pay__form button').filter({ hasText: /Confirm and activate/i }).click();
  await admin.waitForTimeout(3500);

  const outcome = (await admin.locator('.page').innerText()).replace(/\s+/g, ' ');

  console.log(`    "${outcome.slice(0, 190)}"\n`);

  check('🔴 the confirmation reports the receipt number',
    /RCP-\d{4}-\d{5}/.test(outcome), (outcome.match(/RCP-\d{4}-\d{5}/) ?? [''])[0]);

  check('🔴 …and says the plan is ACTIVE — the seam ran end to end',
    /is active/i.test(outcome), 'activated');

  check('🔒 …and the subscription really moved, in the database',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(PlanId AS varchar(10)) FROM t_app_subscriptions
       WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`) === String(fixturePlanId),
    `plan ${fixturePlanId}`);

  check('…and the payment has left the queue',
    (await admin.locator('.table tbody tr').count()) === 0
      || !(await admin.locator('.table tbody tr').first().innerText()).includes('Screens Pro'),
    'gone');

  check('🔴 …and what ARRIVED is what was recorded, beside what was quoted',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(Amount AS varchar(20)) + ' of ' + CAST(PriceQuoted AS varchar(20))
        FROM t_mdm_request_payments WHERE PaymentId = ${paymentId};`) === '7400.00 of 7500.00',
    '7400.00 received, 7500.00 quoted');

  await shot(admin, 'admin-payments-confirmed-1440');

  // =========================================================================
  section('8. 🔒 LAPSED — the screen says the plan ended, and what applies now');
  // =========================================================================

  /* EndsOn at 00:00 IST today: the IST boundary case, with no job having run. */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions
       SET EndsOn = dbo.fn_IstDateToUtc(dbo.fn_IstToday())
     WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`);

  await school.goto(`${SCHOOL_APP}/billing`, { waitUntil: 'networkidle' });
  await school.waitForTimeout(2800);

  const lapsedText = (await school.locator('.page').innerText()).replace(/\s+/g, ' ');

  console.log(`\n    DB: inForce ${scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(dbo.fn_SubscriptionInForce(Is_Active, StatusId, EndsOn, SYSUTCDATETIME()) AS varchar(2))
        FROM t_app_subscriptions WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`)}`);
  console.log(`    "${lapsedText.slice(0, 200)}"\n`);

  /*
    🔒 6.5-C ON SCREEN. A lapsed paid subscription reads as the free baseline,
    so the numbers shown ARE the free plan's — and showing them under the paid
    plan's name would be the specific lie this phase was built to avoid.
  */
  check('🔒 the screen SAYS the paid plan ended, with the date',
    /paid plan ended on/i.test(lapsedText), 'named, not papered over');

  check('🔴 …and says the allowances shown are the FREE ones',
    /free plan/i.test(lapsedText) && /allowances below are the free ones/i.test(lapsedText),
    'the numbers are explained');

  check('🔒 …and reassures that nothing was deleted',
    /nothing was deleted/i.test(lapsedText), 'lapsing is a reduction, not a loss');

  check('🔴 …and the allowance really IS the free one, not the paid one',
    /of 3/.test(lapsedText) && !/of 25/.test(lapsedText),
    'free quota 3, not the paid 25');

  check('🔒 …and NOTHING was written to make that true — no sweeper ran',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(StatusId AS varchar(3)) + '|' + CAST(Is_Active AS varchar(3))
        FROM t_app_subscriptions WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`) === '1|1',
    'the row is still ACTIVE — expiry is derived');

  await shot(school, 'school-billing-lapsed-1440');

  // =========================================================================
  section('9. 375 — neither screen may scroll the page sideways');
  // =========================================================================

  /*
    🔴 THE ADMIN QUEUE MUST HAVE A ROW WHEN IT IS MEASURED.

    The first version measured it here, after section 7 confirmed the payment —
    so the queue was EMPTY and the check passed on a page with no table at all.
    A table is the single thing most likely to push a page sideways at 375, and
    a 375 check that quietly measures the empty state proves nothing. It is the
    same mistake the invitations suite made by measuring an ANSWERED row.

    So a second request is raised first, purely to put a row back in the queue.
    It is left PENDING and removed by the finally.
  */
  await school.goto(`${SCHOOL_APP}/billing`, { waitUntil: 'networkidle' });
  await school.waitForTimeout(2400);
  /*
    ⚠️ Whatever is on offer, not a named plan. By this point the school is ON
    Pro and LAPSED, so the catalog offers Pro again — which is exactly what
    section 8's banner invites ("you can move back to a paid plan whenever you
    like"). Naming a plan here made the click depend on which state the
    previous section left behind.
  */
  await school.locator('.bill__plan button').first().click();
  await school.waitForTimeout(800);
  await school.locator('.bill__confirm button').filter({ hasText: /Record my request/i }).click();
  await school.waitForTimeout(2800);

  const queued = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_mdm_request_payments
     WHERE PaymentStatusId = 1 AND Is_Deleted = 0;`));

  check('premise for the 375 pass: the admin queue has a row to render',
    queued >= 1, `${queued} pending payment(s)`);

  for (const [label, app, key, session, url, shotName, proof] of [
    ['school', SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/billing`,
      'school-billing-375', '.bill__current'],
    ['admin', ADMIN_APP, 'admin', adminSession, `${ADMIN_APP}/billing/payments`,
      'admin-payments-375', '.table tbody tr'],
  ]) {
    const { context: phoneCtx, page: phone } = await openAs(app, key, session, url, PHONE);

    const over = await phone.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));

    const present = await phone.locator(proof).count();

    console.log(`    ${label} at 375: document ${over.doc}px, viewport ${over.client}px,`
      + ` ${present} × ${proof}`);

    check(`🔴 the ${label} screen does not scroll the page sideways at 375`,
      over.doc <= over.client, `${over.doc} <= ${over.client}`);

    /*
      ⚠️ Asserted on the thing that would DO the overflowing, not on a node
      count: the school's plan panel and the admin's table row. A count is
      satisfied by an empty state, which is exactly how this check passed
      vacuously the first time.
    */
    check(`…and the ${label} screen's widest content IS present, so it is not vacuous`,
      present > 0, `${present} × ${proof}`);

    await shot(phone, shotName);
    await phoneCtx.close();
  }

  await schoolCtx.close();
  await viewerCtx.close();
  await teacherCtx.close();
  await adminCtx.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => {});

  section('10. EXIT — the fixture gone, the shipped state back');

  try {
    restore();

    /*
      ⚠️ WAS "NO priced public plan is left". That was 008's rule and 011
      enforced it; SR-4 replaced it with a closed set of four, two of which
      are priced on purpose. What must be true after this suite is that ITS
      OWN fixtures are gone — which is what 011's reshaped guard checks at
      build time, and what this checks here.
    */
    /*
      ⚠️ THE QUESTION CHANGED WITH THE PRODUCT. This counted PRICED PUBLIC
      plans and expected zero, which was 008's rule. The catalogue now ships
      two priced plans on purpose, so counting them says nothing — what must
      be true is that THIS suite's BILLSCREEN fixtures are gone.
    */
    const strays = scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans
       WHERE PlanCode LIKE 'BILLSCREEN%' AND Is_Deleted = 0;`);

    check('🔴 exit: this suite left no plan fixture behind',
      strays === '0', `${strays} BILLSCREEN plan(s) left`);

    /*
      🔴 WAS "every feature FREE again, no mappings (2.64)". SR-4 ships a
      catalogue, so an empty table is no longer the restored state — it is the
      state that means this suite ate the product's pricing.
    */
    check('🔴 exit: the SR-4 catalogue is back, intact',
      catalogueState().ok, catalogueSummary());

    check('exit: the school is back on the free plan, in force',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(PlanId AS varchar(6)) + '|'
             + CAST(dbo.fn_SubscriptionInForce(Is_Active, StatusId, EndsOn, SYSUTCDATETIME()) AS varchar(2))
          FROM t_app_subscriptions
         WHERE OwnerUid = '${ownerUid()}' AND StatusId = 1 AND Is_Deleted = 0;`) === '1|1',
      'plan 1, in force');

    check('exit: no subscription sourced from a suite payment is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_subscriptions
         WHERE SourcePaymentUid IS NOT NULL AND Is_Deleted = 0;`) === '0',
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
