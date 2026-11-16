// Public product context; future capabilities remain explicitly proposed.
export function visionPages(source) {
  return [
    ['product', 'Product & scope', 'One participant sheet. A division people can check.', `
<p class="docs-lead">BLVCK MINDZ is a LATAM music label building a clearer path from a track’s collaborators to its payment records.</p>
<h2 id="problem">The problem we are testing</h2>
<p>A track can involve performers, producers and writers. Their roles, agreements and payment information must agree before a payment can be checked. Our hypothesis is that a participant sheet, confirmed at the source and connected to the payment record, can reduce repeated administrative work.</p>
<h2 id="journey">The participant journey</h2>
<ol><li><strong>Confirm the agreement:</strong> understand who participates and which share applies.</li><li><strong>Check the account:</strong> connect a reported amount to its source and calculate the agreed allocation.</li><li><strong>Choose how to receive:</strong> authorize a destination and verify the result.</li></ol>
<p>The NEAR demo demonstrates calculation and distribution of a prepared sample. Self-service registration, individual browser signing, commercial statement ingestion and a choice of destination chain are not implemented.</p>
<h2 id="model">Label operations and software are different scopes</h2>
<p>In a label-led release, any label participation belongs in the applicable production and release agreement. The sample allocation illustrates the calculation; it is not a published price, a universal commission or an approved commercial offer.</p>
<p>Extending the workflow to other music teams is a product hypothesis. Software pricing and a commercial service have not been validated by this testnet demo.</p>
<h2 id="control">A record participants can understand</h2>
<p>The intended workflow lets participants confirm or contest their own line and consult a portable record. Today the operator prepares the sample and confirmations. Public blockchain evidence alone does not establish independent artist control or legal ownership.</p>
<h2 id="scope-map">Match the explanation to the implementation</h2>
<p><a href="${source}/docs/claims-map.md">Open the claim → code → evidence map ↗</a>. Implemented behavior, recorded evidence and planned capabilities are listed separately.</p>`],
    ['interoperability', 'Interoperability', 'A Solana foundation. A NEAR integration.', `
<p class="docs-lead">The current portal connects evidence from two networks. Settlement of the same obligation across networks remains planned.</p>
<h2 id="today">What works today</h2>
<table><thead><tr><th>Network</th><th>Demonstrated scope</th></tr></thead><tbody><tr><td>Solana · devnet</td><td>Earlier split-payment program and an archived, independently rechecked test payment.</td></tr><tr><td>NEAR · testnet</td><td>Interactive fixed-sample invoice, approval, distribution and recipient-level proof.</td></tr></tbody></table>
<p><a href="/#networkPortal">Open the demo’s network portal →</a>. Expand Interoperability to inspect both references. They use different ledgers and agreements and are not two legs of one payment.</p>
<h2 id="foundation">What carries over from Solana</h2>
<p>The integration reuses earlier catalog allocation rules, shared calculation vectors and the batch/hash receipt format. Consistent calculation does not synchronize ownership or balances between networks.</p>
<p><a href="${source}/docs/baseline.md">Inspect the baseline ↗</a> · <a href="https://explorer.solana.com/address/Cgws98fLCjKyCiXFuCmiBdxQpMU2FqBMNTNLh1yBWwiY?cluster=devnet">Solana devnet program ↗</a></p>
<h2 id="near-role">NEAR’s role</h2>
<p>Today NEAR executes the test payment and exposes its distribution evidence. The proposed next role is coordination of an approved obligation and its settlement destination. No bridge, Intents conversion or destination-chain adapter is implemented in this demo.</p>
<h2 id="planned">Planned: receive on another network</h2>
<ol><li>Bind the revenue obligation to its agreement version and each participant’s share.</li><li>Let the participant authorize a supported destination, asset and acceptable fees.</li><li>Execute through a tested adapter, with durable tracking that prevents paying the same obligation under another chain or batch ID.</li><li>Verify the delivered amount, finality and any refund or recovery path.</li></ol>
<p>This is a proposed workflow, not an available payout option. Custody, liquidity, fees and failure handling require validation. Multiple participant destinations must not duplicate an individual obligation.</p>
<h2 id="proof">What would prove the connection</h2>
<p>A completed cross-network test must link source and destination transactions to the same approved obligation and verify delivered amounts and costs. Until then, two explorer links prove separate executions only.</p>
<p><a href="${source}/docs/network-boundary.md">Network boundary and prerequisites ↗</a></p>`],
  ];
}
