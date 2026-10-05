// Registrar y editar nidos y limpiezas, con las mismas reglas que la app:
//   - número de nido único por temporada (temporada = año de la fecha de detección);
//   - eclosión estimada = detección + días de incubación de la especie (ajustes del campamento);
//     el experto puede fijarla o dejarla vacía;
//   - salvaje: la eclosión es la misma fecha que la de registro; la acción 8 propone "salvaje";
//   - solo experto o coordinador fijan estado (depredado, salvaje, reubicado) y borran;
//   - una limpieza por nido; la fase se captura como total o por fase según el campamento.

import { ACTION_WILD, can, MASK_COLS, SPECIES, STATUS_MANUAL, statusName } from './catalog.js';
import { distance } from './geo.js';
import * as Coords from './coords.js';
import { coordFormat } from './prefs.js';
import { addDays, busy, byNumber, confirmBox, field, h, modal, nowUtc, select, showDate, toast, todayIso } from './ui.js';

export const NEST_COLS = ['number', 'detected_date', 'species', 'status_override', 'beach', 'zone', 'action', 'real_lat', 'real_lon',
  'real_source', 'real_acc', 'photo_lat', 'photo_lon', 'hatch_date', 'hatch_manual', 'turtle_lt', 'turtle_lc', 'turtle_ac',
  'turtle_notes', 'camp', 'observer', 'notes', 'origin'];
const CLEANING_COLS = ['nest_uuid', 'clean_date', 'shells', 'alive', 'dead', 'pink', 'phase_mode', 'phase_total',
  'phase1', 'phase2', 'phase3', 'notes', 'camp', 'observer'];

function pick(row, cols) {
  const o = { uuid: row.uuid, created_at: row.created_at, deleted: row.deleted || 0 };
  for (const c of cols) o[c] = row[c] ?? null;
  return o;
}

/** Sube una fila y explica el resultado. Devuelve true si se guardó. */
async function saveRow(ctx, table, row) {
  row.updated_at = nowUtc();
  if (!row.created_at) row.created_at = row.updated_at;
  const res = await ctx.store.save({ [table]: [row] }, ctx.user.id);
  if (res.rechazados && res.rechazados.length) throw new Error('No se guardó: ' + res.rechazados[0].razon);
  if (res.ignorados && res.ignorados.length) throw new Error('No se guardó: alguien más lo cambió después. Recarga y vuelve a intentarlo.');
  return true;
}

const num = (input, int) => {
  const v = input.value.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) throw new Error('"' + input.value + '" no es un número' + (int ? ' entero' : ''));
  return n;
};

// ───────────────────────────── nido

export function nestForm(ctx, uuid) {
  const { store, user } = ctx;
  const s = store.settings || {};
  const zone = s.utm_zone || 16;
  const old = uuid ? store.nest(uuid) : null;
  const n = old ? { ...old } : { uuid: crypto.randomUUID(), detected_date: todayIso(), origin: 'web', camp: ctx.campName, observer: user.nombre, hatch_manual: 0 };
  const expert = can(user, 'experto');

  const number = h('input', { value: n.number || '', required: true, autocomplete: 'off' });
  const date = h('input', { type: 'date', value: n.detected_date || '', required: true });
  const species = select([['', '(sin especie)'], ...SPECIES.map((x) => [x[0], x[1] + ' — ' + x[2]])], n.species);
  const override = select([['', 'Automático (activo / eclosionado)'], ...STATUS_MANUAL.map((c) => [c, statusName(c)])], n.status_override, { disabled: !expert });
  const beaches = [...new Set([...(s.beaches || []), ...(n.beach ? [n.beach] : [])])];
  const beach = select([['', '(sin playa)'], ...beaches], n.beach);
  const zoneSel = select([['', '—'], '1', '2', '3'], n.zone);
  const action = select([['', '—'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, String(i)])], n.action);
  const statusInfo = h('span.hint');

  // Coordenada real
  let fmt = coordFormat();   // el elegido en Mi cuenta; cambiarlo aquí no cambia la preferencia
  const fmtSel = select(Coords.FORMATS, fmt);
  const ca = h('input', { autocomplete: 'off' }), cb = h('input', { autocomplete: 'off' });
  const caLabel = h('span.label'), cbLabel = h('span.label');
  const coordInfo = h('span.hint');
  function showCoordInputs() {
    const names = Coords.fieldNames(fmt), hints = Coords.hints(fmt);
    caLabel.textContent = names[0];
    cbLabel.textContent = names[1];
    ca.placeholder = hints[0];
    cb.placeholder = hints[1];
    if (n.real_lat != null) [ca.value, cb.value] = Coords.format2(n.real_lat, n.real_lon, fmt, zone);
    coordInfo.textContent = n.real_lat != null ? (n.real_source === 'gps' ? 'Tomada con el GPS del equipo' : 'Escrita a mano') : 'Sin coordenada real';
  }
  fmtSel.addEventListener('change', () => {
    readCoord(true);
    fmt = fmtSel.value;
    showCoordInputs();
  });
  /** Lee los campos; si cambiaron, la coordenada pasa a ser "manual". */
  function readCoord(quiet) {
    if (!ca.value.trim() && !cb.value.trim()) {
      n.real_lat = n.real_lon = n.real_source = n.real_acc = null;
      return;
    }
    try {
      const [lat, lon] = Coords.parse(ca.value, cb.value, fmt, zone);
      const before = n.real_lat != null ? Coords.format2(n.real_lat, n.real_lon, fmt, zone) : null;
      if (!before || before[0] !== ca.value.trim() || before[1] !== cb.value.trim()) {
        n.real_lat = lat;
        n.real_lon = lon;
        n.real_source = 'manual';
        n.real_acc = null;
      }
    } catch (e) {
      if (!quiet) throw new Error('Coordenada real: ' + e.message);
    }
  }
  showCoordInputs();

  // Fecha de eclosión
  const hatch = h('input', { type: 'date', value: n.hatch_date || '' });
  const hatchInfo = h('span.hint');
  const daysFor = (sp) => sp === 'chelonia_mydas' ? s.days_mydas || 60 : sp === 'caretta_caretta' ? s.days_caretta || 55 : 0;
  let wasWild = n.status_override === 'salvaje';
  function recompute() {
    const wild = override.value === 'salvaje';
    if (wild) {
      n.hatch_date = date.value || null;
      n.hatch_manual = 1;
    } else if (wasWild && n.hatch_manual && n.hatch_date === date.value) {
      n.hatch_manual = 0;
    }
    wasWild = wild;
    if (!n.hatch_manual) n.hatch_date = addDays(date.value, daysFor(species.value));
    hatch.value = n.hatch_date || '';
    hatchInfo.textContent = wild ? 'Nido salvaje: eclosión = fecha de registro.'
      : n.hatch_manual ? (n.hatch_date ? 'Fecha puesta por el experto.' : 'Vacía (el experto la dejó sin fecha).')
        : !species.value ? 'Elige la especie para estimarla.'
          : 'Estimada: detección + ' + daysFor(species.value) + ' días.';
    const cleaned = old && store.cleaningOf(old.uuid);
    statusInfo.textContent = override.value ? 'Estado fijado: ' + statusName(override.value)
      : 'Estado automático: ' + (cleaned ? 'eclosionado (tiene limpieza)' : 'activo (sin limpieza)');
  }
  hatch.addEventListener('change', () => { n.hatch_date = hatch.value || null; n.hatch_manual = 1; recompute(); });
  date.addEventListener('change', recompute);
  species.addEventListener('change', recompute);
  override.addEventListener('change', recompute);
  action.addEventListener('change', () => {
    if (Number(action.value) === ACTION_WILD && expert && !override.value) {
      override.value = 'salvaje';
      toast('Acción 8: se propone "salvaje" (puedes cambiarlo).');
      recompute();
    }
  });
  recompute();

  const lt = h('input', { inputMode: 'decimal', value: n.turtle_lt ?? '' });
  const lc = h('input', { inputMode: 'decimal', value: n.turtle_lc ?? '' });
  const ac = h('input', { inputMode: 'decimal', value: n.turtle_ac ?? '' });
  const tnotes = h('textarea', { rows: 2, value: n.turtle_notes || '' });
  const notes = h('textarea', { rows: 3, value: n.notes || '' });
  const observer = h('input', { value: n.observer || '' });

  const saveBtn = h('button.btn.primary', { type: 'submit' }, 'Guardar');
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
    h('div.grid3',
      field('Número de nido *', number),
      field('Fecha de detección *', date),
      field('Especie', species)),
    h('div.grid3',
      field('Estado', override, expert ? null : 'Solo experto o coordinador lo cambian'),
      field('Playa', beach),
      h('div.grid2', field('Zona', zoneSel), field('Acción', action))),
    statusInfo,
    h('fieldset', h('legend', 'Coordenada real (en campo)'),
      h('div.grid3', field('Formato', fmtSel), h('label.field', caLabel, ca), h('label.field', cbLabel, cb)),
      h('div.row-btns', coordInfo,
        h('button.btn.ghost.small', { type: 'button', onclick: () => { ca.value = cb.value = ''; readCoord(true); showCoordInputs(); } }, 'Quitar coordenada')),
      n.photo_lat != null ? h('p.hint', 'Desde imagen aérea: ' + Coords.format(n.photo_lat, n.photo_lon, fmt, zone) + ' (no se edita aquí)') : null),
    h('fieldset', h('legend', 'Fecha de eclosión'),
      h('div.grid3', field('Fecha', hatch),
        h('div.row-btns',
          h('button.btn.ghost.small', { type: 'button', onclick: () => { n.hatch_manual = 0; recompute(); } }, 'Estimar'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => { n.hatch_date = null; n.hatch_manual = 1; recompute(); } }, 'Dejar vacía'))),
      hatchInfo),
    h('details', { open: !!(n.turtle_lt || n.turtle_lc || n.turtle_ac || n.turtle_notes) },
      h('summary', 'Tortuga (opcional)'),
      h('div.grid3', field('Largo total (cm)', lt), field('Largo curvo (cm)', lc), field('Ancho curvo (cm)', ac)),
      field('Observaciones de la tortuga', tnotes)),
    field('Notas', notes),
    field('Registrado por', observer),
    h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancelar'), saveBtn));

  const m = modal(old ? 'Editar nido ' + old.number : 'Nuevo nido', form, { wide: true });
  number.focus();

  function submit() {
    busy(saveBtn, async () => {
      n.number = number.value.trim();
      if (!n.number) throw new Error('Escribe el número de nido');
      if (!date.value) throw new Error('Escribe la fecha de detección');
      n.detected_date = date.value;
      const season = Number(date.value.slice(0, 4));
      const dup = store.nests().find((x) => x.uuid !== n.uuid && x.number === n.number && x.season === season);
      if (dup) {
        // Un nido registrado dos veces (p. ej. el 100 era el 1): el experto o coordinador puede enlazar sus imágenes
        // al otro, solo desde una computadora (con ratón), para hacerlo con calma y en pantalla grande.
        const pc = window.matchMedia && matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches;
        if (!old || !expert) throw new Error('Ya existe el nido ' + n.number + ' en la temporada ' + season);
        if (!pc) throw new Error('Ya existe el nido ' + n.number + ' en la temporada ' + season + '. Si son el mismo nido, enlázalos desde una computadora.');
        if (await mergeNests(ctx, old, dup)) m.close();
        return;
      }
      readCoord(false);
      n.species = species.value || null;
      n.status_override = expert ? override.value || null : old ? old.status_override : null;
      n.beach = beach.value || null;
      n.zone = zoneSel.value ? Number(zoneSel.value) : null;
      n.action = action.value ? Number(action.value) : null;
      n.turtle_lt = num(lt); n.turtle_lc = num(lc); n.turtle_ac = num(ac);
      n.turtle_notes = tnotes.value.trim() || null;
      n.notes = notes.value.trim() || null;
      n.observer = observer.value.trim() || null;
      await saveRow(ctx, 'nest', pick(n, NEST_COLS));
      toast(old ? 'Nido ' + n.number + ' guardado' : 'Nido ' + n.number + ' registrado');
      m.close();
    });
  }
}

/**
 * «El nido 100 es el mismo que el 1»: sus imágenes aéreas (máscaras) y fotos de campo pasan al nido 1, su
 * limpieza también si el 1 no tiene, y el 100 se elimina. Los datos del 1 no cambian (solo toma la
 * coordenada desde imagen aérea si no tenía). Todo en una sola subida. Devuelve true si se hizo.
 */
async function mergeNests(ctx, from, to) {
  const { store } = ctx;
  const masks = store.masksOf(from.uuid);
  const photos = store.photosOf(from.uuid);
  const kFrom = store.cleaningOf(from.uuid), kTo = store.cleaningOf(to.uuid);
  const ok = await confirmBox('El nido ' + to.number + ' ya existe',
    '¿El nido ' + from.number + ' es el mismo que el nido ' + to.number + ' (temporada ' + to.season + ', detectado el '
    + showDate(to.detected_date) + (to.beach ? ', ' + to.beach : '') + ')?\n\n'
    + 'Se enlazan al nido ' + to.number + ': ' + masks.length + ' imagen(es) aérea(s) y ' + photos.length + ' foto(s) de campo'
    + (kFrom ? (kTo ? '. La limpieza del nido ' + from.number + ' se descarta porque el ' + to.number + ' ya tiene una' : ' y su limpieza') : '')
    + '.\nLuego se elimina el nido ' + from.number + '. Los datos del nido ' + to.number + ' no cambian.',
    'Enlazar al nido ' + to.number);
  if (!ok) return false;
  const now = nowUtc();
  const at = (row) => ({ ...row, updated_at: now, created_at: row.created_at || now });
  const pFrom = [from.real_lat ?? from.photo_lat, from.real_lon ?? from.photo_lon];
  const pTo = [to.real_lat ?? to.photo_lat, to.real_lon ?? to.photo_lon];
  const meters = pFrom[0] != null && pTo[0] != null ? Math.round(distance(pFrom[0], pFrom[1], pTo[0], pTo[1]) * 100) / 100 : null;
  const rows = {
    nest: [at({ ...pick(from, NEST_COLS), deleted: 1 })],
    mask: masks.map((x) => at({ ...pickCols(x, MASK_COLS), uuid: x.uuid, created_at: x.created_at,
      nest_uuid: to.uuid, status: 'aceptada', link_method: 'manual', link_meters: meters })),
    photo: photos.map((p) => at({ uuid: p.uuid, created_at: p.created_at, deleted: 0, nest_uuid: to.uuid })),
    cleaning: kFrom ? [at({ ...pick(kFrom, CLEANING_COLS), ...(kTo ? { deleted: 1 } : { nest_uuid: to.uuid }) })] : [],
  };
  if (to.photo_lat == null && from.photo_lat != null) {
    rows.nest.unshift(at({ ...pick(to, NEST_COLS), photo_lat: from.photo_lat, photo_lon: from.photo_lon }));
  }
  const res = await store.save(rows, ctx.user.id);
  if (res.rechazados && res.rechazados.length) throw new Error('No se pudo enlazar: ' + res.rechazados[0].razon);
  toast('Nido ' + from.number + ' enlazado al nido ' + to.number);
  return true;
}

function pickCols(row, cols) {
  const o = {};
  for (const c of cols) o[c] = row[c] ?? null;
  return o;
}

export async function deleteNest(ctx, n) {
  try {
    await saveRow(ctx, 'nest', { ...pick(n, NEST_COLS), deleted: 1 });
    toast('Nido ' + n.number + ' eliminado');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ───────────────────────────── limpieza

export function cleaningForm(ctx, nestUuid) {
  const { store, user } = ctx;
  const s = store.settings || {};
  let nest = nestUuid ? store.nest(nestUuid) : null;
  const old = nest ? store.cleaningOf(nest.uuid) : null;
  const k = old ? { ...old } : { uuid: crypto.randomUUID(), clean_date: todayIso(), phase_mode: s.phase_mode || 'total', camp: ctx.campName, observer: user.nombre };
  const detail = k.phase_mode === 'detalle';

  // Elegir nido si no viene dado: los que no tienen limpieza, por temporada y número.
  let nestSel = null;
  if (!nest) {
    const candidates = store.nests().filter((x) => !store.cleaningOf(x.uuid))
      .sort((a, b) => (b.season || 0) - (a.season || 0) || byNumber(a.number, b.number));
    nestSel = select([['', 'Elige el nido…'], ...candidates.map((x) => [x.uuid, 'Nido ' + x.number + ' · ' + (x.season || '') + ' · ' + (x.beach || 'sin playa') + ' · ' + showDate(x.detected_date)])], '');
  }
  const date = h('input', { type: 'date', value: k.clean_date || '' });
  const numIn = (v) => h('input', { inputMode: 'numeric', value: v ?? '' });
  const shells = numIn(k.shells), alive = numIn(k.alive), dead = numIn(k.dead), pink = numIn(k.pink);
  const p1 = numIn(k.phase1), p2 = numIn(k.phase2), p3 = numIn(k.phase3), ptotal = numIn(k.phase_total);
  const totalInfo = h('span.hint');
  const updTotal = () => {
    if (!detail) return;
    const t = [p1, p2, p3].reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    totalInfo.textContent = 'Total de fase: ' + t;
  };
  [p1, p2, p3].forEach((i) => i.addEventListener('input', updTotal));
  updTotal();
  const notes = h('textarea', { rows: 3, value: k.notes || '' });
  const observer = h('input', { value: k.observer || '' });

  const saveBtn = h('button.btn.primary', { type: 'submit' }, 'Guardar');
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
    nestSel ? field('Nido *', nestSel) : h('p', 'Nido ' + nest.number + ' · temporada ' + (nest.season || '') + ' · ' + (nest.beach || 'sin playa')),
    h('div.grid3', field('Fecha de la limpieza', date)),
    h('div.grid4', field('Cascarones', shells), field('Vivas', alive), field('Muertas', dead), field('Rosa', pink)),
    detail
      ? h('fieldset', h('legend', 'Fase (por fase, como registra este campamento)'),
        h('div.grid3', field('Fase 1', p1), field('Fase 2', p2), field('Fase 3', p3)), totalInfo)
      : h('div.grid3', field('Fase (total)', ptotal)),
    field('Notas', notes),
    field('Registrado por', observer),
    h('div.actions',
      old && can(user, 'experto') ? h('button.btn.danger', { type: 'button', onclick: removeIt }, 'Eliminar limpieza') : null,
      h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancelar'), saveBtn));

  const m = modal(old ? 'Editar limpieza' : 'Registrar limpieza', form, { wide: true });

  function submit() {
    busy(saveBtn, async () => {
      if (nestSel) {
        if (!nestSel.value) throw new Error('Elige el nido');
        nest = store.nest(nestSel.value);
      }
      k.nest_uuid = nest.uuid;
      k.clean_date = date.value || null;
      k.shells = num(shells, true); k.alive = num(alive, true); k.dead = num(dead, true); k.pink = num(pink, true);
      if (detail) {
        k.phase1 = num(p1, true); k.phase2 = num(p2, true); k.phase3 = num(p3, true);
        k.phase_total = [k.phase1, k.phase2, k.phase3].some((v) => v != null) ? (k.phase1 || 0) + (k.phase2 || 0) + (k.phase3 || 0) : null;
      } else {
        k.phase_total = num(ptotal, true);
        k.phase1 = k.phase2 = k.phase3 = null;
      }
      k.notes = notes.value.trim() || null;
      k.observer = observer.value.trim() || null;
      await saveRow(ctx, 'cleaning', pick(k, CLEANING_COLS));
      toast('Limpieza del nido ' + nest.number + ' guardada');
      m.close();
    });
  }

  async function removeIt() {
    if (!(await confirmBox('Eliminar limpieza', '¿Eliminar la limpieza del nido ' + nest.number + '? El nido vuelve a "activo" si no tiene estado fijado.', 'Eliminar', true))) return;
    try {
      await saveRow(ctx, 'cleaning', { ...pick(k, CLEANING_COLS), deleted: 1 });
      toast('Limpieza eliminada');
      m.close();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
}

