# How to run the Teacher Recruitment Portal

Everything needed to get this running from a clean machine, and an honest
statement of what is actually built.

**Status: Phase 3 complete** — three databases, both APIs, and the school and
teacher portals running on real data.

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
| **The public site** — home, how it works, about, FAQ, contact, legal | `jp-public` :4500 — **nothing else**. No remote, no API |
| **The `/continue` chooser flow** | `jp-public` :4500 **plus whichever target app you are checking** — `jp-school` :4300 or `jp-teacher` :4400, and `jp-shared` :4999 for that app to render |
| **Master data / business endpoints** (Phase 2+) | the above **plus** `JP.App.Api` :5299 |
| **Database or SP work** | none of them — `sqlcmd` only |

> The chooser row is the one exception to "jp-public needs nothing else". The
> page itself renders standalone, but following a card into `/auth/login` or
> `/auth/register` crosses into another app — and that app needs the remote.
> This is a legitimate reason to have `jp-public` running during Phase 1 work.

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

All seven static pages are **prerendered** at build time; only `/continue` is
server-rendered, because it varies by query parameter. Each route carries its
own title, meta description, Open Graph tags and canonical URL, and
`robots.txt` and `sitemap.xml` ship with the build. Lighthouse scores SEO 100
and accessibility 100 on every page — keep it that way.

⚠️ Job search and job detail are **not** built. They need Phase 4 data, and the
homepage carries a marked placeholder where they will go rather than mock job
cards. "Find jobs" is deliberately absent from the header for the same reason.

⚠️ The contact form validates but has **no endpoint** until Phase 7. It tells
the visitor so and offers a prefilled `mailto:`. Do not replace that with a
success message before there is somewhere for the submission to go.

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
| `superadmin@teacherportal.local` | see `local-accounts.md` | Admin | `SUPER_ADMIN` | Full admin sidebar — 12 menus including both nested groups (Verification, Moderation). Approving a pending school |
| `principal@greenwood.edu.in` | see `local-accounts.md` | School | `SCHOOL_OWNER` | The complete school sidebar (8 items) and every school screen: dashboard, profile, campuses, team |
| `hr.lead@greenwood.edu.in` | see `local-accounts.md` | School | `HR` | **Permission filtering.** Same organisation as the principal, but fewer menus — no Campuses, no Team. Sign in as both back to back; that difference is `USP_GetUserMenus` doing its job |
| `head@stmarys.edu.in` | see `local-accounts.md` | School | `SCHOOL_OWNER` | **Tenant isolation.** A second organisation, with its own school (St Mary's Convent, Bandra), its own head office and its own plan. Neither school can see the other's branches, users or applicants |
| `tarun@yopmail.com` | *(yours)* | Teacher | `TEACHER` | The teacher portal — 8 menus, no admin or school items |

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

   ⚠️ **Applicants is no longer routed.** It was a fixture-driven mockup; the
   component is kept as the design for Phase 5 under
   `jp-school/src/app/_design-reference/`, and its menu row is hidden until
   applications exist.

7. **Sign in as a teacher** on **<http://localhost:4400>** and open **Dashboard**
   and **My profile**. The dashboard shows the completeness meter — which names
   the single most valuable missing thing and never prints "0%" at somebody who
   has just started — plus their resume status and plan.
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
`applicant.data.ts`. The dashboard now fetches real data. The applicants
component is **no longer routed**: it lives in
`jp-school/src/app/_design-reference/applicants/` as the design Phase 5 builds
from, its menu row is hidden, and nothing in the app imports it — verified by
grep and by the absence of its fixture strings from every built chunk.

⚠️ If you are demonstrating this product, there is no longer a screen you have
to talk around. There are areas that say "not yet", which is a different thing.

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

Every one of these has been exercised end to end against running APIs — see
`scripts/verify/` for the checks and `screenshots/` for what they look like.

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

## 7. Re-running the Phase 1 checks

```powershell
# backend — expect 0 warnings, 0 errors
cd D:\Projects\jp-backend ; dotnet build JP.sln

# database — expect 73, 17 and 31 assertions, all passing
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
