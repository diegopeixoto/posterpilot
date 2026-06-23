---
title: Contribuindo
description: Configure o PosterPilot localmente para desenvolvimento e execute os portões de qualidade que toda alteração deve passar antes da revisão.
---

Issues e pull requests são bem-vindos. Esta página resume a configuração local e os
portões de qualidade; a fonte canônica e sempre atualizada é o
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)
no repositório.

## Configuração local

O PosterPilot é um app SvelteKit que roda no [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env          # preencha PLEX_URL / PLEX_TOKEN / TMDB_KEY (ou use a interface de Configurações)
bun run db:generate           # gera as migrações SQL a partir do schema do Drizzle (já commitadas)
bun run dev                   # http://localhost:5173
```

As migrações são aplicadas automaticamente na inicialização do servidor.

## Portões de qualidade

Toda alteração deve passar por estes antes da revisão — a CI roda os mesmos:

```sh
bun run check     # verificação de tipos com svelte-check
bun run test      # testes unitários com vitest
bun run lint      # prettier --check (rode `bun run format` para corrigir automaticamente)
```

O projeto segue desenvolvimento orientado a testes para a lógica do servidor — escreva um teste
que falha primeiro, depois a implementação. Mantenha a lógica pura e testável livre de
imports de `$env` / `$app` para que possa ser testada unitariamente de forma isolada (veja os testes
existentes para o padrão).

## Mensagens de commit

O projeto usa [Conventional Commits](https://www.conventionalcommits.org/). O
prefixo de tipo dirige o changelog automatizado e o bump de versão via release-please:

- `feat:` — um novo recurso (bump minor)
- `fix:` — uma correção de bug (bump patch)
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` — sem release por si só
- `feat!:` / um rodapé `BREAKING CHANGE:` — bump major

Exemplo: `feat(library): add genre filter`.

## Pull requests

1. Crie um branch a partir de `main`.
2. Faça alterações focadas; mantenha o diff restrito a uma única preocupação.
3. Garanta que `check`, `test` e `lint` estejam verdes.
4. Abra um PR usando o template e vincule qualquer issue relacionada.

## Alterações orientadas a spec

Recursos maiores são planejados com
[OpenSpec](https://github.com/Fission-AI/OpenSpec) sob `openspec/changes/`. Para uma
alteração substancial, proponha uma spec primeiro, depois implemente em relação às suas tarefas. As
specs de capacidade ficam sob `openspec/specs/`.

## Traduzindo

Nenhuma codificação é necessária para ajudar a traduzir a interface — veja
[Traduzindo](/posterpilot/pt-br/translating/) para o fluxo de trabalho do Weblate.
