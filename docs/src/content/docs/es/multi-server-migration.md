---
title: Administración y migración multiservidor
description: Actualiza una instalación de un servidor, administra instancias nombradas y comprende el aislamiento y la aplicación entre servidores.
---

PosterPilot administra varias instancias Plex, Jellyfin y Emby manteniendo bibliotecas,
elementos, trabajos, revisiones, colecciones, revisión y horarios separados.

## Antes de actualizar

1. Espera a que terminen los trabajos mutantes.
2. Copia todo `/data`: base/WAL, instantáneas, copias y `.app-key`. Si está disponible,
   crea y valida también una copia manual de la aplicación.
3. Anota tipo, URL y origen de la credencial; conserva `APP_SECRET` o `.app-key`.
4. Actualiza la imagen y reinicia normalmente. No crees una base vacía ni ejecutes SQL manual.

## Qué hace la migración

Crea una instancia protegida **Servidor predeterminado** y asigna los registros al
alcance estable `legacy-default`. Al iniciar, materializa la conexión heredada efectiva
— el entorno mantiene precedencia — y la activa.

Es transaccional e idempotente. IDs, candidatos, selecciones, ignorados, trabajos,
revisiones, historial y bibliotecas en caché permanecen; no hace falta resincronización
destructiva. Una instalación nueva sin configurar sigue al asistente sin servidor falso.

:::note
`SERVER_TYPE`, `PLEX_*`, `JELLYFIN_*` y `EMBY_*` describen la conexión protegida
predeterminada. Los servidores adicionales se crean en Ajustes y almacenan sus propias
credenciales; las variables no definen una lista de instancias.
:::

## Comprobaciones posteriores

1. En **Ajustes → Servidores**, confirma tipo, URL, credencial y estado activo.
2. Prueba la conexión y ejecuta **Diagnósticos**.
3. Comprueba Biblioteca, Revisión, Colecciones, Panel/trabajos y una cronología.
4. Confirma bibliotecas y la vinculación Plex de Kometa.
5. Ejecuta sincronización incremental; usa exploración completa solo para releer todo.

Si falla migración o descifrado, detén el nuevo contenedor y restaura el volumen o el
flujo validado de restauración. No operes sobre una copia parcial.

## Añadir y cambiar servidores

En **Ajustes → Servidores**, introduce nombre único, tipo, URL y credencial reutilizable,
prueba y añade. Plex usa token; Jellyfin/Emby usan clave o token. El navegador nunca
recibe el secreto guardado.

Con dos instancias habilitadas usa el selector o **Hacer activo**. Páginas, filtros y
vistas quedan en su alcance. Trabajos y horarios conservan el servidor; trabajo
independiente puede ejecutarse en paralelo. Las capacidades dependen de cada instancia.

## Vinculación de Kometa

Kometa es específico de Plex. Define `KOMETA_SERVER_INSTANCE_ID` o elige una instancia
Plex en Ajustes. La vista previa valida el vínculo; Jellyfin/Emby y tomar credenciales
de otro Plex implícitamente se rechazan.

## Aplicación entre servidores

Siempre es explícita y exige un identificador TMDB, IMDb o TVDB exacto; un título
parecido no basta. La vista previa enumera servidor/elemento, capacidad, ranura, estado,
selección y omisiones. Cada destino obtiene revisión y verificación propias.

Aplicar normalmente nunca propaga. Si la interfaz no muestra esta selección, la API
de vista previa/confirmación es para integraciones controladas; no cambies el servidor
activo entre ambos pasos.

## Deshabilitar, desconectar o purgar

- **Deshabilitar** bloquea mutaciones y conserva credencial, caché e historial.
- **Desconectar** elimina la credencial, desactiva horarios y conserva historial.
- **Purgar** aparece tras desconectar, muestra impacto exacto y pide otra confirmación;
  los trabajos mutantes activos lo bloquean.

El servidor migrado aparece como **Heredado** y está protegido frente a edición/purga
ordinaria. Haz copia antes de purgar y revisa elementos, trabajos, revisiones,
colecciones, horarios e instantáneas.

Consulta [Automatización y recuperación](../automation-recovery/) y
[Configuración](../configuration/).
