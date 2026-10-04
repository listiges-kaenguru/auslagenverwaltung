<?php
// =============================================
// ANMELDUNG: Passwort (+ TOTP), Passkey, Abmelden
// =============================================
declare(strict_types=1);

// Wird geprüft, wenn der Benutzer nicht existiert → gleiche Antwortzeit wie bei falschem Passwort
const DUMMY_HASH = '$2y$10$rm3OtAY8CpWpxw/Xaf6yr.pZvu.RDNCUraj.c9EvZbv55iojxb6nS';

route('POST', 'anmeldung/passwort', function (): void {
    $e = eingabe();
    $name = textFeld($e, 'benutzername', 50, true);
    $passwort = (string)($e['passwort'] ?? '');
    pruefeAnmeldeSperre($name);

    $benutzer = abfrage('SELECT * FROM va_benutzer WHERE benutzername = ?', [$name])->fetch();
    $passt = password_verify($passwort, $benutzer['passwort_hash'] ?? DUMMY_HASH);
    if (!$benutzer || !$passt || !$benutzer['aktiv']) {
        protokolliereAnmeldung($name, false);
        throw new ApiFehler('Benutzername oder Passwort falsch.', 401);
    }

    if (password_needs_rehash($benutzer['passwort_hash'], PASSWORD_DEFAULT)) {
        abfrage('UPDATE va_benutzer SET passwort_hash = ? WHERE id = ?', [password_hash($passwort, PASSWORD_DEFAULT), $benutzer['id']]);
    }

    if ($benutzer['totp_aktiv']) {
        session_regenerate_id(true);
        $_SESSION['mfa_ausstehend'] = ['id' => (int)$benutzer['id'], 'zeit' => time(), 'versuche' => 0];
        antworte(['mfa' => true]);
    }

    protokolliereAnmeldung($name, true);
    meldeAn($benutzer);
    antworte(['benutzer' => benutzerFuerClient($benutzer)]);
});

route('POST', 'anmeldung/mfa', function (): void {
    $ausstehend = $_SESSION['mfa_ausstehend'] ?? null;
    if (!$ausstehend || time() - $ausstehend['zeit'] > MFA_ZEITFENSTER_S) {
        unset($_SESSION['mfa_ausstehend']);
        throw new ApiFehler('Zeit abgelaufen – bitte erneut mit Passwort anmelden.', 401);
    }
    $benutzer = abfrage('SELECT * FROM va_benutzer WHERE id = ? AND aktiv = 1', [$ausstehend['id']])->fetch();
    if (!$benutzer) throw new ApiFehler('Konto nicht verfügbar.', 401);

    $code = textFeld(eingabe(), 'code', 20, true);
    $erfolg = false;

    if (preg_match('/^\d{6}$/', preg_replace('/\s/', '', $code) ?? '')) {
        $schritt = pruefeTotp(base32Decode(entschluessele((string)$benutzer['totp_geheimnis'])), $code, (int)$benutzer['totp_letzter_schritt']);
        if ($schritt !== null) {
            abfrage('UPDATE va_benutzer SET totp_letzter_schritt = ? WHERE id = ?', [$schritt, $benutzer['id']]);
            $erfolg = true;
        }
    } else {
        // Wiederherstellungscode (einmalig verwendbar)
        $normal = normalisiereWiederherstellungscode($code);
        $offene = abfrage('SELECT id, code_hash FROM va_wiederherstellung WHERE benutzer_id = ? AND benutzt_am IS NULL',
            [$benutzer['id']])->fetchAll();
        foreach ($offene as $eintrag) {
            if (password_verify($normal, $eintrag['code_hash'])) {
                abfrage('UPDATE va_wiederherstellung SET benutzt_am = UTC_TIMESTAMP() WHERE id = ?', [$eintrag['id']]);
                $erfolg = true;
                break;
            }
        }
    }

    if (!$erfolg) {
        protokolliereAnmeldung($benutzer['benutzername'], false);
        $_SESSION['mfa_ausstehend']['versuche']++;
        if ($_SESSION['mfa_ausstehend']['versuche'] >= 5) {
            unset($_SESSION['mfa_ausstehend']);
            throw new ApiFehler('Zu viele falsche Codes – bitte erneut mit Passwort anmelden.', 401);
        }
        throw new ApiFehler('Code ist falsch oder bereits verwendet.', 401);
    }

    protokolliereAnmeldung($benutzer['benutzername'], true);
    meldeAn($benutzer);
    antworte(['benutzer' => benutzerFuerClient($benutzer)]);
});

route('POST', 'anmeldung/passkey-optionen', function (): void {
    if (!istEingerichtet()) throw new ApiFehler('Die Anwendung ist noch nicht eingerichtet.', 503);
    antworte(['optionen' => passkeyAnmeldeOptionen()]);
});

route('POST', 'anmeldung/passkey', function (): void {
    pruefeAnmeldeSperre(null);
    try {
        $passkey = pruefePasskeyAnmeldung(eingabe());
    } catch (ApiFehler $e) {
        protokolliereAnmeldung('', false); // zählt nur für die IP-Sperre
        throw $e;
    }
    $benutzer = abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$passkey['benutzer_id']])->fetch();
    if (!$benutzer || !$benutzer['aktiv']) throw new ApiFehler('Dieses Konto ist gesperrt.', 401);

    abfrage('UPDATE va_passkeys SET sign_count = ?, zuletzt_benutzt = UTC_TIMESTAMP() WHERE id = ?',
        [$passkey['sign_count'], $passkey['id']]);
    protokolliereAnmeldung($benutzer['benutzername'], true);
    // Ein Passkey mit Benutzerverifizierung (PIN/Biometrie) ist bereits ein zweiter Faktor → kein TOTP
    meldeAn($benutzer);
    antworte(['benutzer' => benutzerFuerClient($benutzer)]);
});

route('POST', 'abmeldung', function (): void {
    beendeSitzung();
    antworte();
});
