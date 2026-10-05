# Changelog – VereinsAuslagen

## Aktueller Stand

| | |
|---|---|
| App-Version (`sw.js` → `VERSION`) | **v3.2.0** |
| Schema-Version (`api/lib/db.php` → `SCHEMA_VERSION`) | **6** |
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
  erstattet, veranlasst, ablehnen). Zurückgezogene/abgelehnte bleiben unter „Abgebrochen“ erhalten,
  erstattete wandern nach 5 Minuten nach „Abgeschlossen“
- Rückfragen: Kommentarverlauf je Einreichung (Mitglied, Kassenwart, Vorstand), Ungelesen-Hinweise;
  Einreichungen und Verläufe sind einklappbar
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
| `einreichungen.php` | `GET/POST/DELETE einreichungen`, `POST einreichungen/{status,zurueckziehen,uebernahme}`, `GET/PUT einreichungen/pdf` |
| `kommentare.php` | `GET/POST/DELETE kommentare`, `POST kommentare/gelesen`, `GET kommentare/ungelesen` |
| `kasse.php` | `GET kasse/auslagen`, `GET kasse/beleg`, `GET kasse/einreichung/pdf`, `POST kasse/einreichung/status`, `POST kasse/einreichung/ablehnen` (Kassenwart/Vorstand) |
| `admin.php` | `GET/POST/PUT admin/benutzer`, `POST admin/benutzer/{passwort,mfa-zuruecksetzen,loeschen}`, `GET/POST admin/db`, `POST admin/db/test` |

## Datenbank (Schema 6)

`va_meta`, `va_benutzer` (mit `kassenrolle`), `va_wiederherstellung`, `va_passkeys`,
`va_einreichungen` (mit `art`: einreichung/uebernahme, `zustand`: aktiv/abgelehnt/zurueckgezogen, `erstattet_am`, Eckdaten), `va_auslagen` (mit `einreichung_id`, `veranlasst_am`, `veranlasst_von`),
`va_belege` (LONGBLOB), `va_einreichung_pdfs` (LONGBLOB), `va_kommentare`, `va_kommentar_gelesen`, `va_anmeldeversuche`.

## Versionen

Neueste zuerst.

### v3.2.0 – Verlauf und Rückfragen

- **Kommentare je Einreichung** (`va_kommentare`): Einreicher, Kassenwart und Vorstand schreiben in
  einem Verlauf, optional mit Bezug auf eine Auslage („zu: LadenA, 11,50 €“, als Text gespeichert).
  Admins ohne Kassenrolle sehen nichts. Nicht bearbeitbar; eigener Kommentar löschbar, solange
  jünger als 5 Minuten und noch ohne Antwort einer anderen Person
- **Statusprotokoll im Verlauf:** jede Statusänderung einer Einreichung wird mit Person, Rolle und
  Zeit als Eintrag (`art` status/ablehnung/zurueckgezogen) festgehalten – Eingereicht (Anzahl,
  Summe), Erstattung veranlasst, Veranlassung zurückgenommen, Erstattet und Rücknahme, Zurückgezogen,
  Nicht genehmigt. Nicht löschbar; zählt als „neu“ für die anderen Beteiligten (Kasse sieht so auch
  neue Einreichungen). Der Bereich heißt „💬 Verlauf“; Kommentarzähler zählen nur echte Kommentare,
  und nur Kommentare anderer (keine Statuseinträge) beenden die Löschbarkeit eines Kommentars
- **Ungelesen** (`va_kommentar_gelesen`): roter Punkt an „Übersicht“ bzw. „Kasse“, „💬 n neu“ an der
  Einreichung, „neu“ am Kommentar. Gelesen gilt ein Verlauf, sobald er aufgeklappt war
- **Einklappbare Bereiche** (`<details>`, `js/klappen.js`): Einreichungen, Verläufe,
  „Abgeschlossen“ und „Abgebrochen“; Zustand bleibt bis zum Abmelden. Standard: Übersicht nur bei Ungelesenem bzw.
  einzelner nicht erstatteter Einreichung offen; Kasse unter „Zu erledigen“ offen
- **Abgebrochene Einreichungen bleiben erhalten:** Zurückziehen (Mitglied) und Ablehnen (Kasse)
  lösen die Gruppe auf, die Auslagen sind wieder offen; die Einreichung behält aber `zustand`
  (abgelehnt/zurueckgezogen), Anzahl, Summe, PDF und Kommentare und steht im Bereich „Abgebrochen“
- **Abgeschlossen:** 5 Minuten nach „erstattet“ (`ABSCHLUSS_FRIST_S`, Spalte
  `va_einreichungen.erstattet_am`) wandert eine Einreichung in der Übersicht in den eingeklappten
  Bereich „Abgeschlossen“ (Status bleibt *Erstattet*, Kommentieren möglich). „↩ Doch noch nicht
  erstattet“ geht nur innerhalb der Frist, der Server prüft das. Erstattete Einreichungen ohne
  Zeitpunkt (Altbestand) gelten sofort als abgeschlossen. Die Ansicht zeichnet sich nach Ablauf der
  Frist selbst neu; Restzeit kommt als `abschlussInS` vom Server (unabhängig von der Geräteuhr)
- **Nicht genehmigen** verlangt eine Begründung, die im Verlauf erscheint (Formular statt Abfrage)
- Kasse: Filter **💬 Ungelesen** – Einreichungen mit neuen Einträgen (Kommentare, Statusänderungen
  anderer, neu eingegangene Einreichungen). Die Liste bleibt stabil, solange der Filter gewählt ist
  (bis Filterwechsel oder „Aktualisieren“), damit gerade Gelesenes nicht wegspringt
- Verläufe sind standardmäßig zugeklappt; gelesen ist ein Verlauf erst, wenn er bewusst aufgeklappt
  wurde
- Filterleisten (Übersicht, Kasse, Export) brechen in eine zweite Zeile um, statt seitlich zu scrollen
- **Datensicherung in der App standardmäßig aus und ausgeblendet** (Export → „Backup speichern“ /
  „Backup einspielen“), weil alle Daten in der Datenbank liegen. Einschalten nur für Tests bzw. den
  Umstieg von der Einzelplatz-Version: `'datensicherung' => true` in `api/config/config.php`
  (`GET status` liefert `datensicherung`); die 30-Tage-Backup-Erinnerung entfällt (der Hinweistext ist für alle gleich)
- **Aktualisieren in der Kopfzeile** neben dem Farbschema-Knopf, in jeder Ansicht nach der
  Anmeldung: lädt eigene Auslagen, Einreichungen, Verläufe und (mit Kassenrolle) die Kasse neu und
  setzt die Liste „Ungelesen“ neu. Unter 600 px Fensterbreite nur das Symbol
- Bezug eines Kommentars auf eine Auslage zeigt Händler, Betrag und Hinweis (in der Auswahl und im
  gespeicherten Kommentar), damit gleichnamige Händler unterscheidbar sind
- **Breitere Darstellung auf Laptop/Desktop:** Inhaltsbreite wächst mit dem Fenster (600 → 760 px
  ab 800 px Fensterbreite, 960 px ab 1100 px; CSS-Variable `--inhalt-breite`). Formulare bleiben
  höchstens 640 px breit, die Ansicht „Neu“ bleibt schmal
- Detail-Fenster: Rückfragen zur jeweiligen Auslage
- Verwerfen (`DELETE einreichungen`) nur noch als technischer Rückbau direkt nach dem Einreichen
  (PDF nicht gespeichert, Download-Dialog abgebrochen): höchstens 30 Minuten alt, ohne Kommentare.
  Das Zurückziehen hat die eigene Route `POST einreichungen/zurueckziehen`
- Neue Routen: `kommentare.php` (`GET/POST/DELETE kommentare`, `POST kommentare/gelesen`,
  `GET kommentare/ungelesen`), `GET einreichungen`; `GET kasse/auslagen` liefert zusätzlich
  `einreichungen` (Eckdaten inkl. abgebrochener)
- **Schema 5**: `va_kommentare`, `va_kommentar_gelesen`, `va_einreichungen.zustand/beendet_am/anzahl/summe`;
  **Schema 6**: `va_einreichungen.erstattet_am`

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
- [x] Kommentarfunktion für Einreichungen (v3.2.0, Konzept in `docs/konzept-kommentarfunktion.md`)
- [ ] E-Mail-Versand über SMTP (Zugangsdaten im Admin-Bereich, ohne Fremdbibliothek), z. B. um
  den Kassenwart auf neue Einreichungen und Mitglieder auf Rückfragen hinzuweisen
