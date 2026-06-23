---
title: Uso
description: Sincroniza una biblioteca, encuentra carátulas, aplícalas mediante la API del servidor multimedia o la exportación de Kometa, crea conjuntos personalizados y usa los filtros y la ordenación de la biblioteca.
---

Esta página recorre el flujo de trabajo cotidiano una vez que PosterPilot está
[instalado](/posterpilot/es/installation/) y
[configurado](/posterpilot/es/configuration/).

## Sincronizar una biblioteca

Una sincronización extrae tus bibliotecas de películas y series del servidor
multimedia activo hacia la caché local de PosterPilot y resuelve cada título a un
id de TMDB para que los proveedores de carátulas puedan consultarse.

1. Asegúrate de que las credenciales del tipo de servidor activo y una clave de
   TMDB están configuradas. Una sincronización se bloquea (con un mensaje claro
   sobre qué falta) si no lo están.
2. Opcionalmente, acota qué secciones se sincronizan con `INCLUDED_SECTIONS` (o el
   campo equivalente de Ajustes); déjalo vacío para sincronizar todas las secciones
   de películas y series.
3. Ejecuta la sincronización. Se ejecuta como una tarea en segundo plano con
   progreso en vivo.

Cada elemento vuelve con su título, año, tipo, GUID externos (tmdb/imdb/tvdb cuando
están presentes) y póster actual. Un elemento sin GUID externo sigue apareciendo en
la lista, pero se marca como irresoluble para la búsqueda en proveedores en lugar
de descartarse.

## El muro de la biblioteca

La biblioteca sincronizada se muestra como una cuadrícula de pósters. Puedes:

- **Buscar** por título.
- **Filtrar** por tipo de medio (película / serie), póster faltante,
  disponibilidad en MediUX (tiene candidatas), estado de cambio (sin cambios / aún
  con el póster predeterminado), valoración mínima y género.
- **Ordenar** por título, año de estreno, valoración, duración o más recientemente
  cambiados.
- Ver un **banner destacado** — un fondo de un elemento cambiado recientemente
  sobre el muro una vez que se ha aplicado al menos una carátula.

Cada tarjeta muestra la valoración del elemento y una insignia de estado (p. ej.
disponible en MediUX, cambiado), con el título y el año revelados al pasar el
cursor.

## Encontrar carátulas

Abre un elemento para ver su vista de detalle: un héroe de fondo con el logo del
elemento (o su título cuando no existe logo), la valoración, el año, la duración (o
los recuentos de temporadas/episodios para las series), los géneros y la sinopsis.

- Si aún no se han descubierto carátulas, usa **Encontrar carátulas** para ejecutar
  el descubrimiento de ese elemento.
- El descubrimiento despliega la búsqueda entre todos los proveedores habilitados y
  almacena la unión de sus candidatas, cada una etiquetada con su proveedor.
- Las candidatas se agrupan **primero por proveedor y luego por conjunto**. Cada
  conjunto muestra su atribución de autor con el póster y el fondo juntos. Para las
  series, la vista también presenta conjuntos de pósters de temporada y de tarjetas
  de título.

Puedes preparar un conjunto entero ("usar este conjunto") o tomar un póster
individual de un conjunto y un fondo de otro; las dos ranuras son independientes.

## Aplicar una carátula

Aplica una selección preparada con el método que elijas, seleccionable por acción
de aplicación con un valor predeterminado configurable (`DEFAULT_APPLY_METHOD`, por
defecto `both`):

- **Servidor multimedia (directo).** Sube el póster (y el fondo) a través del
  proveedor de servidor multimedia activo y bloquea el campo para que los agentes
  automáticos del servidor no lo sobrescriban. El cambio es prácticamente
  instantáneo. Se registra como una aplicación de servidor con el tipo del
  proveedor.
- **Exportación de Kometa.** Escribe YAML compatible con Kometa/PMM —`url_poster`
  (y `url_background` cuando hay un fondo preparado), indexado por id de TMDB— en
  el directorio de assets de Kometa configurado, sin contactar con el servidor
  multimedia. Tu instancia de Kometa existente aplica las carátulas en su próxima
  ejecución. Volver a aplicar actualiza la entrada en su sitio en lugar de
  duplicarla.
- **Ambos.** Realiza la subida directa _y_ escribe el YAML de Kometa, registrando
  cada resultado de forma independiente para que un fallo parcial sea visible.

Cada aplicación —con éxito o con fallo— se registra con el elemento, la URL del
asset, los métodos, el resultado y la marca de tiempo, de modo que el historial sea
consultable y la reaplicación detectable.

### Cómo consume Kometa la exportación

PosterPilot escribe un único archivo de metadatos (por defecto `posterpilot.yml`)
en `KOMETA_ASSETS_DIR`, indexado por id de TMDB con entradas `url_poster` /
`url_background`. Añade ese archivo a la configuración de tu biblioteca de Kometa
(p. ej. bajo `metadata_path` / `metadata_files`) para que Kometa aplique las
carátulas en su próxima ejecución.

## Conjuntos personalizados

La vista de detalle del elemento tiene un **constructor** persistente y fijo con
una ranura de póster y una ranura de fondo que juntas forman un "conjunto"
personalizado:

- Al hacer clic en una candidata de póster, esta se dirige a la ranura de póster;
  al hacer clic en una candidata de fondo, esta se dirige a la ranura de fondo,
  automáticamente, según el tipo.
- Cada ranura también puede rellenarse desde una **URL de imagen pegada** o un
  **archivo de imagen subido**.
- Aplicar el constructor aplica ambas piezas preparadas en una sola acción mediante
  el método que elijas.

:::note[Las subidas son solo para el servidor]
Una carátula personalizada basada en URL puede aplicarse tanto mediante el servidor
multimedia como mediante Kometa. Un **archivo subido** solo puede aplicarse
mediante el servidor multimedia: una subida binaria no puede expresarse como una
URL de YAML de Kometa, así que se omite de la exportación de Kometa y la limitación
se hace visible en lugar de escribir una entrada inválida.
:::

## Acciones en lote

Selecciona varios elementos y ejecuta el descubrimiento o la aplicación sobre la
selección como una única tarea en segundo plano. La aplicación en lote con
selección automática descubre (si es necesario), autoselecciona y aplica carátulas
para cada elemento seleccionado, con progreso en vivo.

La selección automática funciona sobre las candidatas de todos los proveedores
habilitados: elige un póster principal (y un fondo donde esté disponible) usando un
orden de preferencia de proveedor determinista, recurriendo al siguiente proveedor
cuando el más preferido no tiene póster para el elemento.

## Vista de tareas

La vista de tareas lista las tareas activas y pasadas, con progreso en vivo para
las tareas en ejecución (actualizándose mediante Server-Sent Events sin
actualización manual) y el estado final para las completadas.
</content>
