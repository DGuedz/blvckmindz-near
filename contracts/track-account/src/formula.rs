//! Fórmula de duas camadas da BLVCK MINDZ, em Rust. Porta fiel de `services/catalog/src/domain/formula.ts`
//! (baseline, 2026-10-07), conferida pelos vetores de `fixtures/formula-vectors.json`, gerados pelo código original.
//!
//!   bps(EAS)       = D                    (contrato-modelo: igual para todos na mesma versão)
//!   bps(pessoa i)  = (10.000 − D) × s_i   (formulário: s soma 10.000), arredondado pelo maior resto
//!
//! Empate no resto: vale a ordem da lista. Se a EAS também aparece no formulário, as linhas se somam.

pub const FULL: u32 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormulaError {
    DealOutOfRange,
    SideNotFull,
    ZeroShare,
    ShareTooSmall(usize),
}

/// Divide `pool` pontos-base proporcionalmente a `side` (soma 10.000) pelo maior resto.
pub fn apportion(pool: u32, side: &[u32]) -> Result<Vec<u32>, FormulaError> {
    if pool > FULL {
        return Err(FormulaError::DealOutOfRange);
    }
    if side.iter().any(|&s| s == 0) {
        return Err(FormulaError::ZeroShare);
    }
    if side.iter().sum::<u32>() != FULL {
        return Err(FormulaError::SideNotFull);
    }
    if pool == 0 {
        return Ok(vec![]);
    }
    let mut out: Vec<u32> = side.iter().map(|&s| pool * s / FULL).collect();
    let rest: Vec<u32> = side.iter().map(|&s| pool * s % FULL).collect();
    let mut left = pool - out.iter().sum::<u32>();
    let mut order: Vec<usize> = (0..side.len()).collect();
    order.sort_by(|&a, &b| rest[b].cmp(&rest[a]).then(a.cmp(&b)));
    for i in order {
        if left == 0 {
            break;
        }
        out[i] += 1;
        left -= 1;
    }
    if let Some(i) = out.iter().position(|&b| b == 0) {
        return Err(FormulaError::ShareTooSmall(i));
    }
    Ok(out)
}

/// Linhas finais de um direito: EAS primeiro (se D > 0), depois o lado dos artistas; chaves repetidas se somam.
/// Soma sempre 10.000.
pub fn compose_right<K: Clone + PartialEq>(eas: &K, deal: u32, side: &[(K, u32)]) -> Result<Vec<(K, u32)>, FormulaError> {
    if deal > FULL {
        return Err(FormulaError::DealOutOfRange);
    }
    let weights: Vec<u32> = side.iter().map(|(_, w)| *w).collect();
    let parts = apportion(FULL - deal, &weights)?;
    let mut rows: Vec<(K, u32)> = Vec::new();
    if deal > 0 {
        rows.push((eas.clone(), deal));
    }
    for ((k, _), bps) in side.iter().zip(parts) {
        match rows.iter_mut().find(|(rk, _)| rk == k) {
            Some(r) => r.1 += bps,
            None => rows.push((k.clone(), bps)),
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct V {
        deal: u32,
        side: Vec<u32>,
        rows: Option<Vec<(String, u32)>>,
        error: Option<String>,
    }

    #[test]
    fn same_result_as_catalog_formula() {
        let vs: Vec<V> = serde_json::from_str(include_str!("../../../fixtures/formula-vectors.json")).unwrap();
        assert!(vs.len() > 40);
        for v in vs {
            let side: Vec<(String, u32)> = v.side.iter().enumerate().map(|(i, &b)| (format!("p{i}"), b)).collect();
            match (compose_right(&"eas".to_string(), v.deal, &side), v.rows, v.error) {
                (Ok(got), Some(want), None) => assert_eq!(got, want, "deal={} side={:?}", v.deal, v.side),
                (Err(_), None, Some(_)) => {}
                (got, want, err) => panic!("divergente deal={} side={:?}: {got:?} vs {want:?}/{err:?}", v.deal, v.side),
            }
        }
    }

    #[test]
    fn doc_example() {
        // docs/specs/formula-splits.md: D = 50%, MC 70% e beatmaker 30% → EAS 50 · MC 35 · beatmaker 15.
        let r = compose_right(&"eas", 5000, &[("mc", 7000), ("beat", 3000)]).unwrap();
        assert_eq!(r, vec![("eas", 5000), ("mc", 3500), ("beat", 1500)]);
    }
}
