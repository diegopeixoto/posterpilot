---
title: Automação, diagnósticos, backup e recuperação
description: Opere jobs duráveis e automações de revisão, diagnostique falhas e faça backup ou restauração com segurança.
---

O PosterPilot mantém o trabalho rotineiro durável e orientado à revisão. Sync,
descoberta, repetição e aplicações confirmadas são jobs persistidos; automações
podem abastecer a fila de revisão, mas não aplicam artwork automaticamente.

## Jobs duráveis

O Dashboard mostra jobs na fila, em execução, reagendados e finalizados com progresso
ao vivo. Recarregar ou navegar não cancela o trabalho. Um pedido equivalente reutiliza
o job ativo; mutações sobrepostas são bloqueadas com a referência do conflito.

Cada job preserva servidor/biblioteca, entradas imutáveis, tentativas, resumo e
falhas sanitizadas por destino. Após reinício, trabalho seguro volta à fila. Uma
mutação de artwork interrompida no meio fica para revisão e não é repetida às cegas.

**Cancelar** solicita a interrupção sem apagar o que já foi gravado. Em falha parcial,
**Tentar falhas novamente** cria trabalho vinculado só para as unidades elegíveis.
Erros permanentes de validação, credencial ou plano exigem correção e nova prévia.

## Automações orientadas à revisão

Em **Configurações → Automação**, crie uma automação para o servidor ativo e escolha:

- uma ou mais bibliotecas;
- intervalo, horário diário ou evento (`novos itens` ou `sync concluído`);
- fuso horário IANA;
- **Sincronizar** ou **Sincronizar e descobrir**;
- uma visualização de revisão opcional;
- janela de recuperação e limite de falhas consecutivas.

A ação padrão é `sync_discover`. Cada ocorrência congela as entradas e cria ou
reutiliza um job. Editar a automação só afeta ocorrências futuras. Se o serviço voltar
dentro da janela de recuperação, uma única ocorrência perdida é criada; entregas
duplicadas são agrupadas.

:::important
Automações apenas sincronizam e, opcionalmente, descobrem candidatos para Revisão.
Elas não criam jobs de aplicação.
:::

### Webhook

Gere a credencial do webhook na automação. Endpoint e token são mostrados uma vez.
Envie o token no cabeçalho `X-PosterPilot-Webhook-Token`. Rotacionar invalida o token
anterior; desativar o remove. Não coloque o token em URL ou log.

## Diagnosticar antes de repetir

**Configurações → Diagnósticos** executa testes independentes e sem mutação para
servidores, TMDB, provedores, caminhos do Kometa, dados e backups. Os resultados
separam indisponibilidade, credencial ausente/recusada, timeout e falha de leitura ou
escrita; capacidades indicam quais operações de artwork cada instância suporta.

O último resultado e o último sucesso sobrevivem ao reinício. Uma indisponibilidade
de provedor pode manter candidatos conhecidos marcados como obsoletos; uma resposta
vazia bem-sucedida posterior limpa os antigos.

O bundle de suporte redigido só é exportado por ação explícita. Títulos ficam de fora
por padrão, e entradas que não possam ser sanitizadas com segurança são omitidas e
registradas no manifesto.

## Backups da aplicação

Em **Configurações → Backup e restauração**, escolha **Criar backup**. O PosterPilot
gera snapshot consistente do SQLite e um bundle no diretório de dados, com checksums,
versões, modo de chave e referências a caminhos externos. Servidor de mídia e conteúdo
do Kometa montado externamente não são copiados.

No modo `.app-key`, a chave gerada entra no bundle. Com `APP_SECRET`, o segredo nunca
é incluído e a restauração exige o mesmo valor efetivo.

É possível validar, exportar e excluir. Exportar exige confirmação porque o bundle
pode conter credenciais/chaves. Retenção por quantidade e/ou idade só remove bundles
válidos não protegidos; backups manuais e de segurança pré-restauração são protegidos.

## Restaurar

1. Escolha **Pré-visualizar restauração**.
2. Revise checksums, integridade SQLite, schema/migrações, espaço, chave e avisos externos.
3. Confirme o escopo do plano inalterado.
4. O PosterPilot entra em manutenção, bloqueia novas mutações, drena jobs ativos e
   cria um backup de segurança protegido.
5. Reinicie o contêiner; a substituição acontece antes de o libsql abrir.
6. Confira o relatório de prontidão. Se substituição ou migração falhar, ocorre rollback.

Indisponibilidade externa é aviso quando o estado local é íntegro; checksum, banco,
schema mais novo, caminho ou chave incompatível bloqueiam a restauração.

:::caution
Não substitua o SQLite em execução manualmente. Preserve o backup de segurança até
validar bibliotecas, credenciais, caminhos do Kometa, automações e escopos.
:::

Veja [Segurança, verificação e desfazer](../safety/) e
[Migração multi-servidor](../multi-server-migration/).
