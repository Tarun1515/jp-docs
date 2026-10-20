/*
  PHASE 6C-2 — THE TEACHER'S INVITATIONS, IN A REAL BROWSER.

  ----------------------------------------------------------------------------
    0. ENTRY        an invitation sent through the real endpoint.
    1. THE INBOX    the school named, its message quoted, the teacher's own
                    wording on the status.
    2. 🔒 VIEWING   opening the list stamps it Viewed and unlocks NOTHING.
    3. 🔒 ACCEPTING the confirmation names what the school gets, and the accept
                    IS consent path 2 — asserted against the function itself.
    4. 🔒 NO REWARD an accepted invitation gets a quiet row, not a prize.
    5. 🔴 FORCED    answering SOMEBODY ELSE'S invitation by fetch → 404.
    6. 🔒 DECLINING unlocks nothing, and the school is told.
    7. EXIT         invitations gone, nobody left unlocked.

  ----------------------------------------------------------------------------
  🔒 WHY THIS SCREEN GETS ITS OWN SUITE
  ----------------------------------------------------------------------------
  The accept button here is one of exactly TWO places in the product where a
  teacher hands a school their contact details (2.56, LOCKED). The other is
  applying. invites.mjs proves the procedure; this proves the screen a person
  actually clicks — that the consequence is named before the click, and that the
  unlock follows the row rather than the toast.

  ⚠️ FIXTURES: invitations carry 'invite-screens' in their message and are
  removed in the finally, with the exit asserting nobody is left unlocked.

  Run (both APIs, jp-shared :4999, jp-teacher :4400):
      node scripts/verify/invitation-screens.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession, token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const TEACHER_APP = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/design-screens';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const TEACHER_A = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };
const TEACHER_B = { id: 'anita.deshmukh21338@yopmail.com', pw: secret('anita.deshmukh21338@yopmail.com') };

/** 🔴 A stranger, for section 5. */
const TEACHER_C = { id: 'imran.qureshi.86007@yopmail.com', pw: secret('imran.qureshi.86007@yopmail.com') };

const MESSAGE = 'invite-screens: we saw your athletics background';

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

const teacherIdOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT CAST(t.TeacherId AS varchar(10)) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid WHERE u.Email = '${email}';`);

const teacherUidOf = (email) => scalar(`SET NOCOUNT ON;
  SELECT LOWER(CAST(t.TeacherUid AS varchar(50))) FROM jp_app.dbo.t_app_teachers t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid WHERE u.Email = '${email}';`);

/** 🔒 The function that decides every contact disclosure in the product. */
const unlocked = (teacherId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(dbo.fn_TeacherContactUnlocked(${teacherId}, 4) AS varchar(2));`);

const inviteStatus = (inviteId) => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(InviteStatusId AS varchar(3)) FROM t_app_teacher_invites WHERE InviteId = ${inviteId};`);

const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2
     AND RefEntityUid IN (SELECT InviteUid FROM t_app_teacher_invites WHERE [Message] LIKE N'invite-screens%');

  DELETE FROM t_app_feature_ledger
   WHERE RefEntityTypeId = 2
     AND RefEntityUid IN (SELECT InviteUid FROM t_app_teacher_invites WHERE [Message] LIKE N'invite-screens%');

  DELETE FROM t_app_teacher_invites WHERE [Message] LIKE N'invite-screens%';

  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);`);

let browser;

try {
  // =========================================================================
  section('0. ENTRY — an invitation sent through the real endpoint');
  // =========================================================================

  cleanup();

  const ownerToken = await loginToken(OWNER);
  const sessionA = await loginSession(TEACHER_A);
  const sessionB = await loginSession(TEACHER_B);
  const sessionC = await loginSession(TEACHER_C);

  const idA = teacherIdOf(TEACHER_A.id);
  const idB = teacherIdOf(TEACHER_B.id);

  check('🔒 entry premise: neither teacher is unlocked for this school',
    unlocked(idA) === '0' && unlocked(idB) === '0',
    `A ${unlocked(idA)}, B ${unlocked(idB)}`);

  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(8)) FROM t_app_school_branches
     WHERE SchoolId = 4 AND Is_Deleted = 0 ORDER BY IsHeadOffice DESC;`));

  const sendTo = (uid) => j(`${APP}/teacher-search/invites`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({ teacherUid: uid, branchId, message: MESSAGE }),
  });

  const invA = await sendTo(teacherUidOf(TEACHER_A.id));
  const invB = await sendTo(teacherUidOf(TEACHER_B.id));

  const inviteA = invA.body?.data?.inviteId;
  const inviteB = invB.body?.data?.inviteId;

  check('premise: two invitations exist, both unanswered',
    !!inviteA && !!inviteB && inviteStatus(inviteA) === '1' && inviteStatus(inviteB) === '1',
    `${inviteA} and ${inviteB}, both Sent`);

  browser = await chromium.launch();

  const openAs = async (session, url = `${TEACHER_APP}/invitations`, viewport = WIDE) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 150)}`));

    await page.goto(TEACHER_APP, { waitUntil: 'domcontentloaded' });
    await page.evaluate((s) => {
      localStorage.setItem('jp.teacher.accessToken', s.accessToken);
      localStorage.setItem('jp.teacher.refreshToken', s.refreshToken);
    }, session);

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    return { context, page, errors };
  };

  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  /*
    🔴 EVERY ROW LOCATOR GOES THROUGH HERE, SCOPED TO OUR OWN ROW.

    The first draft used .first() and .last() on the list. A stale invitation
    from a hand probe — status APPLIED, its application long since cleaned up —
    then sat in Rohit's inbox, and those positional locators would have clicked
    ACCEPT on it: a suite quietly answering an invitation it did not send, and
    possibly unlocking a teacher's contact for a school that never asked.

    So: a suite never addresses a row by position. It addresses the row it
    created, and is indifferent to whatever else a shared database holds.

    ⚠️ TWO HELPERS, BECAUSE AN ANSWERED ROW IS NOT THE SAME ROW. The open row
    quotes the school's message, so it can be keyed on it. The answered row
    deliberately does NOT re-quote the pitch — it is a record, not an offer —
    so it is keyed on the school instead, and section 4 asserts there is
    exactly one of those before reading it.
  */
  const openRow = (page) => page
    .locator('.invites__item:not(.invites__item--past)')
    .filter({ hasText: 'invite-screens' });

  const pastRow = (page) => page
    .locator('.invites__item--past')
    .filter({ hasText: 'Nalanda' });

  // =========================================================================
  section('1. THE INBOX — the school named, its message quoted');
  // =========================================================================

  const { context: ctxA, page: pageA, errors: errorsA } = await openAs(sessionA);

  check('our invitation is listed, exactly once',
    (await openRow(pageA).count()) === 1,
    `${await openRow(pageA).count()} matching of ${await pageA.locator('.invites__item').count()} total`);

  const school = (await openRow(pageA).locator('.invites__school').innerText())
    .replace(/\s+/g, ' ').trim();

  /*
    🔴 THE SCHOOL IS NAMED BEFORE ANY CONSENT EXISTS — the one place this
    product deliberately does that, because "somebody wants to talk to you" is
    useless without knowing who.
  */
  check('🔴 the school is named, before any consent exists',
    /Nalanda/i.test(school), `"${school}"`);

  check('…and its own message is quoted, as written',
    /athletics background/i.test((await openRow(pageA).locator('.invites__message').textContent()) ?? ''),
    'the school\'s words, set apart');

  const statusText = (await openRow(pageA).locator('ui-badge').last().innerText()).trim();

  /*
    🔴 THE TEACHER'S WORDING, from m_app_invite_status.TeacherFacingName. The
    master's own names are the SCHOOL's — "Ignored" — and this app never fetches
    that master (5B's lesson: a filter must not say "Rejected" above a row that
    says "Not selected").
  */
  check('🔴 the status is in the TEACHER\'s wording, not the school\'s',
    /received|opened|you/i.test(statusText) && !/^sent$/i.test(statusText),
    `"${statusText}"`);

  check('…and no console error',
    errorsA.length === 0, errorsA.length ? errorsA[0] : 'none');

  await shot(pageA, 'teacher-invitations-1440');

  // =========================================================================
  section('1B. THE INBOX AT 375 — while the invitation is still LIVE');
  // =========================================================================

  /*
    🔴 THE BODY MUST NOT SCROLL SIDEWAYS AT 375.

    An open invitation row is this phase's worst case for width: a school name,
    a verified badge, a quoted message and two side-by-side buttons. Measured on
    the document rather than judged from the screenshot, because a shot of a
    sideways-scrolling page looks fine until somebody swipes.

    ⚠️ IT RUNS HERE, BEFORE SECTION 3 ACCEPTS. Placed after the accept it still
    passed — but on an ANSWERED row, which has no buttons and is the easy case.
    A 375 check that quietly measures the easy case is the shape of a test that
    passes for the wrong reason, and the screenshot was no use to a designer
    either.
  */
  const { context: phoneCtx, page: phone } = await openAs(sessionA, `${TEACHER_APP}/invitations`, PHONE);

  const phoneOverflow = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));

  const liveRows = await phone.locator('.invites__item:not(.invites__item--past)').count();
  const buttons = await phone.locator('.invites__item .invites__actions button').count();

  console.log(`\n    at 375: document ${phoneOverflow.doc}px, viewport ${phoneOverflow.client}px`);
  console.log(`    ${liveRows} live row(s), ${buttons} button(s) on them\n`);

  check('🔴 the page does not scroll sideways at 375',
    phoneOverflow.doc <= phoneOverflow.client,
    `${phoneOverflow.doc} <= ${phoneOverflow.client}`);

  check('…and it is the LIVE row being measured, with both buttons on it',
    liveRows > 0 && buttons >= 2,
    `${liveRows} live row(s), ${buttons} button(s)`);

  await shot(phone, 'teacher-invitations-375');

  await phoneCtx.close();

  // =========================================================================
  section('2. 🔒 VIEWING — stamped, and it unlocks NOTHING');
  // =========================================================================

  console.log(`\n    after opening the inbox: status ${inviteStatus(inviteA)}, unlocked ${unlocked(idA)}\n`);

  check('🔴 opening the inbox stamped the invitation Viewed (2), on render',
    inviteStatus(inviteA) === '2', `status ${inviteStatus(inviteA)}`);

  /*
    🔒 THE WHOLE POINT. 2.56 says viewing unlocks nothing, and 027 makes it
    structural: status 2 is not the IsConsent row, so the function cannot match
    it. This asserts the function, not the intent.
  */
  check('🔒 …and the school still cannot see this teacher\'s contact',
    unlocked(idA) === '0', `fn_TeacherContactUnlocked = ${unlocked(idA)}`);

  // =========================================================================
  section('3. 🔒 ACCEPTING — the consequence named, then consent path 2');
  // =========================================================================

  await openRow(pageA).locator('.invites__actions .btn--primary').click();
  await pageA.locator('.dialog').first().waitFor({ state: 'visible', timeout: 15_000 });

  const dialog = (await pageA.locator('.dialog').first().innerText()).replace(/\s+/g, ' ');

  console.log(`\n    "${dialog.slice(0, 180)}"\n`);

  /*
    🔒 A CONSENT SOMEBODY DID NOT UNDERSTAND THEY WERE GIVING IS NOT CONSENT.

    The dialog has to name the three things the school gets, and the one thing
    easy to assume wrongly: that this is about THIS school, not a public
    listing.
  */
  check('🔒 the confirmation names the email, the phone number and the resume',
    /email/i.test(dialog) && /phone/i.test(dialog) && /resume/i.test(dialog),
    'all three named');

  check('🔒 …and says it is THIS school only, not a public listing',
    /no other school/i.test(dialog), 'scoped to one school');

  check('…and that accepting does not commit them to applying',
    /not commit|still decide/i.test(dialog), 'no obligation implied');

  await shot(pageA, 'teacher-invitation-consent-1440');

  await pageA.locator('.dialog button').filter({ hasText: /let them contact me/i }).first().click();
  await pageA.waitForTimeout(2800);

  console.log(`    after accepting: status ${inviteStatus(inviteA)}, unlocked ${unlocked(idA)}\n`);

  check('🔒 ACCEPTING IS CONSENT PATH 2 — the function now says yes',
    inviteStatus(inviteA) === '3' && unlocked(idA) === '1',
    `status ${inviteStatus(inviteA)} (3 = Accepted), unlocked ${unlocked(idA)}`);

  check('🔒 …and it unlocked ONLY this teacher, for only this school',
    unlocked(idB) === '0', `the other teacher is still ${unlocked(idB)}`);

  // =========================================================================
  section('4. 🔒 NO REWARD — a quiet row, not a prize');
  // =========================================================================

  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2400);

  /*
    🔴 THE MOVE IS AN ASSERTION, NOT A DISCOVERY.

    I found this by timeout: the scoped locator could not find an accepted row,
    because an answered invitation leaves the open group entirely. That is right
    — an answered invitation is not a decision waiting to be made, and leaving
    it among the live ones is how somebody answers twice. So it is stated here
    rather than worked around.
  */
  check('🔴 the accepted invitation LEFT the open list — it is not a live decision any more',
    (await openRow(pageA).count()) === 0,
    `${await openRow(pageA).count()} still open`);

  check('…and it is in "Already answered", exactly once',
    (await pastRow(pageA).count()) === 1,
    `${await pastRow(pageA).count()} answered row(s) from that school`);

  const pageText = (await pastRow(pageA).innerText()).replace(/\s+/g, ' ');

  /*
    🔒 The teacher agreed to be contacted. That is a fact to state, not an
    achievement — an "unlocked!" state would make consent feel like a
    transaction, which is exactly what 2.56 refuses to let it be.
  */
  check('🔒 nothing on the screen celebrates it — no "unlocked", no prize',
    !/unlocked|congratulations|🎉|well done/i.test(pageText),
    'the accepted row is as quiet as a declined one');

  check('…and it says plainly that they can contact you about this',
    /can contact you/i.test(pageText), 'stated, not celebrated');

  await shot(pageA, 'teacher-invitations-answered-1440');

  // =========================================================================
  section('5. 🔴 FORCED — answering SOMEBODY ELSE\'S invitation');
  // =========================================================================

  const { context: ctxC, page: pageC } = await openAs(sessionC);

  check('premise: the stranger holds no invitation from this run',
    (await openRow(pageC).count()) === 0,
    `${await openRow(pageC).count()} matching of ${await pageC.locator('.invites__item').count()} total`);

  const force = async (accept) => pageC.evaluate(async ({ base, id, acc }) => {
    const token = localStorage.getItem('jp.teacher.accessToken');

    const response = await fetch(`${base}/teacher/invites/${id}/respond`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ accept: acc }),
    });

    return { status: response.status, body: await response.text() };
  }, { base: APP, id: inviteB, acc: accept });

  const forcedAccept = await force(true);
  const forcedIgnore = await force(false);

  console.log(`\n    forced ACCEPT : HTTP ${forcedAccept.status} ${forcedAccept.body.slice(0, 110)}`);
  console.log(`    forced IGNORE : HTTP ${forcedIgnore.status} ${forcedIgnore.body.slice(0, 110)}\n`);

  check('🔴 forcing ACCEPT on another teacher\'s invitation answers 404',
    forcedAccept.status === 404, `HTTP ${forcedAccept.status}`);

  check('🔴 forcing IGNORE on it answers 404 too',
    forcedIgnore.status === 404, `HTTP ${forcedIgnore.status}`);

  check('🔒 …404 and not 403 — a 403 would confirm it exists (2.6)',
    forcedAccept.status !== 403 && /not found/i.test(forcedAccept.body),
    `"${(JSON.parse(forcedAccept.body || '{}').message ?? '').slice(0, 60)}"`);

  check('🔴 …the invitation is untouched, still unanswered',
    inviteStatus(inviteB) === '1', `status ${inviteStatus(inviteB)}`);

  /*
    🔒 AND THE MOST IMPORTANT ONE: a stranger's forced click must not have
    unlocked the teacher it was aimed at. If it had, the consent path would be
    reachable by anybody holding an id.
  */
  check('🔒 …and NOBODY was unlocked by it',
    unlocked(idB) === '0', `teacher B is still ${unlocked(idB)}`);

  // =========================================================================
  section('6. 🔒 DECLINING — the school is told, and nothing opens');
  // =========================================================================

  const { context: ctxB, page: pageB } = await openAs(sessionB);

  await openRow(pageB).locator('.invites__actions button')
    .filter({ hasText: /not interested/i }).click();
  await pageB.waitForTimeout(2800);

  console.log(`\n    after declining: status ${inviteStatus(inviteB)}, unlocked ${unlocked(idB)}\n`);

  check('declining is recorded without a confirmation dialog',
    inviteStatus(inviteB) === '5', `status ${inviteStatus(inviteB)} (5 = Ignored)`);

  check('🔒 …and it unlocks nothing — 2.56 has exactly two paths, and this is neither',
    unlocked(idB) === '0', `fn_TeacherContactUnlocked = ${unlocked(idB)}`);

  check('🔴 …and the SCHOOL was told, through the notification machine (021)',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_notifications n
        INNER JOIN m_app_notification_type nt ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE nt.Code = 'INVITE_IGNORED';`) !== '0',
    'an INVITE_IGNORED notification exists');

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => {});

  section('7. EXIT — invitations gone, nobody left unlocked');

  try {
    cleanup();

    check('exit: no invitation of ours is left',
      scalar(`SET NOCOUNT ON; USE jp_app;
        SELECT CAST(COUNT(*) AS varchar(6)) FROM t_app_teacher_invites
         WHERE [Message] LIKE N'invite-screens%';`) === '0', 'none');

    check('🔒 exit: nobody is left unlocked by this run',
      unlocked(teacherIdOf(TEACHER_A.id)) === '0'
      && unlocked(teacherIdOf(TEACHER_B.id)) === '0'
      && unlocked(teacherIdOf(TEACHER_C.id)) === '0',
      'all three locked again');
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
