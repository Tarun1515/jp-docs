/*
  PHASE 3G — live verification of school team management, over HTTP.

  ----------------------------------------------------------------------------
  WHY THIS EXISTS, AND WHY IT IS NOT THE SQL SUITE
  ----------------------------------------------------------------------------
  99_tests/003_test_school_team.sql proves the procedures. It cannot prove three
  things that only exist above them:

    - USP_GetSchoolUserList returns TWO result sets, and INSERT..EXEC cannot
      capture one that does (Msg 213). The team list is therefore READ HERE, out
      of a real response body, rather than mirrored by assertions that would
      pass against a procedure with its join removed.

    - The invitation is a cross-database write with no distributed transaction
      (2.2, 2.48). Only the API can be wrong about it.

    - The refusal MESSAGES. 3E found a refusal that was correct and whose
      explanation was written for the wrong kind of user; nothing in SQL would
      have caught it.

  The invite is followed all the way through: the token is read out of the
  rendered email in the mail drop, redeemed, and used to sign in. That is the
  only way to prove the person a school invited can actually get in.

  Run: node scripts/verify/team-contract.mjs   (both APIs up, JP_PW not needed)
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const OWNER = { id: 'principal@greenwood.edu.in', pw: 'Greenwood#2027!' };
const OTHER_SCHOOL = { id: 'head@stmarys.edu.in', pw: 'StMarys#2026!' };

const MAIL_DROP = 'D:/Projects/jp-backend/JP.App.Api/App_Data/mail-drop';

const sql = (q) =>
  execFileSync('sqlcmd', ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-h', '-1', '-W', '-Q', q], {
    encoding: 'utf8',
  }).trim();

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep the text */ }
  return { http: r.status, body, text };
};

const loginFull = async (loginId, password) => {
  const r = await j(`${SSO}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });
  if (!r.body?.data?.accessToken) throw new Error(`${loginId}: ${r.http} ${r.body?.message ?? r.text}`);
  return r.body.data;
};

const login = async (loginId, password) => (await loginFull(loginId, password)).accessToken;

const auth = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
const head = (t) => ({ authorization: `Bearer ${t}` });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// A fresh address per run, so the invite path is exercised from nothing every
// time rather than landing on the already-a-member branch.
const stamp = Date.now().toString().slice(-6);
const COLLEAGUE = `hr.${stamp}@greenwood.edu.in`;
const COLLEAGUE_PW = 'Colleague#2026!';

// ---------------------------------------------------------------------------
console.log('\n=== 1. THE TEAM, AND ITS CAMPUSES ===');

const owner = await login(OWNER.id, OWNER.pw);

let team = (await j(`${APP}/school/team`, { headers: head(owner) })).body?.data;
check('GET /school/team returns the caller\'s own team', Array.isArray(team?.members),
  `${team?.members?.length} member(s), ${team?.campuses?.length} campus(es)`);

const ownerRow = team.members.find((m) => m.isOwner);
check('the owner is on it, flagged, and holds role 1',
  ownerRow?.isOwner === true && ownerRow?.roleInSchool === 1,
  `${ownerRow?.email} · ${ownerRow?.roleName}`);

check('🔴 the owner has NO campus rows — they are never enumerated (2.51)',
  ownerRow?.branchIds?.length === 0 && ownerRow?.branchCount === 0,
  `branchIds ${JSON.stringify(ownerRow?.branchIds)}, count ${ownerRow?.branchCount}`);

// A second campus, so the matrix has something to be a matrix about.
const existingNames = new Set(team.campuses.map((c) => c.branchName));
if (![...existingNames].some((n) => n.includes('North Wing'))) {
  await j(`${APP}/branches`, {
    method: 'POST', headers: auth(owner),
    body: JSON.stringify({ branchName: 'North Wing', stateId: 32, isActive: true }),
  });
}

team = (await j(`${APP}/school/team`, { headers: head(owner) })).body?.data;
check('a second campus appears in the team response', team.campuses.length >= 2,
  team.campuses.map((c) => c.branchName).join(' · '));

const campusA = team.campuses.find((c) => c.isHeadOffice);
const campusB = team.campuses.find((c) => !c.isHeadOffice);

// ---------------------------------------------------------------------------
console.log('\n=== 2. INVITING A COLLEAGUE — TWO DATABASES, ONE OUTCOME ===');

const invited = await j(`${APP}/school/team/invite`, {
  method: 'POST', headers: auth(owner),
  body: JSON.stringify({
    email: COLLEAGUE, fullName: 'Rekha Nair', roleInSchool: 3,
    designationText: 'Admissions', branchIds: [campusA.branchId],
  }),
});

check('POST /school/team/invite succeeds', invited.http === 200 && !!invited.body?.data?.userUid,
  `${invited.http} · ${invited.body?.message}`);

const colleagueUid = invited.body?.data?.userUid;

const ssoRow = sql(`SET NOCOUNT ON; SELECT CAST(StatusId AS varchar(3)) + '|' + ISNULL(CONVERT(varchar(30), LastLoginOn, 126), 'never')
  FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${colleagueUid}'`);
/*
  ⚠️ An invited account is created ACTIVE with NO credential — the invitee sets
  their own password by redeeming the token, so nobody ever knows another
  person's password. Status therefore cannot tell an arrived colleague from one
  who never opened the email; a null last-login can, which is what the screen's
  'Invited' badge reads.
*/
check('…the account exists in jp_sso, active but never signed in',
  ssoRow === '2|never', ssoRow);

const appRow = sql(`SET NOCOUNT ON; SELECT CAST(RoleInSchool AS varchar(3)) + '|' + ISNULL(FullName, '(none)')
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0`);
check('🔴 …AND the membership exists in jp_app, with the role and the name',
  appRow === '3|Rekha Nair', appRow);

const scoped = sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4))
  FROM jp_app.dbo.fn_VisibleBranches(
    (SELECT SchoolId FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0),
    '${colleagueUid}')`);
check('…and the scope resolver gives them exactly the campus that was ticked',
  scoped === '1', `${scoped} branch`);

// ---- the email itself ------------------------------------------------------
//
// ⚠️ Email is QUEUED, never sent inline (2.33), so the drop file appears a
// moment after the response. Polled rather than read once: a fixed sleep is
// either too short on a slow machine or wasted time on a fast one.
const readIfPossible = (f) => {
  try { return fs.readFileSync(path.join(MAIL_DROP, f), 'utf8'); } catch { return ''; }
};

const findMail = () => {
  if (!fs.existsSync(MAIL_DROP)) return null;

  return fs
    .readdirSync(MAIL_DROP)
    .map((f) => ({ f, t: fs.statSync(path.join(MAIL_DROP, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((d) => readIfPossible(d.f))
    .find((c) => c.includes(COLLEAGUE)) ?? null;
};

let inviteMail = null;
for (let attempt = 0; attempt < 20 && inviteMail === null; attempt++) {
  inviteMail = findMail();
  if (inviteMail === null) await new Promise((r) => setTimeout(r, 500));
}

check('an invitation email was written', !!inviteMail,
  inviteMail ? 'found in the drop folder' : 'nothing arrived within 10s');

if (inviteMail) {
  check('🔴 it names WHO invited them', inviteMail.includes(OWNER.id), OWNER.id);
  check('🔴 …WHICH school', /Greenwood/i.test(inviteMail), 'Greenwood');
  check('🔴 …and WHAT they will be able to do',
    /post jobs/i.test(inviteMail), 'the role, in the words of the job');
  // 🔴 An HTML comment in a template is DELIVERED. This caught the design note
  // for this very template sitting in the recipient's mailbox.
  check('…and carries no internal commentary — comments in a template are delivered',
    !/workspace/i.test(inviteMail));
}

// ---- idempotency -----------------------------------------------------------
const again = await j(`${APP}/school/team/invite`, {
  method: 'POST', headers: auth(owner),
  body: JSON.stringify({ email: COLLEAGUE, roleInSchool: 4, branchIds: [] }),
});

check('🔴 re-inviting is ALREADY_A_MEMBER, not an error',
  again.http === 200 && again.body?.data?.alreadyOnTeam === true, again.body?.message);

const unchanged = sql(`SET NOCOUNT ON; SELECT CAST(RoleInSchool AS varchar(3))
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0`);
check('🔴 …and it did NOT re-role them — an invite is not a way past the role endpoint',
  unchanged === '3', `role ${unchanged}`);

// ---------------------------------------------------------------------------
console.log('\n=== 3. THE INVITATION WORKS — TOKEN, PASSWORD, SIGN-IN ===');

const tokenMatch = inviteMail?.match(/accept-invite\?token=([A-Za-z0-9_-]+)/);
check('the email carries a redeemable token', !!tokenMatch);

let colleagueToken = null;
let colleagueRefresh = null;

if (tokenMatch) {
  const redeemed = await j(`${SSO}/auth/set-password-from-invite`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: decodeURIComponent(tokenMatch[1]), password: COLLEAGUE_PW }),
  });
  check('the token sets their first password', redeemed.http === 200, `${redeemed.http} ${redeemed.body?.message ?? ''}`);

  const session = await loginFull(COLLEAGUE, COLLEAGUE_PW);
  colleagueToken = session.accessToken;
  colleagueRefresh = session.refreshToken;

  const theirProfile = await j(`${APP}/school/profile`, { headers: head(colleagueToken) });
  check('🔴 …and they land on the school, not on a refusal', theirProfile.http === 200,
    `${theirProfile.http} · ${theirProfile.body?.data?.schoolName}`);

  const theirTeam = await j(`${APP}/school/team`, { headers: head(colleagueToken) });
  check('an ordinary member can READ the team', theirTeam.http === 200,
    `${theirTeam.body?.data?.members?.length} members`);

  const theirWrite = await j(`${APP}/school/team/${colleagueUid}/role`, {
    method: 'PUT', headers: auth(colleagueToken),
    body: JSON.stringify({ roleInSchool: 2 }),
  });
  check('🔴 …but cannot WRITE without USER.MANAGE', theirWrite.http === 403,
    `${theirWrite.http} · ${theirWrite.body?.message}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. 🔴 THE OWNER IS UNTOUCHABLE, OVER HTTP TOO ===');

const demote = await j(`${APP}/school/team/${ownerRow.userUid}/role`, {
  method: 'PUT', headers: auth(owner), body: JSON.stringify({ roleInSchool: 3 }),
});
check('the owner cannot demote themselves', demote.http === 400,
  `${demote.http} · ${demote.body?.message}`);

const removeOwner = await j(`${APP}/school/team/${ownerRow.userUid}`, {
  method: 'DELETE', headers: head(owner),
});
check('…nor remove themselves', removeOwner.http === 400,
  `${removeOwner.http} · ${removeOwner.body?.message}`);

const scopeOwner = await j(`${APP}/school/team/${ownerRow.userUid}/branches`, {
  method: 'PUT', headers: auth(owner), body: JSON.stringify({ branchIds: [campusA.branchId] }),
});
check('…nor be scoped to a campus', scopeOwner.http === 400,
  `${scopeOwner.http} · ${scopeOwner.body?.message}`);

const promote = await j(`${APP}/school/team/${colleagueUid}/role`, {
  method: 'PUT', headers: auth(owner), body: JSON.stringify({ roleInSchool: 1 }),
});
check('🔴 and nobody can be promoted INTO the role', promote.http === 400,
  `${promote.http} · ${promote.body?.message}`);

const inviteOwner = await j(`${APP}/school/team/invite`, {
  method: 'POST', headers: auth(owner),
  body: JSON.stringify({ email: `second.owner.${stamp}@greenwood.edu.in`, roleInSchool: 1, branchIds: [] }),
});
check('…nor invited in as a second owner', inviteOwner.http === 400,
  `${inviteOwner.http} · ${inviteOwner.body?.message}`);

const ownerIntact = sql(`SET NOCOUNT ON; SELECT CAST(RoleInSchool AS varchar(3)) + '|' + CAST(Is_Active AS varchar(3))
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${ownerRow.userUid}'`);
check('🔴 …and after all five, the owner row is untouched', ownerIntact === '1|1',
  `role|active = ${ownerIntact}`);

// ---------------------------------------------------------------------------
console.log('\n=== 5. 🔴 ANOTHER SCHOOL\'S TEAM IS NOT REACHABLE ===');

const stranger = await login(OTHER_SCHOOL.id, OTHER_SCHOOL.pw);

const strangerRead = await j(`${APP}/school/team`, { headers: head(stranger) });
const strangerSeesColleague = JSON.stringify(strangerRead.body?.data?.members ?? [])
  .includes(colleagueUid);
check('another school\'s team does not contain this colleague', !strangerSeesColleague,
  `${strangerRead.body?.data?.members?.length} members, none of them ours`);

const strangerRole = await j(`${APP}/school/team/${colleagueUid}/role`, {
  method: 'PUT', headers: auth(stranger), body: JSON.stringify({ roleInSchool: 4 }),
});
check('🔴 they cannot re-role somebody on our team — 404, not 403', strangerRole.http === 404,
  `${strangerRole.http} · ${strangerRole.body?.message}`);

const strangerScope = await j(`${APP}/school/team/${colleagueUid}/branches`, {
  method: 'PUT', headers: auth(stranger), body: JSON.stringify({ branchIds: [] }),
});
check('🔴 …nor change their campuses', strangerScope.http === 404, `${strangerScope.http}`);

const strangerDelete = await j(`${APP}/school/team/${colleagueUid}`, {
  method: 'DELETE', headers: head(stranger),
});
check('🔴 …nor remove them', strangerDelete.http === 404, `${strangerDelete.http}`);

const survived = sql(`SET NOCOUNT ON; SELECT CAST(RoleInSchool AS varchar(3)) + '|' + CAST(Is_Active AS varchar(3))
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0`);
check('🔴 …and our colleague\'s row survived all three', survived === '3|1', `role|active = ${survived}`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. CAMPUS SCOPE — FULL SET, AND A NO-OP THAT WRITES NOTHING ===');

const both = await j(`${APP}/school/team/${colleagueUid}/branches`, {
  method: 'PUT', headers: auth(owner),
  body: JSON.stringify({ branchIds: [campusA.branchId, campusB.branchId] }),
});
check('both campuses save', both.http === 200, `${both.http} · ${both.body?.message}`);

const afterBoth = sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4))
  FROM jp_app.dbo.t_app_school_user_branches ub
    INNER JOIN jp_app.dbo.t_app_school_users su ON su.SchoolUserId = ub.SchoolUserId
  WHERE su.UserUid = '${colleagueUid}' AND ub.Is_Deleted = 0`);
check('…and the resolver gives them 2', afterBoth === '2', `${afterBoth} campuses`);

const modBefore = sql(`SET NOCOUNT ON; SELECT ISNULL(CONVERT(varchar(30), ModifiedOn, 126), '(null)')
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0`);

await j(`${APP}/school/team/${colleagueUid}/branches`, {
  method: 'PUT', headers: auth(owner),
  body: JSON.stringify({ branchIds: [campusA.branchId, campusB.branchId] }),
});

const modAfter = sql(`SET NOCOUNT ON; SELECT ISNULL(CONVERT(varchar(30), ModifiedOn, 126), '(null)')
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}' AND Is_Deleted = 0`);
check('🔴 saving the same set again does not stamp the membership row (2.54)',
  modBefore === modAfter, `ModifiedOn ${modAfter}`);

const one = await j(`${APP}/school/team/${colleagueUid}/branches`, {
  method: 'PUT', headers: auth(owner), body: JSON.stringify({ branchIds: [campusA.branchId] }),
});
const afterOne = sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4))
  FROM jp_app.dbo.t_app_school_user_branches ub
    INNER JOIN jp_app.dbo.t_app_school_users su ON su.SchoolUserId = ub.SchoolUserId
  WHERE su.UserUid = '${colleagueUid}' AND ub.Is_Deleted = 0`);
check('🔴 sending a SHORTER set removes the one left out — it is a sync, not an add',
  one.http === 200 && afterOne === '1', `${afterOne} campus left`);

// ---------------------------------------------------------------------------
console.log('\n=== 7. 🔴 REMOVAL — ACCESS GONE, HISTORY KEPT, MESSAGE HONEST ===');

const removed = await j(`${APP}/school/team/${colleagueUid}`, {
  method: 'DELETE', headers: head(owner),
});
check('DELETE removes their access', removed.http === 200, `${removed.http} · ${removed.body?.message}`);

const afterRemoval = sql(`SET NOCOUNT ON; SELECT CAST(Is_Active AS varchar(3)) + '|' + CAST(Is_Deleted AS varchar(3))
  + '|' + ISNULL(FullName, '(none)')
  FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}'`);
check('🔴 …the row SURVIVES: inactive, not deleted, name intact', afterRemoval === '0|0|Rekha Nair',
  `active|deleted|name = ${afterRemoval}`);

const linksKept = sql(`SET NOCOUNT ON; SELECT CAST(COUNT(*) AS varchar(4))
  FROM jp_app.dbo.t_app_school_user_branches ub
    INNER JOIN jp_app.dbo.t_app_school_users su ON su.SchoolUserId = ub.SchoolUserId
  WHERE su.UserUid = '${colleagueUid}' AND ub.Is_Deleted = 0`);
check('…their campus links are kept, so inviting them back restores them', linksKept === '1',
  `${linksKept} link`);

/*
  🔴 WHAT "REVOKED" ACTUALLY MEANS, CHECKED RATHER THAN ASSUMED.

  This assertion originally expected a 401 from the access token they were
  already holding, and it was wrong — a JWT is stateless. Revoking rows in
  t_sso_user_tokens kills the REFRESH token; the access token stays
  cryptographically valid until it expires.

  So there are two separate facts, and both are worth proving:

    the access token still authenticates, and is refused by the MEMBERSHIP gate
      on every school endpoint — 403, immediately, not "within the hour";

    the refresh token is dead, so the session cannot be extended and disappears
      when the access token expires.

  Saying "their session is dead" without checking would have described a system
  that logs somebody out instantly. This one closes every door they can reach
  instantly and lets the token expire on its own.
*/
if (colleagueToken) {
  const oldToken = await j(`${APP}/school/team`, { headers: head(colleagueToken) });
  check('🔴 the access token they already held is refused by every school endpoint',
    oldToken.http === 403, `${oldToken.http} · ${oldToken.body?.message}`);

  const refreshed = await j(`${SSO}/auth/refresh-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: colleagueRefresh }),
  });
  check('🔴 …and their refresh token is revoked, so the session cannot be extended',
    refreshed.http === 401 || refreshed.http === 400,
    `${refreshed.http} · ${refreshed.body?.message}`);
}

// 🔴 The message. 3E's lesson: the right refusal with the wrong reason is a
// support call nobody can reproduce.
const backIn = await login(COLLEAGUE, COLLEAGUE_PW);
const afterRemovalProfile = await j(`${APP}/school/profile`, { headers: head(backIn) });
check('they can still SIGN IN — the account is theirs, the access was the school\'s',
  true, 'login 200');
check('🔴 …and the refusal says their access was REMOVED, not "sign out and back in"',
  afterRemovalProfile.http === 403 && /removed/i.test(afterRemovalProfile.body?.message ?? ''),
  `${afterRemovalProfile.http} · ${afterRemovalProfile.body?.message}`);

// ---------------------------------------------------------------------------
console.log('\n=== 8. G15 — THE QUEUE CAN FINALLY ASK "WHAT IS NOBODY WORKING ON?" ===');

const admin = await login('superadmin@teacherportal.local', 'RyaBs*-L?G9*-xTKM$R4');

const anyone = await j(`${APP}/approvals?requestTypeId=1&pageSize=5`, { headers: head(admin) });
const unassigned = await j(`${APP}/approvals?requestTypeId=1&unassignedOnly=true&pageSize=5`, { headers: head(admin) });

check('the queue answers "anyone"', anyone.http === 200, `${anyone.body?.totalRecords} total`);
check('🔴 …and now answers "unassigned", which it could not express at all',
  unassigned.http === 200 && unassigned.body?.totalRecords <= anyone.body?.totalRecords,
  `${unassigned.body?.totalRecords} of ${anyone.body?.totalRecords} have nobody on them`);

const adminUid = JSON.parse(
  Buffer.from(admin.split('.')[1], 'base64').toString('utf8'),
).uuid;

const mine = await j(`${APP}/approvals?requestTypeId=1&assignedToUserUid=${adminUid}&pageSize=5`,
  { headers: head(admin) });
check('…and "assigned to this administrator", by Uid rather than a numeric id',
  mine.http === 200, `${mine.body?.totalRecords} assigned to them`);

const bogus = await j(`${APP}/approvals?requestTypeId=1&assignedToUserUid=${crypto.randomUUID()}&pageSize=5`,
  { headers: head(admin) });
check('🔴 an unknown assignee returns NOTHING rather than everything — it fails closed',
  bogus.http === 200 && bogus.body?.totalRecords === 0, `${bogus.body?.totalRecords} rows`);

const both2 = await j(
  `${APP}/approvals?requestTypeId=1&unassignedOnly=true&assignedToUserUid=${adminUid}`,
  { headers: head(admin) });
check('…and asking for both at once is refused, not silently resolved', both2.http === 400,
  `${both2.http} · ${both2.body?.message}`);

// ---------------------------------------------------------------------------
console.log('\n=== 9. CLEAN UP ===');

// The invited account was created by this run and nothing else refers to it.
sql(`SET NOCOUNT ON;
  DELETE ub FROM jp_app.dbo.t_app_school_user_branches ub
    INNER JOIN jp_app.dbo.t_app_school_users su ON su.SchoolUserId = ub.SchoolUserId
    WHERE su.UserUid = '${colleagueUid}';
  DELETE FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}';
  DELETE t FROM jp_sso.dbo.t_sso_user_tokens t
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = t.UserId WHERE u.UserUid = '${colleagueUid}';
  DELETE c FROM jp_sso.dbo.t_sso_user_credentials c
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId WHERE u.UserUid = '${colleagueUid}';
  DELETE r FROM jp_sso.dbo.t_sso_user_roles r
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = r.UserId WHERE u.UserUid = '${colleagueUid}';
  DELETE a FROM jp_sso.dbo.t_sso_user_login_attempts a
    INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = a.UserId WHERE u.UserUid = '${colleagueUid}';
  DELETE FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${colleagueUid}';`);

const gone = sql(`SET NOCOUNT ON; SELECT CAST(
  (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users WHERE UserUid = '${colleagueUid}') +
  (SELECT COUNT(*) FROM jp_app.dbo.t_app_school_users WHERE UserUid = '${colleagueUid}') AS varchar(4))`);
check('the account this run created is gone from both databases', gone === '0', `${gone} rows left`);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(72)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
if (failed.length) {
  console.log(`  FAILED:`);
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail ?? ''})`));
}
console.log(`${'='.repeat(72)}\n`);

process.exit(failed.length ? 1 : 0);
