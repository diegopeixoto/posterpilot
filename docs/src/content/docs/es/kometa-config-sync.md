---
title: Gestor de Kometa
description: Administra config.yml con vista previa exacta, confirmación, diffs saneados, escritura atómica y restauración previsualizada.
---

Además de [exportar ilustración como metadatos](../usage/#cómo-consume-kometa-la-exportación),
PosterPilot puede administrar `config.yml` en **`/kometa`**. Es opcional: sin una
ruta configurada no lee ni escribe el archivo.

:::note[Dos archivos]
- **`posterpilot.yml`** contiene `url_poster` / `url_background` por TMDB y se escribe
  al aplicar al destino Kometa.
- **`config.yml`** contiene conexiones, bibliotecas, colecciones, overlays,
  operaciones y ajustes de Kometa.

Con `KOMETA_CONFIG_PATH`, `posterpilot.yml` se escribe junto a `config.yml` y se
referencia por su nombre. No existe otra ruta de metadatos.
:::

## Activar y montar

| Variable | Predeterminado | Función |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | vacío | Ruta montada absoluta a `config.yml`; vacío desactiva el gestor. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` conserva contenido no administrado; `own` regenera todo. |
| `KOMETA_SERVER_INSTANCE_ID` | servidor heredado | Instancia Plex nombrada vinculada a Kometa. |

Monta el directorio de configuración con lectura/escritura; consulta
[Instalación](../installation/). Kometa es exclusivo de Plex: Jellyfin/Emby o tomar
credenciales de otra instancia implícitamente se rechazan.

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
