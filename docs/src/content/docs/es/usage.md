---
title: Uso
description: Sincroniza, revisa, corrige coincidencias, prepara ilustración, confirma planes exactos, sigue trabajos y deshaz mediante revisiones.
---

Este es el flujo diario después de [instalar](../installation/) y
[configurar](../configuration/) PosterPilot.

## Setup y primera sincronización

El asistente `/setup` recorre idioma, servidor, TMDB, proveedores, bibliotecas y la
primera sincronización. Plex ofrece PIN/descubrimiento; Jellyfin/Emby aceptan
usuario/contraseña o clave. Cada paso avanza solo tras una respuesta válida. **Omitir**
sale del asistente; la sincronización se sigue hasta éxito terminal o muestra fallo y
reintento.

## Sincronizar y reanalizar

En el Panel, **Sincronizar** importa películas/series del servidor nombrado activo,
resuelve TMDB y actualiza metadatos. `INCLUDED_SECTIONS` o la lista de bibliotecas
limita el alcance. Los elementos sin GUID siguen visibles como no resueltos.

La sincronización es incremental por defecto. **Reanálisis completo** relee todo,
reconcilia eliminados y detecta ilustración cambiada externamente sin borrar
instantáneas/revisiones ni aplicar carátulas.

Los trabajos muestran cola, fase, progreso, intentos y resultado en vivo. Recargar no
los cancela; solicitudes equivalentes reutilizan el trabajo activo.

## Biblioteca a escala

Biblioteca busca y filtra en servidor por tipo, biblioteca, activo/ignorado, póster
ausente, candidatas generales o MediUX, cambio, puntuación y género. Ordena por título,
año, puntuación, duración, cambio reciente o fecha de alta. URL y vuelta conservan el
contexto.

Para lotes, usa **Seleccionar página** o **Seleccionar todos los resultados**, compara
cargados con total y limpia cuando proceda. Todos los resultados se materializan desde
el filtro exacto; cambiar la consulta invalida la selección.

## Bandeja de Review

**Review** agrupa estados accionables: nuevo, no resuelto, sin candidatas, sugerencia,
preparado, fallo parcial, cambio externo, ignorado y completado. Filtra, ordena y
guarda vistas. Anterior/siguiente/volver conservan el contexto al abrir un elemento.

Compara ilustración **actual**, **sugerida** y **preparada** por ranura. Aceptar una
sugerencia es explícito; abrir la página no persiste nada. Los atajos no se ejecutan
en campos editables ni modales.

**Aplicar y siguiente** usa la vista previa/confirmación normal, espera el trabajo y
solo avanza cuando todos los destinos seleccionados terminan y se verifican. Fallo,
omisión o resultado parcial permanece con detalle y reintento.

## Corregir coincidencia TMDB

Busca un elemento no resuelto o incorrecto por título, año y tipo. Los resultados
incluyen ID TMDB y metadatos para desambiguar. Confirmar fija la identidad, invalida
candidatas antiguas y registra auditoría. Reemplazar o borrar también es explícito;
borrar permite otra resolución automática por GUID.

Los fallos de proveedores están aislados. Candidatas conocidas pueden permanecer
marcadas obsoletas durante un fallo transitorio; una respuesta vacía exitosa posterior
las elimina.

## Descubrir y preparar ilustración

**Encontrar carátulas** consulta proveedores habilitados. Agrupa por proveedor/set,
con póster/fondo y, para series, temporadas y title cards. Prepara una pieza, el set
completo o mezcla ranuras. La mejor sugerencia se marca, pero solo se prepara al
aceptarla.

El constructor fijo resume póster, fondo, temporadas y episodios. Una URL personalizada
es una ranura normal. Una carga de archivo tiene vista previa/confirmación y solo puede
ir al servidor directo, pues un binario no es una URL YAML de Kometa.

## Previsualizar y aplicar

Elige método (inicia con `DEFAULT_APPLY_METHOD`):

- **Servidor directo (`plex`)** — captura estado anterior, escribe mediante Plex/
  Jellyfin/Emby activo, bloquea donde se admite y verifica.
- **Kometa** — actualiza `posterpilot.yml`, conserva contenido ajeno y verifica YAML.
- **Ambos** — destinos independientes; uno puede fallar sin ocultar el otro.

Primero genera la **vista previa exacta** de elementos, ranuras, candidatas, estado,
destinos y omisiones. La confirmación separada usa un plan con caducidad, un solo uso
y ligado a selecciones/huellas. Si algo cambia, no escribe y exige otra vista.

En lote congela todos los IDs y puede descubrir sin mutar para construir el plan;
la ejecución no redescubre ni sustituye. Una temporada/episodio sin destino se omite
y un fallo no aborta las demás ranuras.

### Cómo consume Kometa la exportación

`posterpilot.yml` usa IDs TMDB y `url_poster` / `url_background`, con temporadas y
episodios anidados. Inclúyelo en `metadata_files`; el
[Gestor de Kometa](../kometa-config-sync/) puede hacer la vinculación.

## Verificación, historial y deshacer

La cronología registra destino/ranura, procedencia, estado anterior, resultado y
verificación exacta o de mejor esfuerzo. Fallo o evidencia no disponible nunca es
éxito verificado.

Previsualiza deshacer para una revisión disponible, temporada o elemento. Confirmar
restaura solo la instantánea/valor congelado, verifica cuando puede y añade otra
revisión. Un deshacer parcial conserva restauraciones exitosas. Consulta
[Seguridad, verificación y deshacer](../safety/).

## Fallos y reintentos

Los detalles del trabajo muestran éxito, fallo, omisión e interrupción por destino y
errores saneados. **Reintentar fallos** crea trabajo solo para fallos reintentables y
no repite éxitos. Configuración o plan inválido exige corrección y nueva vista previa.

## FUN, colecciones y varios servidores

FUN contiene selector de hasta tres opciones, modos ciego/cápsula, Poster Match,
galería y sesiones por duración. Colecciones muestran miembros, procedencia,
consistencia, cobertura y overrides. No autoaplican. Consulta
[FUN y colecciones](../fun-collections/).

Con varios servidores usa el selector; biblioteca, trabajos, Review, colecciones y
automatizaciones permanecen aislados. Consulta
[Migración multiservidor](../multi-server-migration/).

El registro detallado está en **Ajustes → Actividad**. Diagnóstico, automatización,
copias y recuperación se explican en [Automatización y recuperación](../automation-recovery/).
