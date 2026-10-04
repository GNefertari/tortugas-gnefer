// Web de un campamento: inicio de sesión, menú según el rol y vistas.
// Cada página (/punta-sur/, /san-martin/, /gnest/) llama a start('<campamento>').
// /gnest/ es el conjunto de datos de GNeST: un «campamento» aparte con su propia numeración.

import { usersView, settingsView } from './admin.js';
import { client, IS_LOCAL_API, API } from './api.js';
import { cargaView } from './carga.js';
import { vuelosView } from './vuelos.js';
import { can, roleName } from './catalog.js';
import { openNest } from './ficha.js';
import { createFilter } from './filters.js';
import { mapView } from './mapa.js';
import { createStore } from './store.js';
import { cleaningsView, nestsView } from './tablas.js';
import * as Coords from './coords.js';
import { coordFormat, setCoordFormat } from './prefs.js';
import { busy, clear, field, h, modal, passwordInput, toast } from './ui.js';

const CAMP_NAMES = { 'punta-sur': 'Punta Sur', 'san-martin': 'San Martín', gnest: 'GNeST' };
// Lo que va encima del nombre (barra superior, inicio de sesión y título de la pestaña).
const CAMP_KIND = { gnest: 'Conjunto de datos' };
const AUTO_SYNC_MS = 2 * 60 * 1000;

export async function start(slug) {
  const root = document.getElementById('app');
  const campName = CAMP_NAMES[slug] || slug;
  const campKind = CAMP_KIND[slug] || 'Monitoreo de nidos';
  document.title = campName + ' · ' + campKind;
  const api = client(slug);
  let teardown = () => {};   // detiene la sesión anterior (actualización automática, mapa)
  api.onUnauthorized(() => { toast('La sesión terminó. Vuelve a entrar.', 'error'); showLogin(); });

  function showLogin() {
    teardown();
    // Al salir no se recuerda dónde estaba: la siguiente persona empieza en el Mapa, sin filtros.
    history.replaceState(null, '', location.pathname + location.search);
    try { localStorage.removeItem('filtro:' + slug); } catch { /* sin almacenamiento */ }
    const usuario = h('input', { autocomplete: 'username', required: true, autofocus: true });
    const pw = passwordInput({ autocomplete: 'current-password', required: true });
    const pass = pw.input;
    const btn = h('button.btn.primary.block', { type: 'submit' }, 'Entrar');
    clear(root).append(h('div.login',
      h('div.login-card',
        h('a.brand', { href: '/' }, '🐢 Tortugas Marinas Cozumel'),
        h('p.eyebrow-dark', campKind),
        h('h1', campName),
        h('form.form', { onsubmit: (e) => {
          e.preventDefault();
          busy(btn, async () => {
            const d = await api.login(usuario.value.trim(), pass.value);
            pass.value = '';
            history.replaceState(null, '', location.pathname + location.search + '#mapa');
            if (d.usuario.debe_cambiar) showChangePassword(d.usuario, true);
            else boot(d.usuario);
          });
        } },
        field('Usuario', usuario), field('Contraseña', pw.el), btn),
        h('p.hint', 'Para crear usuario o recuperar contraseña, contacta al coordinador.'),
        IS_LOCAL_API ? h('p.warn', 'Usando la API de pruebas: ' + API) : null)));
    usuario.focus();
  }

  function showChangePassword(user, forced) {
    const pa = passwordInput({ autocomplete: 'current-password', required: true });
    const pn = passwordInput({ autocomplete: 'new-password', required: true, minLength: 8 });
    const pr = passwordInput({ autocomplete: 'new-password', required: true });
    const actual = pa.input, nueva = pn.input, repite = pr.input;
    const btn = h('button.btn.primary', { type: 'submit' }, 'Cambiar contraseña');
    const form = h('form.form', { onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        if (nueva.value !== repite.value) throw new Error('Las contraseñas nuevas no coinciden');
        await api.changePassword(actual.value, nueva.value);
        toast('Contraseña cambiada');
        if (forced) boot({ ...user, debe_cambiar: false });
        else m.close();
      });
    } },
    forced ? h('p', 'Tu contraseña es temporal. Elige una nueva para continuar.') : null,
    field(forced ? 'Contraseña temporal' : 'Contraseña actual', pa.el),
    field('Nueva contraseña', pn.el, 'Mínimo 8 caracteres'),
    field('Repite la nueva', pr.el),
    h('div.actions', forced ? h('button.btn.ghost', { type: 'button', onclick: () => api.logout().then(showLogin) }, 'Salir') : null, btn));
    let m;
    if (forced) clear(root).append(h('div.login', h('div.login-card', h('h1', 'Hola, ' + user.nombre), form)));
    else m = modal('Cambiar mi contraseña', form);
  }

  async function boot(user) {
    const store = createStore(api);
    const filter = createFilter(slug);
    const ctx = { slug, campName, api, store, filter, user };
    ctx.openNest = (uuid) => openNest(ctx, uuid);
    ctx.showOnMap = (n) => { go('mapa'); setTimeout(() => views.mapa.focus(n), 100); };

    const sections = [
      ['mapa', 'Mapa', () => mapView(ctx)],
      ['nidos', 'Nidos', () => nestsView(ctx)],
      ['limpiezas', 'Limpiezas', () => cleaningsView(ctx)],
      ...(can(user, 'capturista') ? [['vuelos', 'Vuelos', () => vuelosView(ctx)]] : []),
    ];
    if (can(user, 'experto')) sections.push(['carga', 'Cargar Excel', () => cargaView(ctx)]);
    if (can(user, 'coordinador')) sections.push(['usuarios', 'Usuarios', () => usersView(ctx)], ['ajustes', 'Ajustes', () => settingsView(ctx)]);
    const views = {};
    const syncInfo = h('span.sync');
    const nav = h('nav.tabs', sections.map(([id, label]) => h('a', { href: '#' + id, 'data-id': id }, label)));
    const main = h('main');
    const menu = h('details.user-menu',
      h('summary', h('span.avatar', (user.nombre || '?')[0].toUpperCase()), h('span.who', user.nombre, h('small', roleName(user.rol)))),
      h('div.menu',
        h('div.menu-label', 'Formato de coordenadas'),
        Coords.FORMATS.map(([f, label]) => h('button.fmt', { type: 'button', 'data-fmt': f, onclick: () => {
          setCoordFormat(f);
          for (const b of menu.querySelectorAll('.fmt')) b.classList.toggle('on', b.dataset.fmt === f);
          toast('Coordenadas en ' + label.toLowerCase());
        } }, label)),
        h('hr'),
        h('button', { type: 'button', onclick: () => showChangePassword(user, false) }, 'Cambiar mi contraseña'),
        h('button', { type: 'button', onclick: async () => { teardown(); await store.clearCache(); await api.logout(); showLogin(); } }, 'Cerrar sesión')));
    for (const b of menu.querySelectorAll('.fmt')) b.classList.toggle('on', b.dataset.fmt === coordFormat());
    clear(root).append(
      h('header.topbar',
        h('a.brand', { href: '/', title: 'Tortugas Marinas Cozumel' }, '🐢'),
        h('div.camp', h('small', campKind), h('b', campName)),
        nav,
        h('div.spacer'),
        syncInfo,
        h('button.icon-btn', { type: 'button', title: 'Actualizar', onclick: () => doSync(true) }, '⟳'),
        menu),
      main);

    function go(id) {
      if (!sections.find((s) => s[0] === id)) id = 'mapa';
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.id === id);
      if (!views[id]) views[id] = sections.find((s) => s[0] === id)[2]();
      clear(main).append(views[id].el);
      views[id].show();
    }
    window.onhashchange = () => go(location.hash.slice(1));

    let syncing = false;
    async function doSync(manual) {
      if (syncing) return;
      syncing = true;
      syncInfo.textContent = 'Actualizando…';
      try {
        const n = await store.sync(user.id, (k) => { syncInfo.textContent = 'Bajando… ' + k; });
        syncInfo.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        if (manual) toast(n ? n + ' cambio(s) nuevo(s)' : 'Todo al día');
      } catch (e) {
        syncInfo.textContent = 'Sin conexión';
        if (manual || e.status !== 0) toast(e.message, 'error');
      } finally {
        syncing = false;
      }
    }

    await store.loadCache(user.id);
    go(location.hash.slice(1) || 'mapa');
    await doSync(false);
    if (store.settings) go(location.hash.slice(1) || 'mapa');
    const timer = setInterval(() => { if (document.visibilityState === 'visible') doSync(false); }, AUTO_SYNC_MS);
    teardown = () => {
      clearInterval(timer);
      window.onhashchange = null;
      for (const v of Object.values(views)) if (v.destroy) v.destroy();
      teardown = () => {};
    };
  }

  // Al abrir: si ya hay sesión en este navegador, entrar directo.
  if (api.loggedIn) {
    try {
      const d = await api.me();
      if (d.usuario.debe_cambiar) showChangePassword(d.usuario, true);
      else boot(d.usuario);
      return;
    } catch {
      /* sesión vencida: pedir datos */
    }
  }
  showLogin();
}

