# How to run the Teacher Recruitment Portal

Everything needed to get this running from a clean machine, and an honest
statement of what is actually built.

**Status: Phase 5 complete** — three databases, both APIs, and all four
front-ends running on real data. Schools post jobs and process applicants;
teachers browse, apply and follow what happens next. The Phase 2.5 entitlement
engine is behind job posting and nothing else.

⚠️ The engine is built and **nothing is gated by it**. Every feature ships
"free", no plan includes or excludes anything yet, and no screen asks it a
question. That is deliberate: the first real use arrives with job posting in
Phase 4, and the first paid gate in Phase 6.5 — by changing data, not by
deploying code.

- **Phase 1** — `jp_sso`, its procedures, `JP.Sso.Api`, the auth screens and the
  design system.
- **Phase 2** — `jp_mdm` and `jp_app`, the approval engine, `JP.App.Api`, the
  admin verification panel, and school registration.
- **Phase 3** — the business tables and procedures, the profile APIs, and every
  school and teacher screen: school profile, campuses, team, teacher profile,
  and both dashboards.

> ✅ **There are no static mockups left in either portal.** Every screen that
> renders data now fetches it. See
> [What is real and what is not built yet](#-what-is-real-and-what-is-not-built-yet)
> — the honest statement of what exists, which is still the section to read
> before showing this to anyone.

**Not built yet:** jobs (Phase 4), applications and offers (Phase 5), and the
rest of the admin console. Those areas say so on screen rather than showing a
number.

---

## 1. Prerequisites

Versions below are the ones **verified working on this machine** on 2026-08-08.
Anything newer in the same major line should be fine; anything older has not
been tried.

| Tool | Verified version | Notes |
|---|---|---|
| .NET SDK | **8.0.423** | The solution targets `net8.0`. .NET 9 is not tested |
| Node.js | **v24.16.0** | Angular 22 needs Node 20.19+ |
| npm | **11.13.0** | |
| Angular | **22.1.1** (CLI 22.1.3) | Installed per-app; no global CLI needed |
| TypeScript | **6.0.3** | Pinned by the app's `package.json` |
| SQL Server | **15.0.2180.2**, Developer Edition | **SQL Server 2019.** No 2022+ syntax anywhere (decision 2.11) |
| sqlcmd | **15.0.2000.5** | Ships with SQL Server; must be on `PATH` |
| git | **2.55.0** | |

**SQL Server instance: `localhost\TARUN`** — a *named* instance. This machine is
also called `TARUN`, so `TARUN`, `localhost` and `.` all resolve to the **default**
instance, which is empty. In SSMS you must connect to `TARUN\TARUN` or
`localhost\TARUN` or you will see no `jp_*` databases and conclude the build
failed.

Local development uses **Windows Authentication**. SQL authentication is
supported; the password then comes from the `SQL_PASSWORD` environment variable
and never from `appsettings.json`.

---

## 2. First-time setup

Follow this in order. It assumes nothing but the prerequisites above.

### 2.1 Clone all seven repositories as siblings

There is no parent repository. All seven sit side by side, and that layout is
**load-bearing** — the apps compile their SCSS from `../jp-shared/src/styles`.

```powershell
mkdir D:\Projects ; cd D:\Projects
git clone https://github.com/Tarun1515/jp-docs.git
cd jp-docs
npm run bootstrap
```

`bootstrap` clones the remaining six beside `jp-docs` and runs `npm install` in
each Node project. It stops short of everything below and prints it as a
checklist, because those steps need decisions or credentials.

You should end up with exactly this:

```
D:\Projects\
├── jp-docs      ← this file
├── jp-shared    :4999
├── jp-admin     :4200
├── jp-school    :4300
├── jp-teacher   :4400
├── jp-public    :4500
└── jp-backend
```

> ⚠️ Do not nest them, and do not rename them. `../jp-shared` is a real path on
> disk that four `angular.json` files depend on.

### 2.2 Build the databases

```powershell
cd D:\Projects\jp-backend
sqlcmd -S localhost\TARUN -E -b -f 65001 -i database\run_all.sql
```

`-b` stops on the first error — without it sqlcmd reports a failure and then
cheerfully runs the remaining 30 scripts. `-f 65001` reads the files as UTF-8;
without it every em-dash in a comment is mangled.

The script is **idempotent**. Re-running it is the normal way to apply new
scripts to an existing dev database.

Verify:

```powershell
sqlcmd -S localhost\TARUN -E -Q "SELECT name, compatibility_level, collation_name FROM sys.databases WHERE name LIKE 'jp_%'"
```

Expect `jp_sso`, `jp_mdm`, `jp_app`, all at compatibility level **150** and
collation `SQL_Latin1_General_CP1_CI_AS`.

### 2.3 Create the API dev settings

The real files are gitignored so a machine-specific connection string never
lands in the repository. Committed examples sit beside them:

```powershell
cd D:\Projects\jp-backend
copy JP.Sso.Api\appsettings.Development.example.json JP.Sso.Api\appsettings.Development.json
copy JP.App.Api\appsettings.Development.example.json JP.App.Api\appsettings.Development.json
```

Open both and check the connection strings point at your SQL instance. The
examples assume `localhost\TARUN` with Windows auth.

### 2.4 Set the JWT signing key — on BOTH APIs

The key is **not** in `appsettings.json` and never will be. It lives in
user-secrets, and **both APIs must carry the identical key**: `JP.Sso.Api`
signs the token and `JP.App.Api` validates it. Two different keys means every
call to `JP.App.Api` returns 401 with nothing in the logs explaining why.

Generate one (64+ characters):

```powershell
$key = [Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))
```

> ⚠️ Do **not** use `Get-Random -Count 80 -InputObject (...)` to build this.
> `-Count` returns *distinct* elements, so it silently produces a shorter and
> far weaker key than you asked for. This bit us once already.

Apply it to both:

```powershell
cd D:\Projects\jp-backend\JP.Sso.Api
dotnet user-secrets set "Jwt:Key" "$key"

cd ..\JP.App.Api
dotnet user-secrets set "Jwt:Key" "$key"
```

Confirm they match:

```powershell
cd D:\Projects\jp-backend\JP.Sso.Api ; dotnet user-secrets list
cd ..\JP.App.Api                     ; dotnet user-secrets list
```

### 2.5 Create the first administrator

There is **no admin row in any seed script**, on purpose: a password hash
committed to a `.sql` file is a credential shared by every clone, every branch
and every backup, forever. The hash is derived on your machine instead.

```powershell
cd D:\Projects\jp-backend\JP.Tools.SeedAdmin
dotnet run -- --email admin@yourdomain.com --generate
```

`--generate` prints a strong password **once**. Copy it before closing the
window. Other options:

| Flag | Effect |
|---|---|
| `--generate` | Generate a password and print it once |
| `--password <value>` | Supply one (visible in shell history — prefer `--generate`) |
| *(neither)* | Masked interactive prompt, entered twice |
| `--role` | `SUPER_ADMIN` (default), `ADMIN`, `SUPPORT_ADMIN` |
| `--mobile` | Optional 10-digit number |
| `--print-sql` | Print the `EXEC` statement instead of running it, for a server you cannot reach |

### 2.6 Check it works

```powershell
cd D:\Projects\jp-shared ; npm start      # :4999, leave it running
```

In a second terminal:

```powershell
cd D:\Projects\jp-backend\JP.Sso.Api ; dotnet run
```

In a third:

```powershell
cd D:\Projects\jp-school ; npm start
```

Open <http://localhost:4300/auth/login> and sign in with one of the test
accounts in section 4. You should land on the school dashboard.

---

## 3. The frontend — seven repositories, one remote

Everything lives as **siblings** under `D:\Projects\`. Nothing is nested.

```
D:\Projects\
├── jp-docs      ← this file. Clone it beside every other repo
├── jp-shared    :4999  the REMOTE — start this first
├── jp-admin     :4200  host
├── jp-school    :4300  host
├── jp-teacher   :4400  host
├── jp-public    :4500  standalone SSR site — NOT federated
└── jp-backend   both APIs + all three databases
```

New machine:

```bash
cd jp-docs
npm run bootstrap        # clones the lot and installs
```

It stops short of the things that need a human — SQL Server, the dev settings
files and the JWT user-secrets — and prints those as a checklist at the end.

There is no registry token, no `.npmrc` and no `npm link` any more. See
PROJECT_MEMORY decision 2.42.

### 3.1 Ports and start order

| Project | Port | Command |
|---|---|---|
| **`jp-shared`** | **4999** | `cd jp-shared ; npm start` |
| `jp-admin` | 4200 | `cd jp-admin ; npm start` |
| `jp-school` | 4300 | `cd jp-school ; npm start` |
| `jp-teacher` | 4400 | `cd jp-teacher ; npm start` |
| `jp-public` | 4500 | `cd jp-public ; npm start` |
| `JP.Sso.Api` | 5199 | `cd jp-backend\JP.Sso.Api ; dotnet run` |
| `JP.App.Api` | 5299 | `cd jp-backend\JP.App.Api ; dotnet run` |

> 🔴 **Start `jp-shared` first, and leave it running.** `jp-admin`, `jp-school`
> and `jp-teacher` fetch their components from it at runtime. Without it they
> boot to a blank page. `jp-public` does not need it.

For most work you need **`jp-shared` + `JP.Sso.Api` + whichever app you are on**.

### 3.2 What to start for what you are doing

Do not start everything. Start the smallest set the task needs — every extra
dev server is memory and one more thing to have left running by mistake.

| I am working on | Start exactly this |
|---|---|
| **School screens** | `jp-shared` :4999 · `JP.Sso.Api` :5199 · `jp-school` :4300 |
| **Admin screens** | `jp-shared` :4999 · `JP.Sso.Api` :5199 · `jp-admin` :4200 |
| **Teacher screens** | `jp-shared` :4999 · `JP.Sso.Api` :5199 · `jp-teacher` :4400 |
| **A shared component** | `jp-shared` :4999 + **any one** app to look at it in |
| **The public site** — home, how it works, about, legal | `jp-public` :4500 — no remote, no API |
| **The public site's DATA pages** — `/jobs`, `/jobs/:slug`, `/faq`, `/contact` | `jp-public` :4500 **plus `JP.App.Api` :5299** — see the note below |
| **The `/continue` chooser flow** | `jp-public` :4500 **plus whichever target app you are checking** — `jp-school` :4300 or `jp-teacher` :4400, and `jp-shared` :4999 for that app to render |
| **Master data / business endpoints** (Phase 2+) | the above **plus** `JP.App.Api` :5299 |
| **Database or SP work** | none of them — `sqlcmd` only |

> 🔴 **PHASE 7A CHANGED THIS, AND THE OLD LINE HERE WAS "jp-public needs
> nothing else. No remote, no API".** That was true for five phases and is now
> only half true.
>
> `/jobs`, `/jobs/:slug`, `/faq` and `/contact` read and write `JP.App.Api` — they
> are the first pages on the public site that talk to a backend at all. They are
> also `RenderMode.Server`, so the **Node SSR process** makes that call while
> rendering: without the API, `/jobs` serves a page that says it could not load
> the jobs, and `/faq` one that says it could not load the questions. They say so
> honestly rather than rendering empty, but they are not standalone any more.
>
> ⚠️ `jp-public` still needs **no remote**. It is not federated and never
> contacts :4999 — that part of the old line stands.
>
> ⚠️ **FIVE** pages are still fully standalone: home, how it works, about, terms
> and privacy. They are prerendered at build time and hold no data.
>
> ⚠️ `npm run build` prints "Prerendered 6 static routes", and the sixth is
> `/contact` — which is **prerendered and still needs the API**. Those two are not
> the same question: prerendering is about how the page is BUILT, and the form
> POSTs when somebody presses the button. So contact renders fine with nothing
> running and fails on submit, which is the one combination that is easy to miss.
>
> The chooser is the other exception: the page renders standalone, but following
> a card into `/auth/login` or `/auth/register` crosses into another app — and
> that app needs the remote.

Two things follow from that table:

- **`jp-shared` is in almost every row.** Start it first and leave it running
  all day. It is not something you restart per task.
- **`JP.App.Api` is in almost none of them.** Phase 1 is entirely
  authentication, users, roles, permissions and menus, all of which are
  `JP.Sso.Api`. If you are not touching master data, you do not need it.

### 3.3 How the sharing actually works

Two different mechanisms, on purpose:

| | shared how | when |
|---|---|---|
| **JavaScript** — components, services, guards | Module Federation import map → `http://localhost:4999` | **runtime** |
| **SCSS** — tokens, mixins, partials | `includePaths: ["../jp-shared/src/styles"]` | **build time** |

Apps import JavaScript through four specifiers, and nothing else:

```ts
import { UiButtonComponent }  from 'jp-shared/ui';
import { AuthService }        from 'jp-shared/core';
import { UserType }           from 'jp-shared/models';
import { NotFoundComponent }  from 'jp-shared/pages';
```

Those are **not** packages in `node_modules`. The build leaves them unresolved
(`externals` in `federation.config.mjs`), TypeScript resolves them for types
only (`paths` in `tsconfig.json`), and the browser resolves them from the import
map that `initFederation` installs before the app bootstraps.

Component stylesheets keep writing `@use 'variables' as v;` exactly as before.

> ⚠️ **The sibling layout is load-bearing.** That `../jp-shared/src/styles` is a
> real relative path on disk. **CI must check out `jp-shared` alongside the app**
> or the build fails on the first component stylesheet.

### 3.4 The development loop — this is the point of the whole setup

```bash
cd jp-shared && npm start      # once, then forget about it
cd jp-school && npm start
```

Edit a component in `jp-shared`, reload `jp-school`, see the change. No publish,
no version bump, no link step.

The app's own dev server does still do a ~0.2 s incremental rebuild, because its
tsconfig `paths` point at jp-shared's **source** for types, so its watcher sees
the edit too. That is automatic and you do not have to do anything — but it is
not literally zero, and it is worth knowing before you go looking for why the
terminal moved.

### 3.5 🔴 "ngDevMode is not defined" — the one you will hit

**Symptom.** The app was fine, then every route renders blank and the console
says:

```
ERROR ReferenceError: ngDevMode is not defined
    at new _LoginComponent (...)
```

**Cause.** You ran a **production build** while the **dev server** was running.
Both share the Native Federation externals cache, so the production copy of
`@angular/core` — which does not define `ngDevMode` — replaced the dev one. The
message says nothing about any of this.

**Fix.**

```bash
# stop the dev server first
rm -rf .angular/cache
npm start
```

Do production builds with the dev servers stopped.

### 3.6 ⚠️ `@angular/animations` is a dependency nothing imports

Leave it alone. The hosts turn off Native Federation's `ignoreUnusedDeps` (it
walks the import graph with Sheriff, which refuses files outside the project
root — and the tsconfig `paths` deliberately point at the sibling repo). With
pruning off, esbuild bundles `@angular/platform-browser`'s animations entry
points, which import `@angular/animations/browser`.

Removing the package breaks the build with `Could not resolve
@angular/animations/browser`, and adding it to `skip` does **not** help — `skip`
controls what is *shared*, not what *resolves*.

### 3.7 jp-public is not federated

It is a normal Angular SSR application, and as of the static-site build it has
eight real routes: `/`, `/how-it-works`, `/about`, `/faq`, `/contact`,
`/terms`, `/privacy` and `/continue`, plus a 404.

It imports **zero** shared JavaScript — not one TypeScript file — so federating
it would add a polyfill, a startup round-trip and a runtime dependency on :4999
in exchange for nothing, while complicating the SSR pipeline that its SEO
depends on. Its 404 page is its own rather than `jp-shared/pages` for exactly
that reason.

**Six** pages are **prerendered** at build time — home, how it works, about,
contact, terms, privacy — and `npm run build` prints exactly that ("Prerendered 6
static routes"), which is the quickest way to check nothing has slipped into the
wrong mode.

**Four** are server-rendered: `/continue` (varies by query parameter), and from
Phase 7A `/jobs`, `/jobs/:slug` and `/faq` (they read live data). 🔴 Those three
MUST stay listed in `app.routes.server.ts`: the `**` catch-all is
`RenderMode.Prerender` and would otherwise render `/jobs` ONCE at build time —
against a build machine with no jobs — and serve that empty page for ever, with
no error and no warning.

Each route carries its own title, meta description, Open Graph tags and canonical
URL, and `robots.txt` and `sitemap.xml` ship with the build. ⚠️ A job detail
page's title comes from the JOB, not from route data, so it is set from the
response — and the title is capped at 65 characters because `site-audit.mjs` fails
above that. Lighthouse scores SEO 100 and accessibility 100 on all **nine**
pages (the seven static ones plus `/jobs` and one job detail) — keep it that way.

✅ **Job search and job detail ARE built (Phase 7A).** `/jobs` is a
server-rendered listing with search, subject/state/class-level filters and
server paging; `/jobs/:slug` is one job with the school's public profile.
"Find jobs" is back in the header, first in the nav.

The line here used to read "not built… they need Phase 4 data… 'Find jobs' is
deliberately absent from the header for the same reason", and that rule is why
they waited: the link was removed because it would have 404ed, and it is back
because the page now exists. Restored by the same rule that removed it.

🔒 Only **effective-ACTIVE** jobs exist publicly. A draft, expired, closed,
deleted or (from 7B) moderation-pulled job returns **404 on the public route**,
enforced in the procedure's WHERE clause — and the refusal never says which,
because on a page anyone can load "this job has expired" confirms the id is real.

⚠️ The city filter renders no control, because `m_mdm_city` is unseeded (G40).
It will appear by itself the day the master is seeded — the UI is driven by what
the server says is reachable.

⚠️ Featured jobs and featured schools are **still** not built. They are Phase 7B,
and the "do not build it against mock data" argument still applies to them.

✅ **The contact form posts for real (Phase 7A)** — `POST /api/public/contact`
into `t_app_contact_enquiries`, which 7B's admin queue reads. It is the only
anonymous WRITE in the system.

⚠️ The prefilled `mailto:` did NOT go away; it moved to the failure path. A form
that cannot submit and offers no alternative loses the enquiry, which is what the
old note here was protecting against — so on a failed send the page says so, the
message stays in the box, and the mailto: button is offered. `public-screens.mjs`
forces a 500 and asserts all three.

🔒 **It carries a honeypot.** A `website` field is hidden from people (off-screen,
`tabindex="-1"`, `aria-hidden`) and sent untouched. A bot that fills it gets **200
and the same thank-you a person gets, and no row is written** — telling it that
it was caught teaches whoever wrote it to stop filling the field. Nothing is
checked in the browser; the server decides, silently.

⚠️ **Three submissions per hour per IP.** The limit is per process and in memory,
so a restart resets it — which matters when running the verification suites.

🔴 `/terms` and `/privacy` have real structure and **placeholder body copy that
has not been through legal review**. Both carry a visible draft notice. They
must not go live until the client supplies or approves the wording.

It still gets the design tokens the same way everything else does, through the
build-time SCSS include path. That is not an exception: SCSS is build-time for
all five projects.

### 3.8 Each app takes only its own account type

All three signed-in apps authenticate against the same SSO API, so a school owner
**can** sign in successfully on the teacher app — valid token, wrong app.

When that happens the app signs them straight back out and says where to go:

> **That is a school account.** Sign in at localhost:4300

That is working as designed, not a bug. The check runs after login and again at
bootstrap, because a token can also arrive from storage. It is wayfinding, not
security — the token stays valid and the server is what enforces access.

Tokens are stored per app (`jp.admin.accessToken`, `jp.school.accessToken`), so
two apps on one origin never read each other's session.

### 3.9 Production

`jp-shared` builds to static files served from a URL that comes from each app's
environment config, never hardcoded.

> ⚠️ **If the jp-shared host is unreachable, all three apps fail to boot.** That
> is the trade. **Mitigation: serve `jp-shared` from the same origin as the
> apps**, so there is no independent failure point — if that server is down,
> everything is down anyway.

---

## 4. Test accounts

> ⚠️ These exist **only in your local `jp_sso`**. They are development fixtures.
> None of them may ever be created in a deployed environment — `JP.Tools.SeedAdmin`
> is the only sanctioned way to create an administrator anywhere real.
> The passwords themselves are no longer in this file — see the note below the
> table.

| Email | Password | Type | Role | What it demonstrates |
|---|---|---|---|---|
| `superadmin@teacherportal.local` | see `local-accounts.md` | Admin | `SUPER_ADMIN` | Full admin sidebar — 14 entries: 12 links under the 2 nested group headings (Verification, Moderation), including the 6.5B payments queue. Approving a pending school |
| `principal@greenwood.edu.in` | see `local-accounts.md` | School | `SCHOOL_OWNER` | The complete school sidebar (10 items) and every school screen: dashboard, profile, campuses, team, offers, billing |
| `hr.lead@greenwood.edu.in` | see `local-accounts.md` | School | `HR` | **Permission filtering.** Same organisation as the principal, but 6 menus instead of 10 — no School profile, no Campuses, no Offers, no Team. Sign in as both back to back; that difference is `USP_GetUserMenus` doing its job |
| `head@stmarys.edu.in` | see `local-accounts.md` | School | `SCHOOL_OWNER` | **Tenant isolation.** A second organisation, with its own school (St Mary's Convent, Bandra), its own head office and its own plan. Neither school can see the other's branches, users or applicants |
| `viewer@greenwood.edu.in` | see `local-accounts.md` | School | `SCHOOL_VIEWER` | **Read-only rendering.** Same school as the principal, scoped to its campus, holding `JOB.VIEW` · `APPLICANT.VIEW` · `REPORT.VIEW` and nothing else. Opens `/jobs`, sees the rows, and sees **no** New job, Publish or Close — absent, not greyed |
| `tarun@yopmail.com` | *(yours)* | Teacher | `TEACHER` | The teacher portal — 10 menus, no admin or school items |

> ⚠️ **Two different counts, and both are right.** The numbers above are
> **sidebar entries** — what a person actually sees. `GET /api/menus` returns
> **two more rows** for every account: `ACCOUNT_STATUS` and
> `ACCOUNT_DOCUMENTS`, which carry `IsMenuVisible = 0` and are filtered by
> the shell's `navigationTree`. They are returned because the routes are real
> and reachable — the account-status screen is where a suspended school lands —
> and hidden because nobody navigates to them from a sidebar. So an API row
> count of 11 and a sidebar of 9 are the same healthy state, and neither number
> should be "corrected" to match the other.
>
> 🔴 **Measured at the end of 6.5B**, per account: superadmin 12 links under 2
> group headings · principal 10 · hr.lead 6 · viewer 5 · teacher 10. A menu is
> data (2.37), so a new screen means a new seeded row and the counts written
> here move in the same commit as that row.
>
> ⚠️ **6.5B added "Plan and billing" to EVERY account** (+1 each) and
> "Payments" to the administrator (+1 more). The billing row carries **no
> PermissionCode** deliberately — seeing which plan you are on is a property of
> the account, not a privilege, and an HR about to post a job needs to know
> this month's allowance rather than discovering the limit by being refused by
> it. Only *requesting* a change is gated (`BILLING.MANAGE`, held by
> SCHOOL_OWNER and TEACHER), and on screen that control is **absent with a
> reason** rather than disabled (2.62).
>
> ⚠️ Which is why a **viewer** has it too: 5 links, one of which is a screen it
> can read and cannot act on. That is the intended shape, not an oversight.
>
> 🔴 Before 6.5B the numbers were: superadmin 11 · principal 9 · hr.lead 5 ·
> viewer 4 · teacher 9.

> 🔴 **The Viewer is a real account, and it used to be a fixture.** Phase 4B had
> no Viewer, so `jobs-screens.mjs` synthesised one by soft-deleting the HR
> role's `JOB.CREATE`/`JOB.EDIT` grants for the length of one assertion and
> putting them back. That was honest but it edited a shared role to test a
> screen, and a killed run left the HR account weakened. The account below
> replaced it in PRE-5.
>
> ⚠️ **It cannot come from `JP.Tools.SeedAdmin`** — that tool calls
> `USP_CreateAdminUser` and takes `SUPER_ADMIN`, `ADMIN` or `SUPPORT_ADMIN`
> only. A school colleague arrives through the product's own invite flow, which
> is exactly what the seeding script walks:
>
> ```powershell
> cd D:\Projects\jp-docs
> node scripts/seed-school-viewer.mjs
> ```
>
> Owner invites → the invitation lands in
> `jp-backend\JP.App.Api\App_Data\mail-drop\*.eml` → the token is redeemed
> through `POST /api/auth/set-password-from-invite`. The application derives the
> PBKDF2 hash, exactly as it does for a real person. 🔴 **Never hand-roll a hash
> into SQL.** Re-running the script when the account already works changes
> nothing and says so.

> 🔴 **The passwords are in `local-accounts.md`, which is gitignored.**
>
> They used to be in this table. This file is pushed to GitHub, and a password
> in a repository's history stays there long after somebody decides it should
> not have been — rewriting history is possible and nobody enjoys doing it under
> pressure.
>
> ⚠️ On a new machine that file will not exist. Rebuild the accounts through the
> real registration endpoints, and create the administrator with
> `JP.Tools.SeedAdmin --generate`. Instructions are in `local-accounts.md`
> itself, and repeated in §3 above.

**There is currently no PENDING school**, so the account-status screen is not
reachable by simply signing in. Two ways to see it:

- Register a new school at `/auth/register` — it lands there immediately, or
- Open `http://localhost:4200/account/status?code=ACCOUNT_PENDING` while signed
  in as any account. The `code` parameter also accepts
  `ACCOUNT_RESUBMIT_REQUIRED`, `ACCOUNT_REJECTED`, `ACCOUNT_SUSPENDED` and
  `ACCOUNT_LOCKED`, each of which renders different copy and a different state.

---

## 5. The happy path, click by click

Start six things: `jp-shared` (:4999), **both** APIs — `JP.Sso.Api` (:5199) and
`JP.App.Api` (:5299) — then `jp-school` (:4300), `jp-admin` (:4200) and
`jp-teacher` (:4400).

⚠️ `JP.App.Api` was optional when this walk-through only covered sign-in. It is
not optional now: every dashboard, profile, campus and team screen reads from it.

1. **Register a school** — <http://localhost:4300/auth/register>. Any email, any
   10-digit mobile starting 6–9, a password of 8+ characters. There is no
   "school or teacher" toggle: each app's signup is single-purpose, so the form
   only ever speaks to one audience.
2. You land on **account status**, pending verification. Note the roll marked
   to *In review* and the three "what happens next" steps.
3. **Sign in as `superadmin@teacherportal.local`** — on **<http://localhost:4200>**,
   the admin app. Signing in as an administrator on :4300 will succeed and then
   immediately sign you back out with a message pointing here; that is the
   cross-app guard doing its job, not a bug.
4. Approve the school **in the admin app** — Verification → Schools. The queue
   is oldest-first, the row opens into the request with its documents, and
   Approve provisions the school, its head-office campus and its subscription in
   one action (2E, 2.49).

   ⚠️ The Swagger route (`PUT /api/users/{userUid}/status`) still works and is
   still the way to move an account for any other reason, but it is no longer
   how a school gets approved — the approval decision and the provisioning that
   follows it belong together.
5. **Sign in as the school again** on :4300. It is now Active, the sidebar has
   all 8 school items, and `SCHOOL_OWNER` was granted automatically at approval.
   The sidebar is rendered from `GET /api/menus`, not from a hardcoded array.

   ⚠️ Eight, not nine: Applicants is hidden until Phase 5 (3I). A single-campus
   school sees seven — Campuses disappears too, which is decision 2.10 applied
   in the menu as well as the route.
6. Open **Dashboard**. Every figure on it is fetched: the school's name and
   verification badge, its head-office campus, its plan, and who is on the
   account. The **Jobs** and **Applicants** areas show what they will become and
   say when — they carry no counts, because there is nothing yet to count.

   Then open **School profile**, **Campuses** and **Team**. All three read and
   write real data (3F, 3G). Each profile section saves on its own, and a save
   that clashes with somebody else's shows a reload rather than overwriting them.

   Then open **Jobs** and **Applicants**. Post a vacancy, publish it, and the
   people who apply appear under Applicants with the stage each of them has
   reached (4, 5).

   🔒 Open one applicant and you will see their email and mobile. That is
   decision 2.56 working, not a leak: contact opens because **that teacher
   applied to you**, it is visible to your school and no other, and no
   subscription anywhere can buy it. A teacher who has not applied has no
   contact details on this system as far as you are concerned.

   ⚠️ The applicants screen was a fixture-driven mockup until Phase 5B (G6).
   The design survived; the fifty invented rows did not, and
   `_design-reference/` is deleted.

7. **Sign in as a teacher** on **<http://localhost:4400>** and open **Dashboard**
   and **My profile**. The dashboard shows the completeness meter — which names
   the single most valuable missing thing and never prints "0%" at somebody who
   has just started — plus their resume status and plan.

   Then **Find jobs**, open one and apply (5B). Three things are worth trying
   deliberately:

   - **Apply without a resume.** The refusal appears beside the button, names
     the missing piece and links straight to the resume section — and the Apply
     control stays, because that will stop being true the moment they upload
     one. "Not yet", never "not allowed" (2.62).
   - **Apply, then replace your resume.** The school still opens the file you
     sent. `ResumePathSnapshot` is copied at the moment of applying, so
     changing your profile cannot rewrite what somebody already read.
   - **Save a job instead of applying.** Nothing is sent to the school. Saving
     is interest; applying is consent, and only the second one opens your
     contact details (2.56).

   ⚠️ **An unverified teacher can apply, and that is deliberate.** The verified
   badge is a signal to schools, never a gate on the teacher (2.9, a locked
   stance). A product that required verification first would lock people out on
   the day they joined.

   ⚠️ **There is no withdraw.** A teacher cannot take an application back in
   this release — recorded as a deliberate deferral, not an oversight (G28).
8. **Change your password** via Swagger `POST /api/auth/change-password`, then
   try to refresh with an old refresh token: it returns 401 and the entire token
   chain is revoked.
9. **Forgot password** — <http://localhost:4300/auth/forgot-password>. SMTP is
   disabled in development, so the email is written to
   `jp-backend\JP.Sso.Api\App_Data\mail-drop\*.eml`. Open the newest file, copy
   the `token=` value out of the reset link, and visit
   `http://localhost:4300/auth/reset-password?token=<token>`.

   The link is built per audience: a school's reset points at :4300, a teacher's
   at :4400, an administrator's at :4200. That comes from `Auth:PortalBaseUrls`
   keyed by user type, not from one shared base URL.

10. **The public chooser** — <http://localhost:4500/continue?mode=signup>. Two
   options, school and teacher, each linking into the app you just used.
   `jp-public` needs neither the remote nor the API for this.

---

## 🔴 What is real and what is not built yet

This is the part that matters when someone is looking over your shoulder.

### ✅ There are no static mockups left

The category that used to sit here — **screens populated from a hardcoded file
with no HTTP call** — is now **empty**, and that was the point of Phase 3I.

Two screens were in it, and they were the two that looked the most finished:
the school dashboard and the applicants list, both computing figures from
`applicant.data.ts`. The dashboard started fetching real data in 3I.

The applicants list came back in **Phase 5B**, built against
`t_app_applications`. Its design — the margin rule, the roll as a histogram,
ruling instead of zebra striping — is the mockup's, and that is the only thing
that survived: `_design-reference/` and its fixture file are **deleted**, and
`applications-screens.mjs` checks that no name from it can appear on the screen
and that its fixture strings are absent from every built chunk.

⚠️ If you are demonstrating this product, there is no longer a screen you have
to talk around. There are areas that say "not yet", which is a different thing.

### ⚠️ Every dropdown of master data is still OUR guess, not the client's

Subjects, designations, qualifications, class levels, skills, facilities and
document types were seeded by us in Phase 2B because the client's lists never
arrived, and five of them are marked PROVISIONAL (2.47).

🔴 **This matters most on a job form**, because that screen is nothing but those
lists: subject, designation, qualification, class level, employment type. If you
demonstrate posting a job, say once that the option lists are provisional and
that the client reconciles them by `Code` — otherwise the first question after
the demo is "why isn't *our* subject in there", and the honest answer arrives
late instead of early.

The engineering cost of a change is near zero: rename freely, deactivate what is
not wanted (`Is_Active = 0`, never DELETE), add new rows with new codes. What is
NOT free is changing a `Code` that is already live — foreign keys resolve
through it.

### ⚠️ Built but deliberately inert — the entitlement engine

Phase 2.5 added features, gating modes, quotas, credits and an append-only
ledger, plus the **Plans and features** screen in the admin console.

🔴 **Turning any of it on is a data change, and none has been made.** Right now:

- every feature is **Free** — the mode that reads no plan mapping at all;
- **no plan includes or excludes anything** — the matrix is entirely unmapped;
- the ledger is **empty**, and no endpoint in the product calls the engine.

So Phase 2.5 changed nothing a school or a teacher can see, and that is how it
was designed. Shipping the engine and the gating together would mean that on the
day something stops working, two new things are under suspicion at once.

⚠️ **If you are demonstrating to a client:** the Plans and features screen shows
the machinery, not a price list. `m_mdm_plans` still holds two free plans and no
prices, because pricing has not been agreed — the public FAQ says so too. Do not
present the screen as a commercial offer.

🔴 **And the rule underneath it, which does not bend:** a subscription buys the
school's *capability* — whether it may search at all, how many invitations it may
send. It never buys a teacher's phone number or email. Contact opens only when
the teacher consents, by applying or by accepting an invitation.

Design and rationale: `MONETIZATION_DESIGN.md`.

#### Showing a priced plan anyway — the demo fixture

**Run `scripts/demo/demo-setup.sql` before the demo, and
`scripts/demo/demo-teardown.sql` after it — a demo plan is never committed as
seed data.**

```
sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-setup.sql
...demo...
sqlcmd -S "localhost\TARUN" -E -I -b -f 65001 -i scripts/demo/demo-teardown.sql
node scripts/verify/run.mjs          # proves the shipped state is back
```

🔴 **While the fixture is installed, `run_all.sql` and several suites FAIL on
purpose.** 011's build guard refuses a priced public plan and the suites assert
zero plan-feature mappings. That is the guard working — the plan has to be
public to be sellable at all (`USP_RequestPlanChange` answers `NOT_FOUND`
for a non-public plan, measured), so the fixture and a green build cannot
coexist. Teardown is the fix, and it prints the counts it restored.

⚠️ It sells "Growth Plan (SAMPLE — pricing TBD)" at 999 — a placeholder nobody
can mistake for a decision, because §4 Q4 is still with the client and a number
shown in a demo gets quoted back.

### Fully wired to the API

| Screen | App | Route | Reads |
|---|---|---|---|
| Sign in · register · forgot/reset password · invite · OTP | all | `/auth/*` | `JP.Sso.Api` auth endpoints |
| The sidebar, everywhere | all | | `GET /api/menus` — filtered server-side by user type and permission |
| **Dashboard** | school | `/dashboard` | `GET /api/dashboard/school` |
| **School profile** | school | `/profile` | `GET/PUT /api/school/profile`, logo, photos, facilities |
| **Campuses** | school | `/branches` | `GET/POST/PUT/DELETE /api/branches` |
| **Team** | school | `/users` | `GET /api/school/team`, invite, role, campus scope, remove |
| **Dashboard** | teacher | `/dashboard` | `GET /api/dashboard/teacher` |
| **My profile** | teacher | `/profile` | `GET/PUT /api/teacher/profile` plus nine section endpoints |
| **Verification queue and request detail** | admin | `/verification/*` | `GET /api/approvals`, actions, documents |
| **Plans and features** | admin | `/settings/plans` | `GET /api/entitlements/matrix`, gating and mapping saves |

Every one of these has been exercised end to end against running APIs — see
`scripts/verify/` for the checks and `screenshots/` for what they look like.

> 🔴 **A full `run.mjs` needs a freshly started `JP.App.Api`.** `public-contract.mjs`
> proves the contact form's rate limit — three submissions per hour per IP — and
> proving it costs all three. The limiter is in-memory and per process (2.35), so
> the reset is a **restart**, not a wait. Run it twice inside the hour without
> restarting and that suite fails on its own PRECONDITION check, which says
> exactly this. Details in `scripts/verify/README.md`.

### 🟡 Real page, presentational data

**Account status** (`/account/status`). The routing, the guard and the sign-out
button are real, but **the verification state it displays is not fetched** — it
is chosen from the `?code=` query parameter. It will show "In review" for an
account approved an hour ago. Treat it as a design of the screen, not a live
status page.

### ⬜ Not built — the areas that say so

These render an empty state describing what the section will be, a **disabled**
action, and one line about when it arrives. **No counts, and no zeros** — a zero
is a measurement, and there is nothing yet to measure.

| Area | Where | Arrives |
|---|---|---|
| Jobs | both dashboards, `/jobs` | Phase 4 |
| Applicants / applications | both dashboards | Phase 5 |
| Offers, saved jobs, invitations | teacher and school menus | Phase 5–6 |
| Most of the admin console | moderation, users, masters, CMS, reports, settings | Phase 6–7 |

Routes that still resolve to the shared "coming soon" page appear in the sidebar
deliberately — the navigation structure is settled and the screens land per
phase.

### Built and tested, but no UI

Some endpoints are reachable only through Swagger:

- `GET /api/roles`, `POST /api/roles`, `GET /api/permissions`
- `POST /api/users/{uid}/unlock`, `PUT /api/users/{uid}/status`
- `GET /api/auth/me` — defined in `AuthService`, not called by any component
- `GET /api/approvals/orphaned` and the orchestration retry (2E)

Three routes are reachable only from an email link or by typing the URL:
`/auth/reset-password`, `/auth/accept-invite`, `/account/verify-otp`.

---

## 5b. Behind a reverse proxy — the one setting that changes meaning

Everything above assumes you reach the APIs directly. The moment a reverse
proxy (nginx, a load balancer, Cloudflare) stands in front, **every per-IP
limit silently becomes a per-SITE limit**: the proxy's address is the only one
the API can see, so the contact form's three-per-hour budget is shared by every
visitor on the internet. The fourth person to write in that hour is refused and
nobody has done anything wrong. That was **G42**.

Phase 8-0 added the switch. It is **off**, and it stays off until a deployment
can say which addresses are the proxy:

```jsonc
// JP.App.Api/appsettings.json  (or the matching environment variables)
"ForwardedHeaders": {
  "Enabled": false,          // -> true in production, behind a proxy
  "KnownProxies": [],        // -> the proxy's own addresses, e.g. ["10.0.0.5"]
  "ForwardLimit": 1          // one proxy hop; raise only if there are two
}
```

As environment variables (what a container usually gets):

```
ForwardedHeaders__Enabled=true
ForwardedHeaders__KnownProxies__0=10.0.0.5
ForwardedHeaders__ForwardLimit=1
```

🔴 **Why it is not simply on.** `X-Forwarded-For` is a header any client can
set, so honouring it from anybody is a rate limit anybody can reset — a fresh
fake value per request would buy a fresh budget every time. It is honoured
**only** from the addresses listed above, and the API prints which posture it
started in:

```
Forwarded headers OFF — rate limits partition on the immediate peer address.
Forwarded headers ON  — trusting X-Forwarded-For from 1 proxy address(es), 1 hop(s).
```

⚠️ **Enabling it with an empty `KnownProxies` trusts loopback only** — the
defaults are cleared at startup rather than inherited, so "on" without a list
does not quietly start trusting the whole network.

**Measured in 8-0, both ways** (contact form, budget 3/hour):

| posture | four requests, four different `X-Forwarded-For` | reading |
|---|---|---|
| OFF (shipped) | `200 200 200 429` | one bucket for the whole site |
| ON (loopback trusted) | `200 200 200 200` | a bucket each |
| ON, same client four times | `200 200 200 429` | and each bucket still holds three |

The middle row is the fix; the bottom row is the control that shows enabling it
**relocates** the limit rather than removing it.

⚠️ `UseForwardedHeaders` must stay **before** `UseRateLimiter` in
`Program.cs`. Reversed, the address is rewritten after the decision that reads
it, nothing errors, and the limits go on being per-site —
`scripts/verify/forwarded-headers.mjs` asserts the ordering for exactly that
reason.

---

## 6. Troubleshooting

### The app loads but renders nothing, and the console mentions a specifier

**Symptom.** A signed-in app compiles fine, serves fine, and paints a blank
page. The console says something like:

```
Unable to resolve specifier 'jp-shared/ui' imported from http://localhost:4300/
```

or the network tab shows a failed request to `http://localhost:4999/remoteEntry.json`.

**Cause.** `jp-shared` is not running. `jp-shared/ui`, `/core`, `/models` and
`/pages` are **import map entries pointing at :4999**, not files in
`node_modules`. Nothing about the app's own build can tell you this — it builds
perfectly without the remote, because the specifiers are deliberately left
unresolved.

**Fix.**

```powershell
cd D:\Projects\jp-shared ; npm start
```

Confirm <http://localhost:4999/remoteEntry.json> returns JSON listing four
exposes: `ui`, `core`, `models`, `pages`. Then reload the app — no rebuild
needed.

> `jp-public` is exempt. It is not federated and never contacts :4999.

### "Can't find stylesheet to import"

**Symptom.** The build fails, usually naming a component several folders deep:

```
X [ERROR] Can't find stylesheet to import.
  src\app\features\auth\login\login.component.scss  16:1  root stylesheet
```

**Cause.** `jp-shared` is not a sibling of the app. SCSS is shared at **build**
time through `stylePreprocessorOptions.includePaths: ["../jp-shared/src/styles"]`,
so `@use 'variables'` resolves up and across the filesystem. If the repo is
missing, nested one level deeper, or renamed, that path does not exist.

**Fix.** Check the layout:

```powershell
Get-ChildItem D:\Projects -Directory | Select-Object Name
```

`jp-shared` must sit beside the app, not inside it.

> 🔴 **This is the one that bites CI.** A build agent that clones only the app
> repository will fail here every time. Check out `jp-shared` alongside it.


### Angular serves on a random port instead of 4200

**Symptom.** `npm start` reports something like `http://localhost:53749/`, the
app loads, and then every API call fails — usually silently, or as a CORS error
in the browser console. Sign-in appears to do nothing.

**Cause.** Port 4200 was already in use, most often by a dev server left running
in another terminal. Angular's port check behaves differently depending on
whether it is attached to a terminal:

```
not a TTY  ->  error: "Port 4200 is already in use."
a TTY      ->  prompt: "Would you like to use a different port?"
               ...with the default set to YES, and yes means "any free port"
```

So one press of Enter moves the app to an ephemeral port. Because CORS
(`appsettings.json`) and `environment.ts` are both pinned to 4200, the app then
loads but cannot talk to anything.

**Fix.** Already applied: `npm start` runs through `scripts/serve.mjs`, which
sets `NG_FORCE_TTY=0` so the prompt never appears and a busy port is a hard
error instead. If you see that error:

```powershell
# find and stop whatever holds 4200
Get-NetTCPConnection -LocalPort 4200 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
Get-NetTCPConnection -LocalPort 4200 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Running `ng serve` directly still prompts. **The answer is always no** — the fix
is to stop the stale server, not to move to a different port.

Deliberately running a second instance is fine: `npm start -- --port 4201`.

### "Couldn't reach the server" toast on sign-in

**Symptom.** A red toast reading *"Couldn't reach the server. Check your
connection and try again."* The form is not marked invalid and no field shows an
error.

**Cause.** `JP.Sso.Api` is not running. The browser gets HTTP status `0`, which
the client treats as a transport failure rather than a rejected sign-in — which
is why it is a toast and not a form error.

**Fix.**

```powershell
cd D:\Projects\jp-backend\JP.Sso.Api
dotnet run
```

Wait for `Now listening on: http://localhost:5199`, then check
<http://localhost:5199/swagger> loads before retrying.

**If it is running and you still get this**, in order of likelihood:

1. It came up on a different port. Read the console — `launchSettings.json` says
   5199, but a `--urls` argument overrides it.
2. Origin not allowed. The API accepts `http://localhost:4200`, `:4300`,
   `:4400` and `:4500` only (`Cors:AllowedOrigins`). On any other port the app
   loads and every request fails — see the random-port entry below.
3. It failed at startup. Every options block is validated on boot, so a missing
   `Jwt:Key` kills the process immediately with a clear message rather than
   failing later on the first request.

### Other things worth knowing

| Symptom | Cause and fix |
|---|---|
| `Msg 1934 ... QUOTED_IDENTIFIER` | You ran a script without `SET QUOTED_IDENTIFIER ON`. sqlcmd defaults it **off**, SSMS defaults it **on**. Every script sets it itself; if you are running a fragment by hand, set it first |
| SSMS shows no `jp_*` databases | You connected to the default instance. Use **`TARUN\TARUN`** |
| `Globalization Invariant Mode is not supported` | `InvariantGlobalization` got set back to `true`. `Microsoft.Data.SqlClient` refuses to open a connection under it. It must stay `false` in `Directory.Build.props` |
| Build fails with `MSB3027 ... file is locked` | The API is running, or Visual Studio has it open. Stop the process before a clean rebuild |
| Emails never arrive | Expected. SMTP is off in development; messages are written to `backend\JP.Sso.Api\App_Data\mail-drop\*.eml` |
| Sign-in takes ~200 ms | Correct. PBKDF2 at 210,000 iterations runs on **every** attempt, including for an email that does not exist — that is what stops the endpoint from revealing who has an account (decision 2.32) |

---

## 6b. Starting and stopping the whole stack

Seven processes, in an order that matters. Two commands instead.

```powershell
cd D:\Projects\jp-docs
node scripts/start-all.mjs      # everything, in order, with a status table
node scripts/stop-all.mjs       # the other direction
```

| Flag | What it does |
|---|---|
| `--apis` (start) | just JP.Sso.Api and JP.App.Api |
| `--web` (stop) | leaves the two APIs running |

### 🔴 Why the order matters, and why the script kills first

**jp-shared starts first.** The four Angular hosts load `jp-shared/ui` as an
**import map** entry resolved in the browser at runtime — it is not bundled
into them. If `:4999` is not answering when a host page loads, that host is
broken until reloaded, and will not recover on its own. That is the "four
blank tabs in front of a client" failure.

**Whatever is already on a port is killed first.** A stale `ng serve` from a
previous session answers, so everything looks fine — while it serves code from
before your last change. *"It answers" is not "it is yours."*

⚠️ `stop-all` kills by **port**, never by image name: `taskkill /IM node.exe`
would take your editor's language servers with it. It also **verifies**
afterwards, because `taskkill` returns before the socket is released, and "I
stopped it" followed by a port that still answers is how the next start
silently reuses a stale server.

### Expected timings from cold

```
JP.Sso.Api   5199   up in 1s
JP.App.Api   5299   up in 1s
jp-shared    4999   up in 8s
jp-admin     4200   up in 23s
jp-school, jp-teacher, jp-public    ~30-60s each (first Angular compile)
```

A service showing **DOWN** in the table is one whose log in
`jp-docs/.run-logs/` is worth reading — it will present as a broken page
rather than as an error.

⚠️ **Neither script touches SQL Server, LocalDB, or the demo fixture.** If you
set the demo fixture up, tear it down in the same sitting with
`scripts/demo/demo-teardown.sql` — on 2026-10-25 the fixture from the 20
October client demo was still live, which would have failed a full
`run_all.sql` on the priced-public-plan guard.

---

## 7. The regression — one command

This is **the** way to check that the product still works. Not a selection of
suites, not the ones that seem relevant to what you changed: all of them, in
order, with the output kept.

```powershell
cd D:\Projects\jp-docs
node scripts/verify/run.mjs
```

That runs every suite in `scripts/verify/suite-counts.json` — the Node suites
(SQL via sqlcmd, HTTP against both APIs, and Playwright against the real
screens) **and** the seven T-SQL suites under
`jp-backend/database/<db>/99_tests`. Each suite's full output is written to
`jp-docs/.verify-logs/<suite>.log`, pass or fail.

### What it needs running first

| What | Where | Why |
|---|---|---|
| SQL Server | `localhost\TARUN` | every suite |
| JP.Sso.Api | `:5199` | the HTTP and screen suites |
| JP.App.Api | `:5299` | the HTTP and screen suites |
| jp-shared | `:4999` | the screen suites load it over federation |
| jp-admin · jp-school · jp-teacher | `:4200` · `:4300` · `:4400` | the screen suites |
| jp-public | `:4500` | the public-screen suites |
| `local-accounts.md` | `jp-docs/` | the seeded passwords (gitignored, G0) |

### 🔴 Restart the App API first

`public-contract` asserts the contact form's rate limit, which is **3 per hour
per process**. A regression run inside an hour of a previous one fails it on a
correct product. Restarting JP.App.Api resets the counter — and that is a
documented precondition of the suite, not a workaround.

### Reading the result

```
   ok  jobs-consume             27/27
 shrank admin-desk              58/61   3 fewer assertions than the manifest
```

**`shrank` matters as much as `fail`.** A suite whose assertion count drops
while every assertion passes has stopped testing something — a skip branch, a
loop that found nothing, a section that returned early. 6C-0 found
`team-contract` had quietly gone from 49 checks to 48 and nothing was red.

When you have **added** assertions and the suite is green:

```powershell
node scripts/verify/run.mjs <suite> --update
```

Never `--update` to make a drop go away. The diff is meant to be read.

### A single suite

```powershell
node scripts/verify/run.mjs offers invites
```

### 🔴 Why this is the E2E system — G9

G9 asked for an end-to-end layer and stayed open for six phases. The answer
written down in 8A is that **this ecosystem is that layer**, and what was
missing was never the coverage:

- the **SQL** suites prove the procedures, including the refusals and the
  concurrency branches, inside transactions that roll back;
- the **HTTP** suites prove the API, its gates and its error codes, against
  both running APIs;
- the **Playwright** suites drive the real screens in a real browser at 1440
  and 375, assert what is on them, and keep screenshots.

A separate Cypress or Playwright "E2E project" on top of that would re-walk the
same paths through a third harness, and the most likely outcome is two systems
each believed to be covered by the other.

⚠️ **It was not one command until 8A, and nobody could have known.** The seven
T-SQL suites were documented here as seven `sqlcmd` lines to run by hand and
`run.mjs` knew nothing about them, so anyone who ran "the regression" ran 34
suites and believed they had run 41. Putting them in immediately found two
assertions in `001_test_sso_procedures.sql` that had been stale since 7B —
they asserted a permission count of 25 against a catalogue of 26. A test nobody
runs is not a test; it is a note about what used to be true.

### 🔴 And what this command does NOT prove — read before trusting it

It runs against **the database on this machine**, which has been built up
procedure by procedure over nine phases. It does not prove that database can be
**rebuilt**, and in 8A it could not: `run_all.sql` was missing eleven files
from phases 7A, 7B and 8-0, so a fresh instance would have had no public
content tables, no moderation tables and none of those procedures — with every
suite green throughout, because the suites test the database and the database
was right.

`build-manifest` is in the run now and asserts that every `.sql` file on disk
is named by `run_all.sql`. **A full fresh-instance build is a separate
rehearsal** — see section 2 — and belongs in a deployment check, not here.

---

## 7b. 🔴 The fresh-instance rehearsal — does the build still build?

Everything in section 7 runs against **this** database, which has been built up
procedure by procedure over nine phases. That proves the product works. It does
not prove the product can be **created**, and those are different claims.

This rehearsal answers the second one, on a SQL Server that has nothing on it.

```powershell
# LocalDB ships with SQL Server and Visual Studio — a second, empty instance.
sqllocaldb start MSSQLLocalDB

cd D:\Projects\jp-backend
sqlcmd -S "(localdb)\MSSQLLocalDB" -E -b -f 65001 -i database\run_all.sql
```

Expect `BUILD COMPLETE` and every build guard silent. Then check it built the
**same** thing, rather than merely finishing:

```powershell
# object inventory, both instances — the two lists must be identical
$q = "SELECT 'jp_sso' AS Db, type_desc, COUNT(*) N FROM jp_sso.sys.objects
      WHERE is_ms_shipped = 0 AND type IN ('U','P','FN','IF','TF','V','TT')
      GROUP BY type_desc"
sqlcmd -S localhost\TARUN -E -b -h -1 -W -Q $q
sqlcmd -S "(localdb)\MSSQLLocalDB" -E -b -h -1 -W -Q $q
```

And that the fresh database actually works — the seven T-SQL suites run against
it directly, since they roll back and need no fixtures:

```powershell
cd D:\Projects\jp-backend\database
foreach ($f in 'jp_sso\99_tests\001_test_sso_procedures.sql',
               'jp_sso\99_tests\002_test_error_log.sql',
               'jp_sso\99_tests\003_test_menus.sql',
               'jp_mdm\99_tests\001_test_approval_engine.sql',
               'jp_app\99_tests\001_test_school_branch.sql',
               'jp_app\99_tests\002_test_teacher.sql',
               'jp_app\99_tests\003_test_school_team.sql') {
  Write-Host $f
  sqlcmd -S "(localdb)\MSSQLLocalDB" -E -I -b -f 65001 -i $f | Select-String 'TOTAL|passed'
}
```

Clean up when you are done, so a stale copy cannot be mistaken for a current
one:

```powershell
foreach ($db in 'jp_app','jp_mdm','jp_sso') {
  sqlcmd -S "(localdb)\MSSQLLocalDB" -E -b -Q `
    "ALTER DATABASE $db SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $db;"
}
```

### 🔴 What this found the first time it was run, in 8A

Measured, not hypothetical — and none of it was visible from a green regression:

| What | Why no suite could see it |
|---|---|
| **Eleven files missing from `run_all.sql`** — 7A's public content and reads, 7B's moderation tables, log, PULLED status, CMS and reports, 8-0's three analytics procedures, 7B's `ENQUIRY.MANAGE` seed | each phase deployed its own files by hand with `sqlcmd`; the suites test the database, and the database was right |
| **A seed ordering bug** — `008_seed_moderation_desk` ran *after* `005_seed_menus`, whose guard asserts every PermissionCode its menu rows name already exists. The build died: `unknown PermissionCode(s): ENQUIRY.MANAGE` | on a machine where both already exist, order is unobservable |
| **A build guard that could not tell a projection from a filter** — 024's ViewCount guard failed the whole build over 025, which merely *shows* the column to a moderator | 024 was deployed in 7A when 025 did not exist; a guard over `sys.sql_modules` sees the DATABASE, so its verdict depends on what else is deployed |
| **A test with an unstated premise** — `002_test_teacher` borrowed `TOP (1) SchoolId`, which is NULL on a fresh database, so the contact-lock assertion failed in the wrong direction | there has been a school on this machine since 3B |

Three of those four would have surfaced on the client's server, at install time,
with nobody able to say why. Now `build-manifest` is in the regression and
asserts that every `.sql` on disk is in the build — but **only this rehearsal
proves the order**, because deferred name resolution means a procedure compiles
happily against a table that does not exist yet.

⚠️ **A fresh DATABASE is not a fresh MACHINE.** This rehearsal covers the
database. It does not install .NET, Node, the SDKs or the npm dependencies, and
it does not run the bootstrap that seeds the test accounts. A full new-machine
run is section 2 followed by section 7.

---

## 7c. Re-running the Phase 1 checks by hand

These are the individual commands. Section 7 runs all of this and more; keep
these for when you want one thing in isolation.

```powershell
# backend — expect 0 warnings, 0 errors
cd D:\Projects\jp-backend ; dotnet build JP.sln

# database — expect 73, 17 and 31 assertions, all passing
# (these three, and the four others, are in the runner since 8A — section 7)
cd D:\Projects\jp-backend\database
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\001_test_sso_procedures.sql
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\002_test_error_log.sql
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\003_test_menus.sql

# frontend — expect a clean bundle from all five
# 🔴 stop every dev server first: a production build replaces the development
#    copy of @angular/core in the shared federation cache (see 3.5)
foreach ($p in 'jp-shared','jp-admin','jp-school','jp-teacher','jp-public') {
  Write-Host $p; Push-Location D:\Projects\$p; npx ng build; Pop-Location
}
```

Every test suite runs inside a transaction that is always rolled back, so they
are safe against your working database and leave nothing behind.

`-I` is required: it turns `QUOTED_IDENTIFIER` on for the session.

---

## 8. Where things are

```
D:\Projects\
├── jp-docs\        PROJECT_MEMORY.md, HOW_TO_RUN.md, DB_TABLE_STRUCTURE.md,
│                   design-screens/, and the bootstrap script
│
├── jp-shared\      :4999  the Module Federation REMOTE — start it first
│   ├── src/styles/       13 SCSS partials — shared at BUILD time
│   ├── src/ui/           17 ui-* components + the app and auth shells
│   ├── src/core/         services, guards, interceptors, models, shared pages
│   └── src/entries/      ui.ts · core.ts · models.ts · pages.ts
│                         the four exposed barrels. Nothing else is reachable.
│
├── jp-admin\       :4200  host. Phase 2E lands here
├── jp-school\      :4300  host. Phase 2F
├── jp-teacher\     :4400  host
├── jp-public\      :4500  standalone SSR marketing site — NOT federated
│
└── jp-backend\
    ├── JP.Core/            envelope, constants, enums, exceptions
    ├── JP.Domain/          request and response contracts
    ├── JP.Infrastructure/  Dapper, PBKDF2, JWT, SMTP, middleware, filters
    ├── JP.Sso.Api/         :5199
    ├── JP.App.Api/         :5299
    ├── JP.Tools.SeedAdmin/ creates the first admin
    └── database/           20 tables · 32 procedures · 4 functions · 71 indexes
                            99_tests/ — 121 assertions across 3 suites
```

Each of the seven is its own git repository. `jp-docs` is cloned beside the
others and is never copied into them — one file, one truth.
