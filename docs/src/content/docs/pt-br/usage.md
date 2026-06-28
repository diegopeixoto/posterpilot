---
title: Uso
description: Execute o assistente de configuração, sincronize uma biblioteca, encontre capas em vários provedores, aplique-as via API do servidor de mídia ou exportação do Kometa, monte conjuntos personalizados, filtre e ordene a biblioteca e leia o log de Atividade.
---

Esta página percorre o fluxo de trabalho do dia a dia depois que o PosterPilot está
[instalado](/posterpilot/pt-br/installation/) e
[configurado](/posterpilot/pt-br/configuration/).

## Assistente de primeira instalação

Em uma instalação nova, um banner aponta você para o assistente em `/setup`. Ele conduz você
por seis passos em ordem, persistindo cada um conforme você avança:

1. **Idioma** — escolha a localidade da interface.
2. **Servidor de mídia** — escolha Plex, Jellyfin ou Emby. Para o Plex você pode entrar com
   um PIN (o PosterPilot mostra um código e um link de autorização, depois armazena o token
   obtido para você) e escolher uma conexão local/remota descoberta. Jellyfin e Emby recebem
   uma URL de servidor e permitem que você **entre com seu nome de usuário e senha** — o
   PosterPilot os troca por um token de acesso, de modo que você nunca precisa caçar uma chave
   de API (a senha é usada apenas para essa única requisição e nunca é armazenada; colar uma
   chave manualmente permanece disponível como alternativa). Um botão **Testar** verifica a conexão.
3. **TMDB** — cole uma chave de API do TMDB (um link para as configurações de API do TMDB é fornecido).
4. **Provedores** — alterne os provedores de artwork (MediUX, TMDB, Fanart.tv,
   ThePosterDB) e informe uma chave do Fanart.tv se você a usar.
5. **Bibliotecas** — uma vez conectado, o assistente lista suas bibliotecas de filmes e séries;
   marque as que devem ser sincronizadas (todas selecionadas por padrão, o que também captura
   bibliotecas que você adicionar depois).
6. **Primeira sincronização** — execute a sincronização inicial e então vá para o Dashboard.

O assistente é **pulável** a qualquer momento (o link _Pular_ vai direto para o
Dashboard) — tudo o que ele cobre também está disponível em **Configurações**.

## Sincronizar uma biblioteca

Uma sincronização puxa suas bibliotecas de filmes e séries do servidor de mídia ativo para
o cache local do PosterPilot e resolve cada título para um id do TMDB para que os provedores de artwork
possam ser consultados.

1. Certifique-se de que as credenciais do tipo de servidor ativo e uma chave do TMDB estejam configuradas.
   Uma sincronização é bloqueada (com uma mensagem clara sobre o que está faltando) se elas não estiverem.
2. Opcionalmente, restrinja quais seções são sincronizadas a partir da lista **Bibliotecas para
   sincronizar** (no assistente ou em Configurações → Servidor de mídia) ou com `INCLUDED_SECTIONS`
   — deixe-a vazia para sincronizar todas as seções de filmes e séries, incluindo as que você
   adicionar depois.
3. Execute a sincronização a partir do **Dashboard** (o botão **Sincronizar**). Ela roda como um
   job em segundo plano com progresso ao vivo exibido ali mesmo; os cartões de estatísticas
   (itens, filmes, séries, resolvidos, com MediUX, aplicados) sobem conforme ela roda.

Cada item retorna com seu título, ano, tipo, GUIDs externos (tmdb/imdb/tvdb
quando presentes) e pôster atual. Um item sem GUID externo ainda é listado,
mas sinalizado como não resolvível para busca em provedores em vez de descartado.

Sincronizações repetidas são **incrementais** por padrão: o PosterPilot compara cada item com
o timestamp de última modificação do servidor de mídia e só re-resolve e reenriquece os que
mudaram desde a sincronização anterior, de modo que um rescan de rotina é muito mais rápido
que o primeiro. Uma **varredura completa** que reprocessa tudo permanece disponível, e você
pode desligar a sincronização incremental por completo (veja
[Configuração → Desempenho e ajustes](/posterpilot/pt-br/configuration/#desempenho-e-ajustes)).

## O mural da biblioteca

A biblioteca sincronizada é renderizada como uma grade de pôsteres com uma barra de ferramentas
no estilo do Notion. Você pode:

- **Buscar** por título.
- **Filtrar** a partir do popover **Filtrar**: tipo de mídia (filme / série), classificação
  mínima, gênero, pôster ausente, disponibilidade no MediUX (tem candidatos), estado de
  alteração (não alterado / ainda com o pôster padrão) e estado ignorado. O botão Filtrar
  mostra um selo com o número de facetas ativas.
- **Ordenar** a partir do popover **Ordenar** por título, ano de lançamento, classificação,
  duração ou alterado mais recentemente, com um alternador de crescente/decrescente independente.
- Cada filtro ativo e a ordenação aparecem como **chips removíveis** abaixo da barra de
  ferramentas — clique no ✕ de um chip para descartar apenas aquele, ou em **Limpar tudo** para
  redefinir tudo.
- Alterne a **aplicação automática** (o botão ⚡): ligada, cada alteração navega imediatamente;
  desligada, as alterações ficam preparadas até você clicar em **Aplicar**. A escolha é lembrada.
- **Ignorar** um item que você quer deixar intocado — itens ignorados são pulados pela
  descoberta, pela aplicação e pela seleção automática, são marcados visualmente no mural e
  podem ser incluídos ou excluídos pelo popover Filtrar. Desative isso novamente a qualquer
  momento para trazer o item de volta ao fluxo.
- Ver um **banner de destaque** — um backdrop de um item alterado recentemente acima do
  mural assim que ao menos uma capa tiver sido aplicada.

Cada bloco exibe a classificação do item e um selo de status (por exemplo, disponível no MediUX,
alterado), com o título e o ano revelados ao passar o cursor.

## Encontrar capas

Abra um item para ver sua visão de detalhes: um hero com backdrop e o logo do item (ou seu
título quando não há logo), classificação, ano, duração (ou contagens de temporada/episódio para
séries), gêneros e sinopse, além do elenco principal.

- Se as capas ainda não foram descobertas, use **Encontrar capas** para rodar a descoberta para
  aquele item.
- A descoberta distribui a busca entre todos os provedores habilitados e armazena a união de seus
  candidatos, cada um marcado com seu provedor.
- Os candidatos são agrupados **primeiro por provedor, depois por conjunto**. Cada conjunto mostra sua
  atribuição ao uploader com o pôster e o backdrop juntos. Para séries, a visão
  também apresenta conjuntos de pôsteres de temporada e conjuntos de title cards.
- Seções de provedor, cards de conjunto individuais e (para séries) grupos de temporada são
  **recolhíveis**. No primeiro carregamento, o primeiro provedor e seu primeiro conjunto ficam
  expandidos e todo o resto fica recolhido; suas escolhas de recolhido/expandido persistem no
  navegador entre recarregamentos e conforme você navega entre itens.
- Quando o **artwork sugerido** está habilitado, o candidato com a maior pontuação para cada slot
  é pré-selecionado como uma sugestão claramente marcada que você pode aceitar ou substituir.
  Os candidatos são pontuados por qualidade do provedor, resolução e ajuste de proporção; ajuste
  os pesos — ou desligue a pré-seleção — em Configurações (veja
  [Configuração → Desempenho e ajustes](/posterpilot/pt-br/configuration/#desempenho-e-ajustes)).

Você pode preparar um conjunto inteiro ("usar este conjunto"), ou pegar um pôster individual de um
conjunto e um fundo de outro — os dois slots são independentes.

## Artwork de temporada e episódio

Para uma série, o artwork é preparado por slot, de modo que a capa da série, o pôster de cada
temporada e o title card de cada episódio são independentes entre si:

- O artwork de um conjunto é organizado em um **grupo da série** (pôster e fundo) e um
  **grupo por temporada**. Cada grupo de temporada contém o pôster daquela temporada e os
  title cards de seus episódios. (Existe um slot de fundo de temporada no modelo, mas ele não é
  exibido, porque nenhum provedor atualmente fornece fundos de temporada.)
- Selecionar um candidato dentro de um slot de temporada ou episódio prepara apenas aquele slot,
  sem tocar no nível da série nem em nenhum outro slot. Reselecionar o candidato já preparado em
  um slot o limpa novamente.
- **Usar este conjunto** preenche de uma vez todos os slots que o conjunto cobre — série, cada
  temporada e cada episódio — combinados por número de temporada e episódio. Você pode então
  substituir qualquer slot individual e manter o resto do conjunto preparado.

O construtor fixo resume tudo o que está preparado no momento — o pôster/fundo da série mais as
contagens de temporadas e episódios preparados — e um único **Aplicar** grava tudo em uma única
ação (veja [Aplicar uma capa](#aplicar-uma-capa)).

## Aplicar uma capa

Aplique uma seleção preparada com o método que escolher, selecionável por ação de aplicação
com um padrão configurável (`DEFAULT_APPLY_METHOD`, padrão `both`):

- **Servidor de mídia (direto).** Envia o pôster (e o fundo) através do
  provedor de servidor de mídia ativo e bloqueia o campo para que os agentes automáticos do servidor
  não o sobrescrevam. A alteração é efetivamente instantânea. Registrada como uma
  aplicação no servidor com o tipo do provedor.
- **Exportação do Kometa.** Grava YAML compatível com Kometa/PMM — `url_poster` (e
  `url_background` quando um fundo é preparado), indexado pelo id do TMDB — no
  diretório de assets configurado do Kometa, sem contatar o servidor de mídia. Sua
  instância existente do Kometa aplica as capas na próxima execução. Reaplicar atualiza
  a entrada no lugar em vez de duplicá-la.
- **Ambos.** Realiza o envio direto _e_ grava o YAML do Kometa, registrando cada
  resultado de forma independente para que uma falha parcial fique visível.

Uma única aplicação grava **cada slot preparado** — série, temporadas e episódios — com o(s)
método(s) escolhido(s). Para o envio direto, o PosterPilot resolve cada filho de temporada e
episódio no servidor de mídia por número e envia para ele; um slot preparado cuja temporada ou
episódio não tem um filho correspondente no servidor é pulado e reportado em vez de falhar a
aplicação inteira, e a falha de um filho nunca aborta os demais. A exportação do Kometa aninha
os pôsteres de temporada preparados sob `seasons:` (indexados pelo número da temporada) e os
title cards de episódio preparados sob `episodes:` (indexados pelo número do episódio), ao lado
dos `url_poster` / `url_background` do nível da série. Um **fundo** de temporada é aplicado
apenas pelo método direto — ele é omitido do YAML.

Toda aplicação — sucesso ou falha — é registrada com o item, a URL do asset, o(s)
método(s), o resultado e o timestamp, de modo que o histórico é consultável e a reaplicação é
detectável.

### Como o Kometa consome a exportação

O PosterPilot grava um único arquivo de metadados (padrão `posterpilot.yml`) em
`KOMETA_ASSETS_DIR`, indexado pelo id do TMDB com entradas `url_poster` / `url_background`.
Adicione esse arquivo à config de biblioteca do seu Kometa (por exemplo, sob
`metadata_path` / `metadata_files`) para que o Kometa aplique as capas na próxima execução.

## Reverter

Toda capa aplicada é reversível a partir da visão de detalhes do item:

- **Reverter para o original** reverte o artwork no nível da série **e cada temporada e episódio
  aplicados** em uma única ação, restaurando o que o servidor de mídia tinha antes de o
  PosterPilot alterá-lo.
- Cada grupo de temporada tem seu próprio controle **Reverter temporada** que reverte apenas o
  pôster/fundo daquela temporada e os title cards de seus episódios, deixando o artwork do nível
  da série e das outras temporadas no lugar.

As reversões re-resolvem os filhos de temporada e episódio por número, da mesma forma que a
aplicação faz.

## Conjuntos personalizados

A visão de detalhes do item tem um **construtor** persistente e fixo, com um slot de pôster e um
slot de fundo que juntos formam um "conjunto" personalizado:

- Clicar em um candidato a pôster o roteia para o slot de pôster; clicar em um candidato a fundo
  o roteia para o slot de fundo — automaticamente, por tipo.
- Cada slot também pode ser preenchido a partir de uma **URL de imagem colada** ou um **arquivo de imagem
  enviado**.
- Aplicar o construtor aplica ambas as peças preparadas em uma única ação via o método escolhido.

:::note[Envios são apenas para o servidor]
Uma capa personalizada baseada em URL pode ser aplicada tanto via servidor de mídia quanto via Kometa. Um
**arquivo enviado** só pode ser aplicado via servidor de mídia — um envio binário
não pode ser expresso como uma URL de YAML do Kometa, então ele é omitido da exportação do Kometa
e a limitação é tornada visível em vez de gravar uma entrada inválida.
:::

## Ações em massa

Selecione vários itens e rode a descoberta e/ou a aplicação na seleção como um
único job em segundo plano. A aplicação em massa com seleção automática descobre (se necessário),
seleciona automaticamente e aplica capas para cada item selecionado, com progresso ao vivo.

A seleção automática pontua cada candidato entre todos os provedores habilitados — combinando
qualidade do provedor, resolução e ajuste de proporção — e escolhe o pôster com a maior pontuação
(e um fundo quando disponível) para cada item, a mesma pontuação que orienta a pré-seleção
sugerida na visão do item. Itens ignorados ficam de fora da seleção.

Antes de uma aplicação em massa rodar, uma **prévia de simulação** (dry-run) resume exatamente o
que aconteceria — os envios planejados, as exportações do Kometa e quaisquer itens ou slots que
seriam pulados — para que você confirme antes que algo seja gravado. A aplicação em massa então
processa os itens **concorrentemente** (limitada pela configuração de concorrência de aplicação),
de modo que lotes grandes terminam mais rápido, com o mesmo progresso ao vivo e cancelamento.

## Dashboard e jobs

O **Dashboard** é a base. Ele mostra os cartões de estatísticas da biblioteca, o botão
**Sincronizar** e quaisquer jobs em execução com uma **barra de progresso ao vivo** (atualizando
via Server-Sent Events, sem necessidade de refresh) que você pode **cancelar**. O selo de
navegação ao lado de Dashboard reflete quantos jobs estão ativos. Abaixo disso, uma tabela de
**Jobs recentes** lista os jobs mais recentes com seu tipo, contagens processado/total e status
final. Não há uma página de Jobs separada — tanto o progresso ao vivo quanto o histórico recente
ficam no Dashboard.

## Log de atividade

O log granular de eventos fica em **Configurações → Atividade**. Todo evento operacional é
registrado ali (e espelhado no console do contêiner e em um arquivo de log rotativo). Você pode:

- Filtrar por nível — **Todos / Info / Aviso / Erro**.
- Navegar pelo histórico com **Carregar mais**.
- **Limpar atividade** para apagar a tabela do app (isso não exclui o arquivo de log em disco).

A tabela é limitada a `EVENT_RETENTION` linhas (padrão `2000`); linhas mais antigas são removidas
automaticamente. Veja
[Configuração → Logging e log de atividade](/posterpilot/pt-br/configuration/#logging-e-log-de-atividade)
para os detalhes do arquivo de log e da retenção.
