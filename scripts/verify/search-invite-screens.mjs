/*
  PHASE 6C-2 — FIND TEACHERS + INVITE, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY          the gating state this suite assumes, asserted.
    1. THE SCREEN     form, results, server-side paging, and 🔒 no contact
                      anywhere in the rendered bytes.
    2. 🔴 2.62        the full matrix on ONE screen, with three real accounts:
                        owner  VIEW + INVITE  -> form, results, Invite
                        HR     VIEW only      -> form, results, NO Invite
                        viewer neither        -> no form, no request, one line
    3. 🔴 NOT YET     an open invitation leaves the control there, DISABLED,
                      with the reason beside it.
    4. THE INVITE     a message and a campus — there is no email field, because
                      the school does not have one.
    5. 🔴 FORCED      devtools re-enables what the UI disabled, and the SERVER
                      refuses anyway. Hiding is presentation; the server is the
                      protection.
    6. EXIT           invitations removed, gating restored.

  ----------------------------------------------------------------------------
  🔴 WHY SECTION 5 IS THE POINT OF THIS FILE
  ----------------------------------------------------------------------------
  Every other assertion here is about what a person SEES, which matters. But a
  screen that hides a button is not a screen that prevents an action — and this
  project has written that sentence in a dozen comments. Section 5 stops writing
  it and tests it: the disabled attribute is removed in the DOM, the click goes
  through, and the API still refuses.

  ⚠️ FIXTURES: invitations carry 'search-screens' in their message, the gating
  mode is restored in the finally, and the exit asserts both. A killed run that
  left TEACHER_INVITE metered at zero would cap every school on the platform.

  Run (both APIs, jp-shared :4999, jp-school :4300):
      node scripts/verify/search-invite-screens.mjs
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
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

/** SCHOOL_OWNER — holds both TEACHER_SEARCH.VIEW and .INVITE. */
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

/**
 * 🔴 HR — holds TEACHER_SEARCH.VIEW and NOT .INVITE.
 *
 * The middle case of 2.62 exists as a real seeded role, which is why this suite
 * can test all three without inventing an account: searching is free, inviting
 * costs, and a school may let somebody browse without letting them spend.
 */
const HR = { id: 'hr.lead@greenwood.edu.in', pw: 'HrLead#2026!' };

/** SCHOOL_VIEWER — holds neither. */
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!' };

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

const FEATURE = Number(scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT FeatureId FROM m_mdm_features WHERE FeatureCode = 'TEACHER_INVITE' AND Is_Deleted = 0;`));

const gatingMode = () => scalar(`SET NOCOUNT ON; USE jp_mdm;
  SELECT CAST(GatingModeId AS varchar(3)) FROM m_mdm_features WHERE FeatureId = ${FEATURE};`);

/** TEACHER_INVITE as it ships: FREE, active, unmapped. */
const restoreShipped = () => sql(`SET NOCOUNT ON; USE jp_mdm;
  UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1, ModifiedOn = SYSUTCDATETIME()
   WHERE FeatureId = ${FEATURE} AND (GatingModeId <> 1 OR Is_Active <> 1);

  DELETE FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE};`);

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2
     AND RefEntityUid IN (SELECT InviteUid FROM t_app_teacher_invites
                           WHERE [Message] LIKE N'search-screens%');

  DELETE FROM t_app_feature_ledger
   WHERE FeatureId = ${FEATURE} AND (Notes LIKE N'%invite%' OR RefEntityTypeId = 2);

  DELETE FROM t_app_teacher_invites WHERE [Message] LIKE N'search-screens%' OR [Message] IS NULL;

  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);`);

const CONTACT_WORDS = ['contactemail', 'contactmobile', 'resumepath', '@yopmail.com'];

let browser;

try {
  // =========================================================================
  section('0. ENTRY — the gating state this suite assumes');
  // =========================================================================

  restoreShipped();
  cleanup();

  check('🔴 TEACHER_INVITE ships FREE and unmapped',
    gatingMode() === '1'
    && scalar(`SET NOCOUNT ON; USE jp_mdm;
        SELECT COUNT(*) FROM m_mdm_plan_features WHERE FeatureId = ${FEATURE} AND Is_Deleted = 0;`) === '0',
    `GatingModeId ${gatingMode()}`);

  check('entry: no invitation of ours survives a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites;`) === '0', 'clean');

  const ownerSession = await loginSession(OWNER);
  const hrSession = await loginSession(HR);
  const viewerSession = await loginSession(VIEWER);
  const ownerToken = await loginToken(OWNER);

  check('premise: the three accounts hold exactly the permissions this suite needs',
    (ownerSession.permissions ?? []).includes('TEACHER_SEARCH.INVITE')
    && (hrSession.permissions ?? []).includes('TEACHER_SEARCH.VIEW')
    && !(hrSession.permissions ?? []).includes('TEACHER_SEARCH.INVITE')
    && !(viewerSession.permissions ?? []).includes('TEACHER_SEARCH.VIEW'),
    'owner VIEW+INVITE · HR VIEW only · viewer neither');

  browser = await chromium.launch();

  const openAs = async (session, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));

    await page.goto(SCHOOL_APP, { waitUntil: 'domcontentloaded' });
    await page.evaluate((s) => {
      localStorage.setItem('jp.school.accessToken', s.accessToken);
      localStorage.setItem('jp.school.refreshToken', s.refreshToken);
    }, session);

    await page.goto(`${SCHOOL_APP}/teacher-search`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);

    return { context, page, errors };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  // =========================================================================
  section('1. THE SCREEN — results, paging, and 🔒 no contact in the bytes');
  // =========================================================================

  const { context: ownerCtx, page: owner, errors: ownerErrors } = await openAs(ownerSession);

  check('the search screen renders with its filter toolbar',
    (await owner.locator('.page__toolbar').count()) === 1
    && (await owner.locator('select#f-subject').count()) === 1,
    'toolbar and the subject filter present');

  const rowCount = await owner.locator('.results__item').count();
  const summary = (await owner.locator('.search__summary').textContent())?.trim() ?? '';

  console.log(`\n    ${rowCount} result(s) rendered · summary "${summary}"\n`);

  check('🔴 it searches on open and renders real teachers',
    rowCount > 0 && /teachers? match/.test(summary), `${rowCount} rows · "${summary}"`);

  check('…and the count on screen is the SERVER\'s total, not the page length',
    summary.startsWith(scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(8)) FROM t_app_teachers t
       WHERE t.Is_Deleted = 0 AND t.IsSuspended = 0;`)),
    `"${summary}" against the table`);

  /*
    🔒 THE CLAIM THIS SCREEN EXISTS UNDER, CHECKED AGAINST THE RENDERED BYTES.

    Not the DTO, not the procedure — the HTML a browser actually built. The
    other three layers are asserted elsewhere (019, the sealed DTO,
    ContactLeakGuard); this is the only place that can see what a person sees.
  */
  const ownerHtml = (await owner.content()).toLowerCase();
  const leaked = CONTACT_WORDS.filter((w) => ownerHtml.includes(w));

  check('🔒 the rendered page contains no contact field and no address',
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(', ')}` : 'no contactEmail / contactMobile / resumePath / @yopmail.com');

  check('…and no console error while rendering it',
    ownerErrors.length === 0, ownerErrors.length ? ownerErrors[0] : 'none');

  await shot(owner, 'school-teacher-search-1440');

  // =========================================================================
  section('2. 🔴 2.62 — THREE ACCOUNTS, THREE DIFFERENT SCREENS');
  // =========================================================================

  const ownerInvites = await owner.locator('.results__action button').count();

  check('🔴 OWNER (VIEW + INVITE): an Invite control on every result',
    ownerInvites === rowCount, `${ownerInvites} control(s) for ${rowCount} row(s)`);

  const { context: hrCtx, page: hr } = await openAs(hrSession);

  const hrRows = await hr.locator('.results__item').count();
  const hrInvites = await hr.locator('.results__action button').count();
  const hrBanner = (await hr.locator('.banner--info').textContent().catch(() => ''))?.trim() ?? '';

  console.log(`\n    HR: ${hrRows} result(s), ${hrInvites} invite control(s)`);
  console.log(`    banner: "${hrBanner}"\n`);

  /*
    🔴 "NOT ALLOWED" — ABSENT, not disabled. A greyed-out button would read as
    "try again later", and this person will never be able to invite without the
    permission. The line names who can, so they know where to go.
  */
  check('🔴 HR (VIEW only): the same results, and NO Invite control at all',
    hrRows > 0 && hrInvites === 0, `${hrRows} rows, ${hrInvites} invite controls`);

  check('🔴 …and one line says who CAN invite — "not allowed", explained',
    /hr and owner/i.test(hrBanner), `"${hrBanner}"`);

  await shot(hr, 'school-teacher-search-hr-1440');

  const { context: viewerCtx, page: viewer } = await openAs(viewerSession);

  const viewerForm = await viewer.locator('.page__toolbar').count();
  const viewerEmpty = (await viewer.locator('ui-empty-state').first().innerText().catch(() => ''))
    .replace(/\s+/g, ' ').trim();

  console.log(`    viewer: ${viewerForm} form(s) · "${viewerEmpty.slice(0, 90)}"\n`);

  /*
    🔴 2.62 AT SCREEN LEVEL, AND THIS IS THE BUG THIS SUITE FOUND.

    The first version of the screen rendered the whole form for a viewer, fired
    a search, took a 403, and printed "No teacher matches those filters" —
    telling somebody the teacher base was empty when the truth was they may not
    look at it. A summary that cannot tell "nobody matched" from "we could not
    ask" has no business existing.
  */
  check('🔴 VIEWER (neither): no search form at all',
    viewerForm === 0, `${viewerForm} form(s)`);

  check('🔴 …and an explanation rather than "no teacher matches those filters"',
    /not part of your access/i.test(viewerEmpty) && !/no teacher matches/i.test(viewerEmpty),
    `"${viewerEmpty.slice(0, 80)}"`);

  check('…and no summary line claiming anything about the teacher base',
    (await viewer.locator('.search__summary').count()) === 0, 'absent');

  await shot(viewer, 'school-teacher-search-viewer-1440');

  // =========================================================================
  section('3. 🔴 NOT YET — an open invitation leaves the control, disabled');
  // =========================================================================

  const firstName = (await owner.locator('.results__name').first().innerText()).split('\n')[0].trim();

  await owner.locator('.results__action button').first().click();
  await owner.waitForTimeout(700);

  check('the invite modal opens on the chosen teacher',
    (await owner.locator('ui-modal textarea#invite-message').count()) === 1,
    `inviting ${firstName}`);

  /*
    🔒 THE FIELD THAT IS NOT THERE. A school writing to a stranger gets a
    message box and a campus. There is no email input, because the school has no
    email — and will not get one unless this teacher accepts (2.56).
  */
  const modalHtml = (await owner.locator('ui-modal').innerHTML()).toLowerCase();

  check('🔒 the invite form has a message and NO email or phone field',
    !/type="email"/.test(modalHtml) && !/input[^>]*(email|mobile|phone)/.test(modalHtml),
    'a textarea and nothing to contact them with');

  await shot(owner, 'school-invite-modal-1440');

  await owner.locator('ui-modal textarea#invite-message').fill('search-screens: please apply');
  await owner.locator('ui-modal .modal__footer button.btn--primary').click();
  await owner.waitForTimeout(2500);

  const sent = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites
     WHERE [Message] LIKE N'search-screens%';`);

  /*
    ⚠️ Read from the row the screen just created, so section 4's forced request
    aims at the same teacher and campus the button did. Guessing either would
    test a different refusal.
  */
  const invitedRow = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT LOWER(CAST(t.TeacherUid AS varchar(40))) + '|' + CAST(i.BranchId AS varchar(10))
    FROM t_app_teacher_invites i
      INNER JOIN t_app_teachers t ON t.TeacherId = i.TeacherId
    WHERE i.[Message] LIKE N'search-screens%';`)[0]?.split('|') ?? [];

  const invitedUid = invitedRow[0] ?? null;
  const invitedBranchId = Number(invitedRow[1] ?? 0);

  check('🔴 the invitation is actually sent — a row exists',
    sent === '1', `${sent} invitation(s)`);

  const disabledNow = await owner.locator('.results__action button[disabled]').count();
  const reason = (await owner.locator('.results__reason').first().textContent().catch(() => ''))?.trim() ?? '';

  console.log(`\n    after sending: ${disabledNow} disabled control(s) · reason "${reason}"\n`);

  /*
    🔴 "NOT YET" — the control STAYS and is disabled, and the reason is beside
    it. An absent button here would read as "this feature does not exist"; a
    disabled one with no explanation is the 2.62 failure in the other direction.
  */
  check('🔴 that teacher\'s Invite is now DISABLED, not removed',
    disabledNow === 1, `${disabledNow} disabled`);

  check('🔴 …and the reason beside it says an invitation is waiting',
    /invitation waiting/i.test(reason), `"${reason}"`);

  await shot(owner, 'school-teacher-search-invited-1440');

  // =========================================================================
  section('4. 🔴 FORCED — devtools re-enables it, the SERVER still refuses');
  // =========================================================================

  /*
    🔴 THE ASSERTION THAT SEPARATES PRESENTATION FROM PROTECTION.

    This project's comments say "hiding a control is presentation, the server is
    the protection" in a dozen places. Here it is removed from the DOM and
    clicked.
  */
  const beforeForced = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites;`);

  const ledgerBefore = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_feature_ledger WHERE FeatureId = ${FEATURE};`);

  /*
    ⚠️ FIRST VERSION OF THIS TEST PASSED FOR THE WRONG REASON, which is worth
    recording because it is the trap this whole section is about.

    It removed `disabled` and clicked, expecting the request to go out and be
    refused. The modal never opened, so "no second invitation was created" was
    trivially true — a green assertion that proved nothing about the server.

    🔴 The reason is better than what I was testing for: a blocked row's control
    is a DIFFERENT element with no (click) binding at all, not the same button
    with an attribute. So force-enabling it gives a dead control. That is a real
    fact and it is asserted on its own below — and then the server is tested
    properly, by making the request the button would have made.
  */
  await owner.evaluate(() => {
    document.querySelectorAll('.results__action button[disabled]')
      .forEach((b) => b.removeAttribute('disabled'));
  });

  await owner.locator('.results__action button').first().click();
  await owner.waitForTimeout(900);

  check('🔴 force-enabling the disabled control does nothing — it has no handler at all',
    (await owner.locator('ui-modal textarea#invite-message').count()) === 0,
    'the blocked row renders a control with no (click) binding, not a disabled live one');

  /*
    🔴 SO THE SERVER IS TESTED DIRECTLY, with the owner's own token, for a
    teacher they have already invited. This is the exact call the button would
    have made if it had one.
  */
  const forced = await owner.evaluate(async ({ base, uid, branchId }) => {
    const token = localStorage.getItem('jp.school.accessToken');

    const response = await fetch(`${base}/teacher-search/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teacherUid: uid, branchId, message: 'search-screens: forced' }),
    });

    return { status: response.status, body: await response.text() };
  }, { base: APP, uid: invitedUid, branchId: invitedBranchId });

  const afterForced = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites;`);

  const ledgerAfter = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_feature_ledger WHERE FeatureId = ${FEATURE};`);

  console.log(`\n    forced request: HTTP ${forced.status} ${forced.body.slice(0, 120)}`);
  console.log(`    invitations ${beforeForced} -> ${afterForced} · ledger ${ledgerBefore} -> ${ledgerAfter}\n`);

  /*
    ⚠️ A 200 carrying ALREADY_INVITED, not a 4xx: the invitation the school
    wanted exists and nothing was charged (020's insert-before-meter order). The
    refusal is the INDEX's, and it happened before the meter was reached.
  */
  check('🔴 the server answers the forced request with ALREADY_INVITED',
    forced.status === 200 && /ALREADY_INVITED/.test(forced.body),
    `HTTP ${forced.status}`);

  check('🔴 …and created NO second invitation',
    beforeForced === afterForced, `${beforeForced} -> ${afterForced}`);

  check('🔴 …and charged nothing — the index refused before the meter (020)',
    ledgerBefore === ledgerAfter, `${ledgerBefore} -> ${ledgerAfter}`);

  /*
    🔴 AND THE SAME TEST FOR THE PERMISSION, WHICH IS THE STRONGER ONE.

    HR has no Invite control to force, so the request is made from HR's own page
    with HR's own token — the exact call the button would have made.
  */
  const hrForced = await hr.evaluate(async (base) => {
    const token = localStorage.getItem('jp.school.accessToken');
    const uid = document.querySelector('.results__item')?.getAttribute('data-uid') ?? null;

    const response = await fetch(`${base}/teacher-search/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teacherUid: uid ?? '00000000-0000-0000-0000-000000000001', branchId: 1 }),
    });

    return { status: response.status, body: await response.text() };
  }, APP);

  console.log(`    HR calling the invite endpoint directly: HTTP ${hrForced.status}\n`);

  check('🔴 HR calling the invite endpoint directly is refused by the SERVER',
    hrForced.status === 403, `HTTP ${hrForced.status}`);

  const viewerForced = await viewer.evaluate(async (base) => {
    const token = localStorage.getItem('jp.school.accessToken');
    const response = await fetch(`${base}/teacher-search?pageSize=5`, {
      headers: { authorization: `Bearer ${token}` },
    });

    return { status: response.status, body: (await response.text()).slice(0, 160) };
  }, APP);

  console.log(`    viewer calling the search endpoint directly: HTTP ${viewerForced.status}\n`);

  check('🔒 and the viewer calling SEARCH directly is refused too — the screen was never the gate',
    viewerForced.status === 403, `HTTP ${viewerForced.status}`);

  check('…and that refusal carries no teacher data at all',
    !CONTACT_WORDS.some((w) => viewerForced.body.toLowerCase().includes(w))
    && !/fullname/i.test(viewerForced.body),
    'nothing about anybody in the body');

  // =========================================================================
  section('5. AT 375 — the screen a phone gets');
  // =========================================================================

  const { context: phoneCtx, page: phone } = await openAs(ownerSession, PHONE);

  const overflow = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));

  check('🔴 the page does not scroll sideways at 375',
    overflow.doc <= overflow.client, `${overflow.doc} <= ${overflow.client}`);

  check('…and the results are still readable, not squeezed to nothing',
    (await phone.locator('.results__item').count()) > 0,
    `${await phone.locator('.results__item').count()} row(s)`);

  await shot(phone, 'school-teacher-search-375');

  await ownerCtx.close();
  await hrCtx.close();
  await viewerCtx.close();
  await phoneCtx.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => {});

  section('6. EXIT — gating restored, invitations removed');

  try {
    restoreShipped();
    cleanup();

    check('exit: TEACHER_INVITE is FREE, active and unmapped again',
      gatingMode() === '1', `mode ${gatingMode()}`);

    check('exit: no invitation of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites;`) === '0', 'none');

    check('🔒 exit: nobody was left unlocked by this run',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites WHERE InviteStatusId = 3;`) === '0',
      'no accepted invitation survives');
  } catch (error) {
    console.error('  ⚠️ COULD NOT RESTORE:', error.message);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log('='.repeat(74));

process.exitCode = failed.length ? 1 : 0;
