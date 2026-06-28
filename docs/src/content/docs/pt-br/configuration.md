---
title: Configuração
description: Conecte um servidor de mídia, defina sua chave do TMDB, habilite provedores de artwork, configure a exportação do Kometa e use a referência completa de variáveis de ambiente.
---

O PosterPilot é configurado de duas formas, e elas funcionam em conjunto:

- **Variáveis de ambiente** — definidas no contêiner. Boas para configurações não assistidas
  e gerenciamento de segredos.
- **A página de Configurações do app** — inseridas na interface e persistidas no banco de dados
  SQLite em `/data`, de modo que sobrevivem a reinicializações. As Configurações são organizadas em
  abas: **Servidor de mídia**, **Metadados e provedores**, **Kometa e avançado**,
  **Idioma** e **Atividade** (o log de eventos do app). Um
  [assistente de primeira instalação](/posterpilot/pt-br/installation/#primeira-execução) guiado em
  `/setup` cobre o mesmo terreno em ordem para uma instalação nova.

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

## Segredos e criptografia

Esses mesmos segredos — o token do Plex, as chaves de API / tokens de acesso do Jellyfin e do
Emby, a credencial do TMDB e a chave do Fanart.tv — são **criptografados em repouso** com
AES-256-GCM antes de serem gravados no banco de dados SQLite. Cada valor armazenado é
autodescritivo (carrega um prefixo `enc:v1:`), de modo que o PosterPilot consegue distinguir
valores criptografados de texto puro legado.

- **Zero configuração por padrão.** Na primeira execução, o PosterPilot gera uma chave de
  instância aleatória de 32 bytes e a persiste — legível apenas pelo dono — em `data/.app-key`.
  Nada para configurar: os segredos são criptografados automaticamente. (Substitua o caminho com
  `APP_KEY_FILE` se precisar.)
- **Chave portátil para deploys compartilhados.** Defina a variável de ambiente opcional
  `APP_SECRET` para derivar a chave de um valor que você controla (deterministicamente via
  scrypt). Use-a quando você roda várias réplicas compartilhando um banco de dados, ou quando
  quer que a mesma chave sobreviva à recriação do contêiner sem carregar o arquivo de chave
  junto. Quando `APP_SECRET` está definida, ela tem precedência sobre o `data/.app-key` gerado.
- **Instalações existentes não são quebradas.** Segredos salvos por uma versão mais antiga como
  texto puro são lidos de forma transparente e recriptografados na próxima vez que aquela
  configuração for salva — nenhuma redigitação manual é necessária.
- **Falha segura.** Se um segredo não puder ser descriptografado (por exemplo, a chave foi
  perdida ou alterada), o PosterPilot o trata como não definido e pede que você o redigite, em
  vez de travar.

:::caution
Se você depende do `data/.app-key` gerado automaticamente (sem `APP_SECRET` definida), **faça
backup do volume `/data`** — perder o arquivo de chave significa que os segredos criptografados
não podem mais ser descriptografados e precisam ser redigitados. Definir `APP_SECRET` (e
mantê-la segura) evita isso e mantém os segredos portáteis entre recriações de contêiner e réplicas.
:::

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

O Jellyfin precisa de uma URL base (`JELLYFIN_URL`) e um token de acesso, armazenado como a chave
de API (`JELLYFIN_API_KEY`). Defina `SERVER_TYPE=jellyfin` para torná-lo o servidor ativo. A forma
mais simples de conectar é **entrar com seu nome de usuário e senha do Jellyfin** em Configurações
— o PosterPilot autentica no servidor e armazena o token de acesso retornado para você
(criptografado em repouso), de modo que você nunca precisa gerar uma chave de API manualmente; a
senha é usada apenas para essa única requisição e nunca é persistida. Colar uma chave de API
diretamente permanece disponível como alternativa. Pôsteres e fundos são enviados para a API de
imagens do Jellyfin (`Primary` para pôster, `Backdrop` para fundo). Não há login por PIN nem
descoberta de conexões como há para o Plex.

:::note
O caminho do Plex é o mais testado em produção; as integrações do Jellyfin e do Emby são mais
recentes. Elas rodam por trás da mesma interface de servidor de mídia, de modo que sincronizar,
descobrir e aplicar funcionam de forma idêntica — mas se você encontrar uma peculiaridade
específica do servidor, por favor abra uma issue.
:::

### Emby

O Emby precisa de uma URL base (`EMBY_URL`) e um token de acesso, armazenado como a chave de API
(`EMBY_API_KEY`). Defina `SERVER_TYPE=emby` para torná-lo o servidor ativo. Assim como o Jellyfin,
o Emby permite que você **entre com seu nome de usuário e senha** — o PosterPilot os troca por um
token de acesso e o armazena (criptografado) para que você não precise encontrar uma chave de API,
com a entrada manual de chave de API como alternativa. Não há login por PIN nem descoberta de conexões.

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

## Desempenho e ajustes

Um punhado de configurações avançadas (na aba de Configurações **Kometa e avançado**, ou via
ambiente) ajusta como o PosterPilot pontua, sincroniza, aplica e faz cache. Elas seguem a
precedência habitual — uma variável de ambiente sobrepõe o valor persistido e bloqueia o
controle na interface.

- **Pré-seleção de artwork sugerido** (`SUGGEST_PRESELECT`, padrão ligado). Quando ligada, a
  visão do item pré-seleciona o candidato com a maior pontuação por slot como uma sugestão que
  pode ser substituída. Desligue-a para deixar todos os slots não selecionados até você escolher.
- **Pesos de pontuação.** O PosterPilot classifica os candidatos em três termos — um peso base
  por provedor (MediUX, ThePosterDB, Fanart.tv, TMDB), uma pontuação de resolução e uma pontuação
  de ajuste de proporção (2:3 para pôsteres, 16:9 para backdrops e title cards). Os padrões
  favorecem o MediUX, mas ainda permitem que uma imagem muito mais nítida ou com proporção melhor
  de outro provedor vença. Ajuste os pesos em Configurações; eles são armazenados no banco de
  dados e não têm variável de ambiente.
- **Sincronização incremental** (`INCREMENTAL_SYNC`, padrão ligado). Sincronizações repetidas
  pulam itens cujo timestamp de última modificação no servidor de mídia não mudou desde a última
  sincronização. Uma varredura completa permanece disponível sob demanda.
- **Concorrência de aplicação** (`APPLY_CONCURRENCY`, padrão `4`). Quantos itens uma aplicação em
  massa processa de uma vez. Aumente para terminar lotes grandes mais rápido; reduza para ser
  mais gentil com seu servidor e os provedores.
- **Cache de miniaturas** (`THUMB_CACHE_TTL_DAYS`, padrão `30`; `THUMB_CACHE_MAX_MB`, padrão
  `512`). As imagens de prévia dos provedores são armazenadas em cache em disco sob `/data` para
  acelerar a grade e reduzir a largura de banda dos provedores. As entradas são reutilizadas até
  o TTL (em dias) expirar, e o cache é limitado por um tamanho máximo (em MB) — quando ele é
  excedido, as entradas menos recentemente usadas são removidas.

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
(3) inglês. Defina um idioma preferido com `APP_LANGUAGE`, pela página de Configurações ou
com o seletor de idioma do cabeçalho. As localidades suportadas são inglês (`en`), espanhol
(`es`), chinês simplificado (`zh`), japonês (`ja`) e português do Brasil
(`pt-BR`). Um valor não definido ou não suportado recai para `Accept-Language`, depois
inglês — nunca um erro e nunca uma chave bruta.

## Logging e log de atividade

Todo evento operacional é registrado de três formas: espelhado no console do contêiner,
inserido como uma linha no log de **Atividade** do app (Configurações → Atividade) e
acrescentado a um arquivo de log rotativo. O arquivo é `posterpilot.log` dentro de
`LOG_DIR` (padrão `/data/logs` no Docker); quando ele ultrapassa ~5 MB, é rotacionado
(`posterpilot.log` → `.1` → `.2` …), mantendo cerca de cinco arquivos. Como o padrão fica
sob `/data`, o volume `/data` existente já o persiste — nenhum mount extra é necessário.

A tabela do log de Atividade é limitada a `EVENT_RETENTION` linhas (padrão `2000`); linhas
mais antigas são removidas automaticamente. Você pode limpar a tabela a qualquer momento com o
botão **Limpar atividade** na aba Atividade (isso não exclui o arquivo de log em disco).

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
| `APPLY_CONCURRENCY`       | Concorrência de aplicação | `4`                                   | Quantos itens uma aplicação em massa processa concorrentemente.                               |
| `SUGGEST_PRESELECT`       | Pré-seleção sugerida      | on                                    | Pré-seleciona o candidato com a maior pontuação por slot como uma sugestão substituível.      |
| `INCREMENTAL_SYNC`        | Sincronização incremental | on                                    | Pula itens não alterados em sincronizações repetidas (uma varredura completa permanece disponível). |
| `THUMB_CACHE_TTL_DAYS`    | TTL do cache de miniaturas | `30`                                 | Dias que uma imagem de prévia de provedor em cache permanece válida antes de ser re-obtida.   |
| `THUMB_CACHE_MAX_MB`      | Tamanho do cache de miniaturas | `512`                            | Tamanho máximo em disco do cache de miniaturas (MB) antes da remoção das menos recentemente usadas. |
| `APP_LANGUAGE`                | Idioma                    | — (auto)                              | Localidade de interface preferida: `en`, `es`, `zh`, `ja` ou `pt-BR`.                          |
| `LOG_DIR`                 | —                         | `/data/logs` (Docker)                 | Pasta para o arquivo de log rotativo `posterpilot.log` (~5 MB × 5 arquivos).                  |
| `EVENT_RETENTION`         | —                         | `2000`                                | Número máximo de linhas do log de atividade mantidas no banco de dados (linhas mais antigas são removidas). |
| `DATABASE_URL`            | —                         | `file:/data/posterpilot.db` (Docker)  | URL de arquivo libsql para o banco de dados SQLite.                                            |
| `PORT`                    | —                         | `3000`                                | Porta de escuta.                                                                              |
| `APP_SECRET`              | —                         | — (chave automática)                  | Deriva a chave de criptografia em repouso (scrypt); sobrepõe o `data/.app-key` gerado.         |
| `APP_KEY_FILE`            | —                         | `./data/.app-key`                     | Caminho do arquivo de chave de criptografia de instância gerado automaticamente (usado quando `APP_SECRET` não está definida). |

Flags booleanas aceitam `1` / `true` / `on` / `yes` (sem distinção de maiúsculas) para _habilitado_;
qualquer outra coisa (ou não definido) mantém o padrão documentado.

:::note
`DATABASE_URL`, `PORT`, `LOG_DIR`, `EVENT_RETENTION`, `APP_SECRET` e `APP_KEY_FILE` são
configurações de nível de deploy — são lidas apenas do ambiente e não fazem parte da página de
Configurações do app.
:::
