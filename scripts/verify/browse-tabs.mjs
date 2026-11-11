/*
  P5 — THE THREE TABS, THROUGH HTTP, WITH THE NEGATIVES THAT MATTER.

  ----------------------------------------------------------------------------
  🔴 WHY THIS SUITE EXISTS
  ----------------------------------------------------------------------------
  "Matches your profile", "You might like" and "Preferred locations" are three
  SERVER queries over one list. Three things can go wrong and none of them is
  visible on screen:

    1. the tabs could overlap — a job in both "Matches" and "You might like"
    2. a count could disagree with the list under it
    3. a job that matches NOTHING could appear somewhere

  ----------------------------------------------------------------------------
  🔴 AND THE ONE THAT ACTUALLY BIT, WHICH IS WHY CASE 5 IS HERE
  ----------------------------------------------------------------------------
  MATCHES narrows on the sets THE CALLER SENDS. The server resolves the
  teacher's state and their saved locations from the token, but NOT their
  subjects, class levels or qualification — those ride the query string.

  So a caller that sends `mode=matches` and no sets gets THE ENTIRE OPEN
  MARKET under a tab labelled "Matches your profile". That is not a
  hypothetical: the first probe written against this feature did exactly that
  and returned all six demo jobs, including the one built to match nothing.

  The screen does send them. This suite pins BOTH halves — that the real
  shape filters, and that the no-sets shape does not — so the behaviour is
  recorded rather than rediscovered. If the server is ever made to resolve the
  profile itself, case 5 is the assertion that should change, deliberately.

  ----------------------------------------------------------------------------
  ⚠️ IT OWNS ITS FIXTURES (PRE-5b)
  ----------------------------------------------------------------------------
  Three jobs and one preferred-location row, written directly and deleted in
  `finally`. It counts only its own rows among whatever else the database
  holds, so a demo fixture cannot turn it red and it cannot turn green on
  somebody else's data.

  ⚠️ Jobs are written directly rather than through `USP_SaveJob`, which
  consumes a JOB_POST entitlement — the free plan's quota is 1, so the second
  would be refused for a reason that has nothing to do with filtering. Same
  reasoning, same precedent, as browse-sets.mjs.

  Run: node scripts/verify/browse-tabs.mjs
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

const RUN = Date.now().toString().slice(-8);
const T_MATCH = `P5 Match Probe ${RUN}`;
const T_LOOSE = `P5 Loose Probe ${RUN}`;
const T_ORPHAN = `P5 Orphan Probe ${RUN}`;
const TITLES = [T_MATCH, T_LOOSE, T_ORPHAN];

/*
  The fixture's three shapes. MATCH holds all three dimensions the probe
  sends; LOOSE shares ONLY the subject; ORPHAN shares nothing at all.
*/
const SUBJECT_MINE = 1;
const SUBJECT_OTHER = 2;
const LEVEL_MINE = 2;
const LEVEL_OTHER = 3;
const QUAL_MINE = 1;
const QUAL_OTHER = 2;

/*
  ⚠️ TWO READS, NOT A JOIN. The email lives in jp_sso and the teacher row in
  jp_app, and no query here may join across the two databases (2.2) — so the
  uid is fetched from one and handed to the other as a value. Memoised because
  cleanup runs twice (once before the fixtures, once in `finally`).
*/
let cachedUid = null;
const teacherUid = () => {
  if (!cachedUid) {
    cachedUid = sql(`SET NOCOUNT ON; USE jp_sso;
      SELECT CAST(UserUid AS varchar(40)) FROM dbo.t_sso_users WHERE Email = N'${TEACHER}';`)[0];
  }

  return cachedUid;
};

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const cleanup = () => {
  const list = TITLES.map((t) => `N'${t}'`).join(', ');

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM dbo.t_app_job_subjects     WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (${list}));
    DELETE FROM dbo.t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (${list}));
    DELETE FROM dbo.t_app_jobs             WHERE JobTitle IN (${list});
    DELETE FROM dbo.t_app_teacher_preferred_locations
      WHERE TeacherId = (SELECT TeacherId FROM dbo.t_app_teachers WHERE UserUid = '${teacherUid()}')
        AND PreferenceOrder = 9999;`);
};

/**
 * One open posting, written directly. Returns its JobId.
 *
 * 🔴 THE JOB'S StateId IS THE TEACHER'S OWN STATE, AND THAT IS NOT A
 * CONVENIENCE — IT IS WHAT MAKES "MATCHES" ANSWERABLE AT ALL.
 *
 * MATCHES is subjects AND class levels AND qualification AND **state**, and
 * the state is resolved on the SERVER from `t_app_teachers.CurrentStateId` —
 * it is deliberately not a parameter, so a caller cannot widen it.
 *
 * ⚠️ THE FIRST VERSION OF THIS FIXTURE GOT THAT WRONG and is worth recording:
 * it posted at school 2, whose branch is in state 32, while the probe teacher
 * lives in state 14. MATCHES correctly returned nothing, and three assertions
 * failed — all of them this suite's fault, none of them the server's. A
 * fixture that does not satisfy the predicate under test proves nothing about
 * the predicate.
 */
const publishJob = (title, subjectId, classLevelId, qualificationId, elsewhere = false) => sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @b int = (SELECT TOP (1) BranchId FROM dbo.t_app_school_branches WHERE SchoolId = 2 AND Is_Deleted = 0);
    DECLARE @et int = (SELECT TOP (1) EmploymentTypeId FROM dbo.m_app_employment_types WHERE Is_Deleted = 0);
    DECLARE @t bigint = (SELECT TeacherId FROM dbo.t_app_teachers WHERE UserUid = '${teacherUid()}');
    DECLARE @home int = (SELECT CurrentStateId FROM dbo.t_app_teachers WHERE UserUid = '${teacherUid()}');

    /*
      ELSEWHERE means a state the teacher has NO link to at all, not merely a
      different one. MIGHT_LIKE hits on subject OR class level OR preferred
      location, and this teacher's saved preferences are three whole states
      with no city -- so a job placed in any of them is a location hit no
      matter how wrong its subject is. See the JS comment above.

      NOTE: no double quotes anywhere in this string. sqlcmd -Q refuses them.
    */
    DECLARE @st int = ${elsewhere
      ? `(SELECT TOP (1) s.StateId FROM dbo.t_app_school_branches s
            WHERE s.StateId IS NOT NULL
              AND s.StateId <> @home
              AND NOT EXISTS (SELECT 1 FROM dbo.t_app_teacher_preferred_locations p
                              WHERE p.TeacherId = @t AND p.Is_Deleted = 0 AND p.StateId = s.StateId))`
      : '@home'};
    DECLARE @ct int = ${elsewhere ? 'NULL' : '(SELECT TOP (1) CityId FROM dbo.t_app_school_branches WHERE BranchId = @b)'};

    INSERT INTO dbo.t_app_jobs
        (SchoolId, BranchId, JobTitle, SubjectId, DesignationId, QualificationId, EmploymentTypeId,
         CityId, StateId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn,
         Is_Active, Is_Deleted, CreatedOn)
    VALUES
        (2, @b, N'${title}', ${subjectId}, 1, ${qualificationId}, @et,
         @ct, @st, 1, 2, DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), SYSUTCDATETIME(),
         1, 0, SYSUTCDATETIME());

    DECLARE @j bigint = SCOPE_IDENTITY();

    INSERT INTO dbo.t_app_job_subjects     (JobId, SubjectId,    Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${subjectId}, 1, 0, SYSUTCDATETIME());
    INSERT INTO dbo.t_app_job_class_levels (JobId, ClassLevelId, Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${classLevelId}, 1, 0, SYSUTCDATETIME());

    SELECT CAST(@j AS varchar(20));`)[0];

cleanup();

let accessToken;

try {
  ({ accessToken } = await loginSession({ id: TEACHER, pw: secret(TEACHER) }));

  /*
    ⚠️ THE PREFERENCE ROW GOES IN FIRST, BEFORE THE JOBS.

    `elsewhere` picks the orphan's state by excluding every state this teacher
    has a preference for — so the preference has to exist before that choice is
    made, or the orphan can land in the very state this row is about and turn
    up in the Preferred tab. Found that way: it did.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @t bigint = ${'(SELECT TeacherId FROM dbo.t_app_teachers WHERE UserUid = \'' + teacherUid() + '\')'};
    DECLARE @b int = (SELECT TOP (1) BranchId FROM dbo.t_app_school_branches WHERE SchoolId = 2 AND Is_Deleted = 0);
    INSERT INTO dbo.t_app_teacher_preferred_locations
        (TeacherId, CityId, StateId, PreferenceOrder, Is_Active, Is_Deleted, CreatedOn)
    SELECT @t, b.CityId, b.StateId, 9999, 1, 0, SYSUTCDATETIME()
    FROM dbo.t_app_school_branches b WHERE b.BranchId = @b;`);

  publishJob(T_MATCH, SUBJECT_MINE, LEVEL_MINE, QUAL_MINE);
  publishJob(T_LOOSE, SUBJECT_MINE, LEVEL_OTHER, QUAL_OTHER);
  publishJob(T_ORPHAN, SUBJECT_OTHER, LEVEL_OTHER, QUAL_OTHER, true);

  /* The sets the screen sends for this probe's "profile". */
  const mine = new URLSearchParams();
  mine.append('subjectIds', SUBJECT_MINE);
  mine.append('classLevelIds', LEVEL_MINE);
  mine.append('qualificationIds', QUAL_MINE);
  mine.append('pageSize', '100');

  const ask = async (extra) => {
    const r = await fetch(`${API}/teacher/jobs?${extra}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = await r.json();
    const rows = body.data ?? [];

    return {
      status: r.status,
      total: body.totalRecords ?? 0,
      mine: rows.filter((j) => TITLES.includes(j.jobTitle)).map((j) => j.jobTitle),
    };
  };

  const counts = async (extra) => {
    const r = await fetch(`${API}/teacher/jobs/counts?${extra}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return (await r.json()).data ?? {};
  };

  // -- 1. MATCHES is the strict one -----------------------------------------
  const matches = await ask(`${mine}&mode=matches`);

  check('mode=matches: only the job matching ALL THREE dimensions',
    matches.mine.length === 1 && matches.mine[0] === T_MATCH,
    matches.mine.join(', ') || 'none');

  // -- 2. MIGHT_LIKE is looser, MINUS what MATCHES already showed ------------
  const might = await ask(`${mine}&mode=might-like`);

  check('mode=might-like: the one-dimension job appears',
    might.mine.includes(T_LOOSE), might.mine.join(', ') || 'none');

  check('🔴 mode=might-like EXCLUDES the strict match — no job is in two tabs',
    !might.mine.includes(T_MATCH), might.mine.join(', ') || 'none');

  // -- 3. a job matching nothing is in NO tab --------------------------------
  check('🔴 the job that matches nothing is in neither tab',
    !matches.mine.includes(T_ORPHAN) && !might.mine.includes(T_ORPHAN),
    `matches [${matches.mine}] · might-like [${might.mine}]`);

  /*
    ⚠️ AND IT STILL EXISTS. "Absent from every tab" must mean "not
    recommended", not "deleted" — an unmoded browse has to find it, or this
    suite would pass just as well against a job that failed to publish.
  */
  const unmoded = await ask('pageSize=100');

  check('…but it IS in the unmoded browse — absent from a tab is not absent from the site',
    unmoded.mine.includes(T_ORPHAN), unmoded.mine.join(', ') || 'none');

  // -- 4. the counts agree with the lists ------------------------------------
  const c = await counts(`${mine}`);
  const matchesAll = await ask(`${mine}&mode=matches`);
  const mightAll = await ask(`${mine}&mode=might-like`);

  check('🔴 counts.matches equals the length of the matches list',
    c.matches === matchesAll.total, `count ${c.matches} · list ${matchesAll.total}`);

  check('🔴 counts.mightLike equals the length of the might-like list',
    c.mightLike === mightAll.total, `count ${c.mightLike} · list ${mightAll.total}`);

  // -- 5. 🔴 the no-sets shape, pinned deliberately --------------------------
  check('🔴 the job that matches nothing is in NO tab at all, preferred included',
    !matches.mine.includes(T_ORPHAN) && !might.mine.includes(T_ORPHAN),
    'checked again below against preferred');

  /*
    🔴 THIS PINS A REAL PROPERTY AND A REAL LIMIT IN ONE ASSERTION.

    MATCHES narrows on the caller's sets for subject, class level and
    qualification — send none and none of those three narrow anything. But the
    STATE is resolved on the server from the teacher's own row and cannot be
    widened by a caller at all.

    So the no-sets shape is NOT "the whole market": it is "everything in the
    state you live in". It therefore picks up the LOOSE job, which the
    properly-sent call excludes, and still cannot reach the orphan, which is
    in another state.

    ⚠️ The first version of this check asserted the whole market and failed —
    correctly. The server was never that loose; the assertion was.
  */
  const bare = await ask('mode=matches&pageSize=100');

  check('🔴 PINNED: no sets widens WITHIN the state — it picks up the loose job…',
    bare.mine.includes(T_LOOSE),
    `the caller's sets are what narrow subject/level/qualification · [${bare.mine}]`);

  check('🔴 …but it can never leave the state — the orphan stays out',
    !bare.mine.includes(T_ORPHAN), `[${bare.mine}]`);

  // -- 6. PREFERRED reads the teacher's saved locations ----------------------
  const preferred = await ask(`${mine}&mode=preferred`);

  check('🔴 and the orphan is not in PREFERRED either — no tab holds it',
    !preferred.mine.includes(T_ORPHAN), preferred.mine.join(', ') || 'none');

  check('mode=preferred: a saved location brings its jobs back',
    preferred.mine.length > 0, preferred.mine.join(', ') || 'none');

  const afterCounts = await counts(`${mine}`);

  check('counts.preferred equals the length of the preferred list',
    afterCounts.preferred === preferred.total,
    `count ${afterCounts.preferred} · list ${preferred.total}`);

  // -- 7. an unknown mode is refused, never silently widened -----------------
  const bogus = await ask('mode=matched&pageSize=100');

  check('🔴 an unknown mode is REFUSED (400), not treated as no mode',
    bogus.status === 400, `status ${bogus.status}`);
} finally {
  cleanup();

  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
