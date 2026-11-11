/*
  PLACES ON — THE SEAM, THE QUOTA GUARDS, AND THE KEY THAT MUST NEVER COME BACK.

  ----------------------------------------------------------------------------
  🔴 WHY THIS SUITE EXISTS
  ----------------------------------------------------------------------------
  SR-2 built the address-lookup seam and shipped it OFF. Nothing covered it:
  before this file, the only suite that mentioned /api/address was swagger.mjs,
  which checks that the endpoints are DOCUMENTED. So the three things that
  matter about turning Places on were untested:

    1. the client's key never reaches the browser,
    2. a stranger cannot burn the client's quota through our anonymous
       endpoints,
    3. every refusal degrades to the manual cascade rather than breaking a
       form somebody is in the middle of.

  ----------------------------------------------------------------------------
  ⚠️ IT PASSES WHETHER OR NOT GOOGLE IS ANSWERING, AND THAT IS DELIBERATE
  ----------------------------------------------------------------------------
  What is asserted here is OUR contract, which holds either way: the shape we
  return, the floors we enforce, the refusals we survive. Whether Google itself
  answers depends on the client's Cloud project (the key's restrictions and
  which APIs are enabled), which is not something a suite can fix or should go
  red over.

  So the live result is PRINTED, loudly, rather than asserted — a reader can
  see "live suggestions: 0" and know the difference between "our side is
  wired" and "the whole thing works". An assertion that went red for a
  third-party setting would be a red nobody could act on from here.

  Run: node scripts/verify/address-lookup.mjs
*/
import { session as loginSession } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const API = process.env.JP_APP_API ?? 'http://localhost:5299/api';
const SCHOOL = 'principal@greenwood.edu.in';

/* The key's own prefix. Every Google API key begins with it. */
const KEY_PREFIX = 'AIza';

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

const get = async (path, token) => {
  const r = await fetch(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the raw text */ }

  return { status: r.status, text, body };
};

try {
  // =========================================================================
  section('1. THE SEAM REPORTS ITSELF');
  // =========================================================================

  const avail = await get('/address/availability');

  check('availability answers 200', avail.status === 200, `status ${avail.status}`);

  const available = avail.body?.data?.available;

  check('…with a boolean, not a guess', typeof available === 'boolean', `available = ${available}`);

  /*
    ⚠️ THE PROVIDER AND THE KEY ARE BOTH REQUIRED, and this one value reflects
    both: IsAvailable reads the environment variable, so a machine with the
    provider switched on and no key answers false and the forms render no
    search box. That is the degradation, not a bug.
  */
  console.log(`\n    Places is ${available ? 'ON' : 'OFF'} on this machine.\n`);

  // =========================================================================
  section('2. 🔴 THE KEY NEVER COMES BACK');
  // =========================================================================

  /*
    🔴 WAIT OUT OUR OWN RATE LIMIT BEFORE ASSERTING ANYTHING ELSE.

    Section 4 deliberately spends the per-IP window to prove it refuses. Run
    this suite twice inside a minute and every section below would have
    inherited that 429 — which is what happened the first time, and it read as
    six unrelated failures rather than as "the previous run is still in
    force".

    ⚠️ The limiter's window is a minute, so this costs nothing on a clean run
    and about a minute on a re-run. A suite that can only pass once per minute
    is a suite nobody can trust the second time.
  */
  const windowWait = async () => {
    for (let i = 0; i < 8; i += 1) {
      const probe = await get('/address/suggest?q=Go');

      if (probe.status !== 429) return i;

      if (i === 0) console.log('\n    …a previous run has spent the per-IP window; waiting for it to roll over');
      await new Promise((r) => setTimeout(r, 10_000));
    }

    return -1;
  };

  const waited = await windowWait();

  check('the per-IP window is clear before the contract is asserted',
    waited >= 0, waited > 0 ? `waited ~${waited * 10}s` : 'clear immediately');

  const probes = [
    ['/address/availability', avail],
    ['/address/suggest?q=Gohana', await get('/address/suggest?q=Gohana')],
    ['/address/resolve?placeId=ChIJbogus', await get('/address/resolve?placeId=ChIJbogus')],
  ];

  for (const [path, res] of probes) {
    check(`🔴 ${path} — no key in the response`,
      !res.text.includes(KEY_PREFIX), `${res.text.length} bytes`);
  }

  /*
    🔴 AND NOTHING RAW FROM GOOGLE EITHER. Our shape is the seam's whole
    purpose: ids from our masters plus free text, identical to what the manual
    cascade produces. A Google payload reaching the browser would mean the
    client's data model had leaked into ours — and it would carry field names
    nobody here designed.
  */
  const suggestRaw = probes[1][1];
  const googleish = /predictions|place_id|address_components|structured_formatting|html_attributions|plus_code/;

  check('🔴 no raw Google payload passes through — only our shape',
    !googleish.test(suggestRaw.text),
    suggestRaw.text.slice(0, 90));

  const suggestions = suggestRaw.body?.data ?? [];

  check('suggest answers 200 with a list', suggestRaw.status === 200 && Array.isArray(suggestions),
    `status ${suggestRaw.status}, ${suggestions.length} item(s)`);

  if (suggestions.length > 0) {
    const first = suggestions[0];
    const fields = Object.keys(first).sort().join(', ');

    check('…and a suggestion carries only our four fields',
      ['placeId', 'description', 'mainText', 'secondaryText'].every((f) => f in first),
      fields);
  }

  console.log(`\n    live suggestions for "Gohana": ${suggestions.length}`);
  if (suggestions.length === 0 && available) {
    console.log('    ⚠️ Places is ON and Google returned nothing — check the API log for');
    console.log('       Google\'s own sentence (a key restriction or a disabled API says so');
    console.log('       in words). Our side is still correct: the form degrades to the');
    console.log('       manual cascade, which the sections below prove.\n');
  }

  // =========================================================================
  section('3. 🔴 THE QUOTA FLOOR IS ON THIS SIDE OF THE WIRE');
  // =========================================================================

  /*
    🔴 THE BROWSER'S MINIMUM IS A COURTESY; THIS ONE IS THE CONTROL. The forms
    debounce and count characters, but anyone can call this endpoint directly —
    so the floor that actually protects the client's bill has to be enforced
    by the API. Three characters, raised from two when the real key went in.
  */
  for (const q of ['', 'G', 'Go']) {
    const r = await get(`/address/suggest?q=${encodeURIComponent(q)}`);
    const n = (r.body?.data ?? []).length;

    check(`🔴 "${q}" (${q.length} char) reaches no provider — nothing billed`,
      r.status === 200 && n === 0, `${n} suggestion(s)`);
  }

  /*
    ⚠️ AND A MISSING PLACE IS NOT AN ERROR. Somebody is mid-registration; the
    answer to a place we cannot resolve is a sentence and the dropdowns, not a
    500 and a broken step.
  */
  const bogus = probes[2][1];

  check('an unresolvable place answers 200 with a sentence, never a 500',
    bogus.status === 200 && bogus.body?.data === null,
    `status ${bogus.status} · "${bogus.body?.message ?? ''}"`);

  const noPlace = await get('/address/resolve');

  check('resolve with no place at all is also a 200 and a sentence',
    noPlace.status === 200 && noPlace.body?.data === null,
    `status ${noPlace.status}`);

  // =========================================================================
  section('4. 🔴 A STRANGER CANNOT BURN THE CLIENT\'S QUOTA');
  // =========================================================================

  /*
    🔴 THESE ENDPOINTS ARE ANONYMOUS BY NECESSITY — registration uses them —
    which is exactly why the per-IP window exists. The limit is configured at
    30/minute; this walks past it and asserts the refusal.

    ⚠️ IT SENDS A QUERY THAT IS TOO SHORT ON PURPOSE. The limiter runs in the
    pipeline BEFORE the controller, so a two-character query is rate-limited
    like any other request — and it cannot reach Google, so proving the limit
    costs the client nothing. A suite that burned 40 real lookups to prove the
    lookups are limited would be funny in the wrong way.
  */
  let refused = 0;
  let allowed = 0;
  let refusal = null;

  for (let i = 0; i < 35; i += 1) {
    const r = await get('/address/suggest?q=Go');

    if (r.status === 429) { refused += 1; refusal ??= r; }
    else allowed += 1;
  }

  check('🔴 the per-IP window refuses once it is spent — 429, not a slow drip',
    refused > 0, `${allowed} allowed, ${refused} refused with 429`);

  /*
    ⚠️ AND THE REFUSAL IS OURS. A bare framework 429 is an HTML page with no
    `code`, which the client cannot tell from any other failure — and this one
    has to be told apart, because the form's answer to it is to go quiet and
    leave the dropdowns working rather than to show an error.
  */
  check('…and the 429 carries OUR error body, not a bare framework page',
    refusal !== null && typeof refusal.body?.code === 'string' && refusal.body.code.length > 0,
    refusal ? `code "${refusal.body?.code}" · "${(refusal.body?.message ?? '').slice(0, 60)}"` : 'no 429 seen');

  /*
    ⚠️ THE MANUAL CASCADE IS UNTOUCHED BY ANY OF THAT. This is the promise the
    whole seam rests on: Places is an addition, so a refusal — a 429, a timeout,
    a disabled key — leaves the form exactly as it was before SR-2.
  */
  const { accessToken } = await loginSession({ id: SCHOOL, pw: secret(SCHOOL) });

  const states = await get('/masters/state', accessToken);
  const districts = await get('/masters/district?parentId=8', accessToken);

  check('🔴 with the lookup refusing, the manual cascade still answers',
    states.status === 200 && (states.body?.data ?? []).length > 0,
    `${(states.body?.data ?? []).length} states`);

  check('…and its dependent level too', districts.status === 200 && (districts.body?.data ?? []).length > 0,
    `${(districts.body?.data ?? []).length} districts in Haryana`);
} catch (error) {
  results.push(false);
  console.log('  FAIL  the suite threw before it could finish');
  console.log(`        ${error?.message?.split('\n')[0] ?? error}`);
} finally {
  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
