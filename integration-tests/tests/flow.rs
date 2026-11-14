//! Testes de ponta a ponta numa NEAR local (sandbox): os dois contratos de verdade, chamadas entre contratos
//! de verdade (ft_transfer_call → ft_on_transfer, distribute → ft_transfer → on_payout).
//! Rode `npm run build` em app/ antes, para gerar os .wasm.

use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const ISRC: &str = "PYXXX2600001";
const ISWC: &str = "T0000000001";
const HASH: &str = "9b891de68fdbd8dd7755d608c8e36115f4bb8dc5a33bbc1208e935595de791c5";
const TERMS: &str = "teste-2026-10-14";

struct Env {
    worker: Worker<Sandbox>,
    usdc: Contract,
    rights: Contract,
    label: Account,
    gate: Account,
    mc: Account,
    beat: Account,
    payer: Account,
}

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("falta {p}: rode `npm run build` em app/"))
}

async fn register_storage(usdc: &Contract, who: &Account) -> anyhow::Result<()> {
    let r = who
        .call(usdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": who.id(), "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    Ok(())
}

async fn ft_balance(e: &Env, who: &near_workspaces::AccountId) -> anyhow::Result<u128> {
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": who })).await?.json()?;
    Ok(v.parse()?)
}

/// Monta tudo. `register_beat`: false deixa o beatmaker sem registro no token, para forçar a falha de transferência.
async fn setup(register_beat: bool) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy(&wasm("test_usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let rights = worker.dev_deploy(&wasm("track_account")).await?;
    let label = worker.dev_create_account().await?;
    let gate = worker.dev_create_account().await?;
    let mc = worker.dev_create_account().await?;
    let beat = worker.dev_create_account().await?;
    let payer = worker.dev_create_account().await?;
    rights
        .call("new")
        .args_json(json!({ "owner_id": label.id(), "token_id": usdc.id(), "gate_id": gate.id() }))
        .transact()
        .await?
        .into_result()?;

    for a in [&label, &mc, &payer] {
        register_storage(&usdc, a).await?;
    }
    if register_beat {
        register_storage(&usdc, &beat).await?;
    }
    // o contrato de direitos também precisa de registro no token para receber faturas
    label
        .call(usdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": rights.id(), "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;

    label
        .call(rights.id(), "set_terms")
        .args_json(json!({ "terms": { "version": TERMS, "master_bps": 4000, "performance_bps": 2500, "mechanical_bps": 2500, "test_only": true } }))
        .transact()
        .await?
        .into_result()?;
    label
        .call(rights.id(), "register_work")
        .args_json(json!({
            "iswc": ISWC, "title": "Faixa", "terms_version": TERMS,
            "writers": [ { "account_id": mc.id(), "role": "letra", "weight": 6000 }, { "account_id": beat.id(), "role": "melodia", "weight": 4000 } ]
        }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    label
        .call(rights.id(), "register_recording")
        .args_json(json!({
            "isrc": ISRC, "title": "Faixa", "terms_version": TERMS, "iswc": ISWC,
            "artists": [ { "account_id": mc.id(), "role": "intérprete", "weight": 7000 }, { "account_id": beat.id(), "role": "produtor musical", "weight": 3000 } ]
        }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    for a in [&mc, &beat] {
        for code in [ISRC, ISWC] {
            a.call(rights.id(), "confirm_share").args_json(json!({ "code": code })).transact().await?.into_result()?;
        }
    }
    Ok(Env { worker, usdc, rights, label, gate, mc, beat, payer })
}

async fn pay_invoice(e: &Env, token_id: &str, batch: &str, amount: u128) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let right: Value = e.rights.view("get_right").args_json(json!({"token_id": token_id})).await?.json()?;
    if !right.is_null() {
        e.label.call(e.rights.id(), "reserve_batch").args_json(json!({ "batch_id": batch, "token_id": token_id, "payer_id": e.payer.id(), "amount": amount.to_string(), "ledger_hash": HASH })).deposit(NearToken::from_millinear(50)).transact().await?.into_result()?;
    }
    e.payer.call(e.usdc.id(), "faucet").args_json(json!({ "amount": amount.to_string() })).transact().await?.into_result()?;
    Ok(e
        .payer
        .call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": e.rights.id(), "amount": amount.to_string(),
            "msg": json!({ "token_id": token_id, "batch_id": batch, "ledger_hash": HASH }).to_string()
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?)
}

async fn approve_and_distribute(e: &Env, batch: &str) -> anyhow::Result<()> {
    e.gate
        .call(e.rights.id(), "approve_batch")
        .args_json(json!({ "batch_id": batch, "ledger_hash": HASH }))
        .transact()
        .await?
        .into_result()?;
    e.payer
        .call(e.rights.id(), "distribute")
        .args_json(json!({ "batch_id": batch }))
        .gas(Gas::from_tgas(250))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

#[tokio::test]
async fn full_flow_pays_exact_shares_with_real_token() -> anyhow::Result<()> {
    let e = setup(true).await?;
    let r = pay_invoice(&e, &format!("{ISRC}:master"), "m1", 2_000_000).await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(ft_balance(&e, e.payer.id()).await?, 0, "a fatura saiu inteira do pagador");
    assert_eq!(ft_balance(&e, e.rights.id()).await?, 2_000_000, "o contrato de direitos guarda a fatura até o repasse");

    approve_and_distribute(&e, "m1").await?;
    assert_eq!(ft_balance(&e, e.label.id()).await?, 800_000, "selo 40%");
    assert_eq!(ft_balance(&e, e.mc.id()).await?, 840_000, "MC 42%");
    assert_eq!(ft_balance(&e, e.beat.id()).await?, 360_000, "beatmaker 18%");
    let batch: Value = e.rights.view("get_batch").args_json(json!({ "batch_id": "m1" })).await?.json()?;
    assert_eq!(batch["status"], "Paid");

    // pagar de novo é recusado e não move dinheiro
    let again = e.payer.call(e.rights.id(), "distribute").args_json(json!({ "batch_id": "m1" })).gas(Gas::from_tgas(250)).transact().await?;
    assert!(again.is_failure());
    assert!(e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"m1"})).gas(Gas::from_tgas(100)).transact().await?.is_failure());
    assert_eq!(ft_balance(&e, e.mc.id()).await?, 840_000);
    Ok(())
}

#[tokio::test]
async fn invoice_for_unknown_right_is_refunded_by_the_token() -> anyhow::Result<()> {
    let e = setup(true).await?;
    let r = pay_invoice(&e, "PYXXX2600099:master", "x1", 500_000).await?;
    // a transação externa conclui; o ft_on_transfer recusou e o ft_resolve_transfer devolveu
    assert!(format!("{r:?}").contains("direito não existe"));
    assert_eq!(ft_balance(&e, e.payer.id()).await?, 500_000, "o pagador recebeu tudo de volta");
    let b: Value = e.rights.view("get_batch").args_json(json!({ "batch_id": "x1" })).await?.json()?;
    assert!(b.is_null(), "nenhum lote foi criado");
    Ok(())
}

#[tokio::test]
async fn failed_transfer_is_held_and_claimable() -> anyhow::Result<()> {
    let e = setup(false).await?; // beatmaker sem registro no token: a transferência dele falha
    pay_invoice(&e, &format!("{ISRC}:master"), "m1", 2_000_000).await?.into_result()?;
    approve_and_distribute(&e, "m1").await?;
    assert_eq!(ft_balance(&e, e.mc.id()).await?, 840_000, "os outros recebem normalmente");
    let owed: String = e.rights.view("get_owed").args_json(json!({ "account_id": e.beat.id() })).await?.json()?;
    assert_eq!(owed, "360000", "a parte do beatmaker ficou guardada, não sumiu");

    register_storage(&e.usdc, &e.beat).await?;
    e.beat.call(e.rights.id(), "claim").gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, e.beat.id()).await?, 360_000, "o beatmaker sacou a parte dele");
    let owed: String = e.rights.view("get_owed").args_json(json!({ "account_id": e.beat.id() })).await?.json()?;
    assert_eq!(owed, "0");
    Ok(())
}

#[tokio::test]
async fn gate_rules_hold_with_real_calls() -> anyhow::Result<()> {
    let e = setup(true).await?;
    pay_invoice(&e, &format!("{ISWC}:publishing_performance"), "e1", 1_000_000).await?.into_result()?;

    let early = e.payer.call(e.rights.id(), "distribute").args_json(json!({ "batch_id": "e1" })).gas(Gas::from_tgas(250)).transact().await?;
    assert!(early.is_failure(), "sem portão, não paga");
    let not_gate = e.payer.call(e.rights.id(), "approve_batch").args_json(json!({ "batch_id": "e1", "ledger_hash": HASH })).transact().await?;
    assert!(not_gate.is_failure(), "só o portão ou o selo aprova");
    let wrong = e.gate.call(e.rights.id(), "approve_batch").args_json(json!({ "batch_id": "e1", "ledger_hash": "0".repeat(64) })).transact().await?;
    assert!(wrong.is_failure(), "aprovação presa ao hash");

    approve_and_distribute(&e, "e1").await?;
    assert_eq!(ft_balance(&e, e.label.id()).await?, 250_000, "selo 25%");
    assert_eq!(ft_balance(&e, e.mc.id()).await?, 450_000, "letra 45%");
    assert_eq!(ft_balance(&e, e.beat.id()).await?, 300_000, "melodia 30%");
    Ok(())
}

#[tokio::test]
async fn unconfirmed_holder_blocks_payout() -> anyhow::Result<()> {
    let e = setup(true).await?;
    let newcomer = e.worker.dev_create_account().await?;
    e.label
        .call(e.rights.id(), "register_recording")
        .args_json(json!({
            "isrc": "PYXXX2600002", "title": "Outra", "terms_version": TERMS, "iswc": null,
            "artists": [ { "account_id": newcomer.id(), "role": "intérprete", "weight": 10000 } ]
        }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    pay_invoice(&e, "PYXXX2600002:master", "n1", 100_000).await?.into_result()?;
    e.gate.call(e.rights.id(), "approve_batch").args_json(json!({ "batch_id": "n1", "ledger_hash": HASH })).transact().await?.into_result()?;
    let r = e.payer.call(e.rights.id(), "distribute").args_json(json!({ "batch_id": "n1" })).gas(Gas::from_tgas(250)).transact().await?;
    assert!(r.is_failure() && format!("{r:?}").contains("falta confirmação"), "quem não confirmou trava o repasse");
    let _ = &e.usdc;
    Ok(())
}

#[tokio::test]
async fn third_party_cannot_initialize_contract() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let rights = worker.dev_deploy(&wasm("track_account")).await?;
    let attacker = worker.dev_create_account().await?;
    let args = json!({ "owner_id": attacker.id(), "token_id": attacker.id(), "gate_id": attacker.id() });
    assert!(attacker.call(rights.id(), "new").args_json(args.clone()).transact().await?.is_failure());
    rights.call("new").args_json(args).transact().await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn deploy_and_initialize_atomically() -> anyhow::Result<()> {
    use near_workspaces::operations::Function;
    let worker = near_workspaces::sandbox().await?;
    let account = worker.dev_create_account().await?;
    let owner = worker.dev_create_account().await?;
    account.batch(account.id())
        .deploy(&wasm("track_account"))
        .call(Function::new("new").args_json(json!({"owner_id":owner.id(),"token_id":owner.id(),"gate_id":owner.id()})).gas(Gas::from_tgas(30)))
        .transact().await?.into_result()?;
    let config: Value = worker.view(account.id(), "get_config").args_json(json!({})).await?.json()?;
    assert_eq!(config["owner_id"], owner.id().as_str());
    Ok(())
}

#[tokio::test]
async fn unreserved_and_wrong_payer_are_refunded_without_seizing_id() -> anyhow::Result<()> {
    let e = setup(true).await?;
    let attacker = e.worker.dev_create_account().await?;
    attacker.call(e.usdc.id(), "faucet").args_json(json!({ "amount": "3000000" })).transact().await?.into_result()?;
    let right = format!("{ISRC}:master");
    let send = |batch: &str| json!({ "receiver_id": e.rights.id(), "amount": "1000000", "msg": json!({ "token_id": right, "batch_id": batch, "ledger_hash": HASH }).to_string() });
    assert!(attacker.call(e.usdc.id(), "ft_transfer_call").args_json(send("unreserved")).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?.is_success());
    assert_eq!(ft_balance(&e, attacker.id()).await?, 3_000_000);
    let missing: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"unreserved"})).await?.json()?;
    assert!(missing.is_null());
    let without_storage = e.label.call(e.rights.id(), "reserve_batch").args_json(json!({"batch_id":"no-storage","token_id":right,"payer_id":e.payer.id(),"amount":"1000000","ledger_hash":HASH})).transact().await?;
    assert!(without_storage.is_failure());
    let absent: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"no-storage"})).await?.json()?;
    assert!(absent.is_null());
    e.label.call(e.rights.id(), "reserve_batch").args_json(json!({"batch_id":"m1","token_id":right,"payer_id":e.payer.id(),"amount":"1000000","ledger_hash":HASH})).deposit(NearToken::from_millinear(50)).transact().await?.into_result()?;
    assert!(attacker.call(e.usdc.id(), "ft_transfer_call").args_json(send("m1")).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?.is_success());
    assert_eq!(ft_balance(&e, attacker.id()).await?, 3_000_000);
    let reserved: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"m1"})).await?.json()?;
    assert_eq!(reserved["status"], "Reserved");
    e.payer.call(e.usdc.id(), "faucet").args_json(json!({"amount":"1000000"})).transact().await?.into_result()?;
    let wrong_amount = json!({ "receiver_id": e.rights.id(), "amount": "500000", "msg": json!({ "token_id": right, "batch_id": "m1", "ledger_hash": HASH }).to_string() });
    assert!(e.payer.call(e.usdc.id(), "ft_transfer_call").args_json(wrong_amount).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?.is_success());
    assert_eq!(ft_balance(&e, e.payer.id()).await?, 1_000_000);
    e.payer.call(e.usdc.id(), "ft_transfer_call").args_json(send("m1")).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?.into_result()?;
    let funded: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"m1"})).await?.json()?;
    assert_eq!(funded["status"], "Funded");
    Ok(())
}

#[tokio::test]
async fn payer_can_refund_once_before_distribution() -> anyhow::Result<()> {
    let e = setup(true).await?;
    pay_invoice(&e, &format!("{ISRC}:master"), "refund1", 1_000_000).await?.into_result()?;
    assert!(e.mc.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"refund1"})).gas(Gas::from_tgas(100)).transact().await?.is_failure());
    e.gate.call(e.rights.id(), "approve_batch").args_json(json!({"batch_id":"refund1","ledger_hash":HASH})).transact().await?.into_result()?;
    e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"refund1"})).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, e.payer.id()).await?, 1_000_000);
    let batch: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"refund1"})).await?.json()?;
    assert_eq!(batch["status"], "Refunded");
    assert!(e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"refund1"})).gas(Gas::from_tgas(100)).transact().await?.is_failure());
    assert!(e.gate.call(e.rights.id(), "approve_batch").args_json(json!({"batch_id":"refund1","ledger_hash":HASH})).transact().await?.is_failure());
    Ok(())
}

#[tokio::test]
async fn failed_refund_restores_batch_and_can_be_retried() -> anyhow::Result<()> {
    let e = setup(true).await?;
    pay_invoice(&e, &format!("{ISRC}:master"), "refund2", 1_000_000).await?.into_result()?;
    e.payer.call(e.usdc.id(), "storage_unregister").args_json(json!({"force":false})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert!(e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"refund2"})).gas(Gas::from_tgas(100)).transact().await?.is_success());
    let batch: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"refund2"})).await?.json()?;
    assert_eq!(batch["status"], "Funded");
    register_storage(&e.usdc, &e.payer).await?;
    e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"refund2"})).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, e.payer.id()).await?, 1_000_000);
    Ok(())
}

#[tokio::test]
async fn refund_and_distribution_cannot_both_win() -> anyhow::Result<()> {
    let e = setup(true).await?;
    pay_invoice(&e, &format!("{ISRC}:master"), "race1", 1_000_000).await?.into_result()?;
    e.gate.call(e.rights.id(), "approve_batch").args_json(json!({"batch_id":"race1","ledger_hash":HASH})).transact().await?.into_result()?;
    let refund = e.payer.call(e.rights.id(), "refund_batch").args_json(json!({"batch_id":"race1"})).gas(Gas::from_tgas(100)).transact();
    let payout = e.mc.call(e.rights.id(), "distribute").args_json(json!({"batch_id":"race1"})).gas(Gas::from_tgas(250)).transact();
    let (refund, payout) = tokio::join!(refund, payout);
    let (refund, payout) = (refund?, payout?);
    assert_ne!(refund.is_success(), payout.is_success(), "only one operation may succeed");
    let batch: Value = e.rights.view("get_batch").args_json(json!({"batch_id":"race1"})).await?.json()?;
    if refund.is_success() {
        assert_eq!(batch["status"], "Refunded");
        assert_eq!(ft_balance(&e, e.payer.id()).await?, 1_000_000);
        assert_eq!(ft_balance(&e, e.mc.id()).await?, 0);
    } else {
        assert_eq!(batch["status"], "Paid");
        assert_eq!(ft_balance(&e, e.payer.id()).await?, 0);
        assert_eq!(ft_balance(&e, e.mc.id()).await?, 420_000);
    }
    Ok(())
}
