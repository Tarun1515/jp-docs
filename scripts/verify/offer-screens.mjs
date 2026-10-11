/*
  PHASE 6C-2 — THE OFFER, BOTH SIDES, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY        a candidate walked to Selected through the real endpoints.
    1. 🔴 THE BUG   a Selected application must NOT draw "Offer sent" from the
                    transition list — that button returned a 400 from 6A until
                    6C-2, and this is the assertion that keeps it gone.
    2. THE SCHOOL   send, the live offer, withdraw, confirm the hire — and the
                    two permissions that gate the first and the last.
    3. THE TEACHER  the document as they read it, in their own wording, with no
                    withdrawal reason and no "accepted = hired".
    4. 🔴 FORCED    devtools accepts and declines SOMEBODY ELSE'S offer by
                    fetch, and the server answers 404 — never "not yours" (2.6).
    5. 🔴 TWO MACHINES  the screens keep the offer and the application separate,
                    because 2.73's schema does.
    6. EXIT         the fixture gone, nothing left behind.

  ----------------------------------------------------------------------------
  🔴 WHY SECTION 1 IS FIRST
  ----------------------------------------------------------------------------
  6A made stages 7..10 reachable in the transition map, so a Selected
  application's `allowedTransitions` legitimately contains OFFER_SENT. The
  generic status endpoint refuses those four with OFFER_ACTION_REQUIRED. For two
  phases the applicant detail rendered that list unfiltered — so the screen drew
  a button that produced a 400, which is exactly what its own comment said must
  never happen. Nothing caught it because no test walked an application to
  Selected and then looked at the buttons.

  ⚠️ FIXTURES: the job carries '6C-2 offer' in its title and everything is
  removed in the finally, including the notifications the offer produced.

  Run (both APIs, jp-shared :4999, jp-school :4300, jp-teacher :4400):
      node scripts/verify/offer-screens.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const SCHOOL_APP = 'http://localhost:4300';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

/** Holds APPLICANT.VIEW and neither OFFER.CREATE nor OFFER.APPROVE. */
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!' };

/** The only documented teacher with a resume, so they can apply. */
const TEACHER_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: 'Seeded#Teacher2026!' };

/** 🔴 Somebody else entirely — section 4's forced negative needs a stranger. */
const TEACHER_B = { id: 'imran.qureshi.86007@yopmail.com', pw: 'Seeded#Teacher2026!' };

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

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body, text };
};

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_notifications
   WHERE RefEntityUid IN (
           SELECT OfferUid FROM t_app_offers
            WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                                     WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%'))
           UNION ALL
           SELECT ApplicationUid FROM t_app_applications
            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%'));

  DELETE FROM t_app_offers
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%'));
  DELETE FROM t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM t_app_applications
                            WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%'));
  DELETE FROM t_app_applications
   WHERE JobId IN (SELECT JobId FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%');
  DELETE FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%';

  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId IN (1, 3) AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = RefEntityUid)
     AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = RefEntityUid);`);

let browser;

try {
  // =========================================================================
  section('0. ENTRY — a candidate at Selected, walked there for real');
  // =========================================================================

  cleanup();

  const ownerToken = await loginToken(OWNER);
  const tokenA = await loginToken(TEACHER_A);
  const tokenB = await loginToken(TEACHER_B);

  const ownerSession = await loginSession(OWNER);
  const viewerSession = await loginSession(VIEWER);
  const sessionA = await loginSession(TEACHER_A);
  const sessionB = await loginSession(TEACHER_B);

  check('premise: the owner holds both offer permissions, the viewer neither',
    (ownerSession.permissions ?? []).includes('OFFER.CREATE')
    && (ownerSession.permissions ?? []).includes('OFFER.APPROVE')
    && !(viewerSession.permissions ?? []).includes('OFFER.CREATE')
    && !(viewerSession.permissions ?? []).includes('OFFER.APPROVE'),
    'owner CREATE+APPROVE · viewer neither');

  const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    INSERT INTO t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                            EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
    VALUES (4, 4, '6C-2 offer job', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
    SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

  const applied = await j(`${APP}/teacher/applications`, {
    method: 'POST', headers: H(tokenA), body: JSON.stringify({ jobId, coverNote: '6C-2 offer' }),
  });

  const appId = applied.body?.data?.applicationId;

  const setStatus = (to) => j(`${APP}/applicants/${appId}/status`, {
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ toStatusId: to }),
  });

  await setStatus(3);
  await setStatus(5);

  check('premise: the application is at Selected (5)',
    !!appId && scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(ApplicationStatusId AS varchar(3)) FROM t_app_applications
       WHERE ApplicationId = ${appId};`) === '5',
    `application ${appId}`);

  browser = await chromium.launch();

  const openAs = async (app, key, session, url, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 150)}`));

    await page.goto(app, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.setItem(`jp.${k}.accessToken`, s.accessToken);
      localStorage.setItem(`jp.${k}.refreshToken`, s.refreshToken);
    }, { s: session, k: key });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    return { context, page, errors };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  // =========================================================================
  section('1. 🔴 THE BUG — no button that produces a 400');
  // =========================================================================

  const { context: schoolCtx, page: school, errors: schoolErrors } =
    await openAs(SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/applicants/${appId}`);

  const buttons = (await school.locator('.applicant__buttons button').allTextContents())
    .map((b) => b.trim());

  console.log(`\n    buttons on a Selected application: ${buttons.join(' | ')}\n`);

  /*
    🔴 THE ASSERTION THAT KEEPS THE BUG GONE.

    The server's transition list contains OFFER_SENT here — verified below — and
    the screen must not turn it into a button, because the status endpoint
    refuses it. The offer has its own control instead.
  */
  const transitions = (await j(`${APP}/applicants/${appId}`, { headers: H(ownerToken) }))
    .body?.data?.allowedTransitions ?? [];

  check('premise: the SERVER really does offer OFFER_SENT as a transition',
    transitions.some((t) => t.applicationStatusId === 7),
    transitions.map((t) => `${t.applicationStatusId}:${t.code}`).join(' '));

  check('🔴 …and the screen does NOT draw a button for it (it would 400)',
    !buttons.some((b) => /^offer sent$/i.test(b)), buttons.join(' | '));

  check('🔴 …it offers "Send an offer" instead, which calls the offer endpoint',
    buttons.some((b) => /send an offer/i.test(b)), buttons.join(' | '));

  /* And the refusal is real, so the assertion above is not theoretical. */
  const refused = await setStatus(7);

  check('🔴 …and the status endpoint really does refuse stage 7',
    refused.http === 400 && refused.body?.code === 'OFFER_ACTION_REQUIRED',
    `HTTP ${refused.http} ${refused.body?.code}`);

  await shot(school, 'school-applicant-selected-1440');

  // =========================================================================
  section('2. THE SCHOOL — send, withdraw, and the two permissions');
  // =========================================================================

  await school.locator('.applicant__buttons button', { hasText: 'Send an offer' }).click();
  await school.waitForTimeout(700);

  check('the offer form opens with its three terms',
    (await school.locator('#offer-salary').count()) === 1
    && (await school.locator('#offer-joining').count()) === 1
    && (await school.locator('#offer-time').count()) === 1,
    'salary, joining date, reporting time');

  await shot(school, 'school-offer-form-1440');

  await school.locator('#offer-salary').fill('44000');
  await school.locator('#offer-joining').fill('2027-06-01');
  await school.locator('#offer-time').fill('09:00');

  /*
    ⚠️ The toast is read, because it is the only place the server's own answer
    reaches the screen. The first version of this went straight to the database
    and reported a hardcoded "stage 7" in its detail — so when the send failed,
    three assertions failed while PRINTING the values they expected. A detail
    that does not carry the measured value is a detail that hides the failure.
  */
  await school.locator('.offer-form .btn--primary').click();
  await school.waitForTimeout(3200);

  const toast = (await school.locator('.toast, [role="status"], [role="alert"]').allInnerTexts()
    .catch(() => [])).join(' | ').replace(/\s+/g, ' ').trim();

  const stage = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ApplicationStatusId AS varchar(3)) FROM t_app_applications
     WHERE ApplicationId = ${appId};`);

  const salary = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT ISNULL(CAST(CAST(OfferedSalary AS int) AS varchar(10)), '(none)') FROM t_app_offers
     WHERE ApplicationId = ${appId} AND OfferStatusId = 1;`);

  const liveBoxes = await school.locator('.offer-live').count();
  const liveButtons = await school.locator('.offer-live button').count();

  console.log(`\n    toast: "${toast.slice(0, 120)}"`);
  console.log(`    stage ${stage} · salary ${salary} · live boxes ${liveBoxes} · controls ${liveButtons}\n`);

  check('🔴 sending moves the application to OfferSent in one transaction',
    stage === '7', `stage ${stage} (expected 7)${toast ? ` · toast "${toast.slice(0, 70)}"` : ''}`);

  check('…and the offer row exists with the terms that were typed',
    salary === '44000', `salary ${salary}`);

  check('🔴 the live offer is shown with a withdraw control',
    liveBoxes === 1 && liveButtons === 1,
    `${liveBoxes} live box(es), ${liveButtons} control(s)`);

  await shot(school, 'school-offer-live-1440');

  /*
    🔴 2.62's "not allowed" for the viewer: APPLICANT.VIEW lets them read the
    application; neither offer permission is theirs, so no offer control is
    rendered at all.
  */
  const { context: viewerCtx, page: viewerPage } =
    await openAs(SCHOOL_APP, 'school', viewerSession, `${SCHOOL_APP}/applicants/${appId}`);

  check('🔒 the read-only viewer sees the application and NO offer control',
    (await viewerPage.locator('.applicant__name, .page__title').count()) > 0
    && (await viewerPage.locator('.offer-live button').count()) === 0
    && !(await viewerPage.locator('.applicant__buttons button').allTextContents())
      .some((b) => /send an offer|withdraw|confirm the hire/i.test(b)),
    'nothing to send, withdraw or confirm');

  await shot(viewerPage, 'school-applicant-viewer-offer-1440');

  // =========================================================================
  section('3. THE TEACHER — the document, in their own wording');
  // =========================================================================

  const { context: teacherCtx, page: teacher, errors: teacherErrors } =
    await openAs(TEACHER_APP, 'teacher', sessionA, `${TEACHER_APP}/offers`);

  check('🔴 the seeded TEACHER_OFFERS row puts /offers in the sidebar (2.37)',
    (await teacher.locator('nav a').evaluateAll((ls) => ls.map((l) => l.getAttribute('href'))))
      .includes('/offers'),
    'the menu row and the route arrived together');

  check('the offer is listed, naming the school',
    (await teacher.locator('.offers__item').count()) === 1
    && /Nalanda/i.test((await teacher.locator('.offers__school').first().textContent()) ?? ''),
    (await teacher.locator('.offers__school').first().textContent())?.trim());

  const terms = (await teacher.locator('.offers__term').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim());

  console.log(`\n    terms: ${terms.join(' · ')}\n`);

  check('🔴 …with the salary, the joining date and the reporting time',
    terms.some((t) => /44000/.test(t)) && terms.some((t) => /Jun/i.test(t))
    && terms.some((t) => /9:00 am/i.test(t)),
    terms.join(' · '));

  const teacherHtml = (await teacher.content()).toLowerCase();

  check('🔒 the teacher\'s page carries no school-side note or reason',
    !teacherHtml.includes('withdrawalreason') && !teacherHtml.includes('sentbyname'),
    'no withdrawal reason, no sender name');

  check('…and no console error',
    teacherErrors.length === 0, teacherErrors.length ? teacherErrors[0] : 'none');

  await shot(teacher, 'teacher-offers-1440');

  // =========================================================================
  section('4. 🔴 FORCED — accepting and declining SOMEBODY ELSE\'S offer');
  // =========================================================================

  const offerId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(OfferId AS varchar(12)) FROM t_app_offers
     WHERE ApplicationId = ${appId} AND OfferStatusId = 1;`));

  /*
    🔴 THE ASSERTION THE REVIEW ASKED FOR.

    Teacher B has no offer at all. From B's OWN PAGE, with B's own token, the
    accept call is made against A's offer id — the exact request the button
    would make if B had one. Then the same with decline.

    ⚠️ The expected answer is 404, never 403: a 403 would confirm the offer
    exists and belongs to somebody else, which is what 2.6 forbids. The
    procedure matches on the caller's UserUid, so there is no id to probe with.
  */
  const { context: bCtx, page: teacherB } =
    await openAs(TEACHER_APP, 'teacher', sessionB, `${TEACHER_APP}/offers`);

  check('premise: teacher B has no offers of their own to confuse this with',
    (await teacherB.locator('.offers__item').count()) === 0,
    `${await teacherB.locator('.offers__item').count()} item(s)`);

  const force = async (accept) => teacherB.evaluate(async ({ base, id, acc }) => {
    const token = localStorage.getItem('jp.teacher.accessToken');

    const response = await fetch(`${base}/teacher/offers/${id}/respond`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ accept: acc }),
    });

    return { status: response.status, body: await response.text() };
  }, { base: APP, id: offerId, acc: accept });

  const forcedAccept = await force(true);
  const forcedDecline = await force(false);

  console.log(`\n    forced ACCEPT  : HTTP ${forcedAccept.status} ${forcedAccept.body.slice(0, 120)}`);
  console.log(`    forced DECLINE : HTTP ${forcedDecline.status} ${forcedDecline.body.slice(0, 120)}\n`);

  check('🔴 forcing ACCEPT on another teacher\'s offer answers 404',
    forcedAccept.status === 404, `HTTP ${forcedAccept.status}`);

  check('🔴 forcing DECLINE on another teacher\'s offer answers 404 too',
    forcedDecline.status === 404, `HTTP ${forcedDecline.status}`);

  check('🔒 …404 and not 403 — a 403 would confirm the offer exists (2.6)',
    forcedAccept.status !== 403 && forcedDecline.status !== 403
    && /not found/i.test(forcedAccept.body),
    `"${(JSON.parse(forcedAccept.body || '{}').message ?? '').slice(0, 70)}"`);

  check('🔒 …and the refusal names nobody — no school, no teacher, no salary',
    !/nalanda/i.test(forcedAccept.body) && !/44000/.test(forcedAccept.body)
    && !/rohit/i.test(forcedAccept.body),
    'the body is about nothing');

  check('🔴 …and the offer is UNTOUCHED — still live, still unanswered',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(OfferStatusId AS varchar(3)) + '|' + CASE WHEN RespondedOn IS NULL THEN 'unanswered' ELSE 'ANSWERED' END
      FROM t_app_offers WHERE OfferId = ${offerId};`) === '1|unanswered',
    'status 1, RespondedOn null');

  // =========================================================================
  section('5. 🔴 TWO MACHINES — the real owner answers, and they stay two');
  // =========================================================================

  await teacher.reload({ waitUntil: 'networkidle' });
  await teacher.waitForTimeout(2200);
  await teacher.locator('.offers__actions .btn--primary').first().click();
  await teacher.waitForTimeout(700);

  /*
    The confirmation names what is NOT yet true — 2.73's second step.

    ⚠️ `.dialog` with role="alertdialog", which is what the shared component
    renders. The first locator here guessed `.confirm-dialog` /
    `[role="dialog"]` — written from memory rather than from the file.

    ⚠️ And it is WAITED for rather than read after a fixed pause: the version
    that slept read "" and reported a content failure, while the click below
    waited for the same element and worked. A timing failure dressed as a
    content failure is the worst kind to read.
  */
  await teacher.locator('.dialog').first().waitFor({ state: 'visible', timeout: 15_000 });

  const dialog = (await teacher.locator('.dialog').first().innerText()
    .catch(() => '')).replace(/\s+/g, ' ');

  check('🔴 accepting warns that the school still confirms the hire (2.73)',
    /separate step|not a start date/i.test(dialog), `"${dialog.slice(0, 90)}"`);

  await teacher.locator('.dialog button').filter({ hasText: /accept the offer/i }).first().click();
  await teacher.waitForTimeout(2800);

  const after = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(o.OfferStatusId AS varchar(3)) + '|' + CAST(a.ApplicationStatusId AS varchar(3))
    FROM t_app_offers o
      INNER JOIN t_app_applications a ON a.ApplicationId = o.ApplicationId
    WHERE o.OfferId = ${offerId};`)[0];

  console.log(`\n    offer status | application stage : ${after}\n`);

  check('🔴 accepting moves BOTH, in one transaction — offer 2, application 8',
    after === '2|8', after);

  /*
    🔴 AND NEITHER SCREEN CLAIMS THE OTHER'S FACT. The teacher's row says the
    school still confirms; the school's list puts them under "Accepted — confirm
    when they start". 2.73's two machines, two sentences.
  */
  await teacher.reload({ waitUntil: 'networkidle' });
  await teacher.waitForTimeout(2200);

  const teacherText = (await teacher.locator('.page').innerText()).replace(/\s+/g, ' ');

  check('🔴 the teacher is told the school confirms separately — not "hired"',
    /confirms the hire separately/i.test(teacherText) && !/\bhired\b/i.test(teacherText),
    'accepted is not arriving');

  const { context: listCtx, page: offersList } =
    await openAs(SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/offers`);

  const groups = (await offersList.locator('.offers__group-title').allTextContents())
    .map((t) => t.trim());

  check('🔴 the school\'s list groups them under "confirm when they start"',
    groups.some((g) => /confirm when they start/i.test(g)), groups.join(' | '));

  await shot(offersList, 'school-offers-1440');

  /* The hire itself, which is gated on the OTHER permission. */
  const { context: hireCtx, page: hirePage } =
    await openAs(SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/applicants/${appId}`);

  const hireButtons = (await hirePage.locator('.applicant__buttons button').allTextContents())
    .map((b) => b.trim());

  check('🔴 at OfferAccepted the owner is offered "Confirm the hire" (OFFER.APPROVE)',
    hireButtons.some((b) => /confirm the hire/i.test(b)), hireButtons.join(' | '));

  check('…and no console error on any school screen',
    schoolErrors.length === 0, schoolErrors.length ? schoolErrors[0] : 'none');

  await shot(hirePage, 'school-applicant-accepted-1440');

  await schoolCtx.close();
  // =========================================================================
  section('9B. BOTH OFFER SCREENS AT 375');
  // =========================================================================

  /*
    🔴 THE BODY MUST NOT SCROLL SIDEWAYS AT 375 — ON EITHER SIDE.

    An offer row is the worst case the design system has in this phase: a
    salary, a joining date, a reporting time and a status badge on one row, on
    the narrowest screen. Both sides get the same check, because the school's
    list and the teacher's list are different components built from the same
    data and only one of them failing is the likely outcome.

    ⚠️ Measured on the document rather than judged from the screenshot — a shot
    of a sideways-scrolling page looks correct until somebody swipes.
  */
  const phones = [
    ['school', SCHOOL_APP, 'school', ownerSession, `${SCHOOL_APP}/offers`, 'school-offers-375'],
    ['teacher', TEACHER_APP, 'teacher', sessionA, `${TEACHER_APP}/offers`, 'teacher-offers-375'],
  ];

  for (const [label, app, key, session, url, shotName] of phones) {
    const { context: phoneCtx, page: phone } = await openAs(app, key, session, url, PHONE);

    const over = await phone.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));

    /* Both lists render .offers__item; .card is the design-system wrapper. */
    const rows = await phone.locator('.offers__item').count();

    console.log(`    ${label} at 375: document ${over.doc}px, viewport ${over.client}px, ${rows} offer row(s)`);

    check(`🔴 the ${label}'s offers do not scroll the page sideways at 375`,
      over.doc <= over.client, `${over.doc} <= ${over.client}`);

    check(`…and the ${label} actually has an offer on screen, so it is not vacuous`,
      rows > 0, `${rows} offer row(s)`);

    await shot(phone, shotName);
    await phoneCtx.close();
  }

  await viewerCtx.close();
  await teacherCtx.close();
  await bCtx.close();
  await listCtx.close();
  await hireCtx.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => {});

  section('6. EXIT — the fixture removed');

  try {
    cleanup();

    check('exit: no job, application or offer of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_jobs WHERE JobTitle LIKE '6C-2 offer%';`) === '0',
      'none');

    check('exit: no orphan notification is left behind',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_notifications n
         WHERE n.RefEntityTypeId = 3 AND n.RefEntityUid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = n.RefEntityUid);`) === '0',
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
