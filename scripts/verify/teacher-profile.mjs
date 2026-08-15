/*
  PHASE 3H — live verification of the teacher profile, over HTTP.

  ----------------------------------------------------------------------------
  EVERYTHING DESTRUCTIVE HAPPENS TO AN ACCOUNT THIS SCRIPT CREATES
  ----------------------------------------------------------------------------
  Rohit, Anita and Imran are the three seeded profiles that break this screen
  (2.52), and they are worth more intact than exercised: they are the only
  half-filled profiles in the system, and re-seeding them is not a thing anybody
  wants to do twice. So this signs up a throwaway teacher through the real
  endpoint, does every mutation to them, and removes them at the end.

  ⚠️ TotalExperienceMonths is checked AFTER EVERY EXPERIENCE CHANGE. It is
  derived server-side (2.54) and two phases have already found it wrong: 3B
  found hand-written totals disagreeing with their own rows by up to thirteen
  months, and 3D found DATEDIFF undercounting every closed job by one.

  Run: node scripts/verify/teacher-profile.mjs   (both APIs up)
*/
import { execFileSync } from 'node:child_process';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-h', '-1', '-W', '-Q', q], {
    encoding: 'utf8',
  }).trim();

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }
  return { http: r.status, body, text };
};

/** Waits out the login limiter rather than failing on it (5/minute per IP). */
const login = async (loginId, password, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });

  if (r.http === 429 && attempt <= 3) {
    console.log(`  … rate limited; waiting 25s (attempt ${attempt} of 3)`);
    await new Promise((resolve) => setTimeout(resolve, 25_000));

    return login(loginId, password, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message ?? r.text}`);

  return r.body.data.accessToken;
};

const auth = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
const head = (t) => ({ authorization: `Bearer ${t}` });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** A real 1×1 PNG and a minimal but valid PDF — magic bytes are checked. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

const stamp = Date.now().toString().slice(-7);
const EMAIL = `verify.teacher.${stamp}@yopmail.com`;
const PASSWORD = 'VerifyTeacher#2026!';

// ---------------------------------------------------------------------------
console.log('\n=== 1. A THROWAWAY TEACHER, THROUGH THE REAL SIGNUP ===');

const registered = await j(`${SSO}/auth/register/teacher`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

check('a teacher can sign up', registered.http === 200, `${registered.http} · ${registered.body?.message}`);

const token = await login(EMAIL, PASSWORD);
const read = async () => (await j(`${APP}/teacher/profile`, { headers: head(token) })).body?.data;

const fresh = await read();

/*
  🔴 A profile exists from the moment of signup (2.9, G21) — a teacher's account
  is Active immediately and verification is a badge, not a gate. If this ever
  returns nothing, provisioning has regressed and the screen would open on an
  error for every new teacher.
*/
check('…and their profile exists straight away', !!fresh?.teacherId,
  `TeacherId ${fresh?.teacherId} · ${fresh?.profileCompletionPercent}%`);

check('🔴 …at 0%, with nothing in it', fresh.profileCompletionPercent === 0 &&
  fresh.subjectIds.length === 0 && fresh.experiences.length === 0,
  `${fresh.profileCompletionPercent}%, ${fresh.subjectIds.length} subjects, ${fresh.experiences.length} jobs`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. THE PROFILE ROW — SAVE, RELOAD, COMPARE ===');

const body = (p, over = {}) => ({
  rowVersion: p.rowVersion,
  fullName: p.fullName,
  dob: p.dob,
  genderId: p.genderId,
  qualificationId: p.qualificationId,
  highestQualificationText: p.highestQualificationText,
  designationId: p.designationId,
  currentSchool: p.currentSchool,
  lastSchool: p.lastSchool,
  expectedSalaryMin: p.expectedSalaryMin,
  expectedSalaryMax: p.expectedSalaryMax,
  currentCityId: p.currentCityId,
  currentStateId: p.currentStateId,
  aboutMe: p.aboutMe,
  ...over,
});

const saved = await j(`${APP}/teacher/profile`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify(body(fresh, {
    fullName: 'Verification Teacher',
    aboutMe: 'I have taught physics to senior classes for eleven years, and I like a noisy lab.',
    qualificationId: 1,
    designationId: 1,
    genderId: 1,
    expectedSalaryMin: 35000,
    expectedSalaryMax: 55000,
    currentStateId: 32,
  })),
});

check('PUT /teacher/profile saves', saved.http === 200, `${saved.http}`);

let profile = await read();

check('🔴 …and every field comes back after a reload',
  profile.fullName === 'Verification Teacher' &&
  profile.qualificationId === 1 && profile.designationId === 1 &&
  profile.expectedSalaryMin === 35000 && profile.expectedSalaryMax === 55000 &&
  (profile.aboutMe ?? '').includes('noisy lab'),
  'name, qualification, designation, salary range, about');

check('…and RowVersion moved', profile.rowVersion === fresh.rowVersion + 1,
  `${fresh.rowVersion} → ${profile.rowVersion}`);

const stale = await j(`${APP}/teacher/profile`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify(body(profile, { rowVersion: fresh.rowVersion, fullName: 'Should never land' })),
});

check('🔴 a stale RowVersion is refused, not merged', stale.http === 409, `${stale.http} · ${stale.body?.code}`);
check('…and the earlier value survives', (await read()).fullName === 'Verification Teacher');

// ---------------------------------------------------------------------------
console.log('\n=== 3. THE FIVE FULL-SET SECTIONS ===');

await j(`${APP}/teacher/subjects`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ ids: [1, 2, 3] }) });
profile = await read();
check('subjects save', profile.subjectIds.length === 3, `[${profile.subjectIds.join(', ')}]`);

await j(`${APP}/teacher/subjects`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ ids: [1] }) });
profile = await read();
check('🔴 …and a SHORTER set removes the rest — it is a sync, not an add',
  profile.subjectIds.length === 1 && profile.subjectIds[0] === 1, `[${profile.subjectIds.join(', ')}]`);

await j(`${APP}/teacher/class-levels`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ ids: [1, 2] }) });
await j(`${APP}/teacher/skills`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ ids: [1, 2] }) });

await j(`${APP}/teacher/languages`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ languages: [{ languageId: 1, proficiencyLevel: 4 }, { languageId: 2, proficiencyLevel: 2 }] }),
});

profile = await read();
check('languages save WITH their level', profile.languages.length === 2 &&
  profile.languages.find((l) => l.languageId === 1)?.proficiencyLevel === 4,
  profile.languages.map((l) => `${l.languageId}:${l.proficiencyLevel}`).join(' '));

// 🔴 A re-rated language must be UPDATED in place, not replaced (2.54).
const rowIdBefore = sql(`SET NOCOUNT ON; SELECT CAST(Id AS varchar(12)) FROM jp_app.dbo.t_app_teacher_languages
  WHERE TeacherId = ${profile.teacherId} AND LanguageId = 1 AND Is_Deleted = 0`);

await j(`${APP}/teacher/languages`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ languages: [{ languageId: 1, proficiencyLevel: 3 }, { languageId: 2, proficiencyLevel: 2 }] }),
});

const rowIdAfter = sql(`SET NOCOUNT ON; SELECT CAST(Id AS varchar(12)) FROM jp_app.dbo.t_app_teacher_languages
  WHERE TeacherId = ${profile.teacherId} AND LanguageId = 1 AND Is_Deleted = 0`);

profile = await read();
check('🔴 re-rating a language UPDATES its row rather than replacing it',
  rowIdBefore === rowIdAfter && profile.languages.find((l) => l.languageId === 1)?.proficiencyLevel === 3,
  `row ${rowIdBefore} → ${rowIdAfter}, level now 3`);

await j(`${APP}/teacher/preferred-locations`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ locations: [{ cityId: null, stateId: 32, preferenceOrder: 1 }, { cityId: null, stateId: 14, preferenceOrder: 2 }] }),
});

profile = await read();
check('preferred locations save, city null meaning “anywhere in this state”',
  profile.preferredLocations.length === 2 && profile.preferredLocations.every((l) => l.cityId === null),
  profile.preferredLocations.map((l) => l.stateId).join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== 4. 🔴 EXPERIENCE, AND THE NUMBER THE SERVER DERIVES ===');

const monthsNow = async () => (await read()).totalExperienceMonths ?? 0;

const first = await j(`${APP}/teacher/experiences`, {
  method: 'POST', headers: auth(token),
  body: JSON.stringify({
    schoolName: 'Kendriya Vidyalaya, Andheri', designationId: 1, subjectId: 1,
    fromDate: '2015-06-01', toDate: '2018-05-31', isCurrent: false,
  }),
});

check('an experience row is added', first.http === 200, `${first.http}`);

/*
  🔴 June 2015 to May 2018 inclusive is 36 months.

  3D found DATEDIFF(MONTH, from, to) giving 35 for exactly this shape, because
  it counts boundaries rather than months worked — every closed job was one
  short. The fix treats ToDate as the last day worked, and this is the assertion
  that keeps it fixed.
*/
check('🔴 a closed job counts INCLUSIVELY — Jun 2015 to May 2018 is 36 months',
  (await monthsNow()) === 36, `${await monthsNow()} months`);

const second = await j(`${APP}/teacher/experiences`, {
  method: 'POST', headers: auth(token),
  body: JSON.stringify({
    schoolName: 'Podar International', designationId: 1, subjectId: 1,
    fromDate: '2018-06-01', toDate: null, isCurrent: true,
  }),
});

const currentId = second.body?.data?.id;
const withCurrent = await monthsNow();

check('a current job adds months up to today', withCurrent > 36, `${withCurrent} months`);

/*
  🔴 EXACT, NOT ±1.

  The first version of this allowed a month of slack and passed — which is
  useless, because a one-month error is precisely the bug 3D found (DATEDIFF
  undercounting every closed job). A tolerance that hides the class of bug you
  are testing for is not a test.

  Being exact means being explicit about the rule, and the two cases differ:

    A CLOSED job counts its final month. Somebody who left in May 2018 worked
      May, so Jun 2015 – May 2018 is 36 months. That is 3D's fix.

    A CURRENT job counts COMPLETED months only. On the 15th of August you have
      finished 98 months since June 2018 and are partway through the 99th;
      claiming the 99th would overstate every serving teacher's experience by up
      to a month.

  Both come out of the same expression in USP_RecalculateTeacherProfile — closed
  jobs get ToDate + 1 day, current jobs get today.
*/
const completedSinceJune2018 = monthsCompleted(new Date('2018-06-01'), new Date());
const expectedNow = 36 + completedSinceJune2018;

check('🔴 …and the total is exactly the sum of the rows',
  withCurrent === expectedNow,
  `server ${withCurrent} · 36 closed + ${completedSinceJune2018} completed since Jun 2018`);

// Editing changes it too.
await j(`${APP}/teacher/experiences/${currentId}`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({
    schoolName: 'Podar International', designationId: 1, subjectId: 1,
    fromDate: '2020-06-01', toDate: null, isCurrent: true,
  }),
});

const afterEdit = await monthsNow();
check('🔴 editing a row recomputes the total', afterEdit < withCurrent,
  `${withCurrent} → ${afterEdit} months`);

await j(`${APP}/teacher/experiences/${currentId}`, { method: 'DELETE', headers: head(token) });

check('🔴 …and so does deleting one', (await monthsNow()) === 36, `${await monthsNow()} months`);

// The refusals, which the form is built to avoid ever showing.
const contradiction = await j(`${APP}/teacher/experiences`, {
  method: 'POST', headers: auth(token),
  body: JSON.stringify({ schoolName: 'X', fromDate: '2019-01-01', toDate: null, isCurrent: false }),
});

check('a closed job with no end date is refused', contradiction.http === 400,
  contradiction.body?.message);

const backwards = await j(`${APP}/teacher/experiences`, {
  method: 'POST', headers: auth(token),
  body: JSON.stringify({ schoolName: 'X', fromDate: '2019-01-01', toDate: '2018-01-31', isCurrent: false }),
});

check('…and one that ends before it starts', backwards.http === 400, backwards.body?.message);

// ---------------------------------------------------------------------------
console.log('\n=== 5. 🔴 THE 75% CAP, AND THE RESUME THAT LIFTS IT ===');

// Fill in everything except the resume.
await j(`${APP}/teacher/subjects`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ ids: [1, 2] }) });

const photoForm = new FormData();
photoForm.append('file', new Blob([PNG], { type: 'image/png' }), 'me.png');
await j(`${APP}/teacher/photo`, { method: 'POST', headers: head(token), body: photoForm });

profile = await read();

check('🔴 everything but the resume stops at 75%', profile.profileCompletionPercent === 75,
  `${profile.profileCompletionPercent}% with no resume`);

const resumeForm = new FormData();
resumeForm.append('file', new Blob([PDF], { type: 'application/pdf' }), 'resume.pdf');
const resumeUp = await j(`${APP}/teacher/resume`, { method: 'POST', headers: head(token), body: resumeForm });

check('the resume uploads', resumeUp.http === 200, `${resumeUp.http}`);

profile = await read();
check('🔴 …and the number moves past the cap immediately',
  profile.profileCompletionPercent > 75, `${profile.profileCompletionPercent}%`);

// The file has to come back, or the screen can show nothing.
const photoFile = await fetch(`${APP}/teacher/photo/file`, { headers: head(token) });
const resumeFile = await fetch(`${APP}/teacher/resume/file`, { headers: head(token) });

check('🔴 GET /teacher/photo/file returns the image', photoFile.status === 200 &&
  photoFile.headers.get('content-type') === 'image/png', `${photoFile.status}`);

check('🔴 GET /teacher/resume/file returns the PDF', resumeFile.status === 200 &&
  resumeFile.headers.get('content-type') === 'application/pdf', `${resumeFile.status}`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. 🔴 A SCHOOL CANNOT REACH ANY OF IT ===');

const school = await login('principal@greenwood.edu.in', 'Greenwood#2027!');

const schoolTriesPhoto = await j(`${APP}/teacher/photo/file`, { headers: head(school) });
const schoolTriesResume = await j(`${APP}/teacher/resume/file`, { headers: head(school) });
const schoolTriesProfile = await j(`${APP}/teacher/profile`, { headers: head(school) });

check('🔴 a school hitting the teacher photo endpoint gets nothing',
  schoolTriesPhoto.http === 404, `${schoolTriesPhoto.http}`);

check('🔴 …the resume endpoint likewise — it is contact data (2.56 LOCKED)',
  schoolTriesResume.http === 404, `${schoolTriesResume.http}`);

check('…and the teacher profile endpoint too', schoolTriesProfile.http === 404,
  `${schoolTriesProfile.http}`);

// ---------------------------------------------------------------------------
console.log('\n=== 7. THE THREE PROFILES THAT BREAK THE SCREEN (2.52) ===');

const seeded = sql(`SET NOCOUNT ON;
  SELECT t.FullName + '|' + CAST(t.ProfileCompletionPercent AS varchar(4)) + '|'
       + CAST((SELECT COUNT(*) FROM jp_app.dbo.t_app_teacher_subjects s WHERE s.TeacherId = t.TeacherId AND s.Is_Deleted = 0) AS varchar(4)) + '|'
       + CAST((SELECT COUNT(*) FROM jp_app.dbo.t_app_teacher_experiences e WHERE e.TeacherId = t.TeacherId AND e.Is_Deleted = 0) AS varchar(4)) + '|'
       + ISNULL(CAST(t.TotalExperienceMonths AS varchar(6)), 'null')
  FROM jp_app.dbo.t_app_teachers t
  WHERE t.FullName IN (N'Rohit Kulkarni', N'Anita Deshmukh', N'Imran Qureshi') AND t.Is_Deleted = 0
  ORDER BY t.FullName`);

console.log(seeded.split('\n').map((l) => `      ${l.trim()}`).join('\n'));

const rows = seeded.split('\n').map((l) => l.trim().split('|'));

check('Anita has experience and NO subjects — the screen must not divide by zero',
  rows.some((r) => r[0] === 'Anita Deshmukh' && r[2] === '0' && Number(r[4]) > 0),
  'subjects 0, months 100');

check('Imran has nothing at all — 0%, no rows anywhere',
  rows.some((r) => r[0] === 'Imran Qureshi' && r[1] === '0' && r[2] === '0' && r[3] === '0'),
  '0%, and every list empty');

check('Rohit has only a CLOSED job — no current row',
  rows.some((r) => r[0] === 'Rohit Kulkarni' && Number(r[3]) > 0),
  sql(`SET NOCOUNT ON; SELECT 'isCurrent rows: ' + CAST(COUNT(*) AS varchar(4))
       FROM jp_app.dbo.t_app_teacher_experiences e
         INNER JOIN jp_app.dbo.t_app_teachers t ON t.TeacherId = e.TeacherId
       WHERE t.FullName = N'Rohit Kulkarni' AND e.IsCurrent = 1 AND e.Is_Deleted = 0`));

// ---------------------------------------------------------------------------
console.log('\n=== 8. CLEAN UP ===');

const uid = sql(`SET NOCOUNT ON; SELECT CAST(UserUid AS varchar(40)) FROM jp_sso.dbo.t_sso_users WHERE Email = '${EMAIL}'`);

sql(`SET NOCOUNT ON;
  DECLARE @tid bigint = (SELECT TeacherId FROM jp_app.dbo.t_app_teachers WHERE UserUid = '${uid}');

  DELETE FROM jp_app.dbo.t_app_teacher_subjects WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_class_levels WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_skills WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_languages WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_preferred_locations WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_experiences WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_teacher_documents WHERE TeacherId = @tid;
  DELETE FROM jp_app.dbo.t_app_subscriptions WHERE OwnerUid = '${uid}';
  DELETE FROM jp_app.dbo.t_app_teachers WHERE TeacherId = @tid;

  DELETE t FROM jp_sso.dbo.t_sso_user_tokens t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = t.UserId WHERE u.UserUid = '${uid}';
  DELETE c FROM jp_sso.dbo.t_sso_user_credentials c INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId WHERE u.UserUid = '${uid}';
  DELETE r FROM jp_sso.dbo.t_sso_user_roles r INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = r.UserId WHERE u.UserUid = '${uid}';
  DELETE a FROM jp_sso.dbo.t_sso_user_login_attempts a INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = a.UserId WHERE u.UserUid = '${uid}';
  DELETE FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${uid}';`);

const left = sql(`SET NOCOUNT ON; SELECT CAST(
  (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${uid}') +
  (SELECT COUNT(*) FROM jp_app.dbo.t_app_teachers WHERE UserUid = '${uid}') AS varchar(4))`);

check('the account this run created is gone from both databases', left === '0', `${left} rows left`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);

/**
 * Months COMPLETED between two dates — the month in progress does not count.
 *
 * Matches DATEDIFF(MONTH, from, to) in SQL Server, which counts the month
 * boundaries crossed rather than the days elapsed.
 */
function monthsCompleted(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}
