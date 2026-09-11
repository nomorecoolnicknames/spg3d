// Tiny dependency-free static server for dist/ (SPA fallback, correct MIME types).
// Usage: node scripts/serve.mjs [--dir dist] [--port 0]   (port 0 = pick a free one)
// Also importable: `import { serve } from './serve.mjs'` → { port, close() }.
import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export function serve({ dir = 'dist', port = 0, quiet = false } = {}) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let file = normalize(join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback for navigation requests; 404 for assets
      if (!extname(urlPath) || urlPath.endsWith('.html')) file = join(root, 'index.html');
      else {
        res.writeHead(404);
        res.end('not found');
        return;
      }
    }
    const st = statSync(file);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    };
    // byte ranges (audio seeking)
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, { ...headers, 'Accept-Ranges': 'bytes' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveP, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      if (!quiet) console.log(`serving ${root} at http://127.0.0.1:${p}`);
      resolveP({ port: p, url: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  serve({ dir: get('--dir', 'dist'), port: Number(get('--port', 0)) });
}
