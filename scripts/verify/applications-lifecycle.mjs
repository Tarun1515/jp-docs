/*
  PHASE 5A — the application lifecycle: snapshot, the status machine, scope and
  permissions.

  ----------------------------------------------------------------------------
    1. THE SNAPSHOT   apply, then REPLACE the resume. The school still gets the
                      original — asserted on the BYTES it downloads, not on a
                      path string that could be stale for a happier reason.
    2. THE MAP        every legal transition accepted and written to history
                      with the acting user; every illegal one refused. Includes
                      🔴 Rejected -> Shortlisted, and each of statuses 7–10.
    3. EXPIRY         an expired job refuses the apply SERVER-SIDE, and does not
                      appear in the browse at all. Backdated against
                      dbo.fn_IstToday(), not a UTC date.
    4. RESUME         no resume -> RESUME_REQUIRED; upload one -> the same call
                      succeeds.
    5. SCOPE          teacher A cannot read teacher B's application; school 2
                      cannot read school 4's applicant, and its list is ZERO
                      rather than fewer; a branch-bound account sees only its
                      own campus.
    6. PERMISSIONS    from the SEED, not from the UI's opinion:
                        Viewer   has APPLICANT.VIEW and NOT SHORTLIST -> 403
                        Viewer   has NOT RESUME.DOWNLOAD -> 403 on the file
                        HR       has SHORTLIST and NOT REJECT -> 200 then 403
    7. DERIVED        the school's job list shows a real applicant count while
                      t_app_jobs.ApplicationCount is still 0 in the row.
    8. TEACHER SHAPE  TeacherFacingName, and no rejection reason anywhere in the
                      bytes — including the remarks the school actually typed.

  ----------------------------------------------------------------------------
  🔴 THIS SCRIPT CHANGES TWO REAL TEACHER PROFILES, AND PUTS THEM BACK
  ----------------------------------------------------------------------------
  It uploads resumes for Rohit and Imran, because "the resume was replaced" and
  "there was no resume" cannot be proven without doing both. Imran's emptiness
  is a FIXTURE the 3H screens suite depends on (G20), so his ResumePath and his
  completion percentage are captured on entry and restored on exit, and the
  files written to App_Data are deleted.

  Shipped state is asserted on ENTRY as well as EXIT. A smoke test crashed
  mid-run during this phase's build and the next run read its leftovers as a
  product bug.

  ⚠️ sqlcmd needs -I. Run (both APIs up): node scripts/verify/applications-lifecycle.mjs
*/
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';
const UPLOADS = 'D:\\Projects\\jp-backend\\JP.App.Api\\App_Data\\uploads';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };   // school 4, Owner
const HR = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };          // school 2, jp_sso role HR
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!' };       // school 4, branch-bound Viewer
const T_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };
const T_B = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };

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
  try { b = JSON.parse(t); } catch { /* keep text */ }

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

/** Uploads a resume through the REAL endpoint, magic bytes and all. */
const uploadResume = async (token, marker) => {
  const pdf = `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), `${marker}.pdf`);

  return j(`${APP}/teacher/resume`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  });
};

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------
const ownerToken = await login(OWNER.id, OWNER.pw);
const hrToken = await login(HR.id, HR.pw);
const viewerToken = await login(VIEWER.id, VIEWER.pw);
const aToken = await login(T_A.id, T_A.pw);
const bToken = await login(T_B.id, T_B.pw);

const HO = { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' };
const HH = { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' };
const HV = { authorization: `Bearer ${viewerToken}`, 'content-type': 'application/json' };
const HA = { authorization: `Bearer ${aToken}`, 'content-type': 'application/json' };
const HB = { authorization: `Bearer ${bToken}`, 'content-type': 'application/json' };

const ownerBranch = (await j(`${APP}/branches`, { headers: HO })).body?.data?.[0]?.branchId;
const hrBranch = (await j(`${APP}/branches`, { headers: HH })).body?.data?.[0]?.branchId;

const ownerSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${ownerBranch};`));
const hrSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${hrBranch};`));

const idOf = (email) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(t.TeacherId AS varchar(20)) + '|' + CAST(u.UserId AS varchar(20))
  FROM t_app_teachers t JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email='${email}';`)[0].split('|').map((s) => s.trim());

const [teacherA, userA] = idOf(T_A.id);
const [teacherB] = idOf(T_B.id);
const ownerUserId = scalar(`SET NOCOUNT ON;
  SELECT UserId FROM jp_sso.dbo.t_sso_users WHERE Email='${OWNER.id}';`);

/** ResumePath + completion, so two real profiles can be put back exactly. */
const profileOf = (id) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT ISNULL(ResumePath, '~NULL~') + '|' + CAST(ProfileCompletionPercent AS varchar(4))
  FROM t_app_teachers WHERE TeacherId = ${id};`)[0].split('|').map((s) => s.trim());

const entryProfileA = profileOf(teacherA);
const entryProfileB = profileOf(teacherB);
const writtenFiles = new Set();

const restoreProfile = (id, [path, pct]) => sql(`SET NOCOUNT ON; USE jp_app;
  UPDATE t_app_teachers
  SET ResumePath = ${path === '~NULL~' ? 'NULL' : `N'${path}'`},
      ProfileCompletionPercent = ${pct}
  WHERE TeacherId = ${id};`);

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_application_status_history
  WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications WHERE SchoolId IN (${ownerSchool}, ${hrSchool}));
  DELETE FROM t_app_applications WHERE SchoolId IN (${ownerSchool}, ${hrSchool});
  DELETE FROM t_app_saved_jobs WHERE TeacherId IN (${teacherA}, ${teacherB});
  DELETE FROM t_app_job_subjects WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool}));
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool}));
  DELETE FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool});
  DELETE FROM t_app_school_branches WHERE SchoolId = ${ownerSchool} AND BranchName = N'5A temp campus';`);

cleanup();

const entryApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
const entryJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
const entryBranches = scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_school_branches WHERE Is_Deleted = 0;`);

console.log(`\nowner: school ${ownerSchool} campus ${ownerBranch} (userId ${ownerUserId})`
  + ` · HR: school ${hrSchool} campus ${hrBranch}`);
console.log(`teacher A: ${teacherA} (userId ${userA}) · teacher B: ${teacherB}`);
console.log(`entry profiles — A: ${entryProfileA.join(' / ')} · B: ${entryProfileB.join(' / ')}`);

check('🔴 shipped state on ENTRY — no applications, no jobs',
  entryApps === '0' && entryJobs === '0', `applications ${entryApps}, jobs ${entryJobs}`);

check('🔴 …and teacher B still has NO resume — the G20 fixture is intact',
  entryProfileB[0] === '~NULL~', `ResumePath ${entryProfileB[0]}`);

const body = (branchId, title, over = {}) => JSON.stringify({
  branchId, jobTitle: title, subjectId: 1, designationId: 1,
  employmentTypeId: 1, noOfVacancies: 2, salaryMin: 30000, salaryMax: 50000,
  lastDateToApply: '2026-12-31', subjectIds: [1], classLevelIds: [1],
  ...over,
});

const publish = async (headers, branchId, title, over) => {
  const id = (await j(`${APP}/jobs`, { method: 'POST', headers, body: body(branchId, title, over) })).body?.data;
  await j(`${APP}/jobs/${id}/publish`, { method: 'POST', headers });

  return id;
};

try {
  // =========================================================================
  console.log('\n=== 1. 🔴 THE SNAPSHOT — THE SCHOOL KEEPS WHAT IT WAS GIVEN ===');

  const upA = await uploadResume(aToken, 'SNAPSHOT-ORIGINAL-A');
  check('teacher A uploads a resume through the real endpoint', upA.http === 200, `HTTP ${upA.http}`);

  const pathA = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ResumePath FROM t_app_teachers WHERE TeacherId=${teacherA};`);
  writtenFiles.add(pathA);

  const job1 = await publish(HO, ownerBranch, 'PGT Physics — 5A lifecycle');

  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HA, body: JSON.stringify({ jobId: job1, coverNote: 'Keen to join.' }),
  });
  const appA = applied.body?.data?.applicationId;

  check('…and applies', applied.http === 200 && appA > 0, `applicationId ${appA}`);

  const snapshot = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ResumePathSnapshot FROM t_app_applications WHERE ApplicationId=${appA};`);

  check('the application stored a SNAPSHOT of the resume path',
    snapshot === pathA, `${snapshot}`);

  // ---- now the teacher replaces it ---------------------------------------
  const upB = await uploadResume(aToken, 'REPLACED-LATER-B');
  const pathB = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ResumePath FROM t_app_teachers WHERE TeacherId=${teacherA};`);
  writtenFiles.add(pathB);

  console.log(`\n    resume when they applied : ${pathA}`);
  console.log(`    resume on the profile now: ${pathB}`);

  check('teacher A replaces their resume', upB.http === 200 && pathB !== pathA, `${pathB}`);

  const detailAfter = await j(`${APP}/applicants/${appA}`, { headers: HO });

  console.log(`    what the school's applicant detail returns: ${detailAfter.body?.data?.resumePathSnapshot}\n`);

  check('🔴 the school STILL sees the ORIGINAL path, not the replacement',
    detailAfter.body?.data?.resumePathSnapshot === pathA,
    `${detailAfter.body?.data?.resumePathSnapshot}`);

  const file = await fetch(`${APP}/applicants/${appA}/resume`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const bytes = await file.text();

  console.log(`    GET /api/applicants/${appA}/resume  HTTP ${file.status}`);
  console.log(`      first line: ${bytes.split('\n')[1]}\n`);

  check('🔴 …AND THE BYTES IT DOWNLOADS ARE THE ORIGINAL FILE\'S',
    file.status === 200 && bytes.includes('SNAPSHOT-ORIGINAL-A') && !bytes.includes('REPLACED-LATER-B'),
    `HTTP ${file.status}, marker ${bytes.includes('SNAPSHOT-ORIGINAL-A') ? 'SNAPSHOT-ORIGINAL-A' : '(wrong file)'}`);

  // =========================================================================
  console.log('\n=== 2. 🔴 THE STATUS MACHINE — EVERY LEGAL MOVE, EVERY ILLEGAL ONE ===');

  const LEGAL = [[1, 2], [1, 3], [1, 6], [2, 3], [2, 4], [2, 6], [3, 4], [3, 5], [3, 6], [4, 5], [4, 6], [5, 6]];

  const setStatus = (from, to) => {
    sql(`SET NOCOUNT ON; USE jp_app;
      UPDATE t_app_applications SET ApplicationStatusId=${from} WHERE ApplicationId=${appA};`);

    const row = sql(`SET NOCOUNT ON; USE jp_app;
      DECLARE @u uniqueidentifier = (SELECT UserUid FROM jp_sso.dbo.t_sso_users WHERE Email='${OWNER.id}');
      EXEC USP_SetApplicationStatus @SchoolId=${ownerSchool}, @UserUid=@u, @ApplicationId=${appA},
        @ToStatusId=${to}, @Remarks=N'map probe', @ActorUserId=${ownerUserId};`)[0] ?? '';

    const c = row.split('|').map((s) => s.trim());

    return { status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1], raw: row };
  };

  const histBefore = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_application_status_history WHERE ApplicationId=${appA};`));

  const legalFails = [];
  for (const [from, to] of LEGAL) {
    const r = setStatus(from, to);
    if (r.status !== 1 || r.code !== null) legalFails.push(`${from}->${to}: ${r.raw}`);
  }

  console.log(`\n    legal transitions tried: ${LEGAL.map(([f, t]) => `${f}->${t}`).join(' ')}\n`);

  check('🔴 all 12 legal transitions are ACCEPTED',
    legalFails.length === 0, legalFails.length ? legalFails.join(' · ') : '12/12 accepted');

  const histAfter = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_application_status_history WHERE ApplicationId=${appA};`));

  check('🔴 …and each one APPENDED a history row — 12 moves, 12 rows',
    histAfter - histBefore === LEGAL.length, `${histAfter - histBefore} rows for ${LEGAL.length} moves`);

  const wrongActor = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_application_status_history
    WHERE ApplicationId=${appA} AND FromStatusId IS NOT NULL AND ISNULL(ChangedByUserId,-1) <> ${ownerUserId};`));

  check('🔴 …every one of them naming the ACTING USER',
    wrongActor === 0, `${wrongActor} rows with the wrong or missing actor (expected userId ${ownerUserId})`);

  // ---- the illegal ones ---------------------------------------------------
  const illegal = [];
  for (let from = 1; from <= 6; from++) {
    for (let to = 1; to <= 6; to++) {
      if (from === to) continue;
      if (LEGAL.some(([f, t]) => f === from && t === to)) continue;
      illegal.push([from, to]);
    }
  }

  const illegalWrong = [];
  for (const [from, to] of illegal) {
    const r = setStatus(from, to);
    if (r.status !== 0 || r.code !== 'INVALID_TRANSITION') illegalWrong.push(`${from}->${to}: ${r.raw}`);
  }

  check(`🔴 all ${illegal.length} illegal transitions are REFUSED with INVALID_TRANSITION`,
    illegalWrong.length === 0,
    illegalWrong.length ? illegalWrong.join(' · ') : `${illegal.length}/${illegal.length} refused`);

  const rejToShort = setStatus(6, 3);

  console.log(`\n    6 Rejected -> 3 Shortlisted : ${rejToShort.raw}`);

  check('🔴 REJECTED IS TERMINAL — Rejected -> Shortlisted refused, by decision not oversight',
    rejToShort.status === 0 && rejToShort.code === 'INVALID_TRANSITION', rejToShort.raw);

  // ---- 7..10, the offer chain --------------------------------------------
  console.log('');
  for (const to of [7, 8, 9, 10]) {
    const r = setStatus(3, to);
    console.log(`    3 Shortlisted -> ${to} : ${r.raw}`);
    check(`🔴 status ${to} (the Phase 6 offer chain) refuses with OFFER_STAGE_UNAVAILABLE`,
      r.status === 0 && r.code === 'OFFER_STAGE_UNAVAILABLE', r.raw);
  }

  const noChange = setStatus(3, 3);
  check('…and asking for the state it is already in is a SUCCESS with NO_CHANGE (2.48)',
    noChange.status === 1 && noChange.code === 'NO_CHANGE', noChange.raw);

  const codes = new Set(['INVALID_TRANSITION', 'OFFER_STAGE_UNAVAILABLE', 'NO_CHANGE']);
  check('🔴 three distinct codes — a client can tell "not from here" from "not yet" from "already there"',
    codes.size === 3, [...codes].join(' · '));

  // ---- the same chain, over HTTP -----------------------------------------
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_application_status_history WHERE ApplicationId=${appA};
    UPDATE t_app_applications SET ApplicationStatusId=1, ViewedOn=NULL WHERE ApplicationId=${appA};
    INSERT INTO t_app_application_status_history (ApplicationId, FromStatusId, ToStatusId, ChangedByUserId)
    VALUES (${appA}, NULL, 1, ${userA});`);

  const opened = await j(`${APP}/applicants/${appA}`, { headers: HO });

  check('opening an application stamps it VIEWED — no button, because opening IS seeing',
    opened.body?.data?.applicationStatusId === 2
    && scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT ApplicationStatusId FROM t_app_applications WHERE ApplicationId=${appA};`) === '2',
    `status ${opened.body?.data?.applicationStatusId}`);

  await j(`${APP}/applicants/${appA}`, { headers: HO });
  await j(`${APP}/applicants/${appA}`, { headers: HO });

  check('…and it is IDEMPOTENT — three opens, one history row for the move',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_application_status_history
      WHERE ApplicationId=${appA} AND FromStatusId=1 AND ToStatusId=2;`) === '1', '1 row');

  const shortlist = await j(`${APP}/applicants/${appA}/status`, {
    method: 'POST', headers: HO, body: JSON.stringify({ toStatusId: 3 }),
  });
  const reject = await j(`${APP}/applicants/${appA}/status`, {
    method: 'POST', headers: HO,
    body: JSON.stringify({ toStatusId: 6, remarks: 'Needs IB curriculum experience.' }),
  });

  check('over HTTP: shortlist then reject both succeed',
    shortlist.http === 200 && reject.http === 200, `${shortlist.http} / ${reject.http}`);

  const chain = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(CAST(FromStatusId AS varchar(3)),'-') + ' -> ' + CAST(ToStatusId AS varchar(3))
    FROM t_app_application_status_history WHERE ApplicationId=${appA} ORDER BY HistoryId;`);

  console.log(`\n    history chain: ${chain.join('  ·  ')}\n`);

  check('🔴 the history reads as the honest journey — from NOTHING to Applied, then on',
    chain.join(',') === '- -> 1,1 -> 2,2 -> 3,3 -> 6', chain.join(' · '));

  const backToShortlist = await j(`${APP}/applicants/${appA}/status`, {
    method: 'POST', headers: HO, body: JSON.stringify({ toStatusId: 3 }),
  });

  check('🔴 …and over HTTP too, a rejected applicant cannot be un-rejected',
    backToShortlist.http === 400 && backToShortlist.body?.code === 'INVALID_TRANSITION',
    `HTTP ${backToShortlist.http}, code ${backToShortlist.body?.code}`);

  // =========================================================================
  console.log('\n=== 3. 🔴 AN EXPIRED JOB REFUSES THE APPLY, SERVER-SIDE ===');

  const expJob = await publish(HO, ownerBranch, 'Expiring posting — 5A');

  /*
    🔴 Backdated to YESTERDAY IN IST, in SQL because the API refuses a past
    closing date on create — which is the correct rule and would make this case
    unreachable through the front door. fn_IstToday() rather than a UTC date,
    so a run between 18:30 and midnight IST still means "yesterday" in India.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET LastDateToApply = DATEADD(DAY, -1, dbo.fn_IstToday()) WHERE JobId=${expJob};`);

  const ist = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(10), LastDateToApply) + '|' + CONVERT(varchar(10), dbo.fn_IstToday())
         + '|' + CAST(JobStatusId AS varchar(2))
         + '|' + CAST(dbo.fn_EffectiveJobStatusId(JobStatusId, LastDateToApply) AS varchar(2))
    FROM t_app_jobs WHERE JobId=${expJob};`)[0].split('|').map((s) => s.trim());

  console.log(`\n    closes ${ist[0]} · IST today ${ist[1]} · stored status ${ist[2]} · effective ${ist[3]}\n`);

  check('the row still says ACTIVE and only its date has passed',
    ist[2] === '2' && ist[3] === '3', `stored ${ist[2]}, effective ${ist[3]}`);

  const expApply = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HA, body: JSON.stringify({ jobId: expJob }),
  });

  check('🔴 applying to it is REFUSED — JOB_EXPIRED, its own code',
    expApply.http === 400 && expApply.body?.code === 'JOB_EXPIRED',
    `HTTP ${expApply.http}, code ${expApply.body?.code}`);

  const expDetail = await j(`${APP}/teacher/jobs/${expJob}`, { headers: HA });
  const browse = await j(`${APP}/teacher/jobs`, { headers: HA });

  check('…its detail answers 404, the same as a job that never existed',
    expDetail.http === 404, `HTTP ${expDetail.http}`);
  check('🔴 …and it does NOT appear in the browse at all',
    !(browse.body?.data ?? []).some((x) => x.jobId === expJob),
    `${browse.body?.data?.length ?? 0} job(s) listed, none of them ${expJob}`);
  check('…while the still-open job DOES',
    (browse.body?.data ?? []).some((x) => x.jobId === job1), `job ${job1} present`);

  // =========================================================================
  console.log('\n=== 4. 🔴 NO RESUME, NO APPLICATION — THEN A RESUME, AND THE SAME CALL WORKS ===');

  /*
    ⚠️ THE HR ACCOUNT CANNOT PUBLISH, AND THAT IS THE SEED WORKING.

    It holds JOB.VIEW / CREATE / EDIT and not JOB.PUBLISH (proved again on the
    next line, and at length in jobs-lifecycle). So the draft is created through
    the API and PROMOTED IN SQL — the publish path is Phase 4's subject and is
    verified there; what is under test here is what an HR may do to APPLICANTS,
    and routing round an unrelated permission is honest as long as it is said
    out loud rather than hidden behind a second account.
  */
  const hrDraft = (await j(`${APP}/jobs`, {
    method: 'POST', headers: HH, body: body(hrBranch, 'TGT Maths — school 2'),
  })).body?.data;

  const hrPublishAttempt = await j(`${APP}/jobs/${hrDraft}/publish`, { method: 'POST', headers: HH });

  check('⚠️ premise: HR may not publish — the seed withholds JOB.PUBLISH (4\'s rule, re-proved)',
    hrPublishAttempt.http === 403, `HTTP ${hrPublishAttempt.http}`);

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET JobStatusId = 2, PublishedOn = SYSUTCDATETIME() WHERE JobId = ${hrDraft};`);

  const hrJob = hrDraft;

  check('…so the fixture job is promoted in SQL instead',
    scalar(`SET NOCOUNT ON; USE jp_app; SELECT JobStatusId FROM t_app_jobs WHERE JobId=${hrJob};`) === '2',
    `job ${hrJob} is Active`);

  const noResume = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HB, body: JSON.stringify({ jobId: hrJob }),
  });

  console.log(`\n    teacher B (no resume) applies: HTTP ${noResume.http} · code ${noResume.body?.code}`);
  console.log(`      ${noResume.body?.message}\n`);

  check('🔴 refused with RESUME_REQUIRED — a code that names the missing piece',
    noResume.http === 400 && noResume.body?.code === 'RESUME_REQUIRED',
    `HTTP ${noResume.http}, code ${noResume.body?.code}`);
  check('…and no row was written',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherB};`) === '0', '0 rows');

  const upC = await uploadResume(bToken, 'TEACHER-B-RESUME');
  writtenFiles.add(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ResumePath FROM t_app_teachers WHERE TeacherId=${teacherB};`));

  const nowApply = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HB, body: JSON.stringify({ jobId: hrJob }),
  });
  const appB = nowApply.body?.data?.applicationId;

  check('🔴 …upload a resume and the SAME call succeeds',
    upC.http === 200 && nowApply.http === 200 && appB > 0, `applicationId ${appB}`);

  /*
    🔴 SOFT VERIFICATION STAYS SOFT — AN UNVERIFIED TEACHER CAN APPLY.

    Decision 2.9 is a locked stance: the verified badge is a SIGNAL to schools,
    never a gate on the teacher. A product that quietly required verification
    to apply would lock out every teacher on the day they joined, and the
    people it locked out would be the ones with the least ability to chase it.

    ⚠️ Until now NOTHING asserted this. USP_ApplyToJob simply has no IsVerified
    clause — which is correct, and is also exactly the kind of correctness that
    a future "surely we should check" edit removes without anybody noticing.
    An unasserted stance is one edit away from being reversed.

    The assertion is deliberately two-sided: the teacher is confirmed
    UNVERIFIED in the database FIRST, so a fixture that drifted to verified
    would fail the premise rather than pass the claim for the wrong reason.
  */
  const unverified = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(TeacherId AS varchar(20)) + '|' + CAST(IsVerified AS varchar(2))
    FROM t_app_teachers
    WHERE Is_Deleted = 0 AND IsVerified = 0 AND ResumePath IS NOT NULL
    ORDER BY TeacherId;`)[0] ?? '';

  const [unverifiedTeacherId, unverifiedFlag] = unverified.split('|').map((x) => x.trim());

  check('premise: the fixture teacher really is UNVERIFIED and has a resume',
    unverifiedFlag === '0' && unverifiedTeacherId,
    `TeacherId ${unverifiedTeacherId}, IsVerified ${unverifiedFlag}`);

  const unverifiedApply = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ApplyToJob @TeacherId=${unverifiedTeacherId}, @JobId=${hrJob};`)[0] ?? '';

  console.log(`\n    unverified teacher applying: ${unverifiedApply}\n`);

  check('🔴 …and the application is ACCEPTED — the badge is a signal, not a gate (2.9)',
    /^1\|/.test(unverifiedApply.replace(/\s+/g, '')),
    unverifiedApply || '(no output)');

  const unverifiedRow = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_applications
    WHERE TeacherId = ${unverifiedTeacherId} AND JobId = ${hrJob} AND Is_Deleted = 0;`)[0];

  check('…with a real row behind it',
    unverifiedRow === '1', `${unverifiedRow} row(s)`);

  // 🔴 And consent followed: an unverified teacher's application unlocks
  // contact exactly as a verified one's does. Verification never gated this.
  const unverifiedUnlock = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT dbo.fn_TeacherContactUnlocked(${unverifiedTeacherId},
      (SELECT SchoolId FROM t_app_jobs WHERE JobId = ${hrJob}));`)[0];

  check('🔴 …and their consent unlocks contact the same way — verification never gated it',
    unverifiedUnlock === '1', `unlocked ${unverifiedUnlock}`);

  /*
    🔴 AND THE FIXTURE CLEANS UP AFTER ITSELF, IMMEDIATELY.

    The first version of this block did not, and it broke an assertion 250
    lines further down — the teacher's own stats read 2 applications instead of
    1, because the unverified teacher this section picks can be the same
    teacher that section uses.

    ⚠️ That is the third time in this project a fixture has contaminated a
    later count: the 2.5 period-boundary rows, the 4B ledger owner, and now
    this. The rule that keeps falling out of it is the same one — a fixture
    that outlives the assertion it was made for is a bug waiting for a
    different test to report it.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_application_status_history
    WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE TeacherId = ${unverifiedTeacherId} AND JobId = ${hrJob});
    DELETE FROM t_app_applications
    WHERE TeacherId = ${unverifiedTeacherId} AND JobId = ${hrJob};`);

  check('…and the unverified fixture is removed before anything downstream counts',
    sql(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications
      WHERE TeacherId = ${unverifiedTeacherId} AND JobId = ${hrJob};`)[0] === '0',
    'gone');

  // =========================================================================
  console.log('\n=== 5. 🔴 SCOPE — TEACHER, SCHOOL, AND CAMPUS ===');

  const crossTeacher = await j(`${APP}/teacher/applications/${appB}`, { headers: HA });

  check('🔴 teacher A reading teacher B\'s application -> 404, not 403',
    crossTeacher.http === 404, `HTTP ${crossTeacher.http}, code ${crossTeacher.body?.code}`);

  const aList = await j(`${APP}/teacher/applications`, { headers: HA });
  check('…and B\'s application is not in A\'s list',
    !(aList.body?.data ?? []).some((x) => x.applicationId === appB),
    `${aList.body?.data?.length} row(s), none of them ${appB}`);

  const crossSchool = await j(`${APP}/applicants/${appA}`, { headers: HH });
  const hrList = await j(`${APP}/applicants`, { headers: HH });

  check(`🔴 school ${hrSchool} reading school ${ownerSchool}'s applicant -> 404`,
    crossSchool.http === 404, `HTTP ${crossSchool.http}, code ${crossSchool.body?.code}`);
  check('🔴 …and its list contains NONE of them — zero, not fewer',
    (hrList.body?.data ?? []).every((x) => x.applicationId !== appA),
    `${hrList.body?.data?.length} row(s), none of them ${appA}`);
  check('…no SchoolId anywhere in the applicant payloads (2.39)',
    !/"schoolId"/i.test(hrList.text) && !/"schoolId"/i.test(JSON.stringify(aList.body ?? {})),
    'absent');

  // ---- a second campus the branch-bound account does not hold -------------
  const tempBranch = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_school_branches (SchoolId, BranchName, IsHeadOffice)
    VALUES (${ownerSchool}, N'5A temp campus', 0);
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  const branchJob = await publish(HO, tempBranch, 'Second campus posting — 5A');

  const branchApply = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: HB, body: JSON.stringify({ jobId: branchJob }),
  });
  const appOnTemp = branchApply.body?.data?.applicationId;

  const ownerSees = (await j(`${APP}/applicants`, { headers: HO })).body?.data ?? [];
  const viewerSees = (await j(`${APP}/applicants`, { headers: HV })).body?.data ?? [];

  console.log(`\n    owner  (all campuses)      sees ${ownerSees.length}: ${ownerSees.map((x) => `${x.applicationId}@${x.branchName}`).join(', ')}`);
  console.log(`    viewer (campus ${ownerBranch} only)   sees ${viewerSees.length}: ${viewerSees.map((x) => `${x.applicationId}@${x.branchName}`).join(', ')}\n`);

  check('fixture: a second campus, with its own applicant',
    branchApply.http === 200 && appOnTemp > 0, `application ${appOnTemp} on campus ${tempBranch}`);
  check('the OWNER sees both campuses\' applicants',
    ownerSees.length === 2, `${ownerSees.length} row(s)`);
  check('🔴 the BRANCH-BOUND account sees only its own campus — one row, not two',
    viewerSees.length === 1 && viewerSees[0].applicationId === appA,
    `${viewerSees.length} row(s): ${viewerSees.map((x) => x.applicationId).join(', ')}`);
  check('🔴 …and the other campus\'s applicant answers 404 for it',
    (await j(`${APP}/applicants/${appOnTemp}`, { headers: HV })).http === 404, 'HTTP 404');

  const viewerStats = await j(`${APP}/applicants/stats`, { headers: HV });
  const ownerStats = await j(`${APP}/applicants/stats`, { headers: HO });

  console.log(`    owner stats  : total ${ownerStats.body?.data?.totalApplications}`);
  console.log(`    viewer stats : total ${viewerStats.body?.data?.totalApplications}\n`);

  check('🔴 the dashboard tile is branch-scoped too — a total that disagreed with the list would read as a bug',
    ownerStats.body?.data?.totalApplications === 2 && viewerStats.body?.data?.totalApplications === 1,
    `owner ${ownerStats.body?.data?.totalApplications}, viewer ${viewerStats.body?.data?.totalApplications}`);

  // =========================================================================
  console.log('\n=== 6. 🔴 PERMISSIONS — FROM THE SEED ===');

  const viewerShortlist = await j(`${APP}/applicants/${appA}/status`, {
    method: 'POST', headers: HV, body: JSON.stringify({ toStatusId: 3 }),
  });

  check('🔴 a VIEWER may not shortlist — the seed withholds APPLICANT.SHORTLIST',
    viewerShortlist.http === 403, `HTTP ${viewerShortlist.http}, code ${viewerShortlist.body?.code}`);

  const viewerDetail = await j(`${APP}/applicants/${appA}`, { headers: HV });
  check('…but it may READ the applicant — the seed grants APPLICANT.VIEW',
    viewerDetail.http === 200, `HTTP ${viewerDetail.http}`);

  const viewerResume = await fetch(`${APP}/applicants/${appA}/resume`, {
    headers: { authorization: `Bearer ${viewerToken}` },
  });

  check('🔴 …and it may NOT download the resume — the seed withholds RESUME.DOWNLOAD',
    viewerResume.status === 403, `HTTP ${viewerResume.status}`);
  check('…while the OWNER, which holds it, can',
    (await fetch(`${APP}/applicants/${appA}/resume`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    })).status === 200, 'HTTP 200');

  check('⚠️ the viewer CAN see that a resume exists — the fact, never the file',
    viewerDetail.body?.data?.hasResume === true, `hasResume ${viewerDetail.body?.data?.hasResume}`);

  const hrShortlist = await j(`${APP}/applicants/${appB}/status`, {
    method: 'POST', headers: HH, body: JSON.stringify({ toStatusId: 3 }),
  });
  const hrReject = await j(`${APP}/applicants/${appB}/status`, {
    method: 'POST', headers: HH, body: JSON.stringify({ toStatusId: 6, remarks: 'no' }),
  });

  console.log(`\n    HR shortlist: HTTP ${hrShortlist.http}  ·  HR reject: HTTP ${hrReject.http} (${hrReject.body?.code})\n`);

  check('🔴 HR MAY SHORTLIST — the seed grants APPLICANT.SHORTLIST',
    hrShortlist.http === 200, `HTTP ${hrShortlist.http}`);
  check('🔴 …AND MAY NOT REJECT — the seed withholds APPLICANT.REJECT, and that is not what the role name suggests',
    hrReject.http === 403, `HTTP ${hrReject.http}, code ${hrReject.body?.code}`);
  check('…and the application is still Shortlisted after the refusal',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT ApplicationStatusId FROM t_app_applications WHERE ApplicationId=${appB};`) === '3', 'status 3');

  // =========================================================================
  console.log('\n=== 7. 🔴 ApplicationCount IS DERIVED — THE COLUMN IS STILL ZERO ===');

  const jobList = await j(`${APP}/jobs`, { headers: HO });
  const jobRow = (jobList.body?.data ?? []).find((x) => x.jobId === job1);
  const storedCount = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ApplicationCount FROM t_app_jobs WHERE JobId=${job1};`);
  const realCount = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_applications WHERE JobId=${job1} AND Is_Deleted=0;`);

  console.log(`\n    t_app_jobs.ApplicationCount (the column) : ${storedCount}`);
  console.log(`    COUNT(*) of live application rows        : ${realCount}`);
  console.log(`    what GET /api/jobs reports               : ${jobRow?.applicationCount}\n`);

  check('🔴 the stored column is STILL 0 — nothing wrote to it',
    storedCount === '0', `ApplicationCount ${storedCount}`);
  check('🔴 …and the API reports the DERIVED count, which is not 0',
    jobRow?.applicationCount === Number(realCount) && Number(realCount) > 0,
    `API ${jobRow?.applicationCount}, real ${realCount}`);

  const browseRow = (await j(`${APP}/teacher/jobs`, { headers: HA })).body?.data?.find((x) => x.jobId === job1);
  check('…and so does the teacher\'s browse, from the same derivation',
    browseRow?.applicationCount === Number(realCount), `browse ${browseRow?.applicationCount}`);
  check('…and the browse knows this teacher already applied',
    browseRow?.hasApplied === true, `hasApplied ${browseRow?.hasApplied}`);

  // 🔴 2.61 dual read: a false/false pair would agree and prove nothing.
  const dbActive = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT Is_Active FROM t_app_applications WHERE ApplicationId=${appA};`);
  const jsonActive = ownerSees.find((x) => x.applicationId === appA)?.isActive;

  console.log(`    database row : Is_Active = ${dbActive}`);
  console.log(`    JSON         : isActive  = ${jsonActive}\n`);

  check('🔴 2.61 dual read on the applicant list — the row says 1 AND the JSON says true',
    dbActive === '1' && jsonActive === true, `row ${dbActive}, json ${jsonActive}`);

  // =========================================================================
  console.log('\n=== 8. 🔴 WHAT THE TEACHER IS TOLD, AND WHAT THEY ARE NOT ===');

  const mine = await j(`${APP}/teacher/applications`, { headers: HA });
  const mineRow = (mine.body?.data ?? []).find((x) => x.applicationId === appA);

  console.log(`\n    the school typed  : "Needs IB curriculum experience."`);
  console.log(`    the teacher's list: statusName "${mineRow?.statusName}"\n`);

  check('🔴 the teacher sees "Not selected" — TeacherFacingName, never "Rejected"',
    mineRow?.statusName === 'Not selected', `"${mineRow?.statusName}"`);
  check('🔴 …the rejection REASON is nowhere in the bytes',
    !mine.text.includes('IB curriculum'), 'absent');
  check('🔴 …and the field name is not there either — absent, not blanked',
    !/"rejectionReason"/i.test(mine.text), 'no rejectionReason property');

  const mineDetail = await j(`${APP}/teacher/applications/${appA}`, { headers: HA });

  check('the teacher\'s own detail carries their journey',
    mineDetail.http === 200 && (mineDetail.body?.data?.history?.length ?? 0) > 0,
    `${mineDetail.body?.data?.history?.length} step(s)`);
  check('🔴 …with no remarks and no actor in it — that is the school\'s business',
    !/"remarks"/i.test(mineDetail.text) && !/"changedBy/i.test(mineDetail.text)
    && !mineDetail.text.includes('IB curriculum'),
    'no remarks, no actor, no reason');

  const schoolDetail = await j(`${APP}/applicants/${appA}`, { headers: HO });
  check('…while the SCHOOL\'s own view does carry both',
    schoolDetail.text.includes('IB curriculum')
    && (schoolDetail.body?.data?.history ?? []).some((h) => h.changedByUserId),
    'reason and actor present for the school');

  check('🔴 …and the teacher who applied is NOT named in the history as a colleague — '
    + 'no email fallback (the leak that would have been)',
    (schoolDetail.body?.data?.history ?? []).every(
      (h) => !String(h.changedByName ?? '').includes('@')),
    'no address in any changedByName');

  // ---- saved jobs, and the teacher's own stats ----------------------------
  const save = await j(`${APP}/teacher/jobs/${job1}/save`, { method: 'POST', headers: HA });
  const savedList = await j(`${APP}/teacher/jobs/saved`, { headers: HA });
  const unsave = await j(`${APP}/teacher/jobs/${job1}/save`, { method: 'POST', headers: HA });

  check('save / list / unsave round-trips, and the toggle reports the state it landed in',
    save.body?.data?.isSaved === true
    && (savedList.body?.data ?? []).some((x) => x.jobId === job1)
    && unsave.body?.data?.isSaved === false,
    `saved ${save.body?.data?.isSaved} -> listed -> ${unsave.body?.data?.isSaved}`);

  check('…and unsaving REVIVES one row rather than writing a second (2.4)',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_saved_jobs WHERE TeacherId=${teacherA} AND JobId=${job1};`) === '1',
    '1 row, soft-deleted');

  const tStats = await j(`${APP}/teacher/applications/stats`, { headers: HA });

  console.log(`\n    teacher stats: total ${tStats.body?.data?.totalApplications}`
    + ` · rejected ${tStats.body?.data?.rejectedCount} · saved ${tStats.body?.data?.savedJobCount}\n`);

  check('the teacher\'s own counts are real numbers over real rows',
    tStats.body?.data?.totalApplications === 1 && tStats.body?.data?.rejectedCount === 1,
    `total ${tStats.body?.data?.totalApplications}, rejected ${tStats.body?.data?.rejectedCount}`);
  check('🔴 …and even the stats tile speaks the teacher\'s language',
    (tStats.body?.data?.recent ?? []).every((x) => x.statusName !== 'Rejected'),
    (tStats.body?.data?.recent ?? []).map((x) => x.statusName).join(', '));
} finally {
  // =========================================================================
  console.log('\n=== TEARDOWN ===');
  cleanup();

  restoreProfile(teacherA, entryProfileA);
  restoreProfile(teacherB, entryProfileB);

  // The files this run wrote to App_Data. Rows are restored above; the blobs
  // would otherwise accumulate one pair per run.
  let removed = 0;
  for (const p of writtenFiles) {
    if (!p || p === '~NULL~') continue;
    const full = join(UPLOADS, p.replace(/\//g, '\\'));
    if (existsSync(full)) { unlinkSync(full); removed += 1; }
  }

  const exitApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
  const exitJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const exitBranches = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_school_branches WHERE Is_Deleted = 0;`);
  const exitA = profileOf(teacherA);
  const exitB = profileOf(teacherB);

  console.log(`  removed ${removed} uploaded file(s) from App_Data`);

  check('🔴 shipped state on EXIT — no applications, no jobs, the campus count unchanged',
    exitApps === '0' && exitJobs === '0' && exitBranches === entryBranches,
    `applications ${exitApps}, jobs ${exitJobs}, campuses ${entryBranches} -> ${exitBranches}`);

  check('🔴 …and both teacher profiles are EXACTLY as they were — G20\'s fixture intact',
    exitA.join('|') === entryProfileA.join('|') && exitB.join('|') === entryProfileB.join('|'),
    `A ${entryProfileA.join('/')} -> ${exitA.join('/')} · B ${entryProfileB.join('/')} -> ${exitB.join('/')}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
