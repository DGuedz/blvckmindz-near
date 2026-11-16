# Public documentation

[Open the documentation](https://blvckmindz-near-demo.vercel.app/docs/) · [Try the demo](https://blvckmindz-near-demo.vercel.app/)

The documentation explains the submitted prototype, the demonstration journey and its evidence. It does not publish private mentoring, operational credentials, commercial agreements or internal strategy.

| Page | Purpose |
|---|---|
| Overview | Product and demonstrated scope |
| Try the demo | Prefilled sample, simulation, live run and receipt recovery |
| Agreements & shares | Identifiers, allocation and separate revenue flows |
| Payment lifecycle | Reservation, funding, approval, transfer and verification |
| Verify the payment | Recorded transaction, verifier and build correspondence |
| Architecture | Vercel, VPS, NEAR and the separate Solana reference |
| Limits & trust | Operator powers, missing features and validation boundaries |

Content is curated in `app/build-docs.mjs`. Regenerate with `node app/build-docs.mjs`; generated pages are checked in under `app/web/docs/`. The static deployment copies an explicit allowlist of these pages. Navigation works without JavaScript or external fonts. The demo adds only a Docs link; its payment logic is unchanged.

This documentation and navigation were added on 16 November 2026 after submission. Earlier hosting maintenance and the original baseline are described in the repository README and `baseline.md`. Full clean Rust source reproduction is not claimed.
