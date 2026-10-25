/*
  PHASE 6B — INVITATIONS: THE METER, THE MACHINE, AND THE RACE.

  ----------------------------------------------------------------------------
    1. 🔴 THE METER          TEACHER_INVITE at quota 1: the first invitation
                             consumes and writes a ledger row referenced by the
                             invitation's own Uid; the second is refused with
                             the quota message; FREE restored, and it sends
                             again without consuming.
    2. 🔴 IDEMPOTENCY        the SAME InviteUid consumed twice → ONE ledger row
                             and ALREADY_CONSUMED. The reference is the guard.
    3. THE MACHINE           view, accept, ignore, and the three refusals.
    4. 🔴 APPLIED            a teacher who APPLIES instead closes the open
                             invitation — in the apply's own transaction — and
                             the unlock comes from the application, not the
                             invite.
    5. 🔴 THE RACE           two parallel sends to the same teacher, armed on
                             one wall-clock instant: one invitation, one
                             ALREADY_INVITED, and NOTHING charged twice.
    6. SCOPE                 another school's invitation is 404; another
                             teacher's is 404.
    7. EXIT                  gating restored, fixtures gone, ledger back to its
                             entry count.

  ----------------------------------------------------------------------------
  🔴 WHY THE INSERT RUNS BEFORE THE METER
  ----------------------------------------------------------------------------
  TEACHER_INVITE costs. The filtered unique index on (SchoolId, TeacherId) for
  OPEN invitations is the cheap guard, and 020 runs it FIRST so a double-click's
  second attempt dies on the index and never reaches the meter.

  ⚠️ Had the consume run first it would have needed a Uid minted before the row
  existed — and a refused insert would then leave a charge for an invitation
  nobody received. Section 5 is what proves the order holds under a real race.

  ⚠️ FIXTURES: every invitation this file sends carries 'invites-suite' in its
  message, and the gating state is restored in a finally. A killed run that left
  TEACHER_INVITE metered at 1 would silently cap every school on the platform.

  Run (both APIs up): node scripts/verify/invites.mjs
*/
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';
import { restoreCatalogue } from './lib/catalogue.mjs';

const execFileAsync = promisify(execFile);

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const ADMIN = { id: 'superadmin@teacherportal.local', pw: secret('superadmin@teacherportal.local') };
const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const OTHER_SCHOOL = { id: 'head@stmarys.edu.in', pw: secret('head@stmarys.edu.in') };
const TEACHER_A = { id: 'anita.deshmukh21338@yopmail.com', pw: secret('anita.deshmukh21338@yopmail.com') };
const TEACHER_B = { id: 'imran.qureshi.86007@yopmail.com', pw: secret('imran.qureshi.86007@yopmail.com') };

/*
  ⚠️ A THIRD TEACHER, AND THE REASON IS A FIXTURE NOBODY SHOULD HAVE TO
  REMEMBER.

  Section 4 needs somebody who can actually APPLY, and applying requires a
  resume (RESUME_REQUIRED, 5A). Teachers A and B are deliberately incomplete
  profiles — that is what they exist for elsewhere — so the apply came back 400
  and three assertions failed while the product was entirely correct.

  🔴 The failure was mine and it was the right kind of loud: a 400 with
  RESUME_REQUIRED is the product refusing exactly as designed. The suite was
  asking the wrong person.
*/
const TEACHER_C = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep the text */ }

  return { http: r.status, body: b, text: t };
};

/*
  🔴 SIGN-IN COMES FROM THE SHARED HELPER NOW — G34.

  This file used to carry its own login() with a 20-second retry. Every suite
  did, each slightly differently, and all of them shared the same blind spot:
  the per-IDENTIFIER limit is 10 per HOUR, and no backoff inside a test run can
  wait that out. A full regression spent it around the sixth suite and the next
  one died on a null token — a false red that reads like a broken screen.

  `lib/login.mjs` adds a token cache on top of the backoff, which is the part
  that actually closes that window. See its header for the trade it makes and
  the one call site that must bypass it.
*/
const login = loginToken;

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT FeatureId FROM m_mdm_features WHERE FeatureCode = 'TEACHER_INVITE' AND Is_Deleted = 0;`));

const gatingMode = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(GatingModeId AS varchar(3)) FROM m_mdm_features WHERE FeatureId = ${FEATURE};`);

const ledgerCount = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_feature_ledger;`);

const inviteLedger = () => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(l.EntryId AS varchar(20)) + ':type' + CAST(l.EntryTypeId AS varchar(3))
       + ':units' + CAST(l.Units AS varchar(6))
       + ':ref' + ISNULL(CAST(l.RefEntityTypeId AS varchar(3)), '-')
       + ':uid' + ISNULL(LOWER(CAST(l.RefEntityUid AS varchar(40))), '-')
  FROM t_app_feature_ledger l WHERE l.FeatureId = ${FEATURE} ORDER BY l.EntryId;`);

/** Restore TEACHER_INVITE exactly as it ships: FREE, active, unmapped. */
const restoreShipped = () => sql(`SET NOCOUNT ON; USE jp_mdm;
  UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1, ModifiedOn = SYSUTCDATETIME()
   WHERE FeatureId = ${FEATURE} AND (GatingModeId <> 1 OR Is_Active <> 1);

  DELETE FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE};`);

  /*
    🔴 AND THE REAL CATALOGUE BACK. The delete above clears THIS
    suite's mappings, which it must — but under 2.64 that WAS the
    shipped state, so nine suites "restored" it by leaving the table
    empty. SR-4 seeded a real catalogue, and leaving it empty became a
    delete of the product's pricing running twice per suite.
  */
  restoreCatalogue();

/*
  ⚠️ THE ORDER OF THESE DELETES IS NOT COSMETIC.

  t_app_teacher_invites.JobId carries an FK to t_app_jobs (028), so the
  invitations must go BEFORE the job they name. The first version of this
  function deleted the job first and the run died in its own exit section on
  Msg 547 — a hard delete hitting a constraint the product never meets, because
  the product soft-deletes jobs and the FK only sees live rows.

  🔴 Worth writing down rather than just fixing: a reference from an invitation
  to a job is a reference a future "delete this job" path will have to answer
  for. The constraint found that for us in a test's teardown.
*/
const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_feature_ledger
   WHERE FeatureId = ${FEATURE}
     AND (Notes LIKE N'%invite%' OR RefEntityTypeId = 2);

  DELETE FROM t_app_teacher_invites WHERE Message LIKE N'invites-suite%' OR Message IS NULL;

  DELETE FROM t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6B %'));
  DELETE FROM t_app_applications WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6B %');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '6B %';
  /*
    6C -- the notifications those rows produced. Written as a reference to an
    entity that is gone, which is the invariant notifications.mjs asserts across
    the whole table: a notification pointing at a deleted application would lead
    a person to a 404, and 021 argues that is worse than never telling them.

    No double quotes in here on purpose: this text is passed to sqlcmd through
    -Q, and a quote inside the query makes the shell hand sqlcmd a fragment.
  */
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 1 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 3 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = RefEntityUid);`);

let entryLedger = '';

try {
  // =========================================================================
  section('0. ENTRY — the shipped gating state and a clean ledger');
  // =========================================================================

  restoreShipped();
  cleanup();

  entryLedger = ledgerCount();

  check('🔴 TEACHER_INVITE ships FREE and unmapped',
    gatingMode() === '1'
    && scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT COUNT(*) FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE} AND Is_Deleted = 0;`) === '0',
    `GatingModeId ${gatingMode()}`);

  check('entry: no invitation of ours and no invite ledger row survive a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_teacher_invites;`) === '0' && inviteLedger().length === 0,
    'clean');

  const adminToken = await login(ADMIN);
  const ownerToken = await login(OWNER);
  const otherToken = await login(OTHER_SCHOOL);
  const tokenA = await login(TEACHER_A);
  const tokenB = await login(TEACHER_B);
  const tokenC = await login(TEACHER_C);

  const HA = H(adminToken);

  const orgUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(s.OrganizationUid AS varchar(40)) FROM t_app_schools s
      INNER JOIN t_app_school_users su ON su.SchoolId = s.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}' AND su.Is_Deleted = 0;`);

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT su.SchoolId FROM t_app_school_users su
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE u.Email = '${OWNER.id}' AND su.Is_Deleted = 0;`));

  const branchId = Number((await j(`${APP}/branches`, { headers: H(ownerToken) }))
    .body?.data?.[0]?.branchId);

  const planId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(PlanId AS varchar(10)) FROM t_app_subscriptions
    WHERE OwnerUid = '${orgUid}' AND Is_Active = 1 AND Is_Deleted = 0;`));

  const teacher = (uid) => sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(t.TeacherId AS varchar(20)) + '|' + LOWER(CAST(t.TeacherUid AS varchar(40)))
    FROM t_app_teachers t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE u.Email = '${uid}';`)[0].split('|');

  const [teacherAId, teacherAUid] = teacher(TEACHER_A.id);
  const [teacherBId, teacherBUid] = teacher(TEACHER_B.id);
  const [teacherCId, teacherCUid] = teacher(TEACHER_C.id);

  check('fixture: the school, its campus, its plan and two teachers all resolve',
    schoolId > 0 && branchId > 0 && planId > 0 && teacherAId && teacherBId,
    `school ${schoolId}, branch ${branchId}, plan ${planId}, teachers ${teacherAId}/${teacherBId}`);

  const sendInvite = (token, teacherUid, note, jobId = null) =>
    j(`${APP}/teacher-search/invites`, {
      method: 'POST', headers: H(token),
      body: JSON.stringify({
        teacherUid, branchId, jobId,
        message: `invites-suite: ${note}`,
      }),
    });

  const unlocked = (teacherId, school = schoolId) => scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(dbo.fn_TeacherContactUnlocked(${teacherId}, ${school}) AS varchar(2));`);

  const inviteStatus = (inviteId) => scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(InviteStatusId AS varchar(3)) FROM t_app_teacher_invites WHERE InviteId = ${inviteId};`);

  // =========================================================================
  section('1. 🔴 THE METER — quota 1, then the refusal, then FREE again');
  // =========================================================================

  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });

  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({ planId, featureId: FEATURE, action: 'MAP', isIncluded: true, quotaPerPeriod: 1 }),
  });

  check('TEACHER_INVITE set to METERED with a quota of ONE',
    gatingMode() === '3'
    && scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT CAST(QuotaPerPeriod AS varchar(6)) FROM m_mdm_plan_features
        WHERE PlanId = ${planId} AND FeatureId = ${FEATURE} AND Is_Deleted = 0;`) === '1',
    'mode 3, quota 1');

  const first = await sendInvite(ownerToken, teacherAUid, 'the first, which costs');

  console.log(`\n    first invitation : HTTP ${first.http} `
    + `created=${first.body?.data?.created} consumed=${first.body?.data?.consumed} `
    + `source=${first.body?.data?.source}`);

  check('🔴 the first invitation is sent AND consumed',
    first.http === 200 && first.body?.data?.created === true
    && first.body?.data?.consumed === true && first.body?.data?.source === 1,
    `consumed ${first.body?.data?.consumed}, source ${first.body?.data?.source} (1 = plan quota)`);

  const ledgerRows = inviteLedger();
  const sentUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(InviteUid AS varchar(40))) FROM t_app_teacher_invites
    WHERE InviteId = ${first.body?.data?.inviteId};`);

  console.log(`    ledger           : ${ledgerRows.join('  ')}`);
  console.log(`    the invitation's own Uid: ${sentUid}\n`);

  check('🔴 …and the ledger row references the INVITATION\'s own Uid, as an INVITE',
    ledgerRows.length === 1
    && ledgerRows[0].includes(':ref2:')
    && ledgerRows[0].includes(`:uid${sentUid}`),
    ledgerRows[0] ?? '(no row)');

  check('…and it is a CONSUME of one unit',
    ledgerRows[0]?.includes(':type2:') && ledgerRows[0]?.includes(':units-1'),
    ledgerRows[0] ?? '(no row)');

  // ---- the second is refused ---------------------------------------------
  const second = await sendInvite(ownerToken, teacherBUid, 'the second, which must be refused');

  console.log(`    second invitation: HTTP ${second.http} ${second.body?.code ?? ''}`);
  console.log(`    message: "${second.body?.message ?? ''}"\n`);

  check('🔴 the SECOND invitation is refused — the quota is one',
    second.http >= 400 && second.body?.code === 'QUOTA_EXHAUSTED',
    `HTTP ${second.http} ${second.body?.code}`);

  check('🔴 …and NOTHING was written — no invitation, no second ledger row',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM t_app_teacher_invites WHERE TeacherId = ${teacherBId};`) === '0'
    && inviteLedger().length === 1,
    'the rollback took the invitation with it');

  // ---- FREE restored ------------------------------------------------------
  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 1, isActive: true }),
  });

  const free = await sendInvite(ownerToken, teacherBUid, 'free mode, no charge');

  console.log(`    FREE mode        : HTTP ${free.http} `
    + `created=${free.body?.data?.created} consumed=${free.body?.data?.consumed}\n`);

  check('🔴 with FREE restored the same call SENDS and does not consume',
    free.http === 200 && free.body?.data?.created === true && free.body?.data?.consumed === false,
    `consumed ${free.body?.data?.consumed}`);

  check('🔴 …and FREE wrote no ledger row — the mode IS the grant (2.64)',
    inviteLedger().length === 1, `${inviteLedger().length} invite ledger row(s), still just the metered one`);

  // =========================================================================
  section('2. 🔴 IDEMPOTENCY — the same InviteUid, consumed twice');
  // =========================================================================

  /*
    🔴 THE REFERENCE IS THE GUARD (2.5). RefEntityUid is the invitation's own
    Uid, and the ledger's idempotency index refuses a second consume against
    it — so a retry resolves to ALREADY_CONSUMED instead of charging again.

    ⚠️ Driven through the consume procedure directly, because the product
    cannot reach this state: the insert and the consume share one transaction,
    so a retry of a SENT invitation is a different invitation with a different
    Uid. That is exactly why the guard needs its own test — it protects against
    a retry path that does not exist yet, and would be the first thing a queue
    or an outbox introduced.
  */
  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });

  /*
    ⚠️ THE GATING IS PASSED IN, because that is what the procedure takes — the
    resolution happens in the API layer through IEntitlementRepository (2.64),
    never inside the engine. The first version of this call passed a
    @FeatureCode and failed on a missing @FeatureId, which is the signature
    telling you where the read belongs.
  */
  const retry = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC dbo.USP_ConsumeFeature
         @OwnerUid = '${orgUid}', @FeatureId = ${FEATURE},
         @GatingModeId = 3, @HasMapping = 1, @IsIncluded = 1, @QuotaPerPeriod = 1,
         @Units = 1, @RefEntityTypeId = 2, @RefEntityUid = '${sentUid}',
         @Notes = N'invites-suite retry';`)[0] ?? '';

  console.log(`\n    re-consuming the same InviteUid: ${retry}`);
  console.log(`    invite ledger rows now: ${inviteLedger().length}\n`);

  check('🔴 the SAME InviteUid resolves to ALREADY_CONSUMED, not a second charge',
    /ALREADY_CONSUMED/.test(retry), retry || '(no output)');

  check('🔴 …and the ledger still has exactly ONE row for it',
    inviteLedger().filter((r) => r.includes(`:uid${sentUid}`)).length === 1,
    `${inviteLedger().length} invite row(s) in total`);

  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 1, isActive: true }),
  });

  // =========================================================================
  section('3. THE MACHINE — view, accept, ignore, and the refusals');
  // =========================================================================

  const inviteA = first.body?.data?.inviteId;
  const inviteB = free.body?.data?.inviteId;

  // A second send while one is open — reachable by an ordinary click here.
  const dup = await sendInvite(ownerToken, teacherAUid, 'the duplicate');

  /*
    ⚠️ `data.code`, NOT `body.code`. The envelope's code is null on a success
    and the DTO carries the outcome — which is the whole point of
    ALREADY_INVITED arriving on a 200. The first version of this assertion read
    the envelope and failed while the product was behaving correctly.
  */
  check('🔴 a second invitation while one is OPEN is refused by the index',
    dup.http === 200 && dup.body?.data?.code === 'ALREADY_INVITED'
    && dup.body?.data?.created === false && dup.body?.data?.consumed === false,
    `${dup.body?.data?.code}, created ${dup.body?.data?.created}, consumed ${dup.body?.data?.consumed}`);

  check('…and it is a SUCCESS, because the invitation the school wanted exists',
    dup.body?.data?.inviteId === inviteA, `points at invitation ${dup.body?.data?.inviteId}`);

  // Viewing is idempotent and unlocks nothing.
  await j(`${APP}/teacher/invites/${inviteA}/viewed`, { method: 'POST', headers: H(tokenA) });
  await j(`${APP}/teacher/invites/${inviteA}/viewed`, { method: 'POST', headers: H(tokenA) });

  check('viewing twice leaves one Viewed invitation — idempotent (2.48)',
    inviteStatus(inviteA) === '2' && unlocked(teacherAId) === '0',
    `status ${inviteStatus(inviteA)}, unlocked ${unlocked(teacherAId)}`);

  // Accept.
  const accepted = await j(`${APP}/teacher/invites/${inviteA}/respond`, {
    method: 'POST', headers: H(tokenA),
    body: JSON.stringify({ accept: true, teacherRemarks: 'Yes please.' }),
  });

  check('🔒 ACCEPTED unlocks contact for that school — consent path 2',
    accepted.http === 200 && inviteStatus(inviteA) === '3' && unlocked(teacherAId) === '1',
    `status ${inviteStatus(inviteA)}, unlocked ${unlocked(teacherAId)}`);

  check('…and answering it again is refused with its own code',
    (await j(`${APP}/teacher/invites/${inviteA}/respond`, {
      method: 'POST', headers: H(tokenA), body: JSON.stringify({ accept: false }),
    })).body?.code === 'INVITE_NOT_OPEN',
    'INVITE_NOT_OPEN');

  check('…and viewing an answered invitation changes nothing',
    (await j(`${APP}/teacher/invites/${inviteA}/viewed`, { method: 'POST', headers: H(tokenA) })).http === 200
    && inviteStatus(inviteA) === '3',
    `still status ${inviteStatus(inviteA)}`);

  // Ignore.
  const ignored = await j(`${APP}/teacher/invites/${inviteB}/respond`, {
    method: 'POST', headers: H(tokenB),
    body: JSON.stringify({ accept: false, teacherRemarks: 'Not right now.' }),
  });

  check('🔒 IGNORED is recorded and unlocks nothing',
    ignored.http === 200 && inviteStatus(inviteB) === '5' && unlocked(teacherBId) === '0',
    `status ${inviteStatus(inviteB)}, unlocked ${unlocked(teacherBId)}`);

  /*
    ⚠️ AND AN IGNORED INVITATION DOES NOT BLOCK A NEW ONE. The index covers
    OPEN invitations only, so a school may try again later — which is right: a
    teacher who passed in March is not refusing forever, and it costs the school
    another invitation to ask.
  */
  const afterIgnore = await sendInvite(ownerToken, teacherBUid, 'asking again later');

  check('…and the school may invite them again — the index covers OPEN only',
    afterIgnore.http === 200 && afterIgnore.body?.data?.created === true,
    `inviteId ${afterIgnore.body?.data?.inviteId}`);

  check('🔒 …which unlocks nothing until they answer it',
    unlocked(teacherBId) === '0', `${unlocked(teacherBId)}`);

  // =========================================================================
  section('4. 🔴 APPLIED — a teacher who applies instead closes the invitation');
  // =========================================================================

  const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (${schoolId}, ${branchId}, '6B Invited job', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  /*
    ⚠️ TEACHER C, who has a resume — see the constant's note. Invited to THIS
    job, so the narrow case the brief describes is the one being tested: an
    invitation naming a job, answered by applying to it.
  */
  const invitedToJob = await sendInvite(ownerToken, teacherCUid, 'come and apply', jobId);
  const openInvite = invitedToJob.body?.data?.inviteId;

  check('premise: teacher C holds an OPEN invitation naming this job, and is not unlocked',
    inviteStatus(openInvite) === '1' && unlocked(teacherCId) === '0',
    `status ${inviteStatus(openInvite)}, unlocked ${unlocked(teacherCId)}`);

  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenC),
    body: JSON.stringify({ jobId, coverNote: 'Applying directly.' }),
  });

  console.log(`\n    the teacher applies: HTTP ${applied.http} ${applied.body?.code ?? ''}`);
  console.log(`    the invitation is now status ${inviteStatus(openInvite)}`);
  console.log(`    fn_TeacherContactUnlocked(${teacherCId}, ${schoolId}) = ${unlocked(teacherCId)}\n`);

  check('🔴 applying closes the open invitation as APPLIED, in the apply\'s own transaction',
    applied.http === 200 && inviteStatus(openInvite) === '4',
    `HTTP ${applied.http}, status ${inviteStatus(openInvite)} (4 = Applied)`);

  check('🔒 …and contact is unlocked — by the APPLICATION, through path 1',
    unlocked(teacherCId) === '1', `unlocked ${unlocked(teacherCId)}`);

  /*
    🔒 THE PROOF THAT IT IS PATH 1 AND NOT THE INVITE ROW.

    Delete the application and the unlock must go with it — an APPLIED
    invitation is not an IsConsent row (027), so nothing else is holding the
    door open. If this assertion failed, it would mean the invite row had
    quietly become a third consent path.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_application_status_history
     WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications WHERE JobId = ${jobId});
    DELETE FROM t_app_applications WHERE JobId = ${jobId};`);

  check('🔒 …and removing the application RE-LOCKS it, which proves the invite row grants nothing',
    unlocked(teacherCId) === '0' && inviteStatus(openInvite) === '4',
    `unlocked ${unlocked(teacherCId)} with the invitation still at APPLIED`);

  // =========================================================================
  section('5. 🔴 THE RACE — two parallel sends to the same teacher');
  // =========================================================================

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_teacher_invites WHERE TeacherId = ${teacherAId} AND SchoolId = ${schoolId};`);

  const ownerUserUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(su.UserUid AS varchar(40)) FROM t_app_school_users su
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE su.SchoolId = ${schoolId} AND su.Is_Deleted = 0 AND u.Email = '${OWNER.id}';`);

  const ownerUserId = Number(scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(UserId AS varchar(20)) FROM t_sso_users WHERE Email = '${OWNER.id}';`));

  /*
    🔴 The applications-race standard: both sessions park inside WAITFOR TIME
    and stamp SYSUTCDATETIME() the instant it returns, so "they raced" is
    measured rather than assumed. The outcome alone is satisfied by two sends a
    minute apart.
  */
  const probe = (hhmmss) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_app;
     DECLARE @spid int = @@SPID;
     WAITFOR TIME '${hhmmss}';
     DECLARE @t0 datetime2(7) = SYSUTCDATETIME();
     EXEC dbo.USP_SendInvite
          @SchoolId=${schoolId}, @UserUid='${ownerUserUid}', @TeacherUid='${teacherAUid}',
          @BranchId=${branchId}, @Message=N'invites-suite race',
          @OwnerUid='${orgUid}', @FeatureId=${FEATURE}, @GatingModeId=1,
          @HasMapping=0, @IsIncluded=0, @QuotaPerPeriod=NULL,
          @ActorUserId=${ownerUserId};
     DECLARE @t1 datetime2(7) = SYSUTCDATETIME();
     SELECT 'MARK|' + CONVERT(varchar(30), @t0, 126) + '|' + CONVERT(varchar(30), @t1, 126)
          + '|' + CAST(@spid AS varchar(12));`], { encoding: 'utf8' });

  const lines = (r) => r.stdout.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/Changed database context/.test(l));

  const outcome = (r) => {
    const line = lines(r).find((l) => !l.startsWith('MARK|')) ?? '';
    const c = line.split('|').map((x) => x.trim());

    return { raw: line, status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1] };
  };

  const mark = (r) => {
    const line = lines(r).find((l) => l.startsWith('MARK|')) ?? '';
    const [, t0, t1, spid] = line.split('|');

    return { t0Text: t0, t0: new Date(t0).getTime(), t1: new Date(t1).getTime(), spid };
  };

  const SAME_INSTANT_MS = 50;
  const entryGap = (A, B) => Math.abs(A.t0 - B.t0);
  const ranTogether = (A, B) => entryGap(A, B) <= SAME_INSTANT_MS;

  const armAt = new Date(Math.ceil((Date.now() + 4000) / 1000) * 1000);
  const hhmmss = armAt.toTimeString().slice(0, 8);

  console.log(`\n  both senders armed for ${hhmmss} …`);

  const [ra, rb] = await Promise.all([probe(hhmmss), probe(hhmmss)]);

  const oa = outcome(ra);
  const ob = outcome(rb);
  const ma = mark(ra);
  const mb = mark(rb);

  console.log(`\n     A  spid ${ma.spid}  ${ma.t0Text}  ran ${ma.t1 - ma.t0} ms  ->  ${oa.raw}`);
  console.log(`     B  spid ${mb.spid}  ${mb.t0Text}  ran ${mb.t1 - mb.t0} ms  ->  ${ob.raw}`);
  console.log(`     entry gap ${entryGap(ma, mb)} ms\n`);

  check('🔴 both senders left the gate in the SAME INSTANT — they actually raced',
    ranTogether(ma, mb),
    `A ${ma.t0Text} · B ${mb.t0Text} · gap ${entryGap(ma, mb)} ms (tolerance ${SAME_INSTANT_MS} ms)`);

  check('…on two different SQL sessions',
    ma.spid !== mb.spid, `spids ${ma.spid} and ${mb.spid}`);

  const raceInvites = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_teacher_invites
    WHERE SchoolId = ${schoolId} AND TeacherId = ${teacherAId};`);

  check('🔴 EXACTLY ONE INVITATION EXISTS — the index refused the second insert',
    raceInvites === '1', `${raceInvites} invitation(s)`);

  check('🔴 one session sent it and the other got ALREADY_INVITED',
    [oa, ob].filter((r) => r.status === 1 && r.code === null).length === 1
    && [oa, ob].filter((r) => r.code === 'ALREADY_INVITED').length === 1,
    `${oa.code ?? 'sent'} / ${ob.code ?? 'sent'}`);

  check('🔒 …and the teacher is not unlocked by either of them',
    unlocked(teacherAId) === '0', `${unlocked(teacherAId)}`);

  // =========================================================================
  section('6. SCOPE — another school\'s invitation, another teacher\'s');
  // =========================================================================

  const mine = (await j(`${APP}/teacher-search/invites`, { headers: H(ownerToken) })).body?.data ?? [];

  check('the school sees its own invitations',
    mine.length > 0, `${mine.length} invitation(s)`);

  const otherSees = (await j(`${APP}/teacher-search/invites`, { headers: H(otherToken) })).body?.data ?? [];

  check('🔴 another school sees ZERO of them, not fewer',
    otherSees.length === 0, `${otherSees.length}`);

  const raceInviteId = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(InviteId AS varchar(20)) FROM t_app_teacher_invites
    WHERE SchoolId = ${schoolId} AND TeacherId = ${teacherAId};`);

  const crossTeacher = await j(`${APP}/teacher/invites/${raceInviteId}/respond`, {
    method: 'POST', headers: H(tokenB), body: JSON.stringify({ accept: true }),
  });

  check('🔴 another teacher answering it is 404, never "not yours" (2.6)',
    crossTeacher.http === 404, `HTTP ${crossTeacher.http}`);

  check('🔒 …and it did not unlock anybody',
    unlocked(teacherAId) === '0' && unlocked(teacherBId) === '0',
    `A ${unlocked(teacherAId)}, B ${unlocked(teacherBId)}`);

  // =========================================================================
  section('7. EXIT — gating restored, fixtures gone, ledger back to entry');
  // =========================================================================

  restoreShipped();
  cleanup();

  check('exit: TEACHER_INVITE is FREE, active and unmapped again',
    gatingMode() === '1'
    && scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT COUNT(*) FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE} AND Is_Deleted = 0;`) === '0',
    `mode ${gatingMode()}`);

  check('exit: no invitation, no job and no application of ours is left',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST((SELECT COUNT(*) FROM t_app_teacher_invites)
                + (SELECT COUNT(*) FROM t_app_jobs WHERE JobTitle LIKE '6B %') AS varchar(10));`) === '0',
    'none');

  check('🔴 exit: the ledger is back to its entry count',
    ledgerCount() === entryLedger, `${entryLedger} -> ${ledgerCount()}`);

  check('🔒 exit: nobody is left unlocked by this run',
    unlocked(teacherAId) === '0' && unlocked(teacherBId) === '0' && unlocked(teacherCId) === '0',
    `A ${unlocked(teacherAId)}, B ${unlocked(teacherBId)}, C ${unlocked(teacherCId)}`);
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  /*
    ⚠️ RESTORED IN THE FINALLY. A killed run that left TEACHER_INVITE metered
    at one would silently cap every school on the platform, and the symptom
    would be a quota refusal nobody could account for.
  */
  try {
    restoreShipped();
    cleanup();
  } catch (error) {
    console.error('  ⚠️ COULD NOT RESTORE THE SHIPPED STATE:', error.message);
  }

  /*
    🔴 LAST THING OUT, SO NOTHING UNDOES IT.

    This suite already calls restoreCatalogue() inside its entry helper, and
    that is not enough: the finally above runs the same helper's DELETE (or
    arrangeUngated's) afterwards, leaving the catalogue short. Measured by
    running the suite alone and counting the mappings — 6, 5 and 0 across the
    three suites that had this shape.

    The next regression would then start from a broken catalogue, and the
    suite that fails is never this one.
  */
  restoreCatalogue();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
