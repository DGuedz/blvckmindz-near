# Provas na testnet

Conferido em 2026-11-14T09:53:06.732Z (bloco final 277640996) por `npm run verify`, sem chaves, direto do RPC `https://test.rpc.fastnear.com`.
Contrato: [rights.bmz-d57a1390.testnet](https://testnet.nearblocks.io/address/rights.bmz-d57a1390.testnet). Dados de amostra e USDC de teste, sem valor.

**43 de 43 conferências passaram.**

## Cada afirmação tem uma transação

| | Conferência | Detalhe |
|---|---|---|
| OK | [O selo publicou o contrato-modelo de TESTE (master D=40%, autoral D=25%)](https://testnet.nearblocks.io/txns/Ezwfp63Wo9qPMHamiLE985rCqoRwq3DSpeFiTnYDpB23) | terms_published |
| OK | [A composição (ISWC) foi registrada e virou dois tokens autorais](https://testnet.nearblocks.io/txns/BujB6D9KxH9rHqHgjMF1E1vmLR6gyCPmb8LTi5CjvS5a) | nft_mint |
| OK | [A gravação (ISRC) foi registrada e virou dois tokens (master e conexo de produtor)](https://testnet.nearblocks.io/txns/BeQjjTmJ1ovTBGyxL2dTyqdBpbCfSBintg72v3VZqN4s) | nft_mint |
| OK | [O MC confirmou a composição e o gas foi pago pelo selo](https://testnet.nearblocks.io/txns/EMvs9Q5mZgjxB2rj6e5TYSbFbNPAwt6R9BRkJ1rhcEfU) | gas pago por bmz-d57a1390.testnet, ação feita como mc.bmz-d57a1390.testnet |
| OK | [O MC confirmou a gravação e o gas foi pago pelo selo](https://testnet.nearblocks.io/txns/CFgh24X12YA6VNpeXubbPtBUw1TD43g6ZghvX1speUK6) | gas pago por bmz-d57a1390.testnet, ação feita como mc.bmz-d57a1390.testnet |
| OK | [O beatmaker confirmou a composição e o gas foi pago pelo selo](https://testnet.nearblocks.io/txns/5Zu5sGbqmLWhRfHBHpmWfyReQb8kJci7Qhx8S1xPhW5E) | gas pago por bmz-d57a1390.testnet, ação feita como beat.bmz-d57a1390.testnet |
| OK | [O beatmaker confirmou a gravação e o gas foi pago pelo selo](https://testnet.nearblocks.io/txns/2JJbfFBuCoS3nDfmDiR6sagn4A5CgxqXQLtUzHjtsHxp) | gas pago por bmz-d57a1390.testnet, ação feita como beat.bmz-d57a1390.testnet |
| OK | [A distribuidora pagou 2.000000 USDC de teste na fatura PYXXX2600001:master](https://testnet.nearblocks.io/txns/J4P32ArXvYyS5uYZsWu6TeEGaP1jZTB5hZH7AvsPkbir) | batch_funded |
| OK | [A distribuidora pagou 1.000000 USDC de teste na fatura T0000000001:publishing_performance](https://testnet.nearblocks.io/txns/FCjJXYfkHcGURKNY9SPXe3KG1uZ7DbSkXPYPTA7iA1Dt) | batch_funded |
| OK | [O portão aprovou só o hash do lote m1](https://testnet.nearblocks.io/txns/emBkdKAYLUvDWuAgNapAJuBQ2x9vivCGpUCpgktH6au) | batch_approved |
| OK | [O portão aprovou só o hash do lote e1](https://testnet.nearblocks.io/txns/qhWFzKpZbyEvgPWSVVHe3UoBerQdCAXjmfnrsVYuLXF) | batch_approved |
| OK | [O lote m1 foi dividido e ficou o recibo BMZ1:m1](https://testnet.nearblocks.io/txns/7dgXgEhfxDFK2Muf1GqzY2ycFK4y1qcKXeDoB1qmrVcW) | receipt |
| OK | [O lote e1 foi dividido e ficou o recibo BMZ1:e1](https://testnet.nearblocks.io/txns/8WU7q4h9qoWuH9Nqt2nnmH3Pyg9GhwuztDjF7YLaYQL4) | receipt |

## Tentativas indevidas que a rede recusou

| | Conferência | Detalhe |
|---|---|---|
| OK | [Uma conta fora da ficha tenta confirmar uma parte](https://testnet.nearblocks.io/txns/Ho2tpYU54HF5KRBFioumuZbRLg6dd6LReSfLf2GjZjqB) | recusado: "nada a confirmar" |
| OK | [A distribuidora tenta registrar uma gravação](https://testnet.nearblocks.io/txns/4zyLdRDXD7Z2MQidtYoB31gi7M7FoVhkMmmwYQFqNg41) | recusado: "só o selo" |
| OK | [O selo tenta reescrever o contrato-modelo publicado](https://testnet.nearblocks.io/txns/7UGGUy4mbSL63WXffrXCvVJCQUNnS2YDQtnqFPVjRZiF) | recusado: "versão já publicada" |
| OK | [Alguém tenta pagar de novo o lote m1, já repassado](https://testnet.nearblocks.io/txns/CKA5T2EwUtNeKTCQ2g3LssfpvW1oCKWeyWDrmsiUgea9) | recusado: "lote não aprovado ou já pago" |
| OK | [Uma conta finge ser o USDC para criar uma fatura sem dinheiro](https://testnet.nearblocks.io/txns/8juk4tvjJkkBxNst2phnBFCAusD3S6xULtZERcwqkRgr) | recusado: "token não aceito" |
| OK | [Alguém tenta pagar o lote a1 antes do portão](https://testnet.nearblocks.io/txns/9Ey8BuviNojeGqnNjs2bhJzk7Lde92NTFUeB3gy6JqG7) | recusado: "lote não aprovado ou já pago" |
| OK | [Uma conta que não é o portão tenta aprovar o lote a1](https://testnet.nearblocks.io/txns/7HJ1Va2ugducmDkGqYEKK8oDqdZh7YbifrpWUkBL5tjk) | recusado: "só o portão ou o selo" |
| OK | [O portão tenta aprovar o lote a1 com outro hash](https://testnet.nearblocks.io/txns/GeuWYabjMouBwBCETX25p8AUGJY7RkmiFPLoKi9mm9jY) | recusado: "hash diferente do lote recebido" |
| OK | [Fatura para um direito inexistente: o pagador recebe tudo de volta](https://testnet.nearblocks.io/txns/Cc7VDLnfBeZ1Cssz6GC4Es7XPXweGaAK1QGSNcdLMd1P) | contrato recusou "direito não existe"; o token devolveu ao pagador |

## Hash de cada lote recalculado do ledger

| | Conferência | Detalhe |
|---|---|---|
| OK | m1: hash recalculado do ledger = hash na rede | 9b891de68fdbd8dd7755d608c8e36115f4bb8dc5a33bbc1208e935595de791c5 |
| OK | m1: valor do ledger = valor pago | 2000000 micro-USDC |
| OK | m1: status final | Paid |
| OK | e1: hash recalculado do ledger = hash na rede | 8a344dfc0bd0802bdc0020eb1961b613b80767c68b220abc43697fdf0788a252 |
| OK | e1: valor do ledger = valor pago | 1000000 micro-USDC |
| OK | e1: status final | Paid |

## Divisão recalculada pela fórmula do selo

| | Conferência | Detalhe |
|---|---|---|
| OK | contrato-modelo marcado como teste | master 4000 · autoral 2500 bps |
| OK | PYXXX2600001:master: pontos-base da rede = fórmula recalculada aqui | 40% · 42% · 18% |
| OK | T0000000001:publishing_performance: pontos-base da rede = fórmula recalculada aqui | 25% · 45% · 30% |
| OK | T0000000001:publishing_mechanical: pontos-base da rede = fórmula recalculada aqui | 25% · 45% · 30% |
| OK | conexo de produtor: 100% para o selo |  |

## O que cada titular recebeu (eventos do token)

| | Conferência | Detalhe |
|---|---|---|
| OK | [m1: selo (EAS) (bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/7dgXgEhfxDFK2Muf1GqzY2ycFK4y1qcKXeDoB1qmrVcW) | 0.8 USDC de teste |
| OK | [m1: intérprete (mc.bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/7dgXgEhfxDFK2Muf1GqzY2ycFK4y1qcKXeDoB1qmrVcW) | 0.84 USDC de teste |
| OK | [m1: produtor musical (beat.bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/7dgXgEhfxDFK2Muf1GqzY2ycFK4y1qcKXeDoB1qmrVcW) | 0.36 USDC de teste |
| OK | m1: soma paga = valor da fatura (nada sobra, nada falta) | 2 USDC de teste |
| OK | [e1: selo (EAS) (bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/8WU7q4h9qoWuH9Nqt2nnmH3Pyg9GhwuztDjF7YLaYQL4) | 0.25 USDC de teste |
| OK | [e1: letra (mc.bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/8WU7q4h9qoWuH9Nqt2nnmH3Pyg9GhwuztDjF7YLaYQL4) | 0.45 USDC de teste |
| OK | [e1: melodia (beat.bmz-d57a1390.testnet) recebeu a parte certa](https://testnet.nearblocks.io/txns/8WU7q4h9qoWuH9Nqt2nnmH3Pyg9GhwuztDjF7YLaYQL4) | 0.3 USDC de teste |
| OK | e1: soma paga = valor da fatura (nada sobra, nada falta) | 1 USDC de teste |
| OK | mc.bmz-d57a1390.testnet: nenhuma parte retida |  |
| OK | beat.bmz-d57a1390.testnet: nenhuma parte retida |  |
