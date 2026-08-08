# How to run the Teacher Recruitment Portal

Everything needed to get this running from a clean machine, and an honest
statement of what is actually built.

**Status: Phase 1 complete** — 1A (jp_sso schema) · 1B (stored procedures) ·
1C (`JP.Sso.Api`) · 1D (Angular auth screens + design system).

> 🔴 **Read [What is real and what is a mockup](#-what-is-real-and-what-is-a-mockup)
> before showing this to anyone.** Two screens are populated from a hardcoded
> file, not from a database, and they are the two that look the most finished.

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

### 2.1 Build the databases

From the **repository root**:

```powershell
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

### 2.2 Set the JWT signing key — on BOTH APIs

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
cd backend\JP.Sso.Api
dotnet user-secrets set "Jwt:Key" "$key"

cd ..\JP.App.Api
dotnet user-secrets set "Jwt:Key" "$key"
```

Confirm they match:

```powershell
cd backend\JP.Sso.Api ; dotnet user-secrets list
cd ..\JP.App.Api      ; dotnet user-secrets list
```

### 2.3 Create the first administrator

There is **no admin row in any seed script**, on purpose: a password hash
committed to a `.sql` file is a credential shared by every clone, every branch
and every backup, forever. The hash is derived on your machine instead.

```powershell
cd backend\JP.Tools.SeedAdmin
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

### 2.4 Install the frontend dependencies

```powershell
cd jp-docs ; npm run bootstrap   # clones, installs and links all seven
```

---

## 3. The frontend — seven repositories

Everything lives as **siblings** under `D:\Projects\`. Nothing is nested.

```
D:\Projects\
├── jp-docs\      ← this file. Clone it beside every other repo
├── jp-shared\    @tarun1515/jp-shared — the design system and core
├── jp-admin\     :4200
├── jp-school\    :4300
├── jp-teacher\   :4400
├── jp-public\    :4500
└── jp-backend\   both APIs + all three databases
```

New machine:

```bash
cd jp-docs
npm run bootstrap        # clones the lot, installs, links shared
```

It stops short of the things that need a human — the GitHub token, SQL Server,
and the JWT user-secrets — and prints those as a checklist at the end.

### 3.1 Ports

| Project | Port | Command |
|---|---|---|
| `jp-admin` | **4200** | `cd jp-admin ; npm start` |
| `jp-school` | **4300** | `cd jp-school ; npm start` |
| `jp-teacher` | **4400** | `cd jp-teacher ; npm start` |
| `jp-public` | **4500** | `cd jp-public ; npm start` |
| `JP.Sso.Api` | **5199** | `cd jp-backend\JP.Sso.Api ; dotnet run` |
| `JP.App.Api` | **5299** | `cd jp-backend\JP.App.Api ; dotnet run` |

For most work you need **`JP.Sso.Api` plus whichever app you are on**.

### 3.2 🔴 The two modes — link or publish

Publishing `jp-shared` for every change during design work is unworkable, so
there are two ways an app can consume it. **Know which one you are in.**

**DEVELOPMENT — linked.** The default while building anything. The app points at
the sibling working copy, so a change in `jp-shared` shows up immediately with
no version bump and no publish.

```bash
cd jp-shared && npm run link      # builds, then npm link from dist/jp-shared
cd ../jp-admin && npm run link:shared
```

**RELEASE — published.** What CI and other machines use.

```bash
# in jp-shared
npm run version:bump              # package.json AND src/lib/version.ts together
# write the CHANGELOG entry, then
git commit -am "release: 1.1.0" && git tag v1.1.0 && git push --follow-tags

# in each app
npm run update:shared
```

**Which am I in?**

```bash
cd jp-docs && npm run check-versions
```

```
  @tarun1515/jp-shared
    source        1.0.0
    built         1.0.0

    ok    jp-admin    1.0.0     linked     follows jp-shared (dev mode)
    ok    jp-school   1.0.0     linked     follows jp-shared (dev mode)
    ok    jp-teacher  1.0.0     linked     follows jp-shared (dev mode)
    ok    jp-public   1.0.0     linked     follows jp-shared (dev mode)
```

`linked` follows the sibling working copy and cannot drift. `installed` is frozen
at a published version and can. **Run this after every change to `jp-shared`** —
four apps install it independently, and an app you forgot keeps running the old
copy while building perfectly cleanly.

### 3.3 🔴 "NG0203 … token injection failed" — the one you will hit

**Symptom.** A linked app compiles fine and then renders nothing. The console
shows:

```
NG0203: The `InjectionToken JP_APP_IDENTITY` token injection failed.
`inject()` function must be called from an injection context such as a
constructor, a factory function, a field initializer, ...
```

**It is not an injection-context problem.** The message points at dependency
injection and the cause is module resolution, which is why it costs people an
afternoon.

**Cause.** A linked package is a symlink. By default the bundler resolves the
symlink to its real path, so imports inside the library are resolved from
`jp-shared/node_modules` — which has its own `@angular/core`. The app now has
**two copies of Angular**, each with its own `InjectionToken` class, so the token
the app provides is not the token the library asks for.

**Fix.** In the app's `angular.json`, under `architect.build.options`:

```json
"preserveSymlinks": true
```

All four apps already have it. **Do not remove it.** If you scaffold a new app
from the Angular CLI, add it before linking.

**How to confirm this is what you are looking at:**

```bash
ls jp-shared/node_modules/@angular/core     # exists -> the second copy
```

### 3.4 GitHub Packages token

Only needed to install the **published** package. A linked setup does not touch
the registry at all.

```bash
cp .npmrc.example .npmrc          # in each app; .npmrc is gitignored
setx GITHUB_TOKEN "ghp_..."       # needs read:packages; reopen the shell
```

> ⚠️ **A 404 for `@tarun1515/jp-shared` usually means 401.** GitHub Packages
> answers unauthenticated requests for a private package with "not found" rather
> than "not authorised", so a missing token looks like a missing package.

### 3.5 Each app takes only its own account type

All three signed-in apps authenticate against the same SSO API, so a school owner
**can** sign in successfully on the teacher app — valid token, wrong app.

When that happens the app signs them straight back out and says where to go:

> **That is a school account.** Sign in at localhost:4300

That is working as designed, not a bug. The check runs after login and again at
bootstrap, because a token can also arrive from storage. It is wayfinding, not
security — the token stays valid and the server is what enforces access.

Tokens are stored per app (`jp.admin.accessToken`, `jp.school.accessToken`), so
two apps on one origin never read each other's session.

---

## 4. Test accounts

> ⚠️ These exist **only in your local `jp_sso`**. They are development fixtures.
> None of them may ever be created in a deployed environment — `JP.Tools.SeedAdmin`
> is the only sanctioned way to create an administrator anywhere real.
> If this file is ever shared outside the team, strip this section first.

| Email | Password | Type | Role | What it demonstrates |
|---|---|---|---|---|
| `superadmin@teacherportal.local` | `RyaBs*-L?G9*-xTKM$R4` | Admin | `SUPER_ADMIN` | Full admin sidebar — 12 menus including both nested groups (Verification, Moderation). Approving a pending school |
| `principal@greenwood.edu.in` | `Greenwood#2027!` | School | `SCHOOL_OWNER` | The complete school sidebar (9 items) and both school screens. Its password was changed mid-flow, which is why it is not `#2026!` |
| `hr.lead@greenwood.edu.in` | `HrLead#2026!` | School | `HR` | **Permission filtering.** Same organisation as the principal, but 7 menus instead of 9 — no Branches, no Team. Sign in as both back to back; that difference is `USP_GetUserMenus` doing its job |
| `head@stmarys.edu.in` | `StMarys#2026!` | School | `SCHOOL_OWNER` | **Tenant isolation.** A second organisation. Neither school can see the other's users |
| `tarun@yopmail.com` | *(yours)* | Teacher | `TEACHER` | The teacher portal — 8 menus, no admin or school items |

**There is currently no PENDING school**, so the account-status screen is not
reachable by simply signing in. Two ways to see it:

- Register a new school at `/auth/register` — it lands there immediately, or
- Open `http://localhost:4200/account/status?code=ACCOUNT_PENDING` while signed
  in as any account. The `code` parameter also accepts
  `ACCOUNT_RESUBMIT_REQUIRED`, `ACCOUNT_REJECTED`, `ACCOUNT_SUSPENDED` and
  `ACCOUNT_LOCKED`, each of which renders different copy and a different state.

---

## 5. The happy path, click by click

Start `JP.Sso.Api` and `portal`, then:

1. **Register a school** — <http://localhost:4200/auth/register>, leave the
   toggle on *A school*. Any email, any 10-digit mobile starting 6–9, a password
   of 8+ characters.
2. You land on **account status**, pending verification. Note the roll marked
   to *In review* and the three "what happens next" steps.
3. **Sign out**, then **sign in as `superadmin@teacherportal.local`.**
   The sidebar is now the admin console — nested Verification and Moderation
   groups appear, because the menu comes from `GET /api/menus` and that account
   holds different permissions.
4. Approve the school. There is **no admin UI for this yet**, so use Swagger:
   `PUT /api/users/{userUid}/status` with `{ "newStatusId": 2, "rowVersion": <current>, "remarks": "Verified" }`.
   Get the `userUid` and `rowVersion` from `GET /api/users?search=<email>`.
5. **Sign in as the school again.** It is now Active, the sidebar has all 9
   school items, and `SCHOOL_OWNER` was granted automatically at approval.
6. Open **Dashboard** and **Applicants**. ⚠️ Everything on these two screens is
   hardcoded — see the next section.
7. **Change your password** via Swagger `POST /api/auth/change-password`, then
   try to refresh with an old refresh token: it returns 401 and the entire token
   chain is revoked.
8. **Forgot password** — <http://localhost:4200/auth/forgot-password>. SMTP is
   disabled in development, so the email is written to
   `backend\JP.Sso.Api\App_Data\mail-drop\*.eml`. Open the newest file, copy the
   `token=` value out of the reset link, and visit
   `http://localhost:4200/auth/reset-password?token=<token>`.

---

## 🔴 What is real and what is a mockup

This is the part that matters when someone is looking over your shoulder.

### Fully wired to the API

| Screen | Route | Calls |
|---|---|---|
| Sign in | `/auth/login` | `POST /api/auth/login` |
| Create account | `/auth/register` | `POST /api/auth/register/school` or `/teacher`, then `login` |
| Forgot password | `/auth/forgot-password` | `POST /api/auth/forgot-password` |
| Choose a new password | `/auth/reset-password?token=` | `POST /api/auth/reset-password` |
| Set password from invite | `/auth/accept-invite?token=` | `POST /api/auth/set-password-from-invite` |
| Enter the code | `/account/verify-otp` | `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` |
| Sign out | *(header)* | `POST /api/auth/logout` |
| **The sidebar, everywhere** | | `GET /api/menus` — filtered server-side by user type and permission |

Sign-in has been verified end to end in the browser for admin, school and
teacher accounts.

### 🟡 Real page, presentational data

**Account status** (`/account/status`). The routing, the guard and the sign-out
button are real. But **the verification state it displays is not fetched** — the
content is chosen from the `?code=` query parameter and the roll's position is a
constant in the component. It will show "In review" for an account that was
approved an hour ago. Treat it as a design of the screen, not a live status
page.

### 🔴 Static mockups — hardcoded data, no API call

| Screen | Route | Reality |
|---|---|---|
| **School dashboard** | `/school/dashboard` | Every figure — 50 applicants, the funnel, Latest applications, Open jobs — is computed from `features/school/applicants/applicant.data.ts`. **No HTTP call is made.** |
| **Applicants list** | `/school/applicants` | All 50 rows come from the same file. Search, filters, sorting and paging run in the browser over that array |

Both exist because a dense screen cannot be designed against three rows of
placeholder text — the direction had to be proven at realistic volume. They are
accurate as *design*, and completely fictional as *data*.

`applicant.data.ts` carries this warning at the top of the file and is deleted
the moment `JP.App.Api` exposes the real endpoint. Nothing else about those
screens changes when it does.

### ⬜ Not built — placeholder page

**26 routes** currently resolve to the shared "coming soon" component: every
teacher screen, the rest of the school screens (profile, branches, jobs, offers,
team, notifications), and the entire admin console (verification queues,
moderation, users, masters, CMS, reports, settings).

They are routed and appear in the sidebar deliberately — the navigation
structure is the Phase 1 deliverable and the screens land per phase.

### Built and tested, but no UI

`JP.Sso.Api` exposes **21 route methods** (20 business endpoints plus
`/api/health`). The portal calls **11** of them. The rest work and are covered by
tests, but are only reachable through Swagger:

- `GET /api/users`, `POST /api/users/invite`, `PUT /api/users/{uid}/status`, `POST /api/users/{uid}/unlock`
- `GET /api/roles`, `POST /api/roles`, `GET /api/permissions`
- `GET /api/auth/me` — defined in `AuthService` but not called by any component yet
- `GET /api/health`

Three routes are reachable only by a link from an email or by typing the URL —
nothing in the UI navigates to them: `/auth/reset-password`,
`/auth/accept-invite`, `/account/verify-otp`.

---

## 6. Troubleshooting

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
cd backend\JP.Sso.Api
dotnet run
```

Wait for `Now listening on: http://localhost:5199`, then check
<http://localhost:5199/swagger> loads before retrying.

**If it is running and you still get this**, in order of likelihood:

1. It came up on a different port. Read the console — `launchSettings.json` says
   5199, but a `--urls` argument overrides it.
2. Origin not allowed. The API only accepts `http://localhost:4200` and
   `:4300` (`Cors:AllowedOrigins`). If the portal is on any other port, see the
   previous section.
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
cd jp-backend ; dotnet build JP.sln

# database — expect 73, 17 and 31 assertions, all passing
cd jp-backenddatabase
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\001_test_sso_procedures.sql
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\002_test_error_log.sql
sqlcmd -S localhost\TARUN -d jp_sso -E -b -f 65001 -I -i jp_sso\99_tests\003_test_menus.sql

# frontend — expect a clean bundle
cd jp-admin ; npm run build:prod    # and jp-school, jp-teacher, jp-public
```

Every test suite runs inside a transaction that is always rolled back, so they
are safe against your working database and leave nothing behind.

`-I` is required: it turns `QUOTED_IDENTIFIER` on for the session.

---

## 8. Where things are

```
D:\Projects\
├── jp-docs\        PROJECT_MEMORY.md, HOW_TO_RUN.md, DB_TABLE_STRUCTURE.md,
│                   design-screens/, and the check-versions + bootstrap scripts
│
├── jp-shared\      @tarun1515/jp-shared — published to GitHub Packages
│   ├── src/styles/       13 SCSS partials, shipped as package assets
│   ├── src/ui/          17 ui-* components + the app and auth shells
│   ├── src/core/        services, guards, interceptors, models, shared pages
│   └── src/public-api.ts  THE only entry point
│
├── jp-admin\      :4200  login, forgot/reset, admin shell. Phase 2E lands here
├── jp-school\     :4300  login, signup, OTP, invite, account status. Phase 2F
├── jp-teacher\    :4400  login, signup, OTP, teacher shell
├── jp-public\     :4500  SSR marketing site, no login, its own lighter partials
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
