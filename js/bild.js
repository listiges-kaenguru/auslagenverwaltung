// =============================================
// BELEG-VERARBEITUNG
// Fotos werden verkleinert und als JPEG gespeichert, PDFs unverändert.
// =============================================

const MAX_BREITE   = 1600;
const MAX_HOEHE    = 3200;  // Kassenbons sind oft lang und schmal
const JPEG_QUALI   = 0.82;
const MAX_PDF_MB   = 15;

export const BELEG_ACCEPT = 'image/*,application/pdf';

export function istPdf(blob) {
  return blob?.type === 'application/pdf';
}

/** Datei prüfen und für die Speicherung vorbereiten → Blob */
export async function bereiteBelegVor(datei) {
  if (!datei) throw new Error('Keine Datei gewählt');

  if (istPdf(datei) || /\.pdf$/i.test(datei.name || '')) {
    if (datei.size > MAX_PDF_MB * 1024 * 1024) {
      throw new Error(`PDF ist größer als ${MAX_PDF_MB} MB`);
    }
    return new Blob([datei], { type: 'application/pdf' });
  }

  // Manche Systeme liefern bei Kamera-Fotos keinen MIME-Typ → trotzdem versuchen
  if (datei.type && !datei.type.startsWith('image/')) {
    throw new Error('Bitte ein Foto oder PDF wählen');
  }
  return komprimiereBild(datei);
}

/** Bild dekodieren (EXIF-Ausrichtung wird berücksichtigt) */
async function ladeBild(datei) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(datei, { imageOrientation: 'from-image' });
    } catch { /* Fallback unten */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bildformat wird von diesem Browser nicht unterstützt'));
    };
    img.src = url;
  });
}

async function komprimiereBild(datei) {
  const bild   = await ladeBild(datei);
  const breite = bild.naturalWidth  || bild.width;
  const hoehe  = bild.naturalHeight || bild.height;
  const faktor = Math.min(1, MAX_BREITE / breite, MAX_HOEHE / hoehe);

  const canvas  = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(breite * faktor));
  canvas.height = Math.max(1, Math.round(hoehe  * faktor));

  const ctx = canvas.getContext('2d');
  // Weißer Hintergrund: transparente PNGs würden als JPEG sonst schwarz
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bild, 0, 0, canvas.width, canvas.height);
  bild.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALI));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden');

  // Bereits kleines JPEG nicht unnötig vergrößern
  if (faktor === 1 && datei.type === 'image/jpeg' && datei.size <= blob.size) {
    return new Blob([datei], { type: 'image/jpeg' });
  }
  return blob;
}
