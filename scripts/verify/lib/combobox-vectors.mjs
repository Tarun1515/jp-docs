/*
  🔴 ONE FILE, TWO COMPONENTS: WHAT A SEARCHABLE SELECT SHOWS AND IN WHAT
  ORDER, HELD AS DATA. P3b.

  ----------------------------------------------------------------------------
  WHY THIS FILE EXISTS
  ----------------------------------------------------------------------------
  There are now TWO searchable selects in this product, deliberately:

      jp-shared/src/ui/ui-combobox/ui-combobox.component.ts   (G27's one)
      jp-public/src/app/ui/combobox/                          (2.43's second)

  jp-public is UNFEDERATED by decision (2.43) — no jp-shared tsconfig path, no
  federation config, not a line of shared JavaScript — so the public site
  cannot import the shared control, and 902 towns in a native dropdown on the
  most public page the product has could not wait for that decision to be
  reversed.

  G27 forbids a second implementation NOBODY KNOWS ABOUT. The way this one is
  known about is this file: the BEHAVIOUR is asserted in one place and the CODE
  stays separate. Each side's suite runs these cases against its own component:

      combobox-rank.mjs     jp-shared's, in a browser, on jp-teacher /profile
      public-combobox.mjs   jp-public's, against its shipped ranking function
                            and then in a browser on /jobs

  So changing the rule in either component turns the OTHER repository's suite
  red, and adding a case here obliges both sides to answer it.

  ⚠️ THE DATA IS THE CONTRACT. The helpers below exist only because the two
  controls render their options differently — jp-public appends a live job
  count, "Haryana (3)" — and a vector file that could only be read by one of
  them would not be a shared vector file. There is deliberately NO ranking
  implementation here: an oracle written a third time would just be a third
  thing to keep in step.

  ----------------------------------------------------------------------------
  🔴 THE RULE THESE CASES PIN DOWN
  ----------------------------------------------------------------------------
    1. The filter is CONTAINS, case-insensitively, on the option's NAME.
    2. Options whose name STARTS WITH the query come first.
    3. Within each of those two tiers, the master's own order is kept.
    4. Nothing is filtered out by (2) — only the order moves.

  ⚠️ THERE IS NO EXACT-MATCH TIER, and `exact-name-is-not-buried` is written to
  state that rather than to hide it. Typing a name in full puts it in the
  prefix tier with every longer name that starts the same way, in master order.
  A case asserting "exact always first" would be asserting behaviour neither
  component has and both would have to grow.
*/

/**
 * Every case: options in (a plausible) master order, a query, and the exact
 * order expected back.
 *
 * `claim` is what a reader learns from the case; `breaks` is what shipping the
 * opposite would mean. A table of inputs and outputs says nothing about why
 * "aryan" is in it.
 */
export const RANK_CASES = [
  {
    id: 'har-prefix-outranks-substring',
    query: 'Har',
    options: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    expectedOrder: ['Haryana', 'Bihar', 'Jharkhand', 'Maharashtra'],
    claim: 'the one prefix match leads, and the three substring matches stay, below it',
    breaks:
      'ordering by the master DisplayOrder puts BIHAR first — found in a walkthrough '
      + 'screenshot, on the screen where the wrong state invalidates every geography '
      + 'field under it',
  },
  {
    id: 'aryan-substring-only-still-matches',
    query: 'aryan',
    options: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    expectedOrder: ['Haryana'],
    claim: '🔴 the filter is CONTAINS: a query that starts nothing still finds its option',
    breaks:
      'the cheap fix for the case above is startsWith, which passes it and empties '
      + 'this one — a user typing the middle of a name is told their state does not exist',
  },
  {
    id: 'chopta-second-word-of-a-two-word-town',
    query: 'chopta',
    options: ['Nathusari Chopta', 'Chopta'],
    expectedOrder: ['Chopta', 'Nathusari Chopta'],
    claim:
      'a lowercase query matches capitalised names, and the town that IS "Chopta" '
      + 'outranks the one that merely ends with it',
    breaks:
      'SR-1 seeded 902 towns and plenty are two words. Typing the second word is '
      + 'the normal case, not an edge one — this is the example jp-shared\'s own '
      + 'component header cites',
  },
  {
    id: 'exact-name-is-not-buried',
    query: 'Delhi',
    options: ['New Delhi', 'Delhi', 'Delhi Cantonment'],
    expectedOrder: ['Delhi', 'Delhi Cantonment', 'New Delhi'],
    claim:
      'a fully typed name leads: it shares the prefix tier with "Delhi Cantonment" '
      + 'in master order, and "New Delhi" — which only contains it — sits below both. '
      + '⚠️ it leads because the master lists it first, NOT because exact matches are '
      + 'a tier of their own; neither component has one',
    breaks:
      'with no ranking at all, typing the capital\'s name in full offers New Delhi '
      + 'first and the capital second',
  },
  {
    id: 'nothing-matches',
    query: 'zzqqxx',
    options: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    expectedOrder: [],
    claim: 'a query matching nothing returns nothing — and the control has to SAY so',
    breaks:
      'a list that falls back to everything when nothing matches reads as "your '
      + 'typing was ignored", and the next thing pressed is the wrong option',
  },
  {
    id: 'empty-query-shows-everything',
    query: '',
    options: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    expectedOrder: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    claim: 'opening the control shows the whole master, in its own order',
    breaks:
      'a searchable select that shows nothing until you type is a worse control '
      + 'than the <select> it replaced — browsing is still how most people pick a state',
  },
  {
    id: 'whitespace-is-not-a-query',
    query: '   ',
    options: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    expectedOrder: ['Bihar', 'Haryana', 'Jharkhand', 'Maharashtra'],
    claim: 'the query is trimmed: a space is not something to match on',
    breaks:
      'without the trim, "Jharkhand " (a trailing space, which a paste or a '
      + 'space-bar nudge produces) matches nothing at all',
  },
];

/**
 * An option's NAME, from whatever the control rendered.
 *
 * ⚠️ THIS IS THE WHOLE REASON THE HELPERS EXIST. jp-public's filters append a
 * live job count to every option — "Haryana (3)" — because the count is useful
 * on a public job board. jp-shared's render the bare label. The vectors are
 * written in names, so both are read through this.
 *
 * ⚠️ It strips a trailing "(number)" ONLY. A town legitimately called
 * "Chopta (Deh)" keeps its parenthesis, and a count is always digits.
 */
export const optionName = (text) => String(text).replace(/\s*\(\d+\)\s*$/, '').trim();

/**
 * The names a control actually offered, reduced to the ones a case is about,
 * IN THE ORDER THEY WERE OFFERED.
 *
 * 🔴 WHY A PROJECTION RATHER THAN A DIRECT COMPARISON. A browser suite types
 * into a control fed by the live master, which holds 36 states and not the
 * four a case names. Filtering the observed list down to the case's own
 * universe leaves exactly the ranking claim, with the live master's other rows
 * removed rather than ignored — so the same case can be asserted against four
 * options in memory and against a real screen.
 */
export const project = (observed, universe) => {
  const wanted = new Set(universe.map(optionName));

  return observed.map(optionName).filter((name) => wanted.has(name));
};

/**
 * The expected order, reduced to the names the control under test can show.
 *
 * `present` is the set of ALL names that control offers (read once with an
 * empty query), NOT the filtered result. For an in-memory run it is the case's
 * own universe and this returns `expectedOrder` unchanged.
 *
 * ⚠️ A CASE WHOSE UNIVERSE IS MOSTLY ABSENT PASSES VACUOUSLY. Use `coverage`
 * and print it: "Delhi Cantonment" is not in the state master, so the exact
 * case degrades to a weaker claim there, and a suite that did not say so would
 * be reporting a pass for a test that compared one name to itself.
 */
export const expectedFor = (kase, present) =>
  kase.expectedOrder.filter((name) => present.has(optionName(name)));

/** How many of a case's options the control under test actually holds. */
export const coverage = (kase, present) =>
  kase.options.filter((name) => present.has(optionName(name))).length;
