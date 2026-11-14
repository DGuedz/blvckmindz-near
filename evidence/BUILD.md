# Revised deployment / build check

Contract: `rights.bmz-718c08dd.testnet` (NEAR testnet).

The deployed and local rights WASM SHA-256 are both:

`d56d8cbb4195d28ab3299980d62e6b47dc0e9ef707525be81298b1d8f1f7da08`

The public RPC comparison is recorded in [BUILD-CHECK.json](BUILD-CHECK.json). The check compares bytecode; it does not replace a clean source build. Compile with the documented Rust/cargo-near toolchain, then run `cd app && npm run verify:build -- --write`.

The project-issued test token at `usdc.bmz-718c08dd.testnet` was also compared. Its local and deployed WASM SHA-256 are both:

`db89014e71760b88a3e5c55690a3ea58f1fed37034a08a44c9b4c6e3b44cb21a`

Both comparisons and their public block heights appear in `BUILD-CHECK.json` (14 November 2026, 18:01 UTC). Build outputs are not committed; compile both contracts before running the comparison.

Earlier deployment build records remain in `archive/` and do not validate this revised contract. Fresh browser-generated payment proofs are in `live-runs/`. The paired duplicate-payment rejection is in `protection/`.
