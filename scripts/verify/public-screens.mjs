/*
  PHASE 7A — THE PUBLIC SITE, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY        shipped state asserted; three job fixtures created
    1. 🔴 NO JS     the listing with JavaScript DISABLED — if the job is in
                    that HTML, it was SERVER-RENDERED, which is the one claim
                    app.routes.server.ts makes that a normal page load cannot
                    distinguish from hydration
    2. FILTERS      pick a subject -> the URL carries it and the list narrows
    3. 🔒 ANONYMOUS no Authorization header on ANY request the site makes, no
                    cookie, nothing in storage
    4. THE DETAIL   the job's own <title>, its facts, and the Apply CTA
    5. 🔴 THE WALL  a draft job's real uid -> "no longer listed" + noindex,
                    and the page never names the reason
    6. THE FAQ      rendered from the database, including the answer 7A had to
                    correct
    7. 🔴 THE FORM  the payload it POSTs, asserted by interception — including
                    the honeypot field, sent untouched
    8. 🔒 HONEYPOT  hidden field filled -> it IS sent, and the page shows the
                    same thank-you a person gets
    9. 🔴 FAILED    a 500 -> the page says so, KEEPS what they wrote, and
                    offers the mailto: fallback 2.44 insisted on
   10. 375          the listing and the detail, measured on the document
   11. EXIT         fixtures gone, shipped state restored

  ----------------------------------------------------------------------------
  🔒 THIS SUITE SPENDS NO RATE-LIMIT BUDGET, AND THAT IS DELIBERATE
  ----------------------------------------------------------------------------
  The contact form allows three submissions per hour per IP. public-contract
  spends all three proving that limit; this suite used to spend two more, so a
  full regression ran one of them out of budget and reported the 429s as a
  broken honeypot.

  Every contact test here now INTERCEPTS, which is also the stronger
  screen-level assertion: it reads the exact bytes the form puts on the wire,
  which a row in a table can only imply. The server's behaviour on those bytes
  belongs to public-contract, and is tested there for real.

  ⚠️ So this suite can be run repeatedly, in any order, with no restart.

  Run (both APIs, jp-public :4500):
      node scripts/verify/public-screens.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SITE = 'http://localhost:4500';
const APP = 'http://localhost:5299/api';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1100 };
const PHONE = { width: 375, height: 812 };

const PROBE = 'PUBSCREEN';

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

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';
  DELETE FROM t_app_contact_enquiries WHERE Email LIKE 'pubscreen%';`);

/**
 * Waits for the listing to finish searching.
 *
 * 🔴 NOT `waitForLoadState('networkidle')`. While a search is in flight the
 * component renders "Searching…" INSTEAD of the cards, so a locator read at
 * that moment finds zero of them — which is how the filter test came to report
 * "0 of 2 card(s) remain" about a filter that was working correctly.
 *
 * networkidle is a heuristic about sockets; this is the actual state the
 * assertions are about.
 */
const settled = async (page) => {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Searching…'), undefined, { timeout: 15_000 });

  await page.waitForSelector('.job-results__count', { timeout: 15_000 });

  /*
    🔴 AND THE FILTER CONTROLS, WHICH ARE A SECOND, SEPARATE REQUEST.

    The listing fetches /jobs and /jobs/filters independently, and the two
    waits above only track the first. Under the runner this suite failed with
    "waitForURL timeout" after a selectOption that had found its option and
    selected it: the filters response landed in between, Angular re-rendered
    the <option> list on the signal update, and the selection went with it —
    so no change event, so no navigation.

    It passed standalone and failed under the runner, which is the signature of
    a race rather than a defect: identical code, different timing.

    ⚠️ Written so it cannot hang on the legitimate case. When no subject is
    reachable the control is not rendered at all (G40 does this to the city
    filter every run), so the absence of the select counts as settled.
  */
  await page.waitForFunction(
    () => {
      const select = document.querySelector('#filter-subject');

      return !select || select.options.length > 1;
    },
    undefined,
    { timeout: 15_000 },
  );
};

let browser;

try {
  // =========================================================================
  section('0. ENTRY — shipped state, then three job fixtures');
  // =========================================================================

  cleanup();

  /*
    ENTRY: the two pieces of shipped state this suite depends on, both restored
    by 7A after 2.44 had removed or deferred them.
  */
  check('entry: the seeded FAQ copy is live (floor 12)',
    Number(scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs WHERE Is_Active = 1 AND Is_Deleted = 0;`)) >= 12,
    'the /faq page renders from this');

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(sc.SchoolId AS varchar(10)) FROM t_app_schools sc
      INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
     WHERE u.Email = 'principal@greenwood.edu.in';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(10)) FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  /*
    THREE live jobs on three different subjects, so the subject filter has
    something to discriminate — a filter test against one row passes whatever
    it does. Plus a draft, for the wall. The third is long-titled, for the
    title-length case that site-audit.mjs caught at 66 characters.
  */
  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, MinExperienceMonths,
                            MaxExperienceMonths, SalaryMin, SalaryMax,
                            JobStatusId, LastDateToApply, PublishedOn, StateId, JobDescription)
    VALUES
      (${schoolId}, ${branchId}, N'${PROBE} Mathematics Teacher', 1, 1, 1, 2, 24, 72,
       35000, 55000, 2, '2027-12-31', SYSUTCDATETIME(), 1, N'Senior school mathematics.'),
      (${schoolId}, ${branchId}, N'${PROBE} Physics Teacher', 2, 1, 1, 1, 12, 48,
       30000, 48000, 2, '2027-12-31', SYSUTCDATETIME(), 1, N'Senior school physics.'),
      (${schoolId}, ${branchId}, N'${PROBE} Draft Teacher', 1, 1, 1, 1, NULL, NULL,
       NULL, NULL, 1, '2027-12-31', NULL, 1, NULL),

      /*
        ⚠️ A DELIBERATELY LONG TITLE. site-audit.mjs fails a page whose title
        exceeds 65 characters, and the first version of the detail page joined
        the job title and the school name unconditionally — which failed on the
        very first real job, at 66. Both halves are user data with no length this
        project controls, so the fixture carries the case that broke it.

        NOTE: no double quotes in this comment. sqlcmd -Q takes the whole batch
        as one argument, and a double quote inside it ends the argument early —
        the first version of this comment quoted the old title format and
        sqlcmd rejected the batch with Unexpected argument.
      */
      (${schoolId}, ${branchId},
       N'${PROBE} Senior Mathematics Statistics and Further Pure Mathematics Teacher',
       /*
         ⚠️ SUBJECT 3 (Chemistry), NOT 1. On subject 1 this row joined the
         Mathematics filter and became the first card — so section 2 counted
         two results where it expects one, and section 4 clicked THIS job and
         then found no salary, because this fixture deliberately has none.

         A fixture added for one test has to stay out of the others.
       */
       3, 1, 1, 1, NULL, NULL, NULL, NULL, 2, '2027-12-31', SYSUTCDATETIME(), 1, NULL);`);

  const uidOf = (suffix) => scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs WHERE JobTitle = N'${PROBE} ${suffix}';`);

  const mathUid = uidOf('Mathematics Teacher');
  const draftUid = uidOf('Draft Teacher');

  check('premise: three live fixtures on three subjects, plus a draft',
    [mathUid, draftUid].every((u) => u.length === 36),
    'a one-row filter test would pass whatever the filter did');

  browser = await chromium.launch();

  // =========================================================================
  section('1. 🔴 THE LISTING WITH JAVASCRIPT DISABLED');
  // =========================================================================

  /*
    🔴 THE ONE TEST THAT CAN TELL SERVER RENDERING FROM HYDRATION.

    With JS on, a job in the page proves nothing about WHEN it got there — an
    empty prerendered shell that fills in after hydration looks identical to a
    human. app.routes.server.ts claims /jobs is RenderMode.Server, and the
    `**` catch-all would silently prerender it instead. With JS OFF there is no
    hydration: whatever is on screen came from the server.
  */
  const noJs = await browser.newContext({ viewport: WIDE, javaScriptEnabled: false });
  const flat = await noJs.newPage();

  await flat.goto(`${SITE}/jobs`, { waitUntil: 'domcontentloaded' });

  const flatText = await flat.locator('body').innerText();

  console.log(`\n    with JS disabled, the page mentions the fixture ${(flatText.match(new RegExp(PROBE, 'g')) ?? []).length} time(s)\n`);

  check('🔴 the job listing is SERVER-RENDERED — the jobs are there with JS off',
    flatText.includes(`${PROBE} Mathematics Teacher`),
    'not a prerendered shell that fills in after hydration');

  check('🔴 …and so is the result count, which is computed from the response',
    /Showing \d+–\d+ of \d+ job/.test(flatText),
    flatText.match(/Showing[^\n]*/)?.[0] ?? 'MISSING');

  check('🔴 …and the draft is NOT in it',
    !flatText.includes(`${PROBE} Draft Teacher`), 'only published jobs are listed');

  await flat.screenshot({ path: path.join(OUT, '7a-jobs-no-js.png'), fullPage: true });

  await noJs.close();

  // =========================================================================
  section('2. FILTERS — the URL carries the search');
  // =========================================================================

  const context = await browser.newContext({ viewport: WIDE });

  /*
    🔒 Section 3 reads what this collects. Registered before the first
    navigation so nothing is missed.
  */
  const authHeaders = [];
  const apiCalls = [];

  context.on('request', (request) => {
    const url = request.url();

    if (!url.startsWith(APP)) return;

    apiCalls.push(`${request.method()} ${url.replace(APP, '')}`);

    const headers = request.headers();

    if (headers['authorization'] || headers['cookie']) {
      authHeaders.push(`${url.replace(APP, '')}: ${headers['authorization'] ? 'authorization' : 'cookie'}`);
    }
  });

  const page = await context.newPage();

  await page.goto(`${SITE}/jobs`, { waitUntil: 'domcontentloaded' });
  await settled(page);

  const bothVisible = await page.locator('.job-card__title').count();

  /*
    ⚠️ Selected by VALUE, resolved from the option's own text.

    `selectOption` takes a string label, not a pattern — and the labels carry a
    live count ("Mathematics (1)"), so no literal string matches reliably. The
    value is the subject's master id, which is what the URL needs anyway.

    ⚠️ Not hardcoded to 1 even though Mathematics is id 1 today: a master id
    pinned into a test is a test that breaks when the master is re-seeded, and
    it would break by SILENTLY filtering on something else.
  */
  /*
    ⚠️ Read with evaluate rather than a locator filter. An <option> is not
    "visible" in the sense Playwright's locators wait for, so
    `.filter({ hasText })` on one times out rather than matching.
  */
  const mathsOption = await page.evaluate(() => {
    const select = document.querySelector('#filter-subject');

    return [...(select?.options ?? [])]
      .find((option) => option.text.startsWith('Mathematics'))?.value ?? null;
  });

  check('premise: the subject filter offers Mathematics, with a count',
    !!mathsOption, `value ${mathsOption}`);

  await page.selectOption('#filter-subject', mathsOption ?? '');
  await page.waitForURL(/subjectId=/, { timeout: 10_000 });
  await settled(page);

  const filteredTitles = await page.locator('.job-card__title').allInnerTexts();

  console.log(`\n    unfiltered: ${bothVisible} card(s)`);
  console.log(`    url now   : ${page.url().replace(SITE, '')}`);
  console.log(`    filtered  : ${filteredTitles.join(' | ')}\n`);

  check('the subject filter puts itself in the URL',
    /subjectId=\d+/.test(page.url()), page.url().replace(SITE, ''));

  check('🔴 …and the list actually narrows — Physics is gone',
    filteredTitles.some((t) => t.includes('Mathematics'))
      && !filteredTitles.some((t) => t.includes('Physics')),
    `${filteredTitles.length} of ${bothVisible} card(s) remain`);

  /*
    ⚠️ A filtered URL must survive a reload, because that is what a shared link
    IS. This is the half that would break if the filters lived in component
    state — the page would come back unfiltered and look like it lost the search.
  */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settled(page);

  const afterReload = await page.locator('.job-card__title').allInnerTexts();

  /*
    ⚠️ Asserted against what the filter MEANS, not against the previous array's
    length. Comparing the two counts made this test depend on the one above
    having measured correctly — so when that one read the DOM mid-load and saw
    zero, this one failed too and reported "1 card(s), same as before", which
    was both wrong and confusing.
  */
  check('🔴 …and the filtered URL survives a reload — it is a shareable link',
    afterReload.length === 1 && afterReload[0].includes('Mathematics'),
    `${afterReload.length} card(s): ${afterReload.join(' | ')}`);

  await page.screenshot({ path: path.join(OUT, '7a-jobs-filtered.png'), fullPage: true });

  // =========================================================================
  section('3. 🔒 THE SITE IS ANONYMOUS, AND EVERY REQUEST PROVES IT');
  // =========================================================================

  console.log(`\n    API calls observed: ${apiCalls.length}`);
  [...new Set(apiCalls)].forEach((c) => console.log(`      ${c}`));
  console.log('');

  check('premise: the page did talk to the API',
    apiCalls.length > 0, `${apiCalls.length} request(s)`);

  /*
    🔒 NO TOKEN, NO COOKIE, ON ANYTHING. jp-public is unfederated and has no
    auth at all (2.43) — this is that claim measured at the wire rather than
    argued from the absence of an interceptor.
  */
  check('🔒 NOT ONE request carried an Authorization header or a cookie',
    authHeaders.length === 0,
    authHeaders.length ? `LEAKED: ${authHeaders.join(', ')}` : `${apiCalls.length} request(s), all bare`);

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie,
  }));

  console.log(`    localStorage: ${JSON.stringify(storage.local)}`);
  console.log(`    sessionStorage: ${JSON.stringify(storage.session)}`);
  console.log(`    document.cookie: "${storage.cookies}"\n`);

  check('🔒 …and nothing was stored in the browser either',
    storage.local.length === 0 && storage.session.length === 0 && storage.cookies === '',
    'no token to steal, because there is none');

  // =========================================================================
  section('4. THE DETAIL PAGE');
  // =========================================================================

  await page.locator('.job-card__title a').first().click();
  await page.waitForURL(/\/jobs\/.+/, { timeout: 10_000 });

  /*
    🔴 WAIT FOR THE ARTICLE, NOT FOR THE NETWORK.

    `networkidle` fired here while the title was still the route's fallback, and
    the title assertion failed on a page that was about to be correct. Measured
    with a MutationObserver: the document holds three titles in order —
    "Teaching jobs in India" (the listing), "Teaching job" (the route's static
    fallback, set on NavigationEnd), then the job's own (set by setFromData when
    the response arrives). Asserting between the second and third is a race, and
    the fix is to wait for the loaded state the assertion is about.
  */
  await page.waitForSelector('article', { timeout: 10_000 });
  await page.waitForFunction(
    () => !document.title.startsWith('Teaching job —'), undefined, { timeout: 10_000 });

  const slugInUrl = page.url().replace(`${SITE}/jobs/`, '');

  console.log(`\n    slug: ${slugInUrl}`);
  console.log(`    title: ${await page.title()}\n`);

  check('🔴 the slug is words-then-uid — the uid resolves, the words are for people',
    slugInUrl.endsWith(mathUid) && slugInUrl.length > mathUid.length,
    'renaming the vacancy cannot break a shared link');

  check('🔴 the page title is the JOB\'S title, not a generic one',
    (await page.title()).includes('Mathematics Teacher'),
    'route data is static; this came from the response');

  const detailText = await page.locator('article').innerText();

  check('…and the salary is in Indian digit grouping',
    detailText.includes('₹35,000'), detailText.match(/₹[\d,]+[^\n]*/)?.[0] ?? 'MISSING');

  check('…and experience is in years, converted from the stored months',
    /2–6 years/.test(detailText), detailText.match(/[\d.]+–[\d.]+ years/)?.[0] ?? 'MISSING');

  const applyHref = await page.locator('a:has-text("Apply for this job")').first().getAttribute('href');

  console.log(`    apply -> ${applyHref}\n`);

  /*
    🔴 STRAIGHT TO TEACHER SIGNUP (2.43, confirmed by 7A-0.0), and with NO
    redirect parameter — G41 records that jp-teacher reads none, has no apply
    route, and keys jobs by an integer this surface never exposes. A parameter
    nothing reads is worse than none, because the next person assumes the link
    is correct.
  */
  check('🔴 Apply goes straight to TEACHER signup, not to the chooser',
    (applyHref ?? '').includes('/auth/register') && (applyHref ?? '').includes('4400'),
    applyHref ?? 'MISSING');

  check('🔴 …and carries NO redirect parameter — nothing reads one yet (G41)',
    !(applyHref ?? '').includes('redirect'),
    'honest rather than aspirational');

  await page.screenshot({ path: path.join(OUT, '7a-job-detail.png'), fullPage: true });

  /*
    🔴 AND A LONG TITLE STILL FITS.

    65 characters is where a search result truncates, and site-audit.mjs fails
    above it. The title here is built from the job's title and the school's
    name, and fitTitle() degrades in three steps: keep "at <school>", else drop
    the school, else truncate the title with an ellipsis. It never cuts a
    school's name mid-word, because "Senior Teacher at Delhi Publi…" names a
    school nobody can identify.
  */
  const longUid = uidOf('Senior Mathematics Statistics and Further Pure Mathematics Teacher');

  await page.goto(`${SITE}/jobs/x-${longUid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article', { timeout: 10_000 });
  await page.waitForFunction(
    () => !document.title.startsWith('Teaching job —'), undefined, { timeout: 10_000 });

  const longTitle = await page.title();

  console.log(`\n    a ${(`${PROBE} Senior Mathematics Statistics and Further Pure Mathematics Teacher`).length}-character job title renders as:`);
  console.log(`    "${longTitle}" (${longTitle.length} chars)\n`);

  check('🔴 a long job title still produces a title inside the 65-char limit',
    longTitle.length <= 65, `${longTitle.length} chars`);

  check('…and it was truncated with an ellipsis rather than cut off dead',
    longTitle.includes('…'), 'the reader can see it continues');

  check('🔒 …and the school\'s name was dropped whole, never cut mid-word',
    !longTitle.includes(' at Nalanda Vidy') || longTitle.includes('Nalanda Vidyalaya'),
    'a half-named school is worse than an unnamed one');

  // =========================================================================
  section('5. 🔴 THE WALL, THROUGH THE UI');
  // =========================================================================

  await page.goto(`${SITE}/jobs/some-title-${draftUid}`, { waitUntil: 'networkidle' });

  const wallText = await page.locator('body').innerText();
  const robots = await page.locator('meta[name="robots"]').getAttribute('content');

  console.log(`\n    heading: ${await page.locator('h1').innerText()}`);
  console.log(`    robots : ${robots}\n`);

  check('🔴 a draft job\'s real uid shows "no longer listed"',
    wallText.includes('no longer listed'), await page.locator('h1').innerText());

  /*
    🔒 AND IT DOES NOT SAY WHY. "This job is a draft" confirms the uid is real,
    which on a page anyone can load is an enumeration oracle.

    ⚠️ Measured on the page TEXT, not the HTML — the requested URL is echoed
    into og:url and canonical, so a slug containing the word "draft" would
    appear in the markup through no fault of the server.
  */
  check('🔒 …and never names the reason — draft, expired, closed or pulled',
    !/draft|expired|closed|pulled|moderat|unpublish/i.test(wallText),
    'one message for every reason');

  check('🔴 …and it is noindex, so a dead job does not sit in search results',
    (robots ?? '').includes('noindex'), robots ?? 'MISSING');

  // =========================================================================
  section('6. THE FAQ, FROM THE DATABASE');
  // =========================================================================

  await page.goto(`${SITE}/faq`, { waitUntil: 'networkidle' });

  const faqText = await page.locator('body').innerText();

  check('the FAQ renders its questions from the API',
    faqText.includes('What can a school see about me?')
      && faqText.includes('What does verification involve?'),
    'both audience sections present');

  /*
    🔴 THE ANSWER 7A HAD TO CORRECT. The page used to say public job search was
    "not yet" built — on a site that now has it. This asserts the correction
    where a visitor would actually read it.
  */
  check('🔴 …and the public-search answer no longer says "Not yet"',
    faqText.includes('Can I search for jobs without an account?')
      && !/Not yet\. Public job search/i.test(faqText),
    'the page would otherwise deny the feature it is running on');

  await page.screenshot({ path: path.join(OUT, '7a-faq.png'), fullPage: true });

  // =========================================================================
  section('7. 🔴 WHAT THE CONTACT FORM ACTUALLY POSTS');
  // =========================================================================

  await page.goto(`${SITE}/contact`, { waitUntil: 'networkidle' });

  /*
    🔴 INTERCEPTED, NOT SENT — and that is the stronger test here.

    Fulfilling the response in the browser asserts the exact bytes the form
    builds, which a row in a table can only imply. It also leaves the form's
    3-per-hour budget for sections 8 and 9.
  */
  let posted = null;

  await page.route(`${APP}/public/contact`, async (route) => {
    posted = route.request().postDataJSON();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 1, code: null, message: 'Thank you', data: null }),
    });
  });

  await page.fill('#name', 'Interception Probe');
  await page.fill('#email', 'pubscreen-intercept@example.com');
  await page.fill('#subject', 'What the form sends');
  await page.fill('#message', 'Asserting the payload rather than inferring it.');
  await page.click('button[type="submit"]');

  await page.waitForFunction(() => document.body.innerText.includes('Thank you'), { timeout: 10_000 });

  console.log(`\n    payload: ${JSON.stringify(posted)}\n`);

  check('the form POSTs the fields it collected',
    posted?.name === 'Interception Probe' && posted?.subject === 'What the form sends',
    Object.keys(posted ?? {}).join(', '));

  /*
    🔒 THE HONEYPOT IS IN THE PAYLOAD, EMPTY. It must be SENT — the server is
    what decides — and it must be empty when a person fills the form, because a
    browser autofilling a field called "website" would make a real visitor look
    like a bot and silently discard their enquiry.
  */
  check('🔒 …and the honeypot field is sent, and is empty for a person',
    'website' in (posted ?? {}) && !posted.website,
    `website: ${JSON.stringify(posted?.website)}`);

  check('🔴 …and the "role" control is gone — there is nowhere to store it',
    !('role' in (posted ?? {})) && !(await page.locator('input[type="radio"]').count()),
    'a form that collects something and discards it is the one wrong option');

  const honeypotVisible = await page.locator('#website').isVisible();

  check('🔒 …and the honeypot is invisible to a person',
    !honeypotVisible, 'off-screen, tabindex -1, aria-hidden');

  await page.unroute(`${APP}/public/contact`);

  // =========================================================================
  section('8. 🔒 THE HONEYPOT, THROUGH THE FORM — same words, nothing sent');
  // =========================================================================

  /*
    🔴 WHY THIS SUITE NO LONGER SUBMITS FOR REAL, AND WHY THAT IS NOT A
    WEAKENING.

    The contact form allows THREE submissions per hour per IP. public-contract
    spends all three proving that limit, and this suite used to spend two more
    — so whichever ran second in a full regression got 429s and reported them
    as a broken honeypot. A full regression run is what showed it.

    The division is now clean, and each half is tested where it can be tested
    properly:

      public-contract  the SERVER contract — a real row appears, a honeypot
                       writes nothing, the fourth attempt is refused. It owns
                       the budget because it is testing the budget.

      public-screens   the SCREEN — the exact bytes the form puts on the wire,
                       and the states it renders. Interception asserts the
                       payload directly, which a row in a table can only imply.

    ⚠️ Nothing is now untested. Section 7 proves the browser sends the right
    payload; public-contract proves the server does the right thing with that
    payload. What is gone is a redundant hop, not a case.
  */
  await page.goto(`${SITE}/contact`, { waitUntil: 'networkidle' });

  let bottedPayload = null;

  await page.route(`${APP}/public/contact`, async (route) => {
    bottedPayload = route.request().postDataJSON();

    /*
      The server's REAL answer to a filled honeypot: 200, with the same body a
      person gets. public-contract asserts that is what the server actually
      sends; this asserts the page does the right thing when it arrives.
    */
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 1,
        code: null,
        message: 'Thank you — we have your message and will reply by email.',
        data: null,
      }),
    });
  });

  await page.fill('#name', 'Spam Bot');
  await page.fill('#email', 'pubscreen-bot@example.com');
  await page.fill('#subject', 'Cheap watches');
  await page.fill('#message', 'Buy now buy now buy now.');

  /*
    A bot fills every input it finds, including the one it cannot see. Done
    through the DOM because the field is off-screen, and filling it is exactly
    what a person could never do.
  */
  await page.evaluate(() => {
    const input = document.querySelector('#website');

    if (input) {
      input.value = 'http://spam.example';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  await page.click('button[type="submit"]');

  await page.waitForFunction(() => document.body.innerText.includes('Thank you'), { timeout: 10_000 });

  console.log(`\n    payload: ${JSON.stringify(bottedPayload)}\n`);

  check('🔒 the filled honeypot IS sent to the server — the page hides nothing',
    bottedPayload?.website === 'http://spam.example',
    `website: ${JSON.stringify(bottedPayload?.website)}`);

  check('🔒 …and the bot sees the SAME thank-you a person sees',
    (await page.locator('.notice__title').innerText()).includes('Thank you'),
    'a different message teaches it which field is the trap');

  check('…and the page promises no reply time it cannot keep',
    !/24 hours|within a day|immediately/i.test(await page.locator('.notice').innerText()),
    'nothing enforces a response time, so nothing claims one');

  await page.screenshot({ path: path.join(OUT, '7a-contact-sent.png'), fullPage: true });

  await page.unroute(`${APP}/public/contact`);

  // =========================================================================
  section('9. 🔴 A FAILED SEND KEEPS WHAT THEY WROTE');
  // =========================================================================

  /*
    🔴 THE CASE 2.44 CARED MOST ABOUT. Its form could not send at all, and it
    refused to show a success message because "a fake thanks means their enquiry
    disappears and they never follow up any other way".

    7A can send — so the failure path is where that concern now lives: when a
    send fails, the message must still be in the box and there must be another
    way out. Forced with a 500 rather than waited for, because a real outage is
    not something a suite can schedule.
  */
  await page.goto(`${SITE}/contact`, { waitUntil: 'networkidle' });

  await page.route(`${APP}/public/contact`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 0, code: 'INTERNAL_ERROR', message: 'Something went wrong.', data: null,
      }),
    });
  });

  const written = 'Please tell me what verification involves before we register.';

  await page.fill('#name', 'Persistent Visitor');
  await page.fill('#email', 'pubscreen-fail@example.com');
  await page.fill('#subject', 'A question we must not lose');
  await page.fill('#message', written);
  await page.click('button[type="submit"]');

  await page.waitForFunction(
    () => document.body.innerText.includes('could not send'), { timeout: 10_000 });

  const stillThere = await page.inputValue('#message');
  /*
    ⚠️ The BUTTON, not the first mailto: on the page. The notice's own text
    carries a plain 'or email hello@staffroom.in' link before it, so .first()
    picked that one — which has no prefill, and the assertion failed on a page
    that was behaving correctly.
  */
  const mailto = await page
    .locator('a:has-text("Send it by email")')
    .first()
    .getAttribute('href');

  console.log(`\n    message still in the box: ${stillThere === written}`);
  console.log(`    mailto offered: ${(mailto ?? '').slice(0, 60)}…\n`);

  check('🔴 a failed send says so — it does not claim success',
    (await page.locator('.notice__title').innerText()).includes('could not send'),
    'the failure 2.44 refused to paper over');

  check('🔴 …and what they wrote is STILL IN THE FORM',
    stillThere === written, `${stillThere.length} of ${written.length} characters kept`);

  check('🔴 …and a mailto: fallback is offered, prefilled',
    (mailto ?? '').includes('pubscreen-fail%40example.com')
      || (mailto ?? '').includes('Persistent%20Visitor'),
    'a form that cannot submit and offers nothing loses the enquiry');

  await page.screenshot({ path: path.join(OUT, '7a-contact-failed.png'), fullPage: true });

  await page.unroute(`${APP}/public/contact`);

  // =========================================================================
  section('10. 375 — the listing and the detail on a phone');
  // =========================================================================

  const phone = await browser.newContext({ viewport: PHONE });
  const small = await phone.newPage();

  for (const [label, url, file] of [
    ['listing', `${SITE}/jobs`, '7a-jobs-375.png'],
    ['detail', `${SITE}/jobs/x-${mathUid}`, '7a-job-detail-375.png'],
  ]) {
    await small.goto(url, { waitUntil: 'networkidle' });

    /*
      🔴 MEASURED ON THE DOCUMENT, not on a node count. An element wider than
      the viewport is what actually makes a phone scroll sideways, and it is
      the thing a card of facts in a grid would do first.
    */
    const overflow = await small.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth,
      widest: [...document.querySelectorAll('*')]
        .map((el) => ({ tag: el.tagName + (el.className ? `.${String(el.className).split(' ')[0]}` : ''), w: el.scrollWidth }))
        .sort((a, b) => b.w - a.w)[0],
    }));

    console.log(`\n    ${label}: document ${overflow.doc}px in a ${overflow.view}px viewport`);
    console.log(`    widest element: ${overflow.widest?.tag} at ${overflow.widest?.w}px`);

    check(`375: the ${label} does not scroll sideways`,
      overflow.doc <= overflow.view + 1,
      `${overflow.doc} vs ${overflow.view}`);

    await small.screenshot({ path: path.join(OUT, file), fullPage: true });
  }

  console.log('');

  await phone.close();
  await context.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  section('11. EXIT — fixtures gone, shipped state restored');

  try {
    if (browser) await browser.close();

    cleanup();

    check('exit: no probe job is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';`) === '0',
      'none');

    /*
      🔴 AND NOW A REAL ASSERTION RATHER THAN A TIDY-UP. Every contact test in
      this suite intercepts, so NO row should ever have been written. If one
      appears, an interception did not take effect and a test that believes it
      proved something about the page actually reached the server.
    */
    check('exit: this suite wrote NO enquiry at all — every send was intercepted',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_contact_enquiries
         WHERE Email LIKE 'pubscreen%';`) === '0',
      'none');

    check('exit: the seeded FAQ copy is untouched',
      Number(scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_faqs WHERE Is_Active = 1 AND Is_Deleted = 0;`)) >= 12,
      'this suite reads it and never writes it');
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
