import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 5173);

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  ts: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  woff2: 'font/woff2',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
};

const dataUri = async (rel: string, mime: string): Promise<string> => {
  const buf = await Bun.file(resolve(ROOT, rel)).arrayBuffer();
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
};

async function bundleMain(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [resolve(ROOT, 'src/main.ts')],
    target: 'browser',
    format: 'esm',
    sourcemap: 'inline',
  });
  if (!built.success) {
    const detail = built.logs.map(log => log.message).join('\n');
    return `console.error(${JSON.stringify(detail)});`;
  }
  return built.outputs[0]!.text();
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // QA hook: the browser posts its canvas here and we drop a PNG on disk
    if (path === '/__snapshot' && req.method === 'POST') {
      const b64 = await req.text();
      const raw = b64.replace(/^data:image\/png;base64,/, '');
      const name = url.searchParams.get('name') ?? 'shot';
      await Bun.write(resolve(ROOT, 'preview', `${name}.png`),
        Buffer.from(raw, 'base64'));
      return new Response('ok');
    }

    if (path === '/src/main.ts') {
      return new Response(await bundleMain(), {
        headers: { 'content-type': MIME.js!, 'cache-control': 'no-store' },
      });
    }

    const file = Bun.file(resolve(ROOT, '.' + path));
    if (await file.exists()) {
      const ext = path.split('.').pop() ?? '';
      return new Response(file, {
        headers: {
          'content-type': MIME[ext] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      });
    }
    return new Response('not found', { status: 404 });
  },
});

console.log(`http://localhost:${PORT}`);
