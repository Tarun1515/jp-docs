/**
 * Proves that a DEEPLY NESTED component's SCSS resolves `@use 'variables'`
 * through stylePreprocessorOptions to ../jp-shared/src/styles — which is where
 * the original post-split failure came from. A top-level component compiling
 * proves nothing about this.
 *
 * For each app: find the deepest component .scss that uses the shared partials,
 * then confirm its compiled CSS made it into the build output carrying a value
 * that exists ONLY in jp-shared's tokens.
 */
import fs from 'node:fs';
import path from 'node:path';

const APPS = process.argv.slice(2);

// Values that appear only in jp-shared/src/styles/_variables.scss.
const SHARED_ONLY = ['#234a40', '#17332c', '#0e1c18', '#a9302a', 'Bricolage Grotesque'];

function walk(dir, filter, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, acc);
    else if (filter(e.name)) acc.push(full);
  }
  return acc;
}

for (const app of APPS) {
  console.log(`\n${'='.repeat(72)}\n${app}`);

  const scss = walk(path.join(app, 'src/app'), (n) => n.endsWith('.scss'))
    .filter((f) => /@use\s+'(variables|mixins)'/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => ({ f, depth: path.relative(app, f).split(path.sep).length }))
    .sort((a, b) => b.depth - a.depth);

  if (!scss.length) {
    console.log('  🔴 no component SCSS uses the shared partials at all');
    continue;
  }

  const deepest = scss[0];
  const rel = path.relative(app, deepest.f).replace(/\\/g, '/');
  console.log(`  deepest consumer : ${rel}`);
  console.log(`  nesting depth    : ${deepest.depth} path segments`);
  console.log(
    `  its @use lines   : ${
      fs
        .readFileSync(deepest.f, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('@use'))
        .join(' | ') || '(none)'
    }`,
  );
  console.log(`  total deep consumers (depth >= 5): ${scss.filter((s) => s.depth >= 5).length}`);

  // Did its CSS reach the build output, with shared token values in it?
  const base = path.basename(deepest.f, '.scss');
  const outDir = path.join(app, 'dist');
  const outputs = walk(outDir, (n) => n.endsWith('.js') || n.endsWith('.css'));
  const hit = outputs.filter((o) => {
    const s = fs.readFileSync(o, 'utf8');
    return s.includes(base) || s.includes(base.replace('.component', ''));
  });

  const tokenCarriers = outputs.filter((o) => {
    const s = fs.readFileSync(o, 'utf8');
    return SHARED_ONLY.some((v) => s.toLowerCase().includes(v.toLowerCase()));
  });

  console.log(`  compiled into    : ${hit.length ? path.relative(app, hit[0]) : '🔴 NOT FOUND'}`);
  console.log(
    `  shared token values present in output: ${
      tokenCarriers.length ? '✔ ' + path.relative(app, tokenCarriers[0]) : '🔴 none'
    }`,
  );
}
