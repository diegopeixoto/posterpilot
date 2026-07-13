---
title: Automatización, diagnóstico, copias y recuperación
description: Opera trabajos duraderos y automatizaciones de revisión, diagnostica fallos y restaura PosterPilot con seguridad.
---

PosterPilot mantiene el trabajo rutinario duradero y orientado a revisión. La
sincronización, el descubrimiento, los reintentos y las aplicaciones confirmadas son
trabajos persistidos; los horarios no autoaplican ilustraciones.

## Trabajos duraderos

El Panel muestra trabajos en cola, en ejecución, reprogramados y terminales con
progreso en vivo. Recargar o navegar no los cancela. Una solicitud equivalente
reutiliza el trabajo activo; mutaciones solapadas se bloquean con la referencia del
conflicto.

Cada trabajo conserva servidor/biblioteca, entradas inmutables, intentos, resumen y
fallos saneados. Tras reiniciar, el trabajo seguro se recupera. Una mutación de
ilustración interrumpida queda para revisión en lugar de repetirse a ciegas.

**Cancelar** solicita la interrupción sin borrar lo ya confirmado. En un fallo parcial,
**Reintentar fallos** crea trabajo solo para unidades elegibles. Validación, credenciales
o planes obsoletos requieren corrección y nueva vista previa.

## Automatizaciones de revisión

En **Ajustes → Automatización**, crea una automatización para el servidor activo:

- una o más bibliotecas;
- intervalo, hora diaria o evento (`elementos nuevos` o `sincronización completada`);
- zona horaria IANA;
- **Sincronizar** o **Sincronizar y descubrir**;
- una vista de revisión opcional;
- ventana de recuperación y umbral de fallos consecutivos.

La acción predeterminada es `sync_discover`. Cada ocurrencia congela sus entradas y
crea o reutiliza un trabajo. Editar solo afecta ocurrencias futuras. Al volver dentro
de la ventana de recuperación se crea una sola ocurrencia perdida; las entregas
duplicadas se agrupan.

:::important
Las automatizaciones solo sincronizan y, opcionalmente, descubren candidatos para
Revisión. No crean trabajos de aplicación.
:::

### Webhook

Genera la credencial en la automatización. El endpoint y el token se muestran una
vez. Envía el token en `X-PosterPilot-Webhook-Token`. Rotarlo invalida el anterior;
desactivarlo lo elimina. No lo incluyas en URL ni registros.

![Ajustes de Automatización de PosterPilot con dos programaciones de solo revisión y el historial de ejecuciones anteriores](/posterpilot/screenshots/settings-automation.webp)

## Diagnosticar antes de reintentar

**Ajustes → Diagnósticos** ejecuta pruebas independientes y no mutantes para
servidores, TMDB, proveedores, rutas de Kometa, datos y copias. Distingue
indisponibilidad, credenciales ausentes/rechazadas, timeout y permisos de ruta;
también muestra capacidades de ilustración por instancia.

El último estado sobrevive al reinicio. Durante una caída pueden conservarse
candidatos conocidos marcados como obsoletos; una respuesta vacía exitosa posterior
los elimina.

El paquete de soporte saneado solo se exporta por acción explícita. Los títulos se
excluyen por defecto y una entrada cuya seguridad no se pueda demostrar se omite y
queda indicada en el manifiesto.

## Copias de la aplicación

En **Ajustes → Copias y restauración**, crea una copia. PosterPilot genera una
instantánea consistente de SQLite y un paquete bajo el directorio de datos con
checksums, versiones, modo de clave y referencias a rutas externas. No copia el
servidor multimedia ni el contenido externo de Kometa.

Con `.app-key`, la clave generada se incluye. Con `APP_SECRET`, el secreto nunca se
incluye y la restauración exige el mismo valor efectivo.

Puedes validar, exportar o eliminar. Exportar requiere aceptar una advertencia porque
el paquete puede contener credenciales. La retención por cantidad/edad solo elimina
paquetes válidos no protegidos; las copias manuales y de seguridad están protegidas.

![Ajustes de Copia de seguridad y restauración de PosterPilot con límites de retención y una copia verificada y protegida que ofrece verificar, exportar y previsualizar la restauración](/posterpilot/screenshots/settings-backup.webp)

## Restaurar

1. Selecciona **Previsualizar restauración**.
2. Revisa checksums, integridad SQLite, esquema/migraciones, espacio, clave y avisos.
3. Confirma el alcance del plan sin cambios.
4. PosterPilot entra en mantenimiento, bloquea mutaciones, drena trabajos y crea una
   copia de seguridad protegida.
5. Reinicia el contenedor; el reemplazo ocurre antes de abrir libsql.
6. Revisa el informe. Si falla reemplazo o migración, se revierte a la copia de seguridad.

La indisponibilidad externa puede ser advertencia; checksum, base de datos, esquema
más nuevo, ruta o clave incompatible bloquean.

:::caution
No sustituyas SQLite en vivo manualmente. Conserva la copia de seguridad hasta
validar bibliotecas, credenciales, Kometa, horarios y alcances.
:::

Consulta [Seguridad, verificación y deshacer](../safety/) y
[Migración multiservidor](../multi-server-migration/).
