// Preferencias de quien usa este navegador (no viajan al servidor).

import * as Coords from './coords.js';

const KEY = 'formatoCoord';
const listeners = new Set();

/** Formato para mostrar y capturar coordenadas: decimal, gms o utm. */
export function coordFormat() {
  let f = null;
  try { f = localStorage.getItem(KEY); } catch { /* sin almacenamiento */ }
  return Coords.FORMATS.some(([k]) => k === f) ? f : Coords.DECIMAL;
}

export function setCoordFormat(f) {
  try { localStorage.setItem(KEY, f); } catch { /* sin almacenamiento */ }
  for (const fn of listeners) fn(f);
}

export function onCoordFormat(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
