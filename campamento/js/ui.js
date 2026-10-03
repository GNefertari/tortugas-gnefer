// Utilidades de interfaz. Todo el texto se pone con textContent (nunca HTML armado con
// datos), así nada de lo que escriba alguien en una nota se ejecuta en la página.

/** h('div.clase#id', {atributos}, hijos...) */
export function h(tag, attrs, ...children) {
  const [, name, rest] = tag.match(/^([a-z0-9]+)(.*)$/i);
  const el = document.createElement(name);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ───────────────────────────── avisos y ventanas

export function toast(msg, kind = 'ok') {
  // Las ventanas (<dialog>) van en la "capa superior" del navegador; el aviso también
  // (popover), y se vuelve a mostrar para quedar encima de la ventana más reciente.
  let box = document.querySelector('.toasts');
  if (!box) {
    document.body.append(box = h('div.toasts'));
    if (box.showPopover) box.popover = 'manual';
  }
  if (box.showPopover) {
    try { box.hidePopover(); } catch { /* no estaba visible */ }
    box.showPopover();
  }
  const t = h('div.toast.' + kind, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3000);
  setTimeout(() => t.remove(), kind === 'error' ? 6600 : 3600);
}

/** Ventana modal. Devuelve {el, close}. */
export function modal(title, body, { wide = false, onClose } = {}) {
  const dlg = h('dialog.modal' + (wide ? '.wide' : ''));
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.append(h('div.modal-head', h('h2', title), h('button.icon-btn', { type: 'button', title: 'Cerrar', onclick: close }, '✕')),
    h('div.modal-body', body));
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmBox(title, text, okText = 'Aceptar', danger = false) {
  return new Promise((resolve) => {
    let answer = false;
    const m = modal(title, [
      h('p', text),
      h('div.actions',
        h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancelar'),
        h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => { answer = true; m.close(); } }, okText)),
    ], { onClose: () => resolve(answer) });
  });
}

/** Botón que se deshabilita mientras corre la acción y muestra el error si falla. */
export async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Un momento…';
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), 'error');
    return undefined;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ───────────────────────────── fechas

/** "2026-09-10" -> "10/09/2026" */
export function showDate(iso) {
  if (!iso || iso.length < 10) return '—';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}

export function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function addDays(iso, days) {
  if (!iso || !(days > 0)) return null;
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Marca de tiempo UTC como la de la app: "2026-10-03T16:05:11Z" */
export function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function showDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

/** Compara números de nido como números cuando lo son ("2" antes que "10"). */
export function byNumber(a, b) {
  const na = /^\d+$/.test(a) ? Number(a) : Infinity, nb = /^\d+$/.test(b) ? Number(b) : Infinity;
  return na !== nb ? na - nb : String(a).localeCompare(String(b), 'es');
}

/** Campo de contraseña con botón para mostrarla u ocultarla. Devuelve {el, input}. */
export function passwordInput(attrs = {}) {
  const input = h('input', { type: 'password', ...attrs });
  const eye = h('button.eye', { type: 'button', title: 'Mostrar contraseña', 'aria-label': 'Mostrar contraseña', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? 'Ocultar' : 'Ver';
    eye.title = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
    input.focus();
  } }, 'Ver');
  return { el: h('div.password', input, eye), input };
}

export function field(label, input, hint) {
  return h('label.field', h('span.label', label), input, hint ? h('span.hint', hint) : null);
}

export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    s.append(h('option', { value: v, selected: String(v) === String(value ?? '') }, t));
  }
  return s;
}

export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
