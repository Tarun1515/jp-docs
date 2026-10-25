/*
  PHASE 6.5A — BILLING, MANUAL FIRST. THE SEAM, END TO END.

  ----------------------------------------------------------------------------
    0. ENTRY        shipped state asserted: free plans only, nothing gated
    1. 🔴 THE SEAM  request -> entitlements UNCHANGED -> verify -> new quota
    2. 🔴 MISMATCH  a different amount needs a remark; an exact one does not
    3. 🔴 IDEMPOTENT  verifying twice = one activation, one receipt, Status 1
    4. 🔴 THE RACE  two verifications on ONE wall-clock instant -> one of each
    5. 🔒 EXPIRY    EndsOn yesterday on the IST boundary -> the free baseline,
                    with NO job having run. DB row and response side by side
    6. 🔴 DOWNGRADE quota 5, used 3, switch to 2 -> refused, never negative
    7. 🔒 NEGATIVES a school and a teacher forcing /verify -> 403
    8. EXIT         the fixture plan gone, shipped state restored

  ----------------------------------------------------------------------------
  🔴 THE FIXTURE PAID PLAN IS A FIXTURE, NOT A SEED
  ----------------------------------------------------------------------------
  03_seed/008_seed_plans.sql forbids seeding paid tiers, in writing: pricing is
  not finalised and a number we ship gets quoted back at us. 011's build guard
  ENFORCES that — a priced public plan fails the build.

  So this suite creates one, uses it, and removes it in the finally. The exit
  asserts it is gone, which also means a killed run is caught by the next
  `run_all` rather than quietly becoming seed data.

  ⚠️ Same for gating: every feature ships FREE with no mappings (2.64). This
  flips ONE feature to METERED and maps it on two plans, and restores to the
  DOCUMENTED shipped state rather than to whatever it found — entitlement-http
  records why that distinction matters after a killed run.

  Run (both APIs):  node scripts/verify/billing.mjs
*/
import { execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';
import { restoreCatalogue, catalogueState, catalogueSummary } from './lib/catalogue.mjs';

const execFileAsync = promisify(execFile);

const APP = 'http://localhost:5299/api';
const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const ADMIN = { id: 'superadmin@teacherportal.local', pw: secret('superadmin@teacherportal.local') };
const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

const FIXTURE_PLAN = 'BILLING_SUITE_PRO';
const JOB_POST = 1;

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

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }
  return { http: r.status, body, text };
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

/*
  🔴 RESTORES TO THE DOCUMENTED SHIPPED STATE, NOT TO WHAT IT FOUND.

  entitlement-http records the reason: a previous run that died before teardown
  leaves dirty state, and a suite that captures "the original" on entry would
  faithfully preserve the mess. Phase 2.5 ships every feature FREE and active
  with NO plan mappings, and 008 ships no paid plan. That is what restore means.
*/
const restore = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    DELETE FROM m_mdm_plan_features;
    UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1 WHERE Is_Deleted = 0;

    DELETE FROM t_mdm_payment_receipts
     WHERE PaymentId IN (SELECT PaymentId FROM t_mdm_request_payments
                          WHERE PlanId IN (SELECT PlanId FROM m_mdm_plans WHERE PlanCode LIKE 'BILLING_SUITE%'));

    DELETE FROM t_mdm_request_payments
     WHERE PlanId IN (SELECT PlanId FROM m_mdm_plans WHERE PlanCode LIKE 'BILLING_SUITE%');

    DELETE FROM t_mdm_request_payments WHERE RequestId IN
      (SELECT RequestId FROM t_mdm_approval_requests WHERE RequestTypeId = 5);
    DELETE FROM t_mdm_approval_requests WHERE RequestTypeId = 5;
    DELETE FROM t_mdm_request_number_series WHERE RequestTypeId = 5;
    DELETE FROM t_mdm_receipt_number_series;

    DELETE FROM m_mdm_plans WHERE PlanCode LIKE 'BILLING_SUITE%';`);

    /*
      🔴 AND THE REAL CATALOGUE BACK. The delete above clears THIS
      suite's mappings, which it must — but under 2.64 that WAS the
      shipped state, so nine suites "restored" it by leaving the table
      empty. SR-4 seeded a real catalogue, and leaving it empty became a
      delete of the product's pricing running twice per suite.
    */
    restoreCatalogue();

  /*
    ⚠️ Scoped to the owner under test, resolved the SAME way the API resolves
    it. A blanket UPDATE over t_app_subscriptions would repair this suite's
    mess by flattening every other account's plan — which is the shape of
    cleanup that passes its own exit check and breaks the next suite.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @Owner uniqueidentifier = (
        SELECT TOP 1 sc.OrganizationUid
          FROM t_app_schools sc
          INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
          INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
         WHERE u.Email = '${OWNER.id}');

    DELETE FROM t_app_feature_ledger WHERE Notes LIKE 'billing-suite%';

    /* Every row this suite's activations opened — they all carry a payment. */
    DELETE FROM t_app_subscriptions
     WHERE OwnerUid = @Owner AND SourcePaymentUid IS NOT NULL;

    /*
      And the one provisioning opened is put back as 2F left it: the free plan,
      ACTIVE, perpetual. There is exactly one such row per owner.
    */
    UPDATE t_app_subscriptions
       SET StatusId = 1, Is_Active = 1, EndsOn = NULL, PlanId = 1,
           ModifiedOn = NULL, ModifiedBy = NULL
     WHERE OwnerUid = @Owner AND SourcePaymentUid IS NULL;`);
};

/*
  🔴 THE OWNER THE PRINCIPAL'S TOKEN RESOLVES TO — not "some owner".

  t_app_subscriptions.OwnerUid is the ORGANISATION for a school (2.51), and the
  API takes it from the token's orgUid claim (2.39). The first draft of this
  suite picked the row with MIN(SubscriptionId) instead, which is a DIFFERENT
  organisation — so the seam activated the right account while every assertion
  read the wrong one, and three checks failed claiming activation had not
  happened when it had.

  ⚠️ The lesson is narrow and worth keeping: a fixture must resolve the same
  identity the code under test resolves, by the same route. Picking "a plausible
  row" is how a suite ends up testing two different accounts at once.
*/
const ownerUid = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT LOWER(CAST(sc.OrganizationUid AS varchar(50)))
    FROM t_app_schools sc
    INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
   WHERE u.Email = '${OWNER.id}';`);

const planIdOf = (code) => Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(PlanId AS varchar(10)) FROM m_mdm_plans WHERE PlanCode = '${code}' AND Is_Deleted = 0;`));

const subRow = (owner) => {
  const r = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(PlanId AS varchar(10)) + '|' + CAST(StatusId AS varchar(3)) + '|'
         + CAST(Is_Active AS varchar(3)) + '|' + ISNULL(CONVERT(varchar(30), EndsOn, 126), 'NULL') + '|'
         + CAST(dbo.fn_SubscriptionInForce(Is_Active, StatusId, EndsOn, SYSUTCDATETIME()) AS varchar(3))
      FROM t_app_subscriptions
     WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`)[0] ?? '';

  const [planId, statusId, isActive, endsOn, inForce] = r.split('|');
  return { planId: Number(planId), statusId: Number(statusId), isActive, endsOn, inForce };
};

const ledgerCount = (owner) => Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_feature_ledger
   WHERE OwnerUid = '${owner}' AND Notes LIKE 'billing-suite%' AND ReversedOn IS NULL;`));

let fixturePlanId = 0;

try {
  // =========================================================================
  section('0. ENTRY — the shipped state this phase does not change');
  // =========================================================================

  restore();

  const shippedPlans = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans WHERE Is_Deleted = 0;`));

  const pricedPublic = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans
     WHERE Price > 0 AND IsPublic = 1 AND IsDefault = 0 AND Is_Deleted = 0;`));

  console.log(`\n    plans: ${shippedPlans} · priced public plans: ${pricedPublic}\n`);

  /*
    🔴 THE PROHIBITION, ASSERTED AS THIS SUITE'S PREMISE.

    008_seed_plans.sql forbids seeding paid tiers because pricing is not
    finalised. If this is ever non-zero on entry, either somebody seeded one or
    a killed run of THIS suite left its fixture behind — and both need to be
    seen rather than built on.
  */
  /*
    🔴 THIS PREMISE CHANGED IN SR-4, AND THE CHANGE IS THE POINT.

    It read "TWO plans, and NO priced public plan (008 forbids it)". That was
    right while pricing was unknown — a number we ship gets quoted back at us.

    The client asked for a working catalogue with placeholder prices on
    2026-10-25, so it is now a CLOSED SET of four, and 011's build guard
    changed shape in the same commit: from "no priced public plan" to "exactly
    these four". That is STRICTER, not weaker — it fails on an unexpected plan
    of any price, including this suite's own fixture left behind.
  */
  check('🔴 shipped state: the FOUR catalogue plans',
    shippedPlans === 4,
    `${shippedPlans} plans (expect 4), ${pricedPublic} priced public (expect 2, both SAMPLE PRICING)`);

  /*
    🔴 AND THIS ONE INVERTED, which is SR-4 in one line.

    2.64 shipped the engine OFF and this asserted exactly that. SR-4 turns
    three features on, so "nothing gated" is no longer the shipped state — it
    is the BROKEN state, and asserting it would now fail on a correct product.
  */
  check('🔴 shipped state: the SR-4 catalogue is live',
    catalogueState().ok, catalogueSummary());

  const owner = ownerUid();
  const adminToken = await loginToken(ADMIN);
  const ownerToken = await loginToken(OWNER);
  const teacherToken = await loginToken(TEACHER);

  check('premise: the owner is on the free plan, in force',
    subRow(owner).planId === 1 && subRow(owner).inForce === '1',
    `plan ${subRow(owner).planId}, inForce ${subRow(owner).inForce}`);

  // ---- the fixture -------------------------------------------------------
  sql(`SET NOCOUNT ON; USE jp_mdm;
    INSERT INTO m_mdm_plans (PlanCode, UserTypeId, Name, DurationDays, Price, IsDefault, IsPublic, DisplayOrder)
    VALUES ('${FIXTURE_PLAN}', 2, N'Suite Pro', 30, 5000.00, 0, 1, 95);`);

  fixturePlanId = planIdOf(FIXTURE_PLAN);

  /*
    JOB_POST becomes METERED, and both plans get a quota: FREE 1, PRO 10. The
    difference is the whole point of section 1 — the same consume must run on a
    different allowance once the plan changes.
  */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId = 3 WHERE FeatureId = ${JOB_POST};

    /*
      ⚠️ THE FIXTURE OWNS ITS ROWS SINCE SR-4. The catalogue seeds
      (SCHOOL_FREE, JOB_POST), so a bare INSERT hits the unique index and the
      suite dies at its fixture. Only these two pairs are cleared — the rest
      of the catalogue is the seed's, and restoreCatalogue() rebuilds these
      on the way out.
    */
    DELETE FROM m_mdm_plan_features
     WHERE FeatureId = ${JOB_POST} AND PlanId IN (1, ${fixturePlanId});

    INSERT INTO m_mdm_plan_features (PlanId, FeatureId, IsIncluded, QuotaPerPeriod)
    VALUES (1, ${JOB_POST}, 1, 1), (${fixturePlanId}, ${JOB_POST}, 1, 10);`);

  /*
    ⚠️ SCOPED TO THIS SUITE'S OWN TWO PAIRS SINCE SR-4. It used to count
    every mapping on JOB_POST and expect 2, which was true when the suite was
    the only thing that had ever mapped it. The catalogue now maps JOB_POST on
    STANDARD and UNLIMITED as well, so the total is 4 and says nothing about
    whether THIS fixture was built.
  */
  check('fixture: a paid plan and two quotas — free 1, pro 10',
    fixturePlanId > 0
    && scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT CAST(COUNT(*) AS varchar(4)) FROM m_mdm_plan_features
         WHERE FeatureId = ${JOB_POST} AND PlanId IN (1, ${fixturePlanId}) AND Is_Deleted = 0;`) === '2',
    `plan ${fixturePlanId}`);

  // =========================================================================
  section('1. 🔴 THE SEAM — request, unchanged, verify, new quota');
  // =========================================================================

  const catalog = await j(`${APP}/billing/plans`, { headers: H(ownerToken) });

  check('the school sees the paid plan in its catalog, with what it maps to',
    catalog.http === 200
    && (catalog.body?.data ?? []).some((p) => p.planCode === FIXTURE_PLAN
        && p.features?.some((f) => f.featureCode === 'JOB_POST' && f.quotaPerPeriod === 10)),
    `${(catalog.body?.data ?? []).length} plan(s)`);

  /* ---- state A: on the free plan, quota 1 ---------------------------- */
  /*
    🔴 THE ADMIN CONSUME PATH, WITH AN EXPLICIT OWNER.

    /entitlements/consume is ConsumeAsAdminAsync — there is no school-facing
    consume endpoint, because consuming is something the PRODUCT does when a
    school posts a job, never something a client asks for directly. The first
    draft of this suite called it with the school's token and would have
    measured 403s while claiming to measure quotas.

    ⚠️ AND A REFUSAL IS A NON-2xx CARRYING ITS OWN CODE (2.21/2.12), not a 200
    with allowed:false. So `allowed` is read from the HTTP status, and the code
    from the envelope — which is exactly how a real client branches.
  */
  const consume = async (ref) => {
    const r = await j(`${APP}/entitlements/consume`, {
      method: 'POST', headers: H(adminToken),
      body: JSON.stringify({
        ownerUid: owner, featureCode: 'JOB_POST', units: 1,
        refEntityTypeId: 1, refEntityUid: ref, notes: 'billing-suite',
      }),
    });

    return {
      http: r.http,
      allowed: r.http === 200,
      code: r.http === 200 ? (r.body?.code ?? null) : (r.body?.code ?? null),
      used: r.body?.data?.quotaUsed ?? null,
      remaining: r.body?.data?.quotaRemaining ?? null,
    };
  };

  const a1 = await consume('33333333-0000-0000-0000-000000000001');
  const a2 = await consume('33333333-0000-0000-0000-000000000002');

  console.log(`\n    STATE A (free, quota 1)`);
  console.log(`      consume 1: HTTP ${a1.http} ${a1.code ?? ''} remaining ${a1.remaining}`);
  console.log(`      consume 2: HTTP ${a2.http} ${a2.code ?? ''}`);

  check('🔴 on the FREE plan the quota is 1 — the second consume is refused',
    a1.allowed && !a2.allowed && a2.code === 'QUOTA_EXHAUSTED',
    `first allowed, second ${a2.code}`);

  /* ---- the request: nothing may change ------------------------------- */
  const ledgerBefore = ledgerCount(owner);
  const subBefore = subRow(owner);

  const requested = await j(`${APP}/billing/plan-change`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ planId: fixturePlanId, paymentModeId: 2 }),
  });

  const paymentId = requested.body?.data?.paymentId;

  console.log(`\n    requested: ${requested.body?.data?.requestNo}, payment ${paymentId}, quoted ${requested.body?.data?.priceQuoted}`);

  check('the request is recorded, with the RequestNo a school quotes (2.46)',
    requested.http === 200 && /^PLN-\d{4}-\d{5}$/.test(requested.body?.data?.requestNo ?? ''),
    requested.body?.data?.requestNo);

  const a3 = await consume('33333333-0000-0000-0000-000000000003');

  console.log(`    STATE B (requested, NOT paid)`);
  console.log(`      subscription plan: ${subRow(owner).planId} (was ${subBefore.planId})`);
  console.log(`      ledger rows: ${ledgerCount(owner)} (was ${ledgerBefore})`);
  console.log(`      consume: HTTP ${a3.http} ${a3.code ?? ''}`);

  /*
    🔴 PENDING CHANGES NOTHING. The whole risk of a billing phase is a product
    that gives capability away for an unpaid intention.
  */
  check('🔴 PENDING GRANTS NOTHING — the subscription is untouched',
    subRow(owner).planId === subBefore.planId
    && subRow(owner).endsOn === subBefore.endsOn,
    `still plan ${subRow(owner).planId}`);

  check('🔴 …and the consume is STILL refused on the free quota',
    !a3.allowed && a3.code === 'QUOTA_EXHAUSTED', a3.code);

  check('🔴 …and the ledger gained nothing from the request',
    ledgerCount(owner) === ledgerBefore,
    `${ledgerCount(owner)} rows, unchanged`);

  /* ---- verify: the seam fires --------------------------------------- */
  const verified = await j(`${APP}/billing/payments/${paymentId}/verify`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ amount: 5000, paymentModeId: 2, referenceNo: 'UTR-SUITE-1' }),
  });

  console.log(`\n    verify: HTTP ${verified.http}, receipt ${verified.body?.data?.receiptNo},`
    + ` activated ${verified.body?.data?.activationCompleted}`);

  check('🔴 the admin verifies and the subscription activates — ONE call',
    verified.http === 200 && verified.body?.data?.verified === true
      && verified.body?.data?.activationCompleted === true,
    `receipt ${verified.body?.data?.receiptNo}`);

  check('…and the receipt is numbered per IST year from a counter (2.46)',
    /^RCP-\d{4}-\d{5}$/.test(verified.body?.data?.receiptNo ?? ''),
    verified.body?.data?.receiptNo);

  const a4 = await consume('33333333-0000-0000-0000-000000000004');

  console.log(`    STATE C (paid)`);
  console.log(`      subscription plan: ${subRow(owner).planId}, endsOn ${subRow(owner).endsOn}`);
  console.log(`      consume: HTTP ${a4.http} used ${a4.used} remaining ${a4.remaining}`);

  check('🔴 THE SAME CONSUME NOW RUNS ON THE NEW PLAN\'S QUOTA',
    a4.allowed, `allowed, ${a4.remaining} of 10 left`);

  /*
    🔴 USED SURVIVES THE PLAN CHANGE (6.5-D). The ledger is keyed on
    owner + feature + PERIOD and never on plan, and the period is the IST
    calendar month — so the one consume that succeeded on the free plan is
    still counted against the paid plan's allowance in the same month.
  */
  check('🔴 …and `used` SURVIVED the plan change (6.5-D)',
    a4.used === 1,
    `quotaUsed ${a4.used} — the one from the free period still counts`);

  check('…the old subscription row is CLOSED, not edited',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_subscriptions
       WHERE OwnerUid = '${owner}' AND PlanId = 1 AND StatusId = 2 AND Is_Deleted = 0;`) === '1',
    'the free row is EXPIRED with its EndsOn stamped');

  // =========================================================================
  section('2. 🔴 MISMATCH — a different amount needs a remark');
  // =========================================================================

  /* A second owner-side request needs the first one closed, which it is. */
  const req2 = await j(`${APP}/billing/plan-change`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ planId: fixturePlanId, paymentModeId: 3 }),
  });

  const pay2 = req2.body?.data?.paymentId;

  const short = await j(`${APP}/billing/payments/${pay2}/verify`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ amount: 4900, paymentModeId: 3, referenceNo: 'CHQ-1' }),
  });

  console.log(`\n    4900 against 5000, no remark: HTTP ${short.http} ${short.body?.code ?? ''}`);

  check('🔴 a short amount with NO remark is refused (6.5-B)',
    short.http === 400 && short.body?.code === 'VALIDATION_FAILED',
    `HTTP ${short.http} ${short.body?.code}`);

  const withRemark = await j(`${APP}/billing/payments/${pay2}/verify`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({
      amount: 4900, paymentModeId: 3, referenceNo: 'CHQ-1',
      remarks: 'Bank deducted charges in transit',
    }),
  });

  check('🔴 …and with a remark it is RECORDED, not refused',
    withRemark.http === 200 && withRemark.body?.data?.verified === true,
    `receipt ${withRemark.body?.data?.receiptNo}`);

  const recorded = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(Amount AS varchar(20)) + '|' + CAST(PriceQuoted AS varchar(20)) + '|' + ISNULL(Remarks, 'NULL')
      FROM t_mdm_request_payments WHERE PaymentId = ${pay2};`)[0] ?? '';

  console.log(`    recorded: ${recorded}`);

  check('🔒 the ledger records what ARRIVED beside what was QUOTED',
    recorded.startsWith('4900') && recorded.includes('5000'),
    recorded.split('|').slice(0, 2).join(' received, ') + ' quoted');

  const detail = await j(`${APP}/billing/payments/${pay2}`, { headers: H(adminToken) });

  check('🔴 …and the difference is visible, computed in SQL so the sign is one answer',
    detail.body?.data?.amountDiffers === true && detail.body?.data?.shortBy === 100,
    `shortBy ${detail.body?.data?.shortBy}, differs ${detail.body?.data?.amountDiffers}`);

  // =========================================================================
  section('3. 🔴 IDEMPOTENT — verifying twice');
  // =========================================================================

  const again = await j(`${APP}/billing/payments/${pay2}/verify`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ amount: 4900, paymentModeId: 3, remarks: 'again' }),
  });

  console.log(`\n    second verify: already ${again.body?.data?.alreadyVerified},`
    + ` receipt ${again.body?.data?.receiptNo}, activated ${again.body?.data?.activationCompleted}`);

  check('🔴 the retry reports Status 1 and says it was already verified',
    again.http === 200 && again.body?.data?.alreadyVerified === true,
    'alreadyVerified true');

  check('…with the SAME receipt number — one payment, one receipt',
    again.body?.data?.receiptNo === withRemark.body?.data?.receiptNo,
    again.body?.data?.receiptNo);

  check('🔴 …and ONE activation, not two',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_subscriptions
       WHERE SourcePaymentUid = '${req2.body?.data?.paymentUid}' AND Is_Deleted = 0;`) === '1',
    'one subscription row for this payment');

  check('…and exactly ONE receipt row exists for it',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_mdm_payment_receipts
       WHERE PaymentId = ${pay2} AND Is_Deleted = 0;`) === '1',
    'one receipt');

  // =========================================================================
  section('4. 🔴 THE RACE — two verifications on ONE wall-clock instant');
  // =========================================================================

  const req3 = await j(`${APP}/billing/plan-change`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ planId: fixturePlanId, paymentModeId: 4 }),
  });

  const pay3 = req3.body?.data?.paymentId;
  const uid3 = req3.body?.data?.paymentUid;

  /*
    🔴 BOTH SESSIONS WAIT FOR THE SAME WALL-CLOCK INSTANT.

    Firing two HTTP calls and hoping they overlap is a test that usually runs
    sequentially. WAITFOR TIME is the 2C pattern that caught the approval
    engine's concurrency bug, and 2.64 used it on this same lock.

    ⚠️ It drives the PROCEDURES rather than the endpoint, deliberately: the race
    being tested is inside the database, and HTTP would add scheduling noise on
    top of the thing under test.
  */
  /*
    🔴 EACH BATCH ARMS ITS OWN INSTANT, AND THE FIRST DRAFT DID NOT.

    It computed ONE wall-clock time for all four sessions and then ran them in
    two sequential batches. By the time the second batch started, that instant
    had passed — and WAITFOR TIME waits for the named time TODAY, so a time
    already gone means it waits until TOMORROW. Two sessions sat in a WAITFOR
    for ten minutes before sys.dm_exec_requests was asked what they were doing.

    ⚠️ The symptom is worth recording because it looks nothing like its cause: a
    suite that hangs with no output and no error, and a wait_time that keeps
    climbing. Nothing is deadlocked and nothing is wrong with the code under
    test.
  */
  const armed = (seconds = 5) => {
    const at = new Date(Date.now() + seconds * 1000);
    return at.toTimeString().slice(0, 8);
  };

  const verifier = (hhmmss) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_mdm;
     WAITFOR TIME '${hhmmss}';
     EXEC USP_VerifyPayment @PaymentId=${pay3}, @Amount=5000, @PaymentModeId=4,
       @VerifiedByUserId=40, @VerifiedVia='ADMIN';`], { encoding: 'utf8' });

  const activator = (hhmmss) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_app;
     WAITFOR TIME '${hhmmss}';
     EXEC USP_ActivateSubscription @OwnerUid='${owner}', @PlanId=${fixturePlanId},
       @PaymentUid='${uid3}', @DurationDays=30, @ActorUserId=40;`], { encoding: 'utf8' });

  const verifyAt = armed();
  console.log(`\n    two VERIFY sessions armed for ${verifyAt} …`);
  const [v1, v2] = await Promise.all([verifier(verifyAt), verifier(verifyAt)]);

  const activateAt = armed();
  console.log(`    two ACTIVATE sessions armed for ${activateAt} …`);
  const [c1, c2] = await Promise.all([activator(activateAt), activator(activateAt)]);

  const firstLine = (r) => (r.stdout.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/Changed database context/.test(l))[0] ?? '');

  console.log(`      verify A  : ${firstLine(v1).slice(0, 80)}`);
  console.log(`      verify B  : ${firstLine(v2).slice(0, 80)}`);
  console.log(`      activate A: ${firstLine(c1).slice(0, 70)}`);
  console.log(`      activate B: ${firstLine(c2).slice(0, 70)}\n`);

  const receipts3 = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM t_mdm_payment_receipts
     WHERE PaymentId = ${pay3} AND Is_Deleted = 0;`);

  const subs3 = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_subscriptions
     WHERE SourcePaymentUid = '${uid3}' AND Is_Deleted = 0;`);

  check('🔴 two simultaneous verifications produce exactly ONE receipt',
    receipts3 === '1', `${receipts3} receipt(s)`);

  check('🔴 two simultaneous activations produce exactly ONE subscription',
    subs3 === '1', `${subs3} subscription row(s)`);

  check('🔒 …and still only one ACTIVE subscription for the owner',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM t_app_subscriptions
       WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`) === '1',
    'UQ_OneActivePerOwner held');

  // =========================================================================
  section('5. 🔒 EXPIRY IS DERIVED — no job, nothing written');
  // =========================================================================

  /*
    EndsOn at 00:00 IST TODAY: the subscription ended at the IST day boundary
    and "now" is later the same IST day. That is the boundary case, and it is
    the one a UTC-only comparison gets wrong.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions
       SET EndsOn = dbo.fn_IstDateToUtc(dbo.fn_IstToday())
     WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`);

  const row = subRow(owner);
  const myPlan = await j(`${APP}/billing/my-plan`, { headers: H(ownerToken) });

  console.log(`\n    DB ROW   : plan ${row.planId}, status ${row.statusId}, isActive ${row.isActive},`
    + ` endsOn ${row.endsOn}, fn_SubscriptionInForce ${row.inForce}`);
  console.log(`    RESPONSE : plan ${myPlan.body?.data?.planId}, inForce ${myPlan.body?.data?.inForce},`
    + ` onFreeBaseline ${myPlan.body?.data?.onFreeBaseline}`);
  console.log(`    IST now  : ${scalar(`SET NOCOUNT ON; USE jp_app; SELECT CONVERT(varchar(30), dbo.fn_ToIst(SYSUTCDATETIME()), 126);`)}\n`);

  check('🔴 the row is still ACTIVE and the predicate says NOT in force',
    row.statusId === 1 && row.isActive === '1' && row.inForce === '0',
    `status 1, isActive 1, inForce 0 — nothing was swept`);

  check('🔒 …and the API agrees, reporting the FREE baseline',
    myPlan.body?.data?.inForce === false && myPlan.body?.data?.onFreeBaseline === true
      && myPlan.body?.data?.planId === 1,
    `plan ${myPlan.body?.data?.planId}, onFreeBaseline true`);

  const lapsedConsume = await consume('33333333-0000-0000-0000-000000000009');

  console.log(`    consume on a lapsed plan: HTTP ${lapsedConsume.http} ${lapsedConsume.code ?? ''}`);

  /*
    🔒 THE POINT OF 6.5-C. Before this phase a lapsed paid subscription
    answered SUBSCRIPTION_INACTIVE and the account could do nothing — worse off
    than one that never paid. Now it works at the free baseline.
  */
  check('🔒 a lapsed account is NOT dead — it is not SUBSCRIPTION_INACTIVE',
    lapsedConsume.code !== 'SUBSCRIPTION_INACTIVE',
    `code ${lapsedConsume.code ?? 'null (allowed)'}`);

  check('🔴 …and the FREE quota is what applies, not the paid one it stopped paying for',
    lapsedConsume.code === 'QUOTA_EXHAUSTED',
    'quota 1 on the free plan, already spent this month');

  check('🔒 …and NOTHING was written to make that true',
    subRow(owner).statusId === 1 && subRow(owner).isActive === '1',
    'the row is exactly as it was — derived, never swept');

  // =========================================================================
  section('6. 🔴 DOWNGRADE BELOW USED — refused, never negative');
  // =========================================================================

  /*
    Put the owner back in force on the paid plan, quota 5, and use 3.

    🔴 EVERY JOB_POST LEDGER ROW FOR THIS OWNER IS CLEARED, NOT ONLY THIS
    SUITE'S. It used to clear only rows tagged `billing-suite%`, which was
    right while JOB_POST was FREE and nothing else could write one. Since SR-4
    a job publish CONSUMES, so any earlier suite that published against the
    shared fixture owner leaves a row here — and the assertions below state
    EXACT counts ("quota 5 and 3 used").

    Measured: "used 4 of 5" where 3 was expected, in the full run only and
    never alone. A suite that asserts an exact count has to own the state it
    is counting.

    ⚠️ The explanation lives HERE rather than inside the SQL string: a long
    comment shipped to sqlcmd through -Q is prose travelling through a command
    line for no benefit, and it broke this statement once already.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger
     WHERE OwnerUid = '${owner}' AND FeatureId = ${JOB_POST};
    UPDATE t_app_subscriptions SET EndsOn = DATEADD(day, 30, SYSUTCDATETIME())
     WHERE OwnerUid = '${owner}' AND StatusId = 1 AND Is_Deleted = 0;`);

  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_plan_features SET QuotaPerPeriod = 5
     WHERE PlanId = ${fixturePlanId} AND FeatureId = ${JOB_POST};`);

  for (let i = 1; i <= 3; i += 1) {
    await consume(`33333333-0000-0000-0000-00000000001${i}`);
  }

  const used3 = await j(`${APP}/billing/my-plan`, { headers: H(ownerToken) });
  const usage3 = (used3.body?.data?.usage ?? []).find((u) => u.featureCode === 'JOB_POST');

  console.log(`\n    quota 5, used ${usage3?.used}, remaining ${usage3?.remaining}`);

  check('premise: quota 5 and 3 used',
    usage3?.used === 3 && usage3?.allowed === 5 && usage3?.remaining === 2,
    `used ${usage3?.used} of ${usage3?.allowed}, ${usage3?.remaining} left`);

  /* The downgrade: the plan's quota drops below what is already used. */
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_plan_features SET QuotaPerPeriod = 2
     WHERE PlanId = ${fixturePlanId} AND FeatureId = ${JOB_POST};`);

  const afterDown = await j(`${APP}/billing/my-plan`, { headers: H(ownerToken) });
  const usageDown = (afterDown.body?.data?.usage ?? []).find((u) => u.featureCode === 'JOB_POST');

  const refused = await consume('33333333-0000-0000-0000-000000000020');

  console.log(`    after downgrade to 2: used ${usageDown?.used}, allowed ${usageDown?.allowed},`
    + ` remaining ${usageDown?.remaining}`);
  console.log(`    next consume: HTTP ${refused.http} ${refused.code ?? ''}\n`);

  check('🔴 used stays counted — a downgrade does not forgive what was spent',
    usageDown?.used === 3 && usageDown?.allowed === 2,
    `used 3, allowed 2`);

  check('🔴 remaining is clamped at ZERO, never negative (6.5-D)',
    usageDown?.remaining === 0,
    `remaining ${usageDown?.remaining}, not -1`);

  check('🔴 …and the next consume is refused with the quota code',
    !refused.allowed && refused.code === 'QUOTA_EXHAUSTED', refused.code);

  check('🔒 …and the ledger still agrees — three live rows, recomputed not stored',
    ledgerCount(owner) === 3,
    `${ledgerCount(owner)} live ledger rows`);

  // =========================================================================
  section('7. 🔒 NEGATIVES — who may verify a payment');
  // =========================================================================

  const req4 = await j(`${APP}/billing/plan-change`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ planId: fixturePlanId }),
  });

  const pay4 = req4.body?.data?.paymentId ?? 0;

  const bySchool = await j(`${APP}/billing/payments/${pay4}/verify`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ amount: 5000, paymentModeId: 2 }),
  });

  const byTeacher = await j(`${APP}/billing/payments/${pay4}/verify`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ amount: 5000, paymentModeId: 2 }),
  });

  console.log(`\n    school verifying its own payment : HTTP ${bySchool.http} ${bySchool.body?.code ?? ''}`);
  console.log(`    teacher verifying it             : HTTP ${byTeacher.http} ${byTeacher.body?.code ?? ''}\n`);

  /*
    🔒 A school verifying its own payment is the entire attack, and the seed
    asserts the closed set of PAYMENT.VERIFY holders for the same reason.
  */
  check('🔒 a SCHOOL cannot verify its own payment — 403',
    bySchool.http === 403, `HTTP ${bySchool.http}`);

  check('🔒 a TEACHER cannot either — 403',
    byTeacher.http === 403, `HTTP ${byTeacher.http}`);

  check('🔴 …and the payment is untouched by either attempt',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(PaymentStatusId AS varchar(3)) FROM t_mdm_request_payments WHERE PaymentId = ${pay4};`) === '1',
    'still PENDING');

  /*
    🔴 AND THE BYPASS THAT NEARLY SHIPPED.

    A plan change has a request row — that is where its RequestNo and audit
    trail live (2.46). So an admin could reach it through the GENERIC approvals
    endpoint, which knows nothing about payments.

    What that did before the guard: the request went to APPROVED, the
    orchestration switch had no arm for type 5 so it reported failure, the
    payment stayed PENDING, and nothing was activated. Not an entitlement hole
    — but "one open request per owner" keys on PENDING, so the school could
    then raise a SECOND request and have two payments queued for one plan.

    ⚠️ Found by asking what the generic endpoint does with a new request type,
    not by a failing test: every suite was green, because none of them had any
    reason to action a type that did not exist when they were written.
  */
  const bypass = await j(`${APP}/approvals/${req4.body?.data?.requestId}/action`, {
    method: 'POST', headers: H(adminToken),
    body: JSON.stringify({ actionTypeId: 1, remarks: 'approving a plan change directly' }),
  });

  console.log(`    admin approving the plan-change REQUEST directly: HTTP ${bypass.http} ${bypass.body?.code ?? ''}`);

  check('🔴 the generic approve route REFUSES a plan change — it is paid for, not approved',
    bypass.http >= 400 && /payment/i.test(bypass.body?.message ?? ''),
    `HTTP ${bypass.http} — "${(bypass.body?.message ?? '').slice(0, 64)}"`);

  check('🔴 …and the request is still PENDING, so a second one cannot be raised',
    scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(StatusId AS varchar(3)) FROM t_mdm_approval_requests
       WHERE RequestId = ${req4.body?.data?.requestId};`) === '1',
    'StatusId 1 (PENDING)');

  const teacherCatalog = await j(`${APP}/billing/plans`, { headers: H(teacherToken) });

  check('🔒 a teacher\'s catalog contains no school plan (2.39 — type from the token)',
    (teacherCatalog.body?.data ?? []).every((p) => p.userTypeId === 3),
    `${(teacherCatalog.body?.data ?? []).length} plan(s), all teacher-side`);

  const teacherWantsSchoolPlan = await j(`${APP}/billing/plan-change`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ planId: fixturePlanId }),
  });

  check('🔒 …and asking for one by id answers 404, not 403 (2.6)',
    teacherWantsSchoolPlan.http === 404,
    `HTTP ${teacherWantsSchoolPlan.http} ${teacherWantsSchoolPlan.body?.code}`);
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  section('8. EXIT — the fixture gone, the shipped state back');

  try {
    restore();

    const left = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans
       WHERE Price > 0 AND IsPublic = 1 AND IsDefault = 0 AND Is_Deleted = 0;`));

    /*
      ⚠️ WAS "NO priced public plan is left". That was 008's rule and 011
      enforced it; SR-4 replaced it with a closed set of four, two of which
      are priced on purpose. What must be true after this suite is that ITS
      OWN fixtures are gone — which is what 011's reshaped guard checks at
      build time, and what this checks here.
    */
    const strays = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM m_mdm_plans
       WHERE PlanCode LIKE 'BILLING[_]SUITE%' AND Is_Deleted = 0;`));

    check('🔴 exit: this suite\'s own plan fixtures are gone — 011\'s guard stays green',
      strays === 0, `${strays} BILLING_SUITE plan(s) left, ${left} priced catalogue plan(s) (expect 2)`);

    /*
      🔴 THE CATALOGUE A REGRESSION RUN MUST NOT EAT. This suite builds its own
      mappings and restoreCatalogue() puts the real ones back — if that ever
      stops working, the next suite in the run inherits an empty catalogue and
      fails for a reason that has nothing to do with it.
    */
    check('🔴 exit: the SR-4 catalogue is back, intact',
      catalogueState().ok, catalogueSummary());

    const o = ownerUid();

    check('exit: the owner is back on the free plan, in force',
      subRow(o).planId === 1 && subRow(o).inForce === '1',
      `plan ${subRow(o).planId}, inForce ${subRow(o).inForce}`);

    check('exit: no subscription row sourced from a suite payment is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_subscriptions
         WHERE SourcePaymentUid IS NOT NULL AND Is_Deleted = 0;`) === '0',
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
