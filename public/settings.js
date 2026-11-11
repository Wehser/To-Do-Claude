'use strict';
/* Einstellungen: Farben, Bereiche, Push-Benachrichtigungen, Kalender (Import/Export), Backup */

// ===========================================================================
// Push-Benachrichtigungen (Client)
// ===========================================================================
function pushDeviceId() {
  let id = localStorage.getItem('planer.deviceId');
  if (!id) { id = uid() + uid(); localStorage.setItem('planer.deviceId', id); }
  return id;
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android-Handy' : 'Android-Tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows-PC';
  return 'Gerät';
}

function b64ToUint8(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function enablePush(name) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt.');
  const cfg = await api('/api/push/config');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(cfg.publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: { deviceId: pushDeviceId(), name, subscription: sub.toJSON() } });
  localStorage.setItem('planer.pushOn', '1');
}

async function disablePushHere() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (_) { /* egal */ }
  localStorage.removeItem('planer.pushOn');
  await api('/api/push/devices/' + encodeURIComponent(pushDeviceId()), { method: 'DELETE' }).catch(() => {});
}

const DEVICE_TYPES = [['todo', 'To-Dos'], ['routine', 'Routinen'], ['study', 'Lerneinheiten'], ['work', 'Arbeit'], ['event', 'Kalender-Termine'], ['summary', 'Tages-Übersicht'], ['exams', 'Prüfungs-Countdown'], ['pomodoro', 'Pomodoro-Timer']];

function notifySection() {
  const n = DB.settings.notify;
  const box = h('section', { class: 'card' }, h('h3', null, '🔔 Push-Benachrichtigungen'));

  // --- Dieses Gerät ---
  const here = h('div', { class: 'subcard' }, h('h4', null, 'Dieses Gerät'));
  if (!pushSupported()) {
    here.append(h('p', { class: 'muted' }, isIos() && !isStandalone()
      ? 'Auf dem iPhone/iPad funktionieren Push-Nachrichten nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde: In Safari „Teilen“ → „Zum Home-Bildschirm“, dann die App von dort öffnen.'
      : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'));
  } else {
    const on = !!localStorage.getItem('planer.pushOn') && Notification.permission === 'granted';
    const nameIn = h('input', { type: 'text', value: guessDeviceName(), 'data-nofocus': '1' });
    here.append(on
      ? h('div', { class: 'row-actions' }, h('span', null, '✅ Benachrichtigungen sind auf diesem Gerät aktiv.'),
        h('button', { class: 'btn small', onclick: async () => { await api('/api/push/test', { method: 'POST', body: { deviceId: pushDeviceId() } }).then(() => toast('Testnachricht gesendet')).catch((e) => toast(e.message)); } }, 'Test senden'),
        h('button', { class: 'btn small danger', onclick: async () => { await disablePushHere(); toast('Auf diesem Gerät deaktiviert'); render(); } }, 'Hier deaktivieren'))
      : h('div', null,
        Notification.permission === 'denied' ? h('p', { class: 'error' }, 'Benachrichtigungen sind in den Browser-Einstellungen blockiert. Bitte dort für diese Seite erlauben.') : null,
        h('div', { class: 'quickadd' }, nameIn, h('button', { class: 'btn primary small', onclick: async () => {
          try { await enablePush(nameIn.value.trim() || guessDeviceName()); toast('Benachrichtigungen aktiviert 🎉'); render(); } catch (e) { toast(e.message || 'Aktivieren fehlgeschlagen', 5000); }
        } }, 'Auf diesem Gerät aktivieren'))));
  }
  box.append(here);

  // --- Alle Geräte ---
  const devBox = h('div', { class: 'subcard' }, h('h4', null, 'Deine Geräte'), h('p', { class: 'muted' }, 'Lädt …'));
  box.append(devBox);
  api('/api/push/config').then((cfg) => {
    devBox.replaceChildren(h('h4', null, 'Deine Geräte'));
    if (!cfg.devices.length) { devBox.append(h('p', { class: 'muted' }, 'Noch kein Gerät angemeldet.')); return; }
    if (!cfg.schedulerOk) devBox.append(h('p', { class: 'muted' }, 'Hinweis: Erinnerungen werden vom Server verschickt. Er muss dafür dauerhaft laufen (beim kostenlosen Render-Plan schläft er nach 15 Minuten ein).'));
    for (const d of cfg.devices) {
      const save = () => api('/api/push/devices/' + encodeURIComponent(d.id), { method: 'PUT', body: { name: d.name, enabled: d.enabled, types: d.types } }).catch((e) => toast(e.message));
      const nameIn = h('input', { type: 'text', value: d.name, 'data-nofocus': '1' });
      nameIn.addEventListener('change', () => { d.name = nameIn.value.trim() || d.name; save(); });
      const enabled = h('input', { type: 'checkbox', checked: d.enabled });
      enabled.addEventListener('change', () => { d.enabled = enabled.checked; save(); });
      const types = h('div', { class: 'type-toggles' }, DEVICE_TYPES.map(([k, l]) => {
        const cb = h('input', { type: 'checkbox', checked: d.types[k] !== false });
        cb.addEventListener('change', () => { d.types[k] = cb.checked; save(); });
        return h('label', { class: 'check-label' }, cb, l);
      }));
      devBox.append(h('div', { class: 'device' + (d.enabled ? '' : ' off') },
        h('div', { class: 'device-head' },
          h('label', { class: 'switch', title: 'Gerät aktiv' }, enabled, h('span')),
          nameIn,
          d.id === pushDeviceId() ? h('span', { class: 'chip' }, 'dieses Gerät') : null,
          h('button', { class: 'btn icon small', title: 'Testnachricht', onclick: () => api('/api/push/test', { method: 'POST', body: { deviceId: d.id } }).then(() => toast('Testnachricht gesendet')).catch((e) => toast(e.message)) }, '🔔'),
          h('button', { class: 'btn icon small', title: 'Gerät entfernen', onclick: async () => {
            if (!confirm(`Gerät „${d.name}“ entfernen?`)) return;
            if (d.id === pushDeviceId()) await disablePushHere(); else await api('/api/push/devices/' + encodeURIComponent(d.id), { method: 'DELETE' });
            render();
          } }, '✕')),
        h('small', { class: 'muted' }, 'Welche Nachrichten auf dieses Gerät?'), types));
    }
  }).catch(() => devBox.replaceChildren(h('h4', null, 'Deine Geräte'), h('p', { class: 'muted' }, 'Konnte Geräte nicht laden.')));

  // --- Regeln ---
  const rules = h('div', { class: 'subcard' }, h('h4', null, 'Wann soll erinnert werden?'),
    h('p', { class: 'muted' }, 'Gilt für alle Geräte. Bei einzelnen To-Dos und Routinen kannst du im Bearbeiten-Dialog eine eigene Erinnerung wählen.'));
  const minRow = (key, label) => {
    const cb = h('input', { type: 'checkbox', checked: n[key].on });
    const sel = h('select', null, [0, 5, 10, 15, 30, 45, 60, 120].map((m) => h('option', { value: m, selected: Number(n[key].min) === m }, m === 0 ? 'zum Beginn' : m < 60 ? m + ' min vorher' : m / 60 + ' h vorher')));
    cb.addEventListener('change', () => { n[key].on = cb.checked; persist(); });
    sel.addEventListener('change', () => { n[key].min = Number(sel.value); persist(); });
    return h('div', { class: 'set-row' }, h('label', { class: 'check-label' }, cb, label), sel);
  };
  const timeRow = (key, label) => {
    const cb = h('input', { type: 'checkbox', checked: n[key].on });
    const t = h('input', { type: 'time', value: n[key].time });
    cb.addEventListener('change', () => { n[key].on = cb.checked; persist(); });
    t.addEventListener('change', () => { n[key].time = t.value; persist(); });
    return h('div', { class: 'set-row' }, h('label', { class: 'check-label' }, cb, label), t);
  };
  rules.append(minRow('todo', 'To-Dos mit Uhrzeit'), minRow('routine', 'Routinen'), minRow('study', 'Lerneinheiten'), minRow('work', 'Arbeitsbeginn'), minRow('event', 'Kalender-Termine'),
    timeRow('morning', 'Morgens: Tagesübersicht um'), timeRow('evening', 'Abends: offene To-Dos um'));
  const exCb = h('input', { type: 'checkbox', checked: n.exams.on });
  const exDays = h('input', { type: 'text', value: n.exams.days, placeholder: '14,7,3,1', 'data-nofocus': '1', style: { maxWidth: '170px' } });
  exCb.addEventListener('change', () => { n.exams.on = exCb.checked; persist(); });
  exDays.addEventListener('change', () => { n.exams.days = exDays.value.replace(/[^\d,]/g, ''); persist(); });
  rules.append(h('div', { class: 'set-row' }, h('label', { class: 'check-label' }, exCb, 'Prüfungs-Countdown (Tage vorher, morgens)'), exDays));
  const qCb = h('input', { type: 'checkbox', checked: n.quiet.on });
  const qFrom = h('input', { type: 'time', value: n.quiet.from }), qTo = h('input', { type: 'time', value: n.quiet.to });
  qCb.addEventListener('change', () => { n.quiet.on = qCb.checked; persist(); });
  qFrom.addEventListener('change', () => { n.quiet.from = qFrom.value; persist(); });
  qTo.addEventListener('change', () => { n.quiet.to = qTo.value; persist(); });
  rules.append(h('div', { class: 'set-row' }, h('label', { class: 'check-label' }, qCb, 'Ruhezeit (keine Nachrichten)'), h('span', { class: 'time-range' }, qFrom, '–', qTo)));
  box.append(rules);
  return box;
}

// ===========================================================================
// Kalender: Import (.ics-Datei oder Abo-URL) und Export
// ===========================================================================
function icsWindow() { return [addDays(today(), -60), addDays(today(), 400)]; }

async function syncCalendar(c, text) {
  if (!text) text = (await api('/api/ics/fetch?url=' + encodeURIComponent(c.url))).text;
  const [f, t] = icsWindow();
  const events = parseIcs(text, f, t);
  c.events = events;
  c.syncedAt = new Date().toISOString();
  persist();
  return events.length;
}

async function autoSyncCalendars() {
  for (const c of DB.calendars) {
    if (!c.url || (c.syncedAt && Date.now() - new Date(c.syncedAt) < 6 * 3600 * 1000)) continue;
    try { await syncCalendar(c); render(); } catch (_) { /* später erneut */ }
  }
}

function addCalendar() {
  const fileIn = h('input', { type: 'file', name: 'file', accept: '.ics,text/calendar' });
  const body = h('div', { class: 'form' },
    field('Name', h('input', { name: 'name', type: 'text', required: true, placeholder: 'z. B. Stundenplan Uni' })),
    field('Abo-Adresse (URL, wird automatisch aktualisiert)', h('input', { name: 'url', type: 'url', placeholder: 'https://… .ics  oder  webcal://…', 'data-nofocus': '1' })),
    h('p', { class: 'muted' }, '… oder eine .ics-Datei hochladen (einmaliger Import):'),
    fileIn,
    field('Bereich', areaSelect('uni')),
    h('p', { class: 'muted' }, 'Tipp: Viele Unis (HISinOne, Stud.IP, Moodle, TUMonline …) bieten den Stundenplan als iCal-Export oder Abo-Link an. Google Kalender: Einstellungen → Kalender → „Privatadresse im iCal-Format“.'));
  openModal('Kalender importieren', body, (f) => {
    const url = f.url.value.trim().replace(/^webcal:\/\//i, 'https://');
    const file = fileIn.files[0];
    if (!url && !file) { toast('Bitte eine URL angeben oder eine Datei wählen.'); return false; }
    const c = { id: uid(), name: f.name.value.trim(), url: url || '', areaId: f.area.value, events: [] };
    (async () => {
      try {
        const n = await syncCalendar(c, file ? await file.text() : null);
        DB.calendars.push(c);
        persist(); render();
        toast(n + ' Termine importiert');
      } catch (e) { toast('Import fehlgeschlagen: ' + e.message, 6000); }
    })();
  }, null, 'Importieren');
}

function calendarSection() {
  const box = h('section', { class: 'card' }, h('div', { class: 'view-head' }, h('h3', null, '📅 Kalender & Stundenplan'),
    h('button', { class: 'btn small primary', onclick: addCalendar }, '+ Importieren')));
  box.append(h('p', { class: 'muted' }, 'Importierte Termine erscheinen türkis im Tagesplan. Sie werden bei der Suche nach freien Zeitfenstern berücksichtigt.'));
  for (const c of DB.calendars) {
    const areaSel = areaSelect(c.areaId);
    areaSel.addEventListener('change', () => { c.areaId = areaSel.value; persist(); });
    const vis = h('input', { type: 'checkbox', checked: !c.hidden });
    vis.addEventListener('change', () => { c.hidden = !vis.checked; persist(); });
    box.append(h('div', { class: 'device' },
      h('div', { class: 'device-head' },
        h('label', { class: 'switch', title: 'Anzeigen' }, vis, h('span')),
        h('strong', { class: 'grow' }, c.name),
        c.url ? h('button', { class: 'btn small', onclick: async () => { try { toast((await syncCalendar(c)) + ' Termine aktualisiert'); render(); } catch (e) { toast('Fehler: ' + e.message); } } }, '⟳ Aktualisieren') : null,
        h('button', { class: 'btn icon small', title: 'Entfernen', onclick: () => { if (confirm(`Kalender „${c.name}“ entfernen?`)) { DB.calendars = DB.calendars.filter((x) => x !== c); persist(); render(); } } }, '✕')),
      h('div', { class: 'item-meta' }, h('span', null, c.events.length + ' Termine'), c.url ? h('span', null, 'Abo') : h('span', null, 'Datei-Import'),
        c.syncedAt ? h('span', null, 'Stand: ' + new Date(c.syncedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })) : null, areaSel)));
  }

  // Export
  const exp = h('div', { class: 'subcard' }, h('h4', null, 'In Google / Apple / Outlook Kalender anzeigen'),
    h('p', { class: 'muted' }, 'Abonniere diese geheime Adresse in deiner Kalender-App. Dann erscheinen To-Dos, Routinen, Lerneinheiten, Prüfungen und Arbeitszeiten dort automatisch (Kalender-Apps aktualisieren Abos etwa alle paar Stunden).'));
  const urlIn = h('input', { type: 'text', readonly: true, value: 'Lädt …', 'data-nofocus': '1' });
  exp.append(h('div', { class: 'quickadd' }, urlIn,
    h('button', { class: 'btn small', onclick: () => { urlIn.select(); navigator.clipboard.writeText(urlIn.value).then(() => toast('Adresse kopiert')).catch(() => document.execCommand('copy')); } }, 'Kopieren')));
  const showUrl = (tok) => (urlIn.value = location.origin + '/cal/' + tok + '.ics');
  api('/api/ics/token').then((j) => showUrl(j.token)).catch(() => (urlIn.value = 'Fehler beim Laden'));
  exp.append(h('div', { class: 'row-actions' },
    h('a', { class: 'btn small', href: '#', onclick: (e) => { e.preventDefault(); location.href = urlIn.value; } }, '⬇ .ics herunterladen'),
    h('button', { class: 'btn small', onclick: async () => { if (!confirm('Neue Adresse erzeugen? Die alte funktioniert dann nicht mehr.')) return; showUrl((await api('/api/ics/token', { method: 'POST', body: {} })).token); toast('Neue Adresse erzeugt'); } }, 'Neue Adresse erzeugen')),
    h('details', null, h('summary', null, 'So geht’s'),
      h('ul', null,
        h('li', null, 'Google Kalender (am PC): links „Weitere Kalender +“ → „Per URL“ → Adresse einfügen.'),
        h('li', null, 'iPhone: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.'),
        h('li', null, 'Outlook: Kalender hinzufügen → Aus dem Internet abonnieren.'))));
  box.append(exp);
  return box;
}

// ===========================================================================
// Einstellungen-Ansicht
// ===========================================================================
VIEWS.settings = function renderSettings(main) {
  const s = DB.settings;
  main.append(h('h2', { class: 'section-title' }, 'Einstellungen'));
  main.append(notifySection());
  main.append(calendarSection());

  const colors = h('section', { class: 'card' }, h('h3', null, '🎨 Farben der Kategorien'));
  for (const k of ['routine', 'todo', 'study', 'work', 'event']) {
    const inp = h('input', { type: 'color', value: s.colors[k] });
    inp.addEventListener('input', () => { s.colors[k] = inp.value; applyTheme(); persist(); });
    colors.append(h('label', { class: 'set-row' }, h('span', null, KIND_LABEL[k]), inp));
  }
  main.append(colors);

  const areasBox = h('section', { class: 'card' }, h('h3', null, 'Bereiche (z. B. Uni, Arbeit, Privat)'));
  for (const a of DB.areas) {
    const name = h('input', { type: 'text', value: a.name, 'data-nofocus': '1' });
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

  const numRow = (obj, label, key, min, max, step = 1) => {
    const inp = h('input', { type: 'number', min, max, step, value: obj[key] });
    inp.addEventListener('change', () => { obj[key] = Number(inp.value); persist(); });
    return h('label', { class: 'set-row' }, h('span', null, label), inp);
  };
  const pomo = h('section', { class: 'card' }, h('h3', null, '🍅 Pomodoro-Timer'),
    numRow(s.pomodoro, 'Fokuszeit (Minuten)', 'focus', 5, 180), numRow(s.pomodoro, 'Kurze Pause (Minuten)', 'short', 1, 60),
    numRow(s.pomodoro, 'Lange Pause (Minuten)', 'long', 1, 90), numRow(s.pomodoro, 'Lange Pause nach … Runden', 'longEvery', 2, 10));
  const snd = h('input', { type: 'checkbox', checked: s.pomodoro.sound });
  snd.addEventListener('change', () => { s.pomodoro.sound = snd.checked; persist(); });
  pomo.append(h('label', { class: 'set-row' }, h('span', null, 'Signalton'), snd));
  main.append(pomo);

  const gen = h('section', { class: 'card' }, h('h3', null, 'Allgemein'));
  gen.append(numRow(s, 'Tagesansicht ab (Uhr)', 'dayStart', 0, 23), numRow(s, 'Tagesansicht bis (Uhr)', 'dayEnd', 1, 24),
    numRow(s, 'Wochenziel Arbeitsstunden', 'weeklyWorkTarget', 0, 80), numRow(s, 'Stundenlohn (€, optional)', 'hourlyWage', 0, 500, 0.01));
  const theme = h('select', null, ['auto', 'light', 'dark'].map((v) => h('option', { value: v, selected: s.theme === v }, { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' }[v])));
  theme.addEventListener('change', () => { s.theme = theme.value; applyTheme(); persist(); });
  gen.append(h('label', { class: 'set-row' }, h('span', null, 'Design'), theme));
  main.append(gen);

  main.append(h('section', { class: 'card' }, h('h3', null, '💾 Datensicherung'),
    h('p', { class: 'muted' }, 'Lade regelmäßig eine Sicherung herunter. Damit kannst du deine Daten jederzeit wiederherstellen. „Daten hinzufügen“ ergänzt Einträge aus einer Datei (z. B. von Claude erstellt), ohne Vorhandenes zu löschen.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => download('planer-backup-' + today() + '.json', JSON.stringify(DB, null, 2), 'application/json') }, '⬇ Backup herunterladen'),
      h('button', { class: 'btn primary', onclick: importMerge }, '➕ Daten hinzufügen'),
      h('button', { class: 'btn', onclick: importBackup }, '⬆ Backup einspielen (ersetzt alles)'),
      h('button', { class: 'btn', onclick: () => {
        const cutoff = addDays(today(), -60);
        const before = DB.todos.length;
        DB.todos = DB.todos.filter((t) => !(t.done && t.date < cutoff));
        for (const d of Object.keys(DB.routineChecks)) if (d < addDays(today(), -400)) delete DB.routineChecks[d];
        persist(); toast((before - DB.todos.length) + ' alte, erledigte To-Dos entfernt (Lernzeit-Protokoll bleibt erhalten)');
      } }, 'Aufräumen (erledigte To-Dos älter als 60 Tage)'))));

  main.append(h('section', { class: 'card' }, h('h3', null, 'Konto'),
    h('button', { class: 'btn danger', onclick: async () => { await saveNow(); await fetch('/api/logout'); location.href = '/login'; } }, 'Abmelden')));
};

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
// Daten hinzufügen (Zusammenführen statt Ersetzen)
// ===========================================================================
const MERGE_SETTINGS = { weeklyWorkTarget: 'Wochenziel Arbeitsstunden', hourlyWage: 'Stundenlohn', dayStart: 'Tagesansicht ab', dayEnd: 'Tagesansicht bis', ectsTarget: 'ECTS gesamt', gradeTarget: 'Wunsch-Endnote' };
const MERGE_LISTS = { routines: 'Routinen', todos: 'To-Dos', exams: 'Prüfungen', work: 'Arbeitszeiten', grades: 'Noten', focus: 'Lernzeiten', calendars: 'Kalender' };

/** Ordnet Bereichsangaben (ID oder Name) vorhandenen Bereichen zu und legt fehlende an. */
function resolveArea(ref, fileAreas, created) {
  if (!ref) return undefined;
  if (DB.areas.some((a) => a.id === ref)) return ref;
  const fromFile = (fileAreas || []).find((a) => a.id === ref || (a.name || '').toLowerCase() === String(ref).toLowerCase());
  const name = fromFile ? fromFile.name : String(ref);
  const existing = DB.areas.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const a = { id: uid(), name, color: (fromFile && fromFile.color) || '#0ea5e9' };
  DB.areas.push(a);
  created.push(name);
  return a.id;
}

function mergeData(data) {
  const report = { added: {}, updated: {}, areas: [] };
  const today0 = today();
  const fixups = {
    routines: (r) => ({ weekdays: [0, 1, 2, 3, 4, 5, 6], createdAt: today0, notes: '', ...r }),
    todos: (t) => ({ done: false, priority: 'normal', notes: '', subtasks: [], ...t, subtasks: (t.subtasks || []).map((st) => ({ id: uid(), done: false, ...(typeof st === 'string' ? { title: st } : st) })) }),
    exams: (x) => ({ type: 'Prüfung', ...x }),
    work: (w) => ({ pause: 0, note: '', ...w }),
    grades: (g) => ({ ...g }),
    focus: (f) => ({ manual: true, ...f }),
    calendars: (c) => ({ events: [], ...c }),
  };
  for (const [key, label] of Object.entries(MERGE_LISTS)) {
    if (!Array.isArray(data[key])) continue;
    for (const raw of data[key]) {
      if (!raw || typeof raw !== 'object') continue;
      const item = fixups[key]({ id: uid(), ...raw });
      if ('areaId' in item || item.area) { item.areaId = resolveArea(item.areaId || item.area, data.areas, report.areas); delete item.area; }
      const idx = DB[key].findIndex((x) => x.id === item.id);
      if (idx >= 0) { DB[key][idx] = { ...DB[key][idx], ...item }; report.updated[label] = (report.updated[label] || 0) + 1; }
      else { DB[key].push(item); report.added[label] = (report.added[label] || 0) + 1; }
    }
  }
  // Bereiche aus der Datei übernehmen, auch wenn sie (noch) nicht benutzt werden
  for (const a of data.areas || []) resolveArea(a.id || a.name, data.areas, report.areas);
  if (data.routineChecks && typeof data.routineChecks === 'object') {
    for (const [d, v] of Object.entries(data.routineChecks)) DB.routineChecks[d] = { ...(DB.routineChecks[d] || {}), ...v };
  }
  // Einträge entfernen: { remove: { work: ['id', …], todos: [...] } }
  report.removed = {};
  if (data.remove && typeof data.remove === 'object') {
    for (const [key, label] of Object.entries(MERGE_LISTS)) {
      const ids = new Set(Array.isArray(data.remove[key]) ? data.remove[key] : []);
      if (!ids.size) continue;
      const before = DB[key].length;
      DB[key] = DB[key].filter((x) => !ids.has(x.id));
      if (before - DB[key].length) report.removed[label] = before - DB[key].length;
    }
  }
  // Ausgewählte Einstellungen übernehmen
  report.settings = [];
  if (data.settings && typeof data.settings === 'object') {
    for (const [k, label] of Object.entries(MERGE_SETTINGS)) {
      if (data.settings[k] !== undefined) { DB.settings[k] = data.settings[k]; report.settings.push(label + ': ' + data.settings[k]); }
    }
  }
  if (data.notes && typeof data.notes === 'object') for (const [d, v] of Object.entries(data.notes)) DB.notes[d] = DB.notes[d] ? DB.notes[d] + '\n' + v : v;
  return report;
}

function importMerge() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    let data;
    try {
      data = JSON.parse(await inp.files[0].text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Format');
    } catch (_) { toast('Die Datei konnte nicht gelesen werden (kein gültiges JSON).', 5000); return; }
    const counts = Object.entries(MERGE_LISTS).filter(([k]) => Array.isArray(data[k]) && data[k].length).map(([k, l]) => data[k].length + ' ' + l);
    const removes = Object.entries(MERGE_LISTS).filter(([k]) => data.remove && Array.isArray(data.remove[k]) && data.remove[k].length).map(([k, l]) => data.remove[k].length + ' ' + l + ' werden entfernt');
    const sets = Object.entries(MERGE_SETTINGS).filter(([k]) => data.settings && data.settings[k] !== undefined).map(([k, l]) => 'Einstellung „' + l + '“ = ' + data.settings[k]);
    counts.push(...removes, ...sets);
    if (!counts.length) { toast('In der Datei wurden keine Einträge gefunden.', 5000); return; }
    const body = h('div', { class: 'form' },
      h('p', null, 'Folgende Änderungen werden übernommen:'),
      h('ul', null, counts.map((c) => h('li', null, c))),
      h('p', { class: 'muted' }, 'Vorhandene Einträge bleiben erhalten. Einträge mit gleicher ID werden aktualisiert. Vorher wird automatisch ein Backup heruntergeladen.'));
    openModal('Daten hinzufügen', body, () => {
      download('planer-backup-vor-import-' + today() + '.json', JSON.stringify(DB, null, 2), 'application/json');
      const r = mergeData(data);
      persist();
      const fmt = (o) => Object.entries(o).map(([l, n]) => n + ' ' + l).join(', ');
      toast('✓ Hinzugefügt: ' + (fmt(r.added) || 'nichts') + (Object.keys(r.updated).length ? ' · aktualisiert: ' + fmt(r.updated) : '') + (r.areas.length ? ' · neue Bereiche: ' + r.areas.join(', ') : '') + (Object.keys(r.removed).length ? ' · entfernt: ' + fmt(r.removed) : '') + (r.settings.length ? ' · ' + r.settings.join(', ') : ''), 8000);
    }, null, 'Hinzufügen');
  });
  inp.click();
}
