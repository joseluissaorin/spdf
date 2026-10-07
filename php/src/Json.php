<?php

declare(strict_types=1);

namespace Spdf;

/**
 * JSON helpers shared by the whole library.
 *
 * JSON objects decode to associative arrays, except the empty object, which stays
 * a `stdClass` so that `{}` and `[]` survive a round trip. The canonical encoder
 * sorts keys, rounds floats to 6 decimals and writes no whitespace (contract §5).
 */
final class Json
{
    private const FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS;

    /** Decodes JSON text; throws \JsonException on invalid input. */
    public static function decode(string $text): mixed
    {
        $value = json_decode($text, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        return self::fromObjects($value);
    }

    /** Decodes JSON text stored in a TEXT column; NULL stays null. */
    public static function decodeColumn(?string $text): mixed
    {
        if ($text === null) {
            return null;
        }
        return self::decode($text);
    }

    /** Converts the stdClass tree of json_decode() into arrays (keeping `{}` as stdClass). */
    public static function fromObjects(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $vars = get_object_vars($value);
            if ($vars === []) {
                return new \stdClass();
            }
            $out = [];
            foreach ($vars as $k => $v) {
                $out[(string) $k] = self::fromObjects($v);
            }
            return $out;
        }
        if (is_array($value)) {
            return array_map([self::class, 'fromObjects'], $value);
        }
        return $value;
    }

    /** True if the PHP value encodes as a JSON object. */
    public static function isObject(mixed $value): bool
    {
        return $value instanceof \stdClass || (is_array($value) && $value !== [] && !array_is_list($value));
    }

    /** Plain (non-canonical) encoding, for exports meant for people and tools. */
    public static function encode(mixed $value, bool $pretty = false): string
    {
        $flags = self::FLAGS | JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION;
        if ($pretty) {
            $flags |= JSON_PRETTY_PRINT;
        }
        return json_encode($value, $flags);
    }

    /** Canonical encoding (RFC 8785 / JCS after rounding floats to 6 decimals). */
    public static function canonical(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            return self::number($value);
        }
        if (is_string($value)) {
            return self::string($value);
        }
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
            if ($value === []) {
                return '{}';
            }
        }
        if (is_array($value)) {
            if ($value === [] || array_is_list($value)) {
                return '[' . implode(',', array_map([self::class, 'canonical'], $value)) . ']';
            }
            $keys = array_map('strval', array_keys($value));
            usort($keys, [self::class, 'compareUtf16']);
            $parts = [];
            foreach ($keys as $k) {
                $parts[] = self::string($k) . ':' . self::canonical($value[$k]);
            }
            return '{' . implode(',', $parts) . '}';
        }
        throw new \InvalidArgumentException('Value cannot be encoded as JSON: ' . get_debug_type($value));
    }

    /** JCS string: raw UTF-8, escaping only quote, backslash and U+0000-U+001F. */
    public static function string(string $s): string
    {
        return json_encode($s, self::FLAGS | JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    /** Orders two keys by UTF-16 code units, as JCS requires. */
    public static function compareUtf16(string $a, string $b): int
    {
        if (preg_match('/[\x{10000}-\x{10FFFF}]/u', $a . $b) !== 1) {
            return strcmp($a, $b);
        }
        return strcmp(mb_convert_encoding($a, 'UTF-16BE', 'UTF-8'), mb_convert_encoding($b, 'UTF-16BE', 'UTF-8'));
    }

    /** Rounds to 6 decimals, half to even on the exact binary value. */
    public static function round6(float $f): float
    {
        if (is_nan($f) || is_infinite($f)) {
            return $f;
        }
        $r = (float) sprintf('%.6F', $f);
        return $r == 0.0 ? 0.0 : $r;
    }

    /** A float rounded to 6 decimals, printed the ECMAScript way (1.0 -> 1, 1e-6 -> 0.000001). */
    public static function number(float $f): string
    {
        if (is_nan($f) || is_infinite($f)) {
            return 'null';
        }
        return self::ecma(self::round6($f));
    }

    /** ECMAScript Number.prototype.toString for a finite double. */
    public static function ecma(float $x): string
    {
        if ($x == 0.0) {
            return '0';
        }
        $old = ini_get('serialize_precision');
        ini_set('serialize_precision', '-1');
        $repr = var_export(abs($x), true);
        ini_set('serialize_precision', (string) $old);
        if (!preg_match('/^(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i', $repr, $m)) {
            return (string) $x;
        }
        $int = $m[1];
        $frac = $m[2] ?? '';
        $exp = isset($m[3]) ? (int) $m[3] : 0;
        $digits = $int . $frac;
        $n = strlen($int) + $exp; // value = 0.digits x 10^n
        $lead = strspn($digits, '0');
        $digits = substr($digits, $lead);
        $n -= $lead;
        $digits = rtrim($digits, '0');
        if ($digits === '') {
            return '0';
        }
        $k = strlen($digits);
        $out = $x < 0 ? '-' : '';
        if ($k <= $n && $n <= 21) {
            return $out . $digits . str_repeat('0', $n - $k);
        }
        if (0 < $n && $n <= 21) {
            return $out . substr($digits, 0, $n) . '.' . substr($digits, $n);
        }
        if (-6 < $n && $n <= 0) {
            return $out . '0.' . str_repeat('0', -$n) . $digits;
        }
        $e = $n - 1;
        $mant = $k > 1 ? $digits[0] . '.' . substr($digits, 1) : $digits;
        return $out . $mant . 'e' . ($e < 0 ? '-' : '+') . abs($e);
    }

    /** Rounds every float in a tree to 6 decimals (used before structural comparison). */
    public static function roundFloats(mixed $value): mixed
    {
        if (is_float($value)) {
            return self::round6($value);
        }
        if (is_array($value)) {
            return array_map([self::class, 'roundFloats'], $value);
        }
        return $value;
    }
}
