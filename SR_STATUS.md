# SR status — against the client's demo feedback

**As at 2026-11-10, evening.** Every line below was read from the repos or from
`SR_NOTES.md` tonight, not recalled. Where something is unverified, it says so.

> **Point 9 (Google Places) is excluded from this report** at the client's
> instruction — the API key has not been supplied yet, so the seam stays dark.

---

## The ten items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Teacher intelligent defaults | **in progress** | `jp-teacher/.../jobs/browse/job-browse.component.ts` → `startFromProfile()`. Subject + state pre-fill, banner, "Show all jobs", zero-match widening. **Class levels not pre-filled.** |
| 2 | Billing at registration | **not started** | Registration has six steps — basics, address, logo, contact, documents, review. No plan step, no "Register as Free". |
| 3 | Free = 1 job post; own data never paywalled | **done, and suite-asserted** | `013_seed_school_plans.sql:156` → `SCHOOL_FREE / JOB_POST / quota 1`. Hard rule asserted at `entitlement-http.mjs:166` (`APPLICATION_VIEW = FREE`), plus the seed's own build guard. |
| 4 | Three plans + NULL-quota unlimited | **done** | `013_seed_school_plans.sql:107` → Free / Standard ₹1,499 / Unlimited ₹3,999. NULL quota documented at `:142` as meaning unlimited, "not a sentinel". |
| 5 | Geography — Haryana complete | **done** (being extended now) | `012_seed_haryana_geography.sql:7` — "🔴 SOURCE, AND THE DATE IT WAS READ". 23 districts / 143 tehsils / 143 towns. Cascade live in the form: `onStateChange → onDistrictChange → onTehsilChange`. |
| 6 | School photo/logo at registration, mandatory | **done** | Its own step (`:37`); validation at `:498` — "Add a logo or a photo of your school so teachers can recognise you." |
| 7 | Principal fields out of registration → profile | **done** | Moved out of registration; present at `school-profile.component.html:526`. |
| 8 | `FIELD_MATRIX.md` ready for client sign-off | **done** | 11,076 bytes, five "Your decision" cells, website-compulsory contradiction flagged at `:128`. Committed. |
| 10 | Multi-school | **in progress** | GroupType radios with explanation at `registration.component.html:163-173`, echoed on review `:534`. Dashboard "Add your next school" CTA built tonight. **Not browser-tested with a group org and two schools.** |
| 11 | `start-all` / `stop-all` from cold | **done** | Both present (8,881 b / 3,942 b). `SR_NOTES` records a cold run: *stop-all → every port free; start-all → all seven up*. Not re-run tonight. |

---

## Three things that were not visible from the summary

### 🔴 Item 1 is narrower than what the client asked for

The client asked for a teacher to see jobs pre-filtered to **their subjects
(plural), their class levels, and their state**. What is built pre-fills the
**first** subject and the **top-preference** state only.

`classLevelIds` exists on the teacher profile (`job-search.service.ts:107`),
but `startFromProfile()` does not read it and the browse screen has no
class-level filter to put it in. This is a genuine gap, not a wording
difference.

### 🔴 The plan seed cites a verification suite that does not exist

`013_seed_school_plans.sql:81` says the hard rule is asserted by
`sr-billing.mjs`. **There is no such file.** The rule *is* asserted — by
`entitlement-http.mjs:166` — so the product is protected and the comment is
wrong. Worth correcting, because a citation nobody can follow is how a guard
quietly stops being checked.

### ⚠️ Item 2 is the largest outstanding piece

Plan choice is absent from registration. The surrounding machinery exists:
provisioning requires a plan and the account does start Free
(`001_provisioning.sql:119, :138`), and plan-change-request handling is seeded
(`011_seed_plan_change_request.sql`, 200 lines). It is simply not wired to the
registration form.

---

## Work completed tonight, and how it was verified

Agents drafted some of this; every build below was re-run and read
first-hand rather than taken from an agent's report.

| Change | Verification |
|---|---|
| Visual Studio could not load any of the six projects | Root cause: VS 2022 **17.1.6 / MSBuild 17.1.0**, while .NET 8 requires **≥ 17.8.3**. After the update to **17.14.60**: `MSBuild JP.sln` → **exit code 0**, all six projects built. |
| Registration's four geography dropdowns → `<ui-combobox>` | jp-school build, exit 0 |
| Dashboard "Add your next school" CTA | jp-school build, exit 0 |
| Teacher browse starts from the profile | jp-teacher build, exit 0 |
| `ariaLabel` added to `ui-combobox` | Needed because the component owns its own id, so a `visually-hidden` outside label cannot reach it |
| 15 further combobox call sites across both apps | Both builds exit 0, zero compiler diagnostics |

**19 controls are now searchable comboboxes.** Short lists — gender, language
proficiency, board, school type, campus, employment type — were deliberately
left as plain `<select>`: a search box over four options is a worse control than
the four options.

Two claims were checked rather than accepted:

- The campus form's cascade was rewritten from a DOM `change` event to
  `valueChanges`, because a ControlValueAccessor emits no DOM event. The risk is
  that opening an existing campus looks like the user just changed the state and
  wipes its saved district and city. **Checked: `openEdit`'s `reset` carries
  `{ emitEvent: false }`.** Handled.
- `[required]="true"` on the job form's subject and designation is **new**. It
  was checked against the server: `@SubjectId int,` and `@DesignationId int,`
  take **no default**, so they were always compulsory. A draft without a subject
  was never savable — the form now says so before the round-trip instead of
  after it. An improvement, not a new restriction.

---

## Committed vs uncommitted

```
clean, in sync with remote : jp-backend 7e7e7ff · jp-admin 3050503 · jp-public a73b2d1

uncommitted working tree   : jp-docs    2  SR_NOTES.md, scripts/verify/walkthrough-school.mjs
                             jp-shared  2  ui-combobox (html + ts)
                             jp-teacher 5  job-browse ×3, teacher-profile ×2
                             jp-school  9  registration, dashboard, branches,
                                           school-profile, job-form
```

No repository has unpushed commits. Tonight's work is entirely uncommitted.

---

## Last full regression

**45 / 49 suites clean · 1,819 assertions · 880 s.**

⚠️ **That run predates every change made tonight.** No full run has been done
since.

| Red suite | Cause | Owner |
|---|---|---|
| `offers` (1) | The demo-day school gives `head@stmarys.edu.in` a second school membership, so G23 refuses with a 400 where the suite expects a cross-tenant 404 | **client data** |
| `team-contract` (3) | Same membership, same cause | **client data** |
| `screens-3h` (1) | Rohit's completion reads 100, the suite asserts the seeded 90 — he gained a photo | fixture drift |
| `teacher-verification` | Its probe teacher has no subject, so it is invisible to search. Passed in the previous run — intermittent | fixture drift |

None of the four is caused by the SR work.

---

## Blockers

**None open.** The Visual Studio failure that blocked the day is resolved.

For the record, it was never a repository problem: there was no `global.json`
anywhere, no `DOTNET_*` environment variable, and `dotnet build` was green
throughout. A bare `net8.0` project in a scratch folder reproduced the failure
under VS's MSBuild and succeeded under `dotnet`'s — which eliminated the repo,
the `.vs` cache and the fresh-clone rehearsal in one step.

---

## Remaining work, in order

| # | Item | Estimate |
|---|---|---|
| 1 | Geography seed agent to land; verify its builds and counts first-hand | 20 min |
| 2 | Item 1 gap — class levels and multiple subjects in the browse defaults | 30 min |
| 3 | Correct the stale `sr-billing.mjs` citation in the plan seed | 5 min |
| 4 | Full regression run and triage | 25 min |
| 5 | Walkthrough screenshots + `WALKTHROUGH.md` (script already written) | 30 min |
| 6 | Group-org browser test with two schools (item 10) | 20 min |
| 7 | Commit and push all repositories | 10 min |
| 8 | Consolidated `PROJECT_MEMORY` update | 15 min |
| 9 | **Item 2** — plan choice at registration + automatic plan-change request | 1.5–2 hr |

**Roughly four hours if item 2 is included.** Item 2 is placed last
deliberately: the demo shows registration, the inner menus and the pricing
route, and all three work without it.

---

## Decisions waiting on the client

1. **`qualificationId` on the job form** — a `MASTER_KEYS.qualification` lookup
   still on a plain `<select>`. The combobox's own documentation names
   qualification as having the same problem at smaller scale. Recommend
   converting. *5 minutes.*

2. 🔴 **A pre-existing bug, found while working nearby.** `openEdit` loads the
   districts for a campus's state but never loads the cities for its district —
   so editing a campus that has a city saved shows **no city control at all**
   until the district is picked again. Older than tonight's work, but it is
   visible in a demo. *10 minutes.*

3. **The experience modal's dropdown.** Inside `ui-modal`, an open list extends
   the modal's scroll area rather than overlaying it. Reachable, but not as
   clean as on a page. Fixing it means changing `ui-modal` in `jp-shared`, which
   affects **every modal in all four apps** — not a change to make hours before
   a demo without being asked.

4. **Two profile labels now read "Optional".** "Highest qualification" and
   "What you are hired as" are nullable with no validator, so the word is
   accurate — but it is a visible copy change. One word each if they should look
   required instead.
