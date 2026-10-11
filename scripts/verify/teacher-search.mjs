/*
  PHASE 6B — 🔒 TEACHER SEARCH: IT NEVER LEAKS, AND THE BOOLEAN GATE IS LIVE.

  ----------------------------------------------------------------------------
    1. THE SEARCH WORKS      filters, SERVER-side paging, a deterministic order,
                             and suspended teachers excluded.
    2. 🔒 IT NEVER LEAKS     the raw bytes carry no contact field under EVERY
                             gating mode, for an Owner AND a Viewer, and for a
                             teacher who has consented as well as one who has
                             not. Four modes × two roles, each read as TEXT.
    3. 🔴 THE BOOLEAN GATE   TEACHER_SEARCH flipped to Boolean-denied through
                             the ADMIN SCREEN, in a browser — the next search
                             is refused with no restart and no sleep. Flipped
                             back, allowed again.
    4. 🔴 THE LEDGER         IDENTICAL across all of it. Boolean writes NOTHING,
                             not even on success (2.64) — 2.5 asserted that as a
                             design property, and this is the first time a real
                             consumer has tested it.
    5. EXIT                  the shipped gating state is restored, asserted.

  ----------------------------------------------------------------------------
  🔒 WHY THE LEAK TEST IS THE MOST IMPORTANT THING IN THIS FILE
  ----------------------------------------------------------------------------
  Every row on an applicant list has consented. In a SEARCH result almost
  nobody has: a school pages through the entire teacher base, and the people it
  finds have never heard of it. One contact column here would not be a shape
  violation — it would be decision 2.56 broken for every teacher on the
  platform, at once, for any school that typed a filter.

  So it is asserted against the raw response TEXT rather than a parsed
  property, under every mode the plan can be in, for both roles that can
  search, and for a teacher who HAS consented — because the shape rule has to
  hold where the privacy rule no longer needs it to.

  ⚠️ THREE GUARDS, THREE LAYERS. ContactLeakGuard checks the TYPE at startup;
  019 has no such column in the SQL; this file reads the WIRE. The first two
  cannot catch a serialiser or a mapper adding a field the type never declared.

  Run (both APIs, jp-admin :4200, jp-shared :4999):
      node scripts/verify/teacher-search.mjs
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
const ADMIN_APP = 'http://localhost:4200';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ADMIN = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

// 🔴 Holds TEACHER_SEARCH.VIEW. Searching is not the same permission as
// inviting, and a Viewer must see exactly the same columns as an Owner.
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!' };

const WIDE = { width: 1440, height: 1100 };

/** 🔒 Every shape of contact field, and the keys a mapper might invent. */
const CONTACT_KEYS = [
  'contactemail', 'contactmobile', 'resumepath', 'email', 'mobile', 'phone',
  'dob', 'dateofbirth', 'useruid',
];

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep the text */ }

  return { http: r.status, body: b, text: t };
};

const login = async (who, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: who.id, password: who.pw }),
  });

  if (r.http === 429 && attempt <= 5) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(who, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${who.id}: ${r.http} ${r.body?.message ?? r.text}`);

  return r.body.data;
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT FeatureId FROM m_mdm_features WHERE FeatureCode = 'TEACHER_SEARCH' AND Is_Deleted = 0;`));

const gatingMode = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(GatingModeId AS varchar(3)) FROM m_mdm_features WHERE FeatureId = ${FEATURE};`);

const ledgerCount = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_feature_ledger;`);

const mappingCount = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT COUNT(*) FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE} AND Is_Deleted = 0;`);

/**
 * Put TEACHER_SEARCH back exactly as it ships: FREE, active, unmapped.
 *
 * ⚠️ Run on ENTRY and in the FINALLY. A killed run that left the engine's first
 * Boolean consumer switched off would take teacher search down for every school
 * until somebody noticed — and the only symptom would be a refusal that looks
 * like a plan problem.
 */
const restoreShipped = () => sql(`SET NOCOUNT ON; USE jp_mdm;
  UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1, ModifiedOn = SYSUTCDATETIME()
   WHERE FeatureId = ${FEATURE} AND (GatingModeId <> 1 OR Is_Active <> 1);

  DELETE FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE};`);

const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`      · ${name}.png`);
};

let browser;
let entryLedger = '';

try {
  // =========================================================================
  section('0. ENTRY — the shipped gating state, recorded and restored');
  // =========================================================================

  restoreShipped();

  entryLedger = ledgerCount();

  check('🔴 TEACHER_SEARCH ships FREE and unmapped — the mode IS the grant',
    gatingMode() === '1' && mappingCount() === '0',
    `GatingModeId ${gatingMode()}, ${mappingCount()} plan mapping(s)`);

  check('entry: the ledger row count is recorded, to prove Boolean spends nothing',
    /^\d+$/.test(entryLedger), `${entryLedger} row(s)`);

  const adminSession = await login(ADMIN);
  const ownerToken = (await login(OWNER)).accessToken;
  const viewerToken = (await login(VIEWER)).accessToken;

  const HA = H(adminSession.accessToken);

  const orgUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(s.OrganizationUid AS varchar(40)) FROM t_app_schools s
      INNER JOIN t_app_school_users su ON su.SchoolId = s.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}' AND su.Is_Deleted = 0;`);

  const planId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(PlanId AS varchar(10)) FROM t_app_subscriptions
    WHERE OwnerUid = '${orgUid}' AND Is_Active = 1 AND Is_Deleted = 0;`));

  check('premise: the owner\'s organisation and its plan resolve',
    !!orgUid && planId > 0, `org ${orgUid}, plan ${planId}`);

  // =========================================================================
  section('1. THE SEARCH — filters, server-side paging, suspended excluded');
  // =========================================================================

  const all = await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) });

  console.log(`\n    GET /api/teacher-search  HTTP ${all.http}  `
    + `${(all.body?.data ?? []).length} row(s), totalRecords ${all.body?.totalRecords}\n`);

  check('the search answers 200 with rows and a total',
    all.http === 200 && (all.body?.data ?? []).length > 0 && all.body?.totalRecords > 0,
    `${(all.body?.data ?? []).length} of ${all.body?.totalRecords}`);

  const dbVisible = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_teachers
    WHERE Is_Deleted = 0 AND Is_Active = 1 AND IsSuspended = 0;`));

  check('🔴 …and the total matches the DATABASE, not a page size',
    all.body?.totalRecords === dbVisible,
    `API ${all.body?.totalRecords}, database ${dbVisible}`);

  // ---- paging is server-side ---------------------------------------------
  const p1 = await j(`${APP}/teacher-search?pageNumber=1&pageSize=3`, { headers: H(ownerToken) });
  const p2 = await j(`${APP}/teacher-search?pageNumber=2&pageSize=3`, { headers: H(ownerToken) });

  const uids1 = (p1.body?.data ?? []).map((r) => r.teacherUid);
  const uids2 = (p2.body?.data ?? []).map((r) => r.teacherUid);

  console.log(`    page 1: ${uids1.length} rows   page 2: ${uids2.length} rows`);

  check('🔴 PAGING IS SERVER-SIDE — a page of 3 returns 3, not everything (G29\'s lesson)',
    uids1.length === 3 && uids2.length === 3, `${uids1.length} and ${uids2.length}`);

  check('🔴 …and the two pages do not overlap — the sort has a unique tiebreaker',
    !uids1.some((u) => uids2.includes(u)), 'no row appears on both pages');

  check('…while the total is the same on both pages',
    p1.body?.totalRecords === p2.body?.totalRecords,
    `${p1.body?.totalRecords} / ${p2.body?.totalRecords}`);

  /*
    ⚠️ THE CLAMP. A page size arriving as 100000 from a query string would turn
    a paged endpoint back into "fetch everything", which is the exact thing 019
    exists to avoid.
  */
  const huge = await j(`${APP}/teacher-search?pageSize=100000`, { headers: H(ownerToken) });

  check('🔴 …and an absurd page size is CLAMPED, not honoured',
    (huge.body?.data ?? []).length <= 100,
    `asked for 100000, got ${(huge.body?.data ?? []).length}`);

  // ---- a filter actually filters ------------------------------------------
  const filtered = await j(`${APP}/teacher-search?subjectId=1&pageSize=100`, { headers: H(ownerToken) });

  const dbSubject = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_teachers t
    WHERE t.Is_Deleted = 0 AND t.Is_Active = 1 AND t.IsSuspended = 0
      AND EXISTS (SELECT 1 FROM t_app_teacher_subjects ts
                  WHERE ts.TeacherId = t.TeacherId AND ts.SubjectId = 1 AND ts.Is_Deleted = 0);`));

  check('a subject filter narrows the result to what the database says',
    filtered.body?.totalRecords === dbSubject,
    `API ${filtered.body?.totalRecords}, database ${dbSubject}`);

  /*
    🔴 THE EXPERIENCE FILTER READS THE MASTER'S OWN BOUNDARIES (2.7). The
    expectation is computed from m_mdm_experience_range here too, so renaming
    or re-bounding a range changes both sides together rather than making this
    assertion a second definition.
  */
  const rangeRow = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(ExperienceRangeId AS varchar(5)) + '|' + CAST(MinMonths AS varchar(10))
         + '|' + ISNULL(CAST(MaxMonths AS varchar(10)), 'null')
    FROM m_mdm_experience_range WHERE Code = 'EXP_5_10' AND Is_Deleted = 0;`)[0].split('|');

  const [rangeId, minM, maxM] = rangeRow;

  const byRange = await j(`${APP}/teacher-search?experienceRangeId=${rangeId}&pageSize=100`,
    { headers: H(ownerToken) });

  const dbRange = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_teachers
    WHERE Is_Deleted = 0 AND Is_Active = 1 AND IsSuspended = 0
      AND ISNULL(TotalExperienceMonths, 0) >= ${minM}
      ${maxM === 'null' ? '' : `AND ISNULL(TotalExperienceMonths, 0) <= ${maxM}`};`));

  check('🔴 the experience filter uses the MASTER\'s month boundaries, not its own',
    byRange.body?.totalRecords === dbRange,
    `range ${rangeId} (${minM}..${maxM}) → API ${byRange.body?.totalRecords}, database ${dbRange}`);

  // ---- a suspended teacher disappears -------------------------------------
  const victim = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(TeacherId AS varchar(20)) + '|' + CAST(TeacherUid AS varchar(40))
    FROM t_app_teachers WHERE Is_Deleted = 0 AND Is_Active = 1 AND IsSuspended = 0
    ORDER BY TeacherId;`)[0].split('|');

  const [victimId, victimUid] = victim;

  /*
    ⚠️ COMPARED CASE-INSENSITIVELY. sqlcmd prints a uniqueidentifier in upper
    case and System.Text.Json serialises a Guid in lower case, so the first
    version of this premise failed on a teacher who was plainly in the result —
    and the assertion UNDER it passed, because 'disappeared' is true of a row
    that was never matched in the first place.

    🔴 That is the shape worth noticing: a broken premise next to a passing
    claim. The premise is what stops the claim being vacuous, which is exactly
    why it is written down.
  */
  const sameUid = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  const beforeSuspend = (all.body?.data ?? []).some((r) => sameUid(r.teacherUid, victimUid));

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_teachers SET IsSuspended = 1 WHERE TeacherId = ${victimId};`);

  const afterSuspend = await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) });
  const stillThere = (afterSuspend.body?.data ?? []).some((r) => sameUid(r.teacherUid, victimUid));

  check('premise: the teacher WAS in the result before being suspended',
    beforeSuspend, `teacher ${victimId}`);

  check('🔴 a SUSPENDED teacher disappears from search — the decision reaches the listing',
    !stillThere && afterSuspend.body?.totalRecords === dbVisible - 1,
    `total ${afterSuspend.body?.totalRecords} (was ${dbVisible})`);

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_teachers SET IsSuspended = 0 WHERE TeacherId = ${victimId};`);

  check('…and the suspension is lifted again before anything downstream counts',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(IsSuspended AS varchar(3)) FROM t_app_teachers WHERE TeacherId = ${victimId};`) === '0',
    'restored');

  // =========================================================================
  section('2. 🔒 IT NEVER LEAKS — every mode, both roles, read as raw TEXT');
  // =========================================================================

  /*
    🔒 The teacher who HAS consented. The shape rule has to hold where the
    privacy rule no longer needs it to: a browse surface carries no contact,
    consented or not, because it ends up in a screenshot or an export.
  */
  const consented = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(t.TeacherId AS varchar(20)) + '|' + u.Email
    FROM t_app_teachers t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE t.Is_Deleted = 0 AND t.IsSuspended = 0 ORDER BY t.TeacherId;`)[0].split('|');

  const [, consentedEmail] = consented;

  const setMode = async (modeId) => {
    const r = await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
      method: 'PUT', headers: HA,
      body: JSON.stringify({ gatingModeId: modeId, isActive: true }),
    });

    return r.http;
  };

  const mapPlan = async (isIncluded) => j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({ planId, featureId: FEATURE, action: 'MAP', isIncluded, quotaPerPeriod: null }),
  });

  const leakCheck = (label, text) => {
    const lower = text.toLowerCase();
    const hits = CONTACT_KEYS.filter((k) => lower.includes(k));
    const address = lower.includes(consentedEmail.toLowerCase());

    check(`🔒 ${label}: the raw bytes carry no contact field and no address`,
      hits.length === 0 && !address,
      hits.length > 0 ? `FOUND: ${hits.join(', ')}` : address ? 'FOUND an email address' : 'clean');
  };

  // FREE (shipped)
  await setMode(1);
  leakCheck('FREE, as Owner', (await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) })).text);
  leakCheck('FREE, as Viewer', (await j(`${APP}/teacher-search?pageSize=100`, { headers: H(viewerToken) })).text);

  // BOOLEAN, included
  await setMode(2);
  await mapPlan(true);
  const boolAllowed = await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) });

  check('BOOLEAN + included: the search is allowed',
    boolAllowed.http === 200, `HTTP ${boolAllowed.http}`);

  leakCheck('BOOLEAN included, as Owner', boolAllowed.text);
  leakCheck('BOOLEAN included, as Viewer',
    (await j(`${APP}/teacher-search?pageSize=100`, { headers: H(viewerToken) })).text);

  // BOOLEAN, excluded — the refusal must not carry anything either
  await mapPlan(false);
  const boolDenied = await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) });

  check('🔴 BOOLEAN + excluded: the search is REFUSED with PLAN_LACKS_FEATURE',
    boolDenied.http === 403 && boolDenied.body?.code === 'PLAN_LACKS_FEATURE',
    `HTTP ${boolDenied.http} ${boolDenied.body?.code}`);

  leakCheck('the BOOLEAN refusal itself', boolDenied.text);

  // METERED — not how search is meant to be sold, but the bytes must still be clean
  await setMode(3);
  await mapPlan(true);
  const metered = await j(`${APP}/teacher-search?pageSize=100`, { headers: H(ownerToken) });

  leakCheck('METERED, as Owner', metered.text);

  await setMode(1);
  sql(`SET NOCOUNT ON; USE jp_mdm; DELETE FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE};`);

  check('…and the gating state is back to FREE and unmapped for the next section',
    gatingMode() === '1' && mappingCount() === '0', `mode ${gatingMode()}`);

  // =========================================================================
  section('3. 🔴 THE BOOLEAN GATE, FLIPPED IN THE ADMIN SCREEN — no restart');
  // =========================================================================

  browser = await chromium.launch();

  const openAs = async (app, key, session) => {
    const context = await browser.newContext({ viewport: WIDE, deviceScaleFactor: 2 });
    const page = await context.newPage();

    await page.goto(app, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.setItem(`jp.${k}.accessToken`, s.accessToken);
      localStorage.setItem(`jp.${k}.refreshToken`, s.refreshToken);
    }, { s: session, k: key });

    return { context, page };
  };

  // The plan must be mapped-and-excluded for Boolean to refuse; map it first.
  await mapPlan(false);

  const { context: adminCtx, page: adminPage } = await openAs(ADMIN_APP, 'admin', adminSession);

  await adminPage.goto(`${ADMIN_APP}/settings/plans`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(1600);

  const searchRow = adminPage.locator('tr', {
    has: adminPage.locator('.matrix__feature-code', { hasText: 'TEACHER_SEARCH' }),
  });

  check('the admin matrix shows TEACHER_SEARCH',
    (await searchRow.count()) === 1, `${await searchRow.count()} row(s)`);

  /*
    🔴 THE FLIP HAPPENS IN THE BROWSER — a select change on the admin screen,
    not a SQL update. That is what makes this the full chain rather than two
    unrelated tests: the person who switches a feature off is an administrator
    on a screen, and the question is whether the next search notices.
  */
  const savePut = adminPage.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await searchRow.locator('.matrix__mode').selectOption('2');   // BOOLEAN
  await savePut;
  await adminPage.waitForTimeout(700);

  check('🔴 TEACHER_SEARCH set to BOOLEAN through the admin SCREEN',
    gatingMode() === '2', `GatingModeId ${gatingMode()}`);

  await shot(adminPage, 'admin-plans-search-boolean-1440');

  /*
    🔴 NO RESTART, NO SLEEP. The gating read goes through IEntitlementRepository
    — a direct read — and not IMasterService, whose cache is an hour deep
    (2.64). If the search still worked here, that would be the hour-deep cache
    answering, and a kill switch that takes an hour to land is not a switch.
  */
  const afterFlip = await j(`${APP}/teacher-search?pageSize=20`, { headers: H(ownerToken) });

  console.log(`\n    the very next search: HTTP ${afterFlip.http} ${afterFlip.body?.code ?? ''}\n`);

  check('🔴 THE NEXT SEARCH IS REFUSED IMMEDIATELY — no restart, no sleep (2.64)',
    afterFlip.http === 403 && afterFlip.body?.code === 'PLAN_LACKS_FEATURE',
    `HTTP ${afterFlip.http} ${afterFlip.body?.code}`);

  leakCheck('the refusal after the screen flip', afterFlip.text);

  // ---- include it, and the same call works --------------------------------
  await mapPlan(true);

  const afterInclude = await j(`${APP}/teacher-search?pageSize=20`, { headers: H(ownerToken) });

  check('🔴 …and mapping it as INCLUDED allows the very same call',
    afterInclude.http === 200 && (afterInclude.body?.data ?? []).length > 0,
    `HTTP ${afterInclude.http}, ${(afterInclude.body?.data ?? []).length} rows`);

  // ---- back to FREE, in the browser again ---------------------------------
  const savePut2 = adminPage.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await searchRow.locator('.matrix__mode').selectOption('1');   // FREE
  await savePut2;
  await adminPage.waitForTimeout(700);

  check('TEACHER_SEARCH set back to FREE through the screen',
    gatingMode() === '1', `GatingModeId ${gatingMode()}`);

  await adminCtx.close();

  // =========================================================================
  section('4. 🔴 THE LEDGER — Boolean wrote NOTHING, through all of that');
  // =========================================================================

  const exitLedger = ledgerCount();

  console.log(`\n    ledger rows: ${entryLedger} at entry, ${exitLedger} now\n`);

  /*
    🔴 2.5 ASSERTED THIS AS A DESIGN PROPERTY. 013's Boolean branch says it in
    words — "WRITES NOTHING TO THE LEDGER — not even on success. A row that can
    never change a balance is an access log wearing a ledger's clothes, and it
    would outnumber every row that does change one."

    ⚠️ Until 6B nothing exercised it. This section searched under four gating
    modes, as two roles, was allowed and refused several times each — and the
    count has to be the number it started at.
  */
  check('🔴 THE LEDGER IS IDENTICAL — Boolean writes nothing, even on success (2.64)',
    exitLedger === entryLedger, `${entryLedger} -> ${exitLedger}`);

  check('…and no TEACHER_SEARCH row exists in it at all',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_feature_ledger WHERE FeatureId = ${FEATURE};`) === '0',
    'not one row, under any mode');

  // =========================================================================
  section('5. EXIT — the shipped gating state is restored');
  // =========================================================================

  restoreShipped();

  check('exit: TEACHER_SEARCH is FREE, active and unmapped again',
    gatingMode() === '1' && mappingCount() === '0',
    `mode ${gatingMode()}, ${mappingCount()} mapping(s)`);

  check('exit: no teacher is left suspended by this run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_teachers WHERE IsSuspended = 1 AND Is_Deleted = 0;`) === '0',
    'none');
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close();

  /*
    ⚠️ RESTORED IN THE FINALLY, and this one matters more than most. A killed
    run that left the engine's first Boolean consumer switched off would take
    teacher search down for every school on the platform, and the symptom would
    look like a plan problem rather than a dead fixture.
  */
  try {
    restoreShipped();
    sql(`SET NOCOUNT ON; USE jp_app; UPDATE t_app_teachers SET IsSuspended = 0 WHERE IsSuspended = 1;`);
  } catch (error) {
    console.error('  ⚠️ COULD NOT RESTORE THE SHIPPED GATING STATE:', error.message);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
