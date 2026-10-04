// =============================================
// PASSKEYS im Browser (WebAuthn)
// Wandelt die JSON-Optionen des Servers (base64url) in ArrayBuffer um und zurück.
// =============================================

function b64uZuBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (z) => z.charCodeAt(0));
}

function bytesZuB64u(puffer) {
  const bytes = new Uint8Array(puffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Browserfehler in verständliche Meldungen übersetzen */
function uebersetzeFehler(err, vorgang) {
  switch (err?.name) {
    case 'NotAllowedError':   return new Error(`${vorgang} abgebrochen oder Zeit abgelaufen.`);
    case 'InvalidStateError': return new Error('Dieser Passkey ist auf diesem Gerät bereits registriert.');
    case 'SecurityError':     return new Error('Passkeys sind nur über HTTPS mit gültiger Domain möglich.');
    case 'NotSupportedError': return new Error('Dieses Gerät unterstützt keine passenden Passkeys.');
    default:                  return err instanceof Error ? err : new Error(String(err));
  }
}

/** Neuen Passkey erstellen → Daten für den Server */
export async function erstellePasskey(optionen) {
  const publicKey = {
    ...optionen,
    challenge: b64uZuBytes(optionen.challenge),
    user: { ...optionen.user, id: b64uZuBytes(optionen.user.id) },
    excludeCredentials: (optionen.excludeCredentials || []).map((c) => ({ ...c, id: b64uZuBytes(c.id) }))
  };
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey });
  } catch (err) {
    throw uebersetzeFehler(err, 'Einrichtung');
  }
  return {
    id: cred.id,
    response: {
      clientDataJSON:    bytesZuB64u(cred.response.clientDataJSON),
      attestationObject: bytesZuB64u(cred.response.attestationObject)
    }
  };
}

/** Mit Passkey anmelden → Daten für den Server */
export async function passkeyAssertion(optionen) {
  const publicKey = {
    ...optionen,
    challenge: b64uZuBytes(optionen.challenge),
    allowCredentials: (optionen.allowCredentials || []).map((c) => ({ ...c, id: b64uZuBytes(c.id) }))
  };
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey });
  } catch (err) {
    throw uebersetzeFehler(err, 'Anmeldung');
  }
  return {
    id: cred.id,
    response: {
      clientDataJSON:    bytesZuB64u(cred.response.clientDataJSON),
      authenticatorData: bytesZuB64u(cred.response.authenticatorData),
      signature:         bytesZuB64u(cred.response.signature),
      userHandle:        cred.response.userHandle ? bytesZuB64u(cred.response.userHandle) : null
    }
  };
}

/** Vorschlag für den Namen eines neuen Passkeys */
export function geraeteName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android-Gerät';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows-PC';
  if (/Linux/.test(ua)) return 'Linux-PC';
  return 'Passkey';
}
