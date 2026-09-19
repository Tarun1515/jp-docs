/*
  SWAGGER GUARD — both APIs' OpenAPI documents build, parse, and did not shrink.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS
  ----------------------------------------------------------------------------
  /swagger/v1/swagger.json on the Application API answered 500 for every
  endpoint — not just the one that tripped it — from Phase 2.5 until Phase 4B
  found it. Two DTOs named PlanSummaryDto (the dashboard's and the admin
  matrix's) collided on Swashbuckle's default short-name schema ids, and the
  generator abandons the WHOLE document on the first collision.

  ⚠️ Every suite was green the entire time. None of them fetches swagger.json:
  they call the endpoints directly, which work perfectly well without a
  document. The API was broken in a way the tests were shaped not to look at.

  ----------------------------------------------------------------------------
  WHAT IS ASSERTED, AND WHY EACH PART
  ----------------------------------------------------------------------------
    200            — a schema collision returns 500, which is the loud case.
    parses as JSON — a 200 carrying an error envelope would otherwise pass.
    operation count >= baseline
                   — 🔴 the QUIET case. If a controller stops being discovered
                     — a routing mistake, an accidental [ApiExplorerSettings],
                     a class that stops being public — the document still
                     returns 200 and still parses. It is simply smaller, and
                     nothing else in the build would notice.

  ⚠️ The baselines are a FLOOR, not an equality. Adding endpoints is normal and
  must not fail this; losing them is not. When endpoints are deliberately
  removed, lower the number in the same commit and say why.

  Run (both APIs up): node scripts/verify/swagger.mjs
*/

const APIS = [
  {
    name: 'JP.Sso.Api',
    url: 'http://localhost:5199/swagger/v1/swagger.json',

    // Baseline recorded 2026-08-28 (Phase 4B). Auth, users, roles,
    // permissions, menus, health.
    minOperations: 21,
  },
  {
    name: 'JP.App.Api',
    url: 'http://localhost:5299/swagger/v1/swagger.json',

    /*
      Baseline first recorded 2026-08-28 (Phase 4B), the first run in which
      this document could be generated at all: 76.

      🔴 RAISED TO 89 ON 2026-09-19 (PHASE 5A — applications backend), in the
      same change that added the routes, which is what the rule above asks for.
      The thirteen are five school-side (`/api/applicants` ×2, `{id}`,
      `{id}/resume`, `{id}/status`) and eight teacher-side (`/api/teacher/jobs`
      ×2 + `{id}/save` + `/saved`, `/api/teacher/applications` ×3 + `{id}`).

      ⚠️ Raising the floor is the whole value of this guard. Leaving it at 76
      would mean all thirteen could silently disappear again and this suite
      would still be green.
    */
    minOperations: 89,
  },
];

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head']);

for (const api of APIS) {
  console.log(`\n=== ${api.name} ===`);

  let response;
  try {
    response = await fetch(api.url);
  } catch (error) {
    check(`${api.name}: the document is reachable`, false, `${error.message} — is the API running?`);
    continue;
  }

  const text = await response.text();

  check(`${api.name}: /swagger/v1/swagger.json returns 200`,
    response.status === 200,
    response.status === 200 ? 'HTTP 200' : `HTTP ${response.status} — ${text.slice(0, 200)}`);

  let doc = null;
  try {
    doc = JSON.parse(text);
  } catch {
    /* handled by the assertion below */
  }

  /*
    ⚠️ Parsing matters on its own. The 500 this guard was written for came back
    as a perfectly well-formed Response envelope — a body-shape check alone
    would have called it healthy.
  */
  check(`${api.name}: …and parses as an OpenAPI document`,
    doc !== null && typeof doc.paths === 'object',
    doc === null ? 'not JSON' : `openapi ${doc.openapi ?? '?'}, ${Object.keys(doc.paths ?? {}).length} paths`);

  if (!doc?.paths) continue;

  const operations = Object.values(doc.paths)
    .flatMap((path) => Object.keys(path).filter((k) => METHODS.has(k.toLowerCase())));

  const schemaCount = Object.keys(doc.components?.schemas ?? {}).length;

  console.log(`    ${operations.length} operations · ${schemaCount} schemas`);

  check(`${api.name}: at least ${api.minOperations} operations — nothing vanished`,
    operations.length >= api.minOperations,
    `${operations.length} found, floor ${api.minOperations}`);

  // Every schema id must be unique by construction; a duplicate is what broke
  // this in the first place, and JSON would silently keep only the last one.
  const schemaIds = Object.keys(doc.components?.schemas ?? {});
  check(`${api.name}: schema ids are unique`,
    new Set(schemaIds).size === schemaIds.length,
    `${schemaIds.length} ids, ${new Set(schemaIds).size} distinct`);
}

/*
  🔴 The endpoint that started this, asserted by name.

  A guard that only counts would still pass if this one operation disappeared
  while another was added. It is named because it is the one that failed.
*/
try {
  const doc = await (await fetch(APIS[1].url)).json();
  const matrix = doc?.paths?.['/api/entitlements/matrix']?.get;
  const stats = doc?.paths?.['/api/jobs/stats']?.get;

  check('the entitlement matrix operation is documented',
    !!matrix, matrix ? `operationId ${matrix.operationId ?? '(none)'}` : 'MISSING');
  check('…and so is the job stats endpoint added in 4B',
    !!stats, stats ? `operationId ${stats.operationId ?? '(none)'}` : 'MISSING');

  /*
    🔴 Phase 5A's two sides, named.

    A count alone would still pass if the whole teacher surface vanished and
    thirteen school routes appeared. These two are the ones the phase exists
    for: the school reading an applicant (where the contact block lives) and
    the teacher applying (consent path 1 — 2.56).
  */
  const applicant = doc?.paths?.['/api/applicants/{applicationId}']?.get;
  const apply = doc?.paths?.['/api/teacher/applications']?.post;
  const resume = doc?.paths?.['/api/applicants/{applicationId}/resume']?.get;

  check('the applicant detail operation is documented (Phase 5A)',
    !!applicant, applicant ? 'present' : 'MISSING');
  check('…and the apply operation — consent path 1 (2.56)',
    !!apply, apply ? 'present' : 'MISSING');
  check('…and the resume snapshot fetch, which RESUME.DOWNLOAD gates',
    !!resume, resume ? 'present' : 'MISSING');
} catch (error) {
  check('the entitlement matrix operation is documented', false, error.message);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
