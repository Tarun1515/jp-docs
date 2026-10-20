/*
  PHASE 6A-0 — 🔴 G14'S DEBT: THE APPROVAL ENGINE ABOVE LEVEL 1.

  ----------------------------------------------------------------------------
  WHY THIS EXISTS, AND WHY IT EXISTS *BEFORE* ANY OFFER CODE
  ----------------------------------------------------------------------------
  G14 was recorded with exactly this trigger: "Inmein se koi bhi tab tak maayne
  nahi rakhta jab tak Phase 6 do-level offer approval nahi laata. Us din SAB
  maayne rakhte hain."

  The engine's level advancement WAS proven in 2C — configure two levels,
  approve level 1, and the request stays Pending with the level incremented.
  Four things were never proven, because every seeded request type configures a
  single level and so every test ever written took the same one path:

      · a REJECT at level 2      — does it reject the request, or fall back?
      · a RESUBMIT at level 2    — where does the applicant's resubmission land?
      · per-level ROLE scoping   — can a level-1 approver act at level 2?
      · CONCURRENCY at level 2   — is the optimistic check level-aware at all?

  🔴 An engine that has only ever been driven down one path is an engine you
  are assuming. Offers are about to ride it.

  ----------------------------------------------------------------------------
  ⚠️ THE FIXTURE IS ORGANISATION-SCOPED, AND THAT IS THE PRE-5b RULE APPLIED
  ----------------------------------------------------------------------------
  The obvious way to get two levels is to edit the platform default rows. That
  is what PRE-5b's calendar bomb was: a fixture sharing an owner with real data,
  green for a month and then deterministically red. So this suite never touches
  a row with OrganizationUid NULL. It inserts its OWN two-level configuration
  under a fixture OrganizationUid, submits requests carrying that id, and
  deletes only what it created — asserted on entry AND on exit, restored in a
  finally.

  Run (no APIs needed — this is the engine, not the API):
      node scripts/verify/approval-levels.mjs
*/
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVER = 'localhost\\TARUN';
const ARGS = ['-S', SERVER, '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

/*
  🔴 The fixture's own organisation. Every row this suite writes carries it, so
  "delete everything of ours" is one predicate and cannot reach real data.
*/
const FIXTURE_ORG = 'B4E1C7A2-6D30-4F51-9E88-6A00C0DE6A00';

/** TEACHER_VERIFY. An existing type, so nothing about the catalogue changes. */
const REQ_TYPE = 2;

/*
  Two DIFFERENT roles, deliberately: level scoping cannot be tested with one
  role at both levels, because every actor would pass every check.

  ⚠️ These are jp_sso.t_sso_roles ids, carried as documented constants — jp_mdm
  cannot join to them (2.2), which is the same reason the seed file inlines
  them.
*/
/*
  🔴 THREE ROLES, AND THE THIRD IS THE POINT.

  The first version used two, and the fixture org's level-2 role happened to be
  the same role as the platform default's level-1 role. That made two DIFFERENT
  properties — "the check reads this level" and "an org override replaces the
  default" — indistinguishable: one assertion passing could have meant either.

  With three, the platform default's role belongs to NEITHER of the
  organisation's levels, so refusing it can only be the override.
*/
const ROLE_SUPER_ADMIN = 1;          // the fixture org's role at level 2
const ROLE_VERIFICATION_ADMIN = 2;   // the PLATFORM default's role at level 1 — and no org level's
const ROLE_MODERATION_ADMIN = 3;     // the fixture org's role at level 1

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

// ---------------------------------------------------------------------------
// Fixture lifecycle. Entry and exit run the same statements — a killed run must
// not leave a two-level configuration behind for the next one to inherit.
// ---------------------------------------------------------------------------
const cleanup = () => sql(`SET NOCOUNT ON; USE jp_mdm;
  DELETE FROM dbo.t_mdm_request_approvals
   WHERE RequestId IN (SELECT RequestId FROM dbo.t_mdm_approval_requests
                        WHERE OrganizationUid = '${FIXTURE_ORG}');
  DELETE FROM dbo.t_mdm_teacher_registration_subjects
   WHERE RequestId IN (SELECT RequestId FROM dbo.t_mdm_approval_requests
                        WHERE OrganizationUid = '${FIXTURE_ORG}');
  DELETE FROM dbo.t_mdm_teacher_registration_details
   WHERE RequestId IN (SELECT RequestId FROM dbo.t_mdm_approval_requests
                        WHERE OrganizationUid = '${FIXTURE_ORG}');
  DELETE FROM dbo.t_mdm_approval_requests WHERE OrganizationUid = '${FIXTURE_ORG}';
  DELETE FROM dbo.t_mdm_request_levels    WHERE OrganizationUid = '${FIXTURE_ORG}';`);

/** The platform defaults, as one string. Compared on entry and on exit. */
const shippedLevels = () => sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(RequestTypeId AS varchar(3)) + ':L' + CAST(LevelNumber AS varchar(3))
       + ':final' + CAST(IsFinalLevel AS varchar(3)) + ':role' + CAST(RoleId AS varchar(5))
  FROM dbo.t_mdm_request_levels
  WHERE OrganizationUid IS NULL AND Is_Deleted = 0
  ORDER BY RequestTypeId, LevelNumber;`).join(' · ');

const errorLogCount = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT COUNT(*) FROM dbo.t_mdm_error_log;`);

/** Submit a TEACHER_VERIFY request under the fixture organisation. */
const submit = (requestorId, name) => {
  const entityUid = scalar(`SET NOCOUNT ON; SELECT CAST(NEWID() AS varchar(40));`);

  sql(`SET NOCOUNT ON; USE jp_mdm;
    EXEC dbo.USP_SubmitApprovalRequest
         @RequestTypeId = ${REQ_TYPE},
         @EntityUid = '${entityUid}',
         @RequestorUserId = ${requestorId},
         @OrganizationUid = '${FIXTURE_ORG}',
         @FullName = N'${name}', @DOB = '1990-06-15', @SubjectIds = '1,2';`);

  const row = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(RequestId AS varchar(20)) + '|' + CAST(RowVersion AS varchar(10))
    FROM dbo.t_mdm_approval_requests WHERE EntityUid = '${entityUid}' AND Is_Deleted = 0;`);

  const [id, rv] = row.split('|');

  return { id: Number(id), rv: Number(rv), entityUid };
};

const state = (requestId) => {
  const row = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(StatusId AS varchar(3)) + '|' + CAST(CurrentApprovalLevel AS varchar(3))
         + '|' + CAST(RowVersion AS varchar(10))
         + '|' + CASE WHEN CompletedOn IS NULL THEN 'open' ELSE 'completed' END
    FROM dbo.t_mdm_approval_requests WHERE RequestId = ${requestId};`);

  const [status, level, rv, completed] = row.split('|');

  return { status: Number(status), level: Number(level), rv: Number(rv), completed };
};

/** One action, returning the procedure's own Status/Code line. */
const act = (requestId, actionTypeId, userId, rowVersion, roleIds, remarks = null) => {
  const line = scalar(`SET NOCOUNT ON; USE jp_mdm;
    EXEC dbo.USP_ProcessApprovalAction
         @RequestId = ${requestId}, @ActionTypeId = ${actionTypeId},
         @ActionByUserId = ${userId}, @RowVersion = ${rowVersion},
         @ActorRoleIds = '${roleIds}'${remarks ? `, @Remarks = N'${remarks}'` : ''}
         ${actionTypeId === 2 ? ', @RejectionReasonId = 1' : ''};`);

  const c = line.split('|').map((x) => x.trim());

  return { raw: line, status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1] };
};

const trail = (requestId) => sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT 'L' + CAST(LevelNumber AS varchar(3)) + ':action' + CAST(ActionTypeId AS varchar(3))
       + ':by' + CAST(ActionByUserId AS varchar(20))
  FROM dbo.t_mdm_request_approvals WHERE RequestId = ${requestId} ORDER BY ApprovalId;`);

let entryLevels = '';
let entryErrors = '';

try {
  // =========================================================================
  section('0. ENTRY — the shipped level configuration, recorded before anything');
  // =========================================================================

  cleanup();

  entryLevels = shippedLevels();
  entryErrors = errorLogCount();

  console.log(`\n    platform defaults: ${entryLevels}\n`);

  check('🔴 every shipped request type is configured single-level, final at level 1',
    entryLevels.split(' · ').every((l) => l.includes(':L1:final1')),
    entryLevels);

  /*
    🔴 FIVE SINCE 6.5A, AND THE NUMBER MOVED FOR A REASON WORTH READING.

    Phase 6.5A seeded PLAN_CHANGE (RequestTypeId 5) — a plan-change request,
    whose single final level is SUPER_ADMIN. The point of this assertion is
    unchanged: EVERY shipped type is configured single-level, so the platform
    walks the same one path N times over, which is what G14 records and what
    6A-0 proved the engine can walk beyond.

    ⚠️ It is a COUNT rather than a list on purpose: the failure it exists to
    catch is a type arriving with no level configuration at all, which would
    make it unsubmittable. 6.5A's seed guards that from its own side too
    (011_seed_plan_change_request.sql raises if level 1 is missing), and the
    two checks are independent — this one would also catch a type added
    without touching that file.

    🔴 CHANGED IN THE SAME COMMIT AS THE SEED ROW, with the reason written
    down. A guard quietly relaxed to match new behaviour is worse than no
    guard, and this project has the rule because it has made that mistake.
  */
  check('🔴 …which is exactly why G14 exists: one path, five times over',
    entryLevels.split(' · ').length === 5, `${entryLevels.split(' · ').length} request types`);

  check('entry: no fixture level rows left over from a previous run',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT COUNT(*) FROM dbo.t_mdm_request_levels WHERE OrganizationUid = '${FIXTURE_ORG}';`) === '0',
    'clean');

  const requestor = Number(scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT TOP 1 CAST(UserId AS varchar(20)) FROM dbo.t_sso_users
    WHERE Is_Deleted = 0 AND UserTypeId = 3 ORDER BY UserId;`));

  const adminA = Number(scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT TOP 1 CAST(UserId AS varchar(20)) FROM dbo.t_sso_users
    WHERE Is_Deleted = 0 AND UserTypeId = 1 ORDER BY UserId;`));

  const adminB = adminA + 1000000; // a second actor id; the engine stores it, it does not resolve it

  check('fixture: a requestor and two distinct actor ids',
    requestor > 0 && adminA > 0 && adminB !== adminA,
    `requestor ${requestor}, actors ${adminA} and ${adminB}`);

  // =========================================================================
  section('1. A TWO-LEVEL CONFIGURATION, SCOPED TO THIS SUITE ONLY');
  // =========================================================================

  /*
    🔴 LEVEL 1's ROLE IS DELIBERATELY *NOT* THE PLATFORM DEFAULT'S.

    The default says level 1 of TEACHER_VERIFY is role 2. This override says
    role 3. That disagreement is the whole of section 4: the table's own header
    states "A row WITH an OrganizationUid overrides it for that one
    organisation", and section 4 asks whether the procedure agrees.
  */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    INSERT INTO dbo.t_mdm_request_levels
      (RequestTypeId, LevelNumber, IsFinalLevel, RoleId, OrganizationUid)
    VALUES
      (${REQ_TYPE}, 1, 0, ${ROLE_MODERATION_ADMIN}, '${FIXTURE_ORG}'),
      (${REQ_TYPE}, 2, 1, ${ROLE_SUPER_ADMIN},      '${FIXTURE_ORG}');`);

  const fixtureLevels = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT 'L' + CAST(LevelNumber AS varchar(3)) + ':final' + CAST(IsFinalLevel AS varchar(3))
         + ':role' + CAST(RoleId AS varchar(5))
    FROM dbo.t_mdm_request_levels WHERE OrganizationUid = '${FIXTURE_ORG}'
    ORDER BY LevelNumber;`);

  console.log(`\n    fixture config: ${fixtureLevels.join(' · ')}\n`);

  check('fixture: two levels, level 1 not final, different roles at each',
    fixtureLevels.length === 2
    && fixtureLevels[0] === `L1:final0:role${ROLE_MODERATION_ADMIN}`
    && fixtureLevels[1] === `L2:final1:role${ROLE_SUPER_ADMIN}`,
    fixtureLevels.join(' · '));

  check('🔴 …and the platform defaults are untouched by it',
    shippedLevels() === entryLevels, 'byte-identical to entry');

  // The premise: level 1 advances rather than completing.
  const advance = submit(requestor, 'G14 Advance');
  const advanceApprove = act(advance.id, 1, adminA, advance.rv, String(ROLE_MODERATION_ADMIN));
  const advanceState = state(advance.id);

  console.log(`    approve at level 1: ${advanceApprove.raw}`);
  console.log(`    request is now: status ${advanceState.status}, level ${advanceState.level}, ${advanceState.completed}\n`);

  check('premise: approving level 1 ADVANCES rather than completing — the config is live',
    advanceApprove.status === 1 && advanceState.status === 1 && advanceState.level === 2
    && advanceState.completed === 'open',
    `status ${advanceState.status} (Pending), level ${advanceState.level}, ${advanceState.completed}`);

  // =========================================================================
  section('2. 🔴 G14 #1 — A REJECT AT LEVEL 2');
  // =========================================================================

  /*
    The question G14 asks: does a level-2 reject kill the request, or send it
    back to level 1? The procedure sets @NewLevel = @CurrentLevel, so the
    answer is: the request is rejected outright and the level it died at is
    KEPT. That is the defensible answer — the trail has to show where the
    refusal happened — but it has never been asserted.
  */
  const rejected = act(advance.id, 2, adminB, advanceState.rv, String(ROLE_SUPER_ADMIN),
    'Certificates do not match the declared qualification');

  const rejectedState = state(advance.id);

  console.log(`    reject at level 2: ${rejected.raw}`);
  console.log(`    request is now: status ${rejectedState.status}, level ${rejectedState.level}, ${rejectedState.completed}`);
  console.log(`    trail: ${trail(advance.id).join('  ')}\n`);

  check('🔴 a level-2 reject rejects the WHOLE request — it does not fall back to level 1',
    rejected.status === 1 && rejectedState.status === 2,
    `StatusId ${rejectedState.status} (2 = Rejected)`);

  check('🔴 …and the level it died at is KEPT, so the trail says where',
    rejectedState.level === 2, `CurrentApprovalLevel ${rejectedState.level}`);

  check('…and the request is closed, with CompletedOn stamped',
    rejectedState.completed === 'completed', rejectedState.completed);

  /*
    ⚠️ THE TRAIL OPENS WITH THE SUBMISSION, not with the first approval.

    m_mdm_action_types: 1 Approve · 2 Reject · 3 RequestResubmit · 4 Submit ·
    5 Resubmit. USP_SubmitApprovalRequest writes its own action-4 row at level
    1, which is correct — "who asked for this, and when" is part of the trail —
    and the first version of this assertion did not know it. The expectation is
    the whole sequence, submission included, because a trail with a step
    missing is the failure this is written to catch.
  */
  check('🔴 …and the trail holds EVERY action, at its own level, by its own actor',
    trail(advance.id).join(' ')
      === `L1:action4:by${requestor} L1:action1:by${adminA} L2:action2:by${adminB}`,
    trail(advance.id).join('  '));

  // =========================================================================
  section('3. 🔴 G14 #2 — A RESUBMIT REQUEST AT LEVEL 2');
  // =========================================================================

  const resub = submit(requestor, 'G14 Resubmit');

  act(resub.id, 1, adminA, resub.rv, String(ROLE_MODERATION_ADMIN));

  const atLevel2 = state(resub.id);
  const asked = act(resub.id, 3, adminB, atLevel2.rv, String(ROLE_SUPER_ADMIN),
    'The second page of the degree is missing');

  const askedState = state(resub.id);

  console.log(`    request-resubmit at level 2: ${asked.raw}`);
  console.log(`    request is now: status ${askedState.status}, level ${askedState.level}\n`);

  check('🔴 a level-2 resubmit request sets ResubmitRequired and STAYS at level 2',
    asked.status === 1 && askedState.status === 4 && askedState.level === 2,
    `StatusId ${askedState.status} (4 = ResubmitRequired), level ${askedState.level}`);

  /*
    🔴 AND THE OTHER HALF, WHICH IS WHERE THE REAL ANSWER LIVES.

    G14 asks "level 1 se dobara shuru, ya level 2 se?" — and the answer is not
    in the action procedure at all. USP_ResubmitApprovalRequest sets
    CurrentApprovalLevel = 1 unconditionally, so the applicant's resubmission
    throws away level 1's earlier approval and the whole chain is walked again.

    ⚠️ That is a DECISION, and it is the right one: level 1 approved a document
    set that has since changed. Carrying their approval forward would mean the
    product had recorded somebody approving something they never saw. But it
    was undocumented and untested, which is how it would have been "tidied up"
    by whoever next read the procedure.
  */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    EXEC dbo.USP_ResubmitApprovalRequest
         @RequestId = ${resub.id}, @ActionByUserId = ${requestor},
         @Remarks = N'Full degree attached', @RowVersion = ${askedState.rv};`);

  const afterResubmit = state(resub.id);

  console.log(`    after the applicant resubmits: status ${afterResubmit.status}, level ${afterResubmit.level}`);
  console.log(`    trail: ${trail(resub.id).join('  ')}\n`);

  check('🔴 …and the applicant\'s resubmission restarts at LEVEL 1, discarding level 1\'s earlier approval',
    afterResubmit.status === 1 && afterResubmit.level === 1,
    `status ${afterResubmit.status} (Pending), level ${afterResubmit.level}`);

  check('…with the trail keeping every step — submit, approve, ask, resubmit',
    trail(resub.id).join(' ')
      === `L1:action4:by${requestor} L1:action1:by${adminA} L2:action3:by${adminB} L1:action5:by${requestor}`,
    trail(resub.id).join('  '));

  // And the whole chain can be walked again, from level 1.
  const walk1 = act(resub.id, 1, adminA, state(resub.id).rv, String(ROLE_MODERATION_ADMIN));
  const walkMid = state(resub.id);
  const walk2 = act(resub.id, 1, adminB, walkMid.rv, String(ROLE_SUPER_ADMIN));
  const walkEnd = state(resub.id);

  check('🔴 …and BOTH levels must approve again before the request completes',
    walk1.status === 1 && walkMid.level === 2 && walkMid.status === 1
    && walk2.status === 1 && walkEnd.status === 3 && walkEnd.completed === 'completed',
    `L1 -> level ${walkMid.level} pending, L2 -> status ${walkEnd.status} (3 = Approved)`);

  // =========================================================================
  section('4. 🔴 G14 #3 — PER-LEVEL ROLE SCOPING, AND WHAT AN ORG OVERRIDE MEANS');
  // =========================================================================

  const scoped = submit(requestor, 'G14 Scoping');

  /*
    The easy half: the level-2 role may not act at level 1 of this config.
  */
  const wrongRoleAtL1 = act(scoped.id, 1, adminA, scoped.rv, String(ROLE_SUPER_ADMIN));

  console.log(`    level-2's role acting at level 1: ${wrongRoleAtL1.raw}`);

  check('🔴 the level-2 role is REFUSED at level 1 — the check reads THIS level, not any level',
    wrongRoleAtL1.status === 0 && wrongRoleAtL1.code === 'FORBIDDEN',
    `${wrongRoleAtL1.code}`);

  const rightRoleAtL1 = act(scoped.id, 1, adminA, scoped.rv, String(ROLE_MODERATION_ADMIN));
  const scopedMid = state(scoped.id);

  check('…while the level-1 role is accepted, so the refusal was the role and not the request',
    rightRoleAtL1.status === 1 && scopedMid.level === 2, `advanced to level ${scopedMid.level}`);

  const wrongRoleAtL2 = act(scoped.id, 1, adminB, scopedMid.rv, String(ROLE_MODERATION_ADMIN));

  console.log(`    level-1's role acting at level 2: ${wrongRoleAtL2.raw}\n`);

  check('🔴 …and the level-1 role is REFUSED at level 2 — scoping holds in both directions',
    wrongRoleAtL2.status === 0 && wrongRoleAtL2.code === 'FORBIDDEN',
    `${wrongRoleAtL2.code}`);

  /*
    ------------------------------------------------------------------------
    🔴 THE HALF THIS SUITE WAS WRITTEN TO FIND.
    ------------------------------------------------------------------------
    024's header states the contract: "A row WITH an OrganizationUid overrides
    it for that one organisation."

    This organisation's level 1 is role 3. The PLATFORM DEFAULT's level 1 for
    the same request type is role 2. An actor holding only role 2 is therefore
    NOT an approver for this organisation, and must be refused.
  */
  /*
    ⚠️ A FRESH REQUEST, AT LEVEL 1. The first version reused the one above —
    which the previous assertion had already advanced to level 2 — so it was
    asking the override question at the wrong level and got a perfectly correct
    "approved" back. The test was wrong, not the engine; but it passed nothing
    and proved nothing, which is worse than failing.
  */
  const override = submit(requestor, 'G14 Override');

  const defaultRoleAtOrgL1 = act(override.id, 1, adminA, override.rv,
    String(ROLE_VERIFICATION_ADMIN));

  console.log(`    the PLATFORM DEFAULT's role, at level 1 of an org-overridden config: ${defaultRoleAtOrgL1.raw}`);
  console.log(`    (this org's level 1 is role ${ROLE_MODERATION_ADMIN}; the platform default is role ${ROLE_VERIFICATION_ADMIN},`);
  console.log(`     which is NOT a role at either of this organisation's levels)\n`);

  check('🔴 an ORG OVERRIDE overrides — the platform default\'s role is refused for this organisation',
    defaultRoleAtOrgL1.status === 0 && defaultRoleAtOrgL1.code === 'FORBIDDEN',
    `${defaultRoleAtOrgL1.code ?? 'ALLOWED'} — 024's header: "a row WITH an OrganizationUid overrides it"`);

  /*
    ⚠️ AND THE SAME REQUEST ACCEPTS THE OVERRIDE'S OWN ROLE, which is what makes
    the refusal above mean something. Without this, "FORBIDDEN" could equally
    have come from a request that was already finished, or a bad row version,
    or a level nobody has configured at all.
  */
  const orgRoleAtOrgL1 = act(override.id, 1, adminA, override.rv, String(ROLE_MODERATION_ADMIN));

  check('…while the ORGANISATION\'s own role is accepted on the same request',
    orgRoleAtOrgL1.status === 1 && state(override.id).level === 2,
    `advanced to level ${state(override.id).level} — so the refusal was the override, not the request`);

  // =========================================================================
  section('5. 🔴 G14 #4 — OPTIMISTIC CONCURRENCY, AT LEVEL 2');
  // =========================================================================

  const raceReq = submit(requestor, 'G14 Concurrency');

  act(raceReq.id, 1, adminA, raceReq.rv, String(ROLE_MODERATION_ADMIN));

  const raceState = state(raceReq.id);

  check('premise: the request is parked at level 2, pending',
    raceState.level === 2 && raceState.status === 1,
    `level ${raceState.level}, status ${raceState.status}, rowVersion ${raceState.rv}`);

  /*
    🔴 THE applications-race STANDARD, APPLIED HERE.

    Both sessions park inside WAITFOR TIME and stamp SYSUTCDATETIME() the
    instant it returns. Without those stamps this section asserts only that one
    approval won — which two approvals a minute apart satisfy just as well.
  */
  const probe = (hhmmss, actor, roleIds) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_mdm;
     DECLARE @spid int = @@SPID;
     WAITFOR TIME '${hhmmss}';
     DECLARE @t0 datetime2(7) = SYSUTCDATETIME();
     EXEC dbo.USP_ProcessApprovalAction
          @RequestId = ${raceReq.id}, @ActionTypeId = 1, @ActionByUserId = ${actor},
          @RowVersion = ${raceState.rv}, @ActorRoleIds = '${roleIds}';
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

  console.log(`\n  both approvers armed for ${hhmmss} …`);

  const [pa, pb] = await Promise.all([
    probe(hhmmss, adminA, String(ROLE_SUPER_ADMIN)),
    probe(hhmmss, adminB, String(ROLE_SUPER_ADMIN)),
  ]);

  const oa = outcome(pa);
  const ob = outcome(pb);
  const ma = mark(pa);
  const mb = mark(pb);

  console.log(`\n     A  spid ${ma.spid}  ${ma.t0Text}   ran ${ma.t1 - ma.t0} ms   ->  ${oa.raw}`);
  console.log(`     B  spid ${mb.spid}  ${mb.t0Text}   ran ${mb.t1 - mb.t0} ms   ->  ${ob.raw}`);
  console.log(`     entry gap ${entryGap(ma, mb)} ms\n`);

  check('🔴 both approvers left the gate in the SAME INSTANT — they actually raced',
    ranTogether(ma, mb),
    `A ${ma.t0Text} · B ${mb.t0Text} · gap ${entryGap(ma, mb)} ms (tolerance ${SAME_INSTANT_MS} ms)`);

  check('…on two different SQL sessions',
    ma.spid !== mb.spid, `spids ${ma.spid} and ${mb.spid}`);

  /*
    🔴 THE LOSER HAS TWO LEGITIMATE ANSWERS — found in 8-0, on the same day the
    identical shape was found in offers.mjs.

    The winning approval commits two things: the status/level move AND the
    RowVersion bump. What the loser meets depends on which it reaches first:

      loser reaches the optimistic UPDATE  -> 0 rows -> THROW 50023
                                           -> CONCURRENCY_CONFLICT
      loser re-reads the request after the
        winner committed                   -> already approved
                                           -> INVALID_STATUS

    Both refuse the same thing and both are correct. The invariant is the one
    on either side of this line: exactly ONE approval won, and the other was
    TOLD rather than silently overwriting it.

    ⚠️ The old assertion demanded CONCURRENCY_CONFLICT specifically, so it
    failed whenever the entry gap was wide enough for the winner to commit
    first — 16 ms was enough, and the gap is not something a test controls.
  */
  const REFUSALS = ['CONCURRENCY_CONFLICT', 'INVALID_STATUS'];

  const winners = [oa, ob].filter((r) => r.status === 1).length;
  const conflicts = [oa, ob].filter((r) => REFUSALS.includes(String(r.code))).length;

  console.log(`     the loser was refused with ${[oa, ob].find((r) => r.status !== 1)?.code}\n`);

  check('🔴 exactly ONE approval won at level 2',
    winners === 1, `${winners} winner(s)`);

  check('🔴 …and the other was REFUSED — told, not silently overwriting the winner',
    conflicts === 1,
    `${[oa, ob].map((r) => r.code ?? 'approved').join(' / ')}`);

  const raceEnd = state(raceReq.id);

  check('…and the request completed exactly once',
    raceEnd.status === 3 && raceEnd.completed === 'completed',
    `status ${raceEnd.status} (3 = Approved), ${raceEnd.completed}`);

  check('🔴 …and the trail has ONE row for level 2, not two',
    trail(raceReq.id).filter((t) => t.startsWith('L2:')).length === 1,
    trail(raceReq.id).join('  '));

  // =========================================================================
  // =========================================================================
  section('6. 🔴 G31 — AND AN ERROR THAT IS NOT 50023 STILL LOGS AND STILL THROWS');
  // =========================================================================

  /*
    🔴 WHY THIS SECTION EXISTS AT ALL.

    8-0 stopped the approval engine logging an ordinary lost race. The cheap
    way to achieve that would have been to stop logging — and the assertion in
    section 7 ("the log gained nothing") would pass just as well on a CATCH
    that logs nothing ever, which would be a far worse product than the one
    6A-0 described.

    So the suppression has to be shown to be NARROW: 50023 is classified and
    dropped, everything else is logged and re-thrown.

    ⚠️ THERE IS NO WAY TO MAKE THIS PROCEDURE FAIL FROM OUTSIDE. Every
    parameter it takes is validated into a graceful refusal — @ActionTypeId is
    checked against (1,2,3), a stale @RowVersion is the conflict path, and the
    history table has no foreign keys for a bogus id to violate. A refusal is
    not an exception and never reaches the CATCH.

    🔴 SO THE FAULT IS INJECTED WHERE A REAL ONE WOULD ARRIVE: a temporary
    AFTER INSERT trigger on the trail table that raises inside the procedure's
    own transaction. That is the shape of a genuine runtime fault — a trigger,
    a constraint, a deadlock — and it exercises the real CATCH in the real
    procedure rather than a copy of it.

    ⚠️ The number is 50000, which is what RAISERROR gives an ad-hoc message.
    What matters is only that it is NOT 50023, and the assertions say that
    rather than naming a number the injection happens to produce.

    ⚠️ The trigger is dropped here AND in the finally, and the next run asserts
    it is absent before doing anything: a suite that dies mid-section must not
    leave a booby-trapped history table behind.
  */
  const probeTrigger = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM sys.triggers WHERE name = 'TR_ZZ_G31Probe';`);

  check('entry to section 6: no probe trigger is left over from an earlier run',
    probeTrigger() === '0', `${probeTrigger()} probe trigger(s)`);

  /*
    🔴 THE 50023 PATH, REACHED ON PURPOSE RATHER THAN BY LUCK.

    G31's claim is about ONE branch of the CATCH: an optimistic-check failure
    is classified and never logged. The race in section 5 reaches that branch
    only when the loser gets as far as the UPDATE — and on a 16 ms entry gap it
    does not, it gets INVALID_STATUS from the precondition chain instead.

    ⚠️ WHICH MEANS THE RACE WAS NEVER A TEST OF G31. The flat-log assertion
    passed either way, and the premise line added in 8-0 is what exposed that:
    it failed with "0 CONCURRENCY_CONFLICT answers", on a product that was
    behaving correctly.

    A stale RowVersion is the same refusal with none of the timing: the UPDATE
    matches zero rows, THROW 50023 fires, and the CATCH does its work — every
    run, deterministically.
  */
  const staleReq = submit(adminA, 'G31 stale rowversion');

  const logBeforeStale = Number(errorLogCount());

  const firstPass = act(staleReq.id, 1, adminA, staleReq.rv, String(ROLE_MODERATION_ADMIN));

  check('premise: the first approval at level 1 succeeded, so the RowVersion moved',
    firstPass.status === 1, firstPass.raw);

  /* The SAME RowVersion again — now one behind the row. */
  const stale = act(staleReq.id, 1, adminA, staleReq.rv, String(ROLE_MODERATION_ADMIN));

  console.log(`\n     stale RowVersion -> ${stale.raw}`);
  console.log(`     error log ${logBeforeStale} -> ${errorLogCount()}\n`);

  check('🔴 a stale RowVersion is refused as CONCURRENCY_CONFLICT — the 50023 path, every run',
    stale.code === 'CONCURRENCY_CONFLICT', stale.raw);

  check('🔴 …and THAT path wrote nothing to the error log — G31, not by luck',
    Number(errorLogCount()) === logBeforeStale,
    `${logBeforeStale} -> ${errorLogCount()} across a refused optimistic check`);

  const negReq = submit(adminA, 'G31 negative');

  const beforeNeg = Number(errorLogCount());

  sql(`SET NOCOUNT ON; USE jp_mdm;
    EXEC('CREATE TRIGGER dbo.TR_ZZ_G31Probe ON dbo.t_mdm_request_approvals
          AFTER INSERT AS BEGIN RAISERROR(''G31 probe: an unexpected fault inside the transaction'', 16, 1); END');`);

  let threw = false;
  let probeError = '';

  try {
    act(negReq.id, 1, adminA, negReq.rv, String(ROLE_MODERATION_ADMIN));
  } catch (error) {
    threw = true;
    probeError = String(error.message ?? error).replace(/\s+/g, ' ').slice(0, 120);
  }

  sql(`SET NOCOUNT ON; USE jp_mdm; DROP TRIGGER dbo.TR_ZZ_G31Probe;`);

  /*
    🔴 TWO COLUMNS, AND THEY SAY DIFFERENT THINGS — which is why the first
    version of this assertion failed on a working product.

    ErrorProcedure is ERROR_PROCEDURE(): where the fault ORIGINATED, which for
    an injected trigger fault is the trigger. ContextInfo is what the procedure
    passes USP_LogError itself: who CAUGHT and logged it. Asserting that the
    approval engine logged this means asserting on ContextInfo.

    ⚠️ Worth keeping both in the printed line: a reader looking at a real log
    row needs to know that the two columns can legitimately disagree.
  */
  const negRow = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT TOP 1 CAST(ErrorNumber AS varchar(10)) + '|' + ISNULL(ErrorProcedure, '?')
               + '|ctx=' + ISNULL(ContextInfo, '?')
    FROM dbo.t_mdm_error_log ORDER BY ErrorLogId DESC;`);

  const negDelta = Number(errorLogCount()) - beforeNeg;

  console.log(`\n     injected fault -> threw: ${threw} · log delta ${negDelta} · newest ${negRow}`);
  console.log(`     "${probeError}"\n`);

  check('🔴 an UNEXPECTED fault still surfaces — it is not swallowed as a conflict',
    threw === true, probeError || 'the call returned normally, which would hide a real bug');

  check('🔴 …and it still writes exactly one error-log row, logged BY this procedure',
    negDelta === 1
      && /ctx=USP_ProcessApprovalAction$/.test(negRow)
      && !negRow.startsWith('50023|'),
    `delta ${negDelta} · newest row ${negRow}`);

  /*
    ⚠️ The probe row is then REMOVED, and that is not tidying up after a
    passing test — it is keeping section 7's baseline honest. This row is the
    suite's own fault injection, not something the product did, and leaving it
    would make the "log gained nothing" assertion fail for a reason that has
    nothing to do with the product.
  */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    DELETE FROM dbo.t_mdm_error_log
     WHERE ErrorMessage LIKE '%G31 probe%';`);

  check('…and the injected row is removed, so the exit baseline measures the PRODUCT',
    Number(errorLogCount()) === beforeNeg,
    `back to ${errorLogCount()} — the number this section started from`);

  // =========================================================================
  section('7. EXIT — the fixture is gone and the shipped configuration is unchanged');
  // =========================================================================

  cleanup();

  check('exit: every fixture level row is removed',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT COUNT(*) FROM dbo.t_mdm_request_levels WHERE OrganizationUid = '${FIXTURE_ORG}';`) === '0',
    'none left');

  check('exit: every fixture request is removed',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT COUNT(*) FROM dbo.t_mdm_approval_requests WHERE OrganizationUid = '${FIXTURE_ORG}';`) === '0',
    'none left');

  check('🔴 exit: the platform level configuration is byte-identical to entry',
    shippedLevels() === entryLevels, shippedLevels());

  /*
    ------------------------------------------------------------------------
    🔴 THE ERROR LOG GAINS NOTHING — G31, CLOSED IN PHASE 8-0.
    ------------------------------------------------------------------------
    This assertion was the exact opposite until 8-0: it expected ONE row and
    said, in writing, that the behaviour was not obviously right. 6A-0 measured
    it and left it, because changing what the approval engine logs is an
    operations decision rather than something G14 owed.

    8-0 decided it, the way the gap's own note recommended: an ordinary lost
    race is not news. The CATCH now classifies 50023 BEFORE it logs and logs
    only what it could not classify — which is precisely what 5A does for an
    expected duplicate in USP_ApplyToJob. Two engines answering "is this error
    news?" in opposite ways was the real defect.

    ⚠️ WHAT MUST STILL BE TRUE, and section 6 forces it rather than trusting
    it: an error that is NOT 50023 still logs and still surfaces. A CATCH that
    stopped logging altogether would pass the assertion below and be a much
    worse product.
  */
  const logDelta = Number(errorLogCount()) - Number(entryErrors);

  check('🔴 exit: the error log gained NOTHING — an ordinary race is not news (G31 closed)',
    logDelta === 0,
    `${entryErrors} -> ${errorLogCount()} across a run containing a real level-2 race`);

  /*
    ⚠️ And the race really did happen, so the line above is not vacuous: one
    of the two approvals was refused with CONCURRENCY_CONFLICT in section 5.
    Without this premise, deleting the race from the suite would make the
    "gained nothing" assertion pass for the wrong reason.
  */
  /*
    ⚠️ THE PREMISE IS THE DETERMINISTIC ONE, NOT THE RACE. Section 6 forces a
    50023 through a stale RowVersion on every run; the race in section 5 may or
    may not reach that branch depending on a millisecond gap, which is why it
    is no longer what this assertion leans on.
  */
  check('premise: the 50023 branch was actually exercised in this run',
    stale.code === 'CONCURRENCY_CONFLICT',
    'section 6 forces it with a stale RowVersion, so this is true every run');
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  // ⚠️ A killed run must not leave a two-level configuration behind for the
  // next suite — or for the product — to inherit.
  /*
    ⚠️ THE PROBE TRIGGER COMES OFF FIRST. cleanup() deletes history rows, and
    a history table with an armed RAISERROR trigger would make the teardown
    itself fail — leaving both the trigger and the fixture behind.
  */
  try {
    sql(`SET NOCOUNT ON; USE jp_mdm;
      IF OBJECT_ID('dbo.TR_ZZ_G31Probe', 'TR') IS NOT NULL DROP TRIGGER dbo.TR_ZZ_G31Probe;
      DELETE FROM dbo.t_mdm_error_log WHERE ErrorMessage LIKE '%G31 probe%';`);
  } catch { /* reported by the assertions above */ }

  try { cleanup(); } catch { /* reported above */ }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
