# Changelog – VereinsAuslagen

## Aktueller Stand

| | |
|---|---|
| App-Version (`sw.js` → `VERSION`) | **3.1.0** |
| Schema-Version (`api/lib/db.php` → `SCHEMA_VERSION`) | **2** |
| Tests | keine automatisierten Tests |

Der Funktionsumfang ist vollständig umgesetzt (siehe unten). Es gibt keine bekannten offenen Fehler.

## Funktionen

**Auslagen**
- Erfassen mit Datum, Händler, Betrag, Notiz, Beleg (Foto wird verkleinert, oder PDF, max. 15 MB)
- Übersicht mit Status offen / eingereicht / Erstattung veranlasst / erstattet, Detail-Bottom-Sheet
  zum Bearbeiten; ab „Erstattung veranlasst“ gesperrt (nicht lösch- oder änderbar)
- Einreichen: offene Auslagen einzeln auswählen → PDF (Übersicht + Stammdaten + Belege);
  jede Einreichung wird als Datensatz gespeichert
- Export (CSV/PDF/ZIP), Datensicherung als ZIP, Import von Backups der früheren Einzelplatz-Version
- PWA: installierbar, App-Shell offline, Update-Hinweis, Versionsanzeige im Profil;
  Hell/Dunkel/System-Farbschema

**Mehrbenutzer / Server**
- Ersteinrichtung im Browser (DB-Zugang + erster Admin → `api/config/config.php`)
- Login/Logout, Pflicht-Passwortwechsel beim ersten Login, Passwort ändern
- TOTP-2FA mit 10 Wiederherstellungscodes; Passkeys (WebAuthn) als Alternative
- Stammdaten (Name, IBAN, Ort) im Profil, gehen ins Einreichungs-PDF
- Kassenrollen: **Kassenwart** sieht eingereichte Auslagen aller Mitglieder (Ansicht „Kasse“, mit
  Belegen und IBAN) und setzt „Erstattung veranlasst“; **Vorstand** sieht dasselbe nur lesend
- Admin: Benutzer anlegen/sperren/löschen, Rolle und Kassenrolle ändern, Passwort und MFA zurücksetzen,
  Datenbank-Verbindung wechseln (mit optionaler Datenübernahme)
- Sicherheit: CSRF (Header + Origin), Brute-Force-Sperre, Sitzungs-Generationen, strikte CSP

## API-Routen (`api/?r=…`)

| Datei | Routen |
|---|---|
| `einrichtung.php` | `GET status`, `POST einrichtung` |
| `anmeldung.php` | `POST anmeldung/passwort`, `anmeldung/mfa`, `anmeldung/passkey-optionen`, `anmeldung/passkey`, `abmeldung` |
| `profil.php` | `GET profil`, `PUT profil/stammdaten`, `POST profil/passwort`, `profil/totp/{start,bestaetigen,deaktivieren,neue-codes}`, `POST/DELETE profil/passkey`, `POST profil/passkey-optionen` |
| `auslagen.php` | `GET/POST/PUT/DELETE auslagen`, `POST auslagen/status`, `POST/DELETE einreichungen`, `GET/PUT/DELETE beleg` |
| `kasse.php` | `GET kasse/auslagen`, `GET kasse/beleg`, `POST kasse/status` (Kassenwart/Vorstand) |
| `admin.php` | `GET/POST/PUT admin/benutzer`, `POST admin/benutzer/{passwort,mfa-zuruecksetzen,loeschen}`, `GET/POST admin/db`, `POST admin/db/test` |

## Datenbank (Schema 2)

`va_meta`, `va_benutzer` (mit `kassenrolle`), `va_wiederherstellung`, `va_passkeys`,
`va_einreichungen`, `va_auslagen` (mit `einreichung_id`, `veranlasst_am`, `veranlasst_von`),
`va_belege` (LONGBLOB), `va_anmeldeversuche`.

## Versionen

Neueste zuerst.

### 3.1.0 – Kassenwart und Vorstand

- Neue **Kassenrolle** je Benutzer, unabhängig von Admin/Benutzer: *Keine*, *Kassenwart*, *Vorstand*.
  Vergabe in der Benutzerverwaltung (auch beim Anlegen und für das eigene Konto)
- Neue Ansicht **Kasse** (`#kasse`, Alt+5, nur mit Kassenrolle): eingereichte Auslagen aller
  Mitglieder, gebündelt nach Einreichung, Filter *Zu erledigen / Veranlasst / Erstattet / Alle*,
  Belege ansehen. Offene Auslagen bleiben privat
- Neuer Status **„Erstattung veranlasst“** zwischen eingereicht und erstattet. Setzt nur der
  Kassenwart (je Einreichung, mit Rücknahme solange nicht erstattet); „erstattet“ setzt weiterhin
  nur das Mitglied selbst. Der Vorstand ist rein lesend; die IBAN sieht nur der Kassenwart
- **Sperre ab „Erstattung veranlasst“**: Auslage nicht mehr löschbar, Angaben und Beleg nicht mehr
  änderbar, Status nur noch veranlasst ↔ erstattet. Konten mit solchen Auslagen lassen sich nur
  sperren, nicht löschen. Das Detail-Fenster zeigt, wann und von wem veranlasst wurde
- **Einreichungen als Datensatz** (`va_einreichungen`): „Einreichen“ legt eine Einreichung an
  (`POST einreichungen`), „Abbrechen“ zieht sie zurück (`DELETE einreichungen`). Grundlage für die
  geplante Kommentarfunktion
- Schema 2 (automatische Migration): `va_benutzer.kassenrolle`, `va_einreichungen`, Status-ENUM um
  `veranlasst` erweitert, `va_auslagen.einreichung_id/veranlasst_am/veranlasst_von`
- Backup-Import: Auslagen mit Status „Erstattung veranlasst“ werden als „eingereicht“ übernommen;
  die Meldung nach dem Einspielen nennt ihre Anzahl, Hinweis im Benutzerhandbuch

### 3.0.6

- Profil: neuer Bereich „App-Version“ ganz unten zeigt die laufende Version; liegt ein Update
  bereit, zusätzlich „Aktualisierung verfügbar“ mit neuer Versionsnummer und Knopf
  „🔄 Jetzt aktualisieren“
- Service Worker beantwortet die Nachricht `{ typ: 'VERSION' }` über einen MessageChannel;
  `pwa.js` meldet Änderungen per Event `version-geaendert`. Für Worker vor 3.0.6 wird die
  laufende Version aus dem Cache-Namen abgeleitet, ohne Service Worker aus `sw.js`

### 3.0.5

- Routing: Hash in der URL wird nur noch gegen eigene Ansichten geprüft (`Object.hasOwn`);
  Links wie `#__proto__` oder `#constructor` führten sonst zu einem Fehler bzw. leerer Ansicht
  (CodeQL-Hinweis „Unvalidated dynamic method call“)
- `CONTRIBUTING.md`: Anleitung für Fehlermeldungen, Sicherheitsmeldungen und Pull Requests

### 3.0.4 – erste öffentliche Version

- Mehrbenutzer-Version mit PHP-Backend und MySQL/MariaDB (Funktionsumfang siehe oben)
- Benutzerhandbuch für Mitglieder und Admins (`BENUTZERHANDBUCH.md`)

## Offene Punkte / Ideen

- [ ] Automatisierte Tests zumindest für die API-Routen
- [ ] Ende-zu-Ende-Test auf echtem Webhosting (Apache mit `.htaccess`, nginx-Regeln aus der README)
- [x] Weitere Benutzerrollen Kassenwart und Vorstand (3.1.0)
- [ ] Einfache Kommentarfunktion für Auslagen und Einreichungen, damit Kassenwart oder Vorstand
  Rückfragen stellen und der Einreicher antworten kann (Branch `feature/kommentarfunktion`;
  Einreichungen gibt es seit 3.1.0 als Datensatz, Vorstand darf dann auch kommentieren)
- [ ] E-Mail-Versand über SMTP (Zugangsdaten im Admin-Bereich, ohne Fremdbibliothek), z. B. um
  den Kassenwart auf neue Einreichungen hinzuweisen
