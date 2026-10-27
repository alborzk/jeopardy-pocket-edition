import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface HttpOptions {
  /** Built client (apps/client/dist). null when it has not been built, e.g. in development. */
  staticDir: string | null;
  info: () => { lanAddresses: string[]; rooms: number };
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const headers: Record<string, string> = {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    // Vite fingerprints everything under /assets, so it can be cached for good.
    'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res);
}

/** Serves the built client and a couple of small JSON endpoints. Socket.IO attaches separately. */
export function createRequestHandler(options: HttpOptions) {
  const root = options.staticDir ? path.resolve(options.staticDir) : null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/healthz') {
        sendJson(res, { ok: true, rooms: options.info().rooms });
        return;
      }
      if (url.pathname === '/api/info') {
        sendJson(res, { lanAddresses: options.info().lanAddresses });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed');
        return;
      }
      if (!root) {
        sendText(
          res,
          404,
          'The client has not been built. Run "pnpm build", or open the Vite dev server.',
        );
        return;
      }

      const requested = decodeURIComponent(url.pathname);
      if (requested.includes('\0')) {
        sendText(res, 400, 'Bad request');
        return;
      }
      const filePath = path.join(root, path.normalize(requested));
      // Never serve anything outside the client build.
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        sendText(res, 403, 'Forbidden');
        return;
      }

      if (await isFile(filePath)) {
        sendFile(req, res, filePath);
        return;
      }
      // Paths with a file extension are real files that are missing. Everything else is a
      // client-side route (/host/ABCD), so hand back the app and let React Router handle it.
      if (path.extname(requested) === '') {
        const index = path.join(root, 'index.html');
        if (await isFile(index)) {
          sendFile(req, res, index);
          return;
        }
      }
      sendText(res, 404, 'Not found');
    } catch (error) {
      if (error instanceof URIError) {
        sendText(res, 400, 'Bad request');
        return;
      }
      console.error('HTTP error', error);
      if (!res.headersSent) sendText(res, 500, 'Server error');
      else res.destroy();
    }
  };
}
