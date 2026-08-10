---
title: Uso
description: Sincronize, revise, repare matches do TMDB, prepare artwork, confirme planos exatos, leia a cobertura das artes, acompanhe jobs e desfaça por revisões.
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

Sync normal é incremental por padrão, com uma exceção deliberada: um item cuja
identidade TMDB armazenada contradiz o tipo filme/série que o próprio servidor de
mídia atribui a ele é sempre reprocessado, de modo que uma divergência antiga não
sobrevive indefinidamente aos syncs incrementais (veja
[Corrigir match do TMDB](#corrigir-match-do-tmdb)). **Varredura completa** relê todos
os itens, reconcilia removidos e detecta artwork alterada externamente, sem apagar
snapshots e revisões nem aplicar capas automaticamente.

Jobs mostram fila, fase, progresso, tentativas e resultado ao vivo. Recarregar a
página não os cancela; pedidos equivalentes reutilizam o job ativo.

## Biblioteca em escala

A Biblioteca pesquisa e filtra no servidor por tipo, biblioteca, ativo/ignorado,
missing poster, candidatos gerais, candidatos MediUX, mudança, nota e gênero. Ordene
por título, ano, nota, duração, mudança recente ou data de adição. A URL preserva
filtros/sort ao abrir um item e voltar.

Um controle à parte, **Cobertura das artes**, filtra por _Aplicado neste servidor_,
_Exportado para o Kometa_, _Precisa de arte_ ou _Cobertura desconhecida_. A Revisão
oferece o mesmo controle com o mesmo significado, então um link é transportável entre
as duas telas. Leia [Cobertura das artes](#cobertura-das-artes) antes de confiar nele:
são afirmações sobre o que o PosterPilot fez, não sobre o título ter ou não pôster.

Para operações em massa, use **Selecionar página** ou **Selecionar todos os
resultados**, veja carregados versus total e limpe quando necessário. Todos os
resultados são materializados pelo filtro exato; mudar a consulta invalida a seleção.

## Caixa de entrada de Revisão

**Revisão** agrupa estados acionáveis: novo, não resolvido, sem candidatos, sugestão
pronta, preparado, falha parcial, mudança externa, ignorado e concluído. Filtre,
ordene e salve views. Ao abrir um item, anterior/próximo/voltar preservam o contexto.
Ao lado do filtro de estado fica o de **Cobertura das artes**, que responde a outra
pergunta: o _estado_ diz onde você está no seu fluxo de trabalho; a _cobertura_, o que
de fato aconteceu em um destino.

Compare artwork **atual**, **sugerida** e **preparada** por slot. Aceitar sugestão é
explícito; nada é persistido apenas por abrir a página. Atalhos de teclado listados na
interface não interceptam campos de edição ou modais.

**Aplicar e seguir** usa a prévia/confirmacão normal, espera o job e só abre o próximo
item quando todos os destinos selecionados terminam e são verificados. Falha, skip ou
resultado parcial permanece no item com detalhes e retry.

## Corrigir match do TMDB

Tudo o que vem depois depende da identidade TMDB resolvida para um item: qual artwork
sequer é procurada, qual entrada do Kometa é escrita e como duas cópias de um mesmo
título são reconhecidas como o mesmo título.

**A resolução automática não sai do namespace certo.** O TMDB numera filmes e séries
de forma independente: o filme `105` e a série `105` são títulos sem relação alguma. O
servidor de mídia já sabe qual dos dois é cada item, então o PosterPilot trata isso
como autoritativo e resolve **apenas dentro daquele namespace**. Os GUIDs são tentados
numa precedência fixa — ID TMDB direto, depois IMDb, depois TVDB; um ID TMDB direto é
validado relendo-o no endpoint esperado (série como série, filme como filme), e um ID
IMDb ou TVDB passa pelo endpoint `find` aceitando somente o bloco de resultados do tipo
correspondente — um acerto no outro bloco é descartado, não emprestado. Na prática, uma
biblioteca de séries não pode mais resolver para filmes. Um «não está neste namespace»
vindo do TMDB deixa o item **não resolvido**, e isso não é o mesmo que uma falha de
rede ou de credencial: essa deixa o item não resolvido _e_ não sincronizado, de modo
que o próximo sync tenta de novo em vez de aceitar uma resposta errada.

**O aviso de normalização.** Versões anteriores a essa proteção podiam gravar uma
identidade TMDB do tipo errado, e consertar o resolvedor não conserta retroativamente
as linhas já gravadas. Depois de atualizar, o PosterPilot as conta e diz isso em um
aviso no topo de todas as páginas — _«… correspondências antigas do TMDB precisam ser
normalizadas.»_ — com a ação **Normalizar correspondências** e uma nota de que o reparo
corrige identidades de filmes e séries sem varredura completa nem aplicação de artes. O
que a contagem inclui é estreito e proposital: apenas itens do **servidor ativo** cujo
tipo de mídia TMDB armazenado contradiz o tipo que o próprio servidor dá àquele item;
**não** os itens fixados à mão (fixar é a sua afirmação sobre a identidade e supera
qualquer reparo automático) e **não** as cópias que já saíram da biblioteca delas. O
número é recontado no banco toda vez que é exibido, então restaurar um backup ou editar
linhas à mão não exige reparo de flag separado, e o aviso some sozinho assim que não
resta nada pendente.

**Normalizar correspondências** enfileira um job de reparo limitado exatamente a esses
itens: ele resolve cada um de novo dentro do namespace correto e reenriquece os
metadados, e nada além disso — não aplica artwork, não mexe em seleções preparadas e
não percorre o resto da biblioteca. Enquanto roda, o aviso mostra o progresso e leva ao
job no Dashboard; um job que termina em falha, parcial, cancelado ou interrompido
transforma o controle em **Tentar normalização novamente**. Só um job de reparo por
servidor pode rodar por vez — iniciar um segundo nomeia o job que já detém aquele
escopo.

**Por que a varredura completa é o plano B, e não o reparo.** **Varredura completa**
relê a biblioteca inteira do servidor: cada item é reconciliado, resolvido de novo,
reenriquecido, e a artwork atual dele é reobservada (o que mudou no servidor é marcado
para revisão). Ela preserva originais e histórico e nunca aplica artwork sozinha. É a
ferramenta certa quando você suspeita que o cache local desviou como um todo — depois
de restaurar um backup, ou depois de edições em massa feitas direto no servidor de
mídia. E é a ferramenta errada para identidades trocadas, por duas razões: primeiro,
o PosterPilot já sabe nomear os itens afetados, então uma varredura completa paga uma
passada inteira pela biblioteca e uma rodada completa de requisições ao servidor e ao
TMDB para chegar ao mesmo resultado; segundo, esperar também funciona, porque uma
divergência de tipo pendente fica isenta do pulo incremental e um sync comum reprocessa
esses itens assim que chega neles. O job de reparo serve para corrigi-los _agora_, não
é a única forma de vê-los corrigidos algum dia.

**Fixar um match à mão.** Para item não resolvido ou incorreto, pesquise por título,
ano e tipo. Os resultados mostram ID TMDB e metadados para desambiguação. Confirmar
relê aquela identidade exata no TMDB imediatamente antes de gravar qualquer coisa, de
modo que um candidato que sumiu entre a pesquisa e a confirmação é recusado em vez de
fixado, e um TMDB inalcançável deixa o seu match atual intacto. Confirmar fixa a
identidade, invalida os candidatos descobertos sob a anterior e registra auditoria:
**nenhuma artwork é aplicada** — use **Buscar capas** de novo para descobrir as artes
da nova identidade. Um match fixado é autoritativo: syncs não o sobrescrevem e a
passagem de normalização o ignora. Substituir e limpar também são explícitos; limpar
tenta de imediato a resolução automática a partir apenas dos IMDb/TVDB próprios do item
— a coluna do ID TMDB pertencia ao match fixado, então só esses identificadores
independentes podem ser reaproveitados com segurança — e informa o que aconteceu: um
match automático foi restaurado, nenhum match foi encontrado, ou a resolução não pôde
rodar. Um item sem nenhum dos dois simplesmente volta a ficar elegível, e um sync
posterior pode fornecer um GUID TMDB novo. Cada transição (fixado, substituído, limpo,
resolvido, não resolvido) fica na trilha de auditoria de matches do item.

Falhas de provedores são isoladas. Candidatos conhecidos podem continuar visíveis
como desatualizados durante falha transitória; uma resposta vazia bem-sucedida posterior
remove os antigos.

## Descobrir e preparar artwork

No item, **Encontrar capas** consulta provedores habilitados. Candidatos são agrupados
por provedor e set, com pôster/background e, para seriados, temporadas e title cards.
Prepare uma peça, use o set inteiro ou misture slots. A sugestão com maior score é
marcada, mas só é preparada por ação explícita.

Cada grupo de provedor tem seu próprio controle **⟳ Pesquisar novamente**, que
repete a descoberta só para aquele provedor, ignorando o cache HTTP e substituindo
os candidatos armazenados dele sem tocar nos dos demais. O grupo do ThePosterDB
abre expandido por padrão.

**Os cards de provedor aparecem na ordem que você configurou** em Configurações →
Metadados e provedores, e não na ordem em que a descoberta terminou, que só registra
quem respondeu primeiro. Essa ordem é apresentação mais um desempate entre candidatos
de score _exatamente_ igual; ela nunca reverte um score desigual, então uma imagem mais
nítida de um provedor que você colocou por último ainda leva a sugestão. Veja
[Configuração → Ordem dos provedores](../configuration/#ordem-dos-provedores).

**Mostrar mais sem carregar tudo.** Um blockbuster pode carregar centenas de capas, então
cada grade abre com **24 miniaturas** e um controle **carregar mais** revela outras 24
(ou o que sobrar) e informa quantas ainda ficariam ocultas. 24 divide exato em todas as
grades da página — duas colunas para backgrounds, quatro para title cards, oito para
pôsteres de temporada —, então nenhuma revelação deixa meia fileira torta, e a linha ao
lado do controle sempre diz quantas estão exibidas, de quantas, e quantas seguem
ocultas. Cada grade se abre **de forma independente**: revelar mais pôsteres não revela
backgrounds, dois sets do mesmo provedor expandem separadamente, e cada temporada mantém
a própria contagem. Revelar mais não custa rede — o inventário mantido já vem junto com
a página —, mas também não alcança além do que o PosterPilot **guardou**: a ingestão
aplica um teto defensivo de 200 candidatos por tipo de arte e, ao encostar nele, a grade
avisa — _«… retornou mais capas do que o PosterPilot mantém; esta grade não é a lista
completa.»_ — em vez de sugerir que você está vendo tudo o que existe. Veja
[Configuração → Inventário de candidatos](../configuration/).

**Ampliar um candidato.** Cada miniatura tem seu próprio controle **⤢ ampliar** abaixo da
imagem, separado do que a prepara: ampliar é olhar, nunca escolher — não prepara nada,
não persiste nada e não muda slot algum. O diálogo mostra o **arquivo canônico**, o mesmo
que seria enviado ao seu servidor ou escrito no YAML do Kometa, inteiro e sem corte, com
a procedência que uma imagem sozinha não carrega: provedor, dimensões em pixels e idioma
quando o provedor informa um (MediUX e ThePosterDB nunca marcam idioma, então não ganham
linha de idioma nenhuma, porque «sem marcação de idioma» descreveria a fonte e não a
arte). **← / →** ou as setas percorrem a sequência e **Esc** ou o ✕ fecham e devolvem o
foco à miniatura de origem; a posição é anunciada a cada mudança e os controles **param
nas pontas** em vez de dar a volta. A sequência é exatamente o que está na tela — mesma
ordem de provedores, mesmos sets expandidos, mesmo filtro de idioma, mesmas miniaturas
reveladas —, então Próximo nunca alcança arte que a própria página esconde. Se a grade
mudar sob um diálogo aberto, ele acompanha a arte que você estava olhando e só fecha se
não sobrar nada; uma imagem que não carrega em tamanho cheio diz isso, em vez de exibir a
anterior sob a legenda da nova.

**O que a navegação de fato baixa.** Todo candidato tem um arquivo **canônico** — o que
seria realmente aplicado — e alguns provedores publicam ao lado uma versão reduzida. As
grades pedem a versão otimizada onde houver (o TMDB entrega pôster `w500` e background
`w1280` em vez do original) e a servem pelo cache de miniaturas do próprio PosterPilot,
então esses bytes são buscados uma vez no provedor e reaproveitados entre carregamentos,
entre itens e entre todo mundo naquela instância; MediUX, Fanart.tv e ThePosterDB não
publicam prévia separada, então as miniaturas deles usam a URL canônica — ainda por esse
cache. A **prévia ampliada** e o **caminho de aplicação** usam o canônico buscado direto
no provedor, e a prévia ignora o cache de propósito: aquele cache existe para imagens do
tamanho da grade, e enchê-lo de originais expulsaria justamente as miniaturas que ele
serve. A imagem ampliada só existe enquanto o diálogo está aberto, então uma grade de cem
miniaturas do TMDB baixa cem miniaturas e zero originais até você pedir uma.

**Idioma das capas.** Com um idioma de artes do TMDB configurado, a página do item filtra
as grades para ele e diz isso acima delas — nomeando o idioma e quantas capas está
escondendo em outros —, com um alternador **Mostrar todos os idiomas** local à página que
nunca altera a sua preferência salva. Se nada corresponder para aquele título, a página
diz quantas capas existem em outros idiomas e oferece a mesma saída em vez de uma grade
vazia. A preferência rege **apenas as artes do TMDB**; o raciocínio está em
[Configuração → Idioma das artes do TMDB](../configuration/#idioma-das-artes-do-tmdb).

O builder fixo resume pôster, background, temporadas e episódios. URL personalizada
entra como slot normal. Upload de arquivo faz prévia/confirmacão e só pode ir ao
servidor direto, porque binário não vira URL YAML do Kometa. URLs personalizadas são
baixadas pelo próprio PosterPilot para verificar os bytes exatos, então precisam ser
alcançáveis a partir do contêiner (não basta o servidor de mídia enxergá-las);
escritas não verificáveis não são suportadas de propósito.

## Pré-visualizar e aplicar

Escolha o método (padrão `DEFAULT_APPLY_METHOD`):

- **Servidor direto (`plex`)** — captura o estado anterior, grava pela instância
  Plex/Jellyfin/Emby ativa, bloqueia campo quando suportado e verifica o resultado.
- **Kometa** — atualiza `posterpilot-movies.yml` ou `posterpilot-shows.yml`,
  preserva conteúdo alheio e verifica o YAML.
- **Ambos** — executa destinos independentes; um pode falhar sem esconder o outro.

Primeiro gere a **prévia exata** com itens, slots, candidatos, estado atual, destinos
e skips. A confirmação separada usa um plano expirável, de uso único e vinculado às
seleções/fingerprints. Se algo mudar, nada é gravado e uma nova prévia é exigida.
Um plano sem avisos — nenhum skip e pelo menos uma gravação — aplica em um único
clique: o PosterPilot emite a confirmação na mesma ação. Qualquer skip traz de volta
a confirmação explícita, e **Aplicar e seguir** sempre mantém seu diálogo.

Em massa, a prévia congela todos os IDs e pode descobrir candidatos de forma não
destrutiva; execução não redescobre nem troca escolhas. Temporada/episódio sem filho
correspondente é skip; falha de um slot não interrompe os demais.

### Como o Kometa consome a exportação

`posterpilot-movies.yml` usa IDs TMDB, com IMDb como fallback quando não há um ID
TMDB. `posterpilot-shows.yml` usa IDs TVDB, com IMDb como fallback quando não há um
ID TVDB, e aninha temporadas e episódios. Inclua o arquivo correspondente
em `metadata_files`; o [Gerenciador do Kometa](../kometa-config-sync/) pode manter
o vínculo e explica a diferença entre o caminho físico e o prefixo `file:` visto
pelo runtime do Kometa.

## Cobertura das artes

A linha do tempo responde _o que o PosterPilot fez_. A cobertura responde a outra
pergunta — _o que é verdade agora_ — e as duas podem discordar, que é exatamente por
isso que são separadas. Toda página de item traz um painel **Cobertura das artes**
abaixo do cabeçalho, e tanto a Biblioteca quanto a Revisão podem ser filtradas por ele.

**Dois destinos, nunca fundidos.** A cobertura é sempre informada **por destino**, em
dois painéis lado a lado: **Servidor de mídia** para as artes que o PosterPilot enviou
ao Plex, Jellyfin ou Emby, e **Metadados do Kometa** para as entradas que o PosterPilot
escreveu nos arquivos YAML dele. Os painéis nunca são dobrados em um veredito único e
as contagens deles nunca são somadas.

:::caution[Exportar para o Kometa não é aplicar artwork]
Uma exportação é uma linha em um arquivo YAML em disco. Escrever essa linha prova que o
arquivo foi escrito. Não prova que o Kometa chegou a rodar, nem que leu o arquivo, nem
que o seu servidor de mídia aceitou o resultado, nem que a URL ainda resolve. O
PosterPilot diz isso no painel — _«Exportado para um arquivo do Kometa. O PosterPilot
não tem como confirmar se o Kometa aplicou.»_ — e nunca promove uma exportação a
afirmação sobre o servidor. Se você aplicar só pelo método Kometa, o painel Servidor de
mídia vai continuar dizendo que nada foi aplicado ali, e isso é uma afirmação correta,
não um bug.
:::

A mesma regra vale para cópias de um título. Um filme que existe em dois servidores, ou
duas vezes em um só porque está em `Filmes` e em `Filmes 4K`, são várias cópias com
evidências independentes: um pôster aplicado em uma não prova nada sobre a outra. Com
mais de uma cópia, o cabeçalho informa a contagem **por destino** («1 de 2 cópias
cobertas»), nunca um número combinado: uma cópia aplicada em um servidor mais outra
cópia exportada para o Kometa não é «2 de 2». Cada slot dentro de um painel — pôster,
background, cada temporada, cada episódio — também mantém o próprio estado.

| Estado                            | Significado                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Aplicado neste servidor**       | Nós gravamos, e a impressão digital que esperávamos ainda bate com o que o servidor entrega agora. É o único estado que é prova positiva e verificada. |
| **Exportado para o Kometa**       | O arquivo de metadados atual carrega a URL deste slot. Um arquivo em disco — veja o aviso acima.                                                       |
| **Aplicado, sem verificação**     | Nós gravamos, e o estado atual do servidor não pôde ser checado. Há histórico; prova não.                                                              |
| **Alterado fora do PosterPilot**  | Nós gravamos, e desde então algo substituiu. É um estado próprio, não sinônimo de nenhum outro.                                                        |
| **Não aplicado pelo PosterPilot** | Uma observação confiável não encontrou indício de que tenhamos posto artwork aqui.                                                                     |
| **Cobertura desconhecida**        | Não conseguimos observar de forma confiável — arquivo do Kometa ilegível, servidor de mídia inalcançável, histórico incompleto.                        |

Três dessas formulações sustentam o sentido inteiro, e lê-las por alto vai te enganar:

**«Não aplicado pelo PosterPilot» não é «não tem arte».** É uma afirmação sobre o que
_nós_ fizemos, nunca sobre o que o seu servidor guarda. Um título em que você mesmo pôs
o pôster à mão no Plex anos atrás aparece aqui como não aplicado pelo PosterPilot — e
tem um pôster perfeitamente bom. Não existe, de propósito, nenhum estado de cobertura
nem valor de filtro que afirme que um título está sem arte, porque o PosterPilot não tem
como saber isso.

**«Alterado fora do PosterPilot» é uma resposta por si só.** Algo substituiu a nossa
artwork: o próprio agente do Plex, outra ferramenta, uma pessoa. Ler isso como «faltando»
e reaplicar é nunca descobrir o que fica sobrescrevendo a sua biblioteca.

**Uma leitura que falha é «desconhecida», nunca «não aplicado».** «Não conseguimos
checar» e «checamos e não está lá» são fatos diferentes, e confundi-los é como uma
biblioteca inteiramente coberta acaba reportada como vazia, com um convite a reexportar
tudo. Por isso um arquivo do Kometa ilegível, um diretório que o PosterPilot não
consegue resolver ou um histórico que ele não leu por inteiro produzem _desconhecida_;
um arquivo ausente, que é uma observação confiável, não.

**Filtrar por cobertura.** A Biblioteca e a Revisão dividem um único controle:
_Aplicado neste servidor_ (pelo menos um slot verificado no servidor ativo), _Exportado
para o Kometa_ (pelo menos um slot no arquivo de metadados atual), _Precisa de arte_
(sem cobertura em _nenhum_ dos dois destinos — títulos que o PosterPilot nunca tocou
também batem com esse filtro, e o nome diz que nós não pusemos nada, não que falte
pôster ao título) e _Cobertura desconhecida_ (pelo menos um slot com evidência
indeterminada: _Cobertura desconhecida_ em qualquer dos destinos, ou _Aplicado, sem
verificação_ no servidor). Repare no «pelo menos um slot»: um seriado com pôster
aplicado e sem title cards bate com _Aplicado neste servidor_. O filtro acha títulos que
valem ser abertos; a verdade slot a slot mora no painel do item. A cobertura é escopada
ao servidor a que a cópia pertence, então trocar o servidor ativo muda as respostas.
Quando um filtro não acha nada, o estado vazio diz isso e oferece a volta a _Qualquer
cobertura_ em um clique.

**Como a cobertura se mantém atual.** A cobertura é uma projeção reconstruída a partir
de três fontes que ela não possui: o ledger de revisões append-only, a observação atual
do seu servidor slot a slot, e os arquivos do Kometa em disco. Ela é rederivada depois
de aplicar, desfazer, sincronizar e migrar ou gravar configuração do Kometa — e, como
nada avisa o PosterPilot quando alguém troca o pôster de um título direto no Plex, uma
página de item cuja evidência tem mais de **15 minutos** reobserva o servidor ao ser
aberta. Daí duas consequências, ambas intencionais: um refresh **nunca faz fracassar o
que o disparou** — uma aplicação que deu certo e depois não conseguiu atualizar a
projeção continua sendo uma aplicação bem-sucedida, e o custo é uma defasagem que o
próximo gatilho conserta —, e reconciliar cobertura **não muda mais nada**: não grava
artwork, nem YAML, nem match, e nunca marca coisa alguma como revisada. Onde você está
na sua fila é a sua afirmação; o que é verdade em um destino é a do PosterPilot, e uma
não deve editar a outra.

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
cobertura de famílias, overrides e uma nova pesquisa em todos os membros em uma
única ação. Nenhum deles aplica automaticamente. Veja
[FUN e coleções](../fun-collections/).

Com vários servidores, use o seletor; biblioteca, jobs, Revisão, coleções e automações
continuam isolados. Veja [Migração multi-servidor](../multi-server-migration/).

O histórico operacional detalhado fica em **Configurações → Atividade**; diagnóstico,
automação, backup e recuperação estão em [Automação e recuperação](../automation-recovery/).
