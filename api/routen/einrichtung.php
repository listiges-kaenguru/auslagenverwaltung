<?php
// =============================================
// STATUS & ERSTEINRICHTUNG
// Die Einrichtung ist nur möglich, solange keine Konfigurationsdatei existiert.
// =============================================
declare(strict_types=1);

const MAX_BELEG_BYTES = 15 * 1024 * 1024;

/** Größtes Beleg-Upload, das Server und PHP zulassen */
function maxBelegBytes(): int
{
    return min(MAX_BELEG_BYTES, iniBytes((string)ini_get('post_max_size')) - 1024);
}

route('GET', 'status', function (): void {
    $eingerichtet = istEingerichtet();
    $benutzer = $eingerichtet ? aktuellerBenutzer() : null;
    antworte([
        'eingerichtet' => $eingerichtet,
        'mfaAusstehend' => !$benutzer && !empty($_SESSION['mfa_ausstehend']),
        'benutzer'     => $benutzer ? benutzerFuerClient($benutzer) : null,
        'maxBelegBytes' => maxBelegBytes(),
        'passkeysMoeglich' => istHttps() || hostName() === 'localhost',
    ]);
});

route('POST', 'einrichtung', function (): void {
    if (istEingerichtet()) throw new ApiFehler('Die Anwendung ist bereits eingerichtet.', 403);
    $e = eingabe();

    $db = [
        'host'     => textFeld($e['db'] ?? [], 'host', 255, true),
        'port'     => (int)($e['db']['port'] ?? 3306),
        'name'     => textFeld($e['db'] ?? [], 'name', 64, true),
        'benutzer' => textFeld($e['db'] ?? [], 'benutzer', 100, true),
        'passwort' => (string)($e['db']['passwort'] ?? ''),
    ];
    $benutzername = textFeld($e['admin'] ?? [], 'benutzername', 50, true);
    $passwort = (string)($e['admin']['passwort'] ?? '');
    pruefeBenutzername($benutzername);
    pruefePasswortRegeln($passwort);

    $pdo = verbinde($db);
    migriere($pdo);
    $uebersicht = dbUebersicht($pdo);

    // Vorhandene VereinsAuslagen-Datenbank: nur anbinden, keinen weiteren Admin anlegen
    if ($uebersicht['benutzer'] === 0) {
        $stmt = $pdo->prepare('INSERT INTO va_benutzer (benutzername, passwort_hash, rolle, webauthn_handle)
            VALUES (?, ?, \'admin\', ?)');
        $stmt->execute([$benutzername, password_hash($passwort, PASSWORD_DEFAULT), base64urlEncode(random_bytes(32))]);
    }

    speichereKonfig([
        'db'         => $db,
        'schluessel' => base64_encode(random_bytes(32)),
    ]);
    antworte(['vorhandeneDaten' => $uebersicht['benutzer'] > 0]);
});

function pruefeBenutzername(string $name): void
{
    if (!preg_match('/^[A-Za-z0-9._@-]{3,50}$/', $name)) {
        throw new ApiFehler('Benutzername: 3–50 Zeichen, erlaubt sind Buchstaben, Ziffern und . _ @ -');
    }
}
