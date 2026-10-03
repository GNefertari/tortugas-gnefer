// Datos del campamento en este navegador.
//
// La web es un "equipo" más: baja los cambios con la misma sincronización que usará la app
// (sync/pull desde el último rev) y los guarda en IndexedDB, así la segunda vez solo baja lo
// nuevo. Los cambios que hace la persona se suben con sync/push y luego se vuelve a bajar.

import { API } from './api.js';

const TABLES = ['flight', 'nest', 'aerial', 'cleaning', 'mask', 'photo'];

function openDb(name) {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(name, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) db.createObjectStore(t, { keyPath: 'uuid' });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);   // modo privado, etc.: se trabaja solo en memoria
  });
}

function done(tx) {
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export function createStore(api) {
  const rows = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
  let rev = 0;
  let settings = null;
  let names = {};            // user_id -> nombre (quién hizo cada cambio)
  let db = null;
  const listeners = new Set();
  // Una base por campamento y por API (la local de pruebas no se mezcla con la publicada).
  const dbName = 'tortugas-' + api.slug + (API.includes('127.0.0.1') || API.includes('localhost') ? '-local' : '');

  async function loadCache(userId) {
    db = await openDb(dbName);
    if (!db) return;
    const tx = db.transaction([...TABLES, 'meta'], 'readonly');
    const meta = tx.objectStore('meta');
    const get = (k) => new Promise((r) => { const q = meta.get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
    const owner = await get('owner');
    if (owner && owner !== userId) {
      // Otra persona usó este navegador: no se reutilizan sus datos guardados.
      tx.abort();
      await clearCache();
      return;
    }
    rev = (await get('rev')) || 0;
    settings = (await get('settings')) || null;
    await Promise.all(TABLES.map((t) => new Promise((r) => {
      const q = tx.objectStore(t).getAll();
      q.onsuccess = () => { for (const row of q.result) rows[t].set(row.uuid, row); r(); };
      q.onerror = () => r();
    })));
  }

  async function clearCache() {
    for (const t of TABLES) rows[t].clear();
    rev = 0;
    settings = null;
    if (!db) return;
    const tx = db.transaction([...TABLES, 'meta'], 'readwrite');
    for (const t of [...TABLES, 'meta']) tx.objectStore(t).clear();
    await done(tx).catch(() => {});
  }

  async function saveCache(changed, userId) {
    if (!db) return;
    const tx = db.transaction([...TABLES, 'meta'], 'readwrite');
    for (const t of TABLES) for (const r of changed[t] || []) tx.objectStore(t).put(r);
    tx.objectStore('meta').put(rev, 'rev');
    tx.objectStore('meta').put(userId, 'owner');
    if (settings) tx.objectStore('meta').put(settings, 'settings');
    await done(tx).catch(() => {});
  }

  /** Baja todo lo que cambió desde la última vez. Devuelve cuántas filas llegaron. */
  async function sync(userId, onProgress) {
    let total = 0;
    for (;;) {
      const d = await api.pull(rev);
      for (const t of TABLES) for (const r of d.filas[t] || []) rows[t].set(r.uuid, r);
      if (d.ajustes) settings = d.ajustes;
      if (d.nombres) names = d.nombres;
      const n = TABLES.reduce((s, t) => s + (d.filas[t] || []).length, 0);
      total += n;
      rev = d.hasta;
      await saveCache(d.filas, userId);
      if (onProgress) onProgress(total);
      if (!d.mas) break;
    }
    if (!settings) settings = (await api.settings()).ajustes;
    if (total) emit();
    return total;
  }

  function emit() {
    for (const fn of listeners) fn();
  }

  const live = (t) => [...rows[t].values()].filter((r) => !r.deleted);

  return {
    loadCache,
    clearCache,
    sync,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get settings() { return settings; },
    set settings(s) { settings = s; emit(); },
    get rev() { return rev; },
    userName: (id) => (id && names[id]) || null,

    nests: () => live('nest'),
    nest: (uuid) => rows.nest.get(uuid),
    cleanings: () => live('cleaning').filter((k) => { const n = rows.nest.get(k.nest_uuid); return n && !n.deleted; }),
    cleaningOf: (nestUuid) => live('cleaning').find((k) => k.nest_uuid === nestUuid) || null,
    masksOf: (nestUuid) => live('mask').filter((m) => m.nest_uuid === nestUuid),
    masks: () => live('mask'),
    photosOf: (nestUuid) => live('photo').filter((p) => p.nest_uuid === nestUuid),
    aerial: (uuid) => rows.aerial.get(uuid),
    aerials: () => live('aerial'),
    seasons: () => [...new Set(live('nest').map((n) => n.season).filter((s) => s != null))].sort((a, b) => b - a),
    beachesInUse: () => [...new Set(live('nest').map((n) => n.beach).filter(Boolean))].sort(),

    /** Sube filas nuevas o cambiadas (tabla -> [filas]) y luego baja lo que cambió. */
    async save(changes, userId) {
      const res = await api.push(changes);
      await sync(userId);
      emit();
      return res;
    },
  };
}
