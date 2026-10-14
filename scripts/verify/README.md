# Verification scripts

Browser-driven checks written during Phase 1. They are **not** a test suite yet
— there is no runner, no assertions library and no CI. They print results and
you read them.

They live here rather than in an app repo because most of them cross app
boundaries: the chooser flow spans `jp-public` → `jp-school`/`jp-teacher`, the
federation check spans a host and the remote, and `jp-docs` is the only
repository that sits beside all the others.

> 🔴 **These were rescued from a scratch directory at the end of Phase 1.** They
> had been run ad hoc from an npx cache, so nothing was committed anywhere and
> the next phase would have rewritten them from nothing. Phase 8 turns them into
> a real suite — see PROJECT_MEMORY "E2E TESTING — Phase 8".

## Setup

Dependencies are declared but **not installed** — nobody has needed them in a
checkout yet.

```bash
cd jp-docs
npm install
npx playwright install chromium
```

## What each one does

| Script | Checks | Needs running |
|---|---|---|
| `site-audit.mjs` | Every public route: status, one `h1`, no skipped heading levels, title/description length, canonical, `og:title`, `lang`. Then crawls every internal link and anchor for dead ends | `jp-public` |
| `lh.mjs` | Lighthouse SEO + accessibility per public page, and names the failing audits | `jp-public` |
| `measure.mjs` | Measures the content column on each page and reports whether it is centred — the check that caught the mixed alignment convention | `jp-public` |
| `chooser-e2e.mjs` | Clicks all four `/continue` paths through to the target app's auth screen and asserts it rendered, not 404ed | `jp-public`, `jp-school`, `jp-teacher`, `jp-shared` |
| `signin-check.mjs` | Signs in to `jp-school` and asserts it lands on the dashboard with app-scoped storage keys | `jp-school`, `jp-shared`, `JP.Sso.Api` |
| `final-verify.mjs` | Federation: which barrels are fetched from `:4999`, how many copies of `@angular/core` the page loaded, and the singleton proof (`JP_APP_IDENTITY instanceof ng.InjectionToken`) | all three hosts + `jp-shared` |
| `shoot-site.mjs` | Screenshots every public page at 1440 and 375 into `design-screens/`, and reports horizontal scroll | `jp-public` |
| `check-scss-depth.mjs` | Finds the deepest component stylesheet using the shared partials per app and confirms it compiled — the build-time SCSS path that broke after the repo split | nothing (reads source and `dist/`) |
| `public-contract.mjs` | Phase 7A. The anonymous surface over HTTP: the 404 wall (draft/expired-at-the-IST-boundary/closed/deleted), the raw-bytes sweep plus a key allowlist, byte-identical responses with and without a token, the honeypot, the read and contact rate limits, and the batched view counter | `JP.App.Api`, `JP.Sso.Api` — **restart the App API first**, see above |
| `safe-path.mjs` | Phase 7B-0. 🔒 The open-redirect check, table-tested: imports jp-shared's `safeInternalPath` DIRECTLY (it has no Angular imports for exactly this reason) and runs ~30 hostile and legitimate candidates past it, each stating what shipping it would mean. Includes an assertion that several hostile values pass `startsWith('/')` and are still refused | **nothing** — a pure function |
| `funnel-e2e.mjs` | Phase 7B-0. The public→teacher funnel in ONE signed-out browser session: public job detail → Apply → teacher signup → lands on that job's apply route with the job named. Plus the forced negatives (absolute, protocol-relative, backslashed and foreign-origin `returnUrl` never stored), the authenticated hole the auth guard had since Phase 3, and a draft job's uid on the apply route | `jp-public`, `jp-teacher`, `jp-shared`, both APIs |
| `public-screens.mjs` | Phase 7A. The public site in a browser: the listing with **JavaScript disabled** (the only test that tells server rendering from hydration), filters in the URL, no Authorization header on any request, the job title from the response, the wall through the UI, and the contact form's payload and states by interception | `jp-public`, `JP.App.Api`, `JP.Sso.Api` |
| `admin-desk.mjs` | Phase 7B. The operations desk over HTTP: every route forced against SUPER_ADMIN, MODERATION_ADMIN, VERIFICATION_ADMIN and a school owner; pull → public 404 measured in ms with the `no-store` header printed; the application row byte-identical afterwards; 🔒 the reporter absent from the raw bytes of every response the reported party can fetch **while present in the admin queue**, so the check is not vacuous; featured proven live/ended/not-yet-started either side of the IST boundary; and the anonymous surface re-counted at exactly six | both APIs |
| `admin-desk-screens.mjs` | Phase 7B. The six admin screens in a browser: the queue's ordering and its two count cells, a pull **driven by typing a reason and pressing the button**, the log in the school's own words naming no administrator, 🔒 the reporter's name and full uid absent from the rendered page, three featured groups out of one date column, a FAQ switched off and read back from the public response as raw bytes, the G44 notice on the blocks screen proven true by walking jp-public's source, the enquiry trail written from the form, and 🔒 a MODERATION_ADMIN's sidebar plus what typing `/cms/featured` shows them (the failed note, never the empty state) | `jp-admin`, `jp-shared`, both APIs |

Run them with the dev servers already up:

```bash
node scripts/verify/site-audit.mjs
node scripts/verify/check-scss-depth.mjs ../jp-admin ../jp-school ../jp-teacher
```

## 🔴 A full regression needs a freshly started JP.App.Api

`public-contract.mjs` proves the contact form's rate limit, which is **three
submissions per hour per IP**. Proving it costs all three. The limiter is
in-memory and per process (2.35), so the reset is a **restart**, not a wait:

```bash
taskkill //F //IM JP.App.Api.exe      # Git Bash; pkill does not match it on Windows
dotnet run --project JP.App.Api       # from jp-backend
node scripts/verify/run.mjs
```

Run it twice inside the hour without restarting and `public-contract` fails on
its own PRECONDITION check, which says exactly this. That is the check doing its
job — an exhausted bucket otherwise reads as a broken honeypot, and costs
twenty minutes in the wrong file.

⚠️ `public-screens.mjs` spends **no** budget — every contact test there
intercepts — so it can be run repeatedly in any order. The split is deliberate:
the contract suite owns the server's behaviour, the screens suite owns the
screen's.

🔴 **The SIGN-IN budget is a separate trap, and it bit 7B-0 twice.** The SSO
allows `LoginPerIp` 5 per 60 seconds and `LoginPerIdentifier` 10 per 3600
seconds. `lib/login.mjs` closes the hourly one for API suites with a disk token
cache — but a BROWSER suite signs in through the form and cannot use it. So:

- `funnel-e2e.mjs` signs in as **the account it creates**, not a seeded one,
  because the hourly cap on a shared account cannot be waited out inside a run.
- Its sign-in helper reports the limiter's own message and waits 65 seconds
  before retrying. Without that, a refused sign-in surfaces as
  "page.waitForURL: Timeout 30000ms exceeded" — which reads as a router bug and
  costs an hour in the wrong file.

⚠️ And `public-contract` hands the **read** budget back before it exits (it
polls for a 200). It used to leave the per-IP read bucket empty, and the next
suite's server-rendered pages came back 429 — reported as "the job listing is
not server-rendered", which was false and pointed at the wrong file.

## Two traps these scripts already account for

**Hydration.** A click that lands before Angular hydrates does nothing, and the
page looks like it failed validation. `chooser-e2e` and the contact check retry
until the app responds, so they measure behaviour and not the race. A fixed
`waitForTimeout` is not a fix — it is the same race with a longer fuse.

**`fullPage` screenshots and sticky headers.** Playwright scrolls and stitches,
so a `position: sticky` header re-renders partway down the image. That is an
artifact of the capture, not a bug in the page. `shoot-site.mjs` neutralises
sticky positioning before capturing.
