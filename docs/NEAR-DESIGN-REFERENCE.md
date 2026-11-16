# NEAR interface reference and BLVCK MINDZ alignment

Study prepared on November 16, 2026, after submission. This records a local presentation proposal, not a feature built during the hackathon window. No production deployment accompanies this document.

Sources: [NEAR announcement](https://x.com/NEARProtocol/status/2122238251494723783), [near.com](https://near.com/), [account entry](https://near.com/home). Only the public landing page and its embedded interactive preview were inspected. The account route presented sign-in; no account was created, wallet connected or financial operation performed.

## Measured reference

Computed browser styles on the public page: Figtree; headline 60/60 px at weight 500; sample balance 36/40 px at weight 500; main action 48 px high with 12 px radius and 16 px label; embedded account actions 40 px high with 10 px radius and 14 px label. The extracted palette uses white, near-black #171717 and accent #00EC97. These are observed component measurements, not an official design-system specification. Framework/library labels from automatic extraction were not independently verified.

## Application to this product

| Reference principle | BLVCK MINDZ application |
|---|---|
| A clear primary financial number | Show the selected invoice amount; never label demo income as an available account balance |
| Actions separated from data | Keep inputs, calculation and receipt in the existing layout from the video |
| One clear next action | Emphasize Simulate initially, Distribute after the simulation, and View receipt after verified execution |
| Quiet secondary controls | Keep Replay, the repeated continuation button and optional disclosures secondary |
| Consistent numeric alignment | Preserve tabular money figures, shared card baselines and right-aligned comparison columns |
| Summary before detail | Keep amounts visible; transaction metadata and rights explanation remain available through existing disclosures |

## Brand boundary

Use BLVCK MINDZ tokens: #050505 background, #EDEBE6 text, #BDB8AE secondary text, #66FFDD action and #E8E4DA paper. Preserve the canonical SVG, Chomsky for the brand, Anton for presentation assets, and Inter Tight for the product interface. Keep existing card and paper radii rather than importing NEAR's rounded controls wholesale. Keep the native metallic scrollbar and the measured diagram corrections.

The account summary, trading categories, balances and navigation from near.com are not introduced here. Our user needs to understand a musical agreement and a specific payment, without needing trading knowledge or a new wallet.

## Functional boundary

The reference advertises confidential account operations and cross-network features. This integration demonstrates fixed sample agreements and a public NEAR testnet distribution. It does not implement confidential balances, passkey sign-in, cross-chain settlement, distributor collection or a commercial withdrawal flow. The Solana reference remains an independent historical devnet payment.

## Local code adjustment

CSS promotes the existing next-action button according to the motion component's existing mode and completion state. Disabled controls stay disabled. The continuation below the diagram remains available with secondary styling. No JavaScript, contracts, amounts, recipients, proof conditions or API configuration change in this step.

Local preview: `http://127.0.0.1:8791/` is read-only. Its payment controls remain disabled; this prevents a presentation preview from signing transactions.
