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

### G0. Git remote — ✅ CLOSED (3D, 2026-08-10)

Saaton repo GitHub par hain, saare in sync:

```
jp-backend  jp-shared  jp-admin  jp-school  jp-teacher  jp-public  jp-docs
      https://github.com/Tarun1515/<name>.git
```

⚠️ Push se pehle credentials nikaale gaye — `HOW_TO_RUN.md` ke plaintext
password ab `local-accounts.md` (gitignored) mein hain, aur do aur jagah se
bhi hataye gaye. Details **2.55**.

⚠️ Nayi machine par saaton **sibling folder** hone chahiye: `jp-shared` ke
tsconfig paths aur SCSS includePaths `../jp-shared` par nirbhar hain (2.42).

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

- **SQL tests hain (121 assertions), C#/Angular unit tests NAHI hain.** E2E
  ke liye G9 dekho. Koi
  xUnit project nahi, koi Karma/Jest spec nahi. Verification abhi SQL suites +
  browser checks pe depend karta hai.
- ⚠️ **Test 001 aaj toota hua mila aur fix hua.** `USP_CreatePasswordResetToken`
  ab `UserTypeId` bhi return karta hai (per-app reset links ke liye), par test ka
  `#ResetTok` temp table 5 column ka reh gaya tha — `INSERT ... EXEC` 6 values
  nahi le paaya. Sabak: **proc ka result set badlo to usi commit mein test ka
  temp table badlo.**

---

### G9. E2E TESTING — Phase 8

Playwright abhi bhi use ho raha hai — screenshots, SEO audit, layout measure,
sign-in check, federation ka singleton proof. Phase 8 mein ye **regression
suite** ban jaata hai jo poore flows cover kare:

1. **School onboarding** — school signup → admin approve → school active
   (aur account-status screen ka pending state beech mein)
2. **Hiring** — teacher signup → apply → school shortlists → offer → accept
3. **Cross-app guard** — school owner teacher app pe sign in kare to local
   sign-out + sahi app ka naam aur link

#### Pehle kyun nahi likha

Screens abhi badal rahi hain. Aisi screen ke against likha test jo agle hafte
badal jaaye, save karne se zyada maintain karne mein kharcha karta hai — aur
phir log use delete nahi karte, `skip` kar dete hain, jo usse aur mehnga bana
deta hai.

Pipeline ban jaane ke baad aur UI settle hone ke baad ye suite worth hai, **aur
tab na hone ki keemat lagni shuru ho jaati hai** — kyunki tab tak flows itne
lambe ho chuke honge ki haath se regression pakadna practical nahi rahega.

#### 🔴 Setup KAHAN hai — `jp-docs/scripts/verify/`

⚠️ **Phase 1 ke aakhir tak ye kahin bhi commit nahi tha.** Saare scripts ek
scratch directory se, npx cache ke Playwright se chal rahe the — yaani agla
phase inhe **zero se dobara likhta**. Close-out pe rescue karke commit kiya.

| Cheez | Kahan |
|---|---|
| Scripts | `jp-docs/scripts/verify/*.mjs` (8) |
| Kya-kya karte hain | `jp-docs/scripts/verify/README.md` |
| npm scripts | `jp-docs/package.json` — `verify:site`, `verify:seo`, `verify:layout`, `verify:chooser`, `verify:signin`, `verify:federation`, `verify:scss`, `screenshots` |
| Dependencies | `jp-docs` devDependencies mein **declared**, par abhi **install nahi** — `npm install && npx playwright install chromium` |

**`jp-docs` mein kyun, kisi app repo mein nahi:** ye scripts app boundaries paar
karte hain. Chooser flow `jp-public` → `jp-school`/`jp-teacher` jaata hai,
federation check host aur remote dono dekhta hai, aur cross-app guard do apps
ka hai. `jp-docs` akeli repo hai jo baaki sab ke **beside** rehti hai. Phase 8
ke teeno flows bhi multi-app hain, to suite ka ghar wahi rehna chahiye.

#### Phase 8 ko jo pehle se mil raha hai

- Har public route pe SEO + heading order + dead-link crawl
- Lighthouse SEO/a11y per page, failing audits ke naam ke saath
- Sign-in flow jo `/dashboard` tak jaata hai aur storage keys check karta hai
- Federation ka singleton proof (`instanceof` wala)
- Screenshots 1440 + 375, dono widths, horizontal-scroll check ke saath

#### ⚠️ Do traps jo already solve ho chuke hain — dobara mat girna

1. **Hydration race.** Hydrate hone se pehle pada click kuch nahi karta, aur
   page aisa dikhta hai jaise validation fail hui. Ye asli hua tha: contact form
   ne "0 field errors" report kiya jabki wo theek kaam kar raha tha. Fix retry
   hai jab tak app respond na kare — **fixed `waitForTimeout` fix nahi hai**, wo
   wahi race hai lambi fuse ke saath.
2. **`fullPage` screenshot + sticky header.** Playwright scroll karke stitch
   karta hai, to `position: sticky` header image ke beech mein dobara render
   hota hai. **Ye page ka bug nahi hai** — ye ek baar "contact page pe header
   form ke beech aa raha hai" bug ke roop mein report bhi ho chuka hai. Capture
   se pehle sticky neutralise karo.

#### Jab likhna shuru karo

- Test accounts HOW_TO_RUN §4 mein hain. ⚠️ **Suite ko apna data khud banana
  chahiye**, un accounts pe depend nahi karna — wo shared hain aur ek test ka
  state doosre ko tod dega.
- School approve karne ka abhi koi admin UI nahi (G6), to onboarding flow ko
  filhaal Swagger/API call karna padega. Phase 2E ke baad ye UI se ho sakega.
- Flows ko chalane ke liye `jp-shared` :4999 chahiye. Suite ko wo bhi start
  karna hoga, ya CI step mein.


### G10. 2C suite RowVersion branch tak nahi pahunchti

`USP_ProcessApprovalAction` ka concurrency check **kaam karta hai** — 2026-08-09
ki independent verification mein isolate karke confirm kiya (2.46 ka correction
note dekho).

Par **test suite us branch tak pahunchti hi nahi.** Ek level configure hai, to
har successful action request ko complete kar deta hai aur doosri koshish
`INVALID_STATUS` pe ruk jaati hai — RowVersion compare hone se pehle.

**Kya add karna hai:** `001_test_approval_engine.sql` mein ek case jo
- apne transaction ke andar request type 1 ko do-level banaye
  (level 1 `IsFinalLevel = 0`, ek naya level 2 `IsFinalLevel = 1`)
- submit kare, level 1 pe approve kare — status Pending rehna chahiye,
  `CurrentApprovalLevel = 2`, `IsCompleted = 0`
- phir stale RowVersion se approve kare — `CONCURRENCY_CONFLICT` aana chahiye,
  koi trail row nahi banni chahiye

Ye multi-level advancement ko bhi cover kar lega, jo abhi suite mein bilkul
untested hai (MVP ek hi level seed karta hai).

⚠️ Ye **bug nahi hai** — coverage gap hai. Engine sahi hai; suite uska saboot
nahi de rahi.
---

### G11. Orchestration retry ka koi endpoint nahi

Cross-DB orchestration **idempotent hai** — provisioning `SourceRequestUid` pe
key karti hai, activation ab already-Active ko success maanti hai. Par use
**dobara chalane ka koi API tareeka nahi**: request already Approved hai, to
`POST /api/approvals/{id}/action` `INVALID_STATUS` de kar refuse karta hai.

Abhi recovery sirf `USP_ProvisionSchoolFromApproval` seedha call kar ke hoti
hai — jo kaam karta hai (verify kiya) par operator ko SQL access chahiye.

**Kya chahiye:** `POST /api/approvals/{id}/retry-orchestration`,
verification permission ke peeche, jo `IApprovalOrchestrationService.RunAsync`
dobara chalaye. Phase 8 ise `USP_FindOrphanedApprovals` ke saut scheduled
check se jod sakta hai.

⚠️ Ye code ka bug nahi, **missing surface** hai. Orchestration retry-safe hai;
usse trigger karne ka rasta nahi hai.

### G12. Teacher profile — ✅ CLOSED (3B, 2026-08-10)

Teeno kaam ho gaye:

1. ✅ `t_app_teachers` bani — Phase 3A (2.51)
2. ✅ **11 profile backfill hui** — har maujooda teacher account ke liye
3. ✅ **11 `TEACHER_FREE` subscription** assign hue

Verify: `90_ops/001_verify_account_completeness.sql` ka check A aur check C
dono **0 rows**.

⚠️ **Signup pe profile banna abhi WIRE NAHI hua.** Backfill purane account
sambhalta hai; ek naya teacher jo aaj register kare uski profile **fir se nahi
banegi** — 3B ke baad bana account phir usi gap mein girega jo abhi band hua
hai. **G21 dekho.**

⚠️ Profile bhare hue hain par **saara data seeded hai**, asli nahi. **G20
dekho** — G12 band hone se ye chhupna nahi chahiye.

### G13. Virus scanning nahi hai

Upload validation content ko sniff karti hai — `.exe` ko `.pdf` naam de kar
bhejne wala attack ruk jaata hai. Par **ek malicious PDF asli PDF hi hota hai**
aur har check pass kar jaayega.

Hook `DocumentService.UploadAsync` mein marked hai: **validation ke baad,
storage se pehle**, aur reject kar sakne wala.

⚠️ `SaveAsync` ke baad **mat** rakhna — disk pe pada file wo file hai jo serve
ho sakti hai.

### G14. Multi-level approval — aadha hi verify hua hai

Independent verification ne ye **saabit** kiya: level advancement configuration
padhti hai, ek level maan kar nahi chalti. Do level configure karne par level 1
approve karne ke baad request **Pending rahi, `IsCompleted = 0`**, aur level
aage badh gaya.

Jo **untested** hai, kyunki MVP har jagah ek hi level configure karta hai:

- level 2 par **reject** — poori request reject hoti hai, ya level 1 par wapas?
- level 2 par **request-resubmit** — level 1 se dobara shuru, ya level 2 se?
- **per-level permission scoping** — level 2 ka approver level 1 action kar
  sakta hai?
- **teen ya usse zyada** level

Inmein se koi bhi tab tak maayne nahi rakhta jab tak Phase 6 do-level offer
approval nahi laata. Us din **sab** maayne rakhte hain.

🔴 Jo bhi ye uthaye: **ye cases pehle likho.** Engine sahi *dikhta* hai, par
aaj tak sirf ek raste se guzara hai.

### G15. "Assigned to" filter — ✅ CLOSED (3G, 2026-08-15)

Do cheezein toot rahi thi, dono theek hui (2.58):

- filter ab **Uid** leta hai, numeric jp_sso id nahi — service use jp_sso se
  resolve karti hai, wahi cross-DB join API layer mein (2.2). Isi wajah se ab
  kisi **colleague** ko naam le kar filter kiya ja sakta hai;
- **"unassigned"** ka apna flag hai (`@UnassignedOnly`), kyunki
  `@AssignedToUserId` par NULL ka matlab pehle se "sab" hai.

Screen par ek dropdown: **Anyone · Unassigned · Assigned to me · <admin>**.
Admin list `JP.Sso.Api` ke `/api/users?userTypeId=1` se aati hai, session bhar
cache hoti hai.

🔴 Anjaan assignee **`-1`** par resolve hota hai, NULL par nahi — warna ek typo
filter ko chup-chaap poori queue tak chauda kar deta.

### G16. Branch-add (request type 3) ka koi tab nahi

Queue mein do tab hain: Schools (type 1) aur Teachers (type 2). **Type 3 —
add branch — kahin nahi dikhti.**

Aaj koi banati nahi (branches Phase 3 hain), par orchestrator use type 1 ki
tarah handle **karta hai**, matlab ek branch-add request submit ho sakti hai
aur admin ki nazar se gayab rahegi.

Phase 3 branches ke saath: ya teesra tab, ya Schools tab ko dono types dikhane
do. Doosra shayad sahi hai — verify karne wala kaam ek jaisa hai.

### G17. Ek document replace karne ke liye poora form khulta hai

Resubmit-required par account-status sahi document ka naam aur reason dikhati
hai, par "Replace the document" **poore registration form ke document step** par
le jaata hai.

Kaam ho jaata hai — upload wahi hai, versioning proc sambhalta hai (naya version
banta hai, purana rehta hai) — par jise ek file dobara bhejni hai use paanch-step
form dikhta hai jo pehle hi bhara hua hai. Wo "kya mujhe sab dobara karna hai?"
padha jaata hai.

**Kya chahiye:** `/account/documents` (abhi `comingSoon` hai) ek chhoti screen
bane jisme sirf wahi document ho jo wapas aaya hai, uska reason, aur ek upload.

⚠️ Chhota kaam, par ye us screen par hai jahan school pehle se pareshan hai.

### G18. Draft discard karne ka koi tareeka nahi

Draft `StatusId 8` wali request hai, aur ek user ka ek hi draft hota hai. Use
**mitane ka koi rasta nahi** — na UI mein, na API mein.

Aaj ka asar chhota hai: agla save usi draft ko overwrite karta hai, to koi
phansta nahi. Par "sab mita kar naye sire se shuru karo" wala option nahi hai,
aur chhode hue draft hamesha ke liye `t_mdm_approval_requests` mein baithe
rehte hain.

**Kya chahiye:** `DELETE /api/approvals/draft` jo soft-delete kare. Uske saath
Phase 8 mein chhode hue draft ki cleanup — sochne ki cheez ye hai ki uske
documents disk par bhi pade hain.

### G19. Active school bina school ke — ✅ CLOSED (3C, 2026-08-10)

`head@stmarys.edu.in` ab **asli raste se** registered aur approved hai —
`REG-SCH-2026-00013` — apni school, head office, plan aur owner row ke saath.

Brief ne do vikalp diye the: account saaf karo, ya doc badal do. Dono nuksaan
seemit karna the. Teesra chuna: **gap hi khatam** — jo ab mumkin tha kyunki 2F ne
draft/submit banaya aur 3C ne provisioning ko owner likhna sikhaya.

HOW_TO_RUN wahi account naam karta hai aur ab wo sach mein tenant isolation
dikhata hai. Details **2.53**.

### G20. 🔴 Saara teacher data SEEDED hai — asli nahi

Gyaarah teacher profile bhare hue hain aur **har field invented hai**. Naam,
qualification, experience row, salary, subject, skill, bhasha, preferred
location — kisi insaan ne kuch nahi bhara.

⚠️ **G12 band hone ka matlab ye nahi ki teacher data asli hai.** "G12 closed"
padh kar koi ye maan sakta hai, aur isi liye ye alag gap hai.

Phase 4 ya 5 mein jo bhi is data ke against **kaam karta dikhe** — job match,
search filter, applicant card — wo **hamare gaddhe hue data** ke against kaam kar
raha hai. Development ke liye theek hai; demo mein isse "asli istemal" bata kar
dikhana galat hai.

**Seeded accounts (sab `@yopmail.com`):**

```
tarun@yopmail.com                    Tarun Bhardwaj          95%
meera.iyer.85999@yopmail.com         Meera Iyer             100%
arjun.rao.86000@yopmail.com          Arjun Rao               70%
fatima.sheikh.86001@yopmail.com      Fatima Sheikh           60%
rohit.kulkarni.86002@yopmail.com     Rohit Kulkarni          65%
sneha.banerjee.86003@yopmail.com     Sneha Banerjee          55%
harpreet.gill.86004@yopmail.com      Harpreet Kaur Gill      75%
vikram.chauhan.86005@yopmail.com     Vikram Singh Chauhan    45%
lakshmi.nair.86006@yopmail.com       Lakshmi Nair            20%
imran.qureshi.86007@yopmail.com      Imran Qureshi           10%
anita.deshmukh21338@yopmail.com      Anita Deshmukh          35%
```

Password: `local-accounts.md` mein (gitignored). Ye file push hoti hai, wo
nahi — repository ki history mein pada password us faisle se zyada jeeta hai jo
kehta hai ki wo wahan nahi hona chahiye.

**Invented kya hai:** `t_app_teachers` ki har column (`UserUid` chhod kar,
jo asli account se aayi), aur `t_app_teacher_subjects`,
`_class_levels`, `_skills`, `_languages`, `_preferred_locations`,
`_experiences` ki **har row**.

**Asli kya hai:** account khud — email, mobile, password hash, `UserUid` —
kyunki ye asli registration endpoint se bane (2.52).

⚠️ Go-live se pehle ye sab hatana hai. **Ye list us waqt likhi gayi jab pata
tha**; baad mein yaad karne ki koshish live database par andaaza lagana hoga.

⚠️ **3H update:** in teeno adhoore profile ka password ab
`local-accounts.md` mein likha hai, asli forgot-password flow se set kiya gaya.
Wo ab **fixture hain** — `screens-3h.mjs` unhe khol kar dekhti hai ki screen
adhoori profile par kaisi dikhti hai, aur **kuch save nahi karti**. Unhe "poora"
mat karo (2.60).

### G21. Signup par teacher profile — ✅ CLOSED (3C, 2026-08-10)

`AuthService.RegisterTeacherAsync` ab account banne ke turant baad profile +
`TEACHER_FREE` banati hai.

Asli signup se verify kiya: check A pehle **0**, ek teacher register karne ke
baad bhi **0**.

⚠️ Failure signup ko **fail nahi karti** — account doosre database mein commit ho
chuka hota hai, aur "registration failed" bolna us bande ko duplicate-email wale
retry mein bhej deta. Loud log + verification query safety net hain. Details
**2.53**.

### G22. Scope resolver ek convention hai, enforcement nahi

`dbo.fn_VisibleBranches` ek hi jagah hai jahan branch scope tay hota hai, aur
har school-scoped procedure usse **join** karti hai — jo sabse aasan raasta bhi
hai (2.53).

Par **SQL Server mein kuch bhi** aage kisi list proc ko apna `EXISTS` haath se
likhne se **nahi rokta**. Aur wahi haath se likhi copy wo jagah hai jahan IDOR
rehta hai: ek school ka HR doosre campus ke applicant padh raha hai, bina kisi
error ke.

Abhi jo hai:
- ye function `t_app_school_user_branches` ka **ekmatra** reader hai, to us
  table ka doosra reader search karte hi dikh jaata hai;
- 3C ki suite mein **15 negative assertion** hain.

**Kya chahiye:** har naye school-scoped procedure ke saath uska apna negative
case — "bina assign wale campus ke liye ZERO row" — usi commit mein. Aur Phase 8
mein ek check jo `t_app_school_user_branches` ke readers ginta hai; ek se zyada
hone par review.

⚠️ Ye "shayad kabhi" wala gap nahi hai. Phase 4 (jobs) aur Phase 5
(applications) dono is resolver par khadi hain, aur wahin sabse zyada rows hain
jinhe galat banda dekh sakta hai.

### G23. Ek user, ek school — API abhi doosra keh hi nahi sakti

School ke saare endpoint caller ki membership se school resolve karte hain
(2.57). Agar kisi ke paas **do** membership hui, service saaf inkaar karti hai —
pehli utha kar nahi.

Aaj kisi ke paas do nahi hai (verify kiya), par **shakl pehle se maujood hai**:
Greenwood ke ek hi organisation ke neeche do school hain, aur
`t_app_school_users` do membership rokta nahi.

⚠️ Jis din ek group apne principal ko dono school par rakhega, uske liye har
school screen **band** ho jaayegi — ek saaf message ke saath, par band.

**Kya chahiye:** ya to endpoints `schoolId` lein aur membership ke against
validate karein, ya UI mein ek "active school" switcher ho jo token/session mein
baithe.

🔴 Pehla wala aasan lagta hai aur **IDOR ka rasta** hai: jis lamhe request
`schoolId` le sakti hai, har endpoint ko validate karna yaad rakhna padega.
Doosra wala saaf hai, par usme session state hai.

Faisla tab lena hai jab pehla asli multi-school group aaye — abhi guess karke
banane se galat wala chun lenge.

### G24. RoleInSchool badalta hai, jp_sso ka role nahi

`PUT /api/school/team/{uid}/role` sirf **jp_app** likhta hai. Us bande ka
jp_sso role — jisme unki asli **permissions** hain — wahi purana rehta hai.

Nateeja: team screen kehti hai "Senior HR", aur API har wahan mana karti hai
jahan Senior HR ki permission chahiye. `SchoolRoles` (2.58) mein dono ka naksha
ek hi jagah hai, par abhi use **sirf invite** padhta hai.

⚠️ Ye jaan-boojh kar chhoda hai, chhupaya nahi. Theek karne ka matlab hai ek aur
cross-database write, usi partial-failure shakl mein jo invite ki hai — aur uska
aadha chalna aadmi ko **do role** de deta, jo purane role se bura hai.

**Kya chahiye:** `USP_AssignUserRole` (pehle se maujood hai) ko role save ke
saath orchestrate karo, invite wali tarteeb mein: jp_sso pehle, jp_app baad
mein, aur girne par **loud**. Tab tak role badalna aadha kaam hai.

🔴 Aaj iska asar seemit hai kyunki har maujooda member owner hai ya naya invite,
aur dono jagah role sahi set hota hai. **Jis din pehla HR ko Senior HR banaya
jaayega, us din ye dikhega.**

### G25. Underscore wale column DTO tak nahi pahunchte

`Is_Active`, `Is_Deleted` — standard columns (2.4) aur is schema mein
**underscore wale sirf yehi** hain. Dapper underscore hataata nahi jab tak
`DefaultTypeMap.MatchNamesWithUnderscores` on na ho, aur wo **jaan-boojh kar
off** hai: wo ek global naam-badalne wala niyam hai jo har mapping ek saath
badal deta.

3F ne ek asli case pakda: `BranchDto.IsActive` hamesha `false` aata tha
jabki row 1 thi. Do phase invisible raha kyunki kisi screen ne use dikhaya hi
nahi tha (2.59).

**Ab kya hai:** teeno branch SELECT mein `Is_Active AS IsActive` alias, comment
ke saath ki wo load-bearing hai, aur HTTP check jo column aur JSON dono padhta
hai.

⚠️ **Ye class ka fix nahi hai, ek jagah ka fix hai.** Har naya proc jo koi
standard column DTO ko lautaye usse **alias chahiye**, aur bhoolne par kuch fail
nahi hota — value chup-chaap default (false/0) aa jaati hai.

🔴 SQL test isse kabhi nahi pakdega: procedure sahi hai, mapping galat hai. Jo
pakad sakta hai wo ek HTTP assertion hai jo **row aur JSON dono** padhe, ya Phase
8 mein ek check jo har proc ke output columns ko DTO property se milaaye.

### 2.45 `jp_mdm` — PHASE 2A BUILD NOTES

32 tables (23 masters + 8 transactional + `t_mdm_error_log`), 91 indexes,
29 foreign keys, 4 IST functions, `USP_LogError`. Re-run pe zero naye objects.

#### 🔴 `t_sso_roles.RoleId` **int** hai, bigint nahi

`t_mdm_request_levels.RoleId` isse match karta hai. Ye **live column se verify
kiya**, spec se maan kar nahi liya — 2.37 mein menu ke waqt exactly yehi hua tha
(UserTypeId aur PermissionId int nikle the, tinyint/bigint nahi).

Baaki cross-DB columns: `t_sso_users.UserId` **bigint**, `OrganizationUid`
**uniqueidentifier**. In par koi FK nahi (2.2) — har script mein comment hai ki
kyun, taaki koi baad mein "theek" karne ki koshish na kare.

#### Timezone classification (2.28) — poori list

Sirf **ek** column `date` hai:

| Column | Type | Kyun |
|---|---|---|
| `t_mdm_teacher_registration_details.DOB` | `date` | Calendar date hai, instant nahi. UTC timestamp rakhne se 1 tareekh ko paida hua banda din ke 5.5 ghante 31 ka ho jaata |
| `t_mdm_school_registration_details.EstablishedYear` | `smallint` | ⚠️ **Ye saal hai, date nahi.** Kisi ko school ka exact din yaad nahi hota; `date` column ek precision invent karta jo data mein hai hi nahi |
| SubmittedOn · CompletedOn · ActionOn · VerifiedOn · PaidOn · OccurredOn | `datetime2` UTC | Event/expiry timestamps |

#### Business keys — filtered unique, sab `WHERE Is_Deleted = 0`

Spec wale (har master ka `Code`, `RequestNo`, request-levels ka triple,
teacher-subjects ka pair, documents ka `(RequestId, DocumentTypeId, Version)`)
ke alawa ye add kiye:

| Index | Kyun |
|---|---|
| `m_mdm_document_types (RequestTypeId, Code)` | `Code` akela unique nahi ho sakta — SCHOOL_REG aur TEACHER_VERIFY dono ke paas `ID_PROOF` ho sakta hai. Business key **pair** hai |
| `m_mdm_rejection_reasons (RequestTypeId, Code)` | wahi wajah |
| `t_mdm_approval_requests (RequestUid)` | **unfiltered** — Uid kabhi reuse nahi hona chahiye, warna purana URL doosri request pe khulega |
| `t_mdm_request_payments (GatewayRefNo)` | Ek gateway reference = ek payment. Do rows ka matlab webhook do baar process hua — double refund isi tarah hota hai |

#### 🔴 One-pending-per-entity — index hai, check nahi

```
UQ_t_mdm_approval_requests_OnePendingPerEntity
  ON (RequestTypeId, EntityUid) WHERE StatusId = 1 AND Is_Deleted = 0
```

Do tabs, double click, timeout ke baad retry — school do baar submit kar sakta
hai. Do Pending rows tab dikhte hain jab admin ko queue mein wahi school do baar
dikhta hai.

2C ka procedure bhi check karega, **par check bina index ke race hai**: do
concurrent sessions dono check pass kar lenge insert se pehle.

⚠️ `StatusId = 1` literal hai kyunki filtered index mein subquery nahi ho
sakti. `m_mdm_approval_status` renumber hua to ye index rebuild karna padega —
ek aur wajah ki master IDs contract hain.

#### Seed — sirf paanch, jaan-boojh kar

`m_mdm_request_types` (4) · `m_mdm_approval_status` (5) ·
`m_mdm_action_types` (5) · `m_mdm_payment_modes` (4) ·
`m_mdm_payment_status` (4).

Ye **engine values** hain, reference data nahi — approval engine likha hi nahi
ja sakta jab tak pata na ho ki Pending = 1 hai, aur ye list koi client nahi
deta.

Geography, education, profile aur `m_mdm_document_types`/
`m_mdm_rejection_reasons` **2B** hain, client ki lists pe blocked. Guess seed
kar ke baad mein theek karne ka matlab hai un rows pe data migration jinpe tab
tak foreign keys point kar rahi hongi.

#### Chhoti decisions jo likh deni chahiye

- `t_mdm_request_levels.LevelId` **int** hai, bigint nahi — ye configuration
  hai (per request type kuch rows), transactional volume nahi, aur koi isse
  reference nahi karta.
- `t_mdm_*_registration_details` mein `RequestId` **PK aur FK dono** hai —
  1:1 construction se enforce hota hai, kisi procedure ke yaad rakhne se nahi.
- `m_mdm_experience_range` mein `MinMonths`/`MaxMonths` — search filter
  plain integer compare ban jaata hai, "5-10" string parse karne ke bajaye.
- `t_mdm_request_approvals` **append-only**. Kabhi UPDATE nahi — trail hi
  saboot hai ki kisne kya decide kiya.
- `m_mdm_city` mein `Latitude`/`Longitude` abhi nullable — dataset aane par
  bharenge. Shuru se isliye hain ki "jobs near me" ko baad mein us table pe
  migration na karni pade jispe tab FKs hongi.

---

### 2.46 APPROVAL ENGINE — PHASE 2C

jp_mdm mein 10 procedures (9 + `USP_LogError`), 33 tables, 93 indexes,
30 FKs. Test suite **26/26**.

#### 🔴 RequestNo — counter row, MAX()+1 nahi, SEQUENCE bhi nahi

Format `REG-SCH-2026-00001`. Har request type ke liye, har saal alag.

```sql
UPDATE s SET LastNumber = s.LastNumber + 1
OUTPUT inserted.LastNumber INTO @Seq
FROM dbo.t_mdm_request_number_series AS s WITH (UPDLOCK, ROWLOCK)
WHERE s.RequestTypeId = @RequestTypeId AND s.SeriesYear = @Year;
```

**MAX()+1 kyun nahi:** do sessions same maximum padh lete hain insert se pehle,
dono ko same number milta hai. Kuch error nahi aata — duplicate bas ban jaata
hai, aur pata tab chalta hai jab do schools support ko same reference bolte
hain.

**SEQUENCE kyun nahi:** numbering **saal aur type dono** pe restart hoti hai.
Uske liye har combination ka apna SEQUENCE chahiye, har January mein dynamic
SQL se banaya hua. Aur row restore ke baad bhi zinda rehti hai, padhi aur theek
ki ja sakti hai — SEQUENCE ka current value server state hai jo data ke backup
mein nahi aata.

**Prefix hardcoded nahi hai** — `m_mdm_request_types.RequestNoPrefix` column
hai (2C mein add hua). Paanchva request type ab seed row hai, code change nahi.

⚠️ `SeriesYear` **IST** saal hai. 1 January 01:00 IST abhi 31 December UTC
hai — UTC saal use karte to har saal ki pehli request galat saal mein
number paati.

#### Idempotent submit — do layers

1. Procedure pehle dekhta hai: is `(RequestTypeId, EntityUid)` ka Pending
   request already hai? Hai to **wahi return** karta hai, naya nahi banata.
2. 2A ka filtered unique index race pakadta hai — do concurrent sessions dono
   check pass kar sakte hain insert se pehle.

CATCH mein 2627 ko `ALREADY_PENDING` bana kar return karte hain, kyunki us
submission mein kuch galat tha hi nahi.

#### 🔴 RowVersion do jagah check hota hai

Validation mein padha jaata hai, **aur UPDATE ke WHERE clause mein dobara**:

```sql
WHERE RequestId = @RequestId AND RowVersion = @RowVersion AND StatusId = 1
```

Validation wala read transaction ke **bahar** hota hai. Beech mein koi doosra
session commit kar sakta hai. WHERE clause check aur write ko atomic banata
hai. `@@ROWCOUNT = 0` par 50023, jise CONCURRENCY_CONFLICT bana kar
return karte hain — 500 nahi.

Test: do admins same RowVersion se act karte hain, doosra haar jaata hai aur
**trail mein uski koi row nahi banti**.

> ⚠️ **CORRECTION — 2026-08-09, independent verification.**
>
> Upar likha check **sahi hai**, par jo test uske liye likha gaya tha wo use
> **actually chhoo hi nahi raha tha.**
>
> Ek hi level configure hone ki wajah se koi bhi successful approve request ko
> **complete** kar deta hai. To doosri koshish **status check** pe hi ruk jaati
> hai (`INVALID_STATUS` — "already approved"), aur RowVersion ki tulna tak
> control pahunchta hi nahi. Suite ka concurrency assertion pass ho raha tha,
> par **jis wajah se claim kiya gaya tha us wajah se nahi.**
>
> Isolate karke verify kiya — rolled-back transaction mein request type 1 ko
> do-level banaya, level 1 approve kiya (status Pending hi raha, RowVersion 2,
> `IsCompleted = 0`), phir stale RowVersion se approve kiya:
>
> ```
> Status  Code                   Message
> 0       CONCURRENCY_CONFLICT   Someone else has already actioned this request.
> ```
>
> Trail row nahi bani, level 2 hi raha. **RowVersion check kaam karta hai.**
> Side effect: multi-level advancement bhi asli mein verify ho gaya — wo
> single-level seed pe dead code nahi hai.
>
> 🔴 Jo abhi bhi missing hai: **suite mein aisa koi case nahi jo RowVersion
> branch tak pahunche.** Dekho G10.

#### Multi-level engine, chahe abhi ek hi level ho

MVP har request type ke liye ek level seed karta hai (`IsFinalLevel = 1`), par
`USP_ProcessApprovalAction` configuration **padhta** hai — assume nahi karta.

Phase 6 ka do-level offer approval ek **INSERT** hona chahiye, procedure ka
rewrite nahi. Isliye shortcut nahi liya.

#### Cross-DB kaam API ka hai

`USP_ProcessApprovalAction` `IsCompleted` return karta hai. Request complete
hone par school `jp_app` mein banani hai aur user `jp_sso` mein activate
karna hai — **dono cross-database writes**, jo 2.2 ke hisaab se API layer mein
hain. Yahan karne ke liye teen databases ka distributed transaction chahiye
hota, jo bilkul wahi coupling hai jo 2.2 rokta hai.

#### Documents — Version badhta hai, overwrite kabhi nahi

Rejected document hi saboot hai ki reject kyun hua. Resubmit file ko replace
kar deta to rejection reason ek aise document pe point karta jo ab exist nahi
karta — aur applicant baad mein badal sakta tha ki kya reject hua tha.

`USP_SaveRequestDocument` version read pe `UPDLOCK, HOLDLOCK` leta hai,
warna do concurrent uploads same MAX padh kar dono same version insert karte
aur unique index ek ko reject kar deta — ek upload fail jo galat tha hi nahi.

#### `USP_GetMaster` — whitelist, dynamic SQL nahi

`@MasterCode` query string se aata hai. Use table name mein concatenate karna
SQL injection hai, chahe kitna bhi quote kar lo. Parameter sirf ek CASE branch
chunta hai jo is file ne likha hai. Unknown code = **khaali result set**, error
nahi — caller uska kuch kar nahi sakta.

#### Test suite — 26 assertions, aur do cheezein jo theek karni padi

Cover: happy path · reject · request-resubmit → resubmit → approve · illegal
transition refuse · concurrent approve (stale RowVersion haarta hai, trail row
nahi banti) · repeated submit se doosra Pending nahi banta aur RequestNo nahi
badalta · 10 submissions = 10 distinct contiguous numbers · error log rollback
ke baad bhi zinda.

⚠️ **Suite kuch peeche nahi chhodti** — requests/trail/subjects/series counts
pehle aur baad mein identical.

Do galtiyan jo build ke dauraan pakdi gayin:
1. **Table variable scalar ke saath ek DECLARE share nahi kar sakta.**
   `DECLARE @i int = 0, @Made TABLE (...)` syntax error hai. Aur `WHILE` ke
   andar `DECLARE` sirf ek baar chalta hai — har iteration ke liye `SET`
   chahiye, warna sab iterations same Uid use karti.
2. **`m_mdm_subject` khaali hai 2B tak.** Suite apne subject fixtures khud
   banati hai, **900+ id block** mein jo asli seed kabhi use nahi karega.

---

### 2.47 MASTER DATA SEED — PHASE 2B

Client ki lists nahi aayi. Blocked rehna guess karne se zyada mehnga tha, to
**humne khud seed kiya** — par saaf nishaan ke saath ki kya humara guess hai.

#### 🔴 CODE STABLE HAI, NAME EDITABLE

| | |
|---|---|
| `Code` | **Identifier.** FKs isse resolve hoti hain, seed scripts isse match karti hain. **Live hone ke baad kabhi mat badlo.** |
| `Name` | **Display text.** Client jab chahe badle. |

Client bole "State Board ko State Education Board likho" — wo **ek column ka
UPDATE** hai, migration nahi. Yehi is rule ka poora point hai.

Codes conventional hain, generated nahi: `CBSE`, `PRT`, `TGT`, `PGT`,
`MH`. Koi slug nahi, koi sequential number nahi.

#### DisplayOrder jaan-boojh kar set kiya, alphabetical nahi

Ye dropdowns din mein sau baar khulti hain. Alphabetical order har us baar ka
chhota tax hai.

- **Designation** career order mein: PRT → TGT → PGT → Coordinator → Vice
  Principal → Principal
- **Class level** school order mein: Pre-Primary → Sr. Secondary
- **Qualification** kism ke hisaab se grouped: teaching (1-5), academic (11-17),
  eligibility tests (21-24)
- **Subject** faculty ke hisaab se: sciences (1-6), languages (10-20),
  humanities/commerce (25-33), practical (40-47)
- **States** alphabetical — yahan alphabetical **sahi** hai, kyunki states ka
  koi meaningful order hai hi nahi. UTs baad mein alag group.

#### Row counts

| Table | Rows | |
|---|---|---|
| `m_mdm_country` | 1 | India |
| `m_mdm_state` | 36 | 28 states + 8 UTs |
| `m_mdm_district` | **0** | 🔴 khaali — neeche dekho |
| `m_mdm_city` | **0** | 🔴 khaali — neeche dekho |
| `m_mdm_board` | 7 | |
| `m_mdm_qualification` | 16 | |
| `m_mdm_subject` | 34 | |
| `m_mdm_designation` | 10 | |
| `m_mdm_class_level` | 5 | |
| `m_mdm_stream` | 4 | |
| `m_mdm_gender` | 4 | |
| `m_mdm_experience_range` | 5 | MinMonths/MaxMonths ke saath |
| `m_mdm_school_type` | 6 | ⚠️ PROVISIONAL |
| `m_mdm_skill` | 20 | ⚠️ PROVISIONAL |
| `m_mdm_facility` | 12 | ⚠️ PROVISIONAL |
| `m_mdm_document_types` | 9 | ⚠️ PROVISIONAL |
| `m_mdm_rejection_reasons` | 10 | ⚠️ PROVISIONAL |
| `m_mdm_request_types` | 4 | 2A |
| `m_mdm_approval_status` | 5 | 2A |
| `m_mdm_action_types` | 5 | 2A |
| `m_mdm_payment_modes` | 4 | 2A |
| `m_mdm_payment_status` | 4 | 2A |
| `t_mdm_request_levels` | 4 | 2C |

#### ⚠️ Provisional kya hai aur kyun

Har provisional script ke header mein poori list hai. Sabse risky:

🔴 **`m_mdm_document_types.IsMandatory`** — ye decide karta hai ki school
registration **complete ho paayegi ya nahi.** Galat mandatory = asli
registrations block. Galat optional = unverifiable schools andar.

Humne sirf wahi mandatory kiya jiske bina verification ho hi nahi sakti:
- school: Registration Certificate, Authorization Letter
- teacher: Degree Certificate, ID Proof

`MaxSizeKb = 5120` (5 MB) sab par, extensions `pdf,jpg,jpeg,png`. Dono
humare number hain — phone se certificate ki photo aasaani se 2 MB paar kar
jaati hai, isliye kam nahi rakha.

`m_mdm_skill` **poori tarah humari invention** hai — Indian schooling mein
teaching skills ki koi standard list hai hi nahi.

#### 🔴 DISTRICT AUR CITY KHAALI HAIN — consequence

800+ districts aur hazaaron sheher **dataset** hain, list nahi. Guess kiya hua
dataset na hone se bura hai: har row FK target ban jaati hai jise baad mein
replace nahi, **migrate** karna padta.

**2F ke form banane se pehle confirm kiya — koi schema change nahi chahiye:**

```
t_mdm_school_registration_details.CityId          NULL
t_mdm_school_registration_details.DistrictId      NULL
t_mdm_school_registration_details.StateId         NULL
t_mdm_teacher_registration_details.CurrentCityId  NULL
t_mdm_teacher_registration_details.CurrentStateId NULL
```

**Saare nullable hain.** Form **state-only** pe degrade kar sakta hai bina
kuch tode. Jab tak data nahi aata:
- State dropdown chalega (36 rows)
- District/city dropdown **hide** karo, disabled-empty mat dikhao — khaali
  dropdown "toota hai" padha jaata hai, "abhi nahi hai" nahi
- Address free-text `AddressLine1/2` + `Pincode` se kaam chalega

⚠️ Phase 3 mein `t_app_teachers` aur `t_app_jobs` pe bhi `CityId` aayegi —
wahan bhi **nullable** rakhna, warna yehi sawaal dobara khulega.

#### District/city dataset — source aur import plan (abhi banaya NAHI hai)

**Source, preference order mein:**
1. **LGD (Local Government Directory), lgdirectory.gov.in** — Ministry of
   Panchayati Raj ka official source. State/district/sub-district/village codes
   deta hai, CSV export hota hai. **Yehi use karna chahiye** — official codes
   ka matlab hai humare Code values kisi sarkari cheez se milte hain.
2. **Census 2011 town/village directory** — zyada granular, par purana.
3. **India Post pincode dataset** — pincode → district/city mapping, jo
   address form ke liye alag se useful hai.

⚠️ GitHub pe padi random "indian-cities.json" list mat uthana. Source pata nahi,
maintain nahi hoti, aur codes kisi cheez se match nahi karte.

**Import script kaisa dikhega:**
- `jp_mdm/03_seed/008_seed_districts.sql` aur `009_seed_cities.sql`
- Data `BULK INSERT` ya staging table mein, phir MERGE — 800+ aur hazaaron
  rows ke liye inline `VALUES` list practical nahi
- **`StateId` Code se resolve hoga** (`MH`, `TN`), hardcoded id se nahi —
  wahi pattern jo 003 mein country ke liye hai, aur typo pe THROW
- `Code` LGD ka official code, ya `<STATE>_<SLUG>` agar LGD code na ho
- City ke `Latitude`/`Longitude` jahan mile wahan bhare, warna NULL —
  column pehle se hai, "jobs near me" ke liye migration nahi chahiye
- Re-runnable, baaki sab seeds ki tarah

#### Re-runnable aur FK-by-Code

Sab MERGE hain, kabhi DELETE nahi. `m_mdm_document_types` aur
`m_mdm_rejection_reasons` apni `RequestTypeId` **Code se resolve** karte
hain aur unknown code pe **THROW** karte hain (50032/50033) — typo se orphan
row nahi banti. Wahi pattern jo menu seed (2.37) mein tha.

Verify: `run_all.sql` do baar chalaya, doosri baar kuch insert nahi hua.

#### 2C test suite — seed ke baad bhi theek hai

Suite apne subject fixtures **901-903** mein banati hai; asli seed **1-47** use
karta hai. Codes bhi alag (`TEST_MATH` vs `MATHS`). Dobara verify kiya:
**26/26 pass**, aur subjects/requests/series counts pehle-baad identical.

---

### 2.48 `JP.App.Api` — PHASE 2D ENDPOINTS AND CROSS-DB ORCHESTRATION

Masters, approvals aur documents ke endpoints. Build **0 warning 0 error**.

#### 🔴 Cross-DB orchestration — distributed transaction NAHI hai

Approval complete hone par teen kaam hote hain, teen alag databases mein, **teen
alag commits**:

1. `jp_sso` — user Active + role grant
2. `jp_app` — school create
3. email queue

2.2 kehta hai ye API layer mein ho. Sahi trade hai — MSDTC teeno databases ko
permanently couple kar deta — par iska ek natija hai jise **handle karna padta
hai, umeed nahi**: step 1 pass ho kar step 2 fail ho sakta hai, aur tab ek
**Active user reh jaata hai bina profile ke**, jo sign in kar leta hai aur
khaali shell pe girta hai.

Teen cheezein isse survivable banati hain:

**1. Ordering.** User pehle activate hota hai, school baad mein. Ulta karte to
failure ek aisi school chhodta jisme koi sign in hi nahi kar sakta — dono taraf
se invisible. Is tarah failure kam se kam **pahunch mein** hai: user exist karta
hai aur shikayat kar sakta hai.

**2. Idempotency.** Har step dobara chal sakta hai. Provisioning
`SourceRequestUid` pe key karti hai (filtered unique index), activation ek fixed
state pe transition hai, email queue hoti hai.

**3. Loud failure.** Step 2 fail hone par `🔴 PARTIAL COMPLETION` Error log
hota hai — `RequestNo`, `RequestId`, `UserId` ke saath — aur response mein
`orchestrationCompleted = false` + `orchestrationError` jaata hai.

⚠️ **HTTP 200 aata hai, 500 nahi.** Approval sach mein hua hai aur usse
un-happen nahi kiya ja sakta (wo doosre database mein commit ho chuka). 500
bolna jhooth hota. **Client ko `orchestrationCompleted` padhna hai, sirf status
code nahi.**

Safety net: `USP_FindOrphanedApprovals` — complete ho chuke approvals jinki
school nahi bani.

#### Verification — chaaron proofs, asli output

| Proof | Result |
|---|---|
| (a) approval response | `orchestrationCompleted: false` + `orchestrationError` |
| (b) log line | `🔴 PARTIAL COMPLETION. Approval REG-SCH-2026-00003 (RequestId 89): user 41 is ACTIVE but provisioning threw.` |
| (c) reconciliation | teeno orphan requests mile, `REG-SCH-2026-00003` sahit |
| (d) retry | pehli baar `School created.`, doosri baar `ALREADY_PROVISIONED`, **total schools = 1** |

Step 2 ko `sp_rename` se genuinely tod kar test kiya — mock se nahi.

#### 🔴 Verification ne teen asli bug pakde

**1. `JP.App.Api` ke paas `Sso` connection string thi hi nahi.**
Sirf `Mdm` aur `App`. Activation `InvalidOperationException: no connection
string for the 'Sso' database` pe girta tha. Cross-DB orchestration API layer
mein hai, to API ko **har us database ka connection chahiye jise wo orchestrate
karta hai** — sirf apne ka nahi. `appsettings.json` mein add kiya, comment ke
saath.

**2. Activation idempotent nahi thi — aur isse retry hamesha ke liye toot
jaata.** `USP_UpdateUserStatus` no-op transition ko `BUSINESS_RULE_VIOLATED`
deta hai (admin ke do baar button dabane ke liye sahi, yahan galat). Matlab:
step 1 pass + step 2 fail wale case ka **retry step 1 pe hi ruk jaata aur kabhi
provision tak pahunchta hi nahi.** Orphan permanent ho jaata.
Fix: `UpdateUserStatusForApprovalAsync` pehle current status padhta hai aur
target pe pehle se hone par success return karta hai — message match kar ke
nahi, kyunki message display text hai, contract nahi.

**3. Retry ka koi API endpoint hai hi nahi.** Orchestration idempotent hai par
use dobara chalane ka koi tareeka nahi — approval already Approved hai to
`/action` refuse karta hai. Abhi retry sirf procedure seedha call kar ke hota
hai. **G11 dekho.**

#### 🔴 Teacher branch provision NAHI karti — jaan-boojh kar

2.9: school ke liye approval activation ka **gate** hai, to profile approval par
banti hai. Teacher ka account **signup se hi Active** hai — verification ek
**badge** hai pehle se maujood profile par, gate nahi.

To teacher branch ek **explicit branch** hai jo:
- kuch provision nahi karti
- school path pe fall through nahi karti
- **failed outcome return karti hai**, success nahi

Jo kaam hua hi nahi uske liye success bolna wahi orphan problem ek layer upar
dobara bana deta — aur us baar reconcile karne ko kuch nahi hota.
`t_app_teachers` Phase 3 hai. **G12 dekho.**

#### File upload — har upload ko hostile maana

`UploadValidator` mein chaar checks, har ek isliye ki baaki teen alag-alag
bypass ho sakte hain:

1. **Extension** — `m_mdm_document_types.AllowedExtensions` se, constant se nahi
2. **🔴 Magic bytes** — content extension se match kare. Iske bina `.exe` ko
   `.pdf` naam de kar sab kuch pass kar jaata. **Verify kiya**: `MZ` header wali
   `evil.pdf` reject hui
3. **Size** — `MaxSizeKb` usi row se, aur bytes uss cap tak hi padhi jaati hain
4. **Storage name GUID hai** — client ka filename kabhi path nahi banta, to
   `../../web.config` ke jaane ko jagah hi nahi. Verify kiya: disk pe
   `f7d9e371...pdf`, `FileName=real.pdf` sirf metadata

MIME **sniff** kiya hua store hota hai, `Content-Type` header se nahi — wo
client input hai.

⚠️ **Virus scanning abhi nahi hai.** Hook `DocumentService.UploadAsync` mein
marked hai — validation ke baad, storage se pehle. **G13 dekho.**

#### Download — 404, 403 nahi

Non-owner ko `404 NOT_FOUND` milta hai. Document exist karta hai par tumhara
nahi — ye confirm karna khud ek disclosure hai.

Verify kiya (asli request se, kyunki ye wahi cheez hai jise global exception
filter galat map kar sakta hai):

| Caller | HTTP |
|---|---|
| owner (school) | **200** |
| doosri school | **404** (`NOT_FOUND`) |
| admin + permission | **200** |

#### Masters — cache haan, menus ke ulat

`/api/masters/*` pe `Cache-Control` 1 ghanta. `/api/menus` `no-store` hai
kyunki wo **per-user aur permission-dependent** hai — usse cache karna ek banda
doosre ka navigation dikha dega. Farak ehtiyat ka nahi, **content ka** hai: ek
public reference data hai, doosra authorization ka result.

⚠️ `districts`/`cities` **khaali list** dete hain, 404 nahi — form ko state-only
pe degrade karna hai (2.47). Verify kiya: `HTTP 200`, `data: []`.

#### IDOR

`SubmitApprovalRequest` aur `ApprovalRequestFilter` mein `OrganizationUid`/
`RequestorUserId` **hai hi nahi** — optional bhi nahi. Dono controller mein
token se aate hain aur repository ko **alag arguments** ke roop mein jaate hain.
Jo field aaj ignore hota hai, wo chhe mahine baad koi honour kar leta hai.

Admin `null` scope pe sab dekhta hai; baaki sab apne `OrganizationUid` pe pinned
hain — koi parameter ise badal nahi sakta.

#### `USP_GetMaster` pe doosra whitelist NAHI

Procedure khud apne CASE se branch chunta hai aur unknown key pe khaali set
deta hai. Service/controller mein doosri list rakhne ka matlab **do lists jinhe
agree karna padta** — aur jis din wo disagree karti hain, ya to ek master
dropdown se gayab ho jaata hai ya koi naya reachable ho jaata hai jo nahi hona
chahiye. **Ek gate, procedure mein.**

#### Files

```
JP.Domain/Masters/MasterContracts.cs
JP.Domain/Approvals/ApprovalContracts.cs
JP.Infrastructure/Repositories/MdmModels.cs · MasterRepository.cs
                              ApprovalRepository.cs · ProvisioningRepository.cs
JP.Infrastructure/Services/MasterService.cs · ApprovalService.cs
                           DocumentService.cs · ApprovalOrchestrationService.cs
JP.Infrastructure/Storage/UploadValidator.cs
JP.App.Api/Controllers/{Masters,Approvals,Documents}Controller.cs
database/jp_app/01_tables/001_t_app_schools.sql · 002_t_app_error_log.sql
database/jp_app/04_procedures/000_USP_LogError.sql · 001_provisioning.sql
database/jp_sso/04_procedures/009_identity_lookup.sql
database/jp_mdm/04_procedures/005_document_lookup.sql
```

⚠️ `t_app_schools` **Phase 3 se pull forward** hui — step 2 ko likhne ki jagah
chahiye thi. Minimum columns; Phase 3 baaki ALTER se add karega, CREATE edit kar
ke nahi.

---

### 2.49 ADMIN VERIFICATION PANEL — PHASE 2E

`jp-admin` mein verification queue, request detail aur dashboard. Production
build **clean**. Do naye endpoint jo **G11 band karte hain**.

#### 🔴 G11 CLOSED — orphan ab ek button hai, DBA ka kaam nahi

`POST /api/approvals/{id}/retry-orchestration` + `GET /api/approvals/orphaned`.

Pehle: orchestration idempotent thi par usse chalane ka koi rasta nahi tha.
Ek partial completion ka matlab tha — school approve ho gaya, use kar nahi
sakta, aur theek karne ke liye kisi ko **SQL access** chahiye.

Ab dashboard pe sabse upar ek section hai: kaun toota hai, **kitni der se
toota hai**, aur Retry. Empty hone par **section render hi nahi hota** — "0
problems" wala panel furniture ban jaata hai, aur furniture dikhna band ho
jaata hai. Section ka aa jaana hi alarm hai.

⚠️ Reconciliation **teacher verification ko chhodti hai** (`RequestTypeId IN
(1,3)`). Wo design se kuch provision nahi karti (2.9), to har approved teacher
request hamesha ke liye "orphan" dikhti — aur ek hamesha-galat list wo list hai
jise koi nahi kholta. Ek mahine mein asli orphan page 3 pe do sau jhooth ke
neeche hota.

Retry `RowVersion` nahi maangta, jaan-boojh kar: approval ko haath hi nahi
lagta — na action row, na status change. Sirf uske **baad ka kaam** dobara
chalta hai, aur wo idempotent hai. Do admin dabayein to kaam do baar chalega
aur converge kar jaayega.

#### 🔴 Verification ne CHAAR asli bug pakde — teeno 2D/2C ke the

**1. Reject karne se school BAN JAATA THA.**
`ProcessActionAsync` `IsCompleted` par orchestrate karti thi. Rejection bhi
request ko complete karti hai — to reject karne par user activate hota tha aur
school create hoti thi. Wahi natija jise rokne ke liye reject exists karta hai,
aur kisi screen pe iska koi nishaan nahi.

Pakda kaise: admin UI se ek request reject ki, phir `jp_app` mein school padi
mili.

Fix **do gate**: service `NewStatusId = Approved` check karti hai, aur
orchestrator khud bhi refuse karta hai. Do isliye ki ek pehle hi miss ho chuka
hai, aur galti ka daam error message nahi — chupchaap ban gaya school hai.

Saath mein semantics theek ki: `orchestrationCompleted` ab **"kuch adhoora nahi
bacha"** kehta hai. Rejection aur level-advance dono ke liye `true`, kyunki
dono mein karne ko kuch tha hi nahi. Pehle `false` aata tha, jo ek theek-thaak
rejection par partial-completion warning jala deta — aur jo warning jhooth
bolti hai wo us din dismiss hoti hai jis din sach hoti hai.

**2. Multi-word master key har jagah KHAALI list de raha tha.**
`USP_GetMaster` `SCHOOL_TYPE` expect karta hai; client `/api/masters/school-type`
bhejta hai. `UPPER()` se `SCHOOL-TYPE` banta tha — kisi branch se match nahi,
`200` ke saath khaali list. **Har multi-word master ka dropdown chup-chaap
khaali tha**, na error, na log.

Fix procedure mein: `UPPER(REPLACE(@MasterCode, '-', '_'))`. API mein map
karne se 2.48 ka "ek gate" wala niyam tootta — do lists jinhe agree karna
padta.

**3. `DateOnly` padhne par har call phenkti thi.**
Teacher ki DOB `date` column hai aur C# mein `DateOnly` (2.28). Dapper us
conversion ko nahi jaanta, to `Error parsing column (DOB=… - DateTime)`.

⚠️ Ye **write ke BAAD** hota tha: request submit hui, commit hui, phir
RequestNo padhne wali read gir gayi — applicant ko us cheez ka error mila jo
sach mein ho chuki thi, aur uska retry idempotency guard se takra gaya.
Fix: `DateOnlyTypeHandler` + `TimeOnlyTypeHandler`, startup pe registered.

**4. Detail header mein `EntityName` tha hi nahi.**
List proc deta hai, detail proc nahi. Screen ka title school ke naam ki jagah
"School registration" dikha raha tha. Ek contract, do procedures — dono ko
poore contract par agree karna hai.

#### 🔴 Screen jo sabse zyada maayne rakhti hai

Approve HTTP **200** deta hai chahe uske baad ka kaam fail ho jaaye (2.48).
To UI `orchestrationCompleted` padhti hai, status code nahi — aur ye kaam
**`describeOutcome()` mein ek jagah** hota hai, taaki doosri interpretation
paida hi na ho.

Chaar outcome, aur teen mein se koi bhi toast nahi:

| Kya hua | Kaise dikhta hai |
|---|---|
| Sab theek | success toast, banner nahi — kaam khatam hai, jagah nahi maangta |
| **Partial completion** | 🔴 **rukne wala banner** + Retry. Toast bilkul nahi |
| Teacher verification | neela "Decision recorded" — **system error nahi** |
| Level advance | "next level pe gaya", approved nahi |

Success path **sabse aakhir mein** hai. `if (ok) success() else …` likhna wahi
tareeka hai jisse failure "Approved" wale toast ke peeche chala jaata hai.

Verify kiya asli fail karwa kar (`sp_rename`, mock se nahi). Admin ko ye dikha:

> **Approved — but the account is not usable yet**
> REG-SCH-2026-00006 is approved and that decision is final. What did not
> finish is the work that follows it: The account was activated but the school
> record could not be created. … Until this is retried, the school can sign in
> and will find an empty workspace.

Retry dabaya → school ban gayi. Screenshot `screenshots/2e/`.

⚠️ Retry **detail screen par bhi** hai, sirf banner par nahi. Orphan list se
aane wale ke paas banner hota hi nahi — usne Approve dabaya hi nahi tha.

#### Queue — ek work queue, report nahi

Default order **oldest first, SQL mein** (2C). `WaitingDays` bhi server se —
galat clock wali machine warna dashboard se disagree karti ki sabse purana
kaun hai.

Attention pattern **applicants table se udhaar**, naya nahi banaya: 3+ din wali
row par red **margin rule**, aur usi row ka Waiting column shabdon mein wahi
baat kehta hai. Rang reinforcement hai, akela carrier kabhi nahi. Ek product,
ek grammar.

Sorting 2C ke proc mein add ki — **paanch column, CASE whitelist se**, dynamic
SQL nahi. Chuna hua column pehle, phir hamesha `SubmittedOn, RequestId` neeche:
warna same second wali do rows refresh par page badal leti hain aur koi row
chhoot jaati hai.

⚠️ `waitingDays` **ulta** sort hota hai (`SubmittedOn DESC`) — sabse lamba
intezaar sabse purani submission hai.

Tabs asli **routes** hain, signal nahi: back button, bookmark aur seeded menu
rows teeno kaam karte hain.

#### Document viewer — PDF aur image, dono inline

Download kar ke padhna verification ka sabse bada friction hai, aur wahi cheez
hai jisse log bina dekhe batch-approve karte hain.

File `Authorization` header maangti hai, aur browser `<img>`/`<iframe>` ke
liye header bhejta hi nahi — to blob HttpClient se aata hai aur object URL ban
kar element ko milta hai.

🔴 **Har object URL revoke hota hai** — document badalne par aur destroy par.
Ek reviewer ek baithak mein pachaas request dekhta hai; pachaas pinned PDF
matlab tab ghisatne lagta hai bina kisi wajah ke jo screen par dikhe.

⚠️ Aur ek trap jo pehli baar mein lag gayi thi: effect ke andar **object URL
wala signal padhna** us signal par dependency bana deta hai. Fetch ke baad set
karne se effect dobara chalta, wo abhi bana URL revoke karta, phir se fetch —
hamesha, khaali viewer aur zero error ke saath. Ab bookkeeping ek plain field
mein hai, signal sirf template ke liye.

Download `SKIP_LOADER` ke saath jaata hai: paanch document dekhne ke liye
paanch baar poori screen black-out karna viewer ko download se bura bana deta
hai. Panel ka apna skeleton hai.

#### Rejection reason ab DATA hai, prose nahi

`t_mdm_request_approvals.RejectionReasonId` add hui (+ FK, + index INCLUDE, +
existing DB ke liye guarded ALTER). Pehle sirf `Remarks` thi.

"Kitni registration authorisation letter galat hone se fail hoti hain" wo sawal
hai jo business poochhega, aur free text grep karna uska jawab nahi hai. 2F ko
bhi school ko reason **alag se** dikhana hai, note se alag.

Reject dialog reason **maangta** hai, aur textarea ka placeholder us reason ke
hisaab se badalta hai — code par keyed (stable, 2.47), name par nahi:

> DOC_MISMATCH → "Which detail does not match? e.g. the certificate says
> 'Greenwood Public School' and the form says 'Greenwood School'."

Khaali textarea "rejected" paida karta hai, aur uske baad ek phone call.
`OTHER` chunne par note **compulsory** ho jaata hai — reason khud kuch nahi
kehta, to note ko kehna padega.

⚠️ Reject ka confirm button **laal** hai, primary nahi. Jis laal button ne
dialog khola usi ke jawab mein hara button rakhna wahi confusion hai jise
confirm step rokne ke liye hai.

#### Files

```
jp-backend/JP.Domain/Approvals/ApprovalContracts.cs        (OrphanedApprovalDto, trail reason)
jp-backend/JP.Infrastructure/Data/DateOnlyTypeHandler.cs   (naya)
jp-backend/JP.Infrastructure/Repositories/{ApprovalRepository,MdmModels}.cs
jp-backend/JP.Infrastructure/Services/{ApprovalService,ApprovalOrchestrationService}.cs
jp-backend/JP.App.Api/Controllers/ApprovalsController.cs
database/jp_mdm/01_tables/026_t_mdm_request_approvals.sql  (RejectionReasonId)
database/jp_mdm/04_procedures/002_approval_action.sql      (reason persist)
database/jp_mdm/04_procedures/003_approval_reads.sql       (sort + EntityName)
database/jp_mdm/04_procedures/004_documents_masters.sql    (key normalise)
database/jp_mdm/04_procedures/006_reconciliation.sql       (naya)
jp-shared/src/core/models/lookup.model.ts                  (6 naye master keys)
jp-admin/src/app/core/{approval.models,approval.service,document.service,orchestration-outcome}.ts
jp-admin/src/app/features/verification/queue/verification-queue.component.*
jp-admin/src/app/features/verification/detail/{request-detail,document-viewer,request-trail}.component.*
jp-admin/src/app/features/dashboard/{dashboard,orphaned-approvals}.component.*
jp-admin/src/app/app.routes.ts
```

⚠️ **Operational:** `jp-shared` aur uske hosts **ek hi build mode** mein hone
chahiye. Production remote + dev host = `ReferenceError: ngDevMode is not
defined` boot par, kyunki remote ka bundle host ke runtime mein load hota hai.

---

### 2.50 SCHOOL REGISTRATION — PHASE 2F

`jp-school` mein paanch-step registration form + account-status ko asli data se
joda. Teeno frontend production build **clean**. Poora flow end to end verify
kiya: register → draft → upload → submit → admin approve → school sign in.

#### 🔴 TEEN PULL-FORWARD, ek hi wajah se

**Provisioning IS PHASE mein hoti hai.** Jo cheez school ke exist karte hi honi
chahiye, wo usi transaction mein banni chahiye. Baad mein add karne ka matlab
beech mein approve hue har school ke liye **backfill** — wahi gap jo teacher
profiles ke liye pehle se hai (G12), aur use teen baar banane ka koi faayda
nahi.

| Aage kheecha | Kyun abhi |
|---|---|
| `t_app_school_branches` | Har school ko din se ek head office chahiye |
| PAN — registration + school | Registration pe liya jaata hai, provisioning ke paar bachna chahiye |
| `m_mdm_plans` + `t_app_subscriptions` | Har account ko din se ek plan chahiye — koi null state nahi |

**Teen INSERT, ek guard, ek transaction.** School, uski head-office branch aur
uska subscription — teeno `SourceRequestUid` wale idempotency guard ke **andar**,
uske bagal mein nahi.

⚠️ Bahar rakhne par retry school ko dhoondh kar chhod deta aur **doosri head
office + doosra subscription** bana deta. Us waqt kuch shikayat nahi karta;
school ke paas do address aur do plan ho jaate, aur jise baad mein pata chalta
use ye tay karne ka koi tareeka nahi hota ki sahi kaun sa tha.

Do aur guard database mein: `UQ_..._OneHeadOffice` (per school) aur
`UQ_..._OneActivePerOwner` (per organisation).

⚠️ PlanId **API resolve karti hai**. Plans `jp_mdm` mein hain, subscriptions
`jp_app` mein, aur dono join nahi kar sakte (2.2) — to API plan padh kar id
provisioning ko deti hai. Plan na mile to provisioning **rukti hai**, school
bina plan ke nahi banti: "har account ka ek plan hota hai" tabhi sach hai jab
code exception banane se mana kar de.

#### 🔴 AADHAAR NUMBER KAHIN NAHI — aur ye jaan-boojh kar hai

**Teacher ke liye Aadhaar number ka field NAHI banaya, aur aage bhi nahi
banana.**

Aadhaar number store karna Aadhaar Act aur UIDAI rules ke tehat restricted hai.
Private entity aam taur par bina specific authorisation ke poora number retain
nahi kar sakti, aur penalty lagti hai. Asli verification ke liye UIDAI-authorised
KYC provider chahiye — jo hum nahi hain.

**Iski jagah:** `m_mdm_document_types` mein IdProof pehle se hai. Teacher chunta
hai ki wo kaun sa government photo ID de raha hai — Aadhaar, PAN, Voter ID,
Passport ya Driving Licence — aur document upload karta hai. **Koi identity
number store hi nahi hota.**

⚠️ Agar client khaas taur par Aadhaar number capture karne ko kahe, wo unka
legal faisla hai aur **likhit mein, unki apni legal advice ke saath** confirm
hona chahiye. Zubaani request par implement mat karna.

#### 🔴 DRAFT ek REQUEST hai, alag table nahi

Form paanch step + document uploads ka hai. School ko beech mein chhod kar wapas
aana **safe hona chahiye** — adhoora form aur upload ki hui files kho dena
matlab wo wapas aate hi nahi.

Seedha design ek drafts table hota JSON blob ke saath. **Kaam nahi karta**, aur
wajah documents hain: upload `RequestId` se judta hai, to pehli file store hone
se pehle ek request row honi hi chahiye. JSON draft ko apna parallel document
store chahiye hota, aur phir submit pe unhe asli request pe migrate karna — ek
step jo school ko "ho gaya" bolne ke **baad** fail ho sakta hai.

To draft hi request hai, `StatusId 8 (DRAFT)` mein — jo `m_mdm_approval_status`
mein hamesha se tha aur ab tak kisi ne use nahi kiya. Documents pehle upload se
hi usse judte hain aur kabhi hilte nahi.

⚠️ `UQ_..._OnePendingPerEntity` `StatusId = 1` par filtered hai, to draft usse
takraate nahi — isi wajah se ye index ko chhue bina chalta hai.

⚠️ Draft ko **asli RequestNo nahi milta**. Wo per-type-per-year counter se aata
hai, aur draft ke waqt allocate karne ka matlab har us bande ke liye ek number
jala dena jo form khol kar chala gaya — us sequence mein permanent gaps jise log
poora maante hain. To draft `DRAFT-000123` apne sequence se leta hai, aur asli
number **submit pe** milta hai.

#### PAN — optional, dono taraf format-checked

`t_mdm_school_registration_details` aur `t_app_schools` dono par, taaki
provisioning ke paar bache.

⚠️ **Nullable, aur nullable hi rahega.** Kai chhote school ke paas signup ke waqt
PAN haath mein nahi hoga, aur jis field ko admin baad mein maang sakta hai uspe
registration rokna jitni mehnat bachata hai usse zyada sign-up gawaata hai.
Format check hota hai **jab value di ho** — AAAAA9999A, uppercased — uska na hona
error nahi hai.

Client aur server dono par wahi regex. Client sakht hota to wo PAN reject karta
jo API maan leti.

#### Whitelist ka silent miss ab log hota hai

`USP_GetMaster` unknown key par khaali list deta hai. Table names dhoondhne wale
ke liye ye sahi hai — par yahi cheez school-type mismatch (2.49) ko hafton
invisible rakhe hue thi.

**Response bilkul waisa hi hai.** Ek `@Recognised` OUTPUT parameter add hua, aur
service unknown key par **warning log karti hai jisme key ka naam hota hai**.
Caller ko kuch nahi pata chalta; humein turant pata chal jaata hai.

Warning, error nahi: response sahi hai, aur jo alert internet se aane wale har
probe pe bajta hai wo ek din mein band kar diya jaata hai.

Verify kiya: `GET /api/masters/not-a-real-master` → `200 []`, aur log mein
`Master key not-a-real-master is not in USP_GetMaster's whitelist.`

#### Form ne khud teen cheezein pakdi

**1. Document types generic master se aa rahe the — aur wahan rules hote hi
nahi.** Generic shape Id/Code/Name/DisplayOrder/ParentId hai; `IsMandatory`,
`MaxSizeKb` aur `AllowedExtensions` teeno gir jaate hain. Natija: **kuch bhi
required mark nahi hota tha**, "ye abhi baaki hai" wala gate khaali upload step
par chup-chaap pass ho jaata tha, aur size hint padha nahi — **banaya** gaya tha.
Fix: `/api/masters/bulk`, jo `DocumentTypeDto` deta hai (2.48).

**2. Select ke placeholder ke liye explicit `null` chahiye.** Form
`schoolTypeId` ko `undefined` par shuru karta tha, aur `[ngValue]="null"` wale
option se wo match nahi karta — to naye form ke dropdown **khaali** dikhte the,
"Choose…" ke bina. Wo "list load nahi hui" padha jaata hai, "kisi ne chuna nahi"
nahi.

**3. Account-status ka right panel khaali tha.** Shell mein `authPanel` slot
hamesha se hai; login aur register use bharte hain, ye page nahi bharta tha — to
1440 pe intezaar ke baare mein ek page ke bagal mein aadhi screen khaali dark
thi. Ab wahan wo sawaal ka jawab hai jo us haalat mein banda sach mein poochh
raha hota hai.

#### Account-status ab wo waada nibhata hai

Phase 1D ki copy kehti hai: *"If we do, this page will name exactly which one and
why."* Wo page pehle poora `?code=` se render hota tha — account ke baare mein
sach, registration ke baare mein chup.

Ab school ki apni request load hoti hai aur **uska asli status decide karta
hai** kya likha jaayega. Code sirf un states ke liye fallback hai jinke peeche
koi request hoti hi nahi — suspended, locked.

Resubmit-required par screen **document ka naam, reason aur reviewer ke apne
shabd** dikhati hai. Reject par wahi, par **koi resubmit button nahi** — jo
faisla yahan se palta nahi ja sakta uske paas madad-jaisa dikhta button us
insaan ki aakhri baaki cheez zaya karta hai: ek aur koshish karne ki icchha.

#### Form ne jo jaan-boojh kar NAHI poochha

**Branch list.** Verification school-level hai, form pehle hi paanch step ka
hai, aur jis school ne abhi product use karne ka faisla nahi kiya wo us waqt
baarah campus ginwane nahi baithega. Ek radio poochhta hai — ek campus ya kai —
jo sirf ek **UI flag** hai: dashboard baad mein kya dikhaye, data ki shakl nahi.
Branch management Phase 3 hai, approval ke baad.

**Price ke baare mein kuch bhi.** Pricing final nahi hai, public FAQ khud kehta
hai, aur registration ke dauraan dikha number wo hai jispe humein pakda jaayega.

#### Verification — asli endpoints ke against

| Check | Result |
|---|---|
| draft steps mein save, phir resume | `DRAFT-000002`, PAN `ABCDE1234F`, 2 documents |
| malformed PAN | `400` — "It is ten characters: five letters, four digits, then a letter" |
| districts / cities khaali | `200 []` dono — form state-only pe degrade karta hai |
| unknown master key | `200 []` + server par named warning |
| submit | `REG-SCH-2026-00009` |
| submit dobara | `400` "already been submitted" |
| admin approve | `200`, `orchestrationCompleted: true` |
| school + branch + subscription | **teeno bane**, ek approval se |
| retry | schools/branches/subs `1/1/1` → `1/1/1` |
| school sign in | `200` |

#### Files

```
database/jp_app/01_tables/003_t_app_school_branches.sql        (naya)
database/jp_app/01_tables/004_t_app_subscriptions.sql          (naya)
database/jp_app/01_tables/001_t_app_schools.sql                (PanNumber)
database/jp_app/04_procedures/001_provisioning.sql             (teen insert, ek guard)
database/jp_mdm/01_tables/035_m_mdm_plans.sql                  (naya, + subscription status)
database/jp_mdm/01_tables/029_t_mdm_school_registration_details.sql (PanNumber)
database/jp_mdm/03_seed/008_seed_plans.sql                     (naya — do free plan, koi price nahi)
database/jp_mdm/04_procedures/007_registration_drafts.sql      (naya — save/get/submit)
database/jp_mdm/04_procedures/008_plans.sql                    (naya)
database/jp_mdm/04_procedures/004_documents_masters.sql        (@Recognised)
jp-backend/JP.Infrastructure/Repositories/PlanRepository.cs    (naya)
jp-backend/JP.Infrastructure/Services/{ApprovalService,MasterService,ApprovalOrchestrationService}.cs
jp-backend/JP.App.Api/Controllers/ApprovalsController.cs       (draft endpoints)
jp-shared/src/core/models/approval.model.ts                    (jp-admin se yahan aaya)
jp-school/src/app/core/registration.service.ts                 (naya)
jp-school/src/app/features/account/registration/*              (naya)
jp-school/src/app/features/account/account-status/*            (asli data se juda)
```

⚠️ **Approval models ab `jp-shared/models` mein hain.** Wo jp-admin ke andar the;
2F ne jp-school ko usi flow ka doosra sira diya, aur ek C# contract ki do
hath-se-rakhi copies wahi drift hai jiske khilaf unhi files ka header chetavani
deta hai. Ek copy, dono app usse import karte hain.

⚠️ **Operational, 2.49 se sakht:** dev server chalte hue `ng build
--configuration production` **mat** chalao. Dono ek hi federation artifacts
likhte hain, aur host boot par `ReferenceError: ngDevMode is not defined` de kar
girta hai. Dev server band karo, build karo, phir dev server dobara chalao.

---

### 2.51 `jp_app` TABLES — PHASE 3A

12 nayi table + 2 ALTER script. `jp_app` ab **16 table · 63 index · 15 FK ·
47 check**. Doosri baar chalane par **zero naya object**.

#### Do ALTER — jo 2D aur 2F ne chhoda tha

CREATE script **edit nahi kiye** (Block D). Unhe edit karna us record ko mita
deta ki kya aage kheecha gaya aur kya nahi — aur wahi ek cheez hai jo
pull-forward ko chhe mahine baad review-able banati hai.

**`t_app_schools`** → `IsSuspended`, `SuspendedOn`, `SuspensionReason`

⚠️ Suspension **Is_Deleted bhi nahi aur Is_Active bhi nahi** hai. Is_Deleted
tombstone hai; Is_Active batati hai ki row aam kaam mein use hoti hai ya nahi;
IsSuspended ek **faisla** hai jo kisi ne liya, jiske saath wajah aur taareekh
judi hai — aur teeno mein sirf yahi hai jo school ko kabhi bataya jaata hai.
Is_Active mein ghol dene se wajah gum ho jaati, jo ekmatra hissa hai jispe
school kuch kar sakta hai.

**`t_app_school_branches`** → `BranchCode`, `Latitude`, `Longitude`,
`ContactPerson`

⚠️ **Spec ke `Phone` aur `Email` pehle se maujood hain**, `ContactMobile` aur
`ContactEmail` naam se — 2F ne unhe `t_app_schools` se match karaya tha jahan
wahi do baatein pehle se in naamon se thi. **Kuch gaya nahi**, naam alag hai,
aur ye wala deviation consistent hai: school se uski branch pe jaate hue reader
ko ek hi convention dikhti hai, do nahi.

`Latitude`/`Longitude` `decimal(9,6)` hain — float nahi (do same coordinate
unequal compare karte) aur `geography` nahi (spatial index ka koi query abhi
hai hi nahi; Phase 4 ka "paas ki jobs" in do column par bounding box hai).

#### 🔴 `date` kaun se hue — poori list

Sirf **teen**, aur teeno calendar din hain, instant nahi (2.28):

```
t_app_teachers.DOB
t_app_teacher_experiences.FromDate
t_app_teacher_experiences.ToDate
```

`VerifiedOn`, `SuspendedOn` aur baaki sab **datetime2 UTC** hain. Kasauti "isme
time hai ya nahi" nahi hai — **"ye ek din hai, ya ek pal"** hai.

Verify kiya: `DOB` mein `1990-11-02T23:45:00` daala, wapas `1990-11-02` mila.

#### Business keys — kya joda aur kyun

| Table | Key | Kyun |
|---|---|---|
| `t_app_teachers` | `TeacherUid` **unfiltered** | Uid dobara kabhi use nahi hota, warna purana URL kisi aur teacher pe khulta |
| `t_app_teachers` | `UserUid` filtered | 🔴 **ek account, ek profile** — 3B ka backfill isi se dobara chalane layak hai |
| `t_app_school_users` | `(SchoolId, UserUid)` | Dobara invite karne se doosri membership banti, aur phir role wahi hota jo query pehle padh le |
| `t_app_school_user_branches` | `(SchoolUserId, BranchId)` | Duplicate se branch list dugni hoti — ek hi campus dropdown mein do baar |
| `t_app_teacher_subjects` | `(TeacherId, SubjectId)` | Paanchon bridge par wahi niyam |
| `t_app_teacher_class_levels` | `(TeacherId, ClassLevelId)` | ” |
| `t_app_teacher_skills` | `(TeacherId, SkillId)` | ” |
| `t_app_teacher_languages` | `(TeacherId, LanguageId)` | ” |
| `t_app_teacher_preferred_locations` | `(TeacherId, CityId, StateId)` | Teen column — "jagah" yahan state YA uske andar ki city hai |
| `t_app_school_facilities` | `(SchoolId, BranchId, FacilityId)` | Teen column — scope (school, branch) hai, akela school nahi |
| `t_app_school_photos` | `FilePath` filtered | Neeche dekho — aapse thoda alag raay |
| `t_app_teacher_documents` | `FilePath` filtered | Neeche dekho |
| `t_app_teacher_experiences` | **koi nahi** | Neeche dekho |

⚠️ **Teen-column wale index NULL par tikte hain.** SQL Server unique index ke
andar NULL ko **barabar** maanta hai — to `(TeacherId, NULL, Maharashtra)` sirf
ek baar aa sakta hai, matlab "Maharashtra mein kahin bhi" do baar record nahi
hoga; par usi state ke andar Pune aur Nagpur alag row rehte hain. Wahi
`(SchoolId, NULL, FacilityId)` ke liye — school-level claim bhi duplicate se
bacha hua hai. Ye maana nahi, **test kiya**.

#### Jahan aapse raay alag hai — teen jagah

**1. `t_app_school_photos` — aapne kaha "kuch obvious nahi". Sehmat, par
`FilePath` par ek key daali.**

Business key sach mein koi nahi: ek hi building ki do photo do jaayaz row hain.
Par **file** alag baat hai. Storage naam generated GUID hai (2.48), to ek path
par do row school ke milti-julti tasveerein daalne se nahi ban sakti — sirf ek
hi upload do baar record hone se, yaani double-click wala case. Aur ye duplicate
row se zyada bhaari hai: do mein se ek photo delete karne par wo file bhi jaayegi
jispe doosri abhi tak point kar rahi hai.

**2. `t_app_teacher_documents` — `(TeacherId, DocumentTypeId)` par unique
JAAN-BOOJH KAR nahi daali.**

Ye sabse obvious key thi aur aaj galat hai. Ek teacher ke paas ek hi type ke do
jaayaz document ho sakte hain — do degree certificate, do school ke experience
letter. Pair ko constrain karne ka matlab ek ko soft-delete karke doosre ke liye
jagah banana, jo **data loss ko data rule ke kapde pehna dena** hai.

Jin type par sach mein ek hi sahi hai — ID proof — wo rule **procedure mein**
jaayega, jahan "ek current ID proof" ka matlab "purane ko supersede karna" bhi
ho sakta hai, jo index keh hi nahi sakta.

⚠️ Agar 3D ko history ke saath replace chahiye, jawab ek `Version` column hai
aur wahi unique index jo `t_mdm_request_documents` use karta hai — is shape par
unique index nahi.

**3. `t_app_teacher_experiences` — koi unique index nahi.**

Lubhaavni key `(TeacherId, SchoolName, FromDate)` thi. Galat hai: koi banda ek
hi school mein ek hi mahine se do role rakh sakta hai — part-time subject
teacher jo sports programme bhi chalata ho — aur unique index use bolta ki uski
apni history invalid hai. **Test kiya: wo case allow hota hai.**

Rozgaar ki avadhi ka koi natural business key hota hi nahi. Double-submit se
bachaav wahan hai jahan niyat dikhti hai — procedure mein.

#### Do CHECK jo ek doosre ka aadha kaam karti hain

`t_app_teacher_experiences` par:

```
(IsCurrent = 1 AND ToDate IS NULL) OR (IsCurrent = 0 AND ToDate IS NOT NULL)
```

Dono aadhe zaroori hain, alag-alag galti pakadte hain: pehla "abhi bhi yahan
hoon, 2019 mein chhod diya" rokta hai; doosra ek khatam ho chuki naukri ko
bina end date ke chalti hui ginne se rokta hai — jo kisi bhi tenure ke jod ko
chup-chaap galat kar deta.

#### `ProfileCompletionPercent` — plain column, computed nahi

"Complete" ek product faisla hai jo badlega: aaj photo + subjects + ek
experience, agle quarter resume bhi. Persisted computed column us behes ko
**schema mein** rakh deta, jahan badalna ek migration hai aur jahan rule us code
se invisible hai jo use dikhata hai. 3D ise compute karke likhega. Range
`0..100` par CHECK hai.

#### `RoleInSchool` role table NAHI hai

Roles aur permissions `jp_sso` mein hain — wahi tay karta hai koi kya **kar**
sakta hai. `RoleInSchool` alag sawaal ka jawab hai: wo **is school ke liye kaun**
hai. Do log dono jp_sso mein HR permission rakh sakte hain jabki ek is school ka
owner ho aur doosra ek campus ka viewer.

⚠️ Agar kabhi koi check `RoleInSchool` padh kar tay kare ki action allowed hai
ya nahi, wo check **galat jagah** hai.

#### `t_app_school_user_branches` — zero row ka matlab "sab branch"

Owner ko har campus ke against likha nahi jaata — uski koi row hoti hi nahi aur
use sab dikhta hai. Rows kisi ko **saankda** karne ke liye hain.

⚠️ Ulta karne ka matlab hota: har naye campus par har owner ke liye backfill,
aur jis din ek chhoot gaya us din ek owner chup-chaap ek campus kho deta.

#### Verify

`run_all.sql` mein saare 14 script registered. Pehli run mein sab bana, **doosri
run mein zero naya object**. Kisi script ko fix nahi karna pada.

Uske upar ek throwaway guard-test (rollback ke andar) — **17/17 pass**: dono
duplicate-profile aur duplicate-bridge refuse hue, soft-delete ke baad re-add
allow hua, NULL-equality wala dava dono teen-column index par sach nikla, chaaron
CHECK ne apni galti pakdi, aur do-role-ek-school wala jaayaz case allow hua.

#### Files

```
database/jp_app/01_tables/005_alter_t_app_schools_suspension.sql
database/jp_app/01_tables/006_alter_t_app_school_branches_deferred.sql
database/jp_app/01_tables/007_t_app_school_photos.sql
database/jp_app/01_tables/008_t_app_school_facilities.sql
database/jp_app/01_tables/009_t_app_school_users.sql
database/jp_app/01_tables/010_t_app_school_user_branches.sql
database/jp_app/01_tables/011_t_app_teachers.sql
database/jp_app/01_tables/012_t_app_teacher_subjects.sql
database/jp_app/01_tables/013_t_app_teacher_class_levels.sql
database/jp_app/01_tables/014_t_app_teacher_skills.sql
database/jp_app/01_tables/015_t_app_teacher_languages.sql
database/jp_app/01_tables/016_t_app_teacher_preferred_locations.sql
database/jp_app/01_tables/017_t_app_teacher_documents.sql
database/jp_app/01_tables/018_t_app_teacher_experiences.sql
database/run_all.sql
```

⚠️ **Table ban gayi, bhari nahi.** Backfill 3B hai — aur wo teen kaam hai, ek
nahi (G12).

---

### 2.52 BACKFILL AND SEEDED DATA — PHASE 3B

Backfill chala, teacher profiles bhare. **Teeno verification check zero** —
`90_ops/001_verify_account_completeness.sql`.

#### Jo kami thi aur jo bana

| Kya | Missing | Banaya | Pehle se |
|---|---|---|---|
| Teacher profile | 11 | 11 | 0 |
| Teacher subscription | 11 | 11 | 0 |
| Head-office branch | **2** | 2 | 1 |
| School subscription (per org) | 2 | 2 | 1 |

⚠️ **"Pehle check karo, shayad koi na ho" — the ho.** Do school aise mile jinke
paas head office nahi tha: `Greenwood — Dwarka Campus` aur `Nalanda Vidyalaya`,
dono 2F se pehle approve hue the. Migration ki zaroorat sach mein thi.

Do organisation ko plan chahiye tha: Greenwood (jiske neeche **do** school hain
— ek organisation, ek plan, 2.50) aur St Mary's.

⚠️ **St Mary's ek anomaly hai:** Active school account, `OrganizationUid`
maujood, par **koi school row nahi** — Phase 1 mein seed hua tha, approval engine
se pehle. Use plan mil gaya (har account ka ek plan hota hai) par uski school
kabhi nahi banegi, kyunki peeche koi approval request hai hi nahi. **G19 dekho.**

#### 🔴 Backfill ne khud do bug paida kiye — dono ginti se pakde

**1. Table variable ka IDENTITY `DELETE` par reset nahi hota.**

Section 2 ne `@Teachers` ko `DELETE` karke dobara bhar diya. IDENTITY 12 se
chalta raha, to `WHERE rn = @i` (1..11) kisi row se match nahi hua, `@UserUid`
mein section 1 ki **aakhri** value padi rahi, aur wahi ek teacher gyaarah baar
insert hua — ek safal, das 2601.

Pakda kyun gaya: ginti **namumkin** thi. "das teacher ke paas pehle se
subscription tha" us table mein jisme ek row thi. Isi liye report mein created
aur already-present dono chapte hain — ek akela "done" ye chhupa leta.

Fix: har section ka apna table variable. Reuse kabhi itna faayda nahi deta.

**2. Pending organisation ko plan dena uski AAGE KI provisioning tod deta.**

`USP_ProvisionSchoolFromApproval` school, head office aur subscription **ek hi
transaction** mein banata hai, aur uska CATCH 2601 ko "already provisioned"
padhta hai. Pending org ko abhi plan de dete, to approval ke waqt subscription
ka insert takraata, **poora transaction rollback** hota — school samet — aur
procedure null id ke saath success bolta.

Ek school jo approve hua aur bana hi nahi, aur report mein sab theek. **Wahi
failure jise rokne ke liye 2.48 hai**, ek nayi disha se.

Ab sirf **Active** organisation backfill hoti hain. Pending ko uska plan approval
ke waqt milta hai — wahi design hai. Pehli (buggy) run mein bane 7 galat
subscription hata diye gaye.

#### Idempotency ki shakl

2601/2627 = "ho chuka", error nahi — wahi shakl jo `USP_ProvisionSchoolFromApproval`
use karta hai (2.48). `WHERE NOT EXISTS` **jaan-boojh kar nahi**: wo check-then-act
hai, wahi race jo is project mein do baar theek ho chuki hai, aur single-threaded
run par har test pass karte hue bhi galat rehti.

Doosri run: **0 created, har category mein.**

#### ⚠️ Ye script jp_sso padhti hai aur jp_app likhti hai

2.2 application ko rokta hai — matlab chalte hue system ka coupling. Ye
application code nahi hai: ek baar chalne wali migration, jise operator sqlcmd se
chalata hai. Gyaarah row backfill karne ke liye API endpoint likhna zyada
machinery hai, aur wo product mein ek permanent "sabki profile dobara likh do"
surface chhod jaata.

🔴 Ise application kabhi call na kare. Agar kisi procedure ko ye shakl chahiye,
wo API layer se jaayegi.

#### Verification query — Phase 8 ka beej

`database/jp_app/90_ops/001_verify_account_completeness.sql`. Teen check, teeno
**zero honi chahiye**:

```
A. Active teacher jiski profile nahi          0  PASS
B. School jiska head office nahi              0  PASS
C. Active account jiska subscription nahi     0  PASS
```

⚠️ Check C mein owner **type ke hisaab se badalta hai**: teacher apna khud ka
owner hai, school ka owner uski **organisation** hai (2.50). Per-user check karte
to ek school ke doosre bande ko hamesha "missing" batata.

`USP_FindOrphanedApprovals` poochta hai "approval poora hua kya"; ye poochta hai
"har account saabut hai kya". Phase 8 dono schedule kare.

#### 🔴 SAARA TEACHER DATA SEEDED HAI — koi asli nahi

Gyaarah profile, **har field invented**. Koi insaan ne kuch nahi bhara.

⚠️ Aapne poochha tha ki koi asli account to nahi — **koi nahi**. `tarun@yopmail.com`
aapka apna test account hai aur aapne kaha ise bhi poora seed karo; baaki das
maine banaye (ek 2D verification mein, nau 3B mein). **Kisi asli insaan ka
account chhua nahi gaya, kyunki koi hai hi nahi.**

**G20 dekho** — ye alag gap hai aur G12 ke band hone ke andar chhupna nahi
chahiye.

#### Completeness — jaan-boojh kar bikhri hui

| % | Kaun | Kya nahi hai |
|---|---|---|
| 100 | Meera Iyer | — |
| 95 | Tarun Bhardwaj | — |
| 75 | Harpreet Kaur Gill | — |
| 70 | Arjun Rao | photo |
| 65 | Rohit Kulkarni | photo; **koi current job nahi** (band experience row) |
| 60 | Fatima Sheikh | resume, about |
| 55 | Sneha Banerjee | resume, photo |
| 45 | Vikram Singh Chauhan | resume, photo, about |
| 35 | Anita Deshmukh | **koi subject nahi**, skills nahi, salary nahi |
| 20 | Lakshmi Nair | sirf naam, state aur do subject |
| 10 | Imran Qureshi | sirf naam aur state |

🔴 Ye shakl jaan-boojh kar hai. Phase 5 ko in sabko render karna hai, aur wo
tabhi karega jab ye **banate waqt maujood** hon. Ek perfect dataset aisi screen
paida karta hai jo asli data se takrate hi tootti hai.

Khaas kar teen case jo pakka tootenge agar dhyaan na diya:
- **Rohit** — koi current job nahi, sirf ek band row. "Currently at ___" khaali.
- **Anita** — profile hai par subject **ek bhi nahi**. Subject se search karne par
  isse **nahi** aana chahiye, aur profile screen phir bhi khulni chahiye.
- **Imran** — naam aur state ke alawa kuch nahi. Har card, har filter, har sort.

#### Coherence — aur ek dava jo galat nikla

Subject, qualification aur designation aapas mein mel khate hain: PGT ke paas
master's, PRT ke paas B.Ed, M.Sc Physics wali Physics padhati hai, PRT primary
level par hai.

⚠️ **`TotalExperienceMonths` haath se likha tha aur rows se match nahi kar raha
tha** — 1 se 13 mahine ka farak. Ab wo **rows se derive hota hai**
(`DATEDIFF` ka jod, khuli row aaj tak). Sab gyaarah ab match karte hain.

Jo total apne hi evidence se ulta ho, wo aisi cheez hai jo search filter mein
dikhti hai aur koi samjha nahi paata.

#### Do purani seed galtiyaan bhi theek ki

- **Brightfield Academy** — pata Gurugram, `StateId` 9 (Himachal). Ab 8 (Haryana).
- **Greenwood — Dwarka Campus** — Dwarka Delhi mein hai, `StateId` Gujarat tha.
  Ab 32 (Delhi). Registration rows 2E mein theek hui thi par **provisioned school
  row nahi**, aur 3B ke backfill ne wahi galat state head office mein copy kar di.

⚠️ Teeno baar wahi galti: state id **dekhe bina** likh diya. Seed data mein
master id kabhi guess mat karo.

#### `m_mdm_language` khaali thi

2B ne 18 master seed kiye, ye unme nahi tha — 3B mein pata chala jab teacher
languages ko point karne ko kuch nahi mila. 26 bhasha seed ki
(`03_seed/009_seed_languages.sql`).

**Provisional mark NAHI** — 2.47 wo tab lagata hai jab humne list gaddi ho jispe
client ki raay hogi. Indian school jin bhashaon mein padhate hain wo tathya hain;
client ek jod sakta hai, ye nahi kahega ki Marathi is list mein nahi hoti.

#### Files

```
database/jp_mdm/03_seed/009_seed_languages.sql               (naya)
database/jp_app/03_seed/001_backfill_phase3b.sql             (naya)
database/jp_app/90_ops/001_verify_account_completeness.sql   (naya — rakhna hai)
database/run_all.sql
```

⚠️ Profile ka data script mein nahi hai — wo ek baar chalaya gaya seed hai. Kaun
se account seeded hain, **G20** mein list hai.

---

### 2.53 SCHOOL AND BRANCH PROCEDURES — PHASE 3C

10 procedure + 2 function + 2 provisioning procedure. Suite **41/41**, jisme
**negative case 15/15**. Build **0 warning 0 error**. 2C suite abhi bhi 30/30.

#### 🔴 G21 band — signup ab profile banata hai

`AuthService.RegisterTeacherAsync` account banne ke **turant baad**
`ITeacherProvisioningService` chalati hai: profile + `TEACHER_FREE`, ek
transaction mein.

Asli signup se verify kiya: check A pehle **0**, ek teacher register karne ke
baad bhi **0**, aur log mein
`Teacher 614b6efa… provisioned: profile 61, plan TEACHER_FREE`.

⚠️ **Ye cross-DB write hai aur 2.48 wali shakl leti hai** — ordering (account
pehle, profile baad mein, taaki failure **pahunch mein** rahe), idempotency
(`UserUid` par filtered unique, 2601 = ho chuka), loud failure.

🔴 **Failure signup ko fail NAHI karti.** Account doosre database mein commit ho
chuka hai. Throw karne ka matlab hota "registration failed" ek aise account ke
liye jo maujood hai — aur unka retry duplicate-email par girta, unke paas ek
aisa account reh jaata jiske baare mein unhe bataya gaya ki wo hai hi nahi.
Missing profile recoverable aur detectable hai; ek banda jo na register kar sake
na retry, dono nahi.

⚠️ `JP.Sso.Api` ko ab `App` aur `Mdm` connection string mili hain. Yahi niyam 2D
ne banaya tha jab `JP.App.Api` ko `Sso` mili: **jo API cross-database
orchestrate karti hai use har us database ka connection chahiye**. Vikalp tha
signup ke raste par `JP.App.Api` ko HTTP call — jo us service ke slow ya restart
hone par signup hi tod deta, yaani jis samasya ko theek kar rahe hain usse badi.

#### 🔴 `t_app_school_users` KHAALI thi — koi feature nahi, neenv

3A ne table banayi, 2D/2F ki provisioning ne usme **kabhi kuch likha hi nahi**.
Zero row.

Aur scope resolver wahi table padhta hai. Matlab har school-scoped query **har
user ke liye khaali** aati — branch list, aur Phase 4 se job aur applicant list
bhi. Wo "query toot gayi" jaisa dikhta, "row missing hai" jaisa nahi, aur galat
file mein dhoonda jaata.

Ab provisioning **chautha insert** karti hai (owner, `RoleInSchool = 1`) usi
guard aur usi transaction ke andar. Chaaron maujooda school ke liye backfill
chala.

#### 🔴 Scope resolver — inline table-valued function

```
RoleInSchool = 1 (Owner)  ->  school ki saari branch. Link row ki zaroorat NAHI.
warna                     ->  sirf t_app_school_user_branches mein jo hain.
```

**Kyun inline TVF, procedure nahi:**

1. **Join ho sakta hai.** `INNER JOIN dbo.fn_VisibleBranches(...)` list proc
   likhne wale ke liye sabse aasan raasta hai. Procedure join nahi hota — har
   caller ko `INSERT..EXEC` karke temp table banana padta, jo itni ragad hai ki
   koi na koi haath se do-line `EXISTS` likh deta. **Wahi haath se likhi copy wo
   jagah hai jahan bug rehta hai.**
2. **Inline hai, multi-statement nahi.** Optimiser ise calling query mein khol
   kar cost karta hai; multi-statement TVF uske liye black box hota hai aur bade
   jobs table par uska andaaza aam taur par galat hota hai.
3. **Fail closed.** Anjaan user, soft-deleted membership, doosre school ka user —
   teeno **zero row** dete hain, sab nahi.

⚠️ **Aage koi list proc apna version likhne se kaise ruke — seedhi baat: SQL
Server mein kuch nahi rokta.** Jo hai wo ye:
- ye function `t_app_school_user_branches` ka **ekmatra** reader hai, to us table
  ka doosra reader search mein turant dikh jaata hai;
- suite negative case assert karti hai, aur har naye school-scoped proc se
  ummeed hai ki wo apna negative case uske bagal mein jode.

Ye **test ke saath ek convention** hai, enforcement nahi. Saaf bola ja raha hai
taaki koi ise usse mazboot na samjhe jitni ye hai.

⚠️ Alag se `fn_IsSchoolMember` — "ye tumhara school hai kya", "kaun se campus"
nahi. Jis school ki koi branch hi na ho, uske owner ko apni profile se rokna
galat hota agar dono ek hi function mein hote.

#### Negative case — asli test

15 assertion, sab **ZERO** maangti hain, "kam" nahi:

| Kaun | Kya maanga | Mila |
|---|---|---|
| Branch HR | bina assign wala campus | **0** |
| Branch HR | doosra bina assign wala campus | **0** |
| School A ka HR | school B | **0** |
| School B ka **owner** | school A | **0** |
| Bina membership wala user | school A | **0** |
| Soft-deleted link | apna campus | **0** |
| Deactivated membership | apna campus | **0** |
| `USP_GetBranchList` | ajnabi | **0** |
| Branch HR | bina assign wale campus ko **edit** | `NOT_FOUND` |
| Branch HR | bina assign wale campus ko **delete** | `NOT_FOUND` |
| Ajnabi | school profile update | `NOT_FOUND` |

Sirf resolver sahi hona kaafi nahi — isliye list proc, save proc aur delete proc
teeno par alag se assert kiya, kyunki asli sawaal ye hai ki **procedure use
karte bhi hain ya nahi.**

#### 🔴 Bridge-sync pattern — ek baar tay, 3D wahi follow karega

Caller **poora set** bhejta hai; procedure current se diff karta hai, naya
INSERT karta hai, gaya hua **soft-delete** karta hai.

**Delete-all-then-reinsert kyun nahi:**

1. **Identity churn.** Har save par har row ko naya Id — aur jo bhi kabhi bridge
   row ko point karega (moderation note, audit entry, future FK) wo **chup-chaap**
   tootega, us save par jisme kuch badla hi nahi tha.
2. **No-op save poora rewrite ban jaata.** Form khol kar bina kuch chhue Save
   dabane se gyaarah row delete aur gyaarah insert. Sabka naya `CreatedOn`, to
   "ye school ne library kab jodi" ka jawab "jab aakhri baar Save daba" ho jaata.
3. **Soft-delete niyam.** Is database mein kuch bhi DELETE nahi karta. Rebuild ke
   liye hard-delete karne wala pattern us ek niyam ka apwaad maangta hai jiska
   koi apwaad nahi hai.

Diff se ulta kaam bhi muft milta hai: hataya hua dobara jodne par **tombstone
wapas ho jaata hai**, nayi row nahi banti — jo filtered unique index expect hi
karta hai.

Verify kiya: 3 add = 3 insert · **no-op save = 0/0/0** · ek hataana = 1
soft-delete · dobara jodna = **restored 1, added 0** · aur poore chakkar ke baad
**row ke Id wahi ke wahi**.

⚠️ Photos ise **nahi** follow karte, jaan-boojh kar: photo ke saath **file** hoti
hai. Bridge row soft-delete karne ka kuch kharcha nahi; photo hatane par disk par
orphan file bachti hai, aur baad mein dobara jodna ek **naya upload** hai, revive
nahi. Isliye teen explicit action — ADD / REORDER / DELETE.

#### Public profile — alag procedure, flag nahi

`USP_GetSchoolPublicProfile` apni procedure hai, `@IsPublic` flag wali ek nahi.

Ek procedure + flag ek bhoole hue column ki doori par hai, aur bhoolna **baad
mein** hota hai — jab koi own-view ke SELECT mein column jodta hai aur flag ke
baare mein sochta hi nahi, kyunki flag chalis line upar hai. Do procedure is
tarah drift nahi kar sakti: yahan column jodna use **publish karne ka jaan-boojh
kar kiya kaam** hai.

Nahi lautta: `PanNumber`, `OrganizationUid`, `SuspensionReason`, `RowVersion`,
internal contacts. Aur `IsSuspended` **chhupaya nahi — enforce kiya**: suspended
school kuch bhi nahi lautati, ek flag nahi jise caller honour kare.

⚠️ Ye assertion procedure ke **metadata** ke against hai
(`sys.dm_exec_describe_first_result_set`), value ke against nahi. Column jo aaj
maujood par NULL hai, wo column hai jise koi agle mahine bhar dega.

⚠️ Suspended/unverified wali do assertion **mirrored** hain — procedure ke
predicate ko dohrati hain, uske output ko nahi, kyunki `INSERT..EXEC` **saare**
result set capture karta hai aur ye proc chaar deta hai (Msg 213 — aur yahi wajah
hai ki 2.30 tests mein `INSERT..EXEC` mana karta hai). **Ye is file ki sabse
kamzor do assertion hain**: filter delete kar dene par bhi pass hongi. Isse
chhupaya nahi ja raha; asli suraksha upar wala column-level check hai, aur Phase
4 ka HTTP test jo suspended school par 404 maangega.

#### `USP_DeleteBranch` — teen inkaar, teeno alag Code ke saath

1. **Head office nahi hat sakti.** Har school ke paas hamesha kam se kam ek
   branch honi chahiye — wahi invariant hai jis par Phase 4/5 khadi hai.
   `UQ_..._OneHeadOffice` "zyada se zyada ek" enforce karta hai; ye "kam se kam
   ek". Dono alag hain aur dono chahiye.
2. **Jobs / applications** — ⚠️ **abhi likh diya, jaan-boojh kar unreachable.**
   `t_app_jobs` aur `t_app_applications` Phase 4/5 hain. Niyam ye **nahi** hai ki
   "delete kar do aur FK ko bolne do" — FK tab bolega jab school ko bataya ja
   chuka hoga ki campus chala gaya, aur message ek constraint ka naam hoga.
   Exact block comment mein likha hai, replace karne ke liye taiyaar.
   🔴 Ise warning mein mat badalna: application kisi ke apply karne ka **record**
   hai, aur school ke reorganise karne se wo record khatam nahi hota.
3. **RowVersion conflict.**

Har inkaar ka apna Code aur apna message hai — ek hi "cannot delete" UI ko
andaaza lagane par majboor karta, aur kam se kam ek case mein wo galat hota.

Delete hone par uski **link rows bhi** soft-delete hoti hain: warna sirf us campus
par scoped banda ek gayab branch ki taraf ishara karta member reh jaata, aur
resolver branch ke through join karta hai — to use chup-chaap kuch nahi dikhta,
bina kisi ishare ke ki kyun.

#### 🔴 Asli flow chalane se do PRODUCTION bug nikle

G19 theek karte waqt St Mary's ko asli raste se guzara — draft, upload, submit,
approve. Orchestration ne **`school provisioned` log kiya aur school bani hi
nahi thi.**

**Bug 1 — CATCH bina dekhe `ALREADY_PROVISIONED` bol raha tha.**

Transaction ke andar ka **koi bhi** 2601 "school pehle se hai" padha jaata tha.
Par duplicate **subscription** se aaya tha, rollback ne school bhi le liya, aur
proc ne phir bhi `Status = 1` diya. Orchestration ne "school provisioned" log kar
diya.

**Ye theek wahi failure hai jise rokne ke liye 2.48 likha gaya tha** — us procedure
ke andar se jiske baare mein wo decision hai. Fix: CATCH `ALREADY_PROVISIONED`
tabhi bol sakta hai jab school **dikh rahi ho**; na dikhe to duplicate kahin aur
ka tha aur ye asli failure hai.

**Bug 2 — ek maujooda organisation ke neeche DOOSRI school provision ho hi nahi
sakti thi.**

Subscription organisation ki hoti hai (2.50) aur index ek allow karta hai. To
group ki doosri school par subscription insert 2601 deta aur poora transaction —
school samet — le doobta.

Ye edge case nahi hai: **registration form khud poochhta hai "ek campus ya kai"**,
aur Greenwood ke paas pehle se ek organisation mein do school hain. Ab
subscription tabhi banti hai jab org ke paas nahi hai, aur uske apne TRY/CATCH ke
saath, taaki race haarne wala apni school na khoye.

⚠️ Dono bug **sirf isliye mile ki asli registration asli raste se chalayi aur
phir row dhoondhi.** Suite pass ho rahi thi. Yahi 2.44 wali baat hai, naye
kapdon mein.

#### G19 — teesra rasta chuna

Brief ne do vikalp diye: account saaf karo, ya doc badal do. **Dono nuksaan
seemit karna hai.** Teesra ye tha ki gap hi khatam kar do — aur ab wo mumkin hai,
kyunki 2F ne draft/submit banaya aur 3C ne provisioning ko owner likhna sikhaya.

St Mary's ab asli raste se registered aur approved hai:
`REG-SCH-2026-00013`, apni school, apna head office, apna plan, apna owner row.
HOW_TO_RUN wahi account naam karta hai aur ab wo **sach mein** tenant isolation
dikhata hai, khaali shell mein sign in karne ke bajaye.

#### Files

```
database/jp_app/04_procedures/002_provisioning_accounts.sql   (naya)
database/jp_app/04_procedures/003_scope_resolver.sql          (naya)
database/jp_app/04_procedures/004_school_profile.sql          (naya)
database/jp_app/04_procedures/005_school_photos_facilities.sql (naya)
database/jp_app/04_procedures/006_branches.sql                (naya)
database/jp_app/04_procedures/001_provisioning.sql            (owner insert + 2 bug fix)
database/jp_app/03_seed/002_backfill_phase3c_owners.sql       (naya)
database/jp_app/99_tests/001_test_school_branch.sql           (naya — 41 assertion)
jp-backend/JP.Infrastructure/Services/TeacherProvisioningService.cs  (naya)
jp-backend/JP.Infrastructure/Repositories/AppProvisioningRepository.cs (naya)
jp-backend/JP.Infrastructure/Services/{AuthService,ApprovalOrchestrationService}.cs
jp-backend/JP.Infrastructure/Repositories/{UserRepository,IUserRepository,ProvisioningRepository}.cs
jp-backend/JP.Sso.Api/appsettings.json                        (App + Mdm connections)
```

⚠️ `002_backfill_phase3c_owners.sql` `run_all.sql` mein **comment out** hai:
ye `USP_ProvisionSchoolOwner` EXEC karti hai jo neeche 04_procedures mein banti
hai. Khaali database par yahan chalane se wo procedure hi nahi milti. Wajah file
ke saath likhi hai; rebuild ke baad haath se chalani hai.

---

### 2.54 TEACHER PROCEDURES — PHASE 3D

14 procedure + 3 function + 2 table type. Suite **44/44**, jisme
**A-cannot-touch-B 8/8**. Build 0/0.

#### 🔴 Scope: teacher apni profile ka maalik hai, aur sirf apni

`fn_TeacherIdForUser(@UserUid)` — ek hi jagah jahan UserUid TeacherId banta hai.

Har write **token se** teacher resolve karta hai. Kisi bhi write procedure mein
**`@TeacherId` parameter hai hi nahi** — "doosre ki profile edit karo" reject
nahi hota, wo **kaha hi nahi ja sakta**.

Ye suite `sys.parameters` ke against assert hota hai, koshish karke nahi:
parameter ka **na hona** hi property hai, kisi parameter ka vyavhaar nahi.
**12 procedure, 0 `@TeacherId`.**

Jahan child row id se address hoti hai (experience, document), id ko resolve hue
teacher ke against check kiya jaata hai — doosre ki id `NOT_FOUND` deti hai,
wahi jo na-maujood id deti hai.

⚠️ Scalar function, `fn_VisibleBranches` ki tarah TVF nahi: school ka jawab
branches ka **set** hai jise join karna padta hai, teacher ka jawab ek row ya
kuch nahi. TVF yahan `JOIN fn_TeacherIdForUser(...)` ko nyota deta wahan jahan
imaandaar baat `WHERE TeacherId = @me` hai.

#### 🔴 Contact ki line — teacher ke APPLY karne par khulti hai

School browse karte waqt sab kuch dekh sakta hai jisse tay ho ki is insaan ko
chahiye ya nahi — aur platform ke bahar sampark ka **koi rasta nahi**.

Contact **teacher ki sehmati par** khulta hai, aur sehmati ke do roop hain:
teacher ne **apply** kiya ho, ya us school ka invite **accept** kiya ho. School
ke paise dene par nahi, aur sirf invite **bhej** dene par nahi.

⚠️ **Ye 2.56 hai (LOCKED), aur isne is decision ka pehla version badla hai.**
Pehle yahan likha tha "sirf apply karne par" — jo monetization plan se takraata
tha: jo school paisa de aur phir bhi kisi tak pahunch na sake, usne kuch khareeda
hi nahi. Poori dalil aur Phase 5/6 ke liye exact replacement **2.56** mein hai.

Teen wajah, vazan ke kram mein:

1. **Sehmati.** Jisne apply kiya usne tay kiya ki wo school sampark kar sakta
   hai. Jo sirf search result mein aaya usne kuch tay nahi kiya, aur uska mobile
   number de dena uski taraf se liya gaya faisla hai.
2. **Yahi product hai.** Browse par contact de dene ka matlab poora product de
   dena — school number leta hai, teacher ko phone karta hai, aur uske baad jo
   hota hai usme hum hain hi nahi. Na application, na offer, na record, na wapas
   aane ki wajah.
3. **Isse teacher profile banane par pachhtaata nahi.** Jo naukri dhoondhne
   resume upload karta hai aur chalees school ke cold call jhelta hai, wo profile
   dobara update nahi karta — aur doosron ko bhi mana karta hai.

🔴 **RESUME BHI EK CONTACT DETAIL HAI.** Yahi hissa galat hona sabse aasan hai.
Resume ki pehli teen line mein phone aur email hota hai. Column chhupa kar file
de dena **natak** hai: school PDF download karta hai aur wahi padh leta hai jo
procedure ne abhi batane se mana kiya.

To `ResumePath` **sirf** contact procedure deta hai, phone number wale hi unlock
rule ke tehat. Browse procedure use deta hi nahi — column uske SELECT mein hai
hi nahi.

**Browse mein kya nahi jaata:** contact, resume, **DOB** (physics padha sakte ho
ya nahi, ye jaanne ke liye umr nahi chahiye — aur use publish karna age
discrimination ko ek filter ki doori par le aata hai), UserUid, RowVersion.

**Kya jaata hai, jaan-boojh kar:** naam (naam sampark nahi hai, aur gumnaam row
par school tay nahi kar sakta), expected salary (teacher ne use **filter ki tarah**
bhara hai — chhupane se dono ka waqt aise offers par jaata hai jo kabhi chalne
hi nahi the), current city/state (subject ke baad doosra filter; ye pata nahi
hai).

**Documents: haqeeqat, file nahi.** School dekh sakta hai ki degree certificate
maujood hai aur humne verify kiya — file, filename ya path nahi. Yahi kaam ka
aadha hissa hai ("kisi ne check kiya"), bina har search chalane wale school ko
kisi ki ID ka scan diye.

⚠️ `fn_TeacherContactUnlocked` **abhi hamesha 0** deta hai, aur ye placeholder
nahi — `t_app_applications` Phase 5 hai, to aaj kisi ne kisi ko apply kiya hi
nahi. Phase 5 ka exact replacement comment mein likha hai.

🔴 **Bheje hue invite tak mat badhana** — par **accept kiye hue** tak badhana
hi hai (2.56).

Bhejna school ka kadam hai: uspe unlock ka matlab hoga ki school sabko invite
karke sabka contact khol le, jo "koi rule nahi" ke barabar hai. **Accept karna
teacher ka kadam hai**, aur wo theek utni hi sehmati hai jitni ek application.

⚠️ Purana vaakya sirf "invite" kehta tha aur dono ko exclude karta hua padha
jaata tha. Farak **kaun** kar raha hai, ispe hai.

#### 🔴 Do procedure, flag nahi — 3C wali hi wajah, zyada dhaar ke saath

`@IncludeContact` wala ek procedure ek bhoole hue column ki doori par hai. 3C
mein jo leak hota wo company ka tax number tha; **yahan ek insaan ka mobile
number hai.**

To browse procedure ke paas wo column **hain hi nahi**, aur ek jodna use
**publish karne ka jaan-boojh kar kiya kaam** hai.

⚠️ Contact procedure iska **ulta** karta hai — column maujood hain aur locked
hone par NULL. Ye deliberate hai: wahan contact **maqsad hi nahi** tha, yahan
contact hi maqsad hai. Caller `Code` padh kar jaanta hai ki wo asli hain ya nahi.

#### Bridge sync — 3C ka pattern, do jagah alag

Teen plain set (subjects, class levels, skills) bilkul `USP_SaveSchoolFacilities`
ki tarah (2.53): poora set bhejo, diff karo, naya insert, gaya hua soft-delete,
**tombstone revive karo**.

**Languages — payload ke saath sync.** Ek chautha case hai jo plain pattern mein
hota hi nahi: row maujood hai, chahiye bhi hai, par **level badal gaya**. Wo
**UPDATE** hai. Delete-and-insert karne se us row ko naya Id aur naya CreatedOn
milta — sirf isliye ki kisi ne dropdown "conversational" se "fluent" kiya, jo is
table ka sabse aam edit hai.

Chaar counter: removed, restored, **updated**, added. Test assert karta hai ki
level badalne par `updated 1, added 0` aur **row ka Id wahi rehta hai**.

**Preferred locations — teen column, NULL-equality.** Target ka index
`(TeacherId, CityId, StateId)` hai aur wo NULL ko **barabar** maanta hai (3A).

⚠️ To har join ko explicit NULL-equality chahiye: `a.CityId = b.CityId` dono NULL
hone par UNKNOWN hai, matlab plain pattern "Maharashtra mein kahin bhi" ko
gaayab samajh kar soft-delete karta, phir dobara insert karta — **har save par
naya Id**, aur usi tombstone se takraav jo usne abhi banaya tha.

Input pehle **deduplicate** hota hai: ek hi jagah do baar bhejna client ka bug
hai, aur bina dedup ke index poori batch reject karta, duplicate ko nahi.

#### Experiences bridge NAHI hain

Har row ek cheez hai jise teacher likhta, badalta aur hataata hai. 3A ne
jaan-boojh kar koi unique index nahi diya — ek hi school mein ek hi mahine se do
role rakhna jaayaz hai (2.51). To diff karne ko kuch hai hi nahi: set sync ko tay
karna padta ki "wahi experience" kya hai, aur imaandaar jawab ye hai ki sirf
teacher jaanta hai — jiske liye Id hota hai.

**Test:** do role, ek school, ek hi mahina — **dono accept**.

#### 🔴 DATEDIFF(MONTH) ne har band naukri ek mahina chhoti dikhayi

`DATEDIFF(MONTH, '2020-06-01', '2022-05-31')` = **23**. Us teacher ne **24 mahine**
kaam kiya. DATEDIFF **boundary crossings** ginta hai, beeta hua waqt nahi — aur
31 tareekh June mein nahi ghusi.

To har band period ek mahina chhota tha, aur chhe naukri ka career **chhe mahine
chhota**. Wahi kism ki galti jo 3B ne haath se likhe totals mein pakdi (2.52):
ek number jo apne hi evidence se ulta hai.

Fix: `ToDate` ko **aakhri kaam ka din** maano, to period `[FromDate, ToDate + 1)`
ho jaata hai aur DATEDIFF sahi ginta hai. Khuli row aaj tak chalti hai —
chaalu mahina sach mein poora nahi hua, aur use upar karna wo mahina claim karna
hoga jo abhi kaam nahi kiya gaya.

⚠️ **Ye suite ne pakda**, do do-saal ke role ke liye 48 assert karke. Procedure
23+23=46 de raha tha aur andar se consistent tha — sirf duniya se galat.

#### 🔴 ProfileCompletionPercent — niyam aur uska waada

Server par compute hota hai, taaki teacher app, aage ki search ranking aur
applicant card teeno ek hi baat kahein.

```
25  resume            school sabse pehle yahi maangta hai
20  kam se kam ek subject   iske bina teacher search mein milta hi nahi
15  kam se kam ek experience row
10  photo
10  designation + qualification (5 + 5)
 8  about me, 40+ character
 7  kam se kam ek preferred location
 5  class levels
```

🔴 **Bina resume 75 se upar ja hi nahi sakta.** Yahi weighting ka maqsad hai. Jise
bina resume ke 100% dikha diya, use system ne bola ki wo taiyaar hai — theek us
waqt jab school use chhaant dega. 75 dikhana aur "kyun" poochhwana behtar hai.

⚠️ AboutMe **40 character** par gina jaata hai, "khaali nahi hai" par nahi. Ek
shabd wo field hai jo kisi ne number hilane ke liye bhara, aur use ginna theek
yahi sikhaata.

Subjects class levels se zyada isliye hain ki school pehle **subject** par search
karta hai; bina subject row wala teacher us search mein invisible hai chahe baaki
sab bhara ho.

**Gyaarah seeded profile par natija:**

| % | Kaun | Kya kami |
|---|---|---|
| 100 | Harpreet, Meera, Tarun | — |
| 90 | Arjun, Rohit | photo |
| 67 | Fatima | resume, about |
| 65 | Sneha | resume, photo |
| 57 | Vikram | resume, photo, about |
| 37 | Anita | **subject ek bhi nahi** — 100 mahine experience ke bawajood |
| 20 | Lakshmi | sirf do subject |
| 0 | Imran | naam aur state, aur kuch nahi |

⚠️ **Imran 10% se 0% par aa gaya**, aur maine niyam nahi badla. Naam kisi ko
hire nahi karwaata; "aapne shuru hi nahi kiya" imaandaar padhna hai. Iska ek
natija hai: wo G21 wale test signup se alag nahi dikhta, jiska naam khaali string
hai. Sweekaar kiya, chhupaya nahi.

⚠️ **Anita 100 mahine ke saath 37%** — kyunki bina subject wo dhoondhi hi nahi ja
sakti. Yahi niyam ka kaam karna hai.

#### Duplicate-key ka dava — 3C wali galti dobara nahi

`USP_SaveTeacherDocument` ka CATCH 2601 ko `ALREADY_UPLOADED` bolne se **pehle
row dhoondhta hai**. 3C ne `USP_ProvisionSchoolFromApproval` ko bina jaanche
`ALREADY_PROVISIONED` bolte pakda tha, ek aisi school ke liye jo rollback ho
chuki thi. Wahi shakl, wahi anushasan: **dekho, phir daava karo.**

#### Files

```
database/jp_app/04_procedures/007_teacher_profile.sql              (naya)
database/jp_app/04_procedures/008_teacher_bridges.sql              (naya)
database/jp_app/04_procedures/009_teacher_experiences_documents.sql (naya)
database/jp_app/04_procedures/010_teacher_public_profile.sql       (naya)
database/jp_app/99_tests/002_test_teacher.sql                      (naya — 44 assertion)
```

---

### 2.55 SAAT REPO GITHUB PAR — G0 BAND

Saaton repo `https://github.com/Tarun1515/<name>` par push ho gaye. Teen din ka
kaam ab ek machine par nahi hai.

#### 🔴 Push se pehle credentials nikaale

`HOW_TO_RUN.md` mein paanch seeded account ke plaintext password the, jisme ek
generated superadmin password bhi. Us file ki apni chetavani kehti thi: *"If this
file is ever shared outside the team, strip this section first."* **Push wahi
lamha hai**, aur repository ki history mein pada password us faisle se zyada
jeeta hai jo kehta hai ki wo wahan nahi hona chahiye.

Ab wo `local-accounts.md` mein hain, jo **gitignored** hai. Table mein email aur
"ye kya dikhata hai" reh gaya, to doc abhi bhi system samjhata hai — sirf raaz
chale gaye.

⚠️ Do aur bahar mile the, credentials table se alag jagah:
- `PROJECT_MEMORY.md` ki G20 mein seeded teacher ka password quote tha
- `scripts/verify/signin-check.mjs` mein ek hardcoded tha — ab
  `JP_SCHOOL_PASSWORD` environment se padhta hai aur na milne par
  `local-accounts.md` ki taraf ishara karke rukta hai

`local-accounts.md` khud likhta hai ki nayi machine par accounts **dobara kaise
banayein** — asli registration endpoints se, aur admin `JP.Tools.SeedAdmin
--generate` se — kyunki nayi machine par wo file hogi hi nahi, aur us waqt sahi
jawab dobara banana hai, kisi se chat par password maangna nahi.

#### Remote URLs — nayi machine yahan se shuru kar sakti hai

```
jp-backend   https://github.com/Tarun1515/jp-backend.git
jp-shared    https://github.com/Tarun1515/jp-shared.git
jp-admin     https://github.com/Tarun1515/jp-admin.git
jp-school    https://github.com/Tarun1515/jp-school.git
jp-teacher   https://github.com/Tarun1515/jp-teacher.git
jp-public    https://github.com/Tarun1515/jp-public.git
jp-docs      https://github.com/Tarun1515/jp-docs.git
```

⚠️ Saaton **sibling folder** hone chahiye — `jp-shared` ke tsconfig paths aur
SCSS `includePaths` bhagwan bharose nahi, `../jp-shared` par nirbhar hain (2.42).

---

### 2.56 CONTACT UNLOCK — TEACHER KI SEHMATI SE, PAISE SE NAHI 🔒 LOCKED

⚠️ **Ye 2.54 ke contact rule ko badal deta hai. Purana version wahan theek kar
diya gaya hai — do version chhode nahi gaye.**

#### Takraav jo pehle tha

2.54 ne likha tha: contact tab khulta hai jab teacher ne **apply** kiya ho.

Monetization plan bechta hai: "teacher database search + contact" ek paid
feature ki tarah.

**Dono sach nahi ho sakte.** Jo school paisa de aur phir bhi kisi tak pahunch na
sake, usne kuch khareeda hi nahi.

#### Faisla

`fn_TeacherContactUnlocked` **true** deta hai jab:

1. teacher ne **is school ko apply** kiya ho, **ya**
2. teacher ne **is school ka invite ACCEPT** kiya ho

aur **iske alawa kuch nahi**.

#### 🔴 Bheja hua invite ≠ accept kiya hua invite

2.54 ke comment mein likha tha *"do NOT widen this to invites"* — aur wo baat
**bheje hue** invite ke baare mein sahi thi: warna school Somvaar ko poore
database ko invite karta aur Mangalwaar tak har number uske paas hota, jo "koi
rule na hone" ke barabar hai.

Par jise teacher ne **accept** kiya, wo theek usi tarah sehmati hai jaise
application. Teacher se poochha gaya, usne **haan** kaha.

⚠️ Purana vaakya dono ko exclude karta hua padha jaata tha. Ab comment mein saaf
likha hai ki wo **kaun sa** wala hai.

#### 🔴 Bikta kya hai: school ki KSHAMTA, teacher ka contact kabhi nahi

**Bech sakte hain:**
- teacher database mein search karne ka haq hi
- kitne invite bhej sakte hain
- shayad featured placement

**Kabhi nahi bech sakte:** contact. Wo hamesha teacher ka faisla hai, aur koi
bhi raqam use nahi badalti — kyunki wo line hamari hai hi nahi, teacher ki hai.

⚠️ Agar aage koi requirement lage ki yahan payment chahiye, to **requirement
galat likhi gayi hai**: bik kya raha hai — *pahunch*, aur pahunch ka matlab
invite hai, number nahi.

#### Ye vyapaar ke liye bhi behtar hai, sirf naitikta nahi

Jo school paisa deta hai use **jawaab dene wale teacher** milte hain, cold-call
karne ki list nahi.

Browse ke waqt bechi gayi contact list ka matlab hai ki **pehla phone call
platform ke bahar hota hai** — aur uske baad jo kuch hota hai (application,
offer, hiring, record) usme hum hain hi nahi. Ek baar ki bikri, phir kuch nahi.

#### ⚠️ Spec mein "Accepted" status hai hi nahi — Phase 6 ko jodna hoga

`DB_TABLE_STRUCTURE` `t_app_teacher_invites` ko chaar status deta hai:
**Sent / Viewed / Applied / Ignored**. Inme se koi bhi path 2 ka matlab nahi
rakhta:

| Status | Kyun kaafi nahi |
|---|---|
| `Sent` | School ne kiya, teacher ne nahi |
| `Viewed` | Message kholna "haan" kehna nahi hai |
| `Applied` | Path 1 pehle se cover karta hai — application maujood hai. Isse map karne se **path 2 kuch karta hi nahi** |
| `Ignored` | Ye to inkaar hai |

🔴 To **Phase 6 ko `ACCEPTED` status jodna hoga**, warna path 2 chup-chaap path 1
mein simat jaata hai aur monetization plan phir se toota rehta hai — bina kisi ko
pata chale. Theek wahi shakl jise rokne ke liye ye file likhi gayi hai.

#### Phase 5 ke liye — replacement bilkul yahi ho

Stub abhi `RETURN 0` deta hai, jo **aaj sach hai**: na koi application hai na
koi invite.

Uska exact replacement `010_teacher_public_profile.sql` ke comment mein likha
hai. Do path, `UNION ALL`, aur:

- **"koi bhi invite" NAHI** — sirf accept kiya hua
- **"koi bhi payment" NAHI** — plan is function mein aata hi nahi

⚠️ Agar kabhi is function mein `t_app_subscriptions` ya `m_mdm_plans` ka naam
aaye, faisla toota ja chuka hai.

#### Kya pehle se laagu hai

`USP_GetTeacherContactForSchool` hi ekmatra rasta hai jo contact **aur resume**
deta hai (2.54 — resume bhi contact detail hai, uski pehli teen line mein phone
number hota hai). Browse procedure ke paas wo column hain hi nahi.

To ye faisla **ek hi function badalne se** laagu hota hai. Yahi do-procedure
design ka faayda hai: rule ek jagah hai, aur use badalne ke liye ek jagah.

---

### 2.57 PROFILE APIs — PHASE 3E

23 endpoint. Build **0 warning 0 error**. HTTP verification **20/20**, asli
chalte hue API ke against.

#### 🔴 Contact ka bachaav ab TEEN parat mein hai

3D ne do procedure banaye the (ek flag wale ki jagah). 3E ne wo alagav API tak
nibhaya, aur uske upar ek cheez jodi jo **comment se zyada mazboot** hai:

| Parat | Kya rokti hai |
|---|---|
| **Do procedure** (2.54) | `USP_GetTeacherPublicProfile` mein contact column hai hi nahi |
| **Do DTO** (3E) | `TeacherBrowseDto` mein `ContactEmail`/`ContactMobile`/`ResumePath`/`Dob` property **hai hi nahi** — null nahi, GAYAB |
| **`ContactLeakGuard`** (3E) | Startup par reflect karta hai aur **API chalne se mana kar deta hai** agar koi contact-jaisi property aa jaaye |

⚠️ Teesri parat isliye hai ki **comment build fail nahi karta**. Guard karta hai.

**Proof — DTO ko jaan-boojh kar toda:** `ContactMobile` joda, build pass hua,
aur API start hote hi:

```
Unhandled exception. System.InvalidOperationException: TeacherBrowseDto declares
ContactMobile, which a school browsing the teacher database must never receive.
Contact details and the resume are gated behind GET /api/teachers/{uid}/contact,
which unlocks only when the teacher applied to that school or accepted its
invite (PROJECT_MEMORY 2.56, LOCKED)...
```

Guard `Contact`, `Email`, `Mobile`, `Phone`, `Resume`, `Dob`, `DateOfBirth`,
`UserUid` — **prefix se** match karta hai, poore naam se nahi, taaki
`ContactPersonName` bhi pakda jaaye. Exhaustive hona maqsad nahi; **chupke se
nikalna mushkil** hona maqsad hai.

⚠️ Fatal rakha hai, warning nahi. Jis school ne ek baar teacher ka number padh
liya, use **un-padha nahi karaya ja sakta** — to failure loud, local aur turant
honi chahiye.

#### Browse endpoint asli mein kya deta hai

`GET /api/teachers/{uid}/browse` — 24 field, asli response body se:

```
teacherUid · fullName · photoPath · genderId · qualificationId
highestQualificationText · designationId · totalExperienceMonths
currentSchool · lastSchool · expectedSalaryMin · expectedSalaryMax
currentCityId · currentStateId · aboutMe · isVerified
profileCompletionPercent
subjectIds · classLevelIds · skillIds · languages · preferredLocations
experiences · documents
```

⚠️ `documents` mein sirf `documentTypeId` aur `isVerified` hai — **haqeeqat,
file nahi**. "Kisi ne check kiya" wahi kaam ka hissa hai; scan dena nahi.

Verification body ko **text ki tarah** padh kar naam dhoondhti hai, parse karke
nahi — kyunki serializer ya mapper wo field jod sakta hai jo type ne declare ki
hi nahi.

#### Contact endpoint — 403, wajah ke saath

```
403 · "You will see this teacher's contact details once they apply to one of
your jobs, or accept an invitation from you. Until then you can invite them
through the platform — they will see your message and can reply."
```

⚠️ Aaj **har school ke liye** 403 — kyunki applications Phase 5 hain aur invites
Phase 6, to kisi teacher ne abhi tak sehmati di hi nahi. **Ye sahi jawab hai,
adhoora nahi.**

Message rasta batata hai, sirf darwaza band hone ki khabar nahi deta. Jo refusal
sirf "nahi" kehta hai use log bug ya paywall padhte hain, aur ye dono nahi hai.

#### IDOR — 404, 403 nahi

**Branch:** doosre school ki branch maangne par `404 · That campus was not
found.` Verify kiya. `dbo.fn_VisibleBranches` kuch nahi deta, to procedure kuch
nahi deta, to service `NotFoundException` phenkti hai.

⚠️ 403 dena **tasdeeq** kar deta ki wo branch maujood hai — wahi disclosure
jise scoping rokne ke liye bani thi (2.48 wali dalil).

**Teacher:** koi bhi write endpoint `@TeacherId` nahi leta. Jahan route mein id
hai (experience, document), wo **child row** hai aur procedure use token se
resolve hue teacher ke against jaanchta hai.

Verify kiya: A ne B ki experience edit karne ki koshish ki → `404`, delete ki →
`404`, aur **B ki row jyon ki tyon**.

#### School kaun sa hai — token se, request se nahi

`JP.Domain.Schools` ke kisi bhi **request** type mein `SchoolId` ya
`OrganizationUid` nahi hai. Service `USP_GetSchoolsForUser` se poochhti hai.

Do case jaan-boojh kar alag handle kiye:
- **koi membership nahi** → 403, aur message us haalat ke liye likha hai
- **ek se zyada** → saaf inkaar, **pehli utha kar nahi** (G23)

⚠️ **HTTP verification ne yahan ek bug pakda:** teacher `/school/profile` par
403 to paa raha tha, par message tha *"aapka account abhi kisi school se juda
nahi — agar aapko abhi approve kiya gaya hai to sign out karke wapas aayein"* —
jo school user ke liye likha hai aur teacher ke liye bakwaas hai. Refusal sahi
tha, **wajah galat**. Ab type pehle check hota hai: *"This is a school area.
Your account is not a school account."*

Yahi wo cheez hai jo support par aati hai aur koi reproduce nahi kar paata.

#### Full-set sync — contract endpoint par likha hai

Paanch teacher endpoint aur school facilities **poora set** lete hain, delta
nahi. Har ek ke summary mein saaf likha hai, misaal ke saath:

> Sending `[2]` when the teacher already has `[1, 2, 10]` removes 1 and 10.

⚠️ Ye isliye likha hai ki jo client sirf naya subject bhejega aur baaki gayab
paayega **wo bug file karega — aur theek karega**, agar contract kabhi likha hi
na gaya ho.

HTTP se verify kiya: `PUT /teacher/subjects {ids:[1]}` ne `1,2` ko `1` kar diya;
poora set wapas bhejne par `1,2` bahaal.

#### Public school profile — ekmatra bina-auth endpoint

`GET /api/schools/{uid}/public`, `[AllowAnonymous]`. 18 field, **na PAN, na
organizationUid, na suspensionReason, na rowVersion**.

🔴 **3C ka adhoora test ab poora hua.** Wahan do assertion procedure ke predicate
ko **mirror** karti thi, uske output ko nahi — kyunki `INSERT..EXEC` chaar result
set capture nahi kar sakta. Wo SQL suite likh hi nahi sakti thi.

Ab HTTP se:
- suspended school → **404**
- unverified (pending) school → **404**

Dono asli request se, asli data ko toggle karke. **Yahi wo test hai jo 3C ne
maanga tha aur de nahi paaya.**

#### Upload — dobara nahi likha

Logo, photo, resume aur documents chaaron 2D wale `UploadValidator` se guzarte
hain: extension, **magic bytes**, size, generated GUID naam, path-traversal.

⚠️ Logo/photo/resume ki `m_mdm_document_types` mein row nahi hai — wo master
approval-request documents ke liye hai. To unki **limits** service mein constant
hain, par **jaanch wahi** hai. Teacher documents apni limits us row se lete hain
(2.47).

🔴 Doosra upload path nahi banaya. Do path ka matlab hai ek din unme se ek check
chhod dega — aur wahi chhodega jise likhna kisi ko yaad nahi.

Virus-scan hook dono jagah usi jagah marked hai: **validation ke baad, storage se
pehle** (G13).

#### Verification — 20/20, asli HTTP

```
1. school profile        token se resolve, PAN/suspension own-view mein
2. public profile        bina auth 200 · suspended 404 · unverified 404
3. browse body           contact ka koi naam nahi · 24 field chhape
4. contact               403 + wajah wala message
5. branch scope          doosre school ki branch 404, 403 nahi
6. A vs B                edit 404 · delete 404 · B ki row salamat
                         teacher browse par 403 · teacher school area par 403
7. full-set sync         [1] ne baaki hata diye · poora set wapas
```

Script rakhi hai: `jp-docs/scripts/verify/browse-contract.mjs`.

#### Files

```
jp-backend/JP.Domain/Schools/SchoolContracts.cs                 (naya)
jp-backend/JP.Domain/Teachers/TeacherContracts.cs               (naya)
jp-backend/JP.Infrastructure/Repositories/{School,Branch,Teacher}Repository.cs  (naye)
jp-backend/JP.Infrastructure/Services/{SchoolProfile,Branch,TeacherProfile,TeacherDirectory}Service.cs (naye)
jp-backend/JP.App.Api/Controllers/{School,Branches,Teacher}Controller.cs (naye)
jp-backend/JP.App.Api/Startup/ContactLeakGuard.cs               (naya)
database/jp_app/04_procedures/003_scope_resolver.sql            (USP_GetSchoolsForUser)
jp-docs/scripts/verify/browse-contract.mjs                      (naya)
```

---

### 2.58 SCHOOL TEAM MANAGEMENT — PHASE 3G

Chaar procedure, paanch endpoint, ek screen, aur **G15 band**. SQL suite
**52/52** (27 negative), HTTP verification **48/48**, teeno build 0/0.

#### 🔴 Chaar niyam — UI mein nahi, procedure mein

| Niyam | Kahan | Kyun UI mein nahi |
|---|---|---|
| Owner na demote ho na deactivate — **khud se bhi nahi** | `USP_SaveSchoolUserRole`, `USP_DeactivateSchoolUser` | Bina owner wala school koi chala hi nahi sakta, aur wapas laane ka rasta sirf database edit hai |
| Koi owner **banaya bhi na jaa sake** | dono save procedures + invite | Niyam 1 ke chalte doosra owner **permanent** hai — do log jo kabhi hataye nahi ja sakte |
| Owner ke **link rows hote hi nahi** | `USP_SaveSchoolUserBranches` inkaar karta hai | `fn_VisibleBranches` unhe padhta hi nahi (2.51); jo rows padhi na jaayein wo ek din function se **jhagda** karengi |
| Deactivate = `Is_Active = 0`, **kabhi** `Is_Deleted` | `USP_DeactivateSchoolUser` | "Kisne kaunsa document verify kiya" unke jaane ke baad bhi sach rehna chahiye |

UI bhi yehi chaar dikhata hai — par unka **ghar** procedure hai. API UI ke bina
bhi khuli hai, aur kal koi doosri screen ya script likhega to niyam uske saath
nahi jaate.

⚠️ **Permission yahan check nahi hoti.** `USER.MANAGE` jp_sso mein hai aur
controller dekhta hai. Procedure sirf wo do cheezein dekhta hai jo **sirf
database jaan sakta hai**: caller is school ka hai kya, aur target bhi.

#### 🔴 Full-set sync ka wo case jo chup-chaap access chheen leta

Ye is phase ki sabse mehngi cheez thi, aur **likhne se pehle pakdi gayi**.

Bridge sync poora set leta hai aur jo gayab ho use hata deta hai (2.53). Ab isse
jodiye ek screen se jo caller ko sirf **uske apne campus** dikha sakti hai:

> North campus ka HR apne senior colleague ka scope kholta hai. Screen ek hi
> campus dikhati hai — jo use dikh sakta hai. Wo kuch untick nahi karta, save
> karta hai — aur plain pattern us colleague ke **do southern campus** chup-chaap
> le leta, jo screen par kabhi thay hi nahi.

Save **successful** dikhta. Colleague ko pata tab chalta jab campus gayab hota.

**Fix:** GONE step `fn_VisibleBranches` se **join** karta hai. Jo campus caller
ko nahi dikhta, uska link **chhua hi nahi jaata**. Owner ko sab dikhta hai, to
owner ke liye ye bilkul saadharan full-set sync hai.

Iska nateeja saaf likha hai: non-owner ka save kisi ke access ka **apna hissa**
sync karta hai, poora nahi. Isliye screen `branchCount` (asli ginti) aur
`branchIds` (jo dikh raha hai) **dono** deti hai, aur likhti hai
*"+2 campus jo aapko nahi dikhte"* — kam karke dikhana ek jhooth hai jo screen
seedha munh karke bolti.

#### Invitation — do database, ek nateeja

SSO ka invite pehle se tha (1C). 3G ne uske upar jp_app ka aadha hissa joda, usi
shakl mein jo 2.48 ne tay ki thi: **koi distributed transaction nahi**.

| | |
|---|---|
| **Tarteeb** | account pehle, membership baad mein. Ulta karte to membership ek na-maujood account ki taraf ishara karti — dono taraf se **invisible** |
| **Idempotency** | `USP_ProvisionSchoolUser` `(SchoolId, UserUid)` par idempotent hai, aur service `DUPLICATE_EMAIL` ko **us account ki talash** mein badal deti hai jo usne pehle hi bana diya tha |
| **Loud failure** | step 2 gira to Error log mein email + Uid + SchoolId, aur caller ko saaf kaha jaata hai ki **dobara invite bhejein** |

🔴 **Retry ab sach mein kaam karta hai.** Pehle wo DUPLICATE_EMAIL par hamesha
ke liye atak jaata — theek karne ka tareeka manual INSERT hota.

⚠️ Jo bhi **pehle se check ho sakta tha, account banne se pehle** check hota hai
— role, address, campus. Ek galat request se bana account sabse bura orphan hai:
uska koi intezaar hi nahi kar raha, to koi report bhi nahi karega.

⚠️ Re-invite kisi maujooda member ka **role nahi badalta**. Warna invite
`USP_SaveSchoolUserRole` aur uske owner guard ke **around** ka rasta ban jaata.

#### 🔴 "Aapka access hata diya gaya" ≠ "aap kabhi jude hi nahi thay"

`USP_GetSchoolsForUser` pehle `Is_Active = 1` par filter karta tha. Matlab jiska
access **hata diya gaya** wo bilkul waisa dikhta tha jaisa koi jo kabhi juda hi
nahi tha — aur API use kehti: *"agar aapko abhi approve kiya gaya hai to sign out
karke wapas aayein"*. Wo aisa karta. Do baar. Phir school ko phone karta.

3G ne wo haalat **jaan-boojh kar reachable** banayi, to farq bhi zinda rakhna
pada: proc ab inactive rows bhi `IsActive` ke saath deta hai, aur service ke paas
har case ka **apna jumla** hai. Ye 3E wale bug ka hi doosra roop hai (2.57).

#### Token "revoke" ka asli matlab — verification ne theek karaya

Assertion likhi thi ki hataye gaye bande ka purana token **401** dega. Galat.
JWT stateless hai: `USP_RevokeAllUserTokens` **refresh** token maarta hai, access
token apni maut (60 min) marta hai.

Do alag sach, dono verify hue:
- purana **access token** har school endpoint par **403** — turant, "ghante bhar
  mein" nahi, kyunki membership gate har request par lagta hai;
- **refresh token** mara hua — session badhaya nahi ja sakta.

"Session dead hai" bina jaanche likh dena ek aise system ko bayan karta jo turant
logout karta hai. Ye system har wo darwaza turant band karta hai jahan wo pahunch
sakte hain, aur token ko khud marne deta hai.

#### Invitation email — jo naye HR ko sabse pehle dikhta hai

"You have been invited to join a workspace" kuch nahi batata aur bilkul us
phishing mail jaisa padha jaata hai jise delete karna sikhaya gaya hai. Chaar
baatein tay karti hain ki link click hoga ya nahi: **kisne** bulaya (naam +
address), **kaunsa school** (naam se), **kya kar payenge** (kaam ki zubaan mein,
permission code nahi), aur **kaun se campus**.

🔴 **Verification ne yahan ek galti pakdi:** template ka HTML comment — jisme yehi
chaar-baaton wali dalil likhi thi — **deliver ho raha tha**. Har invitation ke
saath, recipient ke mailbox mein. Dalil ab service ke doc comment mein hai;
template mein sirf placeholder list aur ek chetavni hai ki **is file ke comment
bheje jaate hain**.

#### Screen — matrix, aur owner ki row

Log neeche, campus across, har chauraahe par checkbox. Tick karte hi save, aur
**poora set** jaata hai (2.53) — sirf badla hua box bhejne se baaki mit jaate.

🔴 **Owner ki row alag dikhti hai, disabled nahi.** Saaf raasta hota greyed ticks
aur greyed buttons — aur wo **galat** hai: disabled control "toota hua" padha
jaata hai, aur padhne wale ka agla kadam hai use phir bhi click karna, phir
reload, phir kisi se poochna. To owner ki row par **koi control hai hi nahi** —
ek marked margin rule, halka tinted ground, aur jahan ticks hote wahan ek jumla:
*"Every campus — an owner is never scoped to one."*

⚠️ **GroupType = 1 par campus scope ka wajood hi nahi** (2.50) — na column, na
invite dialog mein checkbox. Ek campus wale school se "kaun se campus dikhein"
poochna ek aisa sawaal hai jiska ek hi jawaab hai.

#### `FullName` — naya column, aur jo **backfill nahi** kiya

`t_app_school_users` mein `FullName nvarchar(150) NULL` (019_alter). Wajah
structural hai: **`t_sso_users` mein naam hai hi nahi** — wahan pehchaan "kaunsa
account" hai, "kaun" nahi. Sirf email se bani team list padhi nahi jaati.

⚠️ **Maujooda rows NULL hi rahengi.** Ek lubhaavna backfill maujood tha —
`t_app_schools.PrincipalName` / `HrContactName` — aur wo **galat** hai: wo columns
ye vaada nahi karte ki **owner account kiska hai**. Jis school ne registration
mein principal ka naam diya aur jiska account office admin chalata hai, uske
login par principal ka naam chipak jaata.

Isliye: column nullable, UI email par gir jaati hai, aur naam tab aata hai jab
koi type kare. **Owner apna naam khud likh sakta hai** — role frozen hai, row
nahi. Warna koi owner apna naam kabhi daal hi nahi paata.

#### G15 band — queue ab "kis par koi nahi hai?" poochh sakti hai

Do cheezein toot rahi thi:
- server ka filter **numeric jp_sso UserId** leta tha, aur screen ke paas sirf
  apni id thi — isliye "assigned to me" checkbox, dropdown nahi;
- **"unassigned" express hi nahi ho sakta tha**: `@AssignedToUserId` par NULL ka
  matlab pehle se "sab" hai.

Ab: `@UnassignedOnly` apna flag hai, aur filter **Uid** leta hai jise service
jp_sso se resolve karti hai — wahi cross-DB join, API layer mein, jahan uski
ijazat hai (2.2).

🔴 **Anjaan assignee `-1` par resolve hota hai, NULL par nahi.** NULL ka matlab
"koi bhi" hai, to ek typo ya delete ho chuka account filter ko chup-chaap **poori
queue** tak chauda kar deta. Jo filter **khul kar** fail ho wo band ho kar fail
hone se bura hai — page phir bhi jawaab jaisa dikhta hai.

⚠️ Dono ek saath bhejne par **400**, chup-chaap ek chun kar nahi.

#### Test suite ne apne aap ko pakda

Section 4 ki assertion — "branch HR ka khaali save sirf wahi hataye jo use
dikhta hai" — **FAIL** hui. Procedure sahi tha; **test ka premise bah gaya tha**:
section 3 branch HR ko do campus de chuka tha, to us waqt use dono dikhte thay
aur dono hatna sahi tha.

Ek scoping test jiska premise khisak jaaye **na-hone se bura** hai: wo theek us
bug par PASS likhta hai jise pakadne ke liye likha gaya tha. Ab section 4 apna
premise pehle **reset karta hai aur assert karta hai**.

#### Verification — 48/48, asli HTTP

```
1. team + campuses     owner flagged, ZERO link rows
2. invite              jp_sso account + jp_app membership + scope, ek call se
                       email drop se padhi: kisne, kaunsa school, kya kar payenge
                       re-invite = ALREADY_A_MEMBER, role nahi badla
3. invite poora chala  token → password → login → school (refusal nahi)
                       ordinary member team padh sakta, likh nahi sakta (403)
4. owner               demote/remove/scope/promote/invite — paanchon 400
                       aur uske baad owner row jyon ki tyon
5. doosra school       re-role/scope/remove — teeno 404, row salamat
6. campus scope        poora set, no-op kuch nahi likhta, chhota set hataata hai
7. removal             row zinda, links zinda, access mara, message sahi
8. G15                 anyone 17 · unassigned 7 · by-uid 10 · anjaan 0 · dono 400
```

Script: `jp-docs/scripts/verify/team-contract.mjs`.

⚠️ **`browse-contract.mjs` (3E) is session mein chal nahi paayi** — wo
`head.711429@brightfield.edu.in` se login karti hai aur uska password sirf us
waqt ke `JP_PW` env var mein tha; `local-accounts.md` mein wo account hai hi
nahi. Jo cover hua: API **boot hui**, matlab `ContactLeakGuard` pass hua, aur
`/school/profile` teen alag callers ke liye 3G script mein verify hua. Sudhaar:
verification scripts ko un accounts par khada hona chahiye jo
`local-accounts.md` mein hain.

#### Files

```
jp-backend/database/jp_app/01_tables/019_alter_t_app_school_users_fullname.sql (naya)
jp-backend/database/jp_app/04_procedures/011_school_team.sql                   (naya)
jp-backend/database/jp_app/04_procedures/003_scope_resolver.sql                (IsActive)
jp-backend/database/jp_sso/04_procedures/009_users_by_uid.sql                  (naya)
jp-backend/database/jp_mdm/04_procedures/003_approval_reads.sql                (@UnassignedOnly)
jp-backend/database/jp_app/99_tests/003_test_school_team.sql                   (naya, 52)
jp-backend/JP.Domain/Schools/TeamContracts.cs                                  (naya)
jp-backend/JP.Infrastructure/Repositories/SchoolTeamRepository.cs              (naya)
jp-backend/JP.Infrastructure/Services/SchoolTeamService.cs                     (naya)
jp-backend/JP.Infrastructure/Email/Templates/school-invite.html                (naya)
jp-backend/JP.App.Api/Controllers/TeamController.cs                            (naya)
jp-school/src/app/core/team.service.ts                                         (naya)
jp-school/src/app/features/school/team/team.component.{ts,html,scss}           (naya)
jp-admin/src/app/core/admin-user.service.ts                                    (naya)
jp-admin/src/app/features/verification/queue/verification-queue.component.*    (G15)
jp-docs/scripts/verify/team-contract.mjs                                       (naya)
```

---

### 2.59 SCHOOL PROFILE AND CAMPUS SCREENS — PHASE 3F

Do screen, teen production build 0/0, SQL **144/144**, HTTP **37/37 + 48/48**,
browser **25/25**, screenshots 1440 aur 375 dono par.

#### 🔴 Do bug jo screen banane se pehle nikle — dono chup-chaap gire the

Ye phase UI ka tha. Do din purane bug pehle nikle, aur dono ki khaasiyat ek hi
hai: **kuch bhi fail nahi hota tha.**

**1. REORDER reorder karta hi nahi tha (2F se).**

`USP_SaveSchoolPhotos` bare id list leta tha aur position khud
`ROW_NUMBER() OVER (ORDER BY i.Id)` se nikalta tha — yaani **id ki value se**,
caller ke bheje kram se nahi. Har reorder insertion order likh deta,
`Status 1, 'Photos reordered.'` lautata, aur list waisi hi wapas aati — jo **UI
ka bug lagta hai**.

Badalne se **pehle** jaanch: c, a, b maanga → a, b, c mila.

Ab type `dbo.OrderedIdList (Id bigint, Position int)` hai — position ek **value**
hai jo caller bhejta hai. Jo kram express hi na ho sake, wo nibhaaya nahi ja
sakta. 3C ki suite isliye nahi pakad payi kyunki usne sirf "call safal hua"
dekha tha, **kram nahi**.

**2. `isActive` API se hamesha `false` aata tha (3E se).**

`Is_Active` standard column hai (2.4) aur is schema mein underscore wale **wahi**
hain. Dapper underscore **nahi hataata** jab tak `MatchNamesWithUnderscores` on
na ho — aur wo jaan-boojh kar off hai, kyunki wo ek global naam-badalne wala
niyam hai jo har mapping badal deta.

To `Is_Active` `BranchDto.IsActive` tak pahunchta hi nahi tha. Do phase tak
invisible raha kyunki **kisi ne use dikhaya hi nahi tha**; 3F ne status badge
lagayi aur **har campus "Closed"** padhne laga, jabki har row 1 thi.

🔴 Fix `Is_Active AS IsActive` alias hai, teen jagah, comment ke saath ki wo
**load-bearing** hai. SQL test isse kabhi nahi pakad sakta tha — procedure
hamesha sahi tha. HTTP check ab column aur JSON dono padhta hai.

#### Media — pehle koi image dikha hi nahi sakta tha

Photo ke paas 2F se `FilePath` tha aur bytes laane ka **koi rasta nahi**.
`App_Data` static serve nahi hoti — aur honi bhi nahi chahiye: usi root mein
teacher ke resume aur registration documents hain.

To `GET /api/school/photos/{id}/file` aur `/logo/file` jude, membership-gated
(`fn_IsSchoolMember`). Jo photo aapki nahi, wo **404** — 403 nahi, kyunki 403 ye
tasdeeq kar deta ki wo maujood hai.

⚠️ Path kabhi browser tak nahi jaata: client **id** se maangta hai, API path
resolve karke storage root ke andar hi rakhta hai. Jo client path naam le sakta
ho, wo koi bhi path naam le sakta hai.

⚠️ URL par Authorization header chahiye, isliye `<img src>` seedha kaam nahi
karta — gallery blob laa kar object URL banati hai, aur component band hone par
`revokeObjectURL` karti hai.

#### Section-level save, par RowVersion ek hi

Paanch section, har ek ka apna save aur apni haalat. Par **server ka update
poori row hai** — ek procedure, ek RowVersion. To har section poora draft bhejta
hai.

Ye jaan-boojh kar hai: per-section endpoint ka matlab per-section RowVersion
hota, aur do log alag section edit karke bhi ek doosre ko **chup-chaap
overwrite** kar dete.

🔴 **Conflict dikhaya jaata hai, nigla nahi.** 409 par section kehta hai ki kisi
aur ne badla, aur reload ka button deta hai. Naye RowVersion ke saath **retry
nahi** karta — wahi to "doosre ko chup-chaap overwrite karna" hai, madadgaar
shakl mein (2E ka niyam).

⚠️ Save ke baad RowVersion **server se dobara padha** jaata hai, locally +1 nahi
kiya jaata. Wo number server ka hai; aaj sahi andaza kal galat hai.

#### Reorder — arrows, drag nahi

Design system mein drag primitive hai hi nahi. Haath se banaya hua drag jo mouse
se chale aur keyboard se nahi, **buttons se bura** hota — us bande ke liye jise
sabse zyada zaroorat hai. ← → tab se pahunchte hain, screen reader bolta hai,
aur phone par chalte hain jahan scrolling page ke andar drag ek ladai hai.

Optimistic: tiles turant hilti hain, phir save. Fail hone par **wapas purani
jagah** — jo gallery server se alag kram dikhaye wo agle reload par jhooth bolti
hai.

#### 🔴 GroupType = 1 — teen jagah, warna faisla sirf kaagaz par hai

2.10 kehta hai single-campus school ko branch UI kabhi na dikhe. Wo **teen alag
jagah** hai, aur faisla tabhi sach hai jab teeno maanein:

| Jagah | Kaise |
|---|---|
| **Menu** | jp_sso menu deta hai aur usne GroupType ka naam bhi nahi suna — to `MenuService.hideRoutes()` (3F mein jp-shared mein joda) se app khud chhupati hai |
| **Route** | link chhupane se koi URL type karna nahi chhodta — `singleCampusGuard` redirect karta hai |
| **Screens** | jahan campus column ya picker hai, wahan `isMultiCampus()` pehle poochha jaata hai |

⚠️ **NULL ko multi maana hai.** Jis school ne jawaab hi nahi diya use branches
milti hain: ek campus wale ko extra menu dikhna chhoti taqleef hai; kai campus
wale se campus chhupana **wo screen hai jahan wo pahunch hi nahi sakta**.

Verify (browser): groupType 1 par nav mein Branches **nahi**, `/branches` type
karne par `/profile`, aur wapas 2 karte hi screen laut aayi — **campus jyon ke
tyon, koi migration nahi**.

#### Cities abhi bhi khaali (2.47) — wahi handling, doosri nahi

Registration form ne jo kiya, wahi: district/city control **chhupe** hote hain
aur ek line kehti hai kyun. Na spinner jo kabhi rukta nahi, na khaali dropdown —
dono "form toota hai" padhe jaate hain, aur khaali disabled dropdown wo cheez hai
jise log baar-baar click karte hain.

#### Head office — marked, disabled nahi

Uski row par **Remove button hai hi nahi**, ek marked rule aur ek line hai:
*"Head office — kept for as long as the school exists."* Greyed button "toota
hua" padha jaata hai aur phir bhi click hota hai — wahi dalil jo 3G ki owner row
par thi. Ek product, ek tarika "ye row structural hai" kehne ka.

🔴 **Refusal ka rasta abhi bana hai, tab nahi jab wo chalega.** `USP_DeleteBranch`
mein jobs/applications wali refusal 3C se likhi hai aur Phase 4 tak pahunch se
baahar hai. Screen server ka **message** dikhati hai, apna nahi — do jagah do
version rakhne ka matlab hai ek din galat wala dikhega.

Verify kiya: head office delete → 400 + wo message jo seedha dikhane layak hai.

#### Lat/long — plain pair, map picker nahi

Map picker behtar control hai aur **is phase ka kaam nahi**: "jobs near me"
Phase 4 hai aur abhi hai hi nahi. Picker banana us feature se pehle uska
interface banana hota. Fields batate hain kis liye hain, aur khaali chhode ja
sakte hain.

#### Design system mein kya joda (2.23 ke tehat)

| Kya | Kyun |
|---|---|
| `MenuService.hideRoutes()` | server permission tay karta hai; app ka apna data kya bemani banata hai wo alag sawaal hai |
| `unsavedChangesGuard` | ⚠️ native `confirm()` — router guard ko **synchronously** jawaab dena hota hai, warna wo page ke baare mein poochh raha hoga jo user chhod chuka |
| `.form-control--sm` | dense jagah ke liye. **Font 16px hi** — usse chhota karne par iOS Safari page zoom kar deta hai aur wapas nahi karta |

#### "Campuses", "Branches" nahi

Screen, copy aur school ki apni zubaan — sab campus kehte hain. Sidebar
"Branches" keh raha tha, seed row badal di. **Route `/branches` hi hai** — label
badalne ke liye har saved link todna galat sauda hai.

#### Verification

```
SQL       001 48/48 (20 neg, ismein naya photos section) · 002 44/44 · 003 52/52
HTTP      profile-branches.mjs 37/37 — save→reload→compare, 409, full-set,
          gallery order wapas padh kar, head-office refusal, GroupType dono taraf
Browser   screens-3f.mjs 25/25 — paanch section, owner-jaisi head office row
          (sirf Edit), district/city gayab, nav se Branches gayab, /branches
          redirect, 375 par 0px overflow
```

Screenshots: `jp-docs/screenshots/3f/` — profile (1440, 375), gallery
mid-reorder, branch list, branch form (1440, 375), head-office refusal,
single-campus nav.

⚠️ Verification scripts ab **jo banate hain wahi hataate hain**. Pehle
`team-contract.mjs` apna campus chhod deta tha, aur 3F ke screenshot ke waqt
demo school par **do "North Wing"** thay. Jo script apne hi kachre ko verify
karne lage, wo verify kuch nahi karti.

⚠️ Login limiter (5/minute per IP) verification ko rok deta tha. Script ab 429
par **rukti hai, girti nahi** — limiter apna kaam kar raha hai, aur uski shikayat
API ka bug dhoondhne bhej deti.

#### Files

```
jp-backend/database/jp_app/04_procedures/005_school_photos_facilities.sql (OrderedIdList, CAPTION, media paths)
jp-backend/database/jp_app/04_procedures/004_school_profile.sql           (IsActive alias)
jp-backend/database/jp_app/04_procedures/006_branches.sql                 (IsActive alias + kyun)
jp-backend/database/jp_app/99_tests/001_test_school_branch.sql            (+7 photo assertions)
jp-backend/database/jp_sso/03_seed/005_seed_menus.sql                     (Branches -> Campuses)
jp-backend/JP.Domain/Schools/SchoolContracts.cs                           (SavePhotoCaptionRequest)
jp-backend/JP.Infrastructure/Repositories/SchoolRepository.cs             (ordered TVP, media paths)
jp-backend/JP.Infrastructure/Services/SchoolProfileService.cs             (caption, OpenPhoto/OpenLogo)
jp-backend/JP.App.Api/Controllers/SchoolController.cs                     (caption + 2 media endpoints)
jp-shared/src/core/services/menu.service.ts                               (hideRoutes)
jp-shared/src/core/guards/unsaved-changes.guard.ts                        (naya)
jp-shared/src/styles/_forms.scss                                          (.form-control--sm)
jp-school/src/app/core/school.service.ts                                  (naya)
jp-school/src/app/core/school-context.service.ts                          (naya + singleCampusGuard)
jp-school/src/app/features/school/profile/school-profile.component.{ts,html,scss}  (naya)
jp-school/src/app/features/school/branches/branches.component.{ts,html,scss}       (naya)
jp-school/src/app/layouts/school-layout.component.{ts,html,scss}          (teen file, context load)
jp-docs/scripts/verify/profile-branches.mjs                               (naya)
jp-docs/scripts/verify/screens-3f.mjs                                     (naya)
jp-docs/screenshots/3f/                                                   (9 screenshots)
```

---

### 2.60 TEACHER PROFILE SCREENS — PHASE 3H

Nau section, teen production build 0/0, HTTP **33/33**, browser **21/21**.
Product ki sabse badi screen, aur wahi tay karti hai ki teacher signup poora
karega ya nahi.

#### 🔴 Sab kuch "chhod kar chale jaana" ke khilaf banaya hai

Lambe form har us kadam par log khote hain jo **kaam jaisa lagta hai**. Design
usi ke khilaf hai, kisi visual se zyada:

| Kya | Kyun |
|---|---|
| **Nau section, nau save** | aadhe mein rukne se kuch nahi jaata, aur phone number theek karne ke liye photo gallery tak scroll nahi karna padta |
| **Ek waqt par ek sujhav** | aath cheezon ki checklist wo cheez hai jise log band kar dete hain; ek saaf agla kadam wo hai jispar log amal karte hain |
| **Mahine, tareekh nahi** | school join karne ka **din** kisi ko yaad nahi hota, mahina sabko. Jo precision logon ke paas hai hi nahi, use maangna form ko imtihaan bana deta hai |

#### 🔴 0% par "0%" kabhi nahi likha jaata

Ye is phase ka sabse zaroori faisla hai.

Jo teacher abhi shuru hi kar raha hai use "0% complete" dikhana matlab **shuru
karne se pehle hi bata dena ki usne kuch haasil nahi kiya** — aur theek wahin log
tab band karte hain.

To 0% par:
- percentage **dikhti hi nahi**;
- heading hai *"Let's get you found by schools"*;
- aur ek cheez, wajah ke saath: *"Add the subjects you teach — Schools search by
  subject. Until you pick yours, none of their searches can find you."*

⚠️ **Sujhav points se nahi, "mehnat ke badle faayda" se tay hote hain.** Resume
sabse zyada (25) hai aur **sabse badi maang** bhi — ek file dhoondhni padti hai,
aksar likhni bhi. Subjects 20 ke hain aur do tap lagte hain, aur unke bina
teacher kisi school ki search mein aata hi nahi. Sabse pehle PDF dhoondhne bhejna
wahi rasta hai jahan profile 0% par chhoot jaati hai.

🔴 **75% ki chhat wahin samjhaayi jaati hai jahan wo lagti hai.** Bar par ek
nishaan hai, aur jo teacher baaki sab bhar chuka hai use saaf likha milta hai ki
resume hi ab bar ko hilata hai. Bina wajah ruki hui bar **tooti hui** padhi jaati
hai.

#### ui-multi-select — paanch jagah, isliye theek se banaya

Subjects, class levels, skills, languages, locations — **paanch** istemaal. Har
khaami paanch se guna hoti hai, to control dobara likha (2.23 ka niyam: kami ho
to system theek karo, screen mein bahana mat banao). Chaar cheezein galat thi,
aur koi bhi dekh kar nahi dikhti thi:

| Kya toota tha | Ab |
|---|---|
| **Nested interactive elements** — chips aur clear button `<button>` ke **andar** thay. Invalid HTML; screen reader poore ko ek control padhta hai aur chip par Space us button ko daba deta hai jisme wo baitha hai | chips trigger ke **bahar**, har ek asli `<button>` apne accessible naam ke saath |
| **Keyboard navigation thi hi nahi** — options `div[tabindex=0]`, yaani 40vein subject tak 40 Tab | arrow keys ek **active option** hilati hain, `aria-activedescendant` ke saath; Enter chunta hai, Escape band karta hai aur focus wapas deta hai |
| **Panel band hi nahi hota tha** — sirf Escape par. Paanch control wale form par do panel ek saath khule reh sakte thay | bahar click par band |
| **Bees selection layout tod deti thi** — chips trigger ke andar the, to control pills ki deewar ban kar poora page neeche dhakel deta | trigger **ginti** batata hai ("19 subjects selected"), chips neeche wrap hoti hain |

⚠️ **Languages ko isme nahi thoosa.** Unke saath ProficiencyLevel hota hai
(2.54), to control ye chunta hai ki **kaun si**, aur neeche ek row batati hai
**kitni achhi**. Per-item value ko shared control mein ghusaane se wo baaki
**chaar** jagah ke liye bura ho jaata.

#### Experience — sabse zyada mehnat wali jagah, isliye sabse zyada dhyaan

Ye bridge nahi hai: har row ki apni pehchaan hai, alag se judti, badalti aur
hatti hai — 3A ne unique index jaan-boojh kar nahi banaya tha, kyunki part-time
subject teacher jo sports programme bhi chalata tha, wo **do jaayaz overlapping
rows** hain (2.51).

🔴 **`TotalExperienceMonths` client kabhi nahi ginta.** Server har badlaav par
dobara nikaalta hai (2.54). Do phase pehle ye galat mila tha: 3B mein haath se
likhe total apne hi rows se **terah mahine** tak alag thay, aur 3D mein
`DATEDIFF(MONTH)` har band job ko **ek mahina kam** gin raha tha.

Verification ab **exact** hai, ±1 nahi:
```
Jun 2015 – May 2018 (band)   = 36 mahine   ← aakhri mahina ginta hai (3D ka fix)
Jun 2018 – aaj    (chaalu)   = 98 mahine   ← sirf POORE mahine
                     total    = 134
```
⚠️ Pehle assertion mein ±1 ki chhoot thi aur wo **pass** ho gayi thi. Jis class ke
bug ko pakadna hai usi ke liye chhoot rakhna — yaani ek mahine ka farq — test
nahi hota. Dono niyam ab likh kar assert hote hain: band job ka aakhri mahina
ginta hai, chaalu job ka **chal raha mahina nahi**.

#### Teacher ki apni files — pehle koi dikha hi nahi sakta tha

Wahi khaali jagah jo 3F ne school ki taraf pakdi thi. Photo, resume aur documents
ka path 3A se maujood tha aur **bytes laane ka koi rasta nahi**.

Teen endpoint jude: `/teacher/photo/file`, `/teacher/resume/file`,
`/teacher/documents/{id}/file`. Teacher **token se** resolve hota hai — kiski
file hai, iska koi parameter hai hi nahi.

🔴 **Resume khaas taur par.** Uski pehli teen line mein email aur mobile hota
hai, to wo **contact detail hai** (2.56 LOCKED). School use
`/api/teachers/{uid}/contact` se paata hai, teacher ke apply karne ya invite
accept karne ke baad — yahan se **kabhi nahi**. Verify kiya: school in teeno par
**404**.

#### Craft ke faisle jo dikhte nahi par mehsoos hote hain

- **Upload fail hone par purani file salamat hai, aur ye kaha jaata hai.** Fail
  hue upload ke baad asli dar yehi hota hai ki jo tha wo bhi gaya.
- Ek document fail ho to baaki **chhoote nahi** — list server se dobara padhi
  jaati hai.
- Reorder/har save ke baad profile **dobara padha** jaata hai, kyunki derived
  numbers server ke hain.
- `dob` par saaf likha hai: **school ise kabhi nahi dekhte** — `/browse` mein
  date of birth hai hi nahi (2.57), to umar filter ban hi nahi sakti.

#### Teen profile jo is screen ko todti hain — teeno khol kar dekhi

| Kaun | Kya | Screen ne kya kiya |
|---|---|---|
| **Imran** | naam aur state, 0% | percentage **dikhi hi nahi**; ek sujhav + wajah; khaali experience section **bulaata hai**, batata nahi |
| **Anita** | 100 mahine, **zero subjects** | 9 section bane, "8 years 4 months" server se, aur pehla sujhav — subjects |
| **Rohit** | 90%, **koi chaalu job nahi** | timeline bani, ek entry, **koi "Now" nishaan nahi**, kuch toota nahi |

⚠️ **Kuch save nahi kiya.** Bees selection multi-select ki tasveer ke liye ticked
hui aur save button daba hi nahi — ye teeno seeded profile system mein akeli
aadhi-bhari profiles hain aur **saabut ke taur par zyada keemti** hain. Baad mein
verify kiya: Anita ke abhi bhi zero subjects hain.

#### Design system mein kya joda

| Kya | Kyun |
|---|---|
| `.save-note` · `.conflict` · `.note` · `.card-empty` | school aur teacher profile mein **hu-ba-hu do baar** likhe the. Section-level save ab ghar ka pattern hai, aur har us form ko yehi teen jumle chahiye: sneh gaya, takrra gaya, ya samjhaana hai |
| `.card__footer` ka 375px vyavhaar | dono jagah alag-alag likha tha |

⚠️ `anyComponentStyle` budget jp-teacher mein 4kB se **6kB** kiya. Ye screen
jaan-boojh kar ek component hai — nau section ek draft aur ek RowVersion share
karte hain — aur use sirf byte-budget ke liye nau component mein todna asli
complexity hai bina kisi faayde ke. Duplication pehle hataayi, phir budget badla.

#### Verification

```
HTTP    teacher-profile.mjs 33/33 — ek throwaway account par har mutation:
        save→reload, 409, paanch full-set, experience ka exact ganit,
        75% chhat aur resume, aur school ke liye teeno file 404
Browser screens-3h.mjs 21/21 — Imran/Anita/Rohit, multi-select ke arrow keys,
        20 selection 1440 aur 375 dono par, aur "kuch save nahi hua"
```

Screenshots: `jp-docs/screenshots/3h/` — teeno profile, har section 1440 par,
paanch section 375 par, aur multi-select bees selection ke saath dono width.

⚠️ Seeded teachers ka password ab `local-accounts.md` mein likha hai (gitignored),
asli forgot-password flow se set kiya gaya. Yehi 3F wali shikayat ka jawaab hai:
verification script sirf un accounts par khadi honi chahiye jo likhe hue hain.

#### Files

```
jp-backend/database/jp_app/04_procedures/009_teacher_experiences_documents.sql (3 path procs)
jp-backend/JP.Infrastructure/Repositories/TeacherRepository.cs                 (3 path reads)
jp-backend/JP.Infrastructure/Services/TeacherProfileService.cs                 (OpenPhoto/Resume/Document)
jp-backend/JP.App.Api/Controllers/TeacherController.cs                         (3 media endpoints)
jp-shared/src/ui/ui-multi-select/*                                            (dobara likha)
jp-shared/src/styles/_cards.scss                                              (save-note, conflict, note, card-empty)
jp-teacher/src/app/core/teacher.service.ts                                    (naya)
jp-teacher/src/app/core/profile-completion.ts                                 (naya)
jp-teacher/src/app/features/teacher/profile/teacher-profile.component.{ts,html,scss} (naya)
jp-teacher/angular.json                                                       (style budget 6kB)
jp-school/src/app/features/school/profile/school-profile.component.scss       (duplication hatai)
jp-docs/scripts/verify/teacher-profile.mjs                                    (naya)
jp-docs/scripts/verify/screens-3h.mjs                                         (naya)
jp-docs/screenshots/3h/                                                       (18 screenshots)
```

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
| 5 | Master data — humne khud seed kar diya (2.47). Client ko **reconcile** karna hai, khaas kar provisional wale. Neeche exact list. | 🟡 **Unblocked, par reconciliation pending** |
| 6 | Email/SMS provider kaunsa? (SendGrid/SES/MSG91) Budget kiska? | ⏳ Pending — abhi plain SMTP behind `IEmailService`, teeno usi ko bolte hain |
| 7 | Teacher hard gate ya soft verification? (humne soft decide kiya) | ⏳ Pending |
| 8 | Admin "Settings" screen ka scope kya hai? (spec point 3 mein hai, detail nahi) | ⏳ Pending |
| 9 | File storage — S3 / Azure Blob / local server? | ⏳ Pending — abhi local disk behind `IFileStorageService`, swap = 1 class |
| 10 | Domain, hosting, SSL kaun arrange karega? | ⏳ Pending |

#### Q5 — client ko exactly ye reconcile karna hai (2.47)

Phase 2B ne khud seed kar diya taaki kaam na ruke. Jab client ki list aaye to
**300 rows aankh se diff mat karna** — ye padho:

| Table | Rows | Kitna confident |
|---|---|---|
| `m_mdm_board` · `m_mdm_qualification` · `m_mdm_subject` · `m_mdm_designation` · `m_mdm_class_level` · `m_mdm_stream` · `m_mdm_gender` · `m_mdm_state` | 7·16·34·10·5·4·4·36 | ✅ Standard hai. Client shayad sirf **rename** karega |
| 🔴 `m_mdm_document_types.IsMandatory` | 9 rows | ⚠️ **Sabse risky.** Ye decide karta hai registration complete hogi ya nahi. Client se **line-by-line confirm karao** |
| `m_mdm_skill` | 20 | ⚠️ Poori tarah humari invention — koi standard list hai hi nahi |
| `m_mdm_school_type` | 6 | ⚠️ Ownership buckets humne chune. "Minority Institution" shayad alag flag ho, list item nahi |
| `m_mdm_facility` | 12 | ⚠️ Granularity guess — Science/Computer lab alag rakhe, client ek "Laboratory" chah sakta hai |
| `m_mdm_rejection_reasons` | 10 | ⚠️ Wording humari. Applicant ko dikhti hai, to client apni bhasha chahega — wo **Name** change hai |
| `m_mdm_district` · `m_mdm_city` | **0** | 🔴 Seed hi nahi kiya. Dataset chahiye — source aur import plan 2.47 mein |

**Reconcile karne ka tareeka:** `Code` pe match karo. `Name` freely badlo.
Jo row nahi chahiye: `Is_Active = 0`, **kabhi DELETE nahi** (2.5). Nayi row:
naya Code, agla free Id, kuch renumber mat karo.
🔴 **Live Code kabhi mat badlo** — FKs usi se resolve hoti hain.

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
| 2026-08-09 | 2A | **`jp_mdm` database** — 23 masters + 8 transactional + error log = 32 tables, 91 indexes, 29 FKs, 4 IST functions, USP_LogError. Seed limited to the 5 masters we own. Re-run creates zero new objects | ✅ Done |
| 2026-08-09 | 2C | **Approval engine** — 9 procedures + USP_LogError. RequestNo per-type-per-year counter, idempotent submit, RowVersion concurrency, multi-level engine. 26/26 test assertions | ✅ Done |
| 2026-08-09 | 2B | **Master data seed** — 18 masters seeded ourselves (client lists never arrived), 5 marked PROVISIONAL. District/city left empty; CityId confirmed nullable so forms degrade to state-only. 2C suite re-verified 26/26 | ✅ Done |
| 2026-08-09 | 2C | **Independent verification** — fresh throwaway scripts, 9 scenarios incl. 3 genuinely parallel sessions (identical SubmittedOn tick). Sab pass. Ek coverage gap mila: suite RowVersion branch tak nahi pahunchti (G10). Cleanup ke baad counts baseline pe wapas | ✅ Done |
| 2026-08-09 | 2C | **G10 closed** — two-level fixture suite mein add ki, 30/30 (26 se), level config restore hota hai | ✅ Done |
| 2026-08-09 | 2D | **JP.App.Api endpoints** — masters/approvals/documents, cross-DB orchestration, upload hardening. Build 0/0. Chaaron step-2 proofs verify kiye. Teen asli bug pakde: Sso connection string missing, activation idempotent nahi thi (retry tod deta), retry endpoint nahi (G11) | ✅ Done |
| 2026-08-10 | 2E | **Admin verification panel** — queue, request detail with an inline PDF/image viewer, dashboard, orphan section. **G11 closed** (retry + reconciliation endpoints). Production build clean, screenshots at 1440 and 375. Chaar asli bug pakde: reject provisioning kar deta tha, multi-word master keys khaali, DateOnly read phenkti thi, detail header mein EntityName nahi | ✅ Done |
| 2026-08-10 | 2F | **School registration** — 5-step form with a server-side draft, account-status wired to the real request. Three pull-forwards: branches, PAN, plans+subscriptions. Provisioning now writes three rows in one transaction under one guard. 🔴 No Aadhaar number is stored anywhere, by decision. Whitelist misses are logged. Full flow verified end to end | ✅ Done |
| 2026-08-10 | 3A | **jp_app tables** — 12 new + 2 ALTER for the columns 2D/2F deferred. jp_app now 16 tables · 63 indexes · 15 FKs · 47 checks. Re-run creates zero new objects. Guard test 17/17: duplicate profile, duplicate bridge and all four CHECKs refuse; soft-delete re-add and two-roles-one-school are allowed | ✅ Done |
| 2026-08-10 | 3B | **Backfill + seeded profiles** — 11 teacher profiles, 11 teacher plans, 2 head-office branches, 2 org plans. All three completeness checks return 0. **G12 closed.** Two bugs the counts caught: a table variable's IDENTITY not resetting on DELETE, and giving a pending org a plan (which would have broken its future provisioning). Teacher data is entirely seeded — G20 | ✅ Done |
| 2026-08-10 | 3C | **School + branch procedures** — 10 procs, the scope resolver, the bridge-sync pattern. Suite 41/41 with 15 negative cases. **G21 and G19 closed.** Found t_app_school_users had never been written to — the resolver reads it, so every school-scoped query would have been empty for everybody. Running a real registration then found two production bugs in provisioning: the CATCH claimed ALREADY_PROVISIONED without checking, and a second school under one organisation could not be provisioned at all | ✅ Done |
| 2026-08-10 | 3D | **Teacher procedures** — 14 procs, 5 bridge syncs (two of them not plain sets), experiences as entities. Suite 44/44 with 8 A-cannot-touch-B assertions. Contact details lock until the teacher applies, and the resume locks with them. Found DATEDIFF(MONTH) was making every closed job one month short | ✅ Done |
| 2026-08-10 | — | **All seven repos pushed to GitHub. G0 closed.** Credentials stripped from HOW_TO_RUN, PROJECT_MEMORY and a verify script first — they are in a gitignored local-accounts.md now | ✅ Done |
| 2026-08-10 | — | **2.56 LOCKED — contact unlocks on teacher consent, never on payment.** Resolved the conflict between 3D's contact rule and the monetization plan. Two paths only: applied, or accepted an invite. What is sold is the school's capability. ⚠️ The spec has no ACCEPTED invite status — Phase 6 must add one or path 2 collapses into path 1 | ✅ Done |
| 2026-08-10 | 3E | **Profile APIs** — 23 endpoints, build 0/0, HTTP verification 20/20. Contact is now protected in three layers, the third being a startup guard that refuses to boot if the browse DTO grows a contact field (proved by breaking it). Closed 3C's two mirrored assertions with real 404s for suspended and pending schools. Found a refusal whose message was written for the wrong kind of user | ✅ Done |
| 2026-08-15 | 3G | **School team** — 4 procedures, 5 endpoints, the team screen, SQL 52/52 (27 negative), HTTP 48/48. The owner cannot be demoted, removed or scoped, by anybody including themselves. A full-set sync never removes a campus the caller could not see — the silent revocation that would have looked like a working save. Closed **G15**; opened **G24** | ✅ Done |
| 2026-08-15 | 3F | **School profile and campus screens** — 5 sections with their own saves, the gallery, campus CRUD. Found and fixed two silent bugs older than the phase: REORDER sorted by id and discarded the order it was given (2F), and isActive never reached the DTO because Dapper does not strip underscores (3E). Added the media endpoints — nothing could display an uploaded photo before. SQL 144/144, HTTP 37/37 + 48/48, browser 25/25 | ✅ Done |
| 2026-08-15 | 3H | **Teacher profile screens** — 9 sections, the completion meter that names one next step instead of printing a verdict, the experience timeline, and the five multi-selects. Rebuilt ui-multi-select in jp-shared: nested interactive elements, no keyboard navigation, a panel that never closed, and twenty selections that broke the layout. Added the teacher media endpoints — nothing could display a photo before. HTTP 33/33, browser 21/21, opened as Rohit, Anita and Imran | ✅ Done |
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
⚠️ **G0 ab band hai** — saaton repo GitHub par hain (2.55).

---

## ✅ PHASE 2A + 2B + 2C COMPLETE — 2026-08-09

| Check | Result |
|---|---|
| `jp_mdm` objects | **33 tables · 93 indexes · 10 procedures · 4 functions · 30 FKs** |
| `run_all.sql` re-run | **zero new objects** |
| `001_test_approval_engine.sql` | **30 / 30** (G10 close hone ke baad; pehle 26) |
| Suite leaves behind | **nothing** — request/trail/subject/series counts identical before and after |

**2A** — 23 masters + 8 transactional + `t_mdm_error_log`, IST helpers,
`USP_LogError`. Seed limited to the five masters we own. Details in **2.45**.

**2C** — 9 approval procedures. RequestNo from a per-type-per-IST-year counter
row, idempotent submit, RowVersion checked inside the UPDATE, multi-level engine
on a single-level seed. Details in **2.46**.

⚠️ 2C added two objects beyond 2A's 31: `t_mdm_request_number_series` and the
`RequestNoPrefix` column on `m_mdm_request_types`.

---

## ✅ PHASE 2D COMPLETE — 2026-08-09

Build **0 warning 0 error**. Endpoints live, orchestration verified end to end
including a deliberately broken step 2. Details **2.48**.

⚠️ Teen naye gaps: **G11** (retry endpoint nahi), **G12** (teacher backfill —
Phase 3 ke liye zaroori), **G13** (virus scanning).

---

## ✅ PHASE 2E COMPLETE — 2026-08-10

Production build **clean**. Verification queue, request detail with documents
open inline, and the admin dashboard. Details **2.49**.

**G11 closed** — an orphaned approval is a button now, not a DBA.

⚠️ Teen naye gaps: **G14** (multi-level sirf aadha verify hua),
**G15** (assigned-to sirf "mujhe"), **G16** (branch-add ka tab nahi).

⚠️ Ab bhi khula: **G6** ka aadha hissa — school ko *approve* karna ab UI se
hota hai, par user ko suspend/reactivate karna abhi bhi Swagger hai.

---

## ✅ PHASE 2F COMPLETE — 2026-08-10

Teeno frontend production build **clean**. Registration form, server-side draft,
account-status asli data par. Details **2.50**.

**MILESTONE 1 REACHED** — school signup → admin approve → school active, end to
end, sab asli endpoints se.

⚠️ Do naye gaps: **G17** (ek document replace karne ke liye poora form),
**G18** (draft discard nahi hota). **G12** ab teen kaam bolti hai, ek nahi.

---

## ✅ PHASE 3A COMPLETE — 2026-08-10

`jp_app` ki baaki saari table ban gayin: **16 table · 63 index · 15 FK ·
47 check**. Doosri run par zero naya object. Details **2.51**.

⚠️ **Table khaali hain.** `t_app_teachers` ab exist karti hai — usme koi row
nahi hai.

---

## ✅ PHASE 3B COMPLETE — 2026-08-10

Backfill chala aur **teeno completeness check zero** hain. 11 teacher profile,
11 teacher plan, 2 head-office branch, 2 org plan. Details **2.52**.

**G12 CLOSED** — teeno kaam ho gaye.

⚠️ Teen naye gap: **G19** (Active school jiski school nahi), **G20** (saara
teacher data seeded hai, asli nahi), **G21** (signup par profile abhi bhi nahi
banti — G12 ek-ek account karke dobara khulega).

---

## ✅ PHASE 3C COMPLETE — 2026-08-10

School aur branch procedures, scope resolver, bridge-sync pattern. Suite
**41/41**, negative cases **15/15**. Build 0/0. Details **2.53**.

**G21 CLOSED** — signup ab profile banata hai, asli signup se verify kiya.
**G19 CLOSED** — St Mary's asli raste se registered aur approved.

⚠️ Ek naya gap: **G22** — scope resolver convention hai, enforcement nahi. Phase
4 aur 5 dono uspe khadi hain.

---

## ✅ PHASE 3D COMPLETE — 2026-08-10

Teacher procedures poore. Suite **44/44**, jisme **A-cannot-touch-B 8/8**.
Details **2.54**.

**G0 CLOSED** — saaton repo GitHub par, credentials nikaal kar. Details **2.55**.

---

## ✅ PHASE 3E COMPLETE — 2026-08-10

23 endpoint, build **0/0**, HTTP verification **20/20**. Details **2.57**.

Contact ab teen parat se bacha hai, teesri ek startup guard hai jo DTO chaudi
hone par API ko chalne hi nahi deta — **DTO tod kar sabit kiya**.

⚠️ Ek naya gap: **G23** — ek user ek hi school par ho sakta hai; API doosra keh
hi nahi sakti.

---

## ✅ PHASE 3G COMPLETE — 2026-08-15

Chaar procedure, paanch endpoint, team screen. SQL **52/52**, HTTP **48/48**.
Details **2.58**.

Owner ko na demote kiya ja sakta hai na hataya — **khud se bhi nahi** — aur
non-owner ka campus save wo campus **kabhi nahi hataata** jo use dikhta hi nahi.

✅ **G15 band.** ⚠️ Naya gap **G24** — role badalne par jp_sso ka role saath nahi
badalta.

---

## ✅ PHASE 3F COMPLETE — 2026-08-15

School profile aur campus screens. Teen production build **0/0**, SQL
**144/144**, HTTP **37/37 + 48/48**, browser **25/25**. Details **2.59**.

🔴 Do bug is phase se **purane** nikle, dono chup-chaap gire the: reorder kabhi
reorder karta hi nahi tha (2F se), aur `isActive` API se hamesha `false`
aata tha (3E se). Dono ab HTTP check se bandhe hain.

⚠️ Naya gap **G25** — underscore wale column DTO tak nahi pahunchte, aur bhoolne
par kuch fail nahi hota.

---

## ✅ PHASE 3H COMPLETE — 2026-08-15

Teacher profile ki nau section. Teen production build **0/0**, HTTP **33/33**,
browser **21/21**. Details **2.60**.

🔴 0% par percentage **dikhti hi nahi** — ek sujhav wajah ke saath dikhta hai.
Jise shuru karne se pehle bata do ki usne kuch haasil nahi kiya, wo tab band kar
deta hai.

🔴 `ui-multi-select` dobara likha (paanch jagah istemaal hota hai): nested
interactive elements, koi keyboard navigation nahi, panel band hi nahi hota tha,
aur bees selection layout tod deti thi.

⚠️ Experience ka ganit ab **exact** assert hota hai — pehle ±1 ki chhoot thi, jo
theek us ek-mahine wale bug ko chhupa deti jise pakadna tha.

---

## ▶️ NEXT: PHASE 4 — JOBS

Phase 3 poora ho gaya: `jp_app` ki tables, procedures, APIs aur school ke
teeno screen (profile, campuses, team). Ab **jobs** — pehli cheez jo teacher aur
school ke beech aati hai.

### 🔴 Jo pehle se likha hua hai aur ab zinda hoga
- `USP_DeleteBranch` ki "is campus par jobs hain" wali refusal (2.53) — table
  banne par comment se code banegi. **UI ka rasta 3F mein ban chuka hai.**
- `fn_VisibleBranches` — har job query isse guzregi. Har nayi list proc ke
  saath uska apna negative case chahiye (G22).
- `fn_TeacherContactUnlocked` (2.54) — **application aane par hi** contact
  khulta hai (2.56 LOCKED). Phase 5 ka aadha hissa yahin se shuru hota hai.

### 🔴 BranchId kabhi NULL nahi (2.10)
Job, application, offer — teeno par mandatory. Single-campus school ka head
office bhi ek branch hai, isliye koi nullable-branch rasta banane ki zaroorat
nahi.

### Verification
`90_ops/001_verify_account_completeness.sql` teeno zero ·
`99_tests/001` 48/48 · `002` 44/44 · `003` 52/52 ·
`scripts/verify/{browse-contract,team-contract,profile-branches,screens-3f}.mjs`

---

## Uske baad

**MILESTONE 1 DEMO — abhi bhi baaki hai.** School signup → admin approve →
school active poora chalta hai. Dikhane se pehle: jaan-boojh kar orphan chhodi
gayi `REG-SCH-2026-00005` saaf karo, nayi screenshots lo, known gaps dobara
padho, aur saaf batao kaun si screen asli hai aur kaun si
abhi mockup (applicants table fixture par hai — G6).

**Phase 4 — jobs.** Har job ek branch par lagti hai, aur har school ke paas ab
din se ek head office hai (2.50) — to yahan koi nullable-branch code path nahi
chahiye.

**Phase 2.5 — entitlement engine.** Features, gating modes, credits,
`ConsumeAsync`, admin ki feature-gating screen, payment gateway, invoices.
Table pehle se maujood hai aur **har account ek plan par hai**, to yahan
reconcile karne ko koi legacy row nahi hogi.

**Phase 6 — do-level offer approval.** 🔴 **G14 pehle padho.** Multi-level
engine sahi dikhta hai par sirf ek raste se guzara hai; level 2 par reject,
resubmit aur per-level permission ke test us kaam se **pehle** likhne hain.

Sab ke liye 2.42 ka start order: **`jp-shared` :4999 pehle**.

---

## 🔴 Kuch bhi shuru karne se pehle

- **Section 2A (known gaps)** padho. ✅ G0 band ho chuka — saaton repo GitHub
  par hain (2.55) — par baaki khule gaps wahin hain.
- **2.39** — organization scope. Uska integration test Phase 3 ki definition of
  done ka hissa hai.
- **2.42** — frontend structure LOCKED.
- **2.11** — SQL Server 2019 syntax only.
- **2.21 / 2.30 / 2.31** — SP error convention, list-proc rules, CATCH ordering.
- **2.45 / 2.46 / 2.47 / 2.48 / 2.49 / 2.50** — 2A, 2C, 2B, 2D, 2E aur 2F
  mein kya bana aur kyun.
- **2.48** — 🔴 cross-DB orchestration ka koi distributed transaction nahi hai.
  Approval ka HTTP 200 ka matlab **orchestration succeed hua** nahi hai;
  har caller ko `orchestrationCompleted` padhna hai. 2.49 ka
  `describeOutcome()` iski **ekmatra** interpretation hai — doosri mat likhna.
- **2.49** — reject **kuch provision nahi karta**, aur ye do jagah gated hai.
  Agar teesri jagah orchestration call kar rahe ho, wahi check pehle lagao.
- **2.56 🔒** — 🔴 contact **teacher ki sehmati** se khulta hai: usne apply kiya
  ho ya invite **accept** kiya ho. **Paise se kabhi nahi.** Bikta hai school ki
  kshamta — search, kitne invite — teacher ka number nahi. Agar
  `fn_TeacherContactUnlocked` mein kabhi plan ya subscription ka naam aaye,
  faisla toota ja chuka hai.
- **2.50** — 🔴 **kahin bhi Aadhaar NUMBER store mat karna.** Government photo ID
  ka DOCUMENT liya jaata hai, number nahi. Agar client maange to likhit mein,
  unki apni legal advice ke saath.
- **2.50** — provisioning ke teeno insert ek hi idempotency guard ke andar hain.
  Chautha jodo to wo bhi andar hi jaana chahiye.

### Wo do galtiyan jo is phase mein pakdi gayin, dobara mat karna
1. **Proc ka result set badlo to usi commit mein uske test ka temp table badlo.**
   `USP_CreatePasswordResetToken` mein `UserTypeId` add hua tha par test ka
   `#ResetTok` 5 column ka reh gaya — poora suite chalna band ho gaya tha,
   assertion fail nahi hui thi.
2. **Test suite ko apne fixtures khud banane chahiye.** `m_mdm_subject` 2B tak
   khaali hai; suite 900+ id block use karti hai jo asli seed kabhi nahi lega.
