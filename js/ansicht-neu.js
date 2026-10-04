// =============================================
// ANSICHT 1: NEUE AUSLAGE ERFASSEN
// Eingaben bleiben als Entwurf erhalten, wenn zwischen Ansichten gewechselt wird.
// =============================================
import {
  escapeHtml, heuteISO, parseBetrag, formatiereGroesse, zeigeToast,
  mitLadezustand, registriereAktionen, meldeDatenAenderung, navigiere
} from './hilfen.js';
import { legeAuslageAn } from './speicher.js';
import { maxBelegBytes } from './sitzung.js';
import { bereiteBelegVor, istPdf } from './bild.js';
import { belegKnoepfeHtml, haendlerDatalistHtml, pruefeEingaben, markiereFehler } from './beleg-ui.js';

function leererEntwurf() {
  return { datum: heuteISO(), haendler: '', betrag: '', notiz: '', beleg: null, belegName: '' };
}

const entwurf = leererEntwurf();
let vorschauUrl = null;

function gibVorschauFrei() {
  if (vorschauUrl) URL.revokeObjectURL(vorschauUrl);
  vorschauUrl = null;
}

export function rendereNeu(container) {
  const heute = heuteISO();

  container.innerHTML = `
    <div class="ansicht">
      <h2 class="seiten-titel">Neue Auslage</h2>

      <form class="formular" id="formNeu" novalidate autocomplete="off">
        <div>
          <label class="formular-label" for="eingabeDatum">Datum der Auslage</label>
          <input type="date" id="eingabeDatum" name="datum" class="formular-feld"
            value="${escapeHtml(entwurf.datum)}" max="${heute}" required>
        </div>

        <div>
          <label class="formular-label" for="eingabeHaendler">Geschäft / Händler</label>
          <input type="text" id="eingabeHaendler" name="haendler" class="formular-feld"
            placeholder="z. B. REWE, OBI, Amazon …" list="haendlerVorschlaege"
            autocapitalize="words" autocorrect="off" spellcheck="false"
            maxlength="100" enterkeyhint="next" required
            value="${escapeHtml(entwurf.haendler)}">
          ${haendlerDatalistHtml('haendlerVorschlaege')}
        </div>

        <div>
          <label class="formular-label" for="eingabeBetrag">Betrag</label>
          <div class="betrag-wrapper">
            <input type="text" id="eingabeBetrag" name="betrag" class="formular-feld"
              placeholder="0,00" inputmode="decimal" enterkeyhint="next" required
              value="${escapeHtml(entwurf.betrag)}">
          </div>
        </div>

        <div>
          <label class="formular-label" for="eingabeNotiz">
            Verwendungszweck <span class="formular-label__optional">(optional)</span>
          </label>
          <textarea id="eingabeNotiz" name="notiz" class="formular-feld" rows="2" maxlength="500"
            placeholder="z. B. Material für das Sommerfest">${escapeHtml(entwurf.notiz)}</textarea>
        </div>

        <div>
          <span class="formular-label" id="belegLabel">Kassenbon / Rechnung</span>
          <div class="beleg-bereich" id="belegBereich" role="group" aria-labelledby="belegLabel">
            ${belegBereichHtml()}
          </div>
        </div>

        <div class="status-hinweis">
          <span class="badge badge--offen">○ Offen</span>
          <span>Standardstatus nach Erfassung</span>
        </div>

        <button type="submit" class="btn btn-primaer" id="btnSpeichern">Auslage speichern</button>
      </form>
    </div>
  `;

  const form = container.querySelector('#formNeu');

  // Eingaben laufend im Entwurf merken
  form.addEventListener('input', (e) => {
    const feld = e.target;
    if (feld.name in entwurf) entwurf[feld.name] = feld.value;
    feld.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    speichern(form, form.querySelector('#btnSpeichern'));
  });

  richteDragAndDropEin(container.querySelector('#belegBereich'));
}

function belegBereichHtml() {
  if (!entwurf.beleg) {
    return `
      <div class="beleg-bereich__icon" aria-hidden="true">🧾</div>
      <div class="beleg-bereich__text">Foto aufnehmen, Datei wählen oder hierher ziehen</div>
      ${belegKnoepfeHtml('neu')}
    `;
  }

  const vorschau = istPdf(entwurf.beleg)
    ? `<div class="beleg-bereich__datei">📄 <span>${escapeHtml(entwurf.belegName || 'Beleg.pdf')}</span>
         (${formatiereGroesse(entwurf.beleg.size)})</div>`
    : `<img class="beleg-bereich__vorschau" src="${vorschauUrl}" alt="Vorschau des Belegs">`;

  return `
    ${vorschau}
    ${belegKnoepfeHtml('neu', { ersetzen: true })}
    <button type="button" class="btn btn-gefahr btn-klein beleg-entfernen" data-aktion="neu-beleg-entfernen">
      Beleg entfernen
    </button>
  `;
}

function aktualisiereBelegBereich() {
  const bereich = document.getElementById('belegBereich');
  if (bereich) bereich.innerHTML = belegBereichHtml();
}

async function uebernehmeBeleg(datei) {
  const bereich = document.getElementById('belegBereich');
  bereich?.setAttribute('aria-busy', 'true');
  try {
    const blob = await bereiteBelegVor(datei);
    if (blob.size > maxBelegBytes()) {
      throw new Error(`Beleg ist zu groß (max. ${formatiereGroesse(maxBelegBytes())} auf diesem Server)`);
    }
    gibVorschauFrei();
    entwurf.beleg     = blob;
    entwurf.belegName = datei.name || '';
    if (!istPdf(blob)) vorschauUrl = URL.createObjectURL(blob);
    aktualisiereBelegBereich();
    zeigeToast(istPdf(blob) ? '📄 PDF übernommen' : '📷 Foto übernommen');
  } catch (err) {
    console.error('[VereinsAuslagen] Beleg-Fehler:', err);
    zeigeToast(`⚠ ${err.message || 'Beleg konnte nicht geladen werden'}`, 4000);
  } finally {
    bereich?.removeAttribute('aria-busy');
  }
}

function richteDragAndDropEin(bereich) {
  if (!bereich) return;
  const istDateiDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  bereich.addEventListener('dragover', (e) => {
    if (!istDateiDrag(e)) return;
    e.preventDefault();
    bereich.classList.add('drag-over');
  });
  bereich.addEventListener('dragleave', (e) => {
    // Nur beim Verlassen des Bereichs, nicht beim Wechsel auf ein Kind-Element
    if (!bereich.contains(e.relatedTarget)) bereich.classList.remove('drag-over');
  });
  bereich.addEventListener('drop', (e) => {
    e.preventDefault();
    bereich.classList.remove('drag-over');
    const datei = e.dataTransfer?.files?.[0];
    if (datei) uebernehmeBeleg(datei);
  });
}

async function speichern(form, btn) {
  const daten = {
    datum:    entwurf.datum,
    haendler: entwurf.haendler.trim(),
    betrag:   parseBetrag(entwurf.betrag),
    notiz:    entwurf.notiz.trim()
  };

  const fehler = pruefeEingaben(daten);
  markiereFehler(form, fehler?.feld);
  if (fehler) {
    zeigeToast(`⚠ ${fehler.text}`);
    return;
  }

  await mitLadezustand(btn, async () => {
    try {
      await legeAuslageAn(daten, entwurf.beleg);
      Object.assign(entwurf, leererEntwurf());
      gibVorschauFrei();
      zeigeToast('✓ Auslage gespeichert');
      meldeDatenAenderung();
      navigiere('uebersicht');
    } catch (err) {
      console.error('[VereinsAuslagen] Speicher-Fehler:', err);
      zeigeToast(`⚠ ${err.message || 'Fehler beim Speichern'}`, 4000);
    }
  });
}

registriereAktionen({
  'beleg:neu': (input) => {
    const datei = input.files?.[0];
    input.value = ''; // gleiche Datei erneut wählbar machen
    if (datei) uebernehmeBeleg(datei);
  },
  'neu-beleg-entfernen': () => {
    gibVorschauFrei();
    entwurf.beleg = null;
    entwurf.belegName = '';
    aktualisiereBelegBereich();
  }
});
