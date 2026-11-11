'use strict';
/* Start der App (wird als letztes Skript geladen) */

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Tastenkürzel: n = neu, ←/→ = blättern, t = heute
document.addEventListener('keydown', (e) => {
  if ($('#modal').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = state.view === 'week' || state.view === 'work' ? 7 : 1;
  const move = (dir) => {
    if (state.view === 'month') state.date = addMonths(state.date, dir);
    else if (state.view === 'year') state.date = (parseYmd(state.date).getFullYear() + dir) + '-01-01';
    else state.date = addDays(state.date, dir * step);
    render();
  };
  if (e.key === 'n') { e.preventDefault(); $('#fab').click(); }
  else if (e.key === 'ArrowLeft') move(-1);
  else if (e.key === 'ArrowRight') move(1);
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
