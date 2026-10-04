# Mitwirken an VereinsAuslagen

Schön, dass du helfen möchtest! VereinsAuslagen ist ein kleines Freizeitprojekt für Vereine auf
normalem Shared-Webhosting. Beiträge jeder Art sind willkommen: Fehlermeldungen, Ideen,
Verbesserungen an der Dokumentation und Code.

Diese Anleitung erklärt, wie du am besten vorgehst, damit dein Beitrag schnell aufgenommen
werden kann.

## Inhalt

- [Fragen und Ideen](#fragen-und-ideen)
- [Fehler melden](#fehler-melden)
- [Sicherheitslücken melden](#sicherheitslücken-melden)
- [Code beitragen](#code-beitragen)
- [Entwicklungsumgebung](#entwicklungsumgebung)
- [Konventionen](#konventionen)
- [Checkliste vor dem Pull Request](#checkliste-vor-dem-pull-request)
- [Commits und Pull Requests](#commits-und-pull-requests)
- [Lizenz](#lizenz)

## Fragen und Ideen

- Schau zuerst in die **[offenen Punkte im CHANGELOG](CHANGELOG.md#offene-punkte--ideen)** und in
  die vorhandenen [Issues](https://github.com/listiges-kaenguru/AuslagenVerwaltung/issues) –
  vielleicht ist deine Idee schon erfasst.
- Neue Funktionen bitte **erst als Issue vorschlagen**, bevor du Zeit in Code steckst. So können
  wir klären, ob die Idee zum Projekt passt (Zielgruppe: kleine Vereine, einfacher Betrieb per
  FTP-Upload, keine Abhängigkeiten).
- Für die Bedienung der App gibt es das **[Benutzerhandbuch](BENUTZERHANDBUCH.md)**, für
  Installation und Betrieb die **[README](README.md)**.

## Fehler melden

Ein gutes Fehler-Issue enthält:

- **Was du getan hast** (Schritte zum Nachstellen), **was du erwartet hast** und **was
  stattdessen passiert ist**
- App-Version (steht in `sw.js` → `VERSION`), Browser und Gerät
- Umgebung des Servers: PHP-Version, MySQL/MariaDB-Version, Apache oder nginx, Hoster
- Fehlermeldungen aus der App, der Browser-Konsole oder dem PHP-Fehlerprotokoll

Bitte **keine echten Daten** in Issues stellen: keine Passwörter, IBANs, Belege, Datenbank-
Zugangsdaten oder Inhalte von `api/config/config.php`. Screenshots vorher schwärzen.

## Sicherheitslücken melden

Sicherheitsprobleme bitte **nicht als öffentliches Issue** melden, sondern vertraulich über
GitHub: **Security → [Report a vulnerability](https://github.com/listiges-kaenguru/AuslagenVerwaltung/security/advisories/new)**.

Beschreibe die Lücke, die betroffene Version und wenn möglich einen Weg zum Nachstellen. Wir
melden uns, sobald wir die Meldung geprüft haben, und veröffentlichen eine Korrektur, bevor
Details öffentlich werden.

## Code beitragen

1. Repository **forken** und lokal klonen.
2. Einen eigenen **Branch** vom aktuellen `main` anlegen, z. B. `fehler/beleg-upload` oder
   `funktion/kassenwart-rolle`.
3. Änderungen umsetzen – klein und auf ein Thema beschränkt. Mehrere unabhängige Änderungen
   lieber als getrennte Pull Requests.
4. Lokal testen (siehe unten) und die [Checkliste](#checkliste-vor-dem-pull-request) abarbeiten.
5. **Pull Request** gegen `main` öffnen und das zugehörige Issue verlinken (`Fixes #123`).

## Entwicklungsumgebung

Es gibt **keinen Build-Schritt** und **keine Paketverwaltung** (kein npm, kein Composer).
Du brauchst nur:

- einen Webserver mit **PHP 8.1+** (`pdo_mysql`, `openssl`, `mbstring`)
- **MySQL 5.7+/8.x** oder **MariaDB 10.3+** mit einer leeren Datenbank
- einen aktuellen Browser

Am schnellsten geht es mit dem eingebauten PHP-Server:

```sh
php -S localhost:8000
```

Dann `http://localhost:8000/` öffnen und die Ersteinrichtung durchlaufen. Passkeys funktionieren
nur über HTTPS oder `localhost`. Der eingebaute Server wertet keine `.htaccess` aus – für Tests
des Zugriffsschutzes Apache bzw. nginx verwenden (siehe README).

Nach Frontend-Änderungen zeigt der Service Worker eventuell noch die alte Version. In den
Entwicklerwerkzeugen des Browsers unter „Application → Service Workers“ hilft „Update on reload“.

### Prüfen

Es gibt noch keine automatisierten Tests. Bitte mindestens:

```sh
php -l api/routen/geaenderte-datei.php   # für jede geänderte PHP-Datei
node --check js/geaenderte-datei.js       # für jede geänderte JS-Datei
```

und die betroffenen Abläufe im Browser durchklicken – möglichst in hellem und dunklem
Farbschema und auf einem schmalen (Handy-)Bildschirm.

## Konventionen

Die vollständigen Regeln stehen in **[`CLAUDE.md`](CLAUDE.md)**. Das Wichtigste:

**Sprache**
- Bezeichner, Kommentare, UI-Texte und Fehlermeldungen auf **Deutsch**.
- In Bezeichnern Umlaute ausschreiben (`ladeEigeneAuslage`, `erfordereLogin`), in Texten echte
  Umlaute und typografische Anführungszeichen „…“.

**Aufbau**
- Jede Datei beginnt mit einem `// ====`-Kommentarblock (Zweck, Besonderheiten), Abschnitte
  werden mit `// ----` getrennt. Kommentare kurz halten und das *Warum* erklären.
- Keine neuen Abhängigkeiten. Wird eine Bibliothek wirklich gebraucht, kommt sie fertig nach
  `vendor/` (mit Lizenzangabe in der README) und wird per `ladeSkript()` erst bei Bedarf geladen.

**Frontend**
- Strikte CSP: **keine** Inline-Skripte, Inline-Styles oder `on…`-Attribute. Klicks über
  `data-aktion` + `registriereAktionen()`, Formulare über `data-formular`.
- Nutzerdaten in HTML-Templates immer mit `escapeHtml()` ausgeben.
- Module kommunizieren über DOM-Events (`daten-geaendert`, `angemeldet` …).

**Backend**
- `declare(strict_types=1);`, Datenbankzugriffe nur über `abfrage()` mit Prepared Statements.
- Jede Route prüft zuerst `erfordereLogin()` bzw. `erfordereAdmin()`.
- Auslagen-Zugriffe immer mit `benutzer_id = ?` einschränken – auch Admins sehen keine fremden
  Auslagen.
- Fachliche Fehler als `throw new ApiFehler('Text für Nutzer', status)`.

**Sicherheit** – diese Punkte bitte nicht aufweichen: CSRF-Header und Origin-Prüfung,
Sitzungs-Generationen (`sitzung_gen`), Schutz des letzten aktiven Admins, TOTP-Schlüssel nie in
der Datenbank.

## Checkliste vor dem Pull Request

- [ ] `php -l` / `node --check` ohne Fehler, Änderung im Browser getestet
- [ ] Frontend geändert → `VERSION` in `sw.js` erhöht, neue Dateien in `APP_SHELL` eingetragen
- [ ] Schema geändert → `SCHEMA_VERSION` in `api/lib/db.php` erhöht, Migrationsblock in
      `migriere()`, neue Tabellen in `TABELLEN`
- [ ] Backup-Format berührt → alte Backups lassen sich weiterhin einspielen
- [ ] `CHANGELOG.md` ergänzt
- [ ] Nutzersichtbare Änderung → `BENUTZERHANDBUCH.md` angepasst (Knopf-Beschriftungen exakt
      wie in der App)
- [ ] Installation/Betrieb betroffen → `README.md` angepasst
- [ ] Keine Zugangsdaten, `config.php` oder echten Belege im Commit

## Commits und Pull Requests

- Commit-Nachrichten auf Deutsch, kurz und im Präsens bzw. als Zusammenfassung, gern mit
  Bereich vorweg, z. B. `Einreichen: PDF enthält Ort der Stammdaten` oder
  `CHANGELOG: offene Punkte ergänzt`.
- Ein Commit pro logischer Änderung; bitte keine reinen Formatierungsänderungen mit
  inhaltlichen Änderungen mischen.
- Im Pull Request beschreiben, **was** sich ändert und **warum**, und wie du getestet hast. Bei
  Änderungen an der Oberfläche helfen Screenshots.
- Code, der mit KI-Unterstützung entstanden ist, ist willkommen – das Projekt selbst ist so
  entstanden. Du bist aber dafür verantwortlich, ihn zu verstehen und geprüft zu haben.

## Lizenz

VereinsAuslagen steht unter der **[GNU General Public License v3.0](LICENSE)**. Mit dem
Einreichen eines Beitrags erklärst du dich einverstanden, dass er unter derselben Lizenz
veröffentlicht wird, und bestätigst, dass du die Rechte dazu hast.
