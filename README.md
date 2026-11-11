# Mein Planer

Ein passwortgeschützter Tagesplaner im Browser, den du auf Handy, Tablet und Laptop nutzen kannst. Alle Geräte sehen dieselben Daten.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Tag** | Zeitplan mit Time-Slots (Klick in eine Stunde legt ein To-Do an), Liste „Ohne Uhrzeit“, Fortschrittsbalken, rote Jetzt-Linie, Tagesnotiz, Schnelleingabe („14:00-15:30 Mathe“) |
| **Routinen** (blau) | Wiederkehrende Aufgaben: täglich oder an bestimmten Wochentagen, optional mit Start-/Enddatum. Abhaken pro Tag, „heute überspringen“, Serie 🔥 und Erfüllungsquote der letzten 30 Tage |
| **To-Dos** (orange) | Aufgaben für einen bestimmten Tag, mit Uhrzeit, Priorität, Bereich, Notizen, optionaler Wiederholung. Unerledigte To-Dos aus der Vergangenheit erscheinen als „Überfällig“ und lassen sich auf heute verschieben |
| **Lernplan** (lila) | Prüfungen, Klausuren und Abgaben mit Countdown. Lerneinheiten werden automatisch bis zum Termin verteilt (Anzahl, Dauer, Uhrzeit, Lerntage einstellbar), mit Fortschritt |
| **Arbeitszeit** (grün) | Schichten mit Pause, Wochenziel, Monatssumme, optional Stundenlohn, CSV-Export für Excel |
| **Woche** | 7-Tage-Übersicht und Auswertung der geplanten Stunden je Bereich |
| **Bereiche** | Frei definierbar (vorgegeben: Privat, Uni, Arbeit, Sport & Gesundheit), jeweils mit eigener Farbe; jede Ansicht lässt sich danach filtern |
| **Sonstiges** | Hell/Dunkel-Modus, Farben anpassbar, Backup als Datei herunterladen und wieder einspielen, als App auf dem Homescreen installierbar, Tastenkürzel (`n` neu, `←`/`→` blättern, `t` heute) |

## Lokal starten

Benötigt [Node.js](https://nodejs.org) ab Version 18.

```bash
APP_PASSWORD="dein-sicheres-passwort" npm start
```

Danach http://localhost:3000 öffnen. Die Daten liegen in `data/planer.json`, dazu wird täglich ein Backup angelegt.

## Online stellen (kostenlos): Render + Neon

Damit du von überall darauf zugreifen kannst, braucht die App einen Server und eine Datenbank. Beides gibt es kostenlos:

1. **Datenbank anlegen:** Auf [neon.tech](https://neon.tech) registrieren, ein Projekt erstellen und den *Connection String* kopieren (beginnt mit `postgresql://…`).
2. **Server anlegen:** Auf [render.com](https://render.com) mit GitHub anmelden → *New* → *Web Service* → dieses Repository wählen.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: *Free*
3. Unter **Environment** diese Variablen setzen:
   - `APP_PASSWORD` = dein Passwort (mindestens 12 Zeichen empfohlen)
   - `SESSION_SECRET` = eine lange, zufällige Zeichenkette
   - `DATABASE_URL` = der Connection String von Neon
4. *Deploy* klicken. Nach ein paar Minuten ist die Seite unter `https://<name>.onrender.com` erreichbar.

Hinweis: Der kostenlose Render-Plan schläft nach 15 Minuten ohne Nutzung ein. Der erste Aufruf danach dauert etwa 30–50 Sekunden. Für ein paar Euro im Monat (Render „Starter“) entfällt das.

### Andere Möglichkeiten

- **Railway / Fly.io:** Funktioniert genauso; entweder `DATABASE_URL` setzen oder ein Volume einbinden und `DATA_DIR` darauf zeigen lassen.
- **Eigener Server / NAS mit Docker:**
  ```bash
  docker build -t mein-planer .
  docker run -d -p 3000:3000 -e APP_PASSWORD="…" -e SESSION_SECRET="…" -v planer-daten:/data mein-planer
  ```
  Davor einen Reverse-Proxy mit HTTPS (z. B. Caddy) schalten.

## Sicherheit

- Ohne Passwort ist nur die Login-Seite erreichbar. Nach dem Login bleibt man 30 Tage angemeldet (`SESSION_DAYS` ändert das).
- Nach 10 falschen Passwörtern wird eine IP für 15 Minuten gesperrt.
- Wer `APP_PASSWORD` oder `SESSION_SECRET` ändert, meldet alle Geräte ab.
- Online immer über HTTPS nutzen (bei Render automatisch).

## Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `APP_PASSWORD` | ja | Passwort für die Anmeldung |
| `SESSION_SECRET` | empfohlen | Zufälliger Schlüssel zum Signieren der Login-Cookies |
| `DATABASE_URL` | nein | PostgreSQL-Verbindung; ohne sie wird in eine Datei gespeichert |
| `DATA_DIR` | nein | Ordner für die Datei-Speicherung (Standard `./data`) |
| `PORT` | nein | Port des Servers (Standard 3000) |
| `SESSION_DAYS` | nein | Wie lange ein Login gültig bleibt (Standard 30) |
