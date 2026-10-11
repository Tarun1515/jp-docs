/*
  🔒 THE CONSENT BOUNDARY, END TO END — BOTH PATHS. (5A + 6B)

  ----------------------------------------------------------------------------
  WHAT THIS PROVES, AND WHY IT IS THE PHASE'S MOST IMPORTANT SCRIPT
  ----------------------------------------------------------------------------
  Decision 2.56 is LOCKED: a school sees a teacher's phone number and email on
  exactly two paths — the teacher APPLIED to them, or ACCEPTED their invite.
  Until this phase NEITHER could happen, because fn_TeacherContactUnlocked
  returned a hard 0 and said "Phase 5 replaces this".

  Phase 5A made path 1 real; Phase 6B made path 2 real. 2.56 is LOCKED at two,
  so this file is now the WHOLE rule, and it runs both in one pass:

  ⚠️ AND THE SECOND HALF IS ALSO A REGRESSION OF THE FIRST. 6B changed
  fn_TeacherContactUnlocked — one EXISTS became two, joined by UNION ALL. A
  function that decides every contact disclosure in the product cannot be
  edited and have path 1 assumed still to work. Sections 1-6 below are that
  re-proof: they are unchanged, and they run against the changed function.

  It is verified as a BOUNDARY rather than as a feature:

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

    7. 🔒 PATH 2 — a teacher who has applied to NOBODY is invited, and the
                four invite states are walked one at a time:
                  SENT     asking is not consent     -> locked
                  VIEWED   reading is not answering  -> locked
                  ACCEPTED the teacher's own act     -> UNLOCKED
                and a second school still gets nothing.

    8. 🔒 IGNORED unlocks nothing, on a third teacher — because "no" has to be
                provably different from "not yet answered".

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
import { token as loginToken } from './lib/login.mjs';

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

/*
  🔴 SIGN-IN COMES FROM THE SHARED HELPER NOW — G34.

  This file used to carry its own login() with a 20-second retry. Every suite
  did, each slightly differently, and all of them shared the same blind spot:
  the per-IDENTIFIER limit is 10 per HOUR, and no backoff inside a test run can
  wait that out. A full regression spent it around the sixth suite and the next
  one died on a null token — a false red that reads like a broken screen.

  `lib/login.mjs` adds a token cache on top of the backoff, which is the part
  that actually closes that window. See its header for the trade it makes and
  the one call site that must bypass it.
*/
const login = loginToken;

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
       + u.Email + '|' + ISNULL(u.Mobile, '(none)') + '|' + t.FullName
  FROM t_app_teachers t JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${TEACHER.id}';`)[0].split('|').map((s) => s.trim());

const [teacherId, teacherUid, teacherEmail, teacherMobile, teacherName] = teacher;

/** fn_TeacherContactUnlocked, straight from the database. */
/*
  ⚠️ 6B: takes a teacher id now. It was hard-wired to the one teacher this file
  used, and path 2 needs a different one — somebody who has applied to nobody,
  so that an invitation is the only thing that could unlock them.
*/
const unlocked = (schoolId, whichTeacher = null) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(dbo.fn_TeacherContactUnlocked(${whichTeacher ?? teacherId}, ${schoolId}) AS varchar(2));`);

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  -- 🔒 6B: the invites this suite sends are consent rows. Leaving one behind
  -- would leave a school able to see a teacher's number, which is the single
  -- worst thing a fixture in this file could do.
  DELETE FROM t_app_teacher_invites WHERE Message LIKE 'consent-suite%';
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

  /*
    🔴 THE FIELD THAT WAS ALWAYS THERE AND ALWAYS EMPTY.

    TeacherContactDto has declared FullName since 3E and the procedure never
    projected one, so this endpoint returned an empty string for three phases.
    Nothing failed, because nothing asked.

    ⚠️ It was found by READING this response body during 6B, not by an
    assertion — so the fix gets the assertion it should always have had, and
    002_test_teacher.sql holds the other half: NULL while the contact is locked.
  */
  check('🔴 …and the NAME is populated, not the empty string the DTO merely declared',
    (contactAfter.body?.data?.fullName ?? '') === teacherName,
    `"${contactAfter.body?.data?.fullName}" === "${teacherName}"`);

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

  // =========================================================================
  console.log('\n=== 7. 🔒 CONSENT PATH 2 — AN INVITATION, ONE STATE AT A TIME ===');
  // =========================================================================

  /*
    🔒 A DIFFERENT TEACHER, AND THAT IS NOT INCIDENTAL.

    By this point the teacher above has applied to the owner's school, so path 1
    already unlocks them — any path-2 assertion using them would pass whatever
    the invite code did. This section needs somebody who has applied to NOBODY,
    so the only thing that can unlock them is the invitation.
  */
  const INVITEE = { id: 'anita.deshmukh21338@yopmail.com', pw: 'Seeded#Teacher2026!' };
  const IGNORER = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };

  const inviteeToken = await login(INVITEE.id, INVITEE.pw);
  const ignorerToken = await login(IGNORER.id, IGNORER.pw);

  const HI = { authorization: `Bearer ${inviteeToken}`, 'content-type': 'application/json' };
  const HG = { authorization: `Bearer ${ignorerToken}`, 'content-type': 'application/json' };

  const inviteeRow = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(t.TeacherId AS varchar(20)) + '|' + CAST(t.TeacherUid AS varchar(40)) + '|' + u.Email
    FROM t_app_teachers t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE u.Email = '${INVITEE.id}';`)[0].split('|');

  const [inviteeId, inviteeUid, inviteeEmail] = inviteeRow;

  const ignorerRow = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(t.TeacherId AS varchar(20)) + '|' + CAST(t.TeacherUid AS varchar(40))
    FROM t_app_teachers t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE u.Email = '${IGNORER.id}';`)[0].split('|');

  const [ignorerId, ignorerUid] = ignorerRow;

  const inviteeApplications = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_applications WHERE TeacherId = ${inviteeId};`);

  check('premise: the invitee has applied to NOBODY — so only an invite can unlock them',
    inviteeApplications === '0' && unlocked(ownerSchool, inviteeId) === '0',
    `${inviteeApplications} applications, unlocked ${unlocked(ownerSchool, inviteeId)}`);

  /*
    ⚠️ HR HOLDS TEACHER_SEARCH.VIEW AND NOT .INVITE — so this is the permission
    negative, and it runs FIRST: if sending were open to anybody who can search,
    the rest of this section would prove nothing about who may create consent.
  */
  const hrInvite = await j(`${APP}/teacher-search/invites`, {
    method: 'POST', headers: HX,
    body: JSON.stringify({ teacherUid: inviteeUid, branchId: otherBranch, message: 'consent-suite hr' }),
  });

  check('🔴 an HR lead cannot SEND an invitation — searching and inviting are different permissions',
    hrInvite.http === 403, `HTTP ${hrInvite.http} ${hrInvite.body?.code ?? ''}`);

  // ---- SENT ---------------------------------------------------------------
  const sent = await j(`${APP}/teacher-search/invites`, {
    method: 'POST', headers: HO,
    body: JSON.stringify({
      teacherUid: inviteeUid, branchId: ownerBranch,
      message: 'consent-suite: we would like to talk to you',
    }),
  });

  const inviteId = sent.body?.data?.inviteId;

  console.log(`    POST /api/teacher-search/invites  HTTP ${sent.http}  inviteId ${inviteId}`);
  console.log(`    fn_TeacherContactUnlocked(${inviteeId}, ${ownerSchool}) = ${unlocked(ownerSchool, inviteeId)}   <- after SENT\n`);

  check('the invitation is sent',
    sent.http === 200 && inviteId > 0, `inviteId ${inviteId}`);

  check('🔒 SENT UNLOCKS NOTHING — asking is not consent',
    unlocked(ownerSchool, inviteeId) === '0', `${unlocked(ownerSchool, inviteeId)}`);

  const contactAfterSent = await j(`${APP}/teachers/${inviteeUid}/contact`, { headers: HO });

  check('🔒 …and the contact endpoint refuses, with nothing of theirs in the bytes',
    contactAfterSent.http === 403
    && !contactAfterSent.text.toLowerCase().includes(inviteeEmail.toLowerCase()),
    `HTTP ${contactAfterSent.http}`);

  // ---- VIEWED -------------------------------------------------------------
  const viewed = await j(`${APP}/teacher/invites/${inviteId}/viewed`, { method: 'POST', headers: HI });

  const viewedStatus = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(InviteStatusId AS varchar(3)) FROM t_app_teacher_invites WHERE InviteId = ${inviteId};`);

  console.log(`    POST /api/teacher/invites/${inviteId}/viewed  HTTP ${viewed.http}  status now ${viewedStatus}`);
  console.log(`    fn_TeacherContactUnlocked(${inviteeId}, ${ownerSchool}) = ${unlocked(ownerSchool, inviteeId)}   <- after VIEWED\n`);

  check('the teacher opens it, and the status moves to Viewed',
    viewed.http === 200 && viewedStatus === '2', `status ${viewedStatus}`);

  check('🔒 VIEWED UNLOCKS NOTHING — reading a message is not answering it',
    unlocked(ownerSchool, inviteeId) === '0', `${unlocked(ownerSchool, inviteeId)}`);

  check('🔒 …and the contact endpoint still refuses',
    (await j(`${APP}/teachers/${inviteeUid}/contact`, { headers: HO })).http === 403, 'HTTP 403');

  // ---- ACCEPTED -----------------------------------------------------------
  const accepted = await j(`${APP}/teacher/invites/${inviteId}/respond`, {
    method: 'POST', headers: HI,
    body: JSON.stringify({ accept: true, teacherRemarks: 'Happy to talk.' }),
  });

  const unlockAfterAccept = unlocked(ownerSchool, inviteeId);
  const contactAfterAccept = await j(`${APP}/teachers/${inviteeUid}/contact`, { headers: HO });

  console.log(`    POST …/respond {accept:true}  HTTP ${accepted.http}`);
  console.log(`    fn_TeacherContactUnlocked(${inviteeId}, ${ownerSchool}) = ${unlockAfterAccept}   <- after ACCEPTED`);
  console.log(`    GET /api/teachers/{uid}/contact  HTTP ${contactAfterAccept.http}`);
  console.log(`    body: ${contactAfterAccept.text.slice(0, 160)}\n`);

  check('🔒 ACCEPTED UNLOCKS — this is consent path 2, the second and final one (2.56)',
    accepted.http === 200 && unlockAfterAccept === '1', `unlocked ${unlockAfterAccept}`);

  check('🔒 …and the SAME call that refused twice now returns the email',
    contactAfterAccept.http === 200
    && contactAfterAccept.text.toLowerCase().includes(inviteeEmail.toLowerCase()),
    `HTTP ${contactAfterAccept.http}`);

  check('🔒 …for the invited school ONLY — the other school still gets nothing',
    unlocked(otherSchool, inviteeId) === '0'
    && (await j(`${APP}/teachers/${inviteeUid}/contact`, { headers: HX })).http === 403,
    `other school unlocked ${unlocked(otherSchool, inviteeId)}`);

  /*
    🔒 AND THE SEARCH RESULT STILL CARRIES NOTHING, even now that this teacher
    HAS consented. That is the shape rule holding where the privacy rule no
    longer needs it to: a browse surface never carries contact, consented or
    not, because it ends up in a screenshot or an export.
  */
  const searchAfterAccept = await j(`${APP}/teacher-search?pageSize=100`, { headers: HO });

  check('🔒 …and the SEARCH result carries no contact even for a teacher who consented',
    searchAfterAccept.http === 200
    && !searchAfterAccept.text.toLowerCase().includes(inviteeEmail.toLowerCase())
    && !CONTACT_KEYS.some((k) => searchAfterAccept.text.toLowerCase().includes(k.toLowerCase())),
    'no contact keys, no address — the shape rule, not the privacy rule');

  // =========================================================================
  console.log('\n=== 8. 🔒 IGNORED UNLOCKS NOTHING ===');
  // =========================================================================

  /*
    ⚠️ "No" has to be provably different from "not yet answered". Without this
    section, an implementation that unlocked on ANY answered invite would pass
    everything above.
  */
  const toIgnore = await j(`${APP}/teacher-search/invites`, {
    method: 'POST', headers: HO,
    body: JSON.stringify({
      teacherUid: ignorerUid, branchId: ownerBranch,
      message: 'consent-suite: ignored path',
    }),
  });

  const ignoreId = toIgnore.body?.data?.inviteId;

  const ignored = await j(`${APP}/teacher/invites/${ignoreId}/respond`, {
    method: 'POST', headers: HG,
    body: JSON.stringify({ accept: false, teacherRemarks: 'Not looking right now.' }),
  });

  const ignoredStatus = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(InviteStatusId AS varchar(3)) FROM t_app_teacher_invites WHERE InviteId = ${ignoreId};`);

  console.log(`    invite ${ignoreId} answered with accept:false  HTTP ${ignored.http}  status ${ignoredStatus}`);
  console.log(`    fn_TeacherContactUnlocked(${ignorerId}, ${ownerSchool}) = ${unlocked(ownerSchool, ignorerId)}\n`);

  check('an explicit pass is RECORDED, not left as silence',
    ignored.http === 200 && ignoredStatus === '5', `status ${ignoredStatus} (5 = Ignored)`);

  check('🔒 IGNORED UNLOCKS NOTHING — "no" is not "not yet"',
    unlocked(ownerSchool, ignorerId) === '0', `${unlocked(ownerSchool, ignorerId)}`);

  check('🔒 …and the contact endpoint refuses for them too',
    (await j(`${APP}/teachers/${ignorerUid}/contact`, { headers: HO })).http === 403, 'HTTP 403');

  /*
    🔒 THE WHOLE RULE, IN ONE READ. The function must bind to exactly two
    tables — the two consent paths and nothing else. A third would be a third
    path nobody decided on, and 2.56 is LOCKED at two.
  */
  const binds = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT d.referenced_entity_name
    FROM sys.sql_expression_dependencies d
      INNER JOIN sys.objects o ON o.object_id = d.referencing_id
    WHERE o.name = 'fn_TeacherContactUnlocked'
    ORDER BY d.referenced_entity_name;`);

  console.log(`    fn_TeacherContactUnlocked binds to: ${binds.join(', ')}\n`);

  check('🔒 the function binds to EXACTLY the two consent tables — no third path (2.56, LOCKED)',
    binds.length === 2
    && binds[0] === 't_app_applications'
    && binds[1] === 't_app_teacher_invites',
    binds.join(', '));

  check('🔒 …and nothing about subscriptions, plans or saved jobs is in it',
    !binds.some((b) => /subscription|plan|saved/i.test(b)),
    'no payment, no interest — only the teacher\'s own acts');
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
