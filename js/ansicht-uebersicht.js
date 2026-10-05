// =============================================
// ANSICHT 2: ÜBERSICHT
// Offene Auslagen einzeln, alles ab „eingereicht“ gebündelt nach Einreichung. Der Status
// eingereichter Auslagen ändert sich nur für die ganze Einreichung (Knöpfe an der Gruppe).
// Einreichungen sind einklappbar; aufgeklappt sind standardmäßig nur solche mit ungelesenen
// Kommentaren bzw. eine einzelne nicht erstattete. Darunter eingeklappt:
// - „Abgeschlossen“: erstattete Einreichungen, 5 Minuten nach „erstattet“ (dann nicht mehr zurücknehmbar)
// - „Abgebrochen“: zurückgezogene und abgelehnte Einreichungen (nur lesbar)
// =============================================
import {
  STATUS_LISTE, statusInfo, escapeHtml, formatiereDatum, formatiereBetrag, formatiereZeitpunkt, plural,
  summe, gruppiereNachEinreichung, einreichungsText, istAbgeschlossen, zeigeToast, mitLadezustand, registriereAktionen,
  meldeDatenAenderung, ladeDateiHerunter, sichererDateiname
} from './hilfen.js';
import {
  ladeAuslagenSortiert, ladeEinreichungen, setzeEinreichungStatus, zieheEinreichungZurueck, aktualisiereVomServer,
  holeEinreichungsPdf
} from './speicher.js';
import { einreichenKnopfHtml } from './einreichen.js';
import { offenAttr } from './klappen.js';
import { verlaufHtml, abgebrochenHtml, kommentarMarkeHtml, veraltenVerlaeufe } from './kommentare.js';

let aktuellerFilter = 'alle';
let abschlussTimer = null; // zeichnet neu, sobald die nächste erstattete Einreichung abgeschlossen ist

export function rendereUebersicht(container) {
  const alle = ladeAuslagenSortiert();
  const nachStatus = Object.fromEntries(
    STATUS_LISTE.map((s) => [s, alle.filter((a) => a.status === s)])
  );
  const gefiltert = aktuellerFilter === 'alle' ? alle : (nachStatus[aktuellerFilter] || []);
  const offene = gefiltert.filter((a) => !a.einreichungId);
  const alleGruppen = gruppiereNachEinreichung(gefiltert);
  const gruppen = alleGruppen.filter((g) => !istAbgeschlossen(g));
  const erledigt = alleGruppen.filter(istAbgeschlossen);
  planeAbschluss(gruppen);
  const eckdaten = new Map(ladeEinreichungen().map((e) => [e.id, e]));
  const abgebrochen = aktuellerFilter === 'alle' ? ladeEinreichungen().filter((e) => e.zustand !== 'aktiv') : [];
  // Einzelne nicht erstattete Einreichung aufklappen – sonst nur bei ungelesenen Einträgen
  const standardOffen = (g) => (eckdaten.get(g.id)?.ungelesen > 0)
    || (gruppen.length === 1 && g.status !== 'erstattet');

  const filterOptionen = [
    { id: 'alle', label: 'Alle', anzahl: alle.length },
    ...STATUS_LISTE.map((s) => ({ id: s, label: statusInfo(s).kurz, anzahl: nachStatus[s].length }))
  ];

  const filterHtml = filterOptionen.map((f) => `
    <button type="button" class="filter-chip" data-aktion="filter" data-filter="${f.id}"
      aria-pressed="${aktuellerFilter === f.id}">
      ${escapeHtml(f.label)} <span class="filter-chip__anzahl">${f.anzahl}</span>
    </button>`).join('');

  // Aufteilung nach Status nur in der Gesamtansicht
  const aufteilungHtml = aktuellerFilter === 'alle' && alle.length > 0
    ? `<div class="zusammenfassung-karte__aufteilung">
        ${STATUS_LISTE.map((s) => `
          <div>
            <div class="aufteilung__label">${statusInfo(s).kurz}</div>
            <div class="aufteilung__wert">${formatiereBetrag(summe(nachStatus[s]))}</div>
          </div>`).join('')}
      </div>`
    : '';

  const mitZwischentiteln = offene.length > 0 && gruppen.length > 0;

  container.innerHTML = `
    <div class="ansicht">
      <div class="ansicht-kopf">
        <h2 class="seiten-titel">Übersicht</h2>
      </div>
      <div class="zusammenfassung-karte">
        <div class="zusammenfassung-karte__label">
          ${aktuellerFilter === 'alle' ? 'Gesamt' : escapeHtml(statusInfo(aktuellerFilter).label)}
        </div>
        <div class="zusammenfassung-karte__betrag">${formatiereBetrag(summe(gefiltert))}</div>
        <div class="zusammenfassung-karte__anzahl">${plural(gefiltert.length, 'Auslage', 'Auslagen')}${alleGruppen.length
          ? ` · ${plural(alleGruppen.length, 'Einreichung', 'Einreichungen')}` : ''}</div>
        ${aufteilungHtml}
      </div>

      <div class="filter-leiste" role="group" aria-label="Auslagen nach Status filtern">
        ${filterHtml}
      </div>

      ${aktuellerFilter === 'offen' && gefiltert.length > 0
        ? `<div class="einreichen-leiste">${einreichenKnopfHtml()}</div>`
        : ''}

      ${gefiltert.length === 0 && abgebrochen.length === 0
        ? `<div class="leer-zustand">
            <div class="leer-zustand__icon" aria-hidden="true">📭</div>
            <div class="leer-zustand__titel">Keine Auslagen gefunden</div>
            <div class="leer-zustand__text">
              ${aktuellerFilter === 'alle'
                ? 'Erfasse deine erste Auslage über „Neu“.'
                : `Keine Auslagen mit dem Status „${escapeHtml(statusInfo(aktuellerFilter).label)}“.`}
            </div>
          </div>`
        : `
          ${offene.length ? `
            ${mitZwischentiteln ? '<h2 class="liste-titel">Offen</h2>' : ''}
            <ul class="auslagen-liste">${offene.map(karteHtml).join('')}</ul>` : ''}
          ${gruppen.length ? `
            ${mitZwischentiteln ? '<h2 class="liste-titel">Einreichungen</h2>' : ''}
            <ul class="einreichungs-liste">${gruppen.map((g) => gruppeHtml(g, eckdaten.get(g.id), standardOffen(g))).join('')}</ul>` : ''}
          ${abgeschlossenHtml(erledigt, eckdaten)}
          ${abgebrochenHtml(abgebrochen, { pdfAktion: 'einreichung-pdf' })}`}
    </div>
  `;
}

function karteHtml(auslage, { inGruppe = false } = {}) {
  const info = statusInfo(auslage.status);
  return `
    <li>
      <button type="button" class="auslagen-karte ${inGruppe ? 'auslagen-karte--in-gruppe' : ''}" data-aktion="detail"
        data-id="${escapeHtml(auslage.id)}"
        aria-label="${escapeHtml(auslage.haendler)}, ${formatiereDatum(auslage.datum)}, ${formatiereBetrag(auslage.betrag)}, ${info.label}">
        <span class="auslagen-karte__kopf">
          <span class="auslagen-karte__links">
            <span class="auslagen-karte__haendler">${escapeHtml(auslage.haendler)}</span>
            <span class="auslagen-karte__datum">${formatiereDatum(auslage.datum)}</span>
            ${auslage.notiz ? `<span class="auslagen-karte__notiz">${escapeHtml(auslage.notiz)}</span>` : ''}
          </span>
          <span class="auslagen-karte__rechts">
            <span class="auslagen-karte__betrag">${formatiereBetrag(auslage.betrag)}</span>
            ${inGruppe ? '' : `<span class="badge badge--${info.key}">${info.icon} ${info.label}</span>`}
          </span>
        </span>
        <span class="auslagen-karte__fuss ${auslage.hatFoto ? '' : 'auslagen-karte__fuss--fehlt'}">
          ${auslage.hatFoto ? '📎 Beleg vorhanden' : '⚠ Kein Beleg'}
          <svg class="auslagen-karte__pfeil" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </span>
      </button>
    </li>
  `;
}

/** Erstattete und abgeschlossene Einreichungen: eingeklappter Bereich, unter „Erstattet“ offen */
function abgeschlossenHtml(liste, eckdaten) {
  if (!liste.length) return '';
  const ungelesen = liste.reduce((s, g) => s + (eckdaten.get(g.id)?.ungelesen || 0), 0);
  return `
    <details class="bereich" data-klapp="abgeschlossen:${aktuellerFilter}"
      ${offenAttr(`abgeschlossen:${aktuellerFilter}`, aktuellerFilter === 'erstattet' || ungelesen > 0)}>
      <summary class="liste-titel bereich__kopf">Abgeschlossen (${liste.length})${ungelesen
        ? ` <span class="neu-marke">💬 ${ungelesen} neu</span>` : ''}</summary>
      <ul class="einreichungs-liste">${liste.map((g) => gruppeHtml(g, eckdaten.get(g.id), false)).join('')}</ul>
    </details>`;
}

/** Neu zeichnen, sobald die nächste erstattete Einreichung ihre Frist hinter sich hat */
function planeAbschluss(gruppen) {
  clearTimeout(abschlussTimer);
  const naechste = Math.min(...gruppen.filter((g) => g.status === 'erstattet' && g.abschlussUm != null)
    .map((g) => g.abschlussUm));
  if (!Number.isFinite(naechste)) return;
  abschlussTimer = setTimeout(() => {
    if (location.hash === '#uebersicht') document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  }, Math.max(0, naechste - Date.now()) + 500);
}

/** Eine Einreichung (einklappbar) mit ihren Auslagen, Rückfragen und den Aktionen für die ganze Gruppe */
function gruppeHtml(g, eckdaten, standardOffen) {
  const info = statusInfo(g.status);
  const id = escapeHtml(g.id);
  const knoepfe = {
    eingereicht: `
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-zurueckziehen" data-id="${id}">↩ Einreichung zurückziehen</button>
      <button type="button" class="btn btn-primaer btn-klein" data-aktion="einreichung-status" data-id="${id}" data-status="erstattet">● Als erstattet markieren</button>`,
    veranlasst: `
      <button type="button" class="btn btn-primaer btn-klein" data-aktion="einreichung-status" data-id="${id}" data-status="erstattet">● Geld erhalten – als erstattet markieren</button>`,
    // Zurücknehmen nur während der Frist – danach ist die Einreichung abgeschlossen
    erstattet: istAbgeschlossen(g) ? '' : `
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-status" data-id="${id}"
        data-status="${g.veranlasstAm ? 'veranlasst' : 'eingereicht'}">↩ Doch noch nicht erstattet</button>`
  }[g.status] || '';
  const pdf = g.hatPdf
    ? `<button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-pdf" data-id="${id}">📄 Einreichungs-PDF</button>`
    : '';

  return `
    <li>
      <details class="einreichung-karte einreichung-karte--${info.key}" data-klapp="ein:${id}"
        ${offenAttr(`ein:${g.id}`, standardOffen)}>
        <summary class="einreichung-karte__kopf">
          <span class="einreichung-karte__text">
            <span class="einreichung-karte__titel">${escapeHtml(einreichungsText(g))}</span>
            <span class="einreichung-karte__unter">${plural(g.auslagen.length, 'Auslage', 'Auslagen')}
              · ${formatiereBetrag(summe(g.auslagen))}</span>
            ${g.veranlasstAm ? `<span class="einreichung-karte__unter">🔒 Erstattung veranlasst
              ${formatiereZeitpunkt(g.veranlasstAm)}${g.veranlasstVon ? ` von ${escapeHtml(g.veranlasstVon)}` : ''}</span>` : ''}
          </span>
          <span class="einreichung-karte__marken">
            <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
            ${kommentarMarkeHtml(eckdaten)}
          </span>
        </summary>
        <div class="einreichung-karte__inhalt">
          <ul class="auslagen-liste auslagen-liste--gruppe">${g.auslagen.map((a) => karteHtml(a, { inGruppe: true })).join('')}</ul>
          ${verlaufHtml({ ...eckdaten, id: g.id }, g.auslagen)}
          ${knoepfe || pdf ? `<div class="knopf-reihe knopf-reihe--umbruch">${pdf}${knoepfe}</div>` : ''}
        </div>
      </details>
    </li>`;
}

registriereAktionen({
  filter: (btn) => {
    aktuellerFilter = btn.dataset.filter || 'alle';
    document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  },

  'einreichung-zurueckziehen': (btn) => {
    if (!window.confirm('Einreichung zurückziehen?\n\nAlle Auslagen dieser Einreichung stehen danach wieder auf „Offen“ und können geändert und neu eingereicht werden. Die Einreichung bleibt mit PDF und Kommentaren unter „Abgebrochen“ erhalten.')) return;
    return mitLadezustand(btn, async () => {
      try {
        await zieheEinreichungZurueck(btn.dataset.id);
        veraltenVerlaeufe(); // Vermerk „zurückgezogen“ im Verlauf, Formular entfällt
        zeigeToast('Einreichung zurückgezogen – die Auslagen sind wieder offen', 4000);
      } catch (err) {
        zeigeToast(`⚠ ${err.message}`, 5000);
        await aktualisiereVomServer().catch(() => {}); // z. B. inzwischen vom Kassenwart geändert
      }
      meldeDatenAenderung();
    });
  },

  'einreichung-pdf': (btn) => mitLadezustand(btn, async () => {
    const e = ladeEinreichungen().find((x) => x.id === btn.dataset.id);
    try {
      const blob = await holeEinreichungsPdf(btn.dataset.id);
      const datum = (e?.erstelltAm || '').slice(0, 10);
      await ladeDateiHerunter(blob, sichererDateiname(`VereinsAuslagen_Einreichung_${datum}`) + '.pdf');
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
  }),

  'einreichung-status': (btn) => mitLadezustand(btn, async () => {
    const status = btn.dataset.status;
    try {
      await setzeEinreichungStatus(btn.dataset.id, status);
      zeigeToast(`Einreichung: ${statusInfo(status).label}`);
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
      await aktualisiereVomServer().catch(() => {});
    }
    meldeDatenAenderung();
  })
});
