# jp-docs

The single source of truth for Staffroom India. **Clone this as a sibling of
every other repository**, and read `PROJECT_MEMORY.md` before starting any work.

```
D:\Projects\
├── jp-docs\      ← you are here
├── jp-shared\    Angular library, published to GitHub Packages
├── jp-admin\     :4200
├── jp-school\    :4300
├── jp-teacher\   :4400
├── jp-public\    :4500
└── jp-backend\   JP.Sso.Api + JP.App.Api + all three databases
```

## Why this repo exists

Seven repositories means seven working sessions that could each start from a
different understanding of the architecture. `PROJECT_MEMORY.md` is what stops
that: every locked decision, numbered, with the reasoning that produced it.

**Do not copy `PROJECT_MEMORY.md` into another repository.** Three copies become
three versions within a week, and the entire value of the file is that there is
exactly one. Every other repo's README points here instead.

⚠️ **One session writes it at a time.** Two sessions appending to the progress
log will clobber each other. Whoever finishes a unit of work updates it; the
others pull before writing.

## Contents

| | |
|---|---|
| `PROJECT_MEMORY.md` | Every locked decision, the progress log, and what is next. **Read first.** |
| `HOW_TO_RUN.md` | Setup, run commands, test accounts, and what is real vs. mocked |
| `DB_TABLE_STRUCTURE.md` | The 87-table schema across the three databases |
| `design-screens/` | Screenshots at 375px and 1440px |

## Scripts

```bash
npm run bootstrap        # clone all seven repos as siblings, install, link shared
npm run check-versions   # which @tarun1515/jp-shared is each app running?
```

`check-versions` is the one to run after any change to `jp-shared`. Four apps
install it independently, so an app that was not updated keeps running the old
copy and builds perfectly cleanly while doing so. The script reports each app's
version and whether it is **linked** (follows the sibling working copy) or
**installed** (frozen at a published version), and exits non-zero on drift.
