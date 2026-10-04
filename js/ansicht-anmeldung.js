// =============================================
// VOR DER ANMELDUNG: Einrichtung, Anmeldung, zweiter Faktor, Pflicht-Passwortwechsel
// Nach Erfolg wird „angemeldet“ ausgelöst; main.js lädt dann die Daten und zeigt die App.
// =============================================
import { escapeHtml, zeigeToast, mitLadezustand, registriereAktionen } from './hilfen.js';
import { apiPost } from './api.js';
import { ladeStatus, serverStatus, setzeBenutzer, meldeAb, passkeysMoeglich } from './sitzung.js';
import { passkeyAssertion } from './webauthn.js';

const MIN_PASSWORT = 10;

/** Welche Seite gerade zu zeigen ist */
export function anmeldeSchritt() {
  const s = serverStatus();
  if (!s.eingerichtet) return 'einrichtung';
  if (!s.benutzer) return s.mfaAusstehend ? 'mfa' : 'anmeldung';
  if (s.benutzer.mussPasswortAendern) return 'passwort-zwang';
  return null;
}

export function rendereAnmeldeSchritt(container) {
  const html = {
    einrichtung:      einrichtungHtml,
    anmeldung:        anmeldungHtml,
    mfa:              mfaHtml,
    'passwort-zwang': passwortZwangHtml
  }[anmeldeSchritt()];
  container.innerHTML = `<div class="ansicht anmelde-ansicht">${html()}</div>`;
  container.querySelector('[autofocus]')?.focus();
}

function feld(name, label, typ = 'text', attribute = '') {
  return `
    <div>
      <label class="formular-label" for="anm_${name}">${label}</label>
      <input type="${typ}" id="anm_${name}" name="${name}" class="formular-feld" ${attribute}>
    </div>`;
}

// ---------------------------------------------
// Seiten
// ---------------------------------------------
function einrichtungHtml() {
  return `
    <h2 class="seiten-titel seiten-titel--mit-intro">Ersteinrichtung</h2>
    <p class="seiten-intro">Verbindung zur MySQL-Datenbank herstellen und das erste Administrator-Konto anlegen.
      Die Tabellen werden automatisch erstellt.</p>
    <form class="formular" data-formular="einrichtung" novalidate>
      <fieldset class="formular-gruppe">
        <legend class="formular-gruppe__titel">Datenbank</legend>
        <div class="formular-zeile">
          ${feld('host', 'Server (Host)', 'text', 'value="localhost" required autocomplete="off" spellcheck="false"')}
          ${feld('port', 'Port', 'text', 'value="3306" inputmode="numeric" required')}
        </div>
        ${feld('name', 'Datenbankname', 'text', 'required autocomplete="off" spellcheck="false" autofocus')}
        ${feld('benutzer', 'Datenbank-Benutzer', 'text', 'required autocomplete="off" spellcheck="false"')}
        ${feld('passwort', 'Datenbank-Passwort', 'password', 'autocomplete="off"')}
      </fieldset>
      <fieldset class="formular-gruppe">
        <legend class="formular-gruppe__titel">Administrator</legend>
        ${feld('admin', 'Benutzername', 'text', 'required autocomplete="username" autocapitalize="none" spellcheck="false"')}
        ${feld('adminPasswort', `Passwort (mind. ${MIN_PASSWORT} Zeichen)`, 'password', 'required autocomplete="new-password"')}
        ${feld('adminPasswort2', 'Passwort wiederholen', 'password', 'required autocomplete="new-password"')}
      </fieldset>
      <button type="submit" class="btn btn-primaer">Einrichten</button>
    </form>`;
}

function anmeldungHtml() {
  return `
    <div class="anmelde-karte">
      <h2 class="seiten-titel">Anmelden</h2>
      <form class="formular" data-formular="anmeldung" novalidate>
        ${feld('benutzername', 'Benutzername', 'text', 'required autocomplete="username" autocapitalize="none" spellcheck="false" autofocus')}
        ${feld('passwort', 'Passwort', 'password', 'required autocomplete="current-password"')}
        <button type="submit" class="btn btn-primaer">Anmelden</button>
      </form>
      ${passkeysMoeglich() ? `
      <div class="trenner" role="separator"><span>oder</span></div>
      <button type="button" class="btn btn-sekundaer" data-aktion="anmeldung-passkey">🔑 Mit Passkey anmelden</button>` : ''}
      <p class="klein-hinweis">Kein Konto? Zugänge vergibt der Administrator deines Vereins.</p>
    </div>`;
}

function mfaHtml() {
  return `
    <div class="anmelde-karte">
      <h2 class="seiten-titel seiten-titel--mit-intro">Bestätigungscode</h2>
      <p class="seiten-intro">Gib den 6-stelligen Code aus deiner Authenticator-App ein –
        oder einen deiner Wiederherstellungscodes.</p>
      <form class="formular" data-formular="mfa" novalidate>
        ${feld('code', 'Code', 'text', 'required inputmode="numeric" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" autofocus')}
        <button type="submit" class="btn btn-primaer">Bestätigen</button>
        <button type="button" class="btn btn-sekundaer" data-aktion="anmeldung-zurueck">Abbrechen</button>
      </form>
    </div>`;
}

function passwortZwangHtml() {
  const b = serverStatus().benutzer;
  return `
    <div class="anmelde-karte">
      <h2 class="seiten-titel seiten-titel--mit-intro">Neues Passwort festlegen</h2>
      <p class="seiten-intro">Hallo ${escapeHtml(b.benutzername)}, bitte ersetze dein Startpasswort durch ein eigenes
        (mindestens ${MIN_PASSWORT} Zeichen).</p>
      <form class="formular" data-formular="passwort-zwang" novalidate>
        <input type="text" name="benutzername" value="${escapeHtml(b.benutzername)}" autocomplete="username" hidden>
        ${feld('alt', 'Startpasswort', 'password', 'required autocomplete="current-password" autofocus')}
        ${feld('neu', 'Neues Passwort', 'password', 'required autocomplete="new-password"')}
        ${feld('neu2', 'Neues Passwort wiederholen', 'password', 'required autocomplete="new-password"')}
        <button type="submit" class="btn btn-primaer">Speichern</button>
        <button type="button" class="btn btn-sekundaer" data-aktion="anmeldung-zurueck">Abmelden</button>
      </form>
    </div>`;
}

// ---------------------------------------------
// Aktionen
// ---------------------------------------------
function markiere(form, name, text) {
  for (const f of form.querySelectorAll('[aria-invalid]')) f.removeAttribute('aria-invalid');
  const feldEl = name && form.elements[name];
  if (feldEl) { feldEl.setAttribute('aria-invalid', 'true'); feldEl.focus(); }
  if (text) zeigeToast(`⚠ ${text}`, 4000);
}

async function absenden(form, arbeit) {
  const btn = form.querySelector('[type="submit"]');
  await mitLadezustand(btn, async () => {
    try {
      await arbeit();
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
  });
}

function angemeldet(benutzer) {
  setzeBenutzer(benutzer);
  document.dispatchEvent(new CustomEvent('angemeldet'));
}

registriereAktionen({
  'formular:einrichtung': (form) => {
    const f = form.elements;
    if (f.adminPasswort.value.length < MIN_PASSWORT) return markiere(form, 'adminPasswort', `Passwort: mindestens ${MIN_PASSWORT} Zeichen`);
    if (f.adminPasswort.value !== f.adminPasswort2.value) return markiere(form, 'adminPasswort2', 'Passwörter stimmen nicht überein');
    return absenden(form, async () => {
      const r = await apiPost('einrichtung', {
        db: { host: f.host.value, port: Number(f.port.value) || 3306, name: f.name.value, benutzer: f.benutzer.value, passwort: f.passwort.value },
        admin: { benutzername: f.admin.value, passwort: f.adminPasswort.value }
      });
      await ladeStatus();
      zeigeToast(r.vorhandeneDaten
        ? 'Bestehende Daten gefunden – bitte mit einem vorhandenen Konto anmelden'
        : '✓ Eingerichtet – bitte jetzt anmelden', 6000);
      document.dispatchEvent(new CustomEvent('anmelde-schritt'));
    });
  },

  'formular:anmeldung': (form) => {
    const f = form.elements;
    if (!f.benutzername.value.trim()) return markiere(form, 'benutzername', 'Bitte Benutzername eingeben');
    if (!f.passwort.value) return markiere(form, 'passwort', 'Bitte Passwort eingeben');
    return absenden(form, async () => {
      const r = await apiPost('anmeldung/passwort', { benutzername: f.benutzername.value.trim(), passwort: f.passwort.value }, { still401: true });
      if (r.mfa) {
        await ladeStatus();
        document.dispatchEvent(new CustomEvent('anmelde-schritt'));
      } else {
        angemeldet(r.benutzer);
      }
    });
  },

  'formular:mfa': (form) => {
    const code = form.elements.code.value.trim();
    if (!code) return markiere(form, 'code', 'Bitte Code eingeben');
    return absenden(form, async () => {
      try {
        const r = await apiPost('anmeldung/mfa', { code }, { still401: true });
        angemeldet(r.benutzer);
      } catch (err) {
        form.elements.code.value = '';
        // Zeitfenster abgelaufen / zu viele Versuche → zurück zur Passwort-Eingabe
        if (/erneut mit Passwort/.test(err.message)) {
          await ladeStatus();
          document.dispatchEvent(new CustomEvent('anmelde-schritt'));
        }
        throw err;
      }
    });
  },

  'formular:passwort-zwang': (form) => {
    const f = form.elements;
    if (f.neu.value.length < MIN_PASSWORT) return markiere(form, 'neu', `Mindestens ${MIN_PASSWORT} Zeichen`);
    if (f.neu.value !== f.neu2.value) return markiere(form, 'neu2', 'Passwörter stimmen nicht überein');
    return absenden(form, async () => {
      const r = await apiPost('profil/passwort', { alt: f.alt.value, neu: f.neu.value });
      zeigeToast('✓ Passwort gespeichert');
      angemeldet(r.benutzer);
    });
  },

  'anmeldung-passkey': (btn) => mitLadezustand(btn, async () => {
    try {
      const { optionen } = await apiPost('anmeldung/passkey-optionen', undefined, { still401: true });
      const antwort = await passkeyAssertion(optionen);
      const r = await apiPost('anmeldung/passkey', antwort, { still401: true });
      angemeldet(r.benutzer);
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
  }),

  'anmeldung-zurueck': async () => {
    await meldeAb();
    await ladeStatus().catch(() => {});
    document.dispatchEvent(new CustomEvent('anmelde-schritt'));
  }
});
