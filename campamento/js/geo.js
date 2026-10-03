// Ubicación en el suelo de una foto de dron en nadir. Copia de Geo.java (app Nidos) y de
// gnest/geo.py: las tres deben dar el mismo resultado.

export function metersPerDegLat(lat) {
  const r = lat * Math.PI / 180;
  return 111132.954 - 559.822 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r);
}

export function metersPerDegLon(lat) {
  const r = lat * Math.PI / 180;
  return 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r);
}

/** Distancia en metros (suficiente para distancias cortas). */
export function distance(lat1, lon1, lat2, lon2) {
  const mid = (lat1 + lat2) / 2;
  const dn = (lat2 - lat1) * metersPerDegLat(mid);
  const de = (lon2 - lon1) * metersPerDegLon(mid);
  return Math.sqrt(dn * dn + de * de);
}

/**
 * Footprint de una foto (fila "aerial" del servidor): lat, lon, height (m sobre el suelo),
 * yaw (rumbo de la parte de arriba de la foto), focal_px, width, height_px (tamaño original).
 * Devuelve null si faltan datos.
 */
export function footprint(a) {
  if (![a.lat, a.lon, a.height, a.focal_px, a.width, a.height_px].every((v) => typeof v === 'number' && v)) return null;
  const g = a.height / a.focal_px;
  const yaw = (a.yaw || 0) * Math.PI / 180;
  const toLatLon = (x, y) => {
    const right = (x - a.width / 2) * g;
    const forward = (a.height_px / 2 - y) * g;
    const east = forward * Math.sin(yaw) + right * Math.cos(yaw);
    const north = forward * Math.cos(yaw) - right * Math.sin(yaw);
    return [a.lat + north / metersPerDegLat(a.lat), a.lon + east / metersPerDegLon(a.lat)];
  };
  return {
    gsd: g,
    toLatLon,
    // arriba-izq, arriba-der, abajo-izq (para colocar la imagen) y abajo-der
    topLeft: toLatLon(0, 0),
    topRight: toLatLon(a.width, 0),
    bottomLeft: toLatLon(0, a.height_px),
    bottomRight: toLatLon(a.width, a.height_px),
  };
}
