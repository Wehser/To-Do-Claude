'use strict';
/* Mein Planer – Kern: Daten, Synchronisation, Tag/Woche/Routinen/Arbeitszeit, Dialoge.
   Datumsfunktionen (ymd, addDays, toMin …) kommen aus shared.js. */

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function today() { return ymd(new Date()); }
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtDate(s, opts = {}) {
  const d = parseYmd(s);
  const base = d.getDate() + '. ' + MONTHS[d.getMonth()] + (opts.year ? ' ' + d.getFullYear() : '');
  return opts.weekday === false ? base : WD_LONG[d.getDay()] + ', ' + base;
}
function fmtShort(s) { const d = parseYmd(s); return WD_SHORT[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
function fmtHours(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h + ':' + pad(m) + ' h'; }
function relDay(s) {
  const diff = daysBetween(today(), s);
  return { 0: 'Heute', 1: 'Morgen', '-1': 'Gestern' }[diff] || null;
}
function durOf(i) { const s = toMin(i.start), e = toMin(i.end); return s !== null && e !== null && e > s ? e - s : 0; }

/** Element-Builder: h('div', {class: 'x', onclick: fn}, 'Text', child) – Texte werden immer sicher eingefügt. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

// ===========================================================================
// Daten & Synchronisation
// ===========================================================================
function defaultSettings() {
  return {
    dayStart: 6,
    dayEnd: 23,
    weeklyWorkTarget: 20,
    hourlyWage: 0,
    ectsTarget: 180,
    colors: { routine: '#3b82f6', todo: '#f59e0b', work: '#10b981', study: '#8b5cf6', event: '#0891b2' },
    theme: 'auto',
    timezone: '',
    pomodoro: { focus: 25, short: 5, long: 15, longEvery: 4, sound: true },
    notify: {
      todo: { on: true, min: 10 },
      routine: { on: true, min: 5 },
      study: { on: true, min: 10 },
      work: { on: true, min: 30 },
      event: { on: true, min: 15 },
      morning: { on: true, time: '07:30' },
      evening: { on: false, time: '21:00' },
      exams: { on: true, days: '14,7,3,1' },
      quiet: { on: false, from: '22:00', to: '07:00' },
    },
  };
}

function defaultData() {
  return {
    areas: [
      { id: 'privat', name: 'Privat', color: '#64748b' },
      { id: 'uni', name: 'Uni', color: '#8b5cf6' },
      { id: 'arbeit', name: 'Arbeit', color: '#10b981' },
      { id: 'sport', name: 'Sport & Gesundheit', color: '#ef4444' },
    ],
    routines: [],
    todos: [],
    routineChecks: {},
    exams: [],
    work: [],
    notes: {},
    focus: [],
    calendars: [],
    grades: [],
    settings: defaultSettings(),
  };
}

let DB = defaultData();
let version = 0;
let dirty = false;
let saveTimer = null;
let saving = false;

function normalize(d) {
  const out = Object.assign(defaultData(), d || {});
  const ds = defaultSettings();
  const s = (d && d.settings) || {};
  out.settings = Object.assign(ds, s);
  out.settings.colors = Object.assign(defaultSettings().colors, s.colors || {});
  out.settings.pomodoro = Object.assign(defaultSettings().pomodoro, s.pomodoro || {});
  const n = defaultSettings().notify;
  for (const k of Object.keys(n)) n[k] = Object.assign(n[k], (s.notify || {})[k] || {});
  out.settings.notify = n;
  return out;
}

function setSync(st, title) {
  const s = $('#sync');
  s.className = 'sync ' + st;
  s.title = title;
}

async function load() {
  const j = await api('/api/data');
  version = j.version || 0;
  DB = normalize(j.data);
  setSync('ok', 'Gespeichert');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && DB.settings.timezone !== tz) { DB.settings.timezone = tz; persist(); }
}

function persist() {
  dirty = true;
  setSync('pending', 'Wird gespeichert …');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  if (saving) { saveTimer = setTimeout(saveNow, 300); return; }
  if (!dirty) return;
  saving = true;
  dirty = false;
  try {
    const r = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: version, data: DB }),
    });
    if (r.status === 401) { location.href = '/login'; return; }
    if (r.status === 409) {
      const j = await r.json();
      version = j.current.version;
      DB = normalize(j.current.data);
      render();
      toast('Auf einem anderen Gerät wurde inzwischen etwas geändert – die aktuelle Version wurde geladen. Bitte letzte Änderung ggf. wiederholen.', 6000);
      setSync('ok', 'Gespeichert');
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    version = j.version;
    setSync(dirty ? 'pending' : 'ok', dirty ? 'Wird gespeichert …' : 'Gespeichert');
  } catch (e) {
    dirty = true;
    setSync('error', 'Offline – wird erneut versucht');
    saveTimer = setTimeout(saveNow, 5000);
  } finally {
    saving = false;
  }
}

// Wenn die App wieder in den Vordergrund kommt: Änderungen anderer Geräte holen
async function refreshIfIdle() {
  if (dirty || saving || document.hidden || $('#modal').open || dragActive) return;
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j.version !== version && !dirty) {
      version = j.version;
      DB = normalize(j.data);
      render();
    }
  } catch (_) { /* offline */ }
}
document.addEventListener('visibilitychange', refreshIfIdle);
setInterval(refreshIfIdle, 60000);
window.addEventListener('beforeunload', (e) => { if (dirty) { saveNow(); e.preventDefault(); } });

// ===========================================================================
// Abfragen
// ===========================================================================
const area = (id) => DB.areas.find((a) => a.id === id);
const exam = (id) => DB.exams.find((x) => x.id === id);
const todoById = (id) => DB.todos.find((t) => t.id === id);

function routineState(rid, date) { return (DB.routineChecks[date] || {})[rid] || null; }

function setRoutineState(rid, date, st) {
  const day = DB.routineChecks[date] || (DB.routineChecks[date] = {});
  if (st) day[rid] = st; else delete day[rid];
  if (!Object.keys(day).length) delete DB.routineChecks[date];
  persist();
}

function itemsFor(date, filterArea = null) {
  const items = itemsForDate(DB, date);
  return filterArea ? items.filter((i) => i.areaId === filterArea) : items;
}

function overdueTodos() {
  const t = today();
  return DB.todos.filter((x) => !x.done && x.date < t).sort((a, b) => a.date.localeCompare(b.date));
}

function toggleItem(item, date = state.date) {
  if (item.kind === 'routine') setRoutineState(item.ref.id, date, item.done ? null : 'done');
  else if (!item.readonly) { item.ref.done = !item.ref.done; persist(); }
  render();
}

function routineStreak(r) {
  let n = 0;
  let d = today();
  if (routineActive(r, d) && routineState(r.id, d) !== 'done') d = addDays(d, -1);
  for (let i = 0; i < 366; i++) {
    if (r.startDate && d < r.startDate) break;
    if (r.createdAt && d < r.createdAt) break;
    if (routineActive(r, d)) {
      const st = routineState(r.id, d);
      if (st === 'done') n++;
      else if (st !== 'skip') break;
    }
    d = addDays(d, -1);
  }
  return n;
}

/** Freie Zeitfenster eines Tages (in Minuten) zwischen dayStart und dayEnd. */
function freeSlots(date, minLen = 30, excludeRef = null) {
  const busy = itemsForDate(DB, date)
    .filter((i) => i.start && !i.skipped && i.ref !== excludeRef)
    .map((i) => { const s = toMin(i.start); let e = toMin(i.end); if (e === null || e <= s) e = s + 30; return [s, e]; })
    .sort((a, b) => a[0] - b[0]);
  let cur = DB.settings.dayStart * 60;
  if (date === today()) cur = Math.max(cur, Math.ceil(nowMin() / 15) * 15);
  const end = DB.settings.dayEnd * 60;
  const out = [];
  for (const [s, e] of busy) {
    if (s - cur >= minLen) out.push([cur, Math.min(s, end)]);
    cur = Math.max(cur, e);
    if (cur >= end) break;
  }
  if (end - cur >= minLen) out.push([cur, end]);
  return out.filter(([s, e]) => e - s >= minLen);
}

/** Nächster freier Startzeitpunkt ab prefStart für die Dauer dur (Minuten). */
function findFreeSlot(date, dur, prefStart, excludeRef = null) {
  const dayS = DB.settings.dayStart * 60, dayE = DB.settings.dayEnd * 60;
  const tryAt = (s) => conflictsAt(DB, date, fromMin(s), fromMin(s + dur), excludeRef).length === 0;
  for (let s = Math.max(prefStart, dayS); s + dur <= dayE; s += 15) if (tryAt(s)) return s;
  for (let s = dayS; s < prefStart && s + dur <= dayE; s += 15) if (tryAt(s)) return s;
  return null;
}

function conflictText(list) {
  return list.map((i) => i.title + ' (' + i.start + (i.end ? '–' + i.end : '') + ')').join(', ');
}

// ===========================================================================
// Zustand der Oberfläche
// ===========================================================================
const state = {
  view: localStorage.getItem('planer.view') || 'day',
  date: today(),
  areaFilter: null,
  expanded: new Set(),
};
const VIEWS = {};
let dragActive = false;

function setView(v) {
  state.view = v;
  try { localStorage.setItem('planer.view', v); } catch (_) { /* egal */ }
  render();
  window.scrollTo(0, 0);
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('#fab').addEventListener('click', () => {
  const fabActions = { routines: () => editRoutine(), study: () => editExam(), work: () => editWork({ date: state.date }), grades: () => editGrade() };
  (fabActions[state.view] || (() => editTodo({ date: state.date })))();
});

function applyTheme() {
  const c = DB.settings.colors;
  const root = document.documentElement;
  for (const k of Object.keys(c)) root.style.setProperty('--c-' + k, c[k]);
  root.dataset.theme = DB.settings.theme || 'auto';
}

function render() {
  applyTheme();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const main = $('#main');
  main.replaceChildren();
  (VIEWS[state.view] || VIEWS.day)(main);
  $('#fab').hidden = state.view === 'settings' || state.view === 'dashboard';
  if (typeof renderTimerWidget === 'function') renderTimerWidget();
}

// ===========================================================================
// Gemeinsame UI-Bausteine
// ===========================================================================
const KIND_LABEL = { routine: 'Routine', todo: 'To-Do', study: 'Lernen', work: 'Arbeit', event: 'Termin' };

function areaChip(id) {
  const a = area(id);
  if (!a) return null;
  return h('span', { class: 'chip', style: { '--chip': a.color } }, a.name);
}

function dateNav(label, onPrev, onNext, onToday) {
  return h('div', { class: 'datenav' },
    h('button', { class: 'btn icon', onclick: onPrev, title: 'Zurück' }, '‹'),
    h('h2', null, label),
    h('button', { class: 'btn icon', onclick: onNext, title: 'Weiter' }, '›'),
    h('button', { class: 'btn small', onclick: onToday }, 'Heute'),
  );
}

function areaFilterBar() {
  const bar = h('div', { class: 'filters' },
    h('button', { class: 'chip-btn' + (!state.areaFilter ? ' active' : ''), onclick: () => { state.areaFilter = null; render(); } }, 'Alle'));
  for (const a of DB.areas) {
    bar.append(h('button', {
      class: 'chip-btn' + (state.areaFilter === a.id ? ' active' : ''),
      style: { '--chip': a.color },
      onclick: () => { state.areaFilter = state.areaFilter === a.id ? null : a.id; render(); },
    }, a.name));
  }
  return bar;
}

function legend() {
  const kinds = ['routine', 'todo', 'study', 'work'];
  if (DB.calendars.length) kinds.push('event');
  return h('div', { class: 'legend' }, kinds.map((k) => h('span', { class: 'legend-item k-' + k }, h('i'), KIND_LABEL[k])));
}

function openItem(item) {
  if (item.kind === 'routine') editRoutine(item.ref);
  else if (item.kind === 'work') editWork(item.ref);
  else if (item.kind === 'event') showEvent(item);
  else editTodo(item.ref);
}

function showEvent(item) {
  const e = item.ref;
  openModal(item.title, h('div', { class: 'form' },
    h('p', null, fmtDate(e.date, { year: true }) + (e.start ? ', ' + e.start + (e.end ? '–' + e.end : '') : ' (ganztägig)')),
    e.location ? h('p', null, '📍 ' + e.location) : null,
    e.description ? h('p', { class: 'topics' }, e.description) : null,
    h('p', { class: 'muted' }, 'Importiert aus Kalender „' + item.cal.name + '“. Änderungen bitte im Ursprungskalender vornehmen.')),
  null, null, 'Schließen');
}

function subtaskProgress(t) {
  const st = t.subtasks || [];
  return st.length ? st.filter((s) => s.done).length + '/' + st.length : null;
}

function itemRow(item, opts = {}) {
  const date = opts.date || state.date;
  const t = item.ref;
  const row = h('div', { class: 'item k-' + item.kind + (item.done ? ' done' : '') + (item.skipped ? ' skipped' : '') });
  if (!item.readonly) {
    row.append(h('input', { type: 'checkbox', class: 'check', checked: item.done, disabled: item.skipped, onclick: (e) => { e.stopPropagation(); toggleItem(item, date); }, title: 'Erledigt' }));
  } else row.append(h('span', { class: 'check-placeholder' }, item.kind === 'event' ? '📅' : '⏱'));
  const time = item.start ? item.start + (item.end ? '–' + item.end : '') : '';
  const ex = t.examId ? exam(t.examId) : null;
  const sp = (item.kind === 'todo' || item.kind === 'study') ? subtaskProgress(t) : null;
  const expanded = state.expanded.has(t.id);
  row.append(h('div', { class: 'item-main', onclick: () => openItem(item) },
    h('div', { class: 'item-title' },
      item.priority === 'hoch' ? h('span', { class: 'prio', title: 'Hohe Priorität' }, '!') : null,
      item.title),
    h('div', { class: 'item-meta' },
      time ? h('span', null, time) : null,
      opts.showDate && t.date ? h('span', null, fmtShort(t.date)) : null,
      h('span', { class: 'kind-label' }, KIND_LABEL[item.kind]),
      ex ? h('span', null, '📚 ' + ex.subject) : null,
      sp ? h('button', { class: 'sub-toggle', title: 'Unteraufgaben anzeigen', onclick: (e) => { e.stopPropagation(); expanded ? state.expanded.delete(t.id) : state.expanded.add(t.id); render(); } }, (expanded ? '▾ ' : '▸ ') + '☑ ' + sp) : null,
      item.location ? h('span', null, '📍 ' + item.location) : null,
      areaChip(item.areaId),
      item.skipped ? h('span', null, 'übersprungen') : null)));
  if ((item.kind === 'todo' || item.kind === 'study') && !item.done && typeof startFocus === 'function') {
    row.append(h('button', { class: 'btn icon small', title: 'Fokus-Timer (Pomodoro) für diese Aufgabe starten', onclick: (e) => { e.stopPropagation(); startFocus({ todoId: t.id, examId: t.examId, areaId: t.areaId, title: t.title }); } }, '▶'));
  }
  if (item.kind === 'routine') {
    row.append(h('button', {
      class: 'btn icon small', title: item.skipped ? 'Wieder aktivieren' : 'Heute überspringen',
      onclick: (e) => { e.stopPropagation(); setRoutineState(item.ref.id, date, item.skipped ? null : 'skip'); render(); },
    }, item.skipped ? '↺' : '⤼'));
  }
  if (opts.extra) row.append(opts.extra);
  if (!sp || !expanded) return row;
  const wrap = h('div', { class: 'item-wrap' }, row);
  const list = h('div', { class: 'subtasks k-' + item.kind });
  for (const s of t.subtasks) {
    list.append(h('label', { class: 'subtask' + (s.done ? ' done' : '') },
      h('input', { type: 'checkbox', checked: s.done, onchange: () => {
        s.done = !s.done;
        if (t.subtasks.every((x) => x.done) && !t.done) { t.done = true; toast('Alle Unteraufgaben erledigt – To-Do abgehakt ✓'); }
        else if (!s.done && t.done) t.done = false;
        persist(); render();
      } }), h('span', null, s.title)));
  }
  wrap.append(list);
  return wrap;
}

// ===========================================================================
// Ziehen & Ablegen (Maus sofort, Touch nach langem Drücken)
// ===========================================================================
function makeDraggable(el, handlers) {
  let sx = 0, sy = 0, active = false, pending = false, timer = null, suppress = false;
  const begin = (x, y) => { active = true; dragActive = true; el.classList.add('dragging'); handlers.onStart && handlers.onStart(); };
  const finish = (x, y) => {
    clearTimeout(timer);
    pending = false;
    if (!active) return;
    active = false;
    dragActive = false;
    suppress = true;
    setTimeout(() => (suppress = false), 50);
    handlers.onEnd(x - sx, y - sy, x, y); // vor dem Entfernen von .dragging, damit elementFromPoint das Ziel findet
    el.classList.remove('dragging');
  };
  el.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
  // Maus / Stift
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('input,button:not(.drag-ok)')) return;
    e.stopPropagation(); // verschachtelte Ziehflächen (z. B. Größen-Griff im Termin) nicht doppelt auslösen
    sx = e.clientX; sy = e.clientY; pending = true;
    const move = (ev) => {
      if (pending && !active && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) begin();
      if (active) { ev.preventDefault(); handlers.onMove(ev.clientX - sx, ev.clientY - sy, ev.clientX, ev.clientY); }
    };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); finish(ev.clientX, ev.clientY); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Touch: langes Drücken (350 ms) startet das Ziehen, sonst normal scrollen
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input,button:not(.drag-ok)')) return;
    e.stopPropagation();
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; pending = true;
    timer = setTimeout(() => { if (pending) { begin(); if (navigator.vibrate) navigator.vibrate(15); } }, 350);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (active) { e.preventDefault(); handlers.onMove(t.clientX - sx, t.clientY - sy, t.clientX, t.clientY); }
    else if (pending && Math.hypot(t.clientX - sx, t.clientY - sy) > 8) { clearTimeout(timer); pending = false; }
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (active) e.preventDefault();
    finish(t.clientX, t.clientY);
  });
  el.addEventListener('touchcancel', () => { clearTimeout(timer); pending = false; if (active) { active = false; dragActive = false; el.classList.remove('dragging'); render(); } });
  el.addEventListener('contextmenu', (e) => { if (active || pending) e.preventDefault(); });
}

function warnConflicts(date, start, end, ref) {
  const c = conflictsAt(DB, date, start, end, ref);
  if (c.length) toast('⚠ Überschneidung mit: ' + conflictText(c), 4500);
}

// ===========================================================================
// Tagesansicht
// ===========================================================================
VIEWS.day = function renderDay(main) {
  const d = state.date;
  const items = itemsFor(d, state.areaFilter);
  const label = (relDay(d) ? relDay(d) + ' · ' : '') + fmtDate(d, { year: true });
  main.append(dateNav(label, () => { state.date = addDays(d, -1); render(); }, () => { state.date = addDays(d, 1); render(); }, () => { state.date = today(); render(); }));
  main.append(areaFilterBar());

  const checkable = items.filter((i) => !i.readonly && !i.skipped);
  const done = checkable.filter((i) => i.done).length;
  const pct = checkable.length ? Math.round((done / checkable.length) * 100) : 0;
  main.append(h('div', { class: 'progress-wrap' },
    h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: pct + '%' } })),
    h('span', { class: 'muted' }, `${done} von ${checkable.length} erledigt`)));

  const layout = h('div', { class: 'day-layout' });
  const tl = h('div', null, timeline(d, items.filter((i) => i.start)));
  tl.append(h('p', { class: 'muted hint' }, 'Tipp: In eine freie Stunde klicken = neues To-Do. To-Dos ziehen = verschieben, unteren Rand ziehen = Dauer ändern (am Handy: kurz gedrückt halten).'));
  layout.append(tl);

  const side = h('div', { class: 'day-side' });
  if (d === today()) {
    const od = overdueTodos();
    if (od.length) {
      const box = h('section', { class: 'card warn' }, h('h3', null, `Überfällig (${od.length})`));
      for (const t of od) {
        const it = { kind: t.examId ? 'study' : 'todo', ref: t, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: false, priority: t.priority };
        box.append(itemRow(it, { showDate: true, extra: h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); moveToToday(t); } }, '→ heute') }));
      }
      if (od.length > 1) box.append(h('button', { class: 'btn small', onclick: () => { od.forEach((t) => moveToToday(t, true)); persist(); render(); } }, 'Alle auf heute verschieben'));
      side.append(box);
    }
  }

  // Freie Zeitfenster
  const slots = freeSlots(d, 30);
  const freeBox = h('section', { class: 'card' }, h('h3', null, 'Freie Zeitfenster'));
  if (!slots.length) freeBox.append(h('p', { class: 'muted' }, 'Keine freien Zeitfenster ab 30 Minuten.'));
  else freeBox.append(h('div', { class: 'slots' }, slots.map(([s, e]) => h('button', {
    class: 'slot', title: 'Hier ein To-Do anlegen',
    onclick: () => editTodo({ date: d, start: fromMin(s), end: fromMin(Math.min(s + 60, e)) }),
  }, fromMin(s) + '–' + fromMin(e), h('small', null, fmtHours(e - s))))));
  side.append(freeBox);

  const noTime = items.filter((i) => !i.start);
  const listBox = h('section', { class: 'card' }, h('h3', null, 'Ohne Uhrzeit'));
  if (!noTime.length) listBox.append(h('p', { class: 'muted' }, 'Keine Einträge ohne Uhrzeit.'));
  noTime.forEach((i) => listBox.append(itemRow(i)));
  listBox.append(quickAdd(d));
  side.append(listBox);

  const allBox = h('section', { class: 'card' }, h('h3', null, 'Zeitplan als Liste'));
  if (!items.some((i) => i.start)) allBox.append(h('p', { class: 'muted' }, 'Noch nichts mit Uhrzeit geplant.'));
  items.filter((i) => i.start).forEach((i) => allBox.append(itemRow(i)));
  side.append(allBox);

  const note = h('textarea', { class: 'daynote', placeholder: 'Notizen / Reflexion für diesen Tag …', rows: 3 });
  note.value = DB.notes[d] || '';
  note.addEventListener('input', () => { if (note.value) DB.notes[d] = note.value; else delete DB.notes[d]; persist(); });
  side.append(h('section', { class: 'card' }, h('h3', null, 'Tagesnotiz'), note));

  layout.append(side);
  main.append(layout);
  main.append(legend());
};

function moveToToday(t, silent) {
  t.date = today();
  if (t.start) {
    const c = conflictsAt(DB, t.date, t.start, t.end, t);
    if (c.length) {
      const free = findFreeSlot(t.date, durOf(t) || 60, toMin(t.start), t);
      if (free !== null) { const dur = durOf(t) || 60; t.start = fromMin(free); t.end = fromMin(free + dur); if (!silent) toast('Zeit war belegt – verschoben auf ' + t.start); }
    }
  }
  if (!silent) { persist(); render(); }
}

function quickAdd(date) {
  const input = h('input', { type: 'text', placeholder: 'Schnell hinzufügen, z. B. „14:00 Mathe Übungsblatt“' });
  const form = h('form', { class: 'quickadd' }, input, h('button', { class: 'btn primary small', type: 'submit' }, 'Hinzufügen'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let text = input.value.trim();
    if (!text) return;
    let start = '', end = '';
    const m = text.match(/^(\d{1,2})[:.](\d{2})(?:\s*[-–]\s*(\d{1,2})[:.](\d{2}))?\s+(.*)$/);
    if (m) {
      start = pad(m[1]) + ':' + m[2];
      end = m[3] ? pad(m[3]) + ':' + m[4] : fromMin(toMin(start) + 60);
      text = m[5];
    }
    const t = { id: uid(), title: text, date, start, end, areaId: state.areaFilter || 'privat', priority: 'normal', done: false, notes: '', subtasks: [] };
    if (start) warnConflicts(date, start, end, null);
    DB.todos.push(t);
    persist();
    render();
  });
  return form;
}

function layoutColumns(items) {
  const evs = items.map((i) => {
    const s = toMin(i.start);
    let e = toMin(i.end);
    if (e === null || e <= s) e = s + 30;
    return { item: i, s, e, col: 0, cols: 1 };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    for (const ev of cluster) {
      let c = colsEnd.findIndex((end) => end <= ev.s);
      if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
      colsEnd[c] = ev.e;
      ev.col = c;
    }
    cluster.forEach((ev) => (ev.cols = colsEnd.length));
    cluster = [];
  };
  for (const ev of evs) {
    if (ev.s >= clusterEnd && cluster.length) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  }
  if (cluster.length) flush();
  return evs;
}

function timeline(date, items) {
  const s = DB.settings;
  let startH = s.dayStart, endH = s.dayEnd;
  for (const i of items) {
    startH = Math.min(startH, Math.floor(toMin(i.start) / 60));
    endH = Math.max(endH, Math.ceil((toMin(i.end) || toMin(i.start) + 30) / 60));
  }
  endH = Math.min(Math.max(endH, startH + 1), 24);
  const HOUR = 56; // Pixel pro Stunde
  const wrap = h('div', { class: 'timeline card', style: { height: (endH - startH) * HOUR + 'px' } });
  for (let hr = startH; hr < endH; hr++) {
    const slot = h('div', { class: 'hour', style: { top: (hr - startH) * HOUR + 'px', height: HOUR + 'px' } },
      h('span', { class: 'hour-label' }, pad(hr) + ':00'));
    slot.addEventListener('click', (e) => {
      const half = e.offsetY > HOUR / 2 ? 30 : 0;
      const st = hr * 60 + half;
      editTodo({ date, start: fromMin(st), end: fromMin(st + 60) });
    });
    wrap.append(slot);
  }
  for (const ev of layoutColumns(items)) {
    const i = ev.item;
    const top = ((ev.s - startH * 60) / 60) * HOUR;
    const height = Math.max(((ev.e - ev.s) / 60) * HOUR - 2, 20);
    const movable = i.kind === 'todo' || i.kind === 'study' || i.kind === 'work';
    const sp = movable && i.kind !== 'work' ? subtaskProgress(i.ref) : null;
    const timeLabel = h('span', null, ' ' + i.start + (i.end ? '–' + i.end : '') + (sp ? ' · ☑ ' + sp : ''));
    const block = h('div', {
      class: 'event k-' + i.kind + (i.done ? ' done' : '') + (i.skipped ? ' skipped' : '') + (movable ? ' movable' : ''),
      style: { top: top + 'px', height: height + 'px', left: `calc(52px + (100% - 56px) * ${ev.col / ev.cols})`, width: `calc((100% - 56px) / ${ev.cols} - 3px)` },
      onclick: (e) => { e.stopPropagation(); openItem(i); },
      title: i.title,
    },
    !i.readonly && !i.skipped ? h('input', { type: 'checkbox', checked: i.done, onclick: (e) => { e.stopPropagation(); toggleItem(i, date); } }) : null,
    h('div', { class: 'event-text' }, h('strong', null, i.title), timeLabel));
    if (movable) {
      const handle = h('div', { class: 'resize-handle', title: 'Ziehen, um die Dauer zu ändern' });
      block.append(handle);
      const snap = (dy) => Math.round(((dy / HOUR) * 60) / 15) * 15;
      const dur = ev.e - ev.s;
      let ns = ev.s, ne = ev.e;
      makeDraggable(block, {
        onMove: (dx, dy) => {
          ns = Math.max(0, Math.min(ev.s + snap(dy), 24 * 60 - dur));
          ne = ns + dur;
          block.style.top = ((ns - startH * 60) / 60) * HOUR + 'px';
          timeLabel.textContent = ' ' + fromMin(ns) + '–' + fromMin(ne);
        },
        onEnd: () => {
          if (ns === ev.s) return render();
          i.ref.start = fromMin(ns); i.ref.end = fromMin(ne);
          warnConflicts(date, i.ref.start, i.ref.end, i.ref);
          persist(); render();
        },
      });
      let re = ev.e;
      makeDraggable(handle, {
        onStart: () => block.classList.add('dragging'),
        onMove: (dx, dy) => {
          re = Math.max(ev.s + 15, Math.min(ev.e + snap(dy), 24 * 60 - 1));
          block.style.height = Math.max(((re - ev.s) / 60) * HOUR - 2, 20) + 'px';
          timeLabel.textContent = ' ' + fromMin(ev.s) + '–' + fromMin(re);
        },
        onEnd: () => {
          i.ref.end = fromMin(re);
          if (!i.ref.start) i.ref.start = fromMin(ev.s);
          warnConflicts(date, i.ref.start, i.ref.end, i.ref);
          persist(); render();
        },
      });
    }
    wrap.append(block);
  }
  if (date === today()) {
    const m = nowMin();
    if (m >= startH * 60 && m <= endH * 60) wrap.append(h('div', { class: 'nowline', style: { top: ((m - startH * 60) / 60) * HOUR + 'px' } }));
  }
  return wrap;
}

// ===========================================================================
// Wochenansicht
// ===========================================================================
function isoWeek(s) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

VIEWS.week = function renderWeek(main) {
  const mon = mondayOf(state.date);
  const sun = addDays(mon, 6);
  main.append(dateNav(`KW ${isoWeek(mon)} · ${fmtDate(mon, { weekday: false })} – ${fmtDate(sun, { weekday: false, year: true })}`,
    () => { state.date = addDays(state.date, -7); render(); }, () => { state.date = addDays(state.date, 7); render(); }, () => { state.date = today(); render(); }));
  main.append(areaFilterBar());
  const grid = h('div', { class: 'week' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const items = itemsFor(d, state.areaFilter);
    const col = h('div', { class: 'week-day' + (d === today() ? ' today' : ''), dataset: { date: d } },
      h('button', { class: 'week-head', onclick: () => { state.date = d; setView('day'); } }, fmtShort(d)));
    for (const it of items) {
      const sp = it.kind === 'todo' || it.kind === 'study' ? subtaskProgress(it.ref) : null;
      const mini = h('div', { class: 'mini k-' + it.kind + (it.done ? ' done' : '') + (it.skipped ? ' skipped' : ''), onclick: () => { state.date = d; openItem(it); } },
        it.start ? h('span', { class: 'mini-time' }, it.start) : null, it.title, sp ? h('small', null, ' ☑' + sp) : null);
      if (it.kind === 'todo' || it.kind === 'study' || it.kind === 'work') {
        mini.classList.add('movable');
        makeDraggable(mini, {
          onMove: (dx, dy, x, y) => {
            mini.style.transform = `translate(${dx}px, ${dy}px)`;
            document.querySelectorAll('.week-day.drop').forEach((x) => x.classList.remove('drop'));
            const target = document.elementFromPoint(x, y);
            const day = target && target.closest('.week-day');
            if (day) day.classList.add('drop');
          },
          onEnd: (dx, dy, x, y) => {
            const target = document.elementFromPoint(x, y);
            const day = target && target.closest('.week-day');
            if (day && day.dataset.date !== d) {
              it.ref.date = day.dataset.date;
              if (it.ref.start) warnConflicts(it.ref.date, it.ref.start, it.ref.end, it.ref);
              persist();
              toast('Verschoben auf ' + fmtShort(it.ref.date));
            }
            render();
          },
        });
      }
      col.append(mini);
    }
    col.append(h('button', { class: 'mini-add', onclick: () => editTodo({ date: d }) }, '+ To-Do'));
    grid.append(col);
  }
  main.append(grid);
  main.append(h('p', { class: 'muted hint' }, 'Tipp: To-Dos, Lerneinheiten und Arbeitszeiten lassen sich auf einen anderen Tag ziehen (am Handy: kurz gedrückt halten).'));

  const sums = {};
  for (let i = 0; i < 7; i++) {
    for (const it of itemsFor(addDays(mon, i))) {
      const dur = durOf(it);
      if (!dur || it.skipped) continue;
      const key = it.kind === 'work' ? 'Arbeit' : (area(it.areaId) || {}).name || 'Ohne Bereich';
      sums[key] = (sums[key] || 0) + dur;
    }
  }
  const stat = h('section', { class: 'card' }, h('h3', null, 'Geplante Zeit in dieser Woche'));
  const entries = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  if (!entries.length) stat.append(h('p', { class: 'muted' }, 'Noch keine Einträge mit Uhrzeit.'));
  const max = Math.max(1, ...entries.map((e) => e[1]));
  for (const [name, min] of entries) {
    const a = DB.areas.find((x) => x.name === name);
    stat.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label' }, name),
      h('div', { class: 'bar' }, h('div', { style: { width: (min / max) * 100 + '%', background: a ? a.color : 'var(--c-work)' } })),
      h('span', { class: 'bar-val' }, fmtHours(min))));
  }
  main.append(stat);
  main.append(legend());
};

// ===========================================================================
// Routinen
// ===========================================================================
function weekdayText(wds) {
  if (wds.length === 7) return 'Täglich';
  if (wds.length === 5 && [1, 2, 3, 4, 5].every((x) => wds.includes(x))) return 'Mo–Fr';
  if (wds.length === 2 && wds.includes(0) && wds.includes(6)) return 'Wochenende';
  return WD_ORDER.filter((x) => wds.includes(x)).map((x) => WD_SHORT[x]).join(', ');
}

function routineRate(r, days = 30) {
  let due = 0, done = 0;
  for (let i = 1; i <= days; i++) {
    const d = addDays(today(), -i);
    if (!routineActive(r, d) || (r.createdAt && d < r.createdAt)) continue;
    const st = routineState(r.id, d);
    if (st === 'skip') continue;
    due++;
    if (st === 'done') done++;
  }
  return { due, done };
}

VIEWS.routines = function renderRoutines(main) {
  main.append(h('div', { class: 'view-head' }, h('h2', null, 'Routinen'),
    h('button', { class: 'btn primary', onclick: () => editRoutine() }, '+ Neue Routine')));
  main.append(h('p', { class: 'muted' }, 'Routinen erscheinen automatisch an den gewählten Wochentagen (Standard: jeden Tag) in deinem Tagesplan.'));
  if (!DB.routines.length) {
    main.append(h('section', { class: 'card' }, h('p', null, 'Noch keine Routinen. Beispiele: Morgenroutine, Sport, Vokabeln lernen, Tagesplanung, Lesen.'),
      h('button', { class: 'btn', onclick: addExampleRoutines }, 'Beispiel-Routinen anlegen')));
    return;
  }
  const list = h('section', { class: 'card' });
  const sorted = [...DB.routines].sort((a, b) => (toMin(a.start) ?? 9999) - (toMin(b.start) ?? 9999));
  for (const r of sorted) {
    const { due, done } = routineRate(r);
    list.append(h('div', { class: 'item k-routine', onclick: () => editRoutine(r) },
      h('span', { class: 'check-placeholder' }, '↻'),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, r.title),
        h('div', { class: 'item-meta' },
          h('span', null, weekdayText(r.weekdays)),
          r.start ? h('span', null, r.start + (r.end ? '–' + r.end : '')) : h('span', null, 'ohne Uhrzeit'),
          areaChip(r.areaId),
          r.endDate ? h('span', null, 'bis ' + fmtShort(r.endDate)) : null)),
      h('div', { class: 'streak', title: 'Serie / Quote der letzten 30 Tage' },
        h('strong', null, '🔥 ' + routineStreak(r)), h('small', null, due ? Math.round((done / due) * 100) + ' %' : '–'))));
  }
  main.append(list);
};

function addExampleRoutines() {
  const all = [0, 1, 2, 3, 4, 5, 6];
  const c = today();
  DB.routines.push(
    { id: uid(), title: 'Morgenroutine', start: '07:00', end: '07:30', weekdays: all, areaId: 'privat', notes: '', createdAt: c },
    { id: uid(), title: 'Tag planen', start: '07:30', end: '07:45', weekdays: all, areaId: 'privat', notes: '', createdAt: c },
    { id: uid(), title: 'Vorlesungen nacharbeiten', start: '17:00', end: '18:00', weekdays: [1, 2, 3, 4, 5], areaId: 'uni', notes: '', createdAt: c },
    { id: uid(), title: 'Sport', start: '18:30', end: '19:30', weekdays: [1, 3, 5], areaId: 'sport', notes: '', createdAt: c },
    { id: uid(), title: 'Lesen', start: '22:00', end: '22:30', weekdays: all, areaId: 'privat', notes: '', createdAt: c },
  );
  persist();
  render();
}

// ===========================================================================
// Arbeitszeit
// ===========================================================================
function workMinutes(w) { return Math.max(0, toMin(w.end) - toMin(w.start) - (Number(w.pause) || 0)); }

VIEWS.work = function renderWork(main) {
  const mon = mondayOf(state.date);
  const sun = addDays(mon, 6);
  main.append(dateNav(`Arbeitszeit KW ${isoWeek(mon)}`, () => { state.date = addDays(state.date, -7); render(); }, () => { state.date = addDays(state.date, 7); render(); }, () => { state.date = today(); render(); }));
  const week = DB.work.filter((w) => w.date >= mon && w.date <= sun).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const weekMin = week.reduce((s, w) => s + workMinutes(w), 0);
  const d0 = parseYmd(state.date);
  const mPrefix = d0.getFullYear() + '-' + pad(d0.getMonth() + 1);
  const monthMin = DB.work.filter((w) => w.date.startsWith(mPrefix)).reduce((s, w) => s + workMinutes(w), 0);
  const target = Number(DB.settings.weeklyWorkTarget) || 0;
  const wage = Number(DB.settings.hourlyWage) || 0;

  main.append(h('div', { class: 'stats' },
    statTile('Diese Woche', fmtHours(weekMin), target ? `Ziel ${target} h` : null),
    statTile('Differenz', target ? (weekMin >= target * 60 ? '+' : '−') + fmtHours(Math.abs(weekMin - target * 60)) : '–', 'zum Wochenziel'),
    statTile(MONTHS[d0.getMonth()], fmtHours(monthMin), wage ? (monthMin / 60 * wage).toFixed(2).replace('.', ',') + ' € brutto' : null)));
  if (target) {
    main.append(h('div', { class: 'progress-wrap' }, h('div', { class: 'progress work' }, h('div', { class: 'progress-bar', style: { width: Math.min(100, (weekMin / (target * 60)) * 100) + '%' } }))));
  }
  const list = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, 'Schichten / Arbeitszeiten'), h('button', { class: 'btn primary small', onclick: () => editWork({ date: state.date }) }, '+ Arbeitszeit')));
  if (!week.length) list.append(h('p', { class: 'muted' }, 'Keine Arbeitszeiten in dieser Woche.'));
  for (const w of week) {
    list.append(h('div', { class: 'item k-work', onclick: () => editWork(w) },
      h('span', { class: 'check-placeholder' }, '⏱'),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, fmtShort(w.date) + ' · ' + w.start + '–' + w.end),
        h('div', { class: 'item-meta' }, h('span', null, fmtHours(workMinutes(w))), w.pause ? h('span', null, 'Pause ' + w.pause + ' min') : null, w.note ? h('span', null, w.note) : null))));
  }
  main.append(list);
  main.append(h('button', { class: 'btn', onclick: exportWorkCsv }, '⬇ Arbeitszeiten als CSV (Excel) exportieren'));
};

function statTile(label, value, sub) {
  return h('div', { class: 'stat card' }, h('small', null, label), h('strong', null, value), sub ? h('span', { class: 'muted' }, sub) : null);
}

function exportWorkCsv() {
  const rows = [['Datum', 'Beginn', 'Ende', 'Pause (min)', 'Stunden', 'Notiz']];
  for (const w of [...DB.work].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))) {
    rows.push([w.date, w.start, w.end, w.pause || 0, (workMinutes(w) / 60).toFixed(2).replace('.', ','), (w.note || '').replace(/[;\n]/g, ' ')]);
  }
  download('arbeitszeiten.csv', '﻿' + rows.map((r) => r.join(';')).join('\n'), 'text/csv');
}

function download(name, content, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ===========================================================================
// Dialoge
// ===========================================================================
let modalHandler = null;
let deleteHandler = null;

function openModal(title, body, onSave, onDelete, okLabel = 'Speichern') {
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(body);
  $('#modal-ok').textContent = okLabel;
  $('#modal-delete').hidden = !onDelete;
  $('#modal-cancel').hidden = !onSave;
  modalHandler = onSave;
  deleteHandler = onDelete;
  $('#modal').showModal();
  const first = body.querySelector('input[type=text]:not([data-nofocus])');
  if (first && !first.value && window.matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 30);
}

$('#modal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (modalHandler && modalHandler($('#modal-form').elements) === false) return;
  $('#modal').close();
  render();
});
$('#modal-cancel').addEventListener('click', () => $('#modal').close());
$('#modal-delete').addEventListener('click', () => {
  if (deleteHandler && confirm('Wirklich löschen?')) { deleteHandler(); persist(); $('#modal').close(); render(); }
});

function field(label, input) { return h('label', { class: 'field' }, h('span', null, label), input); }

function areaSelect(selected, name = 'area') {
  return h('select', { name }, DB.areas.map((a) => h('option', { value: a.id, selected: a.id === selected }, a.name)));
}

function weekdayPicker(selected) {
  return h('div', { class: 'wdpicker' }, WD_ORDER.map((d) =>
    h('label', null, h('input', { type: 'checkbox', name: 'wd' + d, checked: selected.includes(d) }), h('span', null, WD_SHORT[d]))));
}
function readWeekdays(f) { return WD_ORDER.filter((d) => f['wd' + d].checked); }

function timeFields(start, end, names = ['start', 'end']) {
  const s = h('input', { name: names[0], type: 'time', value: start || '' });
  const e = h('input', { name: names[1], type: 'time', value: end || '' });
  s.addEventListener('change', () => { if (s.value && (!e.value || toMin(e.value) <= toMin(s.value))) e.value = fromMin(toMin(s.value) + 60); e.dispatchEvent(new Event('input', { bubbles: true })); });
  return h('div', { class: 'two' }, field('Von', s), field('Bis', e));
}

function checkTimes(f) {
  if (f.end.value && !f.start.value) { toast('Bitte auch eine Startzeit angeben.'); return false; }
  if (f.start.value && f.end.value && toMin(f.end.value) <= toMin(f.start.value)) { toast('Die Endzeit muss nach der Startzeit liegen.'); return false; }
  return true;
}

/** Hinweisbox bei Überschneidungen mit Vorschlag der nächsten freien Zeit. */
function conflictBox(body, ref) {
  const box = h('div', { class: 'conflict', hidden: true });
  const update = () => {
    const f = body.closest('form') ? body.closest('form').elements : null;
    if (!f || !f.date || !f.start) return;
    const date = f.date.value, start = f.start.value, end = f.end.value;
    box.replaceChildren();
    if (!date || !start) { box.hidden = true; return; }
    const c = conflictsAt(DB, date, start, end, ref);
    if (!c.length) { box.hidden = true; return; }
    const dur = (toMin(end) || toMin(start) + 60) - toMin(start);
    const free = findFreeSlot(date, dur, toMin(start), ref);
    box.append(h('strong', null, '⚠ Zu dieser Zeit ist schon etwas geplant: '), conflictText(c), '.');
    if (free !== null) {
      box.append(h('div', null, 'Nächste freie Zeit: ' + fromMin(free) + '–' + fromMin(free + dur) + ' ',
        h('button', { type: 'button', class: 'btn small', onclick: () => { f.start.value = fromMin(free); f.end.value = fromMin(free + dur); update(); } }, 'Übernehmen')));
    } else box.append(h('div', null, 'An diesem Tag gibt es kein passendes freies Zeitfenster mehr.'));
    box.append(h('div', { class: 'muted' }, 'Du kannst trotzdem speichern.'));
    box.hidden = false;
  };
  body.addEventListener('input', update);
  body.addEventListener('change', update);
  setTimeout(update, 0);
  return box;
}

const REMINDER_OPTS = [['', 'Standard'], ['off', 'Keine'], ['0', 'Zum Beginn'], ['5', '5 min vorher'], ['10', '10 min vorher'], ['15', '15 min vorher'], ['30', '30 min vorher'], ['60', '1 h vorher'], ['120', '2 h vorher'], ['1440', '1 Tag vorher']];

function subtaskEditor(list) {
  const wrap = h('div', { class: 'subedit' });
  const draw = () => {
    wrap.replaceChildren();
    list.forEach((s, idx) => {
      const txt = h('input', { type: 'text', value: s.title, 'data-nofocus': '1' });
      txt.addEventListener('input', () => (s.title = txt.value));
      wrap.append(h('div', { class: 'subedit-row' },
        h('input', { type: 'checkbox', checked: s.done, onchange: (e) => (s.done = e.target.checked) }), txt,
        h('button', { type: 'button', class: 'btn icon small', title: 'Hoch', disabled: idx === 0, onclick: () => { list.splice(idx - 1, 0, list.splice(idx, 1)[0]); draw(); } }, '↑'),
        h('button', { type: 'button', class: 'btn icon small', title: 'Entfernen', onclick: () => { list.splice(idx, 1); draw(); } }, '✕')));
    });
    const add = h('input', { type: 'text', placeholder: '+ Unteraufgabe hinzufügen (Enter)', 'data-nofocus': '1' });
    add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (add.value.trim()) { list.push({ id: uid(), title: add.value.trim(), done: false }); draw(); wrap.querySelector('input[placeholder]').focus(); } }
    });
    wrap.append(add);
  };
  draw();
  return wrap;
}

function editTodo(t = {}) {
  const isNew = !t.id;
  const subtasks = (t.subtasks || []).map((s) => ({ ...s }));
  const body = h('div', { class: 'form' });
  body.append(
    field('Titel', h('input', { name: 'title', type: 'text', value: t.title || '', required: true, placeholder: 'z. B. Übungsblatt 3 abgeben' })),
    field('Datum', h('input', { name: 'date', type: 'date', value: t.date || today(), required: true })),
    timeFields(t.start, t.end),
    conflictBox(body, isNew ? null : t),
    h('div', { class: 'two' }, field('Bereich', areaSelect(t.areaId || state.areaFilter || 'privat')),
      field('Priorität', h('select', { name: 'prio' }, ['hoch', 'normal', 'niedrig'].map((p) => h('option', { value: p, selected: (t.priority || 'normal') === p }, p[0].toUpperCase() + p.slice(1)))))),
    h('div', { class: 'two' },
      field('Gehört zu Prüfung (Lernplan)', h('select', { name: 'exam' }, h('option', { value: '' }, '– keine –'),
        DB.exams.map((x) => h('option', { value: x.id, selected: t.examId === x.id }, x.subject)))),
      field('Erinnerung (Push)', h('select', { name: 'reminder' }, REMINDER_OPTS.map(([v, l]) => h('option', { value: v, selected: String(t.reminder ?? '') === v }, l))))),
    field('Unteraufgaben', subtaskEditor(subtasks)),
    field('Notizen', h('textarea', { name: 'notes', rows: 3 }, t.notes || '')),
    isNew ? h('div', { class: 'two' },
      field('Wiederholen', h('select', { name: 'repeat' }, h('option', { value: '' }, 'Nein'), h('option', { value: '1' }, 'Täglich'), h('option', { value: '7' }, 'Wöchentlich'), h('option', { value: '14' }, 'Alle 2 Wochen'))),
      field('Anzahl Termine', h('input', { name: 'times', type: 'number', min: 1, max: 52, value: 1 }))) : null);
  openModal(isNew ? 'Neues To-Do' : 'To-Do bearbeiten', body, (f) => {
    if (!checkTimes(f)) return false;
    const subs = subtasks.filter((s) => s.title.trim());
    const vals = { title: f.title.value.trim(), date: f.date.value, start: f.start.value, end: f.end.value, areaId: f.area.value, priority: f.prio.value, examId: f.exam.value || undefined, notes: f.notes.value, reminder: f.reminder.value, subtasks: subs };
    if (isNew) {
      const step = Number(f.repeat.value) || 0;
      const times = step ? Math.max(1, Number(f.times.value) || 1) : 1;
      for (let i = 0; i < times; i++) DB.todos.push({ id: uid(), done: false, ...vals, subtasks: subs.map((s) => ({ ...s, id: uid() })), date: addDays(vals.date, i * step) });
    } else Object.assign(t, vals);
    persist();
  }, isNew ? null : () => { DB.todos = DB.todos.filter((x) => x !== t); });
}

function editRoutine(r = {}) {
  const isNew = !r.id;
  const body = h('div', { class: 'form' },
    field('Titel', h('input', { name: 'title', type: 'text', value: r.title || '', required: true, placeholder: 'z. B. Morgenroutine, Sport, Vokabeln' })),
    timeFields(r.start, r.end),
    field('Wochentage', weekdayPicker(r.weekdays || [0, 1, 2, 3, 4, 5, 6])),
    h('div', { class: 'two' }, field('Bereich', areaSelect(r.areaId || 'privat')),
      field('Erinnerung (Push)', h('select', { name: 'reminder' }, REMINDER_OPTS.map(([v, l]) => h('option', { value: v, selected: String(r.reminder ?? '') === v }, l))))),
    h('div', { class: 'two' }, field('Gültig ab (optional)', h('input', { name: 'from', type: 'date', value: r.startDate || '' })),
      field('Gültig bis (optional)', h('input', { name: 'to', type: 'date', value: r.endDate || '' }))),
    field('Notizen', h('textarea', { name: 'notes', rows: 2 }, r.notes || '')));
  openModal(isNew ? 'Neue Routine' : 'Routine bearbeiten', body, (f) => {
    if (!checkTimes(f)) return false;
    const wds = readWeekdays(f);
    if (!wds.length) { toast('Bitte mindestens einen Wochentag wählen.'); return false; }
    const vals = { title: f.title.value.trim(), start: f.start.value, end: f.end.value, weekdays: wds, areaId: f.area.value, reminder: f.reminder.value, startDate: f.from.value || undefined, endDate: f.to.value || undefined, notes: f.notes.value };
    if (isNew) DB.routines.push({ id: uid(), createdAt: today(), ...vals });
    else Object.assign(r, vals);
    persist();
  }, isNew ? null : () => { DB.routines = DB.routines.filter((x) => x !== r); });
}

function editWork(w = {}) {
  const isNew = !w.id;
  const body = h('div', { class: 'form' });
  body.append(
    field('Datum', h('input', { name: 'date', type: 'date', value: w.date || today(), required: true })),
    h('div', { class: 'two' }, field('Beginn', h('input', { name: 'start', type: 'time', value: w.start || '09:00', required: true })),
      field('Ende', h('input', { name: 'end', type: 'time', value: w.end || '13:00', required: true }))),
    conflictBox(body, isNew ? null : w),
    h('div', { class: 'two' }, field('Pause (Minuten)', h('input', { name: 'pause', type: 'number', min: 0, max: 600, value: w.pause || 0 })),
      field('Notiz / Arbeitgeber', h('input', { name: 'note', type: 'text', value: w.note || '', 'data-nofocus': '1' }))),
    isNew ? field('Wöchentlich wiederholen (Anzahl Wochen)', h('input', { name: 'weeks', type: 'number', min: 1, max: 52, value: 1 })) : null);
  openModal(isNew ? 'Arbeitszeit eintragen' : 'Arbeitszeit bearbeiten', body, (f) => {
    if (!checkTimes(f)) return false;
    const vals = { date: f.date.value, start: f.start.value, end: f.end.value, pause: Number(f.pause.value) || 0, note: f.note.value.trim() };
    if (isNew) {
      const weeks = Math.max(1, Number(f.weeks.value) || 1);
      for (let i = 0; i < weeks; i++) DB.work.push({ id: uid(), ...vals, date: addDays(vals.date, i * 7) });
    } else Object.assign(w, vals);
    persist();
  }, isNew ? null : () => { DB.work = DB.work.filter((x) => x !== w); });
}
