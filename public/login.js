document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.hidden = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value }),
    });
    if (r.ok) return (location.href = '/');
    const j = await r.json().catch(() => ({}));
    err.textContent = j.error || 'Anmeldung fehlgeschlagen';
  } catch (_) {
    err.textContent = 'Keine Verbindung zum Server';
  }
  err.hidden = false;
});
