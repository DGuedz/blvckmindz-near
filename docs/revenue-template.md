# One track, five revenue flows

This submission uses BLVCK MINDZ's existing business model as a template. The ISRC identifies the recording; the ISWC identifies the composition. They do not themselves establish ownership or contractual percentages. The five flows are distinct revenue categories, not a five-way division of one payment. Routes and allocations depend on verified agreements, territory and collection mandates.

| Flow | Identifier | Local contract support | Historical invoice evidence |
|---|---|---|---|
| Master | ISRC | Token record; label allocation plus recording contributors | m1: 2.00 test USDC |
| Producer neighboring right | ISRC | Token record; assigned to label in sample | None |
| Performer neighboring right | ISRC | Informational only; no token or payout logic | None |
| Publishing performance | ISWC | Token record; publisher allocation plus writers | e1: 1.00 test USDC |
| Publishing mechanical | ISWC | Token record; publisher allocation plus writers | None |

The sample terms allocate 40% of master revenue to the label, leaving 60% divided between the sample contributors in weights 70/30: final shares 40/42/18. Publishing sample terms allocate 25% to the label and 75% to writers with weights 60/40: final shares 25/45/30. These are test parameters, not approved commercial terms. Point allocation uses the largest-remainder method; cash allocation uses integer micro-units with its own remainder rule. Do not conflate those two operations.

Each managed flow should be inspected through the same sequence: terms version and participants → confirmations → invoice source, right, amount and statement hash → authorized approval → scheduled distribution → transfer outcomes and reconciliation. The revised contract at `rights.bmz-718c08dd.testnet` adds prior invoice reservation and a refund path. Fresh browser-generated payout reports are in `evidence/live-runs/`; earlier proofs remain archived.

The performer neighboring flow remains an external informational route. Do not route its income into the label's contract or mint a fifth token just to fill the diagram. No external distributor or collecting-society integration is implemented. A future import must identify the actual source/period/currency and prevent duplicate ingestion or collection before claiming reconciliation.

For the demonstration, start with master m1 and use publishing e1 to show that the template can follow another right with different participants and terms. The other flows are explicit coverage limits. Source, build, deployment and evidence must refer to the same release before claiming the revised flow is demonstrated end to end.
