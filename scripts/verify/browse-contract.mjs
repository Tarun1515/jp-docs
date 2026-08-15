/*
  PHASE 3E — live verification over HTTP.

  Every claim in the phase notes, checked against a running API rather than
  asserted. The one that matters is section 3: the browse response body is read
  as TEXT and searched for contact field names, so a widened DTO fails here
  loudly rather than leaking quietly.
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

const login = async (loginId, password) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });
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

const PW = process.env.JP_PW ?? '';
if (!PW) {
  console.error('Set JP_PW to the shared local password (see local-accounts.md).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. SCHOOL PROFILE, resolved from the token ===');

const owner = await login('head.711429@brightfield.edu.in', PW);

const profile = await j(`${APP}/school/profile`, { headers: head(owner) });
check('GET /school/profile returns the caller\'s own school', profile.http === 200,
  `${profile.http} · ${profile.body?.data?.schoolName}`);
check('…and it carries PAN and suspension, which are the own-view fields',
  Object.hasOwn(profile.body?.data ?? {}, 'panNumber') && Object.hasOwn(profile.body?.data ?? {}, 'suspensionReason'),
  `panNumber=${profile.body?.data?.panNumber}`);

const schoolUid = profile.body?.data?.schoolUid;

// ---------------------------------------------------------------------------
console.log('\n=== 2. PUBLIC SCHOOL PROFILE — unauthenticated, and 404 when hidden ===');

const pub = await j(`${APP}/schools/${schoolUid}/public`);
check('GET /schools/{uid}/public works with NO auth header', pub.http === 200, `${pub.http}`);

const pubFields = Object.keys(pub.body?.data ?? {});
const leakedPublic = ['panNumber', 'organizationUid', 'suspensionReason', 'isSuspended', 'rowVersion', 'schoolId']
  .filter((f) => pubFields.includes(f));
check('🔴 the public body has no PAN, no org uid, no suspension reason', leakedPublic.length === 0,
  leakedPublic.length ? `LEAKED: ${leakedPublic.join(', ')}` : `${pubFields.length} fields, none of them internal`);

// 🔴 The test the SQL suite could not write (3C flagged it).
const brightfieldId = sql(`SET NOCOUNT ON; SELECT CAST(SchoolId AS varchar(10)) FROM jp_app.dbo.t_app_schools WHERE SchoolName='Brightfield Academy';`);

sql(`UPDATE jp_app.dbo.t_app_schools SET IsSuspended=1 WHERE SchoolId=${brightfieldId};`);
const suspended = await j(`${APP}/schools/${schoolUid}/public`);
check('🔴 a SUSPENDED school returns 404 from the public endpoint', suspended.http === 404,
  `${suspended.http} · ${suspended.body?.message}`);
sql(`UPDATE jp_app.dbo.t_app_schools SET IsSuspended=0 WHERE SchoolId=${brightfieldId};`);

sql(`UPDATE jp_app.dbo.t_app_schools SET IsVerified=0 WHERE SchoolId=${brightfieldId};`);
const pending = await j(`${APP}/schools/${schoolUid}/public`);
check('🔴 an UNVERIFIED (pending) school returns 404 too', pending.http === 404,
  `${pending.http} · ${pending.body?.message}`);
sql(`UPDATE jp_app.dbo.t_app_schools SET IsVerified=1 WHERE SchoolId=${brightfieldId};`);

// ---------------------------------------------------------------------------
console.log('\n=== 3. 🔴 THE BROWSE BODY — read as text, searched by name ===');

const teacherUid = sql(`SET NOCOUNT ON; SELECT CAST(TeacherUid AS varchar(50)) FROM jp_app.dbo.t_app_teachers WHERE FullName='Meera Iyer';`);

const browse = await j(`${APP}/teachers/${teacherUid}/browse`, { headers: head(owner) });
check('GET /teachers/{uid}/browse returns 200 for a school', browse.http === 200, `${browse.http}`);

const FORBIDDEN = ['contactEmail', 'contactMobile', 'resumePath', 'dob', 'userUid', 'teacherId', 'rowVersion'];
const raw = browse.text.toLowerCase();
const foundInBody = FORBIDDEN.filter((f) => raw.includes(f.toLowerCase()));

check('🔴 the raw response body contains NO contact field by name', foundInBody.length === 0,
  foundInBody.length ? `FOUND: ${foundInBody.join(', ')}` : 'none of contactEmail/contactMobile/resumePath/dob present');

console.log('\n  --- every field the browse endpoint returns ---');
for (const [k, v] of Object.entries(browse.body?.data ?? {})) {
  const shown = Array.isArray(v) ? `[${v.length} item${v.length === 1 ? '' : 's'}]` : JSON.stringify(v);
  console.log(`      ${k.padEnd(26)} ${String(shown).slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. 🔴 CONTACT — 403 with the reason ===');

const contact = await j(`${APP}/teachers/${teacherUid}/contact`, { headers: head(owner) });
check('🔴 GET /teachers/{uid}/contact returns 403 while locked', contact.http === 403, `${contact.http}`);
check('…and the message names what WOULD unlock it',
  (contact.body?.message ?? '').includes('apply') && (contact.body?.message ?? '').includes('invit'),
  `"${contact.body?.message}"`);

// ---------------------------------------------------------------------------
console.log('\n=== 5. BRANCH SCOPE — 404, not 403 ===');

const branches = await j(`${APP}/branches`, { headers: head(owner) });
check('GET /branches returns the owner\'s campuses', branches.http === 200,
  `${branches.body?.data?.length} branch(es)`);

// A branch belonging to a DIFFERENT school.
const otherBranchId = sql(`SET NOCOUNT ON;
SELECT TOP 1 CAST(b.BranchId AS varchar(10))
FROM jp_app.dbo.t_app_school_branches b
WHERE b.SchoolId <> ${brightfieldId} AND b.Is_Deleted = 0;`);

const foreign = await j(`${APP}/branches/${otherBranchId}`, { headers: head(owner) });
check('🔴 another school\'s branch is 404, NOT 403', foreign.http === 404,
  `${foreign.http} · ${foreign.body?.message}`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. TEACHER A CANNOT REACH TEACHER B ===');

const teacherA = await login('meera.iyer.85999@yopmail.com', 'Teacher#2026!');

const own = await j(`${APP}/teacher/profile`, { headers: head(teacherA) });
check('GET /teacher/profile returns the caller\'s own profile', own.http === 200,
  `${own.body?.data?.fullName}`);

// B's experience row id.
const bExpId = sql(`SET NOCOUNT ON;
SELECT TOP 1 CAST(e.Id AS varchar(10))
FROM jp_app.dbo.t_app_teacher_experiences e
  JOIN jp_app.dbo.t_app_teachers t ON t.TeacherId = e.TeacherId
WHERE t.FullName <> 'Meera Iyer' AND e.Is_Deleted = 0;`);

const hijackEdit = await j(`${APP}/teacher/experiences/${bExpId}`, {
  method: 'PUT',
  headers: auth(teacherA),
  body: JSON.stringify({ schoolName: 'HIJACKED', fromDate: '2020-01-01', isCurrent: true }),
});
check('🔴 A editing B\'s experience by id → 404', hijackEdit.http === 404,
  `${hijackEdit.http} · ${hijackEdit.body?.message}`);

const hijackDelete = await j(`${APP}/teacher/experiences/${bExpId}`, {
  method: 'DELETE', headers: head(teacherA),
});
check('🔴 A deleting B\'s experience by id → 404', hijackDelete.http === 404, `${hijackDelete.http}`);

const stillThere = sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4)) FROM jp_app.dbo.t_app_teacher_experiences WHERE Id=${bExpId} AND Is_Deleted=0;`);
check('…and B\'s row is untouched', stillThere === '1', `${stillThere} live row`);

// A teacher cannot browse the teacher directory at all.
const teacherBrowsing = await j(`${APP}/teachers/${teacherUid}/browse`, { headers: head(teacherA) });
check('🔴 a TEACHER cannot use the school browse endpoint → 403', teacherBrowsing.http === 403,
  `${teacherBrowsing.http}`);

// A teacher cannot reach the school profile endpoints.
const teacherAtSchool = await j(`${APP}/school/profile`, { headers: head(teacherA) });
check('🔴 a TEACHER hitting /school/profile is refused', teacherAtSchool.http === 403 || teacherAtSchool.http === 400,
  `${teacherAtSchool.http} · ${teacherAtSchool.body?.message}`);

// ---------------------------------------------------------------------------
console.log('\n=== 7. FULL-SET SYNC over HTTP ===');

const before = sql(`SET NOCOUNT ON;
SELECT STRING_AGG(CAST(SubjectId AS varchar(10)), ',') WITHIN GROUP (ORDER BY SubjectId)
FROM jp_app.dbo.t_app_teacher_subjects s
  JOIN jp_app.dbo.t_app_teachers t ON t.TeacherId = s.TeacherId
WHERE t.FullName = 'Meera Iyer' AND s.Is_Deleted = 0;`);

const put = await j(`${APP}/teacher/subjects`, {
  method: 'PUT', headers: auth(teacherA), body: JSON.stringify({ ids: [1] }),
});

const after = sql(`SET NOCOUNT ON;
SELECT STRING_AGG(CAST(SubjectId AS varchar(10)), ',') WITHIN GROUP (ORDER BY SubjectId)
FROM jp_app.dbo.t_app_teacher_subjects s
  JOIN jp_app.dbo.t_app_teachers t ON t.TeacherId = s.TeacherId
WHERE t.FullName = 'Meera Iyer' AND s.Is_Deleted = 0;`);

check('PUT /teacher/subjects with [1] leaves ONLY subject 1', put.http === 200 && after === '1',
  `${before} -> ${after}  (full-set semantics, as documented)`);

// Put it back.
await j(`${APP}/teacher/subjects`, {
  method: 'PUT', headers: auth(teacherA),
  body: JSON.stringify({ ids: before.split(',').map(Number) }),
});

const restored = sql(`SET NOCOUNT ON;
SELECT STRING_AGG(CAST(SubjectId AS varchar(10)), ',') WITHIN GROUP (ORDER BY SubjectId)
FROM jp_app.dbo.t_app_teacher_subjects s
  JOIN jp_app.dbo.t_app_teachers t ON t.TeacherId = s.TeacherId
WHERE t.FullName = 'Meera Iyer' AND s.Is_Deleted = 0;`);
check('…and re-sending the original set restores it', restored === before, `${after} -> ${restored}`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`  3E HTTP VERIFICATION: ${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log('  FAILED:');
  for (const f of failed) console.log(`    - ${f.name}  (${f.detail})`);
}
console.log('='.repeat(62));
