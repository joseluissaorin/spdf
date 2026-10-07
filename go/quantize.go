package spdf

import (
	"fmt"
	"math"
)

// Writer-side vector encoding (contract §2): f32 and f16 round to nearest
// even (an overflow is an error), i8 = clamp(round_half_away(v × 127), ±127).

// QuantizeI8 quantizes one component: q = floor(|v×127| + 0.5) · sign, clamped to ±127.
func QuantizeI8(v float64) int8 {
	x := v * 127
	q := math.Floor(math.Abs(x) + 0.5)
	if x < 0 {
		q = -q
	}
	if q > 127 {
		q = 127
	}
	if q < -127 {
		q = -127
	}
	return int8(q)
}

// ToFloat32 converts with round-to-nearest-even; a finite value that
// overflows is an error.
func ToFloat32(v float64) (float32, error) {
	f := float32(v)
	if math.IsInf(float64(f), 0) && !math.IsInf(v, 0) && !math.IsNaN(v) {
		return 0, fmt.Errorf("value %v out of range for f32", v)
	}
	return f, nil
}

// ToHalf converts a float64 directly to IEEE 754 binary16 with
// round-to-nearest-even; a finite value that overflows is an error.
func ToHalf(v float64) (uint16, error) {
	bits := math.Float64bits(v)
	sign := uint16(bits>>48) & 0x8000
	exp := int((bits >> 52) & 0x7ff)
	frac := bits & (1<<52 - 1)
	switch {
	case exp == 0x7ff:
		if frac != 0 {
			return sign | 0x7e00, nil
		}
		return sign | 0x7c00, nil
	case exp == 0:
		return sign, nil // double subnormals are far below the half range
	}
	m := frac | 1<<52 // 53-bit significand
	unbiased := exp - 1023
	e := unbiased + 15
	if e >= 1 {
		if e >= 31 {
			return 0, fmt.Errorf("value %v out of range for f16", v)
		}
		half := m >> 42
		rem := m & (1<<42 - 1)
		const mid = uint64(1) << 41
		if rem > mid || (rem == mid && half&1 == 1) {
			half++
		}
		if half == 1<<11 {
			half >>= 1
			e++
			if e >= 31 {
				return 0, fmt.Errorf("value %v out of range for f16", v)
			}
		}
		return sign | uint16(e)<<10 | uint16(half&0x3ff), nil
	}
	shift := uint(28 - unbiased)
	if shift >= 64 {
		return sign, nil
	}
	half := m >> shift
	rem := m & (1<<shift - 1)
	mid := uint64(1) << (shift - 1)
	if rem > mid || (rem == mid && half&1 == 1) {
		half++
	}
	return sign | uint16(half), nil
}

// Quantize encodes values as a writer would (little-endian bytes).
func Quantize(values []float64, dtype string) ([]byte, error) {
	switch dtype {
	case "i8":
		out := make([]byte, len(values))
		for i, v := range values {
			out[i] = byte(QuantizeI8(v))
		}
		return out, nil
	case "f16":
		out := make([]byte, 2*len(values))
		for i, v := range values {
			h, err := ToHalf(v)
			if err != nil {
				return nil, err
			}
			out[2*i] = byte(h)
			out[2*i+1] = byte(h >> 8)
		}
		return out, nil
	case "f32", "":
		out := make([]byte, 4*len(values))
		for i, v := range values {
			f, err := ToFloat32(v)
			if err != nil {
				return nil, err
			}
			b := math.Float32bits(f)
			out[4*i], out[4*i+1], out[4*i+2], out[4*i+3] = byte(b), byte(b>>8), byte(b>>16), byte(b>>24)
		}
		return out, nil
	}
	return nil, fmt.Errorf("unknown dtype %q", dtype)
}
