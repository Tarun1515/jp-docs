/*
  PHASE 7B — THE ADMIN OPERATIONS DESK, OVER HTTP.

  ----------------------------------------------------------------------------
    0. ENTRY       shipped state; two admin fixtures, a job, an application
    1. 🔒 ROLES    VERIFICATION_ADMIN vs MODERATION_ADMIN vs SUPER_ADMIN —
                   every route forced with fetch, both ways
    2. 🔴 PULL     public 404 in the SAME SECOND, and the 7A-0 cache headers
                   that make it possible
    3. 🔴 UNTOUCHED the application keeps its row and its stage
    4. 🔒 SCHOOL   sees the reason, scoped to its own job, naming nobody
    5. 🔴 RESTORE  back to the status it HAD, not to Active
    6. 🔒 REPORTER raw bytes of every response the reported party can fetch
    7. 🔴 REPORTS  idempotent, and the state machine
    8. 🔴 FEATURED derived, either side of the IST boundary, no sweep
    9. CMS + FAQ   edit, and the refusal that protects the public page
   10. ENQUIRIES   the queue, and the trail
   11. EXIT        fixtures gone, shipped state restored

  ----------------------------------------------------------------------------
  🔴 THE TWO EXTRA ADMIN ACCOUNTS ARE FIXTURES, NOT SEEDS
  ----------------------------------------------------------------------------
  Only superadmin@teacherportal.local ships. VERIFICATION_ADMIN and
  MODERATION_ADMIN exist as roles with nobody in them, so the cross-checks have
  nobody to run as — and adding two real admin accounts with known passwords to
  the shipped seed is a security decision, not a test's to make.

  So this suite creates them, uses them, and removes them in the finally. Their
  credential row is COPIED from the superadmin's, which is what gives them a
  working password without this file knowing how to hash one.

  Run (both APIs): node scripts/verify/admin-desk.mjs
*/
import { execFileSync } from 'node:child_process';
import { token as loginToken, invalidate } from './lib/login.mjs';

const APP = 'http://localhost:5299/api';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const SUPER = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

const stamp = `${Date.now()}`.slice(-7);
const VERIFIER = { id: `verify.deskv.${stamp}@yopmail.com`, pw: SUPER.pw };
const MODERATOR = { id: `verify.deskm.${stamp}@yopmail.com`, pw: SUPER.pw };

const PROBE = 'DESKPROBE';

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

/** Raw, because section 6 reads bytes rather than parsed fields. */
const raw = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();

  return { http: r.status, text, headers: r.headers };
};

const head = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

/** Creates an admin account with a role, by copying the superadmin's password. */
const makeAdmin = (email, roleCode) => sql(`SET NOCOUNT ON; USE jp_sso;
  DECLARE @src bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${SUPER.id}');

  INSERT INTO t_sso_users (UserTypeId, StatusId, Email, IsEmailVerified, IsMobileVerified)
  VALUES (1, 2, '${email}', 1, 0);

  DECLARE @new bigint = SCOPE_IDENTITY();

  /* The same hash, salt, algorithm and iteration count — so the same password. */
  INSERT INTO t_sso_user_credentials (UserId, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, IsCurrent)
  SELECT @new, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, 1
    FROM t_sso_user_credentials WHERE UserId = @src AND IsCurrent = 1;

  INSERT INTO t_sso_user_roles (UserId, RoleId)
  SELECT @new, RoleId FROM t_sso_roles
   WHERE RoleCode = '${roleCode}' AND OrganizationUid IS NULL AND Is_Deleted = 0;

  SELECT CAST(@new AS varchar(20));`);

const dropAdmin = (email) => sql(`SET NOCOUNT ON; USE jp_sso;
  DECLARE @id bigint = (SELECT UserId FROM t_sso_users WHERE Email = '${email}');

  DELETE FROM t_sso_user_roles WHERE UserId = @id;
  DELETE FROM t_sso_user_credentials WHERE UserId = @id;
  DELETE FROM t_sso_user_tokens WHERE UserId = @id;
  DELETE FROM t_sso_user_login_attempts WHERE UserId = @id;
  DELETE FROM t_sso_users WHERE UserId = @id;`);

const cleanup = () => {
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_featured_jobs WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    DELETE FROM t_app_job_moderation_log WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    /*
      ⚠️ TWO PATTERNS, AND THE SECOND ONE IS A SCAR. An earlier version of this
      suite wrapped its backticks in single quotes, so the description it stored
      began with an uninterpolated backtick-dollar-brace sequence rather than
      the probe prefix — which this cleanup then did not match, and
      one orphan report row survived into the screens suite and satisfied an
      assertion there. Debris that a teardown cannot see is worse than debris.
    */
    DELETE FROM t_app_reports WHERE Description LIKE N'${PROBE}%'
                                 OR Description LIKE N'%{PROBE}%';
    DELETE FROM t_app_applications WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
    DELETE FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';
    DELETE FROM t_app_contact_enquiries WHERE Email LIKE 'deskprobe%';
    DELETE FROM t_app_cms_content_blocks WHERE BlockKey LIKE 'deskprobe%';
    DELETE FROM t_app_faqs WHERE Question LIKE N'${PROBE}%';`);
};

try {
  // =========================================================================
  section('0. ENTRY — shipped state, then the fixtures');
  // =========================================================================

  cleanup();

  /*
    ENTRY: the closed permission sets this whole suite depends on. jp_sso 008
    asserts them at build time; this asserts them against the live database,
    because a grant added by hand after a deploy would not have run that file.
  */
  const sets = sql(`SET NOCOUNT ON; USE jp_sso;
    SELECT p.PermissionCode + ' = ' + ISNULL(STRING_AGG(CAST(r.RoleCode AS nvarchar(40)), ', ')
             WITHIN GROUP (ORDER BY r.RoleCode), '(nobody)')
      FROM t_sso_permissions p
      LEFT JOIN t_sso_role_permissions rp ON rp.PermissionId = p.PermissionId AND rp.Is_Deleted = 0 AND rp.Is_Active = 1
      LEFT JOIN t_sso_roles r ON r.RoleId = rp.RoleId AND r.Is_Deleted = 0
     WHERE p.PermissionCode IN ('MODERATION.JOB','MODERATION.REPORT','ENQUIRY.MANAGE','CMS.MANAGE')
     GROUP BY p.PermissionCode ORDER BY p.PermissionCode;`);

  sets.forEach((line) => console.log(`    ${line}`));
  console.log('');

  check('entry: CMS.MANAGE is SUPER_ADMIN alone',
    sets.some((l) => l === 'CMS.MANAGE = SUPER_ADMIN'),
    sets.find((l) => l.startsWith('CMS.MANAGE')) ?? 'MISSING');

  check('entry: the three queue permissions are SUPER_ADMIN + MODERATION_ADMIN',
    ['MODERATION.JOB', 'MODERATION.REPORT', 'ENQUIRY.MANAGE'].every((code) =>
      sets.includes(`${code} = MODERATION_ADMIN, SUPER_ADMIN`)),
    'and VERIFICATION_ADMIN holds none of them');

  makeAdmin(VERIFIER.id, 'VERIFICATION_ADMIN');
  makeAdmin(MODERATOR.id, 'MODERATION_ADMIN');

  /* ⚠️ Permissions live in token claims, so a cached token would be stale. */
  invalidate(VERIFIER.id);
  invalidate(MODERATOR.id);

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(sc.SchoolId AS varchar(10)) FROM t_app_schools sc
      INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
     WHERE u.Email = '${OWNER.id}';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(10)) FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  const teacherId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(TeacherId AS varchar(10)) FROM t_app_teachers
     WHERE Is_Deleted = 0 ORDER BY TeacherId;`));

  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId,
                            LastDateToApply, PublishedOn, StateId)
    VALUES (${schoolId}, ${branchId}, N'${PROBE} live', 1, 1, 1, 1, 2, '2027-12-31', DATEADD(day, -2, SYSUTCDATETIME()), 1),
           (${schoolId}, ${branchId}, N'${PROBE} closed', 1, 1, 1, 1, 4, '2027-12-31', SYSUTCDATETIME(), 1),

           /*
             🔴 A THIRD LIVE JOB, NEWER THAN THE ONE THAT GETS FEATURED.

             Without it the public listing holds one row and the ordering
             assertion is trivially true — a test that passes whatever the
             ORDER BY does. This job is published LATER, so plain
             newest-first ordering would put it on top; only featured-first
             puts the other one there.

             NOTE: no double quotes in this comment. sqlcmd -Q takes the whole
             batch as one argument and a double quote inside it ends the
             argument early — the third time that has bitten this session.

             ⚠️ It is also never featured, which is what makes it the control.
           */
           (${schoolId}, ${branchId}, N'${PROBE} newer', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME(), 1);

    DECLARE @j bigint = (SELECT JobId FROM t_app_jobs WHERE JobTitle = N'${PROBE} live');

    INSERT INTO t_app_applications (JobId, SchoolId, BranchId, TeacherId, ApplicationStatusId, AppliedOn)
    VALUES (@j, ${schoolId}, ${branchId}, ${teacherId}, 2, SYSUTCDATETIME());`);

  const liveUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs WHERE JobTitle = N'${PROBE} live';`);

  const closedUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs WHERE JobTitle = N'${PROBE} closed';`);

  check('premise: a live job with one application, and a closed job',
    liveUid.length === 36 && closedUid.length === 36,
    `live ${liveUid.slice(0, 8)}… closed ${closedUid.slice(0, 8)}…`);

  const superToken = await loginToken(SUPER);
  const modToken = await loginToken(MODERATOR);
  const verToken = await loginToken(VERIFIER);
  const ownerToken = await loginToken(OWNER);

  // =========================================================================
  section('1. 🔒 THE THREE ADMIN ROLES, EVERY ROUTE FORCED BOTH WAYS');
  // =========================================================================

  /*
    🔒 THE CROSS-CHECK THE BRIEF ASKS FOR. Each route is called by all three
    admins with fetch — the devtools equivalent — and the expectation is stated
    per role. A test that only checked the happy path would pass while a
    verifier could pull jobs.
  */
  const routes = [
    ['moderation: pull a job', 'POST', `${APP}/admin/desk/jobs/${closedUid}/pull`,
      JSON.stringify({ remarks: 'Cross-check probe.' }),
      { super: 200, moderator: 200, verifier: 403 }],

    ['moderation: a job\'s history', 'GET', `${APP}/admin/desk/jobs/${liveUid}/history`, null,
      { super: 200, moderator: 200, verifier: 403 }],

    ['reports: the queue', 'GET', `${APP}/admin/desk/reports`, null,
      { super: 200, moderator: 200, verifier: 403 }],

    ['enquiries: the queue', 'GET', `${APP}/admin/desk/enquiries`, null,
      { super: 200, moderator: 200, verifier: 403 }],

    ['content: the featured list', 'GET', `${APP}/admin/desk/featured`, null,
      { super: 200, moderator: 403, verifier: 403 }],

    ['content: the FAQ list', 'GET', `${APP}/admin/desk/faqs`, null,
      { super: 200, moderator: 403, verifier: 403 }],

    ['content: the blocks', 'GET', `${APP}/admin/desk/content-blocks`, null,
      { super: 200, moderator: 403, verifier: 403 }],
  ];

  const tokens = { super: superToken, moderator: modToken, verifier: verToken };

  let crossOk = true;

  for (const [label, method, url, body, expected] of routes) {
    const got = {};

    for (const who of ['super', 'moderator', 'verifier']) {
      /* Only the first pull can succeed; the rest would be ALREADY_PULLED. */
      const r = await raw(url, {
        method,
        headers: head(tokens[who]),
        body: body ?? undefined,
      });

      got[who] = r.http;
    }

    const match = ['super', 'moderator', 'verifier'].every((who) =>
      got[who] === expected[who]
      /* A second pull is ALREADY_PULLED (400-class), which is still "allowed". */
      || (expected[who] === 200 && got[who] !== 403 && got[who] !== 401));

    if (!match) crossOk = false;

    check(`🔒 ${label}`, match,
      `super ${got.super} · moderator ${got.moderator} · verifier ${got.verifier}`
      + `  (expected ${expected.super}/${expected.moderator}/${expected.verifier})`);
  }

  check('🔒 all three roles behave exactly as the seed says',
    crossOk, 'VERIFICATION_ADMIN is refused everywhere; MODERATION_ADMIN has no content rights');

  /* And a SCHOOL may reach none of it. */
  const schoolTries = await Promise.all([
    raw(`${APP}/admin/desk/reports`, { headers: head(ownerToken) }),
    raw(`${APP}/admin/desk/featured`, { headers: head(ownerToken) }),
    raw(`${APP}/admin/desk/jobs/${liveUid}/pull`, {
      method: 'POST', headers: head(ownerToken), body: JSON.stringify({ remarks: 'let me' }),
    }),
  ]);

  check('🔒 …and a SCHOOL owner is refused all three',
    schoolTries.every((r) => r.http === 403),
    schoolTries.map((r) => r.http).join(', ') + ' — a school able to pull a job could pull a rival\'s');

  // =========================================================================
  section('2. 🔴 PULL — public 404 in the SAME SECOND');
  // =========================================================================

  /* Restore the cross-check's pull so this section starts from a live job. */
  await raw(`${APP}/admin/desk/jobs/${closedUid}/restore`, {
    method: 'POST', headers: head(superToken), body: JSON.stringify({ remarks: 'Cross-check cleanup.' }),
  });

  const beforePull = await raw(`${APP}/public/jobs/${liveUid}`);

  check('premise: the job is on the public site',
    beforePull.http === 200, `HTTP ${beforePull.http}`);

  console.log(`\n    public cache header: ${beforePull.headers.get('cache-control')}`);

  /*
    🔴 THE 7A-0 CACHE DECISION, SHOWN RATHER THAN CITED.

    2.81 weighed a 30-second cache on the public job endpoints and declined it
    for exactly this moment: a pulled job surviving as a page for half a minute.
    no-store is why the next request cannot be served from anywhere.
  */
  check('🔴 …and the public job endpoint is no-store (2.81) — nothing to outlive the pull',
    /no-store/.test(beforePull.headers.get('cache-control') ?? ''),
    beforePull.headers.get('cache-control') ?? 'MISSING');

  const t0 = Date.now();

  const pulled = await raw(`${APP}/admin/desk/jobs/${liveUid}/pull`, {
    method: 'POST',
    headers: head(modToken),
    body: JSON.stringify({ remarks: 'The salary range contradicts the description.' }),
  });

  const afterPull = await raw(`${APP}/public/jobs/${liveUid}`);
  const elapsed = Date.now() - t0;

  console.log(`    pull -> ${pulled.http} · public re-read -> ${afterPull.http} · ${elapsed} ms later\n`);

  check('🔴 the pull succeeds', pulled.http === 200, `HTTP ${pulled.http}`);

  check('🔴 …and the public route answers 404 IN THE SAME SECOND',
    afterPull.http === 404 && elapsed < 1000,
    `${elapsed} ms — no cache to outlive it, because the endpoint is no-store`);

  check('🔒 …and the refusal still says nothing about why',
    !/pulled|moderat|removed|blocked/i.test(afterPull.text),
    'the same words an expired or draft job gets');

  const listed = await raw(`${APP}/public/jobs?search=${PROBE}`);

  check('🔴 …and it is gone from the public LISTING too, not just the detail',
    !listed.text.includes(`${PROBE} live`),
    'one status change, every public read — which is why PULLED is a status and not a flag');

  // =========================================================================
  section('3. 🔴 THE APPLICATION IS UNTOUCHED');
  // =========================================================================

  const appRow = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT 'rows=' + CAST(COUNT(*) AS varchar(4))
         + ' status=' + ISNULL(STRING_AGG(CAST(a.ApplicationStatusId AS varchar(4)), ','), '-')
         + ' deleted=' + ISNULL(STRING_AGG(CAST(a.Is_Deleted AS varchar(4)), ','), '-')
      FROM t_app_applications a
     INNER JOIN t_app_jobs j ON j.JobId = a.JobId
     WHERE j.JobTitle = N'${PROBE} live';`)[0];

  console.log(`\n    ${appRow}\n`);

  /*
    🔴 THE CANDIDATES DID NOTHING WRONG. A moderation decision about the ADVERT
    is not a decision about the people who answered it — their application keeps
    its row and its stage, and 025 carries a build guard that fails if a
    moderation procedure ever reads or writes application data.
  */
  check('🔴 the application still exists, with the stage it had',
    appRow === 'rows=1 status=2 deleted=0', appRow);

  // =========================================================================
  section('4. 🔒 THE SCHOOL SEES THE REASON — scoped, and naming nobody');
  // =========================================================================

  const schoolView = await raw(`${APP}/jobs/${liveUid}/moderation`, { headers: head(ownerToken) });

  console.log(`\n    ${schoolView.text.slice(0, 180)}\n`);

  check('🔒 the owning school can read its own job\'s moderation history',
    schoolView.http === 200 && schoolView.text.includes('salary range'),
    `HTTP ${schoolView.http}`);

  check('2.62: the reason is STATED, not hinted',
    schoolView.text.includes('contradicts the description'),
    'what is wrong with the advert, which is what they can act on');

  /*
    🔒 AND NOT A WORD ABOUT WHO. No administrator is named — that invites the
    school to contact a person directly — and no complaint is mentioned, which
    would tell them a complainant exists.
  */
  check('🔒 …and it names no administrator and no complaint',
    !/actionBy|actorUser|adminName|report|complain/i.test(schoolView.text),
    'the remarks, the action and the date — nothing else');

  // =========================================================================
  section('5. 🔴 RESTORE — back to the status it HAD');
  // =========================================================================

  /* The CLOSED job is the one that proves this: Active would be wrong. */
  await raw(`${APP}/admin/desk/jobs/${closedUid}/pull`, {
    method: 'POST', headers: head(modToken), body: JSON.stringify({ remarks: 'Pulled while closed.' }),
  });

  const restored = await raw(`${APP}/admin/desk/jobs/${closedUid}/restore`, {
    method: 'POST', headers: head(modToken), body: JSON.stringify({ remarks: 'Looked again; the advert is fine.' }),
  });

  const closedStatus = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(JobStatusId AS varchar(4)) FROM t_app_jobs WHERE JobTitle = N'${PROBE} closed';`);

  console.log(`\n    ${restored.text.slice(0, 120)}`);
  console.log(`    the closed job's status after restore: ${closedStatus}\n`);

  check('🔴 a job pulled while CLOSED comes back CLOSED, not Active',
    closedStatus === '4',
    'read from the PULL log row — a hardcoded 2 would have republished it');

  check('…and the message says which status it went back to',
    /closed/i.test(restored.text),
    '"restored" alone would imply it is live again');
  // =========================================================================
  section('6. 🔒 THE REPORTER IS IN NOTHING THE REPORTED PARTY CAN FETCH');
  // =========================================================================

  /*
    🔒 THE BRIEF'S RULE, READ AT THE BYTES.

    A report is filed against the school's job by a TEACHER. The school is the
    reported party, so every response the school can fetch about that job — and
    the public ones anybody can fetch — must contain neither the field name nor
    the reporter's actual uid.

    ⚠️ Both are checked, and the uid matters more: a rename of the property
    would slip past a field-name check while still shipping the value.
  */
  const reporterUid = scalar(`SET NOCOUNT ON;
    SELECT LOWER(CAST(t.UserUid AS varchar(50))) FROM jp_app.dbo.t_app_teachers t
     WHERE t.TeacherId = ${teacherId};`);

  const teacherToken = await loginToken({
    id: scalar(`SET NOCOUNT ON;
      SELECT u.Email FROM jp_sso.dbo.t_sso_users u
       INNER JOIN jp_app.dbo.t_app_teachers t ON t.UserUid = u.UserUid
       WHERE t.TeacherId = ${teacherId};`),
    pw: 'Seeded#Teacher2026!',
  }).catch(() => null);

  /* Restore the live job so the reported entity is reachable. */
  await raw(`${APP}/admin/desk/jobs/${liveUid}/restore`, {
    method: 'POST', headers: head(modToken),
    body: JSON.stringify({ remarks: 'Restored for the reporter-identity check.' }),
  });

  const filed = await raw(`${APP}/reports`, {
    method: 'POST',
    headers: head(teacherToken ?? ownerToken),
    body: JSON.stringify({
      reasonId: 1, entityType: 'JOB', entityUid: liveUid,
      description: `${PROBE} the advert is not real`,
    }),
  });

  console.log(`\n    report filed: HTTP ${filed.http} ${filed.text.slice(0, 90)}\n`);

  check('a teacher can report a job — no permission needed to report',
    filed.http === 200, `HTTP ${filed.http}`);

  /*
    Every response the REPORTED PARTY (the school) can fetch about this job,
    plus the public ones. If the reporter's identity is anywhere, it is here.
  */
  const reportedPartyCanFetch = [
    ['the school\'s own moderation history', `${APP}/jobs/${liveUid}/moderation`, ownerToken],
    ['the school\'s own job list', `${APP}/jobs?pageSize=50`, ownerToken],
    ['the public job detail', `${APP}/public/jobs/${liveUid}`, null],
    ['the public listing', `${APP}/public/jobs?search=${PROBE}`, null],
  ];

  let leaked = [];

  for (const [label, url, token] of reportedPartyCanFetch) {
    const r = await raw(url, token ? { headers: head(token) } : undefined);
    const body = r.text.toLowerCase();

    const hits = [];

    if (body.includes('reportedbyuseruid')) hits.push('the field name');
    if (reporterUid && body.includes(reporterUid.toLowerCase())) hits.push('the reporter\'s uid');
    if (body.includes('reportsbythisaccount')) hits.push('the reporter\'s report count');

    if (hits.length) leaked.push(`${label}: ${hits.join(' + ')}`);

    console.log(`    ${label.padEnd(36)} HTTP ${r.http}  ${r.text.length} bytes`);

    check(`🔒 ${label}: no reporter in the raw bytes`,
      hits.length === 0,
      hits.length ? `LEAKED ${hits.join(', ')}` : `clean across ${r.text.length} bytes`);
  }

  console.log('');

  check('🔒 the reported party cannot learn who reported it, from anywhere',
    leaked.length === 0,
    leaked.length ? leaked.join(' · ') : `${reportedPartyCanFetch.length} responses, all clean`);

  /*
    ⚠️ AND THE ADMIN QUEUE DOES CARRY IT — otherwise the assertions above would
    pass on a system that never stored a reporter at all, which is the way this
    test could be green for the wrong reason.
  */
  const adminQueue = await raw(`${APP}/admin/desk/reports`, { headers: head(modToken) });

  check('🔒 …while the ADMIN queue does carry it — so the checks above mean something',
    adminQueue.text.toLowerCase().includes('reportedbyuseruid'),
    'the field exists and is admin-only, rather than not existing');

  // =========================================================================
  section('7. 🔴 REPORTS — idempotent, and the state machine');
  // =========================================================================

  const again = await raw(`${APP}/reports`, {
    method: 'POST',
    headers: head(teacherToken ?? ownerToken),
    body: JSON.stringify({
      reasonId: 4, entityType: 'JOB', entityUid: liveUid,
      description: `${PROBE} second try, different reason`,
    }),
  });

  const storedReports = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_reports WHERE Description LIKE N'${PROBE}%';`);

  console.log(`\n    second report: HTTP ${again.http} ${again.text.slice(0, 100)}`);
  console.log(`    reports stored: ${storedReports}\n`);

  /*
    🔴 2.48. Pressing report twice is not an error — it returns the FIRST
    report's uid and succeeds. An error would invite somebody to retry with a
    different reason to get it through, which is how one complaint becomes six.
  */
  check('🔴 a second report on the same thing SUCCEEDS and is the same report',
    again.http === 200 && /alreadyReported":\s*true/i.test(again.text),
    `HTTP ${again.http}`);

  check('🔴 …and only ONE row exists',
    storedReports === '1', `${storedReports} row(s)`);

  const reportUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(ReportUid AS varchar(50))) FROM t_app_reports WHERE Description LIKE N'${PROBE}%';`);

  /* Terminal with no remarks is refused; UnderReview needs none. */
  const noRemarks = await raw(`${APP}/admin/desk/reports/${reportUid}/status`, {
    method: 'POST', headers: head(modToken), body: JSON.stringify({ statusId: 4 }),
  });

  const underReview = await raw(`${APP}/admin/desk/reports/${reportUid}/status`, {
    method: 'POST', headers: head(modToken), body: JSON.stringify({ statusId: 2 }),
  });

  const dismissed = await raw(`${APP}/admin/desk/reports/${reportUid}/status`, {
    method: 'POST', headers: head(modToken),
    body: JSON.stringify({ statusId: 4, adminRemarks: 'The school corrected the advert.' }),
  });

  const reDecide = await raw(`${APP}/admin/desk/reports/${reportUid}/status`, {
    method: 'POST', headers: head(modToken),
    body: JSON.stringify({ statusId: 3, adminRemarks: 'changed my mind' }),
  });

  check('🔴 a terminal decision with no remarks is refused',
    noRemarks.http === 400, `HTTP ${noRemarks.http}`);

  check('…and moving to UnderReview needs none',
    underReview.http === 200, '"I am looking at this" needs no essay');

  check('…and the terminal decision with remarks is accepted',
    dismissed.http === 200, `HTTP ${dismissed.http}`);

  check('🔴 …and a DECIDED report stays decided',
    reDecide.http === 400 && /already/i.test(reDecide.text),
    reDecide.text.slice(0, 70));

  const trail = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT 'status=' + CAST(ReportStatusId AS varchar(4))
         + ' reviewer=' + ISNULL(CAST(ReviewedByUserId AS varchar(10)), 'NULL')
         + ' reviewedOn=' + CASE WHEN ReviewedOn IS NULL THEN 'NULL' ELSE 'set' END
      FROM t_app_reports WHERE Description LIKE N'${PROBE}%';`)[0];

  /*
    ⚠️ The reviewer's id is not a literal — it is the moderator fixture's, a
    fresh identity every run. Expecting 1 (the superadmin's) was the test being
    wrong, not the trail. What matters is that the three parts are set
    together, which is what t_app_reports' CK_ReviewTrail demands.
  */
  check('🔴 …and the review trail is complete — status, reviewer and time together',
    /^status=4 reviewer=\d+ reviewedOn=set$/.test(trail), trail);

  // =========================================================================
  section('8. 🔴 FEATURED — derived, either side of the IST boundary');
  // =========================================================================

  /*
    🔴 THE IST BOUNDARY IS THE POINT. Every window below is expressed relative
    to the IST date, and the clock is printed: when the IST and UTC dates
    differ, a UTC comparison would get these wrong and the assertions genuinely
    discriminate. 7A's job-expiry boundary was caught in exactly that window.
  */
  const clock = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT 'IST ' + CONVERT(varchar(10), dbo.fn_IstToday(), 23)
         + ' · UTC ' + CONVERT(varchar(10), SYSUTCDATETIME(), 23)
         + ' · ' + CASE WHEN dbo.fn_IstToday() <> CAST(SYSUTCDATETIME() AS date)
                        THEN 'THEY DIFFER — the trap is live right now'
                        ELSE 'same date — a UTC bug would hide at this hour' END;`)[0];

  console.log(`\n    ${clock}\n`);

  const istDates = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(10), dbo.fn_IstToday(), 23)
         + '|' + CONVERT(varchar(10), DATEADD(day, -1, dbo.fn_IstToday()), 23)
         + '|' + CONVERT(varchar(10), DATEADD(day,  1, dbo.fn_IstToday()), 23)
         + '|' + CONVERT(varchar(10), DATEADD(day, -5, dbo.fn_IstToday()), 23)
         + '|' + CONVERT(varchar(10), DATEADD(day,  5, dbo.fn_IstToday()), 23);`)[0].split('|');

  const [today, yesterday, tomorrow, fiveBack, fiveOn] = istDates;

  const newerUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs WHERE JobTitle = N'${PROBE} newer';`);

  /*
    🔴 BOTH SIDES OF THE BOUNDARY, not just the past one. A window that has
    ENDED and a window that has not STARTED are different bugs: the first is a
    comparison that forgets ToDate, the second one that forgets FromDate, and a
    test with only one of them catches only one.
  */
  const windows = [
    ['live today', liveUid, today, today, true],
    ['ended yesterday', closedUid, fiveBack, yesterday, false],
    ['starts tomorrow', newerUid, tomorrow, fiveOn, false],
  ];

  for (const [label, uid, from, to, shouldBeLive] of windows) {
    const saved = await raw(`${APP}/admin/desk/featured`, {
      method: 'POST', headers: head(superToken),
      body: JSON.stringify({ featuredType: 'JOB', entityUid: uid, fromDate: from, toDate: to, displayOrder: 1 }),
    });

    check(`featured window "${label}" (${from}..${to}) saved`,
      saved.http === 200, `HTTP ${saved.http} ${saved.text.slice(0, 60)}`);
  }

  const featuredList = await raw(`${APP}/admin/desk/featured`, { headers: head(superToken) });
  const windowRows = JSON.parse(featuredList.text).data ?? [];

  windowRows.forEach((w) => console.log(
    `    ${String(w.entityName).padEnd(22)} ${String(w.fromDate).slice(0, 10)}..${String(w.toDate).slice(0, 10)}  live=${w.isLiveToday}`));
  console.log('');

  const liveWindow = windowRows.find((w) => String(w.entityName).includes('live'));
  const endedWindow = windowRows.find((w) => String(w.entityName).includes('closed'));
  const futureWindow = windowRows.find((w) => String(w.entityName).includes('newer'));

  /*
    🔴 DERIVED: nothing wrote isLiveToday. It is a comparison of the row's
    dates against the IST date, made when the list was read.
  */
  check('🔴 the window covering today IS live — computed, not stored',
    liveWindow?.isLiveToday === true, `isLiveToday=${liveWindow?.isLiveToday}`);

  check('🔴 …and the one that ended YESTERDAY (IST) is not',
    endedWindow?.isLiveToday === false,
    'nothing ran to end it — the date comparison simply stopped matching');

  check('🔴 …and the one that STARTS TOMORROW (IST) is not live either',
    futureWindow?.isLiveToday === false,
    'the other side of the boundary — a comparison that forgot FromDate would show it today');

  /*
    🔒 "NO SWEEP" MEANS NO STORED STATE TO SWEEP, and the first version of this
    check asked the wrong question: it grepped for any UPDATE on a featured
    table and failed on USP_RemoveFeatured, which legitimately sets Is_Deleted.
    Soft-deleting a window is a human removing a placement; a sweep is
    something that runs on a timer to keep a flag true.

    So the real assertion is structural and it is 034's: neither table HAS a
    state column, so there is nothing a sweep could maintain.
  */
  check('🔒 …and there is NO state column for any sweep to maintain',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM sys.columns
       WHERE object_id IN (OBJECT_ID('t_app_featured_jobs'), OBJECT_ID('t_app_featured_schools'))
         AND name IN ('IsFeatured', 'IsActive', 'Is_Active', 'StatusId', 'IsLive');`) === '0',
    'featured-ness is a date comparison, so a sweep would have nothing to write');

  /* Overlap, and the public ordering. */
  const overlap = await raw(`${APP}/admin/desk/featured`, {
    method: 'POST', headers: head(superToken),
    body: JSON.stringify({ featuredType: 'JOB', entityUid: liveUid, fromDate: today, toDate: fiveOn }),
  });

  check('🔴 an overlapping window for the same job is refused',
    overlap.http === 400 && /overlap/i.test(overlap.text),
    'two live windows would make DisplayOrder ambiguous');

  const publicOrder = await raw(`${APP}/public/jobs?search=${PROBE}`);
  const titles = (JSON.parse(publicOrder.text).data ?? []).map((j) => j.jobTitle);

  console.log(`    public order: ${titles.join(' | ')}\n`);

  /*
    🔴 AND NOW IT DISCRIMINATES. Three live jobs are in this listing:
    "${PROBE} newer" was published LAST, so newest-first alone would put it on
    top. "${PROBE} live" is on top instead, and only the featured clause can
    do that.

    ⚠️ The earlier version of this check ran against a listing of ONE row and
    was true whatever the ORDER BY did — which is the shape of a test that
    passes for the wrong reason.
  */
  check('premise: more than one live job is in the listing',
    titles.length >= 2, `${titles.length} job(s) — one row would make the next check meaningless`);

  check('🔴 the FEATURED job is first, ahead of a job published LATER',
    titles[0]?.includes('live') && titles.some((t) => t.includes('newer')),
    titles.join(' | ') || 'empty');

  check('🔴 …and the job whose window starts tomorrow is NOT promoted',
    titles.indexOf(titles.find((t) => t.includes('newer')) ?? '') > 0,
    'a future window must not lift a job today');

  // =========================================================================
  section('9. CMS BLOCKS + FAQ ADMIN');
  // =========================================================================

  const blockSaved = await raw(`${APP}/admin/desk/content-blocks`, {
    method: 'POST', headers: head(superToken),
    body: JSON.stringify({
      blockKey: 'deskprobe-block', blockTitle: 'Probe', blockContent: 'Set by the 7B suite.',
      displayOrder: 99, isActive: true,
    }),
  });

  const publicBlocks = await raw(`${APP}/public/content-blocks`);

  check('a content block saves by its KEY and reaches the public read',
    blockSaved.http === 200 && publicBlocks.text.includes('deskprobe-block'),
    `save ${blockSaved.http} · public ${publicBlocks.http}`);

  const faqSaved = await raw(`${APP}/admin/desk/faqs`, {
    method: 'POST', headers: head(superToken),
    body: JSON.stringify({
      category: 'GENERAL', question: `${PROBE} is this shown?`,
      answer: 'Yes — the suite added it.', displayOrder: 99, isActive: true,
    }),
  });

  const publicFaqs = await raw(`${APP}/public/faqs`);

  check('a FAQ saves and reaches the public read',
    faqSaved.http === 200 && publicFaqs.text.includes(`${PROBE} is this shown?`),
    `save ${faqSaved.http} · public ${publicFaqs.http}`);

  /*
    🔴 THE REFUSAL THAT PROTECTS THE PUBLIC PAGE. /faq groups by category, so
    deleting the last live question in one leaves a heading with nothing under
    it. The GENERAL section has exactly the one row this suite just added.
  */
  const faqId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(FaqId AS varchar(10)) FROM t_app_faqs WHERE Question LIKE N'${PROBE}%';`);

  /*
    🔴 THE PREMISE THE NEXT CHECK RESTS ON, ASSERTED.

    "Deleting the last live question in a section is refused" only tests
    anything if the section HAS exactly one. A run of this suite whose cleanup
    missed a GENERAL row left two, the delete succeeded, and the check failed
    for a reason that had nothing to do with the rule — which is the same
    failure mode as a test passing for the wrong reason, arriving from the
    other side.
  */
  const generalCount = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_faqs
     WHERE Category = 'GENERAL' AND Is_Active = 1 AND Is_Deleted = 0;`);

  check('premise: GENERAL holds exactly the one question this suite added',
    generalCount === '1',
    `${generalCount} row(s) — nothing seeds GENERAL, so more means leftover debris`);

  const lastInSection = await raw(`${APP}/admin/desk/faqs/${faqId}`, {
    method: 'DELETE', headers: head(superToken),
  });

  check('🔴 deleting the LAST live question in a section is refused',
    lastInSection.http === 400 && /last live question/i.test(lastInSection.text),
    'an empty heading reads as a broken page, not an edit');

  // =========================================================================
  section('10. ENQUIRIES — the queue and the trail');
  // =========================================================================

  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_contact_enquiries (Name, Email, Subject, [Message])
    VALUES (N'Desk Probe', N'deskprobe@example.com', N'How do we list our school?', N'Please advise.');`);

  const enquiryId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(EnquiryId AS varchar(10)) FROM t_app_contact_enquiries
     WHERE Email = 'deskprobe@example.com';`);

  const queue = await raw(`${APP}/admin/desk/enquiries?isResolved=false`, { headers: head(modToken) });

  check('the unanswered enquiry is in the queue',
    queue.http === 200 && queue.text.includes('How do we list our school?'),
    `HTTP ${queue.http}`);

  check('🔒 …and the queue carries no caller identity, because there is none',
    !/userUid|userId|organizationUid/i.test(queue.text),
    'an enquiry arrives from an anonymous visitor (033)');

  const noNote = await raw(`${APP}/admin/desk/enquiries/${enquiryId}/resolve`, {
    method: 'POST', headers: head(modToken), body: JSON.stringify({ remarks: '   ' }),
  });

  const resolved = await raw(`${APP}/admin/desk/enquiries/${enquiryId}/resolve`, {
    method: 'POST', headers: head(modToken),
    body: JSON.stringify({ remarks: 'Told them to register; verification follows.' }),
  });

  check('🔴 resolving with no remarks is refused',
    noNote.http === 400, 'an empty flag answers nobody\'s question later');

  const enquiryTrail = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT 'resolved=' + CAST(IsResolved AS varchar(4))
         + ' by=' + ISNULL(CAST(ResolvedByUserId AS varchar(10)), 'NULL')
         + ' on=' + CASE WHEN ResolvedOn IS NULL THEN 'NULL' ELSE 'set' END
         + ' note=' + CASE WHEN ResolutionRemarks IS NULL THEN 'NULL' ELSE 'set' END
      FROM t_app_contact_enquiries WHERE Email = 'deskprobe@example.com';`)[0];

  /*
    ⚠️ The resolver's id is NOT asserted as a literal — it is the moderator
    fixture's, which is a fresh identity every run. The first version expected
    1 (the superadmin's) and failed with "by=379", which was the test being
    wrong rather than the trail. What matters is that all four parts are set
    together, which is what 033's CHECK demands.
  */
  check('🔴 …and resolving leaves a complete trail',
    resolved.http === 200
      && /^resolved=1 by=\d+ on=set note=set$/.test(enquiryTrail),
    enquiryTrail);

  check('…and resolving twice is refused',
    (await raw(`${APP}/admin/desk/enquiries/${enquiryId}/resolve`, {
      method: 'POST', headers: head(modToken), body: JSON.stringify({ remarks: 'again' }),
    })).http === 400,
    'already answered');
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  section('11. EXIT — fixtures gone, shipped state restored');

  try {
    cleanup();

    for (const who of [VERIFIER, MODERATOR]) {
      try {
        dropAdmin(who.id);
        invalidate(who.id);
      } catch (error) {
        console.error(`  ⚠️ could not remove ${who.id}: ${error.message.slice(0, 80)}`);
      }
    }

    check('exit: the two admin fixtures are gone',
      scalar(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4)) FROM jp_sso.dbo.t_sso_users
               WHERE Email LIKE 'verify.desk%';`) === '0', 'none');

    check('exit: no probe job, application, report or log row is left',
      scalar(`SET NOCOUNT ON; USE jp_app; SELECT CAST(
        (SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%')
      + (SELECT COUNT(*) FROM t_app_reports WHERE Description LIKE N'${PROBE}%')
      + (SELECT COUNT(*) FROM t_app_job_moderation_log) AS varchar(6));`) === '0', 'none');

    check('exit: the seeded FAQ copy is untouched',
      Number(scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs WHERE Is_Active = 1 AND Is_Deleted = 0;`)) >= 12,
      'this suite edits its own rows only');
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
