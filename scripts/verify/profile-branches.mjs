/*
  PHASE 3F — live verification of the school profile and campus screens.

  ----------------------------------------------------------------------------
  WHAT THIS PROVES THAT A BUILD DOES NOT
  ----------------------------------------------------------------------------
  Every claim about a round trip is checked by SAVING, RE-READING, and comparing
  — not by watching a request return 200. Three things in this phase can only
  fail on the way back:

    - RowVersion. A conflict has to be REFUSED, and the refusal has to reach the
      screen. A save that quietly wins is the bug.

    - Photo order. The server used to sort the ids it was given and write
      insertion order while reporting success (3F found it). So the order is
      read back, not assumed.

    - The head office. Its delete must be refused with a message worth showing.

  Run: node scripts/verify/profile-branches.mjs   (both APIs up)
*/
import { execFileSync } from 'node:child_process';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-h', '-1', '-W', '-Q', q], {
    encoding: 'utf8',
  }).trim();

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }
  return { http: r.status, body, text };
};

const login = async (loginId, password) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });
  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message ?? r.text}`);
  return r.body.data.accessToken;
};

const auth = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
const head = (t) => ({ authorization: `Bearer ${t}` });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * The smallest valid PNG that is a real image.
 *
 * ⚠️ It has to be a REAL one: the upload validator reads magic bytes, so a text
 * file renamed .png is refused — which is the point of that check, and means
 * this fixture is exercising the same path a school's photo takes.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const uploadPhoto = async (token, name) => {
  const form = new FormData();
  form.append('file', new Blob([PNG_1X1], { type: 'image/png' }), name);

  return j(`${APP}/school/photos`, { method: 'POST', headers: head(token), body: form });
};

const token = await login(OWNER.id, OWNER.pw);
const read = async () => (await j(`${APP}/school/profile`, { headers: head(token) })).body?.data;

// ---------------------------------------------------------------------------
console.log('\n=== 1. THE PROFILE ROUND TRIP — SAVE, RELOAD, COMPARE ===');

const before = await read();
check('GET /school/profile returns the caller’s own school', !!before?.schoolId,
  `${before?.schoolName} · RowVersion ${before?.rowVersion}`);

const stamp = Date.now().toString().slice(-5);

const edited = {
  ...toBody(before),
  aboutSchool: `We teach 1,400 children across two campuses. Test ${stamp}.`,
  website: `https://greenwood-${stamp}.example.edu.in`,
  contactMobile: '9820011122',
  principalName: `Vandana Rao ${stamp}`,
  addressLine1: `Plot ${stamp}, Sector 9`,
  pincode: '400703',
  establishedYear: 1994,
};

const saved = await j(`${APP}/school/profile`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify(edited),
});
check('PUT /school/profile accepts the edit', saved.http === 200, `${saved.http} · ${saved.body?.message}`);

const after = await read();

check('🔴 …and every edited field came back changed after a RELOAD',
  after.aboutSchool === edited.aboutSchool &&
  after.website === edited.website &&
  after.contactMobile === edited.contactMobile &&
  after.principalName === edited.principalName &&
  after.addressLine1 === edited.addressLine1 &&
  after.pincode === edited.pincode &&
  after.establishedYear === edited.establishedYear,
  `about, website, phone, principal, address, PIN, year`);

check('…and RowVersion moved, which is what makes the next conflict detectable',
  after.rowVersion === before.rowVersion + 1,
  `${before.rowVersion} → ${after.rowVersion}`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. 🔴 THE ROWVERSION CONFLICT IS REFUSED, NOT SWALLOWED ===');

// Two people with the same screen open. The second save carries the RowVersion
// the first one has already consumed.
const stale = await j(`${APP}/school/profile`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ ...toBody(after), rowVersion: before.rowVersion, principalName: 'Should never land' }),
});

check('a save carrying a stale RowVersion is refused', stale.http === 409,
  `${stale.http} · ${stale.body?.code}`);

check('🔴 …with a message a person can act on', /reload/i.test(stale.body?.message ?? ''),
  stale.body?.message);

const unchanged = await read();
check('🔴 …and the other person’s value is still there', unchanged.principalName === edited.principalName,
  unchanged.principalName);

// ---------------------------------------------------------------------------
console.log('\n=== 3. FACILITIES — A FULL SET, WHICH IS SAFE HERE ===');

const twoFacilities = await j(`${APP}/school/facilities`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ branchId: null, facilityIds: [1, 2] }),
});
check('PUT /school/facilities saves the ticked set', twoFacilities.http === 200);

let facilities = (await read()).facilityIds;
check('…and both come back', facilities.includes(1) && facilities.includes(2),
  `[${facilities.join(', ')}]`);

await j(`${APP}/school/facilities`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ branchId: null, facilityIds: [1] }),
});

facilities = (await read()).facilityIds;
check('🔴 sending a SHORTER set removes the one left out — it is a sync, not an add',
  facilities.includes(1) && !facilities.includes(2), `[${facilities.join(', ')}]`);

// ---------------------------------------------------------------------------
console.log('\n=== 4. 🔴 THE GALLERY — UPLOAD, ORDER, CAPTION, DELETE ===');

const uploads = [];
for (const name of ['front-gate.png', 'library.png', 'science-lab.png']) {
  const r = await uploadPhoto(token, name);
  uploads.push(r.body?.data?.photoId);
}

check('three photos upload', uploads.every((id) => !!id), `ids ${uploads.join(', ')}`);

let photos = (await read()).photos.sort((a, b) => a.displayOrder - b.displayOrder);
const mine = photos.filter((p) => uploads.includes(p.photoId));
check('…and they are in the gallery, in upload order',
  mine.length === 3 && mine[0].photoId === uploads[0], `${photos.length} photos in total`);

// The bytes. Nothing could display an uploaded image before 3F added this.
const file = await fetch(`${APP}/school/photos/${uploads[0]}/file`, { headers: head(token) });
const bytes = Buffer.from(await file.arrayBuffer());
check('🔴 GET /school/photos/{id}/file returns the actual image',
  file.status === 200 && bytes.length === PNG_1X1.length && bytes[1] === 0x50,
  `${file.status} · ${file.headers.get('content-type')} · ${bytes.length} bytes`);

// 🔴 The reorder. Ask for the LAST one first — an order the ids alone can
// never produce, which is exactly what the old procedure always wrote.
const wanted = [uploads[2], uploads[0], uploads[1]];
const reordered = await j(`${APP}/school/photos/order`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ photoIds: wanted }),
});
check('PUT /school/photos/order is accepted', reordered.http === 200);

photos = (await read()).photos
  .filter((p) => uploads.includes(p.photoId))
  .sort((a, b) => a.displayOrder - b.displayOrder);

check('🔴 …and the gallery comes back IN THE ORDER ASKED FOR',
  photos.map((p) => p.photoId).join(',') === wanted.join(','),
  `asked ${wanted.join(',')} · got ${photos.map((p) => p.photoId).join(',')}`);

const captioned = await j(`${APP}/school/photos/${uploads[0]}/caption`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ caption: 'The front gate on a Monday' }),
});
check('a caption saves', captioned.http === 200);

photos = (await read()).photos;
const one = photos.find((p) => p.photoId === uploads[0]);
check('…and comes back on the right photo, with its order untouched',
  one?.caption === 'The front gate on a Monday' && one?.displayOrder === 2,
  `"${one?.caption}" at position ${one?.displayOrder}`);

for (const id of uploads) {
  await j(`${APP}/school/photos/${id}`, { method: 'DELETE', headers: head(token) });
}

photos = (await read()).photos;
check('deleting removes them from the gallery',
  photos.every((p) => !uploads.includes(p.photoId)), `${photos.length} left`);

check('🔴 …but the rows are SOFT-deleted, not erased',
  sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4)) FROM jp_app.dbo.t_app_school_photos
       WHERE PhotoId IN (${uploads.join(',')}) AND Is_Deleted = 1`) === '3',
  '3 rows kept with Is_Deleted = 1');

// ---------------------------------------------------------------------------
console.log('\n=== 5. CAMPUSES — ADD, EDIT, AND THE REFUSALS ===');

const list = async () => (await j(`${APP}/branches?includeInactive=true`, { headers: head(token) })).body?.data ?? [];

const startingCount = (await list()).length;

const added = await j(`${APP}/branches`, {
  method: 'POST', headers: auth(token),
  body: JSON.stringify({
    branchName: `East Wing ${stamp}`, branchCode: `EW-${stamp}`,
    addressLine1: 'Plot 4, Sector 12', stateId: 32, pincode: '400705',
    latitude: 19.07609, longitude: 72.877426,
    contactPerson: 'Meera Iyer', contactMobile: '9820033344', isActive: true,
  }),
});
check('POST /branches adds a campus', added.http === 200 && !!added.body?.data?.branchId,
  `${added.http} · id ${added.body?.data?.branchId}`);

const newId = added.body?.data?.branchId;
let branches = await list();
const mineBranch = branches.find((b) => b.branchId === newId);

check('…and it reads back with everything that was sent',
  mineBranch?.branchName === `East Wing ${stamp}` &&
  mineBranch?.pincode === '400705' &&
  Number(mineBranch?.latitude) === 19.07609 &&
  mineBranch?.contactPerson === 'Meera Iyer',
  `${mineBranch?.branchName} · ${mineBranch?.latitude}, ${mineBranch?.longitude}`);

check('…and it is NOT the head office — a new campus never is',
  mineBranch?.isHeadOffice === false, `isHeadOffice ${mineBranch?.isHeadOffice}`);

/*
  🔴 isActive, CHECKED AGAINST THE ROW RATHER THAN ASSUMED.

  This is here because it was false for every campus the API had ever returned.
  `Is_Active` is one of the standard columns (2.4) and the only ones in this
  schema with an underscore in the name; Dapper does not strip underscores
  unless told to, so it never reached BranchDto.IsActive at all.

  It shipped in 3E and nothing rendered it until 3F put a status badge on the
  screen — at which point every campus read "Closed" while every row said 1.
  A SQL test could never have caught it: the procedure was always right.
*/
const storedActive = sql(`SET NOCOUNT ON; SELECT CAST(Is_Active AS varchar(3))
  FROM jp_app.dbo.t_app_school_branches WHERE BranchId = ${newId}`);

check('🔴 isActive survives the trip from the column to the JSON',
  mineBranch?.isActive === true && storedActive === '1',
  `row Is_Active=${storedActive} · json isActive=${mineBranch?.isActive}`);

const editedBranch = await j(`${APP}/branches/${newId}`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({
    rowVersion: mineBranch.rowVersion,
    branchName: `East Wing (renamed) ${stamp}`, branchCode: mineBranch.branchCode,
    addressLine1: mineBranch.addressLine1, stateId: 32, pincode: '400706',
    latitude: mineBranch.latitude, longitude: mineBranch.longitude,
    contactPerson: mineBranch.contactPerson, contactMobile: mineBranch.contactMobile,
    isActive: true,
  }),
});
check('PUT /branches/{id} edits it', editedBranch.http === 200);

branches = await list();
const afterEdit = branches.find((b) => b.branchId === newId);
check('…and the change survives a reload',
  afterEdit?.branchName === `East Wing (renamed) ${stamp}` && afterEdit?.pincode === '400706',
  `${afterEdit?.branchName} · ${afterEdit?.pincode}`);

const staleBranch = await j(`${APP}/branches/${newId}`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({
    rowVersion: mineBranch.rowVersion, branchName: 'Should never land', isActive: true,
    branchCode: null, addressLine1: null, addressLine2: null, cityId: null, districtId: null,
    stateId: 32, pincode: null, latitude: null, longitude: null,
    contactPerson: null, contactEmail: null, contactMobile: null,
  }),
});
check('🔴 a stale RowVersion on a campus is refused too', staleBranch.http === 409,
  `${staleBranch.http} · ${staleBranch.body?.code}`);

// 🔴 THE HEAD OFFICE.
const headOffice = branches.find((b) => b.isHeadOffice);
const refused = await j(`${APP}/branches/${headOffice.branchId}`, {
  method: 'DELETE', headers: auth(token),
  body: JSON.stringify({ rowVersion: headOffice.rowVersion }),
});

check('🔴 the head office cannot be deleted', refused.http === 400,
  `${refused.http} · ${refused.body?.code}`);

check('🔴 …and the refusal explains itself well enough to show verbatim',
  /head office/i.test(refused.body?.message ?? '') && /at least one campus/i.test(refused.body?.message ?? ''),
  refused.body?.message);

check('…and it is still there', (await list()).some((b) => b.branchId === headOffice.branchId));

const removed = await j(`${APP}/branches/${newId}`, {
  method: 'DELETE', headers: auth(token),
  body: JSON.stringify({ rowVersion: afterEdit.rowVersion }),
});
check('an ordinary campus can be removed', removed.http === 200, `${removed.http} · ${removed.body?.message}`);

check('…and the list is back to where it started',
  (await list()).length === startingCount, `${(await list()).length} campuses`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. 🔴 GroupType = 1 — ZERO MIGRATION, BOTH WAYS ===');

const beforeSwitch = await read();
const branchesBefore = (await list()).length;

await j(`${APP}/school/profile`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ ...toBody(beforeSwitch), groupType: 1 }),
});

const single = await read();
check('a school can declare itself single-campus', single.groupType === 1, `groupType ${single.groupType}`);

check('🔴 …and NOTHING happened to its campuses — the head office is untouched',
  (await list()).length === branchesBefore,
  `${branchesBefore} campus(es) before and after`);

await j(`${APP}/school/profile`, {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ ...toBody(single), groupType: 2 }),
});

const group = await read();
check('🔴 …and switching back is the same: one field, no migration',
  group.groupType === 2 && (await list()).length === branchesBefore,
  `groupType ${group.groupType}, ${branchesBefore} campus(es)`);

// ---------------------------------------------------------------------------
console.log('\n=== 7. RESTORE WHAT THIS RUN CHANGED ===');

const restored = await j(`${APP}/school/profile`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ ...toBody(await read()), ...toBody(before), rowVersion: (await read()).rowVersion }),
});
check('the profile is put back as it was found', restored.http === 200);

const final = await read();
check('…and reads back matching the values this run started with',
  (final.aboutSchool ?? null) === (before.aboutSchool ?? null) &&
  (final.website ?? null) === (before.website ?? null) &&
  (final.principalName ?? null) === (before.principalName ?? null) &&
  (final.groupType ?? null) === (before.groupType ?? null),
  `groupType ${final.groupType}, principal ${final.principalName}`);

await j(`${APP}/school/facilities`, {
  method: 'PUT', headers: auth(token),
  body: JSON.stringify({ branchId: null, facilityIds: before.facilityIds }),
});
check('…and so are the facilities',
  JSON.stringify((await read()).facilityIds.sort()) === JSON.stringify([...before.facilityIds].sort()),
  `[${before.facilityIds.join(', ')}]`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log('  FAILED:');
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);

/** The profile, as the update endpoint wants it. */
function toBody(profile) {
  return {
    rowVersion: profile.rowVersion,
    schoolTypeId: profile.schoolTypeId,
    boardId: profile.boardId,
    affiliationNumber: profile.affiliationNumber,
    registrationNo: profile.registrationNo,
    panNumber: profile.panNumber,
    groupType: profile.groupType,
    establishedYear: profile.establishedYear,
    aboutSchool: profile.aboutSchool,
    website: profile.website,
    contactEmail: profile.contactEmail,
    contactMobile: profile.contactMobile,
    principalName: profile.principalName,
    hrContactName: profile.hrContactName,
    hrContactMobile: profile.hrContactMobile,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    cityId: profile.cityId,
    districtId: profile.districtId,
    stateId: profile.stateId,
    pincode: profile.pincode,
  };
}
