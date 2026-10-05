# CLAUDE.md – VereinsAuslagen

Anweisungen für Claude Code. Zuerst **`CHANGELOG.md`** lesen (aktueller Stand, offene Punkte),
für Betrieb/Installation die **`README.md`**.

## Worum es geht

PWA zum Erfassen, Verwalten und Einreichen von Vereinsauslagen (Belegfoto/PDF, Status
offen → eingereicht → erstattet, Einreichungs-PDF, ZIP-Backup). Die App speichert alles
zentral in MySQL/MariaDB über ein schlankes PHP-Backend, mit Benutzerkonten, TOTP, Passkeys und
Admin-Bereich. Zielgruppe: kleine Vereine auf normalem Shared-Webhosting (FTP-Upload, kein Build).

## Technik & Aufbau

- **Kein Build, keine Abhängigkeiten per npm/composer.** Reines ES-Module-JS, CSS, PHP 8.1+.
  Bibliotheken liegen fertig in `vendor/` (jszip, pdf-lib, qrcode) und werden per `ladeSkript()`
  erst bei Bedarf geladen.
- **Frontend** (`js/`): `main.js` = Einstieg, Hash-Routing (`#neu`, `#uebersicht`, `#export`,
  `#profil`), Event-Delegation. Ansichten `ansicht-*.js` rendern per `innerHTML` in `#hauptInhalt`.
  - `api.js` – `fetch`-Wrapper, setzt immer `X-VA-Anfrage: 1`; 401 → Event `nicht-angemeldet`
  - `sitzung.js` – Serverstatus (`GET status`) und angemeldeter Benutzer
  - `speicher.js` – In-Memory-Cache der eigenen Auslagen; Änderungen erst nach Server-OK übernehmen
  - `hilfen.js` – reine Hilfsfunktionen, `registriereAktionen`, `zeigeToast`, `meldeDatenAenderung`
  - `detail.js` (Bottom-Sheet), `einreichen.js`/`export.js`/`pdf.js` (PDF/ZIP), `webauthn.js`
- **Backend** (`api/`): einziger Einstieg `api/index.php`, Aufruf `api/?r=<route>`.
  Routen werden mit `route('METHODE', 'pfad', fn)` in `api/routen/*.php` registriert.
  Antwort immer über `antworte([...])` → `{ok:true,…}`; fachliche Fehler als
  `throw new ApiFehler('Text für Nutzer', status)` → `{ok:false, fehler}`.
  - `lib/db.php` – PDO, `abfrage($sql, $werte)`, Schema/Migration, DB-Kopie
  - `lib/sitzung.php` – Sitzung, `erfordereLogin()`/`erfordereAdmin()`, Brute-Force-Schutz
  - `lib/konfig.php` – `api/config/config.php` lesen/schreiben, AES-GCM für TOTP-Geheimnisse
  - `lib/totp.php`, `lib/webauthn.php` – eigene Implementierungen ohne Fremdbibliothek
- **Datenbank**: alle Tabellen mit Präfix `va_`; Belege als `LONGBLOB` in `va_belege`.

## Konventionen (unbedingt einhalten)

- **Sprache:** Bezeichner, Kommentare, UI-Texte und Fehlermeldungen auf **Deutsch**
  (`rendereUebersicht`, `ladeEigeneAuslage`, `ApiFehler`). Umlaute in Bezeichnern ausschreiben
  (`ae`, `oe`, `ue`, `ss`), in Texten echte Umlaute und typografische Anführungszeichen „…“.
- **Dateikopf:** Jede Datei beginnt mit einem `// ====` Kommentarblock, der Zweck und Besonderheiten
  beschreibt. Abschnitte mit `// ----` trennen. Kommentardichte wie im Bestand: kurz, erklärt das *Warum*.
- **Strikte CSP** (`index.html`): keine Inline-Skripte, keine Inline-Styles, keine `on…`-Attribute.
  Klicks über `data-aktion="name"` + `registriereAktionen({ name: (el, e) => … })`,
  Formulare über `data-formular="x"` → Handler `formular:x`, Dateiauswahl über `data-datei-aktion`.
- **HTML-Ausgabe:** Nutzerdaten in Templates immer durch `escapeHtml()`.
- **Kommunikation zwischen Modulen** über DOM-Events (`daten-geaendert`, `benutzer-geaendert`,
  `angemeldet`, `abgemeldet`, `nicht-angemeldet`, `ansicht-rendern`, `design-geaendert`,
  `version-geaendert`).
- **PHP:** `declare(strict_types=1);`, nur Prepared Statements über `abfrage()`, jede Route prüft
  zuerst `erfordereLogin()` bzw. `erfordereAdmin()`. Auslagen-Zugriffe immer mit
  `benutzer_id = ?` einschränken – Admins sehen **keine** fremden Auslagen.
- **Sicherheitsinvarianten nicht aufweichen:** CSRF-Header + Origin-Prüfung, `sitzung_gen`
  (Passwortwechsel/Sperre/MFA-Reset beendet andere Sitzungen), letzter aktiver Admin nicht
  entfernbar, TOTP-Schlüssel nie in der DB.
- **Ordner `app-icons/` nicht in `icons/` umbenennen** (Apache-Alias-Konflikt, siehe README).

## Checkliste bei Änderungen

1. **Frontend geändert?** → `VERSION` in `sw.js` erhöhen (SemVer, aktuell 3.0.x).
   Neue Dateien in `APP_SHELL` eintragen, sonst fehlen sie offline.
2. **Schema geändert?** → `SCHEMA_VERSION` in `api/lib/db.php` erhöhen und in `migriere()` einen
   Block `if ($version < N) { … }` ergänzen. Neue Tabellen auch in `TABELLEN` (Reihenfolge
   nach Fremdschlüsseln) aufnehmen, damit der DB-Wechsel sie kopiert.
3. **Neue API-Route?** → in passender `api/routen/*.php` registrieren; Frontend ruft über
   `apiGet/apiPost/apiPut/apiDelete` und `mitId()` auf.
4. **Backup-Format berührt?** → Kompatibilität mit Backups der früheren Einzelplatz-Version erhalten
   (`BACKUP_FORMAT` in `export.js`).
5. **`CHANGELOG.md` aktualisieren** (Änderungsprotokoll + offene Punkte). Bei nutzersichtbaren
   Änderungen auch **`BENUTZERHANDBUCH.md`** (Bedienung, Knopf-Beschriftungen exakt wie in der UI)
   und bei Betrieb/Installation die README anpassen.
6. **Wiki nachziehen** (`../auslagenverwaltung.wiki`, eigenes Git-Repo): Die Seiten spiegeln README,
   Benutzerhandbuch und CHANGELOG (API-Routen, Schema, Roadmap) – geänderte Abschnitte dort
   ebenfalls anpassen und im Wiki-Repo committen.

## Dokumentation

- `README.md` – Installation, Betrieb, Sicherheit, Aufbau (für Betreiber/Entwickler)
- `BENUTZERHANDBUCH.md` – Bedienung für Vereinsmitglieder und Admins, du-Form, ohne Technikjargon
- `CHANGELOG.md` – aktueller Stand und Änderungsprotokoll
- `CLAUDE.md` – diese Datei
- GitHub-Wiki – lokal in `../auslagenverwaltung.wiki` (Remote `AuslagenVerwaltung.wiki.git`,
  Branch `master`); Inhalte aus README, Benutzerhandbuch und CHANGELOG, nach Themen aufgeteilt

## Testen / Ausführen

- Keine automatisierten Tests, keine Linter-Konfiguration.
- Zum Testen: lokaler Webserver mit PHP 8.1+ und MySQL/MariaDB oder Upload auf einen Webspace mit
  HTTPS (Passkeys brauchen HTTPS oder `localhost`).
- `php -l` auf geänderte PHP-Dateien, `node --check` für JS.

## Sprache

Das Projekt ist deutschsprachig. Schreibt jemand auf Deutsch, auf Deutsch antworten.
