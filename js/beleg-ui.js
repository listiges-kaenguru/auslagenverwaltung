// =============================================
// GEMEINSAME UI-BAUSTEINE (Formular & Detail)
// =============================================
import { BELEG_ACCEPT } from './bild.js';
import { escapeHtml, heuteISO } from './hilfen.js';
import { ladeAuslagen } from './speicher.js';

/**
 * Zwei Auswahl-Knöpfe: Kamera (capture) und Datei (Galerie/Dateien/PDF).
 * Getrennt, weil capture="environment" auf Mobilgeräten sonst die Galerie sperrt.
 * Die Auswahl landet im Handler "beleg:<ziel>" (Event-Delegation in main.js).
 */
export function belegKnoepfeHtml(ziel, { ersetzen = false } = {}) {
  return `
    <div class="beleg-knoepfe">
      <label class="btn btn-sekundaer btn-klein">
        <input type="file" class="visuell-versteckt" accept="image/*" capture="environment"
          data-datei-aktion="beleg:${escapeHtml(ziel)}">
        📷 ${ersetzen ? 'Neues Foto' : 'Foto aufnehmen'}
      </label>
      <label class="btn btn-sekundaer btn-klein">
        <input type="file" class="visuell-versteckt" accept="${BELEG_ACCEPT}"
          data-datei-aktion="beleg:${escapeHtml(ziel)}">
        📁 ${ersetzen ? 'Andere Datei' : 'Datei wählen'}
      </label>
    </div>`;
}

/** Vorschläge für das Händler-Feld aus bisherigen Einträgen (häufigste zuerst) */
export function haendlerDatalistHtml(id) {
  const zaehler = new Map();
  for (const a of ladeAuslagen()) {
    const name = a.haendler.trim();
    if (name) zaehler.set(name, (zaehler.get(name) || 0) + 1);
  }
  const optionen = [...zaehler.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
    .slice(0, 50)
    .map(([name]) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
  return `<datalist id="${id}">${optionen}</datalist>`;
}

/** Eingaben prüfen → { feld, text } oder null */
export function pruefeEingaben({ datum, haendler, betrag }) {
  if (!datum)                            return { feld: 'datum',    text: 'Bitte Datum angeben' };
  if (datum > heuteISO())                return { feld: 'datum',    text: 'Datum liegt in der Zukunft' };
  if (!haendler)                         return { feld: 'haendler', text: 'Bitte Händler angeben' };
  if (!Number.isFinite(betrag) || betrag <= 0) return { feld: 'betrag', text: 'Bitte gültigen Betrag eingeben' };
  if (betrag >= 1_000_000)               return { feld: 'betrag',   text: 'Betrag ist unplausibel hoch' };
  return null;
}

/** Fehlerhaftes Feld markieren und fokussieren; andere Markierungen entfernen */
export function markiereFehler(form, feldName) {
  for (const feld of form.querySelectorAll('[aria-invalid]')) feld.removeAttribute('aria-invalid');
  const feld = feldName && form.elements[feldName];
  if (feld) {
    feld.setAttribute('aria-invalid', 'true');
    feld.focus();
  }
}
