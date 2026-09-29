// Bundles src/ (+ three.js) into a single self-contained HTML file.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, process.argv[2] || '../ocean-cleanup-3d.html');
const res = await build({
  entryPoints: [resolve(here, 'src/main.js')],
  bundle: true, minify: true, format: 'iife', target: ['es2020'], write: false, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(here, 'src/index.html'), 'utf8').replace('/*__BUNDLE__*/', () => js);
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
