---
title: Administração e migração multi-servidor
description: Atualize instalações de um servidor, gerencie instâncias nomeadas e entenda isolamento e aplicação entre servidores.
---

O PosterPilot gerencia várias instâncias Plex, Jellyfin e Emby, mantendo bibliotecas,
itens, jobs, revisões, coleções, revisão e automações estritamente separadas.

## Antes de atualizar

1. Aguarde jobs de mutação terminarem.
2. Copie todo o volume `/data`, incluindo banco/WAL, snapshots, backups e `.app-key`.
   Se disponível, crie e valide também um backup manual da aplicação.
3. Registre tipo, URL e origem da credencial atual; preserve `APP_SECRET` ou `.app-key`.
4. Atualize a imagem e reinicie normalmente. Não crie banco vazio nem rode SQL manual.

## O que a migração faz

A migração cria uma instância protegida **Servidor padrão** e associa os registros
existentes ao escopo estável `legacy-default`. Na inicialização, a conexão legada
efetiva — ambiente ainda tem precedência — é materializada e ativada.

O processo é transacional e idempotente. IDs, candidatos, seleções, ignorados, jobs,
revisões, histórico e bibliotecas em cache permanecem; não é preciso resync destrutivo.
Uma instalação nova sem configuração continua no assistente sem criar servidor falso.

:::note
`SERVER_TYPE`, `PLEX_*`, `JELLYFIN_*` e `EMBY_*` descrevem a conexão padrão protegida.
Servidores adicionais são criados em Configurações e guardam credenciais próprias;
as variáveis não definem uma lista arbitrária de instâncias.
:::

## Verificações depois do upgrade

1. Em **Configurações → Servidores**, confira tipo, URL, credencial e marcador ativo.
2. Teste a conexão e rode **Diagnósticos**.
3. Confira Biblioteca, Revisão, Coleções, Dashboard/jobs e a linha do tempo de um item.
4. Confirme bibliotecas selecionadas e o vínculo Plex do Kometa.
5. Rode sync incremental; use rescan completo apenas para reler tudo — revisões são preservadas.

Se migração ou descriptografia falhar, pare o novo contêiner e restaure o volume
anterior ou o fluxo validado de restauração. Não execute sobre banco parcialmente copiado.

## Adicionar e alternar servidores

Em **Configurações → Servidores**, informe nome único, tipo, URL e credencial reutilizável,
teste e adicione. Plex usa token; Jellyfin/Emby usam chave ou token. O navegador nunca
recebe o segredo armazenado.

Com duas instâncias ativas, use o seletor ou **Tornar ativo**. Páginas recarregam no
escopo escolhido; filtros e views de revisão inválidos não atravessam servidores.
Jobs e automações mantêm o servidor nomeado. Trabalho independente pode rodar em paralelo;
capacidades de artwork são específicas por instância e versão.

![Configurações de Servidor de mídia do PosterPilot listando dois servidores conectados, o Plex padrão ativo e um Jellyfin saudável, com ações de testar, desativar e desconectar](/posterpilot/screenshots/settings-servers.webp)

## Vínculo do Kometa

Kometa é específico do Plex. Defina `KOMETA_SERVER_INSTANCE_ID` ou escolha uma instância
Plex em Configurações. Prévia e confirmação validam esse vínculo; Jellyfin/Emby e o
empréstimo implícito de outra credencial Plex são recusados.

## Aplicação entre servidores

É sempre explícita e exige identificador TMDB, IMDb ou TVDB exato compartilhado; título
parecido não basta. A prévia lista servidor/item, capacidade, slot, estado atual,
seleção e ignorados. Cada destino recebe revisão e verificação independentes.

Aplicar normalmente nunca propaga. Quando a interface não expuser essa seleção, a API
de prévia/confirmação é destinada a integrações controladas; não troque o servidor ativo
entre prévia e confirmação para imitá-la.

## Desativar, desconectar ou expurgar

- **Desativar** bloqueia mutações e preserva credencial, cache e histórico.
- **Desconectar** remove a credencial, desativa automações e mantém o histórico.
- **Expurgar** só aparece após desconexão, mostra impacto exato e exige confirmação
  separada; jobs de mutação ativos bloqueiam a ação.

O servidor padrão migrado é marcado **Legado** e protegido contra edição/expurgo comum.
Antes de qualquer expurgo, crie backup e revise itens, jobs, revisões, coleções,
automações e snapshots afetados.

Veja [Automação e recuperação](../automation-recovery/) e
[Configuração](../configuration/).
