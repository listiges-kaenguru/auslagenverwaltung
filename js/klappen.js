// =============================================
// EINKLAPPBARE BEREICHE (<details>/<summary>)
// Natives <details> ist barrierefrei, per Tastatur bedienbar und CSP-tauglich. Weil die Ansichten
// oft komplett neu gerendert werden, merkt sich dieses Modul je Schlüssel (data-klapp="…"), ob der
// Bereich offen ist – für die Dauer der Sitzung. Ohne Eintrag gilt der Standard der Ansicht.
// „toggle“ blubbert nicht hoch → Capture-Phase am document.
// =============================================

const zustand = new Map(); // Schlüssel → true/false
const beobachter = [];     // (details, offen) => void – z. B. Kommentare beim Aufklappen laden

/** Offen-Attribut für ein <details>: gemerkter Zustand oder Standard */
export function offenAttr(schluessel, standard = false) {
  const offen = zustand.has(schluessel) ? zustand.get(schluessel) : standard;
  return offen ? 'open' : '';
}

/** Rückruf bei jedem Auf-/Zuklappen (auch beim Rendern mit „open“) */
export function beimKlappen(rueckruf) {
  beobachter.push(rueckruf);
}

/** Beim Abmelden vergessen */
export function vergissKlappZustand() {
  zustand.clear();
}

document.addEventListener('toggle', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLDetailsElement) || !el.dataset.klapp) return;
  zustand.set(el.dataset.klapp, el.open);
  for (const r of beobachter) r(el, el.open);
}, true);
