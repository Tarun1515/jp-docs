/*
  START THE WHOLE STACK, IN ORDER, FROM COLD.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS — SR-5
  ----------------------------------------------------------------------------
  Seven processes, in an order that matters, each in its own terminal, each
  taking a different time to answer. Getting that wrong is the most common way
  a demo starts badly: jp-shared is not up yet, the other four fail to resolve
  `jp-shared/ui` over federation, and four browser tabs show a blank page with
  a console error nobody is going to read in front of a client.

  ⚠️ jp-shared FIRST, AND IT IS NOT A PREFERENCE. The four Angular hosts load
  `jp-shared/ui` as an IMPORT MAP entry resolved in the BROWSER at runtime, not
  bundled. If :4999 is not answering when a host page loads, that host is
  broken until reloaded — and it will not recover on its own.

  ⚠️ IT KILLS WHATEVER HOLDS A PORT FIRST. A stale `ng serve` from a previous
  session is the second most common bad start: the port answers, so everything
  looks fine, and it is serving code from before your last change. "It answers"
  is not "it is yours".

  ----------------------------------------------------------------------------
  WHAT IT DOES NOT DO
  ----------------------------------------------------------------------------
  It does not start SQL Server (a Windows service), does not build anything,
  and does not seed. It starts processes and waits for each to answer.

  Usage:
      node scripts/start-all.mjs           # everything
      node scripts/start-all.mjs --apis    # just the two APIs
      node scripts/stop-all.mjs            # the other direction
*/
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LOGS = join(HERE, '..', '.run-logs');

mkdirSync(LOGS, { recursive: true });

const apisOnly = process.argv.includes('--apis');

/*
  🔴 THE ORDER IS THE POINT. jp-shared before the hosts that import from it;
  the APIs before the screens that call them.

  `ready` is the path that proves the process is SERVING, not merely listening.
  A port opens before Angular has finished its first compile, so waiting on the
  socket alone reports ready while the page is still a 404.
*/
const SERVICES = [
  { name: 'JP.Sso.Api', port: 5199, kind: 'api',
    cwd: join(ROOT, 'jp-backend'),
    cmd: 'dotnet', args: ['run', '--project', 'JP.Sso.Api', '--no-build'],
    ready: '/swagger/index.html' },

  { name: 'JP.App.Api', port: 5299, kind: 'api',
    cwd: join(ROOT, 'jp-backend'),
    cmd: 'dotnet', args: ['run', '--project', 'JP.App.Api', '--no-build'],
    ready: '/swagger/index.html' },

  { name: 'jp-shared', port: 4999, kind: 'web',
    cwd: join(ROOT, 'jp-shared'),
    cmd: 'npx', args: ['ng', 'serve', '--port', '4999'],
    ready: '/remoteEntry.json' },

  { name: 'jp-admin', port: 4200, kind: 'web', cwd: join(ROOT, 'jp-admin'),
    cmd: 'npx', args: ['ng', 'serve', '--port', '4200'], ready: '/' },

  { name: 'jp-school', port: 4300, kind: 'web', cwd: join(ROOT, 'jp-school'),
    cmd: 'npx', args: ['ng', 'serve', '--port', '4300'], ready: '/' },

  { name: 'jp-teacher', port: 4400, kind: 'web', cwd: join(ROOT, 'jp-teacher'),
    cmd: 'npx', args: ['ng', 'serve', '--port', '4400'], ready: '/' },

  { name: 'jp-public', port: 4500, kind: 'web', cwd: join(ROOT, 'jp-public'),
    cmd: 'npx', args: ['ng', 'serve', '--port', '4500'], ready: '/' },
];

const wanted = apisOnly ? SERVICES.filter((s) => s.kind === 'api') : SERVICES;

/** Whoever is holding this port, whether or not we started it. */
const holders = (port) => {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });

    return [...new Set(out.split(/\r?\n/)
      .filter((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
      .map((l) => l.trim().split(/\s+/).pop())
      .filter((pid) => pid && pid !== '0'))];
  } catch {
    return [];
  }
};

const kill = (pid) => {
  try {
    execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const answers = async (port, path) => {
  try {
    const r = await fetch(`http://localhost:${port}${path}`, {
      signal: AbortSignal.timeout(2500),
    });

    /*
      ⚠️ ANY answer counts, including a 404. What is being asked is "is a
      server on the other end", not "is this URL right" — jp-public's SSR root
      and an Angular dev server answer differently and both are up.
    */
    return r.status > 0;
  } catch {
    return false;
  }
};

const waitFor = async (service, seconds) => {
  const until = Date.now() + seconds * 1000;

  while (Date.now() < until) {
    if (await answers(service.port, service.ready)) {
      return Math.round((seconds * 1000 - (until - Date.now())) / 1000);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return null;
};

console.log(`\n  Starting ${wanted.length} service(s). Logs in ${LOGS}\n`);

const started = [];

for (const service of wanted) {
  /* 1. whatever is on the port is not ours — take it. */
  const existing = holders(service.port);

  if (existing.length) {
    const killed = existing.filter(kill);

    console.log(`  ${service.name.padEnd(12)} port ${service.port}: killed stale PID ${killed.join(', ')}`);

    /* A killed listener does not release the port instantly. */
    await new Promise((r) => setTimeout(r, 1500));
  }

  /*
    2. Start it, with its output kept.

    🔴 THE STDIO IS A FILE DESCRIPTOR, NOT A PIPE — and the first version of
    this used pipes with detached:true and produced seven EMPTY log files and
    seven timeouts. On Windows, detaching a shell-spawned child into its own
    process group and then unref-ing it severs the pipes before anything is
    written, so every service "failed to answer" while `ng serve` run by hand
    in the same directory worked perfectly.

    Writing to an open fd has no such problem: the child inherits the handle
    and writes to the file directly, with no parent-side plumbing to sever.

    ⚠️ NOT detached. A detached child on Windows survives its parent anyway,
    and detaching it is what broke the output. The script outliving the
    services is not the goal — the services outliving the SCRIPT is, and they
    do: node does not kill children when it exits.
  */
  const logPath = join(LOGS, `${service.name}.log`);
  const fd = openSync(logPath, 'w');

  /*
    ⚠️ ONE COMMAND STRING, NOT A COMMAND PLUS AN ARGS ARRAY. Node warns
    (DEP0190) that args passed alongside shell:true are concatenated without
    escaping — which is true, and is a real hazard anywhere the pieces come
    from input. Here every piece is a literal in SERVICES above, so the
    concatenation is the thing we actually want; writing it as one string
    says so instead of tripping a warning that then gets ignored.
  */
  const child = spawn([service.cmd, ...service.args].join(' '), {
    cwd: service.cwd,
    shell: true,
    stdio: ['ignore', fd, fd],
  });

  child.unref();

  /*
    ⚠️ APIs answer in seconds, Angular's first compile takes much longer on a
    cold start. One timeout for both would either give up on ng serve or make
    a failed API take a minute to report.
  */
  const budget = service.kind === 'api' ? 60 : 180;
  const took = await waitFor(service, budget);

  started.push({ ...service, pid: child.pid, took });

  console.log(`  ${service.name.padEnd(12)} port ${service.port}: `
    + (took === null
      ? `🔴 NO ANSWER after ${budget}s — see ${service.name}.log`
      : `up in ${took}s`));
}

/* ---- the status table --------------------------------------------------- */
console.log(`\n${'='.repeat(62)}`);
console.log('  SERVICE       PORT   STATUS     URL');
console.log('='.repeat(62));

let down = 0;

for (const s of started) {
  const ok = s.took !== null;

  if (!ok) down++;

  console.log(`  ${s.name.padEnd(13)} ${String(s.port).padEnd(6)} `
    + `${(ok ? 'up' : 'DOWN').padEnd(10)} http://localhost:${s.port}`);
}

console.log('='.repeat(62));

if (down) {
  console.log(`\n  🔴 ${down} service(s) did not answer. Their logs are in ${LOGS}.`);
  console.log('     A service that is DOWN here will look like a broken page, not an error.');
  process.exitCode = 1;
} else {
  console.log('\n  All up. The regression entry point is:');
  console.log('      node scripts/verify/run.mjs');
  console.log('\n  ⚠️ public-contract asserts a 3-per-hour rate limit. If you ran a');
  console.log('     regression within the last hour, restart JP.App.Api first:');
  console.log('      node scripts/start-all.mjs --apis');
}
