# Contract build and deployed code

**Historical evidence:** the comparison below belongs to the earlier candidate. Security revisions in the containing working copy change both contract and application code and are not deployed or covered by the historical hash.

On 2026-11-12 we built both contracts from a separate copy of this candidate with no previous `target` directory. The build used already-cached dependencies, Rust 1.99.0, `cargo-near` 0.23.0 and the installed `wasm32-unknown-unknown` target. It ran `npm run build` with Cargo offline. This is a host build, not a guarantee of bit-for-bit reproducibility with another machine or toolchain.

| Artifact | SHA-256 |
|---|---|
| `track_account.wasm` | `08a12929b1b65f17fd4a7da89e6ae57eaaec21888511095fc5668da0e46c55ca` |
| `test_usdc.wasm` | `55ff7797814ea84b0da8380b26dcf463f21815238d43de50b72c0f0caf19528c` |

We independently queried the testnet contract `rights.bmz-d57a1390.testnet` with JSON-RPC `query`, `request_type: view_code`, at finalized block 277400748, decoded `code_base64`, and obtained the same SHA-256 as the newly built `track_account.wasm`. This establishes a byte-for-byte match for that build and deployed contract at that block. It is not an independent security audit.

The same copy then compiled the integration test suite from scratch and passed all five local sandbox tests using the newly built WASM files. The local sandbox executable was reused from an existing installation. The JavaScript dependencies were installed from the local npm cache using `npm ci --offline --ignore-scripts`; all four application tests passed, and the live testnet verifier passed 43/43 checks. These results depend on the listed environment and do not establish a production deployment.

To build and inspect the local artifacts after installing the prerequisites in the README:

```sh
cd app
npm run build
shasum -a 256 ../target/near/track_account/track_account.wasm ../target/near/test_usdc/test_usdc.wasm
```

To compare independently with the chain, use a testnet RPC's `view_code` query for the account above, decode its `code_base64` field, and calculate the SHA-256 of those bytes. The RPC is a data provider; an independently verified node provides a stronger trust model.
