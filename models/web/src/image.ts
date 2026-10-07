// Reference image preprocessing for EmbeddingGemma 2 (same as spdf-infer's image.rs):
// aspect-preserving target size for a soft-token budget, then Pillow's antialiased bicubic.

export interface RGBImage {
  width: number;
  height: number;
  /** RGB8, row-major, 3 bytes per pixel. */
  data: Uint8Array | Uint8ClampedArray;
}

export function targetSize(width: number, height: number, maxSoftTokens = 280, patch = 16, pooling = 3): [number, number] {
  const maxPatches = maxSoftTokens * pooling * pooling;
  const targetPx = maxPatches * patch * patch;
  const factor = Math.sqrt(targetPx / (height * width));
  const side = pooling * patch;
  let th = Math.floor((factor * height) / side) * side;
  let tw = Math.floor((factor * width) / side) * side;
  const maxSide = (maxPatches / (pooling * pooling)) * side;
  if (th === 0) {
    th = side;
    tw = Math.min(Math.floor(width / height) * side, maxSide);
  } else if (tw === 0) {
    tw = side;
    th = Math.min(Math.floor(height / width) * side, maxSide);
  }
  return [tw, th];
}

function bicubic(x: number): number {
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;

function coeffs(inSize: number, outSize: number) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 2 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const k = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = bicubic((x + xmin - center + 0.5) * ss);
      k[x] = w;
      ww += w;
    }
    for (let x = 0; x < ksize; x++) {
      const v = x < xmax ? (ww !== 0 ? k[x] / ww : k[x]) : 0;
      kk[xx * ksize + x] = v < 0 ? Math.trunc(v * ONE - 0.5) : Math.trunc(v * ONE + 0.5);
    }
    bounds[2 * xx] = xmin;
    bounds[2 * xx + 1] = xmax;
  }
  return { ksize, bounds, kk };
}

const clip8 = (v: number) => {
  // v is an integer accumulator; >> PRECISION_BITS done with division to stay exact beyond 32 bits
  const r = Math.floor(v / ONE);
  return r < 0 ? 0 : r > 255 ? 255 : r;
};

/** Pillow-exact bicubic resize with antialias for RGB8 (horizontal pass, then vertical). */
export function resizeBicubic(img: RGBImage, outW: number, outH: number): RGBImage {
  const { width: iw, height: ih } = img;
  let tmp: Uint8Array;
  if (outW !== iw) {
    const { ksize, bounds, kk } = coeffs(iw, outW);
    tmp = new Uint8Array(outW * ih * 3);
    for (let y = 0; y < ih; y++) {
      const row = y * iw * 3;
      for (let xx = 0; xx < outW; xx++) {
        const xmin = bounds[2 * xx], xmax = bounds[2 * xx + 1];
        let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2;
        for (let x = 0; x < xmax; x++) {
          const w = kk[xx * ksize + x];
          const p = row + (xmin + x) * 3;
          s0 += img.data[p] * w;
          s1 += img.data[p + 1] * w;
          s2 += img.data[p + 2] * w;
        }
        const o = (y * outW + xx) * 3;
        tmp[o] = clip8(s0);
        tmp[o + 1] = clip8(s1);
        tmp[o + 2] = clip8(s2);
      }
    }
  } else {
    tmp = Uint8Array.from(img.data);
  }
  if (outH === ih) return { width: outW, height: outH, data: tmp };
  const { ksize, bounds, kk } = coeffs(ih, outH);
  const out = new Uint8Array(outW * outH * 3);
  for (let yy = 0; yy < outH; yy++) {
    const ymin = bounds[2 * yy], ymax = bounds[2 * yy + 1];
    for (let x = 0; x < outW; x++) {
      let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2;
      for (let y = 0; y < ymax; y++) {
        const w = kk[yy * ksize + y];
        const p = ((ymin + y) * outW + x) * 3;
        s0 += tmp[p] * w;
        s1 += tmp[p + 1] * w;
        s2 += tmp[p + 2] * w;
      }
      const o = (yy * outW + x) * 3;
      out[o] = clip8(s0);
      out[o + 1] = clip8(s1);
      out[o + 2] = clip8(s2);
    }
  }
  return { width: outW, height: outH, data: out };
}

export function preprocessImage(img: RGBImage, maxSoftTokens = 280): RGBImage {
  const [tw, th] = targetSize(img.width, img.height, maxSoftTokens);
  if (tw === img.width && th === img.height) return img;
  return resizeBicubic(img, tw, th);
}
