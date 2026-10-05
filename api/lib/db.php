<?php
// =============================================
// DATENBANK (MySQL / MariaDB über PDO)
// Alle Tabellen mit Präfix "va_" → die Datenbank kann mit anderen Anwendungen geteilt werden.
// =============================================
declare(strict_types=1);

const SCHEMA_VERSION = 2;

/** Tabellen in Abhängigkeitsreihenfolge (für Kopieren beim DB-Wechsel) */
const TABELLEN = ['va_benutzer', 'va_wiederherstellung', 'va_passkeys', 'va_einreichungen', 'va_auslagen', 'va_belege'];

/** Neue Verbindung aufbauen; wirft ApiFehler mit verständlicher Meldung */
function verbinde(array $db): PDO
{
    $host = (string)($db['host'] ?? '');
    $port = (int)($db['port'] ?? 3306);
    $name = (string)($db['name'] ?? '');
    if ($host === '' || $name === '') throw new ApiFehler('Host und Datenbankname sind erforderlich.');
    if ($port < 1 || $port > 65535) throw new ApiFehler('Ungültiger Port.');
    if (!preg_match('/^[A-Za-z0-9_$-]{1,64}$/', $name)) throw new ApiFehler('Ungültiger Datenbankname.');

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    try {
        $pdo = new PDO($dsn, (string)($db['benutzer'] ?? ''), (string)($db['passwort'] ?? ''), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5,
        ]);
    } catch (PDOException $e) {
        // Meldung ohne Passwort, aber mit Hinweis auf die Ursache
        $grund = match ((int)$e->getCode()) {
            1045    => 'Benutzername oder Passwort falsch',
            1049    => 'Datenbank existiert nicht',
            2002, 2005 => 'Server nicht erreichbar',
            1044    => 'Keine Berechtigung für diese Datenbank',
            default => 'Fehler ' . $e->getCode(),
        };
        throw new ApiFehler("Keine Verbindung zur Datenbank: {$grund}.");
    }
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

/** Verbindung zur konfigurierten Datenbank (einmal pro Anfrage) */
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $konfig = ladeKonfig();
        if ($konfig === null) throw new ApiFehler('Die Anwendung ist noch nicht eingerichtet.', 503);
        $pdo = verbinde($konfig['db']);
        migriere($pdo); // nach einem Update neue Tabellen/Spalten automatisch anlegen
    }
    return $pdo;
}

function abfrage(string $sql, array $werte = [], ?PDO $pdo = null): PDOStatement
{
    $stmt = ($pdo ?? db())->prepare($sql);
    $stmt->execute($werte);
    return $stmt;
}

/** Tabellen anlegen bzw. auf den aktuellen Stand bringen */
function migriere(PDO $pdo): void
{
    $opt = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    // Schneller Normalfall: Version lesen, ohne DDL auszuführen
    try {
        $version = (int)($pdo->query("SELECT wert FROM va_meta WHERE schluessel = 'schema_version'")->fetchColumn() ?: 0);
    } catch (PDOException) {
        $version = 0; // va_meta fehlt → neue Datenbank
    }
    if ($version >= SCHEMA_VERSION) return;

    $pdo->exec("CREATE TABLE IF NOT EXISTS va_meta (
        schluessel VARCHAR(50) NOT NULL PRIMARY KEY,
        wert VARCHAR(255) NOT NULL
    ) {$opt}");

    if ($version < 1) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS va_benutzer (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            benutzername VARCHAR(50) NOT NULL,
            passwort_hash VARCHAR(255) NOT NULL,
            rolle ENUM('admin','user') NOT NULL DEFAULT 'user',
            aktiv TINYINT(1) NOT NULL DEFAULT 1,
            muss_passwort_aendern TINYINT(1) NOT NULL DEFAULT 0,
            sitzung_gen INT UNSIGNED NOT NULL DEFAULT 1,
            vorname VARCHAR(100) NOT NULL DEFAULT '',
            nachname VARCHAR(100) NOT NULL DEFAULT '',
            iban VARCHAR(34) NOT NULL DEFAULT '',
            ort VARCHAR(100) NOT NULL DEFAULT '',
            totp_geheimnis VARCHAR(255) NULL,
            totp_aktiv TINYINT(1) NOT NULL DEFAULT 0,
            totp_letzter_schritt BIGINT NOT NULL DEFAULT 0,
            webauthn_handle VARCHAR(64) NOT NULL,
            erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            letzter_login DATETIME NULL,
            UNIQUE KEY uk_benutzername (benutzername),
            UNIQUE KEY uk_webauthn_handle (webauthn_handle)
        ) {$opt}");

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_wiederherstellung (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            benutzer_id INT UNSIGNED NOT NULL,
            code_hash VARCHAR(255) NOT NULL,
            benutzt_am DATETIME NULL,
            CONSTRAINT fk_wh_benutzer FOREIGN KEY (benutzer_id) REFERENCES va_benutzer(id) ON DELETE CASCADE
        ) {$opt}");

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_passkeys (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            benutzer_id INT UNSIGNED NOT NULL,
            credential_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            public_key TEXT NOT NULL,
            sign_count INT UNSIGNED NOT NULL DEFAULT 0,
            name VARCHAR(100) NOT NULL DEFAULT '',
            erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            zuletzt_benutzt DATETIME NULL,
            UNIQUE KEY uk_credential (credential_id),
            CONSTRAINT fk_pk_benutzer FOREIGN KEY (benutzer_id) REFERENCES va_benutzer(id) ON DELETE CASCADE
        ) {$opt}");

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_auslagen (
            id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
            benutzer_id INT UNSIGNED NOT NULL,
            datum DATE NOT NULL,
            haendler VARCHAR(100) NOT NULL,
            betrag DECIMAL(12,2) NOT NULL,
            notiz VARCHAR(500) NOT NULL DEFAULT '',
            status ENUM('offen','eingereicht','erstattet') NOT NULL DEFAULT 'offen',
            hat_beleg TINYINT(1) NOT NULL DEFAULT 0,
            erstellt_am DATETIME(3) NOT NULL,
            geaendert_am DATETIME(3) NOT NULL,
            KEY ix_benutzer_status (benutzer_id, status),
            CONSTRAINT fk_ausl_benutzer FOREIGN KEY (benutzer_id) REFERENCES va_benutzer(id) ON DELETE CASCADE
        ) {$opt}");

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_belege (
            auslage_id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
            typ VARCHAR(100) NOT NULL,
            groesse INT UNSIGNED NOT NULL,
            daten LONGBLOB NOT NULL,
            CONSTRAINT fk_beleg_auslage FOREIGN KEY (auslage_id) REFERENCES va_auslagen(id) ON DELETE CASCADE
        ) {$opt}");

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_anmeldeversuche (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            ip VARCHAR(45) NOT NULL,
            benutzername VARCHAR(50) NOT NULL,
            zeit DATETIME NOT NULL,
            erfolgreich TINYINT(1) NOT NULL,
            KEY ix_zeit (zeit),
            KEY ix_ip (ip, zeit),
            KEY ix_name (benutzername, zeit)
        ) {$opt}");
    }

    if ($version < 2) {
        // Kassenrollen, Zwischenstatus „Erstattung veranlasst“ und Einreichungen als Datensatz.
        // DDL ist nicht transaktional → jeder Schritt prüft, ob er schon erledigt ist.
        if (!spalteVorhanden($pdo, 'va_benutzer', 'kassenrolle')) {
            $pdo->exec("ALTER TABLE va_benutzer
                ADD COLUMN kassenrolle ENUM('keine','kassenwart','vorstand') NOT NULL DEFAULT 'keine' AFTER rolle");
        }

        $pdo->exec("CREATE TABLE IF NOT EXISTS va_einreichungen (
            id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
            benutzer_id INT UNSIGNED NOT NULL,
            erstellt_am DATETIME(3) NOT NULL,
            KEY ix_benutzer (benutzer_id),
            CONSTRAINT fk_einr_benutzer FOREIGN KEY (benutzer_id) REFERENCES va_benutzer(id) ON DELETE CASCADE
        ) {$opt}");

        $pdo->exec("ALTER TABLE va_auslagen
            MODIFY status ENUM('offen','eingereicht','veranlasst','erstattet') NOT NULL DEFAULT 'offen'");
        if (!spalteVorhanden($pdo, 'va_auslagen', 'einreichung_id')) {
            $pdo->exec("ALTER TABLE va_auslagen
                ADD COLUMN einreichung_id CHAR(36) CHARACTER SET ascii NULL AFTER status,
                ADD COLUMN veranlasst_am DATETIME(3) NULL AFTER einreichung_id,
                ADD COLUMN veranlasst_von INT UNSIGNED NULL AFTER veranlasst_am,
                ADD KEY ix_status (status),
                ADD CONSTRAINT fk_ausl_einreichung FOREIGN KEY (einreichung_id) REFERENCES va_einreichungen(id) ON DELETE SET NULL,
                ADD CONSTRAINT fk_ausl_veranlasst FOREIGN KEY (veranlasst_von) REFERENCES va_benutzer(id) ON DELETE SET NULL");
        }
    }

    $stmt = $pdo->prepare("INSERT INTO va_meta (schluessel, wert) VALUES ('schema_version', ?)
        ON DUPLICATE KEY UPDATE wert = VALUES(wert)");
    $stmt->execute([(string)SCHEMA_VERSION]);
}

function spalteVorhanden(PDO $pdo, string $tabelle, string $spalte): bool
{
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $stmt->execute([$tabelle, $spalte]);
    return (bool)$stmt->fetchColumn();
}

/** Übersicht über eine (Ziel-)Datenbank für den Admin-Dialog */
function dbUebersicht(PDO $pdo): array
{
    $version = (string)$pdo->query('SELECT VERSION()')->fetchColumn();
    $hatTabellen = (bool)$pdo->query("SHOW TABLES LIKE 'va_benutzer'")->fetchColumn();
    $benutzer = $hatTabellen ? (int)$pdo->query('SELECT COUNT(*) FROM va_benutzer')->fetchColumn() : 0;
    $auslagen = $hatTabellen ? (int)$pdo->query('SELECT COUNT(*) FROM va_auslagen')->fetchColumn() : 0;
    $paket = (int)$pdo->query('SELECT @@max_allowed_packet')->fetchColumn();
    return [
        'serverVersion'    => $version,
        'hatTabellen'      => $hatTabellen,
        'benutzer'         => $benutzer,
        'auslagen'         => $auslagen,
        'maxAllowedPacket' => $paket,
    ];
}

/** Alle Daten von $quelle nach $ziel kopieren (Ziel muss leer sein) */
function kopiereDaten(PDO $quelle, PDO $ziel): void
{
    $ziel->beginTransaction();
    try {
        foreach (TABELLEN as $tabelle) {
            if ($tabelle === 'va_belege') {
                // Belege einzeln laden → kein riesiger Speicherbedarf
                $ids = $quelle->query('SELECT auslage_id FROM va_belege')->fetchAll(PDO::FETCH_COLUMN);
                $lesen = $quelle->prepare('SELECT * FROM va_belege WHERE auslage_id = ?');
                $schreiben = $ziel->prepare('INSERT INTO va_belege (auslage_id, typ, groesse, daten) VALUES (?, ?, ?, ?)');
                foreach ($ids as $id) {
                    $lesen->execute([$id]);
                    $z = $lesen->fetch();
                    $schreiben->bindValue(1, $z['auslage_id']);
                    $schreiben->bindValue(2, $z['typ']);
                    $schreiben->bindValue(3, (int)$z['groesse'], PDO::PARAM_INT);
                    $schreiben->bindValue(4, $z['daten'], PDO::PARAM_LOB);
                    $schreiben->execute();
                }
                continue;
            }
            $zeilen = $quelle->query("SELECT * FROM {$tabelle}")->fetchAll();
            if (!$zeilen) continue;
            $spalten = array_keys($zeilen[0]);
            $sql = sprintf('INSERT INTO %s (%s) VALUES (%s)', $tabelle,
                implode(', ', $spalten), implode(', ', array_fill(0, count($spalten), '?')));
            $stmt = $ziel->prepare($sql);
            foreach ($zeilen as $z) $stmt->execute(array_values($z));
        }
        $ziel->commit();
    } catch (Throwable $e) {
        $ziel->rollBack();
        throw new ApiFehler('Kopieren der Daten fehlgeschlagen: ' . $e->getMessage(), 500);
    }
}
