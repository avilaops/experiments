# Verificação da correção da exportação pública

## Problema e comportamento final

O build anterior copiava arquivos para uma pasta pública existente. Um arquivo
retirado da seleção podia permanecer no diretório publicado. A nova implementação
monta e valida uma árvore nova antes de promover a saída.

## Verificações locais

- `npm test` na raiz: 66 testes aprovados, zero falhas.
- `npm run build` em `dashboard`: TypeScript e build aprovados.
- `npm test` em `dashboard`: 7 testes aprovados, zero falhas.
- O teste de integração executa builds consecutivos com um artefato adicional,
  retira o artefato da lista e comprova sua remoção física da saída seguinte.
- Sentinelas inofensivas na raiz, em `data/` e em subpastas não sobrevivem ao build.
- Uma terceira execução equivalente conserva HTML e manifesto do teste.
- Uma seleção inválida não substitui a saída válida anterior.
- Testes adicionais verificam falha de renderização, integridade dos JSONs,
  arquivos inesperados, entradas duplicadas e recusa de exportadores concorrentes.
- O teste HTTP do BFF continua verificando autenticação e conflito HTTP 412.

## Limites

Esta evidência verifica o processo de build local e seus cenários declarados.
Não demonstra imunidade a falhas de disco ou interrupção abrupta do processo.
Uma falha durante a restauração preserva o backup para recuperação manual.
A trava de build não é um mecanismo de coordenação distribuída.

Nenhum container ou configuração do Caddy foi alterado para esta correção.
A exportação corrigida foi publicada em uma nova pasta por troca do link
servido. Os resultados e hashes dos relatórios selecionados foram preservados.
Veja a [verificação da publicação e o rollback](exportacao-limpa-20261027.md).

A substituição local com duas renomeações não é uma troca atômica de diretórios
servidos. O procedimento de produção deve promover uma release já validada,
conforme [DEPLOYMENT.md](../DEPLOYMENT.md).
