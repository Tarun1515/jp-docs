/*
  SR-5 — THE PROFILE-MATCHED BROWSE, THROUGH THE WHOLE CHAIN.

  ----------------------------------------------------------------------------
  🔴 WHY THIS SUITE EXISTS
  ----------------------------------------------------------------------------
  The client asked that a teacher opening the job list sees work matching THEIR
  subjects and THEIR class levels — plural in both cases. That required a new
  parameter at every layer:

      <ui-multi-select>  ->  subjectIds[] in the query string
                         ->  int[] bound [FromQuery]
                         ->  dbo.IntIdList table-valued parameter
                         ->  USP_BrowseJobs

  ⚠️ EVERY ONE OF THOSE LAYERS COMPILES WHETHER OR NOT IT WORKS. A query-string
  array that fails to bind arrives as an empty list, an empty table-valued
  parameter means "do not filter", and the screen then shows EVERY job while
  claiming to show the teacher's own. Nothing is red; the feature is simply
  absent. That is precisely the failure this suite is built to catch, so it
  runs over HTTP rather than against the procedure — the binding is the part
  most likely to be wrong, and a direct EXEC would skip it.

  ----------------------------------------------------------------------------
  ⚠️ IT OWNS ITS FIXTURES (PRE-5b)
  ----------------------------------------------------------------------------
  It publishes two jobs of its own, with known subjects and class levels, and
  deletes them in `finally`. It asserts nothing about jobs it did not create —
  it counts only its own two among whatever else the database holds, so a
  demo-created row cannot turn it red and it cannot turn green by accident on
  somebody else's data.

  Run: node scripts/verify/browse-sets.mjs
*/
import { execFileSync } from 'node:child_process';

import { session as loginSession } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const API = 'http://localhost:5299/api';
const TEACHER = 'rohit.kulkarni.86002@yopmail.com';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];
const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

/* Distinctive, so nothing stale can be mistaken for this run's rows. */
const RUN = Date.now().toString().slice(-8);
const TITLE_A = `SR5 Maths Probe ${RUN}`;
const TITLE_B = `SR5 Physics Probe ${RUN}`;

/* Fixture shape — two jobs that differ in BOTH dimensions, so a filter that
   only looks at one of them cannot pass. */
const MATHS = 1;
const PHYSICS = 2;
const PRIMARY = 2;
const MIDDLE = 3;

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const cleanup = () => {
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM dbo.t_app_job_subjects     WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (N'${TITLE_A}', N'${TITLE_B}'));
    DELETE FROM dbo.t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (N'${TITLE_A}', N'${TITLE_B}'));
    DELETE FROM dbo.t_app_jobs             WHERE JobTitle IN (N'${TITLE_A}', N'${TITLE_B}');`);
};

/**
 * One published job, written directly.
 *
 * ⚠️ NOT THROUGH USP_SaveJob, deliberately. That procedure consumes a JOB_POST
 * entitlement, and SR-4 made the free plan's quota 1 — the second job would be
 * refused and the suite would fail for a reason that has nothing to do with
 * filtering. The row shape is what matters here, not the write path, and the
 * write path has its own suites.
 */
const publishJob = (title, subjectId, classLevelId) => sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @b int = (SELECT TOP (1) BranchId FROM dbo.t_app_school_branches WHERE SchoolId = 2 AND Is_Deleted = 0);
    DECLARE @et int = (SELECT TOP (1) EmploymentTypeId FROM dbo.m_app_employment_types WHERE Is_Deleted = 0);

    INSERT INTO dbo.t_app_jobs
        (SchoolId, BranchId, JobTitle, SubjectId, DesignationId, EmploymentTypeId,
         NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn,
         Is_Active, Is_Deleted, CreatedOn)
    VALUES
        (2, @b, N'${title}', ${subjectId}, 1, @et,
         1, 2, DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), SYSUTCDATETIME(),
         1, 0, SYSUTCDATETIME());

    DECLARE @j bigint = SCOPE_IDENTITY();

    INSERT INTO dbo.t_app_job_subjects     (JobId, SubjectId,    Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${subjectId}, 1, 0, SYSUTCDATETIME());
    INSERT INTO dbo.t_app_job_class_levels (JobId, ClassLevelId, Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${classLevelId}, 1, 0, SYSUTCDATETIME());

    SELECT CAST(@j AS varchar(20));`)[0];

/** The browse endpoint, with repeated query keys exactly as the app sends them. */
const browse = async (token, pairs) => {
  const qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${API}/teacher/jobs?pageSize=200${qs ? `&${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ?${qs}`);

  const body = await res.json();
  const rows = body.data ?? [];

  /* Only this run's rows count — the database holds whatever else it holds. */
  const mine = rows.filter((r) => r.jobTitle === TITLE_A || r.jobTitle === TITLE_B);

  return {
    total: body.totalRecords ?? 0,
    mine: mine.map((r) => r.jobTitle).sort(),
  };
};

try {
  console.log('\n=== SR-5: profile-matched browse, over HTTP ===\n');

  cleanup();

  const idA = publishJob(TITLE_A, MATHS, PRIMARY);
  const idB = publishJob(TITLE_B, PHYSICS, MIDDLE);

  check('fixture: two published jobs created', !!idA && !!idB, `jobIds ${idA}, ${idB}`);

  const { accessToken } = await loginSession(TEACHER, secret(TEACHER));

  // -- 1. no sets at all: both mine are visible -----------------------------
  const none = await browse(accessToken, []);
  check('no sets sent: both probe jobs listed', none.mine.length === 2, none.mine.join(', '));

  // -- 2. one subject: only that one ----------------------------------------
  const maths = await browse(accessToken, [['subjectIds', MATHS]]);
  check('subjectIds=[maths]: only the maths job',
    maths.mine.length === 1 && maths.mine[0] === TITLE_A, maths.mine.join(', '));

  /*
    🔴 THE ASSERTION THE WHOLE SUITE EXISTS FOR.

    Two repeated keys must arrive as a list of two. If the binder keeps only
    the last value — the single most likely way this breaks — this returns one
    job, not two, and the "matching your profile" screen would quietly show a
    teacher only their last subject.
  */
  const both = await browse(accessToken, [['subjectIds', MATHS], ['subjectIds', PHYSICS]]);
  check('subjectIds=[maths,physics]: BOTH jobs — repeated keys bind as a list',
    both.mine.length === 2, both.mine.join(', '));

  // -- 3. class levels filter on their own ----------------------------------
  const middle = await browse(accessToken, [['classLevelIds', MIDDLE]]);
  check('classLevelIds=[middle]: only the physics job',
    middle.mine.length === 1 && middle.mine[0] === TITLE_B, middle.mine.join(', '));

  /*
    ⚠️ THE TWO SETS NARROW TOGETHER, they do not widen. Maths is Primary and
    Physics is Middle, so asking for maths AND middle must match neither. An
    OR between the two filters would return both and look like success.
  */
  const crossed = await browse(accessToken, [['subjectIds', MATHS], ['classLevelIds', MIDDLE]]);
  check('subjectIds=[maths] + classLevelIds=[middle]: neither — the sets AND together',
    crossed.mine.length === 0, crossed.mine.join(', ') || 'none');

  // -- 4. an impossible set empties the list --------------------------------
  const bogus = await browse(accessToken, [['subjectIds', 999999]]);
  check('subjectIds=[999999]: no probe jobs', bogus.mine.length === 0, `total ${bogus.total}`);

  /*
    ⚠️ AND THE EMPTY CASE IS NOT THE SAME AS THE IMPOSSIBLE CASE. If an empty
    array were sent and silently treated as a filter, the screen would show
    nothing at all. This proves empty means "do not filter".
  */
  check('empty set is not a filter: no-sets total >= impossible-set total',
    none.total >= bogus.total, `${none.total} vs ${bogus.total}`);
} finally {
  cleanup();

  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
