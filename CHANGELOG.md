# Changelog – VereinsAuslagen

## Aktueller Stand

| | |
|---|---|
| App-Version (`sw.js` → `VERSION`) | **v3.1.1** |
| Schema-Version (`api/lib/db.php` → `SCHEMA_VERSION`) | **4** |
| Tests | keine automatisierten Tests |

Der Funktionsumfang ist vollständig umgesetzt (siehe unten). Es gibt keine bekannten offenen Fehler.

## Funktionen

**Auslagen**
- Erfassen mit Datum, Händler, Betrag, Notiz, Beleg (Foto wird verkleinert, oder PDF, max. 15 MB)
- Übersicht mit Status offen / eingereicht / Erstattung veranlasst / erstattet; offene Auslagen
  einzeln, eingereichte gebündelt nach Einreichung. Detail-Bottom-Sheet zum Bearbeiten offener Auslagen
- Einreichen: offene Auslagen einzeln auswählen → PDF (Übersicht + Stammdaten + Belege), das mit der
  Einreichung gespeichert wird und für Mitglied, Kassenwart und Vorstand abrufbar bleibt;
  jede Einreichung ist eine feste Gruppe, deren Status sich nur gemeinsam ändert (zurückziehen,
  erstattet, veranlasst, ablehnen)
- Export (CSV/PDF/ZIP), Datensicherung als ZIP, Import von Backups der früheren Einzelplatz-Version
- PWA: installierbar, App-Shell offline, Update-Hinweis, Versionsanzeige im Profil;
  Hell/Dunkel/System-Farbschema

**Mehrbenutzer / Server**
- Ersteinrichtung im Browser (DB-Zugang + erster Admin → `api/config/config.php`)
- Login/Logout, Pflicht-Passwortwechsel beim ersten Login, Passwort ändern
- TOTP-2FA mit 10 Wiederherstellungscodes; Passkeys (WebAuthn) als Alternative
- Stammdaten (Name, IBAN, Ort) im Profil, gehen ins Einreichungs-PDF
- Kassenrollen: **Kassenwart** sieht eingereichte Auslagen aller Mitglieder (Ansicht „Kasse“, mit
  Belegen und IBAN) und setzt „Erstattung veranlasst“; **Vorstand** sieht dasselbe lesend;
  beide können eine Einreichung ablehnen (→ wieder offen beim Mitglied)
- Admin: Benutzer anlegen/sperren/löschen, Rolle und Kassenrolle ändern, Passwort und MFA zurücksetzen,
  Datenbank-Verbindung wechseln (mit optionaler Datenübernahme)
- Sicherheit: CSRF (Header + Origin), Brute-Force-Sperre, Sitzungs-Generationen, strikte CSP

## API-Routen (`api/?r=…`)

| Datei | Routen |
|---|---|
| `einrichtung.php` | `GET status`, `POST einrichtung` |
| `anmeldung.php` | `POST anmeldung/passwort`, `anmeldung/mfa`, `anmeldung/passkey-optionen`, `anmeldung/passkey`, `abmeldung` |
| `profil.php` | `GET profil`, `PUT profil/stammdaten`, `POST profil/passwort`, `profil/totp/{start,bestaetigen,deaktivieren,neue-codes}`, `POST/DELETE profil/passkey`, `POST profil/passkey-optionen` |
| `auslagen.php` | `GET/POST/PUT/DELETE auslagen`, `GET/PUT/DELETE beleg` |
| `einreichungen.php` | `POST/DELETE einreichungen`, `POST einreichungen/status`, `POST einreichungen/uebernahme`, `GET/PUT einreichungen/pdf` |
| `kasse.php` | `GET kasse/auslagen`, `GET kasse/beleg`, `GET kasse/einreichung/pdf`, `POST kasse/einreichung/status`, `POST kasse/einreichung/ablehnen` (Kassenwart/Vorstand) |
| `admin.php` | `GET/POST/PUT admin/benutzer`, `POST admin/benutzer/{passwort,mfa-zuruecksetzen,loeschen}`, `GET/POST admin/db`, `POST admin/db/test` |

## Datenbank (Schema 4)

`va_meta`, `va_benutzer` (mit `kassenrolle`), `va_wiederherstellung`, `va_passkeys`,
`va_einreichungen` (mit `art`: einreichung/uebernahme), `va_auslagen` (mit `einreichung_id`, `veranlasst_am`, `veranlasst_von`),
`va_belege` (LONGBLOB), `va_einreichung_pdfs` (LONGBLOB), `va_anmeldeversuche`.

## Versionen

Neueste zuerst.

### v3.1.1 – Kassenwart, Vorstand und Einreichungen

Ab dieser Version tragen Versionsnummern in Doku, Tags und Releases ein „v“ (`VERSION` in `sw.js`
bleibt reine SemVer). Eine Version 3.1.0 wurde nicht veröffentlicht.

- Neue **Kassenrolle** je Benutzer, unabhängig von Admin/Benutzer: *Keine*, *Kassenwart*, *Vorstand*.
  Vergabe in der Benutzerverwaltung (auch beim Anlegen und für das eigene Konto)
- Neuer Status **„Erstattung veranlasst“** zwischen eingereicht und erstattet. Setzt nur der
  Kassenwart (mit Rücknahme, solange nicht erstattet); „erstattet“ setzt nur das Mitglied selbst
- **Einreichungen sind feste Gruppen** (`va_einreichungen`). Ab dem Einreichen lassen sich Auslagen
  einzeln nicht mehr ändern, löschen oder im Status wechseln; der Status gilt immer für die ganze
  Einreichung, auch bei „Erstattung veranlasst“ und „erstattet“
- **Übersicht:** offene Auslagen einzeln, darunter die Einreichungen als Kästen mit den Knöpfen
  „↩ Einreichung zurückziehen“, „● Als erstattet markieren“, „● Geld erhalten – als erstattet
  markieren“ und „↩ Doch noch nicht erstattet“. Das Detail-Fenster zeigt den Status nur noch an
- **Ansicht Kasse** (`#kasse`, Alt+5, nur mit Kassenrolle): eingereichte Auslagen aller Mitglieder
  je Einreichung, Filter *Zu erledigen / Veranlasst / Erstattet / Alle* (zählen Einreichungen),
  Belege ansehen. Offene Auslagen bleiben privat. Kassenwart: „💸 Erstattung veranlasst“ und
  „↩ Veranlassung zurücknehmen“, IBAN sichtbar. Kassenwart und Vorstand: **„✖ Nicht genehmigen“**
  – alle Auslagen gehen offen an das Mitglied zurück, die Gruppe wird aufgelöst
- **Einreichungs-PDF wird gespeichert** (`va_einreichung_pdfs`): direkt nach dem Anlegen der
  Einreichung hochgeladen (nur einmal) und über „📄 Einreichungs-PDF“ für Mitglied, Kassenwart und
  Vorstand abrufbar. Schlägt das Speichern fehl oder wird der Download-Dialog abgebrochen, wird die
  Einreichung zurückgezogen; Zurückziehen/Ablehnen löscht das PDF mit. Grenze ist `post_max_size`
  (nicht die 15 MB für Belege), `GET status` liefert dafür `maxPdfBytes`
- **Nachvollziehbarkeit:** nach „Erstattung veranlasst“ lässt sich eine Einreichung nicht mehr
  zurückziehen oder ablehnen; Konten mit solchen Auslagen kann der Admin nur sperren, nicht löschen
- **Schema 4** (automatische Migration): `va_benutzer.kassenrolle`, `va_einreichungen` (mit `art`
  einreichung/uebernahme), `va_einreichung_pdfs`, Status-ENUM um `veranlasst` erweitert,
  `va_auslagen.einreichung_id/veranlasst_am/veranlasst_von`. Eingereichte und erstattete Auslagen
  aus früheren Versionen werden je Mitglied und Status zu „Übernommen aus früherem Stand“ gebündelt
- Neue Routen: `routen/einreichungen.php` (`POST/DELETE einreichungen`, `POST einreichungen/status`,
  `POST einreichungen/uebernahme`, `GET/PUT einreichungen/pdf`) und `routen/kasse.php`
  (`GET kasse/auslagen`, `GET kasse/beleg`, `GET kasse/einreichung/pdf`,
  `POST kasse/einreichung/status`, `POST kasse/einreichung/ablehnen`); entfallen ist
  `POST auslagen/status`, `PUT auslagen` ändert keinen Status mehr
- Backup-Import: Auslagen mit „Erstattung veranlasst“ werden als „eingereicht“ übernommen (die
  Meldung nach dem Einspielen nennt ihre Anzahl); importierte Auslagen werden nach ihrer
  ursprünglichen Einreichung gebündelt, sonst je Status
- Export-PDF: Status-Spalte bricht um, damit „Erstattung veranlasst“ passt
- DB-Wechsel kopiert Belege und Einreichungs-PDFs zeilenweise (`BLOB_TABELLEN`)

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
- [x] Weitere Benutzerrollen Kassenwart und Vorstand (v3.1.1)
- [ ] Einfache Kommentarfunktion für Auslagen und Einreichungen, damit Kassenwart oder Vorstand
  Rückfragen stellen und der Einreicher antworten kann (Branch `feature/kommentarfunktion`;
  Einreichungen gibt es seit v3.1.1 als Datensatz, Vorstand darf dann auch kommentieren)
- [ ] E-Mail-Versand über SMTP (Zugangsdaten im Admin-Bereich, ohne Fremdbibliothek), z. B. um
  den Kassenwart auf neue Einreichungen hinzuweisen
