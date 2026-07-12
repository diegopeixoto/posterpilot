---
title: Instalación
description: Ejecuta PosterPilot como un único contenedor Docker usando la imagen oficial de GHCR, con ejemplos de Docker Compose para macOS y Unraid.
---

PosterPilot se ejecuta como un único contenedor Docker. La misma imagen multiarch
(`amd64` + `arm64`) funciona en un Mac, un servidor Unraid o en cualquier otro
lugar donde se ejecute Docker.

## La imagen oficial

La imagen oficial preconstruida se publica en GitHub Container Registry:

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

Las etiquetas siguen las versiones; `:latest` apunta a la versión más reciente.
Si prefieres actualizaciones reproducibles, puedes fijar una etiqueta de versión
concreta.

## Volúmenes y puertos

Importan dos volúmenes:

- **`/data`** — estado persistente: SQLite, ajustes, clave de cifrado, instantáneas
  y revisiones de ilustración, copias de la aplicación, caché y registro rotativo
  (`/data/logs/posterpilot.log`). Mantenlo en un volumen montado para que el estado
  sobreviva a las actualizaciones del contenedor; el archivo de registro vive dentro
  de `/data`, así que no necesita un volumen adicional.
- **`/kometa`** — monta aquí tu directorio de assets/config de Kometa para que el
  YAML exportado caiga donde Kometa lo lee. Solo necesario si usas la exportación
  de Kometa.

El contenedor escucha en el puerto **3000** por defecto (configurable mediante la
variable de entorno `PORT`). Publícalo en un puerto del host para acceder a la
interfaz.

## Clave de cifrado para los secretos almacenados

PosterPilot cifra los ajustes secretos (tokens del servidor multimedia y claves de
API de los proveedores) en reposo. Por defecto, autogenera una clave de instancia
en `data/.app-key` en la primera ejecución: **cero configuración requerida**. Como
esa clave vive dentro del volumen `/data`, mantener `/data` en un almacenamiento
persistente y con copia de seguridad conserva tus secretos descifrables a través de
las actualizaciones del contenedor.

Opcionalmente, define la variable de entorno **`APP_SECRET`** para derivar la clave
a partir de un valor que tú controlas cuando quieras que los secretos sigan siendo
portables si el contenedor (y su `data/.app-key`) se recrea. Si no defines
`APP_SECRET`, trata `data/.app-key` como parte de tus copias de seguridad: perderla
significa reintroducir cada credencial guardada. Consulta
[Configuración](../configuration/)
para conocer el comportamiento completo.

## Copia antes de actualizar

Deja terminar los trabajos mutantes y copia el volumen `/data` completo. Si la
versión instalada incluye **Ajustes → Copias y restauración**, crea y valida además
una copia manual. Conserva el mismo `APP_SECRET` o `.app-key`.

Las actualizaciones ejecutan migraciones aditivas. Una instalación de un servidor
se convierte en un **Servidor predeterminado** nombrado y protegido, sin descartar
elementos ni historial. Sigue la [lista de migración multiservidor](../multi-server-migration/).

## Montar la configuración de Kometa

Para usar el [Gestor de Kometa](../kometa-config-sync/), monta con lectura/escritura
el directorio que contiene `config.yml` y define, por ejemplo,
`KOMETA_CONFIG_PATH=/config/config.yml`. `posterpilot.yml` se escribe junto a ese
archivo; no hace falta otra ruta de metadatos. El volumen contiene secretos Kometa
en texto plano, así que protege sus permisos.

## Docker Compose (macOS)

Crea un `docker-compose.yml`:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    healthcheck:
      test:
        [
          'CMD',
          'bun',
          '-e',
          "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Opcional — también puedes definir estos valores en la página de Ajustes de la app:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Opcional — deriva la clave de cifrado de secretos (si no, se autogenera en data/.app-key):
      # APP_SECRET: ${APP_SECRET:-}
    volumes:
      # Estado persistente de la app (base de datos SQLite + ajustes + historial).
      - ./data:/data
      # Monta aquí tu directorio de assets/config de Kometa para recoger el YAML exportado.
      - ./data/kometa:/kometa
    restart: unless-stopped
```

Después arráncalo:

```sh
docker compose up -d
# Interfaz en http://localhost:3000
```

El `docker-compose.yml` incluido en el repositorio tiene la misma forma e incluye
una opción `build: .` por si prefieres construir la imagen localmente en lugar de
descargarla:

```sh
docker compose up -d --build
```

## Unraid (Community Apps)

PosterPilot está publicado en la tienda **Community Apps de Unraid**. Abre la pestaña
**Apps**, busca **PosterPilot** y haz clic en _Install_.

¿Prefieres añadirlo a mano? El repositorio también incluye la plantilla en
`unraid/posterpilot.xml`. En la interfaz de Unraid ve a **Docker → Add Container**
y pega esto en el campo _Template_:

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

Rellena previamente la imagen de GHCR, el puerto de la WebUI, los volúmenes
`/data` y `/kometa`, y campos de credenciales opcionales (Plex / Jellyfin / Emby,
TMDB, Fanart.tv, idioma), todos los cuales también puedes configurar más tarde en
la página de Ajustes.

## Docker Compose (Unraid)

¿Prefieres Compose? Apunta los volúmenes a tu recurso compartido `appdata`; en
particular, apunta el volumen de Kometa a tu directorio de configuración de Kometa
**existente** para que el YAML exportado caiga donde Kometa ya lo lee:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Opcional — o configura estos valores en la página de Ajustes:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Opcional — deriva la clave de cifrado de secretos (si no, se autogenera en data/.app-key):
      # APP_SECRET: ${APP_SECRET:-}
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
    restart: unless-stopped
```

Define `PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY` en el entorno del contenedor, o
déjalos en blanco y configúralo todo desde la página de Ajustes; después accede al
contenedor en el puerto 3000.

## Primera ejecución

1. Arranca el contenedor y abre `http://<host>:3000` (p. ej.
   `http://localhost:3000`).
2. En la primera ejecución aún no hay nada sincronizado. Un banner te dirige al
   **asistente de primera instalación** en `/setup`, que te guía por seis pasos:
   elegir un idioma, conectar un servidor multimedia, añadir una clave de TMDB,
   habilitar proveedores de carátulas, elegir qué bibliotecas sincronizar y ejecutar
   la primera sincronización. Para Plex, el asistente incluye un inicio de sesión con
   PIN y el descubrimiento de conexiones, así que nunca tienes que pegar un token o
   una URL. El asistente se puede omitir: puedes configurarlo todo en **Ajustes**.
   Cada paso avanza solo tras una respuesta válida, y el último sigue el primer
   trabajo hasta un estado terminal, mostrando fallo y reintento cuando corresponda.
3. Si defines las credenciales mediante variables de entorno, aparecen ya
   configuradas y bloqueadas para su edición tanto en el asistente como en Ajustes
   (consulta [Configuración](/posterpilot/es/configuration/)).
4. Una vez sincronizado, empieza a encontrar y aplicar carátulas (consulta
   [Uso](/posterpilot/es/usage/)).

## Restaurar una copia de la aplicación

Usa **Ajustes → Copias y restauración**; no sustituyas SQLite en vivo. La vista
previa valida checksums, integridad, esquema, espacio, rutas y clave. Confirmar entra
en mantenimiento, drena mutaciones, crea una copia de seguridad y prepara el marcador.
Reinicia el contenedor para aplicar el reemplazo antes de abrir libsql y revisa el
informe de preparación. Consulta [Automatización y recuperación](../automation-recovery/).

## Comprobación de estado

La app expone un endpoint `GET /api/health` sin autenticación que devuelve
`{ "status": "ok", "version": "x.y.z" }` con HTTP 200; úsalo como sonda de estado
del contenedor (el `docker-compose.yml` incluido ya lo hace):

```sh
curl -s http://localhost:3000/api/health
```
