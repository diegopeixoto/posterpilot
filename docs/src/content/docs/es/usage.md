---
title: Uso
description: Sincroniza, revisa, repara coincidencias TMDB, prepara ilustración, confirma planes exactos, lee la cobertura de ilustraciones, sigue trabajos y deshaz mediante revisiones.
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

La sincronización es incremental por defecto, con una excepción deliberada: un
elemento cuya identidad TMDB guardada contradice el tipo película/serie que le da el
propio servidor multimedia se reprocesa siempre, así que una discrepancia antigua no
sobrevive indefinidamente a las sincronizaciones incrementales (ver
[Corregir coincidencia TMDB](#corregir-coincidencia-tmdb)). **Análisis completo**
relee todo, reconcilia eliminados y detecta ilustración cambiada externamente sin
borrar instantáneas/revisiones ni aplicar carátulas.

Los trabajos muestran cola, fase, progreso, intentos y resultado en vivo. Recargar no
los cancela; solicitudes equivalentes reutilizan el trabajo activo.

## Biblioteca a escala

Biblioteca busca y filtra en servidor por tipo, biblioteca, activo/ignorado, póster
ausente, candidatas generales o MediUX, cambio, puntuación y género. Ordena por título,
año, puntuación, duración, cambio reciente o fecha de alta. URL y vuelta conservan el
contexto.

Un control aparte, **Cobertura de ilustraciones**, filtra por _Aplicado en este
servidor_, _Exportado a Kometa_, _Necesita ilustración_ o _Cobertura desconocida_.
Review ofrece el mismo control con el mismo significado, así que un enlace es
trasladable entre ambas vistas. Lee [Cobertura de ilustraciones](#cobertura-de-ilustraciones)
antes de fiarte de él: son afirmaciones sobre lo que hizo PosterPilot, no sobre si un
título tiene póster.

Para lotes, usa **Seleccionar página** o **Seleccionar todos los resultados**, compara
cargados con total y limpia cuando proceda. Todos los resultados se materializan desde
el filtro exacto; cambiar la consulta invalida la selección.

## Bandeja de Review

**Review** agrupa estados accionables: nuevo, no resuelto, sin candidatas, sugerencia,
preparado, fallo parcial, cambio externo, ignorado y completado. Filtra, ordena y
guarda vistas. Anterior/siguiente/volver conservan el contexto al abrir un elemento.
Junto al filtro de estado está el de **Cobertura de ilustraciones**, que responde a
otra pregunta: el _estado_ dice dónde estás en tu flujo de trabajo; la _cobertura_,
qué ocurrió realmente en un destino.

Compara ilustración **actual**, **sugerida** y **preparada** por ranura. Aceptar una
sugerencia es explícito; abrir la página no persiste nada. Los atajos no se ejecutan
en campos editables ni modales.

**Aplicar y siguiente** usa la vista previa/confirmación normal, espera el trabajo y
solo avanza cuando todos los destinos seleccionados terminan y se verifican. Fallo,
omisión o resultado parcial permanece con detalle y reintento.

## Corregir coincidencia TMDB

De la identidad TMDB resuelta cuelga todo lo demás: qué ilustración se busca siquiera,
qué entrada de Kometa se escribe y cómo se reconocen como el mismo título dos copias.

**La resolución automática no se sale de su espacio de nombres.** TMDB numera
películas y series por separado: la película `105` y la serie `105` son títulos sin
relación. El servidor multimedia ya sabe cuál de los dos es cada elemento, así que
PosterPilot lo toma como autoritativo y resuelve solo dentro de ese espacio. Los GUID
se prueban en un orden fijo —TMDB directo, luego IMDb, luego TVDB—; un ID TMDB directo
se valida releyéndolo desde el endpoint esperado (una serie como serie, una película
como película), y un ID IMDb o TVDB pasa por `find` aceptando únicamente el bloque de
resultados del tipo correcto: un acierto en el otro bloque se descarta en vez de
tomarse prestado. Así, una biblioteca de series ya no puede resolverse a películas. Un
«no está en este espacio de nombres» deja el elemento **no resuelto**, que no es lo
mismo que un fallo de red o de credenciales: ese lo deja no resuelto _y_ sin
sincronizar, de modo que la siguiente sincronización lo reintenta en lugar de aceptar
una respuesta equivocada.

**El aviso de normalización.** Las versiones anteriores a esa protección pudieron
guardar identidades TMDB del tipo equivocado, y arreglar el resolvedor no arregla
retroactivamente las filas ya escritas. Tras actualizar, PosterPilot las cuenta y lo
dice en un aviso sobre todas las páginas —_«Hay … coincidencias antiguas de TMDB que
deben normalizarse.»_— con la acción **Normalizar coincidencias** y una nota de que la
reparación corrige las identidades de películas y series sin análisis completo ni
aplicar ilustraciones. El recuento es estrecho a propósito: solo elementos del
servidor activo cuyo tipo de medio TMDB guardado contradice el tipo que les asigna el
propio servidor; **no** los fijados a mano (fijar es tu afirmación sobre la identidad y
manda sobre cualquier reparación automática) y **no** las copias que ya salieron de su
biblioteca. El número se recuenta desde la base de datos cada vez que se muestra, así
que restaurar una copia o editar filas a mano no exige reparar ninguna marca aparte, y
el aviso desaparece solo en cuanto no queda nada pendiente.

**Normalizar coincidencias** encola una reparación limitada exactamente a esos
elementos: los vuelve a resolver en el espacio de nombres correcto y reenriquece sus
metadatos, y nada más —no aplica ilustración, no toca las selecciones preparadas y no
recorre el resto de la biblioteca—. Mientras corre, el aviso muestra el progreso y
enlaza al trabajo en el Panel; si termina fallido, parcial, cancelado o interrumpido,
el control pasa a **Reintentar normalización**. Solo puede correr una reparación por
servidor a la vez: lanzar una segunda nombra el trabajo que ya tiene ese alcance.

**Por qué el análisis completo es el respaldo y no la reparación.** **Análisis
completo** relee la biblioteca entera del servidor: reconcilia, vuelve a resolver,
reenriquece y reobserva la ilustración actual (lo cambiado en el servidor se marca
para revisión), conserva originales e historial y nunca aplica carátulas por su
cuenta. Es la herramienta correcta cuando sospechas que la caché local ha derivado en
conjunto —tras restaurar una copia, o tras ediciones masivas hechas directamente en el
servidor— y la incorrecta para identidades mal emparejadas, por dos razones: primera,
PosterPilot ya sabe nombrar los elementos afectados, así que un análisis completo paga
una pasada entera por la biblioteca y una ronda completa de peticiones al servidor y a
TMDB para llegar al mismo resultado; segunda, esperar también funciona, porque una
discrepancia de tipo pendiente queda exenta del salto incremental y una sincronización
normal reprocesa esos elementos en cuanto llega a ellos. La reparación sirve para
arreglarlos _ahora_, no es la única forma de que se arreglen algún día.

**Fijar a mano.** Busca un elemento no resuelto o incorrecto por título, año y tipo;
los resultados incluyen el ID TMDB y metadatos para desambiguar. Confirmar relee esa
identidad exacta desde TMDB justo antes de escribir nada, así que una candidata que
desapareció entre la búsqueda y la confirmación se rechaza en vez de fijarse, y un TMDB
inalcanzable deja intacta tu coincidencia actual. Confirmar fija la identidad,
invalida las candidatas descubiertas bajo la anterior y registra auditoría: **no se
aplica ninguna ilustración**, vuelve a usar **Buscar carátulas** para descubrir la de
la nueva identidad. Una fijación manda: las sincronizaciones no la sobrescriben y la
pasada de normalización la salta. Reemplazarla o borrarla es igual de explícito; borrar
reintenta de inmediato la resolución automática desde los IMDb/TVDB propios del
elemento —la columna del ID TMDB era de la fijación, así que solo esos identificadores
independientes se pueden reutilizar sin riesgo— e informa de qué ocurrió: se restauró
una coincidencia automática, no se encontró ninguna, o la resolución no pudo
ejecutarse. Un elemento sin ninguno de los dos simplemente vuelve a ser elegible, y una
sincronización posterior puede aportar un GUID TMDB nuevo. Cada transición (fijada,
reemplazada, borrada, resuelta, no resuelta) queda en la auditoría de coincidencias del
elemento.

Los fallos de proveedores están aislados. Candidatas conocidas pueden permanecer
marcadas obsoletas durante un fallo transitorio; una respuesta vacía exitosa posterior
las elimina.

## Descubrir y preparar ilustración

**Encontrar carátulas** consulta proveedores habilitados. Agrupa por proveedor/set,
con póster/fondo y, para series, temporadas y title cards. Prepara una pieza, el set
completo o mezcla ranuras. La mejor sugerencia se marca, pero solo se prepara al
aceptarla.

Cada grupo de proveedor tiene su propio control **⟳ Volver a buscar** que repite el
descubrimiento solo para ese proveedor, evitando la caché HTTP y reemplazando sus
candidatas almacenadas sin tocar las de los demás. El grupo de ThePosterDB aparece
expandido por defecto.

**Las tarjetas de proveedor salen en el orden que hayas configurado** en Ajustes →
Metadatos y proveedores, no en el orden en que acabó el descubrimiento, que solo
registra quién respondió primero. Ese orden es presentación más un desempate entre
candidatas con puntuación _exactamente_ igual; nunca revierte una puntuación desigual,
así que una imagen más nítida de un proveedor que pusiste el último se lleva igualmente
la sugerencia. Ver
[Configuración → Orden de proveedores](../configuration/#orden-de-proveedores).

**Mostrar más sin cargarlo todo.** Un taquillazo puede arrastrar cientos de carátulas,
así que cada cuadrícula abre con **24 miniaturas** y un control **cargar más** revela
otras 24 (o lo que quede) e indica cuántas seguirían ocultas. 24 divide exacto en todas
las cuadrículas de la página —dos columnas para fondos, cuatro para title cards, ocho
para pósteres de temporada—, así que ninguna revelación deja media fila coja, y la línea
junto al control siempre dice cuántas se muestran, de cuántas y cuántas quedan ocultas.
Cada cuadrícula se despliega **por separado**: revelar más pósteres no revela fondos,
dos sets del mismo proveedor se expanden aparte y cada temporada lleva su propio recuento.
Revelar más no cuesta red —el inventario conservado ya viaja en la página—, pero tampoco
alcanza más allá de lo que PosterPilot **conservó**: la ingesta aplica un tope defensivo
de 200 candidatas por tipo de ilustración y, al llegar a él, la cuadrícula lo dice
—_«… devolvió más carátulas de las que PosterPilot conserva; esta cuadrícula no es la
lista completa.»_— en vez de dar a entender que ves todo lo que existe. Ver
[Configuración → Inventario de candidatos](../configuration/).

**Ampliar una candidata.** Cada miniatura lleva su propio control **⤢ ampliar** bajo la
imagen, separado del que la prepara: ampliar es mirar, nunca elegir —no prepara nada, no
persiste nada y no cambia ninguna ranura—. El diálogo muestra el **archivo canónico**,
el mismo que se subiría al servidor o se escribiría en el YAML de Kometa, completo y sin
recortar, con la procedencia que una imagen suelta no puede dar: proveedor, dimensiones
en píxeles e idioma cuando el proveedor lo declara (MediUX y ThePosterDB nunca etiquetan
idioma, así que no llevan línea de idioma en absoluto, porque «sin etiqueta de idioma»
describiría la fuente y no la ilustración). **← / →** o las flechas recorren la
secuencia y **Esc** o la ✕ cierran y devuelven el foco a la miniatura de origen; la
posición se anuncia al cambiar y los controles **paran en los extremos** en vez de dar la
vuelta. La secuencia es exactamente lo que hay en pantalla —mismo orden de proveedores,
mismos sets expandidos, mismo filtro de idioma, mismas miniaturas reveladas—, así que
Siguiente nunca alcanza ilustración que la propia página oculta. Si la cuadrícula cambia
bajo un diálogo abierto, este sigue a la ilustración que mirabas y solo se cierra si no
queda nada; una imagen que no carga a tamaño completo lo dice en vez de mostrar la
anterior bajo el pie de la nueva.

**Qué se descarga al navegar.** Cada candidata tiene un archivo **canónico** —el que se
aplicaría de verdad— y algunos proveedores publican además una versión reducida. Las
cuadrículas piden la versión optimizada donde la haya (TMDB da un póster `w500` y un
fondo `w1280` en vez del original) y la sirven por la caché de miniaturas propia de
PosterPilot, así que esos bytes se piden una vez al proveedor y se reutilizan entre
cargas, elementos y usuarios de la instancia; MediUX, Fanart.tv y ThePosterDB no publican
vista previa aparte, así que sus miniaturas usan la URL canónica, también por esa caché.
La **vista ampliada** y la **aplicación** usan el canónico traído directamente del
proveedor, y la vista ampliada evita la caché a propósito: esa caché existe para imágenes
de tamaño cuadrícula, y llenarla de originales expulsaría las miniaturas a las que sirve.
La imagen ampliada solo existe mientras el diálogo está abierto, así que una cuadrícula
de cien miniaturas de TMDB descarga cien miniaturas y cero originales hasta que pidas uno.

**Idioma de las carátulas.** Con un idioma de ilustraciones de TMDB configurado, la
página filtra las cuadrículas a ese idioma y lo dice encima —nombrando el idioma y
cuántas carátulas oculta en otros—, con un conmutador **Mostrar todos los idiomas** local
a la página que nunca toca tu preferencia guardada. Si nada coincide para ese título, la
página dice cuántas carátulas existen en otros idiomas y ofrece la misma salida en lugar
de una cuadrícula vacía. La preferencia rige **solo la ilustración de TMDB**; el
razonamiento está en
[Configuración → Idioma de las ilustraciones de TMDB](../configuration/#idioma-de-las-ilustraciones-de-tmdb).

El constructor fijo resume póster, fondo, temporadas y episodios. Una URL personalizada
es una ranura normal. Una carga de archivo tiene vista previa/confirmación y solo puede
ir al servidor directo, pues un binario no es una URL YAML de Kometa. Las URL
personalizadas las descarga el propio PosterPilot para verificar los bytes exactos, así
que deben ser alcanzables desde su contenedor (no basta con que el servidor multimedia
las vea); las escrituras no verificables no están soportadas a propósito.

## Previsualizar y aplicar

Elige método (inicia con `DEFAULT_APPLY_METHOD`):

- **Servidor directo (`plex`)** — captura estado anterior, escribe mediante Plex/
  Jellyfin/Emby activo, bloquea donde se admite y verifica.
- **Kometa** — actualiza `posterpilot-movies.yml` o `posterpilot-shows.yml`, conserva
  contenido ajeno y verifica YAML.
- **Ambos** — destinos independientes; uno puede fallar sin ocultar el otro.

Primero genera la **vista previa exacta** de elementos, ranuras, candidatas, estado,
destinos y omisiones. La confirmación separada usa un plan con caducidad, un solo uso
y ligado a selecciones/huellas. Si algo cambia, no escribe y exige otra vista.
Un plan sin advertencias — sin omisiones y con al menos una escritura — se aplica en
un solo clic: PosterPilot emite la confirmación en la misma acción. Cualquier omisión
recupera la confirmación explícita, y **Aplicar y siguiente** siempre conserva su
diálogo.

En lote congela todos los IDs y puede descubrir sin mutar para construir el plan;
la ejecución no redescubre ni sustituye. Una temporada/episodio sin destino se omite
y un fallo no aborta las demás ranuras.

### Cómo consume Kometa la exportación

`posterpilot-movies.yml` usa IDs TMDB y recurre a IMDb cuando no hay un ID TMDB.
`posterpilot-shows.yml` usa IDs TVDB y recurre a IMDb cuando no hay un ID TVDB;
además, anida temporadas y episodios. Incluye el archivo que
corresponda en `metadata_files`; el [Gestor de Kometa](../kometa-config-sync/)
puede vincularlo y explica la diferencia entre la ruta física y la referencia
visible para el runtime de Kometa.

## Cobertura de ilustraciones

La cronología responde a _qué hizo PosterPilot_. La cobertura responde a otra cosa —_qué
es cierto ahora mismo_— y ambas pueden discrepar, que es justo por lo que están
separadas. Cada página de elemento lleva un panel **Cobertura de ilustraciones** bajo la
cabecera, y tanto Biblioteca como Review se pueden filtrar por él.

**Dos destinos, nunca fusionados.** La cobertura se informa siempre **por destino**, en
dos paneles contiguos: **Servidor multimedia** para la ilustración que PosterPilot subió
a Plex, Jellyfin o Emby, y **Metadatos de Kometa** para las entradas que PosterPilot
escribió en sus archivos YAML. Los paneles nunca se pliegan en un veredicto único y sus
recuentos nunca se suman.

:::caution[Exportar a Kometa no es aplicar ilustración]
Una exportación es una línea en un archivo YAML en disco. Escribir esa línea demuestra
que el archivo se escribió. No demuestra que Kometa llegara a ejecutarse, ni que leyera
el archivo, ni que tu servidor multimedia aceptara el resultado, ni que la URL siga
resolviendo. PosterPilot lo dice en el panel —_«Exportado a un archivo de Kometa.
PosterPilot no puede confirmar que Kometa lo haya aplicado.»_— y nunca asciende una
exportación a afirmación sobre el servidor. Si aplicas solo con el método Kometa, el
panel Servidor multimedia seguirá diciendo que allí no se aplicó nada, y eso es un
enunciado correcto, no un fallo.
:::

La misma regla rige las copias de un título. Una película que existe en dos servidores, o
dos veces en uno porque está en `Películas` y en `Películas 4K`, son varias copias con
evidencia independiente: un póster aplicado a una no demuestra nada de la otra. Con más
de una copia, la cabecera informa del recuento **por destino** («1 de 2 copias
cubiertas») y nunca de una cifra combinada: una copia aplicada a un servidor más otra
copia exportada a Kometa no son «2 de 2». Cada ranura dentro de un panel —póster, fondo,
cada temporada, cada episodio— conserva además su propio estado.

| Estado                            | Significado                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aplicado en este servidor**     | Lo escribimos y la huella que esperábamos sigue coincidiendo con lo que sirve el servidor ahora mismo. Es el único estado que es prueba positiva y verificada. |
| **Exportado a Kometa**            | El archivo de metadatos actual lleva la URL de esta ranura. Un archivo en disco: ver el aviso de arriba.                                                       |
| **Aplicado, sin verificar**       | Lo escribimos y no se pudo comprobar el estado actual del servidor. Hay historial; prueba no.                                                                  |
| **Cambiado fuera de PosterPilot** | Lo escribimos y desde entonces algo lo ha sustituido. Es un estado propio, no un sinónimo de ningún otro.                                                      |
| **No aplicado por PosterPilot**   | Una observación fiable no encontró indicio alguno de que hayamos puesto ilustración aquí.                                                                      |
| **Cobertura desconocida**         | No pudimos observar de forma fiable: un archivo de Kometa ilegible, un servidor inalcanzable, historial incompleto.                                            |

Tres de esas formulaciones cargan con todo el sentido y leerlas a la ligera te
despistará:

**«No aplicado por PosterPilot» no es «no tiene ilustración».** Es un enunciado sobre lo
que hicimos _nosotros_, nunca sobre lo que guarda tu servidor. Un título al que le
pusiste el póster a mano en Plex hace años sale aquí como no aplicado por PosterPilot —y
tiene un póster perfectamente bueno—. A propósito no existe ningún estado de cobertura ni
valor de filtro que afirme que un título carece de ilustración, porque PosterPilot no
puede saberlo.

**«Cambiado fuera de PosterPilot» es una respuesta en sí misma.** Algo sustituyó nuestra
ilustración: el propio agente de Plex, otra herramienta, una persona. Leerlo como
«falta» y volver a aplicar es no enterarte nunca de qué está sobrescribiendo tu
biblioteca.

**Una lectura fallida es «desconocida», nunca «no aplicado».** «No pudimos comprobarlo» y
«lo comprobamos y no está» son hechos distintos, y confundirlos es como una biblioteca
enteramente cubierta acaba reportada como vacía y te invita a reexportarlo todo. Por eso
un archivo de Kometa ilegible, un directorio que PosterPilot no logra resolver o un
historial que no pudo leer entero dan _desconocida_; un archivo ausente, que sí es una
observación fiable, no.

**Filtrar por cobertura.** Biblioteca y Review comparten un único control: _Aplicado en
este servidor_ (al menos una ranura verificada en el servidor activo), _Exportado a
Kometa_ (al menos una ranura en el archivo de metadatos actual), _Necesita ilustración_
(sin cobertura en _ninguno_ de los dos destinos —también coinciden los títulos que
PosterPilot nunca tocó, y el nombre se refiere a que no pusimos nada nosotros, no a que
al título le falte póster—) y _Cobertura desconocida_ (al menos una ranura con evidencia
indeterminada: _Cobertura desconocida_ en cualquiera de los destinos, o _Aplicado, sin
verificar_ en el servidor). Fíjate en el «al menos una ranura»: una serie con póster
aplicado y sin title cards coincide con _Aplicado en este servidor_. El filtro encuentra
títulos que merece la pena abrir; la verdad por ranura vive en el panel del elemento. La
cobertura está acotada al servidor al que pertenece la copia, así que cambiar de servidor
activo cambia las respuestas. Cuando un filtro no coincide con nada, el estado vacío lo
dice y ofrece volver a _Cualquier cobertura_ en un clic.

**Cómo se mantiene al día.** La cobertura es una proyección reconstruida a partir de tres
fuentes que no le pertenecen: el registro de revisiones de solo añadido, la observación
actual del servidor ranura a ranura y los archivos de Kometa en disco. Se rederiva tras
aplicar, deshacer, sincronizar y migrar o escribir configuración de Kometa y, como nada
avisa a PosterPilot cuando alguien cambia el póster de un título directamente en Plex,
una página de elemento con evidencia de más de **15 minutos** reobserva el servidor al
abrirla. De ahí dos consecuencias intencionadas: un refresco **nunca hace fracasar lo que
lo disparó** —una aplicación que tuvo éxito y luego no pudo actualizar la proyección
sigue siendo una aplicación con éxito, y el coste es una obsolescencia que el siguiente
disparo repara—, y reconciliar cobertura **no cambia nada más**: no escribe ilustración,
ni YAML, ni coincidencias, y nunca marca nada como revisado. Dónde estás en tu cola es tu
afirmación; qué es cierto en un destino es la de PosterPilot, y ninguna debe editar a la
otra.

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
consistencia, cobertura, overrides y una nueva búsqueda en todos los miembros en
una sola acción. No autoaplican. Consulta
[FUN y colecciones](../fun-collections/).

Con varios servidores usa el selector; biblioteca, trabajos, Review, colecciones y
automatizaciones permanecen aislados. Consulta
[Migración multiservidor](../multi-server-migration/).

El registro detallado está en **Ajustes → Actividad**. Diagnóstico, automatización,
copias y recuperación se explican en [Automatización y recuperación](../automation-recovery/).
