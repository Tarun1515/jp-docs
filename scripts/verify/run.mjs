/*
  THE SHARED SUITE RUNNER.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS — TWO INCIDENTS, ONE CAUSE
  ----------------------------------------------------------------------------
  G35: during 6C-0's regression, `offers.mjs` returned 56/57 once. The batch had
  grepped only the summary line, so the output was gone, and four runs since
  have been clean. The cause is still unknown and probably now unknowable. **An
  unexplained failure with no output kept is worse than a red**, because a red
  at least tells you what to look at.

  6C-0 again: `team-contract` had quietly dropped from 49 checks to 48, with
  nothing red. A stray fixture made it take a skip branch and its cleanup
  assertion never ran. **A suite that silently gets SMALLER is more dangerous
  than one that fails** — nobody counts a green.

  Both are runner-level problems, so both are fixed here rather than in
  twenty-five files:

    1. Every run's full output goes to a file, pass or fail. No grep decides
       what was worth keeping.
    2. Every suite's assertion COUNT is compared against a committed manifest,
       and a count that DROPPED is a failure even when every assertion passed.

  ----------------------------------------------------------------------------
  🔴 AND SINCE 8A THIS IS THE REGRESSION ENTRY POINT — G9
  ----------------------------------------------------------------------------
  G9 asked for an E2E layer. The honest answer, written down in 8A rather than
  deferred again, is that the suite ecosystem IS that layer: SQL suites prove
  the procedures, HTTP suites prove the API and its refusals, and Playwright
  suites drive the real screens in a real browser. What was missing was not
  coverage — it was a SINGLE DOCUMENTED COMMAND that runs all of it, so that
  "did you run the regression?" has one answer.

  ⚠️ IT WAS NOT ONE COMMAND UNTIL 8A, AND THE GAP WAS INVISIBLE. The seven
  T-SQL suites under database/<db>/99_tests/ were documented in HOW_TO_RUN as
  seven sqlcmd lines to run by hand, and this runner knew nothing about them.
  Anyone running "the regression" ran 34 suites and believed they had run 41.
  They are in the manifest now, under sqlSuites, and they fail this run like
  anybody else.

  ----------------------------------------------------------------------------
  USAGE
  ----------------------------------------------------------------------------
      node scripts/verify/run.mjs                  # every suite in the manifest
      node scripts/verify/run.mjs offers invites   # just these
      node scripts/verify/run.mjs --update         # accept new counts (see below)

  ⚠️ `--update` rewrites the manifest from the run's own results. Use it when
  you have ADDED assertions and the suite is green; never to make a drop go
  away. The diff it produces is meant to be read in review — a line going down
  is the thing this runner exists to show you.

  ----------------------------------------------------------------------------
  ⚠️ SEQUENTIAL, DELIBERATELY
  ----------------------------------------------------------------------------
  These suites share fixtures: the same school, the same teachers, the same
  entitlement rows, which they mutate and restore. Running two at once would
  make every contamination incident in this project's history simultaneous and
  unattributable. One at a time, every time.
*/
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'suite-counts.json');
const LOGS = join(HERE, '..', '..', '.verify-logs');

const args = process.argv.slice(2);
const update = args.includes('--update');
const named = args.filter((a) => !a.startsWith('--'));

if (!existsSync(MANIFEST)) {
  console.error(`No manifest at ${MANIFEST}. Create it, or run with --update once and read the diff.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const suites = named.length ? named : Object.keys(manifest.suites);

mkdirSync(LOGS, { recursive: true });

/**
 * Pull the count out of a suite's own summary line.
 *
 * ⚠️ Two shapes, because the older suites print their own. Both are matched
 * rather than normalised: rewriting twenty-five summary lines to suit a runner
 * is a bigger change than reading two formats.
 */
const readCounts = (out) => {
  const a = [...out.matchAll(/^\s*(\d+)\/(\d+)\s+PASSED/gm)].at(-1);
  if (a) return { passed: Number(a[1]), total: Number(a[2]) };

  const b = [...out.matchAll(/(\d+)\s+checks,\s+(\d+)\s+passed/gm)].at(-1);
  if (b) return { passed: Number(b[2]), total: Number(b[1]) };

  return null;
};

/**
 * The T-SQL suites, which print neither of the shapes above.
 *
 * 🔴 BY COUNTING RESULT MARKERS, NOT BY READING THEIR SUMMARY LINE — and the
 * reason is a trap this nearly walked into. 003_test_school_team.sql prints
 * TWO summaries: "TOTAL 52 PASSED 52" and then a breakdown,
 * "NEGATIVE CASES: 27 PASSED 27". The .at(-1) above takes the LAST match, so
 * reading its summary would have pinned that suite at 27 — and twenty-five
 * assertions could then stop running with nothing red.
 *
 * A line carrying the whole word PASS or FAIL is one assertion, in both
 * layouts these files use (marker-first in jp_sso, marker-last in jp_app).
 * "PASSED" and "FAILED" are different words and do not match, which is what
 * keeps the summary lines themselves out of the count.
 *
 * ⚠️ CROSS-CHECKED, NOT TRUSTED: the suite's own TOTAL is also parsed, and a
 * disagreement is reported rather than silently resolved in favour of either.
 */
const readSqlCounts = (out) => {
  const lines = out.split(/\r?\n/);

  const passed = lines.filter((l) => /(^|\s)PASS(\s|$)/.test(l)).length;
  const failed = lines.filter((l) => /(^|\s)FAIL(\s|$)/.test(l)).length;

  if (passed + failed === 0) return null;

  const claimed = [...out.matchAll(/TOTAL\s+(\d+)\s+PASSED\s+(\d+)/g)].at(0);

  return {
    passed,
    total: passed + failed,
    claimed: claimed ? { total: Number(claimed[1]), passed: Number(claimed[2]) } : null,
  };
};

const failLines = (out) =>
  [...out.matchAll(/^\s*FAIL\s{2}(.*)$/gm)].map((m) => m[1].trim());

const results = [];
const started = Date.now();

console.log(`\n  ${suites.length} suite(s), sequentially. Output kept in ${LOGS}\n`);

for (const name of suites) {
  const expected = manifest.suites[name];

  /*
    🔴 A SUITE WITH NO MANIFEST ENTRY STILL RUNS.

    The first version SKIPPED it and said so. That is the wrong half of the
    behaviour to get right: a suite written this phase and not yet pinned would
    quietly not run at all, which is precisely the silence this runner exists to
    break — and --update could never learn its count, because there was never a
    run to learn from. So it runs, its assertions can fail the whole run like
    anybody's, and the only thing it cannot do is be compared to a number that
    does not exist yet.

    ⚠️ A TYPO IS STILL CAUGHT, just further down: a name with no .mjs file
    produces no summary line, which lands as ???? / nosummary in NOT CLEAN and
    exits 1. Measured, not assumed — `run.mjs no-such-suite` does exactly that.
  */
  const unpinned = expected === undefined;

  /*
    🔴 TWO KINDS OF SUITE, ONE RUN — G9.

    A name listed under sqlSuites is a T-SQL file run through sqlcmd; anything
    else is a .mjs run through node. The seven SQL suites were outside this
    runner until 8A and were therefore outside "the regression".

    ⚠️ -b IS LOAD BEARING. Without it sqlcmd reports a failure and carries on
    through the remaining batches, so a suite that blew up halfway would still
    print a cheerful summary for the batches that did run.
  */
  const sqlFile = manifest.sqlSuites?.[name];

  const file = sqlFile
    ? join(HERE, '..', '..', '..', 'jp-backend', 'database', sqlFile.split('/').join(sep))
    : join(HERE, `${name}.mjs`);

  const log = join(LOGS, `${name}.log`);

  let out = '';
  let code = 0;

  try {
    const r = sqlFile
      ? await execFileAsync('sqlcmd',
        ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-i', file],
        { maxBuffer: 64 * 1024 * 1024, timeout: 40 * 60 * 1000 })
      : await execFileAsync(process.execPath, [file], {
        cwd: join(HERE, '..', '..'),
        maxBuffer: 64 * 1024 * 1024,
        timeout: 40 * 60 * 1000,
      });

    out = `${r.stdout}${r.stderr}`;
  } catch (error) {
    /*
      🔴 The output is taken from the ERROR too. A suite that throws has the
      most interesting output of all, and the first version of this project's
      batch runner threw it away — which is G35.
    */
    out = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
    code = error.code ?? 1;
  }

  writeFileSync(log, out);

  const counts = sqlFile ? readSqlCounts(out) : readCounts(out);

  const fails = sqlFile
    ? [...out.matchAll(/^.*(^|\s)FAIL(\s|$).*$/gm)].map((m) => m[0].trim().slice(0, 120))
    : failLines(out);

  let state = 'pass';
  const notes = [];

  /*
    ⚠️ A T-SQL suite's own TOTAL is compared with the markers counted here, and
    a disagreement is a NOTE rather than a silent choice. They have disagreed
    once already — see readSqlCounts — and the next time they do, the reason
    will matter more than whichever number is bigger.
  */
  if (sqlFile && counts?.claimed && counts.claimed.total !== counts.total) {
    notes.push(`counted ${counts.total} marker(s), the suite says TOTAL ${counts.claimed.total}`);
  }

  if (!counts) {
    state = 'nosummary';
    notes.push('no summary line — did it crash before finishing?');
  } else {
    if (counts.passed !== counts.total) {
      state = 'fail';
      notes.push(`${counts.total - counts.passed} assertion(s) failed`);
    }

    /*
      🔴 THE COUNT CHECK, WHICH IS THE HALF NOBODY EXPECTS TO NEED.

      A total BELOW the manifest means assertions stopped running — a skip
      branch taken, a loop that found nothing, a section that returned early.
      team-contract did exactly this and stayed green.
    */
    if (!unpinned && counts.total < expected) {
      state = state === 'pass' ? 'shrank' : state;
      notes.push(`🔴 ${expected - counts.total} assertion(s) DID NOT RUN (manifest says ${expected})`);
    }

    if (!unpinned && counts.total > expected && !update) {
      notes.push(`${counts.total - expected} new assertion(s) — run --update when that is deliberate`);
    }

    /*
      ⚠️ A green unpinned suite is NOT clean. It ran and it passed, but nothing
      is yet watching its count — so it is reported every run until somebody
      pins it, rather than blending in with the suites that are protected.
    */
    if (unpinned && state === 'pass' && !update) {
      state = 'unpinned';
      notes.push(`${counts.total} assertion(s), not in the manifest — run --update to pin it`);
    }
  }

  if (code !== 0 && state === 'pass') {
    state = 'exit';
    notes.push(`exited ${code} while reporting all green`);
  }

  const badge = {
    pass: ' ok ', fail: 'FAIL', shrank: 'SHRK', nosummary: '????', exit: 'EXIT', unpinned: 'NEW ',
  }[state] ?? '    ';

  console.log(`  ${badge} ${name.padEnd(24)} ${counts ? `${counts.passed}/${counts.total}`.padEnd(8) : '—'.padEnd(8)}${notes.join(' · ')}`);

  /*
    ⚠️ The failing assertions are printed HERE, not left in the file. The log is
    for the whole story; these lines are what somebody needs before they decide
    whether to open it.
  */
  for (const f of fails.slice(0, 6)) console.log(`         ${f}`);
  if (fails.length > 6) console.log(`         … ${fails.length - 6} more in ${log}`);

  results.push({ name, state, counts, log });
}

const bad = results.filter((r) => r.state !== 'pass');
const elapsed = Math.round((Date.now() - started) / 1000);

console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - bad.length}/${results.length} suite(s) clean in ${elapsed}s`);

if (bad.length) {
  console.log('\n  NOT CLEAN:');
  for (const r of bad) console.log(`    ${r.state.padEnd(10)} ${r.name.padEnd(24)} ${r.log}`);
}

console.log('='.repeat(74));

if (update) {
  const next = { ...manifest, suites: { ...manifest.suites } };

  for (const r of results) {
    if (r.counts && r.state !== 'fail') next.suites[r.name] = r.counts.total;
  }

  const changed = Object.keys(next.suites)
    .filter((k) => next.suites[k] !== manifest.suites[k])
    .map((k) => `${k}: ${manifest.suites[k]} -> ${next.suites[k]}`);

  next.updatedOn = new Date().toISOString().slice(0, 10);
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);

  console.log(changed.length
    ? `\n  manifest updated:\n${changed.map((c) => `    ${c}`).join('\n')}\n`
    : '\n  manifest unchanged\n');
}

process.exitCode = bad.length ? 1 : 0;
