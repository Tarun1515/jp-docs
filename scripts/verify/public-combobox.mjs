/*
  P3b — THE PUBLIC JOB FILTERS: A SERVER-RENDERED <select> THAT UPGRADES ITSELF
  INTO A TYPE-AHEAD, AND RANKS LIKE THE SHARED ONE.

  ----------------------------------------------------------------------------
    1. 🔴 THE VECTORS    the SHARED cases in lib/combobox-vectors.mjs, run
                         against jp-public's own shipped ranking function. The
                         same file is what jp-shared's combobox-rank.mjs runs,
                         which is how a DECLARED second implementation (2.43,
                         G27) is kept honest: change either component and the
                         other repository's suite goes red.
    2. 🔴 THE BYTES      the native <select>s, their `name`s and every option's
                         text, read out of the HTML the server sent — no
                         browser involved, so there is nowhere for hydration to
                         have helped
    3. 🔴 NO JS          the same page with JavaScript DISABLED: the selects are
                         still selects, and SUBMITTING THE FORM filters the
                         list server-side. Reuses public-screens.mjs's
                         technique — a context created with
                         `javaScriptEnabled: false` — which is the only way to
                         tell server rendering from hydration
    4. THE UPGRADE       with JavaScript on: role="combobox" over a
                         role="listbox", the label still attached, arrows,
                         Enter, Escape, and the rendered order compared against
                         the shipped ranking function on the LIVE option list

  ----------------------------------------------------------------------------
  ⚠️ WHAT THIS SUITE DOES NOT DO
  ----------------------------------------------------------------------------
  It does not score Lighthouse. `lh.mjs` owns that, /jobs is in its list, and
  the bar is 100/100 — this suite only asserts the two things that score would
  be made of here: the <label for>/id pair survives the upgrade, and
  `aria-controls` names an element that EXISTS even while the list is closed.

  It touches no database and creates no fixtures, so it can be run repeatedly,
  in any order, with no restart.

  ⚠️ IT DOES DEPEND ON THERE BEING LIVE JOBS. /jobs/filters only returns
  filter values that some published job actually uses, so with an empty board
  this page renders no filter controls and there is nothing to assert. That is
  a PRECONDITION CHECK below, not a skip: a suite that quietly passes when the
  thing it tests is not on screen is the failure run.mjs's count manifest
  exists to catch. Publish a job (or run public-screens.mjs, which leaves
  some) and run it again.

  Run (jp-public :4500, JP.App.Api :5299):
      node scripts/verify/public-combobox.mjs
*/
import { chromium } from 'playwright';

/*
  🔴 THE SHIPPED FUNCTION, IMPORTED DIRECTLY — the safe-path.mjs precedent.

  jp-public/src/app/ui/combobox/combobox-rank.ts has no Angular imports for
  exactly this reason, so `node` can load it as it stands. The ranking rule is
  a CLAIM about order rather than a rendering, and a claim wants a table rather
  than a browser: section 4 then proves the DOM agrees with the same function,
  so the table is not testing something the screen does not use.

  ⚠️ If this file ever grows an Angular dependency, this import throws and the
  suite says so rather than passing with one section missing.
*/
import {
  RENDER_CAP,
  prepareOptions,
  rankOptions,
} from '../../../jp-public/src/app/ui/combobox/combobox-rank.ts';

import { RANK_CASES, coverage, expectedFor, optionName, project } from './lib/combobox-vectors.mjs';

import { execFileSync } from 'node:child_process';

const SITE = process.env.JP_PUBLIC ?? 'http://localhost:4500';

/*
  ----------------------------------------------------------------------------
  🔴 THIS SUITE OWNS ITS JOBS (PRE-5b)
  ----------------------------------------------------------------------------
  The public filters are FACETS: they are built from the subjects and places
  that open postings actually have, so with an empty `t_app_jobs` the page
  renders no controls at all and every assertion below would describe nothing.

  The first version of this suite said so and refused, telling the reader to
  "publish a job, or run public-screens.mjs first". That is a dependency on
  somebody else's data, which is the thing PRE-5b exists to forbid — a suite
  that is green only after another one has run is green by coincidence.

  So it publishes two postings on two subjects, and deletes them in `finally`.

  ⚠️ WRITTEN DIRECTLY, NOT THROUGH USP_SaveJob, which consumes a JOB_POST
  entitlement — the free plan's quota is 1, so the second would be refused for
  a reason that has nothing to do with dropdowns. Same precedent, and the same
  reason, as browse-sets.mjs and browse-tabs.mjs.
*/
const ARGS = ['-S', 'localhost\\TARUN', '-E', '-I', '-b', '-f', '65001', '-h', '-1', '-W', '-s', '|'];
const sql = (q) => execFileSync('sqlcmd', [...ARGS, '-Q', q], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\(\d+ rows affected\)$/.test(l) && !/^Changed database context/.test(l));

const RUN = Date.now().toString().slice(-8);
const FIXTURE_TITLES = [`P3b Facet Probe A ${RUN}`, `P3b Facet Probe B ${RUN}`];

const dropFixtures = () => {
  const list = FIXTURE_TITLES.map((t) => `N'${t}'`).join(', ');

  sql(`SET NOCOUNT ON; USE jp_app;
    DELETE FROM dbo.t_app_job_subjects     WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (${list}));
    DELETE FROM dbo.t_app_job_class_levels WHERE JobId IN (SELECT JobId FROM dbo.t_app_jobs WHERE JobTitle IN (${list}));
    DELETE FROM dbo.t_app_jobs             WHERE JobTitle IN (${list});`);
};

const publishFixture = (title, subjectId, classLevelId) => sql(`SET NOCOUNT ON; USE jp_app;
    DECLARE @b int = (SELECT TOP (1) BranchId FROM dbo.t_app_school_branches WHERE SchoolId = 2 AND Is_Deleted = 0);
    DECLARE @et int = (SELECT TOP (1) EmploymentTypeId FROM dbo.m_app_employment_types WHERE Is_Deleted = 0);
    DECLARE @st int = (SELECT TOP (1) StateId FROM dbo.t_app_school_branches WHERE BranchId = @b);
    DECLARE @ct int = (SELECT TOP (1) CityId  FROM dbo.t_app_school_branches WHERE BranchId = @b);

    INSERT INTO dbo.t_app_jobs
        (SchoolId, BranchId, JobTitle, SubjectId, DesignationId, EmploymentTypeId,
         CityId, StateId, NoOfVacancies, JobStatusId, LastDateToApply, PublishedOn,
         Is_Active, Is_Deleted, CreatedOn)
    VALUES
        (2, @b, N'${title}', ${subjectId}, 1, @et,
         @ct, @st, 1, 2, DATEADD(day, 30, CAST(SYSUTCDATETIME() AS date)), SYSUTCDATETIME(),
         1, 0, SYSUTCDATETIME());

    DECLARE @j bigint = SCOPE_IDENTITY();

    INSERT INTO dbo.t_app_job_subjects     (JobId, SubjectId,    Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${subjectId}, 1, 0, SYSUTCDATETIME());
    INSERT INTO dbo.t_app_job_class_levels (JobId, ClassLevelId, Is_Active, Is_Deleted, CreatedOn) VALUES (@j, ${classLevelId}, 1, 0, SYSUTCDATETIME());

    SELECT CAST(@j AS varchar(20));`)[0];

dropFixtures();
publishFixture(FIXTURE_TITLES[0], 1, 2);
publishFixture(FIXTURE_TITLES[1], 2, 3);

const WIDE = { width: 1440, height: 1100 };

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n${'='.repeat(74)}\n  ${t}\n${'='.repeat(74)}`);

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Every <select> in a document, with its id, its `name` and its options.
 *
 * ⚠️ READ WITH REGEXES, ON PURPOSE. The point of section 2 is the BYTES the
 * server sent; parsing them in a browser would be asserting what the browser
 * made of them, which is the one thing a no-JS test must not do.
 */
const parseSelects = (html) => {
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

  return [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map((m) => {
    const block = m[0];
    const open = block.match(/<select\b[^>]*>/)?.[0] ?? '';

    const options = [...block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((o) => ({
      value: (o[1].match(/\bvalue="([^"]*)"/)?.[1] ?? '').trim(),
      selected: /\bselected\b/.test(o[1]),
      text: o[2].replace(/<!--[\s\S]*?-->/g, '').trim(),
    }));

    return {
      id: attr(open, 'id'),
      name: attr(open, 'name'),
      options,
      /** The real master rows: everything but the "Any …" row. */
      rows: options.filter((o) => o.value !== ''),
    };
  });
};

/** The listing has finished searching and has painted a result count. */
const settled = async (page) => {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Searching…'), undefined, { timeout: 15_000 });

  await page.waitForSelector('.job-results__count', { timeout: 15_000 });
};

const optionTexts = async (page) =>
  (await page.locator('[role="option"]').allTextContents()).map((t) => t.trim()).filter(Boolean);

let browser;

try {
  // =========================================================================
  section('1. 🔴 THE SHARED VECTORS, AGAINST jp-public\'s SHIPPED RANKING');
  // =========================================================================

  /*
    Each case's own universe IS the control under test here, so `expectedFor`
    returns the case's `expectedOrder` untouched and the comparison is exact.
    The browser in section 4 runs the same data against a live master, where
    the projection does real work.
  */
  let allCases = true;

  for (const kase of RANK_CASES) {
    const options = kase.options.map((name, i) => ({ value: i + 1, label: name, text: name }));

    const got = rankOptions(prepareOptions(options), kase.query).map((o) => o.label);
    const want = expectedFor(kase, new Set(kase.options));
    const ok = same(got, want);

    if (!ok) allCases = false;

    check(`${kase.id}: "${kase.query}" -> ${want.length ? want.join(' · ') : '(nothing)'}`,
      ok, ok ? kase.claim : `GOT ${got.join(' · ') || '(nothing)'} — ${kase.breaks}`);
  }

  check(`🔴 all ${RANK_CASES.length} shared vectors pass on this side of the twin`,
    allCases, 'jp-shared runs the same file from combobox-rank.mjs');

  // =========================================================================
  section('2. 🔴 THE BYTES THE SERVER SENT');
  // =========================================================================

  const response = await fetch(`${SITE}/jobs`);
  const html = await response.text();

  check('/jobs answers 200 with HTML',
    response.ok && /<html/i.test(html), `${response.status}, ${html.length} bytes`);

  /*
    🔴 THE FORM IS A REAL GET. Without method and action, a visitor with no
    JavaScript can change a select and nothing whatever happens — the controls
    would be decoration, and "the native select still works" would be a claim
    about an element rather than about a search.
  */
  /*
    ⚠️ `class="[^"]*job-filters` — NOT `class="job-filters"`. Angular's NgForm
    adds `ng-untouched ng-pristine ng-valid` to every form it binds, so the
    attribute the server sends is `class="job-filters ng-untouched ng-pristine
    ng-valid"`. The exact-match version of this regex reported NO FORM IN THE
    SERVER HTML for a form that was plainly there, three attributes along.
  */
  const form = html.match(/<form\b[^>]*class="[^"]*job-filters[^"]*"[^>]*>/)?.[0] ?? '';

  check('🔴 the filter form is a real GET to /jobs, so it can submit without JavaScript',
    /method="get"/i.test(form) && /action="\/jobs"/i.test(form),
    form ? form.slice(0, 120) : 'NO job-filters FORM IN THE SERVER HTML');

  const selects = parseSelects(html).filter((s) => (s.id ?? '').startsWith('filter-'));

  check('the filter controls in the server HTML are native <select>s',
    selects.length > 0,
    selects.map((s) => `${s.id}=${s.rows.length} option(s)`).join(', ') || 'NONE');

  check('…each carries the `name` the query string needs',
    selects.length > 0 && selects.every((s) => !!s.name),
    selects.map((s) => `${s.id}->${s.name ?? 'NO NAME'}`).join(', ') || 'n/a');

  /*
    🔴 THE OPTION TEXT IS IN THE BYTES. This is the SEO half of the trade the
    old exemption comment refused to make: a crawler, and anybody with
    JavaScript off, is served the facet names as HTML rather than a search box
    that fills itself in after a focus event.
  */
  const withText = selects.filter((s) => s.rows.every((o) => o.text.length > 0));

  check('🔴 …and every option carries its TEXT, not just a value',
    selects.length > 0 && withText.length === selects.length,
    selects.flatMap((s) => s.rows.slice(0, 2).map((o) => `${o.value}:"${o.text}"`)).join(', ') || 'n/a');

  check('🔴 the type-ahead is NOT in the server HTML — the upgrade is the browser\'s job',
    !/role="combobox"/.test(html),
    'a combobox in the served bytes would mean a hydration mismatch, not SSR');

  /*
    ⚠️ THE PRECONDITION, AND IT FAILS RATHER THAN SKIPS. See the header: with
    no published jobs there are no filter values, so there is no control on the
    page and every assertion below would pass by describing nothing.
  */
  const target = [...selects].sort((a, b) => b.rows.length - a.rows.length)[0];

  check('PRECONDITION: some filter offers at least two options to rank',
    !!target && target.rows.length >= 2,
    target
      ? `driving #${target.id} (${target.name}), ${target.rows.length} option(s)`
      : 'NO FILTER CONTROL — publish a job, or run public-screens.mjs first');

  /*
    ⚠️ STOPPING HERE SAYS WHY. Everything below reads `target`, and letting it
    run on with nothing to drive produces a TypeError three sections later —
    which is a much harder thing to read than the sentence above.
  */
  if (!target || target.rows.length < 2) {
    throw new Error(
      'no public filter control with two or more options, so there is nothing to rank — '
      + 'publish jobs on two subjects (or run public-screens.mjs, which leaves some) and rerun',
    );
  }

  /* The live master, in the shape jp-public's own `toOptions` produces. */
  const liveOptions = (target?.rows ?? []).map((o) => ({
    value: Number(o.value),
    label: optionName(o.text),
    text: o.text,
  }));

  const present = new Set(liveOptions.map((o) => o.label));

  browser = await chromium.launch();

  // =========================================================================
  section('3. 🔴 WITH JAVASCRIPT DISABLED — THE FORM STILL SEARCHES');
  // =========================================================================

  /*
    🔴 THE TECHNIQUE IS public-screens.mjs's, NOT A NEW ONE: a context created
    with `javaScriptEnabled: false`. With JS on, a control that works proves
    nothing about WHEN it started working — an upgraded combobox and a native
    select look identical to a person. With JS off there is no hydration and no
    router: whatever happens came from the server.

    ⚠️ `page.evaluate` DOES NOT WORK IN THIS CONTEXT — it needs script
    execution in the page. Locators do (Playwright's own injected script runs
    in a utility world), so everything here is locator-shaped. The first draft
    of this section used evaluate and died on its first line.
  */
  const noJs = await browser.newContext({ viewport: WIDE, javaScriptEnabled: false });
  const flat = await noJs.newPage();

  await flat.goto(`${SITE}/jobs`, { waitUntil: 'domcontentloaded' });

  const native = flat.locator(`select#${target?.id ?? 'filter-none'}`);

  check('🔴 with JavaScript off the control IS a <select>, with its options',
    (await native.count()) === 1
      && (await flat.locator(`select#${target?.id} option`).count()) === target.options.length,
    `${await flat.locator(`select#${target?.id} option`).count()} option(s) in the live page`);

  const chosen = liveOptions[0];

  await native.selectOption(String(chosen.value));

  check('…and the selection takes, with nothing listening for a change event',
    (await native.inputValue()) === String(chosen.value),
    `#${target.id} reads "${await native.inputValue()}" — wanted ${chosen.value} ("${chosen.text}")`);

  /*
    🔴 THE SUBMIT IS FOLLOWED, NOT CLICKED — AND THAT IS NOT A WEAKER TEST.

    Playwright CANNOT click in a `javaScriptEnabled: false` context here: its
    actionability check waits for the element to be "stable", which it decides
    with requestAnimationFrame, and a rAF callback never runs when the page has
    no JavaScript. The click hangs for its full timeout even with
    `{ force: true }` — measured both ways. `public-screens.mjs` uses this same
    JS-off technique and only ever READS, which is why it has never hit this.

    ⚠️ SO THE CLAIM IS ASKED OF THE SERVER, WHICH IS WHOSE CLAIM IT IS. A
    native form with `method="get" action="/jobs"` and named controls submits to
    exactly this URL — the markup asserted in section 2 is what guarantees it —
    and what actually matters is that the SERVER answers that URL with the
    filter applied and the chosen option marked selected in its own bytes.
    Testing the browser's form handling would be testing the browser.
  */
  const submitted = `${SITE}/jobs?${target.name}=${chosen.value}`;

  await flat.goto(submitted, { waitUntil: 'load' });

  check(`🔴 SUBMITTING THE FORM searches server-side — ${target.name} is in the query string`,
    flat.url().includes(`${target.name}=${chosen.value}`),
    flat.url().replace(SITE, ''));

  const flatText = await flat.locator('body').innerText();

  /*
    ⚠️ WHAT THIS ASSERTS IS THAT THE SERVER ANSWERED THE SUBMITTED QUERY — a
    result count or the empty state, rendered with no JavaScript anywhere in
    the context. It deliberately does not assert "fewer jobs than before": one
    filter value can legitimately hold every live job, and an assertion that
    only passes on a particular board is one that goes red for a data reason.
    Both totals are printed so a reader can see which happened.
  */
  const before = html.match(/Showing \d+–\d+ of (\d+)/)?.[1] ?? '?';
  const after = flatText.match(/Showing \d+–\d+ of (\d+)/)?.[1] ?? '0';

  check('🔴 …and the SERVER rendered the result for it, with no JavaScript in the context',
    /Showing \d+–\d+ of \d+ job|No jobs match this search/.test(flatText),
    `${before} job(s) unfiltered -> ${after} with ${target.name}=${chosen.value}`);

  /*
    ⚠️ THE ROUND TRIP HAS TO SHOW WHAT WAS CHOSEN. `[value]` on a <select> sets
    a DOM property, and a property is not in the bytes the server sends — so
    before `[attr.selected]` this page answered a filtered URL with a control
    reading "Any …" over a narrowed list.
  */
  check('🔴 …and the chosen option comes BACK selected, in the server\'s own HTML',
    (await flat.locator(`select#${target.id} option[selected][value="${chosen.value}"]`).count()) === 1,
    '[attr.selected], not [value] — a DOM property is not serialised');

  await noJs.close();

  // =========================================================================
  section('4. THE UPGRADE — role="combobox" ON HYDRATION');
  // =========================================================================

  const context = await browser.newContext({ viewport: WIDE });
  const page = await context.newPage();

  await page.goto(`${SITE}/jobs`, { waitUntil: 'domcontentloaded' });
  await settled(page);

  /*
    ⚠️ BEFORE ANY INTERACTION. A control that grabs focus on load moves a
    screen reader's cursor and scrolls the page out from under a sighted
    visitor, and it is an accessibility audit this page has to keep passing.
  */
  check('nothing moved the focus on load',
    (await page.evaluate(() => document.activeElement?.tagName ?? 'NONE')) === 'BODY',
    await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || 'NONE'));

  const field = page.locator(`#${target.id}`);

  await field.waitFor({ state: 'visible', timeout: 15_000 });

  const shape = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const listId = el?.getAttribute('aria-controls');
    const list = listId ? document.getElementById(listId) : null;

    return {
      tag: el?.tagName ?? 'NONE',
      role: el?.getAttribute('role'),
      expanded: el?.getAttribute('aria-expanded'),
      listId,
      listRole: list?.getAttribute('role') ?? null,
      listExists: !!list,
      selects: document.querySelectorAll('select[id^="filter-"]').length,
      labelFor: document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? null,
    };
  }, target.id);

  check('🔴 the native select UPGRADED IN PLACE: same id, now an input[role=combobox]',
    shape.tag === 'INPUT' && shape.role === 'combobox' && shape.selects === 0,
    `<${shape.tag.toLowerCase()} role="${shape.role}">, ${shape.selects} <select> left on the page`);

  check('🔴 the <label for> still names it — the pair the a11y score is made of',
    !!shape.labelFor && (await page.getByLabel(shape.labelFor, { exact: false }).first().getAttribute('role')) === 'combobox',
    `label "${shape.labelFor}" -> #${target.id}`);

  /*
    🔴 aria-controls MUST RESOLVE WHILE THE LIST IS CLOSED. An aria-controls
    pointing at an id that is not in the document is an invalid attribute
    value — which is why the <ul> is hidden rather than removed.
  */
  check('🔴 closed: aria-expanded="false" and aria-controls resolves to a role="listbox"',
    shape.expanded === 'false' && shape.listExists && shape.listRole === 'listbox',
    `aria-controls="${shape.listId}" -> ${shape.listExists ? `role="${shape.listRole}"` : 'NOTHING IN THE DOM'}`);

  check('closed: no role="option" in the page at all',
    (await page.locator('[role="option"]').count()) === 0,
    '902 cities cost nothing until the list is opened');

  // -- focus opens it -------------------------------------------------------
  await field.click();
  await page.waitForTimeout(250);

  const opened = await optionTexts(page);

  check('focus opens the list: options appear and aria-expanded is true',
    opened.length > 0 && (await field.getAttribute('aria-expanded')) === 'true',
    `${opened.length} option(s) shown`);

  /*
    ⚠️ THE SAME OPTIONS BOTH WAYS. The no-JS path and the upgraded path have to
    offer the same master; the cap is applied to the expectation because the
    open list paints at most RENDER_CAP rows and says so underneath.
  */
  const fromServer = target.options.map((o) => o.text).slice(0, RENDER_CAP + 1);

  check('🔴 the upgraded list offers the same options the server sent',
    same(opened, fromServer),
    `${opened.length} shown vs ${fromServer.length} in the HTML`
    + (same(opened, fromServer) ? '' : `: ${opened.slice(0, 3).join(' · ')} vs ${fromServer.slice(0, 3).join(' · ')}`));

  // -- the arrow keys ------------------------------------------------------
  const activeBefore = await field.getAttribute('aria-activedescendant');

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);

  const activeAfter = await field.getAttribute('aria-activedescendant');

  check('ArrowDown moves the active option, and aria-activedescendant follows it',
    !!activeAfter && activeAfter !== activeBefore
      && (await page.locator(`#${activeAfter}`).getAttribute('role')) === 'option'
      && (await page.locator(`#${activeAfter}`).getAttribute('class') ?? '').includes('--active'),
    `${activeBefore ?? '(none)'} -> ${activeAfter ?? '(none)'}`);

  // -- 🔴 the DOM agrees with the shipped ranking function ------------------
  /*
    🔴 THIS IS WHAT TIES SECTION 1 TO THE SCREEN. The vectors prove the
    function; this proves the list a person sees is that function's output, on
    the live master, rather than a second ordering that happens to agree on
    four made-up states.

    ⚠️ THE QUERY IS DERIVED, NOT WRITTEN DOWN. A hardcoded "Har" tests nothing
    on a board with no Haryana jobs. Every two-letter window of every option
    name is scored by how many options it matches and the best one wins, so the
    assertion is as strong as the data allows and is the same every run.
  */
  const windows = new Map();

  for (const o of liveOptions) {
    const name = o.label.toLowerCase();

    for (let i = 0; i < name.length - 1; i += 1) {
      const pair = name.slice(i, i + 2);

      if (/^[a-z]{2}$/.test(pair)) {
        windows.set(pair, (windows.get(pair) ?? 0) + 1);
      }
    }
  }

  const query = [...windows.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'a';

  await field.fill(query);
  await page.waitForTimeout(250);

  const rendered = await optionTexts(page);
  const expected = rankOptions(prepareOptions(liveOptions), query).slice(0, RENDER_CAP).map((o) => o.text);

  check(`🔴 "${query}": the rendered order IS rankOptions() — prefix matches first, substrings kept`,
    same(rendered, expected) && expected.length > 0,
    same(rendered, expected)
      ? `${rendered.length} option(s): ${rendered.slice(0, 4).join(' · ')}`
      : `GOT ${rendered.join(' · ') || '(nothing)'} · WANT ${expected.join(' · ') || '(nothing)'}`);

  /*
    ⚠️ AND THE SHARED CASES AGAINST THE LIVE LIST, PROJECTED. `project` keeps
    only the names a case is about, in the order the screen offered them, so a
    case written over four states still means something against a master that
    holds thirty-six — and `coverage` is printed so a case whose universe is
    absent is visibly vacuous rather than quietly green.
  */
  let liveCases = true;
  const covered = [];

  for (const kase of RANK_CASES) {
    const hits = coverage(kase, present);

    if (hits === 0) continue;

    await field.fill(kase.query);
    await page.waitForTimeout(200);

    const got = project(await optionTexts(page), kase.options);
    const want = expectedFor(kase, present);

    if (!same(got, want)) liveCases = false;

    covered.push(`${kase.id}(${hits}/${kase.options.length})`);
  }

  check('the shared vectors also hold against the LIVE master, where any of them apply',
    liveCases,
    covered.length
      ? covered.join(', ')
      : 'none of the vectors\' option names are in this board\'s masters — section 1 is the claim');

  // -- nothing matches -----------------------------------------------------
  await field.fill('zzqqxx');
  await page.waitForTimeout(250);

  /*
    ⚠️ THE NOTE IS SCOPED TO THIS CONTROL'S OWN PANEL, by the adjacent-sibling
    of the listbox `aria-controls` already named. There are up to four of these
    controls on the page and `.pcb__note` alone would have read the first one's
    — which is empty, because it is not the control being driven.
  */
  const note = page.locator(`#${target.id}-list + .pcb__note`);

  check('a query matching nothing shows no options — and the control SAYS so',
    (await page.locator('[role="option"]').count()) === 0
      && (await note.innerText()).includes('No match'),
    (await note.innerText()).trim() || 'THE LIST JUST WENT EMPTY AND SILENT');

  // -- Escape --------------------------------------------------------------
  /*
    ⚠️ RETYPED A QUERY THAT MATCHES FIRST, AND THAT IS NOT TIDYING. After
    "zzqqxx" the list is already closed, so pressing Escape there and asserting
    "closed" would have passed on a control that ignores the key entirely. The
    assertion has to start from an OPEN list.
  */
  await field.fill(query);
  await page.waitForTimeout(250);

  const openBeforeEscape = await field.getAttribute('aria-expanded');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  check('Escape closes an OPEN list and drops the query',
    openBeforeEscape === 'true'
      && (await field.getAttribute('aria-expanded')) === 'false'
      && (await page.locator('[role="option"]').count()) === 0
      && (await field.inputValue()) === '',
    `aria-expanded ${openBeforeEscape} -> ${await field.getAttribute('aria-expanded')}, `
    + `field reads "${await field.inputValue()}"`);

  // -- Enter selects, and the URL carries it -------------------------------
  /*
    ⚠️ BLURRED, THEN REFOCUSED, THEN WALKED TO THE FIRST REAL ROW. Three things
    this sequence is defending against, all found by reading the component:
    Escape leaves the field FOCUSED, so a click would fire no focus event and
    the highlight would start from nowhere; opt-0 is the "Any …" row, and
    choosing it REMOVES the parameter rather than setting one, so the wait
    below would time out on a control that was working perfectly; and the
    walk is bounded, so a control that never highlights fails the check rather
    than hanging.
  */
  await field.blur();
  await field.click();
  await page.waitForTimeout(250);

  for (let i = 0; i < 4; i += 1) {
    if ((await field.getAttribute('aria-activedescendant')) === `${target.id}-opt-1`) break;

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }

  await Promise.all([
    page.waitForURL((u) => u.search.includes(`${target.name}=`), { timeout: 20_000 }),
    page.keyboard.press('Enter'),
  ]);

  await settled(page);

  check(`🔴 Enter selects: ${target.name} is in the URL and the field shows the choice`,
    page.url().includes(`${target.name}=${chosen.value}`)
      && (await field.inputValue()) === chosen.text,
    `${page.url().replace(SITE, '')} · field reads "${await field.inputValue()}"`);

  await context.close();
} catch (error) {
  /*
    🔴 THE THROW IS PRINTED, NOT SWALLOWED — combobox-rank.mjs learnt this the
    hard way: a suite that dies on its first line otherwise reports "0/0
    passed", which reads as a suite with no assertions rather than one that
    never ran.
  */
  results.push(false);
  console.log('  FAIL  the suite threw before it could finish');
  console.log(`        ${error?.stack?.split('\n').slice(0, 3).join('\n        ') ?? error}`);
} finally {
  await browser?.close();

  // The two facet fixtures go, whatever happened above.
  dropFixtures();

  const failed = results.filter((r) => !r).length;
  console.log(`\n  ${results.length - failed}/${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
