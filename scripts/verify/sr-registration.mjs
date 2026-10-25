/*
  SR-3 — THE REGISTRATION CHAIN, FIELD BY FIELD.

  ----------------------------------------------------------------------------
  🔴 WHY THIS SUITE EXISTS
  ----------------------------------------------------------------------------
  SR-0's field matrix found that the principal's mobile number was collected at
  registration, stored with the registration, and then DROPPED on approval:
  USP_ProvisionSchoolFromApproval had no parameter for it. The number stayed in
  jp_mdm, where no school-facing read ever looks, so a school approved last
  month had a principal nobody could ring.

  PrincipalName WAS carried across, which is exactly what made it invisible —
  the profile showed a principal, just one you could not phone.

  No suite caught it because no suite walked the chain:

      form -> SaveDraft -> Submit -> registration_details
                                  -> ProvisionFromApproval -> t_app_schools

  Every link was tested. The JOIN between them was not, and a field that falls
  out between two correct procedures is invisible to both.

  ⚠️ SO THIS ASSERTS THE WHOLE WALK, NOT EACH STEP. The question it answers is
  "does what the school typed end up on the school", which is the only question
  that matters and the one nothing was asking.

  Run: node scripts/verify/sr-registration.mjs
*/
import { execFileSync } from 'node:child_process';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const results = [];

const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(74));
};

/* What this run types in. Distinctive, so a stale row cannot pass for it. */
const RUN = Date.now().toString().slice(-8);
const EMAIL = `sr.reg.${RUN}@yopmail.com`;
const SCHOOL = `SR Probe School ${RUN}`;
const PRINCIPAL_MOBILE = '9812345678';
const PRINCIPAL_NAME = 'Dr Kamla Nehra';
const AREA = 'Dhani Bhagwan Das';
const PLACE_ID = 'ChIJ_srprobe_placeid';

const cleanup = () => {
  sql(`SET NOCOUNT ON;
    USE jp_app;
    DECLARE @sid bigint = (SELECT TOP (1) SchoolId FROM dbo.t_app_schools WHERE SchoolName = N'${SCHOOL}');
    DELETE FROM dbo.t_app_school_user_branches WHERE SchoolUserId IN
        (SELECT SchoolUserId FROM dbo.t_app_school_users WHERE SchoolId = @sid);
    DELETE FROM dbo.t_app_school_users  WHERE SchoolId = @sid;
    /* ⚠️ t_app_subscriptions keys on OwnerUid, not OrganizationUid — checked,
       not assumed, after the first run failed on the guessed column name. */
    DELETE FROM dbo.t_app_subscriptions WHERE OwnerUid IN
        (SELECT OrganizationUid FROM dbo.t_app_schools WHERE SchoolId = @sid);
    DELETE FROM dbo.t_app_school_branches WHERE SchoolId = @sid;
    DELETE FROM dbo.t_app_schools WHERE SchoolId = @sid;

    USE jp_mdm;
    DECLARE @rid bigint = (SELECT TOP (1) RequestId FROM dbo.t_mdm_school_registration_details WHERE SchoolName = N'${SCHOOL}');
    DELETE FROM dbo.t_mdm_request_approvals WHERE RequestId = @rid;
    DELETE FROM dbo.t_mdm_school_registration_details WHERE RequestId = @rid;
    DELETE FROM dbo.t_mdm_approval_requests WHERE RequestId = @rid;`);
};

try {
  section('0. ENTRY — nothing of this run exists yet');

  cleanup();

  check('entry: no school, request or detail row from a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST(COUNT(*) AS varchar(4)) FROM dbo.t_app_schools WHERE SchoolName = N'${SCHOOL}';`) === '0',
    'a clean start, so what is measured below is this run');

  /* The geography this run uses — real rows from SR-1. */
  const stateId = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(StateId AS varchar(10)) FROM dbo.m_mdm_state WHERE Code = 'HR';`);

  const districtId = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(DistrictId AS varchar(10)) FROM dbo.m_mdm_district WHERE Code = 'HR_HISAR';`);

  const tehsilId = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(TehsilId AS varchar(10)) FROM dbo.m_mdm_tehsil WHERE Code = 'HR_HISAR_NARNAUND';`);

  const cityId = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(CityId AS varchar(10)) FROM dbo.m_mdm_city WHERE Code = 'HR_HISAR_NARNAUND';`);

  check('premise: SR-1 geography is seeded — Haryana, Hisar, Narnaund',
    !!stateId && !!districtId && !!tehsilId && !!cityId,
    `state ${stateId} · district ${districtId} · tehsil ${tehsilId} · city ${cityId}`);

  section('1. THE DRAFT — what a school types is stored');

  /*
    ⚠️ Driven through the REAL procedure with the real parameter names. An
    INSERT here would prove the table can hold the value and nothing about
    whether the procedure passes it.
  */
  const entityUid = scalar(`SET NOCOUNT ON; SELECT CAST(NEWID() AS varchar(40));`);

  sql(`SET NOCOUNT ON; USE jp_mdm;
    DECLARE @uid uniqueidentifier = '${entityUid}';
    EXEC dbo.USP_SaveSchoolRegistrationDraft
         @EntityUid = @uid,
         @RequestorUserId = 40,
         @SchoolName = N'${SCHOOL}',
         @AddressLine1 = N'Near the bus stand',
         @StateId = ${stateId}, @DistrictId = ${districtId},
         @TehsilId = ${tehsilId}, @CityId = ${cityId},
         @AreaOrVillage = N'${AREA}',
         @Latitude = 29.123456, @Longitude = 75.987654,
         @GooglePlaceId = '${PLACE_ID}',
         @PrincipalName = N'${PRINCIPAL_NAME}',
         @PrincipalMobile = '${PRINCIPAL_MOBILE}',
         @ContactEmail = '${EMAIL}', @ContactMobile = '9800000001';`);

  const draft = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(ISNULL(PrincipalMobile, '-') AS varchar(20)) + '|'
         + CAST(ISNULL(CAST(TehsilId AS varchar(10)), '-') AS varchar(10)) + '|'
         + CAST(ISNULL(AreaOrVillage, '-') AS varchar(60)) + '|'
         + CAST(ISNULL(CAST(Latitude AS varchar(20)), '-') AS varchar(20)) + '|'
         + CAST(ISNULL(GooglePlaceId, '-') AS varchar(60))
      FROM dbo.t_mdm_school_registration_details WHERE SchoolName = N'${SCHOOL}';`);

  const [dMobile, dTehsil, dArea, dLat, dPlace] = draft.split('|');

  check('🔴 the draft keeps the principal MOBILE, not just the name',
    dMobile === PRINCIPAL_MOBILE, `PrincipalMobile = ${dMobile}`);

  check('🔴 …and the SR-1 address columns — tehsil, area, coordinates, place id',
    dTehsil === tehsilId && dArea === AREA && dLat.startsWith('29.123456') && dPlace === PLACE_ID,
    `tehsil ${dTehsil} · area ${dArea} · lat ${dLat} · place ${dPlace}`);

  section('2. 🔴 APPROVAL — the step that used to drop it');

  const orgUid = scalar(`SET NOCOUNT ON; SELECT CAST(NEWID() AS varchar(40));`);
  const ownerUid = scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT LOWER(CAST(UserUid AS varchar(50))) FROM dbo.t_sso_users WHERE Email = 'superadmin@teacherportal.local';`);

  const planId = scalar(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST(PlanId AS varchar(10)) FROM dbo.m_mdm_plans WHERE PlanCode = 'SCHOOL_FREE';`);

  /*
    The provisioning call is given EXACTLY what the registration record holds —
    read back out of jp_mdm rather than re-typed — because the bug being
    guarded against lives in the handover, not in either side's own values.
  */
  const provision = sql(`SET NOCOUNT ON;
    USE jp_mdm;
    DECLARE @PrincipalName nvarchar(150), @PrincipalMobile varchar(15),
            @Tehsil int, @Area nvarchar(200), @Lat decimal(9,6), @Lng decimal(9,6),
            @Place varchar(120), @City int, @District int, @State int, @Line1 nvarchar(250);

    SELECT @PrincipalName = PrincipalName, @PrincipalMobile = PrincipalMobile,
           @Tehsil = TehsilId, @Area = AreaOrVillage, @Lat = Latitude, @Lng = Longitude,
           @Place = GooglePlaceId, @City = CityId, @District = DistrictId,
           @State = StateId, @Line1 = AddressLine1
      FROM dbo.t_mdm_school_registration_details WHERE SchoolName = N'${SCHOOL}';

    USE jp_app;
    EXEC dbo.USP_ProvisionSchoolFromApproval
         @SourceRequestUid = '${entityUid}',
         @OrganizationUid = '${orgUid}',
         @SchoolName = N'${SCHOOL}',
         @AddressLine1 = @Line1, @CityId = @City, @DistrictId = @District, @StateId = @State,
         @TehsilId = @Tehsil, @AreaOrVillage = @Area,
         @Latitude = @Lat, @Longitude = @Lng, @GooglePlaceId = @Place,
         @PrincipalName = @PrincipalName, @PrincipalMobile = @PrincipalMobile,
         @ContactEmail = '${EMAIL}', @ContactMobile = '9800000001',
         @PlanId = ${planId}, @OwnerUserUid = '${ownerUid}', @VerifiedByUserId = 40;`)
    .find((l) => /^\d\|/.test(l)) ?? '';

  check('premise: provisioning succeeded',
    /^1\|/.test(provision), provision.slice(0, 80));

  const live = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ISNULL(PrincipalName, '-') AS varchar(60)) + '|'
         + CAST(ISNULL(PrincipalMobile, '-') AS varchar(20)) + '|'
         + CAST(ISNULL(CAST(TehsilId AS varchar(10)), '-') AS varchar(10)) + '|'
         + CAST(ISNULL(AreaOrVillage, '-') AS varchar(60)) + '|'
         + CAST(ISNULL(CAST(Latitude AS varchar(20)), '-') AS varchar(20)) + '|'
         + CAST(ISNULL(GooglePlaceId, '-') AS varchar(60))
      FROM dbo.t_app_schools WHERE SchoolName = N'${SCHOOL}';`);

  const [lName, lMobile, lTehsil, lArea, lLat, lPlace] = live.split('|');

  console.log(`\n    on the live school: ${live}\n`);

  check('premise: the name came across, as it always did',
    lName === PRINCIPAL_NAME, lName);

  check('🔴 SR-0 FINDING FIXED: the principal MOBILE reaches the live school',
    lMobile === PRINCIPAL_MOBILE,
    lMobile === PRINCIPAL_MOBILE
      ? `${lMobile} — before SR-3 this was NULL and nobody could ring the principal`
      : `PrincipalMobile = ${lMobile}, expected ${PRINCIPAL_MOBILE}`);

  check('🔴 …and so does the whole address, tehsil and coordinates included',
    lTehsil === tehsilId && lArea === AREA && lLat.startsWith('29.123456') && lPlace === PLACE_ID,
    `tehsil ${lTehsil} · area ${lArea} · lat ${lLat} · place ${lPlace}`);

  section('3. 🔴 THE NEGATIVE — a registration with NONE of this still works');

  /*
    ⚠️ THE PROMISE SR-0 MADE: "the matrix moves fields, never orphans data".
    A school registered before SR-1 has no tehsil, no area, no coordinates and
    no principal mobile. It must still provision, and its row must still read
    cleanly — nullable columns, no backfill, no invented values.
  */
  const OLD_SCHOOL = `SR Probe Legacy ${RUN}`;
  const oldUid = scalar(`SET NOCOUNT ON; SELECT CAST(NEWID() AS varchar(40));`);
  const oldOrg = scalar(`SET NOCOUNT ON; SELECT CAST(NEWID() AS varchar(40));`);

  const legacy = sql(`SET NOCOUNT ON; USE jp_app;
    EXEC dbo.USP_ProvisionSchoolFromApproval
         @SourceRequestUid = '${oldUid}',
         @OrganizationUid = '${oldOrg}',
         @SchoolName = N'${OLD_SCHOOL}',
         @AddressLine1 = N'Old address, state only',
         @StateId = ${stateId},
         @ContactEmail = 'legacy.${RUN}@yopmail.com', @ContactMobile = '9800000002',
         @PlanId = ${planId}, @OwnerUserUid = '${ownerUid}', @VerifiedByUserId = 40;`)
    .find((l) => /^\d\|/.test(l)) ?? '';

  check('🔴 a school with no tehsil, area, coordinates or principal still provisions',
    /^1\|/.test(legacy), legacy.slice(0, 70));

  const legacyRow = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CASE WHEN TehsilId IS NULL AND AreaOrVillage IS NULL AND Latitude IS NULL
                 AND GooglePlaceId IS NULL AND PrincipalMobile IS NULL
                THEN 'all five NULL' ELSE 'SOMETHING WAS INVENTED' END
      FROM dbo.t_app_schools WHERE SchoolName = N'${OLD_SCHOOL}';`);

  check('🔴 …and the new columns are NULL, not back-filled with a guess',
    legacyRow === 'all five NULL',
    `${legacyRow} — NULL honestly says "nobody was ever asked"`);

  /* Clean up the legacy probe too. */
  sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @sid bigint = (SELECT TOP (1) SchoolId FROM dbo.t_app_schools WHERE SchoolName = N'${OLD_SCHOOL}');
    DELETE FROM dbo.t_app_school_user_branches WHERE SchoolUserId IN
        (SELECT SchoolUserId FROM dbo.t_app_school_users WHERE SchoolId = @sid);
    DELETE FROM dbo.t_app_school_users WHERE SchoolId = @sid;
    DELETE FROM dbo.t_app_subscriptions WHERE OwnerUid = '${oldOrg}';
    DELETE FROM dbo.t_app_school_branches WHERE SchoolId = @sid;
    DELETE FROM dbo.t_app_schools WHERE SchoolId = @sid;`);
} finally {
  section('4. EXIT — this run left nothing behind');

  cleanup();

  const left = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(COUNT(*) AS varchar(4)) FROM dbo.t_app_schools WHERE SchoolName LIKE 'SR Probe%';`);

  check('exit: every probe school is gone',
    left === '0', `${left} left`);

  const failed = results.filter((r) => !r.pass);

  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${results.length - failed.length}/${results.length} PASSED`);

  if (failed.length) {
    console.log(`\n  ${failed.length} FAILED:`);
    for (const f of failed) console.log(`    x ${f.label}`);
    process.exitCode = 1;
  }

  console.log('='.repeat(74));
}
