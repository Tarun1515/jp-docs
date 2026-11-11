/*==============================================================================
  DEMO FIXTURE — THE INTELLIGENT DEFAULTS, MADE VISIBLE

  Run BEFORE a client demo of the teacher job browse. Run
  demo-browse-teardown.sql AFTER it. Never commit what this writes as seed data.

      sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-browse-setup.sql
      node scripts/demo/demo-browse-logins.mjs

  ----------------------------------------------------------------------------
  WHAT PROBLEM THIS SOLVES
  ----------------------------------------------------------------------------
  SR-3 made the teacher's job browse open already pointed at that teacher's own
  subjects, class levels, qualification and state. The feature works. It cannot
  be SEEN to work, because on this database the pre-filled filters have nothing
  to match: a teacher of English in Sonipat opens the screen, the filters go in
  correctly, and the list is empty. A demo of that is a demo of a bug.

  So this fixture seeds a market for those filters to land in: three schools in
  three Haryana districts, six live adverts, four teachers whose profiles sit at
  measured distances from them. P5's three tabs are being built in parallel; the
  rows below are shaped so that each tab can be demonstrated AND so that one
  advert can be PROVED to appear in none of them.

  ----------------------------------------------------------------------------
  🟢 THE BUILD STAYS GREEN. THE SUITES DO NOT. READ BOTH HALVES.
  ----------------------------------------------------------------------------
  🟢 run_all.sql is UNAFFECTED by this fixture, and that was designed for rather
  than hoped for. Every build guard in database/ was read before writing a line:

      011 closed-set plan guard     no plan is added — the catalogue stays the
                                    four 013 seeds
      013 catalogue assertions      no plan, feature or mapping is touched
      G37 (031)                     teachers are left IsVerified = 0 with
                                    VerifiedByUserId NULL, so "a verifier with
                                    no badge" cannot arise
      035 CK_t_app_jobs_StoredStatus  adverts are JobStatusId 2, which the
                                    constraint allows
      036 coordinate-shape guard    no coordinate is written
      012/014/015/016 geography     no geography row is added; ids are RESOLVED
                                    BY CODE, so the seeded counts cannot move
      999 cross-file guards (G22)   reads procedure source, not data

  🔴 SIX VERIFY SUITES GO RED WHILE THIS IS INSTALLED, AND IT IS THE SAME HONEST
  TRADE demo-setup.sql makes with 011. Six suites assert that t_app_jobs is
  EMPTY — not "unchanged", empty — on entry and/or exit:

      applications-consent.mjs    entry + exit   entryJobs/exitJobs === '0'
      applications-lifecycle.mjs  entry + exit   entryJobs/exitJobs === '0'
      applications-race.mjs       entry + exit   entryJobs/exitJobs === '0'
      jobs-consume.mjs            exit           jobs === '0'
      jobs-lifecycle.mjs          exit           left === '0'
      jobs-screens.mjs            exit           jobs === '0'

  Nine assertions, six suites. There is no version of this fixture that avoids
  them: the demo's whole subject is live adverts in the browse, and those
  suites' premise is that no advert exists at all. The fix is
  demo-browse-teardown.sql, every time, and then the full runner — which must
  come back to the known-good 49 suites / 1987 assertions.

  ⚠️ NOTHING ELSE WAS LEFT TO CHANCE. The other count-sensitive suites were
  checked one by one and are safe BY CONSTRUCTION, not by luck:

      admin-analytics          compares the screen against a LIVE count, so
                               both sides move together
      search-invite-screens    same shape — screen total vs the table
      teacher-search           every total is API-vs-live-count; its victim is
                               picked ORDER BY TeacherId, so it takes a seeded
                               teacher, never one of ours
      admin-desk / -screens    pick teachers ORDER BY TeacherId — the lowest
                               ids, which are seeded; ours are higher
      teacher-verification     asserts EXACTLY 4 verified teachers. Ours are
                               unverified, so they are outside that count —
                               which is the second reason the badge is left at
                               its default
      screens-3i               scopes its job count to one school by email
      applications-screens, invites, offers, notifications, funnel-e2e,
      public-contract, public-screens, sr-registration
                               all scope by their own title or name prefix

  ----------------------------------------------------------------------------
  🔴 WHY THIS IS PURE SQL, AND NOT A NODE SCRIPT DRIVING THE APIs
  ----------------------------------------------------------------------------
  The accounts are the hard part, so the decision was made there.

  second-tenant.mjs is the project's answer to "make a school that can log in",
  and everything it actually DOES is T-SQL: it EXECs the shipped procedures
  through `sqlcmd -Q`. It is written in JavaScript because it lives inside a
  JavaScript suite and has to hand a password back to it. Neither is true here:
  a fixture installed by the lead and used by a human in a browser hands nothing
  back. A Node wrapper would add a process, a second language, and that file's
  own documented hazard — "NO DOUBLE QUOTES IN ANY QUERY IN THIS FILE", because
  sqlcmd -Q takes the statement as one argument — in exchange for nothing.

  ⚠️ AND THE REAL REGISTRATION APIs WERE CONSIDERED AND REJECTED FOR THE SAME
  REASON sr-registration's chain is not reused here. Walking the live HTTP flow
  means seven registrations, a mail-drop poll per account, an OTP screen and an
  admin approval queue — to arrive at accounts whose only job is to exist. That
  chain is sr-registration.mjs's SUBJECT; here it would be ceremony with seven
  times the ways to fail, and it needs the API and the SSO running, which a
  fixture installed from a sqlcmd line does not.

  🔴 WHAT IS NOT REINVENTED: THE DEFINITION OF A SCHOOL OR A TEACHER. Every row
  below that has a shipped procedure is written BY that procedure:

      USP_RegisterSchoolUser          the pending account + its credential
      USP_UpdateUserStatus            pending -> Active, which is where
                                      SCHOOL_OWNER is granted (jp_sso 006)
      USP_ProvisionSchoolFromApproval the school, its head office, its
                                      subscription and the owner membership,
                                      in one transaction (jp_app 001)
      USP_RegisterTeacherUser         the teacher account, Active immediately,
                                      TEACHER role granted (jp_sso 001)
      USP_ProvisionTeacherProfile     the teacher row + its subscription
      USP_UpdateTeacherProfile        qualification, current city and state
      USP_SaveTeacherSubjects         the subject bridge
      USP_SaveTeacherClassLevels      the class-level bridge
      USP_SaveTeacherPreferredLocations  the preferred-location rows

  Hand-writing those would make this file a second definition of what a school
  is, and it would go stale the first time one of them learns a column — which
  is exactly what SR-3 found happening between two correct procedures.

  ⚠️ THE ONE PLACE A PROCEDURE IS DELIBERATELY BYPASSED IS THE ADVERTS, AND
  THAT IS A QUOTA DECISION. See section 6.

  ⚠️ THE CROSS-DATABASE ORCHESTRATION IS THE FIXTURE'S, NOT THE PRODUCT'S. 2.2
  forbids cross-database joins and foreign keys in the product's objects, and
  says ApprovalOrchestrationService is the only thing that crosses jp_sso and
  jp_app. This file adds no object to either database: it stands in for that
  service for the length of a demo, reading an id out of one database and
  passing it as a PARAMETER to a procedure in the other — which is the same
  shape the service uses. second-tenant.mjs established that a fixture may do
  this; nothing shipped is changed by it.

  ----------------------------------------------------------------------------
  🔴 NO PASSWORD IS WRITTEN DOWN HERE, OR ANYWHERE THIS FILE CAN REACH — G36
  ----------------------------------------------------------------------------
  The credential is not invented. The hash, salt, algorithm and iteration count
  are read out of a DONOR account's current credential row and passed to the
  shipped registration procedures, which take exactly those four values. Same
  hash, same salt, same iterations, therefore the same password — and this file
  contains no credential at all, not even a test one. security-pass.mjs
  established the trick and second-tenant.mjs documents it.

  So the demo accounts share their donor's password, and that password lives in
  ONE place: the gitignored local-accounts.md, read through
  scripts/verify/lib/accounts.mjs's `secret()`. `demo-browse-logins.mjs` beside
  this file prints the demo logins by calling `secret()` on the donors — it
  opens no database connection and holds no literal.

  ⚠️ team-contract.mjs carries a literal password. It is a known, recorded
  offender. It is NOT the pattern here and it was not touched.

  The donors are overridable, because a machine whose seed differs should not
  need this file edited:

      sqlcmd ... -v SchoolDonor="other@school.example" TeacherDonor="other@teacher.example"

  🔴 A MISSING OR CREDENTIAL-LESS DONOR IS A LOUD REFUSAL, not a silent skip.
  An INSERT..SELECT from a donor with no current credential row copies nothing,
  reports nothing, and the only symptom would be a failed login in front of a
  client. Section 2 refuses to start instead.

  ----------------------------------------------------------------------------
  🔴 EVERY GEOGRAPHY ID IS RESOLVED BY CODE AT RUNTIME. NONE IS HARDCODED.
  ----------------------------------------------------------------------------
  012_seed_haryana_geography.sql documents the id scheme — district = StateId *
  100 + n, town = StateId * 10000 + n — and that scheme is real: Haryana is
  StateId 8, so Sonipat is district 823 and Gohana is town 80139. This file
  uses NONE of those numbers.

  ⚠️ IT RESOLVES BY Code INSTEAD, AND THE REASON IS IN 012'S OWN GUARD. That
  file refuses to run if HR is not StateId 8, because "the id namespace is
  derived from the state id, so if HR is not 8 on this machine, every id below
  belongs to a different state's range". A hardcoded 80139 in a demo fixture is
  a silent version of that same bug: on a machine where 003_seed_geography.sql
  ordered the states differently, 80139 is a real town — in Punjab. The demo
  would run, and show a Haryana school in the wrong district.

  A Code cannot be wrong in that way. `HR_SONIPAT_GOHANA` is Gohana or it does
  not exist, and section 2 refuses to start if it does not exist.

  ⚠️ IN HARYANA CityId = TehsilId BY CONSTRUCTION — 012 inserts one city per
  tehsil, its headquarters town, taking the tehsil's id "so the two can always
  be read against each other". Both are resolved from the same Code here, which
  is why the tehsil is set too and costs nothing.

  ----------------------------------------------------------------------------
  ⚠️ WHAT THE TEACHERS SEE TODAY vs ONCE P4/P5 LAND — STATED, NOT IMPLIED
  ----------------------------------------------------------------------------
  Measured against the SHIPPED server before writing this. USP_BrowseJobs takes
  @SubjectIds, @ClassLevelIds, @CityId, @StateId. It does NOT take a
  qualification set and it does NOT take a tab mode — jp-teacher's browse sends
  `qualificationIds` and `mode`, and the server ignores both today.

  Its two set filters AND together (browse-sets.mjs asserts exactly that). So on
  the shipped server:

      the Gohana English teacher   sees ONE advert: the Gohana English job
      the Hisar physics teacher    sees ONE advert: the Hisar physics job
      the "might like" teacher     sees NOTHING — no advert matches her subject
      the "preferred" teacher      sees NOTHING — same reason

  🔴 THE LAST TWO ARE THE POINT, NOT A GAP. They are the BEFORE picture the
  tabs exist to fix: a profile with no strict match is today an empty screen,
  and "You might like" is the answer to it. The demo runs in that order — the
  first teacher proves the defaults land, the third proves why one tab is not
  enough. The acceptance table in the report says what each teacher must see in
  each tab once P5's server side lands.

  ----------------------------------------------------------------------------
  RE-RUNNABLE, AND NOT BY HOPING
  ----------------------------------------------------------------------------
  Running this twice changes nothing and fails nothing:

    - accounts are anchored on EMAIL. A second run gets DUPLICATE_EMAIL from
      the registration procedure, which is a Status 0 answer and not an error;
      the uids are then read back from the existing rows.
    - USP_ProvisionSchoolFromApproval is idempotent on @SourceRequestUid and
      answers ALREADY_PROVISIONED. Those uids are DERIVED from a constant
      string, so a second run computes the same ones.
    - USP_ProvisionTeacherProfile is idempotent on the account.
    - the three bridge procedures are "make the set exactly this", so they are
      idempotent by construction.
    - adverts are anchored on a DERIVED JobUid against UQ_t_app_jobs_JobUid.
    - ⚠️ LastDateToApply IS REFRESHED ON EVERY RUN, deliberately. The adverts
      are live for 90 days; after that fn_EffectiveJobStatusId calls them
      Expired and USP_BrowseJobs stops listing them (2.65 — expiry is derived,
      never stored). Re-running the setup revives the fixture instead of
      requiring a teardown first.

  ⚠️ CODES CARRY THE DEMO_BROWSE PREFIX (2.47 — a live code is forever).
  Nothing real can ever be given these codes, and teardown can find them with
  certainty. The SCHOOL NAMES say "(Demo)" on their face, for the same reason
  013 keeps "(SAMPLE PRICING)" in a plan name: a client reads the name, and
  nobody reads this comment.

  ⚠️ ONE BATCH FROM SECTION 1 TO THE END — NO GO SEPARATORS. The ids are
  declared once and asserted at the end, and a GO between those points puts
  every one of them out of scope. demo-teardown.sql records what that costs:
  six copies of Msg 137 AFTER having already written things.
==============================================================================*/

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/*------------------------------------------------------------------------------
  THE DONOR ACCOUNTS — whose credential ROW is copied, never whose password.

  ⚠️ An email address is not a secret. The password these two names resolve to
  is in local-accounts.md and is never read by this file.
------------------------------------------------------------------------------*/
:setvar SchoolDonor "principal@greenwood.edu.in"
:setvar TeacherDonor "rohit.kulkarni.86002@yopmail.com"

/*
  ⚠️ jp_app IS THE CONTEXT FOR THE WHOLE BATCH, and it has to be: a table type
  cannot be three-part-named, so `DECLARE @ids dbo.IntIdList` only compiles
  here. Everything in jp_sso and jp_mdm is fully qualified instead of switched
  to, which keeps the TVP declarations legal.
*/
USE jp_app;
GO

/*==============================================================================
  1. THE CONSTANTS, AND THE IDENTIFIERS DERIVED FROM THEM
==============================================================================*/

/*
  🔴 DERIVED, NOT MINTED. Every uid this fixture needs to choose for itself is
  an MD5 of a constant string, so:

    - a second run computes the same uid and the shipped procedure's
      ALREADY_PROVISIONED path fires instead of a duplicate;
    - TEARDOWN CAN RECOMPUTE THE EXACT PRIMARY KEYS. It does not search for a
      pattern and hope; it knows the values. That is the strongest form of
      "found with certainty" available, and it is immune to the one thing a
      name-prefix search is not — a demo in which somebody renames their school
      on screen, which would orphan a row matched on SchoolName.

  MD5 returns exactly 16 bytes, which is a uniqueidentifier.
*/
DECLARE @ReqGohana uniqueidentifier = CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_GOHANA'));
DECLARE @ReqHisar  uniqueidentifier = CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_HISAR'));
DECLARE @ReqKarnal uniqueidentifier = CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_REQ_KARNAL'));

DECLARE @Now datetime2 = SYSUTCDATETIME();

/*==============================================================================
  2. THE PREMISES — every one CHECKED, none assumed

  🔴 A FIXTURE THAT HALF-BUILT ITSELF AND SAID NOTHING would send somebody to
  read the browse API over a missing seed row. second-tenant.mjs's rule.
==============================================================================*/

DECLARE @StateId int = (SELECT StateId FROM jp_mdm.dbo.m_mdm_state
                         WHERE Code = 'HR' AND Is_Deleted = 0);

DECLARE @DistSonipat int = (SELECT DistrictId FROM jp_mdm.dbo.m_mdm_district
                             WHERE Code = 'HR_SONIPAT' AND Is_Deleted = 0);
DECLARE @DistHisar   int = (SELECT DistrictId FROM jp_mdm.dbo.m_mdm_district
                             WHERE Code = 'HR_HISAR' AND Is_Deleted = 0);
DECLARE @DistKarnal  int = (SELECT DistrictId FROM jp_mdm.dbo.m_mdm_district
                             WHERE Code = 'HR_KARNAL' AND Is_Deleted = 0);

DECLARE @CityGohana  int = (SELECT CityId FROM jp_mdm.dbo.m_mdm_city
                             WHERE Code = 'HR_SONIPAT_GOHANA' AND Is_Deleted = 0);
DECLARE @CitySonipat int = (SELECT CityId FROM jp_mdm.dbo.m_mdm_city
                             WHERE Code = 'HR_SONIPAT_SONIPAT' AND Is_Deleted = 0);
DECLARE @CityHisar   int = (SELECT CityId FROM jp_mdm.dbo.m_mdm_city
                             WHERE Code = 'HR_HISAR_HISAR' AND Is_Deleted = 0);
DECLARE @CityKarnal  int = (SELECT CityId FROM jp_mdm.dbo.m_mdm_city
                             WHERE Code = 'HR_KARNAL_KARNAL' AND Is_Deleted = 0);

/*
  ⚠️ THE TEHSILS ARE NOT IN THE REFUSAL BELOW, AND THAT IS NOT AN OVERSIGHT.
  012 builds the city table FROM the tehsil table, one city per tehsil, sharing
  the Code and the id — so a city that resolved by Code has a tehsil of the same
  Code by construction. Checking both would be checking the same row twice, and
  TehsilId is nullable on every column it lands in anyway.
*/
DECLARE @TehGohana  int = (SELECT TehsilId FROM jp_mdm.dbo.m_mdm_tehsil
                            WHERE Code = 'HR_SONIPAT_GOHANA' AND Is_Deleted = 0);
DECLARE @TehHisar   int = (SELECT TehsilId FROM jp_mdm.dbo.m_mdm_tehsil
                            WHERE Code = 'HR_HISAR_HISAR' AND Is_Deleted = 0);
DECLARE @TehKarnal  int = (SELECT TehsilId FROM jp_mdm.dbo.m_mdm_tehsil
                            WHERE Code = 'HR_KARNAL_KARNAL' AND Is_Deleted = 0);

IF @StateId IS NULL OR @DistSonipat IS NULL OR @DistHisar IS NULL OR @DistKarnal IS NULL
   OR @CityGohana IS NULL OR @CitySonipat IS NULL OR @CityHisar IS NULL OR @CityKarnal IS NULL
BEGIN
    RAISERROR(N'demo-browse-setup: the Haryana geography this fixture needs is not seeded. It resolves HR, HR_SONIPAT/HR_HISAR/HR_KARNAL and the towns HR_SONIPAT_GOHANA/HR_SONIPAT_SONIPAT/HR_HISAR_HISAR/HR_KARNAL_KARNAL by CODE, never by id. Run jp_mdm/03_seed/003_seed_geography.sql and 012_seed_haryana_geography.sql first. Nothing has been written.', 16, 1);
    RETURN;
END

/*
  The two plans. Read by code, because PlanId is IDENTITY and 008's own comment
  says the MERGE keys on PlanCode for exactly that reason.
*/
DECLARE @SchoolPlan  int = (SELECT PlanId FROM jp_mdm.dbo.m_mdm_plans
                             WHERE PlanCode = 'SCHOOL_FREE' AND Is_Deleted = 0);
DECLARE @TeacherPlan int = (SELECT PlanId FROM jp_mdm.dbo.m_mdm_plans
                             WHERE PlanCode = 'TEACHER_FREE' AND Is_Deleted = 0);

IF @SchoolPlan IS NULL OR @TeacherPlan IS NULL
BEGIN
    RAISERROR(N'demo-browse-setup: SCHOOL_FREE or TEACHER_FREE is missing. Every account starts on a plan and the provisioning procedures refuse without one. Run jp_mdm/03_seed/008_seed_plans.sql. Nothing has been written.', 16, 1);
    RETURN;
END

/*------------------------------------------------------------------------------
  THE EDUCATION AND JOB MASTERS, ALSO BY CODE.

  ⚠️ RESOLVED UP HERE, BEFORE THE FIRST WRITE, AND NOT WHERE THEY ARE USED.
  They are needed in sections 4 and 5, and the first draft of this file read
  them there — which meant a database missing one subject got three schools
  provisioned and then a refusal, so the cheapest fix was a teardown. A premise
  is checked while "nothing has been written" is still true.

  ⚠️ BY CODE FOR THE SAME REASON AS THE GEOGRAPHY. 004_seed_education.sql owns
  these and 2.7 says the client may re-label a master without a deployment; a
  Code is what survives that, a Name is not, and an id is only as stable as the
  order the seed happened to run in.
------------------------------------------------------------------------------*/
DECLARE @QBEd  int = (SELECT QualificationId FROM jp_mdm.dbo.m_mdm_qualification WHERE Code = 'B_ED'   AND Is_Deleted = 0);
DECLARE @QMSc  int = (SELECT QualificationId FROM jp_mdm.dbo.m_mdm_qualification WHERE Code = 'M_SC'   AND Is_Deleted = 0);
DECLARE @QPhd  int = (SELECT QualificationId FROM jp_mdm.dbo.m_mdm_qualification WHERE Code = 'PHD'    AND Is_Deleted = 0);
DECLARE @QBCom int = (SELECT QualificationId FROM jp_mdm.dbo.m_mdm_qualification WHERE Code = 'B_COM'  AND Is_Deleted = 0);
DECLARE @QNtt  int = (SELECT QualificationId FROM jp_mdm.dbo.m_mdm_qualification WHERE Code = 'NTT'    AND Is_Deleted = 0);

DECLARE @SEnglish int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'ENGLISH'      AND Is_Deleted = 0);
DECLARE @SMaths   int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'MATHS'        AND Is_Deleted = 0);
DECLARE @SPhysics int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'PHYSICS'      AND Is_Deleted = 0);
DECLARE @SHindi   int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'HINDI'        AND Is_Deleted = 0);
DECLARE @SCompSci int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'COMPUTER_SCI' AND Is_Deleted = 0);
DECLARE @SMusic   int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'MUSIC'        AND Is_Deleted = 0);
DECLARE @SSocial  int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'SOCIAL_STUD'  AND Is_Deleted = 0);
DECLARE @SGeog    int = (SELECT SubjectId FROM jp_mdm.dbo.m_mdm_subject WHERE Code = 'GEOGRAPHY'    AND Is_Deleted = 0);

DECLARE @ClPrePri int = (SELECT ClassLevelId FROM jp_mdm.dbo.m_mdm_class_level WHERE Code = 'PRE_PRIMARY'  AND Is_Deleted = 0);
DECLARE @ClPri    int = (SELECT ClassLevelId FROM jp_mdm.dbo.m_mdm_class_level WHERE Code = 'PRIMARY'      AND Is_Deleted = 0);
DECLARE @ClMid    int = (SELECT ClassLevelId FROM jp_mdm.dbo.m_mdm_class_level WHERE Code = 'MIDDLE'       AND Is_Deleted = 0);
DECLARE @ClSec    int = (SELECT ClassLevelId FROM jp_mdm.dbo.m_mdm_class_level WHERE Code = 'SECONDARY'    AND Is_Deleted = 0);
DECLARE @ClSrSec  int = (SELECT ClassLevelId FROM jp_mdm.dbo.m_mdm_class_level WHERE Code = 'SR_SECONDARY' AND Is_Deleted = 0);

DECLARE @DesPrt int = (SELECT DesignationId FROM jp_mdm.dbo.m_mdm_designation WHERE Code = 'PRT' AND Is_Deleted = 0);
DECLARE @DesTgt int = (SELECT DesignationId FROM jp_mdm.dbo.m_mdm_designation WHERE Code = 'TGT' AND Is_Deleted = 0);
DECLARE @DesPgt int = (SELECT DesignationId FROM jp_mdm.dbo.m_mdm_designation WHERE Code = 'PGT' AND Is_Deleted = 0);

/*
  The employment type is read rather than named, exactly as browse-sets.mjs does
  — the ids are jp_app's own and 021 owns them. t_app_jobs.EmploymentTypeId is
  NOT NULL, so an empty master is a Msg 515 half-way through section 5.
*/
DECLARE @EmpType int = (SELECT TOP (1) EmploymentTypeId FROM dbo.m_app_employment_types
                         WHERE Is_Active = 1 AND Is_Deleted = 0 ORDER BY DisplayOrder, EmploymentTypeId);

IF @QBEd IS NULL OR @QMSc IS NULL OR @QPhd IS NULL OR @QBCom IS NULL OR @QNtt IS NULL
   OR @SEnglish IS NULL OR @SMaths IS NULL OR @SPhysics IS NULL OR @SHindi IS NULL
   OR @SCompSci IS NULL OR @SMusic IS NULL OR @SSocial IS NULL OR @SGeog IS NULL
   OR @ClPrePri IS NULL OR @ClPri IS NULL OR @ClMid IS NULL OR @ClSec IS NULL OR @ClSrSec IS NULL
   OR @DesPrt IS NULL OR @DesTgt IS NULL OR @DesPgt IS NULL
BEGIN
    RAISERROR(N'demo-browse-setup: an education master this fixture resolves BY CODE is missing — a qualification (B_ED/M_SC/PHD/B_COM/NTT), a subject (ENGLISH/MATHS/PHYSICS/HINDI/COMPUTER_SCI/MUSIC/SOCIAL_STUD/GEOGRAPHY), a class level or a designation (PRT/TGT/PGT). Run jp_mdm/03_seed/004_seed_education.sql. Nothing has been written.', 16, 1);
    RETURN;
END

IF @EmpType IS NULL
BEGIN
    RAISERROR(N'demo-browse-setup: m_app_employment_types is empty, and t_app_jobs.EmploymentTypeId is NOT NULL. Run jp_app/01_tables/021_job_masters.sql. Nothing has been written.', 16, 1);
    RETURN;
END

/*
  ⚠️ THE ACTOR IS READ, NOT NAMED. USP_UpdateUserStatus refuses an actor acting
  on their own account, and hard-coding one administrator's address would be a
  second fixture dependency inside the thing that exists to remove one.
  ORDER BY UserId so it is the same administrator on every run.
*/
DECLARE @Actor bigint = (SELECT TOP (1) UserId FROM jp_sso.dbo.t_sso_users
                          WHERE UserTypeId = 1 AND StatusId = 2 AND Is_Deleted = 0
                          ORDER BY UserId);

IF @Actor IS NULL
BEGIN
    RAISERROR(N'demo-browse-setup: there is no active administrator in jp_sso to approve these registrations. USP_UpdateUserStatus needs one, and JP.Tools.SeedAdmin is the only sanctioned way to make one. Nothing has been written.', 16, 1);
    RETURN;
END

/*------------------------------------------------------------------------------
  THE DONOR CREDENTIALS — read once, into four scalars each.

  🔴 THESE ARE A HASH AND A SALT. They are not a password and they cannot be
  turned back into one. The shipped registration procedures take exactly these
  four values, which is what makes the copy possible without this file knowing
  anything.
------------------------------------------------------------------------------*/
DECLARE @SchoolHash varbinary(64), @SchoolSalt varbinary(32),
        @SchoolAlgo int, @SchoolIter int;

SELECT TOP (1)
       @SchoolHash = c.PasswordHash, @SchoolSalt = c.PasswordSalt,
       @SchoolAlgo = c.HashAlgorithmId, @SchoolIter = c.Iterations
  FROM jp_sso.dbo.t_sso_user_credentials c
  INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId
 WHERE u.Email = LOWER('$(SchoolDonor)') AND u.Is_Deleted = 0
   AND c.IsCurrent = 1 AND c.Is_Deleted = 0;

DECLARE @TeacherHash varbinary(64), @TeacherSalt varbinary(32),
        @TeacherAlgo int, @TeacherIter int;

SELECT TOP (1)
       @TeacherHash = c.PasswordHash, @TeacherSalt = c.PasswordSalt,
       @TeacherAlgo = c.HashAlgorithmId, @TeacherIter = c.Iterations
  FROM jp_sso.dbo.t_sso_user_credentials c
  INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId
 WHERE u.Email = LOWER('$(TeacherDonor)') AND u.Is_Deleted = 0
   AND c.IsCurrent = 1 AND c.Is_Deleted = 0;

IF @SchoolHash IS NULL OR @TeacherHash IS NULL
BEGIN
    DECLARE @donorMsg nvarchar(1200) =
        N'demo-browse-setup: a donor account has no current credential to copy. '
      + N'school donor $(SchoolDonor) -> ' + CASE WHEN @SchoolHash IS NULL THEN N'MISSING' ELSE N'ok' END
      + N', teacher donor $(TeacherDonor) -> ' + CASE WHEN @TeacherHash IS NULL THEN N'MISSING' ELSE N'ok' END
      + N'. The demo accounts take their password by COPYING a donor credential row (G36), so a missing donor means seven accounts nobody can log into — which is a failure discovered in front of a client. '
      + N'Point the fixture at donors this machine has: -v SchoolDonor="..." TeacherDonor="...". Nothing has been written.';

    RAISERROR('%s', 16, 1, @donorMsg);
    RETURN;
END

PRINT '';
PRINT '  demo-browse-setup';
PRINT '    state HR          : ' + CAST(@StateId AS varchar(8));
PRINT '    districts         : Sonipat ' + CAST(@DistSonipat AS varchar(8))
    + ', Hisar ' + CAST(@DistHisar AS varchar(8))
    + ', Karnal ' + CAST(@DistKarnal AS varchar(8));
PRINT '    towns             : Gohana ' + CAST(@CityGohana AS varchar(8))
    + ', Sonipat ' + CAST(@CitySonipat AS varchar(8))
    + ', Hisar ' + CAST(@CityHisar AS varchar(8))
    + ', Karnal ' + CAST(@CityKarnal AS varchar(8));
PRINT '    donors            : $(SchoolDonor) / $(TeacherDonor)';
PRINT '    approving actor   : jp_sso user ' + CAST(@Actor AS varchar(12));
PRINT '';

/*==============================================================================
  3. THE THREE SCHOOLS

  Registration -> approval -> provisioning, through the shipped procedures, for
  each of three districts.
==============================================================================*/

DECLARE @schools TABLE
(
    SchoolKey   varchar(20) PRIMARY KEY,
    Email       nvarchar(150),
    SchoolName  nvarchar(200),
    RegNo       varchar(50),
    ReqUid      uniqueidentifier,
    CityId      int,
    DistrictId  int,
    TehsilId    int,
    Area        nvarchar(200),
    Pincode     varchar(10),
    UserUid     uniqueidentifier NULL,
    OrgUid      uniqueidentifier NULL
);

INSERT INTO @schools (SchoolKey, Email, SchoolName, RegNo, ReqUid, CityId, DistrictId, TehsilId, Area, Pincode)
VALUES
    ('GOHANA', N'demo.browse.gohana@yopmail.com',
     N'Gohana Public School (Demo)',  'DEMO_BROWSE_GOHANA', @ReqGohana,
     @CityGohana, @DistSonipat, @TehGohana, N'Civil Lines', '131301'),

    ('HISAR',  N'demo.browse.hisar@yopmail.com',
     N'Hisar Modern School (Demo)',   'DEMO_BROWSE_HISAR',  @ReqHisar,
     @CityHisar,  @DistHisar,   @TehHisar,  N'Model Town',  '125001'),

    ('KARNAL', N'demo.browse.karnal@yopmail.com',
     N'Karnal Heritage School (Demo)','DEMO_BROWSE_KARNAL', @ReqKarnal,
     @CityKarnal, @DistKarnal,  @TehKarnal, N'Sector 13',   '132001');

DECLARE @key varchar(20), @email nvarchar(150), @name nvarchar(200),
        @regno varchar(50), @requid uniqueidentifier,
        @city int, @district int, @tehsil int, @area nvarchar(200), @pin varchar(10),
        @uid uniqueidentifier, @org uniqueidentifier, @userId bigint, @rv int;

DECLARE schoolCur CURSOR LOCAL FAST_FORWARD FOR
    SELECT SchoolKey, Email, SchoolName, RegNo, ReqUid, CityId, DistrictId, TehsilId, Area, Pincode
      FROM @schools ORDER BY SchoolKey;

OPEN schoolCur;
FETCH NEXT FROM schoolCur INTO @key, @email, @name, @regno, @requid, @city, @district, @tehsil, @area, @pin;

WHILE @@FETCH_STATUS = 0
BEGIN
    /* ---- 3a. the account, if it is not already there --------------------- */
    /*
      ⚠️ GUARDED RATHER THAN RELYING ON DUPLICATE_EMAIL. The procedure does
      answer DUPLICATE_EMAIL and that is harmless — but it also prints a
      Status 0 envelope, and a re-run that prints three refusals reads like
      three failures to whoever is watching the output before a demo.
    */
    IF NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users WHERE Email = @email AND Is_Deleted = 0)
        EXEC jp_sso.dbo.USP_RegisterSchoolUser
             @Email = @email,
             @PasswordHash = @SchoolHash,
             @PasswordSalt = @SchoolSalt,
             @HashAlgorithmId = @SchoolAlgo,
             @Iterations = @SchoolIter;

    /*
      🔴 READ BACK, NOT PREDICTED. USP_RegisterSchoolUser mints the UserUid and
      the OrganizationUid with NEWID() inside itself, so the fixture cannot
      choose them — the EMAIL is the anchor, and the uids are whatever the
      procedure decided. This is why teardown nets on the email as well as on
      the derived request uids.
    */
    SELECT @uid = UserUid, @org = OrganizationUid, @userId = UserId
      FROM jp_sso.dbo.t_sso_users WHERE Email = @email AND Is_Deleted = 0;

    /*
      🔴 @schools IS **NOT** UPDATED IN HERE, AND THAT IS NOT TIDINESS.

      The cursor below is reading @schools. Writing to the same table variable
      inside its own FAST_FORWARD loop is undefined behaviour in the sense that
      matters most — it is not guaranteed to be an error, so a run that happens
      to work proves nothing about the next one. The uids are written back
      set-based after the loop closes, from the accounts themselves, which is
      also the more honest source: whatever is in jp_sso is what the demo will
      sign in as.
    */

    /* ---- 3b. approve it, which is where SCHOOL_OWNER is granted ---------- */
    /*
      ⚠️ ONLY IF IT IS NOT ALREADY ACTIVE. The procedure refuses a no-op status
      change, and on a re-run every one of these is already Active.
    */
    IF EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users
                WHERE UserId = @userId AND StatusId <> 2 AND Is_Deleted = 0)
    BEGIN
        SET @rv = (SELECT [RowVersion] FROM jp_sso.dbo.t_sso_users WHERE UserId = @userId);

        EXEC jp_sso.dbo.USP_UpdateUserStatus
             @UserUid = @uid, @NewStatusId = 2, @RowVersion = @rv,
             @ActionByUserId = @Actor,
             @Remarks = N'DEMO_BROWSE fixture (scripts/demo/demo-browse-setup.sql). Removed by demo-browse-teardown.sql.';
    END

    /* ---- 3c. the school itself, with its full address -------------------- */
    /*
      🔴 THE ADDRESS GOES IN THROUGH THE PROCEDURE, which is the whole reason
      this is not an INSERT. USP_ProvisionSchoolFromApproval takes @CityId,
      @DistrictId, @StateId and @TehsilId and writes them to the school AND to
      the head-office branch in one transaction. The branch is what matters for
      the demo: USP_BrowseJobs joins t_app_school_branches, and the school's own
      "Find teachers" screen defaults from the head office's state.

      Idempotent on @SourceRequestUid — a second run answers
      ALREADY_PROVISIONED with Status 1.
    */
    EXEC dbo.USP_ProvisionSchoolFromApproval
         @SourceRequestUid = @requid,
         @OrganizationUid  = @org,
         @SchoolName       = @name,
         @RegistrationNo   = @regno,
         @ContactEmail     = @email,
         @AddressLine1     = N'A demo fixture — removed by demo-browse-teardown.sql',
         @AreaOrVillage    = @area,
         @CityId           = @city,
         @DistrictId       = @district,
         @StateId          = @StateId,
         @TehsilId         = @tehsil,
         @Pincode          = @pin,
         @PlanId           = @SchoolPlan,
         @OwnerUserUid     = @uid,
         @VerifiedByUserId = @Actor;

    FETCH NEXT FROM schoolCur INTO @key, @email, @name, @regno, @requid, @city, @district, @tehsil, @area, @pin;
END

CLOSE schoolCur;
DEALLOCATE schoolCur;

/* The uids, read back from the accounts now the cursor is closed. */
UPDATE sp
   SET sp.UserUid = u.UserUid,
       sp.OrgUid  = u.OrganizationUid
  FROM @schools sp
  INNER JOIN jp_sso.dbo.t_sso_users u ON u.Email = sp.Email AND u.Is_Deleted = 0;

/*==============================================================================
  4. THE FOUR TEACHERS

  ----------------------------------------------------------------------------
  🔴 WHY EVERY ONE OF THEM HAS A PREFERRED LOCATION, INCLUDING THE THREE THE
  "PREFERRED LOCATIONS" TAB IS NOT ABOUT
  ----------------------------------------------------------------------------
  Measured in jp-teacher's job-browse.component.ts before designing this. The
  pre-filled STATE does not come from the teacher's current city. It comes from
  their preferred locations:

      const topLocation = [...(profile.preferredLocations ?? [])]
        .sort((a, b) => a.preferenceOrder - b.preferenceOrder)[0];
      const stateId = topLocation?.stateId ?? null;

  Sorted by PreferenceOrder, and only the top one is used. A teacher with no
  preferred location has stateId null, and the location dimension of the
  "intelligent default" is simply absent — which on this fixture would look
  identical to it working, because every demo advert is in Haryana anyway.

  ⚠️ SO PreferenceOrder IS LOAD-BEARING DATA HERE, not decoration. Each teacher
  below has an explicit order 1, and the one with two locations has an explicit
  2, so "first preference" is a value in the row rather than an accident of the
  join order.
==============================================================================*/

DECLARE @teachers TABLE
(
    TKey        varchar(10) PRIMARY KEY,
    Email       nvarchar(150),
    FullName    nvarchar(150),
    QualId      int,
    CityId      int,
    AboutMe     nvarchar(400),
    UserUid     uniqueidentifier NULL,
    TeacherId   bigint NULL
);

/* The masters were resolved and asserted in section 2, before anything was written. */

INSERT INTO @teachers (TKey, Email, FullName, QualId, CityId, AboutMe)
VALUES
    /*
      T1 — THE HEADLINE. English, Gohana, Sonipat district. The teacher the
      brief is about: she opens the browse and the Gohana English advert is
      there, matched on all four dimensions.
    */
    ('T1', N'demo.browse.english.gohana@yopmail.com', N'Anjali Verma (Demo)',
     @QBEd, @CityGohana,
     N'Demo profile. English, middle and secondary, B.Ed, Gohana. Every dimension of the Gohana English advert.'),

    /*
      T2 — "MATCHES YOUR PROFILE", from a second district, so the strict tab is
      not seen to work only in Gohana. Also the SECOND teacher in Sonipat
      district, which is what the Sonipat school's "Find teachers" screen needs.
    */
    ('T2', N'demo.browse.physics.sonipat@yopmail.com', N'Rakesh Malik (Demo)',
     @QMSc, @CitySonipat,
     N'Demo profile. Physics, senior secondary, M.Sc, lives in Sonipat, first preference Hisar.'),

    /*
      T3 — "YOU MIGHT LIKE". Her subject and qualification match NO advert, and
      she holds exactly one class level. So every advert she can reach, she
      reaches on ONE dimension — and her strict tab is empty, which is the
      before-picture the loose tab exists to answer.
    */
    ('T3', N'demo.browse.loose.match@yopmail.com', N'Sunita Rani (Demo)',
     @QPhd, @CityHisar,
     N'Demo profile. Social studies and a PhD — deliberately matching no advert on subject or qualification.'),

    /*
      T4 — "PREFERRED LOCATIONS". Subject and qualification match nothing, so
      her only routes to an advert are her class level and WHERE SHE WANTS TO
      WORK. She lives in Sonipat district and prefers Hisar, which is what
      makes the tab legible: these are not jobs near her, they are jobs where
      she asked to be.
    */
    ('T4', N'demo.browse.preferred.locs@yopmail.com', N'Imran Qureshi (Demo)',
     @QBCom, @CityGohana,
     N'Demo profile. Geography and B.Com — matching no advert on subject or qualification. Prefers Hisar, then Gohana.');

/*------------------------------------------------------------------------------
  The bridges, as data rather than as repeated EXEC blocks.
------------------------------------------------------------------------------*/
DECLARE @tSubjects TABLE (TKey varchar(10), SubjectId int, PRIMARY KEY (TKey, SubjectId));

INSERT INTO @tSubjects (TKey, SubjectId) VALUES
    ('T1', @SEnglish),
    ('T2', @SPhysics),
    ('T3', @SSocial),      -- matches no advert, on purpose
    ('T4', @SGeog);        -- matches no advert, on purpose

DECLARE @tLevels TABLE (TKey varchar(10), ClassLevelId int, PRIMARY KEY (TKey, ClassLevelId));

INSERT INTO @tLevels (TKey, ClassLevelId) VALUES
    ('T1', @ClMid), ('T1', @ClSec),
    ('T2', @ClSrSec),
    ('T3', @ClSec),
    ('T4', @ClMid);

/*
  ⚠️ NOBODY PREFERS KARNAL, AND THAT IS DELIBERATE. It is one of the four
  independent reasons the Karnal music advert can be PROVED to appear in no
  tab — see section 6.
*/
DECLARE @tLocs TABLE (TKey varchar(10), CityId int, Ord int, PRIMARY KEY (TKey, Ord));

INSERT INTO @tLocs (TKey, CityId, Ord) VALUES
    ('T1', @CityGohana,  1),
    ('T2', @CityHisar,   1), ('T2', @CitySonipat, 2),
    ('T3', @CityHisar,   1),
    ('T4', @CityHisar,   1), ('T4', @CityGohana,  2);

/*------------------------------------------------------------------------------
  Build each teacher through the shipped procedures.
------------------------------------------------------------------------------*/
/*
  ⚠️ @tname IS nvarchar(150), NOT the nvarchar(200) the school loop used.
  USP_UpdateTeacherProfile and USP_ProvisionTeacherProfile both declare
  @FullName as nvarchar(150), and passing a wider variable truncates SILENTLY
  on assignment rather than erroring — so a longer demo name would reach the
  database shortened with nothing said. Matching the parameter is how that
  cannot happen.
*/
DECLARE @tkey varchar(10), @tname nvarchar(150), @tqual int, @tcity int, @tabout nvarchar(400);

DECLARE @subjectIds dbo.IntIdList;
DECLARE @levelIds   dbo.IntIdList;
DECLARE @locations  dbo.PreferredLocationList;

DECLARE teacherCur CURSOR LOCAL FAST_FORWARD FOR
    SELECT TKey, Email, FullName, QualId, CityId, AboutMe
      FROM @teachers ORDER BY TKey;

OPEN teacherCur;
FETCH NEXT FROM teacherCur INTO @tkey, @email, @tname, @tqual, @tcity, @tabout;

WHILE @@FETCH_STATUS = 0
BEGIN
    /* ---- 4a. the account: Active, TEACHER role, in one shipped call ------ */
    /*
      ⚠️ NO APPROVAL STEP, AND THAT IS THE PRODUCT RATHER THAN A SHORTCUT.
      USP_RegisterTeacherUser's own header: "Active immediately (StatusId = 2),
      no organisation, and the TEACHER role granted right away. The asymmetry
      with schools is deliberate: teacher verification is a soft badge on the
      profile, not a gate on the account (2.9)."
    */
    IF NOT EXISTS (SELECT 1 FROM jp_sso.dbo.t_sso_users WHERE Email = @email AND Is_Deleted = 0)
        EXEC jp_sso.dbo.USP_RegisterTeacherUser
             @Email = @email,
             @PasswordHash = @TeacherHash,
             @PasswordSalt = @TeacherSalt,
             @HashAlgorithmId = @TeacherAlgo,
             @Iterations = @TeacherIter;

    SELECT @uid = UserUid FROM jp_sso.dbo.t_sso_users WHERE Email = @email AND Is_Deleted = 0;

    /* ⚠️ @teachers is NOT written to in here — see the school loop's note. */

    /* ---- 4b. the jp_app profile row and its subscription ----------------- */
    /* Idempotent: answers ALREADY_PROVISIONED with Status 1 on a re-run. */
    EXEC dbo.USP_ProvisionTeacherProfile
         @UserUid = @uid, @FullName = @tname, @PlanId = @TeacherPlan;

    /* ---- 4c. qualification, current town and state ----------------------- */
    /*
      🔴 @RowVersion IS READ IMMEDIATELY BEFORE THE CALL. The procedure is
      optimistically concurrent and refuses a stale version; on a re-run the
      row has been written once already and its version has moved.

      ⚠️ CurrentCityId / CurrentStateId are what the school's "Find teachers"
      screen filters on — USP_SearchTeachers matches t.CurrentCityId and
      t.CurrentStateId, and nothing else about where a teacher is. The
      PREFERRED locations in 4e are a different fact and a different screen.
    */
    SET @rv = (SELECT [RowVersion] FROM dbo.t_app_teachers WHERE UserUid = @uid AND Is_Deleted = 0);

    EXEC dbo.USP_UpdateTeacherProfile
         @UserUid = @uid, @RowVersion = @rv, @FullName = @tname,
         @QualificationId = @tqual,
         @CurrentCityId = @tcity, @CurrentStateId = @StateId,
         @AboutMe = @tabout;

    /* ---- 4d. subjects and class levels ----------------------------------- */
    DELETE FROM @subjectIds;
    INSERT INTO @subjectIds (Id) SELECT SubjectId FROM @tSubjects WHERE TKey = @tkey;
    EXEC dbo.USP_SaveTeacherSubjects @UserUid = @uid, @SubjectIds = @subjectIds;

    DELETE FROM @levelIds;
    INSERT INTO @levelIds (Id) SELECT ClassLevelId FROM @tLevels WHERE TKey = @tkey;
    EXEC dbo.USP_SaveTeacherClassLevels @UserUid = @uid, @ClassLevelIds = @levelIds;

    /* ---- 4e. where they are willing to work ------------------------------ */
    /*
      ⚠️ StateId IS SET ON EVERY ROW, not just CityId. The column is NOT NULL
      — 016's header: "a preference with neither a state nor a city says
      nothing at all" — and the browse's pre-fill reads stateId off this row.
    */
    DELETE FROM @locations;
    INSERT INTO @locations (CityId, StateId, PreferenceOrder)
    SELECT CityId, @StateId, Ord FROM @tLocs WHERE TKey = @tkey;

    EXEC dbo.USP_SaveTeacherPreferredLocations @UserUid = @uid, @Locations = @locations;

    FETCH NEXT FROM teacherCur INTO @tkey, @email, @tname, @tqual, @tcity, @tabout;
END

CLOSE teacherCur;
DEALLOCATE teacherCur;

/*
  The uids and the teacher ids, written back now the cursor is closed — in that
  order, because the second join needs the first column to be populated.
*/
UPDATE t
   SET t.UserUid = u.UserUid
  FROM @teachers t
  INNER JOIN jp_sso.dbo.t_sso_users u ON u.Email = t.Email AND u.Is_Deleted = 0;

UPDATE t
   SET t.TeacherId = a.TeacherId
  FROM @teachers t
  INNER JOIN dbo.t_app_teachers a ON a.UserUid = t.UserUid AND a.Is_Deleted = 0;

/*==============================================================================
  5. THE SIX ADVERTS

  ----------------------------------------------------------------------------
  🔴 WRITTEN DIRECTLY, NOT THROUGH USP_SaveJob — AND THIS IS THE QUOTA ANSWER
  ----------------------------------------------------------------------------
  SR-4 made JOB_POST METERED with a quota of 1 on SCHOOL_FREE, and that is the
  product the client asked for. Two adverts per school through USP_SaveJob means
  the second one is refused, correctly, by the engine.

  ⚠️ THE ONE THING THIS FIXTURE MAY NOT DO IS RAISE THAT ALLOWANCE. Changing
  SCHOOL_FREE's quota would move shipped state that 013's exit assertions and
  the catalogue helper both pin, and the runner asserts it on entry and exit.
  Not negotiable, and not done.

  Three ways out were available:

    1. Put the demo schools on SCHOOL_UNLIMITED.  REJECTED. It changes no
       shipped plan, so it is legal — but it leaves three subscriptions off the
       free plan, and demo-teardown.sql (the OTHER fixture, which the lead also
       runs) RAISERRORs on any subscription whose PlanId is not 1 or 2. Two
       fixtures that cannot be installed together is a worse trade than this
       one. It also makes the demo dishonest: a prospect starts on the free
       plan, and the browse is what we are showing, not the pricing.

    2. Post one advert per school and show three.  REJECTED. The brief needs two
       per school in different subjects, and more to the point the whole
       demonstration is a teacher's filters selecting SOME adverts and not
       others. Six rows across three districts is the smallest set that shows a
       filter doing work.

    3. Write the rows.  CHOSEN, and it is the project's existing precedent
       rather than a new idea. browse-sets.mjs does exactly this, for exactly
       this reason, and says so: "NOT THROUGH USP_SaveJob, deliberately. That
       procedure consumes a JOB_POST entitlement, and SR-4 made the free plan's
       quota 1 — the second job would be refused and the suite would fail for a
       reason that has nothing to do with filtering. The row shape is what
       matters here, not the write path, and the write path has its own suites."

  ⚠️ AND IT HAS A SECOND BENEFIT THAT MATTERS MORE FOR A FIXTURE THAN FOR A
  SUITE: consuming an entitlement writes t_app_feature_ledger rows and moves a
  period's counter. Writing the rows directly means the entitlement engine is
  never touched, so there is nothing of its state for teardown to put back and
  no chance of putting it back wrong.

  ----------------------------------------------------------------------------
  🔴 THE ADVERT THAT MUST MATCH NOTHING, AND THE FOUR REASONS IT CANNOT
  ----------------------------------------------------------------------------
  DEMO_BROWSE_JOB_KAR_MUS — Karnal, Music, Pre-Primary, NTT. It appears in no
  tab for any of the four teachers, and it does so for four INDEPENDENT reasons,
  so the proof does not rest on one of them being right:

      subject       Music       — no demo teacher holds it
      class level   Pre-Primary — no demo teacher holds it
      qualification NTT         — no demo teacher holds it
      location      Karnal      — no demo teacher lives there, and no demo
                                  teacher has it as a preferred location

  ⚠️ IT IS STILL A LIVE, VALID, LISTABLE ADVERT. It is JobStatusId 2, inside its
  closing date, at an unsuspended school — so it appears in the UNFILTERED
  browse. That is what makes it a proof rather than a trick: "appears in no tab"
  is about the matching, not about the row being hidden.
==============================================================================*/

DECLARE @jobs TABLE
(
    JobKey      varchar(40) PRIMARY KEY,
    SchoolKey   varchar(20),
    JobUid      uniqueidentifier,
    JobTitle    nvarchar(200),
    SubjectId   int,
    QualId      int,
    DesigId     int,
    MinExpM     int,
    MaxExpM     int,
    SalMin      decimal(12, 2),
    SalMax      decimal(12, 2),
    /*
      🔴 PublishedOn IS STAGGERED ON PURPOSE. USP_BrowseJobs orders by
      PublishedOn DESC, JobId DESC. The brief asks that the Gohana English
      advert be at the TOP for its teacher, so it is the NEWEST of the six and
      the others step back an hour at a time.

      ⚠️ Among the DEMO rows. A real advert published later than the moment this
      fixture ran would outrank it, which is honest and is why the demo is run
      shortly after installing the fixture.
    */
    AgeHours    int
);

INSERT INTO @jobs (JobKey, SchoolKey, JobUid, JobTitle, SubjectId, QualId, DesigId, MinExpM, MaxExpM, SalMin, SalMax, AgeHours)
VALUES
    ('DEMO_BROWSE_JOB_GOH_ENG', 'GOHANA',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_GOH_ENG')),
     N'English Teacher — Middle and Secondary', @SEnglish, @QBEd,  @DesTgt, 24, 96,  32000, 46000, 0),

    ('DEMO_BROWSE_JOB_GOH_MAT', 'GOHANA',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_GOH_MAT')),
     N'Mathematics Teacher — Secondary and Senior Secondary', @SMaths, @QMSc, @DesPgt, 36, 120, 38000, 55000, 1),

    ('DEMO_BROWSE_JOB_HIS_PHY', 'HISAR',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_HIS_PHY')),
     N'Physics Teacher — Senior Secondary', @SPhysics, @QMSc, @DesPgt, 36, 144, 40000, 60000, 2),

    ('DEMO_BROWSE_JOB_HIS_HIN', 'HISAR',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_HIS_HIN')),
     N'Hindi Teacher — Primary and Middle', @SHindi, @QBEd, @DesPrt, 12, 72, 26000, 36000, 3),

    ('DEMO_BROWSE_JOB_KAR_CSC', 'KARNAL',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_KAR_CSC')),
     N'Computer Science Teacher — Senior Secondary', @SCompSci, @QBEd, @DesPgt, 24, 120, 36000, 52000, 4),

    /* The advert that matches nothing. Four independent reasons — see above. */
    ('DEMO_BROWSE_JOB_KAR_MUS', 'KARNAL',
     CONVERT(uniqueidentifier, HASHBYTES('MD5', 'DEMO_BROWSE_JOB_KAR_MUS')),
     N'Music Teacher — Pre-Primary', @SMusic, @QNtt, @DesPrt, 0, 48, 18000, 26000, 5);

DECLARE @jobLevels TABLE (JobKey varchar(40), ClassLevelId int, PRIMARY KEY (JobKey, ClassLevelId));

INSERT INTO @jobLevels (JobKey, ClassLevelId) VALUES
    ('DEMO_BROWSE_JOB_GOH_ENG', @ClMid),   ('DEMO_BROWSE_JOB_GOH_ENG', @ClSec),
    ('DEMO_BROWSE_JOB_GOH_MAT', @ClSec),   ('DEMO_BROWSE_JOB_GOH_MAT', @ClSrSec),
    ('DEMO_BROWSE_JOB_HIS_PHY', @ClSrSec),
    ('DEMO_BROWSE_JOB_HIS_HIN', @ClPri),   ('DEMO_BROWSE_JOB_HIS_HIN', @ClMid),
    ('DEMO_BROWSE_JOB_KAR_CSC', @ClSrSec),
    ('DEMO_BROWSE_JOB_KAR_MUS', @ClPrePri);

/*------------------------------------------------------------------------------
  5a. the adverts, insert-if-absent on the derived JobUid

  @EmpType was resolved and asserted in section 2, before the first write.
------------------------------------------------------------------------------*/
INSERT INTO dbo.t_app_jobs
    (JobUid, SchoolId, BranchId, JobTitle, SubjectId, DesignationId, QualificationId,
     EmploymentTypeId, NoOfVacancies, MinExperienceMonths, MaxExperienceMonths,
     SalaryMin, SalaryMax, IsSalaryNegotiable, CityId, StateId,
     LastDateToApply, JobDescription, JobStatusId, PublishedOn, Is_Active, Is_Deleted, CreatedOn)
SELECT
    j.JobUid, s.SchoolId, b.BranchId, j.JobTitle, j.SubjectId, j.DesigId, j.QualId,
    @EmpType, 2, j.MinExpM, j.MaxExpM,
    j.SalMin, j.SalMax, 1, sp.CityId, @StateId,
    DATEADD(day, 90, CAST(@Now AS date)),
    N'A demo advert, seeded by scripts/demo/demo-browse-setup.sql and removed by demo-browse-teardown.sql.',
    2, DATEADD(hour, -j.AgeHours, @Now), 1, 0, @Now
  FROM @jobs j
  INNER JOIN @schools sp              ON sp.SchoolKey = j.SchoolKey
  INNER JOIN dbo.t_app_schools s      ON s.SourceRequestUid = sp.ReqUid AND s.Is_Deleted = 0
  /*
    ⚠️ THE HEAD OFFICE, NOT "a branch". BranchId is never nullable on an advert
    (022) and the head office is the one USP_ProvisionSchoolFromApproval
    created with this school's address — which is the address the browse shows.
  */
  INNER JOIN dbo.t_app_school_branches b
          ON b.SchoolId = s.SchoolId AND b.IsHeadOffice = 1 AND b.Is_Deleted = 0
 WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_jobs x
                    WHERE x.JobUid = j.JobUid AND x.Is_Deleted = 0);

/*
  ⚠️ AND REFRESHED, which is what makes a re-run useful rather than merely
  harmless. An advert whose LastDateToApply has passed is Expired by derivation
  (2.65) and USP_BrowseJobs stops listing it — so a fixture installed three
  months ago would be invisible with nothing to say why.
*/
UPDATE x
   SET x.LastDateToApply = DATEADD(day, 90, CAST(@Now AS date)),
       x.JobStatusId     = 2,
       x.Is_Active       = 1,
       x.PublishedOn     = DATEADD(hour, -j.AgeHours, @Now),
       x.ModifiedOn      = @Now
  FROM dbo.t_app_jobs x
  INNER JOIN @jobs j ON j.JobUid = x.JobUid
 WHERE x.Is_Deleted = 0;

/*------------------------------------------------------------------------------
  5b. the subject and class-level bridges

  ⚠️ THE PRIMARY SubjectId COLUMN **AND** A BRIDGE ROW FOR IT. USP_BrowseJobs
  matches a teacher's subject set against "j.SubjectId OR the bridge", and
  USP_SaveJob writes both — so an advert with only the column would match the
  set filter but show an empty subject list on its own detail screen.
------------------------------------------------------------------------------*/
INSERT INTO dbo.t_app_job_subjects (JobId, SubjectId, Is_Active, Is_Deleted, CreatedOn)
SELECT x.JobId, j.SubjectId, 1, 0, @Now
  FROM @jobs j
  INNER JOIN dbo.t_app_jobs x ON x.JobUid = j.JobUid AND x.Is_Deleted = 0
 WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_job_subjects js
                    WHERE js.JobId = x.JobId AND js.SubjectId = j.SubjectId AND js.Is_Deleted = 0);

INSERT INTO dbo.t_app_job_class_levels (JobId, ClassLevelId, Is_Active, Is_Deleted, CreatedOn)
SELECT x.JobId, jl.ClassLevelId, 1, 0, @Now
  FROM @jobLevels jl
  INNER JOIN @jobs j          ON j.JobKey = jl.JobKey
  INNER JOIN dbo.t_app_jobs x ON x.JobUid = j.JobUid AND x.Is_Deleted = 0
 WHERE NOT EXISTS (SELECT 1 FROM dbo.t_app_job_class_levels jc
                    WHERE jc.JobId = x.JobId AND jc.ClassLevelId = jl.ClassLevelId AND jc.Is_Deleted = 0);

/*==============================================================================
  6. WHAT LANDED — the numbers, not a claim

  🔴 READ BACK FROM THE TABLES, NOT FROM THE PROCEDURES' ENVELOPES. The
  envelopes scrolled past above; what matters is whether the rows a demo needs
  are there. A fixture that reports success it did not verify is how somebody
  ends up discovering a missing membership in front of a client.
==============================================================================*/

DECLARE @nAccounts int = (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users
                           WHERE Email LIKE 'demo.browse.%@yopmail.com' AND Is_Deleted = 0);

DECLARE @nActive int = (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users
                         WHERE Email LIKE 'demo.browse.%@yopmail.com'
                           AND StatusId = 2 AND Is_Deleted = 0);

/* Every demo account must be able to sign in, so every one needs a credential. */
DECLARE @nCreds int = (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_user_credentials c
                         INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId
                        WHERE u.Email LIKE 'demo.browse.%@yopmail.com'
                          AND c.IsCurrent = 1 AND c.Is_Deleted = 0);

/*
  And a role, or every screen is a 403 that looks like a broken product.

  🔴 COUNTED INSIDE THE SAME VALIDITY WINDOW USP_GetUserClaims APPLIES, so this
  predicts what the TOKEN will carry rather than what the table merely
  contains. A role row that exists but sits outside its ValidFrom/ValidTo
  window produces a successful login with no permissions at all — which on
  screen is a signed-in user whose every page is empty, and is the single most
  confusing way for a demo account to be broken. second-tenant.mjs makes the
  same point about the same window.
*/
DECLARE @nRoles int = (SELECT COUNT(DISTINCT u.UserId) FROM jp_sso.dbo.t_sso_users u
                         INNER JOIN jp_sso.dbo.t_sso_user_roles ur
                                 ON ur.UserId = u.UserId AND ur.Is_Deleted = 0 AND ur.Is_Active = 1
                         INNER JOIN jp_sso.dbo.t_sso_roles r
                                 ON r.RoleId = ur.RoleId AND r.Is_Deleted = 0 AND r.Is_Active = 1
                        WHERE u.Email LIKE 'demo.browse.%@yopmail.com' AND u.Is_Deleted = 0
                          AND ur.ValidFrom <= jp_sso.dbo.fn_IstToday()
                          AND (ur.ValidTo IS NULL OR ur.ValidTo >= jp_sso.dbo.fn_IstToday()));

DECLARE @nSchools int = (SELECT COUNT(*) FROM dbo.t_app_schools s
                          INNER JOIN @schools sp ON sp.ReqUid = s.SourceRequestUid
                         WHERE s.Is_Deleted = 0);

DECLARE @nBranches int = (SELECT COUNT(*) FROM dbo.t_app_school_branches b
                            INNER JOIN dbo.t_app_schools s ON s.SchoolId = b.SchoolId
                            INNER JOIN @schools sp ON sp.ReqUid = s.SourceRequestUid
                           WHERE b.IsHeadOffice = 1 AND b.Is_Deleted = 0 AND s.Is_Deleted = 0);

/*
  🔴 THE OWNER MEMBERSHIP. Without this row the scope resolver gives the owner
  nothing — every branch, advert and applicant list is empty with no error, and
  that is the failure 001's own header warns about.
*/
DECLARE @nOwners int = (SELECT COUNT(*) FROM dbo.t_app_school_users su
                          INNER JOIN dbo.t_app_schools s ON s.SchoolId = su.SchoolId
                          INNER JOIN @schools sp ON sp.ReqUid = s.SourceRequestUid
                         WHERE su.Is_Active = 1 AND su.Is_Deleted = 0 AND s.Is_Deleted = 0);

/* Three districts, not three schools in one — the brief's actual requirement. */
DECLARE @nDistricts int = (SELECT COUNT(DISTINCT s.DistrictId) FROM dbo.t_app_schools s
                             INNER JOIN @schools sp ON sp.ReqUid = s.SourceRequestUid
                            WHERE s.Is_Deleted = 0);

DECLARE @nTeachers int = (SELECT COUNT(*) FROM dbo.t_app_teachers a
                            INNER JOIN @teachers t ON t.UserUid = a.UserUid
                           WHERE a.Is_Deleted = 0);

DECLARE @nTSubj int = (SELECT COUNT(*) FROM dbo.t_app_teacher_subjects x
                         INNER JOIN @teachers t ON t.TeacherId = x.TeacherId
                        WHERE x.Is_Deleted = 0);

DECLARE @nTLvl int = (SELECT COUNT(*) FROM dbo.t_app_teacher_class_levels x
                        INNER JOIN @teachers t ON t.TeacherId = x.TeacherId
                       WHERE x.Is_Deleted = 0);

DECLARE @nTLoc int = (SELECT COUNT(*) FROM dbo.t_app_teacher_preferred_locations x
                        INNER JOIN @teachers t ON t.TeacherId = x.TeacherId
                       WHERE x.Is_Deleted = 0);

/*
  🔴 COUNTED THROUGH fn_EffectiveJobStatusId, NOT ON JobStatusId ALONE. An
  advert stored Active whose closing date has passed is Expired by derivation
  and USP_BrowseJobs will not list it — so counting the stored status would
  report six live adverts for a fixture the browse shows none of. That is the
  exact failure the refresh in 5a exists to prevent, and this is the assertion
  that would catch it.
*/
DECLARE @nLive int = (SELECT COUNT(*) FROM dbo.t_app_jobs x
                        INNER JOIN @jobs j ON j.JobUid = x.JobUid
                       WHERE x.Is_Deleted = 0 AND x.Is_Active = 1
                         AND x.JobStatusId = 2
                         AND dbo.fn_EffectiveJobStatusId(x.JobStatusId, x.LastDateToApply) = 2);

DECLARE @nJSubj int = (SELECT COUNT(*) FROM dbo.t_app_job_subjects js
                         INNER JOIN dbo.t_app_jobs x ON x.JobId = js.JobId
                         INNER JOIN @jobs j ON j.JobUid = x.JobUid
                        WHERE js.Is_Deleted = 0 AND x.Is_Deleted = 0);

DECLARE @nJLvl int = (SELECT COUNT(*) FROM dbo.t_app_job_class_levels jc
                        INNER JOIN dbo.t_app_jobs x ON x.JobId = jc.JobId
                        INNER JOIN @jobs j ON j.JobUid = x.JobUid
                       WHERE jc.Is_Deleted = 0 AND x.Is_Deleted = 0);

/* Six distinct subjects across the six adverts — the brief's "DIFFERENT subjects". */
DECLARE @nJSubjDistinct int = (SELECT COUNT(DISTINCT x.SubjectId) FROM dbo.t_app_jobs x
                                 INNER JOIN @jobs j ON j.JobUid = x.JobUid
                                WHERE x.Is_Deleted = 0);

/*
  🔴 THE HEADLINE, ASSERTED RATHER THAN ASSUMED.

  The Gohana English advert must be the one the English-in-Gohana teacher
  matches on ALL FOUR dimensions. This recomputes that from the rows — subject
  in her set, a class level in her set, her exact qualification, and her top
  preferred location's city — so a later edit to either side fails here instead
  of in front of a client.
*/
DECLARE @headline int = (
    SELECT COUNT(*)
      FROM dbo.t_app_jobs x
      INNER JOIN @jobs j ON j.JobUid = x.JobUid AND j.JobKey = 'DEMO_BROWSE_JOB_GOH_ENG'
      INNER JOIN @teachers t ON t.TKey = 'T1'
      INNER JOIN dbo.t_app_teachers a ON a.TeacherId = t.TeacherId AND a.Is_Deleted = 0
     WHERE x.Is_Deleted = 0
       AND EXISTS (SELECT 1 FROM dbo.t_app_teacher_subjects ts
                    WHERE ts.TeacherId = t.TeacherId AND ts.Is_Deleted = 0
                      AND ts.SubjectId = x.SubjectId)
       AND EXISTS (SELECT 1 FROM dbo.t_app_teacher_class_levels tc
                    INNER JOIN dbo.t_app_job_class_levels jc
                            ON jc.ClassLevelId = tc.ClassLevelId AND jc.Is_Deleted = 0
                    WHERE tc.TeacherId = t.TeacherId AND tc.Is_Deleted = 0 AND jc.JobId = x.JobId)
       AND a.QualificationId = x.QualificationId
       AND EXISTS (SELECT 1 FROM dbo.t_app_teacher_preferred_locations tl
                    WHERE tl.TeacherId = t.TeacherId AND tl.Is_Deleted = 0
                      AND tl.PreferenceOrder = 1
                      AND tl.CityId = x.CityId AND tl.StateId = x.StateId));

/*
  🔴 AND THE ADVERT THAT MUST MATCH NOTHING, PROVED THE SAME WAY — by counting
  the matches and requiring ZERO, across all four teachers and all four
  dimensions at once. "Appears in no tab" is then a measured fact rather than a
  claim in a comment.
*/
DECLARE @orphanMatches int = (
    SELECT COUNT(*)
      FROM dbo.t_app_jobs x
      INNER JOIN @jobs j ON j.JobUid = x.JobUid AND j.JobKey = 'DEMO_BROWSE_JOB_KAR_MUS'
      CROSS JOIN @teachers t
      INNER JOIN dbo.t_app_teachers a ON a.TeacherId = t.TeacherId AND a.Is_Deleted = 0
     WHERE x.Is_Deleted = 0
       AND (EXISTS (SELECT 1 FROM dbo.t_app_teacher_subjects ts
                     WHERE ts.TeacherId = t.TeacherId AND ts.Is_Deleted = 0
                       AND (ts.SubjectId = x.SubjectId
                            OR EXISTS (SELECT 1 FROM dbo.t_app_job_subjects js
                                        WHERE js.JobId = x.JobId AND js.Is_Deleted = 0
                                          AND js.SubjectId = ts.SubjectId)))
            OR EXISTS (SELECT 1 FROM dbo.t_app_teacher_class_levels tc
                        INNER JOIN dbo.t_app_job_class_levels jc
                                ON jc.ClassLevelId = tc.ClassLevelId AND jc.Is_Deleted = 0
                        WHERE tc.TeacherId = t.TeacherId AND tc.Is_Deleted = 0 AND jc.JobId = x.JobId)
            OR a.QualificationId = x.QualificationId
            OR a.CurrentCityId = x.CityId
            OR EXISTS (SELECT 1 FROM dbo.t_app_teacher_preferred_locations tl
                        WHERE tl.TeacherId = t.TeacherId AND tl.Is_Deleted = 0
                          AND tl.CityId = x.CityId)));

/* Two teachers in or near Sonipat, for the Sonipat school's "Find teachers". */
DECLARE @nSonipat int = (SELECT COUNT(*) FROM dbo.t_app_teachers a
                           INNER JOIN @teachers t ON t.TeacherId = a.TeacherId
                          WHERE a.Is_Deleted = 0 AND a.IsSuspended = 0
                            AND a.CurrentCityId IN (@CityGohana, @CitySonipat));

/*
  ⚠️ AND THE GUARD THIS FIXTURE MUST NOT TRIP, CHECKED HERE RATHER THAN
  DISCOVERED BY run_all. G37 fails the build on a teacher with a verifier and
  no badge. Nothing below writes either column, so this must be 0 — and if it
  is not, something else on this database did it and the build is already red.
*/
DECLARE @g37 int = (SELECT COUNT(*) FROM dbo.t_app_teachers
                     WHERE IsVerified = 0 AND VerifiedByUserId IS NOT NULL);

/* The shipped catalogue, untouched — the thing the runner asserts on entry. */
DECLARE @maps int = (SELECT COUNT(*) FROM jp_mdm.dbo.m_mdm_plan_features WHERE Is_Deleted = 0);
DECLARE @plans int = (SELECT COUNT(*) FROM jp_mdm.dbo.m_mdm_plans WHERE Is_Deleted = 0);
DECLARE @jobPostMode int = (SELECT GatingModeId FROM jp_mdm.dbo.m_mdm_features
                             WHERE FeatureCode = 'JOB_POST' AND Is_Deleted = 0);

/* No demo subscription may sit off the shipped shape. */
DECLARE @subsOff int = (
    SELECT COUNT(*) FROM dbo.t_app_subscriptions
     WHERE Is_Deleted = 0
       AND (OwnerUid IN (SELECT OrgUid FROM @schools) OR OwnerUid IN (SELECT UserUid FROM @teachers))
       AND (StatusId <> 1 OR Is_Active <> 1 OR EndsOn IS NOT NULL
            OR SourcePaymentUid IS NOT NULL OR PlanId NOT IN (@SchoolPlan, @TeacherPlan)));

PRINT '  accounts';
PRINT '    demo accounts       : ' + CAST(@nAccounts AS varchar(8)) + ' (expected 7)';
PRINT '      Active             : ' + CAST(@nActive AS varchar(8)) + ' (expected 7)';
PRINT '      with a credential  : ' + CAST(@nCreds AS varchar(8)) + ' (expected 7)';
PRINT '      with a role        : ' + CAST(@nRoles AS varchar(8)) + ' (expected 7)';
PRINT '';
PRINT '  schools';
PRINT '    schools             : ' + CAST(@nSchools AS varchar(8)) + ' (expected 3)';
PRINT '    head offices        : ' + CAST(@nBranches AS varchar(8)) + ' (expected 3)';
PRINT '    owner memberships   : ' + CAST(@nOwners AS varchar(8)) + ' (expected 3)';
PRINT '    distinct districts  : ' + CAST(@nDistricts AS varchar(8)) + ' (expected 3)';
PRINT '';
PRINT '  teachers';
PRINT '    teachers            : ' + CAST(@nTeachers AS varchar(8)) + ' (expected 4)';
PRINT '    subject rows        : ' + CAST(@nTSubj AS varchar(8)) + ' (expected 4)';
PRINT '    class-level rows    : ' + CAST(@nTLvl AS varchar(8)) + ' (expected 5)';
PRINT '    preferred locations : ' + CAST(@nTLoc AS varchar(8)) + ' (expected 6)';
PRINT '    in/near Sonipat     : ' + CAST(@nSonipat AS varchar(8)) + ' (expected 3, at least 2)';
PRINT '';
PRINT '  adverts';
PRINT '    LIVE by effective status : ' + CAST(@nLive AS varchar(8)) + ' (expected 6)';
PRINT '    distinct subjects        : ' + CAST(@nJSubjDistinct AS varchar(8)) + ' (expected 6)';
PRINT '    subject bridge rows      : ' + CAST(@nJSubj AS varchar(8)) + ' (expected 6)';
PRINT '    class-level bridge rows  : ' + CAST(@nJLvl AS varchar(8)) + ' (expected 9)';
PRINT '';
PRINT '  the two claims that make this a demo';
PRINT '    Gohana English matches T1 on all 4 dimensions : ' + CAST(@headline AS varchar(8)) + ' (must be 1)';
PRINT '    Karnal Music matches ANY teacher on ANY dim   : ' + CAST(@orphanMatches AS varchar(8)) + ' (must be 0)';
PRINT '';
PRINT '  shipped state, untouched';
PRINT '    plans                   : ' + CAST(@plans AS varchar(8)) + ' (expected 4)';
PRINT '    plan-feature mappings   : ' + CAST(@maps AS varchar(8)) + ' (expected 8)';
PRINT '    JOB_POST gating mode    : ' + CAST(ISNULL(@jobPostMode, -1) AS varchar(8)) + ' (expected 3)';
PRINT '    demo subs off-shipped   : ' + CAST(@subsOff AS varchar(8)) + ' (must be 0)';
PRINT '    G37 (verifier, no badge): ' + CAST(@g37 AS varchar(8)) + ' (must be 0)';
PRINT '';

IF @nAccounts <> 7 OR @nActive <> 7 OR @nCreds <> 7 OR @nRoles <> 7
   OR @nSchools <> 3 OR @nBranches <> 3 OR @nOwners <> 3 OR @nDistricts <> 3
   OR @nTeachers <> 4 OR @nTSubj <> 4 OR @nTLvl <> 5 OR @nTLoc <> 6 OR @nSonipat < 2
   OR @nLive <> 6 OR @nJSubjDistinct <> 6 OR @nJSubj <> 6 OR @nJLvl <> 9
   OR @headline <> 1 OR @orphanMatches <> 0
   OR @subsOff <> 0 OR @g37 <> 0
BEGIN
    RAISERROR(N'demo-browse-setup: THE FIXTURE IS NOT WHAT IT PROMISES — read the numbers above. Do NOT run the demo on it. Run scripts/demo/demo-browse-teardown.sql, fix what the numbers name, and install again.', 16, 1);
    RETURN;
END

/*
  ⚠️ NOT a hard failure: the catalogue is not this fixture's to own, and a
  database mid-way through another suite's run would report a different number
  here for reasons that have nothing to do with the demo. It is printed loudly
  so that a mismatch is seen before the demo rather than after it.
*/
IF @plans <> 4 OR @maps <> 8 OR ISNULL(@jobPostMode, -1) <> 3
BEGIN
    PRINT '  *** THE SHIPPED CATALOGUE IS NOT 4 PLANS / 8 MAPPINGS / JOB_POST METERED.';
    PRINT '     This fixture did not touch it - something else on this database has.';
    PRINT '     Run node scripts/verify/run.mjs jobs-consume before trusting the demo.';
    PRINT '';
END

PRINT '  demo-browse-setup done - the fixture is installed and verified.';
PRINT '';
PRINT '    Logins          : node scripts/demo/demo-browse-logins.mjs';
PRINT '    Start the demo  : sign in as demo.browse.english.gohana@yopmail.com';
PRINT '                      and open the job browse. The Gohana English advert';
PRINT '                      is the pre-filled match, and it is newest.';
PRINT '';
PRINT '  *** SIX VERIFY SUITES NOW FAIL BY DESIGN ***';
PRINT '    applications-consent, applications-lifecycle, applications-race,';
PRINT '    jobs-consume, jobs-lifecycle and jobs-screens each assert that';
PRINT '    t_app_jobs is EMPTY. run_all.sql is NOT affected - no build guard is';
PRINT '    tripped. Run scripts/demo/demo-browse-teardown.sql when the demo is';
PRINT '    over, then node scripts/verify/run.mjs to confirm 49 suites green.';
PRINT '';
GO
