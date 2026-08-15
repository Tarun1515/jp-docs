/*
  PHASE 3I — the dashboards, verified against running APIs.

  ----------------------------------------------------------------------------
  WHAT THIS IS LOOKING FOR
  ----------------------------------------------------------------------------
  The old dashboards were convincing and entirely fictional (G6). The failure
  mode this phase has to rule out is the opposite one: a screen that LOOKS
  honest while quietly showing something it made up. So every check reads the
  response body, and the interesting ones read the database as well.

  🔴 SECTION 3 IS THE ONE THE NEW CONVENTION DEMANDS (2.61): a standard
  underscore column read from BOTH the row and the JSON. Nothing else catches
  that class of bug — the procedure is right, the mapping is wrong, and the
  value silently defaults to false.

  Run: node scripts/verify/dashboards-3i.mjs   (both APIs up)
*/
import { execFileSync } from 'node:child_process';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

// HOW_TO_RUN §4.
const SCHOOL = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const TEACHER = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };
const RICH_TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits out the 5-per-minute-per-IP login limiter rather than failing on it. */
const login = async (loginId, password, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });

  if (r.http === 429 && attempt <= 4) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(loginId, password, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message ?? r.text}`);

  return r.body.data.accessToken;
};

const head = (t) => ({ authorization: `Bearer ${t}` });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. THE SCHOOL DASHBOARD, AS JSON ===');

const schoolToken = await login(SCHOOL.id, SCHOOL.pw);
const school = await j(`${APP}/dashboard/school`, { headers: head(schoolToken) });

check('GET /api/dashboard/school returns 200', school.http === 200, `${school.http}`);

console.log('\n' + JSON.stringify(school.body?.data, null, 2).split('\n').map((l) => '    ' + l).join('\n') + '\n');

const s = school.body?.data;

check('it names the school and its verification state',
  !!s?.schoolName && typeof s.isVerified === 'boolean',
  `${s?.schoolName} · verified ${s?.isVerified}`);

check('the head office is there, with somewhere to put on screen',
  !!s?.headOffice?.branchName,
  `${s?.headOffice?.branchName} · ${s?.headOffice?.location ?? '(no location)'}`);

check('the team count and preview are real numbers, not a fixture',
  typeof s?.teamMemberCount === 'number' && Array.isArray(s?.team),
  `${s?.teamMemberCount} member(s), ${s?.team?.length} shown`);

/*
  🔴 THE POINT OF THE PHASE. The old screen carried a job count, an applicant
  count and a funnel, all computed from a fixture. If a count ever appears in
  this payload before Phase 4, it is invented — there is no table behind it.
*/
const forbidden = ['jobCount', 'openJobs', 'applicantCount', 'applications', 'funnel', 'stages'];
const bodyText = JSON.stringify(s ?? {});
const found = forbidden.filter((key) => bodyText.includes(key));

check('🔴 the payload carries NO job or applicant count — there is nothing to count',
  found.length === 0, found.length ? `found: ${found.join(', ')}` : 'none of the fixture-era fields exist');

// ---------------------------------------------------------------------------
console.log('=== 2. THE TEACHER DASHBOARD, AS JSON ===');

const teacherToken = await login(RICH_TEACHER.id, RICH_TEACHER.pw);
const teacher = await j(`${APP}/dashboard/teacher`, { headers: head(teacherToken) });

check('GET /api/dashboard/teacher returns 200', teacher.http === 200, `${teacher.http}`);

console.log('\n' + JSON.stringify(teacher.body?.data, null, 2).split('\n').map((l) => '    ' + l).join('\n') + '\n');

const t = teacher.body?.data;

check('completeness comes from the server, not the browser',
  typeof t?.profileCompletionPercent === 'number',
  `${t?.profileCompletionPercent}%`);

check('the resume state is a fact the screen can act on',
  typeof t?.hasResume === 'boolean', `hasResume ${t?.hasResume}`);

check('experience months are the derived server value (2.54)',
  t?.totalExperienceMonths !== undefined,
  `${t?.totalExperienceMonths} months across ${t?.experienceCount} entr${t?.experienceCount === 1 ? 'y' : 'ies'}`);

const teacherForbidden = ['jobCount', 'applicationCount', 'invitations', 'savedJobs'];
const teacherFound = teacherForbidden.filter((key) => JSON.stringify(t ?? {}).includes(key));

check('🔴 and no job or application counts here either',
  teacherFound.length === 0,
  teacherFound.length ? `found: ${teacherFound.join(', ')}` : 'none');

// ---------------------------------------------------------------------------
console.log('=== 3. 🔴 THE ROW AND THE JSON, FOR A STANDARD COLUMN (2.61) ===');

/*
  The convention this phase locked down, applied to the field it introduced.

  Is_Active on t_app_subscriptions reaches PlanSummaryDto.isActive ONLY because
  USP_GetCurrentSubscription aliases it. Without the alias Dapper leaves the
  property false and nothing fails — which is exactly what happened to
  BranchDto.IsActive for two phases (G25).

  Reading one side proves nothing. Both sides, compared, is the whole check.
*/
const orgUid = sql(`SET NOCOUNT ON; SELECT CAST(u.OrganizationUid AS varchar(40))
  FROM jp_sso.dbo.t_sso_users u WHERE u.Email = '${SCHOOL.id}'`);

const row = sql(`SET NOCOUNT ON;
  SELECT TOP (1) CAST(s.Is_Active AS varchar(3)) + '|' + CAST(s.PlanId AS varchar(6))
  FROM jp_app.dbo.t_app_subscriptions s
  WHERE s.OwnerUid = '${orgUid}' AND s.Is_Deleted = 0
  ORDER BY s.Is_Active DESC, s.StartsOn DESC, s.SubscriptionId DESC`);

const [rowIsActive, rowPlanId] = row.split('|');

const planName = sql(`SET NOCOUNT ON; SELECT p.Name FROM jp_mdm.dbo.m_mdm_plans p
  WHERE p.PlanId = ${rowPlanId}`);

console.log(`    database row : Is_Active = ${rowIsActive}, PlanId = ${rowPlanId} (${planName})`);
console.log(`    JSON         : isActive  = ${s?.plan?.isActive}, planName = ${s?.plan?.planName}`);

check('🔴 Is_Active in the ROW and isActive in the JSON agree',
  (rowIsActive === '1') === (s?.plan?.isActive === true),
  `row ${rowIsActive} · json ${s?.plan?.isActive}`);

check('🔴 …and it is TRUE, so the alias is doing something',
  rowIsActive === '1' && s?.plan?.isActive === true,
  'a false-false pair would pass the comparison above while proving nothing');

check('the plan name crossed from jp_mdm into a jp_app-owned payload (2.2)',
  s?.plan?.planName === planName, `${s?.plan?.planName} === ${planName}`);

// ---------------------------------------------------------------------------
console.log('\n=== 4. NEGATIVE: THE LOWEST COMPLETENESS BRACKET ===');

const zeroToken = await login(TEACHER.id, TEACHER.pw);
const zero = await j(`${APP}/dashboard/teacher`, { headers: head(zeroToken) });
const z = zero.body?.data;

check('a teacher with an empty profile still gets a dashboard', zero.http === 200,
  `${zero.http} · ${z?.profileCompletionPercent}% · ${z?.fullName}`);

check('🔴 …at 0%, which is the number the screen must NOT print as a verdict',
  z?.profileCompletionPercent === 0, `${z?.profileCompletionPercent}%`);

check('…and everything else is honestly empty rather than absent',
  z?.hasResume === false && z?.subjectCount === 0 && z?.experienceCount === 0,
  `resume ${z?.hasResume}, subjects ${z?.subjectCount}, experience ${z?.experienceCount}`);

// ---------------------------------------------------------------------------
console.log('\n=== 5. NEGATIVE: A SCHOOL WITH NO ACTIVE SUBSCRIPTION ===');

/*
  Provisioning gives every account a plan, and 3B's repair removed seven rows
  that should not have existed — so "no subscription" is a state this screen can
  meet. Rather than trusting the code path, the row is deactivated for real,
  read back, and restored.
*/
const subId = sql(`SET NOCOUNT ON; SELECT TOP (1) CAST(s.SubscriptionId AS varchar(12))
  FROM jp_app.dbo.t_app_subscriptions s
  WHERE s.OwnerUid = '${orgUid}' AND s.Is_Deleted = 0 AND s.Is_Active = 1
  ORDER BY s.SubscriptionId DESC`);

sql(`SET NOCOUNT ON; UPDATE jp_app.dbo.t_app_subscriptions
     SET Is_Active = 0 WHERE SubscriptionId = ${subId}`);

const lapsed = await j(`${APP}/dashboard/school`, { headers: head(schoolToken) });

check('an inactive subscription does not break the dashboard', lapsed.http === 200,
  `${lapsed.http}`);

check('🔴 …it comes back as hasSubscription true, isActive FALSE',
  lapsed.body?.data?.plan?.hasSubscription === true && lapsed.body?.data?.plan?.isActive === false,
  `hasSubscription ${lapsed.body?.data?.plan?.hasSubscription} · isActive ${lapsed.body?.data?.plan?.isActive}`);

console.log(`    the screen renders: "${lapsed.body?.data?.plan?.planName} — not active"`);

// Now remove it entirely: the harder state.
sql(`SET NOCOUNT ON; UPDATE jp_app.dbo.t_app_subscriptions
     SET Is_Deleted = 1 WHERE SubscriptionId = ${subId}`);

const none = await j(`${APP}/dashboard/school`, { headers: head(schoolToken) });

check('a school with NO subscription row at all still renders', none.http === 200,
  `${none.http}`);

check('🔴 …and says so rather than showing a blank or a fake free plan',
  none.body?.data?.plan?.hasSubscription === false && none.body?.data?.plan?.planName === null,
  `hasSubscription ${none.body?.data?.plan?.hasSubscription} · planName ${none.body?.data?.plan?.planName}`);

console.log('    the screen renders: "No plan on file"');

// Restore.
sql(`SET NOCOUNT ON; UPDATE jp_app.dbo.t_app_subscriptions
     SET Is_Active = 1, Is_Deleted = 0 WHERE SubscriptionId = ${subId}`);

const restored = await j(`${APP}/dashboard/school`, { headers: head(schoolToken) });

check('the subscription is put back exactly as it was',
  restored.body?.data?.plan?.hasSubscription === true &&
  restored.body?.data?.plan?.isActive === true &&
  restored.body?.data?.plan?.planName === planName,
  `${restored.body?.data?.plan?.planName}, active`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. NEGATIVE: THE WRONG KIND OF ACCOUNT ===');

const schoolOnTeacher = await j(`${APP}/dashboard/teacher`, { headers: head(schoolToken) });
const teacherOnSchool = await j(`${APP}/dashboard/school`, { headers: head(teacherToken) });

check('🔴 a school hitting the teacher dashboard is refused', schoolOnTeacher.http === 403,
  `${schoolOnTeacher.http} · ${schoolOnTeacher.body?.message}`);

check('…with the reason written for THEM, not for a teacher with no profile',
  /not a teacher account/i.test(schoolOnTeacher.body?.message ?? ''),
  schoolOnTeacher.body?.message);

check('🔴 a teacher hitting the school dashboard is refused', teacherOnSchool.http === 403,
  `${teacherOnSchool.http} · ${teacherOnSchool.body?.message}`);

check('…with the school-area message, which 3E fixed and this inherits',
  /not a school account/i.test(teacherOnSchool.body?.message ?? ''),
  teacherOnSchool.body?.message);

// ---------------------------------------------------------------------------
console.log('\n=== 7. THE MOCKUP IS OUT OF REACH ===');

const menuRow = sql(`SET NOCOUNT ON; SELECT CAST(IsMenuVisible AS varchar(2)) + '|' + CAST(Is_Active AS varchar(2))
  FROM jp_sso.dbo.m_sso_menus WHERE MenuCode = 'SCHOOL_APPLICANTS'`);

check('🔴 the SCHOOL_APPLICANTS menu row is hidden (menus are data — 2.37)',
  menuRow.startsWith('0|'), `IsMenuVisible|Is_Active = ${menuRow}`);

const menus = await j(`${SSO}/menus`, { headers: head(schoolToken) });
const menuPaths = (menus.body?.data ?? []).filter((m) => m.isMenuVisible).map((m) => m.routePath);

check('…so GET /api/menus no longer offers /applicants to a school',
  !menuPaths.includes('/applicants'),
  `${menuPaths.length} visible: ${menuPaths.join(' ')}`);

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
