// Mini statický server pro lokální hraní a testy: node tools/serve.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(root, path || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2]) || 8080;
  await startServer(port);
  console.log(`Hra běží na http://127.0.0.1:${port}`);
}
