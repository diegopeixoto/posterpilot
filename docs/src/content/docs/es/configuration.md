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

En **Metadatos y proveedores** puedes ordenar la prioridad y ajustar pesos de
proveedor, resolución y proporción. La misma configuración determinista se usa en
vista previa y ejecución. `SUGGEST_PRESELECT` muestra la mejor sugerencia, pero
aceptarla/prepararla siempre es explícito.

## Kometa y método de aplicación

`DEFAULT_APPLY_METHOD` acepta `plex` (servidor directo), `kometa` o `both`. Es el
valor de inicio; elegir otro método en una acción no cambia el ajuste guardado.

El export escribe `posterpilot.yml` en `KOMETA_ASSETS_DIR`; si
`KOMETA_CONFIG_PATH` está definido, lo escribe junto a ese `config.yml`.
`KOMETA_SERVER_INSTANCE_ID` debe señalar una instancia Plex concreta. Consulta el
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
admitidos son `en`, `es`, `zh`, `ja` y `pt-BR`.

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
| `KOMETA_ASSETS_DIR` | `./data/kometa` (`/kometa` en Docker) | Directorio de `posterpilot.yml` cuando no hay config path. |
| `KOMETA_CONFIG_PATH` | — | Ruta absoluta al `config.yml`; vacío desactiva el gestor. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` o `own`. |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Instancia Plex exacta vinculada a Kometa. |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`, `kometa` o `both`. |
| `INCLUDED_SECTIONS` | todas | Claves separadas por comas; el entorno anula la selección por servidor. |
| `PROVIDER_MEDIUX` | activado | Habilita MediUX. |
| `PROVIDER_TMDB` | activado | Habilita imágenes de TMDB. |
| `PROVIDER_FANART` | desactivado | Habilita Fanart.tv. |
| `PROVIDER_THEPOSTERDB` | desactivado | Habilita ThePosterDB. |
| `FANART_KEY` | — | Clave Fanart.tv (secreto). |
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
| `APP_LANGUAGE` | automático | `en`, `es`, `zh`, `ja` o `pt-BR`. |
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
