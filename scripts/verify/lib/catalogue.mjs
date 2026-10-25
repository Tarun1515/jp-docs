/*
  THE ENTITLEMENT CATALOGUE, IN ONE PLACE.

  ----------------------------------------------------------------------------
  🔴 WHY THIS EXISTS — NINE SUITES WERE DELETING THE PRODUCT'S PRICING
  ----------------------------------------------------------------------------
  Under 2.64 the engine shipped switched OFF: every feature FREE, not one
  plan-feature mapping in existence. So "restore the shipped state" and "delete
  everything" were the same statement, and nine suites wrote it as:

      DELETE FROM m_mdm_plan_features;
      UPDATE m_mdm_features SET GatingModeId = 1 WHERE Is_Deleted = 0;

  SR-4 seeded a real catalogue — three school plans, eight mappings — and that
  sentence stopped being true. Measured: one run of jobs-consume.mjs left the
  catalogue at 0 mappings with JOB_POST back to FREE. Nine suites doing that on
  entry AND exit is the product's pricing deleted eighteen times per
  regression.

  ⚠️ THE FIX IS ONE FUNCTION, NOT NINE EDITS. A suite still clears the
  mappings — it needs to, it builds its own — and then calls restoreCatalogue()
  to put the real one back. The next catalogue change touches this file and the
  seed, and nothing else.

  🔴 THE CATALOGUE IS NOT RE-TYPED HERE. It is rebuilt by RUNNING THE SEED
  FILE, which owns it (2.47). A second copy of eight mappings inside a test
  helper is two places to update and one of them to forget — which is the exact
  failure this file exists to end.
*/
import { execFileSync } from 'node:child_process';

const SEED = 'D:\\Projects\\jp-backend\\database\\jp_mdm\\03_seed\\013_seed_school_plans.sql';

const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001'];

const run = (q) => execFileSync('sqlcmd', [...ARGS, '-h', '-1', '-W', '-s', '|', '-Q', q], { encoding: 'utf8' })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

/**
 * What the shipped catalogue is, so assertions read it from one place.
 *
 * ⚠️ These numbers mirror 013_seed_school_plans.sql's own exit assertions. If
 * the seed changes, its assertions fail first and name the mismatch — this is
 * the second line of defence, not the definition.
 */
export const CATALOGUE = {
  /** SCHOOL_FREE, SCHOOL_STANDARD, SCHOOL_UNLIMITED, TEACHER_FREE. */
  plans: 4,

  /** The eight rows 013 seeds. */
  mappings: 8,

  /** JOB_POST and TEACHER_INVITE are METERED (3); TEACHER_SEARCH is BOOLEAN (2). */
  jobPostGatingMode: 3,
};

/**
 * Put the real catalogue back after a suite has used its own.
 *
 * Call it wherever a suite used to "restore the shipped state" by deleting.
 */
export const restoreCatalogue = () => {
  /*
    Gating modes are reset to FREE first, then the seed flips the three it
    owns. Without this, a suite that set some OTHER feature to METERED would
    leave it that way — the seed only touches its own three.
  */
  run(`SET NOCOUNT ON; USE jp_mdm;
    DELETE FROM m_mdm_plan_features;
    UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1 WHERE Is_Deleted = 0;`);

  execFileSync('sqlcmd', [...ARGS, '-i', SEED], { encoding: 'utf8' });
};

/**
 * The catalogue as it stands, for an entry or exit assertion.
 *
 * @returns {{plans:number, mappings:number, jobPostGatingMode:number, ok:boolean}}
 */
export const catalogueState = () => {
  const [row] = run(`SET NOCOUNT ON; USE jp_mdm;
    SELECT CAST((SELECT COUNT(*) FROM m_mdm_plans WHERE Is_Deleted = 0) AS varchar(8))
         + '|' + CAST((SELECT COUNT(*) FROM m_mdm_plan_features WHERE Is_Deleted = 0) AS varchar(8))
         + '|' + CAST((SELECT GatingModeId FROM m_mdm_features WHERE FeatureCode = 'JOB_POST' AND Is_Deleted = 0) AS varchar(4));`);

  const [plans, mappings, mode] = (row ?? '0|0|0').split('|').map(Number);

  return {
    plans,
    mappings,
    jobPostGatingMode: mode,
    ok: plans === CATALOGUE.plans
      && mappings === CATALOGUE.mappings
      && mode === CATALOGUE.jobPostGatingMode,
  };
};

/** A one-line description, for a check()'s detail. */
export const catalogueSummary = () => {
  const s = catalogueState();

  return `${s.plans} plans, ${s.mappings} mappings, JOB_POST mode ${s.jobPostGatingMode}`
    + (s.ok ? '' : ` — EXPECTED ${CATALOGUE.plans}/${CATALOGUE.mappings}/${CATALOGUE.jobPostGatingMode}`);
};

/**
 * Turn the engine OFF for a suite that is not about billing.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHY THIS IS NEEDED, AND WHY IT IS NOT A CHEAT
 * ----------------------------------------------------------------------------
 * SR-4 made JOB_POST metered with a quota of 1 on the free plan — which is the
 * product the client asked for, and which the shared fixture school is on. The
 * regression then publishes jobs from about nine suites against that one
 * school: the first consumes the month's allowance and every later one is
 * refused.
 *
 * Those suites are not testing entitlement. They are testing job lifecycle,
 * notifications, applications, screens — and they need to publish a job the
 * way they always could.
 *
 * ⚠️ SO THEY ARRANGE THE STATE THEY ASSUME, rather than inheriting it. That is
 * the lesson SR-4 produced twice over: *a test that depends on a shipped
 * default breaks when the default becomes a decision*. Before SR-4 these
 * suites got an ungated engine for free; now they ask for it.
 *
 * ⚠️ IT IS NOT "DISABLE THE FEATURE WE JUST BUILT". The suites that DO test
 * gating — billing, billing-screens, entitlement-http, entitlement-engine,
 * jobs-consume, screens-25 — arrange metered state themselves and assert it.
 * Gating is covered; it is covered by the suites whose subject it is.
 *
 * Pair it with restoreCatalogue() on the way out, which every one of these
 * suites already calls.
 */
export const arrangeUngated = () => {
  run(`SET NOCOUNT ON; USE jp_mdm;
    DELETE FROM m_mdm_plan_features;
    UPDATE m_mdm_features SET GatingModeId = 1, Is_Active = 1 WHERE Is_Deleted = 0;`);
};
