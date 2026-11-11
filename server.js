'use strict';
/**
 * Mein Planer – Node.js-Server.
 *
 * - Passwortschutz über die Umgebungsvariable APP_PASSWORD
 * - Speicherung in PostgreSQL (DATABASE_URL) oder in JSON-Dateien (DATA_DIR)
 * - Web-Push-Erinnerungen (VAPID-Schlüssel werden beim ersten Start erzeugt)
 * - Kalender: .ics-Abos abrufen und eigenen Kalender als .ics-Abo bereitstellen
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const shared = require('./public/shared.js');

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
if (APP_PASSWORD.length < 8) console.warn('WARNUNG: APP_PASSWORD ist kürzer als 8 Zeichen. Bitte ein längeres Passwort verwenden.');

// Geheimnis zum Signieren der Login-Cookies. Ändert sich das Passwort, werden alle Sitzungen ungültig.
const SESSION_SECRET = crypto.createHash('sha256').update((process.env.SESSION_SECRET || 'planer-default-secret') + '|' + APP_PASSWORD).digest();

// ---------------------------------------------------------------------------
// Speicher (zwei Dokumente: "main" = Planer-Daten, "meta" = Geräte, Schlüssel)
// ---------------------------------------------------------------------------
function createFileStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fileOf = (id) => path.join(DATA_DIR, id === 'main' ? 'planer.json' : id + '.json');
  return {
    name: 'Datei ' + DATA_DIR,
    async load(id) {
      try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async save(id, doc) {
      const file = fileOf(id);
      fs.writeFileSync(file + '.tmp', JSON.stringify(doc));
      fs.renameSync(file + '.tmp', file);
      if (id === 'main') {
        const backup = path.join(DATA_DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
        if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      }
    },
  };
}

async function createPgStore() {
  let pg;
  try { pg = require('pg'); } catch (e) {
    console.error('FEHLER: DATABASE_URL ist gesetzt, aber das Paket "pg" ist nicht installiert. Bitte "npm install" ausführen.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await pool.query('CREATE TABLE IF NOT EXISTS planer_store (id TEXT PRIMARY KEY, doc JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
  return {
    name: 'PostgreSQL',
    async load(id) { const r = await pool.query('SELECT doc FROM planer_store WHERE id = $1', [id]); return r.rows[0] ? r.rows[0].doc : null; },
    async save(id, doc) {
      await pool.query('INSERT INTO planer_store (id, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()', [id, doc]);
    },
  };
}

// ---------------------------------------------------------------------------
// Authentifizierung
// ---------------------------------------------------------------------------
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function makeToken() { const payload = 'v1.' + (Date.now() + SESSION_DAYS * 86400000); return payload + '.' + sign(payload); }
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
  (req.headers.cookie || '').split(';').forEach((part) => { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
function isAuthed(req) { return verifyToken(parseCookies(req).planer_session); }

// Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 15 Minuten
const attempts = new Map();
function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
function tooManyAttempts(ip) { const now = Date.now(); const list = (attempts.get(ip) || []).filter((t) => now - t < 900000); attempts.set(ip, list); return list.length >= 10; }
function recordFailure(ip) { const list = attempts.get(ip) || []; list.push(Date.now()); attempts.set(ip, list); }

// ---------------------------------------------------------------------------
// HTTP-Helfer
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'",
};
function send(res, status, body, headers = {}) { res.writeHead(status, { ...SECURITY_HEADERS, ...headers }); res.end(body); }
function sendJson(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, limit) { try { return JSON.parse(await readBody(req, limit)) || {}; } catch (e) { return {}; } }
function serveFile(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Nicht gefunden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (rel === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    send(res, 200, data, headers);
  });
}
const PUBLIC_FILES = new Set(['/login.html', '/style.css', '/login.js', '/icon.svg', '/manifest.webmanifest', '/sw.js']);

// ---------------------------------------------------------------------------
// Zeitzonen-Helfer
// ---------------------------------------------------------------------------
function localNow(tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  } catch (e) {
    return localNow('Europe/Berlin');
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function inQuiet(q, min) {
  if (!q || !q.on) return false;
  const f = shared.toMin(q.from), t = shared.toMin(q.to);
  if (f === null || t === null) return false;
  return f <= t ? min >= f && min < t : min >= f || min < t;
}

// ---------------------------------------------------------------------------
// Kalender-Export (.ics)
// ---------------------------------------------------------------------------
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function icsFold(line) {
  // Nach max. 75 Bytes umbrechen, ohne Zeichen (z. B. Emojis) zu zerteilen
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 74) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
const icsDate = (d) => d.replace(/-/g, '');
const icsDT = (d, t) => icsDate(d) + 'T' + t.replace(':', '') + '00';
const ICS_WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function buildIcs(data) {
  const tz = (data.settings && data.settings.timezone) || 'Europe/Berlin';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mein Planer//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mein Planer', 'X-WR-TIMEZONE:' + tz, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const event = (uid, title, date, start, end, extra = []) => {
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@mein-planer', 'DTSTAMP:' + stamp, 'SUMMARY:' + icsEscape(title));
    if (start) {
      lines.push(`DTSTART;TZID=${tz}:${icsDT(date, start)}`);
      lines.push(`DTEND;TZID=${tz}:${icsDT(date, end && end > start ? end : shared.fromMin(shared.toMin(start) + 30))}`);
    } else {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(date), 'DTEND;VALUE=DATE:' + icsDate(shared.addDays(date, 1)));
    }
    lines.push(...extra, 'END:VEVENT');
  };
  const today = localNow(tz).date;
  const from = shared.addDays(today, -90);
  for (const t of data.todos || []) {
    if (!t.date || t.date < from) continue;
    const prefix = t.examEventOf ? '🎓 ' : t.examId ? '📚 ' : '';
    event('todo-' + t.id, (t.done ? '✓ ' : '') + prefix + t.title, t.date, t.start, t.end, t.notes ? ['DESCRIPTION:' + icsEscape(t.notes)] : []);
  }
  for (const w of data.work || []) if (w.date >= from) event('work-' + w.id, 'Arbeit' + (w.note ? ': ' + w.note : ''), w.date, w.start, w.end);
  for (const r of data.routines || []) {
    if (!r.start || !r.weekdays || !r.weekdays.length) continue;
    let first = r.startDate || r.createdAt || from;
    for (let i = 0; i < 7 && !r.weekdays.includes(shared.weekday(first)); i++) first = shared.addDays(first, 1);
    const rule = 'RRULE:FREQ=WEEKLY;BYDAY=' + r.weekdays.map((d) => ICS_WD[d]).join(',') + (r.endDate ? ';UNTIL=' + icsDate(r.endDate) + 'T235959Z' : '');
    event('routine-' + r.id, '↻ ' + r.title, first, r.start, r.end, [rule]);
  }
  for (const x of data.exams || []) {
    if ((data.todos || []).some((t) => t.examEventOf === x.id)) continue;
    event('exam-' + x.id, '🎓 ' + (x.type || 'Prüfung') + ': ' + x.subject, x.date, x.time, x.time ? shared.fromMin(shared.toMin(x.time) + 120) : '');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function main() {
  const store = DATABASE_URL ? await createPgStore() : createFileStore();
  let cache = (await store.load('main')) || { version: 0, data: null };
  let meta = (await store.load('meta')) || {};
  let saving = Promise.resolve();
  let metaChanged = false;

  if (!meta.vapid) {
    meta.vapid = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : webpush.generateVAPIDKeys();
    metaChanged = true;
  }
  if (!meta.icsToken) { meta.icsToken = crypto.randomBytes(24).toString('base64url'); metaChanged = true; }
  meta.devices = meta.devices || [];
  const saveMeta = () => store.save('meta', meta).catch((e) => console.error('Meta speichern fehlgeschlagen', e));
  if (metaChanged) await saveMeta();

  const vapidSubject = () => process.env.VAPID_SUBJECT || (meta.origin && meta.origin.startsWith('https://') ? meta.origin : 'mailto:planer@example.com');

  // ---------- Push senden ----------
  async function pushTo(devices, payload) {
    let changed = false;
    await Promise.all(devices.map(async (d) => {
      try {
        await webpush.sendNotification(d.subscription, JSON.stringify(payload), {
          TTL: 900, urgency: 'high',
          vapidDetails: { subject: vapidSubject(), publicKey: meta.vapid.publicKey, privateKey: meta.vapid.privateKey },
        });
        d.lastUsed = new Date().toISOString();
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) { meta.devices = meta.devices.filter((x) => x !== d); changed = true; console.log('Push-Abo abgelaufen, Gerät entfernt:', d.name); }
        else console.error('Push fehlgeschlagen für', d.name, err.statusCode || '', err.body || err.message);
      }
    }));
    if (changed) saveMeta();
  }
  function notify(type, payload) {
    const targets = meta.devices.filter((d) => d.enabled !== false && (d.types || {})[type] !== false);
    if (targets.length) return pushTo(targets, payload);
  }

  // ---------- Erinnerungs-Zeitplaner ----------
  const sent = new Map();
  const timers = []; // Pomodoro: { deviceId, at, title, body }
  const once = (key) => { if (sent.has(key)) return false; sent.set(key, Date.now()); return true; };
  const ICON = { todo: '📝', routine: '↻', study: '📚', work: '💼', event: '📅' };

  function timerTick() {
    const nowMs = Date.now();
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= nowMs) {
        const t = timers.splice(i, 1)[0];
        const dev = meta.devices.filter((d) => d.id === t.deviceId && d.enabled !== false && (d.types || {}).pomodoro !== false);
        if (dev.length) pushTo(dev, { title: t.title, body: t.body, tag: 'pomodoro', url: '/?view=study' });
      }
    }
  }
  setInterval(timerTick, 2000);

  function tick() {
    const nowMs = Date.now();
    for (const [k, v] of sent) if (nowMs - v > 2 * 86400000) sent.delete(k);
    const data = cache.data;
    if (!data || !meta.devices.length) return;
    const s = data.settings || {};
    const n = s.notify || {};
    const { date, min } = localNow(s.timezone);
    if (inQuiet(n.quiet, min)) return;
    const due = (at) => at <= min && min - at < 3;

    // Erinnerungen vor Einträgen (heute und morgen, damit „1 Tag vorher“ funktioniert)
    for (const offset of [0, 1]) {
      const d = shared.addDays(date, offset);
      for (const it of shared.itemsForDate(data, d)) {
        if (!it.start || it.done || it.skipped) continue;
        const rule = n[it.kind];
        const own = it.ref.reminder;
        if (own === 'off') continue;
        let before;
        if (own !== undefined && own !== '' && own !== null) before = Number(own);
        else if (rule && rule.on) before = Number(rule.min) || 0;
        else continue;
        const at = shared.toMin(it.start) + offset * 1440 - before;
        if (!due(at)) continue;
        if (!once(`${it.kind}:${it.id}:${d}:${before}`)) continue;
        const when = before === 0 ? 'jetzt' : before >= 1440 ? 'morgen um ' + it.start : 'in ' + (before >= 60 ? before / 60 + ' h' : before + ' min') + ' (' + it.start + ')';
        notify(it.kind, { title: `${ICON[it.kind] || ''} ${it.title}`, body: `Beginnt ${when}` + (it.end ? ` · bis ${it.end}` : '') + (it.location ? ` · ${it.location}` : ''), tag: it.kind + it.id, url: '/?view=day' });
      }
    }

    const items = shared.itemsForDate(data, date);
    if (n.morning && n.morning.on && due(shared.toMin(n.morning.time)) && once('morning:' + date)) {
      const todos = items.filter((i) => (i.kind === 'todo' || i.kind === 'study') && !i.done).length;
      const routines = items.filter((i) => i.kind === 'routine' && !i.skipped).length;
      const first = items.find((i) => i.start && shared.toMin(i.start) >= min);
      const overdue = (data.todos || []).filter((t) => !t.done && t.date < date).length;
      notify('summary', {
        title: '☀️ Guten Morgen! Dein Tag',
        body: `${todos} To-Dos, ${routines} Routinen` + (first ? ` · Zuerst: ${first.start} ${first.title}` : '') + (overdue ? ` · ${overdue} überfällig` : ''),
        tag: 'morning', url: '/?view=day',
      });
    }
    if (n.exams && n.exams.on && n.morning && due(shared.toMin(n.morning.time || '07:30')) && once('exams:' + date)) {
      const days = String(n.exams.days || '').split(',').map(Number).filter((x) => x > 0);
      for (const x of data.exams || []) {
        const left = shared.daysBetween(date, x.date);
        if (days.includes(left)) notify('exams', { title: `🎓 ${x.subject}: noch ${left} ${left === 1 ? 'Tag' : 'Tage'}`, body: `${x.type || 'Prüfung'} am ${x.date.split('-').reverse().join('.')}` + (x.time ? ' um ' + x.time : ''), tag: 'exam' + x.id, url: '/?view=study' });
      }
    }
    if (n.evening && n.evening.on && due(shared.toMin(n.evening.time)) && once('evening:' + date)) {
      const open = items.filter((i) => (i.kind === 'todo' || i.kind === 'study') && !i.done);
      const rOpen = items.filter((i) => i.kind === 'routine' && !i.done && !i.skipped);
      if (open.length || rOpen.length) {
        notify('summary', { title: '🌙 Tagesabschluss', body: `Noch offen: ${open.length} To-Dos, ${rOpen.length} Routinen` + (open[0] ? ` · z. B. ${open[0].title}` : ''), tag: 'evening', url: '/?view=day' });
      }
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('Zeitplaner-Fehler', e); } }, 20000);

  // ---------- Routen ----------
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (p === '/api/login' && req.method === 'POST') {
        const ip = clientIp(req);
        if (tooManyAttempts(ip)) return sendJson(res, 429, { error: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
        const body = await readJson(req, 10000);
        if (!passwordMatches(body.password || '')) { recordFailure(ip); return sendJson(res, 401, { error: 'Falsches Passwort' }); }
        const cookie = ['planer_session=' + makeToken(), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + SESSION_DAYS * 86400];
        if (isHttps(req)) cookie.push('Secure');
        res.setHeader('Set-Cookie', cookie.join('; '));
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/logout') {
        res.setHeader('Set-Cookie', 'planer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return sendJson(res, 200, { ok: true });
      }

      // Kalender-Abo: geschützt durch geheimes Token in der URL (Kalender-Apps können sich nicht anmelden)
      const cal = p.match(/^\/cal\/([A-Za-z0-9_-]+)\.ics$/);
      if (cal) {
        const a = Buffer.from(cal[1]), b = Buffer.from(meta.icsToken);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || !cache.data) return send(res, 404, 'Nicht gefunden');
        return send(res, 200, buildIcs(cache.data), { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="mein-planer.ics"', 'Cache-Control': 'no-cache' });
      }

      if (p === '/login' || p === '/login.html') return serveFile(res, 'login.html');
      if (PUBLIC_FILES.has(p)) return serveFile(res, p.slice(1));

      // --- Ab hier nur mit Login ---
      if (!isAuthed(req)) {
        if (p.startsWith('/api/')) return sendJson(res, 401, { error: 'Nicht angemeldet' });
        return send(res, 302, '', { Location: '/login' });
      }

      if (p === '/api/data' && req.method === 'GET') return sendJson(res, 200, cache);
      if (p === '/api/data' && req.method === 'PUT') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'Ungültige Daten' }); }
        if (!body || typeof body.data !== 'object' || body.data === null) return sendJson(res, 400, { error: 'Ungültige Daten' });
        if (!body.force && body.baseVersion !== cache.version) return sendJson(res, 409, { error: 'Konflikt', current: cache });
        const next = { version: cache.version + 1, updatedAt: new Date().toISOString(), data: body.data };
        const previous = cache;
        cache = next;
        saving = saving.catch(() => {}).then(() => store.save('main', next));
        try { await saving; } catch (err) { if (cache === next) cache = previous; throw err; }
        return sendJson(res, 200, { version: cache.version, updatedAt: cache.updatedAt });
      }

      // --- Push ---
      if (p === '/api/push/config' && req.method === 'GET') {
        return sendJson(res, 200, {
          publicKey: meta.vapid.publicKey,
          schedulerOk: !!process.env.ALWAYS_ON,
          devices: meta.devices.map((d) => ({ id: d.id, name: d.name, enabled: d.enabled !== false, types: d.types || {}, createdAt: d.createdAt, lastUsed: d.lastUsed })),
        });
      }
      if (p === '/api/push/subscribe' && req.method === 'POST') {
        const b = await readJson(req, 20000);
        if (!b.deviceId || !b.subscription || !b.subscription.endpoint || !/^https:\/\//.test(b.subscription.endpoint)) return sendJson(res, 400, { error: 'Ungültiges Abo' });
        const proto = isHttps(req) ? 'https' : 'http';
        meta.origin = proto + '://' + req.headers.host;
        let d = meta.devices.find((x) => x.id === b.deviceId);
        if (!d) { d = { id: String(b.deviceId).slice(0, 64), createdAt: new Date().toISOString(), enabled: true, types: {} }; meta.devices.push(d); }
        d.name = String(b.name || 'Gerät').slice(0, 60);
        d.subscription = b.subscription;
        d.enabled = true;
        await saveMeta();
        return sendJson(res, 200, { ok: true });
      }
      const devMatch = p.match(/^\/api\/push\/devices\/([^/]+)$/);
      if (devMatch) {
        const id = decodeURIComponent(devMatch[1]);
        const d = meta.devices.find((x) => x.id === id);
        if (req.method === 'DELETE') { meta.devices = meta.devices.filter((x) => x.id !== id); await saveMeta(); return sendJson(res, 200, { ok: true }); }
        if (!d) return sendJson(res, 404, { error: 'Gerät nicht gefunden' });
        if (req.method === 'PUT') {
          const b = await readJson(req, 10000);
          if (typeof b.name === 'string') d.name = b.name.slice(0, 60);
          if (typeof b.enabled === 'boolean') d.enabled = b.enabled;
          if (b.types && typeof b.types === 'object') d.types = Object.fromEntries(Object.entries(b.types).map(([k, v]) => [k, !!v]));
          await saveMeta();
          return sendJson(res, 200, { ok: true });
        }
      }
      if (p === '/api/push/test' && req.method === 'POST') {
        const b = await readJson(req, 10000);
        const d = meta.devices.filter((x) => x.id === b.deviceId);
        if (!d.length) return sendJson(res, 404, { error: 'Gerät ist nicht für Push angemeldet' });
        await pushTo(d, { title: '🔔 Test von Mein Planer', body: 'Benachrichtigungen funktionieren auf „' + d[0].name + '“.', tag: 'test' });
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/push/timer') {
        const b = await readJson(req, 10000);
        for (let i = timers.length - 1; i >= 0; i--) if (timers[i].deviceId === b.deviceId) timers.splice(i, 1);
        if (req.method === 'POST' && Number(b.at) > Date.now() && Number(b.at) < Date.now() + 6 * 3600000) {
          timers.push({ deviceId: b.deviceId, at: Number(b.at), title: String(b.title || 'Timer').slice(0, 100), body: String(b.body || '').slice(0, 200) });
        }
        return sendJson(res, 200, { ok: true });
      }

      // --- Kalender ---
      if (p === '/api/ics/token') {
        if (req.method === 'POST') { meta.icsToken = crypto.randomBytes(24).toString('base64url'); await saveMeta(); }
        return sendJson(res, 200, { token: meta.icsToken });
      }
      if (p === '/api/ics/fetch' && req.method === 'GET') {
        const target = url.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(target)) return sendJson(res, 400, { error: 'Nur http(s)-Adressen sind erlaubt' });
        try {
          const r = await fetch(target, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'MeinPlaner/1.0', Accept: 'text/calendar, */*' } });
          if (!r.ok) return sendJson(res, 502, { error: 'Kalender-Server antwortet mit ' + r.status });
          const text = await r.text();
          if (text.length > 10 * 1024 * 1024) return sendJson(res, 413, { error: 'Kalender ist zu groß' });
          if (!text.includes('BEGIN:VCALENDAR')) return sendJson(res, 422, { error: 'Unter dieser Adresse liegt kein iCal-Kalender' });
          return sendJson(res, 200, { text });
        } catch (e) {
          return sendJson(res, 502, { error: 'Kalender konnte nicht geladen werden' });
        }
      }

      if (p === '/' || p === '/index.html') return serveFile(res, 'index.html');
      return serveFile(res, p.slice(1));
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'Serverfehler' });
    }
  });

  server.listen(PORT, () => console.log(`Mein Planer läuft auf http://localhost:${PORT} (Speicher: ${store.name})`));
}

main().catch((err) => { console.error(err); process.exit(1); });
