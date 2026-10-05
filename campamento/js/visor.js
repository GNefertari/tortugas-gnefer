// Visor de fotos de dron completas (como AerialActivity de la app): la imagen reducida con las
// máscaras y los números de todos sus nidos; se acerca con la rueda, los botones o pellizcando,
// y se arrastra para ver los alrededores. Con varias fotos, ◀ / ▶ pasa a la otra sin cerrar.
//
//   openAerialViewer(ctx, [{ aerial, mask }], i)
//     aerial = uuid de la foto; mask = uuid de la máscara a resaltar (o null); i = la que se abre

import { h, modal } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';

export function openAerialViewer(ctx, items, start = 0) {
  const { store, api } = ctx;
  items = items.filter((it) => store.aerial(it.aerial));
  if (!items.length) return;
  let index = Math.min(Math.max(0, start), items.length - 1);

  const stage = h('div.viewer-stage');
  const zoomLabel = h('span.zoom-label');
  const counter = h('span.viewer-count');
  const prev = h('button.btn.ghost.small', { type: 'button', onclick: () => show(index - 1) }, '◀ Anterior');
  const next = h('button.btn.ghost.small', { type: 'button', onclick: () => show(index + 1) }, 'Siguiente ▶');
  const goNest = h('button.btn.ghost.small', { type: 'button', onclick: () => focusMask() }, 'Ir al nido');
  const caption = h('div.viewer-caption');
  const bar = h('div.viewer-bar',
    items.length > 1 ? [prev, counter, next, h('span.sep')] : null,
    h('button.btn.ghost.small', { type: 'button', onclick: () => zoomBy(1 / 1.5) }, '−'),
    zoomLabel,
    h('button.btn.ghost.small', { type: 'button', onclick: () => zoomBy(1.5) }, '+'),
    h('button.btn.ghost.small', { type: 'button', onclick: () => fit() }, 'Ver completa'),
    goNest);
  const m = modal('Foto de dron', h('div.viewer', bar, stage, caption,
    h('p.hint', 'Rueda o pellizco para acercar · arrastra para moverte · toca un número para abrir su nido')), { wide: true });
  const title = m.el.querySelector('.modal-head h2');

  // Estado de la foto que se ve.
  let layer = null, svg = null, W = 1, H = 1, target = null;
  let s = 1, tx = 0, ty = 0, minS = 0.1;
  let token = 0;

  async function show(i) {
    index = (i + items.length) % items.length;
    const it = items[index];
    const a = store.aerial(it.aerial);
    const my = ++token;
    title.textContent = 'Foto de dron · ' + a.file_name;
    counter.textContent = 'Foto ' + (index + 1) + ' de ' + items.length;
    goNest.style.display = it.mask ? '' : 'none';
    stage.replaceChildren(h('p.muted', 'Cargando la foto…'));
    const nests = store.masks().filter((x) => x.aerial_uuid === a.uuid && x.nest_uuid)
      .map((x) => store.nest(x.nest_uuid)).filter((n) => n && !n.deleted);
    caption.textContent = (a.taken_at ? 'Tomada el ' + a.taken_at.slice(0, 10).split('-').reverse().join('/') + ' · ' : '')
      + (nests.length ? 'Nidos en esta foto: ' + [...new Set(nests.map((n) => n.number))].join(', ') : 'Sin nidos enlazados');

    const url = await api.image('aerial', a.uuid);
    if (my !== token) return;   // se pasó a otra foto mientras cargaba
    if (!url) { stage.replaceChildren(h('p.muted', 'Esta foto todavía no se ha subido.')); return; }
    const img = h('img', { src: url, alt: a.file_name, draggable: false });
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    if (my !== token) return;
    W = img.naturalWidth; H = img.naturalHeight;
    const k = W / a.width;   // píxeles de la foto original -> píxeles de la reducida

    svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'viewer-masks');
    target = null;
    for (const mk of store.masks().filter((x) => x.aerial_uuid === a.uuid && x.nest_uuid && store.nest(x.nest_uuid) && !store.nest(x.nest_uuid).deleted)) {
      if (!mk.polygon) continue;
      const pts = [];
      for (let j = 0; j + 1 < mk.polygon.length; j += 2) pts.push((mk.polygon[j] * k).toFixed(1) + ',' + (mk.polygon[j + 1] * k).toFixed(1));
      const mine = mk.uuid === it.mask;
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('class', mine ? 'mine' : '');
      svg.append(poly);
      const nest = mk.nest_uuid && store.nest(mk.nest_uuid);
      if (nest && !nest.deleted) {
        const label = document.createElementNS(SVG, 'text');
        label.setAttribute('x', (mk.cx * k).toFixed(1));
        label.setAttribute('y', (Math.min(...mk.polygon.filter((_, j) => j % 2)) * k - 6).toFixed(1));
        label.setAttribute('class', mine ? 'mine' : '');
        label.textContent = nest.number;
        label.addEventListener('click', () => { m.close(); ctx.openNest(nest.uuid); });
        svg.append(label);
      }
      if (mine) target = { x: mk.cx * k, y: mk.cy * k };
    }
    layer = h('div.viewer-layer', { style: { width: W + 'px', height: H + 'px' } }, img, svg);
    stage.replaceChildren(layer);
    fit();
    if (target) focusMask();
  }

  const apply = () => {
    if (!layer) return;
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    svg.style.setProperty('--stroke', (2 / s).toFixed(2) + 'px');
    svg.style.setProperty('--label', (14 / Math.sqrt(s)).toFixed(1) + 'px');
    zoomLabel.textContent = Math.round(s * 100) + ' %';
  };
  function fit() {
    const r = stage.getBoundingClientRect();
    s = minS = Math.min(r.width / W, r.height / H);
    tx = (r.width - W * s) / 2;
    ty = (r.height - H * s) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(8, Math.max(minS, s * f));
    tx = cx - (cx - tx) * (ns / s);
    ty = cy - (cy - ty) * (ns / s);
    s = ns;
    apply();
  }
  function zoomBy(f) {
    const r = stage.getBoundingClientRect();
    zoomAt(f, r.width / 2, r.height / 2);
  }
  function focusMask() {
    if (!target) return;
    const r = stage.getBoundingClientRect();
    s = Math.max(minS, Math.min(8, Math.min(r.width, r.height) / 250));
    tx = r.width / 2 - target.x * s;
    ty = r.height / 2 - target.y * s;
    apply();
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Arrastrar con mouse o un dedo; pellizcar con dos dedos. Un toque sin arrastre deja pasar el
  // clic (para abrir un nido desde su número).
  const pointers = new Map();
  let last = null, moved = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'text') return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
    moved = 0;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    if (pointers.size === 1) {
      tx += e.clientX - p.x;
      ty += e.clientY - p.y;
      apply();
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const r = stage.getBoundingClientRect();
      if (last) zoomAt(d / last, (p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top);
      last = d;
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); last = null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  m.el.addEventListener('keydown', (e) => {
    if (items.length > 1 && e.key === 'ArrowRight') show(index + 1);
    if (items.length > 1 && e.key === 'ArrowLeft') show(index - 1);
  });

  requestAnimationFrame(() => show(index));
}
