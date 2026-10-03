// Formatos de coordenadas. Copia de Coords.java (app Nidos): en la base siempre van grados
// decimales WGS84; GMS y UTM se calculan al mostrar y al leer lo que escribe la persona.
//   decimal  20.2777554, -86.9823050
//   gms      20°16'39.92"N, 86°58'56.30"W
//   utm      504121, 2243818   (zona 16 N, Cozumel)

export const DECIMAL = 'decimal', DMS = 'gms', UTM = 'utm';
export const FORMATS = [
  [DECIMAL, 'Grados decimales'],
  [DMS, 'Grados, minutos, segundos'],
  [UTM, 'UTM (Este, Norte)'],
];

export function fieldNames(fmt) {
  return fmt === UTM ? ['Este (X, m)', 'Norte (Y, m)'] : ['Latitud', 'Longitud'];
}

export function hints(fmt) {
  if (fmt === UTM) return ['504121', '2243818'];
  if (fmt === DMS) return ['20°16\'39.9"N', '86°58\'56.3"W'];
  return ['20.2777554', '-86.9823050'];
}

export function format2(lat, lon, fmt, zone) {
  if (fmt === DMS) return [dms(lat, true), dms(lon, false)];
  if (fmt === UTM) {
    const [e, n] = toUtm(lat, lon, zone);
    return [e.toFixed(0), n.toFixed(0)];
  }
  return [lat.toFixed(7), lon.toFixed(7)];
}

export function format(lat, lon, fmt, zone) {
  const t = format2(lat, lon, fmt, zone);
  if (fmt === UTM) return zone + band(lat) + ' ' + t[0] + ' E, ' + t[1] + ' N';
  return t[0] + ', ' + t[1];
}

export function dms(v, isLat) {
  const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const a = Math.abs(v);
  let d = Math.floor(a);
  const mFull = (a - d) * 60;
  let m = Math.floor(mFull);
  let s = Math.round((mFull - m) * 60 * 100) / 100;
  if (s >= 60) { s -= 60; m++; }
  if (m >= 60) { m -= 60; d++; }
  return d + '°' + String(m).padStart(2, '0') + "'" + s.toFixed(2).padStart(5, '0') + '"' + h;
}

function band(lat) {
  const letters = 'CDEFGHJKLMNPQRSTUVWX';
  const i = Math.floor((lat + 80) / 8);
  return i >= 0 && i < letters.length ? letters[i] : '';
}

/** Lo que escribió la persona -> [lat, lon]; lanza Error con un mensaje entendible. */
export function parse(a, b, fmt, zone) {
  a = (a || '').trim();
  b = (b || '').trim();
  if (!a || !b) throw new Error('Faltan valores');
  let lat, lon;
  if (fmt === UTM) {
    const e = number(a, 'Este'), n = number(b, 'Norte');
    if (e < 100000 || e > 900000) throw new Error('Este (X) debe estar entre 100000 y 900000 m');
    if (n < 0 || n > 10000000) throw new Error('Norte (Y) fuera de rango');
    [lat, lon] = fromUtm(e, n, zone, true);
  } else if (fmt === DMS) {
    lat = parseDms(a, true);
    lon = parseDms(b, false);
  } else {
    lat = number(a, 'Latitud');
    lon = number(b, 'Longitud');
  }
  if (Math.abs(lat) > 90) throw new Error('Latitud fuera de rango (-90 a 90)');
  if (Math.abs(lon) > 180) throw new Error('Longitud fuera de rango (-180 a 180)');
  return [lat, lon];
}

function number(s, what) {
  const v = Number(s.replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(v)) throw new Error(what + ': "' + s + '" no es un número');
  return v;
}

/** Acepta 20°16'39.9"N, 20 16 39.9 N, -86 58 56.3, 86°58.94'W… Con W/S/O se hace negativo. */
export function parseDms(s, isLat) {
  const u = s.toUpperCase().trim();
  const neg = u.startsWith('-') || /[SWO]$/.test(u) || /^[SWO]/.test(u);
  const parts = (u.match(/[0-9]+(?:[.,][0-9]+)?/g) || []).slice(0, 3).map((x) => Number(x.replace(',', '.')));
  if (!parts.length) throw new Error((isLat ? 'Latitud' : 'Longitud') + ': no se entiende "' + s + '"');
  while (parts.length < 3) parts.push(0);
  if (parts[1] >= 60 || parts[2] >= 60) throw new Error((isLat ? 'Latitud' : 'Longitud') + ': minutos y segundos deben ser menores de 60');
  const v = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return neg ? -v : v;
}

// ───────────────────────────── UTM (WGS84)

const A = 6378137.0, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;

export function toUtm(lat, lon, zone) {
  const phi = rad(lat), lam0 = rad((zone - 1) * 6 - 180 + 3), lam = rad(lon);
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2, c = EP2 * Math.cos(phi) ** 2, a = Math.cos(phi) * (lam - lam0);
  const m = meridianArc(phi);
  const x = K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5 / 120) + 500000;
  let y = K0 * (m + n * Math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24
    + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6 / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

export function fromUtm(x, y, zone, north) {
  x -= 500000;
  if (!north) y -= 10000000;
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2, c1 = EP2 * Math.cos(phi1) ** 2;
  const r1 = A * (1 - E2) / Math.pow(1 - E2 * Math.sin(phi1) ** 2, 1.5);
  const d = x / (n1 * K0);
  const lat = phi1 - (n1 * Math.tan(phi1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(phi1);
  return [deg(lat), deg(rad((zone - 1) * 6 - 180 + 3) + lon)];
}

function meridianArc(phi) {
  return A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
}
