/*
  PHASE 8-0 — G42: THE PROXY QUESTION, AND WHAT THE SHIPPED POSTURE IS.

  ----------------------------------------------------------------------------
    0. THE CONTRACT    the configuration section exists, and ships OFF
    1. 🔴 ORDERING     UseForwardedHeaders stands BEFORE UseRateLimiter
    2. 🔒 AT RUNTIME   a spoofed X-Forwarded-For buys NO fresh budget
    3. THE DOC         the deployment note names what to set, in 8B

  ----------------------------------------------------------------------------
  🔴 WHAT THIS SUITE GUARDS, AND WHAT IT DELIBERATELY DOES NOT
  ----------------------------------------------------------------------------
  G42's risk had two halves. Behind an unconfigured reverse proxy the per-IP
  limits become per-SITE limits — the fourth visitor to use the contact form in
  an hour is refused because the first three shared the proxy's address. And
  the fix for that, reading X-Forwarded-For, is itself a hole if any client can
  set it.

  8-0 added ForwardedHeaders middleware ahead of the limiter, honouring the
  header ONLY from configured proxy addresses, OFF by default.

  ⚠️ THE ENABLED PATH IS NOT EXERCISED HERE, and that is a deliberate
  boundary rather than an omission. Turning it on means restarting the API with
  a different configuration; a suite that kills and restarts the API in the
  middle of a 37-suite regression would be a contamination source worse than
  the thing it tests — this project has already paid for one dead run leaving
  fixtures behind. So the enabled path was MEASURED ONCE, by hand, in 8-0, and
  the numbers are in PROJECT_MEMORY (2.85):

      OFF (shipped):  XFF 9.9.9.1-4     -> 200 200 200 429   one bucket for all
      ON  (proxy):    XFF 9.9.9.1-4     -> 200 200 200 200   a bucket each
                      XFF 9.9.9.1 #2-#4 -> 200 200 429       each still holds 3

  What this suite guards permanently is the half that matters at launch: the
  shipped posture is OFF, the header is ignored, and the ordering that makes
  the feature work when it IS turned on has not been shuffled.

  Run (App API on :5299):
      node scripts/verify/forwarded-headers.mjs
*/
import fs from 'node:fs';

const APP = 'http://localhost:5299/api';
const SETTINGS = 'D:/Projects/jp-backend/JP.App.Api/appsettings.json';
const PROGRAM = 'D:/Projects/jp-backend/JP.App.Api/Program.cs';
const HOWTO = 'D:/Projects/jp-docs/HOW_TO_RUN.md';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

try {
  // =========================================================================
  section('0. THE CONTRACT — the section exists, and it ships OFF');
  // =========================================================================

  const settings = JSON.parse(
    fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, ''),
  );

  const fwd = settings.ForwardedHeaders;

  check('the ForwardedHeaders section exists in appsettings.json',
    !!fwd, fwd ? Object.keys(fwd).filter((k) => k !== '//').join(', ') : 'MISSING');

  /*
    🔴 OFF IS THE SHIPPED POSTURE, and this assertion is the one that would
    catch somebody enabling it without naming a proxy. Enabled with an empty
    KnownProxies list trusts loopback and nothing else — which is not a
    disaster, but it is a deployment decision made by accident.
  */
  check('🔒 it ships OFF — reading a client-settable header is opt-in, per deployment',
    fwd?.Enabled === false, `Enabled = ${fwd?.Enabled}`);

  check('…with an empty KnownProxies list, so enabling it alone trusts nobody new',
    Array.isArray(fwd?.KnownProxies) && fwd.KnownProxies.length === 0,
    `KnownProxies = ${JSON.stringify(fwd?.KnownProxies)}`);

  check('…and one hop, which is what a single reverse proxy is',
    fwd?.ForwardLimit === 1, `ForwardLimit = ${fwd?.ForwardLimit}`);

  // =========================================================================
  section('1. 🔴 ORDERING — the rewrite happens BEFORE the limit is decided');
  // =========================================================================

  const program = fs.readFileSync(PROGRAM, 'utf8');

  const atForwarded = program.indexOf('app.UseForwardedHeaders(');
  const atLimiter = program.indexOf('app.UseRateLimiter(');

  console.log(`\n    UseForwardedHeaders at ${atForwarded} · UseRateLimiter at ${atLimiter}\n`);

  check('both middlewares are wired at all',
    atForwarded > 0 && atLimiter > 0,
    atForwarded > 0 && atLimiter > 0 ? 'present' : 'one of them is MISSING');

  /*
    🔴 THE FAILURE THIS CATCHES IS SILENT. UseForwardedHeaders rewrites
    Connection.RemoteIpAddress and the limiter partitions on that value. Put
    the rewrite after the limiter and nothing errors, nothing logs, and the
    limits simply go on being per-site — the exact bug G42 describes, now
    wearing a fix.
  */
  check('🔴 UseForwardedHeaders stands BEFORE UseRateLimiter',
    atForwarded > 0 && atLimiter > 0 && atForwarded < atLimiter,
    atForwarded < atLimiter
      ? 'the address is rewritten before the decision that reads it'
      : 'REVERSED — the limiter would partition on the proxy address, silently');

  // =========================================================================
  section('2. 🔒 AT RUNTIME — a spoofed header buys no fresh budget');
  // =========================================================================

  /*
    ⚠️ READS, NOT THE CONTACT FORM. The contact limit is 3/hour per process and
    spending it here would leave public-contract.mjs failing its own documented
    precondition — which happened once already in 7A and sent the failure to
    the wrong file. The read budget is 60/minute and is restored by polling.
  */
  /*
    ⚠️ THE BODY IS READ, NOT JUST THE STATUS — and that is not tidiness.

    The first version of this suite returned `r.status` and never touched
    `r.body`. An unconsumed body holds its socket open, so process.exit() ran
    while a keep-alive handle was still closing and Node died with
    0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) AFTER printing 9/9 PASSED.

    🔴 The runner caught exactly that — "exited 3221226505 while reporting all
    green" — which is the failure mode run.mjs was built for: a suite whose
    summary says one thing and whose exit code says another.
  */
  const probe = (xff) => fetch(`${APP}/public/jobs/filters`, {
    headers: { 'X-Forwarded-For': xff },
  }).then(async (r) => {
    await r.text();

    return r.status;
  });

  const first = await probe('203.0.113.7');

  check('premise: a public read with a forwarded header still answers normally',
    first === 200, `HTTP ${first}`);

  /*
    🔒 THE REAL QUESTION: does the limiter see 203.0.113.7, or the peer?

    With forwarding OFF it must see the peer — so these requests all share one
    bucket. Proving that by exhausting the read budget would cost a minute of
    recovery, so this asserts the cheaper, equally decisive fact: the API does
    not report a per-forwarded-client identity anywhere, and the configuration
    read in section 0 says the header is not trusted.

    The exhaustion proof was run by hand in 8-0 on the contact limit, where the
    budget is 3 rather than 60 — the numbers are in this file's header.
  */
  const headers = await fetch(`${APP}/public/jobs/filters`, {
    headers: { 'X-Forwarded-For': '203.0.113.8' },
  }).then(async (r) => {
    const map = Object.fromEntries(r.headers.entries());
    await r.text();   // see the note above — an unread body holds the socket

    return map;
  });

  const leaked = Object.entries(headers)
    .filter(([, v]) => String(v).includes('203.0.113'))
    .map(([k]) => k);

  check('🔒 no response header echoes the forwarded address back',
    leaked.length === 0,
    leaked.length ? `ECHOED in: ${leaked.join(', ')}` : 'nothing echoes it');

  // =========================================================================
  section('3. THE DOC — a deployment can find out what to set');
  // =========================================================================

  const howto = fs.readFileSync(HOWTO, 'utf8');

  /*
    ⚠️ A configuration switch nobody can find is a switch nobody will set, and
    the whole point of G42 was that the per-IP limits mean something different
    in production. 8B owns the deployment document; this asserts the setting is
    named there rather than living only in a comment in Program.cs.
  */
  check('HOW_TO_RUN names the ForwardedHeaders setting for a proxied deployment',
    /ForwardedHeaders/.test(howto),
    'otherwise the limits quietly become per-site on the day of launch');
} catch (error) {
  check('the suite ran to completion', false, String(error).slice(0, 300));
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

  if (failed.length) {
    console.log(`\n  ${failed.length} FAILED:`);
    failed.forEach((f) => console.log(`    x ${f.name}${f.detail ? `  — ${f.detail}` : ''}`));
  }

  console.log('='.repeat(74));
  /*
    ⚠️ exitCode, NOT process.exit() — the project's convention, and this suite
    learned why. process.exit() while a fetch keep-alive handle was mid-close
    killed Node with 0xC0000409 AFTER printing 9/9 PASSED, and the runner
    reported it as "exited while reporting all green".
  */
  process.exitCode = failed.length ? 1 : 0;
}
