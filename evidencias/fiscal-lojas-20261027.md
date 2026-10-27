# Inventário fiscal do Lojas — verificação local em 27/10/2026

O fiscal existente foi examinado e exercitado na sua linguagem atual, TypeScript.
Não foi reescrito nem foram feitas chamadas à SEFAZ, às APIs reais do ERP/TMS ou
ao banco de produção. As alterações preexistentes do checkout foram preservadas.

Repositório examinado: `D:\Projetos\SaaS\lojas.avilaops.com`.
Commit de referência: `0d38de822696d8314bc86ed3e773ff9b0f317fbe`.
Os hashes dos arquivos examinados e dos testes estão no
[registro estruturado](fiscal-lojas-20261027.json). O hash identifica o conteúdo
observado, sem atestar autoria ou operação em produção.

## Comando executado

```powershell
node --import tsx --test src/lib/erp-fiscal.test.ts src/lib/tms-fiscal.test.ts src/lib/fiscal-monitor.test.ts src/lib/fiscal-origem.test.ts src/lib/fiscal-fluxos.test.ts src/lib/fiscal-documento.test.ts
```

Resultado: 23 testes aprovados, zero falhas, zero ignorados, saída 0.

| Arquivo de testes | Casos | Propriedade exercitada |
| --- | --- | --- |
| erp-fiscal.test.ts | 3 | Adaptador ERP, chave no servidor, configuração e identificadores |
| tms-fiscal.test.ts | 2 | Adaptador TMS, contrato de resposta válido, configuração e identificadores |
| fiscal-documento.test.ts | 5 | Resumo de documentos por tipo e rejeição de XML inseguro |
| fiscal-monitor.test.ts | 3 | Separação de notas/eventos/CT-e e totalização de histórico |
| fiscal-origem.test.ts | 4 | Origem HTTPS do painel, origens indevidas e loopback de desenvolvimento |
| fiscal-fluxos.test.ts | 6 | Projeção de campos, valores ausentes, XML, configuração e escopo de filtros |

## Regras registradas

As cinco fichas estão em `examples/policies/lojas-fiscal.json`, separadas do
inventário inicial do caderno. São importadas explicitamente, sem sobrescrever
registros já existentes.

- LOJAS-FISCAL-001: ERP configurado impede consulta local de NF-e. Implementação
  lida em `fiscal-loja.ts`; a integração com banco real não foi executada.
- LOJAS-FISCAL-002: adaptadores por CNPJ e chave em cabeçalho no servidor.
- LOJAS-FISCAL-003: projeção fechada dos campos destinados aos fluxos.
- LOJAS-FISCAL-004: classificação distinta de NF-e, CT-e, resumos e eventos.
- LOJAS-FISCAL-005: verificação da origem nas ações fiscais.

As quatro últimas fichas declaram verificação local nos cenários descritos,
com referências aos testes. Não declaram conformidade fiscal integral, entrega
real de webhook, isolamento de banco, autorização do servidor remoto, transmissão
de documento ou apuração correta de tributos.

## Limites e continuidade

A frase da interface sobre consulta pelo ERP é mais geral que o caminho
condicional do código. O modo local ainda existe quando não há configuração do
ERP para o CNPJ. A configuração efetiva do cliente precisa ser conferida antes
de concluir quem controla suas consultas. Nenhuma chave de cliente foi lida.

O monitor de documentos e um futuro motor de apuração tributária são capacidades
diferentes. A proposta deste último está em
[FISCAL-DECISION-PROPOSAL.md](../docs/FISCAL-DECISION-PROPOSAL.md), sem alegação
de implementação ou adoção automática de tabelas externas.
