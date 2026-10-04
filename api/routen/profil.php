<?php
// =============================================
// PROFIL: Stammdaten, Passwort, TOTP, Passkeys
// Kritische Änderungen (TOTP abschalten, neue Codes) verlangen das aktuelle Passwort.
// =============================================
declare(strict_types=1);

function pruefeAktuellesPasswort(array $benutzer, mixed $passwort): void
{
    if (!is_string($passwort) || !password_verify($passwort, $benutzer['passwort_hash'])) {
        throw new ApiFehler('Aktuelles Passwort ist falsch.', 403);
    }
}

/** Formal gültige IBAN? (Aufbau + Prüfsumme Modulo 97) */
function istGueltigeIban(string $iban): bool
{
    if (!preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/', $iban)) return false;
    if (str_starts_with($iban, 'DE') && strlen($iban) !== 22) return false;
    $umgestellt = substr($iban, 4) . substr($iban, 0, 4);
    $rest = 0;
    foreach (str_split($umgestellt) as $z) {
        $wert = ctype_digit($z) ? $z : (string)(ord($z) - 55);
        foreach (str_split($wert) as $ziffer) $rest = ($rest * 10 + (int)$ziffer) % 97;
    }
    return $rest === 1;
}

function speichereNeueCodes(int $benutzerId): array
{
    $codes = erzeugeWiederherstellungscodes();
    abfrage('DELETE FROM va_wiederherstellung WHERE benutzer_id = ?', [$benutzerId]);
    $stmt = db()->prepare('INSERT INTO va_wiederherstellung (benutzer_id, code_hash) VALUES (?, ?)');
    foreach ($codes as $code) {
        $stmt->execute([$benutzerId, password_hash(normalisiereWiederherstellungscode($code), PASSWORD_DEFAULT)]);
    }
    return $codes;
}

route('GET', 'profil', function (): void {
    $benutzer = aktuellerBenutzer();
    if (!$benutzer) throw new ApiFehler('Bitte anmelden.', 401);
    antworte(['benutzer' => benutzerFuerClient($benutzer)]);
});

route('PUT', 'profil/stammdaten', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $iban = strtoupper(preg_replace('/\s+/', '', textFeld($e, 'iban', 50)) ?? '');
    if ($iban !== '' && !istGueltigeIban($iban)) throw new ApiFehler('IBAN ist ungültig – bitte prüfen.');
    abfrage('UPDATE va_benutzer SET vorname = ?, nachname = ?, iban = ?, ort = ? WHERE id = ?', [
        textFeld($e, 'vorname'), textFeld($e, 'nachname'), $iban, textFeld($e, 'ort'), $b['id'],
    ]);
    antworte(['benutzer' => benutzerFuerClient(abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$b['id']])->fetch())]);
});

// Auch bei ausstehendem Pflichtwechsel erlaubt → nur Login prüfen
route('POST', 'profil/passwort', function (): void {
    $b = aktuellerBenutzer();
    if (!$b) throw new ApiFehler('Bitte anmelden.', 401);
    $e = eingabe();
    pruefeAktuellesPasswort($b, $e['alt'] ?? null);
    $neu = (string)($e['neu'] ?? '');
    pruefePasswortRegeln($neu);
    if (password_verify($neu, $b['passwort_hash'])) throw new ApiFehler('Das neue Passwort muss sich vom alten unterscheiden.');

    abfrage('UPDATE va_benutzer SET passwort_hash = ?, muss_passwort_aendern = 0 WHERE id = ?',
        [password_hash($neu, PASSWORD_DEFAULT), $b['id']]);
    erneuereSitzungsGeneration((int)$b['id']); // andere Geräte werden abgemeldet
    antworte(['benutzer' => benutzerFuerClient(abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$b['id']])->fetch())]);
});

// ---------------------------------------------
// TOTP
// ---------------------------------------------
route('POST', 'profil/totp/start', function (): void {
    $b = erfordereLogin();
    if ($b['totp_aktiv']) throw new ApiFehler('TOTP ist bereits eingerichtet.');
    $geheimnis = base32Encode(random_bytes(20));
    $_SESSION['totp_einrichtung'] = ['geheimnis' => $geheimnis, 'zeit' => time()];
    antworte([
        'geheimnis' => $geheimnis,
        'uri'       => totpUri($geheimnis, $b['benutzername'], 'VereinsAuslagen'),
    ]);
});

route('POST', 'profil/totp/bestaetigen', function (): void {
    $b = erfordereLogin();
    $vorgang = $_SESSION['totp_einrichtung'] ?? null;
    if (!$vorgang || time() - $vorgang['zeit'] > 900) throw new ApiFehler('Einrichtung abgelaufen – bitte neu starten.');
    $schritt = pruefeTotp(base32Decode($vorgang['geheimnis']), textFeld(eingabe(), 'code', 10, true), 0);
    if ($schritt === null) throw new ApiFehler('Code stimmt nicht. Uhrzeit des Smartphones prüfen und neuen Code eingeben.');

    unset($_SESSION['totp_einrichtung']);
    abfrage('UPDATE va_benutzer SET totp_geheimnis = ?, totp_aktiv = 1, totp_letzter_schritt = ? WHERE id = ?',
        [verschluessele($vorgang['geheimnis']), $schritt, $b['id']]);
    $codes = speichereNeueCodes((int)$b['id']);
    antworte([
        'codes'    => $codes,
        'benutzer' => benutzerFuerClient(abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$b['id']])->fetch()),
    ]);
});

route('POST', 'profil/totp/deaktivieren', function (): void {
    $b = erfordereLogin();
    pruefeAktuellesPasswort($b, eingabe()['passwort'] ?? null);
    abfrage('UPDATE va_benutzer SET totp_geheimnis = NULL, totp_aktiv = 0, totp_letzter_schritt = 0 WHERE id = ?', [$b['id']]);
    abfrage('DELETE FROM va_wiederherstellung WHERE benutzer_id = ?', [$b['id']]);
    antworte(['benutzer' => benutzerFuerClient(abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$b['id']])->fetch())]);
});

route('POST', 'profil/totp/neue-codes', function (): void {
    $b = erfordereLogin();
    if (!$b['totp_aktiv']) throw new ApiFehler('TOTP ist nicht eingerichtet.');
    pruefeAktuellesPasswort($b, eingabe()['passwort'] ?? null);
    antworte(['codes' => speichereNeueCodes((int)$b['id'])]);
});

// ---------------------------------------------
// Passkeys
// ---------------------------------------------
route('POST', 'profil/passkey-optionen', function (): void {
    $b = erfordereLogin();
    $ids = abfrage('SELECT credential_id FROM va_passkeys WHERE benutzer_id = ?', [$b['id']])->fetchAll(PDO::FETCH_COLUMN);
    antworte(['optionen' => passkeyRegistrierungsOptionen($b, $ids)]);
});

route('POST', 'profil/passkey', function (): void {
    $b = erfordereLogin();
    $e = eingabe();
    $daten = pruefePasskeyRegistrierung($e['credential'] ?? []);
    $name = textFeld($e, 'name', 100) ?: 'Passkey';
    try {
        abfrage('INSERT INTO va_passkeys (benutzer_id, credential_id, public_key, sign_count, name) VALUES (?, ?, ?, ?, ?)',
            [$b['id'], $daten['credential_id'], $daten['public_key'], $daten['sign_count'], $name]);
    } catch (PDOException $ex) {
        if ((int)($ex->errorInfo[1] ?? 0) === 1062) throw new ApiFehler('Dieser Passkey ist bereits registriert.');
        throw $ex;
    }
    antworte(['benutzer' => benutzerFuerClient($b)]);
});

route('DELETE', 'profil/passkey', function (): void {
    $b = erfordereLogin();
    abfrage('DELETE FROM va_passkeys WHERE id = ? AND benutzer_id = ?', [(int)($_GET['id'] ?? 0), $b['id']]);
    antworte(['benutzer' => benutzerFuerClient($b)]);
});
