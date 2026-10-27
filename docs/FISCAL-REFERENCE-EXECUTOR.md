# Executor local de referências fiscais experimentais

O [carregador](../scripts/fiscal-reference.mjs) lê um snapshot JSON de referência
de engenharia, confere integridade e contexto e produz a resolução utilizada pelo
planejador. Não recebe uma resolução pronta do comprador.

O [schema](../schemas/fiscal-reference.v0.1.schema.json) aceita somente
`purpose: engineering_fixture`. Não há suporte a referência de produção ou
aprovação fiscal por esse campo. A referência é uma cápsula de dados para uma
operação específica, não uma tabela universal, motor de regras ou interpretação
de norma. As decisões são fixtures armazenadas no arquivo, não conclusões legais
deduzidas da NCM ou da UF.

## Verificações executadas

1. Validar o contexto com o contrato de entrada existente.
2. Ler um arquivo regular local de até 2 MiB.
3. Conferir SHA-256 dos bytes contra o snapshot fixado na entrada; conferir
   identificador, versão, JSON e schema.
4. Validar datas de calendário e intervalo `[validFrom, validUntil)`, usando a
   data da operação. O início está incluído; o fim está excluído.
5. Conferir o fingerprint do contexto completo da operação.
6. Construir a resolução com dados do arquivo conferido.
7. Chamar o planejador, que verifica as linhas e bloqueia pendências.

O fingerprint de contexto exclui apenas `ruleSnapshot`, evitando dependência
circular entre hash do arquivo e hash da entrada. Inclui requestId, data, perfis,
mercadorias, quantidades e valores. Outra operação exige outra cápsula de
referência; não existe fallback por SKU ou NCM. O SHA-256 do arquivo usa bytes
originais; o fingerprint do contexto usa JSON canônico do núcleo.

O módulo nunca altera a entrada nem troca seu hash para aceitar outro arquivo.
Falha de leitura, hash, identidade, schema, período ou contexto interrompe o
fluxo, com status blocked e sem resolução. Uma resolução bem formada ainda pode
ser bloqueada ou rejeitada pelo planejador; nenhum plano parcial é devolvido.

O trace `referenceTrace` é registrado em torno das funções locais executadas.
Ele é separado do trace de um futuro cálculo tributário. Uma etapa succeeded
indica que a função terminou sem exceção: por exemplo, plan_simulation pode
terminar normalmente devolvendo blocked. Sempre conferir o status final e o
plano, não apenas os registros das funções.

## Reproduzir

```powershell
cd D:\Projetos\avila-experiments
npm run test:fiscal-reference
npm test
```

O exemplo constrói um arquivo sintético a partir das fixtures existentes, fixa
seu hash na entrada derivada e chama o carregador. Essa construção é apenas o
preparo do teste: não faz parte da validação e não atualiza hashes automaticamente
em uma integração. As fixtures originais não são alteradas.

São executados cinco cenários:

- Referência correspondente: plano produzido e resultado repetido idêntico.
- Bytes alterados após fixar o hash: bloqueio por integridade.
- Contexto alterado: bloqueio por divergência da operação.
- Fim do intervalo igual à data da operação: bloqueio por intervalo.
- Tributo indeterminado: resolução preservada para diagnóstico, plano bloqueado.

As execuções são gravadas em `reports/fiscal-reference/<runId>/`, com entrada,
arquivo de referência e resultado de cada cenário. `verification.json` resume as
asserções; `manifest.json` registra tamanho e SHA-256 dos artefatos. Arquivos são
criados com flag wx, impedindo sobrescrita pelo exemplo. Isso não configura
armazenamento WORM nem impede alteração posterior pelo operador da máquina.

## Fronteira ainda aberta

Comparar um hash com uma referência fixada comprova correspondência dos bytes,
não autoria, autenticidade da norma, validade jurídica ou aprovação responsável.
As referências de perfis e classificação ainda são declarações do contexto; não
foram resolvidas em um banco oficial. O intervalo é uma condição da fixture,
não uma conclusão sobre vigência de legislação.

O carregador não executa código contido no arquivo, consulta a rede, calcula
imposto, emite documento ou autoriza produção. Seu caminho de arquivo é fornecido
pelo operador local; não foi exposto como parâmetro de uma API HTTP.
