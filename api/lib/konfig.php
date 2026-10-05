<?php
// =============================================
// KONFIGURATION (api/config/config.php)
// Wird bei der Einrichtung bzw. vom Admin geschrieben. Als PHP-Datei abgelegt:
// selbst wenn der Ordnerschutz fehlt, liefert der Webserver nur leere Ausgabe.
// =============================================
declare(strict_types=1);

const KONFIG_DATEI = __DIR__ . '/../config/config.php';

function ladeKonfig(): ?array
{
    static $konfig = false;
    if ($konfig === false) {
        $konfig = is_file(KONFIG_DATEI) ? (require KONFIG_DATEI) : null;
        if (!is_array($konfig)) $konfig = null;
    }
    return $konfig;
}

function istEingerichtet(): bool
{
    return ladeKonfig() !== null;
}

function speichereKonfig(array $konfig): void
{
    $verzeichnis = dirname(KONFIG_DATEI);
    if (!is_dir($verzeichnis) || !is_writable($verzeichnis)) {
        throw new ApiFehler('Der Ordner api/config ist nicht beschreibbar. Bitte Schreibrechte für den Webserver setzen.', 500);
    }
    $inhalt = "<?php\n// Automatisch erzeugt von VereinsAuslagen – nicht öffentlich zugänglich machen!\n"
        . 'return ' . var_export($konfig, true) . ";\n";
    // Atomar schreiben, damit parallele Anfragen nie eine halbe Datei lesen
    $tmp = KONFIG_DATEI . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, $inhalt, LOCK_EX) === false || !rename($tmp, KONFIG_DATEI)) {
        @unlink($tmp);
        throw new ApiFehler('Konfiguration konnte nicht gespeichert werden.', 500);
    }
    @chmod(KONFIG_DATEI, 0600);
    if (function_exists('opcache_invalidate')) @opcache_invalidate(KONFIG_DATEI, true);
}

/**
 * Datensicherung (Backup speichern/einspielen) im Export – standardmäßig AUS, weil alle Daten in der
 * Datenbank liegen. Nur für Tests: in api/config/config.php 'datensicherung' => true ergänzen.
 */
function datensicherungAktiv(): bool
{
    return (ladeKonfig()['datensicherung'] ?? false) === true;
}

/** Geheimer Schlüssel (32 Byte) zum Verschlüsseln der TOTP-Geheimnisse */
function geheimSchluessel(): string
{
    $schluessel = base64_decode((string)(ladeKonfig()['schluessel'] ?? ''), true);
    if ($schluessel === false || strlen($schluessel) !== 32) throw new ApiFehler('Konfiguration unvollständig (Schlüssel).', 500);
    return $schluessel;
}

function verschluessele(string $klartext): string
{
    $iv = random_bytes(12);
    $tag = '';
    $chiffre = openssl_encrypt($klartext, 'aes-256-gcm', geheimSchluessel(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($chiffre === false) throw new ApiFehler('Verschlüsselung fehlgeschlagen.', 500);
    return base64_encode($iv . $tag . $chiffre);
}

function entschluessele(string $wert): string
{
    $roh = base64_decode($wert, true);
    if ($roh === false || strlen($roh) < 29) throw new ApiFehler('Gespeichertes Geheimnis ist beschädigt.', 500);
    $klartext = openssl_decrypt(substr($roh, 28), 'aes-256-gcm', geheimSchluessel(), OPENSSL_RAW_DATA,
        substr($roh, 0, 12), substr($roh, 12, 16));
    if ($klartext === false) throw new ApiFehler('Gespeichertes Geheimnis ist nicht lesbar.', 500);
    return $klartext;
}
