// Filtro de nidos compartido por el mapa y la tabla (mismos criterios que MapFilter.java de la
// app). Se recuerda en este navegador.

import { SPECIES, STATUS } from './catalog.js';
import { h, select } from './ui.js';

export function createFilter(slug) {
  const key = 'filtro:' + slug;
  let f = { season: '', species: '', status: '', beach: '', from: '', to: '', text: '' };
  try { Object.assign(f, JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* sin almacenamiento */ }
  const listeners = new Set();

  function set(changes) {
    Object.assign(f, changes);
    try { localStorage.setItem(key, JSON.stringify(f)); } catch { /* sin almacenamiento */ }
    for (const fn of listeners) fn();
  }

  function matches(n) {
    if (f.season && String(n.season ?? '') !== f.season) return false;
    if (f.species && n.species !== f.species) return false;
    if (f.status && n.status !== f.status) return false;
    if (f.beach && (n.beach || '') !== f.beach) return false;
    if (f.from && (!n.detected_date || n.detected_date < f.from)) return false;
    if (f.to && (!n.detected_date || n.detected_date > f.to)) return false;
    if (f.text) {
      const t = f.text.toLowerCase();
      const hay = [n.number, n.beach, n.notes, n.observer, n.turtle_notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  }

  const active = () => Object.values(f).some(Boolean);

  /** Controles del filtro (se reconstruyen con las temporadas y playas que existen). */
  function controls(store, { withText = true } = {}) {
    const seasons = store.seasons().map((s) => [String(s), String(s)]);
    const beaches = [...new Set([...(store.settings?.beaches || []), ...store.beachesInUse()])];
    const onChange = (k) => (e) => set({ [k]: e.target.value });
    return h('div.filters',
      withText ? h('input.search', { type: 'search', placeholder: 'Buscar nº, playa, notas…', value: f.text, oninput: onChange('text') }) : null,
      select([['', 'Todas las temporadas'], ...seasons], f.season, { onchange: onChange('season'), title: 'Temporada' }),
      select([['', 'Todas las especies'], ...SPECIES.map((s) => [s[0], s[1]])], f.species, { onchange: onChange('species'), title: 'Especie' }),
      select([['', 'Todos los estados'], ...STATUS.map((s) => [s[0], s[1]])], f.status, { onchange: onChange('status'), title: 'Estado' }),
      select([['', 'Todas las playas'], ...beaches], f.beach, { onchange: onChange('beach'), title: 'Playa' }),
      h('label.date-range', h('span', 'Detección'),
        h('input', { type: 'date', value: f.from, onchange: onChange('from'), title: 'Desde' }),
        h('span', '–'),
        h('input', { type: 'date', value: f.to, onchange: onChange('to'), title: 'Hasta' })),
      active() ? h('button.btn.ghost.small', { type: 'button', onclick: () => set({ season: '', species: '', status: '', beach: '', from: '', to: '', text: '' }) }, 'Quitar filtros') : null,
    );
  }

  return { matches, set, controls, active, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }, get value() { return f; } };
}
