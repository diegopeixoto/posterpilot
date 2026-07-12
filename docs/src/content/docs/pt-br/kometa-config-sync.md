---
title: Gerenciador do Kometa
description: Gerencie o config.yml do Kometa com prévia exata, confirmação, diffs redigidos, gravação atômica e restauração pré-visualizada.
---

Além de [exportar artwork como metadados](../usage/#como-o-kometa-consome-a-exportação),
o PosterPilot pode gerenciar o `config.yml` do Kometa na página **`/kometa`**. O
recurso é opcional: sem um caminho configurado, nenhum arquivo é lido ou gravado.

:::note[Dois arquivos]
- **`posterpilot.yml`** contém `url_poster` / `url_background` por TMDB e é escrito
  quando você aplica pelo destino Kometa.
- **`config.yml`** contém conexões, bibliotecas, coleções, overlays, operações e
  configurações do próprio Kometa.

Quando `KOMETA_CONFIG_PATH` existe, `posterpilot.yml` é gravado no mesmo diretório
de `config.yml` e referenciado pelo nome do arquivo. Não há um segundo caminho de
metadados.
:::

## Ativar e montar

| Variável | Padrão | Função |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | vazio | Caminho absoluto montado para `config.yml`; vazio desativa o gerenciador. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` preserva conteúdo não gerenciado; `own` regenera o arquivo inteiro. |
| `KOMETA_SERVER_INSTANCE_ID` | servidor legado | Instância Plex nomeada vinculada ao Kometa. |

Monte o diretório de configuração no contêiner com leitura/escrita. Veja
[Instalação](../installation/#montar-a-configuração-do-kometa) para um exemplo.
Kometa é exclusivo do Plex: Jellyfin/Emby e o empréstimo implícito de credenciais de
outra instância são recusados.

## Áreas gerenciadas

- **Conexões** para Plex, TMDB, Tautulli, Trakt, MDBList, OMDb, GitHub, Radarr,
  Sonarr, Notifiarr, Gotify, ntfy, AniDB e MAL. Segredos ficam mascarados.
- **Bibliotecas**, incluindo `metadata_files`, `collection_files`, overlays,
  operações e pequenos overrides por biblioteca.
- **Configurações e webhooks** globais escolhidos.
- **Raw config.yml** para o arquivo completo.
- **Backups** timestampados criados nas gravações.

No modo `merge`, apenas as chaves gerenciadas são alteradas; demais chaves e
comentários permanecem. Seções com anchors/aliases YAML são ignoradas e aparecem
como aviso, pois não podem ser reescritas cirurgicamente com segurança. A checagem
de consistência também avisa sobre charts/overlays sem o conector necessário.

## Prévia e confirmação estruturada

1. Salve caminho, modo e vínculo Plex.
2. Edite as seções que o PosterPilot deve gerenciar.
3. Escolha **Pré-visualizar alterações**.
4. Revise adições, mudanças, remoções, avisos e diff redigido.
5. Escolha **Confirmar sync pré-visualizado**.

O plano emitido pelo servidor expira, só pode ser usado uma vez e está vinculado ao
fingerprint do arquivo, à instância Plex, ao modo e ao conteúdo completo proposto.
Alterar qualquer entrada invalida a prévia. Arquivo, conteúdo ou token obsoleto,
alterado, expirado ou reutilizado não grava nada.

## Editor bruto

**Pré-visualizar alterações brutas** primeiro valida o YAML. Erro de parsing aparece
inline e não gera plano. **Confirmar salvamento bruto** é uma ação separada e grava
somente o texto vinculado à prévia. Mudar o texto ou o arquivo no disco exige nova
prévia.

## Backups e restauração

Cada gravação confirmada substitui o arquivo atomicamente e preserva a versão
anterior como `config.yml.posterpilot-bak-<timestamp>`. Para restaurar, escolha
**Pré-visualizar restauração**, revise o diff e confirme separadamente. Se o arquivo
atual ou backup mudar, a confirmação é recusada. O arquivo atual também é salvo antes
da substituição.

:::caution[Segredos em texto simples]
O Kometa exige token Plex e chave TMDB em texto simples no `config.yml`; portanto eles
também aparecem nos backups no disco. O PosterPilot os oculta na interface e no diff,
mas não pode criptografar o arquivo consumido pelo Kometa. Proteja o volume e suas
permissões.
:::

Leia [Segurança, verificação e desfazer](../safety/) para o contrato de mutação e
[Automação e recuperação](../automation-recovery/) para backups da aplicação.
