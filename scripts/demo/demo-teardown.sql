/*==============================================================================
  DEMO FIXTURE — TEARDOWN

  Run AFTER a client demo, then run the verify runner to prove the shipped
  state is back.

      sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-teardown.sql
      node scripts/verify/run.mjs

  ----------------------------------------------------------------------------
  WHAT IT REMOVES
  ----------------------------------------------------------------------------
  Everything demo-setup.sql wrote, and everything the demo itself created
  AGAINST those plans — a plan-change request, its payment, its receipt, the
  subscription that activation wrote, and any ledger rows a consume produced.

  🔴 A DEMO IS NOT A DRY RUN. The point of showing the purchase flow is that
  it really happens: USP_VerifyPayment writes a receipt and activates a
  subscription in jp_app. Removing the plan and leaving the subscription
  pointing at it would leave an account holding a plan that no longer exists —
  which no suite checks for, because until now nothing could create it.

  ----------------------------------------------------------------------------
  ⚠️ IT RESTORES THE DOCUMENTED SHIPPED STATE, NOT "WHAT IT FOUND"
  ----------------------------------------------------------------------------
  Shipped state is: two plans (both free, both default), ZERO plan-feature
  mappings, every feature FREE and active, every owner on its free plan. That
  is what 008/010 seed and what the suites assert on entry and exit — so this
  deletes all mappings and resets all three gating modes rather than trying to
  remember which rows were there before. A previous run that died halfway is
  then cleaned too, which is the whole reason the project writes teardowns this
  way (entitlement-http records the argument).

  Re-runnable, and safe on a database that never had the fixture.
==============================================================================*/

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE jp_mdm;
GO
/*------------------------------------------------------------------------------
  ⚠️ ONE BATCH FROM HERE DOWN — NO GO SEPARATORS.

  The counters below are declared once and printed at the end, and a GO between
  those two points puts every one of them out of scope: the first version of
  this script failed with six copies of Msg 137, "Must declare the scalar
  variable @plansRemoved", AFTER having already deleted things. A teardown that
  half-runs and then fails to report what it did is worse than one that refuses
  to start.
------------------------------------------------------------------------------*/

DECLARE @plansBefore int = (SELECT COUNT(*) FROM dbo.m_mdm_plans
                             WHERE PlanCode LIKE 'DEMO_%' AND Is_Deleted = 0);

DECLARE @demoIds TABLE (PlanId int PRIMARY KEY);

INSERT INTO @demoIds (PlanId)
SELECT PlanId FROM dbo.m_mdm_plans WHERE PlanCode LIKE 'DEMO_%';

/*------------------------------------------------------------------------------
  1. WHAT THE DEMO ITSELF CREATED, in jp_app — before the plans go

  🔴 ORDER MATTERS AND IT IS THE REVERSE OF CREATION. A subscription carries
  SourcePaymentUid, so the payment is what links it back to the demo plan; drop
  the payment first and the subscription becomes unattributable.
------------------------------------------------------------------------------*/
DECLARE @subs int = 0, @ledger int = 0, @restored int = 0;

DELETE FROM jp_app.dbo.t_app_feature_ledger
 WHERE Notes LIKE 'demo%';

SET @ledger = @@ROWCOUNT;

/*
  🔴 BOTH HALVES, AND THE SECOND ONE WAS MISSING IN THE FIRST VERSION.

  Activation does not simply repoint the existing row. USP_VerifyPayment ENDS
  the old subscription — StatusId 2, EndsOn today — and INSERTS a new row for
  the purchased plan, carrying SourcePaymentUid. So deleting the demo row alone
  leaves the account's ORIGINAL row marked as ended: on the free plan, but
  expired.

  Measured after the first teardown ran:

      greenwood subscription: plan 1 status 2 ends 2026-10-20 srcpay null

  Shipped state is plan 1, status 1, EndsOn NULL. An account sitting on an
  EXPIRED free plan is the lapsed-subscription case G38 was about — the demo
  teardown would have manufactured exactly the state that phase spent a day
  closing, quietly, on a database everybody then runs the suites against.

  ⚠️ THE SHAPE IS BORROWED FROM billing-screens.mjs's restore, deliberately —
  it is the same problem and the project already answered it: delete every row
  an activation created (SourcePaymentUid IS NOT NULL), then put what remains
  back to the documented shipped state rather than to whatever it happened to
  be.
*/
DELETE FROM jp_app.dbo.t_app_subscriptions
 WHERE SourcePaymentUid IS NOT NULL
    OR PlanId IN (SELECT PlanId FROM @demoIds);

SET @subs = @@ROWCOUNT;

UPDATE jp_app.dbo.t_app_subscriptions
   SET StatusId = 1,
       Is_Active = 1,
       EndsOn = NULL,
       SourcePaymentUid = NULL,
       ModifiedOn = NULL,
       ModifiedBy = NULL,
       /* 2 = TEACHER_FREE, 1 = SCHOOL_FREE — the only two defaults (008). */
       PlanId = CASE WHEN PlanId = 2 THEN 2 ELSE 1 END
 WHERE Is_Deleted = 0
   AND (StatusId <> 1 OR Is_Active <> 1 OR EndsOn IS NOT NULL
        OR SourcePaymentUid IS NOT NULL OR PlanId NOT IN (1, 2));

SET @restored = @@ROWCOUNT;

/*------------------------------------------------------------------------------
  2. THE PAYMENTS, RECEIPTS AND REQUESTS the demo raised
------------------------------------------------------------------------------*/
DECLARE @payments int = 0, @receipts int = 0, @requests int = 0;

DECLARE @demoPlanIds TABLE (PlanId int PRIMARY KEY);

INSERT INTO @demoPlanIds (PlanId)
SELECT PlanId FROM dbo.m_mdm_plans WHERE PlanCode LIKE 'DEMO_%';

DELETE FROM dbo.t_mdm_payment_receipts
 WHERE PaymentId IN (SELECT PaymentId FROM dbo.t_mdm_request_payments
                      WHERE PlanId IN (SELECT PlanId FROM @demoPlanIds));

SET @receipts = @@ROWCOUNT;

DECLARE @reqIds TABLE (RequestId bigint PRIMARY KEY);

INSERT INTO @reqIds (RequestId)
SELECT DISTINCT RequestId FROM dbo.t_mdm_request_payments
 WHERE PlanId IN (SELECT PlanId FROM @demoPlanIds) AND RequestId IS NOT NULL;

DELETE FROM dbo.t_mdm_request_payments
 WHERE PlanId IN (SELECT PlanId FROM @demoPlanIds);

SET @payments = @@ROWCOUNT;

/* The approval trail for those requests, then the requests themselves. */
DELETE FROM dbo.t_mdm_request_approvals WHERE RequestId IN (SELECT RequestId FROM @reqIds);

DELETE FROM dbo.t_mdm_approval_requests WHERE RequestId IN (SELECT RequestId FROM @reqIds);

SET @requests = @@ROWCOUNT;

/*------------------------------------------------------------------------------
  3. THE FIXTURE ITSELF — mappings, gating, plans
------------------------------------------------------------------------------*/
DECLARE @mapsRemoved int = 0, @plansRemoved int = 0;

/*
  ⚠️ ALL mappings, not just the demo plans'. Shipped state is zero mappings
  (jobs-consume.mjs asserts exactly that on exit), and setup wrote some against
  the FREE plans so the demo could show 3 -> 25.
*/
DELETE FROM dbo.m_mdm_plan_features;

SET @mapsRemoved = @@ROWCOUNT;

UPDATE dbo.m_mdm_features
   SET GatingModeId = 1, Is_Active = 1
 WHERE Is_Deleted = 0 AND (GatingModeId <> 1 OR Is_Active <> 1);

DELETE FROM dbo.m_mdm_plans WHERE PlanCode LIKE 'DEMO_%';

SET @plansRemoved = @@ROWCOUNT;

/*------------------------------------------------------------------------------
  4. PROVE THE SHIPPED STATE IS BACK — the numbers, not a claim
------------------------------------------------------------------------------*/
DECLARE @plansLeft int = (SELECT COUNT(*) FROM dbo.m_mdm_plans WHERE PlanCode LIKE 'DEMO_%');
DECLARE @mapsLeft  int = (SELECT COUNT(*) FROM dbo.m_mdm_plan_features WHERE Is_Deleted = 0);
DECLARE @notFree   int = (SELECT COUNT(*) FROM dbo.m_mdm_features
                           WHERE Is_Deleted = 0 AND (GatingModeId <> 1 OR Is_Active <> 1));
DECLARE @priced    int = (SELECT COUNT(*) FROM dbo.m_mdm_plans
                           WHERE Price > 0 AND IsPublic = 1 AND IsDefault = 0 AND Is_Deleted = 0);
DECLARE @onDemo    int = (SELECT COUNT(*) FROM jp_app.dbo.t_app_subscriptions s
                           WHERE NOT EXISTS (SELECT 1 FROM dbo.m_mdm_plans p WHERE p.PlanId = s.PlanId));
DECLARE @payLeft   int = (SELECT COUNT(*) FROM dbo.t_mdm_request_payments rp
                           WHERE NOT EXISTS (SELECT 1 FROM dbo.m_mdm_plans p WHERE p.PlanId = rp.PlanId));

/*
  🔴 THE CHECK THAT WOULD HAVE CAUGHT THE FIRST VERSION. Nothing may be left
  expired, ended, or carrying a payment reference — that is the state an
  activation leaves behind and the state the suites' entry assertions assume is
  absent.
*/
DECLARE @notShipped int = (SELECT COUNT(*) FROM jp_app.dbo.t_app_subscriptions
                            WHERE Is_Deleted = 0
                              AND (StatusId <> 1 OR Is_Active <> 1 OR EndsOn IS NOT NULL
                                   OR SourcePaymentUid IS NOT NULL OR PlanId NOT IN (1, 2)));

PRINT '';
PRINT '  demo-teardown done';
PRINT '    demo plans removed      : ' + CAST(@plansRemoved AS varchar(8)) + ' (found ' + CAST(@plansBefore AS varchar(8)) + ')';
PRINT '    plan-feature mappings   : ' + CAST(@mapsRemoved AS varchar(8)) + ' removed, ' + CAST(@mapsLeft AS varchar(8)) + ' left (expected 0)';
PRINT '    activation rows removed : ' + CAST(@subs AS varchar(8));
PRINT '    subscriptions restored  : ' + CAST(@restored AS varchar(8)) + ' back to free/active/no-end';
PRINT '    payments / receipts     : ' + CAST(@payments AS varchar(8)) + ' / ' + CAST(@receipts AS varchar(8));
PRINT '    plan-change requests    : ' + CAST(@requests AS varchar(8));
PRINT '    ledger rows (demo%)     : ' + CAST(@ledger AS varchar(8));
PRINT '';
PRINT '  shipped state:';
PRINT '    DEMO_ plans left        : ' + CAST(@plansLeft AS varchar(8)) + ' (must be 0)';
PRINT '    features not FREE/active: ' + CAST(@notFree AS varchar(8)) + ' (must be 0)';
PRINT '    priced PUBLIC plans     : ' + CAST(@priced AS varchar(8)) + ' (must be 0 — this is what 011 guards)';
PRINT '    orphaned subscriptions  : ' + CAST(@onDemo AS varchar(8)) + ' (must be 0)';
PRINT '    orphaned payments       : ' + CAST(@payLeft AS varchar(8)) + ' (must be 0)';
PRINT '    subscriptions off-shipped: ' + CAST(@notShipped AS varchar(8)) + ' (must be 0 - expired/ended/paid-for)';
PRINT '';

IF @plansLeft <> 0 OR @mapsLeft <> 0 OR @notFree <> 0 OR @priced <> 0 OR @onDemo <> 0
   OR @payLeft <> 0 OR @notShipped <> 0
    RAISERROR('demo-teardown: the shipped state is NOT restored - read the numbers above. Do not commit, and do not run the suites until this is 0 across the board.', 16, 1);
GO
