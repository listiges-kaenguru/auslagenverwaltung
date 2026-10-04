<?php
// =============================================
// AUSLAGEN & BELEGE – jeder Benutzer sieht und ändert nur seine eigenen Daten
// =============================================
declare(strict_types=1);

const STATUS_WERTE = ['offen', 'eingereicht', 'erstattet'];
const BELEG_TYPEN  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

function auslageFuerClient(array $a): array
{
    $iso = fn(string $dt) => str_replace(' ', 'T', $dt) . 'Z';
    return [
        'id'          => $a['id'],
        'datum'       => $a['datum'],
        'haendler'    => $a['haendler'],
        'betrag'      => round((float)$a['betrag'], 2),
        'notiz'       => $a['notiz'],
        'status'      => $a['status'],
        'hatFoto'     => (bool)$a['hat_beleg'],
        'erstelltAm'  => $iso($a['erstellt_am']),
        'geaendertAm' => $iso($a['geaendert_am']),
    ];
}

function ladeEigeneAuslage(string $id, int $benutzerId): array
{
    $a = abfrage('SELECT * FROM va_auslagen WHERE id = ? AND benutzer_id = ?', [$id, $benutzerId])->fetch();
    if (!$a) throw new ApiFehler('Auslage nicht gefunden.', 404);
    return $a;
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
    if (array_key_exists('status', $e)) {
        if (!in_array($e['status'], STATUS_WERTE, true)) throw new ApiFehler('Ungültiger Status.');
        $werte['status'] = $e['status'];
    }
    return $werte;
}

function neueUuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

route('GET', 'auslagen', function (): void {
    $b = erfordereLogin();
    $zeilen = abfrage('SELECT * FROM va_auslagen WHERE benutzer_id = ? ORDER BY datum DESC, erstellt_am DESC', [$b['id']])->fetchAll();
    antworte(['auslagen' => array_map('auslageFuerClient', $zeilen)]);
});

route('POST', 'auslagen', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $werte = pruefeAuslagenFelder($e, false);

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
            $id, $b['id'], $werte['datum'], $werte['haendler'], $werte['betrag'], $werte['notiz'],
            $werte['status'] ?? 'offen', $erstellt,
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
    ladeEigeneAuslage($id, (int)$b['id']);
    $werte = pruefeAuslagenFelder(eingabe(), true);
    if ($werte) {
        $set = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($werte)));
        abfrage("UPDATE va_auslagen SET {$set}, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ? AND benutzer_id = ?",
            [...array_values($werte), $id, $b['id']]);
    }
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});

route('DELETE', 'auslagen', function (): void {
    $b = erfordereLogin();
    abfrage('DELETE FROM va_auslagen WHERE id = ? AND benutzer_id = ?', [(string)($_GET['id'] ?? ''), $b['id']]);
    antworte();
});

route('POST', 'auslagen/status', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $status = $e['status'] ?? '';
    $ids = $e['ids'] ?? null;
    if (!in_array($status, STATUS_WERTE, true)) throw new ApiFehler('Ungültiger Status.');
    if (!is_array($ids) || !$ids || count($ids) > 1000) throw new ApiFehler('Keine Auslagen ausgewählt.');
    $ids = array_values(array_filter($ids, 'is_string'));
    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    $anzahl = abfrage("UPDATE va_auslagen SET status = ?, geaendert_am = UTC_TIMESTAMP(3)
        WHERE benutzer_id = ? AND id IN ({$platzhalter})", [$status, $b['id'], ...$ids])->rowCount();
    antworte(['geaendert' => $anzahl]);
});

// ---------------------------------------------
// Belege (Binärdaten)
// ---------------------------------------------
route('GET', 'beleg', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    ladeEigeneAuslage($id, (int)$b['id']);
    $beleg = abfrage('SELECT typ, daten FROM va_belege WHERE auslage_id = ?', [$id])->fetch();
    if (!$beleg) throw new ApiFehler('Kein Beleg vorhanden.', 404);
    $typ = in_array($beleg['typ'], BELEG_TYPEN, true) ? $beleg['typ'] : 'application/octet-stream';
    header('Content-Type: ' . $typ);
    header('Content-Length: ' . strlen($beleg['daten']));
    header('Content-Disposition: attachment; filename="beleg"');
    echo $beleg['daten'];
    exit;
});

route('PUT', 'beleg', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    ladeEigeneAuslage($id, (int)$b['id']);

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
    ladeEigeneAuslage($id, (int)$b['id']);
    abfrage('DELETE FROM va_belege WHERE auslage_id = ?', [$id]);
    abfrage('UPDATE va_auslagen SET hat_beleg = 0, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ?', [$id]);
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});
