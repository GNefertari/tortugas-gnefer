// Tablas de nidos y de limpiezas, con buscador y orden por columna.

import { can, speciesName, statusColor, statusName } from './catalog.js';
import { exportCleaningsCsv, exportKml, exportNestsCsv } from './exportar.js';
import { cleaningForm, nestForm } from './formularios.js';
import * as Coords from './coords.js';
import { position } from './mapa.js';
import { coordFormat, onCoordFormat } from './prefs.js';
import { byNumber, clear, h, showDate } from './ui.js';

function table(columns, rows, onRow, sortState, rerender) {
  const head = h('tr', columns.map((c) => {
    const active = sortState.key === c.key;
    return h('th', { class: c.sort === false ? '' : 'sortable' + (active ? ' active' : ''),
      onclick: c.sort === false ? null : () => {
        sortState.dir = active ? -sortState.dir : 1;
        sortState.key = c.key;
        rerender();
      } }, c.title + (active ? (sortState.dir > 0 ? ' ▲' : ' ▼') : ''));
  }));
  const col = columns.find((c) => c.key === sortState.key);
  if (col) {
    const cmp = col.cmp || ((a, b) => String(col.value(a) ?? '').localeCompare(String(col.value(b) ?? ''), 'es', { numeric: true }));
    rows = [...rows].sort((a, b) => cmp(a, b) * sortState.dir);
  }
  const body = rows.map((r) => h('tr', { onclick: () => onRow(r) }, columns.map((c) => h('td', c.render ? c.render(r) : c.value(r) ?? '—'))));
  return h('div.table-wrap', h('table.data', h('thead', head), h('tbody', body)));
}

const chip = (status) => h('span.status', h('i', { style: { background: statusColor(status) } }), statusName(status));

export function nestsView(ctx) {
  const { store, filter, user } = ctx;
  const el = h('section.view.list-view');
  const sort = { key: 'number', dir: 1 };

  function render() {
    const list = store.nests().filter(filter.matches);
    const columns = [
      { key: 'season', title: 'Temp.', value: (n) => n.season },
      { key: 'number', title: 'Nº', value: (n) => n.number, cmp: (a, b) => (a.season || 0) - (b.season || 0) || byNumber(a.number, b.number) },
      { key: 'detected_date', title: 'Detección', value: (n) => n.detected_date, render: (n) => showDate(n.detected_date) },
      { key: 'species', title: 'Especie', value: (n) => speciesName(n.species), render: (n) => h('i', speciesName(n.species)) },
      { key: 'status', title: 'Estado', value: (n) => statusName(n.status), render: (n) => chip(n.status) },
      { key: 'beach', title: 'Playa', value: (n) => n.beach },
      { key: 'zone', title: 'Zona', value: (n) => n.zone },
      { key: 'hatch_date', title: 'Eclosión', value: (n) => n.hatch_date, render: (n) => showDate(n.hatch_date) },
      { key: 'coord', title: 'Coordenada', sort: false, render: (n) => {
        const p = position(n);
        return p ? h('span.mono', Coords.format(p[0], p[1], coordFormat(), store.settings?.utm_zone || 16)) : '—';
      } },
      { key: 'img', title: 'Imág.', value: (n) => store.masksOf(n.uuid).length + store.photosOf(n.uuid).length },
      { key: 'observer', title: 'Registró', value: (n) => n.observer },
    ];
    clear(el).append(
      h('div.list-head',
        h('h2', 'Nidos'),
        h('span.count', list.length + ' de ' + store.nests().length),
        h('div.spacer'),
        downloads([
          ['Tabla para Excel (.csv)', 'Todos los datos de los nidos que ves, con coordenadas en los 3 formatos', () => exportNestsCsv(ctx, list)],
          // KML solo para experto y coordinador.
          can(user, 'experto') ? ['Puntos para Google Earth (.kml)', 'Los nidos como puntos, para abrir en Google Earth, Google My Maps o QGIS', () => exportKml(ctx, list)] : null,
        ].filter(Boolean)),
        can(user, 'capturista') ? h('button.btn.primary.small', { type: 'button', onclick: () => nestForm(ctx, null) }, '+ Nuevo nido') : null),
      filter.controls(store),
      list.length ? table(columns, list, (n) => ctx.openNest(n.uuid), sort, render)
        : h('p.empty', store.nests().length ? 'Ningún nido coincide con el filtro.' : 'Todavía no hay nidos registrados.'));
  }

  const off1 = store.onChange(render), off2 = filter.onChange(render), off3 = onCoordFormat(render);
  return { el, show: render, destroy() { off1(); off2(); off3(); } };
}

/** Botón "Descargar" con las opciones explicadas. */
function downloads(items) {
  const d = h('details.dropdown',
    h('summary.btn.ghost.small', 'Descargar ▾'),
    h('div.menu', items.map(([title, desc, fn]) => h('button', { type: 'button', onclick: () => { d.open = false; fn(); } },
      h('b', title), h('small', desc)))));
  return d;
}

export function cleaningsView(ctx) {
  const { store, filter, user } = ctx;
  const el = h('section.view.list-view');
  const sort = { key: 'clean_date', dir: -1 };

  function render() {
    const list = store.cleanings().map((k) => ({ k, n: store.nest(k.nest_uuid) })).filter((x) => filter.matches(x.n));
    const columns = [
      { key: 'season', title: 'Temp.', value: (x) => x.n.season },
      { key: 'number', title: 'Nido', value: (x) => x.n.number, cmp: (a, b) => byNumber(a.n.number, b.n.number) },
      { key: 'clean_date', title: 'Limpieza', value: (x) => x.k.clean_date, render: (x) => showDate(x.k.clean_date) },
      { key: 'beach', title: 'Playa', value: (x) => x.n.beach },
      { key: 'shells', title: 'Cascarones', value: (x) => x.k.shells },
      { key: 'alive', title: 'Vivas', value: (x) => x.k.alive },
      { key: 'dead', title: 'Muertas', value: (x) => x.k.dead },
      { key: 'pink', title: 'Rosa', value: (x) => x.k.pink },
      { key: 'phase', title: 'Fase', value: (x) => x.k.phase_total,
        render: (x) => x.k.phase_mode === 'detalle' ? (x.k.phase_total ?? '—') + ' (' + [x.k.phase1, x.k.phase2, x.k.phase3].map((v) => v ?? '—').join('/') + ')' : x.k.phase_total ?? '—' },
      { key: 'observer', title: 'Registró', value: (x) => x.k.observer },
    ];
    clear(el).append(
      h('div.list-head',
        h('h2', 'Limpiezas'),
        h('span.count', list.length + ' de ' + store.cleanings().length),
        h('div.spacer'),
        downloads([
          ['Tabla para Excel (.csv)', 'Las limpiezas que ves, con su nido', () => exportCleaningsCsv(ctx, list)],
        ]),
        can(user, 'capturista') ? h('button.btn.primary.small', { type: 'button', onclick: () => cleaningForm(ctx, null) }, '+ Registrar limpieza') : null),
      filter.controls(store),
      list.length ? table(columns, list, (x) => ctx.openNest(x.n.uuid), sort, render)
        : h('p.empty', store.cleanings().length ? 'Ninguna limpieza coincide con el filtro.' : 'Todavía no hay limpiezas registradas.'));
  }

  const off1 = store.onChange(render), off2 = filter.onChange(render);
  return { el, show: render, destroy() { off1(); off2(); } };
}
