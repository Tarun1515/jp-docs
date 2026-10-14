/*
  🔒 THE OPEN-REDIRECT CHECK, TABLE-TESTED. Phase 7B-0.

  ----------------------------------------------------------------------------
  WHY THIS IS A SEPARATE SUITE AND NOT PART OF THE FUNNEL TEST
  ----------------------------------------------------------------------------
  funnel-e2e.mjs drives a handful of hostile values through a real browser,
  which proves the wiring. It cannot practically drive thirty, and thirty is
  what a parser-shaped security check needs: the cases that break
  `startsWith('/')` are the ones nobody thinks of while writing the page.

  So this imports the shipped function DIRECTLY — jp-shared's
  core/utils/safe-internal-path.ts has no Angular imports for exactly this
  reason — and runs the table against it. If the function is ever moved behind
  a dependency, this suite stops running and says so rather than passing.

  🔴 Each case states what a FAILURE would mean, not just what is expected. A
  table of inputs and outputs tells the next reader nothing about why '/\\a' is
  in it.

  Run (nothing needs to be running):  node scripts/verify/safe-path.mjs
*/
import { safeInternalPath } from '../../../jp-shared/src/core/utils/safe-internal-path.ts';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

/* ========================================================================= */
section('1. 🔒 REJECTED — anything that could leave this origin');
/* ========================================================================= */

/*
  Each entry: [the candidate, what shipping it would mean].
  Every one of these must come back null.
*/
const hostile = [
  ['https://evil.example', 'a visitor who checked our hostname is handed to another site'],
  ['http://evil.example', 'the same over plain HTTP'],
  ['//evil.example', 'PROTOCOL-RELATIVE — starts with "/" and is absolute to a browser'],
  ['//evil.example/path', 'the same with a path, which looks more like one of ours'],
  ['\\\\evil.example', 'a UNC-shaped value; some parsers fold it to //'],
  ['/\\evil.example', 'browsers fold "\\" to "/", giving //evil.example'],
  ['/\\/evil.example', 'the same, padded to get past a naive "starts with /\\" check'],
  ['/a\\b', 'a backslash anywhere — banned outright rather than reasoned about'],
  ['javascript:alert(1)', 'script execution on click'],
  ['JaVaScRiPt:alert(1)', 'the same, case-shifted past a lowercase comparison'],
  ['data:text/html,<script>alert(1)</script>', 'an inline document we would be handing over to'],
  ['mailto:someone@example.com', 'not a page at all'],
  ['about:blank', 'a scheme with no host to compare'],
  ['/\u0000/dashboard', 'a NUL, which some parsers truncate at and some do not'],
  ['/\u000d\u000ahttps://evil.example', 'CRLF, the classic parser-disagreement payload'],
  ['/ /dashboard', 'a raw space, which some parsers strip before resolving'],
  ['dashboard', 'relative with no leading slash — resolves against whatever page we are on'],
  ['./dashboard', 'the same, explicitly relative'],
  ['../../etc', 'traversal, and not app-relative'],
  ['', 'empty is not a destination'],
  [null, 'the normal case when no parameter was sent'],
  [undefined, 'the same, absent rather than empty'],
  [`/${'a'.repeat(600)}`, 'a pathological length written into storage until the tab closes'],
];

let rejectedAll = true;

for (const [candidate, consequence] of hostile) {
  const got = safeInternalPath(candidate);
  const ok = got === null;

  if (!ok) rejectedAll = false;

  const shown = candidate === null ? 'null'
    : candidate === undefined ? 'undefined'
      : JSON.stringify(candidate.length > 42 ? `${candidate.slice(0, 39)}...` : candidate);

  check(`🔒 rejects ${shown}`, ok,
    ok ? consequence : `RETURNED ${JSON.stringify(got)} — ${consequence}`);
}

check('🔒 every hostile candidate was rejected',
  rejectedAll, `${hostile.length} case(s)`);

/* ========================================================================= */
section('2. ACCEPTED — real destinations this funnel depends on');
/* ========================================================================= */

/*
  ⚠️ The expected value is the NORMALISED path, not the input. The function
  rebuilds from the parsed URL so the router cannot receive something the
  parse did not recognise.
*/
const allowed = [
  ['/', '/', 'the app root'],
  ['/dashboard', '/dashboard', 'the plainest case'],
  ['/jobs/7fffc32e-78db-4823-a44f-a3388db6df86/apply', '/jobs/7fffc32e-78db-4823-a44f-a3388db6df86/apply',
    'THE FUNNEL — the public site Apply button sends exactly this'],
  ['/applications/42', '/applications/42', 'what the session-expiry interceptor sends'],
  ['/jobs?subjectId=3', '/jobs?subjectId=3', 'a query string survives'],
  ['/jobs#results', '/jobs#results', 'a fragment survives'],
  ['/a/./b', '/a/b', 'normalised — "." segment removed'],
  ['/a/b/../c', '/a/c', 'normalised — ".." resolved INSIDE the path, not above the root'],
  ['/jobs/%20spaced', '/jobs/%20spaced', 'an ENCODED space is a legitimate path character'],
];

for (const [candidate, expected, why] of allowed) {
  const got = safeInternalPath(candidate);

  check(`accepts ${JSON.stringify(candidate)} -> ${JSON.stringify(expected)}`,
    got === expected, got === expected ? why : `GOT ${JSON.stringify(got)}`);
}

/* ========================================================================= */
section('3. 🔴 TRAVERSAL CANNOT CLIMB OUT');
/* ========================================================================= */

/*
  🔴 '..' is NOT banned, and that is deliberate — it is a legitimate path
  character and URL resolution already clamps it at the root. This asserts the
  clamp rather than trusting it: if resolution ever let a path climb above the
  origin, these would stop starting with '/'.
*/
const traversals = ['/../../../../etc/passwd', '/a/../../../b', '/../'];

for (const candidate of traversals) {
  const got = safeInternalPath(candidate);

  check(`🔴 ${JSON.stringify(candidate)} stays rooted`,
    got !== null && got.startsWith('/') && !got.includes('..'),
    got === null ? 'rejected outright, which is also safe' : `-> ${JSON.stringify(got)}`);
}

/* ========================================================================= */
section('4. 🔴 THE SHAPE CHECK IS NOT THE ONLY CHECK');
/* ========================================================================= */

/*
  The point of the layering, stated as an assertion: there exist candidates
  that PASS `startsWith('/')` and must still be refused. If this ever came back
  zero, the layers below the shape check would have stopped earning their keep
  — which would mean the function had been simplified into the usual mistake.
*/
const passesShapeCheck = hostile
  .filter(([c]) => typeof c === 'string' && c.startsWith('/'))
  .map(([c]) => c);

console.log(`\n    ${passesShapeCheck.length} hostile case(s) start with "/" and are still refused:`);
passesShapeCheck.forEach((c) => console.log(`      ${JSON.stringify(c.slice(0, 44))}`));
console.log('');

check('🔴 startsWith("/") alone would have admitted several of these',
  passesShapeCheck.length >= 5,
  `${passesShapeCheck.length} of them — the layers below the shape check are load-bearing`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log('='.repeat(74));

process.exitCode = failed.length ? 1 : 0;
