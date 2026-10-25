/*
  THE BUILD SCRIPT AGAINST THE FILES ON DISK.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS — ELEVEN FILES, TWO PHASES, AND EVERY SUITE GREEN
  ----------------------------------------------------------------------------
  8A audited `database/run_all.sql` against the .sql files in the repository
  and found ELEVEN it never names:

      jp_app  01_tables/033_public_content.sql                 (7A)
              01_tables/034_moderation_reports_featured.sql    (7B)
              01_tables/035_alter_t_app_jobs_pulled_status.sql (7B)
              03_seed/003_seed_public_faqs.sql                 (7A)
              04_procedures/024_public_reads.sql               (7A)
              04_procedures/025_moderation_reports.sql         (7B)
              04_procedures/026_admin_content.sql              (7B)
              04_procedures/027_admin_analytics.sql            (8-0)
      jp_sso  03_seed/008_seed_moderation_desk.sql             (7B)
              04_procedures/010_admin_analytics.sql            (8-0)
      jp_mdm  04_procedures/011_admin_analytics.sql            (8-0)

  A fresh instance built from run_all.sql would have had no public content
  tables, no moderation tables, no PULLED job status, no public FAQs and none
  of the 7A, 7B or 8-0 procedures. The public site, the moderation desk and the
  analytics screen would all have failed on a new machine.

  ⚠️ AND EVERY SUITE WAS GREEN THE WHOLE TIME, because each phase deployed its
  own files by hand with sqlcmd and the suites ran against the result. 37
  suites and ~1600 assertions could not see it: they test the DATABASE, and the
  database was right. The BUILD was wrong.

  🔴 THE LESSON, WHICH IS A NEW ONE: "the file on disk is not the database" has
  a mirror image — the database is not the build script. A suite that only ever
  queries a running system cannot tell you whether that system can be rebuilt.

  ----------------------------------------------------------------------------
  WHAT IT CHECKS
  ----------------------------------------------------------------------------
    1. every .sql in a build folder is named by run_all.sql
    2. every file run_all.sql names exists on disk
    3. tables come before procedures, per database
    4. a deliberately excluded file is excluded ON PURPOSE, by name — so
       "it is not in the build" and "it was forgotten" cannot look the same

  ⚠️ 99_tests IS NOT A BUILD FOLDER. Those files assert; they do not create.
  They are listed in HOW_TO_RUN and excluded here by name, not by accident.

  Run: node scripts/verify/build-manifest.mjs
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Projects/jp-backend/database';

const DBS = ['jp_sso', 'jp_mdm', 'jp_app'];

/* Folders run_all is expected to drive, in the order it drives them. */
const PHASES = ['01_tables', '02_views', '02_indexes', '03_seed', '04_procedures', '05_functions'];

/*
  🔴 EXCLUDED ON PURPOSE, EACH WITH ITS REASON. A file that belongs here and is
  not listed is the bug this suite exists to catch, so the list is explicit and
  short rather than a pattern that might swallow the next forgotten file.
*/
const EXCLUDED = new Map([
  ['jp_mdm/03_seed/013_seed_school_plans.sql',
    'SR-4: the school plan catalogue, built and proven but NOT activated. '
    + 'Wiring it into run_all turns the entitlement engine on product-wide, which breaks every '
    + 'suite that encodes 2.64 (the switched-off engine) as its premise — and the prices are '
    + 'still unconfirmed (FIELD_MATRIX.md section E). SR_NOTES.md records the full list of what '
    + 'must change and the one command that activates it.'],

  ['jp_app/03_seed/002_backfill_phase3c_owners.sql',
    'a one-time backfill, commented out in run_all with its own instructions — '
    + 'running it on a fresh database would be a no-op at best'],
]);

const results = [];

const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(74));
};

const runAllPath = path.join(ROOT, 'run_all.sql');

if (!fs.existsSync(runAllPath)) {
  console.error(`x no run_all.sql at ${runAllPath}`);
  process.exitCode = 1;
  process.exit();
}

const runAll = fs.readFileSync(runAllPath, 'utf8');

/*
  Only LIVE :r lines count. A commented-out one (-- :r ...) is documentation,
  and treating it as a reference is how the 3C backfill would have hidden a
  real omission.
*/
const referenced = new Set();

for (const line of runAll.split(/\r?\n/)) {
  const m = line.match(/^\s*:r\s+\$\(DbRoot\)\\(.+?\.sql)\s*$/i);

  if (m) {
    referenced.add(m[1].split('\\').join('/'));
  }
}

section('1. 🔴 EVERY FILE ON DISK IS IN THE BUILD');

console.log(`\n    run_all.sql names ${referenced.size} file(s)\n`);

let onDisk = 0;

for (const db of DBS) {
  const forgotten = [];

  for (const phase of PHASES) {
    const dir = path.join(ROOT, db, phase);

    if (!fs.existsSync(dir)) continue;

    for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.sql')).sort()) {
      const rel = `${db}/${phase}/${f}`;

      onDisk++;

      if (!referenced.has(rel) && !EXCLUDED.has(rel)) {
        forgotten.push(rel);
      }
    }
  }

  check(`${db}: every build file is named by run_all.sql`,
    forgotten.length === 0,
    forgotten.length
      ? `MISSING FROM THE BUILD: ${forgotten.join(' · ')}`
      : 'nothing forgotten');
}

check('premise: there are files to check at all',
  onDisk > 100, `${onDisk} build file(s) on disk`);

section('2. EVERY FILE THE BUILD NAMES EXISTS');

const vanished = [...referenced].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));

check('run_all.sql names no file that is gone',
  vanished.length === 0,
  vanished.length ? `NAMED BUT MISSING: ${vanished.join(' · ')}` : `${referenced.size} file(s) present`);

section('3. ORDER — TABLES BEFORE PROCEDURES, PER DATABASE');

/*
  ⚠️ A WEAK CHECK, HONESTLY LABELLED. It compares the LAST table's position
  with the FIRST procedure's, which catches a whole section pasted in the wrong
  place. It does not catch one table listed after one procedure that needs it —
  deferred name resolution means a procedure compiles against a table that does
  not exist yet, so only a real fresh build proves the order, and that is 8B's
  rehearsal rather than a string comparison.
*/
const positionOf = (rel) => {
  const needle = `:r $(DbRoot)\\${rel.split('/').join('\\')}`;
  return runAll.indexOf(needle);
};

for (const db of DBS) {
  const tables = [...referenced].filter((r) => r.startsWith(`${db}/01_tables/`));
  const procs = [...referenced].filter((r) => r.startsWith(`${db}/04_procedures/`));

  if (!tables.length || !procs.length) {
    check(`${db}: has both tables and procedures in the build`, false,
      `${tables.length} table file(s), ${procs.length} procedure file(s)`);
    continue;
  }

  const lastTable = Math.max(...tables.map(positionOf));
  const firstProc = Math.min(...procs.map(positionOf));

  check(`${db}: the table section precedes the procedure section`,
    lastTable < firstProc,
    `last table at ${lastTable}, first procedure at ${firstProc}`);
}

section('4. WHAT IS EXCLUDED IS EXCLUDED BY NAME');

for (const [rel, why] of EXCLUDED) {
  const exists = fs.existsSync(path.join(ROOT, rel));

  /*
    ⚠️ AN EXCLUSION FOR A FILE THAT NO LONGER EXISTS IS A LIE THAT WOULD HIDE
    THE NEXT ONE — if the path is renamed, the exclusion silently starts
    covering nothing while reading as though it covers something.
  */
  check(`excluded on purpose: ${rel}`, exists, exists ? why : 'THE EXCLUDED FILE IS GONE — remove this entry');
}

/*
  🔒 And the guard this suite needs on itself: 999 must be LAST for jp_app, or
  a cross-file guard judges a half-built database.
*/
section('5. 🔒 THE CROSS-FILE GUARDS RUN LAST');

const guardPos = positionOf('jp_app/04_procedures/999_cross_file_guards.sql');
const appFiles = [...referenced].filter((r) => r.startsWith('jp_app/')).map(positionOf);

check('999_cross_file_guards.sql is referenced at all',
  guardPos > 0, guardPos > 0 ? `at ${guardPos}` : 'NOT IN THE BUILD');

check('🔒 …and nothing in jp_app runs after it',
  guardPos > 0 && guardPos === Math.max(...appFiles),
  `guard at ${guardPos}, last jp_app file at ${Math.max(...appFiles)}`);

const failed = results.filter((r) => !r.pass);

console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

if (failed.length) {
  console.log(`\n  ${failed.length} FAILED:`);
  for (const f of failed) console.log(`    x ${f.label}`);
  process.exitCode = 1;
}

console.log('='.repeat(74));
