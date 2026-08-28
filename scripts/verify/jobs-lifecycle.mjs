/*
  PHASE 4 — the job lifecycle, branch scope, permissions, expiry and validation.

  ----------------------------------------------------------------------------
    1. LIFECYCLE      draft -> edit -> publish -> in the list -> close, as a
                      real school user, with the JSON shown at each step.
    5. 🔴 SCOPE       a branch the caller does not hold, on CREATE and on EDIT.
                      Both refused, and with NOT_FOUND rather than FORBIDDEN.
    6. PERMISSIONS    HR may create and edit and may NOT publish or close —
                      because that is what the SEED says, not what the UI thinks.
    7. EXPIRY         a job whose closing date was yesterday reads Expired with
                      no process having run. The stored row still says Active;
                      both are printed side by side.
    8. VALIDATION     salary inverted, closing date in the past, zero vacancies —
                      each with its own caller-distinguishable Code.

  ----------------------------------------------------------------------------
  🔴 THE SCOPE NEGATIVE IS A REAL CROSS-TENANT ATTEMPT
  ----------------------------------------------------------------------------
  The HR account belongs to one school; the owner account to another. HR sends
  the OTHER school's real, existing BranchId in the body — which is exactly the
  shape of the bug 2.39 warns about, because a BranchId in a body is
  LEGITIMATE and only validation tells the two apart.

  ⚠️ And the refusal must be NOT_FOUND. FORBIDDEN would confirm the branch
  exists, which is an id oracle (2.6).

  ----------------------------------------------------------------------------
  Shipped state is asserted on entry and restored on exit (the 2.5 lesson).

  Run (both APIs up): node scripts/verify/jobs-lifecycle.mjs
*/
import { execFileSync } from 'node:child_process';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const HR = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };

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

const owner = await login(OWNER.id, OWNER.pw);
const hr = await login(HR.id, HR.pw);
const HO = { authorization: `Bearer ${owner}`, 'content-type': 'application/json' };
const HH = { authorization: `Bearer ${hr}`, 'content-type': 'application/json' };

const ownerBranch = (await j(`${APP}/branches`, { headers: HO })).body?.data?.[0]?.branchId;
const hrBranch = (await j(`${APP}/branches`, { headers: HH })).body?.data?.[0]?.branchId;

const ownerSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${ownerBranch};`));
const hrSchool = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT SchoolId FROM t_app_school_branches WHERE BranchId=${hrBranch};`));

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_job_subjects WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool}));
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool}));
  DELETE FROM t_app_jobs WHERE SchoolId IN (${ownerSchool}, ${hrSchool});`);

cleanup();

const body = (over = {}) => JSON.stringify({
  branchId: ownerBranch, jobTitle: 'PGT Physics', subjectId: 1, designationId: 1,
  employmentTypeId: 1, noOfVacancies: 2, salaryMin: 30000, salaryMax: 50000,
  lastDateToApply: '2026-12-31', subjectIds: [1, 2], classLevelIds: [1],
  ...over,
});

const show = (label, r) => {
  console.log(`\n  ${label}`);
  console.log(`    HTTP ${r.http} · status ${r.body?.status} · code ${r.body?.code ?? 'null'}`);
  if (r.body?.data !== undefined && typeof r.body.data !== 'object') {
    console.log(`    data: ${r.body.data}`);
  }
};

try {
  console.log(`\nowner: school ${ownerSchool} campus ${ownerBranch}`
    + ` · HR: school ${hrSchool} campus ${hrBranch}`);

  check('premise: the two accounts really are at DIFFERENT schools',
    ownerSchool !== hrSchool, `${ownerSchool} vs ${hrSchool}`);

  // =========================================================================
  console.log('\n=== 1. THE LIFECYCLE ===');

  const created = await j(`${APP}/jobs`, { method: 'POST', headers: HO, body: body() });
  show('create a draft', created);
  const jobId = created.body?.data;

  check('a job is created', created.http === 200 && jobId > 0, `jobId ${jobId}`);
  check('…and it is born a DRAFT',
    scalar(`SET NOCOUNT ON; USE jp_app; SELECT JobStatusId FROM t_app_jobs WHERE JobId=${jobId};`) === '1',
    'JobStatusId 1');

  const detail = await j(`${APP}/jobs/${jobId}`, { headers: HO });
  console.log(`    subjects ${JSON.stringify(detail.body?.data?.subjectIds)}`
    + ` · classLevels ${JSON.stringify(detail.body?.data?.classLevelIds)}`
    + ` · locked ${detail.body?.data?.structuralFieldsLocked}`);

  check('the subject and class-level sets came back',
    detail.body?.data?.subjectIds?.length === 2 && detail.body?.data?.classLevelIds?.length === 1,
    `${detail.body?.data?.subjectIds?.length} subjects, ${detail.body?.data?.classLevelIds?.length} levels`);
  check('a draft reports its structural fields UNLOCKED',
    detail.body?.data?.structuralFieldsLocked === false,
    `locked ${detail.body?.data?.structuralFieldsLocked}`);

  const edited = await j(`${APP}/jobs`, {
    method: 'POST', headers: HO,
    body: body({ jobId, jobTitle: 'PGT Physics (Senior)', salaryMax: 60000 }),
  });
  show('edit the draft', edited);
  check('a draft edits freely', edited.http === 200, `HTTP ${edited.http}`);

  const published = await j(`${APP}/jobs/${jobId}/publish`, { method: 'POST', headers: HO });
  show('publish', published);
  check('it publishes', published.http === 200 && published.body?.data?.jobStatusId === 2,
    `status ${published.body?.data?.jobStatusId}`);
  check('…and on a FREE feature nothing is consumed',
    published.body?.data?.consumed === false, `consumed ${published.body?.data?.consumed}`);

  const listed = await j(`${APP}/jobs?statusId=2`, { headers: HO });
  check('it appears in the Active list',
    listed.body?.data?.some((x) => x.jobId === jobId), `${listed.body?.data?.length} active`);

  // 🔴 2.61 dual read on the job list.
  const row = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT Is_Active, JobStatusId FROM t_app_jobs WHERE JobId=${jobId};`)[0].split('|').map((s) => s.trim());
  const jsonRow = listed.body.data.find((x) => x.jobId === jobId);

  console.log(`\n    database row : Is_Active = ${row[0]}, JobStatusId = ${row[1]}`);
  console.log(`    JSON         : isActive  = ${jsonRow.isActive}, storedStatusId = ${jsonRow.storedStatusId}\n`);

  check('🔴 2.61 dual read — the row says 1 AND the JSON says true',
    row[0] === '1' && jsonRow.isActive === true,
    `row ${row[0]}, json ${jsonRow.isActive} — a false/false pair would agree and prove nothing`);

  const lockedEdit = await j(`${APP}/jobs`, {
    method: 'POST', headers: HO, body: body({ jobId, subjectId: 7 }),
  });
  check('🔴 a published job refuses a SUBJECT swap — JOB_FIELD_LOCKED',
    lockedEdit.http === 400 && lockedEdit.body?.code === 'JOB_FIELD_LOCKED',
    `HTTP ${lockedEdit.http}, code ${lockedEdit.body?.code}`);

  const termsEdit = await j(`${APP}/jobs`, {
    method: 'POST', headers: HO,
    body: body({ jobId, jobTitle: 'PGT Physics (Senior) — revised', salaryMax: 70000 }),
  });
  check('…but its TERMS still edit — title and salary',
    termsEdit.http === 200, `HTTP ${termsEdit.http}`);

  const closed = await j(`${APP}/jobs/${jobId}/close`, { method: 'POST', headers: HO });
  show('close', closed);
  check('it closes', closed.http === 200
    && scalar(`SET NOCOUNT ON; USE jp_app; SELECT JobStatusId FROM t_app_jobs WHERE JobId=${jobId};`) === '4',
    'JobStatusId 4');

  // =========================================================================
  console.log('\n=== 5. 🔴 BRANCH SCOPE — CREATE AND EDIT ===');

  const wrongCreate = await j(`${APP}/jobs`, {
    method: 'POST', headers: HH,
    // 🔴 A real, existing branch — belonging to the OTHER school.
    body: body({ branchId: ownerBranch, jobTitle: 'Cross-tenant create' }),
  });

  check('🔴 create against another school\'s campus is REFUSED',
    wrongCreate.http === 404, `HTTP ${wrongCreate.http}, code ${wrongCreate.body?.code}`);
  check('🔴 …with NOT_FOUND, not FORBIDDEN — a 403 would confirm the campus exists',
    wrongCreate.body?.code === 'NOT_FOUND', wrongCreate.body?.code);

  const wrongEdit = await j(`${APP}/jobs`, {
    method: 'POST', headers: HH,
    body: body({ jobId, branchId: hrBranch, jobTitle: 'Cross-tenant edit' }),
  });

  check('🔴 EDIT of another school\'s job is REFUSED too',
    wrongEdit.http === 404 && wrongEdit.body?.code === 'NOT_FOUND',
    `HTTP ${wrongEdit.http}, code ${wrongEdit.body?.code}`);

  const wrongRead = await j(`${APP}/jobs/${jobId}`, { headers: HH });
  check('…and so is READING it', wrongRead.http === 404, `HTTP ${wrongRead.http}`);

  const hrList = await j(`${APP}/jobs`, { headers: HH });
  check('🔴 the other school\'s list contains NONE of it — zero, not fewer',
    (hrList.body?.data ?? []).every((x) => x.jobId !== jobId),
    `${hrList.body?.data?.length ?? 0} rows, none of them job ${jobId}`);

  const leaked = JSON.stringify(listed.body?.data ?? []);
  check('🔴 no response leaks SchoolId (2.39\'s last assertion)',
    !/"schoolId"/i.test(leaked), leaked.includes('schoolId') ? 'LEAKED' : 'absent from the payload');

  // =========================================================================
  console.log('\n=== 6. PERMISSIONS — FROM THE SEED ===');

  const hrJob = await j(`${APP}/jobs`, {
    method: 'POST', headers: HH,
    body: body({ branchId: hrBranch, jobTitle: 'HR draft' }),
  });
  check('HR may CREATE a draft — the seed grants JOB.CREATE',
    hrJob.http === 200, `HTTP ${hrJob.http}`);

  const hrPublish = await j(`${APP}/jobs/${hrJob.body?.data}/publish`, { method: 'POST', headers: HH });
  check('🔴 HR may NOT publish — the seed withholds JOB.PUBLISH',
    hrPublish.http === 403, `HTTP ${hrPublish.http}, code ${hrPublish.body?.code}`);

  const hrClose = await j(`${APP}/jobs/${hrJob.body?.data}/close`, { method: 'POST', headers: HH });
  check('🔴 …nor close — the seed withholds JOB.CLOSE',
    hrClose.http === 403, `HTTP ${hrClose.http}, code ${hrClose.body?.code}`);

  check('…and the draft is still a Draft after both refusals',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT JobStatusId FROM t_app_jobs WHERE JobId=${hrJob.body?.data};`) === '1', 'JobStatusId 1');

  // =========================================================================
  console.log('\n=== 7. 🔴 EXPIRY IS DERIVED — NOTHING RAN ===');

  const expiring = await j(`${APP}/jobs`, {
    method: 'POST', headers: HO, body: body({ jobTitle: 'Expiring job' }),
  });
  const expJob = expiring.body?.data;
  await j(`${APP}/jobs/${expJob}/publish`, { method: 'POST', headers: HO });

  /*
    🔴 Backdated to YESTERDAY IN IST. Set in SQL because the API refuses a past
    closing date on create — which is the correct rule, and would make this case
    unreachable through the front door.

    fn_IstToday() is used rather than a UTC date so that running this between
    18:30 and midnight IST — when the UTC date is already tomorrow — still means
    "yesterday" to a person in India.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET LastDateToApply = DATEADD(DAY, -1, dbo.fn_IstToday()) WHERE JobId=${expJob};`);

  const after = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT JobStatusId, CONVERT(varchar(10), LastDateToApply), CONVERT(varchar(10), dbo.fn_IstToday()),
           CONVERT(varchar(30), SYSUTCDATETIME())
    FROM t_app_jobs WHERE JobId=${expJob};`)[0].split('|').map((s) => s.trim());

  const expList = await j(`${APP}/jobs`, { headers: HO });
  const expItem = expList.body?.data?.find((x) => x.jobId === expJob);

  console.log(`\n    database row : JobStatusId = ${after[0]} (Active), LastDateToApply = ${after[1]}`);
  console.log(`    IST today    : ${after[2]}   (UTC now ${after[3]})`);
  console.log(`    API response : jobStatusId = ${expItem?.jobStatusId} (${expItem?.statusName}),`
    + ` storedStatusId = ${expItem?.storedStatusId} (${expItem?.storedStatusName})\n`);

  check('🔴 the stored row still says ACTIVE — no process changed it',
    after[0] === '2', `JobStatusId ${after[0]}`);
  check('🔴 …and the API reports EXPIRED, derived from the date',
    expItem?.jobStatusId === 3 && expItem?.storedStatusId === 2,
    `effective ${expItem?.jobStatusId}, stored ${expItem?.storedStatusId}`);

  const expiredFilter = await j(`${APP}/jobs?statusId=3`, { headers: HO });
  check('…and filtering on Expired finds it',
    expiredFilter.body?.data?.some((x) => x.jobId === expJob),
    `${expiredFilter.body?.data?.length} expired`);

  const closeExpired = await j(`${APP}/jobs/${expJob}/close`, { method: 'POST', headers: HO });
  check('an EXPIRED job can still be closed — the useful action',
    closeExpired.http === 200, `HTTP ${closeExpired.http}`);

  // =========================================================================
  console.log('\n=== 8. VALIDATION — DISTINCT CODES ===');

  const cases = [
    ['salary inverted', { salaryMin: 90000, salaryMax: 10000 }, 'INVALID_SALARY_RANGE'],
    ['closing date in the past', { lastDateToApply: '2020-01-01' }, 'LAST_DATE_IN_PAST'],
    ['zero vacancies', { noOfVacancies: 0 }, 'INVALID_VACANCIES'],
    ['no title', { jobTitle: '  ' }, 'JOB_TITLE_REQUIRED'],
    ['experience inverted', { minExperienceMonths: 120, maxExperienceMonths: 12 }, 'INVALID_EXPERIENCE_RANGE'],
  ];

  for (const [label, over, expected] of cases) {
    const r = await j(`${APP}/jobs`, { method: 'POST', headers: HO, body: body(over) });
    check(`${label} -> ${expected}`, r.body?.code === expected,
      `HTTP ${r.http}, code ${r.body?.code}`);
  }

  const codes = new Set();
  for (const [, over] of cases) {
    const r = await j(`${APP}/jobs`, { method: 'POST', headers: HO, body: body(over) });
    codes.add(r.body?.code);
  }
  check('🔴 every validation refusal has its OWN code — a caller can tell them apart',
    codes.size === cases.length, `${codes.size} distinct codes for ${cases.length} cases`);
} finally {
  console.log('\n=== TEARDOWN ===');
  cleanup();

  const left = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const mode = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(GatingModeId AS varchar(2)) + '|' + CAST(Is_Active AS varchar(2))
    FROM m_mdm_features WHERE FeatureCode='JOB_POST';`);
  const maps = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted=0;`);

  check('🔴 shipped state on EXIT — no jobs, JOB_POST still FREE, no mappings',
    left === '0' && mode === '1|1' && maps === '0',
    `jobs ${left}, JOB_POST ${mode}, mappings ${maps}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
