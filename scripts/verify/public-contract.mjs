/*
  PHASE 7A — THE PUBLIC SURFACE. THE FIRST UNAUTHENTICATED CONTRACT.

  ----------------------------------------------------------------------------
    0. ENTRY        shipped state; five job fixtures covering every wall case
    1. 🔴 THE WALL  draft · expired(IST) · closed · soft-deleted each 404 on
                    the public route — and the SAME ids work for the school
    2. 🔒 LAST DAY  a job whose last date is TODAY is still PUBLIC — the
                    boundary a UTC comparison gets wrong by 5.5 hours
    3. 🔒 RAW BYTES every public endpoint's response, read as text: no teacher
                    field, no school contact, no plan/quota/entitlement
    4. 🔒 NO TOKEN  the same request WITH a valid Bearer token returns
                    byte-identical JSON — the public path reads no identity
    5. 🔴 HONEYPOT  filled hidden field -> 200 and NO ROW
    6. 🔴 LIMITED   the search hammered past its limit -> 429 leaking nothing
    7. 🔴 VIEWS     batched, off the read path, and nothing orders by it
    8. EXIT         fixtures gone, shipped state restored

  ----------------------------------------------------------------------------
  🔒 WHY THIS SUITE READS RAW TEXT RATHER THAN PARSED FIELDS
  ----------------------------------------------------------------------------
  A parsed assertion can only check fields somebody thought to name. The risk
  on an anonymous surface is a field nobody thought about — added to a nested
  type, or serialised by a DTO that gained a property. So section 3 searches
  the response BODY as a string for things that must never appear anywhere in
  it, at any depth, under any name.

  ⚠️ THIS SUITE SPENDS THE CONTACT FORM'S HOURLY BUDGET (3 per IP, by design).
  The limiter is in-memory and per process, so re-running inside the hour needs
  a RESTARTED JP.App.Api rather than a wait. Section 5 checks this first and
  says so, because an exhausted bucket otherwise looks like a broken honeypot.

  Run (both APIs):  node scripts/verify/public-contract.mjs
*/
import { execFileSync } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';

const APP = 'http://localhost:5299/api';
const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

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

/** Raw, so the body can be read as TEXT before anything parses it. */
const raw = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();

  return { http: r.status, text, headers: r.headers };
};

const PROBE = 'PUBPROBE';

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
  DELETE FROM t_app_job_subjects     WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';
  DELETE FROM t_app_contact_enquiries WHERE Email LIKE 'pubprobe%';`);

try {
  // =========================================================================
  section('0. ENTRY — five fixtures, one per wall case');
  // =========================================================================

  cleanup();

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(sc.SchoolId AS varchar(10)) FROM t_app_schools sc
      INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
     WHERE u.Email = '${OWNER.id}';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(10)) FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  /*
    🔴 EXPIRED IS YESTERDAY **IST**, AND LAST-DAY IS TODAY IST.

    An earlier hand probe set "expired" to TODAY and read the correct function
    as a leak: a job whose LAST date to apply is today is still open — you can
    apply on the last day. Both rows are here because the pair is the assertion.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId,
                            LastDateToApply, PublishedOn, StateId)
    VALUES
      (${schoolId}, ${branchId}, N'${PROBE} live',     1, 1, 1, 2, 2, '2027-12-31', SYSUTCDATETIME(), 1),
      (${schoolId}, ${branchId}, N'${PROBE} lastday',  1, 1, 1, 1, 2, dbo.fn_IstToday(), SYSUTCDATETIME(), 1),
      (${schoolId}, ${branchId}, N'${PROBE} expired',  1, 1, 1, 1, 2, DATEADD(day, -1, dbo.fn_IstToday()), SYSUTCDATETIME(), 1),
      (${schoolId}, ${branchId}, N'${PROBE} draft',    1, 1, 1, 1, 1, '2027-12-31', NULL, 1),
      (${schoolId}, ${branchId}, N'${PROBE} closed',   1, 1, 1, 1, 4, '2027-12-31', SYSUTCDATETIME(), 1);`);

  const uidOf = (suffix) => scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs
     WHERE JobTitle = N'${PROBE} ${suffix}';`);

  const uids = {
    live: uidOf('live'),
    lastday: uidOf('lastday'),
    expired: uidOf('expired'),
    draft: uidOf('draft'),
    closed: uidOf('closed'),
  };

  const stored = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT SUBSTRING(JobTitle, 9, 20) + ' stored=' + CAST(JobStatusId AS varchar(3))
         + ' effective=' + CAST(dbo.fn_EffectiveJobStatusId(JobStatusId, LastDateToApply) AS varchar(3))
      FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%' ORDER BY JobTitle;`);

  console.log(`\n    IST now ${scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(19), dbo.fn_ToIst(SYSUTCDATETIME()), 126);`)}  ·  UTC now ${scalar(`SET NOCOUNT ON;
    SELECT CONVERT(varchar(19), SYSUTCDATETIME(), 126);`)}`);
  stored.forEach((l) => console.log(`      ${l}`));
  console.log('');

  check('premise: five fixtures exist, one per wall case',
    Object.values(uids).every((u) => u.length === 36), Object.keys(uids).join(', '));

  /*
    ENTRY: THE SHIPPED STATE THIS SUITE DEPENDS ON — the seeded FAQ copy.

    003_seed_public_faqs moved twelve questions out of faq.component.ts and
    into the database, because 2.81 made FAQs admin-editable. /faq renders from
    this table, so an empty table is a blank page on the public site.

    ⚠️ A FLOOR, not an exact count: an admin ADDING a FAQ must not fail this
    suite. What it catches is the seed never having run, or the table being
    emptied.
  */
  const seededFaqs = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs
     WHERE Is_Active = 1 AND Is_Deleted = 0;`));

  check('entry: the seeded FAQ copy is live — /faq renders from it',
    seededFaqs >= 12, `${seededFaqs} live FAQ(s), floor 12`);

  /*
    🔴 AND THE ANSWER PHASE 7A MADE FALSE IS GONE.

    The shipped page answered "Can I search for jobs without an account?" with
    "Not yet. Public job search is being built" — and this phase built it. The
    seed corrects that answer and carries a guard of its own; this is the same
    assertion from the other side, over the data the site actually serves.
  */
  check('🔴 entry: the public-search FAQ no longer answers "Not yet"',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs
       WHERE Question = N'Can I search for jobs without an account?'
         AND Answer LIKE N'%Not yet%';`) === '0',
    'the page would otherwise deny the feature it is running on');

  // =========================================================================
  section('1. 🔴 THE WALL — four states, four 404s, raw');
  // =========================================================================

  for (const state of ['expired', 'draft', 'closed']) {
    const r = await raw(`${APP}/public/jobs/${uids[state]}`);

    console.log(`    ${state.padEnd(8)}: HTTP ${r.http}  ${r.text.slice(0, 92)}`);

    check(`🔴 a ${state} job is 404 on the public route`,
      r.http === 404, `HTTP ${r.http}`);

    /*
      🔒 THE REFUSAL MAY NOT SAY WHY. "This job has expired" confirms the id is
      real, which on an anonymous endpoint is an enumeration oracle — 2.6's
      reasoning with no caller to protect.
    */
    check(`🔒 …and the message does NOT say it expired/closed/was a draft`,
      !/expired|closed|draft|unpublished|pulled|moderat/i.test(r.text),
      'the refusal reveals nothing');
  }

  /* Soft-deleted is the fourth case, and it is set here rather than seeded. */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET Is_Deleted = 1 WHERE JobTitle = N'${PROBE} live';`);

  const deleted = await raw(`${APP}/public/jobs/${uids.live}`);

  check('🔴 a soft-deleted job is 404 too',
    deleted.http === 404, `HTTP ${deleted.http}`);

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_jobs SET Is_Deleted = 0 WHERE JobTitle = N'${PROBE} live';`);

  const live = await raw(`${APP}/public/jobs/${uids.live}`);

  check('…and the live one is 200 again once undeleted',
    live.http === 200, `HTTP ${live.http}`);

  /*
    🔴 THE OTHER HALF OF THE WALL: the SAME ids are visible to the school.

    A 404 that is really "this endpoint is broken" would pass every assertion
    above. The school's own authenticated list must still show all five.
  */
  const ownerToken = await loginToken(OWNER);

  const ownList = await raw(`${APP}/jobs?pageSize=50`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });

  const ownCount = (ownList.text.match(/PUBPROBE/g) ?? []).length;

  console.log(`\n    the school's own list mentions PUBPROBE ${ownCount} time(s)\n`);

  check('🔴 …and all five are still there on the school\'s OWN list',
    ownList.http === 200 && ownCount >= 5,
    `${ownCount} mentions — the 404s are the wall, not a broken endpoint`);

  const searched = await raw(`${APP}/public/jobs?search=${PROBE}`);

  check('🔴 the listing shows exactly the TWO public ones',
    (searched.text.match(/PUBPROBE/g) ?? []).length === 2,
    `${(searched.text.match(/PUBPROBE/g) ?? []).length} of 5 fixtures are public`);

  // =========================================================================
  section('2. 🔒 THE LAST DAY — the 5.5-hour trap');
  // =========================================================================

  const lastday = await raw(`${APP}/public/jobs/${uids.lastday}`);

  const istDate = scalar(`SET NOCOUNT ON; USE jp_app; SELECT CONVERT(varchar(10), dbo.fn_IstToday(), 23);`);
  const utcDate = scalar(`SET NOCOUNT ON; SELECT CONVERT(varchar(10), SYSUTCDATETIME(), 23);`);

  console.log(`\n    IST date ${istDate} · UTC date ${utcDate} · they ${istDate === utcDate ? 'MATCH (the trap is dormant right now)' : 'DIFFER — the trap is live right now'}\n`);

  /*
    🔒 A JOB WHOSE LAST DATE IS TODAY IS STILL OPEN. You can apply on the last
    day — and 014's function compares against fn_IstToday() rather than the UTC
    date for exactly this: between 18:30 and 24:00 IST the UTC date is already
    tomorrow, so a UTC comparison expires every job 5.5 hours early, every
    evening.
  */
  check('🔒 a job whose LAST date to apply is TODAY (IST) is still public',
    lastday.http === 200, `HTTP ${lastday.http}`);

  check('🔴 …and yesterday-IST is not — one day apart, opposite answers',
    (await raw(`${APP}/public/jobs/${uids.expired}`)).http === 404,
    'the boundary is a date, not a timestamp');

  // =========================================================================
  section('3. 🔒 RAW BYTES — every public endpoint, read as text');
  // =========================================================================

  /*
    🔒 Things that must not appear ANYWHERE in a public response, at any depth
    and under any name. Read as text precisely because a parsed check can only
    look at fields somebody thought to name.
  */
  const FORBIDDEN = [
    // teacher data of any kind
    'teacherUid', 'teacherId', 'teacherName', 'hasApplied', 'isSaved',
    'applicationCount', 'applicationId', 'resume', 'mobileNumber',
    // the school's private contact
    'contactEmail', 'contactMobile',
    // anything about money or gating
    'planId', 'planName', 'quota', 'entitlement', 'subscription',
    'viewCount', 'creditBalance',
    // internal integer identity
    '"jobId"', '"schoolId"', '"branchId"',
  ];

  /*
    🔒 THE INVERSE, AND THE STRONGER HALF: EVERY KEY THE PUBLIC MAY SEE.

    The list above names what must never appear, which only catches what
    somebody thought to forbid. This names what MAY appear, so a property added
    to any public DTO — or to a nested type, or by a repository projecting one
    more column — fails here until somebody decides it is public.

    ⚠️ When this check fails on a field that IS meant to be public, the fix is
    to add it here IN THE SAME COMMIT as the DTO change, with the reason. That
    is the point of the gate, not an obstacle to it.
  */
  const ALLOWED_KEYS = new Set([
    /* the envelope */
    'status', 'code', 'message', 'data', 'totalRecords', 'errors',

    /* the job, as a card and in full */
    'jobUid', 'jobTitle', 'jobDescription',
    'subjectId', 'subjectName', 'designationId', 'designationName',
    'qualificationId', 'qualificationName',
    'employmentTypeId', 'employmentTypeName', 'noOfVacancies',
    'minExperienceMonths', 'maxExperienceMonths',
    'salaryMin', 'salaryMax', 'isSalaryNegotiable',
    'cityId', 'cityName', 'stateId', 'stateName',
    'lastDateToApply', 'expectedJoiningDate', 'publishedOn',
    'classLevels', 'classLevelId', 'classLevelName',

    /*
      the school's PUBLIC face. 'website' here is the SCHOOL'S OWN site, which
      the brief allows as "the school's own public contact" — it is not the
      contact form's honeypot field of the same name, and the collision is
      worth knowing about when reading either.
    */
    'schoolUid', 'schoolName', 'schoolLogoPath', 'isSchoolVerified',
    'aboutSchool', 'website', 'establishedYear',
    'schoolTypeId', 'schoolTypeName', 'boardId', 'boardName',
    'branchName', 'branchCityName',

    /* the filters */
    'subjects', 'cities', 'states', 'id', 'name', 'jobCount',

    /* the FAQ and the content blocks */
    'faqId', 'category', 'question', 'answer', 'displayOrder',
    'blockKey', 'blockTitle', 'blockContent', 'imagePath',
  ]);

  /** Every key in the payload, at every depth. */
  const keysOf = (value, found = new Set()) => {
    if (Array.isArray(value)) {
      value.forEach((item) => keysOf(item, found));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        found.add(key);
        keysOf(nested, found);
      }
    }

    return found;
  };

  const endpoints = [
    ['jobs listing', `${APP}/public/jobs?search=${PROBE}`],
    ['job detail', `${APP}/public/jobs/${uids.live}`],
    ['filters', `${APP}/public/jobs/filters`],
    ['faqs', `${APP}/public/faqs`],
    ['content blocks', `${APP}/public/content-blocks`],
  ];

  for (const [label, url] of endpoints) {
    const r = await raw(url);
    const body = r.text;
    const hits = FORBIDDEN.filter((f) => body.toLowerCase().includes(f.toLowerCase()));

    console.log(`    ${label.padEnd(15)} HTTP ${r.http}  ${body.length} bytes  cache="${r.headers.get('cache-control')}"`);

    check(`🔒 ${label}: no forbidden field anywhere in the bytes`,
      r.http === 200 && hits.length === 0,
      hits.length ? `LEAKED: ${hits.join(', ')}` : `clean across ${body.length} bytes`);

    /*
      🔒 And nothing OUTSIDE the allowlist — the check that catches a field
      nobody thought to forbid.
    */
    let unexpected = [];

    try {
      unexpected = [...keysOf(JSON.parse(body))].filter((key) => !ALLOWED_KEYS.has(key));
    } catch {
      unexpected = ['<the body was not JSON>'];
    }

    check(`🔒 ${label}: every key is on the public allowlist`,
      unexpected.length === 0,
      unexpected.length ? `NOT ALLOWED: ${unexpected.join(', ')}` : 'no unknown key');
  }

  /*
    🔴 AND THE VALUES ARE POPULATED — WHICH THE CHECKS ABOVE DO NOT TEST.

    This was added because the two sweeps above both PASSED on a filters
    response of:

        {"subjects":[{"id":0,"name":"","jobCount":1}, ...]}

    Every key was allowed and nothing forbidden appeared, so the shape was
    perfect and the content was empty. The cause was that
    024_public_reads.sql on disk projected "AS Id, AS Name" while the
    DEPLOYED procedure still projected "AS SubjectName" from before an edit —
    the file was right and the database was stale, and the SQL-layer probe
    had run against the deployed version without the C# mapper in the loop.

    🔴 THE LESSON, WRITTEN WHERE IT BIT: a schema assertion is not a data
    assertion, and the file on disk is not the database. jobCount was correct
    throughout, which is what made it look fine.

    ⚠️ The job fixtures above guarantee subjects and states are non-empty here.
    Cities are legitimately empty (G40) and class levels only appear for jobs
    with bridge rows, so neither is asserted as populated — only that whatever
    IS returned is properly filled in.
  */
  const filterPayload = JSON.parse((await raw(`${APP}/public/jobs/filters`)).text);
  const filterGroups = Object.entries(filterPayload.data ?? {});

  const emptyValued = filterGroups.flatMap(([group, options]) =>
    (options ?? [])
      .filter((option) => !option.id || !option.name)
      .map((option) => `${group}: id=${option.id} name="${option.name}"`));

  filterGroups.forEach(([group, options]) =>
    console.log(`    ${group.padEnd(12)} ${(options ?? []).length} option(s)`));
  console.log('');

  check('premise: the fixtures made subjects and states reachable',
    (filterPayload.data?.subjects ?? []).length > 0
      && (filterPayload.data?.states ?? []).length > 0,
    `${(filterPayload.data?.subjects ?? []).length} subject(s), ${(filterPayload.data?.states ?? []).length} state(s)`);

  check('🔴 every filter option has a real id AND a real name, not just a count',
    emptyValued.length === 0,
    emptyValued.length ? `EMPTY: ${emptyValued.join(' · ')}` : 'ids and names populated');

  /* And the cache decision from 7A-0, asserted per class. */
  const detailCache = (await raw(`${APP}/public/jobs/${uids.live}`)).headers.get('cache-control');
  const faqCache = (await raw(`${APP}/public/faqs`)).headers.get('cache-control');

  check('🔴 the job detail is no-store — moderation must be immediate (2.81)',
    /no-store/.test(detailCache ?? ''), detailCache);

  check('⚠️ …and the FAQ is cacheable for five minutes — a different class',
    /max-age=300/.test(faqCache ?? ''), faqCache);

  // =========================================================================
  section('4. 🔒 NO TOKEN IS READ, EVEN IF ONE IS SENT');
  // =========================================================================

  const anon = await raw(`${APP}/public/jobs/${uids.live}`);

  const withToken = await raw(`${APP}/public/jobs/${uids.live}`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });

  console.log(`\n    anonymous : ${anon.text.length} bytes`);
  console.log(`    with token: ${withToken.text.length} bytes\n`);

  /*
    🔒 THE STRONGEST FORM OF "READS NO IDENTITY".

    The authentication middleware is global and WILL parse a valid token. What
    matters is that nothing on this path reads the result — and the proof is
    that the response does not change. A grep over the files could miss an
    accessor injected three layers down; identical bytes cannot.
  */
  check('🔒 the SAME request with a valid token returns byte-identical JSON',
    anon.http === withToken.http && anon.text === withToken.text,
    `${anon.text.length} === ${withToken.text.length} bytes, both HTTP ${anon.http}`);

  const asOwnerSearch = await raw(`${APP}/public/jobs?search=${PROBE}`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });

  check('🔒 …and the OWNER of these jobs sees no more than a stranger does',
    (asOwnerSearch.text.match(/PUBPROBE/g) ?? []).length === 2,
    'still 2 — the public listing has no owner-aware branch');

  // =========================================================================
  section('5. 🔴 THE HONEYPOT — 200, and no row');
  // =========================================================================

  const before = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_contact_enquiries;`));

  /*
    ⚠️ PRECONDITION: THE CONTACT BUDGET IS THREE PER HOUR (config: ContactPerIp),
    and this section spends all three. The limiter is in-memory and per process
    (2.35 records that), so a second run inside the hour needs a restarted App
    API — not a wait.

    This probe is a HEAD-shaped no-op that spends nothing: it reads the counter
    state by asking the SAME path with a body the validator rejects, so a 429
    here means the bucket is empty and a 400 means permits remain. Without it,
    an exhausted bucket reports "the honeypot is broken", which is a lie that
    costs twenty minutes.
  */
  const budgetProbe = await raw(`${APP}/public/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (budgetProbe.http === 429) {
    check('PRECONDITION: the contact budget has permits left', false,
      'the hour\'s 3 permits are spent — RESTART JP.App.Api and re-run (2.35: the window is per process)');
  }

  const botted = await raw(`${APP}/public/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Bot', email: 'pubprobe-bot@example.com', subject: 'Cheap watches',
      message: 'Buy now', website: 'http://spam.example',
    }),
  });

  const afterBot = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_contact_enquiries;`));

  console.log(`\n    honeypot filled: HTTP ${botted.http}  ${botted.text.slice(0, 80)}`);
  console.log(`    rows ${before} -> ${afterBot}\n`);

  /*
    🔴 TELL THE BOT NOTHING. A 400 "honeypot detected" teaches whoever wrote it
    to stop filling that field, and the trap stops working the next day.
  */
  check('🔴 a filled honeypot gets 200 — the bot is told nothing',
    botted.http === 200, `HTTP ${botted.http}`);

  check('🔴 …and NO ROW was written',
    afterBot === before, `${before} -> ${afterBot}`);

  check('🔒 …and the response is indistinguishable from a real success',
    /thank you/i.test(botted.text), 'same message a person gets');

  const real = await raw(`${APP}/public/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Real Person', email: 'pubprobe-real@example.com',
      subject: 'A question about listing', message: 'How do we list our school?',
    }),
  });

  const afterReal = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_contact_enquiries
     WHERE Email = 'pubprobe-real@example.com';`));

  check('…and a real enquiry IS written',
    real.http === 200 && afterReal === 1, `HTTP ${real.http}, ${afterReal} row`);

  /*
    🔴 AND THE THIRD SUBMISSION IS THE LIMIT ITSELF.

    The budget probe, the honeypot and the real enquiry are three — so this
    fourth one must be refused. That is the contact form's own rate limit under
    test, which the brief asks for and which nothing asserted until the limit
    broke a run of this very suite.
  */
  const fourth = await raw(`${APP}/public/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Too Many', email: 'pubprobe-flood@example.com',
      subject: 'Again', message: 'And again',
    }),
  });

  check('🔴 the contact form has its OWN tight limit — the 4th in an hour is 429',
    fourth.http === 429, `HTTP ${fourth.http} (3/hour per IP, separate from the read budget)`);

  check('🔴 …and the refused submission wrote nothing',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_contact_enquiries
       WHERE Email = 'pubprobe-flood@example.com';`) === '0',
    'no row from a refused submission');

  check('🔒 …with no caller identity recorded — there is none to record',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM sys.columns
       WHERE object_id = OBJECT_ID('t_app_contact_enquiries')
         AND name IN ('UserUid','UserId','OrganizationUid');`) === '0',
    'no identity column exists to fill');

  // =========================================================================
  section('6. 🔴 VIEWS — batched, off the read path, nothing orders by it');
  // =========================================================================

  /*
    🔴 THIS SECTION RUNS BEFORE THE RATE LIMIT, AND THE ORDER IS THE FIX.

    It ran AFTER on the first pass and passed for the wrong reason. The limiter
    keeps ONE budget across every public read (by design — see
    PublicRateLimiting.cs), so once the rate-limit section had spent it, these
    three detail reads came back 429 and recorded nothing at all. The counter
    still moved, by the views sections 1–4 had left sitting in the channel
    unflushed, and "≥ before + 3" accepted that as proof. Measured directly:
    with the budget spent, GET /api/public/jobs/{uid} returns 429, not 404.

    So: views first, and every read it counts asserts its own HTTP 200 — a
    refused read can never again be mistaken for a counted one.
  */

  /*
    ⚠️ DRAIN FIRST. The sections above have left views in the channel; waiting
    one interval flushes them so the baseline below is a settled number rather
    than a moving one. That buys an EXACT assertion instead of "at least".
  */
  await new Promise((resolve) => { setTimeout(resolve, 13_000); });

  const viewsBefore = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ViewCount AS varchar(10)) FROM t_app_jobs WHERE JobTitle = N'${PROBE} live';`));

  const counted = [];

  for (let i = 0; i < 3; i += 1) {
    counted.push((await raw(`${APP}/public/jobs/${uids.live}`)).http);
  }

  check('premise: the three reads being counted all returned 200',
    counted.every((http) => http === 200), `[${counted.join(', ')}]`);

  const immediately = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ViewCount AS varchar(10)) FROM t_app_jobs WHERE JobTitle = N'${PROBE} live';`));

  console.log(`\n    views settled at ${viewsBefore} · immediately after 3 reads ${immediately}`);

  /*
    🔴 THE READ PATH WROTE NOTHING. 2.81's whole decision: the uid goes on a
    channel and a background service flushes it. If this number had already
    moved, the counter would be a per-request UPDATE — which is the shape that
    makes every public read a write.
  */
  check('🔴 three reads changed the counter IMMEDIATELY by nothing — the read is pure',
    immediately === viewsBefore, `still ${immediately}`);

  await new Promise((resolve) => { setTimeout(resolve, 13_000); });

  const afterFlush = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ViewCount AS varchar(10)) FROM t_app_jobs WHERE JobTitle = N'${PROBE} live';`));

  console.log(`    after one flush interval ${afterFlush}\n`);

  /* EXACTLY three. "At least" is what hid the refused reads the first time. */
  check('🔴 …and after one flush interval EXACTLY those three landed, in one batch',
    afterFlush === viewsBefore + 3, `${viewsBefore} -> ${afterFlush}`);

  check('🔒 …and NO procedure filters or orders by ViewCount — 2.81 drew this boundary',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM sys.sql_modules
       WHERE definition LIKE '%ORDER BY%ViewCount%' OR definition LIKE '%ViewCount DESC%';`) === '0',
    'nothing branches on it — the acceptance holds');

  // =========================================================================
  section('7. 🔴 THE ANONYMOUS RATE LIMIT — last, because it spends the budget');
  // =========================================================================

  /*
    ⚠️ LAST ON PURPOSE. This section exhausts the per-IP read budget, and the
    budget is shared across every public read — so anything placed after it
    gets 429s instead of answers. That is what broke the views section above.

    The configured limit is 60 reads per minute per IP and earlier sections have
    already spent part of this minute's budget, so the loop asserts that a 429
    ARRIVES rather than exactly where — the alternative is an assertion that
    depends on how many reads the sections above happened to make.
  */
  let limited = null;
  let sent = 0;

  for (let i = 0; i < 90 && limited === null; i += 1) {
    const r = await raw(`${APP}/public/jobs?pageSize=1&p=${i}`);
    sent += 1;

    if (r.http === 429) limited = r;
  }

  console.log(`\n    after ${sent} request(s): HTTP ${limited?.http ?? 'never limited'}`);
  console.log(`    body : ${limited?.text?.slice(0, 110) ?? '(none)'}`);
  console.log(`    retry-after: ${limited?.headers?.get('retry-after') ?? '(none)'}`);

  check('🔴 the public search is rate limited — a 429 arrives',
    limited !== null, `after ${sent} request(s)`);

  check('…and it carries Retry-After, so a client can behave',
    (limited?.headers?.get('retry-after') ?? '') !== '', limited?.headers?.get('retry-after'));

  /*
    🔒 THE BODY LEAKS NOTHING: not which limit, not how many remain, not
    whether the path exists.
  */
  check('🔒 …and the 429 body names no limit, no count and no endpoint',
    limited !== null
      && !/\b60\b|per minute|remaining|quota|public\/jobs|search/i.test(limited.text),
    (limited?.text ?? '').slice(0, 70));

  check('🔴 …and the refusal is the ENVELOPE, not a framework page',
    /"code":"RATE_LIMITED"/.test(limited?.text ?? ''), 'RATE_LIMITED in the envelope');

  /*
    🔴 AND THE BUDGET IS SHARED — the fact that bit the views section, now an
    assertion rather than a lesson. The DETAIL endpoint is 429 too, although
    every request above went to the LISTING.
  */
  const detailUnderLimit = await raw(`${APP}/public/jobs/${uids.live}`);

  check('🔴 …and ONE budget covers every public read — the detail is 429 too',
    detailUnderLimit.http === 429,
    `HTTP ${detailUnderLimit.http} on a path never requested in the loop`);

} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  section('8. EXIT — fixtures gone, shipped state restored');

  try {
    cleanup();

    /*
      🔴 GIVE THE READ BUDGET BACK. THIS IS SHIPPED STATE TOO.

      Section 7 deliberately exhausts the per-IP read budget to prove the limit
      fires, and that bucket is SHARED with everything else on this machine —
      including the public website's own server-side rendering.

      It cost a full regression to learn: public-screens ran next, inside the
      same 60-second window, and its server-rendered /jobs page came back 429.
      The suite reported "the job listing is not server-rendered", which was
      false and pointed at the wrong file entirely.

      ⚠️ Polls for a 200 rather than sleeping a flat 60s, because most of the
      window has usually already passed by the time the EXIT section runs.
    */
    const budgetDeadline = Date.now() + 75_000;
    let waited = 0;

    for (;;) {
      const probe = await fetch(`${APP}/public/faqs`);

      if (probe.status !== 429 || Date.now() > budgetDeadline) {
        check('exit: the per-IP read budget is spendable again',
          probe.status !== 429,
          probe.status === 429
            ? 'STILL LIMITED after 75s — the next suite will see 429s'
            : `HTTP ${probe.status} after waiting ${waited}s`);

        break;
      }

      await new Promise((resolve) => { setTimeout(resolve, 5_000); });
      waited += 5;
    }

    check('exit: no probe job is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';`) === '0',
      'none');

    check('exit: no probe enquiry is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_contact_enquiries
         WHERE Email LIKE 'pubprobe%';`) === '0',
      'none');
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
