// Conexión con la API (Cloudflare). La sesión se guarda en este navegador, una por campamento.
//
// Para probar contra la API local: abrir la página con ?api=http://127.0.0.1:8787
// (se recuerda en este navegador; ?api=produccion vuelve a la publicada).

const PRODUCTION = 'https://api.tortugas.gnefer.com';

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* navegador sin almacenamiento: la sesión dura lo que la pestaña */ }
  return null;
}

export const API = (() => {
  const q = new URLSearchParams(location.search).get('api');
  if (q === 'produccion') store('api', null);
  else if (q && /^https?:\/\//.test(q)) store('api', q.replace(/\/$/, ''));
  return store('api') || PRODUCTION;
})();
export const IS_LOCAL_API = API !== PRODUCTION;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function client(slug) {
  const tokenKey = 'token:' + slug + ':' + API;
  const base = API + '/v1/' + slug;
  let token = store(tokenKey);
  let onUnauthorized = () => {};

  async function call(method, path, body) {
    const headers = {};
    if (token) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, 'Sin conexión con el servidor. Revisa tu internet.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && token && path !== '/sesion') { setToken(null); onUnauthorized(); }
      throw new ApiError(r.status, data.error || 'Error ' + r.status);
    }
    return data;
  }

  function setToken(t) {
    token = t;
    store(tokenKey, t);
  }

  const blobCache = new Map();
  /** Imagen protegida (necesita la sesión) como URL local para <img>. */
  async function image(kind, uuid) {
    const k = kind + '/' + uuid;
    if (blobCache.has(k)) return blobCache.get(k);
    const p = (async () => {
      const r = await fetch(base + '/archivos/' + k, { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    })();
    blobCache.set(k, p);
    const url = await p;
    if (!url) blobCache.delete(k);
    return url;
  }

  return {
    slug,
    get loggedIn() { return !!token; },
    onUnauthorized(fn) { onUnauthorized = fn; },
    async login(usuario, contrasena) {
      const d = await call('POST', '/sesion', { usuario, contrasena, equipo: 'web · ' + navigator.userAgent.slice(0, 80) });
      setToken(d.token);
      return d;
    },
    async logout() {
      try { await call('DELETE', '/sesion'); } catch { /* ya no importa */ }
      setToken(null);
    },
    me: () => call('GET', '/sesion'),
    changePassword: (actual, nueva) => call('POST', '/contrasena', { actual, nueva }),
    settings: () => call('GET', '/ajustes'),
    saveSettings: (s) => call('PUT', '/ajustes', s),
    users: () => call('GET', '/usuarios'),
    createUser: (u) => call('POST', '/usuarios', u),
    updateUser: (id, u) => call('PATCH', '/usuarios/' + id, u),
    pull: (since) => call('GET', '/sync/pull?desde=' + since),
    push: (rows) => call('POST', '/sync/push', { device_id: 'web', client_time: new Date().toISOString(), rows }),
    imports: () => call('GET', '/importar'),
    importPart: (body) => call('POST', '/importar', body),
    undoImport: (id) => call('POST', '/importar/' + encodeURIComponent(id) + '/deshacer'),
    flights: () => call('GET', '/vuelos'),
    createFlight: (v) => call('POST', '/vuelos', v),
    flightPhotos: (id) => call('GET', '/vuelos/' + encodeURIComponent(id) + '/fotos'),
    setFlightState: (id, estado) => call('POST', '/vuelos/' + encodeURIComponent(id) + '/estado', { estado }),
    deleteFlight: (id) => call('DELETE', '/vuelos/' + encodeURIComponent(id)),
    /** Quita el bloqueo de ValiNest (el vuelo vuelve a «por revisar» o «revisado»). */
    releaseFlight: (id) => call('POST', '/vuelos/' + encodeURIComponent(id) + '/soltar', { forzar: true }),
    /** Sube una foto original a la bandeja temporal del vuelo; onProgress(bytes enviados). */
    uploadFlightPhoto(id, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', base + '/vuelos/' + encodeURIComponent(id) + '/fotos/' + encodeURIComponent(file.name));
        xhr.setRequestHeader('authorization', 'Bearer ' + token);
        xhr.setRequestHeader('content-type', 'image/jpeg');
        xhr.upload.onprogress = (e) => onProgress && onProgress(e.loaded);
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText); } catch { /* sin cuerpo */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new ApiError(xhr.status, data.error || 'Error ' + xhr.status));
        };
        xhr.onerror = () => reject(new ApiError(0, 'Sin conexión con el servidor'));
        xhr.send(file);
      });
    },
    image,
    /** La imagen como Blob (para el respaldo), o null si no está en la nube. */
    async imageBlob(kind, uuid) {
      let r;
      try {
        r = await fetch(base + '/archivos/' + kind + '/' + uuid, { headers: { authorization: 'Bearer ' + token } });
      } catch {
        throw new ApiError(0, 'Sin conexión con el servidor. Revisa tu internet.');
      }
      if (r.status === 404) return null;
      if (!r.ok) throw new ApiError(r.status, 'Error ' + r.status + ' al bajar una imagen');
      return r.blob();
    },
    /** Sube una imagen (al restaurar un respaldo). */
    async putImage(kind, uuid, bytes) {
      let r;
      try {
        r = await fetch(base + '/archivos/' + kind + '/' + uuid, { method: 'PUT',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'image/jpeg' }, body: bytes });
      } catch {
        throw new ApiError(0, 'Sin conexión con el servidor. Revisa tu internet.');
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(r.status, data.error || 'Error ' + r.status);
      return data;
    },
    setFlightTime: (id, hora) => call('POST', '/vuelos/' + encodeURIComponent(id) + '/hora', { hora }),
  };
}
