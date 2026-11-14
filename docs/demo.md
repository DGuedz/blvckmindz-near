# Judge walkthrough

Open [the public demo](https://blvckmindz-near-demo.vercel.app/). A prefilled recording sheet allocates 2.00 project test tokens among the label, artist and beatmaker. No wallet setup is required for this fixed sample.

| Do | See |
|---|---|
| Open the recording template | ISRC, 2.00 payment and contributor weights already filled in |
| Simulate split | Sheet → agreement → branching amounts → local result: 0.80 / 0.84 / 0.36; no transaction |
| Pause, replay or select a simulation stage | Inspect the calculation at your own pace |
| Distribute on testnet | A new invoice, approval and payout, with motion following actual execution stages |
| Wait for verification | Cards change from Expected to Received only after the token-transfer proof matches; open this run’s explorer hash |
| Reload or open the saved `?run=<UUID>` URL | Recover the same run by GET; no payment is sent again |
| Choose New test | Explicitly prepare another test instead of replaying a receipt as a new payment |
| Select songwriting or edit simulation inputs | A separate template, or a local calculation; arbitrary edited payouts are refused |
| Expand the optional network reference | An independently rechecked historical Solana devnet payment, with its own terms and transaction |

Simulation uses timed motion to explain a local calculation. Live stages follow stored execution and verified token events. A connection interruption remains unconfirmed; recovery reads the existing request. Reduced-motion mode shows the local calculation immediately.

## Hosting and capacity

The interface and a recorded payment report are static files on Vercel. New executions and saved-run recovery use Vercel’s API proxy → Cloudflare tunnel → engine on the founder’s Mac. The engine and tunnel must stay online for those operations; local simulation and the recorded report remain available without them. Public access uses explicit `--testnet-demo --public-demo` startup with the exact tunnel Host and Vercel Origin pinned. This is temporary hosting for the bounded demonstration.

All visitors share one operator-configured run budget. The default is ten; this public run uses a total cap of 25, preserving earlier runs. The interface shows availability; opening a receipt consumes no new run. Interrupted execution or evidence-export failure requires operator review before fresh payments. The read-only local mode cannot sign.

## Current audit trail

- [Successful recording payout](https://testnet.nearblocks.io/txns/7PcqjVbV9qbAbVucrvvwDNTZVNwCrNnY2vdCe7uXPcLW): [run report](../evidence/live-runs/76cd07e4-95f0-4477-8a79-becaacf31538.json).
- [Rejected repeat on the same paid batch](https://testnet.nearblocks.io/txns/E1kifDT6A77refDqUcxMNexdu5ooUvNy1m2HWqiL6Y3t): [protection proof](../evidence/protection/76cd07e4-95f0-4477-8a79-becaacf31538.json), including no new transfers or receipt.
- Application validation: **106 tests passed**. Independent verification commands are in the [README](../README.md#recheck-a-run-independently).

“Test USDC” is a project-issued token, not Circle USDC, and has no monetary value. These tests do not establish commercial payment or legal ownership. Email sign-in and external society collection are not part of this demo. The Solana reference has a different ledger and allocation; the portal does not implement a bridge or cross-network settlement. [Network boundary](network-boundary.md).
