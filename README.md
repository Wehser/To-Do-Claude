# Mein Planer

Ein passwortgeschützter Tagesplaner im Browser, den du auf Handy, Tablet und Laptop nutzen kannst. Alle Geräte sehen dieselben Daten.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Tag** | Zeitplan mit Time-Slots, freie Zeitfenster, Liste „Ohne Uhrzeit“, Fortschrittsbalken, Jetzt-Linie, Tagesnotiz, Schnelleingabe („14:00-15:30 Mathe“). To-Dos per Ziehen verschieben und in der Länge ändern (am Handy: kurz gedrückt halten) |
| **Routinen** (blau) | Täglich oder an bestimmten Wochentagen, optional mit Start-/Enddatum. Abhaken, „heute überspringen“, Serie 🔥 und Quote der letzten 30 Tage |
| **To-Dos** (orange) | Für einen bestimmten Tag, mit Uhrzeit, Priorität, Bereich, **Unteraufgaben**, eigener Erinnerung, Wiederholung. Überfällige To-Dos lassen sich auf heute verschieben |
| **Überschneidungen** | Beim Anlegen oder Verschieben in eine belegte Zeit erscheint ein Hinweis mit Vorschlag für die nächste freie Zeit |
| **Lernplan** (lila) | Prüfungen und Abgaben mit Countdown. Lerneinheiten werden automatisch in freie Zeitfenster bis zum Termin verteilt |
| **Pomodoro-Timer** | Start per ▶ an jeder Aufgabe oder Prüfung. Fokus- und Pausenzeiten einstellbar, Ton, Push-Nachricht zum Ende. Lernzeit wird protokolliert und lässt sich nachträglich bearbeiten oder nachtragen (mit Konzentrations-Bewertung) |
| **Dashboard** | Wochen-, Monats- oder freier Zeitraum: Lernzeit geplant vs. tatsächlich, nach Fach und Uhrzeit, Erledigungsquote, Routinen, Arbeitszeit, Notenschnitt, Rückblick in Worten, Vergleich mit dem Vorzeitraum, CSV-Export |
| **Noten & ECTS** | Module mit ECTS und Note je Semester, ECTS-gewichteter Schnitt, Fortschritt zum Studienziel, Zielrechner („Welchen Schnitt brauche ich noch?“) |
| **Arbeitszeit** (grün) | Schichten mit Pause, Wochenziel, Monatssumme, Stundenlohn, CSV-Export |
| **Kalender** (türkis) | Stundenplan oder Google-Kalender als .ics-Datei oder Abo-Link importieren (inkl. Serienterminen). Eigene Einträge als Abo in Google, Apple oder Outlook Kalender anzeigen |
| **Push-Benachrichtigungen** | Pro Gerät an/aus und je Nachrichtenart wählbar. Vorlaufzeit je Kategorie, Morgen-Übersicht, Abend-Erinnerung, Prüfungs-Countdown, Ruhezeiten, eigene Erinnerung pro Eintrag |
| **Sonstiges** | Bereiche mit Farben und Filter, Hell/Dunkel, Backup, als App installierbar, Tastenkürzel (`n`, `←`/`→`, `t`) |

### Hinweise zu Push-Nachrichten

- Erinnerungen verschickt der Server. Er muss dafür **dauerhaft laufen**. Der kostenlose Render-Plan schläft nach 15 Minuten ein; dann kommen Erinnerungen nur, solange jemand die Seite nutzt. Abhilfe: bezahlter Plan (ca. 7 $/Monat) oder ein eigener Server.
- **iPhone/iPad:** Push geht nur, wenn die Seite über Safari → Teilen → „Zum Home-Bildschirm“ installiert und von dort geöffnet wird (ab iOS 16.4).
- Die Schlüssel für Push werden beim ersten Start erzeugt und in der Datenbank gespeichert.

### Geplant / Ideen

- Gewohnheiten zählen (Wasser, Schritte …) und Routinen mit Unterpunkten

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
| `VAPID_SUBJECT` | nein | Kontakt für Push-Dienste, z. B. `mailto:du@example.com` (Standard: Adresse der Seite) |
| `ALWAYS_ON` | nein | Auf `1` setzen, wenn der Server dauerhaft läuft (blendet den Hinweis in den Einstellungen aus) |
