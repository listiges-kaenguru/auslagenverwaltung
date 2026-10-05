<?php
// =============================================
// AUSLAGEN, EINREICHUNGEN & BELEGE – jeder Benutzer sieht und ändert nur seine eigenen Daten
// Statusablauf: offen → eingereicht → veranlasst (nur Kassenwart, siehe kasse.php) → erstattet.
// Sobald die Erstattung einmal veranlasst wurde (veranlasst_am gesetzt), ist die Auslage
// gesperrt: nicht mehr löschbar, Angaben und Beleg unveränderlich – nur noch der Wechsel
// zwischen „veranlasst“ und „erstattet“ ist möglich. So bleibt nachvollziehbar, was erstattet wurde.
// =============================================
declare(strict_types=1);

const STATUS_WERTE    = ['offen', 'eingereicht', 'veranlasst', 'erstattet'];
const STATUS_MITGLIED = ['offen', 'eingereicht', 'erstattet']; // „veranlasst“ setzt nur der Kassenwart
const BELEG_TYPEN     = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/** Auslagen samt Namen dessen, der die Erstattung veranlasst hat (Alias a) */
const AUSLAGEN_SELECT = "SELECT a.*,
        COALESCE(NULLIF(TRIM(CONCAT(v.vorname, ' ', v.nachname)), ''), v.benutzername) AS veranlasst_von_name
    FROM va_auslagen a LEFT JOIN va_benutzer v ON v.id = a.veranlasst_von";

function isoZeit(?string $dt): ?string
{
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}

function auslageFuerClient(array $a): array
{
    $iso = fn(string $dt) => isoZeit($dt);
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
        'einreichungId' => $a['einreichung_id'],
        'veranlasstAm'  => isoZeit($a['veranlasst_am']),
        'veranlasstVon' => $a['veranlasst_von_name'] ?? null,
        'gesperrt'      => istGesperrt($a),
    ];
}

function ladeEigeneAuslage(string $id, int $benutzerId): array
{
    $a = abfrage(AUSLAGEN_SELECT . ' WHERE a.id = ? AND a.benutzer_id = ?', [$id, $benutzerId])->fetch();
    if (!$a) throw new ApiFehler('Auslage nicht gefunden.', 404);
    return $a;
}

/** Erstattung wurde (mindestens einmal) veranlasst → Auslage bleibt zur Nachvollziehbarkeit erhalten */
function istGesperrt(array $a): bool
{
    return $a['veranlasst_am'] !== null;
}

function pruefeNichtGesperrt(array $a, string $was): void
{
    if (istGesperrt($a)) {
        throw new ApiFehler("Die Erstattung von „{$a['haendler']}“ wurde bereits veranlasst – {$was}", 409);
    }
}

/** Darf das Mitglied selbst von $a['status'] nach $neu wechseln? */
function pruefeStatusWechsel(array $a, string $neu): void
{
    if (!in_array($neu, STATUS_WERTE, true)) throw new ApiFehler('Ungültiger Status.');
    if ($neu === $a['status']) return;
    if (istGesperrt($a)) {
        if (!in_array($neu, ['veranlasst', 'erstattet'], true)) {
            pruefeNichtGesperrt($a, 'der Status kann nur noch zwischen „Erstattung veranlasst“ und „Erstattet“ wechseln.');
        }
        return;
    }
    if (!in_array($neu, STATUS_MITGLIED, true)) throw new ApiFehler('„Erstattung veranlasst“ setzt der Kassenwart.', 403);
}

/** Einreichungen ohne zugehörige Auslagen entfernen (nach Zurücksetzen auf „offen“ oder Löschen) */
function raeumeEinreichungenAuf(int $benutzerId): void
{
    abfrage('DELETE FROM va_einreichungen WHERE benutzer_id = ?
        AND NOT EXISTS (SELECT 1 FROM va_auslagen a WHERE a.einreichung_id = va_einreichungen.id)', [$benutzerId]);
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
    if (array_key_exists('status', $e)) {
        // Wechsel bestehender Auslagen prüft pruefeStatusWechsel(); hier nur der Wertebereich
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
    $zeilen = abfrage(AUSLAGEN_SELECT . ' WHERE a.benutzer_id = ? ORDER BY a.datum DESC, a.erstellt_am DESC', [$b['id']])->fetchAll();
    antworte(['auslagen' => array_map('auslageFuerClient', $zeilen)]);
});

route('POST', 'auslagen', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $werte = pruefeAuslagenFelder($e, false);
    if (isset($werte['status']) && !in_array($werte['status'], STATUS_MITGLIED, true)) {
        throw new ApiFehler('„Erstattung veranlasst“ setzt der Kassenwart.', 403);
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
    $alt = ladeEigeneAuslage($id, (int)$b['id']);
    $werte = pruefeAuslagenFelder(eingabe(), true);
    if (array_diff_key($werte, ['status' => 1])) pruefeNichtGesperrt($alt, 'die Angaben können nicht mehr geändert werden.');
    if (isset($werte['status'])) {
        pruefeStatusWechsel($alt, $werte['status']);
        if ($werte['status'] === 'offen') $werte['einreichung_id'] = null; // zurückgezogen
    }
    if ($werte) {
        $set = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($werte)));
        abfrage("UPDATE va_auslagen SET {$set}, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ? AND benutzer_id = ?",
            [...array_values($werte), $id, $b['id']]);
        raeumeEinreichungenAuf((int)$b['id']);
    }
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});

route('DELETE', 'auslagen', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    $a = abfrage(AUSLAGEN_SELECT . ' WHERE a.id = ? AND a.benutzer_id = ?', [$id, $b['id']])->fetch();
    if (!$a) antworte(); // schon weg
    pruefeNichtGesperrt($a, 'sie kann nicht mehr gelöscht werden.');
    abfrage('DELETE FROM va_auslagen WHERE id = ? AND benutzer_id = ?', [$id, $b['id']]);
    raeumeEinreichungenAuf((int)$b['id']);
    antworte();
});

/** Sammel-Statuswechsel durch das Mitglied – alle oder keine */
route('POST', 'auslagen/status', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $status = (string)($e['status'] ?? '');
    $ids = idListe($e['ids'] ?? null);
    foreach (ladeEigeneAuslagen($ids, (int)$b['id']) as $a) pruefeStatusWechsel($a, $status);
    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    $anzahl = abfrage("UPDATE va_auslagen SET status = ?, geaendert_am = UTC_TIMESTAMP(3),
            einreichung_id = IF(? = 'offen', NULL, einreichung_id)
        WHERE benutzer_id = ? AND id IN ({$platzhalter})", [$status, $status, $b['id'], ...$ids])->rowCount();
    raeumeEinreichungenAuf((int)$b['id']);
    antworte(['geaendert' => $anzahl]);
});

// ---------------------------------------------
// Einreichungen: offene Auslagen gebündelt auf „eingereicht“ setzen
// ---------------------------------------------
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

/** Einreichung zurückziehen (z. B. PDF-Dialog abgebrochen) – nur solange nichts veranlasst ist */
route('DELETE', 'einreichungen', function (): void {
    $b = erfordereLogin();
    $id = (string)($_GET['id'] ?? '');
    $gehoert = abfrage('SELECT 1 FROM va_einreichungen WHERE id = ? AND benutzer_id = ?', [$id, $b['id']])->fetchColumn();
    if (!$gehoert) throw new ApiFehler('Einreichung nicht gefunden.', 404);
    $gesperrt = (int)abfrage('SELECT COUNT(*) FROM va_auslagen WHERE einreichung_id = ? AND veranlasst_am IS NOT NULL',
        [$id])->fetchColumn();
    if ($gesperrt) throw new ApiFehler('Für diese Einreichung wurde bereits eine Erstattung veranlasst.', 409);
    abfrage("UPDATE va_auslagen SET status = 'offen', einreichung_id = NULL, geaendert_am = UTC_TIMESTAMP(3)
        WHERE einreichung_id = ? AND benutzer_id = ?", [$id, $b['id']]);
    abfrage('DELETE FROM va_einreichungen WHERE id = ? AND benutzer_id = ?', [$id, $b['id']]);
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
    pruefeNichtGesperrt(ladeEigeneAuslage($id, (int)$b['id']), 'der Beleg kann nicht mehr ersetzt werden.');

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
    pruefeNichtGesperrt(ladeEigeneAuslage($id, (int)$b['id']), 'der Beleg kann nicht mehr entfernt werden.');
    abfrage('DELETE FROM va_belege WHERE auslage_id = ?', [$id]);
    abfrage('UPDATE va_auslagen SET hat_beleg = 0, geaendert_am = UTC_TIMESTAMP(3) WHERE id = ?', [$id]);
    antworte(['auslage' => auslageFuerClient(ladeEigeneAuslage($id, (int)$b['id']))]);
});
