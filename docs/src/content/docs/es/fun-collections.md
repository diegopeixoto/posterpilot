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
