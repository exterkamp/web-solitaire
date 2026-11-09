// Serves the production build the way deploy/nginx.conf does, for trying a
// build on a phone without the container: files as they are, and any page
// path with no file of its own - /play/klondike, /nertz - answered with
// index.html, so a reload lands back on the page it was on. (A bare
// `python3 -m http.server` has no such fallback and 404s every reload.)
//
//   node tools/serve-dist.mjs            # PORT from the env, default 4380
//   devrun up --name sol-felt --port-env PORT -- node tools/serve-dist.mjs
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist/web-solitaire/browser');
const port = Number(process.env.PORT ?? 4380);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function send(res, file, status = 200) {
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // The service worker and the page must never be stale; hashed assets may be.
    'Cache-Control': /\.(html|json|webmanifest)$|ngsw-worker\.js$/.test(file) ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    // A malformed escape (/%E0%A4%A) is the client's mistake, not a reason
    // for the server to fall over.
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad request');
    return;
  }
  const file = normalize(join(root, path));
  // Inside the build, exactly: a plain prefix check would let
  // /../browser-old/ through, since that path starts with the root's name too.
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isFile()) {
    send(res, file);
  } else if (!extname(path)) {
    // A page path: the app's own router decides what it is.
    send(res, join(root, 'index.html'));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
  console.log(`${req.method} ${path} ${res.statusCode}`);
}).listen(port, '0.0.0.0', () => console.log(`serving ${root} on 0.0.0.0:${port}`));
