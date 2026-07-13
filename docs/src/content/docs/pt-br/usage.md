---
title: Uso
description: Sincronize, revise, corrija matches, prepare artwork, confirme planos exatos, acompanhe jobs e desfaça por revisões.
---

Este é o fluxo diário depois de [instalar](../installation/) e
[configurar](../configuration/) o PosterPilot.

## Setup e primeiro sync

O assistente `/setup` percorre idioma, servidor, TMDB, provedores, bibliotecas e o
primeiro sync. Plex oferece PIN/descoberta; Jellyfin/Emby aceitam usuário/senha ou
chave. Cada etapa só avança depois de resposta válida. **Pular** sai do assistente;
o primeiro sync acompanha o job até sucesso ou mostra falha e nova tentativa.

## Sincronizar e fazer rescan

No Dashboard, **Sync** importa filmes/seriados do servidor nomeado ativo, resolve IDs
TMDB e atualiza metadados. `INCLUDED_SECTIONS` ou a lista de bibliotecas limita o
escopo. Itens sem GUID continuam visíveis como não resolvidos.

Sync normal é incremental por padrão. **Rescan completo** relê todos os itens,
reconcilia removidos e detecta artwork alterada externamente, sem apagar snapshots e
revisões nem aplicar capas automaticamente.

Jobs mostram fila, fase, progresso, tentativas e resultado ao vivo. Recarregar a
página não os cancela; pedidos equivalentes reutilizam o job ativo.

## Biblioteca em escala

A Biblioteca pesquisa e filtra no servidor por tipo, biblioteca, ativo/ignorado,
missing poster, candidatos gerais, candidatos MediUX, mudança, nota e gênero. Ordene
por título, ano, nota, duração, mudança recente ou data de adição. A URL preserva
filtros/sort ao abrir um item e voltar.

Para operações em massa, use **Selecionar página** ou **Selecionar todos os
resultados**, veja carregados versus total e limpe quando necessário. Todos os
resultados são materializados pelo filtro exato; mudar a consulta invalida a seleção.

## Caixa de entrada de Revisão

**Revisão** agrupa estados acionáveis: novo, não resolvido, sem candidatos, sugestão
pronta, preparado, falha parcial, mudança externa, ignorado e concluído. Filtre,
ordene e salve views. Ao abrir um item, anterior/próximo/voltar preservam o contexto.

Compare artwork **atual**, **sugerida** e **preparada** por slot. Aceitar sugestão é
explícito; nada é persistido apenas por abrir a página. Atalhos de teclado listados na
interface não interceptam campos de edição ou modais.

**Aplicar e seguir** usa a prévia/confirmacão normal, espera o job e só abre o próximo
item quando todos os destinos selecionados terminam e são verificados. Falha, skip ou
resultado parcial permanece no item com detalhes e retry.

## Corrigir match do TMDB

Para item não resolvido ou incorreto, pesquise por título, ano e tipo. Os resultados
mostram ID TMDB e metadados para desambiguação. Confirmar fixa o match, invalida
candidatos da identidade anterior e registra auditoria. Substituir e limpar também
são explícitos; limpar permite nova resolução automática por GUID.

Falhas de provedores são isoladas. Candidatos conhecidos podem continuar visíveis
como desatualizados durante falha transitória; uma resposta vazia bem-sucedida posterior
remove os antigos.

## Descobrir e preparar artwork

No item, **Encontrar capas** consulta provedores habilitados. Candidatos são agrupados
por provedor e set, com pôster/background e, para seriados, temporadas e title cards.
Prepare uma peça, use o set inteiro ou misture slots. A sugestão com maior score é
marcada, mas só é preparada por ação explícita.

O builder fixo resume pôster, background, temporadas e episódios. URL personalizada
entra como slot normal. Upload de arquivo faz prévia/confirmacão e só pode ir ao
servidor direto, porque binário não vira URL YAML do Kometa.

## Pré-visualizar e aplicar

Escolha o método (padrão `DEFAULT_APPLY_METHOD`):

- **Servidor direto (`plex`)** — captura o estado anterior, grava pela instância
  Plex/Jellyfin/Emby ativa, bloqueia campo quando suportado e verifica o resultado.
- **Kometa** — atualiza `posterpilot.yml`, preserva conteúdo alheio e verifica o YAML.
- **Ambos** — executa destinos independentes; um pode falhar sem esconder o outro.

Primeiro gere a **prévia exata** com itens, slots, candidatos, estado atual, destinos
e skips. A confirmação separada usa um plano expirável, de uso único e vinculado às
seleções/fingerprints. Se algo mudar, nada é gravado e uma nova prévia é exigida.

Em massa, a prévia congela todos os IDs e pode descobrir candidatos de forma não
destrutiva; execução não redescobre nem troca escolhas. Temporada/episódio sem filho
correspondente é skip; falha de um slot não interrompe os demais.

### Como o Kometa consome a exportação

`posterpilot.yml` usa IDs TMDB e `url_poster` / `url_background`, com temporadas e
episódios aninhados. Inclua esse arquivo em `metadata_files` da biblioteca do Kometa;
o [Gerenciador do Kometa](../kometa-config-sync/) pode fazer esse vínculo.

## Verificação, histórico e desfazer

A linha do tempo registra cada destino/slot, origem, estado anterior, resultado e
verificação exata ou melhor esforço. Falha ou evidência indisponível nunca aparece
como sucesso verificado.

Pré-visualize desfazer para uma revisão disponível, temporada ou item inteiro.
Confirmar restaura apenas o snapshot/valor congelado, verifica quando possível e cria
uma nova revisão sem apagar histórico. Falha parcial preserva restaurações bem-sucedidas.
Veja [Segurança, verificação e desfazer](../safety/).

## Falhas e retry

Detalhes do job exibem sucesso, falha, skip e interrupção por destino/slot, com erros
sanitizados. **Tentar falhas novamente** cria trabalho vinculado somente para falhas
retryable; não repete sucessos. Erro de configuração ou plano exige correção e nova prévia.

## FUN, coleções e múltiplos servidores

O FUN opcional contém sorteio de até três opções, blind/cápsulas, Poster Match,
galeria e sessões por duração. Coleções mostram membros, origem, consistência,
cobertura de famílias e overrides. Nenhum deles aplica automaticamente. Veja
[FUN e coleções](../fun-collections/).

Com vários servidores, use o seletor; biblioteca, jobs, Revisão, coleções e automações
continuam isolados. Veja [Migração multi-servidor](../multi-server-migration/).

O histórico operacional detalhado fica em **Configurações → Atividade**; diagnóstico,
automação, backup e recuperação estão em [Automação e recuperação](../automation-recovery/).
