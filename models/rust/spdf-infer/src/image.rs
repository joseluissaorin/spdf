//! Reference image preprocessing for EmbeddingGemma 2 / Gemma 4 vision.
//!
//! The bench showed that letting llama.cpp resize images costs ~1 % of cosine (0.977–0.990 against
//! the reference), while resizing exactly like the reference processor first gives 0.9996+.
//! So spdf-infer resizes itself: aspect-preserving target size for a soft-token budget
//! (transformers' `get_aspect_ratio_preserving_size`) and bicubic resampling with antialias
//! (a port of Pillow's `ImagingResample`, which torchvision's uint8 antialias path reproduces).

use crate::{Error, Result};

/// Decoded RGB8 image.
#[derive(Clone)]
pub struct Rgb {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

/// Decodes PNG/JPEG/WebP/GIF/BMP/TIFF to RGB8 (alpha dropped, like PIL's `convert("RGB")`).
pub fn decode(bytes: &[u8]) -> Result<Rgb> {
    let img = image::load_from_memory(bytes).map_err(|e| Error::Input(format!("image decode: {e}")))?;
    let rgb = img.to_rgb8();
    Ok(Rgb { width: rgb.width(), height: rgb.height(), data: rgb.into_raw() })
}

/// Target (width, height) for a soft-token budget: largest size with at most
/// `max_soft_tokens × pooling²` patches of `patch`×`patch`, sides multiple of `pooling × patch`.
pub fn target_size(width: u32, height: u32, max_soft_tokens: u32, patch: u32, pooling: u32) -> (u32, u32) {
    let max_patches = (max_soft_tokens * pooling * pooling) as f64;
    let target_px = max_patches * (patch * patch) as f64;
    let (h, w) = (height as f64, width as f64);
    let factor = (target_px / (h * w)).sqrt();
    let side = (pooling * patch) as f64;
    let mut th = ((factor * h / side).floor() * side) as u32;
    let mut tw = ((factor * w / side).floor() * side) as u32;
    let max_side = ((max_patches as u32) / (pooling * pooling)) * (pooling * patch);
    if th == 0 {
        th = pooling * patch;
        tw = (((w / h).floor() as u32) * pooling * patch).min(max_side);
    } else if tw == 0 {
        tw = pooling * patch;
        th = (((h / w).floor() as u32) * pooling * patch).min(max_side);
    }
    (tw, th)
}

/// Reference preprocessing: resize to the target size for the budget (no-op if already there).
pub fn preprocess(img: &Rgb, max_soft_tokens: u32) -> Rgb {
    let (tw, th) = target_size(img.width, img.height, max_soft_tokens, 16, 3);
    if (tw, th) == (img.width, img.height) {
        return img.clone();
    }
    resize_bicubic(img, tw, th)
}

fn bicubic(x: f64) -> f64 {
    const A: f64 = -0.5;
    let x = x.abs();
    if x < 1.0 {
        ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0
    } else if x < 2.0 {
        (((x - 5.0) * x + 8.0) * x - 4.0) * A
    } else {
        0.0
    }
}

const PRECISION_BITS: u32 = 32 - 8 - 2;

/// Pillow `precompute_coeffs` + `normalize_coeffs_8bpc`.
fn coeffs(in_size: usize, out_size: usize) -> (usize, Vec<(usize, usize)>, Vec<i32>) {
    let scale = in_size as f64 / out_size as f64;
    let filterscale = scale.max(1.0);
    let support = 2.0 * filterscale;
    let ksize = support.ceil() as usize * 2 + 1;
    let mut bounds = Vec::with_capacity(out_size);
    let mut kk = vec![0i32; out_size * ksize];
    let mut k = vec![0f64; ksize];
    for xx in 0..out_size {
        let center = (xx as f64 + 0.5) * scale;
        let ss = 1.0 / filterscale;
        let xmin = ((center - support + 0.5) as i64).max(0) as usize;
        let xmax = ((center + support + 0.5) as i64).min(in_size as i64) as usize - xmin;
        let mut ww = 0.0;
        for x in 0..xmax {
            let w = bicubic((x as f64 + xmin as f64 - center + 0.5) * ss);
            k[x] = w;
            ww += w;
        }
        for x in 0..ksize {
            let v = if x < xmax && ww != 0.0 { k[x] / ww } else if x < xmax { k[x] } else { 0.0 };
            let scaled = v * (1u64 << PRECISION_BITS) as f64;
            kk[xx * ksize + x] = if v < 0.0 { (scaled - 0.5) as i32 } else { (scaled + 0.5) as i32 };
        }
        bounds.push((xmin, xmax));
    }
    (ksize, bounds, kk)
}

#[inline]
fn clip8(v: i64) -> u8 {
    let v = v >> PRECISION_BITS;
    v.clamp(0, 255) as u8
}

/// Bicubic resize with antialias, Pillow-exact for 8-bit RGB (horizontal pass, then vertical).
pub fn resize_bicubic(img: &Rgb, out_w: u32, out_h: u32) -> Rgb {
    let (iw, ih) = (img.width as usize, img.height as usize);
    let (ow, oh) = (out_w as usize, out_h as usize);
    // horizontal
    let tmp: Vec<u8> = if ow != iw {
        let (ksize, bounds, kk) = coeffs(iw, ow);
        let mut out = vec![0u8; ow * ih * 3];
        for y in 0..ih {
            let row = &img.data[y * iw * 3..(y + 1) * iw * 3];
            for xx in 0..ow {
                let (xmin, xmax) = bounds[xx];
                let k = &kk[xx * ksize..xx * ksize + xmax];
                let mut s = [1i64 << (PRECISION_BITS - 1); 3];
                for (x, &w) in k.iter().enumerate() {
                    let p = (xmin + x) * 3;
                    s[0] += row[p] as i64 * w as i64;
                    s[1] += row[p + 1] as i64 * w as i64;
                    s[2] += row[p + 2] as i64 * w as i64;
                }
                let o = (y * ow + xx) * 3;
                out[o] = clip8(s[0]);
                out[o + 1] = clip8(s[1]);
                out[o + 2] = clip8(s[2]);
            }
        }
        out
    } else {
        img.data.clone()
    };
    if oh == ih {
        return Rgb { width: out_w, height: out_h, data: tmp };
    }
    // vertical
    let (ksize, bounds, kk) = coeffs(ih, oh);
    let mut out = vec![0u8; ow * oh * 3];
    for yy in 0..oh {
        let (ymin, ymax) = bounds[yy];
        let k = &kk[yy * ksize..yy * ksize + ymax];
        for x in 0..ow {
            let mut s = [1i64 << (PRECISION_BITS - 1); 3];
            for (y, &w) in k.iter().enumerate() {
                let p = ((ymin + y) * ow + x) * 3;
                s[0] += tmp[p] as i64 * w as i64;
                s[1] += tmp[p + 1] as i64 * w as i64;
                s[2] += tmp[p + 2] as i64 * w as i64;
            }
            let o = (yy * ow + x) * 3;
            out[o] = clip8(s[0]);
            out[o + 1] = clip8(s[1]);
            out[o + 2] = clip8(s[2]);
        }
    }
    Rgb { width: out_w, height: out_h, data: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_sizes_match_transformers() {
        // values computed with transformers 5.19 Gemma4ImageProcessor (budget 280)
        assert_eq!(target_size(843, 1265, 280, 16, 3), (624, 960));
        assert_eq!(target_size(843, 1014, 280, 16, 3), (720, 864));
        assert_eq!(target_size(843, 621, 280, 16, 3), (912, 672));
    }

    #[test]
    fn identity_when_same_size() {
        let img = Rgb { width: 48, height: 48, data: (0..48 * 48 * 3).map(|i| (i % 251) as u8).collect() };
        let r = resize_bicubic(&img, 48, 48);
        assert_eq!(r.data, img.data);
    }
}
