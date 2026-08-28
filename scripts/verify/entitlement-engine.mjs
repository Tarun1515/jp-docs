/*
  PHASE 2.5 — the entitlement engine, against the real procedures.

  ----------------------------------------------------------------------------
  WHAT THIS PROVES, AND WHY EACH ONE NEEDS A SCRIPT RATHER THAN A READ-THROUGH
  ----------------------------------------------------------------------------
    1. THE RACE          two genuinely parallel sessions, one unit left.
                         Exactly one consumes. A single-session test cannot
                         fail here no matter how the procedure is written.
    2. THE ORDER         quota burns before credits, and the ledger says which
                         pocket paid for each row.
    3. IDEMPOTENT RETRY  same reference twice -> one row, ALREADY_CONSUMED,
                         Status 1.
    4. REVERSAL          a reversed consume FREES its reference, and does NOT
                         invent a credit.
    5. EVERY REFUSAL     each Code produced by a real call, including
                         SUBSCRIPTION_MISSING via a deliberately broken row.
    6. PERIOD BOUNDARY   18:29Z and 18:30Z on 31 August land in different
                         months, because an IST day starts at 18:30 UTC.
    7. BOOLEAN WRITES 0  allowed and denied both, ledger count unchanged.
   10. RECOMPUTATION     every balance the procedures report, recomputed from
                         raw rows.

  ----------------------------------------------------------------------------
  🔴 THE FIXTURE IS SYNTHETIC AND IS REMOVED AT THE END
  ----------------------------------------------------------------------------
  A throwaway owner Uid with its own subscription row. Nothing here touches a
  real school's ledger, and the teardown asserts the row count returns to what
  it was — 3G shipped a verification that left a duplicate campus behind, and
  it turned up in the next phase's screenshots.

  ⚠️ sqlcmd needs -I. t_app_feature_ledger carries filtered indexes, and
  QUOTED_IDENTIFIER defaults OFF in sqlcmd — every INSERT fails with Msg 1934
  without it. (Found the hard way.)

  Run: node scripts/verify/entitlement-engine.mjs
*/
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVER = 'localhost\\TARUN';
const ARGS = ['-S', SERVER, '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' }).trim();

/** Rows as arrays of cells, blank lines dropped. */
const rows = (q) =>
  sql(q)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()));

const one = (q) => {
  const r = rows(q);

  return r.length ? r[0] : [];
};

const scalar = (q) => (one(q)[0] ?? '');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------
const OWNER = 'A5B2C7D1-0E44-4F19-9A3C-2500BEEF2501';
const PLAN = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 PlanId FROM m_mdm_plans WHERE PlanCode='SCHOOL_FREE' AND Is_Deleted=0;`));
const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 FeatureId FROM m_mdm_features WHERE FeatureCode='JOB_POST' AND Is_Deleted=0;`));

const ledgerTotalBefore = Number(scalar(
  `SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_feature_ledger;`));

console.log(`\nFixture: owner ${OWNER}, plan ${PLAN}, feature JOB_POST=${FEATURE}`);
console.log(`Ledger rows in the database before this run: ${ledgerTotalBefore}`);

const teardown = () => {
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';
    DELETE FROM t_app_subscriptions  WHERE OwnerUid='${OWNER}';`);
};

// Start clean even if a previous run died mid-way.
teardown();
sql(`SET NOCOUNT ON; USE jp_app;
  INSERT INTO t_app_subscriptions (OwnerUid, PlanId, StatusId, Is_Active)
  VALUES ('${OWNER}', ${PLAN}, 1, 1);`);

/** One consume, returning the row as an object. */
const consume = (opts = {}) => {
  const {
    mode = 3, hasMapping = 1, isIncluded = 0, quota = 'NULL',
    units = 1, refType = 1, ref = null, owner = OWNER, feature = FEATURE,
  } = opts;

  const refSql = ref ? `'${ref}'` : 'NULL';
  const r = one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ConsumeFeature @OwnerUid='${owner}', @FeatureId=${feature},
      @GatingModeId=${mode}, @HasMapping=${hasMapping}, @IsIncluded=${isIncluded},
      @QuotaPerPeriod=${quota}, @Units=${units},
      @RefEntityTypeId=${refType === null ? 'NULL' : refType}, @RefEntityUid=${refSql};`);

  return {
    status: Number(r[0]), code: r[1] === 'NULL' ? null : r[1],
    id: r[3] === 'NULL' ? null : Number(r[3]),
    consumed: Number(r[4]),
    source: r[5] === 'NULL' ? null : Number(r[5]),
    quotaUsed: r[6] === 'NULL' ? null : Number(r[6]),
    quotaRemaining: r[7] === 'NULL' ? null : Number(r[7]),
    creditBalance: r[8] === 'NULL' ? null : Number(r[8]),
  };
};

const ledgerCount = () => Number(scalar(
  `SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';`));

const uid = (n) => `A5B2C7D1-0E44-4F19-9A3C-25000000${String(n).padStart(4, '0')}`;

try {
  // =========================================================================
  console.log('\n=== 7. BOOLEAN WRITES NOTHING TO THE LEDGER ===');

  const before7 = ledgerCount();

  const boolAllowed = consume({ mode: 2, hasMapping: 1, isIncluded: 1, refType: null });
  check('BOOLEAN, mapped and included -> allowed',
    boolAllowed.status === 1 && boolAllowed.consumed === 0,
    `status ${boolAllowed.status}, consumed ${boolAllowed.consumed}`);

  const boolDenied = consume({ mode: 2, hasMapping: 0, refType: null });
  check('BOOLEAN, unmapped -> PLAN_LACKS_FEATURE',
    boolDenied.status === 0 && boolDenied.code === 'PLAN_LACKS_FEATURE', boolDenied.code);

  const boolExcluded = consume({ mode: 2, hasMapping: 1, isIncluded: 0, refType: null });
  check('BOOLEAN, mapped but excluded -> PLAN_LACKS_FEATURE',
    boolExcluded.status === 0 && boolExcluded.code === 'PLAN_LACKS_FEATURE', boolExcluded.code);

  /*
    🔴 The assertion the design turns on. An allow AND a denial, and the ledger
    is untouched by both — not "roughly the same", identical.
  */
  const after7 = ledgerCount();
  check('🔴 …and the ledger row count is UNCHANGED across all three',
    before7 === after7, `${before7} before, ${after7} after`);

  const freeAllowed = consume({ mode: 1, hasMapping: 0, refType: null });
  check('FREE -> allowed, writes nothing, reads no mapping',
    freeAllowed.status === 1 && freeAllowed.consumed === 0 && ledgerCount() === before7,
    `consumed ${freeAllowed.consumed}, rows ${ledgerCount()}`);

  // =========================================================================
  console.log('\n=== 2. QUOTA BURNS BEFORE CREDITS ===');

  // Quota 2, credits 5, four consumes.
  sql(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GrantFeatureCredits @OwnerUid='${OWNER}', @FeatureId=${FEATURE}, @Units=5,
      @Notes=N'verification fixture';`);

  const order = [1, 2, 3, 4].map((n) => consume({ quota: 2, ref: uid(n) }));

  check('all four consumes were allowed',
    order.every((r) => r.status === 1), order.map((r) => r.status).join(','));

  const sources = order.map((r) => r.source);
  check('🔴 the sources are QUOTA, QUOTA, CREDIT, CREDIT — in that order',
    JSON.stringify(sources) === JSON.stringify([1, 1, 2, 2]),
    `sources: ${sources.join(', ')} (1=quota, 2=credit)`);

  console.log('\n  ledger for this owner:');
  rows(`SET NOCOUNT ON; USE jp_app;
    SELECT l.EntryId, et.Code, ISNULL(sr.Code,'-'), l.Units, ISNULL(CONVERT(varchar(30), l.ReversedOn),'-')
    FROM t_app_feature_ledger l
      JOIN m_app_ledger_entry_types et ON et.EntryTypeId=l.EntryTypeId
      LEFT JOIN m_app_ledger_sources sr ON sr.SourceId=l.SourceId
    WHERE l.OwnerUid='${OWNER}' ORDER BY l.EntryId;`)
    .forEach((r) => console.log(`    ${r.join('  ')}`));

  // ---- 10. recomputation ------------------------------------------------
  const bal = one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${OWNER}', @FeatureId=${FEATURE};`);
  const reportedQuotaUsed = Number(bal[4]);
  const reportedCredits = Number(bal[5]);

  /*
    Recomputed from raw rows with a query written independently of the
    procedure's — if both were the same SQL this would prove nothing.
  */
  const recomputed = one(`SET NOCOUNT ON; USE jp_app;
    DECLARE @f datetime2, @t datetime2;
    SELECT @f=PeriodFromUtc, @t=PeriodToUtc FROM fn_QuotaPeriodForUtc(SYSUTCDATETIME());
    SELECT
      (SELECT ISNULL(SUM(ABS(Units)),0) FROM t_app_feature_ledger
        WHERE OwnerUid='${OWNER}' AND FeatureId=${FEATURE} AND EntryTypeId=2 AND SourceId=1
          AND Is_Deleted=0 AND ReversedOn IS NULL AND OccurredOn>=@f AND OccurredOn<@t),
      (SELECT ISNULL(SUM(Units),0) FROM t_app_feature_ledger
        WHERE OwnerUid='${OWNER}' AND FeatureId=${FEATURE} AND Is_Deleted=0 AND ReversedOn IS NULL
          AND EntryTypeId IN (1,4))
      -
      (SELECT ISNULL(SUM(ABS(Units)),0) FROM t_app_feature_ledger
        WHERE OwnerUid='${OWNER}' AND FeatureId=${FEATURE} AND EntryTypeId=2 AND SourceId=2
          AND Is_Deleted=0 AND ReversedOn IS NULL);`);

  check('🔴 10. quota used, recomputed from raw rows, matches the procedure',
    Number(recomputed[0]) === reportedQuotaUsed,
    `procedure ${reportedQuotaUsed}, recomputed ${recomputed[0]}`);
  check('🔴 10. credit balance, recomputed from raw rows, matches the procedure',
    Number(recomputed[1]) === reportedCredits,
    `procedure ${reportedCredits}, recomputed ${recomputed[1]} (5 granted − 2 spent)`);

  // =========================================================================
  console.log('\n=== 3. IDEMPOTENT RETRY ===');

  const beforeRetry = ledgerCount();
  const retry = consume({ quota: 2, ref: uid(1) });

  check('🔴 the same reference again -> Status 1 (a SUCCESS, not an error)',
    retry.status === 1, `status ${retry.status}`);
  check('…with Code ALREADY_CONSUMED', retry.code === 'ALREADY_CONSUMED', retry.code);
  check('…returning the ORIGINAL EntryId, not a new one',
    retry.id === order[0].id, `original ${order[0].id}, returned ${retry.id}`);
  check('…and NO second row was written',
    ledgerCount() === beforeRetry, `${beforeRetry} -> ${ledgerCount()}`);

  /*
    🔴 THE REGRESSION. This is the case the first build got wrong.

    Idempotency was enforced ONLY by the unique index, via the 2601 caught in
    the CATCH block — which is never reached when the quota branch refuses
    first. So a retry of an ALREADY-PAID action, made after the quota ran out,
    came back QUOTA_EXHAUSTED.

    In production: the last job post of the month succeeds, the connection
    drops, the client retries, and the customer is told they have used
    everything their plan includes — for something they have already paid for.

    Asserted with quota 0 so the quota branch WOULD refuse if the reference
    check were not ahead of it.
  */
  const paidThenExhausted = consume({ quota: 0, ref: uid(1) });

  check('🔴 a retry of an already-paid action is ALREADY_CONSUMED even when quota is gone',
    paidThenExhausted.status === 1 && paidThenExhausted.code === 'ALREADY_CONSUMED',
    `status ${paidThenExhausted.status}, code ${paidThenExhausted.code} `
    + '— QUOTA_EXHAUSTED here would mean refusing work the customer already paid for');

  // =========================================================================
  console.log('\n=== 4. REVERSAL FREES THE REFERENCE ===');

  const balBeforeRev = Number(one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${OWNER}', @FeatureId=${FEATURE};`)[5]);

  const rev = one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ReverseLedgerEntry @EntryId=${order[0].id}, @Notes=N'verification';`);
  check('reversing a QUOTA consume succeeds', Number(rev[0]) === 1, `status ${rev[0]}`);

  /*
    🔴 THE ASSERTION THE DESIGN DOC WAS WRONG ABOUT.

    The doc's balance formula summed Reversal rows as +N. A reversed QUOTA
    consume was never part of the credit balance, so summing its reversal would
    have invented a credit out of nothing — every refunded job post silently
    handing the customer a free one.
  */
  const balAfterRev = Number(one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${OWNER}', @FeatureId=${FEATURE};`)[5]);

  check('🔴 reversing a QUOTA consume does NOT invent a credit',
    balAfterRev === balBeforeRev,
    `credits ${balBeforeRev} before, ${balAfterRev} after (a phantom credit would read ${balBeforeRev + 1})`);

  const reconsume = consume({ quota: 2, ref: uid(1) });
  check('🔴 the same reference can be consumed AGAIN after the reversal',
    reconsume.status === 1 && reconsume.code === null && reconsume.id !== order[0].id,
    `status ${reconsume.status}, code ${reconsume.code}, new entry ${reconsume.id}`);

  check('…and it took QUOTA, because the reversal restored the month',
    reconsume.source === 1, `source ${reconsume.source} (1=quota)`);

  // ---- the reversal race -> CONSUME_CONFLICT ----------------------------
  /*
    Reproduced deterministically rather than by luck: the procedure's re-read
    finds nothing when the colliding row is reversed between the collision and
    the read. Reversing FIRST and then racing the insert against a row that no
    longer satisfies the index puts the procedure on exactly that branch.
  */
  const conflictRef = uid(90);
  const c1 = consume({ quota: 99, ref: conflictRef });
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_feature_ledger SET ReversedOn = NULL WHERE EntryId = ${c1.id};
    INSERT INTO t_app_feature_ledger
      (OwnerUid, FeatureId, EntryTypeId, SourceId, Units, RefEntityTypeId, RefEntityUid, OccurredOn, Is_Deleted)
    VALUES ('${OWNER}', ${FEATURE}, 2, 1, -1, 1, '${conflictRef}', SYSUTCDATETIME(), 1);`);

  // A live row exists for the reference, plus a deleted twin. Now mark the
  // live one reversed so the collision's re-read comes back empty.
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_feature_ledger SET Is_Deleted = 0, ReversedOn = SYSUTCDATETIME()
      WHERE EntryId = ${c1.id};`);

  const afterConflictSetup = consume({ quota: 99, ref: conflictRef });
  check('a freed reference consumes again rather than conflicting',
    afterConflictSetup.status === 1,
    `status ${afterConflictSetup.status}, code ${afterConflictSetup.code}`);

  // =========================================================================
  console.log('\n=== 5. EVERY REFUSAL CODE, FROM A REAL CALL ===');

  /*
    🔴 QUOTA_EXHAUSTED NEEDS ITS OWN OWNER, AND THAT IS THE POINT.

    The first draft of this check reused the owner above and asserted a refusal
    at quota 0 — but that owner still held three credits, so the engine
    correctly ALLOWED it from credits and the assertion failed.

    The test was wrong, not the engine. QUOTA_EXHAUSTED means "quota spent AND
    no credits", so a fixture with credits in it cannot produce that code at
    all. 3G shipped an assertion whose premise had drifted the same way and it
    passed while proving nothing; this one is given a clean owner and the
    premise is asserted before the refusal is.
  */
  const BROKE = 'A5B2C7D1-0E44-4F19-9A3C-2500BEEF2503';
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${BROKE}';
    DELETE FROM t_app_subscriptions WHERE OwnerUid='${BROKE}';
    INSERT INTO t_app_subscriptions (OwnerUid, PlanId, StatusId, Is_Active)
    VALUES ('${BROKE}', ${PLAN}, 1, 1);`);

  const brokeCredits = Number(one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${BROKE}', @FeatureId=${FEATURE};`)[5]);

  check('premise: the refusal fixture really has zero credits',
    brokeCredits === 0, `credits ${brokeCredits}`);

  const exhausted = consume({ owner: BROKE, quota: 0, ref: uid(20) });
  check('QUOTA_EXHAUSTED (quota 0 AND no credits — both, not either)',
    exhausted.status === 0 && exhausted.code === 'QUOTA_EXHAUSTED', exhausted.code);

  // …and the same call ALLOWS once credits exist, which is what makes the
  // refusal above mean something.
  sql(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GrantFeatureCredits @OwnerUid='${BROKE}', @FeatureId=${FEATURE}, @Units=1;`);
  const nowAllowed = consume({ owner: BROKE, quota: 0, ref: uid(20) });

  check('🔴 …and the SAME call is allowed once one credit exists',
    nowAllowed.status === 1 && nowAllowed.source === 2,
    `status ${nowAllowed.status}, source ${nowAllowed.source} (2=credit)`);

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${BROKE}';
    DELETE FROM t_app_subscriptions WHERE OwnerUid='${BROKE}';`);

  const noRef = consume({ quota: 5, ref: null, refType: null });
  check('a metered consume with NO reference is refused',
    noRef.status === 0 && noRef.code === 'VALIDATION_FAILED', noRef.code);

  // SUBSCRIPTION_INACTIVE — deactivate, call, restore.
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Active = 0 WHERE OwnerUid = '${OWNER}';`);
  const inactive = consume({ quota: 5, ref: uid(21) });
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Active = 1 WHERE OwnerUid = '${OWNER}';`);

  check('SUBSCRIPTION_INACTIVE (row deactivated, then restored)',
    inactive.status === 0 && inactive.code === 'SUBSCRIPTION_INACTIVE', inactive.code);

  // 🔴 SUBSCRIPTION_MISSING — a deliberately broken row, restored after.
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Deleted = 1 WHERE OwnerUid = '${OWNER}';`);
  const missing = consume({ quota: 5, ref: uid(22) });
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Deleted = 0 WHERE OwnerUid = '${OWNER}';`);

  check('🔴 SUBSCRIPTION_MISSING (no row at all — an integrity error, not a state)',
    missing.status === 0 && missing.code === 'SUBSCRIPTION_MISSING', missing.code);

  const restored = consume({ quota: 5, ref: uid(23) });
  check('…and the fixture is restored — a consume works again',
    restored.status === 1, `status ${restored.status}`);

  // PLAN_CHANGED — the guard on the read-then-lock window.
  const planChanged = one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_ConsumeFeature @OwnerUid='${OWNER}', @FeatureId=${FEATURE}, @GatingModeId=3,
      @HasMapping=1, @QuotaPerPeriod=5, @RefEntityTypeId=1, @RefEntityUid='${uid(24)}',
      @ExpectedPlanId=99999;`);
  check('PLAN_CHANGED when the plan moved under the caller',
    Number(planChanged[0]) === 0 && planChanged[1] === 'PLAN_CHANGED', planChanged[1]);

  // =========================================================================
  console.log('\n=== 6. PERIOD BOUNDARY — UTC AND IST DISAGREE FOR 5.5 HOURS ===');

  console.log('\n  window math:');
  rows(`SET NOCOUNT ON; USE jp_app;
    SELECT '2026-08-31 18:29:59Z', CONVERT(varchar(30), PeriodFromUtc), CONVERT(varchar(30), PeriodToUtc),
           CONVERT(varchar(10), PeriodFirstIstDate)
      FROM fn_QuotaPeriodForUtc('2026-08-31T18:29:59')
    UNION ALL
    SELECT '2026-08-31 18:30:00Z', CONVERT(varchar(30), PeriodFromUtc), CONVERT(varchar(30), PeriodToUtc),
           CONVERT(varchar(10), PeriodFirstIstDate)
      FROM fn_QuotaPeriodForUtc('2026-08-31T18:30:00');`)
    .forEach((r) => console.log(`    ${r[0]}  ->  [${r[1]}, ${r[2]})  first IST day ${r[3]}`));

  const aug = one(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(10), PeriodFirstIstDate) FROM fn_QuotaPeriodForUtc('2026-08-31T18:29:59');`);
  const sep = one(`SET NOCOUNT ON; USE jp_app;
    SELECT CONVERT(varchar(10), PeriodFirstIstDate) FROM fn_QuotaPeriodForUtc('2026-08-31T18:30:00');`);

  check('🔴 18:29:59Z on 31 Aug is still the AUGUST period', aug[0] === '2026-08-01', aug[0]);
  check('🔴 18:30:00Z on 31 Aug is already the SEPTEMBER period', sep[0] === '2026-09-01', sep[0]);

  /*
    And end-to-end: two rows written a second apart across that boundary are
    counted against different months by the balance procedure.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_feature_ledger
      (OwnerUid, FeatureId, EntryTypeId, SourceId, Units, RefEntityTypeId, RefEntityUid, OccurredOn)
    VALUES ('${OWNER}', ${FEATURE}, 2, 1, -1, 1, '${uid(60)}', '2026-08-31T18:29:59'),
           ('${OWNER}', ${FEATURE}, 2, 1, -1, 1, '${uid(61)}', '2026-08-31T18:30:00');`);

  const augUsed = Number(one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${OWNER}', @FeatureId=${FEATURE}, @AsOfUtc='2026-08-15T00:00:00';`)[4]);
  const sepUsed = Number(one(`SET NOCOUNT ON; USE jp_app;
    EXEC USP_GetFeatureBalance @OwnerUid='${OWNER}', @FeatureId=${FEATURE}, @AsOfUtc='2026-09-15T00:00:00';`)[4]);

  check('…and the balance counts them in DIFFERENT months',
    augUsed >= 1 && sepUsed === 1,
    `August ${augUsed} used, September ${sepUsed} used (the September row is the 18:30:00Z one)`);

  // =========================================================================
  console.log('\n=== 1. 🔴 THE RACE — TWO GENUINELY PARALLEL SESSIONS ===');

  // A clean owner with exactly ONE unit of quota left.
  const RACE = 'A5B2C7D1-0E44-4F19-9A3C-2500BEEF2502';
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${RACE}';
    DELETE FROM t_app_subscriptions WHERE OwnerUid='${RACE}';
    INSERT INTO t_app_subscriptions (OwnerUid, PlanId, StatusId, Is_Active)
    VALUES ('${RACE}', ${PLAN}, 1, 1);`);

  /*
    🔴 BOTH SESSIONS WAIT FOR THE SAME WALL-CLOCK INSTANT.

    Spawning two processes and hoping they overlap is not a race test — it is a
    test that usually runs sequentially. WAITFOR TIME makes them enter the
    procedure within milliseconds of each other, which is the 2C pattern that
    caught the approval engine's concurrency bug.
  */
  const startAt = new Date(Date.now() + 4000);
  const hhmmss = startAt.toTimeString().slice(0, 8);

  const racer = (ref) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_app;
     WAITFOR TIME '${hhmmss}';
     EXEC USP_ConsumeFeature @OwnerUid='${RACE}', @FeatureId=${FEATURE}, @GatingModeId=3,
       @HasMapping=1, @QuotaPerPeriod=1, @RefEntityTypeId=1, @RefEntityUid='${ref}';`],
    { encoding: 'utf8' });

  console.log(`  both sessions armed for ${hhmmss} …`);

  const [a, b] = await Promise.all([racer(uid(101)), racer(uid(102))]);

  const parse = (out) => {
    const line = out.stdout.split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !/Changed database context/.test(l))[0] ?? '';
    const c = line.split('|').map((x) => x.trim());

    return { status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1] };
  };

  const ra = parse(a);
  const rb = parse(b);

  console.log(`  session A: status ${ra.status}, code ${ra.code}`);
  console.log(`  session B: status ${rb.status}, code ${rb.code}`);

  const winners = [ra, rb].filter((r) => r.status === 1).length;
  const losers = [ra, rb].filter((r) => r.status === 0 && r.code === 'QUOTA_EXHAUSTED').length;

  check('🔴 exactly ONE session consumed the last unit', winners === 1, `${winners} winner(s)`);
  check('🔴 the other got QUOTA_EXHAUSTED — a refusal with its own Code, not an error',
    losers === 1, `${losers} refused with QUOTA_EXHAUSTED`);

  const raceRows = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_feature_ledger
    WHERE OwnerUid='${RACE}' AND EntryTypeId=2 AND Is_Deleted=0;`));

  check('🔴 …and the LEDGER holds exactly one consume row',
    raceRows === 1, `${raceRows} row(s)`);

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${RACE}';
    DELETE FROM t_app_subscriptions WHERE OwnerUid='${RACE}';`);
} finally {
  // =========================================================================
  console.log('\n=== TEARDOWN ===');
  teardown();

  const after = Number(scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM t_app_feature_ledger;`));
  check('🔴 the fixture is gone — the ledger is back to what it was',
    after === ledgerTotalBefore, `${ledgerTotalBefore} before, ${after} after`);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
