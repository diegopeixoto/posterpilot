---
title: Gerenciador do Kometa
description: Gerencie o config.yml do Kometa com prévia exata, confirmação, diffs redigidos, gravação atômica e restauração pré-visualizada.
---

Além de [exportar artwork como metadados](../usage/#como-o-kometa-consome-a-exportação),
o PosterPilot pode gerenciar o `config.yml` do Kometa na página **`/kometa`**. O
recurso é opcional: sem um caminho configurado, nenhum arquivo é lido ou gravado.

:::note[Configuração e metadados têm funções diferentes]
- **`posterpilot-movies.yml`** contém artwork de filmes no namespace TMDB, com
  IMDb como fallback quando não há um ID TMDB.
- **`posterpilot-shows.yml`** contém artwork de séries, temporadas e episódios no
  namespace TVDB, com IMDb como fallback quando não há TVDB. O tipo registrado no
  PosterPilot decide o namespace; uma chave numérica nunca é usada para adivinhar.
- **`config.yml`** contém conexões, bibliotecas, coleções, overlays, operações e
  configurações do próprio Kometa.
:::

## Ativar e montar

| Variável | Padrão | Função |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | vazio | Caminho absoluto montado para `config.yml`; vazio desativa o gerenciador. |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` preserva conteúdo não gerenciado; `own` regenera o arquivo inteiro. |
| `KOMETA_SERVER_INSTANCE_ID` | servidor legado | Instância Plex nomeada vinculada ao Kometa. |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Diretório relativo visto pelo runtime do Kometa; use `.` (ou limpe o campo na UI) para nomes simples. |

Monte o diretório de configuração no contêiner com leitura/escrita. Veja
[Instalação](../installation/#montar-a-configuração-do-kometa) para um exemplo.
Kometa é exclusivo do Plex: Jellyfin/Emby e o empréstimo implícito de credenciais de
outra instância são recusados.

O caminho físico não é a referência do Kometa. O PosterPilot grava os dois arquivos
lado a lado no diretório de saída configurado. Já os valores `file:` precisam
descrever esses arquivos pela visão do **runtime do Kometa**. Com o prefixo padrão,
as referências são `config/posterpilot-movies.yml` e
`config/posterpilot-shows.yml`, mesmo quando outro nome de mount deixa os arquivos
fisicamente ao lado de `config.yml`. O prefixo é relativo: não use caminho do host,
caminho absoluto do contêiner, URL ou nome de arquivo YAML.

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

## Migrar o posterpilot.yml legado

:::caution[Aguarde a release]
Não renomeie, divida nem reconecte `posterpilot.yml` manualmente. Aguarde a release
do PosterPilot que contém esta migração aparecer na página de
[Releases](https://github.com/diegopeixoto/posterpilot/releases), atualize a sua
instância e só então use a migração exibida em `/kometa`.
:::

Instalações existentes podem ter filmes e séries no mesmo `posterpilot.yml`, como
se ambos compartilhassem o namespace TMDB. A migração normaliza esse arquivo:

1. **Prévia.** O PosterPilot cruza o legado com a biblioteca Plex vinculada e com
   seu histórico exato de revisões. A prévia exibe estrutura, fingerprints e
   contagens, nunca URLs de artwork ou credenciais. Filmes usam TMDB e, sem ele,
   IMDb; séries usam TVDB e, sem ele, IMDb.
2. **Ambiguidades.** Uma chave numérica pode colidir entre tipos, então o
   PosterPilot não adivinha. Entradas sem prova ficam separadas. Você pode corrigir
   o match ou aceitar explicitamente a ambiguidade, concluir a migração e reaplicar
   essas capas no PosterPilot; a reaplicação grava no arquivo tipado correto.
   Conteúdo conflitante já presente nos arquivos de destino também não é sobrescrito.
3. **Confirmação.** Um journal durável e backups protegidos são gravados primeiro.
   O PosterPilot grava e verifica **os dois** arquivos tipados e só depois altera
   `config.yml`. O `posterpilot.yml` legado nunca é alterado nem apagado.
4. **Retry/resume.** Depois de uma interrupção, repetir a operação retoma o
   checkpoint verificado, sem reclassificar entradas. Se algum arquivo não tiver o
   fingerprint da prévia nem o resultado já gravado, a operação para para nova
   revisão em vez de sobrescrevê-lo.

Quando consegue provar que gerencia as entradas `metadata_files`, o PosterPilot
atualiza `config.yml` automaticamente. Caso contrário, ele grava os arquivos
tipados e mostra um guia exato por biblioteca. **Não cole esse bloco parcial de
`libraries:` por cima da sua configuração.** Em cada biblioteca indicada,
substitua somente o item de `metadata_files` cujo basename de `file` seja
`posterpilot.yml`; se ele não existir, adicione uma vez o item tipado exibido.
Preserve todos os itens irmãos e configurações da biblioteca e termine com
exatamente uma referência tipada e nenhuma referência legada ativa. Confira os caminhos pela visão do runtime
do Kometa antes de reconhecer a conclusão no PosterPilot. Esse reconhecimento
registra a sua confirmação; não significa que o PosterPilot verificou a edição
manual.

**Rollback** restaura o backup protegido de `config.yml` somente se a configuração
atual ainda for exatamente o resultado da migração. Os arquivos tipados e o legado
são preservados, portanto o artwork gerado não é descartado e uma nova tentativa
não precisa reconstruí-lo.

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
