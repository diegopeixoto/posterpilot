---
title: Configuración
description: Conecta un servidor multimedia, define tu clave de TMDB, habilita proveedores de carátulas, configura la exportación de Kometa y usa la referencia completa de variables de entorno.
---

PosterPilot se configura de dos maneras, que funcionan juntas:

- **Variables de entorno** — definidas en el contenedor. Útiles para
  configuraciones desatendidas y la gestión de secretos.
- **La página de Ajustes de la app** — introducidas en la interfaz y persistidas
  en la base de datos SQLite bajo `/data` para que sobrevivan a los reinicios.
  Ajustes está organizado en pestañas: **Servidor multimedia**, **Metadatos y
  proveedores**, **Kometa y avanzado**, **Idioma** y **Actividad** (el registro de
  eventos de la app). Un
  [asistente de primera instalación](/posterpilot/es/installation/#primera-ejecución)
  guiado en `/setup` cubre lo mismo, en orden, para una instalación nueva.

## Entorno frente a la interfaz de Ajustes

Para cualquier ajuste dado, la **variable de entorno siempre tiene prioridad**
sobre el valor persistido de la interfaz. Cuando un valor se suministra mediante el
entorno, la página de Ajustes lo muestra como _gestionado por el entorno_ y lo
bloquea para su edición en la interfaz, de modo que la fuente de verdad sea
inequívoca.

Si un valor no se define en ninguno de los dos sitios, se aplica el valor
predeterminado documentado (si lo hay), o la función que depende de él permanece
sin configurar hasta que lo definas.

Los secretos (el token de Plex, las claves de API de Jellyfin/Emby, la credencial
de TMDB y la clave de Fanart.tv) nunca se devuelven al navegador después de
guardarse y se ocultan de los registros; la página de Ajustes solo indica que un
secreto _está definido_.

## Servidor multimedia

PosterPilot habla con un servidor multimedia activo a la vez, elegido mediante
`SERVER_TYPE` (`plex`, `jellyfin` o `emby`; por defecto `plex`). Solo se validan
las credenciales del servidor activo antes de una sincronización.

### Plex

Plex necesita una URL base y un `X-Plex-Token`. Puedes suministrarlos de tres
maneras:

- **Inicio de sesión con PIN (recomendado).** En Ajustes, inicia un inicio de
  sesión de Plex. PosterPilot crea un PIN fuerte con plex.tv, te muestra un código
  y un enlace de autorización, y sondea hasta que lo autorizas; entonces almacena
  el token obtenido por ti, así que nunca tienes que buscar y pegar un token en
  bruto. Si el PIN caduca antes de que autorices, simplemente inicia un nuevo
  inicio de sesión.
- **Descubrimiento de conexiones.** Una vez disponible un token, PosterPilot puede
  descubrir tus servidores Plex y sus conexiones desde plex.tv, etiquetando cada
  conexión como **local** o **remota** (los relés se marcan). Elige una en lugar de
  escribir una URL; la conexión elegida se verifica con una prueba de conexión
  antes de guardarse como la URL base activa de Plex.
- **Manual.** Pega la URL base (p. ej. `http://192.168.1.10:32400`) y un
  `X-Plex-Token` directamente.

### Jellyfin

Jellyfin necesita una URL base (`JELLYFIN_URL`) y una clave de API
(`JELLYFIN_API_KEY`). Define `SERVER_TYPE=jellyfin` para convertirlo en el servidor
activo. Los pósters y los fondos se suben a la API de imágenes de Jellyfin
(`Primary` para el póster, `Backdrop` para el fondo). No hay inicio de sesión con
PIN ni descubrimiento de conexiones para Jellyfin: suministra la URL y la clave de
API directamente.

:::note
La ruta de Plex es la más probada; las integraciones de Jellyfin y Emby son más
nuevas. Funcionan detrás de la misma interfaz de servidor multimedia, así que
sincronizar, descubrir y aplicar funcionan de forma idéntica; pero si te topas con
una peculiaridad específica del servidor, por favor abre una incidencia.
:::

### Emby

Emby necesita una URL base (`EMBY_URL`) y una clave de API (`EMBY_API_KEY`). Define
`SERVER_TYPE=emby` para convertirlo en el servidor activo. Como Jellyfin, Emby usa
una URL + clave de API directamente (sin inicio de sesión con PIN ni descubrimiento
de conexiones).

## Clave de TMDB

Se requiere una credencial de API de [TMDB](https://www.themoviedb.org/):
PosterPilot resuelve cada título sincronizado a un id de TMDB (para que los
proveedores puedan consultarse con precisión) y TMDB es además uno de los
proveedores de carátulas. Defínela mediante `TMDB_KEY` o en Ajustes. Se aceptan
tanto una **clave de API v3** como un **token bearer/JWT v4**; el formato se
detecta automáticamente.

## Proveedores de carátulas

PosterPilot despliega la búsqueda entre varios proveedores de carátulas durante el
descubrimiento y fusiona sus candidatas, etiquetando cada una con el proveedor del
que procede. Cada proveedor puede habilitarse o deshabilitarse de forma
independiente, en Ajustes o mediante su variable de entorno.

| Proveedor       | Por defecto | ¿Necesita clave?      | Notas                                                                |
| --------------- | ----------- | --------------------- | -------------------------------------------------------------------- |
| **MediUX**      | activado    | no                    | Conjuntos de pósters/fondos extraídos con atribución del autor.      |
| **TMDB**        | activado    | reutiliza `TMDB_KEY`  | Pósters y fondos del endpoint de imágenes de TMDB.                   |
| **Fanart.tv**   | desactivado | `FANART_KEY`          | Pósters, fondos y logos de la API de Fanart.tv.                      |
| **ThePosterDB** | desactivado | no                    | Conjuntos comunitarios de pósters/fondos extraídos, limitados y en caché. |

Fanart.tv es el único proveedor con clave: si está habilitado pero no hay ninguna
`FANART_KEY` configurada, el descubrimiento lo omite y muestra la condición de
credencial faltante en lugar de hacer fallar toda la ejecución. Un fallo, un tiempo
de espera agotado o una respuesta no analizable de un proveedor nunca impide que
los demás devuelvan candidatas.

## Exportación de Kometa

Cuando aplicas una carátula con el método de Kometa, PosterPilot escribe YAML
compatible con Kometa/PMM (`url_poster` / `url_background`, indexado por id de TMDB)
en el directorio indicado por `KOMETA_ASSETS_DIR` (por defecto `/kometa` en
Docker). Monta esa ruta en tu directorio de configuración de Kometa existente para
que Kometa aplique las carátulas en su próxima ejecución. Consulta
[Uso](/posterpilot/es/usage/#aplicar-una-carátula) para saber cómo se consume la
exportación.

## Idioma

El idioma de la interfaz se resuelve por petición: (1) el ajuste de idioma
preferido cuando nombra un locale soportado, luego (2) la cabecera
`Accept-Language` de la petición y luego (3) el inglés. Define un idioma preferido
con `LANGUAGE`, mediante la página de Ajustes o con el selector de idioma de la
cabecera. Los locales soportados son inglés (`en`), español (`es`), chino
simplificado (`zh`), japonés (`ja`) y portugués de Brasil (`pt-BR`). Un valor sin
definir o no soportado pasa a `Accept-Language`, luego al inglés; nunca un error y
nunca una clave en bruto.

## Registro y registro de actividad

Cada evento operativo se registra de tres maneras: replicado en la consola del
contenedor, insertado como una fila en el registro de **Actividad** de la app
(Ajustes → Actividad) y añadido a un archivo de registro rotativo. El archivo es
`posterpilot.log` dentro de `LOG_DIR` (por defecto `/data/logs` en Docker); cuando
crece más allá de ~5 MB rota (`posterpilot.log` → `.1` → `.2`…), conservando unos
cinco archivos. Como el valor predeterminado vive bajo `/data`, el volumen `/data`
existente ya lo persiste; no se requiere ningún montaje adicional.

La tabla del registro de Actividad está limitada a `EVENT_RETENTION` filas (por
defecto `2000`); las filas más antiguas se podan automáticamente. Puedes vaciar la
tabla en cualquier momento con el botón **Limpiar actividad** de la pestaña
Actividad (esto no elimina el archivo de registro en disco).

## Referencia de variables de entorno

Todos los ajustes de abajo pueden suministrarse como variable de entorno. La
mayoría también son editables en la página de Ajustes; cuando se definen mediante
el entorno tienen prioridad y quedan bloqueados en la interfaz.

| Variable                  | Ajuste                          | Por defecto                            | Significado                                                                                            |
| ------------------------- | ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SERVER_TYPE`             | Tipo de servidor                | `plex`                                 | Servidor multimedia activo: `plex`, `jellyfin` o `emby`.                                              |
| `PLEX_URL`                | URL de Plex                     | —                                      | URL base de Plex, p. ej. `http://192.168.1.10:32400`.                                                 |
| `PLEX_TOKEN`              | Token de Plex (secreto)         | —                                      | Tu `X-Plex-Token`.                                                                                     |
| `PLEX_CLIENT_ID`          | Id de cliente de Plex           | generado                               | Identificador estable por instalación enviado a plex.tv para inicio de sesión con PIN / descubrimiento. |
| `JELLYFIN_URL`            | URL de Jellyfin                 | —                                      | URL base de Jellyfin (cuando `SERVER_TYPE=jellyfin`).                                                 |
| `JELLYFIN_API_KEY`        | Clave de API de Jellyfin (secreto) | —                                   | Clave de API de Jellyfin.                                                                              |
| `EMBY_URL`                | URL de Emby                     | —                                      | URL base de Emby (cuando `SERVER_TYPE=emby`).                                                         |
| `EMBY_API_KEY`            | Clave de API de Emby (secreto)  | —                                      | Clave de API de Emby.                                                                                  |
| `TMDB_KEY`                | Clave de TMDB (secreto)         | —                                      | Clave de API v3 de TMDB **o** bearer/JWT v4 (autodetectado).                                          |
| `KOMETA_ASSETS_DIR`       | Dir. de assets de Kometa        | `./data/kometa` (`/kometa` en Docker)  | Directorio donde se escribe el YAML de Kometa exportado.                                              |
| `DEFAULT_APPLY_METHOD`    | Método de aplicación por defecto | `both`                                | Método de aplicación por defecto: `plex`, `kometa` o `both`.                                          |
| `INCLUDED_SECTIONS`       | Secciones incluidas             | todas las de película/serie            | Claves de sección de la biblioteca a sincronizar; separadas por comas (env) o un array JSON (persistido). Vacío = todas. |
| `PROVIDER_MEDIUX`         | Proveedor MediUX                | activado                               | Habilita el proveedor MediUX.                                                                          |
| `PROVIDER_TMDB`           | Proveedor TMDB                  | activado                               | Habilita el proveedor de carátulas de TMDB.                                                           |
| `PROVIDER_FANART`         | Proveedor Fanart.tv             | desactivado                            | Habilita el proveedor Fanart.tv (requiere `FANART_KEY`).                                              |
| `PROVIDER_THEPOSTERDB`    | Proveedor ThePosterDB           | desactivado                            | Habilita el proveedor ThePosterDB.                                                                     |
| `FANART_KEY`              | Clave de Fanart.tv (secreto)    | —                                      | Clave de API de Fanart.tv (el único proveedor con clave).                                             |
| `MEDIUX_REQUEST_DELAY_MS` | Retardo de petición de MediUX   | `2000`                                 | Retardo entre peticiones a MediUX, en milisegundos (limitación).                                     |
| `MEDIUX_CONCURRENCY`      | Concurrencia de MediUX          | `5`                                    | Máximo de peticiones concurrentes a MediUX.                                                            |
| `HTTP_CACHE_TTL_DAYS`     | TTL de caché HTTP               | `7`                                    | Cuánto tiempo se reutilizan las respuestas HTTP en caché (scrapes), en días.                         |
| `LANGUAGE`                | Idioma                          | — (automático)                         | Locale de interfaz preferido: `en`, `es`, `zh`, `ja` o `pt-BR`.                                      |
| `LOG_DIR`                 | —                               | `/data/logs` (Docker)                  | Carpeta del archivo rotativo `posterpilot.log` (~5 MB × 5 archivos).                                 |
| `EVENT_RETENTION`         | —                               | `2000`                                 | Número máximo de filas del registro de actividad conservadas en la base de datos (las más antiguas se podan). |
| `DATABASE_URL`            | —                               | `file:/data/posterpilot.db` (Docker)   | URL de archivo libsql para la base de datos SQLite.                                                   |
| `PORT`                    | —                               | `3000`                                 | Puerto de escucha.                                                                                     |

Las banderas booleanas aceptan `1` / `true` / `on` / `yes` (sin distinguir
mayúsculas) para _habilitado_; cualquier otra cosa (o sin definir) deja el valor
predeterminado documentado.

:::note
`DATABASE_URL`, `PORT`, `LOG_DIR` y `EVENT_RETENTION` son ajustes a nivel de
despliegue: se leen solo del entorno y no forman parte de la página de Ajustes de
la app.
:::
</content>
