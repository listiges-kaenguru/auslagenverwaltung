// =============================================
// STAMMDATEN für das Einreichungs-PDF (Name, IBAN, Ort)
// Teil des Benutzerprofils auf dem Server; werden beim Einreichen ins Formular übernommen.
// =============================================
import { escapeHtml, zeigeToast, mitLadezustand, registriereAktionen } from './hilfen.js';
import { apiPut } from './api.js';
import { aktuellerBenutzer, setzeBenutzer } from './sitzung.js';

const FELDER = ['vorname', 'nachname', 'iban', 'ort'];

export function ladeStammdaten() {
  const s = aktuellerBenutzer()?.stammdaten || {};
  return Object.fromEntries(FELDER.map((f) => [f, s[f] || '']));
}

/** Ist mindestens ein Feld ausgefüllt? */
export function hatStammdaten(daten = ladeStammdaten()) {
  return FELDER.some((feld) => daten[feld]);
}

/** Speichern auf dem Server (Backup-Import: nur wenn noch keine gepflegt sind) */
export async function speichereStammdaten(daten) {
  const { benutzer } = await apiPut('profil/stammdaten', Object.fromEntries(FELDER.map((f) => [f, daten[f] || ''])));
  setzeBenutzer(benutzer);
  return benutzer.stammdaten;
}

// ---------------------------------------------
// IBAN
// ---------------------------------------------
export function normalisiereIban(iban) {
  return String(iban ?? '').replace(/\s+/g, '').toUpperCase();
}

/** DE89370400440532013000 → "DE89 3704 0044 0532 0130 00" */
export function formatiereIban(iban) {
  return normalisiereIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

/** Formal gültig? (Aufbau + Prüfsumme nach ISO 13616, Modulo 97) – der Server prüft zusätzlich */
export function istGueltigeIban(iban) {
  const s = normalisiereIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('DE') && s.length !== 22) return false;
  let rest = 0;
  for (const zeichen of s.slice(4) + s.slice(0, 4)) {
    const wert = /\d/.test(zeichen) ? zeichen : String(zeichen.charCodeAt(0) - 55); // A=10 … Z=35
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

// ---------------------------------------------
// Formular (Profil-Ansicht)
// ---------------------------------------------
export function stammdatenFormularHtml() {
  const d = ladeStammdaten();
  const feld = (name, label, attribute = '') => `
    <div>
      <label class="formular-label" for="stamm_${name}">${label}</label>
      <input type="text" id="stamm_${name}" name="${name}" class="formular-feld" maxlength="100"
        value="${escapeHtml(name === 'iban' ? formatiereIban(d.iban) : d[name])}" ${attribute}>
    </div>`;

  return `
    <p class="abschnitt__text">
      Werden beim Einreichen automatisch in das PDF eingetragen – statt einer Unterschrift steht dort
      „gez. Nachname“.
    </p>
    <form class="formular formular--kompakt" data-formular="stammdaten" novalidate>
      <div class="formular-zeile">
        ${feld('vorname', 'Vorname', 'autocomplete="given-name" autocapitalize="words"')}
        ${feld('nachname', 'Nachname', 'autocomplete="family-name" autocapitalize="words"')}
      </div>
      ${feld('iban', 'IBAN', 'autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="DE00 0000 0000 0000 0000 00"')}
      ${feld('ort', 'Ort', 'autocomplete="address-level2" autocapitalize="words"')}
      <button type="submit" class="btn btn-sekundaer btn-klein">💾 Stammdaten speichern</button>
    </form>`;
}

registriereAktionen({
  'formular:stammdaten': (form) => {
    const f = form.elements;
    const eingabe = Object.fromEntries(FELDER.map((feld) => [feld, f[feld].value.trim()]));
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');

    if (eingabe.iban && !istGueltigeIban(eingabe.iban)) {
      f.iban.setAttribute('aria-invalid', 'true');
      f.iban.focus();
      zeigeToast('⚠ IBAN ist ungültig – bitte prüfen', 4000);
      return;
    }
    return mitLadezustand(form.querySelector('[type="submit"]'), async () => {
      try {
        const gespeichert = await speichereStammdaten({ ...eingabe, iban: normalisiereIban(eingabe.iban) });
        f.iban.value = formatiereIban(gespeichert.iban);
        zeigeToast('✓ Stammdaten gespeichert');
      } catch (err) {
        zeigeToast(`⚠ ${err.message}`, 4000);
      }
    });
  }
});
