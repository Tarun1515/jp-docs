/*
  A SUITE'S OWN SECOND TENANT — the cross-tenant negative, owned by the suite
  that asserts it.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS — TWO SUITES WERE ASSERTING AGAINST SOMEBODY ELSE'S ROWS
  ----------------------------------------------------------------------------
  `offers.mjs` and `team-contract.mjs` both need an actor who holds the
  permission and is in ANOTHER school, so that a refusal can only be the SCOPE.
  Both used `head@stmarys.edu.in`, a seeded school owner, because it was there.

  Then a school was registered live during the 20 October client demo against
  that same account. That gave it a SECOND school membership, and G23's
  documented refusal fired — `400 · Your account is linked to more than one
  school` — where both suites assert a cross-tenant `404`. One demo, four red
  assertions, and nothing wrong with the product: the suites were depending on
  rows they did not create.

  ⚠️ THE FIX IS NOT TO DELETE THE DEMO'S DATA, and it is not to special-case
  that email. It is the PRE-5b rule: a suite owns its fixtures. Each suite now
  creates its own second tenant, asserts against that, and takes it away again
  — so it passes whatever else is in the database, including a third membership
  somebody adds next week.

  ----------------------------------------------------------------------------
  WHAT IT TAKES TO BE A CREDIBLE SECOND TENANT, AND WHY EACH PART IS HERE
  ----------------------------------------------------------------------------
    UserTypeId 2        or ResolveSchoolIdAsync refuses with 'this is a school
                        area' before it ever looks at a membership.
    SCHOOL_OWNER        the role carries USER.MANAGE, OFFER.CREATE and
                        OFFER.APPROVE. 🔴 A scope negative needs an actor who
                        would otherwise be ALLOWED: an actor missing the
                        permission earns a 403 and proves nothing about scope.
                        offers.mjs learned that the hard way with the HR lead.
    EXACTLY ONE active  G23 refuses 0 memberships (403) and >1 (400). Only a
    membership          single-membership owner can produce the 404 these
                        suites are about — which is the whole incident above.
    a password          read through `secret()`, never written down. See below.

  ----------------------------------------------------------------------------
  🔴 HOW IT GETS A PASSWORD WITHOUT ONE BEING WRITTEN ANYWHERE — G36
  ----------------------------------------------------------------------------
  The credential ROW is copied from a donor account whose password the caller
  already reads out of the gitignored `local-accounts.md` through
  `secret(donor)`. Same hash, same salt, same iterations, therefore the same
  password — and this file contains no credential at all, not even a test one.
  `security-pass.mjs` established the trick for its probe administrator.

  ⚠️ NOT a hard-coded literal, and not a registration + OTP walk either. The
  REAL registration flow would mean a mail-drop poll and a verification screen
  to get an account these suites only need as a bystander. `sr-registration`
  walks that chain because the chain is its SUBJECT; here it would be ceremony
  with more ways to fail.

  ⚠️ ExpiresOn is deliberately NOT copied. It is a password-expiry stamp, and
  inheriting the donor's would make this fixture's login fail on a date.

  ----------------------------------------------------------------------------
  THE TWO STEPS THAT ARE NOT HAND-WRITTEN, AND WHY THEY ARE THE PROCEDURES
  ----------------------------------------------------------------------------
  The role grant and the school both come from the shipped procedures:

      USP_UpdateUserStatus            pending -> Active, which is where a
                                      school owner's SCHOOL_OWNER role is
                                      granted (jp_sso 006_admin.sql)
      USP_ProvisionSchoolFromApproval the school, its head office, its
                                      subscription and the owner membership,
                                      in one transaction (jp_app 001)

  Inserting those rows by hand would make this fixture a second definition of
  what a school is, and it would go stale the first time either procedure
  learns a new column — which is exactly what SR-3 found happening between two
  correct procedures.

  ----------------------------------------------------------------------------
  ⚠️ UNIQUE PER RUN, ON PURPOSE
  ----------------------------------------------------------------------------
  The email and the school name carry the run's timestamp, so:

    - nothing stale can be mistaken for this run's tenant, and
    - `lib/login.mjs`'s token cache can never hand back a token minted for a
      DELETED user of the same name. That token would authenticate, resolve to
      no membership, and turn the suite's 404 into a 403 — a false red with a
      very long explanation.

  The cost is one real sign-in per run per suite. That is a fresh identifier,
  so it spends nothing from the 10-per-hour window the shared helper exists to
  protect, and `session()` waits out the 5-per-minute-per-IP one.

  ----------------------------------------------------------------------------
  USAGE — ARRANGE, ASSERT, AND DROP IN A `finally`
  ----------------------------------------------------------------------------
      import { arrangeSecondTenant, dropSecondTenant, secondTenantRowsLeft }
        from './lib/second-tenant.mjs';

      dropSecondTenant(TAG);                      // a killed run's leftovers
      const other = arrangeSecondTenant(TAG, OWNER.id);
      check('premise: this run created its own second tenant', other.ok, other.detail);

      try {
        const stranger = await login(other.id, other.pw);
        ...
      } finally {
        dropSecondTenant(TAG);                    // ⚠️ LAST, and unconditional
        check('exit: the second tenant is gone', secondTenantRowsLeft(TAG) === '0');
      }

  ⚠️ IN A `finally`, AND THE RESTORE LAST IN IT. SR-4 lost shared state three
  times to an early `return` that skipped a restore sitting in the happy path.
*/
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { secret } from './accounts.mjs';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

/*
  ⚠️ NO DOUBLE QUOTES IN ANY QUERY IN THIS FILE. sqlcmd's -Q takes the whole
  statement as one argument and a double quote inside it hands sqlcmd a
  fragment. Every string literal below is single-quoted T-SQL.
*/
const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

/** The Status|Code|Message line a shipped procedure answers with. */
const envelope = (lines) => lines.find((l) => /^\d\|/.test(l)) ?? '';

/** Every fixture school this helper makes is called this, so one LIKE finds them. */
export const SCHOOL_PREFIX = 'Second Tenant Probe';

/**
 * The two patterns that identify a tag's fixtures — including a previous,
 * killed run's, which is why the run stamp is not part of them.
 */
const patterns = (tag) => ({
  school: `${SCHOOL_PREFIX} ${tag}%`,
  email: `second.tenant.${tag}.%`,
});

/**
 * Remove every second tenant belonging to this tag — this run's and any that
 * an interrupted run left behind.
 *
 * ⚠️ Idempotent and silent about finding nothing: it is called on ENTRY as
 * well as in the `finally`, and on entry there is normally nothing to do.
 *
 * 🔴 The jp_app rows go first. t_app_school_users carries the UserUid that
 * ties the two databases together; dropping the jp_sso account first would
 * leave a membership pointing at nobody, which is the orphan shape
 * USP_FindOrphanedApprovals exists to report.
 */
export const dropSecondTenant = (tag) => {
  const p = patterns(tag);

  sql(`SET NOCOUNT ON;
    USE jp_app;

    DECLARE @schools TABLE (SchoolId bigint PRIMARY KEY, OrganizationUid uniqueidentifier);

    INSERT INTO @schools (SchoolId, OrganizationUid)
    SELECT SchoolId, OrganizationUid FROM dbo.t_app_schools
     WHERE SchoolName LIKE N'${p.school}';

    DELETE FROM dbo.t_app_school_user_branches
     WHERE SchoolUserId IN (SELECT SchoolUserId FROM dbo.t_app_school_users
                             WHERE SchoolId IN (SELECT SchoolId FROM @schools));

    DELETE FROM dbo.t_app_school_users
     WHERE SchoolId IN (SELECT SchoolId FROM @schools);

    /* ⚠️ Subscriptions key on OwnerUid — the ORGANISATION, not the school. */
    DELETE FROM dbo.t_app_subscriptions
     WHERE OwnerUid IN (SELECT OrganizationUid FROM @schools);

    DELETE FROM dbo.t_app_school_branches
     WHERE SchoolId IN (SELECT SchoolId FROM @schools);

    DELETE FROM dbo.t_app_schools
     WHERE SchoolId IN (SELECT SchoolId FROM @schools);

    USE jp_sso;

    DECLARE @users TABLE (UserId bigint PRIMARY KEY);

    INSERT INTO @users (UserId)
    SELECT UserId FROM dbo.t_sso_users WHERE Email LIKE N'${p.email}';

    /* 🔴 The history row the activation wrote (G45) is part of the fixture. */
    DELETE FROM dbo.t_sso_user_status_history WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_user_lockouts       WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_user_tokens         WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_user_login_attempts WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_user_credentials    WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_user_roles          WHERE UserId IN (SELECT UserId FROM @users);
    DELETE FROM dbo.t_sso_users               WHERE UserId IN (SELECT UserId FROM @users);`);
};

/**
 * How many rows of this tag's second tenant are still in either database.
 *
 * For an exit assertion: '0' is the only acceptable answer, and anything else
 * names how much was left rather than just failing.
 */
export const secondTenantRowsLeft = (tag) => {
  const p = patterns(tag);

  return scalar(`SET NOCOUNT ON;
    SELECT CAST(
        (SELECT COUNT(*) FROM jp_app.dbo.t_app_schools WHERE SchoolName LIKE N'${p.school}')
      + (SELECT COUNT(*) FROM jp_sso.dbo.t_sso_users   WHERE Email      LIKE N'${p.email}')
      + (SELECT COUNT(*) FROM jp_app.dbo.t_app_school_users su
          WHERE su.UserUid IN (SELECT UserUid FROM jp_sso.dbo.t_sso_users WHERE Email LIKE N'${p.email}'))
      AS varchar(10));`);
};

/**
 * Create one — an Active school owner, in a school of their own, with exactly
 * one membership and a password the caller already knows.
 *
 * @param {string} tag       short, lowercase, no spaces: the suite's own name.
 * @param {string} donor     a seeded account whose password `secret()` knows.
 * @returns {{id:string, pw:string, ok:boolean, detail:string, userUid:string,
 *            schoolId:string, schoolName:string, orgUid:string}}
 *          `id`/`pw` are shaped for `session({ id, pw })`.
 *
 * ⚠️ Every premise it depends on is CHECKED, not assumed, and reported in
 * `detail`. A fixture that half-built itself and said nothing would send
 * somebody to read the API over a missing seed row.
 */
export const arrangeSecondTenant = (tag, donor) => {
  const run = Date.now().toString().slice(-8);

  const email = `second.tenant.${tag}.${run}@yopmail.com`;
  const schoolName = `${SCHOOL_PREFIX} ${tag} ${run}`;

  /*
    🔴 GENERATED HERE, NOT IN T-SQL. `EXEC ... @OrganizationUid = NEWID()` is a
    syntax error — a procedure parameter cannot be a function call — and
    declaring three variables to hold them would make the call unreadable.
  */
  const userUid = randomUUID();
  const orgUid = randomUUID();
  const requestUid = randomUUID();

  const notes = [];

  /* ---- 1. the account, pending, with the donor's credential ------------- */
  const donorId = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(UserId AS varchar(20)) FROM dbo.t_sso_users
     WHERE Email = '${String(donor).toLowerCase()}' AND Is_Deleted = 0;`);

  if (!donorId) {
    return {
      id: email, pw: '', ok: false, userUid, orgUid, schoolId: '', schoolName,
      detail: `no donor account ${donor} in jp_sso — nothing to copy a credential from`,
    };
  }

  /*
    ⚠️ StatusId 1 (pending), deliberately. The role grant lives in the
    ACTIVATION, so an account inserted straight to Active would have no
    SCHOOL_OWNER row and every refusal below would be a 403 about the
    permission instead of a 404 about the scope.
  */
  const userId = scalar(`SET NOCOUNT ON; USE jp_sso;
    INSERT INTO dbo.t_sso_users
        (UserUid, UserTypeId, StatusId, Email, OrganizationUid, IsEmailVerified, IsMobileVerified)
    VALUES
        ('${userUid}', 2, 1, '${email}', '${orgUid}', 1, 0);

    DECLARE @new bigint = SCOPE_IDENTITY();

    INSERT INTO dbo.t_sso_user_credentials
        (UserId, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, IsCurrent)
    SELECT @new, PasswordHash, PasswordSalt, HashAlgorithmId, Iterations, 1
      FROM dbo.t_sso_user_credentials
     WHERE UserId = ${donorId} AND IsCurrent = 1 AND Is_Deleted = 0;

    SELECT CAST(@new AS varchar(20));`);

  notes.push(`user ${userId}`);

  /* ---- 2. activate through the procedure, which grants SCHOOL_OWNER ----- */
  /*
    ⚠️ The actor is any active administrator, read rather than named: the
    procedure refuses an actor acting on their own account, and hard-coding one
    admin's address would be a second fixture dependency inside the thing that
    exists to remove one.
  */
  const activated = envelope(sql(`SET NOCOUNT ON; USE jp_sso;
    DECLARE @rv int = (SELECT [RowVersion] FROM dbo.t_sso_users WHERE UserUid = '${userUid}');
    DECLARE @actor bigint = (SELECT TOP (1) UserId FROM dbo.t_sso_users
                              WHERE UserTypeId = 1 AND StatusId = 2 AND Is_Deleted = 0
                              ORDER BY UserId);

    EXEC dbo.USP_UpdateUserStatus
         @UserUid = '${userUid}', @NewStatusId = 2, @RowVersion = @rv,
         @ActionByUserId = @actor,
         @Remarks = N'Second-tenant verification fixture (${tag}). Removed by the suite.';`));

  if (!/^1\|/.test(activated)) {
    notes.push(`activation refused: ${activated.slice(0, 70)}`);
  }

  /* ---- 3. the school, through the provisioning procedure ---------------- */
  const provisioned = envelope(sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @state int = (SELECT TOP (1) StateId FROM jp_mdm.dbo.m_mdm_state
                           WHERE Is_Active = 1 AND Is_Deleted = 0 ORDER BY StateId);
    DECLARE @plan int = (SELECT TOP (1) PlanId FROM jp_mdm.dbo.m_mdm_plans
                          WHERE PlanCode = 'SCHOOL_FREE' AND Is_Deleted = 0);
    DECLARE @actor bigint = (SELECT TOP (1) UserId FROM jp_sso.dbo.t_sso_users
                              WHERE UserTypeId = 1 AND StatusId = 2 AND Is_Deleted = 0
                              ORDER BY UserId);

    EXEC dbo.USP_ProvisionSchoolFromApproval
         @SourceRequestUid = '${requestUid}',
         @OrganizationUid = '${orgUid}',
         @SchoolName = N'${schoolName}',
         @AddressLine1 = N'A verification fixture, removed by the suite that made it',
         @StateId = @state,
         @ContactEmail = '${email}',
         @PlanId = @plan,
         @OwnerUserUid = '${userUid}',
         @VerifiedByUserId = @actor;`));

  if (!/^1\|/.test(provisioned)) {
    notes.push(`provisioning refused: ${provisioned.slice(0, 70)}`);
  }

  /* ---- 4. read back what was actually built ---------------------------- */
  /*
    🔴 THE FOUR FACTS THE SUITES DEPEND ON, MEASURED.

    The membership COUNT is the one that matters most: it is the number G23
    refuses on, and the reason these suites went red in the first place.

    ⚠️ The CREDENTIAL is counted too, and that is not belt-and-braces. The copy
    in step 1 is an INSERT..SELECT: a donor with no current credential row
    copies nothing, no error, and the only symptom would be a 401 from
    `session()` several lines later — reported as a login failure, which is the
    wrong place to look by a mile.
  */
  const state = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ISNULL((SELECT TOP (1) CAST(SchoolId AS varchar(20)) FROM dbo.t_app_schools
                         WHERE SchoolName = N'${schoolName}'), '0') AS varchar(20))
         + '|' + CAST((SELECT COUNT(*) FROM dbo.t_app_school_users
                        WHERE UserUid = '${userUid}' AND Is_Active = 1 AND Is_Deleted = 0) AS varchar(6))
         + '|' + CAST(ISNULL((SELECT TOP (1) CAST(RoleInSchool AS varchar(4)) FROM dbo.t_app_school_users
                               WHERE UserUid = '${userUid}' AND Is_Deleted = 0), '-') AS varchar(4))
         + '|' + CAST((SELECT COUNT(DISTINCT p.PermissionCode)
                         FROM jp_sso.dbo.t_sso_user_roles ur
                         INNER JOIN jp_sso.dbo.t_sso_roles r
                                 ON r.RoleId = ur.RoleId AND r.Is_Deleted = 0 AND r.Is_Active = 1
                         INNER JOIN jp_sso.dbo.t_sso_role_permissions rp
                                 ON rp.RoleId = r.RoleId AND rp.Is_Deleted = 0 AND rp.Is_Active = 1
                         INNER JOIN jp_sso.dbo.t_sso_permissions p
                                 ON p.PermissionId = rp.PermissionId AND p.Is_Deleted = 0 AND p.Is_Active = 1
                         INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = ur.UserId
                        WHERE u.UserUid = '${userUid}'
                          AND ur.Is_Deleted = 0 AND ur.Is_Active = 1
                          /* ⚠️ The same window USP_GetUserClaims applies, so this
                             predicts what the TOKEN will carry rather than what
                             the table merely contains. */
                          AND ur.ValidFrom <= jp_sso.dbo.fn_IstToday()
                          AND (ur.ValidTo IS NULL OR ur.ValidTo >= jp_sso.dbo.fn_IstToday())
                          AND p.PermissionCode IN ('OFFER.CREATE', 'USER.MANAGE')) AS varchar(6))
         + '|' + CAST((SELECT COUNT(*) FROM jp_sso.dbo.t_sso_user_credentials c
                         INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserId = c.UserId
                        WHERE u.UserUid = '${userUid}'
                          AND c.IsCurrent = 1 AND c.Is_Deleted = 0) AS varchar(6));`);

  const [schoolId, memberships, roleInSchool, grants, creds] = state.split('|');

  const ok = /^1\|/.test(activated)
    && /^1\|/.test(provisioned)
    && Number(schoolId) > 0
    && memberships === '1'
    && roleInSchool === '1'
    && Number(grants) >= 2
    && creds === '1';

  return {
    id: email,
    pw: secret(donor),
    userUid,
    orgUid,
    schoolId,
    schoolName,
    ok,
    detail: ok
      ? `${email} owns school ${schoolId} — ONE membership, role ${roleInSchool}, `
        + `holds OFFER.CREATE and USER.MANAGE, credential copied from ${donor}`
      : `school ${schoolId}, ${memberships} membership(s), role ${roleInSchool}, `
        + `${grants}/2 permission(s), ${creds} credential(s)`
        + `${notes.length ? ` · ${notes.join(' · ')}` : ''}`,
  };
};
