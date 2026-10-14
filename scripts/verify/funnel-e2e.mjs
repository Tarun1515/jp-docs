/*
  PHASE 7B-0 — THE PUBLIC -> TEACHER FUNNEL, ONE BROWSER SESSION, SIGNED OUT.

  ----------------------------------------------------------------------------
    0. ENTRY       shipped state; one live job, and an email nobody has used
    1. 🔴 THE WALK public job detail -> Apply -> teacher signup -> land ON
                   that job's apply screen, with the job NAMED and the teacher
                   greeted by the name they typed (G43, end to end)
    2. 🔒 FORCED   ?returnUrl= to an absolute, protocol-relative, backslashed
                   or foreign-origin URL is never even stored — and a sign-in
                   carrying one lands on the dashboard
    3. 🔴 THE OLD  the authenticated hole G41 did not mention: the auth guard
       HOLE        and the session-expiry interceptor have written ?returnUrl=
                   since Phase 3 and nothing read it
    4. 🔴 THE UID  a draft job's uid on the apply route -> "no longer listed",
       WALL        because the uid path meets the same WHERE clause
    5. EXIT        the account this run created is gone from both databases

  ----------------------------------------------------------------------------
  🔴 WHY THIS IS ONE SESSION AND NOT FOUR TESTS
  ----------------------------------------------------------------------------
  G41's three missing pieces each looked fine on their own. What was broken was
  the JOIN between them: a link that emitted a parameter, an app that read
  none, and a route that did not exist. Three green unit tests would have told
  us nothing, which is why the brief asked for the whole walk in one browser —
  signed out at the start, exactly as a stranger arrives.

  ⚠️ It registers a REAL account and removes it in the finally. The email
  carries a timestamp so a crashed run cannot collide with the next one.

  Run (both APIs, jp-shared :4999, jp-public :4500, jp-teacher :4400):
      node scripts/verify/funnel-e2e.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SITE = 'http://localhost:4500';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1100 };

const PROBE = 'FUNNEL';
const stamp = `${Date.now()}`.slice(-7);
const EMAIL = `verify.funnel.${stamp}@yopmail.com`;
const PASSWORD = 'Funnel#Teacher2026!';

/**
 * ⚠️ A DISTINCTIVE NAME, ON PURPOSE (G43). The landing greets by name, and the
 * assertion below is the only proof that the name survived the whole funnel —
 * form, request, SSO, provisioning, column, and back out through the teacher
 * app's own profile read. A name like "Test" could match something already on
 * the page.
 */
const FULL_NAME = 'Priya Ramaswamy';

/**
 * 🔴 THE SIGN-IN SECTIONS USE THE ACCOUNT THIS RUN CREATES, NOT A SEEDED ONE.
 *
 * They used a seeded teacher first, and the suite failed on its fourth run of
 * the hour with "Too many attempts. Wait a minute, then try again." — which is
 * the per-IDENTIFIER cap (LoginPerIdentifier 10 per 3600 seconds, documented in
 * lib/login.mjs), and that one cannot be waited out inside a run. Every suite
 * that signs in as a seeded account draws on the same hourly budget, so a
 * browser suite doing it two or three times is a regression failure waiting for
 * a busy afternoon.
 *
 * Section 1 registers a brand-new account anyway. Reusing it for sections 2 and
 * 3 makes the whole suite self-contained: three sign-ins against an identifier
 * that has never been used, well inside the hourly cap, and nothing borrowed
 * from a shared account that other suites are also spending.
 *
 * ⚠️ The per-IP window (5 per 60 seconds) still applies across all accounts —
 * that one IS waitable, and signIn below waits it out.
 */
const OWN = { id: EMAIL, pw: PASSWORD };

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

const cleanupJobs = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_applications WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';`);

/**
 * Sign out properly.
 *
 * 🔴 COOKIES ARE NOT WHERE THE SESSION IS. TokenStorageService keeps the access
 * and refresh tokens in localStorage (deliberately — it survives a reload and
 * other tabs), so clearing cookies alone leaves the app signed in. The symptom
 * is subtle: /auth/login redirects away because somebody is already signed in,
 * and the suite times out waiting for a login form that will never render.
 *
 * ⚠️ localStorage can only be cleared while ON the origin, so this navigates
 * there first. Clearing before the first navigation is a no-op against
 * about:blank.
 */
const signOut = async (page) => {
  await page.goto(`${TEACHER_APP}/auth/login`, { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* Storage disabled — then there was no session to clear. */
    }
  });
};

/**
 * Sign in through the UI and wait for the app to settle.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHY THIS IS NOT THREE LINES OF fill + click + waitForURL
 * ----------------------------------------------------------------------------
 * The SSO allows LoginPerIp 5 per 60 seconds (lib/login.mjs documents it, and
 * exists because of it). A browser suite signs in through the form, so it
 * cannot use that module's token cache — and this suite signs in two or three
 * times per run, which is fine alone and spills over the window when the suite
 * is run twice in quick succession, or inside a regression behind another
 * browser suite.
 *
 * 🔴 AND THE SYMPTOM IS THE WRONG STORY. Without this, a refused sign-in
 * surfaces as "page.waitForURL: Timeout 30000ms exceeded", which reads as "the
 * app did not navigate" — so the next hour is spent in the router. It cost two
 * runs of this suite to notice. Here the limiter is detected, reported in its
 * own words, waited out, and retried.
 *
 * ⚠️ Retries are for the LIMITER only. A wrong password is reported and not
 * retried: retrying a credential failure spends the budget it is failing on,
 * and turns one clear red into a timeout.
 */
const signIn = async (page, who, expectUrl) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForSelector('input#loginId', { timeout: 20_000 });

    await page.fill('input#loginId', who.id);
    await page.fill('input#password', who.pw);
    await page.locator('button[type="submit"]').first().click();

    /*
      Whichever happens first: the app navigates, or the form shows why not.
      Racing them is what turns a timeout into a message.
    */
    const outcome = await Promise.race([
      page.waitForURL(expectUrl, { timeout: 25_000 }).then(() => 'navigated'),
      page.locator('.form-error, .field__error, [role="alert"]')
        .first().waitFor({ state: 'visible', timeout: 25_000 }).then(() => 'refused'),
    ]).catch(() => 'timeout');

    if (outcome === 'navigated') {
      return { ok: true, attempt };
    }

    const message = outcome === 'refused'
      ? (await page.locator('.form-error, .field__error, [role="alert"]').first().innerText()).trim()
      : '(no message — neither navigation nor error)';

    const limited = /too many|try again|rate|attempt/i.test(message);

    if (!limited || attempt === 3) {
      return { ok: false, attempt, message };
    }

    console.log(`    ⚠️ sign-in refused (attempt ${attempt}): ${message.slice(0, 60)}`);
    console.log('       waiting 65s — long enough to clear the per-IP window (5 per 60s)');

    /*
      ⚠️ 65 SECONDS, NOT 25. The window is sixty, so a shorter wait retries
      inside it and spends another attempt for nothing — which is how the first
      version burned all three retries without ever leaving the window.

      ⚠️ It cannot clear the per-IDENTIFIER cap (10 per 3600s), and nothing
      inside a run can. That is why this suite signs in as the account it
      created rather than a shared seeded one.
    */
    await new Promise((resolve) => { setTimeout(resolve, 65_000); });

    /*
      🔴 NO SIGN-OUT BETWEEN RETRIES, AND THIS LINE USED TO BE ONE.

      signOut clears sessionStorage — which is where the pending destination
      lives. So the retry worked and landed on /dashboard, and the suite
      reported that the guard's returnUrl was ignored. The feature was fine;
      the retry had deleted the thing under test.

      Nothing needs resetting anyway: a refused sign-in leaves the visitor
      signed out on the same login screen, with the form still there.
    */
  }

  return { ok: false, attempt: 3, message: 'exhausted' };
};

let browser;

try {
  // =========================================================================
  section('0. ENTRY — one live job, one draft, and an unused email');
  // =========================================================================

  cleanupJobs();

  const schoolId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(sc.SchoolId AS varchar(10)) FROM t_app_schools sc
      INNER JOIN t_app_school_users su ON su.SchoolId = sc.SchoolId
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
     WHERE u.Email = 'principal@greenwood.edu.in';`));

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(10)) FROM t_app_school_branches
     WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  sql(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId,
                            LastDateToApply, PublishedOn, StateId, JobDescription)
    VALUES
      (${schoolId}, ${branchId}, N'${PROBE} Chemistry Teacher', 3, 1, 1, 1, 2,
       '2027-12-31', SYSUTCDATETIME(), 1, N'The job the funnel carries.'),
      (${schoolId}, ${branchId}, N'${PROBE} Draft Teacher', 3, 1, 1, 1, 1,
       '2027-12-31', NULL, 1, NULL);`);

  const liveUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs
     WHERE JobTitle = N'${PROBE} Chemistry Teacher';`);

  const draftUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(JobUid AS varchar(50))) FROM t_app_jobs
     WHERE JobTitle = N'${PROBE} Draft Teacher';`);

  check('premise: a live job and a draft exist',
    liveUid.length === 36 && draftUid.length === 36, `live ${liveUid.slice(0, 8)}…`);

  check('premise: nobody has registered with this run\'s email',
    scalar(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4)) FROM jp_sso.dbo.t_sso_users
             WHERE Email = '${EMAIL}';`) === '0', EMAIL);

  browser = await chromium.launch();

  /*
    🔴 ONE CONTEXT FOR THE WHOLE WALK, created signed out. A fresh context per
    step would hide exactly the kind of bug this suite exists to find — a
    destination that does not survive a navigation.
  */
  const context = await browser.newContext({ viewport: WIDE });
  const page = await context.newPage();

  // =========================================================================
  section('1. 🔴 THE WALK — public job -> Apply -> signup -> that job');
  // =========================================================================

  await page.goto(`${SITE}/jobs?search=${PROBE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !document.body.innerText.includes('Searching…'), undefined, { timeout: 15_000 });
  await page.waitForSelector('.job-results__count', { timeout: 15_000 });

  const cardTitles = await page.locator('.job-card__title').allInnerTexts();

  check('the public listing shows the live job and not the draft',
    cardTitles.some((t) => t.includes('Chemistry')) && !cardTitles.some((t) => t.includes('Draft')),
    cardTitles.join(' | ') || 'none');

  await page.locator('.job-card__title a').first().click();
  await page.waitForURL(/\/jobs\/.+/, { timeout: 10_000 });
  await page.waitForSelector('article', { timeout: 10_000 });

  const applyHref = await page.locator('a:has-text("Apply for this job")').first().getAttribute('href');

  console.log(`\n    Apply href: ${applyHref}\n`);

  /*
    🔴 THE LINK THAT DID NOT EXIST ONE PHASE AGO. 7A had to remove the
    parameter because nothing on the other side read it (G41); this asserts it
    is back, that it names the job by UID, and that it points at signup.
  */
  check('🔴 Apply carries the job as a returnUrl — G41\'s parameter is back',
    (applyHref ?? '').includes('returnUrl='), applyHref ?? 'MISSING');

  check('🔴 …and the destination is this job\'s apply route, by UID',
    decodeURIComponent(applyHref ?? '').includes(`/jobs/${liveUid}/apply`),
    decodeURIComponent((applyHref ?? '').split('returnUrl=')[1] ?? ''));

  check('…and it still goes straight to TEACHER signup, not the chooser (2.43)',
    (applyHref ?? '').includes('4400') && (applyHref ?? '').includes('/auth/register'),
    'the question was answered by being on a job page');

  /* Follow it exactly as a visitor would. */
  await page.locator('a:has-text("Apply for this job")').first().click();
  await page.waitForURL(/4400\/auth\/register/, { timeout: 20_000 });
  await page.waitForSelector('input#email', { timeout: 20_000 });

  console.log(`    landed on: ${page.url().replace(TEACHER_APP, '')}\n`);

  const registerCopy = await page.locator('body').innerText();

  /*
    ⚠️ The signup screen SAYS why they are there. Somebody who pressed Apply
    and finds a bare registration form has no confirmation that the job came
    with them.
  */
  check('🔴 the signup screen says it will take them back to that job',
    /take you straight back to that job/i.test(registerCopy),
    'the capture happened and the copy reflects it');

  /*
    ⚠️ Filled by INPUT ID, not by formControlName. The password sits inside a
    shared <ui-password-field>, so the formControlName attribute is on the
    COMPONENT and never on the input a browser can type into. Its inputId is
    what reaches the DOM.

    ⚠️ 'name' is required by this form and is NOT sent to the API —
    RegisterTeacherRequest has email, mobile and password only, and the
    component's payload destructures exactly those three. Recorded as G43; the
    suite fills it because the form will not submit otherwise, which is the
    whole reason the gap is worth recording.
  */
  await page.fill('input#name', FULL_NAME);
  await page.fill('input#email', EMAIL);
  await page.fill('input#new-password', PASSWORD);

  await page.screenshot({ path: path.join(OUT, '7b0-funnel-signup.png'), fullPage: true });

  await page.locator('button[type="submit"]').first().click();

  /*
    🔴 THE ASSERTION THE WHOLE PHASE IS FOR. Registration signs them in behind
    the scenes and the stored destination is consumed — so the URL that settles
    must be the job's apply route, not /dashboard.
  */
  await page.waitForURL(new RegExp(`/jobs/${liveUid}/apply`), { timeout: 30_000 });

  console.log(`    settled on: ${page.url().replace(TEACHER_APP, '')}\n`);

  check('🔴 after signup the visitor lands ON that job\'s apply route',
    page.url().includes(`/jobs/${liveUid}/apply`), page.url().replace(TEACHER_APP, ''));

  await page.waitForSelector('.banner--info, .job', { timeout: 20_000 });

  const landed = await page.locator('body').innerText();

  check('🔴 …and the page NAMES the job they were applying for',
    landed.includes('Chemistry Teacher') && /You were applying for/i.test(landed),
    landed.match(/You were applying for[^\n]*/)?.[0]?.slice(0, 70) ?? 'NOT NAMED');

  /*
    ⚠️ And it says nothing has been sent. Four screens in, the honest thing is
    to be explicit — otherwise somebody reasonably assumes applying happened.
  */
  check('🔴 …and says plainly that nothing has been sent yet',
    /Nothing has been sent yet/i.test(landed), 'no silent application');

  /*
    🔴 AND THE NAME THEY TYPED SURVIVED THE WHOLE FUNNEL (G43).

    This is the assertion that closes G43, and it is deliberately made HERE
    rather than against the database: the name has to cross the signup form,
    the request contract, the SSO account, the provisioning procedure's
    @FullName, the column, and then come back out through the teacher app's own
    profile read. A SQL check would prove one link; the greeting proves the
    chain.

    ⚠️ Until 7B this was impossible to assert at all. The form required a name
    and RegisterTeacherRequest had no field for it, so every teacher typed one
    and it never left the browser — while 002_provisioning_accounts.sql had an
    @FullName parameter and AuthService passed it a literal null.
  */
  /*
    ⚠️ WAITED FOR, NOT READ IMMEDIATELY. The greeting needs the teacher's own
    profile, which is a SECOND request made after the job has already rendered
    — so the banner appears without a name and gains one a moment later.

    The first version read the page as soon as the banner existed and reported
    "NOT GREETED" for a feature that worked: a probe with an extra two seconds
    showed "Welcome, Priya Ramaswamy — you were applying for …". Waiting on the
    thing being asserted is the fix, as it was twice before in this suite.
  */
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    FULL_NAME,
    { timeout: 15_000 },
  ).catch(() => { /* asserted below, with the page's actual text as evidence */ });

  const greeted = await page.locator('body').innerText();

  console.log(`    greeted as: ${greeted.match(new RegExp(`[^\\n]*${FULL_NAME}[^\\n]*`))?.[0]?.trim()?.slice(0, 72) ?? 'NOT GREETED'}`);

  check('🔴 …and the name typed at signup is on the page — G43, end to end',
    greeted.includes(FULL_NAME),
    `"${FULL_NAME}" crossed form -> request -> SSO -> provisioning -> column -> screen`);

  check('🔒 …and the apply control is there, so consent is still theirs to give',
    (await page.locator('button:has-text("Apply for this job")').count()) > 0,
    'applying is consent (2.56) — the funnel delivers them, it does not apply');

  await page.screenshot({ path: path.join(OUT, '7b0-funnel-landed.png'), fullPage: true });

  /* The destination must not be reusable once spent. */
  const pendingAfter = await page.evaluate(() => {
    try {
      return sessionStorage.getItem('jp.teacher.returnUrl');
    } catch {
      return 'unreadable';
    }
  });

  check('🔴 …and the stored destination was CONSUMED, not left behind',
    pendingAfter === null,
    pendingAfter === null ? 'gone' : `STILL THERE: ${pendingAfter}`);

  /*
    ⚠️ AND IN THE COLUMN, not only on the screen. The greeting could in
    principle be rendered from something the browser still held from the signup
    form; the column is the end of the chain, and only a stored value survives
    the next sign-in.
  */
  const storedName = scalar(`SET NOCOUNT ON;
    SELECT t.FullName FROM jp_app.dbo.t_app_teachers t
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
     WHERE u.Email = '${EMAIL}';`);

  check('🔴 …and t_app_teachers.FullName holds it, not an empty string',
    storedName === FULL_NAME, `FullName = "${storedName}"`);

  // =========================================================================
  section('2. 🔒 FORCED — a hostile returnUrl is dropped');
  // =========================================================================

  /*
    🔒 THE OPEN-REDIRECT NEGATIVE. These are the values an attacker puts in a
    link that otherwise looks like ours. safe-path.mjs table-tests the function;
    this proves the SHIPPED app refuses them and still signs in.
  */
  const hostile = [
    ['https://example.com/phish', 'an absolute URL to another site'],
    ['//example.com/phish', 'protocol-relative — starts with "/" and is absolute'],
    ['/\\example.com/phish', 'a backslash, which browsers fold to "/"'],
    [`${TEACHER_APP.replace('4400', '4300')}/dashboard`, 'another app of OURS — still not this origin'],
  ];

  /*
    🔴 ONE SIGN-IN FOR THE WHOLE SECTION, AND THE REASON IS DOCUMENTED IN
    lib/login.mjs: the SSO allows LoginPerIp 5 per 60 seconds.

    The first version of this section signed in once per hostile value — four
    sign-ins — and section 3's was the fifth inside the minute. It failed as a
    30-second navigation timeout, which reads as "the app did not navigate"
    rather than "the limiter refused the credentials". That is the FALSE RED
    lib/login.mjs was written to stop, arriving by a route it cannot help with:
    a browser suite signs in through the UI and cannot use its token cache.

    So the two assertions are separated by what they actually need:

      · NOT STORED — the mechanism, checked for every hostile value. Needs no
        sign-in at all, because ReturnUrlService refuses the value when the
        screen is constructed.
      · LANDS ON THE DASHBOARD — the consequence, proven ONCE. A second
        identical landing adds no information and costs a sign-in.
  */
  /*
    ⚠️ Signed out FIRST. Section 1 ended signed in as the account it created,
    and /auth/login redirects an already-signed-in visitor away — so without
    this the loop waits for a login form that never renders.
  */
  await context.clearCookies();
  await signOut(page);

  for (const [candidate, why] of hostile) {
    await page.goto(
      `${TEACHER_APP}/auth/login?returnUrl=${encodeURIComponent(candidate)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector('input#loginId', { timeout: 20_000 });

    const stored = await page.evaluate(() => {
      try {
        return sessionStorage.getItem('jp.teacher.returnUrl');
      } catch {
        return 'unreadable';
      }
    });

    check(`🔒 ${candidate.slice(0, 34)} is not even stored`,
      stored === null, stored === null ? why : `STORED: ${stored}`);
  }

  /*
    And the consequence, once: a hostile value present in the URL does not
    change where a successful sign-in lands.
  */
  await context.clearCookies();
  await signOut(page);
  await page.goto(
    `${TEACHER_APP}/auth/login?returnUrl=${encodeURIComponent(hostile[0][0])}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForSelector('input#loginId', { timeout: 20_000 });

  const forcedSignIn = await signIn(page, OWN, /\/dashboard/);

  check('🔒 …and a sign-in carrying one of them lands on the DASHBOARD',
    forcedSignIn.ok && page.url().startsWith(`${TEACHER_APP}/dashboard`),
    forcedSignIn.ok
      ? `${page.url().replace(TEACHER_APP, '')} — not ${hostile[0][0]}`
      : `SIGN-IN REFUSED: ${forcedSignIn.message}`);

  await page.screenshot({ path: path.join(OUT, '7b0-funnel-forced.png'), fullPage: true });

  // =========================================================================
  section('3. 🔴 THE HOLE G41 DID NOT MENTION — the authenticated side');
  // =========================================================================

  /*
    🔴 THE GUARD HAS WRITTEN THIS PARAMETER SINCE PHASE 3 AND NOTHING READ IT.

    auth.guard.ts sends an unauthenticated visitor to /auth/login?returnUrl=…
    with the comment "returnUrl brings them back where they were headed after
    signing in", and auth.interceptor.ts does the same when a session expires.
    Until 7B-0 both were ignored: a teacher whose session died halfway through
    an application was dropped on the dashboard.

    G41 recorded only the public funnel. This is the same hole on the inside,
    found while closing it — so it is asserted here rather than left to be
    rediscovered.
  */
  /*
    ⚠️ Signed out first, and localStorage cleared as well as cookies — the
    session lives in localStorage (TokenStorageService), so clearing cookies
    alone would leave this signed in and the guard would never fire.
  */
  await context.clearCookies();
  await signOut(page);

  /* Ask for a deep page while signed out — the guard should send us to login with it. */
  await page.goto(`${TEACHER_APP}/applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/auth\/login/, { timeout: 20_000 });

  console.log(`\n    the guard sent us to: ${page.url().replace(TEACHER_APP, '')}\n`);

  check('🔴 the auth guard still puts the destination in the URL',
    page.url().includes('returnUrl'), page.url().replace(TEACHER_APP, ''));

  const guardSignIn = await signIn(page, OWN, /\/applications|\/dashboard/);

  check('🔴 …and signing in now RETURNS there instead of the dashboard',
    guardSignIn.ok && page.url().includes('/applications'),
    guardSignIn.ok
      ? `${page.url().replace(TEACHER_APP, '')} — the guard's comment is true for the first time`
      : `SIGN-IN REFUSED: ${guardSignIn.message}`);

  // =========================================================================
  section('4. 🔴 THE UID WALL — a draft job on the apply route');
  // =========================================================================

  /*
    🔴 THE NEW ROUTE MUST NOT BE A NEW WAY IN. It resolves the uid inside the
    same procedure and then meets the same WHERE clause, so a draft is as
    invisible here as it is on the public site and on the id route.
  */
  await page.goto(`${TEACHER_APP}/jobs/${draftUid}/apply`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const draftText = await page.locator('body').innerText();

  /*
    ⚠️ THE LOG SHOWS THE MATCHED LINE, NOT THE FIRST ONE.

    Two earlier versions printed something useless: 'heading: (no heading)'
    because the refusal is a paragraph, then 'the page says: Staffroom'
    because the first line of body text is the shell's brand. Neither told
    the reader whether the assertion below had anything to stand on.

    This finds the line the assertion actually matches, so a pass shows its
    evidence and a failure shows what the page said instead.
  */
  const REFUSAL = /no longer|not found|gone/i;

  const draftLines = draftText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const draftSays = draftLines.find((line) => REFUSAL.test(line))
    ?? draftLines.find((line) => !/^skip to/i.test(line))
    ?? '(nothing)';

  console.log(`\n    the page says: ${draftSays.slice(0, 64)}`);

  check('🔴 a DRAFT job\'s uid on the apply route is not found',
    REFUSAL.test(draftText),
    `"${draftSays.slice(0, 44)}" — the uid path is not a way around the rule`);

  /*
    🔒 THE STRONGER FORM: THE JOB'S CONTENT IS NOT ON THE PAGE AT ALL.

    The first version of this check searched for the word "draft" after
    stripping the fixture's own title out of the text — which would have hidden
    the very leak worth catching. If the page rendered "FUNNEL Draft Teacher",
    a teacher would be reading an unpublished job, and the stripping made that
    invisible to the assertion.

    So it asserts the absence of the TITLE, which is the thing that must not
    appear, and the word "draft" separately.
  */
  check('🔒 …and NONE of the draft job\'s content is on the page',
    !draftText.includes('Draft Teacher'),
    'an unpublished job must not render, not even partly');

  check('🔒 …and the refusal does not say the job is a draft',
    !/\bdraft\b/i.test(draftText),
    'the same words every unavailable job gets — no enumeration oracle');

  console.log('');
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  section('5. EXIT — the account this run created is gone');

  try {
    if (browser) await browser.close();

    cleanupJobs();

    const uid = scalar(`SET NOCOUNT ON;
      SELECT LOWER(CAST(UserUid AS varchar(40))) FROM jp_sso.dbo.t_sso_users WHERE Email = '${EMAIL}';`);

    if (uid) {
      /*
        ⚠️ The same teardown teacher-profile.mjs uses, because registration
        writes to both databases. Order matters: children before parents, and
        jp_app before jp_sso.
      */
      sql(`SET NOCOUNT ON;
        DECLARE @tid bigint = (SELECT TeacherId FROM jp_app.dbo.t_app_teachers WHERE UserUid = '${uid}');

        DELETE FROM jp_app.dbo.t_app_applications WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_saved_jobs WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_subjects WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_class_levels WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_skills WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_languages WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_preferred_locations WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_experiences WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_teacher_documents WHERE TeacherId = @tid;
        DELETE FROM jp_app.dbo.t_app_subscriptions WHERE OwnerUid = '${uid}';
        DELETE FROM jp_app.dbo.t_app_teachers WHERE TeacherId = @tid;

        DELETE t FROM jp_sso.dbo.t_sso_user_tokens t INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = t.UserId WHERE u.UserUid = '${uid}';
        DELETE c FROM jp_sso.dbo.t_sso_user_credentials c INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId WHERE u.UserUid = '${uid}';
        DELETE r FROM jp_sso.dbo.t_sso_user_roles r INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = r.UserId WHERE u.UserUid = '${uid}';
        DELETE a FROM jp_sso.dbo.t_sso_user_login_attempts a INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = a.UserId WHERE u.UserUid = '${uid}';
        DELETE o FROM jp_sso.dbo.t_sso_user_otps o INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = o.UserId WHERE u.UserUid = '${uid}';
        DELETE FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${uid}';`);
    }

    check('exit: the account this run created is gone from both databases',
      scalar(`SET NOCOUNT ON; SELECT CAST(
        (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users WHERE Email = '${EMAIL}') AS varchar(4));`) === '0',
      uid ? `removed ${uid.slice(0, 8)}…` : 'registration never completed');

    check('exit: no probe job is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_jobs WHERE JobTitle LIKE '${PROBE}%';`) === '0',
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
