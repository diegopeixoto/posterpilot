---
title: Seguridad, verificación y deshacer
description: Comprende la vista previa exacta, las revisiones inmutables, la verificación, los fallos parciales y los límites seguros para deshacer.
---

PosterPilot trata toda escritura de ilustración o configuración como una operación
revisable. Las sugerencias, FUN, las familias de colecciones, los horarios y el
descubrimiento nunca escriben ilustraciones por sí solos.

## El contrato de escritura

Para el servidor multimedia, metadatos de Kometa, cargas, colecciones y `config.yml`:

1. **Prepara** la ilustración o la configuración.
2. **Previsualiza** destinos, ranuras, escrituras y omisiones exactas.
3. **Confirma** el plan emitido por el servidor. Caduca, es de un solo uso y está
   vinculado al contenido y a las huellas mostradas.
4. **Ejecuta** únicamente las operaciones congeladas, sin redescubrir ni sustituir.
5. **Verifica** cada destino después de escribir.
6. **Registra** una revisión por destino y ranura, también cuando falla.

Si cambian la selección, la ilustración actual, la pertenencia a la colección, el
archivo de Kometa o cualquier entrada vinculada, la confirmación se rechaza. Solicita
otra vista previa; no reutilices el token anterior.

![Detalle de un título en PosterPilot con la confirmación de aplicación que muestra el plan exacto y congelado: dos subidas, ninguna exportación a Kometa y nada omitido](/posterpilot/screenshots/apply-exact-plan.webp)

## Qué se captura

Antes de mutar, PosterPilot registra el estado anterior. Cuando el proveedor puede
leer los bytes, guarda una instantánea local direccionada por contenido en el
directorio de datos. Para Kometa conserva el valor YAML administrado anterior,
incluida su ausencia.

El historial solo añade entradas. Volver a aplicar o deshacer no borra intentos. Las
cargas usan una identidad de contenido segura y no exponen credenciales ni URL con
secretos.

:::caution
Si no fue posible leer la imagen original, la ranura se registra como no disponible.
PosterPilot no afirma que pueda restaurarla exactamente. Revisa la vista previa de
deshacer antes de confirmar.
:::

## Estados de verificación

- **Exacta** — se puede comparar el destino con el contenido o valor YAML previsto.
- **Mejor esfuerzo** — existe una identidad de imagen estable, pero no evidencia byte a byte.
- **Fallida o no disponible** — la escritura falla, el resultado difiere o no hay
  evidencia suficiente. Nunca se presenta como éxito verificado.

Servidor y Kometa tienen resultados independientes. “Ambos” puede ser parcial, y un
fallo de temporada o episodio no oculta éxitos en otras ranuras.

## Fallos parciales y reintentos

Los detalles del trabajo muestran éxitos, fallos, omisiones e interrupciones, con el
destino y la ranura afectados. **Reintentar fallos** crea trabajo vinculado solo para
unidades elegibles y no repite éxitos. Los errores de validación, configuración o plan
obsoleto exigen corregir Ajustes y crear una nueva vista previa.

“Aplicar y siguiente” avanza únicamente si todos los destinos seleccionados terminan
y se verifican. En caso contrario permanece en el elemento con los detalles.

## Deshacer desde la cronología

En el detalle del elemento, previsualiza el deshacer de una revisión disponible, una
temporada o el elemento completo. La vista enumera restauraciones posibles y ranuras
no disponibles o ya restauradas. Confirmar restaura la instantánea/valor, verifica
cuando es posible y añade una revisión de deshacer.

El alcance se respeta: una temporada no cambia la carátula de la serie ni otra
temporada; Kometa no reescribe YAML ajeno. Los resultados mixtos siguen auditables.

![Cronología del historial de arte de PosterPilot con una revisión aplicada y verificada, una entrada por destino y ranura, cada una con su propia acción de deshacer](/posterpilot/screenshots/item-artwork-history.webp)

## Seguridad de Kometa

La sincronización estructurada, el YAML bruto y la restauración de copias tienen
vista previa y confirmación propias. El diff oculta secretos. La escritura usa copia
y reemplazo atómico; planes alterados, caducados, obsoletos o reutilizados no escriben
nada. Consulta el [Gestor de Kometa](../kometa-config-sync/).

## Hábitos seguros

- Conserva `/data` e incluye `.app-key` si no usas `APP_SECRET`.
- Revisa las omisiones: una omisión no es éxito verificado.
- Ejecuta Diagnósticos antes de insistir con un servidor, proveedor o ruta enferma.
- Crea una copia antes de actualizar, purgar servidores o restaurar.
- Mantén la automatización orientada a revisión; ningún horario integrado autoaplica.

Continúa con [Uso](../usage/) o [Automatización y recuperación](../automation-recovery/).
