/*
  THE LOCAL TEST ACCOUNTS, READ FROM THE ONE FILE THAT IS NOT COMMITTED. G36.

  ----------------------------------------------------------------------------
  WHY THIS EXISTS
  ----------------------------------------------------------------------------
  `local-accounts.md` has been gitignored since G0, and the rule written beside
  it is that a password does not go into the repository. The rule was broken
  anyway: by Phase 8-0 the seeded passwords appeared in 33 committed files, 98
  times, because every new suite copied the constant block from the last one.

  🔴 ONE FILE WAS STILL PAYING THE COST OF THE RULE. `signin-check.mjs` read
  its password from an environment variable and refused to run without one,
  while the same value sat in the history 98 times over. That is the shape G33
  had: a discipline kept in exactly one place, where it buys nothing and costs
  something.

  So the discipline moved here instead, and the suites all read through it.

  ----------------------------------------------------------------------------
  🟢 WHAT THIS IS NOT
  ----------------------------------------------------------------------------
  These are not production secrets. All three databases are local, the accounts
  are seeded, and `JP.Tools.SeedAdmin` is the only sanctioned way to make an
  administrator anywhere real. That is why G36 was amber rather than red.

  ⚠️ But the repositories are private TODAY and a handover is coming. A
  password in the history of a repository somebody else will clone is a
  password that has left the building, and "it was only local" is an argument
  that has to be made to whoever finds it rather than by whoever left it.

  ----------------------------------------------------------------------------
  WHERE THE VALUES COME FROM
  ----------------------------------------------------------------------------
      1. $JP_LOCAL_ACCOUNTS   — a path, if the file lives somewhere else
      2. jp-docs/local-accounts.md  — the default, gitignored

  ⚠️ A MISSING FILE IS A LOUD FAILURE, not an empty password. A suite that ran
  with `undefined` would report "login failed" and send somebody looking at the
  SSO API, which is the kind of misdirection this project keeps writing down.

  Usage:
      import { secret } from './lib/accounts.mjs';
      const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** jp-docs/local-accounts.md — two directories up from scripts/verify/lib. */
const DEFAULT_FILE = path.join(HERE, '..', '..', '..', 'local-accounts.md');

const FILE = process.env.JP_LOCAL_ACCOUNTS ?? DEFAULT_FILE;

/**
 * Every account in the table, email -> password.
 *
 * ⚠️ Parsed once and cached. The suites call this a dozen times at startup and
 * re-reading the file per call would be a dozen disk reads for one answer.
 */
let cache = null;

const parse = () => {
  if (cache) {
    return cache;
  }

  if (!fs.existsSync(FILE)) {
    throw new Error(
      `accounts: ${FILE} is missing.\n`
      + '  It is gitignored on purpose (G0) and holds the local seeded passwords.\n'
      + '  Either create it — the table format is in HOW_TO_RUN section 4 — or point\n'
      + '  JP_LOCAL_ACCOUNTS at wherever it lives on this machine.',
    );
  }

  const rows = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
  const found = new Map();

  for (const row of rows) {
    if (!row.startsWith('|')) {
      continue;
    }

    const cells = row.split('|').map((c) => c.trim());

    /*
      | email | password | type | role | notes |  ->  cells[1], cells[2]
      Both arrive wrapped in backticks; the header row and the separator row
      have no backticks and fall out here.
    */
    const email = cells[1]?.replace(/^`|`$/g, '');
    const secretCell = cells[2]?.replace(/^`|`$/g, '');

    if (!email?.includes('@') || !secretCell) {
      continue;
    }

    /*
      ⚠️ `*(yours)*` is a real row in that table — the developer's own teacher
      account, whose password nobody else knows. It is skipped rather than
      stored as a literal, so asking for it fails with the message below
      instead of attempting a login with the word "yours".
    */
    if (secretCell.startsWith('*')) {
      continue;
    }

    found.set(email.toLowerCase(), secretCell);
  }

  if (found.size === 0) {
    throw new Error(
      `accounts: ${FILE} has no account rows I could read.\n`
      + '  Expected markdown table rows shaped: | `email` | `password` | type | role | notes |',
    );
  }

  cache = found;

  return cache;
};

/**
 * The password for one seeded account.
 *
 * @throws if the file is missing, or the account is not in it — never returns
 * undefined, because a suite that logs in with undefined reports the wrong
 * failure.
 */
export const secret = (email) => {
  const all = parse();
  const found = all.get(String(email).toLowerCase());

  if (!found) {
    throw new Error(
      `accounts: no password for ${email} in ${FILE}.\n`
      + `  Accounts it does know: ${[...all.keys()].join(', ')}\n`
      + '  If this account is new, add its row to that file — do NOT put the\n'
      + '  password in a committed script (G36).',
    );
  }

  return found;
};

/** Every email the file knows, for a suite that wants to check its premises. */
export const knownAccounts = () => [...parse().keys()];
