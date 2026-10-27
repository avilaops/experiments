# Proposta: contrato de decisão fiscal do ERP

Estado: proposta de engenharia, sem motor tributário ou importação automática
implementados por este documento. Preserva o monitor fiscal atual do Lojas e
as responsabilidades das integrações ERP/TMS.

## Primeiro recorte

Definir uma operação empresarial concreta, um tipo de documento, os perfis
tributários envolvidos e as jurisdições aplicáveis. Produzir casos de referência
revisados pelo responsável fiscal antes de automatizar a interpretação de tabelas.
Não criar uma fórmula universal a partir apenas de NCM e UF de destino.

A proposta de entrada da decisão inclui identidade/contexto empresarial,
data da operação, tipo de operação e documento, origem/destino, perfil fiscal das
partes, classificação e características da mercadoria, quantidades/valores e
versões das regras selecionadas. Os campos exatos dependem do recorte validado.

A saída precisa separar tributos aplicáveis e não aplicáveis, valores calculados,
regras/fontes utilizadas, passos executados e impedimentos. Ausência de uma regra
aplicável não pode ser convertida silenciosamente em alíquota zero.

## Tabelas e vigência

Preservar a versão original da fonte, URL, hash, publicação, coleta, vigência,
transformação usada, revisão técnica e aprovação fiscal. Diferenciar a data em
que a regra produz efeitos da data em que o sistema tomou conhecimento dela.

Não presumir que todo fornecedor tenha API pública, atualização diária ou o mesmo
formato. Confirmar acesso, licença, periodicidade e contrato de cada fonte.
Importar para revisão, sem ativação silenciosa. A ausência de nova coleta não
significa automaticamente que a regra vigente expirou.

Um documento emitido conserva seu snapshot e resultado. Reproduzir a decisão
histórica usa dados, regras e versão do motor originais. Simular uma nova regra
sobre uma operação antiga cria um resultado contrafactual separado, sem alterar
o documento emitido.

## Fontes com finalidades distintas

- A NCM é classificação de mercadorias; consultar a
  [Receita Federal e o Sistema Classif](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias).
- O [De Olho no Imposto do IBPT](https://deolhonoimposto.ibpt.org.br/) declara
  finalidade de informar a carga tributária ao consumidor, conforme a
  [Lei 12.741/2012](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12741.htm).
  Essa finalidade não o transforma em fonte universal de apuração dos tributos.
- O [Convênio ICMS 142/18](https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18)
  relaciona segmentos, descrições, NCM e CEST. A associação de códigos não dispensa
  verificar enquadramento da mercadoria e regras aplicáveis à operação.
- Leiaute e validação de documento, vigência de norma e obrigação tributária são
  dimensões diferentes. Conferir as
  [orientações vigentes da reforma tributária](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria).

Fontes consultadas em 27/10/2026; revalidar na implementação. Este documento
não define alíquotas nem substitui a revisão fiscal do recorte escolhido.

## Avaliação e autorização para ativar

1. Usar dados sintéticos deliberadamente construídos. Histórico real, mesmo
   anonimizado ou pseudonimizado, requer tratamento e acesso próprios; não vira
   público apenas por receber esse nome.
2. Fixar entradas, critérios e referências esperadas. A tabela candidata é uma
   variável do executor; não alterar silenciosamente o dataset ou os gates para
   obter uma comparação favorável.
3. Comparar resultados contra referências aprovadas. Tolerância numérica auxilia
   a comparação, mas não define legalidade. Precisão decimal e arredondamento
   precisam ser definidos por operação; não aceitar qualquer diferença por uma
   margem arbitrária de proximidade com o cálculo antigo.
4. Avaliar separadamente correção fiscal, estrutura documental, efeito comercial
   e custo operacional. Uma norma pode reduzir a margem legitimamente; isso exige
   decisão comercial, não autoriza desconsiderar o tributo obrigatório.
5. Definir caminhos condicionais válidos. Não exigir universalmente uma sequência
   que combine MVA, ICMS-ST e DIFAL em todas as operações. O trace deve vir do
   executor instrumentado; sua conformidade não prova autenticidade ou completude.
6. Ativar com revisão fiscal, vigência, aprovação responsável, plano operacional
   e evidência do escopo. Um verdict passed, sozinho, não autoriza a ativação.

## Ordem de implementação proposta

Contrato e referências de uma operação → persistência versionada das fontes →
adaptador de uma fonte validada → cálculo determinístico e testes → simulação
de impacto → aprovação e ativação por vigência. Nenhuma reescrita global é
pré-requisito desse piloto.
