---
title: Uso
description: Sincronize uma biblioteca, encontre capas, aplique-as via API do servidor de mídia ou exportação do Kometa, monte conjuntos personalizados e use os filtros e a ordenação da biblioteca.
---

Esta página percorre o fluxo de trabalho do dia a dia depois que o PosterPilot está
[instalado](/posterpilot/pt-br/installation/) e
[configurado](/posterpilot/pt-br/configuration/).

## Sincronizar uma biblioteca

Uma sincronização puxa suas bibliotecas de filmes e séries do servidor de mídia ativo para
o cache local do PosterPilot e resolve cada título para um id do TMDB para que os provedores de artwork
possam ser consultados.

1. Certifique-se de que as credenciais do tipo de servidor ativo e uma chave do TMDB estejam configuradas.
   Uma sincronização é bloqueada (com uma mensagem clara sobre o que está faltando) se elas não estiverem.
2. Opcionalmente, restrinja quais seções são sincronizadas com `INCLUDED_SECTIONS` (ou o
   campo equivalente em Configurações) — deixe-o vazio para sincronizar todas as seções de filmes e séries.
3. Execute a sincronização. Ela roda como um job em segundo plano com progresso ao vivo.

Cada item retorna com seu título, ano, tipo, GUIDs externos (tmdb/imdb/tvdb
quando presentes) e pôster atual. Um item sem GUID externo ainda é listado,
mas sinalizado como não resolvível para busca em provedores em vez de descartado.

## O mural da biblioteca

A biblioteca sincronizada é renderizada como uma grade de pôsteres. Você pode:

- **Buscar** por título.
- **Filtrar** por tipo de mídia (filme / série), pôster ausente, disponibilidade no MediUX
  (tem candidatos), estado de alteração (não alterado / ainda com o pôster padrão),
  classificação mínima e gênero.
- **Ordenar** por título, ano de lançamento, classificação, duração ou alterado mais recentemente.
- Ver um **banner de destaque** — um backdrop de um item alterado recentemente acima do
  mural assim que ao menos uma capa tiver sido aplicada.

Cada bloco exibe a classificação do item e um selo de status (por exemplo, disponível no MediUX,
alterado), com o título e o ano revelados ao passar o cursor.

## Encontrar capas

Abra um item para ver sua visão de detalhes: um hero com backdrop e o logo do item (ou seu
título quando não há logo), classificação, ano, duração (ou contagens de temporada/episódio para
séries), gêneros e sinopse.

- Se as capas ainda não foram descobertas, use **Encontrar capas** para rodar a descoberta para
  aquele item.
- A descoberta distribui a busca entre todos os provedores habilitados e armazena a união de seus
  candidatos, cada um marcado com seu provedor.
- Os candidatos são agrupados **primeiro por provedor, depois por conjunto**. Cada conjunto mostra sua
  atribuição ao uploader com o pôster e o backdrop juntos. Para séries, a visão
  também apresenta conjuntos de pôsteres de temporada e conjuntos de title cards.

Você pode preparar um conjunto inteiro ("usar este conjunto"), ou pegar um pôster individual de um
conjunto e um fundo de outro — os dois slots são independentes.

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

Toda aplicação — sucesso ou falha — é registrada com o item, a URL do asset, o(s)
método(s), o resultado e o timestamp, de modo que o histórico é consultável e a reaplicação é
detectável.

### Como o Kometa consome a exportação

O PosterPilot grava um único arquivo de metadados (padrão `posterpilot.yml`) em
`KOMETA_ASSETS_DIR`, indexado pelo id do TMDB com entradas `url_poster` / `url_background`.
Adicione esse arquivo à config de biblioteca do seu Kometa (por exemplo, sob
`metadata_path` / `metadata_files`) para que o Kometa aplique as capas na próxima execução.

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

A seleção automática funciona entre os candidatos de todos os provedores habilitados — ela escolhe um
pôster primário (e um fundo quando disponível) usando uma ordem determinística de preferência de
provedor, recorrendo ao próximo provedor quando o mais preferido não tem pôster para o item.

## Visão de jobs

A visão de jobs lista os jobs ativos e passados, com progresso ao vivo para os jobs em execução
(atualizando via Server-Sent Events sem um refresh manual) e o status final para os
concluídos.
