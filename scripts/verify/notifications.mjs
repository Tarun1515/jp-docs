/*
  PHASE 6C — NOTIFICATIONS: WHO IS TOLD WHAT, AND WHO IS NOT.

  ----------------------------------------------------------------------------
    0. ENTRY           twelve types, each one named by the build guard as
                       having a procedure that creates it.
    1. 🔴 THE EVENTS   every one of the twelve fired from its REAL path — an
                       application, an offer and an invitation walked end to
                       end, not a procedure called directly.
    2. 🔴 THE SILENCES Applied, Interviewed and Selected write NOTHING. The
                       omissions are decisions (021), so they are asserted.
    3. 🔴 FAN-OUT      a school event reaches the team, branch-scoped, and
                       never the person who caused it.
    4. 🔒 SCOPE        a user reads exactly their own rows. Somebody else's id
                       is 404, never 403 (2.6).
    5. 🔒 NO CONTACT   the list is read as raw TEXT and searched for contact
                       field names, every caller.
    6. READ STATE      mark read is idempotent, mark-all is a success with
                       nothing to do, and the check constraint holds.
    7. 🔴 EMAIL        only SendEmail types are owed one, and the stamp is
                       written once.
    8. 🔴 NO ORPHANS   no notification points at an entity that is gone — 021
                       says a notification leading to a 404 is worse than none.
    9. EXIT            fixtures gone, nobody left unlocked, counts restored.

  ----------------------------------------------------------------------------
  🔴 WHY THIS WALKS THE REAL PATHS INSTEAD OF CALLING THE NOTIFIERS
  ----------------------------------------------------------------------------
  Calling USP_NotifyOffer directly would prove the notifier works and nothing
  about whether anything calls it. 6C's whole risk is a notification type that
  exists, reads correctly, and is never created — the G32 shape. So every
  assertion below comes from applying, offering, inviting and answering over
  HTTP, and then looking at the table.

  ⚠️ FIXTURES: the job carries '6C ' in its title, invitations carry
  'notif-suite' in their message, and the teardown removes the notifications
  those produced. A killed run is cleaned on the next ENTRY, not left for
  somebody to find — the seventh contamination taught that (6C-0).

  Run (both APIs up): node scripts/verify/notifications.mjs
*/
import { execFileSync } from 'node:child_process';
import { token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';
import { arrangeUngated, restoreCatalogue } from './lib/catalogue.mjs';

const APP = 'http://localhost:5299/api';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
/*
  ⚠️ NOT A COLLEAGUE — HR OWNS A DIFFERENT SCHOOL IN THE SAME ORGANISATION.

  local-accounts.md calls this account "same organisation as the principal",
  which is true and was read too quickly: hr.lead is the owner of school 2
  (Greenwood Public School, Dwarka), while the principal owns school 4 (Nalanda
  Vidyalaya). They share an organisation and share no school.

  🔴 That makes it the better negative. A fan-out written against the
  ORGANISATION instead of the school would reach this account, and every
  assertion about per-school scoping would still pass — because the two
  accounts look related in every way except the one that matters.
*/
const HR = { id: 'hr.lead@greenwood.edu.in', pw: secret('hr.lead@greenwood.edu.in') };

/** Read-only, same school, same campus as the principal. */
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: secret('viewer@greenwood.edu.in') };
const OTHER_SCHOOL = { id: 'head@stmarys.edu.in', pw: secret('head@stmarys.edu.in') };

/** 90%, has a resume — the only documented teacher who can actually apply. */
const TEACHER_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };
const TEACHER_B = { id: 'anita.deshmukh21338@yopmail.com', pw: secret('anita.deshmukh21338@yopmail.com') };
const TEACHER_C = { id: 'imran.qureshi.86007@yopmail.com', pw: secret('imran.qureshi.86007@yopmail.com') };

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

/** Every notification type this run produced, as a set of codes. */
const codesFor = (uid) => new Set(sql(`SET NOCOUNT ON; USE jp_app;
  SELECT DISTINCT nt.Code
  FROM t_app_notifications n
    INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
  WHERE n.RecipientUserUid = '${uid}' AND n.Is_Deleted = 0;`));

const countFor = (uid, code) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(COUNT(*) AS varchar(8))
  FROM t_app_notifications n
    INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
  WHERE n.RecipientUserUid = '${uid}' AND nt.Code = '${code}' AND n.Is_Deleted = 0;`);

const userUidOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(UserUid AS varchar(50)) FROM jp_sso.dbo.t_sso_users WHERE Email = '${email}';`);

const teacherIdOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(t.TeacherId AS varchar(10)) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid WHERE u.Email = '${email}';`);

const teacherUidOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(t.TeacherUid AS varchar(50)) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid WHERE u.Email = '${email}';`);

const unlocked = (teacherId, schoolId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(dbo.fn_TeacherContactUnlocked(${teacherId}, ${schoolId}) AS varchar(2));`);

/**
 * ⚠️ Narrow on purpose — only rows this suite's own fixtures produced.
 * A broad "delete every notification" would hide a leak from another suite,
 * and the exit assertions are supposed to notice those.
 */
const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_notifications
   WHERE RefEntityUid IN (
           SELECT ApplicationUid FROM t_app_applications
            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C %')
           UNION ALL
           SELECT OfferUid FROM t_app_offers
            WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                                     WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C %'))
           UNION ALL
           SELECT InviteUid FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-suite%');

  DELETE FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-suite%';

  DELETE FROM t_app_offers
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C %'));

  DELETE FROM t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C %'));
  DELETE FROM t_app_applications
   WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C %');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '6C %';

  /*
    ⚠️ And any notification left pointing at nothing, which is what an earlier
    killed run leaves behind. Section 8 asserts there are none; this is what
    makes that assertion about the PRODUCT rather than about the last run.
  */
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 1
     AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2
     AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 3
     AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = RefEntityUid);`);

const CONTACT_WORDS = ['contactEmail', 'contactMobile', 'resumePath', '@yopmail.com'];

let entryTotal = '';

/*
  🔴 SR-4: THIS SUITE ARRANGES AN UNGATED ENGINE, AND USED TO INHERIT ONE.

  SR-4 made JOB_POST metered with a quota of 1 on the free plan — the
  product the client asked for, and the plan the shared fixture school is
  on. About nine suites publish jobs against that one school, so the first
  consumes the month and every later one is refused.

  This suite is not testing entitlement. It needs to publish a job the way
  it always could, so it now ASKS for that state rather than assuming it.

  ⚠️ Gating is still covered — by the suites whose subject it is: billing,
  billing-screens, entitlement-http, entitlement-engine, jobs-consume and
  screens-25 all arrange metered state themselves and assert it.

  restoreCatalogue() on the way out puts the real catalogue back.
*/
arrangeUngated();

try {
  // =========================================================================
  section('0. ENTRY — twelve types, every one of them with a consumer');
  // =========================================================================

  cleanup();

  const types = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT Code + ':' + CAST(AudienceId AS varchar(2)) + ':' + CAST(SendEmail AS varchar(2))
    FROM m_app_notification_type WHERE Is_Deleted = 0 ORDER BY DisplayOrder;`);

  console.log(`\n    ${types.length} types: ${types.join(', ')}\n`);

  /*
    ⚠️ TWELVE BECAME FOURTEEN IN 6C-2-0, AND THE ASSERTION BELOW IT INVERTED.

    6C-1 asserted twelve, and asserted that the two verification types were
    ABSENT — because nothing created them, and a type with no consumer is the
    G32 shape. Looking for that consumer is what found G37: nothing in the
    product set t_app_teachers.IsVerified at all.

    G37 is closed now (USP_SetTeacherVerified), so the two types arrive with
    their consumer and these two assertions move with the shipped state, in the
    same commit, with the reason (5B's rule).

    🔴 The assertion that did NOT weaken is the one that matters: it is still
    "exactly this many, and every one of them has a procedure named in 029's
    build guard" — not "at least twelve".
  */
  check('🔴 fourteen notification types are seeded', types.length === 14, `${types.length}`);

  /*
    🔴 AND THE CONSUMER RULE IS STILL THE POINT.

    029's guard lists every seeded code against the procedure that writes it and
    fails the build if one has none. This asserts the two newest are in that
    list rather than exceptions to it — teacher-verification.mjs then walks
    their real path end to end.
  */
  check('🔴 …and the two verification types are seeded WITH their consumer (G37 closed)',
    types.filter((t) => t.startsWith('VERIFICATION_')).length === 2,
    types.filter((t) => t.startsWith('VERIFICATION_')).join(' · ') || 'MISSING');

  check('🔒 every school-facing type is audience 2 and every teacher-facing one is audience 1',
    types.filter((t) => /^(APPLICATION_RECEIVED|OFFER_ACCEPTED|OFFER_DECLINED|INVITE_ACCEPTED|INVITE_IGNORED):2:/.test(t)).length === 5
    && types.filter((t) => /^(APPLICATION_VIEWED|APPLICATION_SHORTLIST|APPLICATION_REJECTED|OFFER_SENT|OFFER_WITHDRAWN|HIRED|INVITE_RECEIVED):1:/.test(t)).length === 7,
    '5 school-facing, 7 teacher-facing');

  const emailTypes = types.filter((t) => t.endsWith(':1')).map((t) => t.split(':')[0]);

  /*
    ⚠️ SIX BECAME EIGHT (6C-2-0). A verification outcome is the slowest-moving
    thing a teacher waits on — days, not minutes — so it is exactly the case
    where nobody is watching the portal when it lands. The DECLINE emails too,
    deliberately: a teacher who is never told waits forever.
  */
  const EMAILING = [
    'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'OFFER_WITHDRAWN', 'HIRED',
    'INVITE_RECEIVED', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED',
  ];

  check('🔴 the types that also email are the interruptive ones, and only those',
    emailTypes.length === EMAILING.length && EMAILING.every((c) => emailTypes.includes(c)),
    emailTypes.join(', '));

  const ownerToken = await loginToken(OWNER);
  const hrToken = await loginToken(HR);
  const viewerToken = await loginToken(VIEWER);
  const otherToken = await loginToken(OTHER_SCHOOL);
  const tokenA = await loginToken(TEACHER_A);
  const tokenB = await loginToken(TEACHER_B);
  const tokenC = await loginToken(TEACHER_C);

  const ownerUid = userUidOf(OWNER.id);
  const hrUid = userUidOf(HR.id);
  const viewerUid = userUidOf(VIEWER.id);
  const uidA = userUidOf(TEACHER_A.id);
  const uidB = userUidOf(TEACHER_B.id);
  const uidC = userUidOf(TEACHER_C.id);

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT s.SchoolId FROM t_app_schools s
      INNER JOIN t_app_school_users su ON su.SchoolId = s.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 BranchId FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC, BranchId;`));

  entryTotal = scalar(`SET NOCOUNT ON; USE jp_app; SELECT CAST(COUNT(*) AS varchar(10)) FROM t_app_notifications;`);

  console.log(`\n    school ${schoolId} branch ${branchId} · notifications in the table at entry: ${entryTotal}\n`);

  check('entry: no fixture of ours survives a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST((SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '6C %')
                + (SELECT COUNT(*) FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-suite%') AS varchar(8));`) === '0',
    'clean');

  // =========================================================================
  section('1. 🔴 THE EVENTS — all twelve, from the real paths');
  // =========================================================================

  const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '6C Physics teacher', 1, 1, 1, 2, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /* ---- the teacher applies: the school's team is told ------------------ */
  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ jobId, coverNote: 'notif-suite' }),
  });

  const applicationId = applied.body?.data?.applicationId ?? applied.body?.data?.id;

  check('premise: the teacher applied', applied.http === 200 && !!applicationId,
    `HTTP ${applied.http}, application ${applicationId}`);

  check('🔴 APPLICATION_RECEIVED reached the school',
    countFor(ownerUid, 'APPLICATION_RECEIVED') === '1', `owner has ${countFor(ownerUid, 'APPLICATION_RECEIVED')}`);

  check('🔴 …and the teacher was NOT told they applied — they just did it (021)',
    countFor(uidA, 'APPLICATION_RECEIVED') === '0' && !codesFor(uidA).has('APPLICATION_RECEIVED'),
    'nothing in the applicant\'s own list');

  /* ---- the school opens it: APPLICATION_VIEWED, from the real path ----- */
  const detail = await j(`${APP}/applicants/${applicationId}`, { headers: H(ownerToken) });

  check('premise: the school opened the application', detail.http === 200, `HTTP ${detail.http}`);

  check('🔴 APPLICATION_VIEWED reached the teacher — from OPENING it, not from a dropdown',
    countFor(uidA, 'APPLICATION_VIEWED') === '1',
    `teacher has ${countFor(uidA, 'APPLICATION_VIEWED')} (USP_MarkApplicationViewed is the path that fires)`);

  const viewedTitle = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT n.Title FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.RecipientUserUid = '${uidA}' AND nt.Code = 'APPLICATION_VIEWED';`);

  check('🔴 …and its title is the stage\'s TEACHER-FACING word, read from the master',
    viewedTitle === 'Seen by the school', `"${viewedTitle}"`);

  /* ---- shortlist, then Selected (silent), then offer ------------------- */
  const setStatus = (id, statusId, remarks) => j(`${APP}/applicants/${id}/status`, {
    method: 'POST', headers: H(ownerToken),
    /*
      ⚠️ `toStatusId`, which is what SetApplicationStatusRequest declares. The
      first version of this sent `applicationStatusId` — the COLUMN's name —
      and every call returned 200 having changed nothing, because an unbound
      property defaults to 0 and 0 is not a stage. Eighteen assertions failed
      downstream of one silent no-op.
    */
    body: JSON.stringify({ toStatusId: statusId, remarks }),
  });

  await setStatus(applicationId, 3);

  check('🔴 APPLICATION_SHORTLIST reached the teacher',
    countFor(uidA, 'APPLICATION_SHORTLIST') === '1', countFor(uidA, 'APPLICATION_SHORTLIST'));

  const beforeSelected = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications WHERE RecipientUserUid = '${uidA}';`);

  await setStatus(applicationId, 5);

  const afterSelected = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications WHERE RecipientUserUid = '${uidA}';`);

  // =========================================================================
  section('2. 🔴 THE SILENCES — Selected tells the teacher NOTHING');
  // =========================================================================

  /*
    🔴 THE MOST IMPORTANT ASSERTION IN THIS FILE.

    Selected is the school's INTERNAL decision. What reaches the teacher is the
    OFFER (2.73's two machines). A notification here would have the teacher
    expecting an offer the school has not sent and may never send — and nothing
    would look broken.
  */
  check('🔴 moving to Selected wrote NOTHING to the teacher (2.73, 021)',
    beforeSelected === afterSelected,
    `${beforeSelected} -> ${afterSelected} notifications`);

  check('…and the application really is Selected, so the silence is not a no-op',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(ApplicationStatusId AS varchar(3)) FROM t_app_applications
       WHERE ApplicationId = ${applicationId};`) === '5',
    'status 5');

  // =========================================================================
  section('1b. 🔴 THE OFFER CHAIN — sent, declined, re-sent, accepted, hired');
  // =========================================================================

  const sendOffer = () => j(`${APP}/applicants/${applicationId}/offers`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ designationId: 1, offeredSalary: 42000, joiningDate: '2027-06-01' }),
  });

  const offer1 = await sendOffer();
  const offerId1 = offer1.body?.data?.offerId ?? offer1.body?.data?.id;

  check('premise: the offer was sent', offer1.http === 200 && !!offerId1, `HTTP ${offer1.http}`);

  check('🔴 OFFER_SENT reached the teacher',
    countFor(uidA, 'OFFER_SENT') === '1', countFor(uidA, 'OFFER_SENT'));

  const declined = await j(`${APP}/teacher/offers/${offerId1}/respond`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ accept: false, teacherRemarks: 'notif-suite too low' }),
  });

  check('premise: the teacher declined', declined.http === 200, `HTTP ${declined.http}`);

  check('🔴 OFFER_DECLINED reached the SCHOOL — the other direction',
    countFor(ownerUid, 'OFFER_DECLINED') === '1', countFor(ownerUid, 'OFFER_DECLINED'));

  const declinedBody = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(n.Body, '-') FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.RecipientUserUid = '${ownerUid}' AND nt.Code = 'OFFER_DECLINED';`);

  check('🔴 …and the teacher\'s REMARKS are not in it (018, 021)',
    !/too low/i.test(declinedBody), `"${declinedBody}"`);

  const offer2 = await sendOffer();
  const offerId2 = offer2.body?.data?.offerId ?? offer2.body?.data?.id;

  check('premise: a SECOND offer after the decline (2.73 allows it)',
    offer2.http === 200 && !!offerId2 && offerId2 !== offerId1, `offer ${offerId2}`);

  check('🔴 …and the teacher was told again — the type repeats, there is no unique guard (030)',
    countFor(uidA, 'OFFER_SENT') === '2', countFor(uidA, 'OFFER_SENT'));

  const accepted = await j(`${APP}/teacher/offers/${offerId2}/respond`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ accept: true }),
  });

  check('premise: the teacher accepted', accepted.http === 200, `HTTP ${accepted.http}`);

  check('🔴 OFFER_ACCEPTED reached the school',
    countFor(ownerUid, 'OFFER_ACCEPTED') === '1', countFor(ownerUid, 'OFFER_ACCEPTED'));

  const hired = await j(`${APP}/applicants/${applicationId}/hire`, {
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ remarks: 'notif-suite' }),
  });

  check('premise: the hire was confirmed', hired.http === 200, `HTTP ${hired.http}`);

  check('🔴 HIRED reached the teacher — accepting is not arriving (2.73)',
    countFor(uidA, 'HIRED') === '1', countFor(uidA, 'HIRED'));

  /* ---- a second application, to reject and to withdraw from ----------- */
  const job2 = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '6C Second posting', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /*
    ⚠️ Teacher A again, because they are the only documented teacher with a
    resume — and applying requires one (RESUME_REQUIRED, 5A). 6C-0 learned that
    the hard way when a suite asked an incomplete profile to apply.
  */
  const applied2 = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ jobId: job2, coverNote: 'notif-suite' }),
  });

  const app2 = applied2.body?.data?.applicationId ?? applied2.body?.data?.id;

  await setStatus(app2, 3);
  await setStatus(app2, 5);

  const offer3 = await j(`${APP}/applicants/${app2}/offers`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ designationId: 1, offeredSalary: 40000, joiningDate: '2027-07-01' }),
  });

  const offerId3 = offer3.body?.data?.offerId ?? offer3.body?.data?.id;

  const withdrawn = await j(`${APP}/offers/${offerId3}/withdraw`, {
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ reason: 'notif-suite internal fill' }),
  });

  check('premise: the offer was withdrawn', withdrawn.http === 200, `HTTP ${withdrawn.http}`);

  check('🔴 OFFER_WITHDRAWN reached the teacher — the case where silence is worst',
    countFor(uidA, 'OFFER_WITHDRAWN') === '1', countFor(uidA, 'OFFER_WITHDRAWN'));

  const withdrawBody = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(n.Body, '-') FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.RecipientUserUid = '${uidA}' AND nt.Code = 'OFFER_WITHDRAWN';`);

  check('🔴 …and the school\'s REASON is not in it (018)',
    !/internal fill/i.test(withdrawBody), `"${withdrawBody}"`);

  await setStatus(app2, 6, 'notif-suite private note');

  check('🔴 APPLICATION_REJECTED reached the teacher',
    countFor(uidA, 'APPLICATION_REJECTED') === '1', countFor(uidA, 'APPLICATION_REJECTED'));

  const rejectBody = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(n.Body, '-') + ' | ' + n.Title FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.RecipientUserUid = '${uidA}' AND nt.Code = 'APPLICATION_REJECTED';`);

  check('🔴 …and the school\'s private REMARKS are not in it, and the word is "Not selected"',
    !/private note/i.test(rejectBody) && /Not selected/.test(rejectBody), `"${rejectBody}"`);

  /* ---- invitations ----------------------------------------------------- */
  const invite = async (teacherUid, message) => j(`${APP}/teacher-search/invites`, {
    /* ⚠️ branchId is required AND an authorization input (2.39, SendInviteRequest). */
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ teacherUid, branchId, message }),
  });

  const inv1 = await invite(teacherUidOf(TEACHER_B.id), 'notif-suite come and apply');
  const inviteId1 = inv1.body?.data?.inviteId;

  check('premise: an invitation was sent', inv1.http === 200 && !!inviteId1, `invite ${inviteId1}`);

  check('🔴 INVITE_RECEIVED reached the teacher',
    countFor(uidB, 'INVITE_RECEIVED') === '1', countFor(uidB, 'INVITE_RECEIVED'));

  const inviteBody = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(n.Body, '-') FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.RecipientUserUid = '${uidB}' AND nt.Code = 'INVITE_RECEIVED';`);

  check('🔒 …and it carries the school\'s name and the school\'s own message, nothing else',
    /come and apply/.test(inviteBody) && !/@/.test(inviteBody), `"${inviteBody}"`);

  const acceptedInvite = await j(`${APP}/teacher/invites/${inviteId1}/respond`, {
    method: 'POST', headers: H(tokenB), body: JSON.stringify({ accept: true }),
  });

  check('premise: the teacher accepted the invitation', acceptedInvite.http === 200, `HTTP ${acceptedInvite.http}`);

  check('🔴 INVITE_ACCEPTED reached the school',
    countFor(ownerUid, 'INVITE_ACCEPTED') === '1', countFor(ownerUid, 'INVITE_ACCEPTED'));

  /*
    🔒 AND THE UNLOCK CAME FROM THE ROW, NOT FROM THE NOTIFICATION.

    Accepting is consent path 2 (2.56). Deleting every notification must change
    nothing about who can see whose contact — if it did, a notification would
    have become a third consent path.
  */
  const unlockedBefore = unlocked(teacherIdOf(TEACHER_B.id), schoolId);

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_notifications WHERE RecipientUserUid = '${ownerUid}'
      AND NotificationTypeId = (SELECT NotificationTypeId FROM m_app_notification_type WHERE Code = 'INVITE_ACCEPTED');`);

  check('🔒 deleting the notification does NOT re-lock the contact — consent is the ROW (2.56)',
    unlockedBefore === '1' && unlocked(teacherIdOf(TEACHER_B.id), schoolId) === '1',
    `unlocked ${unlockedBefore} before, ${unlocked(teacherIdOf(TEACHER_B.id), schoolId)} after`);

  const inv2 = await invite(teacherUidOf(TEACHER_C.id), 'notif-suite second invitation');
  const inviteId2 = inv2.body?.data?.inviteId;

  const ignored = await j(`${APP}/teacher/invites/${inviteId2}/respond`, {
    method: 'POST', headers: H(tokenC), body: JSON.stringify({ accept: false }),
  });

  check('premise: the other teacher passed on theirs', ignored.http === 200, `HTTP ${ignored.http}`);

  check('🔴 INVITE_IGNORED reached the school',
    countFor(ownerUid, 'INVITE_IGNORED') === '1', countFor(ownerUid, 'INVITE_IGNORED'));

  check('🔒 …and passing unlocked nothing',
    unlocked(teacherIdOf(TEACHER_C.id), schoolId) === '0',
    `unlocked ${unlocked(teacherIdOf(TEACHER_C.id), schoolId)}`);

  /* ---- and now: did every one of the twelve fire? ---------------------- */
  const fired = new Set(sql(`SET NOCOUNT ON; USE jp_app;
    SELECT DISTINCT nt.Code FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.Is_Deleted = 0;`));

  const allTwelve = ['APPLICATION_RECEIVED', 'APPLICATION_VIEWED', 'APPLICATION_SHORTLIST',
    'APPLICATION_REJECTED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'OFFER_WITHDRAWN',
    'HIRED', 'INVITE_RECEIVED', 'INVITE_IGNORED'];

  const missing = allTwelve.filter((c) => !fired.has(c));

  console.log(`\n    fired in this run: ${[...fired].sort().join(', ')}\n`);

  /*
    ⚠️ INVITE_ACCEPTED is excluded from the list above because this run DELETED
    it, two assertions ago, to prove consent does not depend on it. It was
    asserted present before that.

    ⚠️ And the two VERIFICATION_* types are not in it either, because nothing in
    this file can produce them: they come from an admin's decision on an
    approval request, not from an application, offer or invitation.
    teacher-verification.mjs walks that path — submit, queue, approve, badge,
    search result — and would be the suite to fail if they stopped firing.
  */
  check('🔴 every notification type the product can send was produced by a REAL path',
    missing.length === 0,
    missing.length ? `NEVER FIRED: ${missing.join(', ')}` : `${allTwelve.length} of 11 checked here + INVITE_ACCEPTED above`);

  // =========================================================================
  section('3. 🔴 FAN-OUT — the team, branch-scoped, never the actor');
  // =========================================================================

  check('🔴 the school-facing notification reached MORE than one person',
    Number(scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
        INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE nt.Code = 'APPLICATION_RECEIVED';`)) > 1,
    `${scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
        INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE nt.Code = 'APPLICATION_RECEIVED';`)} rows — one per team member in scope`);

  /*
    🔴 THE VIEWER IS TOLD, AND THAT IS THE POINT OF FANNING OUT AT ALL.

    A read-only account on the same campus gets its own row with its own read
    state, because "read" is something a person does. If the fan-out only
    reached owners, the one person whose whole job is watching the applicant
    list would be the one nobody told.
  */
  /*
    ⚠️ COMPARED WITH THE OWNER'S COUNT, not pinned to a number. This section
    runs after the suite's SECOND application, so the literal is 2 here and 1
    where the owner was first checked — and a test pinned to a literal would
    have to be edited every time the suite grows an application. The claim is
    "every member of this school was told the same things", so that is what is
    asserted.
  */
  check('🔴 the read-only VIEWER on this campus was told exactly as often as the owner',
    countFor(viewerUid, 'APPLICATION_RECEIVED') === countFor(ownerUid, 'APPLICATION_RECEIVED')
    && Number(countFor(viewerUid, 'APPLICATION_RECEIVED')) > 0,
    `viewer ${countFor(viewerUid, 'APPLICATION_RECEIVED')} · owner ${countFor(ownerUid, 'APPLICATION_RECEIVED')}`);

  /*
    🔴 AND THE NEGATIVE THAT MATTERS MORE: SAME ORGANISATION, DIFFERENT SCHOOL.

    hr.lead owns school 2 and shares an organisation with the principal. A
    fan-out written against OrganizationUid instead of SchoolId would reach
    them, and nothing else in this file would notice — the two accounts look
    related in every way except the one that counts.
  */
  check('🔒 a school owner in the SAME ORGANISATION but a different school was told nothing',
    countFor(hrUid, 'APPLICATION_RECEIVED') === '0',
    `hr.lead (school 2) has ${countFor(hrUid, 'APPLICATION_RECEIVED')}`);

  check('…and the fan-out reached exactly the two members of THIS school',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
        INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE nt.Code = 'APPLICATION_RECEIVED'
        AND n.RecipientUserUid IN (SELECT su.UserUid FROM t_app_school_users su
                                    WHERE su.SchoolId = ${schoolId} AND su.Is_Active = 1 AND su.Is_Deleted = 0);`)
    === scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
        INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE nt.Code = 'APPLICATION_RECEIVED';`),
    'every APPLICATION_RECEIVED row belongs to a member of this school');

  /*
    🔴 THE ACTOR IS EXCLUDED. The owner declined nothing and accepted nothing —
    the teacher did — so the owner IS told about those. But the owner sent the
    offer, so OFFER_SENT must not be in the owner's own list at all: that one is
    teacher-facing. The actor exclusion is tested where it applies, on the
    school-facing types the owner themself triggered.
  */
  check('🔒 the owner was not told about the offer THEY sent',
    countFor(ownerUid, 'OFFER_SENT') === '0', countFor(ownerUid, 'OFFER_SENT'));

  check('🔴 the OTHER school was told nothing by any of this',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications
       WHERE RecipientUserUid = '${userUidOf(OTHER_SCHOOL.id)}';`) === '0',
    'zero rows');

  // =========================================================================
  section('4. 🔒 SCOPE — a user reads exactly their own');
  // =========================================================================

  const mine = await j(`${APP}/notifications?pageSize=100`, { headers: H(tokenA) });
  const ownerList = await j(`${APP}/notifications?pageSize=100`, { headers: H(ownerToken) });

  console.log(`\n    teacher A sees ${mine.body?.data?.length} · owner sees ${ownerList.body?.data?.length}\n`);

  check('GET /api/notifications returns the caller\'s own rows',
    mine.http === 200 && (mine.body?.data?.length ?? 0) > 0, `HTTP ${mine.http}`);

  check('🔒 …and the count matches what the table holds for THAT user, exactly',
    String(mine.body?.totalRecords) === scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications
       WHERE RecipientUserUid = '${uidA}' AND Is_Deleted = 0;`),
    `${mine.body?.totalRecords} from the API`);

  check('🔒 …and no row in it belongs to anybody else',
    (mine.body?.data ?? []).every((n) => sql(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_notifications
       WHERE NotificationId = ${n.notificationId} AND RecipientUserUid = '${uidA}';`)[0] === '1'),
    'every id verified against the recipient column');

  /* 🔒 Somebody else's id. */
  const theirs = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(NotificationId AS varchar(10)) FROM t_app_notifications
     WHERE RecipientUserUid = '${ownerUid}' ORDER BY NotificationId DESC;`));

  const crossRead = await j(`${APP}/notifications/${theirs}/read`, { method: 'POST', headers: H(tokenA) });

  check('🔒 marking somebody ELSE\'S notification read is 404, never 403 (2.6)',
    crossRead.http === 404, `HTTP ${crossRead.http} · ${crossRead.body?.code}`);

  check('🔒 …and it stayed unread, so the 404 was a refusal and not a quiet success',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(IsRead AS varchar(2)) FROM t_app_notifications WHERE NotificationId = ${theirs};`) === '0',
    'still unread');

  const nonsense = await j(`${APP}/notifications/999999999/read`, { method: 'POST', headers: H(tokenA) });

  check('…and an id that does not exist is the SAME 404 — indistinguishable',
    nonsense.http === 404 && nonsense.body?.code === crossRead.body?.code,
    `HTTP ${nonsense.http}, code ${nonsense.body?.code}`);

  // =========================================================================
  section('5. 🔒 NO CONTACT — the list read as raw text');
  // =========================================================================

  for (const [who, tok] of [['teacher A', tokenA], ['the owner', ownerToken],
    ['the viewer', viewerToken], ['HR', hrToken]]) {
    const raw = (await j(`${APP}/notifications?pageSize=100`, { headers: H(tok) })).text;
    const found = CONTACT_WORDS.filter((w) => raw.toLowerCase().includes(w.toLowerCase()));

    check(`🔒 ${who}'s notification list carries no contact field or address`,
      found.length === 0, found.length ? `LEAKED: ${found.join(', ')}` : 'none of contactEmail/contactMobile/resumePath/@yopmail.com');
  }

  // =========================================================================
  section('6. READ STATE — idempotent, and the badge');
  // =========================================================================

  const unreadBefore = (await j(`${APP}/notifications/unread-count`, { headers: H(tokenA) })).body?.data?.unreadCount;

  check('GET unread-count matches the table',
    String(unreadBefore) === scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications
       WHERE RecipientUserUid = '${uidA}' AND IsRead = 0 AND Is_Deleted = 0;`),
    `${unreadBefore} unread`);

  const first = mine.body?.data?.[0]?.notificationId;

  const read1 = await j(`${APP}/notifications/${first}/read`, { method: 'POST', headers: H(tokenA) });
  const read2 = await j(`${APP}/notifications/${first}/read`, { method: 'POST', headers: H(tokenA) });

  check('marking one read works', read1.http === 200, `HTTP ${read1.http}`);

  check('🔴 marking the SAME one again is a success, not a conflict (2.48\'s shape)',
    read2.http === 200, `HTTP ${read2.http} · affected ${read2.body?.data?.affected}`);

  check('🔴 …and ReadOn was stamped, which the check constraint makes inseparable from IsRead',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CASE WHEN IsRead = 1 AND ReadOn IS NOT NULL THEN 'both' ELSE 'DISAGREE' END
      FROM t_app_notifications WHERE NotificationId = ${first};`) === 'both',
    'IsRead and ReadOn agree');

  const all = await j(`${APP}/notifications/read-all`, { method: 'POST', headers: H(tokenA) });

  check('read-all marks the rest',
    all.http === 200 && scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications
       WHERE RecipientUserUid = '${uidA}' AND IsRead = 0 AND Is_Deleted = 0;`) === '0',
    `affected ${all.body?.data?.affected}`);

  const allAgain = await j(`${APP}/notifications/read-all`, { method: 'POST', headers: H(tokenA) });

  check('🔴 …and read-all with nothing unread is a SUCCESS with affected 0',
    allAgain.http === 200 && allAgain.body?.data?.affected === 0,
    `HTTP ${allAgain.http}, affected ${allAgain.body?.data?.affected}`);

  const unreadOnly = await j(`${APP}/notifications?unreadOnly=true`, { headers: H(tokenA) });

  check('…and unreadOnly now returns nothing',
    (unreadOnly.body?.data?.length ?? -1) === 0, `${unreadOnly.body?.data?.length} rows`);

  // =========================================================================
  section('7. 🔴 EMAIL — only the types that say so, stamped once');
  // =========================================================================

  const pending = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT nt.Code + ' email=' + CAST(nt.SendEmail AS varchar(2)) + ' sent=' + CASE WHEN n.EmailSentOn IS NULL THEN 'no' ELSE 'yes' END
    FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE n.Is_Deleted = 0 ORDER BY nt.Code;`);

  check('🔴 no notification of a SendEmail=0 type is ever stamped as emailed',
    !pending.some((p) => /email=0 sent=yes/.test(p)),
    'the type decides, not the sender (029)');

  /*
    ⚠️ The worker polls every thirty seconds, so this asserts the QUEUE rather
    than waiting on it: the rows owed an email are exactly the SendEmail=1 ones
    that are not yet stamped. Whether the SMTP send happened is the dispatch
    queue's business, and it is deliberately fire-and-forget.
  */
  const owed = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC dbo.USP_GetPendingNotificationEmails @MaxRows = 200;`);

  const owedCodes = new Set(owed.map((r) => r.split('|')[2]?.trim()).filter(Boolean));
  const nonEmailOwed = [...owedCodes].filter((c) =>
    !['OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'OFFER_WITHDRAWN', 'HIRED', 'INVITE_RECEIVED'].includes(c));

  check('🔴 the pending-email queue contains ONLY types whose master row says SendEmail = 1',
    nonEmailOwed.length === 0,
    nonEmailOwed.length ? `LEAKED: ${nonEmailOwed.join(', ')}` : `${owedCodes.size} type(s): ${[...owedCodes].sort().join(', ')}`);

  check('🔒 …and the queue carries a recipient UID, never an address (2.2)',
    !owed.some((r) => /@/.test(r)), 'no address in any row');

  /*
    🔴 THIS ASSERTION RACED A BACKGROUND WORKER, AND THE WORKER WON.

    The first version picked any SendEmail=1 row that was not yet stamped. That
    is a condition NotificationEmailWorker is actively removing: it polls every
    thirty seconds and stamps exactly those rows. On a run that happened to
    start more than thirty seconds after the events, there was nothing left to
    pick and the assertion compared two empty strings — a test failing because
    the product had already done its job.

    ⚠️ So the suite makes its own unstamped row instead of hoping to find one.
    Clearing the stamp is honest here: the column is the worker's own bookkeeping
    and the suite is asserting the procedure's behaviour, not the worker's.
  */
  const stampTarget = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(n.NotificationId AS varchar(10)) FROM t_app_notifications n
      INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
    WHERE nt.SendEmail = 1 ORDER BY n.NotificationId;`));

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_notifications SET EmailSentOn = NULL WHERE NotificationId = ${stampTarget};`);

  check('premise: an email-sending notification exists and is not stamped',
    stampTarget > 0 && scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CASE WHEN EmailSentOn IS NULL THEN 'unstamped' ELSE 'stamped' END
      FROM t_app_notifications WHERE NotificationId = ${stampTarget};`) === 'unstamped',
    `notification ${stampTarget}`);

  sql(`SET NOCOUNT ON; USE jp_app; EXEC dbo.USP_MarkNotificationEmailSent @NotificationId = ${stampTarget};`);
  const stamped1 = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(30), EmailSentOn, 126) FROM t_app_notifications WHERE NotificationId = ${stampTarget};`);

  sql(`SET NOCOUNT ON; USE jp_app; EXEC dbo.USP_MarkNotificationEmailSent @NotificationId = ${stampTarget};`);
  const stamped2 = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(30), EmailSentOn, 126) FROM t_app_notifications WHERE NotificationId = ${stampTarget};`);

  check('🔴 the email stamp is written once and a second call does not move it',
    stamped1 !== '' && stamped1 === stamped2, `${stamped1} === ${stamped2}`);

  check('…and a stamped row leaves the pending queue',
    !sql(`SET NOCOUNT ON; USE jp_app; EXEC dbo.USP_GetPendingNotificationEmails @MaxRows = 200;`)
      .some((r) => r.startsWith(`${stampTarget}|`)),
    `notification ${stampTarget} is no longer owed`);

  // =========================================================================
  section('8. 🔴 NO ORPHANS — nothing points at a row that is gone');
  // =========================================================================

  /*
    🔴 021's fan-out comment says a notification leading to a 404 is worse than
    no notification. This is that claim, asserted against the whole table.
  */
  const orphans = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT 'app:' + CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
     WHERE n.RefEntityTypeId = 1 AND n.RefEntityUid IS NOT NULL AND n.Is_Deleted = 0
       AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = n.RefEntityUid);
    SELECT 'invite:' + CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
     WHERE n.RefEntityTypeId = 2 AND n.RefEntityUid IS NOT NULL AND n.Is_Deleted = 0
       AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = n.RefEntityUid);
    SELECT 'offer:' + CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
     WHERE n.RefEntityTypeId = 3 AND n.RefEntityUid IS NOT NULL AND n.Is_Deleted = 0
       AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = n.RefEntityUid);`);

  check('🔴 no notification references an application, invitation or offer that is gone',
    orphans.every((o) => o.endsWith(':0')), orphans.join(' · '));

  check('🔒 every notification\'s ActionUrl is RELATIVE, never absolute (030)',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications
       WHERE ActionUrl IS NOT NULL AND ActionUrl NOT LIKE '/%';`) === '0',
    'all start with /');
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  /*
    🔴 THE CATALOGUE BACK, FIRST THING ON THE WAY OUT.

    This suite called arrangeUngated() at the top. Without this line it
    leaves the engine switched off, and the next suite in the run inherits
    it — failing for a reason that has nothing to do with itself. That is
    the shape of every contamination incident in this project.
  */
  restoreCatalogue();

  // =========================================================================
  section('9. EXIT — fixtures gone, counts back');
  // =========================================================================

  try {
    cleanup();

    check('exit: no job, application, offer or invitation of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST((SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '6C %')
                  + (SELECT COUNT(*) FROM t_app_teacher_invites WHERE [Message] LIKE N'notif-suite%') AS varchar(8));`) === '0',
      'none');

    check('🔴 exit: the notification table is back to its entry count',
      scalar(`SET NOCOUNT ON; USE jp_app; SELECT CAST(COUNT(*) AS varchar(10)) FROM t_app_notifications;`) === entryTotal,
      `${entryTotal} -> ${scalar(`SET NOCOUNT ON; USE jp_app; SELECT CAST(COUNT(*) AS varchar(10)) FROM t_app_notifications;`)}`);

    check('🔒 exit: nobody is left unlocked by this run',
      [TEACHER_A, TEACHER_B, TEACHER_C].every((t) => {
        const id = teacherIdOf(t.id);
        const s = scalar(`SET NOCOUNT ON; USE jp_app;
          SELECT s.SchoolId FROM t_app_schools s
            INNER JOIN t_app_school_users su ON su.SchoolId = s.SchoolId
            INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
          WHERE u.Email = '${OWNER.id}';`);

        return unlocked(id, s) === '0';
      }),
      'all three locked again');
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
