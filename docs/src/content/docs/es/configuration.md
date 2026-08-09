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

En **Metadatos y proveedores** puedes ajustar los pesos de proveedor, resolución y
proporción. La misma configuración determinista se usa en vista previa y ejecución.
`SUGGEST_PRESELECT` muestra la mejor sugerencia, pero aceptarla/prepararla siempre
es explícito.

## Orden de proveedores

**Metadatos y proveedores** también permite **reordenar** los cuatro proveedores,
arrastrando un asa o con los botones de mover; **Restablecer el orden predeterminado**
devuelve MediUX, ThePosterDB, Fanart.tv, TMDB. Como los pesos, el orden vive en la
base de datos y no tiene variable de entorno.

El control existe porque el descubrimiento corre todos los proveedores en paralelo y
cada uno confirma sus propios resultados, así que el orden en que acabaron guardadas
las candidatas no registra nada más que quién respondió primero; presentar ese
accidente de reloj como un ranking sería engañoso, y por eso la vista del elemento
sigue el orden que hayas configurado. Lo que el orden hace —y, no menos importante, lo
que no hace:

- Decide **qué tarjeta de proveedor muestra primero la página del elemento**. Solo
  presentación; las candidatas dentro de una tarjeta conservan su propio orden.
- Desempata entre candidatas con puntuación **exactamente igual**, y se aplica
  estrictamente después de la puntuación numérica.
- Nunca revierte una puntuación desigual. Una imagen más nítida o mejor proporcionada
  de un proveedor que pusiste el último se lleva igualmente la sugerencia: el proveedor
  desempata, no manda. Para cambiar qué proveedor suele ganar, ajusta sus pesos.
- Un **proveedor deshabilitado conserva su posición**, así que rehabilitarlo no lo
  manda al final. Un proveedor que tu orden guardado no menciona —una fuente nueva, o
  una fila que dejó otra retirada— se muestra el último en vez de recolocarlo todo a su
  alrededor.

## Idioma de las ilustraciones de TMDB

`TMDB_ARTWORK_LANGUAGE` (`any` por defecto) decide en qué idioma exploras y
seleccionas automáticamente las ilustraciones de TMDB, con independencia de
`APP_LANGUAGE`: `any` mantiene todos los idiomas que devolvió TMDB, `ui` sigue el
idioma de la interfaz normalizado a su código base (una interfaz `pt-BR` prefiere
`pt`; si no hay ninguna interfaz que resolver —un trabajo desatendido en una
instalación que nunca persistió una— degrada a `any` en vez de inventarse un idioma)
y un código ISO 639-1 explícito (`en`, `de`…) no se limita a los seis locales
traducidos: el desplegable de Ajustes ofrece diez seleccionados (alemán, inglés,
español, francés, italiano, japonés, coreano, portugués, ruso, chino) y un código
puesto por el entorno que no esté en esa lista se añade al desplegable en lugar de
descartarse, así que guardar Ajustes nunca lo reescribe en silencio. Un valor no
reconocido se trata como ausente y vuelve a `any` en lugar de aplicar un filtro roto.
Como el resto, el entorno tiene prioridad y el campo aparece como gestionado por el
entorno.

**Rige TMDB y nada más.** La ilustración de los demás proveedores sigue siendo
elegible con cualquier preferencia, y eso es la regla, no un atajo: MediUX y
ThePosterDB nunca declaran idioma, así que tratar «sin idioma» como no elegible
vaciaría sus cuadrículas en cuanto se fijara una preferencia, y una búsqueda nueva
jamás podría recuperarlas porque volvería a no declarar idioma; Fanart.tv _sí_
etiqueta idiomas y aun así se deja en paz, porque filtrarlo descartaría en silencio un
archivo mejor puntuado por una señal que este ajuste nunca pretendió gobernar.

Las ilustraciones que TMDB marca explícitamente como sin idioma cuentan como neutras
y siguen disponibles con cualquier preferencia, así que una preferencia nunca vacía un
panel que solo contiene arte neutro. El descubrimiento conserva siempre todos los
idiomas —la preferencia rige la exploración y la selección automática, no lo que se
descarga—, de modo que cambiarla vuelve a filtrar lo que ya tienes y nunca obliga
a repetir la búsqueda. La selección automática solo recurre a un póster en otro
idioma cuando no queda ninguna opción preferida ni sin etiquetar, y lo indica
cuando ocurre; un recurso ya preparado sigue visible en la página en lugar de que lo
oculte la propia preferencia que lo produjo, porque una elección que debes poder ver
es una elección que debes poder revocar.

Hay un caso que la app no puede resolver sola: las candidatas de TMDB descubiertas
antes de que PosterPilot registrara _cómo_ había averiguado un idioma se marcan
**Sin verificar**, porque ahí un campo de idioma vacío significa «nunca lo
registramos», no «TMDB dijo que no lleva texto». Se conservan en lugar de ocultarse
—degradar todo el inventario de TMDB anterior a la actualización en cuanto se fija una
preferencia sería peor— y el grupo del proveedor ofrece **Volver a buscar** para que
una ejecución nueva registre las etiquetas reales.

La página del elemento lleva un conmutador **Mostrar todos los idiomas** (y **Mostrar
solo _idioma_** para volver) que no modifica el ajuste global. Cuando la preferencia no
coincide con nada para un título, la página dice cuántas carátulas existen en otros
idiomas y ofrece la misma salida en vez de mostrar una cuadrícula vacía.

## Inventario de candidatos y «cargar más»

La ingesta de TMDB se detenía antes en 20 imágenes **por tipo de ilustración**
—pósteres y fondos se contaban por separado, de ahí los avisos de «limitado a 40
carátulas»—. Ahora se conservan muchas más: primero validadas, luego deduplicadas por
la identidad de archivo del propio TMDB y luego acotadas, estrictamente en ese orden,
de manera que una entrada malformada ya no cuesta una candidata en silencio, y se
mantiene el orden en que TMDB las clasificó.

La página del elemento muestra cada panel en lotes de **24 miniaturas**, con un
control **cargar más** que nombra cuántas siguen ocultas. 24 divide exacto en todas
las cuadrículas que dibuja la página (dos columnas para fondos, cuatro para title
cards, ocho para pósteres de temporada), así que ninguna revelación deja media fila
coja. Cada panel se despliega por separado —proveedor a proveedor, set a set, pósteres
aparte de fondos y los pósteres de cada temporada aparte de sus title cards—, así que
abrir uno nunca abre otro. Revelar más no cuesta tráfico de red: el inventario
conservado ya viaja con la página, de modo que esto acota el coste de renderizado, no
el ancho de banda.

La ingesta mantiene un tope defensivo de **200 candidatos por tipo de ilustración**
—un límite de almacenamiento y renderizado, no un filtro de calidad—, y alcanzarlo se
avisa en vez de pasarlo por alto: el panel dice que el proveedor devolvió más carátulas
de las que PosterPilot conserva, en lugar de dar a entender que ves todo lo que tiene
TMDB. Solo cuenta para ese tope una candidata que se habría conservado; los duplicados
descartados y las entradas malformadas no, porque ni unos ni otras fueron nunca algo
que pudieras elegir.

La caché de miniaturas (`THUMB_CACHE_TTL_DAYS`, `THUMB_CACHE_MAX_MB`) guarda **solo
vistas previas de navegación**: la vista ampliada a tamaño completo y el archivo que se
aplica de verdad vienen directos del proveedor, a propósito, para que los originales no
expulsen las miniaturas a las que esa caché sirve. Ver
[Uso → Descubrir y preparar ilustración](../usage/).

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
