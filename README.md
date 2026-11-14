# BLVCK MINDZ × NEAR

A participant sheet becomes a payment split. [Open the public demo](https://blvckmindz-near-demo.vercel.app/), simulate the allocation, then distribute the fixed sample on NEAR testnet and inspect its own payout hash.

Built for NEAR HACKATHON · primary track: Real-World Money. “Test USDC” is a project-issued token, not Circle USDC. Sample agreements and valueless test tokens only; no commercial payment, legal ownership determination or collecting-society submission is demonstrated.

## Public demo

[blvckmindz-near-demo.vercel.app](https://blvckmindz-near-demo.vercel.app/) hosts the interface and a recorded payment report directly on Vercel. New testnet executions use an API proxy through a Cloudflare tunnel to the bounded engine on the founder’s Mac. **The Mac process and tunnel must remain online for new payments and saved-run recovery.** Local simulation and the recorded report remain available independently of the tunnel.

Start with **Simulate split**; the motion explains the calculation without sending a transaction. **Distribute on testnet** creates the fixed test payment. Wait for verified recipient amounts, then open the receipt’s explorer link. Reloading or opening `?run=<UUID>` reads that run by GET and never sends another payment. Choose **New test** explicitly before starting a different run.

The deployment has a shared operator-configured run limit (default **10**, maximum **100**), across all visitors. Remaining capacity is shown in the interface. A connection failure preserves the run reference for recovery; it does not authorize another payment. [Short judge walkthrough](docs/demo.md).

## Run it, then check the transaction

The corrected contract is deployed at [`rights.bmz-718c08dd.testnet`](https://testnet.nearblocks.io/address/rights.bmz-718c08dd.testnet). The rights and project test-token WASMs are checked against their deployed bytecode: [build check](evidence/BUILD-CHECK.json).

The reviewed browser-triggered run distributed 2.00 test USDC:

| Recipient | Expected | Recorded transfer |
|---|---|---|
| Label | 0.80 | 0.80 |
| Artist | 0.84 | 0.84 |
| Beatmaker | 0.36 | 0.36 |

The final static-UI deployment also created a fresh payment: [open its transaction](https://testnet.nearblocks.io/txns/DphFTW1XiokxpqEvUcUATWvkgBvtxqa35CfdbbJ6VvFk), [run data](evidence/live-runs/90adb516-89b8-4662-98c2-5993fc39d62c.json).

[Open the payout](https://testnet.nearblocks.io/txns/7PcqjVbV9qbAbVucrvvwDNTZVNwCrNnY2vdCe7uXPcLW). [Reproducible run data](evidence/live-runs/76cd07e4-95f0-4477-8a79-becaacf31538.json). [Latest run report](evidence/LATEST-RUN.md).

[A second distribution attempt on that paid batch was rejected](https://testnet.nearblocks.io/txns/E1kifDT6A77refDqUcxMNexdu5ooUvNy1m2HWqiL6Y3t), with no token transfers or new receipt: [protection proof](evidence/protection/76cd07e4-95f0-4477-8a79-becaacf31538.json). This proves protection of that batch, not economic deduplication across different invoice IDs or networks.

A distribution receipt alone is insufficient. The verifier checks the rights-contract event and successful transfer outcomes emitted by the configured test token, comparing every recipient, amount and the total.

## Try the interface without a wallet

Requirements: Node 22 or newer.

```bash
cd app
npm ci --ignore-scripts
npm run serve -- --readonly
```

Open `http://127.0.0.1:8787`.

| Do | See |
|---|---|
| Open the demo | Recording identifier, invoice and contributor weights already filled in |
| Simulate split | The sheet enters the engine, the agreement is applied, and three branches reveal 0.80 / 0.84 / 0.36; no tokens move |
| Pause, replay or select a simulation stage | Inspect the agreement and calculation at your own pace |
| Select the songwriting template | Composition identifier and a 1.00 invoice replace the recording sample |
| Inspect/edit the agreement | Valid edits calculate new amounts; invalid contributor totals are rejected |
| Check a recorded payment | Expected and observed transfer amounts, plus its explorer link |

Read-only mode cannot create a new payout. It does not load signing keys. Public RPCs must be reachable for network evidence.

## Create your own fresh testnet runs

Requirements: Rust with `wasm32-unknown-unknown`, cargo-near 0.23.0, Node 22+. Existing contract state cannot be upgraded by replacing its WASM: this revision changed serialized batch state. Use a new isolated test account, as below.

After installing the locked Node dependencies, build the contracts and prepare the fixed samples:

```bash
cd app
npm run build
npm run setup
npm run setup:v2
npm run demo -- terms
npm run demo -- register
npm run demo -- confirm
node serve.mjs --testnet-demo
```

Setup asks the testnet faucet for a root account, creates the sample accounts and token, and deploys/initializes the contracts atomically. If the faucet is unavailable, preparation stops. All signing keys stay in git-ignored `app/.keys/`; never publish that folder. The HTTP demo accepts only the isolated test-token deployment, not Circle USDC or arbitrary assets.

Open the page and press **Distribute on testnet**. This reserves a new batch, prepares test tokens, funds its invoice, approves the fixed sample, distributes, and verifies the resulting transfers. The same visual engine follows observed execution steps. Amounts remain **Expected** until the transfer proof matches this batch and payout; only then do they become **Received**, with an explorer link. The server stores a public report in `evidence/live-runs/`. **View last testnet receipt** reads the saved run without sending another transaction.

Simulation playback is illustrative, driven by the calculated amounts; its clock never advances a live payment. Reduced-motion mode shows the completed local calculation immediately. No animation can turn a submitted hash or `Paid` state alone into a verified receipt.

The engine binds to 127.0.0.1. Public access additionally requires the explicit `--public-demo` opt-in alongside `--testnet-demo`. This deployment pins `NEAR_DEMO_PUBLIC_HOST` to the exact active Cloudflare tunnel hostname and `NEAR_DEMO_FRONTEND_ORIGIN` to `https://blvckmindz-near-demo.vercel.app`; incoming Host and Origin must match the configured access boundary. Vercel contains the public interface, shared calculation modules and selected public reports; signing remains on the Mac. `prepare-static-vercel.mjs` builds this explicit file set. The earlier `prepare-vercel.mjs` is the legacy proxy-only configuration.

Set `NEAR_DEMO_RUN_LIMIT=25` on the operator server for the reviewed public capacity. This preserves the existing run book and its receipts; it does not reset or repeat a payment. The server accepts an integer from 1 to 100, defaults to 10, and refuses invalid configuration. Check testnet gas funding before raising capacity.

The service accepts fixed sample templates and recipients, checks both deployed builds and participant confirmations, and shares one durable run budget. Duplicate request IDs reuse the saved run. Interrupted execution or failed evidence export blocks fresh payments for operator review. No general HTTP relayer is enabled. This is a bounded testnet demonstration, not a commercial payment service.

## Recheck a run independently

No signing keys are required:

```bash
cd app
npm run verify:live -- ../evidence/live-runs/76cd07e4-95f0-4477-8a79-becaacf31538.json
```

This recalculates the sample statement hash, compares the funded batch with that statement, then reads the payout and transfer events again. It does not trust the saved `matched` flag. `NEAR_RPC_URL` selects public state reads; `NEAR_ARCHIVAL_RPC_URL` selects historical transaction reads. The defaults are testnet endpoints.

After compiling locally, `npm run verify:build -- --write` compares both rights and test-token WASMs with the public deployments identified from `evidence/claims.json`. This binds bytecode; source-to-bytecode reproducibility requires the build as well.

## The business rule

An agreement sets the label/publisher’s allocation. The contributors divide the remaining pool. In the master sample: 40% label + 60% × contributor weights 70/30 → 40/42/18. Publishing uses 25% + 75% × 60/40 → 25/45/30. These are test parameters, not approved commercial terms.

The ISRC identifies a recording; the ISWC identifies a composition. The [five-flow model](docs/revenue-template.md) keeps recording, producer-neighboring, performer-neighboring, publishing-performance and publishing-mechanical income distinct. The prototype models four token records; the performer-neighboring route is informational. External registration and collection remain outside this submission.

## Validation and limits

[Review, error cases and captures](docs/audit-2026-11-14.md) · [Validation summary](evidence/VALIDATION.json) · [Public-file secret scan review](evidence/SECRET-REVIEW.json).

- **106 application tests passed** in the latest validation. They cover split parity with the shared catalog/Rust vectors, integer money allocation, invalid inputs, trusted-token transfer proofs, fixed transaction scopes, receipt/motion state boundaries and read-only server behavior. Run `cd app && npm test`.
- Contract suites can be run separately with `cargo test` at the repository root; sandbox execution/build prerequisites must be installed.
- Earlier deployment proofs, including its 43-check report, remain in `evidence/archive/`. They do not validate the revised contract. Legacy CLI `verify` targets the separate canonical m1/e1 demo; use `verify:live` for browser-generated batches.
- Only the label registers records and owns their tokens. The token contract implements NEP-171 mint events and partial views, without transfers. This does not establish legal ownership.
- Holders confirm via NEP-366 in sample preparation; the label pays gas. Email login and artist-controlled browser signing are not implemented.
- The sample approval is an operator-authorized fixed test action. Distribution also requires holder confirmations. Neither step validates a real legal agreement or a distributor statement.
- `Paid` means transfers were scheduled. Individual transfer events are checked separately. Failed transfers may be held for claims; recovery from a failed callback itself remains unfinished. This is not ready for commercial funds.
- Public transfer events reveal accounts and amounts. A hash-only receipt does not make payments private.
- The optional network section links an independently rechecked historical Solana devnet payment. It uses a different allocation and ledger. Cross-network settlement, bridging and NEAR Intents remain future work: [network boundary](docs/network-boundary.md).

## Provenance

Only the NEAR integration built during the hackathon window is submitted. The split rules and receipt format originate in the earlier BLVCK MINDZ catalog/Solana code. [Baseline and provenance limits](docs/baseline.md). This is a reviewed local export, not a claim that commit timestamps independently establish creation time.

Fonts are bundled locally with OFL notices in `app/web/assets/`. The logo and USDC coin render come from the existing BLVCK MINDZ site. The native SVG/CSS scene adapts its split paths, paper receipt and scene-clock approach for NEAR; it does not display Solana execution or card/off-ramp features. License: [MIT](LICENSE).
