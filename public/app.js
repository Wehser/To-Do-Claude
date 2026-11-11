'use strict';
/* Mein Planer – Frontend (ohne Frameworks) */

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function today() { return ymd(new Date()); }
function weekday(s) { return parseYmd(s).getDay(); }
function mondayOf(s) { const wd = weekday(s); return addDays(s, wd === 0 ? -6 : 1 - wd); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function toMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMin(m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
function fmtDate(s, opts = {}) {
  const d = parseYmd(s);
  const base = d.getDate() + '. ' + MONTHS[d.getMonth()] + (opts.year ? ' ' + d.getFullYear() : '');
  return opts.weekday === false ? base : WD_LONG[d.getDay()] + ', ' + base;
}
function fmtShort(s) { const d = parseYmd(s); return WD_SHORT[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
function fmtHours(min) { const h = Math.floor(min / 60), m = min % 60; return h + ':' + pad(m) + ' h'; }
function relDay(s) {
  const diff = daysBetween(today(), s);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return null;
}

/** Element-Builder: h('div', {class: 'x', onclick: fn}, 'Text', child) – Texte werden immer sicher eingefügt. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
      else if (k === 'dataset') Object.assign(el.dataset, v);
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

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ===========================================================================
// Daten & Synchronisation
// ===========================================================================
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
    settings: {
      dayStart: 6,
      dayEnd: 23,
      weeklyWorkTarget: 20,
      hourlyWage: 0,
      colors: { routine: '#3b82f6', todo: '#f59e0b', work: '#10b981', study: '#8b5cf6' },
      theme: 'auto',
    },
  };
}

let DB = defaultData();
let version = 0;
let dirty = false;
let saveTimer = null;
let saving = false;

function normalize(d) {
  const base = defaultData();
  const out = Object.assign(base, d || {});
  out.settings = Object.assign(defaultData().settings, (d && d.settings) || {});
  out.settings.colors = Object.assign(defaultData().settings.colors, (d && d.settings && d.settings.colors) || {});
  return out;
}

function setSync(state, title) {
  const s = $('#sync');
  s.className = 'sync ' + state;
  s.title = title;
}

async function load() {
  const r = await fetch('/api/data', { cache: 'no-store' });
  if (r.status === 401) return (location.href = '/login');
  const j = await r.json();
  version = j.version || 0;
  DB = normalize(j.data);
  setSync('ok', 'Gespeichert');
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
  if (dirty || saving || document.hidden) return;
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

function routineActive(r, date) {
  if (!r.weekdays.includes(weekday(date))) return false;
  if (r.startDate && date < r.startDate) return false;
  if (r.endDate && date > r.endDate) return false;
  return true;
}

function routineState(rid, date) { return (DB.routineChecks[date] || {})[rid] || null; }

function setRoutineState(rid, date, state) {
  const day = DB.routineChecks[date] || (DB.routineChecks[date] = {});
  if (state) day[rid] = state; else delete day[rid];
  if (!Object.keys(day).length) delete DB.routineChecks[date];
  persist();
}

/** Alle Einträge eines Tages in einheitlicher Form. */
function itemsFor(date, filterArea = null) {
  const items = [];
  for (const r of DB.routines) {
    if (!routineActive(r, date)) continue;
    const st = routineState(r.id, date);
    items.push({ kind: 'routine', ref: r, title: r.title, start: r.start, end: r.end, areaId: r.areaId, done: st === 'done', skipped: st === 'skip', notes: r.notes });
  }
  for (const t of DB.todos) {
    if (t.date !== date) continue;
    items.push({ kind: t.examId ? 'study' : 'todo', ref: t, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: !!t.done, priority: t.priority, notes: t.notes });
  }
  for (const w of DB.work) {
    if (w.date !== date) continue;
    items.push({ kind: 'work', ref: w, title: w.note ? 'Arbeit: ' + w.note : 'Arbeit', start: w.start, end: w.end, areaId: 'arbeit', done: false, isWork: true });
  }
  const filtered = filterArea ? items.filter((i) => i.areaId === filterArea) : items;
  return filtered.sort((a, b) => (toMin(a.start) ?? 9999) - (toMin(b.start) ?? 9999) || a.title.localeCompare(b.title));
}

function overdueTodos() {
  const t = today();
  return DB.todos.filter((x) => !x.done && x.date < t).sort((a, b) => a.date.localeCompare(b.date));
}

function toggleItem(item) {
  if (item.kind === 'routine') setRoutineState(item.ref.id, state.date, item.done ? null : 'done');
  else if (!item.isWork) { item.ref.done = !item.ref.done; persist(); }
  render();
}

function routineStreak(r) {
  let n = 0;
  let d = today();
  // Heute zählt nur, wenn schon erledigt
  if (routineActive(r, d) && routineState(r.id, d) !== 'done') d = addDays(d, -1);
  for (let i = 0; i < 366; i++) {
    if (r.startDate && d < r.startDate) break;
    if (routineActive(r, d)) {
      const st = routineState(r.id, d);
      if (st === 'done') n++;
      else if (st !== 'skip') break;
    }
    d = addDays(d, -1);
  }
  return n;
}

// ===========================================================================
// Zustand der Oberfläche
// ===========================================================================
const state = {
  view: localStorage.getItem('planer.view') || 'day',
  date: today(),
  areaFilter: null,
};

function setView(v) {
  state.view = v;
  try { localStorage.setItem('planer.view', v); } catch (_) { /* egal */ }
  render();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('#fab').addEventListener('click', () => {
  if (state.view === 'routines') editRoutine();
  else if (state.view === 'study') editExam();
  else if (state.view === 'work') editWork({ date: state.date });
  else editTodo({ date: state.date });
});

function applyTheme() {
  const c = DB.settings.colors;
  const root = document.documentElement;
  root.style.setProperty('--c-routine', c.routine);
  root.style.setProperty('--c-todo', c.todo);
  root.style.setProperty('--c-work', c.work);
  root.style.setProperty('--c-study', c.study);
  root.dataset.theme = DB.settings.theme || 'auto';
}

function render() {
  applyTheme();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const main = $('#main');
  main.replaceChildren();
  const views = { day: renderDay, week: renderWeek, routines: renderRoutines, study: renderStudy, work: renderWork, settings: renderSettings };
  (views[state.view] || renderDay)(main);
  $('#fab').hidden = state.view === 'settings';
}

// ===========================================================================
// Gemeinsame UI-Bausteine
// ===========================================================================
const KIND_LABEL = { routine: 'Routine', todo: 'To-Do', study: 'Lernen', work: 'Arbeit' };

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
  return h('div', { class: 'legend' },
    ['routine', 'todo', 'study', 'work'].map((k) => h('span', { class: 'legend-item k-' + k }, h('i'), KIND_LABEL[k])));
}

function openItem(item) {
  if (item.kind === 'routine') editRoutine(item.ref);
  else if (item.kind === 'work') editWork(item.ref);
  else editTodo(item.ref);
}

function itemRow(item, opts = {}) {
  const row = h('div', { class: 'item k-' + item.kind + (item.done ? ' done' : '') + (item.skipped ? ' skipped' : '') });
  if (!item.isWork) {
    row.append(h('input', { type: 'checkbox', class: 'check', checked: item.done, disabled: item.skipped, onclick: (e) => { e.stopPropagation(); toggleItem(item); }, title: 'Erledigt' }));
  } else row.append(h('span', { class: 'check-placeholder' }, '⏱'));
  const time = item.start ? item.start + (item.end ? '–' + item.end : '') : '';
  const ex = item.ref.examId ? exam(item.ref.examId) : null;
  row.append(h('div', { class: 'item-main', onclick: () => openItem(item) },
    h('div', { class: 'item-title' },
      item.priority === 'hoch' ? h('span', { class: 'prio', title: 'Hohe Priorität' }, '!') : null,
      item.title),
    h('div', { class: 'item-meta' },
      time ? h('span', null, time) : null,
      opts.showDate && item.ref.date ? h('span', null, fmtShort(item.ref.date)) : null,
      h('span', { class: 'kind-label' }, KIND_LABEL[item.kind]),
      ex ? h('span', null, '📚 ' + ex.subject) : null,
      areaChip(item.areaId),
      item.skipped ? h('span', null, 'übersprungen') : null)));
  if (item.kind === 'routine') {
    row.append(h('button', {
      class: 'btn icon small', title: item.skipped ? 'Wieder aktivieren' : 'Heute überspringen',
      onclick: (e) => { e.stopPropagation(); setRoutineState(item.ref.id, state.date, item.skipped ? null : 'skip'); render(); },
    }, item.skipped ? '↺' : '⤼'));
  }
  if (opts.extra) row.append(opts.extra);
  return row;
}

// ===========================================================================
// Tagesansicht
// ===========================================================================
function renderDay(main) {
  const d = state.date;
  const items = itemsFor(d, state.areaFilter);
  const label = (relDay(d) ? relDay(d) + ' · ' : '') + fmtDate(d, { year: true });
  main.append(dateNav(label, () => { state.date = addDays(d, -1); render(); }, () => { state.date = addDays(d, 1); render(); }, () => { state.date = today(); render(); }));
  main.append(areaFilterBar());

  const checkable = items.filter((i) => !i.isWork && !i.skipped);
  const done = checkable.filter((i) => i.done).length;
  const pct = checkable.length ? Math.round((done / checkable.length) * 100) : 0;
  main.append(h('div', { class: 'progress-wrap' },
    h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: pct + '%' } })),
    h('span', { class: 'muted' }, `${done} von ${checkable.length} erledigt`)));

  const layout = h('div', { class: 'day-layout' });
  layout.append(timeline(d, items.filter((i) => i.start)));

  const side = h('div', { class: 'day-side' });
  // Überfällige To-Dos
  if (d === today()) {
    const od = overdueTodos();
    if (od.length) {
      const box = h('section', { class: 'card warn' }, h('h3', null, `Überfällig (${od.length})`));
      for (const t of od) {
        const it = { kind: t.examId ? 'study' : 'todo', ref: t, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: false, priority: t.priority };
        box.append(itemRow(it, { showDate: true, extra: h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); t.date = today(); persist(); render(); } }, '→ heute') }));
      }
      if (od.length > 1) box.append(h('button', { class: 'btn small', onclick: () => { od.forEach((t) => (t.date = today())); persist(); render(); } }, 'Alle auf heute verschieben'));
      side.append(box);
    }
  }
  const noTime = items.filter((i) => !i.start);
  const listBox = h('section', { class: 'card' }, h('h3', null, 'Ohne Uhrzeit'));
  if (!noTime.length) listBox.append(h('p', { class: 'muted' }, 'Keine Einträge ohne Uhrzeit.'));
  noTime.forEach((i) => listBox.append(itemRow(i)));
  listBox.append(quickAdd(d));
  side.append(listBox);

  const allBox = h('section', { class: 'card' }, h('h3', null, 'Alle Einträge'));
  if (!items.length) allBox.append(h('p', { class: 'muted' }, 'Noch nichts geplant. Mit + oder einem Klick in den Zeitplan hinzufügen.'));
  items.filter((i) => i.start).forEach((i) => allBox.append(itemRow(i)));
  side.append(allBox);

  // Tagesnotiz
  const note = h('textarea', { class: 'daynote', placeholder: 'Notizen / Reflexion für diesen Tag …', rows: 3 });
  note.value = DB.notes[d] || '';
  note.addEventListener('input', () => { if (note.value) DB.notes[d] = note.value; else delete DB.notes[d]; persist(); });
  side.append(h('section', { class: 'card' }, h('h3', null, 'Tagesnotiz'), note));

  layout.append(side);
  main.append(layout);
  main.append(legend());
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
      end = m[3] ? pad(m[3]) + ':' + m[4] : fromMin(Math.min(toMin(start) + 60, 23 * 60 + 59));
      text = m[5];
    }
    DB.todos.push({ id: uid(), title: text, date, start, end, areaId: state.areaFilter || 'privat', priority: 'normal', done: false, notes: '' });
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
      editTodo({ date, start: fromMin(st), end: fromMin(Math.min(st + 60, 23 * 60 + 59)) });
    });
    wrap.append(slot);
  }
  for (const ev of layoutColumns(items)) {
    const i = ev.item;
    const top = ((ev.s - startH * 60) / 60) * HOUR;
    const height = Math.max(((ev.e - ev.s) / 60) * HOUR - 2, 20);
    const block = h('div', {
      class: 'event k-' + i.kind + (i.done ? ' done' : '') + (i.skipped ? ' skipped' : ''),
      style: { top: top + 'px', height: height + 'px', left: `calc(52px + (100% - 56px) * ${ev.col / ev.cols})`, width: `calc((100% - 56px) / ${ev.cols} - 3px)` },
      onclick: (e) => { e.stopPropagation(); openItem(i); },
      title: i.title,
    },
    !i.isWork && !i.skipped ? h('input', { type: 'checkbox', checked: i.done, onclick: (e) => { e.stopPropagation(); toggleItem(i); } }) : null,
    h('div', { class: 'event-text' },
      h('strong', null, i.title),
      h('span', null, ' ' + i.start + (i.end ? '–' + i.end : ''))));
    wrap.append(block);
  }
  // Jetzt-Linie
  if (date === today()) {
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    if (m >= startH * 60 && m <= endH * 60) wrap.append(h('div', { class: 'nowline', style: { top: ((m - startH * 60) / 60) * HOUR + 'px' } }));
  }
  return wrap;
}

// ===========================================================================
// Wochenansicht
// ===========================================================================
function renderWeek(main) {
  const mon = mondayOf(state.date);
  const sun = addDays(mon, 6);
  const kw = isoWeek(mon);
  main.append(dateNav(`KW ${kw} · ${fmtDate(mon, { weekday: false })} – ${fmtDate(sun, { weekday: false, year: true })}`,
    () => { state.date = addDays(state.date, -7); render(); }, () => { state.date = addDays(state.date, 7); render(); }, () => { state.date = today(); render(); }));
  main.append(areaFilterBar());
  const grid = h('div', { class: 'week' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const items = itemsFor(d, state.areaFilter);
    const col = h('div', { class: 'week-day' + (d === today() ? ' today' : '') },
      h('button', { class: 'week-head', onclick: () => { state.date = d; setView('day'); } }, fmtShort(d)));
    for (const it of items) {
      col.append(h('div', { class: 'mini k-' + it.kind + (it.done ? ' done' : '') + (it.skipped ? ' skipped' : ''), onclick: () => { state.date = d; openItem(it); } },
        it.start ? h('span', { class: 'mini-time' }, it.start) : null, it.title));
    }
    col.append(h('button', { class: 'mini-add', onclick: () => editTodo({ date: d }) }, '+ To-Do'));
    grid.append(col);
  }
  main.append(grid);

  // Wochenauswertung je Bereich
  const sums = {};
  for (let i = 0; i < 7; i++) {
    for (const it of itemsFor(addDays(mon, i))) {
      if (!it.start || !it.end) continue;
      const dur = toMin(it.end) - toMin(it.start);
      if (dur <= 0) continue;
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
}

function isoWeek(s) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

// ===========================================================================
// Routinen
// ===========================================================================
function weekdayText(wds) {
  if (wds.length === 7) return 'Täglich';
  if (wds.length === 5 && [1, 2, 3, 4, 5].every((x) => wds.includes(x))) return 'Mo–Fr';
  if (wds.length === 2 && wds.includes(0) && wds.includes(6)) return 'Wochenende';
  return WD_ORDER.filter((x) => wds.includes(x)).map((x) => WD_SHORT[x]).join(', ');
}

function renderRoutines(main) {
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
    const streak = routineStreak(r);
    // Quote der letzten 30 Tage
    let due = 0, done = 0;
    for (let i = 1; i <= 30; i++) {
      const d = addDays(today(), -i);
      if (!routineActive(r, d) || (r.createdAt && d < r.createdAt)) continue;
      const st = routineState(r.id, d);
      if (st === 'skip') continue;
      due++;
      if (st === 'done') done++;
    }
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
        h('strong', null, '🔥 ' + streak), h('small', null, due ? Math.round((done / due) * 100) + ' %' : '–'))));
  }
  main.append(list);
}

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
// Lernplan
// ===========================================================================
function renderStudy(main) {
  main.append(h('div', { class: 'view-head' }, h('h2', null, 'Lernplan'),
    h('button', { class: 'btn primary', onclick: () => editExam() }, '+ Prüfung / Fach')));
  main.append(h('p', { class: 'muted' }, 'Lege Prüfungen oder Abgaben an und lass dir Lerneinheiten automatisch bis zum Termin verteilen. Lerneinheiten erscheinen lila im Tagesplan.'));
  if (!DB.exams.length) {
    main.append(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Noch keine Prüfungen angelegt.')));
    return;
  }
  const sorted = [...DB.exams].sort((a, b) => a.date.localeCompare(b.date));
  for (const x of sorted) {
    const sessions = DB.todos.filter((t) => t.examId === x.id).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const doneCount = sessions.filter((t) => t.done).length;
    const left = daysBetween(today(), x.date);
    const pct = sessions.length ? Math.round((doneCount / sessions.length) * 100) : 0;
    const card = h('section', { class: 'card exam' + (left < 0 ? ' past' : '') },
      h('div', { class: 'exam-head' },
        h('div', null, h('h3', null, x.subject), h('div', { class: 'item-meta' },
          h('span', null, (x.type || 'Prüfung') + ': ' + fmtDate(x.date, { year: true }) + (x.time ? ', ' + x.time : '')),
          areaChip(x.areaId))),
        h('div', { class: 'countdown' + (left <= 7 && left >= 0 ? ' soon' : '') },
          h('strong', null, left < 0 ? '✓' : String(left)), h('small', null, left < 0 ? 'vorbei' : left === 1 ? 'Tag' : 'Tage'))),
      h('div', { class: 'progress-wrap' }, h('div', { class: 'progress study' }, h('div', { class: 'progress-bar', style: { width: pct + '%' } })),
        h('span', { class: 'muted' }, `${doneCount}/${sessions.length} Lerneinheiten`)),
      x.topics ? h('p', { class: 'topics' }, x.topics) : null,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', onclick: () => generateSessions(x) }, '⚙ Lerneinheiten planen'),
        h('button', { class: 'btn small', onclick: () => editTodo({ date: today(), examId: x.id, areaId: x.areaId, title: 'Lernen: ' + x.subject }) }, '+ Einzelne Einheit'),
        h('button', { class: 'btn small', onclick: () => editExam(x) }, 'Bearbeiten')));
    const upcoming = sessions.filter((t) => !t.done && t.date >= today()).slice(0, 5);
    if (upcoming.length) {
      card.append(h('h4', null, 'Nächste Einheiten'));
      upcoming.forEach((t) => card.append(itemRow({ kind: 'study', ref: t, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: t.done }, { showDate: true })));
    }
    main.append(card);
  }
}

function generateSessions(x) {
  const body = h('div', { class: 'form' },
    field('Anzahl Lerneinheiten', h('input', { name: 'count', type: 'number', min: 1, max: 200, value: 10, required: true })),
    field('Dauer pro Einheit (Minuten)', h('input', { name: 'dur', type: 'number', min: 15, max: 600, step: 15, value: 90, required: true })),
    field('Uhrzeit', h('input', { name: 'start', type: 'time', value: '10:00', required: true })),
    field('Beginnen am', h('input', { name: 'from', type: 'date', value: addDays(today(), 1), required: true })),
    field('Lerntage', weekdayPicker([1, 2, 3, 4, 5, 6])),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'replace', checked: true }), ' Bisher geplante, offene Einheiten ersetzen'),
    h('p', { class: 'muted' }, `Die Einheiten werden gleichmäßig bis zum Tag vor dem Termin (${fmtShort(x.date)}) verteilt. Die letzte Einheit ist eine Wiederholung.`));
  openModal('Lerneinheiten planen: ' + x.subject, body, (f) => {
    const wds = readWeekdays(f);
    const count = Number(f.count.value);
    const dur = Number(f.dur.value);
    const days = [];
    for (let d = f.from.value; d < x.date; d = addDays(d, 1)) if (wds.includes(weekday(d))) days.push(d);
    if (!days.length) { toast('Zwischen Beginn und Termin liegen keine passenden Tage.'); return false; }
    if (f.replace.checked) DB.todos = DB.todos.filter((t) => t.examId !== x.id || t.done);
    const startMin = toMin(f.start.value);
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? days.length - 1 : Math.round((i * (days.length - 1)) / (count - 1));
      const d = days[idx];
      // Wenn mehrere Einheiten auf denselben Tag fallen, hintereinander legen
      const sameDay = DB.todos.filter((t) => t.examId === x.id && t.date === d && !t.done).length;
      const s = Math.min(startMin + sameDay * (dur + 15), 23 * 60);
      DB.todos.push({
        id: uid(), title: (i === count - 1 && count > 1 ? 'Wiederholung: ' : 'Lernen: ') + x.subject + ` (${i + 1}/${count})`,
        date: d, start: fromMin(s), end: fromMin(Math.min(s + dur, 23 * 60 + 59)), areaId: x.areaId || 'uni',
        priority: 'normal', done: false, notes: '', examId: x.id,
      });
    }
    persist();
    toast(count + ' Lerneinheiten geplant');
  }, null, 'Planen');
}

// ===========================================================================
// Arbeitszeit
// ===========================================================================
function renderWork(main) {
  const mon = mondayOf(state.date);
  const sun = addDays(mon, 6);
  main.append(dateNav(`Arbeitszeit KW ${isoWeek(mon)}`, () => { state.date = addDays(state.date, -7); render(); }, () => { state.date = addDays(state.date, 7); render(); }, () => { state.date = today(); render(); }));
  const dur = (w) => Math.max(0, toMin(w.end) - toMin(w.start) - (Number(w.pause) || 0));
  const week = DB.work.filter((w) => w.date >= mon && w.date <= sun).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const weekMin = week.reduce((s, w) => s + dur(w), 0);
  const d0 = parseYmd(state.date);
  const mPrefix = d0.getFullYear() + '-' + pad(d0.getMonth() + 1);
  const monthMin = DB.work.filter((w) => w.date.startsWith(mPrefix)).reduce((s, w) => s + dur(w), 0);
  const target = Number(DB.settings.weeklyWorkTarget) || 0;
  const wage = Number(DB.settings.hourlyWage) || 0;

  main.append(h('div', { class: 'stats' },
    stat('Diese Woche', fmtHours(weekMin), target ? `Ziel ${target} h` : null),
    stat('Differenz', target ? (weekMin >= target * 60 ? '+' : '−') + fmtHours(Math.abs(weekMin - target * 60)) : '–', 'zum Wochenziel'),
    stat(MONTHS[d0.getMonth()], fmtHours(monthMin), wage ? (monthMin / 60 * wage).toFixed(2).replace('.', ',') + ' € brutto' : null)));
  if (target) {
    main.append(h('div', { class: 'progress-wrap' }, h('div', { class: 'progress work' }, h('div', { class: 'progress-bar', style: { width: Math.min(100, (weekMin / (target * 60)) * 100) + '%' } }))));
  }
  const list = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, 'Schichten / Arbeitszeiten'), h('button', { class: 'btn primary small', onclick: () => editWork({ date: state.date }) }, '+ Arbeitszeit')));
  if (!week.length) list.append(h('p', { class: 'muted' }, 'Keine Arbeitszeiten in dieser Woche.'));
  for (const w of week) {
    list.append(h('div', { class: 'item k-work', onclick: () => editWork(w) },
      h('span', { class: 'check-placeholder' }, '⏱'),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, fmtShort(w.date) + ' · ' + w.start + '–' + w.end),
        h('div', { class: 'item-meta' }, h('span', null, fmtHours(dur(w))), w.pause ? h('span', null, 'Pause ' + w.pause + ' min') : null, w.note ? h('span', null, w.note) : null))));
  }
  main.append(list);
  main.append(h('button', { class: 'btn', onclick: exportWorkCsv }, '⬇ Arbeitszeiten als CSV (Excel) exportieren'));
}

function stat(label, value, sub) {
  return h('div', { class: 'stat card' }, h('small', null, label), h('strong', null, value), sub ? h('span', { class: 'muted' }, sub) : null);
}

function exportWorkCsv() {
  const rows = [['Datum', 'Beginn', 'Ende', 'Pause (min)', 'Stunden', 'Notiz']];
  for (const w of [...DB.work].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))) {
    const min = Math.max(0, toMin(w.end) - toMin(w.start) - (Number(w.pause) || 0));
    rows.push([w.date, w.start, w.end, w.pause || 0, (min / 60).toFixed(2).replace('.', ','), (w.note || '').replace(/[;\n]/g, ' ')]);
  }
  download('arbeitszeiten.csv', '﻿' + rows.map((r) => r.join(';')).join('\n'), 'text/csv');
}

// ===========================================================================
// Einstellungen
// ===========================================================================
function renderSettings(main) {
  const s = DB.settings;
  main.append(h('h2', null, 'Einstellungen'));

  const colors = h('section', { class: 'card' }, h('h3', null, 'Farben der Kategorien'));
  for (const k of ['routine', 'todo', 'study', 'work']) {
    const inp = h('input', { type: 'color', value: s.colors[k] });
    inp.addEventListener('input', () => { s.colors[k] = inp.value; applyTheme(); persist(); });
    colors.append(h('label', { class: 'set-row' }, h('span', null, KIND_LABEL[k]), inp));
  }
  main.append(colors);

  const areasBox = h('section', { class: 'card' }, h('h3', null, 'Bereiche (z. B. Uni, Arbeit, Privat)'));
  for (const a of DB.areas) {
    const name = h('input', { type: 'text', value: a.name });
    name.addEventListener('change', () => { a.name = name.value.trim() || a.name; persist(); });
    const col = h('input', { type: 'color', value: a.color });
    col.addEventListener('input', () => { a.color = col.value; persist(); });
    const del = h('button', { class: 'btn icon small', title: 'Bereich löschen', onclick: () => {
      if (DB.areas.length <= 1) return toast('Mindestens ein Bereich wird benötigt.');
      if (!confirm(`Bereich „${a.name}“ löschen? Einträge behalten ihren Inhalt, verlieren aber die Zuordnung.`)) return;
      DB.areas = DB.areas.filter((x) => x !== a); persist(); render();
    } }, '✕');
    areasBox.append(h('div', { class: 'set-row' }, name, col, del));
  }
  areasBox.append(h('button', { class: 'btn small', onclick: () => { DB.areas.push({ id: uid(), name: 'Neuer Bereich', color: '#0ea5e9' }); persist(); render(); } }, '+ Bereich'));
  main.append(areasBox);

  const gen = h('section', { class: 'card' }, h('h3', null, 'Allgemein'));
  const numRow = (label, key, min, max, step = 1) => {
    const inp = h('input', { type: 'number', min, max, step, value: s[key] });
    inp.addEventListener('change', () => { s[key] = Number(inp.value); persist(); });
    return h('label', { class: 'set-row' }, h('span', null, label), inp);
  };
  gen.append(numRow('Tagesansicht ab (Uhr)', 'dayStart', 0, 23), numRow('Tagesansicht bis (Uhr)', 'dayEnd', 1, 24),
    numRow('Wochenziel Arbeitsstunden', 'weeklyWorkTarget', 0, 80), numRow('Stundenlohn (€, optional)', 'hourlyWage', 0, 500, 0.01));
  const theme = h('select', null, ['auto', 'light', 'dark'].map((v) => h('option', { value: v, selected: s.theme === v }, { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' }[v])));
  theme.addEventListener('change', () => { s.theme = theme.value; applyTheme(); persist(); });
  gen.append(h('label', { class: 'set-row' }, h('span', null, 'Design'), theme));
  main.append(gen);

  const backup = h('section', { class: 'card' }, h('h3', null, 'Datensicherung'),
    h('p', { class: 'muted' }, 'Lade regelmäßig eine Sicherung herunter. Damit kannst du deine Daten jederzeit wiederherstellen.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => download('planer-backup-' + today() + '.json', JSON.stringify(DB, null, 2), 'application/json') }, '⬇ Backup herunterladen'),
      h('button', { class: 'btn', onclick: importBackup }, '⬆ Backup einspielen'),
      h('button', { class: 'btn', onclick: () => {
        const cutoff = addDays(today(), -60);
        const before = DB.todos.length;
        DB.todos = DB.todos.filter((t) => !(t.done && t.date < cutoff));
        for (const d of Object.keys(DB.routineChecks)) if (d < addDays(today(), -400)) delete DB.routineChecks[d];
        persist(); toast((before - DB.todos.length) + ' alte, erledigte To-Dos entfernt');
      } }, 'Aufräumen (erledigte To-Dos älter als 60 Tage)')));
  main.append(backup);

  main.append(h('section', { class: 'card' }, h('h3', null, 'Konto'),
    h('button', { class: 'btn danger', onclick: async () => { await saveNow(); await fetch('/api/logout'); location.href = '/login'; } }, 'Abmelden')));
}

function download(name, content, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importBackup() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!data || !Array.isArray(data.todos)) throw new Error('Format');
      if (!confirm('Alle aktuellen Daten durch das Backup ersetzen?')) return;
      DB = normalize(data);
      persist();
      render();
      toast('Backup eingespielt');
    } catch (_) {
      toast('Die Datei ist kein gültiges Backup.');
    }
  });
  inp.click();
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
  modalHandler = onSave;
  deleteHandler = onDelete;
  $('#modal').showModal();
  const first = body.querySelector('input[type=text], input:not([type])');
  if (first) setTimeout(() => first.focus(), 30);
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

function areaSelect(selected) {
  return h('select', { name: 'area' }, DB.areas.map((a) => h('option', { value: a.id, selected: a.id === selected }, a.name)));
}

function weekdayPicker(selected) {
  return h('div', { class: 'wdpicker' }, WD_ORDER.map((d) =>
    h('label', null, h('input', { type: 'checkbox', name: 'wd' + d, checked: selected.includes(d) }), h('span', null, WD_SHORT[d]))));
}
function readWeekdays(f) { return WD_ORDER.filter((d) => f['wd' + d].checked); }

function timeFields(start, end) {
  const s = h('input', { name: 'start', type: 'time', value: start || '' });
  const e = h('input', { name: 'end', type: 'time', value: end || '' });
  s.addEventListener('change', () => { if (s.value && (!e.value || toMin(e.value) <= toMin(s.value))) e.value = fromMin(Math.min(toMin(s.value) + 60, 23 * 60 + 59)); });
  return h('div', { class: 'two' }, field('Von', s), field('Bis', e));
}

function checkTimes(f) {
  if (f.end.value && !f.start.value) { toast('Bitte auch eine Startzeit angeben.'); return false; }
  if (f.start.value && f.end.value && toMin(f.end.value) <= toMin(f.start.value)) { toast('Die Endzeit muss nach der Startzeit liegen.'); return false; }
  return true;
}

function editTodo(t = {}) {
  const isNew = !t.id;
  const body = h('div', { class: 'form' },
    field('Titel', h('input', { name: 'title', type: 'text', value: t.title || '', required: true, placeholder: 'z. B. Übungsblatt 3 abgeben' })),
    field('Datum', h('input', { name: 'date', type: 'date', value: t.date || today(), required: true })),
    timeFields(t.start, t.end),
    h('div', { class: 'two' }, field('Bereich', areaSelect(t.areaId || state.areaFilter || 'privat')),
      field('Priorität', h('select', { name: 'prio' }, ['hoch', 'normal', 'niedrig'].map((p) => h('option', { value: p, selected: (t.priority || 'normal') === p }, p[0].toUpperCase() + p.slice(1)))))),
    field('Gehört zu Prüfung (Lernplan)', h('select', { name: 'exam' }, h('option', { value: '' }, '– keine –'),
      DB.exams.map((x) => h('option', { value: x.id, selected: t.examId === x.id }, x.subject)))),
    field('Notizen', h('textarea', { name: 'notes', rows: 3 }, t.notes || '')),
    isNew ? h('div', { class: 'two' },
      field('Wiederholen', h('select', { name: 'repeat' }, h('option', { value: '' }, 'Nein'), h('option', { value: '1' }, 'Täglich'), h('option', { value: '7' }, 'Wöchentlich'), h('option', { value: '14' }, 'Alle 2 Wochen'))),
      field('Anzahl Termine', h('input', { name: 'times', type: 'number', min: 1, max: 52, value: 1 }))) : null);
  openModal(isNew ? 'Neues To-Do' : 'To-Do bearbeiten', body, (f) => {
    if (!checkTimes(f)) return false;
    const vals = { title: f.title.value.trim(), date: f.date.value, start: f.start.value, end: f.end.value, areaId: f.area.value, priority: f.prio.value, examId: f.exam.value || undefined, notes: f.notes.value };
    if (isNew) {
      const step = Number(f.repeat.value) || 0;
      const times = step ? Math.max(1, Number(f.times.value) || 1) : 1;
      for (let i = 0; i < times; i++) DB.todos.push({ id: uid(), done: false, ...vals, date: addDays(vals.date, i * step) });
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
    field('Bereich', areaSelect(r.areaId || 'privat')),
    h('div', { class: 'two' }, field('Gültig ab (optional)', h('input', { name: 'from', type: 'date', value: r.startDate || '' })),
      field('Gültig bis (optional)', h('input', { name: 'to', type: 'date', value: r.endDate || '' }))),
    field('Notizen', h('textarea', { name: 'notes', rows: 2 }, r.notes || '')));
  openModal(isNew ? 'Neue Routine' : 'Routine bearbeiten', body, (f) => {
    if (!checkTimes(f)) return false;
    const wds = readWeekdays(f);
    if (!wds.length) { toast('Bitte mindestens einen Wochentag wählen.'); return false; }
    const vals = { title: f.title.value.trim(), start: f.start.value, end: f.end.value, weekdays: wds, areaId: f.area.value, startDate: f.from.value || undefined, endDate: f.to.value || undefined, notes: f.notes.value };
    if (isNew) DB.routines.push({ id: uid(), createdAt: today(), ...vals });
    else Object.assign(r, vals);
    persist();
  }, isNew ? null : () => { DB.routines = DB.routines.filter((x) => x !== r); });
}

function editExam(x = {}) {
  const isNew = !x.id;
  const body = h('div', { class: 'form' },
    field('Fach / Modul', h('input', { name: 'subject', type: 'text', value: x.subject || '', required: true, placeholder: 'z. B. Statistik II' })),
    h('div', { class: 'two' },
      field('Art', h('select', { name: 'type' }, ['Prüfung', 'Klausur', 'Abgabe', 'Präsentation', 'Hausarbeit'].map((v) => h('option', { selected: (x.type || 'Prüfung') === v }, v)))),
      field('Bereich', areaSelect(x.areaId || 'uni'))),
    h('div', { class: 'two' }, field('Datum', h('input', { name: 'date', type: 'date', value: x.date || addDays(today(), 21), required: true })),
      field('Uhrzeit (optional)', h('input', { name: 'time', type: 'time', value: x.time || '' }))),
    field('Themen / Stoff', h('textarea', { name: 'topics', rows: 3, placeholder: 'Kapitel 1–5, Altklausuren …' }, x.topics || '')),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'addtodo', checked: isNew }), ' Termin als To-Do in den Kalender eintragen'));
  openModal(isNew ? 'Neue Prüfung / Abgabe' : 'Prüfung bearbeiten', body, (f) => {
    const vals = { subject: f.subject.value.trim(), type: f.type.value, areaId: f.area.value, date: f.date.value, time: f.time.value, topics: f.topics.value };
    if (isNew) { x = { id: uid(), ...vals }; DB.exams.push(x); } else Object.assign(x, vals);
    if (f.addtodo.checked && !DB.todos.some((t) => t.examEventOf === x.id)) {
      DB.todos.push({ id: uid(), title: vals.type + ': ' + vals.subject, date: vals.date, start: vals.time, end: vals.time ? fromMin(Math.min(toMin(vals.time) + 120, 23 * 60 + 59)) : '', areaId: vals.areaId, priority: 'hoch', done: false, notes: '', examEventOf: x.id });
    }
    persist();
  }, isNew ? null : () => {
    const delSessions = confirm('Sollen die zugehörigen Lerneinheiten auch gelöscht werden? (OK = ja, Abbrechen = behalten)');
    DB.exams = DB.exams.filter((y) => y !== x);
    DB.todos = DB.todos.filter((t) => t.examEventOf !== x.id && !(delSessions && t.examId === x.id));
    DB.todos.forEach((t) => { if (t.examId === x.id) delete t.examId; });
  });
}

function editWork(w = {}) {
  const isNew = !w.id;
  const body = h('div', { class: 'form' },
    field('Datum', h('input', { name: 'date', type: 'date', value: w.date || today(), required: true })),
    h('div', { class: 'two' }, field('Beginn', h('input', { name: 'start', type: 'time', value: w.start || '09:00', required: true })),
      field('Ende', h('input', { name: 'end', type: 'time', value: w.end || '13:00', required: true }))),
    h('div', { class: 'two' }, field('Pause (Minuten)', h('input', { name: 'pause', type: 'number', min: 0, max: 600, value: w.pause || 0 })),
      field('Notiz / Arbeitgeber', h('input', { name: 'note', type: 'text', value: w.note || '' }))),
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

// ===========================================================================
// Start
// ===========================================================================
// Tastenkürzel: n = neues To-Do, ←/→ = Tag/Woche wechseln, t = heute
document.addEventListener('keydown', (e) => {
  if ($('#modal').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const step = state.view === 'week' || state.view === 'work' ? 7 : 1;
  if (e.key === 'n') { e.preventDefault(); $('#fab').click(); }
  else if (e.key === 'ArrowLeft') { state.date = addDays(state.date, -step); render(); }
  else if (e.key === 'ArrowRight') { state.date = addDays(state.date, step); render(); }
  else if (e.key === 't') { state.date = today(); render(); }
});

// Jetzt-Linie jede Minute aktualisieren (nur wenn kein Eingabefeld aktiv ist)
setInterval(() => {
  if (state.view === 'day' && !$('#modal').open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) render();
}, 60000);

load().then(render).catch(() => {
  setSync('error', 'Server nicht erreichbar');
  toast('Server nicht erreichbar');
  render();
});
