/*
  PHASE 2.5 — the plan × feature screen, in a real browser.

  ----------------------------------------------------------------------------
  WHAT ONLY A BROWSER CAN SETTLE
  ----------------------------------------------------------------------------
  entitlement-http.mjs proves the API. Four claims are about what a person sees
  and what happens when they click, and no HTTP check reaches them:

    - an UNMAPPED cell renders the WORD "unmapped", never a blank box. A blank
      reads as "zero" or as "nothing here"; it means DENIED.
    - the kill switch is a separate, visibly different control from the mode
      dropdown — not a fourth option inside it.
    - 🔴 THE FLIP GOES THROUGH THE SCREEN. The operator clicks the switch, and
      the very next consume is refused. No restart, no sleep, no cache clear
      between the click and the call.
    - a cell that CANNOT be mapped has no control at all and says why (2.62's
      "not allowed", where a greyed-out button would read as broken).

  Everything it changes, it changes back — including on failure.

  Run (jp-shared :4999, jp-admin :4200, both APIs):
      node scripts/verify/screens-25.mjs
*/
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';
const ADMIN_APP = 'http://localhost:4200';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ADMIN = { id: 'superadmin@teacherportal.local', pw: 'RyaBs*-L?G9*-xTKM$R4' };

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

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
  try { body = JSON.parse(text); } catch { /* keep text */ }

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

  return r.body.data;
};

const OWNER = 'A5B2C7D1-0E44-4F19-9A3C-2500BEEF2520';
const PLAN = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 PlanId FROM m_mdm_plans WHERE PlanCode='SCHOOL_FREE' AND Is_Deleted=0;`)[0]);
const FEATURE = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 FeatureId FROM m_mdm_features WHERE FeatureCode='JOB_POST' AND Is_Deleted=0;`)[0]);

const SEARCH = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
  SELECT TOP 1 FeatureId FROM m_mdm_features WHERE FeatureCode='TEACHER_SEARCH' AND Is_Deleted=0;`)[0]);

const restore = () => {
  sql(`SET NOCOUNT ON; USE jp_mdm;
    UPDATE m_mdm_features SET GatingModeId=1, Is_Active=1 WHERE FeatureId IN (${FEATURE}, ${SEARCH});
    DELETE FROM m_mdm_plan_features WHERE FeatureId IN (${FEATURE}, ${SEARCH});`);
  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';
    DELETE FROM t_app_subscriptions  WHERE OwnerUid='${OWNER}';`);
};

restore();

/*
  The fixture has to contain the states the screen is being tested on.

  🔴 JOB_POST is METERED and MAPPED — the flip test spends against it.
  🔴 TEACHER_SEARCH is BOOLEAN and DELIBERATELY LEFT UNMAPPED, because
     otherwise there would be no unmapped cell on the screen and the
     "unmapped is never blank" assertion would pass while checking nothing.

  The first run of this script had exactly that hole: it reported "0 unmapped
  cells" and counted the check as a pass. An assertion that cannot fail is
  worse than no assertion, because it is counted.
*/
sql(`SET NOCOUNT ON; USE jp_mdm;
  UPDATE m_mdm_features SET GatingModeId=3, Is_Active=1 WHERE FeatureId=${FEATURE};
  UPDATE m_mdm_features SET GatingModeId=2, Is_Active=1 WHERE FeatureId=${SEARCH};
  INSERT INTO m_mdm_plan_features (PlanId, FeatureId, IsIncluded, QuotaPerPeriod)
  VALUES (${PLAN}, ${FEATURE}, 1, 500);`);
sql(`SET NOCOUNT ON; USE jp_app;
  INSERT INTO t_app_subscriptions (OwnerUid, PlanId, StatusId, Is_Active)
  VALUES ('${OWNER}', ${PLAN}, 1, 1);`);

const session = await login(ADMIN.id, ADMIN.pw);
const H = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };

const consume = (n) => j(`${APP}/entitlements/consume`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    ownerUid: OWNER, featureCode: 'JOB_POST', units: 1,
    refEntityTypeId: 1, refEntityUid: `A5B2C7D1-0E44-4F19-9A3C-2520000${String(n).padStart(5, '0')}`,
  }),
});

const browser = await chromium.launch();
let context;

try {
  context = await browser.newContext({ viewport: WIDE, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(ADMIN_APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.setItem('jp.admin.accessToken', s.accessToken);
    localStorage.setItem('jp.admin.refreshToken', s.refreshToken);
  }, session);

  // =========================================================================
  console.log('\n=== 1. THE SCREEN LOADS, AND THE MENU POINTS AT IT ===');

  await page.goto(`${ADMIN_APP}/settings/plans`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  const title = (await page.locator('.page__title').textContent())?.trim();
  check('the matrix screen renders', title === 'Plans and features', title);

  const navPaths = await page.locator('nav a').evaluateAll((ls) =>
    ls.map((l) => l.getAttribute('href')));

  check('a sidebar entry points at it — the menu is data (2.37)',
    navPaths.some((p) => p?.includes('settings/plans')),
    navPaths.filter(Boolean).join(' '));

  // =========================================================================
  console.log('\n=== 2. 🔴 UNMAPPED IS A WORD, NOT A BLANK ===');

  const cells = page.locator('.matrix__cell');
  const cellCount = await cells.count();
  const cellTexts = (await cells.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

  check('the grid drew cells', cellCount > 0, `${cellCount} cells`);

  const blank = cellTexts.filter((t) => t === '');
  check('🔴 NO cell is blank — every one carries a word',
    blank.length === 0, `${blank.length} blank of ${cellTexts.length}`);

  console.log(`    cell texts: ${[...new Set(cellTexts)].join(' | ')}`);

  // JOB_POST is metered and mapped here, so its cell shows the quota. The
  // other metered/boolean features are unmapped and must SAY so.
  const unmapped = page.locator('.matrix__cell--unmapped');
  const unmappedCount = await unmapped.count();

  /*
    🔴 THE PREMISE IS ASSERTED BEFORE THE CLAIM.

    The first run of this script reported "0 unmapped cells" and counted the
    check as a PASS — the fixture had mapped everything, so there was nothing
    for the assertion to look at. An assertion that cannot fail is worse than no
    assertion, because it is counted. TEACHER_SEARCH is now left unmapped on
    purpose so this has something to prove.
  */
  check('premise: the screen really has an unmapped cell to show',
    unmappedCount > 0, `${unmappedCount} unmapped cells`);

  const unmappedText = (await unmapped.first().textContent())?.replace(/\s+/g, ' ').trim();

  check('🔴 …and it says "unmapped" AND "denied" — never a blank box',
    /unmapped/i.test(unmappedText ?? '') && /denied/i.test(unmappedText ?? ''), unmappedText);

  // =========================================================================
  console.log('\n=== 3. 🔴 THE KILL SWITCH IS NOT A FOURTH MODE ===');

  const modeOptions = await page.locator('.matrix__mode').first()
    .locator('option').allTextContents();

  check('🔴 the mode dropdown offers exactly three options — no "Disabled"',
    modeOptions.length === 3 && !modeOptions.some((o) => /disabl/i.test(o)),
    modeOptions.map((o) => o.trim()).join(', '));

  const switches = await page.locator('.killswitch__input').count();
  check('…and there is a separate switch per feature',
    switches === (await page.locator('.matrix__mode').count()),
    `${switches} switches, ${await page.locator('.matrix__mode').count()} dropdowns`);

  // 2.62 — a cell that cannot be mapped has no control, and says why.
  await page.locator('.tabs__tab').nth(1).click();
  await page.waitForTimeout(600);

  const teacherCells = (await page.locator('.matrix__cell').allTextContents())
    .map((t) => t.replace(/\s+/g, ' ').trim());

  check('teacher tab renders its own features rather than the school ones',
    teacherCells.length > 0, `${teacherCells.length} cells`);

  await page.locator('.tabs__tab').first().click();
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.join(OUT, 'admin-plans-1440.png'), fullPage: true });

  // =========================================================================
  console.log('\n=== 4. 🔴 THE FLIP, THROUGH THE SCREEN — NO SLEEP, NO RESTART ===');

  const before = await consume(1);
  check('premise: the feature is usable before anybody touches the screen',
    before.http === 200 && before.body?.data?.allowed === true,
    `HTTP ${before.http}, consumed ${before.body?.data?.consumed}`);

  // The JOB_POST row's switch. Located by the feature code so the test cannot
  // drift onto a neighbouring row when the catalog grows.
  const jobRow = page.locator('tr', { has: page.locator('.matrix__feature-code', { hasText: 'JOB_POST' }) });
  const jobSwitch = jobRow.locator('.killswitch__input');

  const rowBefore = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT Is_Active FROM m_mdm_features WHERE FeatureId=${FEATURE};`)[0];

  /*
    🔴 THE CLICK, AND THEN THE CALL.

    Nothing between them. A test that waited, restarted the API or cleared
    anything would pass against a cached implementation too — the pause is
    exactly what that bug needs to hide.

    waitForResponse is not a wait ON the engine; it is how the script knows the
    click's own PUT has returned. The consume then goes out immediately after.
  */
  const savePut = page.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await jobRow.locator('.killswitch').click();
  const putResponse = await savePut;

  const afterOff = await consume(2);

  const rowAfter = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT Is_Active FROM m_mdm_features WHERE FeatureId=${FEATURE};`)[0];

  console.log(`    PUT /gating -> HTTP ${putResponse.status()}`);
  console.log(`    row Is_Active: ${rowBefore} -> ${rowAfter}`);
  console.log(`    next consume : HTTP ${afterOff.http}, code ${afterOff.body?.code}`);

  check('the click saved, and the row changed 1 -> 0',
    putResponse.status() === 200 && rowBefore === '1' && rowAfter === '0',
    `PUT ${putResponse.status()}, row ${rowBefore} -> ${rowAfter}`);

  check('🔴 the VERY NEXT consume is refused, FEATURE_DISABLED, immediately',
    afterOff.http === 403 && afterOff.body?.code === 'FEATURE_DISABLED',
    `HTTP ${afterOff.http}, code ${afterOff.body?.code}`);

  await page.waitForTimeout(900);

  const banner = await page.locator('.banner--alert').textContent();
  check('…and the screen says so, loudly',
    /switched off/i.test(banner ?? ''), banner?.replace(/\s+/g, ' ').trim());

  const struck = await jobRow.getAttribute('class');
  check('…and the switched-off row is visibly different, not just labelled',
    (struck ?? '').includes('matrix__row--off'), struck);

  await page.screenshot({ path: path.join(OUT, 'admin-plans-killswitch-1440.png'), fullPage: true });

  /*
    🔴 BOTH DIRECTIONS.

    A refusal-only test passes if the feature happened to be denied for some
    unrelated reason — 3G shipped exactly that kind of vacuous assertion, and it
    was counted as a pass. Turning it back on and asserting an immediate ALLOW
    is what makes the refusal above mean the flip caused it.
  */
  const savePutOn = page.waitForResponse(
    (r) => r.url().includes('/gating') && r.request().method() === 'PUT');

  await jobRow.locator('.killswitch').click();
  await savePutOn;

  const afterOn = await consume(3);

  check('🔴 switched back on -> the VERY NEXT consume is ALLOWED, immediately',
    afterOn.http === 200 && afterOn.body?.data?.allowed === true,
    `HTTP ${afterOn.http}, allowed ${afterOn.body?.data?.allowed}`);

  const modeSurvived = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT GatingModeId FROM m_mdm_features WHERE FeatureId=${FEATURE};`)[0];

  check('🔴 …and the MODE survived both flips — still METERED',
    modeSurvived === '3', `mode ${modeSurvived} (3 = metered)`);

  // =========================================================================
  console.log('\n=== 5. 375 ===');

  await page.setViewportSize(PHONE);
  await page.goto(`${ADMIN_APP}/settings/plans`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  /*
    ⚠️ Reports WHICH element overflows, not just how many pixels.

    The first run said "70px" and nothing else, and three separate guesses at
    the cause were all wrong. A number alone sends you hunting; the element name
    is the fix. Descendants of the grid's own scroll box are excluded — the
    table is SUPPOSED to be wider than the screen, that is what the box is for.
  */
  const overflowReport = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scroller = document.querySelector('.matrix__scroll');
    const offenders = [];

    document.querySelectorAll('*').forEach((el) => {
      if (scroller && scroller.contains(el) && el !== scroller) return;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className || '').trim().slice(0, 40)}`
          + ` (right ${Math.round(r.right)})`);
      }
    });

    return {
      px: Math.max(0, document.documentElement.scrollWidth - vw),
      offenders: offenders.slice(0, 6),
    };
  });

  check('🔴 no sideways scroll on the PAGE at 375 — the grid scrolls in its own box',
    overflowReport.px === 0,
    overflowReport.px === 0
      ? '0px'
      : `${overflowReport.px}px — ${overflowReport.offenders.join(' | ') || 'no element found outside the grid box'}`);

  const gridScrolls = await page.locator('.matrix__scroll').evaluate((el) =>
    getComputedStyle(el).overflowX);

  check('…and that box really is the scroller', gridScrolls === 'auto', gridScrolls);

  await page.screenshot({ path: path.join(OUT, 'admin-plans-375.png'), fullPage: true });
} finally {
  console.log('\n=== TEARDOWN ===');
  if (context) await context.close();
  await browser.close();
  restore();

  const state = sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT GatingModeId, Is_Active FROM m_mdm_features WHERE FeatureId=${FEATURE};`)[0];
  const maps = Number(sql(`SET NOCOUNT ON; USE jp_mdm;
    SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted=0;`)[0]);
  const rows = Number(sql(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM t_app_feature_ledger WHERE OwnerUid='${OWNER}';`)[0]);

  check('🔴 everything restored — JOB_POST back to FREE/active, no mappings, no ledger rows',
    state === '1|1' && maps === 0 && rows === 0,
    `mode|active ${state}, mappings ${maps}, ledger ${rows}`);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`  Screenshots: ${OUT}`);
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
