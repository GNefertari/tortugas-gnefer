// Bandeja de revisión de un vuelo (paso 6a, experto o más).
//
// Foto por foto, con las máscaras de GNeST dibujadas, el experto decide en cada propuesta:
//   - Aceptar: nido nuevo. La web propone el siguiente número libre de la temporada y
//     Chelonia mydas; el experto los corrige si hace falta.
//   - Ya registrado: se enlaza con un nido que ya existe. Propone los que cumplen la regla de
//     cercanía de la app (distancia, misma temporada, de N días antes a M días después), con la
//     vista breve para confirmar «Es este nido».
//   - Descartar.
// También puede dibujar los nidos que GNeST no vio. Todo se guarda con sync/push, igual que la app;
// el vuelo se cierra solo (en el servidor) cuando ya no quedan propuestas sin revisar.

import { SPECIES, speciesName, statusName } from './catalog.js';
import { NEST_COLS } from './formularios.js';
import { distance, footprint } from './geo.js';
import { addDays, busy, byNumber, clear, field, h, modal, nowUtc, select, showDate, toast } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const MASK_COLS = ['nest_uuid', 'aerial_uuid', 'ann_index', 'polygon', 'cx', 'cy', 'lat', 'lon', 'crop_x', 'crop_y', 'crop_sample',
  'source', 'score', 'status', 'link_method', 'link_meters', 'gnest_polygon'];
const DEFAULT_SPECIES = 'chelonia_mydas';   // la más frecuente en Cozumel
const STATUS_TEXT = { propuesta: 'Por revisar', aceptada: 'Aceptada', descartada: 'Descartada' };

function rowOf(r, cols) {
  const o = { uuid: r.uuid, created_at: r.created_at || null, deleted: r.deleted || 0 };
  for (const c of cols) o[c] = r[c] ?? null;
  return o;
}

/** updated_at más reciente que el anterior (dos cambios en el mismo segundo no deben empatar). */
function stampAfter(prev) {
  const now = nowUtc();
  if (!prev || prev < now) return now;
  return new Date(Date.parse(prev) + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const nestPosition = (n) => (n.real_lat != null ? [n.real_lat, n.real_lon] : n.photo_lat != null ? [n.photo_lat, n.photo_lon] : null);

/** Como el.append(), pero sin escribir "null" por las partes que no aplican. */
function fill(el, ...nodes) {
  clear(el).append(...nodes.flat().filter((x) => x != null && x !== false));
}

function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]);
    y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]);
  }
  return [x0, y0, x1, y1];
}

export function reviewView(ctx, flightInfo, onBack) {
  const { store, user, api } = ctx;
  const settings = store.settings || {};
  const el = h('section.review');
  const head = h('div.review-head');
  const stage = h('div.review-stage');
  const side = h('aside.review-side');
  el.append(head, h('div.review-body', stage, side));

  let photos = [];
  let pi = 0;                 // foto que se ve
  let selected = null;        // uuid de la máscara elegida
  let mode = 'acciones';      // acciones | aceptar | enlazar | dibujar | editar
  let edit = null;            // contorno que se ajusta: {id, points, undo: [], vsel}
  let draft = null;           // nido dibujado por el experto: {points: [x, y, …]} o máscara lista
  let token = 0;

  const flight = () => store.flight(flightInfo.id) || {};
  const flightMasks = () => {
    const ids = new Set(photos.map((a) => a.uuid));
    return store.masks().filter((m) => ids.has(m.aerial_uuid));
  };
  const photoMasks = (a) => store.masks().filter((m) => m.aerial_uuid === a.uuid)
    .sort((x, y) => (x.ann_index ?? 999) - (y.ann_index ?? 999) || String(x.created_at).localeCompare(String(y.created_at)));
  const photoDate = (a) => (a && a.taken_at ? a.taken_at.slice(0, 10) : flightInfo.fecha);
  const pendingOf = (a) => photoMasks(a).filter((m) => m.status === 'propuesta').length;
  const current = () => photos[pi];
  // En revisión en ValiNest: la web solo muestra (el equipo que lo tiene sube su revisión al terminar).
  const locked = () => (flight().review_status || flightInfo.estado) === 'en_app';
  const currentMask = () => (selected === 'draft' ? draft : selected ? store.masks().find((m) => m.uuid === selected) : null);

  function loadPhotos() {
    photos = store.aerials().filter((a) => a.flight_uuid === flightInfo.id)
      .sort((x, y) => String(x.taken_at || '').localeCompare(String(y.taken_at || '')) || x.file_name.localeCompare(y.file_name));
  }

  // ───────────────────────────── encabezado

  function renderHead() {
    const f = flight();
    const masks = flightMasks();
    const pending = masks.filter((m) => m.status === 'propuesta').length;
    const status = f.review_status || flightInfo.estado;
    clear(head).append(
      h('button.btn.ghost.small', { type: 'button', onclick: () => onBack() }, '← Vuelos'),
      h('div', h('h2', 'Vuelo del ' + showDate(flightInfo.fecha) + ' · ' + flightInfo.playa),
        h('small.muted', photos.length + ' foto(s) · ' + pending + ' propuesta(s) por revisar · '
          + masks.filter((m) => m.nest_uuid).length + ' aceptada(s) · ' + masks.filter((m) => m.status === 'descartada').length + ' descartada(s)')),
      h('div.spacer'),
      h('span.badge.' + (status === 'revisado' ? 'ok' : status === 'en_app' ? 'warn' : 'upd'),
        status === 'revisado' ? 'Revisado' : status === 'en_app' ? 'En revisión en ValiNest' : 'Por revisar'));
  }

  // ───────────────────────────── foto (acercar, mover, tocar)

  let layer = null, svg = null, img = null, W = 1, H = 1, k = 1;
  let s = 1, tx = 0, ty = 0, minS = 0.1;

  async function showPhoto(i, keepSelection) {
    pi = (i + photos.length) % photos.length;
    edit = null;
    if (!keepSelection) { selected = null; mode = 'acciones'; draft = null; }
    const a = current();
    const my = ++token;
    stage.replaceChildren(h('p.muted', 'Cargando la foto…'));
    renderSide();
    const url = await api.image('aerial', a.uuid);
    if (my !== token) return;
    if (!url) { stage.replaceChildren(h('p.muted', 'Esta foto todavía no se ha subido.')); return; }
    img = h('img', { src: url, alt: a.file_name, draggable: false });
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    if (my !== token) return;
    W = img.naturalWidth; H = img.naturalHeight;
    k = W / a.width;
    svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'review-masks');
    layer = h('div.viewer-layer', { style: { width: W + 'px', height: H + 'px' } }, img, svg);
    stage.replaceChildren(layer);
    fit();
    drawMasks();
    if (selected) focusOn(currentMask());
  }

  function drawMasks() {
    if (!svg) return;
    while (svg.firstChild) svg.firstChild.remove();
    const a = current();
    const add = (tag, attrs) => {
      const e = document.createElementNS(SVG, tag);
      for (const [key, v] of Object.entries(attrs)) e.setAttribute(key, v);
      svg.append(e);
      return e;
    };
    const pts = (poly) => {
      const out = [];
      for (let j = 0; j + 1 < poly.length; j += 2) out.push((poly[j] * k).toFixed(1) + ',' + (poly[j + 1] * k).toFixed(1));
      return out.join(' ');
    };
    photoMasks(a).forEach((m, idx) => {
      if (edit && edit.id === m.uuid) return;   // se dibuja abajo, con sus controles
      const cls = (m.nest_uuid ? 'ok' : m.status === 'descartada' ? 'no' : 'todo') + (m.uuid === selected ? ' sel' : '');
      add('polygon', { points: pts(m.polygon), class: cls, 'data-id': m.uuid });
      const nest = m.nest_uuid && store.nest(m.nest_uuid);
      const label = add('text', { x: (m.cx * k).toFixed(1), y: (bbox(m.polygon)[1] * k - 6).toFixed(1), class: cls, 'data-id': m.uuid });
      label.textContent = nest ? nest.number : String(idx + 1);
    });
    if (edit) {
      // Ajustar contorno: cuerpo (trasladar), bordes (tocar = punto nuevo), puntos (mover), esquinas
      // (agrandar o achicar) y manija (girar). Los tamaños se mantienen iguales en pantalla.
      const p = edit.points, u = 1 / s;
      const [x0, y0, x1, y1] = bbox(p).map((v) => v * k);
      add('polygon', { points: pts(p), class: 'edit', 'data-role': 'body' });
      for (let j = 0; j + 1 < p.length; j += 2) {
        const n = (j + 2) % p.length;
        add('line', { x1: p[j] * k, y1: p[j + 1] * k, x2: p[n] * k, y2: p[n + 1] * k, class: 'edge', 'data-role': 'edge', 'data-i': j / 2 });
      }
      add('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'edit-box' });
      add('line', { x1: (x0 + x1) / 2, y1: y0, x2: (x0 + x1) / 2, y2: y0 - 30 * u, class: 'edit-box' });
      add('circle', { cx: (x0 + x1) / 2, cy: y0 - 30 * u, r: 7 * u, class: 'rot', 'data-role': 'rot' });
      for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        add('rect', { x: cx - 6 * u, y: cy - 6 * u, width: 12 * u, height: 12 * u, class: 'scale', 'data-role': 'scale' });
      }
      for (let j = 0; j + 1 < p.length; j += 2) {
        add('circle', { cx: p[j] * k, cy: p[j + 1] * k, r: (j / 2 === edit.vsel ? 7 : 5) * u,
          class: 'vertex' + (j / 2 === edit.vsel ? ' on' : ''), 'data-role': 'v', 'data-i': j / 2 });
      }
    }
    if (draft && draft.points && draft.points.length && !(edit && edit.id === 'draft')) {
      add(draft.done ? 'polygon' : 'polyline', { points: pts(draft.points), class: 'draft' });
      for (let j = 0; j + 1 < draft.points.length; j += 2) add('circle', { cx: draft.points[j] * k, cy: draft.points[j + 1] * k, r: 4 / s, class: 'draft' });
    }
    apply();
  }

  const apply = () => {
    if (!layer) return;
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    svg.style.setProperty('--stroke', (2.2 / s).toFixed(2) + 'px');
    svg.style.setProperty('--label', (15 / Math.sqrt(s)).toFixed(1) + 'px');
  };
  function fit() {
    const r = stage.getBoundingClientRect();
    s = minS = Math.min(r.width / W, r.height / H);
    tx = (r.width - W * s) / 2;
    ty = (r.height - H * s) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(10, Math.max(minS, s * f));
    tx = cx - (cx - tx) * (ns / s);
    ty = cy - (cy - ty) * (ns / s);
    s = ns;
    apply();
  }
  function focusOn(m) {
    if (!m || !m.polygon || !layer) return;
    const [x0, y0, x1, y1] = bbox(m.polygon);
    const r = stage.getBoundingClientRect();
    s = Math.max(minS, Math.min(10, Math.min(r.width, r.height) / Math.max(200, (Math.max(x1 - x0, y1 - y0) * k) * 5)));
    tx = r.width / 2 - ((x0 + x1) / 2) * k * s;
    ty = r.height / 2 - ((y0 + y1) / 2) * k * s;
    apply();
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  const pointers = new Map();
  let last = null, moved = 0, downTarget = null, dragging = null;
  /** Punto de la pantalla -> píxel de la foto original (dentro de la foto). */
  const toImage = (e) => {
    const r = stage.getBoundingClientRect(), a = current();
    const x = (e.clientX - r.left - tx) / s / k, y = (e.clientY - r.top - ty) / s / k;
    return [Math.min(a.width, Math.max(0, x)), Math.min(a.height_px, Math.max(0, y))];
  };
  stage.addEventListener('pointerdown', (e) => {
    downTarget = e.target;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
    moved = 0;
    dragging = null;
    const role = mode === 'editar' && e.target.getAttribute && e.target.getAttribute('data-role');
    if (role && role !== 'edge' && pointers.size === 1) {
      const [x0, y0, x1, y1] = bbox(edit.points);
      dragging = { role, i: Number(e.target.getAttribute('data-i')), start: toImage(e), pts: edit.points.slice(), c: [(x0 + x1) / 2, (y0 + y1) / 2] };
      if (role === 'v') edit.vsel = dragging.i;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    if (dragging && pointers.size === 1) {
      if (moved < 3) return;
      if (!dragging.saved) { edit.undo.push(dragging.pts); dragging.saved = true; }
      const [x, y] = toImage(e), d = dragging, src = d.pts, out = src.slice();
      const [cx, cy] = d.c;
      if (d.role === 'v') {
        out[d.i * 2] = x; out[d.i * 2 + 1] = y;
      } else if (d.role === 'body') {
        for (let j = 0; j + 1 < src.length; j += 2) { out[j] = src[j] + x - d.start[0]; out[j + 1] = src[j + 1] + y - d.start[1]; }
      } else if (d.role === 'scale') {
        const f = Math.max(0.05, Math.hypot(x - cx, y - cy) / Math.max(1, Math.hypot(d.start[0] - cx, d.start[1] - cy)));
        for (let j = 0; j + 1 < src.length; j += 2) { out[j] = cx + (src[j] - cx) * f; out[j + 1] = cy + (src[j + 1] - cy) * f; }
      } else if (d.role === 'rot') {
        const ang = Math.atan2(y - cy, x - cx) - Math.atan2(d.start[1] - cy, d.start[0] - cx);
        const cos = Math.cos(ang), sin = Math.sin(ang);
        for (let j = 0; j + 1 < src.length; j += 2) {
          const dx = src[j] - cx, dy = src[j + 1] - cy;
          out[j] = cx + dx * cos - dy * sin; out[j + 1] = cy + dx * sin + dy * cos;
        }
      }
      edit.points = out.map((v) => Math.round(v * 10) / 10);
      drawMasks();
      return;
    }
    if (pointers.size === 1) { tx += e.clientX - p.x; ty += e.clientY - p.y; apply(); }
    else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const r = stage.getBoundingClientRect();
      if (last) zoomAt(d / last, (p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top);
      last = d;
    }
  });
  stage.addEventListener('pointerup', (e) => {
    const wasTap = pointers.size === 1 && moved < 6;
    pointers.delete(e.pointerId);
    last = null;
    const wasDrag = dragging && dragging.saved;
    dragging = null;
    if (wasDrag) { renderSide(); return; }
    if (!wasTap || !layer) return;
    if (mode === 'editar') {
      const role = downTarget && downTarget.getAttribute && downTarget.getAttribute('data-role');
      if (role === 'edge') {
        // Tocar un borde agrega un punto ahí.
        const i = Number(downTarget.getAttribute('data-i'));
        edit.undo.push(edit.points.slice());
        const [x, y] = toImage(e);
        edit.points.splice(i * 2 + 2, 0, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
        edit.vsel = i + 1;
      }
      drawMasks();
      renderSide();
      return;
    }
    if (mode === 'dibujar' && draft && !draft.done) {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left - tx) / s / k, y = (e.clientY - r.top - ty) / s / k;
      if (x < 0 || y < 0 || x > current().width || y > current().height_px) return;
      draft.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      drawMasks();
      renderSide();
      return;
    }
    const id = downTarget && downTarget.getAttribute && downTarget.getAttribute('data-id');
    if (id) select_(id);
  });
  stage.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); last = null; });

  function select_(id) {
    edit = null;
    selected = id;
    mode = 'acciones';
    draft = null;
    drawMasks();
    renderSide();
    focusOn(currentMask());
  }

  // ───────────────────────────── panel lateral

  function renderSide() {
    const a = current();
    if (!a) { clear(side).append(h('p.muted', 'Este vuelo no tiene fotos.')); return; }
    const masks = photoMasks(a);
    const nextPending = photos.findIndex((p, j) => j > pi && pendingOf(p) > 0);
    const firstPending = photos.findIndex((p) => pendingOf(p) > 0);
    const jump = nextPending >= 0 ? nextPending : firstPending !== pi ? firstPending : -1;
    fill(side,
      h('div.review-nav',
        h('button.btn.ghost.small', { type: 'button', onclick: () => showPhoto(pi - 1) }, '◀'),
        h('div.review-photo', h('b', 'Foto ' + (pi + 1) + ' de ' + photos.length), h('small', a.file_name + ' · ' + showDate(photoDate(a)))),
        h('button.btn.ghost.small', { type: 'button', onclick: () => showPhoto(pi + 1) }, '▶')),
      jump >= 0 ? h('button.btn.ghost.small.block', { type: 'button', onclick: () => showPhoto(jump) }, 'Ir a la siguiente foto con propuestas ▶▶') : null,
      h('h3.section-title', 'Nidos en esta foto'),
      masks.length ? h('div.mask-list', masks.map((m, idx) => {
        const nest = m.nest_uuid && store.nest(m.nest_uuid);
        return h('button.mask-item' + (m.uuid === selected ? '.on' : '') + '.' + (m.nest_uuid ? 'ok' : m.status === 'descartada' ? 'no' : 'todo'),
          { type: 'button', onclick: () => select_(m.uuid) },
          h('b', nest ? 'Nido ' + nest.number : 'Propuesta ' + (idx + 1)),
          h('small', [m.source === 'experto' ? 'dibujado' : m.score != null ? Math.round(m.score * 100) + ' % de confianza' : null,
            m.gnest_polygon ? 'contorno ajustado' : null, nest ? 'aceptada' : STATUS_TEXT[m.status] || m.status].filter(Boolean).join(' · ')));
      })) : h('p.muted', 'GNeST no encontró nidos en esta foto.'),
      h('div.review-actions', actionBox()),
      mode !== 'dibujar' && !locked() ? h('button.btn.ghost.small.block', { type: 'button', onclick: startDrawing }, '✎ Dibujar un nido que GNeST no vio') : null,
      h('p.hint', 'Rueda o pellizco para acercar · arrastra para moverte · toca una máscara para elegirla'));
  }

  function actionBox() {
    if (locked()) {
      const vn = flightInfo.valinest;
      return h('p.notice.warn', '🔒 Este vuelo está en revisión en ValiNest' + (vn && vn.por ? ' (' + vn.por + ')' : '')
        + ': aquí solo se puede ver. Para editarlo en la web, primero «Quitar bloqueo» en Vuelos.');
    }
    if (mode === 'dibujar') return drawBox();
    const m = currentMask();
    if (!m) return h('p.muted', masks0() ? 'Elige una propuesta en la foto o en la lista.' : '');
    if (mode === 'editar') return editBox(m);
    if (mode === 'aceptar') return acceptBox(m);
    if (mode === 'enlazar') return linkBox(m);
    const adjust = h('button.btn.ghost', { type: 'button', onclick: () => startEdit(m) }, '✏️ Ajustar contorno');
    if (m.nest_uuid) {
      const nest = store.nest(m.nest_uuid);
      return h('div', h('p', 'Enlazada al ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.openNest(m.nest_uuid); } }, 'nido ' + (nest ? nest.number : '?')),
        m.link_method === 'nuevo' ? ' (nido nuevo).' : m.link_meters != null ? ' (a ' + m.link_meters.toFixed(1) + ' m).' : '.'),
      h('div.decide-btns', adjust));
    }
    if (m.status === 'descartada') {
      return h('div', h('p.muted', 'Descartada.'),
        h('button.btn.ghost.small', { type: 'button', onclick: (e) => busy(e.currentTarget, () => saveMask(m, { status: 'propuesta' }, 'Vuelve a estar por revisar')) }, 'Volver a revisar'));
    }
    const cands = candidates(m);
    return h('div.decide',
      h('p', 'Propuesta ' + (m.source === 'experto' ? 'dibujada' : 'de GNeST') + (m.score != null ? ' · ' + Math.round(m.score * 100) + ' %' : '')
        + (cands.length ? ' · ' + cands.length + ' nido(s) registrado(s) cerca' : '')),
      h('div.decide-btns',
        h('button.btn.primary', { type: 'button', onclick: () => { mode = 'aceptar'; renderSide(); } }, '✓ Aceptar (nido nuevo)'),
        h('button.btn' + (cands.length ? '.primary' : '.ghost'), { type: 'button', onclick: () => { mode = 'enlazar'; renderSide(); } },
          '🔗 Ya registrado' + (cands.length ? ' (' + cands.length + ')' : '')),
        adjust,
        selected === 'draft'
          ? h('button.btn.ghost', { type: 'button', onclick: cancelDraft }, 'Quitar dibujo')
          : h('button.btn.danger', { type: 'button', onclick: (e) => busy(e.currentTarget, () => saveMask(m, { status: 'descartada' }, 'Propuesta descartada')) }, '✗ Descartar')));
  }
  const masks0 = () => photoMasks(current()).length > 0;

  // ───────────────────────────── aceptar (nido nuevo)

  function nextNumber(season) {
    let max = 0;
    for (const n of store.nests()) if (n.season === season && /^\d+$/.test(n.number)) max = Math.max(max, Number(n.number));
    return String(max + 1);
  }

  function acceptBox(m) {
    const date0 = photoDate(current());
    const number = h('input', { value: nextNumber(Number(date0.slice(0, 4))), required: true, autocomplete: 'off' });
    const date = h('input', { type: 'date', value: date0, required: true });
    const species = select(SPECIES.map((x) => [x[0], x[1] + ' — ' + x[2]]), DEFAULT_SPECIES);
    const beaches = [...new Set([...(settings.beaches || []), flightInfo.playa])];
    const beach = select(beaches, flightInfo.playa);
    date.addEventListener('change', () => { if (date.value) number.value = nextNumber(Number(date.value.slice(0, 4))); });
    const btn = h('button.btn.primary', { type: 'submit' }, 'Registrar nido');
    const form = h('form.form', { onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        const num = number.value.trim();
        if (!num) throw new Error('Escribe el número de nido');
        if (!date.value) throw new Error('Escribe la fecha de detección');
        const season = Number(date.value.slice(0, 4));
        if (store.nests().some((n) => n.season === season && n.number === num)) throw new Error('Ya existe el nido ' + num + ' en la temporada ' + season);
        const days = species.value === 'caretta_caretta' ? settings.days_caretta || 55 : settings.days_mydas || 60;
        const nest = rowOf({ uuid: crypto.randomUUID(), number: num, detected_date: date.value, species: species.value, beach: beach.value,
          photo_lat: m.lat, photo_lon: m.lon, hatch_date: addDays(date.value, days), hatch_manual: 0, origin: 'web',
          camp: ctx.campName, observer: user.nombre }, NEST_COLS);
        nest.updated_at = nest.created_at = nowUtc();
        await saveMask(m, { nest_uuid: nest.uuid, status: 'aceptada', link_method: 'nuevo', link_meters: null }, 'Nido ' + num + ' registrado', [nest]);
      });
    } },
    h('p', h('b', 'Nido nuevo')),
    h('div.grid2', field('Número *', number, 'Siguiente libre de la temporada'), field('Fecha de detección *', date)),
    field('Especie', species), field('Playa', beach),
    h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => { mode = 'acciones'; renderSide(); } }, 'Cancelar'), btn));
    setTimeout(() => number.focus(), 0);
    return form;
  }

  // ───────────────────────────── ya registrado (regla de cercanía de la app)

  function candidates(m) {
    if (m.lat == null) return [];
    const date = photoDate(current());
    const season = Number(date.slice(0, 4));
    const meters = settings.match_meters || 5, before = settings.match_days_before ?? 7, after = settings.match_days ?? 30;
    const out = [];
    for (const n of store.nests()) {
      const p = nestPosition(n);
      if (!p || n.season !== season || !n.detected_date) continue;
      const d = distance(m.lat, m.lon, p[0], p[1]);
      if (d > meters) continue;
      const age = daysBetween(n.detected_date, date);
      if (age < -before || age > after) continue;
      out.push({ nest: n, meters: d, days: age });
    }
    return out.sort((x, y) => x.meters - y.meters);
  }

  function linkBox(m) {
    const cands = candidates(m);
    const season = Number(photoDate(current()).slice(0, 4));
    const others = store.nests().filter((n) => n.season === season).sort((x, y) => byNumber(x.number, y.number));
    const manual = select([['', 'Otro nido de ' + season + '…'], ...others.map((n) => [n.uuid, 'Nido ' + n.number + ' · ' + (n.beach || 'sin playa') + ' · ' + showDate(n.detected_date)])], '');
    const linkTo = (n, method, meters, btn) => busy(btn, async () => {
      const extra = [];
      if (n.photo_lat == null && m.lat != null) {
        const upd = { ...rowOf(n, NEST_COLS), photo_lat: m.lat, photo_lon: m.lon, updated_at: stampAfter(n.updated_at) };
        extra.push(upd);
      }
      await saveMask(m, { nest_uuid: n.uuid, status: 'aceptada', link_method: method, link_meters: meters != null ? Math.round(meters * 100) / 100 : null },
        'Enlazada al nido ' + n.number, extra);
    });
    return h('div',
      h('p', h('b', 'Ya registrado')),
      cands.length
        ? h('div.cands', cands.map((c) => h('div.cand',
          h('div', h('b', 'Nido ' + c.nest.number), h('small', c.meters.toFixed(1) + ' m · detectado ' + showDate(c.nest.detected_date)
            + ' (' + (c.days === 0 ? 'mismo día' : Math.abs(c.days) + ' días ' + (c.days > 0 ? 'antes' : 'después')) + ') · ' + statusName(c.nest.status))),
          h('div.row-btns',
            h('button.btn.ghost.small', { type: 'button', onclick: () => preview(m, c) }, 'Ver'),
            h('button.btn.primary.small', { type: 'button', onclick: (e) => linkTo(c.nest, 'propuesta', c.meters, e.currentTarget) }, 'Es este')))))
        : h('p.muted', 'Ningún nido registrado cumple la regla de cercanía (' + (settings.match_meters || 5) + ' m, misma temporada, de '
          + (settings.match_days_before ?? 7) + ' días antes a ' + (settings.match_days ?? 30) + ' después).'),
      h('div.row-btns', manual, h('button.btn.ghost.small', { type: 'button', onclick: (e) => {
        const n = manual.value && store.nest(manual.value);
        if (!n) { toast('Elige el nido', 'error'); return; }
        const p = nestPosition(n);
        linkTo(n, 'manual', p && m.lat != null ? distance(m.lat, m.lon, p[0], p[1]) : null, e.currentTarget);
      } }, 'Enlazar')),
      h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => { mode = 'acciones'; renderSide(); } }, 'Cancelar')));
  }

  /** Vista breve: la máscara nueva junto a la imagen registrada del nido, como «Ver nido N» de la app. */
  function preview(m, c) {
    const n = c.nest;
    const nm = store.masksOf(n.uuid).find((x) => x.crop_size || (store.aerial(x.aerial_uuid) || {}).file_size);
    const photo = store.photosOf(n.uuid).find((p) => p.file_size);
    const right = nm ? maskImage(nm) : photo ? photoImage(photo) : h('div.ph', 'El nido no tiene imagen');
    let dlg;
    const ok = h('button.btn.primary', { type: 'button', onclick: async () => {
      dlg.close();
      const extra = [];
      if (n.photo_lat == null && m.lat != null) extra.push({ ...rowOf(n, NEST_COLS), photo_lat: m.lat, photo_lon: m.lon, updated_at: stampAfter(n.updated_at) });
      try {
        await saveMask(m, { nest_uuid: n.uuid, status: 'aceptada', link_method: 'propuesta', link_meters: Math.round(c.meters * 100) / 100 }, 'Enlazada al nido ' + n.number, extra);
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Es este nido');
    dlg = modal('¿Es el nido ' + n.number + '?', h('div.compare',
      h('div.compare-grid',
        h('figure', maskImage(m), h('figcaption', 'Propuesta · ' + showDate(photoDate(current())))),
        h('figure', right, h('figcaption', 'Nido ' + n.number + ' registrado'))),
      h('div.kv', h('span', h('b', 'Distancia: '), c.meters.toFixed(1) + ' m'), h('span', h('b', 'Detectado: '), showDate(n.detected_date)),
        h('span', h('b', 'Especie: '), speciesName(n.species)), h('span', h('b', 'Estado: '), statusName(n.status)), h('span', h('b', 'Playa: '), n.beach || '—')),
      h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => dlg.close() }, 'No es'), ok)), { wide: true });
  }

  /** Imagen de una máscara: su recorte a resolución original o, si no hay, la zona de la foto reducida. */
  function maskImage(mk) {
    const box = h('div.mask-img', h('p.muted', 'Cargando…'));
    const a = store.aerial(mk.aerial_uuid);
    (async () => {
      const [x0, y0, x1, y1] = bbox(mk.polygon);
      // Imagen, su tamaño, la zona que se muestra y cómo pasar de píxeles de la foto original a la imagen.
      let url = null, iw, ih, vb, scale, ox = 0, oy = 0;
      if (mk.crop_size && mk.crop_x != null) {
        url = await api.image('crop', mk.uuid);
        if (url) {
          const probe = new Image();
          probe.src = url;
          await new Promise((r) => { probe.onload = r; probe.onerror = r; });
          iw = probe.naturalWidth; ih = probe.naturalHeight;
          vb = [0, 0, iw, ih];
          scale = 1 / (mk.crop_sample || 1); ox = mk.crop_x; oy = mk.crop_y;
        }
      }
      if (!url && a && a.file_size) {
        url = await api.image('aerial', a.uuid);
        iw = a.thumb_w || 1280;
        ih = a.thumb_h || Math.round(iw * a.height_px / a.width);
        scale = iw / a.width;
        const side = Math.max(160, Math.max(x1 - x0, y1 - y0) * scale * 4);
        vb = [((x0 + x1) / 2) * scale - side / 2, ((y0 + y1) / 2) * scale - side / 2, side, side];
      }
      if (!url) { box.replaceChildren(h('div.ph', 'Sin imagen')); return; }
      const sv = document.createElementNS(SVG, 'svg');
      sv.setAttribute('viewBox', vb.join(' '));
      const im = document.createElementNS(SVG, 'image');
      im.setAttribute('href', url);
      im.setAttribute('width', iw);
      im.setAttribute('height', ih);
      const poly = document.createElementNS(SVG, 'polygon');
      const pts = [];
      for (let j = 0; j + 1 < mk.polygon.length; j += 2) pts.push(((mk.polygon[j] - ox) * scale).toFixed(1) + ',' + ((mk.polygon[j + 1] - oy) * scale).toFixed(1));
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('class', 'mine');
      poly.style.strokeWidth = (vb[2] / 250).toFixed(2) + 'px';
      sv.append(im, poly);
      box.replaceChildren(sv);
    })();
    return box;
  }

  function photoImage(p) {
    const box = h('div.mask-img', h('p.muted', 'Cargando…'));
    api.image('photo', p.uuid).then((url) => box.replaceChildren(url ? h('img', { src: url, alt: '' }) : h('div.ph', 'Sin imagen')));
    return box;
  }

  // ───────────────────────────── ajustar contorno (como en LabelNef)

  function startEdit(m) {
    edit = { id: selected === 'draft' ? 'draft' : m.uuid, points: m.polygon.slice(), undo: [], vsel: -1 };
    mode = 'editar';
    drawMasks();
    renderSide();
  }

  function editBox(m) {
    const n = edit.points.length / 2;
    const gn = edit.id !== 'draft' && m.gnest_polygon;
    return h('div',
      h('p', h('b', 'Ajustar contorno')),
      h('ul.edit-help',
        h('li', 'Arrastra un punto para moverlo; toca un borde para agregar uno.'),
        h('li', 'Arrastra dentro de la máscara para trasladarla.'),
        h('li', 'Esquinas: agrandar o achicar · círculo de arriba: girar.')),
      h('div.row-btns',
        h('button.btn.ghost.small', { type: 'button', disabled: edit.vsel < 0 || n <= 3, onclick: removeVertex }, 'Quitar el punto elegido'),
        h('button.btn.ghost.small', { type: 'button', disabled: !edit.undo.length, onclick: undoEdit }, 'Deshacer'),
        gn ? h('button.btn.ghost.small', { type: 'button', onclick: () => { edit.undo.push(edit.points.slice()); edit.points = m.gnest_polygon.slice(); edit.vsel = -1; drawMasks(); renderSide(); } }, 'Volver al de GNeST') : null),
      h('p.hint', n + ' puntos · teclas: Supr quita el punto, Ctrl+Z deshace, Esc cancela'),
      h('div.actions',
        h('button.btn.ghost', { type: 'button', onclick: cancelEdit }, 'Cancelar'),
        h('button.btn.primary', { type: 'button', onclick: (e) => busy(e.currentTarget, saveEdit) }, 'Guardar contorno')));
  }

  function removeVertex() {
    if (!edit || edit.vsel < 0 || edit.points.length <= 6) return;
    edit.undo.push(edit.points.slice());
    edit.points.splice(edit.vsel * 2, 2);
    edit.vsel = -1;
    drawMasks();
    renderSide();
  }

  function undoEdit() {
    if (!edit || !edit.undo.length) return;
    edit.points = edit.undo.pop();
    edit.vsel = -1;
    drawMasks();
    renderSide();
  }

  function cancelEdit() {
    edit = null;
    mode = 'acciones';
    drawMasks();
    renderSide();
  }

  async function saveEdit() {
    const m = currentMask();
    const poly = edit.points.slice();
    const [x0, y0, x1, y1] = bbox(poly);
    const cx = Math.round((x0 + x1) / 2 * 100) / 100, cy = Math.round((y0 + y1) / 2 * 100) / 100;
    const fp = footprint(store.aerial(m.aerial_uuid) || current());
    const [lat, lon] = fp ? fp.toLatLon(cx, cy) : [m.lat, m.lon];
    if (edit.id === 'draft') {
      Object.assign(draft, { polygon: poly, points: poly, cx, cy, lat, lon });
      cancelEdit();
      return;
    }
    const changes = { polygon: poly, cx, cy, lat, lon };
    // La primera vez que se ajusta una propuesta de GNeST se guarda la original (para medir el modelo).
    if (!m.gnest_polygon && String(m.source || '').startsWith('gnest')) changes.gnest_polygon = m.polygon;
    const extra = [];
    const nest = m.nest_uuid && store.nest(m.nest_uuid);
    // La coordenada desde imagen aérea del nido es el centro de su máscara: si venía de esta, se actualiza.
    if (nest && nest.photo_lat != null && m.lat != null && Math.abs(nest.photo_lat - m.lat) < 1e-6 && Math.abs(nest.photo_lon - m.lon) < 1e-6) {
      extra.push({ ...rowOf(nest, NEST_COLS), photo_lat: lat, photo_lon: lon, updated_at: stampAfter(nest.updated_at) });
    }
    await saveMask(m, changes, 'Contorno guardado', extra, { stay: true });
    edit = null;
  }

  // ───────────────────────────── dibujar

  function startDrawing() {
    edit = null;
    selected = null;
    mode = 'dibujar';
    draft = { points: [], done: false };
    drawMasks();
    renderSide();
  }

  function drawBox() {
    const n = draft ? draft.points.length / 2 : 0;
    return h('div',
      h('p', h('b', 'Dibujar un nido')),
      h('p.hint', 'Toca la foto alrededor del nido para marcar su contorno (acerca la foto para más precisión). Puntos: ' + n),
      h('div.row-btns',
        h('button.btn.ghost.small', { type: 'button', disabled: !n, onclick: () => { draft.points.splice(-2, 2); drawMasks(); renderSide(); } }, 'Quitar el último punto'),
        h('button.btn.ghost.small', { type: 'button', onclick: cancelDraft }, 'Cancelar'),
        h('button.btn.primary.small', { type: 'button', disabled: n < 3, onclick: finishDrawing }, 'Terminar')));
  }

  function finishDrawing() {
    const a = current();
    const poly = draft.points.slice();
    const [x0, y0, x1, y1] = bbox(poly);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fp = footprint(a);
    const ll = fp ? fp.toLatLon(cx, cy) : [null, null];
    draft = { uuid: crypto.randomUUID(), aerial_uuid: a.uuid, polygon: poly, points: poly, done: true, cx: Math.round(cx * 100) / 100,
      cy: Math.round(cy * 100) / 100, lat: ll[0], lon: ll[1], source: 'experto', score: null, status: 'propuesta', ann_index: null };
    selected = 'draft';
    mode = 'acciones';
    drawMasks();
    renderSide();
  }

  function cancelDraft() {
    draft = null;
    selected = null;
    mode = 'acciones';
    drawMasks();
    renderSide();
  }

  // ───────────────────────────── guardar

  async function saveMask(m, changes, message, nests = [], opts = {}) {
    if (locked()) throw new Error('El vuelo está en revisión en ValiNest');
    const isDraft = m === draft;
    const row = { ...rowOf(m, MASK_COLS), ...changes, updated_at: stampAfter(m.updated_at) };
    if (isDraft) row.created_at = row.updated_at;
    const res = await store.save({ nest: nests, mask: [row] }, user.id);
    if (res.rechazados && res.rechazados.length) throw new Error('No se guardó: ' + res.rechazados[0].razon);
    if (res.ignorados && res.ignorados.length) throw new Error('No se guardó: alguien más lo cambió. Vuelve a abrir el vuelo.');
    toast(message);
    const resolvedId = isDraft ? row.uuid : m.uuid;
    if (opts.stay) {
      // Contorno ajustado: se queda en la misma máscara.
      edit = null;
      mode = 'acciones';
      selected = resolvedId;
      renderHead();
      drawMasks();
      renderSide();
      return;
    }
    draft = null;
    mode = 'acciones';
    // Siguiente propuesta: en esta foto o en la siguiente que tenga.
    const a = current();
    const next = photoMasks(a).find((x) => x.status === 'propuesta' && x.uuid !== resolvedId);
    renderHead();
    if (next) { select_(next.uuid); return; }
    if (changes.status === 'propuesta') { select_(resolvedId); return; }
    const j = photos.findIndex((p, idx) => idx > pi && pendingOf(p) > 0);
    const any = j >= 0 ? j : photos.findIndex((p) => pendingOf(p) > 0);
    if (any >= 0 && any !== pi) {
      const first = photoMasks(photos[any]).find((x) => x.status === 'propuesta');
      selected = first ? first.uuid : null;
      showPhoto(any, true);
      return;
    }
    selected = resolvedId;
    drawMasks();
    renderSide();
    if (!flightMasks().some((x) => x.status === 'propuesta')) toast('¡Listo! Ya no quedan propuestas: el vuelo quedó revisado.');
  }

  const onKey = (e) => {
    if (!el.isConnected || e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
    if (mode === 'editar') {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeVertex(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoEdit(); }
      if (e.key === 'Escape') cancelEdit();
      return;
    }
    if (e.key === 'ArrowRight') showPhoto(pi + 1);
    if (e.key === 'ArrowLeft') showPhoto(pi - 1);
  };
  document.addEventListener('keydown', onKey);

  return {
    el,
    show() {
      loadPhotos();
      renderHead();
      if (!photos.length) { clear(stage); clear(side).append(h('p.muted', 'Este vuelo todavía no tiene fotos en la nube.')); return; }
      const first = photos.findIndex((p) => pendingOf(p) > 0);
      if (!layer) {
        // Se abre en la primera propuesta por revisar, ya elegida.
        const m = first >= 0 ? photoMasks(photos[first]).find((x) => x.status === 'propuesta') : null;
        selected = m ? m.uuid : null;
        showPhoto(first >= 0 ? first : 0, true);
      }
      else { renderSide(); drawMasks(); }
    },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}
