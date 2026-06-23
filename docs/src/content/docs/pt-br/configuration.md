---
title: Configuração
description: Conecte um servidor de mídia, defina sua chave do TMDB, habilite provedores de artwork, configure a exportação do Kometa e use a referência completa de variáveis de ambiente.
---

O PosterPilot é configurado de duas formas, e elas funcionam em conjunto:

- **Variáveis de ambiente** — definidas no contêiner. Boas para configurações não assistidas
  e gerenciamento de segredos.
- **A página de Configurações do app** — inseridas na interface e persistidas no banco de dados
  SQLite em `/data`, de modo que sobrevivem a reinicializações.

## Ambiente vs. a interface de Configurações

Para qualquer configuração dada, a **variável de ambiente sempre tem precedência** sobre
o valor persistido da interface. Quando um valor é fornecido pelo ambiente, a
página de Configurações o mostra como _gerenciado pelo ambiente_ e o bloqueia para edição na
interface — de modo que a fonte da verdade fique inequívoca.

Se um valor não estiver definido em nenhum dos dois lugares, o padrão documentado (se houver) se aplica, ou
o recurso que depende dele permanece não configurado até você defini-lo.

Segredos (o token do Plex, as chaves de API do Jellyfin/Emby, a credencial do TMDB e a
chave do Fanart.tv) nunca são devolvidos ao navegador depois de salvos e são
removidos dos logs — a página de Configurações apenas indica que um segredo _está definido_.

## Servidor de mídia

O PosterPilot conversa com um servidor de mídia ativo por vez, escolhido por `SERVER_TYPE`
(`plex`, `jellyfin` ou `emby`; o padrão é `plex`). Somente as credenciais do servidor
ativo são validadas antes de uma sincronização.

### Plex

O Plex precisa de uma URL base e um `X-Plex-Token`. Você pode fornecê-los de três formas:

- **Login por PIN (recomendado).** Em Configurações, inicie um login do Plex. O PosterPilot
  cria um PIN forte com o plex.tv, mostra a você um código e um link de autorização,
  e faz polling até você autorizar — então armazena o token obtido para você, de modo que
  você nunca precisa encontrar e colar um token bruto. Se o PIN expirar antes de você
  autorizar, basta iniciar um novo login.
- **Descoberta de conexões.** Assim que um token estiver disponível, o PosterPilot pode descobrir
  seus servidores Plex e suas conexões a partir do plex.tv, rotulando cada conexão como
  **local** ou **remota** (relays são sinalizados). Escolha uma em vez de digitar uma URL;
  a conexão escolhida é verificada com um teste de conexão antes de ser salva como
  a URL base ativa do Plex.
- **Manual.** Cole a URL base (por exemplo, `http://192.168.1.10:32400`) e um
  `X-Plex-Token` diretamente.

### Jellyfin

:::caution[Provisório]
O suporte ao Jellyfin é fornecido por trás da interface compartilhada de servidor de mídia. Valide
os detalhes em relação à sua configuração; os formatos de campo abaixo correspondem ao modelo de
configuração, mas a integração é mais recente do que o caminho do Plex.
:::

O Jellyfin precisa de uma URL base (`JELLYFIN_URL`) e uma chave de API (`JELLYFIN_API_KEY`).
Defina `SERVER_TYPE=jellyfin` para torná-lo o servidor ativo. Os pôsteres são enviados para
a API de imagens do Jellyfin (`Primary` para pôster, `Backdrop` para fundo).

### Emby

:::caution[Provisório]
O suporte ao Emby, assim como o do Jellyfin, é fornecido por trás da interface compartilhada de servidor de mídia
e é mais recente do que o caminho do Plex. Valide os detalhes em relação à sua configuração.
:::

O Emby precisa de uma URL base (`EMBY_URL`) e uma chave de API (`EMBY_API_KEY`). Defina
`SERVER_TYPE=emby` para torná-lo o servidor ativo.

## Chave do TMDB

Uma credencial de API do [TMDB](https://www.themoviedb.org/) é obrigatória: o PosterPilot
resolve cada título sincronizado para um id do TMDB (para que os provedores possam ser consultados com precisão)
e o TMDB também é um dos provedores de artwork. Defina-a via `TMDB_KEY` ou em
Configurações. Tanto uma **chave de API v3** quanto um **token bearer/JWT v4** são aceitos — o
formato é detectado automaticamente.

## Provedores de artwork

O PosterPilot distribui a busca entre vários provedores de artwork durante a descoberta e
mescla seus candidatos, marcando cada um com o provedor de origem. Cada
provedor pode ser habilitado ou desabilitado de forma independente, em Configurações ou via sua
variável de ambiente.

| Provedor        | Padrão | Precisa de chave  | Notas                                                           |
| --------------- | ------ | ----------------- | --------------------------------------------------------------- |
| **MediUX**      | on     | não               | Conjuntos de pôster/fundo extraídos por scraping com atribuição ao uploader. |
| **TMDB**        | on     | reutiliza `TMDB_KEY` | Pôsteres e backdrops do endpoint de imagens do TMDB.         |
| **Fanart.tv**   | off    | `FANART_KEY`      | Pôsteres, fundos e logos da API do Fanart.tv.                   |
| **ThePosterDB** | off    | não               | Conjuntos de pôster/fundo da comunidade extraídos por scraping, com throttling e cache. |

O Fanart.tv é o único provedor com chave: se ele estiver habilitado, mas nenhuma `FANART_KEY` estiver
configurada, a descoberta o ignora e expõe a condição de credencial ausente em vez de
falhar a execução inteira. Uma falha, timeout ou resposta não interpretável de
um provedor nunca impede os outros de retornar candidatos.

## Exportação do Kometa

Quando você aplica uma capa com o método do Kometa, o PosterPilot grava
YAML compatível com Kometa/PMM (`url_poster` / `url_background`, indexado pelo id do TMDB) no
diretório nomeado por `KOMETA_ASSETS_DIR` (padrão `/kometa` no Docker). Monte
esse caminho no seu diretório de config existente do Kometa para que o Kometa aplique as capas na
próxima execução. Veja [Uso](/posterpilot/pt-br/usage/#aplicar-uma-capa) para saber como a exportação é
consumida.

## Idioma

O idioma da interface é resolvido por requisição: (1) a configuração de idioma preferido quando
ela nomeia uma localidade suportada, depois (2) o cabeçalho `Accept-Language` da requisição, depois
(3) inglês. Defina um idioma preferido com `LANGUAGE`, pela página de Configurações ou
com o seletor de idioma do cabeçalho. As localidades suportadas são inglês (`en`), espanhol
(`es`), chinês simplificado (`zh`), japonês (`ja`) e português do Brasil
(`pt-BR`). Um valor não definido ou não suportado recai para `Accept-Language`, depois
inglês — nunca um erro e nunca uma chave bruta.

## Referência de variáveis de ambiente

Toda configuração abaixo pode ser fornecida como uma variável de ambiente. A maioria também é
editável na página de Configurações; quando definidas pelo ambiente, têm precedência
e ficam bloqueadas na interface.

| Variável                  | Configuração              | Padrão                                | Significado                                                                                   |
| ------------------------- | ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SERVER_TYPE`             | Tipo de servidor          | `plex`                                | Servidor de mídia ativo: `plex`, `jellyfin` ou `emby`.                                        |
| `PLEX_URL`                | URL do Plex               | —                                     | URL base do Plex, por exemplo `http://192.168.1.10:32400`.                                    |
| `PLEX_TOKEN`              | Token do Plex (segredo)   | —                                     | Seu `X-Plex-Token`.                                                                            |
| `PLEX_CLIENT_ID`          | Client id do Plex         | gerado                                | Identificador estável por instalação enviado ao plex.tv para login por PIN / descoberta.      |
| `JELLYFIN_URL`            | URL do Jellyfin           | —                                     | URL base do Jellyfin (quando `SERVER_TYPE=jellyfin`).                                          |
| `JELLYFIN_API_KEY`        | Chave de API do Jellyfin (segredo) | —                            | Chave de API do Jellyfin.                                                                      |
| `EMBY_URL`                | URL do Emby               | —                                     | URL base do Emby (quando `SERVER_TYPE=emby`).                                                  |
| `EMBY_API_KEY`            | Chave de API do Emby (segredo) | —                                | Chave de API do Emby.                                                                          |
| `TMDB_KEY`                | Chave do TMDB (segredo)   | —                                     | Chave de API v3 do TMDB **ou** bearer/JWT v4 (detectado automaticamente).                      |
| `KOMETA_ASSETS_DIR`       | Diretório de assets do Kometa | `./data/kometa` (`/kometa` no Docker) | Diretório onde o YAML exportado do Kometa é gravado.                                        |
| `DEFAULT_APPLY_METHOD`    | Método de aplicação padrão | `both`                               | Método de aplicação padrão: `plex`, `kometa` ou `both`.                                        |
| `INCLUDED_SECTIONS`       | Seções incluídas          | todas de filmes/séries                | Chaves de seção da biblioteca a sincronizar; separadas por vírgula (env) ou um array JSON (persistido). Vazio = todas. |
| `PROVIDER_MEDIUX`         | Provedor MediUX           | on                                    | Habilita o provedor MediUX.                                                                    |
| `PROVIDER_TMDB`           | Provedor TMDB             | on                                    | Habilita o provedor de artwork do TMDB.                                                        |
| `PROVIDER_FANART`         | Provedor Fanart.tv        | off                                   | Habilita o provedor Fanart.tv (requer `FANART_KEY`).                                           |
| `PROVIDER_THEPOSTERDB`    | Provedor ThePosterDB      | off                                   | Habilita o provedor ThePosterDB.                                                               |
| `FANART_KEY`              | Chave do Fanart.tv (segredo) | —                                  | Chave de API do Fanart.tv (o único provedor com chave).                                        |
| `MEDIUX_REQUEST_DELAY_MS` | Atraso de requisição do MediUX | `2000`                           | Atraso entre requisições ao MediUX, em milissegundos (throttling).                            |
| `MEDIUX_CONCURRENCY`      | Concorrência do MediUX    | `5`                                   | Máximo de requisições concorrentes ao MediUX.                                                  |
| `HTTP_CACHE_TTL_DAYS`     | TTL do cache HTTP         | `7`                                   | Por quanto tempo as respostas HTTP em cache (scrapes) são reutilizadas, em dias.              |
| `LANGUAGE`                | Idioma                    | — (auto)                              | Localidade de interface preferida: `en`, `es`, `zh`, `ja` ou `pt-BR`.                          |
| `DATABASE_URL`            | —                         | `file:/data/posterpilot.db` (Docker)  | URL de arquivo libsql para o banco de dados SQLite.                                            |
| `PORT`                    | —                         | `3000`                                | Porta de escuta.                                                                              |

Flags booleanas aceitam `1` / `true` / `on` / `yes` (sem distinção de maiúsculas) para _habilitado_;
qualquer outra coisa (ou não definido) mantém o padrão documentado.

:::note
`DATABASE_URL` e `PORT` são configurações de nível de deploy — são lidas apenas do
ambiente e não fazem parte da página de Configurações do app.
:::
