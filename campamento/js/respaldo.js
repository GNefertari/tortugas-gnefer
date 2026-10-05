// Coordinador: respaldo del campamento en un .zip y restauración desde ese .zip.
//
// El .zip lleva:
//   respaldo.json      todas las filas elegidas (vuelos, nidos, fotos de dron, limpiezas, máscaras, fotos de campo)
//   nidos.csv          los nidos para Excel (igual que «Exportar»)
//   limpiezas.csv      las limpiezas para Excel
//   fotos_campo/       las fotos de la cámara (opcional)
// No lleva los recortes ni las copias de 1280 px de las fotos de dron: salen de los originales, que solo
// se guardan una vez, en el conjunto de datos de la PC (servidor.bat los vuelve a generar si faltan).
//
// Restaurar nunca borra nada: vuelve a crear lo que falta o se borró y, si se pide, regresa a la
// versión del respaldo lo que cambió después. Todo pasa por sync/push, con las mismas reglas que la app.

import { SPECIES } from './catalog.js';
import { cleaningsCsv, nestsCsv } from './exportar.js';
import { busy, clear, confirmBox, field, h, select, showDateTime, todayIso, toast } from './ui.js';

const ZIP_URL = 'https://unpkg.com/fflate@0.8.2/esm/browser.js';
const FORMAT = 'tortugas-respaldo';
const VERSION = 1;
const ORDER = ['flight', 'nest', 'aerial', 'cleaning', 'mask', 'photo'];
const TABLE_NAMES = { flight: 'Vuelos', nest: 'Nidos', aerial: 'Fotos de dron', cleaning: 'Limpiezas', mask: 'Máscaras', photo: 'Fotos de campo' };
const PUSH_ROWS = 400;

let zipPromise = null;
function zipLib() {
  if (!zipPromise) {
    zipPromise = import(ZIP_URL).catch(() => {
      zipPromise = null;
      throw new Error('No se pudo cargar el programa para .zip (revisa tu internet).');
    });
  }
  return zipPromise;
}

const human = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b ? Math.max(1, Math.round(b / 1024)) + ' KB' : '0 KB');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function respaldoView(ctx) {
  const el = h('section.view.list-view.respaldo');
  const f = { seasons: new Set(), beaches: new Set(), species: new Set(), from: '', to: '', photos: true };

  function render() {
    clear(el).append(
      h('div.list-head', h('h2', 'Respaldo de ' + ctx.campName)),
      h('p.lead', 'Descarga un .zip con los datos del campamento para guardarlo en un disco externo o en la nube. '
        + 'Los recortes y las fotos de dron reducidas no van en el .zip: salen de los originales del conjunto de datos de la PC.'),
      createPanel(),
      restorePanel());
  }

  // ───────────────────────────── crear

  /** Lo que entra en el respaldo según los filtros (sin filtros = todo el campamento). */
  function selection() {
    const { store } = ctx;
    const full = !f.seasons.size && !f.beaches.size && !f.species.size && !f.from && !f.to;
    const live = (t) => store.all(t).filter((r) => !r.deleted);
    const nests = live('nest').filter((n) => (!f.seasons.size || f.seasons.has(String(n.season ?? '')))
      && (!f.beaches.size || f.beaches.has(n.beach || ''))
      && (!f.species.size || f.species.has(n.species || ''))
      && (!f.from || (n.detected_date && n.detected_date >= f.from))
      && (!f.to || (n.detected_date && n.detected_date <= f.to)));
    const ids = new Set(nests.map((n) => n.uuid));
    const cleanings = live('cleaning').filter((k) => ids.has(k.nest_uuid));
    const photos = live('photo').filter((p) => ids.has(p.nest_uuid));
    const masks = full ? live('mask') : live('mask').filter((m) => ids.has(m.nest_uuid));
    const aerialIds = new Set(masks.map((m) => m.aerial_uuid));
    const aerials = full ? live('aerial') : live('aerial').filter((a) => aerialIds.has(a.uuid));
    const flightIds = new Set(aerials.map((a) => a.flight_uuid));
    const flights = full ? live('flight') : live('flight').filter((v) => flightIds.has(v.uuid));
    return { full, rows: { flight: flights, nest: nests, aerial: aerials, cleaning: cleanings, mask: masks, photo: photos } };
  }

  function checks(options, set, onChange) {
    return h('div.checks', options.map(([value, label]) => h('label.check',
      h('input', { type: 'checkbox', checked: set.has(value), onchange: (e) => {
        if (e.target.checked) set.add(value); else set.delete(value);
        onChange();
      } }), label)));
  }

  function createPanel() {
    const { store } = ctx;
    const summary = h('div.summary');
    const update = () => {
      const s = selection();
      const withImg = s.rows.photo.filter((p) => p.file_size);
      const bytes = withImg.reduce((t, p) => t + (p.file_size || 0), 0);
      clear(summary).append(
        ...ORDER.map((t) => h('div.stat', h('b', String(s.rows[t].length)), h('span', TABLE_NAMES[t]))),
        h('div.stat', h('b', f.photos ? human(bytes) : '—'), h('span', f.photos ? plural(withImg.length, 'imagen de campo', 'imágenes de campo') : 'sin imágenes')));
    };
    const seasons = store.seasons().map((x) => [String(x), String(x)]);
    const beaches = [...new Set([...(store.settings?.beaches || []), ...store.beachesInUse()])].map((b) => [b, b]);
    const from = h('input', { type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; update(); } });
    const to = h('input', { type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; update(); } });
    const status = h('span.hint');
    const btn = h('button.btn.primary', { type: 'button', onclick: () => busy(btn, () => create(status)) }, 'Descargar respaldo (.zip)');
    update();
    return h('fieldset', h('legend', 'Crear respaldo'),
      h('p.hint', 'Sin filtros se respalda todo el campamento (también los vuelos y las propuestas sin revisar). '
        + 'Con filtros, solo los nidos elegidos con sus limpiezas, fotos y máscaras.'),
      seasons.length ? field('Temporadas', checks(seasons, f.seasons, update)) : null,
      beaches.length ? field('Playas', checks(beaches, f.beaches, update)) : null,
      field('Especie', checks([...SPECIES.map((s) => [s[0], s[1]]), ['', 'Sin especie']], f.species, update)),
      h('div.grid2', field('Detectados desde', from), field('Hasta', to)),
      h('label.check', h('input', { type: 'checkbox', checked: f.photos, onchange: (e) => { f.photos = e.target.checked; update(); } }),
        'Incluir las fotos de campo (las de la cámara de la tableta o el celular)'),
      summary,
      h('div.actions', status, btn));
  }

  async function create(status) {
    status.textContent = 'Actualizando datos…';
    try {
      await build(status);
    } finally {
      status.textContent = '';
    }
  }

  async function build(status) {
    const { store, api, user } = ctx;
    await store.sync(user.id);
    const s = selection();
    if (!s.rows.nest.length && !s.rows.flight.length) throw new Error('No hay nada que respaldar con esos filtros.');
    const { zipSync, strToU8 } = await zipLib();
    const files = {};
    const missing = [];
    if (f.photos) {
      const list = s.rows.photo.filter((p) => p.file_size);
      for (let i = 0; i < list.length; i++) {
        status.textContent = 'Bajando fotos de campo: ' + (i + 1) + ' de ' + list.length + '…';
        const blob = await api.imageBlob('photo', list[i].uuid);
        if (blob) files['fotos_campo/' + list[i].uuid + '.jpg'] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
        else missing.push(list[i].uuid);
      }
    }
    const filters = s.full ? null : { temporadas: [...f.seasons], playas: [...f.beaches], especies: [...f.species], desde: f.from || null, hasta: f.to || null };
    const data = { formato: FORMAT, version: VERSION, campamento: ctx.slug, nombre_campamento: ctx.campName,
      creado: new Date().toISOString(), creado_por: user.nombre, completo: s.full, filtros: filters,
      con_fotos_campo: f.photos, ajustes: store.settings, filas: s.rows };
    const nestOf = (k) => store.row('nest', k.nest_uuid);
    files['respaldo.json'] = strToU8(JSON.stringify(data));
    files['nidos.csv'] = strToU8(nestsCsv(ctx, s.rows.nest));
    files['limpiezas.csv'] = strToU8(cleaningsCsv(s.rows.cleaning.map((k) => ({ k, n: nestOf(k) }))));
    files['LEEME.txt'] = strToU8(readme(data, s));
    status.textContent = 'Armando el .zip…';
    await new Promise((r) => setTimeout(r, 30));   // que se vea el aviso antes de armarlo
    const zip = zipSync(files, { level: 6 });
    const name = 'respaldo_' + ctx.slug + '_' + todayIso() + (s.full ? '' : '_filtrado') + '.zip';
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Respaldo listo: ' + name + ' (' + human(zip.length) + ')' + (missing.length ? '. ' + missing.length + ' foto(s) de campo no estaban en la nube.' : ''));
  }

  function readme(data, s) {
    const r = data.filtros;
    return [
      'Respaldo de ' + ctx.campName + ' — ' + data.creado + ' (' + data.creado_por + ')',
      s.full ? 'Contenido: todo el campamento.' : 'Contenido filtrado: temporadas ' + (r.temporadas.join(', ') || 'todas')
        + '; playas ' + (r.playas.join(', ') || 'todas') + '; especies ' + (r.especies.map((x) => x || 'sin especie').join(', ') || 'todas')
        + '; detectados ' + (r.desde || 'desde el inicio') + ' a ' + (r.hasta || 'hoy') + '.',
      '',
      ...ORDER.map((t) => TABLE_NAMES[t] + ': ' + s.rows[t].length),
      '',
      'nidos.csv y limpiezas.csv se abren en Excel (y se pueden volver a cargar con «Cargar Excel»).',
      'respaldo.json tiene todo para restaurar: en la web, Respaldo > Restaurar (solo coordinador).',
      'fotos_campo/: las fotos de la cámara, con el uuid de su fila como nombre.',
      'Los recortes y las fotos de dron reducidas salen de los originales del conjunto de datos de la PC',
      '(C:\\GNeST\\dataset): respáldalo junto con este archivo.',
      '',
    ].join('\r\n');
  }

  // ───────────────────────────── restaurar

  function restorePanel() {
    const box = h('div');
    const input = h('input', { type: 'file', accept: '.zip', onchange: () => input.files[0] && busy(pick, () => open(input.files[0], box)) });
    const pick = h('button.btn', { type: 'button', onclick: () => input.click() }, 'Elegir respaldo (.zip)…');
    return h('fieldset', h('legend', 'Restaurar desde un respaldo'),
      h('p.hint', 'Primero se muestra qué hay en el respaldo comparado con lo que hay ahora; nada cambia hasta que confirmes. '
        + 'Restaurar no borra nada de lo que se agregó después del respaldo.'),
      h('div.row-btns', pick), input, box);
  }

  async function open(file, box) {
    const { store, user } = ctx;
    const { unzipSync, strFromU8 } = await zipLib();
    let files, data;
    try {
      files = unzipSync(new Uint8Array(await file.arrayBuffer()));
      data = JSON.parse(strFromU8(files['respaldo.json']));
    } catch {
      throw new Error('Ese archivo no es un respaldo de esta página (falta respaldo.json).');
    }
    if (data.formato !== FORMAT || !data.filas) throw new Error('Ese archivo no es un respaldo de esta página.');
    if (data.version > VERSION) throw new Error('El respaldo es de una versión más nueva de la página; recarga con Ctrl + Shift + R.');
    if (data.campamento !== ctx.slug) {
      throw new Error('Ese respaldo es de ' + (data.nombre_campamento || data.campamento) + '; ábrelo en la página de ese campamento.');
    }
    await store.sync(user.id);
    const plan = analyze(data);
    showPlan(box, file.name, data, files, plan);
  }

  /** Cada fila del respaldo comparada con la copia actual: falta, borrada, cambió después o igual. */
  function analyze(data) {
    const plan = {};
    for (const t of ORDER) {
      plan[t] = { falta: [], borrado: [], cambiado: [], igual: [] };
      for (const r of data.filas[t] || []) {
        const ex = ctx.store.row(t, r.uuid);
        const k = !ex ? 'falta' : ex.deleted ? 'borrado' : sameData(r, ex) ? 'igual' : 'cambiado';
        plan[t][k].push(r);
      }
    }
    return plan;
  }

  function showPlan(box, name, data, files, plan) {
    const mode = select([
      ['faltantes', 'Recuperar solo lo que falta o se borró (no toca lo que existe ahora)'],
      ['todo', 'Además, regresar a la versión del respaldo lo que cambió después'],
    ], 'faltantes');
    const nPhotos = Object.keys(files).filter((k) => k.startsWith('fotos_campo/')).length;
    const cell = (v) => h('td', v ? String(v) : '—');
    const btn = h('button.btn.primary', { type: 'button', onclick: () => busy(btn, () => run(box, data, files, plan, mode.value)) }, 'Restaurar');
    clear(box).append(
      h('p', h('b', name), ' — creado el ' + showDateTime(data.creado) + ' por ' + (data.creado_por || '¿?')
        + (data.completo ? ' · todo el campamento' : ' · filtrado') + ' · ' + plural(nPhotos, 'foto de campo', 'fotos de campo')),
      h('div.table-wrap', h('table.data.static',
        h('thead', h('tr', ['', 'En el respaldo', 'Faltan ahora', 'Se borraron', 'Cambiaron después', 'Iguales'].map((x) => h('th', x)))),
        h('tbody', ORDER.map((t) => {
          const p = plan[t];
          return h('tr', h('td', TABLE_NAMES[t]), cell((data.filas[t] || []).length), cell(p.falta.length), cell(p.borrado.length),
            cell(p.cambiado.length), cell(p.igual.length));
        })))),
      field('Qué hacer', mode, 'Lo que se agregó después del respaldo se queda como está. Un nido cuyo número ya usa otro nido no se restaura (se avisa).'),
      h('div.actions', btn));
  }

  async function run(box, data, files, plan, mode) {
    const { store, api, user } = ctx;
    const pick = (t) => [...plan[t].falta, ...plan[t].borrado, ...(mode === 'todo' ? plan[t].cambiado : [])];
    const total = ORDER.reduce((s, t) => s + pick(t).length, 0);
    const photoFiles = Object.keys(files).filter((k) => k.startsWith('fotos_campo/'));
    if (!total && !photoFiles.length) throw new Error('No hay nada que restaurar: todo está igual que en el respaldo.');
    if (!(await confirmBox('Restaurar', 'Se van a restaurar ' + plural(total, 'registro', 'registros')
      + '. Los equipos lo reciben en su siguiente sincronización.', 'Restaurar'))) return;

    const bar = h('i');
    const msg = h('p.lead', 'Restaurando…');
    clear(box).append(msg, h('div.progress', bar));
    const stamp = new Date().toISOString();
    const done = Object.fromEntries(ORDER.map((t) => [t, 0]));
    const problems = [];
    const rejected = new Set();
    let sent = 0;
    const liveNow = (t, uuid) => { const r = store.row(t, uuid); return r && !r.deleted; };
    const restored = Object.fromEntries(ORDER.map((t) => [t, new Set()]));
    const nestLabel = (uuid) => {
      const n = (data.filas.nest || []).find((x) => x.uuid === uuid) || store.row('nest', uuid);
      return n ? 'nido ' + n.number + (n.season ? ' (' + n.season + ')' : '') : 'un nido';
    };

    for (const t of ORDER) {
      let rows = pick(t);
      // Hijos de un nido o foto que no quedó vigente: no se pueden restaurar.
      const parentOk = (tab, uuid) => uuid && !rejected.has(uuid) && (restored[tab].has(uuid) || liveNow(tab, uuid));
      if (t === 'cleaning' || t === 'photo') rows = rows.filter((r) => parentOk('nest', r.nest_uuid) || skip(t, r, 'el nido no está vigente'));
      if (t === 'mask') rows = rows.filter((r) => parentOk('aerial', r.aerial_uuid) || skip(t, r, 'su foto de dron no está vigente'));
      if (t === 'cleaning' && mode === 'faltantes') {
        // Una sola limpieza por nido: si el nido ya tiene otra, se respeta la de ahora.
        const other = new Set(store.all('cleaning').filter((k) => !k.deleted).map((k) => k.nest_uuid));
        rows = rows.filter((r) => !other.has(r.nest_uuid) || skip(t, r, 'el nido ya tiene otra limpieza'));
      }
      for (let i = 0; i < rows.length; i += PUSH_ROWS) {
        const chunk = rows.slice(i, i + PUSH_ROWS).map((r) => prepare(t, r, stamp));
        msg.textContent = 'Restaurando ' + TABLE_NAMES[t].toLowerCase() + '…';
        const res = await api.push({ [t]: chunk });
        const bad = new Set(res.rechazados.map((x) => x.uuid));
        for (const x of res.rechazados) {
          rejected.add(x.uuid);
          problems.push((t === 'nest' ? nestLabel(x.uuid) : TABLE_NAMES[t] + ' ' + String(x.uuid).slice(0, 8)) + ': ' + x.razon);
        }
        for (const r of chunk) if (!bad.has(r.uuid)) { restored[t].add(r.uuid); done[t]++; }
        sent += chunk.length;
        bar.style.width = Math.round((sent / Math.max(1, total)) * 80) + '%';
      }
    }

    function skip(t, r, why) {
      const what = t === 'cleaning' ? 'Limpieza del ' + nestLabel(r.nest_uuid) : t === 'photo' ? 'Foto de campo del ' + nestLabel(r.nest_uuid)
        : TABLE_NAMES[t] + ' ' + String(r.uuid).slice(0, 8);
      problems.push(what + ': no se restauró porque ' + why);
      return false;
    }

    // Hora de los vuelos (no viaja por sync/push).
    for (const v of data.filas.flight || []) {
      if (restored.flight.has(v.uuid) && v.flight_time) {
        try { await api.setFlightTime(v.uuid, v.flight_time); } catch { /* el vuelo queda sin hora */ }
      }
    }

    // Fotos de campo: las restauradas y las que no tienen imagen en la nube.
    msg.textContent = 'Revisando las imágenes…';
    await store.sync(user.id);
    const toUpload = photoFiles.map((k) => k.slice('fotos_campo/'.length, -4))
      .filter((id) => liveNow('photo', id) && (restored.photo.has(id) || !store.row('photo', id).file_size));
    let uploaded = 0;
    for (let i = 0; i < toUpload.length; i++) {
      msg.textContent = 'Subiendo fotos de campo: ' + (i + 1) + ' de ' + toUpload.length;
      try {
        await api.putImage('photo', toUpload[i], files['fotos_campo/' + toUpload[i] + '.jpg']);
        uploaded++;
      } catch (e) {
        problems.push('Foto de campo ' + toUpload[i].slice(0, 8) + ': ' + e.message);
      }
      bar.style.width = (80 + Math.round(((i + 1) / toUpload.length) * 20)) + '%';
    }
    bar.style.width = '100%';
    await store.sync(user.id);

    // Recortes y fotos de dron que siguen sin imagen: los rehace la PC desde los originales.
    const live = (t) => store.all(t).filter((r) => !r.deleted);
    const liveNests = new Set(live('nest').map((n) => n.uuid));
    const needCrop = live('mask').filter((m) => restored.mask.has(m.uuid) && liveNests.has(m.nest_uuid) && m.status !== 'descartada' && !m.crop_size).length;
    const withNest = new Set(live('mask').filter((m) => liveNests.has(m.nest_uuid) && m.status !== 'descartada').map((m) => m.aerial_uuid));
    const needAerial = live('aerial').filter((a) => restored.aerial.has(a.uuid) && withNest.has(a.uuid) && !a.file_size).length;

    // (Element.append escribiría «null»: se filtran los avisos que no aplican.)
    clear(box).append(...[
      h('div.summary', h('span.summary-title', 'Restaurado'), ...ORDER.map((t) => h('div.stat.ok', h('b', String(done[t])), h('span', TABLE_NAMES[t]))),
        h('div.stat.ok', h('b', String(uploaded)), h('span', 'imágenes de campo subidas'))),
      needCrop || needAerial ? h('div.notice.warn', plural(needCrop, 'recorte', 'recortes') + ' y ' + plural(needAerial, 'foto de dron', 'fotos de dron')
        + ' quedaron sin imagen en la nube. servidor.bat los vuelve a generar desde los originales del conjunto de datos en su siguiente pasada '
        + '(si el vuelo ya no está en la PC, búscalo en C:\\GNeST\\papelera y usa --asociar).') : null,
      problems.length ? h('div.notice.err', h('b', plural(problems.length, 'aviso', 'avisos') + ':'), h('ul', problems.slice(0, 50).map((p) => h('li', p))),
        problems.length > 50 ? h('p', '… y ' + (problems.length - 50) + ' más.') : null) : null,
    ].filter(Boolean));
    toast('Restauración terminada');
  }

  return { el, show: render };
}

// Columnas que no cuentan al comparar: fechas y quién del último cambio, y lo que lleva el servidor
// (imágenes, bandeja temporal, respaldo de la PC, bloqueo de ValiNest).
const NOT_DATA = new Set(['updated_at', 'created_at', 'rev', 'user_id', 'device_id', 'deleted', 'file_size', 'crop_size',
  'reviewed_at', 'cleaned_at', 'inbox_expires_at', 'inbox_deleted_at', 'backup_at', 'backup_rev', 'originals_requested_at',
  'originals_ready_at', 'app_device', 'app_by', 'app_user', 'app_since', 'app_from']);

/** ¿La fila de ahora tiene los mismos datos que la del respaldo? */
function sameData(backup, now) {
  return Object.keys(backup).every((k) => NOT_DATA.has(k) || JSON.stringify(backup[k] ?? null) === JSON.stringify(now[k] ?? null));
}

/** La fila del respaldo lista para sync/push: vigente y con fecha nueva (para que gane sobre la actual). */
function prepare(t, r, stamp) {
  const row = { ...r, deleted: 0, updated_at: stamp };
  if (t === 'flight' && row.review_status === 'en_app') row.review_status = row.app_from === 'revisado' ? 'revisado' : 'pendiente';
  return row;
}
