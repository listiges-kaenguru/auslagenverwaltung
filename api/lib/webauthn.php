<?php
// =============================================
// PASSKEYS (WebAuthn Level 2) – ohne externe Bibliotheken
// - Attestation "none": der Schlüssel wird ohne Herstellernachweis akzeptiert (üblich für Web-Apps)
// - Unterstützte Algorithmen: ES256 (-7) und RS256 (-257) – deckt alle gängigen Passkeys ab
// - Signaturprüfung über OpenSSL
// =============================================
declare(strict_types=1);

// ---------------------------------------------
// Minimaler CBOR-Decoder (RFC 8949) – genug für attestationObject und COSE-Schlüssel
// ---------------------------------------------
final class Cbor
{
    private int $pos = 0;

    private function __construct(private readonly string $daten) {}

    /** Dekodiert ein Element; $gelesen erhält die Anzahl verbrauchter Bytes */
    public static function dekodiere(string $daten, ?int &$gelesen = null): mixed
    {
        $cbor = new self($daten);
        $wert = $cbor->element();
        $gelesen = $cbor->pos;
        return $wert;
    }

    private function bytes(int $n): string
    {
        if ($n < 0 || $this->pos + $n > strlen($this->daten)) throw new ApiFehler('Passkey-Daten sind unvollständig.');
        $teil = substr($this->daten, $this->pos, $n);
        $this->pos += $n;
        return $teil;
    }

    private function laenge(int $info): int
    {
        return match (true) {
            $info < 24  => $info,
            $info === 24 => ord($this->bytes(1)),
            $info === 25 => unpack('n', $this->bytes(2))[1],
            $info === 26 => unpack('N', $this->bytes(4))[1],
            $info === 27 => unpack('J', $this->bytes(8))[1],
            default      => throw new ApiFehler('Passkey-Daten: nicht unterstütztes CBOR-Format.'),
        };
    }

    private function element(): mixed
    {
        $kopf = ord($this->bytes(1));
        $typ = $kopf >> 5;
        $info = $kopf & 0x1f;
        switch ($typ) {
            case 0: return $this->laenge($info);
            case 1: return -1 - $this->laenge($info);
            case 2: return $this->bytes($this->laenge($info));
            case 3: return $this->bytes($this->laenge($info));
            case 4:
                $liste = [];
                for ($i = $this->laenge($info); $i > 0; $i--) $liste[] = $this->element();
                return $liste;
            case 5:
                $map = [];
                for ($i = $this->laenge($info); $i > 0; $i--) {
                    $schluessel = $this->element();
                    $map[is_int($schluessel) ? $schluessel : (string)$schluessel] = $this->element();
                }
                return $map;
            case 7:
                return match ($info) {
                    20 => false, 21 => true, 22 => null,
                    default => throw new ApiFehler('Passkey-Daten: nicht unterstützter CBOR-Wert.'),
                };
            default:
                throw new ApiFehler('Passkey-Daten: nicht unterstützter CBOR-Typ.');
        }
    }
}

// ---------------------------------------------
// COSE-Schlüssel → PEM (für openssl_verify)
// ---------------------------------------------
function derLaenge(int $n): string
{
    if ($n < 0x80) return chr($n);
    $bytes = ltrim(pack('N', $n), "\0");
    return chr(0x80 | strlen($bytes)) . $bytes;
}

function derElement(int $tag, string $inhalt): string
{
    return chr($tag) . derLaenge(strlen($inhalt)) . $inhalt;
}

function derGanzzahl(string $bytes): string
{
    $bytes = ltrim($bytes, "\0");
    if ($bytes === '' || (ord($bytes[0]) & 0x80)) $bytes = "\0" . $bytes;
    return derElement(0x02, $bytes);
}

function coseZuPem(array $cose): array
{
    $kty = $cose[1] ?? null;
    $alg = $cose[3] ?? null;
    if ($kty === 2 && $alg === -7) { // EC2, P-256, ES256
        if (($cose[-1] ?? null) !== 1 || strlen($cose[-2] ?? '') !== 32 || strlen($cose[-3] ?? '') !== 32) {
            throw new ApiFehler('Passkey: ungültiger EC-Schlüssel.');
        }
        $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . "\x04" . $cose[-2] . $cose[-3];
    } elseif ($kty === 3 && $alg === -257) { // RSA, RS256
        $n = $cose[-1] ?? '';
        $e = $cose[-2] ?? '';
        if (strlen($n) < 256 || $e === '') throw new ApiFehler('Passkey: ungültiger RSA-Schlüssel.');
        $rsaSchluessel = derElement(0x30, derGanzzahl($n) . derGanzzahl($e));
        $algId = derElement(0x30, derElement(0x06, hex2bin('2a864886f70d010101')) . "\x05\x00");
        $der = derElement(0x30, $algId . derElement(0x03, "\x00" . $rsaSchluessel));
    } else {
        throw new ApiFehler('Passkey: Algorithmus wird nicht unterstützt.');
    }
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    return ['pem' => $pem, 'alg' => $alg];
}

// ---------------------------------------------
// Gemeinsame Prüfungen
// ---------------------------------------------
function rpId(): string
{
    return hostName();
}

function pruefeClientData(string $clientDataJson, string $typ, string $challenge): void
{
    $daten = json_decode($clientDataJson, true);
    if (!is_array($daten)) throw new ApiFehler('Passkey: ungültige Client-Daten.');
    if (($daten['type'] ?? '') !== $typ) throw new ApiFehler('Passkey: falscher Vorgang.');
    if (!hash_equals($challenge, (string)($daten['challenge'] ?? ''))) {
        throw new ApiFehler('Passkey: Anfrage abgelaufen – bitte erneut versuchen.');
    }
    if (($daten['origin'] ?? '') !== eigenerOrigin()) throw new ApiFehler('Passkey: falsche Herkunft (Origin).');
}

/** authenticatorData zerlegen und rpIdHash/Flags prüfen */
function zerlegeAuthData(string $authData, bool $uvPflicht): array
{
    if (strlen($authData) < 37) throw new ApiFehler('Passkey: Authenticator-Daten zu kurz.');
    if (!hash_equals(hash('sha256', rpId(), true), substr($authData, 0, 32))) {
        throw new ApiFehler('Passkey: gehört zu einer anderen Domain.');
    }
    $flags = ord($authData[32]);
    if (!($flags & 0x01)) throw new ApiFehler('Passkey: Benutzeranwesenheit nicht bestätigt.');
    if ($uvPflicht && !($flags & 0x04)) throw new ApiFehler('Passkey: Benutzer nicht verifiziert (PIN/Biometrie erforderlich).');
    return [
        'flags'     => $flags,
        'signCount' => unpack('N', substr($authData, 33, 4))[1],
        'rest'      => substr($authData, 37),
    ];
}

// ---------------------------------------------
// Registrierung
// ---------------------------------------------
function passkeyRegistrierungsOptionen(array $benutzer, array $vorhandeneIds): array
{
    $challenge = base64urlEncode(random_bytes(32));
    $_SESSION['webauthn_reg'] = ['challenge' => $challenge, 'zeit' => time()];
    $anzeige = trim($benutzer['vorname'] . ' ' . $benutzer['nachname']) ?: $benutzer['benutzername'];
    return [
        'challenge' => $challenge,
        'rp'        => ['name' => 'VereinsAuslagen', 'id' => rpId()],
        'user'      => [
            'id'          => $benutzer['webauthn_handle'],
            'name'        => $benutzer['benutzername'],
            'displayName' => $anzeige,
        ],
        'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -257]],
        'timeout'          => 120000,
        'attestation'      => 'none',
        'authenticatorSelection' => ['residentKey' => 'required', 'requireResidentKey' => true, 'userVerification' => 'required'],
        'excludeCredentials' => array_map(fn($id) => ['type' => 'public-key', 'id' => $id], $vorhandeneIds),
    ];
}

/** Antwort von navigator.credentials.create() prüfen → Daten zum Speichern */
function pruefePasskeyRegistrierung(array $antwort): array
{
    $vorgang = $_SESSION['webauthn_reg'] ?? null;
    unset($_SESSION['webauthn_reg']);
    if (!$vorgang || time() - $vorgang['zeit'] > 300) throw new ApiFehler('Passkey: Anfrage abgelaufen – bitte erneut versuchen.');

    $clientData = base64urlDecode((string)($antwort['response']['clientDataJSON'] ?? ''));
    pruefeClientData($clientData, 'webauthn.create', $vorgang['challenge']);

    $attestation = Cbor::dekodiere(base64urlDecode((string)($antwort['response']['attestationObject'] ?? '')));
    if (!is_array($attestation) || !isset($attestation['authData'])) throw new ApiFehler('Passkey: ungültige Attestierung.');

    $auth = zerlegeAuthData($attestation['authData'], true);
    if (!($auth['flags'] & 0x40)) throw new ApiFehler('Passkey: keine Schlüsseldaten enthalten.');

    $rest = $auth['rest'];
    if (strlen($rest) < 18) throw new ApiFehler('Passkey: Schlüsseldaten unvollständig.');
    $idLaenge = unpack('n', substr($rest, 16, 2))[1];
    $credentialId = substr($rest, 18, $idLaenge);
    if (strlen($credentialId) !== $idLaenge || $idLaenge === 0 || $idLaenge > 1023) throw new ApiFehler('Passkey: ungültige Kennung.');
    $cose = Cbor::dekodiere(substr($rest, 18 + $idLaenge));
    if (!is_array($cose)) throw new ApiFehler('Passkey: ungültiger Schlüssel.');

    $idText = base64urlEncode($credentialId);
    if (isset($antwort['id']) && $antwort['id'] !== $idText) throw new ApiFehler('Passkey: Kennung passt nicht.');
    if (strlen($idText) > 255) throw new ApiFehler('Passkey: Kennung zu lang.');

    return [
        'credential_id' => $idText,
        'public_key'    => coseZuPem($cose)['pem'],
        'sign_count'    => $auth['signCount'],
    ];
}

// ---------------------------------------------
// Anmeldung
// ---------------------------------------------
function passkeyAnmeldeOptionen(): array
{
    $challenge = base64urlEncode(random_bytes(32));
    $_SESSION['webauthn_login'] = ['challenge' => $challenge, 'zeit' => time()];
    return [
        'challenge'        => $challenge,
        'rpId'             => rpId(),
        'timeout'          => 120000,
        'userVerification' => 'required',
        'allowCredentials' => [], // Passkeys sind auffindbar → Browser zeigt passende Konten
    ];
}

/** Antwort von navigator.credentials.get() prüfen → Passkey-Datensatz (inkl. neuem signCount) */
function pruefePasskeyAnmeldung(array $antwort): array
{
    $vorgang = $_SESSION['webauthn_login'] ?? null;
    unset($_SESSION['webauthn_login']);
    if (!$vorgang || time() - $vorgang['zeit'] > 300) throw new ApiFehler('Passkey: Anfrage abgelaufen – bitte erneut versuchen.');

    $idText = (string)($antwort['id'] ?? '');
    $passkey = abfrage('SELECT * FROM va_passkeys WHERE credential_id = ?', [$idText])->fetch();
    if (!$passkey) throw new ApiFehler('Dieser Passkey ist hier nicht (mehr) registriert.', 401);

    $clientData = base64urlDecode((string)($antwort['response']['clientDataJSON'] ?? ''));
    pruefeClientData($clientData, 'webauthn.get', $vorgang['challenge']);

    $authData = base64urlDecode((string)($antwort['response']['authenticatorData'] ?? ''));
    $auth = zerlegeAuthData($authData, true);

    $signatur = base64urlDecode((string)($antwort['response']['signature'] ?? ''));
    $gueltig = openssl_verify($authData . hash('sha256', $clientData, true), $signatur, $passkey['public_key'], OPENSSL_ALGO_SHA256);
    if ($gueltig !== 1) throw new ApiFehler('Passkey: Signatur ungültig.', 401);

    $handle = $antwort['response']['userHandle'] ?? null;
    if ($handle) {
        $besitzer = abfrage('SELECT webauthn_handle FROM va_benutzer WHERE id = ?', [$passkey['benutzer_id']])->fetchColumn();
        if (!hash_equals((string)$besitzer, (string)$handle)) throw new ApiFehler('Passkey: gehört zu einem anderen Konto.', 401);
    }

    // Zähler: Geräte ohne Zähler melden immer 0; ein Rückschritt deutet auf einen geklonten Schlüssel
    $alt = (int)$passkey['sign_count'];
    if ($auth['signCount'] !== 0 && $auth['signCount'] <= $alt) throw new ApiFehler('Passkey: Zähler ungültig (möglicherweise kopiert).', 401);
    $passkey['sign_count'] = $auth['signCount'];
    return $passkey;
}
