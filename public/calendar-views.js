'use strict';
/* Monats- und Jahresübersicht */

function firstOfMonth(s) { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); }
function addMonths(s, n) { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
function lastOfMonth(s) { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function examsOn(date) { return DB.exams.filter((x) => x.date === date); }

/** Kurz-Statistik für einen Zeitraum (geplante Arbeitszeit, To-Dos, Lernzeit, Urlaubs-/Feiertage). */
function periodSummary(from, to) {
  const s = { workMin: 0, todos: 0, done: 0, studyMin: 0, focusMin: 0, holidays: [], vacationDays: 0, workDays: 0 };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const mk = dayMarks(d);
    if (mk.holidays.length) s.holidays.push([d, mk.holidays.join(', ')]);
    if (mk.vacation.length) s.vacationDays++;
    let worked = false;
    for (const it of itemsForDate(DB, d)) {
      if (it.kind === 'work') { s.workMin += workMinutes(it.ref); worked = true; }
      if (it.kind === 'todo' || it.kind === 'study') { s.todos++; if (it.done) s.done++; }
      if (it.kind === 'study') s.studyMin += durOf(it);
    }
    if (worked) s.workDays++;
  }
  s.focusMin = DB.focus.filter((f) => f.date >= from && f.date <= to).reduce((a, f) => a + (Number(f.minutes) || 0), 0);
  return s;
}

// ===========================================================================
// Monatsansicht
// ===========================================================================
VIEWS.month = function renderMonth(main) {
  const first = firstOfMonth(state.date);
  const last = lastOfMonth(state.date);
  const d0 = parseYmd(first);
  main.append(dateNav(MONTHS[d0.getMonth()] + ' ' + d0.getFullYear(),
    () => { state.date = addMonths(state.date, -1); render(); }, () => { state.date = addMonths(state.date, 1); render(); }, () => { state.date = today(); render(); }));
  main.append(areaFilterBar());

  const grid = h('div', { class: 'month' });
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((w) => grid.append(h('div', { class: 'month-wd' }, w)));
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const inMonth = d >= first && d <= last;
    const mk = dayMarks(d);
    const items = itemsFor(d, state.areaFilter).filter((i) => !i.holiday && !i.vacation && !i.skipped);
    const ex = examsOn(d);
    const cell = h('div', {
      class: 'month-cell' + (inMonth ? '' : ' other') + (d === today() ? ' today' : '') + (mk.holidays.length ? ' holiday' : '') + (mk.vacation.length ? ' vacation' : '') + (weekday(d) === 0 || weekday(d) === 6 ? ' weekend' : ''),
      onclick: () => { state.date = d; setView('day'); },
      title: 'Tag öffnen',
    });
    cell.append(h('div', { class: 'month-day' },
      h('span', { class: 'month-num' }, String(parseYmd(d).getDate())),
      weekday(d) === 1 ? h('small', { class: 'muted' }, 'KW ' + isoWeek(d)) : null));
    if (mk.holidays.length) cell.append(h('div', { class: 'month-mark holiday-name' }, '🎉 ' + mk.holidays.join(', ')));
    if (mk.vacation.length) cell.append(h('div', { class: 'month-mark vacation-name' }, '🏖️ ' + mk.vacation[0]));
    ex.forEach((x) => cell.append(h('div', { class: 'month-mark exam-mark' }, '🎓 ' + x.subject)));
    const list = h('div', { class: 'month-items' });
    const MAX = 3;
    items.slice(0, MAX).forEach((it) => list.append(h('div', {
      class: 'mini k-' + it.kind + (it.done ? ' done' : ''),
      onclick: (e) => { e.stopPropagation(); state.date = d; openItem(it); },
    }, it.start ? h('span', { class: 'mini-time' }, it.start) : null, it.title)));
    if (items.length > MAX) list.append(h('div', { class: 'month-more' }, '+' + (items.length - MAX) + ' weitere'));
    cell.append(list);
    // Auf dem Handy: farbige Punkte statt Texten
    const kinds = [...new Set(items.map((i) => i.kind))];
    cell.append(h('div', { class: 'month-dots' }, kinds.map((k) => h('i', { class: 'k-' + k }))));
    grid.append(cell);
  }
  main.append(grid);

  const s = periodSummary(first, last);
  const target = Number(DB.settings.weeklyWorkTarget) || 0;
  main.append(h('div', { class: 'stats' },
    statTile('Arbeitszeit (geplant)', fmtHours(s.workMin), s.workDays + ' Arbeitstage' + (target ? ' · Ziel ca. ' + fmtHours(target * 60 * (daysBetween(first, last) + 1) / 7) : '')),
    statTile('To-Dos', s.done + ' / ' + s.todos, 'erledigt'),
    statTile('Lernen', fmtHours(s.focusMin), 'gelernt · ' + fmtHours(s.studyMin) + ' geplant'),
    statTile('Frei', s.holidays.length + ' Feiertage', s.vacationDays ? s.vacationDays + ' Urlaubstage' : null)));
  const exams = DB.exams.filter((x) => x.date >= first && x.date <= last).sort((a, b) => a.date.localeCompare(b.date));
  if (exams.length || s.holidays.length) {
    main.append(h('section', { class: 'card' }, h('h3', null, 'Besondere Tage'),
      h('ul', { class: 'plain-list' },
        exams.map((x) => h('li', null, '🎓 ' + fmtShort(x.date) + ' – ' + (x.type || 'Prüfung') + ': ' + x.subject + (x.time ? ', ' + x.time : ''))),
        s.holidays.map(([d, n]) => h('li', null, '🎉 ' + fmtShort(d) + ' – ' + n)))));
  }
  main.append(legend());
};

// ===========================================================================
// Jahresansicht
// ===========================================================================
VIEWS.year = function renderYear(main) {
  const y = parseYmd(state.date).getFullYear();
  main.append(dateNav(String(y),
    () => { state.date = (y - 1) + '-01-01'; render(); }, () => { state.date = (y + 1) + '-01-01'; render(); }, () => { state.date = today(); render(); }));

  const wrap = h('div', { class: 'year' });
  for (let m = 0; m < 12; m++) {
    const first = ymd(new Date(y, m, 1));
    const last = lastOfMonth(first);
    const box = h('section', { class: 'card year-month' },
      h('button', { class: 'year-title', onclick: () => { state.date = first; setView('month'); } }, MONTHS[m]));
    const g = h('div', { class: 'year-grid' });
    ['M', 'D', 'M', 'D', 'F', 'S', 'S'].forEach((w) => g.append(h('span', { class: 'year-wd' }, w)));
    const offset = (parseYmd(first).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) g.append(h('span'));
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const mk = dayMarks(d);
      const items = itemsForDate(DB, d);
      const ex = examsOn(d);
      const has = (k) => items.some((i) => i.kind === k && !i.skipped);
      const tips = [...mk.holidays.map((t) => '🎉 ' + t), ...mk.vacation.map((t) => '🏖️ ' + t), ...ex.map((x) => '🎓 ' + x.subject)];
      if (has('work')) tips.push('💼 Arbeit');
      const n = items.filter((i) => (i.kind === 'todo' || i.kind === 'study') && !i.done).length;
      if (n) tips.push(n + ' offene To-Dos');
      g.append(h('button', {
        class: 'year-day' + (mk.holidays.length ? ' holiday' : '') + (mk.vacation.length ? ' vacation' : '') + (ex.length ? ' exam' : '') + (d === today() ? ' today' : '') + (weekday(d) === 0 || weekday(d) === 6 ? ' weekend' : ''),
        title: fmtDate(d) + (tips.length ? '\n' + tips.join('\n') : ''),
        onclick: () => { state.date = d; setView('day'); },
      }, String(parseYmd(d).getDate()),
      h('span', { class: 'year-dots' },
        has('work') ? h('i', { class: 'k-work' }) : null,
        has('study') ? h('i', { class: 'k-study' }) : null,
        has('todo') || (has('event') && items.some((i) => i.kind === 'event' && !i.holiday && !i.vacation)) ? h('i', { class: 'k-todo' }) : null)));
    }
    box.append(g);
    wrap.append(box);
  }
  main.append(wrap);

  main.append(h('div', { class: 'legend' },
    h('span', { class: 'legend-item' }, h('i', { class: 'lg-holiday' }), 'Feiertag'),
    h('span', { class: 'legend-item' }, h('i', { class: 'lg-vacation' }), 'Urlaub'),
    h('span', { class: 'legend-item' }, h('i', { class: 'lg-exam' }), 'Prüfung'),
    h('span', { class: 'legend-item k-work' }, h('i', { class: 'dot' }), 'Arbeit'),
    h('span', { class: 'legend-item k-study' }, h('i', { class: 'dot' }), 'Lernen'),
    h('span', { class: 'legend-item k-todo' }, h('i', { class: 'dot' }), 'To-Dos / Termine')));

  const s = periodSummary(y + '-01-01', y + '-12-31');
  const wdHolidays = s.holidays.filter(([d]) => weekday(d) >= 1 && weekday(d) <= 5).length;
  main.append(h('div', { class: 'stats' },
    statTile('Arbeitszeit ' + y + ' (geplant)', fmtHours(s.workMin), s.workDays + ' Arbeitstage'),
    statTile('Gelernt', fmtHours(s.focusMin), fmtHours(s.studyMin) + ' geplant'),
    statTile('Feiertage', String(s.holidays.length), wdHolidays + ' davon Mo–Fr'),
    statTile('Urlaub', s.vacationDays + ' Tage', null)));
  const exams = DB.exams.filter((x) => x.date.startsWith(String(y))).sort((a, b) => a.date.localeCompare(b.date));
  if (exams.length) {
    main.append(h('section', { class: 'card' }, h('h3', null, 'Prüfungen ' + y),
      h('ul', { class: 'plain-list' }, exams.map((x) => h('li', null, '🎓 ' + fmtDate(x.date, { year: false }) + ' – ' + (x.type || 'Prüfung') + ': ' + x.subject)))));
  }
};
