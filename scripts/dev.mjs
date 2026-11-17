// The dev loop: rebuild dist/ on every change, and serve the repo (manifest and dist/) with CORS, so a local
// PotentialPaper can load it under /settings/plugins → "Load from localhost". Usage: npm run dev [-- <port>]
import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5175);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

spawn('npx', ['vite', 'build', '--watch'], { cwd: root, stdio: 'inherit' });

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'potentialpaper-plugin.json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  let ok = false;
  try {
    ok = file.startsWith(root) && !path.startsWith('node_modules') && statSync(file).isFile();
  } catch {}
  if (!ok) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`score standing: http://localhost:${port}/ (load it from /settings/plugins)`));
