#!/usr/bin/env node
/*==============================================================================
  Which copy of @tarun1515/jp-shared is each app running?

  Run from anywhere inside jp-docs:   node scripts/check-versions.mjs
  Or:                                 npm run check-versions

  ----------------------------------------------------------------------------
  WHY THIS EXISTS
  ----------------------------------------------------------------------------
  Seven repositories, four of which install the shared library independently.
  Fix a bug in jp-shared, update three apps, forget the fourth — and that app
  carries the bug for weeks while building perfectly cleanly against the copy it
  already has. Nobody finds out until a user does.

  Nothing prevents that. Separate repos and separate node_modules is the cost of
  the independence the client asked for. So the job here is to make drift
  findable in seconds:

      1. jp-shared stamps its version into JP_SHARED_VERSION
      2. each app logs that at bootstrap, in dev mode
      3. THIS script reads all four side by side

  It also reports whether an app is LINKED or INSTALLED, because those mean very
  different things: a linked app follows jp-shared live and cannot drift, while
  an installed one is frozen at whatever it last pulled. An app that is linked
  when you thought it was installed will not reproduce a released build.

  Exits non-zero on drift, so CI can fail on it.
==============================================================================*/

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// jp-docs sits alongside the other repos, so the siblings are one level up.
const siblings = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PACKAGE = '@tarun1515/jp-shared';
const APPS = ['jp-admin', 'jp-school', 'jp-teacher', 'jp-public'];

const readJson = (path) => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
};

const shared = readJson(resolve(siblings, 'jp-shared/package.json'));

if (!shared) {
  console.error(`\n  jp-shared not found next to jp-docs.\n  Looked in: ${siblings}\n`);
  console.error('  All seven repositories must be cloned as siblings. See README.md.\n');
  process.exit(2);
}

const built = readJson(resolve(siblings, 'jp-shared/dist/jp-shared/package.json'));

console.log('');
console.log(`  ${PACKAGE}`);
console.log(`    source        ${shared.version}`);
console.log(`    built         ${built ? built.version : 'NOT BUILT — run npm run build in jp-shared'}`);
console.log('');

const rows = [];
let problems = 0;

for (const app of APPS) {
  const appRoot = resolve(siblings, app);

  if (!existsSync(appRoot)) {
    rows.push({ app, version: '—', mode: '', note: 'repo not cloned' });
    problems += 1;
    continue;
  }

  const installedPath = resolve(appRoot, 'node_modules', PACKAGE);

  if (!existsSync(installedPath)) {
    rows.push({ app, version: '—', mode: '', note: 'not installed — run npm install' });
    problems += 1;
    continue;
  }

  // A linked package is a symlink; an installed one is a real directory.
  let mode = 'installed';
  try {
    if (lstatSync(installedPath).isSymbolicLink()) {
      mode = 'linked';
    }
  } catch {
    /* fall through as installed */
  }

  const pkg = readJson(resolve(installedPath, 'package.json'));
  const version = pkg?.version ?? '?';

  let note = 'in sync';

  if (mode === 'linked') {
    // Linked follows jp-shared's built output, so it cannot drift — but it also
    // is not what a release build would use.
    note = 'follows jp-shared (dev mode)';
  } else if (version !== shared.version) {
    note = `STALE — jp-shared is ${shared.version}`;
    problems += 1;
  }

  rows.push({ app, version, mode, note });
}

const width = Math.max(...rows.map((r) => r.app.length));

for (const { app, version, mode, note } of rows) {
  const ok = note === 'in sync' || note.startsWith('follows');
  console.log(
    `  ${ok ? '  ok  ' : ' CHECK'}  ${app.padEnd(width)}  ${version.padEnd(9)} ${mode.padEnd(10)} ${note}`,
  );
}

console.log('');

if (built && built.version !== shared.version) {
  console.log('  The built library is older than its source. In jp-shared: npm run build');
  console.log('');
}

if (problems > 0) {
  console.log('  For a stale app:   cd <app> && npm run update:shared');
  console.log('  For development:   cd <app> && npm run link:shared');
  console.log('');
  process.exit(1);
}

console.log('  Everything is consistent.');
console.log('');
