//! BASELINE (não julgado): copiado de BLVCK MINDZ solana/programs/royalty-splits/src/math.rs, anterior a 19/10/2026.
//! Mesma regra e mesmos vetores (fixtures/split-vectors.json) dos dois lados.
//! Regra de divisão, pura e sem dependência da Solana. É a mesma de `scripts/lib/split.ts`;
//! os dois lados passam pelos vetores de `fixtures/split-vectors.json`.

pub const TOTAL_BPS: u32 = 10_000;
pub const MAX_HOLDERS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitError {
    NoHolders,
    TooManyHolders,
    ZeroBps,
    BpsSumNot10000,
    RemainderIndexOutOfRange,
}

/// Pontos-base inteiros, cada titular > 0, soma exata de 10.000.
pub fn validate(bps: &[u16], remainder_index: usize) -> Result<(), SplitError> {
    if bps.is_empty() {
        return Err(SplitError::NoHolders);
    }
    if bps.len() > MAX_HOLDERS {
        return Err(SplitError::TooManyHolders);
    }
    if bps.iter().any(|&b| b == 0) {
        return Err(SplitError::ZeroBps);
    }
    if bps.iter().map(|&b| b as u32).sum::<u32>() != TOTAL_BPS {
        return Err(SplitError::BpsSumNot10000);
    }
    if remainder_index >= bps.len() {
        return Err(SplitError::RemainderIndexOutOfRange);
    }
    Ok(())
}

/// Cada parte = piso(valor × bps / 10.000). A sobra do arredondamento (no máximo
/// `bps.len() - 1` unidades de 10⁻⁶ USDC) vai inteira para `remainder_index`.
/// A soma das partes é sempre igual a `amount`.
pub fn split_amount(amount: u64, bps: &[u16], remainder_index: usize) -> Result<Vec<u64>, SplitError> {
    validate(bps, remainder_index)?;
    let mut shares: Vec<u64> = bps
        .iter()
        .map(|&b| ((amount as u128 * b as u128) / TOTAL_BPS as u128) as u64)
        .collect();
    let distributed: u64 = shares.iter().sum();
    shares[remainder_index] += amount - distributed;
    Ok(shares)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Vector {
        amount: String,
        bps: Vec<u16>,
        remainder_index: usize,
        shares: Option<Vec<String>>,
        error: Option<String>,
    }

    fn error_name(e: SplitError) -> &'static str {
        match e {
            SplitError::NoHolders => "NoHolders",
            SplitError::TooManyHolders => "TooManyHolders",
            SplitError::ZeroBps => "ZeroBps",
            SplitError::BpsSumNot10000 => "BpsSumNot10000",
            SplitError::RemainderIndexOutOfRange => "RemainderIndexOutOfRange",
        }
    }

    #[test]
    fn shared_vectors() {
        let raw = include_str!("../../../fixtures/split-vectors.json");
        let vectors: Vec<Vector> = serde_json::from_str(raw).unwrap();
        assert!(!vectors.is_empty());
        for v in vectors {
            let amount: u64 = v.amount.parse().unwrap();
            match (split_amount(amount, &v.bps, v.remainder_index), v.shares, v.error) {
                (Ok(got), Some(want), None) => {
                    let want: Vec<u64> = want.iter().map(|s| s.parse().unwrap()).collect();
                    assert_eq!(got, want, "amount={amount} bps={:?}", v.bps);
                }
                (Err(e), None, Some(want)) => assert_eq!(error_name(e), want),
                (got, want, err) => panic!("vetor divergente: {got:?} vs {want:?}/{err:?}"),
            }
        }
    }

    #[test]
    fn sum_is_always_exact() {
        let bps = [3_333u16, 3_333, 3_334];
        for amount in [0u64, 1, 2, 999_999, 1_000_001, u64::MAX] {
            let s = split_amount(amount, &bps, 2).unwrap();
            assert_eq!(s.iter().map(|&x| x as u128).sum::<u128>(), amount as u128);
        }
    }
}
