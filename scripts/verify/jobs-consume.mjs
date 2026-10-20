/*
  PHASE 4 — the entitlement engine's first real consumer, wired to publishing.

  ----------------------------------------------------------------------------
  WHAT THIS PROVES
  ----------------------------------------------------------------------------
    2. THE CONSUME, WIRED   JOB_POST flipped to METERED quota 1 THROUGH THE
                            ADMIN SCREEN'S API. First publish succeeds and the
                            ledger row carries the JOB'S OWN Uid. Second job's
                            publish is refused, the job STAYS Draft, no row is
                            written. Restored to FREE, publishing consumes
                            nothing.

    3. 🔴 ATOMICITY         a failure injected AFTER the consume, inside the
                            publish transaction. The job stays Draft AND the
                            ledger stays empty — the consume is rolled back
                            with the publish.

    4. IDEMPOTENT REPUBLISH close the published job, publish again ->
                            ALREADY_CONSUMED, the ORIGINAL entry id, still one
                            ledger row. Reopening is free, by design.

  ----------------------------------------------------------------------------
  🔴 THE INJECTION IS A TEMPORARY TRIGGER, NOT A HOOK IN THE PROCEDURE
  ----------------------------------------------------------------------------
  An earlier version put a conditional RAISERROR inside USP_PublishJob guarded
  on a table this script would create. It failed two ways: SQL Server resolves
  the table name when the statement RUNS, so with no such table the procedure
  died with "Invalid object name" — and the atomicity test then PASSED, because
  the job stayed a Draft and the ledger stayed empty for entirely the wrong
  reason.

  An AFTER UPDATE trigger on t_app_jobs fires exactly between the consume and
  the commit, needs no production scaffolding, and the failure it injects is a
  real one.

  ----------------------------------------------------------------------------
  SHIPPED STATE, ASSERTED ON ENTRY AND ON EXIT (the 2.5 teardown lesson)
  ----------------------------------------------------------------------------
  JOB_POST exists, is FREE, is active, and no plan-feature mapping exists.
  Restoring to "whatever was found" would let a killed run poison the next one.

  Run (both APIs up): node scripts/verify/jobs-consume.mjs
*/
import { execFileSync } from 'node:child_process';
import { token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const ADMIN = { id: 'superadmin@teacherportal.local', pw: secret('superadmin@teacherportal.local') };
const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001',
    '-h', '-1', '-W', '-s', '|', '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep text */ }

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

const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 FeatureId FROM m_mdm_features WHERE FeatureCode='JOB_POST' AND Is_Deleted=0;`));

/** The documented shipped state — restored to on entry AND on exit. */
const restoreShipped = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId=1, Is_Active=1 WHERE Is_Deleted=0;
    DELETE FROM m_mdm_plan_features;`);
  sql(`SET NOCOUNT ON; USE jp_app;
    IF OBJECT_ID('dbo.trg_publish_failpoint') IS NOT NULL DROP TRIGGER dbo.trg_publish_failpoint;`);
};

const cleanupJobs = (schoolId) => {
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_job_subjects WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId=${schoolId});
    DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE SchoolId=${schoolId});
    DELETE FROM t_app_jobs WHERE SchoolId=${schoolId};`);
};

let schoolId = 0;
let orgUid = '';

restoreShipped();

const admin = await login(ADMIN.id, ADMIN.pw);
const owner = await login(OWNER.id, OWNER.pw);
const HA = { authorization: `Bearer ${admin}`, 'content-type': 'application/json' };
const HO = { authorization: `Bearer ${owner}`, 'content-type': 'application/json' };

const ledgerCount = () => Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM t_app_feature_ledger WHERE OwnerUid='${orgUid}' AND Is_Deleted=0;`));

const jobRow = (id) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT JobStatusId, ISNULL(CONVERT(varchar(30), PublishedOn),'-') FROM t_app_jobs WHERE JobId=${id};`)[0]
  ?.split('|').map((s) => s.trim()) ?? [];

try {
  // =========================================================================
  console.log('\n=== 0. SHIPPED STATE ON ENTRY ===');

  const matrix = await j(`${APP}/entitlements/matrix`, { headers: HA });
  const feat = matrix.body?.data?.features?.find((f) => f.featureCode === 'JOB_POST');

  check('JOB_POST exists as a feature', !!feat, feat ? `id ${feat.featureId}` : 'missing');
  check('…seeded FREE and active',
    feat?.gatingModeCode === 'FREE' && feat?.isActive === true,
    `${feat?.gatingModeCode}, active ${feat?.isActive}`);
  check('…and no plan-feature mappings exist',
    matrix.body?.data?.mappings?.length === 0, `${matrix.body?.data?.mappings?.length} mappings`);

  // The school we act as, resolved the way the API does.
  const branches = await j(`${APP}/branches`, { headers: HO });
  const branchId = branches.body?.data?.[0]?.branchId;

  schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 SchoolId FROM t_app_school_branches WHERE BranchId=${branchId};`));
  orgUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 OrganizationUid FROM t_app_schools WHERE SchoolId=${schoolId};`);

  console.log(`    acting as school ${schoolId}, org ${orgUid}, campus ${branchId}`);
  cleanupJobs(schoolId);

  const draft = (title) => j(`${APP}/jobs`, {
    method: 'POST', headers: HO,
    body: JSON.stringify({
      branchId, jobTitle: title, subjectId: 1, designationId: 1,
      noOfVacancies: 1, employmentTypeId: 1, lastDateToApply: '2026-12-31',
      subjectIds: [1], classLevelIds: [1],
    }),
  });

  const publish = (id) => j(`${APP}/jobs/${id}/publish`, { method: 'POST', headers: HO });

  // =========================================================================
  console.log('\n=== 2. 🔴 THE CONSUME, WIRED ===');

  const ledgerAtStart = ledgerCount();

  // (a) FREE — publishing costs nothing.
  const freeJob = (await draft('Free-mode publish')).body?.data;
  const freePub = await publish(freeJob);

  check('a. FREE: publish succeeds', freePub.http === 200, `HTTP ${freePub.http}`);
  check('a. …and consumed NOTHING — the ledger is untouched',
    freePub.body?.data?.consumed === false && ledgerCount() === ledgerAtStart,
    `consumed ${freePub.body?.data?.consumed}, ledger ${ledgerAtStart} -> ${ledgerCount()}`);

  // (b) Flip to METERED quota 1 through the ADMIN API — the same call the
  //     admin screen makes. No direct SQL, deliberately.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({
      planId: Number(scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT TOP 1 PlanId FROM t_app_subscriptions WHERE OwnerUid='${orgUid}' AND Is_Active=1;`)),
      featureId: FEATURE, action: 'MAP', isIncluded: true, quotaPerPeriod: 1,
    }),
  });
  const flip = await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });

  check('b. JOB_POST flipped to METERED quota 1 through the admin API',
    flip.http === 200
      && scalar(`SET NOCOUNT ON; USE jp_mdm; SELECT GatingModeId FROM m_mdm_features WHERE FeatureId=${FEATURE};`) === '3',
    `HTTP ${flip.http}`);

  const jobA = (await draft('Metered publish A')).body?.data;
  const jobAUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(40), JobUid) FROM t_app_jobs WHERE JobId=${jobA};`);

  const pubA = await publish(jobA);

  check('c. the first publish under quota succeeds AND consumes',
    pubA.http === 200 && pubA.body?.data?.consumed === true && pubA.body?.data?.source === 1,
    `consumed ${pubA.body?.data?.consumed}, source ${pubA.body?.data?.source} (1=quota)`);

  console.log('\n    the ledger row it wrote:');
  sql(`SET NOCOUNT ON; USE jp_app;
    SELECT l.EntryId, et.Code, ISNULL(sr.Code,'-'), l.Units, CONVERT(varchar(40), l.RefEntityUid), rt.Code
    FROM t_app_feature_ledger l
      JOIN m_app_ledger_entry_types et ON et.EntryTypeId=l.EntryTypeId
      LEFT JOIN m_app_ledger_sources sr ON sr.SourceId=l.SourceId
      LEFT JOIN m_app_ref_entity_types rt ON rt.RefEntityTypeId=l.RefEntityTypeId
    WHERE l.OwnerUid='${orgUid}' AND l.Is_Deleted=0 ORDER BY l.EntryId;`)
    .forEach((r) => console.log(`      ${r}`));

  const ledgerRef = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CONVERT(varchar(40), RefEntityUid) FROM t_app_feature_ledger
    WHERE OwnerUid='${orgUid}' AND EntryTypeId=2 AND Is_Deleted=0 ORDER BY EntryId DESC;`);

  check('🔴 c. …and the reference IS the job\'s own Uid',
    ledgerRef.toLowerCase() === jobAUid.toLowerCase(),
    `ledger ${ledgerRef} · job ${jobAUid}`);

  // (d) quota is now spent.
  const jobB = (await draft('Metered publish B')).body?.data;
  const ledgerBeforeB = ledgerCount();
  const pubB = await publish(jobB);

  check('d. 🔴 the second publish is refused — QUOTA_EXHAUSTED',
    pubB.http === 400 && pubB.body?.code === 'QUOTA_EXHAUSTED',
    `HTTP ${pubB.http}, code ${pubB.body?.code}`);

  const rowB = jobRow(jobB);
  check('d. 🔴 …the job is STILL a Draft',
    rowB[0] === '1' && rowB[1] === '-', `JobStatusId ${rowB[0]}, PublishedOn ${rowB[1]}`);
  check('d. 🔴 …and NO ledger row was written',
    ledgerCount() === ledgerBeforeB, `${ledgerBeforeB} -> ${ledgerCount()}`);

  // (e) back to FREE.
  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 1, isActive: true }),
  });

  const ledgerBeforeE = ledgerCount();
  const pubB2 = await publish(jobB);

  check('e. restored to FREE: the same job now publishes',
    pubB2.http === 200 && jobRow(jobB)[0] === '2', `HTTP ${pubB2.http}, status ${jobRow(jobB)[0]}`);
  check('e. 🔴 …and consumed nothing — the ledger count is unchanged',
    pubB2.body?.data?.consumed === false && ledgerCount() === ledgerBeforeE,
    `consumed ${pubB2.body?.data?.consumed}, ledger ${ledgerBeforeE} -> ${ledgerCount()}`);

  // =========================================================================
  console.log('\n=== 3. 🔴 ATOMICITY — A FAILURE *AFTER* THE CONSUME ===');

  // Metered again, with room to spend.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: HA,
    body: JSON.stringify({
      planId: Number(scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT TOP 1 PlanId FROM t_app_subscriptions WHERE OwnerUid='${orgUid}' AND Is_Active=1;`)),
      featureId: FEATURE, action: 'MAP', isIncluded: true, quotaPerPeriod: 50,
    }),
  });
  await j(`${APP}/entitlements/features/${FEATURE}/gating`, {
    method: 'PUT', headers: HA, body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });

  const jobC = (await draft('Atomicity — must stay a draft')).body?.data;
  const ledgerBeforeC = ledgerCount();

  /*
    🔴 The injection. An AFTER UPDATE trigger fires on the Draft->Active update,
    which happens strictly AFTER the consume has written its ledger row inside
    the same transaction.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    EXEC sp_executesql N'CREATE TRIGGER dbo.trg_publish_failpoint ON dbo.t_app_jobs
    AFTER UPDATE AS BEGIN RAISERROR (N''Injected failure after consume.'', 16, 1); END';`);

  const pubC = await publish(jobC);

  sql(`SET NOCOUNT ON; USE jp_app; DROP TRIGGER dbo.trg_publish_failpoint;`);

  const rowC = jobRow(jobC);
  const ledgerAfterC = ledgerCount();

  console.log(`    publish response : HTTP ${pubC.http}, code ${pubC.body?.code}`);
  console.log(`    job after        : JobStatusId ${rowC[0]}, PublishedOn ${rowC[1]}`);
  console.log(`    ledger           : ${ledgerBeforeC} before, ${ledgerAfterC} after`);

  check('the publish failed rather than half-succeeding',
    pubC.http >= 400, `HTTP ${pubC.http}`);
  check('🔴 the job is STILL a Draft',
    rowC[0] === '1' && rowC[1] === '-', `JobStatusId ${rowC[0]}, PublishedOn ${rowC[1]}`);
  check('🔴 …and the consume was ROLLED BACK WITH IT — no ledger row',
    ledgerAfterC === ledgerBeforeC,
    `${ledgerBeforeC} -> ${ledgerAfterC} (a leaked row would read ${ledgerBeforeC + 1})`);

  // The premise: with the injection gone, the SAME publish works and DOES
  // consume. Without this, the assertions above could pass for any reason.
  const pubC2 = await publish(jobC);

  check('🔴 …and with the injection removed the SAME publish succeeds and consumes',
    pubC2.http === 200 && pubC2.body?.data?.consumed === true
      && ledgerCount() === ledgerBeforeC + 1,
    `HTTP ${pubC2.http}, consumed ${pubC2.body?.data?.consumed}, ledger ${ledgerCount()}`);

  // =========================================================================
  console.log('\n=== 3b. 🔴 G38 — A LAPSED PLAN STILL PUBLISHES, AT THE FREE ALLOWANCE ===');

  /*
    🔴 THE REGRESSION THAT WOULD HAVE CAUGHT G38, AND DID NOT EXIST.

    6.5-C removed a cliff: a subscription past EndsOn drops to the default
    plan's entitlements instead of being refused. billing.mjs asserted that for
    the ENTITLEMENT path — EntitlementService -> USP_ConsumeFeature — and that
    assertion passed throughout.

    ⚠️ IT PASSED BECAUSE IT TESTED THE WRONG PATH. Publishing a job does not go
    through USP_ConsumeFeature; it goes through USP_PublishJob, which calls the
    core directly and, until 8-0, passed no fallback at all. Same for inviting.
    So the two consuming actions in the product (2.64) were the two the cliff
    was still live on, and the suite that covered the cliff never touched them.

    Measured before the fix, on this exact fixture: Status 0
    SUBSCRIPTION_INACTIVE. The gap called this a risk for "some future
    procedure"; it was already shipped, in both.
  */
  const lapsedJob = (await draft('Lapsed-plan publish')).body?.data;

  const endsBefore = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(CONVERT(varchar(10), EndsOn, 120), 'NULL')
      FROM t_app_subscriptions WHERE OwnerUid='${orgUid}' AND Is_Active=1;`);

  /*
    ⚠️ LAPSED MEANS *ONLY TIME HAS PASSED*: StatusId 1 and Is_Active 1 are left
    alone and EndsOn moves into the past. A cancelled or deactivated
    subscription is a different case and SHOULD be refused — the core's own
    comment says so, and widening this fixture would hide that difference.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions
       SET EndsOn = CAST(DATEADD(day, -1, dbo.fn_IstToday()) AS date)
     WHERE OwnerUid='${orgUid}' AND Is_Active=1;`);

  const inForce = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(dbo.fn_SubscriptionInForce(s.Is_Active, s.StatusId, s.EndsOn, SYSUTCDATETIME()) AS varchar(2))
      FROM t_app_subscriptions s WHERE s.OwnerUid='${orgUid}' AND s.Is_Active=1;`);

  check('premise: the subscription really is out of force now',
    inForce === '0', `fn_SubscriptionInForce = ${inForce} (EndsOn was ${endsBefore})`);

  const lapsedPub = await publish(lapsedJob);

  console.log(`\n    lapsed publish -> HTTP ${lapsedPub.http} `
    + `code ${lapsedPub.body?.code ?? 'none'} consumed ${lapsedPub.body?.data?.consumed}\n`);

  check('🔴 G38: a LAPSED plan publishes — the free baseline, not SUBSCRIPTION_INACTIVE',
    lapsedPub.http === 200,
    `HTTP ${lapsedPub.http}${lapsedPub.body?.code ? ' ' + lapsedPub.body.code : ''}`);

  check('🔴 …and the refusal it used to give is named, so this cannot pass vacuously',
    lapsedPub.body?.code !== 'SUBSCRIPTION_INACTIVE',
    'before 8-0 this exact call answered SUBSCRIPTION_INACTIVE on a FREE feature');

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions
       SET EndsOn = ${endsBefore === 'NULL' ? 'NULL' : `'${endsBefore}'`}
     WHERE OwnerUid='${orgUid}' AND Is_Active=1;`);

  const inForceAgain = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(dbo.fn_SubscriptionInForce(s.Is_Active, s.StatusId, s.EndsOn, SYSUTCDATETIME()) AS varchar(2))
      FROM t_app_subscriptions s WHERE s.OwnerUid='${orgUid}' AND s.Is_Active=1;`);

  check('…and the subscription is back in force for the rest of the run',
    inForceAgain === '1', `EndsOn restored to ${endsBefore}`);

  // =========================================================================
  console.log('\n=== 4. IDEMPOTENT REPUBLISH — REOPENING IS FREE ===');

  /*
    🔴 THE ENTRY FOR *THIS JOB*, NOT "THE NEWEST ONE FOR THIS OWNER".

    This read used to take the newest consume row for the organisation and
    assume it belonged to jobC, which held only because jobC happened to be
    the last thing that consumed. Section 3b (G38) then published one more job
    after it, and the assertion below failed with "returned 1344, original
    1345" — on a product that was behaving correctly: the republish DID return
    jobC's original entry.

    ⚠️ So the subject is named. The ledger row carries RefEntityUid, which is
    the job's own uid, and that is what identifies it — the same correction
    7B made when a queue assertion read a row's whole text instead of the cell
    it meant.
  */
  const entryBefore = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 l.EntryId
      FROM t_app_feature_ledger l
      INNER JOIN t_app_jobs j ON j.JobUid = l.RefEntityUid
     WHERE l.OwnerUid='${orgUid}' AND l.EntryTypeId=2 AND l.Is_Deleted=0
       AND j.JobId=${jobC}
     ORDER BY l.EntryId DESC;`);
  const ledgerBeforeRe = ledgerCount();

  const closed = await j(`${APP}/jobs/${jobC}/close`, { method: 'POST', headers: HO });
  check('the published job closes', closed.http === 200 && jobRow(jobC)[0] === '4',
    `HTTP ${closed.http}, status ${jobRow(jobC)[0]}`);

  const rePub = await publish(jobC);

  check('🔴 re-publishing it succeeds', rePub.http === 200 && jobRow(jobC)[0] === '2',
    `HTTP ${rePub.http}, status ${jobRow(jobC)[0]}`);
  check('🔴 …with code ALREADY_CONSUMED — reopening is free',
    rePub.body?.code === 'ALREADY_CONSUMED' && rePub.body?.data?.consumed === false,
    `code ${rePub.body?.code}, consumed ${rePub.body?.data?.consumed}`);
  check('🔴 …returning the ORIGINAL entry id',
    String(rePub.body?.data?.entryId) === entryBefore,
    `returned ${rePub.body?.data?.entryId}, original ${entryBefore}`);
  check('🔴 …and the ledger still holds ONE consume row for it',
    ledgerCount() === ledgerBeforeRe, `${ledgerBeforeRe} -> ${ledgerCount()}`);
} finally {
  console.log('\n=== TEARDOWN ===');

  /*
    ⚠️ THE SUBSCRIPTION COMES BACK FIRST. Section 3b moves EndsOn into the past
    and puts it back; a run killed in between would leave this school lapsed for
    every later suite, which is exactly the contamination a dead run caused once
    already this project.
  */
  if (orgUid) {
    try {
      sql(`SET NOCOUNT ON; USE jp_app;
        UPDATE t_app_subscriptions SET EndsOn = NULL
         WHERE OwnerUid='${orgUid}' AND Is_Active=1 AND EndsOn IS NOT NULL AND StatusId = 1;`);
    } catch { /* reported by the assertions above */ }
  }

  if (schoolId) cleanupJobs(schoolId);
  if (orgUid) sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${orgUid}';`);
  restoreShipped();

  const mode = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(GatingModeId AS varchar(2)) + '|' + CAST(Is_Active AS varchar(2))
    FROM m_mdm_features WHERE FeatureId=${FEATURE};`);
  const maps = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted=0;`);
  const jobs = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_jobs;`);
  const trg = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CASE WHEN OBJECT_ID('dbo.trg_publish_failpoint') IS NULL THEN 'gone' ELSE 'STILL THERE' END;`);

  check('🔴 shipped state restored on EXIT — FREE, no mappings, no jobs, no trigger',
    mode === '1|1' && maps === '0' && jobs === '0' && trg === 'gone',
    `JOB_POST ${mode}, mappings ${maps}, jobs ${jobs}, trigger ${trg}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
