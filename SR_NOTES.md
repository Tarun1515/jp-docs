# SCHOOL REVAMP — running notes

> Started **2026-10-25**. Client demo feedback of 2026-10-20 drives this run.
> Phase 8B and Phase 9 are parked behind it.
>
> This file is written AS the work happens. PROJECT_MEMORY gets one
> consolidated update at the end, from here. If the run dies, this is the
> recovery record — so it records what was measured, not what was intended.

---

## SR-PRE — state the run started from

All seven repos clean and pushed. Nothing listening on 5199, 5299, 4200,
4300, 4400, 4500, 4999. Three databases present on `localhost\TARUN`.

| Repo | HEAD |
|---|---|
| jp-backend | `a957f8e` |
| jp-docs | `52a8cc0` |
| jp-admin | `3050503` |
| jp-shared | `29eb424` |
| jp-public | `a73b2d1` |
| jp-school | `040ba27` |
| jp-teacher | `8327f18` |

### 🔴 FOUND BEFORE ANY WORK: the demo fixture was still live, and `run_all` was broken

The client demo on 2026-10-20 used `scripts/demo/demo-setup.sql`. It was never
torn down. Measured:

```
m_mdm_plans
  80  DEMO_SCHOOL_GROWTH   999.00  IsPublic 1  IsDefault 0  Is_Deleted 0
  81  DEMO_TEACHER_GROWTH  999.00  IsPublic 1  IsDefault 0  Is_Deleted 0

011_seed_plan_change_request.sql guard
  Price > 0 AND IsPublic = 1 AND IsDefault = 0 AND Is_Deleted = 0
  -> YES — run_all would FAIL
```

So a full database build would have died on the priced-public-plan guard, and
the catalogue the product resolved against was the demo's, not the shipped one.
The guard behaved exactly as 011's header says it should: *"a fixture left
behind by a killed run shows up here as a loud build failure, which is the
correct outcome."*

`demo-teardown.sql` restored it, with its own six exit assertions:

```
demo plans removed      : 2 (found 2)
plan-feature mappings   : 9 removed, 0 left (expected 0)
activation rows removed : 1
subscriptions restored  : 1 back to free/active/no-end
payments / receipts     : 1 / 1
plan-change requests    : 1

shipped state:
  DEMO_ plans left         : 0      features not FREE/active : 0
  priced PUBLIC plans      : 0      orphaned subscriptions   : 0
  orphaned payments        : 0      subscriptions off-shipped: 0
```

⚠️ **Lesson for the demo script, carried into SR-5:** a fixture that must be
torn down by hand will eventually not be. The teardown is correct; the process
around it is not. SR-5's `stop-all` is the natural place to say so.

### Shipped catalogue — the baseline SR-4 starts from

```
m_mdm_plans        2 rows   SCHOOL_FREE (default, free, public)
                            TEACHER_FREE (default, free, public)
m_mdm_features     6 rows   JOB_POST · JOB_FEATURED · TEACHER_SEARCH
                            TEACHER_INVITE · APPLICATION_VIEW
                            TEACHER_PROFILE_BOOST
                            — every one GatingModeId 1 (FREE)
m_mdm_plan_features 0 rows  no mapping exists at all
```

This matches 2.64 exactly: the engine shipped switched off, every feature FREE,
no mapping, empty ledger, nothing gated. SR-4 is therefore a real catalogue and
engine change, not a tweak.

### 🔴 `QuotaPerPeriod` NULL already MEANS unlimited — in the schema

036_entitlement_catalog.sql, on the column itself:

> NULL = unlimited within the plan. 0 = explicitly none.
> ⚠️ These are NOT the same and the procedure must not conflate them: NULL
> skips the quota comparison entirely, 0 fails it immediately and falls
> through to credits.

So SR-4's "UNLIMITED = Metered with NULL quota" is the design the schema was
built for. Whether the **procedure** honours it is a separate question and is
measured in SR-4 before anything is called an engine change — the file on disk
is not the database.

---

## SR-0 — decisions on paper ✅

Two documents, both written before any code.

**`FIELD_MATRIX.md`** — every registration and profile field, where it is
asked, whether it is compulsory, why, and a decision column. Written for the
client to sign, in plain language. The verbal decisions are pre-filled: the
principal's details move to the profile, logo/photo becomes compulsory at
registration, website is flagged rather than assumed.

Three things it asks the client to settle, each with a tick-box:

1. **Website compulsory?** Flagged with the contradiction: the sales pitch is
   village and small-town schools, and most have no website. Compulsory means
   either they cannot register or the field fills with `na` and `-`, which is
   worse than optional because the data can no longer be trusted. Our
   suggestion — *optional but prominent* — is on the page as an option.
2. **Logo compulsory?** Suggested as *logo or any photo of the school*, since
   "a photo of your school" is answerable from a phone at night and "your logo
   as a PNG" is not.
3. **Free plan: 1 job post per month, or 1 ever?** Stated as what it is — a
   trial that never ends versus a trial that converts — because we cannot
   guess which business they meant.

**`ADDRESS_DESIGN.md`** — the address addendum. Tehsil becomes a master;
area/village is free text; coordinates and Google's place id ride along. The
migration section is short for a good reason recorded there: `m_mdm_city` has
always been empty, so **no existing row can point at a city**, and there is no
legacy geography to migrate. That is the one piece of luck in G40 staying open.

### 🔴 Two orphaned fields found by going field by field

| Field | What is wrong |
|---|---|
| `PrincipalMobile` | Collected at registration, stored in `t_mdm_school_registration_details`, and **`USP_ProvisionSchool` does not have the parameter**. On approval the number is left behind: a school approved last month has a principal nobody can ring. `PrincipalName` was carried across; the mobile was not. |
| `LogoPath` | Exists in the draft DTO **and** on `t_app_schools`, and the registration form has never asked for one. A column with no producer — so every school page shows a blank where a logo should be. |

Neither was reported by anything, because nothing looked. The client's two
instructions — move the principal to the profile, make the logo compulsory —
happen to fix both, which is why the matrix says so plainly rather than
presenting them as new work.

---

## SR-1 — geography + schema ✅

### Source, read 2026-10-25

| Data | Source |
|---|---|
| Districts | Wikipedia, *List of districts of Haryana* |
| Tehsils | Wikipedia, *List of tehsils of Haryana* |
| Rohtak's tehsils | Wikipedia, *Rohtak district* — the tehsil list page omits them |

🔴 **Haryana has 23 districts, not 22.** Hansi became the 23rd on 16 Dec 2025,
carved out of Hisar. Every secondary source still says 22, and seeding 22 would
have left a whole district unreachable.

⚠️ **Three places the source is mid-transition, and what was done:**

1. The tehsil page still lists *Hansi* as a tehsil of Hisar **and** lists Hansi
   district with *Hansi 1* and *Hansi 2*. Seeded per the district page: Hansi
   is its own district and the stale row under Hisar is not seeded — so Hisar
   has 5 tehsils here, not 6.
2. *Lakhan Majra* is a Rohtak sub-tehsil on one page and a block under Meham on
   another. Seeded as a Rohtak sub-tehsil, which is the revenue view.
3. Sub-tehsils are seeded as tehsil rows flagged `IsSubTehsil = 1`. A person
   typing an address knows their place's name, not its revenue class, and
   leaving them out means a school in Uklana cannot find Uklana.

### Seeded

```
23 districts · 94 tehsils + 49 sub-tehsils = 143 · 143 towns
```

🔴 **Villages are deliberately NOT seeded**, and it is G40's own argument, not
a shortcut: ~6,800 villages are not enumerable from a citable source today, and
half a list is worse than none. They are `AreaOrVillage` free text next to the
tehsil, plus the coordinates Places returns — which is why ADDRESS_DESIGN put
that column in before this seed existed.

Towns are **one per tehsil — its headquarters**, a rule rather than a judgement
call: a tehsil is named after the town it is administered from, so every tehsil
name is a town that exists. Nothing invented.

### Schema

- `m_mdm_tehsil` — new master, `Code` the contract (2.47).
- `m_mdm_city.TehsilId` — nullable; **`DistrictId` stays**, because tehsil is
  optional and every existing read joins city to district. The price is a build
  guard: a city's tehsil must be in that city's district, or the same city
  appears under one district in search and another on the school's page.
- Address columns on `t_app_schools`, `t_app_school_branches`,
  `t_mdm_school_registration_details`, `t_app_teacher_preferred_locations`.
- **`t_app_schools.PrincipalMobile`** — the destination the SR-0 finding needs.

### 🔴 Three things measured rather than assumed

1. **`TehsilId` is NOT an identity column.** Its neighbours
   (`m_mdm_state`, `m_mdm_district`, `m_mdm_city`) all assign ids explicitly in
   seeds, and the reason bites across databases: jp_app stores geography ids
   **with no foreign key** (2.2). A generated id could differ between a fresh
   build and a live jp_app, and every stored address would silently move. The
   first version of 039 used `IDENTITY(1,1)`; it was dropped and rewritten
   before any data existed.
2. **Ids are namespaced per state** — Haryana is StateId 8, so districts are
   801–823 and tehsils/towns 80001–80143. Without a namespace the ids depend on
   the order states were seeded in, and two machines that seeded in different
   orders disagree about which district id 24 is. The seed refuses to run if HR
   is not StateId 8 on this machine.
3. **`m_mdm_city.Code` was `varchar(30)` and had to be 60.** City codes are
   district-qualified because Haryana genuinely has two Barwalas — Hisar's and
   Panchkula's. The longest code is 31 characters, and the seed failed with
   "String or binary data would be truncated". That failure is the good
   outcome: a silently truncated code is a permanent wrong identifier (2.47).

### `t_app_schools` coordinate guard — proven, after a correction

`decimal(9,6)` everywhere, asserted across every user table. Forcing it took
two attempts: `ALTER COLUMN` on the branch table was refused (an index depends
on it), so a scratch table with `decimal(8,5)` was used instead. It fired,
naming `zz_coord_probe.Latitude is decimal(8,5)`.

⚠️ On the first run I read the output through `head -3` and reported the guard
as not firing. The guard was right; the filter cut the error line off.

### Cascade, every step through the real procedure

```
DISTRICT of state 8        -> 23          recognised=1
TEHSIL of Hisar            ->  8          5 tehsils + 3 sub-tehsils
CITY with TEHSIL parent    ->  1          Barwala itself
CITY with DISTRICT parent  ->  8          every town in Hisar
unknown key 'TEHSILS'      ->  recognised=0, no crash
cities with no live district -> 0
```

🔴 **`CITY` takes either a tehsil or a district as its parent**, resolved by
looking the id up rather than by a second flag the caller must set right.
Tehsil is an optional step, so a school that knows only its district must still
reach a town.

Idempotent: a second run inserted 0 rows and the counts were identical. The
seed's own exit assertions check 23/143/143, so the file's header cannot drift
from its data without the build failing.

---

## SR-2 — Google Places behind a seam ✅ (backend)

### Shape

```
IAddressLookupService
  ├── GooglePlacesAddressLookupService   real autocomplete + details
  └── DisabledAddressLookupService       the SHIPPED DEFAULT
```

The second is not a test stub. `AddressLookup:Provider` defaults to `None`, so
a deployment that has not deliberately configured Places gets the manual
cascade — and the first real deployment will not have a key, so it must work.

🔒 **The key is never in the repo.** It is read from `GOOGLE_PLACES_API_KEY`
per call (not captured at startup, so rotating it needs no restart and a
process started without one degrades instead of crashing). `appsettings.json`
carries `Provider`, `CountryBias` and `TimeoutSeconds` — and nothing else, so
security-pass section 9's appsettings audit stays green.

### Measured with the switch OFF — the shipped state

```
GET /api/address/availability  ->  {"available": false}
GET /api/address/suggest?q=…   ->  200, data: []
GET /api/address/resolve?…     ->  200, data: null,
                                   "That place could not be resolved. Please use the dropdowns."
```

No 404, no 500, no exception. Somebody is mid-registration; a search box that
is off must not read as a broken site.

### Three design points worth keeping

1. **`ResolvedAddress` is the seam.** Google's vocabulary stops in one class —
   nothing above it knows what `administrative_area_level_2` means. A row
   entered by autocomplete and one entered by hand are indistinguishable once
   stored, apart from the place id and coordinates.
2. **Matching narrows: state → district within it → tehsil within that →
   city.** Matching levels independently would resolve a place to the *other*
   Barwala. Haryana has two, so this is not hypothetical.
3. **No master row is ever created from a Google response** (2.47). What does
   not match becomes `AreaOrVillage` text **and is reported** in `unmatched`,
   so the form can say "we could not find that district, please pick it below"
   rather than quietly dropping a level.

⚠️ **Matching is exact-ish, not fuzzy.** "Gurgaon" and "Gurugram" will NOT
match, deliberately: a fuzzy match that is wrong puts a school in the wrong
district silently, while the honest failure puts the name where somebody is
asked to pick. Aliases, if wanted, belong in the master as rows.

⚠️ **Google returns HTTP 200 with an error status in the body.**
`REQUEST_DENIED` (bad key) and `OVER_QUERY_LIMIT` both arrive as 200, so
checking the HTTP code alone reports a quota failure as "no results" — and the
symptom is "autocomplete stopped working" with nothing in the log. The status
field is checked and logged.

### Rate limit

Address lookup joins the chained global limiter at **30/min per IP**, its own
window. It is the only endpoint here that **costs money per call**, which is a
different risk from scraping. One budget across suggest and resolve, because
what needs limiting is how many provider calls one address can cause.

⚠️ A named-policy attribute was removed: this API has no named policies, and
`[EnableRateLimiting("AddressLookup")]` naming one that does not exist fails at
startup.

### 🔴 The anonymous-surface guard was measuring something else

`swagger.mjs` asserted *"the anonymous surface is EXACTLY six operations — a
7th is a new front door"*. SR-2 added **three anonymous operations** at
`/api/address/*` and the suite stayed **green**, because the assertion counts
paths under `/api/public`.

And it was already wrong before SR-2. Measured while fixing it:

| Controller | Why it is open |
|---|---|
| `PublicController` | **no `[Authorize]` at all** — open by default |
| `HealthController` | a probe cannot carry a token |
| `AuthController` | you cannot authenticate to authenticate |
| `SchoolController` | one action: `GET {uid}/public` |
| `AddressController` | SR-2 — registration is anonymous |

The suite even has an assertion naming `/api/schools/{uid}/public` as "not in
that set" — true of the `/api/public` set, and read for two phases as "not
anonymous", which it never was.

🔴 **Swagger cannot answer this question.** Measured: all 143 operations report
security `inherit` against one global Bearer requirement, because the generator
emits no per-operation override for `[AllowAnonymous]`. The path prefix was a
proxy for a fact the document does not carry.

So the guard now reads the **source**: every `[AllowAnonymous]`, plus every
controller with **no `[Authorize]`** — the second branch being the one a grep
for `[AllowAnonymous]` alone would miss entirely, and the one `PublicController`
needs.

⚠️ **It caught itself on its first run.** `PublicController`'s header comment
says *"THE FIRST CONTROLLER IN THIS API WITHOUT `<c>[Authorize]</c>`"*, the
text search matched that prose, and the suite reported that PublicController
had stopped being anonymous. Comment lines are stripped before testing now —
*a text guard cannot tell code from prose about code*, the same lesson 6.5A
learned.

Proven both ways: a probe controller with no `[Authorize]` fails it by name
(`NEW FRONT DOOR: ZzProbeController.cs`), and removing the probe returns it to
green.

### Counts moved in this change

```
swagger floor (App API)  139 -> 143   measured: "143 found, floor 139"
swagger suite             43 ->  45   two new assertions
```

---

## SR-3 — registration + profile rebuild (in progress)

### Done

**The chain carries what registration collects.** `PrincipalMobile` and SR-1's
five address columns now thread form → draft → submit → registration record →
provisioning → `t_app_schools`. New suite `sr-registration.mjs` (11/11) walks
the whole thing rather than each step.

🔴 **The suite was proven to catch the original bug.** With the SR-3 fix
reverted in a scratch copy of the procedure, it fails with
`PrincipalMobile = -, expected 9812345678`. Restored, it is 11/11 again. A
guard never seen to fail is a guess.

⚠️ **And it asserts the negative:** a school registered with no tehsil, no
area, no coordinates and no principal mobile still provisions, and those five
columns come back NULL rather than back-filled with a guess. "The matrix moves
fields, never orphans data" is a promise that has to be checked.

**The form.**

| Change | Why |
|---|---|
| Group choice in plain words | It read "How many campuses? / Just the one / Several campuses". A trust running four schools does not think "I have several campuses"; it thinks "we are a group". Each option now says what it means for them. |
| Principal + HR fields removed | Four optional fields on a step a stranger fills in before approval. Not used to decide approvals, so they belong in the profile. A line on the step says where they went. |
| Tehsil in the cascade | Optional, hidden when the state has none — the same correct degradation district and city have had since 2.47. |
| **Village or area** free-text box | The point of the whole address design: Haryana's ~6,800 villages are not a dropdown and never will be, so the school types the name and it is stored as a *place* rather than squeezed into an address line. |
| Logo step | See below. |

🔴 **The towns of the whole district load as soon as a district is picked**,
not after a tehsil — because the tehsil step is optional. Waiting for it would
mean a school that skips tehsil never sees a town, which is the shape of
"optional" that is really "required and badly labelled".

### The logo — a column that had no producer

`t_app_schools.LogoPath` has existed since Phase 3 and **nothing ever wrote
it**: the only logo endpoint resolves a SchoolId from the caller, and during
registration there is no school yet. So every school page showed a blank where
a logo should be, and no suite noticed because nothing was missing — a NULL
column is not an error.

`POST /api/approvals/draft/logo` stores the file through the **same validator
as every other upload** (2.48: extension, magic bytes, size, generated storage
name) and returns the path; the client sends it back on the next draft save, so
the draft stays the single source of truth (2.50).

⚠️ **It is its own step.** It is the only thing on the form that needs the user
to go and find a file, which is the most likely place to stall. On its own step
it is one ask with its own explanation — and the contact step got shorter in
the same change, so the form is six steps and no longer than it was.

⚠️ **The preview is the file in the browser's hand, not a fetch.** Uploads live
under `App_Data`, which is not served statically and must never be — teacher
resumes share that root. Previewing from the server would mean a new
authenticated media route for a picture the browser already has. After a reload
the preview is gone, and the template says "your image is saved" rather than
showing a broken one.

🔴 **Required, per the client's instruction — with the caution recorded.**
FIELD_MATRIX §A1 asks them to confirm: a school registering from a phone at
night that cannot find its logo file will stop here, so the ask is "a logo **or
any photo** of the school". If they tick "optional", one block of validation
changes.

### `ui-combobox` — one searchable select (G27)

In `jp-shared/ui`, taking the same `UiSelectOption[]` as `<ui-select>` so
replacing a plain select is a tag change. SR-1 seeded 143 Haryana towns; a
native `<select>` with 143 options is a list you can only use if you already
know where N falls.

Three details chosen deliberately: the active row starts on the **current
value** (so reopening and pressing Enter cannot silently change it), blur does
**not** clear the value (the query is scratch state), and Enter is only
swallowed when the list is open with an active row (so a one-field form can
still be submitted from the keyboard).

### Still open in SR-3

- Adopting `ui-combobox` at the call sites (the component and its export are
  done; the replacements are not).
- The profile's own principal/HR fields — the column exists and the chain
  carries it; the profile form does not ask yet.
- The multi-school dashboard CTA.
- Teacher browse intelligent defaults.

---

## SR-4 — billing UX + real plan catalogue (BUILT AND PROVEN, NOT ACTIVATED)

### 🔴 First, a correction to the brief's premise

SR-4 describes *"UNLIMITED = Metered mapping with NULL QuotaPerPeriod = no
limit — **an explicit engine change** with its own tests"*.

**It is not an engine change. The engine already does this.**

`036_entitlement_catalog.sql` has said since 2.5, on the column itself:

> NULL = unlimited within the plan. 0 = explicitly none. ⚠️ These are NOT the
> same and the procedure must not conflate them.

and `013_entitlement.sql` (~line 695) implements exactly that — `IF
@QuotaPerPeriod IS NULL` sets the source and skips the comparison entirely.
What SR-4 needed was the **catalogue** and the **tests**, not engine work.

### Measured, not read

```
the catalogue says:  JOB_POST METERED (3) · UNLIMITED quota NULL · included 1

consuming JOB_POST eleven times on UNLIMITED:
  allowed      : 11   (must be 11)
  refusals     :  0   (must be 0)
  ledger rows  : 11   (unlimited still RECORDS every consume)

🔴 CONTROL — a FREE plan (quota 1):
  first  -> 1 (allowed)
  second -> 0 QUOTA_EXHAUSTED
```

The control is what makes the first block mean anything: if FREE also allowed
the second, the test would prove nothing about NULL.

⚠️ Four of my own setup errors were caught by running it, each by a precise
refusal: wrong subscription status (`2` is EXPIRED, `1` is ACTIVE), a missing
reference (`A metered consume must carry a reference to what it is for`), the
wrong result-set shape, and `NEWID()` as an `EXEC` parameter value. The
procedure's messages were right every time; my probe was wrong.

### What is in the repo

- `013_seed_school_plans.sql` — the three plans, the gating flips, the eight
  mappings, with prices marked **PROVISIONAL** and the free-plan period
  question pointed at FIELD_MATRIX §E.
- 🔒 A build guard in it asserting **APPLICATION_VIEW stays FREE** — the hard
  rule that a school's own data is never paywalled. Reading the applicants to
  a job you already posted is not a consuming action, and a lapsed plan must
  not take them away.

### 🔴 WHY IT IS NOT ACTIVATED, AND WHAT THAT COSTS

`013_seed_school_plans.sql` is **not wired into `run_all.sql`**, and the
database is back at 2.64's shipped state — engine off, every feature FREE, no
mappings, two plans. Three reasons, in order of weight:

1. **The blast radius is product-wide and the suites encode the old world.**
   Activating it immediately broke `billing` (47) and `jobs-consume` (27), and
   not superficially:

   | What broke | Why |
   |---|---|
   | `restoreShipped()` in **both** suites | They "restore shipped state" with `DELETE FROM m_mdm_plan_features` + every feature back to FREE. Under 2.64 that WAS the shipped state. With a real catalogue it is **a DELETE of the product's pricing, running twice per regression** — measured: one run left the catalogue at 0 mappings. |
   | `billing`'s fixture | Inserts `(SCHOOL_FREE, JOB_POST)`, which the catalogue now seeds — unique-index collision, suite dead at its fixture. |
   | `jobs-consume` scenario (a) | Tests FREE-mode behaviour and *assumed* the shipped default was FREE. |
   | Entry/exit assertions in both | Assert "every feature FREE with no plan mappings (2.64)" as the premise. |

   Every one of those is a legitimate, finishable change — and each needs its
   reason written, per the standing instruction. That is the remaining work,
   not a blocker.

2. **The prices are not confirmed.** FIELD_MATRIX §E asks the client to tick
   or correct them, and asks the one question we genuinely cannot answer: the
   free plan's single job post — **per month, or ever?** Seeding a live
   catalogue on numbers from a phone call, while the document asking them to
   confirm those numbers is unsigned, is the exact failure 008 was written to
   prevent.

3. **A broken regression is worse than an unbuilt feature**, and a demo
   environment that does not work is worse than both.

**To activate** (one command, once the above is done and prices are
confirmed):

```
sqlcmd -S localhost\TARUN -E -I -b -f 65001 \
  -i database\jp_mdm\03_seed\013_seed_school_plans.sql
```

…plus adding it to `run_all.sql` after `011`, and flipping 011's guard from
"no priced public plan" to "exactly these four" — that flip is written and was
tested, then reverted with the rest.

### ⚠️ The lesson this part produced

**A suite that asserts a shipped DEFAULT is a suite that breaks when the
default becomes a decision.** Three suites encode "the engine is off" as a
premise, which was correct and documented for four phases, and is now the
single biggest obstacle to turning the engine on. The fix is not to weaken
them — it is to make each suite ARRANGE the state it is testing, which is what
`jobs-consume` scenario (a) now does.

### Verified after reverting

```
billing 47/47 · jobs-consume 27/27 · entitlement-engine 34/34 · sr-registration 11/11
```

---

## SR-5 — startup experience ✅

`scripts/start-all.mjs` and `scripts/stop-all.mjs`.

**Order is the feature.** jp-shared first, then the four hosts — not a
preference: the hosts load `jp-shared/ui` as an **import map** entry resolved
in the browser at runtime, not bundled. If :4999 is not answering when a host
page loads, that host is broken until reloaded and will not recover on its
own. That is the "four blank tabs in front of a client" failure.

**It kills whatever holds a port first.** A stale `ng serve` from a previous
session answers, so everything looks fine while it serves code from before
your last change. *"It answers" is not "it is yours."*

**stop-all kills by PORT, not by image name.** `taskkill /IM node.exe` would
take the editor's language servers with it — a bad trade somebody only notices
afterwards. Seven ports, each named before it is killed, and the result is
**verified**: `taskkill` returns before the socket is released, so "I stopped
it" followed by a port still answering is how the next `start-all` silently
reuses a stale server.

### 🔴 The spawn bug, which produced seven empty logs

The first version used `detached: true` + `shell: true` + piped stdio, then
`unref()`. Result: **seven 0-byte log files and seven 180-second timeouts**,
while `npx ng serve` run by hand in the same directory worked perfectly.

On Windows, detaching a shell-spawned child into its own process group and
unref-ing it severs the pipes before anything is written — so the output
vanished and every service looked like it had failed to start.

Fixed by giving the child a **file descriptor** instead of a pipe: it inherits
the handle and writes to the file directly, with no parent-side plumbing to
sever. `detached` was dropped entirely — node does not kill its children when
it exits, so the services outlive the script regardless, and detaching bought
nothing but the bug.

⚠️ The timeouts are split by kind: 60s for an API, 180s for a dev server. One
timeout for both would either give up on Angular's first compile or make a
failed API take a minute to report.

⚠️ `ready` is a PATH, not just the port. A port opens before Angular has
finished compiling, so waiting on the socket reports ready while the page is
still a 404.

### And one process lesson, recorded in stop-all's header

The demo fixture from the **20 October** client demo was still live on **25
October** — five days — so `run_all.sql` would have failed on the
priced-public-plan guard, and the catalogue the product resolved against was
the demo's. The teardown script is correct; the process around it is not. *A
fixture that must be torn down by hand eventually is not.*

---

## Final verification — what passed, and the four that did not

```
node scripts/stop-all.mjs   -> every port free
node scripts/start-all.mjs  -> all seven up (1s, 1s, 8s, 23s, then ~30-60s each)
node scripts/verify/run.mjs -> 45/49 suites clean in 870s
```

### The four, and none of them is the SR work

| Suite | Why |
|---|---|
| `build-manifest` 10/11 | **My own guard, working.** `013_seed_school_plans.sql` is on disk and deliberately not in `run_all`. Added to its EXCLUDED map **by name with the reason** — which is what that map exists for. Now **12/12**. |
| `offers` 56/57 | A second-tenant fixture hits **G23**: `400 · Your account is linked to more than one school`. |
| `team-contract` 47/50 | Same cause, three assertions, same message. |
| `screens-3h` | `Rohit 100`, suite expects `90`. |

### 🔴 Two of them are LEFTOVER DEMO-DAY STATE, and the timestamps prove it

```
t_app_schools      id 91  "Sunrise International Academy"  created 2026-10-20 14:50 UTC
t_app_school_users id 251  same instant, owner head@stmarys.edu.in
```

**20:20 IST on 20 October** — a school registered live during the client demo,
against an account that already owned St Mary's. That gives the St Mary's
owner **two school memberships**, and G23's documented refusal fires: *"one
user, one school — the API cannot say otherwise yet."* `offers` and
`team-contract` both use that owner as their second tenant, so both now get a
`400` where they assert a cross-tenant `404`.

⚠️ **And it is why 8A was 48/48 while this run is not.** 8A's regression ran at
~19:10 IST on 20 October — **an hour before** that registration. The failures
are not a regression in anything; they are the demo changing the fixtures the
suites are built on.

🔴 **Not deleted.** That is the client demo's own data, and removing a school
somebody registered in front of a client is their call, not mine. One line
removes the membership if they want the fixtures back:

```sql
UPDATE jp_app.dbo.t_app_school_users SET Is_Deleted = 1 WHERE SchoolUserId = 251;
```

### `screens-3h` — fixture drift from a suite, not from the demo

Rohit Kulkarni's profile completion is **100%**, and the suite asserts the
seeded **90**. His row was modified `2026-10-25 03:03 UTC` — during this
session, not on demo day — and he now carries
`teacher-photos/2026/10/…`. A suite that uploads a teacher photo is not
restoring it.

🔴 **Also not fixed by hand.** Deleting a teacher's photo to make an assertion
pass is faking the fixture; the suite that uploads it should restore it, and
finding which one is a contained piece of work rather than a guess.

### What this says about the suite ecosystem

Three of the four failures are **fixture drift** — two from a live demo, one
from a suite that does not clean up after itself. None is a defect in the
product, and none would have been visible from reading code.

⚠️ It is the same shape as the very first thing this run found: the demo plan
fixture still live after five days. *State that must be restored by hand
eventually is not.*

---

## SR-4 ACTIVATED — 2026-10-25, on the client's instruction

> *"price abhi kuch bhi daal do dummy, isme koi issue nahi hai"* — so the
> catalogue is live with placeholder prices, and the mechanism is what matters.

### 🔴 The placeholder is in the plan NAME, not only in a comment

```
Standard (SAMPLE PRICING)     ₹1,499 / month
Unlimited (SAMPLE PRICING)    ₹3,999 / month
```

A comment in a seed file is read by developers; **a plan name is read by
customers**. 008 forbade seeding paid tiers precisely because "a number we
ship gets quoted back at us", and the name is what stops that while the
figures are placeholders. A build guard fails if the marker disappears while
the prices are still dummy — the one way this goes wrong is somebody tidying
it out because it looks untidy on screen.

### Menu → pricing → back (client request, 2026-10-25)

> *"kuch menu ke click pr pricing aani chahiye / jaise hi user pay kre to wo hi
> page khul jaana chahiye jaha se pricing pr gya tha"*

`UpgradeService` is the single route to the plans, so "where they came from" is
decided in one place. It reuses `ReturnUrlService`, which already runs every
candidate through `safeInternalPath` — the guard funnel-e2e forces with a
hostile returnUrl, and a second implementation would be a second place for an
open redirect.

The billing page offers the way back **twice**: before choosing (read the
plans, decide later) and in the confirmation after. ⚠️ **Offered, never
automatic** — navigating the instant the request lands would snatch the
request number off the screen, and that number is what they quote when they
ring about a payment nobody has confirmed yet.

The jobs page gains a quota-wall banner that **leads with "your job is safe as
a draft"**. The upsell is second: leading with it answers a question nobody
asked. It is a banner, not a redirect, and only for `QUOTA_EXHAUSTED` — a
validation failure or a lapsed subscription are different problems, and
offering an upgrade for either is selling to somebody whose issue it does not
fix.

### 🔴 THE BLAST RADIUS — what turning the engine on actually cost

Nothing here was visible from reading code. Each number was measured.

| What | Scale |
|---|---|
| Suites that **deleted the catalogue** as their "restore shipped state" | **9** |
| Suites asserting the switched-off engine as a premise | **6**, in two phrasings |
| Suites that publish jobs and so now **consume** | **8** |
| Suites that passed ALONE and failed only in the full run | **5** |

🔴 **"Restore the shipped state" meant "delete everything".** Under 2.64 the
engine shipped off — every feature FREE, not one mapping — so the two were the
same statement. With a real catalogue it is a **delete of the product's
pricing, running on entry and exit**. Measured: one run left the catalogue at
0 mappings with JOB_POST back to FREE.

🔴 **The second phrasing only appeared in the full run.** Six suites assert
`consumed === false` in an HTTP response rather than counting rows in SQL, so
grepping for the SQL phrasing missed them. They pass alone because the shared
fixture school has a quota of **1** — the first job-publishing suite spends
the month for everyone after it.

**The fix is one helper, not fifteen edits.** `lib/catalogue.mjs` owns what the
catalogue is, rebuilds it by **running the seed** (not re-typing eight
mappings — a second copy is two places to update and one to forget), and
offers `arrangeUngated()` for suites that are not about billing.

⚠️ **Gating is still covered**, by the suites whose subject it is: billing,
billing-screens, entitlement-http, entitlement-engine, jobs-consume and
screens-25 all arrange metered state themselves and assert it.
entitlement-http now also names `APPLICATION_VIEW` staying FREE from the
outside — the hard rule the seed guards from the inside.

### 🔴 And the one that took the whole regression down

`security-pass` suspends the **real superadmin** on purpose: G46's middle case,
proving the guard refuses the *last* admin rather than refusing everyone. The
restore sat immediately after it, **inside the try** — so a run that died
between the two left the account suspended.

Measured: `StatusId 4`, nine failed sign-ins, a live lockout row. **Five
suites then died at entry** with *"This account is temporarily locked"*, which
reads as an auth bug and is nothing of the kind.

The restore is now in the `finally`, unconditional and idempotent. Checking
"was it me who suspended it?" needs state a crashed run does not have, and
setting ACTIVE on an active account costs nothing.

### The lesson, stated once

> **A test that depends on a shipped DEFAULT is a test that breaks when the
> default becomes a decision.**

Three phases of suites encoded "the engine is off" as a premise. That was
correct and documented for four phases, and was the single biggest obstacle to
turning the engine on. The answer is not to weaken them — it is for each suite
to **arrange** the state it is testing.
