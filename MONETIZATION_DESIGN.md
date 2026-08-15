# Monetization design — the entitlement engine

**Status:** design accepted, not built. Written 2026-08-15 (Phase 2.5-PRE).
**Builds in:** Phase 2.5 (engine) and Phase 6.5 (payment, invoices, purchase).

This is the design the engine phase implements. It exists because the decisions
below were made in a planning conversation and never written down — and a
verbal design is one nobody can check a build against.

---

## 🔴 The prohibition this document carries at its head

**The entitlement engine and contact unlock never reference each other, in
either direction.**

A subscription buys the school's **capability** — whether it may search the
teacher database at all, how many invitations it may send, whether it may post
a job. It never buys a teacher's phone number or email.
`fn_TeacherContactUnlocked` returns true on exactly two paths — the teacher
applied to this school, or accepted its invitation — and **decision 2.56 is
LOCKED**.

`010_teacher_public_profile.sql` already carries this rule at its own head:

> *"Not 'the school has a paid plan'. Not 'the school has invites remaining'. A
> subscription buys CAPABILITY — whether a school may search at all, how many
> invites it may send — and never the teacher's contact details (2.56). If a
> future requirement seems to need payment here, the requirement is being
> described wrongly: what is being sold is reach, and reach is invites."*

That sentence is also the answer to how teacher-search and invites are gated —
see Decision 1. Every engine object gets the same prohibition in its header, and
the phase's verification greps both directions and shows the output.

---

## Starting inventory — what already exists

From the reality check that stopped the first Phase 2.5 attempt. The engine
**extends** this and duplicates none of it.

### `m_mdm_plans` (jp_mdm) — built in 2F

| Column | Note |
|---|---|
| `PlanId` · `PlanCode` · `Name` | Code stable, Name editable (2.47) |
| `UserTypeId` | 2 = School, 3 = Teacher. Cross-database meaning, no FK (2.2) |
| `DurationDays` | NULL = perpetual |
| `Price` | `decimal(10,2)`, ₹0 today |
| `IsDefault` | Exactly one per user type, filtered unique index |
| `IsPublic` · `DisplayOrder` | Nothing reads these yet |

Seeded: `SCHOOL_FREE` and `TEACHER_FREE`, both ₹0, perpetual, default.

**There is no feature, quota, credit or entitlement column anywhere in it.**
Everything in this document is new tables beside it, not changes to it.

### `t_app_subscriptions` (jp_app) — built in 2F

`OwnerUid` (organisation for a school, user for a teacher) · `PlanId`
(cross-database, no FK) · `StartsOn` · `EndsOn` (NULL = perpetual) · `StatusId`
· `AutoRenew` · standard columns.

`UQ_t_app_subscriptions_OneActivePerOwner` already guarantees one active
subscription per owner. **No change is required to this table.**

### `m_mdm_subscription_status` (jp_mdm)

Verified present: `1 ACTIVE · 2 EXPIRED · 3 CANCELLED`. All 15 live
subscription rows are `StatusId = 1, Is_Active = 1`.

⚠️ Note for the engine: this table carries **both** `StatusId` and `Is_Active`,
and they can disagree. The engine treats a subscription as usable only when
`Is_Active = 1 AND Is_Deleted = 0 AND StatusId = 1` and, if `EndsOn` is not
null, `EndsOn > now`. Any other combination is `SUBSCRIPTION_INACTIVE`.

---

## Constraints — restated here, not decided here

These were settled in earlier phases or prior planning. The engine implements
them; this document does not reopen them.

1. **Consume is one atomic operation.** Check-then-Consume across two calls is
   forbidden. Two parallel sessions racing for the last unit: exactly one
   succeeds and the other receives a refusal with its own Code (2.21).

2. **Plan quota burns before credits, always** — including under concurrency.
   Credits are money the customer already paid; quota is included allowance.

3. **Every account has a subscription from day one.** This is BUILT, not
   proposed: 2F puts `SCHOOL_FREE` into provisioning and G21's closure puts
   `TEACHER_FREE` into teacher signup.

   The reason travels with it: a nullable subscription means a null check in
   every gated path, and one day one of those checks is missed — and a missed
   null check fails *open*, granting access nobody paid for.

   🔴 **The engine therefore treats a missing subscription row as a
   data-integrity error (`SUBSCRIPTION_MISSING`), never as a normal state.** It
   is logged at Error with the OwnerUid. It is not a refusal a user should ever
   meet, and if one does, provisioning is broken.

4. **The engine and contact unlock never touch** — see the head of this
   document.

---

## Decision 1 — Gating modes

### The decision

**Three modes, and a kill switch that is not a mode.**

| Mode | Id | Meaning | Mapping needed | Writes to ledger |
|---|---|---|---|---|
| `FREE` | 1 | Ungated. Any account with a usable subscription may use it | none | no |
| `BOOLEAN` | 2 | Included in the plan, or not. No count | yes | **no** |
| `METERED` | 3 | Quota per period, then credits, then refusal | yes | yes |

**Disabled is `m_mdm_features.Is_Active = 0`, not a fourth mode.**

### Why not four modes

The four-mode version reads well in a list and breaks in operation.

A kill switch is **temporary and must be reversible without data loss**. If
`DISABLED` is a mode, then killing a metered feature overwrites the fact that it
was metered:

```
JOB_POST: mode = METERED   →  incident  →  mode = DISABLED
                                        →  ...restore to what, exactly?
```

Somebody has to *remember* it was Metered, from a chat message, at the moment
they are already dealing with an incident. With `Is_Active`:

```
JOB_POST: mode = METERED, Is_Active = 1  →  Is_Active = 0  →  Is_Active = 1
```

The mode is never touched and the restore is unambiguous.

It is also the schema's existing vocabulary. Every table in this system carries
`Is_Active` and 2.47's reconciliation guidance is explicit — *"jo row nahi
chahiye: `Is_Active = 0`, kabhi DELETE nahi"*. A feature that is switched off is
the same act as a master row that is switched off, and giving it a second
spelling means two ways to express one idea.

**The mode answers "how is access decided"; `Is_Active` answers "does this
feature exist right now".** Those are different questions and a single enum
answering both is the thing that eventually needs untangling.

⚠️ **The cost, stated honestly:** the admin screen has one dropdown *and* one
toggle rather than a single dropdown with four options. That is one more control
on the screen. It is worth it — see the restore path above.

### How teacher-search is gated — the concrete answer

| Feature | Mode | Why |
|---|---|---|
| `TEACHER_SEARCH` | **BOOLEAN** | A school's plan either allows searching the teacher database or it does not. *How many times* is not a question anybody asks, and metering it would meter curiosity |
| `TEACHER_INVITE` | **METERED** | This is the reach that is actually sold. The contact procedure names it: *"how many invites it may send"* |
| `JOB_POST` | **METERED** | The first consumer, Phase 4 |

This split is not incidental — it is 2.56 expressed as a catalog. Searching is
looking; inviting is reaching a specific person; contact arrives only if that
person says yes. Metering the middle one is exactly where the money belongs, and
it is why the search feature must never be metered *as a proxy* for limiting
contact.

### Does a Boolean access check write a ledger row?

**No. Nothing at all.**

**Rationale.** The ledger's job is to make balances reconstructible — the engine
phase's own verification recomputes balances from it and asserts agreement. A
zero-cost row participates in no balance, so it is not a ledger entry; it is an
access log wearing a ledger's clothes.

The volume settles it. A school browsing search results all afternoon would
write thousands of rows that can never change a number, in the same table where
every row that *does* change a number lives. Every balance query would need a
filter forever, and the day somebody forgets it, the sums still come out right
while every row count in every report is wrong. That is the worst kind of bug:
correct-looking output from a wrong query.

⚠️ **If access auditing is wanted** — "who searched, when" — it belongs in an
access log with its own retention policy, not in the money ledger. Recorded here
as a Phase 6.5+ decision, deliberately not smuggled in now.

⚠️ **But the check is still centralised.** Boolean features go through the same
`USP_ConsumeFeature` call as metered ones and receive `Consumed = 0`. Phase 6
must not hand-roll `IF the plan has the feature` — one place decides
entitlement, and it is not the calling screen.

### Full precedence

Evaluated in this order, first failure wins:

```
1. Feature exists and Is_Active = 1 and Is_Deleted = 0
     else  FEATURE_DISABLED
2. Owner has a subscription row
     else  SUBSCRIPTION_MISSING        🔴 integrity error, logged at Error
3. Subscription usable: Is_Active = 1, Is_Deleted = 0, StatusId = 1,
   and (EndsOn IS NULL OR EndsOn > now)
     else  SUBSCRIPTION_INACTIVE
4. By mode:
     FREE      → allowed, nothing written
     BOOLEAN   → mapping exists for (PlanId, FeatureId) with IsIncluded = 1
                   → allowed, nothing written
                   else  PLAN_LACKS_FEATURE
     METERED   → mapping exists
                   else  PLAN_LACKS_FEATURE
                 quota remaining this period  → consume from QUOTA
                 else credits remaining       → consume from CREDIT
                 else  QUOTA_EXHAUSTED
```

**Why Disabled outranks everything:** a kill switch that could be defeated by
having the right plan is not a kill switch. It also gives the operator one
predictable answer during an incident instead of a different refusal per plan.

**Why the integrity error is checked before the subscription's state:** the
distinction matters to whoever reads the logs. "No row" is our bug; "expired
row" is the customer's situation.

---

## Decision 2 — Feature catalog

**`m_mdm_features` in jp_mdm**, Code-stable and Name-editable per 2.47 — the
same contract every other master carries: `FeatureCode` is what code and
mappings resolve by and is never changed on a live row; `Name` is display text
the client may rewrite freely.

**Granularity:** one feature per *capability a plan could plausibly sell
separately*. The test is commercial, not technical — if two actions would always
be sold together, they are one feature.

Initial catalog, all seeded `FREE` (see "Seeding" below):

| FeatureCode | Applies to | Mode at build | First consumer |
|---|---|---|---|
| `JOB_POST` | School | FREE → METERED in 6.5 | Phase 4 |
| `JOB_FEATURED` | School | FREE | Phase 4 |
| `TEACHER_SEARCH` | School | FREE → BOOLEAN in 6.5 | Phase 6 |
| `TEACHER_INVITE` | School | FREE → METERED in 6.5 | Phase 6 |
| `APPLICATION_VIEW` | School | FREE | Phase 5 |
| `TEACHER_PROFILE_BOOST` | Teacher | FREE | Phase 6.5 |

`AppliesToUserTypeId` mirrors `m_mdm_plans.UserTypeId` and exists for the same
reason: a school feature mapped to a teacher plan is not a pricing mistake, it
is a mapping whose limits mean nothing. The admin screen filters by it so that
combination cannot be built by accident.

⚠️ **`GatingModeId` is a `tinyint` with a CHECK constraint plus a small master
for labels**, following the precedent `t_app_school_users.RoleInSchool` set in
2.51: three values that are *structural to the product and branched on in code*,
so a fourth is a code change and not a data change. The master exists so the
admin dropdown is data (2.7); the CHECK exists so a fourth value cannot arrive
without the code that understands it.

---

## Decision 3 — Plan × feature semantics

**`m_mdm_plan_features` in jp_mdm.** Both sides live in jp_mdm, so this is a
plain foreign-keyed bridge with no cross-database anything.

| Column | Meaning |
|---|---|
| `PlanId` · `FeatureId` | FK both sides. Filtered unique on the pair `WHERE Is_Deleted = 0` |
| `IsIncluded` | For BOOLEAN. `1` = the plan grants it |
| `QuotaPerPeriod` | For METERED. `NULL` = unlimited-within-plan; `0` = explicitly none |
| standard columns | 2.4 |

### What a missing mapping means

| Mode | No mapping row | Confirmed |
|---|---|---|
| FREE | irrelevant — the mode is the grant, no mapping is ever read | — |
| BOOLEAN | **DENIED** (`PLAN_LACKS_FEATURE`) | yes, as directed |
| METERED | **DENIED** (`PLAN_LACKS_FEATURE`) | yes |

**Rationale, and it is the same for both:** inclusion is an explicit statement.
Absence of a row is absence of a decision, and a system that reads "nobody said
anything" as "yes" grants capability nobody sold. Failing closed is also the
only safe default for a table an admin edits by hand — a mis-click that *deletes*
a mapping row removes access rather than granting it to everyone.

⚠️ The consequence to accept: **adding a feature to the catalog grants it to
nobody until it is mapped.** That is correct and slightly inconvenient — the
admin screen must therefore make an unmapped feature visible, not silent.

### The exact lookup a consume performs

```sql
-- FREE: no lookup at all.

-- BOOLEAN
SELECT 1
FROM m_mdm_plan_features pf
WHERE pf.PlanId = @PlanId AND pf.FeatureId = @FeatureId
  AND pf.IsIncluded = 1
  AND pf.Is_Active = 1 AND pf.Is_Deleted = 0;
-- no row  → PLAN_LACKS_FEATURE

-- METERED
SELECT pf.QuotaPerPeriod
FROM m_mdm_plan_features pf
WHERE pf.PlanId = @PlanId AND pf.FeatureId = @FeatureId
  AND pf.Is_Active = 1 AND pf.Is_Deleted = 0;
-- no row  → PLAN_LACKS_FEATURE
-- then: used-this-period (derived, Decision 6) vs QuotaPerPeriod,
--       then credit balance (derived, Decision 4)
```

⚠️ Plans and features are in **jp_mdm**; the ledger and subscriptions are in
**jp_app**. Neither database may join to the other (2.2), so the consume
procedure lives in **jp_app** and receives `@PlanId`, `@FeatureId`, `@GatingMode`
and `@QuotaPerPeriod` as parameters, resolved by the API from jp_mdm first. That
is the same shape provisioning already uses to carry `PlanId` across, and the
same shape 3I's dashboard uses to carry a plan's name back.

---

## 🔴 Gating reads never come from the master cache

That resolution — the feature's `Is_Active` and `GatingModeId`, and the
plan-feature mapping — is the one read in this design that must never be
allowed to go stale. **It is never served from the master cache.**

### What the cache actually is today, stated precisely

Worth getting right, because the danger is not where it first appears:

- **The API holds no server-side cache.** `MasterService` reads the database on
  every call. There is no `IMemoryCache` anywhere in the backend.
- The hour is `[ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Client)]`
  on `/api/masters/*` — the API *telling clients* to cache — plus the Angular
  `MasterService`'s in-memory cache, which lives for the session.

So there is no stale-cache bug to fix. The trap is the other direction:
**features and gating modes are master data by every structural test** — they
are `m_mdm_*` tables, they are pure reference data, they change roughly never,
and they will be read constantly. Everything about them says "put them behind
`IMasterService`", and `IMasterService` is the single most obvious place in this
codebase to add an `IMemoryCache`. The day somebody does — a reasonable
optimisation, correct for subjects and boards — gating quietly acquires an hour
of lag.

### Why an hour of lag is disqualifying here, and not for subjects

- **The kill switch would engage up to an hour after the operator flips it.** A
  feature stays live during exactly the incident it was switched off for.
  🔴 That defeats this document's own argument in Decision 1: `Is_Active` was
  chosen over a fourth mode *because it restores cleanly under incident
  conditions*. A kill switch with an hour of lag is not a kill switch, and the
  argument for it would be self-refuting.
- **A `FREE → METERED` flip keeps serving free until the cache turns.** Every
  consume in that window is revenue given away, and nothing anywhere records
  that it happened.

Both fail **silently**. Nothing errors, no log line appears, and the screen the
operator is looking at shows the new value — which is the shape of bug that
survives longest.

A stale subject name for an hour is a cosmetic inconvenience. A stale
entitlement for an hour is an unsellable kill switch and unbilled usage. Same
storage, same access pattern, completely different tolerance — and that
difference is the reason this rule exists as a rule rather than a preference.

### The choice: **(a) a direct read per consume**

Not a short-TTL cache with invalidation.

**Note what this actually is:** the read is *already* in the design — the API
resolves from jp_mdm and passes parameters into the jp_app procedure, because
the two databases cannot join (2.2). So choosing (a) is not adding work. It is
**writing down that this read is never allowed to become a cache**, which is a
different and more durable thing than choosing an implementation.

Why it is affordable:

- **A consume is already a write.** It opens a transaction, takes `UPDLOCK,
  HOLDLOCK` on the subscription row, derives two aggregates and inserts a row.
  One indexed singleton `SELECT` in front of that is dominated by the work it
  precedes.
- **The volume is nothing like masters.** `masters/bulk` is fetched by every
  user on every app load — that is why it is cached. Consumes are job posts and
  invitations: single-digit to low-double-digit **per school per month**. A
  cache here would be solving a problem this path does not have.

**Admin-flip-to-visible latency: the next consume.** There is no TTL to state
and nothing to wait for. Flip it, and the very next call sees it.

### Rejected — (b) a short-TTL cache with invalidation on the admin write

Invalidation-on-write is correct **only while one process owns both the admin
screen and the consume path.** They are one process today. They will not always
be.

⚠️ **Under multiple instances it breaks in the worst available shape.** An
invalidation raised on instance A never reaches instance B, so after the flip
the feature is *off for some requests and on for others*, with no way to tell
from outside which request got which. During an incident that is worse than a
uniform hour of lag: not off, not on, and not diagnosable. Two operators
watching two requests would reasonably disagree about whether the switch worked.

A distributed cache or a message bus fixes it — and that is infrastructure
bought to speed up a query that was never hot.

🔴 **The point is not that caching is wrong.** It is that (b) requires taking on
the single-process assumption in exchange for saving a read this path does not
feel. Naming the assumption is what the brief asked for; not needing one is the
better answer.

### What happens under multiple instances

**Nothing.** Each instance reads the same rows from the same database, so there
is no second copy that can go incoherent. (a) is correct on one instance and on
twenty, with no invalidation, no bus and no shared cache — and that is precisely
why it was chosen over the faster option.

### Enforced structurally, not by a comment

The entitlement path gets its **own repository** (`IEntitlementRepository`) that
resolves the feature and its plan mapping in **one query**. It does not call
`IMasterService`, and it is never given a cache.

- **One query, not two.** The feature's mode and the mapping's quota come back
  together, so there is no window in which the mode is read fresh and the quota
  stale — a flip mid-resolution cannot produce a combination that never existed.
- **Its own path** means the day `IMasterService` is sensibly given a cache,
  gating is not on that path and nothing has to be remembered.
- 🔴 **Phase 2.5's isolation grep covers this**, alongside the 2.56 grep the
  phase already owes: **zero references to `IMasterService` from the entitlement
  path**, output shown.

This follows 2.36's precedent — the password hash is out of the API's reach by
compilation, not by a comment asking people not to. A rule that depends on
somebody reading a remark is a rule with a shelf life.

### 🔴 The verification this requires — Phase 2.5 inherits it

The admin mode-flip test does not stop at the database row.

> **Flip the mode through the admin screen, show the row before and after — then,
> with NO restart, NO sleep and NO cache clear, call the consume path and assert
> the NEW behaviour immediately.**

Three things that test must do, each because the obvious version of it does not:

1. **Assert on the consume path, not just the row.** A test that only checks the
   row changed **passes against every cached implementation, including the
   broken one.** The row was never in doubt.
2. **No wait, no restart, no clear, between the flip and the call.** Any of those
   also passes against the broken implementation — the pause is exactly what the
   bug needs in order to hide. If the test needs a wait to go green, it has
   found the bug rather than disproved it.
3. **Assert the specific `Code`, and assert both directions.** `FEATURE_DISABLED`
   — not merely "refused", which `PLAN_LACKS_FEATURE` and `QUOTA_EXHAUSTED` also
   satisfy. And flip it back on and assert the consume *succeeds* immediately:
   a refusal-only test passes if the feature was already denied for some
   unrelated reason, proving nothing about the flip.

⚠️ Point 3 is 3G's lesson repeated: that phase shipped a scoping assertion that
passed while being **vacuous**, because the fixture already satisfied it for a
different reason. An assertion that cannot fail for the right reason is worse
than no assertion, because it is counted.

---

## Decision 4 — Credit model

**Per-feature, non-fungible, no expiry in MVP.**

A credit is granted *for a named feature*. Five job-post credits are five job
posts and nothing else.

### The cost, stated where support will meet it

🔴 **A school holding 5 unused job-post credits that now wants teacher-search
can do nothing with them.** It will feel like stuck money, because it is stuck
money. Somebody will ring up about it.

**Why we accept that.** Fungible credits make pricing unpredictable in both
directions: the customer cannot tell what their balance is worth without a rate
card in their head, and we cannot tell what revenue a balance represents until
it is spent. A credit that buys "5 job posts or 2 searches or 10 invites" is a
currency, and issuing a currency means maintaining an exchange rate forever —
including deciding what happens to balances when a rate changes.

**The mitigation, which is a human one:** an administrator can reverse unused
credits and grant the equivalent for another feature. The ledger records both
the reversal and the grant, so the adjustment is auditable and the customer's
history remains true. That is a support action with a person's judgement in it,
which is the right place for an exception — not an automatic conversion nobody
can predict.

**Expiry: none in MVP.** Flagged as a **Phase 6.5 decision**, because expiry is
only meaningful once credits are bought rather than granted, and because expiring
paid credits has consumer-protection implications that want a real answer rather
than a default. The ledger already carries an `Expiry` entry type so adding it
later writes rows rather than reshaping the table.

### Balance

Credit balance for `(OwnerUid, FeatureId)` is **derived from the ledger**:

```
  SUM(Units) over live rows for that owner+feature
    Grant     +N
    Consume   −N   (only rows where SourceId = CREDIT)
    Reversal  +N
    Expiry    −N
```

No cached balance column in MVP. See "The ledger" for why, and for what to do if
one is ever needed.

---

## Decision 5 — Idempotency

**A filtered unique index on the consuming action's reference.**

```sql
CREATE UNIQUE NONCLUSTERED INDEX UQ_t_app_feature_ledger_Reference
    ON dbo.t_app_feature_ledger (FeatureId, RefEntityTypeId, RefEntityUid)
    WHERE Is_Deleted = 0 AND EntryTypeId = 2 AND ReversedOn IS NULL;
```

The caller passes what it is doing — `RefEntityTypeId = JOB`, `RefEntityUid =
<the job's Uid>` — and the index makes a second consume for the same action
impossible at the storage layer rather than by a check that can be raced.

### What "live rows" means in the filter

Three conditions, each load-bearing:

- **`Is_Deleted = 0`** — soft-deleted rows never constrain anything (2.4).
- **`EntryTypeId = 2` (Consume)** — grants and reversals carry no reference and
  must not collide with each other.
- **`ReversedOn IS NULL`** — 🔴 **a reversed consume frees its reference.** If we
  refunded a job posting, that job may legitimately be posted and charged again.
  Without this condition a refund would permanently prevent the customer from
  redoing the thing they were refunded for, which is the opposite of what a
  refund means.

### What the caller receives on the already-done path

The 2.48 pattern, exactly: **2601 means "already done", but only after re-reading
the row.**

```
INSERT → 2601 caught → re-read the existing live consume row
   found     → Status 1, Code = ALREADY_CONSUMED, the original EntryId,
               SourceId and Units. The caller treats this as success.
   not found → Status 0, Code = CONSUME_CONFLICT.
```

⚠️ **The not-found branch is real, not defensive padding.** It happens when a
reversal lands between the collision and the re-read: the index rejected the
insert, then the row it collided with was freed. Returning `CONSUME_CONFLICT`
rather than retrying in a loop keeps the procedure's behaviour bounded and hands
a retryable answer to the caller, which is where a retry policy belongs.

🔴 **`ALREADY_CONSUMED` is `Status = 1`, not a failure.** A retried job posting
that returns "you already paid for this" and is then treated as an error by the
caller is how a customer gets charged twice by a system trying not to charge them
twice.

---

## Decision 6 — Reset anchor

**Calendar month, on IST boundaries, via the 2.28 helpers.**

Periods run from the first IST day of a month to the first IST day of the next,
as a half-open UTC range — the shape `fn_IstDateToUtc` exists to produce:

```
period = [ fn_IstDateToUtc('YYYY-MM-01'), fn_IstDateToUtc('YYYY-(MM+1)-01') )
```

**Why the calendar and not the subscription's own anniversary:** a school with
three subscriptions over two years would otherwise have quota resetting on three
different days, and every support conversation would start by working out which
day this customer is on. A calendar month is the period every customer already
knows they are in.

### Worked example — a subscription starting mid-month

`SCHOOL_PRO`, quota 10 job posts per period, starting **20 August 2026, 14:00
IST** (stored `2026-08-20T08:30:00Z`).

| Period | IST span | UTC half-open range | Quota |
|---|---|---|---|
| **1** | 20 Aug → 31 Aug (12 days) | `[2026-07-31T18:30Z, 2026-08-31T18:30Z)` | **10** |
| **2** | 1 Sep → 30 Sep | `[2026-08-31T18:30Z, 2026-09-30T18:30Z)` | **10** |

Note the period-1 range starts at the **month** boundary, not the subscription's
start — the subscription simply cannot consume before `StartsOn`, so the extra
window is empty by construction and needs no special case.

🔴 **The first period gets the FULL quota, not a pro-rated one.** A customer who
joins on the 20th and receives 6 posts instead of 10 will ask why, and the honest
answer — "we divided by the days remaining" — is arithmetic nobody expects from a
monthly allowance. The cost is bounded: at most one extra part-month per
subscription lifetime. Pro-rating is flagged for 6.5 to revisit *when money is
attached*, and if it is ever adopted the rule must be visible on the purchase
screen before the customer pays.

### 🔴 The ledger rows a reset produces: **none**

This is a disagreement with the brief, which asked for "the exact ledger rows a
reset produces". The answer is that a reset should produce no rows at all, and
should not be an event.

**Quota used in a period is derived:**

```sql
SELECT COUNT(*)               -- or SUM(Units)
FROM t_app_feature_ledger
WHERE OwnerUid = @OwnerUid AND FeatureId = @FeatureId
  AND EntryTypeId = 2 AND SourceId = 1        -- consume, from quota
  AND Is_Deleted = 0 AND ReversedOn IS NULL
  AND OccurredOn >= @PeriodFromUtc AND OccurredOn < @PeriodToUtc;
```

A new period therefore *starts empty because it is new*, with nothing written and
nothing scheduled.

**Why this is better than a reset row:**

- **A scheduled reset can be missed.** A job that must run at every IST month
  boundary for every owner is a job that will one day not run — and the failure
  is silent: quotas simply do not reset and customers quietly lose allowance
  they paid for. Derivation cannot be missed, because there is nothing to run.
- **A reset row is a fabricated event.** Nothing happened at midnight; the
  calendar advanced. An append-only ledger should record things that occurred.
- **Backdating stays honest.** If a subscription's start is corrected, the
  derived history corrects with it. Written reset rows would have to be found and
  rewritten, which is precisely the kind of edit an append-only ledger exists to
  avoid.

⚠️ **The trade-off, honestly:** the period boundary must be computed identically
everywhere, so it lives in **one** inline function
(`fn_QuotaPeriodForUtc`) and no caller computes it by hand. That function is the
single point of failure this design accepts in exchange for having no scheduler.

**Credits are the opposite and do need rows** — a grant is a real event with a
cause (a purchase, a support decision), and nothing about the calendar implies
it.

---

## The tables

All new. Nothing in `m_mdm_plans` or `t_app_subscriptions` changes.

### jp_mdm

```
m_mdm_gating_modes        GatingModeId (1 Free, 2 Boolean, 3 Metered)
                          Code, Name, DisplayOrder, standard columns

m_mdm_features            FeatureId, FeatureCode (unique, filtered),
                          Name, Description,
                          GatingModeId  tinyint CHECK (1,2,3),
                          AppliesToUserTypeId,
                          DisplayOrder, standard columns
                          🔴 Is_Active = 0 is the kill switch (Decision 1)

m_mdm_plan_features       PlanFeatureId, PlanId FK, FeatureId FK,
                          IsIncluded tinyint,        -- BOOLEAN
                          QuotaPerPeriod int NULL,   -- METERED, NULL = unlimited
                          standard columns
                          UQ (PlanId, FeatureId) WHERE Is_Deleted = 0
```

### jp_app

```
m_app_ledger_entry_types  1 Grant, 2 Consume, 3 Reversal, 4 Expiry
m_app_ledger_sources      1 Quota, 2 Credit
m_app_ref_entity_types    1 Job, 2 Invite, 3 Application, 4 Manual/Admin

t_app_feature_ledger      EntryId bigint identity,
                          EntryUid uniqueidentifier,
                          OwnerUid uniqueidentifier,   -- org or user (2.51)
                          FeatureId int,               -- ⚠️ cross-DB, no FK (2.2)
                          EntryTypeId tinyint,
                          SourceId tinyint NULL,       -- consumes only
                          Units int,                   -- signed
                          RefEntityTypeId tinyint NULL,
                          RefEntityUid uniqueidentifier NULL,
                          ReversalOfEntryId bigint NULL,
                          ReversedOn datetime2 NULL,
                          OccurredOn datetime2 NOT NULL,  -- UTC (2.28)
                          Notes nvarchar(400) NULL,
                          standard columns

                          UQ_..._Reference  (Decision 5)
                          IX (OwnerUid, FeatureId, OccurredOn) INCLUDE (EntryTypeId, SourceId, Units)
                              WHERE Is_Deleted = 0     -- the period-count index
```

### Append-only, and how the balance stays honest

**Append-only in the 2.4 spirit:** grants, consumes, reversals and expiries are
all rows. A consume is never updated and never deleted; a mistake is corrected by
a **Reversal row pointing at it** (`ReversalOfEntryId`) and stamping `ReversedOn`
on the original.

⚠️ `ReversedOn` is the one field written after the fact, and it is written *only*
by the reversal path, in the same transaction as the reversal row. It exists
because the idempotency index needs a filterable column — a reversal cannot free
the reference if the freeing fact lives only in a second row.

**No cached balance column in MVP.** A cached balance is a second source of truth
that drifts, and this ledger is small — a school posting jobs writes single-digit
rows per month. If one is ever needed for speed, the requirement is that the
engine phase's verification **recomputes the balance from the ledger and asserts
it matches**, which is exactly what the phase brief demands and what makes the
cache safe to add later.

---

## The consume algorithm

One procedure, one transaction: **`USP_ConsumeFeature`**.

```
BEGIN TRANSACTION

  -- 🔴 SERIALISE PER OWNER. This is what makes the whole thing atomic.
  SELECT @PlanId = PlanId, ...
  FROM t_app_subscriptions WITH (UPDLOCK, HOLDLOCK)
  WHERE OwnerUid = @OwnerUid AND Is_Deleted = 0;

  -- precedence (Decision 1), then for METERED:
  --   used  = COUNT(quota consumes in this period)      [derived, Decision 6]
  --   creds = SUM(credit rows)                          [derived, Decision 4]
  --   source = QUOTA if used < quota, else CREDIT if creds > 0, else refuse

  INSERT INTO t_app_feature_ledger (...);   -- unique index = idempotency

COMMIT
```

**Why `UPDLOCK, HOLDLOCK` on the subscription row rather than a counter table:**
the lock makes the read-decide-write sequence a single critical section per
owner, so the "last unit" race has exactly one winner without introducing a
second place where the truth lives.

⚠️ **The cost:** consumes for one owner serialise across *all* features. For a
school posting a handful of jobs a day this is invisible. If a single owner ever
needs high-frequency consumes, the upgrade is a per-`(owner, feature, period)`
counter row updated with `UPDATE … SET Used = Used + 1 WHERE Used < @Quota` and a
rowcount check — atomic in one statement, at the price of a cached number that
must be reconciled against the ledger. **Rejected for MVP** because it adds the
drift risk this design has otherwise avoided entirely.

**Quota before credits** falls out of the ordering inside the critical section
and is deterministic under concurrency for the same reason the race has one
winner.

---

## Refusal codes (2.21)

| Code | Status | Meaning | Who is at fault |
|---|---|---|---|
| `FEATURE_DISABLED` | 0 | Kill switch is on for everyone | nobody — an operator decision |
| `SUBSCRIPTION_MISSING` | 0 | 🔴 No subscription row exists | **us** — provisioning is broken. Logged at Error |
| `SUBSCRIPTION_INACTIVE` | 0 | Expired, cancelled or deactivated | the customer's situation |
| `PLAN_LACKS_FEATURE` | 0 | Plan does not include it (or is unmapped) | the customer's plan |
| `QUOTA_EXHAUSTED` | 0 | Quota spent and no credits left | the customer's usage |
| `ALREADY_CONSUMED` | **1** | Same reference, already charged | nobody — a retry |
| `CONSUME_CONFLICT` | 0 | Collided, then the row vanished (reversal race) | retryable |

Each is distinct so a caller can tell them apart without reading message text
(2.12). The UI treatment differs sharply — `QUOTA_EXHAUSTED` is an upgrade
prompt, `PLAN_LACKS_FEATURE` is a different upgrade prompt, `FEATURE_DISABLED` is
"we have turned this off", and `SUBSCRIPTION_MISSING` is "contact us" — which is
the whole reason they are not one code.

---

## Seeding — nothing changes when this ships

Every feature seeds as **`FREE`, `Is_Active = 1`**, and no plan-feature mappings
are created.

After Phase 2.5 ships, **no user-visible behaviour changes anywhere**: every
feature is ungated, no endpoint calls `ConsumeAsync` yet, and the ledger stays
empty. The first real consume is written *with job posting* in Phase 4, and the
first non-free mode is set in 6.5 — **by changing data, not by deploying code
(2.7)**.

---

## Prerequisite found while writing this

🔴 **`jp_app` has no IST helper functions.** Verified:

```
jp_sso: fn_IstDateToUtc, fn_IstDayRangeUtc, fn_IstToday
jp_mdm: fn_IstDateToUtc, fn_IstDayRangeUtc, fn_IstToday
jp_app: (none)
```

The ledger lives in jp_app and its period boundaries are IST (Decision 6), and no
procedure may call a function in another database (2.2). **Phase 2.5 must add the
2.28 helper set to `jp_app` as its first script**, copied verbatim from
`jp_mdm/04_procedures/000_fn_datetime_ist.sql`.

This is a prerequisite, not a conflict — the pattern is already "each database
carries its own copy", and jp_app simply has not needed them until now.

---

## Disagreements recorded

Where this document differs from the direction it was given, both positions are
here rather than one being quietly chosen.

### 1. Three modes, not four

**Directed:** make the case for four modes (Free / Boolean / Metered / Disabled)
or argue a clean three.
**Written:** three, with `Is_Active` as the kill switch — because a mode-based
kill switch destroys the mode it replaces and the restore then depends on
somebody's memory. Full argument in Decision 1.
**If four is preferred anyway:** the change is small — a fourth `GatingModeId`
and a fourth CHECK value — but the restore problem must then be solved another
way, most likely by a `PreviousGatingModeId` column, which is a memory field in
the schema and worse than the toggle it replaced.

### 2. A quota reset writes no ledger rows

**Directed:** "show the exact ledger rows a reset produces".
**Written:** none — quota use is derived by counting consumes inside the current
period, so a reset is not an event. A scheduled reset is a job that can be
missed, and its failure is silent. Full argument in Decision 6.
**If reset rows are preferred anyway:** they need a scheduler with per-owner
coverage, monitoring for missed runs, and a rule for what happens to a period
whose reset row never arrived. That machinery is the reason for the
recommendation.

### 3. Credits — agreed, with the mitigation named

The per-feature, non-fungible, no-expiry direction is accepted as written. The
only addition is that the "stuck money" case has an explicit human remedy
(reverse and re-grant, both recorded), because a trade-off with no escape hatch
becomes a policy nobody can apply.

---

## What Phase 6.5 adds

Nothing here reshapes to accommodate it — that is the test this design was
written against.

| 6.5 brings | How it lands |
|---|---|
| Payment gateway | A successful payment writes **Grant** rows, with the payment reference in `Notes` / a `RefEntityTypeId = PAYMENT` |
| Purchase / upgrade screens | New rows in `t_app_subscriptions` (the one-active-per-owner index already governs this) |
| Invoices | A new table keyed to payments; the ledger is untouched |
| Refunds | **Reversal** rows — the entry type already exists |
| Credit expiry | **Expiry** rows — the entry type already exists, plus the retention decision deferred in Decision 4 |
| Real pricing | Data in `m_mdm_plans.Price` and mappings in `m_mdm_plan_features` — no deployment (2.7) |
| Turning gating on | Change `GatingModeId` per feature — data, not code |
| Proration | 🔴 An open decision, tied to the first-period rule in Decision 6 |

---

## Still open — for the client

- **Written acknowledgment that monetization is in the MVP.** It was added
  verbally; §4 Q4 of PROJECT_MEMORY tracks it. The engine is designed and its
  build waits on this.
- **The actual plans and prices.** This document defines the mechanism and takes
  no position on what anything costs.
- **Whether purchased credits expire** (Decision 4), which is a consumer-facing
  policy question rather than a technical one.
