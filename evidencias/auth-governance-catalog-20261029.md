# Auth no catálogo de governança

## Alteração

O produto `auth` (Ávila Auth) integra `PRODUCTS`, a fonte de produtos usada pelo
caderno de políticas. `ROUTE_PRODUCTS` deriva dessa mesma lista, excluindo
`shared`; os contratos de clientes já reutilizam `ROUTE_PRODUCTS`.

A leitura de volumes existentes atualiza os metadados de produtos em memória.
Consultar o catálogo não regrava o arquivo, não altera a revisão e preserva
as políticas e seu histórico. Uma gravação posterior persiste o catálogo atual.

## Validação local

- `npm test`: 219 testes aprovados, sem falhas ou testes ignorados.
- `npm --prefix dashboard run build`: compilação aprovada.
- No diretório `dashboard`,
  `node --test --test-name-pattern="Auth is available" test-ui/review.test.mjs`:
  um teste de navegador aprovado com API e painel reais em dados temporários.
- O teste de navegador seleciona Auth, salva uma política proposta, recarrega
  a página e encontra o produto no formulário de contratos; viewport de 390 px,
  sem transbordamento horizontal na tela de políticas e sem erros JavaScript.
- A API preserva contratos Auth após reinício e devolve `400 INVALID_INPUT`
  para produto desconhecido, nome de exibição usado como ID e `shared`,
  sem modificar os bytes persistidos.
- Um volume de políticas anterior ao cadastro de Auth continua legível,
  apresenta o novo produto e preserva revisão, histórico e políticas.

## Limites e autoria

As rotas `/api/v1/me`, `/api/v1/users`, `/api/v1/permissions` e `/api/v1/roles`
pertencem ao ERP. Não foram transferidas ao Auth. O schema
`erp-product-flow-definitions/1` define `product: "erp"` e uma lista `flows`;
não contém um enum `produto` nem um mapa de produtos em `productFlows`.
Os contratos comerciais recebem o identificador `auth`, não `Ávila Auth`.

Esta alteração não exige regeneração do contexto ERP, não cria regras fiscais
nem declara jornadas do Auth na tela específica de fluxos ERP.
As políticas criadas nos testes são propostas sintéticas em diretórios
temporários; nenhuma foi importada no laboratório publicado.

Estado desta evidência: implementação e validação locais na branch
`feat/auth-source-inventory`, base `94feb3b`. Não comprova publicação,
aprovação no CI ou atualização do serviço em produção.
