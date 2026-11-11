'use strict';
/* Noten- und ECTS-Rechner (deutsches Notensystem 1,0–5,0, ECTS-gewichtet) */

function gradeStats(list = DB.grades) {
  let ects = 0, weighted = 0, gradedEcts = 0;
  for (const g of list) {
    const e = Number(g.ects) || 0;
    const n = Number(g.grade);
    const passed = g.passed !== false && (!n || n <= 4.0);
    if (!passed) continue;
    ects += e;
    if (n && g.counts !== false) { weighted += n * e; gradedEcts += e; }
  }
  return { ects, avg: gradedEcts ? weighted / gradedEcts : null, gradedEcts, weighted };
}

const fmtGrade = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : (Math.floor(n * 100) / 100).toFixed(2).replace('.', ','));

VIEWS.grades = function renderGrades(main) {
  main.append(h('div', { class: 'view-head' }, h('h2', null, 'Noten & ECTS'),
    h('button', { class: 'btn primary', onclick: () => editGrade() }, '+ Modul / Note')));
  const st = gradeStats();
  const target = Number(DB.settings.ectsTarget) || 180;
  main.append(h('div', { class: 'stats' },
    statTile('Notenschnitt (ECTS-gewichtet)', fmtGrade(st.avg), st.gradedEcts ? st.gradedEcts + ' benotete ECTS' : 'noch keine Noten'),
    statTile('ECTS erreicht', String(st.ects), 'von ' + target + ' (' + Math.round((st.ects / target) * 100) + ' %)'),
    statTile('Module bestanden', String(DB.grades.filter((g) => g.passed !== false && (!Number(g.grade) || Number(g.grade) <= 4)).length), DB.grades.length + ' eingetragen')));
  main.append(h('div', { class: 'progress-wrap' }, h('div', { class: 'progress study' }, h('div', { class: 'progress-bar', style: { width: Math.min(100, (st.ects / target) * 100) + '%' } })),
    h('span', { class: 'muted' }, st.ects + ' / ' + target + ' ECTS')));

  // Zielrechner
  const calc = h('section', { class: 'card' }, h('h3', null, '🎯 Zielrechner'));
  const tIn = h('input', { type: 'number', min: 1, max: 4, step: 0.1, value: DB.settings.gradeTarget || 2.0 });
  const out = h('p', { class: 'calc-out' });
  const upd = () => {
    const goal = Number(tIn.value);
    DB.settings.gradeTarget = goal;
    const remaining = Math.max(0, target - st.ects);
    if (!remaining) { out.textContent = 'Du hast alle ECTS erreicht. Endnote: ' + fmtGrade(st.avg); return; }
    const need = (goal * (st.gradedEcts + remaining) - st.weighted) / remaining;
    if (need < 1) out.textContent = `Für einen Schnitt von ${fmtGrade(goal)} bräuchtest du in den restlichen ${remaining} ECTS besser als 1,0 – leider nicht mehr erreichbar.`;
    else if (need > 4) out.textContent = `Ziel ${fmtGrade(goal)} ist sicher: selbst mit 4,0 in den restlichen ${remaining} ECTS schaffst du es.`;
    else out.textContent = `Für einen Endschnitt von ${fmtGrade(goal)} brauchst du in den restlichen ${remaining} ECTS im Schnitt eine ${fmtGrade(need)}.`;
  };
  tIn.addEventListener('input', () => { upd(); persist(); });
  const ectsIn = h('input', { type: 'number', min: 1, max: 600, value: target });
  ectsIn.addEventListener('change', () => { DB.settings.ectsTarget = Number(ectsIn.value) || 180; persist(); render(); });
  calc.append(h('div', { class: 'two' }, field('Wunsch-Endnote', tIn), field('ECTS gesamt im Studium', ectsIn)), out);
  upd();
  main.append(calc);

  // Module nach Semester
  if (!DB.grades.length) {
    main.append(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Noch keine Module eingetragen. Nach einer Prüfung kannst du die Note auch direkt im Lernplan eintragen.')));
    return;
  }
  const sems = {};
  for (const g of DB.grades) (sems[g.semester || 'Ohne Semester'] = sems[g.semester || 'Ohne Semester'] || []).push(g);
  for (const [sem, list] of Object.entries(sems).sort((a, b) => b[0].localeCompare(a[0], 'de', { numeric: true }))) {
    const s = gradeStats(list);
    const card = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, sem), h('span', { class: 'muted' }, 'Ø ' + fmtGrade(s.avg) + ' · ' + s.ects + ' ECTS')));
    const table = h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Modul'), h('th', null, 'ECTS'), h('th', null, 'Note'), h('th', null, ''))));
    const tb = h('tbody');
    for (const g of list.sort((a, b) => a.module.localeCompare(b.module))) {
      const n = Number(g.grade);
      const failed = g.passed === false || (n && n > 4);
      tb.append(h('tr', { class: failed ? 'failed' : '', onclick: () => editGrade(g) },
        h('td', null, g.module, g.counts === false ? h('small', { class: 'muted' }, ' (zählt nicht)') : null),
        h('td', null, String(g.ects || 0)),
        h('td', null, n ? fmtGrade(n) : (g.passed === false ? 'n. b.' : 'bestanden')),
        h('td', null, failed ? '✗' : '✓')));
    }
    table.append(tb);
    card.append(table);
    main.append(card);
  }
};

function editGrade(g = {}) {
  const isNew = !g.id;
  const sems = [...new Set(DB.grades.map((x) => x.semester).filter(Boolean))];
  const semIn = h('input', { name: 'semester', type: 'text', value: g.semester || sems[sems.length - 1] || '', list: 'semlist', placeholder: 'z. B. WiSe 26/27', 'data-nofocus': '1' });
  const body = h('div', { class: 'form' },
    field('Modul', h('input', { name: 'module', type: 'text', value: g.module || '', required: true, placeholder: 'z. B. Statistik II' })),
    h('div', { class: 'two' },
      field('ECTS', h('input', { name: 'ects', type: 'number', min: 0, max: 60, step: 0.5, value: g.ects || 5, required: true })),
      field('Note (leer = unbenotet)', h('input', { name: 'grade', type: 'number', min: 1, max: 5, step: 0.1, value: g.grade || '' }))),
    field('Semester', semIn),
    h('datalist', { id: 'semlist' }, sems.map((s) => h('option', { value: s }))),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'passed', checked: g.passed !== false }), ' Bestanden'),
    h('label', { class: 'check-label' }, h('input', { type: 'checkbox', name: 'counts', checked: g.counts !== false }), ' Zählt für den Notenschnitt'));
  openModal(isNew ? 'Modul / Note eintragen' : 'Modul bearbeiten', body, (f) => {
    const n = f.grade.value ? Number(f.grade.value) : undefined;
    if (n !== undefined && (n < 1 || n > 5)) { toast('Die Note muss zwischen 1,0 und 5,0 liegen.'); return false; }
    const vals = { module: f.module.value.trim(), ects: Number(f.ects.value) || 0, grade: n, semester: f.semester.value.trim(), passed: f.passed.checked && !(n > 4), counts: f.counts.checked };
    if (isNew) DB.grades.push({ id: uid(), examId: g.examId, ...vals }); else Object.assign(g, vals);
    persist();
  }, isNew ? null : () => { DB.grades = DB.grades.filter((x) => x !== g); });
}
