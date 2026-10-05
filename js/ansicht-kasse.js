// =============================================
// ANSICHT 5: KASSE (nur Kassenwart und Vorstand)
// Eingereichte Auslagen aller Mitglieder, gebündelt nach Einreichung. Offene Auslagen sind hier
// nie sichtbar. Aktionen gelten immer für die ganze Einreichung:
// - Kassenwart: „Erstattung veranlasst“ setzen oder zurücknehmen, IBAN sichtbar
// - Kassenwart und Vorstand: „Nicht genehmigen“ → Auslagen wieder offen beim Mitglied
// - Vorstand: sonst nur lesen
// Die Daten kommen nicht aus speicher.js (dort nur eigene Auslagen), sondern direkt vom Server.
// =============================================
import {
  statusInfo, escapeHtml, formatiereDatum, formatiereBetrag, formatiereZeitpunkt, plural, summe,
  gruppiereNachEinreichung, einreichungsText,
  sichererDateiname, dateiEndung, ladeDateiHerunter, zeigeToast, mitLadezustand, registriereAktionen,
  meldeDatenAenderung
} from './hilfen.js';
import { api, apiGet, apiPost, mitId } from './api.js';
import { istKassenwart } from './sitzung.js';
import { aktualisiereVomServer } from './speicher.js';
import { formatiereIban } from './stammdaten.js';

const NEU_LADEN_NACH_MS = 30_000;
const FILTER = [
  { id: 'eingereicht', label: 'Zu erledigen' },
  { id: 'veranlasst',  label: 'Veranlasst' },
  { id: 'erstattet',   label: 'Erstattet' },
  { id: 'alle',        label: 'Alle' }
];

let auslagen = null;     // Liste vom Server oder null (noch nicht geladen)
let geladenUm = 0;
let laedt = false;
let ladeFehler = null;
let filter = 'eingereicht';

const neuRendern = () => document.dispatchEvent(new CustomEvent('ansicht-rendern'));

async function ladeDaten() {
  laedt = true;
  try {
    auslagen = (await apiGet('kasse/auslagen')).auslagen;
    ladeFehler = null;
  } catch (err) {
    ladeFehler = err.message;
  } finally {
    geladenUm = Date.now();
    laedt = false;
  }
  neuRendern();
}

/** Beim Abmelden vergessen (fremde Daten!) */
export function vergissKassenDaten() {
  auslagen = null;
  geladenUm = 0;
  ladeFehler = null;
  filter = 'eingereicht';
}

export function rendereKasse(container) {
  if (!laedt && Date.now() - geladenUm > NEU_LADEN_NACH_MS) ladeDaten();

  if (auslagen === null) {
    container.innerHTML = `<div class="ansicht">
      <h2 class="seiten-titel">Kasse</h2>
      <p class="lade-hinweis">${ladeFehler ? `⚠ ${escapeHtml(ladeFehler)}` : 'Lade eingereichte Auslagen …'}</p>
    </div>`;
    return;
  }

  const gefiltert = filter === 'alle' ? auslagen : auslagen.filter((a) => a.status === filter);
  const gruppen = gruppiere(gefiltert);
  // Filter zählen Einreichungen, nicht Einzelposten
  const anzahl = (s) => gruppiere(s === 'alle' ? auslagen : auslagen.filter((a) => a.status === s)).length;

  container.innerHTML = `
    <div class="ansicht">
      <div class="kasse-kopf">
        <h2 class="seiten-titel">Kasse</h2>
        <button type="button" class="btn btn-sekundaer btn-klein kasse-kopf__knopf" data-aktion="kasse-neu-laden">🔄 Aktualisieren</button>
      </div>
      <p class="abschnitt__text">${istKassenwart()
        ? 'Eingereichte Auslagen aller Mitglieder. Hast du die Überweisung angestoßen, markiere die Einreichung mit „Erstattung veranlasst“ – das Mitglied bestätigt den Eingang selbst.'
        : 'Eingereichte Auslagen aller Mitglieder. Eine Einreichung, die nicht genehmigt wird, geht mit „Nicht genehmigen“ an das Mitglied zurück.'}</p>
      ${ladeFehler ? `<p class="klein-hinweis klein-hinweis--links">⚠ ${escapeHtml(ladeFehler)}</p>` : ''}

      <div class="zusammenfassung-karte">
        <div class="zusammenfassung-karte__label">${escapeHtml(FILTER.find((f) => f.id === filter).label)}</div>
        <div class="zusammenfassung-karte__betrag">${formatiereBetrag(summe(gefiltert))}</div>
        <div class="zusammenfassung-karte__anzahl">${plural(gefiltert.length, 'Auslage', 'Auslagen')}
          · ${plural(gruppen.length, 'Einreichung', 'Einreichungen')}</div>
      </div>

      <div class="filter-leiste" role="group" aria-label="Nach Status filtern">
        ${FILTER.map((f) => `
          <button type="button" class="filter-chip" data-aktion="kasse-filter" data-filter="${f.id}"
            aria-pressed="${filter === f.id}">
            ${escapeHtml(f.label)} <span class="filter-chip__anzahl">${anzahl(f.id)}</span>
          </button>`).join('')}
      </div>

      ${gruppen.length === 0
        ? `<div class="leer-zustand">
            <div class="leer-zustand__icon" aria-hidden="true">${filter === 'eingereicht' ? '✅' : '📭'}</div>
            <div class="leer-zustand__titel">${filter === 'eingereicht' ? 'Nichts zu erledigen' : 'Keine Auslagen'}</div>
          </div>`
        : `<ul class="kasse-liste">${gruppen.map(gruppeHtml).join('')}</ul>`}
    </div>`;
}

/** Nach Einreichung bündeln; jede Gruppe kennt ihr Mitglied */
function gruppiere(liste) {
  return gruppiereNachEinreichung(liste).map((g) => ({ ...g, mitglied: g.auslagen[0].mitglied }));
}

function gruppeHtml(g) {
  const id = escapeHtml(g.id);
  const ablehnen = `<button type="button" class="btn btn-gefahr btn-klein" data-aktion="kasse-ablehnen" data-id="${id}">✖ Nicht genehmigen</button>`;
  const knoepfe = g.status === 'eingereicht'
    ? (istKassenwart() ? `<button type="button" class="btn btn-primaer btn-klein" data-aktion="kasse-veranlassen" data-id="${id}">
        💸 Erstattung veranlasst (${formatiereBetrag(summe(g.auslagen))})</button>` : '') + ablehnen
    : (g.status === 'veranlasst' && istKassenwart()
      ? `<button type="button" class="btn btn-sekundaer btn-klein" data-aktion="kasse-zuruecknehmen" data-id="${id}">↩ Veranlassung zurücknehmen</button>`
      : '');
  const info = statusInfo(g.status);
  const pdf = g.hatPdf
    ? `<button type="button" class="btn btn-sekundaer btn-klein" data-aktion="kasse-einreichung-pdf" data-id="${id}">📄 Einreichungs-PDF</button>`
    : '';

  return `
    <li class="kasse-gruppe">
      <div class="kasse-gruppe__kopf">
        <div class="kasse-gruppe__text">
          <span class="kasse-gruppe__name">${escapeHtml(g.mitglied.name)}</span>
          <span class="kasse-gruppe__unter">${escapeHtml(einreichungsText(g))} · ${plural(g.auslagen.length, 'Auslage', 'Auslagen')}</span>
          ${g.mitglied.iban ? `<span class="kasse-gruppe__unter">IBAN ${escapeHtml(formatiereIban(g.mitglied.iban))}</span>` : ''}
          ${g.veranlasstAm ? `<span class="kasse-gruppe__unter">Veranlasst ${formatiereZeitpunkt(g.veranlasstAm)}${g.veranlasstVon
            ? ` von ${escapeHtml(g.veranlasstVon)}` : ''}</span>` : ''}
        </div>
        <div class="kasse-gruppe__rechts">
          <span class="kasse-gruppe__summe">${formatiereBetrag(summe(g.auslagen))}</span>
          <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
        </div>
      </div>
      <ul class="kasse-posten">${g.auslagen.map(postenHtml).join('')}</ul>
      ${knoepfe || pdf ? `<div class="knopf-reihe knopf-reihe--umbruch">${pdf}${knoepfe}</div>` : ''}
    </li>`;
}

function postenHtml(a) {
  return `
    <li class="kasse-posten__zeile">
      <div class="kasse-posten__text">
        <span class="kasse-posten__haendler">${escapeHtml(a.haendler)}</span>
        <span class="kasse-posten__info">${formatiereDatum(a.datum)}${a.notiz ? ` · ${escapeHtml(a.notiz)}` : ''}</span>
        <span class="kasse-posten__merkmale">
          ${a.hatFoto
            ? `<button type="button" class="link-knopf" data-aktion="kasse-beleg" data-id="${escapeHtml(a.id)}">📎 Beleg ansehen</button>`
            : '<span class="auswahl-zeile__warnung">⚠ Kein Beleg</span>'}
        </span>
      </div>
      <span class="kasse-posten__betrag">${formatiereBetrag(a.betrag)}</span>
    </li>`;
}

/** Aktion für eine ganze Einreichung; danach Kassen- und eigene Daten neu laden (Kassenwart kann selbst Einreicher sein) */
function kassenAktion(btn, route, daten, meldung) {
  return mitLadezustand(btn, async () => {
    try {
      await apiPost(route, daten);
      zeigeToast(meldung, 4000);
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
    await aktualisiereVomServer().catch(() => {});
    geladenUm = 0;
    meldeDatenAenderung(); // → neu rendern → lädt die Kassendaten
  });
}

registriereAktionen({
  'kasse-filter': (btn) => {
    filter = btn.dataset.filter || 'eingereicht';
    neuRendern();
  },

  'kasse-neu-laden': (btn) => mitLadezustand(btn, ladeDaten),

  'kasse-veranlassen': (btn) => kassenAktion(btn, 'kasse/einreichung/status',
    { id: btn.dataset.id, status: 'veranlasst' }, '✓ Erstattung veranlasst'),

  'kasse-zuruecknehmen': (btn) => {
    if (!window.confirm('Veranlassung wirklich zurücknehmen?\n\nDie Einreichung steht danach wieder auf „Eingereicht“. Das Mitglied kann sie dann wieder zurückziehen.')) return;
    return kassenAktion(btn, 'kasse/einreichung/status', { id: btn.dataset.id, status: 'eingereicht' }, 'Veranlassung zurückgenommen');
  },

  'kasse-ablehnen': (btn) => {
    if (!window.confirm('Einreichung nicht genehmigen?\n\nAlle Auslagen dieser Einreichung gehen an das Mitglied zurück und stehen dort wieder auf „Offen“. Es kann sie ändern und neu einreichen. Sag dem Mitglied am besten Bescheid, warum.')) return;
    return kassenAktion(btn, 'kasse/einreichung/ablehnen', { id: btn.dataset.id }, 'Einreichung zurückgegeben – die Auslagen sind wieder offen');
  },

  'kasse-einreichung-pdf': (btn) => mitLadezustand(btn, async () => {
    const a = auslagen?.find((x) => x.einreichungId === btn.dataset.id);
    try {
      const blob = await api(mitId('kasse/einreichung/pdf', btn.dataset.id), { blob: true });
      const name = sichererDateiname(`Einreichung_${a?.mitglied.name || ''}_${(a?.eingereichtAm || '').slice(0, 10)}`);
      await ladeDateiHerunter(blob, `${name}.pdf`);
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 4000);
    }
  }),

  'kasse-beleg': (btn) => mitLadezustand(btn, async () => {
    const a = auslagen?.find((x) => x.id === btn.dataset.id);
    if (!a) return;
    try {
      const blob = await api(mitId('kasse/beleg', a.id), { blob: true });
      const name = sichererDateiname(`Beleg_${a.mitglied.name}_${a.datum}_${a.haendler}`);
      await ladeDateiHerunter(blob, `${name}.${dateiEndung(blob.type)}`);
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 4000);
    }
  })
});
