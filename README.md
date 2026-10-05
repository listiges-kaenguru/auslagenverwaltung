# VereinsAuslagen

Web-App (PWA) für kleine Vereine: Mitglieder erfassen ihre Auslagen mit Belegfoto oder PDF,
reichen sie gesammelt als PDF bei der Kasse ein und sehen jederzeit, was offen, eingereicht oder
erstattet ist. Die Daten liegen zentral in einer MySQL-Datenbank, jede Person hat ein eigenes Konto.
Läuft auf normalem Shared-Webhosting mit PHP und MySQL – ohne Build-Schritt, ohne npm oder Composer.

**Funktionen**

- Auslagen erfassen (Datum, Händler, Betrag, Notiz, Beleg als Foto oder PDF), Status
  offen → eingereicht → Erstattung veranlasst → erstattet
- Export als CSV, PDF oder ZIP, Datensicherung als ZIP
- Installierbar als App (PWA), Hell-/Dunkel-Modus
- Benutzerkonten mit Login/Logout, Passwort ändern, Rollen **Admin** und **Benutzer**
- **Kassenrollen** zusätzlich zur Rolle: **Kassenwart** sieht eingereichte Auslagen aller Mitglieder
  (mit Belegen und IBAN) und setzt „Erstattung veranlasst“; **Vorstand** sieht sie nur lesend.
  Beide können eine Einreichung ablehnen. Eingereichte Auslagen bilden eine feste Gruppe: Status
  nur gemeinsam, einzeln nicht mehr lösch- oder änderbar
- Zwei-Faktor-Anmeldung per **TOTP** (Authenticator-App) inkl. 10 Wiederherstellungscodes
- Anmeldung per **Passkey** (Fingerabdruck, Face-ID, Geräte-PIN) – ersetzt Passwort + TOTP
- **Stammdaten im Profil** (Name, IBAN, Ort) → werden ins Einreichungs-PDF übernommen
- **Auswahl beim Einreichen**: offene Auslagen einzeln an- oder abwählen
- **Admin-Bereich im Profil**: Benutzer anlegen, sperren, Rolle und Kassenrolle ändern, Passwort bzw.
  2FA/Passkeys zurücksetzen, löschen – und die **Datenbank-Verbindung** ändern
- Import von Backups der früheren Einzelplatz-Version (Export → „Backup einspielen“)

Die App ist installierbar (PWA), braucht aber für die Daten eine Verbindung zum Server.

## Entstehung

Die Idee kam mir, weil ich in meinem Verein den Überblick über die geleisteten Auslagen behalten
wollte. Die App ist per **Vibecoding** mit [Claude](https://claude.ai) (Anthropic) entstanden:
Ich habe die Anforderungen beschrieben und die Ergebnisse geprüft, den Code hat im Wesentlichen
Claude geschrieben. Fehlermeldungen und Verbesserungsvorschläge sind willkommen – gern als Issue, siehe
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Voraussetzungen

- Webhosting mit **PHP 8.1 oder neuer** und den Erweiterungen `pdo_mysql`, `openssl`, `mbstring`
  (bei praktisch allen Hostern Standard)
- **MySQL 5.7+ / 8.x** oder **MariaDB 10.3+** – eine leere Datenbank genügt; alle Tabellen
  beginnen mit `va_`, die Datenbank kann also mit anderen Anwendungen geteilt werden
- **HTTPS** mit gültigem Zertifikat (für Passkeys zwingend, für Logins dringend empfohlen)

## Installation

1. Das Repository herunterladen (unter **Releases** als ZIP oder per `git clone`) und den Inhalt
   per FTP/SFTP auf den Webspace laden (z. B. nach `https://verein.example.org/auslagen/`).
   Die Dokumentationsdateien (`*.md`, `LICENSE`) werden auf dem Server nicht gebraucht.
2. Dem Webserver **Schreibrechte für `api/config/`** geben – dort wird die Konfiguration abgelegt.
3. Die Adresse im Browser öffnen. Die **Ersteinrichtung** fragt die Datenbank-Zugangsdaten und das
   erste Admin-Konto ab, legt die Tabellen an und schreibt `api/config/config.php`.
4. Anmelden, im **Profil → Administration** weitere Benutzer anlegen. Jeder Benutzer erhält ein
   Startpasswort und muss es beim ersten Login ändern.

Solange `api/config/config.php` fehlt, kann **jeder**, der die Adresse kennt, die Einrichtung
durchführen. Die Einrichtung daher direkt nach dem Hochladen abschließen.

### Webserver-Schutz

- **Apache**: Die mitgelieferten `.htaccess`-Dateien sperren `api/lib`, `api/routen` und
  `api/config` und erlauben nur `api/index.php`.
- **nginx**: `.htaccess` wird ignoriert – bitte ergänzen:

  ```nginx
  location ~ ^/auslagen/api/(lib|routen|config)/ { deny all; }
  location ~ ^/auslagen/api/\.   { deny all; }
  ```

- `config.php` ist eine PHP-Datei und liefert selbst bei fehlendem Schutz nur leere Ausgabe.
- Die App-Symbole liegen bewusst in `app-icons/` statt `icons/`: Viele Apache-Server leiten
  `/icons/` serverweit auf ihre eigenen Verzeichnis-Symbole um. Ordner daher nicht umbenennen.

### Upload-Grenzen

Belege dürfen bis 15 MB groß sein. Tatsächlich begrenzen `post_max_size` (PHP) und
`max_allowed_packet` (MySQL). `api/.user.ini` bzw. `api/.htaccess` setzen die PHP-Werte auf 24 MB,
falls der Hoster das zulässt. Die wirksame Grenze steht im Admin-Bereich unter
„Datenbank-Verbindung → Max. Beleggröße“.

## Datenbank wechseln (Admin)

Profil → Administration → Datenbank-Verbindung: neue Zugangsdaten eintragen, **Verbindung testen**,
mit dem eigenen Admin-Passwort bestätigen.

- **Leere Ziel-Datenbank**: wahlweise *alle Daten übernehmen* (Benutzer, Auslagen, Belege,
  Passkeys) oder nur das eigene Admin-Konto mitnehmen.
- **Ziel enthält bereits VereinsAuslagen-Daten**: Der Wechsel klappt nur, wenn dort ein aktives
  Admin-Konto mit gleichem Benutzernamen existiert (Schutz vor Aussperren).
- **Gleiche Datenbank**: Es werden nur die Zugangsdaten (z. B. ein neues DB-Passwort) aktualisiert.

Nach einem Wechsel müssen sich alle neu anmelden.

## Sicherheit

- Passwörter mit `password_hash` (bcrypt/argon2), mindestens 10 Zeichen
- TOTP-Geheimnisse AES-256-GCM-verschlüsselt (Schlüssel in `config.php`, **nicht** in der DB).
  Wird `config.php` gelöscht und neu eingerichtet, müssen alle Benutzer TOTP neu einrichten.
- Brute-Force-Schutz: 5 Fehlversuche pro Benutzername bzw. 20 pro IP in 15 Minuten
- Sitzungs-Cookie `HttpOnly`, `SameSite=Strict`, bei HTTPS `Secure`; Ablauf nach 12 h Inaktivität
- Passwortwechsel, Sperren oder MFA-Reset beenden alle anderen Sitzungen des Benutzers
- CSRF-Schutz über eigenen Anfrage-Header und Origin-Prüfung
- Jeder Benutzer sieht ausschließlich seine eigenen Auslagen; Admins verwalten Konten, sehen aber
  keine fremden Auslagen. Einzige Ausnahme: Kassenwart und Vorstand sehen fremde Auslagen ab Status
  „eingereicht“ (offene nie). Inhalte ändern können sie nicht: Der Kassenwart setzt nur
  „Erstattung veranlasst“, Kassenwart und Vorstand können eine Einreichung als Ganzes ablehnen.
  Die IBAN der Mitglieder sieht nur der Kassenwart
- Eingereichte Auslagen sind einzeln nicht mehr änderbar oder löschbar; nach veranlasster Erstattung
  lässt sich auch die Einreichung nicht mehr zurückziehen. Konten mit solchen Auslagen kann der Admin
  nur sperren, nicht löschen
- Der letzte aktive Admin kann nicht gesperrt, herabgestuft oder gelöscht werden

**Datensicherung**: regelmäßig die Datenbank sichern (z. B. `mysqldump` oder Backup-Funktion des
Hosters) – sie enthält auch alle Belege und Einreichungs-PDFs. Zusätzlich kann jeder Benutzer unter
Export → Datensicherung ein ZIP seiner eigenen Daten speichern.

## Umstieg von der Einzelplatz-Version

Frühere Versionen von VereinsAuslagen liefen ohne Server und speicherten alles im Browser.
Daten daraus lassen sich übernehmen:


1. In der bisherigen App: Export → Datensicherung → **Backup speichern** (ZIP).
2. In der Mehrbenutzer-App anmelden: Export → **Backup einspielen** und die ZIP-Datei wählen.

Auslagen, Status, Belege und – falls im Profil noch leer – die Stammdaten werden übernommen.
Bereits vorhandene Auslagen (gleiche ID) werden übersprungen.

## Aufbau

```
index.html, manifest.webmanifest, sw.js   PWA-Hülle (API-Anfragen werden nie gecacht)
css/, fonts/, app-icons/   Gestaltung, Schrift, App-Symbole
vendor/                   Fremdbibliotheken (jszip, pdf-lib, qrcode), siehe „Lizenz“
js/api.js                 fetch-Wrapper (CSRF-Header, Fehler, 401 → Anmeldung)
js/sitzung.js             Serverstatus, angemeldeter Benutzer
js/ansicht-anmeldung.js   Einrichtung, Login, TOTP-Abfrage, Pflicht-Passwortwechsel
js/ansicht-profil.js      Profil, TOTP, Passkeys, Administration
js/webauthn.js            Passkeys im Browser
js/speicher.js            Auslagen/Belege über die API (statt localStorage/IndexedDB)
js/einreichen.js          Auswahldialog + Einreichungs-PDF
js/ansicht-kasse.js       Kasse: Einreichungen aller Mitglieder (Kassenwart/Vorstand)
api/index.php             einziger öffentlicher PHP-Einstieg (Router: api/?r=…)
api/lib/                  HTTP, Konfiguration, DB/Schema, Sitzung, TOTP, WebAuthn
api/routen/               Einrichtung, Anmeldung, Profil, Auslagen/Einreichungen/Belege, Kasse, Admin
api/config/config.php     wird bei der Einrichtung erzeugt (DB-Zugang + Schlüssel)
```

## Neue Version ausliefern

Nach Änderungen an Frontend-Dateien **`VERSION` in `sw.js` erhöhen**, neue Dateien in `APP_SHELL`
eintragen. Schema-Änderungen: `SCHEMA_VERSION` in `api/lib/db.php` erhöhen und in `migriere()`
einen neuen Block ergänzen – die Migration läuft automatisch bei der nächsten Anfrage.

## Anleitung für Mitglieder

Die Bedienung der App (Erfassen, Einreichen, Export, Profil, Zwei-Faktor, Passkeys,
Administration) beschreibt das **[Benutzerhandbuch](BENUTZERHANDBUCH.md)**. Es eignet sich zum
Weitergeben an die Vereinsmitglieder.

## Entwicklung

- **[`CHANGELOG.md`](CHANGELOG.md)** – aktueller Stand, API-Routen, Änderungsprotokoll, offene Punkte
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** – wie du Fehler meldest und Änderungen beiträgst
- **[`CLAUDE.md`](CLAUDE.md)** – Konventionen und Checkliste für Änderungen (auch für Claude Code)
- Es gibt keine automatisierten Tests. Zum Ausprobieren genügt ein lokaler Webserver mit PHP und
  MySQL/MariaDB (Passkeys funktionieren nur über HTTPS oder `localhost`).

## Downloads

Dateien werden über das Fenster „Datei ist fertig“ angeboten. In der aus **Firefox für Android**
installierten App ist bei PDFs nur „PDF öffnen“ verfügbar (dort über ⬇ speichern), weil Firefox
PDFs in installierten Web-Apps nicht per Download-Link speichert.

## Lizenz

Copyright © 2026 listiges-kaenguru

VereinsAuslagen steht unter der **GNU General Public License v3.0** – siehe [`LICENSE`](LICENSE).

Mitgelieferte Fremdkomponenten behalten ihre eigenen Lizenzen:

| Komponente | Lizenz |
|---|---|
| [JSZip](https://github.com/Stuk/jszip) 3.10.1 (`vendor/jszip.min.js`) | MIT oder GPLv3 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) (`vendor/pdf-lib.min.js`) | MIT |
| [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator) von Kazuhiko Arase (`vendor/qrcode.js`) | MIT |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (`fonts/`) | SIL Open Font License 1.1, siehe [`fonts/OFL.txt`](fonts/OFL.txt) |
