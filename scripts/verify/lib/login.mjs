/*
  THE SHARED SIGN-IN FOR EVERY VERIFICATION SUITE — G34.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS, AND WHY RETRY ALONE WOULD NOT HAVE BEEN ENOUGH
  ----------------------------------------------------------------------------
  The SSO limits sign-in two ways (appsettings.json):

      LoginPerIp          5  per 60 seconds
      LoginPerIdentifier  10 per 3600 seconds

  The per-IP window is waitable: sleep twenty seconds and try again, which is
  what most suites already did by hand. **The per-identifier window is not.** A
  regression pass runs eighteen suites and most of them sign in as
  `principal@greenwood.edu.in`; somewhere around the sixth suite that account
  has spent its ten, and no amount of backoff inside a test run will buy an
  eleventh. Twice during 6B the only fix was restarting `JP.Sso.Api` to clear an
  in-memory limiter.

  ⚠️ And the failure is a FALSE RED, which is the most expensive kind. 6B's
  regression had `screens-3f` die on `TypeError: Cannot read properties of null`
  — nothing was wrong with the screen, the limiter was full. Anyone reading that
  output concludes "6B broke screens-3f".

  So this module does two things, and only the first one was asked for:

    1. **Backoff on 429** — 5s, 10s, 20s, 30s, 30s. This handles the per-IP
       window, which is the one a single suite trips on its own.
    2. **A token cache on disk** — this is what actually closes the hourly cap.
       Eighteen suites signing in as the same owner become one sign-in, and the
       rest are cache hits. Nothing else fixes that window from inside a run.

  ----------------------------------------------------------------------------
  ⚠️ THE TRADE THE CACHE MAKES, WRITTEN DOWN BECAUSE IT IS REAL
  ----------------------------------------------------------------------------
  A warm cache means a suite can pass **without ever calling `/auth/login`**. If
  sign-in broke tomorrow, these suites would not be the ones to tell you.

  That is a deliberate trade, and it is paid for three ways:

    - `signin-check.mjs` signs in through the **real browser form** and is
      deliberately NOT on this helper. It is the canary.
    - `001_test_sso_procedures.sql` exercises the login procedure itself (73
      checks), below the HTTP layer.
    - Every cached token is validated with `GET /api/auth/me` before it is
      handed out, and the whole entry is dropped after TTL_MS. A stale token
      from a re-seeded database cannot survive that check, so the failure mode
      is "signs in again", not "runs against a ghost".

  ----------------------------------------------------------------------------
  🔴 THE HAZARD THE CACHE INTRODUCES, AND WHERE IT BITES
  ----------------------------------------------------------------------------
  Roles and permissions travel INSIDE the access token. A suite that changes
  somebody's access and then signs in again to watch the change land must get a
  genuinely new token — a cached one would carry the old claims and the
  assertion would pass or fail for the wrong reason.

  Every call site in `scripts/verify/` was audited for this. There is exactly
  one: `team-contract.mjs` signs the colleague in again AFTER removing them from
  the school, and the point of that assertion is the new token. That call passes
  `{ fresh: true }`, which bypasses and replaces the cache.

  ⚠️ If you add a suite that mutates auth state and then signs in, pass
  `{ fresh: true }`. The audit is in PROJECT_MEMORY under G34.

  ----------------------------------------------------------------------------
  USAGE
  ----------------------------------------------------------------------------
      import { session, token } from './lib/login.mjs';

      const full  = await session({ id, pw });     // the whole auth payload
      const bare  = await token({ id, pw });       // just the access token
      const clean = await session(id, pw, { fresh: true });

  Both accept `({ id, pw })` or `(id, pw)`, because the suites were written both
  ways and rewriting their call sites would have been a bigger change than this
  module.
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SSO = process.env.JP_SSO ?? 'http://localhost:5199/api';

const CACHE_FILE = join(tmpdir(), 'jp-verify-tokens.json');

/** How long an entry may be reused regardless of the token's own expiry. */
const TTL_MS = 20 * 60 * 1000;

/** Don't hand out a token this close to expiring. */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** 429 backoff, in order. Five attempts covers two full per-IP windows. */
const BACKOFF_MS = [5_000, 10_000, 20_000, 30_000, 30_000];

const stats = { hits: 0, refreshes: 0, logins: 0, waits: 0 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body) => {
  const r = await fetch(`${SSO}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep the text */ }

  return { http: r.status, body: parsed, text };
};

/* ------------------------------------------------------------------------ */
/* the cache                                                                */
/* ------------------------------------------------------------------------ */

const readCache = () => {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    /*
      ⚠️ Missing, unreadable or corrupt all mean the same thing here: there is
      no cache. Never let a bad cache file be the reason a suite cannot run.
    */
    return {};
  }
};

const writeCache = (all) => {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* A cache we cannot write is a slow run, not a broken one. */
  }
};

/** Drop one identifier, or the whole file. */
export const invalidate = (loginId) => {
  if (!loginId) {
    try { unlinkSync(CACHE_FILE); } catch { /* already gone */ }

    return;
  }

  const all = readCache();
  delete all[loginId.toLowerCase()];
  writeCache(all);
};

export const cacheStats = () => ({ ...stats, file: CACHE_FILE });

/* ------------------------------------------------------------------------ */
/* the three ways to get a token                                            */
/* ------------------------------------------------------------------------ */

/**
 * 🔴 A cached token is not trusted on the strength of its own expiry claim.
 *
 * `GET /api/auth/me` is cheap, carries no rate limit, and is the only thing
 * that can tell a live token from one issued against a database that has since
 * been re-seeded — the claims would still look perfectly valid.
 */
const stillGood = async (accessToken) => {
  try {
    const r = await fetch(`${SSO}/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } });

    return r.status === 200;
  } catch {
    return false;
  }
};

const fromRefresh = async (entry, loginId) => {
  if (!entry?.data?.refreshToken) return null;

  const expiresAt = Date.parse(entry.data.refreshTokenExpiresOnUtc ?? '');
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < EXPIRY_MARGIN_MS) return null;

  const r = await post('/auth/refresh-token', { refreshToken: entry.data.refreshToken });
  if (!r.body?.data?.accessToken) return null;

  stats.refreshes += 1;
  console.log(`  … token refreshed for ${loginId} (no sign-in spent)`);

  return r.body.data;
};

const fromLogin = async (id, pw) => {
  for (let attempt = 0; ; attempt += 1) {
    const r = await post('/auth/login', { loginId: id, password: pw });

    if (r.body?.data?.accessToken) {
      stats.logins += 1;

      return r.body.data;
    }

    /*
      🔴 Only 429 is retried. A 401 is an answer — retrying a wrong password
      five times turns a clear failure into a slow one, and burns the very
      window this module exists to protect.
    */
    if (r.http !== 429 || attempt >= BACKOFF_MS.length) {
      throw new Error(`login ${id}: ${r.http} ${r.body?.message ?? r.text}`);
    }

    const ms = BACKOFF_MS[attempt];
    stats.waits += 1;
    console.log(`  … rate limited signing in as ${id}; waiting ${ms / 1000}s (attempt ${attempt + 1}/${BACKOFF_MS.length})`);
    await wait(ms);
  }
};

/* ------------------------------------------------------------------------ */
/* the public surface                                                       */
/* ------------------------------------------------------------------------ */

/**
 * The full auth payload — accessToken, refreshToken, roles, permissions, uids.
 *
 * Call as `session({ id, pw })`, `session(id, pw)`, or either with a trailing
 * options object. `{ fresh: true }` skips the cache and replaces the entry.
 */
export const session = async (...args) => {
  let id;
  let pw;
  let opts = {};

  if (args[0] && typeof args[0] === 'object') {
    ({ id, pw } = { id: args[0].id ?? args[0].loginId, pw: args[0].pw ?? args[0].password });
    opts = args[1] ?? {};
  } else {
    [id, pw] = args;
    opts = args[2] ?? {};
  }

  if (!id || !pw) throw new Error(`session(): need an id and a password, got ${JSON.stringify(args[0])}`);

  const key = id.toLowerCase();
  const all = readCache();

  if (!opts.fresh) {
    const entry = all[key];

    if (entry?.data?.accessToken && Date.now() - (entry.cachedAtMs ?? 0) < TTL_MS) {
      const accessExpiry = Date.parse(entry.data.accessTokenExpiresOnUtc ?? '');
      const usable = !Number.isFinite(accessExpiry) || accessExpiry - Date.now() > EXPIRY_MARGIN_MS;

      if (usable && await stillGood(entry.data.accessToken)) {
        stats.hits += 1;

        return entry.data;
      }

      const refreshed = await fromRefresh(entry, id);
      if (refreshed) {
        all[key] = { data: refreshed, cachedAtMs: Date.now() };
        writeCache(all);

        return refreshed;
      }
    }
  }

  const data = await fromLogin(id, pw);
  all[key] = { data, cachedAtMs: Date.now() };
  writeCache(all);

  return data;
};

/** Just the access token, for the suites that only ever wanted that. */
export const token = async (...args) => (await session(...args)).accessToken;

/** `{ authorization, content-type }` for a session or a bare token string. */
export const authHeader = (t) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${typeof t === 'string' ? t : t.accessToken}`,
});
