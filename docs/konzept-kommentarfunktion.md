# Konzept: Kommentarfunktion (geplant für v3.2.0)

Stand: abgestimmt und in v3.2.0 umgesetzt (Branch `feature/kommentarfunktion`). Abweichung: Eine
Einreichung, deren PDF beim Einreichen nicht gespeichert bzw. deren Download-Dialog abgebrochen wurde,
wird weiterhin spurlos verworfen (sie war nie wirklich abgegeben); das Zurückziehen durch das Mitglied
bewahrt sie wie beschlossen auf.
Ergänzung: Der Verlauf protokolliert zusätzlich jede Statusänderung (siehe CHANGELOG v3.2.0) und
heißt deshalb „💬 Verlauf“. Abschnitte mit **❓** brauchen eine
Entscheidung; dort steht jeweils eine Empfehlung.

## 1. Ziel

Kassenwart oder Vorstand können zu einer Einreichung Rückfragen stellen, der Einreicher antwortet in
der App, statt per E-Mail oder Messenger. Grundlage sind die Einreichungen als feste Gruppen aus
v3.1.1.

Nicht Teil von v3.2.0:

- E-Mail-Benachrichtigung (eigener Punkt in der Roadmap, setzt SMTP voraus)
- Kommentare zu offenen Auslagen (sie sind privat, niemand außer dem Mitglied sieht sie)
- Anhänge an Kommentaren

## 2. Grundentscheidungen

### Ein Gesprächsverlauf je Einreichung

Kommentare hängen an der **Einreichung**, nicht an einzelnen Auslagen. Die Einreichung ist die
Einheit, über die entschieden wird; mehrere Verläufe je Posten würden zerfasern.

Ein Kommentar kann aber **optional auf einen Posten verweisen** („zu: LadenA, 11,50 €“). So bleibt
eine Rückfrage zu einem bestimmten Beleg eindeutig, ohne eigenen Verlauf.

### Wer darf was

| | Lesen | Schreiben |
|---|---|---|
| Einreicher (Mitglied) | eigene Einreichungen | eigene Einreichungen |
| Kassenwart | alle Einreichungen | alle Einreichungen |
| Vorstand | alle Einreichungen | alle Einreichungen (Ausnahme vom „nur lesend“, wie vereinbart) |
| Admin ohne Kassenrolle | – | – |

Schreiben ist in **jedem Status** möglich (eingereicht, veranlasst, erstattet). Auch nach der
Erstattung kann noch eine Rückfrage nötig sein, etwa bei der Kassenprüfung.

### ❓ Was passiert mit den Kommentaren beim Ablehnen?

Heute löst „Nicht genehmigen“ die Einreichung auf und löscht sie samt PDF. Kommentare würden dabei
mit verschwinden, also ausgerechnet die Begründung der Ablehnung.

**Empfehlung:** Abgelehnte und zurückgezogene Einreichungen bleiben als **abgeschlossener Datensatz**
erhalten:

- `va_einreichungen` bekommt einen Zustand: `aktiv` / `abgelehnt` / `zurueckgezogen`.
- Die Auslagen werden wie bisher wieder offen und aus der Gruppe gelöst (`einreichung_id = NULL`).
  Sie können also geändert und neu eingereicht werden.
- Der Datensatz behält **PDF und Kommentare**. Das PDF ist der unveränderliche Stand dessen, was
  eingereicht war, weil die Auslagen selbst danach geändert werden können.
- **Nicht genehmigen** verlangt eine **Begründung**, die als erster bzw. letzter Kommentar gespeichert
  wird. Das Mitglied sieht sie bei der abgelehnten Einreichung.
- Abgeschlossene Einreichungen erscheinen in einem eigenen, standardmäßig **eingeklappten**
  Bereich (siehe Abschnitt 5).

Alternative (wird nicht umgesetzt!): Beim Zurückziehen (durch das Mitglied selbst) weiter löschen und nur Ablehnungen
aufbewahren. Das ist einfacher, aber dann gibt es zwei unterschiedliche Verhaltensweisen.

### ❓ Bearbeiten und Löschen von Kommentaren

**Empfehlung:** Kommentare sind **nicht bearbeitbar**. Der eigene Kommentar ist **5 Minuten lang
löschbar** (gegen Tippfehler bzw. Absenden im falschen Verlauf), danach festgeschrieben. Das passt zur
Nachvollziehbarkeit, die wir bei „Erstattung veranlasst“ eingeführt haben.

Alternative (mit Ergänzung umsetzen!): gar nicht löschbar, oder löschbar bis zur ersten Antwort. Ergänzung: Löschbar innerhalb von 5 Minuten ODER wenn Antwort erhalten. Je nachdem, was zuerst eintritt.

## 3. Ungelesen-Markierung

Ohne E-Mail ist das der einzige Hinweis auf neue Rückfragen, deshalb gut sichtbar:

- je Benutzer und Einreichung wird gespeichert, bis zu welchem Kommentar gelesen wurde
- **Punkt am Navigations-Knopf** (Übersicht bzw. Kasse), wenn irgendwo Ungelesenes ist
- **💬 2 neu** im Kopf der betroffenen Einreichung
- Als gelesen gilt ein Verlauf, sobald er aufgeklappt sichtbar war (nicht schon beim Laden der Liste)
- Aktualisierung wie bisher beim Zurückkehren in die App (`visibilitychange`) und über
  **🔄 Aktualisieren**, kein Dauer-Abfragen des Servers

Eigene Kommentare gelten automatisch als gelesen.

## 4. Datenmodell (Schema 5)

```
va_kommentare
  id              BIGINT UNSIGNED AUTO_INCREMENT PK
  einreichung_id  CHAR(36) ascii  NOT NULL  → va_einreichungen ON DELETE CASCADE
  auslage_id      CHAR(36) ascii  NULL      → va_auslagen ON DELETE SET NULL   (optionaler Bezug)
  auslage_text    VARCHAR(150)    NULL      Kopie „LadenA, 11,50 €“ – bleibt lesbar, auch wenn die
                                            Auslage nach einer Ablehnung geändert/gelöscht wird
  benutzer_id     INT UNSIGNED    NULL      → va_benutzer ON DELETE SET NULL
  autor_name      VARCHAR(201)    NOT NULL  Kopie des Anzeigenamens (bleibt bei gelöschtem Konto)
  autor_rolle     ENUM('mitglied','kassenwart','vorstand') NOT NULL   Rolle zum Zeitpunkt des Schreibens
  art             ENUM('kommentar','ablehnung','zurueckgezogen') NOT NULL DEFAULT 'kommentar'
  text            VARCHAR(2000)   NOT NULL
  erstellt_am     DATETIME(3)     NOT NULL
  KEY (einreichung_id, id)

va_kommentar_gelesen
  benutzer_id     INT UNSIGNED  → va_benutzer ON DELETE CASCADE
  einreichung_id  CHAR(36)      → va_einreichungen ON DELETE CASCADE
  bis_id          BIGINT UNSIGNED   letzter gelesener Kommentar
  PRIMARY KEY (benutzer_id, einreichung_id)

va_einreichungen   (nur bei Empfehlung aus Abschnitt 2)
  + zustand       ENUM('aktiv','abgelehnt','zurueckgezogen') NOT NULL DEFAULT 'aktiv'
  + beendet_am    DATETIME(3) NULL
```

`TABELLEN` für den DB-Wechsel: `va_kommentare` und `va_kommentar_gelesen` nach `va_auslagen`.
Das Backup (ZIP) des Mitglieds enthält Kommentare zunächst **nicht**: Sie gehören nicht allein dem
Mitglied und wären beim Wiedereinspielen ohne Einreichung ohnehin heimatlos.

## 5. Oberfläche – einklappbare Bereiche

Technik: native `<details>`/`<summary>`. Das ist barrierefrei, funktioniert mit Tastatur, braucht
keine Inline-Skripte (CSP-konform) und kein eigenes Klick-Handling. Welche Bereiche offen sind, merkt
sich die Ansicht während der Sitzung (die Ansicht wird oft neu gerendert). Weil das
`toggle`-Ereignis nicht hochblubbert, hören wir es in der Capture-Phase am `document`.

### Übersicht (Mitglied)

```
┌ Gesamt 90,50 € … ───────────────────────────┐
[Alle] [Offen] [Eingereicht] [Veranlasst] [Erstattet]

Offen
  (Karten wie bisher)

Einreichungen
▼ Eingereicht am 05.10.2026 · 3 Auslagen · 37,50 €   ◐ Eingereicht   💬 1 neu
│   LadenA …  LadenB …  LadenC …
│   ▼ 💬 Rückfragen (2)
│   │  Kassenwart · 05.10. 14:02 · zu: LadenB, 12,50 €
│   │  „Ist das Beleg vom Sommerfest?“
│   │  Du · 05.10. 15:10
│   │  „Ja, Getränke.“
│   │  [ Antwort schreiben …                    ] [Bezug: ganze Einreichung ▾] [Senden]
│   [📄 Einreichungs-PDF] [↩ Zurückziehen] [● Als erstattet markieren]
▶ Erstattung veranlasst am … · 2 Auslagen · 30,00 €   ◕ Veranlasst
▶ Eingereicht am 01.09.2026 · 1 Auslage · 14,50 €      ● Erstattet

▶ Abgeschlossen (2)            ← abgelehnte/zurückgezogene Einreichungen, nur lesbar
```

Standard beim ersten Anzeigen:

| Bereich | aufgeklappt, wenn … |
|---|---|
| Einreichung | ungelesene Kommentare, **oder** sie ist die einzige in der aktuellen Liste |
| Einreichung „Erstattet“ | nur bei ungelesenen Kommentaren |
| Rückfragen innerhalb einer Einreichung | ungelesene Kommentare vorhanden; sonst eingeklappt mit Anzahl |
| „Abgeschlossen“ | nie (nur auf Klick) |

Der eingeklappte Kopf zeigt immer alles Wichtige: Datum, Anzahl, Summe, Status, Kommentar-Hinweis.
Die Knöpfe der Gruppe liegen innerhalb des aufgeklappten Bereichs.

Das **Detail-Fenster** einer Auslage zeigt zusätzlich die Kommentare, die sich auf genau diesen
Posten beziehen, mit Hinweis „Gesamter Verlauf bei der Einreichung“.

### Kasse (Kassenwart / Vorstand)

Gleiches Prinzip. Im Filter **Zu erledigen** sind die Einreichungen aufgeklappt, in **Veranlasst /
Erstattet / Alle** eingeklappt (außer bei Ungelesenem). Zusätzlich:

- optionaler Filter **💬 Offene Rückfragen**: Einreichungen, in denen der letzte Kommentar vom Mitglied
  stammt (Antwort wartet auf Kasse) bzw. umgekehrt
- **✖ Nicht genehmigen** öffnet ein Feld für die Begründung (Pflicht), statt nur `confirm()`

### ❓ Gruppierung nach Mitglied in der Kasse

Bei vielen Einreichungen wird auch die Kasse lang. Möglich wäre eine zweite Ebene „▶ Maria Muster
(3 Einreichungen, 120,00 €)“. **Empfehlung:** vorerst nicht. Die Filter plus eingeklappte
Einreichungen reichen für kleine Vereine, eine zweite Ebene kostet einen Klick mehr. Falls doch,
nur im Filter **Alle**.

Anmerkung: Ich folge deiner Empfehlung!

## 6. API (Entwurf)

| Route | Wer | Zweck |
|---|---|---|
| `GET kommentare&einreichung=…` | Einreicher, Kassenrolle | Verlauf einer Einreichung |
| `POST kommentare` `{einreichungId, auslageId?, text}` | Einreicher, Kassenrolle | Kommentar schreiben |
| `DELETE kommentare&id=…` | Autor, max. 5 Min. | eigenen Kommentar löschen |
| `POST kommentare/gelesen` `{einreichungId, bisId}` | alle Beteiligten | Gelesen-Stand setzen |
| `POST kasse/einreichung/ablehnen` `{id, begruendung}` | Kassenrolle | Begründung jetzt Pflicht |

Die Listen-Routen `GET auslagen` und `GET kasse/auslagen` liefern je Einreichung zusätzlich
`kommentare` (Anzahl) und `ungelesen` (Anzahl). Die Verläufe selbst werden erst beim Aufklappen
geladen, damit die Listen schlank bleiben.

Prüfungen: Zugriff wie beim Einreichungs-PDF (Einreicher über `benutzer_id`, sonst
`erfordereKassenrolle()`); Text 1–2000 Zeichen, getrimmt; `auslageId` muss zur Einreichung gehören.
Ausgabe immer über `escapeHtml()`, Zeilenumbrüche erhalten (`white-space: pre-wrap`, kein HTML).

## 7. Umsetzungsschritte (Vorschlag)

1. Schema 5 und Migration, `TABELLEN` ergänzen
2. Bei Empfehlung aus Abschnitt 2: Ablehnen/Zurückziehen behalten den Datensatz (`zustand`),
   Ablehnung mit Begründung
3. Routen `routen/kommentare.php`
4. Einklappbare Einreichungen in Übersicht und Kasse (auch ohne Kommentare schon nützlich)
5. Kommentarverlauf, Formular, Ungelesen-Markierung, Punkt an der Navigation
6. Detail-Fenster: Kommentare zum Posten
7. Tests wie bei v3.1.1 (Podman + Chromium), Doku: Handbuch, CHANGELOG, README, CLAUDE.md, Wiki
8. `VERSION` in `sw.js` → `3.2.0`, Release **v3.2.0**

## 8. Offene Fragen im Überblick

1. Abgelehnte/zurückgezogene Einreichungen mit PDF und Kommentaren aufbewahren (Empfehlung) oder
   wie bisher löschen? --> Aufbewahren
2. Begründung beim **Nicht genehmigen** als Pflicht? --> Ja
3. Kommentare: nicht bearbeitbar, 5 Minuten löschbar? --> 5 Minuten ode Antwort vorhanden.
4. Darf der Einreicher **von sich aus** einen Kommentar beginnen (z. B. „Beleg folgt per Post“) oder
   nur antworten? Empfehlung: ja, darf. --> Ja
5. Zweite Gruppierungsebene nach Mitglied in der Kasse – vorerst nicht? --> vorerst nicht!
6. Sollen Kommentare im **Export** (CSV/PDF) auftauchen? Empfehlung: nein, vorerst nicht. --> vorerst nicht!

## 9. Nachtrag: Wann ist eine Antwort nötig?

### Problem

Der Filter **💬 Antwort nötig** in der Kasse zeigt heute jede Einreichung, deren **letzter Kommentar
vom Mitglied** stammt. Hat die Kasse die Antwort gelesen und ist zufrieden, gibt es keinen Grund,
noch etwas zu schreiben. Die Einreichung bleibt dann für immer in diesem Filter, auch wenn sie
längst veranlasst oder erstattet ist. Dasselbe gilt, wenn ein Mitglied von sich aus einen Hinweis
schreibt („Beleg folgt per Post“).

Der Kern: Aus der Reihenfolge der Kommentare lässt sich nicht ablesen, ob eine Frage **erledigt**
ist. Das muss irgendwo festgehalten werden.

### Betrachtete Lösungen

| | Idee | Bewertung |
|---|---|---|
| A | Wie heute, aber nur Einreichungen mit Status *Eingereicht* | Behebt nur einen Teil: Nach einer Antwort bleibt die Einreichung trotzdem im Filter, bis sie veranlasst wird. |
| B | „Antwort nötig“ = **ungelesene** Kommentare vom Mitglied | Einfach, aber Lesen ist nicht Erledigen: Wer die Antwort kurz liest und später reagieren will, verliert sie aus dem Filter. Außerdem ist „gelesen“ je Person – der Vorstand würde sie weiter sehen, der Kassenwart nicht. |
| C | **Zustand der Rückfrage** je Einreichung, der sich durch Kommentare und Aktionen ändert und von der Kasse ausdrücklich als erledigt markiert werden kann | Bildet den echten Ablauf ab, für beide Seiten sichtbar. Etwas mehr Aufwand. |

**Empfehlung: C.**

### Zustand der Rückfrage

Jede aktive Einreichung hat einen von drei Zuständen:

| Zustand | Bedeutung | Anzeige |
|---|---|---|
| *keine* | nichts offen | – |
| *wartet auf Mitglied* | Kasse hat gefragt, das Mitglied soll antworten | Mitglied: **❓ Rückfrage – bitte antworten** am Kopf der Einreichung, Einreichung standardmäßig aufgeklappt. Kasse: **⏳ wartet auf Mitglied** |
| *wartet auf Kasse* | Mitglied hat geantwortet oder einen Hinweis geschrieben | Kasse: Filter **💬 Antwort nötig**, Kennzeichen **💬 Antwort nötig** am Kopf. Mitglied: **⏳ wartet auf Kasse** |

Übergänge (der Zustand gilt für die Kasse als Team, nicht je Person):

| Ereignis | neuer Zustand |
|---|---|
| Mitglied schreibt einen Kommentar | *wartet auf Kasse* |
| Kassenwart oder Vorstand schreibt einen Kommentar | *wartet auf Mitglied* – außer der Haken **„Keine Antwort nötig“** ist gesetzt (z. B. „Danke, passt so“), dann *keine* |
| Kasse tippt **✓ Erledigt** (sichtbar, solange etwas offen ist) | *keine* |
| Kasse veranlasst die Erstattung oder lehnt ab | *keine* (die Frage ist damit beantwortet) |
| Mitglied zieht zurück, Einreichung wird abgeschlossen | *keine* |
| Statusänderung durch das Mitglied (z. B. Erstattet) | unverändert |

**✓ Erledigt** wird wie die Statusänderungen im Verlauf protokolliert („Rückfrage erledigt – Name,
Zeit“). So bleibt nachvollziehbar, wer eine offene Frage abgeschlossen hat.

Der Filter **💬 Antwort nötig** zeigt nur noch Einreichungen im Zustand *wartet auf Kasse*.
Optional kommt ein zweiter Filter **⏳ Wartet auf Mitglied** hinzu, damit die Kasse sieht, wo sie
selbst auf etwas wartet.

### Oberfläche

```
Kasse, Formular im Verlauf:
  [ Antwort schreiben …                         ]
  [Bezug: ganze Einreichung ▾]  ☐ Keine Antwort nötig   [Senden]

Kasse, Kopf einer Einreichung mit offener Antwort:
  ▾ Maria Muster · Eingereicht am …   37,50 €  ◐ Eingereicht  💬 Antwort nötig
    …
    [✓ Erledigt]  [📄 Einreichungs-PDF]  [💸 Erstattung veranlasst]  [✖ Nicht genehmigen]

Mitglied, Kopf einer Einreichung mit offener Rückfrage:
  ▾ Eingereicht am …  2 Auslagen · 24,00 €   ◐ Eingereicht  ❓ Rückfrage – bitte antworten
```

### Datenmodell

`va_einreichungen.rueckfrage ENUM('keine','wartet_mitglied','wartet_kasse') NOT NULL DEFAULT 'keine'`.
Gesetzt wird das Feld ausschließlich serverseitig in den betroffenen Routen (Kommentar schreiben,
Erledigt, Veranlassen, Ablehnen, Zurückziehen). Schema 5 ist noch nicht veröffentlicht – die Spalte
kann deshalb in denselben Migrationsschritt.

Neue Route: `POST kommentare/erledigt {einreichungId}` (nur Kassenrolle). `POST kommentare` bekommt
das optionale Feld `keineAntwortNoetig`. Die Eckdaten-Listen liefern `rueckfrage` statt
`letzteRolle`.

### Offene Fragen

1. Lösung C (Zustand mit **✓ Erledigt**) übernehmen?
2. Soll der Haken **„Keine Antwort nötig“** standardmäßig **aus** sein (jeder Kassen-Kommentar
   erwartet eine Antwort)? Empfehlung: ja, aus.
3. Zweiter Filter **⏳ Wartet auf Mitglied** in der Kasse? Empfehlung: ja, kostet wenig.
4. Soll **💸 Erstattung veranlasst** bei *wartet auf Mitglied* nur einen Hinweis zeigen („Rückfrage
   noch offen – trotzdem veranlassen?“) oder gesperrt sein? Empfehlung: nur Hinweis.
5. Darf auch das Mitglied eine eigene Frage als erledigt markieren (etwa „Beleg folgt“ hat sich
   erledigt)? Empfehlung: nein, das schließt die Kasse – das Mitglied kann es ja dazuschreiben.

**Entscheidung (überholt):** Lösung C war kurz umgesetzt (mit Schema 6), wurde aber wieder
zurückgebaut – zu viele Filter, Kennzeichen und Bedienschritte für kleine Vereine.

**Umgesetzt stattdessen (schlank, nur über den Gelesen-Stand):**

- Ein Filter **💬 Ungelesen** in der Kasse ersetzt „Antwort nötig“ und „Wartet auf Mitglied“: alle
  aktiven Einreichungen mit ungelesenen Einträgen (Kommentare und Statusänderungen anderer – damit
  auch neu eingegangene Einreichungen). Gelesen gilt als erledigt; „gelesen“ gilt je Person.
- Damit Gelesenes beim Arbeiten nicht aus der Liste springt, bleibt sie stabil, bis der Filter
  gewechselt oder „Aktualisieren“ getippt wird.
- Verläufe sind standardmäßig **zugeklappt**; gelesen ist ein Verlauf erst, wenn er bewusst
  aufgeklappt wurde (sonst wäre unter „Zu erledigen“ alles schon beim Anzeigen gelesen).
- Filterleisten brechen in eine zweite Zeile um, statt seitlich zu scrollen.
- Kein Rückfrage-Zustand, kein „Erledigt“, kein Haken „Keine Antwort nötig“; Schema bleibt 5.
