/**
 * Lightweight production server for MEATBASH.
 *
 * Serves the built `dist/` directory with Bun so deployment stays on Bun +
 * systemd without introducing Node-specific process managers.
 */

import { resolve, extname } from 'path';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const HOST = process.env.HOST ?? '0.0.0.0';
const distDir = resolve(import.meta.dir, '..', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function toSafePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded === '/' || decoded === '') return resolve(distDir, 'index.html');

  const candidate = resolve(distDir, `.${decoded}`);
  if (!candidate.startsWith(distDir)) return null;
  return candidate;
}

function buildHeaders(pathname: string): HeadersInit {
  const extension = extname(pathname);
  const headers = new Headers();
  headers.set('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream');

  if (extension === '.html') {
    headers.set('Cache-Control', 'no-cache');
  } else {
    headers.set('Cache-Control', 'public, max-age=3600');
  }

  return headers;
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const safePath = toSafePath(url.pathname);
    if (!safePath) {
      return new Response('Bad request', { status: 400 });
    }

    const file = Bun.file(safePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: buildHeaders(safePath),
      });
    }

    // Single-page shell fallback for non-file routes.
    if (!extname(url.pathname)) {
      const indexFile = Bun.file(resolve(distDir, 'index.html'));
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: buildHeaders('index.html'),
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`🥩 MEATBASH production server running at http://${HOST}:${server.port}`);
