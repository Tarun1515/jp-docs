# jp-docs

The single source of truth for Staffroom India. **Clone this as a sibling of
every other repository**, and read `PROJECT_MEMORY.md` before starting any work.

```
D:\Projects\
├── jp-docs\      ← you are here
├── jp-shared\    :4999 — the Module Federation remote. Start it first
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
npm run bootstrap        # clone all seven repos as siblings and install them
```

There is no version-drift check any more, and nothing to link. `jp-shared` is
a Module Federation **remote** now: the apps load its JavaScript at runtime
from `http://localhost:4999`, so there is exactly one copy running and nothing
that can drift. Its SCSS is shared at build time through
`includePaths: ["../jp-shared/src/styles"]`, which is why the seven repos must
sit as siblings — including on CI.

See `PROJECT_MEMORY.md` decision **2.42** for why the npm package was dropped,
and `HOW_TO_RUN.md` §3 for the start order and the two failure modes worth
knowing in advance.
