'use strict';
/* Lernplan, Pomodoro-Fokus-Timer und Lernzeit-Protokoll */

// ===========================================================================
// Lernplan
// ===========================================================================
function focusMinutes(filter) { return DB.focus.filter(filter).reduce((s, f) => s + (Number(f.minutes) || 0), 0); }

VIEWS.study = function renderStudy(main) {
  main.append(h('div', { class: 'view-head' }, h('h2', null, 'Lernplan'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => startFocus({ title: 'Freie Lernzeit', areaId: 'uni' }) }, '▶ Fokus-Timer'),
      h('button', { class: 'btn primary', onclick: () => editExam() }, '+ Prüfung / Fach'))));
  main.append(h('p', { class: 'muted' }, 'Lege Prüfungen oder Abgaben an und lass dir Lerneinheiten automatisch in freie Zeitfenster bis zum Termin verteilen. Mit ▶ startest du den Pomodoro-Timer, die Lernzeit wird automatisch protokolliert.'));

  const sorted = [...DB.exams].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((x) => x.date >= today());
  const past = sorted.filter((x) => x.date < today());
  if (!sorted.length) main.append(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Noch keine Prüfungen angelegt.')));
  upcoming.forEach((x) => main.append(examCard(x)));
  if (past.length) {
    main.append(h('h3', { class: 'section-title' }, 'Vergangene Prüfungen'));
    past.reverse().forEach((x) => main.append(examCard(x)));
  }

  // Lernzeit-Protokoll
  const log = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, 'Lernzeit-Protokoll'),
    h('button', { class: 'btn small', onclick: () => editFocus() }, '+ Lernzeit nachtragen')));
  const recent = [...DB.focus].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, 12);
  if (!recent.length) log.append(h('p', { class: 'muted' }, 'Noch keine Lernzeit erfasst. Starte den Fokus-Timer oder trage Lernzeit nach.'));
  recent.forEach((f) => log.append(focusRow(f)));
  if (DB.focus.length > 12) log.append(h('button', { class: 'btn small', onclick: () => setView('dashboard') }, 'Alle Einträge im Dashboard ansehen'));
  main.append(log);
};

function examCard(x) {
  const sessions = DB.todos.filter((t) => t.examId === x.id).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  const doneCount = sessions.filter((t) => t.done).length;
  const left = daysBetween(today(), x.date);
  const pct = sessions.length ? Math.round((doneCount / sessions.length) * 100) : 0;
  const learned = focusMinutes((f) => f.examId === x.id);
  const planned = sessions.reduce((s, t) => s + durOf(t), 0);
  const grade = DB.grades.find((g) => g.examId === x.id);
  const card = h('section', { class: 'card exam' + (left < 0 ? ' past' : '') },
    h('div', { class: 'exam-head' },
      h('div', null, h('h3', null, x.subject), h('div', { class: 'item-meta' },
        h('span', null, (x.type || 'Prüfung') + ': ' + fmtDate(x.date, { year: true }) + (x.time ? ', ' + x.time : '')),
        x.ects ? h('span', null, x.ects + ' ECTS') : null,
        areaChip(x.areaId))),
      h('div', { class: 'countdown' + (left <= 7 && left >= 0 ? ' soon' : '') },
        h('strong', null, left < 0 ? (grade && grade.grade ? String(grade.grade).replace('.', ',') : '✓') : String(left)),
        h('small', null, left < 0 ? (grade && grade.grade ? 'Note' : 'vorbei') : left === 1 ? 'Tag' : 'Tage'))),
    h('div', { class: 'progress-wrap' }, h('div', { class: 'progress study' }, h('div', { class: 'progress-bar', style: { width: pct + '%' } })),
      h('span', { class: 'muted' }, `${doneCount}/${sessions.length} Einheiten · gelernt ${fmtHours(learned)}${planned ? ' von ' + fmtHours(planned) + ' geplant' : ''}`)),
    x.topics ? h('p', { class: 'topics' }, x.topics) : null,
    h('div', { class: 'row-actions' },
      left >= 0 ? h('button', { class: 'btn small', onclick: () => generateSessions(x) }, '⚙ Lerneinheiten planen') : null,
      h('button', { class: 'btn small', onclick: () => startFocus({ examId: x.id, areaId: x.areaId, title: 'Lernen: ' + x.subject }) }, '▶ Fokus'),
      left >= 0 ? h('button', { class: 'btn small', onclick: () => editTodo({ date: today(), examId: x.id, areaId: x.areaId, title: 'Lernen: ' + x.subject }) }, '+ Einheit') : null,
      left < 0 ? h('button', { class: 'btn small', onclick: () => editGrade(grade || { module: x.subject, examId: x.id, ects: x.ects }) }, grade ? 'Note bearbeiten' : '🎓 Note eintragen') : null,
      h('button', { class: 'btn small', onclick: () => editExam(x) }, 'Bearbeiten')));
  const next = sessions.filter((t) => !t.done && t.date >= today()).slice(0, 4);
  if (next.length && left >= 0) {
    card.append(h('h4', null, 'Nächste Einheiten'));
    next.forEach((t) => card.append(itemRow({ kind: 'study', ref: t, title: t.title, start: t.start, end: t.end, areaId: t.areaId, done: t.done }, { showDate: true, date: t.date })));
  }
  return card;
}

function generateSessions(x) {
  const body = h('div', { class: 'form' },
    h('div', { class: 'two' },
      field('Anzahl Lerneinheiten', h('input', { name: 'count', type: 'number', min: 1, max: 200, value: 10, required: true })),
      field('Dauer pro Einheit (min)', h('input', { name: 'dur', type: 'number', min: 15, max: 600, step: 15, value: 90, required: true }))),
    h('div', { class: 'two' },
      field('Bevorzugte Uhrzeit', h('input', { name: 'start', type: 'time', value: '10:00', required: true })),
      field('Beginnen am', h('input', { name: 'from', type: 'date', value: addDays(today(), 1), required: true }))),
    field('Lerntage', weekdayPicker([1, 2, 3, 4, 5, 6])),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'free', checked: true }), ' Nur in freie Zeitfenster legen (Termine, Arbeit, Routinen werden umgangen)'),
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
    const pref = toMin(f.start.value);
    let moved = 0, clash = 0;
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? days.length - 1 : Math.round((i * (days.length - 1)) / (count - 1));
      const d = days[idx];
      let s = pref;
      if (f.free.checked) {
        const free = findFreeSlot(d, dur, pref);
        if (free !== null) { if (free !== pref) moved++; s = free; } else clash++;
      }
      DB.todos.push({
        id: uid(), title: (i === count - 1 && count > 1 ? 'Wiederholung: ' : 'Lernen: ') + x.subject + ` (${i + 1}/${count})`,
        date: d, start: fromMin(s), end: fromMin(s + dur), areaId: x.areaId || 'uni',
        priority: 'normal', done: false, notes: '', examId: x.id, subtasks: [],
      });
    }
    persist();
    toast(count + ' Lerneinheiten geplant' + (moved ? `, ${moved} wegen belegter Zeit verschoben` : '') + (clash ? `, ${clash} ohne freies Fenster (Überschneidung!)` : ''), 5000);
  }, null, 'Planen');
}

function editExam(x = {}) {
  const isNew = !x.id;
  const body = h('div', { class: 'form' },
    field('Fach / Modul', h('input', { name: 'subject', type: 'text', value: x.subject || '', required: true, placeholder: 'z. B. Statistik II' })),
    h('div', { class: 'two' },
      field('Art', h('select', { name: 'type' }, ['Prüfung', 'Klausur', 'Abgabe', 'Präsentation', 'Hausarbeit', 'Mündliche Prüfung'].map((v) => h('option', { selected: (x.type || 'Prüfung') === v }, v)))),
      field('Bereich', areaSelect(x.areaId || 'uni'))),
    h('div', { class: 'two' }, field('Datum', h('input', { name: 'date', type: 'date', value: x.date || addDays(today(), 21), required: true })),
      field('Uhrzeit (optional)', h('input', { name: 'time', type: 'time', value: x.time || '' }))),
    field('ECTS (optional, für den Notenrechner)', h('input', { name: 'ects', type: 'number', min: 0, max: 60, step: 0.5, value: x.ects || '' })),
    field('Themen / Stoff', h('textarea', { name: 'topics', rows: 3, placeholder: 'Kapitel 1–5, Altklausuren …' }, x.topics || '')),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'addtodo', checked: isNew }), ' Termin als To-Do in den Kalender eintragen'));
  openModal(isNew ? 'Neue Prüfung / Abgabe' : 'Prüfung bearbeiten', body, (f) => {
    const vals = { subject: f.subject.value.trim(), type: f.type.value, areaId: f.area.value, date: f.date.value, time: f.time.value, topics: f.topics.value, ects: Number(f.ects.value) || undefined };
    if (isNew) { x = { id: uid(), ...vals }; DB.exams.push(x); } else Object.assign(x, vals);
    const ev = DB.todos.find((t) => t.examEventOf === x.id);
    const evVals = { title: vals.type + ': ' + vals.subject, date: vals.date, start: vals.time, end: vals.time ? fromMin(toMin(vals.time) + 120) : '', areaId: vals.areaId };
    if (ev) Object.assign(ev, evVals);
    else if (f.addtodo.checked) DB.todos.push({ id: uid(), ...evVals, priority: 'hoch', done: false, notes: '', examEventOf: x.id, subtasks: [] });
    persist();
  }, isNew ? null : () => {
    const delSessions = confirm('Sollen die zugehörigen, geplanten Lerneinheiten auch gelöscht werden? (OK = ja, Abbrechen = behalten)');
    DB.exams = DB.exams.filter((y) => y !== x);
    DB.todos = DB.todos.filter((t) => t.examEventOf !== x.id && !(delSessions && t.examId === x.id));
    DB.todos.forEach((t) => { if (t.examId === x.id) delete t.examId; });
  });
}

// ===========================================================================
// Lernzeit-Protokoll
// ===========================================================================
function focusRow(f) {
  const ex = f.examId ? exam(f.examId) : null;
  return h('div', { class: 'item k-study', onclick: () => editFocus(f) },
    h('span', { class: 'check-placeholder' }, '⏲'),
    h('div', { class: 'item-main' },
      h('div', { class: 'item-title' }, f.title || (ex ? 'Lernen: ' + ex.subject : 'Lernzeit')),
      h('div', { class: 'item-meta' }, h('span', null, fmtShort(f.date) + (f.start ? ' ' + f.start : '')), h('strong', null, fmtHours(f.minutes)),
        ex ? h('span', null, '📚 ' + ex.subject) : null, f.manual ? h('span', null, 'nachgetragen') : h('span', null, '🍅 Timer'), areaChip(f.areaId),
        f.rating ? h('span', null, '★'.repeat(f.rating)) : null)));
}

function editFocus(f = {}) {
  const isNew = !f.id;
  const body = h('div', { class: 'form' },
    field('Bezeichnung', h('input', { name: 'title', type: 'text', value: f.title || '', placeholder: 'z. B. Lernen: Statistik II', 'data-nofocus': '1' })),
    h('div', { class: 'two' },
      field('Datum', h('input', { name: 'date', type: 'date', value: f.date || today(), required: true })),
      field('Beginn', h('input', { name: 'start', type: 'time', value: f.start || fromMin(Math.max(0, nowMin() - 60)) }))),
    h('div', { class: 'two' },
      field('Dauer (Minuten)', h('input', { name: 'minutes', type: 'number', min: 1, max: 1440, value: f.minutes || 60, required: true })),
      field('Konzentration', h('select', { name: 'rating' }, [['', '–'], ['1', '★ schlecht'], ['2', '★★'], ['3', '★★★ mittel'], ['4', '★★★★'], ['5', '★★★★★ super']].map(([v, l]) => h('option', { value: v, selected: String(f.rating || '') === v }, l))))),
    h('div', { class: 'two' },
      field('Prüfung / Fach', h('select', { name: 'exam' }, h('option', { value: '' }, '– keines –'), DB.exams.map((x) => h('option', { value: x.id, selected: f.examId === x.id }, x.subject)))),
      field('Bereich', areaSelect(f.areaId || 'uni'))),
    field('Notiz', h('textarea', { name: 'note', rows: 2 }, f.note || '')));
  openModal(isNew ? 'Lernzeit nachtragen' : 'Lernzeit bearbeiten', body, (fm) => {
    const vals = { title: fm.title.value.trim(), date: fm.date.value, start: fm.start.value, minutes: Math.max(1, Number(fm.minutes.value) || 1), rating: Number(fm.rating.value) || undefined, examId: fm.exam.value || undefined, areaId: fm.area.value, note: fm.note.value };
    if (isNew) DB.focus.push({ id: uid(), manual: true, ...vals }); else Object.assign(f, vals);
    persist();
  }, isNew ? null : () => { DB.focus = DB.focus.filter((x) => x !== f); });
}

// ===========================================================================
// Pomodoro-Timer
// ===========================================================================
const PHASE_LABEL = { focus: 'Fokus', short: 'Kurze Pause', long: 'Lange Pause', ready: 'Bereit' };
let timer = null;
try { timer = JSON.parse(localStorage.getItem('planer.timer') || 'null'); } catch (_) { timer = null; }

function storeTimer() { try { if (timer) localStorage.setItem('planer.timer', JSON.stringify(timer)); else localStorage.removeItem('planer.timer'); } catch (_) { /* egal */ } }

function startFocus(ctx) {
  if (timer && timer.phase !== 'ready' && !confirm('Es läuft bereits ein Timer. Beenden und neuen starten?')) return;
  if (timer) stopTimer(true);
  timer = { todoId: ctx.todoId, examId: ctx.examId, areaId: ctx.areaId, title: ctx.title, cycle: 0, focusTotal: 0 };
  unlockAudio();
  startPhase('focus');
}

function startPhase(phase) {
  const p = DB.settings.pomodoro;
  const min = Number(p[phase]) || 25;
  timer.phase = phase;
  timer.phaseMinutes = min;
  timer.phaseStart = Date.now();
  timer.endsAt = Date.now() + min * 60000;
  timer.paused = false;
  storeTimer();
  scheduleTimerPush();
  renderTimerWidget();
}

function scheduleTimerPush() {
  if (typeof pushDeviceId !== 'function' || !localStorage.getItem('planer.pushOn')) return;
  const msg = timer.phase === 'focus'
    ? { title: '🍅 Fokuszeit vorbei', body: 'Zeit für eine Pause! (' + (timer.title || '') + ')' }
    : { title: '⏰ Pause vorbei', body: 'Weiter geht\'s mit: ' + (timer.title || 'Lernen') };
  api('/api/push/timer', { method: 'POST', body: { deviceId: pushDeviceId(), at: timer.endsAt, ...msg } }).catch(() => {});
}
function cancelTimerPush() {
  if (typeof pushDeviceId !== 'function' || !localStorage.getItem('planer.pushOn')) return;
  api('/api/push/timer', { method: 'DELETE', body: { deviceId: pushDeviceId() } }).catch(() => {});
}

function logFocus(minutes, startMs) {
  if (minutes < 1) return;
  const d = new Date(startMs);
  DB.focus.push({ id: uid(), date: ymd(d), start: pad(d.getHours()) + ':' + pad(d.getMinutes()), minutes: Math.round(minutes), todoId: timer.todoId, examId: timer.examId, areaId: timer.areaId, title: timer.title });
  timer.focusTotal += Math.round(minutes);
  persist();
}

function completePhase(early) {
  const elapsed = (Date.now() - timer.phaseStart) / 60000;
  if (timer.phase === 'focus') {
    logFocus(early ? elapsed : timer.phaseMinutes, timer.phaseStart);
    timer.cycle++;
    const p = DB.settings.pomodoro;
    alertUser('🍅 Fokuszeit vorbei', 'Gut gemacht! Jetzt ' + (timer.cycle % (p.longEvery || 4) === 0 ? 'eine lange' : 'eine kurze') + ' Pause.', early);
    startPhase(timer.cycle % (p.longEvery || 4) === 0 ? 'long' : 'short');
  } else {
    alertUser('⏰ Pause vorbei', 'Bereit für die nächste Fokusrunde?', early);
    timer.phase = 'ready';
    timer.endsAt = null;
    storeTimer();
    renderTimerWidget();
  }
  if (state.view === 'study' || state.view === 'dashboard') render();
}

function pauseTimer() {
  if (timer.paused) { timer.endsAt = Date.now() + timer.remaining; timer.phaseStart += Date.now() - timer.pausedAt; timer.paused = false; scheduleTimerPush(); }
  else { timer.remaining = timer.endsAt - Date.now(); timer.pausedAt = Date.now(); timer.paused = true; cancelTimerPush(); }
  storeTimer();
  renderTimerWidget();
}

function stopTimer(silent) {
  if (!timer) return;
  if (timer.phase === 'focus') {
    const end = timer.paused ? timer.pausedAt : Date.now();
    const elapsed = (end - timer.phaseStart) / 60000;
    if (elapsed >= 1 && (silent || confirm(`Bisherige ${Math.round(elapsed)} Minuten als Lernzeit speichern?`))) logFocus(elapsed, timer.phaseStart);
  }
  cancelTimerPush();
  const total = timer.focusTotal;
  timer = null;
  storeTimer();
  if (!silent && total) toast('Insgesamt ' + fmtHours(total) + ' gelernt – stark! 💪');
  render();
}

let audioCtx = null;
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) { /* kein Ton */ } }
function beep() {
  if (!audioCtx || !DB.settings.pomodoro.sound) return;
  [0, 0.25, 0.5].forEach((t) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.15);
  });
}
function alertUser(title, body, silent) {
  if (silent) return;
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  toast(title + ' – ' + body, 6000);
  // Läuft Push für dieses Gerät, kommt die Nachricht vom Server; sonst lokale Benachrichtigung
  if (document.hidden && !localStorage.getItem('planer.pushOn') && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: '/icon.svg', tag: 'pomodoro' })).catch(() => {});
  }
}

function renderTimerWidget() {
  let w = $('#timer');
  if (!timer) { if (w) w.remove(); return; }
  if (!w) { w = h('div', { id: 'timer', class: 'timer' }); document.body.append(w); }
  const remaining = timer.phase === 'ready' ? 0 : Math.max(0, timer.paused ? timer.remaining : timer.endsAt - Date.now());
  const mm = Math.floor(remaining / 60000), ss = Math.floor((remaining % 60000) / 1000);
  const total = (timer.phaseMinutes || 1) * 60000;
  w.className = 'timer phase-' + timer.phase + (timer.paused ? ' paused' : '');
  const todo = timer.todoId ? todoById(timer.todoId) : null;
  w.replaceChildren(
    h('div', { class: 'timer-ring', style: { '--p': timer.phase === 'ready' ? 1 : 1 - remaining / total } },
      h('span', null, timer.phase === 'ready' ? '✓' : pad(mm) + ':' + pad(ss))),
    h('div', { class: 'timer-info' },
      h('strong', null, PHASE_LABEL[timer.phase] + (timer.paused ? ' (pausiert)' : '') + ' · Runde ' + (timer.cycle + (timer.phase === 'focus' ? 1 : 0))),
      h('span', null, timer.title || ''),
      h('small', { class: 'muted' }, 'Heute in dieser Sitzung: ' + fmtHours(timer.focusTotal)),
      h('div', { class: 'timer-btns' },
        timer.phase === 'ready'
          ? h('button', { class: 'btn small primary', onclick: () => { unlockAudio(); startPhase('focus'); } }, '▶ Nächste Runde')
          : h('button', { class: 'btn small', onclick: pauseTimer }, timer.paused ? '▶ Weiter' : '❚❚ Pause'),
        timer.phase !== 'ready' ? h('button', { class: 'btn small', title: 'Phase jetzt beenden', onclick: () => completePhase(true) }, '⏭') : null,
        todo && !todo.done ? h('button', { class: 'btn small', title: 'Aufgabe erledigt', onclick: () => { todo.done = true; persist(); toast('Aufgabe erledigt ✓'); render(); } }, '✓ Erledigt') : null,
        h('button', { class: 'btn small danger', onclick: () => stopTimer(false) }, '■ Stopp'))));
}

setInterval(() => {
  if (!timer) return;
  if (!timer.paused && timer.endsAt && Date.now() >= timer.endsAt) completePhase(false);
  else renderTimerWidget();
}, 1000);
