// Coordinador: usuarios y ajustes del campamento.

import { ROLES, roleName } from './catalog.js';
import { busy, clear, confirmBox, field, h, modal, select, showDateTime, toast } from './ui.js';

function tempPassword() {
  // Contraseña temporal legible (sin 0/O ni 1/l); la persona la cambia al entrar.
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(12));
  return [...a].map((b) => chars[b % chars.length]).join('');
}

function showTemp(usuario, pass) {
  modal('Contraseña temporal', [
    h('p', 'Entrégale estos datos a la persona. Al entrar, la página le pedirá cambiar la contraseña.'),
    h('div.temp-pass', h('div', h('b', 'Usuario: '), usuario), h('div', h('b', 'Contraseña temporal: '), h('code', pass))),
    h('p.hint', 'Esta contraseña no se vuelve a mostrar.'),
  ]);
}

export function usersView(ctx) {
  const { api, user } = ctx;
  const el = h('section.view.list-view');

  async function render() {
    clear(el).append(h('p.muted', 'Cargando…'));
    let list;
    try {
      list = (await api.users()).usuarios;
    } catch (e) {
      clear(el).append(h('p.error', e.message));
      return;
    }
    clear(el).append(
      h('div.list-head', h('h2', 'Usuarios de ' + ctx.campName), h('div.spacer'),
        h('button.btn.primary.small', { type: 'button', onclick: newUser }, '+ Nuevo usuario')),
      h('div.roles-help', ROLES.map(([, name, desc]) => h('span', h('b', name + ': '), desc))),
      h('div.table-wrap', h('table.data', h('thead', h('tr', ['Usuario', 'Nombre', 'Rol', 'Estado', 'Último acceso', ''].map((t) => h('th', t)))),
        h('tbody', list.map((u) => h('tr' + (u.activo ? '' : '.inactive'),
          h('td', u.usuario), h('td', u.nombre),
          h('td', select(ROLES.map((r) => [r[0], r[1]]), u.rol, { disabled: u.id === user.id, onchange: (e) => change(u, { rol: e.target.value }, e.target) })),
          h('td', u.activo ? (u.debe_cambiar ? 'Activo · contraseña temporal' : 'Activo') : 'Desactivado'),
          h('td', showDateTime(u.ultimo_acceso)),
          h('td.row-btns',
            h('button.btn.ghost.small', { type: 'button', onclick: () => resetPass(u) }, 'Nueva contraseña'),
            u.id !== user.id ? h('button.btn.ghost.small', { type: 'button', onclick: () => toggle(u) }, u.activo ? 'Desactivar' : 'Activar') : null)))))));
  }

  async function change(u, changes, input) {
    try {
      await api.updateUser(u.id, changes);
      toast('Cambios guardados para ' + u.usuario);
    } catch (e) {
      toast(e.message, 'error');
      if (input) input.value = u.rol;
    }
    render();
  }

  async function toggle(u) {
    if (u.activo && !(await confirmBox('Desactivar', '¿Desactivar a ' + u.nombre + '? Ya no podrá entrar y se cierran sus sesiones (sus registros se conservan).', 'Desactivar', true))) return;
    change(u, { activo: !u.activo });
  }

  async function resetPass(u) {
    if (!(await confirmBox('Nueva contraseña', 'Se generará una contraseña temporal para ' + u.nombre + ' y se cerrarán sus sesiones abiertas.', 'Generar'))) return;
    const pass = tempPassword();
    try {
      await api.updateUser(u.id, { contrasena: pass });
      showTemp(u.usuario, pass);
      render();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function newUser() {
    const usuario = h('input', { required: true, autocomplete: 'off', placeholder: 'sin espacios, p. ej. mlopez' });
    const nombre = h('input', { required: true });
    const correo = h('input', { type: 'email' });
    const rol = select(ROLES.map((r) => [r[0], r[1] + ' — ' + r[2]]), 'capturista');
    const btn = h('button.btn.primary', { type: 'submit' }, 'Crear');
    const m = modal('Nuevo usuario', h('form.form', { onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        const pass = tempPassword();
        await api.createUser({ usuario: usuario.value.trim(), nombre: nombre.value.trim(), correo: correo.value.trim() || null, rol: rol.value, contrasena: pass });
        m.close();
        showTemp(usuario.value.trim(), pass);
        render();
      });
    } },
    field('Usuario', usuario, 'Con esto entra; de 3 a 40 letras, números, punto o guion.'),
    field('Nombre completo', nombre),
    field('Correo (opcional)', correo),
    field('Rol', rol),
    h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancelar'), btn)));
  }

  return { el, show: render };
}

export function settingsView(ctx) {
  const { api, store } = ctx;
  const el = h('section.view.list-view');

  function render() {
    const s = store.settings || {};
    const beaches = h('textarea', { rows: 8, value: (s.beaches || []).join('\n') });
    const phase = select([['total', 'Solo el total de fase'], ['detalle', 'Fase 1, 2 y 3 por separado']], s.phase_mode);
    const n = (v, step = '1') => h('input', { type: 'number', step, value: v ?? '' });
    const dm = n(s.days_mydas), dc = n(s.days_caretta), mm = n(s.match_meters, '0.5'), mb = n(s.match_days_before), ma = n(s.match_days), uz = n(s.utm_zone);
    const btn = h('button.btn.primary', { type: 'submit' }, 'Guardar ajustes');
    clear(el).append(h('div.list-head', h('h2', 'Ajustes de ' + ctx.campName)),
      h('form.form.narrow', { onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => {
          const d = await api.saveSettings({
            beaches: beaches.value.split('\n').map((x) => x.trim()).filter(Boolean),
            phase_mode: phase.value,
            days_mydas: Number(dm.value), days_caretta: Number(dc.value),
            match_meters: Number(mm.value), match_days_before: Number(mb.value), match_days: Number(ma.value),
            utm_zone: Number(uz.value),
          });
          store.settings = d.ajustes;
          toast('Ajustes guardados. Las tabletas los reciben al sincronizar.');
        });
      } },
      h('fieldset', h('legend', 'Playas'), field('Una por renglón, en el orden en que deben aparecer', beaches)),
      h('fieldset', h('legend', 'Limpieza'), field('Cómo registra la fase este campamento', phase)),
      h('fieldset', h('legend', 'Fecha de eclosión estimada'),
        h('div.grid2', field('Días de incubación — Chelonia mydas', dm), field('Días de incubación — Caretta caretta', dc))),
      h('fieldset', h('legend', '«Probablemente ya registrado» (importar foto de dron)'),
        h('div.grid3', field('Distancia máxima (m)', mm), field('Días antes de la detección', mb), field('Días después', ma))),
      h('fieldset', h('legend', 'Coordenadas'), h('div.grid3', field('Zona UTM', uz, 'Cozumel = 16'))),
      h('div.actions', btn)));
  }

  return { el, show: render };
}
