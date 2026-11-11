'use strict';
/**
 * Mein Planer – kleiner, abhängigkeitsfreier Node.js-Server.
 *
 * - Passwortschutz über die Umgebungsvariable APP_PASSWORD
 * - Speicherung entweder in PostgreSQL (DATABASE_URL gesetzt) oder in einer JSON-Datei (DATA_DIR)
 * - Liefert die Web-App aus dem Ordner ./public aus
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!APP_PASSWORD) {
  console.error('FEHLER: Bitte die Umgebungsvariable APP_PASSWORD setzen (z. B. APP_PASSWORD=meinGeheimesPasswort npm start).');
  process.exit(1);
}
if (APP_PASSWORD.length < 8) {
  console.warn('WARNUNG: APP_PASSWORD ist kürzer als 8 Zeichen. Bitte ein längeres Passwort verwenden.');
}

// Geheimnis zum Signieren der Login-Cookies. Ändert sich das Passwort, werden alle Sitzungen ungültig.
const SESSION_SECRET = crypto
  .createHash('sha256')
  .update((process.env.SESSION_SECRET || 'planer-default-secret') + '|' + APP_PASSWORD)
  .digest();

// ---------------------------------------------------------------------------
// Speicher
// ---------------------------------------------------------------------------
function createFileStore() {
  const file = path.join(DATA_DIR, 'planer.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return {
    name: 'Datei ' + file,
    async load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async save(doc) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(doc));
      fs.renameSync(tmp, file);
      // Einfaches tägliches Backup
      const backup = path.join(DATA_DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    },
  };
}

async function createPgStore() {
  let pg;
  try {
    pg = require('pg');
  } catch (e) {
    console.error('FEHLER: DATABASE_URL ist gesetzt, aber das Paket "pg" ist nicht installiert. Bitte "npm install" ausführen.');
    process.exit(1);
  }
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  await pool.query('CREATE TABLE IF NOT EXISTS planer_store (id TEXT PRIMARY KEY, doc JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
  return {
    name: 'PostgreSQL',
    async load() {
      const r = await pool.query('SELECT doc FROM planer_store WHERE id = $1', ['main']);
      return r.rows[0] ? r.rows[0].doc : null;
    },
    async save(doc) {
      await pool.query(
        'INSERT INTO planer_store (id, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()',
        ['main', doc]
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Authentifizierung
// ---------------------------------------------------------------------------
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function makeToken() {
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = 'v1.' + expires;
  return payload + '.' + sign(payload);
}

function verifyToken(token) {
  if (!token) return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  const expires = Number(payload.split('.')[1]);
  return Number.isFinite(expires) && expires > Date.now();
}

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function isAuthed(req) {
  return verifyToken(parseCookies(req).planer_session);
}

// Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 15 Minuten
const attempts = new Map();
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}
function recordFailure(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

// ---------------------------------------------------------------------------
// HTTP-Helfer
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Nicht gefunden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
  });
}

// Dateien, die ohne Login erreichbar sein dürfen
const PUBLIC_FILES = new Set(['/login.html', '/style.css', '/login.js', '/icon.svg', '/manifest.webmanifest']);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function main() {
  const store = DATABASE_URL ? await createPgStore() : createFileStore();
  let cache = await store.load();
  if (!cache) cache = { version: 0, data: null };
  let saving = Promise.resolve();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      // --- Login / Logout ---
      if (p === '/api/login' && req.method === 'POST') {
        const ip = clientIp(req);
        if (tooManyAttempts(ip)) return sendJson(res, 429, { error: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
        let body = {};
        try {
          body = JSON.parse(await readBody(req, 10000));
        } catch (e) {
          /* leer */
        }
        if (!passwordMatches(body.password || '')) {
          recordFailure(ip);
          return sendJson(res, 401, { error: 'Falsches Passwort' });
        }
        const cookie = [
          'planer_session=' + makeToken(),
          'Path=/',
          'HttpOnly',
          'SameSite=Lax',
          'Max-Age=' + SESSION_DAYS * 24 * 3600,
        ];
        if (isHttps(req)) cookie.push('Secure');
        res.setHeader('Set-Cookie', cookie.join('; '));
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/logout') {
        res.setHeader('Set-Cookie', 'planer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/login' || p === '/login.html') return serveFile(res, 'login.html');
      if (PUBLIC_FILES.has(p)) return serveFile(res, p.slice(1));

      // --- Ab hier nur mit Login ---
      if (!isAuthed(req)) {
        if (p.startsWith('/api/')) return sendJson(res, 401, { error: 'Nicht angemeldet' });
        return send(res, 302, '', { Location: '/login' });
      }

      if (p === '/api/data' && req.method === 'GET') {
        return sendJson(res, 200, cache);
      }
      if (p === '/api/data' && req.method === 'PUT') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          return sendJson(res, 400, { error: 'Ungültige Daten' });
        }
        if (!body || typeof body.data !== 'object' || body.data === null) {
          return sendJson(res, 400, { error: 'Ungültige Daten' });
        }
        // Konfliktschutz: wurde zwischenzeitlich auf einem anderen Gerät gespeichert?
        if (!body.force && body.baseVersion !== cache.version) {
          return sendJson(res, 409, { error: 'Konflikt', current: cache });
        }
        const next = { version: cache.version + 1, updatedAt: new Date().toISOString(), data: body.data };
        const previous = cache;
        cache = next; // sofort setzen, damit parallele Anfragen den Konflikt erkennen
        saving = saving.catch(() => {}).then(() => store.save(next));
        try {
          await saving;
        } catch (err) {
          if (cache === next) cache = previous;
          throw err;
        }
        return sendJson(res, 200, { version: cache.version, updatedAt: cache.updatedAt });
      }

      if (p === '/' || p === '/index.html') return serveFile(res, 'index.html');
      return serveFile(res, p.slice(1));
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'Serverfehler' });
    }
  });

  server.listen(PORT, () => {
    console.log(`Mein Planer läuft auf http://localhost:${PORT} (Speicher: ${store.name})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
