#!/usr/bin/env node
/**
 * Zero-dependency local development server for frontend/.
 *
 *   npm run dev              -> http://127.0.0.1:5173
 *   PORT=8080 npm run dev    -> http://127.0.0.1:8080
 *
 * Serves static files only, the same way GitHub Pages does. Binds to 127.0.0.1
 * so the dev site is not exposed on the local network. No caching, so edits
 * show on reload.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_ROOT = resolve(fileURLToPath(new URL('../frontend/', import.meta.url)));

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});

/**
 * Map a request URL path to a file inside `root`, or null if it would escape
 * `root` (path traversal) or is otherwise invalid.
 * @param {string} urlPath  e.g. '/js/main.js?v=1'
 * @param {string} root     absolute directory
 * @returns {string | null}
 */
export function resolveSafePath(urlPath, root = FRONTEND_ROOT) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const full = resolve(root, '.' + normalize(pathname));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (full !== root && !full.startsWith(rootWithSep)) return null;
  return full;
}

/**
 * @param {string} root
 */
export function createDevServer(root = FRONTEND_ROOT) {
  return createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed');

    const filePath = resolveSafePath(req.url ?? '/', root);
    if (!filePath) return send(400, 'Bad Request');

    try {
      const info = await stat(filePath);
      const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
      const body = await readFile(target);
      const type = MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return send(404, 'Not Found');
      console.error('[serve] error serving', req.url, err);
      return send(500, 'Internal Server Error');
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 5173);
  const host = '127.0.0.1';
  const server = createDevServer();
  server.on('error', (err) => {
    console.error(`[serve] could not start on ${host}:${port}: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`ORB Research dev server: http://${host}:${port}/  (serving ${FRONTEND_ROOT})`);
  });
}
