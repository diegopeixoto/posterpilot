---
title: Segurança, verificação e desfazer
description: Entenda a prévia exata, as revisões imutáveis, a verificação, as falhas parciais e os limites seguros para desfazer.
---

O PosterPilot trata toda gravação de artwork ou configuração como uma operação que
precisa ser revisada. Sugestões, resultados do FUN, famílias de coleções,
agendamentos e descobertas nunca gravam artwork por conta própria.

## O contrato de gravação

Para artwork direto no servidor, metadados do Kometa, uploads, coleções e alterações
no `config.yml`, o fluxo seguro é:

1. **Preparar** a artwork ou configuração.
2. **Pré-visualizar** destinos, slots, gravações e itens ignorados exatos.
3. **Confirmar** o plano emitido pelo servidor. Ele expira, só pode ser usado uma
   vez e está vinculado ao conteúdo e aos fingerprints exibidos.
4. **Executar** apenas as operações congeladas, sem redescobrir nem trocar a opção.
5. **Verificar** cada destino depois da gravação.
6. **Registrar** uma revisão por destino e slot, inclusive nas falhas.

Se seleção, artwork atual, membros da coleção, arquivo do Kometa, destino ou outro
dado vinculado mudar depois da prévia, a confirmação é recusada. Gere uma nova
prévia; não reutilize um token antigo.

## O que é capturado

Antes da mutação, o PosterPilot registra o estado anterior do slot. Quando o
servidor permite ler os bytes da imagem, uma cópia local endereçada pelo conteúdo é
salva no diretório de dados. Revisões do Kometa preservam o valor YAML gerenciado
anterior — inclusive quando ele não existia.

A linha do tempo é somente de acréscimo. Aplicar de novo ou desfazer não apaga a
tentativa original. Uploads usam uma identidade de conteúdo segura; credenciais e
URLs com segredos não aparecem no histórico do navegador.

:::caution
Quando a imagem original não pôde ser lida, o slot é registrado como indisponível.
O PosterPilot não afirma que ele pode ser restaurado exatamente. Revise a prévia de
desfazer antes de confirmar.
:::

## Estados de verificação

- **Exata** — o destino pode ser comparado ao conteúdo pretendido ou ao valor YAML.
- **Melhor esforço** — o provedor informa uma identidade estável nova, mas não
  oferece evidência byte a byte.
- **Falhou ou indisponível** — a gravação falhou, o resultado divergiu ou não houve
  evidência suficiente. Isso nunca aparece como sucesso verificado.

Servidor e Kometa têm resultados independentes. Uma operação “Ambos” pode terminar
parcialmente; uma falha de temporada/episódio não esconde os outros sucessos.

## Falhas parciais e novas tentativas

Abra os detalhes do job para ver contagens de sucesso, falha, ignorados e
interrompidos, além do destino e slot afetados. **Tentar falhas novamente** cria um
trabalho vinculado apenas para as unidades elegíveis e não repete sucessos. Erros de
validação, configuração ou plano obsoleto exigem corrigir Configurações e gerar nova
prévia.

“Aplicar e seguir” só avança quando todos os destinos selecionados terminam e são
verificados. Caso contrário, permanece no item com os detalhes registrados.

## Desfazer pela linha do tempo

No detalhe do item, use a linha do tempo para pré-visualizar o desfazer de uma
revisão disponível, temporada ou item inteiro. A prévia lista restaurações possíveis
e slots indisponíveis ou já restaurados. A confirmação restaura o snapshot/valor,
verifica o resultado quando possível e acrescenta uma nova revisão de desfazer.

O escopo é preservado: desfazer uma temporada não muda a capa do seriado ou outra
temporada; restaurar metadados do Kometa não reescreve YAML alheio. Resultados mistos
continuam visíveis e podem ser tentados separadamente.

## Segurança da configuração do Kometa

Sincronização estruturada, salvamento de YAML bruto e restauração de backup têm
prévia e confirmação próprias. O diff no navegador oculta segredos. A gravação
confirmada usa backup e substituição atômica; planos alterados, expirados, obsoletos
ou reutilizados não gravam nada. Veja o [Gerenciador do Kometa](../kometa-config-sync/).

## Hábitos seguros

- Persista `/data` e inclua `.app-key` nos backups quando `APP_SECRET` não estiver definido.
- Revise itens ignorados; “ignorado” não é sucesso verificado.
- Rode Diagnósticos antes de repetir falhas de servidor, provedor ou caminho.
- Crie backup antes de upgrades, expurgos de servidor ou restauração.
- Mantenha automações no modo de revisão: nenhum agendamento interno aplica artwork.

Continue em [Uso](../usage/) ou no guia de
[Automação e recuperação](../automation-recovery/).
