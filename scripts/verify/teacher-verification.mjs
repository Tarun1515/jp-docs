/*
  PHASE 6C-2-0 — TEACHER VERIFICATION, END TO END.          (G37)

  ----------------------------------------------------------------------------
    0. ENTRY        the two notification types have their consumer, and the
                    teacher this run verifies is not verified yet.
    1. 🔴 THE QUEUE the teacher submits, the request appears in the ADMIN's
                    queue, and the admin approves it there. No procedure is
                    called directly anywhere in this file.
    2. 🔴 THE BADGE all three columns move together — the claim that could not
                    honestly be a build guard (031).
    3. 🔴 THE SEARCH the badge appears in a real /teacher-search result, and
                    the teacher now shows up under verifiedOnly.
    4. 🔒 THE WORD  the teacher is told, and the admin's private remarks are
                    not in what they are told.
    5. 🔴 IDEMPOTENT a retried orchestration does not stamp twice or notify
                    twice.
    6. 🔴 THE DECLINE a rejection notifies and does NOT revoke a badge.
    7. 🔒 NEGATIVES a teacher cannot action their own request; an EntityUid
                    that is not a teacher fails honestly rather than silently.
    8. EXIT         badge restored, requests gone, notifications gone.

  ----------------------------------------------------------------------------
  🔴 WHY THIS FILE EXISTS
  ----------------------------------------------------------------------------
  ApprovalOrchestrationService.RunTeacherVerification was a stub for four
  phases. It returned a FAILED outcome saying "setting IsVerified requires
  t_app_teachers, which is Phase 3" — and Phase 3 had shipped. An admin could
  approve a teacher through the queue, the approval trail was written, and the
  badge never appeared. Nothing errored, because that branch was already written
  to report a failure.

  🔴 It survived because no test ever walked the badge's path. Every teacher
  with a badge in this database is a seed row, so every assertion about the
  badge passed against data nobody earned. That is the mockup-era failure this
  project writes tests to avoid, and 6C-2's screens would have shipped it on
  three screens at once.

  ⚠️ So this file is deliberately shaped as "do it the way a person does it":
  submit over HTTP as the teacher, list the queue as the admin, approve through
  the action endpoint, then go and look at a search result.

  ⚠️ FIXTURES: the teacher it verifies is RESTORED to unverified on exit, with
  the stamps cleared, because teacher-search.mjs counts verified teachers. The
  approval requests it creates are removed too — the one-pending-per-entity
  index would block the next run otherwise.

  ⚠️ AND IT ARRANGES THE ONE THING IT USED TO INHERIT. Section 3 asked for page
  one of a search ordered by profile completion, so whether the probe teacher
  was on that page depended on every other teacher's percentage — which made
  this suite intermittently red for reasons that had nothing to do with
  verification. It now gives the probe a subject (if they have none) and
  filters the search to it, then takes the subject away again. See
  arrangeProbeSubject, which also records why the old failure message blamed
  the wrong thing.

  Run (both APIs up): node scripts/verify/teacher-verification.mjs
*/
import { execFileSync } from 'node:child_process';
import { token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';
import { arrangeUngated, restoreCatalogue } from './lib/catalogue.mjs';

const APP = 'http://localhost:5299/api';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const ADMIN = { id: 'superadmin@teacherportal.local', pw: secret('superadmin@teacherportal.local') };
const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };

/*
  The probe. A mostly-complete seeded profile, which is why it is the one that
  gets verified here.

  ⚠️ THIS COMMENT USED TO READ '90% profile with a subject, so a search can
  actually find them' — an assumption about seed data, stated as a fact, in the
  place somebody would look first. The suite no longer assumes it either way:
  arrangeProbeSubject gives the teacher a subject if they have none and says in
  its own output which of the two it found.
*/
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

/** The decline path, on somebody else, so the two outcomes cannot interfere. */
const TEACHER_2 = { id: 'imran.qureshi.86007@yopmail.com', pw: secret('imran.qureshi.86007@yopmail.com') };

/*
  🔴 THE ENGINE IS UNGATED FOR THIS SUITE, AND THIS IS NOT A CHEAT.

  This suite proves a verified teacher carries a badge INTO A REAL SEARCH
  RESULT — which means it has to run a teacher search. SR-4 made
  TEACHER_SEARCH a BOOLEAN feature that SCHOOL_FREE does not include, and
  Greenwood, the school doing the searching here, is on SCHOOL_FREE.

  So the search returned nothing and three assertions failed:

      premise: the teacher is findable at all (MISSING from a search …)
      the badge appears in a REAL search result (isVerified undefined)
      …and they now pass the verifiedOnly filter (0 verified teacher(s))

  ⚠️ NOTHING WAS BROKEN — the entitlement engine was working exactly as
  designed, and the suite was reading a refusal as an absence. This is the
  lesson SR-4 produced twice over, written down in lib/catalogue.mjs:
  *a test that depends on a shipped DEFAULT breaks when the default becomes a
  decision.* Before SR-4 every feature was FREE and this suite got its search
  for nothing; now it asks.

  ⚠️ IT IS NOT "TURN OFF THE FEATURE WE BUILT". Gating is covered by the
  suites whose subject it is — billing, billing-screens, entitlement-http,
  entitlement-engine, jobs-consume, screens-25 — which arrange metered state
  themselves and assert it. This suite is about verification badges.

  Paired with restoreCatalogue() in the finally, which every suite doing this
  already calls.
*/
arrangeUngated();

const ACTION_APPROVE = 1;
const ACTION_REJECT = 2;
const REQUEST_TYPE_TEACHER_VERIFICATION = 2;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body, text };
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const teacherRow = (email) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(t.TeacherId AS varchar(10)) + '|' + LOWER(CAST(t.TeacherUid AS varchar(40))) + '|'
       + CAST(t.IsVerified AS varchar(2)) + '|'
       + ISNULL(CONVERT(varchar(19), t.VerifiedOn, 120), '-') + '|'
       + ISNULL(CAST(t.VerifiedByUserId AS varchar(12)), '-')
  FROM t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${email}';`)[0].split('|');

const notifCount = (email, code) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(COUNT(*) AS varchar(8))
  FROM t_app_notifications n
    INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = n.RecipientUserUid
  WHERE u.Email = '${email}' AND nt.Code = '${code}' AND n.Is_Deleted = 0;`);

const notifBody = (email, code) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT TOP 1 n.Title + ' | ' + ISNULL(n.Body, '-')
  FROM t_app_notifications n
    INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = n.RecipientUserUid
  WHERE u.Email = '${email}' AND nt.Code = '${code}' AND n.Is_Deleted = 0
  ORDER BY n.NotificationId DESC;`);

/** The admin's own bigint UserId, which is what VerifiedByUserId records. */
const userIdOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(UserId AS varchar(20)) FROM jp_sso.dbo.t_sso_users WHERE Email = '${email}';`);

const REMARKS = 'notif-suite PRIVATE ADMIN NOTE do not show the teacher';

/**
 * ⚠️ The teacher payload's required field. 001's validation is type-aware —
 * type 2 needs a name, types 1 and 3 need a school name — and sending only the
 * uid earns a correct 400 saying so.
 */
const nameOf = (email) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT t.FullName FROM t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
  WHERE u.Email = '${email}';`);

/**
 * ⚠️ Narrow: only the requests this run submits (identified by their entity)
 * and the notifications they produced. A broad delete would hide a leak that
 * section 8 is supposed to notice.
 */
const cleanup = (uids) => {
  const list = uids.filter(Boolean).map((u) => `'${u}'`).join(', ');
  if (!list) return;

  /*
    ⚠️ ORDER MATTERS, AND IT COST A RUN TO FIND OUT. A type-2 submit also
    writes t_mdm_teacher_registration_details (the payload the validation
    demands), and that table FKs the request. Deleting the request first dies
    on Msg 547 — the same shape as 6B's invitation-to-job FK.
  */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    DECLARE @ours TABLE (RequestId bigint PRIMARY KEY);

    INSERT INTO @ours (RequestId)
    SELECT RequestId FROM t_mdm_approval_requests
     WHERE RequestTypeId = ${REQUEST_TYPE_TEACHER_VERIFICATION}
       AND EntityUid IN (${list});

    DELETE FROM t_mdm_teacher_registration_details WHERE RequestId IN (SELECT RequestId FROM @ours);
    DELETE FROM t_mdm_request_approvals           WHERE RequestId IN (SELECT RequestId FROM @ours);
    DELETE FROM t_mdm_approval_requests           WHERE RequestId IN (SELECT RequestId FROM @ours);`);

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_notifications
     WHERE NotificationTypeId IN (13, 14)
       AND RecipientUserUid IN (SELECT t.UserUid FROM t_app_teachers t
                                 WHERE LOWER(CAST(t.TeacherUid AS varchar(40))) IN (${list.toLowerCase()}));`);
};

/** Put the badge back exactly as it was found. */
const restoreBadge = (teacherId, found) => sql(`SET NOCOUNT ON; USE jp_app;
  UPDATE t_app_teachers
     SET IsVerified = ${found.isVerified},
         VerifiedOn = ${found.verifiedOn === '-' ? 'NULL' : `'${found.verifiedOn}'`},
         VerifiedByUserId = ${found.verifiedBy === '-' ? 'NULL' : found.verifiedBy}
   WHERE TeacherId = ${teacherId};`);

const subjectCount = (teacherId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_subjects
   WHERE TeacherId = ${teacherId} AND Is_Deleted = 0;`);

/**
 * Give the probe teacher one subject to be found by, if they have none.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHAT WAS ACTUALLY WRONG, BECAUSE THE OLD MESSAGE SAID OTHERWISE
 * ----------------------------------------------------------------------------
 * Section 3's premise — 'the teacher is findable at all' — was intermittent:
 * green in one regression, red in the next, with nothing about verification
 * having changed. Its own failure text blamed a teacher with no subject being
 * invisible to search.
 *
 * ⚠️ THAT EXPLANATION IS WRONG ABOUT THE PROCEDURE, and it is written down
 * here because it would send the next reader to the wrong file.
 * USP_SearchTeachers touches t_app_teacher_subjects ONLY inside
 * `@SubjectId IS NULL OR EXISTS (…)` — with no subject filter, a teacher with
 * no subjects is in the results like anybody else.
 *
 * 🔴 THE REAL CAUSE IS PAGING. The call asked for page one with pageSize=100,
 * and the procedure orders by `ProfileCompletionPercent DESC, TeacherId`. So
 * which teachers are on page one depends on EVERY OTHER TEACHER's completion
 * percentage — and the suites that move those decide whether this assertion
 * passes. One of them gave this very teacher a photo and ten more points.
 *
 * ⚠️ SO THE SUITE ARRANGES WHAT IT NEEDS instead of hoping for a seeded
 * default: the teacher gets a subject, and section 3 filters the search to it.
 * The result set becomes the teachers who teach that one subject, the probe is
 * on page one whatever the rest of the platform looks like, and the assertion
 * is about the badge again.
 *
 * ⚠️ A DIRECT INSERT, NOT USP_SaveTeacherSubjects — deliberately. The save
 * procedure RECALCULATES ProfileCompletionPercent, which is shared state
 * screens-3h reads, and a fixture is not a reason to move a seeded teacher's
 * completion. The row is removed again in the `finally`.
 *
 * @returns {{subjectId:string, added:boolean, countBefore:string}}
 */
const arrangeProbeSubject = (teacherId) => {
  const row = scalar(`SET NOCOUNT ON; USE jp_app;
    DECLARE @tid bigint = ${teacherId};
    DECLARE @before int = (SELECT COUNT(*) FROM t_app_teacher_subjects
                            WHERE TeacherId = @tid AND Is_Deleted = 0);
    DECLARE @sid int = (SELECT TOP (1) SubjectId FROM t_app_teacher_subjects
                         WHERE TeacherId = @tid AND Is_Deleted = 0 ORDER BY SubjectId);
    DECLARE @added bit = 0;

    IF @sid IS NULL
    BEGIN
        SET @sid = (SELECT TOP (1) SubjectId FROM jp_mdm.dbo.m_mdm_subject
                     WHERE Is_Active = 1 AND Is_Deleted = 0
                     ORDER BY DisplayOrder, SubjectId);

        /*
          ⚠️ GUARDED. With no subject master seeded at all, an unguarded INSERT
          would die on a NOT NULL column and take the whole suite down with a
          Msg 515 — when the honest answer is the premise assertion below
          failing with 'subject 0' and naming the missing seed.
        */
        IF @sid IS NOT NULL
        BEGIN
            INSERT INTO t_app_teacher_subjects (TeacherId, SubjectId) VALUES (@tid, @sid);

            SET @added = 1;
        END
    END

    SELECT CAST(ISNULL(@sid, 0) AS varchar(10)) + '|' + CAST(@added AS varchar(2))
         + '|' + CAST(@before AS varchar(6));`);

  const [subjectId, added, countBefore] = row.split('|');

  return { subjectId, added: added === '1', countBefore };
};

let found1 = null;
let found2 = null;
let teacher1Id = null;
let teacher2Id = null;
let uid1 = null;
let uid2 = null;

/** What arrangeProbeSubject did, so the `finally` can undo exactly that. */
let probeSubject = null;

try {
  // =========================================================================
  section('0. ENTRY — the two types have a consumer, and nobody is verified yet');
  // =========================================================================

  const types = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT Code + ':aud' + CAST(AudienceId AS varchar(2)) + ':email' + CAST(SendEmail AS varchar(2))
    FROM m_app_notification_type WHERE NotificationTypeId IN (13, 14) ORDER BY NotificationTypeId;`);

  console.log(`\n    ${types.join('  ')}\n`);

  /*
    🔴 6C-1 refused to seed these two, because nothing created them and a type
    with no consumer is the G32 shape. They arrive here WITH their consumer, and
    029's build guard names USP_SetTeacherVerified for both — so this assertion
    and that guard have to agree.
  */
  check('🔴 VERIFICATION_APPROVED and VERIFICATION_REJECTED are seeded now',
    types.length === 2
    && types[0].startsWith('VERIFICATION_APPROVED:aud1:email1')
    && types[1].startsWith('VERIFICATION_REJECTED:aud1:email1'),
    types.join(' · '));

  const adminToken = await loginToken(ADMIN);
  const ownerToken = await loginToken(OWNER);
  const teacherToken = await loginToken(TEACHER);
  const teacher2Token = await loginToken(TEACHER_2);

  const adminUserId = userIdOf(ADMIN.id);

  const [t1Id, t1Uid, t1Ver, t1On, t1By] = teacherRow(TEACHER.id);
  const [t2Id, t2Uid, t2Ver, t2On, t2By] = teacherRow(TEACHER_2.id);

  teacher1Id = t1Id;
  teacher2Id = t2Id;
  uid1 = t1Uid;
  uid2 = t2Uid;
  found1 = { isVerified: t1Ver, verifiedOn: t1On, verifiedBy: t1By };
  found2 = { isVerified: t2Ver, verifiedOn: t2On, verifiedBy: t2By };

  console.log(`    teacher ${t1Id} (${TEACHER.id}) verified=${t1Ver} on=${t1On} by=${t1By}`);
  console.log(`    admin UserId ${adminUserId}\n`);

  /* A killed previous run would leave a request and block the index. */
  cleanup([uid1, uid2]);

  check('premise: the teacher this run verifies is NOT verified', t1Ver === '0', `IsVerified ${t1Ver}`);

  check('premise: no teacher-verification request for either of them survives a previous run',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_mdm_approval_requests
       WHERE RequestTypeId = ${REQUEST_TYPE_TEACHER_VERIFICATION}
         AND LOWER(CAST(EntityUid AS varchar(40))) IN ('${uid1}', '${uid2}');`) === '0',
    'clean');

  /*
    🔴 THE ONE THING SECTION 3 USED TO INHERIT INSTEAD OF ARRANGING. See
    arrangeProbeSubject's header: the search is filtered to this subject, which
    is what makes 'the teacher is findable' a fact about the badge rather than
    about everybody else's profile completion.
  */
  probeSubject = arrangeProbeSubject(teacher1Id);

  check('premise: the probe teacher has a subject for section 3 to search on',
    Number(probeSubject.subjectId) > 0,
    `subject ${probeSubject.subjectId}, ${probeSubject.added ? 'ADDED by this run' : 'already theirs'}`
    + ` (had ${probeSubject.countBefore})`);

  // =========================================================================
  section('1. 🔴 THE REAL QUEUE — submitted by the teacher, approved by the admin');
  // =========================================================================

  const submitted = await j(`${APP}/approvals/submit`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ requestTypeId: REQUEST_TYPE_TEACHER_VERIFICATION, entityUid: uid1, fullName: nameOf(TEACHER.id) }),
  });

  const requestId = submitted.body?.data?.requestId ?? submitted.body?.data?.id;

  console.log(`\n    submit: HTTP ${submitted.http} request ${requestId} ${submitted.body?.data?.requestNo ?? ''}\n`);

  check('🔴 the teacher submits a verification request over HTTP',
    submitted.http === 200 && !!requestId, `HTTP ${submitted.http}`);

  /*
    🔴 THE QUEUE, NOT THE TABLE. The whole point of G37 is that the badge's path
    was never walked, so this reads the admin's own list endpoint — the thing
    the verification screen calls — rather than confirming a row exists.
  */
  const queue = await j(`${APP}/approvals?requestTypeId=${REQUEST_TYPE_TEACHER_VERIFICATION}&statusId=1&pageSize=50`,
    { headers: H(adminToken) });

  const mine = (queue.body?.data ?? []).find((r) => r.requestId === requestId);

  check('🔴 …and it appears in the ADMIN\'s queue, which is where it gets actioned',
    queue.http === 200 && !!mine,
    `${(queue.body?.data ?? []).length} pending teacher verification(s), ours ${mine ? 'present' : 'MISSING'}`);

  check('…carrying the teacher\'s own uid as the thing being approved (025)',
    (mine?.entityUid ?? '').toLowerCase() === uid1, `${mine?.entityUid}`);

  const detail = await j(`${APP}/approvals/${requestId}`, { headers: H(adminToken) });
  const rowVersion = detail.body?.data?.header?.rowVersion ?? mine?.rowVersion ?? 1;

  const approved = await j(`${APP}/approvals/${requestId}/action`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ actionTypeId: ACTION_APPROVE, rowVersion, remarks: REMARKS }),
  });

  console.log(`    approve: HTTP ${approved.http} · orchestrationCompleted `
    + `${approved.body?.data?.orchestrationCompleted} · ${approved.body?.data?.orchestrationError ?? 'no error'}\n`);

  check('🔴 the admin approves it through the action endpoint', approved.http === 200, `HTTP ${approved.http}`);

  /*
    🔴 THE ASSERTION G37 IS ABOUT.

    Before this change the orchestration reported FALSE here, with the message
    "setting IsVerified requires t_app_teachers, which is Phase 3" — and because
    that branch was written to report a failure, nobody read it as a bug.
  */
  check('🔴 …and the orchestration reports COMPLETED — this is what G37 broke',
    approved.body?.data?.orchestrationCompleted === true,
    `orchestrationCompleted ${approved.body?.data?.orchestrationCompleted}`
    + `${approved.body?.data?.orchestrationError ? ` · ${approved.body.data.orchestrationError}` : ''}`);

  // =========================================================================
  section('2. 🔴 THE BADGE — all three columns, together');
  // =========================================================================

  const [, , afterVer, afterOn, afterBy] = teacherRow(TEACHER.id);

  console.log(`\n    verified=${afterVer} on=${afterOn} by=${afterBy} (admin is ${adminUserId})\n`);

  check('🔴 the badge is ON — a real teacher earned it through the product',
    afterVer === '1', `IsVerified ${afterVer}`);

  /*
    🔴 THE CLAIM THAT COULD NOT HONESTLY BE A BUILD GUARD.

    031 tried to assert "verified implies a verifier" at build time and failed on
    four seeded rows that have a date and no verifier. Backfilling them would
    have invented an approval; a date-scoped guard would be a date check. So the
    invariant is asserted HERE, against a teacher this product actually
    verified — where it is simply true.
  */
  check('🔴 …and VerifiedOn and VerifiedByUserId moved WITH it (031)',
    afterOn !== '-' && afterBy === adminUserId,
    `on ${afterOn}, by ${afterBy}`);

  check('…and the verifier is the admin who clicked, not the teacher who asked',
    afterBy !== userIdOf(TEACHER.id), `${afterBy} ≠ teacher's ${userIdOf(TEACHER.id)}`);

  // =========================================================================
  section('3. 🔴 THE SEARCH RESULT — the badge where the screens read it');
  // =========================================================================

  /*
    🔴 FILTERED TO THE SUBJECT THIS RUN ARRANGED, AND THAT IS THE FIX FOR AN
    INTERMITTENT FAILURE — see arrangeProbeSubject's header.

    The unfiltered call asked for page one of a list ordered by
    ProfileCompletionPercent DESC: whether the probe was on it depended on every
    other teacher's completion, so this assertion passed or failed according to
    what some other suite had done to somebody else's profile. With the filter
    the result set is the teachers who teach this one subject, and the probe is
    on the page whatever the rest of the platform looks like.

    ⚠️ IT IS A NARROWER QUERY, NOT A WEAKER ASSERTION. The row must still be
    present AND carry the badge, which is the only thing this section claims.
  */
  const searchQuery = `subjectId=${probeSubject.subjectId}&pageSize=100`;

  const search = await j(`${APP}/teacher-search?${searchQuery}`, { headers: H(ownerToken) });
  const row = (search.body?.data ?? []).find((r) => (r.teacherUid ?? '').toLowerCase() === uid1);

  console.log(`\n    /teacher-search?${searchQuery} returned ${(search.body?.data ?? []).length} teacher(s); `
    + `ours ${row ? `isVerified=${row.isVerified}` : 'NOT IN THE RESULTS'}\n`);

  check('premise: the teacher is findable at all', search.http === 200 && !!row,
    row ? 'present in the results' : `MISSING from a search filtered to subject ${probeSubject.subjectId}`);

  /*
    🔴 THE REASON 6C-2 COULD NOT START WITHOUT THIS.

    Search results, applicant detail and the invitation screens all render this
    flag. With no way to earn it, every badge on every one of those screens
    would have been seed data — a mockup wearing real data's clothes.
  */
  check('🔴 the badge appears in a REAL search result, which is where the screens read it',
    row?.isVerified === true, `isVerified ${row?.isVerified}`);

  /* Same narrowing, same reason: page one of the verified list is not ours to assume either. */
  const verifiedOnly = await j(`${APP}/teacher-search?verifiedOnly=true&${searchQuery}`,
    { headers: H(ownerToken) });
  const inFiltered = (verifiedOnly.body?.data ?? []).some((r) => (r.teacherUid ?? '').toLowerCase() === uid1);

  check('🔴 …and they now pass the verifiedOnly filter they used to fail',
    inFiltered, `${(verifiedOnly.body?.data ?? []).length} verified teacher(s), ours included`);

  // =========================================================================
  section('4. 🔒 THE WORD — told, without the admin\'s note');
  // =========================================================================

  console.log(`\n    "${notifBody(TEACHER.id, 'VERIFICATION_APPROVED')}"\n`);

  check('🔴 VERIFICATION_APPROVED reached the teacher',
    notifCount(TEACHER.id, 'VERIFICATION_APPROVED') === '1',
    `${notifCount(TEACHER.id, 'VERIFICATION_APPROVED')} notification(s)`);

  /*
    🔒 The body comes from the TYPE's Description (029), not from anything the
    admin typed — so there is no parameter through which a private note could
    reach the person it is about. Same rule as the rejection's Remarks and the
    offer's TeacherRemarks (021).
  */
  check('🔒 …and the admin\'s private remarks are NOT in it',
    !/PRIVATE ADMIN NOTE/i.test(notifBody(TEACHER.id, 'VERIFICATION_APPROVED')),
    'the body is the type\'s own text');

  check('…and the remarks ARE on the approval trail, where they belong',
    sql(`SET NOCOUNT ON; USE jp_mdm;
      SELECT ISNULL(Remarks, '-') FROM t_mdm_request_approvals
       WHERE RequestId = ${requestId} ORDER BY ApprovalId DESC;`).some((r) => /PRIVATE ADMIN NOTE/.test(r)),
    'the trail kept them');

  // =========================================================================
  section('5. 🔴 IDEMPOTENT — a retried orchestration changes nothing twice');
  // =========================================================================

  const stampBefore = teacherRow(TEACHER.id)[3];

  const retried = await j(`${APP}/approvals/${requestId}/retry-orchestration`, {
    method: 'POST', headers: H(adminToken),
  });

  const stampAfter = teacherRow(TEACHER.id)[3];

  console.log(`\n    retry: HTTP ${retried.http} · stamp ${stampBefore} -> ${stampAfter}\n`);

  check('🔴 retrying the orchestration does not re-stamp the badge',
    stampBefore === stampAfter, `${stampBefore} === ${stampAfter}`);

  check('🔴 …and does not tell the teacher twice about one event',
    notifCount(TEACHER.id, 'VERIFICATION_APPROVED') === '1',
    `still ${notifCount(TEACHER.id, 'VERIFICATION_APPROVED')} notification(s)`);

  // =========================================================================
  section('6. 🔴 THE DECLINE — notified, and nothing revoked');
  // =========================================================================

  const submitted2 = await j(`${APP}/approvals/submit`, {
    method: 'POST', headers: H(teacher2Token),
    body: JSON.stringify({ requestTypeId: REQUEST_TYPE_TEACHER_VERIFICATION, entityUid: uid2, fullName: nameOf(TEACHER_2.id) }),
  });

  const requestId2 = submitted2.body?.data?.requestId ?? submitted2.body?.data?.id;

  check('premise: a second teacher submitted', submitted2.http === 200 && !!requestId2, `HTTP ${submitted2.http}`);

  const detail2 = await j(`${APP}/approvals/${requestId2}`, { headers: H(adminToken) });
  const rv2 = detail2.body?.data?.header?.rowVersion ?? 1;

  const rejected = await j(`${APP}/approvals/${requestId2}/action`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ actionTypeId: ACTION_REJECT, rowVersion: rv2, remarks: REMARKS, rejectionReasonId: 1 }),
  });

  console.log(`\n    reject: HTTP ${rejected.http} · ${rejected.body?.message ?? ''}\n`);

  check('the admin rejects it', rejected.http === 200, `HTTP ${rejected.http}`);

  /*
    🔴 A DECLINED VERIFICATION STILL HAS TO BE SAID, and it never reaches the
    orchestration service — that is gated on approval, deliberately, since the
    Phase 2E bug where rejecting a school created it anyway. So the notification
    is raised in ApprovalService on the rejection branch.
  */
  check('🔴 VERIFICATION_REJECTED reached the teacher, even though orchestration never ran',
    notifCount(TEACHER_2.id, 'VERIFICATION_REJECTED') === '1',
    `${notifCount(TEACHER_2.id, 'VERIFICATION_REJECTED')} notification(s)`);

  check('🔒 …and the admin\'s note is not in that one either',
    !/PRIVATE ADMIN NOTE/i.test(notifBody(TEACHER_2.id, 'VERIFICATION_REJECTED')),
    `"${notifBody(TEACHER_2.id, 'VERIFICATION_REJECTED')}"`);

  check('🔴 …and the decline did NOT set a badge',
    teacherRow(TEACHER_2.id)[2] === '0', `IsVerified ${teacherRow(TEACHER_2.id)[2]}`);

  /*
    🔴 AND A DECLINE DOES NOT REVOKE ONE EITHER (022's header).

    The already-verified teacher from section 2 is untouched by somebody else's
    rejection — which also covers the shape of the bug where @Approved doubles
    as the value to store.
  */
  check('🔴 …and revoked nobody else\'s',
    teacherRow(TEACHER.id)[2] === '1', `the verified teacher is still verified`);

  // =========================================================================
  section('7. 🔒 NEGATIVES — who may not do this, and what fails honestly');
  // =========================================================================

  const submitted3 = await j(`${APP}/approvals/submit`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ requestTypeId: REQUEST_TYPE_TEACHER_VERIFICATION, entityUid: uid1, fullName: nameOf(TEACHER.id) }),
  });

  const requestId3 = submitted3.body?.data?.requestId ?? submitted3.body?.data?.id;

  const selfAction = await j(`${APP}/approvals/${requestId3 ?? requestId}/action`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ actionTypeId: ACTION_APPROVE, rowVersion: 1 }),
  });

  check('🔒 a teacher cannot action their own verification request',
    selfAction.http === 403 || selfAction.http === 404,
    `HTTP ${selfAction.http} · ${selfAction.body?.code ?? ''}`);

  const ownerAction = await j(`${APP}/approvals/${requestId3 ?? requestId}/action`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ actionTypeId: ACTION_APPROVE, rowVersion: 1 }),
  });

  check('🔒 …and neither can a school owner — VERIFICATION.TEACHER is an admin permission',
    ownerAction.http === 403 || ownerAction.http === 404,
    `HTTP ${ownerAction.http} · ${ownerAction.body?.code ?? ''}`);

  /*
    🔴 AN EntityUid THAT IS NOT A TEACHER MUST FAIL OUT LOUD.

    There is already one such row in this database — a teacher verification
    request whose EntityUid matches no teacher and no user. The stub's whole
    problem was reporting a failure nobody read, so the replacement has to
    report THIS failure in a way a screen can show.
  */
  const orphanUid = '00000000-0000-0000-0000-00000000dead';

  const orphanSubmit = await j(`${APP}/approvals/submit`, {
    method: 'POST', headers: H(teacher2Token),
    body: JSON.stringify({ requestTypeId: REQUEST_TYPE_TEACHER_VERIFICATION, entityUid: orphanUid,
      fullName: 'Nobody At All' }),
  });

  const orphanId = orphanSubmit.body?.data?.requestId ?? orphanSubmit.body?.data?.id;

  if (orphanId) {
    const orphanDetail = await j(`${APP}/approvals/${orphanId}`, { headers: H(adminToken) });
    const orv = orphanDetail.body?.data?.header?.rowVersion ?? 1;

    const orphanApprove = await j(`${APP}/approvals/${orphanId}/action`, {
      method: 'POST', headers: H(adminToken),
      body: JSON.stringify({ actionTypeId: ACTION_APPROVE, rowVersion: orv }),
    });

    console.log(`\n    orphan approve: HTTP ${orphanApprove.http} · completed `
      + `${orphanApprove.body?.data?.orchestrationCompleted} · "${orphanApprove.body?.data?.orchestrationError ?? ''}"\n`);

    check('🔴 approving a request whose EntityUid is no teacher reports orchestration FAILED',
      orphanApprove.http === 200 && orphanApprove.body?.data?.orchestrationCompleted === false,
      `completed ${orphanApprove.body?.data?.orchestrationCompleted}`);

    check('…and says so in words a screen can show, naming the profile rather than a table',
      /profile/i.test(orphanApprove.body?.data?.orchestrationError ?? ''),
      `"${orphanApprove.body?.data?.orchestrationError ?? ''}"`);

    sql(`SET NOCOUNT ON; USE jp_mdm;
      DELETE FROM t_mdm_teacher_registration_details WHERE RequestId = ${orphanId};
      DELETE FROM t_mdm_request_approvals           WHERE RequestId = ${orphanId};
      DELETE FROM t_mdm_approval_requests           WHERE RequestId = ${orphanId};`);
  } else {
    check('🔴 approving a request whose EntityUid is no teacher reports orchestration FAILED',
      false, `could not submit the orphan request: HTTP ${orphanSubmit.http} ${orphanSubmit.body?.message ?? ''}`);
  }
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  // =========================================================================
  section('8. EXIT — the badge put back, the requests removed');
  // =========================================================================

  /*
    🔴 THE ARRANGED SUBJECT GOES BACK FIRST, AND IN ITS OWN TRY.

    Two restores that share one try/catch are one restore: whichever throws
    takes the other with it. This one is independent of the badge restore
    below, and it only removes the row THIS run inserted — a subject the
    teacher already had is left exactly where it was.
  */
  let subjectRestore = 'nothing to undo — the teacher already had a subject';

  try {
    if (teacher1Id && probeSubject?.added) {
      sql(`SET NOCOUNT ON; USE jp_app;
        DELETE FROM t_app_teacher_subjects
         WHERE TeacherId = ${teacher1Id} AND SubjectId = ${probeSubject.subjectId};`);

      subjectRestore = `subject ${probeSubject.subjectId} removed`;
    }
  } catch (error) {
    subjectRestore = `COULD NOT REMOVE subject ${probeSubject?.subjectId}: ${error.message}`;
    console.error(`  ⚠️ ${subjectRestore}`);
  }

  try {
    /*
      ⚠️ RESTORED, because teacher-search.mjs counts verified teachers and
      dashboards read the badge. Leaving a teacher verified would be a quiet
      fixture change in exactly the shape 6C-0 spent a morning on.
    */
    if (teacher1Id && found1) restoreBadge(teacher1Id, found1);
    if (teacher2Id && found2) restoreBadge(teacher2Id, found2);

    cleanup([uid1, uid2]);

    const [, , v1, o1, b1] = teacherRow(TEACHER.id);

    check('🔴 exit: the badge is exactly as it was found',
      v1 === found1.isVerified && o1 === found1.verifiedOn && b1 === found1.verifiedBy,
      `verified=${v1} on=${o1} by=${b1} (found ${found1.isVerified}/${found1.verifiedOn}/${found1.verifiedBy})`);

    check('exit: no teacher-verification request of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_mdm_approval_requests
         WHERE RequestTypeId = ${REQUEST_TYPE_TEACHER_VERIFICATION}
           AND LOWER(CAST(EntityUid AS varchar(40))) IN ('${uid1}', '${uid2}');`) === '0',
      'none');

    check('exit: no verification notification of ours is left',
      notifCount(TEACHER.id, 'VERIFICATION_APPROVED') === '0'
      && notifCount(TEACHER_2.id, 'VERIFICATION_REJECTED') === '0',
      'none');

    check('🔴 exit: and the verified-teacher count is back where it started',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teachers WHERE IsVerified = 1 AND Is_Deleted = 0;`) === '4',
      '4 seeded verified teachers, as found');

    /*
      ⚠️ AND THE PROBE'S SUBJECTS ARE BACK TO THE NUMBER THIS RUN FOUND. The
      count, not the fact of a delete: teacher-search.mjs filters on subjects,
      and a fixture row left behind would quietly change what it finds.
    */
    check('🔴 exit: the probe teacher has exactly the subjects this run found them with',
      subjectCount(teacher1Id) === probeSubject?.countBefore,
      `${subjectCount(teacher1Id)} now, ${probeSubject?.countBefore} on entry — ${subjectRestore}`);
  } catch (error) {
    console.error('  ⚠️ COULD NOT RESTORE:', error.message);
  }

  /*
    🔴 THE CATALOGUE GOES BACK LAST, AND "LAST" IS THE WHOLE POINT.

    SR-4 shipped three suites that restored the catalogue from somewhere in
    the middle of their finally; an earlier restore threw, and the catalogue
    was left short — 6 mappings, then 5, then 0 — and the next suite in the
    run failed for a reason that had nothing to do with it.

    ⚠️ IT IS ALSO OUTSIDE THE try/catch ABOVE, so a failed badge or subject
    restore cannot take the product's pricing down with it.
  */
  restoreCatalogue();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log('='.repeat(74));

process.exitCode = failed.length ? 1 : 0;
