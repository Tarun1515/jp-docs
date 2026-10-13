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

      🔴 RAISED TO 95 ON 2026-09-19 (PHASE 6A — Offer Lite), again in the same
      change that added the routes. The six are four school-side
      (`/api/applicants/{id}/offers` GET and POST, `/api/offers/{id}/withdraw`,
      `/api/applicants/{id}/hire`) and two teacher-side (`/api/teacher/offers`,
      `/api/teacher/offers/{id}/respond`).

      🔴 RAISED TO 101 ON 2026-09-19 (PHASE 6B — teacher search and invites).
      Three school-side (`/api/teacher-search`, and `/api/teacher-search/invites`
      GET and POST) and three teacher-side (`/api/teacher/invites`, plus
      `{id}/viewed` and `{id}/respond`).

      🔴 RAISED TO 105 ON 2026-10-11 (PHASE 6C — notifications), in the same
      change that added the routes. Four, and they belong to NO audience in
      particular: `/api/notifications`, `/api/notifications/unread-count`,
      `/api/notifications/{id}/read` and `/api/notifications/read-all`.

      ⚠️ That is the first controller here that is neither school-side nor
      teacher-side, and it is deliberate — a notification belongs to a PERSON,
      so a teacher, an owner and a viewer all read their own through the same
      four routes. There is no `?userUid=`, and 030 removed the column that
      would make a cross-user query expressible at all.

      🔴 RAISED TO 113 ON 2026-10-11 (PHASE 6.5A — billing, manual first), in
      the same change that added the routes. Eight, split by who may call them:

        the account's own    /api/billing/plans
                             /api/billing/my-plan
                             /api/billing/my-history
                             POST /api/billing/plan-change

        PAYMENT.VERIFY only  /api/billing/payments/pending
                             /api/billing/payments/{id}
                             POST /api/billing/payments/{id}/verify
                             /api/billing/owners/{ownerUid}/history

      ⚠️ The account-facing four take NO owner parameter — the owner comes from
      the token (2.39, 2.51), so there is nothing to tamper with. The admin four
      take one explicitly and are gated on a permission SUPER_ADMIN alone holds.

      🔴 THERE IS NO PAYMENT-GATEWAY ROUTE, and its absence is the design. Money
      arrives by NEFT, cheque or cash and an admin confirms it; the verify route
      IS the seam a gateway callback will later enter through
      (MONETIZATION_DESIGN 6.5-A). A stub "pay now" endpoint would be the
      mockup-era failure this project exists to avoid.

      🔴 RAISED TO 119 ON 2026-10-14 (PHASE 7A — the public face), in the same
      change that added the routes. Six, and they are the first on this API
      that NOBODY authenticates to reach:

        GET  /api/public/jobs              the listing, server-paged
        GET  /api/public/jobs/filters      reachable filter values + counts
        GET  /api/public/jobs/{jobUid}     one job, or 404
        GET  /api/public/faqs              admin-editable copy (2.81)
        GET  /api/public/content-blocks    admin-editable copy (2.81)
        POST /api/public/contact           the ONLY anonymous WRITE

      ⚠️ 119 WAS MEASURED, NOT CALCULATED. Adding six to a remembered 113 would
      agree with the measurement only by luck — earlier in this project a menu
      count was "fixed" by adding one to a stale 32 when the real figure was
      34, which confirmed the rot instead of correcting it. Both were computed
      this time, and they agreed.

      🔴 A GREP FOR "public" FINDS SEVEN, AND THE SEVENTH IS NOT ONE OF THESE.
      /api/schools/{uid}/public is a Phase 3 route that REQUIRES a token: it
      serves a school's public-facing profile to a signed-in teacher. Anyone
      auditing the anonymous surface by path name will find it and must not
      count it — what defines that surface is the absence of [Authorize] on
      PublicController, not the word in the URL.
    */
    minOperations: 119,
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

  /*
    🔴 Phase 6A's two sides, named for the same reason as 5A's.

    A count alone would pass if the whole teacher-facing half vanished and six
    school routes appeared. These two are what the phase is: a school making an
    offer, and the teacher answering it.
  */
  const sendOffer = doc?.paths?.['/api/applicants/{applicationId}/offers']?.post;
  const respond = doc?.paths?.['/api/teacher/offers/{offerId}/respond']?.post;
  const hire = doc?.paths?.['/api/applicants/{applicationId}/hire']?.post;

  check('the send-offer operation is documented (Phase 6A)',
    !!sendOffer, sendOffer ? 'present' : 'MISSING');
  check('…and the teacher\'s response — the other half of the machine',
    !!respond, respond ? 'present' : 'MISSING');
  check('…and confirm-hire, which OFFER.APPROVE gates separately from sending',
    !!hire, hire ? 'present' : 'MISSING');

  /*
    🔒 Phase 6B's two, and the second one is the phase.

    Search is where a school meets the whole teacher base; accepting an
    invitation is CONSENT PATH 2 — the second and final way a school ever
    reaches a teacher's contact details (2.56, LOCKED). A count alone would
    pass if either vanished.
  */
  const search = doc?.paths?.['/api/teacher-search']?.get;
  const sendInvite = doc?.paths?.['/api/teacher-search/invites']?.post;
  const respondInvite = doc?.paths?.['/api/teacher/invites/{inviteId}/respond']?.post;

  check('the teacher-search operation is documented (Phase 6B)',
    !!search, search ? 'present' : 'MISSING');
  check('…and sending an invitation — the metered half',
    !!sendInvite, sendInvite ? 'present' : 'MISSING');
  check('🔒 …and the teacher\'s response, which IS consent path 2',
    !!respondInvite, respondInvite ? 'present' : 'MISSING');
  check('…and the apply operation — consent path 1 (2.56)',
    !!apply, apply ? 'present' : 'MISSING');
  check('…and the resume snapshot fetch, which RESUME.DOWNLOAD gates',
    !!resume, resume ? 'present' : 'MISSING');

  /*
    🔴 Phase 6C's notification routes, and the reason to name them is different
    from every block above.

    The others are named because a count would pass if one side of a two-sided
    feature vanished. These are named because they are the first routes in the
    API that belong to NOBODY in particular — no school prefix, no teacher
    prefix, no permission attribute — and a route with no obvious owner is the
    one somebody tidies away.

    ⚠️ unread-count is listed separately on purpose. It is the one a bell polls
    on every navigation, so if it disappeared the symptom would be a badge that
    is permanently zero: a screen that looks fine and is lying.
  */
  const notifications = doc?.paths?.['/api/notifications']?.get;
  const unread = doc?.paths?.['/api/notifications/unread-count']?.get;
  const markRead = doc?.paths?.['/api/notifications/{notificationId}/read']?.post;
  const readAll = doc?.paths?.['/api/notifications/read-all']?.post;

  check('the notification list operation is documented (Phase 6C)',
    !!notifications, notifications ? 'present' : 'MISSING');
  check('…and the unread count, which every screen polls',
    !!unread, unread ? 'present' : 'MISSING');
  check('…and marking one read',
    !!markRead, markRead ? 'present' : 'MISSING');
  check('…and marking them all read',
    !!readAll, readAll ? 'present' : 'MISSING');

  /*
    🔒 AND THE ONE THING THAT MUST NOT BE THERE.

    A notification route that accepted a recipient would make the whole scope
    argument cosmetic, so the DOCUMENT is checked for one. This is cheap and it
    is the kind of thing a well-meaning "admin can see user notifications"
    change adds without anybody reading 030's header.
  */
  const notificationPaths = Object.keys(doc?.paths ?? {}).filter((p) => p.startsWith('/api/notifications'));
  const withRecipient = notificationPaths.filter((p) => /user|recipient/i.test(p));

  check('🔒 no notification route takes a user or recipient in its path',
    withRecipient.length === 0,
    withRecipient.length ? `LEAKED: ${withRecipient.join(', ')}` : `${notificationPaths.length} routes, none of them`);

  const recipientParams = notificationPaths.flatMap((p) =>
    Object.values(doc.paths[p] ?? {}).flatMap((op) => (op?.parameters ?? [])
      .filter((q) => /userUid|recipient|userId/i.test(q?.name ?? ''))
      .map((q) => `${p} ?${q.name}`)));

  check('🔒 …and none takes one as a query parameter either',
    recipientParams.length === 0,
    recipientParams.length ? `LEAKED: ${recipientParams.join(', ')}` : 'none');
  /*
    ------------------------------------------------------------------------
    PHASE 7A — THE PUBLIC SURFACE
    ------------------------------------------------------------------------
    The first operations on this API that nobody authenticates to reach.
  */
  const publicJobs = doc?.paths?.['/api/public/jobs']?.get;
  const publicFilters = doc?.paths?.['/api/public/jobs/filters']?.get;
  const publicJob = doc?.paths?.['/api/public/jobs/{jobUid}']?.get;
  const publicFaqs = doc?.paths?.['/api/public/faqs']?.get;
  const publicBlocks = doc?.paths?.['/api/public/content-blocks']?.get;
  const publicContact = doc?.paths?.['/api/public/contact']?.post;

  check('the public job listing is documented (Phase 7A)',
    !!publicJobs, publicJobs ? 'present' : 'MISSING');
  check('…and the filter values, which the listing UI needs to render controls',
    !!publicFilters, publicFilters ? 'present' : 'MISSING');
  check('…and one public job, the route the 404 wall defends',
    !!publicJob, publicJob ? 'present' : 'MISSING');
  check('…and the FAQ copy, served from the database (2.81)',
    !!publicFaqs, publicFaqs ? 'present' : 'MISSING');
  check('…and the designated content blocks',
    !!publicBlocks, publicBlocks ? 'present' : 'MISSING');
  check('…and the contact form — the only anonymous WRITE in the system',
    !!publicContact, publicContact ? 'present' : 'MISSING');

  /*
    🔴 A CEILING, NOT A FLOOR — AND THIS IS THE ONLY PLACE IN THIS FILE THAT
    WANTS ONE.

    minOperations above asks "did anything VANISH", because everywhere else the
    failure is a route silently disappearing. On the anonymous surface the
    danger runs the other way: the failure is a route silently APPEARING. A
    seventh endpoint under /api/public is an endpoint somebody can call with no
    token and no account, and "I put it under public because it needed no auth"
    is exactly how it would arrive.

    So this asserts the set is EXACTLY these six. When a seventh is genuinely
    wanted, this number moves in the same commit, with the reason — which is
    the conversation the assertion exists to force.
  */
  const anonymousPaths = Object.keys(doc?.paths ?? {}).filter((p) => p.startsWith('/api/public'));

  const anonymousOps = anonymousPaths.flatMap((p) =>
    Object.keys(doc.paths[p] ?? {})
      .filter((verb) => ['get', 'post', 'put', 'patch', 'delete'].includes(verb))
      .map((verb) => `${verb.toUpperCase()} ${p}`));

  check('🔴 the anonymous surface is EXACTLY six operations — a 7th is a new front door',
    anonymousOps.length === 6,
    anonymousOps.length === 6
      ? '6, unchanged'
      : `${anonymousOps.length}: ${anonymousOps.join(', ')}`);

  /*
    ⚠️ /api/schools/{uid}/public matches a path grep for "public" and is NOT
    part of that set — it is a Phase 3 route behind [Authorize]. The filter
    above is anchored with startsWith('/api/public') precisely so the two never
    get confused; this assertion states it so the next reader does not have to
    rediscover it.
  */
  check('…and the Phase 3 /api/schools/{uid}/public route is NOT in that set',
    !anonymousPaths.some((p) => p.includes('/schools/')),
    'authenticated despite its name — counted nowhere near the anonymous six');

  /*
    🔒 AND WHAT MUST NOT BE THERE: anything that names a person.

    A public endpoint taking a teacher or user identity would be a lookup of a
    private individual by anyone on the internet — the single worst thing this
    surface could grow. Checked in the path and in the query, the same shape
    030's notification check uses.
  */
  const publicWithIdentity = anonymousPaths.filter((p) => /teacher|user|recipient|applicant/i.test(p));

  check('🔒 no public route names a teacher, user or applicant in its path',
    publicWithIdentity.length === 0,
    publicWithIdentity.length ? `LEAKED: ${publicWithIdentity.join(', ')}` : `${anonymousPaths.length} paths, none of them`);

  const publicIdentityParams = anonymousPaths.flatMap((p) =>
    Object.values(doc.paths[p] ?? {}).flatMap((op) => (op?.parameters ?? [])
      .filter((q) => /teacher|userUid|userId|recipient|applicant|email|mobile/i.test(q?.name ?? ''))
      .map((q) => `${p} ?${q.name}`)));

  check('🔒 …and none takes one as a query parameter either',
    publicIdentityParams.length === 0,
    publicIdentityParams.length ? `LEAKED: ${publicIdentityParams.join(', ')}` : 'none');
} catch (error) {
  check('the entitlement matrix operation is documented', false, error.message);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
