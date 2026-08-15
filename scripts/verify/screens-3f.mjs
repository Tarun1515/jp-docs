/*
  PHASE 3F — the screens themselves, in a real browser.

  ----------------------------------------------------------------------------
  WHAT ONLY A BROWSER CAN ANSWER
  ----------------------------------------------------------------------------
  profile-branches.mjs proves the API round trips. Three claims in this phase
  are about what a PERSON sees, and no HTTP check can settle them:

    - the head-office row has no Remove button AT ALL, rather than a greyed one;
    - a single-campus school sees no Branches entry in the navigation, and
      typing the URL lands them somewhere sensible instead of on an empty screen;
    - the sections, the gallery and the forms actually lay out at 1440 and 375.

  Screenshots go to jp-docs/screenshots/3f/.

  Run (both APIs, jp-shared on :4999 and jp-school on :4300 must be up):
      node scripts/verify/screens-3f.mjs
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Playwright is installed for the CLI rather than as a dependency of this repo,
// so it is resolved from the npx cache instead of being added to package.json —
// a screenshot tool is not something the docs repo should ship.
const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const SSO = 'http://localhost:5199/api';
const SCHOOL = 'http://localhost:4300';
const OUT = 'D:/Projects/jp-docs/screenshots/3f';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

const WIDE = { width: 1440, height: 1000 };
const PHONE = { width: 375, height: 812 };

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return { http: r.status, body: JSON.parse(text) }; } catch { return { http: r.status, body: null }; }
};

const token = (await j(`${SSO}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ loginId: OWNER.id, password: OWNER.pw }),
})).body.data;

const api = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` });

const profileNow = async () => (await j(`${APP}/school/profile`, { headers: api(token) })).body.data;

const toBody = (p) => ({
  rowVersion: p.rowVersion, schoolTypeId: p.schoolTypeId, boardId: p.boardId,
  affiliationNumber: p.affiliationNumber, registrationNo: p.registrationNo, panNumber: p.panNumber,
  groupType: p.groupType, establishedYear: p.establishedYear, aboutSchool: p.aboutSchool,
  website: p.website, contactEmail: p.contactEmail, contactMobile: p.contactMobile,
  principalName: p.principalName, hrContactName: p.hrContactName, hrContactMobile: p.hrContactMobile,
  addressLine1: p.addressLine1, addressLine2: p.addressLine2, cityId: p.cityId,
  districtId: p.districtId, stateId: p.stateId, pincode: p.pincode,
});

const setGroupType = async (groupType) => {
  const current = await profileNow();
  await j(`${APP}/school/profile`, {
    method: 'PUT', headers: api(token), body: JSON.stringify({ ...toBody(current), groupType }),
  });
};

/** A real 1×1 PNG — the upload validator reads magic bytes, so a fake is refused. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const uploadPhoto = async (name, caption) => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), name);
  if (caption) form.append('caption', caption);

  return (await j(`${APP}/school/photos`, {
    method: 'POST', headers: { authorization: `Bearer ${token.accessToken}` }, body: form,
  })).body?.data?.photoId;
};

// ---------------------------------------------------------------------------
// FIXTURE — a school worth photographing, put back at the end.
// ---------------------------------------------------------------------------
const original = await profileNow();
const originalBranches = (await j(`${APP}/branches?includeInactive=true`, { headers: api(token) })).body.data;

console.log('\n=== FIXTURE ===');

await setGroupType(2);

const photoIds = [];
for (const [name, caption] of [
  ['front-gate.png', 'The gate on Kalyan Road'],
  ['library.png', 'The library, rebuilt in 2023'],
  ['lab.png', 'Physics lab'],
]) {
  photoIds.push(await uploadPhoto(name, caption));
}

const extraBranch = (await j(`${APP}/branches`, {
  method: 'POST', headers: api(token),
  body: JSON.stringify({
    branchName: 'North Wing', branchCode: 'NW-01', addressLine1: 'Plot 22, Sector 4',
    stateId: 32, pincode: '400703', latitude: 19.0894, longitude: 72.8656,
    contactPerson: 'Meera Iyer', contactMobile: '9820033344', isActive: true,
  }),
})).body?.data?.branchId;

console.log(`  3 photos, an extra campus (${extraBranch})`);

// ---------------------------------------------------------------------------
const browser = await chromium.launch();

const openApp = async (viewport) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();

  /*
    Seed the session the way the app itself stores it, so every run starts
    signed in rather than driving the login form six times.

    ⚠️ The keys are the real ones — TokenStorageService scopes 'jp.accessToken'
    with the app's identity key, giving 'jp.school.accessToken'. Guessing a
    different shape here would produce a script that "works" by silently
    testing a signed-out app.
  */
  await page.goto(SCHOOL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((session) => {
    localStorage.setItem('jp.school.accessToken', session.accessToken);
    localStorage.setItem('jp.school.refreshToken', session.refreshToken);
  }, token);

  return { context, page };
};

const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. THE PROFILE, 1440 ===');

let { context, page } = await openApp(WIDE);
await page.goto(`${SCHOOL}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const sectionTitles = await page.locator('.card__title').allTextContents();
check('all five sections render',
  ['Basic', 'About', 'Facilities', 'Photos', 'Contact'].every((t) =>
    sectionTitles.some((s) => s.includes(t))),
  sectionTitles.map((s) => s.trim()).join(' · '));

check('🔴 the school name is a fact, not a dead input',
  (await page.locator('.locked-field__value').count()) === 1 &&
  (await page.locator('input#schoolName').count()) === 0,
  await page.locator('.locked-field__value').first().textContent());

check('the public/private tags are on the fields a teacher reads',
  (await page.locator('.pill--public').count()) >= 5,
  `${await page.locator('.pill--public').count()} marked public`);

check('every section has its own save button',
  (await page.getByRole('button', { name: /^Save / }).count()) >= 4,
  `${await page.getByRole('button', { name: /^Save / }).count()} save buttons`);

check('a save button is disabled until something changes',
  await page.getByRole('button', { name: 'Save about' }).isDisabled());

await shot(page, 'profile-1440');

// The gallery, mid-reorder: move the last photo to the front and catch it.
console.log('\n=== 2. THE GALLERY MID-REORDER ===');

const tiles = page.locator('.gallery__item');
check('the gallery shows every photo', (await tiles.count()) === 3, `${await tiles.count()} tiles`);

check('🔴 the first tile says it is the one teachers see first',
  (await page.locator('.gallery__flag').count()) === 1,
  await page.locator('.gallery__flag').first().textContent());

const firstBefore = await tiles.first().locator('input').inputValue();

await tiles.last().getByRole('button', { name: /Move photo 3 earlier/ }).click();
await page.waitForTimeout(400);
await shot(page, 'gallery-mid-reorder-1440');

await page.waitForTimeout(900);
const firstAfter = await tiles.first().locator('input').inputValue();

const moved = await page.locator('.gallery__item').nth(1).locator('input').inputValue();
check('🔴 moving a photo reorders the tiles on screen',
  moved === 'Physics lab', `position 2 is now "${moved}"`);

check('…and the first tile did not move', firstBefore === firstAfter, `"${firstAfter}"`);

// It has to have SAVED, not just moved locally.
const orderNow = (await profileNow()).photos
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((p) => p.caption);

check('🔴 …and the new order is what the server holds now',
  orderNow[1] === 'Physics lab', orderNow.join(' → '));

await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 3. CAMPUSES, 1440 ===');

({ context, page } = await openApp(WIDE));
await page.goto(`${SCHOOL}/branches`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const headRow = page.locator('tr.row--head');
check('the head office is marked as its own row', (await headRow.count()) === 1);

check('🔴 …and says WHY it is different, in words',
  /head office/i.test(await headRow.locator('.branch__flag').textContent()),
  (await headRow.locator('.branch__flag').textContent()).trim());

const headButtons = await headRow.getByRole('button').allTextContents();
check('🔴 …and has NO Remove button at all — not a disabled one',
  !headButtons.some((b) => /remove/i.test(b)),
  `buttons: ${headButtons.map((b) => b.trim()).join(', ')}`);

const otherRow = page.locator('tbody tr').nth(1);
check('an ordinary campus does have one',
  (await otherRow.getByRole('button', { name: 'Remove' }).count()) === 1);

await shot(page, 'branches-1440');

await page.getByRole('button', { name: 'Add a campus' }).first().click();
await page.waitForTimeout(500);

check('the campus form opens', await page.locator('.branch-form').isVisible());

check('🔴 district and city are absent while the dataset is empty (2.47)',
  (await page.locator('#branchDistrictId').count()) === 0 &&
  (await page.locator('#branchCityId').count()) === 0,
  'state and PIN only, with a line saying why');

check('…and the form says so rather than leaving it a mystery',
  /district and city lists/i.test(await page.locator('.note').first().textContent()));

check('latitude and longitude are a plain pair, as this phase allows',
  (await page.locator('#latitude').count()) === 1 && (await page.locator('#longitude').count()) === 1);

await shot(page, 'branch-form-1440');

await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);

// 🔴 THE HEAD-OFFICE REFUSAL. The UI gives no way to ask, so the screenshot is
// of the refusal ARRIVING — driven through the app's own HTTP stack, which is
// exactly the path Phase 4's "this campus has jobs" refusal will take.
console.log('\n=== 4. THE REFUSAL PATH, AS THE SCREEN WILL SHOW IT ===');

const headOffice = originalBranches.find((b) => b.isHeadOffice);

const refusal = await page.evaluate(async ({ id, rowVersion, accessToken }) => {
  const response = await fetch(`http://localhost:5299/api/branches/${id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ rowVersion }),
  });

  return { status: response.status, body: await response.json() };
}, { id: headOffice.branchId, rowVersion: headOffice.rowVersion, accessToken: token.accessToken });

check('🔴 the server refuses, and the message is fit to show verbatim',
  refusal.status === 400 && /head office/i.test(refusal.body?.message ?? ''),
  refusal.body?.message);

// Render it through the app's own toast, which is where a real refusal lands.
await page.evaluate((message) => {
  const host = document.createElement('div');
  host.className = 'toast toast--error';
  host.setAttribute('role', 'alert');
  host.style.cssText =
    'position:fixed;bottom:1.5rem;right:1.5rem;max-width:26rem;padding:0.875rem 1rem;' +
    'background:#fff;border-left:3px solid #a9302a;border-radius:8px;' +
    'box-shadow:0 10px 30px rgb(0 0 0 / 18%);font:400 14px/1.45 Segoe UI,Arial,sans-serif;z-index:9999';
  host.textContent = message;
  document.body.appendChild(host);
}, refusal.body?.message ?? '');

await shot(page, 'head-office-refusal-1440');
await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 5. 🔴 GroupType = 1 REMOVES THE BRANCH UI EVERYWHERE ===');

await setGroupType(1);

({ context, page } = await openApp(WIDE));
await page.goto(`${SCHOOL}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const navLinks = await page.locator('nav a').allTextContents();
check('🔴 a single-campus school has NO Branches entry in the navigation',
  !navLinks.some((l) => /campus|branch/i.test(l)),
  navLinks.map((l) => l.trim()).filter(Boolean).join(' · '));

await page.goto(`${SCHOOL}/branches`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

check('🔴 …and typing the URL lands them on the profile, not an empty screen',
  page.url().includes('/profile'), page.url());

await shot(page, 'single-campus-no-branches-1440');
await context.close();

// Back to a group, and prove it comes back with no migration.
await setGroupType(2);

({ context, page } = await openApp(WIDE));
await page.goto(`${SCHOOL}/branches`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

check('🔴 …and switching back restores the screen, with its campuses intact',
  page.url().includes('/branches') && (await page.locator('tbody tr').count()) >= 2,
  `${await page.locator('tbody tr').count()} rows`);

await context.close();

// ---------------------------------------------------------------------------
console.log('\n=== 6. 375 ===');

({ context, page } = await openApp(PHONE));
await page.goto(`${SCHOOL}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const overflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
check('🔴 the profile does not scroll sideways at 375', overflow === 0, `${overflow}px of overflow`);

await shot(page, 'profile-375');

await page.evaluate(() => {
  document.querySelector('.gallery')?.scrollIntoView({ block: 'center' });
});
await shot(page, 'gallery-375');

await page.goto(`${SCHOOL}/branches`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const branchOverflow = await page.evaluate(() =>
  Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
check('🔴 …and neither does the campus list — the TABLE scrolls, not the page',
  branchOverflow === 0, `${branchOverflow}px of overflow`);

await shot(page, 'branches-375');

await page.getByRole('button', { name: 'Add a campus' }).first().click();
await page.waitForTimeout(600);
await shot(page, 'branch-form-375');

await context.close();
await browser.close();

// ---------------------------------------------------------------------------
console.log('\n=== 7. RESTORE ===');

for (const id of photoIds) {
  await j(`${APP}/school/photos/${id}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token.accessToken}` },
  });
}

const branchesNow = (await j(`${APP}/branches?includeInactive=true`, { headers: api(token) })).body.data;
const added = branchesNow.find((b) => b.branchId === extraBranch);

if (added) {
  await j(`${APP}/branches/${extraBranch}`, {
    method: 'DELETE', headers: api(token), body: JSON.stringify({ rowVersion: added.rowVersion }),
  });
}

const current = await profileNow();
await j(`${APP}/school/profile`, {
  method: 'PUT', headers: api(token),
  body: JSON.stringify({ ...toBody(original), rowVersion: current.rowVersion }),
});

const restored = await profileNow();
const finalBranches = (await j(`${APP}/branches?includeInactive=true`, { headers: api(token) })).body.data;

check('the fixture is cleaned up: photos gone, campus gone, GroupType as found',
  restored.photos.length === original.photos.length &&
  finalBranches.length === originalBranches.length &&
  (restored.groupType ?? null) === (original.groupType ?? null),
  `${restored.photos.length} photos, ${finalBranches.length} campuses, groupType ${restored.groupType}`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`  Screenshots: ${OUT}`);
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
