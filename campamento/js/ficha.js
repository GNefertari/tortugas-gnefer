// Ficha de un nido (solo consulta), como NestViewActivity de la app.

import { actionText, can, speciesName, statusColor, statusName } from './catalog.js';
import * as Coords from './coords.js';
import { distance } from './geo.js';
import { cleaningForm, deleteNest, nestForm } from './formularios.js';
import { coordFormat } from './prefs.js';
import { openAerialViewer } from './visor.js';
import { confirmBox, h, modal, showDate, showDateTime } from './ui.js';

export function openNest(ctx, uuid) {
  const { store, user } = ctx;
  const n = store.nest(uuid);
  if (!n || n.deleted) return;
  const s = store.settings || {};
  const zone = s.utm_zone || 16;
  const k = store.cleaningOf(n.uuid);
  const masks = store.masksOf(n.uuid);
  const photos = store.photosOf(n.uuid);

  const row = (label, value) => h('div.row', h('span.k', label), h('span.v', value ?? '—'));
  // El formato elegido en "Mi cuenta → Formato de coordenadas" va primero; los otros, plegados.
  const fmt = coordFormat();
  const coordBlock = (title, lat, lon, extra) => lat == null ? row(title, 'sin coordenada') : h('div.coord',
    h('div.k', title),
    h('div.v.main', Coords.format(lat, lon, fmt, zone)),
    extra ? h('div.hint', extra) : null,
    h('details.other-formats', h('summary', 'Otros formatos'),
      Coords.FORMATS.filter(([f]) => f !== fmt).map(([f]) => h('div.v', Coords.format(lat, lon, f, zone)))));

  const statusNote = n.status_override ? ' (fijado por el experto)' : k ? ' (tiene limpieza)' : ' (sin limpieza)';
  let m;
  const body = h('div.ficha',
    h('div.chip', { style: { background: statusColor(n.status) } }, statusName(n.status)),
    h('div.grid2',
      h('div',
        row('Temporada', n.season),
        row('Fecha de detección', showDate(n.detected_date)),
        row('Especie', speciesName(n.species)),
        row('Estado', statusName(n.status) + statusNote),
        row('Playa', n.beach),
        row('Zona', n.zone),
        row('Acción', actionText(n.action)),
        row('Fecha de eclosión', showDate(n.hatch_date) + (n.hatch_date ? (n.hatch_manual ? ' (puesta por el experto)' : ' (estimada)') : '')),
      ),
      h('div',
        coordBlock('Coordenada real', n.real_lat, n.real_lon,
          n.real_lat != null ? (n.real_source === 'gps' ? 'GPS del equipo' : 'escrita a mano') + (n.real_acc ? ' · ±' + Math.round(n.real_acc) + ' m' : '') : null),
        coordBlock('Desde imagen aérea', n.photo_lat, n.photo_lon,
          n.photo_lat != null && n.real_lat != null ? 'a ' + distance(n.real_lat, n.real_lon, n.photo_lat, n.photo_lon).toFixed(1) + ' m de la real' : null),
      )),
    (n.turtle_lt || n.turtle_lc || n.turtle_ac || n.turtle_notes) ? h('div.block', h('h3', 'Tortuga'),
      row('Largo total', n.turtle_lt != null ? n.turtle_lt + ' cm' : null),
      row('Largo curvo', n.turtle_lc != null ? n.turtle_lc + ' cm' : null),
      row('Ancho curvo', n.turtle_ac != null ? n.turtle_ac + ' cm' : null),
      n.turtle_notes ? h('p.notes', n.turtle_notes) : null) : null,
    h('div.block', h('h3', 'Limpieza'), k ? cleaningDetail(k) : h('p.muted', 'Sin limpieza registrada.'),
      can(user, 'capturista') ? h('button.btn.small', { type: 'button', onclick: () => { m.close(); cleaningForm(ctx, n.uuid); } },
        k ? 'Editar limpieza' : 'Registrar limpieza') : null),
    h('div.block', h('h3', 'Imágenes aéreas (' + masks.length + ')'),
      masks.length ? [
        h('p.hint', 'Toca una imagen para ver la foto de dron completa y los alrededores del nido.'),
        thumbs(ctx, masks.map((x, i) => ['crop', x.uuid, x.crop_size, store.aerial(x.aerial_uuid)?.file_name,
          // Abre esa foto; con ◀ / ▶ se pasa a las demás donde aparece el nido.
          () => openAerialViewer(ctx, masks.map((y) => ({ aerial: y.aerial_uuid, mask: y.uuid })), i)])),
      ] : h('p.muted', 'Sin imágenes aéreas.')),
    h('div.block', h('h3', 'Fotos de campo (' + photos.length + ')'),
      photos.length ? thumbs(ctx, photos.map((p) => ['photo', p.uuid, p.file_size, null, null])) : h('p.muted', 'Sin fotos de campo.')),
    n.notes ? h('div.block', h('h3', 'Notas'), h('p.notes', n.notes)) : null,
    h('p.meta', 'Registró: ' + (n.observer || '—') + ' · creado ' + showDateTime(n.created_at)),
    // Quién hizo el último cambio: solo para el coordinador.
    can(user, 'coordinador') ? h('p.meta', 'Último cambio: ' + showDateTime(n.updated_at) + ' por '
      + (store.userName(n.user_id) || 'desconocido')
      + (n.device_id === 'web' ? ' (desde la web)' : n.device_id ? ' (desde un equipo)' : '')) : null,
    h('div.actions',
      (n.real_lat != null || n.photo_lat != null) ? h('button.btn.ghost', { type: 'button', onclick: () => { m.close(); ctx.showOnMap(n); } }, 'Ver en mapa') : null,
      can(user, 'capturista') ? h('button.btn.primary', { type: 'button', onclick: () => { m.close(); nestForm(ctx, n.uuid); } }, 'Editar') : null,
      can(user, 'experto') ? h('button.btn.danger', { type: 'button', onclick: async () => {
        if (await confirmBox('Eliminar nido', '¿Eliminar el nido ' + n.number + ' de la temporada ' + (n.season || '') + '? Se borra en todos los equipos al sincronizar.', 'Eliminar', true)) {
          m.close();
          deleteNest(ctx, n);
        }
      } }, 'Eliminar') : null),
  );
  m = modal('Nido ' + n.number + (n.season ? ' · temporada ' + n.season : ''), body, { wide: true });
}

export function cleaningDetail(k) {
  const parts = [
    ['Fecha', showDate(k.clean_date)],
    ['Cascarones', k.shells], ['Vivas', k.alive], ['Muertas', k.dead], ['Rosa', k.pink],
  ];
  if (k.phase_mode === 'detalle') {
    parts.push(['Fase 1', k.phase1], ['Fase 2', k.phase2], ['Fase 3', k.phase3], ['Fase (total)', k.phase_total]);
  } else {
    parts.push(['Fase', k.phase_total]);
  }
  return h('div',
    h('div.kv', parts.map(([a, b]) => h('span', h('b', a + ': '), b ?? '—'))),
    k.notes ? h('p.notes', k.notes) : null,
    h('p.meta', 'Registró: ' + (k.observer || '—')));
}

function thumbs(ctx, items) {
  return h('div.thumbs', items.map(([kind, uuid, size, caption, onOpen]) => {
    const box = h('figure.thumb', h('div.ph', size ? 'Cargando…' : 'Imagen no subida todavía'), caption ? h('figcaption', caption) : null);
    if (size) {
      ctx.api.image(kind, uuid).then((url) => {
        const ph = box.querySelector('.ph');
        if (!url) { ph.textContent = 'No se pudo cargar'; return; }
        const img = h('img', { src: url, alt: caption || '', loading: 'lazy' });
        img.addEventListener('click', onOpen || (() => modal(caption || 'Imagen', h('img.full', { src: url, alt: '' }), { wide: true })));
        ph.replaceWith(img);
      });
    }
    return box;
  }));
}
