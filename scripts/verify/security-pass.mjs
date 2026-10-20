/*
  PHASE 8A — THE SECURITY PASS, AS A TABLE OF EVIDENCE.

  ----------------------------------------------------------------------------
    1. HEADERS      five on both APIs, four on Swagger (CSP exempt), and on a
                    429 — because a header only on the happy path is missing
                    when something is wrong
    2. 🔴 CSP       the public site's policy loaded in a real browser, zero
                    violations across six pages — the first version of it
                    broke every one
    3. PAGING       every list endpoint clamps, probed with pageSize=10000
    4. UPLOADS      a disallowed extension is refused, by the storage layer
    5. CORS         the allowlist, and a foreign origin refused on a real
                    preflight
    6. JWT          lifetime from the token's own exp claim, and refresh
    7. 🔒 ERRORS    every refusal class forced, and no stack or SQL in any body
    8. 🔒 2.56      the file grep and the SQL dependency guard, one final time
    9. SECRETS      every appsettings*.json audited by script, not by eye

  ----------------------------------------------------------------------------
  🔴 WHY A SUITE AND NOT A CHECKLIST
  ----------------------------------------------------------------------------
  A security checklist is a document that was true on the day it was written.
  Every line below is a request made now, against the running product, and the
  numbers are printed so the reader can disagree with them.

  ⚠️ WHERE SOMETHING IS ASSERTED FROM CODE RATHER THAN MEASURED, THE
  ASSERTION SAYS SO. Two items cannot be measured from outside without
  restarting an API in a different environment, and pretending otherwise would
  be the kind of claim this file exists to replace.

  Run (both APIs, jp-public :4500, jp-shared :4999):
      node scripts/verify/security-pass.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { session as loginSession } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/bhard/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);

const APP = 'http://localhost:5299/api';
const SSO = 'http://localhost:5199/api';
const SITE = 'http://localhost:4500';
const BACKEND = 'D:/Projects/jp-backend';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const SUPER = 'superadmin@teacherportal.local';
const OWNER = 'principal@greenwood.edu.in';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

/** Headers and body, with the body consumed — an unread body holds a socket. */
const call = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const text = await r.text();

  return {
    http: r.status,
    headers: Object.fromEntries([...r.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])),
    text,
    body: (() => { try { return JSON.parse(text); } catch { return null; } })(),
  };
};

let browser;

try {
  const superSession = await loginSession({ id: SUPER, pw: secret(SUPER) });
  const ownerSession = await loginSession({ id: OWNER, pw: secret(OWNER) });

  const bearer = (s) => ({ authorization: `Bearer ${s.accessToken}` });

  // =========================================================================
  section('1. HEADERS — five on both APIs, and on the responses that go wrong');
  // =========================================================================

  const EXPECTED = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-resource-policy': 'same-origin',
  };

  for (const [label, url] of [['App API', `${APP}/public/jobs/filters`], ['SSO API', `${SSO}/masters/lookup?key=states`]]) {
    const r = await call(url);
    const missing = Object.entries(EXPECTED)
      .filter(([k, v]) => r.headers[k] !== v)
      .map(([k]) => k);

    check(`${label}: the four fixed headers are present and correct`,
      missing.length === 0,
      missing.length ? `WRONG/MISSING: ${missing.join(', ')}` : Object.keys(EXPECTED).join(', '));

    check(`${label}: and a CSP that allows nothing — it serves JSON`,
      /default-src 'none'/.test(r.headers['content-security-policy'] ?? ''),
      r.headers['content-security-policy'] ?? 'ABSENT');
  }

  /*
    🔴 SWAGGER IS THE CSP'S ONE EXEMPTION, AND IT IS A REAL PAGE. default-src
    'none' would serve a blank Swagger UI — a security change that breaks the
    thing nobody tests. The other four still apply.
  */
  const swagger = await call('http://localhost:5299/swagger/index.html');

  check('Swagger: the CSP is exempt, so the page still works',
    swagger.http === 200 && !swagger.headers['content-security-policy'],
    `HTTP ${swagger.http}, CSP ${swagger.headers['content-security-policy'] ? 'PRESENT' : 'absent'}`);

  check('Swagger: …but nosniff and frame refusal still apply to it',
    swagger.headers['x-content-type-options'] === 'nosniff'
      && swagger.headers['x-frame-options'] === 'DENY',
    'the exemption is the CSP alone');

  /*
    ⚠️ THE ORDERING ARGUMENT, MEASURED. The headers middleware was first placed
    just before UseCors, and Swagger — registered earlier — short-circuited
    past it and came back with NONE of them. Moving it to the first line after
    Build() fixed that, and this assertion is what would catch the regression.
  */
  const refused = await call(`${SSO}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: 'nobody@example.com', password: 'wrong' }),
  });

  check('🔴 a REFUSAL carries the headers too — they are not on the happy path only',
    refused.headers['x-content-type-options'] === 'nosniff'
      && !!refused.headers['content-security-policy'],
    `HTTP ${refused.http} with ${Object.keys(refused.headers).filter((h) => h.startsWith('x-') || h.startsWith('content-s')).length} security header(s)`);

  // ---- the public site ---------------------------------------------------
  const site = await call(`${SITE}/`);

  check('jp-public: nosniff, referrer policy and frame refusal',
    site.headers['x-content-type-options'] === 'nosniff'
      && site.headers['x-frame-options'] === 'DENY'
      && /strict-origin/.test(site.headers['referrer-policy'] ?? ''),
    site.headers['referrer-policy'] ?? 'ABSENT');

  /*
    ⚠️ A DIFFERENT CSP FROM THE APIS', AND THAT IS THE POINT. This serves real
    pages with real scripts; `default-src 'none'` here would be a blank site.
  */
  const csp = site.headers['content-security-policy'] ?? '';

  check('jp-public: a CSP built for pages, not for JSON',
    /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp),
    csp.slice(0, 100));

  check('🔒 jp-public: no wildcard anywhere in the policy',
    !/\*/.test(csp), csp.includes('*') ? 'WILDCARD PRESENT' : 'every source is named');

  check('⚠️ jp-public: script-src still allows inline — the named weak spot (G47)',
    /script-src [^;]*'unsafe-inline'/.test(csp),
    'Angular event replay emits per-page inline scripts; the fix is a nonce');

  // =========================================================================
  section('2. 🔴 CSP — the policy in a real browser, on six real pages');
  // =========================================================================

  /*
    🔴 THIS IS THE ASSERTION THAT MATTERS MOST IN THIS FILE.

    The first version of this CSP was written from what the site "obviously"
    loads. In Chromium it produced four violations on every page: <base href>
    blocked, the Google Fonts stylesheet refused, and Angular's inline event
    replay script refused. The site rendered unstyled and nothing in the
    server log said a word.

    A CSP is the one security header that can take a site down, so it is the
    one that must be measured in a browser rather than reasoned about.
  */
  browser = await chromium.launch();

  const pages = ['/', '/jobs', '/faq', '/contact', '/about', '/how-it-works'];
  let totalViolations = 0;

  for (const route of pages) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const violations = [];

    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 120));
    });

    await page.goto(`${SITE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    totalViolations += violations.length;

    if (violations.length) {
      console.log(`      ${route}: ${violations[0]}`);
    }

    await context.close();
  }

  check('🔴 zero CSP violations across every public page',
    totalViolations === 0, `${pages.length} pages, ${totalViolations} violation(s)`);

  /*
    ⚠️ AND THE PAGE IS ACTUALLY STYLED, which is the non-vacuous half: a policy
    that blocks the stylesheet produces no violation count worth having if
    nobody checks the page still looks like itself.
  */
  const styleCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const stylePage = await styleCtx.newPage();

  await stylePage.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await stylePage.waitForTimeout(2000);

  const typography = await stylePage.evaluate(() => {
    const h1 = document.querySelector('h1');
    const cs = h1 ? getComputedStyle(h1) : null;

    return {
      size: cs ? parseInt(cs.fontSize, 10) : 0,
      family: cs ? cs.fontFamily : '',
      sheets: document.styleSheets.length,
      faces: document.fonts ? document.fonts.size : 0,
    };
  });

  console.log(`\n    h1 ${typography.size}px · ${typography.family.split(',')[0]}`
    + ` · ${typography.sheets} stylesheet(s) · ${typography.faces} font face(s)\n`);

  check('🔴 …and the site is STYLED under that policy, not merely silent',
    typography.size >= 32 && typography.sheets > 0 && typography.faces > 0,
    `h1 ${typography.size}px, ${typography.faces} font faces loaded`);

  await styleCtx.close();

  // =========================================================================
  section('3. PAGING — every list endpoint clamps what it is asked for');
  // =========================================================================

  const maxPageSize = 200;

  const lists = [
    ['SSO users', `${SSO}/users?pageSize=10000&pageNumber=1`, superSession],
    ['app reports queue', `${APP}/admin/desk/reports?pageSize=10000`, superSession],
    ['app enquiries', `${APP}/admin/desk/enquiries?pageSize=10000`, superSession],
    ['moderation jobs', `${APP}/admin/desk/jobs?pageSize=10000`, superSession],
    ['public jobs', `${APP}/public/jobs?pageSize=10000`, null],
  ];

  for (const [label, url, who] of lists) {
    const r = await call(url, who ? { headers: bearer(who) } : {});
    const rows = Array.isArray(r.body?.data) ? r.body.data.length : -1;

    check(`${label}: pageSize=10000 returns at most ${maxPageSize}`,
      r.http === 200 && rows >= 0 && rows <= maxPageSize,
      `HTTP ${r.http}, ${rows} row(s)`);
  }

  // =========================================================================
  section('4. UPLOADS — a disallowed type is refused by the storage layer');
  // =========================================================================

  /*
    ⚠️ ASSERTED FROM THE STORAGE SERVICE, not by uploading. Driving a real
    multipart upload needs a school fixture and writes a file to disk; what
    matters here is that the allowlist exists, is applied before the write, and
    that the size is checked BOTH before and after — a chunked upload reports
    no length up front, which is the hole an extension check alone leaves.
  */
  const storage = fs.readFileSync(
    path.join(BACKEND, 'JP.Infrastructure/Storage/LocalDiskFileStorageService.cs'), 'utf8',
  );

  check('the storage layer refuses an extension outside its allowlist',
    /AllowedExtensions\.Contains/.test(storage) && /are not accepted/.test(storage),
    'checked before the file is written');

  /*
    ⚠️ MATCHED AGAINST WHAT THE CODE SAYS, NOT WHAT I EXPECTED IT TO SAY. The
    first version of this looked for "MaxBytes" and failed on a service that
    is correct — the limit is MaxFileSizeKb and it is applied twice: once on
    content.Length when the stream can seek, and once on bytesWritten
    afterwards, because a chunked upload reports no length up front.
  */
  const limitChecks = (storage.match(/MaxFileSizeKb \* 1024L/g) ?? []).length;

  check('🔴 …and the size is checked BEFORE and AFTER the write',
    limitChecks >= 2
      && /content\.CanSeek && content\.Length/.test(storage)
      && /bytesWritten >/.test(storage),
    `${limitChecks} limit comparisons: content.Length before, bytesWritten after`);

  // =========================================================================
  section('5. CORS — the allowlist, and a foreign origin on a real preflight');
  // =========================================================================

  const corsConfig = JSON.parse(
    fs.readFileSync(path.join(BACKEND, 'JP.App.Api/appsettings.json'), 'utf8').replace(/^\uFEFF/, ''),
  ).Cors.AllowedOrigins;

  console.log(`\n    allowlist: ${corsConfig.join(' · ')}\n`);

  /*
    🔴 FOUR, NOT FIVE — AND THAT IS CORRECT, MEASURED RATHER THAN ASSUMED.

    The four host apps call the APIs. jp-shared on :4999 is the federation
    REMOTE: the four apps import modules from it, but those modules execute on
    the HOST's origin, so an API call from jp-school is an API call from :4300.
    jp-shared's own page is a probe that renders two components and calls
    nothing.

    Adding :4999 would widen the allowlist for an origin that never calls —
    which is the opposite of what a security pass is for.
  */
  check('🔒 the allowlist is exactly the four host apps',
    corsConfig.length === 4
      && ['4200', '4300', '4400', '4500'].every((p) => corsConfig.some((o) => o.endsWith(p))),
    `${corsConfig.length} origins — jp-shared :4999 is a remote, not a caller`);

  const preflight = async (origin) => {
    const r = await fetch(`${APP}/public/jobs/filters`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    await r.text();

    return r.headers.get('access-control-allow-origin');
  };

  const allowed = await preflight('http://localhost:4300');
  const foreign = await preflight('https://evil.example.com');

  check('an allowed origin gets an Allow-Origin header back',
    allowed === 'http://localhost:4300', allowed ?? 'ABSENT');

  check('🔒 …and a foreign origin does NOT',
    !foreign, foreign ? `ALLOWED: ${foreign}` : 'no Allow-Origin header');

  // =========================================================================
  section('6. JWT — the lifetime from the token itself, and refresh');
  // =========================================================================

  const claims = JSON.parse(
    Buffer.from(superSession.accessToken.split('.')[1], 'base64url').toString('utf8'),
  );

  const lifetimeMinutes = Math.round((claims.exp - claims.iat) / 60);

  console.log(`\n    access token: ${lifetimeMinutes} minute lifetime, `
    + `${Object.keys(claims).length} claims\n`);

  check('the access token lives one hour, from its own exp and iat',
    lifetimeMinutes === 60, `${lifetimeMinutes} minutes`);

  /*
    🔒 NO PASSWORD-SHAPED CLAIM, AND NO EMAIL BEYOND THE SUBJECT. A token is
    sent on every request and sits in browser storage; what it carries is what
    leaks when storage leaks.
  */
  const claimText = JSON.stringify(claims).toLowerCase();

  check('🔒 the token carries no password, hash or secret',
    !/password|hash|secret|salt/.test(claimText),
    Object.keys(claims).join(', ').slice(0, 90));

  const expired = await call(`${SSO}/users?pageSize=1`, {
    headers: { authorization: 'Bearer not.a.real.token' },
  });

  check('🔒 a malformed token is refused, not ignored',
    expired.http === 401, `HTTP ${expired.http}`);

  // =========================================================================
  section('7. 🔒 ERRORS — every class forced, and nothing leaks in the body');
  // =========================================================================

  /*
    🔴 THE STATUS IS ASSERTED AGAINST THE LABEL, AND THAT IS A CORRECTION.

    The first version forced its two 400s through the public contact form — the
    one endpoint with a 3-per-hour budget. By the time this suite ran, earlier
    probes had spent it, so both came back 429 and the leak check happily
    examined two rate-limit messages while the table printed "400 validation".
    A passing assertion about the wrong response is worse than a failing one.

    So the 400s now go through an authenticated route with no public budget,
    and every row's status must match the class it claims to be.
  */
  const reportUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 LOWER(CAST(ReportUid AS varchar(50))) FROM t_app_reports WHERE Is_Deleted = 0;`);

  const forced = [
    /* 400: a body the validator refuses, on a route with no public limit. */
    [400, 'validation', await call(`${APP}/admin/desk/faqs`, {
      method: 'POST',
      headers: { ...bearer(superSession), 'content-type': 'application/json' },
      body: JSON.stringify({ category: '', question: '', answer: '', displayOrder: 0 }),
    })],
    [400, 'malformed json', await call(`${APP}/admin/desk/faqs`, {
      method: 'POST',
      headers: { ...bearer(superSession), 'content-type': 'application/json' },
      body: '{nope',
    })],
    [401, 'no token', await call(`${SSO}/users?pageSize=1`)],
    [403, 'wrong audience', await call(`${APP}/admin/desk/analytics`, { headers: bearer(ownerSession) })],
    [404, 'not found', await call(`${APP}/public/jobs/00000000-0000-0000-0000-000000000000`)],
  ];

  console.log('');

  for (const [want, label, r] of forced) {
    const ok = r.http === want ? '  ' : '!!';

    console.log(`  ${ok}  ${label.padEnd(16)} want ${want} got ${r.http}  `
      + `${r.text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }

  console.log('');

  const wrongClass = forced.filter(([want, , r]) => r.http !== want);

  check('🔴 every forced refusal returned the class it claims — no 429 standing in',
    wrongClass.length === 0,
    wrongClass.length
      ? wrongClass.map(([w, l, r]) => `${l}: wanted ${w}, got ${r.http}`).join(' · ')
      : forced.map(([w]) => w).join(' · '));

  const leaky = forced.filter(([, , r]) =>
    /at JP\.|\bStackTrace\b|Microsoft\.Data\.SqlClient|USP_|Invalid column|System\.\w+Exception/i
      .test(r.text));

  check('🔒 no forced refusal leaks a stack frame, a procedure name or SQL',
    leaky.length === 0,
    leaky.length ? `LEAKED in: ${leaky.map(([, l]) => l).join(', ')}` : `${forced.length} classes checked`);

  check('…and every one of them is a JSON envelope, not a server error page',
    forced.every(([, , r]) => r.body !== null && 'status' in r.body),
    '2.21 — Status/Code/Message on every answer');

  /*
    ⚠️ ASSERTED FROM CODE, AND SAYING SO. The unhandled-exception path cannot
    be forced from outside without breaking something real, so what is checked
    is the handler itself: it never serialises a stack trace, and the exception
    type and message reach the client in DEVELOPMENT ONLY.
  */
  const handler = fs.readFileSync(
    path.join(BACKEND, 'JP.Infrastructure/Middleware/GlobalExceptionHandlerMiddleware.cs'), 'utf8',
  );

  check('🔒 the global handler never serialises a stack trace',
    !/StackTrace/.test(handler), 'no StackTrace reference in the file');

  check('🔒 …and the exception type reaches the client in DEVELOPMENT only',
    /_environment\.IsDevelopment\(\)/.test(handler),
    'production gets a fixed generic message');

  // =========================================================================
  section('8. 🔒 2.56 — the file grep and the dependency guard, one final time');
  // =========================================================================

  const unlockConsumers = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT OBJECT_NAME(d.referencing_id)
      FROM sys.sql_expression_dependencies d
     WHERE d.referenced_entity_name = 'fn_TeacherContactUnlocked'
     ORDER BY 1;`);

  console.log(`\n    fn_TeacherContactUnlocked consumers: ${unlockConsumers.join(', ')}\n`);

  check('🔒 2.56: the unlock function has exactly its two known consumers',
    unlockConsumers.length === 2
      && unlockConsumers.includes('USP_GetTeacherContactForSchool')
      && unlockConsumers.includes('USP_GetApplicantById'),
    unlockConsumers.join(', '));

  const contactGuard = fs.readFileSync(
    path.join(BACKEND, 'JP.App.Api/Startup/ContactLeakGuard.cs'), 'utf8',
  );

  check('🔒 …and the startup guard over the school-facing shapes is still wired',
    /TeacherBrowseDto/.test(contactGuard) && /TeacherSearchResultDto/.test(contactGuard)
      && /SchoolInviteDto/.test(contactGuard),
    'three shapes guarded');

  // =========================================================================
  section('9. SECRETS — every appsettings audited by script, not by eye');
  // =========================================================================

  /*
    🔴 BY SCRIPT, BECAUSE 2.16 IS A RULE ABOUT FILES AND FILES MULTIPLY. G36
    was exactly this: a rule everybody believed was held, broken in 32 files,
    found by grepping rather than by remembering.
  */
  const settingsFiles = [];

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['bin', 'obj', '.git', 'node_modules'].includes(e.name)) continue;

      const p = path.join(dir, e.name);

      if (e.isDirectory()) walk(p);
      else if (/^appsettings.*\.json$/i.test(e.name)) settingsFiles.push(p);
    }
  };

  walk(BACKEND);

  const SECRET_KEYS = /"(Password|Pwd|Secret|ApiKey|AccessKey|PrivateKey|ConnectionString|Jwt:?Key|Key)"\s*:\s*"([^"]*)"/gi;
  const offenders = [];

  for (const file of settingsFiles) {
    const text = fs.readFileSync(file, 'utf8');

    for (const m of text.matchAll(SECRET_KEYS)) {
      const value = m[2];

      /*
        ⚠️ An empty value or an obvious placeholder is the CORRECT state — the
        contract is declared and the value comes from user-secrets or the
        environment. Only a populated-looking secret is a finding.
      */
      if (value && value.length > 8 && !/^\s*$/.test(value)
          && !/placeholder|changeme|your-|example|\$\{|%[A-Z_]+%/i.test(value)) {
        offenders.push(`${path.basename(path.dirname(file))}/${path.basename(file)}: ${m[1]}`);
      }
    }
  }

  console.log(`\n    audited ${settingsFiles.length} appsettings file(s)\n`);

  check('🔒 no populated secret in any appsettings file (2.16)',
    offenders.length === 0,
    offenders.length ? `FOUND: ${offenders.join(' · ')}` : `${settingsFiles.length} files clean`);

  const ignored = execFileSync('git', ['check-ignore', 'local-accounts.md'], {
    cwd: 'D:/Projects/jp-docs', encoding: 'utf8',
  }).trim();

  check('🔒 local-accounts.md is still gitignored (G0)',
    ignored === 'local-accounts.md', ignored || 'NOT IGNORED');

  const literals = execFileSync('git', ['grep', '-c', '-F', 'Greenwood#2027!'], {
    cwd: 'D:/Projects/jp-docs', encoding: 'utf8',
  }).trim();

  check('🔒 …and no seeded password is back in the repository (G36)',
    literals === '', literals || 'zero occurrences');
} catch (error) {
  /* git grep exits 1 when it finds nothing — which is the passing case. */
  if (error?.status === 1 && /git/.test(String(error.message))) {
    check('🔒 …and no seeded password is back in the repository (G36)',
      true, 'zero occurrences (git grep found none)');
  } else {
    check('the suite ran to completion', false, String(error).slice(0, 300));
  }
} finally {
  if (browser) await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

  if (failed.length) {
    console.log(`\n  ${failed.length} FAILED:`);
    failed.forEach((f) => console.log(`    x ${f.name}${f.detail ? `  — ${f.detail}` : ''}`));
  }

  console.log('='.repeat(74));

  process.exitCode = failed.length ? 1 : 0;
}
