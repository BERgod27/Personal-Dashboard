// Which files of the front end the server hands out, and which it never does.

import { extname, join, normalize, sep } from 'node:path';

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

// Every folder and file name in a served path: plain ASCII letters, digits, dot, dash and
// underscore, not starting or ending with a dot. That rules out "..", dotfiles and backslashes,
// and also the other spellings under which macOS and Windows open a protected file
// ("server.", "SERVER~1", "config.json::$DATA", a look-alike letter).
const SAFE_NAME = /^[A-Za-z0-9_-]([A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;

// The file under `root` that a request path stands for, or null when it must not be served.
// The rules compare names in lower case, because macOS and Windows ignore case in file names.
export function staticPath(root, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p === '/') p = '/index.html';
  const segs = p.split('/').filter(Boolean);
  if (!segs.length || !segs.every((s) => SAFE_NAME.test(s))) return null;
  const lower = segs.map((s) => s.toLowerCase());
  const file = lower[lower.length - 1];
  if (lower.includes('node_modules')) return null;
  // Server-side and private bits of the modules are never served.
  if (lower[0] === 'server') return null;
  if (lower.some((s) => ['tests', 'test', '__pycache__'].includes(s))) return null;
  if (/^(config\.json|server\.mjs|feeds\.json|.*\.py|.*\.csv)$/.test(file)) return null;
  if (lower.includes('data') && !file.endsWith('.png')) return null; // per-user data has its own routes
  if (!TYPES[extname(file)]) return null;
  const full = normalize(join(root, ...segs));
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}
