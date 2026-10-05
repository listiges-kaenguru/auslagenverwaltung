<?php
// =============================================
// AUSLAGEN & BELEGE – jeder Benutzer sieht und ändert nur seine eigenen Daten
// Statusablauf: offen → eingereicht → veranlasst (nur Kassenwart) → erstattet.
// Ab der Einreichung gehört eine Auslage zu einer festen Gruppe (va_einreichungen): einzeln ist sie
// dann weder änderbar noch löschbar, und ihr Status wechselt nur gemeinsam mit der ganzen Gruppe
// (routen/einreichungen.php, routen/kasse.php). Erst wenn die Einreichung zurückgezogen oder
// abgelehnt wird, ist sie wieder offen und frei bearbeitbar.
// Ist die Erstattung einmal veranlasst (veranlasst_am), kann die Gruppe nicht mehr aufgelöst werden.
// =============================================
declare(strict_types=1);

const STATUS_WERTE = ['offen', 'eingereicht', 'veranlasst', 'erstattet'];
/** So lange nach „erstattet“ kann das Mitglied noch zurücknehmen; danach ist die Einreichung abgeschlossen */
const ABSCHLUSS_FRIST_S = 300;
const BELEG_TYPEN  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/** Auslagen samt Einreichung und Namen dessen, der die Erstattung veranlasst hat (Alias a) */
const AUSLAGEN_SELECT = "SELECT a.*,
        COALESCE(NULLIF(TRIM(CONCAT(v.vorname, ' ', v.nachname)), ''), v.benutzername) AS veranlasst_von_name,
        e.erstellt_am AS einreichung_am, e.art AS einreichung_art, e.erstattet_am AS einreichung_erstattet_am,
        GREATEST(0, " . ABSCHLUSS_FRIST_S . " - TIMESTAMPDIFF(SECOND, e.erstattet_am, UTC_TIMESTAMP(3))) AS abschluss_in_s,
        EXISTS(SELECT 1 FROM va_einreichung_pdfs p WHERE p.einreichung_id = a.einreichung_id) AS einreichung_hat_pdf
    FROM va_auslagen a
    LEFT JOIN va_benutzer v ON v.id = a.veranlasst_von
    LEFT JOIN va_einreichungen e ON e.id = a.einreichung_id";

function isoZeit(?string $dt): ?string
{
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}

function auslageFuerClient(array $a): array
{
    return [
        'id'            => $a['id'],
        'datum'         => $a['datum'],
        'haendler'      => $a['haendler'],
        'betrag'        => round((float)$a['betrag'], 2),
        'notiz'         => $a['notiz'],
        'status'        => $a['status'],
        'hatFoto'       => (bool)$a['hat_beleg'],
        'erstelltAm'    => isoZeit($a['erstellt_am']),
        'geaendertAm'   => isoZeit($a['geaendert_am']),
        'einreichungId' => $a['einreichung_id'],
        'eingereichtAm' => isoZeit($a['einreichung_am']),
        'uebernommen'   => $a['einreichung_art'] === 'uebernahme', // Altbestand ohne echte Einreichung
        'hatPdf'        => (bool)$a['einreichung_hat_pdf'],
        // Sekunden bis „abgeschlossen“ (0 = schon abgeschlossen; Altbestand ohne Zeitpunkt sofort), sonst null
        'abschlussInS'  => $a['status'] !== 'erstattet' ? null
            : ($a['einreichung_erstattet_am'] === null ? 0 : (int)$a['abschluss_in_s']),
        'veranlasstAm'  => isoZeit($a['veranlasst_am']),
        'veranlasstVon' => $a['veranlasst_von_name'] ?? null,
    ];
}

function ladeEigeneAuslage(string $id, int $benutzerId): array
{
    $a = abfrage(AUSLAGEN_SELECT . ' WHERE a.id = ? AND a.benutzer_id = ?', [$id, $benutzerId])->fetch();
    if (!$a) throw new ApiFehler('Auslage nicht gefunden.', 404);
    return $a;
}

/**
 * Einzelne Änderungen nur ohne Gruppe – eingereichte Auslagen gehören zu ihrer Einreichung.
 * (Ohne Gruppe, aber nicht offen, ist eine Auslage nur kurz während eines Imports: Beleg hochladen
 * bzw. bei Fehlern wieder löschen muss dann möglich sein.)
 */
function pruefeEinzelnAenderbar(array $a, string $was): void
{
    if ($a['einreichung_id'] === null && $a['veranlasst_am'] === null) return;
    if ($a['veranlasst_am'] !== null) {
        throw new ApiFehler("Die Erstattung von „{$a['haendler']}“ wurde bereits veranlasst – {$was}", 409);
    }
    throw new ApiFehler("„{$a['haendler']}“ gehört zu einer Einreichung – {$was} Ziehe dazu die ganze Einreichung zurück.", 409);
}

/** IDs aus der Eingabe (für Sammel-Aktionen) */
function idListe(mixed $ids): array
{
    if (!is_array($ids) || count($ids) > 1000) throw new ApiFehler('Keine Auslagen ausgewählt.');
    $ids = array_values(array_unique(array_filter($ids, 'is_string')));
    if (!$ids) throw new ApiFehler('Keine Auslagen ausgewählt.');
    return $ids;
}

/** Eigene Auslagen zu den IDs – fehlt eine, wurde sie inzwischen gelöscht o. Ä. */
function ladeEigeneAuslagen(array $ids, int $benutzerId): array
{
    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    $zeilen = abfrage(AUSLAGEN_SELECT . " WHERE a.benutzer_id = ? AND a.id IN ({$platzhalter})",
        [$benutzerId, ...$ids])->fetchAll();
    if (count($zeilen) !== count($ids)) throw new ApiFehler('Einige Auslagen wurden nicht gefunden. Bitte neu laden.', 409);
    return $zeilen;
}

/** Felder prüfen; $teilweise = nur vorhandene Felder prüfen (Änderung) */
function pruefeAuslagenFelder(array $e, bool $teilweise): array
{
    $werte = [];
    if (!$teilweise || array_key_exists('datum', $e)) {
        $datum = textFeld($e, 'datum', 10, true);
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $datum);
        if (!$d || $d->format('Y-m-d') !== $datum) throw new ApiFehler('Ungültiges Datum.');
        if ($d > new DateTimeImmutable('tomorrow')) throw new ApiFehler('Datum liegt in der Zukunft.');
        $werte['datum'] = $datum;
    }
    if (!$teilweise || array_key_exists('haendler', $e)) {
        $werte['haendler'] = textFeld($e, 'haendler', 100, true);
    }
    if (!$teilweise || array_key_exists('betrag', $e)) {
        $betrag = $e['betrag'] ?? null;
        if (!is_int($betrag) && !is_float($betrag)) throw new ApiFehler('Ungültiger Betrag.');
        $betrag = round((float)$betrag, 2);
        if ($betrag <= 0 || $betrag >= 1_000_000) throw new ApiFehler('Ungültiger Betrag.');
        $werte['betrag'] = number_format($betrag, 2, '.', '');
    }
    if (!$teilweise || array_key_exists('notiz', $e)) {
        $werte['notiz'] = textFeld($e, 'notiz', 500);
    }
    return $werte;
}

route('GET', 'auslagen', function (): void {
    $b = erfordereLogin();
    // Abgebrochener Import o. Ä.: nicht offene Auslagen ohne Gruppe nachträglich bündeln
    $verwaist = abfrage("SELECT 1 FROM va_auslagen WHERE benutzer_id = ? AND status <> 'offen'
        AND einreichung_id IS NULL LIMIT 1", [$b['id']])->fetchColumn();
    if ($verwaist) gruppiereVerwaisteAuslagen(db(), (int)$b['id']);
    $zeilen = abfrage(AUSLAGEN_SELECT . ' WHERE a.benutzer_id = ? ORDER BY a.datum DESC, a.erstellt_am DESC', [$b['id']])->fetchAll();
    antworte(['auslagen' => array_map('auslageFuerClient', $zeilen)]);
});

/**
 * Neue Auslage. Ein Status ist nur beim Import erlaubt (offen, eingereicht, erstattet); nicht offene
 * Auslagen bündelt danach POST einreichungen/uebernahme (bzw. GET auslagen als Rückfallebene).
 */
route('POST', 'auslagen', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $werte = pruefeAuslagenFelder($e, false);
    $status = $e['status'] ?? 'offen';
    if (!in_array($status, ['offen', 'eingereicht', 'erstattet'], true)) {
        throw new ApiFehler($status === 'veranlasst' ? '„Erstattung veranlasst“ setzt der Kassenwart.' : 'Ungültiger Status.');
    }

    // Beim Import aus der Einzelplatz-App bleiben ID und Erfassungszeit erhalten
    $id = isset($e['id']) ? (string)$e['id'] : neueUuid();
    if (!preg_match('/^[A-Za-z0-9-]{1,36}$/', $id)) throw new ApiFehler('Ungültige ID.');
    $besitzer = abfrage('SELECT benutzer_id FROM va_auslagen WHERE id = ?', [$id])->fetchColumn();
    if ($besitzer !== false) {
        if ((int)$besitzer === (int)$b['id']) throw new ApiFehler('Diese Auslage ist bereits vorhanden.', 409);
        $id = neueUuid(); // gleiche ID bei einem anderen Benutzer → neue vergeben
    }
    $erstellt = gmdate('Y-m-d H:i:s.v');
    if (isset($e['erstelltAm']) && is_string($e['erstelltAm']) && ($t = strtotime($e['erstelltAm'])) !== false) {
        $erstellt = gmdate('Y-m-d H:i:s', $t) . '.000';
    }

    try {
        abfrage('INSERT INTO va_auslagen (id, benutzer_id, datum, haendler, betrag, notiz, status, hat_beleg, erstellt_am, geaendert_am)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP(3))', [
            $id, $b['id'], $werte['datum'], $werte['haendler'], $werte['betrag'], $werte['notiz'], $status, $erstellt,
        ]);
    } catch (PDOException $ex) {
        if ((int)($ex->errorInfo[1] ?? 0) === 1062) throw new ApiFehler('Diese Auslage ist bereits vorhanden.', 409);
        throw $ex;
    }
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});

route('PUT', 'auslagen', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    $e = eingabe();
    if (array_key_exists('status', $e)) throw new ApiFehler('Der Status ändert sich nur über Einreichungen.');
    pruefeEinzelnAenderbar(ladeEigeneAuslage($id, (int)$b['id']), 'die Angaben können nicht geändert werden.');
    $werte = pruefeAuslagenFelder($e, true);
    if ($werte) {
        $set = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($werte)));
        abfrage("UPDATE va_auslagen SET {$set}, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ? AND benutzer_id = ?",
            [...array_values($werte), $id, $b['id']]);
    }
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});

route('DELETE', 'auslagen', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    $a = abfrage(AUSLAGEN_SELECT . ' WHERE a.id = ? AND a.benutzer_id = ?', [$id, $b['id']])->fetch();
    if (!$a) antworte(); // schon weg
    pruefeEinzelnAenderbar($a, 'sie kann nicht gelöscht werden.');
    abfrage('DELETE FROM va_auslagen WHERE id = ? AND benutzer_id = ?', [$id, $b['id']]);
    antworte();
});

// ---------------------------------------------
// Belege (Binärdaten)
// ---------------------------------------------
/** Beleg als Binärdaten ausliefern (Berechtigung prüft der Aufrufer) */
function sendeBeleg(string $id): never
{
    $beleg = abfrage('SELECT typ, daten FROM va_belege WHERE auslage_id = ?', [$id])->fetch();
    if (!$beleg) throw new ApiFehler('Kein Beleg vorhanden.', 404);
    $typ = in_array($beleg['typ'], BELEG_TYPEN, true) ? $beleg['typ'] : 'application/octet-stream';
    header('Content-Type: ' . $typ);
    header('Content-Length: ' . strlen($beleg['daten']));
    header('Content-Disposition: attachment; filename="beleg"');
    echo $beleg['daten'];
    exit;
}

route('GET', 'beleg', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    ladeEigeneAuslage($id, (int)$b['id']);
    sendeBeleg($id);
});

route('PUT', 'beleg', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    pruefeEinzelnAenderbar(ladeEigeneAuslage($id, (int)$b['id']), 'der Beleg kann nicht ersetzt werden.');

    $typ = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if (!in_array($typ, BELEG_TYPEN, true)) throw new ApiFehler('Nur Fotos (JPEG, PNG, WebP, GIF) oder PDFs sind erlaubt.');
    $daten = file_get_contents('php://input') ?: '';
    if ($daten === '') throw new ApiFehler('Der Beleg ist leer oder zu groß für den Server.', 413);
    if (strlen($daten) > maxBelegBytes()) throw new ApiFehler('Der Beleg ist zu groß.', 413);
    if ($typ === 'application/pdf' && !str_starts_with($daten, '%PDF')) throw new ApiFehler('Die Datei ist kein gültiges PDF.');

    $stmt = db()->prepare('REPLACE INTO va_belege (auslage_id, typ, groesse, daten) VALUES (?, ?, ?, ?)');
    $stmt->bindValue(1, $id);
    $stmt->bindValue(2, $typ);
    $stmt->bindValue(3, strlen($daten), PDO::PARAM_INT);
    $stmt->bindValue(4, $daten, PDO::PARAM_LOB);
    try {
        $stmt->execute();
    } catch (PDOException $ex) {
        if ((int)($ex->errorInfo[1] ?? 0) === 1153 || str_contains($ex->getMessage(), 'max_allowed_packet')) {
            throw new ApiFehler('Der Beleg ist größer, als die Datenbank erlaubt (max_allowed_packet).', 413);
        }
        throw $ex;
    }
    abfrage('UPDATE va_auslagen SET hat_beleg = 1, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ?', [$id]);
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});

route('DELETE', 'beleg', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    pruefeEinzelnAenderbar(ladeEigeneAuslage($id, (int)$b['id']), 'der Beleg kann nicht entfernt werden.');
    abfrage('DELETE FROM va_belege WHERE auslage_id = ?', [$id]);
    abfrage('UPDATE va_auslagen SET hat_beleg = 0, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ?', [$id]);
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});
