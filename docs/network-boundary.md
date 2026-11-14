# Evidence across two networks

The portal presents an interactive NEAR testnet payout and an independent historical Solana devnet payment reference. Each has its own transaction, allocation and evidence scope. Cross-network settlement remains future work.

| Evidence | Allocation | Statement |
|---|---|---|
| Current NEAR recording demo | Label 40%, artist 42%, beatmaker 18% | October sample, three statement rows; each execution creates its own batch and payout |
| Historical Solana devnet reference | Label 50%, artist 35%, beatmaker 15% | September legacy sample, four statement rows; the portal does not create another Solana payment |

The source fixtures use the same sample recording identifier. The current agreements and ledgers differ, and these transactions do not represent one invoice settled across both networks. All assets and allocations are test samples.

## Public verification

[solana-reference.json](../evidence/solana-reference.json) records the historical signature, program, mint, original check date and current public-RPC check. The check compares transaction success, expected program, exact token-account changes, conservation and finalized signature status. It does not establish a shared NEAR invoice, legal ownership or source-to-binary correspondence of the Solana program.

The Solana portal label may say **“Historical devnet payment rechecked”** only when `liveCheck.available` and `liveCheck.matched` are both true, displaying `liveCheck.checkedAt`. An unavailable lookup remains an archived reference; a mismatch requires review. The current NEAR receipt links to the payout created by that interface execution.

## Required before cross-network settlement

1. One economic `invoiceId`, agreement version and recipient mapping, with a shared durable journal enforcing one settlement target. A new chain or batch ID must not authorize payment of the same invoice again.
2. An implemented settlement adapter for each selected asset and network. Any conversion or bridge must identify its actual liquidity/transfer integration, fees and refund/failure path.
3. A finality gate for both networks, including incomplete receipts, reorganization and uncertain broadcast handling. Recover the existing transaction before authorizing another attempt or changing networks.
4. An audit receipt binding the invoice and agreement hashes to source/destination assets, recipients, amounts, fees and the actual transaction IDs of every executed leg. Verify delivered destination amounts against the approved instruction.

The present portal provides evidence navigation between networks. Its links do not execute this future settlement flow.
