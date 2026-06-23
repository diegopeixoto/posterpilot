---
title: Traduzindo
description: Ajude a traduzir a interface do PosterPilot para o seu idioma pelo Weblate — sem necessidade de codificação.
---

Ajude a traduzir a interface para o seu idioma! Nenhuma codificação é necessária. Esta página espelha
a seção de Tradutores do
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators).

A interface é localizada em inglês (o padrão), espanhol, chinês simplificado,
japonês e português do Brasil, com **fallback para o inglês por chave**, de modo que qualquer
string deixada sem tradução sempre mostra um inglês legível — nunca uma chave bruta.

## Fonte da verdade

Toda string voltada ao usuário fica em um catálogo JSON por localidade sob `messages/` —
um arquivo por idioma, indexado por um id de mensagem estável:

- `messages/en.json` — o catálogo **fonte** completo (todos os ids de mensagem)
- `messages/es.json` — espanhol
- `messages/zh.json` — chinês simplificado
- `messages/ja.json` — japonês
- `messages/pt-BR.json` — português do Brasil

Os outros catálogos contêm traduções e podem ser parciais. Qualquer id ausente ou deixado
vazio em uma localidade de destino recai para o seu texto em inglês. Novas strings em inglês adicionadas
ao `en.json` surgem automaticamente como entradas não traduzidas para cada idioma.

## Via Weblate (recomendado)

As traduções são gerenciadas pelo [Weblate](https://hosted.weblate.org/engage/posterpilot/),
uma plataforma livre de tradução web, usando um fluxo de trabalho baseado em git:

1. Abra o [projeto PosterPilot no Weblate](https://hosted.weblate.org/engage/posterpilot/)
   e entre — uma conta gratuita funciona.
2. Escolha seu idioma e traduza as strings não traduzidas diretamente no navegador.
3. O Weblate propõe as alterações de volta ao repositório como commits/PRs via git; um
   mantenedor as mescla.

[![Status da tradução](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

O componente do Weblate é configurado em relação a `messages/*.json` com `en` como
idioma fonte e formato JSON (chave-valor), de modo que ele sempre reflete o catálogo
fonte atual.

## Via um pull request direto

Você também pode editar um catálogo manualmente: copie uma nova chave de `messages/en.json` para
`messages/<locale>.json`, traduza o valor e abra um PR.

- Mantenha as chaves idênticas à fonte; traduza apenas os **valores**.
- Deixe os nomes próprios técnicos sem tradução: **Plex, MediUX, TMDB, Kometa,
  Fanart.tv**.

## Como o idioma ativo é escolhido

O idioma ativo é resolvido por requisição: (1) sua preferência persistida (definida
pelo seletor do cabeçalho ou em Configurações), depois (2) o `Accept-Language` do seu navegador,
depois (3) inglês. Veja [Configuração → Idioma](/posterpilot/pt-br/configuration/#idioma)
para detalhes.

Ao contribuir com traduções, você concorda que suas contribuições são licenciadas sob a
[licença MIT](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE) do projeto.
