---
title: Contribuir
description: Configura PosterPilot localmente para el desarrollo y ejecuta los controles de calidad que todo cambio debe pasar antes de la revisión.
---

Las incidencias y las pull requests son bienvenidas. Esta página resume la
configuración local y los controles de calidad; la fuente canónica y siempre
actualizada es
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)
en el repositorio.

## Configuración local

PosterPilot es una app SvelteKit que se ejecuta sobre [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env          # rellena PLEX_URL / PLEX_TOKEN / TMDB_KEY (o usa la interfaz de Ajustes)
bun run db:generate           # genera migraciones SQL desde el esquema de Drizzle (ya commiteadas)
bun run dev                   # http://localhost:5173
```

Las migraciones se aplican automáticamente al arrancar el servidor.

## Controles de calidad

Todo cambio debe pasar estos antes de la revisión; CI ejecuta los mismos:

```sh
bun run check     # comprobación de tipos con svelte-check
bun run test      # pruebas unitarias con vitest
bun run lint      # prettier --check (ejecuta `bun run format` para autocorregir)
```

El proyecto sigue el desarrollo guiado por pruebas para la lógica del servidor:
escribe primero una prueba que falle y luego la implementación. Mantén la lógica
pura y testeable libre de imports de `$env` / `$app` para que pueda probarse de
forma aislada (consulta las pruebas existentes para ver el patrón).

## Mensajes de commit

El proyecto usa [Conventional Commits](https://www.conventionalcommits.org/). El
prefijo de tipo impulsa el changelog automatizado y el incremento de versión
mediante release-please:

- `feat:` — una nueva función (incremento menor)
- `fix:` — una corrección de error (incremento de parche)
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` — no provocan una publicación por
  sí mismos
- `feat!:` / un pie `BREAKING CHANGE:` — incremento mayor

Ejemplo: `feat(library): add genre filter`.

## Pull requests

1. Crea una rama desde `main`.
2. Haz cambios enfocados; mantén el diff acotado a una sola cuestión.
3. Asegúrate de que `check`, `test` y `lint` están en verde.
4. Abre una PR usando la plantilla y enlaza cualquier incidencia relacionada.

## Cambios guiados por especificación

Las funciones más grandes se planifican con
[OpenSpec](https://github.com/Fission-AI/OpenSpec) bajo `openspec/changes/`. Para un
cambio sustancial, propón primero una especificación y luego implementa contra sus
tareas. Las especificaciones de capacidades viven bajo `openspec/specs/`.

## Traducir

No se requiere programación para ayudar a traducir la interfaz; consulta
[Traducir](/posterpilot/es/translating/) para el flujo de trabajo de Weblate.
</content>
