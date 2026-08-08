# TEACHER RECRUITMENT PORTAL — PROJECT MEMORY

> **Ye file har kaam ke baad update hogi.** Har naye chat/session mein sabse pehle ye file padho.
> Last updated: 2026-08-08 | Current Phase: **0 — Foundation ✅ COMPLETE + review fixes 1–6 applied (Phase 1A approval pending)**

---

## 1. PROJECT IDENTITY

| | |
|---|---|
| Product | Teacher Recruitment Portal (School ↔ Teacher hiring platform) |
| Owner | Tarun Bhardwaj |
| Stack | SQL Server 2019 + .NET 8 (Dapper) + Angular 22 |
| Databases | `jp_sso`, `jp_mdm`, `jp_app` |
| Start date | 2026-08-11 |
| Target go-live | 2027-01-15 |

### Local environment (verified 2026-08-08)
| | |
|---|---|
| SQL Server | `localhost\TARUN` — **15.0.2180.2, SQL Server 2019 Developer Edition** |
| SQL auth mode | **Windows Auth** (`Integrated Security=true`) for local dev |
| .NET SDK | 8.0.423 |
| Node / npm | v24.16.0 / 11.13.0 |
| `sqlcmd` | `C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE` |
| ⚠️ `git` | **NOT on PATH.** Kuch bhi commit nahi ho sakta jab tak install na ho. |

---

## 2. ARCHITECTURE DECISIONS (LOCKED — inko change mat karo bina discussion ke)

### 2.1 Database split
- **`jp_sso`** — Identity only. Users, credentials, tokens, OTP, login attempts, lockouts, roles, permissions.
  SSO ko School/Teacher ka kuch pata nahi. Sirf `UserTypeId` aur `OrganizationUid` (opaque GUID).
- **`jp_mdm`** — Saare master data (`m_mdm_*`) + approval engine + registration payload + documents + payments.
- **`jp_app`** — Business data. Schools, branches, teachers, jobs, applications, notifications, reports, CMS.

### 2.2 Cross-DB rule
- **Physical FK teen DB ke beech NAHI.** Reference hamesha `uniqueidentifier` Uid se (`UserUid`, `SchoolUid`, `TeacherUid`).
- Masters ki copy mat banao — `CREATE SYNONYM` se `jp_mdm` ko point karo.
- Integrity SP level pe enforce karo (`IF NOT EXISTS ... RETURN error`).
- Cross-DB write kabhi ek SP se mat karo — **API layer se orchestrate karo**, har DB apne transaction mein.

### 2.3 Naming convention
- Masters: `m_<db>_<name>` → `m_mdm_country`, `m_sso_user_types`
- Transactional: `t_<db>_<name>` → `t_sso_users`, `t_app_jobs`
- Stored procs: `USP_<Action><Entity>` , naya version = `_V1` suffix
- Sab lowercase table names, PascalCase columns.
- **Canonical shape `database/_TEMPLATE_table.sql` mein hai. Har nayi table wahin se cut karo.**

### 2.4 Standard columns (har table pe)
```
Is_Active tinyint NOT NULL DEFAULT 1
Is_Deleted tinyint NOT NULL DEFAULT 0
CreatedOn datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
CreatedBy bigint NULL
ModifiedOn datetime2 NULL
ModifiedBy bigint NULL
RowVersion int NOT NULL DEFAULT 1     -- sirf headers pe
```
Master tables mein additionally: `Code varchar(30)`, `Name nvarchar(150)`, `DisplayOrder int`.

**Hard delete kabhi nahi.** Sab soft delete.

### 2.5 API structure
- **Do API projects:**
  - `JP.Sso.Api` — auth, users, roles, permissions (standalone, alag deploy ho sake)
  - `JP.App.Api` — masters + approval + business (MDM aur App dono ka access)
- Dapper + `DynamicParameters`, kabhi raw string concat nahi
- Har response `Response<T>` envelope mein: `{ status, code, message, data, totalRecords }`
- Sab data access **stored procedures se** — inline SQL nahi
- Layers: `Controller → Service → Repository → SP`

### 2.6 Security decisions
- Password: **PBKDF2-HMAC-SHA256**, `varbinary(64)` hash + `varbinary(32)` separate salt, 210000 iterations
- Algorithm ID aur iteration count DB mein store — future mein badalne pe purane users na toote
- Comparison: `CryptographicOperations.FixedTimeEquals` — `==` kabhi nahi
- Password history: `t_sso_user_credentials` ke `IsCurrent=0` rows se, last 3 reuse block
- Tokens DB mein hamesha **hashed** — plain kabhi nahi
- JWT claims: `uid`, `uuid`, `utype`, `status`, `orgUid`, `roles[]`, `perms[]`
- Refresh token rotation with `ReplacedByTokenId` chain
- Har list/detail endpoint pe **IDOR check** — `OrganizationUid` JWT se lo, request body se kabhi nahi

### 2.7 No hardcoding rule
- Har dropdown value master table se
- Generic master endpoint: `GET /api/masters/{masterKey}` — server-side whitelist dictionary
- Angular `MasterService` in-memory cache, app load pe bulk fetch
- Many-to-many kabhi comma-separated nahi — hamesha bridge table
- Status flows SP ke CASE mein (decided — alag transition table nahi)

### 2.8 Approval engine
- iProfit ka **table shape** follow kar rahe hain, logic naya
- Multi-level capable hai, par MVP mein sirf **1 level** config hoga (school verification)
- Actions: `1=Approve, 2=Reject, 3=RequestResubmit`
- `t_mdm_request_approvals` **append-only** — kabhi UPDATE nahi
- Approve pe: MDM status update → API layer se SSO ko activate call → API layer se App ko profile-create call

### 2.9 Approval gate policy
| User type | Signup ke baad | Login | Approve ke baad |
|---|---|---|---|
| **Admin** | Seed script se banega, signup endpoint nahi | Active | — |
| **School** | `StatusId=1 Pending` — **HARD GATE** | Allowed, par sirf pending screen | `StatusId=2 Active`, `SCHOOL_OWNER` role, profile create |
| **Teacher** | `StatusId=2 Active` turant — **SOFT verification** | Full access | `IsVerified=1` badge milega |

⚠️ Teacher soft-gate ka decision spec point 5 + 9 ke basis pe. **Client se confirm karna baaki hai.**

- Pending school ko login karne do (block mat karo) — warna documents dobara upload nahi kar payega
- API filter `[RequireActiveAccount]` → `status != 2` pe `403 { code: "ACCOUNT_PENDING" }`
- Exempt routes: `/auth/*`, `/registration/status`, `/documents/upload`

### 2.10 School structure — Model B (org + branches)
- Har school ka **kam se kam ek branch** hoga. Single school = auto-created HO branch.
- `BranchId` **kabhi NULL nahi** — Jobs, Applications, Offers sab pe mandatory
- `GroupType` sirf **UI flag** hai (1=Single → branch menu hide, 2=Group → visible). Data model same.
- Single → Group switch = zero migration
- School users ka scope: `RoleInSchool=1 (Owner)` → implicit all branches; baaki → `t_app_school_user_branches` se
- HR **owner-invite-only** (self-signup nahi)

---

### 🆕 2.11 SQL Server 2019 only (LOCKED — client ne 2026-08-08 ko confirm kiya)
Target `localhost\TARUN` = **15.0.2180.2 (SQL Server 2019)**.
Teeno database ka `COMPATIBILITY_LEVEL = 150` **explicitly pin** kiya hai, taaki 2022+ syntax build time pe hi fail ho jaye, production mein nahi.

**Ye kabhi use mat karo (2022+ only):**
`GREATEST` · `LEAST` · `DATETRUNC` · `DATE_BUCKET` · `IS [NOT] DISTINCT FROM` · `GENERATE_SERIES` ·
`JSON_OBJECT` · `JSON_ARRAY` · `JSON_PATH_EXISTS` · `STRING_SPLIT(..., ordinal)` ·
`TRIM(chars FROM x)` / `LTRIM(x, chars)` · `APPROX_PERCENTILE_*` · `WINDOW` clause

**Ye safe hain:** `STRING_AGG` (2017) · `TRIM(x)` (2017) · `CONCAT_WS` (2017) · `TRANSLATE` (2017) · `OPENJSON`/`JSON_VALUE`/`FOR JSON` (2016) · `OFFSET-FETCH` (2012)

Poori list `database/_TEMPLATE_table.sql` ke header mein bhi likhi hai.

### 🆕 2.12 `Response<T>` envelope mein `code` field add hua
Locked shape ab: `{ status, code, message, data, totalRecords, errors }`

**Kyun:** `[RequireActiveAccount]` ko `403 { code: "ACCOUNT_PENDING" }` return karna hai, aur Angular interceptor ko machine-readable code pe branch karna padta hai — `message` pe nahi, kyunki wo display text hai aur kabhi bhi badal sakta hai.
- `code` success pe hamesha `null`
- `errors` sirf validation failure pe (field name → messages)
- Client **sirf `code` pe branch karega**, `message` pe kabhi nahi

### 🆕 2.13 Static factory ka naam `ApiResponse` hai, `Response` nahi
`Response<T>` class ka naam wahi hai (locked), par usko banane wali static factory ka naam **`ApiResponse`** rakha.

**Kyun:** ASP.NET Core ke `ControllerBase` mein pehle se ek `Response` property hai (`HttpResponse`). `Response` naam ki static class har controller ke andar shadow ho jaati — aur `Response.Success(...)` theek wahin compile fail hota jahan sabse zyada use hona hai. Build ne ye pakda tha.

Use: `return Ok(ApiResponse.Success(dto));` · `ApiResponse.Paged(list, total)` · `ApiResponse.Failure(msg, code)` · `ApiResponse.ValidationFailure(errors)`

### 🆕 2.14 Angular 22.1.3, zoneless + signals
Client ne 22 choose kiya (Node 24 pe Angular 17/18/19 officially chalte hi nahi).
- **Zoneless change detection** — `zone.js` dependency hi nahi hai
- State ke liye **signals**, har component `ChangeDetectionStrategy.OnPush`
- **Functional** interceptors (`HttpInterceptorFn`) aur guards (`CanActivateFn`) — class-based nahi
- Sab standalone components, koi NgModule nahi

⚠️ **`D:\angular.json` naam ki ek orphan file drive root pe padi hai (May 2024 ki).** Angular CLI workspace dhoondhte hue upar tak jaata hai aur usko dekh ke poore D: drive pe `ng new` refuse kar deta hai. Abhi workaround use kiya (C: drive pe generate karke move). **Tarun ko wo file delete karni chahiye.**

### 🆕 2.15 Har API sirf apni connection strings configure karta hai
- `JP.Sso.Api` → sirf `Sso`
- `JP.App.Api` → sirf `Mdm` + `App`

`DbConnectionFactory` sirf wahi connections build karta hai jo configured hain. Missing DB maangne pe clear error milta hai jismein missing config key ka naam hota hai.

**Kyun:** decision 2.5 kehta hai `JP.Sso.Api` standalone deploy hona chahiye. Usko `jp_mdm`/`jp_app` ke credentials rakhne pe majboor karna us separation ko todta.

### 🆕 2.16 Secrets kabhi appsettings.json mein nahi
| Secret | Kahan se aata hai |
|---|---|
| SQL password | `SQL_PASSWORD` env var (sirf SQL auth pe; Windows auth pe zaroorat nahi) |
| SMTP password | `SMTP_PASSWORD` env var |
| JWT signing key | `dotnet user-secrets set "Jwt:Key" "<64+ chars>"` — **dono API mein same** |

Sab options `ValidateOnStart` se validate hote hain — galat config pe app **boot hi nahi hoga**, pehli request pe fail nahi karega.

### 🆕 2.17 Fixed ports (CORS aur environment files inhi pe wired hain)
| App | Port |
|---|---|
| `JP.Sso.Api` | http://localhost:5199 (https 7199) |
| `JP.App.Api` | http://localhost:5299 (https 7299) |
| Angular `portal` | http://localhost:4200 |
| Angular `public-site` | http://localhost:4300 |

#### ⚠️ Ports ab DECLARE hote hain, default pe nahi chhode jaate (2026-08-08)

Dono `angular.json` mein pehle `serve.options` tha hi nahi — dono CLI ke default 4200 pe chal rahe the. Matlab **`public-site` bhi 4200 maangta**, jo portal se takraata. Ab explicitly pinned: portal `4200`, public-site `4300`.

#### 🔴 Pin karna zaroori hai, par KAAFI NAHI — asli gotcha

`@angular/build` ka `checkPort` (`utils/check-port.js`) busy port pe do alag kaam karta hai:

```
not a TTY  ->  reject: "Port 4200 is already in use."
a TTY      ->  prompt: "Would you like to use a different port?"
               ...default: TRUE, aur haan pe checkPort(0) → OS koi bhi free port de deta hai
```

To asli terminal mein: 4200 pe koi purana server pada ho + ek Enter = app chup-chaap **ephemeral port** pe serve ho jaati hai (ek baar 53749 pe hui thi).

Ye cosmetic problem **nahi** hai. Is port pe do cheezein wired hain — API ka CORS allow-list (`appsettings.json`) aur `environment.ts`. Kisi aur port pe app **load ho jaati hai par har API call CORS pe fail hoti hai** — yaani "kuch nahi ho raha", jo start hi na hone se kahin zyada confusing failure hai.

Isliye `npm start` ab `scripts/serve.mjs` se jaata hai, jo `NG_FORCE_TTY=0` set karta hai → prompt aata hi nahi, busy port ek saaf error hai. Wo env var `@angular/build` mein sirf **do** jagah padha jaata hai (yehi port check, aur unit-test ka watch default), to iska koi side effect nahi — colour output waise hi rehta hai.

`ng serve` seedha chalao to prompt phir bhi aayega. **Jawab hamesha "no" hai** — sahi fix purana server band karna hai, doosra port lena nahi.

> Bonus: `npm start -- --port 4201` waise hi kaam karta hai, jab jaan-boojh ke doosra instance chahiye.

### 🆕 2.18 Angular interceptor order — ye order badalna mat
```
provideHttpClient(withInterceptors([loaderInterceptor, errorInterceptor, authInterceptor]))

request:   loader → error → auth → server
response:  loader ← error ← auth ← server
```
`auth` ko 401 sabse pehle milta hai, wo chup-chaap token refresh karke retry karta hai. Sirf wo 401 jo recover nahi ho paaya `error` tak pahunchta hai.
**Agar `error` ko `auth` se pehle rakha, to har successful refresh pe user ko "session expired" toast dikhega.**

Refresh concurrency: ek hi refresh in-flight rehta hai (`shareReplay`), warna 5 parallel request 5 refresh trigger karte aur server ke rotation ki wajah se 4 revoked token bhejte → user logout ho jaata.

### 🆕 2.19 Token storage = localStorage
Tabs aur reloads ke beech session chahiye, isliye `localStorage`.
**Trade-off:** XSS hone pe token padha ja sakta hai. Isliye strict template binding, aur `bypassSecurityTrust*` bina thos wajah ke kabhi nahi.
Sab access `TokenStorageService` se hi — direct `localStorage` kahin nahi.

### 🆕 2.20 Build discipline
- **Central Package Management** — saare NuGet versions `backend/Directory.Packages.props` mein, ek jagah. `.csproj` mein version attribute nahi.
- **`TreatWarningsAsErrors=true`** — pehle hi din kaam aaya: MailKit 4.8.0 mein known vulnerability (GHSA-9j88-vvj5-vhgr) pakdi, **4.17.0 pe upgrade kiya. Downgrade mat karna.**
- `AnalysisLevel=latest` (`latest-recommended` nahi — warnings-as-errors ke saath wo style opinions ko build failure bana deta hai, aur log poora analyzer disable kar dete hain)
- `BaseRepository` mein koi bhi method raw SQL string accept **nahi** karta. Sirf `(spName, DynamicParameters)`. Inline SQL likhna technically possible hi nahi hai.

---

### 🔴 2.21 STORED PROCEDURE ERROR CONVENTION (LOCKED — review fix 6)

Do mechanism hain aur **dono use honge**. Kaunsa kab — ye rule hai:

| Failure ka type | Mechanism | Kaun handle karta hai |
|---|---|---|
| **Expected / validation** — duplicate email, password reuse, "already applied", business rule fail | Procedure `SELECT @Status, @Message, @Id` **result set return karta hai**. Koi THROW nahi. | Service layer `Status` inspect karta hai aur `Response<T>` mein map karta hai (`ApiResponse.Failure(message, code)`) |
| **Unexpected / integrity** — parent row missing, cross-DB Uid resolve nahi hua, state machine violate hua, corrupt data | Procedure `THROW 50001, @Message, 1` karta hai (50000+) | `BaseRepository` isko automatically `BusinessRuleException` mein convert karta hai → global handler → 400 |

**⚠️ Ek hi procedure mein dono mat mix karo.** Ek proc ya to Status/Message return karta hai, ya THROW karta hai — dono nahi. Warna caller ko pata hi nahi chalega ki success ka matlab "row mila" hai ya "exception nahi aaya".

**Convention:**
- **Write procs** (`USP_Register*`, `USP_Save*`, `USP_Update*`, `USP_Change*`) → Status/Message/Id pattern
  ```sql
  SELECT @Status AS Status, @Code AS Code, @Message AS Message, @Id AS Id
         [, extra columns like UserUid, RevokedCount];
  -- @Status: 1 = success, 0 = business failure
  -- @Code  : ErrorCodes value, NULL on success
  ```
  **`@Code` Phase 1B mein add hua.** Decision 2.12 kehta hai client `Response.code` pe branch karta hai, `message` pe kabhi nahi. Agar proc code na de, to service layer ko message text match karna padta — wahi cheez jo 2.12 mana karta hai.
- **Read procs** (`USP_Get*`, `USP_Validate*`) → seedha rows return karo. Kuch na mile to empty result set (repository `NotFoundException` throw karega)
- **THROW** sirf tab jab aage badhna hi galat ho — data integrity toot rahi ho

`t_mdm_request_approvals` jaise append-only tables pe integrity violation = THROW, kyunki wahan "gracefully fail" ka koi matlab nahi.

### 🆕 2.22 Angular file convention (LOCKED — review fix 1)

**Har component ke teen alag file. Koi inline template ya inline style kahin nahi.**
```
login.component.ts     class LoginComponent
login.component.html
login.component.scss
```

Classic Angular suffix sab jagah — Angular 20+ ne default se hata diya tha, humne `angular.json` schematics se wapas on kiya:
`.component.ts` · `.service.ts` · `.guard.ts` · `.interceptor.ts` · `.model.ts` · `.pipe.ts` · `.directive.ts` · `.resolver.ts`

Class names bhi suffixed: `LoginComponent`, `AuthService`, `UiTableComponent`.

`angular.json` mein schematics block dono apps mein set hai — `ng generate` khud hi sahi shape banayega, kisi ko yaad rakhne ki zaroorat nahi.

### 🆕 2.23 Design system (LOCKED — review fix 2)

`frontend/portal/src/styles/` mein 11 partials. `styles.scss` sirf ek line hai: `@use 'styles/theme';`

**Component `.scss` mein kabhi nahi:**
- raw hex colour → `var(--jp-primary)` use karo
- raw px jo scale ka hissa hai → `v.$space-4` ya `var(--jp-space-4)`
- hand-written media query → `@include m.up(md)`

Component `@use 'variables' as v;` aur `@use 'mixins' as m;` karte hain — dono **koi CSS emit nahi karte**.
**`_theme.scss` ko component kabhi `@use` na kare** — wo poora design system emit karta hai, har component ke bundle mein duplicate ho jayega.

`angular.json` mein `stylePreprocessorOptions.includePaths: ["src/styles"]` set hai, isliye deep component se bhi `@use 'variables'` chalta hai — `../../../` nahi likhna padta.

`public-site` ka apna lighter set hai (4 partials). **Palette, spacing scale, radii, breakpoints dono mein identical hain** — ek hi product hai, user ko portal aur website ke beech design badalta nahi dikhna chahiye.

**Shared UI library:** `shared/ui/` mein 13 components, har ek 3 files.
`ui-button` `ui-input` `ui-select` `ui-textarea` `ui-checkbox` `ui-datepicker` `ui-modal` `ui-table` `ui-badge` `ui-empty-state` `ui-page-header` `ui-file-upload` `ui-multi-select`

Form controls `UiFormControlBase` extend karte hain (`@Directive()` abstract base) — ControlValueAccessor, label/helper/error id wiring, aur `disabled` ke do sources combine karna ek jagah.

### 🆕 2.24 Transient SQL retry (review fix 5)

`BaseRepository` sirf in error numbers pe retry karta hai:
`1205` (deadlock victim) · `-2` (timeout) · `4060` · `40197` · `40501` · `40613` · `49918` · `49919` · `49920`

3 attempts max, backoff ~200ms → ~400ms, **±20% jitter** ke saath. Har retry `LogWarning` karta hai.

**Kabhi retry nahi:** `2627`/`2601` (duplicate) · `547` (FK) · `50000+` (proc ka THROW). Ye decisions hain, glitches nahi — dobara chalane se bas dheere fail hoga.

Safe isliye hai kyunki **har write proc ka apna transaction hai** — failed attempt poora rollback ho chuka hota hai.

**⚠️ `-2` (timeout) ka exception hai.** Client timeout batch ko server pe cancel nahi karta. Agar proc sirf slow tha (stuck nahi), to wo abhi bhi chal raha ho sakta hai — aur commit bhi kar sakta hai — jab retry usko dobara bhej de. Isse bachne wale guard **Phase 1A mein banane hi hain**:
- business keys pe **filtered unique index** (duplicate insert 2627 banega, doosri row nahi)
- updates pe **RowVersion check**

Jo proc na idempotent ho na unique index se guarded, uske repository mein `MaxRetryAttempts = 1` karo.

### 🆕 2.25 Password length limits (review fix 4)

`AppConstants.Password.MinLength = 8`, `MaxLength = 128`, `MaxVerifyIterations = 2,000,000`.

Ye **DoS control hai**, usability preference nahi. PBKDF2 ka cost input length ke saath badhta hai aur login public + unauthenticated endpoint hai — bina cap ke chand requests jinme megabyte-size "password" ho, saare cores bhar denge.

- `HashPassword` → over/under length pe **throw** (truncate karke chup mat raho — user ka stored credential us password se match nahi karega jo usne type kiya)
- `VerifyPassword` → **`false` return karta hai, throw nahi**, aur **key derivation se pehle** check karta hai. Wrong password aur over-length password ka jawab same dikhna chahiye.

### 🆕 2.26 Connection security (review fix 3)

`DatabaseOptions` (`Database` section) — connection string mein nahi, taaki security posture ek jagah dikhe:
```
Encrypt: true                  (SqlClient 4.0+ ka default)
TrustServerCertificate: false  (base) / true (Development only)
ConnectTimeoutSeconds: 15
```
`localhost\TARUN` self-signed cert deta hai, isliye dev mein trust check skip — **traffic phir bhi encrypted rehta hai**. Verify kiya: `encrypt_option = TRUE`.

⚠️ Production mein `TrustServerCertificate: true` kabhi mat chhodo — phir koi bhi certificate accept ho jayega aur encryption ka MITM protection khatam.

`Application Name` bhi set hota hai (`JP.Sso.Api` / `JP.App.Api`) → `sys.dm_exec_sessions.program_name` aur Profiler mein dikhta hai.

### 🆕 2.27 Frontend strict mode

Angular generator `strict: true` nahi deta. Humne **dono apps mein on kiya**, plus `strictTemplates: true`.

Backend nullable reference types + warnings-as-errors pe chalta hai; frontend bhi wahi line hold karega. Production ka har "cannot read property of undefined" ek null hai jo compiler yahin pakad sakta tha.

Verify kiya ki unreferenced `ui-*` components bhi genuinely type-check hote hain (deliberate error daal ke build fail karwaya, phir revert).

---

### 🔴 2.28 TIMEZONE (LOCKED — client decision 2026-08-08)

Saare users **India (IST, UTC+5:30)** mein hain. IST mein **DST nahi hota** — offset hamesha exactly +330 minutes. Isi wajah se `DATEADD(MINUTE, 330, ...)` sahi hai aur `AT TIME ZONE` se sasta bhi.

**Storage UTC rahega. Business rules aur filters IST mein evaluate honge.**
Warna 6:30 PM IST ke baad bani har row "kal" ki gin li jayegi — "aaj ke applications" har shaam galat ho jayenge.

#### Rules

| # | Rule |
|---|---|
| 1 | **Storage** — har timestamp `datetime2` UTC, `SYSUTCDATETIME()` se. Koi badlav nahi. |
| 2 | **Helpers** — har DB mein: `dbo.fn_ToIst()`, `dbo.fn_IstToday()`, `dbo.fn_IstDateToUtc()`, `dbo.fn_IstDayRangeUtc()` (inline TVF) |
| 3 | **Date-range filters** — proc `@FromDate`/`@ToDate` **IST dates** leta hai, andar UTC half-open range banata hai: `>= @FromUtc AND < @ToUtc` |
| 4 | **`CAST(col AS DATE)` kabhi nahi** UTC column pe IST-day filter ke liye. Ye do baar galat hai: IST ka din galat nikalta hai, aur index seek bhi mar jaati hai (column pe function = non-sargable) |
| 5 | **Calendar dates = `date` type** — `LastDateToApply`, `ExpectedJoiningDate`, `JoiningDate`, `DOB`, experience ka `FromDate`/`ToDate`, role ka `ValidFrom`/`ValidTo`. Calendar date ka koi timezone hota hi nahi |
| 6 | **Expiry timestamps = `datetime2` UTC** — token `ExpiresOn`, OTP `ExpiresOn`, lockout `UnlockOn`. Ye **durations** hain (30 min baad), calendar dates nahi |
| 7 | **API** UTC ISO-8601 `Z` suffix ke saath return karta hai. Angular sirf **display** ke liye convert karta hai |
| 8 | **Hot query paths mein `AT TIME ZONE` mat use karo** — pehle variables mein UTC boundaries nikaalo, phir plain comparison se filter karo |

#### Sahi pattern

```sql
-- IST dates in, UTC half-open range out. Index seek bacha rehta hai.
DECLARE @FromUtc datetime2 = dbo.fn_IstDateToUtc(@FromDate);
DECLARE @ToUtc   datetime2 = dbo.fn_IstDateToUtc(DATEADD(DAY, 1, @ToDate));

SELECT ... FROM dbo.t_app_applications
WHERE AppliedOn >= @FromUtc AND AppliedOn < @ToUtc;   -- sargable
```

#### Galat pattern

```sql
-- IST ka din galat, aur AppliedOn ka index bekaar
WHERE CAST(AppliedOn AS date) = @Date

-- Sahi din, par column pe function → seek gaya
WHERE CAST(AppliedOn AT TIME ZONE 'UTC' AT TIME ZONE 'India Standard Time' AS date) = @Date
```

**Half-open (`>= from AND < to`) hamesha** — `BETWEEN` datetime2 pe last day ke 00:00:00 ke baad ka sab chhod deta hai.

---

### 🆕 2.29 SQL script conventions (Phase 1A mein seekha)

#### Collation — VERIFIED
`jp_sso` = **`SQL_Latin1_General_CP1_CI_AS`**, compatibility level **150**.
**CI = case-insensitive**, jo filtered unique index ke liye zaroori hai: `test@x.com` aur `TEST@X.COM` same index entry hain, isliye duplicate account ban hi nahi sakta. CS collation pe dono alag hote aur ek hi email se do account ban jaate.

Teeno DB ka collation same rahega. `00_create_database.sql` mein explicitly likha hai — server default pe bharosa mat karo.

#### Email normalization
Procs (Phase 1B) insert se pehle lowercase karenge. Uske upar `CK_t_sso_users_Email_Lowercase` DB-level guarantee deta hai:
```sql
CHECK (Email COLLATE Latin1_General_BIN2 = LOWER(Email) COLLATE Latin1_General_BIN2)
```
**`COLLATE Latin1_General_BIN2` load-bearing hai** — DB ke CI collation ke under `Email = LOWER(Email)` hamesha true hota, aur constraint kuch enforce hi na karta.

#### `SET QUOTED_IDENTIFIER ON` — har script mein
**sqlcmd default OFF rakhta hai, SSMS ON.** Filtered index ke liye ON chahiye — CREATE ke waqt bhi aur baad ke har INSERT/UPDATE pe bhi. Isliye SSMS mein chalne wala script command line se `Msg 1934` de sakta hai.

Har script ke top pe `USE <db>; GO` ke turant baad:
```sql
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
```

#### sqlcmd flags
```
sqlcmd -S localhost\TARUN -E -b -f 65001 -i database\run_all.sql
```
- `-b` — error pe ruko. Iske bina sqlcmd error print karke aage ke scripts chalata rehta hai
- `-f 65001` — input ko UTF-8 padho. In files mein non-ASCII characters hain; iske bina sqlcmd ANSI maan ke unhe kharab kar deta hai

#### Index guard table guard se ALAG hona chahiye
```sql
IF NOT EXISTS (... sys.tables ...) BEGIN CREATE TABLE ... END
GO
IF NOT EXISTS (... sys.indexes ...) BEGIN CREATE INDEX ... END   -- apna guard
GO
```
**Index ko table ke guard ke andar mat rakho.** Agar table ban gaya par index fail hua, to dobara chalane pe table-exists guard poora block skip kar dega aur table hamesha ke liye bina index reh jayega. Phase 1A mein theek yahi hua tha.

---

### 🆕 2.30 T-SQL gotchas (Phase 1B mein seekhe)

| Cheez | Rule |
|---|---|
| **Proc parameter mein function call** | `EXEC proc @P = NEWID()` **syntax error** hai. Sirf constant ya variable chalta hai. Pehle `DECLARE @x uniqueidentifier = NEWID();` karo |
| **Test log ko `#temp` mat banao** | Temp tables **transactional** hain — `ROLLBACK` unke rows bhi uda deta hai. Test harness ka assertion log **TABLE VARIABLE** hona chahiye; table variables rollback se affect nahi hote. Warna poora suite chup-chaap 0 results dikhayega |
| **`INSERT ... EXEC` + multi result set** | Nahi chalta — proc ke **saare** result sets target table se match hone chahiye. `USP_GetUserList` (2 sets), `USP_GetUserClaims` (2), `USP_GetUserByUid` (3) capture nahi ho sakte. Test mein inko `EXEC` se smoke-test karo aur filtering ko mirror query se assert karo |
| **`INSERT ... EXEC` ke andar ROLLBACK** | `Msg 3915`. Agar proc ke CATCH mein ROLLBACK hai aur andar error aaya, to yehi milega — asli error chhup jaata hai. Debug karne ke liye proc ko seedha `EXEC` karo, `INSERT..EXEC` ke bina |
| **Optional filter + RECOMPILE** | `(@P IS NULL OR Col = @P)` sirf **list procs** pe, `OPTION (RECOMPILE)` ke saath. Login path pe kabhi nahi — har sign-in pe recompile ka cost padega |

---

### 🔴 2.31 ERROR LOG + CATCH ORDERING (LOCKED — client decision 2026-08-08)

#### Table: har DB mein apna
`t_sso_error_log` · `t_mdm_error_log` · `t_app_error_log`

Ek shared table nahi — `jp_sso` standalone deploy hona chahiye (2.1), to wo apne errors kisi doosre DB mein nahi likh sakta.
Standard columns 2.4 ke mutabik poore hain, koi exception nahi. Indexes: `OccurredOn DESC` aur `ErrorProcedure`.

#### ⚠️ THE ORDERING RULE — yehi poori baat hai

**Error log ka INSERT agar failed transaction ke ANDAR hua, to wo bhi rollback ho jaata hai.** Error theek us waqt gayab hota hai jab uski sabse zyada zaroorat thi — aur kisi ko pata bhi nahi chalta, kyunki batane wala code hi gayab hua.

Har CATCH block mein **ye 4 kaam, isi order mein**:

```sql
BEGIN CATCH
    -- 1. CAPTURE — ERROR_* sirf isi CATCH ke andar padhe ja sakte hain
    DECLARE @ErrNumber int = ERROR_NUMBER(), @ErrSeverity int = ERROR_SEVERITY(),
            @ErrState int = ERROR_STATE(), @ErrProcedure sysname = ERROR_PROCEDURE(),
            @ErrLine int = ERROR_LINE(), @ErrMessage nvarchar(4000) = ERROR_MESSAGE();

    -- 2. ROLLBACK
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    -- 3. LOG — ab transaction khatam hai, ye INSERT bach jaayega
    DECLARE @Params nvarchar(max) = (SELECT ... FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
    EXEC dbo.USP_LogError @ErrorNumber = @ErrNumber, ..., @ParametersJson = @Params,
         @ContextInfo = N'USP_Name';

    -- 4. RESPOND — THROW (integrity) ya Status/Code/Message/Id (expected), per 2.21
    THROW;
END CATCH
```

#### `XACT_STATE()`
| Value | Matlab | Kya karo |
|---|---|---|
| `-1` | **Uncommittable** — `XACT_ABORT ON` ke saath zyadatar errors ke baad yahi hota hai | Sirf ROLLBACK legal hai. **COMMIT fail karega** |
| `1` | Committable | Phir bhi ROLLBACK — operation fail hua hai |
| `0` | Koi transaction nahi | ROLLBACK mat karo, warna "no corresponding BEGIN TRANSACTION" error |

`IF XACT_STATE() <> 0 ROLLBACK` teeno cases handle karta hai.

#### `USP_LogError` kabhi THROW nahi karta
Wo kisi aur ke CATCH ke andar chalta hai. Agar wo apna error raise kare, to **asli error replace ho jayega** aur caller ko logging ki failure dikhegi, actual fault nahi. Uska INSERT apne TRY/CATCH mein hai jo sab kuch nigal jaata hai (fallback: `RAISERROR ... WITH LOG` severity 10 → SQL Server error log, jise koi transaction rollback nahi kar sakta).

**Log na ho paana bura hai. Asli error kho jaana usse bura hai.**

#### `ParametersJson` mein secret KABHI nahi
`PasswordHash` · `PasswordSalt` · `TokenHash` · `OtpHash` — sab `'***masked***'`.
Parameter **present tha** ye record karna kaam ka hai; uski **value** record karna error log ko system ki sabse lambi-chalne wali, sabse zyada padhi jaane wali secret ki copy bana deta hai.

#### `ErrorProcedure` vs `ContextInfo` — dono chahiye
`ERROR_PROCEDURE()` **innermost** module deta hai jahan error origin hua (test mein: trigger). `ContextInfo` wo entry-point proc deta hai jo caller ne bulaya tha. Diagnose karne ke liye aam taur pe dono chahiye, isliye dono store hote hain.

#### Template
`database/_TEMPLATE_procedure.sql` — canonical shape (write / read / list). Har naya proc wahin se cut hoga, yaad rakh ke nahi likha jayega.

#### ⚠️ `INSERT ... EXEC` ye pattern tod deta hai
Uske andar callee ko ROLLBACK karne ki **ijazat nahi** — `Msg 3915` aata hai, CATCH wahin abort ho jaata hai, `USP_LogError` chalta hi nahi, aur caller ko 3915 dikhta hai asli error number ke bajaye.

BaseRepository Dapper use karta hai, INSERT-EXEC nahi — production safe hai. Par **test** aur koi bhi T-SQL caller ise plain `EXEC` se bulaye. Ye test 002 mein pakda gaya tha.

---

### 🔴 2.32 LOGIN TIMING — DECOY CREDENTIAL (LOCKED)

Login ka jawab har haal mein same dikhna kaafi **nahi** hai. Agar user na mile aur hum PBKDF2 skip kar dein, to request ~2 ms mein wapas aati hai; user mile to ~55 ms. Message chahe kitna bhi generic ho, **clock bata deti hai ki account hai ya nahi.**

Isliye `IDummyCredentialProvider` — ek decoy hash+salt, **wahi iteration count** (210,000) pe. User na mile to verification decoy ke against chalti hai aur result phenk diya jaata hai. Dono raaste bilkul same kaam karte hain.

```csharp
var hasRealCredential = row is { HasCredential: true };
var hash       = hasRealCredential ? row!.PasswordHash! : _dummy.Credential.Hash;
var iterations = hasRealCredential ? row!.Iterations!.Value : _dummy.Credential.Iterations;
var passwordMatches = _passwords.VerifyPassword(password, hash, salt, iterations, algorithm);
var authenticated   = hasRealCredential && passwordMatches;   // decoy kabhi match nahi karega
```

**Decoy SINGLETON hai** — 210k iterations har request pe banana ~200 ms add kar deta.
**Config mein decoy blank chhodo** — tab app startup pe khud banata hai, current iteration count pe. Pin karne ka matlab hai use us din ke count pe jama dena; decoy jo asli hash se **sasta** ho wo wahi hole dobara khol deta hai jise band karne ke liye wo bana tha.

#### Iske aage 2 aur timing leak the — dono band
1. **Login validator mein `MinimumLength` nahi hai.** Chhota password validation pe hi reject ho jaata, microseconds mein — decoy ka fayda khatam. `MaximumLength` rehta hai (wo DoS cap hai).
2. **Forgot-password** bhi dono raaston pe decoy verification chalata hai, aur `USP_CreatePasswordResetToken` unknown address pe bhi `Status = 1` deta hai.

#### Measurement (2026-08-08, order-controlled)
| Endpoint | account exists | no such account | farak |
|---|---|---|---|
| `/api/auth/login` | median 80.5 ms · min 53.1 | median 75.7 ms · min 54.4 | −3.4 ms |
| `/api/auth/forgot-password` | median 218.3 ms · min 65.7 | median 221.8 ms · min 68.6 | −4.4 ms |

Farak ka **sign run-to-run badalta hai** aur machine ke noise se chhota hai — koi usable signal nahi.

> ⚠️ **Measurement ka sabak:** pehli koshish mein maine har pair mein "exists" wali request **pehle** bheji thi. Iska matlab warm-up ka fayda hamesha "absent" ko milta tha, aur natija +8.5 ms (10%) aaya — jo mainne galti se real leak samajh liya. Order alternate karte hi sign palat gaya. **Timing test mein order alternate karna zaroori hai**, warna aap apne hi artefact ko chase karte reh jaoge.

---

### 🆕 2.33 EMAIL QUEUE — request thread pe mail kabhi nahi

`IEmailDispatchQueue` (bounded `Channel`, 1000) + `EmailDispatchWorker` (`BackgroundService`). Service layer sirf `Enqueue` karti hai.

Do wajah:
1. **Lifetime bug** — pehle `Task.Run` request ke DI scope se `IEmailService` capture karta tha aur scope dispose hone ke **baad** use karta tha. Worker har message pe apna naya scope kholta hai.
2. **Backlog bounded hai** — unbounded queue wo cheez hai jo mail outage ko OOM crash bana deti hai. Full hone pe `DropWrite` + loud error log (chup-chaap reset email kho dena us se bhi bura hai).

> Note: ye **timing fix nahi tha**. Maine ise timing fix samajh ke likha tha, phir order-controlled measurement ne dikhaya ki wahan koi leak thi hi nahi (2.32). Rakha isliye hai kyunki upar wali dono wajah apne aap mein sahi hain.

---

### 🆕 2.34 C# gotchas (Phase 1C mein seekhe)

| Cheez | Rule |
|---|---|
| **Extension method shadowing** | `Validators` namespace mein `EmailAddress` naam ka extension likhna FluentValidation ke apne `EmailAddress` ko **dhak deta hai** — apni hi body ke andar wale call ko bhi. Infinite recursion → **stack overflow**, poora process gir jaata hai. Compile clean hota hai; pakda pehli request pe jaata hai. Isliye `ValidEmail` / `ValidPassword` naam rakhe |
| **Validator startup check** | FluentValidation validator apna saara kaam **constructor** mein karta hai, aur DI use pehli request pe banata hai. Isliye `Program.cs` boot pe saare validators ek baar resolve karta hai — upar wali galti ab boot pe failure hai, live request pe nahi |
| **`InvariantGlobalization` = false** | `Microsoft.Data.SqlClient` invariant globalization mode mein connection kholne se **mana kar deta hai** ("Globalization Invariant Mode is not supported"). Har project yahan SQL tak pahunchta hai, to ise `true` mat karo |
| **Culture-sensitive console output** | en-IN console pe `210000:N0` = "2,10,000". Technical numbers ke liye `CultureInfo.InvariantCulture` do |
| **`FluentValidation.AspNetCore` deprecated hai** | Auto-validation package maintainers ne khud chhod diya (11.3.0 aakhri). Uski jagah apna `FluentValidationFilter` (JP.Infrastructure/Filters) — dono API isko share karte hain |
| **`ModelStateInvalidFilter` order −2000** | Wo **pehle** chalta hai. Baad wale filter mein ModelState mein error daalne ka koi fayda nahi — framework tab tak decide kar chuka hota hai. Isliye validation filter khud hi wahi envelope return karta hai |

---

### 🆕 2.35 RATE LIMITS — chained limiter, named policy nahi

Login ko ek saath **do** independent limits chahiye:

```
5 / minute  per IP           — ek machine ko hathoda chalane se rokta hai
10 / hour   per identifier   — botnet ko EK account pe kai IP se koshish karne se rokta hai
```

Named policy **ek hi partition** pe resolve hoti hai, isliye wo ya to ek limit bol sakti hai ya `ip+identifier` ke **combination** pe — aur combination bilkul galat shape hai, kyunki distributed attack mein har baar IP alag hota hai aur combined bucket kabhi bharta hi nahi.

Isliye `PartitionedRateLimiter.CreateChained(...)` — kisi ek ka bhi budget khatam hua to reject. Har limiter apne raaste ke alawa `NoLimiter` deta hai, to baaki traffic ko haath nahi lagta.

**Identifier body mein hota hai, aur rate limiting model binding se pehle chalti hai** → `AuthRateLimitKeyMiddleware` body buffer karta hai (sirf 2 paths, max 8 KB), ek field padhta hai, rewind karta hai, `HttpContext.Items` mein rakh deta hai.

Numbers `RateLimits` config section mein hain (2.7 no-hardcoding). Defaults code mein wahi hain, to section na ho tab bhi behaviour spec ke mutabik rehta hai.
⚠️ Windows **per process** hain — ek se zyada instance pe effective limit instance-count se multiply ho jaayegi. Shared store Phase 1C ka scope nahi.

---

### 🔴 2.36 PASSWORD HASH API TAK PAHUNCH HI NAHI SAKTA (compiler-enforced)

`UserLoginRow`, `PasswordHistoryRow` aur saari repositories **`internal`** hain, JP.Infrastructure ke andar. Ye "dhyan rakhna" wala rule nahi hai — compiler ka rule hai:

```
JP.Sso.Api mein: public static byte[]? Steal(UserLoginRow row) => row.PasswordHash;
→ error CS0122: 'UserLoginRow' is inaccessible due to its protection level
```

API project us type ka **naam bhi nahi le sakta** jo hash rakhta hai, isliye koi serializer usko chhoo hi nahi sakta. Public contracts (`JP.Domain`) mein hash/salt field hai hi nahi.

---

### 🔴 2.37 MENU SYSTEM — DATA-DRIVEN NAVIGATION (LOCKED — client decision 2026-08-08)

Navigation pehle teeno layout components mein **hardcoded `NavItem[]` array** thi. Ye 2.7 (no hardcoding) todti thi, par asli problem practical hai: Phase 2 se aage screens lagataar add hongi, aur **har menu change pe frontend build + deploy** koi chalne wala release process nahi hai.

#### Tables — `jp_sso` mein, kahin aur nahi
Menu row hamesha ek **permission** se gated hoti hai, aur permissions yahan rehti hain. Kisi doosre DB mein rakhne ka matlab hota har sign-in pe **cross-database join**, jo 2.2 saaf mana karta hai.

| Table | Kaam |
|---|---|
| `m_sso_menus` | Poora nav tree. Self-FK `ParentMenuId` (MVP mein 2 levels), `UserTypeId` NULL = sabke liye, `PermissionId` NULL = koi permission nahi chahiye |
| `t_sso_role_menus` | Per-role override. **Ab banaya, MVP mein use nahi hota.** Baad mein retrofit karna live DB pe migration + proc rewrite maangta; khaali table ka koi cost nahi |

⚠️ **FK column types spec se alag hain, jaan-boojh ke:** `UserTypeId` `int` hai (`tinyint` nahi) aur `PermissionId` `int` hai (`bigint` nahi) — FK column apne parent PK ke type se **match karna hi padta hai**. `m_sso_user_types.UserTypeId` aur `t_sso_permissions.PermissionId` dono `int` hain.

#### `IsMenuVisible` — filter nahi, flag hai
`0` matlab route reachable hai par sidebar mein nahi dikhta (detail pages, edit forms, modals). Proc ise **return karta hai, filter nahi karta** — client ek hi list se do kaam leta hai: sidebar draw karna (visible rows) aur "ye route khul bhi sakta hai kya" check karna (saari rows). Server pe filter kar dete to doosra kaam toot jaata.

#### `USP_GetUserMenus` — FLAT list, recursive CTE nahi
Client ko render karne ke liye nest karna hi padega, to SQL mein tree banane ka matlab hai wahi shape **do baar** banana. Flat list + `ParentMenuId` ek index seek hai; recursive CTE anchor + har level pe ek pass. Ye har sign-in pe chalta hai.

**Filter rules:** UserTypeId match (ya NULL) · `PermissionId IS NULL` ya user ke paas wo permission ho · `Is_Active = 1 AND Is_Deleted = 0` har join pe · role validity `ValidFrom`/`ValidTo` vs `fn_IstToday()` (2.28).

**Parent tabhi bachta hai jab koi child bacha ho.** Group node ke paas apni koi permission nahi hoti, to use apne dam pe filter karna ek aise admin ko khaali "Verification" heading dikha deta jo kuch verify hi nahi kar sakta. Test 20 exactly yahi assert karta hai.

#### Seed — `app.routes.ts` hi source of truth hai
Har `RoutePath` wo route hai jo aaj `frontend/portal/src/app/app.routes.ts` mein maujood hai. Dono kabhi alag nahi hone chahiye: menu row bina route ke 404 hai, aur route bina menu row ke invisible hai.

`Is_Active = 1` → route aaj wired hai. `Is_Active = 0` → scope mein commit hai par route abhi nahi (`/school/reports`). Isliye **feature ship karna ek UPDATE hai, INSERT nahi.**

`PermissionCode` se `PermissionId` resolve hota hai, hardcoded id se nahi — permissions IDENTITY use karti hain, ids rebuild pe stable nahi. **Galat spelling pe seed abort ho jaata hai**, kyunki NULL PermissionId ka matlab "koi permission nahi chahiye" hota — yaani typo item ko **sabko dikha deta**, kisi ko nahi. Failure ka direction galat hai, isliye pehle hi pakda jaata hai.

⚠️ `/school/branches` pehle `roles: [SCHOOL_OWNER]` tha → ab `BRANCH.MANAGE`. Aaj wo permission sirf SCHOOL_OWNER ke paas hai to dikhne mein koi farak nahi. Fayda ye hai ki school ka **custom role** jisme BRANCH.MANAGE ho, use menu apne aap mil jaata — school roles permission bundles isiliye hain (2.9).

#### API
`GET /api/menus` — uid **JWT claim se**, koi route param / query / body nahi, to badalne ko kuch hai hi nahi (2.6).
`Cache-Control: no-store` — sirf `no-cache` nahi. Role assign/revoke hote hi menu badal jaata hai, aur ek cached menu jo aisa link dikhaye jispe server 403 dega, wo slow menu se bura hai. `no-store` per-user response ko kisi shared proxy mein bhi nahi jaane deta.
`[RequireActiveAccount]` **nahi** — pending school ko apne status aur documents screens tak pahunchna hai, aur wo bhi menu rows hain (2.9). Proc apne aap sirf utna hi deta hai.

#### Angular
`MenuService` sign-in ke baad ek baar fetch karti hai aur signal mein rakhti hai; sidebar usi signal se render hota hai; tree client pe `parentMenuId` se banta hai.

⚠️ **Cache user ke uid pe keyed hai.** Iske bina: sign out → dusre user se sign in (same machine) → `load()` short-circuit ho jaata aur **pichhle user ka menu** dikhta. `clear()` deliberate logout cover karta hai, par 401 se gira hua session uske paas se guzarta hi nahi.

#### 🔴 Ye ACCESS CONTROL NAHI HAI
Menu decide karta hai kya **dikhega**. `permissionGuard` aur server decide karte hain kya **allowed** hai — dono wahi ke wahi rehte hain. Chhupa hua menu item aaj tak kisi ko URL type karne se nahi rok paaya.

---

### 🎨 2.38 DESIGN DIRECTION — "THE REGISTER" (LOCKED — Phase 1D)

Phase 0 ka design system **functional** tha, art-directed nahi — corporate blue (`#2563EB`), Tailwind-default greys, har jagah shadow. Phase 1D ne use **source pe** badla: `_variables.scss` aur 11 partials. Koi override layer nahi, isliye saare 13 `ui-*` components bina chhue nayi direction inherit kar gaye. Tokens ka pura point yahi tha.

Reference **school ki apni cheezein** hain, job-board category nahi: bound attendance register, mark sheet, blackboard, aur wo do inks jinpe classroom chalta hai — student ki blue-black aur **teacher ki correction red**.

#### Teen rules poori cheez ko khade karte hain

**1. Identity NEUTRALS mein hai, accent mein nahi.**
Is product mein koi **true grey nahi** aur koi **pure black nahi**. Har border, har muted label, har sunken surface ek desaturated blackboard green hai. Table density pe aap ~95% neutrals dekh rahe ho aur ~5% accent — to sirf accent ko brand karna kuch bhi brand nahi karta. **Yehi wo risk hai jo maine liya:** ye "default palette + logo colour" ki jagah ek sochi-samjhi material jaisi padhti hai.

**2. RULES, elevation nahi.**
Page ledger ki tarah horizontal rules aur borders se bana hai, fixed rhythm pe. Shadow **sirf** un cheezon pe jo sach mein page ke upar float karti hain — modal, dropdown, toast, mobile drawer. **Cards lift nahi karte.** 50-row table ko ruling se track karna zebra striping se behtar hai, aur vertical space bhi nahi khata.

**3. RED rationed hai.**
Marking red sirf wahan jahan user ki pen chahiye: rejected, resubmit required, overdue, field error. Kabhi decorative nahi. Is product mein red dikhe to wahi matlab jo mark kiye hue paper pe hota hai.

#### Palette — 5 named + slate ramp (sab measured, assume nahi)

| Token | Hex | Kyun | Contrast |
|---|---|---|---|
| **Slate** (brand) | `#17332C` | Blackboard — har Indian classroom isi ke around bana hai. Sidebar, header, table head, primary buttons. Neutral ramp **isi se** derive hoti hai | white on it **13.6:1** |
| **Chalk** (ground) | `#F3F6F4` | Thanda off-white, green cast. Jaan-boojh ke wo **warm cream (~#F4F1EA) NAHI** jo AI-design ka tell ban chuka hai | ink on it **16.1:1** |
| **Ink** (text) | `#0E1C18` | Ramp ka sabse gehra step, pure black nahi — body copy bhi wahi green cast rakhta hai | **17.5:1** on white |
| **Marking red** | `#A9302A` | Teacher ki correction pen. Rationed | **6.7:1** on white |
| **Turmeric** | `#8F5E0F` (text) / `#C08A2A` (fill) | Waiting na failure hai na success. Generic amber "warning" bahut zor se bolta hai jab school sirf queue mein hai | **5.6:1** on white |
| Muted text | `#52685F` | Green-cast, par itna desaturated ki link jaisa na lage (pehla attempt `#4A7266` tha — screenshot mein har muted line link lag rahi thi) | **6.0:1** white, **5.5:1** chalk |

#### Type — teen faces, teen kaam
- **Bricolage Grotesque** — DISPLAY. Compressed, thode irregular terminals: painted institutional signage, literary print nahi. **Sirf teen jagah**: wordmark, page titles, badi figures. Restraint hi ise characterful rakhta hai, shouty nahi.
- **Public Sans** — BODY. Civic grotesque, bada x-height, khuli apertures. Isliye chuna kyunki asli reading wahan hoti hai: **13px, table mein, chauthe ghante mein.**
- **IBM Plex Mono** — UTILITY. Ids, dates, PRT/TGT/PGT codes, margin numerals. Stamped/typewritten quality register ki apni awaaz hai, aur figures tabular hain.

Scale: 12 / 13 / 15 / 16 / 18 / 22 / 28 / 40 / 52. Row rhythm **44px** — yehi minimum touch target bhi hai, to ek hi rhythm 1440px pe mouse aur 375px pe angoothe dono ko serve karta hai.

#### Layout — dono screens ek saath design hue

**Auth: "register page", split-screen nahi.**
Patli slate board upar, phir chalk ground pe ek ruled sheet, margin rule left mein.
> Split-screen isliye reject kiya kyunki wo 375px pe "marketing wala aadha gayab" ban jaata hai — yaani **phone ko screen ka bacha-khucha version milta hai.** Teachers phone pe hain; wo primary experience hai, fallback nahi. Ye layout 375 aur 1440 pe **structurally identical** hai.

**Dense list: "the register", zebra nahi.**
Sticky slate head (the board) · 1px rule har row ke neeche fixed 44px rhythm pe · **3px margin gutter** jiska colour state batata hai · roll column · mono dates/ids · pager ruled area ke **andar**.
> Zebra row ko across track karti hai par column ka sense maar deti hai, aur ek ghante baad shimmer karti hai. Ruling tracking ka kaam behtar karti hai aur vertical space zero kharch karti hai.

#### 🔴 SIGNATURE — "THE ROLL" (`ui-roll`)
`Applied → Viewed → Shortlisted → Interview → Selected → Offer → Hired`

Attendance roll / mark sheet se: ruled cells ki ek line, current stage tak bhari hui.

| Convention | Matlab |
|---|---|
| filled cell | stage ho chuka |
| ringed cell | abhi yahan hai (**shape se**, sirf colour se nahi) |
| empty ruled | aage baaki |
| struck through | rejected/withdrawn — register ka "struck off" |
| `4/7` margin mein | marks awarded / marks available |

**Pills kyun nahi:** pill jo bhi likhe, size aur shape same rehti hai — to 50 pills **padhne** padte hain, ek-ek karke. 7-cell roll ki ek **shape** hoti hai, to 50 rolls ek histogram hain: wo deewar jahan sab atke hain, bina kuch padhe dikh jaati hai. Head of HR screen isi sawaal ke liye kholta hai.

Teen sizes: `xs` (table cell ~70px) · `md` (card, phone) · `lg` (detail, labelled legend ke saath). Verification bhi **wahi component** hai, sirf 3 stages — isliye jo user applicants list pe padhna seekh gaya, wo account-status pe apne aap samajh jaata hai.

**Accessibility:** cells `aria-hidden` hain; matlab host ke `aria-label` mein hai — *"Shortlisted, stage 3 of 7"*. Margin rule ka colour bhi hamesha row ke text label ke **saath** hai, akela kabhi nahi.

#### Jo jaan-boojh ke NAHI kiya
Corporate job-board blue · stock photography · cream + high-contrast serif + terracotta (AI tell) · near-black + acid accent · broadsheet hairlines + zero radius · button gradients · glassmorphism · heavy shadows · 01/02/03 markers · kuch bhi jo bounce kare.

#### Motion
Functional only. 150–190ms ease-out hover/focus/route pe. **Ek orchestrated entrance per page** (`.enter`, 6px + fade, `--jp-enter-index` se 45ms stagger), scattered effects nahi. `prefers-reduced-motion` har jagah honour hota hai.

#### Design review ke baad ke 6 fixes (2026-08-08)

**1. Desktop auth ab SPLIT-SCREEN hai.** Pehle 1440 pe ek chhota card bade khaali maidan mein float kar raha tha — mobile version desktop se behtar lag raha tha, jo ulta hai. Ab `lg` se: left mein sheet, right mein board continue hota hai jisme **wahi `ui-roll`** labelled aur bada draw hota hai. Panel decoration nahi hai — account banane se **pehle** roll padhna sikha deta hai, to school jab pehli baar apni applicants list kholta hai to use padhna already aata hai. `lg` se neeche panel **layout hi nahi hota** (hidden nahi) — phone ko poora page milta hai.

**2. `.roll__legend` ab grid hai, flex nahi.** Truncating flex items ka matlab tha sabse lamba label kuch decide nahi karta, bas clip ho jaata hai — "Submitted" dono widths pe kat raha tha. Ab columns cells se exactly match karte hain aur truncation hai hi nahi.

**3. `ui-roll` host `lg` pe block ho jaata hai.** Host `inline-flex` hai (taaki `xs` table cell mein text ke saath baithe), aur `lg` track us wajah se shrink-wrap ho raha tha — cells card ki ek-tihaai width pe aur labels neeche tanne hue. Host binding se fix.

**4. 🔴 EK HIERARCHY, TEEN NAHI.** Applicants table mein ek row ek saath amber bar + red "Waiting 8 days" + grey "Closed" dikha sakti thi. Teen competing signals = zero signal. Ab:

| channel | kya kehta hai |
|---|---|
| **the bar** | sirf **STAGE**. Kabhi red nahi, kabhi struck nahi — column ko scan karne ke liye jo shape chahiye, use urgency se colour karna usi shape ko noise bana deta hai |
| **the margin** | sirf **ATTENTION**. Ek colour, ek matlab: is row ko aap chahiye |
| **the status** | wahi attention, **shabdon mein** — 3px colour akela carrier nahi ho sakta |
| **a mute** | closed row poori **recede** karti hai, bar strike nahi hoti. Struck bar ek nazar mein padhi nahi jaati, aur ek nazar mein padha jaana hi uska ekmatra kaam hai |

`UiRollTone.struck` component mein bacha hai (detail screens ke liye) par uske doc mein saaf likha hai: dense table mein **mat** use karo.

**5. School signup ka mobile helper.** "Used for job alerts" — job alerts **teacher** ka concept hai. School ko uske apne account ke baare mein galat baat batana. Ab audience ke hisaab se: school ko "verification ke liye", teacher ko "job alerts ke liye".

**6. 🔴 REQUIRED nahi, OPTIONAL mark hota hai.** Pehle har field pe red asterisk tha *aur* optional field alag se "Optional" bhi likhti thi. Is product mein lagbhag sab required hai — sabko mark karna kuch bhi mark nahi karta, wo bas red dots ki ek line hai jise aankh skip karna seekh leti hai. Ab sirf `.field__optional` hai, saare 8 `ui-*` form components mein. `aria-required` control pe waise hi rehta hai.

**Chhoti do:** "Show" toggle sirf tab dikhta hai jab field mein kuch ho (khaali field pe "kuch nahi dikhaunga" wala button broken lagta hai), aur mobile drawer ka apna **close control** hai — pehle sirf scrim tap pe band hota tha, jo undiscoverable hai aur keyboard user ke paas koi raasta hi nahi tha.

**Dashboard ka void:** do panels ke baad 1440 pe ~40% viewport khaali tha. Panels ko stretch karne ke bajaye wo content daala jo wahan **belong** karta hai — Open jobs, "kya waiting hai" se sorted. Funnel card ka footer khulne/band hone ka accounting deta hai (funnel sirf open ginta hai, isliye uske numbers 50 tak add nahi hote — ab dono numbers likhe hain).

#### ⚠️ Screenshot se pakdi gayi cheezein (assume mat karna — dekhna)
1. Muted `#4A7266` paper pe **link jaisa** lag raha tha — poori "Applied for" column clickable lag rahi thi. `#52685F` kiya.
2. Shell header raw `userUid` print kar raha tha. Ab role dikhta hai ("School owner") — uid internal key hai, screen pe uska koi kaam nahi.
3. Custom elements default `inline` hain, to `ui-password-field` ke andar ka `.field` margin collapse kar raha tha aur button input se chipak gaya tha.
4. `.shell__menu-toggle` `.btn` ka paper background inherit kar ke dark header pe near-white hover kar raha tha.

---

### 🔴 2.39 ORGANIZATION SCOPE RESOLUTION (LOCKED — Phase 3 se pehle)

JWT **`OrganizationUid`** carry karta hai, `SchoolId` nahi. **`SchoolId` `jp_app` mein rehti hai aur server se bahar kabhi nahi jaati.**

Ye 2.6 (IDOR — tenant hamesha token se) ka `jp_app` tak extension hai. Zaroorat isliye padi kyunki 2.2 cross-DB join mana karta hai: `jp_sso` `SchoolId` jaanta hi nahi, aur `jp_app` ko `OrganizationUid` se khud resolve karna padta hai. Ye resolution hi wo jagah hai jahan tenant isolation ya to hota hai ya toot-ta hai.

#### Resolution chain — har request pe, server pe

```
OrganizationUid   (SIRF JWT claim se — aur kahin se nahi)
      ↓
t_app_schools.SchoolId
      ↓
branch scope   via t_app_school_users / t_app_school_user_branches
```

#### Rules

**1. Koi bhi endpoint authorization ke liye `SchoolId`, scoping wali `BranchId`, `OrganizationUid` ya `UserId` parameter mein accept nahi karega.** Ye chaaron token se aate hain. Jo cheez request mein aati hai wo attacker ki likhi hui hai — Phase 1C mein exactly yahi test kiya tha: forged `organizationUid` body mein bheja, server ne ignore kiya aur user caller ke apne org mein hi bana.

**2. `BranchId` request body mein sirf DATA ke roop mein aa sakti hai** — "ye job kis branch ki hai" — aur use karne se **pehle** caller ke resolved branch scope ke against validate hogi.

> ⚠️ **Yahi wo jagah hai jahan ye sabse aasani se tootega.** `SchoolId` ko body se accept karna itna clearly galat hai ki koi likhega hi nahi. Par `BranchId` ka body mein hona **legitimate** hai, isliye use bhula dena aasan hai — aur ek un-validated `BranchId` ka matlab hai doosre school ki branch pe job post kar dena. Data aur scope ek hi field mein aate hain; farak sirf validation hai.
>
> Aur validation fail hone pe **`NotFoundException`**, `ForbiddenException` nahi (2.6): "ye branch nahi mili" aur "ye branch hai par aapki nahi" — dusra jawab id probing ka rasta khol deta hai.

**3. Client pe token ke alawa kuch identity-related store nahi hoga.** `TokenStorageService` akela gateway rehta hai. Koi `localStorage.schoolId`, koi cached org id, kuch nahi — jo client pe padi hai wo client badal sakta hai, aur ek baar aisi value request mein chali gayi to wo authorization input ban jaati hai.

**4. Resolve EK BAAR per request** — middleware ya base controller mein, har service mein baar-baar nahi.

> Do wajah, aur dono important hain. Performance chhoti wali hai (ek lookup vs ek dozen). Asli wajah: **jo cheez har service khud resolve karti hai, wo wo cheez hai jise ek service karna bhool jayegi.** Ek jagah resolve karna matlab "kya is endpoint ne scope check kiya" ka jawab poore codebase mein ek hi file padh ke mil jaata hai.
>
> `jp_app` ka resolved context (`SchoolId` + branch scope) `internal` rahega — wahi mechanism jo 2.36 mein `UserLoginRow` pe use kiya. API project us type ka naam bhi na le sake, to use response mein daalna compile hi nahi hoga.

#### Phase 3 mein test — sirf unit test nahi, INTEGRATION test

Ek test jo prove kare ki **school A ka user school B ki jobs kisi bhi parameter se nahi padh sakta jo wo control karta hai.** Do schools seed karo, dono ke paas jobs, phir A ke token se try karo:

| attempt | expected |
|---|---|
| body/query mein B ka `organizationUid` | ignore ho, A ka data mile |
| B ki `branchId` job create pe | `NOT_FOUND` |
| B ki `jobId` GET / PUT / DELETE pe | `NOT_FOUND` (`FORBIDDEN` nahi) |
| list endpoint bina kisi param ke | sirf A ki rows, count exact match |
| B ka `schoolId` jahan bhi field mile | ignore ho |

Aakhri assertion sabse zaroori hai: **koi bhi response body `SchoolId` leak na kare.** Agar wo bahar jaati hai to agla developer maan lega ki use wapas bhi bheja ja sakta hai, aur poora rule wahin khatam.

---

### 🔴 2.41 SAAT REPOSITORIES (LOCKED — client decision 2026-08-08)

Har frontend project apni alag GitHub repository mein.

```
D:\Projects\
├── jp-docs\      ← PROJECT_MEMORY, HOW_TO_RUN, DB_TABLE_STRUCTURE, screenshots
├── jp-shared\    :4999  design system + core — Module Federation remote (2.42)
├── jp-admin\     :4200
├── jp-school\    :4300
├── jp-teacher\   :4400
├── jp-public\    :4500  standalone SSR site
└── jp-backend\   dono APIs + JP.Core/Domain/Infrastructure + saare DB scripts
```

Sibling folders, koi parent nahi. Har ek apni independent git repo.

⚠️ **Ye layout load-bearing hai, convention nahi.** SCSS build time pe
`../jp-shared/src/styles` se resolve hoti hai — dekho 2.42.

#### 🔴 BACKEND EK HI REPO REHTA HAI — ye dobara mat kholo

`JP.Core`, `JP.Domain` aur `JP.Infrastructure` ko **dono** APIs reference karti
hain. APIs ko alag karne ka matlab hota in teeno ko NuGet packages banana, aur
phir har backend change ek **version-bump → build → publish → consume** cycle
ban jaata.

Dono APIs deploy bhi saath hi hoti hain, to alag karne se **kuch milta nahi**
aur har change pe ek publish step **lag jaata**.

#### jp-docs kyun hai

Saat repos ka matlab saat sessions jo alag-alag samajh se shuru kar sakte hain.
`PROJECT_MEMORY.md` wahi rokta hai.

⚠️ **Use kisi doosri repo mein copy MAT karo.** Teen copies ek hafte mein teen
versions ban jaati hain, aur us file ki poori value yahi hai ki wo **ek** hai.
Baaki har repo ka README yahan point karta hai: jp-docs sibling ke roop mein
clone hogi, aur kaam shuru karne se pehle PROJECT_MEMORY padhi jaayegi.

#### Cross-app login guard

Teeno apps ek hi SSO API se authenticate karte hain, to school owner teacher app
pe **successfully** sign in kar sakta hai — token asli, app galat. Bina handle
kiye: khaali sidebar, blank page, aur banda samjhega product toota hai.

`utype` claim **login ke baad** aur **bootstrap pe** check hota hai. Mismatch pe:
**local** sign-out, phir saaf batao kiska account hai aur kahan jaana hai,
chalte hue link ke saath. Target URLs `environment.ts` se, hardcoded nahi.

⚠️ **Security boundary NAHI hai** — token valid rehta hai aur server use maanega.
Ye wayfinding hai; access server ke permission checks rokte hain (2.6, 2.39).

#### Token storage

`TokenStorageService` prefix `JP_APP_IDENTITY` se leta hai —
`jp.admin.accessToken`, `jp.school.accessToken`. Subdomains waise hi isolate
karte hain; prefix isliye hai ki wo isolation **deployment decision pe depend na
kare**.

#### Master data screens jp-admin mein, config-driven

Alag MDM app nahi. Ye screens ek super admin mahine mein do baar use karta hai —
uske liye alag app, deployment aur `node_modules` cost hai, benefit nahi.

Saari 17 master tables ka shape ek hi hai (`Code`, `Name`, `DisplayOrder`,
`Is_Active`), to **ek config-driven component** sab handle karega, 17
milti-julti screens nahi. Nayi master add karna ek dictionary entry banega, nayi
screen nahi.

Geography ko apni alag screen milegi — usme parent cascade aur bulk import
chahiye, jo generic manager ko absorb karne ki koshish nahi karni chahiye.

#### Parallel sessions — discipline, tooling nahi

1. Har session apni repo + `jp-docs` sibling. Pehla kaam:
   `../jp-docs/PROJECT_MEMORY.md` padho.
2. **`jp-shared` ek waqt mein ek session.** Concurrent edits conflict karenge aur
   har app apni copy ke against theek build karta rahega — conflict tab tak
   invisible jab tak mehnga na ho jaaye.
3. **`PROJECT_MEMORY.md` bhi ek waqt mein ek session likhega.** Do sessions
   progress log mein append karenge to ek doosre ko clobber kar denge.

Dono discipline hain, tooling nahi. Deadline pressure mein sabse pehle yehi
tootenge — isiliye git history maujood hai.

---

### 🔴 2.42 MODULE FEDERATION — FRONTEND STRUCTURE **LOCKED** (client decision 2026-08-08)

Ye **2.41 ka npm-package wala hissa replace karta hai**. Saat repos, ports, aur
backend-ek-repo wala reasoning waisa hi rehta hai. Structure ab **band hai** —
Phase 8 tak dobara nahi khulega.

```
jp-shared   :4999   REMOTE — ek baar chalao, chalta rehne do
jp-admin    :4200   host
jp-school   :4300   host
jp-teacher  :4400   host
jp-public   :4500   STANDALONE — federated NAHI hai (neeche wajah)
```

#### npm package kyun chhoda

`jp-shared` npm package tha, `npm link` se consume hota tha. Do cheezein tooti:
repo split ke baad SCSS path resolution, aur har change pe
**build → link → app restart** ka cycle. Wo cycle hi roz ke kaam mein sabse
bada ghisav tha.

Ab: **JavaScript runtime pe share hoti hai** (federation), **SCSS build time pe**
(sibling include path). Git ka isme koi role nahi — saat repos, sirf push/pull,
koi publishing nahi, koi registry nahi, koi version bump nahi.

#### 🔴 Native Federation — do cheezein jo docs mein nahi milti

**1. Expose keys `ui` hain, `./ui` NAHI.**

Runtime import map ki key `join(name, exposeKey)` se banti hai aur use
normalise nahi karta. To conventional `'./ui'` se specifier `jp-shared/./ui`
banta hai — jise koi host import nahi kar sakta:

```
Unable to resolve specifier 'jp-shared/ui' imported from http://localhost:4300/
```

`./` hataane se key exactly `jp-shared/ui` banti hai. `./` sirf
`loadRemoteModule()` ko chahiye, jo hum use nahi karte.

**2. Static import ka koi documented raasta nahi hai — `externals` se banaya.**

`FederationConfig` mein `remotes` field hai hi nahi, aur `loadRemoteModule()`
async hai — wo component ke `imports: []` array ko feed nahi kar sakti, kyunki
Angular ko class chahiye, promise nahi. 50 templates mein use hone wale design
system ke liye wo raasta bekaar hai.

To har host apni `federation.config.mjs` mein:

```js
externals: ['jp-shared/ui', 'jp-shared/core', 'jp-shared/models', 'jp-shared/pages']
```

Isse ye chaar specifier build output mein **unresolved** chhut jaate hain, aur
`initFederation` jo import map lagata hai wo inhe browser mein :4999 ke bundles
pe resolve karta hai. TypeScript inhe sirf **types** ke liye resolve karta hai,
tsconfig `paths` se.

**3. Hosts mein `ignoreUnusedDeps` band rakhna hai.**

Wo Sheriff se import graph chalta hai, aur Sheriff project root ke bahar ki
file par mana kar deta hai:

```
Error: D:\Projects\jp-shared\src\ui\...\ui-app-shell.component.ts
is outside of root D:\Projects\jp-school
```

tsconfig `paths` jaan-boojh kar sibling repo pe point karta hai, to ye traversal
hamesha root chhodega aur hamesha fail karega.

⚠️ **Iska ek side effect hai**: pruning band hone se esbuild
`@angular/platform-browser` ke animations entry points bhi bundle karta hai, jo
`@angular/animations/browser` import karte hain. **Isiliye `@angular/animations`
har host ki dependency hai jabki koi code use nahi karta.** Hataoge to build
`Could not resolve @angular/animations/browser` pe marega — aur `skip` isse
theek NAHI karta, kyunki `skip` control karta hai kya SHARE hoga, kya resolve
hoga wo nahi.

#### 🔴 Angular singletons — sirf declare nahi, prove kiya

`@angular/core`, `common`, `router`, `forms`, `rxjs` — `singleton: true`,
`strictVersion: true`. Do Angular copies ka matlab do `InjectionToken` classes,
do DI graphs, do `AuthService` — yaani login safal dikhta hai aur shell samajhta
hai ki aap signed out ho.

Proof (jp-school :4300 chalte hue, remote :4999):

| kya | result |
|---|---|
| `@angular/core` copies page mein | **1** |
| `JP_APP_IDENTITY instanceof ng.InjectionToken` | **true** |
| `jp-shared/core` do baar resolve → same class | **true** |
| sign-in → `/dashboard`, `ui-app-shell` render | ✔ |
| storage keys | `jp.school.accessToken`, `jp.school.refreshToken` |

Beech wali line asli proof hai: **remote** ne jo token banaya wo **host** ki
`InjectionToken` class ka instance hai. Do Angular hote to `false` aata.

#### ⚠️ jp-public federated NAHI hai — STANDALONE

Attempt karne se pehle dekha: **jp-public ek bhi shared JavaScript import nahi
karta.** Ek bhi TS file mein nahi. Uska jp-shared se rishta sirf SCSS tokens ka
hai.

To federate karne se milta kuch nahi aur lagta ye: es-module-shims polyfill,
bootstrap se pehle initFederation ka round-trip, :4999 par runtime dependency,
aur SSR ke liye Native Federation ka node-loader — sab **chaar buttons** share
karne ke liye jo wo use hi nahi karta. Uski SEO behaviour zyada important hai.

**jp-public normal Angular SSR app rehta hai.** SCSS wahi sibling include path
se leta hai, baaki sab jaisa. Ye exception nahi hai — SCSS sabke liye build-time
hai.

#### 🔴 SCSS build time pe — CI ko ye pata hona chahiye

Har app ki `angular.json`:

```json
"stylePreprocessorOptions": { "includePaths": ["../jp-shared/src/styles"] }
```

Components waise hi `@use 'variables' as v;` likhte hain — koi relative path
nahi, koi copy nahi. Naya token add karna aaj bhi jp-shared mein **ek file ka
change** hai.

⚠️ **CI ko `jp-shared` app ke saath checkout karna hoga**, warna build pehli hi
component stylesheet pe fail hoga. Sirf ek repo clone karne wala agent isse
compile nahi kar sakta. Har app ke README mein likha hai.

⚠️ **Deep-nested component verify karna zaroori tha, top-level se kaam nahi
chalta** — original error wahi se aaya tha. jp-admin aur jp-teacher mein koi
bhi deep component shared partials use hi nahi kar raha tha, to unka build pass
hona kuch **prove nahi karta tha**. Dono ke sabse gehre component stylesheet
mein ab jaan-boojh kar `@use 'variables'` + `@use 'mixins'` hai, comment ke
saath ki ye dead code nahi hai. Include path galat kar ke check kiya —
build theek us deep file pe fail hota hai.

#### 🔴 Production — ek single point of failure, jaan-boojh kar

`jp-shared` static files bana kar ek URL se serve hota hai, jo har app ki
environment config se aata hai, hardcoded nahi.

⚠️ **Agar jp-shared ka host down hai to teeno apps boot hi nahi karengi.** Ye
trade hum le rahe hain.

**Mitigation (implement karna hai):** jp-shared ko **apps ke same origin** se
serve karo. Tab alag failure point rehta hi nahi — wo server down hai to waise
bhi sab down hai.

#### Dev workflow — poora point yehi tha

```bash
cd jp-shared && npm start     # :4999 — ek baar, chalta rehne do
cd jp-school && npm start     # :4300
```

jp-shared mein component edit karo → app reload karo → change dikh jaata hai.
Koi publish nahi, koi version bump nahi, koi link step nahi. Verify kiya:
`ui-auth-shell` mein attribute add kiya, jp-school reload kiya, DOM mein mila.

⚠️ **Ek honest detail**: app ka dev server phir bhi ~0.2s ka rebuild karta hai,
kyunki tsconfig `paths` jp-shared ki **source** pe point karta hai, to uska
watcher bhi us par lagta hai. Ye automatic hai aur "no build step" ke spirit ko
poora karta hai (koi publish/link/version cycle nahi), par literally zero nahi
hai. Isse hatane ka ek hi tareeka hai — pre-built `.d.ts` consume karna — jo
jp-shared mein type-change pe manual build step wapas le aata, aur stale types
ke confusing errors bhi. Isliye source-paths rakha gaya.

⚠️ **Dev server chalte waqt production build MAT chalao.** Dono federation
externals cache share karte hain, aur production build dev wali
`@angular/core` copy ko replace kar deta hai. App phir isse marta hai:

```
ReferenceError: ngDevMode is not defined
```

Message cause ke baare mein kuch nahi batata. Fix: dev server band karo,
`.angular/cache` delete karo, dobara start karo. Ye actually hua tha.

#### Hataya gaya — poora ka poora

GitHub Packages `publishConfig` · `.npmrc` aur `.npmrc.example` (chaaron apps) ·
`.github/workflows/publish.yml` · `link:shared`/`unlink:shared`/`update:shared`/
`shared-version` scripts · `check-versions.mjs` aur uska npm script ·
`bump-version.mjs` · `src/lib/version.ts` aur `logSharedVersion` calls ·
`ng-package.json` · `tsconfig.lib*.json` · `public-api.ts` · `preserveSymlinks` ·
global `npm link` registration · chaaron apps ke stale symlinks aur `@tarun1515`
scope references.

Version-drift ki machinery **ab zaroori nahi** — chaar copies thi hi isliye ki
package chaar baar install hota tha. Ab ek hi copy chalti hai, :4999 se.

---

### 2.43 PUBLIC SITE — AUDIENCE CHOOSER (`/continue`)

`jp-public` par ek hi jagah hai jahan visitor ka irada **pata nahi hota**:
header ka Sign in / Sign up. Us click se ye maloom nahi hota ki banda school
hai ya teacher, aur guess karne ka matlab hai aadhe logon ko galat login screen
pe bhejna.

#### Entry point jp-public ke paas kyun hai

Teeno apps **alag origins** pe hain — :4300, :4400, :4200. Koi bhi app apne
andar se ye choice nahi de sakti, kyunki wo pehle hi ek audience chun chuki hai.
**jp-public akeli jagah hai jahan se teeno dikhte hain**, to entry point yahin
hona hai. Ye layout ka side effect nahi, iska kaam hai.

**Route:** `/continue?mode=login` ya `?mode=signup`.

Do options, **barabar weight** — ek hi sheet, beech mein ek rule. Grid
`1fr 1fr`, kabhi `auto 1fr` nahi: warna lamba text zyada jagah le lega aur wo
"recommended answer" jaisa padhne lagega. **Ye page ek fork hai, recommendation
nahi.**

Copy **kaam** ke hisaab se hai, pehchaan ke nahi — "Hire teachers" /
"Find a teaching job", "I am a school" nahi. Banda apna kaam pehchan kar click
karta hai, khud ko classify kar ke nahi.

#### 🔴 Admin ka option nahi hai — aur ho bhi nahi sakta

Admin internal hai. Kisi public page pe uska naam, link ya zikr nahi.

Ye **compiler se enforce** hai, yaad rakhne se nahi: `Audience` type sirf
`'school' | 'teacher'` hai. Koi page admin pe link karega to **compile hi nahi
hoga**.

⚠️ **Ye page "adhoora" nahi hai.** Do cards hain aur do hi rahenge. Baad mein
koi teesra card add kar ke ise "complete" karne ki koshish mat karna — jise
admin chahiye use URL pata hai.

#### Kaun chooser dekhta hai aur kaun nahi

| Entry point | Kahan jaata hai |
|---|---|
| Header **Sign in** | `/continue?mode=login` |
| Header **Sign up** | `/continue?mode=signup` |
| Footer "Register your school" / "Create a profile" | **seedha** app pe — sawaal already jawab de chuka hai |
| Homepage dual CTA | **seedha** app pe (jab homepage banega) |
| Job detail "Apply" | **seedha** teacher signup pe, job redirect target ke saath |

Jisne pehle hi bata diya ki wo kaun hai, use chooser dikhana sirf ek extra
click hai.

#### Server-rendered, prerender NAHI

`/continue` ka content `mode` query param pe depend karta hai, aur prerendered
file har query string ke liye ek hi HTML hoti hai. `?mode=signup` pe aane wale
ko pehle "Sign in" dikhta aur hydration ke baad badalta. Isliye
`RenderMode.Server`, aur `mode` `withComponentInputBinding()` se aata hai taaki
pehle byte mein hi sahi ho.

#### 🔴 URLs ek hi jagah se bante hain

`src/app/core/portal-links.ts` **akela** module hai jo portal URL banata hai.
Hosts `environment.appUrls` se aate hain, hardcoded nahi.

⚠️ **Paths `/auth/login` aur `/auth/register` hain.** Mode ke naam se path
banaoge to `/login` aur `/signup` milega — dono apps ka **404**. Ye galti ek
baar ho chuki hai.

#### Jo abhi bana hi nahi hai

- **Homepage aur job detail page exist nahi karte.** `app.routes.ts` mein sirf
  `/continue` hai. Header/footer ke `/jobs`, `/for-schools`, `/how-it-works`
  wagairah **kahin nahi jaate** — wo Phase 4 hai, CMS tables se banega.
- `applyToJobUrl()` likha hua hai par **`jp-teacher` ka register component abhi
  `redirect` query param padhta nahi**. Job page banne se pehle wo add karna hai.

#### jp-public iske liye federate NAHI hui

Chooser ne jp-public ka unfederated hona **nahi badla**. Wo abhi bhi ek bhi
shared JavaScript import nahi karti (HOW_TO_RUN §3.7). Dono option cards
jp-public ki apni styles se bane hain — shared `ui-*` component ek bhi nahi.

Chaar buttons share karne ke liye ek poori runtime dependency (:4999) aur SSR ki
complexity lena ulta sauda hota.

#### Design tokens — ek purani drift jo yahan pakdi gayi

`jp-public` ke paas apna `_variables.scss` tha, upar comment ke saath ki
"portal ke identical hai, in step rakhna". **Rakha nahi gaya**: Phase 1D mein
apps "The Register" pe chali gayin aur ye site purane corporate blue
(`#2563eb`, Segoe UI) pe hi khadi rahi — aur kuch bhi build fail nahi hua.
Marketing site aur jo product wo bech rahi thi, do alag brand the.

Ab `jp-public` ke paas **koi token nahi** — na `_variables.scss`, na
`_mixins.scss`. Sab `jp-shared` se aata hai build-time include path se, baaki
apps ki tarah. Uske apne partials sirf layout/typography/components hain, jo
marketing pages ke liye alag hone chahiye.

⚠️ **Local `_variables.scss` dobara mat banao.**

---

### 2.44 PUBLIC SITE — STATIC PAGES (Phase 1 scope)

Pehle `localhost:4500` par `Cannot GET /` aata tha aur header ke links kahin
nahi jaate the. Ab poori static site hai.

| Route | Kya hai |
|---|---|
| `/` | Homepage — hero, do CTA, condensed how-it-works, verification, Phase 4 placeholder |
| `/how-it-works` | Teacher aur school ki alag-alag journey (`#teachers`, `#schools`) |
| `/about` | Verification kyun, aur kiske liye banaya |
| `/faq` | Audience ke hisaab se, `#teachers` / `#schools` |
| `/contact` | Form — validate hota hai, **bhejta nahi** (neeche dekho) |
| `/terms`, `/privacy` | Asli structure, body **legal review pending** |
| `/continue` | Pehle se tha (2.43) |
| `**` | 404 |

#### 🔴 Jo jaan-boojh kar NAHI banaya

Job search, job detail, featured jobs, featured schools. Inhe data chahiye jo
Phase 4 tak exist nahi karta, aur mock data pe banane ka matlab hota **do baar
banana**.

Homepage pe jahan featured jobs aayenge wahan ek **dashed placeholder band** hai
— jaan-boojh kar nakli job cards nahi. Code mein `⚠️ PHASE 4 PLACEHOLDER` comment
hai jisme likha hai usse bharna kaise hai.

⚠️ **Header se "Find jobs" aur footer se "Browse jobs" hata diye.** Wo `/jobs`
pe jaate the jo exist nahi karta. Nav item jo 404 pe le jaaye, wo banne hue
product ko toota hua dikhata hai — item ka na hona behtar hai. Phase 4 mein
wapas aayenge.

#### 🔴 Koi nakli statistics nahi

"10,000+ teachers" jaisa kuch is page pe nahi hai aur tab tak nahi aayega jab
tak sach na ho. Bina users wale product pe wo demo mein client ka bharosa
sabse tez todta hai, aur baad mein hatana hi padta hai.

#### Contact form — endpoint hai hi nahi (Phase 7)

`t_app_contact_enquiries` aur uska API Phase 7 hai. To form **validate karta hai
aur phir sach bolta hai**: saaf likhta hai ki bheja nahi gaya, email address
deta hai, aur ek `mailto:` button jo likha hua sab pre-fill kar deta hai.

🔴 **Success message jaan-boojh kar nahi hai.** Koi banda ye form bharega aur
jawab ka intezaar karega — nakli "thanks, we'll be in touch" ka matlab hota uski
enquiry gayab aur wo kabhi dobara koshish nahi karta. Bhadda message chalega,
kho jaana nahi chalega.

#### 🔴 Terms aur Privacy — client sign-off ke bina LIVE NAHI

Headings asli hain (Privacy mein **DPDP Act 2023** ki obligations bhi named
hain). Body **plain-language placeholder** hai taaki page review ho sake.

⚠️ **Kisi lawyer ne na likha hai na check kiya hai.** Dono pages pe ek loud
`draft-notice` hai. **Client ko final wording deni ya approve karni hogi launch
se pehle.** Client ki taraf se enforceable terms invent karna hamara kaam nahi
hai.

#### SEO — abhi kiya, kyunki abhi sasta hai

- Har route ka apna title + meta description, route `data` mein (`SeoService`)
- Open Graph + Twitter card + **absolute** canonical (`environment.siteUrl` se)
- `robots.txt` (`/continue` disallow — wo routing step hai, content nahi) aur
  `sitemap.xml`
- Ek `h1` per page, heading order bina skip ke
- **Lighthouse SEO 100 aur Accessibility 100 — saaton pages pe**

⚠️ `twitter:card` `summary` hai, `summary_large_image` nahi — abhi koi
`og:image` nahi hai. Bina image ke large card blank panel dikhata hai.

#### Prerender, SSR nahi

Ye pages query params nahi lete aur per-request kuch nahi badalta, to
`RenderMode.Prerender` — build time pe asli HTML. `/continue` akela
`RenderMode.Server` rehta hai (2.43).

#### Do a11y bugs jo Lighthouse ne pakde aur fix hue

1. **`--jp-text-subtle` (#7e908a) chhote text pe contrast fail karta hai** —
   white pe 3.36:1, chahiye 4.5:1. jp-public ke labels ab `--jp-text-muted`
   use karte hain. **Token ki value nahi badli** — wo shared hai, apps use
   karti hain.
2. **Body copy ke links sirf colour se pehchane ja rahe the** — surrounding
   text se contrast 1.7:1, chahiye 3:1. Ab `p`/`li`/`dd` ke andar ke links
   underlined hain (`.btn` chhod kar).

#### `.section--alt` ab white hai, `--jp-surface-alt` nahi

Page ka ground chalk hai (`--jp-bg` = #f3f6f4) aur `--jp-surface-alt` (#f8faf9)
usse **halka** hai — to "alternate" band ground se farq hi nahi karta tha.
Register ka idiom chalk ground pe **white sheets** hai, to alternate ka matlab
wahi hai.

#### jp-public abhi bhi unfederated hai

In saat pages ne wo nahi badla. Ek bhi shared JavaScript import nahi hai —
404 page tak `jp-shared/pages` se nahi liya, kyunki us ek page ke liye poori
app federate karni padti. Design tokens waise hi build-time SCSS include path
se aate hain.

---

## 2A. KNOWN GAPS — Phase 1 close-out (2026-08-08)

Sab kuch jo jaan-boojh kar adhoora, stubbed ya defer kiya gaya hai. **Ye list
maintain karni hai** — Phase 5 mein inhe dobara discover karna sabse mehnga
tareeka hai.

Har item pe: kya hai, kyun chhoda, aur kahan theek hoga.

---

### 🔴 G0. SAAT REPOS MEIN SE KISI KA GIT REMOTE NAHI HAI

```
jp-shared, jp-admin, jp-school, jp-teacher, jp-public, jp-docs, jp-backend
  -> git remote: (koi nahi)
```

Sab kuch **sirf is machine pe** hai. Har commit local hai, kahin push nahi hua.
Disk gaya to poora Phase 1 gaya — database scripts, dono APIs, chaaron frontend
projects, aur ye file bhi.

**Ye technical gap nahi hai, ye risk hai.** Phase 2 shuru karne se pehle GitHub
pe saat repos banao aur push karo. `gh` CLI is machine pe install nahi hai, to
ya to install karo ya repos web se banao aur `git remote add origin` chalao.

---

### G1. Design items — Phase 1D review se bache hue

| # | Item | Status |
|---|---|---|
| 1 | Password **Show** toggle field mein content hone par wapas nahi aata | ✅ **Fix ho chuka** — 2026-08-08 ko browser mein verify kiya: type pe aata hai, clear pe jaata hai, dobara type pe **wapas aata hai**, click pe `Hide` + `type=text`. Template `@if (value())` hai aur `onInput` har keystroke pe `value` set karta hai |
| 2 | Split panel **1440 se upar** toot-ta hai | ⏳ Open — aaj re-verify nahi kiya |
| 3 | Dashboard panel **height mismatch** | ⏳ Open — aaj re-verify nahi kiya |
| 4 | Job titles **375 pe truncate** ho rahe | ⏳ Open — aaj re-verify nahi kiya |

⚠️ 2, 3, 4 client ki report ke hisaab se carry kiye hain; maine aaj sirf #1
check kiya kyunki uske code se ulta lag raha tha. Baaki teen Phase 2E/2F mein
un screens ko chhoote waqt verify karke fix karne hain.

---

### G2. Public site layout — ✅ SAB FIX HO CHUKE (commit `c7fe8fd`)

Ye Phase 1 close-out ke liye report hue the, par usi din fix ho gaye. Record
ke liye, taaki dobara list na hon:

| Item | Kya nikla |
|---|---|
| About/Terms centre, FAQ/How-it-works left-align | About/Terms column `.container` **par** tha (centred), FAQ/How-it-works ne usse **andar** rakha (left). Ab ek convention: `.measure` (44rem) aur `.measure--wide` (64rem), dono centred |
| FAQ 1440 pe aadha viewport khaali | Wahi wajah. Ab centred |
| Homepage "Every school is checked" misaligned | 88rem container mein 44rem column left-aligned tha. Ab centred |
| Contact pe header form ke beech render ho raha | 🔴 **Bug nahi tha.** Playwright ke `fullPage` capture ka artifact — wo scroll karke stitch karta hai aur `position: sticky` header har band mein dobara render hota hai. DOM mein ek hi `.site-header` hai aur scroll pe uska viewport `top` exactly 0 rehta hai. Capture script ab sticky ko neutralise karta hai |

Measure ke baad: har page ka column 2px ke andar centred. Lighthouse SEO 100 +
a11y 100 saaton pages pe.

---

### G3. Jo bana hi nahi — Phase 4 (data chahiye)

- **Job search, job detail, featured jobs, featured schools.** Inhe
  `JP.App.Api` aur job tables chahiye. Homepage pe dashed **placeholder band**
  hai (`⚠️ PHASE 4 PLACEHOLDER` comment ke saath), nakli job cards nahi.
- **Header se "Find jobs" hataya hua hai.** `/jobs` exist nahi karta; 404 pe
  jaane wala nav item bane hue product ko toota dikhata hai. Job search ke saath
  wapas aayega.
- **`applyToJobUrl()` likha hua hai par doosra sira nahi juda.** Wo
  `teacher app /auth/register?redirect=/jobs/<slug>/apply` banata hai, par
  **jp-teacher ka register component `redirect` param padhta hi nahi**. Job page
  banne se pehle ye add karna hai, warna Apply ke baad banda dashboard pe girega.

### G4. Jo bana hi nahi — Phase 7

- **Contact form ka koi endpoint nahi.** `t_app_contact_enquiries` aur uska API
  Phase 7 hai. Form validate karta hai, phir **saaf batata hai ki bheja nahi
  gaya** aur prefilled `mailto:` deta hai. 🔴 Success message jaan-boojh kar
  nahi hai — nakla confirmation ka matlab asli enquiry gayab.

### G5. Client se chahiye — launch blocker

- 🔴 **Terms aur Privacy legal review ke bina live nahi ja sakte.** Headings
  asli hain (Privacy mein DPDP Act 2023 ki obligations named hain), body
  plain-language placeholder hai, dono pages pe loud `draft-notice` hai.
  **Client ko wording deni ya approve karni hai.**
- **Pricing finalise nahi hai.** FAQ isse seedha bolta hai; Terms §6 tab tak
  likha nahi ja sakta.
- **`og:image` nahi hai**, isliye `twitter:card` `summary` hai,
  `summary_large_image` nahi. Share image milte hi dono badalne hain.
- **Domain confirm hona hai.** `environment.production.ts` ka `siteUrl` aur
  `public/sitemap.xml` ka host — dono ek saath badalne hain.

### G6. Mockup hai, asli nahi

- 🔴 **jp-school ka Dashboard aur Applicants poori tarah static hain.** Saare
  numbers, applicant names, job titles aur stage counts component mein hardcoded
  hain. **Koi API call nahi hoti.** Ye Phase 2/3 mein `JP.App.Api` se juden ge.
  ⚠️ Client demo mein inhe "bana hua" bol kar mat dikhana.
- **School approve karne ka koi admin UI nahi.** Abhi Swagger se
  `PUT /api/users/{userUid}/status` chalana padta hai. Phase 2E.
- **`JP.App.Api` mein koi business endpoint nahi** — sirf health. Phase 1 ka
  sab kuch `JP.Sso.Api` hai.

### G7. Operational — inhe jaanna zaroori hai

- **Production mein `jp-shared` down = teeno apps boot nahi hongi.** Ye
  federation ka accepted trade hai. **Mitigation implement karna hai: usse apps
  ke same origin se serve karo** (2.42).
- **CI ko `jp-shared` app ke saath checkout karna hoga**, warna SCSS pehli
  component stylesheet pe fail hoga.
- **Dev server chalte waqt production build mat chalao** — `ngDevMode is not
  defined`. Fix: dev server band, `.angular/cache` delete (HOW_TO_RUN §3.5).
- **`@angular/animations` teeno hosts ki dependency hai jise koi import nahi
  karta** — `ignoreUnusedDeps` band hone ka side effect. Hatana build todta hai.
- **"No build step in the app" literally zero nahi hai** — app ka dev server
  phir bhi ~0.2s incremental rebuild karta hai, kyunki tsconfig `paths`
  jp-shared ki source pe point karta hai.
- **`sitemap.xml` haath se maintain hota hai.** Naya route add karo to usme URL
  bhi add karna hai.
- **SMTP dev mein band hai** — emails `jp-backend\JP.Sso.Api\App_Data\mail-drop\*.eml`
  mein girti hain.
- **Public job search ke bina teacher bina account ke browse nahi kar sakta.**
  FAQ isse seedha bolta hai. Phase 4 isse badlega.

### G8. Test coverage

- **SQL tests hain (121 assertions), C#/Angular unit tests NAHI hain.** Koi
  xUnit project nahi, koi Karma/Jest spec nahi. Verification abhi SQL suites +
  browser checks pe depend karta hai.
- ⚠️ **Test 001 aaj toota hua mila aur fix hua.** `USP_CreatePasswordResetToken`
  ab `UserTypeId` bhi return karta hai (per-app reset links ke liye), par test ka
  `#ResetTok` temp table 5 column ka reh gaya tha — `INSERT ... EXEC` 6 values
  nahi le paaya. Sabak: **proc ka result set badlo to usi commit mein test ka
  temp table badlo.**

---

## 3. SCOPE (Client spec ke against)

### IN SCOPE — MVP
Teacher module · School module · Admin panel · Public website · Job posting & search · Application pipeline · Notifications (in-portal + email) · Teacher search & invite · Report/complaint · Job moderation · CMS · Verified badges · Reports/dashboard

### OFFER LITE (⚠️ client se confirm)
Client ne spec point 7 (Interview & Offer) ignore karne ko kaha, **lekin point 15 ka MVP success criterion aur point 14 checklist isi pe depend karta hai.**
Decision: **Offer Lite** rakhenge —
- Application status mein `Selected` stage
- Simple offer record (designation, salary, joining date)
- Teacher Accept / Decline
- **Interview scheduling ka fancy part hata diya** (meeting links, panel, online/offline mode) → Phase 2

### OUT OF SCOPE — Phase 2
AI candidate matching · AI resume scoring/generation · Video interview / demo class · Advanced analytics · Subscription & billing · Payroll/HRMS · Background verification · WhatsApp automation · AI interviewer · **Advanced multi-level HR permissions**

---

## 4. OPEN QUESTIONS — CLIENT SE POOCHNA HAI

| # | Question | Status |
|---|---|---|
| 1 | Point 7 ka exact scope — sirf interview scheduling hata rahe hain ya offer flow bhi? | ⏳ Pending |
| 2 | Public website MVP mein chahiye ya launch ke baad? (26 dev-days ka farak) | ⏳ Pending |
| 3 | School branches support karni hai? (spec single address imply karta hai, humne multi-branch design kiya) | ⏳ Pending |
| 4 | Payment/subscription MVP mein? (point 12 vs point 13 contradiction) | ⏳ Pending |
| 5 | Master data kaun dega — subjects, qualifications, designations, boards ki official list? | ⏳ **BLOCKING Phase 2 seed** |
| 6 | Email/SMS provider kaunsa? (SendGrid/SES/MSG91) Budget kiska? | ⏳ Pending — abhi plain SMTP behind `IEmailService`, teeno usi ko bolte hain |
| 7 | Teacher hard gate ya soft verification? (humne soft decide kiya) | ⏳ Pending |
| 8 | Admin "Settings" screen ka scope kya hai? (spec point 3 mein hai, detail nahi) | ⏳ Pending |
| 9 | File storage — S3 / Azure Blob / local server? | ⏳ Pending — abhi local disk behind `IFileStorageService`, swap = 1 class |
| 10 | Domain, hosting, SSL kaun arrange karega? | ⏳ Pending |

> Q6 aur Q9 ab **blocking nahi** hain — dono interface ke peeche hain, decision baad mein bhi ho sakta hai bina kuch tode.

---

## 5. PROGRESS LOG

| Date | Phase | Kya hua | Status |
|---|---|---|---|
| 2026-08-08 | — | Architecture finalize, table structure decide, client spec audit | ✅ Done |
| 2026-08-08 | 0 | **Database skeleton** — `run_all.sql` orchestrator, teeno DB ka `00_create_database.sql` (idempotent, compat level 150 pinned), `_TEMPLATE_table.sql` canonical shape | ✅ Done |
| 2026-08-08 | 0 | **Solution + 5 projects** — layering reference-graph se enforce, Central Package Management, warnings-as-errors | ✅ Done |
| 2026-08-08 | 0 | **JP.Core** — `Response<T>` + `ApiResponse` factory, ErrorCodes, JpClaimTypes, AppConstants, 7 enums, 6 exceptions, ClaimsPrincipal extensions | ✅ Done |
| 2026-08-08 | 0 | **JP.Domain** — PagedRequest (self-clamping), PagedResult, LookupDto | ✅ Done |
| 2026-08-08 | 0 | **JP.Infrastructure** — DbConnectionFactory (3 named), BaseRepository (SP-only Dapper), PBKDF2 PasswordService, SHA-256 TokenHasher, JwtService, LocalDisk storage, MailKit SMTP + templates | ✅ Done |
| 2026-08-08 | 0 | **Middleware + filter** — global exception handler, request logging (bodies kabhi log nahi), `[RequireActiveAccount]`, DI wiring | ✅ Done |
| 2026-08-08 | 0 | **Dono API wired** — Serilog, Swagger+JWT, CORS, envelope-shaped model-state errors, HealthController | ✅ Done |
| 2026-08-08 | 0 | **Build verify** — `dotnet build` 0 warning 0 error; SSO API boot karke `/api/health` hit kiya, envelope + correlation header + Serilog sab verified | ✅ Done |
| 2026-08-08 | 0 | **Angular 22.1.3 scaffold** — `portal` (no SSR) + `public-site` (SSR) | ✅ Done |
| 2026-08-08 | 0 | **Portal shell** — 3 interceptors, 5 guards, AuthService/MasterService/Toast/Loader/ConfirmDialog, PortalShell + 3 layouts, account-status page, full route map | ✅ Done |
| 2026-08-08 | 0 | **Frontend build verify** — portal production build clean, proper lazy chunks | ✅ Done |
| 2026-08-08 | 0 | **Review fix 3** — `DatabaseOptions` add; Encrypt/TrustServerCertificate/ConnectTimeout/ApplicationName ab `Build()` mein configurable. `encrypt_option = TRUE` verify kiya | ✅ Done |
| 2026-08-08 | 0 | **Review fix 4** — password Min/MaxLength enforce; `VerifyPassword` over-length pe derivation se pehle `false`; `MaxVerifyIterations` guard | ✅ Done |
| 2026-08-08 | 0 | **Review fix 5** — 9 transient SQL errors pe retry, 3 attempts, exponential backoff + jitter, har retry logged | ✅ Done |
| 2026-08-08 | 0 | **Review fix 1** — `angular.json` schematics (dono apps); saare 13 portal components 3-file + classic `.component` naming pe migrate | ✅ Done |
| 2026-08-08 | 0 | **Review fix 2** — portal design system (11 SCSS partials) + 13 shared `ui-*` components (39 files); public-site ka lighter set (4 partials) | ✅ Done |
| 2026-08-08 | 0 | **Review fix 6** — SP error convention section 2.21 mein document | ✅ Done |
| 2026-08-08 | 0 | **Strict mode ON** — dono Angular apps mein `strict` + `strictTemplates`; verify kiya ki unreferenced `ui-*` bhi type-check hote hain | ✅ Done |
| 2026-08-08 | 0 | **Full rebuild** — backend 0 warning 0 error; portal prod build clean; public-site SSR build clean | ✅ Done |
| 2026-08-08 | — | **Decision 2.28 (timezone) locked** — storage UTC, business rules IST | ✅ Done |
| 2026-08-08 | 1A | **IST helpers** — `fn_ToIst`, `fn_IstToday`, `fn_IstDateToUtc`, `fn_IstDayRangeUtc` (inline TVF) | ✅ Done |
| 2026-08-08 | 1A | **17 tables** — 7 masters + 10 transactional, numbered dependency order, standard columns sab pe | ✅ Done |
| 2026-08-08 | 1A | **Indexes** — 16 unique (business keys, filtered) + 28 perf; 36 filtered total | ✅ Done |
| 2026-08-08 | 1A | **Seed** — 7 masters, 8 roles, 23 permissions, 71 role-permission grants | ✅ Done |
| 2026-08-08 | 1A | **Run verified** — `localhost\TARUN` pe clean, exit 0. Dusri baar chalane pe 0 objects bane (idempotent) | ✅ Done |
| 2026-08-08 | 1A | **9 constraint tests pass** — lowercase CHECK, CI duplicate block, soft-delete reuse, NULL mobile, one-current-credential, hash length | ✅ Done |
| 2026-08-08 | 1B | **30 stored procedures** — registration (5), login (5), tokens (6), password (4), OTP (2), admin (4), lists (4) | ✅ Done |
| 2026-08-08 | 1B | **Schema fix 018** — `t_sso_user_lockouts.PreviousStatusId`. Lock ne StatusId=5 set karke purana status uda diya tha; Pending school unlock hone pe Active ban jaata aur approval gate bypass ho jaata | ✅ Done |
| 2026-08-08 | 1B | **Schema fix 019** — `CK_..._UnlockedBy` relax kiya. Auto-expiry ke paas koi unlocking person nahi hota; purana "both or neither" constraint har successful post-lockout login rollback kar deta tha | ✅ Done |
| 2026-08-08 | 1B | **Test suite** `99_tests/001_test_sso_procedures.sql` — **68 assertions, sab pass**, poora transaction rollback | ✅ Done |
| 2026-08-08 | 1B | **Instance confirm** — sab kuch `TARUN\TARUN` (named instance) pe hai. Machine ka naam bhi TARUN hai, isliye SSMS mein sirf `TARUN` likhne se **default instance** khulta hai jo khaali hai. SSMS mein `TARUN\TARUN` connect karo | ✅ Done |
| 2026-08-08 | 1B | **Error log** — `t_sso_error_log` + 2 indexes, `USP_LogError` (kabhi throw nahi karta), `_TEMPLATE_procedure.sql` | ✅ Done |
| 2026-08-08 | 1B | **Retrofit** — saare 13 CATCH blocks (6 files) capture→rollback→log→respond pattern pe. Purani shape ka ek bhi block nahi bacha | ✅ Done |
| 2026-08-08 | 1B | **Test 002** — 17 assertions, sab pass. Critical wala: log row rollback ke baad **bacha** (before=0 after=1). Regression 68/68 bhi pass | ✅ Done |
| 2026-08-08 | 1C | **19 endpoints live** — auth (12), users (4), roles (2), permissions (1) | ✅ Done |
| 2026-08-08 | 1C | **Login timing decoy** — `IDummyCredentialProvider` singleton, startup-generated, 210k iterations dono raaston pe (2.32) | ✅ Done |
| 2026-08-08 | 1C | **Hash boundary compiler-enforced** — `UserLoginRow` internal; API mein use naam se refer karne ki koshish `error CS0122` deti hai (2.36) | ✅ Done |
| 2026-08-08 | 1C | **FluentValidationFilter** — deprecated `FluentValidation.AspNetCore` ki jagah shared filter; boot pe saare validators resolve hote hain | ✅ Done |
| 2026-08-08 | 1C | **Stack overflow fix** — `EmailAddress` extension FluentValidation ke apne method ko shadow kar rahi thi, apni hi body ke andar → infinite recursion, process crash. `ValidEmail`/`ValidPassword` (2.34) | ✅ Done |
| 2026-08-08 | 1C | **Chained rate limiter** — login 5/min/IP **+** 10/hour/identifier ek saath; body-key middleware; limits `RateLimits` config section mein (2.35) | ✅ Done |
| 2026-08-08 | 1C | **Email queue** — `Channel` + `BackgroundService`; scoped-service-after-scope-disposed bug band, backlog bounded (2.33) | ✅ Done |
| 2026-08-08 | 1C | **`InvariantGlobalization` false** — SqlClient invariant mode mein connection kholne se mana karta hai | ✅ Done |
| 2026-08-08 | 1C | **`JP.Tools.SeedAdmin`** — PBKDF2 hash operator ki machine pe banta hai, kisi .sql mein nahi. Super admin create + verify | ✅ Done |
| 2026-08-08 | 1C | **Full flow verified** — register school → login (status 1 claim) → refresh → reuse detection (poori chain revoke) → change password → saare devices signed out → naye password se login | ✅ Done |
| 2026-08-08 | 1C | **Security verify** — IDOR (forged orgUid ignore hua), tenant scoping, invite single-use, log hygiene (0 password/token/body), timing measurement | ✅ Done |
| 2026-08-08 | 1C | **Menu system** — `m_sso_menus` + `t_sso_role_menus`, 32 menu seed, `USP_GetUserMenus`, `GET /api/menus`, Angular `MenuService`; teeno hardcoded nav arrays hataaye (2.37) | ✅ Done |
| 2026-08-08 | 1C | **Test 003** — 30 menu assertions, sab pass. Regression 73 + 17 bhi pass = **120 total** | ✅ Done |
| 2026-08-08 | 1D | **Design direction "The Register"** — `_variables.scss` + 11 partials source pe badle; 13 `ui-*` components bina chhue inherit kar gaye (2.38) | ✅ Done |
| 2026-08-08 | 1D | **`ui-roll`** — signature component, 3 sizes. Applications (7 stages) aur verification (3) dono isi se | ✅ Done |
| 2026-08-08 | 1D | **Auth screens** — login, register (school/teacher radio), forgot-password, reset-password, accept-invite, verify-otp; `ui-otp-input` (paste, auto-advance, backspace) aur `ui-password-field` (toggle, strength) | ✅ Done |
| 2026-08-08 | 1D | **Account status rewrite** — roll + "what happens next" 3 steps real timings ke saath + har ACCOUNT_* code ka apna content | ✅ Done |
| 2026-08-08 | 1D | **School dashboard + applicants list** — 50 rows, 8 columns, funnel tile. Rows fixture se (JP.App.Api Phase 2 hai) | ✅ Done |
| 2026-08-08 | 1D | **Screenshots 375 + 1440** — Playwright, asli API ke against, to sidebar sach mein `GET /api/menus` se render hua | ✅ Done |
| 2026-08-08 | — | **Frontend split per audience** — admin / school / teacher / public alag. Storage prefix, cross-app guard, per-app reset links, menu prefixes stripped | ✅ Done |
| 2026-08-08 | — | **Saat repositories** — har frontend project apni git repo, siblings ke roop mein. jp-docs sibling, backend ek hi repo (2.41) | ✅ Done |
| 2026-08-08 | — | **Module Federation migration** — jp-shared library se **remote** (:4999) bana, chaar exposed barrels. jp-admin/school/teacher hosts. npm package, GitHub Packages, npm link, version-drift machinery — sab hataya (2.42) | ✅ Done |
| 2026-08-08 | — | **Federation verify** — teeno hosts remote se `ui-auth-shell` render karte hain, `@angular/core` ki **1** copy, `JP_APP_IDENTITY instanceof ng.InjectionToken` **true**, jp-school sign-in `/dashboard` tak, paanchon prod builds clean | ✅ Done |
| 2026-08-08 | — | **Deep-nested SCSS assertion** — jp-admin/jp-teacher mein koi deep component shared partials use hi nahi kar raha tha, to unka build pass hona kuch prove nahi karta tha. Ab depth-6 pe jaan-boojh kar `@use`, aur include path toad kar verify kiya ki fail hota hai | ✅ Done |
| 2026-08-08 | — | **`/continue` audience chooser** — jp-public, school/teacher fork, admin ka option nahi (compiler-enforced). SSR mode-aware. jp-public ke local design tokens hataye — wo purane blue pe drift ho chuke the (2.43) | ✅ Done |
| 2026-08-08 | — | **Public site static pages** — home, how-it-works, about, faq, contact, terms, privacy, 404. Per-route SEO + OG + canonical, robots.txt, sitemap.xml, prerendered. Lighthouse SEO 100 / a11y 100 saaton pages pe. Job search Phase 4 ke liye chhoda, contact form Phase 7 ke liye (2.44) | ✅ Done |
| 2026-08-08 | 1 | **PHASE 1 CLOSE-OUT** — dono APIs clean rebuild 0/0, 121/121 SQL assertions, paanchon frontend prod builds clean, jp_sso 20 tables · 32 procs · 4 functions · 71 indexes. Known gaps section 2A mein likhe. Test 001 toota mila aur fix hua | ✅ Done |
| — | 2E | Admin screens → `frontend/apps/admin` | ⬜ Next |
| — | 2F | School screens → `frontend/apps/school` | ⬜ Next |

---

## 6. FILES CREATED SO FAR

> ⚠️ **Neeche ke frontend paths 2.41 se PEHLE ke hain** (`frontend/portal/...`,
> `frontend/public-site/...`). Wo folders ab exist nahi karte. Aaj ka mapping:
>
> | Purana | Ab |
> |---|---|
> | `frontend/portal/src/app/shared/ui/` | `jp-shared/src/ui/` |
> | `frontend/portal/src/styles/` | `jp-shared/src/styles/` |
> | `frontend/portal/src/app/core/` | `jp-shared/src/core/` |
> | `frontend/portal/src/app/features/` | `jp-admin` / `jp-school` / `jp-teacher` ke apne `src/app/features/` |
> | `frontend/public-site/` | `jp-public/` |
>
> Files ki LIST abhi bhi sahi hai — sirf unka ghar badla hai. Structure ke liye
> 2.42 aur HOW_TO_RUN §8 dekho.

### `database/`
```
run_all.sql                        sqlcmd-mode orchestrator; build order ka single source of truth
_TEMPLATE_table.sql                Canonical table template — 87 tables isi se cut hongi.
                                   Master / header / bridge / add-column / index / seed patterns
                                   + 2019-vs-2022 syntax ki poori list
jp_sso/00_create_database.sql      Idempotent CREATE DATABASE, compat 150, RCSI on
jp_mdm/00_create_database.sql      same
jp_app/00_create_database.sql      same
```

### `database/jp_sso/` — PHASE 1A (32 scripts, sab run_all.sql mein registered)
```
01_tables/  001..007  m_sso_user_types, m_sso_user_status, m_sso_hash_algorithms,
                      m_sso_token_types, m_sso_otp_channels, m_sso_lock_reasons,
                      m_sso_modules
            008..017  t_sso_users, t_sso_user_credentials, t_sso_user_tokens,
                      t_sso_user_otps, t_sso_user_login_attempts,
                      t_sso_user_lockouts, t_sso_roles, t_sso_permissions,
                      t_sso_role_permissions, t_sso_user_roles
                      -- business-key UNIQUE indexes inhi files mein hain
                      -- (integrity, tuning nahi), par apne alag guard ke saath
02_indexes/ 001..010  Har transactional table ka perf index file
03_seed/    001       Saare 7 masters (MERGE, re-runnable)
            002       8 system roles (RoleCode pe keyed, global only)
            003       23 permissions, 10 modules mein
            004       71 role-permission grants + orphan-role sanity check
04_procedures/ 000    IST/UTC helper functions
```

### `database/jp_sso/` — PHASE 1B (30 procedures + test suite)
```
01_tables/018_alter_..._previous_status.sql    PreviousStatusId + FK + CHECK
01_tables/019_alter_..._unlockedby_check.sql   CK_..._UnlockedBy_V1 (relaxed)

04_procedures/001_registration.sql
    USP_RegisterSchoolUser      StatusId 1, new OrganizationUid, NO role until approved
    USP_RegisterTeacherUser     StatusId 2, TEACHER role immediately
    USP_CreateAdminUser         admin roles only; refuses school/teacher roles
    USP_InviteSchoolUser        no credential; verifies inviter owns the org (IDOR)
    USP_SetPasswordFromInvite   consumes token + creates first credential atomically

04_procedures/002_login.sql
    USP_GetUserForLogin         user + credential + lockout, ONE round trip.
                                Empty set when not found. EffectiveStatusId resolves
                                an expired lock back to the pre-lock status
    USP_RecordLoginAttempt      counter, lockout at 5 (30 min), status restore
    USP_UpdateLastLogin
    USP_GetUserClaims           roles + perms; Is_Active AND Is_Deleted at EVERY join;
                                validity vs fn_IstToday()
    USP_GetUserByUid            /auth/me — 3 result sets

04_procedures/003_tokens.sql
    USP_SaveRefreshToken · USP_ValidateRefreshToken
    USP_RotateRefreshToken      REUSE DETECTION: replay of a consumed token revokes
                                the ENTIRE chain for that user
    USP_RevokeRefreshToken · USP_RevokeAllUserTokens · USP_CleanupExpiredTokens
                                (the one place a hard DELETE is correct)

04_procedures/004_password.sql
    USP_CreatePasswordResetToken   Status 1 even for unknown addresses (no oracle)
    USP_ValidatePasswordResetToken
    USP_GetPasswordHistory         2nd of only 2 procs returning hash material
    USP_ChangePassword             retire -> insert -> stamp -> revoke ALL tokens,
                                   one transaction; optional reset-token consumption

04_procedures/005_otp.sql
    USP_SaveOtp                 retires prior live codes — one live code per channel
    USP_VerifyOtp               counts every attempt, cap 5, sets Is*Verified

04_procedures/006_admin.sql
    USP_UpdateUserStatus        RowVersion concurrency; approve grants SCHOOL_OWNER;
                                reject/suspend revoke tokens
    USP_UnlockUser · USP_AssignUserRole · USP_RemoveUserRole

04_procedures/007_lists.sql
    USP_GetUserList             paged, 2 result sets, IST date filters, sort whitelist
    USP_GetRoleList · USP_GetPermissionList · USP_GetRolePermissions

99_tests/001_test_sso_procedures.sql            73 assertions, all pass
```

### `database/jp_sso/` — PHASE 1C additions (menus)
```
01_tables/021_m_sso_menus.sql       Nav tree. Self-FK parent, UserTypeId NULL = sabke liye,
                                    PermissionId NULL = koi permission nahi chahiye.
                                    3 indexes, har ek apne guard ke saath
01_tables/022_t_sso_role_menus.sql  Per-role override. Ab banaya, MVP mein NOT read
03_seed/005_seed_menus.sql          32 menus (31 active, 2 group nodes).
                                    RoutePath app.routes.ts se derive; PermissionCode
                                    resolve na ho to seed ABORT (typo = sabko dikh jaata)
04_procedures/008_menus.sql         USP_GetUserMenus — flat list, recursive CTE nahi.
                                    Parent tabhi bachta hai jab child bacha ho
99_tests/003_test_menus.sql         30 assertions, all pass
```

**Menu counts (`localhost\TARUN`, 2026-08-08):** 32 rows · 31 active · 2 group nodes · 29 active RoutePaths, sab `app.routes.ts` mein maujood (0 dangling). Bina menu row ke sirf `/auth/login` aur `/forbidden` — dono sahi, wo authenticated nav ka hissa nahi.

### Error log (decision 2.31)
```
_TEMPLATE_procedure.sql                     Canonical write/read/list shapes.
                                            Har naya proc yahin se cut hoga.
jp_sso/01_tables/020_t_sso_error_log.sql    Table + OccurredOn DESC + ErrorProcedure indexes
jp_sso/04_procedures/000_USP_LogError.sql   Baaki sab procs se PEHLE banta hai.
                                            Kabhi throw nahi karta — apna CATCH sab nigal jaata hai
jp_sso/99_tests/002_test_error_log.sql      17 assertions, all pass.
                                            Trigger se jaan-boojh ke error karwa ke prove karta hai
                                            ki (a) rollback hua aur (b) log row bacha
```

**Verified counts (`localhost\TARUN`, 2026-08-08):**
17 tables · 16 unique NC indexes · 28 perf indexes · 36 filtered · 21 FKs · 51 CHECK constraints · 4 functions
Collation `SQL_Latin1_General_CP1_CI_AS` · compat 150 · **exactly 2 `date` columns** (`t_sso_user_roles.ValidFrom` / `.ValidTo`)

### `backend/` — solution level
```
JP.sln                             5 projects
Directory.Build.props              net8.0, nullable, TreatWarningsAsErrors, AnalysisLevel=latest
Directory.Packages.props           SAARE NuGet versions yahan. csproj mein version nahi.
```

### `backend/JP.Core/` — kisi package/project pe depend nahi karta
```
Common/Response.cs                 Response<T> envelope + ApiResponse static factory + ResponseStatus
Constants/ErrorCodes.cs            Sab machine-readable codes (client se exactly match hone chahiye)
Constants/JpClaimTypes.cs          uid, uuid, utype, status, orgUid, roles, perms
Constants/AppConstants.cs          Password / Lockout / Otp / Tokens / Paging / ConnectionNames / RoleCodes
Enums/UserType.cs                  1=Admin 2=School 3=Teacher
Enums/UserStatus.cs                1..6 — sirf Active (2) [RequireActiveAccount] paas karta hai
Enums/TokenType.cs                 Refresh / PasswordReset / EmailVerify / Invite
Enums/OtpChannel.cs                Email / Sms
Enums/LockReason.cs                FailedAttempts / AdminSuspend
Enums/JpDatabase.cs                Sso / Mdm / App — repository kis DB pe jaayega
Enums/PasswordHashAlgorithm.cs     Pbkdf2Sha256 = 1
Exceptions/AppException.cs         Base — Code + HttpStatusCode carry karta hai
Exceptions/NotFoundException.cs    Dusre org ka record bhi "not found" hi hai (id probing rokne ke liye)
Exceptions/ForbiddenException.cs
Exceptions/BusinessRuleException.cs        SP ka THROW isi mein translate hota hai
Exceptions/ConcurrencyConflictException.cs RowVersion mismatch
Exceptions/ValidationAppException.cs       Field-level errors
Extensions/ClaimsPrincipalExtensions.cs    RequireOrganizationUid() — poore app ka IDOR defence
```

### `backend/JP.Domain/`
```
Common/PagedRequest.cs             PageNumber/PageSize khud clamp hote hain (MaxPageSize 200)
Common/PagedResult.cs              Items + TotalRecords + TotalPages + HasNext/HasPrevious
Common/LookupDto.cs                Har master isi shape mein project hota hai (ParentId dependent dropdowns ke liye)
```

### `backend/JP.Infrastructure/`
```
Data/IDbConnectionFactory.cs       Ek call = ek DB. Cross-DB span ka API jaan-boojh ke nahi hai.
Data/DatabaseOptions.cs            Encrypt / TrustServerCertificate / timeouts / retry settings
Data/DbConnectionFactory.cs        Sirf configured connections build; encryption + ApplicationName apply;
                                   SQL_PASSWORD inject; Windows auth as-is
Data/BaseRepository.cs             QueryAsync / QueryFirstOrDefaultAsync / QuerySingleAsync /
                                   QueryMultipleAsync / ExecuteAsync / ExecuteScalarAsync
                                   → sab (spName, DynamicParameters), CommandType.StoredProcedure hardcoded.
                                   SqlException 50000+ → BusinessRuleException, 2627/2601 → duplicate, 547 → FK.
                                   9 transient errors pe retry (backoff + jitter). ctor: (factory, options, logger)
Security/IPasswordService.cs       + PasswordHashResult record
Security/PasswordService.cs        PBKDF2-SHA256 210k/32/64, FixedTimeEquals, NeedsRehash()
Security/ITokenHasher.cs           + SecureToken(PlainText, Hash) record
Security/Sha256TokenHasher.cs      Base64Url token + SHA-256 hex hash (64 chars, varchar(128) mein fit)
Security/JwtOptions.cs             Key MinLength(64), ValidateOnStart
Security/IJwtService.cs            + JwtUserContext / AccessTokenResult / RefreshTokenResult
Security/JwtService.cs             JsonWebTokenHandler, MapInboundClaims=false (warna short claim names tootte hain)
Security/JwtAuthenticationExtensions.cs  Dono API ka identical JWT setup + envelope-shaped 401/403.
                                         Expired vs invalid alag karta hai → client silently refresh kar sake
Storage/IFileStorageService.cs     + StoredFile record
Storage/FileStorageOptions.cs      RootPath (wwwroot ke bahar), MaxFileSizeKb, extension allowlist
Storage/LocalDiskFileStorageService.cs  GUID filenames, dated folders, path-traversal guard
Email/IEmailService.cs             + EmailMessage record
Email/SmtpOptions.cs               Enabled=false pe disk pe drop, SMTP_PASSWORD env se
Email/IEmailTemplateRenderer.cs
Email/FileEmailTemplateRenderer.cs {{Token}} substitution, values HTML-encoded, templates cached
Email/SmtpEmailService.cs          MailKit. Body kabhi log nahi hota (OTP/reset link us mein hote hain)
Email/Templates/password-reset.html
Email/Templates/otp.html
Middleware/GlobalExceptionHandlerMiddleware.cs  AppException → uska message; baaki sab → generic 500
Middleware/RequestResponseLoggingMiddleware.cs  Correlation id; BODIES KABHI LOG NAHI; query redacted
Filters/RequireActiveAccountAttribute.cs        status != Active → 403 + specific ACCOUNT_* code
DependencyInjection.cs             AddJpInfrastructure() + UseJpInfrastructure()
```

### `backend/JP.Sso.Api/` aur `backend/JP.App.Api/` (dono mein same set)
```
Program.cs                         Serilog, Swagger+JWT, CORS, envelope-shaped model-state errors
appsettings.json                   Koi secret nahi. Sso ke paas sirf Sso conn; App ke paas Mdm+App
appsettings.Development.json       Debug logging, SMTP disabled (mail → App_Data/mail-drop/*.eml)
Properties/launchSettings.json     Fixed ports 5199 / 5299
Controllers/HealthController.cs    Anonymous liveness. DB ko touch nahi karta — jaan-boojh ke.
```

### `frontend/portal/src/`
```
environments/environment.ts               Dev — localhost:5199 / :5299
environments/environment.production.ts    Prod — same-origin /sso/api, /app/api (CORS hi nahi)
app/core/models/api-response.model.ts     ApiResponse<T> — server ke Response<T> ka exact mirror
app/core/models/auth.model.ts             JwtClaims, CurrentUser, LoginRequest, AuthTokens
app/core/models/lookup.model.ts           Lookup + MASTER_KEYS whitelist
app/core/constants/error-codes.ts         Server ke ErrorCodes ka mirror + ACCOUNT_STATE_CODES
app/core/constants/auth-constants.ts      UserType, UserStatus, ROLE_CODES, STORAGE_KEYS, CLAIM_KEYS
app/core/utils/jwt.util.ts                Payload decode (verify NAHI — sirf routing hint), single-vs-array claim normalise
app/core/services/token-storage.service.ts  localStorage ka akela gateway
app/core/services/auth.service.ts         Signals; user token se derive hota hai (ek hi source of truth)
app/core/services/master.service.ts       In-memory cache; Observable cache karta hai (parallel callers share karein)
app/core/services/toast.service.ts
app/core/services/loader.service.ts       Counter, boolean nahi — parallel requests ke liye
app/core/interceptors/auth.interceptor.ts    Bearer attach + single-flight 401 refresh & retry
app/core/interceptors/error.interceptor.ts   Envelope → toast/route. Hamesha rethrow karta hai
app/core/interceptors/loader.interceptor.ts  + SKIP_LOADER context token
app/core/guards/auth.guard.ts             authGuard + guestGuard
app/core/guards/active-account.guard.ts   Server ke [RequireActiveAccount] ka client mirror
app/core/guards/role.guard.ts             roleGuard(...codes) factory
app/core/guards/permission.guard.ts       permissionGuard(...codes) factory — AND semantics
app/layouts/portal-shell/portal-shell.ts  Shared chrome; nav permission/role se filter hota hai
app/layouts/teacher-layout/teacher-layout.ts
app/layouts/school-layout/school-layout.ts
app/layouts/admin-layout/admin-layout.ts
app/shared/components/loader/loader.ts
app/shared/components/toast/toast-container.ts
app/shared/components/confirm-dialog/confirm-dialog.service.ts   Promise-based ask()
app/shared/components/confirm-dialog/confirm-dialog.ts
app/shared/pages/coming-soon/coming-soon.ts   Placeholder — routes pehle se wired hain
app/shared/pages/forbidden/forbidden.ts
app/shared/pages/not-found/not-found.ts
app/features/auth/login/login.ts              PLACEHOLDER — Phase 1D
app/features/account/account-status/account-status.ts  ACCOUNT_* ka destination (pending pe reachable)
app/app.ts                                Root — outlet + 3 global overlays
app/app.config.ts                         Interceptor order yahan documented hai
app/app.routes.ts                         Poora route map, sab lazy
styles.scss                               Design tokens (--jp-*), .btn primitives, focus-visible
angular.json                              [MODIFIED] production fileReplacements
```

### `frontend/portal/src/styles/` — design system (review fix 2)
```
_variables.scss    Saare tokens. SCSS vars + root-variables() mixin jo --jp-* emit karta hai.
                   Khud koi CSS emit nahi karta → component safely @use kar sakte hain.
_mixins.scss       up()/down()/between() breakpoints, flex helpers, truncate, line-clamp,
                   card, focus-ring, scroll-x, custom-scrollbar, reduced-motion
_typography.scss   Heading scale, body, links, .text-* roles
_buttons.scss      .btn + primary/secondary/danger/ghost/link, sm/lg/icon/block, loading spinner
_forms.scss        .field, .form-control, input-group, checkbox/radio, form-grid, form-actions
_tables.scss       .table-wrap (scroll container), sticky header, striped/hover/compact,
                   sortable header button, empty state, pager
_cards.scss        .card + header/body/footer, .stat tile, .card-grid
_badges.scss       .badge + 6 tones — har status ke liye ek hi vocabulary
_layout.scss       Reset, app shell, sidebar nav, .page__*, .container, grid helpers
_utilities.scss    Spacing/display/flex/text helpers, .visually-hidden, .skip-link
_theme.scss        Sirf styles.scss isko @use kare. Load order = cascade order.
```

### `frontend/portal/src/app/shared/ui/` — 13 components × 3 files (review fix 2)
```
ui-form-control.base.ts   @Directive() abstract base — CVA + id wiring + disabled sources
ui-button/                variant/size/loading/block/iconOnly; click native bubbling se
ui-input/                 text/email/password/tel/number/url/search + prefix/suffix addon
ui-select/                single select + lookupsToOptions() helper (master data → options)
ui-textarea/              rows, maxlength, live char counter
ui-checkbox/              checkbox ya radio; label project hota hai (link daal sakein)
ui-datepicker/            native date/datetime-local; ISO string value (timezone drift nahi)
ui-modal/                 sm/md/lg/xl, backdrop + Escape, body scroll karta hai
ui-table/                 columns, server-driven sort + paging, rowTemplate, empty state
ui-badge/                 6 tones, dot, sizes
ui-empty-state/           title/message/action — khaali list normal hai, error nahi
ui-page-header/           h1 + description + actions slot
ui-file-upload/           drag-drop, extension + size check (server phir bhi validate karta hai)
ui-multi-select/          search + chips; bridge tables ka editor (subjects, skills, languages)
```

### `frontend/public-site/`
```
src/styles/_variables.scss   Portal ke identical palette/spacing/radii/breakpoints,
                             bada type scale (16px body, clamp() hero)
src/styles/_mixins.scss      up/down, flex, section-spacing, focus-ring
src/styles/_typography.scss  .headline, .lead (42rem measure), .section-title
src/styles/_layout.scss      Reset, .container, .section, .site-header, .site-footer
src/styles/_components.scss  .btn, .card, .job-card, .badge, forms
src/styles/_theme.scss       Entry point
app/app.component.{ts,html,scss}  Public shell — header + nav + footer + outlet.
                             Angular ka placeholder page hata diya.
```

---

## 7. NEXT ACTION

## ✅ PHASE 1 COMPLETE — 2026-08-08

1A + 1B + 1C + 1D sab done aur verified. Verification output:

| Check | Result |
|---|---|
| `dotnet build JP.sln --no-incremental` | **0 warnings, 0 errors** |
| `001_test_sso_procedures.sql` | **73 / 73** |
| `002_test_error_log.sql` | **17 / 17** |
| `003_test_menus.sql` | **31 / 31** |
| SQL assertions total | **121 / 121** |
| jp-shared / jp-admin / jp-school / jp-teacher / jp-public prod builds | **paanchon clean** |
| jp_sso objects | **20 tables · 32 procedures · 4 functions · 71 indexes** |

⚠️ Verification ke dauraan **test 001 toota hua mila** —
`USP_CreatePasswordResetToken` ab `UserTypeId` return karta hai par test ka
temp table 5 column ka reh gaya tha. Fix kiya, phir 73/73. Details section 2A
(G8) mein.

📖 Setup, run order, test accounts, aur kaunsi screen asli hai kaunsi mockup:
[HOW_TO_RUN.md](HOW_TO_RUN.md)

🔴 **Known gaps section 2A mein hain. Phase 2 shuru karne se pehle padho** —
khaas kar **G0: kisi repo ka git remote nahi hai**, sab kuch sirf ek machine pe
hai.

---

## ▶️ NEXT: PHASE 2A — `jp_mdm` DATABASE

Master data ka database. Ye Phase 2 ka pehla step hai.

### Pehle ye padho
- **2.39** — organization scope resolution. `OrganizationUid` sirf JWT se.
  Uska integration test Phase 3 ki definition of done ka hissa hai.
- **2.42** — frontend structure LOCKED. Start order: `jp-shared` :4999 pehle.
- **2.11** — SQL Server 2019 syntax only. Koi 2022+ feature nahi.
- **2.21 / 2.31** — SP error convention aur CATCH ordering.
- **Section 2A** — known gaps.

### Phase 2A ka scope
17 master tables, sabka shape ek: `Code`, `Name`, `DisplayOrder`,
`Is_Active` + standard columns (2.4). Geography apni alag shakal rakhta hai —
usme parent cascade chahiye.

Har table ke liye wahi discipline jo `jp_sso` mein thi:
1. `00_create_database.sql` idempotent, compat level 150 pinned
2. Business key pe **filtered unique index** (`WHERE Is_Deleted = 0`)
3. Har naya file `run_all.sql` mein `:r` se register
4. Seed data alag `03_seed/` mein
5. **Test suite usi commit mein**, `99_tests/` mein — proc ka result set
   badle to temp table bhi

⚠️ Master data ki **screens** jp-admin mein config-driven banengi (2.41), 17
alag screens nahi. Wo Phase 2E hai, 2A nahi.

🔴 **Phase 2 abhi shuru NAHI karna hai.** Ye section next action likhta hai,
permission nahi deta.

