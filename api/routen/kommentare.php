<?php
// =============================================
// KOMMENTARE – ein Verlauf je Einreichung: Rückfragen und Protokoll aller Statusänderungen
// - Lesen und schreiben: der Einreicher sowie Kassenwart und Vorstand (Admins ohne Kassenrolle nicht)
// - Schreiben nur bei aktiven Einreichungen, in jedem Status; abgeschlossene sind nur lesbar
// - Optionaler Bezug auf eine Auslage der Einreichung (als Text mitgespeichert, bleibt lesbar)
// - Statusänderungen (eingereicht, veranlasst, erstattet, Rücknahmen, zurückgezogen, abgelehnt)
//   stehen als Einträge der Art status/ablehnung/zurueckgezogen im selben Verlauf – nie löschbar
// - Nicht bearbeitbar; der eigene Kommentar ist löschbar, solange er jünger als
//   KOMMENTAR_LOESCHFRIST_S ist UND noch niemand anderes danach kommentiert hat
// - Ungelesen: je Benutzer und Einreichung der zuletzt gelesene Kommentar (va_kommentar_gelesen);
//   eigene Kommentare zählen nie als ungelesen
// =============================================
declare(strict_types=1);

const KOMMENTAR_MAX_LAENGE    = 2000;
const KOMMENTAR_LOESCHFRIST_S = 300;

/** Text prüfen: getrimmt, 1–2000 Zeichen, Zeilenumbrüche bleiben */
function kommentarText(mixed $text, string $fehlt = 'Bitte einen Text eingeben.'): string
{
    if (!is_string($text)) throw new ApiFehler($fehlt);
    $text = trim(str_replace("\r\n", "\n", $text));
    if ($text === '') throw new ApiFehler($fehlt);
    if (mb_strlen($text) > KOMMENTAR_MAX_LAENGE) {
        throw new ApiFehler('Der Text ist zu lang (max. ' . KOMMENTAR_MAX_LAENGE . ' Zeichen).');
    }
    return $text;
}

/** Rolle des Autors in dieser Einreichung: Einreicher schreiben immer als Mitglied */
function autorRolle(array $e, array $autor): string
{
    if ((int)$e['benutzer_id'] === (int)$autor['id']) return 'mitglied';
    return $autor['kassenrolle'];
}

function fuegeKommentarEin(array $e, array $autor, string $text, string $art = 'kommentar',
    ?string $auslageId = null, ?string $auslageText = null): int
{
    $name = trim($autor['vorname'] . ' ' . $autor['nachname']) ?: $autor['benutzername'];
    abfrage('INSERT INTO va_kommentare (einreichung_id, auslage_id, auslage_text, benutzer_id, autor_name, autor_rolle,
            art, text, erstellt_am) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))',
        [$e['id'], $auslageId, $auslageText, $autor['id'], $name, autorRolle($e, $autor), $art, $text]);
    return (int)db()->lastInsertId();
}

/** Statusänderung im Verlauf festhalten ($e braucht id und benutzer_id) */
function protokolliereStatus(array $e, array $autor, string $text): void
{
    fuegeKommentarEin($e, $autor, $text, 'status');
}

/** Nur Kommentare anderer zählen als Antwort (Statuseinträge nicht) */
const ANTWORT_DANACH_SQL = "EXISTS(SELECT 1 FROM va_kommentare d WHERE d.einreichung_id = k.einreichung_id AND d.id > k.id
    AND d.art = 'kommentar' AND (d.benutzer_id IS NULL OR d.benutzer_id <> k.benutzer_id)) AS antwort_danach";

function kommentarFuerClient(array $k, int $ich, int $gelesenBis): array
{
    $eigen = (int)$k['benutzer_id'] === $ich;
    $loeschbarBis = null;
    if ($eigen && $k['art'] === 'kommentar' && !(int)$k['antwort_danach'] && $k['zustand'] === 'aktiv') {
        $bis = strtotime($k['erstellt_am'] . ' UTC') + KOMMENTAR_LOESCHFRIST_S;
        if ($bis > time()) $loeschbarBis = gmdate('Y-m-d\TH:i:s\Z', $bis);
    }
    return [
        'id'           => (int)$k['id'],
        'art'          => $k['art'],
        'text'         => $k['text'],
        'autor'        => $k['autor_name'],
        'rolle'        => $k['autor_rolle'],
        'eigen'        => $eigen,
        'auslageId'    => $k['auslage_id'],
        'auslageText'  => $k['auslage_text'],
        'erstelltAm'   => isoZeit($k['erstellt_am']),
        'neu'          => !$eigen && (int)$k['id'] > $gelesenBis,
        'loeschbarBis' => $loeschbarBis,
    ];
}

route('GET', 'kommentare', function (): void {
    $b = erfordereLogin();
    $e = ladeEinreichungMitZugriff((string)($_GET['einreichung'] ?? ''), $b);
    $gelesenBis = (int)abfrage('SELECT bis_id FROM va_kommentar_gelesen WHERE benutzer_id = ? AND einreichung_id = ?',
        [$b['id'], $e['id']])->fetchColumn();
    $zeilen = abfrage("SELECT k.*, e.zustand, " . ANTWORT_DANACH_SQL . "
        FROM va_kommentare k JOIN va_einreichungen e ON e.id = k.einreichung_id
        WHERE k.einreichung_id = ? ORDER BY k.id", [$e['id']])->fetchAll();
    antworte([
        'kommentare'  => array_map(fn($k) => kommentarFuerClient($k, (int)$b['id'], $gelesenBis), $zeilen),
        'schreibbar'  => $e['zustand'] === 'aktiv',
    ]);
});

route('POST', 'kommentare', function (): void {
    $b = erfordereLogin();
    $eingabe = eingabe();
    $e = ladeEinreichungMitZugriff((string)($eingabe['einreichungId'] ?? ''), $b);
    if ($e['zustand'] !== 'aktiv') throw new ApiFehler('Abgeschlossene Einreichungen lassen sich nicht mehr kommentieren.', 409);
    $text = kommentarText($eingabe['text'] ?? '');

    $auslageId = $auslageText = null;
    if (!empty($eingabe['auslageId'])) {
        $a = abfrage('SELECT id, haendler, betrag, notiz FROM va_auslagen WHERE id = ? AND einreichung_id = ?',
            [(string)$eingabe['auslageId'], $e['id']])->fetch();
        if (!$a) throw new ApiFehler('Die Auslage gehört nicht zu dieser Einreichung.');
        $auslageId = $a['id'];
        // „Händler · Betrag · Hinweis“ – eindeutig, auch wenn es denselben Händler mehrfach gibt
        $auslageText = $a['haendler'] . ' · ' . number_format((float)$a['betrag'], 2, ',', '.') . ' €';
        if ($a['notiz'] !== '') $auslageText .= ' · ' . $a['notiz'];
        if (mb_strlen($auslageText) > 150) $auslageText = mb_substr($auslageText, 0, 149) . '…';
    }
    $id = fuegeKommentarEin($e, $b, $text, 'kommentar', $auslageId, $auslageText);
    antworte(['id' => $id]);
});

/** Eigenen Kommentar löschen – nur innerhalb der Frist und solange niemand anderes geantwortet hat */
route('DELETE', 'kommentare', function (): void {
    $b = erfordereLogin();
    $k = abfrage("SELECT k.*, e.zustand,
            TIMESTAMPDIFF(SECOND, k.erstellt_am, UTC_TIMESTAMP(3)) AS alter_s, " . ANTWORT_DANACH_SQL . "
        FROM va_kommentare k JOIN va_einreichungen e ON e.id = k.einreichung_id
        WHERE k.id = ? AND k.benutzer_id = ?", [(int)($_GET['id'] ?? 0), $b['id']])->fetch();
    if (!$k || $k['art'] !== 'kommentar') throw new ApiFehler('Kommentar nicht gefunden.', 404);
    if ((int)$k['antwort_danach']) throw new ApiFehler('Auf den Kommentar wurde bereits geantwortet – er bleibt bestehen.', 409);
    if ((int)$k['alter_s'] >= KOMMENTAR_LOESCHFRIST_S || $k['zustand'] !== 'aktiv') {
        throw new ApiFehler('Der Kommentar kann nur in den ersten 5 Minuten gelöscht werden.', 409);
    }
    abfrage('DELETE FROM va_kommentare WHERE id = ?', [$k['id']]);
    antworte();
});

/** Verlauf bis einschließlich bisId als gelesen merken (nie zurück) */
route('POST', 'kommentare/gelesen', function (): void {
    $b = erfordereLogin();
    $eingabe = eingabe();
    $e = ladeEinreichungMitZugriff((string)($eingabe['einreichungId'] ?? ''), $b);
    $bis = (int)($eingabe['bisId'] ?? 0);
    if ($bis <= 0) throw new ApiFehler('Ungültige Angabe.');
    abfrage('INSERT INTO va_kommentar_gelesen (benutzer_id, einreichung_id, bis_id) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE bis_id = GREATEST(bis_id, VALUES(bis_id))', [$b['id'], $e['id'], $bis]);
    antworte();
});

/** Für die Hinweis-Punkte an der Navigation: ungelesene Kommentare bei eigenen bzw. allen Einreichungen */
route('GET', 'kommentare/ungelesen', function (): void {
    $b = erfordereLogin();
    $zaehle = fn(?int $besitzer) => (int)abfrage("SELECT COUNT(*) FROM va_kommentare k
        JOIN va_einreichungen e ON e.id = k.einreichung_id
        LEFT JOIN va_kommentar_gelesen g ON g.einreichung_id = e.id AND g.benutzer_id = ?
        WHERE (k.benutzer_id IS NULL OR k.benutzer_id <> ?) AND k.id > COALESCE(g.bis_id, 0)"
        . ($besitzer === null ? '' : ' AND e.benutzer_id = ?'),
        $besitzer === null ? [$b['id'], $b['id']] : [$b['id'], $b['id'], $besitzer])->fetchColumn();
    $kasse = in_array($b['kassenrolle'], ['kassenwart', 'vorstand'], true);
    antworte(['eigene' => $zaehle((int)$b['id']), 'kasse' => $kasse ? $zaehle(null) : 0]);
});
