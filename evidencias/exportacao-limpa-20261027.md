# Exportação pública limpa

A exportação passou a preparar uma árvore nova, validar a allowlist exata,
os tamanhos e SHA-256 do manifesto e promover a saída somente após sucesso.
Um lock exclusivo impede exportações concorrentes. Falhas de geração
preservam a saída anterior; a recuperação também conserva o backup se
uma falha de sistema impedir sua restauração automática.

## Verificação observada

- Núcleo: 66 testes aprovados.
- Painel e exportação: 7 testes aprovados.
- Build TypeScript, React e MDX concluído.
- Teste integrado: publicar um sétimo JSON, retirá-lo da allowlist e gerar
  novamente removeu esse JSON e resíduos na raiz e em subdiretórios.
- Repetir o build conservou os mesmos bytes do HTML e do manifesto.
- Seleção inválida e erro de renderização conservaram a saída anterior.
- Testes de hashes corrompidos, arquivos inesperados, nomes duplicados
  e exportações concorrentes aprovados.
- Exemplo numérico: baseline 6/14; candidata 14/14.
- Exemplo de caminho: 1 aprovado, 4 reprovados, 1 inconclusivo;
  os seis resultados esperados foram verificados.

## Implantação verificada

Apenas a exportação estática foi atualizada; API e BFF mantiveram seus
contêineres existentes. A pasta anterior permanece disponível para rollback.
A promoção ocorreu por renomeação de um link temporário no mesmo diretório.

- URL: https://ml.avilaops.com/evidencias/ respondeu HTTP 200 anônimo.
- Cabeçalho preservado: X-Robots-Tag: noindex, nofollow.
- Release: /srv/avila-experiments/public-20261027-v2.
- Anterior: /srv/avila-experiments/public-20261027-v1.
- Seis JSONs baixados por HTTP conferiram com tamanho e SHA-256 do manifesto.
- SHA-256 do manifesto:
  3ea014c1d3675b9090cbb9d5f89c03fbffd4b15ffe14941822f3720504941224.
- Caminhos data/revoked.json, legacy/ghost.txt e .env responderam HTTP 404.
- Painel, API via BFF, Annif e Ultralytics mantiveram HTTP 401 anônimo.
- Inventário prévio: 1.863 MiB de RAM disponíveis, 9,4 GB livres em disco;
  os contêineres existentes estavam ativos.

Esses artefatos são exemplos sintéticos de desenvolvimento. Não constituem
holdout independente, benchmark estatístico ou integração com agentes reais.
Hashes permitem conferir correspondência de conteúdo; não impedem alteração
dos arquivos por um administrador com permissão de escrita.

## Reprodução e rollback

Execute na raiz: npm test, npm run test:custom e npm run test:path.
Em dashboard/: npm run build e npm test.
Na raiz: node scripts/verify-public.mjs.

Para reverter somente esta publicação estática no servidor:

```sh
ln -s /srv/avila-experiments/public-20261027-v1 /srv/avila-experiments/public.rollback
mv -Tf /srv/avila-experiments/public.rollback /srv/avila-experiments/public
```

Confirme antes que public.rollback não existe. Não remova volumes, não
reinicie os serviços ML e não altere a autenticação para essa reversão.
A licença permanece pendente; não houve npm publish.
