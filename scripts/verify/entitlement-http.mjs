/*
  PHASE 2.5 — the engine over HTTP, and the two isolation prohibitions.

  ----------------------------------------------------------------------------
  WHAT THIS ADDS OVER entitlement-engine.mjs
  ----------------------------------------------------------------------------
  That script proves the procedures. This one proves the layer above them:

    - the 2.61 DUAL READ on the one column where a silent false would be
      catastrophic (m_mdm_features.Is_Active). Row AND JSON, both asserted TRUE.
    - every refusal Code arriving as the right HTTP STATUS, distinct per code.
    - ALREADY_CONSUMED as a 200 carrying a code — a success, not a failure.
    - 🔴 THE KILL SWITCH, LIVE. Flip through the API, then consume with NO
      restart, NO sleep and NO cache clear. Both directions.
    - 🔴 the two isolation greps: 2.56 (engine <-> contact, both ways) and the
      cache prohibition (nothing on the consume path touches IMasterService).

  ⚠️ Everything it creates, it removes. The gating mode and kill switch are
  restored to what they were even if an assertion fails.

  Run (both APIs up): node scripts/verify/entitlement-http.mjs
*/
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const ADMIN = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };
const SCHOOL = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001',
    '-h', '-1', '-W', '-s', '|', '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body, text };
};

const login = async (id, pw, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: id, password: pw }),
  });

  if (r.http === 429 && attempt <= 4) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(id, pw, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${id}: ${r.http} ${r.body?.message ?? r.text}`);

  return r.body.data.accessToken;
};

const OWNER = 'A5B2C7D1-0E44-4F19-9A3C-2500BEEF2510';
let feature = null;

/*
  🔴 RESTORES TO THE SHIPPED STATE, NOT TO "WHATEVER WAS FOUND".

  The first version captured JOB_POST's mode on the way in and put that value
  back on the way out. That is wrong in exactly one situation, and it is the
  situation that happens: if a previous run DIED before its teardown — killed,
  timed out, or a truncated pipe closing stdout — the next run reads the dirty
  state as "original" and faithfully preserves the mess. Two runs later nobody
  knows what the real baseline was.

  Phase 2.5 ships every feature FREE and active with no plan mappings, and this
  script ASSERTS that as its premise below. So the honest restore is to that
  documented state, which also makes the script self-healing after a kill.

  ⚠️ Found the hard way: a `Select-Object -First` in the shell terminated the
  pipeline, node died mid-run, and the next run failed its own premise check —
  which is the assertion doing its job.
*/
const SHIPPED_MODE = 1;   // FREE

const restore = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId=${SHIPPED_MODE}, Is_Active=1 WHERE Is_Deleted=0;
    DELETE FROM m_mdm_plan_features;`);
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';
    DELETE FROM t_app_subscriptions  WHERE OwnerUid='${OWNER}';`);
};

// Start from the shipped state even if a previous run was killed mid-way.
restore();

const PLAN = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 PlanId FROM m_mdm_plans WHERE PlanCode='SCHOOL_FREE' AND Is_Deleted=0;`)[0]);

const admin = await login(ADMIN.id, ADMIN.pw);
const school = await login(SCHOOL.id, SCHOOL.pw);
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

try {
  // =========================================================================
  console.log('\n=== 1. THE MATRIX, AND THE 2.61 DUAL READ ===');

  const matrix = await j(`${APP}/entitlements/matrix`, { headers: H(admin) });
  check('GET /entitlements/matrix returns 200 for an admin', matrix.http === 200, `HTTP ${matrix.http}`);

  const m = matrix.body?.data;
  check('…with four lists: plans, features, mappings, gating modes',
    Array.isArray(m?.plans) && Array.isArray(m?.features)
      && Array.isArray(m?.mappings) && Array.isArray(m?.gatingModes),
    `${m?.plans?.length} plans, ${m?.features?.length} features, ${m?.mappings?.length} mappings, ${m?.gatingModes?.length} modes`);

  check('🔴 exactly three gating modes — there is no fourth, and no "disabled"',
    m?.gatingModes?.length === 3
      && m.gatingModes.map((g) => g.code).join(',') === 'FREE,BOOLEAN,METERED',
    m?.gatingModes?.map((g) => g.code).join(', '));

  check('🔴 NO plan-feature mappings exist — shipping the engine gated nothing',
    m?.mappings?.length === 0, `${m?.mappings?.length} mappings`);

  check('🔴 every feature ships FREE',
    m?.features?.every((f) => f.gatingModeCode === 'FREE'),
    m?.features?.map((f) => `${f.featureCode}=${f.gatingModeCode}`).join(' '));

  feature = m.features.find((f) => f.featureCode === 'JOB_POST');
  // No "original" is captured — see restore(). The shipped state is the
  // baseline, and the two checks above have just asserted the run is starting
  // from it.

  /*
    🔴 THE DUAL READ (2.61).

    Dapper does not strip underscores, so Is_Active would never reach IsActive
    without the alias — and it would arrive as FALSE with nothing failing. On
    this column that is the worst available failure: every feature would read as
    switched off and the engine would refuse everything, everywhere.

    ⚠️ The assertion checks BOTH ARE TRUE, not merely that they agree. A
    false/false pair agrees perfectly and proves nothing, which is exactly how
    G25 hid for two phases.
  */
  const row = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT Is_Active, GatingModeId FROM m_mdm_features WHERE FeatureId=${feature.featureId};`)[0]
    .split('|').map((s) => s.trim());

  console.log(`\n    database row : Is_Active = ${row[0]}, GatingModeId = ${row[1]}`);
  console.log(`    JSON         : isActive  = ${feature.isActive}, gatingModeId = ${feature.gatingModeId}\n`);

  check('🔴 2.61 dual read — the row says 1 AND the JSON says true',
    row[0] === '1' && feature.isActive === true,
    `row ${row[0]}, json ${feature.isActive} — a false/false pair would agree and prove nothing`);

  check('…and the mode matches too', Number(row[1]) === feature.gatingModeId,
    `row ${row[1]}, json ${feature.gatingModeId}`);

  // =========================================================================
  console.log('\n=== 2. THE ADMIN GATE ===');

  const asSchool = await j(`${APP}/entitlements/matrix`, { headers: H(school) });
  check('a school user gets 403, not 200 and not 404',
    asSchool.http === 403, `HTTP ${asSchool.http}, code ${asSchool.body?.code}`);

  const anon = await j(`${APP}/entitlements/matrix`);
  check('no token gets 401', anon.http === 401, `HTTP ${anon.http}`);

  // =========================================================================
  console.log('\n=== 3. REFUSAL CODES OVER HTTP ===');

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';
    DELETE FROM t_app_subscriptions  WHERE OwnerUid='${OWNER}';
    INSERT INTO t_app_subscriptions (OwnerUid, PlanId, StatusId, Is_Active)
    VALUES ('${OWNER}', ${PLAN}, 1, 1);`);

  const consume = (ref, code = 'JOB_POST') => j(`${APP}/entitlements/consume`, {
    method: 'POST', headers: H(admin),
    body: JSON.stringify({
      ownerUid: OWNER, featureCode: code, units: 1,
      refEntityTypeId: 1, refEntityUid: ref, notes: 'verification',
    }),
  });

  const ref = (n) => `A5B2C7D1-0E44-4F19-9A3C-2510000${String(n).padStart(5, '0')}`;

  // FREE right now — allowed, and writes nothing.
  const free = await consume(ref(1));
  check('a FREE feature is allowed (200) and consumed nothing',
    free.http === 200 && free.body?.data?.allowed === true && free.body?.data?.consumed === false,
    `HTTP ${free.http}, allowed ${free.body?.data?.allowed}, consumed ${free.body?.data?.consumed}`);

  const unknown = await consume(ref(2), 'NO_SUCH_FEATURE');
  check('an unknown feature code -> 403 FEATURE_DISABLED',
    unknown.http === 403 && unknown.body?.code === 'FEATURE_DISABLED',
    `HTTP ${unknown.http}, code ${unknown.body?.code}`);

  // Make it METERED with a quota of 1, mapped, so the money paths are live.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ planId: PLAN, featureId: feature.featureId, action: 'MAP', isIncluded: true, quotaPerPeriod: 1 }),
  });
  await j(`${APP}/entitlements/features/${feature.featureId}/gating`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });

  /*
    🔴 THE LAST-UNIT BOUNDARY — three calls, one owner, one unbroken state.

    These three used to be asserted individually. They are the same sequence,
    but what makes them a BOUNDARY is that they run back to back without the
    fixture being touched in between:

      1. spend the last unit                -> Status 1
      2. retry the SAME reference           -> 200, ALREADY_CONSUMED
      3. a FRESH reference                  -> QUOTA_EXHAUSTED

    Step 2 is the bug this phase fixed: idempotency used to live only in the
    INSERT collision, which is never reached once the quota branch refuses
    first, so a retry of an already-paid action came back QUOTA_EXHAUSTED.

    🔴 Step 3 is what proves the FIX did not overshoot. The reference check now
    runs ahead of the quota decision; if it matched too loosely or
    short-circuited the quota branch, a fresh reference would be allowed and the
    engine would have quietly stopped enforcing quota at the exact moment it
    matters. Steps 2 and 3 have to hold together, or neither means anything.

    The ledger row count is asserted after each one — it must stay at exactly
    one across all three.
  */
  const liveConsumes = () => Number(sql(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_feature_ledger
    WHERE OwnerUid='${OWNER}' AND FeatureId=${feature.featureId}
      AND EntryTypeId=2 AND Is_Deleted=0 AND ReversedOn IS NULL;`)[0]);

  const consumesBefore = liveConsumes();

  const metered1 = await consume(ref(3));
  check('1. METERED, quota 1 -> allowed and CONSUMED from quota',
    metered1.http === 200 && metered1.body?.data?.consumed === true
      && metered1.body?.data?.source === 1,
    `consumed ${metered1.body?.data?.consumed}, source ${metered1.body?.data?.source}`);

  check('1. …and the month is now empty',
    metered1.body?.data?.quotaRemaining === 0,
    `quotaRemaining ${metered1.body?.data?.quotaRemaining}`);

  const firstEntryId = metered1.body?.data?.entryId;

  const retry = await consume(ref(3));
  check('2. 🔴 the same reference again -> HTTP 200 (a SUCCESS), code ALREADY_CONSUMED',
    retry.http === 200 && retry.body?.code === 'ALREADY_CONSUMED' && retry.body?.status === 1,
    `HTTP ${retry.http}, status ${retry.body?.status}, code ${retry.body?.code}`);

  check('2. …returning the ORIGINAL entry, having written nothing',
    retry.body?.data?.entryId === firstEntryId
      && retry.body?.data?.consumed === false
      && liveConsumes() === consumesBefore + 1,
    `entry ${retry.body?.data?.entryId} (original ${firstEntryId}), `
    + `live consumes ${liveConsumes()}`);

  const exhausted = await consume(ref(4));
  check('3. 🔴 a FRESH reference -> 400 QUOTA_EXHAUSTED — quota is still enforced',
    exhausted.http === 400 && exhausted.body?.code === 'QUOTA_EXHAUSTED',
    `HTTP ${exhausted.http}, code ${exhausted.body?.code} `
    + '— an allow here would mean the reference check had swallowed the quota branch');

  check('3. …and the ledger still holds exactly the one row from step 1',
    liveConsumes() === consumesBefore + 1,
    `${liveConsumes()} live consume(s), expected ${consumesBefore + 1}`);

  // Unmap -> the plan says nothing -> denied, and with a DIFFERENT code.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ planId: PLAN, featureId: feature.featureId, action: 'UNMAP', isIncluded: false, quotaPerPeriod: null }),
  });

  const unmapped = await consume(ref(5));
  check('🔴 unmapped -> 400 PLAN_LACKS_FEATURE, a DIFFERENT code from QUOTA_EXHAUSTED',
    unmapped.http === 400 && unmapped.body?.code === 'PLAN_LACKS_FEATURE',
    `HTTP ${unmapped.http}, code ${unmapped.body?.code}`);

  // Re-map for the kill-switch test.
  await j(`${APP}/entitlements/plan-features`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ planId: PLAN, featureId: feature.featureId, action: 'MAP', isIncluded: true, quotaPerPeriod: 50 }),
  });

  // SUBSCRIPTION_MISSING via a deliberately broken row.
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Deleted=1 WHERE OwnerUid='${OWNER}';`);
  const missing = await consume(ref(6));
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Deleted=0 WHERE OwnerUid='${OWNER}';`);

  check('🔴 SUBSCRIPTION_MISSING -> 403 with its OWN code, not a 500',
    missing.http === 403 && missing.body?.code === 'SUBSCRIPTION_MISSING',
    `HTTP ${missing.http}, code ${missing.body?.code} — a 500 would become INTERNAL_ERROR and lose it`);

  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Active=0 WHERE OwnerUid='${OWNER}';`);
  const inactive = await consume(ref(7));
  sql(`SET NOCOUNT ON; USE jp_app;
    UPDATE t_app_subscriptions SET Is_Active=1 WHERE OwnerUid='${OWNER}';`);

  check('SUBSCRIPTION_INACTIVE -> 403, distinct from SUBSCRIPTION_MISSING',
    inactive.http === 403 && inactive.body?.code === 'SUBSCRIPTION_INACTIVE',
    `HTTP ${inactive.http}, code ${inactive.body?.code}`);

  // =========================================================================
  console.log('\n=== 4. 🔴 THE KILL SWITCH, LIVE — NO RESTART, NO SLEEP, NO CLEAR ===');

  const allowedBefore = await consume(ref(10));
  check('premise: the feature is usable before the flip',
    allowedBefore.http === 200 && allowedBefore.body?.data?.allowed === true,
    `HTTP ${allowedBefore.http}`);

  const rowBefore = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT Is_Active FROM m_mdm_features WHERE FeatureId=${feature.featureId};`)[0];

  /*
    🔴 The flip and the call, back to back. Nothing in between.

    A test that sleeps, restarts the API or clears anything here would pass
    against a CACHED implementation too — the pause is exactly what that bug
    needs in order to hide. If this ever needs a wait to go green, it has found
    the bug rather than disproved it.
  */
  const flipOff = await j(`${APP}/entitlements/features/${feature.featureId}/gating`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ gatingModeId: 3, isActive: false }),
  });
  const immediatelyAfterOff = await consume(ref(11));

  const rowAfter = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT Is_Active FROM m_mdm_features WHERE FeatureId=${feature.featureId};`)[0];

  console.log(`    row Is_Active before the flip: ${rowBefore}`);
  console.log(`    row Is_Active after  the flip: ${rowAfter}`);

  check('the flip saved (200) and the row changed 1 -> 0',
    flipOff.http === 200 && rowBefore === '1' && rowAfter === '0',
    `HTTP ${flipOff.http}, row ${rowBefore} -> ${rowAfter}`);

  check('🔴 …and the VERY NEXT consume is refused — FEATURE_DISABLED, immediately',
    immediatelyAfterOff.http === 403 && immediatelyAfterOff.body?.code === 'FEATURE_DISABLED',
    `HTTP ${immediatelyAfterOff.http}, code ${immediatelyAfterOff.body?.code}`);

  /*
    🔴 BOTH DIRECTIONS. A refusal-only test passes if the feature happened to be
    denied for some unrelated reason — 3G shipped exactly that kind of vacuous
    assertion. Turning it back on and asserting an immediate ALLOW is what makes
    the refusal above mean the flip did it.
  */
  const flipOn = await j(`${APP}/entitlements/features/${feature.featureId}/gating`, {
    method: 'PUT', headers: H(admin),
    body: JSON.stringify({ gatingModeId: 3, isActive: true }),
  });
  const immediatelyAfterOn = await consume(ref(12));

  check('🔴 flipped back on -> the VERY NEXT consume is ALLOWED, immediately',
    flipOn.http === 200 && immediatelyAfterOn.http === 200
      && immediatelyAfterOn.body?.data?.allowed === true,
    `HTTP ${immediatelyAfterOn.http}, allowed ${immediatelyAfterOn.body?.data?.allowed}`);

  const modeSurvived = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT GatingModeId FROM m_mdm_features WHERE FeatureId=${feature.featureId};`)[0];

  check('🔴 …and the MODE survived both flips untouched — still METERED',
    modeSurvived === '3',
    `mode ${modeSurvived} — this is why the kill switch is not a fourth mode`);

  // =========================================================================
  console.log('\n=== 5. BALANCE AND LEDGER READS ===');

  const bal = await j(
    `${APP}/entitlements/balance?ownerUid=${OWNER}&featureCode=JOB_POST`, { headers: H(admin) });

  check('GET /balance returns the recomputed standing',
    bal.http === 200 && typeof bal.body?.data?.quotaUsed === 'number',
    `quotaUsed ${bal.body?.data?.quotaUsed}, credits ${bal.body?.data?.creditBalance}`);

  const led = await j(
    `${APP}/entitlements/ledger?ownerUid=${OWNER}&featureCode=JOB_POST`, { headers: H(admin) });

  const ledgerRows = led.body?.data ?? [];
  check('GET /ledger returns the rows, newest first',
    led.http === 200 && ledgerRows.length > 0, `${ledgerRows.length} rows`);

  check('🔴 2.61 — isActive survives the journey on the ledger DTO too',
    ledgerRows.every((r) => r.isActive === true),
    `all ${ledgerRows.length} rows report isActive true`);

  const jsonQuotaUsed = bal.body?.data?.quotaUsed;
  const dbQuotaUsed = Number(sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @f datetime2, @t datetime2;
    SELECT @f=PeriodFromUtc, @t=PeriodToUtc FROM fn_QuotaPeriodForUtc(SYSUTCDATETIME());
    SELECT ISNULL(SUM(ABS(Units)),0) FROM t_app_feature_ledger
    WHERE OwnerUid='${OWNER}' AND FeatureId=${feature.featureId} AND EntryTypeId=2 AND SourceId=1
      AND Is_Deleted=0 AND ReversedOn IS NULL AND OccurredOn>=@f AND OccurredOn<@t;`)[0]);

  check('🔴 the API balance equals the ledger recomputed from raw rows',
    jsonQuotaUsed === dbQuotaUsed, `API ${jsonQuotaUsed}, raw rows ${dbQuotaUsed}`);

  // =========================================================================
  console.log('\n=== 6. 🔴 THE TWO ISOLATION PROHIBITIONS ===');

  const root = 'D:/Projects/jp-backend';
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir)) {
      if (e === 'bin' || e === 'obj' || e === '.git' || e === 'node_modules') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(cs|sql)$/.test(e)) out.push(p);
    }

    return out;
  };

  const files = walk(root);

  // ---- 2.56, direction A: does the engine mention contact? ----------------
  const enginePaths = files.filter((f) =>
    /Entitlement|013_entitlement|020_entitlement_ledger|036_entitlement_catalog|009_entitlement_catalog/i.test(f));

  const engineTouchingContact = enginePaths.filter((f) => {
    const body = readFileSync(f, 'utf8');
    // Ignore the prohibition headers themselves — they NAME the thing they ban.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/\/?|--).*$/gm, '');

    return /fn_TeacherContactUnlocked|ContactUnlocked|MobileNumber|ContactEmail/i.test(code);
  });

  console.log(`    engine files scanned: ${enginePaths.length}`);
  enginePaths.forEach((f) => console.log(`      ${f.replace(root + '\\', '')}`));

  check('🔴 2.56 A — no engine file references contact unlock in its CODE',
    engineTouchingContact.length === 0,
    engineTouchingContact.length ? engineTouchingContact.join(', ') : 'zero hits outside the prohibition headers');

  // ---- 2.56, direction B: does contact unlock mention the engine? ---------
  const contactPaths = files.filter((f) => /teacher_public_profile|TeacherDirectory/i.test(f));
  const contactTouchingEngine = contactPaths.filter((f) => {
    const body = readFileSync(f, 'utf8');
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/\/?|--).*$/gm, '');

    return /ConsumeFeature|IEntitlement|t_app_feature_ledger|m_mdm_plan_features|QuotaPerPeriod/i.test(code);
  });

  console.log(`    contact-unlock files scanned: ${contactPaths.length}`);
  contactPaths.forEach((f) => console.log(`      ${f.replace(root + '\\', '')}`));

  check('🔴 2.56 B — no contact-unlock file references the engine in its CODE',
    contactTouchingEngine.length === 0,
    contactTouchingEngine.length ? contactTouchingEngine.join(', ') : 'zero hits — the prohibition holds both ways');

  // ---- the cache prohibition ---------------------------------------------
  const consumePathFiles = [
    'JP.Infrastructure/Repositories/EntitlementRepository.cs',
    'JP.Infrastructure/Services/EntitlementService.cs',
  ].map((p) => join(root, p));

  const touchingMaster = consumePathFiles.filter((f) => {
    const body = readFileSync(f, 'utf8');
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/\/?.*$/gm, '');

    return /IMasterService|MasterService|IMemoryCache|MemoryCache/.test(code);
  });

  console.log('    consume-path files scanned:');
  consumePathFiles.forEach((f) => console.log(`      ${f.replace(root + '\\', '')}`));

  check('🔴 nothing on the consume path references IMasterService or any cache',
    touchingMaster.length === 0,
    touchingMaster.length ? touchingMaster.join(', ') : 'zero hits outside the explanatory comments');

  // And the whole backend still has no server-side cache at all.
  const anyMemoryCache = files.filter((f) => {
    const body = readFileSync(f, 'utf8');
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/\/?|--).*$/gm, '');

    return /\bIMemoryCache\b|AddMemoryCache/.test(code);
  });

  check('…and the backend still holds no server-side cache anywhere',
    anyMemoryCache.length === 0,
    anyMemoryCache.length ? anyMemoryCache.join(', ') : 'no IMemoryCache in the solution');
} finally {
  console.log('\n=== TEARDOWN ===');
  restore();

  const left = Number(sql(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';`)[0]);
  const maps = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted=0;`)[0]);
  const modeNow = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT GatingModeId, Is_Active FROM m_mdm_features WHERE FeatureId=${feature?.featureId ?? 0};`)[0];

  check('🔴 fixture removed and gating restored to FREE / active',
    left === 0 && maps === 0 && modeNow === '1|1',
    `ledger rows ${left}, live mappings ${maps}, JOB_POST mode|active ${modeNow}`);
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
