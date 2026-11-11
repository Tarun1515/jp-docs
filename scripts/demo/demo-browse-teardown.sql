/*==============================================================================
  DEMO FIXTURE — TEARDOWN (the browse / intelligent-defaults fixture)

  Run AFTER the demo, then run the verify runner to prove the shipped state is
  back.

      sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-browse-teardown.sql
      node scripts/verify/run.mjs

  The runner must come back to the known-good baseline: 49 suites, 1987
  assertions. Six of those suites are red while the fixture is installed — they
  assert t_app_jobs is EMPTY — and this script is what makes them green again.

  ----------------------------------------------------------------------------
  🔴 HOW IT FINDS EVERY ROW WITH CERTAINTY: IT RECOMPUTES THE KEYS
  ----------------------------------------------------------------------------
  demo-setup.sql finds its rows with a `DEMO_` code prefix, and that is the
  right tool for a plan. It is the wrong tool for a school, because a school's
  name is editable ON SCREEN. A demo in which somebody renames "Gohana Public
  School (Demo)" — which is a perfectly ordinary thing to do while showing off
  the profile editor — would orphan that row from any search for the name, and
  the orphan would be discovered by a build or a suite, days later, as a
  mystery.

  So this teardown does not search for a pattern. It RECOMPUTES THE EXACT
  IDENTIFIERS the setup derived:

      SourceRequestUid  = MD5('DEMO_BROWSE_REQ_<DISTRICT>')   -> the 3 schools
      JobUid            = MD5('DEMO_BROWSE_JOB_<KEY>')        -> the 6 adverts

  Those are immutable: no screen in the product writes either column. The same
  constant strings are in both files, so the same 16 bytes come out, and the
  rows are addressed by primary key rather than matched by description.

  ⚠️ AND THERE IS A SECOND, INDEPENDENT NET, BECAUSE A HALF-FINISHED SETUP IS
  THE CASE THAT MATTERS. If the setup died between registering an account and
  provisioning its school, there is no SourceRequestUid to recompute against —
  the account exists and the school does not. So the accounts are found by
  `Email LIKE 'demo.browse.%@yopmail.com'`, their OrganizationUid is read off
  them, and schools are collected by EITHER route. Email is not editable in
  this product; there is no change-email screen.

  Between the two, every row the setup could have written is reachable from
  something the setup could not have failed to write.

  ----------------------------------------------------------------------------
  🔴 A DEMO IS NOT A DRY RUN — AND THIS IS WHERE THE PREVIOUS FIXTURE'S LESSON
  GETS SPENT
  ----------------------------------------------------------------------------
  demo-teardown.sql learnt this the hard way with subscriptions: the point of
  showing a flow is that it really happens, so the teardown has to remove what
  the DEMO did, not only what the setup wrote. The browse demo's plausible side
  effects were enumerated before writing this, and all of them are removed:

      a teacher APPLIES to an advert   -> t_app_applications, its status
                                          history, and the contact-consent that
                                          application carries (024)
      a teacher SAVES an advert        -> t_app_saved_jobs
      a school makes an OFFER          -> t_app_offers
      a school INVITES a teacher       -> t_app_teacher_invites
      anything above                   -> t_app_notifications, by recipient AND
                                          by the entity the notification points
                                          at
      a school SEARCHES for teachers   -> t_app_feature_ledger (TEACHER_SEARCH
                                          is BOOLEAN today and writes nothing,
                                          but a mode change would make it
                                          write, and a ledger row for an owner
                                          who no longer exists is an orphan)
      an advert is REPORTED or PULLED  -> t_app_reports,
                                          t_app_job_moderation_log
      an advert is FEATURED            -> t_app_featured_jobs,
                                          t_app_featured_schools
      a profile gains a document or a
      previous employer                -> t_app_teacher_documents,
                                          t_app_teacher_experiences,
                                          t_app_teacher_skills,
                                          t_app_teacher_languages
      a school adds a photo or a
      facility                         -> t_app_school_photos,
                                          t_app_school_facilities
      a school adds a SECOND CAMPUS    -> every branch of a demo school goes,
                                          not only the head office the setup
                                          made

  ⚠️ t_app_job_moderation_log IS APPEND-ONLY, AND THAT RULE IS NOT BROKEN HERE.
  034's guard forbids the TABLE from gaining an edit or delete column, so that
  no moderation action can ever be rewritten or hidden by the product. A
  fixture removing the log of a demo advert that is itself being removed is not
  that: there is no action left to account for, and the FK to t_app_jobs means
  the row must go with the advert anyway. The rule is about the product's
  ability to rewrite history, not about a demo's own rows.

  ----------------------------------------------------------------------------
  🔴 HARD DELETE, NOT Is_Deleted = 1, AND THE REASON IS MEASURABLE
  ----------------------------------------------------------------------------
  The six suites this fixture upsets count like this:

      SELECT COUNT(*) FROM t_app_jobs;

  No `WHERE Is_Deleted = 0`. So a soft delete would leave all six still red
  while every row looked tidy, and the next person would go looking for the
  bug in the suites. A fixture's rows are not business history; they are
  removed, the way second-tenant.mjs removes its tenant.

  ----------------------------------------------------------------------------
  ⚠️ WHAT THIS DELIBERATELY DOES **NOT** TOUCH
  ----------------------------------------------------------------------------
  🟢 NOT ONE ROW OF SHIPPED STATE. No plan, no feature, no gating mode, no
  plan-feature mapping, no catalogue, no master, no geography row. The setup
  changed none of them, so the teardown has nothing to restore — which is why
  this file has no "put the shipped state back" section at all, unlike
  demo-teardown.sql. The verification at the end asserts that the catalogue is
  still 4 plans / 8 mappings / JOB_POST metered, so that a mistake in either
  file shows up here instead of in the runner.

  🟢 NOTHING IN jp_mdm. The setup writes nothing there — it passes
  @SourceRequestUid to the provisioning procedure as a value, and no approval
  request is ever created.

  ⚠️ EXCEPT THAT A DEMO COULD CREATE ONE, and that case is REPORTED rather than
  guessed at. If the presenter also walked a plan change or a verification
  request, jp_mdm holds a request raised by a demo account. Deleting an
  approval trail blind is how a teardown turns into an incident, and the
  payment and receipt side of it is demo-teardown.sql's subject, which already
  does that job properly. So this script COUNTS those rows and names them at
  the end. A non-zero count is not a failure — it is an instruction.

  ----------------------------------------------------------------------------
  RE-RUNNABLE, HARMLESS TWICE, HARMLESS WITHOUT A SETUP
  ----------------------------------------------------------------------------
  Every statement is a DELETE against a set that is empty on a clean database,
  so a second run removes nothing, reports zeroes and succeeds. A database that
  never had the fixture takes the same path.

  ⚠️ ONE BATCH FROM SECTION 1 TO THE END — NO GO SEPARATORS. The counters are
  declared once and printed at the end, and a GO between those points puts
  every one of them out of scope: demo-teardown.sql's first version failed with
  six copies of Msg 137, "Must declare the scalar variable", AFTER having
  already deleted things. A teardown that half-runs and then cannot report what
  it did is worse than one that refuses to start.
==============================================================================*/

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE jp_app;
GO

/*==============================================================================
  1. WHAT TO REMOVE — resolved both ways before anything is deleted
==============================================================================*/

/*
  🔴 THE SAME CONSTANT STRINGS AS THE SETUP. If either file's strings are
  edited, they must be edited together — which is why they are spelled out here
  rather than built from a loop, so a diff shows both halves.
*/
DECLARE @reqUids TABLE (ReqUid uniqueidentifier PRIMARY KEY);

INSERT INTO @reqUids (ReqUid) VALUES
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_GOHANA'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_HISAR'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_KARNAL')));

DECLARE @jobUids TABLE (JobUid uniqueidentifier PRIMARY KEY);

INSERT INTO @jobUids (JobUid) VALUES
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_GOH_ENG'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_GOH_MAT'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_HIS_PHY'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_HIS_HIN'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_KAR_CSC'))),
    (CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_KAR_MUS')));

/*------------------------------------------------------------------------------
  The accounts. The second net, and the one that catches a half-finished setup.
------------------------------------------------------------------------------*/
DECLARE @users TABLE
(
    UserId  bigint PRIMARY KEY,
    UserUid uniqueidentifier,
    OrgUid  uniqueidentifier NULL
);

INSERT INTO @users (UserId, UserUid, OrgUid)
SELECT UserId, UserUid, OrganizationUid
  FROM jp_sso.dbo.t_sso_users
 WHERE Email LIKE 'demo.browse.%@yopmail.com';

/*
  ⚠️ NO Is_Deleted FILTER ANYWHERE IN THIS FILE'S "WHAT TO REMOVE" QUERIES. A
  soft-deleted demo account is still a demo account, still counted by the
  suites' unfiltered COUNT(*), and still the thing that has to go.
*/

/*------------------------------------------------------------------------------
  The schools — by recomputed request uid OR by a demo account's organisation.
------------------------------------------------------------------------------*/
DECLARE @schools TABLE (SchoolId bigint PRIMARY KEY, OrgUid uniqueidentifier);

INSERT INTO @schools (SchoolId, OrgUid)
SELECT s.SchoolId, s.OrganizationUid
  FROM dbo.t_app_schools s
 WHERE s.SourceRequestUid IN (SELECT ReqUid FROM @reqUids)
    OR s.OrganizationUid IN (SELECT OrgUid FROM @users WHERE OrgUid IS NOT NULL);

/* Every campus of a demo school, not only the head office the setup created. */
DECLARE @branches TABLE (BranchId bigint PRIMARY KEY);

INSERT INTO @branches (BranchId)
SELECT BranchId FROM dbo.t_app_school_branches
 WHERE SchoolId IN (SELECT SchoolId FROM @schools);

DECLARE @teachers TABLE (TeacherId bigint PRIMARY KEY);

INSERT INTO @teachers (TeacherId)
SELECT TeacherId FROM dbo.t_app_teachers
 WHERE UserUid IN (SELECT UserUid FROM @users);

/*
  The adverts — by recomputed JobUid OR because they belong to a demo school.
  The second half matters: an advert posted BY HAND during the demo, through
  the real screen, has a JobUid this file cannot know.
*/
DECLARE @jobs TABLE (JobId bigint PRIMARY KEY);

INSERT INTO @jobs (JobId)
SELECT JobId FROM dbo.t_app_jobs
 WHERE JobUid IN (SELECT JobUid FROM @jobUids)
    OR SchoolId IN (SELECT SchoolId FROM @schools);

/*
  Applications reachable from either side — a demo teacher applying to a real
  school's advert, or a real teacher applying to a demo school's advert. Both
  happen in a demo, and both have to go: the first would leave a row pointing
  at a teacher who no longer exists, the second at an advert that does not.
*/
DECLARE @apps TABLE (ApplicationId bigint PRIMARY KEY);

INSERT INTO @apps (ApplicationId)
SELECT ApplicationId FROM dbo.t_app_applications
 WHERE JobId     IN (SELECT JobId FROM @jobs)
    OR TeacherId IN (SELECT TeacherId FROM @teachers)
    OR SchoolId  IN (SELECT SchoolId FROM @schools);

/*------------------------------------------------------------------------------
  🔴 THE ORPHAN BASELINE, TAKEN BEFORE ANYTHING IS DELETED.

  The four shapes below — a campus with no school, a membership pointing at no
  account, a subscription owned by neither a school nor a teacher, a teacher
  profile with no account — are exactly what a teardown that misses a step
  leaves behind, so they have to be checked at the end.

  ⚠️ BUT THEY ARE CHECKED AS A DELTA, NOT AS AN ABSOLUTE ZERO, AND THAT IS NOT
  a softened assertion. These are database-wide shapes. A machine that already
  had one — a killed suite, a hand-deleted account, the previous demo — would
  fail this teardown for something it did not do, and a teardown that reports
  failure after a clean run is a teardown nobody will trust the next time. What
  this script is accountable for is not making a NEW one, and `after > before`
  is precisely that claim.

  🔴 The ABSOLUTE checks are the demo-row counts: zero demo accounts, zero demo
  schools, zero demo teachers, zero demo adverts. Those are this fixture's own
  rows and nothing else can account for them.
------------------------------------------------------------------------------*/
DECLARE @orphanBranch0 int = (SELECT COUNT(*) FROM dbo.t_app_school_branches b
                               WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_schools s WHERE s.SchoolId = b.SchoolId));

DECLARE @orphanMember0 int = (SELECT COUNT(*) FROM dbo.t_app_school_users su
                               WHERE NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users u WHERE u.UserUid = su.UserUid));

DECLARE @orphanSub0 int = (SELECT COUNT(*) FROM dbo.t_app_subscriptions s
                            WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_schools  x WHERE x.OrganizationUid = s.OwnerUid)
                              AND NOT EXISTS (SELECT 1 FROM dbo.t_app_teachers t WHERE t.UserUid         = s.OwnerUid));

DECLARE @orphanTeacher0 int = (SELECT COUNT(*) FROM dbo.t_app_teachers t
                                WHERE NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users u WHERE u.UserUid = t.UserUid));

/* What was found, before a single row is removed. */
DECLARE @fUsers    int = (SELECT COUNT(*) FROM @users);
DECLARE @fSchools  int = (SELECT COUNT(*) FROM @schools);
DECLARE @fTeachers int = (SELECT COUNT(*) FROM @teachers);
DECLARE @fJobs     int = (SELECT COUNT(*) FROM @jobs);
DECLARE @fApps     int = (SELECT COUNT(*) FROM @apps);

/*==============================================================================
  2. WHAT THE DEMO ITSELF CREATED — removed first, deepest leaf first

  🔴 THE ORDER IS THE REVERSE OF CREATION AND IT IS NOT NEGOTIABLE. Every
  dependency below is a real foreign key; deleting an advert before its
  applications is Msg 547 half-way through a teardown.
==============================================================================*/

DECLARE @nNotif int = 0, @nOffers int = 0, @nHist int = 0, @nApps int = 0,
        @nSaved int = 0, @nInvites int = 0, @nFeatJ int = 0, @nFeatS int = 0,
        @nModLog int = 0, @nReports int = 0, @nLedger int = 0;

/*
  Notifications: by RECIPIENT, and by the entity the notification points at.
  Both, because a demo school is notified about a demo teacher's application
  and a real admin may be notified about a demo advert being reported — the
  first is caught by recipient, the second only by RefEntityUid.
*/
DELETE FROM dbo.t_app_notifications
 WHERE RecipientUserUid IN (SELECT UserUid FROM @users)
    OR RefEntityUid IN (SELECT JobUid FROM dbo.t_app_jobs WHERE JobId IN (SELECT JobId FROM @jobs))
    OR RefEntityUid IN (SELECT SchoolUid FROM dbo.t_app_schools WHERE SchoolId IN (SELECT SchoolId FROM @schools))
    OR RefEntityUid IN (SELECT TeacherUid FROM dbo.t_app_teachers WHERE TeacherId IN (SELECT TeacherId FROM @teachers));

SET @nNotif = @@ROWCOUNT;

DELETE FROM dbo.t_app_offers
 WHERE ApplicationId IN (SELECT ApplicationId FROM @apps)
    OR TeacherId     IN (SELECT TeacherId FROM @teachers)
    OR SchoolId      IN (SELECT SchoolId FROM @schools)
    OR BranchId      IN (SELECT BranchId FROM @branches);

SET @nOffers = @@ROWCOUNT;

DELETE FROM dbo.t_app_application_status_history
 WHERE ApplicationId IN (SELECT ApplicationId FROM @apps);

SET @nHist = @@ROWCOUNT;

/*
  ⚠️ THE APPLICATION ROW IS ALSO THE CONTACT CONSENT. 024's header: a teacher's
  contact is unlocked to a school by the existence of a live application row,
  which is what fn_TeacherContactUnlocked asks. So removing the application is
  removing the consent, and there is no separate consent table to forget —
  which is worth saying, because applications-consent.mjs asserts the lock is
  back on exit and a leftover row would unlock a stranger's contact details.
*/
DELETE FROM dbo.t_app_applications
 WHERE ApplicationId IN (SELECT ApplicationId FROM @apps);

SET @nApps = @@ROWCOUNT;

DELETE FROM dbo.t_app_saved_jobs
 WHERE JobId     IN (SELECT JobId FROM @jobs)
    OR TeacherId IN (SELECT TeacherId FROM @teachers);

SET @nSaved = @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_invites
 WHERE TeacherId IN (SELECT TeacherId FROM @teachers)
    OR SchoolId  IN (SELECT SchoolId FROM @schools)
    OR BranchId  IN (SELECT BranchId FROM @branches)
    OR JobId     IN (SELECT JobId FROM @jobs);

SET @nInvites = @@ROWCOUNT;

DELETE FROM dbo.t_app_featured_jobs WHERE JobId IN (SELECT JobId FROM @jobs);
SET @nFeatJ = @@ROWCOUNT;

DELETE FROM dbo.t_app_featured_schools WHERE SchoolId IN (SELECT SchoolId FROM @schools);
SET @nFeatS = @@ROWCOUNT;

/* Append-only as a product rule, removed here with its advert — see the header. */
DELETE FROM dbo.t_app_job_moderation_log WHERE JobId IN (SELECT JobId FROM @jobs);
SET @nModLog = @@ROWCOUNT;

/*
  🔴 ReportedEntityId IS POLYMORPHIC, so it is NEVER matched without its type.
  CK_t_app_reports_EntityType allows 'JOB', 'TEACHER' and 'SCHOOL', and a demo
  job id is also some unrelated teacher's id. Matching the id alone would
  delete a real report about a real teacher, silently, and moderation data is
  the last thing a fixture should be careless with.
*/
DELETE FROM dbo.t_app_reports
 WHERE ReportedByUserUid IN (SELECT UserUid FROM @users)
    OR (ReportedEntityType = 'JOB'     AND ReportedEntityId IN (SELECT JobId FROM @jobs))
    OR (ReportedEntityType = 'SCHOOL'  AND ReportedEntityId IN (SELECT SchoolId FROM @schools))
    OR (ReportedEntityType = 'TEACHER' AND ReportedEntityId IN (SELECT TeacherId FROM @teachers));

SET @nReports = @@ROWCOUNT;

/*
  The ledger, by owner. OwnerUid is the ORGANISATION for a school and the
  account for a teacher — the same rule t_app_subscriptions.OwnerUid follows
  (020) — so both sets are needed.

  ⚠️ EXPECTED TO BE ZERO TODAY. The setup writes adverts directly and never
  consumes a JOB_POST entitlement, and TEACHER_SEARCH is BOOLEAN, which grants
  without metering. This is here for the day a gating mode changes, because the
  symptom then would be a ledger row owned by nobody.
*/
DELETE FROM dbo.t_app_feature_ledger
 WHERE OwnerUid IN (SELECT OrgUid FROM @schools)
    OR OwnerUid IN (SELECT UserUid FROM @users);

SET @nLedger = @@ROWCOUNT;

/*==============================================================================
  3. THE FIXTURE'S OWN ROWS — adverts, then teachers, then schools
==============================================================================*/

DECLARE @nJobLvl int = 0, @nJobSubj int = 0, @nJobs int = 0;

DELETE FROM dbo.t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM @jobs);
SET @nJobLvl = @@ROWCOUNT;

DELETE FROM dbo.t_app_job_subjects WHERE JobId IN (SELECT JobId FROM @jobs);
SET @nJobSubj = @@ROWCOUNT;

DELETE FROM dbo.t_app_jobs WHERE JobId IN (SELECT JobId FROM @jobs);
SET @nJobs = @@ROWCOUNT;

/*------------------------------------------------------------------------------
  The teacher profiles and every bridge hanging off them.

  ⚠️ ALL SEVEN BRIDGES, NOT THE THREE THE SETUP WROTE. t_app_teachers has a
  foreign key from skills, languages, documents and experiences as well as
  subjects, class levels and preferred locations. The setup writes three of
  them; a demo that fills a profile in writes the others, and a missed one is
  Msg 547 at the DELETE below rather than a quiet leftover.
------------------------------------------------------------------------------*/
DECLARE @nTSubj int = 0, @nTLvl int = 0, @nTLoc int = 0, @nTOther int = 0, @nTeachers int = 0;

DELETE FROM dbo.t_app_teacher_subjects WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTSubj = @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_class_levels WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTLvl = @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_preferred_locations WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTLoc = @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_skills WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTOther = @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_languages WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTOther = @nTOther + @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_documents WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTOther = @nTOther + @@ROWCOUNT;

DELETE FROM dbo.t_app_teacher_experiences WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTOther = @nTOther + @@ROWCOUNT;

DELETE FROM dbo.t_app_teachers WHERE TeacherId IN (SELECT TeacherId FROM @teachers);
SET @nTeachers = @@ROWCOUNT;

/*------------------------------------------------------------------------------
  The schools, their campuses, their memberships and their subscriptions.

  🔴 t_app_school_users CARRIES THE UserUid THAT TIES THE TWO DATABASES
  TOGETHER, so it goes before the jp_sso account below. Dropping the account
  first would leave a membership pointing at nobody — the orphan shape
  USP_FindOrphanedApprovals exists to report. second-tenant.mjs's rule.
------------------------------------------------------------------------------*/
DECLARE @nUserBranch int = 0, @nMembers int = 0, @nPhotos int = 0, @nFacil int = 0,
        @nSubs int = 0, @nBranches int = 0, @nSchools int = 0;

DELETE FROM dbo.t_app_school_user_branches
 WHERE SchoolUserId IN (SELECT SchoolUserId FROM dbo.t_app_school_users
                         WHERE SchoolId IN (SELECT SchoolId FROM @schools))
    OR BranchId IN (SELECT BranchId FROM @branches);

SET @nUserBranch = @@ROWCOUNT;

DELETE FROM dbo.t_app_school_users
 WHERE SchoolId IN (SELECT SchoolId FROM @schools)
    OR UserUid  IN (SELECT UserUid FROM @users);

SET @nMembers = @@ROWCOUNT;

DELETE FROM dbo.t_app_school_photos
 WHERE SchoolId IN (SELECT SchoolId FROM @schools) OR BranchId IN (SELECT BranchId FROM @branches);

SET @nPhotos = @@ROWCOUNT;

DELETE FROM dbo.t_app_school_facilities
 WHERE SchoolId IN (SELECT SchoolId FROM @schools) OR BranchId IN (SELECT BranchId FROM @branches);

SET @nFacil = @@ROWCOUNT;

/*
  ⚠️ SUBSCRIPTIONS KEY ON OwnerUid — THE ORGANISATION FOR A SCHOOL AND THE
  ACCOUNT FOR A TEACHER. Not SchoolId, which the table does not have.

  🔴 AND EVERY SUBSCRIPTION FOR A DEMO OWNER GOES, whatever plan it names. If
  the demo also bought a plan, the row activation wrote carries
  SourcePaymentUid and points at a real priced plan; leaving it would leave a
  subscription owned by an organisation that no longer exists, which is exactly
  the orphan demo-teardown.sql had to go back and fix. The payment and receipt
  behind it are in jp_mdm and are reported in section 5 rather than guessed at.
*/
DELETE FROM dbo.t_app_subscriptions
 WHERE OwnerUid IN (SELECT OrgUid FROM @schools)
    OR OwnerUid IN (SELECT OrgUid FROM @users WHERE OrgUid IS NOT NULL)
    OR OwnerUid IN (SELECT UserUid FROM @users);

SET @nSubs = @@ROWCOUNT;

DELETE FROM dbo.t_app_school_branches WHERE SchoolId IN (SELECT SchoolId FROM @schools);
SET @nBranches = @@ROWCOUNT;

DELETE FROM dbo.t_app_schools WHERE SchoolId IN (SELECT SchoolId FROM @schools);
SET @nSchools = @@ROWCOUNT;

/*==============================================================================
  4. THE ACCOUNTS, in jp_sso — last, and all seven satellite tables

  🔴 THE HISTORY ROW THE ACTIVATION WROTE IS PART OF THE FIXTURE (G45).
  USP_UpdateUserStatus writes t_sso_user_status_history when it approves a
  school owner; that row has a foreign key to the account and is as much the
  fixture's as the account is. second-tenant.mjs removes exactly this set, and
  this is the same set.
==============================================================================*/

DECLARE @nSsoHist int = 0, @nSsoLock int = 0, @nSsoTok int = 0, @nSsoAtt int = 0,
        @nSsoCred int = 0, @nSsoRole int = 0, @nSsoUsers int = 0;

DELETE FROM jp_sso.dbo.t_sso_user_status_history WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoHist = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_user_lockouts WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoLock = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_user_tokens WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoTok = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_user_login_attempts WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoAtt = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_user_credentials WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoCred = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_user_roles WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoRole = @@ROWCOUNT;

DELETE FROM jp_sso.dbo.t_sso_users WHERE UserId IN (SELECT UserId FROM @users);
SET @nSsoUsers = @@ROWCOUNT;

/*==============================================================================
  5. PROVE IT IS GONE, AND THAT NOTHING ELSE MOVED — the numbers, not a claim
==============================================================================*/

/*
  🔴 RE-RESOLVED FROM SCRATCH, not read from the counters above. A counter says
  what a DELETE claimed; this asks the database what is left. The first version
  of any teardown is the one that reports success it did not check.
*/
DECLARE @leftUsers int = (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users
                           WHERE Email LIKE 'demo.browse.%@yopmail.com');

DECLARE @leftSchools int = (SELECT COUNT(*) FROM dbo.t_app_schools
                             WHERE SourceRequestUid IN (SELECT ReqUid FROM @reqUids));

DECLARE @leftJobs int = (SELECT COUNT(*) FROM dbo.t_app_jobs
                          WHERE JobUid IN (SELECT JobUid FROM @jobUids));

DECLARE @leftTeachers int = (SELECT COUNT(*) FROM dbo.t_app_teachers
                              WHERE TeacherId IN (SELECT TeacherId FROM @teachers));

/*
  ⚠️ ORPHANS, WHICH IS A DIFFERENT QUESTION FROM "ARE THE DEMO ROWS GONE".
  These are the shapes a half-finished teardown leaves behind, and none of them
  is visible from a count of demo rows.

  Measured with the same four queries as the baseline in section 1, and
  compared against it rather than against zero — see that block for why.
*/
DECLARE @orphanBranch int = (SELECT COUNT(*) FROM dbo.t_app_school_branches b
                              WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_schools s WHERE s.SchoolId = b.SchoolId));

DECLARE @orphanMember int = (SELECT COUNT(*) FROM dbo.t_app_school_users su
                              WHERE NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users u WHERE u.UserUid = su.UserUid));

DECLARE @orphanSub int = (SELECT COUNT(*) FROM dbo.t_app_subscriptions s
                           WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_schools  x WHERE x.OrganizationUid = s.OwnerUid)
                             AND NOT EXISTS (SELECT 1 FROM dbo.t_app_teachers t WHERE t.UserUid         = s.OwnerUid));

DECLARE @orphanTeacher int = (SELECT COUNT(*) FROM dbo.t_app_teachers t
                               WHERE NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users u WHERE u.UserUid = t.UserUid));

/* One number for the summary line: how many orphans this run ADDED. */
DECLARE @orphansAdded int =
      CASE WHEN @orphanBranch  > @orphanBranch0  THEN @orphanBranch  - @orphanBranch0  ELSE 0 END
    + CASE WHEN @orphanMember  > @orphanMember0  THEN @orphanMember  - @orphanMember0  ELSE 0 END
    + CASE WHEN @orphanSub     > @orphanSub0     THEN @orphanSub     - @orphanSub0     ELSE 0 END
    + CASE WHEN @orphanTeacher > @orphanTeacher0 THEN @orphanTeacher - @orphanTeacher0 ELSE 0 END;

/*
  🟢 SHIPPED STATE, ASSERTED THOUGH THIS FILE NEVER TOUCHED IT. If the setup
  ever starts moving the catalogue, this is where it is caught — before the
  runner, and with a message that says which file to read.
*/
DECLARE @plans int = (SELECT COUNT(*) FROM jp_mdm.dbo.m_mdm_plans WHERE Is_Deleted = 0);
DECLARE @maps  int = (SELECT COUNT(*) FROM jp_mdm.dbo.m_mdm_plan_features WHERE Is_Deleted = 0);
DECLARE @jobPostMode int = (SELECT GatingModeId FROM jp_mdm.dbo.m_mdm_features
                             WHERE FeatureCode = 'JOB_POST' AND Is_Deleted = 0);

/* The verified-teacher count teacher-verification.mjs pins at exactly 4. */
DECLARE @verified int = (SELECT COUNT(*) FROM dbo.t_app_teachers WHERE IsVerified = 1 AND Is_Deleted = 0);

/* And G37, which the build asserts. */
DECLARE @g37 int = (SELECT COUNT(*) FROM dbo.t_app_teachers
                     WHERE IsVerified = 0 AND VerifiedByUserId IS NOT NULL);

/*
  🔴 THE NUMBER THE SIX SUITES ACTUALLY ASSERT. Unfiltered, exactly as they
  write it, so this reports the same value they will read rather than a tidier
  one. It is NOT a failure here — the database legitimately holds other
  people's adverts — but if it is non-zero after a teardown on an otherwise
  clean machine, that is the thing to look at before blaming the runner.
*/
DECLARE @allJobs int = (SELECT COUNT(*) FROM dbo.t_app_jobs);

/*
  What a demo may have raised in jp_mdm. REPORTED, NEVER DELETED — see header.
  Counted before the accounts went, by UserId, so it still resolves.
*/
DECLARE @mdmRequests int = (SELECT COUNT(*) FROM jp_mdm.dbo.t_mdm_approval_requests
                             WHERE RequestorUserId IN (SELECT UserId FROM @users)
                                OR OrganizationUid IN (SELECT OrgUid FROM @schools)
                                OR OrganizationUid IN (SELECT OrgUid FROM @users WHERE OrgUid IS NOT NULL));

PRINT '';
PRINT '  demo-browse-teardown done';
PRINT '';
PRINT '  found before deleting';
PRINT '    demo accounts        : ' + CAST(@fUsers AS varchar(8));
PRINT '    demo schools         : ' + CAST(@fSchools AS varchar(8));
PRINT '    demo teachers        : ' + CAST(@fTeachers AS varchar(8));
PRINT '    adverts at those schools : ' + CAST(@fJobs AS varchar(8));
PRINT '    applications involved    : ' + CAST(@fApps AS varchar(8));
PRINT '';
PRINT '  what the demo itself created';
PRINT '    notifications        : ' + CAST(@nNotif AS varchar(8));
PRINT '    offers               : ' + CAST(@nOffers AS varchar(8));
PRINT '    applications / history : ' + CAST(@nApps AS varchar(8)) + ' / ' + CAST(@nHist AS varchar(8));
PRINT '    saved adverts        : ' + CAST(@nSaved AS varchar(8));
PRINT '    invites              : ' + CAST(@nInvites AS varchar(8));
PRINT '    featured job/school  : ' + CAST(@nFeatJ AS varchar(8)) + ' / ' + CAST(@nFeatS AS varchar(8));
PRINT '    moderation log       : ' + CAST(@nModLog AS varchar(8));
PRINT '    reports              : ' + CAST(@nReports AS varchar(8));
PRINT '    ledger rows          : ' + CAST(@nLedger AS varchar(8)) + ' (expected 0 - nothing was ever consumed)';
PRINT '';
PRINT '  the fixture itself';
PRINT '    adverts              : ' + CAST(@nJobs AS varchar(8))
    + ' (+' + CAST(@nJobSubj AS varchar(8)) + ' subject, +' + CAST(@nJobLvl AS varchar(8)) + ' class-level rows)';
PRINT '    teachers             : ' + CAST(@nTeachers AS varchar(8))
    + ' (+' + CAST(@nTSubj AS varchar(8)) + ' subject, +' + CAST(@nTLvl AS varchar(8))
    + ' class-level, +' + CAST(@nTLoc AS varchar(8)) + ' location, +' + CAST(@nTOther AS varchar(8)) + ' other rows)';
PRINT '    schools / campuses   : ' + CAST(@nSchools AS varchar(8)) + ' / ' + CAST(@nBranches AS varchar(8));
PRINT '    memberships          : ' + CAST(@nMembers AS varchar(8)) + ' (+' + CAST(@nUserBranch AS varchar(8)) + ' campus grants)';
PRINT '    photos / facilities  : ' + CAST(@nPhotos AS varchar(8)) + ' / ' + CAST(@nFacil AS varchar(8));
PRINT '    subscriptions        : ' + CAST(@nSubs AS varchar(8));
PRINT '    jp_sso accounts      : ' + CAST(@nSsoUsers AS varchar(8))
    + ' (+' + CAST(@nSsoCred AS varchar(8)) + ' credential, +' + CAST(@nSsoRole AS varchar(8))
    + ' role, +' + CAST(@nSsoHist AS varchar(8)) + ' history, +' + CAST(@nSsoTok AS varchar(8))
    + ' token, +' + CAST(@nSsoAtt AS varchar(8)) + ' attempt, +' + CAST(@nSsoLock AS varchar(8)) + ' lockout rows)';
PRINT '';
PRINT '  nothing left behind';
PRINT '    demo accounts left   : ' + CAST(@leftUsers AS varchar(8)) + ' (must be 0)';
PRINT '    demo schools left    : ' + CAST(@leftSchools AS varchar(8)) + ' (must be 0)';
PRINT '    demo teachers left   : ' + CAST(@leftTeachers AS varchar(8)) + ' (must be 0)';
PRINT '    demo adverts left    : ' + CAST(@leftJobs AS varchar(8)) + ' (must be 0)';
PRINT '';
PRINT '  orphans, before -> after (this run must not ADD one)';
PRINT '    orphaned campuses      : ' + CAST(@orphanBranch0 AS varchar(8)) + ' -> ' + CAST(@orphanBranch AS varchar(8));
PRINT '    orphaned memberships   : ' + CAST(@orphanMember0 AS varchar(8)) + ' -> ' + CAST(@orphanMember AS varchar(8));
PRINT '    orphaned subscriptions : ' + CAST(@orphanSub0 AS varchar(8)) + ' -> ' + CAST(@orphanSub AS varchar(8));
PRINT '    orphaned teachers      : ' + CAST(@orphanTeacher0 AS varchar(8)) + ' -> ' + CAST(@orphanTeacher AS varchar(8));
PRINT '    orphans ADDED by this run : ' + CAST(@orphansAdded AS varchar(8)) + ' (must be 0)';
PRINT '';
PRINT '  shipped state (this fixture never wrote any of it)';
PRINT '    plans                : ' + CAST(@plans AS varchar(8)) + ' (expected 4)';
PRINT '    plan-feature mappings: ' + CAST(@maps AS varchar(8)) + ' (expected 8)';
PRINT '    JOB_POST gating mode : ' + CAST(ISNULL(@jobPostMode, -1) AS varchar(8)) + ' (expected 3 METERED)';
PRINT '    verified teachers    : ' + CAST(@verified AS varchar(8)) + ' (expected 4 - teacher-verification pins this)';
PRINT '    G37 verifier/no badge: ' + CAST(@g37 AS varchar(8)) + ' (must be 0)';
PRINT '    t_app_jobs COUNT(*)  : ' + CAST(@allJobs AS varchar(8)) + ' - the six suites assert 0';
PRINT '';

IF @leftUsers <> 0 OR @leftSchools <> 0 OR @leftTeachers <> 0 OR @leftJobs <> 0
   OR @orphansAdded <> 0 OR @g37 <> 0
BEGIN
    RAISERROR(N'demo-browse-teardown: the fixture is NOT fully removed, or this run left a new orphan — read the numbers above. Do not commit, and do not run the suites until the demo-row counts are 0 and "orphans ADDED by this run" is 0.', 16, 1);
    RETURN;
END

/*
  ⚠️ A PRE-EXISTING ORPHAN IS REPORTED, NOT SWALLOWED. The delta above is what
  this script is accountable for; a number that was already non-zero when it
  started is somebody else's and is worth saying out loud, because it will make
  USP_FindOrphanedApprovals or a suite's own exit check look like this
  teardown's fault.
*/
IF @orphanBranch0 <> 0 OR @orphanMember0 <> 0 OR @orphanSub0 <> 0 OR @orphanTeacher0 <> 0
BEGIN
    PRINT '  *** THIS DATABASE ALREADY HELD ORPHANED ROWS BEFORE THIS TEARDOWN RAN.';
    PRINT '      campuses ' + CAST(@orphanBranch0 AS varchar(8))
        + ', memberships ' + CAST(@orphanMember0 AS varchar(8))
        + ', subscriptions ' + CAST(@orphanSub0 AS varchar(8))
        + ', teachers ' + CAST(@orphanTeacher0 AS varchar(8)) + '.';
    PRINT '      Not this fixture''s, and not removed by it - deleting rows it did';
    PRINT '      not create is how a fixture destroys somebody else''s work. Worth';
    PRINT '      clearing before the next regression, because a suite exit check';
    PRINT '      will find them and the blame will land here.';
    PRINT '';
END

IF @plans <> 4 OR @maps <> 8 OR ISNULL(@jobPostMode, -1) <> 3
BEGIN
    DECLARE @cat nvarchar(1000) =
        N'demo-browse-teardown: THE FIXTURE IS GONE BUT THE SHIPPED CATALOGUE IS WRONG — '
      + CAST(@plans AS nvarchar(10)) + N' plans (expected 4), '
      + CAST(@maps AS nvarchar(10)) + N' mappings (expected 8), JOB_POST mode '
      + CAST(ISNULL(@jobPostMode, -1) AS nvarchar(10)) + N' (expected 3). '
      + N'This fixture writes none of those, so something else did: most likely scripts/demo/demo-setup.sql is still installed (run demo-teardown.sql), or a suite was killed mid-run (scripts/verify/lib/catalogue.mjs restoreCatalogue() puts it back from 013_seed_school_plans.sql, which owns it).';

    RAISERROR('%s', 16, 1, @cat);
    RETURN;
END

IF @allJobs <> 0
BEGIN
    PRINT '  *** t_app_jobs IS NOT EMPTY, AND SIX SUITES ASSERT THAT IT IS.';
    PRINT '     The demo fixture''s own adverts are gone (0 left, above). What remains';
    PRINT '     belongs to something else - a killed suite, or real data on this';
    PRINT '     machine. applications-consent, applications-lifecycle,';
    PRINT '     applications-race, jobs-consume, jobs-lifecycle and jobs-screens';
    PRINT '     will be red until it is dealt with, and that is not this teardown''s';
    PRINT '     to remove: deleting adverts it did not create is how a fixture';
    PRINT '     destroys somebody else''s work.';
    PRINT '';
END

IF @mdmRequests <> 0
BEGIN
    PRINT '  *** THE DEMO RAISED ' + CAST(@mdmRequests AS varchar(8)) + ' APPROVAL REQUEST(S) IN jp_mdm, AND THEY ARE STILL THERE.';
    PRINT '     Deliberately not deleted. An approval trail, its payment and its';
    PRINT '     receipt are removed together or not at all, and that is what';
    PRINT '     scripts/demo/demo-teardown.sql does properly - run it if the demo';
    PRINT '     included a plan change. If it was a teacher-verification request,';
    PRINT '     action or reject it in the admin desk; the accounts it refers to no';
    PRINT '     longer exist, so USP_FindOrphanedApprovals will report it.';
    PRINT '';
END

PRINT '  The browse fixture is removed. Run node scripts/verify/run.mjs -';
PRINT '  expect 49 suites and 1987 assertions, all green.';
PRINT '';
GO
