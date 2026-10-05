<?php
// =============================================
// KASSE: Einblick für Kassenwart und Vorstand
// Gezielte Ausnahme von „nur eigene Auslagen“: Wer eine Kassenrolle hat, sieht die Auslagen
// aller Mitglieder ab Status „eingereicht“ – offene Auslagen bleiben privat.
// - Vorstand: nur lesen
// - Kassenwart: zusätzlich „Erstattung veranlasst“ setzen bzw. zurücknehmen, solange das
//   Mitglied den Eingang noch nicht als „erstattet“ bestätigt hat
// Admins sehen hierüber nichts, sofern sie nicht selbst eine Kassenrolle haben.
// =============================================
declare(strict_types=1);

function kassenAuslageFuerClient(array $a, bool $mitIban): array
{
    return auslageFuerClient($a) + [
        'mitglied' => [
            'id'   => (int)$a['benutzer_id'],
            'name' => $a['mitglied_name'],
            // Bankverbindung braucht nur, wer die Überweisung veranlasst
            'iban' => $mitIban ? $a['mitglied_iban'] : null,
        ],
        'eingereichtAm' => isoZeit($a['einreichung_am']),
    ];
}

route('GET', 'kasse/auslagen', function (): void {
    $ich = erfordereKassenrolle();
    $zeilen = abfrage("SELECT a.*,
            COALESCE(NULLIF(TRIM(CONCAT(v.vorname, ' ', v.nachname)), ''), v.benutzername) AS veranlasst_von_name,
            COALESCE(NULLIF(TRIM(CONCAT(m.vorname, ' ', m.nachname)), ''), m.benutzername) AS mitglied_name,
            m.iban AS mitglied_iban,
            e.erstellt_am AS einreichung_am
        FROM va_auslagen a
        JOIN va_benutzer m ON m.id = a.benutzer_id
        LEFT JOIN va_benutzer v ON v.id = a.veranlasst_von
        LEFT JOIN va_einreichungen e ON e.id = a.einreichung_id
        WHERE a.status <> 'offen'
        ORDER BY COALESCE(e.erstellt_am, a.geaendert_am) DESC, a.datum, a.erstellt_am")->fetchAll();
    $mitIban = $ich['kassenrolle'] === 'kassenwart';
    antworte(['auslagen' => array_map(fn($a) => kassenAuslageFuerClient($a, $mitIban), $zeilen)]);
});

route('GET', 'kasse/beleg', function (): void {
    erfordereKassenrolle();
    $id = (string)($_GET['id'] ?? '');
    $sichtbar = abfrage("SELECT 1 FROM va_auslagen WHERE id = ? AND status <> 'offen'", [$id])->fetchColumn();
    if (!$sichtbar) throw new ApiFehler('Auslage nicht gefunden.', 404);
    sendeBeleg($id);
});

/** status = "veranlasst" (aus „eingereicht“) oder "eingereicht" (Rücknahme aus „veranlasst“) */
route('POST', 'kasse/status', function (): void {
    $ich = erfordereKassenrolle(true);
    $e = eingabe();
    $status = (string)($e['status'] ?? '');
    $ids = idListe($e['ids'] ?? null);
    $vorher = match ($status) {
        'veranlasst'  => 'eingereicht',
        'eingereicht' => 'veranlasst',
        default       => throw new ApiFehler('Ungültiger Status.'),
    };

    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    $passend = (int)abfrage("SELECT COUNT(*) FROM va_auslagen WHERE status = ? AND id IN ({$platzhalter})",
        [$vorher, ...$ids])->fetchColumn();
    if ($passend !== count($ids)) {
        throw new ApiFehler('Einige Auslagen wurden inzwischen geändert. Bitte neu laden.', 409);
    }

    $anzahl = $status === 'veranlasst'
        ? abfrage("UPDATE va_auslagen SET status = 'veranlasst', veranlasst_am = UTC_TIMESTAMP(3), veranlasst_von = ?,
                geaendert_am = UTC_TIMESTAMP(3)
            WHERE status = 'eingereicht' AND id IN ({$platzhalter})", [$ich['id'], ...$ids])->rowCount()
        : abfrage("UPDATE va_auslagen SET status = 'eingereicht', veranlasst_am = NULL, veranlasst_von = NULL,
                geaendert_am = UTC_TIMESTAMP(3)
            WHERE status = 'veranlasst' AND id IN ({$platzhalter})", $ids)->rowCount();
    antworte(['geaendert' => $anzahl]);
});
