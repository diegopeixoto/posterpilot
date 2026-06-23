---
title: Instalação
description: Execute o PosterPilot como um único contêiner Docker usando a imagem oficial do GHCR, com exemplos de Docker Compose para macOS e Unraid.
---

O PosterPilot roda como um único contêiner Docker. A mesma imagem multi-arch
(`amd64` + `arm64`) roda em um Mac, em um servidor Unraid ou em qualquer outro lugar onde o Docker
rode.

## A imagem oficial

A imagem oficial pré-construída é publicada no GitHub Container Registry:

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

As tags acompanham os releases; `:latest` aponta para o release mais recente. Você pode fixar uma
tag de versão específica, se preferir upgrades reproduzíveis.

## Volumes e portas

Dois volumes importam:

- **`/data`** — estado persistente do app: o banco de dados SQLite, suas configurações salvas,
  o histórico de aplicações e o arquivo de log rotativo (`/data/logs/posterpilot.log`).
  Mantenha isto em um volume montado para que o estado sobreviva às atualizações do contêiner;
  o arquivo de log fica dentro de `/data`, então não é necessário um volume extra para ele.
- **`/kometa`** — monte aqui o diretório de assets/config do Kometa para que o
  YAML exportado caia onde o Kometa o lê. Só é necessário se você usar a exportação do Kometa.

O contêiner escuta na porta **3000** por padrão (configurável via a variável de
ambiente `PORT`). Publique-a em uma porta do host para acessar a interface.

## Docker Compose (macOS)

Crie um `docker-compose.yml`:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    healthcheck:
      test:
        [
          'CMD',
          'bun',
          '-e',
          "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Opcional — você também pode definir estes na página de Configurações do app:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      # Estado persistente do app (banco SQLite + configurações + histórico).
      - ./data:/data
      # Monte aqui o diretório de assets/config do Kometa para que o YAML exportado seja captado.
      - ./data/kometa:/kometa
    restart: unless-stopped
```

Depois inicie-o:

```sh
docker compose up -d
# UI em http://localhost:3000
```

O `docker-compose.yml` incluído no repositório tem o mesmo formato e inclui
uma opção `build: .` caso você prefira construir a imagem localmente em vez de
baixá-la:

```sh
docker compose up -d --build
```

## Unraid (template do Community Apps)

O repositório fornece um template do Community Apps em `unraid/posterpilot.xml`. Na
interface do Unraid, vá em **Docker → Add Container** e cole isto no campo _Template_:

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

Ele preenche previamente a imagem do GHCR, a porta da WebUI, os volumes `/data` e `/kometa` e
campos opcionais de credenciais (Plex / Jellyfin / Emby, TMDB, Fanart.tv, idioma) —
todos os quais você também pode configurar mais tarde na página de Configurações.

## Docker Compose (Unraid)

Prefere o Compose? Aponte os volumes para o seu compartilhamento `appdata` — em particular, aponte o
volume do Kometa para o seu diretório de config **existente** do Kometa para que o YAML exportado caia
onde o Kometa já o lê:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Opcional — ou configure estes na página de Configurações:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
    restart: unless-stopped
```

Defina `PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY` no ambiente do contêiner, ou deixe-os
em branco e configure tudo pela página de Configurações, depois acesse o
contêiner na porta 3000.

## Primeira execução

1. Inicie o contêiner e abra `http://<host>:3000` (por exemplo,
   `http://localhost:3000`).
2. Na primeira execução, nada ainda foi sincronizado. Um banner aponta você para o **assistente
   de primeira instalação** em `/setup`, que conduz você por seis passos: escolher um idioma,
   conectar um servidor de mídia, adicionar uma chave do TMDB, habilitar provedores de artwork,
   escolher quais bibliotecas sincronizar e executar a primeira sincronização. Para o Plex, o
   assistente inclui um login por PIN e a descoberta de conexões, de modo que você nunca precisa
   colar um token ou uma URL. O assistente é pulável — você pode configurar tudo em
   **Configurações**.
3. Se você definir credenciais via variáveis de ambiente, elas aparecem já configuradas e
   bloqueadas para edição tanto no assistente quanto em Configurações (veja
   [Configuração](/posterpilot/pt-br/configuration/)).
4. Após a sincronização, comece a encontrar e aplicar capas (veja
   [Uso](/posterpilot/pt-br/usage/)).

## Verificação de saúde

O app expõe um `GET /api/health` não autenticado que retorna
`{ "status": "ok", "version": "x.y.z" }` com HTTP 200 — use-o como sonda de saúde
do contêiner (o `docker-compose.yml` incluído já faz isso):

```sh
curl -s http://localhost:3000/api/health
```
