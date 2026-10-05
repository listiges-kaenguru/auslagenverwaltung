// =============================================
// KOMMENTARE – Verlauf je Einreichung (Übersicht, Kasse, Detail-Fenster)
// - Rückfragen und protokollierte Statusänderungen in einer Zeitleiste
// - Verlauf als einklappbarer Bereich; geladen wird erst beim Aufklappen
// - Bewusst aufgeklappt = gelesen → Gelesen-Stand an den Server, Hinweise neu ermitteln.
//   Verläufe sind deshalb standardmäßig zu (sonst wäre alles schon beim Anzeigen „gelesen“)
// - Entwürfe bleiben beim Neu-Rendern erhalten (Map je Einreichung)
// - Ereignisse: „kommentare-geaendert“ (Zähler der Listen anpassen), „hinweise-aktualisieren“
//   (Punkte an der Navigation)
// =============================================
import {
  escapeHtml, formatiereZeitpunkt, formatiereBetrag, zeigeToast, mitLadezustand, registriereAktionen
} from './hilfen.js';
import { apiGet, apiPost, apiDelete, mitId } from './api.js';
import { offenAttr, beimKlappen } from './klappen.js';

const MAX_LAENGE = 2000;
const ROLLEN = { mitglied: 'Mitglied', kassenwart: 'Kassenwart', vorstand: 'Vorstand' };

const verlaeufe = new Map(); // einreichungId → { kommentare, schreibbar } | { laedt } | { fehler }
const entwuerfe = new Map(); // einreichungId → { text, auslageId }
const gemeldet  = new Map(); // einreichungId → zuletzt als gelesen gemeldete ID (verhindert Schleifen beim Neu-Rendern)

const neuRendern = () => document.dispatchEvent(new CustomEvent('ansicht-rendern'));

/** Beim Abmelden vergessen */
export function vergissKommentare() {
  verlaeufe.clear();
  entwuerfe.clear();
  gemeldet.clear();
}

/** Geladene Verläufe verwerfen (nach „Aktualisieren“ / Rückkehr in die App), Entwürfe bleiben */
export function veraltenVerlaeufe() {
  verlaeufe.clear();
  gemeldet.clear();
}

/** Verlauf laden (bzw. aus dem Speicher) */
export async function ladeVerlauf(einreichungId, { neu = false } = {}) {
  const vorhanden = verlaeufe.get(einreichungId);
  if (vorhanden?.kommentare && !neu) return vorhanden;
  verlaeufe.set(einreichungId, { ...vorhanden, laedt: true });
  try {
    const daten = await apiGet(`kommentare&einreichung=${encodeURIComponent(einreichungId)}`);
    verlaeufe.set(einreichungId, { kommentare: daten.kommentare, schreibbar: daten.schreibbar });
  } catch (err) {
    verlaeufe.set(einreichungId, { fehler: err.message });
  }
  return verlaeufe.get(einreichungId);
}

/** Ungelesenes im geladenen Verlauf als gelesen melden */
async function markiereGelesen(einreichungId) {
  const v = verlaeufe.get(einreichungId);
  const neue = v?.kommentare?.filter((k) => k.neu) || [];
  if (!neue.length) return;
  const bisId = Math.max(...v.kommentare.map((k) => k.id));
  if ((gemeldet.get(einreichungId) || 0) >= bisId) return;
  gemeldet.set(einreichungId, bisId);
  try {
    await apiPost('kommentare/gelesen', { einreichungId, bisId });
    document.dispatchEvent(new CustomEvent('kommentare-geaendert', { detail: { einreichungId, gelesen: true } }));
    document.dispatchEvent(new CustomEvent('hinweise-aktualisieren'));
  } catch {
    gemeldet.delete(einreichungId); // beim nächsten Aufklappen erneut
  }
  // „neu“-Markierung bleibt bis zum nächsten Laden sichtbar, damit man sieht, was neu war
}

// Aufklappen eines Verlaufs → laden, danach als gelesen markieren
beimKlappen(async (el, offen) => {
  const id = el.dataset.verlauf;
  if (!id || !offen) return;
  const v = verlaeufe.get(id);
  if (!v?.kommentare && !v?.laedt) {
    await ladeVerlauf(id);
    neuRendern();
  }
  markiereGelesen(id);
});

/**
 * Verlauf einer Einreichung als einklappbarer Bereich.
 * @param {object} e  Eckdaten der Einreichung: { id, kommentare, ungelesen }
 * @param {Array}  auslagen  Auslagen der Einreichung (für „Bezug“), leer bei abgebrochenen
 */
export function verlaufHtml(e, auslagen = []) {
  const v = verlaeufe.get(e.id);
  // Gezählt werden nur echte Kommentare, nicht die protokollierten Statusänderungen
  const anzahl = v?.kommentare ? v.kommentare.filter((k) => k.art === 'kommentar').length : (e.kommentare || 0);
  const ungelesen = e.ungelesen || 0;
  const titel = `💬 Verlauf${anzahl ? ` · ${anzahl} ${anzahl === 1 ? 'Kommentar' : 'Kommentare'}` : ''}`;

  let inhalt;
  if (v?.fehler) inhalt = `<p class="klein-hinweis klein-hinweis--links">⚠ ${escapeHtml(v.fehler)}</p>`;
  else if (!v?.kommentare) inhalt = '<p class="klein-hinweis klein-hinweis--links">Lade Kommentare …</p>';
  else {
    inhalt = `
      ${v.kommentare.length
        ? `<ol class="kommentar-liste">${v.kommentare.map(kommentarHtml).join('')}</ol>`
        : '<p class="klein-hinweis klein-hinweis--links">Noch keine Einträge.</p>'}
      ${v.schreibbar ? formularHtml(e.id, auslagen) : ''}`;
  }

  return `
    <details class="verlauf" data-klapp="verlauf:${escapeHtml(e.id)}" data-verlauf="${escapeHtml(e.id)}"
      ${offenAttr(`verlauf:${e.id}`, false)}>
      <summary class="verlauf__kopf">${titel}${ungelesen ? ` <span class="neu-marke">${ungelesen} neu</span>` : ''}</summary>
      <div class="verlauf__inhalt">${inhalt}</div>
    </details>`;
}

function kommentarHtml(k) {
  if (k.art === 'status') return statusEintragHtml(k);
  const vermerk = { ablehnung: '✖ Nicht genehmigt', zurueckgezogen: '↩ Zurückgezogen' }[k.art];
  const loeschbar = k.loeschbarBis && new Date(k.loeschbarBis) > new Date();
  return `
    <li class="kommentar ${k.eigen ? 'kommentar--eigen' : ''} ${k.art !== 'kommentar' ? 'kommentar--vermerk' : ''}">
      <div class="kommentar__kopf">
        <span class="kommentar__autor">${k.eigen ? 'Du' : escapeHtml(k.autor)}</span>
        <span class="kommentar__rolle">${escapeHtml(ROLLEN[k.rolle] || '')}</span>
        <span class="kommentar__zeit">${formatiereZeitpunkt(k.erstelltAm)}</span>
        ${k.neu ? '<span class="neu-marke">neu</span>' : ''}
      </div>
      ${vermerk ? `<div class="kommentar__vermerk">${vermerk}</div>` : ''}
      ${k.auslageText ? `<div class="kommentar__bezug">zu: ${escapeHtml(k.auslageText)}</div>` : ''}
      <div class="kommentar__text">${escapeHtml(k.text)}</div>
      ${loeschbar ? `<button type="button" class="link-knopf kommentar__loeschen" data-aktion="kommentar-loeschen"
        data-id="${k.id}">Löschen</button>` : ''}
    </li>`;
}

/** Bezug in der Auswahl: „Händler · Betrag · Hinweis“ (Hinweis gekürzt) */
function bezugText(a) {
  const notiz = a.notiz && a.notiz.length > 40 ? `${a.notiz.slice(0, 39)}…` : a.notiz;
  return [a.haendler, formatiereBetrag(a.betrag), notiz].filter(Boolean).join(' · ');
}

/** Protokollierte Statusänderung: eine schmale Zeile, nicht löschbar */
function statusEintragHtml(k) {
  return `
    <li class="kommentar kommentar--status">
      <span class="kommentar__text">${escapeHtml(k.text)}</span>
      <span class="kommentar__kopf">
        <span>${k.eigen ? 'Du' : escapeHtml(k.autor)} (${escapeHtml(ROLLEN[k.rolle] || '')}) · ${formatiereZeitpunkt(k.erstelltAm)}</span>
        ${k.neu ? '<span class="neu-marke">neu</span>' : ''}
      </span>
    </li>`;
}

function formularHtml(einreichungId, auslagen) {
  const entwurf = entwuerfe.get(einreichungId) || {};
  const id = escapeHtml(einreichungId);
  return `
    <form class="kommentar-formular" data-formular="kommentar" data-einreichung="${id}" novalidate>
      <label class="visuell-versteckt" for="kommentar-${id}">Kommentar</label>
      <textarea id="kommentar-${id}" name="text" class="formular-feld" rows="2" maxlength="${MAX_LAENGE}"
        placeholder="Rückfrage oder Antwort schreiben …" data-entwurf="${id}">${escapeHtml(entwurf.text || '')}</textarea>
      <div class="kommentar-formular__zeile">
        ${auslagen.length > 1 ? `
        <label class="visuell-versteckt" for="bezug-${id}">Bezug</label>
        <select id="bezug-${id}" name="auslageId" class="formular-feld" data-entwurf="${id}">
          <option value="">Ganze Einreichung</option>
          ${auslagen.map((a) => `<option value="${escapeHtml(a.id)}" ${entwurf.auslageId === a.id ? 'selected' : ''}>
            zu: ${escapeHtml(bezugText(a))}</option>`).join('')}
        </select>` : ''}
        <button type="submit" class="btn btn-primaer btn-klein">Senden</button>
      </div>
    </form>`;
}

/**
 * Abgebrochene (zurückgezogene/abgelehnte) Einreichungen als eingeklappter Bereich, nur lesbar.
 * pdfAktion = data-aktion des PDF-Knopfs; mitMitglied = Namen anzeigen (Kasse).
 */
export function abgebrochenHtml(liste, { pdfAktion, mitMitglied = false }) {
  if (!liste.length) return '';
  const eintrag = (e) => {
    const was = e.zustand === 'abgelehnt' ? '✖ Nicht genehmigt' : '↩ Zurückgezogen';
    return `
      <li>
        <details class="einreichung-karte einreichung-karte--abgebrochen" data-klapp="ein:${escapeHtml(e.id)}"
          ${offenAttr(`ein:${e.id}`, e.ungelesen > 0)}>
          <summary class="einreichung-karte__kopf">
            <span class="einreichung-karte__text">
              <span class="einreichung-karte__titel">${mitMitglied ? `${escapeHtml(e.mitglied.name)} · ` : ''}${was}
                am ${formatiereZeitpunkt(e.beendetAm)}</span>
              <span class="einreichung-karte__unter">Eingereicht am ${formatiereZeitpunkt(e.erstelltAm)}
                · ${e.anzahl} ${e.anzahl === 1 ? 'Auslage' : 'Auslagen'} · ${betragText(e.summe)}</span>
            </span>
            ${kommentarMarkeHtml(e)}
          </summary>
          <div class="einreichung-karte__inhalt">
            <p class="klein-hinweis klein-hinweis--links">Die Auslagen sind wieder offen. Das PDF zeigt den eingereichten Stand.</p>
            ${verlaufHtml(e)}
            ${e.hatPdf ? `<div class="knopf-reihe knopf-reihe--umbruch">
              <button type="button" class="btn btn-sekundaer btn-klein" data-aktion="${pdfAktion}" data-id="${escapeHtml(e.id)}">📄 Einreichungs-PDF</button>
            </div>` : ''}
          </div>
        </details>
      </li>`;
  };
  const ungelesen = liste.reduce((s, e) => s + (e.ungelesen || 0), 0);
  return `
    <details class="bereich" data-klapp="abgebrochen" ${offenAttr('abgebrochen', ungelesen > 0)}>
      <summary class="liste-titel bereich__kopf">Abgebrochen (${liste.length})${ungelesen
        ? ` <span class="neu-marke">💬 ${ungelesen} neu</span>` : ''}</summary>
      <ul class="einreichungs-liste">${liste.map(eintrag).join('')}</ul>
    </details>`;
}

/** 💬-Hinweis im Kopf einer Einreichung: „n neu“ bzw. Anzahl der Kommentare */
export function kommentarMarkeHtml(e) {
  if (e?.ungelesen) return `<span class="neu-marke">💬 ${e.ungelesen} neu</span>`;
  if (e?.kommentare) return `<span class="kommentar-anzahl" title="Kommentare">💬 ${e.kommentare}</span>`;
  return '';
}

const betragFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const betragText = (b) => betragFormat.format(Number(b) || 0);

/** Kommentare zu einer einzelnen Auslage (Detail-Fenster), nur lesend */
export function kommentareZurAuslageHtml(einreichungId, auslageId) {
  const v = verlaeufe.get(einreichungId);
  const passend = v?.kommentare?.filter((k) => k.auslageId === auslageId) || [];
  if (!passend.length) return '';
  return `
    <div class="modal-abschnitt">
      <div class="abschnitt-label">💬 Rückfragen zu dieser Auslage</div>
      <ol class="kommentar-liste">${passend.map((k) => kommentarHtml({ ...k, loeschbarBis: null })).join('')}</ol>
      <p class="klein-hinweis klein-hinweis--links">Den gesamten Verlauf und die Antwortmöglichkeit findest du bei der Einreichung.</p>
    </div>`;
}

// Entwürfe beim Tippen merken (Ansichten werden oft neu gerendert)
document.addEventListener('input', (e) => merkeEntwurf(e.target));
document.addEventListener('change', (e) => merkeEntwurf(e.target));
function merkeEntwurf(el) {
  const id = el?.dataset?.entwurf;
  if (!id) return;
  const form = el.closest('form');
  entwuerfe.set(id, { text: form.elements.text.value, auslageId: form.elements.auslageId?.value || '' });
}

registriereAktionen({
  'formular:kommentar': (form) => {
    const einreichungId = form.dataset.einreichung;
    const text = form.elements.text.value.trim();
    if (!text) { form.elements.text.focus(); zeigeToast('⚠ Bitte einen Text eingeben'); return; }
    return mitLadezustand(form.querySelector('[type="submit"]'), async () => {
      try {
        await apiPost('kommentare', { einreichungId, text, auslageId: form.elements.auslageId?.value || null });
        entwuerfe.delete(einreichungId);
        await ladeVerlauf(einreichungId, { neu: true });
        document.dispatchEvent(new CustomEvent('kommentare-geaendert', { detail: { einreichungId } }));
        zeigeToast('✓ Kommentar gesendet');
      } catch (err) {
        zeigeToast(`⚠ ${err.message}`, 5000);
      }
      neuRendern();
    });
  },

  'kommentar-loeschen': (btn) => {
    if (!window.confirm('Kommentar löschen?')) return;
    const einreichungId = btn.closest('[data-verlauf]')?.dataset.verlauf;
    return mitLadezustand(btn, async () => {
      try {
        await apiDelete(mitId('kommentare', btn.dataset.id));
        zeigeToast('Kommentar gelöscht');
      } catch (err) {
        zeigeToast(`⚠ ${err.message}`, 5000);
      }
      if (einreichungId) await ladeVerlauf(einreichungId, { neu: true });
      document.dispatchEvent(new CustomEvent('kommentare-geaendert', { detail: { einreichungId } }));
      neuRendern();
    });
  }
});
