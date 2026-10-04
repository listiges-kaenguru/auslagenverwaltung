<?php
// =============================================
// SITZUNG & BERECHTIGUNGEN
// - PHP-Sitzung mit HttpOnly-/SameSite-Cookie
// - sitzung_gen: wird bei Passwortwechsel, Sperre oder MFA-Reset erhöht → alte Sitzungen enden
// - Brute-Force-Schutz über va_anmeldeversuche
// =============================================
declare(strict_types=1);

const SITZUNG_LEERLAUF_S   = 12 * 3600;  // nach 12 h Inaktivität abmelden
const MFA_ZEITFENSTER_S    = 300;        // 5 Minuten für die Eingabe des zweiten Faktors
const MAX_FEHLVERSUCHE_NAME = 5;         // pro Benutzername in 15 Minuten
const MAX_FEHLVERSUCHE_IP   = 20;        // pro IP in 15 Minuten
const MIN_PASSWORT_LAENGE  = 10;

function starteSitzung(): void
{
    $pfad = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')), '/') . '/';
    session_name('VA_SITZUNG');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => $pfad,
        'secure'   => istHttps(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)SITZUNG_LEERLAUF_S);
    session_start();

    $letzte = $_SESSION['letzte_aktivitaet'] ?? null;
    if ($letzte !== null && time() - $letzte > SITZUNG_LEERLAUF_S) beendeSitzung();
    $_SESSION['letzte_aktivitaet'] = time();
}

function beendeSitzung(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
}

/** Angemeldeten Benutzer laden (null, wenn keiner oder Sitzung ungültig geworden) */
function aktuellerBenutzer(): ?array
{
    static $benutzer = false;
    if ($benutzer !== false) return $benutzer;

    $id = $_SESSION['benutzer_id'] ?? null;
    if (!$id || !istEingerichtet()) return $benutzer = null;

    $zeile = abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$id])->fetch();
    if (!$zeile || !$zeile['aktiv'] || (int)$zeile['sitzung_gen'] !== ($_SESSION['sitzung_gen'] ?? -1)) {
        beendeSitzung();
        return $benutzer = null;
    }
    return $benutzer = $zeile;
}

/** Für normale Funktionen: angemeldet und kein Passwortwechsel ausstehend */
function erfordereLogin(): array
{
    $benutzer = aktuellerBenutzer();
    if (!$benutzer) throw new ApiFehler('Bitte anmelden.', 401);
    if ($benutzer['muss_passwort_aendern']) throw new ApiFehler('Bitte zuerst ein neues Passwort festlegen.', 403);
    return $benutzer;
}

function erfordereAdmin(): array
{
    $benutzer = erfordereLogin();
    if ($benutzer['rolle'] !== 'admin') throw new ApiFehler('Nur für Administratoren.', 403);
    return $benutzer;
}

/** Nach erfolgreicher Prüfung aller Faktoren anmelden */
function meldeAn(array $benutzer): void
{
    session_regenerate_id(true); // Session-Fixation verhindern
    unset($_SESSION['mfa_ausstehend']);
    $_SESSION['benutzer_id'] = (int)$benutzer['id'];
    $_SESSION['sitzung_gen'] = (int)$benutzer['sitzung_gen'];
    $_SESSION['letzte_aktivitaet'] = time();
    abfrage('UPDATE va_benutzer SET letzter_login = UTC_TIMESTAMP() WHERE id = ?', [$benutzer['id']]);
}

/** Aktuelle Sitzung nach eigener Passwortänderung weiterführen (andere Sitzungen enden) */
function erneuereSitzungsGeneration(int $benutzerId): void
{
    abfrage('UPDATE va_benutzer SET sitzung_gen = sitzung_gen + 1 WHERE id = ?', [$benutzerId]);
    $_SESSION['sitzung_gen'] = (int)abfrage('SELECT sitzung_gen FROM va_benutzer WHERE id = ?', [$benutzerId])->fetchColumn();
    session_regenerate_id(true);
}

// ---------------------------------------------
// Passwörter
// ---------------------------------------------
function pruefePasswortRegeln(string $passwort): void
{
    if (mb_strlen($passwort) < MIN_PASSWORT_LAENGE) {
        throw new ApiFehler('Das Passwort muss mindestens ' . MIN_PASSWORT_LAENGE . ' Zeichen lang sein.');
    }
    if (strlen($passwort) > 200) throw new ApiFehler('Das Passwort ist zu lang.');
}

function erzeugeStartpasswort(): string
{
    // Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
    $zeichen = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    $pw = '';
    for ($i = 0; $i < 14; $i++) $pw .= $zeichen[random_int(0, strlen($zeichen) - 1)];
    return $pw;
}

// ---------------------------------------------
// Brute-Force-Schutz
// ---------------------------------------------
/** $benutzername = null (Passkey): nur die IP-Sperre prüfen */
function pruefeAnmeldeSperre(?string $benutzername): void
{
    abfrage('DELETE FROM va_anmeldeversuche WHERE zeit < UTC_TIMESTAMP() - INTERVAL 1 DAY');
    $name = $benutzername === null ? 0 : abfrage("SELECT COUNT(*) FROM va_anmeldeversuche
        WHERE benutzername = ? AND erfolgreich = 0 AND zeit > UTC_TIMESTAMP() - INTERVAL 15 MINUTE", [$benutzername])->fetchColumn();
    $ip = abfrage("SELECT COUNT(*) FROM va_anmeldeversuche
        WHERE ip = ? AND erfolgreich = 0 AND zeit > UTC_TIMESTAMP() - INTERVAL 15 MINUTE", [clientIp()])->fetchColumn();
    if ($name >= MAX_FEHLVERSUCHE_NAME || $ip >= MAX_FEHLVERSUCHE_IP) {
        throw new ApiFehler('Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.', 429);
    }
}

function protokolliereAnmeldung(string $benutzername, bool $erfolgreich): void
{
    abfrage('INSERT INTO va_anmeldeversuche (ip, benutzername, zeit, erfolgreich) VALUES (?, ?, UTC_TIMESTAMP(), ?)',
        [clientIp(), mb_substr($benutzername, 0, 50), $erfolgreich ? 1 : 0]);
}

// ---------------------------------------------
// Darstellung für das Frontend
// ---------------------------------------------
function benutzerFuerClient(array $b): array
{
    $passkeys = abfrage('SELECT id, name, erstellt_am, zuletzt_benutzt FROM va_passkeys WHERE benutzer_id = ? ORDER BY id',
        [$b['id']])->fetchAll();
    $codes = (int)abfrage('SELECT COUNT(*) FROM va_wiederherstellung WHERE benutzer_id = ? AND benutzt_am IS NULL',
        [$b['id']])->fetchColumn();
    return [
        'id'                  => (int)$b['id'],
        'benutzername'        => $b['benutzername'],
        'rolle'               => $b['rolle'],
        'mussPasswortAendern' => (bool)$b['muss_passwort_aendern'],
        'stammdaten'          => [
            'vorname'  => $b['vorname'],
            'nachname' => $b['nachname'],
            'iban'     => $b['iban'],
            'ort'      => $b['ort'],
        ],
        'totpAktiv'           => (bool)$b['totp_aktiv'],
        'wiederherstellungscodes' => $codes,
        'passkeys'            => array_map(fn($p) => [
            'id'             => (int)$p['id'],
            'name'           => $p['name'],
            'erstelltAm'     => $p['erstellt_am'],
            'zuletztBenutzt' => $p['zuletzt_benutzt'],
        ], $passkeys),
    ];
}
