// =============================================
// ANSICHT 2: ÜBERSICHT
// =============================================
import {
  STATUS_LISTE, statusInfo, escapeHtml, formatiereDatum, formatiereBetrag, plural, summe,
  registriereAktionen
} from './hilfen.js';
import { ladeAuslagenSortiert } from './speicher.js';
import { einreichenKnopfHtml } from './einreichen.js';

let aktuellerFilter = 'alle';

export function rendereUebersicht(container) {
  const alle = ladeAuslagenSortiert();
  const nachStatus = Object.fromEntries(
    STATUS_LISTE.map((s) => [s, alle.filter((a) => a.status === s)])
  );
  const gefiltert = aktuellerFilter === 'alle' ? alle : (nachStatus[aktuellerFilter] || []);

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

  container.innerHTML = `
    <div class="ansicht">
      <div class="zusammenfassung-karte">
        <div class="zusammenfassung-karte__label">
          ${aktuellerFilter === 'alle' ? 'Gesamt' : escapeHtml(statusInfo(aktuellerFilter).label)}
        </div>
        <div class="zusammenfassung-karte__betrag">${formatiereBetrag(summe(gefiltert))}</div>
        <div class="zusammenfassung-karte__anzahl">${plural(gefiltert.length, 'Auslage', 'Auslagen')}</div>
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
        : `<ul class="auslagen-liste">${gefiltert.map(karteHtml).join('')}</ul>`}
    </div>
  `;
}

function karteHtml(auslage) {
  const info = statusInfo(auslage.status);
  return `
    <li>
      <button type="button" class="auslagen-karte" data-aktion="detail" data-id="${escapeHtml(auslage.id)}"
        aria-label="${escapeHtml(auslage.haendler)}, ${formatiereDatum(auslage.datum)}, ${formatiereBetrag(auslage.betrag)}, ${info.label}">
        <span class="auslagen-karte__kopf">
          <span class="auslagen-karte__links">
            <span class="auslagen-karte__haendler">${escapeHtml(auslage.haendler)}</span>
            <span class="auslagen-karte__datum">${formatiereDatum(auslage.datum)}</span>
            ${auslage.notiz ? `<span class="auslagen-karte__notiz">${escapeHtml(auslage.notiz)}</span>` : ''}
          </span>
          <span class="auslagen-karte__rechts">
            <span class="auslagen-karte__betrag">${formatiereBetrag(auslage.betrag)}</span>
            <span class="badge badge--${info.key}">${info.icon} ${info.label}</span>
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

registriereAktionen({
  filter: (btn) => {
    aktuellerFilter = btn.dataset.filter || 'alle';
    document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  }
});
