/*
  P3 — THE COMBOBOX RANKS PREFIX MATCHES FIRST, AND STILL MATCHES SUBSTRINGS.

  ----------------------------------------------------------------------------
  🔴 WHY THIS SUITE EXISTS
  ----------------------------------------------------------------------------
  Typing "Har" into the state picker used to put BIHAR at the top:

      Bi-har   Har-yana   J-har-khand   Ma-har-ashtra

  All four contain "har", the list was ordered by the master's DisplayOrder,
  and the first option is the one somebody presses. So the control was quietly
  steering people to the wrong state — on the very screen where getting the
  state wrong invalidates every geography field under it.

  ⚠️ IT WAS FOUND BY LOOKING AT A SCREENSHOT, NOT BY A FAILING TEST. The
  walkthrough already typed "Har" into this control and photographed the
  result; nothing asserted anything about the order, so the picture was taken,
  filed, and the bug sat in it. This suite is that screenshot turned into a
  claim.

  ----------------------------------------------------------------------------
  🔴 THE NEGATIVE MATTERS MORE THAN THE POSITIVE HERE
  ----------------------------------------------------------------------------
  The cheap way to make "Har" produce Haryana first is to filter with
  `startsWith` instead of `includes`. That passes the obvious assertion and
  breaks the control: "aryan" would stop finding Haryana, and a user who types
  the middle of a name would be told their state does not exist.

  So this suite asserts BOTH halves, and the second one is the regression
  guard:

      1. prefix matches come FIRST                     (the ordering changed)
      2. substring-only matches are STILL RETURNED     (the filter did not)

  Run (jp-shared :4999, jp-teacher :4400, SSO :5199):
      node scripts/verify/combobox-rank.mjs
*/
import { chromium } from 'playwright';

import { secret } from './lib/accounts.mjs';

const TEACHER_APP = process.env.JP_TEACHER ?? 'http://localhost:4400';
const SSO = process.env.JP_SSO ?? 'http://localhost:5199/api';

const TEACHER = {
  id: 'rohit.kulkarni.86002@yopmail.com',
  pw: secret('rohit.kulkarni.86002@yopmail.com'),
};

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
  The same shape every screens suite uses: two quiet retries for the
  per-minute cap, then one probe to tell a limiter apart from a broken screen.
*/
const signIn = async (page, attempt = 1) => {
  await page.goto(`${TEACHER_APP}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('#loginId', TEACHER.id);
  await page.fill('#password', TEACHER.pw);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 20_000 });
  } catch (error) {
    if (attempt <= 2) {
      console.log(`  … sign-in did not navigate; waiting 25s (attempt ${attempt})`);
      await wait(25_000);

      return signIn(page, attempt + 1);
    }

    const probe = await fetch(`${SSO}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginId: TEACHER.id, password: TEACHER.pw }),
    });

    throw new Error(
      probe.status === 429
        ? 'the hourly login cap is in force — rerun this suite later'
        : `the sign-in form did not navigate but the API answered ${probe.status} — the SCREEN failed`,
    );
  }
};

/**
 * Open the combobox carrying `label` and type `query` into its search box.
 *
 * ⚠️ FOUND BY ITS VISIBLE LABEL, NOT BY AN ID. <ui-combobox> generates its own
 * control id, so an id-based selector would break the moment a plain <select>
 * is converted — which is exactly what this pass has been doing, and exactly
 * how a suite was left dying mid-run on a 30-second timeout once already.
 */
const openAndType = async (page, label, query) => {
  /*
    ⚠️ `getByLabel` AND PAGE-LEVEL `[role="option"]` — the idiom the other
    browser suites already use, not a guess at the component's class names.

    The first version of this helper scoped the options inside a `.ui-combobox`
    wrapper it assumed existed, and died on an 8-second `waitFor` that said
    nothing about why. The label is what a person reads and the one handle that
    survives the component being re-implemented.
  */
  const field = page.getByLabel(label, { exact: false }).first();

  await field.waitFor({ state: 'visible', timeout: 8_000 });
  await field.click();
  await page.waitForTimeout(250);

  await field.fill(query);

  // The list filters synchronously on input; a frame is enough.
  await page.waitForTimeout(350);

  const texts = await page.locator('[role="option"]').allTextContents();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  return texts;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await signIn(page);
  await page.goto(`${TEACHER_APP}/profile`, { waitUntil: 'networkidle' });

  // -- 1. the prefix wins ----------------------------------------------------
  const har = (await openAndType(page, 'State', 'Har')).map((t) => t.trim()).filter(Boolean);

  check('"Har" returns options at all', har.length > 0, `${har.length} shown`);

  check('"Har": HARYANA IS FIRST — the prefix outranks Bihar/Jharkhand/Maharashtra',
    /^haryana$/i.test(har[0] ?? ''), `first = "${har[0] ?? '(none)'}"`);

  /*
    ⚠️ The others must still BE there. If they had merely been filtered out,
    Haryana would be first for the wrong reason and the control would have
    silently become `startsWith` — which case 3 below is what really catches.
  */
  const alsoThere = har.filter((t) => /bihar|jharkhand|maharashtra/i.test(t));

  check('"Har": the substring matches are still in the list, just lower',
    alsoThere.length >= 2, alsoThere.join(', ') || 'none');

  // -- 2. an exact name is first, not merely present -------------------------
  const bihar = (await openAndType(page, 'State', 'Bihar')).map((t) => t.trim()).filter(Boolean);

  check('"Bihar": Bihar is first', /^bihar$/i.test(bihar[0] ?? ''), `first = "${bihar[0] ?? '(none)'}"`);

  // -- 3. 🔴 the regression guard: substring-only still matches ---------------
  /*
    "aryan" appears in HARYANA but starts nothing. A `startsWith` filter would
    return an empty list here while every other assertion in this file still
    passed.
  */
  const aryan = (await openAndType(page, 'State', 'aryan')).map((t) => t.trim()).filter(Boolean);

  check('🔴 "aryan" still finds Haryana — the filter is CONTAINS, not STARTS-WITH',
    aryan.some((t) => /haryana/i.test(t)), aryan.join(', ') || 'EMPTY — the filter was narrowed');

  // -- 4. nonsense finds nothing, and says so --------------------------------
  const nonsense = (await openAndType(page, 'State', 'zzqqxx')).map((t) => t.trim()).filter(Boolean);

  check('a query matching nothing returns no options',
    nonsense.length === 0, nonsense.join(', ') || 'none');
} catch (error) {
  /*
    🔴 THE THROW IS PRINTED, NOT SWALLOWED.

    The first run of this suite exited "0/0 passed" and said nothing else — the
    `finally` summarised an empty result list and `process.exit` ran before the
    error could surface. That is the hardest failure in this repo to read: it
    looks like a suite with no assertions rather than one that died on its
    first line. Whatever goes wrong here now says so.
  */
  results.push(false);
  console.log(`  FAIL  the suite threw before it could finish`);
  console.log(`        ${error?.message?.split('\n')[0] ?? error}`);
} finally {
  await browser.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
