#!/usr/bin/env node
/*==============================================================================
  Set up a new machine: clone all seven repositories as siblings, install each,
  and link the shared library for development.

    node scripts/bootstrap.mjs            clone anything missing, install, link
    node scripts/bootstrap.mjs --no-link  install against the published package

  Run it from inside jp-docs. It works on the folder ABOVE jp-docs, so the seven
  repos end up as siblings — which is what every other script and README assumes.

  Seven clones and seven installs is a lot of ceremony to get wrong by hand, and
  getting it wrong tends to fail late and confusingly: an app that quietly
  installed a published package when you meant to link it looks fine until you
  cannot work out why your change is not showing up.

  It does NOT try to do the things that need a human: the GitHub token, SQL
  Server, and the JWT user-secrets. It prints those at the end instead.
==============================================================================*/

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siblings = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'Tarun1515';
const linkShared = !process.argv.includes('--no-link');

const REPOS = [
  { name: 'jp-docs', kind: 'docs' },
  { name: 'jp-backend', kind: 'dotnet' },
  { name: 'jp-shared', kind: 'library' },
  { name: 'jp-admin', kind: 'app' },
  { name: 'jp-school', kind: 'app' },
  { name: 'jp-teacher', kind: 'app' },
  { name: 'jp-public', kind: 'app' },
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
console.log('\n=== 1/4  repositories ===\n');

for (const { name } of REPOS) {
  const path = resolve(siblings, name);

  if (existsSync(path)) {
    console.log(`  ${name} — already present, skipped`);
    continue;
  }

  run(`git clone https://github.com/${ORG}/${name}.git`, siblings);
}

// ---- 2. shared library ------------------------------------------------------
// Built before the apps install, because a linked app resolves this output and
// an unbuilt library links to an empty directory.
console.log('\n=== 2/4  jp-shared ===\n');

const sharedPath = resolve(siblings, 'jp-shared');
run('npm install', sharedPath);
run('npm run build', sharedPath);

if (linkShared) {
  run('npm link', resolve(sharedPath, 'dist/jp-shared'));
}

// ---- 3. apps ----------------------------------------------------------------
console.log('\n=== 3/4  applications ===\n');

for (const { name, kind } of REPOS) {
  if (kind !== 'app') {
    continue;
  }

  const path = resolve(siblings, name);
  console.log(`\n--- ${name} ---`);

  // Installing the published package needs a token. Without one npm reports a
  // 404, not a 401, so the message would be misleading — say so plainly rather
  // than letting the run die on it.
  const installed = run('npm install', path, { fatal: false });

  if (!installed) {
    console.log(`\n  ${name}: npm install failed.`);
    console.log('  If it mentions 404 for @tarun1515/jp-shared, that is almost certainly');
    console.log('  a missing GITHUB_TOKEN or .npmrc. See the checklist below.\n');
    continue;
  }

  if (linkShared) {
    run('npm link @tarun1515/jp-shared', path, { fatal: false });
  }
}

// ---- 4. what still needs a human -------------------------------------------
console.log('\n=== 4/4  still to do by hand ===\n');
console.log('  1. GitHub Packages token');
console.log('       cp .npmrc.example .npmrc          (in jp-shared and each app)');
console.log('       setx GITHUB_TOKEN "ghp_..."       needs read:packages');
console.log('       Only needed for the PUBLISHED package. A linked setup does not use it.');
console.log('');
console.log('  2. SQL Server 2019, instance localhost\\TARUN, Windows auth');
console.log('       cd ../jp-backend');
console.log('       sqlcmd -S localhost\\TARUN -E -b -f 65001 -i database\\run_all.sql');
console.log('');
console.log('  3. JWT signing key — the SAME value in BOTH APIs, or every call to');
console.log('     JP.App.Api returns 401 with nothing in the logs explaining why');
console.log('       cd ../jp-backend/JP.Sso.Api ; dotnet user-secrets set "Jwt:Key" "<64+ chars>"');
console.log('       cd ../JP.App.Api           ; dotnet user-secrets set "Jwt:Key" "<same value>"');
console.log('');
console.log('  4. Dev settings');
console.log('       copy appsettings.Development.example.json to appsettings.Development.json');
console.log('       in both API projects');
console.log('');
console.log('  5. First administrator');
console.log('       cd ../jp-backend/JP.Tools.SeedAdmin');
console.log('       dotnet run -- --email you@example.com --generate');
console.log('');
console.log('  Then check everything agrees:  node scripts/check-versions.mjs');
console.log('');
