//! track-account (v2): cada DIREITO de uma faixa é um ativo NEAR (subconjunto NEP-171) com a própria divisão.
//!
//! Mesmo modelo do catálogo da BLVCK MINDZ (`docs/specs/formula-splits.md`):
//!   ISRC (a gravação)     → `master` (D_master + artistas) e `neighboring_producer` (100% EAS)
//!   ISWC (a composição)   → `publishing_performance` (D_exec + autores) e `publishing_mechanical` (D_mec + autores)
//!   O conexo de intérprete é pago direto pela sociedade e não passa por aqui.
//! O token de cada direito é `<código>:<direito>`, por exemplo `PYXXX2600001:master`.
//!
//! Fluxo (Desenho B: a EAS recebe e repassa):
//! 1. `set_terms`          o selo publica uma versão do contrato-modelo (D de cada direito). Imutável.
//! 2. `register_work`      ISWC + formulário dos autores → o contrato CALCULA os pontos-base dos dois direitos autorais.
//!    `register_recording` ISRC + formulário dos artistas (+ ISWC ligado) → master e conexo de produtor.
//! 3. `confirm_share`      cada pessoa confirma a parte dela num código (sem gas, via meta-transação).
//! 4. `ft_transfer_call`   o pagador quita a fatura de UM direito com `{token_id, batch_id, ledger_hash}`.
//! 5. `approve_batch`      o portão aprova aquele hash, e só ele.
//! 6. `distribute`         divide pelos pontos-base do direito e emite o recibo `BMZ1:<lote>:<hash>`.

mod formula;
mod math;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue, PromiseResult,
};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_PAYOUT: Gas = Gas::from_tgas(5);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_PEOPLE: usize = 7; // + a EAS = 8 linhas, o limite da regra de pagamento.
const RESERVE_EXTRA_BYTES: u64 = 2048; // Margem para aprovação e valores retidos por falha de repasse.

pub const MASTER: &str = "master";
pub const PRODUCER: &str = "neighboring_producer";
pub const PERFORMANCE: &str = "publishing_performance";
pub const MECHANICAL: &str = "publishing_mechanical";
const RIGHTS: [&str; 4] = [MASTER, PRODUCER, PERFORMANCE, MECHANICAL];

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Terms,
    Rights,
    Batches,
    Owed,
    Links,
}

/// Versão do contrato-modelo: a parte D da EAS em cada direito, em pontos-base.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Terms {
    pub version: String,
    pub master_bps: u16,
    pub performance_bps: u16,
    pub mechanical_bps: u16,
    /// true = parâmetro de teste, não decisão do selo. Aparece em todo token que usar esta versão.
    pub test_only: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Holder {
    pub account_id: AccountId,
    pub role: String,
    pub bps: u16,
    pub confirmed: bool,
}

/// Linha do formulário: quem, papel e peso no lado dos artistas (os pesos somam 10.000).
#[near(serializers = [json])]
pub struct FormLine {
    pub account_id: AccountId,
    pub role: String,
    pub weight: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Right {
    pub token_id: String,
    pub code: String,
    pub right: String,
    pub title: String,
    pub holders: Vec<Holder>,
    pub terms_version: String,
    pub test_terms: bool,
    pub registered_at_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum BatchStatus {
    Funded,
    Approved,
    Paid,
    Reserved,
    RefundPendingFunded,
    RefundPendingApproved,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Batch {
    pub batch_id: String,
    pub token_id: String,
    pub ledger_hash: String,
    pub amount: U128,
    pub payer_id: AccountId,
    pub status: BatchStatus,
    pub approved_by: Option<AccountId>,
    pub storage_paid: U128,
}

#[near(serializers = [json])]
struct InvoiceMsg {
    token_id: String,
    batch_id: String,
    ledger_hash: String,
}

#[near(serializers = [json])]
pub struct TokenView {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadataView,
}

#[near(serializers = [json])]
pub struct TokenMetadataView {
    pub title: String,
    pub description: String,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub gate_id: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// A EAS (selo): registra, recebe a parte D e a sobra do arredondamento.
    owner_id: AccountId,
    token_id: AccountId,
    gate_id: AccountId,
    terms: IterableMap<String, Terms>,
    rights: IterableMap<String, Right>,
    /// ISRC → ISWC da composição gravada.
    links: LookupMap<String, String>,
    batches: IterableMap<String, Batch>,
    owed: LookupMap<AccountId, u128>,
}

fn emit(standard: &str, version: &str, event: &str, data: near_sdk::serde_json::Value) {
    let log = near_sdk::serde_json::json!({ "standard": standard, "version": version, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

/// ISRC sem hífens: 12 caracteres A-Z/0-9.
fn valid_isrc(s: &str) -> bool {
    s.len() == 12 && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

/// ISWC sem pontuação: T + 10 dígitos.
fn valid_iswc(s: &str) -> bool {
    s.len() == 11 && s.starts_with('T') && s[1..].bytes().all(|b| b.is_ascii_digit())
}

fn valid_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn token_id(code: &str, right: &str) -> String {
    format!("{code}:{right}")
}

/// Recibo público, idêntico ao Memo da Solana: só lote e hash, sem nomes nem valores.
pub fn receipt(batch_id: &str, ledger_hash: &str) -> String {
    format!("BMZ1:{batch_id}:{ledger_hash}")
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(owner_id: AccountId, token_id: AccountId, gate_id: AccountId) -> Self {
        Self {
            owner_id,
            token_id,
            gate_id,
            terms: IterableMap::new(Key::Terms),
            rights: IterableMap::new(Key::Rights),
            links: LookupMap::new(Key::Links),
            batches: IterableMap::new(Key::Batches),
            owed: LookupMap::new(Key::Owed),
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "só o selo");
    }

    // ---------- contrato-modelo ----------

    /// Publica uma versão do contrato-modelo. Uma versão nunca muda: correção = versão nova.
    pub fn set_terms(&mut self, terms: Terms) {
        self.assert_owner();
        require!(!terms.version.is_empty() && terms.version.len() <= 40, "versão inválida");
        require!(!self.terms.contains_key(&terms.version), "versão já publicada");
        for d in [terms.master_bps, terms.performance_bps, terms.mechanical_bps] {
            require!(d as u32 <= formula::FULL, "D acima de 10.000");
        }
        emit("bmz", "2.0.0", "terms_published", near_sdk::serde_json::json!(terms));
        self.terms.insert(terms.version.clone(), terms);
    }

    fn get_terms_or_panic(&self, version: &str) -> Terms {
        self.terms.get(version).cloned().unwrap_or_else(|| env::panic_str("versão do contrato-modelo não existe"))
    }

    /// Calcula as linhas de um direito pela fórmula de duas camadas. A EAS é a primeira linha quando D > 0.
    fn compose(&self, deal: u16, form: &[FormLine]) -> Vec<Holder> {
        require!(!form.is_empty() && form.len() <= MAX_PEOPLE, "formulário com 1 a 7 pessoas");
        let mut seen = std::collections::BTreeSet::new();
        for l in form {
            require!(seen.insert(l.account_id.clone()), "pessoa repetida no formulário");
            require!(!l.role.trim().is_empty() && l.role.len() <= 32, "papel inválido");
        }
        let side: Vec<(AccountId, u32)> = form.iter().map(|l| (l.account_id.clone(), l.weight as u32)).collect();
        let rows = formula::compose_right(&self.owner_id, deal as u32, &side)
            .unwrap_or_else(|e| env::panic_str(&format!("formulário inválido: {e:?}")));
        rows.into_iter()
            .map(|(acc, bps)| {
                let role = form
                    .iter()
                    .find(|l| l.account_id == acc)
                    .map(|l| l.role.clone())
                    .unwrap_or_else(|| "selo (EAS)".to_string());
                // A EAS registra a ficha: a parte dela já nasce confirmada.
                let confirmed = acc == self.owner_id;
                Holder { account_id: acc, role, bps: bps as u16, confirmed }
            })
            .collect()
    }

    fn mint(&mut self, code: &str, right: &str, title: &str, holders: Vec<Holder>, terms: &Terms) -> String {
        let id = token_id(code, right);
        require!(!self.rights.contains_key(&id), "direito já registrado");
        self.rights.insert(
            id.clone(),
            Right {
                token_id: id.clone(),
                code: code.to_string(),
                right: right.to_string(),
                title: title.to_string(),
                holders,
                terms_version: terms.version.clone(),
                test_terms: terms.test_only,
                registered_at_ns: env::block_timestamp(),
            },
        );
        id
    }

    // ---------- registro ----------

    /// Composição (ISWC): cria os dois direitos autorais a partir do formulário dos autores.
    pub fn register_work(&mut self, iswc: String, title: String, writers: Vec<FormLine>, terms_version: String) -> Vec<String> {
        self.assert_owner();
        require!(valid_iswc(&iswc), "ISWC precisa ser T + 10 dígitos");
        require!(!title.trim().is_empty() && title.len() <= 120, "título inválido");
        let t = self.get_terms_or_panic(&terms_version);
        let perf = self.compose(t.performance_bps, &writers);
        let mech = self.compose(t.mechanical_bps, &writers);
        let ids = vec![self.mint(&iswc, PERFORMANCE, &title, perf, &t), self.mint(&iswc, MECHANICAL, &title, mech, &t)];
        emit("nep171", "1.2.0", "nft_mint", near_sdk::serde_json::json!({ "owner_id": self.owner_id, "token_ids": ids }));
        ids
    }

    /// Gravação (ISRC): master pelo formulário dos artistas + conexo de produtor 100% EAS. Liga ao ISWC, se houver.
    pub fn register_recording(
        &mut self,
        isrc: String,
        title: String,
        artists: Vec<FormLine>,
        terms_version: String,
        iswc: Option<String>,
    ) -> Vec<String> {
        self.assert_owner();
        require!(valid_isrc(&isrc), "ISRC precisa ter 12 caracteres A-Z/0-9");
        require!(!title.trim().is_empty() && title.len() <= 120, "título inválido");
        if let Some(w) = &iswc {
            require!(self.rights.contains_key(&token_id(w, PERFORMANCE)), "registre a composição (ISWC) antes");
            self.links.insert(isrc.clone(), w.clone());
        }
        let t = self.get_terms_or_panic(&terms_version);
        let master = self.compose(t.master_bps, &artists);
        let producer = vec![Holder {
            account_id: self.owner_id.clone(),
            role: "produtora fonográfica (EAS)".into(),
            bps: 10_000,
            confirmed: true,
        }];
        let ids = vec![self.mint(&isrc, MASTER, &title, master, &t), self.mint(&isrc, PRODUCER, &title, producer, &t)];
        emit("nep171", "1.2.0", "nft_mint", near_sdk::serde_json::json!({ "owner_id": self.owner_id, "token_ids": ids }));
        ids
    }

    /// A pessoa confirma a própria parte em todos os direitos de um código (ISRC ou ISWC).
    /// Pensado para ir por meta-transação (o relayer paga o gas).
    pub fn confirm_share(&mut self, code: String) -> u32 {
        let who = env::predecessor_account_id();
        let mut n = 0u32;
        for right in RIGHTS {
            let id = token_id(&code, right);
            let Some(mut r) = self.rights.get(&id).cloned() else { continue };
            if let Some(h) = r.holders.iter_mut().find(|h| h.account_id == who && !h.confirmed) {
                h.confirmed = true;
                n += 1;
                self.rights.insert(id, r);
            }
        }
        require!(n > 0, "nada a confirmar para você neste código");
        emit("bmz", "2.0.0", "share_confirmed", near_sdk::serde_json::json!({ "code": code, "account_id": who, "rights": n }));
        n
    }

    // ---------- fatura (NEP-141 ft_transfer_call) ----------

    /// O selo reserva o ID e vincula pagador, direito, valor e hash antes da transferência.
    #[payable]
    pub fn reserve_batch(&mut self, batch_id: String, token_id: String, payer_id: AccountId, amount: U128, ledger_hash: String) {
        self.assert_owner();
        require!(self.rights.contains_key(&token_id), "direito não existe");
        require!(valid_hash(&ledger_hash), "hash do ledger precisa ser sha256 em hex minúsculo");
        require!(!batch_id.is_empty() && batch_id.len() <= 40 && batch_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'), "id do lote inválido");
        require!(!self.batches.contains_key(&batch_id), "lote já recebido");
        require!(amount.0 > 0 && amount.0 <= u64::MAX as u128, "valor fora do limite");
        let before = env::storage_usage();
        self.batches.insert(batch_id.clone(), Batch { batch_id: batch_id.clone(), token_id, ledger_hash, amount, payer_id, status: BatchStatus::Reserved, approved_by: None, storage_paid: U128(0) });
        self.batches.flush();
        let bytes = env::storage_usage().saturating_sub(before) + RESERVE_EXTRA_BYTES;
        let required = env::storage_byte_cost().as_yoctonear() * u128::from(bytes);
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= required, "depósito insuficiente para armazenamento");
        self.batches.get_mut(&batch_id).unwrap().storage_paid = U128(required);
        self.batches.flush();
        if paid > required {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(paid - required)).detach();
        }
        emit("bmz", "2.0.0", "batch_reserved", near_sdk::serde_json::json!({ "batch_id": batch_id }));
    }

    pub fn cancel_reservation(&mut self, batch_id: String) {
        self.assert_owner();
        let b = self.batches.get(&batch_id).cloned().unwrap_or_else(|| env::panic_str("lote não existe"));
        require!(b.status == BatchStatus::Reserved, "fatura já financiada ou cancelada");
        self.batches.remove(&batch_id);
        Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(b.storage_paid.0)).detach();
    }

    /// Recebe USDC com `msg = {"token_id","batch_id","ledger_hash"}`. Qualquer erro devolve o valor ao pagador.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token_id, "token não aceito");
        let m: InvoiceMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("msg da fatura inválida"));
        require!(self.rights.contains_key(&m.token_id), "direito não existe");
        require!(valid_hash(&m.ledger_hash), "hash do ledger precisa ser sha256 em hex minúsculo");
        require!(
            !m.batch_id.is_empty()
                && m.batch_id.len() <= 40
                && m.batch_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'),
            "id do lote inválido"
        );
        require!(amount.0 > 0 && amount.0 <= u64::MAX as u128, "valor fora do limite");
        let mut batch = self.batches.get(&m.batch_id).cloned().unwrap_or_else(|| env::panic_str("fatura não reservada"));
        require!(batch.status == BatchStatus::Reserved, "lote já recebido");
        require!(batch.payer_id == sender_id, "pagador diferente");
        require!(batch.token_id == m.token_id && batch.ledger_hash == m.ledger_hash && batch.amount == amount, "fatura diferente da reserva");
        batch.status = BatchStatus::Funded;
        self.batches.insert(m.batch_id.clone(), batch);
        emit("bmz", "2.0.0", "batch_funded", near_sdk::serde_json::json!({ "batch_id": m.batch_id, "token_id": m.token_id }));
        PromiseOrValue::Value(U128(0))
    }

    // ---------- portão e repasse ----------

    pub fn approve_batch(&mut self, batch_id: String, ledger_hash: String) {
        let who = env::predecessor_account_id();
        require!(who == self.gate_id || who == self.owner_id, "só o portão ou o selo");
        let mut b = self.batches.get(&batch_id).cloned().unwrap_or_else(|| env::panic_str("lote não existe"));
        require!(b.status == BatchStatus::Funded, "lote não está aguardando aprovação");
        require!(b.ledger_hash == ledger_hash, "hash diferente do lote recebido");
        b.status = BatchStatus::Approved;
        b.approved_by = Some(who.clone());
        self.batches.insert(batch_id.clone(), b);
        emit("bmz", "2.0.0", "batch_approved", near_sdk::serde_json::json!({ "batch_id": batch_id, "by": who }));
    }

    /// Divide pelos pontos-base do direito e transfere. Cada transferência é uma promessa independente
    /// (a NEAR não aceita devolver promessas unidas). Devolve quantas transferências foram agendadas.
    pub fn distribute(&mut self, batch_id: String) -> u32 {
        let mut b = self.batches.get(&batch_id).cloned().unwrap_or_else(|| env::panic_str("lote não existe"));
        require!(b.status == BatchStatus::Approved, "lote não aprovado ou já pago");
        let r = self.rights.get(&b.token_id).cloned().unwrap();
        require!(r.holders.iter().all(|h| h.confirmed), "falta confirmação de algum titular");
        let bps: Vec<u16> = r.holders.iter().map(|h| h.bps).collect();
        // A sobra do arredondamento vai para a EAS (ou, se ela não estiver no direito, para a primeira linha).
        let ri = r.holders.iter().position(|h| h.account_id == self.owner_id).unwrap_or(0);
        let shares = math::split_amount(b.amount.0 as u64, &bps, ri).unwrap_or_else(|e| env::panic_str(&format!("{e:?}")));
        b.status = BatchStatus::Paid;
        self.batches.insert(batch_id.clone(), b.clone());

        let memo = receipt(&batch_id, &b.ledger_hash);
        emit("bmz", "2.0.0", "receipt", near_sdk::serde_json::json!({ "receipt": memo, "token_id": b.token_id }));

        let mut scheduled = 0u32;
        for (h, amount) in r.holders.iter().zip(shares) {
            if amount == 0 {
                continue;
            }
            ext_ft::ext(self.token_id.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(h.account_id.clone(), U128(amount as u128), Some(memo.clone()))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_ON_PAYOUT)
                        .on_payout(h.account_id.clone(), U128(amount as u128)),
                )
                .detach();
            scheduled += 1;
        }
        require!(scheduled > 0, "lote sem valor a pagar");
        scheduled
    }

    /// Se a transferência falhou, a parte fica guardada para o titular sacar.
    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: U128) -> bool {
        #[allow(deprecated)]
        match env::promise_result(0) {
            PromiseResult::Successful(_) => true,
            _ => {
                let cur = self.owed.get(&account_id).copied().unwrap_or(0);
                self.owed.insert(account_id.clone(), cur + amount.0);
                emit("bmz", "2.0.0", "payout_held", near_sdk::serde_json::json!({ "account_id": account_id, "amount": amount }));
                false
            }
        }
    }

    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.remove(&who).unwrap_or(0);
        require!(amount > 0, "nada a sacar");
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("BMZ1:claim".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_PAYOUT).on_payout(who, U128(amount)))
    }

    /// O pagador pode cancelar antes da distribuição; o estado pendente impede corrida e reembolso duplo.
    pub fn refund_batch(&mut self, batch_id: String) -> Promise {
        let mut b = self.batches.get(&batch_id).cloned().unwrap_or_else(|| env::panic_str("lote não existe"));
        require!(env::predecessor_account_id() == b.payer_id, "só o pagador");
        b.status = match b.status {
            BatchStatus::Funded => BatchStatus::RefundPendingFunded,
            BatchStatus::Approved => BatchStatus::RefundPendingApproved,
            _ => env::panic_str("lote não pode ser devolvido"),
        };
        self.batches.insert(batch_id.clone(), b.clone());
        ext_ft::ext(self.token_id.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(b.payer_id, b.amount, Some("BMZ1:refund".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_refund(batch_id))
    }

    #[private]
    pub fn on_refund(&mut self, batch_id: String) -> bool {
        let mut b = self.batches.get(&batch_id).cloned().unwrap_or_else(|| env::panic_str("lote não existe"));
        let previous = match b.status {
            BatchStatus::RefundPendingFunded => BatchStatus::Funded,
            BatchStatus::RefundPendingApproved => BatchStatus::Approved,
            _ => env::panic_str("sem devolução pendente"),
        };
        #[allow(deprecated)]
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        b.status = if success { BatchStatus::Refunded } else { previous };
        self.batches.insert(batch_id, b);
        success
    }

    // ---------- leitura ----------

    pub fn get_config(&self) -> Config {
        Config { owner_id: self.owner_id.clone(), token_id: self.token_id.clone(), gate_id: self.gate_id.clone() }
    }

    pub fn get_terms(&self, version: String) -> Option<Terms> {
        self.terms.get(&version).cloned()
    }

    pub fn get_right(&self, token_id: String) -> Option<Right> {
        self.rights.get(&token_id).cloned()
    }

    /// Todos os direitos de um código; para um ISRC, inclui os da composição ligada.
    pub fn get_rights(&self, code: String) -> Vec<Right> {
        let mut codes = vec![code.clone()];
        if let Some(w) = self.links.get(&code) {
            codes.push(w.clone());
        }
        let mut out = vec![];
        for c in codes {
            for right in RIGHTS {
                if let Some(r) = self.rights.get(&token_id(&c, right)) {
                    out.push(r.clone());
                }
            }
        }
        out
    }

    pub fn get_linked_work(&self, isrc: String) -> Option<String> {
        self.links.get(&isrc).cloned()
    }

    pub fn get_batch(&self, batch_id: String) -> Option<Batch> {
        self.batches.get(&batch_id).cloned()
    }

    /// Faturas cujo token começa por `token_prefix` (ex.: o ISRC ou o ISWC).
    pub fn list_batches(&self, token_prefix: Option<String>, from_index: Option<u32>, limit: Option<u32>) -> Vec<Batch> {
        self.batches
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter(|b| token_prefix.as_ref().map_or(true, |p| b.token_id.starts_with(p.as_str())))
            .cloned()
            .collect()
    }

    pub fn get_owed(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }

    /// Subconjunto NEP-171: cada direito como token, com a EAS como dona (Desenho B).
    pub fn nft_token(&self, token_id: String) -> Option<TokenView> {
        self.rights.get(&token_id).map(|r| TokenView {
            token_id: r.token_id.clone(),
            owner_id: self.owner_id.clone(),
            metadata: TokenMetadataView {
                title: format!("{} · {}", r.title, r.right),
                description: format!(
                    "{}contrato-modelo {}; {}",
                    if r.test_terms { "[PARÂMETROS DE TESTE] " } else { "" },
                    r.terms_version,
                    r.holders
                        .iter()
                        .map(|h| format!("{} {} {}bps", h.role, h.account_id, h.bps))
                        .collect::<Vec<_>>()
                        .join("; ")
                ),
            },
        })
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.rights.len() as u128)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    const HASH: &str = "92ad320762e315c642405c8a74a65f71a0d9b8ed922995aac07cd534ca8764bb";
    const EAS: &str = "blvckmindz.testnet";
    const ISRC: &str = "PYXXX2600001";
    const ISWC: &str = "T0000000001";
    const TERMS: &str = "teste-2026-10-14";

    fn ctx(pred: &str) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("registry.blvckmindz.testnet"))
            .predecessor_account_id(acc(pred))
            .build());
    }

    fn ctx_with_deposit(pred: &str) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("registry.blvckmindz.testnet"))
            .predecessor_account_id(acc(pred))
            .attached_deposit(NearToken::from_millinear(50))
            .build());
    }

    fn line(a: &str, role: &str, w: u16) -> FormLine {
        FormLine { account_id: acc(a), role: role.into(), weight: w }
    }

    fn setup() -> Contract {
        ctx(EAS);
        let mut c = Contract::new(acc(EAS), acc("usdc.testnet"), acc("gate.testnet"));
        c.set_terms(Terms { version: TERMS.into(), master_bps: 4000, performance_bps: 2500, mechanical_bps: 2500, test_only: true });
        c.register_work(ISWC.into(), "Faixa".into(), vec![line("mc.testnet", "letra", 6000), line("beat.testnet", "melodia", 4000)], TERMS.into());
        c.register_recording(
            ISRC.into(),
            "Faixa".into(),
            vec![line("mc.testnet", "intérprete", 7000), line("beat.testnet", "produtor musical", 3000)],
            TERMS.into(),
            Some(ISWC.into()),
        );
        c
    }

    fn bps(c: &Contract, id: &str) -> Vec<(String, u16)> {
        c.get_right(id.into()).unwrap().holders.iter().map(|h| (h.account_id.to_string(), h.bps)).collect()
    }

    fn fund(c: &mut Contract, batch: &str, token: &str, amount: u128) {
        ctx_with_deposit(EAS);
        c.reserve_batch(batch.into(), token.into(), acc("distribuidora.testnet"), U128(amount), HASH.into());
        ctx("usdc.testnet");
        let msg = format!(r#"{{"token_id":"{token}","batch_id":"{batch}","ledger_hash":"{HASH}"}}"#);
        let _ = c.ft_on_transfer(acc("distribuidora.testnet"), U128(amount), msg);
    }

    #[test]
    fn rights_follow_two_layer_formula() {
        let c = setup();
        assert_eq!(
            bps(&c, "PYXXX2600001:master"),
            vec![(EAS.into(), 4000), ("mc.testnet".into(), 4200), ("beat.testnet".into(), 1800)]
        );
        assert_eq!(bps(&c, "PYXXX2600001:neighboring_producer"), vec![(EAS.into(), 10000)]);
        assert_eq!(
            bps(&c, "T0000000001:publishing_performance"),
            vec![(EAS.into(), 2500), ("mc.testnet".into(), 4500), ("beat.testnet".into(), 3000)]
        );
        assert_eq!(c.nft_total_supply().0, 4);
        assert_eq!(c.get_rights(ISRC.into()).len(), 4, "o ISRC mostra também os direitos da composição ligada");
        assert!(c.nft_token("PYXXX2600001:master".into()).unwrap().metadata.description.starts_with("[PARÂMETROS DE TESTE]"));
        assert!(get_logs().iter().any(|l| l.contains("nft_mint") && l.contains("PYXXX2600001:master")));
    }

    #[test]
    #[should_panic(expected = "versão já publicada")]
    fn terms_are_immutable() {
        let mut c = setup();
        ctx(EAS);
        c.set_terms(Terms { version: TERMS.into(), master_bps: 1, performance_bps: 1, mechanical_bps: 1, test_only: true });
    }

    #[test]
    #[should_panic(expected = "formulário inválido")]
    fn form_must_sum_10000() {
        let mut c = setup();
        ctx(EAS);
        c.register_recording("PYXXX2600002".into(), "x".into(), vec![line("mc.testnet", "a", 9000)], TERMS.into(), None);
    }

    #[test]
    #[should_panic(expected = "registre a composição")]
    fn recording_needs_registered_work() {
        let mut c = setup();
        ctx(EAS);
        c.register_recording("PYXXX2600003".into(), "x".into(), vec![line("mc.testnet", "a", 10000)], TERMS.into(), Some("T0000000009".into()));
    }

    #[test]
    #[should_panic(expected = "só o selo")]
    fn only_label_registers() {
        let mut c = setup();
        ctx("mc.testnet");
        c.register_work("T0000000002".into(), "x".into(), vec![], TERMS.into());
    }

    #[test]
    fn confirm_covers_every_right_of_the_code() {
        let mut c = setup();
        ctx("mc.testnet");
        assert_eq!(c.confirm_share(ISWC.into()), 2);
        assert_eq!(c.confirm_share(ISRC.into()), 1, "no ISRC o MC só está no master");
    }

    #[test]
    #[should_panic(expected = "nada a confirmar")]
    fn stranger_cannot_confirm() {
        let mut c = setup();
        ctx("estranho.testnet");
        c.confirm_share(ISRC.into());
    }

    #[test]
    #[should_panic(expected = "token não aceito")]
    fn rejects_other_token() {
        let mut c = setup();
        ctx("fake-usdc.testnet");
        let _ = c.ft_on_transfer(acc("x.testnet"), U128(1), "{}".into());
    }

    #[test]
    #[should_panic(expected = "só o selo")]
    fn only_label_can_reserve_batch() {
        let mut c = setup();
        ctx("estranho.testnet");
        c.reserve_batch("evil".into(), "PYXXX2600001:master".into(), acc("estranho.testnet"), U128(1), HASH.into());
    }

    #[test]
    fn reservations_are_paid_paginated_and_do_not_stop_after_100() {
        let mut c = setup();
        for i in 0..101 {
            if i % 20 == 0 { ctx_with_deposit(EAS); }
            c.reserve_batch(format!("b{i}"), "PYXXX2600001:master".into(), acc("distribuidora.testnet"), U128(1), HASH.into());
            if i < 100 { c.batches.get_mut(&format!("b{i}")).unwrap().status = BatchStatus::Paid; }
        }
        assert_eq!(c.list_batches(None, Some(0), Some(200)).len(), 100);
        assert_eq!(c.list_batches(None, Some(100), Some(100)).len(), 1);
        c.cancel_reservation("b100".into());
        assert_eq!(c.batches.len(), 100);
    }

    #[test]
    #[should_panic(expected = "depósito insuficiente para armazenamento")]
    fn reservation_requires_storage_deposit() {
        let mut c = setup();
        ctx(EAS);
        c.reserve_batch("unpaid".into(), "PYXXX2600001:master".into(), acc("distribuidora.testnet"), U128(1), HASH.into());
    }

    #[test]
    #[should_panic(expected = "hash diferente")]
    fn approval_is_bound_to_hash() {
        let mut c = setup();
        fund(&mut c, "1", "PYXXX2600001:master", 1_000_000);
        ctx("gate.testnet");
        c.approve_batch("1".into(), "0".repeat(64));
    }

    #[test]
    #[should_panic(expected = "falta confirmação")]
    fn needs_every_confirmation() {
        let mut c = setup();
        fund(&mut c, "1", "PYXXX2600001:master", 1_000_000);
        ctx("gate.testnet");
        c.approve_batch("1".into(), HASH.into());
        c.distribute("1".into());
    }

    #[test]
    #[should_panic(expected = "lote não aprovado")]
    fn cannot_pay_without_gate() {
        let mut c = setup();
        fund(&mut c, "1", "PYXXX2600001:neighboring_producer", 1_000_000);
        c.distribute("1".into());
    }

    #[test]
    fn producer_right_pays_label_without_confirmations() {
        let mut c = setup();
        fund(&mut c, "p1", "PYXXX2600001:neighboring_producer", 500_000);
        ctx("gate.testnet");
        c.approve_batch("p1".into(), HASH.into());
        assert_eq!(c.distribute("p1".into()), 1);
    }

    #[test]
    fn full_flow_pays_once_with_receipt() {
        let mut c = setup();
        for a in ["mc.testnet", "beat.testnet"] {
            ctx(a);
            c.confirm_share(ISRC.into());
        }
        fund(&mut c, "1", "PYXXX2600001:master", 2_000_001);
        ctx("gate.testnet");
        c.approve_batch("1".into(), HASH.into());
        ctx("qualquer.testnet");
        assert_eq!(c.distribute("1".into()), 3);
        assert_eq!(c.get_batch("1".into()).unwrap().status, BatchStatus::Paid);
        assert!(get_logs().iter().any(|l| l.contains(&receipt("1", HASH))));
        let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.distribute("1".into());
        }));
        assert!(again.is_err(), "o mesmo lote não pode pagar duas vezes");
    }

    #[test]
    fn receipt_matches_solana_memo_format() {
        assert_eq!(receipt("7", HASH), format!("BMZ1:7:{HASH}"));
    }
}
