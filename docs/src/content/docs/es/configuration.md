---
title: Configuración
description: Configura servidores nombrados, proveedores, Kometa, automatización, copias, seguridad y todas las variables de entorno admitidas.
---

PosterPilot combina dos fuentes:

- **Variables de entorno**, ideales para despliegues y gestión de secretos.
- **Ajustes de la app**, persistidos en SQLite bajo `/data`.

Para una misma opción, **el entorno siempre tiene prioridad**. La interfaz marca el
valor como gestionado por el entorno y lo bloquea. Los secretos guardados se cifran
con AES-256-GCM y nunca se devuelven completos al navegador ni a los registros.

## Clave de cifrado

Sin configuración, PosterPilot crea `data/.app-key` con permisos del propietario.
`APP_SECRET` deriva una clave portátil y tiene prioridad sobre ese archivo. Conserva
la misma clave al mover o restaurar la instalación; si se pierde, tendrás que volver
a introducir las credenciales. Consulta [Automatización y recuperación](../automation-recovery/).

## Servidores multimedia nombrados

**Ajustes → Servidores** permite añadir, probar, activar, habilitar, deshabilitar y
desconectar varias instancias Plex, Jellyfin y Emby. Una está activa para Biblioteca,
Review, Colecciones, FUN y mutaciones. Cada instancia conserva su propia URL,
credencial cifrada y capacidades.

Las variables heredadas `SERVER_TYPE` y `PLEX_*` / `JELLYFIN_*` / `EMBY_*` definen
el servidor predeterminado protegido. Los servidores adicionales se guardan en la
base de datos; consulta [Migración multiservidor](../multi-server-migration/).

- **Plex:** token manual o inicio PIN/descubrimiento durante setup.
- **Jellyfin/Emby:** URL y clave/token; setup también puede intercambiar usuario y
  contraseña por un token reutilizable sin guardar la contraseña.

## TMDB, proveedores y puntuación

`TMDB_KEY` acepta una clave v3 o token bearer/JWT v4. MediUX y TMDB están habilitados
por defecto; Fanart.tv requiere `FANART_KEY`; ThePosterDB es opcional. Un proveedor
fallido no bloquea a los demás y puede conservar candidatas conocidas como obsoletas.

ThePosterDB funciona sin cuenta, pero en algunas páginas sirve una imagen de
relleno a los visitantes anónimos en lugar de la ilustración real. Puedes iniciar
sesión de forma **opcional** — en **Metadatos y proveedores** (los campos aparecen
al habilitar ThePosterDB) o con `THEPOSTERDB_USERNAME` / `THEPOSTERDB_PASSWORD` —
para obtener las imágenes reales. La contraseña se cifra en reposo como los demás
secretos, y un inicio de sesión fallido vuelve al modo anónimo en esa ejecución en
lugar de bloquear el descubrimiento. Para volver al modo anónimo, borra el
usuario (iniciar sesión requiere ambos); la contraseña guardada permanece
cifrada y se reutiliza si vuelves a introducir el usuario, salvo que la
elimines con el control **Borrar la contraseña guardada** bajo el campo de
contraseña, que borra el secreto al guardar.

![Ajustes de proveedores de PosterPilot con ThePosterDB habilitado y sus campos opcionales de usuario y contraseña](/posterpilot/screenshots/settings-providers.webp)

En **Metadatos y proveedores** puedes ordenar la prioridad y ajustar pesos de
proveedor, resolución y proporción. La misma configuración determinista se usa en
vista previa y ejecución. `SUGGEST_PRESELECT` muestra la mejor sugerencia, pero
aceptarla/prepararla siempre es explícito.

## Idioma de las ilustraciones de TMDB

`TMDB_ARTWORK_LANGUAGE` (`any` por defecto) decide en qué idioma exploras y
seleccionas automáticamente las ilustraciones de TMDB, con independencia de
`APP_LANGUAGE`: `any` mantiene todos los idiomas que devolvió TMDB, `ui` sigue el
idioma de la interfaz normalizado a su código base (una interfaz `pt-BR` prefiere
`pt`) y un código ISO 639-1 explícito (`en`, `de`…) no se limita a los seis
locales traducidos. Un valor no reconocido se trata como ausente y vuelve a `any`
en lugar de aplicar un filtro roto. Como el resto, el entorno tiene prioridad y
el campo aparece como gestionado por el entorno.

Las ilustraciones que TMDB no etiqueta cuentan como neutras y siguen disponibles
con cualquier preferencia, así que una preferencia nunca vacía un panel que solo
contiene arte neutro. El descubrimiento conserva siempre todos los idiomas —la
preferencia rige la exploración y la selección automática, no lo que se
descarga—, de modo que cambiarla vuelve a filtrar lo que ya tienes y nunca obliga
a repetir la búsqueda. La selección automática solo recurre a un póster en otro
idioma cuando no queda ninguna opción preferida ni sin etiquetar, y lo indica
cuando ocurre. La página del elemento añade un conmutador temporal
**Preferido / Todos** que no modifica el ajuste global.

## Inventario de candidatos y «cargar más»

La ingesta de TMDB se detenía antes en 20 imágenes **por tipo de ilustración**
—pósteres y fondos se contaban por separado, de ahí los avisos de «limitado a 40
carátulas»—. Ahora se conservan muchas más, sin duplicados por la identidad de
archivo de TMDB y en el orden en que TMDB las clasificó, y cada panel de proveedor
y tipo muestra un lote acotado con un control **cargar más** que indica cuántos
candidatos siguen ocultos. Los paneles de pósteres y de fondos se despliegan de
forma independiente. El descubrimiento mantiene un tope defensivo de **200
candidatos por tipo de ilustración** —un límite de almacenamiento y renderizado,
no un filtro de calidad—: cuando un panel lo alcanza, avisa de que el inventario
está **truncado** en lugar de dar a entender que está completo.

## Kometa y método de aplicación

`DEFAULT_APPLY_METHOD` acepta `plex` (servidor directo), `kometa` o `both`. Es el
valor de inicio; elegir otro método en una acción no cambia el ajuste guardado.

El export escribe `posterpilot-movies.yml` (TMDB) y `posterpilot-shows.yml` (TVDB,
con IMDb como alternativa) en `KOMETA_ASSETS_DIR`; si `KOMETA_CONFIG_PATH` está
definido, los escribe junto a ese `config.yml`. `KOMETA_SERVER_INSTANCE_ID` debe
señalar una instancia Plex concreta. `KOMETA_METADATA_PATH_PREFIX` define la
referencia relativa que ve Kometa, no la ruta física. Consulta el
[Gestor de Kometa](../kometa-config-sync/).

## Automatización, copias y diagnóstico

- **Automatización:** intervalos, hora diaria o eventos por servidor/biblioteca;
  sincroniza y descubre para Review, nunca autoaplica.
- **Copias y restauración:** bundles bajo `/data/backups`, retención por cantidad o
  edad, validación, exportación y restauración previsualizada. La retención se guarda
  en la app y no tiene variable de entorno.
- **Diagnósticos:** pruebas no mutantes de servidores, TMDB, proveedores y rutas,
  más exportación explícita de un paquete de soporte saneado.

## Seguridad y FUN

`AUTH_MODE` es `disabled`, `local` o `enabled`. Detrás de un proxy, configura
`ADDRESS_HEADER` y `XFF_DEPTH` para que el modo `local` evalúe la IP real.
`FUN_ENABLED` activa el
selector de tres opciones, Poster Match, galería y planificador de sesiones.

## Idioma

El idioma usa `APP_LANGUAGE`, luego `Accept-Language`, luego inglés. Los locales
admitidos son `en`, `es`, `zh`, `ja`, `pt-BR` y `fr`.

## Referencia completa de variables de entorno

| Variable | Predeterminado | Significado |
| --- | --- | --- |
| `SERVER_TYPE` | `plex` | Tipo del servidor heredado: `plex`, `jellyfin` o `emby`. |
| `PLEX_URL` | — | URL base del Plex predeterminado. |
| `PLEX_TOKEN` | — | Token Plex (secreto). |
| `PLEX_CLIENT_ID` | generado | ID estable usado para PIN/descubrimiento. |
| `JELLYFIN_URL` | — | URL base de Jellyfin. |
| `JELLYFIN_API_KEY` | — | Clave/token Jellyfin (secreto). |
| `EMBY_URL` | — | URL base de Emby. |
| `EMBY_API_KEY` | — | Clave/token Emby (secreto). |
| `TMDB_KEY` | — | Clave v3 o bearer/JWT v4 de TMDB (secreto). |
| `KOMETA_ASSETS_DIR` | `./data/kometa` (`/kometa` en Docker) | Directorio de los YAML tipados cuando no hay config path. |
| `KOMETA_CONFIG_PATH` | — | Ruta absoluta al `config.yml`; vacío desactiva el gestor. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` o `own`. |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Instancia Plex exacta vinculada a Kometa. |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Directorio relativo visible para el runtime de Kometa; `.` usa nombres simples. |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`, `kometa` o `both`. |
| `INCLUDED_SECTIONS` | todas | Claves separadas por comas; el entorno anula la selección por servidor. |
| `PROVIDER_MEDIUX` | activado | Habilita MediUX. |
| `PROVIDER_TMDB` | activado | Habilita imágenes de TMDB. |
| `PROVIDER_FANART` | desactivado | Habilita Fanart.tv. |
| `PROVIDER_THEPOSTERDB` | desactivado | Habilita ThePosterDB. |
| `FANART_KEY` | — | Clave Fanart.tv (secreto). |
| `THEPOSTERDB_USERNAME` | — | Usuario o correo opcional de ThePosterDB para buscar con sesión iniciada. |
| `THEPOSTERDB_PASSWORD` | — | Contraseña de la cuenta opcional de ThePosterDB (secreto, cifrada en reposo). |
| `TMDB_ARTWORK_LANGUAGE` | `any` | Ilustraciones de TMDB que se exploran y autoseleccionan: `any`, `ui` (sigue la interfaz) o un código ISO 639-1 como `en`; un valor no válido vuelve a `any`. |
| `MEDIUX_REQUEST_DELAY_MS` | `2000` | Pausa entre solicitudes MediUX, ms. |
| `MEDIUX_CONCURRENCY` | `5` | Solicitudes MediUX simultáneas. |
| `HTTP_CACHE_TTL_DAYS` | `7` | TTL de respuestas HTTP en caché. |
| `APPLY_CONCURRENCY` | `4` | Elementos simultáneos en aplicación por lotes. |
| `SUGGEST_PRESELECT` | activado | Calcula y muestra sugerencias explícitas. |
| `INCREMENTAL_SYNC` | activado | Omite elementos sin cambios en sincronizaciones normales. |
| `LIBRARY_DEFAULT_SORT` | `title` | `title`, `year`, `rating`, `runtime`, `recent` o `added`. |
| `FUN_ENABLED` | desactivado | Muestra las herramientas FUN. |
| `THUMB_CACHE_TTL_DAYS` | `30` | Días de vigencia de miniaturas en caché. |
| `THUMB_CACHE_MAX_MB` | `512` | Límite de caché de miniaturas en MB. |
| `APP_LANGUAGE` | automático | `en`, `es`, `zh`, `ja`, `pt-BR` o `fr`. |
| `AUTH_MODE` | `disabled` | `disabled`, `local` o `enabled`; anula/bloquea la UI. |
| `ADDRESS_HEADER` | — | Cabecera de IP real detrás de proxy, p. ej. `x-forwarded-for`. |
| `XFF_DEPTH` | — | Número de proxies de confianza. |
| `MAX_UPLOAD_MB` | `15` | Tamaño máximo de una carga de imagen. |
| `LOG_DIR` | `./data/logs` (`/data/logs` en Docker) | Directorio del registro rotativo. |
| `EVENT_RETENTION` | `2000` | Filas máximas del registro de actividad. |
| `DATABASE_URL` | `file:./data/posterpilot.db` | URL libsql del SQLite. |
| `PORT` | `3000` | Puerto HTTP. |
| `APP_SECRET` | — | Deriva la clave de cifrado y anula `.app-key`. |
| `APP_KEY_FILE` | `./data/.app-key` | Ruta de la clave generada. |

Los booleanos aceptan `1`, `true`, `on` o `yes` (sin distinguir mayúsculas). Los
valores de despliegue `DATABASE_URL`, `PORT`, `APP_SECRET`, `APP_KEY_FILE`,
`ADDRESS_HEADER`, `XFF_DEPTH` y `MAX_UPLOAD_MB` solo se leen del entorno.
