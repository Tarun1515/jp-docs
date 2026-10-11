/*
  PHASE 3E — live verification over HTTP. REBASED IN 6C-0 (G33).

  ----------------------------------------------------------------------------
  🔴 WHY THIS FILE WAS REWRITTEN RATHER THAN REPAIRED
  ----------------------------------------------------------------------------
  Written in 3E, it signed in as `head.711429@brightfield.edu.in` with a
  password that lived only in a `JP_PW` environment variable at the time. That
  account is not in `local-accounts.md`, so **this suite had not run once since
  3E** — four phases of a file that looked like coverage and was not.

  ⚠️ And what it checks is exactly what 6B changed. Section 4 asserts that the
  locked-contact refusal names what WOULD unlock it. Until 6B that message
  promised "or accept an invitation from you" while no invitation existed
  anywhere in the product — a sentence making an offer the system could not
  keep. 6B built the second consent path and verified that message BY HAND,
  because the suite that owns the claim could not run. Hand-verification is not
  an assertion, which is the whole reason G33 got a number.

  Everything here now stands on accounts in `local-accounts.md`, and the
  Brightfield-specific pieces are derived from the CALLER'S OWN school rather
  than a hardcoded school name — so this file cannot rot that way again.

  ----------------------------------------------------------------------------
  ⚠️ FIXTURES — the gap note's warning, taken seriously
  ----------------------------------------------------------------------------
  Eight other suites stand on these same accounts. Two sections here mutate
  shared state:

    - section 2 suspends and un-verifies the caller's own school to prove the
      public endpoint hides it;
    - section 7 replaces a teacher's subject set to prove full-set semantics.

  Both snapshot first and restore in the `finally`, and section 8 asserts the
  restoration rather than trusting it. A killed run that left Nalanda suspended
  would break every school suite after it with a symptom pointing nowhere.

  Run (both APIs up): node scripts/verify/browse-contract.mjs
*/
import { execFileSync } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';

const APP = 'http://localhost:5299/api';

/*
  🔴 FROM local-accounts.md, NOT FROM AN ENVIRONMENT VARIABLE.

  The 3E version read `JP_PW` and refused to start without it, which is how it
  ended up never starting. A verification script has to stand on the documented
  fixtures or it is not verification, it is a note to self.
*/
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const TEACHER_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

/** The 0% profile — the least entangled teacher, for the contact-lock section. */
const TEACHER_LOCKED = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-Q', q], {
    encoding: 'utf8',
  }).split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body, text };
};

const auth = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
const head = (t) => ({ authorization: `Bearer ${t}` });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

/** Everything this run changes, captured before it changes anything. */
const snapshot = { schoolId: null, isVerified: null, isSuspended: null, subjects: null };

const teacherIdOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(t.TeacherId AS varchar(10)) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${email}';`);

const teacherUidOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(t.TeacherUid AS varchar(50)) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${email}';`);

const unlocked = (teacherId, schoolId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(dbo.fn_TeacherContactUnlocked(${teacherId}, ${schoolId}) AS varchar(2));`);

const subjectsOf = (teacherId) => scalar(`SET NOCOUNT ON;
  SELECT ISNULL(STRING_AGG(CAST(SubjectId AS varchar(10)), ',') WITHIN GROUP (ORDER BY SubjectId), '')
  FROM jp_app.dbo.t_app_teacher_subjects WHERE TeacherId = ${teacherId} AND Is_Deleted = 0;`);

try {
  // =========================================================================
  section('0. ENTRY — the documented accounts, and the state we will disturb');
  // =========================================================================

  const ownerToken = await loginToken(OWNER);
  const teacherSession = await loginSession(TEACHER_A);
  const teacherAToken = teacherSession.accessToken;

  const profile = await j(`${APP}/school/profile`, { headers: head(ownerToken) });

  check('GET /school/profile returns the caller\'s own school', profile.http === 200,
    `${profile.http} · ${profile.body?.data?.schoolName}`);

  check('…and it carries PAN and suspension, which are the own-view fields',
    Object.hasOwn(profile.body?.data ?? {}, 'panNumber')
    && Object.hasOwn(profile.body?.data ?? {}, 'suspensionReason'),
    `panNumber=${profile.body?.data?.panNumber}`);

  const schoolUid = profile.body?.data?.schoolUid;

  /*
    🔴 THE SCHOOL ID COMES FROM THE CALLER, NOT FROM A NAME.

    3E looked up `SchoolName = 'Brightfield Academy'` and used that id against
    the uid of whoever happened to be signed in. Rebased onto a different owner
    those two would be different schools, and the suspension test would have
    suspended one school and queried another — a PASS proving nothing, which is
    worse than a failure.
  */
  snapshot.schoolId = scalar(`SET NOCOUNT ON;
    SELECT CAST(SchoolId AS varchar(10)) FROM jp_app.dbo.t_app_schools WHERE SchoolUid = '${schoolUid}';`);

  const schoolRow = sql(`SET NOCOUNT ON;
    SELECT CAST(IsVerified AS varchar(2)) + '|' + CAST(IsSuspended AS varchar(2))
    FROM jp_app.dbo.t_app_schools WHERE SchoolId = ${snapshot.schoolId};`)[0].split('|');

  [snapshot.isVerified, snapshot.isSuspended] = schoolRow;

  check('🔴 the school id is derived from the CALLER\'S uid, and matches the profile',
    snapshot.schoolId !== '' && schoolUid,
    `schoolUid ${schoolUid} -> SchoolId ${snapshot.schoolId}`);

  check('entry premise: that school is verified and not suspended',
    snapshot.isVerified === '1' && snapshot.isSuspended === '0',
    `IsVerified ${snapshot.isVerified}, IsSuspended ${snapshot.isSuspended}`);

  const lockedId = teacherIdOf(TEACHER_LOCKED.id);
  const lockedUid = teacherUidOf(TEACHER_LOCKED.id);
  const teacherAId = teacherIdOf(TEACHER_A.id);
  const teacherAUid = teacherUidOf(TEACHER_A.id);

  snapshot.subjects = subjectsOf(teacherAId);

  console.log(`\n    school ${snapshot.schoolId} · teacher A ${teacherAId} · locked teacher ${lockedId}`);
  console.log(`    teacher A's subjects, to be restored: [${snapshot.subjects}]\n`);

  check('🔒 entry premise: NEITHER teacher is unlocked for this school',
    unlocked(teacherAId, snapshot.schoolId) === '0' && unlocked(lockedId, snapshot.schoolId) === '0',
    `A ${unlocked(teacherAId, snapshot.schoolId)}, locked ${unlocked(lockedId, snapshot.schoolId)}`);

  // =========================================================================
  section('1. PUBLIC SCHOOL PROFILE — unauthenticated, and 404 when hidden');
  // =========================================================================

  const pub = await j(`${APP}/schools/${schoolUid}/public`);

  check('GET /schools/{uid}/public works with NO auth header', pub.http === 200, `${pub.http}`);

  const pubFields = Object.keys(pub.body?.data ?? {});
  const leakedPublic = ['panNumber', 'organizationUid', 'suspensionReason', 'isSuspended', 'rowVersion', 'schoolId']
    .filter((f) => pubFields.includes(f));

  check('🔴 the public body has no PAN, no org uid, no suspension reason', leakedPublic.length === 0,
    leakedPublic.length ? `LEAKED: ${leakedPublic.join(', ')}` : `${pubFields.length} fields, none of them internal`);

  // 🔴 The test the SQL suite could not write (3C flagged it).
  sql(`UPDATE jp_app.dbo.t_app_schools SET IsSuspended = 1 WHERE SchoolId = ${snapshot.schoolId};`);
  const suspended = await j(`${APP}/schools/${schoolUid}/public`);

  check('🔴 a SUSPENDED school returns 404 from the public endpoint', suspended.http === 404,
    `${suspended.http} · ${suspended.body?.message}`);

  sql(`UPDATE jp_app.dbo.t_app_schools SET IsSuspended = 0 WHERE SchoolId = ${snapshot.schoolId};`);

  sql(`UPDATE jp_app.dbo.t_app_schools SET IsVerified = 0 WHERE SchoolId = ${snapshot.schoolId};`);
  const pending = await j(`${APP}/schools/${schoolUid}/public`);

  check('🔴 an UNVERIFIED (pending) school returns 404 too', pending.http === 404,
    `${pending.http} · ${pending.body?.message}`);

  sql(`UPDATE jp_app.dbo.t_app_schools SET IsVerified = 1 WHERE SchoolId = ${snapshot.schoolId};`);

  check('…and the school is visible again once restored',
    (await j(`${APP}/schools/${schoolUid}/public`)).http === 200, 'back to 200');

  // =========================================================================
  section('2. 🔒 THE BROWSE BODY — read as text, searched by name');
  // =========================================================================

  const browse = await j(`${APP}/teachers/${teacherAUid}/browse`, { headers: head(ownerToken) });

  check('GET /teachers/{uid}/browse returns 200 for a school', browse.http === 200, `${browse.http}`);

  const FORBIDDEN = ['contactEmail', 'contactMobile', 'resumePath', 'dob', 'userUid', 'teacherId', 'rowVersion'];
  const raw = browse.text.toLowerCase();
  const foundInBody = FORBIDDEN.filter((f) => raw.includes(f.toLowerCase()));

  check('🔒 the raw response body contains NO contact field by name', foundInBody.length === 0,
    foundInBody.length ? `FOUND: ${foundInBody.join(', ')}` : 'contactEmail / contactMobile / resumePath / dob all absent from the bytes');

  console.log('\n  --- every field the browse endpoint returns ---');
  for (const [k, v] of Object.entries(browse.body?.data ?? {})) {
    const shown = Array.isArray(v) ? `[${v.length} item${v.length === 1 ? '' : 's'}]` : JSON.stringify(v);
    console.log(`      ${k.padEnd(26)} ${String(shown).slice(0, 60)}`);
  }

  // =========================================================================
  section('3. 🔒 CONTACT — 403, and the message names BOTH consent paths');
  // =========================================================================

  const contact = await j(`${APP}/teachers/${lockedUid}/contact`, { headers: head(ownerToken) });
  const message = contact.body?.message ?? '';

  console.log(`\n    GET /teachers/{uid}/contact  HTTP ${contact.http} · ${contact.body?.code}`);
  console.log(`      "${message}"\n`);

  check('🔒 GET /teachers/{uid}/contact returns 403 while locked', contact.http === 403, `${contact.http}`);

  /*
    🔴 THE ASSERTION G33 EXISTS FOR.

    Until 6B this message named a path the product did not have. 6B built it and
    checked this sentence by hand because this file could not run. Now the
    sentence is asserted, and if a future phase removes the invite path the
    message goes stale LOUDLY instead of quietly.
  */
  check('🔒 …and it names the FIRST consent path — applying', /appl/i.test(message), `"${message.slice(0, 48)}…"`);

  check('🔒 …and the SECOND — accepting an invitation (built in 6B, 2.74)',
    /invit/i.test(message), /invit/i.test(message) ? 'named' : 'MISSING — the message promises a path that does not exist');

  check('🔒 …and it does not offer PAYING as a third way (2.56 LOCKED)',
    !/plan|subscri|upgrade|pay|billing|purchas/i.test(message),
    'no plan, no upgrade, no payment in the sentence');

  const lockedEmail = scalar(`SET NOCOUNT ON;
    SELECT u.Email FROM jp_sso.dbo.t_sso_users u
      INNER JOIN jp_app.dbo.t_app_teachers t ON t.UserUid = u.UserUid
    WHERE t.TeacherId = ${lockedId};`);

  check('🔒 …and the refusal carries no email in its bytes',
    !contact.text.includes(lockedEmail), `${lockedEmail} absent`);

  // =========================================================================
  section('4. BRANCH SCOPE — 404, not 403 (2.6)');
  // =========================================================================

  const branches = await j(`${APP}/branches`, { headers: head(ownerToken) });

  check('GET /branches returns the owner\'s campuses', branches.http === 200,
    `${branches.body?.data?.length} branch(es)`);

  const otherBranchId = scalar(`SET NOCOUNT ON;
    SELECT TOP 1 CAST(b.BranchId AS varchar(10))
    FROM jp_app.dbo.t_app_school_branches b
    WHERE b.SchoolId <> ${snapshot.schoolId} AND b.Is_Deleted = 0;`);

  const foreign = await j(`${APP}/branches/${otherBranchId}`, { headers: head(ownerToken) });

  check('🔴 another school\'s branch is 404, NOT 403', foreign.http === 404,
    `${foreign.http} · ${foreign.body?.message}`);

  // =========================================================================
  section('5. TEACHER A CANNOT REACH TEACHER B');
  // =========================================================================

  const own = await j(`${APP}/teacher/profile`, { headers: head(teacherAToken) });

  check('GET /teacher/profile returns the caller\'s own profile', own.http === 200,
    `${own.body?.data?.fullName}`);

  const bExpId = scalar(`SET NOCOUNT ON;
    SELECT TOP 1 CAST(e.Id AS varchar(10))
    FROM jp_app.dbo.t_app_teacher_experiences e
    WHERE e.TeacherId <> ${teacherAId} AND e.Is_Deleted = 0;`);

  check('premise: somebody else has an experience row to try to reach',
    bExpId !== '', `row ${bExpId}`);

  const hijackEdit = await j(`${APP}/teacher/experiences/${bExpId}`, {
    method: 'PUT',
    headers: auth(teacherAToken),
    body: JSON.stringify({ schoolName: 'HIJACKED', fromDate: '2020-01-01', isCurrent: true }),
  });

  check('🔴 A editing B\'s experience by id → 404', hijackEdit.http === 404,
    `${hijackEdit.http} · ${hijackEdit.body?.message}`);

  const hijackDelete = await j(`${APP}/teacher/experiences/${bExpId}`, {
    method: 'DELETE', headers: head(teacherAToken),
  });

  check('🔴 A deleting B\'s experience by id → 404', hijackDelete.http === 404, `${hijackDelete.http}`);

  check('…and B\'s row is untouched',
    scalar(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4))
      FROM jp_app.dbo.t_app_teacher_experiences WHERE Id = ${bExpId} AND Is_Deleted = 0;`) === '1',
    '1 live row');

  const teacherBrowsing = await j(`${APP}/teachers/${teacherAUid}/browse`, { headers: head(teacherAToken) });

  check('🔴 a TEACHER cannot use the school browse endpoint → 403', teacherBrowsing.http === 403,
    `${teacherBrowsing.http}`);

  const teacherAtSchool = await j(`${APP}/school/profile`, { headers: head(teacherAToken) });

  check('🔴 a TEACHER hitting /school/profile is refused',
    teacherAtSchool.http === 403 || teacherAtSchool.http === 400,
    `${teacherAtSchool.http} · ${teacherAtSchool.body?.message}`);

  // =========================================================================
  section('6. FULL-SET SYNC over HTTP');
  // =========================================================================

  /*
    ⚠️ THE REPLACEMENT SET IS CHOSEN SO THE TEST CANNOT BE A NO-OP.

    3E sent `[1]` to a teacher who had several subjects. Rebased onto a teacher
    whose only subject happened to BE 1, that same call would have asserted
    nothing at all. So the set is picked to differ from whatever is there.
  */
  const replacement = snapshot.subjects === '1,2' ? '3,4' : '1,2';

  const put = await j(`${APP}/teacher/subjects`, {
    method: 'PUT', headers: auth(teacherAToken), body: JSON.stringify({ ids: replacement.split(',').map(Number) }),
  });

  const after = subjectsOf(teacherAId);

  check(`PUT /teacher/subjects with [${replacement}] leaves ONLY those`,
    put.http === 200 && after === replacement,
    `[${snapshot.subjects}] -> [${after}]  (full-set semantics, as documented)`);

  await j(`${APP}/teacher/subjects`, {
    method: 'PUT', headers: auth(teacherAToken),
    body: JSON.stringify({ ids: snapshot.subjects ? snapshot.subjects.split(',').map(Number) : [] }),
  });

  check('…and re-sending the original set restores it',
    subjectsOf(teacherAId) === snapshot.subjects, `[${after}] -> [${subjectsOf(teacherAId)}]`);
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  // =========================================================================
  section('7. EXIT — everything this run disturbed, put back');
  // =========================================================================

  /*
    ⚠️ RESTORED IN THE FINALLY, and then ASSERTED. A killed run that left this
    school suspended would break every school suite after it, and the symptom
    would point at those suites rather than at this one.
  */
  if (snapshot.schoolId) {
    sql(`UPDATE jp_app.dbo.t_app_schools
            SET IsVerified = ${snapshot.isVerified}, IsSuspended = ${snapshot.isSuspended}
          WHERE SchoolId = ${snapshot.schoolId};`);

    const now = sql(`SET NOCOUNT ON;
      SELECT CAST(IsVerified AS varchar(2)) + '|' + CAST(IsSuspended AS varchar(2))
      FROM jp_app.dbo.t_app_schools WHERE SchoolId = ${snapshot.schoolId};`)[0];

    check('🔴 exit: the school is verified and un-suspended exactly as found',
      now === `${snapshot.isVerified}|${snapshot.isSuspended}`,
      `IsVerified|IsSuspended ${now}`);
  }

  if (snapshot.subjects !== null) {
    const teacherAId = teacherIdOf(TEACHER_A.id);

    sql(`SET NOCOUNT ON; USE jp_app;
      DELETE FROM t_app_teacher_subjects WHERE TeacherId = ${teacherAId};
      ${snapshot.subjects
        ? `INSERT INTO t_app_teacher_subjects (TeacherId, SubjectId, Is_Active, Is_Deleted, CreatedOn)
           SELECT ${teacherAId}, value, 1, 0, SYSUTCDATETIME() FROM STRING_SPLIT('${snapshot.subjects}', ',');`
        : ''}`);

    check('🔴 exit: the teacher\'s subject set is the one we found',
      subjectsOf(teacherAId) === snapshot.subjects,
      `[${subjectsOf(teacherAId)}] (found [${snapshot.subjects}])`);

    check('🔒 exit: nobody was unlocked by this run',
      unlocked(teacherAId, snapshot.schoolId) === '0'
      && unlocked(teacherIdOf(TEACHER_LOCKED.id), snapshot.schoolId) === '0',
      'both still locked');
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log('='.repeat(74));

process.exitCode = failed.length ? 1 : 0;
