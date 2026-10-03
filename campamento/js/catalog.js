// Códigos y etiquetas (igual que Catalog.java de la app). En la base van los códigos.

export const SPECIES = [
  ['chelonia_mydas', 'Chelonia mydas', 'Tortuga verde'],
  ['caretta_caretta', 'Caretta caretta', 'Tortuga caguama'],
];

export const STATUS = [
  ['activo', 'Activo', '#43A047'],
  ['eclosionado', 'Eclosionado', '#1E88E5'],
  ['depredado', 'Depredado', '#E53935'],
  ['reubicado', 'Reubicado', '#FB8C00'],
  ['salvaje', 'Salvaje', '#8E24AA'],
];

/** Estados que fija el experto; los demás son automáticos. */
export const STATUS_MANUAL = ['depredado', 'salvaje', 'reubicado'];

/** Acción 1–8: se guarda y se muestra solo el número. La 8 propone "salvaje". */
export const ACTION_WILD = 8;

export const ROLES = [
  ['lectura', 'Solo lectura', 'Consulta mapa, nidos y limpiezas'],
  ['capturista', 'Capturista', 'Además registra nidos y limpiezas'],
  ['experto', 'Experto', 'Además borra y fija estados (depredado, salvaje, reubicado)'],
  ['coordinador', 'Coordinador', 'Todo, más usuarios y ajustes del campamento'],
];

export function speciesName(code) {
  const s = SPECIES.find((x) => x[0] === code);
  return s ? s[1] : code || '—';
}

export function statusName(code) {
  const s = STATUS.find((x) => x[0] === code);
  return s ? s[1] : code || '—';
}

export function statusColor(code) {
  const s = STATUS.find((x) => x[0] === code);
  return s ? s[2] : '#9E9E9E';
}

export function roleName(code) {
  const r = ROLES.find((x) => x[0] === code);
  return r ? r[1] : code;
}

export function actionText(n) {
  return n == null ? '—' : String(n);
}

const RANK = ['lectura', 'capturista', 'experto', 'coordinador'];
export function can(user, role) {
  return RANK.indexOf(user.rol) >= RANK.indexOf(role);
}
