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
