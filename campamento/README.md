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
| **Vuelos** | capturista+ / experto+ | Subir vuelo (fotos a la bandeja temporal) y bandeja de revisión de las propuestas de GNeST |
| **Cargar Excel** | experto+ | Temporadas anteriores (nidos y limpiezas en hojas o CSV separados, enlazados por temporada y número) desde las plantillas o el Excel del experto: asignación de columnas (se recuerda), vista previa validada, actualizar u omitir los que ya existen, historial y deshacer |

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
| `js/respaldo.js` | Respaldo (coordinador): .zip con filtros (temporada, playa, especie, fechas, fotos de campo) y restauración que no borra nada |
| `js/carga.js` | Cargar Excel: pantallas (archivo, columnas, vista previa, carga, historial) |
| `js/carga_lectura.js` | Cargar Excel: columnas conocidas, lectura de fechas, coordenadas, especie y estado; validación por renglón; plantilla |
| `js/vuelos.js` | Vuelos: lista, avisos y Subir vuelo |
| `js/revision.js` | Bandeja de revisión de un vuelo: aceptar, ya registrado, descartar, dibujar |
| `js/filters.js` | Filtro compartido por mapa y tablas |
| `js/coords.js`, `js/geo.js`, `js/catalog.js` | Coordenadas, huella de la foto, catálogos |
| `js/ui.js` | Elementos, ventanas, avisos, fechas |

## Cargar Excel (5b)

- **Quién:** experto y coordinador. El experto deshace solo sus propias cargas; el coordinador, cualquiera.
- **Nidos y limpiezas en hojas separadas.** Un Excel con las hojas «Nidos» y «Limpiezas», o dos CSV subidos juntos (también sirve solo uno). Cada limpieza se enlaza con su nido por **temporada y número de nido**: el nido puede venir en la hoja de nidos o estar ya registrado. Si no existe en ninguno de los dos, la limpieza es un error.
- **Plantillas** («Descargar plantilla ▾»): Excel con las hojas Nidos, Limpiezas e Instrucciones; CSV de nidos; CSV de limpiezas (UTF-8 con BOM, separado por comas).
- El tipo de cada hoja se detecta por su nombre o sus encabezados, y se puede cambiar. La asignación de columnas se recuerda por separado para nidos y limpiezas.
- Los archivos se leen **en el navegador** con SheetJS (`cdn.sheetjs.com`, se descarga solo al usar la sección). Acepta .xlsx, .xls, .ods y .csv (UTF-8 o Windows-1252, con `,` o `;`).
- **Lo que entiende:** fechas día/mes/año, ISO, de Excel o «12 de junio de 2024» (avisa si parecen mes/día); coordenadas decimales, GMS o UTM (detectadas por renglón, o la columna `formato_coordenada`), también en una sola celda; longitud sin signo → Oeste, latitud y longitud invertidas, punto a más de 60 km (aviso); especie (`C. mydas`, verde, blanca, caguama…), estado (`depredación`, `reubicado a vivero`…), playa sin importar mayúsculas ni acentos.
- **Errores** (el renglón no se carga): limpieza cuyo nido no existe, sin número o fecha, fecha imposible, especie o estado desconocido, zona fuera de 1–3, acción fuera de 1–8, número repetido en el archivo, temporada que no coincide con la fecha.
- La carga va en partes de 400 renglones y reintenta si se corta la conexión.

## Vuelos y bandeja de revisión (6a)

- **Vuelos** (capturista+): lista de vuelos con su estado (Subiendo fotos, Esperando a GNeST, Por revisar, Revisado), fotos y propuestas.
- **Subir vuelo:** playa, fecha y las fotos del dron (.jpg). Van a la bandeja temporal de la nube con barra de avance; si se corta, «Continuar subida» y se eligen las mismas fotos (las que ya subieron no se repiten). Se borran solas a los 20 días si GNeST no las procesa.
- **Avisos al coordinador:** fotos que se borran en 5 días o menos, y las que ya se borraron sin procesar.
- **Bandeja de revisión** (experto+): foto por foto, con las máscaras de GNeST (amarillo = por revisar, verde = aceptada, rojo = descartada). En cada propuesta:
  - **Aceptar:** nido nuevo, con el siguiente número libre de la temporada, Chelonia mydas, la fecha de la foto y la playa del vuelo (todo se puede cambiar); la eclosión se estima como en la app;
  - **Ya registrado:** los nidos que cumplen la regla de cercanía (Ajustes: distancia, misma temporada, de N días antes a M después), con la **vista breve** (los dos recortes lado a lado) y «Es este nido»; o cualquier otro nido de la temporada;
  - **Descartar** (y «Volver a revisar»).
  - **Ajustar contorno** (como LabelNef), en propuestas, nidos aceptados y dibujos: mover puntos, tocar un borde para agregar uno, quitar el punto elegido, trasladar, agrandar o achicar desde las esquinas y girar con la manija; Deshacer, «Volver al de GNeST», teclas Supr, Ctrl+Z y Esc. Se guarda el contorno final y, aparte, el original de GNeST.
  - **Dibujar** un nido que GNeST no vio: se marca el contorno tocando la foto y luego se acepta o enlaza.
- Al revisar una propuesta pasa sola a la siguiente (también de foto). **El vuelo se cierra solo** al revisar la última; si GNeST no dejó ninguna, se cierra con «Cerrar vuelo».
- En el mapa y en el visor solo se ven las máscaras ya enlazadas a un nido.

## Pendiente (6b)

- GNeST baja solo los vuelos subidos desde la web y la PC genera los recortes de los nidos dibujados.
