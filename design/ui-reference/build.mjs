// Сборка портала: node build.mjs          → production-сборка в dist/
//                 node build.mjs --serve  → локальный сервер разработки http://localhost:5173
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const serve = process.argv.includes('--serve');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/assets`, { recursive: true });
await cp('public', outdir, { recursive: true });

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' },
  legalComments: 'none',
  logLevel: 'info',
};

async function writeHtml(js, css) {
  const tpl = await readFile('index.html', 'utf8');
  const html = tpl
    .replace('<!-- styles -->', `<link rel="stylesheet" href="/assets/${css}" />`)
    .replace('<!-- scripts -->', `<script src="/assets/${js}"></script>`);
  await writeFile(`${outdir}/index.html`, html);
}

if (serve) {
  const ctx = await esbuild.context({ ...options, outfile: `${outdir}/assets/app.js` });
  await writeHtml('app.js', 'app.css');
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5173, fallback: `${outdir}/index.html` });
  console.log(`\n  Портал: http://localhost:${port}\n`);
} else {
  const result = await esbuild.build({ ...options, outfile: `${outdir}/assets/app.js`, write: false });
  const files = {};
  for (const f of result.outputFiles) {
    const ext = f.path.endsWith('.css') ? 'css' : 'js';
    const hash = createHash('sha256').update(f.contents).digest('hex').slice(0, 10);
    const name = `app-${hash}.${ext}`;
    await writeFile(`${outdir}/assets/${name}`, f.contents);
    files[ext] = name;
  }
  await writeHtml(files.js, files.css);
  console.log('Готово: dist/', files);
}
