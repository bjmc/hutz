import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const toDataUri = async (rel: string, mime: string): Promise<string> => {
  const buf = await Bun.file(resolve(ROOT, rel)).arrayBuffer();
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
};

const plate = await toDataUri('assets/card/plate.jpg', 'image/jpeg');
const font = await toDataUri('assets/fonts/card-italic.woff2', 'font/woff2');

const built = await Bun.build({
  entrypoints: [resolve(ROOT, 'src/main.ts')],
  target: 'browser',
  format: 'esm',
  minify: true,
  define: { __PLATE_URL__: JSON.stringify(plate) },
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const js = await built.outputs[0]!.text();

// the stylesheet references the font by path; inline it so the file stands alone
const css = (await Bun.file(resolve(ROOT, 'src/app.css')).text()).replace(
  /url\('\.\.\/assets\/fonts\/card-italic\.woff2'\)/,
  `url('${font}')`,
);

const html = (await Bun.file(resolve(ROOT, 'index.html')).text())
  .replace(
    '<link rel="stylesheet" href="./src/app.css" />',
    `<style>${css}</style>`,
  )
  .replace(
    '<script type="module" src="./src/main.ts"></script>',
    `<script type="module">${js}</script>`,
  );

await Bun.write(resolve(ROOT, 'dist/index.html'), html);

const boundary = '----=_hutz_' + Date.now().toString(36);
const mhtml = [
  'MIME-Version: 1.0',
  `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
  '',
  `--${boundary}`,
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: 8bit',
  '',
  html,
  `--${boundary}--`,
  '',
].join('\r\n');

await Bun.write(resolve(ROOT, 'dist/money-down.mhtml'), mhtml);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`dist/index.html       ${kb(html.length)}`);
console.log(`dist/money-down.mhtml ${kb(mhtml.length)}`);
