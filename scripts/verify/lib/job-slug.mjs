/*
  The slug of a live public job, for scripts that need to visit /jobs/:slug.

  ----------------------------------------------------------------------------
  🔴 WHY THIS IS SHARED RATHER THAN COPIED INTO EACH SCRIPT
  ----------------------------------------------------------------------------
  lh.mjs and site-audit.mjs both need a job detail URL, and a job's path
  contains its uid — so neither can hold a literal. Two copies of this would be
  two things to fix when the slug shape changes, and G27's lesson is that the
  dangerous copy is the one nobody knows about.

  ⚠️ IT MIRRORS jobSlug() IN jp-public/src/app/core/public-api.service.ts, and
  that mirroring is the one real risk here: if the app's slug shape changes and
  this does not, these scripts build a URL that resolves anyway — the trailing
  uid is what the app looks up, and the words in front are decoration. So the
  failure mode is a cosmetically wrong URL that still audits the right page,
  which is the mildest version of this problem available.
*/
const API = process.env.JP_APP_API ?? 'http://localhost:5299/api';

/**
 * @returns the slug of any live public job, or null when there are none.
 */
export async function discoverJobSlug() {
  const response = await fetch(`${API}/public/jobs?pageSize=1`);

  if (!response.ok) return null;

  const payload = await response.json();
  const job = payload?.data?.[0];

  if (!job) return null;

  const words = job.jobTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');

  return words ? `${words}-${job.jobUid}` : job.jobUid;
}
