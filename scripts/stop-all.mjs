/*
  STOP EVERYTHING THIS PROJECT STARTS.

  ----------------------------------------------------------------------------
  🔴 BY PORT, NOT BY IMAGE NAME — AND THAT IS DELIBERATE
  ----------------------------------------------------------------------------
  The obvious implementation is `taskkill /IM node.exe`, and it is wrong: this
  machine runs other node processes — editors, language servers, whatever else
  is open — and killing them all to stop four dev servers is a bad trade
  somebody only notices afterwards.

  So this kills exactly what is LISTENING on this project's seven ports, and
  names each one before it does.

  ⚠️ IT STOPS WHAT IS ON THE PORT, WHOEVER STARTED IT. That is the point: a
  stale server from a previous session is precisely what you are trying to be
  rid of, and it will not be one of your children.

  ----------------------------------------------------------------------------
  ⚠️ WHAT IT DOES NOT TOUCH
  ----------------------------------------------------------------------------
  SQL Server, LocalDB, and anything on a port not listed here. It also does not
  tear down the demo fixture — `scripts/demo/demo-teardown.sql` does that, and
  it is a separate decision.

  🔴 AND A LESSON FROM 2026-10-25: the demo fixture from the 20 October client
  demo was still live five days later, so `run_all.sql` would have failed on
  the priced-public-plan guard. A fixture that must be torn down by hand
  eventually is not. If you set the demo up, tear it down in the same sitting.

  Usage:
      node scripts/stop-all.mjs
      node scripts/stop-all.mjs --web     # leave the APIs running
*/
import { execFileSync } from 'node:child_process';

const PORTS = [
  { port: 5199, name: 'JP.Sso.Api', kind: 'api' },
  { port: 5299, name: 'JP.App.Api', kind: 'api' },
  { port: 4999, name: 'jp-shared', kind: 'web' },
  { port: 4200, name: 'jp-admin', kind: 'web' },
  { port: 4300, name: 'jp-school', kind: 'web' },
  { port: 4400, name: 'jp-teacher', kind: 'web' },
  { port: 4500, name: 'jp-public', kind: 'web' },
];

const webOnly = process.argv.includes('--web');
const wanted = webOnly ? PORTS.filter((p) => p.kind === 'web') : PORTS;

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

console.log(`\n  Stopping ${wanted.length} port(s).\n`);

let stopped = 0;
let already = 0;

for (const { port, name } of wanted) {
  const pids = holders(port);

  if (!pids.length) {
    console.log(`  ${name.padEnd(13)} ${String(port).padEnd(6)} already stopped`);
    already++;
    continue;
  }

  const killed = [];

  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
      killed.push(pid);
    } catch {
      /* Already gone between the listing and the kill — not a failure. */
    }
  }

  console.log(`  ${name.padEnd(13)} ${String(port).padEnd(6)} stopped PID ${killed.join(', ') || '(none)'}`);
  stopped += killed.length;
}

/*
  ⚠️ VERIFIED, NOT ASSUMED. taskkill returns before the socket is released, and
  "I stopped it" followed by a port that is still answering is how the next
  start-all silently reuses a stale server.
*/
await new Promise((r) => setTimeout(r, 1500));

const stillUp = wanted.filter(({ port }) => holders(port).length);

console.log(`\n  ${stopped} process(es) stopped, ${already} already down.`);

if (stillUp.length) {
  console.log(`  🔴 STILL LISTENING: ${stillUp.map((s) => `${s.name}:${s.port}`).join(', ')}`);
  console.log('     Something restarted them, or they are owned by another user.');
  process.exitCode = 1;
} else {
  console.log('  Every port is free.');
}
