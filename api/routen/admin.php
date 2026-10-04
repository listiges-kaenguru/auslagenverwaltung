<?php
// =============================================
// ADMIN: Benutzerverwaltung & Datenbank-Verbindung
// Schutz vor Aussperren: der letzte aktive Admin kann weder gesperrt, herabgestuft noch gelöscht werden.
// =============================================
declare(strict_types=1);

function benutzerZeileFuerAdmin(array $b): array
{
    return [
        'id'                  => (int)$b['id'],
        'benutzername'        => $b['benutzername'],
        'rolle'               => $b['rolle'],
        'aktiv'               => (bool)$b['aktiv'],
        'mussPasswortAendern' => (bool)$b['muss_passwort_aendern'],
        'name'                => trim($b['vorname'] . ' ' . $b['nachname']),
        'totpAktiv'           => (bool)$b['totp_aktiv'],
        'passkeys'            => (int)$b['passkeys'],
        'auslagen'            => (int)$b['auslagen'],
        'letzterLogin'        => $b['letzter_login'],
    ];
}

function ladeBenutzerOderFehler(int $id): array
{
    $b = abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$id])->fetch();
    if (!$b) throw new ApiFehler('Benutzer nicht gefunden.', 404);
    return $b;
}

/** Wäre nach der Änderung noch mindestens ein aktiver Admin übrig? */
function pruefeLetzterAdmin(int $betroffeneId): void
{
    $andere = (int)abfrage("SELECT COUNT(*) FROM va_benutzer WHERE rolle = 'admin' AND aktiv = 1 AND id <> ?",
        [$betroffeneId])->fetchColumn();
    if ($andere === 0) throw new ApiFehler('Es muss mindestens ein aktiver Administrator bleiben.');
}

route('GET', 'admin/benutzer', function (): void {
    erfordereAdmin();
    $zeilen = abfrage('SELECT b.*,
            (SELECT COUNT(*) FROM va_passkeys p WHERE p.benutzer_id = b.id) AS passkeys,
            (SELECT COUNT(*) FROM va_auslagen a WHERE a.benutzer_id = b.id) AS auslagen
        FROM va_benutzer b ORDER BY b.benutzername')->fetchAll();
    antworte(['benutzer' => array_map('benutzerZeileFuerAdmin', $zeilen)]);
});

route('POST', 'admin/benutzer', function (): void {
    erfordereAdmin();
    $e = eingabe();
    $name = textFeld($e, 'benutzername', 50, true);
    pruefeBenutzername($name);
    $rolle = ($e['rolle'] ?? 'user') === 'admin' ? 'admin' : 'user';
    $startpasswort = erzeugeStartpasswort();
    try {
        abfrage('INSERT INTO va_benutzer (benutzername, passwort_hash, rolle, muss_passwort_aendern, vorname, nachname, webauthn_handle)
            VALUES (?, ?, ?, 1, ?, ?, ?)', [
            $name, password_hash($startpasswort, PASSWORD_DEFAULT), $rolle,
            textFeld($e, 'vorname'), textFeld($e, 'nachname'), base64urlEncode(random_bytes(32)),
        ]);
    } catch (PDOException $ex) {
        if ((int)($ex->errorInfo[1] ?? 0) === 1062) throw new ApiFehler('Diesen Benutzernamen gibt es bereits.');
        throw $ex;
    }
    antworte(['startpasswort' => $startpasswort]);
});

route('PUT', 'admin/benutzer', function (): void {
    $admin = erfordereAdmin();
    $ziel = ladeBenutzerOderFehler((int)($_GET['id'] ?? 0));
    $e = eingabe();

    if (array_key_exists('rolle', $e)) {
        $rolle = $e['rolle'] === 'admin' ? 'admin' : 'user';
        if ($rolle === 'user' && $ziel['rolle'] === 'admin') pruefeLetzterAdmin((int)$ziel['id']);
        abfrage('UPDATE va_benutzer SET rolle = ? WHERE id = ?', [$rolle, $ziel['id']]);
    }
    if (array_key_exists('aktiv', $e)) {
        $aktiv = (bool)$e['aktiv'];
        if (!$aktiv) {
            if ((int)$ziel['id'] === (int)$admin['id']) throw new ApiFehler('Du kannst dich nicht selbst sperren.');
            if ($ziel['rolle'] === 'admin') pruefeLetzterAdmin((int)$ziel['id']);
        }
        // Sperren beendet sofort alle Sitzungen des Benutzers
        abfrage('UPDATE va_benutzer SET aktiv = ?, sitzung_gen = sitzung_gen + ? WHERE id = ?',
            [$aktiv ? 1 : 0, $aktiv ? 0 : 1, $ziel['id']]);
    }
    antworte();
});

route('POST', 'admin/benutzer/passwort', function (): void {
    $admin = erfordereAdmin();
    $ziel = ladeBenutzerOderFehler((int)($_GET['id'] ?? 0));
    if ((int)$ziel['id'] === (int)$admin['id']) throw new ApiFehler('Das eigene Passwort bitte im Profil ändern.');
    $startpasswort = erzeugeStartpasswort();
    abfrage('UPDATE va_benutzer SET passwort_hash = ?, muss_passwort_aendern = 1, sitzung_gen = sitzung_gen + 1 WHERE id = ?',
        [password_hash($startpasswort, PASSWORD_DEFAULT), $ziel['id']]);
    antworte(['startpasswort' => $startpasswort]);
});

route('POST', 'admin/benutzer/mfa-zuruecksetzen', function (): void {
    $admin = erfordereAdmin();
    $ziel = ladeBenutzerOderFehler((int)($_GET['id'] ?? 0));
    if ((int)$ziel['id'] === (int)$admin['id']) throw new ApiFehler('Die eigene Anmeldung bitte im Profil verwalten.');
    abfrage('UPDATE va_benutzer SET totp_geheimnis = NULL, totp_aktiv = 0, totp_letzter_schritt = 0,
        sitzung_gen = sitzung_gen + 1 WHERE id = ?', [$ziel['id']]);
    abfrage('DELETE FROM va_wiederherstellung WHERE benutzer_id = ?', [$ziel['id']]);
    abfrage('DELETE FROM va_passkeys WHERE benutzer_id = ?', [$ziel['id']]);
    antworte();
});

route('POST', 'admin/benutzer/loeschen', function (): void {
    $admin = erfordereAdmin();
    pruefeAktuellesPasswort($admin, eingabe()['passwort'] ?? null);
    $ziel = ladeBenutzerOderFehler((int)($_GET['id'] ?? 0));
    if ((int)$ziel['id'] === (int)$admin['id']) throw new ApiFehler('Du kannst dich nicht selbst löschen.');
    if ($ziel['rolle'] === 'admin') pruefeLetzterAdmin((int)$ziel['id']);
    abfrage('DELETE FROM va_benutzer WHERE id = ?', [$ziel['id']]); // Auslagen, Belege, Passkeys per CASCADE
    antworte();
});

// ---------------------------------------------
// Datenbank-Verbindung
// ---------------------------------------------

/** Eingaben lesen; leeres Passwort = bisheriges Passwort weiterverwenden */
function dbEingabe(array $e): array
{
    $alt = ladeKonfig()['db'] ?? [];
    $db = [
        'host'     => textFeld($e, 'host', 255, true),
        'port'     => (int)($e['port'] ?? 3306),
        'name'     => textFeld($e, 'name', 64, true),
        'benutzer' => textFeld($e, 'benutzer', 100, true),
        'passwort' => (string)($e['passwort'] ?? ''),
    ];
    if ($db['passwort'] === '') $db['passwort'] = (string)($alt['passwort'] ?? '');
    return $db;
}

function istGleicheDb(array $a, array $b): bool
{
    return strtolower($a['host']) === strtolower($b['host']) && (int)$a['port'] === (int)$b['port'] && $a['name'] === $b['name'];
}

route('GET', 'admin/db', function (): void {
    erfordereAdmin();
    $db = ladeKonfig()['db'];
    antworte([
        'db' => ['host' => $db['host'], 'port' => (int)$db['port'], 'name' => $db['name'], 'benutzer' => $db['benutzer']],
        'uebersicht' => dbUebersicht(db()),
        'php' => ['version' => PHP_VERSION, 'postMaxSize' => ini_get('post_max_size'), 'maxBelegBytes' => maxBelegBytes()],
    ]);
});

route('POST', 'admin/db/test', function (): void {
    erfordereAdmin();
    $db = dbEingabe(eingabe());
    $uebersicht = dbUebersicht(verbinde($db));
    antworte(['uebersicht' => $uebersicht, 'gleicheDb' => istGleicheDb($db, ladeKonfig()['db'])]);
});

route('POST', 'admin/db', function (): void {
    $admin = erfordereAdmin();
    $e = eingabe();
    pruefeAktuellesPasswort($admin, $e['adminPasswort'] ?? null);
    $neu = dbEingabe($e);
    $alt = ladeKonfig()['db'];
    $uebernehmen = (bool)($e['uebernehmen'] ?? false);

    $ziel = verbinde($neu);
    migriere($ziel);

    if (istGleicheDb($neu, $alt)) {
        // Nur Zugangsdaten geändert (z. B. neues DB-Passwort)
    } else {
        $vorher = dbUebersicht($ziel);
        if ($uebernehmen) {
            if ($vorher['benutzer'] > 0) throw new ApiFehler('Die Ziel-Datenbank enthält bereits Benutzer – Daten werden nicht überschrieben.');
            kopiereDaten(db(), $ziel);
        } elseif ($vorher['benutzer'] === 0) {
            // Leere Ziel-DB ohne Übernahme: eigenes Admin-Konto mitnehmen, sonst wäre niemand mehr anmeldbar
            $zeile = abfrage('SELECT * FROM va_benutzer WHERE id = ?', [$admin['id']])->fetch();
            $spalten = array_keys($zeile);
            $ziel->prepare(sprintf('INSERT INTO va_benutzer (%s) VALUES (%s)', implode(', ', $spalten),
                implode(', ', array_fill(0, count($spalten), '?'))))->execute(array_values($zeile));
            $pk = $ziel->prepare('INSERT INTO va_passkeys (benutzer_id, credential_id, public_key, sign_count, name, erstellt_am, zuletzt_benutzt)
                VALUES (?, ?, ?, ?, ?, ?, ?)');
            foreach (abfrage('SELECT * FROM va_passkeys WHERE benutzer_id = ?', [$admin['id']])->fetchAll() as $p) {
                $pk->execute([$p['benutzer_id'], $p['credential_id'], $p['public_key'], $p['sign_count'], $p['name'], $p['erstellt_am'], $p['zuletzt_benutzt']]);
            }
        } else {
            // Bestehende VereinsAuslagen-DB: dort muss es ein aktives Admin-Konto mit gleichem Namen geben
            $stmt = $ziel->prepare("SELECT COUNT(*) FROM va_benutzer WHERE benutzername = ? AND rolle = 'admin' AND aktiv = 1");
            $stmt->execute([$admin['benutzername']]);
            if (!(int)$stmt->fetchColumn()) {
                throw new ApiFehler("In der Ziel-Datenbank gibt es kein aktives Admin-Konto „{$admin['benutzername']}“. Wechsel abgebrochen, damit du dich nicht aussperrst.");
            }
        }
    }

    $konfig = ladeKonfig();
    $konfig['db'] = $neu;
    speichereKonfig($konfig);
    $wechsel = !istGleicheDb($neu, $alt);
    if ($wechsel) beendeSitzung(); // Benutzer-IDs können sich unterscheiden → neu anmelden
    antworte(['neuAnmelden' => $wechsel]);
});
