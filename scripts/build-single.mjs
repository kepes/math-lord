// Builds the game into self-contained files (same recipe as the Gardrób VR viewer):
//   dist-single.html    one complete page – put it on any static HTTPS host and open it in the headset
//   dist-artifact.html  the same page without the <html>/<head>/<body> shell, for hosts that add their own
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { build } from 'vite';

const outDir = 'dist-single';
await build({
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { codeSplitting: false } },
  },
});

const assets = readdirSync(`${outDir}/assets`);
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.length}`);

const script = readFileSync(`${outDir}/assets/${js[0]}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css.map((f) => readFileSync(`${outDir}/assets/${f}`, 'utf8')).join('\n');
const favicon = `data:image/svg+xml;base64,${readFileSync('public/favicon.svg').toString('base64')}`;

const built = readFileSync(`${outDir}/index.html`, 'utf8')
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*href="\.[^"]*"[^>]*>/g, '')
  .replace(/href="\.\/favicon\.svg"/, `href="${favicon}"`);

const page = built
  .replace('</head>', () => `<style>${style}</style></head>`)
  .replace('</body>', () => `<script type="module">${script}</script></body>`);

const title = /<title>(.*?)<\/title>/.exec(built)?.[1] ?? 'Math Lord';
const fonts = /<link[^>]*fonts\.googleapis\.com[^>]*>/.exec(built)?.[0] ?? '';
const body = /<body>([\s\S]*)<\/body>/.exec(built)?.[1].trim() ?? '';
const fragment = [
  `<title>${title}</title>`,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  `<style>${style}</style>`,
  body,
  `<script type="module">${script}</script>`,
  '',
].join('\n');

rmSync(outDir, { recursive: true, force: true });
writeFileSync('dist-single.html', page);
writeFileSync('dist-artifact.html', fragment);
console.log(`dist-single.html  ${(page.length / 1024).toFixed(0)} kB`);
