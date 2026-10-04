# Changelog – VereinsAuslagen

## Aktueller Stand

| | |
|---|---|
| App-Version (`sw.js` → `VERSION`) | **3.0.5** |
| Schema-Version (`api/lib/db.php` → `SCHEMA_VERSION`) | **1** |
| Tests | keine automatisierten Tests |

Der Funktionsumfang ist vollständig umgesetzt (siehe unten). Es gibt keine bekannten offenen Fehler.

## Funktionen

**Auslagen**
- Erfassen mit Datum, Händler, Betrag, Notiz, Beleg (Foto wird verkleinert, oder PDF, max. 15 MB)
- Übersicht mit Status offen / eingereicht / erstattet, Detail-Bottom-Sheet zum Bearbeiten
- Einreichen: offene Auslagen einzeln auswählen → PDF (Übersicht + Stammdaten + Belege)
- Export (CSV/PDF/ZIP), Datensicherung als ZIP, Import von Backups der früheren Einzelplatz-Version
- PWA: installierbar, App-Shell offline, Update-Hinweis; Hell/Dunkel/System-Farbschema

**Mehrbenutzer / Server**
- Ersteinrichtung im Browser (DB-Zugang + erster Admin → `api/config/config.php`)
- Login/Logout, Pflicht-Passwortwechsel beim ersten Login, Passwort ändern
- TOTP-2FA mit 10 Wiederherstellungscodes; Passkeys (WebAuthn) als Alternative
- Stammdaten (Name, IBAN, Ort) im Profil, gehen ins Einreichungs-PDF
- Admin: Benutzer anlegen/sperren/löschen, Rolle ändern, Passwort und MFA zurücksetzen,
  Datenbank-Verbindung wechseln (mit optionaler Datenübernahme)
- Sicherheit: CSRF (Header + Origin), Brute-Force-Sperre, Sitzungs-Generationen, strikte CSP

## API-Routen (`api/?r=…`)

| Datei | Routen |
|---|---|
| `einrichtung.php` | `GET status`, `POST einrichtung` |
| `anmeldung.php` | `POST anmeldung/passwort`, `anmeldung/mfa`, `anmeldung/passkey-optionen`, `anmeldung/passkey`, `abmeldung` |
| `profil.php` | `GET profil`, `PUT profil/stammdaten`, `POST profil/passwort`, `profil/totp/{start,bestaetigen,deaktivieren,neue-codes}`, `POST/DELETE profil/passkey`, `POST profil/passkey-optionen` |
| `auslagen.php` | `GET/POST/PUT/DELETE auslagen`, `POST auslagen/status`, `GET/PUT/DELETE beleg` |
| `admin.php` | `GET/POST/PUT admin/benutzer`, `POST admin/benutzer/{passwort,mfa-zuruecksetzen,loeschen}`, `GET/POST admin/db`, `POST admin/db/test` |

## Datenbank (Schema 1)

`va_meta`, `va_benutzer`, `va_wiederherstellung`, `va_passkeys`, `va_auslagen`, `va_belege`
(LONGBLOB), `va_anmeldeversuche`.

## Versionen

Neueste zuerst.

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
- [ ] Weitere Benutzerrollen (zusätzlich zu Mitglied/Admin):
  - **Kassenwart:** sieht eingereichte Auslagen aller Mitglieder als To-do-Liste und kann markieren,
    dass er die Erstattung veranlasst hat. Auf „erstattet“ setzt weiterhin nur der Einreicher selbst,
    sobald das Geld angekommen ist (neuer Zwischenstatus bzw. Flag „Erstattung veranlasst“).
  - **Vorstand:** sieht eingereichte und erledigte Vorgänge aller Mitglieder nur lesend, keine
    Änderungen an fremden Auslagen.
  - Achtung: Die Regel „Auslagen-Zugriffe immer mit `benutzer_id = ?`“ muss für diese Rollen gezielt
    und nur lesend (bzw. beim Kassenwart nur für das Flag) gelockert werden; Admins sehen weiterhin
    keine fremden Auslagen.
- [ ] Einfache Kommentarfunktion für Auslagen und Einreichungen, damit Kassenwart oder Vorstand
  Rückfragen stellen und der Einreicher antworten kann
- [ ] E-Mail-Versand über SMTP (Zugangsdaten im Admin-Bereich, ohne Fremdbibliothek), z. B. um
  den Kassenwart auf neue Einreichungen hinzuweisen
