// Mapa: nidos con color por estado (igual que la app), filtros y, al acercarse, las fotos de dron
// colocadas y giradas sobre su huella en el suelo, con las máscaras encima.
// Usa Leaflet (variable global L, cargada en index.html).

import { STATUS, statusColor, statusName, speciesName } from './catalog.js';
import { footprint } from './geo.js';
import { openAerialViewer } from './visor.js';
import { clear, h, showDate } from './ui.js';

const COZUMEL = [20.42, -86.92];
const AERIAL_MIN_ZOOM = 17;      // las fotos de dron solo se piden de cerca

/**
 * Imagen colocada con tres esquinas (arriba-izq, arriba-der, abajo-izq), para fotos giradas.
 * Leaflet solo trae imágenes alineadas al norte; esta capa usa una transformación CSS.
 */
const RotatedImage = L.Layer.extend({
  initialize(url, corners, opacity) {
    this._url = url;
    this._corners = corners.map((c) => L.latLng(c));
    this._opacity = opacity;
  },
  onAdd(map) {
    this._img = L.DomUtil.create('img', 'aerial-img leaflet-zoom-hide');
    this._img.src = this._url;
    this._img.style.opacity = this._opacity;
    this._img.onload = () => this._reset();
    (map.getPane('aerials') || map.getPanes().overlayPane).appendChild(this._img);
    map.on('zoomend viewreset moveend', this._reset, this);
    this._reset();
  },
  onRemove(map) {
    L.DomUtil.remove(this._img);
    map.off('zoomend viewreset moveend', this._reset, this);
  },
  _reset() {
    const img = this._img;
    if (!img || !img.naturalWidth) return;
    const [tl, tr, bl] = this._corners.map((c) => this._map.latLngToLayerPoint(c));
    const w = img.naturalWidth, hgt = img.naturalHeight;
    img.style.transformOrigin = '0 0';
    img.style.transform = `matrix(${(tr.x - tl.x) / w}, ${(tr.y - tl.y) / w}, ${(bl.x - tl.x) / hgt}, ${(bl.y - tl.y) / hgt}, ${tl.x}, ${tl.y})`;
  },
});

export function mapView(ctx) {
  const { store, filter, api } = ctx;
  const el = h('section.view.map-view');
  const mapEl = h('div.map');
  const top = h('div.map-top');
  const legend = h('div.legend', STATUS.map(([code, name, color]) => h('span', h('i', { style: { background: color } }), name)));
  const count = h('span.count');
  const aerialToggle = h('input', { type: 'checkbox', checked: localStorage.getItem('fotosDron') !== '0' });
  // Fotos de dron y máscaras: se prenden o apagan en el panel de filtros (como «Imágenes aéreas en el mapa» de la app).
  const aerialLabel = h('label.check', aerialToggle, 'Fotos de dron y máscaras');
  el.append(top, mapEl, h('div.map-bottom', legend, count));

  const map = L.map(mapEl, { zoomControl: true, preferCanvas: true, maxZoom: 22 }).setView(COZUMEL, 11);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    // En Cozumel Esri no tiene imagen más cercana que el nivel 18 (más cerca muestra "Map data not
    // yet available"); de ahí en adelante se amplía la del 18. El detalle lo dan las fotos de dron.
    maxNativeZoom: 18, maxZoom: 22, attribution: 'Imagen © Esri, Maxar, Earthstar Geographics',
  });
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap',
  });
  // Las fotos de dron van debajo de los nidos y las máscaras (overlayPane = 400).
  map.createPane('aerials').style.zIndex = 350;
  sat.addTo(map);
  L.control.layers({ 'Satélite': sat, 'Calles': streets }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const nestLayer = L.layerGroup().addTo(map);
  const aerialLayer = L.layerGroup().addTo(map);
  const maskLayer = L.layerGroup().addTo(map);
  const shownAerials = new Map();   // uuid -> capa
  let fitted = false;

  function drawNests() {
    nestLayer.clearLayers();
    const list = store.nests().filter(filter.matches);
    const pts = [];
    for (const n of list) {
      const ll = position(n);
      if (!ll) continue;
      pts.push(ll);
      const m = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 1.5, fillColor: statusColor(n.status), fillOpacity: 0.95, bubblingMouseEvents: false });
      m.bindTooltip('Nido ' + n.number + ' · ' + statusName(n.status), { direction: 'top', offset: [0, -6] });
      m.on('click', () => ctx.openNest(n.uuid));
      m.addTo(nestLayer);
    }
    const noCoord = list.length - pts.length;
    count.textContent = list.length + ' nido(s)' + (filter.active() ? ' con el filtro' : '') + (noCoord ? ' · ' + noCoord + ' sin coordenada' : '');
    if (!fitted && pts.length && map.getSize().x > 0) {
      map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 17 });
      fitted = true;
    }
  }

  // Fotos de dron y máscaras: solo de cerca, solo las que están a la vista.
  async function drawAerials() {
    const want = aerialToggle.checked && map.getZoom() >= AERIAL_MIN_ZOOM;
    if (!want) {
      aerialLayer.clearLayers();
      maskLayer.clearLayers();
      shownAerials.clear();
      return;
    }
    const view = map.getBounds().pad(0.3);
    // Con filtro, como en la app: solo las máscaras de los nidos que se ven y las fotos donde aparecen.
    const nestShown = (uuid) => { const n = store.nest(uuid); return !!n && !n.deleted && filter.matches(n); };
    const masks = store.masks().filter((x) => x.nest_uuid && (!filter.active() || nestShown(x.nest_uuid)));
    const allowed = filter.active() ? new Set(masks.map((x) => x.aerial_uuid)) : null;
    for (const a of store.aerials()) {
      if (shownAerials.has(a.uuid) || !a.file_size || (allowed && !allowed.has(a.uuid))) continue;
      const fp = footprint(a);
      if (!fp || !view.intersects(L.latLngBounds([fp.topLeft, fp.topRight, fp.bottomLeft, fp.bottomRight]))) continue;
      shownAerials.set(a.uuid, null);
      const url = await api.image('aerial', a.uuid);
      if (!url || !map.hasLayer(aerialLayer)) continue;
      const layer = new RotatedImage(url, [fp.topLeft, fp.topRight, fp.bottomLeft], 0.92);
      shownAerials.set(a.uuid, layer);
      aerialLayer.addLayer(layer);
    }
    maskLayer.clearLayers();
    for (const m of masks) {   // las propuestas sin revisar solo se ven en la bandeja
      const a = store.aerial(m.aerial_uuid);
      const fp = a && footprint(a);
      if (!fp || !m.polygon) continue;
      const pts = [];
      for (let i = 0; i + 1 < m.polygon.length; i += 2) pts.push(fp.toLatLon(m.polygon[i], m.polygon[i + 1]));
      if (!view.intersects(L.latLngBounds(pts))) continue;
      const poly = L.polygon(pts, { color: '#FFEB3B', weight: 2, fill: false, interactive: !!m.nest_uuid, bubblingMouseEvents: false });
      if (m.nest_uuid) poly.on('click', () => ctx.openNest(m.nest_uuid));
      maskLayer.addLayer(poly);
    }
    nestLayer.eachLayer((l) => l.bringToFront && l.bringToFront());
  }

  aerialToggle.addEventListener('change', () => {
    try { localStorage.setItem('fotosDron', aerialToggle.checked ? '1' : '0'); } catch { /* sin almacenamiento */ }
    drawAerials();
  });
  map.on('moveend zoomend', drawAerials);

  // Tocar una foto de dron (fuera de un nido) la abre completa, con todos sus nidos. Si ahí se
  // enciman varias fotos, en el visor se pasa de una a otra.
  map.on('click', (e) => {
    if (!aerialToggle.checked || map.getZoom() < AERIAL_MIN_ZOOM) return;
    const hits = [];
    for (const [uuid, layer] of shownAerials) {
      if (!layer) continue;
      const fp = footprint(store.aerial(uuid));
      if (fp && inside([e.latlng.lat, e.latlng.lng], [fp.topLeft, fp.topRight, fp.bottomRight, fp.bottomLeft])) {
        hits.push({ aerial: uuid, mask: null });
      }
    }
    if (hits.length) openAerialViewer(ctx, hits.reverse(), 0);
  });

  // En celular los filtros van plegados detrás de un botón.
  const toggle = h('button.btn.small.filters-toggle', { type: 'button', onclick: () => top.classList.toggle('open') });
  function refreshTop() {
    toggle.textContent = filter.active() ? 'Filtros (activos) ▾' : 'Filtros ▾';
    const controls = filter.controls(store, { withText: false });
    controls.append(aerialLabel);
    clear(top).append(toggle, controls);
  }

  const offStore = store.onChange(() => { refreshTop(); drawNests(); drawAerials(); });
  const offFilter = filter.onChange(() => {
    refreshTop();
    drawNests();
    aerialLayer.clearLayers();      // otras fotos según el filtro nuevo
    shownAerials.clear();
    drawAerials();
  });

  return {
    el,
    show() {
      refreshTop();
      drawNests();
      setTimeout(() => { map.invalidateSize(); if (!fitted) drawNests(); drawAerials(); }, 50);
    },
    focus(n) {
      const ll = position(n);
      if (ll) map.setView(ll, 19);
    },
    destroy() { offStore(); offFilter(); map.remove(); },
  };
}

/** ¿El punto [lat, lon] cae dentro del polígono? (suficiente para la huella de una foto) */
function inside(p, poly) {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/** Punto en el mapa: la coordenada real; si no hay, la de la imagen aérea (igual que la app). */
export function position(n) {
  if (n.real_lat != null && n.real_lon != null) return [n.real_lat, n.real_lon];
  if (n.photo_lat != null && n.photo_lon != null) return [n.photo_lat, n.photo_lon];
  return null;
}

export function nestSummary(n) {
  return [speciesName(n.species), statusName(n.status), n.beach || 'sin playa', showDate(n.detected_date)].join(' · ');
}
