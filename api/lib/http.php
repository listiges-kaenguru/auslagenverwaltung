<?php
// =============================================
// HTTP-Hilfen: JSON-Antworten, Eingaben, Fehler
// =============================================
declare(strict_types=1);

/** Fachlicher Fehler mit HTTP-Status – Text wird dem Nutzer angezeigt */
final class ApiFehler extends RuntimeException
{
    public function __construct(string $text, public readonly int $status = 400)
    {
        parent::__construct($text);
    }
}

function antworte(array $daten = [], int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true] + $daten, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function antworteFehler(string $text, int $status): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'fehler' => $text], JSON_UNESCAPED_UNICODE);
    exit;
}

/** JSON-Body der Anfrage (leeres Array, wenn keiner) */
function eingabe(): array
{
    static $daten = null;
    if ($daten === null) {
        $roh = file_get_contents('php://input') ?: '';
        if ($roh === '') {
            $daten = [];
        } else {
            $daten = json_decode($roh, true);
            if (!is_array($daten)) throw new ApiFehler('Ungültige Anfrage (JSON erwartet).');
        }
    }
    return $daten;
}

/** Textfeld aus der Eingabe, getrimmt und auf Länge begrenzt */
function textFeld(array $daten, string $name, int $maxLaenge = 100, bool $pflicht = false): string
{
    $wert = $daten[$name] ?? '';
    if (!is_string($wert) && !is_int($wert) && !is_float($wert)) throw new ApiFehler("Feld „{$name}“ ist ungültig.");
    $wert = trim((string)$wert);
    if ($pflicht && $wert === '') throw new ApiFehler("Feld „{$name}“ fehlt.");
    if (mb_strlen($wert) > $maxLaenge) throw new ApiFehler("Feld „{$name}“ ist zu lang (max. {$maxLaenge} Zeichen).");
    return $wert;
}

function istHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443')
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

/** Host ohne Port, z. B. "verein.example.org" */
function hostName(): string
{
    $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
    return preg_replace('/:\d+$/', '', $host) ?? $host;
}

/** Erwarteter Origin, z. B. "https://verein.example.org" */
function eigenerOrigin(): string
{
    return (istHttps() ? 'https' : 'http') . '://' . strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
}

function clientIp(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

function base64urlEncode(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function base64urlDecode(string $text): string
{
    $bin = base64_decode(strtr($text, '-_', '+/'), true);
    if ($bin === false) throw new ApiFehler('Ungültige Kodierung.');
    return $bin;
}

/** ini-Größe wie "8M" in Bytes */
function iniBytes(string $wert): int
{
    $wert = trim($wert);
    if ($wert === '' || $wert === '-1') return PHP_INT_MAX;
    $zahl = (int)$wert;
    return match (strtolower(substr($wert, -1))) {
        'g' => $zahl * 1024 ** 3,
        'm' => $zahl * 1024 ** 2,
        'k' => $zahl * 1024,
        default => $zahl,
    };
}
