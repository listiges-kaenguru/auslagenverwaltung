// =============================================
// ANSICHT 4: PROFIL
// Stammdaten · Passwort · Zwei-Faktor (TOTP) · Passkeys · Abmelden · App-Version
// Für Admins zusätzlich „Administration“: Benutzerverwaltung (inkl. Kassenrolle) und Datenbank-Verbindung
// =============================================
import {
  escapeHtml, formatiereDatum, formatiereGroesse, plural, zeigeToast, mitLadezustand, registriereAktionen,
  ladeSkript, ladeDateiHerunter
} from './hilfen.js';
import { apiGet, apiPost, apiPut, apiDelete, mitId } from './api.js';
import { aktuellerBenutzer, setzeBenutzer, istAdmin, anzeigeName, passkeysMoeglich, meldeAb, ladeStatus } from './sitzung.js';
import { stammdatenFormularHtml } from './stammdaten.js';
import { erstellePasskey, geraeteName } from './webauthn.js';
import { versionsInfo } from './pwa.js';

const MIN_PASSWORT = 10;

/** Fachliche Rolle zusätzlich zu Benutzer/Admin (Einblick in eingereichte Auslagen aller Mitglieder) */
const KASSENROLLEN = { keine: 'Keine', kassenwart: 'Kassenwart', vorstand: 'Vorstand' };
const kassenrolleBadge = (rolle) => (KASSENROLLEN[rolle] && rolle !== 'keine'
  ? `<span class="badge badge--veranlasst">${KASSENROLLEN[rolle]}</span>` : '');

// Zustand der Ansicht (bleibt beim Neu-Rendern erhalten)
let totpEinrichtung = null;     // { geheimnis, uri, qrSvg }
let neueCodes = null;           // frisch erzeugte Wiederherstellungscodes (nur einmal sichtbar)
let passwortAbfrage = null;     // { zweck: 'totp-aus' | 'codes-neu' | 'loeschen', id?, name? }
let startpasswort = null;       // { benutzername, passwort }
let neuerBenutzerOffen = false;
let adminBenutzer = null;       // Liste oder null (noch nicht geladen)
let adminDb = null;             // { db, uebersicht, php }
let dbTest = null;              // { eingabe, uebersicht, gleicheDb }
let adminLaedt = false;

const neuRendern = () => document.dispatchEvent(new CustomEvent('ansicht-rendern'));

export function rendereProfil(container) {
  const b = aktuellerBenutzer();
  if (!b) return;

  container.innerHTML = `
    <div class="ansicht">
      <div class="profil-kopf">
        <div class="profil-avatar" aria-hidden="true">${escapeHtml(initialen(b))}</div>
        <div class="profil-kopf__text">
          <h2 class="seiten-titel profil-kopf__name">${escapeHtml(anzeigeName(b))}</h2>
          <div class="profil-kopf__unter">
            ${escapeHtml(b.benutzername)}
            <span class="badge ${b.rolle === 'admin' ? 'badge--eingereicht' : 'badge--offen'}">${b.rolle === 'admin' ? 'Administrator' : 'Benutzer'}</span>
            ${kassenrolleBadge(b.kassenrolle)}
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="profil-abmelden">↩ Abmelden</button>

      <section class="abschnitt" aria-labelledby="titelStamm">
        <h3 class="abschnitt__titel" id="titelStamm">Stammdaten für Einreichungen</h3>
        ${stammdatenFormularHtml()}
      </section>

      <section class="abschnitt" aria-labelledby="titelPasswort">
        <h3 class="abschnitt__titel" id="titelPasswort">Passwort ändern</h3>
        <form class="formular formular--kompakt" data-formular="passwort" novalidate>
          <input type="text" name="benutzername" value="${escapeHtml(b.benutzername)}" autocomplete="username" hidden>
          ${feld('alt', 'Aktuelles Passwort', 'password', 'autocomplete="current-password"')}
          ${feld('neu', `Neues Passwort (mind. ${MIN_PASSWORT} Zeichen)`, 'password', 'autocomplete="new-password"')}
          ${feld('neu2', 'Neues Passwort wiederholen', 'password', 'autocomplete="new-password"')}
          <button type="submit" class="btn btn-sekundaer btn-klein">🔒 Passwort ändern</button>
        </form>
        <p class="klein-hinweis klein-hinweis--links">Andere angemeldete Geräte werden dabei abgemeldet.</p>
      </section>

      <section class="abschnitt" aria-labelledby="titelMfa">
        <h3 class="abschnitt__titel" id="titelMfa">Zwei-Faktor-Anmeldung (TOTP)</h3>
        ${totpHtml(b)}
      </section>

      <section class="abschnitt" aria-labelledby="titelPasskeys">
        <h3 class="abschnitt__titel" id="titelPasskeys">Passkeys</h3>
        ${passkeysHtml(b)}
      </section>

      ${istAdmin() ? adminHtml(b) : ''}

      <section class="abschnitt" id="versionsBereich" aria-labelledby="titelVersion">
        ${versionHtml()}
      </section>
    </div>`;

  if (istAdmin() && adminBenutzer === null && !adminLaedt) ladeAdminDaten();
}

// ---------------------------------------------
// Bausteine
// ---------------------------------------------
function initialen(b) {
  const { vorname, nachname } = b.stammdaten;
  const text = (vorname[0] || '') + (nachname[0] || '');
  return (text || b.benutzername.slice(0, 2)).toUpperCase();
}

function feld(name, label, typ = 'text', attribute = '', wert = '') {
  const id = `prf_${name}_${Math.random().toString(36).slice(2, 7)}`;
  return `
    <div>
      <label class="formular-label" for="${id}">${label}</label>
      <input type="${typ}" id="${id}" name="${name}" class="formular-feld" value="${escapeHtml(wert)}" ${attribute}>
    </div>`;
}

function passwortAbfrageHtml(zweck, text, knopf, { gefahr = false, id = '' } = {}) {
  if (passwortAbfrage?.zweck !== zweck || String(passwortAbfrage.id ?? '') !== String(id)) return '';
  return `
    <form class="formular formular--kompakt bestaetigung" data-formular="passwort-bestaetigung" novalidate>
      <p class="bestaetigung__text">${text}</p>
      ${feld('passwort', 'Dein Passwort zur Bestätigung', 'password', 'autocomplete="current-password" autofocus')}
      <div class="knopf-reihe">
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="bestaetigung-abbrechen">Abbrechen</button>
        <button type="submit" class="btn ${gefahr ? 'btn-gefahr' : 'btn-primaer'} btn-klein">${knopf}</button>
      </div>
    </form>`;
}

function codesHtml() {
  return `
    <div class="codes-kasten" role="region" aria-label="Wiederherstellungscodes">
      <p class="codes-kasten__titel">Deine Wiederherstellungscodes</p>
      <p class="abschnitt__text">Jeder Code funktioniert <strong>einmal</strong>, falls du keinen Zugriff auf deine
        Authenticator-App hast. Bewahre sie sicher auf – sie werden nur jetzt angezeigt.</p>
      <ol class="codes-liste">${neueCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join('')}</ol>
      <div class="knopf-reihe">
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="codes-kopieren">📋 Kopieren</button>
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="codes-speichern">⬇ Als Datei</button>
      </div>
      <button type="button" class="btn btn-primaer btn-klein" data-aktion="codes-fertig">✓ Ich habe die Codes gesichert</button>
    </div>`;
}

function totpHtml(b) {
  if (neueCodes) return codesHtml();

  if (totpEinrichtung) {
    const gruppen = totpEinrichtung.geheimnis.replace(/(.{4})(?=.)/g, '$1 ');
    return `
      <ol class="schritte">
        <li>Scanne den QR-Code mit einer Authenticator-App (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator).
          <div class="qr-code">${totpEinrichtung.qrSvg}</div>
          <details class="qr-manuell">
            <summary>QR-Code lässt sich nicht scannen?</summary>
            <p>Schlüssel manuell eingeben (zeitbasiert, 6 Ziffern):</p>
            <code class="qr-manuell__schluessel">${escapeHtml(gruppen)}</code>
          </details>
        </li>
        <li>Gib den angezeigten 6-stelligen Code ein:
          <form class="formular formular--kompakt" data-formular="totp-bestaetigen" novalidate>
            ${feld('code', 'Code aus der App', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus')}
            <div class="knopf-reihe">
              <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="totp-abbrechen">Abbrechen</button>
              <button type="submit" class="btn btn-primaer btn-klein">Aktivieren</button>
            </div>
          </form>
        </li>
      </ol>`;
  }

  if (!b.totpAktiv) {
    return `
      <p class="abschnitt__text">Schützt dein Konto zusätzlich: Nach dem Passwort wird ein Code aus einer
        Authenticator-App abgefragt.</p>
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="totp-starten">🛡 Authenticator-App einrichten</button>`;
  }

  const wenige = b.wiederherstellungscodes <= 3;
  return `
    <p class="status-zeile"><span class="badge badge--erstattet">✓ Aktiv</span>
      <span class="${wenige ? 'text-warnung' : ''}">${plural(b.wiederherstellungscodes, 'Wiederherstellungscode', 'Wiederherstellungscodes')} übrig</span></p>
    ${passwortAbfrageHtml('codes-neu', 'Neue Codes erzeugen? Die bisherigen werden dabei ungültig.', 'Neue Codes erzeugen')}
    ${passwortAbfrageHtml('totp-aus', 'Zwei-Faktor-Anmeldung wirklich deaktivieren?', 'Deaktivieren', { gefahr: true })}
    ${passwortAbfrage?.zweck === 'codes-neu' || passwortAbfrage?.zweck === 'totp-aus' ? '' : `
    <div class="knopf-reihe knopf-reihe--umbruch">
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="bestaetigung-starten" data-zweck="codes-neu">🔁 Neue Wiederherstellungscodes</button>
      <button type="button" class="btn btn-gefahr btn-klein" data-aktion="bestaetigung-starten" data-zweck="totp-aus">Deaktivieren</button>
    </div>`}`;
}

function passkeysHtml(b) {
  const liste = b.passkeys.length
    ? `<ul class="karten-liste">${b.passkeys.map((p) => `
        <li class="mini-karte">
          <div class="mini-karte__text">
            <span class="mini-karte__titel">🔑 ${escapeHtml(p.name)}</span>
            <span class="mini-karte__unter">Erstellt ${formatiereDatum(p.erstelltAm.slice(0, 10))}
              · ${p.zuletztBenutzt ? `zuletzt benutzt ${formatiereDatum(p.zuletztBenutzt.slice(0, 10))}` : 'noch nicht benutzt'}</span>
          </div>
          <button type="button" class="btn btn-gefahr btn-klein mini-karte__knopf" data-aktion="passkey-loeschen"
            data-id="${p.id}" data-name="${escapeHtml(p.name)}" aria-label="Passkey ${escapeHtml(p.name)} entfernen">Entfernen</button>
        </li>`).join('')}</ul>`
    : '<p class="abschnitt__text">Noch kein Passkey eingerichtet.</p>';

  const hinzufuegen = passkeysMoeglich()
    ? `<form class="formular formular--kompakt" data-formular="passkey-neu" novalidate>
        ${feld('name', 'Bezeichnung des Geräts', 'text', 'maxlength="100" autocomplete="off"', geraeteName())}
        <button type="submit" class="btn btn-sekundaer btn-klein">➕ Passkey hinzufügen</button>
      </form>`
    : '<p class="klein-hinweis klein-hinweis--links">Passkeys funktionieren nur, wenn die App über HTTPS aufgerufen wird und der Browser sie unterstützt.</p>';

  return `
    <p class="abschnitt__text">Anmelden ohne Passwort – per Fingerabdruck, Gesichtserkennung oder Geräte-PIN.
      Ein Passkey ersetzt Passwort und Zwei-Faktor-Code.</p>
    ${liste}
    ${hinzufuegen}`;
}

// ---------------------------------------------
// App-Version
// ---------------------------------------------
function versionHtml() {
  const { laufend, neu, ermittelt, updateBereit } = versionsInfo();
  return `
    <h3 class="abschnitt__titel" id="titelVersion">App-Version</h3>
    <p class="abschnitt__text">Laufende Version: <strong>${escapeHtml(laufend ? `v${laufend}` : (ermittelt ? 'unbekannt' : 'wird ermittelt …'))}</strong></p>
    ${updateBereit ? `
      <div class="codes-kasten" role="status">
        <p class="codes-kasten__titel">Aktualisierung verfügbar</p>
        <p class="abschnitt__text">Neue Version: <strong>${escapeHtml(neu ? `v${neu}` : 'wird ermittelt …')}</strong> – deine Daten bleiben erhalten.</p>
        <button type="button" class="btn btn-primaer btn-klein" data-aktion="update-installieren">🔄 Jetzt aktualisieren</button>
      </div>`
      : ermittelt ? '<p class="klein-hinweis klein-hinweis--links">Die App ist auf dem neuesten Stand.</p>' : ''}`;
}

// Nur den Versionsbereich auffrischen – ein komplettes Neu-Rendern würde Formulareingaben verwerfen
document.addEventListener('version-geaendert', () => {
  const bereich = document.getElementById('versionsBereich');
  if (bereich) bereich.innerHTML = versionHtml();
});

// ---------------------------------------------
// Administration
// ---------------------------------------------
function adminHtml(ich) {
  return `
    <section class="abschnitt abschnitt--admin" aria-labelledby="titelAdmin">
      <h3 class="abschnitt__titel abschnitt__titel--gross" id="titelAdmin">⚙️ Administration</h3>

      <h4 class="unter-titel">Benutzer</h4>
      ${startpasswort ? `
        <div class="codes-kasten" role="status">
          <p class="codes-kasten__titel">Startpasswort für ${escapeHtml(startpasswort.benutzername)}</p>
          <p><code class="startpasswort">${escapeHtml(startpasswort.passwort)}</code></p>
          <p class="abschnitt__text">Wird nur jetzt angezeigt. Bei der ersten Anmeldung muss ein eigenes Passwort gewählt werden.</p>
          <div class="knopf-reihe">
            <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="startpasswort-kopieren">📋 Kopieren</button>
            <button type="button" class="btn btn-primaer btn-klein" data-aktion="startpasswort-fertig">Fertig</button>
          </div>
        </div>` : ''}

      ${neuerBenutzerOffen ? `
        <form class="formular formular--kompakt kasten" data-formular="benutzer-neu" novalidate>
          ${feld('benutzername', 'Benutzername (3–50 Zeichen: a–z, 0–9, . _ @ -)', 'text', 'autocomplete="off" autocapitalize="none" spellcheck="false" autofocus')}
          <div class="formular-zeile">
            ${feld('vorname', 'Vorname', 'text', 'autocomplete="off"')}
            ${feld('nachname', 'Nachname', 'text', 'autocomplete="off"')}
          </div>
          <div>
            <label class="formular-label" for="neuRolle">Rolle</label>
            <select id="neuRolle" name="rolle" class="formular-feld">
              <option value="user">Benutzer</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div>
            <label class="formular-label" for="neuKassenrolle">Kassenrolle</label>
            <select id="neuKassenrolle" name="kassenrolle" class="formular-feld">
              ${Object.entries(KASSENROLLEN).map(([wert, label]) => `<option value="${wert}">${label}</option>`).join('')}
            </select>
          </div>
          <div class="knopf-reihe">
            <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="benutzer-neu-abbrechen">Abbrechen</button>
            <button type="submit" class="btn btn-primaer btn-klein">Anlegen</button>
          </div>
        </form>` : `
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="benutzer-neu">➕ Neuer Benutzer</button>`}

      ${adminBenutzer === null
        ? '<p class="abschnitt__text">Lade Benutzer …</p>'
        : `<ul class="karten-liste">${adminBenutzer.map((u) => benutzerKarteHtml(u, ich)).join('')}</ul>`}

      <h4 class="unter-titel">Datenbank-Verbindung</h4>
      ${adminDb ? dbHtml() : '<p class="abschnitt__text">Lade Verbindungsdaten …</p>'}
    </section>`;
}

function benutzerKarteHtml(u, ich) {
  const selbst = u.id === ich.id;
  const merkmale = [
    u.rolle === 'admin' ? '<span class="badge badge--eingereicht">Admin</span>' : '<span class="badge badge--offen">Benutzer</span>',
    kassenrolleBadge(u.kassenrolle),
    u.aktiv ? '' : '<span class="badge badge--gesperrt">Gesperrt</span>',
    u.mussPasswortAendern ? '<span class="badge badge--offen">Startpasswort</span>' : '',
    u.totpAktiv ? '<span class="badge badge--erstattet">2FA</span>' : '',
    u.passkeys ? `<span class="badge badge--erstattet">${plural(u.passkeys, 'Passkey', 'Passkeys')}</span>` : ''
  ].join(' ');

  return `
    <li class="mini-karte mini-karte--block ${u.aktiv ? '' : 'mini-karte--inaktiv'}">
      <div class="mini-karte__text">
        <span class="mini-karte__titel">${escapeHtml(u.name || u.benutzername)}${selbst ? ' (du)' : ''}</span>
        <span class="mini-karte__unter">${escapeHtml(u.benutzername)} · ${plural(u.auslagen, 'Auslage', 'Auslagen')}
          · ${u.letzterLogin ? `zuletzt angemeldet ${formatiereDatum(u.letzterLogin.slice(0, 10))}` : 'noch nie angemeldet'}</span>
        <span class="mini-karte__merkmale">${merkmale}</span>
      </div>
      ${selbst ? '' : `
      ${passwortAbfrageHtml('loeschen', `„${escapeHtml(u.benutzername)}“ mit allen Auslagen und Belegen endgültig löschen?`, 'Endgültig löschen', { gefahr: true, id: u.id })}
      <div class="knopf-reihe knopf-reihe--umbruch">
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="admin-rolle" data-id="${u.id}" data-rolle="${u.rolle === 'admin' ? 'user' : 'admin'}">
          ${u.rolle === 'admin' ? 'Zum Benutzer machen' : 'Zum Admin machen'}</button>
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="admin-aktiv" data-id="${u.id}" data-aktiv="${u.aktiv ? 0 : 1}">
          ${u.aktiv ? 'Sperren' : 'Entsperren'}</button>
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="admin-passwort" data-id="${u.id}" data-name="${escapeHtml(u.benutzername)}">
          Passwort zurücksetzen</button>
        ${u.totpAktiv || u.passkeys ? `
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="admin-mfa" data-id="${u.id}" data-name="${escapeHtml(u.benutzername)}">
          2FA &amp; Passkeys zurücksetzen</button>` : ''}
        <button type="button" class="btn btn-gefahr btn-klein" data-aktion="bestaetigung-starten" data-zweck="loeschen" data-id="${u.id}">
          Löschen</button>
      </div>`}
      ${kassenrolleWahlHtml(u)}
    </li>`;
}

/** Kassenrolle als Knopfgruppe (auch für das eigene Konto – sie berührt keine Admin-Rechte) */
function kassenrolleWahlHtml(u) {
  return `
    <div class="kassenrolle-wahl" role="group" aria-label="Kassenrolle von ${escapeHtml(u.benutzername)}">
      <span class="kassenrolle-wahl__label">Kassenrolle:</span>
      ${Object.entries(KASSENROLLEN).map(([wert, label]) => `
        <button type="button" class="filter-chip" data-aktion="admin-kassenrolle" data-id="${u.id}"
          data-kassenrolle="${wert}" aria-pressed="${u.kassenrolle === wert}">${label}</button>`).join('')}
    </div>`;
}

function dbHtml() {
  const { db, uebersicht: u, php } = adminDb;
  const e = dbTest?.eingabe || db;
  let testHtml = '';
  if (dbTest) {
    const t = dbTest.uebersicht;
    const leer = !t.hatTabellen || t.benutzer === 0;
    testHtml = `
      <div class="test-ergebnis" role="status">
        <p><strong>✓ Verbindung erfolgreich</strong> · ${escapeHtml(t.serverVersion)}</p>
        <p>${dbTest.gleicheDb
          ? 'Gleiche Datenbank wie bisher – es werden nur die Zugangsdaten aktualisiert.'
          : leer
            ? 'Die Ziel-Datenbank ist leer. Die Tabellen werden beim Wechsel angelegt.'
            : `Die Ziel-Datenbank enthält bereits VereinsAuslagen-Daten (${plural(t.benutzer, 'Benutzer', 'Benutzer')}, ${plural(t.auslagen, 'Auslage', 'Auslagen')}). Nach dem Wechsel gelten deren Konten.`}</p>
        ${!dbTest.gleicheDb && leer ? `
        <label class="haken">
          <input type="checkbox" name="uebernehmen" form="formDb" checked>
          <span>Alle Daten übernehmen (Benutzer, Auslagen, Belege). Ohne Haken wird nur dein Admin-Konto übernommen.</span>
        </label>` : ''}
      </div>`;
  }

  return `
    <dl class="daten-liste">
      <div><dt>Server</dt><dd>${escapeHtml(db.host)}:${db.port}</dd></div>
      <div><dt>Datenbank</dt><dd>${escapeHtml(db.name)} (Benutzer ${escapeHtml(db.benutzer)})</dd></div>
      <div><dt>Version</dt><dd>${escapeHtml(u.serverVersion)}</dd></div>
      <div><dt>Inhalt</dt><dd>${plural(u.benutzer, 'Benutzer', 'Benutzer')} · ${plural(u.auslagen, 'Auslage', 'Auslagen')}</dd></div>
      <div><dt>Max. Beleggröße</dt><dd>${formatiereGroesse(Math.min(php.maxBelegBytes, u.maxAllowedPacket))}
        <span class="daten-liste__klein">(PHP ${escapeHtml(php.version)}, post_max_size ${escapeHtml(php.postMaxSize)}, max_allowed_packet ${formatiereGroesse(u.maxAllowedPacket)})</span></dd></div>
    </dl>

    <form class="formular formular--kompakt kasten" id="formDb" data-formular="db-speichern" novalidate>
      <p class="abschnitt__text">Neue Verbindung eintragen, testen und speichern. Das Passwort nur ausfüllen, wenn es sich ändert.</p>
      <div class="formular-zeile">
        ${feld('host', 'Server (Host)', 'text', 'autocomplete="off" spellcheck="false"', e.host)}
        ${feld('port', 'Port', 'text', 'inputmode="numeric"', String(e.port))}
      </div>
      ${feld('name', 'Datenbankname', 'text', 'autocomplete="off" spellcheck="false"', e.name)}
      ${feld('benutzer', 'Datenbank-Benutzer', 'text', 'autocomplete="off" spellcheck="false"', e.benutzer)}
      ${feld('passwort', 'Datenbank-Passwort', 'password', 'autocomplete="off" placeholder="unverändert"')}
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="db-testen">🔌 Verbindung testen</button>
      ${testHtml}
      ${dbTest ? `
        ${feld('adminPasswort', 'Dein Admin-Passwort zur Bestätigung', 'password', 'autocomplete="current-password"')}
        <button type="submit" class="btn btn-primaer btn-klein">Speichern &amp; wechseln</button>
        <p class="klein-hinweis klein-hinweis--links">Beim Wechsel auf eine andere Datenbank werden alle Benutzer abgemeldet.</p>` : ''}
    </form>`;
}

async function ladeAdminDaten() {
  adminLaedt = true;
  try {
    const [benutzer, db] = await Promise.all([apiGet('admin/benutzer'), apiGet('admin/db')]);
    adminBenutzer = benutzer.benutzer;
    adminDb = db;
  } catch (err) {
    zeigeToast(`⚠ ${err.message}`, 5000);
    adminBenutzer = adminBenutzer || [];
  } finally {
    adminLaedt = false;
  }
  neuRendern();
}

function dbFormular(form) {
  const f = form.elements;
  return { host: f.host.value.trim(), port: Number(f.port.value) || 3306, name: f.name.value.trim(), benutzer: f.benutzer.value.trim(), passwort: f.passwort.value };
}

/** Admin-Aktion mit Ladezustand, Fehler-Toast und frischer Benutzerliste */
function adminAktion(btn, arbeit) {
  return mitLadezustand(btn, async () => {
    try {
      await arbeit();
      adminBenutzer = (await apiGet('admin/benutzer')).benutzer;
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
    neuRendern();
  });
}

/** Admin-Daten beim Abmelden vergessen */
export function vergissProfilZustand() {
  totpEinrichtung = neueCodes = passwortAbfrage = startpasswort = adminBenutzer = adminDb = dbTest = null;
  neuerBenutzerOffen = false;
}

// ---------------------------------------------
// Aktionen
// ---------------------------------------------
async function mitFehler(btn, arbeit) {
  return mitLadezustand(btn, async () => {
    try { await arbeit(); } catch (err) { zeigeToast(`⚠ ${err.message}`, 5000); }
  });
}

async function kopiere(text, meldung) {
  try {
    await navigator.clipboard.writeText(text);
    zeigeToast(meldung);
  } catch {
    zeigeToast('⚠ Kopieren nicht möglich – bitte manuell markieren');
  }
}

registriereAktionen({
  'profil-abmelden': async () => {
    await meldeAb();
    zeigeToast('Abgemeldet');
  },

  'formular:passwort': (form) => {
    const f = form.elements;
    if (!f.alt.value) { f.alt.focus(); zeigeToast('⚠ Bitte aktuelles Passwort eingeben'); return; }
    if (f.neu.value.length < MIN_PASSWORT) { f.neu.focus(); zeigeToast(`⚠ Mindestens ${MIN_PASSWORT} Zeichen`); return; }
    if (f.neu.value !== f.neu2.value) { f.neu2.focus(); zeigeToast('⚠ Passwörter stimmen nicht überein'); return; }
    return mitFehler(form.querySelector('[type="submit"]'), async () => {
      const r = await apiPost('profil/passwort', { alt: f.alt.value, neu: f.neu.value });
      form.reset();
      setzeBenutzer(r.benutzer);
      zeigeToast('✓ Passwort geändert');
    });
  },

  // --- TOTP ---
  'totp-starten': (btn) => mitFehler(btn, async () => {
    const [r, qrcode] = await Promise.all([apiPost('profil/totp/start'), ladeSkript('vendor/qrcode.js', 'qrcode')]);
    const qr = qrcode(0, 'M');
    qr.addData(r.uri);
    qr.make();
    totpEinrichtung = { ...r, qrSvg: qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true, alt: 'QR-Code für die Authenticator-App' }) };
    neuRendern();
  }),

  'totp-abbrechen': () => { totpEinrichtung = null; neuRendern(); },

  'formular:totp-bestaetigen': (form) => {
    const code = form.elements.code.value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { zeigeToast('⚠ Bitte den 6-stelligen Code eingeben'); return; }
    return mitFehler(form.querySelector('[type="submit"]'), async () => {
      const r = await apiPost('profil/totp/bestaetigen', { code });
      totpEinrichtung = null;
      neueCodes = r.codes;
      setzeBenutzer(r.benutzer);
      zeigeToast('✓ Zwei-Faktor-Anmeldung aktiviert');
    });
  },

  'codes-kopieren': () => kopiere(neueCodes.join('\n'), '📋 Codes kopiert'),
  'codes-speichern': () => ladeDateiHerunter(
    new Blob([`VereinsAuslagen – Wiederherstellungscodes für ${aktuellerBenutzer().benutzername}\n`
      + `Erstellt am ${formatiereDatum(new Date().toISOString().slice(0, 10))}. Jeder Code ist einmal gültig.\n\n${neueCodes.join('\n')}\n`],
      { type: 'text/plain' }),
    'VereinsAuslagen_Wiederherstellungscodes.txt'),
  'codes-fertig': () => { neueCodes = null; neuRendern(); },

  // --- Passwort-Bestätigungen ---
  'bestaetigung-starten': (btn) => {
    passwortAbfrage = { zweck: btn.dataset.zweck, id: btn.dataset.id };
    neuRendern();
  },
  'bestaetigung-abbrechen': () => { passwortAbfrage = null; neuRendern(); },

  'formular:passwort-bestaetigung': (form) => {
    const passwort = form.elements.passwort.value;
    if (!passwort) { form.elements.passwort.focus(); return; }
    const { zweck, id } = passwortAbfrage || {};
    return mitFehler(form.querySelector('[type="submit"]'), async () => {
      if (zweck === 'totp-aus') {
        const r = await apiPost('profil/totp/deaktivieren', { passwort });
        passwortAbfrage = null;
        setzeBenutzer(r.benutzer);
        zeigeToast('Zwei-Faktor-Anmeldung deaktiviert');
      } else if (zweck === 'codes-neu') {
        const r = await apiPost('profil/totp/neue-codes', { passwort });
        passwortAbfrage = null;
        neueCodes = r.codes;
        setzeBenutzer({ ...aktuellerBenutzer(), wiederherstellungscodes: r.codes.length });
      } else if (zweck === 'loeschen') {
        await apiPost(mitId('admin/benutzer/loeschen', id), { passwort });
        passwortAbfrage = null;
        adminBenutzer = (await apiGet('admin/benutzer')).benutzer;
        zeigeToast('🗑 Benutzer gelöscht');
        neuRendern();
      }
    });
  },

  // --- Passkeys ---
  'formular:passkey-neu': (form) => mitFehler(form.querySelector('[type="submit"]'), async () => {
    const { optionen } = await apiPost('profil/passkey-optionen');
    const credential = await erstellePasskey(optionen);
    const r = await apiPost('profil/passkey', { credential, name: form.elements.name.value.trim() });
    setzeBenutzer(r.benutzer);
    zeigeToast('✓ Passkey hinzugefügt');
  }),

  'passkey-loeschen': (btn) => {
    if (!window.confirm(`Passkey „${btn.dataset.name}“ entfernen?\n\nDas Gerät kann sich danach nicht mehr per Passkey anmelden. Den Eintrag im Passwort-Manager des Geräts bitte zusätzlich löschen.`)) return;
    return mitFehler(btn, async () => {
      const r = await apiDelete(mitId('profil/passkey', btn.dataset.id));
      setzeBenutzer(r.benutzer);
      zeigeToast('Passkey entfernt');
    });
  },

  // --- Admin: Benutzer ---
  'benutzer-neu': () => { neuerBenutzerOffen = true; neuRendern(); },
  'benutzer-neu-abbrechen': () => { neuerBenutzerOffen = false; neuRendern(); },

  'formular:benutzer-neu': (form) => {
    const f = form.elements;
    const benutzername = f.benutzername.value.trim();
    if (!/^[A-Za-z0-9._@-]{3,50}$/.test(benutzername)) {
      f.benutzername.setAttribute('aria-invalid', 'true');
      f.benutzername.focus();
      zeigeToast('⚠ Benutzername: 3–50 Zeichen (Buchstaben, Ziffern, . _ @ -)', 4000);
      return;
    }
    return adminAktion(form.querySelector('[type="submit"]'), async () => {
      const r = await apiPost('admin/benutzer', {
        benutzername, vorname: f.vorname.value, nachname: f.nachname.value, rolle: f.rolle.value, kassenrolle: f.kassenrolle.value
      });
      neuerBenutzerOffen = false;
      startpasswort = { benutzername, passwort: r.startpasswort };
    });
  },

  'startpasswort-kopieren': () => kopiere(startpasswort.passwort, '📋 Startpasswort kopiert'),
  'startpasswort-fertig': () => { startpasswort = null; neuRendern(); },

  'admin-rolle': (btn) => adminAktion(btn, async () => {
    await apiPut(mitId('admin/benutzer', btn.dataset.id), { rolle: btn.dataset.rolle });
    zeigeToast('✓ Rolle geändert');
  }),

  'admin-kassenrolle': (btn) => {
    if (btn.getAttribute('aria-pressed') === 'true') return;
    return adminAktion(btn, async () => {
      await apiPut(mitId('admin/benutzer', btn.dataset.id), { kassenrolle: btn.dataset.kassenrolle });
      zeigeToast('✓ Kassenrolle geändert');
      // Eigene Rolle geändert → Navigation („Kasse“) sofort anpassen
      if (Number(btn.dataset.id) === aktuellerBenutzer()?.id) {
        await ladeStatus();
        document.dispatchEvent(new CustomEvent('benutzer-geaendert'));
      }
    });
  },

  'admin-aktiv': (btn) => adminAktion(btn, async () => {
    await apiPut(mitId('admin/benutzer', btn.dataset.id), { aktiv: btn.dataset.aktiv === '1' });
    zeigeToast(btn.dataset.aktiv === '1' ? '✓ Entsperrt' : 'Gesperrt – alle Sitzungen beendet');
  }),

  'admin-passwort': (btn) => {
    if (!window.confirm(`Passwort von „${btn.dataset.name}“ zurücksetzen?\n\nEs wird ein neues Startpasswort erzeugt; alle Sitzungen dieses Benutzers enden.`)) return;
    return adminAktion(btn, async () => {
      const r = await apiPost(mitId('admin/benutzer/passwort', btn.dataset.id));
      startpasswort = { benutzername: btn.dataset.name, passwort: r.startpasswort };
    });
  },

  'admin-mfa': (btn) => {
    if (!window.confirm(`Zwei-Faktor-Anmeldung und alle Passkeys von „${btn.dataset.name}“ entfernen?\n\nSinnvoll, wenn das Smartphone verloren ging.`)) return;
    return adminAktion(btn, async () => {
      await apiPost(mitId('admin/benutzer/mfa-zuruecksetzen', btn.dataset.id));
      zeigeToast('✓ 2FA und Passkeys zurückgesetzt');
    });
  },

  // --- Admin: Datenbank ---
  'db-testen': (btn) => mitFehler(btn, async () => {
    const eingabe = dbFormular(btn.form);
    const r = await apiPost('admin/db/test', eingabe);
    dbTest = { eingabe: { ...eingabe, passwort: '' }, uebersicht: r.uebersicht, gleicheDb: r.gleicheDb, passwort: eingabe.passwort };
    neuRendern();
  }),

  'formular:db-speichern': (form) => {
    if (!dbTest) return;
    const eingabe = dbFormular(form);
    const adminPasswort = form.elements.adminPasswort?.value || '';
    if (!adminPasswort) { form.elements.adminPasswort.focus(); zeigeToast('⚠ Bitte dein Admin-Passwort eingeben'); return; }
    const uebernehmen = !!document.querySelector('input[name="uebernehmen"][form="formDb"]')?.checked;
    return mitFehler(form.querySelector('[type="submit"]'), async () => {
      const r = await apiPost('admin/db', { ...eingabe, passwort: eingabe.passwort || dbTest.passwort, uebernehmen, adminPasswort });
      dbTest = null;
      if (r.neuAnmelden) {
        zeigeToast('✓ Datenbank gewechselt – bitte neu anmelden', 6000);
        await ladeStatus();
        document.dispatchEvent(new CustomEvent('abgemeldet'));
      } else {
        zeigeToast('✓ Zugangsdaten gespeichert');
        adminDb = await apiGet('admin/db');
        neuRendern();
      }
    });
  }
});
