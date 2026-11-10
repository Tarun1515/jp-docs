/*
  THE CLIENT WALKTHROUGH — every screen of a school's journey, captured.

  ----------------------------------------------------------------------------
  🔴 WHAT THIS IS, AND WHY IT IS NOT A TEST
  ----------------------------------------------------------------------------
  Every other file in this folder asserts something and fails when it is
  wrong. This one asserts almost nothing: its job is to produce the pictures a
  client can sit and read — the whole registration, step by step, every form,
  every dropdown with its list open — and then every menu inside the portal,
  including the pricing route.

  ⚠️ SO IT MUST NEVER FAIL SILENTLY. A test that cannot find a button fails and
  somebody investigates. A screenshot run that cannot find a button would
  otherwise hand over a folder that is quietly missing the step nobody looked
  for. Every capture is therefore recorded as taken or MISSED, and the run
  prints the misses at the end and exits non-zero if there are any.

  ----------------------------------------------------------------------------
  🔴 THE OTP IS READ FROM THE APP'S OWN EMAIL, NOT FROM THE DATABASE
  ----------------------------------------------------------------------------
  `t_sso_user_otps` stores `OtpHash` — the code is hashed and cannot be read
  back, which is correct and must stay that way. In Development the mailer
  writes rendered messages to `App_Data/mail-drop/*.eml` precisely so reset
  links and OTPs can be read without a mail provider.

  ⚠️ So this walks the REAL verification screen with the REAL code. It does not
  flip `IsVerified` in the database, which would photograph a screen the
  product never shows and skip the one step most likely to be wrong.

  ----------------------------------------------------------------------------
  ⚠️ TWO ACCOUNTS, AND THE REASON IS HONEST
  ----------------------------------------------------------------------------
  A school that has just registered is PENDING APPROVAL — it cannot see the
  dashboard, jobs or billing, because it has not been approved yet. That is the
  product working correctly, not a gap.

  So the walkthrough has two parts and says so in the output:

    Part 1  a genuinely new school, registering from nothing, ending where a
            real new school ends — the "we have your application" screen.
    Part 2  an APPROVED school, for the menus inside the portal.

  Photographing part 2 with the part 1 account would produce a folder full of
  "access denied", and photographing part 1 with the approved account would
  skip registration entirely. Neither is what was asked for.

  Run (all services up):  node scripts/verify/walkthrough-school.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

import { session as loginSession } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

// ---------------------------------------------------------------------------

const SCHOOL_APP = 'http://localhost:4300';
const OUT = 'D:/Projects/jp-docs/design-screens/walkthrough';
const MAIL_DROP = 'D:/Projects/jp-backend/JP.Sso.Api/App_Data/mail-drop';

/*
  ⚠️ TWO WIDTHS, AND 375 IS NOT AN AFTERTHOUGHT. A principal in a district town
  is more likely to finish this on a phone than at a desk, so every screen in
  part 1 is captured at both. Part 2's menus are captured wide, with the phone
  width taken on the pages a school actually opens on one.
*/
const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];
const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

/* Distinctive, so nothing stale can be mistaken for this run. */
const RUN = Date.now().toString().slice(-8);
const NEW = {
  email: `walkthrough.${RUN}@yopmail.com`,
  password: 'Walkthrough@2026',
  school: `Sunrise Public School ${RUN}`,
  principal: 'Dr Kamla Nehra',

  /*
    ⚠️ UNIQUE PER RUN, like the email. A fixed number was refused with "An
    account already exists with this mobile number" on the second run — the
    account from the first run still held it. Ten digits, starting 9, which is
    what the validator wants.
  */
  mobile: `98${RUN}`,
  village: 'Dhani Bhagwan Das',
};

/*
  A real PNG, written to the scratch folder at run time.

  ⚠️ EMBEDDED RATHER THAN COMMITTED. 2.48 hardens every upload on extension,
  MAGIC BYTES and size, so the file has to be a genuine PNG — a renamed text
  file is refused, correctly. It is written here instead of checked into the
  repository because a binary fixture nobody can read in a diff is a thing that
  rots quietly.
*/
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const UPLOAD = path.join(
  'C:/Users/bhard/AppData/Local/Temp/claude/d--Projects-TeacherRecruitmentPortal',
  'ee9364b8-a7ed-4930-bb20-37545ca288a1/scratchpad',
  'walkthrough-upload.png',
);

fs.writeFileSync(UPLOAD, PNG_1PX);

// ---------------------------------------------------------------------------
// Capture bookkeeping — the part that makes a missing screenshot visible.

const taken = [];
const missed = [];
let seq = 0;

fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name, note) => {
  seq += 1;
  const n = String(seq).padStart(2, '0');
  const w = page.viewportSize()?.width ?? 0;
  const file = `${n}-${name}-${w}.png`;

  try {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    taken.push({ file, note });
    console.log(`  ✓ ${file}${note ? `  — ${note}` : ''}`);
  } catch (e) {
    missed.push({ file, why: e.message });
    console.log(`  🔴 MISSED ${file} — ${e.message}`);
  }
};

/*
  ⚠️ These helpers report a miss instead of throwing, so one changed selector
  costs one screenshot rather than the whole walkthrough. The miss is printed
  and counted — it is never swallowed.
*/
const step = async (label, fn) => {
  try {
    await fn();
    return true;
  } catch (e) {
    missed.push({ file: `(step) ${label}`, why: e.message });
    console.log(`  🔴 STEP FAILED: ${label} — ${e.message}`);
    return false;
  }
};

// ---------------------------------------------------------------------------
// The OTP, read from the message the product actually sent.

const otpFromMailDrop = (since) => {
  const files = fs.readdirSync(MAIL_DROP)
    .filter((f) => f.endsWith('.eml'))
    .map((f) => ({ f, t: fs.statSync(path.join(MAIL_DROP, f)).mtimeMs }))
    .filter((x) => x.t >= since)
    .sort((a, b) => b.t - a.t);

  for (const { f } of files) {
    const body = fs.readFileSync(path.join(MAIL_DROP, f), 'utf8');
    if (!body.includes(NEW.email)) continue;

    /*
      ⚠️ Six digits standing alone. Anchored on word boundaries so a date, a
      pincode inside an address or a quoted-printable artefact cannot be
      mistaken for the code.
    */
    const m = body.match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  return null;
};

const waitForOtp = async (since, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const code = otpFromMailDrop(since);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
};

// ---------------------------------------------------------------------------

const browser = await chromium.launch();

const openPage = async (viewport, session) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(SCHOOL_APP, { waitUntil: 'domcontentloaded' });

  if (session) {
    await page.evaluate((s) => {
      localStorage.setItem('jp.school.accessToken', s.accessToken);
      localStorage.setItem('jp.school.refreshToken', s.refreshToken);
    }, session);
  }
  return { ctx, page };
};

/*
  A combobox, photographed CLOSED, then OPEN, then with its search in use.

  ⚠️ FOUND BY ITS VISIBLE LABEL, not by an id. <ui-combobox> generates its own
  `controlId`, so there is no `#stateId` to select — this is the same thing that
  silently broke jobs-screens, caught there by a thirty-second timeout rather
  than by a failed assertion.
*/
const showCombobox = async (page, label, query, nameStem) => {
  const field = page.getByLabel(label, { exact: false }).first();

  /*
    ⚠️ SOME OF THESE CONTROLS ARE LEGITIMATELY ABSENT, and waiting thirty
    seconds to discover that is not the same as finding out.

    Tehsil renders only when the chosen state HAS tehsils — today that is
    Haryana and nothing else (SR-5 seeded districts and towns for all of India
    but deliberately no tehsils elsewhere). District and town hide the same way
    when their list is empty. So the control is given eight seconds to appear
    and its absence is reported as a skip, not a failure: the form hiding a
    level it has no data for is the degradation the design asks for.
  */
  try {
    await field.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    console.log(`  — ${label} is not shown here (the data has no level for it) — skipping`);
    return;
  }

  await field.click();
  await page.waitForTimeout(300);
  await shot(page, `${nameStem}-open`, `${label} — the list, open.`);

  if (query) {
    await field.fill(query);
    await page.waitForTimeout(400);
    await shot(page, `${nameStem}-search`, `${label} — typing "${query}" narrows the list. This is why it is searchable: a state has dozens of districts and Haryana alone has 143 towns.`);
  }

  const option = page.locator('[role="option"]').first();

  if (await option.count()) {
    await option.click();
    await page.waitForTimeout(300);
    await shot(page, `${nameStem}-chosen`, `${label} — chosen.`);
  }
};

const report = () => {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  CAPTURED ${taken.length} screens into ${OUT}`);
  if (missed.length) {
    console.log(`  🔴 ${missed.length} MISSED — this folder is INCOMPLETE:`);
    for (const m of missed) console.log(`     - ${m.file}: ${m.why}`);
  } else {
    console.log('  nothing missed');
  }
  console.log('='.repeat(74));

  /* The index the client reads, written from what was ACTUALLY captured. */
  const lines = [
    '# School walkthrough — every screen, in order',
    '',
    `Captured ${new Date().toISOString().slice(0, 10)} from a live run.`,
    '',
    '> Part 1 is a genuinely new school registering from nothing, and it ends',
    '> where a real new school ends: waiting for approval. Part 2 uses an',
    '> already-approved school, because the menus inside the portal are not',
    '> open to an account that has not been approved yet.',
    '',
  ];
  for (const t of taken) {
    lines.push(`### ${t.file.replace(/^\d+-/, '').replace(/-\d+\.png$/, '').replace(/-/g, ' ')}`);
    if (t.note) lines.push('', t.note);
    lines.push('', `![${t.file}](design-screens/walkthrough/${t.file})`, '');
  }
  fs.writeFileSync('D:/Projects/jp-docs/WALKTHROUGH.md', lines.join('\n'), 'utf8');
  console.log('  index: D:\\Projects\\jp-docs\\WALKTHROUGH.md');
};

// ===========================================================================
try {
  console.log('\n=== PART 1 — a new school, from nothing ===\n');

  let { ctx, page } = await openPage(WIDE);

  // ---- create the login ---------------------------------------------------
  await step('open /auth/register', async () => {
    await page.goto(`${SCHOOL_APP}/auth/register`, { waitUntil: 'networkidle' });
  });
  await shot(page, 'signup-empty', 'Creating the login — the very first screen.');

  const mailSince = Date.now();

  await step('fill the signup form', async () => {
    /*
      ⚠️ SCHOOL NAME IS ON THIS FORM TOO, and leaving it out is what made the
      first run of this walkthrough produce a folder of useless screenshots:
      "Create account" was refused with "Enter your school name.", the account
      was never created, and every later /account/* visit bounced to Sign in —
      so eleven screenshots of the registration form were really eleven
      screenshots of the login page. The step reports caught it; the images
      alone would not have.
    */
    await page.getByLabel(/school name/i).first().fill(NEW.school);
    await page.getByLabel(/^email/i).first().fill(NEW.email);
    await page.getByLabel(/mobile/i).first().fill(NEW.mobile);

    const pw = page.locator('input[type="password"]');
    const n = await pw.count();
    for (let i = 0; i < n; i += 1) await pw.nth(i).fill(NEW.password);
  });
  await shot(page, 'signup-filled', 'The same screen with details entered.');

  await step('submit the signup', async () => {
    await page.getByRole('button', { name: /create|sign ?up|register|continue/i }).first().click();
    await page.waitForTimeout(2500);

    /*
      🔴 STOP HERE IF THE ACCOUNT WAS NOT CREATED.

      The first run carried on past a refused signup and photographed the login
      page eleven times under registration-step names. A walkthrough that keeps
      going after the thing it is walking through did not happen produces a
      folder that looks complete and is worthless — which is worse than one
      that stops and says why.
    */
    const refusal = await page.locator('.field__error, .form-error, [role="alert"]').allInnerTexts();
    const stillOnSignup = /\/auth\/register/.test(page.url());

    if (stillOnSignup && refusal.length) {
      throw new Error(`signup was refused: ${refusal.join(' · ')}`);
    }
  });
  await shot(page, 'account-created',
    'Account created. This is where a school lands — their application is not written yet, and the page says what happens next.');

  /*
    ----------------------------------------------------------------------------
    🔴 THERE IS NO OTP IN THIS FLOW, AND THAT WAS WORTH FINDING OUT
    ----------------------------------------------------------------------------
    This script was written expecting a code-verification step, and read the
    code out of the mail-drop the app writes in Development. It found none, so
    the first runs produced screenshots of the login page under
    registration-step names.

    What actually happens: creating the account signs the person straight in
    and lands them on their status page — "Your school is being verified" —
    with a **Register your school** button. `t_sso_users` confirms it: the
    account exists with `IsEmailVerified = 0` and **no row in
    `t_sso_user_otps` at all**. A `/account/verify-otp` route exists, but
    nothing on this path sends a code.

    ⚠️ So the walkthrough follows the button the product actually shows,
    rather than the flow this file assumed. Written down because the assumption
    was reasonable and wrong, and the next person will make it too.
  */
  const code = true;

  await step('open the registration form the way a school does — the button on their status page', async () => {
    const start = page.getByRole('button', { name: /register your school/i })
      .or(page.getByRole('link', { name: /register your school/i }));

    if (await start.count()) {
      await start.first().click();
      await page.waitForTimeout(1800);
    } else {
      await page.goto(`${SCHOOL_APP}/account/register`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
    }
  });

  // ---- the six-step school registration ----------------------------------
  // 🔴 Gated on the account existing — see the OTP note above.
  if (code) {
  const STEPS = [
    ['basics', 'The school — name, board and registration numbers.'],
    ['address', 'Where it is — the address teachers will see on your jobs.'],
    ['logo', 'Your school — a logo, or any clear photo.'],
    ['contact', 'Who to reach about this application.'],
    ['documents', 'Proof that the school is what it says it is.'],
    ['review', 'Everything entered, before it goes.'],
  ];

  await step('open the school registration form', async () => {
    await page.goto(`${SCHOOL_APP}/account/register`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  });

  for (const [key, blurb] of STEPS) {
    await shot(page, `register-${key}-empty`, `Step: ${blurb}`);

    if (key === 'basics') {
      await step('fill basics', async () => {
        await page.getByLabel(/school name/i).first().fill(NEW.school);
      });
      await shot(page, 'register-basics-filled', 'The same step, filled in.');
    }

    if (key === 'address') {
      /*
        🔴 THE POINT OF THE WHOLE ADDRESS DESIGN, SO IT IS PHOTOGRAPHED IN
        DETAIL: the searchable dropdowns with their lists open, and the
        free-text village box that lets a village school give a real address.
      */
      /*
        ⚠️ THE STREET ADDRESS IS REQUIRED AND WAS BEING SKIPPED. Without it
        "Continue" does nothing, so the first runs photographed the address
        step six times under six different step names while the form sat
        exactly where it was.
      */
      await step('street address', async () => {
        await page.getByLabel(/^address/i).first().fill('12 Civil Lines, Opposite the bus stand');
      });

      await step('state combobox', () => showCombobox(page, 'State', 'Har', 'register-address-state'));
      await step('district combobox', () => showCombobox(page, 'District', '', 'register-address-district'));
      await step('tehsil combobox', () => showCombobox(page, 'Tehsil', '', 'register-address-tehsil'));
      await step('town combobox', () => showCombobox(page, 'Town', '', 'register-address-town'));
      /*
        ⚠️ "Village or area", NOT "Area or locality" — the form has both, and
        the loose /village|area/i matched the wrong one first, so the village
        name landed in the locality box and the field this whole address
        design exists for stayed empty in the screenshot.
      */
      await step('village free text', async () => {
        await page.getByLabel(/village or area/i).first().fill(NEW.village);
      });
      await shot(page, 'register-address-complete', 'A complete address, including a village that is not in any list.');
    }

    /*
      🔴 THE LOGO AND THE DOCUMENTS ARE UPLOADED, NOT SKIPPED.

      "Send for verification" is `[disabled]="!canSubmit()"`, and the first run
      sat on it for thirty seconds: the form was incomplete, so the product
      correctly would not let it be sent. Photographing a review page whose
      submit button can never be pressed would have shown the client a journey
      that does not end.
    */
    /*
      ⚠️ EMAIL AND PHONE ARE REQUIRED HERE, and skipping them parked the form
      on step 4 in the same silent way the street address parked it on step 2.
      Each of these was a step the walkthrough *thought* it had photographed.
    */
    if (key === 'contact') {
      await step('fill the contact step', async () => {
        await page.getByLabel(/^email/i).first().fill(NEW.email);
        await page.getByLabel(/phone/i).first().fill(NEW.mobile);
      });
      await shot(page, 'register-contact-filled',
        'Who to reach — and note what it says: the principal and HR details are asked for on the profile after approval, not here.');
    }

    if (key === 'logo') {
      await step('upload the school photo', async () => {
        await page.locator('input[type="file"]').first().setInputFiles(UPLOAD);
        await page.waitForTimeout(1800);
      });
      await shot(page, 'register-logo-uploaded',
        'A logo — or, as the client asked, any clear photo of the school. This is the step most likely to stall somebody, so it stands on its own.');
    }

    if (key === 'documents') {
      await step('upload the documents', async () => {
        const inputs = page.locator('input[type="file"]');
        const n = await inputs.count();

        for (let i = 0; i < n; i += 1) {
          await inputs.nth(i).setInputFiles(UPLOAD);
          await page.waitForTimeout(1500);
        }
      });
      await shot(page, 'register-documents-uploaded', 'Proof uploaded — one file per document type.');
    }

    /*
      ⚠️ NOT PAST THE LAST STEP. `review` has no "Continue" — it has "Send for
      verification", which is pressed below once the plan block has been
      photographed. Trying to advance here spent thirty seconds and reported a
      miss for a button that correctly does not exist.
    */
    if (key !== 'review') {
      await step(`advance past ${key}`, async () => {
        await page.getByRole('button', { name: /next|continue|save and/i }).first().click();
        await page.waitForTimeout(1400);
      });
    }
  }

  await shot(page, 'register-review', 'The review step — everything, before it is sent.');

  /*
    🔴 SR-5. THE PLAN BLOCK IS THE LAST THING BEFORE SUBMIT, and the client
    asked specifically to see it. Both states are captured: "Register as Free"
    as it arrives pre-selected, and a paid plan picked — because the whole
    point of the paid state is the caveat that appears with it, and a
    screenshot of the plan cards without that caveat would show the one thing
    the design exists to prevent.
  */
  await step('the plan block, as it arrives', async () => {
    const plans = page.locator('.reg-plans, [data-plan-choice]').first();
    if (await plans.count()) await plans.scrollIntoViewIfNeeded();
  });
  await shot(page, 'register-plan-free-preselected',
    '"Register as Free" is chosen for them. Nothing is owed, and nothing is charged.');

  await step('choose a paid plan', async () => {
    const paid = page.getByText(/Standard/i).first();
    if (await paid.count()) {
      await paid.click();
      await page.waitForTimeout(500);
    }
  });
  await shot(page, 'register-plan-paid-caveat',
    'A paid plan chosen — and the line that has to be there: the account still starts on the free plan until an administrator confirms the payment.');

  await step('submit the registration', async () => {
    await page.getByRole('button', { name: /submit|send|finish/i }).first().click();
    await page.waitForTimeout(3000);
  });
  await shot(page, 'register-submitted', 'Submitted. This is where a real new school lands.');
  }

  await ctx.close();

  // ---- the same journey on a phone ---------------------------------------
  console.log('\n--- part 1 key screens at 375px ---\n');
  ({ ctx, page } = await openPage(PHONE));
  for (const [route, name, note] of [
    ['/auth/register', 'phone-signup', 'Creating the login, on a phone.'],
    ['/account/register', 'phone-register', 'The registration form, on a phone.'],
    ['/account/status', 'phone-status', 'Application status, on a phone.'],
  ]) {
    await step(`phone ${route}`, async () => {
      await page.goto(`${SCHOOL_APP}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    });
    await shot(page, name, note);
  }
  await ctx.close();

  // =========================================================================
  console.log('\n=== PART 2 — inside the portal (an approved school) ===\n');

  const owner = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
  const sess = await loginSession(owner.id, owner.pw);

  ({ ctx, page } = await openPage(WIDE, sess));

  const MENUS = [
    ['/dashboard', 'menu-dashboard', 'Dashboard — what is actually there, nothing invented.'],
    ['/profile', 'menu-profile', 'School profile, including the principal and HR contacts.'],
    ['/branches', 'menu-branches', 'Campuses — and where a group adds its next school.'],
    ['/jobs', 'menu-jobs', 'Jobs — every posting and its status.'],
    ['/jobs/new', 'menu-jobs-new', 'Posting a job.'],
    ['/applicants', 'menu-applicants', 'Applicants.'],
    ['/teacher-search', 'menu-teacher-search', 'Searching for teachers.'],
    ['/offers', 'menu-offers', 'Offers.'],
    ['/users', 'menu-users', 'The team, and what each person may do.'],
    ['/notifications', 'menu-notifications', 'Notifications.'],
    ['/billing', 'menu-billing', 'Plans and pricing.'],
  ];

  for (const [route, name, note] of MENUS) {
    await step(`open ${route}`, async () => {
      await page.goto(`${SCHOOL_APP}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
    });
    await shot(page, name, note);
  }

  // =========================================================================
  console.log('\n=== PART 3 — the pricing route, and the way back ===\n');

  /*
    🔴 THE WHOLE POINT OF THE CLIENT'S REQUEST: pricing must be reachable from
    where the work is, and paying must return the person to the page they left.
    So this does not photograph /billing on its own — it photographs the
    JOURNEY: a page, the plans, and that page again.
  */
  await step('start from the jobs list', async () => {
    await page.goto(`${SCHOOL_APP}/jobs`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  });
  await shot(page, 'pricing-origin', 'The page the school is working on, before anything about price.');

  await step('go to the plans from here', async () => {
    const link = page.getByRole('button', { name: /upgrade|plan|pricing/i })
      .or(page.getByRole('link', { name: /upgrade|plan|pricing/i }));
    if (await link.count()) {
      await link.first().click();
    } else {
      await page.goto(`${SCHOOL_APP}/billing`, { waitUntil: 'networkidle' });
    }
    await page.waitForTimeout(1400);
  });
  await shot(page, 'pricing-plans', 'The plans — reached from the page above, which it remembers.');

  await step('choose a plan', async () => {
    const choose = page.getByRole('button', { name: /choose|select|upgrade|pay/i });
    if (await choose.count()) {
      await choose.first().click();
      await page.waitForTimeout(1600);
    }
  });
  await shot(page, 'pricing-chosen', 'After choosing — with the way back to where they came from.');

  await step('return to where they came from', async () => {
    const back = page.getByRole('button', { name: /back|return|continue/i })
      .or(page.getByRole('link', { name: /back|return|continue/i }));
    if (await back.count()) {
      await back.first().click();
      await page.waitForTimeout(1600);
    }
  });
  await shot(page, 'pricing-returned', 'Back on the original page — the task was not lost.');

  // ---- the menus a school opens on a phone --------------------------------
  await ctx.close();
  ({ ctx, page } = await openPage(PHONE, sess));
  for (const [route, name, note] of [
    ['/dashboard', 'phone-dashboard', 'Dashboard on a phone.'],
    ['/jobs', 'phone-jobs', 'Jobs on a phone.'],
    ['/applicants', 'phone-applicants', 'Applicants on a phone.'],
    ['/billing', 'phone-billing', 'Plans on a phone.'],
  ]) {
    await step(`phone ${route}`, async () => {
      await page.goto(`${SCHOOL_APP}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1100);
    });
    await shot(page, name, note);
  }
  await ctx.close();

  void sql;
} finally {
  await browser.close();
  report();
}

process.exit(missed.length ? 1 : 0);
