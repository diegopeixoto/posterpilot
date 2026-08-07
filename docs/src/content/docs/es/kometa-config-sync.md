---
title: Gestor de Kometa
description: Administra config.yml con vista previa exacta, confirmación, diffs saneados, escritura atómica y restauración previsualizada.
---

Además de [exportar ilustración como metadatos](../usage/#cómo-consume-kometa-la-exportación),
PosterPilot puede administrar `config.yml` en **`/kometa`**. Es opcional: sin una
ruta configurada no lee ni escribe el archivo.

:::note[La configuración y los metadatos cumplen funciones diferentes]
- **`posterpilot-movies.yml`** contiene ilustraciones de películas en el espacio
  de nombres TMDB, con IMDb como alternativa cuando no hay un ID TMDB.
- **`posterpilot-shows.yml`** contiene series, temporadas y episodios en el espacio
  TVDB, con IMDb como alternativa cuando no hay TVDB. El tipo registrado en
  PosterPilot decide el espacio; una clave numérica nunca sirve para adivinarlo.
- **`config.yml`** contiene conexiones, bibliotecas, colecciones, overlays,
  operaciones y ajustes de Kometa.
:::

## Activar y montar

| Variable | Predeterminado | Función |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | vacío | Ruta montada absoluta a `config.yml`; vacío desactiva el gestor. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` conserva contenido no administrado; `own` regenera todo. |
| `KOMETA_SERVER_INSTANCE_ID` | servidor heredado | Instancia Plex nombrada vinculada a Kometa. |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Directorio relativo que ve Kometa en ejecución; usa `.` (o vacía el campo de UI) para nombres simples. |

Monta el directorio de configuración con lectura/escritura; consulta
[Instalación](../installation/). Kometa es exclusivo de Plex: Jellyfin/Emby o tomar
credenciales de otra instancia implícitamente se rechazan.

La ruta física y la referencia Kometa son conceptos distintos. PosterPilot escribe
los dos archivos juntos en el directorio de salida configurado. Los valores `file:`
deben describir esos mismos archivos desde la vista del **runtime de Kometa**. Con
el prefijo predeterminado son `config/posterpilot-movies.yml` y
`config/posterpilot-shows.yml`, aunque otro nombre de montaje coloque físicamente
los archivos junto a `config.yml`. El prefijo es relativo: no uses una ruta del
host, una ruta absoluta del contenedor, una URL ni un nombre de archivo YAML.

## Áreas administradas

- **Conexiones** para Plex, TMDB, Tautulli, Trakt, MDBList, OMDb, GitHub, Radarr,
  Sonarr, Notifiarr, Gotify, ntfy, AniDB y MAL; secretos enmascarados.
- **Bibliotecas** con `metadata_files`, `collection_files`, overlays, operaciones y overrides.
- **Ajustes y webhooks** globales seleccionados.
- **Raw config.yml** para el archivo completo.
- **Copias** con marca temporal creadas al escribir.

En modo `merge` solo cambian las claves administradas; las demás claves y comentarios
se preservan. Secciones con anchors/aliases YAML se omiten con advertencia. La
comprobación de consistencia también avisa de charts/overlays sin conector.

## Vista previa y confirmación estructurada

1. Guarda ruta, modo y vinculación Plex.
2. Edita las secciones que administrará PosterPilot.
3. Selecciona **Previsualizar cambios**.
4. Revisa adiciones, cambios, eliminaciones, advertencias y diff saneado.
5. Selecciona **Confirmar sincronización previsualizada**.

El plan caduca, es de un solo uso y está vinculado a la huella del archivo, instancia
Plex, modo y contenido propuesto completo. Cambiar una entrada invalida la vista. Un
archivo, contenido o token obsoleto, alterado, caducado o reutilizado no escribe nada.

## Migrar el posterpilot.yml heredado

:::caution[Espera la versión publicada]
No renombres, dividas ni vuelvas a conectar `posterpilot.yml` a mano. Espera a que
la versión de PosterPilot que incluye esta migración aparezca en
[Releases](https://github.com/diegopeixoto/posterpilot/releases), actualiza tu
instancia y usa entonces la migración de `/kometa`.
:::

Una instalación existente puede mezclar películas y series en un único
`posterpilot.yml` como si compartieran el espacio TMDB. La migración lo normaliza:

1. **Vista previa.** PosterPilot compara el legado con la biblioteca Plex vinculada
   y su historial exacto de revisiones. Solo muestra estructura, huellas y
   recuentos, nunca URLs de imágenes ni credenciales. Las películas usan TMDB, con
   IMDb como alternativa; las series, TVDB, también con IMDb como alternativa.
2. **Ambigüedades.** Una clave numérica puede colisionar entre tipos, por lo que
   PosterPilot no adivina. Las entradas sin prueba se separan. Puedes corregir el
   match o aceptar explícitamente la ambigüedad, terminar y volver a aplicar esas
   imágenes en PosterPilot; la reaplicación escribe en el archivo tipado correcto.
   Tampoco se sobrescriben entradas tipadas existentes que estén en conflicto.
3. **Confirmación.** Primero se guardan un journal duradero y copias protegidas.
   PosterPilot escribe y verifica **ambos** archivos tipados y modifica `config.yml`
   al final. El `posterpilot.yml` heredado nunca se modifica ni elimina.
4. **Reintento y reanudación.** Tras una interrupción, reintentar continúa desde el
   punto verificado sin reclasificar. Si un archivo ya no coincide con la huella
   previsualizada ni con el resultado escrito, la operación se detiene para una
   nueva revisión en vez de sobrescribirlo.

Si PosterPilot puede demostrar que administra las entradas `metadata_files`,
actualiza `config.yml` automáticamente. En caso contrario escribe los archivos
tipados y muestra una guía exacta por biblioteca. **No pegues ese bloque parcial
`libraries:` sobre tu configuración.** En cada biblioteca indicada, sustituye solo
el elemento de `metadata_files` cuyo basename de `file` sea `posterpilot.yml`; si
no existe, añade una sola vez el elemento tipado mostrado. Conserva todos los
elementos hermanos y ajustes de la biblioteca, y termina con exactamente una
referencia tipada y ninguna referencia heredada activa. Verifica las rutas desde el runtime de Kometa antes de
confirmar la finalización en PosterPilot. Esa confirmación registra tu declaración;
no afirma que PosterPilot haya verificado la edición manual.

**Rollback** restaura la copia protegida de `config.yml` solo si la configuración
actual sigue siendo exactamente el resultado migrado. Conserva los archivos
tipados y el legado, por lo que no descarta las imágenes generadas y otro intento
no necesita reconstruirlas.

## Editor bruto

**Previsualizar cambios brutos** valida primero el YAML. Un error de análisis se
muestra inline y no genera plan. **Confirmar guardado bruto** es una acción separada
y escribe solo el texto vinculado. Cambiar texto o archivo exige nueva vista previa.

## Copias y restauración

Cada escritura confirmada reemplaza atómicamente y conserva la versión anterior como
`config.yml.posterpilot-bak-<timestamp>`. Para restaurar, previsualiza el diff y
confirma por separado. Si cambia el archivo actual o la copia, se rechaza. El archivo
actual también se copia antes del reemplazo.

:::caution[Secretos en texto plano]
Kometa necesita el token Plex y la clave TMDB en texto plano en `config.yml`, por lo
que también aparecen en las copias del disco. PosterPilot los oculta en UI y diff,
pero no puede cifrar el archivo que consume Kometa. Protege el volumen y permisos.
:::

Lee [Seguridad, verificación y deshacer](../safety/) y
[Automatización y recuperación](../automation-recovery/).
