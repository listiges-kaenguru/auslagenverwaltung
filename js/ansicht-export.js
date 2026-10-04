// =============================================
// ANSICHT 3: EXPORT & DATENSICHERUNG
// =============================================
import {
  escapeHtml, statusInfo, formatiereDatum, formatiereBetrag, plural, summe, zeigeToast, mitLadezustand,
  registriereAktionen, meldeDatenAenderung
} from './hilfen.js';
import { ladeAuslagen, letztesBackup } from './speicher.js';
import {
  AUSWAHL_LISTE, auswahlLabel, auslagenFuerAuswahl, exportiereCSV, exportierePaket, exportierePdf,
  kannDateienTeilen, teileExport, erstelleBackup, spieleBackupEin
} from './export.js';
import { einreichenKnopfHtml } from './einreichen.js';

const BACKUP_ERINNERUNG_TAGE = 30;

let auswahl = 'eingereicht';

export function rendereExport(container) {
  const auslagen = auslagenFuerAuswahl(auswahl);
  const mitBeleg = auslagen.filter((a) => a.hatFoto).length;
  const label    = auswahlLabel(auswahl);

  const chipsHtml = AUSWAHL_LISTE.map((a) => `
    <button type="button" class="filter-chip" data-aktion="export-auswahl" data-auswahl="${a}"
      aria-pressed="${a === auswahl}">
      ${escapeHtml(auswahlLabel(a))} <span class="filter-chip__anzahl">${auslagenFuerAuswahl(a).length}</span>
    </button>`).join('');

  const listeHtml = auslagen.map((a) => `
    <div class="export-zeile">
      <div class="export-zeile__links">
        <span class="export-zeile__haendler">${escapeHtml(a.haendler)}</span>
        <span class="export-zeile__datum">${formatiereDatum(a.datum)}</span>
        ${a.hatFoto
          ? '<span class="export-zeile__beleg" title="Beleg vorhanden" aria-label="Beleg vorhanden">📎</span>'
          : '<span class="export-zeile__beleg export-zeile__beleg--fehlt" title="Kein Beleg" aria-label="Kein Beleg">⚠</span>'}
        ${auswahl === 'alle'
          ? `<span class="badge badge--${statusInfo(a.status).key} export-zeile__status">${statusInfo(a.status).label}</span>`
          : ''}
      </div>
      <span class="export-zeile__betrag">${formatiereBetrag(a.betrag)}</span>
    </div>`).join('');

  const exportHtml = auslagen.length === 0
    ? `<div class="leer-zustand">
        <div class="leer-zustand__icon" aria-hidden="true">📭</div>
        <div class="leer-zustand__titel">Keine Auslagen</div>
        <div class="leer-zustand__text">
          ${auswahl === 'alle'
            ? 'Erfasse deine erste Auslage über „Neu“.'
            : `Es gibt keine Auslagen mit Status „${escapeHtml(label)}“.`}
        </div>
      </div>`
    : `<div class="export-liste">
        <div class="export-liste__titel">Enthaltene Auslagen</div>
        ${listeHtml}
        <div class="export-summe"><span>Gesamt</span><span>${formatiereBetrag(summe(auslagen))}</span></div>
      </div>

      <div class="knopf-stapel">
        ${auswahl === 'offen' ? `
        ${einreichenKnopfHtml()}
        <p class="klein-hinweis klein-hinweis--oben">
          Erstellt eine PDF mit Übersicht und Belegen. Nach dem Herunterladen stehen die Auslagen auf „Eingereicht“.
        </p>` : ''}
        <button type="button" class="btn ${auswahl === 'offen' ? 'btn-sekundaer' : 'btn-blau'}" data-aktion="export-pdf">
          📄 PDF (Übersicht + ${plural(mitBeleg, 'Beleg', 'Belege')})
        </button>
        <button type="button" class="btn btn-sekundaer" data-aktion="export-paket">
          🗜 Komplettpaket (ZIP: CSV + Belege)
        </button>
        <button type="button" class="btn btn-sekundaer" data-aktion="export-csv">
          📊 Nur CSV-Tabelle
        </button>
        ${kannDateienTeilen() ? `
        <button type="button" class="btn btn-sekundaer" data-aktion="export-teilen">
          📤 Teilen (Mail, Messenger …)
        </button>` : ''}
        <p class="klein-hinweis">
          Der Export ändert keinen Status. Die CSV-Datei öffnet sich direkt in Excel (UTF-8, Semikolon).
          Im ZIP sind die Belege nach Datum, Händler und Betrag benannt und in der CSV verknüpft.
        </p>
      </div>`;

  container.innerHTML = `
    <div class="ansicht">
      <h2 class="seiten-titel seiten-titel--mit-intro">Export</h2>
      <p class="seiten-intro">
        Wähle aus, welche Auslagen du als PDF, CSV-Tabelle oder ZIP mit allen Belegen exportieren möchtest.
      </p>

      <div class="filter-leiste filter-leiste--oben" role="group" aria-label="Auslagen für den Export auswählen">
        ${chipsHtml}
      </div>

      <div class="export-statistik export-statistik--${auswahl}">
        <div class="export-statistik__label">${escapeHtml(label)}</div>
        <div class="export-statistik__betrag">${formatiereBetrag(summe(auslagen))}</div>
        <div class="export-statistik__unter">
          ${plural(auslagen.length, 'Auslage', 'Auslagen')} · ${mitBeleg} mit Beleg
        </div>
      </div>

      ${exportHtml}

      <section class="abschnitt" aria-labelledby="titelBackup">
        <h3 class="abschnitt__titel" id="titelBackup">Datensicherung &amp; Import</h3>
        <p class="abschnitt__text ${backupWarnung() ? 'abschnitt__text--warnung' : ''}">
          ${backupText()}
        </p>
        <div class="knopf-reihe">
          <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="backup-erstellen">
            💾 Backup speichern
          </button>
          <label class="btn btn-sekundaer btn-klein">
            <input type="file" class="visuell-versteckt" accept=".zip,application/zip,application/x-zip-compressed"
              data-datei-aktion="backup-einspielen">
            ♻️ Backup einspielen
          </label>
        </div>
      </section>
    </div>
  `;
}

function tageSeitBackup() {
  const zeitpunkt = letztesBackup();
  if (!zeitpunkt) return null;
  return Math.floor((Date.now() - new Date(zeitpunkt).getTime()) / 86_400_000);
}

function backupWarnung() {
  if (ladeAuslagen().length === 0) return false;
  const tage = tageSeitBackup();
  return tage === null || tage >= BACKUP_ERINNERUNG_TAGE;
}

function backupText() {
  const basis = 'Deine Daten liegen auf dem Server des Vereins. Ein Backup enthält alle deine Auslagen und Belege als ZIP. '
    + 'Über „Backup einspielen“ lassen sich auch Backups der bisherigen Einzelplatz-App übernehmen.';
  const zeitpunkt = letztesBackup();
  if (!zeitpunkt) {
    return ladeAuslagen().length > 0 ? `⚠ Noch kein Backup erstellt. ${basis}` : basis;
  }
  const datum = formatiereDatum(zeitpunkt.slice(0, 10));
  return backupWarnung()
    ? `⚠ Letztes Backup: ${datum} – bitte aktualisieren. ${basis}`
    : `Letztes Backup: ${datum}. ${basis}`;
}

/** Aktion mit Ladezustand und einheitlicher Fehlerbehandlung ausführen */
function mitFehlerbehandlung(btn, aktion) {
  return mitLadezustand(btn, async () => {
    try {
      await aktion();
    } catch (err) {
      console.error('[VereinsAuslagen] Export-Fehler:', err);
      zeigeToast(`⚠ ${err.message || 'Export fehlgeschlagen'} (${err.name || 'Fehler'})`, 8000);
    }
  });
}

registriereAktionen({
  'export-auswahl': (btn) => {
    auswahl = btn.dataset.auswahl || 'eingereicht';
    document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  },

  'export-pdf': (btn) => mitFehlerbehandlung(btn, async () => {
    zeigeToast('📄 PDF wird erstellt …', 15_000);
    const belegFehler = await exportierePdf(auswahl);
    zeigeToast(belegFehler
      ? `⚠ PDF erstellt – ${plural(belegFehler, 'Beleg', 'Belege')} nicht eingebettet`
      : '📄 PDF erstellt', 4000);
  }),

  'export-csv': (btn) => mitFehlerbehandlung(btn, async () => {
    exportiereCSV(auswahl);
    zeigeToast('📊 CSV exportiert');
  }),

  'export-paket': (btn) => mitFehlerbehandlung(btn, async () => {
    zeigeToast('🗜 ZIP wird erstellt …', 10_000);
    const anzahl = await exportierePaket(auswahl);
    zeigeToast(`🗜 ZIP mit ${plural(anzahl, 'Beleg', 'Belegen')} erstellt`);
  }),

  'export-teilen': (btn) => mitFehlerbehandlung(btn, async () => {
    if (await teileExport(auswahl)) zeigeToast('📤 Geteilt');
  }),

  'backup-erstellen': (btn) => mitFehlerbehandlung(btn, async () => {
    zeigeToast('💾 Backup wird erstellt …', 10_000);
    const anzahl = await erstelleBackup();
    zeigeToast(`💾 Backup mit ${plural(anzahl, 'Auslage', 'Auslagen')} gespeichert`);
    meldeDatenAenderung(); // Hinweis „Letztes Backup“ aktualisieren
  }),

  'backup-einspielen': async (input) => {
    const datei = input.files?.[0];
    input.value = '';
    if (!datei) return;
    zeigeToast('♻️ Backup wird eingelesen …', 60_000);
    try {
      const { importiert, uebersprungen, fehler } = await spieleBackupEin(datei,
        (n, gesamt) => zeigeToast(`♻️ Übertrage ${n} von ${gesamt} …`, 60_000));
      zeigeToast(`✓ ${importiert} importiert${uebersprungen ? `, ${uebersprungen} bereits vorhanden` : ''}`
        + (fehler.length ? ` · ⚠ ${fehler.length} fehlgeschlagen` : ''), 6000);
      if (fehler.length) console.warn('[VereinsAuslagen] Import-Fehler:', fehler);
      meldeDatenAenderung();
    } catch (err) {
      console.error('[VereinsAuslagen] Import-Fehler:', err);
      zeigeToast(`⚠ ${err.message || 'Import fehlgeschlagen'}`, 4000);
    }
  }
});
