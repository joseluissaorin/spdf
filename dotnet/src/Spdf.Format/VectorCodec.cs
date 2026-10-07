using System.Buffers.Binary;

namespace Spdf;

/// <summary>
/// Vector encodings (specification §9): little-endian <c>f32</c>, <c>f16</c> (IEEE binary16)
/// and <c>i8</c> (value = q / 127).
/// </summary>
public static class VectorCodec
{
    /// <summary>Byte size of one component of a dtype, or 0 if the dtype is unknown.</summary>
    public static int DTypeSize(string? dtype) => dtype switch
    {
        "f32" => 4,
        "f16" => 2,
        "i8" => 1,
        _ => 0,
    };

    /// <summary>Decodes a stored vector to doubles (f32 and f16 exactly; i8 as q/127).</summary>
    /// <exception cref="ArgumentException">Unknown dtype or a length that is not a multiple of the component size.</exception>
    public static double[] Decode(ReadOnlySpan<byte> data, string dtype)
    {
        switch (dtype)
        {
            case "f32":
            {
                if (data.Length % 4 != 0)
                {
                    throw new ArgumentException($"f32 vector length {data.Length} is not a multiple of 4");
                }
                var v = new double[data.Length / 4];
                for (int i = 0; i < v.Length; i++)
                {
                    v[i] = BinaryPrimitives.ReadSingleLittleEndian(data[(i * 4)..]);
                }
                return v;
            }
            case "f16":
            {
                if (data.Length % 2 != 0)
                {
                    throw new ArgumentException($"f16 vector length {data.Length} is not a multiple of 2");
                }
                var v = new double[data.Length / 2];
                for (int i = 0; i < v.Length; i++)
                {
                    v[i] = HalfToDouble(BinaryPrimitives.ReadUInt16LittleEndian(data[(i * 2)..]));
                }
                return v;
            }
            case "i8":
            {
                var v = new double[data.Length];
                for (int i = 0; i < v.Length; i++)
                {
                    v[i] = (sbyte)data[i] / 127.0;
                }
                return v;
            }
        }
        throw new ArgumentException($"unknown dtype '{dtype}'");
    }

    /// <summary>
    /// Encodes values as a writer does (specification §9.2): <c>f32</c> and <c>f16</c> round to
    /// nearest even (a finite value that overflows is an error); <c>i8</c> is
    /// <c>q = floor(|v·127| + 0.5) · sign</c>, clamped to ±127.
    /// </summary>
    /// <exception cref="ArgumentException">Unknown dtype or a value out of range.</exception>
    public static byte[] Quantize(ReadOnlySpan<double> values, string dtype)
    {
        switch (dtype)
        {
            case "i8":
            {
                var out_ = new byte[values.Length];
                for (int i = 0; i < values.Length; i++)
                {
                    out_[i] = (byte)QuantizeI8(values[i]);
                }
                return out_;
            }
            case "f16":
            {
                var out_ = new byte[values.Length * 2];
                for (int i = 0; i < values.Length; i++)
                {
                    BinaryPrimitives.WriteUInt16LittleEndian(out_.AsSpan(i * 2), DoubleToHalf(values[i]));
                }
                return out_;
            }
            case "f32":
            {
                var out_ = new byte[values.Length * 4];
                for (int i = 0; i < values.Length; i++)
                {
                    BinaryPrimitives.WriteSingleLittleEndian(out_.AsSpan(i * 4), ToSingle(values[i]));
                }
                return out_;
            }
        }
        throw new ArgumentException($"unknown dtype '{dtype}'");
    }

    /// <summary>Encodes float components (see <see cref="Quantize(ReadOnlySpan{double}, string)"/>).</summary>
    public static byte[] Quantize(ReadOnlySpan<float> values, string dtype)
    {
        var d = new double[values.Length];
        for (int i = 0; i < values.Length; i++)
        {
            d[i] = values[i];
        }
        return Quantize(d, dtype);
    }

    /// <summary>i8 quantization of one component: <c>floor(|v·127| + 0.5) · sign</c>, clamped to ±127.</summary>
    public static sbyte QuantizeI8(double v)
    {
        double x = v * 127;
        double q = Math.Floor(Math.Abs(x) + 0.5);
        if (x < 0)
        {
            q = -q;
        }
        if (double.IsNaN(q))
        {
            return 0;
        }
        return (sbyte)Math.Clamp(q, -127, 127);
    }

    /// <summary>Converts to binary32 with round-to-nearest-even; a finite value that overflows is an error.</summary>
    public static float ToSingle(double v)
    {
        float f = (float)v;
        if (float.IsInfinity(f) && double.IsFinite(v))
        {
            throw new ArgumentException($"value {v} out of range for f32");
        }
        return f;
    }

    /// <summary>Converts a double directly to IEEE binary16 bits with round-to-nearest-even; a finite value that overflows is an error.</summary>
    public static ushort DoubleToHalf(double v)
    {
        ulong bits = (ulong)BitConverter.DoubleToInt64Bits(v);
        ushort sign = (ushort)((bits >> 48) & 0x8000);
        int exp = (int)((bits >> 52) & 0x7FF);
        ulong frac = bits & ((1UL << 52) - 1);
        if (exp == 0x7FF)
        {
            return (ushort)(sign | (frac != 0 ? 0x7E00 : 0x7C00));
        }
        if (exp == 0)
        {
            return sign; // double subnormals are far below the half range
        }
        ulong m = frac | (1UL << 52);
        int unbiased = exp - 1023;
        int e = unbiased + 15;
        if (e >= 1)
        {
            if (e >= 31)
            {
                throw new ArgumentException($"value {v} out of range for f16");
            }
            ulong half = m >> 42;
            ulong rem = m & ((1UL << 42) - 1);
            const ulong mid = 1UL << 41;
            if (rem > mid || (rem == mid && (half & 1) == 1))
            {
                half++;
            }
            if (half == 1UL << 11)
            {
                half >>= 1;
                e++;
                if (e >= 31)
                {
                    throw new ArgumentException($"value {v} out of range for f16");
                }
            }
            return (ushort)(sign | (e << 10) | (int)(half & 0x3FF));
        }
        int shift = 28 - unbiased;
        if (shift >= 64)
        {
            return sign;
        }
        ulong h = m >> shift;
        ulong r = m & ((1UL << shift) - 1);
        ulong midpoint = 1UL << (shift - 1);
        if (r > midpoint || (r == midpoint && (h & 1) == 1))
        {
            h++;
        }
        return (ushort)(sign | (int)h);
    }

    /// <summary>Converts IEEE binary16 bits to a double (exactly).</summary>
    public static double HalfToDouble(ushort h) => (double)BitConverter.UInt16BitsToHalf(h);

    /// <summary>
    /// Packs the values of a source file (exact mode): <c>i8</c> values are the stored integers
    /// (−127…127); <c>f32</c> and <c>f16</c> values must be exactly representable.
    /// </summary>
    internal static byte[] PackExact(List<object?> values, string dtype)
    {
        if (dtype == "i8")
        {
            var out_ = new byte[values.Count];
            for (int i = 0; i < values.Count; i++)
            {
                if (values[i] is not long n || n < -127 || n > 127)
                {
                    throw new ArgumentException($"i8 values are integers in [-127, 127], got {SpdfJson.Compact(values[i])}");
                }
                out_[i] = (byte)(sbyte)n;
            }
            return out_;
        }
        var d = new double[values.Count];
        for (int i = 0; i < values.Count; i++)
        {
            if (values[i] is not (long or double))
            {
                throw new ArgumentException($"vector value {SpdfJson.Compact(values[i])} is not a number");
            }
            d[i] = SpdfJson.ToDouble(values[i]);
        }
        var data = Quantize(d, dtype);
        var back = Decode(data, dtype);
        for (int i = 0; i < d.Length; i++)
        {
            if (back[i] != d[i])
            {
                throw new ArgumentException($"{dtype} value {SpdfJson.FormatNumber(d[i])} is not exactly representable");
            }
        }
        return data;
    }
}
