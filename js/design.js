// =============================================
// FARBSCHEMA (Hell / Dunkel / System)
// Klassisches Skript im <head> – läuft vor dem ersten Zeichnen, damit nichts aufblitzt.
// Setzt <html data-theme="light|dark"> und stellt window.VADesign für main.js bereit.
// =============================================
(function () {
  'use strict';

  var LS_DESIGN = 'va_design';
  var WAHLEN = ['system', 'light', 'dark'];
  var KOPF_FARBE = { light: '#16171a', dark: '#0b0c0e' };
  var systemDunkel = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var sitzungsWahl = 'system'; // Rückfall, falls localStorage gesperrt ist

  function holeWahl() {
    try {
      var wert = localStorage.getItem(LS_DESIGN);
      return WAHLEN.indexOf(wert) === -1 ? 'system' : wert;
    } catch (e) {
      return sitzungsWahl;
    }
  }

  function anwenden() {
    var wahl = holeWahl();
    var theme = wahl === 'system' ? (systemDunkel && systemDunkel.matches ? 'dark' : 'light') : wahl;
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-wahl', wahl);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', KOPF_FARBE[theme]);
    document.dispatchEvent(new CustomEvent('design-geaendert', { detail: { wahl: wahl, theme: theme } }));
  }

  function setzeWahl(wahl) {
    sitzungsWahl = wahl;
    try {
      if (wahl === 'system') localStorage.removeItem(LS_DESIGN);
      else localStorage.setItem(LS_DESIGN, wahl);
    } catch (e) { /* nicht speicherbar → gilt nur für diese Sitzung */ }
    anwenden();
  }

  if (systemDunkel) {
    var beiAenderung = function () { if (holeWahl() === 'system') anwenden(); };
    if (systemDunkel.addEventListener) systemDunkel.addEventListener('change', beiAenderung);
    else if (systemDunkel.addListener) systemDunkel.addListener(beiAenderung);
  }
  // Wahl in einem anderen Tab geändert
  window.addEventListener('storage', function (e) {
    if (e.key === LS_DESIGN || e.key === null) anwenden();
  });

  anwenden();

  window.VADesign = { WAHLEN: WAHLEN, holeWahl: holeWahl, setzeWahl: setzeWahl };
})();
