// =============================================
// ANSICHT 5: KASSE (nur Kassenwart und Vorstand)
// Eingereichte Auslagen aller Mitglieder, gebündelt nach Einreichung. Offene Auslagen sind hier
// nie sichtbar. Aktionen gelten immer für die ganze Einreichung:
// - Kassenwart: „Erstattung veranlasst“ setzen oder zurücknehmen, IBAN sichtbar
// - Kassenwart und Vorstand: „Nicht genehmigen“ mit Begründung → Auslagen wieder offen beim
//   Mitglied, die Einreichung bleibt unter „Abgebrochen“ erhalten
// - Kassenwart und Vorstand: Rückfragen im Verlauf jeder Einreichung (kommentare.js)
// - Vorstand: sonst nur lesen
// Einreichungen sind einklappbar: unter „Zu erledigen“ aufgeklappt, sonst nur bei Ungelesenem.
// Filter „💬 Ungelesen“: Einreichungen mit neuen Kommentaren oder Statusänderungen anderer.
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
import { offenAttr } from './klappen.js';
import { verlaufHtml, abgebrochenHtml, kommentarMarkeHtml, veraltenVerlaeufe } from './kommentare.js';

const NEU_LADEN_NACH_MS = 30_000;
const FILTER = [
  { id: 'eingereicht', label: 'Zu erledigen' },
  { id: 'veranlasst',  label: 'Veranlasst' },
  { id: 'erstattet',   label: 'Erstattet' },
  { id: 'ungelesen',   label: '💬 Ungelesen' }, // neue Kommentare oder Statusänderungen anderer
  { id: 'alle',        label: 'Alle' }
];

let auslagen = null;     // Liste vom Server oder null (noch nicht geladen)
let einreichungen = [];  // Eckdaten aller Einreichungen (Kommentare, abgebrochene)
const ablehnenOffen = new Set(); // Einreichungen, deren Begründungsfeld gerade offen ist
const festgehalten = new Set();  // im Filter „Ungelesen“: beim Wählen ungelesene Einreichungen
const begruendungen = new Map(); // Entwürfe der Begründung
let geladenUm = 0;
let laedt = false;
let ladeFehler = null;
let filter = 'eingereicht';

const neuRendern = () => document.dispatchEvent(new CustomEvent('ansicht-rendern'));

async function ladeDaten() {
  laedt = true;
  try {
    ({ auslagen, einreichungen } = await apiGet('kasse/auslagen'));
    ladeFehler = null;
  } catch (err) {
    ladeFehler = err.message;
  } finally {
    geladenUm = Date.now();
    laedt = false;
  }
  neuRendern();
}

/** Für den Aktualisieren-Knopf in der Kopfzeile: Kassendaten neu laden (falls schon einmal geladen) */
export async function aktualisiereKasse() {
  if (auslagen === null) return;
  await ladeDaten();
  merkeUngelesene(); // „Aktualisieren“ setzt die festgehaltene Liste „Ungelesen“ neu
}

/** Beim Abmelden vergessen (fremde Daten!) */
export function vergissKassenDaten() {
  auslagen = null;
  einreichungen = [];
  ablehnenOffen.clear();
  begruendungen.clear();
  festgehalten.clear();
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

  const eckdaten = new Map(einreichungen.map((e) => [e.id, e]));
  const gruppenFuer = (f) => {
    if (f === 'alle') return gruppiere(auslagen);
    // Stabil, solange der Filter gewählt ist: was beim Wählen ungelesen war, bleibt sichtbar,
    // auch wenn es beim Aufklappen gelesen wird (sonst spränge es z. B. nach dem Antworten weg)
    if (f === 'ungelesen') {
      return gruppiere(auslagen).filter((g) => eckdaten.get(g.id)?.ungelesen > 0 || (filter === f && festgehalten.has(g.id)));
    }
    return gruppiere(auslagen.filter((a) => a.status === f));
  };
  const gruppen = gruppenFuer(filter);
  const gefiltert = gruppen.flatMap((g) => g.auslagen);
  // Filter zählen Einreichungen, nicht Einzelposten
  const anzahl = (f) => gruppenFuer(f).length;
  const abgebrochen = filter === 'alle' ? einreichungen.filter((e) => e.zustand !== 'aktiv') : [];
  const standardOffen = (g) => filter === 'eingereicht' || eckdaten.get(g.id)?.ungelesen > 0;

  container.innerHTML = `
    <div class="ansicht">
      <div class="ansicht-kopf">
        <h2 class="seiten-titel">Kasse</h2>
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
            <div class="leer-zustand__titel">${filter === 'eingereicht' ? 'Nichts zu erledigen' : 'Keine Einreichungen'}</div>
          </div>`
        : `<ul class="kasse-liste">${gruppen.map((g) => gruppeHtml(g, eckdaten.get(g.id), standardOffen(g))).join('')}</ul>`}
      ${abgebrochenHtml(abgebrochen, { pdfAktion: 'kasse-einreichung-pdf', mitMitglied: true })}
    </div>`;
}

/** Nach Einreichung bündeln; jede Gruppe kennt ihr Mitglied */
function gruppiere(liste) {
  return gruppiereNachEinreichung(liste).map((g) => ({ ...g, mitglied: g.auslagen[0].mitglied }));
}

function gruppeHtml(g, eckdaten, standardOffen) {
  const id = escapeHtml(g.id);
  const ablehnen = ablehnenOffen.has(g.id) ? '' : `<button type="button" class="btn btn-gefahr btn-klein" data-aktion="kasse-ablehnen" data-id="${id}">✖ Nicht genehmigen</button>`;
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
    <li>
     <details class="kasse-gruppe" data-klapp="ein:${id}" ${offenAttr(`ein:${g.id}`, standardOffen)}>
      <summary class="kasse-gruppe__kopf">
        <span class="kasse-gruppe__text">
          <span class="kasse-gruppe__name">${escapeHtml(g.mitglied.name)}</span>
          <span class="kasse-gruppe__unter">${escapeHtml(einreichungsText(g))} · ${plural(g.auslagen.length, 'Auslage', 'Auslagen')}</span>
          ${g.mitglied.iban ? `<span class="kasse-gruppe__unter">IBAN ${escapeHtml(formatiereIban(g.mitglied.iban))}</span>` : ''}
          ${g.veranlasstAm ? `<span class="kasse-gruppe__unter">Veranlasst ${formatiereZeitpunkt(g.veranlasstAm)}${g.veranlasstVon
            ? ` von ${escapeHtml(g.veranlasstVon)}` : ''}</span>` : ''}
        </span>
        <span class="kasse-gruppe__rechts">
          <span class="kasse-gruppe__summe">${formatiereBetrag(summe(g.auslagen))}</span>
          <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
          ${kommentarMarkeHtml(eckdaten)}
        </span>
      </summary>
      <div class="einreichung-karte__inhalt">
        <ul class="kasse-posten">${g.auslagen.map(postenHtml).join('')}</ul>
        ${verlaufHtml({ ...eckdaten, id: g.id }, g.auslagen)}
        ${ablehnenOffen.has(g.id) ? ablehnenFormularHtml(g) : ''}
        ${knoepfe || pdf ? `<div class="knopf-reihe knopf-reihe--umbruch">${pdf}${knoepfe}</div>` : ''}
      </div>
     </details>
    </li>`;
}

/** Filter „Ungelesen“: aktuell ungelesene Einreichungen festhalten */
function merkeUngelesene() {
  festgehalten.clear();
  for (const e of einreichungen) if (e.ungelesen > 0) festgehalten.add(e.id);
}

/** Begründung ist Pflicht – sie steht danach im Verlauf der (abgebrochenen) Einreichung */
function ablehnenFormularHtml(g) {
  const id = escapeHtml(g.id);
  return `
    <form class="kasse-ablehnen kasten" data-formular="kasse-ablehnen" data-id="${id}" novalidate>
      <label class="formular-label" for="begruendung-${id}">Warum wird die Einreichung nicht genehmigt?</label>
      <textarea id="begruendung-${id}" name="begruendung" class="formular-feld" rows="3" maxlength="2000"
        data-begruendung="${id}" required>${escapeHtml(begruendungen.get(g.id) || '')}</textarea>
      <p class="klein-hinweis klein-hinweis--links">Alle Auslagen gehen an ${escapeHtml(g.mitglied.name)} zurück und stehen
        dort wieder auf „Offen“. Die Begründung erscheint im Verlauf der Einreichung.</p>
      <div class="knopf-reihe">
        <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="kasse-ablehnen-abbrechen" data-id="${id}">Abbrechen</button>
        <button type="submit" class="btn btn-gefahr btn-klein">✖ Nicht genehmigen</button>
      </div>
    </form>`;
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
    veraltenVerlaeufe(); // z. B. Ablehnung: Begründung im Verlauf, Formular entfällt
    geladenUm = 0;
    meldeDatenAenderung(); // → neu rendern → lädt die Kassendaten
  });
}

registriereAktionen({
  'kasse-filter': (btn) => {
    filter = btn.dataset.filter || 'eingereicht';
    merkeUngelesene();
    neuRendern();
  },

  'kasse-veranlassen': (btn) => kassenAktion(btn, 'kasse/einreichung/status',
    { id: btn.dataset.id, status: 'veranlasst' }, '✓ Erstattung veranlasst'),

  'kasse-zuruecknehmen': (btn) => {
    if (!window.confirm('Veranlassung wirklich zurücknehmen?\n\nDie Einreichung steht danach wieder auf „Eingereicht“. Das Mitglied kann sie dann wieder zurückziehen.')) return;
    return kassenAktion(btn, 'kasse/einreichung/status', { id: btn.dataset.id, status: 'eingereicht' }, 'Veranlassung zurückgenommen');
  },

  'kasse-ablehnen': (btn) => {
    ablehnenOffen.add(btn.dataset.id);
    neuRendern();
    document.getElementById(`begruendung-${btn.dataset.id}`)?.focus();
  },

  'kasse-ablehnen-abbrechen': (btn) => {
    ablehnenOffen.delete(btn.dataset.id);
    neuRendern();
  },

  'formular:kasse-ablehnen': (form) => {
    const id = form.dataset.id;
    const begruendung = form.elements.begruendung.value.trim();
    if (!begruendung) { form.elements.begruendung.focus(); zeigeToast('⚠ Bitte eine Begründung angeben'); return; }
    ablehnenOffen.delete(id);
    begruendungen.delete(id);
    return kassenAktion(form.querySelector('[type="submit"]'), 'kasse/einreichung/ablehnen', { id, begruendung },
      'Einreichung zurückgegeben – die Auslagen sind wieder offen');
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

// Entwurf der Begründung beim Neu-Rendern behalten
document.addEventListener('input', (e) => {
  const id = e.target?.dataset?.begruendung;
  if (id) begruendungen.set(id, e.target.value);
});

// Kommentare gelesen/geschrieben → Zähler anpassen bzw. Eckdaten neu laden
document.addEventListener('kommentare-geaendert', (e) => {
  if (auslagen === null) return;
  const { einreichungId, gelesen } = e.detail || {};
  if (gelesen) {
    einreichungen = einreichungen.map((x) => (x.id === einreichungId ? { ...x, ungelesen: 0 } : x));
  } else {
    geladenUm = 0; // beim nächsten Rendern frisch laden (letzter Kommentar, Anzahl)
  }
});
