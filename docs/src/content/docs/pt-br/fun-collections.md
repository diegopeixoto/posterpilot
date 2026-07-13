---
title: Experimentos FUN e coleções
description: Use as ferramentas opcionais do FUN e os espaços de consistência de coleções sem contornar a revisão.
---

FUN e Coleções reutilizam a biblioteca sincronizada. Nenhuma dessas áreas inventa
identidade de mídia ou aplica artwork só porque encontrou um resultado ou família.

## Ativar o FUN

Defina `FUN_ENABLED=true` ou ative **FUN** em Configurações. Desativado, o item de
navegação some e as rotas `/fun` retornam não encontrado. Filtros usam o servidor
nomeado ativo, mostram a quantidade elegível exata e não ampliam intervalos inválidos.

## Sorteio da noite

Retorna até três opções distintas. Filtre por biblioteca, tipo, gênero, ano, assistido,
duração, nota mínima, recência ou preset. A URL guarda seed, filtros normalizados e
IDs: recarregar, voltar ou compartilhar mantém a mesma ordem enquanto os itens existirem.

Novo sorteio mantém filtros e troca o seed. O histórico recente da sessão é evitado
quando há alternativas; em conjuntos pequenos, apenas essa exclusão é relaxada. O modo
cego esconde a identidade até revelar, e cápsulas exibem a regra antes do sorteio.

![Escolhedor da noite do FUN no PosterPilot com filtros de biblioteca, tipo, gênero, ano, duração e avaliação antes de sortear um título](/posterpilot/screenshots/fun-picker.webp)

## Poster Match

Requer um título com pelo menos dois pôsteres. Escolha entre duas imagens por rodada
até restar uma em uma chave finita. Imagens quebradas são retiradas quando possível.
A vencedora mantém a origem e é apenas **preparada**; use a prévia normal para aplicar.

## Galeria ambiente

A galeria em tela cheia mostra pôsteres, backgrounds ou ambos, com filtros. Controles
de anterior/próximo, pausar/continuar, intervalo e sair também funcionam por teclado.
Com `prefers-reduced-motion: reduce`, a reprodução abre pausada até ação explícita.
Imagens que falham são ignoradas na sessão.

## Planejador de sessão

Escolha dois ou três filmes e um orçamento de duração. Só entram filmes distintos com
duração conhecida, respeitando biblioteca, gênero, assistido e nota. Nenhum plano
excede o orçamento. **Planejar de novo** mantém as restrições e muda o seed.

## Coleções e franquias

Coleções são isoladas por servidor e surgem de membros nativos ou do identificador
`belongs_to_collection` do TMDB. Nomes iguais em servidores diferentes não se misturam,
e semelhança de título nunca cria membros.

O detalhe mostra origem, membros TMDB indisponíveis como contexto, artwork atual e
preparada, evidências de provedor/set/autor/idioma/família e cobertura explicável.
Origem desconhecida não é tratada como incompatibilidade deliberada.

## Sugestões coordenadas e exceções

Quando evidências verificáveis cobrem vários membros, famílias são ordenadas por
cobertura e score. A sugestão lista membros/slots cobertos e descobertos; prepará-la
muda só os cobertos. Cada membro e slot pode ser substituído ou limpo. Sem evidência
comum, o PosterPilot oferece candidatos individuais sem fingir um conjunto coordenado.

## Aplicar e desfazer coleções

Preparar na coleção ainda é preparação comum de itens. Uma aplicação coordenada exige
prévia exata que congela membros, slots, destinos, seleções, estado atual e ignorados.
Mudança de membros/seleção invalida o plano. Resultados são por membro e destino.

O desfazer de um grupo exige a revisão correspondente e uma nova prévia; revisões
individuais podem ser tratadas no histórico do item. Se a interface atual não expuser
uma ação coordenada para uma capacidade, abra o membro e use Revisão/aplicar/desfazer;
não presuma que preparar gravou algo.

Leia [Segurança, verificação e desfazer](../safety/) antes de aplicar e
[Uso](../usage/) para Revisão e jobs.
