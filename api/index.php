<?php
// =============================================
// VereinsAuslagen – API (Einstiegspunkt)
// Aufruf: api/?r=<route>, z. B. api/?r=auth/login
// Antworten: JSON {ok: true, …} bzw. {ok: false, fehler: "…"}; Belege als Binärdaten.
// =============================================
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/konfig.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/sitzung.php';
require __DIR__ . '/lib/totp.php';
require __DIR__ . '/lib/webauthn.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox");

/** @var array<string, callable> */
$ROUTEN = [];
function route(string $methode, string $pfad, callable $handler): void
{
    global $ROUTEN;
    $ROUTEN["{$methode} {$pfad}"] = $handler;
}

require __DIR__ . '/routen/einrichtung.php';
require __DIR__ . '/routen/anmeldung.php';
require __DIR__ . '/routen/profil.php';
require __DIR__ . '/routen/auslagen.php';
require __DIR__ . '/routen/einreichungen.php';
require __DIR__ . '/routen/kommentare.php';
require __DIR__ . '/routen/kasse.php';
require __DIR__ . '/routen/admin.php';

try {
    $methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $pfad = trim((string)($_GET['r'] ?? ''), '/');

    // CSRF-Schutz: Änderungen nur mit eigenem Header (erzwingt Same-Origin) und passendem Origin
    if ($methode !== 'GET') {
        if (($_SERVER['HTTP_X_VA_ANFRAGE'] ?? '') !== '1') throw new ApiFehler('Ungültige Anfrage.', 403);
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && $origin !== eigenerOrigin()) throw new ApiFehler('Ungültige Herkunft.', 403);
    }

    $handler = $ROUTEN["{$methode} {$pfad}"] ?? null;
    if (!$handler) throw new ApiFehler('Unbekannte Funktion.', 404);

    starteSitzung();
    $handler();
    antworte();
} catch (ApiFehler $e) {
    antworteFehler($e->getMessage(), $e->status);
} catch (Throwable $e) {
    error_log('[VereinsAuslagen] ' . $e);
    antworteFehler('Interner Fehler. Details stehen im Fehlerprotokoll des Servers.', 500);
}
