// =============================================
// PDF: tabellarische Übersicht + alle Belege in einer Datei
// - pdf-lib (vendor/pdf-lib.min.js) wird erst bei Bedarf geladen
// - Fotos werden eingebettet, PDF-Belege seitenweise übernommen
// - Standardschrift Helvetica (WinAnsi): nicht darstellbare Zeichen werden ersetzt
// =============================================
import {
  statusInfo, formatiereDatum, formatiereBetrag, heuteISO, plural, summe, ladeSkript
} from './hilfen.js';
import { holeBeleg } from './speicher.js';

const SEITE         = [595.28, 841.89];   // A4 hochkant (pt)
const RAND          = 48;
const INHALT_BREITE = SEITE[0] - 2 * RAND;
const UNTEN         = RAND + 8;           // darunter liegt nur die Fußzeile
const FUSS_Y        = 26;

// Tabelle
const GROESSE = 9;
const ZEILE   = 11.5;
const PAD_H   = 5;
const PAD_V   = 6;
const KOPF_H  = 20;
const SUMME_H = 24;

/**
 * Einstieg: PDF erzeugen → { blob, belegFehler }
 * einreichung: false oder { name, iban, ortDatum, unterschrift } → Formularblock am Ende der Übersicht
 */
export async function erstelleAuslagenPdf(auslagen, { titel, mitStatus = false, einreichung = false }) {
  const PDFLib = await ladeSkript('vendor/pdf-lib.min.js', 'PDFLib');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  const pdf = await PDFDocument.create();
  const ctx = {
    pdf,
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    fett:   await pdf.embedFont(StandardFonts.HelveticaBold),
    kursiv: await pdf.embedFont(StandardFonts.HelveticaOblique),
    farbe: {
      text:      rgb(0.08, 0.08, 0.08),
      gedaempft: rgb(0.35, 0.37, 0.40),
      linie:     rgb(0.80, 0.80, 0.78),
      kopf:      rgb(0.92, 0.92, 0.90),
      zebra:     rgb(0.97, 0.97, 0.96),
      warnung:   rgb(0.72, 0.11, 0.11)
    }
  };

  const belege = await bereiteBelegeVor(pdf, PDFLib, auslagen);
  const belegFehler = [...belege.values()].filter((b) => b.art === 'fehler').length;
  const daten = { titel, auslagen, mitStatus, einreichung, belege, belegFehler };

  // 1. Probelauf ohne Zeichnen: Seitenzahl der Übersicht → Seitenverweise auf die Belege
  let naechsteSeite = zeichneUebersicht(ctx, daten, null) + 1;
  const belegSeite = new Map();
  for (const a of auslagen) {
    const beleg = belege.get(a.id);
    if (!beleg) continue;
    belegSeite.set(a.id, naechsteSeite);
    naechsteSeite += beleg.art === 'pdf' ? beleg.seiten.length : 1;
  }

  // 2. Zeichnen
  zeichneUebersicht(ctx, daten, belegSeite);
  auslagen.forEach((a, i) => {
    const beleg = belege.get(a.id);
    if (beleg) zeichneBeleg(ctx, a, i + 1, beleg);
  });
  zeichneFusszeilen(ctx);

  pdf.setTitle(titel);
  pdf.setCreator('VereinsAuslagen');
  pdf.setProducer('VereinsAuslagen');
  pdf.setLanguage('de-DE');

  const bytes = await pdf.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), belegFehler };
}

// ---------------------------------------------
// Belege vorbereiten
// ---------------------------------------------
const istJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const istPng  = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const istPdf  = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/** Hat das JPEG einen EXIF-Block? (Ausrichtung würde im PDF ignoriert) */
function hatExif(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xe1) return true;
    if (marker === 0xda) break; // Bilddaten beginnen
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return false;
}

/** Beliebiges Bild (mit korrekter Ausrichtung) als JPEG-Bytes */
async function alsJpeg(blob) {
  const bild = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width  = bild.width;
  canvas.height = bild.height;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bild, 0, 0);
  bild.close?.();
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!jpeg) throw new Error('Bild konnte nicht umgewandelt werden');
  return new Uint8Array(await jpeg.arrayBuffer());
}

/**
 * Alle Belege laden und ins Dokument einbetten.
 * → Map id → { art: 'bild', bild } | { art: 'pdf', seiten } | { art: 'fehler', grund }
 * Auslagen ohne (auffindbaren) Beleg fehlen in der Map.
 */
async function bereiteBelegeVor(pdf, { PDFDocument }, auslagen) {
  const ergebnis = new Map();
  for (const a of auslagen) {
    if (!a.hatFoto) continue;
    const blob = await holeBeleg(a.id).catch(() => null);
    if (!blob) continue;

    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (istPdf(bytes)) {
        ergebnis.set(a.id, { art: 'pdf', seiten: await bettePdfEin(pdf, PDFDocument, bytes) });
      } else if (istJpeg(bytes)) {
        const jpeg = hatExif(bytes) ? await alsJpeg(blob) : bytes;
        ergebnis.set(a.id, { art: 'bild', bild: await pdf.embedJpg(jpeg) });
      } else if (istPng(bytes)) {
        ergebnis.set(a.id, { art: 'bild', bild: await pdf.embedPng(bytes) });
      } else {
        ergebnis.set(a.id, { art: 'bild', bild: await pdf.embedJpg(await alsJpeg(blob)) });
      }
    } catch (err) {
      console.warn('[VereinsAuslagen] Beleg nicht einbettbar:', a.id, err);
      ergebnis.set(a.id, { art: 'fehler', grund: err?.fuerNutzer || 'Das Dateiformat wird nicht unterstützt.' });
    }
  }
  return ergebnis;
}

/** Alle Seiten eines PDF-Belegs einbetten; Fehler mit verständlichem Text */
async function bettePdfEin(pdf, PDFDocument, bytes) {
  const fehler = (text, ursache) => Object.assign(new Error(text, { cause: ursache }), { fuerNutzer: text });
  let quelle;
  try {
    quelle = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw fehler('Das PDF ist beschädigt oder wird nicht unterstützt.', err);
  }
  if (quelle.isEncrypted) throw fehler('Das PDF ist passwortgeschützt.');
  try {
    if (quelle.getPageCount() === 0) throw fehler('Das PDF enthält keine Seiten.');
    return await pdf.embedPages(quelle.getPages());
  } catch (err) {
    throw err.fuerNutzer ? err : fehler('Das PDF ist beschädigt oder wird nicht unterstützt.', err);
  }
}

// ---------------------------------------------
// Text-Hilfen
// ---------------------------------------------
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Text auf den Zeichenvorrat der Standardschrift (WinAnsi) beschränken */
function pdfText(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}‍︎️]/gu, '') // Emojis weglassen
    .replace(/[‐‑‒]/g, '-')
    .replace(/[→⇒➔]/g, '->')
    .replace(/[←⇐]/g, '<-')
    .replace(/./gu, (z) => {
      const c = z.codePointAt(0);
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(z) || /\s/.test(z) ? z : '?';
    })
    .replace(/\s+/g, ' ');
}

/** Text so kürzen, dass er mit „…“ in die Breite passt */
function mitAuslassung(text, font, groesse, breite) {
  let t = text;
  while (t && font.widthOfTextAtSize(`${t}…`, groesse) > breite) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function kuerzen(text, font, groesse, breite) {
  const t = pdfText(text);
  return font.widthOfTextAtSize(t, groesse) <= breite ? t : mitAuslassung(t, font, groesse, breite);
}

/** Zeilenumbruch nach Wörtern (überlange Wörter werden hart getrennt) */
function umbrechen(text, font, groesse, breite, maxZeilen = Infinity) {
  const passt = (t) => font.widthOfTextAtSize(t, groesse) <= breite;
  const zeilen = [];
  let zeile = '';
  for (let wort of pdfText(text).split(' ').filter(Boolean)) {
    while (!passt(wort)) {
      let n = wort.length - 1;
      while (n > 1 && !passt(wort.slice(0, n))) n--;
      if (zeile) { zeilen.push(zeile); zeile = ''; }
      zeilen.push(wort.slice(0, n));
      wort = wort.slice(n);
    }
    const versuch = zeile ? `${zeile} ${wort}` : wort;
    if (passt(versuch)) {
      zeile = versuch;
    } else {
      zeilen.push(zeile);
      zeile = wort;
    }
  }
  if (zeile) zeilen.push(zeile);
  if (zeilen.length > maxZeilen) {
    zeilen.length = maxZeilen;
    zeilen[maxZeilen - 1] = mitAuslassung(zeilen[maxZeilen - 1], font, groesse, breite);
  }
  return zeilen.length ? zeilen : [''];
}

/** Zeichenfunktionen für eine Seite; bei seite === null (Probelauf) passiert nichts */
function zeichner(ctx, seite) {
  const { normal, farbe } = ctx;
  const schreibe = (text, x, y, font = normal, groesse = GROESSE, f = farbe.text) =>
    seite?.drawText(pdfText(text), { x, y, size: groesse, font, color: f });
  return {
    schreibe,
    rechts: (text, xRechts, y, font = normal, groesse = GROESSE, f = farbe.text) =>
      schreibe(text, xRechts - font.widthOfTextAtSize(pdfText(text), groesse), y, font, groesse, f),
    flaeche: (x, y, breite, hoehe, f) =>
      seite?.drawRectangle({ x, y, width: breite, height: hoehe, color: f }),
    linie: (x1, y, x2, f = farbe.linie, dicke = 0.6) =>
      seite?.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: dicke, color: f })
  };
}

// ---------------------------------------------
// Übersicht (Tabelle)
// ---------------------------------------------
function spaltenFuer(mitStatus) {
  const spalten = [
    { key: 'nr',       titel: 'Nr.',              breite: 26 },
    { key: 'datum',    titel: 'Datum',            breite: 58 },
    { key: 'haendler', titel: 'Händler',          breite: 112 },
    { key: 'zweck',    titel: 'Verwendungszweck', breite: 0 },
    ...(mitStatus ? [{ key: 'status', titel: 'Status', breite: 64 }] : []),
    { key: 'betrag',   titel: 'Betrag',           breite: 68, rechts: true },
    { key: 'beleg',    titel: 'Beleg',            breite: 42 }
  ];
  const fest = spalten.reduce((s, sp) => s + sp.breite, 0);
  spalten.find((sp) => sp.key === 'zweck').breite = INHALT_BREITE - fest;
  return spalten;
}

/**
 * Übersicht zeichnen. Mit belegSeite === null nur Probelauf (keine Seiten anlegen).
 * Beide Durchläufe nutzen denselben Code → identischer Seitenumbruch.
 * @returns Anzahl der Übersichtsseiten
 */
function zeichneUebersicht(ctx, d, belegSeite) {
  const probelauf = belegSeite === null;
  const { normal, fett, farbe } = ctx;
  const spalten = spaltenFuer(d.mitStatus);
  const breiteVon = (key) => spalten.find((sp) => sp.key === key).breite;
  const gesamt = summe(d.auslagen);

  let y = 0;
  let seitenAnzahl = 0;
  let z = zeichner(ctx, null);

  const neueSeite = () => {
    seitenAnzahl++;
    z = zeichner(ctx, probelauf ? null : ctx.pdf.addPage(SEITE));
    y = SEITE[1] - RAND;
  };

  const tabellenKopf = () => {
    z.flaeche(RAND, y - KOPF_H, INHALT_BREITE, KOPF_H, farbe.kopf);
    let x = RAND;
    for (const sp of spalten) {
      if (sp.rechts) z.rechts(sp.titel, x + sp.breite - PAD_H, y - 13.5, fett, 8.5);
      else           z.schreibe(sp.titel, x + PAD_H, y - 13.5, fett, 8.5);
      x += sp.breite;
    }
    y -= KOPF_H;
  };

  const folgeSeite = () => {
    neueSeite();
    z.schreibe(`${d.titel} – Fortsetzung`, RAND, y - 11, fett, 11, farbe.gedaempft);
    y -= 24;
    tabellenKopf();
  };

  // --- Titel ---
  neueSeite();
  z.schreibe(d.titel, RAND, y - 18, fett, 20);
  y -= 34;

  const erstes  = d.auslagen[0]?.datum;
  const letztes = d.auslagen[d.auslagen.length - 1]?.datum;
  const zeitraum = erstes === letztes
    ? `Belegdatum ${formatiereDatum(erstes)}`
    : `Zeitraum ${formatiereDatum(erstes)} – ${formatiereDatum(letztes)}`;
  const unterzeile = [
    `Erstellt am ${formatiereDatum(heuteISO())}`,
    zeitraum,
    plural(d.auslagen.length, 'Auslage', 'Auslagen'),
    `Summe ${formatiereBetrag(gesamt)}`
  ].join(' · ');
  for (const t of umbrechen(unterzeile, normal, 10, INHALT_BREITE)) {
    z.schreibe(t, RAND, y, normal, 10, farbe.gedaempft);
    y -= 14;
  }
  y -= 10;
  tabellenKopf();

  // --- Zeilen ---
  const zeilen = d.auslagen.map((a, i) => {
    const hatBeleg = d.belege.has(a.id);
    const inhalt = {
      nr:       [String(i + 1)],
      datum:    [formatiereDatum(a.datum)],
      haendler: umbrechen(a.haendler, normal, GROESSE, breiteVon('haendler') - 2 * PAD_H, 3),
      zweck:    umbrechen(a.notiz, normal, GROESSE, breiteVon('zweck') - 2 * PAD_H, 4),
      status:   umbrechen(statusInfo(a.status).label, normal, GROESSE, breiteVon('status') - 2 * PAD_H, 2),
      betrag:   [formatiereBetrag(a.betrag)],
      beleg:    [hatBeleg ? `S. ${probelauf ? 0 : belegSeite.get(a.id)}` : 'fehlt']
    };
    const zeilenZahl = Math.max(...spalten.map((sp) => inhalt[sp.key].length));
    return { inhalt, hatBeleg, hoehe: 2 * PAD_V + GROESSE + (zeilenZahl - 1) * ZEILE };
  });

  zeilen.forEach((zeile, i) => {
    if (y - zeile.hoehe < UNTEN) folgeSeite();
    if (i % 2 === 1) z.flaeche(RAND, y - zeile.hoehe, INHALT_BREITE, zeile.hoehe, farbe.zebra);
    let x = RAND;
    for (const sp of spalten) {
      const f = sp.key === 'beleg' && !zeile.hatBeleg ? farbe.warnung : farbe.text;
      zeile.inhalt[sp.key].forEach((t, n) => {
        const grundlinie = y - PAD_V - 7 - n * ZEILE;
        if (sp.rechts) z.rechts(t, x + sp.breite - PAD_H, grundlinie, normal, GROESSE, f);
        else           z.schreibe(t, x + PAD_H, grundlinie, normal, GROESSE, f);
      });
      x += sp.breite;
    }
    y -= zeile.hoehe;
    z.linie(RAND, y, RAND + INHALT_BREITE);
  });

  // --- Summe ---
  if (y - SUMME_H < UNTEN) folgeSeite();
  const betragRechts = RAND + spalten
    .slice(0, spalten.findIndex((sp) => sp.key === 'betrag') + 1)
    .reduce((s, sp) => s + sp.breite, 0);
  z.linie(RAND, y, RAND + INHALT_BREITE, farbe.text, 1);
  z.schreibe('Gesamt', RAND + PAD_H, y - 16, fett, 10);
  z.rechts(formatiereBetrag(gesamt), betragRechts - PAD_H, y - 16, fett, 10);
  y -= SUMME_H;

  // --- Hinweise ---
  const ohneBeleg = zeilen.filter((zeile) => !zeile.hatBeleg).length;
  const hinweise = [];
  if (ohneBeleg) {
    hinweise.push(`Hinweis: ${plural(ohneBeleg, 'Auslage', 'Auslagen')} ohne Beleg (in der Tabelle mit „fehlt“ markiert).`);
  }
  if (d.belegFehler) {
    hinweise.push(`Hinweis: ${plural(d.belegFehler, 'Beleg konnte', 'Belege konnten')} nicht eingebettet werden – bitte separat beifügen.`);
  }
  if (hinweise.length) y -= 8;
  for (const hinweis of hinweise) {
    for (const t of umbrechen(hinweis, normal, 9.5, INHALT_BREITE)) {
      if (y - 14 < UNTEN) neueSeite();
      z.schreibe(t, RAND, y - 11, normal, 9.5, farbe.warnung);
      y -= 14;
    }
  }

  // --- Angaben zur Erstattung (nur bei Einreichung) ---
  if (d.einreichung) {
    const bestaetigung = umbrechen(
      'Hiermit bestätige ich, dass die aufgeführten Auslagen im Auftrag des Vereins entstanden sind, und bitte um Erstattung.',
      normal, 9.5, INHALT_BREITE);
    const blockHoehe = 40 + bestaetigung.length * 13 + 2 * 30 + 50;
    if (y - 28 - blockHoehe < UNTEN) neueSeite();
    else y -= 28;

    z.schreibe('Angaben zur Erstattung', RAND, y - 12, fett, 12);
    y -= 28;
    for (const t of bestaetigung) {
      z.schreibe(t, RAND, y, normal, 9.5, farbe.gedaempft);
      y -= 13;
    }
    const formular = d.einreichung;
    const wertX = RAND + 114;
    for (const [label, wert] of [['Name, Vorname', formular.name], ['IBAN', formular.iban]]) {
      y -= 30;
      z.schreibe(label, RAND, y + 3, normal, 10);
      if (wert) z.schreibe(kuerzen(wert, normal, 11, RAND + INHALT_BREITE - wertX), wertX, y + 4, normal, 11);
      z.linie(RAND + 110, y, RAND + INHALT_BREITE, farbe.text, 0.7);
    }
    y -= 50;
    const mitte = RAND + INHALT_BREITE * 0.42;
    if (formular.ortDatum) {
      z.schreibe(kuerzen(formular.ortDatum, normal, 11, mitte - 24 - RAND), RAND + 2, y + 4, normal, 11);
    }
    if (formular.unterschrift) {
      z.schreibe(kuerzen(formular.unterschrift, ctx.kursiv, 13, RAND + INHALT_BREITE - mitte - 4), mitte + 2, y + 4, ctx.kursiv, 13);
    }
    z.linie(RAND, y, mitte - 20, farbe.text, 0.7);
    z.linie(mitte, y, RAND + INHALT_BREITE, farbe.text, 0.7);
    z.schreibe('Ort, Datum', RAND, y - 12, normal, 8.5, farbe.gedaempft);
    z.schreibe('Unterschrift', mitte, y - 12, normal, 8.5, farbe.gedaempft);
  }

  return seitenAnzahl;
}

// ---------------------------------------------
// Belegseiten
// ---------------------------------------------
function zeichneBeleg(ctx, auslage, nr, beleg) {
  const { normal, fett, farbe } = ctx;
  const teile = beleg.art === 'pdf' ? beleg.seiten : [beleg.bild ?? null];

  teile.forEach((teil, i) => {
    const seite = ctx.pdf.addPage(SEITE);
    const z = zeichner(ctx, seite);
    let y = SEITE[1] - RAND;

    const betrag = formatiereBetrag(auslage.betrag);
    const zusatz = teile.length > 1 ? ` (Seite ${i + 1} von ${teile.length})` : '';
    z.schreibe(`Beleg zu Nr. ${nr}${zusatz}`, RAND, y - 13, fett, 13);
    z.rechts(betrag, RAND + INHALT_BREITE, y - 13, fett, 13);
    y -= 32;

    const info = [formatiereDatum(auslage.datum), auslage.haendler, auslage.notiz].filter(Boolean).join(' · ');
    z.schreibe(kuerzen(info, normal, 10, INHALT_BREITE), RAND, y, normal, 10, farbe.gedaempft);
    y -= 12;
    z.linie(RAND, y, RAND + INHALT_BREITE);
    y -= 14;

    if (beleg.art === 'fehler') {
      z.schreibe('Beleg konnte nicht eingebettet werden', RAND, y - 14, fett, 12, farbe.warnung);
      y -= 34;
      for (const t of umbrechen(`${beleg.grund} Bitte den Originalbeleg separat beifügen.`, normal, 10, INHALT_BREITE)) {
        z.schreibe(t, RAND, y, normal, 10);
        y -= 14;
      }
      return;
    }

    // Beleg einpassen (Seitenverhältnis bleibt erhalten), oben zentriert
    const boxHoehe = y - UNTEN;
    const faktor = Math.min(INHALT_BREITE / teil.width, boxHoehe / teil.height);
    const breite = teil.width * faktor;
    const hoehe  = teil.height * faktor;
    const pos = { x: RAND + (INHALT_BREITE - breite) / 2, y: y - hoehe, width: breite, height: hoehe };

    if (beleg.art === 'pdf') seite.drawPage(teil, pos);
    else                     seite.drawImage(teil, pos);
    seite.drawRectangle({ ...pos, borderColor: farbe.linie, borderWidth: 0.5 });
  });
}

function zeichneFusszeilen(ctx) {
  const { normal, farbe } = ctx;
  const seiten = ctx.pdf.getPages();
  const erstellt = `VereinsAuslagen · erstellt am ${formatiereDatum(heuteISO())}`;
  seiten.forEach((seite, i) => {
    const z = zeichner(ctx, seite);
    z.schreibe(erstellt, RAND, FUSS_Y, normal, 8, farbe.gedaempft);
    z.rechts(`Seite ${i + 1} von ${seiten.length}`, RAND + INHALT_BREITE, FUSS_Y, normal, 8, farbe.gedaempft);
  });
}
