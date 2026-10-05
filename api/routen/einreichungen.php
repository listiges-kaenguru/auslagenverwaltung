<?php
// =============================================
// EINREICHUNGEN – feste Gruppen von Auslagen (eigene Daten des Mitglieds)
// - Einreichen bündelt offene Auslagen zu einer Gruppe (Status „eingereicht“)
// - Ab dann wechselt der Status nur noch für die ganze Gruppe:
//   Mitglied: zurückziehen, „erstattet“ setzen und wieder zurücknehmen
//   Kassenwart/Vorstand: siehe kasse.php (veranlassen, ablehnen)
// - Alle Auslagen einer aktiven Gruppe haben stets denselben Status.
// - Zurückziehen und Ablehnen schließen die Einreichung ab (zustand abgelehnt/zurueckgezogen): die
//   Auslagen werden wieder offen und frei, der Datensatz bleibt mit PDF, Kommentaren und Eckdaten
//   (Anzahl, Summe) erhalten. Ganz gelöscht („verworfen“) wird nur eine Einreichung, deren PDF beim
//   Einreichen nicht gespeichert bzw. deren Download-Dialog abgebrochen wurde.
// - Das beim Einreichen erzeugte PDF wird einmalig zur Einreichung gespeichert (va_einreichung_pdfs)
//   und ist danach für Mitglied, Kassenwart und Vorstand abrufbar.
// =============================================
declare(strict_types=1);

/** Aktive Einreichung mit Status ihrer Auslagen; $benutzerId = null → beliebiger Besitzer (Kasse) */
function ladeEinreichung(string $id, ?int $benutzerId): array
{
    $e = abfrage("SELECT e.*, COUNT(a.id) AS posten, MIN(a.status) AS status, COUNT(DISTINCT a.status) AS status_anzahl,
            MAX(a.veranlasst_am) AS veranlasst_am
        FROM va_einreichungen e LEFT JOIN va_auslagen a ON a.einreichung_id = e.id
        WHERE e.id = ? AND e.zustand = 'aktiv'" . ($benutzerId === null ? '' : ' AND e.benutzer_id = ?') . ' GROUP BY e.id',
        $benutzerId === null ? [$id] : [$id, $benutzerId])->fetch();
    if (!$e || !(int)$e['posten']) throw new ApiFehler('Einreichung nicht gefunden. Bitte neu laden.', 404);
    if ((int)$e['status_anzahl'] !== 1) throw new ApiFehler('Die Einreichung hat uneinheitliche Status. Bitte neu laden.', 409);
    return $e;
}

/** Erwarteten Status prüfen – sonst hat jemand anderes die Gruppe inzwischen geändert */
function pruefeEinreichungsStatus(array $e, array $erlaubt): void
{
    if (!in_array($e['status'], $erlaubt, true)) {
        throw new ApiFehler('Die Einreichung wurde inzwischen geändert. Bitte neu laden.', 409);
    }
}

/**
 * Einreichung (beliebiger Zustand) für Lesen/Kommentieren: Besitzer oder Kassenrolle, sonst 404.
 * Einreichungen enthalten nie offene Auslagen → für Kassenwart und Vorstand immer sichtbar.
 */
function ladeEinreichungMitZugriff(string $id, array $benutzer): array
{
    $e = abfrage('SELECT * FROM va_einreichungen WHERE id = ?', [$id])->fetch();
    $kasse = in_array($benutzer['kassenrolle'], ['kassenwart', 'vorstand'], true);
    if (!$e || ((int)$e['benutzer_id'] !== (int)$benutzer['id'] && !$kasse)) {
        throw new ApiFehler('Einreichung nicht gefunden. Bitte neu laden.', 404);
    }
    return $e;
}

/**
 * Einreichung abschließen (abgelehnt/zurückgezogen): Auslagen wieder offen und frei, Datensatz mit
 * Eckdaten, PDF und Kommentaren bleibt. $kommentar = Begründung bzw. Vermerk für den Verlauf.
 */
function schliesseEinreichung(array $e, string $zustand, array $autor, string $kommentar): void
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        abfrage("UPDATE va_einreichungen e SET zustand = ?, beendet_am = UTC_TIMESTAMP(3),
                anzahl = (SELECT COUNT(*) FROM va_auslagen a WHERE a.einreichung_id = e.id),
                summe = (SELECT COALESCE(SUM(a.betrag), 0) FROM va_auslagen a WHERE a.einreichung_id = e.id)
            WHERE e.id = ? AND e.zustand = 'aktiv'", [$zustand, $e['id']]);
        fuegeKommentarEin($e, $autor, $kommentar, $zustand === 'abgelehnt' ? 'ablehnung' : 'zurueckgezogen');
        abfrage("UPDATE va_auslagen SET status = 'offen', einreichung_id = NULL, veranlasst_am = NULL, veranlasst_von = NULL,
            geaendert_am = UTC_TIMESTAMP(3) WHERE einreichung_id = ?", [$e['id']]);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
}

/**
 * Einreichungen samt Eckdaten für Listen: Anzahl Kommentare und ungelesene Einträge (für $leser).
 * $benutzerId = null → alle (Kasse).
 */
function einreichungsListe(?int $benutzerId, int $leserId): array
{
    $zeilen = abfrage("SELECT e.*,
            COALESCE(NULLIF(TRIM(CONCAT(m.vorname, ' ', m.nachname)), ''), m.benutzername) AS mitglied_name,
            EXISTS(SELECT 1 FROM va_einreichung_pdfs p WHERE p.einreichung_id = e.id) AS hat_pdf,
            (SELECT COUNT(*) FROM va_kommentare k WHERE k.einreichung_id = e.id AND k.art = 'kommentar') AS kommentare,
            (SELECT COUNT(*) FROM va_kommentare k WHERE k.einreichung_id = e.id
                AND (k.benutzer_id IS NULL OR k.benutzer_id <> ?)
                AND k.id > COALESCE((SELECT g.bis_id FROM va_kommentar_gelesen g
                    WHERE g.benutzer_id = ? AND g.einreichung_id = e.id), 0)) AS ungelesen
        FROM va_einreichungen e JOIN va_benutzer m ON m.id = e.benutzer_id"
        . ($benutzerId === null ? '' : ' WHERE e.benutzer_id = ?') . ' ORDER BY e.erstellt_am DESC',
        $benutzerId === null ? [$leserId, $leserId] : [$leserId, $leserId, $benutzerId])->fetchAll();
    return array_map(fn($e) => [
        'id'          => $e['id'],
        'mitglied'    => ['id' => (int)$e['benutzer_id'], 'name' => $e['mitglied_name']],
        'uebernommen' => $e['art'] === 'uebernahme',
        'zustand'     => $e['zustand'],
        'erstelltAm'  => isoZeit($e['erstellt_am']),
        'beendetAm'   => isoZeit($e['beendet_am']),
        'anzahl'      => $e['anzahl'] === null ? null : (int)$e['anzahl'],   // nur bei abgeschlossenen
        'summe'       => $e['summe'] === null ? null : round((float)$e['summe'], 2),
        'hatPdf'      => (bool)$e['hat_pdf'],
        'kommentare'  => (int)$e['kommentare'],
        'ungelesen'   => (int)$e['ungelesen'],
    ], $zeilen);
}

function setzeEinreichungsStatus(string $id, string $status): void
{
    abfrage('UPDATE va_auslagen SET status = ?, geaendert_am = UTC_TIMESTAMP(3) WHERE einreichung_id = ?', [$status, $id]);
}

route('POST', 'einreichungen', function (): void {
    $b = erfordereLogin();
    $ids = idListe(eingabe()['ids'] ?? null);
    foreach (ladeEigeneAuslagen($ids, (int)$b['id']) as $a) {
        if ($a['status'] !== 'offen') throw new ApiFehler("„{$a['haendler']}“ ist nicht mehr offen. Bitte neu laden.", 409);
    }
    $einreichungId = neueUuid();
    $pdo = db();
    $pdo->beginTransaction();
    try {
        abfrage('INSERT INTO va_einreichungen (id, benutzer_id, erstellt_am) VALUES (?, ?, UTC_TIMESTAMP(3))',
            [$einreichungId, $b['id']]);
        $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
        abfrage("UPDATE va_auslagen SET status = 'eingereicht', einreichung_id = ?, geaendert_am = UTC_TIMESTAMP(3)
            WHERE benutzer_id = ? AND id IN ({$platzhalter})", [$einreichungId, $b['id'], ...$ids]);
        $summe = array_sum(array_column(ladeEigeneAuslagen($ids, (int)$b['id']), 'betrag'));
        protokolliereStatus(['id' => $einreichungId, 'benutzer_id' => $b['id']], $b, 'Eingereicht: '
            . count($ids) . (count($ids) === 1 ? ' Auslage, ' : ' Auslagen, ') . number_format($summe, 2, ',', '.') . ' €');
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    antworte([
        'einreichung' => ['id' => $einreichungId],
        'auslagen'    => array_map('auslageFuerClient', ladeEigeneAuslagen($ids, (int)$b['id'])),
    ]);
});

route('GET', 'einreichungen', function (): void {
    $b = erfordereLogin();
    antworte(['einreichungen' => einreichungsListe((int)$b['id'], (int)$b['id'])]);
});

/**
 * Verwerfen: technischer Rückbau direkt nach dem Einreichen (PDF nicht gespeichert, Download-Dialog
 * abgebrochen). Nur ohne Kommentare und nur kurz nach dem Anlegen – sonst gilt „zurückziehen“.
 */
route('DELETE', 'einreichungen', function (): void {
    $b = erfordereLogin();
    $e = ladeEinreichung((string)($_GET['id'] ?? ''), (int)$b['id']);
    pruefeEinreichungsStatus($e, ['eingereicht']);
    $frisch = (bool)abfrage('SELECT erstellt_am > UTC_TIMESTAMP(3) - INTERVAL 30 MINUTE FROM va_einreichungen WHERE id = ?',
        [$e['id']])->fetchColumn();
    $kommentiert = (bool)abfrage("SELECT 1 FROM va_kommentare WHERE einreichung_id = ? AND art = 'kommentar' LIMIT 1",
        [$e['id']])->fetchColumn();
    if ($e['veranlasst_am'] !== null || !$frisch || $kommentiert) {
        throw new ApiFehler('Diese Einreichung lässt sich nur noch zurückziehen.', 409);
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        abfrage("UPDATE va_auslagen SET status = 'offen', einreichung_id = NULL, geaendert_am = UTC_TIMESTAMP(3)
            WHERE einreichung_id = ?", [$e['id']]);
        abfrage('DELETE FROM va_einreichungen WHERE id = ?', [$e['id']]); // PDF per CASCADE
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    antworte();
});

/** Zurückziehen durch das Mitglied – nur solange „eingereicht“; die Einreichung bleibt als abgeschlossen erhalten */
route('POST', 'einreichungen/zurueckziehen', function (): void {
    $b = erfordereLogin();
    $e = ladeEinreichung((string)(eingabe()['id'] ?? ''), (int)$b['id']);
    if ($e['veranlasst_am'] !== null) throw new ApiFehler('Für diese Einreichung wurde bereits eine Erstattung veranlasst.', 409);
    pruefeEinreichungsStatus($e, ['eingereicht']);
    schliesseEinreichung($e, 'zurueckgezogen', $b, 'Einreichung zurückgezogen.');
    antworte();
});

/**
 * Mitglied ändert den Status der ganzen Gruppe:
 * „erstattet“ (aus eingereicht oder veranlasst) bzw. zurück auf den vorigen Stand
 * („veranlasst“, wenn der Kassenwart veranlasst hatte, sonst „eingereicht“).
 * Zurück geht nur innerhalb von ABSCHLUSS_FRIST_S nach „erstattet“ – danach ist die Einreichung
 * abgeschlossen (Altbestand ohne erstattet_am gilt sofort als abgeschlossen).
 */
route('POST', 'einreichungen/status', function (): void {
    $b = erfordereLogin();
    $eingabe = eingabe();
    $e = ladeEinreichung((string)($eingabe['id'] ?? ''), (int)$b['id']);
    $status = (string)($eingabe['status'] ?? '');
    $veranlasst = $e['veranlasst_am'] !== null;
    if ($status !== 'erstattet' && $e['status'] === 'erstattet') {
        $offen = $e['erstattet_am'] !== null && (bool)abfrage('SELECT erstattet_am > UTC_TIMESTAMP(3) - INTERVAL '
            . ABSCHLUSS_FRIST_S . ' SECOND FROM va_einreichungen WHERE id = ?', [$e['id']])->fetchColumn();
        if (!$offen) throw new ApiFehler('Die Einreichung ist abgeschlossen – „erstattet“ lässt sich nicht mehr zurücknehmen.', 409);
    }
    match ($status) {
        'erstattet'   => pruefeEinreichungsStatus($e, ['eingereicht', 'veranlasst']),
        'veranlasst'  => $veranlasst ? pruefeEinreichungsStatus($e, ['erstattet'])
                                     : throw new ApiFehler('„Erstattung veranlasst“ setzt der Kassenwart.', 403),
        'eingereicht' => $veranlasst ? throw new ApiFehler('Die Erstattung wurde bereits veranlasst.', 409)
                                     : pruefeEinreichungsStatus($e, ['erstattet']),
        default       => throw new ApiFehler('Ungültiger Status.'),
    };
    setzeEinreichungsStatus($e['id'], $status);
    abfrage('UPDATE va_einreichungen SET erstattet_am = ' . ($status === 'erstattet' ? 'UTC_TIMESTAMP(3)' : 'NULL')
        . ' WHERE id = ?', [$e['id']]);
    protokolliereStatus($e, $b, match ($status) {
        'erstattet'   => 'Status: Erstattet – Geld erhalten',
        'veranlasst'  => 'Status zurück auf „Erstattung veranlasst“ (doch noch nicht erstattet)',
        'eingereicht' => 'Status zurück auf „Eingereicht“ (doch noch nicht erstattet)',
    });
    antworte();
});

/** Nach einem Backup-Import: importierte, nicht offene Auslagen wieder zu einer Gruppe bündeln */
route('POST', 'einreichungen/uebernahme', function (): void {
    $b = erfordereLogin();
    $auslagen = ladeEigeneAuslagen(idListe(eingabe()['ids'] ?? null), (int)$b['id']);
    $status = array_unique(array_column($auslagen, 'status'));
    if (count($status) !== 1 || $status[0] === 'offen') throw new ApiFehler('Nur Auslagen mit gleichem Status lassen sich bündeln.');
    foreach ($auslagen as $a) {
        if ($a['einreichung_id'] !== null) throw new ApiFehler("„{$a['haendler']}“ gehört bereits zu einer Einreichung.", 409);
    }
    $id = neueUuid();
    abfrage("INSERT INTO va_einreichungen (id, benutzer_id, art, erstellt_am) VALUES (?, ?, 'uebernahme', UTC_TIMESTAMP(3))",
        [$id, $b['id']]);
    $ids = array_column($auslagen, 'id');
    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    abfrage("UPDATE va_auslagen SET einreichung_id = ? WHERE benutzer_id = ? AND id IN ({$platzhalter})",
        [$id, $b['id'], ...$ids]);
    antworte(['einreichung' => ['id' => $id]]);
});

// ---------------------------------------------
// Einreichungs-PDF
// ---------------------------------------------
/** PDF ausliefern (Berechtigung prüft der Aufrufer) */
function sendeEinreichungsPdf(string $einreichungId): never
{
    $pdf = abfrage('SELECT daten FROM va_einreichung_pdfs WHERE einreichung_id = ?', [$einreichungId])->fetchColumn();
    if ($pdf === false) throw new ApiFehler('Zu dieser Einreichung ist kein PDF gespeichert.', 404);
    header('Content-Type: application/pdf');
    header('Content-Length: ' . strlen($pdf));
    header('Content-Disposition: attachment; filename="einreichung.pdf"');
    echo $pdf;
    exit;
}

/** Direkt nach dem Einreichen: PDF speichern. Nur einmal – das gespeicherte PDF bleibt unverändert. */
route('PUT', 'einreichungen/pdf', function (): void {
    $b = erfordereLogin();
    $e = ladeEinreichung((string)($_GET['id'] ?? ''), (int)$b['id']);
    if ($e['art'] !== 'einreichung') throw new ApiFehler('Zu übernommenen Auslagen gibt es kein Einreichungs-PDF.');
    $vorhanden = abfrage('SELECT 1 FROM va_einreichung_pdfs WHERE einreichung_id = ?', [$e['id']])->fetchColumn();
    if ($vorhanden) throw new ApiFehler('Zu dieser Einreichung ist bereits ein PDF gespeichert.', 409);

    $typ = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    $daten = file_get_contents('php://input') ?: '';
    if ($typ !== 'application/pdf' || !str_starts_with($daten, '%PDF')) throw new ApiFehler('Die Datei ist kein gültiges PDF.');
    if (strlen($daten) > maxPdfBytes()) throw new ApiFehler('Das PDF ist zu groß für den Server.', 413);

    $stmt = db()->prepare('INSERT INTO va_einreichung_pdfs (einreichung_id, groesse, daten, erstellt_am) VALUES (?, ?, ?, UTC_TIMESTAMP(3))');
    $stmt->bindValue(1, $e['id']);
    $stmt->bindValue(2, strlen($daten), PDO::PARAM_INT);
    $stmt->bindValue(3, $daten, PDO::PARAM_LOB);
    try {
        $stmt->execute();
    } catch (PDOException $ex) {
        if ((int)($ex->errorInfo[1] ?? 0) === 1153 || str_contains($ex->getMessage(), 'max_allowed_packet')) {
            throw new ApiFehler('Das PDF ist größer, als die Datenbank erlaubt (max_allowed_packet).', 413);
        }
        throw $ex;
    }
    antworte();
});

/** Auch für abgeschlossene Einreichungen – das PDF ist der Stand dessen, was eingereicht war */
route('GET', 'einreichungen/pdf', function (): void {
    $b = erfordereLogin();
    sendeEinreichungsPdf(ladeEinreichungMitZugriff((string)($_GET['id'] ?? ''), $b)['id']);
});
