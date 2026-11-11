'use strict';
/* Start der App (wird als letztes Skript geladen) */

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Tastenkürzel: n = neu, ←/→ = blättern, t = heute
document.addEventListener('keydown', (e) => {
  if ($('#modal').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = state.view === 'week' || state.view === 'work' ? 7 : 1;
  if (e.key === 'n') { e.preventDefault(); $('#fab').click(); }
  else if (e.key === 'ArrowLeft') { state.date = addDays(state.date, -step); render(); }
  else if (e.key === 'ArrowRight') { state.date = addDays(state.date, step); render(); }
  else if (e.key === 't') { state.date = today(); render(); }
});

// Jetzt-Linie jede Minute aktualisieren (nur wenn gerade nichts bearbeitet wird)
setInterval(() => {
  if (state.view === 'day' && !dragActive && !$('#modal').open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) render();
}, 60000);

// Klick auf eine Benachrichtigung kann die App mit ?view=… öffnen
const startView = new URLSearchParams(location.search).get('view');
if (startView && VIEWS[startView]) state.view = startView;

load().then(() => { render(); autoSyncCalendars(); }).catch(() => {
  setSync('error', 'Server nicht erreichbar');
  toast('Server nicht erreichbar');
  render();
});
