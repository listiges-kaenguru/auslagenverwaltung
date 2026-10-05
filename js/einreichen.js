// =============================================
// EINREICHEN
// Offene Auslagen auswählen → PDF (Übersicht + Belege) erstellen → Einreichung anlegen
// (Status „Eingereicht“) → PDF zur Einreichung speichern → PDF anbieten.
// Bei „Abbrechen“ oder wenn das PDF nicht gespeichert werden kann, wird die Einreichung
// spurlos verworfen (nicht „zurückgezogen“) – jede Einreichung hat damit genau ein gespeichertes PDF.
// Die Einreichung ist ein eigener Datensatz, damit Kassenwart/Vorstand sie gebündelt sehen.
// Der Status wird bewusst VOR dem Anbieten gespeichert: „PDF öffnen“ kann die App-Seite
// verlassen (Firefox-App), und eine erst dann gestartete Anfrage ist nicht verlässlich.
// =============================================
import {
  escapeHtml, formatiereBetrag, formatiereDatum, plural, summe, zeigeToast, mitLadezustand,
  registriereAktionen, meldeDatenAenderung, ladeDateiHerunter, formatiereGroesse
} from './hilfen.js';
import { reicheEin, verwerfeEinreichung, speichereEinreichungsPdf } from './speicher.js';
import { maxPdfBytes } from './sitzung.js';
import { auslagenFuerAuswahl, erstelleEinreichung } from './export.js';
import { hatStammdaten } from './stammdaten.js';

/** Knopf „Einreichen“ – nur wenn es offene Auslagen gibt */
export function einreichenKnopfHtml() {
  const offene = auslagenFuerAuswahl('offen');
  if (offene.length === 0) return '';
  return `
    <button type="button" class="btn btn-primaer" data-aktion="einreichen">
      📨 Einreichen … (${plural(offene.length, 'offene Auslage', 'offene Auslagen')})
    </button>`;
}

// ---------------------------------------------
// Auswahldialog
// ---------------------------------------------
/** → Promise mit den ausgewählten Auslagen oder null (abgebrochen) */
function waehleAuslagen(offene) {
  const vorher = document.activeElement;
  const fenster = document.createElement('div');
  fenster.className = 'modal-hintergrund offen auswahl-dialog';
  fenster.innerHTML = `
    <div class="modal-blatt" role="dialog" aria-modal="true" aria-labelledby="auswahlTitel">
      <div class="modal-griff" aria-hidden="true"></div>
      <div class="modal-kopf">
        <div class="modal-kopf__text">
          <h2 class="modal-titel" id="auswahlTitel">Einreichen</h2>
          <div class="modal-untertitel">Welche offenen Auslagen möchtest du einreichen?</div>
        </div>
        <button type="button" class="modal-schliessen" data-ergebnis="abbrechen" aria-label="Schließen">✕</button>
      </div>

      <div class="auswahl-steuerung">
        <button type="button" class="btn btn-sekundaer btn-klein" data-alle="1">Alle auswählen</button>
        <button type="button" class="btn btn-sekundaer btn-klein" data-alle="0">Keine</button>
      </div>

      <ul class="auswahl-liste">
        ${offene.map((a) => `
          <li>
            <label class="auswahl-zeile">
              <input type="checkbox" class="auswahl-zeile__box" value="${escapeHtml(a.id)}" checked>
              <span class="auswahl-zeile__text">
                <span class="auswahl-zeile__haendler">${escapeHtml(a.haendler)}</span>
                <span class="auswahl-zeile__info">
                  ${formatiereDatum(a.datum)}${a.notiz ? ` · ${escapeHtml(a.notiz)}` : ''}
                </span>
                ${a.hatFoto ? '' : '<span class="auswahl-zeile__warnung">⚠ Kein Beleg</span>'}
              </span>
              <span class="auswahl-zeile__betrag">${formatiereBetrag(a.betrag)}</span>
            </label>
          </li>`).join('')}
      </ul>

      <div class="auswahl-fuss">
        <p class="auswahl-summe" aria-live="polite"></p>
        ${hatStammdaten() ? '' : `<p class="klein-hinweis">Tipp: Im Profil Name, IBAN und Ort hinterlegen –
          dann wird das Formular im PDF automatisch ausgefüllt.</p>`}
        <button type="button" class="btn btn-primaer" data-ergebnis="einreichen"></button>
      </div>
    </div>`;

  const boxen = [...fenster.querySelectorAll('.auswahl-zeile__box')];
  const knopf = fenster.querySelector('[data-ergebnis="einreichen"]');
  const summeEl = fenster.querySelector('.auswahl-summe');
  const gewaehlt = () => offene.filter((a) => boxen.find((b) => b.value === a.id)?.checked);

  const aktualisiere = () => {
    const liste = gewaehlt();
    const ohneBeleg = liste.filter((a) => !a.hatFoto).length;
    summeEl.innerHTML = `${liste.length} von ${offene.length} ausgewählt · <strong>${formatiereBetrag(summe(liste))}</strong>`
      + (ohneBeleg ? ` · <span class="auswahl-zeile__warnung">${plural(ohneBeleg, 'ohne Beleg', 'ohne Beleg')}</span>` : '');
    knopf.disabled = liste.length === 0;
    knopf.textContent = liste.length
      ? `📨 ${plural(liste.length, 'Auslage', 'Auslagen')} einreichen`
      : 'Bitte mindestens eine Auslage wählen';
  };

  return new Promise((resolve) => {
    const schliessen = (ergebnis) => {
      document.body.classList.remove('modal-offen');
      fenster.remove();
      vorher?.focus?.({ preventScroll: true });
      resolve(ergebnis);
    };
    fenster.addEventListener('change', aktualisiere);
    fenster.addEventListener('click', (e) => {
      const alle = e.target.closest('[data-alle]');
      if (alle) {
        for (const b of boxen) b.checked = alle.dataset.alle === '1';
        aktualisiere();
        return;
      }
      const ziel = e.target.closest('[data-ergebnis]');
      if (ziel?.dataset.ergebnis === 'einreichen' && !ziel.disabled) schliessen(gewaehlt());
      else if (ziel?.dataset.ergebnis === 'abbrechen' || e.target === fenster) schliessen(null);
    });
    fenster.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); schliessen(null); }
    });

    aktualisiere();
    document.getElementById('toast')?.classList.remove('sichtbar'); // nicht über der Summenzeile
    document.body.appendChild(fenster);
    document.body.classList.add('modal-offen');
    knopf.focus({ preventScroll: true });
  });
}

registriereAktionen({
  einreichen: async (btn) => {
    const offene = auslagenFuerAuswahl('offen');
    if (offene.length === 0) { zeigeToast('Keine offenen Auslagen'); return; }

    const auswahl = await waehleAuslagen(offene);
    if (!auswahl) return;

    return mitLadezustand(btn, async () => {
      zeigeToast('📄 PDF wird erstellt …', 15_000);
      const ids = auswahl.map((a) => a.id);
      try {
        const { blob, dateiname, belegFehler } = await erstelleEinreichung(auswahl);
        if (maxPdfBytes() && blob.size > maxPdfBytes()) {
          throw new Error(`Das PDF ist zu groß für den Server (${formatiereGroesse(blob.size)}, höchstens `
            + `${formatiereGroesse(maxPdfBytes())}). Bitte weniger Auslagen auf einmal einreichen.`);
        }
        const einreichungId = await reicheEin(ids);
        try {
          await speichereEinreichungsPdf(einreichungId, blob);
        } catch (err) {
          await verwerfeEinreichung(einreichungId).catch(() => {});
          meldeDatenAenderung();
          throw new Error(`PDF konnte nicht gespeichert werden – die Auslagen bleiben offen. ${err.message}`);
        }
        meldeDatenAenderung();

        if (!await ladeDateiHerunter(blob, dateiname)) {
          await verwerfeEinreichung(einreichungId);
          meldeDatenAenderung();
          zeigeToast('Abgebrochen – die Auslagen bleiben offen', 4000);
          return;
        }
        zeigeToast(belegFehler
          ? `⚠ Eingereicht – ${plural(belegFehler, 'Beleg', 'Belege')} bitte separat beifügen`
          : `✓ ${plural(auswahl.length, 'Auslage', 'Auslagen')} eingereicht`, 4000);
      } catch (err) {
        console.error('[VereinsAuslagen] Einreichen fehlgeschlagen:', err);
        zeigeToast(`⚠ ${err.message || 'PDF konnte nicht erstellt werden'}`, 8000);
      }
    });
  }
});
