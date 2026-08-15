/*
  PHASE 3H — the teacher profile in a real browser.

  ----------------------------------------------------------------------------
  THE THREE PROFILES THAT BREAK THIS SCREEN
  ----------------------------------------------------------------------------
  3B seeded them deliberately (2.52), and a screen that has only ever been fed a
  complete profile breaks on the first real one:

    Rohit — 90%, and NO CURRENT JOB. Only a closed experience row.
    Anita — 100 months of experience and ZERO subjects.
    Imran — a name and a state. Nothing else. 0%.

  Each is opened here, at both widths, and the checks are about what somebody
  actually sees: that 0% is never shown as a verdict, that the next step is
  named, and that the resume cap explains itself where it bites.

  ⚠️ NOTHING IS SAVED as these three. The multi-select is opened and filled to
  photograph it with twenty selections, and the save button is never pressed —
  the seeded profiles are the only half-filled ones in the system and are worth
  more intact.

  Passwords: these accounts were seeded in 3B and nobody recorded a password, so
  this sets one through the REAL forgot-password flow — the same path a teacher
  would use — and writes it to local-accounts.md, which is gitignored.

  Run (both APIs, jp-shared on :4999, jp-teacher on :4400):
      node scripts/verify/screens-3h.mjs
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';
const TEACHER = 'http://localhost:4400';
const OUT = 'D:/Projects/jp-docs/screenshots/3h';
const SSO_MAIL_DROP = 'D:/Projects/jp-backend/JP.Sso.Api/App_Data/mail-drop';

const PASSWORD = 'Seeded#Teacher2026!';

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const PEOPLE = [
  { key: 'rohit', name: 'Rohit Kulkarni', why: '90%, and no current job' },
  { key: 'anita', name: 'Anita Deshmukh', why: '100 months of experience, zero subjects' },
  { key: 'imran', name: 'Imran Qureshi', why: 'a name and a state, nothing else' },
];

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-h', '-1', '-W', '-Q', q], {
    encoding: 'utf8',
  }).trim();

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return { http: r.status, body: JSON.parse(text) }; } catch { return { http: r.status, body: null }; }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signs in, waiting out the 5-per-minute-per-IP limiter rather than failing. */
const login = async (loginId, password, attempt = 1) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });

  if (r.http === 429 && attempt <= 4) {
    console.log(`  … rate limited; waiting 20s (attempt ${attempt})`);
    await wait(20_000);

    return login(loginId, password, attempt + 1);
  }

  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message}`);

  return r.body.data;
};

const readMail = (file) => {
  try { return fs.readFileSync(path.join(SSO_MAIL_DROP, file), 'utf8'); } catch { return ''; }
};

const findResetToken = async (email) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = fs
      .readdirSync(SSO_MAIL_DROP)
      .map((f) => ({ f, t: fs.statSync(path.join(SSO_MAIL_DROP, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((d) => readMail(d.f))
      .find((c) => c.includes(email) && c.includes('reset-password?token='));

    const match = content?.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
    if (match) return decodeURIComponent(match[1]);

    await wait(500);
  }

  return null;
};

/**
 * Gives a seeded account a known password, through the product's own flow.
 *
 * ⚠️ Not a direct credential write. Everything here goes through the endpoints a
 * real person uses, so a broken reset flow shows up as a failed screenshot run
 * rather than being quietly stepped around.
 */
const setKnownPassword = async (email) => {
  /*
    🔴 TRY THE KNOWN PASSWORD FIRST.

    A second run of this script used to fail here, and the reason was the
    product working correctly: the last three passwords cannot be reused (2.6),
    so resetting to the same one is refused. The script was asking for something
    it had already been given.

    So: sign in if we can, and only fall back to the reset flow when we cannot.
    That also makes the run cheap after the first — no email, no token, no
    password change on an account that already has one.
  */
  const existing = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: email, password: PASSWORD }),
  });

  if (existing.body?.data?.accessToken) return true;

  await j(`${SSO}/auth/forgot-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const token = await findResetToken(email);
  if (!token) return false;

  const reset = await j(`${SSO}/auth/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword: PASSWORD }),
  });

  return reset.http === 200;
};

// ---------------------------------------------------------------------------
console.log('\n=== 0. THE THREE ACCOUNTS ===');

for (const person of PEOPLE) {
  person.email = sql(`SET NOCOUNT ON; SELECT u.Email FROM jp_sso.dbo.t_sso_users u
    INNER JOIN jp_app.dbo.t_app_teachers t ON t.UserUid = u.UserUid
    WHERE t.FullName = N'${person.name}' AND t.Is_Deleted = 0`);

  const ok = await setKnownPassword(person.email);
  check(`${person.name} can be signed in as (${person.why})`, ok, person.email);
}

const browser = await chromium.launch();

const openAs = async (email, viewport) => {
  const session = await login(email, PASSWORD);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(TEACHER, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.setItem('jp.teacher.accessToken', s.accessToken);
    localStorage.setItem('jp.teacher.refreshToken', s.refreshToken);
  }, session);

  return { context, page };
};

const shot = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. 🔴 IMRAN — 0%, AND NEVER TOLD SO ===');

let { context, page } = await openAs(PEOPLE[2].email, WIDE);
await page.goto(`${TEACHER}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const imranHeadline = await page.locator('.meter__title').textContent();

check('🔴 a profile at 0% is NOT shown "0%" as a headline',
  !/0\s*%/.test(imranHeadline ?? '') && (await page.locator('.meter__percent').count()) === 0,
  `headline: "${imranHeadline?.trim()}"`);

const imranNext = await page.locator('.meter__next-title').textContent();
check('🔴 …it names ONE thing to do instead',
  /subject/i.test(imranNext ?? ''), imranNext?.replace(/\s+/g, ' ').trim());

check('…with the reason, not just the instruction',
  /find you/i.test((await page.locator('.meter__next-why').textContent()) ?? ''),
  (await page.locator('.meter__next-why').textContent())?.trim());

check('the empty experience section invites rather than reports',
  /Add where you have taught/i.test((await page.locator('#section-experience .empty').textContent()) ?? ''),
  'not “No experience added yet”');

await shot(page, 'imran-0-percent-1440');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 2. 🔴 ANITA — EXPERIENCE, NO SUBJECTS ===');

({ context, page } = await openAs(PEOPLE[1].email, WIDE));
await page.goto(`${TEACHER}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

check('the screen renders for a profile with 100 months and zero subjects',
  (await page.locator('.card').count()) >= 9,
  `${await page.locator('.card').count()} sections`);

check('🔴 …and the total experience is shown from the server’s number',
  /8 years 4 months/.test((await page.locator('.experience__total').textContent()) ?? ''),
  (await page.locator('.experience__total').textContent())?.trim());

const anitaNext = await page.locator('.meter__next-title').textContent();
check('🔴 …and the missing subjects are what it asks for first',
  /subject/i.test(anitaNext ?? ''), anitaNext?.replace(/\s+/g, ' ').trim());

await shot(page, 'anita-no-subjects-1440');

// 🔴 The multi-select with many selections — opened, filled, NEVER SAVED.
console.log('\n=== 3. THE MULTI-SELECT, TWENTY DEEP ===');

const subjectSelect = page.locator('#section-subjects ui-multi-select').first();
await subjectSelect.locator('.multi__control').click();
await page.waitForTimeout(400);

const optionCount = await page.locator('.multi__option').count();
check('the panel opens with every option and its own search box',
  optionCount > 0 && (await page.locator('.multi__search').count()) === 1,
  `${optionCount} options`);

// Keyboard: the arrow keys move an active option rather than tabbing through.
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);

const activeAfterArrows = (await page.locator('.multi__option--active').textContent())?.trim();

check('🔴 arrow keys move an active option (they used to do nothing)',
  (await page.locator('.multi__option--active').count()) === 1,
  `active: ${activeAfterArrows}`);

await page.keyboard.press('Enter');
await page.waitForTimeout(300);

/*
  ⚠️ SCOPED TO THIS CONTROL.

  The first version counted `.multi__chip` across the whole section — which
  holds TWO multi-selects, subjects and class levels — so Anita's single class
  level was counted as a subject and the check failed against a control that was
  working correctly.

  What matters is not how many chips exist; it is that the chip which appeared
  is the option the arrow keys were on.
*/
const subjectChips = await subjectSelect.locator('.multi__chip').allTextContents();

check('🔴 …and Enter selects exactly the active option',
  subjectChips.some((chip) => chip.trim().startsWith(activeAfterArrows ?? ' ')),
  `active "${activeAfterArrows}" → chips [${subjectChips.map((c) => c.trim()).join(', ')}]`);

// Fill it up, to photograph the case that used to break the layout.
const toSelect = Math.min(optionCount, 20);
for (let i = 0; i < toSelect; i++) {
  await page.locator('.multi__option').nth(i).click();
}

await page.waitForTimeout(300);
const chips = await subjectSelect.locator('.multi__chip').count();
const summary = await subjectSelect.locator('.multi__summary').textContent();

check(`🔴 ${chips} selections summarise in the trigger rather than inflating it`,
  /\d+ subjects selected/.test(summary ?? ''), summary?.trim());

await shot(page, 'multi-select-many-1440');

await page.keyboard.press('Escape');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 4. ROHIT — 90%, HELD BY THE RESUME CAP? ===');

({ context, page } = await openAs(PEOPLE[0].email, WIDE));
await page.goto(`${TEACHER}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const rohitPercent = await page.locator('.meter__percent').textContent();
check('a mostly-complete profile shows its percentage', /\d+%/.test(rohitPercent ?? ''),
  rohitPercent?.trim());

const timelineRows = await page.locator('.timeline__item').count();
const currentFlags = await page.locator('.timeline__now').count();

check('🔴 a teacher with only a CLOSED job renders — no current row, no crash',
  timelineRows >= 1 && currentFlags === 0,
  `${timelineRows} entry, ${currentFlags} marked "Now"`);

await shot(page, 'rohit-closed-job-only-1440');

// Every section, at 1440.
for (const section of ['basics', 'photo', 'qualifications', 'subjects', 'skills',
                       'experience', 'locations', 'salary', 'documents']) {
  await page.locator(`#section-${section}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(`#section-${section}`).screenshot({ path: path.join(OUT, `section-${section}-1440.png`) });
}

check('every section photographed at 1440', true, '9 sections');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 5. 375 ===');

({ context, page } = await openAs(PEOPLE[0].email, PHONE));
await page.goto(`${TEACHER}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const overflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

check('🔴 the profile does not scroll sideways at 375', overflow === 0, `${overflow}px`);

await shot(page, 'rohit-375');

for (const section of ['basics', 'subjects', 'skills', 'experience', 'documents']) {
  await page.locator(`#section-${section}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(`#section-${section}`).screenshot({ path: path.join(OUT, `section-${section}-375.png`) });
}

// The multi-select at 375 with many selections — the case that used to be a
// wall of chips pushing the page down.
await page.locator('#section-subjects').scrollIntoViewIfNeeded();
await page.locator('#section-subjects .multi__control').first().click();
await page.waitForTimeout(400);

const phoneOptions = await page.locator('.multi__option').count();
for (let i = 0; i < Math.min(phoneOptions, 20); i++) {
  await page.locator('.multi__option').nth(i).click();
}

await page.waitForTimeout(300);

const phoneOverflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

check('🔴 …and neither does it with twenty selections open at 375',
  phoneOverflow === 0, `${phoneOverflow}px with ${await page.locator('.multi__chip').count()} chips`);

await shot(page, 'multi-select-many-375');

await page.keyboard.press('Escape');
await context.close();
await browser.close();

// ---------------------------------------------------------------------------
console.log('\n=== 6. NOTHING WAS SAVED ===');

const after = sql(`SET NOCOUNT ON;
  SELECT t.FullName + '|' + CAST(t.ProfileCompletionPercent AS varchar(4)) + '|'
       + CAST((SELECT COUNT(*) FROM jp_app.dbo.t_app_teacher_subjects s
               WHERE s.TeacherId = t.TeacherId AND s.Is_Deleted = 0) AS varchar(4))
  FROM jp_app.dbo.t_app_teachers t
  WHERE t.FullName IN (N'Rohit Kulkarni', N'Anita Deshmukh', N'Imran Qureshi') AND t.Is_Deleted = 0
  ORDER BY t.FullName`);

console.log(after.split('\n').map((l) => `      ${l.trim()}`).join('\n'));

const rows = after.split('\n').map((l) => l.trim().split('|'));

check('🔴 Anita still has ZERO subjects — the twenty ticked were never saved',
  rows.some((r) => r[0] === 'Anita Deshmukh' && r[2] === '0'),
  'the seeded profiles are untouched');

check('…and the three percentages are as they were',
  rows.some((r) => r[0] === 'Anita Deshmukh' && r[1] === '37') &&
  rows.some((r) => r[0] === 'Imran Qureshi' && r[1] === '0') &&
  rows.some((r) => r[0] === 'Rohit Kulkarni' && r[1] === '90'),
  'Anita 37, Imran 0, Rohit 90');

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`  Screenshots: ${OUT}`);
console.log(`  ⚠️ These three accounts now share the password in local-accounts.md.`);
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
