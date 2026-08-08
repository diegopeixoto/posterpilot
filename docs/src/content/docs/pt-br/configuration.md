---
title: Configuração
description: Configure servidores nomeados, provedores, Kometa, automação, backups, segurança e todas as variáveis de ambiente suportadas.
---

O PosterPilot combina duas fontes:

- **Variáveis de ambiente**, adequadas a deploy e gerenciamento de segredos.
- **Configurações da aplicação**, persistidas no SQLite sob `/data`.

Para a mesma opção, **o ambiente sempre prevalece**. A interface marca o valor como
gerenciado pelo ambiente e bloqueia sua edição. Segredos persistidos são criptografados
com AES-256-GCM e nunca retornam completos ao navegador ou aos logs.

## Chave de criptografia

Sem configuração, o PosterPilot cria `data/.app-key` com acesso apenas do proprietário.
`APP_SECRET` deriva uma chave portátil e tem precedência. Preserve a mesma chave ao
mover ou restaurar a instalação; sem ela, será necessário informar as credenciais de
novo. Veja [Automação e recuperação](../automation-recovery/).

## Servidores de mídia nomeados

**Configurações → Servidores** permite adicionar, testar, ativar, habilitar,
desabilitar e desconectar várias instâncias Plex, Jellyfin e Emby. Uma fica ativa para
Biblioteca, Revisão, Coleções, FUN e mutações. Cada instância mantém URL, credencial
criptografada e capacidades próprias.

As variáveis legadas `SERVER_TYPE` e `PLEX_*` / `JELLYFIN_*` / `EMBY_*` definem o
servidor padrão protegido. Servidores adicionais ficam no banco; consulte
[Migração multi-servidor](../multi-server-migration/).

- **Plex:** token manual ou login PIN/descoberta no setup.
- **Jellyfin/Emby:** URL e chave/token; o setup também troca usuário/senha por um
  token reutilizável sem persistir a senha.

## TMDB, provedores e score

`TMDB_KEY` aceita chave v3 ou bearer/JWT v4. MediUX e TMDB começam ativos;
Fanart.tv requer `FANART_KEY`; ThePosterDB é opcional. A falha de um provedor não
bloqueia os demais e pode manter candidatos conhecidos marcados como desatualizados.

O ThePosterDB funciona sem conta, mas em algumas páginas ele serve uma imagem de
preenchimento a visitantes anônimos no lugar da artwork real. Você pode fazer login
de forma **opcional** — em **Metadados e provedores** (os campos aparecem ao
habilitar o ThePosterDB) ou com `THEPOSTERDB_USERNAME` / `THEPOSTERDB_PASSWORD` —
para obter as imagens reais. A senha é criptografada em repouso como os demais
segredos, e um login que falha volta ao modo anônimo naquela execução em vez de
bloquear a descoberta. Para voltar ao modo anônimo, limpe o usuário (o login
exige os dois); a senha guardada permanece criptografada e volta a ser usada se
você reinserir o usuário, a menos que você a remova com o controle **Limpar a
senha guardada** sob o campo de senha, que apaga o segredo ao salvar.

![Configurações de provedores do PosterPilot com o ThePosterDB habilitado e seus campos opcionais de usuário e senha](/posterpilot/screenshots/settings-providers.webp)

Em **Metadados e provedores**, ordene a prioridade e ajuste pesos de provedor,
resolução e proporção. A mesma configuração determinística vale na prévia e execução.
`SUGGEST_PRESELECT` mostra a melhor sugestão, mas aceitar/preparar é sempre explícito.

## Idioma das artes do TMDB

`TMDB_ARTWORK_LANGUAGE` (padrão `any`) define em qual idioma você navega e o que a
seleção automática pode escolher entre as artes do TMDB, independentemente de
`APP_LANGUAGE`: `any` mantém todos os idiomas que o TMDB devolveu, `ui` segue o
idioma da interface normalizado para o código base (uma interface `pt-BR` prefere
`pt`) e um código ISO 639-1 explícito (`en`, `de`…) não se limita aos seis locales
traduzidos. Um valor não reconhecido é tratado como ausente e volta para `any` em
vez de aplicar um filtro quebrado. Como nos demais, o ambiente prevalece e o campo
aparece como gerenciado pelo ambiente.

Artes que o TMDB não etiqueta contam como neutras e continuam disponíveis em
qualquer preferência, então uma preferência nunca esvazia um painel que só tem
arte neutra. A descoberta sempre guarda todos os idiomas — a preferência rege a
navegação e a seleção automática, não o que é baixado —, de modo que alterá-la
refiltra o que você já tem e nunca exige refazer a busca. A seleção automática só
recorre a um pôster em outro idioma quando não resta nenhuma opção preferida nem
sem etiqueta, e sinaliza quando isso acontece. A página do item traz ainda um
alternador temporário **Preferido / Todos** que não muda a configuração global.

## Inventário de candidatos e «carregar mais»

A ingestão do TMDB parava antes em 20 imagens **por tipo de arte** — pôsteres e
fundos eram contados separadamente, daí os relatos de «limitado a 40 capas».
Agora muitas mais são mantidas, sem duplicatas pela identidade de arquivo do
próprio TMDB e na ordem em que o TMDB as classificou, e cada painel de provedor e
tipo mostra um lote limitado com um controle **carregar mais** que informa quantos
candidatos continuam ocultos. Os painéis de pôsteres e de fundos se expandem de
forma independente. A descoberta mantém um teto defensivo de **200 candidatos por
tipo de arte** — um limite de armazenamento e renderização, não um filtro de
qualidade: quando um painel o atinge, ele avisa que o inventário está **truncado**
em vez de sugerir que está completo.

## Kometa e método de aplicação

`DEFAULT_APPLY_METHOD` aceita `plex` (servidor direto), `kometa` ou `both`. É o
valor inicial; escolher outro em uma ação não altera o padrão salvo.

O export grava `posterpilot-movies.yml` (TMDB) e `posterpilot-shows.yml` (TVDB, com
fallback IMDb) em `KOMETA_ASSETS_DIR`; com `KOMETA_CONFIG_PATH`, grava ao lado de
`config.yml`. `KOMETA_SERVER_INSTANCE_ID` deve indicar uma instância Plex exata.
`KOMETA_METADATA_PATH_PREFIX` define a referência relativa vista pelo Kometa, não
o caminho físico. Veja o [Gerenciador do Kometa](../kometa-config-sync/).

## Automação, backup e diagnóstico

- **Automação:** intervalo, horário diário ou evento por servidor/biblioteca;
  sincroniza/descobre para Revisão e nunca aplica automaticamente.
- **Backup e restauração:** bundles sob `/data/backups`, retenção por quantidade ou
  idade, validação, exportação e restauração pré-visualizada. A retenção é persistida
  na aplicação e não possui variável de ambiente.
- **Diagnósticos:** testes sem mutação para servidores, TMDB, provedores e caminhos,
  além de bundle de suporte redigido por exportação explícita.

## Segurança e FUN

`AUTH_MODE` é `disabled`, `local` ou `enabled`. Atrás de proxy, configure
`ADDRESS_HEADER` e `XFF_DEPTH` para que o modo local use o IP real. `FUN_ENABLED` ativa o
sorteio de três opções, Poster Match, galeria e planejador de sessão.

## Idioma

O idioma usa `APP_LANGUAGE`, depois `Accept-Language`, depois inglês. Os locales
suportados são `en`, `es`, `zh`, `ja`, `pt-BR` e `fr`.

## Referência completa de variáveis de ambiente

| Variável | Padrão | Significado |
| --- | --- | --- |
| `SERVER_TYPE` | `plex` | Tipo do servidor legado: `plex`, `jellyfin` ou `emby`. |
| `PLEX_URL` | — | URL base do Plex padrão. |
| `PLEX_TOKEN` | — | Token Plex (segredo). |
| `PLEX_CLIENT_ID` | gerado | ID estável para PIN/descoberta. |
| `JELLYFIN_URL` | — | URL base do Jellyfin. |
| `JELLYFIN_API_KEY` | — | Chave/token Jellyfin (segredo). |
| `EMBY_URL` | — | URL base do Emby. |
| `EMBY_API_KEY` | — | Chave/token Emby (segredo). |
| `TMDB_KEY` | — | Chave v3 ou bearer/JWT v4 do TMDB (segredo). |
| `KOMETA_ASSETS_DIR` | `./data/kometa` (`/kometa` no Docker) | Diretório dos YAMLs tipados sem config path. |
| `KOMETA_CONFIG_PATH` | — | Caminho absoluto do `config.yml`; vazio desativa o gerenciador. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` ou `own`. |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Instância Plex exata vinculada ao Kometa. |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Diretório relativo visto pelo runtime do Kometa; `.` usa nomes simples. |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`, `kometa` ou `both`. |
| `INCLUDED_SECTIONS` | todas | Chaves separadas por vírgula; ambiente substitui seleção por servidor. |
| `PROVIDER_MEDIUX` | ligado | Habilita MediUX. |
| `PROVIDER_TMDB` | ligado | Habilita imagens TMDB. |
| `PROVIDER_FANART` | desligado | Habilita Fanart.tv. |
| `PROVIDER_THEPOSTERDB` | desligado | Habilita ThePosterDB. |
| `FANART_KEY` | — | Chave Fanart.tv (segredo). |
| `THEPOSTERDB_USERNAME` | — | Usuário ou e-mail opcional do ThePosterDB para buscar com login. |
| `THEPOSTERDB_PASSWORD` | — | Senha da conta opcional do ThePosterDB (segredo, criptografada em repouso). |
| `TMDB_ARTWORK_LANGUAGE` | `any` | Artes do TMDB navegadas e autosselecionadas: `any`, `ui` (segue a interface) ou um código ISO 639-1 como `en`; valor inválido volta para `any`. |
| `MEDIUX_REQUEST_DELAY_MS` | `2000` | Intervalo entre requisições MediUX, ms. |
| `MEDIUX_CONCURRENCY` | `5` | Requisições MediUX simultâneas. |
| `HTTP_CACHE_TTL_DAYS` | `7` | TTL do cache HTTP em dias. |
| `APPLY_CONCURRENCY` | `4` | Itens simultâneos em aplicação em massa. |
| `SUGGEST_PRESELECT` | ligado | Calcula e mostra sugestões explícitas. |
| `INCREMENTAL_SYNC` | ligado | Ignora itens inalterados no sync normal. |
| `LIBRARY_DEFAULT_SORT` | `title` | `title`, `year`, `rating`, `runtime`, `recent` ou `added`. |
| `FUN_ENABLED` | desligado | Exibe as ferramentas FUN. |
| `THUMB_CACHE_TTL_DAYS` | `30` | Dias de validade das miniaturas em cache. |
| `THUMB_CACHE_MAX_MB` | `512` | Limite do cache de miniaturas em MB. |
| `APP_LANGUAGE` | automático | `en`, `es`, `zh`, `ja`, `pt-BR` ou `fr`. |
| `AUTH_MODE` | `disabled` | `disabled`, `local` ou `enabled`; substitui/bloqueia a UI. |
| `ADDRESS_HEADER` | — | Header do IP real atrás de proxy, por exemplo `x-forwarded-for`. |
| `XFF_DEPTH` | — | Número de proxies confiáveis. |
| `MAX_UPLOAD_MB` | `15` | Tamanho máximo de upload de imagem. |
| `LOG_DIR` | `./data/logs` (`/data/logs` no Docker) | Diretório do log rotativo. |
| `EVENT_RETENTION` | `2000` | Máximo de eventos no banco. |
| `DATABASE_URL` | `file:./data/posterpilot.db` | URL libsql do SQLite. |
| `PORT` | `3000` | Porta HTTP. |
| `APP_SECRET` | — | Deriva a chave e substitui `.app-key`. |
| `APP_KEY_FILE` | `./data/.app-key` | Caminho da chave gerada. |

Booleanos aceitam `1`, `true`, `on` ou `yes` sem diferenciar maiúsculas. Valores de
deploy como `DATABASE_URL`, `PORT`, `APP_SECRET`, `APP_KEY_FILE`, `ADDRESS_HEADER`,
`XFF_DEPTH` e `MAX_UPLOAD_MB` só podem vir do ambiente.
