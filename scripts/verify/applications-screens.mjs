/*
  PHASE 5B — the application screens in a real browser, and the owed negatives.

  ----------------------------------------------------------------------------
    1. 🔒 THE CONSENT BOUNDARY   the teacher applies by CLICKING, and the
                                 school's screen changes. Contact is absent
                                 from the LIST's bytes and present on the
                                 DETAIL — for the applied-to school only.
    2. THE MASTER                the Stage dropdown's options matched against
                                 the actual /api/masters/application-status
                                 RESPONSE off the wire — not a list this file
                                 knows. The offer chain must NOT be offered.
    3. THE SNAPSHOT              apply -> replace the resume -> the school
                                 still opens the ORIGINAL bytes while the
                                 teacher's own profile serves the new ones.
    4. THE MACHINE               the buttons ARE the server's
                                 allowedTransitions; a Rejected application
                                 has none; forced illegal moves are refused.
    5. EXPIRED                   a job past its closing date does not list,
                                 its page is gone, and a forced apply is
                                 refused with JOB_EXPIRED.
    6. RESUME-LESS               refused in place with the link to the profile
                                 — then the SAME apply succeeds after upload.
    7. SCOPE                     teacher A -> teacher B's application 404;
                                 school 2 -> school 4's applicant 404 and a
                                 list of zero; a branch-bound account sees one
                                 campus and not the other.
    8. PERMISSIONS               a Viewer gets no status buttons and no resume
                                 button; both forced requests are refused.
    9. DASHBOARDS                both areas real, on both sides.
   10. THE MOCKUP                gone from the repo AND from the bundle, and
                                 its menu row is visible again.

  ----------------------------------------------------------------------------
  🔴 WHY SO MANY OF THESE ARE "FORCED"
  ----------------------------------------------------------------------------
  Hiding is not protecting. Every screen-level assertion about something being
  absent is paired with the request a person could make anyway — from devtools,
  from curl, from a stale tab — and the SERVER's answer is what is asserted.
  A suite that only checked the rendering would pass just as happily against a
  product that drew nothing and enforced nothing.

  ----------------------------------------------------------------------------
  ⚠️ FIXTURES ARE NAMED, ASSERTED ON ENTRY, AND REMOVED ON EXIT
  ----------------------------------------------------------------------------
  Everything this file creates is titled `5B …`. Entry asserts the database
  starts where the shipped state says it does; exit asserts nothing of ours is
  left. Three times in this project a fixture that outlived its assertions has
  broken a count in a different section — the 2.5 period-boundary rows, the 4B
  ledger owner, and 5A's unverified teacher.

  ----------------------------------------------------------------------------
  ⚠️ THE LOGIN RATE LIMITER WILL STOP THIS SUITE IF YOU RE-RUN IT REPEATEDLY
  ----------------------------------------------------------------------------
  Sign-in is capped at 5/min per IP and 10/hour per identifier. This file signs
  in six accounts — four of them through the real form — so two or three runs
  back to back exhaust `principal@greenwood.edu.in` for the hour. It then looks
  exactly like a broken sign-in screen: the form sits there and the navigation
  never happens.

  signIn() retries with a wait, which clears the per-minute cap. The per-HOUR
  cap it cannot wait out — restart JP.Sso.Api, whose limiter is in memory, or
  come back later. Do not "fix" it by loosening the limiter.

  Run (jp-shared :4999, jp-school :4300, jp-teacher :4400, both APIs):
      node scripts/verify/applications-screens.mjs
*/
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';
const SCHOOL_APP = 'http://localhost:4300';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const HR = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!' };

// 🔴 UNVERIFIED, and with a resume. Chosen deliberately: this suite proves in
// the UI what 5A proved at the procedure — the badge is a signal, never a gate
// (2.9, a locked stance).
const TEACHER_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

// No resume, 0% profile. The RESUME_REQUIRED path, and the scope negative.
const TEACHER_B = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };

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

  return r.body.data.accessToken;
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const auth = (t) => ({ authorization: `Bearer ${t}` });

/** Two distinguishable, structurally valid PDFs — magic bytes are checked. */
const pdf = (marker) => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`
  + `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`
  + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n`
  + `% ${marker}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  'latin1',
);

const FIRST_RESUME = pdf('5B-ORIGINAL-RESUME-SENT-WITH-THE-APPLICATION');
const SECOND_RESUME = pdf('5B-REPLACEMENT-UPLOADED-AFTER-APPLYING');

// ---------------------------------------------------------------------------
// Cleanup. Runs on entry AND on exit — a killed run must not poison the next.
// ---------------------------------------------------------------------------
const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DECLARE @jobs TABLE (JobId bigint);
  INSERT INTO @jobs SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '5B %';

  DELETE FROM t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM @jobs));
  DELETE FROM t_app_applications    WHERE JobId IN (SELECT JobId FROM @jobs);
  DELETE FROM t_app_saved_jobs      WHERE JobId IN (SELECT JobId FROM @jobs);
  DELETE FROM t_app_job_subjects    WHERE JobId IN (SELECT JobId FROM @jobs);
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM @jobs);
  DELETE FROM t_app_feature_ledger
   WHERE RefEntityUid IN (SELECT JobUid FROM t_app_jobs WHERE JobId IN (SELECT JobId FROM @jobs));
  DELETE FROM t_app_jobs            WHERE JobId IN (SELECT JobId FROM @jobs);

  DELETE FROM t_app_school_branches WHERE BranchName LIKE '5B %';`);

/*
  ------------------------------------------------------------------------------
  🔴 THIS SUITE OWNS TWO TEACHERS' RESUME STATE, AND PUTS IT BACK.
  ------------------------------------------------------------------------------
  ⚠️ The first run of this file did not, and it permanently changed a seeded
  account: TEACHER_B is documented in local-accounts.md as "a name and a state,
  0%" — the brand-new teacher that breaks screens built against complete data —
  and the resume this suite uploaded to prove RESUME_REQUIRED left them at 25%
  with a CV. The next run then failed, correctly, because the premise it
  asserts had stopped being true.

  That is the FOURTH time in this project a fixture has outlived the assertion
  it was made for (the 2.5 period rows, the 4B ledger owner, 5A's unverified
  teacher, now this). The rule that keeps falling out of it: a suite that
  mutates shared data must restore it in the same file, in a finally, not
  promise to.

  TEACHER_A keeps a resume either way — their documented state is 90% WITH one —
  so only the file behind it changes, and the path captured on entry goes back.
*/
const restoreTeachers = (snapshot) => {
  for (const line of snapshot) {
    const [email, path] = line.split('|');

    sql(`SET NOCOUNT ON; USE jp_app;
      UPDATE t SET t.ResumePath = ${path ? `'${path.replace(/'/g, "''")}'` : 'NULL'}
      FROM t_app_teachers t
        INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
      WHERE u.Email = '${email}';`);

    const teacherId = scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(t.TeacherId AS varchar(20)) FROM t_app_teachers t
        INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
      WHERE u.Email = '${email}';`);

    // The percent is DERIVED (2.54 — capped at 75 with no resume), so it is
    // recomputed rather than written back from a captured number.
    sql(`SET NOCOUNT ON; USE jp_app; EXEC USP_RecalculateTeacherProfile @TeacherId = ${teacherId};`);
  }
};

const teacherResumeState = () => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT u.Email + '|' + ISNULL(t.ResumePath, '')
  FROM t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email IN ('${TEACHER_A.id}', '${TEACHER_B.id}')
  ORDER BY u.Email;`);

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`      · ${name}.png`);
};

/**
 * Sign in through the real form, the way jobs-screens.mjs does.
 *
 * ⚠️ RETRIES ON THE RATE LIMITER. Login is capped at 5/min per IP, and a suite
 * that signs several accounts in back to back WILL hit it — the form then
 * simply stays where it is, which times out as "the page never navigated" and
 * looks like a broken screen. It is not; it is the limiter doing its job.
 */
const signIn = async (page, origin, who, attempt = 1) => {
  await page.goto(`${origin}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('#loginId', who.id);
  await page.fill('#password', who.pw);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 20_000 });
  } catch (error) {
    if (attempt > 4) throw error;

    console.log(`  … ${who.id} did not get in (probably rate limited); waiting 25s (attempt ${attempt})`);
    await wait(25_000);

    return signIn(page, origin, who, attempt + 1);
  }

  await page.waitForLoadState('networkidle');
};

let browser;
let ownerToken; let hrToken; let viewerToken; let tokenA; let tokenB;
let entryResumeState = [];

try {
  // =========================================================================
  section('0. ENTRY — the shipped state this suite assumes');
  // =========================================================================

  cleanup();

  check('entry: no 5B fixtures are left over from a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '5B %';`) === '0',
    'clean');

  const menuVisible = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(IsMenuVisible AS varchar(2)) FROM m_sso_menus WHERE MenuCode = 'SCHOOL_APPLICANTS';`);

  check('🔴 SCHOOL_APPLICANTS is visible again — menus are data (2.37)',
    menuVisible === '1', `IsMenuVisible = ${menuVisible}`);

  const gating = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(GatingModeId AS varchar(2)) FROM m_mdm_features WHERE FeatureCode = 'JOB_POST' AND Is_Deleted = 0;`);

  check('entry: JOB_POST is FREE, so publishing costs nothing in this run',
    gating === '1', `GatingModeId ${gating}`);

  const ledgerBefore = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_feature_ledger;`);

  check('entry: the ledger row count is recorded, to prove nothing here spends',
    /^\d+$/.test(ledgerBefore), `${ledgerBefore} row(s)`);

  // 🔴 The mockup is gone from the REPO.
  check('🔴 the applicants mockup is deleted from jp-school',
    !fs.existsSync('D:/Projects/jp-school/src/app/_design-reference'),
    '_design-reference/ removed');

  /*
    ⚠️ TEACHER_B IS FORCED TO THE STATE local-accounts.md DOCUMENTS — no resume.
    A previous run of this suite left them with one, which is precisely the
    contamination restoreTeachers() prevents. Forcing it here means a database
    that was already poisoned heals on the next run rather than failing forever.

    🔴 AND THIS HAPPENS BEFORE THE SNAPSHOT IS TAKEN, which is the whole trick.

    ⚠️ The first version captured first and normalised second — so the "restore"
    faithfully put the contamination BACK, and the next run failed exactly as
    the last one had. What is captured has to be the state this suite intends to
    END at, not whatever it happened to find.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t SET t.ResumePath = NULL
    FROM t_app_teachers t
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE u.Email = '${TEACHER_B.id}';

    DECLARE @tid bigint = (SELECT t.TeacherId FROM t_app_teachers t
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
      WHERE u.Email = '${TEACHER_B.id}');
    EXEC USP_RecalculateTeacherProfile @TeacherId = @tid;`);

  // Captured AFTER the normalise. This is the state the finally restores to.
  entryResumeState = teacherResumeState();

  console.log(`\n    resume state this run will restore to:\n      ${entryResumeState.join('\n      ')}\n`);

  check('entry: the resume-less teacher really has no resume (the premise, not the claim)',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CASE WHEN t.ResumePath IS NULL THEN 'none' ELSE 'HAS-ONE' END
      FROM t_app_teachers t
        INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
      WHERE u.Email = '${TEACHER_B.id}';`) === 'none',
    TEACHER_B.id);

  ownerToken = await login(OWNER);
  tokenA = await login(TEACHER_A);

  // =========================================================================
  section('1. THE MASTER — every option is a row, nothing is hardcoded (2.7)');
  // =========================================================================

  const masterResponse = await j(`${APP}/masters/application-status`, { headers: H(ownerToken) });
  const masterRows = masterResponse.body?.data ?? [];

  check('/api/masters/application-status answers 200',
    masterResponse.http === 200, `HTTP ${masterResponse.http}`);

  check('🔴 …with the SIX REACHABLE statuses and no more',
    masterRows.length === 6, masterRows.map((r) => r.code).join(', '));

  check('🔴 …and the offer chain is NOT offered — it is unreachable until Phase 6',
    !masterRows.some((r) => ['OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'HIRED'].includes(r.code)),
    'no 7..10');

  const masterInDb = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(5)) FROM m_app_application_status
    WHERE Is_Deleted = 0 AND Is_Active = 1;`)[0];

  check('…while the TABLE still holds all ten — the ids are a contract (2.47)',
    masterInDb === '10', `${masterInDb} rows in m_app_application_status`);

  // =========================================================================
  section('2. FIXTURES — a school, a job, and a second campus');
  // =========================================================================

  const branchId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(b.BranchId AS varchar(20))
    FROM t_app_school_branches b
      INNER JOIN t_app_school_users su ON su.SchoolId = b.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}' AND b.Is_Deleted = 0 AND su.Is_Deleted = 0
    ORDER BY b.BranchId;`);

  const schoolId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(SchoolId AS varchar(20)) FROM t_app_school_branches WHERE BranchId = ${branchId};`);

  /*
    ⚠️ RESOLVED THROUGH THE OWNER'S OWN MEMBERSHIP ROW, not through the
    organisation. Two schools in this database share one OrganizationUid, and a
    4B verification once resolved the wrong one — every ledger assertion in it
    then counted an organisation nobody was acting as. The resolver uses
    t_app_school_users.SchoolId, so this query does too.
  */
  check('premise: the owner resolves to one school and one campus',
    /^\d+$/.test(schoolId) && /^\d+$/.test(branchId),
    `SchoolId ${schoolId}, BranchId ${branchId}`);

  const makeJob = async (token, title, extra = {}) => {
    const saved = await j(`${APP}/jobs`, {
      method: 'POST', headers: H(token),
      body: JSON.stringify({
        branchId: Number(extra.branchId ?? branchId),
        jobTitle: title,
        subjectId: 1, designationId: 1, employmentTypeId: 1,
        noOfVacancies: 2, isSalaryNegotiable: true,
        salaryMin: 30000, salaryMax: 50000,
        lastDateToApply: extra.lastDateToApply ?? '2027-12-31',
        jobDescription: 'Posted by the Phase 5B verification suite.',
        subjectIds: [1], classLevelIds: [1],
      }),
    });

    const id = typeof saved.body?.data === 'number' ? saved.body.data : saved.body?.data?.jobId;

    await j(`${APP}/jobs/${id}/publish`, { method: 'POST', headers: H(token) });

    return id;
  };

  const mainJob = await makeJob(ownerToken, '5B Physics Teacher');

  check('a published job exists to apply to',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(JobStatusId AS varchar(2)) FROM t_app_jobs WHERE JobId = ${mainJob};`) === '2',
    `JobId ${mainJob}, Active`);

  // =========================================================================
  section('3. 🔒 THE CONSENT BOUNDARY — applying by clicking, contact appearing');
  // =========================================================================

  browser = await chromium.launch();

  const teacherCtx = await browser.newContext({ viewport: WIDE });
  const teacher = await teacherCtx.newPage();

  await signIn(teacher, TEACHER_APP, TEACHER_A);

  await teacher.goto(`${TEACHER_APP}/jobs`, { waitUntil: 'networkidle' });
  await wait(600);

  const browseHasJob = await teacher.locator(`text=5B Physics Teacher`).count();

  check('the teacher sees the open posting on Find jobs',
    browseHasJob > 0, `${browseHasJob} match(es)`);

  await shot(teacher, 'teacher-jobs-browse-1440');

  await teacher.goto(`${TEACHER_APP}/jobs/${mainJob}`, { waitUntil: 'networkidle' });
  await wait(500);

  const applyButton = teacher.locator('button.job__apply');

  check('…and the job page offers Apply',
    (await applyButton.count()) === 1, 'one apply control');

  /*
    🔒 THE CONSEQUENCE IS ON THE SCREEN, BEFORE THE BUTTON.

    Applying is consent path 1 (2.56) and it cannot be undone (G28). Somebody
    handing over their phone number is entitled to know both, in front of them,
    rather than in a tooltip or after the fact.
  */
  const consentCopy = await teacher.locator('.card__body').filter({ hasText: 'Applying shares' }).count();

  check('🔒 …and says what applying SHARES, and that it cannot be undone',
    consentCopy > 0, 'consent copy present');

  await shot(teacher, 'teacher-job-detail-1440');

  await teacher.fill('#cover-note', 'I have taught Physics to senior classes for six years.');
  await applyButton.click();
  await teacher.waitForLoadState('networkidle');
  await wait(1200);

  const applicationId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ApplicationId AS varchar(20)) FROM t_app_applications
    WHERE JobId = ${mainJob} AND Is_Deleted = 0;`);

  check('🔴 the click wrote ONE application row',
    /^\d+$/.test(applicationId), `ApplicationId ${applicationId}`);

  const teacherId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(TeacherId AS varchar(20)) FROM t_app_applications WHERE ApplicationId = ${applicationId};`);

  const isVerified = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(IsVerified AS varchar(2)) FROM t_app_teachers WHERE TeacherId = ${teacherId};`);

  /*
    🔴 2.9, IN THE UI THIS TIME. 5A proved the procedure has no IsVerified
    clause; this proves the SCREEN does not add one back. The premise is
    asserted first, so a fixture that drifted to verified fails the premise
    rather than passing the claim for the wrong reason.
  */
  check('premise: the teacher who just applied is UNVERIFIED',
    isVerified === '0', `TeacherId ${teacherId}, IsVerified ${isVerified}`);

  check('🔴 …and the application went through anyway — the badge is a signal, not a gate (2.9)',
    /^\d+$/.test(applicationId), 'accepted');

  // ---- the school's side ---------------------------------------------------

  const listRaw = await j(`${APP}/applicants`, { headers: H(ownerToken) });

  check('the school\'s applicant list now has the row',
    (listRaw.body?.data ?? []).some((r) => String(r.applicationId) === applicationId),
    `${(listRaw.body?.data ?? []).length} applicant(s)`);

  /*
    🔴 ABSENT FROM THE BYTES, not null and not hidden.

    Every applicant on this list HAS consented, so an email here would not break
    2.56 — it would break the SHAPE, and the shape is what has held the line
    since 3D. A list is a browse surface that ends up in a screenshot, a log or
    an export.
  */
  const listText = listRaw.text.toLowerCase();

  check('🔒 …and the LIST carries no contact at all — checked against the raw bytes',
    !listText.includes('contactemail') && !listText.includes('contactmobile')
    && !listText.includes('resumepath') && !listText.includes(TEACHER_A.id.toLowerCase()),
    'no contact keys, no address');

  const detail = await j(`${APP}/applicants/${applicationId}`, { headers: H(ownerToken) });

  check('🔒 the DETAIL unlocks contact — the teacher applied, so consent exists (2.56)',
    detail.body?.data?.isContactUnlocked === true
    && String(detail.body?.data?.contactEmail ?? '').toLowerCase() === TEACHER_A.id.toLowerCase(),
    `${detail.body?.data?.contactEmail}`);

  // 🔴 A SECOND SCHOOL GETS NOTHING — not a locked block, a 404.
  hrToken = await login(HR);

  const otherSchoolList = await j(`${APP}/applicants`, { headers: H(hrToken) });
  const otherSchoolDetail = await j(`${APP}/applicants/${applicationId}`, { headers: H(hrToken) });

  check('🔒 a DIFFERENT school sees zero applicants, not fewer',
    (otherSchoolList.body?.data ?? []).length === 0,
    `${(otherSchoolList.body?.data ?? []).length} rows`);

  check('🔒 …and reading that application by id is 404, never 403 (2.6)',
    otherSchoolDetail.http === 404, `HTTP ${otherSchoolDetail.http}`);

  check('🔒 …with no contact anywhere in that refusal',
    !otherSchoolDetail.text.toLowerCase().includes(TEACHER_A.id.toLowerCase()),
    'nothing leaked');

  // ---- and the school's screen --------------------------------------------

  const schoolCtx = await browser.newContext({ viewport: WIDE });
  const school = await schoolCtx.newPage();

  await signIn(school, SCHOOL_APP, OWNER);

  await school.goto(`${SCHOOL_APP}/applicants`, { waitUntil: 'networkidle' });
  await wait(700);

  check('the school\'s Applicants screen renders the row',
    (await school.locator('tbody tr').count()) >= 1,
    `${await school.locator('tbody tr').count()} row(s)`);

  await shot(school, 'school-applicants-1440');

  await school.goto(`${SCHOOL_APP}/applicants/${applicationId}`, { waitUntil: 'networkidle' });
  await wait(700);

  const contactOnScreen = await school.locator(`text=${TEACHER_A.id}`).count();

  check('🔒 …and the applicant page SHOWS the contact address',
    contactOnScreen > 0, TEACHER_A.id);

  await shot(school, 'school-applicant-detail-1440');

  // =========================================================================
  section('4. THE MACHINE — the buttons ARE the server\'s allowed transitions');
  // =========================================================================

  /*
    ⚠️ Opening the detail STAMPED Applied -> Viewed. That is the one read that
    writes, and it is why this section reads the status back rather than
    assuming it is still 1.
  */
  const afterOpen = await j(`${APP}/applicants/${applicationId}`, { headers: H(ownerToken) });
  const allowed = (afterOpen.body?.data?.allowedTransitions ?? []).map((t) => t.code);

  check('🔴 opening the applicant stamped Applied -> Viewed (the read that writes)',
    afterOpen.body?.data?.applicationStatusId === 2
    && afterOpen.body?.data?.statusName === 'Viewed'
    && !!afterOpen.body?.data?.viewedOn,
    `status ${afterOpen.body?.data?.statusName}, viewedOn ${afterOpen.body?.data?.viewedOn}`);

  check('🔴 …and the response\'s allowedTransitions are VIEWED\'s, not Applied\'s',
    allowed.join(',') === 'SHORTLISTED,INTERVIEW,REJECTED',
    allowed.join(', ') || '(none)');

  const buttonLabels = await school.locator('.applicant__buttons .btn').allTextContents();
  const trimmed = buttonLabels.map((t) => t.trim()).filter(Boolean);

  check('🔴 …and the SCREEN draws exactly those three, from that response',
    trimmed.length === 3
    && trimmed.every((label) => (afterOpen.body?.data?.allowedTransitions ?? [])
      .some((t) => t.name === label)),
    trimmed.join(' · '));

  // A legal move, by clicking.
  await school.locator('.applicant__buttons .btn', { hasText: 'Shortlisted' }).click();
  await school.waitForLoadState('networkidle');
  await wait(1200);

  const history = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(h.ToStatusId AS varchar(3)) + ':' + ISNULL(CAST(h.ChangedByUserId AS varchar(20)), 'null')
    FROM t_app_application_status_history h
    WHERE h.ApplicationId = ${applicationId} AND h.Is_Deleted = 0
    ORDER BY h.HistoryId;`);

  check('🔴 the click appended to the append-only history, with the acting user',
    history.length === 3 && history[2].startsWith('3:') && !history[2].endsWith(':null'),
    history.join('  '));

  // ---- the refusals, forced past the UI ------------------------------------

  const backToApplied = await j(`${APP}/applicants/${applicationId}/status`, {
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ toStatusId: 1 }),
  });

  check('🔴 forcing a move BACK to Applied is refused — it would erase that the school looked',
    backToApplied.http >= 400 && backToApplied.body?.code === 'INVALID_TRANSITION',
    `HTTP ${backToApplied.http} ${backToApplied.body?.code}`);

  const offerAttempts = [];

  for (const id of [7, 8, 9, 10]) {
    const r = await j(`${APP}/applicants/${applicationId}/status`, {
      method: 'POST', headers: H(ownerToken), body: JSON.stringify({ toStatusId: id }),
    });

    offerAttempts.push(`${id}:${r.http}/${r.body?.code ?? '-'}`);
  }

  check('🔴 every one of statuses 7..10 is refused — the offer chain is Phase 6',
    offerAttempts.every((a) => !a.includes(':200')),
    offerAttempts.join('  '));

  // ---- rejection, and what the teacher is told -----------------------------

  await school.reload({ waitUntil: 'networkidle' });
  await wait(700);

  await school.locator('.applicant__buttons .btn', { hasText: 'Rejected' }).click();
  await wait(400);
  await school.fill('#rejection-reason', 'Looking for a candidate with CBSE senior-school experience.');
  await school.locator('.btn--danger', { hasText: 'Confirm' }).click();
  await school.waitForLoadState('networkidle');
  await wait(1200);

  const rejected = await j(`${APP}/applicants/${applicationId}`, { headers: H(ownerToken) });

  check('the application is Rejected, and the school keeps its own note',
    rejected.body?.data?.applicationStatusId === 6
    && !!rejected.body?.data?.rejectionReason,
    `${rejected.body?.data?.statusName} · "${rejected.body?.data?.rejectionReason}"`);

  check('🔴 …and allowedTransitions is EMPTY — Rejected is terminal, by design',
    (rejected.body?.data?.allowedTransitions ?? []).length === 0, 'no moves out');

  const noButtons = await school.locator('.applicant__buttons .btn').count();

  check('🔴 …so the screen draws NO status buttons at all (absent, not disabled)',
    noButtons === 0, `${noButtons} buttons`);

  await shot(school, 'school-applicant-rejected-1440');

  // 🔒 The teacher's side of the same row.
  const teacherView = await j(`${APP}/teacher/applications/${applicationId}`, { headers: H(tokenA) });

  check('🔴 the teacher is shown "Not selected", never the school\'s word "Rejected"',
    teacherView.body?.data?.statusName === 'Not selected',
    teacherView.body?.data?.statusName);

  check('🔴 …and the school\'s private reason is ABSENT from the teacher\'s bytes',
    !teacherView.text.toLowerCase().includes('cbse senior-school')
    && !teacherView.text.toLowerCase().includes('rejectionreason'),
    'not sent');

  // =========================================================================
  section('5. THE SNAPSHOT — replacing a resume does not rewrite history');
  // =========================================================================

  const secondJob = await makeJob(ownerToken, '5B Chemistry Teacher');

  // The first resume, then an application, then a replacement.
  const upload = async (token, buffer, filename) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);

    return j(`${APP}/teacher/resume`, { method: 'POST', headers: auth(token), body: form });
  };

  await upload(tokenA, FIRST_RESUME, 'original.pdf');

  const snapApply = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ jobId: secondJob }),
  });

  const snapId = snapApply.body?.data?.applicationId;

  check('a second application is in place for the snapshot test',
    snapApply.http === 200 && snapId > 0, `ApplicationId ${snapId}`);

  await upload(tokenA, SECOND_RESUME, 'replacement.pdf');

  const schoolCopy = await fetch(`${APP}/applicants/${snapId}/resume`, { headers: auth(ownerToken) });
  const schoolBytes = Buffer.from(await schoolCopy.arrayBuffer());

  const teacherCopy = await fetch(`${APP}/teacher/resume/file`, { headers: auth(tokenA) });
  const teacherBytes = Buffer.from(await teacherCopy.arrayBuffer());

  console.log(`\n    school reads : ${schoolBytes.length} bytes, marker `
    + `${schoolBytes.includes('5B-ORIGINAL') ? 'ORIGINAL' : schoolBytes.includes('5B-REPLACEMENT') ? 'REPLACEMENT' : '?'}`);
  console.log(`    teacher reads: ${teacherBytes.length} bytes, marker `
    + `${teacherBytes.includes('5B-ORIGINAL') ? 'ORIGINAL' : teacherBytes.includes('5B-REPLACEMENT') ? 'REPLACEMENT' : '?'}\n`);

  check('🔴 the school still opens the ORIGINAL file it was sent',
    schoolCopy.status === 200 && schoolBytes.includes('5B-ORIGINAL-RESUME-SENT-WITH-THE-APPLICATION'),
    `HTTP ${schoolCopy.status}`);

  check('🔴 …while the teacher\'s own profile serves the REPLACEMENT',
    teacherCopy.status === 200 && teacherBytes.includes('5B-REPLACEMENT-UPLOADED-AFTER-APPLYING'),
    `HTTP ${teacherCopy.status}`);

  check('🔴 …and the two are genuinely different files, not the same bytes twice',
    !schoolBytes.equals(teacherBytes), 'different content');

  // =========================================================================
  section('6. RESUME-LESS — refused in place, then the SAME apply succeeds');
  // =========================================================================

  tokenB = await login(TEACHER_B);

  const thirdJob = await makeJob(ownerToken, '5B Mathematics Teacher');

  const teacherBCtx = await browser.newContext({ viewport: WIDE });
  const teacherB = await teacherBCtx.newPage();

  await signIn(teacherB, TEACHER_APP, TEACHER_B);
  await teacherB.goto(`${TEACHER_APP}/jobs/${thirdJob}`, { waitUntil: 'networkidle' });
  await wait(600);

  await teacherB.locator('button.job__apply').click();
  await teacherB.waitForLoadState('networkidle');
  await wait(1000);

  const refusalPanel = teacherB.locator('.note[role="alert"]', { hasText: 'Add a resume first' });

  check('🔴 the refusal is rendered IN PLACE, beside the button — not as a toast',
    (await refusalPanel.count()) === 1, 'panel present');

  const profileLink = await teacherB.locator('a[href*="/profile"]', { hasText: 'Upload your resume' }).count();

  check('🔴 …and it links straight to the resume section of the profile (2.62)',
    profileLink === 1, 'link present');

  /*
    ⚠️ ONE MESSAGE, NOT TWO. RESUME_REQUIRED is in the shared interceptor's
    COMPONENT_RENDERED_CODES precisely so the panel is not also toasted. A
    duplicate was shipped once in 4B and had to be fixed at the interceptor.
  */
  /*
    ⚠️ LOOKS FOR THE REFUSAL'S OWN WORDS IN A TOAST, not for "any toast".

    Counting every toast on the page makes this assertion fail for reasons that
    have nothing to do with it — a rate-limit notice from signing in seconds
    earlier will do it. What must not happen is the SAME refusal arriving twice,
    which is the bug COMPONENT_RENDERED_CODES exists to prevent.
  */
  const duplicateToast = await teacherB.locator('.toast__message')
    .filter({ hasText: /resume/i }).count();

  check('⚠️ …and the same refusal is not ALSO toasted — one event, one message',
    duplicateToast === 0, `${duplicateToast} resume toast(s)`);

  check('…and the Apply control is still there, because this will stop being true',
    (await teacherB.locator('button.job__apply').count()) === 1, 'still offered');

  await shot(teacherB, 'teacher-apply-resume-required-1440');

  const noRow = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(5)) FROM t_app_applications WHERE JobId = ${thirdJob};`);

  check('…and NOTHING was written — a refusal that half-applies would be worse',
    noRow === '0', `${noRow} rows`);

  await upload(tokenB, FIRST_RESUME, 'now-i-have-one.pdf');

  await teacherB.locator('button.job__apply').click();
  await teacherB.waitForLoadState('networkidle');
  await wait(1200);

  const nowApplied = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(5)) FROM t_app_applications
    WHERE JobId = ${thirdJob} AND Is_Deleted = 0;`);

  check('🔴 …and after uploading one, the SAME click succeeds',
    nowApplied === '1', `${nowApplied} application`);

  // =========================================================================
  section('7. EXPIRED — the date decides, on the server');
  // =========================================================================

  const expiredJob = await makeJob(ownerToken, '5B Expired Biology Teacher');

  /*
    ⚠️ The date is moved in the DATABASE rather than through the form, because
    the form refuses a closing date in the past — which is correct, and which
    would make this case untestable through the UI alone. What is being tested
    is what the server does with a job that has BECOME expired.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET LastDateToApply = DATEADD(day, -3, SYSUTCDATETIME()) WHERE JobId = ${expiredJob};`);

  const effective = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(dbo.fn_EffectiveJobStatusId(JobStatusId, LastDateToApply) AS varchar(3))
    FROM t_app_jobs WHERE JobId = ${expiredJob};`);

  check('premise: the job now reads EXPIRED by the effective status, with the row still Active',
    effective === '3',
    `effective ${effective}, stored ${scalar(`SET NOCOUNT ON; USE jp_app; SELECT CAST(JobStatusId AS varchar(3)) FROM t_app_jobs WHERE JobId = ${expiredJob};`)}`);

  const browseAfterExpiry = await j(`${APP}/teacher/jobs?pageSize=100`, { headers: H(tokenA) });

  check('🔴 it does not appear in the teacher\'s browse',
    !(browseAfterExpiry.body?.data ?? []).some((r) => r.jobId === expiredJob),
    'absent from the listing');

  const expiredDetail = await j(`${APP}/teacher/jobs/${expiredJob}`, { headers: H(tokenA) });

  check('🔴 …its page answers 404, the same as a job that never existed',
    expiredDetail.http === 404, `HTTP ${expiredDetail.http}`);

  // 🔴 THE FORCED APPLY — the one a stale tab or devtools would send.
  const forcedExpired = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ jobId: expiredJob }),
  });

  check('🔴 …and a FORCED apply is refused by the server with JOB_EXPIRED',
    forcedExpired.http >= 400 && forcedExpired.body?.code === 'JOB_EXPIRED',
    `HTTP ${forcedExpired.http} ${forcedExpired.body?.code}`);

  check('…with no row written',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(5)) FROM t_app_applications WHERE JobId = ${expiredJob};`) === '0',
    'nothing applied');

  // The teacher's page renders the gone state.
  await teacher.goto(`${TEACHER_APP}/jobs/${expiredJob}`, { waitUntil: 'networkidle' });
  await wait(600);

  check('🔴 …and the teacher\'s page says the posting has gone, with no Apply control',
    (await teacher.locator('text=This posting has gone').count()) === 1
    && (await teacher.locator('button.job__apply').count()) === 0,
    'honest empty state, no button');

  // =========================================================================
  section('8. SCOPE — one teacher, one school, one campus');
  // =========================================================================

  const crossTeacher = await j(`${APP}/teacher/applications/${applicationId}`, { headers: H(tokenB) });

  check('🔴 teacher B reading teacher A\'s application is 404, never 403 (2.6)',
    crossTeacher.http === 404, `HTTP ${crossTeacher.http}`);

  check('…and teacher B\'s own list does not contain it',
    !((await j(`${APP}/teacher/applications`, { headers: H(tokenB) })).body?.data ?? [])
      .some((r) => String(r.applicationId) === applicationId),
    'not in their list');

  // ---- a second campus, and an account bound to only one -------------------
  const secondBranch = await j(`${APP}/branches`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({
      branchName: '5B Second Campus', addressLine1: '2 Test Road',
      cityId: 1, stateId: 1, pincode: '110001', isHeadOffice: false,
    }),
  });

  const secondBranchId = secondBranch.body?.data?.branchId ?? scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(BranchId AS varchar(20)) FROM t_app_school_branches WHERE BranchName = '5B Second Campus';`);

  check('premise: a second campus exists to be excluded from',
    /^\d+$/.test(String(secondBranchId)), `BranchId ${secondBranchId}`);

  const branchJob = await makeJob(ownerToken, '5B Second Campus History Teacher',
    { branchId: Number(secondBranchId) });

  const branchApply = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenB), body: JSON.stringify({ jobId: branchJob }),
  });

  check('premise: an application exists at the SECOND campus',
    branchApply.http === 200, `ApplicationId ${branchApply.body?.data?.applicationId}`);

  viewerToken = await login(VIEWER);

  const ownerSees = (await j(`${APP}/applicants`, { headers: H(ownerToken) })).body?.data ?? [];
  const viewerSees = (await j(`${APP}/applicants`, { headers: H(viewerToken) })).body?.data ?? [];

  const ownerBranches = [...new Set(ownerSees.map((r) => r.branchId))].sort();
  const viewerBranches = [...new Set(viewerSees.map((r) => r.branchId))].sort();

  console.log(`\n    owner  sees branches: ${ownerBranches.join(', ')}`);
  console.log(`    viewer sees branches: ${viewerBranches.join(', ')} (bound to ${branchId})\n`);

  check('🔴 the unbound owner sees BOTH campuses\' applicants',
    ownerBranches.length === 2, ownerBranches.join(', '));

  check('🔴 …and the branch-bound account sees ONE — its own, server-side',
    viewerBranches.length === 1 && String(viewerBranches[0]) === String(branchId),
    viewerBranches.join(', '));

  const branchApplicationId = branchApply.body?.data?.applicationId;

  const viewerForced = await j(`${APP}/applicants/${branchApplicationId}`, { headers: H(viewerToken) });

  check('🔴 …and reading the other campus\'s applicant by id is 404, not 403',
    viewerForced.http === 404, `HTTP ${viewerForced.http}`);

  // =========================================================================
  section('9. PERMISSIONS — hiding is not protecting');
  // =========================================================================

  const viewerCtx = await browser.newContext({ viewport: WIDE });
  const viewerPage = await viewerCtx.newPage();

  await signIn(viewerPage, SCHOOL_APP, VIEWER);

  // Something the viewer CAN see: the application at their own campus.
  const viewerVisible = viewerSees[0]?.applicationId;

  await viewerPage.goto(`${SCHOOL_APP}/applicants/${viewerVisible}`, { waitUntil: 'networkidle' });
  await wait(800);

  check('the Viewer can open an applicant at their own campus',
    (await viewerPage.locator('.page__title').count()) === 1, 'page renders');

  check('🔴 …and gets NO status buttons — absent, not greyed (the 3F/3G rule)',
    (await viewerPage.locator('.applicant__buttons .btn').count()) === 0, 'none drawn');

  check('🔴 …and NO "Open resume" button, because a resume is a contact detail',
    (await viewerPage.locator('button', { hasText: 'Open resume' }).count()) === 0, 'none drawn');

  check('…with one honest line explaining why, rather than a screen that looks broken',
    (await viewerPage.locator('.note', { hasText: 'You can read this application' }).count()) === 1,
    'explained');

  await shot(viewerPage, 'school-applicant-viewer-1440');

  // 🔴 AND THE SERVER REFUSES THE SAME TWO THINGS.
  const forcedStatus = await j(`${APP}/applicants/${viewerVisible}/status`, {
    method: 'POST', headers: H(viewerToken), body: JSON.stringify({ toStatusId: 3 }),
  });

  check('🔴 a FORCED status change by the Viewer is refused 403 by the server',
    forcedStatus.http === 403, `HTTP ${forcedStatus.http} ${forcedStatus.body?.code ?? ''}`);

  const forcedResume = await fetch(`${APP}/applicants/${viewerVisible}/resume`, { headers: auth(viewerToken) });

  check('🔴 …and a FORCED resume download is refused 403 — RESUME.DOWNLOAD gates it',
    forcedResume.status === 403, `HTTP ${forcedResume.status}`);

  check('premise: the owner CAN download the same resume — the refusal is the permission, not a broken route',
    (await fetch(`${APP}/applicants/${viewerVisible}/resume`, { headers: auth(ownerToken) })).status === 200,
    'owner 200 / viewer 403');

  // =========================================================================
  section('10. DASHBOARDS AND THE TEACHER\'S OWN SCREENS');
  // =========================================================================

  await school.goto(`${SCHOOL_APP}/dashboard`, { waitUntil: 'networkidle' });
  await wait(900);

  const schoolTile = await school.locator('.jobs__counts', { hasText: 'Needs a reply' }).count();

  check('🔴 the school dashboard\'s applicants area shows real counts',
    schoolTile === 1, 'measured, not promised');

  check('…and no disabled "Review applicants" placeholder is left',
    (await school.locator('button[disabled]', { hasText: 'Review applicants' }).count()) === 0,
    'placeholder gone');

  await shot(school, 'school-dashboard-applicants-1440');

  await teacher.goto(`${TEACHER_APP}/dashboard`, { waitUntil: 'networkidle' });
  await wait(900);

  check('🔴 the teacher dashboard\'s applications area shows real counts',
    (await teacher.locator('.apps__counts').count()) === 1, 'measured, not promised');

  check('…and the Find jobs tile is a working link, not a disabled button',
    (await teacher.locator('a[href="/jobs"]', { hasText: 'Find jobs' }).count()) >= 1
    && (await teacher.locator('button[disabled]', { hasText: 'Find jobs' }).count()) === 0,
    'real link');

  await shot(teacher, 'teacher-dashboard-applications-1440');

  await teacher.goto(`${TEACHER_APP}/applications`, { waitUntil: 'networkidle' });
  await wait(700);

  const teacherStatusWords = (await teacher.locator('tbody .badge').allTextContents())
    .map((t) => t.trim());

  check('🔴 the teacher\'s list uses the TEACHER\'s vocabulary throughout',
    teacherStatusWords.length > 0 && !teacherStatusWords.includes('Rejected')
    && !teacherStatusWords.includes('Viewed'),
    teacherStatusWords.join(' · '));

  await shot(teacher, 'teacher-my-applications-1440');

  // Saved jobs — interest, not consent.
  await j(`${APP}/teacher/jobs/${secondJob}/save`, { method: 'POST', headers: H(tokenB) });

  const savedUnlock = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(dbo.fn_TeacherContactUnlocked(
      (SELECT TeacherId FROM t_app_teachers t
        INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
       WHERE u.Email = '${TEACHER_B.id}'),
      ${schoolId}) AS varchar(2));`);

  const savedRows = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(5)) FROM t_app_saved_jobs WHERE JobId = ${secondJob} AND Is_Deleted = 0;`);

  /*
    🔒 SAVING IS NOT CONSENT. Teacher B has applied to the second-campus job, so
    their contact IS unlocked — which is why this assertion cannot simply read
    "unlocked = 0". What it proves is the ROW EXISTS and the function does not
    read the table at all: the unlock is explained entirely by the application.
  */
  /*
    ⚠️ ASKED OF THE DEPENDENCY GRAPH, NOT OF THE SOURCE TEXT.

    The first version of this grepped OBJECT_DEFINITION for 'saved_jobs' — and
    failed, because the function's own header comment says, in prose, that it
    must never read that table. A text search cannot tell a reference from a
    sentence about a reference.

    sys.sql_expression_dependencies lists what the function actually BINDS TO,
    so a comment cannot trip it and a real reference cannot hide from it.
  */
  const unlockReads = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT d.referenced_entity_name
    FROM sys.sql_expression_dependencies d
      INNER JOIN sys.objects o ON o.object_id = d.referencing_id
    WHERE o.name = 'fn_TeacherContactUnlocked'
    ORDER BY d.referenced_entity_name;`);

  console.log(`\n    fn_TeacherContactUnlocked binds to: ${unlockReads.join(', ') || '(nothing)'}\n`);

  check('🔒 fn_TeacherContactUnlocked binds to t_app_applications AND NOTHING ELSE (2.56)',
    unlockReads.length === 1 && unlockReads[0] === 't_app_applications',
    unlockReads.join(', ') || '(nothing)');

  check('🔒 …so a saved job is stored and cannot possibly unlock anything',
    savedRows === '1' && !unlockReads.includes('t_app_saved_jobs'),
    `${savedRows} saved row; unlock=${savedUnlock}, explained entirely by their application`);

  await teacher.goto(`${TEACHER_APP}/saved-jobs`, { waitUntil: 'networkidle' });
  await wait(600);

  check('the teacher\'s saved-jobs screen says the list is private to them',
    (await teacher.locator('text=no school is told').count()) >= 1, 'stated on screen');

  // =========================================================================
  section('11. 375px — every new screen, on a phone');
  // =========================================================================

  /*
    ⚠️ THE PAGES THAT ARE ALREADY SIGNED IN ARE RESIZED, rather than two new
    contexts signing the same two accounts in again. Four extra logins in the
    last thirty seconds of a run is what tripped the 5/min limiter the first
    time this suite was written — and a rate-limited login looks exactly like a
    broken sign-in screen, which is a bad half-hour for whoever reads the
    failure next.
  */
  const phone = school;

  await phone.setViewportSize(PHONE);

  for (const [path, name] of [
    ['/applicants', 'school-applicants-375'],
    [`/applicants/${viewerVisible}`, 'school-applicant-detail-375'],
  ]) {
    await phone.goto(`${SCHOOL_APP}${path}`, { waitUntil: 'networkidle' });
    await wait(700);

    const overflow = await phone.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);

    check(`375: ${path} does not scroll the page sideways`,
      overflow <= 0, `${overflow}px of horizontal overflow`);

    await shot(phone, name);
  }

  const phoneTeacher = teacher;

  await phoneTeacher.setViewportSize(PHONE);

  for (const [path, name] of [
    ['/jobs', 'teacher-jobs-browse-375'],
    [`/jobs/${secondJob}`, 'teacher-job-detail-375'],
    ['/applications', 'teacher-my-applications-375'],
    ['/saved-jobs', 'teacher-saved-jobs-375'],
  ]) {
    await phoneTeacher.goto(`${TEACHER_APP}${path}`, { waitUntil: 'networkidle' });
    await wait(700);

    const overflow = await phoneTeacher.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);

    check(`375: ${path} does not scroll the page sideways`,
      overflow <= 0, `${overflow}px of horizontal overflow`);

    await shot(phoneTeacher, name);
  }

  // =========================================================================
  section('12. EXIT — nothing spent, nothing left behind');
  // =========================================================================

  const ledgerAfter = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_feature_ledger;`);

  /*
    🔴 APPLYING IS FREE, AND SO IS PROCESSING APPLICANTS (2.64).

    Five jobs were published in this run, which is the action that CAN spend —
    but JOB_POST is FREE, so even that writes nothing. Either way, no teacher
    action may ever appear in this table.
  */
  check('🔴 the ledger is untouched — nothing on either side of this phase spends',
    ledgerAfter === ledgerBefore, `${ledgerBefore} -> ${ledgerAfter}`);

  /*
    🔴 AND NOT IN THE BUILT OUTPUT EITHER.

    Deleting the folder is the claim; this is the evidence. `SAMPLE_APPLICANTS`
    was the mockup's fifty-row fixture, and 3I's verification proved it was
    tree-shaken out of the bundle. Now it cannot be there at all.

    ⚠️ THE PREMISE IS ASSERTED FIRST. This reads dist/, so the build must have
    been run — and a missing directory has to FAIL rather than pass as "found
    nothing, therefore clean". A test that passes because it looked in the wrong
    place is worse than one that fails.
  */
  const distDir = 'D:/Projects/jp-school/dist/browser';

  check('premise: jp-school has been built, so there is a bundle to inspect',
    fs.existsSync(distDir), distDir);

  const bundleHasMockup = fs.existsSync(distDir)
    && fs.readdirSync(distDir)
      .filter((f) => f.endsWith('.js'))
      .some((f) => fs.readFileSync(`${distDir}/${f}`, 'utf8').includes('SAMPLE_APPLICANTS'));

  check("🔴 the mockup's fixture is not in the built bundle either",
    fs.existsSync(distDir) && !bundleHasMockup, 'SAMPLE_APPLICANTS absent from dist');

  cleanup();

  const leftovers = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(
      (SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '5B %')
      + (SELECT COUNT(*) FROM t_app_school_branches WHERE BranchName LIKE '5B %')
      + (SELECT COUNT(*) FROM t_app_applications a
           INNER JOIN t_app_jobs j ON j.JobId = a.JobId WHERE j.JobTitle LIKE '5B %')
      AS varchar(10));`);

  check('exit: every 5B fixture is removed',
    leftovers === '0', `${leftovers} left`);

  const realDataUntouched = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST((SELECT COUNT(*) FROM t_app_applications) AS varchar(10));`);

  check('exit: no applications remain at all — this run invented every one of them',
    realDataUntouched === '0', `${realDataUntouched} applications in the database`);
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close();

  // ⚠️ Cleanup runs even on a thrown error. A killed run must not leave rows
  // that break a different suite's counts three sections later.
  try { cleanup(); } catch { /* reported above */ }

  // …and so does the resume restore, for the same reason and with more force:
  // these two rows belong to accounts other suites and other people use.
  try {
    if (entryResumeState.length > 0) {
      restoreTeachers(entryResumeState);
      console.log(`\n    resume state restored:\n      ${teacherResumeState().join('\n      ')}\n`);
    }
  } catch (error) {
    console.error('  ⚠️ COULD NOT RESTORE THE TEACHERS\' RESUME STATE:', error.message);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
