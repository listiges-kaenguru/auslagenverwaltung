// =============================================
// EXPORT & DATENSICHERUNG
// JSZip und pdf-lib werden erst bei Bedarf geladen (schnellerer App-Start).
// =============================================
import {
  STATUS, statusInfo, formatiereDatum, betragAlsText, sichererDateiname, dateiEndung,
  heuteISO, ladeDateiHerunter, ladeSkript, summe
} from './hilfen.js';
import { ladeAuslagen, holeBeleg, importiereAuslagen, merkeBackup } from './speicher.js';
import { erstelleAuslagenPdf } from './pdf.js';
import { ladeStammdaten, speichereStammdaten, hatStammdaten, formatiereIban } from './stammdaten.js';

const BACKUP_FORMAT = 'vereinsauslagen-backup';
const BACKUP_JSON   = 'vereinsauslagen-backup.json';

const ladeJSZip = () => ladeSkript('vendor/jszip.min.js', 'JSZip');

// ---------------------------------------------
// Auswahl & Belege
// ---------------------------------------------

/** Mögliche Export-Auswahlen: ein Status oder „alle“ */
export const AUSWAHL_LISTE = [...Object.keys(STATUS), 'alle'];

export function auswahlLabel(auswahl) {
  return auswahl === 'alle' ? 'Alle' : statusInfo(auswahl).label;
}

/** Auslagen einer Auswahl, chronologisch (älteste zuerst – so erwartet es die Kasse) */
export function auslagenFuerAuswahl(auswahl) {
  return ladeAuslagen()
    .filter((a) => auswahl === 'alle' || a.status === auswahl)
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.erstelltAm.localeCompare(b.erstelltAm));
}

function auslagenOderFehler(auswahl) {
  const auslagen = auslagenFuerAuswahl(auswahl);
  if (auslagen.length === 0) throw new Error('Keine Auslagen in dieser Auswahl');
  return auslagen;
}

/** Dateiname mit Auswahl und Datum, z. B. VereinsAuslagen_Offen_2026-09-23.csv */
function dateiname(teil, auswahl, endung) {
  return sichererDateiname(`VereinsAuslagen_${teil ? `${teil}_` : ''}${auswahlLabel(auswahl)}_${heuteISO()}`) + `.${endung}`;
}

/** Belege laden und eindeutige, sprechende Dateinamen vergeben */
async function sammleBelege(auslagen) {
  const vergeben = new Set();
  const ergebnis = [];
  for (const auslage of auslagen) {
    if (!auslage.hatFoto) continue;
    const blob = await holeBeleg(auslage.id);
    if (!blob) continue;

    const basis  = sichererDateiname(`${auslage.datum}_${auslage.haendler}_${auslage.betrag.toFixed(2)}EUR`);
    const endung = dateiEndung(blob.type);
    let name = `${basis}.${endung}`;
    // Gleiche Kombination aus Datum/Händler/Betrag darf sich nicht überschreiben
    for (let n = 2; vergeben.has(name.toLowerCase()); n++) name = `${basis}_${n}.${endung}`;
    vergeben.add(name.toLowerCase());

    ergebnis.push({ auslage, blob, name });
  }
  return ergebnis;
}

// ---------------------------------------------
// CSV
// ---------------------------------------------

/** CSV-Textfeld: immer quotiert, Formel-Injection in Excel verhindert */
function csvFeld(wert) {
  let text = String(wert ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function erstelleCSV(auslagen, belegNamen = new Map()) {
  const kopf = ['Datum', 'Händler', 'Verwendungszweck', 'Betrag (EUR)', 'Status', 'Beleg', 'ID'].map(csvFeld);

  const zeilen = auslagen.map((a) => [
    csvFeld(formatiereDatum(a.datum)),
    csvFeld(a.haendler),
    csvFeld(a.notiz),
    betragAlsText(a.betrag),
    csvFeld(statusInfo(a.status).label),
    csvFeld(belegNamen.get(a.id) || (a.hatFoto ? 'Ja' : 'Nein')),
    csvFeld(a.id)
  ]);

  zeilen.push(['', csvFeld('Gesamt'), '', betragAlsText(summe(auslagen)), '', '', '']);

  // UTF-8-BOM + Semikolon: wird von deutschem Excel direkt korrekt geöffnet
  const inhalt = '﻿' + [kopf, ...zeilen].map((z) => z.join(';')).join('\r\n') + '\r\n';
  return new Blob([inhalt], { type: 'text/csv;charset=utf-8' });
}

/** Nur die CSV-Tabelle herunterladen */
export function exportiereCSV(auswahl) {
  ladeDateiHerunter(erstelleCSV(auslagenOderFehler(auswahl)), dateiname('', auswahl, 'csv'));
}

/** Komplettpaket: ZIP mit CSV (inkl. Beleg-Dateinamen) und allen Belegen */
export async function exportierePaket(auswahl) {
  const auslagen = auslagenOderFehler(auswahl);

  const [JSZip, belege] = await Promise.all([ladeJSZip(), sammleBelege(auslagen)]);
  const belegNamen = new Map(belege.map((b) => [b.auslage.id, b.name]));

  const zip = new JSZip();
  zip.file(dateiname('', auswahl, 'csv'), erstelleCSV(auslagen, belegNamen));
  const ordner = zip.folder('Belege');
  // Fotos/PDFs sind bereits komprimiert → nur speichern (schneller)
  for (const b of belege) ordner.file(b.name, b.blob, { compression: 'STORE' });

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  ladeDateiHerunter(blob, dateiname('Export', auswahl, 'zip'));
  return belege.length;
}

/** PDF mit tabellarischer Übersicht und allen Belegen herunterladen → Anzahl nicht einbettbarer Belege */
export async function exportierePdf(auswahl) {
  const auslagen = auslagenOderFehler(auswahl);
  const { blob, belegFehler } = await erstelleAuslagenPdf(auslagen, {
    titel:     `Auslagen – ${auswahlLabel(auswahl)}`,
    mitStatus: auswahl === 'alle'
  });
  await ladeDateiHerunter(blob, dateiname('', auswahl, 'pdf'));
  return belegFehler;
}

/** Einreichungs-PDF (mit Unterschriftsfeld) erstellen → { blob, dateiname, belegFehler } */
export async function erstelleEinreichung(auslagen) {
  // Formularfelder aus den Stammdaten; Datum = Tag der Einreichung
  const sd = ladeStammdaten();
  const { blob, belegFehler } = await erstelleAuslagenPdf(auslagen, {
    titel:       'Einreichung von Auslagen',
    einreichung: {
      name:         [sd.nachname, sd.vorname].filter(Boolean).join(', '),
      iban:         formatiereIban(sd.iban),
      ortDatum:     [sd.ort, formatiereDatum(heuteISO())].filter(Boolean).join(', '),
      unterschrift: sd.nachname ? `gez. ${sd.nachname}` : ''
    }
  });
  return { blob, belegFehler, dateiname: sichererDateiname(`VereinsAuslagen_Einreichung_${heuteISO()}`) + '.pdf' };
}

// ---------------------------------------------
// Teilen (Web Share API, v. a. auf Mobilgeräten)
// ---------------------------------------------
export function kannDateienTeilen() {
  try {
    return !!navigator.canShare?.({ files: [new File(['x'], 'test.csv', { type: 'text/csv' })] });
  } catch {
    return false;
  }
}

/** CSV + Belege über das Teilen-Menü (Mail, Messenger, Cloud …) versenden */
export async function teileExport(auswahl) {
  const auslagen = auslagenOderFehler(auswahl);

  const belege = await sammleBelege(auslagen);
  const belegNamen = new Map(belege.map((b) => [b.auslage.id, b.name]));
  const dateien = [
    new File([erstelleCSV(auslagen, belegNamen)], dateiname('', auswahl, 'csv'), { type: 'text/csv' }),
    ...belege.map((b) => new File([b.blob], b.name, { type: b.blob.type }))
  ];

  const gesamt = betragAlsText(summe(auslagen));
  const daten = {
    files: dateien,
    title: 'Vereinsauslagen',
    text:  `Auslagen (${auswahlLabel(auswahl)}): ${auslagen.length} Posten, gesamt ${gesamt} €`
  };
  if (!navigator.canShare?.(daten)) throw new Error('Teilen dieser Dateien wird nicht unterstützt');

  try {
    await navigator.share(daten);
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false; // Nutzer hat abgebrochen
    throw err;
  }
}

// ---------------------------------------------
// Datensicherung (alle Auslagen + Belege)
// ---------------------------------------------

/** Backup-ZIP mit JSON-Daten und allen Belegen herunterladen */
export async function erstelleBackup() {
  const JSZip = await ladeJSZip();
  const zip = new JSZip();
  const auslagen = ladeAuslagen();
  const daten = [];

  for (const auslage of auslagen) {
    let belegDatei = null;
    let belegTyp   = null;
    if (auslage.hatFoto) {
      const blob = await holeBeleg(auslage.id);
      if (blob) {
        belegDatei = `belege/${sichererDateiname(auslage.id)}.${dateiEndung(blob.type)}`;
        belegTyp   = blob.type || null;
        zip.file(belegDatei, blob, { compression: 'STORE' });
      }
    }
    daten.push({ ...auslage, belegDatei, belegTyp });
  }

  zip.file(BACKUP_JSON, JSON.stringify({
    format:     BACKUP_FORMAT,
    version:    1,
    erstelltAm: new Date().toISOString(),
    anzahl:     daten.length,
    auslagen:   daten,
    ...(hatStammdaten() ? { stammdaten: ladeStammdaten() } : {})
  }, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (await ladeDateiHerunter(blob, `VereinsAuslagen_Backup_${heuteISO()}.zip`)) merkeBackup();
  return daten.length;
}

const MIME_AUS_ENDUNG = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

/** Backup-ZIP einlesen; vorhandene Einträge (gleiche ID) bleiben unverändert */
export async function spieleBackupEin(datei, fortschritt) {
  const JSZip = await ladeJSZip();

  let zip;
  try {
    zip = await JSZip.loadAsync(datei);
  } catch {
    throw new Error('Keine gültige Backup-Datei (ZIP erwartet)');
  }

  const jsonDatei = zip.file(BACKUP_JSON);
  if (!jsonDatei) throw new Error('Backup-Datei enthält keine VereinsAuslagen-Daten');

  let daten;
  try {
    daten = JSON.parse(await jsonDatei.async('string'));
  } catch {
    throw new Error('Backup-Daten sind beschädigt');
  }
  if (daten?.format !== BACKUP_FORMAT || !Array.isArray(daten.auslagen)) {
    throw new Error('Unbekanntes Backup-Format');
  }

  const eintraege = [];
  for (const { belegDatei, belegTyp, ...auslage } of daten.auslagen) {
    let beleg = null;
    const eintrag = typeof belegDatei === 'string' ? zip.file(belegDatei) : null;
    if (eintrag) {
      const endung = belegDatei.split('.').pop().toLowerCase();
      const typ = belegTyp || MIME_AUS_ENDUNG[endung] || 'application/octet-stream';
      beleg = new Blob([await eintrag.async('arraybuffer')], { type: typ });
    }
    eintraege.push({ auslage, beleg });
  }

  // Stammdaten nur übernehmen, wenn im Profil noch keine gepflegt sind
  if (daten.stammdaten && !hatStammdaten()) await speichereStammdaten(daten.stammdaten).catch(() => {});

  return importiereAuslagen(eintraege, fortschritt);
}
