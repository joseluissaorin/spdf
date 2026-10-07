<?php

declare(strict_types=1);

namespace Spdf;

/** Little-endian vector blobs: f32, f16 and i8 (value / 127). */
final class Vectors
{
    public const SIZES = ['f32' => 4, 'f16' => 2, 'i8' => 1];

    public static function size(string $dtype): int
    {
        return self::SIZES[$dtype] ?? throw new SpdfException('E030', "Unknown vector dtype: {$dtype}");
    }

    /** @return list<float> */
    public static function decode(string $blob, string $dtype = 'f32'): array
    {
        switch ($dtype) {
            case 'f32':
                return array_values(unpack('g*', $blob) ?: []);
            case 'f16':
                return array_map([self::class, 'halfToFloat'], array_values(unpack('v*', $blob) ?: []));
            case 'i8':
                return array_map(fn (int $b) => $b / 127.0, array_values(unpack('c*', $blob) ?: []));
        }
        throw new SpdfException('E030', "Unknown vector dtype: {$dtype}");
    }

    /**
     * Writer-side encoding (quantization) of float values: f32 and f16 round to
     * nearest even and refuse values that overflow; i8 = clamp(round_half_away(v x 127), -127, 127).
     *
     * @param list<float|int> $v
     */
    public static function encode(array $v, string $dtype = 'f32'): string
    {
        switch ($dtype) {
            case 'f32':
                $out = pack('g*', ...array_map('floatval', $v));
                foreach (array_values(unpack('g*', $out) ?: []) as $i => $f) {
                    if (is_infinite($f) && !is_infinite((float) $v[$i])) {
                        throw new SpdfException('E030', "Value out of range for f32: {$v[$i]}");
                    }
                }
                return $out;
            case 'f16':
                $halves = [];
                foreach ($v as $x) {
                    $h = self::floatToHalf((float) $x);
                    if (($h & 0x7fff) === 0x7c00 && !is_infinite((float) $x)) {
                        throw new SpdfException('E030', "Value out of range for f16: {$x}");
                    }
                    $halves[] = $h;
                }
                return pack('v*', ...$halves);
            case 'i8':
                return pack('c*', ...array_map(function ($x) {
                    $y = ((float) $x) * 127;
                    $q = floor(abs($y) + 0.5) * ($y >= 0 ? 1 : -1);
                    return (int) max(-127, min(127, $q));
                }, $v));
        }
        throw new SpdfException('E032', "Unknown vector dtype: {$dtype}");
    }

    public static function halfToFloat(int $h): float
    {
        $sign = ($h >> 15) & 1 ? -1.0 : 1.0;
        $exp = ($h >> 10) & 0x1f;
        $frac = $h & 0x3ff;
        if ($exp === 0) {
            return $sign * $frac * 2 ** -24;
        }
        if ($exp === 31) {
            return $frac === 0 ? $sign * INF : NAN;
        }
        return $sign * (1 + $frac / 1024) * 2 ** ($exp - 15);
    }

    public static function floatToHalf(float|int $f): int
    {
        $f = (float) $f;
        $bits = unpack('V', pack('g', $f))[1];
        $sign = ($bits >> 16) & 0x8000;
        $exp = (($bits >> 23) & 0xff) - 127 + 15;
        $mant = $bits & 0x7fffff;
        if ((($bits >> 23) & 0xff) === 0xff) {
            return $sign | 0x7c00 | ($mant ? 0x200 : 0);
        }
        if ($exp >= 31) {
            return $sign | 0x7c00;
        }
        if ($exp <= 0) {
            if ($exp < -10) {
                return $sign;
            }
            $mant |= 0x800000;
            $shift = 14 - $exp;
            $half = $mant >> $shift;
            $rem = $mant & ((1 << $shift) - 1);
            $mid = 1 << ($shift - 1);
            if ($rem > $mid || ($rem === $mid && ($half & 1))) {
                $half++;
            }
            return $sign | $half;
        }
        $half = ($exp << 10) | ($mant >> 13);
        $rem = $mant & 0x1fff;
        if ($rem > 0x1000 || ($rem === 0x1000 && ($half & 1))) {
            $half++;
        }
        return $sign | $half;
    }

    /** @param list<float> $a @param list<float> $b */
    public static function dot(array $a, array $b): float
    {
        $s = 0.0;
        $n = min(count($a), count($b));
        for ($i = 0; $i < $n; $i++) {
            $s += $a[$i] * $b[$i];
        }
        return $s;
    }

    /** @param list<float> $a @param list<float> $b */
    public static function cosine(array $a, array $b): float
    {
        $na = sqrt(self::dot($a, $a));
        $nb = sqrt(self::dot($b, $b));
        if ($na == 0.0 || $nb == 0.0) {
            return 0.0;
        }
        return self::dot($a, $b) / ($na * $nb);
    }
}
