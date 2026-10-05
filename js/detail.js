// =============================================
// DETAIL-MODAL (Bottom Sheet)
// - Offene Auslagen: Beleg nachreichen/ersetzen, bearbeiten oder löschen
// - Eingereichte Auslagen gehören zu ihrer Einreichung: hier nur ansehen; Status und Zurückziehen
//   gelten für die ganze Gruppe und liegen in der Übersicht (Server prüft ebenso)
// - Zurück-Taste (Android) schließt das Modal statt die App
// =============================================
import {
  statusInfo, einreichungsText, escapeHtml, formatiereDatum, formatiereBetrag, betragAlsText,
  parseBetrag, formatiereGroesse, formatiereZeitpunkt, heuteISO, sichererDateiname, dateiEndung,
  ladeDateiHerunter, zeigeToast, registriereAktionen, meldeDatenAenderung
} from './hilfen.js';
import {
  findeAuslage, aktualisiereAuslage, loescheAuslage, holeBeleg, setzeBeleg
} from './speicher.js';
import { bereiteBelegVor, istPdf } from './bild.js';
import { belegKnoepfeHtml, haendlerDatalistHtml, pruefeEingaben, markiereFehler } from './beleg-ui.js';
import { ladeVerlauf, kommentareZurAuslageHtml } from './kommentare.js';

let modal, blatt, inhalt;
let aktuelleId        = null;
let modus             = 'anzeige';   // 'anzeige' | 'bearbeiten'
let belegUrl          = null;
let zuletztFokussiert = null;
let verlaufsMarke     = null;        // eindeutige Kennung des History-Eintrags

const istOffen = () => modal?.classList.contains('offen');

function gibBelegFrei() {
  if (belegUrl) URL.revokeObjectURL(belegUrl);
  belegUrl = null;
}

// ---------------------------------------------
// Öffnen / Schließen
// ---------------------------------------------
export async function oeffneDetail(id) {
  if (!findeAuslage(id)) return;
  const warOffen = istOffen();
  aktuelleId = id;
  modus = 'anzeige';
  await rendereInhalt();

  if (!warOffen) {
    zuletztFokussiert = document.activeElement;
    modal.classList.add('offen');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-offen');
    verlaufsMarke = String(Date.now());
    history.pushState({ modal: verlaufsMarke }, '');
    blatt.scrollTop = 0;
    blatt.focus({ preventScroll: true });
  }
}

/** Modal schließen (über den Verlauf, damit die Zurück-Taste konsistent bleibt) */
export function schliesseDetail() {
  if (!istOffen()) return;
  if (verlaufsMarke && history.state?.modal === verlaufsMarke) {
    history.back(); // → popstate → schliesseIntern()
  } else {
    schliesseIntern();
  }
}

function schliesseIntern() {
  if (!istOffen()) return;
  const id = aktuelleId;
  modal.classList.remove('offen');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-offen');
  aktuelleId    = null;
  modus         = 'anzeige';
  verlaufsMarke = null;

  // Inhalt erst nach der Ausblend-Animation leeren
  setTimeout(() => {
    if (!istOffen()) {
      inhalt.innerHTML = '';
      gibBelegFrei();
    }
  }, 350);

  // Fokus zurückgeben (Karte wurde evtl. neu gerendert)
  const ziel = zuletztFokussiert?.isConnected
    ? zuletztFokussiert
    : document.querySelector(`[data-aktion="detail"][data-id="${CSS.escape(id || '')}"]`);
  ziel?.focus?.({ preventScroll: true });
  zuletztFokussiert = null;
}

export function initDetail() {
  modal  = document.getElementById('detailModal');
  blatt  = modal.querySelector('.modal-blatt');
  inhalt = document.getElementById('modalInhalt');

  // Nach einem Neuladen mit offenem Modal: veralteten Verlaufszustand bereinigen
  if (history.state?.modal) history.replaceState(null, '');

  window.addEventListener('popstate', () => {
    if (istOffen() && history.state?.modal !== verlaufsMarke) schliesseIntern();
  });

  // Klick auf den abgedunkelten Hintergrund schließt
  modal.addEventListener('click', (e) => {
    if (e.target === modal) schliesseDetail();
  });

  // Fokus im Dialog halten (Tab / Shift+Tab)
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const fokussierbar = [...blatt.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null || el.classList.contains('visuell-versteckt'));
    if (fokussierbar.length === 0) return;
    const erstes = fokussierbar[0];
    const letztes = fokussierbar[fokussierbar.length - 1];
    if (e.shiftKey && (document.activeElement === erstes || document.activeElement === blatt)) {
      e.preventDefault();
      letztes.focus();
    } else if (!e.shiftKey && document.activeElement === letztes) {
      e.preventDefault();
      erstes.focus();
    }
  });
}

export { istOffen as istDetailOffen };

// ---------------------------------------------
// Rendern
// ---------------------------------------------
async function rendereInhalt() {
  const auslage = findeAuslage(aktuelleId);
  if (!auslage) { schliesseDetail(); return; }

  if (modus === 'bearbeiten' && auslage.einreichungId) modus = 'anzeige';
  if (modus === 'bearbeiten') {
    gibBelegFrei();
    inhalt.innerHTML = bearbeitenHtml(auslage);
    richteBearbeitenEin(inhalt.querySelector('#formBearbeiten'));
    return;
  }

  // Rückfragen zu diesem Posten (Verlauf der Einreichung, meist schon geladen)
  if (auslage.einreichungId) await ladeVerlauf(auslage.einreichungId);

  let beleg = null;
  if (auslage.hatFoto) {
    beleg = await holeBeleg(auslage.id).catch((err) => {
      console.error('[VereinsAuslagen] Beleg-Ladefehler:', err);
      return null;
    });
  }
  if (aktuelleId !== auslage.id || modus !== 'anzeige') return; // inzwischen gewechselt

  gibBelegFrei();
  if (beleg) belegUrl = URL.createObjectURL(beleg);
  inhalt.innerHTML = anzeigeHtml(auslage, beleg);
}

function kopfHtml(titel, untertitel) {
  return `
    <div class="modal-griff" aria-hidden="true"></div>
    <div class="modal-kopf">
      <div class="modal-kopf__text">
        <h2 class="modal-titel" id="modalTitel">${escapeHtml(titel)}</h2>
        ${untertitel ? `<div class="modal-untertitel">${escapeHtml(untertitel)}</div>` : ''}
      </div>
      <button type="button" class="modal-schliessen" data-aktion="detail-schliessen" aria-label="Schließen">✕</button>
    </div>`;
}

function anzeigeHtml(auslage, beleg) {
  const info = statusInfo(auslage.status);
  const statusHinweis = auslage.einreichungId
    ? `<p class="klein-hinweis klein-hinweis--links sperr-hinweis">🔒 Teil der Einreichung
        „${escapeHtml(einreichungsText(auslage))}“.
        ${auslage.veranlasstAm ? `Erstattung veranlasst am ${formatiereZeitpunkt(auslage.veranlasstAm)}${auslage.veranlasstVon
          ? ` von ${escapeHtml(auslage.veranlasstVon)}` : ''}.` : ''}
        Einzeln lässt sich die Auslage nicht ändern oder löschen. Den Status änderst du für die ganze
        Einreichung in der Übersicht${auslage.veranlasstAm ? '' : ' – dort kannst du sie auch zurückziehen'}.</p>`
    : `<p class="klein-hinweis klein-hinweis--links">Zum Einreichen in der Übersicht „📨 Einreichen …“ wählen.</p>`;

  return `
    ${kopfHtml(auslage.haendler, formatiereDatum(auslage.datum))}

    <div class="info-kasten info-kasten--betrag">
      <span class="info-kasten__label">Betrag</span>
      <span class="info-kasten__betrag">${formatiereBetrag(auslage.betrag)}</span>
    </div>

    ${auslage.notiz ? `
    <div class="info-kasten">
      <div class="info-kasten__label">Verwendungszweck</div>
      <div class="info-kasten__text">${escapeHtml(auslage.notiz)}</div>
    </div>` : ''}

    <div class="info-kasten">
      <div class="info-kasten__label">Status</div>
      <div class="status-anzeige"><span class="badge badge--${info.key}">${info.icon} ${info.label}</span></div>
      ${statusHinweis}
    </div>

    ${auslage.einreichungId ? kommentareZurAuslageHtml(auslage.einreichungId, auslage.id) : ''}

    <div class="modal-abschnitt">
      <div class="abschnitt-label">Kassenbon / Rechnung</div>
      ${belegHtml(auslage, beleg)}
    </div>

    ${auslage.einreichungId ? '' : `
    <div class="modal-aktionen">
      <button type="button" class="btn btn-sekundaer" data-aktion="detail-bearbeiten">✏️ Angaben bearbeiten</button>
      <button type="button" class="btn btn-gefahr" data-aktion="detail-loeschen">🗑 Auslage löschen</button>
    </div>`}
  `;
}

function belegHtml(auslage, beleg) {
  if (auslage.einreichungId) return belegNurAnsehenHtml(auslage, beleg);
  if (!beleg) {
    return `
      <div class="beleg-fehlt">
        <div class="beleg-fehlt__icon" aria-hidden="true">⚠</div>
        <div class="beleg-fehlt__titel">
          ${auslage.hatFoto ? 'Beleg nicht mehr auffindbar' : 'Kein Beleg hinterlegt'}
        </div>
      </div>
      ${belegKnoepfeHtml('detail')}`;
  }

  const anzeige = istPdf(beleg)
    ? `<div class="beleg-anzeige beleg-anzeige--pdf">
        <span class="pdf-icon" aria-hidden="true">📄</span>
        <span>PDF-Beleg · ${formatiereGroesse(beleg.size)}</span>
      </div>
      <a class="btn btn-sekundaer btn-klein beleg-oeffnen" href="${belegUrl}" target="_blank" rel="noopener">PDF öffnen</a>`
    : `<div class="beleg-anzeige">
        <img src="${belegUrl}" alt="Beleg von ${escapeHtml(auslage.haendler)}">
      </div>`;

  return `
    ${anzeige}
    <div class="knopf-reihe beleg-aktionen">
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="detail-beleg-download">⬇ Herunterladen</button>
      <button type="button" class="btn btn-gefahr btn-klein" data-aktion="detail-beleg-entfernen">Entfernen</button>
    </div>
    ${belegKnoepfeHtml('detail', { ersetzen: true })}`;
}

/** Eingereichte Auslage: Beleg nur ansehen und herunterladen */
function belegNurAnsehenHtml(auslage, beleg) {
  if (!beleg) {
    return `
      <div class="beleg-fehlt">
        <div class="beleg-fehlt__icon" aria-hidden="true">⚠</div>
        <div class="beleg-fehlt__titel">Kein Beleg hinterlegt</div>
      </div>`;
  }
  return `
    ${istPdf(beleg)
      ? `<div class="beleg-anzeige beleg-anzeige--pdf">
          <span class="pdf-icon" aria-hidden="true">📄</span>
          <span>PDF-Beleg · ${formatiereGroesse(beleg.size)}</span>
        </div>
        <a class="btn btn-sekundaer btn-klein beleg-oeffnen" href="${belegUrl}" target="_blank" rel="noopener">PDF öffnen</a>`
      : `<div class="beleg-anzeige"><img src="${belegUrl}" alt="Beleg von ${escapeHtml(auslage.haendler)}"></div>`}
    <div class="knopf-reihe beleg-aktionen">
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="detail-beleg-download">⬇ Herunterladen</button>
    </div>`;
}

function bearbeitenHtml(auslage) {
  return `
    ${kopfHtml('Auslage bearbeiten')}
    <form class="formular" id="formBearbeiten" novalidate autocomplete="off">
      <div>
        <label class="formular-label" for="bearbDatum">Datum der Auslage</label>
        <input type="date" id="bearbDatum" name="datum" class="formular-feld"
          value="${escapeHtml(auslage.datum)}" max="${heuteISO()}" required>
      </div>
      <div>
        <label class="formular-label" for="bearbHaendler">Geschäft / Händler</label>
        <input type="text" id="bearbHaendler" name="haendler" class="formular-feld"
          list="bearbHaendlerVorschlaege" maxlength="100" autocorrect="off" spellcheck="false" required
          value="${escapeHtml(auslage.haendler)}">
        ${haendlerDatalistHtml('bearbHaendlerVorschlaege')}
      </div>
      <div>
        <label class="formular-label" for="bearbBetrag">Betrag</label>
        <div class="betrag-wrapper">
          <input type="text" id="bearbBetrag" name="betrag" class="formular-feld"
            inputmode="decimal" required value="${betragAlsText(auslage.betrag)}">
        </div>
      </div>
      <div>
        <label class="formular-label" for="bearbNotiz">
          Verwendungszweck <span class="formular-label__optional">(optional)</span>
        </label>
        <textarea id="bearbNotiz" name="notiz" class="formular-feld" rows="2" maxlength="500">${escapeHtml(auslage.notiz)}</textarea>
      </div>
      <div class="knopf-reihe">
        <button type="button" class="btn btn-sekundaer" data-aktion="detail-abbrechen">Abbrechen</button>
        <button type="submit" class="btn btn-primaer">Speichern</button>
      </div>
    </form>
  `;
}

function richteBearbeitenEin(form) {
  form.addEventListener('input', (e) => e.target.removeAttribute('aria-invalid'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const daten = {
      datum:    f.datum.value,
      haendler: f.haendler.value.trim(),
      betrag:   parseBetrag(f.betrag.value),
      notiz:    f.notiz.value.trim()
    };
    const fehler = pruefeEingaben(daten);
    markiereFehler(form, fehler?.feld);
    if (fehler) { zeigeToast(`⚠ ${fehler.text}`); return; }

    try {
      await aktualisiereAuslage(aktuelleId, daten);
      modus = 'anzeige';
      zeigeToast('✓ Änderungen gespeichert');
      meldeDatenAenderung();
      rendereInhalt();
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 4000);
    }
  });
}

// ---------------------------------------------
// Aktionen
// ---------------------------------------------
registriereAktionen({
  'detail': (btn) => oeffneDetail(btn.dataset.id),

  'detail-schliessen': () => schliesseDetail(),

  'beleg:detail': async (input) => {
    const datei = input.files?.[0];
    input.value = '';
    if (!datei || !aktuelleId) return;
    const id = aktuelleId;
    try {
      const blob = await bereiteBelegVor(datei);
      await setzeBeleg(id, blob);
      zeigeToast('✓ Beleg gespeichert');
      meldeDatenAenderung();
      if (aktuelleId === id) await rendereInhalt();
    } catch (err) {
      console.error('[VereinsAuslagen] Beleg-Fehler:', err);
      zeigeToast(`⚠ ${err.message || 'Beleg konnte nicht gespeichert werden'}`, 4000);
    }
  },

  'detail-beleg-download': async () => {
    const auslage = findeAuslage(aktuelleId);
    const blob = auslage && await holeBeleg(auslage.id);
    if (!blob) { zeigeToast('⚠ Kein Beleg gefunden'); return; }
    const name = sichererDateiname(`Beleg_${auslage.datum}_${auslage.haendler}`);
    ladeDateiHerunter(blob, `${name}.${dateiEndung(blob.type)}`);
  },

  'detail-beleg-entfernen': async () => {
    if (!window.confirm('Beleg wirklich entfernen?')) return;
    try {
      await setzeBeleg(aktuelleId, null);
      zeigeToast('Beleg entfernt');
      meldeDatenAenderung();
      await rendereInhalt();
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 4000);
    }
  },

  'detail-bearbeiten': () => {
    modus = 'bearbeiten';
    rendereInhalt();
    blatt.scrollTop = 0;
    inhalt.querySelector('#bearbHaendler')?.focus({ preventScroll: true });
  },

  'detail-abbrechen': () => {
    modus = 'anzeige';
    rendereInhalt();
  },

  'detail-loeschen': async () => {
    const auslage = findeAuslage(aktuelleId);
    if (!auslage) return;
    if (!window.confirm(`„${auslage.haendler}“ wirklich löschen?\n\nDies kann nicht rückgängig gemacht werden.`)) return;
    try {
      await loescheAuslage(auslage.id);
      schliesseDetail();
      zeigeToast('🗑 Auslage gelöscht');
      meldeDatenAenderung();
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 4000);
    }
  }
});
