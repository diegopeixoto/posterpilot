---
title: Contribuer
description: Configurez PosterPilot en local pour le développement et exécutez les contrôles qualité que chaque changement doit passer avant relecture.
---

Les issues et les pull requests sont les bienvenues. Cette page résume
l'installation locale et les contrôles qualité ; la source canonique, toujours à
jour, est le fichier
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)
du dépôt.

## Installation locale

PosterPilot est une application SvelteKit qui s'exécute avec [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env          # fill PLEX_URL / PLEX_TOKEN / TMDB_KEY (or use the Settings UI)
bun run db:generate           # generate SQL migrations from the Drizzle schema (already committed)
bun run dev                   # http://localhost:5173
```

Les migrations s'appliquent automatiquement au démarrage du serveur.

## Contrôles qualité

Chaque changement doit passer ces contrôles avant relecture — la CI exécute les
mêmes :

```sh
bun run check     # svelte-check type checking
bun run test      # vitest unit tests
bun run lint      # prettier --check (run `bun run format` to auto-fix)
```

Le projet suit le développement piloté par les tests pour la logique serveur —
écrivez d'abord un test qui échoue, puis l'implémentation. Gardez la logique
pure et testable exempte d'imports `$env` / `$app` afin qu'elle puisse être
testée unitairement de manière isolée (voir les tests existants pour le modèle à
suivre).

## Messages de commit

Le projet utilise les
[Conventional Commits](https://www.conventionalcommits.org/). Le préfixe de type
pilote le changelog automatisé et l'incrément de version via release-please :

- `feat:` — une nouvelle fonctionnalité (incrément mineur)
- `fix:` — une correction de bug (incrément de correctif)
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` — pas de publication à eux seuls
- `feat!:` / un pied de message `BREAKING CHANGE:` — incrément majeur

Exemple : `feat(library): add genre filter`.

## Pull requests

1. Créez une branche à partir de `main`.
2. Faites des changements ciblés ; limitez le diff à une seule préoccupation.
3. Vérifiez que `check`, `test` et `lint` passent au vert.
4. Ouvrez une pull request en utilisant le modèle et liez toute issue associée.

## Changements pilotés par les specs

Les fonctionnalités plus importantes sont planifiées avec
[OpenSpec](https://github.com/Fission-AI/OpenSpec) sous `openspec/changes/`. Pour
un changement conséquent, proposez d'abord une spec, puis implémentez selon ses
tâches. Les specs de capacités se trouvent sous `openspec/specs/`.

## Traduction

Aucune compétence en programmation n'est requise pour aider à traduire
l'interface — voir [Traduction](/posterpilot/fr/translating/) pour le flux de
travail Weblate.
