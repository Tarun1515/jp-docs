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

Run them with the dev servers already up:

```bash
node scripts/verify/site-audit.mjs
node scripts/verify/check-scss-depth.mjs ../jp-admin ../jp-school ../jp-teacher
```

## Two traps these scripts already account for

**Hydration.** A click that lands before Angular hydrates does nothing, and the
page looks like it failed validation. `chooser-e2e` and the contact check retry
until the app responds, so they measure behaviour and not the race. A fixed
`waitForTimeout` is not a fix — it is the same race with a longer fuse.

**`fullPage` screenshots and sticky headers.** Playwright scrolls and stitches,
so a `position: sticky` header re-renders partway down the image. That is an
artifact of the capture, not a bug in the page. `shoot-site.mjs` neutralises
sticky positioning before capturing.
