<?php
// =============================================
// TOTP (RFC 6238): 6 Ziffern, 30 Sekunden, SHA-1 – kompatibel mit allen Authenticator-Apps
// =============================================
declare(strict_types=1);

const BASE32_ZEICHEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(string $bin): string
{
    $bits = '';
    foreach (str_split($bin) as $byte) $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
    $text = '';
    foreach (str_split($bits, 5) as $gruppe) {
        $text .= BASE32_ZEICHEN[bindec(str_pad($gruppe, 5, '0'))];
    }
    return $text;
}

function base32Decode(string $text): string
{
    $text = strtoupper(preg_replace('/[\s=-]/', '', $text) ?? '');
    $bits = '';
    foreach (str_split($text) as $zeichen) {
        $wert = strpos(BASE32_ZEICHEN, $zeichen);
        if ($wert === false) throw new ApiFehler('Ungültiges TOTP-Geheimnis.');
        $bits .= str_pad(decbin($wert), 5, '0', STR_PAD_LEFT);
    }
    $bin = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) === 8) $bin .= chr(bindec($byte));
    }
    return $bin;
}

function totpCode(string $geheimnis, int $schritt): string
{
    $hash = hash_hmac('sha1', pack('J', $schritt), $geheimnis, true);
    $o = ord($hash[19]) & 0x0f;
    $zahl = ((ord($hash[$o]) & 0x7f) << 24) | (ord($hash[$o + 1]) << 16) | (ord($hash[$o + 2]) << 8) | ord($hash[$o + 3]);
    return str_pad((string)($zahl % 1_000_000), 6, '0', STR_PAD_LEFT);
}

/**
 * Code prüfen (±1 Zeitfenster gegen Uhrabweichung).
 * Gibt den verwendeten Zeitschritt zurück oder null. Schritte ≤ $letzterSchritt werden
 * abgelehnt → ein abgefangener Code kann nicht erneut verwendet werden.
 */
function pruefeTotp(string $geheimnis, string $code, int $letzterSchritt): ?int
{
    $code = preg_replace('/\D/', '', $code) ?? '';
    if (strlen($code) !== 6) return null;
    $jetzt = intdiv(time(), 30);
    for ($d = -1; $d <= 1; $d++) {
        $schritt = $jetzt + $d;
        if ($schritt > $letzterSchritt && hash_equals(totpCode($geheimnis, $schritt), $code)) return $schritt;
    }
    return null;
}

function totpUri(string $geheimnisBase32, string $konto, string $aussteller): string
{
    return 'otpauth://totp/' . rawurlencode("{$aussteller}:{$konto}")
        . '?secret=' . $geheimnisBase32 . '&issuer=' . rawurlencode($aussteller)
        . '&algorithm=SHA1&digits=6&period=30';
}

/** 10 Wiederherstellungscodes im Format XXXXX-XXXXX */
function erzeugeWiederherstellungscodes(int $anzahl = 10): array
{
    $codes = [];
    for ($i = 0; $i < $anzahl; $i++) {
        $roh = base32Encode(random_bytes(7)); // 56 Bit → 12 Zeichen, 10 genutzt
        $codes[] = substr($roh, 0, 5) . '-' . substr($roh, 5, 5);
    }
    return $codes;
}

function normalisiereWiederherstellungscode(string $code): string
{
    return strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $code) ?? '');
}
