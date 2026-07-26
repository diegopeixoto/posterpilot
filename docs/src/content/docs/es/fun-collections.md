---
title: Experimentos FUN y colecciones
description: Usa las herramientas opcionales de FUN y los espacios de consistencia de colecciones sin saltarte la revisión.
---

FUN y Colecciones reutilizan la biblioteca sincronizada. Ninguna área inventa
identidad ni aplica ilustración por encontrar un resultado o familia.

## Activar FUN

Define `FUN_ENABLED=true` o activa **FUN** en Ajustes. Desactivado, la navegación se
oculta y `/fun` responde no encontrado. Los filtros usan el servidor nombrado activo,
muestran el recuento elegible exacto y no amplían rangos inválidos.

## Selector de la noche

Devuelve hasta tres opciones distintas. Filtra por biblioteca, tipo, género, año,
visto, duración, puntuación, recencia o preset. La URL guarda semilla, filtros e IDs:
recargar, volver o compartir conserva el orden mientras los elementos existan.

Volver a sortear mantiene filtros y cambia la semilla. Se evita el historial reciente
cuando hay alternativas; en un conjunto pequeño solo se relaja esa exclusión. El modo
ciego oculta la identidad hasta revelar y las cápsulas muestran su regla antes.

![Selector de la noche de FUN en PosterPilot con filtros de biblioteca, tipo, género, año, duración y valoración antes de sortear un título](/posterpilot/screenshots/fun-picker.webp)

## Poster Match

Requiere un título con al menos dos pósteres. Elige entre dos imágenes por ronda hasta
que quede una en un cuadro finito. Una imagen rota se elimina cuando es posible. La
ganadora conserva su procedencia y solo queda **preparada**; aplícala con la vista
previa normal.

## Galería ambiental

Muestra pósteres, fondos o ambos a pantalla completa. Anterior/siguiente, pausa,
intervalo y salida funcionan también por teclado. Con movimiento reducido la
reproducción empieza pausada hasta que la actives. Las imágenes fallidas se omiten.

## Planificador de sesión

Elige dos o tres películas y un presupuesto de duración. Solo usa películas distintas
con duración conocida y respeta biblioteca, género, visto y puntuación. Nunca excede
el presupuesto; volver a planificar mantiene restricciones y cambia la semilla.

## Colecciones y franquicias

Las colecciones están aisladas por servidor y provienen de pertenencia nativa o
`belongs_to_collection` de TMDB. Nombres iguales en servidores distintos no se mezclan
y la similitud de título nunca crea miembros.

El detalle muestra procedencia, miembros TMDB ausentes como contexto, ilustración
actual/preparada, evidencia de proveedor/set/autor/idioma/familia y cobertura
explicable. Procedencia desconocida no significa incompatibilidad deliberada.

## Volver a buscar en toda la colección

El detalle de una colección incluye **Volver a buscar en los proveedores** (⟳):
repite el descubrimiento para cada miembro local en una pasada, evitando la caché
HTTP en las consultas a proveedores de cada miembro. Los miembros se procesan de
forma independiente — un fallo no detiene al resto — y el resultado se informa
como recuento («3 de 5 miembros actualizados.»).

Con ThePosterDB habilitado, la misma pasada busca además un **set de colección** de
ThePosterDB: localiza la colección por nombre, prueba hasta seis sets de
colaboradores, empareja sus pósteres con tus miembros locales (título exacto, luego
inclusión de palabras, luego año de estreno) y conserva el set con mayor cobertura.
Su ilustración se inyecta como un único diseño coordinado en los miembros
emparejados, listo para las sugerencias de familia. A diferencia de la pasada por
miembro, esta búsqueda de sets puede reutilizar páginas de la caché HTTP hasta
que expiren (`HTTP_CACHE_TTL_DAYS`). Volver a buscar solo almacena candidatas;
nada se aplica sin vista previa y confirmación.

![Detalle de una colección en PosterPilot con el control de volver a buscar, el recuento de miembros actualizados y sugerencias de familias coordinadas recién descubiertas](/posterpilot/screenshots/collection-discover.webp)

## Sugerencias coordinadas y excepciones

Las familias con evidencia verificable se ordenan por cobertura y puntuación. Cada
sugerencia identifica miembros y ranuras cubiertos/no cubiertos y solo prepara los
cubiertos. Puedes sustituir o limpiar cada ranura. Sin evidencia común, se ofrecen
candidatos individuales sin fingir un conjunto coordinado.

## Aplicar y deshacer colecciones

Preparar en una colección sigue siendo preparación de elementos. Una escritura
coordinada exige vista previa exacta de miembros, ranuras, destinos, selecciones,
estado y omisiones. Cambiar pertenencia o selección invalida el plan. Los resultados
son independientes por miembro y destino.

Deshacer el grupo exige su revisión y una nueva vista previa; las revisiones de cada
miembro también están en su historial. Si la interfaz no expone una acción coordinada
para una capacidad, abre el miembro y usa Revisión/aplicar/deshacer; preparar no escribe.

Lee [Seguridad, verificación y deshacer](../safety/) y [Uso](../usage/).
