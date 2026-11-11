'use strict';
/* Dashboard & Wochenrückblick: Auswertung von Lernzeit, To-Dos, Routinen und Arbeitszeit */

const DASH_RANGES = [
  ['week', 'Diese Woche'], ['lastweek', 'Letzte Woche'], ['month', 'Dieser Monat'], ['30', '30 Tage'], ['90', '90 Tage'], ['custom', 'Zeitraum …'],
];
state.dash = { range: 'week', from: addDays(today(), -29), to: today() };

function dashRange() {
  const t = today();
  const r = state.dash.range;
  if (r === 'week') return [mondayOf(t), addDays(mondayOf(t), 6)];
  if (r === 'lastweek') return [addDays(mondayOf(t), -7), addDays(mondayOf(t), -1)];
  if (r === 'month') { const d = parseYmd(t); const f = ymd(new Date(d.getFullYear(), d.getMonth(), 1)); return [f, ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
  if (r === 'custom') return [state.dash.from, state.dash.to];
  return [addDays(t, -(Number(r) - 1)), t];
}

function eachDay(from, to, fn) { for (let d = from; d <= to; d = addDays(d, 1)) fn(d); }

// Tooltip für alle Diagramme
const tip = h('div', { class: 'tip', hidden: true });
document.body.append(tip);
function attachTip(el, text) {
  const show = (e) => { tip.textContent = text; tip.hidden = false; const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px'; };
  el.addEventListener('pointermove', show);
  el.addEventListener('pointerdown', show);
  el.addEventListener('pointerleave', () => (tip.hidden = true));
}
document.addEventListener('scroll', () => (tip.hidden = true), { passive: true });

/** Säulendiagramm. groups: [{label, values:[…], tip}], series: [{name, color}] */
function columnChart(groups, series, fmt) {
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const chart = h('div', { class: 'cchart' });
  const plot = h('div', { class: 'cchart-plot' },
    h('div', { class: 'cchart-grid', style: { bottom: 'calc(20px + (100% - 20px))' } }, h('span', null, fmt(max))),
    h('div', { class: 'cchart-grid', style: { bottom: 'calc(20px + (100% - 20px) * 0.5)' } }, h('span', null, fmt(max / 2))));
  const every = Math.ceil(groups.length / 14);
  groups.forEach((g, gi) => {
    const col = h('div', { class: 'cchart-group' });
    const bars = h('div', { class: 'cchart-bars' });
    g.values.forEach((v, i) => bars.append(h('div', { class: 'cchart-bar', style: { height: (v / max) * 100 + '%', background: series[i].color } })));
    col.append(bars, h('div', { class: 'cchart-label' }, gi % every === 0 ? g.label : ''));
    attachTip(col, g.tip || g.label + ': ' + g.values.map((v, i) => series[i].name + ' ' + fmt(v)).join(' · '));
    plot.append(col);
  });
  chart.append(plot);
  if (series.length > 1) chart.append(h('div', { class: 'legend' }, series.map((s) => h('span', { class: 'legend-item' }, h('i', { style: { background: s.color } }), s.name))));
  return chart;
}

/** Waagerechte Balken. rows: [{label, value, max, color, text, tip}] */
function hBars(rows, emptyText) {
  if (!rows.length) return h('p', { class: 'muted' }, emptyText);
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  const wrap = h('div', { class: 'hbars' });
  for (const r of rows) {
    const row = h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', title: r.label }, r.label),
      h('div', { class: 'bar' }, h('div', { style: { width: (r.value / (r.max ?? max)) * 100 + '%', background: r.color } })),
      h('span', { class: 'bar-val' }, r.text));
    if (r.tip) attachTip(row, r.tip);
    wrap.append(row);
  }
  return wrap;
}

function collectStats(from, to) {
  const t = today();
  const s = { focusMin: 0, focusCount: 0, plannedStudy: 0, todosTotal: 0, todosDone: 0, routineDue: 0, routineDone: 0, workMin: 0, ratingSum: 0, ratingN: 0, days: 0 };
  s.byDay = {}; s.byExam = {}; s.byHour = new Array(24).fill(0); s.byArea = {}; s.byRoutine = {};
  const focus = DB.focus.filter((f) => f.date >= from && f.date <= to);
  s.focusList = focus;
  for (const f of focus) {
    const m = Number(f.minutes) || 0;
    s.focusMin += m; s.focusCount++;
    if (f.rating) { s.ratingSum += f.rating; s.ratingN++; }
    s.byDay[f.date] = s.byDay[f.date] || { focus: 0, planned: 0 };
    s.byDay[f.date].focus += m;
    const key = f.examId && exam(f.examId) ? exam(f.examId).subject : (f.title || 'Sonstiges');
    s.byExam[key] = (s.byExam[key] || 0) + m;
    let st = toMin(f.start) ?? 12 * 60, left = m;
    while (left > 0 && st < 24 * 60) { const hr = Math.floor(st / 60); const chunk = Math.min(left, (hr + 1) * 60 - st); s.byHour[hr] += chunk; left -= chunk; st += chunk; }
  }
  eachDay(from, to, (d) => {
    if (d <= t) s.days++;
    for (const it of itemsForDate(DB, d)) {
      if (it.kind === 'study') { s.byDay[d] = s.byDay[d] || { focus: 0, planned: 0 }; s.byDay[d].planned += durOf(it); s.plannedStudy += durOf(it); }
      if (it.kind === 'work') s.workMin += workMinutes(it.ref);
      if (d > t) continue;
      if (it.kind === 'todo' || it.kind === 'study') {
        s.todosTotal++; if (it.done) s.todosDone++;
        const a = (area(it.areaId) || { name: 'Ohne Bereich', color: '#94a3b8' });
        const b = s.byArea[a.name] = s.byArea[a.name] || { total: 0, done: 0, color: a.color };
        b.total++; if (it.done) b.done++;
      }
      if (it.kind === 'routine' && !it.skipped && !(it.ref.createdAt && d < it.ref.createdAt)) {
        s.routineDue++; if (it.done) s.routineDone++;
        const r = s.byRoutine[it.ref.id] = s.byRoutine[it.ref.id] || { title: it.title, due: 0, done: 0 };
        r.due++; if (it.done) r.done++;
      }
    }
  });
  return s;
}

const pctText = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '–');

VIEWS.dashboard = function renderDashboard(main) {
  main.append(h('h2', { class: 'section-title' }, 'Dashboard'));
  const bar = h('div', { class: 'filters' });
  for (const [k, l] of DASH_RANGES) bar.append(h('button', { class: 'chip-btn' + (state.dash.range === k ? ' active' : ''), onclick: () => { state.dash.range = k; render(); } }, l));
  main.append(bar);
  if (state.dash.range === 'custom') {
    const f = h('input', { type: 'date', value: state.dash.from }), t = h('input', { type: 'date', value: state.dash.to });
    const upd = () => { if (f.value && t.value && f.value <= t.value) { state.dash.from = f.value; state.dash.to = t.value; render(); } };
    f.addEventListener('change', upd); t.addEventListener('change', upd);
    main.append(h('div', { class: 'two custom-range' }, field('Von', f), field('Bis', t)));
  }
  const [from, to] = dashRange();
  const s = collectStats(from, to);
  const prevLen = daysBetween(from, to) + 1;
  const prev = collectStats(addDays(from, -prevLen), addDays(from, -1));
  main.append(h('p', { class: 'muted' }, fmtDate(from, { weekday: false, year: true }) + ' – ' + fmtDate(to, { weekday: false, year: true })));

  const trend = (cur, old) => {
    if (!old) return null;
    const diff = Math.round(((cur - old) / old) * 100);
    return (diff >= 0 ? '▲ +' : '▼ ') + diff + ' % ggü. Vorzeitraum';
  };
  const gs = gradeStats();
  main.append(h('div', { class: 'stats' },
    statTile('Gelernt (Fokuszeit)', fmtHours(s.focusMin), trend(s.focusMin, prev.focusMin) || `Ø ${fmtHours(s.days ? s.focusMin / s.days : 0)} pro Tag`),
    statTile('Fokus-Sessions', String(s.focusCount), s.ratingN ? 'Ø Konzentration ' + (s.ratingSum / s.ratingN).toFixed(1).replace('.', ',') + ' ★' : null),
    statTile('To-Dos erledigt', s.todosDone + ' / ' + s.todosTotal, pctText(s.todosDone, s.todosTotal)),
    statTile('Routinen eingehalten', pctText(s.routineDone, s.routineDue), s.routineDone + ' von ' + s.routineDue),
    statTile('Arbeitszeit', fmtHours(s.workMin), trend(s.workMin, prev.workMin)),
    statTile('Notenschnitt', fmtGrade(gs.avg), gs.ects + ' ECTS')));

  // Rückblick in Worten
  const best = Object.values(s.byRoutine).sort((a, b) => b.done / b.due - a.done / a.due)[0];
  const worst = Object.values(s.byRoutine).filter((r) => r.due >= 3).sort((a, b) => a.done / a.due - b.done / b.due)[0];
  const topHour = s.byHour.indexOf(Math.max(...s.byHour));
  const topSubject = Object.entries(s.byExam).sort((a, b) => b[1] - a[1])[0];
  const lines = [];
  lines.push(`Du hast ${s.todosDone} von ${s.todosTotal} To-Dos erledigt (${pctText(s.todosDone, s.todosTotal)}) und ${fmtHours(s.focusMin)} konzentriert gelernt` + (s.plannedStudy ? ` – geplant waren ${fmtHours(s.plannedStudy)}.` : '.'));
  if (prev.focusMin) lines.push(s.focusMin >= prev.focusMin ? `Das sind ${fmtHours(s.focusMin - prev.focusMin)} mehr Lernzeit als im Zeitraum davor. 👏` : `Das sind ${fmtHours(prev.focusMin - s.focusMin)} weniger Lernzeit als im Zeitraum davor.`);
  if (topSubject) lines.push(`Am meisten gelernt: ${topSubject[0]} (${fmtHours(topSubject[1])}).`);
  if (s.focusMin) lines.push(`Deine produktivste Zeit war zwischen ${pad(topHour)}:00 und ${pad(topHour + 1)}:00 Uhr.`);
  if (best && best.due) lines.push(`Beste Routine: ${best.title} (${pctText(best.done, best.due)}).`);
  if (worst && worst !== best && worst.done / worst.due < 0.7) lines.push(`Ausbaufähig: ${worst.title} (${pctText(worst.done, worst.due)}).`);
  const upcomingExam = [...DB.exams].filter((x) => x.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (upcomingExam) lines.push(`Nächste Prüfung: ${upcomingExam.subject} in ${daysBetween(today(), upcomingExam.date)} Tagen.`);
  main.append(h('section', { class: 'card review' }, h('h3', null, '📝 Rückblick'), h('ul', null, lines.map((l) => h('li', null, l)))));

  const grid = h('div', { class: 'dash-grid' });
  // 1) Lernzeit geplant vs. gelernt
  const groups = [];
  const weekly = prevLen > 35;
  if (weekly) {
    for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) {
      let f = 0, p = 0;
      eachDay(d, addDays(d, 6), (x) => { if (x >= from && x <= to && s.byDay[x]) { f += s.byDay[x].focus; p += s.byDay[x].planned; } });
      groups.push({ label: 'KW' + isoWeek(d), values: [p, f], tip: `KW ${isoWeek(d)}: geplant ${fmtHours(p)}, gelernt ${fmtHours(f)}` });
    }
  } else {
    eachDay(from, to, (d) => {
      const v = s.byDay[d] || { focus: 0, planned: 0 };
      groups.push({ label: prevLen <= 7 ? WD_SHORT[weekday(d)] : String(parseYmd(d).getDate()), values: [v.planned, v.focus], tip: `${fmtShort(d)}: geplant ${fmtHours(v.planned)}, gelernt ${fmtHours(v.focus)}` });
    });
  }
  grid.append(h('section', { class: 'card' }, h('h3', null, 'Lernzeit: geplant vs. tatsächlich' + (weekly ? ' (pro Woche)' : '')),
    columnChart(groups, [{ name: 'Geplant', color: 'color-mix(in srgb, var(--c-study) 35%, var(--surface))' }, { name: 'Gelernt', color: 'var(--c-study)' }], fmtHours)));

  // 2) Lernzeit nach Fach
  grid.append(h('section', { class: 'card' }, h('h3', null, 'Lernzeit nach Fach'),
    hBars(Object.entries(s.byExam).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ label: k, value: v, color: 'var(--c-study)', text: fmtHours(v), tip: `${k}: ${fmtHours(v)} (${pctText(v, s.focusMin)} der Lernzeit)` })), 'Noch keine Lernzeit in diesem Zeitraum.')));

  // 3) Tageszeit
  const hours = [];
  for (let hr = 5; hr < 24; hr++) hours.push({ label: String(hr), values: [s.byHour[hr]], tip: `${pad(hr)}:00–${pad(hr + 1)}:00 Uhr: ${fmtHours(s.byHour[hr])} gelernt` });
  grid.append(h('section', { class: 'card' }, h('h3', null, 'Wann lernst du? (nach Uhrzeit)'), columnChart(hours, [{ name: 'Lernzeit', color: 'var(--c-study)' }], fmtHours)));

  // 4) Routinen
  grid.append(h('section', { class: 'card' }, h('h3', null, 'Routinen: Einhaltung'),
    hBars(Object.values(s.byRoutine).sort((a, b) => b.done / b.due - a.done / a.due).map((r) => ({ label: r.title, value: r.done, max: r.due, color: 'var(--c-routine)', text: pctText(r.done, r.due), tip: `${r.title}: ${r.done} von ${r.due} Tagen erledigt` })), 'Keine Routinen in diesem Zeitraum.')));

  // 5) To-Dos nach Bereich
  grid.append(h('section', { class: 'card' }, h('h3', null, 'Erledigte To-Dos nach Bereich'),
    hBars(Object.entries(s.byArea).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => ({ label: k, value: v.done, max: v.total, color: v.color, text: v.done + '/' + v.total, tip: `${k}: ${v.done} von ${v.total} erledigt (${pctText(v.done, v.total)})` })), 'Keine To-Dos in diesem Zeitraum.')));
  main.append(grid);

  // Protokoll (bearbeitbar)
  const log = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, `Lernzeit-Protokoll (${s.focusList.length})`),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small', onclick: () => editFocus() }, '+ Nachtragen'),
      h('button', { class: 'btn small', onclick: exportFocusCsv }, '⬇ CSV'))));
  log.append(h('p', { class: 'muted' }, 'Klicke auf einen Eintrag, um Dauer, Fach oder Konzentration nachträglich anzupassen.'));
  const sorted = [...s.focusList].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  if (!sorted.length) log.append(h('p', { class: 'muted' }, 'Keine Einträge in diesem Zeitraum.'));
  sorted.forEach((f) => log.append(focusRow(f)));
  main.append(log);
};

function exportFocusCsv() {
  const rows = [['Datum', 'Beginn', 'Minuten', 'Bezeichnung', 'Fach', 'Bereich', 'Konzentration', 'Art', 'Notiz']];
  for (const f of [...DB.focus].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))) {
    rows.push([f.date, f.start || '', f.minutes, f.title || '', (exam(f.examId) || {}).subject || '', (area(f.areaId) || {}).name || '', f.rating || '', f.manual ? 'nachgetragen' : 'Timer', f.note || ''].map((v) => String(v).replace(/[;\n]/g, ' ')));
  }
  download('lernzeit.csv', '﻿' + rows.map((r) => r.join(';')).join('\n'), 'text/csv');
}
