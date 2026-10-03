// Vuelos de dron (paso 6a): lista, Subir vuelo y entrada a la bandeja de revisión.
//
//   - Capturista o más: ve los vuelos y sube las fotos de un vuelo nuevo (van a la bandeja temporal
//     de la nube hasta que GNeST las procese; se borran solas a los 20 días si no).
//   - Experto o más: revisa los vuelos con propuestas de GNeST (revision.js).
//   - Coordinador: ve los avisos de fotos por vencer o ya borradas, y puede borrar vuelos sin nidos.

import { can } from './catalog.js';
import { reviewView } from './revision.js';
import { busy, clear, confirmBox, field, h, select, showDate, showDateTime, toast, todayIso } from './ui.js';

const STATES = {
  subiendo: ['Subiendo fotos', ''],
  por_detectar: ['Esperando a GNeST', 'warn'],
  pendiente: ['Por revisar', 'upd'],
  en_app: ['En revisión en la app', 'upd'],
  revisado: ['Revisado', 'ok'],
};
const MB = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB');
const daysLeft = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / 86400000);

export function vuelosView(ctx) {
  const { api, store, user } = ctx;
  const el = h('section.view.list-view.vuelos');
  const put = (...nodes) => clear(el).append(...nodes.flat().filter((x) => x != null && x !== false));
  let review = null;        // bandeja abierta (para no perderla al cambiar de sección)
  let uploading = false;

  async function renderList() {
    review = null;
    put(h('p.muted', 'Cargando vuelos…'));
    let d;
    try {
      d = await api.flights();
    } catch (e) {
      put(h('p.error', e.message));
      return;
    }
    const list = d.vuelos;
    const notices = can(user, 'coordinador') ? coordinatorNotices(list, d.dias_bandeja) : [];
    put(
      h('div.list-head', h('h2', 'Vuelos'), h('span.count', list.length + ' vuelo(s)'), h('div.spacer'),
        h('button.btn.primary.small', { type: 'button', onclick: () => renderUpload(null) }, '+ Subir vuelo')),
      h('p.lead', 'Las fotos que se suben esperan a GNeST en la nube (' + d.dias_bandeja + ' días como máximo). GNeST deja sus propuestas y el experto las revisa aquí: aceptar, ya registrado o descartar. El vuelo se cierra solo al revisar la última propuesta.'),
      notices.length ? h('div.notices', notices) : null,
      list.length ? h('div.table-wrap', h('table.data.static.flights',
        h('thead', h('tr', ['', 'Fecha', 'Playa', 'Estado', 'Fotos', 'Propuestas', 'Subió'].map((t) => h('th', t)))),
        h('tbody', list.map((v) => row(v, d))))) : h('p.empty', 'Todavía no hay vuelos. Sube uno con «+ Subir vuelo».'));
  }

  function coordinatorNotices(list, days) {
    const out = [];
    for (const v of list) {
      if (v.estado === 'por_detectar' && v.bandeja_vence && !v.bandeja_borrada && daysLeft(v.bandeja_vence) <= 5) {
        out.push(h('div.notice.warn', '⚠ Las ' + v.bandeja_fotos + ' fotos del vuelo del ' + showDate(v.fecha) + ' (' + v.playa + ') se borran de la nube el '
          + showDate(v.bandeja_vence.slice(0, 10)) + ' si GNeST no las procesa antes.'));
      }
      if (v.bandeja_borrada && Date.now() - Date.parse(v.bandeja_borrada) < 30 * 86400000) {
        out.push(h('div.notice.err', '✗ Las fotos del vuelo del ' + showDate(v.fecha) + ' (' + v.playa + ') se borraron el ' + showDateTime(v.bandeja_borrada)
          + ' porque GNeST no las procesó en ' + days + ' días. Si aún las tienes, súbelas de nuevo.'));
      }
    }
    return out;
  }

  function row(v) {
    const [label, kind] = STATES[v.estado] || [v.estado, ''];
    const actions = [];
    if (can(user, 'experto') && v.fotos > 0 && ['pendiente', 'revisado', 'en_app'].includes(v.estado)) {
      actions.push(h('button.btn.small' + (v.estado === 'pendiente' ? '.primary' : '.ghost'), { type: 'button', onclick: () => openReview(v) },
        v.estado === 'pendiente' ? 'Revisar' : 'Ver'));
    }
    if (v.estado === 'pendiente' && v.pendientes === 0 && can(user, 'experto')) {
      actions.push(h('button.btn.ghost.small', { type: 'button', onclick: (e) => closeFlight(v, e.currentTarget) }, 'Cerrar vuelo'));
    }
    if (v.estado === 'subiendo' && v.origen === 'web' && v.mio) {
      actions.push(h('button.btn.ghost.small', { type: 'button', onclick: () => renderUpload(v) }, 'Continuar subida'));
    }
    if (can(user, 'coordinador') && !v.aceptadas) {
      actions.push(h('button.btn.danger.small', { type: 'button', onclick: (e) => removeFlight(v, e.currentTarget) }, 'Borrar'));
    }
    const waiting = v.estado === 'por_detectar' && v.bandeja_vence && !v.bandeja_borrada
      ? h('small.muted', v.bandeja_fotos + ' fotos en la nube (' + MB(v.bandeja_bytes) + '), se borran en ' + Math.max(0, daysLeft(v.bandeja_vence)) + ' días') : null;
    return h('tr',
      h('td.row-btns', actions),
      h('td', showDate(v.fecha)), h('td', v.playa),
      h('td', h('span.badge.' + (kind || 'plain'), label), waiting, v.bandeja_borrada ? h('small.error', 'Fotos borradas sin procesar') : null),
      h('td', String(v.fotos)),
      h('td', v.pendientes + v.aceptadas + v.descartadas
        ? (v.pendientes ? v.pendientes + ' por revisar · ' : '') + v.aceptadas + ' aceptada(s) · ' + v.descartadas + ' descartada(s)'
        : '—'),
      h('td', (v.subido_por || '—') + (v.origen === 'pc' ? ' · desde la PC' : '')));
  }

  async function closeFlight(v, btn) {
    if (!(await confirmBox('Cerrar vuelo', 'GNeST no dejó propuestas en este vuelo. ¿Marcarlo como revisado? Si viste algún nido, primero dibújalo en «Ver».', 'Cerrar vuelo'))) return;
    await busy(btn, async () => { await api.setFlightState(v.id, 'revisado'); toast('Vuelo revisado'); renderList(); });
  }

  async function removeFlight(v, btn) {
    if (!(await confirmBox('Borrar vuelo', 'Se borrará el vuelo del ' + showDate(v.fecha) + ' (' + v.playa + ') con sus fotos y propuestas de la nube. Los originales que estén en la PC no se tocan.', 'Borrar vuelo', true))) return;
    await busy(btn, async () => { await api.deleteFlight(v.id); toast('Vuelo borrado'); await store.sync(user.id); renderList(); });
  }

  async function openReview(v) {
    put(h('p.muted', 'Abriendo el vuelo…'));
    try { await store.sync(user.id); } catch { /* se trabaja con lo que hay */ }
    review = reviewView(ctx, v, () => renderList());
    put(review.el);
    review.show();
  }

  // ───────────────────────────── Subir vuelo

  function renderUpload(existing) {
    const s = store.settings || {};
    const beach = select([['', 'Elige la playa…'], ...(s.beaches || [])], existing ? existing.playa : '', { required: true, disabled: !!existing });
    const date = h('input', { type: 'date', value: existing ? existing.fecha : todayIso(), required: true, disabled: !!existing });
    const notes = h('textarea', { rows: 2, disabled: !!existing });
    const files = h('input', { type: 'file', multiple: true, accept: '.jpg,.jpeg,image/jpeg' });
    const info = h('p.hint', 'Elige todas las fotos del vuelo (.jpg). Si se corta la conexión, vuelve a elegirlas: las que ya subieron no se repiten.');
    files.addEventListener('change', () => {
      const list = [...files.files].filter((f) => /\.jpe?g$/i.test(f.name));
      const bytes = list.reduce((sum, f) => sum + f.size, 0);
      info.textContent = list.length + ' foto(s) · ' + MB(bytes) + (list.length < files.files.length ? ' (se ignoran los archivos que no son .jpg)' : '');
    });
    const btn = h('button.btn.primary', { type: 'submit' }, existing ? 'Continuar subida' : 'Subir fotos');
    put(
      h('div.list-head', h('h2', existing ? 'Continuar subida' : 'Subir vuelo'), h('div.spacer'),
        h('button.btn.ghost.small', { type: 'button', onclick: renderList }, '← Vuelos')),
      h('form.form.narrow', { onsubmit: (e) => { e.preventDefault(); start(); } },
        h('div.grid2', field('Playa *', beach), field('Fecha del vuelo *', date)),
        existing ? null : field('Notas (opcional)', notes),
        field('Fotos del dron *', files), info,
        h('p.hint', 'Usa Wi-Fi: cada foto pesa de 5 a 20 MB. No cierres esta página mientras se suben.'),
        h('div.actions', btn)));

    function start() {
      busy(btn, async () => {
        const list = [...files.files].filter((f) => /\.jpe?g$/i.test(f.name));
        if (!existing && !beach.value) throw new Error('Elige la playa');
        if (!list.length) throw new Error('Elige las fotos del vuelo');
        let v = existing;
        if (!v) v = (await api.createFlight({ fecha: date.value, playa: beach.value, notas: notes.value.trim() || null })).vuelo;
        await upload(v, list);
      });
    }
  }

  async function upload(v, list) {
    const already = new Map((await api.flightPhotos(v.id)).fotos.filter((f) => f.en_nube).map((f) => [f.nombre, f.bytes]));
    const todo = list.filter((f) => already.get(f.name) !== f.size);
    const total = todo.reduce((s, f) => s + f.size, 0);
    let sent = 0;
    const bar = h('div.progress', h('i'));
    const label = h('p.lead');
    const fail = h('p.error');
    put(h('div.list-head', h('h2', 'Subiendo fotos'), h('span.count', showDate(v.fecha) + ' · ' + v.playa)), label, bar, fail,
      h('p.hint', 'No cierres esta página. Si se corta, vuelve a «Vuelos» → «Continuar subida» y elige las mismas fotos.'));
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    uploading = true;
    try {
      for (let i = 0; i < todo.length; i++) {
        const f = todo[i];
        for (let attempt = 0; ; attempt++) {
          try {
            await api.uploadFlightPhoto(v.id, f, (n) => {
              label.textContent = 'Foto ' + (i + 1) + ' de ' + todo.length + ' · ' + MB(sent + n) + ' de ' + MB(total)
                + (already.size ? ' (ya estaban ' + (list.length - todo.length) + ')' : '');
              bar.firstChild.style.width = (100 * (sent + n) / Math.max(1, total)).toFixed(1) + '%';
            });
            break;
          } catch (e) {
            if (e.status !== 0 || attempt >= 3) throw e;
            fail.textContent = 'Se cortó la conexión; reintentando…';
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            fail.textContent = '';
          }
        }
        sent += f.size;
      }
      await api.setFlightState(v.id, 'por_detectar');
      put(h('div.list-head', h('h2', 'Vuelo subido')),
        h('p.lead', list.length + ' foto(s) del ' + showDate(v.fecha) + ' (' + v.playa + ') esperan a GNeST en la nube. Cuando la PC del detector las procese, el vuelo aparecerá «Por revisar».'),
        h('div.actions', h('button.btn.primary', { type: 'button', onclick: renderList }, 'Listo')));
    } catch (e) {
      put(h('div.list-head', h('h2', 'La subida se detuvo')),
        h('p.error', e.message),
        h('p.lead', 'Lo que alcanzó a subir ya está en la nube. Para seguir: «Vuelos» → «Continuar subida» y elige las mismas fotos.'),
        h('div.actions', h('button.btn.primary', { type: 'button', onclick: renderList }, 'Volver a Vuelos')));
    } finally {
      uploading = false;
      window.removeEventListener('beforeunload', guard);
    }
  }

  return {
    el,
    show() {
      if (uploading) return;
      if (review) { review.show(); return; }
      renderList();
    },
    destroy() { if (review && review.destroy) review.destroy(); },
  };
}
