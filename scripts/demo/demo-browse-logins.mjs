/*
  THE DEMO LOGINS FOR THE BROWSE FIXTURE — printed, never written down.

  ----------------------------------------------------------------------------
  🔴 WHY THIS FILE EXISTS AT ALL
  ----------------------------------------------------------------------------
  demo-browse-setup.sql creates seven accounts that a human has to sign in as,
  in a browser, in front of a client. It does that without ever handling a
  password: it COPIES a donor account's credential row — hash, salt, algorithm
  and iteration count — into the new account through the shipped registration
  procedures. Same hash, same salt, same iterations, therefore the same
  password (second-tenant.mjs documents the trick; security-pass.mjs
  established it).

  Which means the demo accounts' password is the DONOR's password, and that
  value lives in exactly one place: the gitignored local-accounts.md, read
  through `secret()`.

  ⚠️ SO THIS SCRIPT IS THE MISSING HALF OF THAT DESIGN, not a convenience. The
  alternative is somebody opening local-accounts.md, reading a password, and
  typing it next to the demo emails in a chat message or a run sheet — which is
  how a gitignored file ends up quoted in a committed one. Here the pairing
  happens on a terminal and is gone when the window closes.

  ----------------------------------------------------------------------------
  🔴 WHAT IT DELIBERATELY DOES NOT DO
  ----------------------------------------------------------------------------
  It does not connect to the database. Not to check that the fixture is
  installed, not to read the accounts back, not for anything. The database on
  this project is shared and every access is serialised by the lead; a helper
  that prints a password list has no business opening a connection, and the
  setup script already verified its own rows and refused to finish if they were
  wrong.

  So the account list below is a CONSTANT, and that is the honest trade: it can
  drift from demo-browse-setup.sql. The guard against that is that both files
  are read in the same review, and the emails are the same literal strings in
  both — grep for `demo.browse.` and there is nowhere else to look.

  It holds no password of its own, not even a test one. Every value printed is
  a `secret()` lookup of a DONOR's email.

  ⚠️ team-contract.mjs carries a literal password. It is a known, recorded
  offender and it is NOT the pattern here.

  ----------------------------------------------------------------------------
  USAGE
  ----------------------------------------------------------------------------
      node scripts/demo/demo-browse-logins.mjs

  If demo-browse-setup.sql was run with different donors, pass the same ones:

      node scripts/demo/demo-browse-logins.mjs \
        --school-donor other@school.example --teacher-donor other@teacher.example

  🔴 A MISSING DONOR IS A LOUD FAILURE, not a blank password. `secret()` throws
  and names the accounts it does know, which is the same discipline
  accounts.mjs applies everywhere else: a suite that logs in with `undefined`
  reports the wrong failure, and a demo run sheet with a blank password sends
  somebody to the SSO API.
*/
import { secret } from '../verify/lib/accounts.mjs';

/*
  The defaults match demo-browse-setup.sql's own :setvar lines. An email address
  is not a secret; the password these resolve to is never in either file.
*/
const DEFAULT_SCHOOL_DONOR = 'principal@greenwood.edu.in';
const DEFAULT_TEACHER_DONOR = 'rohit.kulkarni.86002@yopmail.com';

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);

  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const schoolDonor = flag('school-donor', DEFAULT_SCHOOL_DONOR);
const teacherDonor = flag('teacher-donor', DEFAULT_TEACHER_DONOR);

/*
  ⚠️ THE SAME EMAILS AS THE SQL, AND IN THE SAME ORDER AS THE DEMO SCRIPT.
  `what` is what the account is FOR, because a run sheet that lists seven
  yopmail addresses without saying which one to open the browse as is a run
  sheet nobody can follow under pressure.
*/
const ACCOUNTS = [
  {
    role: 'school',
    email: 'demo.browse.gohana@yopmail.com',
    what: 'Gohana Public School (Demo) — Sonipat district. Its "Find teachers" screen is the one that must show nearby teachers.',
  },
  {
    role: 'school',
    email: 'demo.browse.hisar@yopmail.com',
    what: 'Hisar Modern School (Demo) — Hisar district.',
  },
  {
    role: 'school',
    email: 'demo.browse.karnal@yopmail.com',
    what: 'Karnal Heritage School (Demo) — Karnal district. Holds the advert that matches nobody.',
  },
  {
    role: 'teacher',
    email: 'demo.browse.english.gohana@yopmail.com',
    what: '★ START HERE. English, Gohana. Opens the browse pre-filled and the Gohana English advert is the match, at the top.',
  },
  {
    role: 'teacher',
    email: 'demo.browse.physics.sonipat@yopmail.com',
    what: 'Physics, lives in Sonipat, prefers Hisar. The second strict match, from another district.',
  },
  {
    role: 'teacher',
    email: 'demo.browse.loose.match@yopmail.com',
    what: '"You might like". Matches no advert on subject or qualification — her strict tab is EMPTY on purpose.',
  },
  {
    role: 'teacher',
    email: 'demo.browse.preferred.locs@yopmail.com',
    what: '"Preferred locations". Reaches adverts only through her class level and where she asked to work.',
  },
];

/*
  🔴 RESOLVED ONCE, BEFORE ANYTHING IS PRINTED. A half-printed list with the
  teacher rows missing because the second lookup threw is worse than no list:
  the reader takes the three school logins and goes looking for the teachers.
*/
const pw = {
  school: secret(schoolDonor),
  teacher: secret(teacherDonor),
};

const donorOf = { school: schoolDonor, teacher: teacherDonor };

const width = Math.max(...ACCOUNTS.map((a) => a.email.length));

console.log('\n  DEMO BROWSE FIXTURE — logins\n');
console.log(`  School accounts share the password of ${schoolDonor}`);
console.log(`  Teacher accounts share the password of ${teacherDonor}`);
console.log('  (the credential ROW was copied by demo-browse-setup.sql — G36)\n');

for (const a of ACCOUNTS) {
  console.log(`  ${a.role.padEnd(8)}${a.email.padEnd(width + 2)}${pw[a.role]}`);
  console.log(`  ${' '.repeat(8)}${a.what}\n`);
}

console.log('  Every one of these is on its free plan, unverified, and removed in full by');
console.log('  scripts/demo/demo-browse-teardown.sql.\n');

/*
  ⚠️ THE DONOR ACCOUNTS THEMSELVES ARE NOT A DEMO LOGIN. They are seeded
  accounts the suites use, and signing in as one during a demo would spend its
  per-identifier rate-limit window (lib/login.mjs: 10 per hour) and leave the
  regression unable to sign in afterwards.
*/
console.log(`  ⚠️ Do NOT sign in as the donors (${donorOf.school}, ${donorOf.teacher})`);
console.log('     during the demo — the suites share them and the SSO allows 10 sign-ins');
console.log('     per identifier per hour (lib/login.mjs).\n');
