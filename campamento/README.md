# Web de los campamentos (paso 5a de `PLATAFORMA_WEB.md`)

`/punta-sur/` y `/san-martin/` son páginas mínimas que llaman a `start('<campamento>')`.
Todo el código está aquí, una sola vez para los dos campamentos.
La parte pública del sitio (divulgación) no se toca.

## Qué hace

| Sección | Quién | Qué hay |
|---|---|---|
| Inicio de sesión | todos | Con contraseña temporal, obliga a cambiarla antes de seguir |
| **Mapa** | todos | Nidos con color por estado (como la app), filtros, satélite o calles; de cerca, **fotos de dron colocadas y giradas sobre su huella**, con las máscaras |
| **Nidos** | todos | Tabla con buscador, filtros y orden por columna; exportar CSV y KML |
| **Limpiezas** | todos | Tabla con buscador; exportar CSV |
| Ficha del nido | todos | Datos, coordenada real y desde imagen aérea en 3 formatos, limpieza, recortes aéreos y fotos de campo |
| Registrar o editar nido y limpieza | capturista+ | Mismas reglas que la app (número único por temporada, eclosión estimada, salvaje, acción 8, fase total o por fase) |
| Eliminar, fijar estado | experto+ | Depredado, salvaje, reubicado |
| **Usuarios** | coordinador | Crear con contraseña temporal, cambiar rol, desactivar, nueva contraseña |
| **Ajustes** | coordinador | Playas, modo de fase, días de incubación, regla de cercanía, zona UTM |

## Cómo funciona

- **Los datos:** la página baja los cambios con la misma sincronización que la app (`sync/pull` desde el último `rev`) y los guarda en el navegador (IndexedDB). La segunda vez solo baja lo nuevo. Se actualiza sola cada 2 minutos o con ⟳.
- **Los cambios:** se suben con `sync/push`. La web es un "equipo" más (`device_id = web`), y el servidor aplica las mismas reglas que con la app.
- **Las imágenes:** se piden con la sesión y se muestran como blobs. Las fotos de dron solo se cargan desde el zoom 17 y solo las que están a la vista.
- **Mismos cálculos que la app:** `js/coords.js` es la copia de `Coords.java` (la conversión UTM coincide con pyproj hasta el 9.º decimal) y `js/geo.js` es la copia de `Geo.java`.
- **Seguridad del texto:** todo se escribe con `textContent` (`js/ui.js`), nunca como HTML, así nada de lo que se capture puede ejecutarse en la página.

## Probar en la PC (sin tocar los datos reales)

1. API local: `cd web_servidor/api`, `npm run migrar-local` y `npm run local`.
2. Datos de prueba: `node pruebas/sembrar_local.mjs <carpeta_semilla>`. Crea un usuario por rol; sus contraseñas quedan en `web_servidor/api/.dev.usuarios`.
3. Página: servidor sin caché (`.claude/launch.json` → `web-tortugas`) y abrir `http://127.0.0.1:8080/punta-sur/?api=http://127.0.0.1:8787`.
   - El navegador recuerda la API elegida.
   - Con `?api=produccion` vuelve a la publicada.
   - Mientras se usa la API de pruebas, la pantalla de inicio de sesión lo avisa.

## Archivos

| Archivo | Qué hace |
|---|---|
| `app.css` | Diseño (misma paleta y tipografía que la divulgación) |
| `js/main.js` | Arranque, sesión, menú según el rol |
| `js/api.js` | Conexión con la API |
| `js/store.js` | Datos en el navegador y sincronización |
| `js/mapa.js` | Mapa, fotos de dron giradas, máscaras |
| `js/tablas.js` | Tablas de nidos y limpiezas |
| `js/ficha.js` | Ficha del nido |
| `js/formularios.js` | Registrar y editar nido y limpieza |
| `js/admin.js` | Usuarios y ajustes |
| `js/exportar.js` | CSV y KML |
| `js/filters.js` | Filtro compartido por mapa y tablas |
| `js/coords.js`, `js/geo.js`, `js/catalog.js` | Coordenadas, huella de la foto, catálogos |
| `js/ui.js` | Elementos, ventanas, avisos, fechas |

## Pendiente (5b y 6)

- **5b:** carga masiva desde Excel/CSV (asignación de columnas, vista previa con validación, deshacer).
- **6:** bandeja de revisión de GNeST y "Subir vuelo".
