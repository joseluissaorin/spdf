//! Vector encoding (contract §2): little-endian `f32`, `f16` or `i8` (q/127).
//!
//! ```
//! use spdf::{vector, Dtype};
//! let v = [0.5f32, -1.0, 0.25];
//! let bytes = vector::encode(&v, Dtype::I8);
//! assert_eq!(bytes, vec![64u8, 129, 32]); // round(63.5)=64, -127, round(31.75)=32
//! let back = vector::decode(&bytes, Dtype::I8, 3).unwrap();
//! assert!((back[0] - 64.0 / 127.0).abs() < 1e-7);
//! ```

use half::f16;

use crate::error::{Error, Result};
use crate::model::Dtype;

/// Decodes a stored vector to `f32` components.
pub fn decode(data: &[u8], dtype: Dtype, dims: usize) -> Result<Vec<f32>> {
    if data.len() != dims * dtype.size() {
        return Err(Error::Vector(format!(
            "vector has {} bytes, expected {} ({} × {})",
            data.len(),
            dims * dtype.size(),
            dims,
            dtype.as_str()
        )));
    }
    Ok(match dtype {
        Dtype::F32 => data
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        Dtype::F16 => data
            .chunks_exact(2)
            .map(|c| f16::from_le_bytes([c[0], c[1]]).to_f32())
            .collect(),
        Dtype::I8 => data.iter().map(|b| (*b as i8) as f32 / 127.0).collect(),
    })
}

/// Decodes a stored vector to `f64` components exactly as the reference
/// search does (f32/f16 exactly; i8 as q/127 computed in f64).
pub fn decode_f64(data: &[u8], dtype: Dtype, dims: usize) -> Result<Vec<f64>> {
    if data.len() != dims * dtype.size() {
        return Err(Error::Vector(format!(
            "vector has {} bytes, expected {}",
            data.len(),
            dims * dtype.size()
        )));
    }
    Ok(match dtype {
        Dtype::F32 => data
            .chunks_exact(4)
            .map(|c| f64::from(f32::from_le_bytes([c[0], c[1], c[2], c[3]])))
            .collect(),
        Dtype::F16 => data
            .chunks_exact(2)
            .map(|c| f64::from(f16::from_le_bytes([c[0], c[1]]).to_f32()))
            .collect(),
        Dtype::I8 => data.iter().map(|b| f64::from(*b as i8) / 127.0).collect(),
    })
}

/// Quantizes one component to i8: `clamp(round_half_away_from_zero(v × 127), −127, 127)`.
pub fn quantize_i8(v: f32) -> i8 {
    quantize_i8_f64(f64::from(v))
}

fn quantize_i8_f64(v: f64) -> i8 {
    let x = v * 127.0;
    let q = (x.abs() + 0.5).floor().copysign(x);
    q.clamp(-127.0, 127.0) as i8
}

/// Writer-side encoding of values given in f64 (contract §2): f32 and f16
/// round to nearest even, and a finite value that overflows the format is an
/// error; i8 = `clamp(round_half_away_from_zero(v × 127), −127, 127)`.
///
/// ```
/// use spdf::{vector, Dtype};
/// assert_eq!(vector::quantize(&[0.1, 0.333333], Dtype::F32).unwrap(), vec![0xcd, 0xcc, 0xcc, 0x3d, 0x9f, 0xaa, 0xaa, 0x3e]);
/// assert!(vector::quantize(&[65520.0], Dtype::F16).is_err());
/// ```
pub fn quantize(values: &[f64], dtype: Dtype) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(values.len() * dtype.size());
    for &v in values {
        match dtype {
            Dtype::F32 => {
                let x = v as f32;
                if x.is_infinite() && v.is_finite() {
                    return Err(Error::Vector(format!("{v} is out of range for f32")));
                }
                out.extend_from_slice(&x.to_le_bytes());
            }
            Dtype::F16 => {
                let x = f16::from_f64(v);
                if x.is_infinite() && v.is_finite() {
                    return Err(Error::Vector(format!("{v} is out of range for f16")));
                }
                out.extend_from_slice(&x.to_le_bytes());
            }
            Dtype::I8 => {
                if v.is_nan() {
                    return Err(Error::Vector("NaN cannot be quantized to i8".into()));
                }
                out.push(quantize_i8_f64(v) as u8);
            }
        }
    }
    Ok(out)
}

/// Encodes `f32` components in the given dtype (f16 round-to-nearest-even).
pub fn encode(values: &[f32], dtype: Dtype) -> Vec<u8> {
    match dtype {
        Dtype::F32 => values.iter().flat_map(|v| v.to_le_bytes()).collect(),
        Dtype::F16 => values
            .iter()
            .flat_map(|v| f16::from_f32(*v).to_le_bytes())
            .collect(),
        Dtype::I8 => values.iter().map(|v| quantize_i8(*v) as u8).collect(),
    }
}

/// Dot product in f64.
pub fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Cosine similarity in f64 (0 if either vector is zero).
pub fn cosine(a: &[f64], b: &[f64]) -> f64 {
    let na = dot(a, a).sqrt();
    let nb = dot(b, b).sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot(a, b) / (na * nb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_dtypes() {
        let v = [0.1f32, -0.75, 1.0, 0.0];
        for d in [Dtype::F32, Dtype::F16, Dtype::I8] {
            let b = encode(&v, d);
            assert_eq!(b.len(), 4 * d.size());
            let back = decode(&b, d, 4).unwrap();
            for (x, y) in v.iter().zip(&back) {
                assert!((x - y).abs() < 0.01, "{d:?}");
            }
        }
        assert!(decode(&[0u8; 3], Dtype::F32, 1).is_err());
        assert_eq!(quantize_i8(2.0), 127);
        assert_eq!(quantize_i8(-0.5), -64); // -63.5: half away from zero
    }
}
