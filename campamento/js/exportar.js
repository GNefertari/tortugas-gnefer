// Exportar lo filtrado a CSV (Excel) y KML (Google Earth / QGIS), como la app.

import { speciesName, statusColor, statusName } from './catalog.js';
import * as Coords from './coords.js';
import { position } from './mapa.js';
import { downloadText, todayIso } from './ui.js';

function csv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // BOM para que Excel reconozca los acentos.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const fixed = (v, d) => (v == null ? null : Number(v).toFixed(d));

export function exportNestsCsv(ctx, list) {
  const { store } = ctx;
  const zone = store.settings?.utm_zone || 16;
  const coords = (lat, lon) => {
    if (lat == null) return [null, null, null, null, null, null];
    const g = Coords.format2(lat, lon, Coords.DMS, zone), u = Coords.format2(lat, lon, Coords.UTM, zone);
    return [fixed(lat, 7), fixed(lon, 7), g[0], g[1], u[0], u[1]];
  };
  const rows = [['uuid', 'temporada', 'numero', 'fecha_deteccion', 'especie', 'estado', 'estado_fijado_por_experto',
    'playa', 'zona', 'accion', 'fecha_eclosion', 'eclosion_fijada_por_experto',
    'real_lat', 'real_lon', 'real_gms_lat', 'real_gms_lon', 'real_utm_este', 'real_utm_norte', 'real_origen', 'real_precision_m',
    'aerea_lat', 'aerea_lon', 'aerea_gms_lat', 'aerea_gms_lon', 'aerea_utm_este', 'aerea_utm_norte',
    'tortuga_lt_cm', 'tortuga_lc_cm', 'tortuga_ac_cm', 'tortuga_observaciones',
    'fotos_aereas', 'fotos_campo', 'limpieza', 'campamento', 'registrado_por', 'notas', 'creado_utc', 'actualizado_utc']];
  for (const n of list) {
    rows.push([n.uuid, n.season, n.number, n.detected_date, speciesName(n.species), statusName(n.status), n.status_override ? 'sí' : 'no',
      n.beach, n.zone, n.action, n.hatch_date, n.hatch_manual ? 'sí' : 'no',
      ...coords(n.real_lat, n.real_lon), n.real_source, n.real_acc,
      ...coords(n.photo_lat, n.photo_lon),
      n.turtle_lt, n.turtle_lc, n.turtle_ac, n.turtle_notes,
      store.masksOf(n.uuid).length, store.photosOf(n.uuid).length, store.cleaningOf(n.uuid) ? 'sí' : 'no',
      n.camp, n.observer, n.notes, n.created_at, n.updated_at]);
  }
  downloadText('nidos_' + ctx.slug + '_' + todayIso() + '.csv', csv(rows), 'text/csv');
}

export function exportCleaningsCsv(ctx, list) {
  const rows = [['nido', 'temporada', 'playa', 'fecha_limpieza', 'cascarones', 'vivas', 'muertas', 'rosa',
    'modo_fase', 'fase_total', 'fase1', 'fase2', 'fase3', 'notas', 'registrado_por', 'uuid_nido', 'uuid_limpieza']];
  for (const { k, n } of list) {
    rows.push([n.number, n.season, n.beach, k.clean_date, k.shells, k.alive, k.dead, k.pink,
      k.phase_mode, k.phase_total, k.phase1, k.phase2, k.phase3, k.notes, k.observer, n.uuid, k.uuid]);
  }
  downloadText('limpiezas_' + ctx.slug + '_' + todayIso() + '.csv', csv(rows), 'text/csv');
}

export function exportKml(ctx, list) {
  const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
  const kmlColor = (hex) => 'ff' + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);   // aabbggrr
  const marks = list.map((n) => {
    const p = position(n);
    if (!p) return '';
    return `<Placemark><name>${esc(n.number)}</name>
<description>${esc([speciesName(n.species), statusName(n.status), n.beach, n.detected_date].filter(Boolean).join(' · '))}</description>
<Style><IconStyle><color>${kmlColor(statusColor(n.status))}</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Point><coordinates>${p[1].toFixed(7)},${p[0].toFixed(7)},0</coordinates></Point></Placemark>`;
  }).join('\n');
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Nidos ${esc(ctx.campName)} ${todayIso()}</name>
${marks}
</Document></kml>
`;
  downloadText('nidos_' + ctx.slug + '_' + todayIso() + '.kml', kml, 'application/vnd.google-earth.kml+xml');
}
