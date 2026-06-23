---
title: Traducir
description: Ayuda a traducir la interfaz de PosterPilot a tu idioma a través de Weblate, sin necesidad de programar.
---

¡Ayuda a traducir la interfaz a tu idioma! No se requiere programación. Esta página
refleja la sección de traductores de
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators).

La interfaz está localizada en inglés (el predeterminado), español, chino
simplificado, japonés y portugués de Brasil, con **reserva al inglés por clave**
para que cualquier cadena dejada sin traducir muestre siempre un inglés legible,
nunca una clave en bruto.

## Fuente de verdad

Cada cadena de cara al usuario vive en un catálogo JSON por locale bajo
`messages/`, un archivo por idioma, indexado por un id de mensaje estable:

- `messages/en.json` — el catálogo **fuente** completo (todos los id de mensaje)
- `messages/es.json` — español
- `messages/zh.json` — chino simplificado
- `messages/ja.json` — japonés
- `messages/pt-BR.json` — portugués de Brasil

Los demás catálogos contienen traducciones y pueden ser parciales. Cualquier id que
falte o se deje vacío en un locale de destino recurre a su texto en inglés. Las
nuevas cadenas en inglés añadidas a `en.json` aparecen automáticamente como
entradas sin traducir para cada idioma.

## Mediante Weblate (recomendado)

Las traducciones se gestionan a través de
[Weblate](https://hosted.weblate.org/engage/posterpilot/), una plataforma libre de
traducción web, usando un flujo de trabajo basado en git:

1. Abre el [proyecto PosterPilot en Weblate](https://hosted.weblate.org/engage/posterpilot/)
   e inicia sesión; una cuenta gratuita es suficiente.
2. Elige tu idioma y traduce las cadenas sin traducir directamente en el navegador.
3. Weblate propone los cambios de vuelta al repositorio como commits/PR sobre git;
   un mantenedor los fusiona.

[![Estado de la traducción](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

El componente de Weblate está configurado contra `messages/*.json` con `en` como
idioma fuente y formato JSON (clave-valor), de modo que siempre refleja el catálogo
fuente actual.

## Mediante una pull request directa

También puedes editar un catálogo a mano: copia una nueva clave de
`messages/en.json` a `messages/<locale>.json`, traduce el valor y abre una PR.

- Mantén las claves idénticas a las de la fuente; traduce solo los **valores**.
- Deja sin traducir los nombres propios técnicos: **Plex, MediUX, TMDB, Kometa,
  Fanart.tv**.

## Cómo se elige el idioma activo

El idioma activo se resuelve por petición: (1) tu preferencia persistida (definida
mediante el selector de la cabecera o Ajustes), luego (2) el `Accept-Language` de tu
navegador y luego (3) el inglés. Consulta
[Configuración → Idioma](/posterpilot/es/configuration/#idioma) para más detalles.

Al contribuir traducciones, aceptas que tus contribuciones se licencien bajo la
[licencia MIT](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE) del
proyecto.
</content>
