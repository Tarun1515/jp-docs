/*==============================================================================
  DEMO FIXTURE — A PRICED PLAN THE DEMO CAN SELL

  Run BEFORE a client demo. Run demo-teardown.sql AFTER it. Never commit what
  this writes as seed data.

      sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-setup.sql

  ----------------------------------------------------------------------------
  🔴 READ THIS FIRST: WHILE THIS FIXTURE EXISTS, THE BUILD FAILS ON PURPOSE
  ----------------------------------------------------------------------------
  011_seed_plan_change_request.sql ends with a build guard that fails if a
  PRICED, PUBLIC, non-default plan exists. These plans are exactly that, so
  while they are installed:

      run_all.sql            -> FAILS at 011, naming DEMO_SCHOOL_GROWTH
      the verify runner      -> several suites fail their entry/exit state

  That is the guard working, not a problem to route around. 011's own comment
  says a priced public plan left behind "shows up here as a loud build failure,
  which is the correct outcome". The fix is demo-teardown.sql, every time.

  ----------------------------------------------------------------------------
  🔴 WHY NOT IsPublic = 0, WHICH WOULD KEEP THE BUILD GREEN
  ----------------------------------------------------------------------------
  Because then there is no demo. Measured before choosing, on a throwaway
  plan priced 999 with IsPublic = 0:

      011 guard sees priced PUBLIC plan(s): [(none)]      <- build stays green
      USP_RequestPlanChange            -> 0|NOT_FOUND     <- cannot be sold

  USP_RequestPlanChange requires IsPublic = 1 and answers NOT_FOUND otherwise
  (2.6 — a refusal must not confirm the thing exists). USP_GetPlanCatalog
  filters the same way, twice. So a non-public plan is invisible in the
  catalogue AND unbuyable: the demo would show a plan nobody can choose.

  A plan the demo can SELL must be public. The guard is left exactly as it is
  — not relaxed, not excluded, not given an allowlist — and it fires while the
  fixture is installed. That is the honest trade, and it is reversible in one
  command.

  ----------------------------------------------------------------------------
  WHAT THIS WRITES
  ----------------------------------------------------------------------------
    2 plans   DEMO_SCHOOL_GROWTH, DEMO_TEACHER_GROWTH — 999, 30 days, public
    3 gating  JOB_POST + TEACHER_INVITE -> METERED, TEACHER_SEARCH -> BOOLEAN
    8 maps    the two demo plans and the two FREE plans, so the demo can show
              a SMALL allowance becoming a BIGGER one

  ⚠️ THE FREE PLANS ARE MAPPED TOO, and that is the point of the demo rather
  than an accident. Without a free-plan mapping, a metered feature with no
  mapping refuses outright, and the demo would show "blocked -> 25" instead of
  "3 -> 25". The second is the product's actual story.

  ⚠️ CODES ARE PREFIXED DEMO_ (2.47 — a live code is forever). Nothing real can
  ever be given these codes, and teardown can find them with certainty.

  ⚠️ THE NAME SAYS SAMPLE AND THE PRICE IS OBVIOUSLY PLACEHOLDER. §4 Q4 is
  still with the client; a number shown in a demo gets quoted back, which is
  the whole reason 008 forbids seeding paid tiers. "Growth Plan (SAMPLE —
  pricing TBD)" at 999 cannot be mistaken for a decision.

  Re-runnable: insert-if-absent, so running it twice changes nothing.
==============================================================================*/

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE jp_mdm;
GO

/*------------------------------------------------------------------------------
  1. THE TWO PLANS
------------------------------------------------------------------------------*/
DECLARE @DemoName nvarchar(100) = N'Growth Plan (SAMPLE - pricing TBD)';

IF NOT EXISTS (SELECT 1 FROM dbo.m_mdm_plans WHERE PlanCode = 'DEMO_SCHOOL_GROWTH')
    INSERT INTO dbo.m_mdm_plans
        (PlanCode, UserTypeId, Name, DurationDays, Price, IsDefault, IsPublic, DisplayOrder)
    VALUES
        ('DEMO_SCHOOL_GROWTH', 2, @DemoName, 30, 999.00, 0, 1, 95);

IF NOT EXISTS (SELECT 1 FROM dbo.m_mdm_plans WHERE PlanCode = 'DEMO_TEACHER_GROWTH')
    INSERT INTO dbo.m_mdm_plans
        (PlanCode, UserTypeId, Name, DurationDays, Price, IsDefault, IsPublic, DisplayOrder)
    VALUES
        ('DEMO_TEACHER_GROWTH', 3, @DemoName, 30, 999.00, 0, 1, 96);
GO

/*------------------------------------------------------------------------------
  2. GATING MODES — a feature nobody meters cannot show a quota

  🔴 GatingModeId lives on the FEATURE, not on the mapping, so this is a
  PRODUCT-WIDE switch for the length of the demo. 1 FREE · 2 BOOLEAN · 3
  METERED.

  ⚠️ Teardown puts all three back to FREE, which is the documented shipped
  state (008/010, and jobs-consume.mjs asserts JOB_POST = 1|1 on exit).
------------------------------------------------------------------------------*/
UPDATE dbo.m_mdm_features SET GatingModeId = 3, Is_Active = 1
 WHERE FeatureCode IN ('JOB_POST', 'TEACHER_INVITE') AND Is_Deleted = 0;

UPDATE dbo.m_mdm_features SET GatingModeId = 2, Is_Active = 1
 WHERE FeatureCode = 'TEACHER_SEARCH' AND Is_Deleted = 0;
GO

/*------------------------------------------------------------------------------
  3. THE MAPPINGS

  ⚠️ A NULL quota on an included feature means "unlimited within the plan" —
  the same convention USP_ConsumeFeatureCore's @QuotaPerPeriod uses, so a
  BOOLEAN feature is IsIncluded = 1 with QuotaPerPeriod NULL.
------------------------------------------------------------------------------*/
DECLARE @maps TABLE (PlanCode varchar(50), FeatureCode varchar(50), IsIncluded tinyint, Quota int);

INSERT INTO @maps (PlanCode, FeatureCode, IsIncluded, Quota)
VALUES
    -- the demo tier: what the client is being shown
    ('DEMO_SCHOOL_GROWTH',  'JOB_POST',       1, 25),
    ('DEMO_SCHOOL_GROWTH',  'TEACHER_INVITE', 1, 10),
    ('DEMO_SCHOOL_GROWTH',  'TEACHER_SEARCH', 1, NULL),
    ('DEMO_TEACHER_GROWTH', 'TEACHER_SEARCH', 1, NULL),

    -- the free baseline it is bought UP from, so the demo can show 3 -> 25
    ('SCHOOL_FREE',         'JOB_POST',       1, 3),
    ('SCHOOL_FREE',         'TEACHER_INVITE', 1, 1),
    ('SCHOOL_FREE',         'TEACHER_SEARCH', 0, NULL),
    ('TEACHER_FREE',        'TEACHER_SEARCH', 0, NULL);

INSERT INTO dbo.m_mdm_plan_features (PlanId, FeatureId, IsIncluded, QuotaPerPeriod)
SELECT p.PlanId, f.FeatureId, m.IsIncluded, m.Quota
  FROM @maps m
  INNER JOIN dbo.m_mdm_plans    p ON p.PlanCode    = m.PlanCode    AND p.Is_Deleted = 0
  INNER JOIN dbo.m_mdm_features f ON f.FeatureCode = m.FeatureCode AND f.Is_Deleted = 0
 WHERE NOT EXISTS (SELECT 1 FROM dbo.m_mdm_plan_features pf
                    WHERE pf.PlanId = p.PlanId AND pf.FeatureId = f.FeatureId
                      AND pf.Is_Deleted = 0);
GO

/*------------------------------------------------------------------------------
  4. WHAT LANDED, AND THE WARNING THAT MATTERS MOST
------------------------------------------------------------------------------*/
DECLARE @plans int = (SELECT COUNT(*) FROM dbo.m_mdm_plans
                       WHERE PlanCode LIKE 'DEMO_%' AND Is_Deleted = 0);

DECLARE @mapped int = (SELECT COUNT(*) FROM dbo.m_mdm_plan_features WHERE Is_Deleted = 0);

DECLARE @gating varchar(200) = (SELECT STRING_AGG(CAST(FeatureCode + '=' + CAST(GatingModeId AS varchar(3)) AS varchar(40)), ' ')
                                  FROM dbo.m_mdm_features
                                 WHERE FeatureCode IN ('JOB_POST', 'TEACHER_INVITE', 'TEACHER_SEARCH')
                                   AND Is_Deleted = 0);

PRINT '';
PRINT '  demo-setup done';
PRINT '    demo plans   : ' + CAST(@plans AS varchar(8)) + ' (expected 2)';
PRINT '    mappings     : ' + CAST(@mapped AS varchar(8)) + ' (expected 8)';
PRINT '    gating now   : ' + ISNULL(@gating, '(none)');
PRINT '';
PRINT '  *** THE BUILD AND THE SUITES NOW FAIL BY DESIGN ***';
PRINT '    011 fails on a priced public plan, and suites assert zero mappings.';
PRINT '    Run scripts/demo/demo-teardown.sql when the demo is over, then';
PRINT '    scripts/verify/run.mjs to confirm the shipped state is back.';
PRINT '';
GO
