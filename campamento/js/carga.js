// Carga masiva desde Excel/CSV (paso 5b), para experto y coordinador.
//
//   1. Archivos: un Excel con las hojas «Nidos» y «Limpiezas», o dos CSV (nidos y limpiezas);
//      también sirve solo uno de los dos. Hay plantillas para descargar en Excel y en CSV.
//   2. Columnas: de qué tipo es cada hoja y qué dato es cada columna (se recuerda para la
//      siguiente carga); formato de coordenadas.
//   3. Vista previa: cada renglón validado (errores, avisos, nuevos y ya existentes). Cada limpieza
//      se enlaza con su nido por temporada y número. Los que ya existen: actualizar u omitir,
//      todos o uno por uno.
//   4. Cargar en partes (primero los nidos, luego las limpiezas); queda en el historial y se puede
//      deshacer completa (el experto, solo las suyas).
//
// Los archivos se leen en el navegador con SheetJS (se descarga solo al usar esta sección).

import { speciesName, statusName } from './catalog.js';
import * as Coords from './coords.js';
import {
  autoMap, buildCleaningRows, buildNestRows, CLEANINGS, fieldsOf, guessHeaderRow, guessKind, IGNORE, linkSheets,
  mappingMemory, missingFields, NESTS, templateSheets, toCleaningPayload, toCsv, toPayload,
} from './carga_lectura.js';
import { busy, clear, confirmBox, downloadText, h, select, showDate, showDateTime, toast } from './ui.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const PART = 400;           // renglones por petición (el servidor acepta hasta 500)
const PAGE = 200;           // renglones de la vista previa que se dibujan a la vez
const CENTER = [20.42, -86.92];   // Cozumel: para avisar de coordenadas muy lejanas
const KIND_NAMES = { [NESTS]: 'Nidos', [CLEANINGS]: 'Limpiezas', [IGNORE]: 'No usar' };

let xlsxPromise = null;
function loadXlsx() {
  if (!xlsxPromise) {
    xlsxPromise = import(XLSX_URL).catch(() => {
      xlsxPromise = null;
      throw new Error('No se pudo cargar el lector de Excel. Revisa tu conexión a internet.');
    });
  }
  return xlsxPromise;
}

/** Lee un archivo -> [{name, rows, firstRow}] con las celdas tal cual (fechas como Date). */
async function readFile(file) {
  const XLSX = await loadXlsx();
  let wb;
  const csv = /\.(csv|txt|tsv)$/i.test(file.name);
  if (csv) {
    // CSV: UTF-8 o, si no lo es, Windows-1252 (Excel en español). raw = no adivinar fechas (serían mes/día).
    const buf = await file.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
    wb = XLSX.read(txt.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  }
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return null;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { name: csv ? file.name : name, rows, firstRow: range.s.r + 1 };
  }).filter((s) => s && s.rows.length);
}

const cellText = (v) => (v == null ? '' : v instanceof Date ? showDate(v.toISOString().slice(0, 10)) : String(v));
const isBlankRow = (r) => !r || r.every((v) => v == null || String(v).trim() === '');

export function cargaView(ctx) {
  const { api, store, user } = ctx;
  const el = h('section.view.list-view.carga');
  // Como clear(el).append(), pero sin escribir "null" por las partes que no aplican.
  const put = (...nodes) => clear(el).append(...nodes.flat().filter((x) => x != null && x !== false));
  const state = { files: [], sheets: null, format: 'auto', mode: 'actualizar', nests: [], cleans: [], tab: NESTS, filter: 'todos', shown: PAGE };
  const remembered = () => (store.settings && store.settings.import_mapping) || {};

  // ───────────────────────────── 1. archivos + historial

  function renderStart() {
    state.sheets = null;
    state.nests = [];
    state.cleans = [];
    const input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xls,.xlsm,.ods,.csv,.txt', hidden: true,
      onchange: () => input.files.length && open([...input.files]) });
    const drop = h('label.drop', { onclick: () => input.click(),
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) open([...e.dataTransfer.files]); } },
    h('b', 'Elige o arrastra aquí los archivos'),
    h('span', 'Un Excel con las hojas «Nidos» y «Limpiezas», o dos CSV (nidos y limpiezas) juntos. También puedes subir solo uno de los dos.'),
    h('span', 'Nada se guarda hasta que confirmes la carga.'));
    const history = h('div.history', h('p.muted', 'Cargando historial…'));
    put(
      h('div.list-head', h('h2', 'Cargar desde Excel o CSV'), h('div.spacer'), templatesMenu()),
      h('p.lead', 'Para cargar temporadas anteriores. Los nidos y sus limpiezas van en hojas (o archivos) separados; cada limpieza se enlaza con su nido por temporada y número. Sirven las plantillas o el Excel que ya tienes: en el siguiente paso se elige qué dato es cada columna, y se recuerda para la próxima vez.'),
      drop, input,
      h('h3.section-title', 'Cargas anteriores'),
      history);
    renderHistory(history);
  }

  function templatesMenu() {
    const d = h('details.dropdown',
      h('summary.btn.ghost.small', 'Descargar plantilla ▾'),
      h('div.menu', [
        ['Excel (.xlsx)', 'Una hoja de nidos, una de limpiezas y las instrucciones', () => downloadTemplate('xlsx')],
        ['CSV de nidos', 'Para llenar en Excel o en cualquier hoja de cálculo', () => downloadTemplate('nidos')],
        ['CSV de limpiezas', 'Cada limpieza con la temporada y el número de su nido', () => downloadTemplate('limpiezas')],
      ].map(([title, desc, fn]) => h('button', { type: 'button', onclick: () => { d.open = false; fn().catch((e) => toast(e.message, 'error')); } },
        h('b', title), h('small', desc)))));
    return d;
  }

  async function downloadTemplate(which) {
    const s = store.settings || {};
    const t = templateSheets(s.beaches || [], s.phase_mode);
    if (which !== 'xlsx') {
      downloadText('plantilla_' + which + '_' + ctx.slug + '.csv', toCsv(t[which]), 'text/csv');
      return;
    }
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const add = (rows, name, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths || rows[0].map((c) => ({ wch: Math.max(12, String(c).length + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add(t.nidos, 'Nidos');
    add(t.limpiezas, 'Limpiezas');
    add(t.help, 'Instrucciones', [{ wch: 34 }, { wch: 80 }, { wch: 70 }]);
    XLSX.writeFile(wb, 'plantilla_nidos_y_limpiezas_' + ctx.slug + '.xlsx');
  }

  async function renderHistory(box) {
    let list;
    try {
      list = (await api.imports()).cargas;
    } catch (e) {
      clear(box).append(h('p.error', e.message));
      return;
    }
    if (!list.length) { clear(box).append(h('p.muted', 'Todavía no hay cargas.')); return; }
    clear(box).append(h('div.table-wrap', h('table.data.static',
      h('thead', h('tr', ['Fecha', 'Archivo', 'Quién', 'Nidos nuevos', 'Actualizados', 'Omitidos', 'Rechazados', 'Limpiezas', 'Estado', ''].map((t) => h('th', t)))),
      h('tbody', list.map((c) => h('tr' + (c.deshecha ? '.inactive' : ''),
        h('td', showDateTime(c.fecha)), h('td', c.archivo), h('td', c.usuario || '—'),
        h('td', String(c.creados)), h('td', String(c.actualizados)), h('td', String(c.omitidos)), h('td', String(c.rechazados)), h('td', String(c.limpiezas)),
        h('td', c.deshecha
          ? 'Deshecha ' + showDateTime(c.deshecha) + (c.deshecha_por ? ' por ' + c.deshecha_por : '') + (c.conservados ? ' · ' + c.conservados + ' fila(s) se conservaron porque cambiaron después' : '')
          : 'Vigente'),
        h('td', c.puede_deshacer ? h('button.btn.danger.small', { type: 'button', onclick: (e) => undo(c, e.currentTarget) }, 'Deshacer') : null)))))));
  }

  async function undo(c, btn) {
    const ok = await confirmBox('Deshacer la carga',
      'Se quitarán los ' + c.creados + ' nido(s) que creó «' + c.archivo + '» y las limpiezas que agregó; los ' + c.actualizados
      + ' nido(s) y las limpiezas que actualizó volverán a como estaban. Lo que alguien haya cambiado después de la carga se respeta. Las tabletas lo reciben al sincronizar.',
      'Deshacer la carga', true);
    if (!ok) return;
    await busy(btn, async () => {
      const d = await api.undoImport(c.id);
      toast('Carga deshecha: ' + d.revertidos + ' fila(s)' + (d.conservados ? '; ' + d.conservados + ' se conservaron porque cambiaron después' : ''));
      await store.sync(user.id);
      renderStart();
    });
  }

  async function open(files) {
    put(h('p.muted', 'Leyendo ' + files.map((f) => f.name).join(', ') + '…'));
    try {
      const sheets = [];
      for (const f of files) {
        const list = await readFile(f);
        for (const s of list) {
          s.label = list.length > 1 ? f.name + ' · ' + s.name : f.name;
          s.headerRow = guessHeaderRow(s.rows);
          s.kind = guessKind(s.name, headersOf(s));
          s.mapping = autoMap(headersOf(s), remembered(), s.kind);
          sheets.push(s);
        }
      }
      if (!sheets.length) throw new Error('Los archivos no tienen datos');
      state.files = files;
      state.sheets = sheets;
      const f = remembered()._formato;
      state.format = ['auto', Coords.DECIMAL, Coords.DMS, Coords.UTM].includes(f) ? f : 'auto';
      renderColumns();
    } catch (e) {
      toast(e.message || String(e), 'error');
      renderStart();
    }
  }

  // ───────────────────────────── 2. columnas

  function headersOf(s) {
    return (s.rows[s.headerRow] || []).map((v) => (v == null ? '' : String(v).trim()));
  }

  function sheetBlock(s, onChange) {
    const hd = headersOf(s);
    const kindSel = select([[NESTS, 'Nidos'], [CLEANINGS, 'Limpiezas'], [IGNORE, 'No usar esta hoja']], s.kind, { onchange: (e) => {
      s.kind = e.target.value;
      s.mapping = autoMap(headersOf(s), remembered(), s.kind);
      renderColumns();
    } });
    const headerSel = select(s.rows.slice(0, 15).map((r, i) => [i, 'Renglón ' + (s.firstRow + i) + ': ' + (r || []).filter((v) => v != null).slice(0, 4).map(cellText).join(' · ').slice(0, 70)]),
      s.headerRow, { onchange: (e) => {
        s.headerRow = Number(e.target.value);
        s.mapping = autoMap(headersOf(s), remembered(), s.kind);
        renderColumns();
      } });
    const top = h('div.grid2', h('label.field', h('span.label', 'Esta hoja tiene'), kindSel),
      s.kind !== IGNORE ? h('label.field', h('span.label', 'Los encabezados están en'), headerSel) : null);
    if (s.kind === IGNORE) return h('fieldset', h('legend', s.label), top);

    const sample = s.rows.slice(s.headerRow + 1).filter((r) => !isBlankRow(r)).slice(0, 3);
    const options = [[IGNORE, '— No usar —'], ...fieldsOf(s.kind).map((f) => [f.id, f.label])];
    const selects = hd.map((name, i) => select(options, s.mapping[i], { onchange: (e) => {
      const v = e.target.value;
      // Un dato solo puede venir de una columna: se quita de la otra.
      if (v !== IGNORE) s.mapping.forEach((m, j) => { if (m === v && j !== i) { s.mapping[j] = IGNORE; selects[j].value = IGNORE; } });
      s.mapping[i] = v;
      onChange();
    } }));
    return h('fieldset', h('legend', s.label), top,
      h('div.table-wrap', h('table.data.static.mapping',
        h('thead', h('tr', h('th', 'Columna del archivo'), h('th', 'Ejemplos'), h('th', 'Es el dato'))),
        h('tbody', hd.map((name, i) => h('tr',
          h('td', h('b', name || '(sin nombre)')),
          h('td.samples', sample.map((r) => cellText(r[i])).filter(Boolean).join(' · ') || '—'),
          h('td', selects[i])))))));
  }

  function renderColumns() {
    const msg = h('p.hint');
    const next = h('button.btn.primary', { type: 'button', onclick: () => busy(next, review) }, 'Revisar renglones →');
    function check() {
      const problems = [];
      const used = state.sheets.filter((s) => s.kind !== IGNORE);
      if (!used.length) problems.push('elige al menos una hoja de nidos o de limpiezas');
      for (const kind of [NESTS, CLEANINGS]) {
        if (used.filter((s) => s.kind === kind).length > 1) problems.push('solo puede haber una hoja de ' + KIND_NAMES[kind].toLowerCase());
      }
      for (const s of used) {
        const miss = missingFields(s.kind, s.mapping);
        if (miss.length) problems.push(s.label + ': falta asignar ' + miss.join(' y '));
      }
      msg.textContent = problems.length ? problems.join(' · ') : '';
      next.disabled = problems.length > 0;
    }
    const hasNests = state.sheets.some((s) => s.kind === NESTS);
    const fmt = select([['auto', 'Detectar en cada renglón'], ...Coords.FORMATS], state.format, { onchange: (e) => { state.format = e.target.value; } });
    const mode = select([['actualizar', 'Actualizarlos (solo cambian las celdas que traen dato)'], ['omitir', 'Omitirlos (no se tocan)'], ['revisar', 'Elegir uno por uno en la vista previa']],
      state.mode, { onchange: (e) => { state.mode = e.target.value; } });

    put(
      h('div.list-head', h('h2', 'Hojas y columnas'), h('span.count', state.files.map((f) => f.name).join(' + ')), h('div.spacer'),
        h('button.btn.ghost.small', { type: 'button', onclick: renderStart }, '← Otros archivos')),
      state.sheets.map((s) => sheetBlock(s, check)),
      h('div.grid2',
        hasNests ? h('label.field', h('span.label', 'Formato de las coordenadas'), fmt,
          h('span.hint', 'Si el archivo tiene la columna «formato_coordenada», esa manda en cada renglón. UTM = zona ' + ((store.settings || {}).utm_zone || 16) + ' N.')) : null,
        h('label.field', h('span.label', 'Nidos o limpiezas que ya existen'), mode)),
      h('div.actions', msg, next));
    check();
  }

  async function review() {
    // Recordar la asignación (por nombre de columna y tipo de hoja) para la próxima carga.
    const used = state.sheets.filter((s) => s.kind !== IGNORE);
    let mem = { ...remembered() };
    for (const s of used) Object.assign(mem, mappingMemory(headersOf(s), s.mapping, s.kind));
    mem._formato = state.format;
    const keys = Object.keys(mem);
    if (keys.length > 300) mem = Object.fromEntries(keys.slice(keys.length - 300).map((k) => [k, mem[k]]));
    api.saveSettings({ import_mapping: mem }).then((d) => { store.settings = d.ajustes; }).catch(() => { /* no impide cargar */ });

    const st = store.settings || {};
    const byKey = new Map(store.nests().map((n) => [n.season + '|' + n.number, n]));
    const existing = (season, number) => byKey.get(season + '|' + number) || null;
    const body = (s) => [s.rows.slice(s.headerRow + 1), s.firstRow + s.headerRow + 1, s.mapping];
    const ns = used.find((s) => s.kind === NESTS), cs = used.find((s) => s.kind === CLEANINGS);
    state.nests = ns ? buildNestRows(...body(ns), { format: state.format, zone: st.utm_zone || 16, center: CENTER, beaches: st.beaches || [], existing }) : [];
    state.cleans = cs ? buildCleaningRows(...body(cs), { nestRows: state.nests, existing, cleaningOf: (u) => store.cleaningOf(u) }) : [];
    linkSheets(state.nests, state.cleans);
    if (!state.nests.length && !state.cleans.length) throw new Error('No hay renglones con datos debajo de los encabezados');
    for (const r of [...state.nests, ...state.cleans]) r.choice = r.existing ? (state.mode === 'revisar' ? 'omitir' : state.mode) : 'nuevo';
    state.tab = state.nests.length ? NESTS : CLEANINGS;
    state.filter = rowsOf().some((r) => r.errors.length) ? 'errores' : 'todos';
    state.shown = PAGE;
    renderPreview();
  }

  // ───────────────────────────── 3. vista previa

  const rowsOf = (tab = state.tab) => (tab === NESTS ? state.nests : state.cleans);

  function counts(rows) {
    const c = { todos: rows.length, nuevos: 0, existentes: 0, errores: 0, avisos: 0, actualizar: 0, omitir: 0 };
    for (const r of rows) {
      if (r.errors.length) { c.errores++; continue; }
      if (r.warns.length) c.avisos++;
      if (r.existing) { c.existentes++; c[r.choice]++; } else c.nuevos++;
    }
    c.cargar = c.nuevos + c.actualizar;
    return c;
  }

  const FILTERS = [['todos', 'Todos'], ['errores', 'Con error'], ['avisos', 'Con aviso'], ['nuevos', 'Nuevos'], ['existentes', 'Ya existen']];
  const passes = (r, f = state.filter) => ({
    todos: true, errores: r.errors.length > 0, avisos: !r.errors.length && r.warns.length > 0,
    nuevos: !r.errors.length && !r.existing, existentes: !r.errors.length && !!r.existing,
  })[f];

  const stat = (n, label, kind) => h('div.stat' + (kind ? '.' + kind : ''), h('b', String(n)), h('span', label));

  function summary(title, c, noun) {
    return h('div.summary', h('span.summary-title', title),
      stat(c.nuevos, noun, 'ok'), stat(c.actualizar, 'se actualizan', 'upd'), stat(c.omitir, 'se omiten', ''),
      stat(c.errores, 'con error (no se cargan)', c.errores ? 'err' : ''), stat(c.avisos, 'con aviso', c.avisos ? 'warn' : ''));
  }

  function result(r) {
    if (r.errors.length) return h('span.badge.err', 'Error');
    if (!r.existing) return h('span.badge.ok', state.tab === NESTS ? 'Nuevo' : 'Nueva');
    return select([['actualizar', 'Existe · actualizar'], ['omitir', 'Existe · omitir']], r.choice,
      { onchange: (e) => { r.choice = e.target.value; renderPreview(); } });
  }

  const msgs = (r) => h('td.msgs', r.errors.map((m) => h('div.err', '✗ ' + m)), r.warns.map((m) => h('div.warn-msg', '⚠ ' + m)));
  const rowClass = (r) => 'tr' + (r.errors.length ? '.bad' : r.warns.length ? '.warned' : '');

  function nestTable(list) {
    const zone = (store.settings || {}).utm_zone || 16;
    return h('table.data.static.preview',
      h('thead', h('tr', ['Renglón', 'Resultado', 'Nº', 'Temp.', 'Detección', 'Especie', 'Estado', 'Playa', 'Coordenada', 'Detalle'].map((t) => h('th', t)))),
      h('tbody', list.map((r) => h(rowClass(r),
        h('td', String(r.renglon)), h('td', result(r)),
        h('td', r.nest.number || '—'), h('td', r.season ? String(r.season) : '—'), h('td', showDate(r.nest.detected_date)),
        h('td', r.nest.species ? h('i', speciesName(r.nest.species)) : '—'),
        h('td', r.fijar_estado ? (r.nest.status_override ? statusName(r.nest.status_override) : statusName(r.statusAuto)) : '—'),
        h('td', r.nest.beach || '—'),
        h('td.mono', r.nest.real_lat != null ? Coords.format(r.nest.real_lat, r.nest.real_lon, Coords.DECIMAL, zone) : '—'),
        msgs(r)))));
  }

  function cleaningTable(list) {
    const num = (v) => (v == null ? '—' : String(v));
    return h('table.data.static.preview',
      h('thead', h('tr', ['Renglón', 'Resultado', 'Temp.', 'Nido', 'Su nido', 'Limpieza', 'Cascarones', 'Vivas', 'Muertas', 'Rosa', 'Fase', 'Detalle'].map((t) => h('th', t)))),
      h('tbody', list.map((r) => h(rowClass(r),
        h('td', String(r.renglon)), h('td', result(r)),
        h('td', num(r.season)), h('td', r.number || '—'),
        h('td', r.nest ? 'ya registrado' : r.nestRow && !r.nestRow.errors.length ? 'hoja de nidos (renglón ' + r.nestRow.renglon + ')' : '—'),
        h('td', showDate(r.cleaning.clean_date)),
        h('td', num(r.cleaning.shells)), h('td', num(r.cleaning.alive)), h('td', num(r.cleaning.dead)), h('td', num(r.cleaning.pink)),
        h('td', r.cleaning.phase_mode === 'detalle' ? r.cleaning.phase_total + ' (' + [r.cleaning.phase1, r.cleaning.phase2, r.cleaning.phase3].map(num).join('/') + ')' : num(r.cleaning.phase_total)),
        msgs(r)))));
  }

  function renderPreview() {
    const cn = counts(state.nests), cc = counts(state.cleans);
    const rows = rowsOf();
    const list = rows.filter((r) => passes(r));
    const c = state.tab === NESTS ? cn : cc;
    const total = cn.cargar + cc.cargar;
    const label = [cn.cargar ? cn.cargar + ' nido(s)' : null, cc.cargar ? cc.cargar + ' limpieza(s)' : null].filter(Boolean).join(' y ');
    const loadBtn = h('button.btn.primary', { type: 'button', disabled: total === 0, onclick: () => upload() }, total ? 'Cargar ' + label : 'Nada que cargar');
    const setAll = (choice) => { for (const r of rows) if (r.existing) r.choice = choice; renderPreview(); };
    const bulk = c.existentes ? h('div.row-btns', h('span.hint', c.existentes + ' ya existen:'),
      h('button.btn.ghost.small', { type: 'button', onclick: () => setAll('actualizar') }, 'Actualizar todos'),
      h('button.btn.ghost.small', { type: 'button', onclick: () => setAll('omitir') }, 'Omitir todos')) : null;
    const tabs = [[NESTS, 'Nidos', state.nests.length], [CLEANINGS, 'Limpiezas', state.cleans.length]].filter((t) => t[2]);

    put(
      h('div.list-head', h('h2', 'Vista previa'), h('span.count', state.files.map((f) => f.name).join(' + ')), h('div.spacer'),
        h('button.btn.ghost.small', { type: 'button', onclick: renderColumns }, '← Columnas')),
      state.nests.length ? summary('Nidos', cn, 'nuevos') : null,
      state.cleans.length ? summary('Limpiezas', cc, 'nuevas') : null,
      tabs.length > 1 ? h('div.sheet-tabs', tabs.map(([id, name, n]) => h('button.sheet-tab' + (state.tab === id ? '.on' : ''), { type: 'button',
        onclick: () => { state.tab = id; state.filter = 'todos'; state.shown = PAGE; renderPreview(); } }, name + ' (' + n + ')'))) : null,
      h('div.filters', FILTERS.map(([id, name]) => h('button.chip-btn' + (state.filter === id ? '.on' : ''), { type: 'button',
        onclick: () => { state.filter = id; state.shown = PAGE; renderPreview(); } }, name + ' (' + rows.filter((r) => passes(r, id)).length + ')')),
      h('div.spacer'), bulk),
      list.length ? h('div.table-wrap', (state.tab === NESTS ? nestTable : cleaningTable)(list.slice(0, state.shown))) : h('p.empty', 'Ningún renglón en este filtro.'),
      list.length > state.shown ? h('div.row-btns', h('button.btn.ghost.small', { type: 'button', onclick: () => { state.shown += PAGE; renderPreview(); } },
        'Mostrar ' + Math.min(PAGE, list.length - state.shown) + ' más (de ' + (list.length - state.shown) + ')')) : null,
      h('div.actions', cn.errores + cc.errores ? h('span.hint', 'Los renglones con error no se cargan: corrígelos en el archivo y vuelve a subirlo, o carga solo los demás.') : null, loadBtn));
  }

  // ───────────────────────────── 4. cargar

  async function upload() {
    const cn = counts(state.nests), cc = counts(state.cleans);
    const what = [
      cn.nuevos ? cn.nuevos + ' nido(s) nuevo(s)' : null, cn.actualizar ? cn.actualizar + ' nido(s) actualizado(s)' : null,
      cc.nuevos ? cc.nuevos + ' limpieza(s) nueva(s)' : null, cc.actualizar ? cc.actualizar + ' limpieza(s) actualizada(s)' : null,
    ].filter(Boolean);
    const errs = cn.errores + cc.errores;
    const ok = await confirmBox('Cargar al sistema', 'Se cargarán ' + what.join(', ')
      + (errs ? '. Los ' + errs + ' renglones con error se quedan fuera' : '')
      + '. La carga queda en el historial y se puede deshacer completa.', 'Cargar');
    if (!ok) return;

    // Primero los nidos y después las limpiezas, que se enlazan con ellos. Los omitidos también van:
    // quedan contados en el historial.
    const jobs = [];
    const nests = state.nests.filter((r) => !r.errors.length);
    const cleans = state.cleans.filter((r) => !r.errors.length);
    for (let i = 0; i < nests.length; i += PART) jobs.push({ filas: nests.slice(i, i + PART).map((r) => toPayload(r, r.existing ? r.choice : 'actualizar')) });
    for (let i = 0; i < cleans.length; i += PART) jobs.push({ limpiezas: cleans.slice(i, i + PART).map((r) => toCleaningPayload(r, r.existing ? r.choice : 'actualizar')) });
    const id = crypto.randomUUID();
    const archivo = state.files.map((f) => f.name).join(' + ');
    const total = { creados: 0, actualizados: 0, omitidos: 0, ya_cargados: 0, limpiezas: 0, limpiezas_omitidas: 0, rechazados: [] };
    const progress = h('p.lead', 'Preparando…');
    put(h('div.list-head', h('h2', 'Cargando…')), progress);
    let failed = null;
    for (let i = 0; i < jobs.length && !failed; i++) {
      progress.textContent = 'Parte ' + (i + 1) + ' de ' + jobs.length + (jobs[i].filas ? ' (nidos)…' : ' (limpiezas)…');
      let d = null;
      for (let attempt = 0; attempt < 3 && !d; attempt++) {
        try {
          d = await api.importPart({ id, archivo, ...jobs[i] });
        } catch (e) {
          // Sin conexión: se reintenta la misma parte (el servidor no la duplica).
          if (e.status !== 0 || attempt === 2) { failed = e; break; }
          await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
      }
      if (!d) break;
      for (const k of ['creados', 'actualizados', 'omitidos', 'ya_cargados', 'limpiezas', 'limpiezas_omitidas']) total[k] += d[k] || 0;
      total.rechazados.push(...(d.rechazados || []));
    }
    try { await store.sync(user.id); } catch { /* se actualiza en la siguiente sincronización */ }
    showResult(total, failed, archivo);
  }

  function showResult(t, failed, archivo) {
    state.sheets = null;   // al volver a la sección empieza de nuevo
    put(
      h('div.list-head', h('h2', failed ? 'La carga se interrumpió' : 'Carga terminada'), h('span.count', archivo)),
      failed ? h('p.error', failed.message + '. Lo que alcanzó a cargarse quedó en el historial: puedes deshacerlo o volver a subir los archivos (lo ya cargado aparecerá como «ya existe»).') : null,
      h('div.summary',
        stat(t.creados, 'nidos nuevos', 'ok'), stat(t.actualizados, 'nidos actualizados', 'upd'), stat(t.omitidos, 'nidos omitidos', ''),
        stat(t.limpiezas, 'limpiezas', 'ok'), stat(t.limpiezas_omitidas, 'limpiezas omitidas', ''),
        stat(t.rechazados.length, 'rechazados por el servidor', t.rechazados.length ? 'err' : '')),
      t.rechazados.length ? h('div.table-wrap', h('table.data.static',
        h('thead', h('tr', h('th', 'Hoja'), h('th', 'Renglón'), h('th', 'Motivo'))),
        h('tbody', t.rechazados.slice(0, 300).map((x) => h('tr', h('td', KIND_NAMES[x.hoja] || x.hoja || '—'), h('td', String(x.renglon ?? '—')), h('td', x.razon)))))) : null,
      h('div.actions',
        h('button.btn.ghost', { type: 'button', onclick: () => { location.hash = '#nidos'; } }, 'Ver los nidos'),
        h('button.btn.primary', { type: 'button', onclick: renderStart }, 'Listo')));
  }

  return { el, show() { if (!state.sheets) renderStart(); } };
}
