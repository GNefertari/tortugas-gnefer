// ══ CONFIGURACIÓN ══
const SUPA_URL  = 'https://fblqqmmynxifdfkantjk.supabase.co';
const SUPA_ANON = 'sb_publishable_zeaVV7aC1dOXMFrm_gV0uw_OSRYvaYp';
const sb = supabase.createClient(SUPA_URL, SUPA_ANON);

// ══ UTM → LATLNG ══
proj4.defs('EPSG:32616', '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs');
function utmToLatLng(x, y) {
  const [lng, lat] = proj4('EPSG:32616', 'WGS84', [+x, +y]);
  return [lat, lng];
}

// ══ HELPERS ══
function temporadaDe(fecha) { return fecha ? new Date(fecha).getFullYear().toString() : '—'; }
function hoy() { return new Date().toISOString().split('T')[0]; }

// ══ ESTADO GLOBAL ══
let map, allNidos = [], markers = [], limpiezaIds = new Set();
let sortCol = 'numero_nido', sortAsc = true;
let sortColL = 'fecha_limpieza', sortAscL = false;
let allLimpiezas = [];
let currentRol = 'viewer';

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  const msg   = document.getElementById('login-msg');
  msg.textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { msg.className = 'err'; msg.textContent = 'Correo o contraseña incorrectos.'; return; }
  iniciarApp();
}

async function logout() {
  await sb.auth.signOut();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
}

async function mostrarRecuperar() {
  const email = document.getElementById('login-email').value.trim();
  const msg   = document.getElementById('login-msg');
  if (!email) { msg.className = 'err'; msg.textContent = 'Escribe tu correo primero.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) { msg.className = 'err'; msg.textContent = 'Error: ' + error.message; return; }
  msg.className = 'ok'; msg.textContent = 'Revisa tu correo para restablecer la contraseña.';
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

sb.auth.getSession().then(({ data: { session } }) => {
  if (session) iniciarApp();
});

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
async function iniciarApp() {
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil }   = await sb.from('perfiles').select('rol,nombre,email').eq('id', user.id).single();
  currentRol = perfil?.rol || 'viewer';

  document.getElementById('user-nombre').textContent    = perfil?.nombre || perfil?.email || user.email;
  document.getElementById('user-rol-label').textContent = currentRol.toUpperCase();
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display          = 'flex';

  const esEditor = currentRol === 'editor' || currentRol === 'admin';
  const esAdmin  = currentRol === 'admin';
  document.getElementById('nav-registrar').style.display = esEditor ? '' : 'none';
  document.getElementById('nav-limpieza').style.display  = esEditor ? '' : 'none';
  document.getElementById('nav-excel').style.display     = esEditor ? '' : 'none';
  document.getElementById('nav-admin').style.display     = esAdmin  ? '' : 'none';

  document.getElementById('mob-registrar').style.display = esEditor ? '' : 'none';
  document.getElementById('mob-limpieza').style.display  = esEditor ? '' : 'none';
  document.getElementById('mob-excel').style.display     = esEditor ? '' : 'none';
  document.getElementById('mob-admin').style.display     = esAdmin  ? '' : 'none';

  initMap();
  await cargarDatos();
  if (esAdmin) cargarUsuarios();
}

// ══════════════════════════════════════════
// MAPA
// ══════════════════════════════════════════
function initMap() {
  if (map) return;
  map = L.map('map').setView([20.3576, -86.8995], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(map);
}

function colorNido(n, lim) {
  if (n.es_nido_salvaje) return '#9E9E9E';
  if (n.fue_depredado)   return '#D95F5F';
  if (lim)               return '#E8914A';
  return '#4CAF82';
}

function renderMarkers(nidos, limSet) {
  markers.forEach(m => m.remove()); markers = [];
  nidos.forEach(n => {
    if (!n.coord_x || !n.coord_y) return;
    try {
      const [lat, lng] = utmToLatLng(n.coord_x, n.coord_y);
      if (isNaN(lat) || isNaN(lng)) return;
      const color = colorNido(n, limSet.has(n.id));
      const c = L.circleMarker([lat, lng], {
        radius: 9, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: .9
      }).addTo(map);
      c.bindPopup(`<strong>Nido #${n.numero_nido}</strong> <span style="font-size:.75rem;color:#4A86AD">${temporadaDe(n.fecha)}</span><br>
        <em>${n.especie || '—'}</em><br>Playa: ${n.playa || '—'}<br>
        Fecha: ${n.fecha || '—'}<br>Eclosión est.: ${n.fecha_eclosion_estimada || '—'}<br>
        <a href="#" onclick="abrirDetalleNido('${n.id}');return false;" style="font-size:.8rem;font-weight:600">Ver detalle completo →</a>`);
      markers.push(c);
    } catch(e) {}
  });
}

function applyFilters() {
  const nidoF = document.getElementById('f-nido').value;
  const esp   = document.getElementById('f-especie').value;
  const pla   = document.getElementById('f-playa').value;
  const est   = document.getElementById('f-estado').value;
  const tmp   = document.getElementById('f-temporada').value;
  const des   = document.getElementById('f-desde').value;
  const has   = document.getElementById('f-hasta').value;

  const filtered = allNidos.filter(n => {
    if (nidoF && String(n.numero_nido) !== nidoF) return false;
    if (esp && n.especie !== esp) return false;
    if (pla && n.playa   !== pla) return false;
    if (des && n.fecha   <  des)  return false;
    if (has && n.fecha   >  has)  return false;
    if (tmp && temporadaDe(n.fecha) !== tmp) return false;
    if (est) {
      if (est === 'salvaje'     && !n.es_nido_salvaje)                                      return false;
      if (est === 'depredado'   && !n.fue_depredado)                                        return false;
      if (est === 'eclosionado' && !limpiezaIds.has(n.id))                                  return false;
      if (est === 'incubando'   && (n.fue_depredado || n.es_nido_salvaje || limpiezaIds.has(n.id))) return false;
    }
    return true;
  });
  renderMarkers(filtered, limpiezaIds);
}

function limpiarFiltrosMapa() {
  ['f-nido','f-especie','f-playa','f-estado','f-temporada','f-desde','f-hasta']
    .forEach(id => document.getElementById(id).value = '');
  applyFilters();
}

function toggleFiltros() {
  const body  = document.getElementById('filtros-body');
  const arrow = document.getElementById('filtros-arrow');
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : 'flex';
  if (!visible) { body.style.flexDirection = 'column'; body.style.gap = '.55rem'; }
  arrow.textContent = visible ? '▼' : '▲';
}

// ══════════════════════════════════════════
// DATOS
// ══════════════════════════════════════════
async function cargarDatos() {
  const { data: nidos }     = await sb.from('monitoreo').select('*').order('numero_nido');
  const { data: limpiezas } = await sb.from('limpieza').select('*').order('fecha_limpieza', { ascending: false });
  allNidos     = nidos || [];
  allLimpiezas = limpiezas || [];
  limpiezaIds  = new Set(allLimpiezas.map(l => l.id_monitoreo));
  renderMarkers(allNidos, limpiezaIds);
  poblarTemporadas();
  poblarFiltrosDescarga();
  filtrarTabla();
  filtrarTablaLimpiezas();
  filtrarDescarga();
  poblarSelectorNido(allNidos);
}

function poblarTemporadas() {
  const years = [...new Set(allNidos.map(n => temporadaDe(n.fecha)).filter(t => t !== '—'))].sort((a,b) => b - a);
  ['f-temporada','rt-temporada','rl-temporada'].forEach(id => {
    const sel = document.getElementById(id);
    const val = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    years.forEach(y => { const o = document.createElement('option'); o.value = o.textContent = y; sel.appendChild(o); });
    sel.value = val;
  });
}

function poblarSelectorNido(nidos) {
  const sel = document.getElementById('l-nido');
  sel.innerHTML = '<option value="">— Seleccionar nido —</option>';
  nidos.forEach(n => {
    const o = document.createElement('option');
    o.value = n.id;
    o.textContent = `#${n.numero_nido} (${temporadaDe(n.fecha)}) — ${n.playa || ''} ${n.fecha || ''}`;
    sel.appendChild(o);
  });
}

// ══════════════════════════════════════════
// TABLA REGISTROS
// ══════════════════════════════════════════
function estadoNido(n) {
  if (n.es_nido_salvaje)          return { label: 'Salvaje',     badge: 'badge-gray' };
  if (n.fue_depredado)            return { label: 'Depredado',   badge: 'badge-red' };
  if (limpiezaIds.has(n.id))      return { label: 'Eclosionado', badge: 'badge-orange' };
  return                                 { label: 'Incubando',   badge: 'badge-green' };
}

function filtrarTabla() {
  const esp = document.getElementById('rt-especie').value;
  const pla = document.getElementById('rt-playa').value;
  const est = document.getElementById('rt-estado').value;
  const tmp = document.getElementById('rt-temporada').value;
  const des = document.getElementById('rt-desde').value;
  const has = document.getElementById('rt-hasta').value;

  let filtered = allNidos.filter(n => {
    if (esp && n.especie !== esp) return false;
    if (pla && n.playa   !== pla) return false;
    if (des && n.fecha   <  des)  return false;
    if (has && n.fecha   >  has)  return false;
    if (tmp && temporadaDe(n.fecha) !== tmp) return false;
    if (est) {
      const s = estadoNido(n).label.toLowerCase();
      if (est === 'incubando'   && s !== 'incubando')   return false;
      if (est === 'eclosionado' && s !== 'eclosionado') return false;
      if (est === 'depredado'   && s !== 'depredado')   return false;
      if (est === 'salvaje'     && s !== 'salvaje')      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    if (typeof va === 'number') return sortAsc ? va - vb : vb - va;
    return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  renderTabla(filtered);
}

function sortTabla(col) {
  sortCol === col ? sortAsc = !sortAsc : (sortCol = col, sortAsc = true);
  filtrarTabla();
}

function limpiarFiltrosTabla() {
  ['rt-especie','rt-playa','rt-estado','rt-temporada','rt-desde','rt-hasta']
    .forEach(id => document.getElementById(id).value = '');
  filtrarTabla();
}

function renderTabla(nidos) {
  const tbody    = document.getElementById('tabla-body');
  const esEditor = currentRol === 'editor' || currentRol === 'admin';
  if (!nidos.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--ink-lt);padding:2rem">Sin registros.</td></tr>`;
    return;
  }
  tbody.innerHTML = nidos.map(n => {
    const { label, badge } = estadoNido(n);
    const temp    = temporadaDe(n.fecha);
    const numCell = `<span class="nido-link" onclick="abrirDetalleNido('${n.id}')">${n.numero_nido}</span>`;
    return `<tr>
      <td>${numCell}</td>
      <td>${n.fecha || '—'}</td>
      <td>${temp}</td>
      <td>${n.playa || '—'}</td>
      <td><em>${n.especie || '—'}</em></td>
      <td>${n.zona || '—'}</td>
      <td>${n.accion || '—'}</td>
      <td>${n.fecha_eclosion_estimada || '—'}</td>
      <td>${n.brigada || '—'}</td>
      <td>${n.es_nido_salvaje ? '✓' : '—'}</td>
      <td>${n.fue_depredado   ? '✓' : '—'}</td>
      <td><span class="badge ${badge}">${label}</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
// TABLA LIMPIEZAS
// ══════════════════════════════════════════
function limpiezaConNido(l) {
  const n = allNidos.find(x => x.id === l.id_monitoreo) || {};
  return { ...l, numero_nido: n.numero_nido, playa: n.playa, especie: n.especie, _temporada: temporadaDe(n.fecha) };
}

function filtrarTablaLimpiezas() {
  const esp = document.getElementById('rl-especie').value;
  const pla = document.getElementById('rl-playa').value;
  const tmp = document.getElementById('rl-temporada').value;
  const des = document.getElementById('rl-desde').value;
  const has = document.getElementById('rl-hasta').value;

  let filtered = allLimpiezas.map(limpiezaConNido).filter(l => {
    if (esp && l.especie !== esp) return false;
    if (pla && l.playa   !== pla) return false;
    if (des && l.fecha_limpieza < des) return false;
    if (has && l.fecha_limpieza > has) return false;
    if (tmp && l._temporada !== tmp) return false;
    return true;
  });

  filtered.sort((a, b) => {
    let va = a[sortColL] ?? '', vb = b[sortColL] ?? '';
    if (typeof va === 'number') return sortAscL ? va - vb : vb - va;
    return sortAscL ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  renderTablaLimpiezas(filtered);
}

function sortTablaLimpiezas(col) {
  sortColL === col ? sortAscL = !sortAscL : (sortColL = col, sortAscL = true);
  filtrarTablaLimpiezas();
}

function limpiarFiltrosLimpiezas() {
  ['rl-especie','rl-playa','rl-temporada','rl-desde','rl-hasta']
    .forEach(id => document.getElementById(id).value = '');
  filtrarTablaLimpiezas();
}

function renderTablaLimpiezas(limpiezas) {
  const tbody    = document.getElementById('tabla-limpiezas-body');
  const esEditor = currentRol === 'editor' || currentRol === 'admin';
  if (!limpiezas.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:var(--ink-lt);padding:2rem">Sin registros.</td></tr>`;
    return;
  }
  tbody.innerHTML = limpiezas.map(l => {
    const numCell = l.id_monitoreo
      ? `<span class="nido-link" onclick="abrirDetalleNido('${l.id_monitoreo}')">${l.numero_nido ?? '—'}</span>`
      : (l.numero_nido ?? '—');
    return `<tr>
      <td>${numCell}</td>
      <td>${l.playa || '—'}</td>
      <td><em>${l.especie || '—'}</em></td>
      <td>${l.fecha_limpieza || '—'}</td>
      <td>${l.tortugas_vivas ?? 0}</td>
      <td>${l.tortugas_muertas ?? 0}</td>
      <td>${l.cascarones ?? 0}</td>
      <td>${l.huevos_no_eclosionados ?? 0}</td>
      <td>${l.huevos_rosa ?? 0}</td>
      <td>${l.huevos_fase1 ?? 0}</td>
      <td>${l.huevos_fase2 ?? 0}</td>
      <td>${l.huevos_fase3 ?? 0}</td>
      <td>${l.observaciones || '—'}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
// MODAL DETALLE NIDO
// ══════════════════════════════════════════
function abrirDetalleNido(id) {
  const n = allNidos.find(x => x.id === id); if (!n) return;
  const { label, badge } = estadoNido(n);
  const temp = temporadaDe(n.fecha);
  const esEditor = currentRol === 'editor' || currentRol === 'admin';
  const limpiezasNido = allLimpiezas.filter(l => l.id_monitoreo === id)
    .sort((a, b) => String(b.fecha_limpieza).localeCompare(String(a.fecha_limpieza)));

  const fila = (label, val) => `<div><span style="font-size:.72rem;color:var(--ink-lt);text-transform:uppercase;letter-spacing:.04em">${label}</span><br>${val ?? '—'}</div>`;

  let limpiezasHtml = '<p style="color:var(--ink-lt);font-size:.88rem">Este nido aún no tiene limpiezas registradas.</p>';
  if (limpiezasNido.length) {
    const totales = limpiezasNido.reduce((acc, l) => {
      acc.vivas += l.tortugas_vivas || 0; acc.muertas += l.tortugas_muertas || 0;
      acc.cascarones += l.cascarones || 0; acc.noEclo += l.huevos_no_eclosionados || 0;
      acc.rosa += l.huevos_rosa || 0;
      acc.fase1 += l.huevos_fase1 || 0; acc.fase2 += l.huevos_fase2 || 0; acc.fase3 += l.huevos_fase3 || 0;
      return acc;
    }, { vivas:0, muertas:0, cascarones:0, noEclo:0, rosa:0, fase1:0, fase2:0, fase3:0 });
    const totalHuevos = totales.cascarones + totales.noEclo + totales.rosa + totales.fase1 + totales.fase2 + totales.fase3;

    // TODO: % de eclosión — desactivado hasta confirmar la fórmula exacta con
    // CONANP. Fórmula provisional que se usó antes:
    // const pctEclosion = totalHuevos ? ((totales.cascarones / totalHuevos) * 100).toFixed(1) : null;

    limpiezasHtml = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:1rem;background:var(--sand);padding:.8rem;border-radius:7px">
        ${fila('Tortugas vivas', totales.vivas)}
        ${fila('Tortugas muertas', totales.muertas)}
        ${fila('Cascarones', totales.cascarones)}
        ${fila('No eclosionados', totales.noEclo)}
        ${fila('Huevos rosa', totales.rosa)}
        ${fila('Huevos fase 1', totales.fase1)}
        ${fila('Huevos fase 2', totales.fase2)}
        ${fila('Huevos fase 3', totales.fase3)}
      </div>
      <div class="table-wrap" style="box-shadow:none;border:1px solid var(--sand-dk)">
        <table style="font-size:.78rem">
          <thead><tr><th>Fecha</th><th>Vivas</th><th>Muertas</th><th>Cascar.</th><th>No ecl.</th><th>Rosa</th><th>Fase 1</th><th>Fase 2</th><th>Fase 3</th><th>Obs.</th></tr></thead>
          <tbody>${limpiezasNido.map(l => `<tr>
            <td>${l.fecha_limpieza || '—'}</td><td>${l.tortugas_vivas ?? 0}</td><td>${l.tortugas_muertas ?? 0}</td>
            <td>${l.cascarones ?? 0}</td><td>${l.huevos_no_eclosionados ?? 0}</td><td>${l.huevos_rosa ?? 0}</td>
            <td>${l.huevos_fase1 ?? 0}</td><td>${l.huevos_fase2 ?? 0}</td><td>${l.huevos_fase3 ?? 0}</td><td>${l.observaciones || '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  document.getElementById('detalle-titulo').innerHTML = `Nido #${n.numero_nido} <span class="badge ${badge}" style="margin-left:.5rem">${label}</span> <span style="font-size:.8rem;color:var(--ink-lt);font-weight:400">— Temporada ${temp}</span>`;
  document.getElementById('detalle-contenido').innerHTML = `
    <p class="section-label" style="margin-bottom:.6rem">Datos del nido</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-bottom:1.1rem">
      ${fila('Playa', n.playa)}
      ${fila('Especie', n.especie)}
      ${fila('Fecha de registro', n.fecha)}
      ${fila('Zona', n.zona)}
      ${fila('Acción', n.accion)}
      ${fila('Eclosión estimada', n.fecha_eclosion_estimada)}
      ${fila('Coord. X (UTM)', n.coord_x)}
      ${fila('Coord. Y (UTM)', n.coord_y)}
      ${fila('Brigada', n.brigada)}
      ${fila('Nido salvaje', n.es_nido_salvaje ? 'Sí' : 'No')}
      ${fila('Depredado', n.fue_depredado ? 'Sí' : 'No')}
    </div>
    ${n.observaciones ? `<p class="section-label">Observaciones del nido</p><p style="font-size:.9rem;margin-bottom:1.1rem">${n.observaciones}</p>` : ''}
    ${(n.largo_total || n.largo_curvo || n.ancho_curvo || n.obs_tortuga) ? `
      <p class="section-label" style="margin-bottom:.6rem">Datos de la tortuga anidadora</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-bottom:1.1rem">
        ${fila('Largo total (cm)', n.largo_total)}
        ${fila('Largo curvo (cm)', n.largo_curvo)}
        ${fila('Ancho curvo (cm)', n.ancho_curvo)}
      </div>
      ${n.obs_tortuga ? `<p style="font-size:.9rem;margin-bottom:1.1rem">${n.obs_tortuga}</p>` : ''}` : ''}
    <p class="section-label" style="margin-bottom:.6rem">Limpiezas registradas</p>
    ${limpiezasHtml}
  `;
  const accionLimpieza = limpiezasNido.length === 1
    ? `<button class="btn btn-primary btn-sm" onclick="cerrarModal('detalle-modal');abrirEdicionLimpieza('${limpiezasNido[0].id}')">Editar limpieza</button>`
    : limpiezasNido.length > 1
      ? `<div class="dropdown-wrap">
           <button class="btn btn-primary btn-sm" onclick="toggleDropdown('limpieza-dropdown')">Editar limpieza ▾</button>
           <div class="dropdown-menu" id="limpieza-dropdown">
             ${limpiezasNido.map(l => `<button onclick="cerrarModal('detalle-modal');abrirEdicionLimpieza('${l.id}')">${l.fecha_limpieza || 'Sin fecha'}</button>`).join('')}
           </div>
         </div>`
      : '';

  document.getElementById('detalle-actions').innerHTML = esEditor
    ? `<button class="btn btn-primary btn-sm" onclick="cerrarModal('detalle-modal');abrirEdicion('${n.id}')">Editar nido</button>
       ${accionLimpieza}
       <button class="btn btn-secondary btn-sm" onclick="cerrarModal('detalle-modal')">Cerrar</button>`
    : `<button class="btn btn-secondary btn-sm" onclick="cerrarModal('detalle-modal')">Cerrar</button>`;
  document.getElementById('detalle-modal').classList.add('open');
}

// ══════════════════════════════════════════
// DESCARGAR REGISTROS
// ══════════════════════════════════════════
const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function poblarFiltrosDescarga() {
  const selTemp = document.getElementById('dl-temporada');
  const anios = [...new Set(allNidos.map(n => temporadaDe(n.fecha)).filter(a => a !== '—'))].sort((a, b) => b - a);
  selTemp.innerHTML = `<option value="" selected disabled>Seleccionar</option><option value="todos">Todos los años</option>` + anios.map(a => `<option>${a}</option>`).join('');

  const selMes = document.getElementById('dl-mes');
  const meses = [...new Set(allNidos.map(n => (n.fecha || '').slice(5, 7)).filter(m => m))].sort();
  selMes.innerHTML = `<option value="" selected disabled>Seleccionar</option><option value="todos">Todos los meses</option>` + meses.map(m => `<option value="${m}">${MESES_NOMBRE[parseInt(m,10)-1]}</option>`).join('');
}

function obtenerRegistrosFiltrados() {
  const temp = document.getElementById('dl-temporada').value;
  const mes  = document.getElementById('dl-mes').value;
  const esp  = document.getElementById('dl-especie').value;
  const pla  = document.getElementById('dl-playa').value;

  const nidos = allNidos.filter(n => {
    if (temp && temp !== 'todos' && temporadaDe(n.fecha) !== temp) return false;
    if (mes  && mes  !== 'todos' && (n.fecha || '').slice(5, 7) !== mes) return false;
    if (esp  && esp  !== 'todos' && n.especie !== esp) return false;
    if (pla  && pla  !== 'todos' && n.playa   !== pla) return false;
    return true;
  });
  const ids = new Set(nidos.map(n => n.id));
  const limpiezas = allLimpiezas.filter(l => ids.has(l.id_monitoreo));

  const hayFiltro = !!(temp || mes || esp || pla); // cualquier valor no vacío cuenta, incluido "todos"
  return { nidos, limpiezas, hayFiltro };
}

function filtrarDescarga() {
  const { nidos, limpiezas, hayFiltro } = obtenerRegistrosFiltrados();
  renderTablaDescargaNidos(nidos);
  renderTablaDescargaLimpiezas(limpiezas);

  const btn = document.getElementById('btn-descargar-registros');
  btn.disabled = !hayFiltro;
  btn.classList.toggle('activo', hayFiltro);
  btn.classList.toggle('inactivo', !hayFiltro);
}

function limpiarFiltrosDescarga() {
  ['dl-temporada', 'dl-mes', 'dl-especie', 'dl-playa'].forEach(id => document.getElementById(id).selectedIndex = 0);
  filtrarDescarga();
}

function renderTablaDescargaNidos(nidos) {
  const tbody = document.getElementById('tabla-descarga-nidos-body');
  if (!nidos.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--ink-lt);padding:2rem">Sin registros para estos filtros.</td></tr>`;
    return;
  }
  tbody.innerHTML = nidos.map(n => {
    const { label, badge } = estadoNido(n);
    const temp = temporadaDe(n.fecha);
    return `<tr>
      <td><span class="nido-link" onclick="abrirDetalleNido('${n.id}')">${n.numero_nido}</span></td>
      <td>${n.fecha || '—'}</td>
      <td>${temp}</td>
      <td>${n.playa || '—'}</td>
      <td><em>${n.especie || '—'}</em></td>
      <td>${n.zona || '—'}</td>
      <td>${n.accion || '—'}</td>
      <td>${n.fecha_eclosion_estimada || '—'}</td>
      <td>${n.brigada || '—'}</td>
      <td>${n.es_nido_salvaje ? '✓' : '—'}</td>
      <td>${n.fue_depredado   ? '✓' : '—'}</td>
      <td><span class="badge ${badge}">${label}</span></td>
    </tr>`;
  }).join('');
}

function renderTablaDescargaLimpiezas(limpiezas) {
  const tbody   = document.getElementById('tabla-descarga-limpiezas-body');
  const conNido = limpiezas.map(limpiezaConNido);
  if (!conNido.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:var(--ink-lt);padding:2rem">Sin registros para estos filtros.</td></tr>`;
    return;
  }
  tbody.innerHTML = conNido.map(l => `<tr>
    <td><span class="nido-link" onclick="abrirDetalleNido('${l.id_monitoreo}')">${l.numero_nido ?? '—'}</span></td>
    <td>${l.playa || '—'}</td>
    <td><em>${l.especie || '—'}</em></td>
    <td>${l.fecha_limpieza || '—'}</td>
    <td>${l.tortugas_vivas ?? 0}</td>
    <td>${l.tortugas_muertas ?? 0}</td>
    <td>${l.cascarones ?? 0}</td>
    <td>${l.huevos_no_eclosionados ?? 0}</td>
    <td>${l.huevos_rosa ?? 0}</td>
    <td>${l.huevos_fase1 ?? 0}</td>
    <td>${l.huevos_fase2 ?? 0}</td>
    <td>${l.huevos_fase3 ?? 0}</td>
    <td>${l.observaciones || '—'}</td>
  </tr>`).join('');
}

async function generarExcelDescarga() {
  const { nidos, limpiezas, hayFiltro } = obtenerRegistrosFiltrados();
  if (!hayFiltro) return; // seguridad extra, aunque el botón ya está desactivado

  const wb = new ExcelJS.Workbook();

  const hojaM = wb.addWorksheet('Monitoreo');
  hojaM.columns = [
    { header: 'numero_nido', key: 'numero_nido', width: 14 },
    { header: 'playa', key: 'playa', width: 16 },
    { header: 'fecha', key: 'fecha', width: 14 },
    { header: 'temporada', key: 'temporada', width: 12 },
    { header: 'zona', key: 'zona', width: 8 },
    { header: 'accion', key: 'accion', width: 8 },
    { header: 'especie', key: 'especie', width: 18 },
    { header: 'coord_x', key: 'coord_x', width: 12 },
    { header: 'coord_y', key: 'coord_y', width: 12 },
    { header: 'fecha_eclosion_estimada', key: 'fecha_eclosion_estimada', width: 20 },
    { header: 'brigada', key: 'brigada', width: 16 },
    { header: 'es_nido_salvaje', key: 'es_nido_salvaje', width: 14 },
    { header: 'fue_depredado', key: 'fue_depredado', width: 14 },
    { header: 'largo_total', key: 'largo_total', width: 12 },
    { header: 'largo_curvo', key: 'largo_curvo', width: 12 },
    { header: 'ancho_curvo', key: 'ancho_curvo', width: 12 },
    { header: 'observaciones', key: 'observaciones', width: 28 },
    { header: 'obs_tortuga', key: 'obs_tortuga', width: 28 },
  ];
  hojaM.addRows(nidos.map(n => ({
    ...n, temporada: temporadaDe(n.fecha),
    es_nido_salvaje: n.es_nido_salvaje ? 'si' : 'no',
    fue_depredado:   n.fue_depredado   ? 'si' : 'no',
  })));
  hojaM.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hojaM.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86AD' } };

  const hojaL = wb.addWorksheet('Limpieza');
  hojaL.columns = [
    { header: 'numero_nido', key: 'numero_nido', width: 14 },
    { header: 'temporada', key: 'temporada', width: 12 },
    { header: 'fecha_limpieza', key: 'fecha_limpieza', width: 16 },
    { header: 'tortugas_vivas', key: 'tortugas_vivas', width: 14 },
    { header: 'tortugas_muertas', key: 'tortugas_muertas', width: 16 },
    { header: 'cascarones', key: 'cascarones', width: 12 },
    { header: 'huevos_no_eclosionados', key: 'huevos_no_eclosionados', width: 20 },
    { header: 'huevos_rosa', key: 'huevos_rosa', width: 12 },
    { header: 'huevos_fase1', key: 'huevos_fase1', width: 12 },
    { header: 'huevos_fase2', key: 'huevos_fase2', width: 12 },
    { header: 'huevos_fase3', key: 'huevos_fase3', width: 12 },
    { header: 'observaciones', key: 'observaciones', width: 28 },
  ];
  hojaL.addRows(limpiezas.map(limpiezaConNido).map(l => ({ ...l, temporada: l._temporada })));
  hojaL.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hojaL.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86AD' } };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `registros-san-martin-${hoy()}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// MODAL EDICIÓN
// ══════════════════════════════════════════
function abrirEdicion(id) {
  const n = allNidos.find(x => x.id === id); if (!n) return;
  const temp   = temporadaDe(n.fecha);
  const playas = ['Mezcalitos','Punta Morena','Chumul','Coconuts','Chen Río','San Martín','Playa Basurero','Punta Chiqueros','Buenavista','Box','Rastas'];
  const pOpts  = playas.map(p => `<option${n.playa === p ? ' selected' : ''}>${p}</option>`).join('');
  const zOpts  = ['','1','2','3'].map(z => `<option value="${z}"${String(n.zona) === z ? ' selected' : ''}>${z || '—'}</option>`).join('');
  const aOpts  = ['','1','2','3','4','5','6','7','8'].map(a => `<option value="${a}"${String(n.accion) === a ? ' selected' : ''}>${a || '—'}</option>`).join('');

  document.getElementById('edit-titulo').textContent = `Editar nido #${n.numero_nido} — Temporada ${temp}`;
  document.getElementById('edit-contenido').innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Número de nido</label><input type="number" id="e-numero" value="${n.numero_nido || ''}" /></div>
      <div class="form-group"><label>Fecha de registro</label><input type="date" id="e-fecha" value="${n.fecha || ''}" /></div>
      <div class="form-group"><label>Playa</label><select id="e-playa"><option value="">—</option>${pOpts}</select></div>
      <div class="form-group"><label>Especie</label>
        <select id="e-especie">
          <option value="">—</option>
          <option${n.especie === 'Caretta caretta' ? ' selected' : ''}>Caretta caretta</option>
          <option${n.especie === 'Chelonia mydas'  ? ' selected' : ''}>Chelonia mydas</option>
        </select>
      </div>
      <div class="form-group"><label>Zona</label><select id="e-zona">${zOpts}</select></div>
      <div class="form-group"><label>Acción</label><select id="e-accion">${aOpts}</select></div>
      <div class="form-group"><label>Coord X</label><input type="number" id="e-cx" value="${n.coord_x || ''}" /></div>
      <div class="form-group"><label>Coord Y</label><input type="number" id="e-cy" value="${n.coord_y || ''}" /></div>
      <div class="form-group"><label>Brigada</label><input type="text" id="e-brigada" value="${n.brigada || ''}" /></div>
      <hr class="section-divider" />
      <div class="form-group full"><label>Fecha estimada de eclosión</label><input type="date" id="e-eclosion" value="${n.fecha_eclosion_estimada || ''}" /></div>
      <hr class="section-divider" />
      <p class="section-label">Condición del nido</p>
      <div class="form-group full" style="flex-direction:row;gap:2rem;align-items:center;flex-wrap:wrap;">
        <div class="check-row"><input type="checkbox" id="e-salvaje" ${n.es_nido_salvaje ? 'checked' : ''}/><label for="e-salvaje">Nido salvaje</label></div>
        <div class="check-row"><input type="checkbox" id="e-depredado" ${n.fue_depredado ? 'checked' : ''}/><label for="e-depredado">Depredado</label></div>
      </div>
      <hr class="section-divider" />
      <div class="form-group full"><label>Observaciones del nido</label><textarea id="e-obs">${n.observaciones || ''}</textarea></div>
      <hr class="section-divider" />
      <p class="section-label">Datos de la tortuga anidadora (opcional)</p>
      <div class="form-group"><label>Largo total (cm)</label><input type="number" step="0.1" id="e-lt" value="${n.largo_total || ''}" /></div>
      <div class="form-group"><label>Largo curvo (cm)</label><input type="number" step="0.1" id="e-lc" value="${n.largo_curvo || ''}" /></div>
      <div class="form-group"><label>Ancho curvo (cm)</label><input type="number" step="0.1" id="e-ac" value="${n.ancho_curvo || ''}" /></div>
      <hr class="section-divider" />
      <div class="form-group full"><label>Observaciones de la tortuga</label><textarea id="e-obs-tortuga">${n.obs_tortuga || ''}</textarea></div>
    </div>`;

  document.getElementById('edit-actions').innerHTML = `
    <button class="btn btn-primary"   onclick="guardarEdicion('${n.id}')">Guardar cambios</button>
    <button class="btn btn-danger"    onclick="confirmarEliminar('${n.id}')">Eliminar nido</button>
    <button class="btn btn-secondary" onclick="cerrarModal('edit-modal')">Cancelar</button>`;

  document.getElementById('edit-modal').classList.add('open');
}

async function guardarEdicion(id) {
  const payload = {
    numero_nido:             parseInt(document.getElementById('e-numero').value),
    playa:                   document.getElementById('e-playa').value,
    fecha:                   document.getElementById('e-fecha').value,
    zona:                    parseInt(document.getElementById('e-zona').value)    || null,
    accion:                  parseInt(document.getElementById('e-accion').value)  || null,
    especie:                 document.getElementById('e-especie').value           || null,
    coord_x:                 parseFloat(document.getElementById('e-cx').value)    || null,
    coord_y:                 parseFloat(document.getElementById('e-cy').value)    || null,
    fecha_eclosion_estimada: document.getElementById('e-eclosion').value          || null,
    brigada:                 document.getElementById('e-brigada').value           || null,
    es_nido_salvaje:         document.getElementById('e-salvaje').checked,
    fue_depredado:           document.getElementById('e-depredado').checked,
    largo_total:             parseFloat(document.getElementById('e-lt').value)    || null,
    largo_curvo:             parseFloat(document.getElementById('e-lc').value)    || null,
    ancho_curvo:             parseFloat(document.getElementById('e-ac').value)    || null,
    observaciones:           document.getElementById('e-obs').value               || null,
    obs_tortuga:             document.getElementById('e-obs-tortuga').value       || null,
  };
  const { error } = await sb.from('monitoreo').update(payload).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  cerrarModal('edit-modal');
  toast('Nido actualizado.', 'success');
  await cargarDatos();
}

function confirmarEliminar(id, tipo = 'nido') {
  const mensajes = {
    nido:     '¿Eliminar este nido? Esta acción no se puede deshacer.',
    limpieza: '¿Eliminar este registro de limpieza? Esta acción no se puede deshacer.',
  };
  document.getElementById('confirm-msg').textContent = mensajes[tipo];
  document.getElementById('confirm-ok').onclick = () => tipo === 'limpieza' ? eliminarLimpieza(id) : eliminarNido(id);
  document.getElementById('confirm-modal').classList.add('open');
}

async function eliminarLimpieza(id) {
  cerrarConfirm();
  const { error } = await sb.from('limpieza').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  cerrarModal('edit-modal');
  cerrarModal('detalle-modal');
  toast('Limpieza eliminada.', 'success');
  await cargarDatos();
}

function abrirEdicionLimpieza(id) {
  const l = allLimpiezas.find(x => x.id === id); if (!l) return;
  const n = allNidos.find(x => x.id === l.id_monitoreo);
  const refNido = n ? `Nido #${n.numero_nido} — Temporada ${temporadaDe(n.fecha)}` : 'Nido no encontrado';

  document.getElementById('edit-titulo').textContent = `Editar limpieza — ${refNido}`;
  document.getElementById('edit-contenido').innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Fecha de limpieza</label><input type="date" id="el-fecha" value="${l.fecha_limpieza || ''}" /></div>
      <div class="form-group"><label>Tortugas vivas</label><input type="number" id="el-vivas" min="0" value="${l.tortugas_vivas ?? 0}" /></div>
      <div class="form-group"><label>Tortugas muertas</label><input type="number" id="el-muertas" min="0" value="${l.tortugas_muertas ?? 0}" /></div>
      <div class="form-group"><label>Cascarones</label><input type="number" id="el-cascarones" min="0" value="${l.cascarones ?? 0}" /></div>
      <div class="form-group"><label>Huevos no eclosionados</label><input type="number" id="el-no-eclosionados" min="0" value="${l.huevos_no_eclosionados ?? 0}" /></div>
      <div class="form-group"><label>Huevos rosa</label><input type="number" id="el-rosa" min="0" value="${l.huevos_rosa ?? 0}" /></div>
      <div class="form-group"><label>Huevos fase 1</label><input type="number" id="el-fase1" min="0" value="${l.huevos_fase1 ?? 0}" /></div>
      <div class="form-group"><label>Huevos fase 2</label><input type="number" id="el-fase2" min="0" value="${l.huevos_fase2 ?? 0}" /></div>
      <div class="form-group"><label>Huevos fase 3</label><input type="number" id="el-fase3" min="0" value="${l.huevos_fase3 ?? 0}" /></div>
      <div class="form-group full"><label>Observaciones</label><textarea id="el-observaciones">${l.observaciones || ''}</textarea></div>
    </div>`;

  document.getElementById('edit-actions').innerHTML = `
    <button class="btn btn-primary"   onclick="guardarEdicionLimpieza('${l.id}')">Guardar cambios</button>
    <button class="btn btn-danger"    onclick="confirmarEliminar('${l.id}','limpieza')">Eliminar limpieza</button>
    <button class="btn btn-secondary" onclick="cerrarModal('edit-modal')">Cancelar</button>`;

  document.getElementById('edit-modal').classList.add('open');
}

async function guardarEdicionLimpieza(id) {
  const payload = {
    fecha_limpieza:         document.getElementById('el-fecha').value,
    tortugas_vivas:         parseInt(document.getElementById('el-vivas').value)          || 0,
    tortugas_muertas:       parseInt(document.getElementById('el-muertas').value)        || 0,
    cascarones:             parseInt(document.getElementById('el-cascarones').value)     || 0,
    huevos_no_eclosionados: parseInt(document.getElementById('el-no-eclosionados').value)|| 0,
    huevos_rosa:            parseInt(document.getElementById('el-rosa').value)           || 0,
    huevos_fase1:           parseInt(document.getElementById('el-fase1').value)          || 0,
    huevos_fase2:           parseInt(document.getElementById('el-fase2').value)          || 0,
    huevos_fase3:           parseInt(document.getElementById('el-fase3').value)          || 0,
    observaciones:          document.getElementById('el-observaciones').value            || null,
  };
  if (!payload.fecha_limpieza) { toast('Ingresa la fecha de limpieza.', 'error'); return; }
  const { error } = await sb.from('limpieza').update(payload).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  cerrarModal('edit-modal');
  toast('Limpieza actualizada.', 'success');
  await cargarDatos();
}

async function eliminarNido(id) {
  cerrarConfirm();
  const { error } = await sb.from('monitoreo').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  cerrarModal('edit-modal');
  toast('Nido eliminado.', 'success');
  await cargarDatos();
}

function cerrarModal(id)              { document.getElementById(id).classList.remove('open'); }
function cerrarConfirm()              { document.getElementById('confirm-modal').classList.remove('open'); }
function cerrarModalClick(e, id)      { if (e.target === document.getElementById(id)) cerrarModal(id); }

function toggleDropdown(id) {
  document.querySelectorAll('.dropdown-menu.open').forEach(el => { if (el.id !== id) el.classList.remove('open'); });
  document.getElementById(id).classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown-wrap')) {
    document.querySelectorAll('.dropdown-menu.open').forEach(el => el.classList.remove('open'));
  }
});

// ══════════════════════════════════════════
// FORMULARIO MONITOREO
// ══════════════════════════════════════════
function onEspecieCambio() {
  const esp   = document.getElementById('m-especie').value;
  const diasEl = document.getElementById('m-dias');
  if (!diasEl.value) {
    if (esp === 'Caretta caretta') diasEl.value = 50;
    if (esp === 'Chelonia mydas')  diasEl.value = 55;
  }
  calcularEclosion();
}

function onFechaCambio() { calcularEclosion(); }

function onDepredadoCambio() {
  if (document.getElementById('m-depredado').checked) {
    document.getElementById('m-eclosion').value = hoy();
    document.getElementById('eclosion-hint').textContent = 'Depredado: eclosión establecida a hoy. Puedes modificar la fecha.';
  }
}

function calcularEclosion() {
  const fecha = document.getElementById('m-fecha').value;
  const dias  = parseInt(document.getElementById('m-dias').value);
  const hint  = document.getElementById('eclosion-hint');
  if (fecha && dias > 0) {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() + dias);
    const iso = d.toISOString().split('T')[0];
    document.getElementById('m-eclosion').value = iso;
    hint.textContent = `Eclosión estimada: ${iso} (${dias} días desde ${fecha})`;
  }
}

async function guardarMonitoreo() {
  const payload = {
    numero_nido:             parseInt(document.getElementById('m-numero').value),
    playa:                   document.getElementById('m-playa').value,
    fecha:                   document.getElementById('m-fecha').value,
    zona:                    parseInt(document.getElementById('m-zona').value)         || null,
    accion:                  parseInt(document.getElementById('m-accion').value)       || null,
    especie:                 document.getElementById('m-especie').value                || null,
    coord_x:                 parseFloat(document.getElementById('m-coord-x').value)    || null,
    coord_y:                 parseFloat(document.getElementById('m-coord-y').value)    || null,
    fecha_eclosion_estimada: document.getElementById('m-eclosion').value              || null,
    brigada:                 document.getElementById('m-brigada').value               || null,
    es_nido_salvaje:         document.getElementById('m-salvaje').checked,
    fue_depredado:           document.getElementById('m-depredado').checked,
    largo_total:             parseFloat(document.getElementById('m-largo-total').value) || null,
    largo_curvo:             parseFloat(document.getElementById('m-largo-curvo').value) || null,
    ancho_curvo:             parseFloat(document.getElementById('m-ancho-curvo').value) || null,
    observaciones:           document.getElementById('m-observaciones').value          || null,
    obs_tortuga:             document.getElementById('m-obs-tortuga').value            || null,
  };
  if (!payload.numero_nido || !payload.playa || !payload.fecha) {
    toast('Completa número, playa y fecha.', 'error'); return;
  }
  const { error } = await sb.from('monitoreo').insert(payload);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Nido guardado.', 'success');
  limpiarFormMonitoreo();
  await cargarDatos();
}

function limpiarFormMonitoreo() {
  ['m-numero','m-fecha','m-playa','m-zona','m-accion','m-especie',
   'm-coord-x','m-coord-y','m-eclosion','m-dias','m-brigada','m-observaciones',
   'm-obs-tortuga','m-largo-total','m-largo-curvo','m-ancho-curvo']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('m-salvaje').checked   = false;
  document.getElementById('m-depredado').checked = false;
  document.getElementById('eclosion-hint').textContent = 'Selecciona especie y fecha · Caretta: 50 días · Chelonia: 55 días';
}

// ══════════════════════════════════════════
// FORMULARIO LIMPIEZA
// ══════════════════════════════════════════
async function guardarLimpieza() {
  const idM = document.getElementById('l-nido').value;
  if (!idM) { toast('Selecciona un nido.', 'error'); return; }
  const payload = {
    id_monitoreo:           idM,
    fecha_limpieza:         document.getElementById('l-fecha').value,
    tortugas_vivas:         parseInt(document.getElementById('l-vivas').value)          || 0,
    tortugas_muertas:       parseInt(document.getElementById('l-muertas').value)        || 0,
    cascarones:             parseInt(document.getElementById('l-cascarones').value)     || 0,
    huevos_no_eclosionados: parseInt(document.getElementById('l-no-eclosionados').value)|| 0,
    huevos_rosa:            parseInt(document.getElementById('l-rosa').value)           || 0,
    huevos_fase1:           parseInt(document.getElementById('l-fase1').value)          || 0,
    huevos_fase2:           parseInt(document.getElementById('l-fase2').value)          || 0,
    huevos_fase3:           parseInt(document.getElementById('l-fase3').value)          || 0,
    observaciones:          document.getElementById('l-observaciones').value            || null,
  };
  if (!payload.fecha_limpieza) { toast('Ingresa la fecha de limpieza.', 'error'); return; }
  const { error } = await sb.from('limpieza').insert(payload);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Limpieza registrada.', 'success');
  limpiarFormLimpieza();
  await cargarDatos();
}

function limpiarFormLimpieza() {
  ['l-nido','l-fecha','l-observaciones'].forEach(id => document.getElementById(id).value = '');
  ['l-vivas','l-muertas','l-cascarones','l-no-eclosionados','l-rosa','l-fase1','l-fase2','l-fase3']
    .forEach(id => document.getElementById(id).value = 0);
}

// ══════════════════════════════════════════
// ADMINISTRACIÓN
// ══════════════════════════════════════════
async function cargarUsuarios() {
  const lista = document.getElementById('lista-usuarios');
  const { data, error } = await sb.from('perfiles').select('id,nombre,email,rol');
  if (error || !data) { lista.innerHTML = '<p style="color:var(--red)">Error al cargar.</p>'; return; }
  if (!data.length)   { lista.innerHTML = '<p style="color:var(--ink-lt);font-size:.88rem">Sin usuarios registrados.</p>'; return; }

  lista.innerHTML = `
    <div class="users-header">
      <span>Nombre</span><span>Email</span><span>Rol</span><span></span>
    </div>
    ${data.map(u => `
    <div class="user-row">
      <div class="user-name">${u.nombre || '—'}</div>
      <div class="user-email-sm">${u.email || '—'}</div>
      <select class="role-select" onchange="cambiarRol('${u.id}', this.value)">
        ${['viewer','editor','admin'].map(r => `<option value="${r}"${u.rol === r ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
      <button class="btn btn-danger btn-sm" onclick="confirmarEliminarUsuario('${u.id}')">Eliminar</button>
    </div>`).join('')}`;
}

async function cambiarRol(uid, rol) {
  const { error } = await sb.from('perfiles').update({ rol }).eq('id', uid);
  if (error) toast('Error al cambiar rol.', 'error');
  else toast('Rol actualizado.', 'success');
}

async function registrarPerfil() {
  const uid    = document.getElementById('a-uid').value.trim();
  const nombre = document.getElementById('a-nombre').value.trim();
  const email  = document.getElementById('a-email').value.trim();
  const rol    = document.getElementById('a-rol').value;
  if (!uid) { toast('Ingresa el UUID del usuario.', 'error'); return; }
  const { error } = await sb.from('perfiles').upsert({ id: uid, nombre, email, rol });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Usuario registrado.', 'success');
  ['a-uid','a-nombre','a-email'].forEach(id => document.getElementById(id).value = '');
  cargarUsuarios();
}

function confirmarEliminarUsuario(uid) {
  document.getElementById('confirm-msg').textContent = '¿Eliminar este usuario del sistema? Perderá acceso inmediatamente.';
  document.getElementById('confirm-ok').onclick = async () => {
    cerrarConfirm();
    await sb.from('perfiles').delete().eq('id', uid);
    toast('Usuario eliminado.', 'success');
    cargarUsuarios();
  };
  document.getElementById('confirm-modal').classList.add('open');
}

// ══════════════════════════════════════════
// EXCEL
// ══════════════════════════════════════════
let excelRowsM = [];
let excelRowsL = [];

async function procesarExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  const wb     = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetM = wb.Sheets['Monitoreo'];
  const sheetL = wb.Sheets['Limpieza'];
  if (!sheetM) { toast('No se encontró la hoja "Monitoreo".', 'error'); return; }
  excelRowsM = XLSX.utils.sheet_to_json(sheetM);
  excelRowsL = sheetL ? XLSX.utils.sheet_to_json(sheetL) : [];
  document.getElementById('excel-preview').innerHTML = `
    <p style="margin:.75rem 0;font-size:.86rem;color:var(--ink-lt)">
      📄 <strong>${file.name}</strong> — <strong>${excelRowsM.length}</strong> registros de monitoreo · <strong>${excelRowsL.length}</strong> de limpieza
    </p>
    <button class="btn btn-primary btn-sm" id="btn-confirmar-excel" onclick="confirmarSubidaExcel()">Confirmar y subir</button>`;
}

async function confirmarSubidaExcel() {
  const btn = document.getElementById('btn-confirmar-excel');
  btn.disabled = true;
  btn.textContent = 'Subiendo…';
  const resultado = await subirExcel(excelRowsM, excelRowsL);
  if (resultado) {
    document.getElementById('excel-preview').innerHTML = `
      <p style="margin:.75rem 0;font-size:.86rem;white-space:pre-line;color:${resultado.ok ? 'var(--green)' : 'var(--red)'}">${resultado.mensaje}</p>`;
    document.getElementById('file-input').value = '';
    excelRowsM = []; excelRowsL = [];
  } else {
    btn.disabled = false;
    btn.textContent = 'Confirmar y subir';
  }
}

// Días de incubación por especie (usado solo para el offset numérico "33" y
// como referencia; el cálculo por "si"/vacío lo hace el trigger en Supabase).
const DIAS_ECLOSION = { 'Caretta caretta': 50, 'Chelonia mydas': 55 };

function normalizarBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'si' || s === 'sí' || s === 'true' || s === '1';
}

// Convierte "", undefined, null o texto no numérico a null; si hay valor válido, lo regresa como número.
function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Convierte "" o undefined a null; deja el resto (texto) tal cual.
function toTexto(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return String(v).trim();
}

// Interpreta los 4 formatos aceptados en la columna fecha_eclosion_estimada.
// Devuelve una fecha ISO (string) o null. Si devuelve null, el trigger de
// Supabase la calcula automáticamente según la especie (comportamiento "si").
function resolverFechaEclosion(valor, fechaPuesta, especie) {
  if (valor === undefined || valor === null || valor === '') return null; // vacío → lo calcula la BD
  if (valor instanceof Date) return toFechaISO(valor);

  const raw = String(valor).trim();
  if (raw === '') return null;
  if (raw.toLowerCase() === 'si' || raw.toLowerCase() === 'sí') return null; // "si" → lo calcula la BD

  // ¿Es un número entero (días a sumar)?
  if (/^\d+$/.test(raw)) {
    const base = toFechaISO(fechaPuesta);
    if (!base) return null;
    const d = new Date(base + 'T12:00:00');
    d.setDate(d.getDate() + parseInt(raw, 10));
    return toFechaISO(d);
  }

  // ¿Es una fecha reconocible (ISO u otra que toFechaISO logre interpretar)?
  const iso = toFechaISO(raw);
  if (iso) return iso;

  // Formato no reconocido → se deja que la BD calcule por especie.
  return null;
}

// Convierte cualquier valor de fecha proveniente de Excel (texto ISO, objeto Date
// —cuando Excel autoformatea la celda—, o número de serie ya resuelto por SheetJS)
// a "YYYY-MM-DD". Devuelve null si no se puede interpretar.
function toFechaISO(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (s === '') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Extrae el año (temporada) de un valor de fecha, usando toFechaISO como base.
function añoDe(valor) {
  const iso = toFechaISO(valor);
  return iso ? iso.slice(0, 4) : null;
}

async function subirExcel(rowsM, rowsL) {
  if (rowsM.length) {
    const { error } = await sb.from('monitoreo').insert(rowsM.map(r => ({
      numero_nido: toNum(r.numero_nido), playa: toTexto(r.playa), fecha: toFechaISO(r.fecha),
      zona: toNum(r.zona), accion: toNum(r.accion), especie: toTexto(r.especie),
      coord_x: toNum(r.coord_x), coord_y: toNum(r.coord_y),
      fecha_eclosion_estimada: resolverFechaEclosion(r.fecha_eclosion_estimada, r.fecha, r.especie),
      brigada: toTexto(r.brigada),
      es_nido_salvaje: normalizarBool(r.es_nido_salvaje),
      fue_depredado:   normalizarBool(r.fue_depredado),
      largo_total: toNum(r.largo_total), largo_curvo: toNum(r.largo_curvo),
      ancho_curvo: toNum(r.ancho_curvo), observaciones: toTexto(r.observaciones),
      obs_tortuga: toTexto(r.obs_tortuga),
    })));
    if (error) { toast('Error en Monitoreo: ' + error.message, 'error'); return false; }
  }

  let limpiezasOk = 0;
  const fallidas = [];

  if (rowsL.length) {
    // Refrescamos allNidos para poder resolver numero_nido + temporada,
    // incluyendo los nidos recién insertados arriba en esta misma carga.
    const { data: nidosFrescos } = await sb.from('monitoreo').select('*').order('numero_nido');
    allNidos = nidosFrescos || [];

    const payloadL = [];
    rowsL.forEach((r, i) => {
      const numNido = toNum(r.numero_nido);
      const anio    = añoDe(r.fecha_limpieza);
      const nido = allNidos.find(n => n.numero_nido === numNido && temporadaDe(n.fecha) === anio);
      if (!nido) {
        fallidas.push(`Fila ${i + 2}: no se encontró el nido #${r.numero_nido ?? '?'} en la temporada ${anio ?? '?'}`);
        return;
      }
      payloadL.push({
        id_monitoreo: nido.id,
        fecha_limpieza: toFechaISO(r.fecha_limpieza),
        tortugas_vivas: toNum(r.tortugas_vivas) ?? 0,
        tortugas_muertas: toNum(r.tortugas_muertas) ?? 0,
        cascarones: toNum(r.cascarones) ?? 0,
        huevos_no_eclosionados: toNum(r.huevos_no_eclosionados) ?? 0,
        huevos_rosa: toNum(r.huevos_rosa) ?? 0,
        huevos_fase1: toNum(r.huevos_fase1) ?? 0,
        huevos_fase2: toNum(r.huevos_fase2) ?? 0,
        huevos_fase3: toNum(r.huevos_fase3) ?? 0,
        observaciones: toTexto(r.observaciones),
      });
    });

    if (payloadL.length) {
      const { error } = await sb.from('limpieza').insert(payloadL);
      if (error) { toast('Error en Limpieza: ' + error.message, 'error'); return false; }
      limpiezasOk = payloadL.length;
    }
  }

  const partes = [];
  if (rowsM.length)  partes.push(`${rowsM.length} nidos`);
  if (limpiezasOk)   partes.push(`${limpiezasOk} limpiezas`);
  let mensaje = partes.length ? `${partes.join(' y ')} cargados.` : 'No se cargó ningún registro.';
  if (fallidas.length) {
    mensaje += `\n\n${fallidas.length} limpieza(s) no se registraron:\n` + fallidas.join('\n');
  }

  await cargarDatos();
  return { ok: fallidas.length === 0, mensaje };
}

// ── Plantilla con listas desplegables (requiere ExcelJS) ──
async function descargarPlantilla() {
  const wb = new ExcelJS.Workbook();

  // ── Hoja Monitoreo ──
  const hojaM = wb.addWorksheet('Monitoreo');
  const colsM = [
    'numero_nido','playa','fecha','zona','accion','especie','coord_x','coord_y',
    'fecha_eclosion_estimada','brigada','es_nido_salvaje','fue_depredado',
    'largo_total','largo_curvo','ancho_curvo','observaciones','obs_tortuga'
  ];
  hojaM.columns = colsM.map(c => ({ header: c, key: c, width: 20 }));

  hojaM.addRows([
    { numero_nido: 42, playa: 'San Martín', fecha: '2026-07-01', zona: 2, accion: 3,
      especie: 'Caretta caretta', coord_x: 512400, coord_y: 2253100,
      fecha_eclosion_estimada: 'si', brigada: 'Brigada 1', es_nido_salvaje: 'no', fue_depredado: 'no',
      largo_total: 95.5, largo_curvo: 92.3, ancho_curvo: 88.1,
      observaciones: 'Nido en buen estado', obs_tortuga: 'Sin marcas visibles' },
    { numero_nido: 43, playa: 'Chen Río', fecha: '2026-07-02', zona: 1, accion: 4,
      especie: 'Chelonia mydas', coord_x: 511980, coord_y: 2252640,
      fecha_eclosion_estimada: '2026-08-26', brigada: 'Brigada 2', es_nido_salvaje: 'no', fue_depredado: 'no',
      largo_total: null, largo_curvo: null, ancho_curvo: null, observaciones: null, obs_tortuga: null },
    { numero_nido: 44, playa: 'Punta Chiqueros', fecha: '2026-07-03', zona: 3, accion: 2,
      especie: 'Caretta caretta', coord_x: 510150, coord_y: 2250820,
      fecha_eclosion_estimada: 33, brigada: 'Brigada 1', es_nido_salvaje: 'si', fue_depredado: 'no',
      largo_total: null, largo_curvo: null, ancho_curvo: null, observaciones: null, obs_tortuga: null },
    { numero_nido: 45, playa: 'Punta Morena', fecha: '2026-07-04', zona: 1, accion: 1,
      especie: 'Chelonia mydas', coord_x: 515200, coord_y: 2256300,
      fecha_eclosion_estimada: '', brigada: '', es_nido_salvaje: 'no', fue_depredado: 'si',
      largo_total: null, largo_curvo: null, ancho_curvo: null, observaciones: null, obs_tortuga: null },
  ]);

  // Encabezado con estilo
  hojaM.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hojaM.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86AD' } };

  // Comentario de ayuda en el encabezado de fecha_eclosion_estimada
  const colEclosion = colsM.indexOf('fecha_eclosion_estimada') + 1;
  hojaM.getCell(1, colEclosion).note = {
    texts: [{ text:
      'Acepta 4 formatos:\n' +
      '• "si" → se calcula según la especie\n' +
      '• Fecha exacta, ej. 2026-08-26\n' +
      '• Número de días, ej. 33 (desde la fecha de puesta)\n' +
      '• Vacío → se calcula igual que "si"'
    }]
  };

  // Listas desplegables (validación de datos), filas 2 a 200
  const dropdown = (colKey, lista) => {
    const col = colsM.indexOf(colKey) + 1;
    for (let row = 2; row <= 200; row++) {
      hojaM.getCell(row, col).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: [`"${lista.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Valor no válido',
        error: `Selecciona una opción de la lista: ${lista.join(', ')}`
      };
    }
  };
  dropdown('playa',   ['Mezcalitos','Punta Morena','Chumul','Coconuts','Chen Río','San Martín','Playa Basurero','Punta Chiqueros','Buenavista','Box','Rastas']);
  dropdown('especie', ['Caretta caretta','Chelonia mydas']);
  dropdown('zona',    ['1','2','3']);
  dropdown('accion',  ['1','2','3','4','5','6','7','8']);
  dropdown('es_nido_salvaje', ['si','no']);
  dropdown('fue_depredado',   ['si','no']);

  // ── Hoja Limpieza ──
  const hojaL = wb.addWorksheet('Limpieza');
  const colsL = [
    'numero_nido','fecha_limpieza','tortugas_vivas','tortugas_muertas',
    'cascarones','huevos_no_eclosionados','huevos_rosa','huevos_fase1','huevos_fase2','huevos_fase3','observaciones'
  ];
  hojaL.columns = colsL.map(c => ({ header: c, key: c, width: 20 }));
  hojaL.addRows([
    { numero_nido: 42, fecha_limpieza: '2026-08-20', tortugas_vivas: 78, tortugas_muertas: 2,
      cascarones: 80, huevos_no_eclosionados: 5, huevos_rosa: 3, huevos_fase1: 1, huevos_fase2: 1, huevos_fase3: 0,
      observaciones: 'Emergencia natural, sin incidentes' },
    { numero_nido: 43, fecha_limpieza: '2026-08-26', tortugas_vivas: 60, tortugas_muertas: 0,
      cascarones: 60, huevos_no_eclosionados: 8, huevos_rosa: 0, huevos_fase1: 0, huevos_fase2: 1, huevos_fase3: 0,
      observaciones: '' },
  ]);
  hojaL.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hojaL.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86AD' } };
  hojaL.getCell(1, colsL.indexOf('numero_nido') + 1).note = {
    texts: [{ text:
      'Debe coincidir con un "numero_nido" ya registrado en la hoja Monitoreo\n' +
      '(de esta misma carga o de una carga previa).\n' +
      'La temporada se toma del año de "fecha_limpieza", así que si el mismo\n' +
      'número de nido existe en más de una temporada, el sistema usa la limpieza\n' +
      'del año que coincida con esa fecha.'
    }]
  };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'plantilla-san-martin.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════
function showTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'mapa' && map) setTimeout(() => map.invalidateSize(), 50);
}

function toggleMenu() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function showTabMobile(name) {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  const btns = document.querySelectorAll('#nav-desktop button');
  let targetBtn = null;
  btns.forEach(b => { if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(name)) targetBtn = b; });
  showTab(name, targetBtn || document.createElement('button'));
}
// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  setTimeout(() => { t.className = ''; }, 3200);
}