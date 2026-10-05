// =============================================
// ANSICHT 5: KASSE (nur Kassenwart und Vorstand)
// Eingereichte Auslagen aller Mitglieder, gebündelt nach Einreichung (bzw. einzeln
// eingereichte Auslagen je Mitglied). Offene Auslagen sind hier nie sichtbar.
// - Kassenwart: „Erstattung veranlasst“ setzen oder zurücknehmen, IBAN sichtbar
// - Vorstand: nur lesen
// Die Daten kommen nicht aus speicher.js (dort nur eigene Auslagen), sondern direkt vom Server.
// =============================================
import {
  statusInfo, escapeHtml, formatiereDatum, formatiereBetrag, formatiereZeitpunkt, plural, summe,
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
  const anzahl = (s) => (s === 'alle' ? auslagen.length : auslagen.filter((a) => a.status === s).length);

  container.innerHTML = `
    <div class="ansicht">
      <div class="kasse-kopf">
        <h2 class="seiten-titel">Kasse</h2>
        <button type="button" class="btn btn-sekundaer btn-klein kasse-kopf__knopf" data-aktion="kasse-neu-laden">🔄 Aktualisieren</button>
      </div>
      <p class="abschnitt__text">${istKassenwart()
        ? 'Eingereichte Auslagen aller Mitglieder. Hast du die Überweisung angestoßen, markiere sie mit „Erstattung veranlasst“ – das Mitglied bestätigt den Eingang selbst.'
        : 'Eingereichte Auslagen aller Mitglieder (nur lesend).'}</p>
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

/** Nach Einreichung bündeln; ohne Einreichung (Status von Hand gesetzt) je Mitglied */
function gruppiere(liste) {
  const gruppen = new Map();
  for (const a of liste) {
    const schluessel = a.einreichungId || `einzeln-${a.mitglied.id}`;
    if (!gruppen.has(schluessel)) {
      gruppen.set(schluessel, { schluessel, mitglied: a.mitglied, eingereichtAm: a.eingereichtAm, auslagen: [] });
    }
    gruppen.get(schluessel).auslagen.push(a);
  }
  return [...gruppen.values()];
}

function gruppeHtml(g) {
  const offen = g.auslagen.filter((a) => a.status === 'eingereicht');
  const veranlasst = g.auslagen.filter((a) => a.status === 'veranlasst');
  const ids = (liste) => escapeHtml(liste.map((a) => a.id).join(','));

  const knoepfe = istKassenwart() ? [
    offen.length ? `<button type="button" class="btn btn-primaer btn-klein" data-aktion="kasse-veranlassen"
      data-ids="${ids(offen)}">💸 Erstattung veranlasst (${formatiereBetrag(summe(offen))})</button>` : '',
    veranlasst.length ? `<button type="button" class="btn btn-sekundaer btn-klein" data-aktion="kasse-zuruecknehmen"
      data-ids="${ids(veranlasst)}">↩ Veranlassung zurücknehmen</button>` : ''
  ].join('') : '';

  return `
    <li class="kasse-gruppe">
      <div class="kasse-gruppe__kopf">
        <div class="kasse-gruppe__text">
          <span class="kasse-gruppe__name">${escapeHtml(g.mitglied.name)}</span>
          <span class="kasse-gruppe__unter">${g.eingereichtAm
            ? `Eingereicht am ${formatiereZeitpunkt(g.eingereichtAm)}`
            : 'Ohne Einreichung (Status von Hand gesetzt)'}</span>
          ${g.mitglied.iban ? `<span class="kasse-gruppe__unter">IBAN ${escapeHtml(formatiereIban(g.mitglied.iban))}</span>` : ''}
        </div>
        <span class="kasse-gruppe__summe">${formatiereBetrag(summe(g.auslagen))}</span>
      </div>
      <ul class="kasse-posten">${g.auslagen.map(postenHtml).join('')}</ul>
      ${knoepfe ? `<div class="knopf-reihe knopf-reihe--umbruch">${knoepfe}</div>` : ''}
    </li>`;
}

function postenHtml(a) {
  const info = statusInfo(a.status);
  const veranlasst = a.veranlasstAm
    ? `<span class="kasse-posten__info">Veranlasst ${formatiereZeitpunkt(a.veranlasstAm)}${a.veranlasstVon ? ` von ${escapeHtml(a.veranlasstVon)}` : ''}</span>`
    : '';
  return `
    <li class="kasse-posten__zeile">
      <div class="kasse-posten__text">
        <span class="kasse-posten__haendler">${escapeHtml(a.haendler)}</span>
        <span class="kasse-posten__info">${formatiereDatum(a.datum)}${a.notiz ? ` · ${escapeHtml(a.notiz)}` : ''}</span>
        ${veranlasst}
        <span class="kasse-posten__merkmale">
          <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
          ${a.hatFoto
            ? `<button type="button" class="link-knopf" data-aktion="kasse-beleg" data-id="${escapeHtml(a.id)}">📎 Beleg ansehen</button>`
            : '<span class="auswahl-zeile__warnung">⚠ Kein Beleg</span>'}
        </span>
      </div>
      <span class="kasse-posten__betrag">${formatiereBetrag(a.betrag)}</span>
    </li>`;
}

/** Status setzen; danach Kassen- und eigene Daten neu laden (der Kassenwart kann selbst Einreicher sein) */
function setzeKassenStatus(btn, status, meldung) {
  const ids = btn.dataset.ids.split(',').filter(Boolean);
  return mitLadezustand(btn, async () => {
    try {
      await apiPost('kasse/status', { ids, status });
      zeigeToast(meldung(ids.length));
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

  'kasse-veranlassen': (btn) => setzeKassenStatus(btn, 'veranlasst',
    (n) => `✓ ${plural(n, 'Auslage', 'Auslagen')}: Erstattung veranlasst`),

  'kasse-zuruecknehmen': (btn) => {
    if (!window.confirm('Veranlassung wirklich zurücknehmen?\n\nDie Auslagen stehen danach wieder auf „Eingereicht“ und können vom Mitglied wieder geändert oder gelöscht werden.')) return;
    return setzeKassenStatus(btn, 'eingereicht', () => 'Veranlassung zurückgenommen');
  },

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
