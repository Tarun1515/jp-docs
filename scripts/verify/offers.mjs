/*
  PHASE 6A — OFFER LITE: the machine, the race, and the 3C negative again.

  ----------------------------------------------------------------------------
    1. THE MACHINE        the legal chain to Hired, every step with its history
                          row and its acting user; every illegal move refused
                          with its own code.
    2. THE DECISIONS      re-offer after a DECLINE and after a WITHDRAWAL both
                          allowed, with the whole trail kept — 016's header
                          argues the case, this proves the code agrees.
    3. 🔴 THE RACE        two parallel sends on ONE application, armed on the
                          same wall-clock instant, gate instants asserted. One
                          live offer; the loser is REFUSED — ALREADY_OFFERED
                          if it reached the index, INVALID_TRANSITION if the
                          winner had already moved the application (8-0).
    4. 🔴 THE 3C NEGATIVE a DIFFERENT 2601 must not wear this one's clothes.
    5. THE BOUNDARY       the generic status endpoint still refuses 7..10, and
                          the two vocabularies stay apart.
    6. HTTP               the permission split (OFFER.CREATE sends,
                          OFFER.APPROVE hires) and the scope negatives.

  ----------------------------------------------------------------------------
  🔴 WHY THE RACE IS THE ONLY WAY TO REACH ALREADY_OFFERED
  ----------------------------------------------------------------------------
  An ordinary second click cannot produce it. Once an offer is sent the
  application sits at OfferSent, and fn_ApplicationTransitionAllowed refuses
  7 -> 7 long before the INSERT is attempted — so the filtered unique index is
  never reached and the CATCH never runs.

  That makes the CATCH exactly the kind of guard 3C was written about: present,
  plausible, and never once fired. Section 3 fires it, and section 4 proves it
  is checking WHICH index collided rather than assuming.

  ----------------------------------------------------------------------------
  ⚠️ FIXTURES: NAMED, ASSERTED ON ENTRY AND EXIT, RESTORED IN A FINALLY
  ----------------------------------------------------------------------------
  Everything this file creates is titled `6A …`. Five times in this project a
  fixture has outlived the assertion it was made for; the rule that came out of
  it is applied here from the first line.

  Run (both APIs up for section 6; sections 1-5 need only the database):
      node scripts/verify/offers.mjs
*/
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { token as loginToken } from './lib/login.mjs';
import { secret } from './lib/accounts.mjs';

const execFileAsync = promisify(execFile);

const SERVER = 'localhost\\TARUN';
const ARGS = ['-S', SERVER, '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];

const SSO = 'http://localhost:5199/api';
const APP = 'http://localhost:5299/api';

const OWNER = { id: 'principal@greenwood.edu.in', pw: secret('principal@greenwood.edu.in') };
const VIEWER = { id: 'viewer@greenwood.edu.in', pw: secret('viewer@greenwood.edu.in') };
/*
  🔴 A DIFFERENT SCHOOL'S OWNER, NOT THE HR LEAD.

  The first version used hr.lead@greenwood — and got 403 rather than the 404 it
  asserted, because HR holds NEITHER offer permission. The refusal was correct
  and it was about the PERMISSION, so the scope was never reached and the
  assertion proved nothing about it.

  A scope negative needs an actor who would otherwise be allowed. head@stmarys
  is a SCHOOL_OWNER — it holds OFFER.CREATE and OFFER.APPROVE — so a 404 from
  it can only be the scope. The permission half is proved separately, by the
  Viewer, who is in the SAME school and holds neither.
*/
const OTHER_SCHOOL = { id: 'head@stmarys.edu.in', pw: secret('head@stmarys.edu.in') };
const TEACHER = { id: 'rohit.kulkarni.86002@yopmail.com', pw: secret('rohit.kulkarni.86002@yopmail.com') };

const TEMP_INDEX = 'UQ_TEMP_6A_OneOfferPerTeacher';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (title) => console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = (q) =>
  execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const scalar = (q) => sql(q)[0] ?? '';

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b = null;
  try { b = JSON.parse(t); } catch { /* keep the text */ }

  return { http: r.status, body: b, text: t };
};

/*
  🔴 SIGN-IN COMES FROM THE SHARED HELPER NOW — G34.

  This file used to carry its own login() with a 20-second retry. Every suite
  did, each slightly differently, and all of them shared the same blind spot:
  the per-IDENTIFIER limit is 10 per HOUR, and no backoff inside a test run can
  wait that out. A full regression spent it around the sixth suite and the next
  one died on a null token — a false red that reads like a broken screen.

  `lib/login.mjs` adds a token cache on top of the backoff, which is the part
  that actually closes that window. See its header for the trade it makes and
  the one call site that must bypass it.
*/
const login = loginToken;

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

// ---------------------------------------------------------------------------
// Fixtures. Entry and exit run the same statements.
// ---------------------------------------------------------------------------
const cleanup = () => sql(`SET NOCOUNT ON; USE jp_app;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${TEMP_INDEX}'
             AND object_id = OBJECT_ID('dbo.t_app_offers'))
      DROP INDEX ${TEMP_INDEX} ON dbo.t_app_offers;

  DECLARE @jobs TABLE (JobId bigint);
  INSERT INTO @jobs SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle LIKE '6A %';

  DELETE FROM dbo.t_app_offers
   WHERE ApplicationId IN (SELECT ApplicationId FROM dbo.t_app_applications
                            WHERE JobId IN (SELECT JobId FROM @jobs));
  DELETE FROM dbo.t_app_application_status_history
   WHERE ApplicationId IN (SELECT ApplicationId FROM dbo.t_app_applications
                            WHERE JobId IN (SELECT JobId FROM @jobs));
  DELETE FROM dbo.t_app_applications WHERE JobId IN (SELECT JobId FROM @jobs);
  DELETE FROM dbo.t_app_jobs         WHERE JobId IN (SELECT JobId FROM @jobs);
  /*
    6C -- the notifications those rows produced. Written as a reference to an
    entity that is gone, which is the invariant notifications.mjs asserts across
    the whole table: a notification pointing at a deleted application would lead
    a person to a 404, and 021 argues that is worse than never telling them.

    No double quotes in here on purpose: this text is passed to sqlcmd through
    -Q, and a quote inside the query makes the shell hand sqlcmd a fragment.
  */
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 1 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_applications a WHERE a.ApplicationUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 2 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_teacher_invites i WHERE i.InviteUid = RefEntityUid);
  DELETE FROM t_app_notifications
   WHERE RefEntityTypeId = 3 AND RefEntityUid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_app_offers o WHERE o.OfferUid = RefEntityUid);
`);

const errorLogCount = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM dbo.t_app_error_log;`);

const indexCount = () => scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.t_app_offers');`);

/** One proc call, returning its Status/Code envelope. */
const proc = (body) => {
  const line = scalar(`SET NOCOUNT ON; USE jp_app; ${body}`);
  const c = line.split('|').map((x) => x.trim());

  return { raw: line, status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1], id: c[3] };
};

const appStatus = (applicationId) => Number(scalar(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(ApplicationStatusId AS varchar(3)) FROM dbo.t_app_applications
  WHERE ApplicationId = ${applicationId};`));

const trail = (applicationId) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT ISNULL(CAST(FromStatusId AS varchar(3)), '-') + '>' + CAST(ToStatusId AS varchar(3))
       + ':' + ISNULL(CAST(ChangedByUserId AS varchar(20)), 'null')
  FROM dbo.t_app_application_status_history WHERE ApplicationId = ${applicationId}
  ORDER BY HistoryId;`);

const offerRows = (applicationId) => sql(`SET NOCOUNT ON; USE jp_app;
  SELECT CAST(OfferId AS varchar(20)) + ':status' + CAST(OfferStatusId AS varchar(3))
       + ':' + CAST(CAST(ISNULL(OfferedSalary, 0) AS int) AS varchar(12))
  FROM dbo.t_app_offers WHERE ApplicationId = ${applicationId} ORDER BY OfferId;`);

let entryErrors = '';
let entryIndexes = '';

try {
  // =========================================================================
  section('0. ENTRY — the shipped state this suite assumes');
  // =========================================================================

  cleanup();

  entryErrors = errorLogCount();
  entryIndexes = indexCount();

  check('entry: no 6A fixtures left over from a previous run',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM dbo.t_app_jobs WHERE JobTitle LIKE '6A %';`) === '0', 'clean');

  check('entry: no leftover temporary index on t_app_offers',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM sys.indexes WHERE name = '${TEMP_INDEX}'
      AND object_id = OBJECT_ID('dbo.t_app_offers');`) === '0',
    `${entryIndexes} indexes, none of them ${TEMP_INDEX}`);

  const offerStatuses = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(OfferStatusId AS varchar(3)) + ':' + Code + ':live' + CAST(IsLive AS varchar(3))
    FROM dbo.m_app_offer_status ORDER BY OfferStatusId;`);

  check('🔴 the offer master seeds four states, and exactly ONE of them is live',
    offerStatuses.length === 4 && offerStatuses.filter((s) => s.endsWith(':live1')).length === 1
    && offerStatuses[0] === '1:SENT:live1',
    offerStatuses.join(' · '));

  check('🔴 …and the filtered unique index names that same id',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CASE WHEN filter_definition LIKE '%[[]OfferStatusId]=(1)%' THEN 'names 1' ELSE filter_definition END
      FROM sys.indexes WHERE name = 'UQ_t_app_offers_LiveApplication'
      AND object_id = OBJECT_ID('dbo.t_app_offers');`) === 'names 1',
    'the index and the master agree about what "live" means');

  const reachable = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(ApplicationStatusId AS varchar(3)) + ':' + CAST(IsReachable AS varchar(3))
    FROM dbo.m_app_application_status WHERE ApplicationStatusId >= 7 ORDER BY ApplicationStatusId;`);

  check('🔴 the offer chain (7..10) is REACHABLE now — 023 said this would change with 6A',
    reachable.every((r) => r.endsWith(':1')), reachable.join(' · '));

  // ---- fixture -----------------------------------------------------------
  const schoolId = 4;
  const branchId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(BranchId AS varchar(20)) FROM dbo.t_app_school_branches
    WHERE SchoolId = ${schoolId} AND Is_Deleted = 0 ORDER BY BranchId;`));

  const ownerUid = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(su.UserUid AS varchar(40)) FROM dbo.t_app_school_users su
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = su.UserUid
    WHERE su.SchoolId = ${schoolId} AND su.Is_Deleted = 0 AND u.Email = '${OWNER.id}';`);

  const ownerUserId = Number(scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(UserId AS varchar(20)) FROM dbo.t_sso_users WHERE Email = '${OWNER.id}';`));

  const teacherId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(t.TeacherId AS varchar(20)) FROM dbo.t_app_teachers t
      INNER JOIN jp_sso.dbo.t_sso_users u ON u.UserUid = t.UserUid
    WHERE u.Email = '${TEACHER.id}';`));

  const teacherUserId = Number(scalar(`SET NOCOUNT ON; USE jp_sso;
    SELECT CAST(UserId AS varchar(20)) FROM dbo.t_sso_users WHERE Email = '${TEACHER.id}';`));

  check('fixture: the school, its campus, its owner and a teacher all resolve',
    branchId > 0 && !!ownerUid && ownerUserId > 0 && teacherId > 0 && teacherUserId > 0,
    `school ${schoolId}, branch ${branchId}, owner ${ownerUserId}, teacher ${teacherId}`);

  /** A job and an application parked at the given status. */
  const makeApplication = (title, statusId) => {
    const jobId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
      INSERT INTO dbo.t_app_jobs (SchoolId, BranchId, JobTitle, SubjectId, DesignationId,
                                  EmploymentTypeId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn)
      VALUES (${schoolId}, ${branchId}, '${title}', 1, 1, 1, 1, 2, '2027-12-31', SYSUTCDATETIME());
      SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

    const applicationId = Number(scalar(`SET NOCOUNT ON; USE jp_app;
      INSERT INTO dbo.t_app_applications (JobId, TeacherId, SchoolId, BranchId, ApplicationStatusId, AppliedOn)
      VALUES (${jobId}, ${teacherId}, ${schoolId}, ${branchId}, ${statusId}, SYSUTCDATETIME());
      SELECT CAST(SCOPE_IDENTITY() AS bigint);`));

    return { jobId, applicationId };
  };

  const send = (applicationId, salary) => proc(`EXEC dbo.USP_SendOffer
    @SchoolId=${schoolId}, @UserUid='${ownerUid}', @ApplicationId=${applicationId},
    @DesignationId=1, @OfferedSalary=${salary}, @JoiningDate='2027-01-05',
    @ReportingTime='08:00:00', @ActorUserId=${ownerUserId};`);

  const liveOfferId = (applicationId) => Number(scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(OfferId AS varchar(20)) FROM dbo.t_app_offers
    WHERE ApplicationId = ${applicationId} AND OfferStatusId = 1;`));

  const respond = (offerId, accept, remarks) => proc(`EXEC dbo.USP_RespondToOffer
    @TeacherId=${teacherId}, @OfferId=${offerId}, @Accept=${accept ? 1 : 0},
    @TeacherRemarks=N'${remarks}', @ActorUserId=${teacherUserId};`);

  const withdraw = (offerId, reason) => proc(`EXEC dbo.USP_WithdrawOffer
    @SchoolId=${schoolId}, @UserUid='${ownerUid}', @OfferId=${offerId},
    @Reason=N'${reason}', @ActorUserId=${ownerUserId};`);

  const hire = (applicationId) => proc(`EXEC dbo.USP_ConfirmHire
    @SchoolId=${schoolId}, @UserUid='${ownerUid}', @ApplicationId=${applicationId},
    @ActorUserId=${ownerUserId};`);

  // =========================================================================
  section('1. THE MACHINE — the legal chain to Hired, one step at a time');
  // =========================================================================

  const chain = makeApplication('6A Chain job', 5);

  const sent = send(chain.applicationId, 45000);

  check('Selected -> OfferSent: the offer is written and the application moves',
    sent.status === 1 && sent.code === null && appStatus(chain.applicationId) === 7,
    `${sent.raw.split('|').slice(0, 3).join(' · ')} · application now ${appStatus(chain.applicationId)}`);

  const chainOffer = liveOfferId(chain.applicationId);

  const accepted = respond(chainOffer, true, 'Delighted to accept.');

  check('OfferSent -> OfferAccepted: the teacher answers and both rows move together',
    accepted.status === 1 && appStatus(chain.applicationId) === 8
    && offerRows(chain.applicationId)[0].includes(':status2'),
    `application ${appStatus(chain.applicationId)}, offer ${offerRows(chain.applicationId)[0]}`);

  /*
    🔴 HIRING IS A SEPARATE ACT. A teacher accepting is not a teacher arriving,
    and collapsing the two would record people as hired who never started.
  */
  const hired = hire(chain.applicationId);

  check('🔴 OfferAccepted -> Hired is a SEPARATE step, not a consequence of accepting',
    hired.status === 1 && appStatus(chain.applicationId) === 10,
    `application ${appStatus(chain.applicationId)} (10 = Hired)`);

  console.log(`\n    trail: ${trail(chain.applicationId).join('  ')}\n`);

  check('🔴 …and every step wrote a history row naming WHO did it',
    trail(chain.applicationId).join(' ')
      === `5>7:${ownerUserId} 7>8:${teacherUserId} 8>10:${ownerUserId}`,
    trail(chain.applicationId).join('  '));

  check('…the school moved two of them and the TEACHER moved the middle one',
    trail(chain.applicationId)[1].endsWith(`:${teacherUserId}`),
    'the acceptance is recorded as the teacher\'s act, not the school\'s');

  // ---- the refusals -------------------------------------------------------
  check('🔴 Hired is terminal — a further offer is refused',
    send(chain.applicationId, 99000).code === 'INVALID_TRANSITION', 'INVALID_TRANSITION');

  const accepted2 = respond(chainOffer, false, 'changed my mind');

  check('🔴 an answered offer cannot be answered again',
    accepted2.status === 0 && accepted2.code === 'OFFER_NOT_LIVE',
    `${accepted2.code} — "${accepted2.raw.split('|')[2]}"`);

  const withdrawAccepted = withdraw(chainOffer, 'too late');

  check('🔴 …and an ACCEPTED offer cannot be withdrawn — that would rewrite what the teacher was told',
    withdrawAccepted.status === 0 && withdrawAccepted.code === 'OFFER_NOT_LIVE',
    `${withdrawAccepted.code} — "${withdrawAccepted.raw.split('|')[2]}"`);

  // =========================================================================
  section('2. THE DECISIONS — re-offer after a decline, and after a withdrawal');
  // =========================================================================

  const nego = makeApplication('6A Negotiation job', 5);

  send(nego.applicationId, 40000);
  const firstOffer = liveOfferId(nego.applicationId);

  respond(firstOffer, false, 'Salary is below what I need.');

  check('a DECLINE moves the application to OfferDeclined',
    appStatus(nego.applicationId) === 9, `application ${appStatus(nego.applicationId)}`);

  /*
    🔴 THE DECISION, PROVEN. 016's header argues that a second offer after a
    decline must be allowed: a teacher declining 40,000 and accepting 45,000 is
    an ordinary negotiation, and refusing it pushes that conversation outside
    the product where nothing is recorded.
  */
  const second = send(nego.applicationId, 45000);

  check('🔴 a SECOND offer after a decline is ALLOWED — the negotiation stays in the product',
    second.status === 1 && second.code === null && appStatus(nego.applicationId) === 7,
    `offer ${second.id}, application back to ${appStatus(nego.applicationId)}`);

  const secondOffer = liveOfferId(nego.applicationId);

  const pulled = withdraw(secondOffer, 'Post filled internally.');

  check('a WITHDRAWAL returns the application to Selected, not to a state of its own',
    pulled.status === 1 && appStatus(nego.applicationId) === 5,
    `application ${appStatus(nego.applicationId)} (5 = Selected)`);

  const third = send(nego.applicationId, 50000);

  check('🔴 …so a re-offer after a withdrawal is not a special case — it is the FIRST case again',
    third.status === 1 && appStatus(nego.applicationId) === 7,
    `offer ${third.id}, application ${appStatus(nego.applicationId)}`);

  console.log(`\n    offers: ${offerRows(nego.applicationId).join('  ')}`);
  console.log(`    trail:  ${trail(nego.applicationId).join('  ')}\n`);

  check('🔴 …and all THREE offers survive with their own outcomes — nothing is overwritten',
    offerRows(nego.applicationId).length === 3
    && offerRows(nego.applicationId)[0].includes(':status3:40000')
    && offerRows(nego.applicationId)[1].includes(':status4:45000')
    && offerRows(nego.applicationId)[2].includes(':status1:50000'),
    offerRows(nego.applicationId).join('  '));

  check('…and the application\'s history reads as the negotiation it was',
    trail(nego.applicationId).map((t) => t.split(':')[0]).join(' ')
      === '5>7 7>9 9>7 7>5 5>7',
    trail(nego.applicationId).map((t) => t.split(':')[0]).join(' '));

  check('🔴 …with only ONE live offer at the end, whatever the history says',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM dbo.t_app_offers
      WHERE ApplicationId = ${nego.applicationId} AND OfferStatusId = 1;`) === '1',
    'one live offer');

  // =========================================================================
  section('3. 🔴 THE RACE — two parallel sends on ONE application');
  // =========================================================================

  const race = makeApplication('6A Race job', 5);

  /*
    🔴 The applications-race standard. Both sessions park inside WAITFOR TIME
    and stamp SYSUTCDATETIME() the instant it returns, so "they raced" is
    measured rather than assumed — the outcome alone is satisfied by two sends
    a minute apart.
  */
  const probe = (hhmmss, salary) => execFileAsync('sqlcmd', [...ARGS, '-Q',
    `SET NOCOUNT ON; USE jp_app;
     DECLARE @spid int = @@SPID;
     WAITFOR TIME '${hhmmss}';
     DECLARE @t0 datetime2(7) = SYSUTCDATETIME();
     EXEC dbo.USP_SendOffer @SchoolId=${schoolId}, @UserUid='${ownerUid}',
          @ApplicationId=${race.applicationId}, @DesignationId=1,
          @OfferedSalary=${salary}, @ActorUserId=${ownerUserId};
     DECLARE @t1 datetime2(7) = SYSUTCDATETIME();
     SELECT 'MARK|' + CONVERT(varchar(30), @t0, 126) + '|' + CONVERT(varchar(30), @t1, 126)
          + '|' + CAST(@spid AS varchar(12));`], { encoding: 'utf8' });

  const lines = (r) => r.stdout.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/Changed database context/.test(l));

  const outcome = (r) => {
    const line = lines(r).find((l) => !l.startsWith('MARK|')) ?? '';
    const c = line.split('|').map((x) => x.trim());

    return { raw: line, status: Number(c[0]), code: c[1] === 'NULL' ? null : c[1] };
  };

  const mark = (r) => {
    const line = lines(r).find((l) => l.startsWith('MARK|')) ?? '';
    const [, t0, t1, spid] = line.split('|');

    return { t0Text: t0, t0: new Date(t0).getTime(), t1: new Date(t1).getTime(), spid };
  };

  const SAME_INSTANT_MS = 50;
  const entryGap = (A, B) => Math.abs(A.t0 - B.t0);
  const ranTogether = (A, B) => entryGap(A, B) <= SAME_INSTANT_MS;

  const armAt = new Date(Math.ceil((Date.now() + 4000) / 1000) * 1000);
  const hhmmss = armAt.toTimeString().slice(0, 8);

  console.log(`\n  both senders armed for ${hhmmss} …`);

  const [ra, rb] = await Promise.all([probe(hhmmss, 61000), probe(hhmmss, 62000)]);

  const oa = outcome(ra);
  const ob = outcome(rb);
  const ma = mark(ra);
  const mb = mark(rb);

  console.log(`\n     A  spid ${ma.spid}  ${ma.t0Text}  ran ${ma.t1 - ma.t0} ms  ->  ${oa.raw}`);
  console.log(`     B  spid ${mb.spid}  ${mb.t0Text}  ran ${mb.t1 - mb.t0} ms  ->  ${ob.raw}`);
  console.log(`     entry gap ${entryGap(ma, mb)} ms\n`);

  check('🔴 both senders left the gate in the SAME INSTANT — they actually raced',
    ranTogether(ma, mb),
    `A ${ma.t0Text} · B ${mb.t0Text} · gap ${entryGap(ma, mb)} ms (tolerance ${SAME_INSTANT_MS} ms)`);

  check('…on two different SQL sessions',
    ma.spid !== mb.spid, `spids ${ma.spid} and ${mb.spid}`);

  const liveCount = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM dbo.t_app_offers
    WHERE ApplicationId = ${race.applicationId} AND OfferStatusId = 1;`);

  const allOffers = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM dbo.t_app_offers WHERE ApplicationId = ${race.applicationId};`);

  check('🔴 EXACTLY ONE OFFER EXISTS — the index refused the second insert, not a SELECT',
    liveCount === '1' && allOffers === '1', `${allOffers} offer(s), ${liveCount} live`);

  const winners = [oa, ob].filter((r) => r.status === 1 && r.code === null).length;
  /*
    🔴 THE LOSER HAS TWO LEGITIMATE ANSWERS, AND THIS ASSERTION USED TO ALLOW
    ONLY ONE. FOUND IN 8-0, ON A RUN THAT HAD NOTHING TO DO WITH OFFERS.

    The winning send does two things in its transaction: it inserts the offer
    AND it moves the application out of Selected. So what the loser meets
    depends on which of those it reaches first:

      loser reaches the INSERT      -> the unique index refuses -> ALREADY_OFFERED
      loser re-reads the application
        after the winner committed  -> not Selected any more    -> INVALID_TRANSITION

    Both are correct refusals of the same thing, and the invariant that
    actually matters is asserted two lines above and below: exactly ONE offer
    exists, exactly one session inserted, and the loser was TOLD rather than
    silently overwritten.

    ⚠️ The old assertion encoded one interleaving as if it were the contract,
    which made this suite fail roughly whenever the entry gap was wide enough
    for the winner to commit first — 16 ms was enough. That is almost certainly
    what G35 was: "offers.mjs failed once and nobody knew which assertion".
    Now it is named, and the suite prints which interleaving it got.

    🔴 WHAT IS STILL FORBIDDEN: a Status 0 with no code, a crash, or two
    winners. The check below accepts exactly the two refusals the procedure is
    allowed to give and nothing else.
  */
  const REFUSALS = ['ALREADY_OFFERED', 'INVALID_TRANSITION'];

  const loser = [oa, ob].find((r) => r.code !== null && r.code !== 'NULL');

  console.log(`     the loser was refused with ${loser?.code ?? 'NOTHING'}`
    + ` (status ${loser?.status})`);

  const alreadies = [oa, ob].filter((r) => REFUSALS.includes(String(r.code))).length;

  check('🔴 exactly one session actually inserted',
    winners === 1, `${winners} inserter(s)`);

  check('🔴 …and the other was REFUSED — ALREADY_OFFERED or INVALID_TRANSITION, never silence',
    alreadies === 1,
    `${alreadies} refused session(s): ${[oa, ob].map((r) => r.code ?? 'inserted').join(' / ')}`);

  check('…and the application moved exactly once',
    appStatus(race.applicationId) === 7
    && trail(race.applicationId).filter((t) => t.startsWith('5>7')).length === 1,
    `application ${appStatus(race.applicationId)}, ${trail(race.applicationId).length} history row(s)`);

  // =========================================================================
  section('4. 🔴 THE 3C NEGATIVE — a DIFFERENT 2601 must not wear this one\'s clothes');
  // =========================================================================

  /*
    The CATCH in USP_SendOffer compares the error message against the index
    NAME. That guard is written, and section 3 fired the happy half of it — but
    a CATCH with the LIKE deleted would have passed section 3 too.

    So a SECOND unique index is created, on TeacherId alone. This teacher now
    holds a live offer from the race above, so the next send collides on the
    TEMPORARY index — a 2601 that has nothing to do with one-offer-per-
    application — and the procedure must NOT call it ALREADY_OFFERED.
  */
  const other = makeApplication('6A Other-index job', 5);

  /*
    ⚠️ THE PREMISE HAS TO BE ARRANGED, AND ARRANGING IT IS PART OF THE TEST.

    A unique index on TeacherId cannot be CREATED while the teacher already
    holds more than one live offer — SQL Server refuses with Msg 1505 before
    the test can begin. Sections 2 and 3 each left one standing, which is
    correct for what they were proving and wrong for what this needs.

    🔴 The first version of this section did not notice, and died on the CREATE
    with a message about duplicate key (10) that says nothing about offers.
    That is the SIXTH time in this project a fixture has outlived the assertion
    it was made for — so the surplus is withdrawn HERE, deliberately, and the
    premise is asserted rather than assumed.
  */
  const surplus = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT CAST(OfferId AS varchar(20)) FROM dbo.t_app_offers
    WHERE TeacherId = ${teacherId} AND OfferStatusId = 1 AND Is_Deleted = 0
    ORDER BY OfferId;`);

  for (const id of surplus.slice(1)) {
    withdraw(Number(id), 'Cleared so the 3C negative can arrange its premise.');
  }

  const liveForTeacher = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT COUNT(*) FROM dbo.t_app_offers
    WHERE TeacherId = ${teacherId} AND OfferStatusId = 1 AND Is_Deleted = 0;`);

  check('premise: the teacher holds EXACTLY ONE live offer, so a TeacherId index can exist',
    liveForTeacher === '1', `${surplus.length} live before, ${liveForTeacher} after`);

  sql(`SET NOCOUNT ON; USE jp_app;
    CREATE UNIQUE NONCLUSTERED INDEX ${TEMP_INDEX}
      ON dbo.t_app_offers (TeacherId) WHERE OfferStatusId = 1 AND Is_Deleted = 0;`);

  check('a TEMPORARY second unique index is in place',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM sys.indexes WHERE name = '${TEMP_INDEX}'
      AND object_id = OBJECT_ID('dbo.t_app_offers');`) === '1', TEMP_INDEX);

  let forced = { raw: '', failed: false };

  try {
    forced.raw = scalar(`SET NOCOUNT ON; USE jp_app;
      EXEC dbo.USP_SendOffer @SchoolId=${schoolId}, @UserUid='${ownerUid}',
           @ApplicationId=${other.applicationId}, @DesignationId=1,
           @OfferedSalary=70000, @ActorUserId=${ownerUserId};`);
  } catch (error) {
    forced = { raw: String(error.stdout ?? error.message), failed: true };
  }

  console.log(`\n    the forced collision: ${forced.raw.replace(/\s+/g, ' ').slice(0, 200)}\n`);

  check('🔴 THE PROCEDURE DID NOT SAY ALREADY_OFFERED — the 3C mistake, not repeated',
    !/ALREADY_OFFERED/i.test(forced.raw), 'no ALREADY_OFFERED anywhere in the output');

  check('🔴 …it surfaced as ITSELF, naming the OTHER index',
    forced.failed && /2601/.test(forced.raw) && forced.raw.includes(TEMP_INDEX),
    `failed ${forced.failed} · mentions 2601 ${/2601/.test(forced.raw)} · names ${TEMP_INDEX} ${forced.raw.includes(TEMP_INDEX)}`);

  check('🔴 …and did NOT name the live-application index, which was never violated',
    !forced.raw.includes('UQ_t_app_offers_LiveApplication'),
    'UQ_t_app_offers_LiveApplication absent from the error');

  check('…and no row was written — the transaction rolled back',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM dbo.t_app_offers WHERE ApplicationId = ${other.applicationId};`) === '0',
    'nothing offered');

  check('…and the application did NOT move',
    appStatus(other.applicationId) === 5, `still ${appStatus(other.applicationId)} (Selected)`);

  const logged = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT TOP 1 CAST(ErrorNumber AS varchar(10)) + '|' + ISNULL(ErrorProcedure, '?')
    FROM dbo.t_app_error_log ORDER BY ErrorLogId DESC;`);

  check('🔴 …and it was LOGGED before being re-thrown — a real bug leaves a trace',
    logged.startsWith('2601|'), logged);

  sql(`SET NOCOUNT ON; USE jp_app; DROP INDEX ${TEMP_INDEX} ON dbo.t_app_offers;`);

  const afterDrop = send(other.applicationId, 70000);

  check('🔴 …and the SAME call now SUCCEEDS — nothing but that index was refusing it',
    afterDrop.status === 1 && afterDrop.code === null, afterDrop.raw.split('|').slice(0, 3).join(' · '));

  // =========================================================================
  section('5. THE BOUNDARY — the generic endpoint, and the two vocabularies');
  // =========================================================================

  const boundary = makeApplication('6A Boundary job', 5);

  const forcedStage = proc(`EXEC dbo.USP_SetApplicationStatus
    @SchoolId=${schoolId}, @UserUid='${ownerUid}', @ApplicationId=${boundary.applicationId},
    @ToStatusId=7, @ActorUserId=${ownerUserId};`);

  check('🔴 the generic status endpoint STILL refuses the offer stages',
    forcedStage.status === 0 && forcedStage.code === 'OFFER_ACTION_REQUIRED',
    `${forcedStage.code} — "${forcedStage.raw.split('|')[2]}"`);

  check('⚠️ …with the NEW code, not the retired one — the product has offers now',
    !/OFFER_STAGE_UNAVAILABLE/.test(forcedStage.raw),
    'OFFER_STAGE_UNAVAILABLE is gone from this path');

  const forcedHire = proc(`EXEC dbo.USP_SetApplicationStatus
    @SchoolId=${schoolId}, @UserUid='${ownerUid}', @ApplicationId=${boundary.applicationId},
    @ToStatusId=10, @ActorUserId=${ownerUserId};`);

  check('🔴 …including Hired, which would otherwise be settable with nobody having accepted anything',
    forcedHire.status === 0 && forcedHire.code === 'OFFER_ACTION_REQUIRED', forcedHire.code);

  check('…and no offer or history row appeared from either attempt',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT COUNT(*) FROM dbo.t_app_offers WHERE ApplicationId = ${boundary.applicationId};`) === '0'
    && trail(boundary.applicationId).length === 0,
    'nothing written');

  // 🔴 The two vocabularies.
  const schoolWords = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT Code + '=' + Name FROM dbo.m_app_offer_status ORDER BY OfferStatusId;`);

  const teacherWords = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT Code + '=' + TeacherFacingName FROM dbo.m_app_offer_status ORDER BY OfferStatusId;`);

  console.log(`\n    school:  ${schoolWords.join(' · ')}`);
  console.log(`    teacher: ${teacherWords.join(' · ')}\n`);

  check('🔴 the two audiences have different words for the same four states',
    schoolWords.join() !== teacherWords.join()
    && teacherWords.some((w) => w.includes('You declined')),
    'separate columns, separate wording');

  const teacherProjection = sql(`SET NOCOUNT ON; USE jp_app;
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID('dbo.t_app_offers')
      AND c.name IN ('WithdrawalReason', 'WithdrawnByUserId');`);

  const myOffersBody = scalar(`SET NOCOUNT ON; USE jp_app;
    SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.USP_GetMyOffers')) LIKE '%o.WithdrawalReason%'
                THEN 'LEAKS' ELSE 'clean' END;`);

  check('🔴 …and the school\'s withdrawal note is ABSENT from the teacher\'s projection',
    teacherProjection.length === 2 && myOffersBody === 'clean',
    'the columns exist; USP_GetMyOffers does not select them');

  // =========================================================================
  section('6. HTTP — the permission split, and the scope negatives');
  // =========================================================================

  const httpApp = makeApplication('6A Http job', 5);

  const ownerToken = await login(OWNER);
  const viewerToken = await login(VIEWER);
  const otherSchoolToken = await login(OTHER_SCHOOL);

  const viewerSend = await j(`${APP}/applicants/${httpApp.applicationId}/offers`, {
    method: 'POST', headers: H(viewerToken),
    body: JSON.stringify({ designationId: 1, offeredSalary: 40000 }),
  });

  check('🔴 a Viewer cannot send an offer — OFFER.CREATE is not theirs',
    viewerSend.http === 403, `HTTP ${viewerSend.http} ${viewerSend.body?.code ?? ''}`);

  /*
    ⚠️ THE TWO REFUSALS ARE DIFFERENT THINGS, AND THE ACTORS PROVE IT.

    The Viewer above is in the SAME school and lacks the permission: 403. This
    owner HAS the permission and is in ANOTHER school: 404. If one account had
    been used for both, either answer would have been consistent with either
    explanation.
  */
  const crossSchool = await j(`${APP}/applicants/${httpApp.applicationId}/offers`, {
    method: 'POST', headers: H(otherSchoolToken),
    body: JSON.stringify({ designationId: 1, offeredSalary: 40000 }),
  });

  check('🔴 another school\'s OWNER — who holds OFFER.CREATE — gets 404, never 403 (2.6)',
    crossSchool.http === 404, `HTTP ${crossSchool.http} ${crossSchool.body?.code ?? ''}`);

  check('…and nothing about our applicant leaked into that refusal',
    !crossSchool.text.toLowerCase().includes('rohit')
    && !crossSchool.text.includes(String(httpApp.applicationId)),
    'the 404 says only that it was not found');

  const ownerSend = await j(`${APP}/applicants/${httpApp.applicationId}/offers`, {
    method: 'POST', headers: H(ownerToken),
    body: JSON.stringify({
      designationId: 1, offeredSalary: 48000, joiningDate: '2027-02-01',
      termsAndConditions: 'Two-year contract.',
    }),
  });

  check('…while the owner CAN — so the two refusals were the permission and the scope',
    ownerSend.http === 200 && ownerSend.body?.data?.created === true,
    `HTTP ${ownerSend.http}, offerId ${ownerSend.body?.data?.offerId}`);

  const viewerRead = await j(`${APP}/applicants/${httpApp.applicationId}/offers`, {
    headers: H(viewerToken),
  });

  check('⚠️ a Viewer CAN read the offer trail — reading an applicant includes what was offered them',
    viewerRead.http === 200 && (viewerRead.body?.data ?? []).length === 1,
    `HTTP ${viewerRead.http}, ${(viewerRead.body?.data ?? []).length} offer(s)`);

  const teacherToken = await login(TEACHER);

  const myOffers = await j(`${APP}/teacher/offers?liveOnly=true`, { headers: H(teacherToken) });
  const mine = (myOffers.body?.data ?? []).find(
    (o) => o.applicationId === httpApp.applicationId);

  check('the teacher sees the offer, in THEIR vocabulary',
    myOffers.http === 200 && mine?.offerStatusName === 'Offer received',
    `"${mine?.offerStatusName}"`);

  check('🔴 …and the school\'s withdrawal note is not in the bytes at all',
    !myOffers.text.toLowerCase().includes('withdrawalreason'),
    'absent from the response');

  const teacherHire = await j(`${APP}/applicants/${httpApp.applicationId}/hire`, {
    method: 'POST', headers: H(teacherToken), body: JSON.stringify({}),
  });

  check('a teacher cannot reach the school\'s hire action',
    teacherHire.http === 403, `HTTP ${teacherHire.http}`);

  const accept = await j(`${APP}/teacher/offers/${mine?.offerId}/respond`, {
    method: 'POST', headers: H(teacherToken),
    body: JSON.stringify({ accept: true, teacherRemarks: 'Looking forward to it.' }),
  });

  check('the teacher accepts over HTTP, and the application moves',
    accept.http === 200 && appStatus(httpApp.applicationId) === 8,
    `HTTP ${accept.http}, application ${appStatus(httpApp.applicationId)}`);

  const viewerHire = await j(`${APP}/applicants/${httpApp.applicationId}/hire`, {
    method: 'POST', headers: H(viewerToken), body: JSON.stringify({}),
  });

  check('🔴 a Viewer cannot confirm a hire either — OFFER.APPROVE is a separate permission',
    viewerHire.http === 403, `HTTP ${viewerHire.http}`);

  const ownerHire = await j(`${APP}/applicants/${httpApp.applicationId}/hire`, {
    method: 'POST', headers: H(ownerToken), body: JSON.stringify({ remarks: 'Started on time.' }),
  });

  check('…and the owner, who holds it, can',
    ownerHire.http === 200 && appStatus(httpApp.applicationId) === 10,
    `HTTP ${ownerHire.http}, application ${appStatus(httpApp.applicationId)} (Hired)`);

  // =========================================================================
  section('7. EXIT — nothing left behind, nothing spent');
  // =========================================================================

  const ledger = scalar(`SET NOCOUNT ON; USE jp_app; SELECT COUNT(*) FROM dbo.t_app_feature_ledger;`);

  check('🔴 the entitlement ledger is untouched — offers cost nothing (2.64)',
    ledger === '0', `${ledger} ledger row(s)`);

  cleanup();

  check('exit: every 6A fixture is removed',
    scalar(`SET NOCOUNT ON; USE jp_app;
      SELECT CAST((SELECT COUNT(*) FROM dbo.t_app_jobs WHERE JobTitle LIKE '6A %')
                + (SELECT COUNT(*) FROM dbo.t_app_offers) AS varchar(10));`) === '0',
    'no jobs, no offers');

  check('exit: the temporary index is gone and the index count is back to what it was',
    indexCount() === entryIndexes, `${entryIndexes} before, ${indexCount()} after`);

  /*
    ⚠️ ONE error-log row is expected — the forced 2601 in section 4, which is a
    REAL unexpected error and is supposed to be logged. That is the opposite of
    the approval engine's habit of logging ordinary concurrency conflicts (G31).
  */
  const logDelta = Number(errorLogCount()) - Number(entryErrors);

  check('exit: the error log gained exactly one row — the forced 2601, which SHOULD be logged',
    logDelta === 1, `${entryErrors} -> ${errorLogCount()}`);
} catch (error) {
  check('the suite ran to completion', false, error.message);
  console.error(error);
} finally {
  try { cleanup(); } catch { /* reported above */ }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(74)}`);
console.log(`  ${results.length - failed.length}/${results.length} PASSED`);
failed.forEach((f) => console.log(`    FAILED: ${f.name} (${f.detail ?? ''})`));
console.log(`${'='.repeat(74)}\n`);

process.exit(failed.length ? 1 : 0);
