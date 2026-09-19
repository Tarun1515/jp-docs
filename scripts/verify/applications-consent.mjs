/*
  PHASE 5A — 🔴 THE CONSENT BOUNDARY, END TO END.

  ----------------------------------------------------------------------------
  WHAT THIS PROVES, AND WHY IT IS THE PHASE'S MOST IMPORTANT SCRIPT
  ----------------------------------------------------------------------------
  Decision 2.56 is LOCKED: a school sees a teacher's phone number and email on
  exactly two paths — the teacher APPLIED to them, or ACCEPTED their invite.
  Until this phase NEITHER could happen, because fn_TeacherContactUnlocked
  returned a hard 0 and said "Phase 5 replaces this".

  Phase 5 made path 1 real. That makes this the first moment in the product's
  life where a contact detail can legitimately flow, so it is verified as a
  BOUNDARY rather than as a feature:

    1. BEFORE   the contact field is ABSENT FROM THE JSON ITSELF — asserted
                against the raw response TEXT, not against a parsed property
                that happens to be undefined. A serialiser or a mapper can add
                a field the DTO never declared; only reading the bytes catches
                that.
    2. APPLY    one teacher, one job, one school.
    3. AFTER    the SAME API call now returns the email and the mobile — for
                the applied-to school ONLY.
    4. THE OTHER SCHOOL, with its own active job and its own account, still
                gets nothing. This is the assertion that separates "consent"
                from "the feature is on".
    5. 🔴 SAVING A JOB IS NOT APPLYING. The teacher saves the OTHER school's
                job, and that school still sees nothing. Saving is interest;
                applying is consent (024).
    6. THE LIST SHAPE. The school's applicant LIST carries no contact columns
                at all, even though every row on it has consented. Contact is
                a deliberate act on one person — the detail endpoint.

  Both the FUNCTION OUTPUT and the API JSON are printed at every step, because
  a green assertion on a value nobody looked at is how 2.5 shipped a balance
  formula that invented credits.

  ----------------------------------------------------------------------------
  🔴 SHIPPED STATE IS ASSERTED ON ENTRY *AND* EXIT
  ----------------------------------------------------------------------------
  On entry, not just on exit. A smoke test crashed mid-run during this phase's
  build, its cleanup never ran, and the next run read a contaminated count and
  looked like a product bug for twenty minutes. Cleaning on the way IN is the
  cheap half of that lesson.

  ⚠️ sqlcmd needs -I: t_app_applications carries filtered indexes and
  QUOTED_IDENTIFIER defaults OFF in sqlcmd, so writes fail with Msg 1934.

  Run (both APIs up): node scripts/verify/applications-consent.mjs
*/
import { execFileSync } from 'node:child_process';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

// School 4 (Nalanda Vidyalaya) — the school the teacher will apply to.
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
// School 2 (Greenwood Dwarka) — a DIFFERENT organisation, with its own job.
const OTHER = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };
// A teacher who already has a resume, so the apply is about consent and
// nothing else.
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep the text */ }

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

  return r.body.data.accessToken;
};

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------
const ownerToken = await login(OWNER.id, OWNER.pw);
const otherToken = await login(OTHER.id, OTHER.pw);
const teacherToken = await login(TEACHER.id, TEACHER.pw);

const HO = { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' };
const HX = { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' };
const HT = { authorization: `Bearer ${teacherToken}`, 'content-type': 'application/json' };

const ownerBranch = (await j(`${APP}/branches`, { headers: HO })).body?.data?.[0]?.branchId;
const otherBranch = (await j(`${APP}/branches`, { headers: HX })).body?.data?.[0]?.branchId;

const ownerSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${ownerBranch};`));
const otherSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${otherBranch};`));

const teacher = sql(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(t.TeacherId AS varchar(20)) + '|' + CAST(t.TeacherUid AS varchar(40)) + '|'
       + u.Email + '|' + ISNULL(u.Mobile, '(none)')
  FROM t_app_teachers t JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${TEACHER.id}';`)[0].split('|').map((s) => s.trim());

const [teacherId, teacherUid, teacherEmail, teacherMobile] = teacher;

/** fn_TeacherContactUnlocked, straight from the database. */
const unlocked = (schoolId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(dbo.fn_TeacherContactUnlocked(${teacherId}, ${schoolId}) AS varchar(2));`);

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_application_status_history
  WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications WHERE SchoolId IN (${ownerSchool}, ${otherSchool}));
  DELETE FROM t_app_applications WHERE SchoolId IN (${ownerSchool}, ${otherSchool});
  DELETE FROM t_app_saved_jobs WHERE TeacherId = ${teacherId};
  DELETE FROM t_app_job_subjects WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${otherSchool}));
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${otherSchool}));
  DELETE FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${otherSchool});`);

/*
  🔴 CLEAN ON THE WAY IN, THEN ASSERT. A previous run that died between its
  fixture and its teardown leaves rows behind, and the next run reads them as
  product behaviour.
*/
cleanup();

const entryApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
const entrySaved = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_saved_jobs;`);
const entryJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);

console.log(`\nowner: school ${ownerSchool} campus ${ownerBranch}`
  + ` · other: school ${otherSchool} campus ${otherBranch}`);
console.log(`teacher: id ${teacherId} uid ${teacherUid}`);

check('🔴 shipped state on ENTRY — no applications, no saved jobs, no jobs',
  entryApps === '0' && entrySaved === '0' && entryJobs === '0',
  `applications ${entryApps}, saved ${entrySaved}, jobs ${entryJobs}`);

check('premise: the two accounts really are at DIFFERENT schools',
  ownerSchool !== otherSchool, `${ownerSchool} vs ${otherSchool}`);

const body = (branchId, title) => JSON.stringify({
  branchId, jobTitle: title, subjectId: 1, designationId: 1,
  employmentTypeId: 1, noOfVacancies: 2, salaryMin: 30000, salaryMax: 50000,
  lastDateToApply: '2026-12-31', subjectIds: [1], classLevelIds: [1],
});

/** The contact-shaped strings that must not appear in a browse payload. */
const CONTACT_KEYS = ['contactEmail', 'contactMobile', 'resumePath'];

try {
  const ownerJob = (await j(`${APP}/jobs`, { method: 'POST', headers: HO, body: body(ownerBranch, 'PGT Physics — consent fixture') })).body?.data;
  await j(`${APP}/jobs/${ownerJob}/publish`, { method: 'POST', headers: HO });

  const otherJob = (await j(`${APP}/jobs`, { method: 'POST', headers: HX, body: body(otherBranch, 'TGT Maths — other school') })).body?.data;
  await j(`${APP}/jobs/${otherJob}/publish`, { method: 'POST', headers: HX });

  check('fixture: both schools have a published job',
    ownerJob > 0 && otherJob > 0, `job ${ownerJob} at school ${ownerSchool}, job ${otherJob} at school ${otherSchool}`);

  // =========================================================================
  console.log('\n=== 1. BEFORE ANY APPLICATION — THE FIELD IS ABSENT, NOT BLANK ===');

  const before4 = unlocked(ownerSchool);
  const before2 = unlocked(otherSchool);

  console.log(`\n    fn_TeacherContactUnlocked(${teacherId}, ${ownerSchool}) = ${before4}`);
  console.log(`    fn_TeacherContactUnlocked(${teacherId}, ${otherSchool}) = ${before2}\n`);

  check('🔴 the function says LOCKED for both schools',
    before4 === '0' && before2 === '0', `school ${ownerSchool}: ${before4}, school ${otherSchool}: ${before2}`);

  const browseBefore = await j(`${APP}/teachers/${teacherUid}/browse`, { headers: HO });

  console.log(`    GET /api/teachers/{uid}/browse  HTTP ${browseBefore.http}`);
  console.log(`      ${browseBefore.text.slice(0, 260)}…\n`);

  const leakedKeys = CONTACT_KEYS.filter((k) => new RegExp(`"${k}"`, 'i').test(browseBefore.text));

  check('🔴 the browse payload does not CONTAIN the field names at all — absent, not null',
    browseBefore.http === 200 && leakedKeys.length === 0,
    leakedKeys.length ? `LEAKED: ${leakedKeys.join(', ')}` : 'contactEmail / contactMobile / resumePath all absent from the bytes');

  check('…and the teacher\'s real email does not appear anywhere in those bytes',
    !browseBefore.text.includes(teacherEmail), teacherEmail);

  const contactBefore = await j(`${APP}/teachers/${teacherUid}/contact`, { headers: HO });

  console.log(`    GET /api/teachers/{uid}/contact  HTTP ${contactBefore.http} · code ${contactBefore.body?.code}`);
  console.log(`      ${contactBefore.text.slice(0, 260)}…\n`);

  /*
    ⚠️ FINDING, PRE-EXISTING (3E), NOT A PHASE 5 REGRESSION — ASSERTED AS IT
    ACTUALLY IS RATHER THAN AS IT SHOULD BE.

    USP_GetTeacherContactForSchool returns the code CONTACT_LOCKED, and
    jp_app/99_tests/002 asserts that at the SQL level. The API never forwards
    it: TeacherDirectoryService.GetContactAsync throws ForbiddenException, whose
    code is the generic FORBIDDEN, so the procedure's carefully chosen code dies
    one layer below the client.

    2.12 says a client branches on the code and never on the message, and today
    a screen cannot tell "this teacher has not consented" from any other 403.
    Nothing consumes it yet — there is no teacher-search screen — so this is
    recorded rather than quietly changed under a phase that was not asked to
    alter a shipped contract. What keeps the 403 usable meanwhile is the
    MESSAGE, which names the two things that would unlock it, and that IS
    asserted below.
  */
  check('🔴 the contact endpoint REFUSES — 403',
    contactBefore.http === 403, `HTTP ${contactBefore.http}, code ${contactBefore.body?.code}`);
  check('⚠️ …and the code is the generic FORBIDDEN, NOT the procedure\'s CONTACT_LOCKED '
    + '— pre-existing 3E gap, recorded not fixed',
    contactBefore.body?.code === 'FORBIDDEN',
    `code ${contactBefore.body?.code} (the procedure said CONTACT_LOCKED)`);
  check('…so the MESSAGE is what carries the path — it names applying and accepting an invite',
    /apply to one of your jobs/i.test(contactBefore.text) && /accept an invitation/i.test(contactBefore.text),
    'both routes named in the refusal');
  check('…and the refusal carries no email and no mobile in its bytes',
    !contactBefore.text.includes(teacherEmail)
    && (teacherMobile === '(none)' || !contactBefore.text.includes(teacherMobile)),
    'neither value present');

  // =========================================================================
  console.log('\n=== 2. THE TEACHER APPLIES — CONSENT PATH 1 ===');

  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HT,
    body: JSON.stringify({ jobId: ownerJob, coverNote: 'I would like to be considered.' }),
  });

  console.log(`\n    POST /api/teacher/applications  HTTP ${applied.http} · code ${applied.body?.code ?? 'null'}`);
  console.log(`      ${applied.text.slice(0, 200)}\n`);

  const applicationId = applied.body?.data?.applicationId;

  check('the application is created', applied.http === 200 && applicationId > 0,
    `applicationId ${applicationId}, created ${applied.body?.data?.created}`);

  check('…and exactly ONE row exists',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherId} AND JobId=${ownerJob};`) === '1',
    '1 row');

  // =========================================================================
  console.log('\n=== 3. AFTER — THE SAME CALL NOW ANSWERS, FOR ONE SCHOOL ===');

  const after4 = unlocked(ownerSchool);
  const after2 = unlocked(otherSchool);

  console.log(`\n    fn_TeacherContactUnlocked(${teacherId}, ${ownerSchool}) = ${after4}   <- applied to`);
  console.log(`    fn_TeacherContactUnlocked(${teacherId}, ${otherSchool}) = ${after2}   <- did NOT apply to\n`);

  check('🔴 the function now says UNLOCKED for the applied-to school',
    after4 === '1', `school ${ownerSchool}: ${after4}`);
  check('🔴 …and STILL LOCKED for the other school, which has its own active job',
    after2 === '0', `school ${otherSchool}: ${after2}`);

  const contactAfter = await j(`${APP}/teachers/${teacherUid}/contact`, { headers: HO });

  console.log(`    GET /api/teachers/{uid}/contact as school ${ownerSchool}  HTTP ${contactAfter.http}`);
  console.log(`      ${contactAfter.text}\n`);

  check('🔴 THE SAME API CALL that was 403 is now 200',
    contactAfter.http === 200, `HTTP ${contactAfter.http}`);
  check('…and it carries the teacher\'s REAL email from jp_sso',
    contactAfter.body?.data?.contactEmail === teacherEmail,
    `${contactAfter.body?.data?.contactEmail} === ${teacherEmail}`);
  check('…and their mobile',
    (contactAfter.body?.data?.contactMobile ?? '') === (teacherMobile === '(none)' ? '' : teacherMobile),
    `${contactAfter.body?.data?.contactMobile}`);

  const contactOther = await j(`${APP}/teachers/${teacherUid}/contact`, { headers: HX });

  console.log(`    GET /api/teachers/{uid}/contact as school ${otherSchool}  HTTP ${contactOther.http} · code ${contactOther.body?.code}`);
  console.log(`      ${contactOther.text.slice(0, 220)}…\n`);

  check('🔴 THE SECOND SCHOOL IS STILL REFUSED — consent is per school, not global',
    contactOther.http === 403, `HTTP ${contactOther.http}, code ${contactOther.body?.code}`);
  check('…and its refusal still carries no email in the bytes',
    !contactOther.text.includes(teacherEmail), 'absent');

  // =========================================================================
  console.log('\n=== 4. THE APPLICANT DETAIL — SAME GATE, SAME ANSWER ===');

  const detail = await j(`${APP}/applicants/${applicationId}`, { headers: HO });
  const d = detail.body?.data;

  console.log(`\n    GET /api/applicants/${applicationId}  HTTP ${detail.http}`);
  console.log(`      isContactUnlocked ${d?.isContactUnlocked} · contactEmail ${d?.contactEmail}`
    + ` · contactMobile ${d?.contactMobile}`);
  console.log(`      resumePathSnapshot ${d?.resumePathSnapshot}\n`);

  check('the applicant detail reports the gate\'s own answer',
    detail.http === 200 && d?.isContactUnlocked === true, `isContactUnlocked ${d?.isContactUnlocked}`);
  check('…and the email it returns is the same one the contact endpoint gave',
    d?.contactEmail === teacherEmail, `${d?.contactEmail}`);

  const list = await j(`${APP}/applicants`, { headers: HO });
  const listLeak = CONTACT_KEYS.filter((k) => new RegExp(`"${k}"`, 'i').test(list.text));

  console.log(`    GET /api/applicants  HTTP ${list.http} · ${list.body?.data?.length} row(s)`);
  console.log(`      ${list.text.slice(0, 300)}…\n`);

  check('🔴 THE LIST CARRIES NO CONTACT COLUMNS AT ALL — even though every row consented',
    list.http === 200 && listLeak.length === 0,
    listLeak.length ? `LEAKED: ${listLeak.join(', ')}` : 'absent from the bytes');
  check('…and no teacher email appears in the list payload',
    !list.text.includes(teacherEmail), 'absent');
  check('…and no SchoolId leaks from any of it (2.39)',
    !/"schoolId"/i.test(list.text) && !/"schoolId"/i.test(detail.text), 'absent from both payloads');

  // =========================================================================
  console.log('\n=== 5. 🔴 SAVING A JOB IS NOT APPLYING ===');

  const saved = await j(`${APP}/teacher/jobs/${otherJob}/save`, { method: 'POST', headers: HT });

  console.log(`\n    POST /api/teacher/jobs/${otherJob}/save  HTTP ${saved.http} · isSaved ${saved.body?.data?.isSaved}`);

  check('the teacher saves the OTHER school\'s job',
    saved.http === 200 && saved.body?.data?.isSaved === true, `isSaved ${saved.body?.data?.isSaved}`);
  check('…and the row is there',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_saved_jobs WHERE TeacherId=${teacherId} AND JobId=${otherJob} AND Is_Deleted=0;`) === '1',
    '1 saved row');

  const savedUnlock = unlocked(otherSchool);
  const contactAfterSave = await j(`${APP}/teachers/${teacherUid}/contact`, { headers: HX });

  console.log(`    fn_TeacherContactUnlocked(${teacherId}, ${otherSchool}) = ${savedUnlock}   <- after SAVING their job`);
  console.log(`    GET /api/teachers/{uid}/contact as school ${otherSchool}  HTTP ${contactAfterSave.http}\n`);

  check('🔴 SAVING UNLOCKS NOTHING — the function still says 0',
    savedUnlock === '0', `${savedUnlock}`);
  check('🔴 …and that school\'s contact call is still 403',
    contactAfterSave.http === 403, `HTTP ${contactAfterSave.http}, code ${contactAfterSave.body?.code}`);
  check('…and the school cannot see the save at all — its applicant list is empty',
    (await j(`${APP}/applicants`, { headers: HX })).body?.data?.length === 0, '0 applicants');
} finally {
  // =========================================================================
  console.log('\n=== TEARDOWN ===');
  cleanup();

  const exitApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
  const exitSaved = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_saved_jobs;`);
  const exitJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const exitUnlock = unlocked(ownerSchool);

  check('🔴 shipped state on EXIT — no applications, no saved jobs, no jobs',
    exitApps === '0' && exitSaved === '0' && exitJobs === '0',
    `applications ${exitApps}, saved ${exitSaved}, jobs ${exitJobs}`);

  check('🔴 …and contact is LOCKED again, because the consent row is gone',
    exitUnlock === '0', `fn_TeacherContactUnlocked(${teacherId}, ${ownerSchool}) = ${exitUnlock}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
