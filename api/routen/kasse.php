<?php
// =============================================
// KASSE: Einblick für Kassenwart und Vorstand
// Gezielte Ausnahme von „nur eigene Auslagen“: Wer eine Kassenrolle hat, sieht die Auslagen
// aller Mitglieder ab Status „eingereicht“ – offene Auslagen bleiben privat.
// Gearbeitet wird immer mit ganzen Einreichungen (Gruppen), nie mit einzelnen Auslagen:
// - Kassenwart: „Erstattung veranlasst“ setzen bzw. zurücknehmen, solange das Mitglied den
//   Eingang noch nicht als „erstattet“ bestätigt hat
// - Kassenwart und Vorstand: eine Einreichung mit Begründung ablehnen, solange sie „eingereicht“ ist
//   (→ alle Auslagen wieder offen beim Mitglied; die Einreichung bleibt als „abgelehnt“ erhalten)
// - Kassenwart und Vorstand: Kommentare schreiben (kommentare.php)
// - Vorstand: sonst nur lesen
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
    ];
}

route('GET', 'kasse/auslagen', function (): void {
    $ich = erfordereKassenrolle();
    // Jede eingereichte Auslage gehört zu einer Einreichung – Reste (z. B. abgebrochener Import) bündeln
    $verwaist = abfrage("SELECT 1 FROM va_auslagen WHERE status <> 'offen' AND einreichung_id IS NULL LIMIT 1")->fetchColumn();
    if ($verwaist) gruppiereVerwaisteAuslagen(db());
    $zeilen = abfrage("SELECT a.*,
            COALESCE(NULLIF(TRIM(CONCAT(v.vorname, ' ', v.nachname)), ''), v.benutzername) AS veranlasst_von_name,
            COALESCE(NULLIF(TRIM(CONCAT(m.vorname, ' ', m.nachname)), ''), m.benutzername) AS mitglied_name,
            m.iban AS mitglied_iban,
            e.erstellt_am AS einreichung_am, e.art AS einreichung_art, e.erstattet_am AS einreichung_erstattet_am,
            GREATEST(0, " . ABSCHLUSS_FRIST_S . " - TIMESTAMPDIFF(SECOND, e.erstattet_am, UTC_TIMESTAMP(3))) AS abschluss_in_s,
            EXISTS(SELECT 1 FROM va_einreichung_pdfs p WHERE p.einreichung_id = a.einreichung_id) AS einreichung_hat_pdf
        FROM va_auslagen a
        JOIN va_benutzer m ON m.id = a.benutzer_id
        LEFT JOIN va_benutzer v ON v.id = a.veranlasst_von
        LEFT JOIN va_einreichungen e ON e.id = a.einreichung_id
        WHERE a.status <> 'offen'
        ORDER BY COALESCE(e.erstellt_am, a.geaendert_am) DESC, a.datum, a.erstellt_am")->fetchAll();
    $mitIban = $ich['kassenrolle'] === 'kassenwart';
    antworte([
        'auslagen'      => array_map(fn($a) => kassenAuslageFuerClient($a, $mitIban), $zeilen),
        'einreichungen' => einreichungsListe(null, (int)$ich['id']),
    ]);
});

route('GET', 'kasse/beleg', function (): void {
    erfordereKassenrolle();
    $id = (string)($_GET['id'] ?? '');
    $sichtbar = abfrage("SELECT 1 FROM va_auslagen WHERE id = ? AND status <> 'offen'", [$id])->fetchColumn();
    if (!$sichtbar) throw new ApiFehler('Auslage nicht gefunden.', 404);
    sendeBeleg($id);
});

route('GET', 'kasse/einreichung/pdf', function (): void {
    $ich = erfordereKassenrolle();
    sendeEinreichungsPdf(ladeEinreichungMitZugriff((string)($_GET['id'] ?? ''), $ich)['id']);
});

/** Kassenwart: status = "veranlasst" (aus „eingereicht“) oder "eingereicht" (Rücknahme aus „veranlasst“) */
route('POST', 'kasse/einreichung/status', function (): void {
    $ich = erfordereKassenrolle(true);
    $eingabe = eingabe();
    $e = ladeEinreichung((string)($eingabe['id'] ?? ''), null);
    $status = (string)($eingabe['status'] ?? '');
    if ($status === 'veranlasst') {
        pruefeEinreichungsStatus($e, ['eingereicht']);
        abfrage("UPDATE va_auslagen SET status = 'veranlasst', veranlasst_am = UTC_TIMESTAMP(3), veranlasst_von = ?,
            geaendert_am = UTC_TIMESTAMP(3) WHERE einreichung_id = ?", [$ich['id'], $e['id']]);
        protokolliereStatus($e, $ich, 'Status: Erstattung veranlasst');
    } elseif ($status === 'eingereicht') {
        pruefeEinreichungsStatus($e, ['veranlasst']);
        abfrage("UPDATE va_auslagen SET status = 'eingereicht', veranlasst_am = NULL, veranlasst_von = NULL,
            geaendert_am = UTC_TIMESTAMP(3) WHERE einreichung_id = ?", [$e['id']]);
        protokolliereStatus($e, $ich, 'Veranlassung zurückgenommen – Status wieder „Eingereicht“');
    } else {
        throw new ApiFehler('Ungültiger Status.');
    }
    antworte();
});

/** Kassenwart oder Vorstand: Einreichung mit Begründung nicht genehmigen → Auslagen wieder offen beim Mitglied */
route('POST', 'kasse/einreichung/ablehnen', function (): void {
    $ich = erfordereKassenrolle();
    $eingabe = eingabe();
    $begruendung = kommentarText($eingabe['begruendung'] ?? '', 'Bitte eine Begründung angeben.');
    $e = ladeEinreichung((string)($eingabe['id'] ?? ''), null);
    if ($e['veranlasst_am'] !== null) {
        throw new ApiFehler('Die Erstattung wurde bereits veranlasst. Nimm zuerst die Veranlassung zurück.', 409);
    }
    pruefeEinreichungsStatus($e, ['eingereicht']);
    schliesseEinreichung($e, 'abgelehnt', $ich, $begruendung);
    antworte();
});
