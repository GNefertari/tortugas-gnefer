// Carga masiva: columnas, lectura de celdas y validación renglón por renglón.
// No toca la página (se puede probar con node): carga.js arma la interfaz encima de esto.
//
// Los nidos y las limpiezas vienen en hojas (o archivos CSV) separados. Cada limpieza se enlaza
// con su nido por (temporada, número): el nido puede venir en la hoja de nidos o estar ya en el
// sistema. Cada renglón se traduce a lo que guarda la base (fechas yyyy-MM-dd, grados decimales,
// códigos de catálogo) con las mismas reglas que la app; lo que no se entiende es un error del
// renglón y lo dudoso un aviso. El servidor vuelve a validar al cargar.

import * as Coords from './coords.js';
import { distance } from './geo.js';

export const NESTS = 'nidos', CLEANINGS = 'limpiezas', IGNORE = 'ignorar';

// ───────────────────────────── columnas

// tpl = nombre de la columna en la plantilla oficial (igual que nidos.csv / limpiezas.csv de la app cuando existe).
// syn = otras formas en que suele venir el encabezado en el Excel del experto.
export const NEST_FIELDS = [
  { id: 'number', label: 'Número de nido *', tpl: 'numero', syn: ['no nido', 'num nido', 'numero de nido', 'numero nido', 'nido', 'no', 'n', 'num', 'folio', 'id nido', 'no de nido'] },
  { id: 'season', label: 'Temporada (solo para revisar)', tpl: 'temporada', syn: ['ano', 'season', 'temp'] },
  { id: 'detected_date', label: 'Fecha de detección *', tpl: 'fecha_deteccion', syn: ['fecha', 'fecha de deteccion', 'fecha registro', 'fecha de registro', 'fecha anidacion', 'fecha de anidacion', 'fecha desove', 'fecha de desove', 'fecha de puesta'] },
  { id: 'species', label: 'Especie', tpl: 'especie', syn: ['species', 'sp', 'spp'] },
  { id: 'status', label: 'Estado', tpl: 'estado', syn: ['status', 'estatus', 'condicion'] },
  { id: 'status_fixed', label: 'Estado fijado por experto (sí/no)', tpl: 'estado_fijado_por_experto', syn: [] },
  { id: 'beach', label: 'Playa', tpl: 'playa', syn: ['beach', 'sitio', 'localidad'] },
  { id: 'zone', label: 'Zona (1–3)', tpl: 'zona', syn: [] },
  { id: 'action', label: 'Acción (1–8)', tpl: 'accion', syn: [] },
  { id: 'hatch_date', label: 'Fecha de eclosión', tpl: 'fecha_eclosion', syn: ['fecha de eclosion', 'eclosion', 'fecha emergencia', 'fecha de emergencia'] },
  { id: 'hatch_fixed', label: 'Eclosión fijada por experto (sí/no)', tpl: 'eclosion_fijada_por_experto', syn: [] },
  { id: 'coord_format', label: 'Coordenada: formato (decimal, gms o utm)', tpl: 'formato_coordenada', syn: ['formato', 'formato de coordenada', 'tipo coordenada'] },
  { id: 'coord_a', label: 'Coordenada: latitud, o Este (X) en UTM', tpl: 'latitud_o_este', syn: ['latitud', 'lat', 'real lat', 'este', 'x', 'utm este', 'utm x', 'coord x', 'easting'] },
  { id: 'coord_b', label: 'Coordenada: longitud, o Norte (Y) en UTM', tpl: 'longitud_o_norte', syn: ['longitud', 'lon', 'long', 'real lon', 'norte', 'y', 'utm norte', 'utm y', 'coord y', 'northing'] },
  { id: 'coord_both', label: 'Coordenada en una sola celda', tpl: 'coordenada', syn: ['coordenadas', 'ubicacion', 'gps', 'punto'] },
  { id: 'turtle_lt', label: 'Tortuga: largo total (cm)', tpl: 'tortuga_lt_cm', syn: ['lt', 'largo total'] },
  { id: 'turtle_lc', label: 'Tortuga: largo curvo (cm)', tpl: 'tortuga_lc_cm', syn: ['lc', 'lcc', 'largo curvo'] },
  { id: 'turtle_ac', label: 'Tortuga: ancho curvo (cm)', tpl: 'tortuga_ac_cm', syn: ['ac', 'acc', 'ancho curvo'] },
  { id: 'turtle_notes', label: 'Tortuga: observaciones', tpl: 'tortuga_observaciones', syn: [] },
  { id: 'observer', label: 'Registrado por / brigada', tpl: 'registrado_por', syn: ['observador', 'brigada', 'responsable', 'registro', 'registro por', 'capturista'] },
  { id: 'notes', label: 'Notas', tpl: 'notas', syn: ['observaciones', 'comentarios', 'notas nido', 'obs'] },
];

export const CLEAN_FIELDS = [
  { id: 'season', label: 'Temporada del nido *', tpl: 'temporada', syn: ['ano', 'season', 'temp'] },
  { id: 'number', label: 'Número de nido *', tpl: 'numero_nido', syn: ['numero', 'no nido', 'num nido', 'numero de nido', 'nido', 'no', 'n', 'num', 'folio', 'id nido', 'no de nido'] },
  { id: 'clean_date', label: 'Fecha de la limpieza', tpl: 'fecha_limpieza', syn: ['fecha', 'fecha de limpieza', 'fecha exhumacion', 'fecha de exhumacion'] },
  { id: 'shells', label: 'Cascarones', tpl: 'cascarones', syn: ['cascaron', 'huevos eclosionados'] },
  { id: 'alive', label: 'Vivas', tpl: 'vivas', syn: ['crias vivas'] },
  { id: 'dead', label: 'Muertas', tpl: 'muertas', syn: ['crias muertas'] },
  { id: 'pink', label: 'Rosa', tpl: 'rosa', syn: ['rosas', 'huevo rosa'] },
  { id: 'phase_total', label: 'Fase (total)', tpl: 'fase_total', syn: ['fase'] },
  { id: 'phase1', label: 'Fase 1', tpl: 'fase_1', syn: ['fase1', 'f1'] },
  { id: 'phase2', label: 'Fase 2', tpl: 'fase_2', syn: ['fase2', 'f2'] },
  { id: 'phase3', label: 'Fase 3', tpl: 'fase_3', syn: ['fase3', 'f3'] },
  { id: 'clean_notes', label: 'Notas', tpl: 'notas', syn: ['observaciones', 'comentarios', 'obs', 'notas limpieza'] },
  { id: 'clean_observer', label: 'Registrado por / brigada', tpl: 'registrado_por', syn: ['observador', 'brigada', 'responsable'] },
];

export const fieldsOf = (kind) => (kind === CLEANINGS ? CLEAN_FIELDS : NEST_FIELDS);
// Prefijo con el que se recuerda la asignación de cada tipo de hoja ("notas" no es lo mismo en las dos).
const memKey = (kind, header) => (kind === CLEANINGS ? 'l:' : 'n:') + normHeader(header).slice(0, 118);

/** "No. Nido" -> "no nido": minúsculas, sin acentos ni signos. */
export function normHeader(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function synonyms(fields) {
  const m = new Map();
  for (const f of fields) for (const s of [f.tpl, f.id, ...f.syn]) {
    const k = normHeader(s);
    if (!m.has(k)) m.set(k, f.id);
  }
  return m;
}
const SYN = { [NESTS]: synonyms(NEST_FIELDS), [CLEANINGS]: synonyms(CLEAN_FIELDS) };

/**
 * Asignación inicial: primero lo que se recordó de cargas anteriores, luego los nombres conocidos.
 * Cada dato se asigna a una sola columna (la primera que lo pida).
 */
export function autoMap(headers, remembered = {}, kind = NESTS) {
  if (kind !== NESTS && kind !== CLEANINGS) return headers.map(() => IGNORE);   // hoja que no se usa
  const used = new Set();
  const fields = fieldsOf(kind);
  return headers.map((hd) => {
    const k = normHeader(hd);
    if (!k) return IGNORE;
    let id = remembered[memKey(kind, hd)] || SYN[kind].get(k) || IGNORE;
    if (id !== IGNORE && (used.has(id) || !fields.some((f) => f.id === id))) id = IGNORE;
    if (id !== IGNORE) used.add(id);
    return id;
  });
}

/** Lo que se guarda para recordar la asignación de una hoja. */
export function mappingMemory(headers, mapping, kind) {
  const mem = {};
  headers.forEach((hd, i) => { if (normHeader(hd)) mem[memKey(kind, hd)] = mapping[i]; });
  return mem;
}

const headerScore = (cells, kind) => cells.filter((v) => SYN[kind].has(normHeader(v))).length;

/** El renglón de encabezados: entre los primeros 15, el que más nombres conocidos tiene. */
export function guessHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = (rows[i] || []).filter((v) => v != null && String(v).trim() !== '');
    if (cells.length < 2) continue;
    const score = Math.max(headerScore(cells, NESTS), headerScore(cells, CLEANINGS)) * 10 + cells.length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** ¿La hoja es de nidos, de limpiezas o no se usa? Por su nombre y, si no dice, por sus encabezados. */
export function guessKind(sheetName, headers) {
  const n = normHeader(sheetName);
  if (/instruc|ayuda|catalog|lista/.test(n)) return IGNORE;
  if (/limp|exhum/.test(n)) return CLEANINGS;
  if (/nido/.test(n)) return NESTS;
  const hs = headers.map(normHeader);
  const cleanOnly = ['fecha limpieza', 'cascarones', 'vivas', 'muertas', 'rosa', 'fase total', 'fase 1', 'numero nido'];
  const nestOnly = ['fecha deteccion', 'especie', 'estado', 'playa', 'zona', 'latitud o este', 'latitud', 'lat'];
  const c = hs.filter((x) => cleanOnly.includes(x) || SYN[CLEANINGS].get(x) === 'shells').length;
  const s = hs.filter((x) => nestOnly.includes(x) || ['species', 'detected_date'].includes(SYN[NESTS].get(x))).length;
  if (!c && !s) return IGNORE;
  return c > s ? CLEANINGS : NESTS;
}

/** Columnas obligatorias que faltan por asignar. */
export function missingFields(kind, mapping) {
  const need = kind === CLEANINGS ? ['season', 'number'] : ['number', 'detected_date'];
  return need.filter((id) => !mapping.includes(id)).map((id) => fieldsOf(kind).find((f) => f.id === id).label.replace(' *', ''));
}

// ───────────────────────────── celdas

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const text = (v) => (blank(v) ? null : v instanceof Date ? isoOfDate(v) : String(v).trim());
const plain = (v) => normHeader(v);

function isoOfDate(d) {
  // Excel guarda solo el día; según el lector puede llegar a medianoche local o UTC.
  const t = new Date(d.getTime() + 12 * 3600 * 1000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

function validIso(y, m, d) {
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

const MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9,
  oct: 10, nov: 11, dic: 12, dec: 12 };

/** Fecha en cualquier forma común -> {v: 'yyyy-MM-dd', warn}. Lanza Error si no se entiende. */
export function parseDate(v) {
  if (blank(v)) return { v: null };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('fecha inválida');
    return { v: isoOfDate(v) };
  }
  if (typeof v === 'number') {
    // Número de serie de Excel (días desde 1899-12-30).
    if (v > 18000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return { v: d.toISOString().slice(0, 10) };
    }
    throw new Error('"' + v + '" no es una fecha');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const r = validIso(+m[1], +m[2], +m[3]);
    if (r) return { v: r };
    throw new Error('"' + s + '" no es una fecha válida');
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let warn = null;
    if (a <= 12 && b > 12) { [a, b] = [b, a]; warn = 'la fecha "' + s + '" parece mes/día; se leyó como ' + b + '/' + a + '/' + y; }
    const r = validIso(y, b, a);   // día/mes/año, como se escribe en México
    if (r) return { v: r, warn };
    throw new Error('"' + s + '" no es una fecha válida (se espera día/mes/año)');
  }
  m = plain(s).match(/^(\d{1,2}) (?:de )?([a-z]{3})[a-z]* (?:de )?(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2]]) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const r = validIso(y, MONTHS[m[2]], +m[1]);
    if (r) return { v: r };
  }
  throw new Error('no se entiende la fecha "' + s + '"');
}

function parseNumber(v, what, { int = false, min = null, max = null } = {}) {
  if (blank(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(what + ': "' + v + '" no es un número');
  if (int && !Number.isInteger(n)) throw new Error(what + ' debe ser un número entero');
  if (min != null && n < min) throw new Error(what + ' no puede ser menor de ' + min);
  if (max != null && n > max) throw new Error(what + ' no puede ser mayor de ' + max);
  return n;
}

export function parseSpecies(v) {
  if (blank(v)) return null;
  const s = plain(v);
  const w = s.split(' ');
  if (s.includes('mydas') || w.includes('verde') || w.includes('blanca') || s === 'cm' || s === 'c m' || w.includes('chelonia')) return 'chelonia_mydas';
  if (s.includes('caretta') || w.includes('caguama') || w.includes('amarilla') || w.includes('boba') || s === 'cc' || s === 'c c') return 'caretta_caretta';
  throw new Error('especie no reconocida: "' + v + '"');
}

/** Estado -> {override, auto}: override = el que fija el experto; auto = activo/eclosionado. */
export function parseStatus(v) {
  if (blank(v)) return null;
  const s = plain(v);
  if (/^(activ|incub|en incub|vigent)/.test(s) || s === 'a') return { override: null, auto: 'activo' };
  if (/^(eclos|nacid|emergi|eclocionad)/.test(s)) return { override: null, auto: 'eclosionado' };
  if (/^(depred|saque|robad)/.test(s)) return { override: 'depredado' };
  if (/^salvaj/.test(s)) return { override: 'salvaje' };
  if (/^(reubic|traslad|relocal)/.test(s)) return { override: 'reubicado' };
  throw new Error('estado no reconocido: "' + v + '" (activo, eclosionado, depredado, salvaje o reubicado)');
}

function parseYesNo(v) {
  if (blank(v)) return null;
  const s = plain(v);
  if (['si', 's', 'yes', 'y', '1', 'x', 'true', 'verdadero'].includes(s)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(s)) return false;
  throw new Error('se esperaba sí o no: "' + v + '"');
}

/** Número de nido: el 15 de Excel llega como 15 (número); se guarda como texto "15". */
function parseNestNumber(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim().replace(/\.0+$/, '');
}

// ───────────────────────────── coordenadas

export function parseFormat(v) {
  if (blank(v)) return null;
  const s = plain(v);
  if (s.startsWith('utm')) return Coords.UTM;
  if (/^(gms|dms|grados minutos|g m s|sexagesimal)/.test(s)) return Coords.DMS;
  if (/^(dec|gd|dd|grados decimales|decimal)/.test(s)) return Coords.DECIMAL;
  throw new Error('formato de coordenada no reconocido: "' + v + '" (decimal, gms o utm)');
}

function detectFormat(a, b) {
  const num = (x) => Number(String(x).trim().replace(',', '.'));
  if (Number.isFinite(num(a)) && Number.isFinite(num(b))) return Math.abs(num(a)) > 1000 ? Coords.UTM : Coords.DECIMAL;
  return Coords.DMS;
}

/** "20.27, -86.98", "20°16'39.9"N 86°58'56.3"W", "504121 2243818" -> [a, b] */
export function splitCoord(v) {
  const s = String(v).trim();
  if (s.includes(';')) return s.split(';').map((x) => x.trim()).slice(0, 2);
  let m = s.match(/^(.*?[NS])[\s,]+(.*)$/i);
  if (m && /\d/.test(m[1]) && /\d/.test(m[2])) return [m[1].trim(), m[2].trim()];
  if ((s.match(/,/g) || []).length === 1) return s.split(',').map((x) => x.trim());
  m = s.match(/,\s+/);
  if (m) return [s.slice(0, m.index), s.slice(m.index + m[0].length)];
  const parts = s.split(/\s+/);
  if (parts.length === 2) return parts;
  throw new Error('no se puede separar la coordenada "' + s + '" (usa "latitud, longitud")');
}

/** -> {lat, lon, warns[]} o null si no hay coordenada. */
export function parseCoord(a, b, fmt, zone, center) {
  if (blank(a) && blank(b)) return null;
  if (blank(a) || blank(b)) throw new Error('la coordenada está incompleta');
  const warns = [];
  const f = fmt || detectFormat(a, b);
  let [lat, lon] = Coords.parse(String(a), String(b), f, zone);
  if (f !== Coords.UTM) {
    if (Math.abs(lat) > 60 && Math.abs(lon) < 60) { [lat, lon] = [lon, lat]; warns.push('latitud y longitud estaban invertidas'); }
    // En México la longitud es Oeste (negativa); en las libretas suele escribirse sin signo.
    if (center && center[1] < 0 && lon > 0) { lon = -lon; warns.push('longitud sin signo: se tomó como Oeste'); }
  }
  if (center) {
    const km = distance(lat, lon, center[0], center[1]) / 1000;
    if (km > 60) warns.push('la coordenada queda a ' + Math.round(km) + ' km del campamento; revísala');
  }
  return { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7, warns };
}

// ───────────────────────────── renglones

function columns(mapping) {
  const col = {};
  mapping.forEach((id, i) => { if (id !== IGNORE) col[id] = i; });
  return col;
}

function rowHelpers(r) {
  const tryDo = (fn) => { try { fn(); } catch (e) { r.errors.push(e.message); } };
  return { tryDo };
}

/**
 * Hoja de nidos.
 *   rows      arreglo de arreglos (celdas) DESPUÉS del encabezado
 *   firstRow  número de renglón en Excel del primero (para los mensajes)
 *   mapping   dato asignado a cada columna (o IGNORE)
 *   opts      { format: 'auto'|'decimal'|'gms'|'utm', zone, center, beaches, existing(season, number) -> nido }
 * Devuelve [{renglon, errors[], warns[], nest, cleaning, fijar_estado, limpieza_si_falta, season, key, existing}]
 */
export function buildNestRows(rows, firstRow, mapping, opts) {
  const col = columns(mapping);
  const beachByKey = new Map((opts.beaches || []).map((b) => [normHeader(b), b]));
  const fixedFormat = opts.format && opts.format !== 'auto' ? opts.format : null;
  const seen = new Map();
  const out = [];

  rows.forEach((cells, i) => {
    cells = cells || [];
    if (cells.every(blank)) return;
    const get = (id) => (id in col ? cells[col[id]] : null);
    const r = { renglon: firstRow + i, errors: [], warns: [], nest: {}, cleaning: null, fijar_estado: false, limpieza_si_falta: false };
    const n = r.nest;
    const { tryDo } = rowHelpers(r);
    const date = (id, label) => {
      let v = null;
      tryDo(() => { const d = parseDate(get(id)); v = d.v; if (d.warn) r.warns.push(label + ': ' + d.warn); });
      return v;
    };

    n.number = parseNestNumber(get('number'));
    if (!n.number) r.errors.push('falta el número de nido');
    n.detected_date = date('detected_date', 'Detección');
    if (!n.detected_date && !r.errors.some((e) => e.includes('fecha'))) r.errors.push('falta la fecha de detección');
    r.season = n.detected_date ? Number(n.detected_date.slice(0, 4)) : null;
    tryDo(() => {
      const s = parseNumber(get('season'), 'Temporada', { int: true });
      if (s != null && r.season != null && s !== r.season) throw new Error('la temporada ' + s + ' no coincide con la fecha de detección (' + r.season + ')');
    });

    tryDo(() => { n.species = parseSpecies(get('species')); });
    let st = null;
    tryDo(() => { st = parseStatus(get('status')); });
    if (st) {
      r.fijar_estado = true;
      n.status_override = st.override;
      r.statusAuto = st.auto || null;
    }
    const beach = text(get('beach'));
    if (beach) {
      n.beach = beachByKey.get(normHeader(beach)) || beach;
      if (!beachByKey.has(normHeader(beach))) r.warns.push('la playa "' + beach + '" no está en los Ajustes del campamento');
    }
    tryDo(() => { n.zone = parseNumber(get('zone'), 'Zona', { int: true, min: 1, max: 3 }); });
    tryDo(() => { n.action = parseNumber(get('action'), 'Acción', { int: true, min: 1, max: 8 }); });
    n.hatch_date = date('hatch_date', 'Eclosión');
    if (n.hatch_date) {
      let fixed = null;
      tryDo(() => { fixed = parseYesNo(get('hatch_fixed')); });
      n.hatch_manual = fixed === false ? 0 : 1;
      if (n.detected_date && n.hatch_date < n.detected_date) r.warns.push('la eclosión es anterior a la detección');
    }

    tryDo(() => {
      let a = get('coord_a'), b = get('coord_b');
      if (blank(a) && blank(b) && !blank(get('coord_both'))) [a, b] = splitCoord(get('coord_both'));
      const fmt = parseFormat(get('coord_format')) || fixedFormat;
      const c = parseCoord(a, b, fmt, opts.zone || 16, opts.center);
      if (c) { n.real_lat = c.lat; n.real_lon = c.lon; r.warns.push(...c.warns); }
    });

    tryDo(() => { n.turtle_lt = parseNumber(get('turtle_lt'), 'Largo total', { min: 0 }); });
    tryDo(() => { n.turtle_lc = parseNumber(get('turtle_lc'), 'Largo curvo', { min: 0 }); });
    tryDo(() => { n.turtle_ac = parseNumber(get('turtle_ac'), 'Ancho curvo', { min: 0 }); });
    n.turtle_notes = text(get('turtle_notes'));
    n.observer = text(get('observer'));
    n.notes = text(get('notes'));

    // «Eclosionado» sin limpieza: se registra una vacía para que quede eclosionado (linkSheets
    // la quita si la hoja de limpiezas trae la de este nido).
    if (r.statusAuto === 'eclosionado') {
      r.cleaning = { notes: 'Creada por la carga masiva: el archivo decía «eclosionado» sin datos de limpieza.' };
      r.limpieza_si_falta = true;
    }

    if (n.number && r.season) {
      r.key = r.season + '|' + n.number;
      if (seen.has(r.key)) r.errors.push('el nido ' + n.number + ' de ' + r.season + ' ya viene en el renglón ' + seen.get(r.key));
      else seen.set(r.key, r.renglon);
      r.existing = opts.existing ? opts.existing(r.season, n.number) : null;
    }
    out.push(r);
  });
  return out;
}

/**
 * Hoja de limpiezas: cada renglón se enlaza con su nido por (temporada, número).
 *   opts { nestRows (de la hoja de nidos), existing(season, number) -> nido, cleaningOf(uuidNido) -> limpieza }
 * Devuelve [{renglon, errors[], warns[], cleaning, season, number, key, existing (limpieza que ya tiene el nido)}]
 */
export function buildCleaningRows(rows, firstRow, mapping, opts) {
  const col = columns(mapping);
  const inFile = new Map();
  for (const nr of opts.nestRows || []) if (nr.key && !inFile.has(nr.key)) inFile.set(nr.key, nr);
  const seen = new Map();
  const out = [];

  rows.forEach((cells, i) => {
    cells = cells || [];
    if (cells.every(blank)) return;
    const get = (id) => (id in col ? cells[col[id]] : null);
    const r = { renglon: firstRow + i, errors: [], warns: [], cleaning: {} };
    const k = r.cleaning;
    const { tryDo } = rowHelpers(r);

    tryDo(() => { r.season = parseNumber(get('season'), 'Temporada', { int: true, min: 1950, max: 2100 }); });
    r.number = parseNestNumber(get('number'));
    tryDo(() => { const d = parseDate(get('clean_date')); k.clean_date = d.v; if (d.warn) r.warns.push('Limpieza: ' + d.warn); });
    if (r.season == null && !r.errors.length) {
      if (k.clean_date) {
        r.season = Number(k.clean_date.slice(0, 4));
        r.warns.push('sin temporada: se tomó el año de la limpieza (' + r.season + ')');
      } else r.errors.push('falta la temporada del nido');
    }
    if (!r.number) r.errors.push('falta el número de nido');
    for (const [id, label] of [['shells', 'Cascarones'], ['alive', 'Vivas'], ['dead', 'Muertas'], ['pink', 'Rosa'],
      ['phase_total', 'Fase'], ['phase1', 'Fase 1'], ['phase2', 'Fase 2'], ['phase3', 'Fase 3']]) {
      tryDo(() => { k[id] = parseNumber(get(id), label, { int: true, min: 0 }); });
    }
    k.notes = text(get('clean_notes'));
    k.observer = text(get('clean_observer'));
    if ([k.phase1, k.phase2, k.phase3].some((x) => x != null)) {
      k.phase_mode = 'detalle';
      k.phase_total = (k.phase1 || 0) + (k.phase2 || 0) + (k.phase3 || 0);
    } else if (k.phase_total != null) {
      k.phase_mode = 'total';
    }
    if (Object.entries(k).every(([, v]) => v == null)) r.warns.push('la limpieza no trae datos');

    // Enlace con su nido: en la hoja de nidos o ya en el sistema.
    if (r.number && r.season) {
      r.key = r.season + '|' + r.number;
      if (seen.has(r.key)) r.errors.push('la limpieza del nido ' + r.number + ' de ' + r.season + ' ya viene en el renglón ' + seen.get(r.key));
      else seen.set(r.key, r.renglon);
      const nr = inFile.get(r.key);
      const nest = opts.existing ? opts.existing(r.season, r.number) : null;
      if (nr && nr.errors.length && !nest) r.errors.push('su nido tiene errores en la hoja de nidos (renglón ' + nr.renglon + ')');
      else if (!nr && !nest) r.errors.push('no existe el nido ' + r.number + ' de ' + r.season + ' (ni en la hoja de nidos ni en el sistema)');
      r.nestRow = nr || null;
      r.nest = nest || null;
      r.existing = nest && opts.cleaningOf ? opts.cleaningOf(nest.uuid) : null;
      const detected = (nr && nr.nest.detected_date) || (nest && nest.detected_date);
      if (k.clean_date && detected && k.clean_date < detected) r.warns.push('la limpieza es anterior a la detección del nido');
    }
    out.push(r);
  });
  return out;
}

/** Une las dos hojas: avisos que dependen de ambas y la limpieza vacía de «eclosionado». */
export function linkSheets(nestRows, cleanRows) {
  const withCleaning = new Set(cleanRows.filter((r) => r.key).map((r) => r.key));
  for (const r of nestRows) {
    const has = r.key && withCleaning.has(r.key);
    if (r.limpieza_si_falta && has) { r.cleaning = null; r.limpieza_si_falta = false; }
    if (r.limpieza_si_falta) r.warns.push('eclosionado sin limpieza en la hoja de limpiezas: se registra una limpieza vacía');
    if (has && r.statusAuto === 'activo' && !r.nest.status_override) r.warns.push('dice "activo" pero tiene limpieza: quedará eclosionado');
  }
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** Lo que se manda al servidor por cada renglón válido de nidos. */
export function toPayload(r, siExiste) {
  const p = { renglon: r.renglon, nest: clean(r.nest), si_existe: siExiste, fijar_estado: r.fijar_estado };
  if (r.fijar_estado) p.nest.status_override = r.nest.status_override ?? null;
  if (r.cleaning) { p.cleaning = clean(r.cleaning); p.limpieza_si_falta = r.limpieza_si_falta; }
  return p;
}

/** Lo que se manda al servidor por cada renglón válido de limpiezas. */
export function toCleaningPayload(r, siExiste) {
  return { renglon: r.renglon, temporada: r.season, numero: r.number, si_existe: siExiste, cleaning: clean(r.cleaning) };
}

// ───────────────────────────── plantillas

/** Plantillas oficiales: hoja de nidos, hoja de limpiezas (enlazadas por temporada y número) e instrucciones. */
export function templateSheets(beaches, phaseMode) {
  const nestCols = ['temporada', 'numero', 'fecha_deteccion', 'especie', 'estado', 'playa', 'zona', 'accion', 'fecha_eclosion',
    'formato_coordenada', 'latitud_o_este', 'longitud_o_norte', 'tortuga_lt_cm', 'tortuga_lc_cm', 'tortuga_ac_cm',
    'tortuga_observaciones', 'registrado_por', 'notas'];
  const cleanCols = ['temporada', 'numero_nido', 'fecha_limpieza', 'cascarones', 'vivas', 'muertas', 'rosa',
    ...(phaseMode === 'detalle' ? ['fase_1', 'fase_2', 'fase_3'] : ['fase_total']), 'registrado_por', 'notas'];
  const b0 = beaches[0] || '', b1 = beaches[1] || b0;
  const nestEx = {
    temporada: [2025, 2025], numero: ['1', '2'], fecha_deteccion: ['12/06/2025', '14/06/2025'],
    especie: ['Chelonia mydas', 'Caretta caretta'], estado: ['', 'depredado'], playa: [b0, b1], zona: [2, 1], accion: [5, ''],
    formato_coordenada: ['decimal', 'utm'], latitud_o_este: ['20.2777554', '501900'], longitud_o_norte: ['-86.9823050', '2242300'],
    registrado_por: ['Brigada 1', 'Brigada 2'],
  };
  const cleanEx = {
    temporada: [2025], numero_nido: ['1'], fecha_limpieza: ['15/08/2025'], cascarones: [98], vivas: [2], muertas: [1], rosa: [0],
    fase_total: [3], fase_1: [1], fase_2: [1], fase_3: [1], registrado_por: ['Brigada 1'],
  };
  const sheet = (cols, ex, n) => [cols, ...Array.from({ length: n }, (_, i) => cols.map((c) => (ex[c] ? ex[c][i] ?? '' : '')))];
  const help = [
    ['Columna', 'Qué va', 'Valores aceptados'],
    ['HOJA «Nidos»', 'Un renglón por nido.', ''],
    ['numero', 'Número de nido (obligatorio). Único por temporada.', 'Texto o número'],
    ['fecha_deteccion', 'Fecha de detección o registro (obligatoria). La temporada es su año.', 'día/mes/año (12/06/2025), 2025-06-12 o fecha de Excel'],
    ['temporada', 'Opcional: solo se usa para revisar que coincida con la fecha.', 'Año'],
    ['especie', '', 'Chelonia mydas (verde, blanca, C. mydas) o Caretta caretta (caguama, C. caretta)'],
    ['estado', 'Vacío = automático: activo, o eclosionado si tiene limpieza.', 'activo, eclosionado, depredado, salvaje, reubicado'],
    ['playa', 'Como aparece en Ajustes.', beaches.join(', ')],
    ['zona / accion', '', 'Zona 1 a 3; acción 1 a 8'],
    ['fecha_eclosion', 'Vacía = se estima con los días de incubación de la especie.', 'Fecha'],
    ['formato_coordenada', 'Formato de las dos columnas siguientes (puede cambiar en cada renglón).', 'decimal, gms o utm (zona 16 N)'],
    ['latitud_o_este / longitud_o_norte', 'Coordenada real del nido.', 'decimal: 20.2777554 y -86.9823050 · gms: 20°16\'39.9"N y 86°58\'56.3"W · utm: 501848 y 2242218 (el mismo punto)'],
    ['', '', ''],
    ['HOJA «Limpiezas»', 'Un renglón por limpieza (máximo una por nido).', ''],
    ['temporada + numero_nido', 'Obligatorios: así se enlaza la limpieza con su nido. El nido puede venir en la hoja «Nidos» o estar ya registrado en el sistema.', 'Año y número'],
    ['fecha_limpieza … notas', 'Datos de la limpieza.', phaseMode === 'detalle' ? 'Fase 1, 2 y 3 por separado' : 'Fase total'],
    ['', '', ''],
    ['CSV', 'Si usas CSV, son dos archivos (nidos y limpiezas): súbelos juntos.', 'Separados por coma o punto y coma'],
    ['Ya existen', 'Si un nido o su limpieza ya existen, al cargar se elige actualizar u omitir. Al actualizar solo cambian las celdas que traen dato.', ''],
  ];
  return { nidos: sheet(nestCols, nestEx, 2), limpiezas: sheet(cleanCols, cleanEx, 1), help };
}

/** Texto CSV (UTF-8 con BOM, separado por comas) para abrir en Excel. */
export function toCsv(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
