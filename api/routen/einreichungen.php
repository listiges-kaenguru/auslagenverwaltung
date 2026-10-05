<?php
// =============================================
// EINREICHUNGEN – feste Gruppen von Auslagen (eigene Daten des Mitglieds)
// - Einreichen bündelt offene Auslagen zu einer Gruppe (Status „eingereicht“)
// - Ab dann wechselt der Status nur noch für die ganze Gruppe:
//   Mitglied: zurückziehen (→ offen, Gruppe aufgelöst), „erstattet“ setzen und wieder zurücknehmen
//   Kassenwart/Vorstand: siehe kasse.php (veranlassen, ablehnen)
// - Alle Auslagen einer Gruppe haben stets denselben Status.
// - Das beim Einreichen erzeugte PDF wird einmalig zur Einreichung gespeichert (va_einreichung_pdfs)
//   und ist danach für Mitglied, Kassenwart und Vorstand abrufbar.
// =============================================
declare(strict_types=1);

/** Eigene Einreichung mit Status ihrer Auslagen; $benutzerId = null → beliebiger Besitzer (Kasse) */
function ladeEinreichung(string $id, ?int $benutzerId): array
{
    $e = abfrage('SELECT e.*, COUNT(a.id) AS anzahl, MIN(a.status) AS status, COUNT(DISTINCT a.status) AS status_anzahl,
            MAX(a.veranlasst_am) AS veranlasst_am
        FROM va_einreichungen e LEFT JOIN va_auslagen a ON a.einreichung_id = e.id
        WHERE e.id = ?' . ($benutzerId === null ? '' : ' AND e.benutzer_id = ?') . ' GROUP BY e.id',
        $benutzerId === null ? [$id] : [$id, $benutzerId])->fetch();
    if (!$e || !(int)$e['anzahl']) throw new ApiFehler('Einreichung nicht gefunden. Bitte neu laden.', 404);
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

/** Gruppe auflösen: alle Auslagen wieder offen, Einreichung löschen */
function loeseEinreichungAuf(string $id): void
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        abfrage("UPDATE va_auslagen SET status = 'offen', einreichung_id = NULL, veranlasst_am = NULL, veranlasst_von = NULL,
            geaendert_am = UTC_TIMESTAMP(3) WHERE einreichung_id = ?", [$id]);
        abfrage('DELETE FROM va_einreichungen WHERE id = ?', [$id]);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
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

/** Zurückziehen (versehentlich eingereicht, PDF-Dialog abgebrochen) – nur solange „eingereicht“ */
route('DELETE', 'einreichungen', function (): void {
    $b = erfordereLogin();
    $e = ladeEinreichung((string)($_GET['id'] ?? ''), (int)$b['id']);
    if ($e['veranlasst_am'] !== null) throw new ApiFehler('Für diese Einreichung wurde bereits eine Erstattung veranlasst.', 409);
    pruefeEinreichungsStatus($e, ['eingereicht']);
    loeseEinreichungAuf($e['id']);
    antworte();
});

/**
 * Mitglied ändert den Status der ganzen Gruppe:
 * „erstattet“ (aus eingereicht oder veranlasst) bzw. zurück auf den vorigen Stand
 * („veranlasst“, wenn der Kassenwart veranlasst hatte, sonst „eingereicht“).
 */
route('POST', 'einreichungen/status', function (): void {
    $b = erfordereLogin();
    $eingabe = eingabe();
    $e = ladeEinreichung((string)($eingabe['id'] ?? ''), (int)$b['id']);
    $status = (string)($eingabe['status'] ?? '');
    $veranlasst = $e['veranlasst_am'] !== null;
    match ($status) {
        'erstattet'   => pruefeEinreichungsStatus($e, ['eingereicht', 'veranlasst']),
        'veranlasst'  => $veranlasst ? pruefeEinreichungsStatus($e, ['erstattet'])
                                     : throw new ApiFehler('„Erstattung veranlasst“ setzt der Kassenwart.', 403),
        'eingereicht' => $veranlasst ? throw new ApiFehler('Die Erstattung wurde bereits veranlasst.', 409)
                                     : pruefeEinreichungsStatus($e, ['erstattet']),
        default       => throw new ApiFehler('Ungültiger Status.'),
    };
    setzeEinreichungsStatus($e['id'], $status);
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

route('GET', 'einreichungen/pdf', function (): void {
    $b = erfordereLogin();
    sendeEinreichungsPdf(ladeEinreichung((string)($_GET['id'] ?? ''), (int)$b['id'])['id']);
});
