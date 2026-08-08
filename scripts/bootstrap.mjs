#!/usr/bin/env node
/*==============================================================================
  Set up a new machine: clone all seven repositories as siblings and install
  each one.

    node scripts/bootstrap.mjs

  Run it from inside jp-docs. It works on the folder ABOVE jp-docs, so the seven
  repos end up as siblings — which is what everything else assumes, and not only
  as a convention:

    - jp-shared is a Module Federation REMOTE. The four apps resolve its
      JavaScript at runtime from http://localhost:4999, not from node_modules.
    - SCSS is shared at BUILD time through each app's angular.json:
      "includePaths": ["../jp-shared/src/styles"]. That `../` is why the repos
      must sit side by side. A nested or renamed checkout breaks every build.

  There is no npm link step and no registry token any more — see PROJECT_MEMORY.

  It does NOT try to do the things that need a human: SQL Server, the dev
  settings files, and the JWT user-secrets. It prints those at the end.
==============================================================================*/

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siblings = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'Tarun1515';

const REPOS = [
  { name: 'jp-docs', kind: 'docs' },
  { name: 'jp-backend', kind: 'dotnet' },
  { name: 'jp-shared', kind: 'node' },
  { name: 'jp-admin', kind: 'node' },
  { name: 'jp-school', kind: 'node' },
  { name: 'jp-teacher', kind: 'node' },
  { name: 'jp-public', kind: 'node' },
];

const run = (command, cwd, { fatal = true } = {}) => {
  console.log(`  $ ${command}`);
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true });

  if (result.status !== 0 && fatal) {
    console.error(`\n  Failed: ${command}\n  in ${cwd}\n`);
    process.exit(result.status ?? 1);
  }

  return result.status === 0;
};

// ---- 1. clone ---------------------------------------------------------------
console.log('\n=== 1/3  repositories ===\n');

for (const { name } of REPOS) {
  const path = resolve(siblings, name);

  if (existsSync(path)) {
    console.log(`  ${name} — already present, skipped`);
    continue;
  }

  run(`git clone https://github.com/${ORG}/${name}.git`, siblings);
}

// ---- 2. install -------------------------------------------------------------
console.log('\n=== 2/3  npm install ===\n');

for (const { name, kind } of REPOS) {
  if (kind !== 'node') continue;

  const path = resolve(siblings, name);
  console.log(`\n  ${name}`);
  run('npm install', path, { fatal: false });
}

// ---- 3. what still needs a human -------------------------------------------
console.log('\n=== 3/3  still to do by hand ===\n');
console.log('  1. SQL Server 2019 on localhost\\TARUN, then:');
console.log('       cd ..\\jp-backend');
console.log('       sqlcmd -S localhost\\TARUN -E -b -f 65001 -i database\\run_all.sql\n');
console.log('  2. Dev settings (gitignored — copy the committed examples):');
console.log('       copy JP.Sso.Api\\appsettings.Development.example.json ^');
console.log('            JP.Sso.Api\\appsettings.Development.json');
console.log('       copy JP.App.Api\\appsettings.Development.example.json ^');
console.log('            JP.App.Api\\appsettings.Development.json\n');
console.log('  3. The SAME JWT signing key in BOTH APIs — see jp-backend/README.md\n');
console.log('  4. The first administrator:');
console.log('       cd JP.Tools.SeedAdmin && dotnet run -- --email you@example.com --generate\n');

console.log('  Then, to run anything at all:\n');
console.log('       cd ..\\jp-shared  && npm start     # :4999 — START THIS FIRST');
console.log('       cd ..\\jp-admin   && npm start     # :4200');
console.log('       cd ..\\jp-school  && npm start     # :4300');
console.log('       cd ..\\jp-teacher && npm start     # :4400');
console.log('       cd ..\\jp-public  && npm start     # :4500 (standalone — no remote)\n');
console.log('  🔴 jp-shared must be running before jp-admin, jp-school or jp-teacher.');
console.log('     They load their components from it at runtime; without it they');
console.log('     boot to a blank page. jp-public does not need it.\n');
