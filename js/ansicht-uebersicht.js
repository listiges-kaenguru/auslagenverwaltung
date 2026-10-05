// =============================================
// ANSICHT 2: ÜBERSICHT
// Offene Auslagen einzeln, alles ab „eingereicht“ gebündelt nach Einreichung. Der Status
// eingereichter Auslagen ändert sich nur für die ganze Einreichung (Knöpfe an der Gruppe).
// =============================================
import {
  STATUS_LISTE, statusInfo, escapeHtml, formatiereDatum, formatiereBetrag, formatiereZeitpunkt, plural,
  summe, gruppiereNachEinreichung, einreichungsText, zeigeToast, mitLadezustand, registriereAktionen,
  meldeDatenAenderung, ladeDateiHerunter, sichererDateiname
} from './hilfen.js';
import {
  ladeAuslagenSortiert, setzeEinreichungStatus, zieheEinreichungZurueck, aktualisiereVomServer, holeEinreichungsPdf
} from './speicher.js';
import { einreichenKnopfHtml } from './einreichen.js';

let aktuellerFilter = 'alle';

export function rendereUebersicht(container) {
  const alle = ladeAuslagenSortiert();
  const nachStatus = Object.fromEntries(
    STATUS_LISTE.map((s) => [s, alle.filter((a) => a.status === s)])
  );
  const gefiltert = aktuellerFilter === 'alle' ? alle : (nachStatus[aktuellerFilter] || []);
  const offene = gefiltert.filter((a) => !a.einreichungId);
  const gruppen = gruppiereNachEinreichung(gefiltert);

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
      <div class="zusammenfassung-karte">
        <div class="zusammenfassung-karte__label">
          ${aktuellerFilter === 'alle' ? 'Gesamt' : escapeHtml(statusInfo(aktuellerFilter).label)}
        </div>
        <div class="zusammenfassung-karte__betrag">${formatiereBetrag(summe(gefiltert))}</div>
        <div class="zusammenfassung-karte__anzahl">${plural(gefiltert.length, 'Auslage', 'Auslagen')}${gruppen.length
          ? ` · ${plural(gruppen.length, 'Einreichung', 'Einreichungen')}` : ''}</div>
        ${aufteilungHtml}
      </div>

      <div class="filter-leiste" role="group" aria-label="Auslagen nach Status filtern">
        ${filterHtml}
      </div>

      ${aktuellerFilter === 'offen' && gefiltert.length > 0
        ? `<div class="einreichen-leiste">${einreichenKnopfHtml()}</div>`
        : ''}

      ${gefiltert.length === 0
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
            <ul class="einreichungs-liste">${gruppen.map(gruppeHtml).join('')}</ul>` : ''}`}
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

/** Eine Einreichung mit ihren Auslagen und den Aktionen für die ganze Gruppe */
function gruppeHtml(g) {
  const info = statusInfo(g.status);
  const id = escapeHtml(g.id);
  const knoepfe = {
    eingereicht: `
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-zurueckziehen" data-id="${id}">↩ Einreichung zurückziehen</button>
      <button type="button" class="btn btn-primaer btn-klein" data-aktion="einreichung-status" data-id="${id}" data-status="erstattet">● Als erstattet markieren</button>`,
    veranlasst: `
      <button type="button" class="btn btn-primaer btn-klein" data-aktion="einreichung-status" data-id="${id}" data-status="erstattet">● Geld erhalten – als erstattet markieren</button>`,
    erstattet: `
      <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-status" data-id="${id}"
        data-status="${g.veranlasstAm ? 'veranlasst' : 'eingereicht'}">↩ Doch noch nicht erstattet</button>`
  }[g.status] || '';
  const pdf = g.hatPdf
    ? `<button type="button" class="btn btn-sekundaer btn-klein" data-aktion="einreichung-pdf" data-id="${id}">📄 Einreichungs-PDF</button>`
    : '';

  return `
    <li class="einreichung-karte einreichung-karte--${info.key}">
      <div class="einreichung-karte__kopf">
        <div class="einreichung-karte__text">
          <span class="einreichung-karte__titel">${escapeHtml(einreichungsText(g))}</span>
          <span class="einreichung-karte__unter">${plural(g.auslagen.length, 'Auslage', 'Auslagen')}
            · ${formatiereBetrag(summe(g.auslagen))}</span>
          ${g.veranlasstAm ? `<span class="einreichung-karte__unter">🔒 Erstattung veranlasst
            ${formatiereZeitpunkt(g.veranlasstAm)}${g.veranlasstVon ? ` von ${escapeHtml(g.veranlasstVon)}` : ''}</span>` : ''}
        </div>
        <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
      </div>
      <ul class="auslagen-liste auslagen-liste--gruppe">${g.auslagen.map((a) => karteHtml(a, { inGruppe: true })).join('')}</ul>
      ${knoepfe || pdf ? `<div class="knopf-reihe knopf-reihe--umbruch">${pdf}${knoepfe}</div>` : ''}
    </li>`;
}

registriereAktionen({
  filter: (btn) => {
    aktuellerFilter = btn.dataset.filter || 'alle';
    document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  },

  'einreichung-zurueckziehen': (btn) => {
    if (!window.confirm('Einreichung zurückziehen?\n\nAlle Auslagen dieser Einreichung stehen danach wieder auf „Offen“ und können geändert und neu eingereicht werden.')) return;
    return mitLadezustand(btn, async () => {
      try {
        await zieheEinreichungZurueck(btn.dataset.id);
        zeigeToast('Einreichung zurückgezogen – die Auslagen sind wieder offen', 4000);
      } catch (err) {
        zeigeToast(`⚠ ${err.message}`, 5000);
        await aktualisiereVomServer().catch(() => {}); // z. B. inzwischen vom Kassenwart geändert
      }
      meldeDatenAenderung();
    });
  },

  'einreichung-pdf': (btn) => mitLadezustand(btn, async () => {
    const a = ladeAuslagenSortiert().find((x) => x.einreichungId === btn.dataset.id);
    try {
      const blob = await holeEinreichungsPdf(btn.dataset.id);
      const datum = (a?.eingereichtAm || '').slice(0, 10);
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
