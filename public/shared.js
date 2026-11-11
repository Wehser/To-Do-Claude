/* Gemeinsame Logik für Browser und Server (Datumsfunktionen, Einträge eines Tages). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function weekday(s) { return parseYmd(s).getDay(); }
  function mondayOf(s) { const wd = weekday(s); return addDays(s, wd === 0 ? -6 : 1 - wd); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function toMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  function fromMin(m) { m = Math.max(0, Math.min(m, 24 * 60 - 1)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function routineActive(r, date) {
    if (!r.weekdays || !r.weekdays.includes(weekday(date))) return false;
    if (r.startDate && date < r.startDate) return false;
    if (r.endDate && date > r.endDate) return false;
    return true;
  }

  /** Alle Einträge eines Tages in einheitlicher Form. */
  function itemsForDate(DB, date) {
    const items = [];
    const checks = (DB.routineChecks || {})[date] || {};
    for (const r of DB.routines || []) {
      if (!routineActive(r, date)) continue;
      const st = checks[r.id] || null;
      items.push({ kind: 'routine', ref: r, id: r.id, title: r.title, start: r.start, end: r.end, areaId: r.areaId, done: st === 'done', skipped: st === 'skip', notes: r.notes });
    }
    for (const t of DB.todos || []) {
      if (t.date !== date) continue;
      items.push({ kind: t.examId ? 'study' : 'todo', ref: t, id: t.id, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: !!t.done, priority: t.priority, notes: t.notes, reminder: t.reminder });
    }
    for (const w of DB.work || []) {
      if (w.date !== date) continue;
      items.push({ kind: 'work', ref: w, id: w.id, title: w.note ? 'Arbeit: ' + w.note : 'Arbeit', start: w.start, end: w.end, areaId: 'arbeit', done: false, readonly: true });
    }
    for (const c of DB.calendars || []) {
      if (c.hidden) continue;
      for (const e of c.events || []) {
        if (e.date !== date) continue;
        items.push({ kind: 'event', ref: e, cal: c, id: c.id + ':' + e.id, title: e.title, start: e.start, end: e.end, areaId: c.areaId, done: false, readonly: true, location: e.location, holiday: !!c.holiday });
      }
    }
    return items.sort((a, b) => (toMin(a.start) ?? 9999) - (toMin(b.start) ?? 9999) || a.title.localeCompare(b.title));
  }

  /** Zeitlich belegte Einträge, die sich mit [s, e) überschneiden. */
  function conflictsAt(DB, date, start, end, excludeRef) {
    const s = toMin(start);
    let e = toMin(end);
    if (s === null) return [];
    if (e === null || e <= s) e = s + 30;
    return itemsForDate(DB, date).filter((i) => {
      if (!i.start || i.skipped || i.ref === excludeRef) return false;
      const is = toMin(i.start);
      let ie = toMin(i.end);
      if (ie === null || ie <= is) ie = is + 30;
      return is < e && s < ie;
    });
  }

  return { pad, ymd, parseYmd, addDays, weekday, mondayOf, daysBetween, toMin, fromMin, routineActive, itemsForDate, conflictsAt };
});
