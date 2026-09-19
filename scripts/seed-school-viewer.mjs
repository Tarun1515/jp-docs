/*
  SEEDS THE SCHOOL VIEWER TEST ACCOUNT — through the real endpoints, never SQL.

  ----------------------------------------------------------------------------
  🔴 WHY A SCRIPT AND NOT A .sql SEED
  ----------------------------------------------------------------------------
  The password is PBKDF2 at 210,000 iterations, derived by the application. A
  hash written into database/jp_sso/03_seed/ would be a credential shared by
  every clone, every branch and every backup, for ever — which is the whole
  reason JP.Tools.SeedAdmin exists and why no admin row is seeded either
  (HOW_TO_RUN §2.5).

  ⚠️ And JP.Tools.SeedAdmin CANNOT create this one. It calls
  USP_CreateAdminUser and its --role flag accepts SUPER_ADMIN, ADMIN and
  SUPPORT_ADMIN only. A school Viewer is not an administrator; it is a
  colleague, and a colleague arrives exactly one way:

      POST /api/school/team/invite          (the owner invites, jp_sso + jp_app)
      -> invitation email, dev = mail-drop  (carries a one-time token)
      POST /api/auth/set-password-from-invite

  That is the same path a real Viewer walks, hashed by the same service the
  login endpoint verifies with, and nothing here ever knows a hash.

  ----------------------------------------------------------------------------
  IDEMPOTENT
  ----------------------------------------------------------------------------
  Run it as often as you like. If the account is already on the team and can
  already sign in, it changes nothing and says so — re-inviting would be
  refused as ALREADY_A_MEMBER anyway, and the original token was stored only as
  a hash, so it cannot be reissued (see TeamController.Invite).

  Needs: JP.Sso.Api :5199 and JP.App.Api :5299 running.
  Run:   node scripts/seed-school-viewer.mjs
*/
import fs from 'node:fs';
import path from 'node:path';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

/*
  ⚠️ jp-school's mail drop is JP.App.Api's, not JP.Sso.Api's. The team invite is
  sent by the APPLICATION api (it is the one that knows which school and who
  invited them), so the .eml lands under JP.App.Api/App_Data. An earlier
  version of this looked in the SSO folder and waited ten seconds for an email
  that was already written somewhere else.
*/
const MAIL_DROP = 'D:/Projects/jp-backend/JP.App.Api/App_Data/mail-drop';

// 🔴 The owner of the school the jobs suite exercises (SchoolId 4). The Viewer
// has to be in THAT school or it signs in and sees an empty list, which would
// pass a "no New job button" assertion while proving nothing.
const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };

// Recorded in jp-docs/local-accounts.md (gitignored) and referenced from
// HOW_TO_RUN §4. Keep all three in step.
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: 'Viewer#2026!', name: 'Priya Menon' };

const ROLE_VIEWER = 4;   // SchoolRoles.Viewer -> jp_sso SCHOOL_VIEWER

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep the text */ }

  return { http: r.status, body: b, text: t };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (id, pw) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: id, password: pw }),
  });

  return r.body?.data ?? null;
};

const say = (ok, message) => console.log(`  ${ok ? 'OK   ' : 'FAIL '} ${message}`);

// ---------------------------------------------------------------------------
console.log('\n=== SCHOOL VIEWER TEST ACCOUNT ===\n');

// 1. Already usable? Then there is nothing to do.
const existing = await login(VIEWER.id, VIEWER.pw);

if (existing?.accessToken) {
  say(true, `${VIEWER.id} already signs in — roles ${existing.roles.join(', ')}`);
  say(true, `permissions: ${existing.permissions.join(', ')}`);
  console.log('\n  Nothing to do.\n');
  process.exit(0);
}

const owner = await login(OWNER.id, OWNER.pw);

if (!owner?.accessToken) {
  console.error(`  Could not sign in as ${OWNER.id}. Check jp-docs/local-accounts.md.`);
  process.exit(1);
}

const auth = { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` };

// 2. The campuses this Viewer will be able to see. ALL of them: a Viewer scoped
//    to nothing signs in to an empty school, which is a different fixture.
const team = (await j(`${APP}/school/team`, { headers: auth })).body?.data;
const branchIds = (team?.campuses ?? []).map((c) => c.branchId);

say(branchIds.length > 0, `${team?.schoolName ?? 'the school'} has ${branchIds.length} campus(es): ` +
  `${(team?.campuses ?? []).map((c) => c.branchName).join(' · ')}`);

// 3. Invite.
const invited = await j(`${APP}/school/team/invite`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    email: VIEWER.id, fullName: VIEWER.name, roleInSchool: ROLE_VIEWER,
    designationText: 'Front office', branchIds,
  }),
});

if (invited.http !== 200) {
  console.error(`  Invite failed: HTTP ${invited.http} — ${invited.body?.message ?? invited.text}`);
  process.exit(1);
}

say(true, `invited: ${invited.body?.message}`);

if (invited.body?.data?.alreadyOnTeam) {
  /*
    🔴 STOP RATHER THAN IMPROVISE. They are on the team but the sign-in at the
    top failed, so the invitation was never redeemed and the token exists only
    as a hash — there is no way to reissue it and no way to set a password from
    here that is not hand-rolling one.

    The clean route is the product's own: forgot-password, which writes a fresh
    .eml to the same drop folder.
  */
  console.error(
    '\n  On the team already, but the password has never been set.\n' +
    '  The original invite token cannot be reissued (only its hash was stored).\n' +
    `  Use forgot-password for ${VIEWER.id}, then set it to the password in\n` +
    '  local-accounts.md. Do NOT write a hash into SQL.\n');
  process.exit(1);
}

// 4. The token, out of the mail drop.
const readMail = () => {
  if (!fs.existsSync(MAIL_DROP)) return null;

  return fs.readdirSync(MAIL_DROP)
    .map((f) => ({ f, t: fs.statSync(path.join(MAIL_DROP, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((d) => { try { return fs.readFileSync(path.join(MAIL_DROP, d.f), 'utf8'); } catch { return ''; } })
    .find((c) => c.includes(VIEWER.id)) ?? null;
};

let mail = null;
for (let attempt = 0; attempt < 20 && mail === null; attempt++) {
  mail = readMail();
  if (mail === null) await wait(500);
}

say(!!mail, mail ? 'the invitation email was written to the drop folder' : 'no email within 10s');

const tokenMatch = mail?.match(/accept-invite\?token=([A-Za-z0-9_-]+)/);

if (!tokenMatch) {
  console.error('  The email carries no redeemable token. Nothing was changed.');
  process.exit(1);
}

// 5. Redeem it — the app hashes the password, here as in production.
const redeemed = await j(`${SSO}/auth/set-password-from-invite`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: decodeURIComponent(tokenMatch[1]), password: VIEWER.pw }),
});

say(redeemed.http === 200, `set-password-from-invite: HTTP ${redeemed.http} — ${redeemed.body?.message ?? ''}`);

// 6. Prove it, rather than assume it.
const session = await login(VIEWER.id, VIEWER.pw);

if (!session?.accessToken) {
  console.error('  The account was created but will not sign in. Stopping.');
  process.exit(1);
}

say(session.roles.includes('SCHOOL_VIEWER'), `roles: ${session.roles.join(', ')}`);
say(session.permissions.includes('JOB.VIEW') && !session.permissions.includes('JOB.CREATE'),
  `permissions: ${session.permissions.join(', ')}`);

console.log(`
  ----------------------------------------------------------------------
  ${VIEWER.id}  /  ${VIEWER.pw}
  Record it in jp-docs/local-accounts.md if it is not there already.
  ----------------------------------------------------------------------
`);
