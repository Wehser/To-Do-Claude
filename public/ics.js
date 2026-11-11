'use strict';
/* Einfacher iCalendar-Parser (.ics) mit Unterstützung für wiederkehrende Termine (RRULE, EXDATE, RECURRENCE-ID). */

function parseIcs(text, windowFrom, windowTo) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, name, paramStr, value] = m;
    const params = {};
    paramStr.split(';').filter(Boolean).forEach((p) => { const [k, v] = p.split('='); params[k] = v; });
    if (name === 'SUMMARY') cur.title = unescapeIcs(value);
    else if (name === 'LOCATION') cur.location = unescapeIcs(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeIcs(value).slice(0, 500);
    else if (name === 'UID') cur.uid = value;
    else if (name === 'DTSTART') cur.start = parseIcsDate(value, params);
    else if (name === 'DTEND') cur.end = parseIcsDate(value, params);
    else if (name === 'DURATION') cur.duration = parseDuration(value);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
    else if (name === 'EXDATE') value.split(',').forEach((v) => cur.exdates.push(parseIcsDate(v, params)));
    else if (name === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDate(value, params);
    else if (name === 'STATUS') cur.status = value;
  }

  // Ausnahmen (geänderte Einzeltermine) den Serien zuordnen
  const overrides = {};
  for (const e of events) if (e.recurrenceId && e.uid) (overrides[e.uid] = overrides[e.uid] || []).push(e.recurrenceId.date + (e.recurrenceId.time || ''));

  const out = [];
  for (const e of events) {
    if (!e.start || e.status === 'CANCELLED') continue;
    const durMin = e.end ? diffMinutes(e.start, e.end) : (e.duration ?? (e.start.time ? 60 : 1440));
    const skip = new Set([...(e.exdates || []).map((x) => x.date + (x.time || '')), ...(!e.recurrenceId && overrides[e.uid] ? overrides[e.uid] : [])]);
    const occ = e.rrule && !e.recurrenceId ? expandRrule(e.start, e.rrule, windowFrom, windowTo) : [e.start.date];
    for (const date of occ) {
      if (date < windowFrom || date > windowTo || skip.has(date + (e.start.time || ''))) continue;
      if (!e.start.time) {
        // Ganztägig (ggf. über mehrere Tage, max. 14)
        const days = Math.max(1, Math.min(14, Math.round(durMin / 1440)));
        for (let i = 0; i < days; i++) out.push({ id: (e.uid || '') + '@' + addDays(date, i), date: addDays(date, i), start: '', end: '', title: e.title || '(ohne Titel)', location: e.location || '', description: e.description || '' });
      } else {
        const s = toMin(e.start.time);
        const end = s + durMin;
        out.push({ id: (e.uid || '') + '@' + date + e.start.time, date, start: e.start.time, end: end >= 24 * 60 ? '23:59' : fromMin(end), title: e.title || '(ohne Titel)', location: e.location || '', description: e.description || '' });
      }
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function unescapeIcs(s) { return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

/** Gibt {date: 'YYYY-MM-DD', time: 'HH:MM' | ''} in lokaler Zeit zurück. */
function parseIcsDate(v, params = {}) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  if (!hh || params.VALUE === 'DATE') return { date: `${y}-${mo}-${d}`, time: '' };
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    return { date: ymd(dt), time: pad(dt.getHours()) + ':' + pad(dt.getMinutes()) };
  }
  if (params.TZID) {
    // Wanduhrzeit in TZID → lokale Zeit umrechnen
    try {
      const guess = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: params.TZID.replace(/"/g, ''), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
      const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      const real = new Date(guess.getTime() - (asTz - guess.getTime()));
      return { date: ymd(real), time: pad(real.getHours()) + ':' + pad(real.getMinutes()) };
    } catch (_) { /* unbekannte Zeitzone → als lokale Zeit behandeln */ }
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}` };
}

function parseDuration(v) {
  const m = v.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m) return null;
  return (+m[1] || 0) * 7 * 1440 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function diffMinutes(a, b) {
  const da = daysBetween(a.date, b.date) * 1440;
  return da + (toMin(b.time) || 0) - (toMin(a.time) || 0);
}

const ICS_DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandRrule(start, r, windowFrom, windowTo) {
  const freq = r.FREQ;
  const interval = Number(r.INTERVAL) || 1;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? (parseIcsDate(r.UNTIL) || {}).date : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => { const mm = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return mm ? { n: mm[1] ? Number(mm[1]) : null, wd: ICS_DAYS[mm[2]] } : null; }).filter(Boolean) : null;
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const s = parseYmd(start.date);
  const out = [];
  let n = 0;
  const last = until && until < windowTo ? until : windowTo;
  for (let d = start.date, i = 0; d <= last && n < count && i < 4000; d = addDays(d, 1), i++) {
    const dt = parseYmd(d);
    let match = false;
    if (freq === 'DAILY') match = daysBetween(start.date, d) % interval === 0 && (!byday || byday.some((b) => b.wd === dt.getDay()));
    else if (freq === 'WEEKLY') {
      const weeks = Math.round(daysBetween(mondayOf(start.date), mondayOf(d)) / 7);
      match = weeks % interval === 0 && (byday ? byday.some((b) => b.wd === dt.getDay()) : dt.getDay() === s.getDay());
    } else if (freq === 'MONTHLY') {
      const months = (dt.getFullYear() - s.getFullYear()) * 12 + dt.getMonth() - s.getMonth();
      if (months % interval === 0) {
        if (byday) {
          match = byday.some((b) => {
            if (b.wd !== dt.getDay()) return false;
            if (!b.n) return true;
            const nth = Math.ceil(dt.getDate() / 7);
            const daysInMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
            const nthFromEnd = -Math.ceil((daysInMonth - dt.getDate() + 1) / 7);
            return b.n === nth || b.n === nthFromEnd;
          });
        } else match = (bymonthday || [s.getDate()]).includes(dt.getDate());
      }
    } else if (freq === 'YEARLY') {
      match = (dt.getFullYear() - s.getFullYear()) % interval === 0 && dt.getMonth() === s.getMonth() && dt.getDate() === s.getDate();
    }
    if (match) { n++; out.push(d); }
  }
  return out;
}
