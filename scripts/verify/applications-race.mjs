/*
  PHASE 5A — 🔴 THE RACE, AND THE 3C NEGATIVE.

  ----------------------------------------------------------------------------
  TWO THINGS, AND THE SECOND IS THE ONE THAT HAS NEVER BEEN PROVEN
  ----------------------------------------------------------------------------

  1. THE RACE. Two GENUINELY PARALLEL applies, same teacher and same job.
     Exactly one row is written; the other session gets ALREADY_APPLIED with
     Status 1 — a success, because the teacher wanted to have applied and they
     have.

     🔴 The two sessions are armed on the same WALL-CLOCK INSTANT with
     WAITFOR TIME — the 2C pattern. Spawning two processes and hoping they
     overlap is not a race test; it is a test that usually runs sequentially and
     passes however the procedure is written.

     ⚠️ AND THE ARMING IS NOT TAKEN ON TRUST. Until this was added, every
     assertion here was about the OUTCOME — one row, one inserter, one
     ALREADY_APPLIED — and every one of them is also satisfied by two applies
     that ran SECONDS APART. If a session connected late and its WAITFOR TIME
     had already passed, it would return immediately, the pair would run
     sequentially, and this suite would have gone green while testing the plain
     double-tap path that the "sequential repeat" check below already covers.
     An armed race that silently disarms is the exact shape of a test that
     passes for the wrong reason.

     So each session now captures SYSUTCDATETIME() the instant its WAITFOR
     RETURNS, and the suite asserts the two are the same instant. Measured over
     ten runs before the tolerance was chosen: both sessions leave the gate in
     the SAME MILLISECOND every time, with their execution windows overlapping
     by ~32 ms. The tolerance is 50 ms — above the ~16 ms Windows timer tick
     that quantises both readings, and far below any real stagger.

     🔴 AND THE CHECK IS SHOWN TO HAVE TEETH. Section 1B runs the identical
     pair deliberately staggered by 2.5 s and asserts the SAME predicate
     REJECTS it. A concurrency check that has never been seen to fail is a
     concurrency check you are assuming.

  2. 🔴 THE 3C NEGATIVE — THE CATCH MUST CHECK *WHICH* INDEX COLLIDED.

     Phase 3C shipped a CATCH that claimed ALREADY_PROVISIONED on any 2601
     without looking, and it hid a real bug for a phase and a half. So
     USP_ApplyToJob compares the error message against the index NAME:

         IF @E IN (2601, 2627) AND @M LIKE '%UQ_t_app_applications_JobTeacher%'

     That guard is WRITTEN but has never been EXERCISED — every 2601 the
     procedure has ever seen came from the index it names, so a CATCH with the
     LIKE deleted would have passed every test this project has.

     This script makes a DIFFERENT index collide. It creates a TEMPORARY second
     unique index on t_app_applications, forces a 2601 on THAT index, and
     asserts the procedure does NOT report ALREADY_APPLIED — it must surface as
     itself, be logged, and re-throw. Then the index is dropped and the same
     call succeeds, which proves the temporary index was the only thing
     refusing it.

     ⚠️ A guard that has never been fired is a guard you are assuming, not one
     you have.

  ----------------------------------------------------------------------------
  Procedure-level, with no HTTP at all — deliberately. The race is a property
  of the storage layer and the CATCH, and putting a web server, a token and a
  JSON parser between the test and the thing being tested would only add ways
  for it to pass for the wrong reason.

  Shipped state asserted on ENTRY and EXIT, including the error log: a
  deliberate THROW writes a diagnostic row, and leaving it behind would
  contaminate the next reader of that table.

  ⚠️ sqlcmd needs -I — filtered indexes plus QUOTED_IDENTIFIER OFF is Msg 1934.

  Run: node scripts/verify/applications-race.mjs
*/
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVER = 'localhost\\TARUN';
const ARGS = ['-S', SERVER, '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

/** The temporary index whose collision must NOT be read as "already applied". */
const TEMP_INDEX = 'UQ_TEMP_5A_3C_OneApplicationPerTeacher';

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

/** Runs a statement that is EXPECTED to fail, and returns everything it said. */
const sqlAllowingError = (q) => {
  try {
    return { failed: false, out: execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' }) };
  } catch (error) {
    return {
      failed: true,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// FIXTURE — a real school, a real teacher, two synthetic jobs.
// ---------------------------------------------------------------------------
const TEACHER_EMAIL = 'rohit.kulkarni.86002@yopmail.com';

const teacherId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT t.TeacherId FROM t_app_teachers t
  JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid WHERE u.Email = '${TEACHER_EMAIL}';`));

const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT TOP 1 BranchId FROM t_app_school_branches
  WHERE SchoolId = 4 AND Is_Deleted = 0 ORDER BY BranchId;`));

const schoolId = 4;

const dropTempIndex = () => sql(`SET NOCOUNT ON; USE jp_app;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${TEMP_INDEX}'
             AND object_id = OBJECT_ID('dbo.t_app_applications'))
      DROP INDEX ${TEMP_INDEX} ON dbo.t_app_applications;`);

const cleanup = () => {
  /*
    🔴 THE TEMPORARY INDEX COMES OFF FIRST, AND UNCONDITIONALLY.

    If a run dies between creating it and dropping it, it stays on a real table
    and silently refuses every teacher's second application. Dropping it on the
    way IN as well as out is not defensive tidiness — it is the difference
    between a crashed test run and a broken product.
  */
  dropTempIndex();

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_application_status_history
    WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications WHERE SchoolId = ${schoolId});
    DELETE FROM t_app_applications WHERE SchoolId = ${schoolId};
    DELETE FROM t_app_jobs WHERE SchoolId = ${schoolId} AND JobTitle LIKE '5A race fixture%';`);
};

cleanup();

const entryApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
const entryJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
const entryErrors = Number(scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_error_log;`));
const entryIndexes = scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.t_app_applications');`);

console.log(`\nFixture: teacher ${teacherId}, school ${schoolId}, campus ${branchId}`);
console.log(`Error-log rows before this run: ${entryErrors}`);

check('🔴 shipped state on ENTRY — no applications, no jobs',
  entryApps === '0' && entryJobs === '0', `applications ${entryApps}, jobs ${entryJobs}`);

check('🔴 …and no leftover temporary index on t_app_applications',
  scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM sys.indexes WHERE name = '${TEMP_INDEX}'
    AND object_id = OBJECT_ID('dbo.t_app_applications');`) === '0',
  `${entryIndexes} indexes, none of them ${TEMP_INDEX}`);

// Two published jobs, written directly: the race is about the procedure and
// the index, and a login would add nothing but a rate limit.
const jobA = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                          EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
  VALUES (${schoolId}, ${branchId}, '5A race fixture A', 1, 1, 1, 2, 2, '2026-12-31', SYSUTCDATETIME());
  SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

const jobB = Number(scalar(`SET NOCOUNT ON; USE jp_app;
  INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                          EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
  VALUES (${schoolId}, ${branchId}, '5A race fixture B', 2, 1, 1, 1, 2, '2026-12-31', SYSUTCDATETIME());
  SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

check('fixture: two ACTIVE jobs at the same school', jobA > 0 && jobB > 0, `jobs ${jobA} and ${jobB}`);

try {
  // =========================================================================
  console.log('\n=== 1. 🔴 THE RACE — TWO GENUINELY PARALLEL APPLIES ===');

  /*
    🔴 BOTH SESSIONS WAIT FOR THE SAME WALL-CLOCK INSTANT.

    Four seconds out, so both sqlcmd processes are connected and parked inside
    WAITFOR before the moment arrives; they then enter the procedure within
    milliseconds of each other. This is the pattern that caught the approval
    engine's concurrency bug in 2C and the entitlement engine's in 2.5.
  */
  /*
    🔴 EACH SESSION STAMPS THE INSTANT ITS WAITFOR RETURNS.

    `@t0` is taken on the very next statement after the gate opens, before the
    procedure is entered, and `@t1` after it returns. Those two instants are
    what turn "armed" into "ran together": without them this section asserts
    only the outcome, and the outcome is identical for two applies a minute
    apart.

    ⚠️ The lock-wait delta is captured too — `sys.dm_exec_session_wait_stats`
    before and after, LCK_* only. It is REPORTED, not asserted: whether the
    loser actually blocks on the winner's key lock depends on how long the
    winner holds it, and a transaction this short may commit before the loser
    ever waits. Asserting it would make this suite flaky for a reason that has
    nothing to do with correctness.
  */
  const probe = (hhmmss, jobId) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_app;
     DECLARE @spid int = @@SPID;
     DECLARE @lck0 bigint = ISNULL((SELECT SUM(wait_time_ms) FROM sys.dm_exec_session_wait_stats
                                    WHERE session_id = @spid AND wait_type LIKE 'LCK[_]%'), 0);
     WAITFOR TIME '${hhmmss}';
     DECLARE @t0 datetime2(7) = SYSUTCDATETIME();
     EXEC USP_ApplyToJob @TeacherId=${teacherId}, @JobId=${jobId}, @CoverNote=N'race';
     DECLARE @t1 datetime2(7) = SYSUTCDATETIME();
     SELECT 'MARK|' + CONVERT(varchar(30), @t0, 126)
          + '|' + CONVERT(varchar(30), @t1, 126)
          + '|' + CAST(@spid AS varchar(12))
          + '|' + CAST(ISNULL((SELECT SUM(wait_time_ms) FROM sys.dm_exec_session_wait_stats
                               WHERE session_id = @spid AND wait_type LIKE 'LCK[_]%'), 0)
                       - @lck0 AS varchar(20));`],
    { encoding: 'utf8' });

  const lines = (r) => r.stdout.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/Changed database context/.test(l));

  const parse = (r) => {
    const line = lines(r).find((l) => !l.startsWith('MARK|')) ?? '';
    const c = line.split('|').map((x) => x.trim());

    return { raw: line, status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1] };
  };

  /** The gate instants, as milliseconds. Both parsed the same way, so the
      DIFFERENCE is exact whatever the local timezone does to the absolute. */
  const mark = (r) => {
    const line = lines(r).find((l) => l.startsWith('MARK|')) ?? '';
    const [, t0, t1, spid, lock] = line.split('|');

    return {
      raw: line,
      t0Text: t0,
      t0: new Date(t0).getTime(),
      t1: new Date(t1).getTime(),
      spid,
      lockMs: Number(lock),
    };
  };

  /*
    🔴 THE PREDICATE. Used on the real pair below AND on the deliberately
    staggered control in 1B — the same function, so "it passes here and fails
    there" is a statement about one piece of code rather than two.

    50 ms: measured, not guessed. Ten armed runs all released in the SAME
    millisecond; the floor on resolution is the ~16 ms Windows timer tick that
    quantises both SYSUTCDATETIME() readings, and any genuine stagger is
    hundreds of milliseconds at minimum.
  */
  const SAME_INSTANT_MS = 50;
  const entryGap = (A, B) => Math.abs(A.t0 - B.t0);
  const ranTogether = (A, B) => entryGap(A, B) <= SAME_INSTANT_MS;

  const startAt = new Date(Date.now() + 4000);
  const hhmmss = startAt.toTimeString().slice(0, 8);

  console.log(`  both sessions armed for ${hhmmss} …`);

  const [a, b] = await Promise.all([probe(hhmmss, jobA), probe(hhmmss, jobA)]);

  const ra = parse(a);
  const rb = parse(b);
  const ma = mark(a);
  const mb = mark(b);

  console.log(`\n  session A: ${ra.raw}`);
  console.log(`  session B: ${rb.raw}\n`);

  const overlapMs = Math.min(ma.t1, mb.t1) - Math.max(ma.t0, mb.t0);

  console.log(`  🔴 WHEN EACH SESSION LEFT THE GATE (SYSUTCDATETIME, right after WAITFOR):`);
  console.log(`     A  spid ${ma.spid}  ${ma.t0Text}   ran ${ma.t1 - ma.t0} ms, LCK waits ${ma.lockMs} ms`);
  console.log(`     B  spid ${mb.spid}  ${mb.t0Text}   ran ${mb.t1 - mb.t0} ms, LCK waits ${mb.lockMs} ms`);
  console.log(`     entry gap ${entryGap(ma, mb)} ms   ·   execution windows overlap ${overlapMs} ms\n`);

  /*
    🔴 THE ASSERTION THIS SECTION WAS MISSING.

    Everything below is about the OUTCOME, and every outcome assertion is also
    satisfied by two applies that ran a minute apart. This is the one that says
    they did not.
  */
  check('🔴 THE TWO SESSIONS LEFT THE GATE IN THE SAME INSTANT — they actually raced',
    ranTogether(ma, mb),
    `A ${ma.t0Text} · B ${mb.t0Text} · gap ${entryGap(ma, mb)} ms (tolerance ${SAME_INSTANT_MS} ms)`);

  check('…on two different SQL sessions, not one connection reused',
    ma.spid !== mb.spid && !!ma.spid && !!mb.spid, `spids ${ma.spid} and ${mb.spid}`);

  check('…and their execution windows overlapped — one was inside the procedure while the other was',
    overlapMs > 0, `${overlapMs} ms of overlap`);

  const rows = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherId} AND JobId=${jobA} AND Is_Deleted=0;`));

  const inserters = [ra, rb].filter((r) => r.status === 1 && r.code === null).length;
  const duplicates = [ra, rb].filter((r) => r.status === 1 && r.code === 'ALREADY_APPLIED').length;

  check('🔴 EXACTLY ONE ROW EXISTS — the index refused the second insert, not a SELECT',
    rows === 1, `${rows} row(s)`);
  check('🔴 exactly one session actually inserted', inserters === 1, `${inserters} inserter(s)`);
  check('🔴 the other got ALREADY_APPLIED — with Status 1, because it IS a success',
    duplicates === 1, `${duplicates} session(s) with ALREADY_APPLIED at Status 1`);

  const histRows = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_application_status_history h
    JOIN t_app_applications a ON a.ApplicationId = h.ApplicationId
    WHERE a.TeacherId=${teacherId} AND a.JobId=${jobA};`));

  check('…and the history has ONE row too — the loser wrote nothing',
    histRows === 1, `${histRows} history row(s)`);

  // A plain sequential repeat, for contrast: the same answer without the race.
  const repeat = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ApplyToJob @TeacherId=${teacherId}, @JobId=${jobA};`)[0];

  console.log(`  sequential repeat: ${repeat}\n`);

  check('a plain double-tap gives the same answer — Status 1, ALREADY_APPLIED',
    repeat.includes('ALREADY_APPLIED') && repeat.trim().startsWith('1'), repeat);

  check('…and still only one row',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherId} AND JobId=${jobA};`) === '1',
    '1 row');

  // =========================================================================
  console.log('\n=== 1B. 🔴 THE CONCURRENCY CHECK, SHOWN TO FAIL WHEN THEY RUN APART ===');

  /*
    🔴 WHY THIS SECTION EXISTS.

    The check above passed. That tells us the two sessions left the gate
    together — but only if the check is capable of noticing when they do not.
    A tolerance of, say, ten seconds would also have passed, and so would a
    predicate with a typo in it.

    ⚠️ This is the same lesson as the 3C negative below, one layer up: a guard
    that has never been seen to fire is a guard you are ASSUMING. So the
    identical pair is run again, deliberately staggered, through the SAME
    `ranTogether` function — and that function must say no.

    The stagger is 2.5 s: an order of magnitude beyond the 50 ms tolerance and
    beyond anything scheduling jitter produces, but the same order as a real
    disarm (a session connecting after its WAITFOR TIME has already passed,
    which returns immediately).
  */
  const jobC = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '5A race fixture C', 1, 1, 1, 1, 2, '2026-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /*
    ⚠️ ROUNDED UP TO A WHOLE SECOND FIRST, and that detail matters.

    WAITFOR TIME takes 'hh:mm:ss' — seconds, no fraction — so the arming
    instant is truncated. The first version of this asked for 2.5 s and
    measured 1997 ms, because truncating two sub-second bases lands them on
    adjacent seconds rather than 2.5 s apart. Rounding the base to a whole
    second makes the stagger exactly the number written here, which is the
    difference between an assertion and an approximation.
  */
  const controlBase = new Date(Math.ceil((Date.now() + 4000) / 1000) * 1000);
  const controlA = controlBase.toTimeString().slice(0, 8);
  const controlB = new Date(controlBase.getTime() + 3000).toTimeString().slice(0, 8);

  console.log(`  control: A armed for ${controlA}, B armed for ${controlB} — 3 s apart, on purpose`);

  const [ca, cb] = await Promise.all([probe(controlA, jobC), probe(controlB, jobC)]);

  const mca = mark(ca);
  const mcb = mark(cb);

  console.log(`\n     A  spid ${mca.spid}  ${mca.t0Text}`);
  console.log(`     B  spid ${mcb.spid}  ${mcb.t0Text}`);
  console.log(`     entry gap ${entryGap(mca, mcb)} ms\n`);

  check('🔴 the SAME predicate REJECTS a deliberately staggered pair — the check has teeth',
    ranTogether(mca, mcb) === false,
    `gap ${entryGap(mca, mcb)} ms > tolerance ${SAME_INSTANT_MS} ms`);

  check('…and the gap is the stagger we asked for, not an accident',
    entryGap(mca, mcb) >= 2500 && entryGap(mca, mcb) <= 3500,
    `${entryGap(mca, mcb)} ms, expected ~3000`);

  /*
    ⚠️ AND THE OUTCOME IS STILL CORRECT — which is exactly the point.

    Run apart, these two calls produce one row and one ALREADY_APPLIED, just as
    the race did. Every OUTCOME assertion in section 1 is satisfied here too.
    That is the whole reason the gate instants had to be captured: without
    them, this sequential pair is indistinguishable from a genuine race.
  */
  const controlRows = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherId} AND JobId=${jobC} AND Is_Deleted=0;`);

  const cOutcomes = [parse(ca), parse(cb)];
  const cInserters = cOutcomes.filter((r) => r.status === 1 && r.code === null).length;
  const cDuplicates = cOutcomes.filter((r) => r.status === 1 && r.code === 'ALREADY_APPLIED').length;

  check('⚠️ …while the OUTCOME is identical — one row, one inserter, one ALREADY_APPLIED',
    controlRows === '1' && cInserters === 1 && cDuplicates === 1,
    `${controlRows} row, ${cInserters} inserter, ${cDuplicates} duplicate — indistinguishable from a race by outcome alone`);

  /*
    🔴 AND THE CONTROL CLEANS UP BEFORE SECTION 2 RUNS.

    ⚠️ The first version of this section did not, and section 2 died on
    `Msg 1505 … duplicate key value is (10)`. The 3C negative works by creating
    a TEMPORARY unique index on TeacherId ALONE — which requires this teacher to
    hold exactly one application at that moment. The control's second row made
    that index impossible to create, so a section about the CATCH guard failed
    for a reason that had nothing to do with the CATCH guard.

    ⚠️ FIFTH time in this project a fixture has outlived the assertion it was
    made for: the 2.5 period-boundary rows, the 4B ledger owner, 5A's unverified
    teacher, 5B's resume upload, now this. The rule has not changed and neither
    has the cost of ignoring it — a fixture is cleaned where it is made, not at
    the end of the file.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_application_status_history
     WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications WHERE JobId = ${jobC});
    DELETE FROM t_app_applications WHERE JobId = ${jobC};
    DELETE FROM t_app_jobs WHERE JobId = ${jobC};`);

  check('…and the control fixture is removed before the 3C negative needs the table',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications WHERE TeacherId = ${teacherId} AND Is_Deleted = 0;`) === '1',
    'teacher is back to exactly one application — which is what the temporary index requires');

  // =========================================================================
  console.log('\n=== 2. 🔴 THE 3C NEGATIVE — A DIFFERENT INDEX MUST NOT WEAR THIS ONE\'S CLOTHES ===');

  /*
    A SECOND unique index, on TeacherId alone. The teacher already holds one
    application, so creating it succeeds — and any application to a SECOND job
    now violates THIS index while leaving UQ_t_app_applications_JobTeacher
    perfectly happy.

    That is precisely the situation the guard exists for: a 2601 that is NOT
    "already applied".
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    CREATE UNIQUE NONCLUSTERED INDEX ${TEMP_INDEX}
      ON dbo.t_app_applications (TeacherId) WHERE Is_Deleted = 0;`);

  check('a TEMPORARY second unique index is in place',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM sys.indexes WHERE name='${TEMP_INDEX}'
      AND object_id=OBJECT_ID('dbo.t_app_applications');`) === '1',
    TEMP_INDEX);

  const before3c = Number(scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`));

  const forced = sqlAllowingError(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ApplyToJob @TeacherId=${teacherId}, @JobId=${jobB};`);

  const forcedOut = forced.out.replace(/\s+/g, ' ').trim();

  console.log(`\n  applying to job ${jobB} (a DIFFERENT job — the JobTeacher index is not involved):`);
  console.log(`    ${forcedOut.slice(0, 340)}\n`);

  check('🔴 THE PROCEDURE DID NOT SAY ALREADY_APPLIED — the 3C mistake, not repeated',
    !/ALREADY_APPLIED/i.test(forced.out),
    /ALREADY_APPLIED/i.test(forced.out)
      ? 'IT CLAIMED ALREADY_APPLIED FOR A COLLISION ON ANOTHER INDEX'
      : 'no ALREADY_APPLIED anywhere in the output');

  check('🔴 …it surfaced as ITSELF — the error re-thrown, naming the OTHER index',
    forced.failed && /2601/.test(forced.out) && forced.out.includes(TEMP_INDEX),
    `failed ${forced.failed}, mentions 2601 ${/2601/.test(forced.out)}, names ${TEMP_INDEX} ${forced.out.includes(TEMP_INDEX)}`);

  check('🔴 …and it did NOT name the JobTeacher index, which was never violated',
    !forced.out.includes('UQ_t_app_applications_JobTeacher'),
    'UQ_t_app_applications_JobTeacher absent from the error');

  const after3c = Number(scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`));

  check('…and no row was written — the transaction rolled back',
    after3c === before3c, `${before3c} before, ${after3c} after`);

  const logged = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(ErrorNumber AS varchar(10)) + '|' + ISNULL(ErrorProcedure,'?') + '|' + ISNULL(ContextInfo,'?')
    FROM t_app_error_log WHERE ContextInfo = 'USP_ApplyToJob' ORDER BY ErrorLogId DESC;`)[0] ?? '';

  console.log(`  error log row: ${logged}\n`);

  check('🔴 …and it was LOGGED before being re-thrown — a real bug leaves a trace',
    logged.startsWith('2601|') && logged.includes('USP_ApplyToJob'), logged || '(nothing logged)');

  // ---- and now prove the temporary index was the ONLY thing refusing it ----
  dropTempIndex();

  check('the temporary index is dropped',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM sys.indexes WHERE name='${TEMP_INDEX}'
      AND object_id=OBJECT_ID('dbo.t_app_applications');`) === '0', 'gone');

  const retry = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ApplyToJob @TeacherId=${teacherId}, @JobId=${jobB};`)[0];

  console.log(`  the same call, with the index gone: ${retry}\n`);

  check('🔴 …and the SAME call now SUCCEEDS — nothing but that index was refusing it',
    retry.trim().startsWith('1') && !/ALREADY_APPLIED/.test(retry), retry);

  check('…so the teacher now holds two applications, one per job',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_applications WHERE TeacherId=${teacherId} AND Is_Deleted=0;`) === '2',
    '2 applications');
} finally {
  // =========================================================================
  console.log('\n=== TEARDOWN ===');
  cleanup();

  /*
    The deliberate THROW wrote a diagnostic row. It is removed, because the
    next person reading t_app_error_log should not find a 2601 from an index
    that no longer exists and spend an afternoon on it.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_error_log
    WHERE ContextInfo = 'USP_ApplyToJob' AND ErrorMessage LIKE '%${TEMP_INDEX}%';`);

  const exitApps = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_applications;`);
  const exitJobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const exitErrors = Number(scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_error_log;`));
  const exitIndexes = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.t_app_applications');`);

  check('🔴 shipped state on EXIT — no applications, no jobs',
    exitApps === '0' && exitJobs === '0', `applications ${exitApps}, jobs ${exitJobs}`);

  check('🔴 …the temporary index is gone and the index count is back to what it was',
    exitIndexes === entryIndexes, `${entryIndexes} before, ${exitIndexes} after`);

  check('🔴 …and the error log is back to its own baseline',
    exitErrors === entryErrors, `${entryErrors} before, ${exitErrors} after`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
