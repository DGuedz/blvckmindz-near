# Documentation → implementation → evidence

Reviewed 16 November 2026. Source mapping is not a full audit or proof that all future functionality exists. Public documentation maintenance follows the original submission and does not change the deployed payment contracts.

| Claim | Source | Evidence and boundary |
|---|---|---|
| Simulation applies the sample agreement | `app/split-engine.mjs`: `composeRight`, `allocateMoney` | `app/test/split-engine.test.mjs`, shared fixture vectors. Local arithmetic, not a payment |
| A click can create a fixed testnet payout | `app/live-demo.mjs`: `executeLiveSample`; contract `reserve_batch`, `ft_on_transfer`, `approve_batch`, `distribute` | [Saved execution](https://blvckmindz-near-demo.vercel.app/?run=b19d4dcf-c5fb-4f06-8a6d-52820cd78cd7); test token and prepared participants only |
| Received means matched transfers | `app/payment-proof.mjs`: `verifyPayment`; `app/web/engine-motion.mjs`: `liveFrame` | `app/test/payment-proof.test.mjs` rejects wrong tokens, failed transfers and mismatched amounts. Historical proof remains inspectable; no commercial revenue established |
| Reload reads the existing request | `app/web/run-reference.mjs`, `app/web/run-controller.mjs`, GET route in `app/serve.mjs` | Reference/controller tests and the saved run URL. A lookup does not create another payment |
| The same paid batch cannot be distributed again | Contract `distribute`; `app/payment-rejection.mjs` | Published rejection and tests. Not global economic deduplication |
| Solana is an earlier foundation | `contracts/track-account/src/{formula,math}.rs`, `fixtures/{formula,split}-vectors.json`, `docs/baseline.md` | Earlier private catalog rules and public devnet program; source provenance has documented limits |
| The portal shows two networks | `app/web/demo.mjs`: `networkPortal` handler; `evidence/solana-reference.json` | Independent historical Solana allocation 50/35/15 versus current NEAR sample 40/42/18. Not one invoice paid across networks |
| A participant can choose another chain | Not implemented | Planned adapter, authorization, economic identity and destination proof; no live API or button is advertised |
| The artist controls registration and confirms through the browser | Not implemented in the NEAR demo | Operator-prepared sample confirmations. The separate studio login does not establish NEAR signing authority |
| Less administration and a sustainable service | Product hypothesis | No measured savings, external recurring use or validated software price established by this demonstration |

The product journey is confirm agreements → check the account → choose how to receive. The demo demonstrates only a prepared portion of that journey. A sample label allocation does not establish commercial terms. No commercial collection, external society registration, investment product or cross-chain settlement is claimed.
